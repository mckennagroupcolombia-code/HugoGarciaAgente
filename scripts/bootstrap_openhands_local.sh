#!/usr/bin/env bash
# Genera ~/.openhands/agent_settings.json para usar Ollama local (LiteLLM: ollama/<modelo>).
# Re-ejecutar si cambias modelo en Ollama o reinstalas OpenHands.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# Carga opcional desde .env del repo (misma convención que el agente Flask).
# Orden: variable de entorno ya exportada > línea en .env > default.
_model_src=default
_base_src=default
[[ -n "${LOCAL_AI_MODEL:-}" ]] && _model_src=env
[[ -n "${OLLAMA_HOST:-}" ]] && _base_src=env
_load_env_kv() {
  local key="$1" f="$REPO/.env"
  [[ -f "$f" ]] || return 1
  local line raw found=
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue
    [[ "$line" =~ ^[[:space:]]*${key}= ]] || continue
    raw="${line#*=}"
    raw="${raw#"${raw%%[![:space:]]*}"}"
    if [[ "${raw:0:1}" == '"' && "${raw: -1}" == '"' ]]; then raw="${raw:1:-1}"; fi
    if [[ "${raw:0:1}" == "'" && "${raw: -1}" == "'" ]]; then raw="${raw:1:-1}"; fi
    found=1
    _kv_last="$raw"
  done <"$f"
  [[ -n "$found" ]] || return 1
  printf '%s' "$_kv_last"
}
if [[ -z "${LOCAL_AI_MODEL:-}" ]]; then
  if v="$(_load_env_kv LOCAL_AI_MODEL)" && [[ -n "$v" ]]; then
    export LOCAL_AI_MODEL="$v"
    _model_src=".env"
  fi
fi
if [[ -z "${OLLAMA_HOST:-}" ]]; then
  if v="$(_load_env_kv OLLAMA_HOST)" && [[ -n "$v" ]]; then
    export OLLAMA_HOST="$v"
    _base_src=".env"
  fi
fi

MODEL="${LOCAL_AI_MODEL:-gemma4:26b}"
MODEL="${MODEL#ollama/}"
BASE="${OLLAMA_HOST:-http://127.0.0.1:11434}"
BASE="${BASE%/}"

UV="${UV:-$HOME/.local/bin/uv}"
if [[ ! -x "$UV" ]]; then
  echo "No encuentro uv en $UV. Instala: curl -LsSf https://astral.sh/uv/install.sh | sh" >&2
  exit 1
fi

export OPENHANDS_SUPPRESS_BANNER=1
# Ollama suele reportar 8k; OpenHands exige ≥16k salvo este override (ver sdk/llm/llm.py).
export ALLOW_SHORT_CONTEXT_WINDOWS="${ALLOW_SHORT_CONTEXT_WINDOWS:-true}"
export M="$MODEL"
export B="$BASE"
export _OH_MODEL_SRC="$_model_src"
export _OH_BASE_SRC="$_base_src"

"$UV" run --with openhands python3 -c "
import os
from pathlib import Path
from openhands.sdk import LLM
from openhands_cli.utils import get_default_cli_agent

model = os.environ['M'].strip()
base = os.environ['B']
# Ollama (LiteLLM ollama/*) no devuelve tool_calls al estilo OpenAI de forma fiable:
# el modelo suele escribir JSON {thought, action, ...} en el texto. Con
# native_tool_calling=True ese JSON llega tal cual a la TUI. False activa el
# flujo NonNativeToolCallingMixin (prompt + stop + parse). Ver openhands sdk/llm/llm.py.
native_fc = os.environ.get('OPENHANDS_OLLAMA_NATIVE_FC', '').strip().lower() in (
    '1', 'true', 'yes',
)
# LiteLLM marca reasoning_effort para varios ollama/*; Ollama falla en modelos sin
# "thinking" (p. ej. llama3.1:8b). None = no enviar reasoning_effort (chat_options.py).
llm = LLM(
    model=f'ollama/{model}',
    api_key='ollama',
    base_url=base,
    usage_id='agent',
    native_tool_calling=native_fc,
    reasoning_effort=None,
    enable_encrypted_reasoning=False,
)
agent = get_default_cli_agent(llm)
out = Path.home() / '.openhands' / 'agent_settings.json'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(agent.model_dump_json(context={'expose_secrets': True}), encoding='utf-8')
print('Escrito:', out)
print('Modelo:', f'ollama/{model}', '| API:', base)
print('Origen LOCAL_AI_MODEL:', os.environ.get('_OH_MODEL_SRC', '?'), '| OLLAMA_HOST:', os.environ.get('_OH_BASE_SRC', '?'))
"
