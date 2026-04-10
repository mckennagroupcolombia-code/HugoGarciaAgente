#!/usr/bin/env bash
# Migra sesión WhatsApp y .env desde la carpeta antigua ~/bot-mckenna (fuera del repo).
set -euo pipefail

REPO_BOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LEGACY="${LEGACY_BOT:-$HOME/bot-mckenna}"

echo "→ Bot destino: $REPO_BOT"
echo "→ Origen legacy: $LEGACY"

if pgrep -f 'bot-mckenna/server\.js|/bot-mckenna.*node' >/dev/null 2>&1; then
  echo "⚠️  Parece que ya hay un proceso Node del bridge activo."
  echo "    Para evitar 'browser is already running', detén antes el otro (legacy o systemd):"
  echo "    pgrep -af bot-mckenna"
  echo ""
fi

if [[ ! -d "$LEGACY" ]]; then
  echo "No existe $LEGACY — nada que copiar."
  exit 0
fi

if [[ -d "$LEGACY/.wwebjs_auth_nueva" ]]; then
  echo "Copiando sesión .wwebjs_auth_nueva..."
  rm -rf "$REPO_BOT/.wwebjs_auth_nueva"
  cp -a "$LEGACY/.wwebjs_auth_nueva" "$REPO_BOT/"
  echo "✅ Sesión copiada."
else
  echo "(Sin $LEGACY/.wwebjs_auth_nueva — omitido)"
fi

if [[ -f "$LEGACY/.env" ]] && [[ ! -f "$REPO_BOT/.env" ]]; then
  cp -a "$LEGACY/.env" "$REPO_BOT/.env"
  echo "✅ .env copiado (no sobrescribía uno existente en el repo)."
elif [[ -f "$LEGACY/.env" ]]; then
  echo "ℹ️  Ya existe $REPO_BOT/.env — no se tocó. Compara a mano con $LEGACY/.env si hace falta."
fi

echo ""
echo "Siguiente: cd \"$REPO_BOT\" && npm ci && npm start"
echo "Systemd del puente WhatsApp: sudo ./instalar_systemd.sh → mckenna-whatsapp-bridge.service"
