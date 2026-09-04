"""
Métricas de atención y ventas — Agente WhatsApp.

Analiza wa_chats.db: tiempos de respuesta (humano/bot), embudo comercial,
calificaciones y recomendaciones en lenguaje claro.
"""

from __future__ import annotations

import os
import re
import sqlite3
import statistics
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

_CO = timezone(timedelta(hours=-5))
_DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
_DB = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "wa_chats.db")
_SESSION_GAP_SEG = 4 * 3600

_SLA_BUCKETS = [
    ("<5 min", 0, 5, "excelente"),
    ("5–15 min", 5, 15, "bueno"),
    ("15–30 min", 15, 30, "aceptable"),
    ("30–60 min", 30, 60, "lento"),
    ("1–4 h", 60, 240, "muy_lento"),
    (">4 h", 240, None, "critico"),
]

_CRITERIOS_TIEMPO = [
    {
        "id": "excelente",
        "label": "Excelente",
        "max_min": 5,
        "color": "emerald",
        "significado": "El cliente casi no espera. Ideal en horario laboral.",
    },
    {
        "id": "bueno",
        "label": "Bueno",
        "max_min": 15,
        "color": "sky",
        "significado": "Respuesta ágil; el cliente percibe atención oportuna.",
    },
    {
        "id": "aceptable",
        "label": "Aceptable",
        "max_min": 30,
        "color": "amber",
        "significado": "Dentro de lo tolerable, pero conviene acelerar.",
    },
    {
        "id": "lento",
        "label": "Lento",
        "max_min": 60,
        "color": "orange",
        "significado": "El cliente esperó demasiado; riesgo de perder la venta.",
    },
    {
        "id": "critico",
        "label": "Crítico",
        "max_min": None,
        "color": "red",
        "significado": "Más de 1 hora (o 4 h en cola). Revisar urgente.",
    },
]

_GLOSARIO = [
    {
        "termino": "Tiempo de espera del cliente",
        "explicacion": "Reloj que arranca cuando el cliente escribe y se detiene cuando llega la primera respuesta (bot o humano). Es lo que el cliente siente.",
    },
    {
        "termino": "Mediana de respuesta",
        "explicacion": "Tiempo «típico» de espera: la mitad de los clientes esperó menos y la otra mitad más. No se distorsiona por un caso extremo.",
    },
    {
        "termino": "Primera respuesta humana",
        "explicacion": "Minutos desde que el cliente escribe hasta que un asesor responde. Si Hugo (bot) contestó antes, aquí se mide cuánto tardó además el humano.",
    },
    {
        "termino": "Primera respuesta del equipo",
        "explicacion": "Minutos hasta la primera salida de Hugo o del asesor. Mide si el cliente queda atendido rápido aunque sea por el bot.",
    },
    {
        "termino": "Hueco sin respuesta",
        "explicacion": "El cliente escribió y nadie (ni bot ni humano) respondió en más de 60 minutos. Alta probabilidad de perder la venta.",
    },
    {
        "termino": "Conversión a venta (52% no es «de todos»)",
        "explicacion": "Es ventas cerradas ÷ chats con intención explícita de compra. No es el % de todos los WhatsApp que llegaron.",
    },
    {
        "termino": "Tiempo laboral ajustado",
        "explicacion": "Solo suma minutos dentro de lun–vie 08:00–18:00. Un mensaje a las 17:50 respondido a las 08:10 del día siguiente ≈ 20 min laborales, no 14 h.",
    },
    {
        "termino": "Embudo de venta",
        "explicacion": "Etapas detectadas en el chat: consulta → intención de compra → comprobante → pago confirmado → envío/guía.",
    },
    {
        "termino": "Conversión",
        "explicacion": "Chats que llegaron a pago confirmado o envío, dividido entre chats con intención clara de comprar.",
    },
    {
        "termino": "Calificación",
        "explicacion": "Nota 0–100 combinando velocidad, atención oportuna, cierre comercial y (para el bot) autonomía.",
    },
]

_RUIDO = frozenset(
    {
        "[adjunto]", ".", "ok", "si", "sí", "no", "bueno", "listo",
        "gracias", "muchas gracias", "hola", "buenas", "buenos días",
        "buenas tardes", "buenas noches", "buen día", "buen dia", "👍", "🙏",
    }
)

_PAT_CONSULTA = re.compile(
    r"\b(precio|precios|cu[aá]nto|cuesta|cotiz|disponib|stock|tienen|"
    r"producto|presentaci[oó]n|kilogramo|gramos|informaci[oó]n|ficha|"
    r"env[ií]o|demora|catalogo|cat[aá]logo)\b",
    re.I,
)
_PAT_INTENCION = re.compile(
    r"\b(comprar|pedido|transferencia|nequi|bancolombia|datos de pago|"
    r"medios de pago|link de pago|pagar[eé]|realic[eé] el pago|"
    r"hacer el pedido|confirmo pedido|cuenta para|consignar|qr)\b",
    re.I,
)
_PAT_COMPROBANTE = re.compile(
    r"(comprobante|transferencia realizada|ya pagu[eé]|pago hecho|"
    r"adjunto comprobante|soporte de pago|"
    r"ya hice (la )?transferencia|ya realic[eé] (el )?pago|"
    r"hice (el )?pago|env[ií][eo] (el )?soporte|"
    r"realic[eé] la transferencia|pago realizado|ya consign[eé]|"
    r"te mando el comprobante|le mando el soporte)",
    re.I,
)
_PAT_PAGO_OK = re.compile(
    r"(confirmamos su pago|confirmamos tu pago|pago confirmado|"
    r"pago recibido|pago validado|compra confirmada|"
    r"ya queda (confirmado|registrado|listo el pedido)|"
    r"queda (confirmado|registrado|procesado) (el pago|su pedido|tu pedido)|"
    r"se registra(ron)? (el|su) pago|"
    r"(el )?pago (fue|ha sido|est[aá]) (recibido|confirmado|registrado|validado)|"
    r"pedido (confirmado|registrado|procesado)|"
    r"factura (generada|registrada|enviada|lista)|"
    r"compra procesada|le confirmamos|su pedido est[aá] listo)",
    re.I,
)
_PAT_ENVIO = re.compile(
    r"(gu[ií]a|interrapid[ií]simo|rastreo|tracking|despachad|"
    r"en camino|n[uú]mero de env[ií]o|env[ií]o registrado|"
    r"comprobante.*inter\.la|n[uú]mero de seguimiento|"
    r"ya (fue|lo|le) (enviado|despachado)|ya sali[oó] el paquete|"
    r"despacho listo|enviamos (por|con)|se env[ií]a (hoy|ma[nñ]ana))",
    re.I,
)


def _norm(texto: str) -> str:
    return re.sub(r"\s+", " ", (texto or "").strip().lower())


def _es_consulta_real(texto: str) -> bool:
    t = (texto or "").strip()
    if not t or _norm(t) in _RUIDO:
        return False
    if len(t) < 4:
        return False
    return bool(_PAT_CONSULTA.search(t)) or len(t) >= 12


def _clasificar_tiempo(minutos: float | None) -> dict[str, Any]:
    if minutos is None:
        return {"id": "sin_dato", "label": "Sin dato", "color": "gray"}
    for c in _CRITERIOS_TIEMPO:
        mx = c["max_min"]
        if mx is None or minutos <= mx:
            return {"id": c["id"], "label": c["label"], "color": c["color"]}
    return {"id": "critico", "label": "Crítico", "color": "red"}


def _minutos_laborales(ts_ini: float, ts_fin: float) -> float:
    """Minutos hábiles lun–vie 08:00–18:00 entre dos timestamps."""
    if ts_fin <= ts_ini:
        return 0.0
    ini = datetime.fromtimestamp(ts_ini, tz=_CO)
    fin = datetime.fromtimestamp(ts_fin, tz=_CO)
    total = 0.0
    cursor = ini
    while cursor < fin:
        if cursor.isoweekday() <= 5:
            day_start = cursor.replace(hour=8, minute=0, second=0, microsecond=0)
            day_end = cursor.replace(hour=18, minute=0, second=0, microsecond=0)
            seg_ini = max(cursor, day_start)
            seg_fin = min(fin, day_end)
            if seg_fin > seg_ini:
                total += (seg_fin - seg_ini).total_seconds() / 60
        cursor = (cursor + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return round(total, 1)


def _percentil(vals: list[float], p: float) -> float | None:
    if not vals:
        return None
    s = sorted(vals)
    return round(s[min(len(s) - 1, max(0, int(len(s) * p)))], 1)


def _score_velocidad(mediana_min: float | None) -> int:
    if mediana_min is None:
        return 0
    if mediana_min <= 5:
        return 100
    if mediana_min <= 10:
        return 90
    if mediana_min <= 15:
        return 78
    if mediana_min <= 30:
        return 62
    if mediana_min <= 60:
        return 45
    if mediana_min <= 120:
        return 28
    return 12


def _score_pct(pct: float, objetivo: float) -> int:
    if objetivo <= 0:
        return 0
    return max(0, min(100, int(round(100 * pct / objetivo))))


def _cargar_mensajes(desde_ts: float | None = None) -> list[dict[str, Any]]:
    if not os.path.isfile(_DB):
        return []
    conn = sqlite3.connect(_DB)
    conn.row_factory = sqlite3.Row
    cols = {r[1] for r in conn.execute("PRAGMA table_info(mensajes)")}
    media_col = "tiene_media" if "tiene_media" in cols else "0 AS tiene_media"
    sql = f"""
        SELECT jid, ts, direccion, enviado_por, texto, {media_col}
        FROM mensajes
        WHERE eliminado=0 AND jid NOT LIKE '%@g.us'
    """
    try:
        if desde_ts is not None:
            rows = conn.execute(sql + " AND ts >= ? ORDER BY jid, ts", (desde_ts,)).fetchall()
        else:
            rows = conn.execute(sql + " ORDER BY jid, ts").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def _sesiones_por_jid(mensajes: list[dict[str, Any]]) -> dict[str, list[list[dict[str, Any]]]]:
    by_jid: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for m in mensajes:
        by_jid[m["jid"]].append(m)
    out: dict[str, list[list[dict[str, Any]]]] = {}
    for jid, msgs in by_jid.items():
        sesiones: list[list[dict[str, Any]]] = []
        actual: list[dict[str, Any]] = []
        for m in msgs:
            if actual and float(m["ts"]) - float(actual[-1]["ts"]) > _SESSION_GAP_SEG:
                sesiones.append(actual)
                actual = []
            actual.append(m)
        if actual:
            sesiones.append(actual)
        out[jid] = sesiones
    return out


def _medir_tiempos(mensajes: list[dict[str, Any]]) -> dict[str, Any]:
    sesiones_map = _sesiones_por_jid(mensajes)
    primera_humana: list[dict[str, Any]] = []
    primera_equipo: list[dict[str, Any]] = []
    seguimiento_humano: list[dict[str, Any]] = []
    humano_ya_activo = False

    for jid, sesiones in sesiones_map.items():
        for ses in sesiones:
            humano_activo = False
            for i, m in enumerate(ses):
                if m["direccion"] != "entrada" or m["enviado_por"] != "cliente":
                    continue
                if not _es_consulta_real(m.get("texto") or ""):
                    continue
                dt_cli = datetime.fromtimestamp(m["ts"], tz=_CO)
                base = {
                    "jid": jid,
                    "pregunta": (m.get("texto") or "")[:100],
                    "fecha_cli": dt_cli.strftime("%Y-%m-%d %H:%M"),
                    "hora_cli": dt_cli.hour,
                    "bh": dt_cli.isoweekday() <= 5 and 8 <= dt_cli.hour < 18,
                }
                vio_equipo = vio_humano = False
                for j in range(i + 1, len(ses)):
                    n = ses[j]
                    if n["direccion"] != "salida":
                        continue
                    delta = float(n["ts"]) - float(m["ts"])
                    if delta < 5:
                        continue
                    if delta > 86400:
                        break
                    env = n["enviado_por"]
                    if env == "humano":
                        humano_activo = True
                    if not vio_equipo:
                        vio_equipo = True
                        primera_equipo.append(
                            {
                                **base,
                                "delta_min": round(delta / 60, 1),
                                "delta_laboral_min": _minutos_laborales(m["ts"], n["ts"]),
                                "respondio": env,
                            }
                        )
                    if env == "humano" and not vio_humano:
                        vio_humano = True
                        primera_humana.append(
                            {
                                **base,
                                "delta_min": round(delta / 60, 1),
                                "delta_laboral_min": _minutos_laborales(m["ts"], n["ts"]),
                            }
                        )
                    if humano_activo and env == "humano" and vio_humano and j > i + 1:
                        seguimiento_humano.append(
                            {
                                **base,
                                "delta_min": round(delta / 60, 1),
                            }
                        )
                        break
                if humano_activo:
                    humano_ya_activo = True

    def _resumen(pares: list[dict[str, Any]], campo: str = "delta_min") -> dict[str, Any]:
        vals = [p[campo] for p in pares if p.get(campo) is not None]
        if not vals:
            return {"n": 0, "mediana_min": None, "media_min": None, "p90_min": None, "sla_15_pct": 0}
        return {
            "n": len(vals),
            "mediana_min": round(statistics.median(vals), 1),
            "media_min": round(statistics.mean(vals), 1),
            "p90_min": _percentil(vals, 0.9),
            "sla_15_pct": round(100 * sum(1 for v in vals if v <= 15) / len(vals), 1),
            "sla_60_pct": round(100 * sum(1 for v in vals if v <= 60) / len(vals), 1),
            "calificacion": _clasificar_tiempo(statistics.median(vals)),
        }

    bh = [p for p in primera_humana if p.get("bh")]
    bh_vals = [p["delta_min"] for p in bh]
    return {
        "primera_respuesta_humana": _resumen(primera_humana),
        "primera_respuesta_equipo": _resumen(primera_equipo),
        "tiempo_laboral_humano": _resumen(primera_humana, "delta_laboral_min"),
        "seguimiento_humano": _resumen(seguimiento_humano),
        "pares_primera_humana": sorted(primera_humana, key=lambda x: -x["delta_min"])[:10],
        "sla_humana": _sla_distribucion(primera_humana),
        "sla_equipo": _sla_distribucion(primera_equipo),
    }


def _sla_distribucion(pairs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts = {label: 0 for label, _, _, _ in _SLA_BUCKETS}
    for p in pairs:
        m = p.get("delta_min", 0)
        for label, lo, hi, _ in _SLA_BUCKETS:
            if hi is None:
                if m >= lo:
                    counts[label] += 1
                    break
            elif lo <= m < hi:
                counts[label] += 1
                break
    total = len(pairs) or 1
    out = []
    for label, lo, hi, grado in _SLA_BUCKETS:
        crit = next(c for c in _CRITERIOS_TIEMPO if c["id"] == grado or (grado == "muy_lento" and c["id"] == "lento"))
        out.append(
            {
                "label": label,
                "count": counts[label],
                "pct": round(100 * counts[label] / total, 1),
                "grado": grado,
                "grado_label": crit["label"],
                "significado": crit["significado"],
            }
        )
    return out


def _analizar_embudo(mensajes: list[dict[str, Any]]) -> dict[str, Any]:
    by_jid: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for m in mensajes:
        by_jid[m["jid"]].append(m)

    etapas_orden = [
        "contacto",
        "consulta",
        "intencion_compra",
        "comprobante",
        "pago_confirmado",
        "envio",
    ]
    conteo_etapas = {e: 0 for e in etapas_orden}
    chats_detalle: list[dict[str, Any]] = []
    ventas = 0
    intencion = 0
    solo_consulta = 0
    abandonados = 0
    en_proceso = 0

    for jid, msgs in by_jid.items():
        if not any(m["direccion"] == "entrada" for m in msgs):
            continue
        etapas: set[str] = {"contacto"}
        tuvo_intencion = False
        for m in msgs:
            texto = m.get("texto") or ""
            t = _norm(texto)
            if m["direccion"] == "entrada" and m["enviado_por"] == "cliente":
                if _es_consulta_real(texto) or _PAT_CONSULTA.search(t):
                    etapas.add("consulta")
                if _PAT_INTENCION.search(t):
                    etapas.add("intencion_compra")
                    tuvo_intencion = True
                if _PAT_COMPROBANTE.search(t):
                    etapas.add("comprobante")
                elif m.get("tiene_media") and (
                    tuvo_intencion
                    or _PAT_INTENCION.search(t)
                    or _PAT_COMPROBANTE.search(t)
                ):
                    etapas.add("comprobante")
            elif m["direccion"] == "salida":
                if _PAT_PAGO_OK.search(t):
                    etapas.add("pago_confirmado")
                if _PAT_ENVIO.search(t):
                    etapas.add("envio")

        for e in etapas:
            conteo_etapas[e] += 1

        venta_cerrada = "pago_confirmado" in etapas or (
            "envio" in etapas and "comprobante" in etapas
        )
        if venta_cerrada:
            resultado = "venta_cerrada"
            ventas += 1
        elif "comprobante" in etapas or ("intencion_compra" in etapas and "consulta" in etapas):
            if any(m["direccion"] == "entrada" for m in msgs[-3:]):
                resultado = "en_proceso"
                en_proceso += 1
            else:
                resultado = "abandonado"
                abandonados += 1
        elif tuvo_intencion:
            resultado = "abandonado"
            abandonados += 1
        elif "consulta" in etapas:
            resultado = "solo_consulta"
            solo_consulta += 1
        else:
            resultado = "contacto_sin_conversion"
            solo_consulta += 1

        if tuvo_intencion:
            intencion += 1

        max_etapa = etapas_orden[max(etapas_orden.index(e) for e in etapas if e in etapas)]
        ultimo = msgs[-1]
        chats_detalle.append(
            {
                "jid": jid,
                "etapa_max": max_etapa,
                "resultado": resultado,
                "etapas": [e for e in etapas_orden if e in etapas],
                "ultimo_texto": (ultimo.get("texto") or "")[:80],
                "ultimo_ts": datetime.fromtimestamp(ultimo["ts"], tz=_CO).strftime("%Y-%m-%d %H:%M"),
            }
        )

    chats_total = len(chats_detalle) or 1
    funnel = []
    prev = chats_total
    for e in etapas_orden:
        n = conteo_etapas[e]
        funnel.append(
            {
                "etapa": e,
                "label": {
                    "contacto": "Contacto",
                    "consulta": "Consulta",
                    "intencion_compra": "Intención de compra",
                    "comprobante": "Comprobante",
                    "pago_confirmado": "Pago confirmado",
                    "envio": "Envío / guía",
                }[e],
                "chats": n,
                "pct_del_total": round(100 * n / chats_total, 1),
                "pct_del_anterior": round(100 * n / prev, 1) if prev else 0,
            }
        )
        if n > 0:
            prev = n

    tasa_intencion = round(100 * ventas / intencion, 1) if intencion else 0
    tasa_total = round(100 * ventas / chats_total, 1)

    return {
        "embudo": funnel,
        "resumen": {
            "chats_analizados": chats_total,
            "con_intencion_compra": intencion,
            "ventas_cerradas": ventas,
            "solo_consulta": solo_consulta,
            "abandonados": abandonados,
            "en_proceso": en_proceso,
            "tasa_conversion_intencion_pct": tasa_intencion,
            "tasa_conversion_total_pct": tasa_total,
            "conversion_explicacion": {
                "titulo": "Conversión de intenciones de compra",
                "formula": "ventas_cerradas ÷ con_intencion_compra × 100",
                "numerador": ventas,
                "denominador": intencion,
                "resultado_pct": tasa_intencion,
                "texto": (
                    f"{ventas} ventas cerradas de {intencion} chats donde el cliente "
                    f"pidió comprar, pagar o datos de pago (= {tasa_intencion}%). "
                    f"Sobre todos los chats ({chats_total}) la tasa es {tasa_total}%."
                ),
                "venta_significa": (
                    "Mensaje de pago confirmado en el chat, o envío/guía después de comprobante."
                ),
            },
        },
        "resultado_por_chat": {
            c["jid"]: c["resultado"] for c in chats_detalle
        },
        "sin_venta": solo_consulta + abandonados,
        "chats_muestra": sorted(
            chats_detalle,
            key=lambda x: (
                0 if x["resultado"] == "venta_cerrada" else 1,
                -len(x["etapas"]),
            ),
        )[:20],
    }


def _calificar_equipo(
    tiempos: dict[str, Any],
    embudo: dict[str, Any],
    mensajes: list[dict[str, Any]],
) -> dict[str, Any]:
    hum_res = tiempos["primera_respuesta_humana"]
    eq_res = tiempos["primera_respuesta_equipo"]
    emb = embudo["resumen"]

    med_h = hum_res.get("mediana_min")
    score_h_vel = _score_velocidad(med_h)
    score_h_atencion = _score_pct(hum_res.get("sla_15_pct", 0), 55)
    score_h_conv = _score_pct(emb.get("tasa_conversion_intencion_pct", 0), 35)
    cierre_base = emb.get("ventas_cerradas", 0)
    comp = embudo["embudo"][3]["chats"] if len(embudo["embudo"]) > 3 else 0
    score_h_cierre = _score_pct(
        100 * cierre_base / comp if comp else (100 if cierre_base else 0),
        70,
    )
    nota_humano = int(
        round(
            score_h_vel * 0.35
            + score_h_atencion * 0.25
            + score_h_conv * 0.25
            + score_h_cierre * 0.15
        )
    )

    bot_msgs = sum(
        1 for m in mensajes if m["direccion"] == "salida" and m["enviado_por"] == "bot"
    )
    hum_msgs = sum(
        1 for m in mensajes if m["direccion"] == "salida" and m["enviado_por"] == "humano"
    )
    chats = len({m["jid"] for m in mensajes})
    chats_solo_bot = 0
    chats_con_humano = 0
    by_jid: dict[str, set[str]] = defaultdict(set)
    for m in mensajes:
        if m["direccion"] == "salida":
            by_jid[m["jid"]].add(m["enviado_por"])
    for envios in by_jid.values():
        if "humano" in envios:
            chats_con_humano += 1
        elif "bot" in envios:
            chats_solo_bot += 1

    eq_med = eq_res.get("mediana_min")
    score_b_vel = 100 if eq_med is not None and eq_med <= 2 else _score_velocidad(eq_med)
    autonomia = round(100 * chats_solo_bot / chats, 1) if chats else 0
    score_b_auto = _score_pct(autonomia, 40)
    participacion = round(100 * bot_msgs / (bot_msgs + hum_msgs or 1), 1)
    score_b_cob = min(100, int(participacion * 1.2))

    nota_bot = int(round(score_b_vel * 0.35 + score_b_auto * 0.35 + score_b_cob * 0.30))

    def _nivel(n: int) -> dict[str, str]:
        if n >= 85:
            return {"label": "Sobresaliente", "color": "emerald"}
        if n >= 70:
            return {"label": "Bueno", "color": "sky"}
        if n >= 50:
            return {"label": "Regular", "color": "amber"}
        return {"label": "Mejorable", "color": "red"}

    return {
        "humano": {
            "nota": nota_humano,
            "nivel": _nivel(nota_humano),
            "componentes": [
                {"nombre": "Velocidad humana", "peso_pct": 35, "nota": score_h_vel, "detalle": f"Mediana {fmt_min(med_h)}"},
                {"nombre": "Atención ≤15 min", "peso_pct": 25, "nota": score_h_atencion, "detalle": f"{hum_res.get('sla_15_pct', 0)}% en meta (≥55%)"},
                {"nombre": "Conversión a venta", "peso_pct": 25, "nota": score_h_conv, "detalle": f"{emb.get('tasa_conversion_intencion_pct', 0)}% de intenciones cierran"},
                {"nombre": "Cierre post-comprobante", "peso_pct": 15, "nota": score_h_cierre, "detalle": "Pago/envío tras comprobante"},
            ],
        },
        "bot": {
            "nota": nota_bot,
            "nivel": _nivel(nota_bot),
            "componentes": [
                {"nombre": "Rapidez primera respuesta", "peso_pct": 35, "nota": score_b_vel, "detalle": f"Mediana equipo {fmt_min(eq_med)}"},
                {"nombre": "Autonomía (chats sin humano)", "peso_pct": 35, "nota": score_b_auto, "detalle": f"{autonomia}% chats solo bot"},
                {"nombre": "Participación en salidas", "peso_pct": 30, "nota": score_b_cob, "detalle": f"{participacion}% mensajes salientes"},
            ],
            "chats_solo_bot": chats_solo_bot,
            "chats_con_humano": chats_con_humano,
        },
    }


def fmt_min(minutos: float | None) -> str:
    if minutos is None:
        return "—"
    if minutos < 60:
        return f"{minutos:.0f} min" if minutos >= 10 else f"{minutos:.1f} min"
    h = int(minutos // 60)
    m = int(round(minutos % 60))
    return f"{h}h {m}m" if m else f"{h}h"


def _cola_pendiente(mensajes: list[dict[str, Any]], umbral_min: float = 30) -> list[dict[str, Any]]:
    by_jid: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for m in mensajes:
        by_jid[m["jid"]].append(m)
    ahora = datetime.now(tz=_CO).timestamp()
    pendientes = []
    for jid, msgs in by_jid.items():
        ultimo = msgs[-1]
        if ultimo["direccion"] != "entrada":
            continue
        espera = (ahora - float(ultimo["ts"])) / 60
        if espera < umbral_min:
            continue
        pendientes.append(
            {
                "jid": jid,
                "espera_min": round(espera, 0),
                "texto": (ultimo.get("texto") or "")[:100] or "[sin texto]",
                "desde": datetime.fromtimestamp(ultimo["ts"], tz=_CO).strftime("%Y-%m-%d %H:%M"),
            }
        )
    pendientes.sort(key=lambda x: -x["espera_min"])
    return pendientes[:12]


def _actividad_horaria(mensajes: list[dict[str, Any]]) -> dict[str, Any]:
    """Respuestas del equipo por hora (no cuándo escribe el cliente)."""
    by_h: dict[int, dict[str, int]] = defaultdict(lambda: {"humano": 0, "bot": 0})
    for m in mensajes:
        if m["direccion"] != "salida":
            continue
        h = datetime.fromtimestamp(m["ts"], tz=_CO).hour
        key = "humano" if m["enviado_por"] == "humano" else "bot" if m["enviado_por"] == "bot" else "otro"
        if key in by_h[h]:
            by_h[h][key] += 1
    max_h = max((v["humano"] + v["bot"] for v in by_h.values()), default=1)
    filas = []
    for h in range(24):
        v = by_h[h]
        total = v["humano"] + v["bot"]
        filas.append(
            {
                "hora": h,
                "humano": v["humano"],
                "bot": v["bot"],
                "total": total,
                "intensidad_pct": round(100 * total / max_h, 0) if max_h else 0,
            }
        )
    return {
        "titulo": "Cuándo responde el equipo",
        "nota": (
            "Cuenta mensajes salientes del asesor o Hugo por hora del día. "
            "No indica a qué hora escriben los clientes; para eso use «Cuándo escriben los clientes»."
        ),
        "filas": filas,
    }


def _actividad_horaria_cliente(mensajes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_h: dict[int, int] = defaultdict(int)
    for m in mensajes:
        if m["direccion"] != "entrada" or m["enviado_por"] != "cliente":
            continue
        if not _es_consulta_real(m.get("texto") or ""):
            continue
        h = datetime.fromtimestamp(m["ts"], tz=_CO).hour
        by_h[h] += 1
    max_h = max(by_h.values(), default=1)
    return [
        {
            "hora": h,
            "consultas": by_h[h],
            "intensidad_pct": round(100 * by_h[h] / max_h, 0) if max_h else 0,
        }
        for h in range(24)
    ]


def _bucket_espera(minutos: float | None) -> str:
    if minutos is None:
        return "Sin respuesta"
    if minutos <= 5:
        return "≤5 min"
    if minutos <= 15:
        return "5–15 min"
    if minutos <= 60:
        return "15–60 min"
    return ">60 min"


def _interpret_correlacion(label: str, n: int, ventas: int) -> str:
    if n == 0:
        return "Sin intenciones de compra en este rango de espera."
    pct = round(100 * ventas / n, 0)
    if label == "≤5 min":
        return f"{ventas} de {n} intenciones cerraron ({pct}%). Respuesta rápida del equipo."
    if label == "Sin respuesta":
        return f"{ventas} de {n} intenciones sin respuesta del equipo ({pct}%). Hueco crítico."
    if label == ">60 min":
        return f"Solo {ventas} de {n} cerraron ({pct}%) tras más de 1 h de espera."
    return f"{ventas} de {n} intenciones cerraron ({pct}%) con espera {label.lower()}."


def _medir_atencion_cliente(
    mensajes: list[dict[str, Any]],
    embudo: dict[str, Any],
) -> dict[str, Any]:
    sesiones_map = _sesiones_por_jid(mensajes)
    resultado_por_chat = embudo.get("resultado_por_chat", {})
    consultas_equipo: list[float] = []
    consultas_humano: list[float] = []
    sin_respuesta = 0
    bot_primero = 0
    total_consultas = 0
    huecos: list[dict[str, Any]] = []
    ejemplos: list[dict[str, Any]] = []
    intencion_espera: list[dict[str, Any]] = []

    for jid, sesiones in sesiones_map.items():
        first_intencion_msg: dict[str, Any] | None = None
        all_msgs = [m for ses in sesiones for m in ses]

        for ses in sesiones:
            for i, m in enumerate(ses):
                if m["direccion"] != "entrada" or m["enviado_por"] != "cliente":
                    continue
                texto = m.get("texto") or ""
                if not _es_consulta_real(texto):
                    continue

                # Solo turnos donde el cliente espera respuesta: inicio de sesión o tras salida del equipo
                prev = ses[i - 1] if i > 0 else None
                if prev and not (prev["direccion"] == "salida"):
                    continue

                total_consultas += 1
                if _PAT_INTENCION.search(_norm(texto)) and first_intencion_msg is None:
                    first_intencion_msg = m

                equipo_ts = hum_ts = None
                equipo_quien = None
                for j in range(i + 1, len(ses)):
                    n = ses[j]
                    if n["direccion"] != "salida":
                        continue
                    delta = float(n["ts"]) - float(m["ts"])
                    if delta < 5:
                        continue
                    if delta > 86400:
                        break
                    if equipo_ts is None:
                        equipo_ts = float(n["ts"])
                        equipo_quien = n["enviado_por"]
                    if n["enviado_por"] == "humano" and hum_ts is None:
                        hum_ts = float(n["ts"])
                    if equipo_ts and hum_ts:
                        break

                espera_eq = round((equipo_ts - float(m["ts"])) / 60, 1) if equipo_ts else None
                espera_hum = round((hum_ts - float(m["ts"])) / 60, 1) if hum_ts else None

                if espera_eq is not None:
                    consultas_equipo.append(espera_eq)
                    if equipo_quien == "bot":
                        bot_primero += 1
                else:
                    sin_respuesta += 1

                if espera_hum is not None:
                    consultas_humano.append(espera_hum)

                if espera_eq is None or espera_eq > 60:
                    huecos.append(
                        {
                            "jid": jid,
                            "cliente_escribio": datetime.fromtimestamp(m["ts"], tz=_CO).strftime(
                                "%Y-%m-%d %H:%M"
                            ),
                            "espera_min": espera_eq,
                            "texto": texto[:80],
                            "convirtio": resultado_por_chat.get(jid) == "venta_cerrada",
                        }
                    )

                if len(ejemplos) < 12:
                    dt_cli = datetime.fromtimestamp(m["ts"], tz=_CO).strftime("%H:%M")
                    eq_str = (
                        f"{datetime.fromtimestamp(equipo_ts, tz=_CO).strftime('%H:%M')} ({equipo_quien})"
                        if equipo_ts
                        else "—"
                    )
                    hum_str = (
                        datetime.fromtimestamp(hum_ts, tz=_CO).strftime("%H:%M") if hum_ts else "—"
                    )
                    ejemplos.append(
                        {
                            "cliente": dt_cli,
                            "equipo": eq_str,
                            "humano": hum_str,
                            "espera_equipo_min": espera_eq,
                            "resultado": resultado_por_chat.get(jid, "—"),
                            "pregunta": texto[:60],
                        }
                    )

        if first_intencion_msg:
            ts_int = float(first_intencion_msg["ts"])
            espera_int = None
            for m in all_msgs:
                if float(m["ts"]) < ts_int:
                    continue
                if m["direccion"] == "salida":
                    delta = float(m["ts"]) - ts_int
                    if delta >= 5:
                        espera_int = round(delta / 60, 1)
                        break
            resultado = resultado_por_chat.get(jid, "contacto_sin_conversion")
            intencion_espera.append(
                {
                    "jid": jid,
                    "espera_min": espera_int,
                    "bucket": _bucket_espera(espera_int),
                    "convirtio": resultado == "venta_cerrada",
                    "resultado": resultado,
                }
            )

    correlacion = []
    for label in ["≤5 min", "5–15 min", "15–60 min", ">60 min", "Sin respuesta"]:
        subset = [x for x in intencion_espera if x["bucket"] == label]
        n = len(subset)
        ventas = sum(1 for x in subset if x["convirtio"])
        correlacion.append(
            {
                "rango": label,
                "chats_intencion": n,
                "ventas": ventas,
                "conversion_pct": round(100 * ventas / n, 1) if n else 0,
                "interpretacion": _interpret_correlacion(label, n, ventas),
            }
        )

    med_eq = round(statistics.median(consultas_equipo), 1) if consultas_equipo else None
    med_hum = round(statistics.median(consultas_humano), 1) if consultas_humano else None
    huecos_graves = [h for h in huecos if h.get("espera_min") is None or (h["espera_min"] or 0) > 60]

    return {
        "explicacion": (
            "Medimos turnos de consulta: cuando el cliente escribe y espera respuesta "
            "(inicio de conversación o tras un mensaje del equipo). "
            "«Espera equipo» = hasta la primera respuesta (Hugo o asesor). "
            "«Espera humano» = hasta que interviene el asesor."
        ),
        "resumen": {
            "consultas_medidas": total_consultas,
            "mediana_espera_equipo_min": med_eq,
            "mediana_espera_humano_min": med_hum,
            "bot_respondio_primero_pct": round(100 * bot_primero / len(consultas_equipo), 1)
            if consultas_equipo
            else 0,
            "sin_respuesta_pct": round(100 * sin_respuesta / total_consultas, 1) if total_consultas else 0,
            "huecos_mas_60min": len(huecos_graves),
        },
        "correlacion_intencion_espera": correlacion,
        "huecos": sorted(
            huecos,
            key=lambda x: (x.get("espera_min") is None, -(x.get("espera_min") or 9999)),
        )[:10],
        "ejemplos_timeline": sorted(
            ejemplos,
            key=lambda x: (x.get("espera_equipo_min") is None, x.get("espera_equipo_min") or 999),
        )[:8],
        "actividad_cliente_hora": _actividad_horaria_cliente(mensajes),
    }


def _recomendaciones(
    tiempos: dict[str, Any],
    embudo: dict[str, Any],
    pendientes: list[dict[str, Any]],
    calificacion: dict[str, Any],
    atencion: dict[str, Any] | None = None,
) -> list[dict[str, str]]:
    atencion = atencion or {}
    recs: list[dict[str, str]] = []
    hum = tiempos["primera_respuesta_humana"]
    emb = embudo["resumen"]

    if atencion.get("resumen", {}).get("huecos_mas_60min", 0) > 0:
        n_h = atencion["resumen"]["huecos_mas_60min"]
        recs.insert(
            0,
            {
                "prioridad": "alta",
                "texto": (
                    f"{n_h} consulta(s) quedaron más de 60 min sin respuesta del equipo. "
                    "Revise la pestaña Atención: ahí se correlaciona espera vs conversión."
                ),
            },
        )
    if pendientes:
        recs.append(
            {
                "prioridad": "alta",
                "texto": f"Hay {len(pendientes)} chat(s) esperando más de 30 min. Atienda primero el más antiguo ({fmt_min(pendientes[0]['espera_min'])}).",
            }
        )
    med = hum.get("mediana_min")
    if med and med > 15:
        recs.append(
            {
                "prioridad": "alta",
                "texto": f"Su mediana humana es {fmt_min(med)} (meta ≤10 min). Bloquee 15 min al inicio del turno para pendientes.",
            }
        )
    if emb.get("tasa_conversion_intencion_pct", 0) < 25 and emb.get("con_intencion_compra", 0) >= 3:
        recs.append(
            {
                "prioridad": "media",
                "texto": "Muchas intenciones de compra no cierran. Tras comprobante, confirme pago y envío el mismo día.",
            }
        )
    if emb.get("abandonados", 0) > emb.get("ventas_cerradas", 0):
        recs.append(
            {
                "prioridad": "media",
                "texto": "Hay más conversaciones abandonadas que ventas cerradas. Use seguimiento proactivo a las 24–48 h.",
            }
        )
    if calificacion["bot"]["nota"] < 50:
        recs.append(
            {
                "prioridad": "media",
                "texto": "Hugo (bot) participa poco. Verifique que esté habilitado en Control y responda consultas de catálogo.",
            }
        )
    if not recs:
        recs.append(
            {
                "prioridad": "baja",
                "texto": "Mantenga mediana ≤10 min y convierta al menos 1 de cada 3 intenciones de compra.",
            }
        )
    return recs[:6]


def calcular_metricas(dias: int = 30) -> dict[str, Any]:
    dias = max(0, min(int(dias), 365))
    ahora = datetime.now(tz=_CO)
    desde_ts = (ahora - timedelta(days=dias)).timestamp() if dias > 0 else None

    mensajes = _cargar_mensajes(desde_ts)
    tiempos = _medir_tiempos(mensajes)
    embudo = _analizar_embudo(mensajes)
    atencion = _medir_atencion_cliente(mensajes, embudo)
    calificacion = _calificar_equipo(tiempos, embudo, mensajes)
    pendientes = _cola_pendiente(mensajes)
    recomendaciones = _recomendaciones(tiempos, embudo, pendientes, calificacion, atencion)

    ts_vals = [m["ts"] for m in mensajes]
    if ts_vals:
        rango_desde = datetime.fromtimestamp(min(ts_vals), tz=_CO).date().isoformat()
        rango_hasta = datetime.fromtimestamp(max(ts_vals), tz=_CO).date().isoformat()
    else:
        rango_desde = rango_hasta = ahora.date().isoformat()

    cli = sum(1 for m in mensajes if m["direccion"] == "entrada" and m["enviado_por"] == "cliente")
    hum = sum(1 for m in mensajes if m["direccion"] == "salida" and m["enviado_por"] == "humano")
    bot = sum(1 for m in mensajes if m["direccion"] == "salida" and m["enviado_por"] == "bot")

    hum_res = tiempos["primera_respuesta_humana"]
    eq_res = tiempos["primera_respuesta_equipo"]

    return {
        "generado_en": ahora.strftime("%Y-%m-%dT%H:%M:%S"),
        "zona_horaria": "Colombia (UTC−5)",
        "periodo": {"dias": dias, "desde": rango_desde, "hasta": rango_hasta},
        "glosario": _GLOSARIO,
        "criterios_tiempo": _CRITERIOS_TIEMPO,
        "objetivos": {
            "mediana_humana_min": 10,
            "sla_15_pct": 55,
            "sla_60_pct": 85,
            "conversion_intencion_pct": 35,
        },
        "resumen": {
            "mensajes_cliente": cli,
            "respuestas_humano": hum,
            "respuestas_bot": bot,
            "chats_unicos": len({m["jid"] for m in mensajes}),
            "mediana_humana_min": hum_res.get("mediana_min"),
            "mediana_equipo_min": eq_res.get("mediana_min"),
            "mediana_laboral_min": tiempos["tiempo_laboral_humano"].get("mediana_min"),
            "calificacion_humana": hum_res.get("calificacion"),
            "nota_humano": calificacion["humano"]["nota"],
            "nota_bot": calificacion["bot"]["nota"],
        },
        "tiempos": tiempos,
        "atencion_cliente": atencion,
        "ventas": embudo,
        "calificacion": calificacion,
        "actividad_horaria": _actividad_horaria(mensajes),
        "cola_pendiente": pendientes,
        "recomendaciones": recomendaciones,
        "nota_metodologia": (
            "Las etapas comerciales se infieren del texto del chat (palabras clave de pago, comprobante, guía). "
            "No reemplaza Alegra ni pedidos web; mejora con más historial sincronizado."
        ),
    }
