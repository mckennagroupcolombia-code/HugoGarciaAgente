#!/usr/bin/env python3
"""
Chequeos rápidos: bridge WhatsApp, JIDs preventa/postventa, seller_id MeLi, estado cola postventa.

Uso (raíz del repo, venv activo):
  python3 scripts/diagnostico_preventa_postventa_wa.py
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))
os.chdir(REPO)

from dotenv import load_dotenv

load_dotenv(REPO / ".env")


def main() -> int:
    from app.utils import (
        URL_API_WHATSAPP,
        jid_grupo_postventa_wa,
        jid_grupo_preventa_wa,
        obtener_seller_id_meli,
        refrescar_token_meli,
    )

    import requests

    print("=== McKenna — preventa / postventa / WhatsApp ===\n")

    wa_base = URL_API_WHATSAPP.replace("/enviar", "").rstrip("/") or "http://127.0.0.1:3000"
    mon = f"{wa_base}/monitor/json"
    print(f"URL_API_WHATSAPP: {URL_API_WHATSAPP}")
    print(f"GRUPO_PREVENTA_WA → {jid_grupo_preventa_wa()}")
    print(f"GRUPO_POSTVENTA_WA → {jid_grupo_postventa_wa()}")
    print()

    print("--- Bridge Node (puerto típico 3000) ---")
    try:
        r = requests.get(mon, timeout=5)
        print(f"GET {mon} → HTTP {r.status_code}")
        if r.ok:
            try:
                j = r.json()
                ready = j.get("sistemaListo") or j.get("ready")
                print(f"  JSON keys: {list(j.keys())[:12]}…")
                if ready is not None:
                    print(f"  sistemaListo/ready: {ready}")
            except Exception:
                print(f"  body: {r.text[:200]}")
    except requests.RequestException as e:
        print(f"❌ No responde el monitor: {e}")
        print("  Sin bot-mckenna activo, preventa/postventa NO pueden avisar por WhatsApp.")
    print()

    print("--- Seller ID (postventa API) ---")
    sid_arch = obtener_seller_id_meli()
    print(f"  desde credenciales (obtener_seller_id_meli): {sid_arch}")
    token = refrescar_token_meli()
    if token:
        try:
            rm = requests.get(
                "https://api.mercadolibre.com/users/me",
                headers={"Authorization": f"Bearer {token}"},
                timeout=10,
            )
            if rm.status_code == 200:
                mid = rm.json().get("id")
                print(f"  /users/me id: {mid}")
                if mid is not None and int(mid) != int(sid_arch):
                    print(
                        "  ⚠️ DISCREPANCIA: credenciales seller_id/user_id ≠ /users/me — "
                        "actualiza credenciales_meli.json o el token es de otra cuenta."
                    )
            else:
                print(f"  /users/me → HTTP {rm.status_code}")
        except Exception as e:
            print(f"  error /users/me: {e}")
    else:
        print("  (sin token MeLi — no se comparó con /users/me)")
    print()

    print("--- Cola postventa (JSON) ---")
    p = REPO / "app" / "data" / "mensajes_posventa_pendientes.json"
    if p.is_file():
        with open(p, encoding="utf-8") as f:
            st = json.load(f)
        pend = st.get("pendientes") or {}
        proc = st.get("procesados") or []
        print(f"  archivo: {p}")
        print(f"  pendientes: {len(pend)} | ids procesados (últimos): {len(proc)}")
        if pend:
            for k in list(pend.keys())[:5]:
                print(f"    · código {k}: pack {pend[k].get('pack_id')}")
    else:
        print(f"  (no existe {p})")
    print()

    print("--- Webhook MeLi (recordatorio) ---")
    print("  Callback debe apuntar SOLO a webhook_meli :8080 (no duplicar en :8081).")
    print("  Tópicos: questions (preventa), messages (postventa), orders_v2.")
    print()
    print("  Si hay 2 procesos webhook_meli: ./scripts/normalizar_webhook_meli.sh")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
