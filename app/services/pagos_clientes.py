"""
Registro durable de los pagos que los clientes confirman por WhatsApp.

Antes el flujo «cliente manda comprobante → grupo → ok/no <3 dígitos>» vivía solo en
`pagos_pendientes_confirmacion` (un dict en memoria de routes.py): un reinicio borraba los
pendientes y de la decisión solo quedaba un contador del día. Aquí cada comprobante queda
con cliente, hora, imagen y quién decidió — y una bandeja en la Agenda lo muestra
(GET /api/tickets/pagos-clientes). El dict sigue siendo el caché de trabajo; esta tabla es
el registro (evaluación del 24-sep-2026, «Del chat al registro»).

Datos: app/data/pagos_clientes.db (fuera de git). Sin LLM.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
from datetime import datetime, timedelta

_DB = os.path.join(os.path.dirname(__file__), "..", "data", "pagos_clientes.db")
_lock = threading.Lock()

# Un comprobante sin decisión tras este plazo se marca vencido (el operador resolvió por otra vía).
VENCE_HORAS = 72


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(_DB, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute(
        """CREATE TABLE IF NOT EXISTS pagos_clientes (
            id INTEGER PRIMARY KEY,
            creado_en TEXT NOT NULL DEFAULT (datetime('now')),
            numero_cliente TEXT NOT NULL,
            codigo TEXT NOT NULL,
            estado TEXT NOT NULL DEFAULT 'pendiente',
            comprobante_path TEXT DEFAULT '',
            analisis_json TEXT DEFAULT '',
            monto_detectado REAL,
            decidido_en TEXT,
            decidido_por_uid INTEGER,
            decidido_por_nombre TEXT DEFAULT '',
            nota TEXT DEFAULT ''
        )"""
    )
    return c


def _solo_digitos(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def _monto_de(analisis: dict | None) -> float | None:
    for k in ("monto", "valor", "monto_detectado", "total"):
        v = (analisis or {}).get(k)
        try:
            if v and float(v) > 0:
                return float(v)
        except (TypeError, ValueError):
            continue
    return None


def registrar_comprobante(numero_cliente: str, codigo: str, comprobante_path: str = "",
                          analisis: dict | None = None) -> int:
    """El cliente mandó un comprobante: nace la fila 'pendiente'."""
    with _lock, _conn() as c:
        cur = c.execute(
            "INSERT INTO pagos_clientes (numero_cliente, codigo, comprobante_path, analisis_json, monto_detectado)"
            " VALUES (?,?,?,?,?)",
            (str(numero_cliente or ""), str(codigo or ""), str(comprobante_path or "")[:500],
             json.dumps(analisis or {}, ensure_ascii=False, default=str)[:4000], _monto_de(analisis)),
        )
        c.commit()
        return int(cur.lastrowid)


def decidir(numero_cliente: str, estado: str, *, autor_telefono: str = "", nota: str = "") -> dict | None:
    """Cierra el pendiente más reciente de ese cliente como confirmado/rechazado, con quién decidió."""
    if estado not in ("confirmado", "rechazado"):
        raise ValueError("estado debe ser confirmado o rechazado")
    uid, nombre = usuario_por_telefono(autor_telefono)
    with _lock, _conn() as c:
        fila = c.execute(
            "SELECT id FROM pagos_clientes WHERE numero_cliente=? AND estado='pendiente' ORDER BY id DESC LIMIT 1",
            (str(numero_cliente or ""),),
        ).fetchone()
        if not fila:
            return None
        c.execute(
            "UPDATE pagos_clientes SET estado=?, decidido_en=datetime('now'), decidido_por_uid=?,"
            " decidido_por_nombre=?, nota=? WHERE id=?",
            (estado, uid, nombre, str(nota or "")[:300], fila["id"]),
        )
        c.commit()
        return dict(c.execute("SELECT * FROM pagos_clientes WHERE id=?", (fila["id"],)).fetchone())


def pendientes() -> list[dict]:
    """Pendientes vigentes (y de paso vence los viejos). Para reconstruir el caché al arrancar."""
    with _lock, _conn() as c:
        c.execute(
            "UPDATE pagos_clientes SET estado='vencido', decidido_en=datetime('now') "
            "WHERE estado='pendiente' AND creado_en < ?",
            ((datetime.utcnow() - timedelta(hours=VENCE_HORAS)).strftime("%Y-%m-%d %H:%M:%S"),),
        )
        c.commit()
        return [dict(r) for r in c.execute(
            "SELECT * FROM pagos_clientes WHERE estado='pendiente' ORDER BY id DESC")]


def listar(dias: int = 7) -> list[dict]:
    with _lock, _conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT * FROM pagos_clientes WHERE creado_en > datetime('now', ?) ORDER BY id DESC LIMIT 200",
            (f"-{int(dias)} days",),
        )]


def usuario_por_telefono(telefono_o_jid: str) -> tuple[int | None, str]:
    """Mapea un teléfono/JID de WhatsApp al usuario del panel (usuarios.telefono)."""
    dig = _solo_digitos(telefono_o_jid)
    if len(dig) < 10:
        return None, ""
    try:
        from app.services import tickets_db

        with sqlite3.connect(f"file:{tickets_db.DB_PATH}?mode=ro", uri=True, timeout=10) as c:
            c.row_factory = sqlite3.Row
            for r in c.execute("SELECT id, nombre, username, telefono FROM usuarios WHERE activo=1 AND telefono IS NOT NULL"):
                t = _solo_digitos(r["telefono"])
                if t and (dig.endswith(t[-10:]) or t.endswith(dig[-10:])):
                    return int(r["id"]), str(r["nombre"] or r["username"] or "")
    except Exception:
        pass
    return None, ""


def registrar_actividad_wa(telefono_o_jid: str, *, tipo: str = "comando_wa", detalle: str = "",
                           ts: float | None = None) -> bool:
    """Un comando o mensaje de un miembro del equipo por WhatsApp cuenta como actividad
    (suma a su control de horas). Solo en tiempo real: un mensaje viejo (sync) no se anota,
    porque el evento quedaría con la hora de ahora y falsearía las horas."""
    if ts is not None and abs(datetime.utcnow().timestamp() - float(ts)) > 600:
        return False
    uid, _ = usuario_por_telefono(telefono_o_jid)
    if not uid:
        return False
    try:
        from app.services.panel_presencia import registrar_evento_panel

        registrar_evento_panel(uid, tipo, panel="whatsapp", detalle=str(detalle or "")[:200])
        return True
    except Exception:
        return False
