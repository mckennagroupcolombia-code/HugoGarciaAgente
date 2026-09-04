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

        CREATE TABLE IF NOT EXISTS compras_exterior (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            moneda TEXT NOT NULL DEFAULT 'USD',
            trm REAL NOT NULL DEFAULT 0,
            flete REAL NOT NULL DEFAULT 0,
            moneda_flete TEXT NOT NULL DEFAULT '',
            proveedor TEXT NOT NULL DEFAULT '',
            soporte_path TEXT NOT NULL DEFAULT '',
            soporte_nombre TEXT NOT NULL DEFAULT '',
            soporte_mime TEXT NOT NULL DEFAULT '',
            lineas_json TEXT NOT NULL DEFAULT '[]',
            total_guardados INTEGER NOT NULL DEFAULT 0,
            notas TEXT NOT NULL DEFAULT '',
            fecha_compra TEXT NOT NULL DEFAULT '',
            trm_fuente TEXT NOT NULL DEFAULT ''
        );
        """)
    # Migración: columnas añadidas después del schema inicial
    _migraciones = [
        "ALTER TABLE empleados ADD COLUMN usuario_id INTEGER DEFAULT NULL",
        "ALTER TABLE empleados ADD COLUMN dia_pago INTEGER DEFAULT NULL",
        "ALTER TABLE empleados ADD COLUMN telefono_wa TEXT DEFAULT ''",
        "ALTER TABLE componente_costos ADD COLUMN iva_incluido INTEGER DEFAULT 0",
        "ALTER TABLE compras_exterior ADD COLUMN fecha_compra TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE compras_exterior ADD COLUMN trm_fuente TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE compras_exterior ADD COLUMN cuenta_cobro_path TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE compras_exterior ADD COLUMN cuota_manejo_cop REAL NOT NULL DEFAULT 0",
        "ALTER TABLE compras_exterior ADD COLUMN valor_compra_cop REAL NOT NULL DEFAULT 0",
        "ALTER TABLE compras_exterior ADD COLUMN cuota_pct REAL NOT NULL DEFAULT 5",
        "ALTER TABLE compras_exterior ADD COLUMN total_cobro_cop REAL NOT NULL DEFAULT 0",
        "ALTER TABLE compras_exterior ADD COLUMN flete_cobro_cop REAL NOT NULL DEFAULT 0",
        "ALTER TABLE compras_exterior ADD COLUMN cuenta_cobro_estado TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE compras_exterior ADD COLUMN cuenta_flete_path TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE compras_exterior ADD COLUMN cuenta_flete_estado TEXT NOT NULL DEFAULT ''",
        # "mckenna" = compra directa de la empresa; "socio" = compra personal de un
        # socio que luego revende la mercancía a McKenna (ver app/data/aliados_logisticos.json
        # / panel Importaciones — implicación fiscal distinta a validar con el contador).
        "ALTER TABLE compras_exterior ADD COLUMN comprado_por TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE compras_exterior ADD COLUMN emisor_usuario_id INTEGER DEFAULT NULL",
        "ALTER TABLE compras_exterior ADD COLUMN emisor_nombre TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE compras_exterior ADD COLUMN envio_id INTEGER DEFAULT NULL",
        "ALTER TABLE compras_exterior ADD COLUMN numero_pedido TEXT NOT NULL DEFAULT ''",
        """CREATE TABLE IF NOT EXISTS compras_exterior_envios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            fecha_envio TEXT NOT NULL DEFAULT '',
            flete REAL NOT NULL DEFAULT 0,
            moneda_flete TEXT NOT NULL DEFAULT 'USD',
            trm REAL NOT NULL DEFAULT 0,
            trm_fuente TEXT NOT NULL DEFAULT '',
            notas TEXT NOT NULL DEFAULT '',
            cuenta_flete_path TEXT NOT NULL DEFAULT '',
            cuenta_flete_estado TEXT NOT NULL DEFAULT '',
            flete_cobro_cop REAL NOT NULL DEFAULT 0,
            emisor_usuario_id INTEGER DEFAULT NULL,
            emisor_nombre TEXT NOT NULL DEFAULT ''
        )""",

        "ALTER TABLE servicios ADD COLUMN created_by INTEGER DEFAULT NULL",
        "ALTER TABLE pagos_servicios ADD COLUMN created_by INTEGER DEFAULT NULL",
        """CREATE TABLE IF NOT EXISTS compras_exterior_borradores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            titulo TEXT NOT NULL DEFAULT '',
            moneda TEXT NOT NULL DEFAULT 'USD',
            trm REAL NOT NULL DEFAULT 0,
            trm_fuente TEXT NOT NULL DEFAULT '',
            fecha_compra TEXT NOT NULL DEFAULT '',
            flete REAL NOT NULL DEFAULT 0,
            moneda_flete TEXT NOT NULL DEFAULT '',
            descuento_pedido REAL NOT NULL DEFAULT 0,
            descuento_pct REAL NOT NULL DEFAULT 0,
            proveedor TEXT NOT NULL DEFAULT '',
            notas TEXT NOT NULL DEFAULT '',
            estado_json TEXT NOT NULL DEFAULT '{}',
            soporte_path TEXT NOT NULL DEFAULT '',
            soporte_nombre TEXT NOT NULL DEFAULT '',
            soporte_mime TEXT NOT NULL DEFAULT ''
        )""",
        """CREATE TABLE IF NOT EXISTS compras_exterior (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            moneda TEXT NOT NULL DEFAULT 'USD',
            trm REAL NOT NULL DEFAULT 0,
            flete REAL NOT NULL DEFAULT 0,
            moneda_flete TEXT NOT NULL DEFAULT '',
            proveedor TEXT NOT NULL DEFAULT '',
            soporte_path TEXT NOT NULL DEFAULT '',
            soporte_nombre TEXT NOT NULL DEFAULT '',
            soporte_mime TEXT NOT NULL DEFAULT '',
            lineas_json TEXT NOT NULL DEFAULT '[]',
            total_guardados INTEGER NOT NULL DEFAULT 0,
            notas TEXT NOT NULL DEFAULT '',
            fecha_compra TEXT NOT NULL DEFAULT '',
            trm_fuente TEXT NOT NULL DEFAULT ''
        )""",
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

def listar_servicios(
    *,
    usuario_id: int | None = None,
    ver_todo: bool = True,
) -> list[dict]:
    """Lista servicios activos.

    Si ver_todo es False y hay usuario_id, solo servicios y pagos creados por ese usuario.
    Registros sin created_by (históricos/importados) solo los ven quienes tienen ver_todo.
    """
    _ensure()
    with _conn() as con:
        if ver_todo or not usuario_id:
            servicios = con.execute(
                "SELECT * FROM servicios WHERE activo = 1 ORDER BY tipo, empresa"
            ).fetchall()
        else:
            servicios = con.execute(
                """SELECT * FROM servicios
                   WHERE activo = 1 AND created_by = ?
                   ORDER BY tipo, empresa""",
                (int(usuario_id),),
            ).fetchall()
        result = []
        for s in servicios:
            sd = dict(s)
            if ver_todo or not usuario_id:
                pagos = con.execute(
                    "SELECT * FROM pagos_servicios WHERE servicio_id = ? ORDER BY fecha DESC LIMIT 36",
                    (s["id"],),
                ).fetchall()
            else:
                pagos = con.execute(
                    """SELECT * FROM pagos_servicios
                       WHERE servicio_id = ? AND created_by = ?
                       ORDER BY fecha DESC LIMIT 36""",
                    (s["id"], int(usuario_id)),
                ).fetchall()
            sd["pagos"] = [dict(p) for p in pagos]
            result.append(sd)
    return result


def upsert_servicio(data: dict) -> dict:
    _ensure()
    srv_id = data.get("id")
    now = datetime.now().isoformat()
    created_by = data.get("created_by")
    if created_by is not None:
        try:
            created_by = int(created_by)
        except (TypeError, ValueError):
            created_by = None
    with _conn() as con:
        if srv_id:
            # No pisar created_by en updates
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
                     activo, dia_vencimiento, notas, created_at, created_by)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    data.get("empresa", ""),
                    data.get("tipo", "otro"),
                    data.get("numero_contrato", ""),
                    data.get("direccion", ""),
                    1 if data.get("activo", True) else 0,
                    data.get("dia_vencimiento"),
                    data.get("notas", ""),
                    now,
                    created_by,
                ),
            )
            row = con.execute(
                "SELECT * FROM servicios WHERE id = ?", (cur.lastrowid,)
            ).fetchone()
    return dict(row)


def obtener_servicio(srv_id: int) -> dict | None:
    _ensure()
    with _conn() as con:
        row = con.execute("SELECT * FROM servicios WHERE id = ?", (int(srv_id),)).fetchone()
    return dict(row) if row else None


def eliminar_servicio(srv_id: int) -> None:
    _ensure()
    with _conn() as con:
        con.execute("UPDATE servicios SET activo = 0 WHERE id = ?", (srv_id,))


def registrar_pago(
    srv_id: int,
    fecha: str,
    monto: float,
    comprobante: str = "",
    notas: str = "",
    created_by: int | None = None,
) -> dict:
    _ensure()
    now = datetime.now().isoformat()
    uid = None
    if created_by is not None:
        try:
            uid = int(created_by)
        except (TypeError, ValueError):
            uid = None
    with _conn() as con:
        cur = con.execute(
            """INSERT INTO pagos_servicios
               (servicio_id, fecha, monto, comprobante, notas, created_at, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (srv_id, fecha, monto, comprobante, notas, now, uid),
        )
        row = con.execute(
            "SELECT * FROM pagos_servicios WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
    return dict(row)


def obtener_pago(pago_id: int) -> dict | None:
    _ensure()
    with _conn() as con:
        row = con.execute(
            "SELECT * FROM pagos_servicios WHERE id = ?", (int(pago_id),)
        ).fetchone()
    return dict(row) if row else None


def eliminar_pago(pago_id: int) -> None:
    _ensure()
    with _conn() as con:
        con.execute("DELETE FROM pagos_servicios WHERE id = ?", (pago_id,))


def pagos_servicios_en_rango(fecha_inicio: str, fecha_fin: str) -> list[dict]:
    """
    Pagos de servicios fijos (arriendo, energía, agua, internet…) realmente
    desembolsados en el rango dado — a diferencia de `resumen_nomina()`, este
    es un gasto de caja real con fecha, no un total estático. Usado por
    app.services.salud_negocio para el costo administrativo semanal/mensual.
    """
    _ensure()
    with _conn() as con:
        rows = con.execute(
            """SELECT p.fecha, p.monto, p.servicio_id, s.empresa, s.tipo
               FROM pagos_servicios p
               JOIN servicios s ON s.id = p.servicio_id
               WHERE p.fecha BETWEEN ? AND ?
               ORDER BY p.fecha""",
            (fecha_inicio, fecha_fin),
        ).fetchall()
    return [dict(r) for r in rows]


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


# ─── Compras exterior (historial + soporte) ───────────────────────────────────

_SOPORTES_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "compras_exterior_soportes")


def _soportes_dir() -> str:
    path = os.path.abspath(_SOPORTES_DIR)
    os.makedirs(path, exist_ok=True)
    return path


def _resolver_emisor_compra(
    emisor_usuario_id: int | None = None,
    emisor_perfil: dict | None = None,
) -> tuple[int | None, str]:
    """Id + nombre del usuario a cuyo nombre se emite la cuenta de cobro."""
    perfil = emisor_perfil
    uid = None
    if perfil and perfil.get("id") not in (None, "", 0, "0"):
        try:
            uid = int(perfil["id"])
        except (TypeError, ValueError):
            uid = None
    if uid is None and emisor_usuario_id not in (None, "", 0, "0"):
        try:
            uid = int(emisor_usuario_id)
        except (TypeError, ValueError):
            uid = None
        if uid and perfil is None:
            from app.services.cuenta_cobro_cuota_manejo import perfil_emisor_por_id

            perfil = perfil_emisor_por_id(uid)
    nombre = ""
    if perfil:
        nombre = str(perfil.get("nombre") or "").strip()
    return (uid if uid and uid > 0 else None), nombre


def _nombre_emisor_compra(d: dict) -> str:
    nombre = str(d.get("emisor_nombre") or "").strip()
    if nombre:
        return nombre
    from app.services.cuenta_cobro_cuota_manejo import perfil_emisor_por_id

    perfil = perfil_emisor_por_id(d.get("emisor_usuario_id"))
    return str((perfil or {}).get("nombre") or "").strip()


def _documento_emisor_compra(d: dict) -> str:
    from app.services.cuenta_cobro_cuota_manejo import perfil_emisor_por_id

    perfil = perfil_emisor_por_id(d.get("emisor_usuario_id"))
    return str((perfil or {}).get("documento_identidad") or "").strip()


def guardar_compra_exterior(
    *,
    moneda: str,
    trm: float,
    flete: float,
    moneda_flete: str,
    proveedor: str,
    lineas: list,
    total_guardados: int,
    soporte_bytes: bytes | None = None,
    soporte_nombre: str = "",
    soporte_mime: str = "",
    soportes: list | None = None,
    notas: str = "",
    fecha_compra: str = "",
    trm_fuente: str = "",
    cuota_pct: float | None = None,
    emisor_usuario_id: int | None = None,
    numero_pedido: str = "",
) -> dict:
    """Persiste historial de compra exterior y opcionalmente pantallazo(s) de soporte."""
    import json
    import re
    import uuid

    _ensure()
    now = datetime.now().isoformat()
    paths: list[str] = []
    nombres: list[str] = []
    mimes: list[str] = []

    def _guardar_uno(raw: bytes, nombre: str, mime: str) -> None:
        if not raw:
            return
        nombre_safe = (nombre or "").strip()
        mime_s = (mime or "").strip()
        ext = ".bin"
        if mime_s == "application/pdf" or nombre_safe.lower().endswith(".pdf"):
            ext = ".pdf"
        elif "png" in mime_s or nombre_safe.lower().endswith(".png"):
            ext = ".png"
        elif "webp" in mime_s:
            ext = ".webp"
        else:
            ext = ".jpg"
        base = re.sub(r"[^\w.\-]+", "_", nombre_safe)[:60] or "soporte"
        fname = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}_{base}{ext}"
        full = os.path.join(_soportes_dir(), fname)
        with open(full, "wb") as f:
            f.write(raw)
        paths.append(fname)
        nombres.append(nombre_safe or fname)
        mimes.append(mime_s or "application/octet-stream")

    if soportes:
        for s in soportes:
            if not isinstance(s, dict):
                continue
            _guardar_uno(s.get("bytes") or b"", str(s.get("nombre") or ""), str(s.get("mime") or ""))
    elif soporte_bytes:
        _guardar_uno(soporte_bytes, soporte_nombre, soporte_mime)

    if len(paths) <= 1:
        soporte_path = paths[0] if paths else ""
        nombre_safe = nombres[0] if nombres else (soporte_nombre or "").strip()
        mime = mimes[0] if mimes else (soporte_mime or "").strip()
    else:
        soporte_path = json.dumps(paths, ensure_ascii=False)
        nombre_safe = f"{len(paths)} archivos"
        mime = "application/json"

    emisor_uid, emisor_nom = _resolver_emisor_compra(emisor_usuario_id)
    pedido = (numero_pedido or "").strip()[:120]
    with _conn() as con:
        cur = con.execute(
            """INSERT INTO compras_exterior
                 (created_at, moneda, trm, flete, moneda_flete, proveedor,
                  soporte_path, soporte_nombre, soporte_mime, lineas_json,
                  total_guardados, notas, fecha_compra, trm_fuente,
                  emisor_usuario_id, emisor_nombre, numero_pedido)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                now,
                (moneda or "USD").strip().upper(),
                float(trm or 0),
                float(flete or 0),
                (moneda_flete or "").strip().upper(),
                (proveedor or "").strip(),
                soporte_path,
                nombre_safe,
                mime,
                json.dumps(lineas, ensure_ascii=False),
                int(total_guardados),
                (notas or "").strip(),
                (fecha_compra or "").strip()[:10],
                (trm_fuente or "").strip()[:40],
                emisor_uid,
                emisor_nom,
                pedido,
            ),
        )
        row = con.execute(
            "SELECT * FROM compras_exterior WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
    out = _compra_exterior_row(dict(row))
    return _adjuntar_cuenta_cobro_cuota(out["id"], cuota_pct=cuota_pct) or out


def _necesita_resolver_tasa_compra(d: dict, lineas: list) -> bool:
    from app.services.cuenta_cobro_cuota_manejo import parece_compra_en_divisa

    mon = str(d.get("moneda") or "USD").strip().upper() or "USD"
    try:
        trm = float(d.get("trm") or 0)
    except (TypeError, ValueError):
        trm = 0.0
    if mon != "COP" and trm > 1.5:
        return False
    if mon != "COP":
        return True
    return parece_compra_en_divisa(mon, trm, lineas)


def listar_compras_exterior(limit: int = 50) -> list[dict]:
    import json

    _ensure()
    limit = max(1, min(int(limit or 50), 200))
    with _conn() as con:
        rows = con.execute(
            "SELECT * FROM compras_exterior ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    out = []
    envio_ids: set[int] = set()
    parsed: list[dict] = []
    for r in rows:
        d = dict(r)
        try:
            d["lineas"] = json.loads(d.get("lineas_json") or "[]")
        except Exception:
            d["lineas"] = []
        try:
            eid = int(d.get("envio_id") or 0)
        except (TypeError, ValueError):
            eid = 0
        if eid > 0:
            envio_ids.add(eid)
        parsed.append(d)
    envios = _envios_por_ids(envio_ids) if envio_ids else {}
    for d in parsed:
        try:
            eid = int(d.get("envio_id") or 0)
        except (TypeError, ValueError):
            eid = 0
        if eid > 0:
            d["envio"] = envios.get(eid)
        if (
            _necesita_resolver_tasa_compra(d, d["lineas"])
            and str(d.get("cuenta_cobro_estado") or "") != "aprobada"
        ):
            fixed = _preparar_cuenta_cobro_pendiente(int(d["id"]))
            if fixed:
                if eid > 0:
                    fixed["envio"] = envios.get(eid)
                    fixed["envio_id"] = eid
                out.append(fixed)
                continue
        out.append(_compra_exterior_row(d))
    return out


def obtener_compra_exterior(compra_id: int) -> dict | None:
    import json

    _ensure()
    with _conn() as con:
        row = con.execute(
            "SELECT * FROM compras_exterior WHERE id = ?", (int(compra_id),)
        ).fetchone()
    if not row:
        return None
    d = dict(row)
    try:
        d["lineas"] = json.loads(d.get("lineas_json") or "[]")
    except Exception:
        d["lineas"] = []
    try:
        eid = int(d.get("envio_id") or 0)
    except (TypeError, ValueError):
        eid = 0
    if eid > 0:
        d["envio"] = _envios_por_ids({eid}).get(eid)
    return _compra_exterior_row(d)


_COMPRADO_POR_VALIDOS = {"mckenna", "socio"}


def establecer_comprado_por_compra_exterior(compra_id: int, comprado_por: str) -> tuple[bool, str]:
    """Marca si una compra exterior fue directa de McKenna o comprada/revendida por un socio.

    Ver app/data/aliados_logisticos.json / panel Importaciones: las compras vía socio
    tienen una implicación fiscal distinta (no son importación directa de la empresa)
    que hay que validar con el contador.
    """
    valor = (comprado_por or "").strip().lower()
    if valor not in _COMPRADO_POR_VALIDOS:
        return False, f"comprado_por debe ser uno de: {', '.join(sorted(_COMPRADO_POR_VALIDOS))}"
    _ensure()
    with _conn() as con:
        cur = con.execute(
            "UPDATE compras_exterior SET comprado_por=? WHERE id=?", (valor, int(compra_id))
        )
        if cur.rowcount == 0:
            return False, "Compra exterior no encontrada"
    return True, ""


def eliminar_compra_exterior(compra_id: int, *, borrar_archivos: bool = True) -> bool:
    """Elimina un registro del historial de compras exterior y sus soportes."""
    _ensure()
    envio_id = None
    with _conn() as con:
        row = con.execute(
            "SELECT soporte_path, cuenta_cobro_path, cuenta_flete_path, envio_id FROM compras_exterior WHERE id = ?",
            (int(compra_id),),
        ).fetchone()
        if not row:
            return False
        try:
            envio_id = int(row["envio_id"] or 0) or None
        except (TypeError, ValueError, KeyError):
            envio_id = None
        if borrar_archivos:
            for p in _parse_soporte_paths(row["soporte_path"]):
                full = os.path.join(_soportes_dir(), p)
                try:
                    if os.path.isfile(full):
                        os.remove(full)
                except OSError:
                    pass
            try:
                from app.services.cuenta_cobro_cuota_manejo import carpeta_pdfs

                for key in ("cuenta_cobro_path", "cuenta_flete_path"):
                    try:
                        cc = (row[key] or "").strip()
                    except (KeyError, IndexError, TypeError):
                        cc = ""
                    if not cc:
                        continue
                    full_cc = cc if os.path.isabs(cc) else os.path.join(carpeta_pdfs(), cc)
                    if os.path.isfile(full_cc):
                        os.remove(full_cc)
            except OSError:
                pass
        con.execute("DELETE FROM compras_exterior WHERE id = ?", (int(compra_id),))
    if envio_id:
        restantes = _compras_de_envio(int(envio_id))
        if not restantes:
            eliminar_envio_compras(int(envio_id), borrar_si_vacio=True)
        else:
            _recalcular_envio(int(envio_id))
    return True


def rutas_soporte_compra(compra_id: int) -> list[str]:
    _ensure()
    with _conn() as con:
        row = con.execute(
            "SELECT soporte_path FROM compras_exterior WHERE id = ?",
            (int(compra_id),),
        ).fetchone()
    if not row:
        return []
    return _parse_soporte_paths(row["soporte_path"])


def soportes_desde_compra(
    compra_id: int, indices: list[int] | None = None
) -> list[dict]:
    """Lee bytes de soportes de una compra registrada (para re-guardar / editar)."""
    paths = rutas_soporte_compra(compra_id)
    if indices is not None:
        ordered: list[str] = []
        for i in indices:
            try:
                ii = int(i)
            except (TypeError, ValueError):
                continue
            if 0 <= ii < len(paths):
                ordered.append(paths[ii])
        paths = ordered
    out = []
    for fname in paths:
        full = os.path.join(_soportes_dir(), fname)
        if not os.path.isfile(full):
            continue
        with open(full, "rb") as f:
            data = f.read()
        mime = "application/octet-stream"
        low = fname.lower()
        if low.endswith(".pdf"):
            mime = "application/pdf"
        elif low.endswith(".png"):
            mime = "image/png"
        elif low.endswith(".webp"):
            mime = "image/webp"
        elif low.endswith((".jpg", ".jpeg")):
            mime = "image/jpeg"
        out.append({"bytes": data, "nombre": fname, "mime": mime})
    return out


def actualizar_soportes_compra(compra_id: int, indices: list[int]) -> dict | None:
    """Reordena/elimina soportes de una compra según índices (orden final)."""
    import json

    _ensure()
    with _conn() as con:
        row = con.execute(
            "SELECT * FROM compras_exterior WHERE id = ?",
            (int(compra_id),),
        ).fetchone()
        if not row:
            return None
        prev = _parse_soporte_paths(row["soporte_path"])
        kept: list[str] = []
        seen: set[int] = set()
        for i in indices:
            try:
                ii = int(i)
            except (TypeError, ValueError):
                continue
            if ii in seen or ii < 0 or ii >= len(prev):
                continue
            seen.add(ii)
            kept.append(prev[ii])
        for j, fname in enumerate(prev):
            if j in seen:
                continue
            full = os.path.join(_soportes_dir(), fname)
            try:
                if os.path.isfile(full):
                    os.remove(full)
            except OSError:
                pass
        if not kept:
            soporte_path, soporte_nombre, soporte_mime = "", "", ""
        elif len(kept) == 1:
            soporte_path, soporte_nombre = kept[0], kept[0]
            soporte_mime = row["soporte_mime"] or ""
            if soporte_mime == "application/json":
                low = kept[0].lower()
                if low.endswith(".pdf"):
                    soporte_mime = "application/pdf"
                elif low.endswith(".png"):
                    soporte_mime = "image/png"
                elif low.endswith(".webp"):
                    soporte_mime = "image/webp"
                else:
                    soporte_mime = "image/jpeg"
        else:
            soporte_path = json.dumps(kept, ensure_ascii=False)
            soporte_nombre = f"{len(kept)} archivos"
            soporte_mime = "application/json"
        con.execute(
            """UPDATE compras_exterior SET
                 soporte_path=?, soporte_nombre=?, soporte_mime=?
               WHERE id=?""",
            (soporte_path, soporte_nombre, soporte_mime, int(compra_id)),
        )
    return obtener_compra_exterior(compra_id)


def actualizar_compra_exterior(
    compra_id: int,
    *,
    moneda: str,
    trm: float,
    flete: float,
    moneda_flete: str,
    proveedor: str,
    lineas: list,
    total_guardados: int,
    soportes: list | None = None,
    notas: str = "",
    fecha_compra: str = "",
    trm_fuente: str = "",
    replace_soportes: bool = False,
    append_soportes: bool = False,
    cuota_pct: float | None = None,
    emisor_usuario_id: int | None = None,
    numero_pedido: str | None = None,
) -> dict | None:
    """Actualiza una compra exterior ya registrada (metadatos, líneas y soportes)."""
    import json

    _ensure()
    with _conn() as con:
        row_prev = con.execute(
            "SELECT * FROM compras_exterior WHERE id = ?",
            (int(compra_id),),
        ).fetchone()
        if not row_prev:
            return None

        soporte_path = row_prev["soporte_path"] or ""
        soporte_nombre = row_prev["soporte_nombre"] or ""
        soporte_mime = row_prev["soporte_mime"] or ""

        nuevo_path, nuevo_nombre, nuevo_mime = _guardar_archivos_soporte(soportes=soportes)
        if nuevo_path:
            if replace_soportes or not soporte_path:
                for p in _parse_soporte_paths(soporte_path):
                    full = os.path.join(_soportes_dir(), p)
                    try:
                        if os.path.isfile(full):
                            os.remove(full)
                    except OSError:
                        pass
                soporte_path, soporte_nombre, soporte_mime = nuevo_path, nuevo_nombre, nuevo_mime
            elif append_soportes:
                prev = _parse_soporte_paths(soporte_path)
                add = _parse_soporte_paths(nuevo_path)
                merged = prev + add
                if len(merged) == 1:
                    soporte_path, soporte_nombre, soporte_mime = merged[0], merged[0], nuevo_mime
                else:
                    soporte_path = json.dumps(merged, ensure_ascii=False)
                    soporte_nombre = f"{len(merged)} archivos"
                    soporte_mime = "application/json"
            else:
                # Por defecto al editar con imágenes nuevas: reemplazar
                for p in _parse_soporte_paths(soporte_path):
                    full = os.path.join(_soportes_dir(), p)
                    try:
                        if os.path.isfile(full):
                            os.remove(full)
                    except OSError:
                        pass
                soporte_path, soporte_nombre, soporte_mime = nuevo_path, nuevo_nombre, nuevo_mime

        emisor_uid, emisor_nom = _resolver_emisor_compra(emisor_usuario_id)
        if emisor_uid is None:
            prev_uid = row_prev["emisor_usuario_id"] if "emisor_usuario_id" in row_prev.keys() else None
            prev_nom = (row_prev["emisor_nombre"] or "").strip() if "emisor_nombre" in row_prev.keys() else ""
            emisor_uid, emisor_nom = prev_uid, prev_nom
        try:
            envio_id_prev = int(row_prev["envio_id"] or 0) or None
        except (TypeError, ValueError, KeyError):
            envio_id_prev = None
        flete_guardar = 0.0 if envio_id_prev else float(flete or 0)
        if numero_pedido is None:
            try:
                pedido = str(row_prev["numero_pedido"] or "").strip()
            except (KeyError, IndexError, TypeError):
                pedido = ""
        else:
            pedido = str(numero_pedido or "").strip()[:120]
        con.execute(
            """UPDATE compras_exterior SET
                 moneda=?, trm=?, flete=?, moneda_flete=?, proveedor=?,
                 soporte_path=?, soporte_nombre=?, soporte_mime=?,
                 lineas_json=?, total_guardados=?, notas=?, fecha_compra=?, trm_fuente=?,
                 emisor_usuario_id=?, emisor_nombre=?, numero_pedido=?
               WHERE id=?""",
            (
                (moneda or "USD").strip().upper(),
                float(trm or 0),
                flete_guardar,
                (moneda_flete or "").strip().upper(),
                (proveedor or "").strip(),
                soporte_path,
                soporte_nombre,
                soporte_mime,
                json.dumps(lineas, ensure_ascii=False),
                int(total_guardados),
                (notas or "").strip(),
                (fecha_compra or "").strip()[:10],
                (trm_fuente or "").strip()[:40],
                emisor_uid,
                emisor_nom,
                pedido,
                int(compra_id),
            ),
        )
    if envio_id_prev:
        _recalcular_envio(int(envio_id_prev))
        return obtener_compra_exterior(compra_id)
    return (
        _preparar_cuenta_cobro_pendiente(int(compra_id), cuota_pct=cuota_pct)
        or obtener_compra_exterior(compra_id)
    )


def resetear_cuentas_cobro_compras_exterior(
    *,
    compra_ids: list[int] | None = None,
    incluir_envios: bool = True,
    repreparar_pendientes: bool = True,
) -> dict:
    """
    Borra PDFs y limpia campos de cuenta de cobro (mercancía + flete) en compras exterior.
    Si compra_ids es None, limpia todas las que tengan cobro generado/pendiente.
    También limpia cuentas de flete de paquetes (envíos) salvo que incluir_envios=False.
    Con repreparar_pendientes=True vuelve a dejar montos en estado pendiente (sin PDF)
    para reaprobar tras corregir fletes/descuentos.
    """
    from app.services.cuenta_cobro_cuota_manejo import carpeta_pdfs

    _ensure()
    with _conn() as con:
        if compra_ids:
            placeholders = ",".join("?" * len(compra_ids))
            rows = con.execute(
                f"""SELECT id, cuenta_cobro_path, cuenta_flete_path
                    FROM compras_exterior WHERE id IN ({placeholders})""",
                [int(x) for x in compra_ids],
            ).fetchall()
        else:
            rows = con.execute(
                """SELECT id, cuenta_cobro_path, cuenta_flete_path
                   FROM compras_exterior
                   WHERE COALESCE(total_cobro_cop,0)>0
                      OR COALESCE(flete_cobro_cop,0)>0
                      OR TRIM(COALESCE(cuenta_cobro_estado,''))!=''
                      OR TRIM(COALESCE(cuenta_flete_estado,''))!=''
                      OR TRIM(COALESCE(cuenta_cobro_path,''))!=''
                      OR TRIM(COALESCE(cuenta_flete_path,''))!=''"""
            ).fetchall()

    borrados_pdf = 0
    ids: list[int] = []
    base = carpeta_pdfs()
    for row in rows:
        d = dict(row)
        ids.append(int(d["id"]))
        for key in ("cuenta_cobro_path", "cuenta_flete_path"):
            prev = (d.get(key) or "").strip()
            if not prev:
                continue
            full = prev if os.path.isabs(prev) else os.path.join(base, prev)
            try:
                if os.path.isfile(full):
                    os.remove(full)
                    borrados_pdf += 1
            except OSError:
                pass

    if ids:
        with _conn() as con:
            placeholders = ",".join("?" * len(ids))
            con.execute(
                f"""UPDATE compras_exterior SET
                       cuenta_cobro_path='', cuenta_flete_path='',
                       cuota_manejo_cop=0, valor_compra_cop=0, cuota_pct=5,
                       total_cobro_cop=0, flete_cobro_cop=0,
                       cuenta_cobro_estado='', cuenta_flete_estado=''
                     WHERE id IN ({placeholders})""",
                ids,
            )

    envios_limpiados: list[int] = []
    if incluir_envios:
        with _conn() as con:
            if compra_ids:
                # Solo envíos que toquen esas compras
                placeholders = ",".join("?" * len(compra_ids))
                env_rows = con.execute(
                    f"""SELECT DISTINCT e.id, e.cuenta_flete_path
                        FROM compras_exterior_envios e
                        JOIN compras_exterior c ON c.envio_id = e.id
                        WHERE c.id IN ({placeholders})
                          AND (
                            TRIM(COALESCE(e.cuenta_flete_path,''))!=''
                            OR TRIM(COALESCE(e.cuenta_flete_estado,''))!=''
                            OR COALESCE(e.flete_cobro_cop,0)>0
                          )""",
                    [int(x) for x in compra_ids],
                ).fetchall()
            else:
                env_rows = con.execute(
                    """SELECT id, cuenta_flete_path FROM compras_exterior_envios
                       WHERE TRIM(COALESCE(cuenta_flete_path,''))!=''
                          OR TRIM(COALESCE(cuenta_flete_estado,''))!=''
                          OR COALESCE(flete_cobro_cop,0)>0"""
                ).fetchall()
        for row in env_rows:
            d = dict(row)
            eid = int(d["id"])
            envios_limpiados.append(eid)
            prev = (d.get("cuenta_flete_path") or "").strip()
            if prev:
                full = prev if os.path.isabs(prev) else os.path.join(base, prev)
                try:
                    if os.path.isfile(full):
                        os.remove(full)
                        borrados_pdf += 1
                except OSError:
                    pass
        if envios_limpiados:
            with _conn() as con:
                placeholders = ",".join("?" * len(envios_limpiados))
                con.execute(
                    f"""UPDATE compras_exterior_envios SET
                           cuenta_flete_path='', cuenta_flete_estado='',
                           flete_cobro_cop=0
                         WHERE id IN ({placeholders})""",
                    envios_limpiados,
                )

    repreparadas = 0
    if repreparar_pendientes and ids:
        for cid in ids:
            try:
                if _preparar_cuenta_cobro_pendiente(int(cid)):
                    repreparadas += 1
            except Exception:
                pass
    if repreparar_pendientes and envios_limpiados:
        for eid in envios_limpiados:
            try:
                _recalcular_envio(int(eid))
            except Exception:
                pass

    # PDFs huérfanos en la carpeta (nombre cuenta de cobro… sin fila DB)
    huerfanos = 0
    if compra_ids is None and os.path.isdir(base):
        with _conn() as con:
            refs = set()
            for r in con.execute(
                "SELECT cuenta_cobro_path, cuenta_flete_path FROM compras_exterior"
            ).fetchall():
                for k in ("cuenta_cobro_path", "cuenta_flete_path"):
                    v = (r[k] or "").strip()
                    if v:
                        refs.add(os.path.basename(v))
            for r in con.execute(
                "SELECT cuenta_flete_path FROM compras_exterior_envios"
            ).fetchall():
                v = (r["cuenta_flete_path"] or "").strip()
                if v:
                    refs.add(os.path.basename(v))
        for name in os.listdir(base):
            if not name.lower().endswith(".pdf"):
                continue
            if not name.lower().startswith("cuenta de cobro"):
                continue
            if name in refs:
                continue
            try:
                os.remove(os.path.join(base, name))
                huerfanos += 1
                borrados_pdf += 1
            except OSError:
                pass

    return {
        "ok": True,
        "compras_limpiadas": len(ids),
        "ids": ids,
        "envios_limpiados": len(envios_limpiados),
        "envio_ids": envios_limpiados,
        "pdfs_eliminados": borrados_pdf,
        "pdfs_huerfanos": huerfanos,
        "repreparadas": repreparadas,
    }


def _preparar_cuenta_cobro_pendiente(
    compra_id: int,
    *,
    cuota_pct: float | None = None,
) -> dict | None:
    """Calcula montos: mercancía+% y flete (aparte). Ambas pendientes sin PDF."""
    import json

    _ensure()
    with _conn() as con:
        row = con.execute(
            "SELECT * FROM compras_exterior WHERE id = ?",
            (int(compra_id),),
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        try:
            lineas = json.loads(d.get("lineas_json") or "[]")
        except Exception:
            lineas = []

    from app.services.cuenta_cobro_cuota_manejo import (
        calcular_cuota,
        carpeta_pdfs,
        resolver_tasa_cuenta_cobro,
    )

    pct_eff = cuota_pct
    if pct_eff is None:
        try:
            stored = float(d.get("cuota_pct") or 0)
            pct_eff = stored if stored > 0 else None
        except (TypeError, ValueError):
            pct_eff = None

    moneda = str(d.get("moneda") or "USD")
    trm = float(d.get("trm") or 0)
    trm_fuente = str(d.get("trm_fuente") or "")
    moneda_flete = str(d.get("moneda_flete") or "")
    fecha_compra = str(d.get("fecha_compra") or "")
    resolved = resolver_tasa_cuenta_cobro(
        moneda=moneda,
        trm=trm,
        fecha_compra=fecha_compra,
        lineas=lineas,
    )
    if not resolved.get("error") and float(resolved.get("trm") or 0) > 0:
        moneda = str(resolved["moneda"])
        trm = float(resolved["trm"])
        trm_fuente = str(resolved.get("trm_fuente") or trm_fuente)
        if resolved.get("fecha_trm") and not fecha_compra:
            fecha_compra = str(resolved["fecha_trm"])[:10]
        if (
            resolved.get("corregido")
            and (moneda_flete or "").strip().upper() in ("", "COP")
            and float(d.get("flete") or 0) > 0
        ):
            moneda_flete = moneda

    calc = calcular_cuota(
        moneda=moneda,
        trm=trm,
        lineas=lineas,
        pct=pct_eff,
        flete=0.0 if d.get("envio_id") else float(d.get("flete") or 0),
        moneda_flete=moneda_flete,
    )

    for key in ("cuenta_cobro_path", "cuenta_flete_path"):
        prev = (d.get(key) or "").strip()
        if not prev:
            continue
        try:
            full_prev = prev if os.path.isabs(prev) else os.path.join(carpeta_pdfs(), prev)
            if os.path.isfile(full_prev):
                os.remove(full_prev)
        except OSError:
            pass

    estado_m = "pendiente" if calc["total_cobro_cop"] > 0 else ""
    estado_f = "pendiente" if calc["flete_cop"] > 0 else ""
    with _conn() as con:
        con.execute(
            """UPDATE compras_exterior SET
                 moneda=?, trm=?, trm_fuente=?, moneda_flete=?, fecha_compra=?,
                 cuenta_cobro_path=?, cuota_manejo_cop=?, valor_compra_cop=?, cuota_pct=?,
                 total_cobro_cop=?, flete_cobro_cop=?, cuenta_cobro_estado=?,
                 cuenta_flete_path=?, cuenta_flete_estado=?
               WHERE id=?""",
            (
                moneda,
                float(trm or 0),
                (trm_fuente or "")[:40],
                (moneda_flete or "").strip().upper(),
                (fecha_compra or "")[:10],
                "",
                float(calc.get("cuota_manejo_cop") or 0),
                float(calc.get("valor_compra_cop") or 0),
                float(calc.get("pct") or 5),
                float(calc.get("total_cobro_cop") or 0),
                float(calc.get("flete_cop") or 0),
                estado_m,
                "",
                estado_f,
                int(compra_id),
            ),
        )
    return obtener_compra_exterior(compra_id)


def aprobar_cuenta_cobro_compra(
    compra_id: int,
    *,
    accent_rgb: str = "",
    tipo: str = "mercancia",
    cuota_pct: float | None = None,
    emisor_perfil: dict | None = None,
) -> dict | None:
    """Aprueba cuenta mercancía o flete (tipo=mercancia|flete) y genera PDF con acento."""
    import json

    tipo_n = (tipo or "mercancia").strip().lower()
    if tipo_n in ("envio", "shipping", "freight"):
        tipo_n = "flete"
    if tipo_n not in ("mercancia", "flete"):
        tipo_n = "mercancia"

    _ensure()
    with _conn() as con:
        row = con.execute(
            "SELECT * FROM compras_exterior WHERE id = ?",
            (int(compra_id),),
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        try:
            lineas = json.loads(d.get("lineas_json") or "[]")
        except Exception:
            lineas = []

    if tipo_n == "flete" and d.get("envio_id"):
        return obtener_compra_exterior(compra_id)

    if emisor_perfil is None:
        from app.services.cuenta_cobro_cuota_manejo import perfil_emisor_por_id

        emisor_perfil = perfil_emisor_por_id(d.get("emisor_usuario_id"))
    emisor_uid, emisor_nom = _resolver_emisor_compra(emisor_perfil=emisor_perfil)
    if emisor_uid is None:
        try:
            stored_uid = int(d.get("emisor_usuario_id") or 0)
        except (TypeError, ValueError):
            stored_uid = 0
        emisor_uid = stored_uid if stored_uid > 0 else None
        emisor_nom = str(d.get("emisor_nombre") or "").strip()

    from app.services.cuenta_cobro_cuota_manejo import (
        carpeta_pdfs,
        generar_pdf_cuenta_cobro,
        generar_pdf_cuenta_flete,
        resolver_accent_cuenta_cobro,
        resolver_tasa_cuenta_cobro,
    )

    accent_rgb = resolver_accent_cuenta_cobro(
        accent_rgb, emisor_perfil=emisor_perfil
    )

    moneda = str(d.get("moneda") or "USD")
    trm = float(d.get("trm") or 0)
    trm_fuente = str(d.get("trm_fuente") or "")
    moneda_flete = str(d.get("moneda_flete") or "")
    fecha_compra = str(d.get("fecha_compra") or "")
    resolved = resolver_tasa_cuenta_cobro(
        moneda=moneda,
        trm=trm,
        fecha_compra=fecha_compra,
        lineas=lineas,
    )
    if not resolved.get("error") and float(resolved.get("trm") or 0) > 0:
        moneda = str(resolved["moneda"])
        trm = float(resolved["trm"])
        trm_fuente = str(resolved.get("trm_fuente") or trm_fuente)
        if resolved.get("fecha_trm") and not fecha_compra:
            fecha_compra = str(resolved["fecha_trm"])[:10]
        if (
            resolved.get("corregido")
            and (moneda_flete or "").strip().upper() in ("", "COP")
            and float(d.get("flete") or 0) > 0
        ):
            moneda_flete = moneda

    path_key = "cuenta_flete_path" if tipo_n == "flete" else "cuenta_cobro_path"
    prev = (d.get(path_key) or "").strip()
    if prev:
        try:
            full_prev = prev if os.path.isabs(prev) else os.path.join(carpeta_pdfs(), prev)
            if os.path.isfile(full_prev):
                os.remove(full_prev)
        except OSError:
            pass

    if tipo_n == "flete":
        gen = generar_pdf_cuenta_flete(
            compra_id=int(compra_id),
            moneda=moneda,
            trm=trm,
            flete=float(d.get("flete") or 0),
            moneda_flete=moneda_flete,
            proveedor=str(d.get("proveedor") or ""),
            fecha_compra=fecha_compra,
            accent_rgb=accent_rgb,
            emisor_perfil=emisor_perfil,
            numero_pedido=str(d.get("numero_pedido") or ""),
        )
        if gen.get("error") or not gen.get("filename"):
            return obtener_compra_exterior(compra_id)
        with _conn() as con:
            con.execute(
                """UPDATE compras_exterior SET
                     cuenta_flete_path=?, flete_cobro_cop=?, cuenta_flete_estado=?,
                     emisor_usuario_id=?, emisor_nombre=?
                   WHERE id=?""",
                (
                    gen.get("filename") or "",
                    float(gen.get("flete_cop") or 0),
                    "aprobada",
                    emisor_uid,
                    emisor_nom,
                    int(compra_id),
                ),
            )
        return obtener_compra_exterior(compra_id)

    pct_eff = cuota_pct
    if pct_eff is None:
        try:
            stored = float(d.get("cuota_pct") or 0)
            pct_eff = stored if stored > 0 else None
        except (TypeError, ValueError):
            pct_eff = None

    gen = generar_pdf_cuenta_cobro(
        compra_id=int(compra_id),
        moneda=moneda,
        trm=trm,
        proveedor=str(d.get("proveedor") or ""),
        fecha_compra=fecha_compra,
        lineas=lineas,
        pct=pct_eff,
        accent_rgb=accent_rgb,
        emisor_perfil=emisor_perfil,
        numero_pedido=str(d.get("numero_pedido") or ""),
    )
    if gen.get("error") or not gen.get("filename"):
        return obtener_compra_exterior(compra_id)

    with _conn() as con:
        con.execute(
            """UPDATE compras_exterior SET
                 moneda=?, trm=?, trm_fuente=?, moneda_flete=?, fecha_compra=?,
                 cuenta_cobro_path=?, cuota_manejo_cop=?, valor_compra_cop=?, cuota_pct=?,
                 total_cobro_cop=?, cuenta_cobro_estado=?,
                 emisor_usuario_id=?, emisor_nombre=?
               WHERE id=?""",
            (
                moneda,
                float(trm or 0),
                (trm_fuente or "")[:40],
                (moneda_flete or "").strip().upper(),
                (fecha_compra or "")[:10],
                gen.get("filename") or "",
                float(gen.get("cuota_manejo_cop") or 0),
                float(gen.get("valor_compra_cop") or 0),
                float(gen.get("pct") or 5),
                float(gen.get("total_cobro_cop") or 0),
                "aprobada",
                emisor_uid,
                emisor_nom,
                int(compra_id),
            ),
        )
    return obtener_compra_exterior(compra_id)


def regenerar_cuenta_cobro_compra(
    compra_id: int,
    *,
    accent_rgb: str = "",
    tipo: str = "mercancia",
    cuota_pct: float | None = None,
    emisor_perfil: dict | None = None,
) -> dict | None:
    return aprobar_cuenta_cobro_compra(
        int(compra_id),
        accent_rgb=accent_rgb,
        tipo=tipo,
        cuota_pct=cuota_pct,
        emisor_perfil=emisor_perfil,
    )


def _adjuntar_cuenta_cobro_cuota(
    compra_id: int, *, cuota_pct: float | None = None
) -> dict | None:
    """Compat: al guardar compra solo deja pendiente (sin PDF)."""
    return _preparar_cuenta_cobro_pendiente(compra_id, cuota_pct=cuota_pct)


def ruta_cuenta_cobro_compra(
    compra_id: int, *, tipo: str = "mercancia"
) -> tuple[str, str] | None:
    """PDF aprobado de mercancía o flete."""
    tipo_n = (tipo or "mercancia").strip().lower()
    if tipo_n in ("envio", "shipping", "freight"):
        tipo_n = "flete"
    col = "cuenta_flete_path" if tipo_n == "flete" else "cuenta_cobro_path"
    _ensure()
    with _conn() as con:
        try:
            row = con.execute(
                f"SELECT {col} FROM compras_exterior WHERE id = ?",
                (int(compra_id),),
            ).fetchone()
        except Exception:
            return None
    if not row:
        return None
    fname = (row[0] or "").strip()
    if not fname:
        return None
    from app.services.cuenta_cobro_cuota_manejo import carpeta_pdfs

    full = fname if os.path.isabs(fname) else os.path.join(carpeta_pdfs(), fname)
    if not os.path.isfile(full):
        return None
    return full, os.path.basename(fname)


def previsualizar_cuenta_cobro_compra(
    compra_id: int,
    *,
    tipo: str = "mercancia",
    accent_rgb: str = "",
    cuota_pct: float | None = None,
    emisor_perfil: dict | None = None,
) -> tuple[str | None, str]:
    """
    Genera un PDF de borrador (no aprueba ni cambia estado) para vista previa en el panel.
    Retorna (ruta_absoluta, error).
    """
    import json

    tipo_n = (tipo or "mercancia").strip().lower()
    if tipo_n in ("envio", "shipping", "freight"):
        tipo_n = "flete"
    if tipo_n not in ("mercancia", "flete"):
        tipo_n = "mercancia"

    _ensure()
    with _conn() as con:
        row = con.execute(
            "SELECT * FROM compras_exterior WHERE id = ?",
            (int(compra_id),),
        ).fetchone()
        if not row:
            return None, "Compra no encontrada"
        d = dict(row)
        try:
            lineas = json.loads(d.get("lineas_json") or "[]")
        except Exception:
            lineas = []

    if tipo_n == "flete" and d.get("envio_id"):
        return None, "El flete de esta compra va en el paquete de envío"

    if emisor_perfil is None:
        from app.services.cuenta_cobro_cuota_manejo import perfil_emisor_por_id

        emisor_perfil = perfil_emisor_por_id(d.get("emisor_usuario_id"))

    from app.services.cuenta_cobro_cuota_manejo import (
        generar_pdf_cuenta_cobro,
        generar_pdf_cuenta_flete,
        nombre_archivo_cuenta_cobro,
        resolver_accent_cuenta_cobro,
        resolver_tasa_cuenta_cobro,
    )

    accent_rgb = resolver_accent_cuenta_cobro(accent_rgb, emisor_perfil=emisor_perfil)
    moneda = str(d.get("moneda") or "USD")
    trm = float(d.get("trm") or 0)
    moneda_flete = str(d.get("moneda_flete") or "")
    fecha_compra = str(d.get("fecha_compra") or "")
    resolved = resolver_tasa_cuenta_cobro(
        moneda=moneda,
        trm=trm,
        fecha_compra=fecha_compra,
        lineas=lineas,
    )
    if not resolved.get("error") and float(resolved.get("trm") or 0) > 0:
        moneda = str(resolved["moneda"])
        trm = float(resolved["trm"])
        if resolved.get("fecha_trm") and not fecha_compra:
            fecha_compra = str(resolved["fecha_trm"])[:10]
        if (
            resolved.get("corregido")
            and (moneda_flete or "").strip().upper() in ("", "COP")
            and float(d.get("flete") or 0) > 0
        ):
            moneda_flete = moneda

    pct_eff = cuota_pct
    if pct_eff is None:
        try:
            stored = float(d.get("cuota_pct") or 0)
            pct_eff = stored if stored > 0 else None
        except (TypeError, ValueError):
            pct_eff = None

    preview_name = "preview_" + nombre_archivo_cuenta_cobro(
        int(compra_id), flete=(tipo_n == "flete")
    )

    if tipo_n == "flete":
        if float(d.get("flete") or 0) <= 0 and float(d.get("flete_cobro_cop") or 0) <= 0:
            return None, "Sin flete para previsualizar"
        gen = generar_pdf_cuenta_flete(
            compra_id=int(compra_id),
            moneda=moneda,
            trm=trm,
            flete=float(d.get("flete") or 0),
            moneda_flete=moneda_flete,
            proveedor=str(d.get("proveedor") or ""),
            fecha_compra=fecha_compra,
            accent_rgb=accent_rgb,
            emisor_perfil=emisor_perfil,
            filename=preview_name,
            numero_pedido=str(d.get("numero_pedido") or ""),
        )
    else:
        if float(d.get("total_cobro_cop") or 0) <= 0 and float(d.get("valor_compra_cop") or 0) <= 0:
            # Intentar calcular aunque aún no esté preparado
            pass
        gen = generar_pdf_cuenta_cobro(
            compra_id=int(compra_id),
            moneda=moneda,
            trm=trm,
            proveedor=str(d.get("proveedor") or ""),
            fecha_compra=fecha_compra,
            lineas=lineas,
            pct=pct_eff,
            flete=0.0,
            moneda_flete=moneda_flete,
            accent_rgb=accent_rgb,
            emisor_perfil=emisor_perfil,
            numero_pedido=str(d.get("numero_pedido") or ""),
            output_filename=preview_name,
        )

    if gen.get("error") or not gen.get("path"):
        return None, str(gen.get("error") or "No se pudo generar la vista previa")
    path = str(gen["path"])
    if not os.path.isfile(path):
        return None, "PDF de vista previa no encontrado"
    return path, ""


def _parse_soporte_paths(raw: str | None) -> list[str]:
    import json

    s = (raw or "").strip()
    if not s:
        return []
    if s.startswith("["):
        try:
            arr = json.loads(s)
            if isinstance(arr, list):
                return [str(x) for x in arr if x]
        except Exception:
            pass
    return [s]


def ruta_soporte_compra_exterior(
    compra_id: int, index: int = 0
) -> tuple[str | None, str, str]:
    """Devuelve (abspath, mime, nombre) del soporte o (None, '', '')."""
    _ensure()
    with _conn() as con:
        row = con.execute(
            "SELECT soporte_path, soporte_mime, soporte_nombre FROM compras_exterior WHERE id = ?",
            (int(compra_id),),
        ).fetchone()
    if not row or not row["soporte_path"]:
        return None, "", ""
    paths = _parse_soporte_paths(row["soporte_path"])
    if not paths:
        return None, "", ""
    idx = max(0, min(int(index or 0), len(paths) - 1))
    fname = paths[idx]
    full = os.path.join(_soportes_dir(), fname)
    if not os.path.isfile(full):
        return None, "", ""
    mime = "application/octet-stream"
    low = fname.lower()
    if low.endswith(".pdf"):
        mime = "application/pdf"
    elif low.endswith(".png"):
        mime = "image/png"
    elif low.endswith(".webp"):
        mime = "image/webp"
    elif low.endswith((".jpg", ".jpeg")):
        mime = "image/jpeg"
    nombre = row["soporte_nombre"] or fname
    if len(paths) > 1:
        nombre = fname
    return full, mime, nombre


def _compra_exterior_row(d: dict) -> dict:
    paths = _parse_soporte_paths(d.get("soporte_path"))
    cid = d.get("id")
    cc_path = (d.get("cuenta_cobro_path") or "").strip()
    cuota = float(d.get("cuota_manejo_cop") or 0)
    valor_c = float(d.get("valor_compra_cop") or 0)
    pct = float(d.get("cuota_pct") or 5)
    flete_c = float(d.get("flete_cobro_cop") or 0)
    total_c = float(d.get("total_cobro_cop") or 0)
    if total_c <= 0 and (valor_c > 0 or cuota > 0):
        total_c = round(valor_c + cuota, 2)
    estado = (d.get("cuenta_cobro_estado") or "").strip()
    if not estado and total_c > 0:
        estado = "aprobada" if cc_path else "pendiente"
    flete_path = (d.get("cuenta_flete_path") or "").strip()
    estado_f = (d.get("cuenta_flete_estado") or "").strip()
    if not estado_f and flete_c > 0:
        estado_f = "aprobada" if flete_path else "pendiente"
    return {
        "id": cid,
        "created_at": d.get("created_at"),
        "moneda": d.get("moneda"),
        "trm": d.get("trm"),
        "trm_fuente": d.get("trm_fuente") or "",
        "fecha_compra": d.get("fecha_compra") or "",
        "numero_pedido": (d.get("numero_pedido") or "").strip(),
        "flete": d.get("flete"),
        "moneda_flete": d.get("moneda_flete"),
        "proveedor": d.get("proveedor"),
        "tiene_soporte": bool(paths),
        "soporte_nombre": d.get("soporte_nombre") or "",
        "soporte_mime": d.get("soporte_mime") or "",
        "soportes_count": len(paths),
        "lineas": d.get("lineas") if isinstance(d.get("lineas"), list) else [],
        "total_guardados": d.get("total_guardados") or 0,
        "notas": d.get("notas") or "",
        "soporte_url": f"/api/rentabilidad/compras-exterior/{cid}/soporte" if paths else None,
        "soporte_urls": [
            f"/api/rentabilidad/compras-exterior/{cid}/soporte?i={i}" for i in range(len(paths))
        ]
        if paths
        else [],
        "cuenta_cobro_path": cc_path,
        "cuenta_cobro_estado": estado,
        "tiene_cuenta_cobro": bool(cc_path) and estado == "aprobada",
        "cuenta_cobro_pendiente": estado == "pendiente" and total_c > 0,
        "cuota_manejo_cop": cuota,
        "valor_compra_cop": valor_c,
        "flete_cobro_cop": flete_c,
        "total_cobro_cop": total_c,
        "cuota_pct": pct,
        "cuenta_cobro_url": (
            f"/api/rentabilidad/compras-exterior/{cid}/cuenta-cobro"
            if cc_path and estado == "aprobada"
            else None
        ),
        "cuenta_flete_path": flete_path,
        "cuenta_flete_estado": estado_f,
        "tiene_cuenta_flete": bool(flete_path) and estado_f == "aprobada",
        "cuenta_flete_pendiente": estado_f == "pendiente" and flete_c > 0,
        "cuenta_flete_url": (
            f"/api/rentabilidad/compras-exterior/{cid}/cuenta-cobro?tipo=flete"
            if flete_path and estado_f == "aprobada"
            else None
        ),
        "comprado_por": (d.get("comprado_por") or "").strip(),
        "emisor_usuario_id": d.get("emisor_usuario_id"),
        "emisor_nombre": _nombre_emisor_compra(d),
        "emisor_documento": _documento_emisor_compra(d),
        "envio_id": d.get("envio_id"),
        "envio": d.get("envio") if isinstance(d.get("envio"), dict) else None,
    }


def _paquetes_totales_lineas(lineas: list) -> float:
    """Suma de packs (`cantidad`) — base del % de flete en envíos consolidados."""
    total = 0.0
    for ln in lineas or []:
        if not isinstance(ln, dict):
            continue
        try:
            packs = max(float(ln.get("cantidad") or 0), 0.0) or 1.0
        except (TypeError, ValueError):
            packs = 1.0
        total += packs
    return total


def _unidades_totales_lineas(lineas: list) -> float:
    total = 0.0
    for ln in lineas or []:
        if not isinstance(ln, dict):
            continue
        try:
            packs = max(float(ln.get("cantidad") or 0), 0.0) or 1.0
        except (TypeError, ValueError):
            packs = 1.0
        try:
            upp = max(float(ln.get("unidades_por_pack") or 1), 0.0) or 1.0
        except (TypeError, ValueError):
            upp = 1.0
        total += packs * upp
    return total


def _envio_publico(d: dict, *, compra_ids: list[int] | None = None) -> dict:
    eid = d.get("id")
    flete_c = float(d.get("flete_cobro_cop") or 0)
    estado_f = (d.get("cuenta_flete_estado") or "").strip()
    flete_path = (d.get("cuenta_flete_path") or "").strip()
    if not estado_f and flete_c > 0:
        estado_f = "aprobada" if flete_path else "pendiente"
    ids = compra_ids if compra_ids is not None else list(d.get("compra_ids") or [])
    return {
        "id": eid,
        "created_at": d.get("created_at"),
        "fecha_envio": (d.get("fecha_envio") or "").strip()[:10],
        "flete": float(d.get("flete") or 0),
        "moneda_flete": (d.get("moneda_flete") or "USD").strip().upper(),
        "trm": float(d.get("trm") or 0),
        "trm_fuente": (d.get("trm_fuente") or "").strip(),
        "notas": d.get("notas") or "",
        "compra_ids": ids,
        "emisor_usuario_id": d.get("emisor_usuario_id"),
        "emisor_nombre": (d.get("emisor_nombre") or "").strip(),
        "flete_cobro_cop": flete_c,
        "cuenta_flete_estado": estado_f,
        "tiene_cuenta_flete": bool(flete_path) and estado_f == "aprobada",
        "cuenta_flete_pendiente": estado_f == "pendiente" and flete_c > 0,
        "cuenta_flete_url": (
            f"/api/rentabilidad/compras-exterior/envios/{eid}/cuenta-cobro"
            if flete_path and estado_f == "aprobada"
            else None
        ),
    }


def _envios_por_ids(envio_ids: set[int]) -> dict[int, dict]:
    ids = [int(i) for i in envio_ids if i]
    if not ids:
        return {}
    _ensure()
    ph = ",".join("?" * len(ids))
    with _conn() as con:
        rows = con.execute(
            f"SELECT * FROM compras_exterior_envios WHERE id IN ({ph})",
            ids,
        ).fetchall()
        links = con.execute(
            f"SELECT id, envio_id FROM compras_exterior WHERE envio_id IN ({ph}) ORDER BY id",
            ids,
        ).fetchall()
    por_envio: dict[int, list[int]] = {int(i): [] for i in ids}
    for r in links:
        try:
            eid = int(r["envio_id"] or 0)
            cid = int(r["id"])
        except (TypeError, ValueError):
            continue
        if eid in por_envio:
            por_envio[eid].append(cid)
    out: dict[int, dict] = {}
    for r in rows:
        d = dict(r)
        eid = int(d["id"])
        out[eid] = _envio_publico(d, compra_ids=por_envio.get(eid) or [])
    return out


def _compras_de_envio(envio_id: int) -> list[dict]:
    import json

    _ensure()
    with _conn() as con:
        rows = con.execute(
            "SELECT * FROM compras_exterior WHERE envio_id = ? ORDER BY id",
            (int(envio_id),),
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["lineas"] = json.loads(d.get("lineas_json") or "[]")
        except Exception:
            d["lineas"] = []
        out.append(d)
    return out


def _resolver_trm_fecha_envio(fecha_envio: str, trm: float = 0, consultar: bool = True) -> tuple[float, str]:
    fecha = (fecha_envio or "").strip()[:10]
    try:
        tasa = float(trm or 0)
    except (TypeError, ValueError):
        tasa = 0.0
    if consultar and fecha:
        try:
            from app.services.trm import obtener_trm

            data = obtener_trm(fecha=fecha) or {}
            valor = float(data.get("valor") or 0)
            if valor > 0:
                return valor, "banrep"
        except Exception:
            pass
    if tasa > 0:
        return tasa, "manual"
    return 0.0, ""


def _limpiar_cuenta_flete_compra(d: dict) -> None:
    from app.services.cuenta_cobro_cuota_manejo import carpeta_pdfs

    prev = (d.get("cuenta_flete_path") or "").strip()
    if not prev:
        return
    try:
        full = prev if os.path.isabs(prev) else os.path.join(carpeta_pdfs(), prev)
        if os.path.isfile(full):
            os.remove(full)
    except OSError:
        pass


def _aplicar_costos_lineas_compra(
    d: dict,
    lineas: list,
    flete_cop: float,
    *,
    prorrateo_flete: str = "paquetes",
) -> None:
    """Recalcula landed de una compra: mercancía con TRM propia, flete ya en COP.

    En envíos consolidados el flete se reparte por % de paquetes (`cantidad`).
    """
    import json

    from app.services.compra_exterior_ocr import calcular_landed

    moneda = str(d.get("moneda") or "USD")
    trm = float(d.get("trm") or 0)
    landed = calcular_landed(
        lineas,
        trm=trm,
        flete=float(flete_cop or 0),
        moneda=moneda,
        moneda_flete="COP",
        prorrateo_flete=prorrateo_flete,
    )
    nuevos = []
    for i, ln in enumerate(lineas):
        row = dict(ln) if isinstance(ln, dict) else {}
        if i < len(landed):
            costo = landed[i].get("costo_unitario_cop")
            if costo is not None:
                try:
                    row["costo_unitario"] = float(costo)
                    row["costo_unitario_cop"] = float(costo)
                except (TypeError, ValueError):
                    pass
            if landed[i].get("flete_asignado_cop") is not None:
                row["flete_asignado_cop"] = landed[i].get("flete_asignado_cop")
        nuevos.append(row)
        nombre = (row.get("nombre") or "").strip()
        if not nombre:
            continue
        try:
            costo_u = float(row.get("costo_unitario") or 0)
        except (TypeError, ValueError):
            continue
        if costo_u < 0:
            continue
        cat = (row.get("categoria") or "material").strip() or "material"
        try:
            upsert_componente(nombre, costo_u, cat, bool(row.get("iva_incluido")))
        except Exception:
            pass
        try:
            from app.services.alegra import actualizar_costo_componente_alegra

            actualizar_costo_componente_alegra(nombre, costo_u)
        except Exception:
            pass

    with _conn() as con:
        con.execute(
            """UPDATE compras_exterior SET
                 lineas_json=?, flete=0, moneda_flete=?,
                 cuenta_flete_path='', cuenta_flete_estado='', flete_cobro_cop=0
               WHERE id=?""",
            (
                json.dumps(nuevos, ensure_ascii=False),
                (d.get("moneda_flete") or "").strip().upper(),
                int(d["id"]),
            ),
        )


def _recalcular_envio(envio_id: int) -> dict | None:
    """Reparte el flete del paquete (TRM del día de envío) por % de packs entre referencias."""
    from app.services.cuenta_cobro_cuota_manejo import flete_en_cop, carpeta_pdfs

    _ensure()
    with _conn() as con:
        row = con.execute(
            "SELECT * FROM compras_exterior_envios WHERE id = ?",
            (int(envio_id),),
        ).fetchone()
    if not row:
        return None
    env = dict(row)
    compras = _compras_de_envio(int(envio_id))
    if not compras:
        eliminar_envio_compras(int(envio_id), borrar_si_vacio=True)
        return None

    fecha = (env.get("fecha_envio") or "").strip()[:10]
    trm, fuente = _resolver_trm_fecha_envio(fecha, float(env.get("trm") or 0))
    moneda_f = (env.get("moneda_flete") or "USD").strip().upper() or "USD"
    flete_orig = float(env.get("flete") or 0)
    flete_cop = flete_en_cop(
        moneda="USD" if moneda_f != "COP" else "COP",
        trm=trm if moneda_f != "COP" else 1,
        flete=flete_orig,
        moneda_flete=moneda_f,
    )

    # % del total de paquetes (cantidad) en todo el envío → cada compra y cada referencia
    paquetes = [_paquetes_totales_lineas(c.get("lineas") or []) for c in compras]
    suma_p = sum(paquetes) or 1.0
    for c, packs in zip(compras, paquetes):
        _limpiar_cuenta_flete_compra(c)
        share = flete_cop * (packs / suma_p) if flete_cop > 0 else 0.0
        _aplicar_costos_lineas_compra(
            c,
            c.get("lineas") or [],
            share,
            prorrateo_flete="paquetes",
        )

    prev_pdf = (env.get("cuenta_flete_path") or "").strip()
    if prev_pdf:
        try:
            full = prev_pdf if os.path.isabs(prev_pdf) else os.path.join(carpeta_pdfs(), prev_pdf)
            if os.path.isfile(full):
                os.remove(full)
        except OSError:
            pass

    estado_f = "pendiente" if flete_cop > 0 else ""
    with _conn() as con:
        con.execute(
            """UPDATE compras_exterior_envios SET
                 trm=?, trm_fuente=?, flete_cobro_cop=?,
                 cuenta_flete_path='', cuenta_flete_estado=?
               WHERE id=?""",
            (float(trm or 0), (fuente or "")[:40], float(flete_cop), estado_f, int(envio_id)),
        )
    return obtener_envio_compras(int(envio_id))


def recalcular_costos_unitarios_envio(
    envio_id: int,
) -> tuple[dict | None, list[dict], str]:
    """
    Reaplica el flete del envío a cada referencia (por % de paquetes) y actualiza
    costos unitarios en historial / componentes / Siigo.

    No borra la cuenta de cobro de flete ya aprobada (solo refresca costos).
    """
    from app.services.cuenta_cobro_cuota_manejo import flete_en_cop

    _ensure()
    with _conn() as con:
        row = con.execute(
            "SELECT * FROM compras_exterior_envios WHERE id = ?",
            (int(envio_id),),
        ).fetchone()
    if not row:
        return None, [], "Envío no encontrado"
    env = dict(row)
    compras = _compras_de_envio(int(envio_id))
    if not compras:
        return None, [], "El envío no tiene compras enlazadas"
    if float(env.get("flete") or 0) <= 0:
        return None, [], "El envío no tiene flete; edítalo e indica el valor del paquete"

    fecha = (env.get("fecha_envio") or "").strip()[:10]
    trm, fuente = _resolver_trm_fecha_envio(fecha, float(env.get("trm") or 0))
    moneda_f = (env.get("moneda_flete") or "USD").strip().upper() or "USD"
    flete_orig = float(env.get("flete") or 0)
    flete_cop = flete_en_cop(
        moneda="USD" if moneda_f != "COP" else "COP",
        trm=trm if moneda_f != "COP" else 1,
        flete=flete_orig,
        moneda_flete=moneda_f,
    )

    paquetes = [_paquetes_totales_lineas(c.get("lineas") or []) for c in compras]
    suma_p = sum(paquetes) or 1.0
    for c, packs in zip(compras, paquetes):
        share = flete_cop * (packs / suma_p) if flete_cop > 0 else 0.0
        _aplicar_costos_lineas_compra(
            c,
            c.get("lineas") or [],
            share,
            prorrateo_flete="paquetes",
        )

    estado_prev = (env.get("cuenta_flete_estado") or "").strip()
    path_prev = (env.get("cuenta_flete_path") or "").strip()
    # Si ya había PDF aprobado, mantenerlo; solo refrescar montos/TRM
    with _conn() as con:
        con.execute(
            """UPDATE compras_exterior_envios SET
                 trm=?, trm_fuente=?, flete_cobro_cop=?
               WHERE id=?""",
            (float(trm or 0), (fuente or "")[:40], float(flete_cop), int(envio_id)),
        )
        if estado_prev != "aprobada" or not path_prev:
            con.execute(
                """UPDATE compras_exterior_envios SET
                     cuenta_flete_estado=?
                   WHERE id=?""",
                ("pendiente" if flete_cop > 0 else "", int(envio_id)),
            )

    env_out = obtener_envio_compras(int(envio_id))
    compras_out = [obtener_compra_exterior(int(c["id"])) for c in compras]
    compras_out = [c for c in compras_out if c]
    return env_out, compras_out, ""


def crear_envio_compras(
    compra_ids: list[int],
    *,
    fecha_envio: str,
    flete: float,
    moneda_flete: str = "USD",
    notas: str = "",
    emisor_usuario_id: int | None = None,
    trm: float = 0,
) -> tuple[dict | None, str]:
    ids: list[int] = []
    for raw in compra_ids or []:
        try:
            cid = int(raw)
        except (TypeError, ValueError):
            continue
        if cid > 0 and cid not in ids:
            ids.append(cid)
    if len(ids) < 1:
        return None, "Selecciona al menos una compra para el envío"
    fecha = (fecha_envio or "").strip()[:10]
    if not fecha or len(fecha) < 10:
        return None, "Indica la fecha del envío (YYYY-MM-DD)"
    try:
        flete_v = float(flete or 0)
    except (TypeError, ValueError):
        return None, "Flete inválido"
    if flete_v < 0:
        return None, "El flete no puede ser negativo"

    _ensure()
    with _conn() as con:
        ph = ",".join("?" * len(ids))
        rows = con.execute(
            f"SELECT id, envio_id FROM compras_exterior WHERE id IN ({ph})",
            ids,
        ).fetchall()
        encontrados = {int(r["id"]) for r in rows}
        faltan = [i for i in ids if i not in encontrados]
        if faltan:
            return None, f"Compras no encontradas: {faltan}"
        viejos = []
        for r in rows:
            try:
                eid = int(r["envio_id"] or 0)
            except (TypeError, ValueError):
                eid = 0
            if eid > 0:
                viejos.append(eid)

    emisor_uid, emisor_nom = _resolver_emisor_compra(emisor_usuario_id)
    trm_res, fuente = _resolver_trm_fecha_envio(fecha, trm)
    now = datetime.now().isoformat()
    with _conn() as con:
        cur = con.execute(
            """INSERT INTO compras_exterior_envios
                 (created_at, fecha_envio, flete, moneda_flete, trm, trm_fuente,
                  notas, emisor_usuario_id, emisor_nombre)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                now,
                fecha,
                float(flete_v),
                (moneda_flete or "USD").strip().upper() or "USD",
                float(trm_res or 0),
                (fuente or "")[:40],
                (notas or "").strip(),
                emisor_uid,
                emisor_nom,
            ),
        )
        nuevo_id = int(cur.lastrowid)
        con.execute(
            f"UPDATE compras_exterior SET envio_id=? WHERE id IN ({','.join('?' * len(ids))})",
            [nuevo_id, *ids],
        )

    for eid in sorted(set(viejos)):
        restantes = _compras_de_envio(eid)
        if not restantes:
            eliminar_envio_compras(eid, borrar_si_vacio=True)
        else:
            _recalcular_envio(eid)

    env = _recalcular_envio(nuevo_id)
    if not env:
        return None, "No se pudo liquidar el flete del envío"
    return env, ""


def actualizar_envio_compras(
    envio_id: int,
    *,
    fecha_envio: str | None = None,
    flete: float | None = None,
    moneda_flete: str | None = None,
    notas: str | None = None,
    compra_ids: list[int] | None = None,
    emisor_usuario_id: int | None = None,
    trm: float | None = None,
) -> tuple[dict | None, str]:
    _ensure()
    with _conn() as con:
        row = con.execute(
            "SELECT * FROM compras_exterior_envios WHERE id = ?",
            (int(envio_id),),
        ).fetchone()
        if not row:
            return None, "Envío no encontrado"
        env = dict(row)

    campos: list[str] = []
    vals: list = []
    if fecha_envio is not None:
        fecha = str(fecha_envio).strip()[:10]
        if not fecha:
            return None, "Fecha de envío inválida"
        campos.append("fecha_envio=?")
        vals.append(fecha)
        env["fecha_envio"] = fecha
    if flete is not None:
        try:
            flete_v = float(flete)
        except (TypeError, ValueError):
            return None, "Flete inválido"
        if flete_v < 0:
            return None, "El flete no puede ser negativo"
        campos.append("flete=?")
        vals.append(flete_v)
    if moneda_flete is not None:
        campos.append("moneda_flete=?")
        vals.append((moneda_flete or "USD").strip().upper() or "USD")
    if notas is not None:
        campos.append("notas=?")
        vals.append((notas or "").strip())
    if trm is not None:
        try:
            campos.append("trm=?")
            vals.append(float(trm or 0))
        except (TypeError, ValueError):
            return None, "TRM inválida"
    if emisor_usuario_id is not None:
        emisor_uid, emisor_nom = _resolver_emisor_compra(emisor_usuario_id)
        campos.append("emisor_usuario_id=?")
        vals.append(emisor_uid)
        campos.append("emisor_nombre=?")
        vals.append(emisor_nom)

    if compra_ids is not None:
        ids: list[int] = []
        for raw in compra_ids:
            try:
                cid = int(raw)
            except (TypeError, ValueError):
                continue
            if cid > 0 and cid not in ids:
                ids.append(cid)
        if not ids:
            return None, "El envío debe tener al menos una compra"
        with _conn() as con:
            actuales = [
                int(r["id"])
                for r in con.execute(
                    "SELECT id FROM compras_exterior WHERE envio_id = ?",
                    (int(envio_id),),
                ).fetchall()
            ]
            salir = [i for i in actuales if i not in ids]
            if salir:
                con.execute(
                    f"UPDATE compras_exterior SET envio_id=NULL, flete=0 WHERE id IN ({','.join('?' * len(salir))})",
                    salir,
                )
            con.execute(
                f"UPDATE compras_exterior SET envio_id=? WHERE id IN ({','.join('?' * len(ids))})",
                [int(envio_id), *ids],
            )
        for cid in salir:
            _preparar_cuenta_cobro_pendiente(cid)

    if campos:
        with _conn() as con:
            con.execute(
                f"UPDATE compras_exterior_envios SET {', '.join(campos)} WHERE id=?",
                (*vals, int(envio_id)),
            )

    envio = _recalcular_envio(int(envio_id))
    if not envio:
        return None, "No se pudo actualizar el envío"
    return envio, ""


def obtener_envio_compras(envio_id: int) -> dict | None:
    found = _envios_por_ids({int(envio_id)})
    return found.get(int(envio_id))


def eliminar_envio_compras(envio_id: int, *, borrar_si_vacio: bool = True) -> bool:
    from app.services.cuenta_cobro_cuota_manejo import carpeta_pdfs

    _ensure()
    with _conn() as con:
        row = con.execute(
            "SELECT cuenta_flete_path FROM compras_exterior_envios WHERE id = ?",
            (int(envio_id),),
        ).fetchone()
        if not row:
            return False
        prev = (row["cuenta_flete_path"] or "").strip()
        compras = [
            int(r["id"])
            for r in con.execute(
                "SELECT id FROM compras_exterior WHERE envio_id = ?",
                (int(envio_id),),
            ).fetchall()
        ]
        con.execute(
            "UPDATE compras_exterior SET envio_id=NULL WHERE envio_id = ?",
            (int(envio_id),),
        )
        if borrar_si_vacio or True:
            con.execute("DELETE FROM compras_exterior_envios WHERE id = ?", (int(envio_id),))
    if prev:
        try:
            full = prev if os.path.isabs(prev) else os.path.join(carpeta_pdfs(), prev)
            if os.path.isfile(full):
                os.remove(full)
        except OSError:
            pass
    for cid in compras:
        _preparar_cuenta_cobro_pendiente(cid)
    return True


def aprobar_cuenta_flete_envio(
    envio_id: int,
    *,
    accent_rgb: str = "",
    emisor_perfil: dict | None = None,
) -> tuple[dict | None, str]:
    from app.services.cuenta_cobro_cuota_manejo import (
        carpeta_pdfs,
        generar_pdf_cuenta_flete,
        resolver_accent_cuenta_cobro,
    )

    env = obtener_envio_compras(int(envio_id))
    if not env:
        return None, "Envío no encontrado"
    if float(env.get("flete") or 0) <= 0:
        return None, "El envío no tiene flete"

    if emisor_perfil is None:
        from app.services.cuenta_cobro_cuota_manejo import perfil_emisor_por_id

        emisor_perfil = perfil_emisor_por_id(env.get("emisor_usuario_id"))
    emisor_uid, emisor_nom = _resolver_emisor_compra(emisor_perfil=emisor_perfil)
    if emisor_uid is None:
        emisor_uid = env.get("emisor_usuario_id")
        emisor_nom = (env.get("emisor_nombre") or "").strip()

    accent_rgb = resolver_accent_cuenta_cobro(
        accent_rgb, emisor_perfil=emisor_perfil
    )

    ids = env.get("compra_ids") or []
    proveedor = f"Paquete envío · compras {', '.join('#' + str(i) for i in ids)}"
    numero = f"CC-ENV-{int(envio_id):05d}-FLETE"
    filename = f"Cuenta de cobro numero ENV-{int(envio_id):05d} flete paquete compra en el exterior.pdf"
    prev = ""
    with _conn() as con:
        row = con.execute(
            "SELECT cuenta_flete_path FROM compras_exterior_envios WHERE id = ?",
            (int(envio_id),),
        ).fetchone()
        if row:
            prev = (row["cuenta_flete_path"] or "").strip()
    if prev:
        try:
            full_prev = prev if os.path.isabs(prev) else os.path.join(carpeta_pdfs(), prev)
            if os.path.isfile(full_prev):
                os.remove(full_prev)
        except OSError:
            pass

    gen = generar_pdf_cuenta_flete(
        compra_id=int(envio_id),
        moneda="USD" if (env.get("moneda_flete") or "USD").upper() != "COP" else "COP",
        trm=float(env.get("trm") or 0),
        flete=float(env.get("flete") or 0),
        moneda_flete=str(env.get("moneda_flete") or "USD"),
        proveedor=proveedor,
        fecha_compra=str(env.get("fecha_envio") or ""),
        accent_rgb=accent_rgb,
        emisor_perfil=emisor_perfil,
        numero=numero,
        filename=filename,
        etiqueta_fecha="envío",
        compras_ids=ids,
    )
    if gen.get("error") or not gen.get("filename"):
        return obtener_envio_compras(int(envio_id)), str(gen.get("error") or "No se pudo generar el PDF")

    with _conn() as con:
        con.execute(
            """UPDATE compras_exterior_envios SET
                 cuenta_flete_path=?, flete_cobro_cop=?, cuenta_flete_estado=?,
                 emisor_usuario_id=?, emisor_nombre=?
               WHERE id=?""",
            (
                gen.get("filename") or "",
                float(gen.get("flete_cop") or env.get("flete_cobro_cop") or 0),
                "aprobada",
                emisor_uid,
                emisor_nom,
                int(envio_id),
            ),
        )
    return obtener_envio_compras(int(envio_id)), ""


def ruta_cuenta_flete_envio(envio_id: int) -> tuple[str, str] | None:
    from app.services.cuenta_cobro_cuota_manejo import carpeta_pdfs

    env = obtener_envio_compras(int(envio_id))
    if not env or not env.get("tiene_cuenta_flete"):
        _ensure()
        with _conn() as con:
            row = con.execute(
                "SELECT cuenta_flete_path, cuenta_flete_estado FROM compras_exterior_envios WHERE id = ?",
                (int(envio_id),),
            ).fetchone()
        if not row:
            return None
        path = (row["cuenta_flete_path"] or "").strip()
        if not path or (row["cuenta_flete_estado"] or "") != "aprobada":
            return None
    else:
        _ensure()
        with _conn() as con:
            row = con.execute(
                "SELECT cuenta_flete_path FROM compras_exterior_envios WHERE id = ?",
                (int(envio_id),),
            ).fetchone()
        path = (row["cuenta_flete_path"] or "").strip() if row else ""
    if not path:
        return None
    full = path if os.path.isabs(path) else os.path.join(carpeta_pdfs(), path)
    if not os.path.isfile(full):
        return None
    return full, os.path.basename(full)


def _guardar_archivos_soporte(
    soportes: list | None = None,
    soporte_bytes: bytes | None = None,
    soporte_nombre: str = "",
    soporte_mime: str = "",
) -> tuple[str, str, str]:
    """Guarda archivos y devuelve (soporte_path, soporte_nombre, soporte_mime)."""
    import json
    import re
    import uuid

    paths: list[str] = []
    nombres: list[str] = []
    mimes: list[str] = []

    def _uno(raw: bytes, nombre: str, mime: str) -> None:
        if not raw:
            return
        nombre_safe = (nombre or "").strip()
        mime_s = (mime or "").strip()
        low = nombre_safe.lower()
        if mime_s == "application/pdf" or low.endswith(".pdf"):
            ext = ".pdf"
        elif "png" in mime_s or low.endswith(".png"):
            ext = ".png"
        elif "webp" in mime_s or low.endswith(".webp"):
            ext = ".webp"
        elif low.endswith((".jpg", ".jpeg")):
            ext = ".jpg"
        else:
            ext = ".jpg"
        base = re.sub(r"[^\w.\-]+", "_", nombre_safe)[:60] or "soporte"
        # Evitar doble extensión: factura.jpg + .jpg → factura.jpg
        if base.lower().endswith(ext) or (ext == ".jpg" and base.lower().endswith(".jpeg")):
            stem = base
        else:
            stem = f"{base}{ext}"
        fname = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}_{stem}"
        full = os.path.join(_soportes_dir(), fname)
        try:
            with open(full, "wb") as f:
                f.write(raw)
        except PermissionError as e:
            raise PermissionError(
                f"Sin permiso para guardar soporte en {_soportes_dir()}: {e}. "
                "Ajusta dueño/permisos del directorio (usuario del servicio agente-pro)."
            ) from e
        paths.append(fname)
        nombres.append(nombre_safe or fname)
        mimes.append(mime_s or "application/octet-stream")

    if soportes:
        for s in soportes:
            if not isinstance(s, dict):
                continue
            _uno(s.get("bytes") or b"", str(s.get("nombre") or ""), str(s.get("mime") or ""))
    elif soporte_bytes:
        _uno(soporte_bytes, soporte_nombre, soporte_mime)

    if not paths:
        return "", (soporte_nombre or "").strip(), (soporte_mime or "").strip()
    if len(paths) == 1:
        return paths[0], nombres[0], mimes[0]
    return json.dumps(paths, ensure_ascii=False), f"{len(paths)} archivos", "application/json"


def guardar_borrador_compra_exterior(
    *,
    borrador_id: int | None = None,
    titulo: str = "",
    moneda: str = "USD",
    trm: float = 0.0,
    trm_fuente: str = "",
    fecha_compra: str = "",
    flete: float = 0.0,
    moneda_flete: str = "",
    descuento_pedido: float = 0.0,
    descuento_pct: float = 0.0,
    proveedor: str = "",
    notas: str = "",
    estado: dict | None = None,
    soportes: list | None = None,
    append_soportes: bool = True,
) -> dict:
    """Crea o actualiza un borrador de compra exterior para retomar después."""
    import json

    _ensure()
    now = datetime.now().isoformat()
    estado = estado if isinstance(estado, dict) else {}
    lineas = estado.get("lineas") if isinstance(estado.get("lineas"), list) else []
    if not titulo:
        if proveedor:
            titulo = f"Borrador {proveedor}"
        elif lineas:
            titulo = str(lineas[0].get("nombre") or "Borrador")[:80]
        else:
            titulo = f"Borrador {now[:16]}"

    nuevo_path, nuevo_nombre, nuevo_mime = _guardar_archivos_soporte(soportes=soportes)

    with _conn() as con:
        row_prev = None
        if borrador_id:
            row_prev = con.execute(
                "SELECT * FROM compras_exterior_borradores WHERE id = ?",
                (int(borrador_id),),
            ).fetchone()
            if not row_prev:
                borrador_id = None

        if borrador_id and row_prev:
            soporte_path = row_prev["soporte_path"] or ""
            soporte_nombre = row_prev["soporte_nombre"] or ""
            soporte_mime = row_prev["soporte_mime"] or ""
            if nuevo_path:
                if append_soportes and soporte_path:
                    prev = _parse_soporte_paths(soporte_path)
                    add = _parse_soporte_paths(nuevo_path)
                    merged = prev + add
                    soporte_path = (
                        merged[0]
                        if len(merged) == 1
                        else json.dumps(merged, ensure_ascii=False)
                    )
                    soporte_nombre = (
                        merged[0] if len(merged) == 1 else f"{len(merged)} archivos"
                    )
                    soporte_mime = "application/json" if len(merged) > 1 else nuevo_mime
                else:
                    # Reemplazar: borrar archivos previos del borrador
                    for p in _parse_soporte_paths(soporte_path):
                        full = os.path.join(_soportes_dir(), p)
                        try:
                            if os.path.isfile(full):
                                os.remove(full)
                        except OSError:
                            pass
                    soporte_path, soporte_nombre, soporte_mime = nuevo_path, nuevo_nombre, nuevo_mime

            con.execute(
                """UPDATE compras_exterior_borradores SET
                     updated_at=?, titulo=?, moneda=?, trm=?, trm_fuente=?, fecha_compra=?,
                     flete=?, moneda_flete=?, descuento_pedido=?, descuento_pct=?,
                     proveedor=?, notas=?, estado_json=?, soporte_path=?, soporte_nombre=?, soporte_mime=?
                   WHERE id=?""",
                (
                    now,
                    (titulo or "").strip()[:120],
                    (moneda or "USD").strip().upper(),
                    float(trm or 0),
                    (trm_fuente or "").strip()[:40],
                    (fecha_compra or "").strip()[:10],
                    float(flete or 0),
                    (moneda_flete or "").strip().upper(),
                    float(descuento_pedido or 0),
                    float(descuento_pct or 0),
                    (proveedor or "").strip(),
                    (notas or "").strip(),
                    json.dumps(estado, ensure_ascii=False),
                    soporte_path,
                    soporte_nombre,
                    soporte_mime,
                    int(borrador_id),
                ),
            )
            rid = int(borrador_id)
        else:
            cur = con.execute(
                """INSERT INTO compras_exterior_borradores
                     (created_at, updated_at, titulo, moneda, trm, trm_fuente, fecha_compra,
                      flete, moneda_flete, descuento_pedido, descuento_pct, proveedor, notas,
                      estado_json, soporte_path, soporte_nombre, soporte_mime)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    now,
                    now,
                    (titulo or "").strip()[:120],
                    (moneda or "USD").strip().upper(),
                    float(trm or 0),
                    (trm_fuente or "").strip()[:40],
                    (fecha_compra or "").strip()[:10],
                    float(flete or 0),
                    (moneda_flete or "").strip().upper(),
                    float(descuento_pedido or 0),
                    float(descuento_pct or 0),
                    (proveedor or "").strip(),
                    (notas or "").strip(),
                    json.dumps(estado, ensure_ascii=False),
                    nuevo_path,
                    nuevo_nombre,
                    nuevo_mime,
                ),
            )
            rid = int(cur.lastrowid)

        row = con.execute(
            "SELECT * FROM compras_exterior_borradores WHERE id = ?", (rid,)
        ).fetchone()
    return _borrador_compra_row(dict(row))


def listar_borradores_compra_exterior(limit: int = 50) -> list[dict]:
    _ensure()
    limit = max(1, min(int(limit or 50), 200))
    with _conn() as con:
        rows = con.execute(
            "SELECT * FROM compras_exterior_borradores ORDER BY updated_at DESC, id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [_borrador_compra_row(dict(r)) for r in rows]


def obtener_borrador_compra_exterior(borrador_id: int) -> dict | None:
    _ensure()
    with _conn() as con:
        row = con.execute(
            "SELECT * FROM compras_exterior_borradores WHERE id = ?",
            (int(borrador_id),),
        ).fetchone()
    if not row:
        return None
    return _borrador_compra_row(dict(row))


def eliminar_borrador_compra_exterior(borrador_id: int, *, borrar_archivos: bool = True) -> bool:
    _ensure()
    with _conn() as con:
        row = con.execute(
            "SELECT soporte_path FROM compras_exterior_borradores WHERE id = ?",
            (int(borrador_id),),
        ).fetchone()
        if not row:
            return False
        if borrar_archivos:
            for p in _parse_soporte_paths(row["soporte_path"]):
                full = os.path.join(_soportes_dir(), p)
                try:
                    if os.path.isfile(full):
                        os.remove(full)
                except OSError:
                    pass
        con.execute(
            "DELETE FROM compras_exterior_borradores WHERE id = ?", (int(borrador_id),)
        )
    return True


def rutas_soporte_borrador(borrador_id: int) -> list[str]:
    """Nombres de archivo de soporte del borrador (relativos)."""
    _ensure()
    with _conn() as con:
        row = con.execute(
            "SELECT soporte_path FROM compras_exterior_borradores WHERE id = ?",
            (int(borrador_id),),
        ).fetchone()
    if not row:
        return []
    return _parse_soporte_paths(row["soporte_path"])


def ruta_soporte_borrador_compra(
    borrador_id: int, index: int = 0
) -> tuple[str | None, str, str]:
    _ensure()
    with _conn() as con:
        row = con.execute(
            "SELECT soporte_path, soporte_mime, soporte_nombre FROM compras_exterior_borradores WHERE id = ?",
            (int(borrador_id),),
        ).fetchone()
    if not row or not row["soporte_path"]:
        return None, "", ""
    paths = _parse_soporte_paths(row["soporte_path"])
    if not paths:
        return None, "", ""
    idx = max(0, min(int(index or 0), len(paths) - 1))
    fname = paths[idx]
    full = os.path.join(_soportes_dir(), fname)
    if not os.path.isfile(full):
        return None, "", ""
    mime = "application/octet-stream"
    low = fname.lower()
    if low.endswith(".pdf"):
        mime = "application/pdf"
    elif low.endswith(".png"):
        mime = "image/png"
    elif low.endswith(".webp"):
        mime = "image/webp"
    elif low.endswith((".jpg", ".jpeg")):
        mime = "image/jpeg"
    return full, mime, fname


def soportes_desde_borrador(
    borrador_id: int, indices: list[int] | None = None
) -> list[dict]:
    """Lee bytes de soportes del borrador para confirmar compra.

    Si `indices` se pasa, solo incluye esos índices en ese orden.
    """
    paths = rutas_soporte_borrador(borrador_id)
    if indices is not None:
        ordered: list[str] = []
        for i in indices:
            try:
                ii = int(i)
            except (TypeError, ValueError):
                continue
            if 0 <= ii < len(paths):
                ordered.append(paths[ii])
        paths = ordered
    out = []
    for fname in paths:
        full = os.path.join(_soportes_dir(), fname)
        if not os.path.isfile(full):
            continue
        with open(full, "rb") as f:
            data = f.read()
        mime = "application/octet-stream"
        low = fname.lower()
        if low.endswith(".pdf"):
            mime = "application/pdf"
        elif low.endswith(".png"):
            mime = "image/png"
        elif low.endswith(".webp"):
            mime = "image/webp"
        elif low.endswith((".jpg", ".jpeg")):
            mime = "image/jpeg"
        out.append({"bytes": data, "nombre": fname, "mime": mime})
    return out


def actualizar_soportes_borrador(
    borrador_id: int, indices: list[int]
) -> dict | None:
    """Reordena/elimina soportes del borrador según índices (orden final)."""
    import json

    _ensure()
    with _conn() as con:
        row = con.execute(
            "SELECT * FROM compras_exterior_borradores WHERE id = ?",
            (int(borrador_id),),
        ).fetchone()
        if not row:
            return None
        prev = _parse_soporte_paths(row["soporte_path"])
        kept: list[str] = []
        seen: set[int] = set()
        for i in indices:
            try:
                ii = int(i)
            except (TypeError, ValueError):
                continue
            if ii in seen or ii < 0 or ii >= len(prev):
                continue
            seen.add(ii)
            kept.append(prev[ii])
        for j, fname in enumerate(prev):
            if j in seen:
                continue
            full = os.path.join(_soportes_dir(), fname)
            try:
                if os.path.isfile(full):
                    os.remove(full)
            except OSError:
                pass
        if not kept:
            soporte_path, soporte_nombre, soporte_mime = "", "", ""
        elif len(kept) == 1:
            soporte_path, soporte_nombre, soporte_mime = kept[0], kept[0], row["soporte_mime"] or ""
            if soporte_mime == "application/json":
                low = kept[0].lower()
                if low.endswith(".pdf"):
                    soporte_mime = "application/pdf"
                elif low.endswith(".png"):
                    soporte_mime = "image/png"
                elif low.endswith(".webp"):
                    soporte_mime = "image/webp"
                else:
                    soporte_mime = "image/jpeg"
        else:
            soporte_path = json.dumps(kept, ensure_ascii=False)
            soporte_nombre = f"{len(kept)} archivos"
            soporte_mime = "application/json"
        con.execute(
            """UPDATE compras_exterior_borradores SET
                 updated_at=?, soporte_path=?, soporte_nombre=?, soporte_mime=?
               WHERE id=?""",
            (datetime.now().isoformat(), soporte_path, soporte_nombre, soporte_mime, int(borrador_id)),
        )
        row2 = con.execute(
            "SELECT * FROM compras_exterior_borradores WHERE id = ?",
            (int(borrador_id),),
        ).fetchone()
    return _borrador_compra_row(dict(row2)) if row2 else None


def _borrador_compra_row(d: dict) -> dict:
    import json

    paths = _parse_soporte_paths(d.get("soporte_path"))
    bid = d.get("id")
    try:
        estado = json.loads(d.get("estado_json") or "{}")
    except Exception:
        estado = {}
    if not isinstance(estado, dict):
        estado = {}
    lineas = estado.get("lineas") if isinstance(estado.get("lineas"), list) else []
    return {
        "id": bid,
        "created_at": d.get("created_at"),
        "updated_at": d.get("updated_at"),
        "titulo": d.get("titulo") or "",
        "moneda": d.get("moneda"),
        "trm": d.get("trm"),
        "trm_fuente": d.get("trm_fuente") or "",
        "fecha_compra": d.get("fecha_compra") or "",
        "flete": d.get("flete"),
        "moneda_flete": d.get("moneda_flete") or "",
        "descuento_pedido": d.get("descuento_pedido") or 0,
        "descuento_pct": d.get("descuento_pct") or 0,
        "proveedor": d.get("proveedor") or "",
        "notas": d.get("notas") or "",
        "estado": estado,
        "lineas": lineas,
        "lineas_count": len(lineas),
        "tiene_soporte": bool(paths),
        "soportes_count": len(paths),
        "soporte_nombre": d.get("soporte_nombre") or "",
        "soporte_url": f"/api/rentabilidad/compras-exterior/borrador/{bid}/soporte"
        if paths
        else None,
        "soporte_urls": [
            f"/api/rentabilidad/compras-exterior/borrador/{bid}/soporte?i={i}"
            for i in range(len(paths))
        ]
        if paths
        else [],
    }
