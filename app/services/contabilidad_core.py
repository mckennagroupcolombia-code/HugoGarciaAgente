"""
Contabilidad de partida doble: plan de cuentas, terceros, medios de pago y
movimientos (asientos) con líneas débito/crédito.

Misma base que `contabilidad_db.py` (app/data/contabilidad.db), tablas propias
prefijadas `cc_` para no colisionar con las existentes. Este módulo NO reemplaza
el "libro" de solo lectura de `contabilidad_ledger.py` (que agrega Siigo/MeLi/web
en vivo) — es un libro mayor propio, con partida doble real, para los movimientos
que la empresa registra directamente aquí (compras a socios, giros, ingresos y
egresos manuales, etc.).

Plantillas de negocio soportadas explícitamente:
  - `registrar_compra_socio_amazon`: un socio compra mercancía a nombre propio
    (p.ej. Amazon EEUU, sin trámite de importación) y se la "vende" a McKenna con
    una comisión. Se registra como pasivo (cuenta por pagar al socio), NO como
    gasto directo — el giro posterior se hace con `registrar_pago_socio`.
  - `registrar_compra_proveedor`: compra genérica a un tercero (proveedor externo
    o un socio actuando como proveedor, p.ej. Armando vendiendo manteca de cacao
    ya transformada — el costeo de producción del socio no entra a McKenna).
"""

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime

_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "contabilidad.db")
_initialized = False

TIPOS_CUENTA = ("activo", "pasivo", "patrimonio", "ingreso", "gasto", "costo")
NATURALEZAS = ("debito", "credito")
TIPOS_TERCERO = ("proveedor", "cliente", "socio", "empleado", "otro")


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
        CREATE TABLE IF NOT EXISTS cc_plan_cuentas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo TEXT NOT NULL UNIQUE,
            nombre TEXT NOT NULL,
            tipo TEXT NOT NULL,
            naturaleza TEXT NOT NULL,
            cuenta_padre_id INTEGER REFERENCES cc_plan_cuentas(id),
            es_movimiento INTEGER NOT NULL DEFAULT 1,
            activa INTEGER NOT NULL DEFAULT 1,
            notas TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS cc_terceros (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            tipo TEXT NOT NULL DEFAULT 'proveedor',
            identificacion TEXT NOT NULL DEFAULT '',
            telefono TEXT NOT NULL DEFAULT '',
            email TEXT NOT NULL DEFAULT '',
            cuenta_bancaria TEXT NOT NULL DEFAULT '',
            cuenta_por_pagar_id INTEGER REFERENCES cc_plan_cuentas(id),
            notas TEXT NOT NULL DEFAULT '',
            activo INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS cc_medios_pago (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL UNIQUE,
            tipo TEXT NOT NULL DEFAULT 'banco',
            cuenta_id INTEGER NOT NULL REFERENCES cc_plan_cuentas(id),
            activo INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS cc_movimientos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha TEXT NOT NULL,
            concepto TEXT NOT NULL,
            tipo_origen TEXT NOT NULL DEFAULT 'manual',
            tercero_id INTEGER REFERENCES cc_terceros(id),
            referencia TEXT NOT NULL DEFAULT '',
            plantilla_datos_json TEXT NOT NULL DEFAULT '',
            estado TEXT NOT NULL DEFAULT 'confirmado',
            created_by INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS cc_movimiento_lineas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            movimiento_id INTEGER NOT NULL REFERENCES cc_movimientos(id) ON DELETE CASCADE,
            cuenta_id INTEGER NOT NULL REFERENCES cc_plan_cuentas(id),
            tercero_id INTEGER REFERENCES cc_terceros(id),
            debito REAL NOT NULL DEFAULT 0,
            credito REAL NOT NULL DEFAULT 0,
            descripcion TEXT NOT NULL DEFAULT '',
            orden INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_cc_lineas_cuenta ON cc_movimiento_lineas(cuenta_id);
        CREATE INDEX IF NOT EXISTS idx_cc_lineas_movimiento ON cc_movimiento_lineas(movimiento_id);
        CREATE INDEX IF NOT EXISTS idx_cc_lineas_tercero ON cc_movimiento_lineas(tercero_id);
        CREATE INDEX IF NOT EXISTS idx_cc_movimientos_fecha ON cc_movimientos(fecha);
        """)
    _sembrar_datos_iniciales()
    _initialized = True


def _ensure() -> None:
    if not _initialized:
        init_db()


def _sembrar_datos_iniciales() -> None:
    """Plan de cuentas base (PUC colombiano simplificado) + terceros socios + medios de pago,
    solo si la tabla está vacía (primera vez que se usa el módulo)."""
    with _conn() as con:
        ya = con.execute("SELECT COUNT(*) AS n FROM cc_plan_cuentas").fetchone()["n"]
        if ya:
            return
        cuentas = [
            ("1105", "Caja", "activo", "debito"),
            ("1110", "Bancos", "activo", "debito"),
            ("1355", "Cuentas por cobrar - socios", "activo", "debito"),
            ("1435", "Inventarios - Mercancías", "activo", "debito"),
            ("1436", "Inventarios - Materia prima (cacao / manteca)", "activo", "debito"),
            ("2205", "Proveedores nacionales", "pasivo", "credito"),
            ("2380", "Cuentas por pagar - socios", "pasivo", "credito"),
            ("2367", "Costos y gastos por pagar", "pasivo", "credito"),
            ("3115", "Aportes sociales", "patrimonio", "credito"),
            ("4135", "Ingresos por venta de mercancías", "ingreso", "credito"),
            ("4295", "Ingresos diversos", "ingreso", "credito"),
            ("5135", "Gastos - Servicios", "gasto", "debito"),
            ("5195", "Gastos diversos", "gasto", "debito"),
            ("5305", "Gastos financieros", "gasto", "debito"),
            ("6135", "Costo de mercancía vendida", "costo", "debito"),
            ("6205", "Costo materia prima transformada (cacao)", "costo", "debito"),
        ]
        for codigo, nombre, tipo, naturaleza in cuentas:
            con.execute(
                """INSERT OR IGNORE INTO cc_plan_cuentas
                     (codigo, nombre, tipo, naturaleza, es_movimiento, activa)
                   VALUES (?, ?, ?, ?, 1, 1)""",
                (codigo, nombre, tipo, naturaleza),
            )
        caja_id = con.execute("SELECT id FROM cc_plan_cuentas WHERE codigo='1105'").fetchone()["id"]
        banco_id = con.execute("SELECT id FROM cc_plan_cuentas WHERE codigo='1110'").fetchone()["id"]
        pasivo_socios_id = con.execute(
            "SELECT id FROM cc_plan_cuentas WHERE codigo='2380'"
        ).fetchone()["id"]

        con.execute(
            "INSERT INTO cc_medios_pago (nombre, tipo, cuenta_id, activo) VALUES (?, ?, ?, 1)",
            ("Caja general", "caja", caja_id),
        )
        con.execute(
            "INSERT INTO cc_medios_pago (nombre, tipo, cuenta_id, activo) VALUES (?, ?, ?, 1)",
            ("Banco principal", "banco", banco_id),
        )
        for nombre in ("Cynthia", "Armando"):
            con.execute(
                """INSERT INTO cc_terceros (nombre, tipo, cuenta_por_pagar_id, notas, activo)
                   VALUES (?, 'socio', ?, ?, 1)""",
                (nombre, pasivo_socios_id, "Socio McKenna Group — creado por seed inicial"),
            )


def _cuenta_id_por_codigo(con: sqlite3.Connection, codigo: str) -> int | None:
    row = con.execute("SELECT id FROM cc_plan_cuentas WHERE codigo=?", (codigo,)).fetchone()
    return row["id"] if row else None


# ─── Plan de cuentas ────────────────────────────────────────────────────────

def _naturaleza_por_tipo(tipo: str) -> str:
    return "debito" if tipo in ("activo", "gasto", "costo") else "credito"


def listar_plan_cuentas(solo_activas: bool = True, tipo: str | None = None) -> list[dict]:
    _ensure()
    where = []
    params: list = []
    if solo_activas:
        where.append("activa = 1")
    if tipo:
        where.append("tipo = ?")
        params.append(tipo)
    sql = "SELECT * FROM cc_plan_cuentas"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY codigo"
    with _conn() as con:
        rows = con.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def obtener_cuenta(cuenta_id: int) -> dict | None:
    _ensure()
    with _conn() as con:
        row = con.execute("SELECT * FROM cc_plan_cuentas WHERE id=?", (cuenta_id,)).fetchone()
    return dict(row) if row else None


def crear_cuenta(payload: dict) -> dict:
    _ensure()
    codigo = str(payload.get("codigo") or "").strip()
    nombre = str(payload.get("nombre") or "").strip()
    tipo = str(payload.get("tipo") or "").strip()
    if not codigo or not nombre:
        raise ValueError("codigo y nombre son requeridos")
    if tipo not in TIPOS_CUENTA:
        raise ValueError(f"tipo inválido, debe ser uno de: {', '.join(TIPOS_CUENTA)}")
    naturaleza = str(payload.get("naturaleza") or _naturaleza_por_tipo(tipo))
    if naturaleza not in NATURALEZAS:
        raise ValueError("naturaleza inválida")
    with _conn() as con:
        existe = con.execute("SELECT id FROM cc_plan_cuentas WHERE codigo=?", (codigo,)).fetchone()
        if existe:
            raise ValueError(f"Ya existe una cuenta con código {codigo}")
        cur = con.execute(
            """INSERT INTO cc_plan_cuentas
                 (codigo, nombre, tipo, naturaleza, cuenta_padre_id, es_movimiento, activa, notas)
               VALUES (?, ?, ?, ?, ?, ?, 1, ?)""",
            (
                codigo,
                nombre,
                tipo,
                naturaleza,
                int(payload["cuenta_padre_id"]) if payload.get("cuenta_padre_id") else None,
                1 if payload.get("es_movimiento", True) else 0,
                str(payload.get("notas") or "").strip(),
            ),
        )
        cuenta_id = cur.lastrowid
    return obtener_cuenta(cuenta_id)


def actualizar_cuenta(cuenta_id: int, payload: dict) -> dict:
    _ensure()
    actual = obtener_cuenta(cuenta_id)
    if not actual:
        raise ValueError("Cuenta no encontrada")
    campos: dict = {}
    for k in ("nombre", "notas"):
        if k in payload:
            campos[k] = str(payload[k] or "").strip()
    if "activa" in payload:
        campos["activa"] = 1 if payload["activa"] else 0
    if "es_movimiento" in payload:
        campos["es_movimiento"] = 1 if payload["es_movimiento"] else 0
    if not campos:
        return actual
    sets = ", ".join(f"{k} = ?" for k in campos)
    with _conn() as con:
        con.execute(f"UPDATE cc_plan_cuentas SET {sets} WHERE id=?", (*campos.values(), cuenta_id))
    return obtener_cuenta(cuenta_id)


def eliminar_cuenta(cuenta_id: int) -> bool:
    _ensure()
    with _conn() as con:
        usada = con.execute(
            "SELECT 1 FROM cc_movimiento_lineas WHERE cuenta_id=? LIMIT 1", (cuenta_id,)
        ).fetchone()
        if usada:
            raise ValueError(
                "No se puede eliminar: la cuenta tiene movimientos registrados. Desactívala en su lugar."
            )
        cur = con.execute("DELETE FROM cc_plan_cuentas WHERE id=?", (cuenta_id,))
        return cur.rowcount > 0


# ─── Terceros ───────────────────────────────────────────────────────────────

def listar_terceros(
    tipo: str | None = None, q: str | None = None, solo_activos: bool = True
) -> list[dict]:
    _ensure()
    where = []
    params: list = []
    if solo_activos:
        where.append("activo = 1")
    if tipo:
        where.append("tipo = ?")
        params.append(tipo)
    if q:
        where.append("nombre LIKE ?")
        params.append(f"%{q}%")
    sql = "SELECT * FROM cc_terceros"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY nombre"
    with _conn() as con:
        rows = con.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def obtener_tercero(tercero_id: int) -> dict | None:
    _ensure()
    with _conn() as con:
        row = con.execute("SELECT * FROM cc_terceros WHERE id=?", (tercero_id,)).fetchone()
    return dict(row) if row else None


def crear_tercero(payload: dict) -> dict:
    _ensure()
    nombre = str(payload.get("nombre") or "").strip()
    if not nombre:
        raise ValueError("nombre requerido")
    tipo = str(payload.get("tipo") or "proveedor").strip()
    if tipo not in TIPOS_TERCERO:
        raise ValueError(f"tipo inválido, debe ser uno de: {', '.join(TIPOS_TERCERO)}")
    with _conn() as con:
        cur = con.execute(
            """INSERT INTO cc_terceros
                 (nombre, tipo, identificacion, telefono, email, cuenta_bancaria,
                  cuenta_por_pagar_id, notas, activo)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)""",
            (
                nombre,
                tipo,
                str(payload.get("identificacion") or "").strip(),
                str(payload.get("telefono") or "").strip(),
                str(payload.get("email") or "").strip(),
                str(payload.get("cuenta_bancaria") or "").strip(),
                int(payload["cuenta_por_pagar_id"]) if payload.get("cuenta_por_pagar_id") else None,
                str(payload.get("notas") or "").strip(),
            ),
        )
        tercero_id = cur.lastrowid
    return obtener_tercero(tercero_id)


def actualizar_tercero(tercero_id: int, payload: dict) -> dict:
    _ensure()
    actual = obtener_tercero(tercero_id)
    if not actual:
        raise ValueError("Tercero no encontrado")
    campos: dict = {}
    for k in ("nombre", "tipo", "identificacion", "telefono", "email", "cuenta_bancaria", "notas"):
        if k in payload:
            campos[k] = str(payload[k] or "").strip()
    if campos.get("tipo") and campos["tipo"] not in TIPOS_TERCERO:
        raise ValueError(f"tipo inválido, debe ser uno de: {', '.join(TIPOS_TERCERO)}")
    if "cuenta_por_pagar_id" in payload:
        campos["cuenta_por_pagar_id"] = (
            int(payload["cuenta_por_pagar_id"]) if payload["cuenta_por_pagar_id"] else None
        )
    if "activo" in payload:
        campos["activo"] = 1 if payload["activo"] else 0
    if not campos:
        return actual
    sets = ", ".join(f"{k} = ?" for k in campos)
    with _conn() as con:
        con.execute(f"UPDATE cc_terceros SET {sets} WHERE id=?", (*campos.values(), tercero_id))
    return obtener_tercero(tercero_id)


def eliminar_tercero(tercero_id: int) -> bool:
    """Desactiva (soft-delete): preserva la trazabilidad de movimientos ya registrados."""
    _ensure()
    with _conn() as con:
        cur = con.execute("UPDATE cc_terceros SET activo=0 WHERE id=?", (tercero_id,))
        return cur.rowcount > 0


# ─── Medios de pago ─────────────────────────────────────────────────────────

def listar_medios_pago(solo_activos: bool = True) -> list[dict]:
    _ensure()
    sql = (
        "SELECT mp.*, pc.codigo AS cuenta_codigo, pc.nombre AS cuenta_nombre "
        "FROM cc_medios_pago mp JOIN cc_plan_cuentas pc ON pc.id = mp.cuenta_id"
    )
    if solo_activos:
        sql += " WHERE mp.activo = 1"
    sql += " ORDER BY mp.nombre"
    with _conn() as con:
        rows = con.execute(sql).fetchall()
    return [dict(r) for r in rows]


def obtener_medio_pago(medio_pago_id: int) -> dict | None:
    _ensure()
    with _conn() as con:
        row = con.execute(
            """SELECT mp.*, pc.codigo AS cuenta_codigo, pc.nombre AS cuenta_nombre
                 FROM cc_medios_pago mp JOIN cc_plan_cuentas pc ON pc.id = mp.cuenta_id
                WHERE mp.id=?""",
            (medio_pago_id,),
        ).fetchone()
    return dict(row) if row else None


def crear_medio_pago(payload: dict) -> dict:
    _ensure()
    nombre = str(payload.get("nombre") or "").strip()
    cuenta_id = payload.get("cuenta_id")
    if not nombre or not cuenta_id:
        raise ValueError("nombre y cuenta_id son requeridos")
    tipo = str(payload.get("tipo") or "banco").strip()
    with _conn() as con:
        cur = con.execute(
            "INSERT INTO cc_medios_pago (nombre, tipo, cuenta_id, activo) VALUES (?, ?, ?, 1)",
            (nombre, tipo, int(cuenta_id)),
        )
        medio_id = cur.lastrowid
    return obtener_medio_pago(medio_id)


def actualizar_medio_pago(medio_pago_id: int, payload: dict) -> dict:
    _ensure()
    actual = obtener_medio_pago(medio_pago_id)
    if not actual:
        raise ValueError("Medio de pago no encontrado")
    campos: dict = {}
    if "nombre" in payload:
        campos["nombre"] = str(payload["nombre"] or "").strip()
    if "tipo" in payload:
        campos["tipo"] = str(payload["tipo"] or "").strip()
    if "activo" in payload:
        campos["activo"] = 1 if payload["activo"] else 0
    if not campos:
        return actual
    sets = ", ".join(f"{k} = ?" for k in campos)
    with _conn() as con:
        con.execute(f"UPDATE cc_medios_pago SET {sets} WHERE id=?", (*campos.values(), medio_pago_id))
    return obtener_medio_pago(medio_pago_id)


# ─── Movimientos (asientos) ─────────────────────────────────────────────────

def crear_movimiento(
    fecha: str,
    concepto: str,
    lineas: list[dict],
    tercero_id: int | None = None,
    referencia: str = "",
    tipo_origen: str = "manual",
    plantilla_datos: dict | None = None,
    created_by: int | None = None,
) -> dict:
    """Crea un asiento contable validando partida doble (suma débitos == suma créditos)."""
    _ensure()
    fecha = (fecha or "").strip()
    concepto = (concepto or "").strip()
    if not fecha:
        raise ValueError("fecha requerida (YYYY-MM-DD)")
    if not concepto:
        raise ValueError("concepto requerido")
    if not lineas or len(lineas) < 2:
        raise ValueError("Se requieren al menos 2 líneas (débito y crédito)")

    limpio: list[dict] = []
    total_debito = 0.0
    total_credito = 0.0
    with _conn() as con:
        cuentas_ids = {int(l["cuenta_id"]) for l in lineas if l.get("cuenta_id")}
        cuentas_map: dict[int, dict] = {}
        for cid in cuentas_ids:
            row = con.execute("SELECT * FROM cc_plan_cuentas WHERE id=?", (cid,)).fetchone()
            if not row:
                raise ValueError(f"Cuenta contable {cid} no existe")
            if not row["activa"]:
                raise ValueError(f"Cuenta {row['codigo']} {row['nombre']} está inactiva")
            if not row["es_movimiento"]:
                raise ValueError(
                    f"Cuenta {row['codigo']} {row['nombre']} es agrupadora, no admite movimientos"
                )
            cuentas_map[cid] = dict(row)

        for i, l in enumerate(lineas):
            cid = int(l.get("cuenta_id") or 0)
            if cid not in cuentas_map:
                raise ValueError(f"Línea {i + 1}: cuenta_id inválido")
            debito = round(float(l.get("debito") or 0), 2)
            credito = round(float(l.get("credito") or 0), 2)
            if debito < 0 or credito < 0:
                raise ValueError(f"Línea {i + 1}: los montos no pueden ser negativos")
            if debito > 0 and credito > 0:
                raise ValueError(f"Línea {i + 1}: no puede tener débito y crédito a la vez")
            if debito == 0 and credito == 0:
                raise ValueError(f"Línea {i + 1}: debe tener débito o crédito mayor a 0")
            total_debito += debito
            total_credito += credito
            limpio.append(
                {
                    "cuenta_id": cid,
                    "tercero_id": int(l["tercero_id"]) if l.get("tercero_id") else None,
                    "debito": debito,
                    "credito": credito,
                    "descripcion": str(l.get("descripcion") or "").strip(),
                    "orden": i,
                }
            )

        if round(total_debito, 2) != round(total_credito, 2):
            raise ValueError(
                f"El movimiento no cuadra: débitos {total_debito:.2f} ≠ créditos {total_credito:.2f}"
            )

        cur = con.execute(
            """INSERT INTO cc_movimientos
                 (fecha, concepto, tipo_origen, tercero_id, referencia, plantilla_datos_json,
                  estado, created_by, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 'confirmado', ?, ?)""",
            (
                fecha,
                concepto,
                tipo_origen,
                int(tercero_id) if tercero_id else None,
                referencia.strip(),
                json.dumps(plantilla_datos or {}, ensure_ascii=False, default=str),
                int(created_by) if created_by else None,
                datetime.now().isoformat(timespec="seconds"),
            ),
        )
        mov_id = cur.lastrowid
        for l in limpio:
            con.execute(
                """INSERT INTO cc_movimiento_lineas
                     (movimiento_id, cuenta_id, tercero_id, debito, credito, descripcion, orden)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (mov_id, l["cuenta_id"], l["tercero_id"], l["debito"], l["credito"], l["descripcion"], l["orden"]),
            )
    return obtener_movimiento(mov_id)


def obtener_movimiento(movimiento_id: int) -> dict | None:
    _ensure()
    with _conn() as con:
        mov = con.execute("SELECT * FROM cc_movimientos WHERE id=?", (movimiento_id,)).fetchone()
        if not mov:
            return None
        lineas = con.execute(
            """SELECT ml.*, pc.codigo AS cuenta_codigo, pc.nombre AS cuenta_nombre,
                      pc.tipo AS cuenta_tipo, pc.naturaleza AS cuenta_naturaleza,
                      t.nombre AS tercero_nombre
                 FROM cc_movimiento_lineas ml
                 JOIN cc_plan_cuentas pc ON pc.id = ml.cuenta_id
                 LEFT JOIN cc_terceros t ON t.id = ml.tercero_id
                WHERE ml.movimiento_id=?
                ORDER BY ml.orden""",
            (movimiento_id,),
        ).fetchall()
        tercero = None
        if mov["tercero_id"]:
            trow = con.execute("SELECT * FROM cc_terceros WHERE id=?", (mov["tercero_id"],)).fetchone()
            tercero = dict(trow) if trow else None
    d = dict(mov)
    d["lineas"] = [dict(r) for r in lineas]
    d["tercero"] = tercero
    d["total_debito"] = round(sum(x["debito"] for x in d["lineas"]), 2)
    d["total_credito"] = round(sum(x["credito"] for x in d["lineas"]), 2)
    return d


def listar_movimientos(
    desde: str | None = None,
    hasta: str | None = None,
    tercero_id: int | None = None,
    cuenta_id: int | None = None,
    tipo_origen: str | None = None,
    q: str | None = None,
    incluir_anulados: bool = False,
    limit: int = 300,
) -> list[dict]:
    _ensure()
    where = []
    params: list = []
    if desde:
        where.append("m.fecha >= ?")
        params.append(desde)
    if hasta:
        where.append("m.fecha <= ?")
        params.append(hasta)
    if tercero_id:
        where.append("m.tercero_id = ?")
        params.append(int(tercero_id))
    if tipo_origen:
        where.append("m.tipo_origen = ?")
        params.append(tipo_origen)
    if q:
        where.append("m.concepto LIKE ?")
        params.append(f"%{q}%")
    if not incluir_anulados:
        where.append("m.estado != 'anulado'")
    if cuenta_id:
        where.append("m.id IN (SELECT movimiento_id FROM cc_movimiento_lineas WHERE cuenta_id=?)")
        params.append(int(cuenta_id))
    sql = "SELECT * FROM cc_movimientos m"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY m.fecha DESC, m.id DESC LIMIT ?"
    params.append(int(limit))
    with _conn() as con:
        movs = [dict(r) for r in con.execute(sql, params).fetchall()]
        if not movs:
            return []
        ids = [m["id"] for m in movs]
        placeholders = ",".join("?" * len(ids))
        lineas = con.execute(
            f"""SELECT ml.*, pc.codigo AS cuenta_codigo, pc.nombre AS cuenta_nombre,
                       t.nombre AS tercero_nombre
                  FROM cc_movimiento_lineas ml
                  JOIN cc_plan_cuentas pc ON pc.id = ml.cuenta_id
                  LEFT JOIN cc_terceros t ON t.id = ml.tercero_id
                 WHERE ml.movimiento_id IN ({placeholders})
                 ORDER BY ml.movimiento_id, ml.orden""",
            ids,
        ).fetchall()
        terceros_ids = {m["tercero_id"] for m in movs if m["tercero_id"]}
        terceros_map: dict[int, dict] = {}
        if terceros_ids:
            tph = ",".join("?" * len(terceros_ids))
            for r in con.execute(f"SELECT * FROM cc_terceros WHERE id IN ({tph})", list(terceros_ids)):
                terceros_map[r["id"]] = dict(r)
    by_mov: dict[int, list[dict]] = {}
    for l in lineas:
        by_mov.setdefault(l["movimiento_id"], []).append(dict(l))
    out = []
    for m in movs:
        ls = by_mov.get(m["id"], [])
        m["lineas"] = ls
        m["total_debito"] = round(sum(x["debito"] for x in ls), 2)
        m["total_credito"] = round(sum(x["credito"] for x in ls), 2)
        m["tercero"] = terceros_map.get(m["tercero_id"]) if m["tercero_id"] else None
        out.append(m)
    return out


def anular_movimiento(movimiento_id: int) -> dict:
    """Marca el asiento como anulado (queda en el histórico, pero sale de mayor/balance)."""
    _ensure()
    with _conn() as con:
        cur = con.execute("UPDATE cc_movimientos SET estado='anulado' WHERE id=?", (movimiento_id,))
        if cur.rowcount == 0:
            raise ValueError("Movimiento no encontrado")
    return obtener_movimiento(movimiento_id)


def eliminar_movimiento(movimiento_id: int) -> bool:
    _ensure()
    with _conn() as con:
        cur = con.execute("DELETE FROM cc_movimientos WHERE id=?", (movimiento_id,))
        return cur.rowcount > 0


# ─── Cuentas T / Libro mayor / Balance de comprobación ─────────────────────

def mayor_cuenta(cuenta_id: int, desde: str | None = None, hasta: str | None = None) -> dict:
    """Cuenta T de una cuenta contable: saldo inicial (antes de `desde`) + movimientos
    del rango con saldo corrido, según la naturaleza (débito o crédito) de la cuenta."""
    _ensure()
    with _conn() as con:
        cuenta = con.execute("SELECT * FROM cc_plan_cuentas WHERE id=?", (cuenta_id,)).fetchone()
        if not cuenta:
            raise ValueError("Cuenta no encontrada")
        cuenta = dict(cuenta)
        naturaleza = cuenta["naturaleza"]

        saldo_inicial = 0.0
        if desde:
            row = con.execute(
                """SELECT COALESCE(SUM(ml.debito),0) AS d, COALESCE(SUM(ml.credito),0) AS c
                     FROM cc_movimiento_lineas ml
                     JOIN cc_movimientos m ON m.id = ml.movimiento_id
                    WHERE ml.cuenta_id=? AND m.estado != 'anulado' AND m.fecha < ?""",
                (cuenta_id, desde),
            ).fetchone()
            d, c = row["d"] or 0, row["c"] or 0
            saldo_inicial = (d - c) if naturaleza == "debito" else (c - d)

        where = ["ml.cuenta_id = ?", "m.estado != 'anulado'"]
        params: list = [cuenta_id]
        if desde:
            where.append("m.fecha >= ?")
            params.append(desde)
        if hasta:
            where.append("m.fecha <= ?")
            params.append(hasta)
        sql = f"""SELECT m.id AS movimiento_id, m.fecha, m.concepto, m.referencia, m.tipo_origen,
                         ml.debito, ml.credito, ml.descripcion,
                         t.nombre AS tercero_nombre
                    FROM cc_movimiento_lineas ml
                    JOIN cc_movimientos m ON m.id = ml.movimiento_id
                    LEFT JOIN cc_terceros t ON t.id = ml.tercero_id
                   WHERE {" AND ".join(where)}
                   ORDER BY m.fecha, m.id, ml.orden"""
        filas = con.execute(sql, params).fetchall()

    saldo = saldo_inicial
    movimientos = []
    total_debito = 0.0
    total_credito = 0.0
    for f in filas:
        debito = f["debito"] or 0
        credito = f["credito"] or 0
        total_debito += debito
        total_credito += credito
        saldo += (debito - credito) if naturaleza == "debito" else (credito - debito)
        movimientos.append(
            {
                "movimiento_id": f["movimiento_id"],
                "fecha": f["fecha"],
                "concepto": f["concepto"],
                "referencia": f["referencia"],
                "tipo_origen": f["tipo_origen"],
                "descripcion": f["descripcion"],
                "tercero_nombre": f["tercero_nombre"],
                "debito": round(debito, 2),
                "credito": round(credito, 2),
                "saldo": round(saldo, 2),
            }
        )

    return {
        "cuenta": cuenta,
        "saldo_inicial": round(saldo_inicial, 2),
        "movimientos": movimientos,
        "total_debito": round(total_debito, 2),
        "total_credito": round(total_credito, 2),
        "saldo_final": round(saldo, 2),
    }


def balance_comprobacion(desde: str | None = None, hasta: str | None = None) -> dict:
    """Balance de comprobación: para cada cuenta con movimiento, saldo inicial, débitos,
    créditos y saldo final del periodo. `cuadra` indica si el total débito == total crédito."""
    _ensure()
    cuentas = listar_plan_cuentas(solo_activas=False)
    filas = []
    total_debito_periodo = 0.0
    total_credito_periodo = 0.0
    for cuenta in cuentas:
        if not cuenta["es_movimiento"]:
            continue
        mayor = mayor_cuenta(cuenta["id"], desde=desde, hasta=hasta)
        if not mayor["movimientos"] and not mayor["saldo_inicial"]:
            continue
        total_debito_periodo += mayor["total_debito"]
        total_credito_periodo += mayor["total_credito"]
        filas.append(
            {
                "cuenta_id": cuenta["id"],
                "codigo": cuenta["codigo"],
                "nombre": cuenta["nombre"],
                "tipo": cuenta["tipo"],
                "naturaleza": cuenta["naturaleza"],
                "saldo_inicial": mayor["saldo_inicial"],
                "debito": mayor["total_debito"],
                "credito": mayor["total_credito"],
                "saldo_final": mayor["saldo_final"],
            }
        )
    filas.sort(key=lambda r: r["codigo"])
    return {
        "cuentas": filas,
        "total_debito": round(total_debito_periodo, 2),
        "total_credito": round(total_credito_periodo, 2),
        "cuadra": round(total_debito_periodo, 2) == round(total_credito_periodo, 2),
    }


def saldo_tercero(tercero_id: int) -> dict:
    """Saldo de un tercero por cuenta (incluye `saldo_por_pagar`: suma de sus cuentas tipo
    pasivo — útil para ver cuánto le debe la empresa a un socio/proveedor)."""
    _ensure()
    with _conn() as con:
        tercero = con.execute("SELECT * FROM cc_terceros WHERE id=?", (tercero_id,)).fetchone()
        if not tercero:
            raise ValueError("Tercero no encontrado")
        tercero = dict(tercero)
        filas = con.execute(
            """SELECT pc.id AS cuenta_id, pc.codigo, pc.nombre, pc.tipo, pc.naturaleza,
                      COALESCE(SUM(ml.debito),0) AS debito, COALESCE(SUM(ml.credito),0) AS credito
                 FROM cc_movimiento_lineas ml
                 JOIN cc_plan_cuentas pc ON pc.id = ml.cuenta_id
                 JOIN cc_movimientos m ON m.id = ml.movimiento_id
                WHERE ml.tercero_id = ? AND m.estado != 'anulado'
                GROUP BY pc.id""",
            (tercero_id,),
        ).fetchall()
    cuentas = []
    saldo_por_pagar = 0.0
    for f in filas:
        naturaleza = f["naturaleza"]
        saldo = (f["debito"] - f["credito"]) if naturaleza == "debito" else (f["credito"] - f["debito"])
        if f["tipo"] == "pasivo":
            saldo_por_pagar += saldo
        cuentas.append(
            {
                "cuenta_id": f["cuenta_id"],
                "codigo": f["codigo"],
                "nombre": f["nombre"],
                "tipo": f["tipo"],
                "debito": round(f["debito"], 2),
                "credito": round(f["credito"], 2),
                "saldo": round(saldo, 2),
            }
        )
    return {"tercero": tercero, "cuentas": cuentas, "saldo_por_pagar": round(saldo_por_pagar, 2)}


# ─── Plantillas de movimientos frecuentes ──────────────────────────────────

def registrar_compra_socio_amazon(payload: dict, created_by: int | None = None) -> dict:
    """Un socio compra mercancía a nombre propio (p.ej. Amazon EEUU, sin trámite de
    importación) y se la "vende" a McKenna con una comisión. Se registra como pasivo
    (cuenta por pagar al socio) — el giro posterior se hace con `registrar_pago_socio`.

    payload: fecha, tercero_id, descripcion, valor, moneda ('COP'|'USD'), trm (si USD),
             comision_pct, cuenta_destino_id (cuenta de inventario/costo a debitar),
             referencia.
    """
    _ensure()
    fecha = str(payload.get("fecha") or "").strip()
    tercero_id = int(payload.get("tercero_id") or 0)
    descripcion = str(payload.get("descripcion") or "").strip()
    valor = float(payload.get("valor") or 0)
    moneda = str(payload.get("moneda") or "COP").strip().upper()
    trm = float(payload.get("trm") or 0)
    comision_pct = float(payload.get("comision_pct") or 0)
    cuenta_destino_id = int(payload.get("cuenta_destino_id") or 0)
    referencia = str(payload.get("referencia") or "").strip()

    if not fecha or not tercero_id or valor <= 0 or not cuenta_destino_id:
        raise ValueError("fecha, tercero_id, valor y cuenta_destino_id son requeridos")
    if moneda == "USD":
        if trm <= 0:
            raise ValueError("Se requiere TRM (> 0) para compras en USD")
        valor_cop = round(valor * trm, 2)
    else:
        valor_cop = round(valor, 2)
    comision_cop = round(valor_cop * comision_pct / 100, 2)
    total_cop = round(valor_cop + comision_cop, 2)

    tercero = obtener_tercero(tercero_id)
    if not tercero:
        raise ValueError("Tercero (socio) no encontrado")

    with _conn() as con:
        cuenta_pasivo_id = tercero.get("cuenta_por_pagar_id") or _cuenta_id_por_codigo(con, "2380")
    if not cuenta_pasivo_id:
        raise ValueError(
            "No hay cuenta de 'cuentas por pagar' configurada para este socio ni cuenta genérica 2380"
        )

    concepto = f"Compra mercancía (socio) — {tercero['nombre']}" + (
        f": {descripcion}" if descripcion else ""
    )
    lineas = [
        {
            "cuenta_id": cuenta_destino_id,
            "debito": total_cop,
            "credito": 0,
            "descripcion": descripcion or "Mercancía comprada por el socio",
        },
        {
            "cuenta_id": cuenta_pasivo_id,
            "debito": 0,
            "credito": total_cop,
            "tercero_id": tercero_id,
            "descripcion": f"Por pagar a {tercero['nombre']} (mercancía + comisión {comision_pct:g}%)",
        },
    ]
    mov = crear_movimiento(
        fecha=fecha,
        concepto=concepto,
        lineas=lineas,
        tercero_id=tercero_id,
        referencia=referencia,
        tipo_origen="compra_socio_amazon",
        plantilla_datos=payload,
        created_by=created_by,
    )
    mov["desglose"] = {
        "valor_original": valor,
        "moneda": moneda,
        "trm": trm if moneda == "USD" else None,
        "valor_cop": valor_cop,
        "comision_pct": comision_pct,
        "comision_cop": comision_cop,
        "total_cop": total_cop,
    }
    return mov


def registrar_pago_socio(payload: dict, created_by: int | None = None) -> dict:
    """Gira dinero al socio para saldar (total o parcialmente) su cuenta por pagar
    acumulada (p.ej. por compras vía Amazon). payload: fecha, tercero_id, monto,
    medio_pago_id, referencia, concepto (opcional)."""
    _ensure()
    fecha = str(payload.get("fecha") or "").strip()
    tercero_id = int(payload.get("tercero_id") or 0)
    monto = round(float(payload.get("monto") or 0), 2)
    medio_pago_id = int(payload.get("medio_pago_id") or 0)
    referencia = str(payload.get("referencia") or "").strip()
    concepto_extra = str(payload.get("concepto") or "").strip()

    if not fecha or not tercero_id or monto <= 0 or not medio_pago_id:
        raise ValueError("fecha, tercero_id, monto y medio_pago_id son requeridos")

    tercero = obtener_tercero(tercero_id)
    if not tercero:
        raise ValueError("Tercero no encontrado")
    medio = obtener_medio_pago(medio_pago_id)
    if not medio:
        raise ValueError("Medio de pago no encontrado")
    with _conn() as con:
        cuenta_pasivo_id = tercero.get("cuenta_por_pagar_id") or _cuenta_id_por_codigo(con, "2380")
    if not cuenta_pasivo_id:
        raise ValueError("No hay cuenta de 'cuentas por pagar' configurada para este tercero")

    concepto = f"Giro a {tercero['nombre']}" + (f" — {concepto_extra}" if concepto_extra else "")
    lineas = [
        {
            "cuenta_id": cuenta_pasivo_id,
            "debito": monto,
            "credito": 0,
            "tercero_id": tercero_id,
            "descripcion": f"Abono cuenta por pagar {tercero['nombre']}",
        },
        {
            "cuenta_id": medio["cuenta_id"],
            "debito": 0,
            "credito": monto,
            "descripcion": f"Salida vía {medio['nombre']}",
        },
    ]
    return crear_movimiento(
        fecha=fecha,
        concepto=concepto,
        lineas=lineas,
        tercero_id=tercero_id,
        referencia=referencia,
        tipo_origen="pago_socio",
        plantilla_datos=payload,
        created_by=created_by,
    )


def registrar_compra_proveedor(payload: dict, created_by: int | None = None) -> dict:
    """Compra genérica a un tercero (proveedor externo o un socio actuando como
    proveedor, p.ej. Armando vendiendo manteca de cacao ya transformada — el costeo
    de producción del socio no entra a la contabilidad de McKenna, solo el precio de
    venta de la manteca terminada). payload: fecha, tercero_id, concepto, valor,
    cuenta_destino_id, forma_pago ('contado'|'credito'), medio_pago_id (si contado),
    referencia."""
    _ensure()
    fecha = str(payload.get("fecha") or "").strip()
    tercero_id = int(payload.get("tercero_id") or 0)
    concepto_in = str(payload.get("concepto") or "").strip()
    valor = round(float(payload.get("valor") or 0), 2)
    cuenta_destino_id = int(payload.get("cuenta_destino_id") or 0)
    forma_pago = str(payload.get("forma_pago") or "credito").strip()
    medio_pago_id = payload.get("medio_pago_id")
    referencia = str(payload.get("referencia") or "").strip()

    if not fecha or not tercero_id or valor <= 0 or not cuenta_destino_id:
        raise ValueError("fecha, tercero_id, valor y cuenta_destino_id son requeridos")
    if forma_pago not in ("contado", "credito"):
        raise ValueError("forma_pago debe ser 'contado' o 'credito'")

    tercero = obtener_tercero(tercero_id)
    if not tercero:
        raise ValueError("Tercero no encontrado")

    concepto = concepto_in or f"Compra a {tercero['nombre']}"

    if forma_pago == "contado":
        if not medio_pago_id:
            raise ValueError("Se requiere medio_pago_id para compra de contado")
        medio = obtener_medio_pago(int(medio_pago_id))
        if not medio:
            raise ValueError("Medio de pago no encontrado")
        lineas = [
            {
                "cuenta_id": cuenta_destino_id,
                "debito": valor,
                "credito": 0,
                "descripcion": concepto,
                "tercero_id": tercero_id,
            },
            {
                "cuenta_id": medio["cuenta_id"],
                "debito": 0,
                "credito": valor,
                "descripcion": f"Pago vía {medio['nombre']}",
            },
        ]
    else:
        with _conn() as con:
            cuenta_pasivo_id = tercero.get("cuenta_por_pagar_id") or _cuenta_id_por_codigo(con, "2205")
        if not cuenta_pasivo_id:
            raise ValueError("No hay cuenta de 'cuentas por pagar' configurada")
        lineas = [
            {
                "cuenta_id": cuenta_destino_id,
                "debito": valor,
                "credito": 0,
                "descripcion": concepto,
                "tercero_id": tercero_id,
            },
            {
                "cuenta_id": cuenta_pasivo_id,
                "debito": 0,
                "credito": valor,
                "tercero_id": tercero_id,
                "descripcion": f"Por pagar a {tercero['nombre']}",
            },
        ]

    return crear_movimiento(
        fecha=fecha,
        concepto=concepto,
        lineas=lineas,
        tercero_id=tercero_id,
        referencia=referencia,
        tipo_origen="compra_proveedor",
        plantilla_datos=payload,
        created_by=created_by,
    )


def registrar_ingreso(payload: dict, created_by: int | None = None) -> dict:
    """Ingreso simple: Debe medio de pago (banco/caja), Haber cuenta de ingreso.
    payload: fecha, concepto, valor, cuenta_ingreso_id, medio_pago_id, tercero_id
    (opcional), referencia."""
    _ensure()
    fecha = str(payload.get("fecha") or "").strip()
    concepto = str(payload.get("concepto") or "").strip()
    valor = round(float(payload.get("valor") or 0), 2)
    cuenta_ingreso_id = int(payload.get("cuenta_ingreso_id") or 0)
    medio_pago_id = int(payload.get("medio_pago_id") or 0)
    tercero_id = payload.get("tercero_id")
    referencia = str(payload.get("referencia") or "").strip()

    if not fecha or not concepto or valor <= 0 or not cuenta_ingreso_id or not medio_pago_id:
        raise ValueError("fecha, concepto, valor, cuenta_ingreso_id y medio_pago_id son requeridos")
    medio = obtener_medio_pago(medio_pago_id)
    if not medio:
        raise ValueError("Medio de pago no encontrado")

    lineas = [
        {
            "cuenta_id": medio["cuenta_id"],
            "debito": valor,
            "credito": 0,
            "descripcion": f"Entrada vía {medio['nombre']}",
        },
        {
            "cuenta_id": cuenta_ingreso_id,
            "debito": 0,
            "credito": valor,
            "descripcion": concepto,
            "tercero_id": int(tercero_id) if tercero_id else None,
        },
    ]
    return crear_movimiento(
        fecha=fecha,
        concepto=concepto,
        lineas=lineas,
        tercero_id=int(tercero_id) if tercero_id else None,
        referencia=referencia,
        tipo_origen="ingreso",
        plantilla_datos=payload,
        created_by=created_by,
    )


def registrar_egreso(payload: dict, created_by: int | None = None) -> dict:
    """Egreso simple: Debe cuenta de gasto/costo, Haber medio de pago (banco/caja).
    payload: fecha, concepto, valor, cuenta_gasto_id, medio_pago_id, tercero_id
    (opcional), referencia."""
    _ensure()
    fecha = str(payload.get("fecha") or "").strip()
    concepto = str(payload.get("concepto") or "").strip()
    valor = round(float(payload.get("valor") or 0), 2)
    cuenta_gasto_id = int(payload.get("cuenta_gasto_id") or 0)
    medio_pago_id = int(payload.get("medio_pago_id") or 0)
    tercero_id = payload.get("tercero_id")
    referencia = str(payload.get("referencia") or "").strip()

    if not fecha or not concepto or valor <= 0 or not cuenta_gasto_id or not medio_pago_id:
        raise ValueError("fecha, concepto, valor, cuenta_gasto_id y medio_pago_id son requeridos")
    medio = obtener_medio_pago(medio_pago_id)
    if not medio:
        raise ValueError("Medio de pago no encontrado")

    lineas = [
        {
            "cuenta_id": cuenta_gasto_id,
            "debito": valor,
            "credito": 0,
            "descripcion": concepto,
            "tercero_id": int(tercero_id) if tercero_id else None,
        },
        {
            "cuenta_id": medio["cuenta_id"],
            "debito": 0,
            "credito": valor,
            "descripcion": f"Salida vía {medio['nombre']}",
        },
    ]
    return crear_movimiento(
        fecha=fecha,
        concepto=concepto,
        lineas=lineas,
        tercero_id=int(tercero_id) if tercero_id else None,
        referencia=referencia,
        tipo_origen="egreso",
        plantilla_datos=payload,
        created_by=created_by,
    )
