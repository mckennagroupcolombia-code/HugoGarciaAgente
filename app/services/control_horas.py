"""
Control de horas por quincena — dedicación pactada de cada persona (camino A: honorarios).

Acordado el 23-sep-2026: cada quien cobra por prestación de servicios y su pago
cubre un número de horas al valor de mercado de su labor:

    horas pactadas por quincena = (pago mensual ÷ 2) ÷ valor hora de mercado
    valor hora de mercado       = punto medio del rango de mercado llevado a honorarios ÷ 159 h

159 h = lo que trabaja de verdad al mes un empleado de tiempo completo con la jornada de 42 h
(Ley 2101: 42 × 52 = 2.184 h al año, menos 18-19 festivos entre semana y 15 días hábiles de
vacaciones ≈ 1.907 h → 159 al mes). NO es el divisor legal de 210: ese incluye los domingos
pagados y sirve para el valor de la hora ordinaria de un empleado, no para horas trabajadas.
Los festivos (festivos_co.py) no son días hábiles: no tienen meta.

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
después de completarlas son horas adicionales, al MISMO valor hora (son honorarios, no horas
extra laborales: no llevan recargo), y es lo que se cobra en la cuenta de cobro. Lo que falta
no se descuenta solo: se ve y se conversa.

Quien atiende las colectas de Mercado Libre (persona con `colectas: true` en
rrhh_valoracion.json) debe estar disponible de lunes a viernes: no es un horario de entrada y
salida, es la disponibilidad que el servicio exige. Por eso a esas personas no se les dice que
repongan horas «cualquier día»: se completan dentro de la semana.

Datos: tickets.db (solo lectura), rrhh_valoracion.json (pago y mercado) y
control_horas.json (explicaciones) — los dos últimos fuera de git. Sin LLM.
"""

from __future__ import annotations

import glob
from collections import Counter
import json
import os
import sqlite3
import threading
import uuid
from datetime import date, datetime, timedelta

from app.services import tickets_db
from app.services.festivos_co import es_habil

_DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
_RUTA = os.path.join(_DATA, "control_horas.json")
_CACHE_IA = os.path.join(_DATA, "sesiones_ia_cache.json")
_lock = threading.Lock()

JORNADA_MES = 159  # horas efectivas al mes con 42 h/semana (ver docstring)
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
        n += es_habil(d)
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


# Paneles que no son trabajo: abrirlos no cuenta como actividad (Juegos es «un rato de descanso»).
PANELES_DESCANSO = frozenset({"juegos"})


def _fuentes(usuario_id: int, username: str, desde: datetime, hasta: datetime) -> dict[int, dict]:
    """Qué hizo que cada bloque de 15 min cuente: {bloque: {"tareas": [corrida…], "paneles": Counter, "ia": bool}}.

    Es la única fuente de verdad de las horas activas: el total y el detalle por día salen de aquí."""
    u_desde, u_hasta = desde - _BOGOTA, hasta - _BOGOTA
    f = lambda d: d.strftime("%Y-%m-%d %H:%M:%S")  # noqa: E731
    lo, hi = _slot(desde), _slot(hasta)
    out: dict[int, dict] = {}

    def celda(s: int) -> dict:
        return out.setdefault(s, {"tareas": [], "paneles": Counter(), "ia": False})

    c = sqlite3.connect(f"file:{tickets_db.DB_PATH}?mode=ro", uri=True, timeout=10)
    try:
        for t, panel in c.execute(
                "SELECT creado_en, panel FROM panel_eventos_operativos WHERE usuario_id=? AND creado_en>=? AND creado_en<?",
                (usuario_id, f(u_desde), f(u_hasta))):
            if (panel or "") in PANELES_DESCANSO:
                continue
            celda(_slot(_dt(t) + _BOGOTA))["paneles"][panel or ""] += 1
        for cid, a, b, titulo, cant, unidad in c.execute(
            """SELECT c.id, c.iniciada_en, c.finalizada_en, t.titulo, t.resultado_cantidad, t.resultado_unidad
               FROM ticket_corridas c LEFT JOIN tickets t ON t.id = c.ticket_id
               WHERE c.usuario_id=? AND c.finalizada_en IS NOT NULL AND c.finalizada_en>=? AND c.iniciada_en<?""",
                (usuario_id, f(u_desde), f(u_hasta))):
            ia, ib = _dt(a), _dt(b)
            if 0 <= (ib - ia).total_seconds() < MAX_TAREA_H * 3600:
                info = {"id": cid, "titulo": titulo or "Tarea", "desde": ia + _BOGOTA, "hasta": ib + _BOGOTA,
                        "resultado": {"cantidad": cant, "unidad": unidad} if cant else None}
                # el bloque donde termina solo cuenta si terminó dentro de él (10:00 exacto no abre el bloque de 10:00)
                for s in range(_slot(ia + _BOGOTA), _slot(ib + _BOGOTA - timedelta(seconds=1)) + 1):
                    celda(s)["tareas"].append(info)
    finally:
        c.close()
    carpeta = _sesiones_ia_dirs().get((username or "").lower())
    if carpeta:
        pr = [t for t in _instantes_ia(carpeta) if desde - timedelta(hours=1) <= t < hasta]
        for i, t in enumerate(pr):
            celda(_slot(t))["ia"] = True
            if i + 1 < len(pr) and (pr[i + 1] - t).total_seconds() <= HUECO_IA_S:
                for s in range(_slot(t), _slot(pr[i + 1]) + 1):
                    celda(s)["ia"] = True
    return {s: v for s, v in out.items() if lo <= s < hi}


def bloques_activos(usuario_id: int, username: str, desde: datetime, hasta: datetime) -> set[int]:
    """Bloques de 15 min con actividad entre dos instantes en hora de Bogotá."""
    return set(_fuentes(usuario_id, username, desde, hasta))


def _hora(s: int) -> str:
    t = _BASE + timedelta(minutes=s * BLOQUE_MIN)
    return t.strftime("%H:%M")


def detalle_dia(usuario_id: int, fecha: str) -> dict:
    """Cómo se contaron las horas de un día: tramos con qué se hizo y cómo se midió, pausas y lo que quedó hecho."""
    d = date.fromisoformat(fecha)
    with sqlite3.connect(f"file:{tickets_db.DB_PATH}?mode=ro", uri=True, timeout=10) as c:
        fila = c.execute("SELECT id, username FROM usuarios WHERE id=?", (int(usuario_id),)).fetchone()
        if not fila:
            raise ValueError("Usuario no encontrado")
        ini_u = datetime.combine(d, datetime.min.time()) - _BOGOTA
        hechas = [
            {"titulo": t, "hora": (_dt(r) + _BOGOTA).strftime("%H:%M"),
             "resultado": {"cantidad": q, "unidad": u} if q else None}
            for t, r, q, u in c.execute(
                """SELECT titulo, resuelto_en, resultado_cantidad, resultado_unidad FROM tickets
                   WHERE asignado_a=? AND estado='resuelto' AND resuelto_en>=? AND resuelto_en<? ORDER BY resuelto_en""",
                (fila[0], ini_u.strftime("%Y-%m-%d %H:%M:%S"), (ini_u + timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")))
        ]
    desde = datetime.combine(d, datetime.min.time())
    fu = _fuentes(fila[0], fila[1], desde, desde + timedelta(days=1))

    def clave(v: dict) -> tuple:
        if v["tareas"]:
            t = max(v["tareas"], key=lambda x: x["desde"])  # si se cruzan dos tareas, la más reciente
            return ("tarea", t["id"])
        if v["ia"]:
            return ("desarrollo", "")
        return ("panel", v["paneles"].most_common(1)[0][0] if v["paneles"] else "")

    tramos: list[dict] = []
    for s in sorted(fu):
        k = clave(fu[s])
        ult = tramos[-1] if tramos else None
        if ult and ult["_k"] == k and ult["_fin"] == s:
            ult["_fin"] = s + 1
            ult["acciones"] += sum(fu[s]["paneles"].values())
            continue
        if ult and s > ult["_fin"]:
            tramos.append({"tipo": "pausa", "desde": _hora(ult["_fin"]), "hasta": _hora(s),
                           "horas": round((s - ult["_fin"]) * BLOQUE_MIN / 60, 2), "_k": None, "_fin": s})
        t = {"tipo": k[0], "_k": k, "_ini": s, "_fin": s + 1, "acciones": sum(fu[s]["paneles"].values())}
        if k[0] == "tarea":
            info = next(x for x in fu[s]["tareas"] if x["id"] == k[1])
            t.update(titulo=info["titulo"], resultado=info["resultado"],
                     cronometro=f"{info['desde']:%H:%M}–{info['hasta']:%H:%M}")
        elif k[0] == "panel":
            t["panel"] = k[1]
        tramos.append(t)
    for t in tramos:
        if t["tipo"] != "pausa":
            t.update(desde=_hora(t["_ini"]), hasta=_hora(t["_fin"]), horas=round((t["_fin"] - t["_ini"]) * BLOQUE_MIN / 60, 2))
            t.pop("_ini", None)
        t.pop("_k", None)
        t.pop("_fin", None)
    expl = [x for x in explicaciones(fila[0]) if x["fecha"] == fecha]
    activas = len(fu) * BLOQUE_MIN / 60
    return {
        "fecha": fecha, "dia_semana": d.weekday(), "habil": es_habil(d),
        "horas_activas": round(activas, 2),
        "horas_explicadas": round(sum(x["horas"] for x in expl if x["estado"] == "aprobada"), 2),
        "horas": round(activas + sum(x["horas"] for x in expl if x["estado"] == "aprobada"), 2),
        "tramos": tramos, "hechas": hechas, "explicaciones": expl,
        "bloque_min": BLOQUE_MIN,
    }


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
    # Honorarios, no horas extra laborales: la hora adicional vale lo mismo que la acordada.
    return {"pago_mes": pago, "valor_hora": round(valor_hora), "horas_quincena": round(pago / 2 / valor_hora, 1),
            "valor_hora_adicional": round(valor_hora), "colectas": bool(pc.get("colectas")),
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
            meta = round(meta_dia, 2) if es_habil(d) else 0
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
            "hoy": {"horas": round(h_hoy, 2), "meta": round(meta_dia, 2) if es_habil(ahora.date()) else 0,
                    "faltan": round(max(0.0, meta_dia - h_hoy), 2) if es_habil(ahora.date()) else 0},
        })
        res["regla"] = {"requieren_aprobacion": p["requieren_aprobacion"], "colectas": p["colectas"]}
        if con_dinero:
            res["valor_hora"] = p["valor_hora"]
            res["valor_hora_adicional"] = p["valor_hora_adicional"]
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
            "horas_de_mas": e["de_mas"], "valor_hora": e["valor_hora_adicional"],
            "valor": e["valor_de_mas"], "cerrada": cerrada,
            "concepto": (f"Honorarios por {e['de_mas']:g} horas adicionales de asesoría técnica en la quincena "
                         f"{e['quincena']['desde']} a {e['quincena']['hasta']}, a ${e['valor_hora_adicional']:,.0f} la hora").replace(",", ".")}


# ─── Resumen semanal por WhatsApp ───────────────────────────────────────────
# Cada viernes, un mensaje corto a cada persona: cómo le fue en la semana y cómo va la
# quincena. Mismo tono que «Mi quincena»: usted, en positivo, sin hablar de pago, y
# recordando que lo importante es completar las horas acordadas, no la rapidez.

_DIA_TXT = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]


def _hm(h: float) -> str:
    t = round(h * 60)
    hh, mm = divmod(t, 60)
    if not hh:
        return f"{mm} min"
    return f"{hh} h {mm} min" if mm else f"{hh} h"


def _fecha_txt(d: date) -> str:
    meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
    return f"{d.day} de {meses[d.month - 1]}"


def dias_de_la_semana(usuario_id: int, ahora: datetime) -> list[dict]:
    """Días de lunes a hoy, aunque la semana cruce dos quincenas."""
    lunes = ahora.date() - timedelta(days=ahora.weekday())
    claves = {quincena_de(lunes)[2], quincena_de(ahora.date())[2]}
    dias: list[dict] = []
    for k in sorted(claves):
        e = estado(usuario_id, quincena=k, ahora=ahora)
        dias += [x for x in e.get("dias", []) if lunes <= date.fromisoformat(x["fecha"]) <= ahora.date()]
    return sorted(dias, key=lambda x: x["fecha"])


def resumen_semanal(usuario_id: int, *, ahora: datetime | None = None) -> str | None:
    """Texto del mensaje de la semana, o None si la persona no tiene horas acordadas."""
    ahora = ahora or (datetime.utcnow() + _BOGOTA)
    e = estado(usuario_id, ahora=ahora)
    if "pactadas" not in e:
        return None
    # Como la llaman: si el usuario del panel es uno de sus nombres (stella → «Gloria Stella»), ese.
    partes = (e["usuario"]["nombre"] or "").split()
    user = (e["usuario"]["username"] or "").lstrip("@").lower()
    nombre = next((x for x in partes if x.lower() == user), partes[0] if partes else "")
    semana = dias_de_la_semana(usuario_id, ahora)
    habiles = [x for x in semana if x["meta"] > 0]
    completos = [x for x in habiles if x["diferencia"] >= -0.05]
    sin_registro = [x for x in habiles if x["horas"] == 0 and not x["hoy"]]
    h_semana = sum(x["horas"] for x in semana)
    fin_q = date.fromisoformat(e["quincena"]["hasta"])

    lineas = [f"Hola, {nombre}. Así va su semana en McKenna:" if nombre else "Hola. Así va su semana en McKenna:", ""]
    if habiles:
        if completos:
            lineas.append(f"• Esta semana trabajó {_hm(h_semana)} y completó su jornada en {len(completos)} de {len(habiles)} días.")
        else:
            lineas.append(f"• Esta semana trabajó {_hm(h_semana)}. Su jornada acordada es de unas {_hm(e['pactadas'] / e['quincena']['dias_habiles'])} por día.")
    if e["de_mas"] > 0:
        lineas.append(f"• ¡Ya completó las horas acordadas de la quincena! Lleva {_hm(e['de_mas'])} adicionales, "
                      "que se pagan al mismo valor de la hora.")
    elif e["al_dia"] >= 0:
        lineas.append(f"• En la quincena lleva {_hm(e['horas'])} de {_hm(e['pactadas'])} acordadas: va al día. ¡Muy bien!")
    else:
        lineas.append(f"• En la quincena lleva {_hm(e['horas'])} de {_hm(e['pactadas'])} acordadas. Le faltan {_hm(e['faltan'])} "
                      f"para completarlas de aquí al {_fecha_txt(fin_q)}.")
    if sin_registro:
        dias_txt = ", ".join(f"{_DIA_TXT[x['dia_semana']]} {date.fromisoformat(x['fecha']).day}" for x in sin_registro)
        lineas.append(f"• {'Hay un día' if len(sin_registro) == 1 else 'Hay días'} sin registrar ({dias_txt}). Si trabajó, cuéntelo en la "
                      "aplicación: Agenda → «Contar un trabajo que no quedó registrado».")
    if e["regla"]["colectas"]:
        lineas.append("• Recuerde que de lunes a viernes necesitamos su disponibilidad para las colectas de Mercado Libre.")
    lineas += ["", "Lo importante es completar las horas acordadas, no hacerlo más rápido. Lo que haga después son horas "
               "adicionales y se pagan al mismo valor. ¡Gracias por su trabajo!"]
    return "\n".join(lineas)
