"""
Módulo SQLite para contabilidad: componentes, nómina y servicios públicos.
DB: app/data/contabilidad.db — tablas creadas lazy en init_db().
"""

import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, date

_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "contabilidad.db")
_initialized = False


@contextmanager
def _conn():
    con = sqlite3.connect(_DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def init_db() -> None:
    global _initialized
    if _initialized:
        return
    os.makedirs(os.path.dirname(os.path.abspath(_DB_PATH)), exist_ok=True)
    with _conn() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS componente_costos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre_normalizado TEXT NOT NULL UNIQUE,
            nombre_original TEXT NOT NULL,
            costo_unitario REAL NOT NULL DEFAULT 0,
            categoria TEXT NOT NULL DEFAULT 'material',
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS empleados (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            cargo TEXT NOT NULL DEFAULT '',
            tipo_contrato TEXT NOT NULL DEFAULT 'fijo',
            sueldo_mensual REAL NOT NULL DEFAULT 0,
            activo INTEGER NOT NULL DEFAULT 1,
            fecha_ingreso TEXT,
            notas TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS servicios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            empresa TEXT NOT NULL,
            tipo TEXT NOT NULL,
            numero_contrato TEXT NOT NULL DEFAULT '',
            direccion TEXT NOT NULL DEFAULT '',
            activo INTEGER NOT NULL DEFAULT 1,
            dia_vencimiento INTEGER DEFAULT NULL,
            notas TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS pagos_servicios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            servicio_id INTEGER NOT NULL REFERENCES servicios(id),
            fecha TEXT NOT NULL,
            monto REAL NOT NULL,
            comprobante TEXT DEFAULT '',
            notas TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        """)
    # Migración: columnas añadidas después del schema inicial
    _migraciones = [
        "ALTER TABLE empleados ADD COLUMN usuario_id INTEGER DEFAULT NULL",
        "ALTER TABLE empleados ADD COLUMN dia_pago INTEGER DEFAULT NULL",
        "ALTER TABLE empleados ADD COLUMN telefono_wa TEXT DEFAULT ''",
        "ALTER TABLE componente_costos ADD COLUMN iva_incluido INTEGER DEFAULT 0",
    ]
    with _conn() as con:
        for sql in _migraciones:
            try:
                con.execute(sql)
            except Exception:
                pass  # columna ya existe
    _initialized = True


def _ensure() -> None:
    if not _initialized:
        init_db()


# ─── Componente costos ────────────────────────────────────────────────────────

def _normalizar(nombre: str) -> str:
    return nombre.strip().lower()


def listar_componentes() -> list[dict]:
    _ensure()
    with _conn() as con:
        rows = con.execute(
            "SELECT * FROM componente_costos ORDER BY nombre_original"
        ).fetchall()
    return [dict(r) for r in rows]


def upsert_componente(
    nombre: str,
    costo_unitario: float,
    categoria: str,
    iva_incluido: bool = False,
) -> dict:
    _ensure()
    norm = _normalizar(nombre)
    now = datetime.now().isoformat()
    with _conn() as con:
        con.execute(
            """INSERT INTO componente_costos
                 (nombre_normalizado, nombre_original, costo_unitario, categoria, iva_incluido, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(nombre_normalizado) DO UPDATE SET
                 costo_unitario = excluded.costo_unitario,
                 categoria     = excluded.categoria,
                 iva_incluido  = excluded.iva_incluido,
                 updated_at    = excluded.updated_at""",
            (norm, nombre.strip(), costo_unitario, categoria, int(iva_incluido), now),
        )
        row = con.execute(
            "SELECT * FROM componente_costos WHERE nombre_normalizado = ?", (norm,)
        ).fetchone()
    return dict(row)


def buscar_componente(nombre: str) -> dict | None:
    _ensure()
    norm = _normalizar(nombre)
    with _conn() as con:
        row = con.execute(
            "SELECT * FROM componente_costos WHERE nombre_normalizado = ?", (norm,)
        ).fetchone()
    return dict(row) if row else None


# ─── Nómina ───────────────────────────────────────────────────────────────────

def listar_empleados() -> list[dict]:
    _ensure()
    with _conn() as con:
        rows = con.execute(
            "SELECT * FROM empleados ORDER BY activo DESC, nombre"
        ).fetchall()
    return [dict(r) for r in rows]


def upsert_empleado(data: dict) -> dict:
    _ensure()
    emp_id = data.get("id")
    now = datetime.now().isoformat()
    dia_pago = data.get("dia_pago")
    if dia_pago is not None:
        try:
            dia_pago = int(dia_pago)
            if not 1 <= dia_pago <= 31:
                dia_pago = None
        except (TypeError, ValueError):
            dia_pago = None
    usuario_id = data.get("usuario_id") or None
    telefono_wa = (data.get("telefono_wa") or "").strip()
    with _conn() as con:
        if emp_id:
            con.execute(
                """UPDATE empleados SET
                     nombre = ?, cargo = ?, tipo_contrato = ?,
                     sueldo_mensual = ?, activo = ?, notas = ?,
                     usuario_id = ?, dia_pago = ?, telefono_wa = ?
                   WHERE id = ?""",
                (
                    data.get("nombre", ""),
                    data.get("cargo", ""),
                    data.get("tipo_contrato", "fijo"),
                    float(data.get("sueldo_mensual") or 0),
                    1 if data.get("activo", True) else 0,
                    data.get("notas", ""),
                    usuario_id,
                    dia_pago,
                    telefono_wa,
                    emp_id,
                ),
            )
            row = con.execute("SELECT * FROM empleados WHERE id = ?", (emp_id,)).fetchone()
        else:
            cur = con.execute(
                """INSERT INTO empleados (nombre, cargo, tipo_contrato, sueldo_mensual,
                     activo, notas, usuario_id, dia_pago, telefono_wa, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    data.get("nombre", ""),
                    data.get("cargo", ""),
                    data.get("tipo_contrato", "fijo"),
                    float(data.get("sueldo_mensual") or 0),
                    1 if data.get("activo", True) else 0,
                    data.get("notas", ""),
                    usuario_id,
                    dia_pago,
                    telefono_wa,
                    now,
                ),
            )
            row = con.execute(
                "SELECT * FROM empleados WHERE id = ?", (cur.lastrowid,)
            ).fetchone()
    return dict(row)


def eliminar_empleado(emp_id: int) -> None:
    _ensure()
    with _conn() as con:
        con.execute("UPDATE empleados SET activo = 0 WHERE id = ?", (emp_id,))


def resumen_nomina() -> dict:
    _ensure()
    with _conn() as con:
        row = con.execute(
            "SELECT COUNT(*) as cnt, COALESCE(SUM(sueldo_mensual),0) as total FROM empleados WHERE activo = 1"
        ).fetchone()
    return {"total_mensual": round(row["total"], 2), "activos": row["cnt"]}


# ─── Servicios públicos ───────────────────────────────────────────────────────

def listar_servicios() -> list[dict]:
    _ensure()
    with _conn() as con:
        servicios = con.execute(
            "SELECT * FROM servicios WHERE activo = 1 ORDER BY tipo, empresa"
        ).fetchall()
        result = []
        for s in servicios:
            sd = dict(s)
            pagos = con.execute(
                "SELECT * FROM pagos_servicios WHERE servicio_id = ? ORDER BY fecha DESC LIMIT 3",
                (s["id"],),
            ).fetchall()
            sd["pagos"] = [dict(p) for p in pagos]
            result.append(sd)
    return result


def upsert_servicio(data: dict) -> dict:
    _ensure()
    srv_id = data.get("id")
    now = datetime.now().isoformat()
    with _conn() as con:
        if srv_id:
            con.execute(
                """UPDATE servicios SET
                     empresa = ?, tipo = ?, numero_contrato = ?,
                     direccion = ?, activo = ?, dia_vencimiento = ?, notas = ?
                   WHERE id = ?""",
                (
                    data.get("empresa", ""),
                    data.get("tipo", "otro"),
                    data.get("numero_contrato", ""),
                    data.get("direccion", ""),
                    1 if data.get("activo", True) else 0,
                    data.get("dia_vencimiento"),
                    data.get("notas", ""),
                    srv_id,
                ),
            )
            row = con.execute("SELECT * FROM servicios WHERE id = ?", (srv_id,)).fetchone()
        else:
            cur = con.execute(
                """INSERT INTO servicios (empresa, tipo, numero_contrato, direccion,
                     activo, dia_vencimiento, notas, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    data.get("empresa", ""),
                    data.get("tipo", "otro"),
                    data.get("numero_contrato", ""),
                    data.get("direccion", ""),
                    1 if data.get("activo", True) else 0,
                    data.get("dia_vencimiento"),
                    data.get("notas", ""),
                    now,
                ),
            )
            row = con.execute(
                "SELECT * FROM servicios WHERE id = ?", (cur.lastrowid,)
            ).fetchone()
    return dict(row)


def eliminar_servicio(srv_id: int) -> None:
    _ensure()
    with _conn() as con:
        con.execute("UPDATE servicios SET activo = 0 WHERE id = ?", (srv_id,))


def registrar_pago(srv_id: int, fecha: str, monto: float, comprobante: str = "", notas: str = "") -> dict:
    _ensure()
    now = datetime.now().isoformat()
    with _conn() as con:
        cur = con.execute(
            """INSERT INTO pagos_servicios (servicio_id, fecha, monto, comprobante, notas, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (srv_id, fecha, monto, comprobante, notas, now),
        )
        row = con.execute(
            "SELECT * FROM pagos_servicios WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
    return dict(row)


def eliminar_pago(pago_id: int) -> None:
    _ensure()
    with _conn() as con:
        con.execute("DELETE FROM pagos_servicios WHERE id = ?", (pago_id,))


def servicios_proximos_vencimiento(dias: int = 3) -> list[dict]:
    """Retorna servicios cuyo dia_vencimiento cae dentro de `dias` días y sin pago este mes."""
    _ensure()
    hoy = date.today()
    anio, mes = hoy.year, hoy.month
    if mes < 12:
        dias_en_mes = (date(anio, mes + 1, 1) - date(anio, mes, 1)).days
    else:
        dias_en_mes = 31
    resultado = []
    with _conn() as con:
        servicios = con.execute(
            "SELECT * FROM servicios WHERE activo = 1 AND dia_vencimiento IS NOT NULL"
        ).fetchall()
        for s in servicios:
            dia = s["dia_vencimiento"]
            venc = date(anio, mes, min(dia, dias_en_mes))
            if venc < hoy:
                next_mes = mes % 12 + 1
                next_anio = anio + (1 if mes == 12 else 0)
                if next_mes < 12:
                    dias_next = (date(next_anio, next_mes + 1, 1) - date(next_anio, next_mes, 1)).days
                else:
                    dias_next = 31
                venc = date(next_anio, next_mes, min(dia, dias_next))
            delta = (venc - hoy).days
            if 0 <= delta <= dias:
                pago_mes = con.execute(
                    """SELECT COUNT(*) as cnt FROM pagos_servicios
                       WHERE servicio_id = ? AND fecha LIKE ?""",
                    (s["id"], f"{anio}-{mes:02d}-%"),
                ).fetchone()
                if pago_mes["cnt"] == 0:
                    resultado.append({**dict(s), "dias_para_vencer": delta, "fecha_vencimiento": str(venc)})
    return resultado
