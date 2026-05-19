#!/usr/bin/env bash
# Smoke tests para GitHub Actions (sin .env ni credenciales locales).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export WEBHOOK_MELI_SKIP_SINGLETON_LOCK=1
export AGENTE_AUDITORIA_SKIP_WA=1
unset CHAT_API_TOKEN 2>/dev/null || true

if ! python -c "from app.tools.generar_guias_masivas import generar_guias_masivas_web; from app.routes import register_routes"; then
  echo "::error::No se pudo importar app (revisar .env / dependencias)"
  exit 1
fi

if ! python -m pytest tests/test_smoke.py -v --tb=short; then
  echo "::error::pytest tests/test_smoke.py falló"
  exit 1
fi
