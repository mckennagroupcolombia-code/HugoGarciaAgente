#!/usr/bin/env bash
# Abre OpenHands CLI con workspace = raíz del repo (código que puede tocar el agente).
# Requiere: scripts/bootstrap_openhands_local.sh (una vez) + Ollama corriendo.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export OPENHANDS_WORK_DIR="${OPENHANDS_WORK_DIR:-$REPO}"
export OPENHANDS_SUPPRESS_BANNER="${OPENHANDS_SUPPRESS_BANNER:-1}"
# Mismo criterio que bootstrap: modelos locales Ollama a menudo declaran 8k.
export ALLOW_SHORT_CONTEXT_WINDOWS="${ALLOW_SHORT_CONTEXT_WINDOWS:-true}"
cd "$REPO"

if [[ ! -f "$HOME/.openhands/agent_settings.json" ]]; then
  echo "Falta ~/.openhands/agent_settings.json. Ejecuta una vez:" >&2
  echo "  bash $REPO/scripts/bootstrap_openhands_local.sh" >&2
  exit 1
fi

exec openhands "$@"
