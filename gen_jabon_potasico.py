#!/usr/bin/env python3
"""
Genera video 20s para Jabón Potásico 1L — MCO3793586824
"""
import sys
sys.path.insert(0, "/home/mckg/mi-agente")

from pipeline_contenido_facebook import (
    generar_copy, generar_fondo_ideogram, componer_infografia,
    generar_narracion, generar_video_ia, mezclar_video_audio,
    TEMP_DIR
)

datos = {
    "nombre":    "Jabón Potásico 1 Litro",
    "categoria": "Aceites",
    "slug":      "jabon-potasico",
    "tags":      ["control de plagas", "pulgón", "mosca blanca", "hongos", "neem", "agrícola"],
    "desc":      (
        "Jabón potásico líquido concentrado a base de aceite de neem. "
        "Actúa como insecticida, fungicida y acaricida de contacto. "
        "Seguro para plantas, piel y superficies. "
        "Efectivo contra pulgón, mosca blanca, araña roja y hongos."
    ),
    "info_extra": (
        "Composición: sales potásicas de ácidos grasos del aceite de neem. "
        "Modo de acción: obstruye los espiráculos respiratorios de insectos, "
        "inhibe la síntesis de ergosterol en hongos y actúa como surfactante emulsionante. "
        "Concentración: 3-5 ml por litro de agua para uso agrícola; "
        "0.5-1% en formulaciones cosméticas como limpiador suave. "
        "pH: 7.5-9.0. Miscible en agua. Color: ámbar oscuro, consistencia líquida viscosa."
    ),
}

url_ref = "https://mckennagroup.co"

print("═"*60)
print("  VIDEO — Jabón Potásico 1L")
print("═"*60)

# Paso 1: Copy con Gemini
print("\n[1/5] Generando copy con Gemini...")
copy = generar_copy("ficha", datos)
print(f"  Título: {copy.get('titulo_principal','')}")
print(f"  Narración: {copy.get('narracion','')}")
print(f"  Escenas: {len(copy.get('escenas_video', []))} definidas")

# Paso 2: Fondo Ideogram + PIL
print("\n[2/5] Generando fondo Ideogram...")
fondo_bytes, imagen_url = generar_fondo_ideogram("Jabón Potásico", "Aceites")
print(f"  Fondo: {len(fondo_bytes)//1024} KB  |  URL: {imagen_url[:60]}...")

print("  Componiendo infografía PIL...")
imagen_bytes = componer_infografia(fondo_bytes, copy, "ficha")
img_path = TEMP_DIR / "jabon_potasico_infografia.jpg"
img_path.write_bytes(imagen_bytes)
print(f"  Infografía guardada: {img_path}")

# Paso 3: Narración ElevenLabs
print("\n[3/5] Generando narración ElevenLabs...")
audio_bytes = generar_narracion(copy.get("narracion", ""))
audio_path = TEMP_DIR / "jabon_potasico.mp3"
audio_path.write_bytes(audio_bytes)
print(f"  Audio guardado: {audio_path}  ({len(audio_bytes)//1024} KB)")

# Paso 4: Video Kling multi-escena (2 × 10s = 20s)
print("\n[4/5] Generando video Kling (2 escenas × 10s)...")
escenas = copy.get("escenas_video", [])
if not escenas:
    # Fallback manual si Gemini no generó escenas
    escenas = [
        (
            "female scientist with glasses and white lab coat in a modern cosmetics laboratory, "
            "carefully examining amber liquid soap samples in glass flasks on stainless steel workbench, "
            "professional warm lighting, slow cinematic dolly camera forward, ultra realistic 4K, no text"
        ),
        (
            "extreme close-up macro shot of a glass beaker filled with amber dark brown potassium soap liquid "
            "on a stainless steel lab bench, the viscous liquid glistens under laboratory lighting, "
            "slow cinematic camera pull-back revealing full beaker and lab tools around it, "
            "ultra realistic 4K, no text"
        ),
    ]
    print("  (usando escenas manuales de fallback)")
else:
    print(f"  Escena 1: {escenas[0][:80]}...")
    print(f"  Escena 2: {escenas[1][:80]}...")

video_raw = generar_video_ia(imagen_url, "", "Jabón Potásico", prompts_escenas=escenas)
video_raw_path = TEMP_DIR / "jabon_potasico_raw.mp4"
video_raw_path.write_bytes(video_raw)
print(f"  Video raw: {len(video_raw)//1024} KB")

# Paso 5: Mezclar video + audio
print("\n[5/5] Mezclando video + audio...")
video_final = mezclar_video_audio(video_raw, audio_bytes)
out_path = TEMP_DIR / "jabon_potasico_final.mp4"
out_path.write_bytes(video_final)
print(f"\n{'='*60}")
print(f"  ✅ Video guardado: {out_path}")
print(f"  Tamaño: {len(video_final)//1024} KB  ({len(video_final)/1024/1024:.1f} MB)")
print(f"  Caption: {copy.get('caption_facebook','')[:120]}...")
print(f"{'='*60}")
