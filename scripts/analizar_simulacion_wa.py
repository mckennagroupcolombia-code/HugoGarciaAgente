#!/usr/bin/env python3
"""
Analiza los resultados de simular_conversaciones_wa.py (JSONL) y produce un
resumen: tasa de flags por tipo, latencias, uso de contexto de catálogo,
y ejemplos de los peores turnos.

Uso: python3 scripts/analizar_simulacion_wa.py <resultados.jsonl>
"""
from __future__ import annotations

import json
import statistics
import sys
from collections import Counter


def main(path: str) -> None:
    convs = [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]
    turnos = [t for c in convs for t in c["turnos"]]
    n_conv, n_turn = len(convs), len(turnos)
    print(f"Conversaciones: {n_conv} | Turnos: {n_turn}")

    lat = [t["seg"] for t in turnos if isinstance(t.get("seg"), (int, float))]
    if lat:
        print(
            f"Latencia por turno: mediana {statistics.median(lat):.1f}s · "
            f"p90 {sorted(lat)[int(len(lat)*0.9)]:.1f}s · max {max(lat):.1f}s"
        )

    ctx = sum(1 for t in turnos if t.get("ctx_catalogo") or t.get("ctx_ficha"))
    print(f"Turnos con contexto real (catálogo/ficha): {ctx} ({100*ctx/n_turn:.0f}%)")

    flags = Counter()
    for t in turnos:
        for f in t["flags"]:
            flags[f.split(":")[0]] += 1
    cflags = Counter()
    for c in convs:
        for f in c["flags_conversacion"]:
            cflags[f] += 1

    print("\nFlags por turno (de", n_turn, "turnos):")
    for f, n in flags.most_common():
        print(f"  {f:42s} {n:4d}  ({100*n/n_turn:.1f}%)")
    print("\nFlags por conversación (de", n_conv, "):")
    for f, n in cflags.most_common():
        print(f"  {f:42s} {n:4d}  ({100*n/n_conv:.0f}%)")

    graves = [
        (c["conv"], t)
        for c in convs
        for t in c["turnos"]
        if any(
            f.startswith(("numero_sospechoso", "nequi", "promete_despacho", "excepcion", "promesa_vacia", "afirma_disponibilidad"))
            for f in t["flags"]
        )
    ]
    print(f"\nTurnos con flags graves: {len(graves)}")
    for conv_i, t in graves[:12]:
        print(f"\n[conv {conv_i} turno {t['i']}] ⚑ {t['flags']}")
        print(f"  C: {t['cliente'][:110]}")
        print(f"  B: {t['bot'][:260]}")


if __name__ == "__main__":
    main(sys.argv[1])
