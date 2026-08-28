"""
Índice de conciliación: ventas MeLi ↔ factura Siigo ↔ nota crédito.

Se apoya en el fetch de facturas que ya hace scripts/emitir_notas_credito_cron.py
(paginación completa de Siigo, ~90-95 días) — no dispara llamadas extra a Siigo:
cuando ese cron corre, además de emitir notas crédito, construye y persiste este
índice pack_id -> factura para que el panel "Ventas y NC" (Contabilidad →
Facturación) lo lea al instante en vez de repetir la paginación en cada carga.

Origen: hasta ahora la única forma de saber "¿esta venta cancelada ya tiene nota
crédito confiable?" era revisar Siigo y MeLi a mano, pack por pack.
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
INDICE_PATH = REPO / "app" / "data" / "facturacion_meli_index.json"
NC_ESTADO_PATH = REPO / "app" / "data" / "notas_credito_auto_log.json"

# Formatos vistos en observations de Siigo:
#   "Venta Mercado Libre #2000014481818717 - Facturado desde astroselling.com"
_RE_PACK = re.compile(r"Mercado ?Libre[^\d]{0,10}#?\s*(\d{9,17})", re.I)


def _texto_factura(f: dict) -> str:
    return f"{f.get('observations', '')} {f.get('purchase_order', '')}"


def _clasificar_integracion(texto: str) -> str:
    t = texto.lower()
    if "astroselling" in t:
        return "astroselling"
    if "mercado libre" in t or "mercadolibre" in t:
        return "mckenna"
    return "otro"


def _numero_factura_ordenable(f: dict) -> int:
    """Número de documento Siigo como entero, para saber cuál factura es la
    más reciente cuando un mismo pack_id tiene varias (ej. anulada por nota
    crédito y reemplazada). -1 si no viene o no es numérico."""
    try:
        return int(f.get("number"))
    except (TypeError, ValueError):
        return -1


def construir_indice_facturacion_meli(facturas: list[dict]) -> dict[str, dict]:
    """A partir de una lista de facturas Siigo ya obtenida, extrae las que
    referencian una venta MeLi (por pack_id en observations) y arma el índice.

    Un pack_id puede tener más de una factura (la original y su reemplazo tras
    una nota crédito — p. ej. corrección de IVA duplicado o de NIT/comprador).
    Se queda con la de mayor `number` (documento Siigo más reciente), no con
    la última que aparezca en `facturas` — antes de este fix, una orden con
    varias facturas terminaba con la que quedara al final de la lista sin
    importar cuál era la vigente, dejando el índice apuntando a facturas ya
    anuladas.
    """
    indice: dict[str, dict] = {}
    numeros: dict[str, int] = {}
    for f in facturas:
        texto = _texto_factura(f)
        m = _RE_PACK.search(texto)
        if not m:
            continue
        pack_id = m.group(1)
        numero = _numero_factura_ordenable(f)
        if pack_id in numeros and numero <= numeros[pack_id]:
            continue
        numeros[pack_id] = numero
        indice[pack_id] = {
            "factura_id": f.get("id"),
            "factura_numero": f.get("name") or str(f.get("number") or ""),
            "factura_fecha": f.get("date"),
            "total": f.get("total"),
            "integracion": _clasificar_integracion(texto),
        }
    return indice


def guardar_indice_facturacion_meli(indice: dict[str, dict]) -> None:
    INDICE_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {"actualizado_en": datetime.now().isoformat(timespec="seconds"), "indice": indice}
    tmp = INDICE_PATH.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, INDICE_PATH)


def leer_indice_facturacion_meli() -> dict:
    try:
        with open(INDICE_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
            if isinstance(data, dict) and isinstance(data.get("indice"), dict):
                return data
    except Exception:
        pass
    return {"actualizado_en": None, "indice": {}}


def _leer_estado_notas_credito() -> dict:
    try:
        with open(NC_ESTADO_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
            if isinstance(data, dict) and isinstance(data.get("procesadas"), dict):
                return data["procesadas"]
    except Exception:
        pass
    return {}


def _margen_horas_default() -> float:
    try:
        return float(os.getenv("NOTAS_CREDITO_MARGEN_HORAS", "48") or "48")
    except ValueError:
        return 48.0


def _fecha_cancelacion(orden: dict) -> datetime | None:
    fecha_txt = (
        (orden.get("cancel_detail") or {}).get("date")
        or orden.get("date_closed")
        or orden.get("date_created")
    )
    if not fecha_txt:
        return None
    try:
        return datetime.fromisoformat(fecha_txt.replace("Z", "+00:00"))
    except ValueError:
        return None


def listar_ventas_meli_conciliacion(estado: str, dias: int = 30) -> dict:
    """
    estado: "canceladas" | "concretadas"

    Cruza MeLi (en vivo, liviano — solo /orders/search) con el índice local
    de facturación (persistido por el cron de notas crédito, sin llamadas
    extra a Siigo) y el estado ya conocido de notas crédito.
    """
    from app.services.meli import listar_ordenes_meli_por_estado

    indice_data = leer_indice_facturacion_meli()
    indice = indice_data["indice"]
    nc_estado = _leer_estado_notas_credito()

    status_meli = "cancelled" if estado == "canceladas" else "paid"
    ordenes = listar_ordenes_meli_por_estado(status_meli, dias_atras=dias)
    margen_horas = _margen_horas_default()

    # Total pagado por pack (no por orden): un pack puede tener varias
    # órdenes MeLi y la factura Siigo cubre el pack completo — comparar la
    # factura contra una sola orden de un pack multi-orden daría una
    # discrepancia falsa.
    total_pagado_pack: dict[str, float] = {}
    for orden in ordenes:
        pid = str(orden.get("pack_id") or orden.get("id") or "").strip()
        if pid:
            total_pagado_pack[pid] = total_pagado_pack.get(pid, 0) + (orden.get("total_amount") or 0)

    ventas = []
    for orden in ordenes:
        pack_id = str(orden.get("pack_id") or orden.get("id") or "").strip()
        if not pack_id:
            continue
        fact = indice.get(pack_id)
        nc = nc_estado.get(pack_id)

        total_pack = total_pagado_pack.get(pack_id) or orden.get("total_amount") or 0
        factura_total = fact.get("total") if fact else None
        iva_discrepancia = (
            factura_total is not None
            and total_pack
            and not (0.97 <= (factura_total / total_pack) <= 1.03)
        )

        fila = {
            "pack_id": pack_id,
            "fecha": orden.get("date_closed") or orden.get("date_created"),
            "total": orden.get("total_amount"),
            "factura_numero": fact.get("factura_numero") if fact else None,
            "factura_total": factura_total,
            "iva_discrepancia": bool(iva_discrepancia),
            "integracion": fact.get("integracion") if fact else None,
            "nota_credito": nc.get("nc") if nc else None,
            "nc_subida_meli": bool(nc.get("subida_meli")) if nc else None,
        }

        if estado == "canceladas":
            if not fact:
                fila["estado_auditoria"] = "sin_factura"
            elif nc:
                fila["estado_auditoria"] = "resuelto" if nc.get("subida_meli") else "nc_sin_subir_meli"
            else:
                fc = _fecha_cancelacion(orden)
                if fc:
                    ahora = datetime.now(fc.tzinfo) if fc.tzinfo else datetime.now()
                    en_margen = (ahora - fc) < timedelta(hours=margen_horas)
                else:
                    en_margen = False
                fila["estado_auditoria"] = "en_margen" if en_margen else "pendiente_revisar"
        else:
            if not fact:
                fila["estado_auditoria"] = "sin_facturar"
            elif iva_discrepancia:
                fila["estado_auditoria"] = "iva_incorrecto"
            else:
                fila["estado_auditoria"] = "facturada"

        ventas.append(fila)

    return {"actualizado_en": indice_data.get("actualizado_en"), "ventas": ventas}


def obtener_documento_pdf(pack_id: str, tipo: str) -> dict:
    """
    tipo: "factura" | "nota_credito". Descarga el PDF correspondiente desde
    Siigo bajo demanda (no se cachea: son pocos por click, a diferencia del
    índice que se reconstruye una vez al día).
    """
    from app.services.siigo import descargar_factura_pdf_siigo, descargar_nota_credito_pdf_siigo

    pack_id = str(pack_id or "").strip()
    indice = leer_indice_facturacion_meli()["indice"]
    fact = indice.get(pack_id)

    if tipo == "factura":
        if not fact or not fact.get("factura_id"):
            return {"ok": False, "error": "No hay factura indexada para este pack."}
        b64 = descargar_factura_pdf_siigo(fact["factura_id"])
        if not b64 or "Error" in str(b64):
            return {"ok": False, "error": f"No se pudo descargar el PDF: {b64}"}
        return {"ok": True, "nombre": f"{fact.get('factura_numero') or pack_id}.pdf", "base64": b64}

    if tipo == "nota_credito":
        nc = _leer_estado_notas_credito().get(pack_id)
        if not nc or not nc.get("nc"):
            return {"ok": False, "error": "No hay nota crédito registrada para este pack."}
        # El estado local solo guarda el nombre (ej. NC-2-133), no el id de
        # Siigo — hay que resolverlo antes de poder pedir el PDF.
        nc_id = _resolver_id_nota_credito(nc["nc"])
        if not nc_id:
            return {"ok": False, "error": f"No se encontró en Siigo la nota crédito {nc['nc']}."}
        b64 = descargar_nota_credito_pdf_siigo(nc_id)
        if not b64 or "Error" in str(b64):
            return {"ok": False, "error": f"No se pudo descargar el PDF: {b64}"}
        return {"ok": True, "nombre": f"{nc['nc']}.pdf", "base64": b64}

    return {"ok": False, "error": f"Tipo de documento desconocido: {tipo}"}


def _resolver_id_nota_credito(nombre_nc: str, dias_atras: int = 180) -> str | None:
    from app.services.siigo import autenticar_siigo, PARTNER_ID
    import requests

    token = autenticar_siigo()
    if not token:
        return None
    headers = {"Authorization": f"Bearer {token}", "Partner-Id": PARTNER_ID}
    desde = (datetime.now() - timedelta(days=dias_atras)).strftime("%Y-%m-%d")
    hasta = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
    page = 1
    while True:
        try:
            res = requests.get(
                "https://api.siigo.com/v1/credit-notes",
                params={"created_start": desde, "created_end": hasta, "page_size": 100, "page": page},
                headers=headers, timeout=20,
            )
        except requests.RequestException:
            return None
        if res.status_code != 200:
            return None
        data = res.json()
        for nc in data.get("results", []):
            if nc.get("name") == nombre_nc:
                return nc.get("id")
        total = (data.get("pagination") or {}).get("total_results", 0)
        if page * 100 >= total:
            break
        page += 1
    return None
