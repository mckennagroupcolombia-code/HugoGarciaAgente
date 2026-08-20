#!/usr/bin/env python3
"""Cruza publicaciones MeLi con SIIGO y carga en el catálogo web las que se pueden clasificar."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "PAGINA_WEB" / "site"))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")


def _fotos_por_meli_id(ids: list[str], token: str) -> dict[str, str]:
    import requests

    out: dict[str, str] = {}
    headers = {"Authorization": f"Bearer {token}"}
    for i in range(0, len(ids), 20):
        batch = ids[i : i + 20]
        res = requests.get(
            "https://api.mercadolibre.com/items",
            params={"ids": ",".join(batch), "attributes": "id,pictures"},
            headers=headers,
            timeout=40,
        )
        if res.status_code != 200:
            continue
        for entry in res.json() or []:
            if entry.get("code") != 200:
                continue
            body = entry.get("body") or {}
            mid = str(body.get("id") or "")
            pics = body.get("pictures") or []
            if not mid or not pics:
                continue
            url = (pics[0].get("secure_url") or pics[0].get("url") or "").strip()
            if url:
                out[mid] = url
    return out


def main() -> int:
    from app.tools.relacion_codigos_meli_siigo import _get_meli_items
    from app.utils import refrescar_token_meli
    import website as web

    print("Listando publicaciones MeLi (activas y pausadas)…", flush=True)
    items = _get_meli_items()
    print(f"  {len(items)} publicaciones", flush=True)

    candidatos = []
    for it in items:
        cat = web.categoria_publicacion_web(it.get("sku_meli") or "", it.get("titulo") or "")
        if cat:
            it = dict(it)
            it["cat"] = cat
            candidatos.append(it)
    print(f"  {len(candidatos)} categorizables para la web", flush=True)

    mids = [c["meli_id"] for c in candidatos if c.get("meli_id")]
    token = refrescar_token_meli()
    fotos = _fotos_por_meli_id(mids, token) if token else {}
    for c in candidatos:
        c["photo"] = fotos.get(c.get("meli_id") or "", "")

    print("Consultando SIIGO y fusionando catálogo…", flush=True)
    resultado = web.incorporar_publicaciones_meli_al_catalogo(candidatos)
    print(json.dumps({
        "agregadas": resultado["agregadas"],
        "n_agregadas": len(resultado["agregadas"]),
        "n_actualizadas": len(resultado["actualizadas"]),
        "omitidas": resultado["omitidas"],
        "n_sin_siigo": len(resultado["sin_siigo"]),
        "sin_siigo": resultado["sin_siigo"][:40],
        "fichas": resultado["fichas"],
        "combos": resultado["combos"],
        "lineas": resultado["lineas"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
