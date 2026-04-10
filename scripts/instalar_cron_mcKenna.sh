#!/usr/bin/env bash
# Instala entradas cron idempotentes para el agente McKenna (auditoría de scripts).
# Uso: ./scripts/instalar_cron_mcKenna.sh

set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="${REPO}/venv/bin/python"
if [[ ! -x "$PYTHON" ]]; then
  PYTHON="$(command -v python3 || true)"
fi
if [[ -z "$PYTHON" ]]; then
  echo "No se encontró venv/bin/python ni python3." >&2
  exit 1
fi
LOG="${REPO}/log_cron.txt"
MARK_B="# MCKENNA_AGENTE_CRON_BEGIN"
MARK_E="# MCKENNA_AGENTE_CRON_END"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

crontab -l 2>/dev/null | awk -v b="$MARK_B" -v e="$MARK_E" '
  $0 == b { skip = 1; next }
  $0 == e { skip = 0; next }
  skip == 0 { print }
' >"$TMP" || true

{
  echo "$MARK_B"
  echo "# Auditoría de scripts (fallos → WhatsApp)"
  echo "15 7 * * * cd ${REPO} && AGENTE_AUDITORIA_CRON_QUIET=1 ${PYTHON} ${REPO}/scripts/auditar_scripts_cron.py >>${LOG} 2>&1"
  echo "$MARK_E"
} >>"$TMP"

crontab "$TMP"
echo "✅ Crontab actualizado. Bloque McKenna:"
crontab -l | grep -A4 "$MARK_B" || true
