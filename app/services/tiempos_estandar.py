"""
Tiempos estándar y horas ganadas — medir lo que se produjo, no solo el tiempo presente.

Tiempo estándar de una función = mediana de lo que tardó el equipo cada vez que la
hizo con cronómetro (últimos DIAS_BASE días, entre 1 minuto y 10 horas, al menos
MIN_MUESTRAS veces). Si la tarea registró una cantidad (resultado_cantidad: und o kg),
el estándar se calcula también por unidad.

Horas a tiempo estándar de una persona = cada ejecución cerrada de una tarea × el
estándar MEDIDO de su función. Un ticket resuelto sin cronómetro no usa estándar: toma el
tiempo de su huella real (minutos desde la acción anterior de la persona en el panel,
máximo 30), porque muchos se cierran en tandas de segundos
(× la cantidad, si la registró), tenga cronómetro o no. Así una tarea resuelta sin
abrir el cronómetro también cuenta, y quien trabaja más rápido que el estándar gana
más horas de las que registra.

Por qué (23-sep-2026): con honorarios conviene pagar por lo entregado y no por el
tiempo presente; y la mitad de las tareas resueltas no tenía cronómetro. Sin LLM.
"""

from __future__ import annotations

import sqlite3
import statistics
import threading
import time
from collections import defaultdict
from datetime import datetime, timedelta

from app.services import rendimiento as R
from app.services import tickets_db

DIAS_BASE = 90
MIN_MUESTRAS = 5
MIN_S, MAX_S = 60, 10 * 3600
# Sin tiempos «estimados» a mano: el 23-sep-2026 un estimado de 15 min por nota crédito convirtió 85
# expedientes que Jenniffer cerró en tandas (mediana de 36 s entre uno y otro, ≈2 h reales) en 21,5 h.
# Una tarea sin estándar medido toma el tiempo de su huella real (ver _huella_minutos).
MAX_HUELLA_MIN = 30
_BOGOTA = timedelta(hours=-5)
_cache: dict = {"t": 0.0, "v": None}
_lock = threading.Lock()


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(f"file:{tickets_db.DB_PATH}?mode=ro", uri=True, timeout=10)
    c.row_factory = sqlite3.Row
    return c


def _dt(s: str) -> datetime:
    return datetime.fromisoformat(str(s).replace("Z", "").split(".")[0])


def estandares(*, ahora: datetime | None = None, usar_cache: bool = True) -> dict[str, dict]:
    """{función: {minutos, muestras, minutos_por_unidad, unidad, muestras_unidad, origen}}."""
    with _lock:
        if usar_cache and ahora is None and _cache["v"] is not None and time.time() - _cache["t"] < 600:
            return _cache["v"]
    ahora = ahora or datetime.utcnow()
    desde = (ahora - timedelta(days=DIAS_BASE)).strftime("%Y-%m-%d %H:%M:%S")
    por_vez: dict[str, list[float]] = defaultdict(list)
    por_unidad: dict[tuple[str, str], list[float]] = defaultdict(list)
    with _conn() as c:
        filas = c.execute(
            """SELECT t.id, t.titulo, t.resultado_cantidad, t.resultado_unidad, c.iniciada_en, c.finalizada_en
               FROM ticket_corridas c JOIN tickets t ON t.id = c.ticket_id
               WHERE c.finalizada_en IS NOT NULL AND c.iniciada_en >= ?""", (desde,)).fetchall()
    duracion: dict[int, float] = defaultdict(float)
    info: dict[int, sqlite3.Row] = {}
    for r in filas:
        s = (_dt(r["finalizada_en"]) - _dt(r["iniciada_en"])).total_seconds()
        if MIN_S <= s <= MAX_S:
            duracion[r["id"]] += s
            info[r["id"]] = r
    for tid, s in duracion.items():
        r = info[tid]
        f = R.clasificar(r["titulo"])
        if not f or s > MAX_S:
            continue
        por_vez[f].append(s / 60)
        cant = r["resultado_cantidad"]
        if cant and cant > 0 and r["resultado_unidad"]:
            por_unidad[(f, r["resultado_unidad"])].append(s / 60 / float(cant))
    out: dict[str, dict] = {}
    for f, xs in por_vez.items():
        if len(xs) >= MIN_MUESTRAS:
            out[f] = {"minutos": round(statistics.median(xs), 1), "muestras": len(xs), "origen": "cronómetro"}
    for (f, u), xs in por_unidad.items():
        if len(xs) >= MIN_MUESTRAS:
            out.setdefault(f, {"minutos": None, "muestras": 0, "origen": "cronómetro"})
            out[f].update(minutos_por_unidad=round(statistics.median(xs), 2), unidad=u, muestras_unidad=len(xs))
    with _lock:
        if ahora is None or usar_cache:
            _cache.update(t=time.time(), v=out)
    return out


def _huella_minutos(conn: sqlite3.Connection, usuario_id: int, cuando: str) -> float:
    """Minutos desde la acción anterior de la persona en el panel (eventos, cambios de tareas,
    comentarios), con tope MAX_HUELLA_MIN. Es el tiempo que la tarea pudo tomar como máximo."""
    prev = conn.execute(
        """SELECT MAX(t) FROM (
             SELECT MAX(creado_en) t FROM panel_eventos_operativos WHERE usuario_id=? AND creado_en<? AND tipo<>'sesion_inicio'
             UNION ALL SELECT MAX(creado_en) FROM logs_auditoria WHERE usuario_id=? AND creado_en<?
           )""", (usuario_id, cuando, usuario_id, cuando)).fetchone()[0]
    if not prev:
        return 0.0
    return max(0.0, min((_dt(cuando) - _dt(prev)).total_seconds() / 60, MAX_HUELLA_MIN))


def horas_ganadas(usuario_id: int, desde_local: datetime, hasta_local: datetime, *, est: dict | None = None) -> dict:
    """Ejecuciones cerradas × estándar medido, más tickets sin cronómetro por su huella real."""
    est = est if est is not None else estandares()
    f = lambda d: (d - _BOGOTA).strftime("%Y-%m-%d %H:%M:%S")  # noqa: E731
    por: dict[str, dict] = {}
    sin_estandar = 0
    with _conn() as c:
        # Ejecuciones cerradas con cronómetro: cuentan una vez cada una, a tiempo estándar (medido).
        corridas = c.execute(
            """SELECT t.titulo, t.resultado_cantidad, t.resultado_unidad FROM ticket_corridas c
               JOIN tickets t ON t.id = c.ticket_id
               WHERE c.usuario_id=? AND c.finalizada_en IS NOT NULL AND c.finalizada_en>=? AND c.finalizada_en<?""",
            (int(usuario_id), f(desde_local), f(hasta_local))).fetchall()
        # Tickets resueltos sin cronómetro: su tiempo sale de la huella real, no de un estándar.
        sueltos = c.execute(
            """SELECT titulo, resuelto_en FROM tickets
               WHERE asignado_a=? AND estado='resuelto' AND resuelto_en>=? AND resuelto_en<?
                 AND id NOT IN (SELECT ticket_id FROM ticket_corridas WHERE finalizada_en IS NOT NULL)""",
            (int(usuario_id), f(desde_local), f(hasta_local))).fetchall()
        huellas = [(r["titulo"], _huella_minutos(c, int(usuario_id), r["resuelto_en"])) for r in sueltos]

    def sumar(fid: str, minutos: float, origen: str, e: dict | None) -> None:
        nombre = R._POR_ID[fid][1] if fid in R._POR_ID else fid
        d = por.setdefault(fid, {"id": fid, "funcion": nombre, "veces": 0, "minutos": 0.0, "veces_huella": 0,
                                 "estandar_min": (e or {}).get("minutos"), "estandar_por_unidad": (e or {}).get("minutos_por_unidad"),
                                 "unidad": (e or {}).get("unidad")})
        d["veces"] += 1
        d["minutos"] += minutos
        if origen == "huella":
            d["veces_huella"] += 1

    for r in corridas:
        fid = R.clasificar(r["titulo"])
        e = est.get(fid or "")
        if not fid or not e:
            sin_estandar += 1
            continue
        cant = r["resultado_cantidad"]
        if cant and cant > 0 and e.get("minutos_por_unidad") and r["resultado_unidad"] == e.get("unidad"):
            sumar(fid, float(cant) * e["minutos_por_unidad"], "estandar", e)
        elif e.get("minutos"):
            sumar(fid, e["minutos"], "estandar", e)
        else:
            sin_estandar += 1
    for titulo, minutos in huellas:
        fid = R.clasificar(titulo)
        if not fid:
            sin_estandar += 1
            continue
        sumar(fid, minutos, "huella", est.get(fid))
    filas = corridas + sueltos
    filas_out = sorted(por.values(), key=lambda x: -x["minutos"])
    for d in filas_out:
        d["horas"] = round(d.pop("minutos") / 60, 2)
    return {"horas": round(sum(d["horas"] for d in filas_out), 1), "funciones": filas_out,
            "tareas_resueltas": len(filas), "sin_estandar": sin_estandar}
