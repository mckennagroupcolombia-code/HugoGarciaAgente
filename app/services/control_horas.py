"""
Control de horas por quincena — dedicación pactada de cada persona (camino A: honorarios).

Acordado el 23-sep-2026: cada quien cobra por prestación de servicios y su pago
cubre un número de horas al valor de mercado de su labor:

    horas pactadas por quincena = (pago mensual ÷ 2) ÷ valor hora de mercado
    valor hora de mercado       = punto medio del rango de mercado llevado a honorarios ÷ 176 h

La persona ve en la Agenda cuánto lleva en la quincena y hoy, y cuánto le falta.
Es autogestión, no control de horario: no hay hora de entrada ni de salida (un
horario fijado por la empresa es subordinación y convierte la prestación de
servicios en contrato laboral).

Horas activas: bloques de 15 minutos con alguna actividad —acciones en el panel,
tareas con cronómetro (menos de 10 h) y, para quien desarrolla, las sesiones de
desarrollo con IA— sin contar dos veces el mismo bloque. Suman además las
explicaciones de tiempo no registrado que administración aprueba (máximo
MAX_EXPLICADAS_SEMANA horas por semana y por persona).

Lo que se pide es completar las horas convenidas, no la rapidez. Lo que se trabaje
después de completarlas son horas adicionales: se reconocen aparte, con su propio valor
(valor hora × (1 + recargo de rrhh_valoracion.json → horas_adicionales)), y es lo que se
cobra en la cuenta de cobro. Lo que falta no se descuenta solo: se ve y se conversa.

Datos: tickets.db (solo lectura), rrhh_valoracion.json (pago y mercado) y
control_horas.json (explicaciones) — los dos últimos fuera de git. Sin LLM.
"""

from __future__ import annotations

import glob
import json
import os
import sqlite3
import threading
import uuid
from datetime import date, datetime, timedelta

from app.services import tickets_db

_DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
_RUTA = os.path.join(_DATA, "control_horas.json")
_CACHE_IA = os.path.join(_DATA, "sesiones_ia_cache.json")
_lock = threading.Lock()

JORNADA_MES = 176
BLOQUE_MIN = 15
MAX_TAREA_H = 10
HUECO_IA_S = 45 * 60
MAX_EXPLICADAS_SEMANA = float(os.getenv("CONTROL_HORAS_MAX_EXPLICADAS_SEMANA", "6") or 6)
_BOGOTA = timedelta(hours=-5)
_BASE = datetime(2026, 1, 1)


# ─── Quincenas ───────────────────────────────────────────────────────────────

def quincena_de(d: date) -> tuple[date, date, str]:
    """(inicio, fin exclusivo, clave AAAA-MM-Q1/Q2) de la quincena que contiene `d`."""
    if d.day <= 15:
        return date(d.year, d.month, 1), date(d.year, d.month, 16), f"{d:%Y-%m}-Q1"
    sig = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    return date(d.year, d.month, 16), sig, f"{d:%Y-%m}-Q2"


def quincena_por_clave(clave: str) -> tuple[date, date, str]:
    try:
        anio, mes, q = clave.split("-")
        d = date(int(anio), int(mes), 1 if q.upper() == "Q1" else 16)
    except (ValueError, AttributeError) as e:
        raise ValueError("Quincena inválida: use AAAA-MM-Q1 o AAAA-MM-Q2") from e
    return quincena_de(d)


def dias_habiles(desde: date, hasta: date) -> int:
    n, d = 0, desde
    while d < hasta:
        n += d.weekday() < 5
        d += timedelta(days=1)
    return n


# ─── Horas activas ───────────────────────────────────────────────────────────

def _slot(t: datetime) -> int:
    return int((t - _BASE).total_seconds() // (BLOQUE_MIN * 60))


def _dt(s: str) -> datetime:
    return datetime.fromisoformat(str(s).replace("Z", "").split(".")[0])


def _sesiones_ia_dirs() -> dict[str, str]:
    """RENDIMIENTO_SESIONES_IA='armando=/ruta/proyecto,…': carpetas de sesiones de Claude Code por usuario."""
    out = {}
    for par in (os.getenv("RENDIMIENTO_SESIONES_IA", "") or "").split(","):
        if "=" in par:
            u, ruta = par.split("=", 1)
            out[u.strip().lower()] = ruta.strip()
    return out


def _instantes_ia(carpeta: str) -> list[datetime]:
    """Instrucciones humanas en las sesiones de desarrollo (hora de Bogotá). Cachea por archivo."""
    with _lock:
        try:
            with open(_CACHE_IA, encoding="utf-8") as fh:
                cache = json.load(fh)
        except (FileNotFoundError, json.JSONDecodeError):
            cache = {}
    cambiado = False
    for f in glob.glob(os.path.join(carpeta, "*.jsonl")):
        try:
            st = os.stat(f)
        except OSError:
            continue
        firma = f"{st.st_mtime_ns}:{st.st_size}"
        if cache.get(f, {}).get("firma") == firma:
            continue
        ts: list[str] = []
        with open(f, errors="ignore") as fh:
            for line in fh:
                if '"type":"user"' not in line:
                    continue
                try:
                    o = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if o.get("type") != "user" or o.get("isSidechain") or o.get("isMeta"):
                    continue
                c = (o.get("message") or {}).get("content")
                if isinstance(c, list):
                    if any(isinstance(x, dict) and x.get("type") == "tool_result" for x in c):
                        continue
                    txt = " ".join(x.get("text", "") for x in c if isinstance(x, dict))
                else:
                    txt = str(c or "")
                cab = txt.lstrip()[:300]
                if not txt.strip() or (cab.startswith("<") and any(k in cab for k in ("command-name", "local-command", "system-reminder", "task-notification"))):
                    continue
                if o.get("timestamp"):
                    ts.append(o["timestamp"])
        cache[f] = {"firma": firma, "ts": ts}
        cambiado = True
    if cambiado:
        with _lock:
            tmp = _CACHE_IA + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(cache, fh)
            os.replace(tmp, _CACHE_IA)
    out = []
    for f, v in cache.items():
        if f.startswith(carpeta):
            for t in v.get("ts", []):
                out.append(datetime.fromisoformat(t.replace("Z", "+00:00")).replace(tzinfo=None) + _BOGOTA)
    return sorted(out)


def bloques_activos(usuario_id: int, username: str, desde: datetime, hasta: datetime) -> set[int]:
    """Bloques de 15 min con actividad entre dos instantes en hora de Bogotá."""
    u_desde, u_hasta = desde - _BOGOTA, hasta - _BOGOTA
    f = lambda d: d.strftime("%Y-%m-%d %H:%M:%S")  # noqa: E731
    lo, hi = _slot(desde), _slot(hasta)
    sl: set[int] = set()
    c = sqlite3.connect(f"file:{tickets_db.DB_PATH}?mode=ro", uri=True, timeout=10)
    try:
        for (t,) in c.execute("SELECT creado_en FROM panel_eventos_operativos WHERE usuario_id=? AND creado_en>=? AND creado_en<?",
                              (usuario_id, f(u_desde), f(u_hasta))):
            sl.add(_slot(_dt(t) + _BOGOTA))
        for a, b in c.execute(
            """SELECT iniciada_en, finalizada_en FROM ticket_corridas WHERE usuario_id=? AND finalizada_en IS NOT NULL
               AND finalizada_en>=? AND iniciada_en<?""", (usuario_id, f(u_desde), f(u_hasta))):
            ia, ib = _dt(a), _dt(b)
            if 0 <= (ib - ia).total_seconds() < MAX_TAREA_H * 3600:
                # el bloque donde termina solo cuenta si terminó dentro de él (10:00 exacto no abre el bloque de 10:00)
                sl.update(range(_slot(ia + _BOGOTA), _slot(ib + _BOGOTA - timedelta(seconds=1)) + 1))
    finally:
        c.close()
    carpeta = _sesiones_ia_dirs().get((username or "").lower())
    if carpeta:
        pr = [t for t in _instantes_ia(carpeta) if desde - timedelta(hours=1) <= t < hasta]
        for i, t in enumerate(pr):
            sl.add(_slot(t))
            if i + 1 < len(pr) and (pr[i + 1] - t).total_seconds() <= HUECO_IA_S:
                sl.update(range(_slot(t), _slot(pr[i + 1]) + 1))
    return {s for s in sl if lo <= s < hi}


# ─── Explicaciones de tiempo no registrado ──────────────────────────────────

def _cargar() -> dict:
    with _lock:
        try:
            with open(_RUTA, encoding="utf-8") as fh:
                return json.load(fh)
        except (FileNotFoundError, json.JSONDecodeError):
            return {"explicaciones": []}


def _guardar(d: dict) -> None:
    with _lock:
        os.makedirs(_DATA, exist_ok=True)
        tmp = _RUTA + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(d, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, _RUTA)


def explicaciones(usuario_id: int | None = None, estado: str | None = None) -> list[dict]:
    xs = _cargar()["explicaciones"]
    return [x for x in xs if (usuario_id is None or x["usuario_id"] == usuario_id) and (estado is None or x["estado"] == estado)]


def explicar(usuario_id: int, fecha: str, horas: float, descripcion: str) -> dict:
    """La persona cuenta qué hizo en un tiempo que el panel no registró. Queda pendiente de aprobación."""
    try:
        d = date.fromisoformat(fecha)
    except ValueError as e:
        raise ValueError("Fecha inválida") from e
    hoy = (datetime.utcnow() + _BOGOTA).date()
    if d > hoy or d < hoy - timedelta(days=20):
        raise ValueError("Solo se puede explicar tiempo de los últimos 20 días.")
    h = float(horas or 0)
    if not 0.25 <= h <= 8:
        raise ValueError("Las horas van de 0,25 a 8 por explicación.")
    txt = (descripcion or "").strip()
    if len(txt) < 10:
        raise ValueError("Cuente con un poco más de detalle qué hizo (mínimo 10 letras).")
    lunes = d - timedelta(days=d.weekday())
    semana = sum(x["horas"] for x in explicaciones(usuario_id) if x["estado"] != "rechazada"
                 and lunes <= date.fromisoformat(x["fecha"]) < lunes + timedelta(days=7))
    if semana + h > MAX_EXPLICADAS_SEMANA:
        raise ValueError(f"Máximo {MAX_EXPLICADAS_SEMANA:g} horas explicadas por semana; esta semana ya van {semana:g}.")
    x = {"id": uuid.uuid4().hex[:10], "usuario_id": int(usuario_id), "fecha": d.isoformat(), "horas": h,
         "descripcion": txt[:500], "estado": "pendiente", "creado": datetime.now().isoformat(timespec="seconds"),
         "revisado_por": "", "revisado": ""}
    datos = _cargar()
    datos["explicaciones"].append(x)
    _guardar(datos)
    return x


def revisar(explicacion_id: str, aprobar: bool, revisor: str) -> dict:
    datos = _cargar()
    for x in datos["explicaciones"]:
        if x["id"] == explicacion_id:
            if x["estado"] != "pendiente":
                raise ValueError("Esa explicación ya fue revisada.")
            x.update(estado="aprobada" if aprobar else "rechazada", revisado_por=revisor[:80],
                     revisado=datetime.now().isoformat(timespec="seconds"))
            _guardar(datos)
            return x
    raise ValueError("No existe")


# ─── Estado por persona ─────────────────────────────────────────────────────

def _pactado(usuario_id: int) -> dict | None:
    from app.services import mapa_funciones as MF

    pc = MF.cargar()["personas"].get(str(usuario_id)) or {}
    mk, pago = pc.get("mercado") or {}, float(pc.get("pago_hoy") or 0)
    if not pago or not mk.get("max"):
        return None
    valor_hora = (MF.honorario_equivalente(mk["min"]) + MF.honorario_equivalente(mk["max"])) / 2 / JORNADA_MES
    extra = MF.cargar().get("horas_adicionales") or {}
    recargo = float(extra.get("recargo_pct") or 0)
    return {"pago_mes": pago, "valor_hora": round(valor_hora), "horas_quincena": round(pago / 2 / valor_hora, 1),
            "valor_hora_adicional": round(valor_hora * (1 + recargo / 100)), "recargo_pct": recargo,
            "requieren_aprobacion": bool(extra.get("requieren_aprobacion", True))}


def estado(usuario_id: int, *, quincena: str | None = None, ahora: datetime | None = None, con_dinero: bool = False) -> dict:
    ahora = ahora or (datetime.utcnow() + _BOGOTA)
    with sqlite3.connect(f"file:{tickets_db.DB_PATH}?mode=ro", uri=True, timeout=10) as c:
        fila = c.execute("SELECT id, nombre, username FROM usuarios WHERE id=?", (int(usuario_id),)).fetchone()
    if not fila:
        raise ValueError("Usuario no encontrado")
    uid, nombre, username = fila
    ini, fin, clave = quincena_por_clave(quincena) if quincena else quincena_de(ahora.date())
    corte = min(ahora, datetime.combine(fin, datetime.min.time()))
    bloques = bloques_activos(uid, username, datetime.combine(ini, datetime.min.time()), corte)
    h_activas = len(bloques) * BLOQUE_MIN / 60
    expl = [x for x in explicaciones(uid) if ini <= date.fromisoformat(x["fecha"]) < fin]
    h_expl = sum(x["horas"] for x in expl if x["estado"] == "aprobada")
    total = h_activas + h_expl
    p = _pactado(uid)
    habiles = dias_habiles(ini, fin)
    from app.services.tiempos_estandar import horas_ganadas

    ganadas = horas_ganadas(uid, datetime.combine(ini, datetime.min.time()), corte)
    res = {
        "usuario": {"id": uid, "nombre": nombre, "username": username},
        "quincena": {"clave": clave, "desde": ini.isoformat(), "hasta": (fin - timedelta(days=1)).isoformat(),
                     "dias_habiles": habiles, "dias_habiles_pasados": dias_habiles(ini, min(ahora.date(), fin))},
        "horas_activas": round(h_activas, 1), "horas_explicadas": round(h_expl, 1), "horas": round(total, 1),
        "explicaciones": sorted(expl, key=lambda x: x["fecha"], reverse=True),
        "ganadas": ganadas,
        "max_explicadas_semana": MAX_EXPLICADAS_SEMANA,
    }
    if p:
        meta_dia = p["horas_quincena"] / habiles if habiles else 0
        hoy_ini = datetime.combine(ahora.date(), datetime.min.time())
        h_hoy = sum(1 for s in bloques if s >= _slot(hoy_ini)) * BLOQUE_MIN / 60 if ini <= ahora.date() < fin else 0
        esperado = meta_dia * res["quincena"]["dias_habiles_pasados"]
        # Registro día por día de la quincena, hasta hoy
        dias = []
        d = ini
        while d < fin and d <= ahora.date():
            a, b = _slot(datetime.combine(d, datetime.min.time())), _slot(datetime.combine(d + timedelta(days=1), datetime.min.time()))
            h_dia = sum(1 for s_ in bloques if a <= s_ < b) * BLOQUE_MIN / 60
            h_dia += sum(x["horas"] for x in expl if x["estado"] == "aprobada" and x["fecha"] == d.isoformat())
            meta = round(meta_dia, 2) if d.weekday() < 5 else 0
            dias.append({"fecha": d.isoformat(), "dia_semana": d.weekday(), "horas": round(h_dia, 2), "meta": meta,
                         "diferencia": round(h_dia - meta, 2), "hoy": d == ahora.date()})
            d += timedelta(days=1)
        res["dias"] = dias
        pasados = [x for x in dias if x["meta"] > 0 and not x["hoy"]]
        res["promedio"] = {
            "dias_habiles": len(pasados),
            "horas_dia_habil": round(sum(x["horas"] for x in pasados) / len(pasados), 2) if pasados else None,
            "cubre_por_dia": round(meta_dia, 2),
            "dias_completos": sum(1 for x in pasados if x["diferencia"] >= -0.05),
            "horas_fin_de_semana": round(sum(x["horas"] for x in dias if x["meta"] == 0), 2),
        }
        res.update({
            "pactadas": p["horas_quincena"], "faltan": round(max(0.0, p["horas_quincena"] - total), 1),
            "de_mas": round(max(0.0, total - p["horas_quincena"]), 1),
            "al_dia": round(total - esperado, 1),
            "hoy": {"horas": round(h_hoy, 2), "meta": round(meta_dia, 2) if ahora.weekday() < 5 else 0,
                    "faltan": round(max(0.0, meta_dia - h_hoy), 2) if ahora.weekday() < 5 else 0},
        })
        res["regla"] = {"requieren_aprobacion": p["requieren_aprobacion"]}
        if con_dinero:
            res["valor_hora"] = p["valor_hora"]
            res["valor_hora_adicional"] = p["valor_hora_adicional"]
            res["recargo_pct"] = p["recargo_pct"]
            res["valor_de_mas"] = round(res["de_mas"] * p["valor_hora_adicional"])
            res["valor_faltante"] = round(res["faltan"] * p["valor_hora"])
    return res


def cuenta_de_cobro(usuario_id: int, quincena: str) -> dict:
    """Horas trabajadas por encima de lo pactado en una quincena y su valor: base de la cuenta de cobro."""
    e = estado(usuario_id, quincena=quincena, con_dinero=True)
    if "pactadas" not in e:
        raise ValueError("Falta el pago o el rango de mercado de esta persona (RRHH → Mapa de funciones).")
    hoy = (datetime.utcnow() + _BOGOTA).date()
    cerrada = date.fromisoformat(e["quincena"]["hasta"]) < hoy
    return {"usuario": e["usuario"], "quincena": e["quincena"], "horas": e["horas"], "pactadas": e["pactadas"],
            "horas_de_mas": e["de_mas"], "valor_hora": e["valor_hora_adicional"], "recargo_pct": e["recargo_pct"],
            "valor": e["valor_de_mas"], "cerrada": cerrada,
            "concepto": (f"Honorarios por {e['de_mas']:g} horas adicionales de asesoría técnica en la quincena "
                         f"{e['quincena']['desde']} a {e['quincena']['hasta']}, a ${e['valor_hora_adicional']:,.0f} la hora").replace(",", ".")}
