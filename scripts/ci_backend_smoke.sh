#!/usr/bin/env bash
# Smoke tests para GitHub Actions (sin .env ni credenciales locales).
set -eo pipefail
cd "$(dirname "$0")/.."

export WEBHOOK_MELI_SKIP_SINGLETON_LOCK=1
export AGENTE_AUDITORIA_SKIP_WA=1
export CHAT_API_TOKEN=

python -m pytest tests/test_smoke.py -v --tb=long
