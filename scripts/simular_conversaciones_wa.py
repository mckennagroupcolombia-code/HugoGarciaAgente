#!/usr/bin/env python3
"""
Simulador de conversaciones WhatsApp contra el pipeline real de IA.

Reproduce guiones de clientes reales (extraídos de wa_chats.db, chats que
terminaron en venta) turno a turno contra obtener_respuesta_ia(canal="whatsapp")
en modo fuera de horario, y evalúa cada respuesta contra los modos de fallo
conocidos: datos de pago inventados, promesas vacías, pérdida de contexto,
respuestas repetidas, transparencia IA, promesas de despacho inmediato, etc.

Aislamiento:
- Historial en BD temporal (AGENTE_CONVERSACIONES_DB → scratchpad).
- enviar_whatsapp_* parcheados a no-op (no alerta a grupos reales).
- guardar_qa_exitoso parcheado (no contamina la memoria vectorial).
- Los preflights de catálogo/ficha/memoria corren REALES (eso se está probando).

Uso:
  python3 scripts/simular_conversaciones_wa.py --guiones <archivo.json> \
      --out <resultados.jsonl> [--max 5] [--workers 5]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import threading
import time

SCRATCH = os.environ.get(
    "SIM_SCRATCH",
    "/tmp/claude-1000/-home-mckg-mi-agente/dc05e8b8-c5ca-4f16-9074-83e34bd999b4/scratchpad",
)
os.makedirs(SCRATCH, exist_ok=True)
os.environ.setdefault(
    "AGENTE_CONVERSACIONES_DB", os.path.join(SCRATCH, "sim_conversaciones.sqlite3")
)

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

import app.core as core  # noqa: E402
import app.utils as utils  # noqa: E402

# ── Neutralizar efectos secundarios ─────────────────────────────────────────
_wa_bloqueados: list[dict] = []


def _wa_noop(mensaje, *a, **k):
    _wa_bloqueados.append({"texto": str(mensaje)[:200]})
    return True


for _mod in (utils, core):
    for _fn in ("enviar_whatsapp_reporte", "enviar_whatsapp_mensaje", "enviar_whatsapp_archivo"):
        if hasattr(_mod, _fn):
            setattr(_mod, _fn, _wa_noop)

core.guardar_qa_exitoso = lambda *a, **k: None

# Instrumentar preflight de catálogo para saber si el turno tuvo contexto real
_tl = threading.local()
_orig_preflight = core._preflight_contexto_whatsapp
_orig_ficha = core._preflight_ficha_tecnica


def _preflight_instrumentado(pregunta, messages=None):
    out = _orig_preflight(pregunta, messages)
    _tl.ctx_catalogo = bool(out)
    return out


def _ficha_instrumentada(pregunta, messages=None):
    out = _orig_ficha(pregunta, messages)
    _tl.ctx_ficha = bool(out)
    return out


core._preflight_contexto_whatsapp = _preflight_instrumentado
core._preflight_ficha_tecnica = _ficha_instrumentada

# ── Checks automáticos por respuesta ────────────────────────────────────────
_DATOS_OK = {"0066302076", "3195183596", "573195183596"}
_PAT_NUM_LARGO = re.compile(r"\b\d[\d .-]{8,}\d\b")
_PAT_NEQUI = re.compile(r"nequi[^.\n]{0,30}\d{6,}", re.I)
_PAT_PROMESA = re.compile(
    r"(d[ée]jame verificar|le confirmo en un momento|apenas tenga (el dato|la informaci[oó]n)"
    r"|le escribo (luego|despu[eé]s|apenas|m[aá]s tarde)|te aviso|ya le averiguo)",
    re.I,
)
_PAT_SALUDO_INICIAL = re.compile(r"asistente virtual.{0,80}(servir|colaborar|ayudar)", re.I | re.S)
_PAT_ACLARACION_ENLATADA = re.compile(r"me confirma el nombre exacto del producto", re.I)
_PAT_ERROR_TEC = re.compile(r"(problema t[eé]cnico|ajuste t[eé]cnico|mantenimiento)", re.I)
_PAT_DESPACHO_YA = re.compile(
    r"(se lo despach(o|amos) (hoy|ya|de una|ah[ií] mismo)|ah[ií] mismo le despachamos"
    r"|despacho inmediato)",
    re.I,
)
_PAT_AFIRMA_DISP = re.compile(r"\bs[ií],? (lo |la |los |las )?(manejamos|tenemos)\b", re.I)
_PAT_TRANSPARENCIA = re.compile(r"(asistente virtual|asistente de ia|soy una? ia|inteligencia artificial)", re.I)
_PAT_FUERA_HORARIO = re.compile(r"(fuera de horario|horario laboral|primera hora|equipo (est[aá]|vuelve))", re.I)


def _flags_respuesta(reply: str, turno_idx: int, ctx_cat: bool, ctx_ficha: bool,
                     replies_previas: list[str]) -> list[str]:
    flags = []
    r = reply or ""
    for m in _PAT_NUM_LARGO.finditer(r):
        digits = re.sub(r"\D", "", m.group())
        if digits not in _DATOS_OK and len(digits) >= 9:
            flags.append(f"numero_sospechoso:{digits[:14]}")
    if _PAT_NEQUI.search(r):
        flags.append("nequi_con_numero")
    if _PAT_PROMESA.search(r):
        flags.append("promesa_vacia")
    if turno_idx > 0 and _PAT_SALUDO_INICIAL.search(r):
        flags.append("saludo_en_mitad_de_conversacion")
    if _PAT_ACLARACION_ENLATADA.search(r):
        flags.append("aclaracion_enlatada")
    if _PAT_ERROR_TEC.search(r):
        flags.append("error_tecnico")
    if _PAT_DESPACHO_YA.search(r):
        flags.append("promete_despacho_inmediato")
    if _PAT_AFIRMA_DISP.search(r) and not (ctx_cat or ctx_ficha):
        flags.append("afirma_disponibilidad_sin_contexto")
    if r.strip() and r.strip() in {p.strip() for p in replies_previas}:
        flags.append("respuesta_repetida_identica")
    if r.count("?") + r.count("¿") > 6:
        flags.append("demasiadas_preguntas")
    if len(r) > 1800:
        flags.append("respuesta_muy_larga")
    return flags


def simular_conversacion(idx: int, guion: dict, run_id: str) -> dict:
    uid = f"sim-{run_id}-{idx}"
    turnos_out = []
    replies: list[str] = []
    for t_i, texto in enumerate(guion["turnos"]):
        _tl.ctx_catalogo = False
        _tl.ctx_ficha = False
        t0 = time.time()
        try:
            reply, _ = core.obtener_respuesta_ia(
                texto,
                uid,
                canal="whatsapp",
                contexto_sistema=core.INSTRUCCIONES_FUERA_HORARIO,
            )
        except Exception as e:
            reply = f"[EXCEPCION: {e}]"
        dt = round(time.time() - t0, 1)
        ctx_cat = bool(getattr(_tl, "ctx_catalogo", False))
        ctx_fic = bool(getattr(_tl, "ctx_ficha", False))
        flags = _flags_respuesta(reply, t_i, ctx_cat, ctx_fic, replies)
        if "[EXCEPCION" in reply:
            flags.append("excepcion")
        turnos_out.append(
            {
                "i": t_i,
                "cliente": texto[:300],
                "bot": (reply or "")[:1200],
                "seg": dt,
                "ctx_catalogo": ctx_cat,
                "ctx_ficha": ctx_fic,
                "flags": flags,
            }
        )
        replies.append(reply or "")

    primera = (turnos_out[0]["bot"] if turnos_out else "")
    conv_flags = []
    if not _PAT_TRANSPARENCIA.search(primera):
        conv_flags.append("sin_transparencia_ia_en_apertura")
    if not _PAT_FUERA_HORARIO.search(" ".join(t["bot"] for t in turnos_out[:2])):
        conv_flags.append("sin_mencion_fuera_horario")
    return {
        "conv": idx,
        "jid_origen": guion.get("jid_origen", ""),
        "n_turnos": len(turnos_out),
        "flags_conversacion": conv_flags,
        "turnos": turnos_out,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--guiones", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--max", type=int, default=0)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--desde", type=int, default=0)
    args = ap.parse_args()

    core.configurar_ia(None)
    if not (core.cliente_gemini or core.cliente_ia):
        sys.exit("Sin cliente LLM configurado (GOOGLE_API_KEY / ANTHROPIC_API_KEY)")

    guiones = json.load(open(args.guiones, encoding="utf-8"))[args.desde:]
    if args.max:
        guiones = guiones[: args.max]
    run_id = time.strftime("%H%M%S")

    lock = threading.Lock()
    hechos = [0]

    def _worker(par):
        idx, g = par
        res = simular_conversacion(idx, g, run_id)
        with lock:
            with open(args.out, "a", encoding="utf-8") as f:
                f.write(json.dumps(res, ensure_ascii=False) + "\n")
            hechos[0] += 1
            n_flags = sum(len(t["flags"]) for t in res["turnos"]) + len(res["flags_conversacion"])
            print(
                f"[{hechos[0]}/{len(guiones)}] conv {idx} — {res['n_turnos']} turnos, "
                f"{n_flags} flags",
                flush=True,
            )

    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        list(ex.map(_worker, list(enumerate(guiones, start=args.desde))))

    print(f"OK — resultados en {args.out} | alertas WA bloqueadas: {len(_wa_bloqueados)}")


if __name__ == "__main__":
    main()
