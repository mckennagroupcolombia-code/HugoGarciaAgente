#!/usr/bin/env bash
# Instala la unidad systemd del PUENTE WhatsApp (Node) en ESTE repo.
#
# NO usa el nombre bot-mckenna.service: en tu máquina ese nombre suele ser OTRO servicio (Python / MeLi).
# Unidad creada: mckenna-whatsapp-bridge.service
#
# Uso:
#   sudo ./instalar_systemd.sh
#   sudo systemctl enable --now mckenna-whatsapp-bridge
#
# Antes: parar el Node legacy ~/bot-mckenna y deshabilitar whatsapp-bridge / whatsapp-server si existen.

set -euo pipefail

SERVICE_NAME="mckenna-whatsapp-bridge"
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
RUN_USER_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
LEGACY_SERVER_JS="${LEGACY_BOT_DIR:-$RUN_USER_HOME/bot-mckenna}/server.js"
# pgrep -f usa regex: escapar el punto de server.js
LEGACY_PATT="${LEGACY_SERVER_JS//./\\.}"

# Solo carpeta ~/bot-mckenna legacy (no mi-agente/bot-mckenna); excluye `node --check`.
legacy_server_pids() {
  for pid in $(pgrep -f "$LEGACY_PATT" 2>/dev/null || true); do
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
    [[ "$cmd" == *"--check"* ]] && continue
    printf '%s\n' "$pid"
  done
}

mapfile -t LEGACY_PIDS < <(legacy_server_pids || true)
if [[ ${#LEGACY_PIDS[@]} -gt 0 ]] && [[ -n "${LEGACY_PIDS[0]:-}" ]]; then
  echo "⚠️  Siguen procesos Node con bot-mckenna/server.js: ${LEGACY_PIDS[*]}"
  echo "    (Si alguno es legacy en ~/bot-mckenna, detén antes: sudo kill ${LEGACY_PIDS[*]})"
  echo ""
  if [[ "${FORCE_LEGACY:-}" != "1" ]]; then
    echo "    Para omitir esta comprobación: FORCE_LEGACY=1 sudo $0"
    exit 1
  fi
fi

UNIT="$(cat <<EOF
[Unit]
Description=McKenna puente WhatsApp (Node whatsapp-web.js) puerto 3000
Documentation=file://$BOT_DIR/README.md
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_GROUP
WorkingDirectory=$BOT_DIR
EnvironmentFile=-$REPO_ROOT/.env
ExecStart=$NODE_BIN $BOT_DIR/server.js
Restart=on-failure
RestartSec=15

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
echo "Desactiva los servicios systemd viejos que apunten a ~/bot-mckenna (Node):"
echo "   sudo systemctl disable --now whatsapp-bridge whatsapp-server 2>/dev/null || true"
echo ""
echo "Arranca el puente (no confundir con bot-mckenna.service que es Python en tu equipo):"
echo "   sudo systemctl start $SERVICE_NAME"
echo "   sudo systemctl status $SERVICE_NAME --no-pager -l"
