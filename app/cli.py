import os
import re
import json
import time

# Datos de McKenna Group S.A.S. para validación de facturas de compra
_NIT_MCKG = "901316016"  # Sin dígito verificador
_NOMBRE_MCKG = "MCKENNA GROUP S.A.S"

# Archivo de facturas omitidas por destinatario incorrecto
_RUTA_OMITIDAS = os.path.join(
    os.path.dirname(__file__), "data", "facturas_compra_omitidas.json"
)


def _cargar_omitidas() -> set:
    """Retorna set de tuplas (prefix, number) que ya fueron descartadas."""
    try:
        if os.path.exists(_RUTA_OMITIDAS):
            with open(_RUTA_OMITIDAS, "r", encoding="utf-8") as f:
                data = json.load(f)
            return {
                (item["prefix"], item["number"]) for item in data.get("omitidas", [])
            }
    except Exception:
        pass
    return set()


def _guardar_omitida(datos: dict):
    """Persiste una factura en la lista de omitidas para no volver a mostrarla."""
    try:
        existing = []
        if os.path.exists(_RUTA_OMITIDAS):
            with open(_RUTA_OMITIDAS, "r", encoding="utf-8") as f:
                existing = json.load(f).get("omitidas", [])
        key = (datos.get("prefix", ""), datos.get("number", ""))
        if not any((e["prefix"], e["number"]) == key for e in existing):
            existing.append(
                {
                    "prefix": datos.get("prefix", ""),
                    "number": datos.get("number", ""),
                    "proveedor": datos.get("proveedor", ""),
                    "comprador_nombre": datos.get("comprador_nombre", ""),
                    "comprador_nit": datos.get("comprador_nit", ""),
                    "fecha_omision": time.strftime("%Y-%m-%d"),
                }
            )
            with open(_RUTA_OMITIDAS, "w", encoding="utf-8") as f:
                json.dump({"omitidas": existing}, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"  ⚠️  No se pudo guardar factura omitida: {e}")


# --- Importaciones de Lógica de Negocio ---
from app.sync import (
    sincronizar_inteligente,
    sincronizar_facturas_recientes,
    ejecutar_sincronizacion_y_reporte_stock,
    sincronizar_manual_por_id,
    sincronizar_por_dia_especifico,
)
from app.services.google_services import leer_datos_hoja
from app.services.meli import aprender_de_interacciones_meli
from app.tools.verificacion_sync_skus import verificar_sync_skus
from app.tools.sincronizar_productos_pagina_web import sincronizar_productos_pagina_web

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
    token = autenticar_siigo(forzar=True)  # siempre token fresco al iniciar sesión
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
            print(
                f"   [✓] Documento FC (ID {doc['id']}): '{doc['name']}' — próximo #{consec + 1}"
            )
        else:
            print(
                f"   [⚠] Documento FC: respuesta inesperada ({r.status_code}) — continúa bajo tu propio riesgo"
            )
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
            centros = (
                r2.json()
                if isinstance(r2.json(), list)
                else r2.json().get("results", [])
            )
            match = next((c for c in centros if c.get("id") == 263), None)
            if match:
                print(
                    f"   [✓] Centro de costo 263: '{match.get('name', '?')}' (código {match.get('code', '?')})"
                )
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
    from app.services.siigo import PARTNER_ID
    from app.tools.sincronizar_facturas_de_compra_siigo import (
        leer_correos_no_descargados,
        descargar_y_extraer_zip,
        extraer_datos_xml_dian,
    )

    FECHA_INICIO_2026 = "2026/01/01"
    FECHA_INICIO_SIIGO = "2026-01-01"

    print(
        f"\n📬 Escaneando correos (label: FACTURAS MCKG, desde {FECHA_INICIO_2026})..."
    )
    correos = leer_correos_no_descargados(fecha_desde=FECHA_INICIO_2026)
    if not correos:
        return []

    # Facturas ya omitidas (destinatario incorrecto) — se filtran silenciosamente
    omitidas = _cargar_omitidas()

    # Cargar TODAS las compras SIIGO desde ene-2026 (con paginación) para detectar duplicados
    registradas_siigo = {}  # (prefix, number) → nombre doc SIIGO (ej. "FC-1-46")
    try:
        pagina = 1
        while True:
            r = requests.get(
                f"https://api.siigo.com/v1/purchases?date_start={FECHA_INICIO_SIIGO}&page={pagina}&page_size=100",
                headers={"Authorization": f"Bearer {token}", "Partner-Id": PARTNER_ID},
                timeout=15,
            )
            if r.status_code != 200:
                print(
                    f"  ⚠️ No se pudo consultar SIIGO para detectar duplicados: HTTP {r.status_code}"
                )
                break
            data = r.json()
            resultados = data.get("results", [])
            for p in resultados:
                pi = p.get("provider_invoice", {})
                key = (pi.get("prefix", ""), pi.get("number", ""))
                registradas_siigo[key] = p.get("name", "?")
            # Verificar si hay más páginas
            pagination = data.get("pagination", {})
            total_results = pagination.get("total_results", len(resultados))
            fetched = pagina * 100
            if fetched >= total_results or not resultados:
                break
            pagina += 1
        print(
            f"  🗂️  {len(registradas_siigo)} compra(s) ya registradas en SIIGO desde {FECHA_INICIO_SIIGO}"
        )
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

            # Silenciosamente omitir facturas ya descartadas por destinatario incorrecto
            if (datos["prefix"], datos["number"]) in omitidas:
                print(
                    f"     • {numero} — omitida (destinatario incorrecto, registrada anteriormente)"
                )
                continue

            clave = (datos["prefix"], datos["number"])
            doc_siigo = registradas_siigo.get(clave)  # "FC-1-46" o None
            ya_registrada = doc_siigo is not None

            # Validar que el destinatario sea McKenna Group
            comprador_nit = re.sub(r"\D", "", datos.get("comprador_nit", ""))
            es_para_mckg = (
                comprador_nit == _NIT_MCKG if comprador_nit else True
            )  # si no hay dato, no bloquear

            facturas.append(
                {
                    "numero": numero,
                    "datos": datos,
                    "xml": xml,
                    "pdf": pdf,
                    "pdf_name": pdf_name,
                    "ya_registrada": ya_registrada,
                    "doc_siigo": doc_siigo,  # nombre del doc en SIIGO si ya existe
                    "es_para_mckg": es_para_mckg,
                }
            )
            estado = "✓ ya en SIIGO" if ya_registrada else "pendiente"
            dest_aviso = (
                ""
                if es_para_mckg
                else f" ⚠️  destinatario: {datos.get('comprador_nombre', '?')} ({comprador_nit})"
            )
            print(
                f"     • {numero} — {datos.get('proveedor', '?')} [{estado}]{dest_aviso}"
            )

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
            headers=headers,
            timeout=8,
        )
        if r.status_code == 200 and r.json().get("results"):
            return True  # ya existe
    except Exception as e:
        print(f"  ⚠️  No se pudo verificar proveedor en SIIGO: {e}")
        return False

    # 2. Crear proveedor con datos mínimos
    print(f"  ℹ️  Proveedor '{nombre}' (NIT {nit_base}) no existe en SIIGO — creando...")
    payload_prov = {
        "type": "Customer",
        "person_type": "Company",
        "id_type": {"code": "31"},  # NIT empresas
        "identification": nit_base,
        "branch_office": 0,
        "name": [nombre],
        "address": {
            "address": "Colombia",
            "city": {"country_code": "Co", "state_code": "11", "city_code": "11001"},
        },
        "contacts": [
            {
                "first_name": nombre[:60],
                "last_name": "",
                "email": "",
                "phone": {"indicative": "000", "number": "0000000"},
            }
        ],
    }
    try:
        rc = requests.post(
            "https://api.siigo.com/v1/customers",
            json=payload_prov,
            headers=headers,
            timeout=10,
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

    d = factura["datos"]
    numero = factura["numero"]
    prov = d.get("proveedor", "—")
    nit = d.get("nit", "") or ""
    total = d.get("total_neto", 0)

    # Limpiar NIT y asegurar que el proveedor exista en SIIGO
    nit_base = nit.split("-")[0].strip() if nit else "999999999"
    if nit_base and nit_base != "999999999":
        if not _asegurar_proveedor_siigo(token, nit_base, prov):
            print(f"  ❌ No se puede registrar: proveedor no pudo crearse en SIIGO.")
            print(
                f"     Crea manualmente el proveedor en SIIGO → Contactos → Nuevo contacto"
            )
            return

    payload = {
        "document": {"id": 5809},
        "date": d.get("fecha", time.strftime("%Y-%m-%d")),
        "cost_center": 263,  # VENTAS — modelo FC-1-42
        "supplier": {"identification": nit_base, "branch_office": 0},
        "provider_invoice": {
            "prefix": d.get("prefix") or "FV",
            "number": d.get("number") or "0",
        },
        "items": [
            {
                "type": "Account",
                "code": "11051001",
                "description": f"{prov} — {numero}"[:100],
                "quantity": 1,
                "price": total,
                "taxes": [],
            }
        ],
        "payments": [{"id": 1338, "value": total}],
        "observations": f"Gasto consumible — {numero} — {prov}",
    }

    print(f"\n  ⏳ Enviando a SIIGO...")
    t0 = _time.time()
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


def _siigo_crear_producto(token: str, producto: dict) -> tuple:
    """
    Crea un producto en SIIGO via POST /v1/products.
    Retorna (ok: bool, mensaje: str).
    """
    import requests
    from app.services.siigo import PARTNER_ID

    headers = {
        "Authorization": f"Bearer {token}",
        "Partner-Id": PARTNER_ID,
        "Content-Type": "application/json",
    }
    has_iva = producto.get("iva", 0) > 0
    taxes = [{"id": 3118}] if has_iva else []
    precio_vu = producto.get("precio_unitario", 0)  # con IVA — precio de venta
    precio_neto = producto.get("precio_neto", precio_vu)  # sin IVA — costo de compra

    # Mapa de unidad mínima → código interno SIIGO API
    # 94 = Unidades | 79 = Mililitro | 62 = Gramo
    _SIIGO_UNIT = {"Un": "94", "mL": "79", "g": "62"}
    siigo_unit_code = _SIIGO_UNIT.get(producto.get("unidad_min", "Un"), "94")

    payload = {
        "code": producto["codigo"],
        "name": producto["nombre"][:120],
        "account_group": 297,  # Productos (integer ID, no objeto)
        "type": "Product",
        "stock_control": True,
        "unit": {"code": siigo_unit_code},
        "warehouses": [{"id": 41, "quantity": 0, "unit_cost": precio_neto}],
        "prices": [
            {
                "currency_code": "COP",
                "price_list": [{"position": 1, "value": round(precio_vu * 1.3, 0)}],
            }
        ],
        "taxes": taxes,
    }
    try:
        r = requests.post(
            "https://api.siigo.com/v1/products",
            json=payload,
            headers=headers,
            timeout=15,
        )
        if r.status_code in (200, 201):
            data = r.json()
            return True, f"ID {data.get('id', '?')} — código {data.get('code', '?')}"
        else:
            return False, f"HTTP {r.status_code}: {r.text[:250]}"
    except Exception as e:
        return False, str(e)


def _siigo_crear_compra_inventario(token: str, factura: dict, productos: list) -> tuple:
    """
    Registra la factura de compra en SIIGO con ítems tipo Product.
    Precio por ítem = precio_unitario (sin IVA).
    Retorna (ok: bool, mensaje: str).
    """
    from app.services.siigo import crear_factura_compra_siigo

    d = factura["datos"]
    nit = d.get("nit", "") or ""
    nit_base = nit.split("-")[0].strip() if "-" in nit else nit.strip()
    total = d.get("total_neto", 0)

    items_payload = []
    for p in productos:
        has_iva = p.get("iva", 0) > 0
        # precio_neto = subtotal/qty sin IVA; SIIGO aplica el impuesto y calcula el total real
        precio = p.get("precio_neto", p.get("precio_unitario", 0))
        items_payload.append(
            {
                "type": "Product",
                "code": p["codigo"],
                "description": p["nombre"][:100],
                "quantity": p["cantidad_min"],
                "price": precio,
                "taxes": [{"id": 3118}] if has_iva else [],
                "warehouse": {"id": 41},
            }
        )

    payload = {
        "document": {"id": 5809},
        "date": d.get("fecha", time.strftime("%Y-%m-%d")),
        "cost_center": 263,
        "supplier": {"identification": nit_base, "branch_office": 0},
        "provider_invoice": {
            "prefix": d.get("prefix") or "FV",
            "number": d.get("number", "0"),
        },
        "items": items_payload,
        "payments": [{"id": 1338, "value": total}],
        "observations": f"Compra inventario — {factura['numero']} — {d.get('proveedor', '')}",
    }

    # Calcular total con ROUND_HALF_UP por ítem (espeja la lógica interna de SIIGO)
    from decimal import Decimal, ROUND_HALF_UP

    def _rhup(x):
        return float(Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))

    total_calculado = sum(
        _rhup(_rhup(it["quantity"] * it["price"]) * (1.19 if it["taxes"] else 1.0))
        for it in items_payload
    )

    # Restar retenciones si el XML las incluye, ya que el pago final será menor
    retenciones = d.get("total_retenciones", 0)
    if retenciones > 0:
        total_calculado -= retenciones

    total_calculado = _rhup(total_calculado)

    # Validar discrepancia entre total calculado y el XML del proveedor
    diff = abs(total_calculado - total)
    LIMITE_CENTAVOS = 2.00  # diferencia admisible por redondeo DIAN
    if diff == 0:
        print(f"  [✓] Total coincide exactamente con XML: ${total_calculado:,.2f}")
    elif diff <= LIMITE_CENTAVOS:
        print(
            f"  [ℹ] Diferencia de redondeo DIAN: calculado=${total_calculado:,.2f} vs XML=${total:,.2f} "
            f"(Δ ${diff:.2f}) — se usa el valor calculado"
        )
    else:
        print(
            f"\n  ⚠️  ALERTA: Discrepancia mayor entre el total calculado y el XML del proveedor:"
        )
        print(f"     Total calculado (SIIGO) : ${total_calculado:,.2f}")
        print(f"     Total XML del proveedor : ${total:,.2f}")
        print(f"     Diferencia              : ${diff:,.2f}")
        print(f"     Revisa precios y cantidades antes de continuar.")
        confirmar = input("  ¿Registrar de todas formas? [s/n]: ").strip().lower()
        if confirmar != "s":
            return (
                False,
                f"Abortado por discrepancia de ${diff:,.2f} entre total calculado y XML.",
            )

    # Intento 1: usar el total calculado con ROUND_HALF_UP
    payload["payments"] = [{"id": 1338, "value": total_calculado}]

    print(f"\n  📤 Payload compra SIIGO:")
    print(f"     document.id   : {payload['document']['id']}")
    print(f"     cost_center   : {payload['cost_center']}")
    print(f"     supplier      : {nit_base}")
    print(f"     provider_inv  : {payload['provider_invoice']}")
    print(f"     items count   : {len(items_payload)}")
    print(f"     payment        : ${total_calculado:,.2f}  (XML: ${total:,.2f})")

    res = crear_factura_compra_siigo(payload)

    # Intento 2: SIIGO reporta su total exacto en el error → reintentar con ese valor
    # Regla: SIIGO redondea cada ítem individualmente antes de sumar, lo que puede
    # diferir en centavos de nuestro cálculo. Usamos su valor reportado para converger.
    if res.get("status") != "success":
        msg_err = res.get("message", "")
        m = re.search(r"total purchase calculated is ([\d.]+)", msg_err)
        if m:
            total_siigo_real = float(m.group(1))
            diff = abs(total_siigo_real - total)
            if (
                diff <= 1000.0
            ):  # permitir reintento si la diferencia es de hasta $1000 (discrepancias menores/redondeo)
                print(
                    f"     ↳ Ajuste de redondeo/discrepancia: XML=${total:,.2f} → SIIGO=${total_siigo_real:,.2f} "
                    f"(Δ ${diff:.2f}) — reintentando..."
                )
                payload["payments"] = [{"id": 1338, "value": total_siigo_real}]
                res = crear_factura_compra_siigo(payload)
            else:
                print(
                    f"     ↳ Diferencia de ${diff:,.2f} es demasiado grande para ajuste automático."
                )

    if res.get("status") == "success":
        data = res.get("data", {})
        siigo_id = data.get("id", "")
        nombre = data.get("name", "?")
        total_ok = data.get("total", 0)

        # Verificación post-creación: GET para confirmar que existe en SIIGO
        import requests as _req
        from app.services.siigo import PARTNER_ID as _PID

        try:
            rv = _req.get(
                f"https://api.siigo.com/v1/purchases/{siigo_id}",
                headers={"Authorization": f"Bearer {token}", "Partner-Id": _PID},
                timeout=8,
            )
            if rv.status_code == 200 and rv.json().get("id") == siigo_id:
                print(
                    f"     ↳ Verificación GET: ✓ existe en SIIGO  total=${rv.json().get('total', 0):,.2f}"
                )
            else:
                print(
                    f"     ↳ Verificación GET: ⚠️  respuesta inesperada ({rv.status_code})"
                )
        except Exception as ve:
            print(f"     ↳ Verificación GET: no disponible ({ve})")

        return True, f"Factura SIIGO {nombre} — total ${total_ok:,.2f} (ID {siigo_id})"
    else:
        msg = res.get("message", str(res))
        return False, msg[:400]


def _cli_flujo_inventario(token: str, factura: dict):
    """
    Flujo A (inventario): crea productos en SIIGO via API y registra la compra.
    Genera Excel como documentación de respaldo.
    """
    import json as _json
    from datetime import datetime as _dt
    from app.tools.importar_productos_siigo import (
        _ejecutar_procesamiento,
        cargar_proveedores_especiales,
        _RUTA_PROVEEDORES,
    )

    d = factura["datos"]
    numero = factura["numero"]
    prov = d.get("proveedor", "—")
    nit = d.get("nit", "")

    # Ofrecer agregar a lista de proveedores especiales si no está
    data_prov = cargar_proveedores_especiales()
    nit_limpio = re.sub(r"\D", "", nit or "")
    ya_existe = (
        any(
            re.sub(r"\D", "", p.get("nit", "")) == nit_limpio
            for p in data_prov.get("proveedores", [])
        )
        if nit_limpio
        else False
    )
    if not ya_existe and nit_limpio:
        resp = (
            input(
                f"\n  ¿Agregar '{prov}' a proveedores especiales de inventario? [s/n]: "
            )
            .strip()
            .lower()
        )
        if resp == "s":
            data_prov["proveedores"].append(
                {
                    "nit": nit,
                    "nombre": prov,
                    "activo": True,
                    "nota": f"Agregado terminal {_dt.now().strftime('%Y-%m-%d')}",
                }
            )
            with open(_RUTA_PROVEEDORES, "w", encoding="utf-8") as ff:
                _json.dump(data_prov, ff, indent=2, ensure_ascii=False)
            print(f"  ✓ '{prov}' guardado en proveedores_especiales.json")

    print(f"\n  ⏳ Procesando ítems de {numero}...")
    arch = _ejecutar_procesamiento(numero, d, factura["xml"], silent=True)

    if not arch:
        print(f"  ⚠️  No se encontraron ítems procesables en {numero}.")
        return

    productos = arch.get("productos", [])
    nuevos = [p for p in productos if not p.get("duplicado")]
    duplicados = [p for p in productos if p.get("duplicado")]
    SEP = "─" * 54

    print(f"\n  {SEP}")
    print(f"  📦 Productos: {len(nuevos)} nuevos   {len(duplicados)} ya en SIIGO")
    for p in productos:
        marca = "⚠️  DUPLICADO" if p.get("duplicado") else "✅ Nuevo"
        print(
            f"    [{marca}] {p['codigo']} — {p['nombre'][:45]}  ${p['precio_unitario']:.2f}/{p['unidad_min']}"
        )
    print(f"  {SEP}")

    # ── Paso 1: Asegurar proveedor ──────────────────────────────
    nit_base = nit.split("-")[0].strip() if "-" in (nit or "") else (nit or "").strip()
    print(f"\n  [1/3] Verificando proveedor en SIIGO...")
    if nit_base:
        if _asegurar_proveedor_siigo(token, nit_base, prov):
            print(f"  [✓] Proveedor listo: {prov} (NIT {nit_base})")
        else:
            print(f"  [❌] No se pudo asegurar el proveedor en SIIGO.")
            print(f"       Revisa Contactos en SIIGO y vuelve a intentar.")
            return
    else:
        print(f"  [⚠] NIT de proveedor no disponible — continuando sin verificación")

    # ── Paso 2: Crear productos nuevos ─────────────────────────
    if nuevos:
        print(f"\n  [2/3] Creando {len(nuevos)} producto(s) en SIIGO...")
        todos_ok = True
        for p in nuevos:
            label = f"{p['codigo']}: {p['nombre'][:45]}"
            print(f"    → {label:<55}", end=" ", flush=True)
            ok, msg = _siigo_crear_producto(token, p)
            if ok:
                print(f"[✓] {msg}")
            else:
                print(f"[❌] {msg}")
                todos_ok = False
        if not todos_ok:
            print(
                f"\n  ⚠️  Algunos productos no se crearon. La compra puede fallar si SIIGO no los encuentra."
            )
            cont = (
                input("  ¿Continuar igualmente con el registro de la compra? [s/n]: ")
                .strip()
                .lower()
            )
            if cont != "s":
                print(
                    f"  ↩️  Abortado. Crea los productos manualmente en SIIGO y vuelve a intentar."
                )
                return
    else:
        print(f"\n  [2/3] Sin productos nuevos — todos ya existen en SIIGO")

    # ── Paso 3: Registrar compra ────────────────────────────────
    print(f"\n  [3/3] Registrando compra en SIIGO...")
    import time as _time

    t0 = _time.time()
    ok, msg = _siigo_crear_compra_inventario(token, factura, productos)
    elapsed = _time.time() - t0

    if ok:
        print(f"\n  ✅ Compra registrada exitosamente ({elapsed:.1f}s):")
        print(f"     {msg}")
        if arch.get("ruta"):
            print(f"  📊 Excel de respaldo: {arch['ruta']}")
    else:
        print(f"\n  ❌ Error al registrar la compra en SIIGO ({elapsed:.1f}s):")
        for linea in msg.split(","):
            print(f"     {linea.strip()}")
        print(f"\n  → Fallback — carga manual:")
        if arch.get("ruta"):
            print(f"     Excel  : {arch['ruta']}")
        if arch.get("ruta_xml"):
            print(f"     XML    : {arch['ruta_xml']}")
            print(f"     SIIGO → Compras → 'Crear compra o gasto desde un XML o ZIP'")


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
    from app.tools.sincronizar_facturas_de_compra_siigo import _es_proveedor_transporte

    SEP = "─" * 58
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
        d = f["datos"]
        total = d.get("total_neto", 0)
        items = len(d.get("items", []))
        marca = " [✓ YA EN SIIGO]" if f["ya_registrada"] else ""
        alerta = " [⚠ NO ES PARA MCKG]" if not f["es_para_mckg"] else ""
        print(
            f"  [{i}] {f['numero']:<18} | {d.get('proveedor', '?')[:26]:<26} | "
            f"${total:>12,.0f} | {items} ítem(s){marca}{alerta}"
        )
    print(SEP)

    # ── Procesar una a una ─────────────────────────────────────
    total_ok = 0
    total_skip = 0

    for idx, factura in enumerate(facturas, 1):
        d = factura["datos"]
        numero = factura["numero"]
        prov = d.get("proveedor", "Desconocido")
        nit = d.get("nit", "")
        total = d.get("total_neto", 0)
        items = d.get("items", [])

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
            comprador_nit = re.sub(r"\D", "", d.get("comprador_nit", ""))
            comprador_nom = d.get("comprador_nombre", "desconocido")
            print(
                f"  🚨 Destinatario incorrecto: {comprador_nom} (NIT {comprador_nit or '—'})"
            )
            print(f"     Se descarta y no volverá a aparecer.")
            _guardar_omitida(
                {**d, "comprador_nombre": comprador_nom, "comprador_nit": comprador_nit}
            )
            total_skip += 1
            continue

        if factura["ya_registrada"]:
            doc = factura.get("doc_siigo", "?")
            print(f"  ✓ Ya registrada en SIIGO como {doc} — omitiendo.")
            total_skip += 1
            continue

        cfg_transporte = _es_proveedor_transporte(nit)
        es_especial = es_proveedor_especial(nit, prov)

        if cfg_transporte:
            # Proveedor de transporte/mensajería → gasto consumible automático
            print(
                f"  🚚 Proveedor de transporte detectado — registrando como gasto consumible...\n"
            )
            _cli_registrar_gasto(token, factura)
            total_ok += 1

        elif es_especial:
            print(f"  ✅ Proveedor en lista de materias primas.\n")
            print("  ¿Qué deseas hacer?")
            print(
                "    [1] Flujo A — Inventario (crea productos + compra en SIIGO via API)"
            )
            print("    [2] Gasto consumible  → registrar en SIIGO ahora (API)")
            print(
                "    [3] Reclasificar      → Eliminar de materias primas y registrar como gasto consumible"
            )
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
            if sel == "1":
                _cli_flujo_inventario(token, factura)
                total_ok += 1
            elif sel == "2":
                _cli_registrar_gasto(token, factura)
                total_ok += 1
            elif sel == "3":
                from app.tools.importar_productos_siigo import (
                    cargar_proveedores_especiales,
                    _RUTA_PROVEEDORES,
                )
                import json as _json

                data_prov = cargar_proveedores_especiales()
                nit_limpio = re.sub(r"\D", "", nit or "")
                nuevos_prov = []
                eliminado = False
                for p in data_prov.get("proveedores", []):
                    if re.sub(r"\D", "", p.get("nit", "")) == nit_limpio:
                        eliminado = True
                    else:
                        nuevos_prov.append(p)
                if eliminado:
                    data_prov["proveedores"] = nuevos_prov
                    with open(_RUTA_PROVEEDORES, "w", encoding="utf-8") as ff:
                        _json.dump(data_prov, ff, indent=2, ensure_ascii=False)
                    print(f"  ✓ Proveedor eliminado de la lista de materias primas.")
                _cli_registrar_gasto(token, factura)
                total_ok += 1
            else:
                print(f"  ❌ Opción '{sel}' no válida. Factura omitida.")
                total_skip += 1
                continue

        else:
            print(f"  ⚠️  Proveedor no registrado como materia prima ni transporte.\n")
            print("  ¿Cómo registrar esta factura?")
            print("    [1] Gasto consumible  → registrar en SIIGO ahora (API)")
            print(
                "    [2] Gasto inventario  → Flujo A (crea productos + compra via API)"
            )
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
            if sel == "1":
                _cli_registrar_gasto(token, factura)
                total_ok += 1
            elif sel == "2":
                _cli_flujo_inventario(token, factura)
                total_ok += 1
            else:
                print(f"  ❌ Opción '{sel}' no válida. Factura omitida.")
                total_skip += 1
                continue

        if idx < len(facturas):
            input(
                f"\n  [Enter] para continuar con la factura {idx + 1}/{len(facturas)}..."
            )

    print(f"\n{SEPP}")
    print(f"  ✅ Proceso finalizado — Registradas: {total_ok}  Omitidas: {total_skip}")
    print(f"{SEPP}\n")


# ─────────────────────────────────────────────────────────────────
#  Opción 14 — Agente de Conocimiento Científico
# ─────────────────────────────────────────────────────────────────


def _ejecutar_opcion_14():
    """
    Flujo interactivo para generar contenido científico sobre un ingrediente
    y publicarlo (o guardarlo como borrador) en WordPress mckennagroup.co.
    """
    from app.tools.knowledge_agent import generar_y_publicar_contenido

    SEP = "─" * 58
    print(f"\n{'═' * 58}")
    print("  🔬 AGENTE DE CONOCIMIENTO CIENTÍFICO")
    print(f"{'═' * 58}")
    print("  Fuentes: PubMed · ArXiv · Scrapling")
    print("  Destino: ChromaDB (preventa) + WordPress (mckennagroup.co)")
    print(SEP)

    tema = input(
        "\n  Ingrediente o tema a investigar\n  (ej: 'Ácido kójico', 'Niacinamida'): "
    ).strip()
    if not tema:
        print("  ❌ Tema vacío. Cancelando.")
        return

    print("\n  Tipo de contenido:")
    print("    [1] Post de Blog        (aplicaciones, beneficios, SEO)")
    print("    [2] Receta de formulación")
    print("    [3] Manual de uso técnico")
    print("    [4] Enriquecer ficha técnica  (actualiza Google Sheets)")
    sel_tipo = input("\n  Selección [1-4, default=1]: ").strip() or "1"

    tipos = {"1": "post_blog", "2": "receta", "3": "manual_uso", "4": "ficha"}
    tipo = tipos.get(sel_tipo, "post_blog")

    print("\n  ¿Publicar en WordPress?")
    print("    [1] Guardar como borrador  (puedes revisar antes de publicar)")
    print("    [2] Publicar directamente")
    print("    [3] Solo generar  (no subir a WP)")
    sel_wp = input("\n  Selección [1-3, default=1]: ").strip() or "1"

    publicar = sel_wp in ("1", "2")
    estado_wp = "publish" if sel_wp == "2" else "draft"

    enriquecer_sheets = False
    nombre_sheets = ""
    if tipo == "ficha":
        act = (
            input(f"\n  ¿Actualizar ficha en Google Sheets para '{tema}'? [s/n]: ")
            .strip()
            .lower()
        )
        if act == "s":
            enriquecer_sheets = True
            nombre_sheets_raw = input(
                f"  Nombre exacto en Sheets (Enter = '{tema}'): "
            ).strip()
            nombre_sheets = nombre_sheets_raw or tema

    print(f"\n{SEP}")
    resultado = generar_y_publicar_contenido(
        tema=tema,
        tipo=tipo,
        publicar=publicar,
        estado_wp=estado_wp,
        enriquecer_sheets=enriquecer_sheets,
        nombre_producto_sheets=nombre_sheets,
        verbose=True,
    )

    print(f"\n{SEP}")
    if resultado.get("ok"):
        print(f"  ✅ Contenido generado ({len(resultado.get('contenido', ''))} chars)")
        if resultado.get("wp_url"):
            print(f"  🌐 WordPress {resultado['wp_estado']}: {resultado['wp_url']}")
        if resultado.get("fuentes"):
            print(f"  📚 Fuentes científicas usadas:")
            for url in resultado["fuentes"][:5]:
                print(f"     • {url}")
        print(f"\n  💡 Guardado en ChromaDB — el agente lo usará en preventa MeLi")
    else:
        print(f"  ❌ Error: {resultado.get('mensaje', 'desconocido')}")
    print(f"{'═' * 58}\n")


# ─────────────────────────────────────────────────────────────────
#  Menú principal
# ─────────────────────────────────────────────────────────────────


def mostrar_menu():
    """Imprime el menú principal de opciones en la consola."""
    W = 62
    print("\n" + "═" * W)
    print("  🛠️  CENTRO DE MANDO — McKenna Group S.A.S.")
    print("═" * W)
    print("  1. 💬 CHAT         Conversa directo con el Agente (Hugo IA)")
    print("  2. 🔄 FACTURAS     Sync facturas MeLi ↔ Siigo — elige período")
    print("  3. 📊 STOCK        Reporte y sync de inventario entre plataformas")
    print("  4. 🔍 CONSULTA     Busca un producto en el catálogo de Google Sheets")
    print("  5. 🎓 APRENDIZAJE  Fuerza aprendizaje de Q&A recientes en MeLi")
    print("  6. 🧾 COMPRAS      Registra facturas de compra en SIIGO desde Gmail")
    print("  7. 🔬 CIENCIA      Genera contenido científico y publica en WordPress")
    print("  8. 🚪 SALIR        Apagar el Centro de Mando")
    print("═" * W)


def _submenu_facturas():
    """Submenú de sincronización de facturas MeLi ↔ Siigo."""
    W = 62
    print(f"\n{'─' * W}")
    print("  🔄 SYNC FACTURAS — ¿qué período quieres sincronizar?")
    print(f"{'─' * W}")
    print("  [1] Inteligente    Cruza pendientes MeLi vs Siigo (recomendado)")
    print("  [2] Últimas 24 h   Facturas emitidas en el último día")
    print("  [3] Últimos N días Tú ingresas cuántos días atrás buscar")
    print("  [4] Fecha exacta   Tú ingresas la fecha (AAAA-MM-DD)")
    print("  [5] Por Pack ID    Sincroniza una venta/pack específico")
    print("  [0] Volver al menú principal")
    print(f"{'─' * W}")
    sel = input("  Selección [0-5]: ").strip()
    if sel == "0":
        return
    elif sel == "1":
        print(sincronizar_inteligente())
    elif sel == "2":
        print(sincronizar_facturas_recientes(dias=1))
    elif sel == "3":
        try:
            dias = int(input("  ¿Cuántos días atrás? [ej: 7]: ").strip())
        except ValueError:
            print("  ❌ Número inválido.")
            return
        print(sincronizar_facturas_recientes(dias=dias))
    elif sel == "4":
        fecha = input("  Fecha (AAAA-MM-DD): ").strip()
        print(sincronizar_por_dia_especifico(fecha))
    elif sel == "5":
        pack_id = input("  Pack ID: ").strip()
        print(sincronizar_manual_por_id(pack_id))
    else:
        print("  ❌ Opción no válida.")


def _submenu_stock():
    """Submenú de stock e inventario entre plataformas."""
    W = 62
    print(f"\n{'─' * W}")
    print("  📊 STOCK — ¿qué operación de inventario quieres ejecutar?")
    print(f"{'─' * W}")
    print("  [1] Reporte completo   Sync total MeLi y reporte de stock por WhatsApp")
    print("  [2] Verificar SKUs     Auditoría de sincronización SKUs MeLi / SIIGO")
    print("  [3] Sincronizar Web    Sincroniza el catálogo de MeLi hacia la página web")
    print("  [0] Volver al menú principal")
    print(f"{'─' * W}")
    sel = input("  Selección [0-3]: ").strip()
    if sel == "0":
        return
    elif sel == "1":
        print(ejecutar_sincronizacion_y_reporte_stock())
    elif sel == "2":
        print("\n🔍 Verificando sincronización de SKUs entre plataformas...")
        print(verificar_sync_skus(notificar_wa=True))
    elif sel == "3":
        print("\n🌐 Iniciando proceso de sincronización con la página web...")
        # Aquí implementaríamos la obtención de productos de MeLi. Por ahora un mock:
        print("Obteniendo productos de MercadoLibre (Mock)...")
        productos_mock = [
            {"sku": "SKU-TEST-1", "stock": 10, "precio": 15000},
            {"sku": "SKU-TEST-2", "stock": 5, "precio": 25000},
        ]
        print(sincronizar_productos_pagina_web(productos_mock))
    else:
        print("  ❌ Opción no válida.")


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
        opcion = input("  Seleccione una opción (1-8): ").strip()

        if opcion == "1":
            print(
                "\n--- 💬 MODO CHAT ACTIVADO (Escribe 'salir' o 'menu' para volver) ---"
            )
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
            _submenu_facturas()
        elif opcion == "3":
            _submenu_stock()
        elif opcion == "4":
            producto = input("🔍 Nombre del producto a buscar: ").strip()
            print(leer_datos_hoja(producto))
        elif opcion == "5":
            print(aprender_de_interacciones_meli())
        elif opcion == "6":
            _ejecutar_opcion_10()
        elif opcion == "7":
            _ejecutar_opcion_14()
        elif opcion == "8":
            print("👋 Apagando el Centro de Mando...")
            break
        else:
            print("  ❌ Opción no válida. Ingresa un número del 1 al 8.")
