"""
Presupuesto de gasto LLM (agnóstico de proveedor: Gemini, Claude, etc.).

Objetivo: que ninguna llamada por API — y en especial ningún script masivo
(simulaciones, generación de contenido) — queme decenas de dólares sin
autorización explícita, como pasó con la simulación WA del 31-jul-2026
(~750 llamadas a gemini-2.5-pro en un día).

Tres niveles de control:

1. Tope diario global (todos los procesos, persistido en app/data/llm_budget.json):
   - LLM_BUDGET_DIARIO_USD  (default 1.0): al cruzarlo se envía UNA alerta
     WhatsApp al grupo de sistemas y se loguea; las llamadas siguen.
     (Un día normal de operación cuesta US$0.10-0.25 — medido ago-2026.)
   - LLM_BUDGET_TOPE_USD    (default 3.0): al cruzarlo se BLOQUEAN nuevas
     llamadas (permitir_llamada devuelve False). Los canales de clientes
     degradan a silencio → atiende un humano.

2. Procesos batch/scripts (default estricto): cualquier proceso que NO se haya
   marcado como servicio (agente_pro / webhook_meli lo hacen al arrancar) queda
   limitado a LLM_BUDGET_BATCH_LLAMADAS (default 25) y LLM_BUDGET_BATCH_USD
   (default 1.0 USD estimado) por proceso. Para superar eso, el script debe
   llamar autorizar_lote(monto) — normalmente vía un flag CLI tipo
   --autorizar-gasto-usd que el operador escribe a conciencia.

3. Regla de repo (CLAUDE.md): todo call-site nuevo de LLM debe pasar por
   permitir_llamada() / registrar_llamada().

Uso típico en un call-site:

    from app.services.llm_budget import permitir_llamada, registrar_llamada
    ok, motivo = permitir_llamada("gemini-2.5-pro", contexto="preventa")
    if not ok:
        log/return None
    resp = cliente.models.generate_content(...)
    registrar_llamada("gemini-2.5-pro", tokens_in=..., tokens_out=..., contexto="preventa")
"""

from __future__ import annotations

import fcntl
import json
import os
import threading
from datetime import datetime

from app.observability import log_json

_RUTA_ESTADO = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "data", "llm_budget.json"
)
_LOCK_LOCAL = threading.Lock()

# (USD por millón de tokens de entrada, USD por millón de salida).
# La salida incluye tokens de razonamiento ("thinking") en Gemini 2.5 Pro y Claude.
# Prefijo más largo gana. Modelos no listados usan _PRECIO_DESCONOCIDO (conservador).
_PRECIOS_USD_MTOK: list[tuple[str, tuple[float, float]]] = [
    ("gemini-2.5-pro", (1.25, 10.0)),
    ("gemini-2.5-flash", (0.30, 2.50)),
    ("gemini-2.0-flash", (0.10, 0.40)),
    ("claude-fable", (10.0, 50.0)),
    ("claude-opus", (5.0, 25.0)),
    ("claude-sonnet-5", (2.0, 10.0)),
    ("claude-sonnet", (3.0, 15.0)),
    ("claude-haiku", (1.0, 5.0)),
]
_PRECIO_DESCONOCIDO = (5.0, 25.0)

# Modelos locales sin costo por token.
_PREFIJOS_GRATIS = ("gemma", "llama", "qwen", "mistral", "phi", "deepseek-r1")

# Estado por proceso (nivel 2).
_proceso_es_servicio = False
_proceso_autorizado_usd = 0.0
_proceso_llamadas = 0
_proceso_gasto_usd = 0.0


def _f(nombre: str, default: float) -> float:
    try:
        return float(os.getenv(nombre, "").strip() or default)
    except ValueError:
        return default


def _precio(modelo: str) -> tuple[float, float]:
    m = (modelo or "").strip().lower()
    if any(m.startswith(p) for p in _PREFIJOS_GRATIS):
        return (0.0, 0.0)
    mejor = None
    for prefijo, precio in _PRECIOS_USD_MTOK:
        if m.startswith(prefijo) and (mejor is None or len(prefijo) > len(mejor[0])):
            mejor = (prefijo, precio)
    return mejor[1] if mejor else _PRECIO_DESCONOCIDO


def costo_usd(modelo: str, tokens_in: int, tokens_out: int) -> float:
    p_in, p_out = _precio(modelo)
    return (max(tokens_in, 0) * p_in + max(tokens_out, 0) * p_out) / 1_000_000


def estimar_tokens(texto: str | None) -> int:
    """Estimación burda (~4 chars/token) cuando el proveedor no reporta usage."""
    return max(len(texto or "") // 4, 0)


def marcar_proceso_servicio() -> None:
    """Los servicios de larga vida (agente_pro, webhook_meli) llaman esto al
    arrancar: quedan exentos del límite por proceso (nivel 2) pero siguen
    sujetos al tope diario global (nivel 1)."""
    global _proceso_es_servicio
    _proceso_es_servicio = True


def autorizar_lote(monto_usd: float, descripcion: str = "") -> None:
    """Un script batch declara explícitamente cuánto está autorizado a gastar.
    Debe venir de una decisión humana (flag CLI), nunca hardcodeado."""
    global _proceso_autorizado_usd
    _proceso_autorizado_usd = max(float(monto_usd), 0.0)
    log_json(
        "llm_budget_lote_autorizado",
        monto_usd=_proceso_autorizado_usd,
        descripcion=descripcion[:120],
    )


def _dia_nuevo(hoy: str, historial: list) -> dict:
    return {
        "fecha": hoy,
        "gasto_usd": 0.0,
        "llamadas": 0,
        "por_modelo": {},
        "por_contexto": {},
        "alerta_enviada": False,
        "historial": historial,
    }


def _leer_estado() -> dict:
    """Estado del día actual. Al cambiar la fecha, el día anterior se archiva
    en `historial` (lista de días cerrados, máx 400) dentro del mismo JSON."""
    hoy = datetime.now().strftime("%Y-%m-%d")
    try:
        with open(_RUTA_ESTADO, encoding="utf-8") as f:
            d = json.load(f)
        if d.get("fecha") == hoy:
            d.setdefault("por_contexto", {})
            d.setdefault("historial", [])
            return d
        historial = d.get("historial", [])
        if d.get("fecha") and d.get("llamadas", 0) > 0:
            cerrado = {
                k: d.get(k)
                for k in ("fecha", "gasto_usd", "llamadas", "por_modelo", "por_contexto")
            }
            historial = (historial + [cerrado])[-400:]
        return _dia_nuevo(hoy, historial)
    except Exception:
        return _dia_nuevo(hoy, [])


def _con_lock_archivo(fn):
    """Ejecuta fn(estado) -> estado con lock entre procesos (8080 y 8081)."""
    with _LOCK_LOCAL:
        lock_path = _RUTA_ESTADO + ".lock"
        with open(lock_path, "a") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            try:
                estado = _leer_estado()
                estado = fn(estado)
                tmp = _RUTA_ESTADO + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(estado, f, ensure_ascii=False, indent=1)
                os.replace(tmp, _RUTA_ESTADO)
                return estado
            finally:
                fcntl.flock(lk, fcntl.LOCK_UN)


def gasto_hoy() -> dict:
    """Resumen del día (para panel / diagnóstico)."""
    with _LOCK_LOCAL:
        return _leer_estado()


def historial_dias(n: int = 30) -> list[dict]:
    """Últimos n días CERRADOS + el día en curso, ordenados por fecha asc."""
    estado = gasto_hoy()
    dias = list(estado.get("historial", []))[-n:]
    dias.append(
        {
            k: estado.get(k)
            for k in ("fecha", "gasto_usd", "llamadas", "por_modelo", "por_contexto")
        }
    )
    return dias


def resumen_semanal() -> dict:
    """Agregado de los últimos 7 días (incluye hoy): total USD, llamadas,
    desglose por modelo y por contexto/canal, y detalle por día."""
    dias = historial_dias(30)[-7:]
    total = sum(d.get("gasto_usd", 0.0) or 0.0 for d in dias)
    llamadas = sum(d.get("llamadas", 0) or 0 for d in dias)
    por_modelo: dict[str, float] = {}
    por_contexto: dict[str, float] = {}
    for d in dias:
        for m, v in (d.get("por_modelo") or {}).items():
            por_modelo[m] = round(por_modelo.get(m, 0.0) + v, 6)
        for c, v in (d.get("por_contexto") or {}).items():
            por_contexto[c] = round(por_contexto.get(c, 0.0) + v, 6)
    return {
        "desde": dias[0].get("fecha") if dias else None,
        "hasta": dias[-1].get("fecha") if dias else None,
        "total_usd": round(total, 4),
        "llamadas": llamadas,
        "promedio_dia_usd": round(total / max(len(dias), 1), 4),
        "por_modelo": por_modelo,
        "por_contexto": por_contexto,
        "dias": dias,
    }


def permitir_llamada(modelo: str, contexto: str = "") -> tuple[bool, str]:
    """
    Chequear ANTES de llamar al LLM. Devuelve (permitido, motivo_si_no).
    Nunca lanza excepción: ante cualquier error interno, permite (fail-open)
    para no tumbar la atención a clientes por un bug del contador.
    """
    try:
        if _precio(modelo) == (0.0, 0.0):
            return True, ""

        tope = _f("LLM_BUDGET_TOPE_USD", 3.0)
        estado = gasto_hoy()
        if estado.get("gasto_usd", 0.0) >= tope:
            log_json(
                "llm_budget_bloqueo_diario",
                modelo=modelo,
                contexto=contexto[:60],
                gasto_usd=round(estado.get("gasto_usd", 0.0), 2),
                tope_usd=tope,
            )
            return False, (
                f"Tope diario LLM alcanzado (US${estado.get('gasto_usd', 0):.2f} ≥ "
                f"US${tope:.2f}). Sube LLM_BUDGET_TOPE_USD solo con autorización."
            )

        if not _proceso_es_servicio:
            max_llamadas = int(_f("LLM_BUDGET_BATCH_LLAMADAS", 25))
            max_usd = _f("LLM_BUDGET_BATCH_USD", 1.0)
            if _proceso_autorizado_usd > 0:
                if _proceso_gasto_usd >= _proceso_autorizado_usd:
                    return False, (
                        f"Lote agotó su autorización (US${_proceso_gasto_usd:.2f} ≥ "
                        f"US${_proceso_autorizado_usd:.2f}). Re-ejecuta con un monto mayor."
                    )
            elif _proceso_llamadas >= max_llamadas or _proceso_gasto_usd >= max_usd:
                return False, (
                    f"Proceso batch sin autorización: límite {max_llamadas} llamadas / "
                    f"US${max_usd:.2f} estimados. Usa autorizar_lote() (flag "
                    f"--autorizar-gasto-usd en scripts) para continuar."
                )
        return True, ""
    except Exception as e:
        log_json("llm_budget_error", fase="permitir", error=str(e)[:150])
        return True, ""


def registrar_llamada(
    modelo: str,
    tokens_in: int = 0,
    tokens_out: int = 0,
    contexto: str = "",
    chars_prompt: int = 0,
    chars_respuesta: int = 0,
) -> float:
    """
    Registrar DESPUÉS de cada llamada. Si el proveedor no reportó usage,
    pasar chars_* para estimar. Devuelve el gasto acumulado del día (USD).
    Nunca lanza excepción.
    """
    global _proceso_llamadas, _proceso_gasto_usd
    try:
        if not tokens_in and chars_prompt:
            tokens_in = chars_prompt // 4
        if not tokens_out and chars_respuesta:
            # Margen por thinking tokens no reportados (Gemini 2.5 Pro, Claude).
            tokens_out = chars_respuesta // 4 + 500
        usd = costo_usd(modelo, tokens_in, tokens_out)

        _proceso_llamadas += 1
        _proceso_gasto_usd += usd

        def actualizar(estado: dict) -> dict:
            estado["gasto_usd"] = round(estado.get("gasto_usd", 0.0) + usd, 6)
            estado["llamadas"] = estado.get("llamadas", 0) + 1
            pm = estado.setdefault("por_modelo", {})
            pm[modelo] = round(pm.get(modelo, 0.0) + usd, 6)
            if contexto:
                pc = estado.setdefault("por_contexto", {})
                pc[contexto] = round(pc.get(contexto, 0.0) + usd, 6)
            return estado

        estado = _con_lock_archivo(actualizar)
        _avisar_si_cruzo_umbral(estado)
        return estado.get("gasto_usd", 0.0)
    except Exception as e:
        log_json("llm_budget_error", fase="registrar", error=str(e)[:150])
        return 0.0


def _avisar_si_cruzo_umbral(estado: dict) -> None:
    umbral = _f("LLM_BUDGET_DIARIO_USD", 1.0)
    if estado.get("alerta_enviada") or estado.get("gasto_usd", 0.0) < umbral:
        return

    def marcar(e: dict) -> dict:
        e["alerta_enviada"] = True
        return e

    _con_lock_archivo(marcar)
    log_json(
        "llm_budget_alerta_diaria",
        gasto_usd=round(estado.get("gasto_usd", 0.0), 2),
        umbral_usd=umbral,
        llamadas=estado.get("llamadas", 0),
    )
    try:
        from app.utils import enviar_whatsapp_reporte, jid_grupo_alertas_sistemas_wa

        detalle = ", ".join(
            f"{m}: ${v:.2f}"
            for m, v in sorted(
                estado.get("por_modelo", {}).items(), key=lambda kv: -kv[1]
            )[:4]
        )
        enviar_whatsapp_reporte(
            "⚠️ *Presupuesto LLM*: el gasto estimado de hoy va en "
            f"US${estado.get('gasto_usd', 0.0):.2f} (umbral US${umbral:.2f}, "
            f"{estado.get('llamadas', 0)} llamadas).\n{detalle}\n"
            f"Se bloqueará al llegar a US${_f('LLM_BUDGET_TOPE_USD', 3.0):.2f}.",
            jid_grupo_alertas_sistemas_wa(),
        )
    except Exception as e:
        log_json("llm_budget_error", fase="alerta_wa", error=str(e)[:150])


def usage_gemini(resp) -> tuple[int, int]:
    """Extrae (tokens_in, tokens_out) del usage_metadata de google-genai.
    tokens_out incluye thoughts_token_count (razonamiento, se cobra como salida)."""
    try:
        u = getattr(resp, "usage_metadata", None)
        if u is None:
            return 0, 0
        t_in = int(getattr(u, "prompt_token_count", 0) or 0)
        t_out = int(getattr(u, "candidates_token_count", 0) or 0)
        t_out += int(getattr(u, "thoughts_token_count", 0) or 0)
        return t_in, t_out
    except Exception:
        return 0, 0


def usage_anthropic(resp) -> tuple[int, int]:
    """Extrae (tokens_in, tokens_out) del usage de la API de Anthropic.
    Las lecturas de caché se ponderan al 10% (su tarifa real aproximada)."""
    try:
        u = getattr(resp, "usage", None)
        if u is None:
            return 0, 0
        t_in = int(getattr(u, "input_tokens", 0) or 0)
        t_in += int(getattr(u, "cache_creation_input_tokens", 0) or 0)
        # Lecturas de caché cuestan ~10% de la tarifa de entrada.
        t_in += int(0.1 * (getattr(u, "cache_read_input_tokens", 0) or 0))
        t_out = int(getattr(u, "output_tokens", 0) or 0)
        return t_in, t_out
    except Exception:
        return 0, 0
