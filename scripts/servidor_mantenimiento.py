#!/usr/bin/env python3
"""
Servidor de respaldo: sirve la página de mantenimiento en el puerto de la web
(8083) mientras `mckenna-website.service` está detenido.

Cloudflare pasa tal cual una respuesta 503 con cuerpo del origen (solo sustituye
los 502/504 de origen caído), así que el visitante ve la página de McKenna y no
el error genérico de Cloudflare. Lo arranca systemd cuando la web se detiene
(`ExecStopPost` en mckenna-website.service) y lo apaga la propia web al volver
(`Conflicts=` + `After=`), sin que nadie tenga que acordarse.

  python3 scripts/servidor_mantenimiento.py [--puerto 8083]
"""

from __future__ import annotations

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PAGINA = REPO / "PAGINA_WEB" / "site" / "mantenimiento" / "index.html"
RETRY_AFTER_SEG = 120


def _cuerpo() -> bytes:
    try:
        return PAGINA.read_bytes()
    except OSError:
        return ("<!doctype html><meta charset='utf-8'><title>McKenna Group</title>"
                "<p style='font-family:sans-serif;padding:40px'>Estamos en mantenimiento. Vuelve en unos minutos.</p>").encode("utf-8")


class Manejador(BaseHTTPRequestHandler):
    server_version = "McKennaMantenimiento/1.0"

    def _responder(self, con_cuerpo: bool) -> None:
        cuerpo = _cuerpo()
        # /status y /api/status responden JSON 503: los monitores distinguen "en
        # mantenimiento" de "caído" y no disparan alertas de puerto muerto.
        if self.path.split("?")[0] in ("/status", "/api/status", "/health"):
            cuerpo = b'{"ok": false, "estado": "mantenimiento"}'
            tipo = "application/json"
        else:
            tipo = "text/html; charset=utf-8"
        self.send_response(503)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(cuerpo)))
        self.send_header("Retry-After", str(RETRY_AFTER_SEG))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if con_cuerpo:
            self.wfile.write(cuerpo)

    def do_GET(self) -> None:  # noqa: N802
        self._responder(True)

    def do_HEAD(self) -> None:  # noqa: N802
        self._responder(False)

    def do_POST(self) -> None:  # noqa: N802
        # Webhooks (MercadoPago, WhatsApp) reciben 503 + Retry-After y reintentan solos.
        self._responder(True)

    def log_message(self, fmt: str, *args) -> None:  # silencio: systemd ya registra arranque/parada
        pass


class Servidor(ThreadingHTTPServer):
    allow_reuse_address = True  # el puerto puede estar en TIME_WAIT tras parar la web
    daemon_threads = True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--puerto", type=int, default=8083)
    a = ap.parse_args()
    srv = Servidor(("0.0.0.0", a.puerto), Manejador)
    print(f"mantenimiento: sirviendo {PAGINA.name} en :{a.puerto}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
