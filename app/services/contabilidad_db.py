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


# ─── Compras exterior (historial + soporte) ───────────────────────────────────

_SOPORTES_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "compras_exterior_soportes")


def _soportes_dir() -> str:
    path = os.path.abspath(_SOPORTES_DIR)
    os.makedirs(path, exist_ok=True)
    return path


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

    with _conn() as con:
        cur = con.execute(
            """INSERT INTO compras_exterior
                 (created_at, moneda, trm, flete, moneda_flete, proveedor,
                  soporte_path, soporte_nombre, soporte_mime, lineas_json,
                  total_guardados, notas, fecha_compra, trm_fuente)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
            ),
        )
        row = con.execute(
            "SELECT * FROM compras_exterior WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
    return _compra_exterior_row(dict(row))


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
    for r in rows:
        d = dict(r)
        try:
            d["lineas"] = json.loads(d.get("lineas_json") or "[]")
        except Exception:
            d["lineas"] = []
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
    return _compra_exterior_row(d)


def eliminar_compra_exterior(compra_id: int, *, borrar_archivos: bool = True) -> bool:
    """Elimina un registro del historial de compras exterior y sus soportes."""
    _ensure()
    with _conn() as con:
        row = con.execute(
            "SELECT soporte_path FROM compras_exterior WHERE id = ?",
            (int(compra_id),),
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
        con.execute("DELETE FROM compras_exterior WHERE id = ?", (int(compra_id),))
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

        con.execute(
            """UPDATE compras_exterior SET
                 moneda=?, trm=?, flete=?, moneda_flete=?, proveedor=?,
                 soporte_path=?, soporte_nombre=?, soporte_mime=?,
                 lineas_json=?, total_guardados=?, notas=?, fecha_compra=?, trm_fuente=?
               WHERE id=?""",
            (
                (moneda or "USD").strip().upper(),
                float(trm or 0),
                float(flete or 0),
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
                int(compra_id),
            ),
        )
    return obtener_compra_exterior(compra_id)


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
    return {
        "id": cid,
        "created_at": d.get("created_at"),
        "moneda": d.get("moneda"),
        "trm": d.get("trm"),
        "trm_fuente": d.get("trm_fuente") or "",
        "fecha_compra": d.get("fecha_compra") or "",
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
    }


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
