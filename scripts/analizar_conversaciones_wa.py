#!/usr/bin/env python3
"""
Minero de conversaciones WhatsApp (wa_chats.db).

Extrae pares (pregunta del cliente → respuesta humana) de los chats reales para
alimentar el aprendizaje del bot: detecta políticas repetidas del equipo y
candidatos a casos de entrenamiento.

Uso:
    python3 scripts/analizar_conversaciones_wa.py            # reporte en consola
    python3 scripts/analizar_conversaciones_wa.py --json     # además escribe
        app/training/candidatos_casos_whatsapp.json (para curaduría manual;
        NO se inyecta al prompt automáticamente)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
from collections import Counter

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

DB = os.path.join("app", "data", "wa_chats.db")
OUT = os.path.join("app", "training", "candidatos_casos_whatsapp.json")

_RUIDO = {
    "ok", "si", "sí", "no", "listo", "gracias", "muchas gracias", "hola",
    "buenas", "buenos días", "buenos dias", "buenas tardes", "buenas noches",
    "buen día", "buen dia", "vale", "[adjunto]", ".", "👍", "🙏", "de nada",
}

TEMAS = [
    ("precio", re.compile(r"\b(precio|cu[aá]nto|cuesta|vale|valor|cotiz)", re.I)),
    ("disponibilidad", re.compile(r"\b(tienen|manejan|disponib|stock|hay|venden)", re.I)),
    ("pago", re.compile(r"\b(pago|pagar|cuenta|nequi|llave|transferencia|consignar|contra ?entrega)", re.I)),
    ("envio", re.compile(r"\b(env[ií]o|entrega|demora|llega|transportadora|gu[ií]a|domicilio)", re.I)),
    ("documentos", re.compile(r"\b(ficha|coa|certificado|invima|msds|registro)", re.I)),
    ("uso_tecnico", re.compile(r"\b(sirve|usar|uso|dosis|aplicar|mezclar|f[oó]rmula|concentraci[oó]n)", re.I)),
]


def clasificar_tema(texto: str) -> str:
    for tema, pat in TEMAS:
        if pat.search(texto):
            return tema
    return "otro"


def es_util(texto: str) -> bool:
    t = re.sub(r"\s+", " ", (texto or "").strip().lower())
    return bool(t) and t not in _RUIDO and len(t) >= 8


def extraer_pares(max_gap_seg: int = 3600) -> list[dict]:
    """Pares consulta_cliente → primera respuesta humana en <= max_gap_seg."""
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """SELECT ts, jid, direccion, enviado_por, texto FROM mensajes
           WHERE eliminado=0 AND jid NOT LIKE '%@g.us'
           ORDER BY jid, ts"""
    ).fetchall()
    conn.close()

    pares: list[dict] = []
    por_jid: dict[str, list] = {}
    for r in rows:
        por_jid.setdefault(r["jid"], []).append(r)

    for jid, msgs in por_jid.items():
        for i, m in enumerate(msgs):
            if m["direccion"] != "entrada" or not es_util(m["texto"] or ""):
                continue
            respuesta: list[str] = []
            for j in range(i + 1, len(msgs)):
                n = msgs[j]
                if n["ts"] - m["ts"] > max_gap_seg:
                    break
                if n["direccion"] == "entrada":
                    if respuesta:
                        break
                    continue
                if n["enviado_por"] == "humano" and es_util(n["texto"] or ""):
                    respuesta.append((n["texto"] or "").strip())
                    if len(respuesta) >= 3:
                        break
                elif respuesta:
                    break
            if respuesta:
                pregunta = (m["texto"] or "").strip()
                pares.append(
                    {
                        "jid": jid,
                        "tema": clasificar_tema(pregunta),
                        "pregunta": pregunta[:400],
                        "respuesta_humana": "\n".join(respuesta)[:600],
                    }
                )
    return pares


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true", help="escribe candidatos a JSON")
    ap.add_argument("--tema", default="", help="filtra un tema en el reporte")
    ap.add_argument("--n", type=int, default=15, help="ejemplos por tema en consola")
    args = ap.parse_args()

    pares = extraer_pares()
    temas = Counter(p["tema"] for p in pares)
    print(f"Pares pregunta→respuesta humana extraídos: {len(pares)}")
    print("Por tema:", dict(temas.most_common()))

    seleccion = [p for p in pares if not args.tema or p["tema"] == args.tema]
    vistos: set[str] = set()
    por_tema: Counter = Counter()
    print("\n--- Muestras (dedupe por pregunta normalizada) ---")
    for p in seleccion:
        clave = re.sub(r"\W+", " ", p["pregunta"].lower()).strip()[:80]
        if clave in vistos or por_tema[p["tema"]] >= args.n:
            continue
        vistos.add(clave)
        por_tema[p["tema"]] += 1
        print(f"\n[{p['tema']}] C: {p['pregunta'][:160]}")
        print(f"          H: {p['respuesta_humana'][:200]}")

    if args.json:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(OUT, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "_nota": (
                        "Candidatos extraídos de chats reales para curaduría "
                        "manual. Revisar antes de promover cualquier entrada a "
                        "casos_especiales.json — NO se inyecta automáticamente."
                    ),
                    "total": len(pares),
                    "por_tema": dict(temas),
                    "pares": pares,
                },
                f,
                ensure_ascii=False,
                indent=1,
            )
        print(f"\nEscrito: {OUT} ({len(pares)} pares)")


if __name__ == "__main__":
    main()
