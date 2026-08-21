#!/bin/bash
# Reinicia agente_pro en :8081 (carga rutas nuevas del panel).
set -euo pipefail
cd /home/mckg/mi-agente

echo "Deteniendo agente_pro…"
pkill -f '/home/mckg/mi-agente/venv/bin/python3 -u /home/mckg/mi-agente/agente_pro.py' 2>/dev/null || true
pkill -f 'python3 -u /home/mckg/mi-agente/agente_pro.py' 2>/dev/null || true
sleep 2
# Si sigue vivo (otro usuario), intentar con systemctl
if pgrep -f 'agente_pro.py$' >/dev/null 2>&1; then
  if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl restart mckenna-agente 2>/dev/null \
      || sudo systemctl restart agente-pro 2>/dev/null \
      || true
  fi
  sleep 2
fi

if ss -ltn 2>/dev/null | grep -q ':8081'; then
  echo "Puerto 8081 aún ocupado — mata el proceso a mano y vuelve a correr este script."
  ss -ltnp | grep 8081 || true
  exit 1
fi

source venv/bin/activate
nohup python3 -u agente_pro.py >> /tmp/agente_pro_restart.log 2>&1 &
echo "Nuevo PID $!"
sleep 4

echo -n "status: "
curl -s -m 5 http://127.0.0.1:8081/status | head -c 200 || echo FAIL
echo
echo -n "escanear-url: "
curl -s -m 5 -w " HTTP:%{http_code}\n" -X POST http://127.0.0.1:8081/api/fichas/ft/escanear-url \
  -H 'Content-Type: application/json' -d '{}' | head -c 300
echo
# 401/400 = ruta viva; 404/405 = aún no cargó
