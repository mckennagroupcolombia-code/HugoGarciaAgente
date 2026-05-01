#!/usr/bin/env python3
"""
Genera el catálogo PDF desde HTML/CSS del sitio web.

Fuente: PAGINA_WEB.site.website.get_catalog()
Render: Jinja template + WeasyPrint.
Fallback: si WeasyPrint no está disponible, aborta con mensaje claro para usar
scripts/generar_catalogo.py.
"""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
SITE_DIR = ROOT / "PAGINA_WEB" / "site"
OUT_PDF = ROOT / "Catalogo_McKenna_Group_2026_COMBOS_WEB.pdf"
OUT_HTML = ROOT / "Catalogo_McKenna_Group_2026_COMBOS_WEB.html"

sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(SITE_DIR))

for noisy_logger in ("fontTools", "fontTools.subset", "weasyprint"):
    logging.getLogger(noisy_logger).setLevel(logging.WARNING)


def _asset_url(path: Path) -> str:
    return path.resolve().as_uri()


def _pdf_photo_url(photo: str) -> str:
    raw = (photo or "").strip()
    if not raw:
        return ""
    if raw.startswith("/imagenes-productos-catalogo/"):
        name = unquote(raw.split("/imagenes-productos-catalogo/", 1)[1])
        local = ROOT / "IMAGENES_PRODUCTOS_CATALOGO" / name
        return _asset_url(local) if local.exists() else ""
    if raw.startswith("/static/"):
        local = SITE_DIR / raw.lstrip("/")
        return _asset_url(local) if local.exists() else ""
    if raw.startswith("http://") or raw.startswith("https://") or raw.startswith("file://"):
        return raw
    local = Path(raw)
    return _asset_url(local) if local.exists() else ""


def _catalog_for_pdf() -> list[dict]:
    from PAGINA_WEB.site import website

    catalog = website.get_catalog(force=True)
    out = []
    for section in catalog:
        products = []
        for p in section.get("products", []):
            if not (p.get("is_combo") and p.get("buyable")):
                continue
            item = dict(p)
            item["photo"] = _pdf_photo_url(str(item.get("photo") or ""))
            products.append(item)
        if products:
            out.append({"name": section.get("name", "Otros"), "products": products})
    return out


def render_html() -> tuple[str, dict]:
    from jinja2 import Environment, FileSystemLoader, select_autoescape

    sections = _catalog_for_pdf()
    total_products = sum(len(s["products"]) for s in sections)
    env = Environment(
        loader=FileSystemLoader(str(SITE_DIR / "templates")),
        autoescape=select_autoescape(["html", "xml"]),
    )
    template = env.get_template("catalogo_pdf.html")
    html = template.render(
        sections=sections,
        total_products=total_products,
        generated_label=datetime.now().strftime("%B %Y"),
        logo_url=_asset_url(ROOT / "DISENO CORPORATIVO " / "LOGO MCKENNA.jpg"),
    )
    stats = {
        "sections": len(sections),
        "products": total_products,
        "photos": sum(1 for s in sections for p in s["products"] if p.get("photo")),
    }
    return html, stats


def generate_pdf(write_html: bool = True) -> dict:
    try:
        from weasyprint import HTML
    except Exception as exc:  # pragma: no cover - environment guard
        raise RuntimeError(
            "WeasyPrint no está disponible. Instala `weasyprint` o usa "
            "`scripts/generar_catalogo.py` como fallback ReportLab."
        ) from exc

    html, stats = render_html()
    if write_html:
        OUT_HTML.write_text(html, encoding="utf-8")
    HTML(string=html, base_url=str(ROOT)).write_pdf(str(OUT_PDF))
    stats.update({"pdf": str(OUT_PDF), "size_kb": OUT_PDF.stat().st_size // 1024})
    if write_html:
        stats["html"] = str(OUT_HTML)
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description="Genera catálogo PDF HTML/CSS.")
    parser.add_argument("--no-html", action="store_true", help="No escribir HTML intermedio.")
    args = parser.parse_args()
    stats = generate_pdf(write_html=not args.no_html)
    print(stats)


if __name__ == "__main__":
    load_dotenv(ROOT / ".env")
    main()
