#!/usr/bin/env python3
"""Procesa a mano las fotos de COA de un canal (las que llegaron antes de existir el automático,
o para revisar un lote). Por defecto solo muestra qué haría; `--aplicar` escribe y avisa en el grupo.

    venv/bin/python scripts/coa_canal_procesar.py --canal 1 --desde-id 241
    venv/bin/python scripts/coa_canal_procesar.py --canal 1 --desde-id 241 --aplicar

Cada foto nueva cuesta ~2 llamadas a gemini-2.5-flash (centavos de dólar); la lectura queda
guardada en app/data/coa_canal_auto.db, así que aplicar después de revisar no vuelve a pagarla.
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from app.services import coa_canal_auto as auto  # noqa: E402
from app.services.canales_internos import UPLOADS_DIR, _conn as conn_canales  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--canal", type=int, required=True)
    ap.add_argument("--desde-id", type=int, required=True, help="primer id de canal_mensajes a tomar")
    ap.add_argument("--hasta-id", type=int, default=0)
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--sin-aviso", action="store_true", help="aplica sin escribir en el grupo")
    ap.add_argument("--reprocesar", action="store_true",
                    help="vuelve a pasar fotos ya procesadas (usa la lectura guardada: no repite el OCR)")
    a = ap.parse_args()

    q = ("SELECT id, adjunto_archivo, adjunto_mime, wa_media_path FROM canal_mensajes "
         "WHERE canal_id=? AND id>=? AND eliminado=0 AND (adjunto_archivo IS NOT NULL OR wa_media_path IS NOT NULL)")
    args: list = [a.canal, a.desde_id]
    if a.hasta_id:
        q += " AND id<=?"
        args.append(a.hasta_id)
    with conn_canales() as c:
        filas = c.execute(q + " ORDER BY id", args).fetchall()
    ids = []
    for f in filas:
        if not auto.es_imagen(f["adjunto_mime"]):
            continue
        if f["adjunto_archivo"]:
            ruta = os.path.join(UPLOADS_DIR, f["adjunto_archivo"])
        else:
            from app.services.wa_chats import resolver_media_absoluto

            ruta = resolver_media_absoluto(f["wa_media_path"]) or ""
        if not os.path.isfile(ruta):
            print(f"  #{f['id']}: no está el archivo {ruta}")
            continue
        with auto._conn() as c:
            c.execute("INSERT OR IGNORE INTO coa_fotos (mensaje_id, canal_id, ruta, mime, creado_en) VALUES (?,?,?,?,strftime('%s','now'))",
                      (f["id"], a.canal, ruta, f["adjunto_mime"]))
            if a.reprocesar and a.aplicar:
                c.execute("UPDATE coa_fotos SET estado='pendiente' WHERE mensaje_id=?", (f["id"],))
        ids.append(int(f["id"]))
    print(f"{len(ids)} foto(s): {ids}")
    r = auto.procesar_pendientes(a.canal, escribir=a.aplicar, avisar=not a.sin_aviso, mensaje_ids=ids)
    for x in r["resultados"]:
        print(f"- [{x['estado']}] {x.get('producto_coa')!r} → {x.get('archivo') or '—'} lote {x.get('lote')!r}"
              f" (antes {x.get('lote_anterior')!r}) filas={x.get('filas')} fotos={x['mensajes']} {x.get('candidatos') or ''}")
    print("\n" + (r.get("texto") or ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
