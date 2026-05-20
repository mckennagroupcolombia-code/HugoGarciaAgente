#!/usr/bin/env bash
# Instala Qwen3 TTS con soporte CUDA (RTX 5060 Ti / CUDA 12.x-13.x)
# Uso: bash scripts/instalar_qwen3_tts.sh
# Tiempo estimado: 5-15 min (descarga modelo ~3-5 GB en HuggingFace)

set -e
VENV="/home/mckg/mi-agente/venv"

echo "=== [1/4] Instalando PyTorch con CUDA 12.4 (compatible con driver CUDA 13.x) ==="
"$VENV/bin/pip" install --quiet torch torchaudio \
    --index-url https://download.pytorch.org/whl/cu124

echo "=== [2/4] Instalando qwen-tts y dependencias de audio ==="
"$VENV/bin/pip" install --quiet qwen-tts soundfile

echo "=== [3/4] Verificando CUDA disponible ==="
"$VENV/bin/python3" -c "
import torch
print(f'  torch       : {torch.__version__}')
print(f'  CUDA ok     : {torch.cuda.is_available()}')
if torch.cuda.is_available():
    print(f'  GPU         : {torch.cuda.get_device_name(0)}')
    print(f'  VRAM libre  : {torch.cuda.get_device_properties(0).total_memory // 1024**2} MB')
"

echo "=== [4/4] Pre-descargando Qwen3-TTS-12Hz-1.7B-CustomVoice ==="
echo "    (modelo con 9 voces premium, soporte español, ~3.5 GB)"
"$VENV/bin/python3" -c "
from qwen_tts import Qwen3TTSModel
import torch
print('  Descargando pesos... (puede tardar según tu conexión)')
model = Qwen3TTSModel.from_pretrained(
    'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice',
    device_map='cuda:0',
    dtype=torch.bfloat16,
)
speakers = model.get_supported_speakers()
langs    = model.get_supported_languages()
print(f'  Voces disponibles : {speakers}')
print(f'  Idiomas           : {langs}')
print()
print('  Generando audio de prueba en español...')
import soundfile as sf, pathlib
wavs, sr = model.generate_custom_voice(
    text='Hola, soy Hugo García de McKenna Group. El sistema de voz local está listo.',
    language='Spanish',
    speaker='Ryan',
)
out = pathlib.Path('/tmp/qwen3_tts_test.wav')
sf.write(str(out), wavs[0], sr)
print(f'  Audio de prueba → {out}  ({out.stat().st_size // 1024} KB)')
print()
print('Qwen3 TTS instalado y funcionando correctamente.')
"

echo ""
echo "=== Listo. Reinicia el agente para activar Qwen3 TTS como motor principal: ==="
echo "    sudo systemctl restart agente-pro"
