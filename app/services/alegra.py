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
"""

import base64
import os
from datetime import datetime, timedelta

import requests

_ALEGRA_BASE = "https://api.alegra.com/api/v1"

NIT_CONSUMIDOR_FINAL_MELI = (os.getenv("SIIGO_MELI_NIT_CONSUMIDOR_FINAL", "222222222222") or "222222222222").strip()
NOMBRE_CONSUMIDOR_FINAL_MELI = "Consumidor Final"

_contacto_cache: dict[str, str] = {}  # identificacion -> alegra contact id (proceso actual)
_producto_cache: dict[str, dict] = {}  # sku -> {"id":..., "price":...} (proceso actual)


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
    out = {
        "id": item.get("id"), "name": item.get("name"), "price": precio,
        "tax_ids": tax_ids, "tax_rate_total": tax_rate_total,
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


def _resolver_o_crear_contacto_alegra(
    *, nombre: str, identificacion: str, email: str = "", telefono: str = "", direccion: str = "",
) -> str | None:
    """Busca un contacto por identificación; si no existe, lo crea. Retorna el id de Alegra."""
    identificacion = "".join(ch for ch in str(identificacion or "") if ch.isdigit())
    if not identificacion:
        return None
    if identificacion in _contacto_cache:
        return _contacto_cache[identificacion]

    headers = _alegra_headers()
    res = requests.get(
        f"{_ALEGRA_BASE}/contacts", headers=headers,
        params={"identification": identificacion, "limit": 5}, timeout=15,
    )
    if res.status_code == 200:
        resultados = res.json() or []
        if resultados:
            cid = str(resultados[0].get("id"))
            _contacto_cache[identificacion] = cid
            return cid

    es_consumidor_final = identificacion == "".join(ch for ch in NIT_CONSUMIDOR_FINAL_MELI if ch.isdigit())
    payload = {
        "name": nombre or NOMBRE_CONSUMIDOR_FINAL_MELI,
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
        payload["address"] = {"address": direccion}

    res = requests.post(f"{_ALEGRA_BASE}/contacts", headers=headers, json=payload, timeout=20)
    if res.status_code not in (200, 201):
        print(f"⚠️ Alegra: no se pudo crear contacto {identificacion}: {res.text[:300]}")
        return None
    cid = str(res.json().get("id"))
    _contacto_cache[identificacion] = cid
    return cid


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
    (el `tax_ids` de Siigo no aplica igual acá — el IVA se resuelve por
    ALEGRA_IVA_TAX_ID/producto en Alegra, ver TODO al final de este archivo).
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

    contacto_id = _resolver_o_crear_contacto_alegra(
        nombre=nombre_cliente, identificacion=identificacion_digits,
        email=email, telefono=telefono, direccion=direccion_envio,
    )
    if not contacto_id:
        return {"ok": False, "error": f"No se pudo resolver/crear el contacto {identificacion_digits} en Alegra."}

    tax_id = _env_int("ALEGRA_IVA_TAX_ID")  # TODO: confirmar el id real del IVA 19% en la cuenta

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
        producto_tax_ids = producto_alegra.get("tax_ids") or ([tax_id] if tax_id else [])
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
            "data": factura,
            "payload": payload,
        }
    except requests.RequestException as e:
        return {"ok": False, "error": f"Error de red con Alegra: {e}"}
    except Exception as e:
        return {"ok": False, "error": f"Error crítico creando factura Alegra: {e}"}


def descargar_factura_pdf_alegra(factura_id: str) -> str:
    """Retorna el PDF en base64, o "" si falla.
    TODO: validar contra una respuesta real — la doc pública no confirma el campo
    exacto; se intenta `stamp.fileB64` / `stamp.pdf` y si no, se resuelve manual."""
    try:
        headers = _alegra_headers()
        res = requests.get(f"{_ALEGRA_BASE}/invoices/{factura_id}", headers=headers, timeout=20)
        if res.status_code != 200:
            return ""
        data = res.json()
        stamp = data.get("stamp") or {}
        for campo in ("fileB64", "pdf", "file"):
            if stamp.get(campo):
                return stamp[campo]
    except Exception as e:
        print(f"⚠️ No se pudo descargar PDF Alegra {factura_id}: {e}")
    return ""
