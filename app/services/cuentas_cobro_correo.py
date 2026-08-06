"""
Cuentas de cobro / facturas de proveedor detectadas en Gmail.

Incluye:
- PDFs «cuenta de cobro» (p. ej. William Novoa)
- Facturas electrónicas NEXT ENVIOS / Fidel Rocha (isiigo ZIP+XML)

Persistencia: app/data/cuentas_cobro_correo.json
"""
from __future__ import annotations

import json
import os
import re
import zipfile
from datetime import datetime
from email.header import decode_header
from email.utils import parsedate_to_datetime
from io import BytesIO
from typing import Any

_DATA_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "cuentas_cobro_correo.json",
)

_MES = {
    "enero": "01",
    "febrero": "02",
    "marzo": "03",
    "abril": "04",
    "mayo": "05",
    "junio": "06",
    "julio": "07",
    "agosto": "08",
    "septiembre": "09",
    "octubre": "10",
    "noviembre": "11",
    "diciembre": "12",
}

_NEXT_NIT = "901461116"


def _dec(s: Any) -> str:
    if not s:
        return ""
    out = []
    for p, enc in decode_header(s):
        out.append(p.decode(enc or "utf-8", errors="replace") if isinstance(p, bytes) else p)
    return "".join(out)


def _parse_periodo(filename: str, concepto: str, subj: str) -> tuple[str | None, str | None]:
    blob = f"{filename} {concepto} {subj}".lower()
    for a, b in (("á", "a"), ("é", "e"), ("í", "i"), ("ó", "o"), ("ú", "u")):
        blob = blob.replace(a, b)
    fn = filename.lower().replace("á", "a")
    m = re.search(
        r"(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)[_\s-]*(\d{4})",
        fn,
    )
    if m:
        return m.group(2), _MES[m.group(1)]
    m = re.search(
        r"mes\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+(\d{4})",
        blob,
    )
    if m:
        return m.group(2), _MES[m.group(1)]
    m = re.search(
        r"(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+(\d{4})",
        blob,
    )
    if m:
        return m.group(2), _MES[m.group(1)]
    return None, None


def cargar_cobros() -> list[dict[str, Any]]:
    if not os.path.isfile(_DATA_PATH):
        return []
    try:
        with open(_DATA_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return list(data.get("cobros") or [])
    except Exception:
        return []


def guardar_cobros(cobros: list[dict[str, Any]]) -> None:
    os.makedirs(os.path.dirname(_DATA_PATH), exist_ok=True)
    with open(_DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(
            {"actualizado_en": datetime.now().isoformat(timespec="seconds"), "cobros": cobros},
            f,
            ensure_ascii=False,
            indent=2,
        )


def _parse_isiigo_xml(xml_bytes: bytes) -> tuple[str | None, float | None, str | None]:
    """Extrae IssueDate, PayableAmount y número (ParentDocumentID / FVE…)."""
    try:
        text = xml_bytes.decode("utf-8", errors="replace")
    except Exception:
        return None, None, None
    monto = None
    m = re.search(r"PayableAmount[^>]*>\s*([0-9]+(?:\.[0-9]+)?)", text)
    if m:
        try:
            monto = float(m.group(1))
        except ValueError:
            monto = None
    if not monto:
        m = re.search(r"TaxInclusiveAmount[^>]*>\s*([0-9]+(?:\.[0-9]+)?)", text)
        if m:
            try:
                monto = float(m.group(1))
            except ValueError:
                monto = None
    fecha = None
    m = re.search(r"IssueDate>\s*([0-9]{4}-[0-9]{2}-[0-9]{2})", text)
    if m:
        fecha = m.group(1)
    num = None
    m = re.search(r"ParentDocumentID>\s*([A-Za-z0-9\-]+)", text)
    if m:
        num = m.group(1).strip()
    if not num:
        m = re.search(r"\b(FVE\d+)\b", text)
        if m:
            num = m.group(1)
    return fecha, monto, num


def _imap_login():
    import imaplib
    from dotenv import load_dotenv

    load_dotenv()
    user = os.getenv("SMTP_USER") or os.getenv("EMAIL_FROM") or ""
    password = os.getenv("SMTP_PASSWORD") or os.getenv("EMAIL_PASSWORD") or ""
    if not user or not password:
        raise RuntimeError("Faltan SMTP_USER / SMTP_PASSWORD para leer Gmail")
    M = imaplib.IMAP4_SSL("imap.gmail.com")
    M.login(user, password)
    return M


def _select(M, box: str) -> bool:
    name = f'"{box}"' if (" " in box or box.startswith("[")) else box
    typ, _ = M.select(name)
    return typ == "OK"


def _collect_william_pdfs(M, boxes: list[str]) -> tuple[list[dict], int]:
    from PyPDF2 import PdfReader
    import email

    cobros_raw: list[dict[str, Any]] = []
    ids_total = 0
    for box in boxes:
        if not _select(M, box):
            continue
        ids: set[bytes] = set()
        for q in (
            '(SUBJECT "cuenta de cobro")',
            '(SUBJECT "CUENTA DE COBRO")',
            '(BODY "cuenta de cobro")',
        ):
            typ, data = M.search(None, q)
            for mid in data[0].split() if data and data[0] else []:
                ids.add(mid)
        ids_total += len(ids)
        for mid in ids:
            typ, data = M.fetch(mid, "(RFC822)")
            msg = email.message_from_bytes(data[0][1])
            subj = _dec(msg.get("Subject"))
            frm = msg.get("From", "") or ""
            date = msg.get("Date")
            try:
                ed = parsedate_to_datetime(date)
            except Exception:
                continue
            for part in msg.walk():
                fn = part.get_filename()
                if not fn:
                    continue
                fn = _dec(fn)
                if not fn.lower().endswith(".pdf"):
                    continue
                if not re.search(r"cobro|honorario", fn + " " + subj, re.I):
                    if not re.search(r"cuenta\s*de\s*cobro", subj, re.I):
                        continue
                payload = part.get_payload(decode=True) or b""
                if len(payload) < 500:
                    continue
                try:
                    text = "\n".join((p.extract_text() or "") for p in PdfReader(BytesIO(payload)).pages)
                except Exception:
                    text = ""
                m = re.search(r"GIRAR[:\s.…]*([\d.,]+)", text, re.I)
                if not m:
                    m = re.search(r"OPERACI[OÓ]N[:\s.…]*([\d.,\s]+)\s*\$", text, re.I)
                monto = None
                if m:
                    s = re.sub(r"\s+", "", m.group(1)).replace(",", "")
                    try:
                        monto = float(s)
                    except ValueError:
                        monto = None
                if not monto or monto < 1000:
                    continue
                # omitir cotizaciones / pruebas
                if re.search(r"cotizacion|prueba|habilitacion", fn + " " + subj, re.I):
                    continue
                cm = re.search(r"CONCEPTO:\s*(.+?)(?:PERTENESCO|FIRMA|$)", text, re.S | re.I)
                concepto = re.sub(r"\s+", " ", cm.group(1)).strip() if cm else subj
                benef = ""
                bm = re.search(r"BENEFICIARIO DEL\s+PAGO[^\n]*\n([^\n]+)", text, re.I)
                if bm:
                    benef = re.sub(r"\s+", " ", bm.group(1)).strip()[:80]
                if not benef:
                    bm = re.search(r"A NOMBRE\s+([^\n]+)", text, re.I)
                    if bm:
                        benef = re.sub(r"\s+", " ", bm.group(1)).strip()[:80]
                anio, mes = _parse_periodo(fn, concepto, subj)
                if anio and mes:
                    fecha = f"{anio}-{mes}-28"
                    periodo = f"{anio}-{mes}"
                else:
                    fecha = ed.strftime("%Y-%m-%d")
                    periodo = fecha[:7]
                cobros_raw.append(
                    {
                        "mid": mid.decode(),
                        "from": frm,
                        "email_date": ed.strftime("%Y-%m-%d"),
                        "subject": subj,
                        "filename": fn,
                        "monto": round(monto, 2),
                        "concepto": (concepto or "")[:200],
                        "beneficiario": benef or "William Fernando Novoa Molano",
                        "fecha": fecha,
                        "periodo": periodo,
                        "proveedor": "william",
                        "email_ts": ed.timestamp(),
                    }
                )
    return cobros_raw, ids_total


def _collect_fidel_next(M, boxes: list[str]) -> tuple[list[dict], int]:
    """Facturas NEXT ENVIOS (Fidel Rocha) vía facturacion@isiigo.com."""
    import email

    cobros_raw: list[dict[str, Any]] = []
    ids_total = 0
    for box in boxes:
        if not _select(M, box):
            continue
        ids: set[bytes] = set()
        for q in (
            f'(FROM "facturacion@isiigo.com" TEXT "{_NEXT_NIT}")',
            '(FROM "facturacion@isiigo.com" TEXT "NEXT ENVIOS")',
            '(FROM "next.envios")',
            '(FROM "nextenviosoficial@gmail.com")',
        ):
            typ, data = M.search(None, q)
            for mid in data[0].split() if data and data[0] else []:
                ids.add(mid)
        ids_total += len(ids)
        for mid in ids:
            typ, data = M.fetch(mid, "(RFC822)")
            msg = email.message_from_bytes(data[0][1])
            subj = _dec(msg.get("Subject"))
            frm = msg.get("From", "") or ""
            date = msg.get("Date")
            try:
                ed = parsedate_to_datetime(date)
            except Exception:
                continue
            blob = (frm + " " + subj).upper()
            if _NEXT_NIT not in blob and "NEXT" not in blob and "FIDEL" not in blob:
                # algunos isiigo solo traen NIT en adjunto; aceptar from isiigo + NEXT en subject encoding
                if "ISIIGO" not in blob.upper() and "isiigo" not in frm.lower():
                    continue
            for part in msg.walk():
                fn = part.get_filename()
                if not fn:
                    continue
                fn = _dec(fn)
                payload = part.get_payload(decode=True) or b""
                if len(payload) < 200:
                    continue
                fecha = None
                monto = None
                num = None
                low = fn.lower()
                if low.endswith(".zip"):
                    try:
                        z = zipfile.ZipFile(BytesIO(payload))
                        for name in z.namelist():
                            if name.lower().endswith(".xml"):
                                fecha, monto, num = _parse_isiigo_xml(z.read(name))
                                if monto:
                                    break
                    except Exception:
                        continue
                elif low.endswith(".xml"):
                    fecha, monto, num = _parse_isiigo_xml(payload)
                else:
                    continue
                if not monto or monto < 5000:
                    continue
                if not fecha:
                    fecha = ed.strftime("%Y-%m-%d")
                # número desde asunto FVE942
                if not num:
                    m = re.search(r"\b(FVE\d+)\b", subj, re.I)
                    if m:
                        num = m.group(1)
                cobros_raw.append(
                    {
                        "mid": mid.decode(),
                        "from": frm,
                        "email_date": ed.strftime("%Y-%m-%d"),
                        "subject": subj,
                        "filename": fn,
                        "monto": round(float(monto), 2),
                        "concepto": f"Factura NEXT Envíos {num or ''}".strip()
                        + " — paquetería / Fidel Rocha",
                        "beneficiario": "Fidel Rocha / NEXT ENVIOS S.A.S",
                        "fecha": fecha[:10],
                        "periodo": fecha[:7],
                        "proveedor": "fidel_rocha",
                        "referencia_factura": num or "",
                        "email_ts": ed.timestamp(),
                    }
                )
    return cobros_raw, ids_total


def sincronizar_desde_gmail() -> dict[str, Any]:
    """
    Relee Gmail:
    - Cuentas de cobro PDF (William, etc.)
    - Facturas NEXT ENVIOS / Fidel Rocha (isiigo)
    """
    boxes = ["INBOX", "FACTURAS MCKG", "[Gmail]/Todos"]
    M = _imap_login()
    try:
        william, n1 = _collect_william_pdfs(M, boxes)
        fidel, n2 = _collect_fidel_next(M, boxes)
    finally:
        try:
            M.logout()
        except Exception:
            pass

    cobros_raw = william + fidel
    by: dict[tuple, dict] = {}
    for c in cobros_raw:
        if c.get("proveedor") == "fidel_rocha":
            key = ("fidel", c.get("fecha"), round(float(c["monto"]), 2), c.get("referencia_factura") or c.get("filename", "")[:40])
        else:
            key = ("wil", c.get("periodo"), (c.get("filename") or "").upper()[:60])
        prev = by.get(key)
        if not prev or c["email_ts"] >= prev["email_ts"]:
            by[key] = c
    uniq = sorted(by.values(), key=lambda x: x.get("fecha") or "")
    clean = [{k: v for k, v in c.items() if k != "email_ts"} for c in uniq]
    guardar_cobros(clean)
    n_fidel = sum(1 for c in clean if c.get("proveedor") == "fidel_rocha")
    n_wil = len(clean) - n_fidel
    return {
        "ok": True,
        "correos_revisados": n1 + n2,
        "cobros": len(clean),
        "william": n_wil,
        "fidel_rocha": n_fidel,
        "actualizado_en": datetime.now().isoformat(timespec="seconds"),
    }
