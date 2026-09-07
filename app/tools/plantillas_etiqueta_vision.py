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

_PROMPT_LAYOUT_LIENZO = """Eres un diagramador. Debes COPIAR la geometría de ESTA foto de etiqueta al lienzo, no inventar otra plantilla.

PROHIBIDO:
- Usar el layout genérico SCI de dos columnas (ficha técnica MP) salvo que la foto sea EXACTAMENTE ese diseño.
- Inventar bloques (CAS, pH, GHS, código de barras, columnas) que no se vean en la foto.
- Reordenar, centrar «bonito» o homogeneizar lo que en la foto está asimétrico.

OBLIGATORIO:
- Recorta mentalmente la etiqueta (ignora mesa, fondo, manos). (0,0) es la esquina superior izquierda de la ETIQUETA, (1,1) la inferior derecha.
- Cada texto visible es un bloque `text` con su posición real (x,y,w,h en fracciones 0–1).
- Cada recuadro, franja o badge visible es un `rect`. Cada línea divisoria visible es un `line` (x,y,x2,y2 en 0–1).
- Transcribe el texto TAL CUAL (mayúsculas, saltos de línea con \\n).
- Color de cada texto/borde: hex aproximado de la tinta en la foto.
- fontSize es fracción de la ALTURA de la etiqueta (título grande ~0.06–0.10, cuerpo ~0.018–0.03).

JSON único, sin markdown:
{
  "nombre": "nombre corto del producto visible",
  "fondo": "#ffffff",
  "elementos": [
    {
      "type": "text",
      "x": 0.05, "y": 0.02, "w": 0.90, "h": 0.08,
      "content": "TEXTO",
      "fontSize": 0.055,
      "fontWeight": "800",
      "align": "center",
      "color": "#1a1a1a"
    },
    {
      "type": "rect",
      "x": 0.0, "y": 0.0, "w": 1.0, "h": 0.12,
      "fill": "#ffffff",
      "stroke": "#3d246b",
      "strokeWidth": 1
    },
    {
      "type": "line",
      "x": 0.05, "y": 0.40, "x2": 0.95, "y2": 0.40,
      "stroke": "#3d246b",
      "strokeWidth": 1
    }
  ]
}
"""


def _num(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _espacio_coords(elementos: list[Any]) -> str:
    vals: list[float] = []
    for e in elementos:
        if not isinstance(e, dict):
            continue
        for k in ("x", "y", "w", "width", "h", "height", "x2", "y2"):
            if k in e:
                vals.append(_num(e.get(k)))
    mx = max(vals) if vals else 0.0
    if mx <= 1.5:
        return "frac"
    if mx <= 100:
        return "pct"
    return "px"


def _a_frac(v: Any, espacio: str, span: float) -> float:
    n = _num(v)
    if espacio == "frac":
        f = n
    elif espacio == "pct":
        f = n / 100.0
    else:
        f = n / span if span else 0.0
    return max(0.0, min(1.2, f))


def _hex_color(v: Any, default: str = "#1a1a1a") -> str:
    s = str(v or "").strip()
    if re.fullmatch(r"#?[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?", s):
        if not s.startswith("#"):
            s = "#" + s
        if len(s) == 4:
            s = "#" + "".join(ch * 2 for ch in s[1:])
        return s.lower()
    return default


def layout_a_elementos(raw_elementos: Any, canvas_w: int, canvas_h: int) -> list[dict[str, Any]]:
    """Convierte bloques 0–1 / % / px del modelo a elementos del lienzo Studio (px)."""
    if not isinstance(raw_elementos, list):
        return []
    w = max(1, int(canvas_w))
    h = max(1, int(canvas_h))
    espacio = _espacio_coords(raw_elementos)
    out: list[dict[str, Any]] = []
    z = 1
    for i, raw in enumerate(raw_elementos):
        if not isinstance(raw, dict):
            continue
        tipo = str(raw.get("type") or raw.get("tipo") or "text").lower()
        if tipo in ("texto", "txt"):
            tipo = "text"
        if tipo in ("rectangulo", "caja", "box"):
            tipo = "rect"
        if tipo in ("linea",):
            tipo = "line"
        if tipo not in ("text", "rect", "line"):
            continue
        x = round(_a_frac(raw.get("x"), espacio, w) * w, 2)
        y = round(_a_frac(raw.get("y"), espacio, h) * h, 2)
        ww = round(_a_frac(raw.get("w", raw.get("width")), espacio, w) * w, 2)
        hh = round(_a_frac(raw.get("h", raw.get("height")), espacio, h) * h, 2)
        eid = f"e{i + 1}"
        if tipo == "line":
            x2 = round(_a_frac(raw.get("x2", raw.get("x")), espacio, w) * w, 2)
            y2 = round(_a_frac(raw.get("y2", raw.get("y")), espacio, h) * h, 2)
            if x2 == x and y2 == y:
                x2 = x + max(ww, 1)
                y2 = y
            out.append(
                {
                    "id": eid,
                    "type": "line",
                    "x": x,
                    "y": y,
                    "x2": x2,
                    "y2": y2,
                    "width": max(1, abs(x2 - x)),
                    "height": max(1, abs(y2 - y)),
                    "rotation": 0,
                    "zIndex": z,
                    "stroke": _hex_color(raw.get("stroke") or raw.get("color"), "#1a1a1a"),
                    "strokeWidth": max(0.5, _num(raw.get("strokeWidth"), 1)),
                    "nombreCapa": str(raw.get("nombre") or "Línea")[:40],
                }
            )
            z += 1
            continue
        if tipo == "rect":
            out.append(
                {
                    "id": eid,
                    "type": "rect",
                    "x": x,
                    "y": y,
                    "width": max(2, ww),
                    "height": max(2, hh),
                    "rotation": 0,
                    "zIndex": z,
                    "fill": _hex_color(raw.get("fill"), "#ffffff"),
                    "stroke": _hex_color(raw.get("stroke"), "#000000"),
                    "strokeWidth": max(0, _num(raw.get("strokeWidth"), 1)),
                    "borderRadius": max(0, _num(raw.get("borderRadius"), 0)),
                    "nombreCapa": str(raw.get("nombre") or "Recuadro")[:40],
                }
            )
            z += 1
            continue
        fs_raw = _num(raw.get("fontSize"), 0.025)
        if fs_raw <= 1.5:
            font_size = max(6, round(fs_raw * h, 1))
        elif fs_raw <= 30:
            font_size = max(6, round((fs_raw / 100.0) * h, 1))
        else:
            font_size = max(6, fs_raw)
        align = str(raw.get("align") or "left").lower()
        if align not in ("left", "center", "right", "justify"):
            align = "left"
        weight = str(raw.get("fontWeight") or "400")
        if weight not in ("400", "500", "600", "700", "800", "900"):
            weight = "700" if weight.lower() in ("bold", "black") else "400"
        content = str(raw.get("content") or raw.get("texto") or "").strip()
        if not content:
            continue
        out.append(
            {
                "id": eid,
                "type": "text",
                "x": x,
                "y": y,
                "width": max(8, ww),
                "height": max(8, hh if hh > 1 else font_size * 1.4),
                "rotation": 0,
                "zIndex": z + 10,
                "content": content,
                "fontSize": font_size,
                "fontFamily": "Montserrat, sans-serif",
                "fontWeight": weight,
                "color": _hex_color(raw.get("color"), "#1a1a1a"),
                "align": align,
                "nombreCapa": content.replace("\n", " ")[:40],
            }
        )
        z += 1
    return out


def materializar_plantilla_layout(raw: dict[str, Any], canvas_w: int, canvas_h: int) -> dict[str, Any]:
    elementos = layout_a_elementos(raw.get("elementos"), canvas_w, canvas_h)
    fondo = _hex_color(raw.get("fondo") or raw.get("background"), "#ffffff")
    nombre = str(raw.get("nombre") or "Etiqueta desde foto").strip() or "Etiqueta desde foto"
    return {
        "nombre": nombre[:80],
        "fondo": fondo,
        "elementos": elementos,
    }


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


def extraer_etiqueta_con_gemini(
    imagen_bytes: bytes,
    mime_type: str,
    prompt: str | None = None,
) -> dict[str, Any] | None:
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
            prompt or _PROMPT_ABSTRACCION_ETIQUETA,
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


def extraer_etiqueta_con_anthropic(
    imagen_bytes: bytes,
    mime_type: str,
    prompt: str | None = None,
    max_tokens: int = 2048,
) -> dict[str, Any] | None:
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
            max_tokens=max_tokens,
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
                        {"type": "text", "text": prompt or _PROMPT_ABSTRACCION_ETIQUETA},
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


def diagramar_layout_al_lienzo(
    imagen_bytes: bytes,
    mime_type: str = "image/jpeg",
    *,
    canvas_w: int,
    canvas_h: int,
) -> dict[str, Any]:
    """
    Extrae geometría de la foto (fracciones 0–1) y la materializa en el lienzo
    del tamaño elegido por el operador (canvas_w × canvas_h px).
    """
    w = max(8, int(canvas_w))
    h = max(8, int(canvas_h))
    prompt = (
        _PROMPT_LAYOUT_LIENZO
        + f"\n\nEl operador ya eligió el lienzo: {w}×{h} px. "
        "Tus coordenadas siguen en fracciones 0–1; el servidor las escalará a ese tamaño."
    )
    raw = extraer_etiqueta_con_gemini(imagen_bytes, mime_type, prompt=prompt)
    if not raw:
        raw = extraer_etiqueta_con_anthropic(
            imagen_bytes, mime_type, prompt=prompt, max_tokens=4096
        )
    if not raw:
        raise RuntimeError("No se pudo diagramar el layout de la imagen al lienzo.")

    plantilla = materializar_plantilla_layout(raw, w, h)
    if not plantilla.get("elementos"):
        raise RuntimeError("La visión no devolvió elementos posicionables.")
    plantilla["canvas_w"] = w
    plantilla["canvas_h"] = h
    return plantilla
