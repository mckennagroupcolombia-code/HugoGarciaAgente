"""
Extracción y abstracción de elementos de etiquetas de materias primas mediante Visión IA.
Extrae campos estructurados (nombre, CAS, concentración, features, aplicaciones, color, etc.)
a partir de capturas o fotografías de etiquetas existentes.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
import re
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

_ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(_ROOT / ".env")
load_dotenv()

from app.services.llm_budget import permitir_llamada, registrar_llamada, usage_anthropic, usage_gemini

log = logging.getLogger(__name__)

_PROMPT_ABSTRACCION_ETIQUETA = """Eres un sistema experto en visión artificial y diseño de empaques para etiquetas de materias primas químicas, farmacéuticas, alimentarias y cosméticas (diseño corporativo McKenna Group).

Analiza esta imagen / captura de una etiqueta o empaque y extrae con MÁXIMA FIDELIDAD Y PRECISIÓN todos sus elementos estructurados y textuales para mapearlos al formato de la ficha de etiquetado.

IMPORTANTE:
- Transcribe con exactitud todos los textos, nombres, títulos, valores, especificaciones, números CAS, concentraciones, pesos y códigos EAN visibles en la imagen.
- NO uses valores por defecto ni placeholders si la imagen contiene textos reales. Extrae exactamente lo que dice la imagen.
- Identifica con precisión el color dominante (#hex) de los bordes, títulos y fondos (ej. azul #0b4199, violeta #3d246b, verde, etc.).
- Si hay especificaciones o propiedades (ej. ORIGEN, APARIENCIA, OLOR, FÓRMULA QUÍMICA, GRADO, CONSERVACIÓN, o atributos como ESPUMA CREMOSA, etc.), mapealas fielmente en `features` y en los campos respectivos.

Genera ÚNICAMENTE un JSON con el siguiente esquema exacto (sin markdown, sin explicaciones):
{
  "abreviatura": "Sigla o título corto si existe (ej. CREATINA, SCI, PVP). Si no hay sigla separada, pon el nombre principal corto",
  "nombre": "Nombre químico / comercial completo en mayúsculas (ej. CREATINA MONOHIDRATO, COCOIL ISETIONATO DE SODIO)",
  "tagline": "Subtítulo, clasificación o categoría bajo el nombre (ej. INSUMO ALIMENTARIO, Tensioactivo suave • Materia prima cosmética)",
  "concentracionLabel": "Etiqueta de concentración (ej. Concentración (Base Seca), CONCENTRACIÓN, etc.)",
  "concentracionValor": "Valor exacto de concentración o pureza (ej. ≥ 99,0%, 90%, 99%) o vacío",
  "casLabel": "CAS",
  "cas": "Número CAS del compuesto si es visible (ej. 6020-87-7, 61789-32-0)",
  "descripcion": "Descripción textual de características físicas, origen o notas generales",
  "features": [
    {"titulo": "Texto atributo 1 (ej. ORIGEN: China / ESPUMA CREMOSA)", "icono": "burbujas"},
    {"titulo": "Texto atributo 2 (ej. APARIENCIA: Polvo cristalino / LIMPIEZA SUAVE)", "icono": "gota"},
    {"titulo": "Texto atributo 3 (ej. FÓRMULA: C4H9N3O2 / pH 5-7)", "icono": "matraz", "subtitulo": ""}
  ],
  "aplicacionesTitulo": "APLICACIONES / INFORMACIÓN DE USO",
  "aplicaciones": "Lista o texto de usos, aplicaciones o manipulación",
  "incorporacionTitulo": "INCORPORACIÓN / DOCUMENTACIÓN",
  "incorporacion": "Instrucciones de preparación, ficha técnica o documentación",
  "peso": "Contenido neto con unidad visible en la etiqueta (ej. 1000 g, 1000g, 250 g, 500 g, 1 kg)",
  "marca": "Marca (ej. MCKENNA GROUP®)",
  "atencionTitulo": "INFORMACIÓN DE SEGURIDAD / ATENCIÓN",
  "atencionTexto": "Texto de seguridad, manipulación, advertencias o clasificación GHS",
  "almacenamiento": "Instrucciones de conservación / almacenamiento visibles",
  "desarrolladoPor": "Desarrollado por:",
  "empresa": "MCKENNA GROUP S.A.S.",
  "nit": "NIT. 901316016-3",
  "ciudad": "Bogotá, Colombia",
  "web": "www.mckennagroup.co",
  "ean13": "Código EAN-13 numérico (13 dígitos) visible en el código de barras (ej. 7701405002639)",
  "color_primario": "Color hexadecimal (#hex) predominante en los títulos, bordes o identidad de la etiqueta (ej. #0b4199)",
  "formato_sugerido": "Nombre del formato sugerido (ej. 1000 g, 250 g, 500 g)"
}

REGLAS DE ABSTRACCIÓN:
- Transcribe fielmente los textos reales visibles en la etiqueta.
- Detecta el color dominante de la tinta (#hex) con precisión.
- Devuelve SOLO el objeto JSON sin texto antes ni después.
"""


def _limpiar_json(texto: str) -> str:
    raw = (texto or "").strip()
    if not raw:
        return ""
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.I)
        raw = re.sub(r"\s*```$", "", raw)
    raw = raw.strip("`").strip()
    if raw.lower().startswith("json"):
        raw = raw[4:].strip()
    return raw


def _optimizar_imagen_bytes(data: bytes, mime_type: str) -> tuple[bytes, str]:
    try:
        from PIL import Image

        im = Image.open(io.BytesIO(data))
        im = im.convert("RGB")
        w, h = im.size
        max_dim = max(w, h)
        if max_dim > 1600:
            scale = 1600.0 / float(max_dim)
            im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=88, optimize=True)
        return buf.getvalue(), "image/jpeg"
    except Exception as exc:
        log.warning("No se pudo optimizar imagen con PIL: %s", exc)
        return data, mime_type


def extraer_etiqueta_con_gemini(imagen_bytes: bytes, mime_type: str) -> dict[str, Any] | None:
    api_key = os.environ.get("GOOGLE_API_KEY", "").strip()
    if not api_key:
        log.warning("GOOGLE_API_KEY no configurada para extracción de etiqueta")
        return None

    modelo = "gemini-2.5-flash"
    ok, motivo = permitir_llamada(modelo, contexto="plantilla_etiqueta_vision")
    if not ok:
        log.warning("Presupuesto LLM bloqueó Gemini: %s", motivo)
        return None

    try:
        from google import genai
        from google.genai import types as gtypes

        img_opt, mime_opt = _optimizar_imagen_bytes(imagen_bytes, mime_type)
        client = genai.Client(api_key=api_key)
        contents = [
            gtypes.Part.from_bytes(data=img_opt, mime_type=mime_opt),
            _PROMPT_ABSTRACCION_ETIQUETA,
        ]
        resp = client.models.generate_content(model=modelo, contents=contents)
        tin, tout = usage_gemini(resp)
        registrar_llamada(modelo, tin, tout, contexto="plantilla_etiqueta_vision")

        txt = (resp.text or "").strip()
        limpio = _limpiar_json(txt)
        data = json.loads(limpio)
        return data if isinstance(data, dict) else None
    except Exception as exc:
        log.warning("Fallo en extracción con Gemini Vision: %s", exc)
        return None


def extraer_etiqueta_con_anthropic(imagen_bytes: bytes, mime_type: str) -> dict[str, Any] | None:
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return None

    modelos = ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-3-5-sonnet-20241022"]
    modelo = modelos[0]
    for m in modelos:
        ok, motivo = permitir_llamada(m, contexto="plantilla_etiqueta_vision")
        if ok:
            modelo = m
            break
    else:
        return None

    try:
        import anthropic

        img_opt, mime_opt = _optimizar_imagen_bytes(imagen_bytes, mime_type)
        b64 = base64.b64encode(img_opt).decode("utf-8")
        media_type = mime_opt if mime_opt in ("image/jpeg", "image/png", "image/gif", "image/webp") else "image/jpeg"

        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model=modelo,
            max_tokens=2048,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": b64,
                            },
                        },
                        {"type": "text", "text": _PROMPT_ABSTRACCION_ETIQUETA},
                    ],
                }
            ],
        )
        tin, tout = usage_anthropic(message)
        registrar_llamada(modelo, tin, tout, contexto="plantilla_etiqueta_vision")

        txt = ""
        for block in message.content:
            if getattr(block, "type", "") == "text":
                txt += block.text
        limpio = _limpiar_json(txt)
        data = json.loads(limpio)
        return data if isinstance(data, dict) else None
    except Exception as exc:
        log.warning("Fallo en extracción con Anthropic Vision: %s", exc)
        return None


def abstraer_elementos_etiqueta(imagen_bytes: bytes, mime_type: str = "image/jpeg") -> dict[str, Any]:
    """
    Intenta extraer la estructura de etiqueta primero con Gemini Vision y luego con Anthropic.
    """
    res = extraer_etiqueta_con_gemini(imagen_bytes, mime_type)
    if res:
        return res

    res = extraer_etiqueta_con_anthropic(imagen_bytes, mime_type)
    if res:
        return res

    raise RuntimeError("No se pudo abstraer la información de la imagen de la etiqueta.")
