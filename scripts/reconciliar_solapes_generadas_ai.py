#!/usr/bin/env python3
"""
Pasada final anti-solapes para plantillas generadas por IA del Studio Visual
(marca origen_ai o carpeta legacy "Generadas AI").

Después de regenerar desde los .ai y de pasar el saneo de compliance, algunos
textos pueden rozarse (p. ej. las advertencias contra "Desarrollado por", o la
descripción con el pie legal contra la línea de la cuchara). Esta pasada
detecta pares de TEXTOS cuyos contenidos renderizados se solapan de forma
significativa y encoge la fuente del texto "invasor" hasta despejar el par.

No toca las plantillas modelo aprobadas del apartado Imprimir.

Uso:
  python3 scripts/reconciliar_solapes_generadas_ai.py            # dry-run
  python3 scripts/reconciliar_solapes_generadas_ai.py --guardar
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

_REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_REPO))
sys.path.insert(0, str(_REPO / "scripts"))

from generar_plantillas_visuales_desde_ai import (  # noqa: E402
    APROBADOS_IDS,
    _caja_render_elemento,
)

PLANTILLAS_PATH = _REPO / "app" / "data" / "plantillas_visuales.json"

# Textos "fijos" que nunca se encogen: el otro miembro del par es el invasor
FIJOS = ("desarrollado por", "incluye ", "lot.")
MIN_PX = 3.2


def _pares_texto(p: dict) -> list[tuple[dict, dict, float]]:
    """Pares de elementos texto solapados con su área de intersección."""
    els = [e for e in p.get("elementos", []) if e.get("type") == "text"]
    cajas = [(e, _caja_render_elemento(e)) for e in els]
    cajas = [(e, c) for e, c in cajas if c]
    pares = []
    for i in range(len(cajas)):
        for j in range(i + 1, len(cajas)):
            (ea, (ax0, ay0, ax1, ay1)), (eb, (bx0, by0, bx1, by1)) = cajas[i], cajas[j]
            iw = min(ax1, bx1) - max(ax0, bx0)
            ih = min(ay1, by1) - max(ay0, by0)
            if iw <= 0 or ih <= 0:
                continue
            inter = iw * ih
            fs_min = min(float(ea.get("fontSize") or 6), float(eb.get("fontSize") or 6))
            # roce mínimo: menos de media línea de intersección vertical se ignora
            if ih < 0.55 * fs_min:
                continue
            a_min = min((ax1 - ax0) * (ay1 - ay0), (bx1 - bx0) * (by1 - by0))
            es_fijo = any(str(e.get("content") or "").strip().lower().startswith(FIJOS)
                          for e in (ea, eb))
            if es_fijo or inter > 0.25 * a_min:
                pares.append((ea, eb, inter))
    return pares


def _invasor(ea: dict, eb: dict) -> dict:
    """Elige a quién encoger: nunca los bloques fijos; si no, el de arriba
    (cuyo texto envuelto baja sobre el otro)."""
    a_fijo = str(ea.get("content") or "").strip().lower().startswith(FIJOS)
    b_fijo = str(eb.get("content") or "").strip().lower().startswith(FIJOS)
    if a_fijo and not b_fijo:
        return eb
    if b_fijo and not a_fijo:
        return ea
    return ea if float(ea.get("y") or 0) <= float(eb.get("y") or 0) else eb


def reconciliar(p: dict) -> list[str]:
    cambios: list[str] = []
    for _ in range(40):
        pares = _pares_texto(p)
        if not pares:
            break
        progreso = False
        for ea, eb, _inter in pares:
            el = _invasor(ea, eb)
            px = float(el.get("fontSize") or 6)
            if px > MIN_PX:
                el["fontSize"] = round(px - 0.25, 2)
                cambios.append(str(el.get("content") or "")[:30])
                progreso = True
        if not progreso:
            break
    return cambios


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--guardar", action="store_true")
    args = ap.parse_args()

    data = json.loads(PLANTILLAS_PATH.read_text())
    tocadas = 0
    pendientes: list[str] = []
    for p in data.get("plantillas", []):
        es_ai = bool(p.get("origen_ai")) or (p.get("carpeta") or "") == "Generadas AI"
        if not es_ai or p["id"] in APROBADOS_IDS:
            continue
        cambios = reconciliar(p)
        if cambios:
            tocadas += 1
            print(f"[fix] {p['nombre']}: fuente reducida en {len(cambios)} paso(s)")
        if _pares_texto(p):
            pendientes.append(p["nombre"])

    print(f"\nPlantillas ajustadas: {tocadas}")
    if pendientes:
        print(f"Aún con roces ({len(pendientes)}): " + "; ".join(pendientes[:20]))
    if args.guardar:
        backup = PLANTILLAS_PATH.with_name(
            f"plantillas_visuales.pre_reconciliar_{datetime.now():%Y%m%d_%H%M}.json"
        )
        shutil.copy2(PLANTILLAS_PATH, backup)
        PLANTILLAS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=1))
        print(f"💾 Guardado. Backup: {backup.name}")
    else:
        print("(dry-run: usa --guardar)")


if __name__ == "__main__":
    main()
