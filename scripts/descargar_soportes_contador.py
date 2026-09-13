#!/usr/bin/env python3
"""Descarga los soportes que envía el contador por correo y los organiza por mes y tipo.

Busca en el Gmail de la empresa (mismo token OAuth que usa el flujo de facturas de
compra, `app/tools/token_gmail.json`) todos los correos de EMAIL_CONTADOR
(default williamfer94@hotmail.com), filtra los que hablan de declaraciones o
auxiliares contables y baja sus adjuntos (PDF / Excel / XML / CSV; los ZIP se
extraen) a:

    docs/contabilidad/<año del correo>/Soportes_Contador/<AAAA-MM>/<tipo>/<archivo>

`<tipo>` sale del término que hizo match (retefuente, iva, renta, ica, exogena,
auxiliares, certificados; con --todo también cuenta_cobro y otros). El nombre del
archivo manda sobre el asunto/cuerpo: un correo "IMPUESTOS A JUNIO" trae el 350 y
el RTICA juntos y cada uno va a su carpeta. Un índice JSON (`_indice.json`) en la raíz de la carpeta guarda
qué correo trajo cada archivo y qué término lo clasificó, para no volver a bajar lo
que ya está.

Uso:
    source venv/bin/activate
    python3 scripts/descargar_soportes_contador.py                # desde 2026-01-01
    python3 scripts/descargar_soportes_contador.py --desde 2025-01-01
    python3 scripts/descargar_soportes_contador.py --todo           # sin filtro de términos
    python3 scripts/descargar_soportes_contador.py --dry-run        # solo lista

No llama a ningún LLM.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import os
import re
import sys
import unicodedata
import zipfile
from datetime import datetime
from email.utils import parsedate_to_datetime
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(_ROOT / ".env")

CONTADOR = os.getenv("EMAIL_CONTADOR", "williamfer94@hotmail.com").strip().lower()
EXTENSIONES = {".pdf", ".xls", ".xlsx", ".xlsm", ".xml", ".csv", ".zip"}
# Tipos que solo se bajan con --todo (las cuentas de cobro del contador ya las
# indexa app/data/cuentas_cobro_correo.json).
TIPOS_SOLO_CON_TODO = {"cuenta_cobro", "otros"}

# Término (regex sobre texto normalizado sin tildes, minúsculas) → tipo de carpeta.
# El orden importa: el primer match define la carpeta.
TERMINOS: list[tuple[str, str]] = [
    (r"cuenta\s+de\s+cobro", "cuenta_cobro"),
    (r"certificados?\s+de\s+retencion", "certificados"),
    (r"\b(490\s+de\s+)?350\b\s+periodo|formulario\s*350|\bform\.?\s*350\b|\brtf\b", "retefuente"),
    (r"\b490\s+de\s+iva\b|\biva\s+cuatrimestre\b", "iva"),
    (r"\brt\s*ica\b|\breteica\b|\brete\s*ica\b|\bica\b|industria\s+y\s+comercio", "ica"),
    (r"formulario\s*350|\bform\.?\s*350\b|\brtf\b|retefuente|retencion(es)?\s+en\s+la\s+fuente|\bretencion(es)?\b", "retefuente"),
    (r"formulario\s*300|\bform\.?\s*300\b|\biva\b", "iva"),
    (r"formulario\s*110|\bform\.?\s*110\b|\brenta\b", "renta"),
    (r"exogena|medios\s+magneticos|\b1001\b|\b1003\b|\b1005\b|\b1006\b|\b1007\b|\b1008\b|\b1009\b", "exogena"),
    (r"\bauxiliar(es)?\b|balance\s+de\s+prueba|balance\s+general|\b2365\b|\b2205\b|\bterceros\b", "auxiliares"),
]


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", s.lower())


def clasificar(*textos: str) -> tuple[str | None, list[str]]:
    """Devuelve (tipo, términos que hicieron match) sobre los textos dados."""
    corpus = _norm(" \n ".join(t for t in textos if t))
    tipo = None
    hits: list[str] = []
    for patron, nombre in TERMINOS:
        m = re.search(patron, corpus)
        if m:
            hits.append(m.group(0).strip())
            tipo = tipo or nombre
    return tipo, hits


def _slug(s: str, n: int = 60) -> str:
    s = _norm(s)
    s = re.sub(r"[^a-z0-9._-]+", "_", s).strip("_")
    return s[:n] or "sin_nombre"


def _b64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def _texto_cuerpo(payload: dict) -> str:
    """Concatena las partes text/plain (y text/html sin etiquetas) del mensaje."""
    out: list[str] = []

    def walk(p: dict) -> None:
        mime = p.get("mimeType", "")
        body = p.get("body", {}) or {}
        if mime.startswith("text/") and body.get("data"):
            txt = _b64(body["data"]).decode("utf-8", "ignore")
            if mime == "text/html":
                txt = re.sub(r"<[^>]+>", " ", txt)
            out.append(txt)
        for sub in p.get("parts", []) or []:
            walk(sub)

    walk(payload)
    return "\n".join(out)


def _adjuntos(payload: dict) -> list[dict]:
    """Lista {filename, attachmentId, mimeType, size} de todos los adjuntos."""
    found: list[dict] = []

    def walk(p: dict) -> None:
        fn = p.get("filename") or ""
        body = p.get("body", {}) or {}
        if fn and body.get("attachmentId"):
            found.append({
                "filename": fn,
                "attachmentId": body["attachmentId"],
                "mimeType": p.get("mimeType", ""),
                "size": body.get("size", 0),
            })
        for sub in p.get("parts", []) or []:
            walk(sub)

    walk(payload)
    return found


def _header(headers: list[dict], nombre: str) -> str:
    for h in headers:
        if h.get("name", "").lower() == nombre.lower():
            return h.get("value", "")
    return ""


def _fecha_msg(headers: list[dict], internal_ms: str | None) -> datetime:
    raw = _header(headers, "Date")
    try:
        return parsedate_to_datetime(raw).replace(tzinfo=None)
    except Exception:
        return datetime.fromtimestamp(int(internal_ms or 0) / 1000)


def _periodo_en_texto(*textos: str) -> str:
    """Detecta 'periodo N' / 'mes de <nombre>' / 'AAAA-MM' para anotar en el índice."""
    corpus = _norm(" ".join(t for t in textos if t))
    m = re.search(r"period[oa]\s*(\d{1,2})", corpus)
    if m:
        return f"periodo {int(m.group(1))}"
    meses = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre"
    m = re.search(rf"\b({meses})\b(?:\s+(?:de\s+)?(20\d\d))?", corpus)
    if m:
        return (m.group(1) + (" " + m.group(2) if m.group(2) else "")).strip()
    m = re.search(r"\b(20\d\d)[-/](\d{2})\b", corpus)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    return ""


def _guardar(destino: Path, data: bytes) -> bool:
    if destino.exists() and destino.stat().st_size == len(data):
        return False
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_bytes(data)
    return True


def _base(anio: int) -> Path:
    return _ROOT / "docs" / "contabilidad" / str(anio) / "Soportes_Contador"


def _cargar_indice(anio: int) -> dict:
    p = _base(anio) / "_indice.json"
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"actualizado_en": None, "contador": CONTADOR, "archivos": {}}


def descargar(desde: str, hasta: str | None, todo: bool, dry_run: bool, max_msgs: int) -> dict:
    """Recorre el correo y guarda cada adjunto en docs/contabilidad/<año del correo>/Soportes_Contador/."""
    from app.tools.sincronizar_facturas_de_compra_siigo import get_gmail_service

    indices: dict[int, dict] = {}

    service = get_gmail_service()
    q = f"from:{CONTADOR} has:attachment after:{desde.replace('-', '/')}"
    if hasta:
        q += f" before:{hasta.replace('-', '/')}"
    print(f"Gmail query: {q}")

    ids: list[str] = []
    token = None
    while True:
        resp = service.users().messages().list(userId="me", q=q, maxResults=100, pageToken=token).execute()
        ids += [m["id"] for m in resp.get("messages", [])]
        token = resp.get("nextPageToken")
        if not token or len(ids) >= max_msgs:
            break
    print(f"Correos con adjuntos del contador: {len(ids)}")

    stats = {"correos": len(ids), "con_match": 0, "adjuntos": 0, "nuevos": 0, "omitidos_sin_match": []}

    for mid in ids:
        msg = service.users().messages().get(userId="me", id=mid, format="full").execute()
        payload = msg.get("payload", {}) or {}
        headers = payload.get("headers", []) or []
        subject = _header(headers, "Subject")
        remitente = _header(headers, "From")
        if CONTADOR not in remitente.lower():
            continue
        fecha = _fecha_msg(headers, msg.get("internalDate"))
        cuerpo = _texto_cuerpo(payload)
        adjs = [a for a in _adjuntos(payload) if Path(a["filename"]).suffix.lower() in EXTENSIONES]
        if not adjs:
            continue

        tipo_msg, hits_msg = clasificar(subject, cuerpo)
        periodo = _periodo_en_texto(subject, cuerpo)
        algo = False
        for a in adjs:
            tipo_adj, hits_adj = clasificar(a["filename"])
            tipo = tipo_adj or tipo_msg
            hits = list(dict.fromkeys(hits_adj + hits_msg))
            tipo = tipo or "otros"
            if tipo in TIPOS_SOLO_CON_TODO and not todo:
                continue
            algo = True
            stats["adjuntos"] += 1
            base = _base(fecha.year)
            archivos = indices.setdefault(fecha.year, _cargar_indice(fecha.year)).setdefault("archivos", {})
            mes = fecha.strftime("%Y-%m")
            nombre = f"{fecha:%Y-%m-%d}_{_slug(subject, 40)}_{_slug(Path(a['filename']).stem, 50)}{Path(a['filename']).suffix.lower()}"
            destino = base / mes / tipo / nombre
            clave = f"{mid}:{a['attachmentId'][:24]}:{a['filename']}"
            print(f"  [{tipo:11}] {fecha:%Y-%m-%d}  {subject[:45]!r:48} → {a['filename']}  ({', '.join(hits[:3])})")
            if dry_run:
                continue
            if clave in archivos and Path(_ROOT / archivos[clave]["ruta"]).exists():
                continue
            att = service.users().messages().attachments().get(userId="me", messageId=mid, id=a["attachmentId"]).execute()
            data = _b64(att["data"])
            extraidos: list[str] = []
            if destino.suffix == ".zip":
                try:
                    with zipfile.ZipFile(io.BytesIO(data)) as zf:
                        for info in zf.infolist():
                            if info.is_dir() or Path(info.filename).suffix.lower() not in EXTENSIONES - {".zip"}:
                                continue
                            sub = destino.with_suffix("") / _slug(Path(info.filename).stem, 50)
                            sub = sub.with_suffix(Path(info.filename).suffix.lower())
                            if _guardar(sub, zf.read(info)):
                                stats["nuevos"] += 1
                            extraidos.append(str(sub.relative_to(_ROOT)))
                except zipfile.BadZipFile:
                    _guardar(destino, data)
            else:
                if _guardar(destino, data):
                    stats["nuevos"] += 1
            archivos[clave] = {
                "msg_id": mid,
                "fecha_correo": fecha.strftime("%Y-%m-%d"),
                "asunto": subject,
                "archivo_original": a["filename"],
                "tipo": tipo,
                "terminos": hits,
                "periodo_detectado": periodo,
                "ruta": str(destino.relative_to(_ROOT)),
                "extraidos": extraidos,
                "bytes": len(data),
            }
        if algo:
            stats["con_match"] += 1
        else:
            stats["omitidos_sin_match"].append(f"{fecha:%Y-%m-%d} {subject} [{', '.join(x['filename'] for x in adjs)}]")

    if not dry_run:
        for anio, indice in indices.items():
            indice["actualizado_en"] = datetime.now().isoformat(timespec="seconds")
            _base(anio).mkdir(parents=True, exist_ok=True)
            p = _base(anio) / "_indice.json"
            p.write_text(json.dumps(indice, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"\nÍndice: {p.relative_to(_ROOT)}")
    return stats


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--desde", default="2026-01-01", help="Fecha mínima del correo (AAAA-MM-DD)")
    ap.add_argument("--hasta", default=None, help="Fecha máxima del correo (AAAA-MM-DD, exclusiva)")
    ap.add_argument("--todo", action="store_true", help="Bajar todos los adjuntos aunque no haga match (carpeta 'otros')")
    ap.add_argument("--dry-run", action="store_true", help="Solo listar, sin descargar")
    ap.add_argument("--max", type=int, default=500, help="Máximo de correos a revisar")
    args = ap.parse_args()

    stats = descargar(args.desde, args.hasta, args.todo, args.dry_run, args.max)
    print("\nResumen:")
    for k in ("correos", "con_match", "adjuntos", "nuevos"):
        print(f"  {k:15} {stats[k]}")
    if stats["omitidos_sin_match"]:
        print(f"  correos con adjuntos que NO hicieron match ({len(stats['omitidos_sin_match'])}):")
        for s in stats["omitidos_sin_match"]:
            print(f"    - {s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
