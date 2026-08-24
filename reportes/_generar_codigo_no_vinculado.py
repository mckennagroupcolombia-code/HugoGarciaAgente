#!/usr/bin/env python3
"""
PDF: ventas MeLi 2026-01-01 → hoy que Astroselling no factura porque el
código no está vinculado / no existe en Siigo.

Astroselling no publica API de errores. Se reconstruye el mismo criterio:
pago aprobado en MeLi, sin factura Siigo del pack/orden, y al menos un SKU
vacío, inválido o inexistente en el catálogo Siigo.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

REPO = Path("/home/mckg/mi-agente")
sys.path.insert(0, str(REPO))
os.chdir(REPO)

from dotenv import load_dotenv

load_dotenv(REPO / ".env")
os.environ["MELI_CREDS_PATH"] = str(REPO / "credenciales_meli.json")

import app.services.siigo as siigo_mod
import app.utils as utils_mod

siigo_mod._ruta_credenciales_siigo = lambda: str(REPO / "credenciales_SIIGO.json")
utils_mod.MELI_CREDS_PATH = str(REPO / "credenciales_meli.json")

import requests
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.services.siigo import PARTNER_ID, autenticar_siigo, _siigo_get
from app.utils import refrescar_token_meli

DESDE = date(2026, 1, 1)
HASTA = date.today()
OUT_DIR = REPO / "reportes"
OUT_PDF = OUT_DIR / f"Astroselling_codigo_no_vinculado_{DESDE}_{HASTA}.pdf"
OUT_JSON = OUT_DIR / f"Astroselling_codigo_no_vinculado_{DESDE}_{HASTA}.json"
CACHE_SIIGO = OUT_DIR / "_cache_siigo_ids.json"
CACHE_MELI = OUT_DIR / "_cache_meli_ordenes.json"
LOGO = REPO / "DISENO CORPORATIVO " / "LOGO AZUL.png"
INDICE_PATH = REPO / "app" / "data" / "facturacion_meli_index.json"
CACHE_CODIGOS = REPO / "app" / "data" / "relacion_codigos_cache.json"

import shutil

_meli_src = REPO / "credenciales_meli.json"
_meli_tmp = Path("/tmp/mckenna_meli_creds.json")
OUT_DIR.mkdir(parents=True, exist_ok=True)
shutil.copy2(_meli_src, _meli_tmp)
os.chmod(_meli_tmp, 0o600)
os.environ["MELI_CREDS_PATH"] = str(_meli_tmp)
utils_mod.MELI_CREDS_PATH = str(_meli_tmp)

RE_PACK = re.compile(r"Mercado ?Libre[^\d]{0,12}#?\s*(\d{9,17})", re.I)
RE_PACK_NUM = re.compile(r"\b(2000\d{11,13})\b")

TEAL = colors.HexColor("#016d82")
TEAL_DARK = colors.HexColor("#014d5c")
INK = colors.HexColor("#0f172a")
MUTED = colors.HexColor("#64748b")
LINE = colors.HexColor("#e2e8f0")
ROW_ALT = colors.HexColor("#f0f7f8")
WHITE = colors.white


def log(msg: str) -> None:
    print(msg, flush=True)


def norm(s) -> str:
    return str(s or "").strip()


def key(s) -> str:
    return norm(s).upper()


def cop(n) -> str:
    try:
        v = float(n or 0)
    except (TypeError, ValueError):
        v = 0.0
    return "$" + f"{v:,.0f}".replace(",", ".")


def fecha_corta(iso: str | None) -> str:
    if not iso:
        return "—"
    try:
        d = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        return d.strftime("%d/%m/%Y")
    except Exception:
        return str(iso)[:10]


def extraer_ids_factura(f: dict) -> set[str]:
    texto = f"{f.get('observations') or ''} {f.get('purchase_order') or ''} {f.get('purchase_order') or ''}"
    ids: set[str] = set()
    for m in RE_PACK.finditer(texto):
        ids.add(m.group(1))
    for m in RE_PACK_NUM.finditer(texto):
        ids.add(m.group(1))
    return ids


def cargar_indice_local() -> dict:
    try:
        data = json.loads(INDICE_PATH.read_text(encoding="utf-8"))
        return data.get("indice") or {}
    except Exception:
        return {}


def cargar_skus_cache() -> dict[str, dict]:
    out: dict[str, dict] = {}
    try:
        data = json.loads(CACHE_CODIGOS.read_text(encoding="utf-8"))
    except Exception:
        return out
    for it in data.get("items") or []:
        for k in (it.get("sku_meli"), it.get("codigo_siigo"), it.get("meli_id")):
            kk = key(k)
            if kk:
                out[kk] = it
    return out


def fetch_siigo_skus() -> dict[str, str]:
    log("→ Catálogo Siigo…")
    productos: dict[str, str] = {}
    page = 1
    while True:
        res = _siigo_get(
            "https://api.siigo.com/v1/products",
            params={"page": page, "page_size": 100},
            timeout=30,
        )
        if res is None:
            log(f"  products {page}: sin respuesta")
            break
        if res.status_code == 429:
            time.sleep(2)
            continue
        if res.status_code != 200:
            log(f"  products {page}: {res.status_code} {res.text[:160]}")
            break
        data = res.json() if res.content else {}
        results = data.get("results") or []
        for p in results:
            code = norm(p.get("code"))
            if code:
                productos[key(code)] = norm(p.get("name"))
        pag = data.get("pagination") or {}
        total = int(pag.get("total_results") or 0)
        page_size = int(pag.get("page_size") or 100)
        total_pages = max(1, (total + page_size - 1) // page_size) if page_size else page
        log(f"  productos {page}/{total_pages} ({len(productos)} códigos)")
        if page >= total_pages or not results:
            break
        page += 1
        time.sleep(0.12)
    if not productos:
        log("  fallback: cache relación de códigos")
        try:
            data = json.loads(CACHE_CODIGOS.read_text(encoding="utf-8"))
            for it in data.get("items") or []:
                if it.get("en_siigo"):
                    code = norm(it.get("codigo_siigo") or it.get("sku_meli"))
                    if code:
                        productos[key(code)] = norm(it.get("nombre_siigo") or it.get("titulo"))
        except Exception as e:
            log(f"  cache fallback falló: {e}")
    log(f"  {len(productos)} códigos Siigo")
    return productos


def fetch_siigo_invoices() -> list[dict]:
    log("→ Facturas Siigo…")
    todas: list[dict] = []
    cursor = DESDE
    while cursor <= HASTA:
        fin = min(cursor + timedelta(days=59), HASTA)
        log(f"  ventana {cursor} → {fin}")
        page = 1
        while True:
            params = {
                "created_start": cursor.isoformat(),
                "created_end": fin.isoformat(),
                "page": page,
                "page_size": 100,
            }
            res = _siigo_get("https://api.siigo.com/v1/invoices", params=params, timeout=35)
            if res is None:
                log(f"    page {page}: sin respuesta")
                break
            if res.status_code == 429:
                time.sleep(3)
                continue
            if res.status_code != 200:
                log(f"    page {page}: {res.status_code} {(res.text or '')[:200]}")
                break
            data = res.json() if res.content else {}
            results = data.get("results") or []
            todas.extend(results)
            pag = data.get("pagination") or {}
            total = int(pag.get("total_results") or 0)
            page_size = int(pag.get("page_size") or len(results) or 100)
            log(f"    pág {page} +{len(results)} (ventana {total}, acum {len(todas)})")
            if not results:
                break
            if total and page * page_size >= total:
                break
            if len(results) < page_size:
                break
            page += 1
            time.sleep(0.15)
        cursor = fin + timedelta(days=1)
    log(f"  {len(todas)} facturas Siigo")
    return todas


def ids_facturados(facturas: list[dict], indice_local: dict) -> set[str]:
    ids = {str(k) for k in indice_local.keys()}
    for f in facturas:
        ids |= extraer_ids_factura(f)
    return ids


def meses_rango() -> list[tuple[date, date]]:
    out: list[tuple[date, date]] = []
    y, m = DESDE.year, DESDE.month
    while date(y, m, 1) <= HASTA:
        nxt = date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)
        ini = max(date(y, m, 1), DESDE)
        fin = min(nxt - timedelta(days=1), HASTA)
        out.append((ini, fin))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def _slim_orden(o: dict) -> dict:
    items = []
    for oi in o.get("order_items") or []:
        item = oi.get("item") or {}
        items.append(
            {
                "item": {
                    "id": item.get("id"),
                    "title": item.get("title"),
                    "seller_sku": item.get("seller_sku"),
                    "seller_custom_field": item.get("seller_custom_field"),
                },
                "quantity": oi.get("quantity"),
            }
        )
    return {
        "id": o.get("id"),
        "pack_id": o.get("pack_id"),
        "date_created": o.get("date_created"),
        "status": o.get("status"),
        "total_amount": o.get("total_amount"),
        "paid_amount": o.get("paid_amount"),
        "payments": [{"status": p.get("status")} for p in (o.get("payments") or [])],
        "order_items": items,
    }


def _meli_get(url: str, *, headers: dict, params: dict | None = None, timeout: int = 40):
    last = None
    for intento in range(6):
        try:
            r = requests.get(url, headers=headers, params=params, timeout=timeout)
            if r.status_code == 429:
                time.sleep(2 + intento)
                continue
            return r
        except requests.RequestException as e:
            last = e
            espera = min(20, 2 ** intento)
            log(f"  red MeLi ({intento + 1}/6): {e}; reintento en {espera}s")
            time.sleep(espera)
    if last:
        raise last
    return None


def _guardar_cache_meli(todas: list[dict], hechos: list[str]) -> None:
    CACHE_MELI.write_text(
        json.dumps({"hasta": HASTA.isoformat(), "hechos": hechos, "ordenes": todas}, ensure_ascii=False),
        encoding="utf-8",
    )


def fetch_meli_ordenes() -> list[dict]:
    log("→ Órdenes MeLi (paid + cancelled)…")
    todas: list[dict] = []
    vistos: set[str] = set()
    hechos: list[str] = []
    if CACHE_MELI.exists():
        try:
            blob = json.loads(CACHE_MELI.read_text(encoding="utf-8"))
            if blob.get("hasta") == HASTA.isoformat():
                todas = blob.get("ordenes") or []
                hechos = list(blob.get("hechos") or [])
                for o in todas:
                    oid = str(o.get("id") or "")
                    if oid:
                        vistos.add(oid)
                log(f"  caché MeLi: {len(todas)} órdenes · meses hechos {hechos}")
        except Exception as e:
            log(f"  caché MeLi ilegible: {e}")
            todas, vistos, hechos = [], set(), []

    token = refrescar_token_meli()
    if not token:
        raise RuntimeError("No se pudo autenticar en Mercado Libre.")
    headers = {"Authorization": f"Bearer {token}"}
    me = _meli_get("https://api.mercadolibre.com/users/me", headers=headers, timeout=25)
    if me is None or me.status_code != 200:
        raise RuntimeError(f"Sin seller_id MeLi ({getattr(me, 'status_code', None)}).")
    seller_id = me.json().get("id")
    if not seller_id:
        raise RuntimeError("Sin seller_id MeLi.")
    log(f"  seller {seller_id}")

    for status in ("paid", "cancelled"):
        for ini, fin in meses_rango():
            clave = f"{status}:{ini.isoformat()}"
            if clave in hechos:
                continue
            offset = 0
            while True:
                params = {
                    "seller": seller_id,
                    "order.status": status,
                    "order.date_created.from": f"{ini.isoformat()}T00:00:00.000-05:00",
                    "order.date_created.to": f"{fin.isoformat()}T23:59:59.999-05:00",
                    "sort": "date_desc",
                    "limit": 50,
                    "offset": offset,
                }
                r = _meli_get(
                    "https://api.mercadolibre.com/orders/search",
                    headers=headers,
                    params=params,
                    timeout=40,
                )
                if r.status_code == 401:
                    token = refrescar_token_meli()
                    headers["Authorization"] = f"Bearer {token}"
                    continue
                if r.status_code != 200:
                    log(f"  {status} {ini} offset {offset}: {r.status_code} {r.text[:160]}")
                    break
                data = r.json()
                results = data.get("results") or []
                for o in results:
                    oid = str(o.get("id") or "")
                    if oid and oid not in vistos:
                        vistos.add(oid)
                        todas.append(_slim_orden(o))
                total = int((data.get("paging") or {}).get("total") or 0)
                offset += len(results)
                log(
                    f"  {status} {ini.strftime('%Y-%m')} +{len(results)} "
                    f"(mes {offset}/{total}, global {len(todas)})"
                )
                if not results or offset >= total:
                    break
                time.sleep(0.2)
            hechos.append(clave)
            _guardar_cache_meli(todas, hechos)
    log(f"  {len(todas)} órdenes únicas")
    return todas


def sku_de_item(item: dict) -> str:
    return norm(item.get("seller_sku")) or norm(item.get("seller_custom_field"))


def orden_pagada(orden: dict) -> bool:
    if (orden.get("status") or "") == "paid":
        return True
    for p in orden.get("payments") or []:
        if (p.get("status") or "") in ("approved", "accredited"):
            return True
    try:
        return float(orden.get("paid_amount") or 0) > 0
    except (TypeError, ValueError):
        return False


def clasificar_sku(sku: str, siigo: dict[str, str]) -> tuple[str, str]:
    raw = sku or ""
    if not norm(raw):
        return "sin_codigo", "Publicación sin SKU — no hay código para vincular"
    if raw != raw.strip() or " " in raw:
        return "codigo_invalido", f"SKU con espacio o formato inválido ({raw!r})"
    if key(raw) in siigo:
        return "existe", siigo[key(raw)]
    return "no_existe", "El producto con este código no existe en Siigo (no vinculado)"


def analizar(ordenes, facturados, siigo, cache) -> list[dict]:
    filas = []
    for o in ordenes:
        if not orden_pagada(o):
            continue
        created = (o.get("date_created") or "")[:10]
        if created < DESDE.isoformat():
            continue
        oid = str(o.get("id") or "")
        pack = str(o.get("pack_id") or oid)
        if {oid, pack} & facturados:
            continue
        lineas = []
        hay_error = False
        for oi in o.get("order_items") or []:
            item = oi.get("item") or {}
            sku = sku_de_item(item)
            mid = norm(item.get("id"))
            if not sku and mid:
                hit = cache.get(key(mid)) or {}
                sku = norm(hit.get("sku_meli") or hit.get("codigo_siigo"))
            motivo, detalle = clasificar_sku(sku, siigo)
            if motivo != "existe":
                hay_error = True
            lineas.append(
                {
                    "sku": sku or "(sin código)",
                    "titulo": norm(item.get("title")),
                    "meli_id": mid,
                    "cantidad": oi.get("quantity") or 1,
                    "motivo": motivo,
                    "detalle": detalle,
                }
            )
        if not hay_error:
            continue
        filas.append(
            {
                "orden_id": oid,
                "pack_id": pack,
                "fecha": o.get("date_created"),
                "estado_meli": o.get("status"),
                "total": o.get("total_amount"),
                "lineas": lineas,
                "skus_error": [x["sku"] for x in lineas if x["motivo"] != "existe"],
            }
        )
    filas.sort(key=lambda x: x.get("fecha") or "")
    return filas


def _fuentes() -> bool:
    font_dir = Path("/usr/share/fonts/truetype/montserrat")
    mapping = {
        "Mont": "Montserrat-Regular.ttf",
        "Mont-Bold": "Montserrat-Bold.ttf",
        "Mont-Semi": "Montserrat-SemiBold.ttf",
        "Mont-Med": "Montserrat-Medium.ttf",
    }
    ok = True
    for name, fn in mapping.items():
        p = font_dir / fn
        if p.exists():
            pdfmetrics.registerFont(TTFont(name, str(p)))
        else:
            ok = False
    return ok


def estilos(mont: bool) -> dict:
    base = "Mont" if mont else "Helvetica"
    bold = "Mont-Bold" if mont else "Helvetica-Bold"
    semi = "Mont-Semi" if mont else "Helvetica-Bold"
    med = "Mont-Med" if mont else "Helvetica"
    ss = getSampleStyleSheet()
    return {
        "kicker": ParagraphStyle(
            "kicker", parent=ss["Normal"], fontName=med, fontSize=8,
            textColor=TEAL, spaceAfter=2,
        ),
        "h1": ParagraphStyle(
            "h1", parent=ss["Normal"], fontName=bold, fontSize=18,
            textColor=INK, leading=22, spaceAfter=2,
        ),
        "sub": ParagraphStyle(
            "sub", parent=ss["Normal"], fontName=base, fontSize=9,
            textColor=MUTED, leading=13, spaceAfter=8,
        ),
        "h2": ParagraphStyle(
            "h2", parent=ss["Normal"], fontName=semi, fontSize=11,
            textColor=TEAL_DARK, spaceBefore=10, spaceAfter=6,
        ),
        "body": ParagraphStyle(
            "body", parent=ss["Normal"], fontName=base, fontSize=8,
            textColor=INK, leading=11,
        ),
        "small": ParagraphStyle(
            "small", parent=ss["Normal"], fontName=base, fontSize=7,
            textColor=MUTED, leading=9.5,
        ),
        "th": ParagraphStyle(
            "th", parent=ss["Normal"], fontName=semi, fontSize=7,
            textColor=WHITE, leading=9,
        ),
        "td": ParagraphStyle(
            "td", parent=ss["Normal"], fontName=base, fontSize=7,
            textColor=INK, leading=9.2,
        ),
        "tdr": ParagraphStyle(
            "tdr", parent=ss["Normal"], fontName=base, fontSize=7,
            textColor=INK, leading=9.2, alignment=TA_RIGHT,
        ),
        "kpi_n": ParagraphStyle(
            "kpi_n", parent=ss["Normal"], fontName=bold, fontSize=14,
            textColor=TEAL_DARK, alignment=TA_CENTER, leading=18,
        ),
        "kpi_l": ParagraphStyle(
            "kpi_l", parent=ss["Normal"], fontName=base, fontSize=7,
            textColor=MUTED, alignment=TA_CENTER, leading=9,
        ),
        "foot": ParagraphStyle(
            "foot", parent=ss["Normal"], fontName=base, fontSize=7,
            textColor=WHITE, alignment=TA_LEFT,
        ),
    }


def header_footer(canvas, doc):
    canvas.saveState()
    w, h = landscape(A4)
    canvas.setFillColor(TEAL)
    canvas.rect(0, h - 7, w, 7, fill=1, stroke=0)
    canvas.setFillColor(TEAL_DARK)
    canvas.rect(0, 0, w, 16, fill=1, stroke=0)
    canvas.setFillColor(WHITE)
    canvas.setFont("Helvetica", 7)
    canvas.drawString(16 * mm, 5, "McKenna Group S.A.S.  ·  Confidencial  ·  Operaciones / Facturación")
    canvas.drawRightString(w - 16 * mm, 5, f"Página {doc.page}")
    canvas.restoreState()


def tabla_estilo(nrows: int) -> TableStyle:
    cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), TEAL),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.25, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    for i in range(1, nrows):
        if i % 2 == 0:
            cmds.append(("BACKGROUND", (0, i), (-1, i), ROW_ALT))
    return TableStyle(cmds)


def construir_pdf(filas: list[dict], meta: dict) -> None:
    mont = _fuentes()
    st = estilos(mont)
    page = landscape(A4)
    doc = SimpleDocTemplate(
        str(OUT_PDF),
        pagesize=page,
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=12 * mm,
        bottomMargin=14 * mm,
        title="Ventas Astroselling — código no vinculado 2026",
        author="McKenna Group S.A.S.",
    )
    story = []
    usable = page[0] - 28 * mm
    periodo = f"{DESDE.strftime('%d/%m/%Y')} – {HASTA.strftime('%d/%m/%Y')}"

    if LOGO.exists():
        logo = Image(str(LOGO), width=2.4 * cm, height=2.4 * cm)
    else:
        logo = Paragraph("McKenna", st["h1"])
    right = [
        Paragraph("OPERACIONES  ·  FACTURACIÓN MELI / SIIGO", st["kicker"]),
        Paragraph("Ventas con error de código no vinculado", st["h1"]),
        Paragraph(
            f"Astroselling · Mercado Libre → Siigo · {periodo}<br/>"
            f"Generado {datetime.now().strftime('%d/%m/%Y %H:%M')} · Bogotá",
            st["sub"],
        ),
    ]
    ht = Table([[logo, right]], colWidths=[3.0 * cm, usable - 3.0 * cm])
    ht.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    story.append(ht)
    bar = Table([[""]], colWidths=[usable], rowHeights=[3])
    bar.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), TEAL)]))
    story.append(bar)
    story.append(Spacer(1, 8))

    story.append(
        Paragraph(
            "Criterio: ventas de Mercado Libre <b>con pago aprobado</b> desde el 1 de enero de 2026 "
            "que <b>no tienen factura Siigo</b> y cuyo SKU <b>no existe, está vacío o es inválido</b> "
            "en el catálogo Siigo. Ese es el mismo fallo que Astroselling muestra como "
            "«el producto con el código X no existe en Siigo» / código no vinculado. "
            "Astroselling no expone API de errores; el cruce MeLi × Siigo reproduce esa cola.",
            st["body"],
        )
    )
    story.append(Spacer(1, 8))

    n = len(filas)
    skus = sorted({s for f in filas for s in f["skus_error"]})
    total = sum(float(f.get("total") or 0) for f in filas)
    pagadas = sum(1 for f in filas if f.get("estado_meli") == "paid")
    cancel = n - pagadas
    kpis = [
        [
            Paragraph(str(n), st["kpi_n"]),
            Paragraph(str(len(skus)), st["kpi_n"]),
            Paragraph(cop(total), st["kpi_n"]),
            Paragraph(str(pagadas), st["kpi_n"]),
            Paragraph(str(cancel), st["kpi_n"]),
        ],
        [
            Paragraph("Ventas afectadas", st["kpi_l"]),
            Paragraph("SKUs sin vincular", st["kpi_l"]),
            Paragraph("Valor MeLi (COP)", st["kpi_l"]),
            Paragraph("Pagadas sin factura", st["kpi_l"]),
            Paragraph("Canceladas (también fallaron)", st["kpi_l"]),
        ],
    ]
    kt = Table(kpis, colWidths=[usable / 5.0] * 5)
    kt.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), ROW_ALT),
                ("BOX", (0, 0), (-1, -1), 0.4, TEAL),
                ("INNERGRID", (0, 0), (-1, -1), 0.3, LINE),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    story.append(kt)

    por_mes: dict[str, list] = defaultdict(list)
    for f in filas:
        por_mes[(f.get("fecha") or "")[:7]].append(f)
    story.append(Paragraph("Resumen por mes", st["h2"]))
    mrows = [[Paragraph(x, st["th"]) for x in ("Mes", "Ventas", "SKUs distintos", "Valor COP")]]
    for mes in sorted(por_mes):
        xs = por_mes[mes]
        mrows.append(
            [
                Paragraph(mes or "—", st["td"]),
                Paragraph(str(len(xs)), st["tdr"]),
                Paragraph(str(len({s for x in xs for s in x["skus_error"]})), st["tdr"]),
                Paragraph(cop(sum(float(x.get("total") or 0) for x in xs)), st["tdr"]),
            ]
        )
    mt = Table(mrows, colWidths=[usable * 0.25, usable * 0.2, usable * 0.25, usable * 0.3])
    mt.setStyle(tabla_estilo(len(mrows)))
    story.append(mt)

    por_sku: dict[str, dict] = {}
    for f in filas:
        n_err = max(len([x for x in f["lineas"] if x["motivo"] != "existe"]), 1)
        for ln in f["lineas"]:
            if ln["motivo"] == "existe":
                continue
            sku = ln["sku"]
            d = por_sku.setdefault(
                sku,
                {"n": 0, "motivo": ln["detalle"], "titulo": ln["titulo"], "valor": 0.0},
            )
            d["n"] += 1
            d["valor"] += float(f.get("total") or 0) / n_err
            if ln["titulo"]:
                d["titulo"] = ln["titulo"]
    story.append(Paragraph("Por código — crear o vincular en Siigo / Astroselling", st["h2"]))
    srows = [[Paragraph(x, st["th"]) for x in ("SKU MeLi", "Producto", "Ventas", "Valor aprox.", "Qué hacer")]]
    for sku, d in sorted(por_sku.items(), key=lambda kv: (-kv[1]["n"], kv[0])):
        srows.append(
            [
                Paragraph(sku.replace(" ", "&nbsp;"), st["td"]),
                Paragraph((d["titulo"] or "—")[:90], st["td"]),
                Paragraph(str(d["n"]), st["tdr"]),
                Paragraph(cop(d["valor"]), st["tdr"]),
                Paragraph(d["motivo"], st["td"]),
            ]
        )
    stbl = Table(
        srows,
        colWidths=[usable * 0.18, usable * 0.28, usable * 0.08, usable * 0.12, usable * 0.34],
        repeatRows=1,
    )
    stbl.setStyle(tabla_estilo(len(srows)))
    story.append(stbl)

    story.append(PageBreak())
    story.append(Paragraph("Listado de ventas", st["h2"]))
    story.append(
        Paragraph(
            "Cada fila es una orden/pack de Mercado Libre sin factura Siigo. "
            "El pack ID es el que usa Astroselling. "
            "Estado cancelled = el cliente canceló después; el error de código igual aplicó.",
            st["small"],
        )
    )
    story.append(Spacer(1, 4))

    drows = [[Paragraph(x, st["th"]) for x in (
        "Fecha", "Pack / orden", "Estado", "SKU(s)", "Producto", "Total", "Error"
    )]]
    for f in filas:
        skus_txt = ", ".join(f["skus_error"])
        tit = next((ln["titulo"] for ln in f["lineas"] if ln["motivo"] != "existe"), "")
        det = next((ln["detalle"] for ln in f["lineas"] if ln["motivo"] != "existe"), "")
        pack = f["pack_id"]
        if f["orden_id"] != f["pack_id"]:
            pack = f"{f['pack_id']}<br/><font size='6' color='#64748b'>orden {f['orden_id']}</font>"
        drows.append(
            [
                Paragraph(fecha_corta(f["fecha"]), st["td"]),
                Paragraph(str(pack), st["td"]),
                Paragraph(f.get("estado_meli") or "—", st["td"]),
                Paragraph(skus_txt.replace(" ", "&nbsp;"), st["td"]),
                Paragraph((tit or "—")[:90], st["td"]),
                Paragraph(cop(f.get("total")), st["tdr"]),
                Paragraph(det, st["td"]),
            ]
        )
    dt = Table(
        drows,
        colWidths=[
            usable * 0.08, usable * 0.18, usable * 0.08,
            usable * 0.16, usable * 0.22, usable * 0.09, usable * 0.19,
        ],
        repeatRows=1,
    )
    dt.setStyle(tabla_estilo(len(drows)))
    story.append(dt)

    story.append(Spacer(1, 12))
    story.append(Paragraph("Notas de método", st["h2"]))
    story.append(
        Paragraph(
            f"• Órdenes MeLi consultadas: {meta.get('ordenes_meli', '—')} "
            f"(pagadas y canceladas, {periodo}).<br/>"
            f"• Facturas Siigo consultadas: {meta.get('facturas_siigo', '—')} "
            f"+ índice local ({meta.get('indice_local', '—')} packs).<br/>"
            f"• Códigos en catálogo Siigo: {meta.get('skus_siigo', '—')}.<br/>"
            "• Se excluyen ventas sin factura cuyo SKU <b>sí</b> existe hoy en Siigo "
            "(otro error de Astroselling: IVA, NIT, producto inactivo, etc.).<br/>"
            "• Si un código se creó en Siigo después de la venta, esa venta ya no aparece "
            "aunque en su momento haya fallado.",
            st["small"],
        )
    )
    doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)
    log(f"PDF → {OUT_PDF}")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    indice = cargar_indice_local()
    cache = cargar_skus_cache()
    log(f"índice local: {len(indice)} packs · cache códigos: {len(cache)}")

    siigo_skus: dict[str, str] | None = None
    facturados: set[str] | None = None
    n_facturas = 0
    if CACHE_SIIGO.exists():
        try:
            blob = json.loads(CACHE_SIIGO.read_text(encoding="utf-8"))
            if blob.get("hasta") == HASTA.isoformat() and blob.get("skus_siigo") and blob.get("facturados"):
                siigo_skus = blob["skus_siigo"]
                facturados = set(blob["facturados"])
                n_facturas = int(blob.get("n_facturas") or 0)
                log(f"caché Siigo: {len(siigo_skus)} códigos · {len(facturados)} IDs facturados")
        except Exception as e:
            log(f"caché Siigo ilegible: {e}")
            siigo_skus = None
    if not siigo_skus or not facturados:
        siigo_skus = fetch_siigo_skus()
        facturas = fetch_siigo_invoices()
        facturados = ids_facturados(facturas, indice)
        n_facturas = len(facturas)
        CACHE_SIIGO.write_text(
            json.dumps(
                {
                    "hasta": HASTA.isoformat(),
                    "skus_siigo": siigo_skus,
                    "facturados": sorted(facturados),
                    "n_facturas": n_facturas,
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
    log(f"IDs facturados (unión): {len(facturados)}")

    ordenes = fetch_meli_ordenes()
    filas = analizar(ordenes, facturados, siigo_skus, cache)
    log(f"Ventas código no vinculado: {len(filas)}")

    payload = {
        "generado_en": datetime.now().isoformat(timespec="seconds"),
        "desde": DESDE.isoformat(),
        "hasta": HASTA.isoformat(),
        "ordenes_meli": len(ordenes),
        "facturas_siigo": n_facturas,
        "indice_local": len(indice),
        "skus_siigo": len(siigo_skus),
        "ventas": filas,
    }
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"JSON → {OUT_JSON}")
    construir_pdf(
        filas,
        {
            "ordenes_meli": len(ordenes),
            "facturas_siigo": n_facturas,
            "indice_local": len(indice),
            "skus_siigo": len(siigo_skus),
        },
    )
    log("LISTO")


if __name__ == "__main__":
    main()
