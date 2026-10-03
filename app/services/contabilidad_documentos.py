"""NIT, número de documento y soporte de cada asiento — la llave con la que cruza el contador.

**Por qué existe (27-sep-2026).** El contador no lee el Libro Mayor asiento por asiento: lo
cruza contra lo que él ya tiene —el listado de facturas electrónicas de la DIAN, los extractos,
sus declaraciones— y la llave es siempre **NIT + número de factura + valor**. Hasta hoy ese
dato existía pero enterrado: en `referencia` con formatos distintos por módulo
(`compra:901567417:FECC1129`, `auto:<hash>`, `pago:8`…), en `plantilla_datos_json`, o fuera del
libro (el número de la factura de una venta MeLi vive en `facturacion_ventas_cache.db`). Los CSV
no lo traían en columna propia, y solo 30 de 1.574 asientos de septiembre tenían el soporte
adjunto aunque los PDF/XML ya estaban descargados en `facturas_descargadas/`.

Este módulo **no guarda nada nuevo** para responder «qué documento es»: lo deduce de lo que ya
está registrado, en este orden —

1. `referencia` con forma conocida (`compra:NIT:NUM`, `compra:NUM`, `ret:NUM`, `ra:NUM`, recibos
   `dian:490:` y `sdh:`).
2. `plantilla_datos_json`: venta MeLi → `order_id` → factura en el caché de facturación; venta
   web → pedido `MCKG-…` → factura; venta Siigo y compra del correo → su `referencia`; solicitud de
   pago → la factura de la solicitud.
3. Un «factura XXX» escrito en el concepto.

Lo único que sí escribe es `adjuntar_soportes(aplicar=True)`: enlaza (hardlink, sin duplicar
bytes) el PDF —o el XML si no hay PDF— al asiento que no tenía soporte. Nunca pisa uno ya
adjunto: ese lo puso una persona y manda.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
from pathlib import Path
from typing import Any

_RAIZ = Path(__file__).resolve().parents[2]
_FACTURAS_DIR = _RAIZ / "facturas_descargadas"
_VENTAS_CACHE_DB = _RAIZ / "app" / "data" / "facturacion_ventas_cache.db"

# Consumidor final: no es un NIT que el contador pueda cruzar.
_NIT_GENERICOS = {"222222222", "222222222222", "0", ""}

_RE_REF = [
    (re.compile(r"^compra:(\d{6,12}):(.+)$"), "nit_num"),
    (re.compile(r"^(?:compra|ret):(.+)$"), "num"),
    (re.compile(r"^ra:(.+)$"), "num"),
    (re.compile(r"^dian:490:(\d+)$"), "recibo_490"),
    (re.compile(r"^sdh:(\d+)$"), "recibo_sdh"),
]
# Identificadores internos (UUID de Alegra, hashes): no son un número que el contador cruce.
_RE_NO_ES_DOCUMENTO = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-|^[0-9a-f]{20,}$", re.IGNORECASE)
_RE_FACTURA_EN_TEXTO = re.compile(
    r"\bfactura\s+(?:n[.ºo°]*\s*)?([A-Z]{1,6}-?\d{2,}|\d{3,})", re.IGNORECASE
)


def _nit_limpio(v: Any) -> str:
    s = re.sub(r"[^0-9]", "", str(v or "").split("-")[0])
    return "" if s in _NIT_GENERICOS else s


# ── Caché de facturación de ventas (MeLi + web) ─────────────────────────────

_ventas_memo: dict[str, Any] = {"mtime": None, "por_orden": {}}


def _facturas_de_ventas() -> dict[str, dict[str, str]]:
    """order_id → {"numero", "cufe"}. Se recarga solo si la base cambió."""
    try:
        mtime = _VENTAS_CACHE_DB.stat().st_mtime
    except OSError:
        return {}
    if _ventas_memo["mtime"] == mtime:
        return _ventas_memo["por_orden"]
    por_orden: dict[str, dict[str, str]] = {}
    try:
        con = sqlite3.connect(f"file:{_VENTAS_CACHE_DB}?mode=ro", uri=True)
        for order_id, numero, payload in con.execute(
            "SELECT order_id, factura_numero, payload FROM ventas_cache"
        ):
            cufe = ""
            try:
                facs = (json.loads(payload or "{}").get("facturas") or [])
                if facs:
                    numero = numero or facs[0].get("numero") or ""
                    cufe = facs[0].get("cufe") or ""
            except ValueError:
                pass
            if numero:
                por_orden[str(order_id)] = {"numero": str(numero), "cufe": cufe}
        con.close()
    except sqlite3.Error:
        return _ventas_memo["por_orden"]
    _ventas_memo.update(mtime=mtime, por_orden=por_orden)
    return por_orden


# ── Documento de un asiento ─────────────────────────────────────────────────

def documento_de_asiento(
    mov: dict[str, Any],
    *,
    solicitudes: dict[int, dict[str, Any]] | None = None,
) -> dict[str, str]:
    """{"nit", "documento", "cufe"} del asiento, deducido de lo ya registrado.

    `mov` necesita `referencia`, `concepto` y `plantilla_datos_json`; si trae
    `tercero_identificacion`, ese NIT manda. `solicitudes` (id → fila) evita una
    consulta por asiento cuando se llama en lote.
    """
    ref = str(mov.get("referencia") or "").strip()
    nit = _nit_limpio(mov.get("tercero_identificacion"))
    documento = ""
    cufe = ""

    for rx, forma in _RE_REF:
        m = rx.match(ref)
        if not m:
            continue
        if forma == "nit_num":
            nit = nit or m.group(1)
            documento = m.group(2)
        elif forma == "recibo_490":
            documento = f"Recibo 490 {m.group(1)}"
        elif forma == "recibo_sdh":
            documento = f"Recibo SDH {m.group(1)}"
        else:
            documento = m.group(1)
        break

    try:
        datos = json.loads(mov.get("plantilla_datos_json") or "{}") or {}
    except ValueError:
        datos = {}
    fuente = datos.get("fuente") or ""
    extra = datos.get("extra") or {}

    # Anulación: el documento ante la DIAN es la nota crédito (NC145), no el
    # expediente interno (RA-2026-0030) que va en la referencia.
    if datos.get("nc"):
        documento = str(datos["nc"])
    if not documento:
        if fuente in ("meli_venta", "web_venta"):
            clave = str(extra.get("order_id") or datos.get("referencia") or "")
            fac = _facturas_de_ventas().get(clave)
            if fac:
                documento, cufe = fac["numero"], fac["cufe"]
        elif fuente in ("siigo_venta", "compra_gmail"):
            documento = str(datos.get("referencia") or "")
        elif datos.get("solicitud_id"):
            sol = (solicitudes or {}).get(int(datos["solicitud_id"])) or _solicitud(int(datos["solicitud_id"]))
            if sol:
                documento = str(sol.get("factura_numero") or "")
                m = _RE_REF[0][0].match(str(sol.get("referencia") or ""))
                if m:
                    documento = documento or m.group(2)

    if not nit:
        nit = _nit_limpio(extra.get("nit")) or (
            _nit_limpio(datos.get("contraparte")) if str(datos.get("contraparte") or "").isdigit() else ""
        )

    if _RE_NO_ES_DOCUMENTO.match(documento):
        documento = ""
    if not documento:
        m = _RE_FACTURA_EN_TEXTO.search(str(mov.get("concepto") or ""))
        if m:
            documento = m.group(1)

    return {"nit": nit, "documento": documento.strip(), "cufe": cufe}


def _solicitud(sid: int) -> dict[str, Any] | None:
    import app.services.contabilidad_core as cc

    try:
        with cc._conn() as con:
            r = con.execute(
                "SELECT id, factura_numero, referencia FROM cc_solicitudes_pago WHERE id=?", (sid,)
            ).fetchone()
    except sqlite3.OperationalError:     # base sin el módulo de pagos (pruebas, instalación nueva)
        return None
    return dict(r) if r else None


def solicitudes_por_id() -> dict[int, dict[str, Any]]:
    import app.services.contabilidad_core as cc

    try:
        with cc._conn() as con:
            return {
                r["id"]: dict(r)
                for r in con.execute("SELECT id, factura_numero, referencia FROM cc_solicitudes_pago")
            }
    except sqlite3.OperationalError:
        return {}


# ── Soportes en disco ───────────────────────────────────────────────────────

_indice_memo: dict[str, Any] = {"firma": None, "compras": {}}

_RE_SENDER_NIT = re.compile(
    r"<cac:SenderParty>.*?<cbc:CompanyID[^>]*>\s*(\d+)\s*</cbc:CompanyID>", re.S
)
_RE_PARENT_ID = re.compile(r"<cbc:ParentDocumentID>\s*([^<\s]+)\s*</cbc:ParentDocumentID>")
_RE_SUPPLIER_NIT = re.compile(
    r"<cac:AccountingSupplierParty>.*?<cbc:CompanyID[^>]*>\s*(\d+)\s*</cbc:CompanyID>", re.S
)
_RE_INVOICE_ID = re.compile(r"<cbc:ID>\s*([^<\s]+)\s*</cbc:ID>")


def _pdf_hermano(xml: Path) -> Path | None:
    """El PDF de la misma factura: mismo nombre, o `fv…` en vez de `ad…` (así lo nombra la DIAN)."""
    candidatos = [xml.with_suffix(".pdf")]
    if xml.name.startswith("ad"):
        candidatos.append(xml.with_name("fv" + xml.stem[2:] + ".pdf"))
    return next((c for c in candidatos if c.is_file()), None)


def indice_facturas_compra() -> dict[tuple[str, str], Path]:
    """(NIT emisor, número) → archivo de la factura (PDF si hay, si no el XML).

    Se arma leyendo los XML de `facturas_descargadas/` (el AttachedDocument de la DIAN
    trae el NIT del emisor y el número); el nombre del archivo no alcanza porque dos
    proveedores pueden usar el mismo número. Se recalcula solo si la carpeta cambió.
    """
    if not _FACTURAS_DIR.is_dir():
        return {}
    xmls = sorted(_FACTURAS_DIR.glob("*.xml"))
    firma = (len(xmls), _FACTURAS_DIR.stat().st_mtime)
    if _indice_memo["firma"] == firma:
        return _indice_memo["compras"]
    indice: dict[tuple[str, str], Path] = {}
    for x in xmls:
        try:
            txt = x.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        m_nit = _RE_SENDER_NIT.search(txt) or _RE_SUPPLIER_NIT.search(txt)
        m_num = _RE_PARENT_ID.search(txt) or _RE_INVOICE_ID.search(txt)
        if not (m_nit and m_num):
            continue
        clave = (m_nit.group(1), m_num.group(1).upper())
        # Si ya hay PDF para esa factura no se reemplaza por un XML.
        archivo = _pdf_hermano(x) or x
        if clave not in indice or indice[clave].suffix != ".pdf":
            indice[clave] = archivo
    _indice_memo.update(firma=firma, compras=indice)
    return indice


def soporte_para(nit: str, documento: str) -> Path | None:
    """El archivo que respalda ese documento, si está en disco."""
    if not documento:
        return None
    # Un pack de MeLi facturado en partes trae «FE52, FE88»: sirve el primero que esté.
    if "," in documento:
        return next(filter(None, (soporte_para(nit, d.strip()) for d in documento.split(","))), None)
    doc = documento.upper()
    if nit:
        hit = indice_facturas_compra().get((nit, doc))
        if hit:
            return hit
        directo = _FACTURAS_DIR / f"{nit}_{documento}.pdf"
        if directo.is_file():
            return directo
    # Documentos propios: facturas_descargadas/Factura_FE887.pdf, NotaCredito_NC145.pdf
    for nombre in (f"Factura_{documento}.pdf", f"NotaCredito_{documento}.pdf"):
        propia = _FACTURAS_DIR / nombre
        if propia.is_file():
            return propia
    return None


def _pedidos_sin_archivo(desde: str | None = None) -> list[dict[str, str]]:
    import app.services.contabilidad_core as cc

    desde = desde or os.getenv("CONTABILIDAD_FECHA_CORTE", "2026-09-01")
    with cc._conn() as con:
        movs = [dict(r) for r in con.execute(
            """SELECT m.id, m.concepto, m.referencia, m.plantilla_datos_json,
                      t.identificacion AS tercero_identificacion
                 FROM cc_movimientos m LEFT JOIN cc_terceros t ON t.id = m.tercero_id
                WHERE m.estado <> 'anulado' AND COALESCE(m.soporte_path,'') = '' AND m.fecha >= ?""",
            (desde,))]
    sols = solicitudes_por_id()
    faltan: dict[str, str] = {}
    for m in movs:
        d = documento_de_asiento(m, solicitudes=sols)
        for doc in filter(None, (x.strip() for x in d["documento"].split(","))):
            if not soporte_para(d["nit"], doc):
                faltan.setdefault(doc, d["nit"])
    return [{"documento": k, "nit": v} for k, v in sorted(faltan.items())]


def _pdf_alegra(recurso: str, numero: int, prefijo: str) -> tuple[bytes | None, str]:
    """PDF de una factura/nota de Alegra, comprobando que el documento sea ESE número.

    En Alegra el id suele coincidir con el consecutivo (FE310 → /invoices/310), pero no
    se asume: si el documento que vuelve trae otro número, no se guarda nada — un
    soporte equivocado pegado a un asiento es peor que ninguno.
    """
    import requests

    from app.services.alegra import _ALEGRA_BASE, _alegra_headers

    ident = numero
    if recurso == "credit-notes":
        # En notas crédito el id NO sigue al consecutivo (NC145 es el id 118): se busca.
        ident = _id_nota_credito(prefijo, numero)
        if not ident:
            return None, "no aparece entre las notas crédito de Alegra"
    r = requests.get(f"{_ALEGRA_BASE}/{recurso}/{ident}", headers=_alegra_headers(),
                     params={"fields": "pdf"}, timeout=20)
    if r.status_code != 200:
        return None, f"Alegra respondió {r.status_code}"
    j = r.json() or {}
    nt = j.get("numberTemplate") or {}
    visto = f"{nt.get('prefix') or ''}{nt.get('number') or ''}"
    if visto.upper() != f"{prefijo}{numero}".upper():
        return None, f"el id {numero} es {visto or 'otro documento'}"
    if not j.get("pdf"):
        return None, "sin PDF en Alegra"
    pdf = requests.get(j["pdf"], timeout=30)
    if pdf.status_code != 200 or not pdf.content.startswith(b"%PDF"):
        return None, "no se pudo bajar el PDF"
    return pdf.content, ""


def _id_nota_credito(prefijo: str, numero: int, paginas: int = 10) -> str | None:
    import requests

    from app.services.alegra import _ALEGRA_BASE, _alegra_headers

    for i in range(paginas):
        r = requests.get(f"{_ALEGRA_BASE}/credit-notes", headers=_alegra_headers(), timeout=20,
                         params={"start": i * 30, "limit": 30, "order_field": "id", "order_direction": "DESC"})
        lote = r.json() if r.status_code == 200 else []
        for nc in lote or []:
            nt = nc.get("numberTemplate") or {}
            if (nt.get("prefix") or "").upper() == prefijo and str(nt.get("number")) == str(numero):
                return str(nc["id"])
        if len(lote or []) < 30:
            return None
    return None


def descargar_soportes_faltantes(desde: str | None = None, *, aplicar: bool = False) -> dict:
    """Baja de Alegra los PDF de facturas (FE…) y notas crédito (NC…) propias que el
    libro nombra pero no están en `facturas_descargadas/`. Luego hay que correr
    `adjuntar_soportes(aplicar=True)` (o esperar al cron de las 00:40).

    Las facturas de Siigo (FV-…) anteriores a la migración no se bajan acá: Siigo ya no
    es el sistema de facturación y su id no está en el libro — quedan listadas aparte.
    """
    import time

    faltan = _pedidos_sin_archivo(desde)
    bajados, fallos, otros = [], [], []
    for f in faltan:
        doc = f["documento"]
        m = re.fullmatch(r"(FE|NC)(\d+)", doc, re.IGNORECASE)
        if not m:
            otros.append(doc)
            continue
        if not aplicar:
            bajados.append(doc)
            continue
        prefijo, numero = m.group(1).upper(), int(m.group(2))
        recurso, nombre = (("invoices", f"Factura_{doc}.pdf") if prefijo == "FE"
                           else ("credit-notes", f"NotaCredito_{doc}.pdf"))
        try:
            pdf, motivo = _pdf_alegra(recurso, numero, prefijo)
        except Exception as e:  # noqa: BLE001 — uno que falle no frena el lote
            pdf, motivo = None, str(e)
        if pdf:
            (_FACTURAS_DIR / nombre).write_bytes(pdf)
            bajados.append(doc)
        else:
            fallos.append({"documento": doc, "motivo": motivo})
        time.sleep(0.4)   # Alegra limita por minuto; son decenas, no miles
    return {"aplicado": aplicar, "faltaban": len(faltan), "bajados": bajados,
            "fallos": fallos, "no_alegra": otros}


def adjuntar_soportes(desde: str | None = None, hasta: str | None = None, *, aplicar: bool = False) -> dict:
    """Adjunta el PDF/XML ya descargado a cada asiento sin soporte.

    Por defecto **solo informa** (qué adjuntaría y qué no encuentra). Con `aplicar=True`
    enlaza el archivo en `comprobantes/contabilidad/` (hardlink; copia si el disco no
    lo permite) y lo registra en el asiento. Antes del corte no toca nada: esos
    períodos los lleva el contador.
    """
    import app.services.contabilidad_core as cc

    desde = desde or os.getenv("CONTABILIDAD_FECHA_CORTE", "2026-09-01")
    where, params = ["m.estado <> 'anulado'", "COALESCE(m.soporte_path,'') = ''", "m.fecha >= ?"], [desde]
    if hasta:
        where.append("m.fecha <= ?")
        params.append(hasta)
    with cc._conn() as con:
        movs = [dict(r) for r in con.execute(
            f"""SELECT m.id, m.fecha, m.tipo_origen, m.concepto, m.referencia, m.plantilla_datos_json,
                       t.identificacion AS tercero_identificacion
                  FROM cc_movimientos m LEFT JOIN cc_terceros t ON t.id = m.tercero_id
                 WHERE {' AND '.join(where)} ORDER BY m.fecha, m.id""", params)]
    sols = solicitudes_por_id()

    adjuntados, sin_archivo, sin_documento = [], [], []
    por_tipo: dict[str, dict[str, int]] = {}
    for m in movs:
        d = documento_de_asiento(m, solicitudes=sols)
        t = por_tipo.setdefault(m["tipo_origen"] or "?", {"adjunta": 0, "sin_archivo": 0, "sin_documento": 0})
        if not d["documento"]:
            t["sin_documento"] += 1
            sin_documento.append(m["id"])
            continue
        archivo = soporte_para(d["nit"], d["documento"])
        if not archivo:
            t["sin_archivo"] += 1
            sin_archivo.append({"id": m["id"], "nit": d["nit"], "documento": d["documento"]})
            continue
        t["adjunta"] += 1
        adjuntados.append({"id": m["id"], "documento": d["documento"], "archivo": archivo.name})
        if aplicar:
            _enlazar(cc, m["id"], archivo)

    return {
        "aplicado": aplicar, "desde": desde, "hasta": hasta,
        "revisados": len(movs), "adjuntados": len(adjuntados),
        "sin_archivo": len(sin_archivo), "sin_documento": len(sin_documento),
        "por_tipo": por_tipo,
        "muestra_adjuntados": adjuntados[:10],
        "muestra_sin_archivo": sin_archivo[:20],
    }


def _enlazar(cc, movimiento_id: int, archivo: Path) -> None:
    destino_dir = Path(cc._COMPROBANTES_DIR)
    destino_dir.mkdir(parents=True, exist_ok=True)
    nombre = f"mov{movimiento_id}_{archivo.name}"
    destino = destino_dir / nombre
    if not destino.exists():
        try:
            os.link(archivo, destino)
        except OSError:
            import shutil

            shutil.copy2(archivo, destino)
    mime = "application/pdf" if archivo.suffix.lower() == ".pdf" else "application/xml"
    with cc._conn() as con:
        # Solo si sigue sin soporte: uno puesto a mano entre la lectura y ahora manda.
        con.execute(
            "UPDATE cc_movimientos SET soporte_path=?, soporte_nombre=?, soporte_mime=?"
            " WHERE id=? AND COALESCE(soporte_path,'')=''",
            (nombre, archivo.name, mime, int(movimiento_id)),
        )


def url_soporte(movimiento_id: int) -> str:
    """Enlace que el contador abre desde Excel: funciona con su sesión del panel en el navegador."""
    base = (os.getenv("PANEL_URL_PUBLICA") or "https://bot.mckennagroup.co").rstrip("/")
    return f"{base}/app/api/contabilidad/cc/movimientos/{int(movimiento_id)}/comprobante"
