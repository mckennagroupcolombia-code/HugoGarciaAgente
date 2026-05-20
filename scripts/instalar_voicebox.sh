#!/usr/bin/env bash
# instalar_voicebox.sh — Instala voicebox TTS backend (FastAPI, puerto 17493)
# https://github.com/jamiepine/voicebox
# Usa Qwen3-TTS-12Hz-1.7B-Base para clonación de voz de alta calidad.
# Uso: bash scripts/instalar_voicebox.sh

set -euo pipefail

VOICEBOX_DIR="$HOME/voicebox"
VENV_DIR="$HOME/voicebox-venv"
SERVICE_NAME="voicebox-tts"
PORT=17493

echo "=== Voicebox TTS — instalador ==="

# 1. Clonar repositorio
if [ -d "$VOICEBOX_DIR/.git" ]; then
  echo "[1/6] Actualizando repositorio existente…"
  git -C "$VOICEBOX_DIR" pull --ff-only || true
else
  echo "[1/6] Clonando repositorio…"
  git clone https://github.com/jamiepine/voicebox.git "$VOICEBOX_DIR"
fi

BACKEND_DIR="$VOICEBOX_DIR/backend"
if [ ! -d "$BACKEND_DIR" ]; then
  # Some versions have the backend at repo root
  BACKEND_DIR="$VOICEBOX_DIR"
fi

# 2. Crear entorno virtual separado (evita conflictos con el venv principal)
echo "[2/6] Creando entorno virtual en $VENV_DIR…"
python3 -m venv "$VENV_DIR"

# 3. Instalar dependencias
echo "[3/6] Instalando dependencias (puede tardar 5-10 min, descarga modelos en primer uso)…"
"$VENV_DIR/bin/pip" install --upgrade pip --quiet

if [ -f "$BACKEND_DIR/requirements.txt" ]; then
  "$VENV_DIR/bin/pip" install -r "$BACKEND_DIR/requirements.txt" --quiet
elif [ -f "$BACKEND_DIR/pyproject.toml" ]; then
  "$VENV_DIR/bin/pip" install -e "$BACKEND_DIR" --quiet
else
  # Dependencias mínimas conocidas
  "$VENV_DIR/bin/pip" install fastapi uvicorn sqlalchemy qwen-tts torch torchaudio soundfile librosa huggingface_hub accelerate --quiet
fi

# 4. Detectar entry point
ENTRY="main:app"
if [ -f "$BACKEND_DIR/src/main.py" ]; then
  ENTRY="src.main:app"
elif [ ! -f "$BACKEND_DIR/main.py" ]; then
  echo "AVISO: No se encontró main.py — ajusta ENTRY en el servicio systemd si es necesario."
fi

# 5. Crear servicio systemd
echo "[4/6] Creando servicio systemd $SERVICE_NAME…"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=Voicebox TTS Service (Qwen3-TTS port $PORT)
After=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$BACKEND_DIR
ExecStart=$VENV_DIR/bin/uvicorn $ENTRY --host 0.0.0.0 --port $PORT
Restart=on-failure
RestartSec=5
Environment="PYTHONUNBUFFERED=1"
Environment="HF_HOME=$HOME/.cache/huggingface"

[Install]
WantedBy=default.target
EOF

echo "[5/6] Habilitando servicio…"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"
sleep 3
systemctl is-active --quiet "$SERVICE_NAME" && \
  echo "[6/6] ✅ Voicebox activo en http://localhost:$PORT" || \
  echo "[6/6] ⚠️  Servicio iniciado pero no responde aún — revisa: journalctl -u $SERVICE_NAME -n 20"

echo ""
echo "Modelos recomendados (se descargan automáticamente en el primer uso):"
echo "  Clonación de voz: Qwen/Qwen3-TTS-12Hz-1.7B-Base  (~3.5 GB)"
echo "  Más ligero:       Qwen/Qwen3-TTS-12Hz-0.6B-Base  (~1.2 GB)"
echo ""
echo "Para agregar voicebox al agente, establece en .env:"
echo "  VOICEBOX_URL=http://localhost:$PORT"
echo ""
echo "API docs: http://localhost:$PORT/docs"
