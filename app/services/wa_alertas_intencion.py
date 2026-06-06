"""
Alertas en tiempo real: intención de compra sin atención humana.

Detecta cuando un cliente expresa intención de compra explícita y no
recibe respuesta humana en más de WA_ALERTA_INTENCION_MIN minutos
(default: 15). Envía alerta al grupo configurado en
GRUPO_ALERTAS_INTENCION_WA (fallback: GRUPO_ALERTAS_SISTEMAS_WA).
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from typing import Any

# Reutilizar patrones ya definidos en wa_metricas (no circulares, wa_metricas no importa este módulo)
from app.services.wa_metricas import (
    _PAT_COMPROBANTE,
    _PAT_INTENCION,
    _PAT_PAGO_OK,
)

_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
_STATE_PATH = os.path.join(_DATA_DIR, "wa_alertas_intencion.json")
_UMBRAL_MIN_DEFAULT = 15
_CADENCIA_SEG = 60

_lock = threading.Lock()
_state: dict[str, Any] | None = None  # None = no cargado aún
_ticker_started = False
_ticker_lock = threading.Lock()


# ─── Estado en disco ──────────────────────────────────────────────────────────

def _load() -> dict[str, Any]:
    global _state
    if _state is not None:
        return _state
    try:
        with open(_STATE_PATH, encoding="utf-8") as f:
            _state = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        _state = {"version": 1, "alertas": {}}
    return _state


def _save() -> None:
    try:
        os.makedirs(_DATA_DIR, exist_ok=True)
        with open(_STATE_PATH, "w", encoding="utf-8") as f:
            json.dump(_state, f, ensure_ascii=False, indent=2)
    except Exception as exc:
        print(f"[wa_alertas_intencion] error guardando estado: {exc}")


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _umbral_seg() -> int:
    try:
        return max(1, int(os.getenv("WA_ALERTA_INTENCION_MIN", str(_UMBRAL_MIN_DEFAULT)))) * 60
    except ValueError:
        return _UMBRAL_MIN_DEFAULT * 60


def _grupo_destino() -> str:
    try:
        from app.utils import _wa_jid_env, _JID_ALERTAS_SISTEMAS_DEFAULT  # type: ignore
        return _wa_jid_env("GRUPO_ALERTAS_INTENCION_WA", _JID_ALERTAS_SISTEMAS_DEFAULT)
    except Exception:
        return os.getenv("GRUPO_ALERTAS_INTENCION_WA", "120363425113254825@g.us")


def _jid_display(jid: str) -> str:
    num = re.sub(r"[^0-9]", "", jid)
    return f"...{num[-4:]}" if len(num) >= 4 else jid


def _tiene_intencion(texto: str) -> bool:
    t = (texto or "").strip()
    return bool(t and _PAT_INTENCION.search(t))


def _es_pago_ok(texto: str) -> bool:
    t = (texto or "").strip()
    return bool(t and (_PAT_PAGO_OK.search(t) or _PAT_COMPROBANTE.search(t)))


# ─── API pública ──────────────────────────────────────────────────────────────

def registrar_mensaje(
    jid: str,
    texto: str,
    ts: float,
    direccion: str,   # 'entrada' | 'salida'
    enviado_por: str,  # 'cliente' | 'bot' | 'humano'
    tiene_media: bool = False,
) -> None:
    """Llamar después de guardar cada mensaje en wa_chats.db."""
    if not jid or jid.endswith("@g.us"):
        return  # solo chats 1:1

    _auto_start_ticker()

    with _lock:
        state = _load()
        alertas: dict = state.setdefault("alertas", {})
        alerta: dict | None = alertas.get(jid)
        ahora = ts or time.time()
        dirty = False

        if direccion == "entrada" and enviado_por == "cliente":
            if _tiene_intencion(texto):
                if not alerta or alerta.get("cancelada"):
                    # Nuevo turno de intención de compra
                    alertas[jid] = {
                        "jid": jid,
                        "primer_intencion_ts": ahora,
                        "primer_intencion_texto": (texto or "")[:500],
                        "ultima_human_ts": None,
                        "ultimo_bot_ts": None,
                        "alerta_enviada_ts": None,
                        "cancelada": False,
                        "cancelada_razon": None,
                    }
                    dirty = True

        elif direccion == "salida" and enviado_por == "humano":
            if alerta and not alerta.get("cancelada"):
                alerta["ultima_human_ts"] = ahora
                alerta["cancelada"] = True
                alerta["cancelada_razon"] = "humano_respondio"
                dirty = True

        elif direccion == "salida" and enviado_por == "bot":
            if alerta and not alerta.get("cancelada"):
                alerta["ultimo_bot_ts"] = ahora
                dirty = True

        # Pago confirmado por cualquiera → cerrar alerta
        if alerta and not alerta.get("cancelada") and _es_pago_ok(texto or ""):
            alerta["cancelada"] = True
            alerta["cancelada_razon"] = "pago_confirmado"
            dirty = True

        if dirty:
            _save()


def cancelar(jid: str, razon: str = "manual") -> None:
    """Cancela manualmente la alerta de un JID (ej. operador interviene desde el panel)."""
    if not jid:
        return
    with _lock:
        state = _load()
        alerta = state.get("alertas", {}).get(jid)
        if alerta and not alerta.get("cancelada"):
            alerta["cancelada"] = True
            alerta["cancelada_razon"] = razon
            _save()


def listar_pendientes() -> list[dict]:
    """Lista de alertas activas (no canceladas) para el panel."""
    with _lock:
        state = _load()
        alertas = state.get("alertas", {})
        ahora = time.time()
        result = []
        for a in alertas.values():
            if a.get("cancelada"):
                continue
            espera_min = int((ahora - (a.get("primer_intencion_ts") or ahora)) / 60)
            result.append({
                "jid": a["jid"],
                "display": _jid_display(a["jid"]),
                "texto": (a.get("primer_intencion_texto") or "")[:200],
                "espera_min": espera_min,
                "bot_respondio": a.get("ultimo_bot_ts") is not None,
                "alerta_enviada": a.get("alerta_enviada_ts") is not None,
                "primer_intencion_ts": a.get("primer_intencion_ts"),
            })
        result.sort(key=lambda x: x["espera_min"], reverse=True)
        return result


# ─── Ticker (background check) ────────────────────────────────────────────────

def tick() -> None:
    """Revisa alertas pendientes; envía las que superaron el umbral de tiempo."""
    with _lock:
        state = _load()
        alertas = state.get("alertas", {})
        ahora = time.time()
        umbral = _umbral_seg()
        pendientes = [
            dict(a)  # copia para operar fuera del lock
            for a in alertas.values()
            if not a.get("cancelada")
            and a.get("alerta_enviada_ts") is None
            and (ahora - (a.get("primer_intencion_ts") or ahora)) >= umbral
        ]

    for a in pendientes:
        _enviar_alerta(a)


def _enviar_alerta(alerta: dict) -> None:
    try:
        from app.utils import enviar_whatsapp_reporte
        jid = alerta["jid"]
        ahora = time.time()
        espera_min = int((ahora - alerta["primer_intencion_ts"]) / 60)
        texto_cliente = (alerta.get("primer_intencion_texto") or "[sin texto]")[:200]
        bot_ts = alerta.get("ultimo_bot_ts")
        bot_hace_min = int((ahora - bot_ts) / 60) if bot_ts else None

        lineas = [
            "🚨 *Intención de compra sin atención humana*",
            "",
            f"📱 Cliente: {_jid_display(jid)}",
            f"⏱ Sin respuesta humana: {espera_min} min",
            f'💬 Mensaje: "{texto_cliente}"',
            f"🤖 Bot respondió: {'Sí (hace ' + str(bot_hace_min) + ' min)' if bot_hace_min is not None else 'No'}",
            "",
            "👉 Responder en Agente WA",
        ]

        grupo = _grupo_destino()
        ok = enviar_whatsapp_reporte("\n".join(lineas), grupo)
        if ok:
            with _lock:
                state = _load()
                entry = state.get("alertas", {}).get(jid)
                if entry and not entry.get("cancelada"):
                    entry["alerta_enviada_ts"] = ahora
                    _save()
            print(f"[wa_alertas_intencion] alerta enviada: {_jid_display(jid)} ({espera_min} min)")
    except Exception as exc:
        print(f"[wa_alertas_intencion] error enviando alerta: {exc}")


def _run_ticker() -> None:
    while True:
        time.sleep(_CADENCIA_SEG)
        try:
            tick()
        except Exception as exc:
            print(f"[wa_alertas_intencion] ticker error: {exc}")


def _auto_start_ticker() -> None:
    global _ticker_started
    with _ticker_lock:
        if _ticker_started:
            return
        _ticker_started = True
    t = threading.Thread(target=_run_ticker, daemon=True, name="wa-alertas-intencion-ticker")
    t.start()
