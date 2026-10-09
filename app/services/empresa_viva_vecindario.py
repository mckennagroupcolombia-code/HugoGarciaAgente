"""El vecindario de Empresa viva (8-oct-2026, pedido del usuario): cada personaje vive en su propia
casa, al sur del parque. Primero compra un terreno, luego construye y después la decora como guste
(jardín, muebles, accesorios, ampliaciones) con un monto fijo de **monedas al mes**.

- Las monedas son del juego: el mismo monto para todos, sin relación con sueldos, horas ni
  rendimiento (nada de rankings: RRHH). Monto, si lo que no se gasta se acumula, precios y catálogo
  en app/data/empresa_viva_vecindario.json. La asignación llega sola el primer acceso de cada mes
  (hora de Bogotá); si alguien no entró un mes, al volver se le abonan los meses que faltaban.
- Los terrenos (posición, frente y precio) los dibuja scripts/empresa_viva/armar_mapa.py y quedan en
  desktop/public/empresa/pixel/mapa.json → `lotes`. Un terreno por persona.
- La casa y lo que hay en ella se guardan en tickets.db (ev_terrenos, ev_casas, ev_casa_items) y cada
  moneda en un libro (ev_billetera: asignación, compra, devolución). Quitar algo devuelve la mitad.
- Geometría (en baldosas, relativa al terreno de 8 × 8): la casa va centrada a lo ancho y pegada al
  fondo opuesto a la calle; la fila de arriba de la casa es la cara del muro norte; la puerta (y el
  camino a la calle) ocupa las columnas 3 y 4. La misma cuenta está en
  desktop/src/components/empresa/vecindario.ts: si se cambia aquí, se cambia allá.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

from app.services import tickets_db

_RAIZ = Path(__file__).resolve().parents[2]
_CONFIG = _RAIZ / "app" / "data" / "empresa_viva_vecindario.json"
_MAPA = _RAIZ / "desktop" / "public" / "empresa" / "pixel" / "mapa.json"
LADO = 8
PUERTA = (3, 4)
_MAX_ITEMS = 80

_SCHEMA = """
CREATE TABLE IF NOT EXISTS ev_billetera (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id  INTEGER NOT NULL,
    mes         TEXT NOT NULL,                 -- AAAA-MM (Bogotá)
    tipo        TEXT NOT NULL,                 -- asignacion | compra | devolucion
    monto       INTEGER NOT NULL,              -- + entra, − sale
    concepto    TEXT NOT NULL,
    ts          REAL NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ev_billetera_asignacion ON ev_billetera(usuario_id, mes) WHERE tipo = 'asignacion';
CREATE INDEX IF NOT EXISTS ix_ev_billetera_usuario ON ev_billetera(usuario_id, ts);
CREATE TABLE IF NOT EXISTS ev_terrenos (
    lote        TEXT PRIMARY KEY,
    usuario_id  INTEGER NOT NULL UNIQUE,
    precio      INTEGER NOT NULL,
    comprado    REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS ev_casas (
    usuario_id  INTEGER PRIMARY KEY,
    modelo      TEXT NOT NULL,
    nivel       INTEGER NOT NULL,
    construida  REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS ev_casa_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id  INTEGER NOT NULL,
    item        TEXT NOT NULL,
    cx          INTEGER NOT NULL,
    cy          INTEGER NOT NULL,
    precio      INTEGER NOT NULL,
    puesto      REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ev_casa_items_usuario ON ev_casa_items(usuario_id);
"""

_lock = threading.Lock()
_lock_esquema = threading.Lock()
_listo: dict[str, bool] = {}


def _conn() -> sqlite3.Connection:
    ruta = tickets_db.DB_PATH
    c = sqlite3.connect(ruta, timeout=15)
    c.row_factory = sqlite3.Row
    if not _listo.get(ruta):
        with _lock_esquema:
            if not _listo.get(ruta):
                c.executescript(_SCHEMA)
                c.commit()
                _listo[ruta] = True
    return c


def config() -> dict:
    return json.loads(_CONFIG.read_text(encoding="utf-8"))


@lru_cache(maxsize=4)
def _lotes_de_mapa(mtime: float) -> dict[str, dict]:
    datos = json.loads(_MAPA.read_text(encoding="utf-8"))
    return {l["id"]: l for l in datos.get("lotes") or []}


def lotes() -> dict[str, dict]:
    try:
        return _lotes_de_mapa(_MAPA.stat().st_mtime)
    except FileNotFoundError:
        return {}


def _uid(usuario: dict | None) -> int:
    try:
        return int((usuario or {}).get("id") or 0)
    except (TypeError, ValueError):
        return 0


def _mes(ahora: float | None = None) -> str:
    return datetime.fromtimestamp(ahora or time.time(), ZoneInfo("America/Bogota")).strftime("%Y-%m")


def _meses_entre(desde: str, hasta: str) -> list[str]:
    y, m = (int(x) for x in desde.split("-"))
    out = []
    while f"{y:04d}-{m:02d}" <= hasta and len(out) < 240:
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return out


# ─── La geometría del terreno ────────────────────────────────────────────────

def _nivel(cfg: dict, nivel: int) -> dict:
    for n in cfg["niveles"]:
        if n["nivel"] == nivel:
            return n
    raise ValueError("Nivel de casa desconocido")


def casa_rect(lote: dict, nivel: dict) -> tuple[int, int, int, int]:
    """(x0, y0, w, h) de la casa en baldosas, relativo al terreno."""
    w, h = nivel["w"], nivel["h"]
    x0 = (LADO - w) // 2
    y0 = 1 if lote["frente"] == "abajo" else LADO - 1 - h
    return x0, y0, w, h


def zonas(lote: dict, nivel: dict | None) -> tuple[set, set]:
    """(celdas de adentro, celdas del jardín) donde se puede poner algo: sin la cara del muro norte,
    sin la entrada de la puerta y sin el camino de la puerta a la calle."""
    todas = {(x, y) for x in range(LADO) for y in range(LADO)}
    if not nivel:
        return set(), set()
    x0, y0, w, h = casa_rect(lote, nivel)
    casa = {(x, y) for x in range(x0, x0 + w) for y in range(y0, y0 + h)}
    adentro = {(x, y) for (x, y) in casa if y > y0}
    if lote["frente"] == "abajo":
        adentro -= {(x, y0 + h - 1) for x in PUERTA}
        camino = {(x, y) for x in PUERTA for y in range(y0 + h, LADO)}
    else:
        adentro -= {(x, y0 + 1) for x in PUERTA}
        camino = {(x, y) for x in PUERTA for y in range(0, y0)}
    return adentro, todas - casa - camino


def _celdas(it: dict, cx: int, cy: int) -> set:
    return {(x, y) for x in range(cx, cx + it["w"]) for y in range(cy, cy + it["h"])}


def _error_lugar(cfg: dict, lote: dict, nivel: dict, it: dict, cx: int, cy: int, otros: list[sqlite3.Row], salvo: int | None = None) -> str | None:
    adentro, jardin = zonas(lote, nivel)
    celdas = _celdas(it, cx, cy)
    donde = it.get("donde", "jardin")
    if donde == "adentro" and not celdas <= adentro:
        return "Eso va adentro de la casa (y sin tapar la puerta)"
    if donde == "jardin" and not celdas <= jardin:
        return "Eso va en el jardín (sin tapar el camino a la puerta)"
    if donde == "ambos" and not (celdas <= adentro or celdas <= jardin):
        return "No cabe ahí"
    catalogo = {i["id"]: i for i in cfg["items"]}
    capa = it.get("capa", "objeto")
    for o in otros:
        if salvo is not None and o["id"] == salvo:
            continue
        oi = catalogo.get(o["item"])
        if not oi or oi.get("capa", "objeto") != capa:
            continue        # una alfombra y un mueble sí pueden quedar uno encima del otro
        if celdas & _celdas(oi, o["cx"], o["cy"]):
            return f"Ahí ya está {oi['nombre'].lower()}"
    return None


# ─── La billetera ────────────────────────────────────────────────────────────

def _abonar(c: sqlite3.Connection, uid: int, cfg: dict, ahora: float) -> None:
    """La asignación del mes (y de los meses que faltaban desde la primera)."""
    mes = _mes(ahora)
    primero = c.execute("SELECT MIN(mes) FROM ev_billetera WHERE usuario_id=? AND tipo='asignacion'", (uid,)).fetchone()[0]
    for m in _meses_entre(primero or mes, mes):
        c.execute("INSERT OR IGNORE INTO ev_billetera (usuario_id, mes, tipo, monto, concepto, ts) VALUES (?, ?, 'asignacion', ?, ?, ?)",
                  (uid, m, int(cfg["asignacion_mensual"]), f"Asignación de {m}", ahora))


def _saldo(c: sqlite3.Connection, uid: int, cfg: dict, ahora: float) -> int:
    if cfg.get("acumula", True):
        fila = c.execute("SELECT COALESCE(SUM(monto), 0) FROM ev_billetera WHERE usuario_id=?", (uid,)).fetchone()
    else:
        fila = c.execute("SELECT COALESCE(SUM(monto), 0) FROM ev_billetera WHERE usuario_id=? AND mes=?", (uid, _mes(ahora))).fetchone()
    return int(fila[0])


def _cobrar(c: sqlite3.Connection, uid: int, cfg: dict, monto: int, concepto: str, ahora: float) -> None:
    saldo = _saldo(c, uid, cfg, ahora)
    if monto > saldo:
        raise ValueError(f"No te alcanza: cuesta {monto} {cfg['moneda']} y tienes {saldo}")
    c.execute("INSERT INTO ev_billetera (usuario_id, mes, tipo, monto, concepto, ts) VALUES (?, ?, 'compra', ?, ?, ?)",
              (uid, _mes(ahora), -int(monto), concepto, ahora))


# ─── Lo que se ve y lo que se hace ───────────────────────────────────────────

def _mi_terreno(c: sqlite3.Connection, uid: int) -> tuple[dict, sqlite3.Row | None]:
    t = c.execute("SELECT * FROM ev_terrenos WHERE usuario_id=?", (uid,)).fetchone()
    if not t:
        raise ValueError("Primero compra un terreno en el vecindario")
    lote = lotes().get(t["lote"])
    if not lote:
        raise ValueError("Tu terreno ya no está en el mapa")
    casa = c.execute("SELECT * FROM ev_casas WHERE usuario_id=?", (uid,)).fetchone()
    return lote, casa


def estado(usuario: dict) -> dict:
    uid = _uid(usuario)
    cfg = config()
    ahora = time.time()
    with _lock, _conn() as c:
        if uid:
            _abonar(c, uid, cfg, ahora)
            c.commit()
        duenos = {r["lote"]: r for r in c.execute("SELECT * FROM ev_terrenos").fetchall()}
        casas = {r["usuario_id"]: r for r in c.execute("SELECT * FROM ev_casas").fetchall()}
        items: dict[int, list[dict]] = {}
        for r in c.execute("SELECT id, usuario_id, item, cx, cy FROM ev_casa_items ORDER BY id").fetchall():
            items.setdefault(r["usuario_id"], []).append({"id": r["id"], "item": r["item"], "cx": r["cx"], "cy": r["cy"]})
        saldo = _saldo(c, uid, cfg, ahora) if uid else 0
        movs = [dict(r) for r in c.execute("SELECT tipo, monto, concepto, ts FROM ev_billetera WHERE usuario_id=? "
                                           "ORDER BY ts DESC, id DESC LIMIT 15", (uid,)).fetchall()] if uid else []
    out = []
    for lid, l in sorted(lotes().items()):
        d = duenos.get(lid)
        casa = casas.get(d["usuario_id"]) if d else None
        out.append({"id": lid, "precio": l["precio"], "frente": l["frente"], "dueno": d["usuario_id"] if d else None,
                    "casa": {"modelo": casa["modelo"], "nivel": casa["nivel"]} if casa else None,
                    "items": items.get(d["usuario_id"], []) if d else []})
    return {
        "moneda": cfg["moneda"], "asignacion_mensual": cfg["asignacion_mensual"], "acumula": bool(cfg.get("acumula", True)),
        "mes": _mes(ahora), "billetera": {"saldo": saldo, "movimientos": movs}, "lotes": out,
        "catalogo": {"items": cfg["items"], "categorias": cfg["categorias"], "casa": cfg["casa"], "niveles": cfg["niveles"],
                     "devolucion": cfg.get("devolucion_al_quitar", 0.5)},
    }


def comprar_terreno(usuario: dict, lote_id: str) -> dict:
    uid = _uid(usuario)
    cfg = config()
    lote = lotes().get(str(lote_id))
    if not lote:
        raise LookupError("Ese terreno no existe")
    ahora = time.time()
    with _lock, _conn() as c:
        _abonar(c, uid, cfg, ahora)
        if c.execute("SELECT 1 FROM ev_terrenos WHERE usuario_id=?", (uid,)).fetchone():
            raise ValueError("Ya tienes un terreno: cada quien tiene uno")
        if c.execute("SELECT 1 FROM ev_terrenos WHERE lote=?", (lote["id"],)).fetchone():
            raise ValueError("Ese terreno ya tiene dueño")
        _cobrar(c, uid, cfg, int(lote["precio"]), f"Terreno {lote['id']}", ahora)
        c.execute("INSERT INTO ev_terrenos (lote, usuario_id, precio, comprado) VALUES (?, ?, ?, ?)",
                  (lote["id"], uid, int(lote["precio"]), ahora))
        c.commit()
    return estado(usuario)


def construir(usuario: dict, modelo: str) -> dict:
    uid = _uid(usuario)
    cfg = config()
    if modelo not in {m["id"] for m in cfg["casa"]["modelos"]}:
        raise ValueError("Ese estilo de casa no existe")
    ahora = time.time()
    with _lock, _conn() as c:
        _abonar(c, uid, cfg, ahora)
        _, casa = _mi_terreno(c, uid)
        if casa:
            raise ValueError("Tu casa ya está construida: puedes ampliarla")
        _cobrar(c, uid, cfg, int(cfg["casa"]["precio"]), "Construir la casa", ahora)
        c.execute("INSERT INTO ev_casas (usuario_id, modelo, nivel, construida) VALUES (?, ?, 1, ?)", (uid, modelo, ahora))
        c.commit()
    return estado(usuario)


def ampliar(usuario: dict) -> dict:
    uid = _uid(usuario)
    cfg = config()
    ahora = time.time()
    with _lock, _conn() as c:
        _abonar(c, uid, cfg, ahora)
        lote, casa = _mi_terreno(c, uid)
        if not casa:
            raise ValueError("Primero construye la casa")
        siguiente = next((n for n in cfg["niveles"] if n["nivel"] == casa["nivel"] + 1), None)
        if not siguiente:
            raise ValueError("Tu casa ya tiene todas las ampliaciones")
        # Lo del jardín que quedaría adentro de la casa nueva (o en su camino) hay que moverlo antes.
        # (Lo de adentro sigue cabiendo: cada ampliación contiene a la casa anterior.)
        catalogo = {i["id"]: i for i in cfg["items"]}
        adentro_n, jardin_n = zonas(lote, siguiente)
        for o in c.execute("SELECT * FROM ev_casa_items WHERE usuario_id=?", (uid,)).fetchall():
            oi = catalogo.get(o["item"])
            if not oi:
                continue
            celdas = _celdas(oi, o["cx"], o["cy"])
            donde = oi.get("donde", "jardin")
            cabe = (celdas <= adentro_n if donde == "adentro" else celdas <= jardin_n if donde == "jardin"
                    else celdas <= adentro_n or celdas <= jardin_n)
            if not cabe:
                raise ValueError(f"Mueve primero {oi['nombre'].lower()}: queda donde va la ampliación")
        _cobrar(c, uid, cfg, int(siguiente["precio"]), siguiente["nombre"], ahora)
        c.execute("UPDATE ev_casas SET nivel=? WHERE usuario_id=?", (siguiente["nivel"], uid))
        c.commit()
    return estado(usuario)


def pintar(usuario: dict, modelo: str) -> dict:
    uid = _uid(usuario)
    cfg = config()
    if modelo not in {m["id"] for m in cfg["casa"]["modelos"]}:
        raise ValueError("Ese estilo de casa no existe")
    ahora = time.time()
    with _lock, _conn() as c:
        _abonar(c, uid, cfg, ahora)
        _, casa = _mi_terreno(c, uid)
        if not casa:
            raise ValueError("Primero construye la casa")
        if casa["modelo"] == modelo:
            raise ValueError("Tu casa ya es de ese estilo")
        _cobrar(c, uid, cfg, int(cfg["casa"]["pintar"]), "Pintar la casa", ahora)
        c.execute("UPDATE ev_casas SET modelo=? WHERE usuario_id=?", (modelo, uid))
        c.commit()
    return estado(usuario)


def poner_item(usuario: dict, item: str, cx: int, cy: int) -> dict:
    """Comprar algo y ponerlo en una celda del terreno (cx, cy = esquina de arriba a la izquierda)."""
    uid = _uid(usuario)
    cfg = config()
    it = next((i for i in cfg["items"] if i["id"] == item), None)
    if not it:
        raise ValueError("Eso no está en el catálogo")
    cx, cy = int(cx), int(cy)
    ahora = time.time()
    with _lock, _conn() as c:
        _abonar(c, uid, cfg, ahora)
        lote, casa = _mi_terreno(c, uid)
        if not casa:
            raise ValueError("Primero construye la casa")
        otros = c.execute("SELECT * FROM ev_casa_items WHERE usuario_id=?", (uid,)).fetchall()
        if len(otros) >= _MAX_ITEMS:
            raise ValueError("Tu casa ya está llena: quita algo antes")
        if it.get("maximo") and sum(1 for o in otros if o["item"] == item) >= it["maximo"]:
            raise ValueError(f"Solo cabe una {it['nombre'].lower()} por casa")
        error = _error_lugar(cfg, lote, _nivel(cfg, casa["nivel"]), it, cx, cy, otros)
        if error:
            raise ValueError(error)
        _cobrar(c, uid, cfg, int(it["precio"]), it["nombre"], ahora)
        c.execute("INSERT INTO ev_casa_items (usuario_id, item, cx, cy, precio, puesto) VALUES (?, ?, ?, ?, ?, ?)",
                  (uid, item, cx, cy, int(it["precio"]), ahora))
        c.commit()
    return estado(usuario)


def mover_item(usuario: dict, item_id: int, cx: int, cy: int) -> dict:
    uid = _uid(usuario)
    cfg = config()
    with _lock, _conn() as c:
        lote, casa = _mi_terreno(c, uid)
        o = c.execute("SELECT * FROM ev_casa_items WHERE id=? AND usuario_id=?", (int(item_id), uid)).fetchone()
        if not o or not casa:
            raise LookupError("Eso no está en tu casa")
        it = next((i for i in cfg["items"] if i["id"] == o["item"]), None)
        if not it:
            raise ValueError("Eso ya no está en el catálogo")
        otros = c.execute("SELECT * FROM ev_casa_items WHERE usuario_id=?", (uid,)).fetchall()
        error = _error_lugar(cfg, lote, _nivel(cfg, casa["nivel"]), it, int(cx), int(cy), otros, salvo=o["id"])
        if error:
            raise ValueError(error)
        c.execute("UPDATE ev_casa_items SET cx=?, cy=? WHERE id=?", (int(cx), int(cy), o["id"]))
        c.commit()
    return estado(usuario)


def quitar_item(usuario: dict, item_id: int) -> dict:
    """Quitar algo: devuelve la mitad de lo que costó (devolucion_al_quitar)."""
    uid = _uid(usuario)
    cfg = config()
    ahora = time.time()
    with _lock, _conn() as c:
        o = c.execute("SELECT * FROM ev_casa_items WHERE id=? AND usuario_id=?", (int(item_id), uid)).fetchone()
        if not o:
            raise LookupError("Eso no está en tu casa")
        devuelve = int(o["precio"] * float(cfg.get("devolucion_al_quitar", 0.5)))
        nombre = next((i["nombre"] for i in cfg["items"] if i["id"] == o["item"]), o["item"])
        c.execute("DELETE FROM ev_casa_items WHERE id=?", (o["id"],))
        if devuelve:
            c.execute("INSERT INTO ev_billetera (usuario_id, mes, tipo, monto, concepto, ts) VALUES (?, ?, 'devolucion', ?, ?, ?)",
                      (uid, _mes(ahora), devuelve, f"Quitar {nombre.lower()}", ahora))
        c.commit()
    return estado(usuario)
