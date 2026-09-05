"""
Integración con Alegra (Contabilidad Pro) — reemplazo de Siigo.

Mismo patrón de `app/services/siigo.py`: funciones espejo con el mismo shape de
entrada/salida donde es posible, para que los call-sites (`meli_autofactura_entrega.py`,
`web_pedidos.py`) cambien solo el import, no la lógica de negocio.

Auth: Basic Auth (email + token API), no OAuth como Siigo — no hay "renovar token".
Doc base: https://developer.alegra.com/reference (confirmado en vivo, sep-2026).

PENDIENTE DE VALIDAR CON CREDENCIALES REALES (marcado inline con TODO):
  - Nombre exacto del campo con la URL/base64 del PDF en la respuesta de GET /invoices/{id}
    (la doc pública no lo deja 100% claro sin una cuenta real para probar).
  - IDs reales de: numberTemplate (talonario), tax IVA 19%, y el mapeo de
    ALEGRA_PAYMENT_METHOD por defecto — hay que sacarlos de la cuenta de Alegra
    ya activada (Configuración → Facturación / Impuestos) antes de ir a producción.

PENDIENTE — checklist "Importación de ítems" de Alegra (decisión de negocio, no
técnica, 2026-09-03): los 234 productos + 268 combos importados NO tienen
`unitCost` ni cantidad inicial de inventario, así que esa casilla del onboarding
de Alegra sigue sin marcarse. Deliberadamente no se completó con datos
inventados:
  - Cantidad inicial: no hay ningún stock real confiable para cargar — el stock
    vive en Google Sheets/MeLi, nunca en Siigo/Alegra (mismo principio ya
    documentado en CLAUDE.md: "Sin sincronización SIIGO-stock").
  - Costo unitario: solo 209 de 1.797 productos en `construir_catalogo_costos()`
    tienen un precio de compra histórico real, y varios de esos valores se ven
    como error de captura (ej. "$1"). No es base suficiente para completar el
    catálogo completo de forma honesta.
Antes de tocar esto hace falta decidir si McKenna va a llevar inventario vivo
en Alegra (cambio de arquitectura) y que alguien haga un conteo/costeo real —
no es un simple Excel por generar.
"""

import base64
import json
import os
from datetime import datetime, timedelta

import requests

_ALEGRA_BASE = "https://api.alegra.com/api/v1"

NIT_CONSUMIDOR_FINAL_MELI = (os.getenv("SIIGO_MELI_NIT_CONSUMIDOR_FINAL", "222222222222") or "222222222222").strip()
NOMBRE_CONSUMIDOR_FINAL_MELI = "Consumidor Final"

_contacto_cache: dict[str, str] = {}  # identificacion -> alegra contact id (proceso actual)
_producto_cache: dict[str, dict] = {}  # sku -> {"id":..., "price":...} (proceso actual)


def _nombre_mayusculas_alegra(nombre: str, *, max_len: int = 150) -> str:
    """Nombres de ítems en Alegra: MAYÚSCULAS, con unidades `mL` y `g` en esa grafía.

    Ej.: ``urea 250 g`` → ``UREA 250 g``; ``aceite 30ml`` → ``ACEITE 30mL``.
    """
    import re

    s = (nombre or "").strip().upper()
    if not s:
        return ""
    # Tras upper(), las unidades quedan ML / G; restaurar solo si van tras un número.
    s = re.sub(r"(\d)(\s*)ML\b", r"\1\2mL", s)
    s = re.sub(r"(\d)(\s*)G\b", r"\1\2g", s)
    return s[:max_len]


def _env_int(nombre: str, default: int | None = None) -> int | None:
    raw = (os.getenv(nombre) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _alegra_headers() -> dict:
    email = (os.getenv("ALEGRA_EMAIL") or "").strip()
    token = (os.getenv("ALEGRA_TOKEN") or "").strip()
    if not email or not token:
        raise RuntimeError("Faltan ALEGRA_EMAIL / ALEGRA_TOKEN en el entorno.")
    b64 = base64.b64encode(f"{email}:{token}".encode()).decode()
    return {
        "Authorization": f"Basic {b64}",
        "Content-Type": "application/json",
    }


def creds_alegra_configuradas() -> bool:
    """True si hay email+token en el entorno — no pega a la API (sirve para /status)."""
    return bool((os.getenv("ALEGRA_EMAIL") or "").strip() and (os.getenv("ALEGRA_TOKEN") or "").strip())


def autenticar_alegra() -> bool:
    """No hay token que renovar (Basic Auth); valida que las credenciales sirven."""
    try:
        headers = _alegra_headers()
    except RuntimeError as e:
        print(f"⚠️ Alegra: {e}")
        return False
    try:
        res = requests.get(f"{_ALEGRA_BASE}/company", headers=headers, timeout=15)
        return res.status_code == 200
    except requests.RequestException as e:
        print(f"⚠️ Alegra: error de red validando credenciales: {e}")
        return False


# Un, mL, g del panel McKenna → unidades de inventario de Alegra (Colombia).
# La doc escribe "mililiter" (una L) — no "milliliter".
_ALEGRA_UNIDAD_DESDE_MIN = {"Un": "unit", "mL": "mililiter", "g": "gram"}


def listar_centros_costo_alegra() -> tuple[list | None, str | None]:
    """Centros de costo activos en Alegra (GET /cost-centers). Mismo shape que
    `listar_centros_costo_siigo`: [{id, code, name, active}]."""
    try:
        headers = _alegra_headers()
    except RuntimeError as e:
        return None, str(e)

    centros: list[dict] = []
    start = 0
    while True:
        try:
            res = requests.get(
                f"{_ALEGRA_BASE}/cost-centers",
                headers=headers,
                params={"limit": 30, "start": start},
                timeout=15,
            )
        except requests.RequestException as e:
            return None, f"Error de red: {e}"
        if res.status_code != 200:
            return None, f"Alegra respondió {res.status_code}"
        lote = res.json() or []
        if isinstance(lote, dict):
            lote = lote.get("data") or lote.get("results") or []
        if not lote:
            break
        for c in lote:
            if not isinstance(c, dict):
                continue
            status = str(c.get("status") or "active").lower()
            centros.append({
                "id": c.get("id"),
                "code": c.get("code") or c.get("id"),
                "name": c.get("name") or "",
                "active": status in ("active", "1", "true"),
            })
        if len(lote) < 30:
            break
        start += 30
    centros.sort(key=lambda x: (str(x.get("code") or ""), str(x.get("name") or "")))
    return centros, None


def buscar_producto_alegra_por_referencia(sku: str):
    """Busca un producto en Alegra por su `reference` (equivalente al `code` de Siigo).
    Retorna {"id":..., "name":..., "price": float} o None si no existe."""
    sku = (sku or "").strip()
    if not sku:
        return None
    if sku in _producto_cache:
        return _producto_cache[sku]
    headers = _alegra_headers()
    res = requests.get(
        f"{_ALEGRA_BASE}/items", headers=headers,
        params={"reference": sku, "limit": 5}, timeout=15,
    )
    if res.status_code != 200:
        return None
    resultados = res.json() or []
    if not resultados:
        return None
    item = resultados[0]
    precio = 0.0
    precios = item.get("price") or []
    if precios and isinstance(precios, list):
        precio = float(precios[0].get("price") or 0)
    impuestos = item.get("tax") or []
    tax_ids = [t.get("id") for t in impuestos if t.get("id")]
    tax_rate_total = sum(float(t.get("percentage") or 0) for t in impuestos)
    unidad = (item.get("inventory") or {}).get("unit") or ""
    out = {
        # Claves en inglés (usadas internamente por crear_factura_venta_alegra):
        "id": item.get("id"), "name": item.get("name"), "price": precio,
        "tax_ids": tax_ids, "tax_rate_total": tax_rate_total,
        # Alias en español — mismo shape que devolvía buscar_producto_siigo_por_sku,
        # para que los consumidores existentes (google_services.py, sync.py,
        # relacion_codigos_meli_siigo.py, precios_canales.py) no necesiten reescribirse:
        "sku": sku, "nombre": item.get("name"), "precio": precio, "unidad": unidad,
        "referencia": item.get("reference", sku), "stock_siigo": None,
    }
    _producto_cache[sku] = out
    return out


def _precio_base_con_impuesto(precio_final: float, tax_rate_total: float) -> float:
    """El precio de venta (MeLi/checkout web) ya incluye IVA — Alegra necesita el
    precio ANTES de impuestos en `price` cuando se manda `tax` explícito, si no
    la factura sale sumando el IVA por encima del precio que pagó el cliente
    (bug confirmado en vivo el 2026-09-02: FE1 salió en $4.522 en vez de $3.800).
    Misma fórmula que `precio_base_con_impuesto` en app/services/siigo.py."""
    from decimal import ROUND_HALF_UP, Decimal

    if not tax_rate_total:
        return precio_final
    base = Decimal(str(precio_final)) / (Decimal("1") + Decimal(str(tax_rate_total)) / Decimal("100"))
    return float(base.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _nombre_object_persona(nombre: str) -> dict:
    """Alegra exige `nameObject` (firstName/lastName) para kindOfPerson
    PERSON_ENTITY — `name` solo no basta (confirmado en vivo 2026-09-04:
    POST /contacts sin nameObject devuelve 400 "El campo nameObject es
    obligatorio". LEGAL_ENTITY sí acepta solo `name`, no hace falta ahí)."""
    partes = (nombre or "").strip().split(None, 1)
    if not partes:
        return {"firstName": NOMBRE_CONSUMIDOR_FINAL_MELI}
    if len(partes) == 1:
        return {"firstName": partes[0]}
    return {"firstName": partes[0], "lastName": partes[1]}


def _resolver_o_crear_contacto_alegra(
    *, nombre: str, identificacion: str, email: str = "", telefono: str = "", direccion: str = "",
) -> tuple[str | None, str]:
    """Busca un contacto por identificación; si no existe, lo crea. Retorna
    (id_de_alegra, error) — error vacío si ok. El detalle de error se propaga
    al operador (panel Cotizar/Facturar) en vez de quedarse solo en el print
    de consola, que se puede perder si el proceso se reinicia justo después."""
    identificacion = "".join(ch for ch in str(identificacion or "") if ch.isdigit())
    if not identificacion:
        return None, "Identificación vacía."
    if identificacion in _contacto_cache:
        return _contacto_cache[identificacion], ""

    try:
        headers = _alegra_headers()
    except RuntimeError as e:
        return None, str(e)

    try:
        res = requests.get(
            f"{_ALEGRA_BASE}/contacts", headers=headers,
            params={"identification": identificacion, "limit": 5}, timeout=15,
        )
    except requests.RequestException as e:
        return None, f"Error de red consultando el contacto en Alegra: {e}"

    if res.status_code == 200:
        resultados = res.json() or []
        if resultados:
            cid = str(resultados[0].get("id"))
            # Si el tercero ya existe, actualizar con los datos frescos del checkout
            # antes de facturar — si no, la FE sale con dirección/correo viejos de la
            # ficha (mismo bug ya documentado para Siigo en sincronizar_tercero_siigo_antes_factura_web).
            # PUT de /contacts exige 'name' e 'identificationObject' siempre presentes,
            # aunque no cambien — no es un PATCH parcial real (confirmado en vivo).
            update_payload: dict = {
                "name": nombre or NOMBRE_CONSUMIDOR_FINAL_MELI,
                "nameObject": _nombre_object_persona(nombre),
                "identificationObject": {
                    "type": "CC" if len(identificacion) <= 10 else "NIT",
                    "number": identificacion,
                },
                "kindOfPerson": "PERSON_ENTITY",
                "regime": "SIMPLIFIED_REGIME",
            }
            if email:
                update_payload["email"] = email
            if telefono:
                update_payload["phonePrimary"] = telefono
            if direccion:
                # `address.address` sin `department` (catálogo Alegra) devuelve
                # 400 "El departamento es inválido" (confirmado en vivo
                # 2026-09-04) — el panel solo captura dirección en texto libre,
                # sin departamento, así que se guarda en observations en vez de
                # bloquear la creación/actualización del contacto.
                update_payload["observations"] = f"Dirección: {direccion}"
            if update_payload:
                try:
                    requests.put(f"{_ALEGRA_BASE}/contacts/{cid}", headers=headers, json=update_payload, timeout=15)
                except requests.RequestException:
                    pass
            _contacto_cache[identificacion] = cid
            return cid, ""
    elif res.status_code != 404:
        print(
            f"⚠️ Alegra: GET /contacts?identification={identificacion} devolvió "
            f"HTTP {res.status_code}: {res.text[:300]}",
            flush=True,
        )
        return None, f"Alegra rechazó la búsqueda del contacto (HTTP {res.status_code}): {res.text[:300]}"

    payload = {
        "name": nombre or NOMBRE_CONSUMIDOR_FINAL_MELI,
        "nameObject": _nombre_object_persona(nombre),
        "identificationObject": {
            "type": "CC" if len(identificacion) <= 10 else "NIT",
            "number": identificacion,
        },
        "kindOfPerson": "PERSON_ENTITY",
        "regime": "SIMPLIFIED_REGIME",
    }
    if email:
        payload["email"] = email
    if telefono:
        payload["phonePrimary"] = telefono
    if direccion:
        # Ver nota equivalente arriba (update_payload) — mismo motivo.
        payload["observations"] = f"Dirección: {direccion}"

    try:
        res = requests.post(f"{_ALEGRA_BASE}/contacts", headers=headers, json=payload, timeout=20)
    except requests.RequestException as e:
        return None, f"Error de red creando el contacto en Alegra: {e}"
    if res.status_code not in (200, 201):
        detalle = res.text[:300]
        print(f"⚠️ Alegra: no se pudo crear contacto {identificacion}: {detalle}", flush=True)
        return None, f"Alegra rechazó el contacto (HTTP {res.status_code}): {detalle}"
    cid = str(res.json().get("id"))
    _contacto_cache[identificacion] = cid
    return cid, ""


def crear_factura_venta_alegra(
    *,
    nombre_cliente: str,
    identificacion: str,
    direccion_envio: str,
    productos: list[dict],
    total: float,
    email: str = "",
    telefono: str = "",
    observaciones: str = "",
    purchase_order: str = "",
    descargar_pdf: bool = True,
    enviar_dian: bool = True,
    enviar_correo: bool = False,
    **_compat,  # absorbe kwargs propios de Siigo (document_id, seller_id, payment_id, customer_*_code)
) -> dict:
    """
    Espejo de `crear_factura_venta_siigo` — mismo shape de `productos` y de retorno,
    para minimizar cambios en los call-sites.

    `productos`: [{"codigo": "SKU", "nombre": "...", "cantidad": 1, "precio_unitario": 1000}]
    (el `tax_ids` de Siigo no aplica igual acá — el IVA de cada línea sale
    ÚNICAMENTE de lo que el producto tenga configurado en Alegra; un producto
    con `tax: []` — ej. envío — factura sin IVA, sin fallback a un tax id
    global. Ver nota en el bucle de abajo, caso FE29).
    """
    try:
        headers = _alegra_headers()
    except RuntimeError as e:
        return {"ok": False, "error": str(e)}

    if not productos:
        return {"ok": False, "error": "La factura no tiene productos."}

    nombre_cliente = (nombre_cliente or "").strip()
    identificacion_digits = "".join(ch for ch in str(identificacion or "") if ch.isdigit())
    if not nombre_cliente or not identificacion_digits:
        return {"ok": False, "error": "Faltan nombre o identificación del cliente."}

    contacto_id, error_contacto = _resolver_o_crear_contacto_alegra(
        nombre=nombre_cliente, identificacion=identificacion_digits,
        email=email, telefono=telefono, direccion=direccion_envio,
    )
    if not contacto_id:
        detalle = f" {error_contacto}" if error_contacto else ""
        return {
            "ok": False,
            "error": f"No se pudo resolver/crear el contacto {identificacion_digits} en Alegra.{detalle}",
        }

    items = []
    for p in productos:
        codigo = str(p.get("codigo") or "").strip()
        nombre = str(p.get("nombre") or "").strip()
        try:
            cantidad = float(p.get("cantidad", 1))
            precio_unitario = float(p.get("precio_unitario", 0))
        except (TypeError, ValueError):
            return {"ok": False, "error": f"Cantidad/precio inválido para {nombre or codigo}."}
        if not codigo or cantidad <= 0 or precio_unitario < 0:
            return {"ok": False, "error": f"Línea inválida para factura: {p!r}"}

        producto_alegra = buscar_producto_alegra_por_referencia(codigo)
        if not producto_alegra:
            return {
                "ok": False,
                "error": f"No puedo emitir factura automática: {nombre} ({codigo}): no existe en Alegra.",
            }

        # El precio que llega (MeLi/checkout web) ya incluye IVA — hay que sacarlo antes
        # de mandarlo, si no Alegra lo suma OTRA VEZ encima (bug confirmado en vivo:
        # FE1 salió en $4.522 en vez de $3.800 por no hacer esta conversión).
        #
        # OJO: NO caer a `tax_id` (ALEGRA_IVA_TAX_ID) cuando `tax_ids` viene
        # vacío — un producto con `tax: []` en Alegra está intencionalmente
        # exento (ej. envío: WEB-ENVIO-18000/VAR no lleva IVA en venta directa
        # web/WhatsApp), no es "no sabemos, asumamos 19%". Bug confirmado en
        # vivo (FE29, 2026-09-04): el fallback le metió IVA al envío y la
        # factura salió en $212.850 en vez de los $209.430 cotizados — el
        # propio producto en Alegra ya traía `tax: []` correctamente.
        producto_tax_ids = producto_alegra.get("tax_ids") or []
        producto_tax_rate = producto_alegra.get("tax_rate_total") or 0
        precio_base = (
            _precio_base_con_impuesto(precio_unitario, producto_tax_rate)
            if producto_tax_ids else precio_unitario
        )

        item = {
            "id": producto_alegra["id"],
            "price": precio_base,
            "quantity": cantidad,
        }
        # OJO: la unidad de medida NO se resuelve por un campo en la línea de factura —
        # confirmado en vivo (2026-09-02) que Alegra la lee de la ficha del producto
        # (`inventory.unit`). Si el producto no la tiene, el timbrado falla con
        # "El campo items.0.unit es requerido" aunque la línea traiga cualquier valor.
        if producto_tax_ids:
            item["tax"] = [{"id": tid} for tid in producto_tax_ids]
        items.append(item)

    hoy = datetime.now().strftime("%Y-%m-%d")
    vence = (datetime.now() + timedelta(days=int(os.getenv("ALEGRA_DUE_DAYS", "0") or 0))).strftime("%Y-%m-%d")

    payload = {
        "date": hoy,
        "dueDate": vence,
        "client": {"id": contacto_id},
        "items": items,
        "paymentForm": os.getenv("ALEGRA_PAYMENT_FORM", "CASH"),
        # Confirmado en vivo (2026-09-02): debe ir en mayúsculas, "cash" minúscula da
        # 400 "El método de pago no es válido".
        "paymentMethod": os.getenv("ALEGRA_PAYMENT_METHOD", "CASH"),
        "stamp": {"generateStamp": bool(enviar_dian)},
    }
    template_id = _env_int("ALEGRA_NUMBER_TEMPLATE_ID")  # TODO: confirmar talonario real
    if template_id:
        payload["numberTemplate"] = {"id": template_id}
    if observaciones:
        payload["observations"] = observaciones[:500]
    if purchase_order:
        payload["anotation"] = purchase_order

    # MeLi y pedidos web ya vienen pagados (el comprador paga digital antes de
    # que se entregue/facture) — registrar el pago en el mismo POST evita que
    # la factura quede "Por cobrar" en Alegra. Cuenta configurable porque no
    # hay una cuenta "Mercado Pago"/pasarela dedicada creada todavía (usa
    # Banco 1 = id 3 por defecto; ajustar cuando el contador cree una cuenta
    # específica para cobros MeLi/web).
    if total and float(total) > 0:
        payload["payments"] = [{
            "date": hoy,
            "account": {"id": os.getenv("ALEGRA_CUENTA_COBRO_ID", "3")},
            "amount": round(float(total), 2),
            "paymentMethod": os.getenv("ALEGRA_PAYMENT_METHOD_COBRO", "transfer"),
        }]

    try:
        res = requests.post(f"{_ALEGRA_BASE}/invoices", headers=headers, json=payload, timeout=20)
        if res.status_code not in (200, 201):
            return {
                "ok": False,
                "status_code": res.status_code,
                "error": f"Error al crear factura en Alegra: {res.text[:1000]}",
                "payload": payload,
            }

        factura = res.json()
        factura_id = factura.get("id")
        factura_numero = factura.get("numberTemplate", {}).get("fullNumber") or factura.get("number")

        stamp = factura.get("stamp") or {}
        estado = (stamp.get("status") or factura.get("status") or "").strip()
        cufe = stamp.get("cufe") or stamp.get("uuid") or ""

        pdf_path = None
        pdf_b64 = None
        if descargar_pdf and factura_id:
            pdf_b64 = descargar_factura_pdf_alegra(str(factura_id))
            if pdf_b64:
                pdf_dir = "facturas_descargadas"
                os.makedirs(pdf_dir, exist_ok=True)
                pdf_path = os.path.join(pdf_dir, f"Factura_{factura_numero or factura_id}.pdf")
                try:
                    with open(pdf_path, "wb") as f:
                        f.write(base64.b64decode(pdf_b64))
                except Exception as e:
                    print(f"⚠️ No se pudo guardar PDF Alegra {factura_id}: {e}")
                    pdf_path = None

        return {
            "ok": True,
            "invoice_id": factura_id,
            "number": factura_numero,
            "status": estado,
            "cufe": cufe,
            "stamp": stamp,
            "url": f"https://app.alegra.com/invoice/view/id/{factura_id}" if factura_id else "",
            "pdf_path": pdf_path,
            # Base64 crudo (mismo que queda en pdf_path) — para call-sites que necesitan
            # subirlo a otro sistema (ej. subir_factura_meli) sin releer el archivo local.
            "pdf_base64": pdf_b64,
            "data": factura,
            "payload": payload,
        }
    except requests.RequestException as e:
        return {"ok": False, "error": f"Error de red con Alegra: {e}"}
    except Exception as e:
        return {"ok": False, "error": f"Error crítico creando factura Alegra: {e}"}


def _resolver_template_nota_credito_alegra(headers: dict) -> str | None:
    """Talonario de notas crédito a usar. Prioridad: override por env, luego el
    talonario con prefijo "NC" (el que ya usó el operador a mano para NC1 el
    2026-09-03 — id 17 en esta cuenta), y si no existe, el marcado isDefault."""
    override = _env_int("ALEGRA_CREDIT_NOTE_TEMPLATE_ID")
    if override:
        return str(override)
    try:
        res = requests.get(
            f"{_ALEGRA_BASE}/number-templates", headers=headers,
            params={"documentType": "creditNote"}, timeout=15,
        )
        if res.status_code != 200:
            return None
        templates = res.json() or []
    except requests.RequestException:
        return None
    con_prefijo_nc = next((t for t in templates if (t.get("prefix") or "").upper() == "NC"), None)
    if con_prefijo_nc:
        return str(con_prefijo_nc["id"])
    por_defecto = next((t for t in templates if t.get("isDefault")), None)
    return str(por_defecto["id"]) if por_defecto else None


def _revertir_pagos_factura_alegra(headers: dict, factura: dict) -> tuple[bool, str]:
    """
    Elimina los pagos registrados de una factura vía DELETE /payments/{id}.

    Necesario antes de poder anularla: Alegra rechaza una nota crédito
    `VOID_ELECTRONIC_INVOICE` con error 9030 ("El monto a aplicar de una de
    las facturas es superior al total por pagar") si la factura ya está
    `closed`/balance 0 — confirmado en vivo (2026-09-03) intentando anular
    FE2 sin este paso. `crear_factura_venta_alegra` registra el pago de MeLi/
    web en el mismo POST de la factura (para que no quede "por cobrar"), así
    que toda factura de este flujo llega aquí con balance 0 y necesita este
    paso. Cada pago queda ligado 1:1 a su factura (un solo `amount` = total),
    nunca es un pago combinado de varias facturas — ver payload de
    `crear_factura_venta_alegra` — así que borrarlo no afecta otras facturas.
    """
    pagos = factura.get("payments") or []
    if not pagos:
        return True, ""
    fallidos = []
    for pago in pagos:
        pago_id = pago.get("id")
        if not pago_id:
            continue
        try:
            res = requests.delete(f"{_ALEGRA_BASE}/payments/{pago_id}", headers=headers, timeout=20)
        except requests.RequestException as e:
            fallidos.append(f"pago {pago_id}: error de red ({e})")
            continue
        if res.status_code not in (200, 204, 404):
            fallidos.append(f"pago {pago_id}: {res.status_code} - {res.text[:200]}")
    if fallidos:
        return False, "; ".join(fallidos)
    return True, ""


def crear_nota_credito_alegra(
    *,
    factura_id: str,
    motivo: str = "",
    enviar_dian: bool = True,
) -> dict:
    """
    Anula por completo una factura de Alegra ya emitida — espejo de
    `crear_nota_credito_siigo(reason=2)` ("anulación de factura electrónica").
    Confirmado en vivo (2026-09-03, NC1 sobre FE1): el `type` de Colombia para
    esto es el literal "VOID_ELECTRONIC_INVOICE" (no está documentado en la
    referencia pública de Alegra — se confirmó leyendo la nota crédito ya
    creada a mano por el operador vía GET /credit-notes).

    A diferencia de Siigo, no hace falta pasar items/cliente/warehouse: se
    leen de la factura original vía GET /invoices/{id} para que la nota
    crédito quede idéntica a la factura (mismo cliente, mismos ítems/precio/
    impuesto, misma bodega) — cualquier discrepancia ahí hace que Alegra
    rechace el enlace factura↔nota o el timbrado ante la DIAN.

    Si la factura ya está pagada (balance 0 — el caso normal de este flujo,
    ver `_revertir_pagos_factura_alegra`), primero elimina sus pagos: Alegra
    no permite enlazar una nota crédito de anulación total a una factura sin
    saldo pendiente.
    """
    try:
        headers = _alegra_headers()
    except RuntimeError as e:
        return {"ok": False, "error": str(e)}

    factura_id = str(factura_id or "").strip()
    if not factura_id:
        return {"ok": False, "error": "Falta factura_id de la factura a anular."}

    try:
        res = requests.get(f"{_ALEGRA_BASE}/invoices/{factura_id}", headers=headers, timeout=20)
    except requests.RequestException as e:
        return {"ok": False, "error": f"Error de red consultando la factura: {e}"}
    if res.status_code != 200:
        return {
            "ok": False,
            "error": f"No se pudo leer la factura {factura_id}: {res.status_code} - {res.text[:300]}",
        }
    factura = res.json()

    client_id = (factura.get("client") or {}).get("id")
    items_factura = factura.get("items") or []
    total = factura.get("total")
    warehouse_id = (factura.get("warehouse") or {}).get("id")
    if not client_id or not items_factura or total is None:
        return {"ok": False, "error": f"La factura {factura_id} no trae cliente/ítems/total — no se puede anular."}

    # Cualquier pago registrado reduce el saldo por debajo del total de la
    # factura, y Alegra rechaza (código 9030) una NC de anulación total cuyo
    # `amount` (= total de la factura) supere ese saldo — pasa tanto con
    # balance 0 (caso normal, pago = total) como con balance parcial (ej.
    # FE29: se pagó el total COTIZADO, pero la factura salió más alta por un
    # bug de IVA, dejando balance > 0 pero < total). Por eso no se condiciona
    # a `balance == 0`: si hay pagos, se revierten siempre antes de anular.
    if factura.get("payments"):
        ok_pagos, err_pagos = _revertir_pagos_factura_alegra(headers, factura)
        if not ok_pagos:
            return {"ok": False, "error": f"No se pudo liberar el saldo de la factura para anularla: {err_pagos}"}

    items_nc = []
    for it in items_factura:
        item = {"id": it.get("id"), "price": it.get("price"), "quantity": it.get("quantity")}
        taxes = [{"id": t.get("id")} for t in (it.get("tax") or []) if t.get("id")]
        if taxes:
            item["tax"] = taxes
        items_nc.append(item)

    template_id = _resolver_template_nota_credito_alegra(headers)
    hoy = datetime.now().strftime("%Y-%m-%d")

    payload = {
        "date": hoy,
        "client": {"id": client_id},
        "items": items_nc,
        "type": "VOID_ELECTRONIC_INVOICE",
        "invoices": [{"id": factura_id, "amount": total}],
        "stamp": {"generateStamp": bool(enviar_dian)},
    }
    if template_id:
        payload["numberTemplate"] = {"id": template_id}
    if warehouse_id:
        payload["warehouse"] = {"id": warehouse_id}
    if motivo:
        payload["observations"] = motivo[:500]

    try:
        res = requests.post(f"{_ALEGRA_BASE}/credit-notes", headers=headers, json=payload, timeout=20)
    except requests.RequestException as e:
        return {"ok": False, "error": f"Error de red creando la nota crédito: {e}"}
    if res.status_code not in (200, 201):
        return {
            "ok": False,
            "status_code": res.status_code,
            "error": f"Error al crear nota crédito en Alegra: {res.text[:1000]}",
            "payload": payload,
        }

    nc = res.json()
    stamp = nc.get("stamp") or {}
    numero = (nc.get("numberTemplate") or {}).get("fullNumber")
    return {
        "ok": True,
        "nc_id": nc.get("id"),
        "numero": numero,
        "status": stamp.get("legalStatus") or nc.get("status"),
        "cufe": stamp.get("cufe") or "",
        "url": f"https://app.alegra.com/credit-note/view/id/{nc.get('id')}" if nc.get("id") else "",
        "data": nc,
        "payload": payload,
        # Alias con las claves de `crear_nota_credito_siigo` — para que call-sites
        # que ya manejan ambos proveedores (ver scripts/emitir_notas_credito_cron.py)
        # no necesiten dos ramas de lectura del resultado.
        "credit_note_id": nc.get("id"),
        "name": numero,
        "number": (nc.get("numberTemplate") or {}).get("formattedNumber"),
        "cude": stamp.get("cufe") or "",
        "total": nc.get("total"),
    }


def descargar_factura_pdf_alegra(factura_id: str) -> str:
    """Retorna el PDF en base64, o "" si falla.

    Confirmado en vivo (2026-09-03): NO viene en `stamp` (no tiene `fileB64`/
    `pdf`/`file` — la suposición original, nunca validada, estaba mal y dejó
    `pdf_subido_meli=False` en las primeras 7 facturas del día sin avisar por
    qué). El PDF se obtiene en dos pasos: GET /invoices/{id}?fields=pdf
    devuelve una URL firmada de CloudFront (`data.pdf`, expira — no cachear),
    y esa URL se descarga directo sin headers de Alegra (es pública mientras
    la firma sea válida)."""
    try:
        headers = _alegra_headers()
        res = requests.get(
            f"{_ALEGRA_BASE}/invoices/{factura_id}", headers=headers,
            params={"fields": "pdf"}, timeout=20,
        )
        if res.status_code != 200:
            return ""
        url_pdf = (res.json() or {}).get("pdf")
        if not url_pdf:
            return ""
        pdf_res = requests.get(url_pdf, timeout=20)
        if pdf_res.status_code != 200 or not pdf_res.content.startswith(b"%PDF"):
            return ""
        return base64.b64encode(pdf_res.content).decode()
    except Exception as e:
        print(f"⚠️ No se pudo descargar PDF Alegra {factura_id}: {e}")
    return ""


def descargar_nota_credito_pdf_alegra(nc_id: str) -> str:
    """Espejo de `descargar_nota_credito_pdf_siigo` — mismo mecanismo que
    `descargar_factura_pdf_alegra` (GET /credit-notes/{id}?fields=pdf → URL
    firmada de CloudFront)."""
    try:
        headers = _alegra_headers()
        res = requests.get(
            f"{_ALEGRA_BASE}/credit-notes/{nc_id}", headers=headers,
            params={"fields": "pdf"}, timeout=20,
        )
        if res.status_code != 200:
            return ""
        url_pdf = (res.json() or {}).get("pdf")
        if not url_pdf:
            return ""
        pdf_res = requests.get(url_pdf, timeout=20)
        if pdf_res.status_code != 200 or not pdf_res.content.startswith(b"%PDF"):
            return ""
        return base64.b64encode(pdf_res.content).decode()
    except Exception as e:
        print(f"⚠️ No se pudo descargar PDF de nota crédito Alegra {nc_id}: {e}")
    return ""


def buscar_nota_credito_existente_alegra(factura_id: str, dias_atras: int = 120) -> dict | None:
    """
    Espejo de `buscar_nota_credito_existente_siigo` — chequeo de último
    segundo antes de emitir, mismo propósito (evitar duplicar si alguien ya
    la generó a mano en el medio, ver incidente 10-ago-2026 documentado en
    la función Siigo).
    """
    try:
        headers = _alegra_headers()
    except RuntimeError:
        return None
    factura_id = str(factura_id or "").strip()
    if not factura_id:
        return None
    desde = (datetime.now() - timedelta(days=dias_atras)).strftime("%Y-%m-%d")
    pagina = 0
    while True:
        try:
            res = requests.get(
                f"{_ALEGRA_BASE}/credit-notes", headers=headers,
                params={"limit": 30, "start": pagina * 30, "date_afterEq": desde}, timeout=20,
            )
        except requests.RequestException:
            return None
        if res.status_code != 200:
            return None
        lote = res.json() or []
        if not lote:
            return None
        for nc in lote:
            for inv in nc.get("invoices") or []:
                if str(inv.get("id") or "") == factura_id:
                    return nc
        if len(lote) < 30:
            return None
        pagina += 1


def obtener_facturas_alegra_paginadas(fecha_inicio: str, estricto: bool = False) -> list:
    """
    Espejo de `obtener_facturas_siigo_paginadas` — mismo comportamiento y forma
    de uso (paginación de a 30, que es el límite real de Alegra confirmado en
    vivo). Cada factura devuelta agrega `purchase_order` como alias de
    `anotation` para no romper a los consumidores que ya leen ese campo
    (salud_negocio.py, reporte_financiero.py, contabilidad_ledger.py, sync.py,
    meli_reclamos.py) — en Siigo `purchase_order` venía de la orden MeLi/web,
    en Alegra ese mismo dato se guarda en `anotation` (ver crear_factura_venta_alegra).

    `estricto=True`: si la paginación se corta por error de red, relanza la
    excepción en vez de devolver la lista parcial en silencio.
    """
    try:
        headers = _alegra_headers()
    except RuntimeError:
        return []

    todas = []
    pagina = 0
    while True:
        try:
            res = requests.get(
                f"{_ALEGRA_BASE}/invoices",
                headers=headers,
                params={"date_afterEqual": fecha_inicio, "limit": 30, "start": pagina * 30},
                timeout=20,
            )
        except requests.RequestException:
            if estricto:
                raise
            break
        if res.status_code != 200:
            break
        resultados = res.json() or []
        if not resultados:
            break
        for f in resultados:
            f["purchase_order"] = f.get("anotation") or ""
            todas.append(f)
        if len(resultados) < 30:
            break
        pagina += 1
    return todas


_combos_alegra_cache: list = []
_combos_alegra_cache_ts: float = 0.0
_COMBOS_ALEGRA_TTL = 300  # 5 minutos


def _normalizar_combo_alegra_a_shape_siigo(raw: dict) -> dict:
    """Convierte un item Alegra (type='kit') al mismo shape que devolvía
    `listar_productos_combo_siigo` (siigo.py), para que rentabilidad.py y demás
    consumidores de costeo/IVA no necesiten reescribirse:
      - code   <- reference
      - components <- subitems (cada uno {id, name, quantity})
      - taxes  <- tax (percentage como float, no string)
      - tax_included <- True (los precios importados vienen del precio final
        de venta de Siigo/MeLi, que en McKenna siempre incluye IVA — ver
        conversación de migración 2026-09-03, no hay flag equivalente en Alegra)
    """
    components = []
    for sub in raw.get("subitems") or []:
        item = sub.get("item") or {}
        components.append({
            "id": item.get("id"), "name": item.get("name") or "", "quantity": sub.get("quantity") or 1,
        })
    taxes = []
    for t in raw.get("tax") or []:
        try:
            pct = float(t.get("percentage") or 0)
        except (TypeError, ValueError):
            pct = 0.0
        taxes.append({"id": t.get("id"), "name": t.get("name") or "", "type": t.get("type") or "IVA", "percentage": pct})

    precio = _precio_lista_alegra_producto(raw)

    out = dict(raw)
    out["code"] = raw.get("reference", "")
    out["components"] = components
    out["taxes"] = taxes
    out["tax_included"] = True
    out["active"] = (raw.get("status") or "active") == "active"
    # Shape anidado exacto de Siigo (prices[0].price_list[0].value) — lo sigue
    # leyendo _precio_lista_siigo_producto()/_combo_item_desde_raw() dentro de
    # siigo.py, que no se reescribió (solo se redirigió listar_productos_combo_siigo).
    out["prices"] = [{"price_list": [{"value": precio}]}]
    return out


def listar_productos_combo_alegra() -> list:
    """Espejo de `listar_productos_combo_siigo` — items de Alegra con type == 'kit'
    (activos), normalizados al mismo shape que devolvía Siigo (code/components/
    taxes/tax_included) vía `_normalizar_combo_alegra_a_shape_siigo`."""
    import time as _time

    global _combos_alegra_cache, _combos_alegra_cache_ts
    if _combos_alegra_cache and _time.time() - _combos_alegra_cache_ts < _COMBOS_ALEGRA_TTL:
        return _combos_alegra_cache

    try:
        headers = _alegra_headers()
    except RuntimeError:
        return []

    out = []
    pagina = 0
    while True:
        res = requests.get(
            f"{_ALEGRA_BASE}/items",
            headers=headers,
            params={"type": "kit", "limit": 30, "start": pagina * 30},
            timeout=20,
        )
        if res.status_code != 200:
            break
        resultados = res.json() or []
        if not resultados:
            break
        out.extend(
            _normalizar_combo_alegra_a_shape_siigo(p)
            for p in resultados if (p.get("status") or "active") == "active"
        )
        if len(resultados) < 30:
            break
        pagina += 1

    _combos_alegra_cache = out
    _combos_alegra_cache_ts = _time.time()
    return out


def _combo_item_desde_raw_alegra(raw: dict) -> dict:
    """Espejo de `_combo_item_desde_raw` (siigo.py) — mismo shape de salida
    ({ref, name, precio_lista, precio_web, activo}) a partir de un item crudo
    de Alegra (type='kit')."""
    code = (raw.get("reference") or "").strip()
    name = (raw.get("name") or "").strip()
    lista = _precio_lista_alegra_producto(raw)
    if lista > 0:
        from app.services.precios_canales import precios_catalogo_web_desde_siigo

        web = float(precios_catalogo_web_desde_siigo(code, lista, name)["precio_web_num"])
    else:
        web = 0.0
    return {
        "ref": code,
        "name": name,
        "precio_lista": lista,
        "precio_web": web,
        "activo": (raw.get("status") or "active") == "active",
    }


def _precio_lista_alegra_producto(p: dict) -> float:
    try:
        precios = p.get("price") or []
        return float(precios[0].get("price") or 0)
    except (KeyError, IndexError, TypeError, ValueError):
        return 0.0


def actualizar_precio_alegra_producto(code: str, nuevo_precio: float) -> dict:
    """Espejo de `actualizar_precio_combo_siigo` — actualiza el precio de lista
    de un producto/kit en Alegra por su `reference`. Retorna {"ok": bool, "msg": str}."""
    try:
        headers = _alegra_headers()
    except RuntimeError as e:
        return {"ok": False, "msg": str(e)}

    try:
        res = requests.get(f"{_ALEGRA_BASE}/items", headers=headers, params={"reference": code, "limit": 5}, timeout=15)
    except requests.RequestException as e:
        return {"ok": False, "msg": f"Error de red obteniendo producto: {e}"}
    if res.status_code != 200:
        return {"ok": False, "msg": f"Alegra GET error {res.status_code}: {res.text[:200]}"}
    productos = res.json() or []
    if not productos:
        return {"ok": False, "msg": f"Producto {code} no existe en Alegra"}

    item_id = productos[0]["id"]
    try:
        res2 = requests.put(
            f"{_ALEGRA_BASE}/items/{item_id}", headers=headers,
            json={"price": float(nuevo_precio)}, timeout=15,
        )
    except requests.RequestException as e:
        return {"ok": False, "msg": f"Error de red actualizando precio: {e}"}
    if res2.status_code != 200:
        return {"ok": False, "msg": f"Alegra PUT error {res2.status_code}: {res2.text[:200]}"}
    return {"ok": True, "msg": f"Precio de {code} actualizado a {nuevo_precio}"}


def actualizar_nombre_alegra_producto(codigo: str, nuevo_nombre: str) -> dict:
    """Actualiza el `name` de un producto/kit Alegra por su `reference`.

    Aplica `_nombre_mayusculas_alegra` (MAYÚSCULAS + grafía `mL`/`g`).
    Retorna ``{"ok", "msg", "codigo"?, "nombre"?}``.
    """
    codigo = (codigo or "").strip()
    nombre_ok = _nombre_mayusculas_alegra(nuevo_nombre)
    if not codigo:
        return {"ok": False, "msg": "codigo es obligatorio"}
    if not nombre_ok:
        return {"ok": False, "msg": "nombre es obligatorio"}

    try:
        headers = _alegra_headers()
    except RuntimeError as e:
        return {"ok": False, "msg": str(e)}

    try:
        res = requests.get(
            f"{_ALEGRA_BASE}/items",
            headers=headers,
            params={"reference": codigo, "limit": 5},
            timeout=15,
        )
    except requests.RequestException as e:
        return {"ok": False, "msg": f"Error de red obteniendo producto: {e}"}
    if res.status_code != 200:
        return {"ok": False, "msg": f"Alegra GET error {res.status_code}: {res.text[:200]}"}
    productos = res.json() or []
    if not productos:
        return {"ok": False, "msg": f"Producto {codigo} no existe en Alegra"}

    item = productos[0]
    item_id = item.get("id")
    if not item_id:
        return {"ok": False, "msg": f"Producto {codigo} sin id en Alegra"}
    nombre_actual = str(item.get("name") or "")
    if nombre_actual == nombre_ok:
        return {
            "ok": True,
            "msg": "Sin cambios",
            "codigo": codigo,
            "nombre": nombre_ok,
        }

    try:
        res2 = requests.put(
            f"{_ALEGRA_BASE}/items/{item_id}",
            headers=headers,
            json={"name": nombre_ok},
            timeout=15,
        )
    except requests.RequestException as e:
        return {"ok": False, "msg": f"Error de red actualizando nombre: {e}"}
    if res2.status_code != 200:
        return {"ok": False, "msg": f"Alegra PUT error {res2.status_code}: {res2.text[:200]}"}

    _producto_cache.pop(codigo, None)
    return {
        "ok": True,
        "msg": f"Nombre de {codigo} actualizado",
        "codigo": codigo,
        "nombre": nombre_ok,
    }


def _mensaje_bloqueo_movimientos_alegra(texto: str) -> str | None:
    """Si Alegra rechaza editar por movimientos, mensaje claro en español."""
    t = (texto or "").lower()
    marcas = (
        "movimiento",
        "movimientos",
        "has movements",
        "associated transactions",
        "no se puede editar",
        "cannot be edited",
        "no se puede modificar",
        "ya fue usado",
        "already been used",
    )
    if any(m in t for m in marcas):
        return (
            "Este combo ya tiene movimientos en Alegra y no se puede cambiar la "
            "composición. Duplicá el combo o creá uno nuevo con la receta corregida."
        )
    return None


def _inferir_movimientos_item_alegra(prod: dict) -> bool | None:
    """Heurística suave sobre el JSON del ítem. None = desconocido (dejar intentar PUT)."""
    if not isinstance(prod, dict):
        return None
    inv = prod.get("inventory") or {}
    if not isinstance(inv, dict):
        inv = {}
    try:
        aq = inv.get("availableQuantity")
        iq = inv.get("initialQuantity")
        if aq is not None and iq is not None and float(aq) != float(iq):
            return True
    except (TypeError, ValueError):
        pass
    for wh in inv.get("warehouses") or []:
        if not isinstance(wh, dict):
            continue
        try:
            wq = wh.get("availableQuantity")
            wi = wh.get("initialQuantity")
            if wq is not None and wi is not None and float(wq) != float(wi):
                return True
            if wq is not None and float(wq) != 0 and wi is None:
                # Stock distinto de cero sin initial explícito → probable movimiento
                return True
        except (TypeError, ValueError):
            continue
    return None


def actualizar_combo_alegra(
    codigo: str,
    componentes: list,
    *,
    nombre: str | None = None,
    precio_lista: float | None = None,
) -> dict:
    """Actualiza la composición (subitems) de un kit Alegra por `reference`.

    Alegra suele rechazar el PUT si el ítem ya tiene movimientos (facturas, etc.).
    En ese caso retorna ``ok=False`` con mensaje claro y ``bloqueado_movimientos=True``.

    componentes: [{code|codigo, quantity|cantidad}, ...] — al menos uno.
    Retorna ``{ok, msg|error, codigo?, componentes?, bloqueado_movimientos?}``.
    """
    import re

    global _combos_alegra_cache, _combos_alegra_cache_ts

    codigo_limpio = re.sub(r"[^A-Za-z0-9._-]", "", (codigo or "").strip())
    if not codigo_limpio:
        return {"ok": False, "error": "codigo es obligatorio"}

    comps_raw: list[tuple[str, float]] = []
    for raw in componentes or []:
        if not isinstance(raw, dict):
            continue
        c = re.sub(
            r"[^A-Za-z0-9._-]",
            "",
            str(raw.get("code") or raw.get("codigo") or "").strip(),
        )
        if not c:
            continue
        try:
            qty = float(
                raw.get("quantity")
                if raw.get("quantity") is not None
                else raw.get("cantidad") or 1
            )
        except (TypeError, ValueError):
            qty = 1.0
        if qty <= 0:
            return {"ok": False, "error": f"Cantidad inválida para componente {c}"}
        comps_raw.append((c, qty))

    if len(comps_raw) < 1:
        return {"ok": False, "error": "El combo necesita al menos un componente"}

    try:
        headers = _alegra_headers()
    except RuntimeError as e:
        return {"ok": False, "error": str(e)}

    try:
        res = requests.get(
            f"{_ALEGRA_BASE}/items",
            headers=headers,
            params={"reference": codigo_limpio, "limit": 5},
            timeout=15,
        )
    except requests.RequestException as e:
        return {"ok": False, "error": f"Error de red obteniendo combo: {e}"}
    if res.status_code != 200:
        return {"ok": False, "error": f"Alegra GET error {res.status_code}: {res.text[:200]}"}
    productos = res.json() or []
    if not productos:
        return {"ok": False, "error": f"Combo {codigo_limpio} no existe en Alegra"}

    item = productos[0]
    tipo = (item.get("type") or "").strip().lower()
    if tipo != "kit":
        return {
            "ok": False,
            "error": f"{codigo_limpio} no es un combo/kit en Alegra (type={tipo or 'simple'})",
        }
    item_id = item.get("id")
    if not item_id:
        return {"ok": False, "error": f"Combo {codigo_limpio} sin id en Alegra"}

    inferido = _inferir_movimientos_item_alegra(item)
    if inferido is True:
        return {
            "ok": False,
            "error": (
                "Este combo parece tener movimientos de inventario en Alegra y no "
                "se puede cambiar la composición. Duplicá el combo o creá uno nuevo."
            ),
            "bloqueado_movimientos": True,
            "codigo": codigo_limpio,
        }

    subitems = []
    comps_out = []
    for c, qty in comps_raw:
        prod = buscar_producto_alegra_por_referencia(c)
        if not prod:
            return {
                "ok": False,
                "error": (
                    f"Componente '{c}' no existe en Alegra. "
                    "Créalo primero o verifica el código."
                ),
            }
        subitems.append({"item": {"id": prod["id"]}, "quantity": qty})
        comps_out.append({
            "codigo": c,
            "nombre": prod.get("name") or prod.get("nombre") or "",
            "cantidad": qty,
        })

    payload: dict = {"subitems": subitems}
    if nombre is not None and str(nombre).strip():
        payload["name"] = _nombre_mayusculas_alegra(nombre)
    if precio_lista is not None:
        try:
            pl = float(precio_lista)
            if pl >= 0:
                payload["price"] = round(pl, 0)
        except (TypeError, ValueError):
            pass

    try:
        res2 = requests.put(
            f"{_ALEGRA_BASE}/items/{item_id}",
            headers=headers,
            json=payload,
            timeout=25,
        )
    except requests.RequestException as e:
        return {"ok": False, "error": f"Error de red actualizando combo: {e}"}

    if res2.status_code != 200:
        cuerpo = res2.text[:400] if res2.text else ""
        bloqueo = _mensaje_bloqueo_movimientos_alegra(cuerpo)
        if bloqueo:
            return {
                "ok": False,
                "error": bloqueo,
                "bloqueado_movimientos": True,
                "codigo": codigo_limpio,
            }
        return {
            "ok": False,
            "error": f"Alegra PUT error {res2.status_code}: {cuerpo[:300]}",
            "codigo": codigo_limpio,
        }

    _producto_cache.pop(codigo_limpio, None)
    _combos_alegra_cache = []
    _combos_alegra_cache_ts = 0.0

    nombre_final = payload.get("name") or (item.get("name") or "")
    return {
        "ok": True,
        "msg": f"Composición de {codigo_limpio} actualizada en Alegra",
        "mensaje": f"Composición de {codigo_limpio} actualizada en Alegra",
        "codigo": codigo_limpio,
        "nombre": nombre_final,
        "componentes": comps_out,
        "bloqueado_movimientos": False,
    }


def obtener_documento_fiscal_alegra_para_meli(id_factura: str) -> tuple[str, str]:
    """Espejo de `obtener_documento_fiscal_siigo_para_meli` — PDF para subir a
    MeLi (fiscal_documents). Sin XML de respaldo todavía (Alegra no expone un
    endpoint de XML confirmado); si el PDF falla, devuelve ("", "")."""
    pdf = descargar_factura_pdf_alegra(id_factura)
    if pdf:
        return pdf, "pdf"
    return "", ""


def _estado_factura_alegra(factura: dict) -> str:
    if not isinstance(factura, dict):
        return "Desconocido"
    stamp = factura.get("stamp") or {}
    if isinstance(stamp, dict) and stamp.get("legalStatus"):
        return str(stamp.get("legalStatus"))
    return str(factura.get("status") or "Desconocido")


def alegra_factura_etiqueta_log(factura: dict) -> str:
    """Espejo de `siigo_factura_etiqueta_log` — nombre visible para logs."""
    if not isinstance(factura, dict):
        return "?"
    name = str(factura.get("numberTemplate", {}).get("fullNumber") or "").strip()
    if not name:
        name = str(factura.get("id") or "?")[:12]
    return name[:88]


def alegra_factura_estado_log(factura: dict) -> str:
    """Espejo de `siigo_factura_estado_log`."""
    return _estado_factura_alegra(factura)


def alegra_omitir_pdf_mientras_timbrado(factura: dict) -> bool:
    """Espejo de `siigo_omitir_pdf_mientras_timbrado` — Alegra ya viene síncrono
    en la creación (confirmado en vivo), pero se deja el mismo chequeo por si
    algún día vuelve un estado intermedio."""
    est = (str(_estado_factura_alegra(factura) or "")).strip().lower()
    return est in ("draft", "open", "sending", "pending", "processing", "en proceso")


def _stamp_info_alegra(factura: dict) -> dict:
    """Espejo de `_stamp_info_siigo`."""
    stamp = factura.get("stamp") if isinstance(factura, dict) else {}
    if not isinstance(stamp, dict):
        stamp = {}
    return {
        "status": str(stamp.get("legalStatus") or _estado_factura_alegra(factura)),
        "cufe": stamp.get("cufe") or "",
        "cude": "",
        "observations": "; ".join(stamp.get("warnings") or []),
        "errors": stamp.get("errors") or "",
    }


# Fecha de corte de la migración Siigo → Alegra (primera factura real en Alegra,
# FE1, emitida 2026-09-02). Facturas con fecha anterior solo existen en Siigo;
# desde esta fecha en adelante, solo en Alegra — no hay solapamiento real.
FECHA_CORTE_MIGRACION_ALEGRA = "2026-09-02"


def obtener_facturas_hibridas(fecha_inicio: str, fecha_fin: str | None = None, estricto: bool = False) -> list:
    """
    Combina el histórico de facturas de venta de Siigo (hasta el día antes del
    corte) con las nuevas de Alegra (desde el corte) — para que los reportes
    (salud_negocio.py, reporte_financiero.py, rentabilidad.py, sync.py,
    meli_reclamos.py) no pierdan visibilidad de junio-agosto/2026 al haber
    migrado la facturación de venta a Alegra el 2026-09-02.

    Mismo shape de salida que `obtener_facturas_siigo_paginadas` /
    `obtener_facturas_alegra_paginadas` (cada factura trae al menos `date`,
    `total`, `observations`; las de Alegra también traen `purchase_order`
    alias de `anotation` — las de Siigo no, igual que siempre).
    """
    resultados: list = []

    if fecha_inicio < FECHA_CORTE_MIGRACION_ALEGRA:
        from app.services.siigo import obtener_facturas_siigo_paginadas as _siigo_fn

        try:
            facturas_siigo = _siigo_fn(fecha_inicio, estricto=estricto)
        except Exception:
            if estricto:
                raise
            facturas_siigo = []
        for f in facturas_siigo:
            fecha = (f.get("date") or "")[:10]
            # Estrictamente antes del corte — evita doble conteo si alguna
            # factura de Siigo quedó con fecha del día del corte o posterior
            # (no debería pasar, pero es barato de chequear).
            if fecha < FECHA_CORTE_MIGRACION_ALEGRA:
                resultados.append(f)

    desde_alegra = max(fecha_inicio, FECHA_CORTE_MIGRACION_ALEGRA)
    resultados.extend(obtener_facturas_alegra_paginadas(desde_alegra, estricto=estricto))

    if fecha_fin:
        resultados = [f for f in resultados if (f.get("date") or "")[:10] <= fecha_fin]

    return resultados


def es_factura_alegra(factura: dict) -> bool:
    """Discrimina el shape: los objetos crudos de Alegra siempre traen
    `numberTemplate`; los de Siigo, nunca (usan `document_settings`/`name`)."""
    return isinstance(factura, dict) and "numberTemplate" in factura


def etiqueta_log_hibrida(factura: dict) -> str:
    """Espejo de `siigo_factura_etiqueta_log`, consciente de que `factura` puede
    venir de Siigo (histórico) o de Alegra (desde el corte de migración) —
    usado por meli_reclamos.py sobre resultados de `obtener_facturas_hibridas`."""
    from app.services.siigo import siigo_factura_etiqueta_log

    return alegra_factura_etiqueta_log(factura) if es_factura_alegra(factura) else siigo_factura_etiqueta_log(factura)


def estado_log_hibrido(factura: dict) -> str:
    """Espejo de `siigo_factura_estado_log`, ver `etiqueta_log_hibrida`."""
    from app.services.siigo import siigo_factura_estado_log

    return alegra_factura_estado_log(factura) if es_factura_alegra(factura) else siigo_factura_estado_log(factura)


def url_factura_hibrida(factura: dict) -> str:
    """URL de la factura, Alegra o Siigo según de dónde vino."""
    factura_id = str(factura.get("id") or "").strip()
    if not factura_id:
        return ""
    if es_factura_alegra(factura):
        return f"https://app.alegra.com/invoice/view/id/{factura_id}"
    return f"https://siigonube.siigo.com/#/invoice/843/{factura_id}"


_pack_id_meli_cache: dict[str, str] = {}  # order_id MeLi -> pack_id real (proceso actual)


def _resolver_pack_id_meli(order_id: str, *, token: str | None = None) -> str:
    """GET /orders/{id} de MeLi para el `pack_id` real — necesario porque el
    índice legado de facturación (`conciliacion_meli.py`) está indexado por
    pack_id, no por order_id, y ambos solo coinciden en ventas de una sola
    orden. Cacheado por proceso; retorna `order_id` si falla o no hay pack_id
    (venta de una sola orden, el caso normal). `token`: ver `_detalle_venta_meli`."""
    order_id = str(order_id or "").strip()
    if not order_id:
        return ""
    if order_id in _pack_id_meli_cache:
        return _pack_id_meli_cache[order_id]
    pack_id = order_id
    try:
        from app.services.meli import consultar_orden_meli_completa

        orden = consultar_orden_meli_completa(order_id, token=token)
        if orden and orden.get("pack_id"):
            pack_id = str(orden["pack_id"]).strip()
    except Exception:
        pass
    _pack_id_meli_cache[order_id] = pack_id
    return pack_id


_item_referencia_cache: dict[str, dict] = {}  # alegra item id -> {"reference":..., "name":...} (proceso actual)


def _resolver_referencia_item_alegra(item_id: str) -> dict:
    """GET /items/{id} para sacar el `reference` (SKU) — confirmado en vivo
    (2026-09-03) que las LÍNEAS de factura de Alegra nunca lo traen (siempre
    `None`), aunque la ficha del producto sí lo tenga. Cacheado por proceso:
    un reporte de rentabilidad repite pocos SKUs en muchas líneas."""
    item_id = str(item_id or "").strip()
    if not item_id:
        return {}
    if item_id in _item_referencia_cache:
        return _item_referencia_cache[item_id]
    out: dict = {}
    try:
        headers = _alegra_headers()
        res = requests.get(f"{_ALEGRA_BASE}/items/{item_id}", headers=headers, timeout=15)
        if res.status_code == 200:
            data = res.json() or {}
            out = {"reference": data.get("reference") or "", "name": data.get("name") or ""}
    except Exception:
        pass
    _item_referencia_cache[item_id] = out
    return out


def items_hibridos_normalizados(factura: dict) -> list[dict]:
    """
    Normaliza `factura["items"]` a la forma de Siigo — `code`, `description`,
    `quantity`, `price`, `total`, `taxes: [{"id","value"}]` — sin importar si
    `factura` viene de Siigo (ya en esa forma, se devuelve tal cual) o de
    Alegra (`reference`/`name`/`tax`, con `amount` en vez de `value`).

    Usar SIEMPRE esta función en vez de leer `factura["items"]` directo en
    reportes híbridos (rentabilidad.py, salud_negocio.py) — leerlo directo
    dejaba IVA/COGS en $0 para toda venta facturada en Alegra desde el
    2026-09-02, sin error visible (hallazgo de la auditoría del 2026-09-03).
    """
    if not es_factura_alegra(factura):
        return factura.get("items") or []
    normalizados = []
    for it in factura.get("items") or []:
        ref_info = _resolver_referencia_item_alegra(it.get("id"))
        code = (it.get("reference") or ref_info.get("reference") or "").strip()
        name = it.get("name") or ref_info.get("name") or ""
        taxes = [{"id": t.get("id"), "value": t.get("amount") or 0} for t in (it.get("tax") or [])]
        normalizados.append({
            "code": code,
            "description": name,
            "quantity": it.get("quantity"),
            "price": it.get("price"),
            "total": it.get("total"),
            "taxes": taxes,
        })
    return normalizados


def buscar_clientes_alegra(consulta: str, *, max_items: int = 20) -> list[dict]:
    """
    Busca contactos de Alegra por nombre o identificación, para el picker de
    cliente del panel Cotizar/Facturar (venta directa por WhatsApp/app).

    Confirmado en vivo (2026-09-03): GET /contacts NO soporta búsqueda de
    texto libre por nombre (`name`/`query` como parámetro no filtran nada,
    a diferencia de /items que sí tiene `query`) — solo `identification`
    exacta. Con la cuenta actual (~40 contactos) pagina y filtra en Python;
    si la base de contactos crece mucho esto habría que revisarlo.
    """
    q = (consulta or "").strip().lower()
    if len(q) < 2:
        return []
    try:
        headers = _alegra_headers()
    except RuntimeError:
        return []

    resultados: list[dict] = []
    pagina = 0
    while len(resultados) < max_items and pagina < 15:
        try:
            res = requests.get(
                f"{_ALEGRA_BASE}/contacts", headers=headers,
                params={"limit": 30, "start": pagina * 30}, timeout=15,
            )
        except requests.RequestException:
            break
        if res.status_code != 200:
            break
        lote = res.json() or []
        if not lote:
            break
        for c in lote:
            nombre = (c.get("name") or "").strip()
            ident = (c.get("identification") or "").strip()
            if q in nombre.lower() or q in ident:
                resultados.append({
                    "id": c.get("id"),
                    "nombre": nombre,
                    "identificacion": ident,
                    "email": c.get("email") or "",
                    "telefono": c.get("mobile") or c.get("phonePrimary") or "",
                    "direccion": ((c.get("address") or {}).get("address")) or "",
                })
                if len(resultados) >= max_items:
                    break
        if len(lote) < 30:
            break
        pagina += 1
    return resultados


def contar_facturas_cliente_alegra(identificacion: str) -> dict:
    """Conteo HISTÓRICO real (no acotado al rango cargado en el panel) de
    facturas de un cliente en Alegra — para el botón "ver histórico completo"
    de Facturación → Ventas, NC y Astro Killer (ayuda a detectar doble
    facturación a un mismo cliente). Resuelve el contacto por identificación
    exacta (mismo endpoint que `_resolver_o_crear_contacto_alegra`, pero sin
    crear si no existe) y pide `GET /invoices?client_id=` con `limit=1` para
    leer el total de la paginación sin traer todas las facturas."""
    identificacion = "".join(ch for ch in str(identificacion or "") if ch.isdigit())
    if not identificacion:
        return {"ok": False, "error": "Identificación vacía."}
    try:
        headers = _alegra_headers()
    except RuntimeError as e:
        return {"ok": False, "error": str(e)}
    try:
        res = requests.get(
            f"{_ALEGRA_BASE}/contacts", headers=headers,
            params={"identification": identificacion, "limit": 5}, timeout=15,
        )
    except requests.RequestException as e:
        return {"ok": False, "error": f"Error de red: {e}"}
    if res.status_code != 200 or not (res.json() or []):
        return {"ok": True, "contacto_id": None, "total_facturas": 0}
    contacto = res.json()[0]
    contacto_id = contacto.get("id")
    try:
        res2 = requests.get(
            f"{_ALEGRA_BASE}/invoices", headers=headers,
            params={"client_id": contacto_id, "limit": 1}, timeout=15,
        )
    except requests.RequestException as e:
        return {"ok": False, "error": f"Error de red: {e}"}
    if res2.status_code != 200:
        return {"ok": False, "error": f"Alegra respondió {res2.status_code}"}
    # Alegra no siempre expone un total de paginación explícito en la
    # respuesta de /invoices (a diferencia de otros endpoints) — si no viene,
    # se cae a contar página por página (con este cliente el volumen esperado
    # es bajo, no un cliente con miles de facturas).
    total = (res2.json() if isinstance(res2.json(), dict) else None) or {}
    total_facturas = (total.get("metadata") or {}).get("total") if isinstance(total, dict) else None
    if total_facturas is None:
        total_facturas = 0
        start = 0
        while True:
            try:
                pag = requests.get(
                    f"{_ALEGRA_BASE}/invoices", headers=headers,
                    params={"client_id": contacto_id, "limit": 30, "start": start}, timeout=15,
                )
            except requests.RequestException:
                break
            if pag.status_code != 200:
                break
            lote = pag.json() or []
            if not lote:
                break
            total_facturas += len(lote)
            if len(lote) < 30:
                break
            start += 30
    return {"ok": True, "contacto_id": contacto_id, "nombre": contacto.get("name"), "total_facturas": total_facturas}


def buscar_productos_alegra_picker(
    consulta: str, *, max_items: int = 40, excluir_combos: bool = True,
) -> list[dict]:
    """Espejo de `buscar_productos_siigo_picker` — busca productos/kits activos
    en Alegra para pickers del panel. Alegra ya soporta búsqueda de texto libre
    (`query`, sobre nombre y referencia) además de `reference` exacta, así que
    no hace falta la cascada de pasos que tenía la versión Siigo.
    Retorna [{codigo, nombre, type}]."""
    q = (consulta or "").strip()
    if "—" in q or " - " in q:
        q = q.split("—")[0].split(" - ")[0].strip()
    if len(q) < 1:
        return []
    try:
        headers = _alegra_headers()
    except RuntimeError:
        return []

    items: list[dict] = []
    seen: set[str] = set()

    def _add(raw: dict) -> None:
        if len(items) >= max_items:
            return
        code = (raw.get("reference") or "").strip()
        name = (raw.get("name") or "").strip()
        if not code:
            return
        cu = code.upper()
        if cu in seen:
            return
        tipo_raw = (raw.get("type") or "product").strip() or "product"
        if excluir_combos and tipo_raw == "kit":
            return
        if (raw.get("status") or "active") != "active":
            return
        seen.add(cu)
        items.append({"codigo": code, "nombre": name or code, "type": "Combo" if tipo_raw == "kit" else "Product"})

    # 1) referencia exacta
    try:
        r = requests.get(f"{_ALEGRA_BASE}/items", headers=headers, params={"reference": q, "limit": 5}, timeout=15)
        if r.status_code == 200:
            for p in r.json() or []:
                _add(p)
    except requests.RequestException:
        pass

    if items and any(it["codigo"].upper() == q.upper() for it in items):
        return items[:max_items]

    # 2) texto libre (nombre o referencia)
    if len(items) < max_items and len(q) >= 2:
        pagina = 0
        while len(items) < max_items:
            try:
                r = requests.get(
                    f"{_ALEGRA_BASE}/items", headers=headers,
                    params={"query": q, "limit": 30, "start": pagina * 30}, timeout=15,
                )
            except requests.RequestException:
                break
            if r.status_code != 200:
                break
            resultados = r.json() or []
            if not resultados:
                break
            for p in resultados:
                _add(p)
            if len(resultados) < 30:
                break
            pagina += 1

    return items[:max_items]


def detalle_producto_alegra(codigo: str) -> dict:
    """Espejo de `detalle_producto_siigo` — lee un producto/kit de Alegra
    (código, tipo, precio y receta)."""
    codigo_limpio = (codigo or "").strip()
    if not codigo_limpio:
        return {"ok": False, "error": "Código obligatorio"}
    try:
        headers = _alegra_headers()
    except RuntimeError as e:
        return {"ok": False, "error": str(e)}

    res = requests.get(f"{_ALEGRA_BASE}/items", headers=headers, params={"reference": codigo_limpio, "limit": 5}, timeout=15)
    if res.status_code != 200:
        return {"ok": False, "error": f"Alegra GET error {res.status_code}"}
    resultados = res.json() or []
    if not resultados:
        return {"ok": False, "error": f"No se encontró {codigo_limpio} en Alegra"}
    prod = resultados[0]

    tipo = (prod.get("type") or "product").strip() or "product"
    es_combo = tipo == "kit"
    componentes: list[dict] = []
    for sub in prod.get("subitems") or []:
        item = sub.get("item") or {}
        try:
            qty = float(sub.get("quantity") or 1)
        except (TypeError, ValueError):
            qty = 1.0
        if qty <= 0:
            continue
        componentes.append({
            "codigo": (item.get("reference") or "").strip(),
            "nombre": (item.get("name") or "").strip(),
            "cantidad": qty,
        })

    tiene_mov = _inferir_movimientos_item_alegra(prod)
    editable = True if tiene_mov is None else (not tiene_mov)

    return {
        "ok": True,
        "codigo": (prod.get("reference") or codigo_limpio).strip(),
        "nombre": (prod.get("name") or "").strip(),
        "type": "Combo" if es_combo else "Product",
        "es_combo": es_combo,
        "precio_lista": _precio_lista_alegra_producto(prod),
        "iva": bool(prod.get("tax")),
        "activo": (prod.get("status") or "active") == "active",
        "componentes": componentes,
        "tiene_movimientos": tiene_mov,
        "editable_composicion": bool(es_combo and editable),
    }


def crear_producto_en_alegra(producto: dict) -> dict:
    """
    Crea un producto simple inventariable en Alegra (POST /items, type=simple).
    Espejo de `crear_producto_en_siigo` — mismo dict de entrada y de retorno
    `{ok, mensaje|error, siigo_producto?, siigo_id?}` para no romper el panel.

    Campos útiles en `producto`:
      codigo, nombre, unidad_min (Un|mL|g), precio_neto (costo),
      precio_unitario, precio_lista (opcional), iva (truthy → IVA).
    Stock inicial = 0 y `negativeSale=true`: el inventario vendible vive en
    MeLi/Sheets, no en el ERP (misma regla que Siigo).
    """
    import re

    codigo = re.sub(r"[^A-Za-z0-9._-]", "", str(producto.get("codigo") or "").strip())
    if not codigo or not re.match(r"^[A-Za-z0-9._-]{2,40}$", codigo):
        return {"ok": False, "error": f"Código inválido: {producto.get('codigo')!r}"}
    nombre = _nombre_mayusculas_alegra(str(producto.get("nombre") or ""))
    if not nombre:
        return {"ok": False, "error": "El nombre del producto es obligatorio"}

    try:
        headers = _alegra_headers()
    except RuntimeError as e:
        return {"ok": False, "error": str(e)}

    existente = buscar_producto_alegra_por_referencia(codigo)
    if existente:
        return {
            "ok": False,
            "error": f"El código {codigo} ya existe en Alegra",
            "siigo_producto": {
                "codigo": existente.get("sku") or codigo,
                "nombre": existente.get("nombre") or existente.get("name") or "",
                "unidad": existente.get("unidad") or "",
                "activo": True,
            },
        }

    try:
        precio_vu = float(producto.get("precio_unitario") or 0)
    except (TypeError, ValueError):
        precio_vu = 0.0
    try:
        precio_neto = float(
            producto.get("precio_neto") if producto.get("precio_neto") is not None else precio_vu
        )
    except (TypeError, ValueError):
        precio_neto = precio_vu

    valor_lista = None
    if "precio_lista" in producto:
        try:
            pl = producto.get("precio_lista")
            if pl not in (None, "") and float(pl) > 0:
                valor_lista = round(float(pl), 0)
        except (TypeError, ValueError):
            valor_lista = None
    elif precio_vu > 0:
        valor_lista = round(precio_vu * 1.3, 0)

    unidad_min = str(producto.get("unidad_min") or "Un").strip() or "Un"
    unidad_alegra = _ALEGRA_UNIDAD_DESDE_MIN.get(unidad_min, "unit")
    iva_flag = producto.get("iva", True)
    if isinstance(iva_flag, str):
        iva_flag = iva_flag.strip().lower() not in ("0", "false", "no")
    else:
        try:
            iva_flag = float(iva_flag or 0) != 0 if not isinstance(iva_flag, bool) else bool(iva_flag)
        except (TypeError, ValueError):
            iva_flag = True
    tax_id = _env_int("ALEGRA_IVA_TAX_ID")

    payload: dict = {
        "name": nombre,
        "reference": codigo[:45],
        "type": "simple",
        "price": float(valor_lista or 0),
        "inventory": {
            "unit": unidad_alegra,
            "unitCost": max(0.0, float(precio_neto or 0)),
            "initialQuantity": 0,
            "negativeSale": True,
        },
    }
    if iva_flag and tax_id:
        payload["tax"] = [{"id": tax_id}]

    try:
        r = requests.post(f"{_ALEGRA_BASE}/items", headers=headers, json=payload, timeout=25)
    except requests.RequestException as e:
        return {"ok": False, "error": f"Error de red creando producto: {e}"}

    if r.status_code in (200, 201):
        data = r.json() if r.content else {}
        _producto_cache.pop(codigo, None)
        resumen = {
            "codigo": data.get("reference", codigo),
            "nombre": data.get("name", nombre),
            "unidad": unidad_min,
            "activo": True,
            "type": "Product",
        }
        try:
            from app.services.rentabilidad import registrar_producto_en_cache_costos

            registrar_producto_en_cache_costos(
                resumen["codigo"],
                resumen["nombre"],
                unit_cost=max(0.0, float(precio_neto or 0)),
                precio_lista=float(valor_lista or 0),
            )
        except Exception:
            pass
        return {
            "ok": True,
            "mensaje": f"Producto {codigo} creado en Alegra",
            "alegra_id": data.get("id"),
            "siigo_id": data.get("id"),
            "siigo_producto": resumen,
        }
    return {"ok": False, "error": f"Alegra POST error {r.status_code}: {r.text[:300]}"}


def crear_combo_en_alegra(
    codigo: str, nombre: str, componentes: list,
    *, precio_lista: float = 0.0, iva: bool = True, account_group: int | None = None,
) -> dict:
    """Espejo de `crear_combo_en_siigo` — crea un kit en Alegra (POST /items).
    componentes: [{code|codigo, quantity|cantidad}, ...]. `account_group` se
    ignora (concepto propio de Siigo, sin equivalente en Alegra).
    Retorna {ok, mensaje|error, alegra_id?, siigo_producto?} (se mantiene la
    clave `siigo_producto` por compatibilidad con el frontend del panel)."""
    import re

    codigo_limpio = re.sub(r"[^A-Za-z0-9._-]", "", (codigo or "").strip())
    if not codigo_limpio or not re.match(r"^[A-Za-z0-9._-]{2,40}$", codigo_limpio):
        return {"ok": False, "error": f"Código inválido: {codigo}"}
    nombre_limpio = _nombre_mayusculas_alegra(nombre or "")
    if not nombre_limpio:
        return {"ok": False, "error": "El nombre del combo es obligatorio"}

    comps_raw = []
    for raw in componentes or []:
        if not isinstance(raw, dict):
            continue
        c = re.sub(r"[^A-Za-z0-9._-]", "", str(raw.get("code") or raw.get("codigo") or "").strip())
        if not c:
            continue
        try:
            qty = float(raw.get("quantity") if raw.get("quantity") is not None else raw.get("cantidad") or 1)
        except (TypeError, ValueError):
            qty = 1.0
        if qty <= 0:
            return {"ok": False, "error": f"Cantidad inválida para componente {c}"}
        comps_raw.append((c, qty))

    if len(comps_raw) < 1:
        return {"ok": False, "error": "El combo necesita al menos un componente"}

    try:
        headers = _alegra_headers()
    except RuntimeError as e:
        return {"ok": False, "error": str(e)}

    # Duplicado del código
    existente = requests.get(f"{_ALEGRA_BASE}/items", headers=headers, params={"reference": codigo_limpio}, timeout=15)
    if existente.status_code == 200 and existente.json():
        ex = existente.json()[0]
        return {
            "ok": False,
            "error": f"El código {codigo_limpio} ya existe en Alegra",
            "siigo_producto": {"codigo": ex.get("reference", codigo_limpio), "nombre": ex.get("name", ""), "activo": (ex.get("status") or "active") == "active"},
        }

    subitems = []
    for c, qty in comps_raw:
        prod = buscar_producto_alegra_por_referencia(c)
        if not prod:
            return {"ok": False, "error": f"Componente '{c}' no existe en Alegra. Créalo primero o verifica el código."}
        subitems.append({"item": {"id": prod["id"]}, "quantity": qty})

    tax_id = _env_int("ALEGRA_IVA_TAX_ID")
    payload = {
        "name": nombre_limpio,
        "reference": codigo_limpio,
        "price": round(float(precio_lista or 0), 0),
        "type": "kit",
        "inventory": {"unit": "unit"},
        "subitems": subitems,
    }
    if iva and tax_id:
        payload["tax"] = [{"id": tax_id}]

    try:
        r = requests.post(f"{_ALEGRA_BASE}/items", headers=headers, json=payload, timeout=25)
    except requests.RequestException as e:
        return {"ok": False, "error": f"Error de red creando combo: {e}"}

    if r.status_code in (200, 201):
        data = r.json() if r.content else {}
        return {
            "ok": True,
            "mensaje": f"Combo {codigo_limpio} creado en Alegra",
            "alegra_id": data.get("id"),
            "siigo_producto": {
                "codigo": data.get("reference", codigo_limpio),
                "nombre": data.get("name", nombre_limpio),
                "activo": True,
                "type": "Combo",
            },
        }
    return {"ok": False, "error": f"Alegra POST error {r.status_code}: {r.text[:300]}"}


def mayusculizar_nombres_productos_alegra(
    *,
    dry_run: bool = False,
    limit: int | None = None,
) -> dict:
    """Pone en MAYÚSCULAS el `name` de todos los ítems Alegra (productos y kits).

    Solo hace PUT cuando el nombre actual no está ya en mayúsculas.
    Retorna {ok, dry_run, revisados, a_cambiar, actualizados, errores, ejemplos}.
    """
    try:
        headers = _alegra_headers()
    except RuntimeError as e:
        return {"ok": False, "error": str(e)}

    revisados = 0
    a_cambiar: list[dict] = []
    actualizados = 0
    errores: list[str] = []
    pagina = 0
    tope = int(limit) if limit and limit > 0 else None

    while True:
        try:
            res = requests.get(
                f"{_ALEGRA_BASE}/items",
                headers=headers,
                params={"limit": 30, "start": pagina * 30},
                timeout=25,
            )
        except requests.RequestException as e:
            return {
                "ok": False,
                "error": f"Error listando ítems: {e}",
                "revisados": revisados,
                "actualizados": actualizados,
                "errores": errores,
            }
        if res.status_code != 200:
            return {
                "ok": False,
                "error": f"Alegra GET items {res.status_code}: {res.text[:200]}",
                "revisados": revisados,
                "actualizados": actualizados,
                "errores": errores,
            }
        lote = res.json() or []
        if not lote:
            break
        for item in lote:
            if tope is not None and revisados >= tope:
                break
            revisados += 1
            item_id = item.get("id")
            nombre = str(item.get("name") or "")
            nombre_ok = _nombre_mayusculas_alegra(nombre)
            if not item_id or not nombre_ok or nombre == nombre_ok:
                continue
            ref = (item.get("reference") or "").strip()
            a_cambiar.append({
                "id": item_id,
                "codigo": ref,
                "antes": nombre,
                "despues": nombre_ok,
            })
            if dry_run:
                continue
            try:
                put = requests.put(
                    f"{_ALEGRA_BASE}/items/{item_id}",
                    headers=headers,
                    json={"name": nombre_ok},
                    timeout=20,
                )
            except requests.RequestException as e:
                errores.append(f"{ref or item_id}: red {e}")
                continue
            if put.status_code != 200:
                errores.append(f"{ref or item_id}: PUT {put.status_code} {put.text[:120]}")
                continue
            actualizados += 1
            if ref:
                _producto_cache.pop(ref, None)
        if tope is not None and revisados >= tope:
            break
        if len(lote) < 30:
            break
        pagina += 1

    return {
        "ok": len(errores) == 0,
        "dry_run": dry_run,
        "revisados": revisados,
        "a_cambiar": len(a_cambiar),
        "actualizados": actualizados if not dry_run else 0,
        "errores": errores[:30],
        "ejemplos": a_cambiar[:8],
    }


def actualizar_costo_componente_alegra(
    nombre: str, precio_sin_iva: float, catalogo: dict | None = None, codigo: str | None = None,
) -> dict:
    """Espejo de `actualizar_costo_componente_siigo` — resuelve el código igual
    que la versión Siigo (mismo catálogo nombre→código, que sigue viniendo de
    Siigo por ahora — ver construir_catalogo_costos), pero escribe el precio
    en Alegra."""
    from app.services.rentabilidad import _norm, construir_catalogo_costos

    codigo_eff = (codigo or "").strip()
    if not codigo_eff:
        if catalogo is None:
            try:
                catalogo = construir_catalogo_costos()
            except Exception as e:
                return {"ok": False, "msg": f"Error cargando catálogo: {e}", "codigo": None}
        codigo_eff = (catalogo.get("nombre_a_codigo", {}) or {}).get(_norm(nombre)) or ""
        if not codigo_eff:
            target = _norm(nombre)
            for nrm, code in (catalogo.get("nombre_a_codigo") or {}).items():
                if nrm == target or (target and target in nrm) or (nrm and nrm in target):
                    codigo_eff = str(code)
                    break
        if not codigo_eff:
            return {"ok": False, "msg": f"'{nombre}' no encontrado en catálogo (indique código SKU)", "codigo": None}

    resultado = actualizar_precio_alegra_producto(codigo_eff, precio_sin_iva)
    return {"ok": resultado.get("ok", False), "msg": resultado.get("msg", ""), "codigo": codigo_eff}


_GENERICO_REF_COMPRA = "GENERICO"


def _resolver_o_crear_proveedor_alegra(nit: str, nombre: str = "") -> str | None:
    """Busca un proveedor por NIT/identificación; si no existe, lo crea con lo
    mínimo (se puede completar manualmente después desde el panel de Alegra)."""
    nit_limpio = "".join(ch for ch in str(nit or "") if ch.isdigit())
    if not nit_limpio:
        return None
    try:
        headers = _alegra_headers()
    except RuntimeError:
        return None

    res = requests.get(f"{_ALEGRA_BASE}/contacts", headers=headers, params={"identification": nit_limpio, "limit": 5}, timeout=15)
    if res.status_code == 200:
        resultados = res.json() or []
        if resultados:
            return str(resultados[0]["id"])

    payload = {
        "name": (nombre or f"Proveedor NIT {nit_limpio}")[:150],
        "identificationObject": {"type": "NIT" if len(nit_limpio) > 10 else "CC", "number": nit_limpio},
        "kindOfPerson": "LEGAL_ENTITY",
        "regime": "COMMON_REGIME",
        "type": ["provider"],
    }
    r = requests.post(f"{_ALEGRA_BASE}/contacts", headers=headers, json=payload, timeout=20)
    if r.status_code in (200, 201):
        return str(r.json()["id"])
    return None


def crear_factura_compra_alegra(
    *,
    nit_proveedor: str,
    fecha: str,
    items: list[dict],
    numero_proveedor: str = "",
    prefijo_proveedor: str = "",
    observaciones: str = "",
    nombre_proveedor: str = "",
) -> dict:
    """
    Crea una factura de proveedor (bill) en Alegra — reemplaza a
    `crear_factura_compra_siigo` para el flujo de sincronización de correo
    (app/tools/sincronizar_facturas_de_compra_siigo.py).

    `items`: [{"codigo": "GENERICO"|sku, "descripcion": "...", "cantidad": 1,
               "precio": 1000}] — si el código no existe como producto en
    Alegra, cae a GENERICO en vez de fallar toda la factura.

    Usa el talonario "Factura de proveedor manual" (numeración propia del
    proveedor, no autoincremental) — misma idea que `provider_invoice.prefix/
    number` en el payload que armaba Siigo.

    Retorna {"status": "success"|"error", "data"|"message": ...} — mismo shape
    que devolvía `crear_factura_compra_siigo`, para no romper a los 3
    call-sites que ya la consumen.
    """
    try:
        headers = _alegra_headers()
    except RuntimeError as e:
        return {"status": "error", "message": str(e)}

    proveedor_id = _resolver_o_crear_proveedor_alegra(nit_proveedor, nombre_proveedor)
    if not proveedor_id:
        return {"status": "error", "message": f"No se pudo resolver/crear el proveedor NIT {nit_proveedor} en Alegra."}

    generico = buscar_producto_alegra_por_referencia(_GENERICO_REF_COMPRA)
    if not generico:
        return {"status": "error", "message": "Producto GENERICO no existe en Alegra (créalo primero)."}

    items_out = []
    for it in items or []:
        codigo = str(it.get("codigo") or "").strip()
        prod = buscar_producto_alegra_por_referencia(codigo) if codigo else None
        item_id = (prod or generico)["id"]
        try:
            cantidad = float(it.get("cantidad") or 1)
            precio = float(it.get("precio") or 0)
        except (TypeError, ValueError):
            return {"status": "error", "message": f"Cantidad/precio inválido en línea: {it!r}"}
        linea = {"id": item_id, "price": precio, "quantity": cantidad}
        desc = str(it.get("descripcion") or "").strip()
        if desc:
            linea["observations"] = desc[:255]
        items_out.append(linea)

    if not items_out:
        return {"status": "error", "message": "La factura de compra no tiene ítems."}

    payload = {
        "date": fecha,
        "dueDate": fecha,
        "provider": int(proveedor_id) if proveedor_id.isdigit() else proveedor_id,
        "numberTemplate": {"id": "8"},  # Factura de proveedor manual (numeración propia)
        "purchases": {"items": items_out},
        "paymentMethod": "CASH",
        "paymentType": "INSTRUMENT_NOT_DEFINED",
        "billOperationType": "INDIVIDUAL",
    }
    numero_completo = f"{prefijo_proveedor or ''}{numero_proveedor or ''}".strip()
    if numero_completo:
        payload["numberTemplate"]["number"] = numero_completo
    if observaciones:
        payload["observations"] = observaciones[:500]

    try:
        r = requests.post(f"{_ALEGRA_BASE}/bills", headers=headers, json=payload, timeout=25)
    except requests.RequestException as e:
        return {"status": "error", "message": f"Error de red: {e}"}

    if r.status_code in (200, 201):
        print(f"✅ Factura de compra creada en Alegra: {r.json().get('id')}")
        return {"status": "success", "data": r.json()}
    print(f"❌ Error al crear factura de compra en Alegra: {r.status_code} - {r.text[:300]}")
    return {"status": "error", "message": r.text}


def bill_alegra_a_shape_compra(bill: dict) -> dict:
    """Normaliza una factura de proveedor de Alegra al shape que usa
    `buscar_compra_siigo_registrada` (prefix/number, supplier.identification, date, total)."""
    if not isinstance(bill, dict):
        return {}
    nt = bill.get("numberTemplate") or {}
    numero = str(nt.get("fullNumber") or nt.get("number") or bill.get("id") or "")
    provider = bill.get("provider") or bill.get("client") or {}
    if not isinstance(provider, dict):
        provider = {}
    ident = str(
        provider.get("identification")
        or (provider.get("identificationObject") or {}).get("number")
        or ""
    )
    return {
        "id": bill.get("id"),
        "name": numero,
        "number": numero,
        "date": str(bill.get("date") or "")[:10],
        "total": bill.get("total"),
        "supplier": {"identification": ident},
        "provider": {"identification": ident, "name": provider.get("name") or ""},
        "provider_invoice": {"prefix": "", "number": numero},
        "observations": bill.get("observations") or "",
        "_fuente": "alegra",
    }


def obtener_facturas_compra_alegra(fecha_inicio: str) -> list:
    """Lista facturas de proveedor (GET /bills) desde `fecha_inicio` (YYYY-MM-DD),
    más nuevas primero. Normalizadas al shape de compras Siigo."""
    try:
        headers = _alegra_headers()
    except RuntimeError:
        return []

    desde = str(fecha_inicio or "")[:10]
    out: list[dict] = []
    start = 0
    while start < 3000:
        try:
            res = requests.get(
                f"{_ALEGRA_BASE}/bills",
                headers=headers,
                params={"limit": 30, "start": start, "order_field": "date", "order_direction": "DESC"},
                timeout=20,
            )
        except requests.RequestException:
            break
        if res.status_code != 200:
            break
        lote = res.json() or []
        if isinstance(lote, dict):
            lote = lote.get("data") or lote.get("results") or []
        if not lote:
            break
        mas_viejas = True
        for bill in lote:
            if not isinstance(bill, dict):
                continue
            fecha = str(bill.get("date") or "")[:10]
            if desde and fecha and fecha < desde:
                continue
            mas_viejas = False
            out.append(bill_alegra_a_shape_compra(bill))
        if len(lote) < 30:
            break
        # Si todo el lote es anterior al corte, no hay más que buscar.
        if mas_viejas and desde:
            break
        start += 30
    return out


def _detalle_venta_meli(order_id: str, *, token: str | None = None) -> dict | None:
    """Ítems (SKU/cantidad/precio) y total pagado de la venta real en MeLi —
    para el panel Astro Killer, comparar lado a lado "lo que se vendió" contra
    "lo que se facturó" y detectar a simple vista si no coinciden (monto
    parcial, SKU distinto, etc. — el mismo tipo de problema que causó los
    duplicados con monto parcial del 2026-09-03 en packs multi-orden).

    `token`: pasar uno ya refrescado al armar el detalle de varias ventas en
    lote — evita un refresh OAuth completo por cada orden."""
    try:
        from app.services.meli import consultar_orden_meli_completa, consultar_item_meli_basico

        orden = consultar_orden_meli_completa(order_id, token=token)
        if not orden:
            return None
        items = []
        for it in orden.get("order_items") or []:
            item_info = it.get("item") or {}
            sku = (item_info.get("seller_custom_field") or "").strip()
            if not sku:
                for attr in item_info.get("attributes") or []:
                    if attr.get("id") == "SELLER_SKU":
                        sku = (attr.get("value_name") or "").strip()
                        break
            if not sku and item_info.get("id"):
                detalle = consultar_item_meli_basico(item_info["id"], token=token)
                sku = (detalle or {}).get("seller_custom_field") or ""
            precio = it.get("unit_price")
            if precio is None:
                precio = item_info.get("unit_price")
            items.append({
                "sku": sku or "—",
                "nombre": item_info.get("title") or "Producto",
                "cantidad": float(it.get("quantity") or 1),
                "precio_unitario": float(precio or 0),
            })
        total = orden.get("total_amount")
        if total is None:
            total = sum(i["cantidad"] * i["precio_unitario"] for i in items)
        return {"total_pagado": float(total or 0), "items": items}
    except Exception:
        return None


def _detalle_venta_web(reference: str) -> dict | None:
    """Espejo de `_detalle_venta_meli` para pedidos web — lee `items_json` de
    la BD local de pedidos, sin llamadas a APIs externas."""
    try:
        import json as _json

        from app.tools.web_pedidos import get_order_by_reference

        order = get_order_by_reference(reference)
        if not order:
            return None
        data = _json.loads(order.get("items_json") or "{}")
        items = []
        for it in data.get("items") or []:
            items.append({
                "sku": (it.get("ref") or "").strip() or "—",
                "nombre": it.get("name") or "Producto",
                "cantidad": float(it.get("qty") or 1),
                "precio_unitario": float(it.get("price") or 0),
            })
        shipping = float(data.get("shipping") or 0)
        if shipping > 0:
            items.append({"sku": "ENVÍO", "nombre": "Envío", "cantidad": 1.0, "precio_unitario": shipping})
        return {"total_pagado": float(order.get("total") or 0), "items": items}
    except Exception:
        return None


# NOTA: `listar_ventas_meli_con_trazabilidad` (panel Astro Killer standalone)
# se retiró — su lógica (agrupar facturas Alegra por orden, cruzar con el
# índice legado, notas crédito, detalle de venta real) quedó fusionada en
# `app/services/facturacion_ventas_unificado.py::listar_ventas_meli_unificado`,
# que además recorre las ÓRDENES (no solo las facturas) para poder detectar
# "sin_facturar" — algo que esta función nunca pudo hacer.
