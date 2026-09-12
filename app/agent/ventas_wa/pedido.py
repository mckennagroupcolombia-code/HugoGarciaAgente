"""
Pedido en curso por cliente de WhatsApp, persistido en SQLite.

Es la memoria de trabajo del agente: productos (con el precio de la web en el
momento de agregarlos), datos del cliente y destino. El agente lo lee y lo
modifica solo con herramientas; los totales los calcula este módulo, nunca el
modelo. Así el bot deja de "olvidar" datos que el cliente ya dio y no suma mal.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
import time
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field

from app.agent.ventas_wa.catalogo import Presentacion, _miles

_DB = os.getenv("WA_V2_DB", os.path.join("app", "data", "ventas_wa.db"))
# El modo sombra escribe aparte: sus "pedidos" son borradores que el cliente
# nunca vio y no pueden convertirse en pedidos reales al pasar a modo activo.
_DB_SOMBRA = os.getenv("WA_V2_DB_SOMBRA", os.path.join("app", "data", "ventas_wa_sombra.db"))
_lock = threading.Lock()


# Modo de base por turno (hilo): el chat web puede estar en sombra mientras
# WhatsApp está activo o al revés. Nunca se toca os.environ en caliente: otro
# hilo leería el modo equivocado y podría responderle de verdad a un cliente.
_modo_db: ContextVar[str | None] = ContextVar("ventas_wa_modo_db", default=None)


@contextmanager
def usando_modo(modo: str):
    token = _modo_db.set(modo)
    try:
        yield
    finally:
        _modo_db.reset(token)


def ruta_db(modo: str | None = None) -> str:
    m = (modo or _modo_db.get() or os.getenv("WA_AGENTE_V2", "off")).strip().lower()
    return _DB_SOMBRA if m == "sombra" else _DB

# Estados: abierto → esperando_asesor (tarjeta enviada al grupo) → cerrado/cancelado
ESTADOS_ACTIVOS = ("abierto", "esperando_asesor")
_VIGENCIA_S = int(os.getenv("WA_V2_PEDIDO_VIGENCIA_DIAS", "7")) * 86400

CAMPOS_CLIENTE = ("nombre", "documento", "correo", "telefono", "direccion", "ciudad", "departamento")
# Lo mínimo que el equipo pide para despachar (plantilla "_nombre _cedula -Direccion _ciudad").
CAMPOS_OBLIGATORIOS = ("nombre", "documento", "direccion", "ciudad")


def _conn(modo: str | None = None) -> sqlite3.Connection:
    ruta = ruta_db(modo)
    os.makedirs(os.path.dirname(ruta) or ".", exist_ok=True)
    c = sqlite3.connect(ruta, check_same_thread=False, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute(
        """CREATE TABLE IF NOT EXISTS pedidos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            jid TEXT NOT NULL,
            estado TEXT NOT NULL DEFAULT 'abierto',
            items TEXT NOT NULL DEFAULT '[]',
            cliente TEXT NOT NULL DEFAULT '{}',
            notas TEXT NOT NULL DEFAULT '',
            creado REAL NOT NULL,
            actualizado REAL NOT NULL,
            handoff_ts REAL,
            handoff_motivo TEXT,
            handoff_firma TEXT
        )"""
    )
    c.execute("CREATE INDEX IF NOT EXISTS ix_pedidos_jid ON pedidos(jid, actualizado)")
    columnas = {r[1] for r in c.execute("PRAGMA table_info(pedidos)").fetchall()}
    if "codigo" not in columnas:
        # Código para continuar por WhatsApp un pedido armado en el chat web.
        c.execute("ALTER TABLE pedidos ADD COLUMN codigo TEXT")
    if "canal" not in columnas:
        c.execute("ALTER TABLE pedidos ADD COLUMN canal TEXT NOT NULL DEFAULT 'whatsapp'")
    c.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_pedidos_codigo ON pedidos(codigo) WHERE codigo IS NOT NULL")
    # Historial del chat web (burbuja del sitio). Tabla propia: no se mezcla con
    # WhatsApp (wa_chats.db) ni con la memoria legacy del bot.
    c.execute(
        """CREATE TABLE IF NOT EXISTS web_mensajes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sesion TEXT NOT NULL,
            ts REAL NOT NULL,
            rol TEXT NOT NULL,
            texto TEXT NOT NULL,
            pagina TEXT
        )"""
    )
    c.execute("CREATE INDEX IF NOT EXISTS ix_web_mensajes ON web_mensajes(sesion, ts)")
    c.execute(
        """CREATE TABLE IF NOT EXISTS pausas (
            jid TEXT PRIMARY KEY,
            hasta REAL NOT NULL,
            motivo TEXT
        )"""
    )
    c.execute(
        """CREATE TABLE IF NOT EXISTS turnos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts REAL NOT NULL,
            jid TEXT NOT NULL,
            modo TEXT NOT NULL,
            entrada TEXT,
            respuesta TEXT,
            herramientas TEXT,
            llamadas INTEGER,
            tokens_in INTEGER,
            tokens_out INTEGER,
            error TEXT
        )"""
    )
    return c


@dataclass
class Item:
    ref: str
    nombre: str
    precio: int
    cantidad: int

    @property
    def subtotal(self) -> int:
        return self.precio * self.cantidad


@dataclass
class Pedido:
    id: int
    jid: str
    estado: str
    items: list[Item] = field(default_factory=list)
    cliente: dict = field(default_factory=dict)
    notas: str = ""
    handoff_ts: float | None = None
    handoff_motivo: str | None = None
    handoff_firma: str | None = None
    codigo: str | None = None
    canal: str = "whatsapp"

    @property
    def subtotal(self) -> int:
        return sum(i.subtotal for i in self.items)

    def faltantes(self) -> list[str]:
        return [c for c in CAMPOS_OBLIGATORIOS if not str(self.cliente.get(c) or "").strip()]

    def peso_kg(self) -> float:
        from app.services.tarifas_envio import peso_unitario_kg

        return sum(peso_unitario_kg(i.nombre) * i.cantidad for i in self.items) or 1.0

    def envio(self) -> dict | None:
        """Tarifa de la tabla oficial por zona y peso; referencial, el asesor la confirma."""
        ciudad = str(self.cliente.get("ciudad") or "").strip()
        if not ciudad or not self.items:
            return None
        try:
            from app.services.tarifas_envio import cotizar_envio

            return cotizar_envio(ciudad, str(self.cliente.get("departamento") or ""), self.peso_kg())
        except Exception:
            return None

    def resumen(self) -> str:
        if not self.items and not any(self.cliente.values()):
            return "Pedido vacío (sin productos ni datos del cliente)."
        lineas = [f"Pedido #{self.id} · estado: {self.estado}"]
        if self.items:
            lineas.append("Productos:")
            for i in self.items:
                lineas.append(
                    f"- {i.ref} | {i.nombre} x{i.cantidad} = ${_miles(i.subtotal)} (${_miles(i.precio)} c/u)"
                )
            lineas.append(f"Subtotal productos: ${_miles(self.subtotal)}")
            env = self.envio()
            if env:
                lineas.append(
                    f"Envío referencial a {self.cliente.get('ciudad')}: ${_miles(env['costo'])} "
                    f"({env['zona_nombre']}, ~{env['peso_kg']} kg; lo confirma el asesor)"
                )
                lineas.append(f"Total referencial: ${_miles(self.subtotal + env['costo'])}")
            else:
                lineas.append("Envío: falta la ciudad de destino.")
        else:
            lineas.append("Productos: ninguno todavía.")
        datos = {k: v for k, v in self.cliente.items() if str(v or "").strip()}
        lineas.append(
            "Datos del cliente: "
            + (", ".join(f"{k}={v}" for k, v in datos.items()) if datos else "ninguno")
        )
        falt = self.faltantes()
        lineas.append("Faltan: " + (", ".join(falt) if falt else "nada (datos completos)"))
        if self.handoff_ts:
            lineas.append(f"Ya se avisó al equipo ({self.handoff_motivo}).")
        return "\n".join(lineas)


def _fila_a_pedido(r: sqlite3.Row) -> Pedido:
    return Pedido(
        id=r["id"],
        jid=r["jid"],
        estado=r["estado"],
        items=[Item(**i) for i in json.loads(r["items"] or "[]")],
        cliente=json.loads(r["cliente"] or "{}"),
        notas=r["notas"] or "",
        handoff_ts=r["handoff_ts"],
        handoff_motivo=r["handoff_motivo"],
        handoff_firma=r["handoff_firma"],
        codigo=r["codigo"] if "codigo" in r.keys() else None,
        canal=(r["canal"] if "canal" in r.keys() else None) or "whatsapp",
    )


def activo(jid: str, crear: bool = True) -> Pedido | None:
    """Pedido vigente del cliente (abierto o esperando asesor, tocado en los últimos días)."""
    ahora = time.time()
    with _lock, _conn() as c:
        r = c.execute(
            f"""SELECT * FROM pedidos WHERE jid=? AND estado IN ({",".join("?" * len(ESTADOS_ACTIVOS))})
                AND actualizado >= ? ORDER BY actualizado DESC LIMIT 1""",
            (jid, *ESTADOS_ACTIVOS, ahora - _VIGENCIA_S),
        ).fetchone()
        if r:
            return _fila_a_pedido(r)
        if not crear:
            return None
        # Datos del cliente de un pedido anterior: no volver a pedírselos.
        previo = c.execute(
            "SELECT cliente FROM pedidos WHERE jid=? ORDER BY actualizado DESC LIMIT 1", (jid,)
        ).fetchone()
        cliente = previo["cliente"] if previo else "{}"
        cur = c.execute(
            "INSERT INTO pedidos (jid, estado, cliente, creado, actualizado, canal) VALUES (?, 'abierto', ?, ?, ?, ?)",
            (jid, cliente, ahora, ahora, "web" if jid.startswith("web:") else "whatsapp"),
        )
        return _fila_a_pedido(c.execute("SELECT * FROM pedidos WHERE id=?", (cur.lastrowid,)).fetchone())


def guardar(p: Pedido) -> None:
    with _lock, _conn() as c:
        c.execute(
            """UPDATE pedidos SET estado=?, items=?, cliente=?, notas=?, actualizado=?,
                   handoff_ts=?, handoff_motivo=?, handoff_firma=? WHERE id=?""",
            (
                p.estado,
                json.dumps([i.__dict__ for i in p.items], ensure_ascii=False),
                json.dumps(p.cliente, ensure_ascii=False),
                p.notas,
                time.time(),
                p.handoff_ts,
                p.handoff_motivo,
                p.handoff_firma,
                p.id,
            ),
        )


def fijar_item(p: Pedido, prod: Presentacion, cantidad: int) -> None:
    """Cantidad absoluta (0 = quitar). El precio se toma del catálogo en este momento."""
    p.items = [i for i in p.items if i.ref.upper() != prod.ref.upper()]
    if cantidad > 0:
        p.items.append(Item(ref=prod.ref, nombre=prod.nombre, precio=prod.precio, cantidad=cantidad))
    if p.estado == "esperando_asesor":
        # El pedido cambió después de avisar: la próxima tarjeta debe salir.
        p.handoff_firma = None


def fijar_cliente(p: Pedido, datos: dict) -> list[str]:
    cambiados = []
    for k in CAMPOS_CLIENTE:
        v = str(datos.get(k) or "").strip()
        if v and v != str(p.cliente.get(k) or ""):
            p.cliente[k] = v[:200]
            cambiados.append(k)
    return cambiados


# --- Pausas: el bot se calla en un chat por un tiempo ---------------------------------


def pausar(jid: str, horas: float, motivo: str) -> None:
    with _lock, _conn() as c:
        c.execute(
            "INSERT INTO pausas (jid, hasta, motivo) VALUES (?, ?, ?) "
            "ON CONFLICT(jid) DO UPDATE SET hasta=excluded.hasta, motivo=excluded.motivo",
            (jid, time.time() + horas * 3600, motivo[:200]),
        )


def pausa_vigente(jids: set[str]) -> tuple[float, str] | None:
    if not jids:
        return None
    with _lock, _conn() as c:
        r = c.execute(
            f"SELECT hasta, motivo FROM pausas WHERE jid IN ({','.join('?' * len(jids))}) "
            "AND hasta > ? ORDER BY hasta DESC LIMIT 1",
            (*jids, time.time()),
        ).fetchone()
    return (r["hasta"], r["motivo"]) if r else None


def quitar_pausa(jids: set[str]) -> None:
    if not jids:
        return
    with _lock, _conn() as c:
        c.execute(f"DELETE FROM pausas WHERE jid IN ({','.join('?' * len(jids))})", tuple(jids))


def registrar_turno(**kw) -> None:
    """Bitácora de cada turno (activo o sombra) para auditar calidad y costo."""
    cols = ("jid", "modo", "entrada", "respuesta", "herramientas", "llamadas", "tokens_in", "tokens_out", "error")
    vals = [kw.get(k) for k in cols]
    try:
        with _lock, _conn() as c:
            c.execute(
                f"INSERT INTO turnos (ts, {', '.join(cols)}) VALUES (?, {', '.join('?' * len(cols))})",
                (time.time(), *vals),
            )
    except Exception as e:  # la bitácora nunca tumba el turno
        print(f"[ventas_wa] no se pudo registrar turno: {e}")


# --- Panel Agente WA -------------------------------------------------------------------


def listar_para_panel(modo: str, dias: int = 7) -> list[dict]:
    """Pedidos con productos o datos, tocados en los últimos días (más recientes primero)."""
    with _lock, _conn(modo) as c:
        filas = c.execute(
            "SELECT * FROM pedidos WHERE actualizado >= ? ORDER BY actualizado DESC LIMIT 200",
            (time.time() - dias * 86400,),
        ).fetchall()
    out = []
    for r in filas:
        p = _fila_a_pedido(r)
        if not p.items and not p.handoff_ts:
            continue
        env = p.envio()
        out.append(
            {
                "id": p.id,
                "jid": p.jid,
                "estado": p.estado,
                "items": [dict(i.__dict__, subtotal=i.subtotal) for i in p.items],
                "cliente": p.cliente,
                "subtotal": p.subtotal,
                "envio": env["costo"] if env else None,
                "envio_zona": env["zona_nombre"] if env else None,
                "total": p.subtotal + env["costo"] if env else None,
                "faltantes": p.faltantes(),
                "handoff_ts": p.handoff_ts,
                "handoff_motivo": p.handoff_motivo,
                "actualizado": r["actualizado"],
                "creado": r["creado"],
            }
        )
    return out


def cambiar_estado(modo: str, pedido_id: int, estado: str) -> bool:
    if estado not in ("abierto", "esperando_asesor", "cerrado", "cancelado"):
        return False
    with _lock, _conn(modo) as c:
        cur = c.execute(
            "UPDATE pedidos SET estado=?, actualizado=? WHERE id=?", (estado, time.time(), int(pedido_id))
        )
        return cur.rowcount > 0


def listar_turnos(modo: str, limite: int = 100) -> list[dict]:
    with _lock, _conn(modo) as c:
        filas = c.execute("SELECT * FROM turnos ORDER BY ts DESC LIMIT ?", (int(limite),)).fetchall()
    return [dict(r) for r in filas]


# --- Continuidad web → WhatsApp ----------------------------------------------------------

_ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # sin 0/O/1/I/L: se dicta y se copia sin errores


def asignar_codigo(p: Pedido) -> str:
    if p.codigo:
        return p.codigo
    import secrets

    for _ in range(20):
        codigo = "WEB-" + "".join(secrets.choice(_ALFABETO) for _ in range(5))
        try:
            with _lock, _conn() as c:
                c.execute("UPDATE pedidos SET codigo=? WHERE id=?", (codigo, p.id))
            p.codigo = codigo
            return codigo
        except sqlite3.IntegrityError:
            continue
    raise RuntimeError("no se pudo generar un código de pedido único")


PAT_CODIGO = re.compile(r"\bWEB-[A-Z2-9]{5}\b", re.I)


def adoptar_pedido_web(codigo: str, jid_whatsapp: str) -> Pedido | None:
    """
    El cliente llegó a WhatsApp con el código de su pedido web: el pedido pasa a
    su chat de WhatsApp (productos + datos) para que el agente no vuelva a preguntar.
    """
    codigo = codigo.strip().upper()
    with _lock, _conn() as c:
        r = c.execute("SELECT * FROM pedidos WHERE UPPER(codigo)=?", (codigo,)).fetchone()
        if not r:
            return None
        origen = _fila_a_pedido(r)
        if origen.jid == jid_whatsapp:
            return origen
    destino = activo(jid_whatsapp)
    for it in origen.items:
        if not any(i.ref.upper() == it.ref.upper() for i in destino.items):
            destino.items.append(it)
    for k, v in origen.cliente.items():
        destino.cliente.setdefault(k, v)
    destino.notas = (destino.notas + f"\nViene del chat web ({codigo}).").strip()
    guardar(destino)
    origen.estado = "cerrado"
    origen.notas = (origen.notas + f"\nContinuó por WhatsApp en {jid_whatsapp}.").strip()
    guardar(origen)
    return destino


# --- Historial del chat web ----------------------------------------------------------------


def guardar_mensaje_web(sesion: str, rol: str, texto: str, pagina: str = "") -> None:
    with _lock, _conn() as c:
        c.execute(
            "INSERT INTO web_mensajes (sesion, ts, rol, texto, pagina) VALUES (?, ?, ?, ?, ?)",
            (sesion, time.time(), rol, (texto or "")[:4000], (pagina or "")[:500]),
        )


def mensajes_web(sesion: str, limite: int = 40) -> list[dict]:
    """Mismo formato que wa_chats.listar_mensajes para reutilizar la transcripción."""
    with _lock, _conn() as c:
        filas = c.execute(
            "SELECT id, ts, rol, texto FROM web_mensajes WHERE sesion=? ORDER BY ts DESC LIMIT ?",
            (sesion, int(limite)),
        ).fetchall()
    out = []
    for r in reversed(filas):
        cliente = r["rol"] == "cliente"
        out.append(
            {
                "id": r["id"],
                "ts": r["ts"],
                "texto": r["texto"],
                "tiene_media": 0,
                "media_mime": "",
                "direccion": "entrada" if cliente else "salida",
                "enviado_por": "cliente" if cliente else "bot",
            }
        )
    return out
