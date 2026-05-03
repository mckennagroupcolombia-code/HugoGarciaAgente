#!/usr/bin/env python3
"""
Proceso puntual para la cola postventa MeLi (app/data/mensajes_posventa_pendientes.json).

No instala cron ni recordatorios: evita ruido en WhatsApp y problemas de caché/dedupe.

Uso (desde la raíz del repo, con venv y .env):
  python3 scripts/postventa_cola_meli.py --list
  python3 scripts/postventa_cola_meli.py --limpiar-ya-respondidos
  python3 scripts/postventa_cola_meli.py --enviar 4214 "Cordial saludo. Tu mensaje aquí."

--limpiar-ya-respondidos: consulta MeLi por cada entrada en pendientes; si el último
mensaje del hilo post_sale es del vendedor, quita esa fila del JSON (ya contestaste
en MeLi aunque el comando posventa no hubiera llegado a Flask).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
STATE_PATH = REPO / "app" / "data" / "mensajes_posventa_pendientes.json"

if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

os.chdir(REPO)

from dotenv import load_dotenv

load_dotenv(REPO / ".env")


def _seller_id() -> int:
    from app.utils import obtener_seller_id_meli

    return obtener_seller_id_meli()


def _cargar_state() -> dict:
    if not STATE_PATH.is_file():
        return {"pendientes": {}, "procesados": []}
    with open(STATE_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _guardar_state(data: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "x-version": "2"}


def _msg_sort_key(m: dict) -> str:
    msg_date = m.get("message_date")
    if isinstance(msg_date, dict):
        return str(
            msg_date.get("created")
            or msg_date.get("received")
            or msg_date.get("available")
            or msg_date.get("notified")
            or ""
        )
    return str(
        m.get("date")
        or m.get("date_created")
        or m.get("message_date")
        or m.get("timestamp")
        or ""
    )


def _ultimo_remitente_pack(token: str, pack_id: str, seller_id: int) -> str | None:
    import requests

    url = (
        f"https://api.mercadolibre.com/messages/packs/{pack_id}/sellers/"
        f"{seller_id}?tag=post_sale"
    )
    r = requests.get(url, headers=_headers(token), timeout=15)
    if r.status_code != 200:
        print(f"  ⚠️ Pack {pack_id}: HTTP {r.status_code} — no se pudo leer hilo")
        return None
    msgs = r.json().get("messages") or []
    if not msgs:
        return None
    ordenados = sorted(msgs, key=_msg_sort_key)
    last = ordenados[-1]
    uid = str(last.get("from", {}).get("user_id", ""))
    return uid


def cmd_list() -> int:
    st = _cargar_state()
    pend = st.get("pendientes") or {}
    if not pend:
        print("Cola vacía (pendientes).")
        return 0
    print(f"Entradas en cola ({len(pend)}):\n")
    for codigo, e in sorted(pend.items(), key=lambda x: x[0]):
        print(f"  código: {codigo}")
        print(f"  pack_id: {e.get('pack_id')}")
        print(f"  comprador: {e.get('comprador')}")
        print(f"  msg_id: {e.get('msg_id')}")
        print(f"  cuando: {e.get('timestamp')}")
        txt = (e.get("texto") or "").replace("\n", " ")
        print(f"  mensaje: {txt[:200]}{'…' if len(txt) > 200 else ''}")
        if e.get("productos"):
            print(f"  productos:{e['productos']}")
        print(f"  → WhatsApp: posventa {codigo}: tu respuesta\n")
    return 0


def cmd_limpiar() -> int:
    from app.utils import refrescar_token_meli

    token = refrescar_token_meli()
    if not token:
        print("❌ Sin token MeLi.")
        return 1
    seller_id = _seller_id()
    st = _cargar_state()
    pend = dict(st.get("pendientes") or {})
    if not pend:
        print("Nada que limpiar.")
        return 0
    quitados = []
    for codigo, e in list(pend.items()):
        pack_id = str(e.get("pack_id") or "")
        if not pack_id:
            continue
        uid = _ultimo_remitente_pack(token, pack_id, seller_id)
        if uid is None:
            continue
        if uid == str(seller_id):
            del pend[codigo]
            quitados.append((codigo, pack_id))
            print(f"✅ Quitado de cola (último mensaje = vendedor): {codigo} pack={pack_id}")
        else:
            print(f"⏳ Sigue pendiente (último = comprador): {codigo} pack={pack_id}")
    st["pendientes"] = pend
    _guardar_state(st)
    print(f"\nHecho. Quitados: {len(quitados)}")
    return 0


def cmd_enviar(codigo: str, texto: str) -> int:
    from modulo_posventa import responder_mensaje_posventa

    st = _cargar_state()
    pend = st.get("pendientes") or {}
    codigo_u = codigo.strip().upper()
    entrada = pend.get(codigo_u)
    if not entrada:
        for k, v in pend.items():
            if k.endswith(codigo_u) or codigo_u.endswith(k):
                entrada = v
                codigo_u = k
                break
    if not entrada:
        print(f"❌ No hay pendiente con código '{codigo}'. Usa --list.")
        return 1
    pack_id = str(entrada["pack_id"])
    ok = responder_mensaje_posventa(pack_id, texto, entrada.get("from_id"))
    if not ok:
        print("❌ MeLi rechazó el envío (ver consola arriba).")
        return 1
    del pend[codigo_u]
    st["pendientes"] = pend
    _guardar_state(st)
    print(f"✅ Enviado y quitado de cola: {codigo_u} pack={pack_id}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Cola postventa MeLi (puntual, sin recordatorios)")
    ap.add_argument("--list", action="store_true", help="Listar pendientes en JSON")
    ap.add_argument(
        "--limpiar-ya-respondidos",
        action="store_true",
        help="Quitar de JSON los que ya tienen última respuesta del vendedor en MeLi",
    )
    ap.add_argument(
        "--enviar",
        nargs=2,
        metavar=("CODIGO", "TEXTO"),
        help='Enviar texto al comprador y sacar de cola, ej. --enviar 4214 "Hola..."',
    )
    args = ap.parse_args()
    if args.limpiar_ya_respondidos:
        return cmd_limpiar()
    if args.enviar:
        return cmd_enviar(args.enviar[0], args.enviar[1])
    return cmd_list()


if __name__ == "__main__":
    raise SystemExit(main())
