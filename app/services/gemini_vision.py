from __future__ import annotations

import json
import mimetypes
import os
import re
from dataclasses import dataclass, field
from typing import Any


@dataclass
class AnalisisImagenPago:
    es_comprobante: bool
    confianza: float = 0.0
    descripcion: str = ""
    texto_extraido: str = ""
    monto: str = ""
    moneda: str = ""
    titular: str = ""
    banco_origen: str = ""
    banco_destino: str = ""
    referencia: str = ""
    fecha: str = ""
    items: list[str] = field(default_factory=list)
    razon: str = ""
    error: str = ""

    @property
    def concluyente(self) -> bool:
        return not self.error and self.confianza >= 0.45


def _mime_from_path(path: str) -> str:
    mime, _ = mimetypes.guess_type(path)
    if mime == "image/jpg":
        return "image/jpeg"
    if mime and mime.startswith("image/"):
        return mime
    return "image/jpeg"


def _extraer_json(texto: str) -> dict[str, Any]:
    raw = (texto or "").strip()
    if not raw:
        return {}
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if not m:
            return {}
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            return {}


def analizar_imagen_pago(
    media_path: str,
    *,
    mensaje: str = "",
    contexto_pago: bool = False,
) -> AnalisisImagenPago:
    """
    Clasifica una imagen de WhatsApp con Gemini Vision.

    Devuelve `es_comprobante=True` solo si el modelo identifica señales visuales
    de recibo/transferencia/consignación. También extrae monto, referencia e
    items visibles cuando la imagen es una factura, lista o pedido.
    """
    api_key = os.getenv("GOOGLE_API_KEY", "").strip()
    if not api_key:
        return AnalisisImagenPago(
            es_comprobante=False,
            error="GOOGLE_API_KEY no configurada",
        )
    if not media_path or not os.path.exists(media_path):
        return AnalisisImagenPago(
            es_comprobante=False,
            error=f"Imagen no encontrada: {media_path}",
        )

    try:
        from google import genai
        from google.genai import types

        with open(media_path, "rb") as f:
            image_bytes = f.read()

        model_name = os.getenv("GEMINI_VISION_MODEL", "gemini-1.5-flash").strip()
        prompt = f"""
Analiza esta imagen recibida por WhatsApp para McKenna Group.

Contexto:
- Mensaje del cliente: {mensaje or "[sin texto]"}
- Hay contexto reciente de pago: {"sí" if contexto_pago else "no"}

Tarea:
1. Decide si la imagen ES un comprobante/soporte de pago real (transferencia, Nequi, Daviplata, banco, consignación, recibo con valor pagado, aprobación o referencia de transacción).
2. Si NO es comprobante, describe qué parece ser.
3. Extrae datos visibles: monto, moneda, titular/persona, banco origen/destino, referencia, fecha y texto relevante.
4. Si la imagen muestra una lista, factura, cotización, chat o pedido con productos, extrae nombres de items/productos visibles.

Responde SOLO JSON válido con este esquema:
{{
  "es_comprobante": true,
  "confianza": 0.0,
  "descripcion": "",
  "texto_extraido": "",
  "monto": "",
  "moneda": "COP",
  "titular": "",
  "banco_origen": "",
  "banco_destino": "",
  "referencia": "",
  "fecha": "",
  "items": [],
  "razon": ""
}}
"""
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=model_name,
            contents=[
                types.Part.from_bytes(
                    data=image_bytes,
                    mime_type=_mime_from_path(media_path),
                ),
                prompt,
            ],
        )
        payload = _extraer_json(getattr(response, "text", "") or "")
        if not payload:
            return AnalisisImagenPago(
                es_comprobante=False,
                error="Gemini no devolvió JSON interpretable",
            )

        items_raw = payload.get("items") or []
        if not isinstance(items_raw, list):
            items_raw = [str(items_raw)]

        return AnalisisImagenPago(
            es_comprobante=bool(payload.get("es_comprobante")),
            confianza=float(payload.get("confianza") or 0),
            descripcion=str(payload.get("descripcion") or "").strip(),
            texto_extraido=str(payload.get("texto_extraido") or "").strip(),
            monto=str(payload.get("monto") or "").strip(),
            moneda=str(payload.get("moneda") or "").strip(),
            titular=str(payload.get("titular") or "").strip(),
            banco_origen=str(payload.get("banco_origen") or "").strip(),
            banco_destino=str(payload.get("banco_destino") or "").strip(),
            referencia=str(payload.get("referencia") or "").strip(),
            fecha=str(payload.get("fecha") or "").strip(),
            items=[str(x).strip() for x in items_raw if str(x).strip()],
            razon=str(payload.get("razon") or "").strip(),
        )
    except Exception as e:
        return AnalisisImagenPago(es_comprobante=False, error=str(e)[:500])
