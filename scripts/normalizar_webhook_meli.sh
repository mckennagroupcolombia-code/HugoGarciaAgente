#!/bin/bash
# Deja un solo webhook MeLi en :8080, gestionado por systemd (para cuando hay 2+ python3 … webhook_meli.py).
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "1) Parando unidad systemd…"
sudo systemctl stop webhook-meli.service 2>/dev/null || true

echo "2) Matando procesos $REPO/webhook_meli.py …"
pkill -f "${REPO}/webhook_meli\.py" 2>/dev/null || true
sleep 1

echo "3) Liberando puerto 8080 (si sigue ocupado)…"
sudo fuser -k 8080/tcp 2>/dev/null || true
sleep 1

echo "4) Arrancando solo systemd…"
sudo systemctl start webhook-meli.service
sleep 2

echo "5) Eliminando huérfanos (todo webhook_meli.py que no sea MainPID de systemd)…"
main_pid=$(systemctl show -p MainPID --value webhook-meli.service 2>/dev/null || echo "")
if [ -n "$main_pid" ] && [ "$main_pid" != "0" ]; then
    for pid in $(pgrep -f "${REPO}/webhook_meli\.py" 2>/dev/null || true); do
        [ "$pid" = "$main_pid" ] && continue
        echo "   kill PID huérfano $pid"
        kill "$pid" 2>/dev/null || sudo kill "$pid" 2>/dev/null || true
    done
    sleep 1
fi

systemctl status webhook-meli.service --no-pager | head -20

echo ""
echo "Verificación:"
ss -tlnp 2>/dev/null | grep -E ':8080\b' || echo "  (nadie en 8080 — revisar journalctl -u webhook-meli)"
pgrep -af "python3.*webhook_meli\.py" | grep -vE 'cursorsandbox' || true
