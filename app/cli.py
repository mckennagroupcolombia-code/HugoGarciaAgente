
import re
import time

# Datos de McKenna Group S.A.S. para validación de facturas de compra
_NIT_MCKG    = "901316016"   # Sin dígito verificador
_NOMBRE_MCKG = "MCKENNA GROUP S.A.S"

# --- Importaciones de Lógica de Negocio ---
from app.sync import (
    sincronizar_inteligente,
    sincronizar_facturas_recientes,
    ejecutar_sincronizacion_y_reporte_stock,
    sincronizar_manual_por_id,
    sincronizar_por_dia_especifico
)
from app.services.google_services import leer_datos_hoja
from app.services.meli import aprender_de_interacciones_meli
from app.services.woocommerce import obtener_todos_los_productos_woocommerce, sincronizar_catalogo_woocommerce
from app.tools.verificacion_sync_skus import verificar_sync_skus

# --- Importación del Cerebro de la IA ---
from app.core import obtener_respuesta_ia


# ─────────────────────────────────────────────────────────────────
#  Opción 10 — Registro de Facturas de Compra en SIIGO (terminal)
# ─────────────────────────────────────────────────────────────────

def _diagnostico_facturas_compra():
    """
    Verifica que SIIGO y Gmail estén accesibles antes de iniciar el flujo.
    Retorna (token_siigo, gmail_service) o (None, None) si algo falla.
    """
    import requests
    from app.services.siigo import autenticar_siigo, PARTNER_ID
    from app.tools.sincronizar_facturas_de_compra_siigo import get_gmail_service

    SEP = "─" * 58
    print(f"\n🔧 DIAGNÓSTICO DEL SISTEMA:")
    print(SEP)

    # 1. SIIGO — autenticación
    token = autenticar_siigo()
    if not token:
        print("   [❌] SIIGO: fallo de autenticación")
        print("        → Revisa ~/mi-agente/credenciales_SIIGO.json")
        return None, None
    print("   [✓] SIIGO: autenticado")

    # 2. SIIGO — tipo de documento FC (ID 5809)
    try:
        r = requests.get(
            "https://api.siigo.com/v1/document-types?type=FC",
            headers={"Authorization": f"Bearer {token}", "Partner-Id": PARTNER_ID},
            timeout=8,
        )
        if r.status_code == 200 and r.json():
            doc = r.json()[0]
            consec = doc.get("consecutive", "?")
            print(f"   [✓] Documento FC (ID {doc['id']}): '{doc['name']}' — próximo #{consec + 1}")
        else:
            print(f"   [⚠] Documento FC: respuesta inesperada ({r.status_code}) — continúa bajo tu propio riesgo")
    except Exception as e:
        print(f"   [⚠] No se pudo verificar tipo de documento FC: {e}")

    # 3. SIIGO — centro de costo ID 263 (VENTAS, modelo FC-1-42)
    try:
        r2 = requests.get(
            "https://api.siigo.com/v1/cost-centers",
            headers={"Authorization": f"Bearer {token}", "Partner-Id": PARTNER_ID},
            timeout=8,
        )
        if r2.status_code == 200:
            centros = r2.json() if isinstance(r2.json(), list) else r2.json().get("results", [])
            match = next((c for c in centros if c.get("id") == 263), None)
            if match:
                print(f"   [✓] Centro de costo 263: '{match.get('name', '?')}' (código {match.get('code', '?')})")
            else:
                ids = [c.get("id") for c in centros]
                print(f"   [⚠] Centro de costo 263 no encontrado. Disponibles: {ids}")
        else:
            print(f"   [⚠] Centro de costo: {r2.status_code}")
    except Exception as e:
        print(f"   [⚠] No se pudo verificar centro de costo: {e}")

    # 4. Gmail
    try:
        gmail_svc = get_gmail_service()
        print("   [✓] Gmail: conectado")
    except Exception as e:
        print(f"   [❌] Gmail: {e}")
        print("        → Ejecuta 'python3 scripts/auth_google.py' para reautenticar")
        return None, None

    print(SEP)
    return token, gmail_svc


def _cargar_facturas_gmail(gmail_svc, token):
    """
    Descarga facturas de Gmail y marca cuáles ya están en SIIGO.
    Retorna lista de dicts con los datos de cada factura.
    """
    import requests
    from datetime import datetime, timedelta
    from app.services.siigo import PARTNER_ID
    from app.tools.sincronizar_facturas_de_compra_siigo import (
        leer_correos_no_descargados,
        descargar_y_extraer_zip,
        extraer_datos_xml_dian,
    )

    print("\n📬 Escaneando correos (label: FACTURAS MCKG)...")
    correos = leer_correos_no_descargados()
    if not correos:
        return []

    # Cargar compras SIIGO de los últimos 90 días para detectar duplicados
    registradas_siigo = set()
    try:
        fecha_desde = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
        r = requests.get(
            f"https://api.siigo.com/v1/purchases?date_start={fecha_desde}&page_size=100",
            headers={"Authorization": f"Bearer {token}", "Partner-Id": PARTNER_ID},
            timeout=10,
        )
        if r.status_code == 200:
            for p in r.json().get("results", []):
                pi = p.get("provider_invoice", {})
                registradas_siigo.add((pi.get("prefix", ""), pi.get("number", "")))
    except Exception as e:
        print(f"  ⚠️ No se pudo consultar SIIGO para detectar duplicados: {e}")

    facturas = []
    for correo in correos:
        print(f"  → {correo['asunto']}")
        for adj in correo["adjuntos_zip"]:
            xml, pdf, pdf_name = descargar_y_extraer_zip(
                gmail_svc, correo["id"], adj["id"], adj["filename"]
            )
            if not xml:
                print(f"     ⚠️  Sin XML en {adj['filename']}")
                continue
            datos = extraer_datos_xml_dian(xml)
            if not datos:
                print(f"     ⚠️  No se pudo parsear XML de {adj['filename']}")
                continue
            numero = f"{datos['prefix']}{datos['number']}"
            ya_registrada = (datos["prefix"], datos["number"]) in registradas_siigo

            # Validar que el destinatario sea McKenna Group
            comprador_nit = re.sub(r"\D", "", datos.get("comprador_nit", ""))
            es_para_mckg  = comprador_nit == _NIT_MCKG if comprador_nit else True  # si no hay dato, no bloquear

            facturas.append({
                "numero":        numero,
                "datos":         datos,
                "xml":           xml,
                "pdf":           pdf,
                "pdf_name":      pdf_name,
                "ya_registrada": ya_registrada,
                "es_para_mckg":  es_para_mckg,
            })
            estado = "✓ ya en SIIGO" if ya_registrada else "pendiente"
            dest_aviso = "" if es_para_mckg else f" ⚠️  destinatario: {datos.get('comprador_nombre','?')} ({comprador_nit})"
            print(f"     • {numero} — {datos.get('proveedor','?')} [{estado}]{dest_aviso}")

    return facturas


def _asegurar_proveedor_siigo(token, nit: str, nombre: str) -> bool:
    """
    Verifica que el proveedor exista en SIIGO como contacto/customer.
    Si no existe, lo crea con datos mínimos del XML.
    Retorna True si está listo para usarse, False si falló la creación.
    """
    import requests
    from app.services.siigo import PARTNER_ID

    headers = {"Authorization": f"Bearer {token}", "Partner-Id": PARTNER_ID}

    # Limpiar NIT (quitar dígito verificador si viene con guión)
    nit_base = nit.split("-")[0].strip() if "-" in nit else nit.strip()

    # 1. Verificar si ya existe
    try:
        r = requests.get(
            f"https://api.siigo.com/v1/customers?identification={nit_base}&page_size=1",
            headers=headers, timeout=8
        )
        if r.status_code == 200 and r.json().get("results"):
            return True   # ya existe
    except Exception as e:
        print(f"  ⚠️  No se pudo verificar proveedor en SIIGO: {e}")
        return False

    # 2. Crear proveedor con datos mínimos
    print(f"  ℹ️  Proveedor '{nombre}' (NIT {nit_base}) no existe en SIIGO — creando...")
    payload_prov = {
        "type":           "Customer",
        "person_type":    "Company",
        "id_type":        {"code": "31"},   # NIT empresas
        "identification": nit_base,
        "branch_office":  0,
        "name":           [nombre],
        "address": {
            "address": "Colombia",
            "city": {"country_code": "Co", "state_code": "11", "city_code": "11001"},
        },
        "contacts": [{
            "first_name": nombre[:60],
            "last_name":  "",
            "email":      "",
            "phone":      {"indicative": "000", "number": "0000000"},
        }],
    }
    try:
        rc = requests.post(
            "https://api.siigo.com/v1/customers",
            json=payload_prov, headers=headers, timeout=10
        )
        if rc.status_code in (200, 201):
            print(f"  ✅ Proveedor creado en SIIGO: {nombre} (NIT {nit_base})")
            return True
        else:
            print(f"  ❌ No se pudo crear proveedor en SIIGO: {rc.status_code}")
            print(f"     {rc.text[:300]}")
            return False
    except Exception as e:
        print(f"  ❌ Error creando proveedor: {e}")
        return False


def _cli_registrar_gasto(token, factura):
    """
    Registra una factura como gasto consumible en SIIGO.
    Modelo de referencia: FC-1-42 (document 5809, cost_center 263, payment 1338).
    Crea el proveedor automáticamente si no existe en SIIGO.
    """
    import time as _time
    from app.services.siigo import crear_factura_compra_siigo

    d      = factura["datos"]
    numero = factura["numero"]
    prov   = d.get("proveedor", "—")
    nit    = d.get("nit", "") or ""
    total  = d.get("total_neto", 0)

    # Limpiar NIT y asegurar que el proveedor exista en SIIGO
    nit_base = nit.split("-")[0].strip() if nit else "999999999"
    if nit_base and nit_base != "999999999":
        if not _asegurar_proveedor_siigo(token, nit_base, prov):
            print(f"  ❌ No se puede registrar: proveedor no pudo crearse en SIIGO.")
            print(f"     Crea manualmente el proveedor en SIIGO → Contactos → Nuevo contacto")
            return

    payload = {
        "document":         {"id": 5809},
        "date":             d.get("fecha", time.strftime("%Y-%m-%d")),
        "cost_center":      263,   # VENTAS — modelo FC-1-42
        "supplier":         {"identification": nit_base, "branch_office": 0},
        "provider_invoice": {"prefix": d.get("prefix", ""), "number": d.get("number", "0")},
        "items": [{
            "type":        "Account",
            "code":        "11051001",
            "description": f"{prov} — {numero}"[:100],
            "quantity":    1,
            "price":       total,
            "taxes":       [],
        }],
        "payments":     [{"id": 1338, "value": total}],
        "observations": f"Gasto consumible — {numero} — {prov}",
    }

    print(f"\n  ⏳ Enviando a SIIGO...")
    t0  = _time.time()
    res = crear_factura_compra_siigo(payload)
    elapsed = _time.time() - t0

    if res.get("status") == "success":
        data = res.get("data", {})
        print(f"  ✅ Registrado en SIIGO:")
        print(f"     Número SIIGO : {data.get('name', '—')}")
        print(f"     ID           : {data.get('id', '—')}")
        print(f"     Total        : ${total:,.2f} COP")
        print(f"     Tiempo       : {elapsed:.1f}s")
    else:
        err = res.get("message", str(res))
        print(f"  ❌ Error SIIGO ({elapsed:.1f}s):")
        # Imprimir el error completo para diagnóstico
        for linea in err[:600].split(","):
            print(f"     {linea.strip()}")
        print(f"\n  → Registra manualmente: SIIGO → Compras → Nueva compra o gasto")


def _cli_flujo_inventario(factura):
    """
    Flujo A (inventario): genera Excel + XML con codificación McKenna para importar en SIIGO.
    Si el proveedor no está en la lista especial, ofrece agregarlo.
    """
    import json as _json
    from datetime import datetime as _dt
    from app.tools.importar_productos_siigo import (
        _ejecutar_procesamiento,
        cargar_proveedores_especiales,
        _RUTA_PROVEEDORES,
    )

    d      = factura["datos"]
    numero = factura["numero"]
    prov   = d.get("proveedor", "—")
    nit    = d.get("nit", "")

    # Ofrecer agregar a lista de proveedores especiales si no está
    data_prov  = cargar_proveedores_especiales()
    nit_limpio = re.sub(r"\D", "", nit or "")
    ya_existe  = (
        any(
            re.sub(r"\D", "", p.get("nit", "")) == nit_limpio
            for p in data_prov.get("proveedores", [])
        )
        if nit_limpio else False
    )

    if not ya_existe and nit_limpio:
        resp = input(f"\n  ¿Agregar '{prov}' a proveedores especiales de inventario? [s/n]: ").strip().lower()
        if resp == "s":
            data_prov["proveedores"].append({
                "nit":    nit,
                "nombre": prov,
                "activo": True,
                "nota":   f"Agregado terminal {_dt.now().strftime('%Y-%m-%d')}",
            })
            with open(_RUTA_PROVEEDORES, "w", encoding="utf-8") as ff:
                _json.dump(data_prov, ff, indent=2, ensure_ascii=False)
            print(f"  ✓ '{prov}' guardado en proveedores_especiales.json")

    print(f"\n  ⏳ Procesando productos de {numero}...")
    arch = _ejecutar_procesamiento(numero, d, factura["xml"], silent=True)

    if not arch:
        print(f"  ⚠️  No se encontraron ítems procesables en {numero}.")
        return

    print(f"\n  ✅ Archivos generados:")
    print(f"     📊 Excel : {arch['ruta']}")
    print(f"     📄 XML   : {arch['ruta_xml']}")
    print(f"     Productos nuevos: {arch['nuevos']}   Duplicados: {arch['duplicados']}")
    print(f"\n  📋 PROTOCOLO SIIGO (carga manual):")
    print(f"     Paso A — Productos:")
    print(f"        SIIGO → Inventario → Productos → ▶ Importación → cargar Excel")
    print(f"        (Omitir si todos son duplicados)")
    print(f"     Paso B — Compra:")
    print(f"        SIIGO → Compras → 'Crear compra o gasto desde un XML o ZIP' → cargar XML")
    print(f"     ⚠️  Verifica que el total en SIIGO coincide con la factura del proveedor.")


def _ejecutar_opcion_10():
    """
    Flujo completo de registro de facturas de compra en SIIGO desde la terminal.
    1. Diagnóstico de conectividad (SIIGO + Gmail)
    2. Escaneo de correos → listado de facturas pendientes
    3. Registro interactivo una a una:
       - Gasto consumible → API SIIGO (modelo FC-1-42)
       - Gasto inventario → Flujo A (Excel + XML para carga manual)
    """
    from app.tools.importar_productos_siigo import es_proveedor_especial

    SEP  = "─" * 58
    SEPP = "═" * 58

    print(f"\n{SEPP}")
    print("  🧾  REGISTRO DE FACTURAS DE COMPRA — SIIGO")
    print(f"{SEPP}")

    # ── Diagnóstico ────────────────────────────────────────────
    token, gmail_svc = _diagnostico_facturas_compra()
    if not token or not gmail_svc:
        print("\n❌ Diagnóstico fallido. Resuelve los errores antes de continuar.")
        return

    # ── Escanear correos ───────────────────────────────────────
    facturas = _cargar_facturas_gmail(gmail_svc, token)

    if not facturas:
        print("\n✅ No hay facturas en el correo (label: FACTURAS MCKG).\n")
        return

    # ── Mostrar listado ────────────────────────────────────────
    print(f"\n{SEP}")
    print(f"  FACTURAS DETECTADAS ({len(facturas)}):")
    print(SEP)
    for i, f in enumerate(facturas, 1):
        d     = f["datos"]
        total = d.get("total_neto", 0)
        items = len(d.get("items", []))
        marca = " [✓ YA EN SIIGO]" if f["ya_registrada"] else ""
        alerta = " [⚠ NO ES PARA MCKG]" if not f["es_para_mckg"] else ""
        print(
            f"  [{i}] {f['numero']:<18} | {d.get('proveedor','?')[:26]:<26} | "
            f"${total:>12,.0f} | {items} ítem(s){marca}{alerta}"
        )
    print(SEP)

    # ── Procesar una a una ─────────────────────────────────────
    total_ok = 0
    total_skip = 0

    for idx, factura in enumerate(facturas, 1):
        d      = factura["datos"]
        numero = factura["numero"]
        prov   = d.get("proveedor", "Desconocido")
        nit    = d.get("nit", "")
        total  = d.get("total_neto", 0)
        items  = d.get("items", [])

        print(f"\n{SEPP}")
        print(f"  FACTURA {idx}/{len(facturas)}: {numero}")
        print(SEPP)
        print(f"  Proveedor  : {prov}")
        print(f"  NIT        : {nit or '—'}")
        print(f"  Fecha      : {d.get('fecha', '?')}")
        print(f"  Total neto : ${total:,.2f} COP")
        print(f"  Ítems ({len(items)}):")
        for it in items:
            desc = it["description"][:55]
            print(f"    • {desc:<55}  ${it['subtotal']:>12,.2f}")
        print(SEP)

        # ── Validación: ¿la factura es para McKenna Group? ────────
        if not factura["es_para_mckg"]:
            comprador_nit  = re.sub(r"\D", "", d.get("comprador_nit", ""))
            comprador_nom  = d.get("comprador_nombre", "desconocido")
            print(f"\n  {'─'*54}")
            print(f"  🚨 ALERTA — DESTINATARIO INCORRECTO")
            print(f"  {'─'*54}")
            print(f"  Esta factura NO está dirigida a McKenna Group S.A.S.")
            print(f"  Destinatario en XML : {comprador_nom}")
            print(f"  NIT destinatario    : {comprador_nit or '—'}")
            print(f"  NIT McKenna Group   : {_NIT_MCKG}")
            print(f"  {'─'*54}")
            print(f"  Posiblemente es una factura de venta enviada al correo")
            print(f"  por error, o fue emitida a otra persona/empresa.")
            sel_alerta = input("  ¿Registrar de todas formas? [s/n]: ").strip().lower()
            if sel_alerta != "s":
                print(f"  ⏭️  Factura {numero} descartada (destinatario incorrecto).")
                total_skip += 1
                continue

        if factura["ya_registrada"]:
            print("  ⚠️  Esta factura YA ESTÁ registrada en SIIGO.")
            sel = input("  ¿Registrar de todas formas? [s/n]: ").strip().lower()
            if sel != "s":
                print(f"  ⏭️  Omitida.")
                total_skip += 1
                continue

        es_especial = es_proveedor_especial(nit, prov)

        if es_especial:
            print(f"  ✅ Proveedor en lista de materias primas.\n")
            print("  ¿Qué deseas hacer?")
            print("    [1] Flujo A — Inventario (Excel + XML para cargar en SIIGO)")
            print("    [s] Omitir")
        else:
            print(f"  ⚠️  Proveedor no registrado como materia prima.\n")
            print("  ¿Cómo registrar esta factura?")
            print("    [1] Gasto consumible  → registrar en SIIGO ahora (API)")
            print("    [2] Gasto inventario  → Flujo A (Excel + XML)")
            print("    [s] Omitir")
        print("    [q] Salir")

        sel = input("\n  Selección: ").strip().lower()

        if sel == "q":
            print("\n  👋 Saliendo del registro de facturas.")
            break

        if sel == "s":
            print(f"  ⏭️  Factura {numero} omitida.")
            total_skip += 1
            continue

        if sel == "1" and not es_especial:
            _cli_registrar_gasto(token, factura)
            total_ok += 1
        elif (sel == "2" and not es_especial) or (sel == "1" and es_especial):
            _cli_flujo_inventario(factura)
            total_ok += 1
        else:
            print(f"  ❌ Opción '{sel}' no válida. Factura omitida.")
            total_skip += 1
            continue

        if idx < len(facturas):
            input(f"\n  [Enter] para continuar con la factura {idx + 1}/{len(facturas)}...")

    print(f"\n{SEPP}")
    print(f"  ✅ Proceso finalizado — Registradas: {total_ok}  Omitidas: {total_skip}")
    print(f"{SEPP}\n")


# ─────────────────────────────────────────────────────────────────
#  Menú principal
# ─────────────────────────────────────────────────────────────────

def mostrar_menu():
    """Imprime el menú principal de opciones en la consola."""
    print("\n" + "═"*55)
    print("🛠️  CENTRO DE MANDO MCKENNA GROUP S.A.S.")
    print("═"*55)
    print("1.  💬 [CHAT]  Modo conversación con el Agente (IA)")
    print("2.  🧠 [SYNC]  Inteligente (Pendientes MeLi vs Siigo)")
    print("3.  📦 [SYNC]  Facturas Recientes (Último día)")
    print("4.  📦 [SYNC]  Facturas Recientes (Últimos 10 días)")
    print("5.  📊 [TOTAL] Sincronización Completa y Reporte de Stock")
    print("6.  🔍 [DATA]  Consultar Producto en Google Sheets")
    print("7.  🛠️  [MANUAL] Sincronizar por Pack ID Específico")
    print("8.  🎓 [IA]    Forzar Aprendizaje de Interacciones MeLi")
    print("9.  📅 [FECHA] Sincronizar Facturas por Día Específico")
    print("10. 🧾 [COMPRAS] Registrar Facturas de Compra en SIIGO")
    print("11. 🚪 [EXIT]  Salir del Centro de Mando")
    print("12. 🛒 [WC]    Sync manual WooCommerce")
    print("13. 🔍 [SYNC]  Verificar sincronización SKUs (MeLi/SIIGO/WC)")
    print("═"*55)


def iniciar_cli():
    """
    Bucle principal de la Interfaz de Línea de Comandos (CLI).
    Gestiona la navegación del usuario y ejecuta las tareas correspondientes.
    """
    time.sleep(2)

    import sys
    if not sys.stdin.isatty():
        print("[CLI] Sin terminal interactiva (systemd), menú deshabilitado.")
        return

    while True:
        mostrar_menu()
        opcion = input("Seleccione una opción (1-13): ")

        if opcion == "1":
            print("\n--- 💬 MODO CHAT ACTIVADO (Escribe 'salir' o 'menu' para volver) ---")
            sesion_historial = []
            while True:
                user_input = input("👤 Tú: ")
                if user_input.lower() in ["salir", "exit", "menu", "volver"]:
                    print("--- 🔙 Volviendo al menú principal ---\n")
                    break
                respuesta, nuevo_historial = obtener_respuesta_ia(
                    pregunta=user_input,
                    usuario_id="usuario_terminal_cli",
                    historial=sesion_historial,
                )
                if nuevo_historial:
                    sesion_historial = nuevo_historial
                print(f"\n🤖 Agente: {respuesta}\n")

        elif opcion == "2":
            print(sincronizar_inteligente())
        elif opcion == "3":
            print(sincronizar_facturas_recientes(dias=1))
        elif opcion == "4":
            print(sincronizar_facturas_recientes(dias=10))
        elif opcion == "5":
            print(ejecutar_sincronizacion_y_reporte_stock())
        elif opcion == "6":
            producto = input("🔍 Ingrese el nombre del producto a buscar: ")
            print(leer_datos_hoja(producto))
        elif opcion == "7":
            pack_id = input("📝 Ingrese el Pack ID que desea sincronizar: ")
            print(sincronizar_manual_por_id(pack_id))
        elif opcion == "8":
            print(aprender_de_interacciones_meli())
        elif opcion == "9":
            fecha = input("📅 Ingrese la fecha (formato AAAA-MM-DD): ")
            print(sincronizar_por_dia_especifico(fecha))
        elif opcion == "10":
            _ejecutar_opcion_10()
        elif opcion == "11":
            print("👋 Apagando el Centro de Mando...")
            break
        elif opcion == "12":
            print("\n🛒 [WC] Consultando catálogo de WooCommerce...")
            productos_wc = obtener_todos_los_productos_woocommerce()
            if not productos_wc:
                print("⚠️ No se encontraron productos en WooCommerce o hubo un error.")
            else:
                print(f"\n📦 {len(productos_wc)} producto(s) encontrados en WooCommerce:\n")
                for p in productos_wc:
                    print(f"  [{p.get('sku', 'sin SKU')}] {p.get('nombre', '')} — Stock: {p.get('stock', 0)}")
                confirmar = input(f"\n¿Sincronizar masivamente los {len(productos_wc)} productos? (s/n): ").strip().lower()
                if confirmar == "s":
                    payload = [{"sku": p["sku"], "stock": p["stock"]} for p in productos_wc if p.get("sku")]
                    print(sincronizar_catalogo_woocommerce(payload))
                else:
                    print("↩️ Sincronización cancelada.")
        elif opcion == "13":
            print("\n🔍 [SYNC] Verificando sincronización de SKUs entre plataformas...")
            print(verificar_sync_skus(notificar_wa=True))
        else:
            print("❌ Opción no válida. Por favor, intente de nuevo.")
