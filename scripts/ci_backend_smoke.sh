#!/usr/bin/env bash
# Smoke tests para GitHub Actions (sin .env ni credenciales locales).
set -euo pipefail
cd "$(dirname "$0")/.."

runner_had_token=0
if [ -n "${CHAT_API_TOKEN:-}" ]; then runner_had_token=1; fi

rm -f .env
# Secret/variable CHAT_API_TOKEN en el repo de GitHub no debe filtrar a pytest.
unset CHAT_API_TOKEN || true
export CHAT_API_TOKEN=
export WEBHOOK_MELI_SKIP_SINGLETON_LOCK=1
export AGENTE_AUDITORIA_SKIP_WA=1

LOG="${PYTEST_CI_LOG:-pytest-ci.log}"
echo "Runner tenía CHAT_API_TOKEN no vacío antes de limpiar: $([ "$runner_had_token" = 1 ] && echo si || echo no)"

set +e
python -m pytest tests/test_smoke.py -v --tb=short --junitxml=pytest-results.xml >"$LOG" 2>&1
exit_code=$?
set -e
cat "$LOG"
exit "$exit_code"
