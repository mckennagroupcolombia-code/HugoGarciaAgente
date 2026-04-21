#!/usr/bin/env bash
# Lanza OpenHands CLI en la raíz del repo con Ollama local (ver scripts/openhands_local.sh).
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if command -v openhands >/dev/null 2>&1; then
  exec bash "$REPO/scripts/openhands_local.sh" "$@"
fi

cat <<'EOF'
OpenHands CLI no está en PATH.

Instalación (Python 3.12+):
  ~/.local/bin/uv tool install openhands --python 3.12

Config local Ollama (una vez):
  bash ~/mi-agente/scripts/bootstrap_openhands_local.sh

Uso interactivo (workspace = repo):
  bash ~/mi-agente/scripts/openhands_local.sh

O con tarea inicial:
  bash ~/mi-agente/scripts/openhands_local.sh -t "tu tarea"

Docs: https://docs.openhands.dev/openhands/usage/cli/quick-start
EOF
exit 1
