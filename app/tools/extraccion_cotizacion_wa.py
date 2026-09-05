"""
Extracción asistida por IA de datos de cliente/productos desde una
conversación de WhatsApp pegada por el operador, para prellenar el panel
Facturación → Cotizar/Facturar (ver app/tools/facturacion_directa.py).

Decisión de diseño: la IA SOLO convierte texto libre a JSON estructurado —
nunca decide el SKU final (eso se resuelve contra Alegra/Siigo vía
buscar_productos_alegra_picker, devolviendo varios candidatos si hay
ambigüedad, o ninguno si no hay match) ni dispara cotizar/facturar por su
cuenta. El operador siempre revisa y confirma en el panel antes de que se
cree cualquier documento real — mismo principio que el resto del panel (ver
comentario de diseño en facturacion_directa.py).
"""

from __future__ import annotations

import json
import re

_MAX_CHARS_TEXTO = 6000
_MODELO = "claude-sonnet-4-6"

_SYSTEM_PROMPT = """Extraes datos de cliente y productos de una conversación de WhatsApp entre un vendedor de McKenna Group (materias primas farmacéuticas/cosméticas) y un cliente, para prellenar un formulario de cotización/factura.

Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin backticks ni markdown, con esta forma exacta:
{"cliente": {"nombre": "", "identificacion": "", "telefono": "", "correo": "", "direccion": ""}, "productos": [{"nombre": "", "cantidad": 1}], "notas": ""}

Reglas:
- Usa SOLO datos que aparezcan explícitamente en la conversación. Si un dato no aparece, deja el campo como cadena vacía "" (o la lista de productos vacía si no se mencionó ningún producto).
- "identificacion" es cédula o NIT del cliente — solo si el cliente la escribió explícitamente en el texto.
- "telefono" solo si aparece un número de celular colombiano explícito en el texto (no inventes ni completes con ceros).
- Cada producto: "nombre" tal como el cliente lo nombró (no inventes un código/SKU), "cantidad" numérica (usa 1 si no se especifica cantidad).
- "notas": condiciones especiales mencionadas (fecha de entrega, forma de pago, descuento acordado, etc.) en una frase corta. Cadena vacía si no hay nada relevante.
- Nunca inventes datos que no estén en el texto."""


def extraer_datos_cotizacion(texto: str) -> dict:
    """
    Devuelve {"ok": True, "cliente": {...}, "productos": [...], "notas": ""}
    o {"ok": False, "error": "..."}. Nunca lanza excepción — errores del LLM
    o de presupuesto se devuelven como {"ok": False} para que el panel caiga
    de vuelta al llenado manual.
    """
    texto = (texto or "").strip()
    if not texto:
        return {"ok": False, "error": "No hay texto de conversación para extraer."}
    texto = texto[-_MAX_CHARS_TEXTO:]

    from app.core import cliente_ia

    if cliente_ia is None:
        return {"ok": False, "error": "ANTHROPIC_API_KEY no configurado."}

    from app.agent.llm_router import ClaudeProvider, ProviderError
    from app.services.llm_budget import permitir_llamada, registrar_llamada

    ok_budget, motivo = permitir_llamada(_MODELO, contexto="facturacion_extraccion")
    if not ok_budget:
        return {"ok": False, "error": f"Bloqueado por presupuesto LLM: {motivo}"}

    try:
        resp = ClaudeProvider(cliente_ia, model_id=_MODELO).complete(
            [{"role": "user", "content": f"CONVERSACIÓN:\n{texto}"}],
            system=_SYSTEM_PROMPT,
            max_tokens=1024,
        )
    except ProviderError as e:
        return {"ok": False, "error": f"Error IA: {e}"}

    registrar_llamada(
        _MODELO,
        tokens_in=resp.input_tokens,
        tokens_out=resp.output_tokens,
        contexto="facturacion_extraccion",
        chars_prompt=len(texto),
        chars_respuesta=len(resp.text or ""),
    )

    bruto = (resp.text or "").strip()
    bruto = re.sub(r"^```(?:json)?|```$", "", bruto, flags=re.MULTILINE).strip()
    try:
        datos = json.loads(bruto)
    except json.JSONDecodeError:
        return {"ok": False, "error": "La IA no devolvió JSON válido — intenta de nuevo o llena manualmente."}

    cliente_raw = datos.get("cliente") if isinstance(datos.get("cliente"), dict) else {}
    productos_raw = datos.get("productos") or []
    productos: list[dict] = []
    for p in productos_raw:
        if not isinstance(p, dict):
            continue
        nombre = str(p.get("nombre") or "").strip()
        if not nombre:
            continue
        try:
            cantidad = float(p.get("cantidad") or 1)
        except (TypeError, ValueError):
            cantidad = 1.0
        productos.append({"nombre": nombre, "cantidad": cantidad if cantidad > 0 else 1.0})

    # Sugiere candidatos reales de Alegra/Siigo para cada producto mencionado
    # — nunca se autoselecciona un código; el operador confirma en el panel.
    from app.services.alegra import buscar_productos_alegra_picker

    for p in productos:
        try:
            p["candidatos"] = buscar_productos_alegra_picker(
                p["nombre"], max_items=5, excluir_combos=False
            )
        except Exception:
            p["candidatos"] = []

    return {
        "ok": True,
        "cliente": {
            "nombre": str(cliente_raw.get("nombre") or "").strip(),
            "identificacion": str(cliente_raw.get("identificacion") or "").strip(),
            "telefono": str(cliente_raw.get("telefono") or "").strip(),
            "correo": str(cliente_raw.get("correo") or "").strip(),
            "direccion": str(cliente_raw.get("direccion") or "").strip(),
        },
        "productos": productos,
        "notas": str(datos.get("notas") or "").strip(),
    }
