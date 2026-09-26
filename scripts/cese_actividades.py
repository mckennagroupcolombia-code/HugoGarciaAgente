#!/usr/bin/env python3
"""
Cese de actividades global: pausa todos los canales de venta con un solo comando.

    python3 scripts/cese_actividades.py --activar      # web + WhatsApp + MeLi
    python3 scripts/cese_actividades.py --desactivar   # los tres vuelven (MeLi: solo lo que se pausó)
    python3 scripts/cese_actividades.py --estado

  Web       PAGINA_WEB/site/data/MANTENIMIENTO con «cese» → mantenimiento/cese.html (503)
  WhatsApp  app/data/cese_actividades.json → aviso automático al cliente y el puente
            rechaza envíos a clientes (también los del panel). Lo que se escribe desde el
            teléfono no se puede frenar.
  MeLi      scripts/pausa_global_meli.py (pausa y lista en app/data/meli_pausa_global.json)

No hace falta reiniciar nada: cada pieza lee su archivo en cada petición. Sin LLM.
Detalle: app/services/cese_actividades.py.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)

from app.services import cese_actividades as cese  # noqa: E402
from app.services.meli import pausa_global_meli_activa  # noqa: E402

FLAG_WEB = os.path.join(REPO, "PAGINA_WEB", "site", "data", "MANTENIMIENTO")
PY = sys.executable


def _guardar(data: dict) -> None:
    tmp = cese.ARCHIVO + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, cese.ARCHIVO)


def _meli(accion: str) -> None:
    subprocess.run([PY, os.path.join(REPO, "scripts", "pausa_global_meli.py"), accion], check=False)


def activar(mensaje: str | None) -> None:
    data = cese.estado()
    data.update({
        "activa": True,
        "desde": data.get("desde") if data.get("activa") else datetime.now().isoformat(timespec="seconds"),
        "mensaje_whatsapp": mensaje or data.get("mensaje_whatsapp") or cese.MENSAJE_DEFAULT,
        # Números 1:1 a los que el puente sí deja enviar (asesor que recibe las alertas).
        "numeros_internos": data.get("numeros_internos")
        or [x.strip() for x in os.getenv("WA_V2_ALERTA_DESTINO", "573182432463").split(",") if x.strip()],
    })
    _guardar(data)
    with open(FLAG_WEB, "w", encoding="utf-8") as f:
        f.write("cese\n")
    print("WhatsApp: aviso de suspensión activo · envíos a clientes bloqueados")
    print("Web: página de mantenimiento (cese) activa")
    if pausa_global_meli_activa():
        print("MeLi: ya estaba pausado")
    else:
        _meli("--pausar")


def desactivar() -> None:
    data = cese.estado()
    data["activa"] = False
    data["hasta"] = datetime.now().isoformat(timespec="seconds")
    _guardar(data)
    try:
        os.remove(FLAG_WEB)
    except FileNotFoundError:
        pass
    print("WhatsApp y web: de vuelta a la normalidad")
    if pausa_global_meli_activa():
        _meli("--reactivar")


def main() -> None:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--activar", action="store_true")
    g.add_argument("--desactivar", action="store_true")
    g.add_argument("--estado", action="store_true")
    ap.add_argument("--mensaje", help="texto del aviso por WhatsApp")
    a = ap.parse_args()
    if a.activar:
        activar(a.mensaje)
    elif a.desactivar:
        desactivar()
    else:
        print(json.dumps({
            "whatsapp": cese.estado(),
            "web_mantenimiento": os.path.exists(FLAG_WEB),
            "meli_pausado": pausa_global_meli_activa(),
        }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
