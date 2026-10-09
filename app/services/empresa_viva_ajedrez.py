"""Ajedrez en Empresa viva (8-oct-2026): dos personas del equipo juegan una partida en la mesa de
piedra del parque del barrio (Agenda → Empresa viva).

Flujo: una reta a otra («Jugar ajedrez» al hablarle, o desde la mesa) → la otra acepta o no →
juegan por turnos; cualquiera del equipo puede mirar. La partida queda guardada (sobrevive a un
reinicio): se puede dejar a medias y seguir otro día.

Qué valida el servidor y qué no:
- Sí: que quien mueve sea de la partida y le toque (por la paridad de las jugadas), que la jugada
  tenga forma UCI (e2e4, e7e8q) y que el cliente conozca la última jugada (`n`, para que dos
  clics no muevan dos veces). El resultado lo pone el servidor según el motivo: un jaque mate lo
  gana quien movió; ahogado, material insuficiente, triple repetición y 50 jugadas son tablas.
- No: la legalidad de cada jugada. La revisa chess.js en el navegador de los dos (y de quien
  mira), que reconstruye la partida jugada por jugada y la marca rota si alguna no vale. Es un
  minijuego interno entre compañeros: no amerita un motor de reglas en el servidor.

Trofeos (8-oct-2026, pedido del usuario cuando Armando le ganó a Cynthia): cada partida ganada deja
un trofeo a quien ganó (tabla `ev_trofeos`, uno por partida): **oro** por jaque mate, **plata** si el
rival se rindió; las tablas no dan trofeo. El juego los pone en la repisa al lado de la cama de cada
quien (su cuarto en empresa_viva_casas.json) y se van acumulando. No es un ranking: no se compara a
nadie ni hay tabla de posiciones, cada quien tiene los suyos en su cuarto.

Vive en tickets.db (tablas `ev_ajedrez` y `ev_trofeos`), como el chat del equipo.
"""
from __future__ import annotations

import json
import random
import re
import sqlite3
import threading
import time

from app.services import tickets_db

_SCHEMA = """
CREATE TABLE IF NOT EXISTS ev_ajedrez (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    blancas       INTEGER NOT NULL,
    negras        INTEGER NOT NULL,
    reta          INTEGER NOT NULL,              -- quién propuso la partida
    estado        TEXT NOT NULL,                 -- invitada | jugando | terminada | rechazada | cancelada | vencida
    jugadas       TEXT NOT NULL DEFAULT '',      -- UCI separadas por espacio
    resultado     TEXT NOT NULL DEFAULT '',      -- 1-0 | 0-1 | 1/2-1/2
    motivo        TEXT NOT NULL DEFAULT '',
    tablas_ofrece INTEGER,                       -- quién ofreció tablas (NULL = nadie)
    creada        REAL NOT NULL,
    actualizada   REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ev_ajedrez_estado ON ev_ajedrez(estado, actualizada);
CREATE TABLE IF NOT EXISTS ev_trofeos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id  INTEGER NOT NULL,                -- quién lo ganó
    juego       TEXT NOT NULL DEFAULT 'ajedrez', -- ajedrez | tenis
    partida_id  INTEGER NOT NULL,
    rival_id    INTEGER NOT NULL,                -- en tenis, el primero del otro equipo
    medalla     TEXT NOT NULL,                   -- oro (jaque mate) | plata (el rival se rindió) | tenis
    motivo      TEXT NOT NULL,
    jugadas     INTEGER NOT NULL,                -- ajedrez: medias jugadas; tenis: 0
    detalle     TEXT NOT NULL DEFAULT '{}',      -- tenis: {"companeros": [...], "rivales": [...], "marcador": "2-1"}
    ganado      REAL NOT NULL,
    UNIQUE (juego, partida_id, usuario_id)       -- una partida, un trofeo por ganador
);
CREATE INDEX IF NOT EXISTS ix_ev_trofeos_usuario ON ev_trofeos(usuario_id, ganado);
"""

_lock = threading.Lock()            # una jugada a la vez (leer-validar-escribir)
_lock_esquema = threading.Lock()
_listo: dict[str, bool] = {}

ABIERTAS = ("invitada", "jugando")
_UCI = re.compile(r"[a-h][1-8][a-h][1-8][qrbn]?")
# Lo que el navegador puede decir que terminó la partida con su jugada → resultado (None = gana quien movió).
_FINES = {"jaque mate": None, "ahogado": "1/2-1/2", "material insuficiente": "1/2-1/2",
          "triple repetición": "1/2-1/2", "50 jugadas": "1/2-1/2"}
_VENCE_INVITACION_S = 2 * 3600
_MAX_ABIERTAS = 6                    # por persona: retos y partidas en curso
_RECIENTE_S = 30 * 60                # las terminadas se siguen mostrando media hora
_MAX_JUGADAS = 600


def _conn() -> sqlite3.Connection:
    ruta = tickets_db.DB_PATH
    c = sqlite3.connect(ruta, timeout=15)
    c.row_factory = sqlite3.Row
    if not _listo.get(ruta):
        with _lock_esquema:
            if not _listo.get(ruta):
                c.executescript(_SCHEMA)
                # Las partidas ganadas antes de que existieran los trofeos también dejan el suyo.
                for r in c.execute("SELECT * FROM ev_ajedrez WHERE estado='terminada' AND resultado IN ('1-0','0-1') "
                                   "AND id NOT IN (SELECT partida_id FROM ev_trofeos WHERE juego='ajedrez')").fetchall():
                    _premiar(c, r)
                c.commit()
                _listo[ruta] = True
    return c


def _uid(usuario: dict | None) -> int:
    try:
        return int((usuario or {}).get("id") or 0)
    except (TypeError, ValueError):
        return 0


def _fila(r: sqlite3.Row) -> dict:
    jugadas = r["jugadas"].split() if r["jugadas"] else []
    return {
        "id": r["id"], "blancas": r["blancas"], "negras": r["negras"], "reta": r["reta"], "estado": r["estado"],
        "jugadas": jugadas, "turno": "blancas" if len(jugadas) % 2 == 0 else "negras",
        "resultado": r["resultado"], "motivo": r["motivo"], "tablas_ofrece": r["tablas_ofrece"],
        "creada": r["creada"], "actualizada": r["actualizada"],
    }


def _vencer(c: sqlite3.Connection, ahora: float) -> None:
    c.execute("UPDATE ev_ajedrez SET estado='vencida', actualizada=? WHERE estado='invitada' AND creada < ?",
              (ahora, ahora - _VENCE_INVITACION_S))


def _partida(c: sqlite3.Connection, pid: int) -> sqlite3.Row:
    r = c.execute("SELECT * FROM ev_ajedrez WHERE id=?", (int(pid),)).fetchone()
    if not r:
        raise LookupError("No existe esa partida")
    return r


def _premiar(c: sqlite3.Connection, r: sqlite3.Row) -> None:
    """El trofeo de quien ganó esta partida (si alguien ganó). Idempotente: uno por partida."""
    if r["estado"] != "terminada" or r["resultado"] not in ("1-0", "0-1"):
        return
    gana, pierde = (r["blancas"], r["negras"]) if r["resultado"] == "1-0" else (r["negras"], r["blancas"])
    c.execute("INSERT OR IGNORE INTO ev_trofeos (usuario_id, juego, partida_id, rival_id, medalla, motivo, jugadas, ganado) "
              "VALUES (?, 'ajedrez', ?, ?, ?, ?, ?, ?)",
              (gana, r["id"], pierde, "oro" if r["motivo"] == "jaque mate" else "plata", r["motivo"],
               len(r["jugadas"].split()) if r["jugadas"] else 0, r["actualizada"]))


def premiar_equipo(juego: str, partida_id: int, ganadores: list[int], perdedores: list[int], marcador: str) -> None:
    """Un trofeo para cada quien del equipo que ganó (tenis: empresa_viva_tenis). Idempotente."""
    ahora = time.time()
    with _conn() as c:
        for uid in ganadores:
            detalle = {"companeros": [x for x in ganadores if x != uid], "rivales": perdedores, "marcador": marcador}
            c.execute("INSERT OR IGNORE INTO ev_trofeos (usuario_id, juego, partida_id, rival_id, medalla, motivo, jugadas, "
                      "detalle, ganado) VALUES (?, ?, ?, ?, ?, 'partido ganado', 0, ?, ?)",
                      (uid, juego, int(partida_id), perdedores[0] if perdedores else 0, juego, json.dumps(detalle), ahora))
        c.commit()


def trofeos(c: sqlite3.Connection | None = None) -> list[dict]:
    """Todos los trofeos (los ve todo el equipo: están en la repisa de cada cuarto)."""
    def leer(cx: sqlite3.Connection) -> list[dict]:
        out = []
        for t in cx.execute("SELECT * FROM ev_trofeos ORDER BY ganado, id").fetchall():
            try:
                detalle = json.loads(t["detalle"] or "{}")
            except ValueError:
                detalle = {}
            out.append({"id": t["id"], "usuario": t["usuario_id"], "juego": t["juego"], "partida": t["partida_id"],
                        "rival": t["rival_id"], "medalla": t["medalla"], "motivo": t["motivo"], "jugadas": t["jugadas"],
                        "detalle": detalle, "ganado": t["ganado"]})
        return out
    if c is not None:
        return leer(c)
    with _conn() as cx:
        return leer(cx)


def _de_la_partida(r: sqlite3.Row, uid: int) -> bool:
    return uid in (r["blancas"], r["negras"])


def retar(usuario: dict, a: int) -> dict:
    """Propone una partida; los colores se sortean."""
    from app.services.empresa_viva import puede_ver_juego

    uid, a = _uid(usuario), int(a or 0)
    if not uid or not a or a == uid:
        raise ValueError("Elige a otra persona del equipo")
    rival = tickets_db.get_usuario_by_id(a)
    if not rival or not puede_ver_juego(rival) or rival.get("activo") in (0, False):
        raise ValueError("Esa persona no juega en el barrio")
    ahora = time.time()
    with _lock, _conn() as c:
        _vencer(c, ahora)
        ya = c.execute(f"SELECT id FROM ev_ajedrez WHERE estado IN {ABIERTAS} AND "
                       "((blancas=? AND negras=?) OR (blancas=? AND negras=?))", (uid, a, a, uid)).fetchone()
        if ya:
            raise ValueError("Ya tienen una partida abierta: síganla")
        for quien in (uid, a):
            n = c.execute(f"SELECT COUNT(*) FROM ev_ajedrez WHERE estado IN {ABIERTAS} AND (blancas=? OR negras=?)",
                          (quien, quien)).fetchone()[0]
            if n >= _MAX_ABIERTAS:
                raise ValueError("Demasiadas partidas abiertas: terminen alguna primero" if quien == uid
                                 else "Esa persona ya tiene muchas partidas abiertas")
        blancas, negras = (uid, a) if random.random() < 0.5 else (a, uid)
        cur = c.execute("INSERT INTO ev_ajedrez (blancas, negras, reta, estado, creada, actualizada) "
                        "VALUES (?, ?, ?, 'invitada', ?, ?)", (blancas, negras, uid, ahora, ahora))
        c.commit()
        return _fila(_partida(c, cur.lastrowid))


def responder(usuario: dict, pid: int, acepta: bool) -> dict:
    """Quien fue retado acepta o no; quien retó puede retirar el reto (cancelar)."""
    uid = _uid(usuario)
    ahora = time.time()
    with _lock, _conn() as c:
        _vencer(c, ahora)
        r = _partida(c, pid)
        if not _de_la_partida(r, uid):
            raise PermissionError("No es tu partida")
        if r["estado"] != "invitada":
            raise ValueError("Ese reto ya no está pendiente")
        if uid == r["reta"]:
            if acepta:
                raise ValueError("Falta que la otra persona acepte")
            nuevo = "cancelada"
        else:
            nuevo = "jugando" if acepta else "rechazada"
        c.execute("UPDATE ev_ajedrez SET estado=?, actualizada=? WHERE id=?", (nuevo, ahora, r["id"]))
        c.commit()
        return _fila(_partida(c, r["id"]))


def jugar(usuario: dict, pid: int, uci: str, n: int, fin: str = "") -> dict:
    """Anota una jugada. `n` = cuántas jugadas tenía la partida al mover (evita mover dos veces);
    `fin` = el motivo si con esta jugada se acabó (lo detecta chess.js en el navegador)."""
    uid = _uid(usuario)
    uci = str(uci or "").strip().lower()
    fin = str(fin or "").strip()
    if not _UCI.fullmatch(uci):
        raise ValueError("Jugada inválida")
    if fin and fin not in _FINES:
        raise ValueError("Final de partida desconocido")
    ahora = time.time()
    with _lock, _conn() as c:
        r = _partida(c, pid)
        if not _de_la_partida(r, uid):
            raise PermissionError("No es tu partida")
        if r["estado"] != "jugando":
            raise ValueError("La partida no está en juego")
        jugadas = r["jugadas"].split() if r["jugadas"] else []
        if int(n) != len(jugadas):
            raise ValueError("La partida cambió: vuelve a mirar el tablero")
        if len(jugadas) >= _MAX_JUGADAS:
            raise ValueError("La partida ya es demasiado larga")
        mueve_blancas = len(jugadas) % 2 == 0
        if uid != (r["blancas"] if mueve_blancas else r["negras"]):
            raise ValueError("No es tu turno")
        jugadas.append(uci)
        estado, resultado = r["estado"], ""
        if fin:
            estado = "terminada"
            resultado = _FINES[fin] or ("1-0" if mueve_blancas else "0-1")
        c.execute("UPDATE ev_ajedrez SET jugadas=?, estado=?, resultado=?, motivo=?, tablas_ofrece=NULL, actualizada=? "
                  "WHERE id=?", (" ".join(jugadas), estado, resultado, fin, ahora, r["id"]))
        nueva = _partida(c, r["id"])
        _premiar(c, nueva)
        c.commit()
        return _fila(nueva)


def rendirse(usuario: dict, pid: int) -> dict:
    uid = _uid(usuario)
    ahora = time.time()
    with _lock, _conn() as c:
        r = _partida(c, pid)
        if not _de_la_partida(r, uid):
            raise PermissionError("No es tu partida")
        if r["estado"] != "jugando":
            raise ValueError("La partida no está en juego")
        resultado = "0-1" if uid == r["blancas"] else "1-0"
        c.execute("UPDATE ev_ajedrez SET estado='terminada', resultado=?, motivo='rendición', tablas_ofrece=NULL, "
                  "actualizada=? WHERE id=?", (resultado, ahora, r["id"]))
        nueva = _partida(c, r["id"])
        _premiar(c, nueva)
        c.commit()
        return _fila(nueva)


def tablas(usuario: dict, pid: int, accion: str) -> dict:
    """ofrecer | aceptar | rechazar. Aceptar solo vale si la OTRA persona las ofreció."""
    uid = _uid(usuario)
    if accion not in ("ofrecer", "aceptar", "rechazar"):
        raise ValueError("Acción inválida")
    ahora = time.time()
    with _lock, _conn() as c:
        r = _partida(c, pid)
        if not _de_la_partida(r, uid):
            raise PermissionError("No es tu partida")
        if r["estado"] != "jugando":
            raise ValueError("La partida no está en juego")
        ofrece = r["tablas_ofrece"]
        if accion == "ofrecer":
            c.execute("UPDATE ev_ajedrez SET tablas_ofrece=?, actualizada=? WHERE id=?", (uid, ahora, r["id"]))
        elif not ofrece or ofrece == uid:
            raise ValueError("No hay tablas que responder")
        elif accion == "aceptar":
            c.execute("UPDATE ev_ajedrez SET estado='terminada', resultado='1/2-1/2', motivo='tablas acordadas', "
                      "tablas_ofrece=NULL, actualizada=? WHERE id=?", (ahora, r["id"]))
        else:
            c.execute("UPDATE ev_ajedrez SET tablas_ofrece=NULL, actualizada=? WHERE id=?", (ahora, r["id"]))
        c.commit()
        return _fila(_partida(c, r["id"]))


def ver(usuario: dict, pid: int) -> dict:
    """Una partida: la ve todo el equipo (se puede mirar), juegan solo los dos."""
    with _conn() as c:
        return _fila(_partida(c, pid))


def listar(usuario: dict) -> dict:
    """Las mías (retos, en curso y las que terminaron hace poco) y las que se están jugando (para mirar)."""
    uid = _uid(usuario)
    ahora = time.time()
    with _lock, _conn() as c:
        _vencer(c, ahora)
        c.commit()
        mias = c.execute(
            "SELECT * FROM ev_ajedrez WHERE (blancas=? OR negras=?) AND (estado IN ('invitada','jugando') OR actualizada > ?) "
            "ORDER BY actualizada DESC LIMIT 20", (uid, uid, ahora - _RECIENTE_S)).fetchall()
        en_curso = c.execute(
            "SELECT * FROM ev_ajedrez WHERE estado='jugando' AND blancas<>? AND negras<>? ORDER BY actualizada DESC LIMIT 10",
            (uid, uid)).fetchall()
        todos = trofeos(c)
    return {"mias": [_fila(r) for r in mias], "en_curso": [_fila(r) for r in en_curso], "trofeos": todos, "ahora": ahora}
