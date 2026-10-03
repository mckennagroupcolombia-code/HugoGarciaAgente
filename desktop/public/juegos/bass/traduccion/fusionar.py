#!/usr/bin/env python3
"""Vuelca es.txt (índice|texto con " / " y " ¶ ") en el campo "es" de mensajes.json."""
import json, re, sys
from pathlib import Path
AQUI = Path(__file__).resolve().parent
ms = json.loads((AQUI / "mensajes.json").read_text(encoding="utf-8"))
n = 0
for linea in (AQUI / "es.txt").read_text(encoding="utf-8").splitlines():
    if not linea or linea.startswith("#") or "|" not in linea: continue
    idx, txt = linea.split("|", 1)
    txt = txt.rstrip()
    if txt.endswith(" ¶"): txt = txt[:-2] + "\n¶\n"
    txt = txt.replace(" ¶ ", "\n¶\n").replace(" / ", "\n")
    ms[int(idx)]["es"] = txt; n += 1
(AQUI / "mensajes.json").write_text(json.dumps(ms, ensure_ascii=False, indent=1), encoding="utf-8")
print("traducciones cargadas:", n)
