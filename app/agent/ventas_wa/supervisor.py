"""
Supervisión en tiempo real de cada respuesta del agente de ventas (WhatsApp y web).

Dos niveles, acotados a UNA corrección por turno (sin recursión abierta: un
supervisor corrigiendo sin límite dispara costo y demora):

1. Reglas deterministas (gratis): precios respaldados por las herramientas,
   sin números de cuenta/teléfonos no autorizados, sin volver a pedir datos
   que ya están guardados.
2. Revisor IA (modelo pequeño) solo para respuestas de riesgo: las que llevan
   precios o pasan el caso a un asesor. Evalúa lo que las reglas no ven
   (contradicciones con el cliente o con el asesor, promesas, tono).

Si hay problemas, el agente principal recibe la lista y corrige una vez; si la
corrección también falla, se envía una respuesta segura y se avisa al equipo.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field

from app.observability import log_json

MODELO_REVISOR = os.getenv("WA_V2_SUPERVISOR_MODELO", "claude-haiku-4-5")
CONTEXTO_BUDGET = "wa_ventas_v2_supervisor"

_PAT_PRECIO = re.compile(r"\$\s?(\d{1,3}(?:[.,]\d{3})+|\d{4,})")
_PAT_DIGITOS = re.compile(r"(?<![\d$.,])(\d[\d .-]{6,}\d)(?![\d])")
_PAT_PAGO = re.compile(r"\b(nequi|daviplata|cuenta\s+(?:de\s+)?(?:ahorros|corriente)|llave|bre-?b|transfiya|qr)\b", re.I)
_PIDE_DATO = {
    "nombre": re.compile(r"\bnombre(\s+completo)?\b", re.I),
    "documento": re.compile(r"\b(c[eé]dula|nit|documento)\b", re.I),
    "direccion": re.compile(r"\bdirecci[oó]n\b", re.I),
    "ciudad": re.compile(r"\bciudad\b", re.I),
}


@dataclass
class Revision:
    problemas: list[str] = field(default_factory=list)
    nivel: str = ""  # "reglas" | "ia"

    @property
    def ok(self) -> bool:
        return not self.problemas


def _montos(texto: str) -> set[int]:
    out = set()
    for m in _PAT_PRECIO.findall(texto or ""):
        try:
            out.add(int(re.sub(r"[.,]", "", m)))
        except ValueError:
            continue
    return out


def _solo_digitos(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def revisar_reglas(respuesta: str, *, evidencia: str, cliente: dict) -> Revision:
    """
    evidencia: resultados de herramientas del turno + resumen del pedido al iniciar
    (lo único de donde puede salir un precio o una cifra).
    """
    rev = Revision(nivel="reglas")
    permitidos = _montos(evidencia)
    no_respaldados = sorted(_montos(respuesta) - permitidos)
    if no_respaldados:
        rev.problemas.append(
            "Mencionas precios que no salen de las herramientas de este turno ni del pedido: "
            + ", ".join(f"${n:,}".replace(",", ".") for n in no_respaldados)
            + ". Consulta buscar_producto/ver_pedido y usa solo esas cifras."
        )

    # Números largos (cuentas, teléfonos, llaves) que no son del propio cliente ni de la evidencia.
    conocidos = {_solo_digitos(str(v)) for v in (cliente or {}).values()} | {
        _solo_digitos(x) for x in _PAT_DIGITOS.findall(evidencia or "")
    }
    for crudo in _PAT_DIGITOS.findall(respuesta or ""):
        d = _solo_digitos(crudo)
        if len(d) >= 7 and d not in conocidos and not any(d in k for k in conocidos if k):
            rev.problemas.append(
                f"Escribiste el número '{crudo.strip()}', que no viene de ninguna herramienta ni del cliente. "
                "No des números de cuenta, llaves ni teléfonos: el asesor comparte los datos de pago."
            )
            break
    if _PAT_PAGO.search(respuesta or "") and re.search(r"\d{6,}", _solo_digitos(respuesta or "")):
        rev.problemas.append("La respuesta parece incluir datos de pago. Tú no los das: el asesor los comparte al cerrar.")

    # Volver a pedir un dato que ya está guardado (lo que hizo perder la venta de Doris).
    if "?" in (respuesta or "") or re.search(r"\b(reg[aá]leme|me\s+(?:confirma|comparte|env[ií]a|da))\b", respuesta or "", re.I):
        repetidos = [
            k for k, pat in _PIDE_DATO.items() if str((cliente or {}).get(k) or "").strip() and pat.search(respuesta or "")
        ]
        if repetidos and re.search(r"\b(reg[aá]leme|necesito|me\s+(?:confirma|comparte|env[ií]a|da)|falta)\b", respuesta or "", re.I):
            rev.problemas.append(
                "Estás pidiendo datos que el cliente ya dio y están guardados en el pedido: "
                + ", ".join(repetidos)
                + ". No los vuelvas a pedir."
            )
    return rev


def _cliente_revisor():
    key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not key:
        return None
    import anthropic

    return anthropic.Anthropic(api_key=key, timeout=30.0, max_retries=1)


PROMPT_REVISOR = """Eres el supervisor de calidad de Hugo, el asistente IA de ventas de McKenna Group (materias primas, Colombia). Revisas UNA respuesta antes de que llegue al cliente.

Reglas del negocio que Hugo debe cumplir:
- Solo precios y productos respaldados por la EVIDENCIA (resultados de herramientas y pedido).
- No cierra ventas ni da datos de pago; el asesor humano lo hace.
- No promete tiempos ("en un momento", "enseguida"), no dice que él averiguará algo después.
- No vuelve a pedir datos que el cliente ya dio.
- No contradice lo que ya dijo un ASESOR humano en la conversación.
- No da recomendaciones médicas ni dosis de consumo.
- Responde lo que el cliente preguntó; no inventa.

NO son errores (no los marques): el trato "veci" y el tono colombiano cercano (es la voz de la marca); la presentación como asistente virtual; ofrecer un asesor. En WhatsApp el paso a un humano es pasar_a_asesor; en el chat WEB no existe esa herramienta: allí el paso a un humano es el botón de continuar por WhatsApp o el carrito de la página. No exijas herramientas ni textos que el canal no tiene.

Responde SOLO con un JSON en una línea: {"aprobado": true|false, "problemas": ["..."]}. Marca aprobado=false únicamente por errores reales que perjudiquen al cliente o al negocio, no por estilo."""


def revisar_ia(respuesta: str, *, contexto: str, evidencia: str, canal: str, cliente=None) -> tuple[Revision, int, int]:
    """(revisión, tokens_in, tokens_out). Falla abierta: si el revisor no responde, aprueba."""
    from app.services.llm_budget import permitir_llamada, registrar_llamada, usage_anthropic

    rev = Revision(nivel="ia")
    if os.getenv("WA_V2_SUPERVISOR_IA", "1").strip() in ("0", "false", "no"):
        return rev, 0, 0
    cliente = cliente if cliente is not None else _cliente_revisor()
    if cliente is None:
        return rev, 0, 0
    ok, _ = permitir_llamada(MODELO_REVISOR, contexto=CONTEXTO_BUDGET)
    if not ok:
        return rev, 0, 0
    contenido = (
        f"Canal: {canal}\n\nCONTEXTO DE LA CONVERSACIÓN:\n{contexto[-6000:]}\n\n"
        f"EVIDENCIA (herramientas y pedido):\n{evidencia[-4000:]}\n\n"
        f"RESPUESTA PROPUESTA DE HUGO:\n{respuesta}"
    )
    try:
        resp = cliente.messages.create(
            model=MODELO_REVISOR,
            max_tokens=600,
            system=PROMPT_REVISOR,
            messages=[{"role": "user", "content": contenido}],
        )
    except Exception as e:
        log_json("wa_v2_supervisor_error", error=str(e)[:200])
        return rev, 0, 0
    t_in, t_out = usage_anthropic(resp)
    registrar_llamada(MODELO_REVISOR, tokens_in=t_in, tokens_out=t_out, contexto=CONTEXTO_BUDGET)
    texto = "".join(getattr(b, "text", "") for b in resp.content if getattr(b, "type", "") == "text")
    m = re.search(r"\{.*\}", texto, re.S)
    try:
        data = json.loads(m.group(0)) if m else {}
    except ValueError:
        data = {}
    if data.get("aprobado") is False:
        rev.problemas = [str(p)[:300] for p in (data.get("problemas") or []) if str(p).strip()][:5] or [
            "El supervisor rechazó la respuesta sin detalle."
        ]
    return rev, t_in, t_out


def es_de_riesgo(respuesta: str, herramientas: list[str]) -> bool:
    return bool(_PAT_PRECIO.search(respuesta or "")) or "pasar_a_asesor" in herramientas or bool(
        _PAT_PAGO.search(respuesta or "")
    )
