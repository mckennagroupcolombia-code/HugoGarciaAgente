"""Tenis en equipo en Empresa viva (8-oct-2026, pedido del usuario: «un juego de tenis para jugar en
equipo todos, como el ajedrez»). Cancha en el parque del barrio, al lado de la mesa de ajedrez.

Cómo va un partido:
- Alguien arma un partido (queda en «sala»); los demás se unen al equipo A o al B (hasta 3 por
  lado); quien lo armó lo empieza cuando hay al menos uno por lado. Todo el equipo puede mirar.
- Se juega en tiempo real: cada quien mueve su raqueta y la manda ~10 veces por segundo
  (`estado`); uno de los jugadores, el **anfitrión** (quien armó el partido, o el siguiente si se
  va), simula la pelota en su navegador y la manda con las raquetas, y es quien anota los puntos.
  El servidor solo reparte lo último que sabe de cada uno: no simula física ni valida golpes. Es un
  minijuego interno entre compañeros: no amerita sockets ni un motor en el servidor.
- Conteo de tenis: 15, 30, 40, iguales y ventaja; gana el equipo que se lleva 2 juegos. Cada quien
  del equipo ganador recibe un trofeo de tenis en la repisa de su cuarto
  (empresa_viva_ajedrez.premiar_equipo, tabla `ev_trofeos`).

Vive en la memoria del proceso, como las posiciones del juego: un reinicio del agente corta los
partidos en curso (los trofeos ya ganados sí quedan en tickets.db).
"""
from __future__ import annotations

import math
import threading
import time

_lock = threading.Lock()
_partidas: dict[int, dict] = {}
_ultimo_id = 0

MAX_POR_EQUIPO = 3
JUEGOS_PARA_GANAR = 2
_VIDA_JUGADOR_S = 6          # sin noticias de alguien en 6 s: se fue (deja de ser anfitrión)
_SALA_VENCE_S = 30 * 60      # una sala sin empezar se cierra a la media hora
_ABANDONO_S = 60             # un partido sin nadie mandando en 1 min se da por abandonado
_TERMINADA_S = 10 * 60       # los terminados se siguen mostrando 10 min
_VEL_MAX = 3.0               # la pelota no va a más de 3 canchas por segundo (descarta basura)


def _uid(usuario: dict | None) -> int:
    try:
        return int((usuario or {}).get("id") or 0)
    except (TypeError, ValueError):
        return 0


def _nuevo_id() -> int:
    """Único también entre reinicios (los trofeos guardan el id del partido)."""
    global _ultimo_id
    _ultimo_id = max(_ultimo_id + 1, int(time.time() * 10) % 2_000_000_000)
    return _ultimo_id


def _miembros(p: dict) -> list[int]:
    return p["equipos"]["A"] + p["equipos"]["B"]


def _equipo_de(p: dict, uid: int) -> str | None:
    return "A" if uid in p["equipos"]["A"] else "B" if uid in p["equipos"]["B"] else None


def _num(v, lo: float, hi: float) -> float | None:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(x):
        return None
    return min(hi, max(lo, x))


def _limpiar(ahora: float) -> None:
    for pid, p in list(_partidas.items()):
        if p["estado"] == "sala" and ahora - p["actualizada"] > _SALA_VENCE_S:
            del _partidas[pid]
        elif p["estado"] == "jugando" and all(ahora - p["vistos"].get(u, 0) > _ABANDONO_S for u in _miembros(p)):
            p.update(estado="terminada", ganador=None, motivo="abandonado", actualizada=ahora)
        elif p["estado"] == "terminada" and ahora - p["actualizada"] > _TERMINADA_S:
            del _partidas[pid]


def _anfitrion(p: dict, ahora: float) -> None:
    """Si el anfitrión se fue, lo reemplaza el primero que siga mandando."""
    if p["host"] in _miembros(p) and ahora - p["vistos"].get(p["host"], 0) <= _VIDA_JUGADOR_S:
        return
    vivos = [u for u in _miembros(p) if ahora - p["vistos"].get(u, 0) <= _VIDA_JUGADOR_S]
    if vivos:
        p["host"] = vivos[0]
    elif _miembros(p):
        p["host"] = _miembros(p)[0]


def _vista(p: dict, ahora: float) -> dict:
    return {
        "id": p["id"], "creador": p["creador"], "host": p["host"], "estado": p["estado"],
        "equipos": {"A": list(p["equipos"]["A"]), "B": list(p["equipos"]["B"])},
        "puntos": dict(p["puntos"]), "juegos": dict(p["juegos"]), "saca": p["saca"], "ganador": p["ganador"],
        "motivo": p["motivo"], "pelota": p["pelota"], "punto_seq": p["punto_seq"],
        "raquetas": {str(u): r for u, r in p["raquetas"].items() if u in _miembros(p)},
        "activos": [u for u in _miembros(p) if ahora - p["vistos"].get(u, 0) <= _VIDA_JUGADOR_S],
        "juegos_para_ganar": JUEGOS_PARA_GANAR, "max_por_equipo": MAX_POR_EQUIPO,
        "creada": p["creada"], "actualizada": p["actualizada"], "ahora": ahora,
    }


def _partida(pid: int) -> dict:
    p = _partidas.get(int(pid))
    if not p:
        raise LookupError("Ese partido ya no existe")
    return p


def _ya_juega(uid: int, salvo: int | None = None) -> bool:
    return any(pid != salvo and p["estado"] in ("sala", "jugando") and uid in _miembros(p) for pid, p in _partidas.items())


def crear(usuario: dict) -> dict:
    uid = _uid(usuario)
    if not uid:
        raise ValueError("Falta la persona")
    ahora = time.time()
    with _lock:
        _limpiar(ahora)
        if _ya_juega(uid):
            raise ValueError("Ya estás en un partido: termínalo o sal de él")
        pid = _nuevo_id()
        _partidas[pid] = {
            "id": pid, "creador": uid, "host": uid, "estado": "sala", "equipos": {"A": [uid], "B": []},
            "puntos": {"A": 0, "B": 0}, "juegos": {"A": 0, "B": 0}, "saca": "A", "ganador": None, "motivo": "",
            "pelota": None, "punto_seq": 0, "raquetas": {}, "vistos": {uid: ahora}, "creada": ahora, "actualizada": ahora,
        }
        return _vista(_partidas[pid], ahora)


def unirse(usuario: dict, pid: int, equipo: str) -> dict:
    uid = _uid(usuario)
    if equipo not in ("A", "B"):
        raise ValueError("El equipo es A o B")
    ahora = time.time()
    with _lock:
        _limpiar(ahora)
        p = _partida(pid)
        if p["estado"] != "sala":
            raise ValueError("Ese partido ya empezó: puedes mirarlo")
        if _ya_juega(uid, salvo=p["id"]):
            raise ValueError("Ya estás en otro partido")
        if uid not in p["equipos"][equipo] and len(p["equipos"][equipo]) >= MAX_POR_EQUIPO:
            raise ValueError(f"El equipo {equipo} ya está lleno")
        for e in ("A", "B"):
            if uid in p["equipos"][e]:
                p["equipos"][e].remove(uid)
        p["equipos"][equipo].append(uid)
        p["vistos"][uid] = ahora
        p["actualizada"] = ahora
        return _vista(p, ahora)


def salir(usuario: dict, pid: int) -> dict:
    uid = _uid(usuario)
    ahora = time.time()
    with _lock:
        p = _partida(pid)
        equipo = _equipo_de(p, uid)
        if not equipo:
            raise PermissionError("No estás en ese partido")
        p["equipos"][equipo].remove(uid)
        p["raquetas"].pop(uid, None)
        p["actualizada"] = ahora
        if not _miembros(p) and p["estado"] == "sala":
            del _partidas[p["id"]]
            return {**_vista(p, ahora), "estado": "cerrada"}
        if p["estado"] == "jugando" and (not p["equipos"]["A"] or not p["equipos"]["B"]):
            p.update(estado="terminada", ganador=None, motivo="un equipo se quedó sin jugadores")
        if p["host"] == uid and _miembros(p):
            p["host"] = _miembros(p)[0]
        return _vista(p, ahora)


def empezar(usuario: dict, pid: int) -> dict:
    uid = _uid(usuario)
    ahora = time.time()
    with _lock:
        p = _partida(pid)
        if uid != p["creador"] and uid != p["host"]:
            raise PermissionError("Lo empieza quien armó el partido")
        if p["estado"] != "sala":
            raise ValueError("El partido ya empezó")
        if not p["equipos"]["A"] or not p["equipos"]["B"]:
            raise ValueError("Falta al menos una persona en cada equipo")
        p.update(estado="jugando", pelota=None, actualizada=ahora)
        for u in _miembros(p):
            p["vistos"].setdefault(u, ahora)
        return _vista(p, ahora)


def _anotar(p: dict, equipo: str, ahora: float) -> None:
    """Un punto para `equipo`, con el conteo de tenis; al ganar los juegos que tocan, trofeos."""
    otro = "B" if equipo == "A" else "A"
    p["puntos"][equipo] += 1
    if p["puntos"][equipo] >= 4 and p["puntos"][equipo] - p["puntos"][otro] >= 2:
        p["juegos"][equipo] += 1
        p["puntos"] = {"A": 0, "B": 0}
        p["saca"] = "B" if (p["juegos"]["A"] + p["juegos"]["B"]) % 2 else "A"   # el saque cambia en cada juego
        if p["juegos"][equipo] >= JUEGOS_PARA_GANAR:
            p.update(estado="terminada", ganador=equipo, motivo="partido ganado", pelota=None)
            from app.services.empresa_viva_ajedrez import premiar_equipo

            try:
                premiar_equipo("tenis", p["id"], list(p["equipos"][equipo]), list(p["equipos"][otro]),
                               f"{p['juegos'][equipo]}-{p['juegos'][otro]}")
            except Exception:
                p["motivo"] = "partido ganado (no se pudo guardar el trofeo)"
    p["actualizada"] = ahora


def estado(usuario: dict, pid: int, datos: dict) -> dict:
    """Cada jugador manda su raqueta ({x, y} de 0 a 1) y recibe todo. El anfitrión además manda la
    pelota ({x, y, vx, vy}, en canchas y canchas por segundo) y, al caer un punto, `punto` =
    equipo que lo ganó con `punto_seq` = el siguiente número (así un reenvío no anota dos veces)."""
    uid = _uid(usuario)
    ahora = time.time()
    datos = datos or {}
    with _lock:
        _limpiar(ahora)
        p = _partida(pid)
        miembro = _equipo_de(p, uid) is not None
        if miembro:
            p["vistos"][uid] = ahora
            r = datos.get("raqueta") or {}
            x, y = _num(r.get("x"), 0, 1), _num(r.get("y"), 0, 1)
            if x is not None and y is not None:
                p["raquetas"][uid] = {"x": round(x, 4), "y": round(y, 4), "t": ahora}
            _anfitrion(p, ahora)
            if uid == p["host"] and p["estado"] == "jugando":
                b = datos.get("pelota")
                if isinstance(b, dict):
                    bx, by = _num(b.get("x"), -0.2, 1.2), _num(b.get("y"), -0.2, 1.2)
                    vx, vy = _num(b.get("vx"), -_VEL_MAX, _VEL_MAX), _num(b.get("vy"), -_VEL_MAX, _VEL_MAX)
                    if None not in (bx, by, vx, vy):
                        p["pelota"] = {"x": round(bx, 4), "y": round(by, 4), "vx": round(vx, 4), "vy": round(vy, 4),
                                       "t": ahora, "quieta": bool(b.get("quieta"))}
                punto = datos.get("punto")
                try:
                    seq = int(datos.get("punto_seq") or 0)
                except (TypeError, ValueError):
                    seq = 0
                if punto in ("A", "B") and seq == p["punto_seq"] + 1:
                    p["punto_seq"] = seq
                    _anotar(p, punto, ahora)
        return _vista(p, ahora)


def ver(usuario: dict, pid: int) -> dict:
    ahora = time.time()
    with _lock:
        _limpiar(ahora)
        return _vista(_partida(pid), ahora)


def listar(usuario: dict) -> dict:
    """Los partidos abiertos (para unirse), en juego (para mirar) y los recién terminados."""
    ahora = time.time()
    with _lock:
        _limpiar(ahora)
        lista = sorted(_partidas.values(), key=lambda p: -p["actualizada"])
        return {"partidos": [_vista(p, ahora) for p in lista], "ahora": ahora}
