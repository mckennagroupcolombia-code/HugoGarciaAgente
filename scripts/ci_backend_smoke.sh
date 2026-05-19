#!/usr/bin/env bash
# Smoke tests para GitHub Actions (sin .env ni credenciales locales).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export WEBHOOK_MELI_SKIP_SINGLETON_LOCK=1
export AGENTE_AUDITORIA_SKIP_WA=1
unset CHAT_API_TOKEN 2>/dev/null || true

if grep -q 'DOTENV\.read_text\|\.env").read_text' app/tools/generar_guias_masivas.py 2>/dev/null; then
  echo "ERROR: generar_guias_masivas.py aún lee .env con read_text() al importar"
  exit 1
fi
if grep -q 'read_text().*splitlines' app/tools/pipeline_contenido_facebook.py 2>/dev/null; then
  echo "ERROR: pipeline_contenido_facebook.py aún lee .env con read_text() al importar"
  exit 1
fi

python -m pytest tests/test_smoke.py -v --tb=short
