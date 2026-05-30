#!/usr/bin/env bash
# Instala la unidad systemd del puente WhatsApp SUPERVISOR (Node) en ESTE repo.
# Unidad creada: mckenna-whatsapp-supervisor.service (puerto 3001)
#
# Uso:
#   sudo ./instalar_systemd.sh
#   sudo systemctl enable --now mckenna-whatsapp-supervisor
#
# Requiere: node en PATH, npm install ya ejecutado en este directorio.

set -euo pipefail

SERVICE_NAME="mckenna-whatsapp-supervisor"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}.service"

BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$BOT_DIR/.." && pwd)"
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "❌ node no está en PATH."
  exit 1
fi

RUN_USER="${SUDO_USER:-$USER}"
RUN_GROUP="$(id -gn "$RUN_USER")"

UNIT="$(cat <<EOF
[Unit]
Description=McKenna puente WhatsApp Supervisor (Voz IA + Gemma4) puerto 3001
Documentation=file://$BOT_DIR/README.md
After=network-online.target mckenna-whatsapp-bridge.service
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_GROUP
WorkingDirectory=$BOT_DIR
EnvironmentFile=-$REPO_ROOT/.env
ExecStart=$NODE_BIN $BOT_DIR/server.js
Restart=on-failure
RestartSec=20

[Install]
WantedBy=multi-user.target
EOF
)"

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Ejecuta con sudo para instalar en $SERVICE_PATH"
  echo ""
  echo "$UNIT"
  exit 0
fi

echo "$UNIT" | tee "$SERVICE_PATH" >/dev/null
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
echo "✅ Instalado: $SERVICE_PATH"
echo "   User=$RUN_USER  WorkingDirectory=$BOT_DIR"
echo ""
echo "Arranca el supervisor:"
echo "   sudo systemctl start $SERVICE_NAME"
echo "   sudo systemctl status $SERVICE_NAME --no-pager -l"
echo ""
echo "Escanea el QR en la terminal o en:  http://localhost:3001/qr"
