"""Los documentos detrás de cada número del libro, por una sola puerta.

Un asiento puede estar respaldado por varias cosas a la vez: la factura del
proveedor, el comprobante del giro, la línea del extracto, el documento soporte
transmitido a la DIAN, el comprobante espejado en Alegra. Hasta oct-2026 cada uno
vivía en una carpeta distinta con su propio endpoint (o sin ninguno), y el contador
no podía llegar a la factura de venta por su número ni al documento soporte en PDF.

`documentos_de_asiento()` reúne todo lo que respalda un asiento y `resolver()` sirve
cualquier documento por una referencia `tipo:id`:

    comprobante:<mov>            lo adjunto al asiento (cc_movimientos.soporte_path)
    adjunto:<id>                 adjuntos adicionales (cc_movimiento_adjuntos; factura + giro)
    solicitud_factura:<sid>      factura/cotización de la solicitud de pago
    solicitud_comprobante:<sid>  captura del giro de la solicitud
    factura_compra:<NIT>:<NUM>   factura electrónica del proveedor en facturas_descargadas/
    fe:FE123 · nc:NC45           factura / nota crédito nuestra (local o se baja de Alegra)
    ds:<sid>                     documento soporte (XML de Alegra + PDF propio)
    recibo:<numero>              recibo de pago de impuestos 490 / SDH
    declaracion:<ruta>           declaración presentada por el contador
    certificado:<archivo>        certificado de retención de Mercado Pago
    prestamo_contrato:<id>       contrato de mutuo
    extracto:<id>                archivo original del extracto bancario
    dian_listado:<AAAA-MM>       listado de documentos electrónicos de la DIAN

Todo archivo servido tiene que estar dentro de una raíz permitida: una referencia
no puede sacar nada fuera de `comprobantes/`, `facturas_descargadas/`,
`docs/contabilidad/`, los extractos o los contratos. Sin LLM.
"""
from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import re
import sqlite3
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parents[2]
_FACTURAS = _REPO / "facturas_descargadas"
_COMPROBANTES = _REPO / "comprobantes"
_DOCS_CONTABILIDAD = _REPO / "docs" / "contabilidad"
_EXTRACTOS = _REPO / "app" / "data" / "extractos_bancarios"
_PRESTAMOS = _REPO / "app" / "data" / "prestamos_documentos"
RAICES = (_COMPROBANTES, _FACTURAS, _DOCS_CONTABILIDAD, _EXTRACTOS, _PRESTAMOS)

URL_FACTURA_ALEGRA = "https://app.alegra.com/invoice/view/id/{id}"
URL_NOTA_ALEGRA = "https://app.alegra.com/credit-note/view/id/{id}"

_RE_REF = re.compile(r"^([a-z_]+):(.+)$")
_RE_PROPIA = re.compile(r"^(FE|NC)(\d+)$", re.I)

_sha_memo: dict[str, tuple[float, str]] = {}


def _dentro(p: Path) -> bool:
    try:
        rp = p.resolve()
    except OSError:
        return False
    return any(raiz.resolve() == rp or raiz.resolve() in rp.parents for raiz in RAICES)


def _mime(p: Path, default: str = "application/octet-stream") -> str:
    return mimetypes.guess_type(p.name)[0] or default


def sha256_archivo(p: Path) -> str | None:
    try:
        st = p.stat()
    except OSError:
        return None
    clave = str(p)
    memo = _sha_memo.get(clave)
    if memo and memo[0] == st.st_mtime:
        return memo[1]
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for bloque in iter(lambda: fh.read(1 << 16), b""):
            h.update(bloque)
    _sha_memo[clave] = (st.st_mtime, h.hexdigest())
    return h.hexdigest()


def _doc(ref: str, tipo: str, titulo: str, *, origen: str, archivo: Path | None = None,
         enlace: str | None = None, nota: str = "", mime: str | None = None) -> dict[str, Any]:
    disponible = bool(archivo and archivo.is_file() and _dentro(archivo))
    return {
        "ref": ref, "tipo": tipo, "titulo": titulo, "origen": origen,
        "disponible_local": disponible,
        "archivo": str(archivo.resolve().relative_to(_REPO)) if disponible else None,
        "mime": (mime or _mime(archivo)) if disponible else None,
        "bytes": archivo.stat().st_size if disponible else None,
        "sha256": sha256_archivo(archivo) if disponible else None,
        "enlace_externo": enlace,
        "nota": nota,
    }


# ── Documentos de un asiento ────────────────────────────────────────────────


def _solicitud(con: sqlite3.Connection, sid: int) -> dict | None:
    try:
        r = con.execute(
            "SELECT id, factura_numero, factura_archivo, factura_nombre, comprobante_archivo, comprobante_nombre "
            "FROM cc_solicitudes_pago WHERE id=?", (int(sid),),
        ).fetchone()
    except sqlite3.OperationalError:
        return None
    return dict(r) if r else None


def _adjuntos(con: sqlite3.Connection, movimiento_id: int) -> list[dict]:
    try:
        return [dict(r) for r in con.execute(
            "SELECT id, rol, archivo, nombre, mime FROM cc_movimiento_adjuntos WHERE movimiento_id=? ORDER BY id",
            (int(movimiento_id),),
        )]
    except sqlite3.OperationalError:   # la tabla llega con la fase 2
        return []


def _doc_soporte(con: sqlite3.Connection, movimiento_id: int, sid: int | None) -> dict | None:
    try:
        if sid:
            r = con.execute("SELECT solicitud_id, numero, cuds, estado FROM cc_doc_soporte WHERE solicitud_id=?",
                            (int(sid),)).fetchone()
            if r:
                return dict(r)
        r = con.execute("SELECT solicitud_id, numero, cuds, estado FROM cc_doc_soporte WHERE movimiento_id=?",
                        (int(movimiento_id),)).fetchone()
        return dict(r) if r else None
    except sqlite3.OperationalError:
        return None


def _xml_hermano(pdf: Path) -> Path | None:
    for cand in (pdf.with_suffix(".xml"), pdf.with_name("ad" + pdf.name[2:]).with_suffix(".xml") if pdf.name.startswith("fv") else None):
        if cand and cand.is_file():
            return cand
    return None


def _factura_propia_local(doc: str) -> Path | None:
    for nombre in (f"Factura_{doc}.pdf", f"NotaCredito_{doc}.pdf"):
        p = _FACTURAS / nombre
        if p.is_file():
            return p
    return None


def documentos_de_asiento(mov: dict[str, Any]) -> list[dict[str, Any]]:
    """Todo lo que respalda el asiento, en orden de utilidad para quien revisa."""
    import app.services.contabilidad_core as cc
    from app.services.contabilidad_documentos import documento_de_asiento, soporte_para

    mid = int(mov["id"])
    out: list[dict[str, Any]] = []
    try:
        datos = json.loads(mov.get("plantilla_datos_json") or "{}") or {}
    except ValueError:
        datos = {}
    sid = datos.get("solicitud_id")
    tercero = mov.get("tercero") or {}
    if not mov.get("tercero_identificacion") and tercero.get("identificacion"):
        mov = {**mov, "tercero_identificacion": tercero.get("identificacion")}

    with cc._conn() as con:
        # 1. Lo adjunto al asiento.
        r = cc.ruta_comprobante(mid)
        if r:
            ruta, mime, nombre = r
            out.append(_doc(f"comprobante:{mid}", "comprobante", nombre or "Comprobante del asiento",
                            origen="local", archivo=Path(ruta), mime=mime))
        for a in _adjuntos(con, mid):
            p = _REPO / a["archivo"]
            out.append(_doc(f"adjunto:{a['id']}", a["rol"] or "adjunto", a["nombre"] or p.name,
                            origen="local", archivo=p, mime=a.get("mime")))
        # 2. La solicitud de pago: factura y captura del giro.
        sol = _solicitud(con, int(sid)) if sid else None
        if sol:
            if sol.get("factura_archivo"):
                out.append(_doc(f"solicitud_factura:{sol['id']}", "factura_compra",
                                sol.get("factura_nombre") or f"Factura {sol.get('factura_numero') or ''}".strip(),
                                origen="local", archivo=_REPO / sol["factura_archivo"]))
            if sol.get("comprobante_archivo"):
                out.append(_doc(f"solicitud_comprobante:{sol['id']}", "comprobante_pago",
                                sol.get("comprobante_nombre") or "Comprobante del giro",
                                origen="local", archivo=_REPO / sol["comprobante_archivo"]))
        # 3. El documento electrónico que el asiento nombra.
        d = documento_de_asiento(mov)
        docs = [x.strip().upper() for x in (d["documento"] or "").split(",") if x.strip()]
        for doc in docs:
            if doc.startswith("RECIBO"):
                continue
            m = _RE_PROPIA.match(doc.replace(" ", "").replace("-", ""))
            if m and (not d["nit"] or any(str(c.get("cuenta_codigo", "")).startswith("41") for c in mov.get("lineas") or [])):
                pref, num = m.group(1).upper(), m.group(2)
                local = _factura_propia_local(f"{pref}{num}")
                enlace = (URL_FACTURA_ALEGRA if pref == "FE" else URL_NOTA_ALEGRA).format(id=num)
                out.append(_doc(f"{pref.lower()}:{pref}{num}", "factura_venta" if pref == "FE" else "nota_credito",
                                f"{'Factura' if pref == 'FE' else 'Nota crédito'} {pref}{num}",
                                origen="local" if local else "alegra", archivo=local, enlace=enlace,
                                nota="" if local else "No está en disco: se baja de Alegra al abrirla."))
            elif d["nit"]:
                hit = soporte_para(d["nit"], doc)
                out.append(_doc(f"factura_compra:{d['nit']}:{doc}", "factura_compra", f"Factura {doc}",
                                origen="local" if hit else "dian", archivo=hit,
                                nota="" if hit else "No está en facturas_descargadas/ (llega por correo del proveedor)."))
                if hit and hit.suffix.lower() == ".pdf":
                    xml = _xml_hermano(hit)
                    if xml:
                        out.append(_doc(f"factura_compra:{d['nit']}:{doc}:xml", "factura_compra_xml", f"XML {doc}",
                                        origen="local", archivo=xml, mime="application/xml"))
        # 4. Documento soporte transmitido a la DIAN.
        ds = _doc_soporte(con, mid, int(sid) if sid else None)
        if ds and ds.get("estado") == "success":
            out.append(_doc(f"ds:{ds['solicitud_id']}", "documento_soporte", f"Documento soporte {ds.get('numero') or ''}".strip(),
                            origen="alegra", nota=f"CUDS {str(ds.get('cuds') or '')[:16]}… · PDF y XML se arman de Alegra al abrir."))
            out[-1]["enlace_externo"] = None
            out[-1]["disponible_local"] = True   # se materializa al resolver
        # 5. Comprobante espejado en Alegra.
        try:
            esp = con.execute("SELECT alegra_journal_id FROM cc_alegra_espejo WHERE movimiento_id=?", (mid,)).fetchone()
        except sqlite3.OperationalError:
            esp = None
        if esp and esp[0]:
            from app.services.alegra_espejo import url_journal

            out.append(_doc(f"alegra_journal:{esp[0]}", "alegra_journal", f"Comprobante Alegra #{esp[0]}",
                            origen="alegra", enlace=url_journal(esp[0])))
    # 6. Préstamo: el contrato.
    ref = str(mov.get("referencia") or "")
    if mov.get("tipo_origen") in ("prestamo_recibido",) or ref.startswith("MUTUO"):
        try:
            with cc._conn() as con:
                r = con.execute("SELECT id FROM cc_prestamos WHERE movimiento_desembolso_id=?", (mid,)).fetchone()
            if r:
                out.append(_doc(f"prestamo_contrato:{r[0]}", "contrato", f"Contrato de préstamo #{r[0]}",
                                origen="local", nota="Se genera al abrir (PDF firmado)."))
                out[-1]["disponible_local"] = True
        except sqlite3.OperationalError:
            pass
    return out


# ── Resolver una referencia ─────────────────────────────────────────────────


def resolver(ref: str) -> tuple[Path, str, str] | None:
    """(ruta, mime, nombre de descarga) del documento, o None. Nunca sale de RAICES."""
    import app.services.contabilidad_core as cc

    m = _RE_REF.match((ref or "").strip())
    if not m:
        return None
    tipo, arg = m.group(1), m.group(2)
    if ".." in arg or arg.startswith("/"):
        return None
    ruta: Path | None = None
    mime: str | None = None
    nombre: str | None = None

    if tipo == "comprobante" and arg.isdigit():
        r = cc.ruta_comprobante(int(arg))
        if r:
            ruta, mime, nombre = Path(r[0]), r[1], r[2]
    elif tipo == "adjunto" and arg.isdigit():
        with cc._conn() as con:
            a = _adjuntos_por_id(con, int(arg))
        if a:
            ruta, mime, nombre = _REPO / a["archivo"], a.get("mime"), a.get("nombre")
    elif tipo in ("solicitud_factura", "solicitud_comprobante") and arg.isdigit():
        with cc._conn() as con:
            sol = _solicitud(con, int(arg))
        if sol:
            campo = "factura" if tipo == "solicitud_factura" else "comprobante"
            if sol.get(f"{campo}_archivo"):
                ruta, nombre = _REPO / sol[f"{campo}_archivo"], sol.get(f"{campo}_nombre")
    elif tipo == "factura_compra":
        partes = arg.split(":")
        if len(partes) >= 2:
            from app.services.contabilidad_documentos import soporte_para

            hit = soporte_para(partes[0], partes[1])
            if hit and len(partes) == 3 and partes[2] == "xml":
                hit = _xml_hermano(hit) if hit.suffix.lower() == ".pdf" else hit
            ruta = hit
    elif tipo in ("fe", "nc"):
        mm = _RE_PROPIA.match(arg.upper())
        if mm:
            ruta = _factura_propia_local(arg.upper()) or obtener_factura_propia(mm.group(1).upper(), int(mm.group(2)))
    elif tipo == "ds" and arg.isdigit():
        from app.services.doc_soporte_pagos import archivo_pdf

        ruta = archivo_pdf(int(arg))
    elif tipo == "ds_xml" and arg.isdigit():
        from app.services.doc_soporte_pagos import archivo_xml

        ruta, mime = archivo_xml(int(arg)), "application/xml"
    elif tipo == "recibo":
        from app.services.pagos_impuestos import _declaraciones

        for d in _declaraciones():
            if str(d.get("numero_formulario") or "") == arg and d.get("archivo"):
                ruta = _REPO / str(d["archivo"])
                break
    elif tipo == "declaracion":
        from app.services.declaraciones_impuestos import ruta_soporte

        ruta = ruta_soporte(arg)
    elif tipo == "certificado":
        from app.services.certificados_retencion import ruta_certificado

        ruta = ruta_certificado(arg)
    elif tipo == "prestamo_contrato" and arg.isdigit():
        from app.services.prestamos import generar_documento

        try:
            ruta = Path(generar_documento(int(arg), "contrato")["ruta"])
        except ValueError:
            ruta = None
    elif tipo == "extracto" and arg.isdigit():
        from app.services.extracto_bancario import ruta_archivo_extracto

        r = ruta_archivo_extracto(int(arg))
        if r:
            ruta, nombre = Path(r["path"]), r.get("nombre_descarga")
    elif tipo == "dian_listado" and re.fullmatch(r"\d{4}-\d{2}", arg):
        ruta = listado_dian(arg)

    if not ruta or not ruta.is_file() or not _dentro(ruta):
        return None
    return ruta, mime or _mime(ruta), nombre or ruta.name


def _adjuntos_por_id(con: sqlite3.Connection, adjunto_id: int) -> dict | None:
    try:
        r = con.execute("SELECT id, archivo, nombre, mime FROM cc_movimiento_adjuntos WHERE id=?", (adjunto_id,)).fetchone()
    except sqlite3.OperationalError:
        return None
    return dict(r) if r else None


def obtener_factura_propia(prefijo: str, numero: int) -> Path | None:
    """Baja de Alegra la factura/nota nuestra que no está en disco y la guarda como las demás."""
    from app.services.contabilidad_documentos import _pdf_alegra

    recurso = "invoices" if prefijo == "FE" else "credit-notes"
    try:
        pdf, _motivo = _pdf_alegra(recurso, int(numero), prefijo)
    except Exception:  # noqa: BLE001 — Alegra caído o sin red: el documento queda «en Alegra»
        return None
    if not pdf:
        return None
    _FACTURAS.mkdir(parents=True, exist_ok=True)
    destino = _FACTURAS / (f"Factura_{prefijo}{numero}.pdf" if prefijo == "FE" else f"NotaCredito_{prefijo}{numero}.pdf")
    destino.write_bytes(pdf)
    return destino


def listado_dian(periodo: str) -> Path | None:
    from app.services.dian_cruce import DIAN_DIR

    exactos = sorted(DIAN_DIR.glob(f"dian_{periodo}-01_{periodo}-*.xlsx"))
    if exactos:
        return exactos[-1]
    for p in sorted(DIAN_DIR.glob("dian_*.xlsx")):
        m = re.match(r"dian_(\d{4}-\d{2})-\d{2}_(\d{4}-\d{2})-\d{2}\.xlsx", p.name)
        if m and m.group(1) <= periodo <= m.group(2):
            return p
    return None
