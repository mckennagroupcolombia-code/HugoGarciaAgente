import os
import sqlite3
import secrets
from datetime import datetime, timedelta
from werkzeug.security import generate_password_hash, check_password_hash

_HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_HERE, "..", "data", "tickets.db")
UPLOADS_DIR = os.path.join(_HERE, "..", "..", "uploads", "tickets")


def _conn():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
    return c


def _add_col(db, table: str, col: str, defn: str):
    existing = {r[1] for r in db.execute(f"PRAGMA table_info({table})").fetchall()}
    if col not in existing:
        db.execute(f"ALTER TABLE {table} ADD COLUMN {col} {defn}")


def _recreate_table(db, name: str, create_sql: str, columns: str = "*"):
    """Helper: CREATE new → INSERT data → DROP old → RENAME new → old name.
    Using DROP (not RENAME) on the original preserves FK references in child tables,
    since SQLite 3.26+ updates FK references when RENAME is used but not when DROP is used.
    """
    db.execute(create_sql)
    db.execute(f"INSERT INTO {name}_new SELECT {columns} FROM {name}")
    db.execute(f"DROP TABLE {name}")
    db.execute(f"ALTER TABLE {name}_new RENAME TO {name}")


def _migrate_categorias():
    """
    One-time migration: creates the categorias table and removes the hard-coded
    CHECK constraint on `categoria` in both `tickets` and `misiones`.
    Uses DROP (not RENAME) on the original tables so child-table FK references
    keep pointing to the original name and remain valid after recreation.
    Idempotent — skips if `categorias` already exists.
    """
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    try:
        tables = {r["name"] for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()}
        if "categorias" in tables:
            return

        db.execute("PRAGMA foreign_keys=OFF")
        db.execute("BEGIN EXCLUSIVE")

        db.execute("""
            CREATE TABLE categorias (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                slug      TEXT NOT NULL UNIQUE,
                nombre    TEXT NOT NULL,
                color     TEXT DEFAULT '#0c6069',
                icono     TEXT DEFAULT '📋',
                activo    INTEGER DEFAULT 1,
                creado_en TEXT DEFAULT (datetime('now'))
            )
        """)
        for slug, nombre, color, icono in [
            ("rrhh",          "Recursos Humanos", "#e8a838", "👥"),
            ("logistica",     "Logística",        "#4a9a6a", "🚚"),
            ("mantenimiento", "Mantenimiento",    "#a68bc8", "🔧"),
        ]:
            db.execute(
                "INSERT INTO categorias (slug, nombre, color, icono) VALUES (?,?,?,?)",
                (slug, nombre, color, icono),
            )

        _recreate_table(db, "misiones", """
            CREATE TABLE misiones_new (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                titulo              TEXT NOT NULL,
                descripcion         TEXT,
                reino               TEXT,
                color               TEXT DEFAULT '#0c6069',
                tipo                TEXT NOT NULL DEFAULT 'secuencial'
                                        CHECK(tipo IN ('secuencial','paralelo')),
                categoria           TEXT DEFAULT 'logistica',
                estado              TEXT NOT NULL DEFAULT 'activa'
                                        CHECK(estado IN ('borrador','activa','completada','cancelada')),
                total_etapas        INTEGER DEFAULT 0,
                etapas_completadas  INTEGER DEFAULT 0,
                creado_por          INTEGER REFERENCES usuarios(id),
                creado_en           TEXT DEFAULT (datetime('now')),
                completada_en       TEXT
            )
        """)

        _recreate_table(db, "tickets", """
            CREATE TABLE tickets_new (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                numero          TEXT NOT NULL UNIQUE,
                titulo          TEXT NOT NULL,
                categoria       TEXT NOT NULL DEFAULT 'logistica',
                descripcion     TEXT NOT NULL,
                estado          TEXT NOT NULL DEFAULT 'pendiente'
                                    CHECK(estado IN ('pendiente','en_proceso','esperando_aprobacion','resuelto','rechazado')),
                prioridad       TEXT DEFAULT 'media'
                                    CHECK(prioridad IN ('baja','media','alta','urgente')),
                creado_por      INTEGER NOT NULL REFERENCES usuarios(id),
                asignado_a      INTEGER REFERENCES usuarios(id),
                soporte_archivo TEXT,
                creado_en       TEXT DEFAULT (datetime('now')),
                actualizado_en  TEXT DEFAULT (datetime('now')),
                resuelto_en     TEXT,
                mision_id       INTEGER REFERENCES misiones(id),
                etapa_id        INTEGER REFERENCES etapas_mision(id),
                bloqueado_por   INTEGER REFERENCES tickets(id)
            )
        """)

        db.execute("COMMIT")
    except Exception as exc:
        try:
            db.execute("ROLLBACK")
        except Exception:
            pass
        raise RuntimeError(f"_migrate_categorias failed: {exc}") from exc
    finally:
        db.close()


def _repair_broken_fk():
    """
    Repairs the broken FK references left by the first (buggy) version of
    _migrate_categorias, which used RENAME on original tables causing SQLite
    3.26+ to rewrite child-table FK refs to point to the now-dropped _old tables.
    Idempotent — skips if child tables already reference 'tickets' correctly.
    """
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    try:
        row = db.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='ticket_participantes'"
        ).fetchone()
        if not row or "tickets_old" not in (row["sql"] or ""):
            return  # Not broken or already fixed

        db.execute("PRAGMA foreign_keys=OFF")
        db.execute("BEGIN EXCLUSIVE")

        # Rebuild etapas_mision (references misiones_old + tickets_old)
        _recreate_table(db, "etapas_mision", """
            CREATE TABLE etapas_mision_new (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                mision_id  INTEGER NOT NULL REFERENCES misiones(id) ON DELETE CASCADE,
                orden      INTEGER NOT NULL,
                titulo     TEXT NOT NULL,
                descripcion TEXT,
                ticket_id  INTEGER REFERENCES tickets(id),
                estado     TEXT DEFAULT 'pendiente'
                               CHECK(estado IN ('pendiente','activa','completada')),
                creado_en  TEXT DEFAULT (datetime('now'))
            )
        """)

        # Rebuild ticket_participantes
        _recreate_table(db, "ticket_participantes", """
            CREATE TABLE ticket_participantes_new (
                ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
                usuario_id  INTEGER NOT NULL REFERENCES usuarios(id),
                rol         TEXT DEFAULT 'colaborador'
                                CHECK(rol IN ('colaborador','revisor','observador')),
                agregado_en TEXT DEFAULT (datetime('now')),
                PRIMARY KEY (ticket_id, usuario_id)
            )
        """)

        # Rebuild comentarios_tickets
        _recreate_table(db, "comentarios_tickets", """
            CREATE TABLE comentarios_tickets_new (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
                usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
                texto      TEXT NOT NULL,
                es_interno INTEGER DEFAULT 0,
                creado_en  TEXT DEFAULT (datetime('now'))
            )
        """)

        # Rebuild bitacora_tiempo
        _recreate_table(db, "bitacora_tiempo", """
            CREATE TABLE bitacora_tiempo_new (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
                usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
                horas      REAL NOT NULL,
                notas      TEXT,
                creado_en  TEXT DEFAULT (datetime('now'))
            )
        """)

        # Rebuild logs_auditoria
        _recreate_table(db, "logs_auditoria", """
            CREATE TABLE logs_auditoria_new (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id       INTEGER NOT NULL REFERENCES tickets(id),
                usuario_id      INTEGER REFERENCES usuarios(id),
                accion          TEXT NOT NULL,
                valor_anterior  TEXT,
                valor_nuevo     TEXT,
                detalles        TEXT,
                creado_en       TEXT DEFAULT (datetime('now'))
            )
        """)

        db.execute("COMMIT")
        print("✅ FK repair migration applied")
    except Exception as exc:
        try:
            db.execute("ROLLBACK")
        except Exception:
            pass
        raise RuntimeError(f"_repair_broken_fk failed: {exc}") from exc
    finally:
        db.close()


MATERIAL_TIPOS_VALIDOS = frozenset({
    "materia_prima", "elaborado", "consumibles", "repuestos", "herramientas",
})

_TIPO_MATERIAL_ALIASES = {
    "insumos": "consumibles",
    "insumo": "consumibles",
    "consumible": "consumibles",
    "repuesto": "repuestos",
}


def _normalizar_tipo_material(tipo: str | None) -> str:
    t = (tipo or "materia_prima").strip().lower()
    return _TIPO_MATERIAL_ALIASES.get(t, t)


def _migrate_materiales_tipo():
    """Amplía CHECK de tipo en materiales_catalogo (consumibles, repuestos, herramientas)."""
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    try:
        row = db.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='materiales_catalogo'"
        ).fetchone()
        if not row:
            return
        sql = row["sql"] or ""
        if "'consumibles'" in sql and "'repuestos'" in sql:
            return

        db.execute("PRAGMA foreign_keys=OFF")
        db.execute("BEGIN EXCLUSIVE")
        db.execute("""
            CREATE TABLE materiales_catalogo_new (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre           TEXT NOT NULL UNIQUE,
                descripcion      TEXT,
                unidad           TEXT NOT NULL DEFAULT 'unidad',
                stock_actual     REAL DEFAULT 0,
                stock_minimo     REAL DEFAULT 0,
                precio_unitario  REAL DEFAULT 0,
                proveedor        TEXT,
                activo           INTEGER DEFAULT 1,
                creado_en        TEXT DEFAULT (datetime('now')),
                actualizado_en   TEXT DEFAULT (datetime('now')),
                tipo             TEXT DEFAULT 'materia_prima'
                    CHECK(tipo IN ('materia_prima','elaborado','consumibles','repuestos','herramientas')),
                mision_origen_id INTEGER REFERENCES misiones(id)
            )
        """)
        db.execute("""
            INSERT INTO materiales_catalogo_new (
                id, nombre, descripcion, unidad, stock_actual, stock_minimo,
                precio_unitario, proveedor, activo, creado_en, actualizado_en,
                tipo, mision_origen_id
            )
            SELECT
                id, nombre, descripcion, unidad, stock_actual, stock_minimo,
                precio_unitario, proveedor, activo, creado_en, actualizado_en,
                CASE tipo
                    WHEN 'insumos' THEN 'consumibles'
                    ELSE tipo
                END,
                mision_origen_id
            FROM materiales_catalogo
        """)
        db.execute("DROP TABLE materiales_catalogo")
        db.execute("ALTER TABLE materiales_catalogo_new RENAME TO materiales_catalogo")
        db.execute("COMMIT")
    except Exception as exc:
        try:
            db.execute("ROLLBACK")
        except Exception:
            pass
        raise RuntimeError(f"_migrate_materiales_tipo failed: {exc}") from exc
    finally:
        db.close()


def _migrate_zonas_subareas():
    """parent_id en zonas; quita UNIQUE global en nombre (permite subáreas con mismo nombre en otra zona)."""
    db_path = os.path.join(os.path.dirname(__file__), "..", "data", "tickets.db")
    if not os.path.isfile(db_path):
        return
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    try:
        if not db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='zonas_trabajo'"
        ).fetchone():
            return
        sql_row = db.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='zonas_trabajo'"
        ).fetchone()
        sql = (sql_row[0] or "") if sql_row else ""
        if "parent_id" in sql and "nombre TEXT NOT NULL UNIQUE" not in sql:
            return
        db.execute("PRAGMA foreign_keys=OFF")
        db.execute("BEGIN EXCLUSIVE")
        db.execute("""
            CREATE TABLE zonas_trabajo_new (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre      TEXT NOT NULL,
                parent_id   INTEGER REFERENCES zonas_trabajo(id),
                descripcion TEXT,
                color       TEXT DEFAULT '#4a9a6a',
                icono       TEXT DEFAULT '🏭',
                orden       INTEGER DEFAULT 0,
                activo      INTEGER DEFAULT 1,
                creado_en   TEXT DEFAULT (datetime('now'))
            )
        """)
        db.execute("""
            INSERT INTO zonas_trabajo_new
                (id, nombre, parent_id, descripcion, color, icono, orden, activo, creado_en)
            SELECT id, nombre, NULL, descripcion, color, icono, orden, activo, creado_en
            FROM zonas_trabajo
        """)
        db.execute("DROP TABLE zonas_trabajo")
        db.execute("ALTER TABLE zonas_trabajo_new RENAME TO zonas_trabajo")
        db.commit()
    except Exception as exc:
        try:
            db.rollback()
        except Exception:
            pass
        raise RuntimeError(f"_migrate_zonas_subareas failed: {exc}") from exc
    finally:
        db.close()


def _migrate_mision_zona_id():
    """Vincula misiones a zonas_trabajo (reino / zona / subzona) vía zona_id."""
    db_path = os.path.join(os.path.dirname(__file__), "..", "data", "tickets.db")
    if not os.path.isfile(db_path):
        return
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    try:
        cols = [r[1] for r in db.execute("PRAGMA table_info(misiones)").fetchall()]
        if "zona_id" not in cols:
            db.execute(
                "ALTER TABLE misiones ADD COLUMN zona_id INTEGER REFERENCES zonas_trabajo(id)"
            )
            db.commit()
        pend = db.execute("""
            SELECT id, reino FROM misiones
            WHERE (zona_id IS NULL OR zona_id = 0)
              AND reino IS NOT NULL AND TRIM(reino) != ''
        """).fetchall()
        for m in pend:
            r = db.execute(
                """SELECT id FROM zonas_trabajo
                   WHERE activo=1 AND parent_id IS NULL
                     AND LOWER(TRIM(nombre)) = LOWER(TRIM(?))""",
                (m["reino"],),
            ).fetchone()
            if r:
                db.execute("UPDATE misiones SET zona_id=? WHERE id=?", (r["id"], m["id"]))
        db.commit()
    except Exception as exc:
        try:
            db.rollback()
        except Exception:
            pass
        raise RuntimeError(f"_migrate_mision_zona_id failed: {exc}") from exc
    finally:
        db.close()


def _zona_profundidad_arbol(db, zona_id: int) -> int:
    """Profundidad por parent_id: 0=reino, 1=zona, 2=subzona o depto directo, 3=depto bajo subzona."""
    row = db.execute(
        "SELECT parent_id FROM zonas_trabajo WHERE id=? AND activo=1", (zona_id,)
    ).fetchone()
    if not row:
        return -1
    n = 0
    pid = row["parent_id"]
    while pid is not None and n < 8:
        n += 1
        pr = db.execute(
            "SELECT parent_id FROM zonas_trabajo WHERE id=?", (pid,)
        ).fetchone()
        if not pr:
            return -1
        pid = pr["parent_id"]
    return n


def _inferir_tipo_zona(db, zona_id: int) -> str:
    depth = _zona_profundidad_arbol(db, zona_id)
    if depth == 0:
        return "reino"
    if depth == 1:
        return "zona"
    if depth == 2:
        hijo = db.execute(
            "SELECT 1 FROM zonas_trabajo WHERE parent_id=? AND activo=1 LIMIT 1",
            (zona_id,),
        ).fetchone()
        return "subzona" if hijo else "departamento"
    return "departamento"


def _zona_tipo(db, zona_id: int) -> str:
    row = db.execute(
        "SELECT tipo FROM zonas_trabajo WHERE id=? AND activo=1", (zona_id,)
    ).fetchone()
    if not row:
        return ""
    t = (row["tipo"] or "").strip().lower()
    if t in ("reino", "zona", "subzona", "departamento"):
        return t
    return _inferir_tipo_zona(db, zona_id)


def _migrate_zonas_tipo():
    """Columna tipo explícita: evita confundir subzona con departamento directo bajo zona."""
    with _conn() as db:
        _add_col(db, "zonas_trabajo", "tipo", "TEXT")
        rows = db.execute(
            "SELECT id FROM zonas_trabajo WHERE tipo IS NULL OR TRIM(tipo)=''"
        ).fetchall()
        for row in rows:
            db.execute(
                "UPDATE zonas_trabajo SET tipo=? WHERE id=?",
                (_inferir_tipo_zona(db, row["id"]), row["id"]),
            )
        db.commit()


def _migrate_dependencias_prerequisitos():
    """Amplía prerequisitos: misiones + recetas (tipo + referencia_id)."""
    if not os.path.isfile(DB_PATH):
        return
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    try:
        if not db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='dependencias_misiones'"
        ).fetchone():
            return
        row = db.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='dependencias_misiones'"
        ).fetchone()
        sql = (row["sql"] or "") if row else ""
        if "referencia_id" in sql and "tipo" in sql:
            return

        db.execute("PRAGMA foreign_keys=OFF")
        db.execute("BEGIN EXCLUSIVE")
        db.execute("""
            CREATE TABLE dependencias_misiones_new (
                mision_id       INTEGER NOT NULL REFERENCES misiones(id) ON DELETE CASCADE,
                tipo            TEXT NOT NULL DEFAULT 'mision'
                                    CHECK(tipo IN ('mision','receta')),
                referencia_id   INTEGER NOT NULL,
                PRIMARY KEY (mision_id, tipo, referencia_id)
            )
        """)
        db.execute("""
            INSERT INTO dependencias_misiones_new (mision_id, tipo, referencia_id)
            SELECT mision_id, 'mision', depende_de_id FROM dependencias_misiones
        """)
        db.execute("DROP TABLE dependencias_misiones")
        db.execute("ALTER TABLE dependencias_misiones_new RENAME TO dependencias_misiones")
        db.execute("COMMIT")
    except Exception as exc:
        try:
            db.execute("ROLLBACK")
        except Exception:
            pass
        raise RuntimeError(f"_migrate_dependencias_prerequisitos failed: {exc}") from exc
    finally:
        db.close()


def _fetch_dependencias_mision(db, mision_id: int) -> list:
    """Prerequisitos unificados: misión (estado real) o receta (elaboración finalizada)."""
    out = []
    for row in db.execute("""
        SELECT dm.tipo, dm.referencia_id AS id, m.titulo, m.estado, m.reino
        FROM dependencias_misiones dm
        JOIN misiones m ON m.id = dm.referencia_id
        WHERE dm.mision_id = ? AND dm.tipo = 'mision'
        ORDER BY m.titulo
    """, (mision_id,)):
        d = dict(row)
        d["tipo"] = "mision"
        out.append(d)
    for row in db.execute("""
        SELECT dm.tipo, dm.referencia_id AS id, r.titulo,
               CASE WHEN EXISTS (
                   SELECT 1 FROM receta_corridas rc
                   WHERE rc.receta_id = r.id AND rc.estado = 'finalizada'
               ) THEN 'completada' ELSE 'pendiente' END AS estado,
               NULL AS reino,
               r.categoria
        FROM dependencias_misiones dm
        JOIN recetas_ops r ON r.id = dm.referencia_id AND r.activo = 1
        WHERE dm.mision_id = ? AND dm.tipo = 'receta'
        ORDER BY r.titulo
    """, (mision_id,)):
        d = dict(row)
        d["tipo"] = "receta"
        out.append(d)
    out.sort(key=lambda x: (0 if x.get("tipo") == "mision" else 1, (x.get("titulo") or "").lower()))
    return out


def _migrate_mision_frecuencia():
    """Amplía CHECK de frecuencia (cada_2_dias, cada_3_dias)."""
    if not os.path.isfile(DB_PATH):
        return
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    try:
        if not db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='misiones'"
        ).fetchone():
            return
        if "frecuencia" not in {
            r[1] for r in db.execute("PRAGMA table_info(misiones)").fetchall()
        }:
            return
        row = db.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='misiones'"
        ).fetchone()
        sql = (row["sql"] or "") if row else ""
        if "'cada_2_dias'" in sql:
            return

        db.execute("PRAGMA foreign_keys=OFF")
        db.execute("BEGIN EXCLUSIVE")
        db.execute("""
            CREATE TABLE misiones_new (
                id                     INTEGER PRIMARY KEY AUTOINCREMENT,
                titulo                 TEXT NOT NULL,
                descripcion            TEXT,
                reino                  TEXT,
                zona_id                INTEGER REFERENCES zonas_trabajo(id),
                color                  TEXT DEFAULT '#0c6069',
                tipo                   TEXT NOT NULL DEFAULT 'secuencial'
                                           CHECK(tipo IN ('secuencial','paralelo')),
                categoria              TEXT DEFAULT 'logistica',
                estado                 TEXT NOT NULL DEFAULT 'activa'
                                           CHECK(estado IN ('borrador','activa','completada','cancelada')),
                total_etapas           INTEGER DEFAULT 0,
                etapas_completadas     INTEGER DEFAULT 0,
                creado_por             INTEGER REFERENCES usuarios(id),
                creado_en              TEXT DEFAULT (datetime('now')),
                completada_en          TEXT,
                frecuencia             TEXT CHECK(frecuencia IN (
                    'diaria','cada_2_dias','cada_3_dias',
                    'semanal','quincenal','mensual','bimestral','trimestral','semestral'
                )),
                proxima_renovacion     TEXT,
                producto_resultante_id INTEGER REFERENCES materiales_catalogo(id)
            )
        """)
        db.execute("""
            INSERT INTO misiones_new (
                id, titulo, descripcion, reino, zona_id, color, tipo, categoria, estado,
                total_etapas, etapas_completadas, creado_por, creado_en, completada_en,
                frecuencia, proxima_renovacion, producto_resultante_id
            )
            SELECT
                id, titulo, descripcion, reino, zona_id, color, tipo, categoria, estado,
                total_etapas, etapas_completadas, creado_por, creado_en, completada_en,
                frecuencia, proxima_renovacion, producto_resultante_id
            FROM misiones
        """)
        db.execute("DROP TABLE misiones")
        db.execute("ALTER TABLE misiones_new RENAME TO misiones")
        db.execute("COMMIT")
    except Exception as exc:
        try:
            db.execute("ROLLBACK")
        except Exception:
            pass
        raise RuntimeError(f"_migrate_mision_frecuencia failed: {exc}") from exc
    finally:
        db.close()


def _migrate_mision_modo_ciclo():
    """modo_ciclo: finita (un ciclo) | infinita (se repite)."""
    with _conn() as db:
        _add_col(db, "misiones", "modo_ciclo", "TEXT NOT NULL DEFAULT 'finita'")
        db.execute("""
            UPDATE misiones SET modo_ciclo='infinita'
            WHERE (frecuencia IS NOT NULL AND TRIM(frecuencia) != '')
               OR id IN (
                   SELECT DISTINCT mision_id FROM tickets
                   WHERE mision_id IS NOT NULL
                     AND frecuencia IS NOT NULL AND TRIM(frecuencia) != ''
               )
        """)
        db.commit()


def _normalizar_modo_ciclo(raw) -> str:
    v = (raw or "finita").strip().lower()
    if v in ("infinita", "infinite", "recurrente", "recurrent", "ciclica"):
        return "infinita"
    return "finita"


def _migrate_ticket_frecuencia():
    """Recurrencia por ticket (frecuencia / proxima_renovacion). Migra datos legacy de misiones."""
    with _conn() as db:
        _add_col(
            db, "tickets", "frecuencia",
            "TEXT CHECK(frecuencia IN ('diaria','cada_2_dias','cada_3_dias','semanal',"
            "'quincenal','mensual','bimestral','trimestral','semestral'))",
        )
        _add_col(db, "tickets", "proxima_renovacion", "TEXT")
        db.execute("""
            UPDATE tickets
            SET frecuencia = (
                SELECT m.frecuencia FROM misiones m WHERE m.id = tickets.mision_id
            ),
            proxima_renovacion = (
                SELECT m.proxima_renovacion FROM misiones m WHERE m.id = tickets.mision_id
            )
            WHERE mision_id IS NOT NULL
              AND frecuencia IS NULL
              AND EXISTS (
                SELECT 1 FROM misiones m
                WHERE m.id = tickets.mision_id AND m.frecuencia IS NOT NULL
              )
        """)
        db.commit()


def _migrate_ticket_paso_notas():
    """Notas post-it opcionales por paso del checklist."""
    with _conn() as db:
        _add_col(db, "ticket_pasos", "notas", "TEXT")
        db.commit()


def init_db():
    _repair_broken_fk()
    _migrate_categorias()
    _migrate_materiales_tipo()
    _migrate_zonas_subareas()
    _migrate_mision_zona_id()
    _migrate_zonas_tipo()
    _migrate_mision_frecuencia()
    _migrate_mision_modo_ciclo()
    _migrate_ticket_frecuencia()
    _migrate_ticket_paso_notas()
    from app.services.misiones_timing import _migrate_mision_corridas
    from app.services.ticket_timing import _migrate_ticket_corridas
    from app.services.recetas_ops import _migrate_recetas_ops
    _migrate_mision_corridas()
    _migrate_ticket_corridas()
    _migrate_recetas_ops()
    _migrate_dependencias_prerequisitos()
    os.makedirs(UPLOADS_DIR, exist_ok=True)
    with _conn() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS categorias (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                slug      TEXT NOT NULL UNIQUE,
                nombre    TEXT NOT NULL,
                color     TEXT DEFAULT '#0c6069',
                icono     TEXT DEFAULT '📋',
                activo    INTEGER DEFAULT 1,
                creado_en TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS departamentos (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre     TEXT NOT NULL UNIQUE,
                descripcion TEXT,
                color      TEXT DEFAULT '#0c6069',
                activo     INTEGER DEFAULT 1,
                creado_en  TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS roles (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre      TEXT NOT NULL UNIQUE,
                nivel       INTEGER DEFAULT 1,
                descripcion TEXT,
                activo      INTEGER DEFAULT 1,
                creado_en   TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS usuarios (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre          TEXT NOT NULL,
                username        TEXT NOT NULL UNIQUE,
                password_hash   TEXT NOT NULL,
                rol_id          INTEGER REFERENCES roles(id),
                departamento_id INTEGER REFERENCES departamentos(id),
                activo          INTEGER DEFAULT 1,
                creado_en       TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS sesiones (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                usuario_id  INTEGER NOT NULL REFERENCES usuarios(id),
                token       TEXT NOT NULL UNIQUE,
                expira_en   TEXT NOT NULL,
                creado_en   TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS misiones (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                titulo              TEXT NOT NULL,
                descripcion         TEXT,
                reino               TEXT,
                zona_id             INTEGER REFERENCES zonas_trabajo(id),
                color               TEXT DEFAULT '#0c6069',
                tipo                TEXT NOT NULL DEFAULT 'secuencial'
                                        CHECK(tipo IN ('secuencial','paralelo')),
                categoria           TEXT DEFAULT 'logistica'
                                        CHECK(categoria IN ('rrhh','logistica','mantenimiento')),
                estado              TEXT NOT NULL DEFAULT 'borrador'
                                        CHECK(estado IN ('borrador','activa','completada','cancelada')),
                total_etapas        INTEGER DEFAULT 0,
                etapas_completadas  INTEGER DEFAULT 0,
                creado_por          INTEGER REFERENCES usuarios(id),
                creado_en           TEXT DEFAULT (datetime('now')),
                completada_en       TEXT
            );
            CREATE TABLE IF NOT EXISTS etapas_mision (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                mision_id  INTEGER NOT NULL REFERENCES misiones(id) ON DELETE CASCADE,
                orden      INTEGER NOT NULL,
                titulo     TEXT NOT NULL,
                descripcion TEXT,
                ticket_id  INTEGER REFERENCES tickets(id),
                estado     TEXT DEFAULT 'pendiente'
                               CHECK(estado IN ('pendiente','activa','completada')),
                creado_en  TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS tickets (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                numero          TEXT NOT NULL UNIQUE,
                titulo          TEXT NOT NULL,
                categoria       TEXT NOT NULL CHECK(categoria IN ('rrhh','logistica','mantenimiento')),
                descripcion     TEXT NOT NULL,
                estado          TEXT NOT NULL DEFAULT 'pendiente'
                                    CHECK(estado IN ('pendiente','en_proceso','esperando_aprobacion','resuelto','rechazado')),
                prioridad       TEXT DEFAULT 'media'
                                    CHECK(prioridad IN ('baja','media','alta','urgente')),
                creado_por      INTEGER NOT NULL REFERENCES usuarios(id),
                asignado_a      INTEGER REFERENCES usuarios(id),
                soporte_archivo TEXT,
                creado_en       TEXT DEFAULT (datetime('now')),
                actualizado_en  TEXT DEFAULT (datetime('now')),
                resuelto_en     TEXT
            );
            CREATE TABLE IF NOT EXISTS ticket_participantes (
                ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
                usuario_id  INTEGER NOT NULL REFERENCES usuarios(id),
                rol         TEXT DEFAULT 'colaborador'
                                CHECK(rol IN ('colaborador','revisor','observador')),
                agregado_en TEXT DEFAULT (datetime('now')),
                PRIMARY KEY (ticket_id, usuario_id)
            );
            CREATE TABLE IF NOT EXISTS comentarios_tickets (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
                usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
                texto      TEXT NOT NULL,
                es_interno INTEGER DEFAULT 0,
                creado_en  TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS bitacora_tiempo (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
                usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
                horas      REAL NOT NULL,
                notas      TEXT,
                creado_en  TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS logs_auditoria (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id       INTEGER NOT NULL REFERENCES tickets(id),
                usuario_id      INTEGER REFERENCES usuarios(id),
                accion          TEXT NOT NULL,
                valor_anterior  TEXT,
                valor_nuevo     TEXT,
                detalles        TEXT,
                creado_en       TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS materiales_catalogo (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre          TEXT NOT NULL UNIQUE,
                descripcion     TEXT,
                unidad          TEXT NOT NULL DEFAULT 'unidad',
                stock_actual    REAL DEFAULT 0,
                stock_minimo    REAL DEFAULT 0,
                precio_unitario REAL DEFAULT 0,
                proveedor       TEXT,
                activo          INTEGER DEFAULT 1,
                creado_en       TEXT DEFAULT (datetime('now')),
                actualizado_en  TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS ticket_pasos (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id       INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
                orden           INTEGER NOT NULL,
                descripcion     TEXT NOT NULL,
                completado      INTEGER DEFAULT 0,
                completado_en   TEXT,
                completado_por  INTEGER REFERENCES usuarios(id),
                creado_en       TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS ticket_materiales (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id           INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
                material_id         INTEGER NOT NULL REFERENCES materiales_catalogo(id),
                cantidad_requerida  REAL NOT NULL,
                creado_en           TEXT DEFAULT (datetime('now')),
                UNIQUE(ticket_id, material_id)
            );
            CREATE TABLE IF NOT EXISTS consumo_materiales (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id       INTEGER REFERENCES tickets(id),
                material_id     INTEGER NOT NULL REFERENCES materiales_catalogo(id),
                cantidad        REAL NOT NULL,
                tipo            TEXT DEFAULT 'consumo'
                                    CHECK(tipo IN ('consumo','ajuste_entrada','ajuste_salida','devolucion')),
                notas           TEXT,
                registrado_por  INTEGER REFERENCES usuarios(id),
                creado_en       TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS ordenes_compra (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                numero          TEXT NOT NULL UNIQUE,
                material_id     INTEGER NOT NULL REFERENCES materiales_catalogo(id),
                cantidad        REAL NOT NULL,
                precio_unitario REAL DEFAULT 0,
                proveedor       TEXT,
                estado          TEXT DEFAULT 'pendiente'
                                    CHECK(estado IN ('pendiente','aprobada','recibida','cancelada')),
                notas           TEXT,
                creado_por      INTEGER REFERENCES usuarios(id),
                creado_en       TEXT DEFAULT (datetime('now')),
                recibida_en     TEXT
            );
            CREATE TABLE IF NOT EXISTS dependencias_misiones (
                mision_id       INTEGER NOT NULL REFERENCES misiones(id) ON DELETE CASCADE,
                tipo            TEXT NOT NULL DEFAULT 'mision'
                                    CHECK(tipo IN ('mision','receta')),
                referencia_id   INTEGER NOT NULL,
                PRIMARY KEY (mision_id, tipo, referencia_id)
            );
        """)

        # Migrate tickets table with new columns
        _add_col(db, "tickets", "mision_id",    "INTEGER REFERENCES misiones(id)")
        _add_col(db, "tickets", "etapa_id",     "INTEGER REFERENCES etapas_mision(id)")
        _add_col(db, "tickets", "bloqueado_por","INTEGER REFERENCES tickets(id)")

        # Migrate misiones table with recurrence columns
        _add_col(db, "misiones", "frecuencia",
                 "TEXT CHECK(frecuencia IN ('diaria','cada_2_dias','cada_3_dias','semanal','quincenal','mensual','bimestral','trimestral','semestral'))")
        _add_col(db, "misiones", "proxima_renovacion", "TEXT")
        # Producto elaborado resultante de la misión
        _add_col(db, "misiones", "producto_resultante_id", "INTEGER REFERENCES materiales_catalogo(id)")

        # Migrate materiales_catalogo with tipo and origin
        _add_col(db, "materiales_catalogo", "tipo",
                 "TEXT DEFAULT 'materia_prima' CHECK(tipo IN ('materia_prima','elaborado','consumibles','repuestos','herramientas'))")
        _add_col(db, "materiales_catalogo", "mision_origen_id", "INTEGER REFERENCES misiones(id)")

        # Notas en materiales de ticket
        _add_col(db, "ticket_materiales", "notas", "TEXT")
        # Observaciones generales de la sección materiales (por etapa/ticket)
        _add_col(db, "tickets", "observaciones_materiales", "TEXT")

        db.executescript("""
            CREATE TABLE IF NOT EXISTS zonas_trabajo (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre      TEXT NOT NULL,
                parent_id   INTEGER REFERENCES zonas_trabajo(id),
                descripcion TEXT,
                color       TEXT DEFAULT '#4a9a6a',
                icono       TEXT DEFAULT '🏭',
                orden       INTEGER DEFAULT 0,
                activo      INTEGER DEFAULT 1,
                creado_en   TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS material_zonas (
                material_id INTEGER NOT NULL REFERENCES materiales_catalogo(id) ON DELETE CASCADE,
                zona_id     INTEGER NOT NULL REFERENCES zonas_trabajo(id) ON DELETE CASCADE,
                PRIMARY KEY (material_id, zona_id)
            );
        """)
        if db.execute("SELECT COUNT(*) AS n FROM zonas_trabajo").fetchone()["n"] == 0:
            for nombre, desc, color, icono, orden in [
                ("Producción", "Laboratorio y formulación", "#e8a838", "⚗️", 10),
                ("Bodega", "Almacén e inventario físico", "#4a9a6a", "📦", 20),
                ("Limpieza", "Aseo e higiene de planta", "#5ba3c9", "🧹", 30),
                ("Empaque", "Despacho y empaque", "#a68bc8", "📤", 40),
                ("Oficina", "Administración y papelería", "#94a3b8", "🏢", 50),
            ]:
                db.execute(
                    "INSERT INTO zonas_trabajo (nombre, parent_id, descripcion, color, icono, orden) VALUES (?,NULL,?,?,?,?)",
                    (nombre, desc, color, icono, orden),
                )

        # Seed categorias
        for slug, nombre, color, icono in [
            ("rrhh",          "Recursos Humanos", "#e8a838", "👥"),
            ("logistica",     "Logística",        "#4a9a6a", "🚚"),
            ("mantenimiento", "Mantenimiento",    "#a68bc8", "🔧"),
        ]:
            db.execute(
                "INSERT OR IGNORE INTO categorias (slug, nombre, color, icono) VALUES (?,?,?,?)",
                (slug, nombre, color, icono),
            )

        # Seed roles
        for nombre, nivel, desc in [
            ("Administrador", 3, "Acceso total al sistema"),
            ("Supervisor",    2, "Asigna y aprueba tickets"),
            ("Operario",      1, "Crea y gestiona sus tickets"),
        ]:
            db.execute(
                "INSERT OR IGNORE INTO roles (nombre, nivel, descripcion) VALUES (?,?,?)",
                (nombre, nivel, desc),
            )

        # Seed departments
        for nombre, color in [
            ("Administración", "#0c6069"),
            ("Logística",      "#4a9a6a"),
            ("Producción",     "#e58c8c"),
            ("Sistemas",       "#a68bc8"),
            ("Recursos Humanos", "#e8a838"),
        ]:
            db.execute(
                "INSERT OR IGNORE INTO departamentos (nombre, color) VALUES (?,?)",
                (nombre, color),
            )

        if not db.execute("SELECT id FROM usuarios WHERE username='admin'").fetchone():
            rol  = db.execute("SELECT id FROM roles WHERE nombre='Administrador'").fetchone()
            dept = db.execute("SELECT id FROM departamentos WHERE nombre='Administración'").fetchone()
            if rol and dept:
                db.execute(
                    "INSERT INTO usuarios (nombre, username, password_hash, rol_id, departamento_id) "
                    "VALUES (?,?,?,?,?)",
                    ("Administrador", "admin", generate_password_hash("admin123"), rol["id"], dept["id"]),
                )

        _add_col(db, "usuarios", "foto", "TEXT")
        db.commit()
    print("✅ Centro de Mando (tickets DB) inicializado")


# ── HELPERS ──────────────────────────────────────────────────────────────────

def _usuario_full(db, user_id: int) -> dict | None:
    row = db.execute("""
        SELECT u.id, u.nombre, u.username, u.activo, u.creado_en, u.foto,
               r.id as rol_id, r.nombre as rol_nombre, r.nivel as rol_nivel,
               d.id as dept_id, d.nombre as dept_nombre, d.color as dept_color
        FROM usuarios u
        LEFT JOIN roles r ON r.id = u.rol_id
        LEFT JOIN departamentos d ON d.id = u.departamento_id
        WHERE u.id = ?
    """, (user_id,)).fetchone()
    if not row:
        return None
    return {
        "id":       row["id"],
        "nombre":   row["nombre"],
        "username": row["username"],
        "activo":   row["activo"],
        "creado_en": row["creado_en"],
        "foto":     row["foto"],
        "rol": {"id": row["rol_id"], "nombre": row["rol_nombre"], "nivel": row["rol_nivel"]}
               if row["rol_id"] else None,
        "departamento": {"id": row["dept_id"], "nombre": row["dept_nombre"], "color": row["dept_color"]}
                        if row["dept_id"] else None,
    }


def _log(db, ticket_id: int, usuario_id: int | None, accion: str,
         val_ant=None, val_new=None, detalles=None):
    db.execute(
        "INSERT INTO logs_auditoria "
        "(ticket_id, usuario_id, accion, valor_anterior, valor_nuevo, detalles) "
        "VALUES (?,?,?,?,?,?)",
        (ticket_id, usuario_id, accion, val_ant, val_new, detalles),
    )


# ── AUTH ──────────────────────────────────────────────────────────────────────

def login_usuario(username: str, password: str):
    with _conn() as db:
        row = db.execute(
            "SELECT * FROM usuarios WHERE username=? AND activo=1", (username,)
        ).fetchone()
        if not row or not check_password_hash(row["password_hash"], password):
            return None, "Credenciales inválidas"
        token = secrets.token_urlsafe(32)
        expira = (datetime.utcnow() + timedelta(hours=8)).isoformat()
        db.execute(
            "INSERT INTO sesiones (usuario_id, token, expira_en) VALUES (?,?,?)",
            (row["id"], token, expira),
        )
        db.commit()
        return {"token": token, "usuario": _usuario_full(db, row["id"])}, None


def get_usuario_by_token(token: str) -> dict | None:
    with _conn() as db:
        row = db.execute(
            "SELECT usuario_id, expira_en FROM sesiones WHERE token=?", (token,)
        ).fetchone()
        if not row:
            return None
        if datetime.utcnow() > datetime.fromisoformat(row["expira_en"]):
            db.execute("DELETE FROM sesiones WHERE token=?", (token,))
            db.commit()
            return None
        return _usuario_full(db, row["usuario_id"])


def logout_usuario(token: str):
    with _conn() as db:
        db.execute("DELETE FROM sesiones WHERE token=?", (token,))
        db.commit()


# ── ROLES ─────────────────────────────────────────────────────────────────────

def listar_roles() -> list:
    with _conn() as db:
        return [dict(r) for r in db.execute(
            "SELECT * FROM roles WHERE activo=1 ORDER BY nivel DESC"
        ).fetchall()]


def crear_rol(nombre: str, nivel: int, descripcion: str = "") -> dict | None:
    with _conn() as db:
        try:
            db.execute(
                "INSERT INTO roles (nombre, nivel, descripcion) VALUES (?,?,?)",
                (nombre, nivel, descripcion),
            )
            db.commit()
            return dict(db.execute("SELECT * FROM roles WHERE nombre=?", (nombre,)).fetchone())
        except Exception:
            return None


def actualizar_rol(rol_id: int, data: dict) -> bool:
    campos = {k: v for k, v in data.items() if k in ("nombre", "nivel", "descripcion", "activo")}
    if not campos:
        return False
    with _conn() as db:
        set_clause = ", ".join(f"{k}=?" for k in campos)
        db.execute(f"UPDATE roles SET {set_clause} WHERE id=?", (*campos.values(), rol_id))
        db.commit()
        return True


# ── DEPARTAMENTOS ─────────────────────────────────────────────────────────────

def listar_departamentos() -> list:
    with _conn() as db:
        return [dict(r) for r in db.execute(
            "SELECT * FROM departamentos WHERE activo=1 ORDER BY nombre"
        ).fetchall()]


def crear_departamento(nombre: str, descripcion: str = "", color: str = "#0c6069") -> dict | None:
    with _conn() as db:
        try:
            db.execute(
                "INSERT INTO departamentos (nombre, descripcion, color) VALUES (?,?,?)",
                (nombre, descripcion, color),
            )
            db.commit()
            return dict(db.execute("SELECT * FROM departamentos WHERE nombre=?", (nombre,)).fetchone())
        except Exception:
            return None


def actualizar_departamento(dept_id: int, data: dict) -> bool:
    campos = {k: v for k, v in data.items() if k in ("nombre", "descripcion", "color", "activo")}
    if not campos:
        return False
    with _conn() as db:
        set_clause = ", ".join(f"{k}=?" for k in campos)
        db.execute(f"UPDATE departamentos SET {set_clause} WHERE id=?", (*campos.values(), dept_id))
        db.commit()
        return True


# ── USUARIOS ──────────────────────────────────────────────────────────────────

def listar_usuarios() -> list:
    with _conn() as db:
        rows = db.execute("SELECT id FROM usuarios ORDER BY nombre").fetchall()
        return [_usuario_full(db, r["id"]) for r in rows]


def crear_usuario(nombre: str, username: str, password: str,
                  rol_id: int, departamento_id: int) -> tuple:
    with _conn() as db:
        try:
            db.execute(
                "INSERT INTO usuarios (nombre, username, password_hash, rol_id, departamento_id) "
                "VALUES (?,?,?,?,?)",
                (nombre, username, generate_password_hash(password), rol_id, departamento_id),
            )
            db.commit()
            row = db.execute("SELECT id FROM usuarios WHERE username=?", (username,)).fetchone()
            return _usuario_full(db, row["id"]), None
        except Exception as e:
            if "UNIQUE" in str(e):
                return None, f"El username '{username}' ya existe"
            return None, str(e)


def actualizar_foto_usuario(user_id: int, filename: str) -> tuple:
    with _conn() as db:
        row = db.execute("SELECT foto FROM usuarios WHERE id=?", (user_id,)).fetchone()
        if not row:
            return False, "Usuario no encontrado"
        old = row["foto"]
        db.execute("UPDATE usuarios SET foto=? WHERE id=?", (filename, user_id))
        db.commit()
    if old and old != filename:
        try:
            os.remove(os.path.join(UPLOADS_DIR, old))
        except OSError:
            pass
    return True, None


def eliminar_foto_usuario(user_id: int) -> tuple:
    with _conn() as db:
        row = db.execute("SELECT foto FROM usuarios WHERE id=?", (user_id,)).fetchone()
        if not row:
            return False, "Usuario no encontrado"
        old = row["foto"]
        if not old:
            return True, None
        db.execute("UPDATE usuarios SET foto=NULL WHERE id=?", (user_id,))
        db.commit()
    try:
        os.remove(os.path.join(UPLOADS_DIR, old))
    except OSError:
        pass
    return True, None


def desactivar_usuario(user_id: int, solicitante_id: int) -> tuple:
    """Baja lógica de un aliado (activo=0); no borra filas."""
    if user_id == solicitante_id:
        return False, "No puedes eliminar tu propia cuenta"
    with _conn() as db:
        row = db.execute("SELECT id, activo FROM usuarios WHERE id=?", (user_id,)).fetchone()
        if not row:
            return False, "Usuario no encontrado"
        if not row["activo"]:
            return False, "El aliado ya está inactivo"
        db.execute("UPDATE usuarios SET activo=0 WHERE id=?", (user_id,))
        db.commit()
    return True, None


def actualizar_usuario(user_id: int, data: dict) -> tuple:
    campos = {k: v for k, v in data.items()
              if k in ("nombre", "username", "rol_id", "departamento_id", "activo")}
    if "password" in data and data["password"]:
        campos["password_hash"] = generate_password_hash(data["password"])
    if not campos:
        return False, "Sin datos para actualizar"
    with _conn() as db:
        try:
            set_clause = ", ".join(f"{k}=?" for k in campos)
            db.execute(f"UPDATE usuarios SET {set_clause} WHERE id=?", (*campos.values(), user_id))
            db.commit()
            return True, None
        except Exception as e:
            return False, str(e)


# ── MISIONES ──────────────────────────────────────────────────────────────────

def _slug_departamento(nombre: str) -> str:
    import re
    s = re.sub(r"[^a-z0-9]+", "_", (nombre or "").lower().strip()).strip("_")
    return (s[:48] or "operaciones")


def _zona_jerarquia(db, zona_id: int) -> dict | None:
    """Cadena reino → zona → subzona → departamento para un id de zonas_trabajo."""
    row = db.execute(
        "SELECT id, nombre, parent_id, color, icono FROM zonas_trabajo WHERE id=? AND activo=1",
        (zona_id,),
    ).fetchone()
    if not row:
        return None
    chain: list[dict] = []
    current = dict(row)
    for _ in range(8):
        chain.insert(0, current)
        if not current.get("parent_id"):
            break
        parent = db.execute(
            "SELECT id, nombre, parent_id, color, icono FROM zonas_trabajo WHERE id=?",
            (current["parent_id"],),
        ).fetchone()
        if not parent:
            break
        current = dict(parent)
    reino = chain[0]
    out = {
        "zona_id": zona_id,
        "reino_id": reino["id"],
        "reino_nombre": reino["nombre"],
        "zona_nombre": None,
        "subzona_nombre": None,
        "ubicacion_label": reino["nombre"],
    }
    if len(chain) >= 2:
        out["zona_nombre"] = chain[1]["nombre"]
        out["ubicacion_label"] = f"{reino['nombre']} › {chain[1]['nombre']}"
    if len(chain) >= 3:
        out["subzona_nombre"] = chain[2]["nombre"]
        out["ubicacion_label"] = (
            f"{reino['nombre']} › {chain[1]['nombre']} › {chain[2]['nombre']}"
        )
    if len(chain) >= 4:
        out["departamento_nombre"] = chain[-1]["nombre"]
        out["departamento_id"] = chain[-1]["id"]
        out["ubicacion_label"] = " › ".join(x["nombre"] for x in chain)
    elif len(chain) == 3:
        out["departamento_nombre"] = None
        out["departamento_id"] = None
    leaf = chain[-1]
    leaf_color = (leaf.get("color") or "").strip()
    out["ubicacion_color"] = leaf_color or None
    if len(chain) >= 2:
        zc = (chain[1].get("color") or "").strip()
        if zc:
            out["zona_color"] = zc
    return out


def _categoria_desde_zona(db, zona_id: int) -> str:
    """Slug de categoría para tickets: labor = departamento o genérico."""
    if _zona_tipo(db, zona_id) == "departamento":
        row = db.execute(
            "SELECT nombre FROM zonas_trabajo WHERE id=? AND activo=1", (zona_id,)
        ).fetchone()
        if row:
            slug = _slug_departamento(row["nombre"])
            db.execute(
                "INSERT OR IGNORE INTO categorias (slug, nombre, color, icono) VALUES (?,?,?,?)",
                (slug, row["nombre"], "#0c6069", "🏢"),
            )
            return slug
    return "logistica"


def _enriquecer_mision_zona(db, d: dict) -> dict:
    zid = d.get("zona_id")
    if zid:
        jer = _zona_jerarquia(db, zid)
        if jer:
            d.update(jer)
            if not (d.get("reino") or "").strip():
                d["reino"] = jer["reino_nombre"]
    elif (d.get("reino") or "").strip():
        d["ubicacion_label"] = (d.get("reino") or "").strip()
        d["reino_nombre"] = d["reino"]
    return d


def _resolver_zona_mision(db, data: dict) -> tuple[dict | None, str | None]:
    """Devuelve {zona_id, reino, categoria} listos para INSERT/UPDATE."""
    raw = data.get("zona_id")
    if raw not in (None, "", 0):
        try:
            zona_id = int(raw)
        except (TypeError, ValueError):
            return None, "zona_id inválido"
        jer = _zona_jerarquia(db, zona_id)
        if not jer:
            return None, "Ubicación no encontrada en el catálogo"
        tipo = _zona_tipo(db, zona_id)
        if tipo == "reino":
            return None, "La misión debe ubicarse al menos en una zona del catálogo"
        if tipo == "zona":
            if _zona_tiene_subzonas_activas(db, zona_id):
                return None, (
                    "Esta zona tiene subzonas: elige una subzona o un departamento bajo ella."
                )
            hijos = db.execute(
                "SELECT id FROM zonas_trabajo WHERE parent_id=? AND activo=1",
                (zona_id,),
            ).fetchall()
            if any(_zona_tipo(db, h["id"]) == "departamento" for h in hijos):
                return None, (
                    "Selecciona el departamento (labor) bajo esta zona "
                    "(ej. Cocina → Lavar platos). Créalo en 🏰 Reinos."
                )
        elif tipo == "subzona":
            hijos = db.execute(
                "SELECT 1 FROM zonas_trabajo WHERE parent_id=? AND activo=1 LIMIT 1",
                (zona_id,),
            ).fetchone()
            if hijos:
                return None, (
                    "Selecciona el departamento (labor) donde se ejecuta la misión. "
                    "Créalo en 🏰 Reinos bajo la subzona."
                )
        cat = _categoria_desde_zona(db, zona_id)
        return {
            "zona_id": zona_id,
            "reino": jer["reino_nombre"],
            "categoria": cat,
        }, None
    reino_txt = (data.get("reino") or "").strip()
    if reino_txt:
        r = db.execute(
            """SELECT id FROM zonas_trabajo
               WHERE activo=1 AND parent_id IS NULL
                 AND LOWER(TRIM(nombre)) = LOWER(TRIM(?))""",
            (reino_txt,),
        ).fetchone()
        if r:
            jer = _zona_jerarquia(db, r["id"])
            return {"zona_id": r["id"], "reino": jer["reino_nombre"] if jer else reino_txt}, None
        return {"zona_id": None, "reino": reino_txt}, None
    return None, "Selecciona reino, zona, subzona y departamento (labor)"


def _mision_full(db, mision_id: int) -> dict | None:
    m = db.execute("SELECT * FROM misiones WHERE id=?", (mision_id,)).fetchone()
    if not m:
        return None
    d = dict(m)
    creador = _usuario_full(db, m["creado_por"]) if m["creado_por"] else None
    d["creado_por_info"] = {"id": creador["id"], "nombre": creador["nombre"]} if creador else None
    etapas = db.execute("""
        SELECT e.*,
               t.numero  AS ticket_numero,
               t.estado  AS ticket_estado,
               t.frecuencia AS ticket_frecuencia,
               t.proxima_renovacion AS ticket_proxima_renovacion,
               t.asignado_a,
               t.bloqueado_por AS ticket_bloqueado_por,
               ua.nombre AS asignado_nombre,
               bt.numero AS bloqueado_por_numero,
               (SELECT COUNT(*) FROM ticket_pasos tp WHERE tp.ticket_id = t.id)
                   AS ticket_pasos_total,
               (SELECT COUNT(*) FROM ticket_pasos tp
                WHERE tp.ticket_id = t.id AND tp.completado = 1)
                   AS ticket_pasos_completados
        FROM etapas_mision e
        LEFT JOIN tickets   t  ON t.id  = e.ticket_id
        LEFT JOIN usuarios  ua ON ua.id = t.asignado_a
        LEFT JOIN tickets   bt ON bt.id = t.bloqueado_por
        WHERE e.mision_id = ?
        ORDER BY e.orden
    """, (mision_id,)).fetchall()
    d["etapas"] = [dict(e) for e in etapas]
    d["dependencias"] = _fetch_dependencias_mision(db, mision_id)
    if m["producto_resultante_id"]:
        pr = db.execute(
            "SELECT id, nombre, unidad, stock_actual, tipo FROM materiales_catalogo WHERE id=?",
            (m["producto_resultante_id"],)
        ).fetchone()
        d["producto_resultante"] = dict(pr) if pr else None
    else:
        d["producto_resultante"] = None
    d = _enriquecer_mision_zona(db, d)
    from app.services.ticket_timing import enriquecer_tiempos_mision
    return enriquecer_tiempos_mision(d)


def crear_mision(data: dict, usuario_id: int) -> tuple:
    """Crea la misión y sus tickets en un solo paso (sin fase borrador)."""
    titulo       = (data.get("titulo") or "").strip()
    etapas_raw   = data.get("etapas") or []
    asignaciones = data.get("asignaciones") or {}   # {"1": user_id, "2": user_id, ...}
    tipo         = data.get("tipo", "secuencial")

    if not titulo:
        return None, "titulo requerido"
    if not etapas_raw:
        return None, "Se requiere al menos una etapa"

    with _conn() as db:
        ubic, err = _resolver_zona_mision(db, data)
        if err:
            return None, err
        categoria = ubic.get("categoria") or "logistica"
        modo_ciclo = _normalizar_modo_ciclo(data.get("modo_ciclo"))
        db.execute("""
            INSERT INTO misiones
                (titulo, descripcion, reino, zona_id, color, tipo, categoria, creado_por,
                 total_etapas, estado, modo_ciclo, frecuencia, proxima_renovacion)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,NULL)
        """, (
            titulo,
            data.get("descripcion", ""),
            ubic["reino"],
            ubic.get("zona_id"),
            data.get("color", "#0c6069"),
            tipo,
            categoria,
            usuario_id,
            len(etapas_raw),
            "activa",
            modo_ciclo,
        ))
        mid = db.execute("SELECT last_insert_rowid() as id").fetchone()["id"]

        prev_ticket_id = None
        for i, etapa_raw in enumerate(etapas_raw, 1):
            etapa_titulo = (etapa_raw.get("titulo") or "").strip()
            etapa_desc   = (etapa_raw.get("descripcion") or "").strip()

            db.execute(
                "INSERT INTO etapas_mision (mision_id, orden, titulo, descripcion) VALUES (?,?,?,?)",
                (mid, i, etapa_titulo, etapa_desc),
            )
            etapa_id = db.execute("SELECT last_insert_rowid() as id").fetchone()["id"]

            asig_raw = asignaciones.get(str(i))
            asig     = int(asig_raw) if asig_raw else None
            numero   = _generar_numero(db)
            bloqueado_por  = prev_ticket_id if tipo == "secuencial" else None
            estado_inicial = "pendiente" if bloqueado_por else "en_proceso"
            etapa_freq = (etapa_raw.get("frecuencia") or "").strip() or None
            if etapa_freq and etapa_freq not in _FRECUENCIA_DELTA:
                return None, f"Frecuencia inválida en etapa {i}: {etapa_freq}"

            db.execute("""
                INSERT INTO tickets
                    (numero, titulo, categoria, descripcion, prioridad,
                     creado_por, asignado_a, mision_id, etapa_id, bloqueado_por, estado,
                     frecuencia, proxima_renovacion)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)
            """, (
                numero,
                etapa_titulo,
                categoria,
                etapa_desc or etapa_titulo,
                "media",
                usuario_id,
                asig,
                mid,
                etapa_id,
                bloqueado_por,
                estado_inicial,
                etapa_freq,
            ))
            tid = db.execute("SELECT last_insert_rowid() as id").fetchone()["id"]
            _insertar_pasos_ticket(db, tid, etapa_raw.get("pasos"))

            etapa_estado = "activa" if not bloqueado_por else "pendiente"
            db.execute(
                "UPDATE etapas_mision SET ticket_id=?, estado=? WHERE id=?",
                (tid, etapa_estado, etapa_id),
            )
            _log(db, tid, usuario_id, "ticket_creado",
                 detalles=f"Generado por misión '{titulo}' — Etapa {i}")
            prev_ticket_id = tid

        db.commit()
        return _mision_full(db, mid), None


def _ticket_visibilidad_sql(usuario: dict | None, alias: str = "t") -> tuple[str, list]:
    """Misma regla que listar_tickets para nivel < 2."""
    if not usuario:
        return "", []
    nivel = (usuario.get("rol") or {}).get("nivel", 1)
    if nivel >= 2:
        return "", []
    uid = usuario["id"]
    clause = (
        f" AND ({alias}.creado_por=? OR {alias}.asignado_a=? OR EXISTS("
        f"SELECT 1 FROM ticket_participantes tp "
        f"WHERE tp.ticket_id={alias}.id AND tp.usuario_id=?))"
    )
    return clause, [uid, uid, uid]


def _tickets_tablero_mision(db, mision_id: int, usuario: dict) -> list:
    """Tickets de etapas con conteo de pasos (checklist) para el tablero."""
    vis_sql, vis_params = _ticket_visibilidad_sql(usuario, "t")
    rows = db.execute(
        f"""
        SELECT t.id,
               t.numero,
               t.titulo,
               t.estado,
               t.prioridad,
               t.categoria,
               t.asignado_a,
               ua.nombre AS asignado_a_nombre,
               t.bloqueado_por,
               bt.numero AS bloqueado_por_numero,
               t.mision_id,
               t.etapa_id,
               m.titulo AS mision_titulo,
               m.color AS mision_color,
               m.tipo AS mision_tipo,
               m.reino AS mision_reino,
               m.zona_id AS mision_zona_id,
               e.orden AS etapa_orden,
               (SELECT COUNT(*) FROM ticket_pasos tp WHERE tp.ticket_id = t.id)
                   AS pasos_total,
               (SELECT COUNT(*) FROM ticket_pasos tp
                WHERE tp.ticket_id = t.id AND tp.completado = 1)
                   AS pasos_completados
        FROM etapas_mision e
        INNER JOIN tickets t ON t.id = e.ticket_id
        INNER JOIN misiones m ON m.id = e.mision_id
        LEFT JOIN usuarios ua ON ua.id = t.asignado_a
        LEFT JOIN tickets bt ON bt.id = t.bloqueado_por
        WHERE e.mision_id = ?{vis_sql}
        ORDER BY e.orden
        """,
        [mision_id, *vis_params],
    ).fetchall()
    return [dict(r) for r in rows]


def listar_misiones(usuario: dict | None = None, tablero: bool = False) -> list:
    with _conn() as db:
        rows = db.execute("""
            SELECT m.*,
                   u.nombre AS creado_por_nombre,
                   (SELECT COUNT(*) FROM etapas_mision WHERE mision_id=m.id) AS total,
                   (SELECT COUNT(*) FROM etapas_mision e
                    JOIN tickets t ON t.id=e.ticket_id
                    WHERE e.mision_id=m.id AND t.estado='resuelto') AS completadas
            FROM misiones m
            LEFT JOIN usuarios u ON u.id = m.creado_por
            ORDER BY m.creado_en DESC
        """).fetchall()
        out = []
        for r in rows:
            d = _enriquecer_mision_zona(db, dict(r))
            if tablero and usuario and d.get("estado") in ("activa", "borrador"):
                d["tickets_tablero"] = _tickets_tablero_mision(db, d["id"], usuario)
            out.append(d)
        return out


def get_mision(mision_id: int, usuario_id: int | None = None) -> dict | None:
    with _conn() as db:
        d = _mision_full(db, mision_id)
        if d:
            d["corrida"] = None
        return d


def reordenar_etapas_mision(mision_id: int, etapa_ids: list) -> tuple:
    """
    Reordena las etapas de una misión activa.
    etapa_ids: lista de IDs de etapas en el nuevo orden deseado.
    Para misiones secuenciales, recalcula la cadena bloqueado_por de los tickets.
    """
    with _conn() as db:
        m = db.execute("SELECT * FROM misiones WHERE id=?", (mision_id,)).fetchone()
        if not m:
            return None, "Misión no encontrada"
        ok, err = _mision_permite_gestion_etapas(db, mision_id)
        if not ok:
            return None, err
        _reactivar_mision_si_completada_recurrencia(db, mision_id)

        existing_ids = {r["id"] for r in db.execute(
            "SELECT id FROM etapas_mision WHERE mision_id=?", (mision_id,)
        ).fetchall()}
        if set(etapa_ids) != existing_ids:
            return None, "La lista de etapas no coincide con las etapas actuales"

        for i, eid in enumerate(etapa_ids, 1):
            db.execute("UPDATE etapas_mision SET orden=? WHERE id=?", (i, eid))

        if m["tipo"] == "secuencial":
            etapas_ordered = db.execute(
                "SELECT * FROM etapas_mision WHERE mision_id=? ORDER BY orden", (mision_id,)
            ).fetchall()
            prev_ticket_id = None
            for etapa in etapas_ordered:
                tid = etapa["ticket_id"]
                if not tid:
                    prev_ticket_id = None
                    continue
                db.execute("UPDATE tickets SET bloqueado_por=? WHERE id=?", (prev_ticket_id, tid))
                # Re-derive estado: unblocked + assigned → en_proceso; blocked → pendiente
                if prev_ticket_id is None:
                    t = db.execute("SELECT estado, asignado_a FROM tickets WHERE id=?", (tid,)).fetchone()
                    if t["estado"] == "pendiente" and t["asignado_a"]:
                        db.execute("UPDATE tickets SET estado='en_proceso' WHERE id=?", (tid,))
                else:
                    prev_estado = db.execute(
                        "SELECT estado FROM tickets WHERE id=?", (prev_ticket_id,)
                    ).fetchone()["estado"]
                    if prev_estado != "resuelto":
                        t = db.execute("SELECT estado FROM tickets WHERE id=?", (tid,)).fetchone()
                        if t["estado"] == "en_proceso":
                            db.execute("UPDATE tickets SET estado='pendiente' WHERE id=?", (tid,))
                prev_ticket_id = tid

        db.commit()
        return _mision_full(db, mision_id), None


def agregar_etapa_mision(mision_id: int, titulo: str, descripcion: str,
                         asignado_a: int | None, usuario_id: int,
                         pasos: list | None = None,
                         frecuencia: str | None = None) -> tuple:
    """Añade una etapa+ticket a una misión activa."""
    titulo = titulo.strip()
    if not titulo:
        return None, "Título requerido"
    with _conn() as db:
        m = db.execute("SELECT * FROM misiones WHERE id=?", (mision_id,)).fetchone()
        if not m:
            return None, "Misión no encontrada"
        ok, err = _mision_permite_gestion_etapas(db, mision_id)
        if not ok:
            return None, err
        _reactivar_mision_si_completada_recurrencia(db, mision_id)

        orden = (db.execute(
            "SELECT COALESCE(MAX(orden), 0) + 1 AS n FROM etapas_mision WHERE mision_id=?",
            (mision_id,)
        ).fetchone()["n"])

        db.execute(
            "INSERT INTO etapas_mision (mision_id, orden, titulo, descripcion, estado) VALUES (?,?,?,?,?)",
            (mision_id, orden, titulo, descripcion or "", "activa"),
        )
        etapa_id = db.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]

        # For sequential missions, block by last existing ticket
        bloqueado_por = None
        if m["tipo"] == "secuencial":
            last = db.execute("""
                SELECT t.id FROM etapas_mision e
                JOIN tickets t ON t.id = e.ticket_id
                WHERE e.mision_id = ? AND e.orden < ?
                ORDER BY e.orden DESC LIMIT 1
            """, (mision_id, orden)).fetchone()
            if last:
                bloqueado_por = last["id"]

        estado_ticket = "pendiente" if bloqueado_por else "en_proceso"
        freq = (frecuencia or "").strip() or None
        if freq and freq not in _FRECUENCIA_DELTA:
            return None, f"Frecuencia inválida: {freq}"

        numero = _generar_numero(db)
        db.execute("""
            INSERT INTO tickets
                (numero, titulo, categoria, descripcion, prioridad,
                 creado_por, asignado_a, mision_id, etapa_id, bloqueado_por, estado,
                 frecuencia, proxima_renovacion)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)
        """, (
            numero, titulo, m["categoria"], descripcion or titulo,
            "media", usuario_id, asignado_a, mision_id, etapa_id, bloqueado_por, estado_ticket,
            freq,
        ))
        tid = db.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
        _insertar_pasos_ticket(db, tid, pasos)
        db.execute("UPDATE etapas_mision SET ticket_id=? WHERE id=?", (tid, etapa_id))
        db.execute(
            "UPDATE misiones SET total_etapas = total_etapas + 1 WHERE id=?",
            (mision_id,)
        )
        _log(db, tid, usuario_id, "ticket_creado",
             detalles=f"Añadido manualmente a misión '{m['titulo']}' — Etapa {orden}")
        db.commit()
        return _mision_full(db, mision_id), None


def actualizar_etapa_mision(mision_id: int, etapa_id: int,
                             titulo: str, descripcion: str) -> tuple:
    """Edita título/descripción de una etapa existente (y su ticket asociado)."""
    titulo = titulo.strip()
    if not titulo:
        return None, "Título requerido"
    with _conn() as db:
        m = db.execute("SELECT * FROM misiones WHERE id=?", (mision_id,)).fetchone()
        if not m:
            return None, "Misión no encontrada"
        ok, err = _mision_permite_gestion_etapas(db, mision_id)
        if not ok:
            return None, err
        _reactivar_mision_si_completada_recurrencia(db, mision_id)
        etapa = db.execute(
            "SELECT * FROM etapas_mision WHERE id=? AND mision_id=?", (etapa_id, mision_id)
        ).fetchone()
        if not etapa:
            return None, "Etapa no encontrada"
        db.execute(
            "UPDATE etapas_mision SET titulo=?, descripcion=? WHERE id=?",
            (titulo, descripcion or "", etapa_id),
        )
        if etapa["ticket_id"]:
            db.execute(
                "UPDATE tickets SET titulo=?, descripcion=?, actualizado_en=datetime('now') WHERE id=?",
                (titulo, descripcion or titulo, etapa["ticket_id"]),
            )
        db.commit()
        return _mision_full(db, mision_id), None


def eliminar_etapa_mision(mision_id: int, etapa_id: int, usuario: dict) -> tuple:
    """Elimina una etapa y su ticket si aún no está resuelto."""
    with _conn() as db:
        m = db.execute("SELECT * FROM misiones WHERE id=?", (mision_id,)).fetchone()
        if not m:
            return None, "Misión no encontrada"
        ok, err = _mision_permite_gestion_etapas(db, mision_id)
        if not ok:
            return None, err
        _reactivar_mision_si_completada_recurrencia(db, mision_id)
        etapa = db.execute(
            "SELECT * FROM etapas_mision WHERE id=? AND mision_id=?", (etapa_id, mision_id)
        ).fetchone()
        if not etapa:
            return None, "Etapa no encontrada"
        if etapa["estado"] == "completada":
            return None, "No se puede eliminar una etapa ya completada"
        tid = etapa["ticket_id"]
        if tid:
            db.execute("UPDATE tickets SET bloqueado_por=NULL WHERE bloqueado_por=?", (tid,))
            db.execute("UPDATE etapas_mision SET ticket_id=NULL WHERE ticket_id=?", (tid,))
            db.execute("DELETE FROM logs_auditoria WHERE ticket_id=?", (tid,))
            db.execute("DELETE FROM tickets WHERE id=?", (tid,))
        db.execute("DELETE FROM etapas_mision WHERE id=?", (etapa_id,))
        db.execute(
            "UPDATE misiones SET total_etapas = MAX(0, total_etapas - 1) WHERE id=?",
            (mision_id,)
        )
        db.commit()
        return _mision_full(db, mision_id), None


def actualizar_mision(mision_id: int, data: dict) -> tuple:
    """Update mission metadata. No state lock — allows editing completed/cancelled missions."""
    with _conn() as db:
        m = db.execute("SELECT * FROM misiones WHERE id=?", (mision_id,)).fetchone()
        if not m:
            return None, "Misión no encontrada"
        campos = {k: v for k, v in data.items()
                  if k in ("titulo", "descripcion", "reino", "color", "tipo", "categoria",
                            "estado", "modo_ciclo")
                  and v is not None}
        if "modo_ciclo" in data:
            campos["modo_ciclo"] = _normalizar_modo_ciclo(data.get("modo_ciclo"))
        if "zona_id" in data:
            ubic, err = _resolver_zona_mision(db, data)
            if err:
                return None, err
            campos["zona_id"] = ubic.get("zona_id")
            campos["reino"] = ubic["reino"]
            if ubic.get("categoria"):
                campos["categoria"] = ubic["categoria"]
        # Validate estado transitions if provided
        if "estado" in campos:
            estado_val = campos["estado"]
            if estado_val not in ("activa", "completada", "cancelada"):
                return None, f"Estado inválido: {estado_val}"
            # Reset completada_en if reverting from completada
            if estado_val == "activa" and m["estado"] == "completada":
                db.execute(
                    "UPDATE misiones SET completada_en=NULL WHERE id=?", (mision_id,)
                )
        if campos:
            set_clause = ", ".join(f"{k}=?" for k in campos)
            db.execute(f"UPDATE misiones SET {set_clause} WHERE id=?", (*campos.values(), mision_id))
        db.commit()
        return _mision_full(db, mision_id), None


def get_dependencias_mision(mision_id: int) -> list:
    with _conn() as db:
        return _fetch_dependencias_mision(db, mision_id)


def agregar_dependencia_mision(
    mision_id: int,
    referencia_id: int,
    tipo: str = "mision",
) -> tuple:
    tipo = (tipo or "mision").strip().lower()
    if tipo not in ("mision", "receta"):
        return None, "Tipo de prerequisito inválido (mision o receta)"
    ref = int(referencia_id)
    if tipo == "mision" and mision_id == ref:
        return None, "Una misión no puede depender de sí misma"
    with _conn() as db:
        if not db.execute("SELECT id FROM misiones WHERE id=?", (mision_id,)).fetchone():
            return None, "Misión no encontrada"
        if tipo == "mision":
            if not db.execute("SELECT id FROM misiones WHERE id=?", (ref,)).fetchone():
                return None, "Misión prerequisito no encontrada"
            if db.execute(
                """
                SELECT 1 FROM dependencias_misiones
                WHERE mision_id=? AND tipo='mision' AND referencia_id=?
                """,
                (ref, mision_id),
            ).fetchone():
                return None, "Dependencia circular: la misión prerequisito ya depende de esta misión"
        else:
            if not db.execute(
                "SELECT 1 FROM recetas_ops WHERE id=? AND activo=1", (ref,)
            ).fetchone():
                return None, "Receta prerequisito no encontrada"
        try:
            db.execute(
                """
                INSERT OR IGNORE INTO dependencias_misiones (mision_id, tipo, referencia_id)
                VALUES (?,?,?)
                """,
                (mision_id, tipo, ref),
            )
            db.commit()
        except Exception as e:
            return None, str(e)
        return _mision_full(db, mision_id), None


def eliminar_dependencia_mision(
    mision_id: int,
    referencia_id: int,
    tipo: str = "mision",
) -> tuple:
    tipo = (tipo or "mision").strip().lower()
    with _conn() as db:
        db.execute(
            """
            DELETE FROM dependencias_misiones
            WHERE mision_id=? AND tipo=? AND referencia_id=?
            """,
            (mision_id, tipo, int(referencia_id)),
        )
        db.commit()
        return _mision_full(db, mision_id), None


def set_producto_resultante(mision_id: int, material_id: int | None) -> tuple:
    """Link (or unlink) an elaborated product to a mission."""
    with _conn() as db:
        if not db.execute("SELECT id FROM misiones WHERE id=?", (mision_id,)).fetchone():
            return None, "Misión no encontrada"
        if material_id is not None:
            mat = db.execute("SELECT id FROM materiales_catalogo WHERE id=?", (material_id,)).fetchone()
            if not mat:
                return None, "Material no encontrado"
            # Mark the material as elaborado and link origin
            db.execute(
                "UPDATE materiales_catalogo SET tipo='elaborado', mision_origen_id=? WHERE id=?",
                (mision_id, material_id)
            )
        db.execute(
            "UPDATE misiones SET producto_resultante_id=? WHERE id=?",
            (material_id, mision_id)
        )
        db.commit()
        return _mision_full(db, mision_id), None


def lanzar_mision(mision_id: int, asignaciones: dict, usuario: dict) -> tuple:
    """
    asignaciones: {str(orden): usuario_id | null}
    Sequential: each ticket N+1 has bloqueado_por = ticket N (except ticket 1).
    Parallel:   all tickets active, no blocking.
    """
    if (usuario.get("rol") or {}).get("nivel", 1) < 2:
        return False, "Sin autorización"
    with _conn() as db:
        m = db.execute("SELECT * FROM misiones WHERE id=?", (mision_id,)).fetchone()
        if not m:
            return False, "Misión no encontrada"
        if m["estado"] != "borrador":
            return False, f"Solo se pueden lanzar misiones en borrador (estado actual: {m['estado']})"
        etapas = db.execute(
            "SELECT * FROM etapas_mision WHERE mision_id=? ORDER BY orden", (mision_id,)
        ).fetchall()

        prev_ticket_id = None
        for etapa in etapas:
            asig_raw = asignaciones.get(str(etapa["orden"]))
            asig = int(asig_raw) if asig_raw else None
            numero = _generar_numero(db)
            bloqueado_por = prev_ticket_id if m["tipo"] == "secuencial" else None
            estado_inicial = "pendiente" if bloqueado_por else "en_proceso"

            db.execute("""
                INSERT INTO tickets
                    (numero, titulo, categoria, descripcion, prioridad,
                     creado_por, asignado_a, mision_id, etapa_id, bloqueado_por, estado)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)
            """, (
                numero,
                etapa["titulo"],
                m["categoria"],
                etapa["descripcion"] or etapa["titulo"],
                "media",
                usuario["id"],
                asig,
                mision_id,
                etapa["id"],
                bloqueado_por,
                estado_inicial,
            ))
            tid = db.execute("SELECT last_insert_rowid() as id").fetchone()["id"]

            etapa_estado = "activa" if not bloqueado_por else "pendiente"
            db.execute(
                "UPDATE etapas_mision SET ticket_id=?, estado=? WHERE id=?",
                (tid, etapa_estado, etapa["id"]),
            )
            _log(db, tid, usuario["id"], "ticket_creado",
                 detalles=f"Generado por misión '{m['titulo']}' — Etapa {etapa['orden']}")
            prev_ticket_id = tid

        db.execute(
            "UPDATE misiones SET estado='activa', etapas_completadas=0 WHERE id=?",
            (mision_id,),
        )
        db.commit()
        return True, None


def _deducir_materiales_mision(db, mision_id: int):
    """Deduct consumed materials and credit the resulting elaborated product on mission completion."""
    tickets = db.execute(
        "SELECT id FROM tickets WHERE mision_id=? AND estado='resuelto'", (mision_id,)
    ).fetchall()
    total_producido = 0.0
    for t in tickets:
        mats = db.execute(
            "SELECT tm.material_id, tm.cantidad_requerida "
            "FROM ticket_materiales tm WHERE tm.ticket_id=?",
            (t["id"],)
        ).fetchall()
        for mat in mats:
            m = db.execute(
                "SELECT stock_actual, stock_minimo, precio_unitario, proveedor, unidad "
                "FROM materiales_catalogo WHERE id=?", (mat["material_id"],)
            ).fetchone()
            if not m:
                continue
            total_producido += mat["cantidad_requerida"]
            nuevo_stock = max(0.0, m["stock_actual"] - mat["cantidad_requerida"])
            db.execute(
                "UPDATE materiales_catalogo SET stock_actual=?, actualizado_en=datetime('now') WHERE id=?",
                (nuevo_stock, mat["material_id"])
            )
            db.execute(
                "INSERT INTO consumo_materiales "
                "(ticket_id, material_id, cantidad, tipo, notas) VALUES (?,?,?,'consumo',?)",
                (t["id"], mat["material_id"], mat["cantidad_requerida"],
                 f"Auto-descontado al completar misión #{mision_id}")
            )
            if m["stock_minimo"] > 0 and nuevo_stock < m["stock_minimo"]:
                ya_existe = db.execute(
                    "SELECT id FROM ordenes_compra WHERE material_id=? AND estado='pendiente'",
                    (mat["material_id"],)
                ).fetchone()
                if not ya_existe:
                    num = _generar_numero_oc(db)
                    cantidad_oc = max(m["stock_minimo"] * 2 - nuevo_stock, mat["cantidad_requerida"])
                    db.execute("""
                        INSERT INTO ordenes_compra
                            (numero, material_id, cantidad, precio_unitario, proveedor, notas)
                        VALUES (?,?,?,?,?,?)
                    """, (
                        num, mat["material_id"], cantidad_oc,
                        m["precio_unitario"], m["proveedor"] or "",
                        f"Auto-generada al completar misión #{mision_id} — stock bajo ({nuevo_stock} {m['unidad']})"
                    ))

    # Credit the elaborated product with the sum of all input quantities
    if total_producido > 0:
        prod_id = db.execute(
            "SELECT producto_resultante_id FROM misiones WHERE id=?", (mision_id,)
        ).fetchone()
        if prod_id and prod_id["producto_resultante_id"]:
            pid = prod_id["producto_resultante_id"]
            db.execute(
                "UPDATE materiales_catalogo SET stock_actual=stock_actual+?, actualizado_en=datetime('now') WHERE id=?",
                (total_producido, pid)
            )
            db.execute(
                "INSERT INTO consumo_materiales "
                "(ticket_id, material_id, cantidad, tipo, notas) VALUES (?,?,?,'ajuste_entrada',?)",
                (None, pid, total_producido,
                 f"Producto elaborado: misión #{mision_id} completada — {total_producido:.3g} unidades producidas")
            )


def _actualizar_mision(db, mision_id: int):
    total = db.execute(
        "SELECT COUNT(*) as n FROM etapas_mision WHERE mision_id=?", (mision_id,)
    ).fetchone()["n"]
    completadas = db.execute("""
        SELECT COUNT(*) as n FROM etapas_mision e
        JOIN tickets t ON t.id = e.ticket_id
        WHERE e.mision_id=? AND t.estado='resuelto'
    """, (mision_id,)).fetchone()["n"]
    db.execute("""
        UPDATE etapas_mision SET estado='completada'
        WHERE mision_id=? AND ticket_id IN (SELECT id FROM tickets WHERE estado='resuelto')
    """, (mision_id,))
    if completadas >= total > 0:
        m = db.execute("SELECT estado FROM misiones WHERE id=?", (mision_id,)).fetchone()
        already_done = m and m["estado"] == "completada"
        if _mision_ciclo_infinito(db, mision_id):
            # Misión infinita: no cerrar la misión al resolver todos los tickets del ciclo
            db.execute(
                "UPDATE misiones SET etapas_completadas=?, estado='activa', completada_en=NULL "
                "WHERE id=?",
                (completadas, mision_id),
            )
        else:
            db.execute(
                "UPDATE misiones SET estado='completada', etapas_completadas=?, "
                "completada_en=datetime('now'), proxima_renovacion=NULL WHERE id=?",
                (completadas, mision_id),
            )
            # Auto-deduct materials only the first time the mission completes
            if not already_done:
                _deducir_materiales_mision(db, mision_id)
    else:
        db.execute(
            "UPDATE misiones SET etapas_completadas=? WHERE id=?",
            (completadas, mision_id),
        )


def eliminar_ticket(ticket_id: int, usuario: dict) -> tuple:
    if (usuario.get("rol") or {}).get("nivel", 1) < 3:
        return False, "Solo administradores pueden eliminar tickets"
    with _conn() as db:
        t = db.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        if not t:
            return False, "Ticket no encontrado"
        # Unblock any tickets that were waiting on this one
        db.execute("UPDATE tickets SET bloqueado_por=NULL WHERE bloqueado_por=?", (ticket_id,))
        # Unlink from etapa so the etapa can still exist
        db.execute(
            "UPDATE etapas_mision SET ticket_id=NULL, estado='pendiente' WHERE ticket_id=?",
            (ticket_id,),
        )
        # logs_auditoria and consumo_materiales have no CASCADE — handle manually
        db.execute("DELETE FROM logs_auditoria WHERE ticket_id=?", (ticket_id,))
        db.execute("UPDATE consumo_materiales SET ticket_id=NULL WHERE ticket_id=?", (ticket_id,))
        # comentarios, bitacora, participantes have ON DELETE CASCADE
        db.execute("DELETE FROM tickets WHERE id=?", (ticket_id,))
        db.commit()
        return True, None


def eliminar_mision(mision_id: int, usuario: dict) -> tuple:
    if (usuario.get("rol") or {}).get("nivel", 1) < 3:
        return False, "Solo administradores pueden eliminar misiones"
    with _conn() as db:
        m = db.execute("SELECT * FROM misiones WHERE id=?", (mision_id,)).fetchone()
        if not m:
            return False, "Misión no encontrada"
        ticket_ids = [r["id"] for r in db.execute(
            "SELECT id FROM tickets WHERE mision_id=?", (mision_id,)
        ).fetchall()]
        for tid in ticket_ids:
            db.execute("UPDATE tickets SET bloqueado_por=NULL WHERE bloqueado_por=?", (tid,))
            db.execute("UPDATE etapas_mision SET ticket_id=NULL WHERE ticket_id=?", (tid,))
            db.execute("DELETE FROM logs_auditoria WHERE ticket_id=?", (tid,))
        if ticket_ids:
            placeholders = ",".join("?" * len(ticket_ids))
            db.execute(f"DELETE FROM tickets WHERE id IN ({placeholders})", ticket_ids)
        # etapas_mision has ON DELETE CASCADE from misiones
        db.execute("DELETE FROM misiones WHERE id=?", (mision_id,))
        db.commit()
        return True, None


# ── RECURRENCIA ───────────────────────────────────────────────────────────────

_FRECUENCIA_DELTA = {
    "diaria":     timedelta(days=1),
    "cada_2_dias": timedelta(days=2),
    "cada_3_dias": timedelta(days=3),
    "semanal":    timedelta(weeks=1),
    "quincenal":  timedelta(days=15),
    "mensual":    timedelta(days=30),
    "bimestral":  timedelta(days=60),
    "trimestral": timedelta(days=90),
    "semestral":  timedelta(days=180),
}

_FRECUENCIA_LABEL = {
    "diaria":     "Diaria",
    "cada_2_dias": "Cada 2 días",
    "cada_3_dias": "Cada 3 días",
    "semanal":    "Semanal",
    "quincenal":  "Quincenal",
    "mensual":    "Mensual",
    "bimestral":  "Bimestral",
    "trimestral": "Trimestral",
    "semestral":  "Semestral",
}


def _mision_ciclo_infinito(db, mision_id: int) -> bool:
    """True si la misión está configurada como infinita (se repite)."""
    m = db.execute(
        "SELECT modo_ciclo, frecuencia FROM misiones WHERE id=?", (mision_id,)
    ).fetchone()
    if not m:
        return False
    modo = (m["modo_ciclo"] or "finita").strip().lower()
    if modo == "infinita":
        return True
    if modo == "finita":
        return False
    # Legacy sin modo_ciclo explícito
    if (m["frecuencia"] or "").strip():
        return True
    return bool(db.execute(
        """
        SELECT 1 FROM tickets
        WHERE mision_id=? AND frecuencia IS NOT NULL AND TRIM(frecuencia) != ''
        LIMIT 1
        """,
        (mision_id,),
    ).fetchone())


def _mision_permite_gestion_etapas(db, mision_id: int) -> tuple[bool, str | None]:
    """Permite añadir/reordenar/eliminar etapas (salvo misión cancelada)."""
    m = db.execute("SELECT estado FROM misiones WHERE id=?", (mision_id,)).fetchone()
    if not m:
        return False, "Misión no encontrada"
    if m["estado"] == "cancelada":
        return False, "La misión está cancelada y no puede editarse"
    if m["estado"] == "completada":
        if _mision_ciclo_infinito(db, mision_id):
            return True, None
        return (
            False,
            "La misión finita está completada. Cámbiala a Activa en ✏️ Editar o crea una misión infinita.",
        )
    return True, None


def _reactivar_mision_si_completada_recurrencia(db, mision_id: int) -> None:
    if not _mision_ciclo_infinito(db, mision_id):
        return
    db.execute(
        "UPDATE misiones SET estado='activa', completada_en=NULL WHERE id=? AND estado='completada'",
        (mision_id,),
    )


def _calcular_proxima(frecuencia: str) -> str:
    delta = _FRECUENCIA_DELTA.get(frecuencia)
    if not delta:
        return ""
    return (datetime.utcnow() + delta).strftime("%Y-%m-%d %H:%M:%S")


def _programar_renovacion_ticket(db, ticket_id: int) -> None:
    """Tras resolver un ticket recurrente, agenda la próxima renovación automática."""
    t = db.execute("SELECT frecuencia FROM tickets WHERE id=?", (ticket_id,)).fetchone()
    if not t or not t["frecuencia"]:
        return
    proxima = _calcular_proxima(t["frecuencia"])
    if proxima:
        db.execute(
            "UPDATE tickets SET proxima_renovacion=? WHERE id=?",
            (proxima, ticket_id),
        )


def _reset_ticket_ciclo(db, ticket_id: int, usuario_id: int | None, mision_id: int | None) -> None:
    """Reinicia pasos y estado de un ticket para un nuevo ciclo (sin borrar el ticket)."""
    t = db.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
    if not t:
        return
    db.execute(
        "UPDATE ticket_pasos SET completado=0, completado_en=NULL, completado_por=NULL "
        "WHERE ticket_id=?",
        (ticket_id,),
    )
    bloqueado = t["bloqueado_por"]
    if bloqueado:
        pred = db.execute("SELECT estado FROM tickets WHERE id=?", (bloqueado,)).fetchone()
        nuevo_estado = (
            "pendiente" if pred and pred["estado"] != "resuelto" else "en_proceso"
        )
    else:
        nuevo_estado = "en_proceso"
    db.execute(
        "UPDATE tickets SET estado=?, resuelto_en=NULL, proxima_renovacion=NULL, "
        "actualizado_en=datetime('now') WHERE id=?",
        (nuevo_estado, ticket_id),
    )
    etapa_estado = "activa" if nuevo_estado != "pendiente" else "pendiente"
    if t["etapa_id"]:
        db.execute(
            "UPDATE etapas_mision SET estado=? WHERE ticket_id=?",
            (etapa_estado, ticket_id),
        )
    if mision_id:
        db.execute(
            "UPDATE misiones SET estado='activa', completada_en=NULL "
            "WHERE id=? AND estado='completada'",
            (mision_id,),
        )
        _actualizar_mision(db, mision_id)
    uid = usuario_id or t["creado_por"]
    _log(db, ticket_id, uid, "ticket_renovado", detalles="Nuevo ciclo de ejecución")


def renovar_ticket(ticket_id: int, usuario_id: int | None = None) -> tuple:
    """Reinicia un ticket resuelto (checklist en blanco) para el siguiente ciclo."""
    with _conn() as db:
        t = db.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        if not t:
            return False, "Ticket no encontrado"
        if t["estado"] != "resuelto":
            return False, "Solo se pueden renovar tickets resueltos"
        from app.services.ticket_timing import finalizar_corridas_abiertas_ticket
        finalizar_corridas_abiertas_ticket(ticket_id)
        _reset_ticket_ciclo(db, ticket_id, usuario_id, t["mision_id"])
        db.commit()
    return True, None


def actualizar_ticket(ticket_id: int, data: dict, usuario: dict) -> tuple:
    """Actualiza metadatos del ticket (p. ej. recurrencia por ticket)."""
    with _conn() as db:
        t = db.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        if not t:
            return None, "Ticket no encontrado"
        campos = {}
        if "titulo" in data and data["titulo"] is not None:
            campos["titulo"] = str(data["titulo"]).strip()
        if "descripcion" in data and data["descripcion"] is not None:
            campos["descripcion"] = str(data["descripcion"]).strip()
        if "prioridad" in data and data["prioridad"] is not None:
            if data["prioridad"] not in ("baja", "media", "alta", "urgente"):
                return None, "Prioridad inválida"
            campos["prioridad"] = data["prioridad"]
        if "frecuencia" in data:
            freq = (data.get("frecuencia") or "").strip() or None
            if freq and freq not in _FRECUENCIA_DELTA:
                return None, "Frecuencia inválida"
            campos["frecuencia"] = freq
            if not freq:
                campos["proxima_renovacion"] = None
            elif t["estado"] == "resuelto":
                campos["proxima_renovacion"] = _calcular_proxima(freq)
        if not campos:
            return _ticket_full(db, ticket_id), None
        set_clause = ", ".join(f"{k}=?" for k in campos)
        db.execute(
            f"UPDATE tickets SET {set_clause}, actualizado_en=datetime('now') WHERE id=?",
            (*campos.values(), ticket_id),
        )
        db.commit()
        return _ticket_full(db, ticket_id), None


def renovar_mision(mision_id: int, usuario_id: int | None = None) -> tuple:
    """Renueva todos los tickets resueltos de la misión (reinicio in-place, sin borrar tickets)."""
    with _conn() as db:
        m = db.execute("SELECT id FROM misiones WHERE id=?", (mision_id,)).fetchone()
        if not m:
            return False, "Misión no encontrada"
        etapas = db.execute(
            "SELECT ticket_id FROM etapas_mision WHERE mision_id=? AND ticket_id IS NOT NULL",
            (mision_id,),
        ).fetchall()
        renovados = 0
        for et in etapas:
            t = db.execute(
                "SELECT estado FROM tickets WHERE id=?", (et["ticket_id"],),
            ).fetchone()
            if t and t["estado"] == "resuelto":
                from app.services.ticket_timing import finalizar_corridas_abiertas_ticket
                finalizar_corridas_abiertas_ticket(et["ticket_id"])
                _reset_ticket_ciclo(db, et["ticket_id"], usuario_id, mision_id)
                renovados += 1
        if renovados == 0:
            return False, "No hay tickets resueltos para renovar"
        db.commit()
    return True, None


def procesar_renovaciones() -> list[int]:
    """Renueva tickets recurrentes cuya proxima_renovacion ya venció."""
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    renovadas = []
    with _conn() as db:
        pendientes = db.execute("""
            SELECT id FROM tickets
            WHERE frecuencia IS NOT NULL
              AND estado = 'resuelto'
              AND proxima_renovacion IS NOT NULL
              AND proxima_renovacion <= ?
        """, (now,)).fetchall()
        ids = [r["id"] for r in pendientes]
    for tid in ids:
        ok, _ = renovar_ticket(tid)
        if ok:
            renovadas.append(tid)
    return renovadas


# ── PARTICIPANTES ─────────────────────────────────────────────────────────────

def agregar_participante(ticket_id: int, usuario_id: int, rol: str = "colaborador") -> bool:
    with _conn() as db:
        try:
            db.execute(
                "INSERT OR REPLACE INTO ticket_participantes (ticket_id, usuario_id, rol) VALUES (?,?,?)",
                (ticket_id, usuario_id, rol),
            )
            db.commit()
            return True
        except Exception:
            return False


def quitar_participante(ticket_id: int, usuario_id: int) -> bool:
    with _conn() as db:
        db.execute(
            "DELETE FROM ticket_participantes WHERE ticket_id=? AND usuario_id=?",
            (ticket_id, usuario_id),
        )
        db.commit()
        return True


# ── TICKETS ───────────────────────────────────────────────────────────────────

def _generar_numero(db) -> str:
    year = datetime.utcnow().year
    row = db.execute(
        "SELECT MAX(CAST(SUBSTR(numero, 10) AS INTEGER)) AS mx FROM tickets WHERE numero LIKE ?",
        (f"TKT-{year}-%",),
    ).fetchone()
    n = row["mx"] or 0
    return f"TKT-{year}-{(n + 1):04d}"


def _ticket_full(db, ticket_id: int) -> dict | None:
    t = db.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
    if not t:
        return None
    d = dict(t)
    creador = _usuario_full(db, t["creado_por"])
    d["creado_por_info"] = {"id": creador["id"], "nombre": creador["nombre"]} if creador else None
    if t["asignado_a"]:
        asig = _usuario_full(db, t["asignado_a"])
        d["asignado_a_info"] = {"id": asig["id"], "nombre": asig["nombre"]} if asig else None
    else:
        d["asignado_a_info"] = None

    # Bloqueado por (y desbloqueo automático si el ticket anterior ya está resuelto)
    bloqueado = d.get("bloqueado_por")
    if bloqueado:
        pred = db.execute(
            "SELECT id, estado, numero FROM tickets WHERE id=?", (bloqueado,),
        ).fetchone()
        if pred and pred["estado"] == "resuelto":
            db.execute(
                "UPDATE tickets SET bloqueado_por=NULL, estado='en_proceso', "
                "actualizado_en=datetime('now') WHERE id=?",
                (ticket_id,),
            )
            db.execute(
                "UPDATE etapas_mision SET estado='activa' WHERE ticket_id=?", (ticket_id,),
            )
            db.commit()
            d["bloqueado_por"] = None
            d["estado"] = "en_proceso"
            d["bloqueado_por_numero"] = None
        else:
            d["bloqueado_por_numero"] = pred["numero"] if pred else None
    else:
        d["bloqueado_por_numero"] = None

    # Mision context
    if d.get("mision_id"):
        m = db.execute("SELECT * FROM misiones WHERE id=?", (d["mision_id"],)).fetchone()
        if m:
            etapa = db.execute(
                "SELECT * FROM etapas_mision WHERE id=?", (d.get("etapa_id"),)
            ).fetchone() if d.get("etapa_id") else None
            d["mision_info"] = {
                "id": m["id"], "titulo": m["titulo"], "tipo": m["tipo"],
                "color": m["color"], "total_etapas": m["total_etapas"],
                "etapas_completadas": m["etapas_completadas"],
            }
            d["etapa_info"] = {"id": etapa["id"], "orden": etapa["orden"]} if etapa else None
        else:
            d["mision_info"] = d["etapa_info"] = None
    else:
        d["mision_info"] = d["etapa_info"] = None

    # Participants
    d["participantes"] = [dict(p) for p in db.execute("""
        SELECT tp.rol, tp.agregado_en, u.id as usuario_id, u.nombre as usuario_nombre
        FROM ticket_participantes tp
        JOIN usuarios u ON u.id = tp.usuario_id
        WHERE tp.ticket_id = ?
    """, (ticket_id,)).fetchall()]

    # Comments
    d["comentarios"] = [dict(c) for c in db.execute("""
        SELECT c.*, u.nombre as autor_nombre
        FROM comentarios_tickets c JOIN usuarios u ON u.id = c.usuario_id
        WHERE c.ticket_id = ? ORDER BY c.creado_en ASC
    """, (ticket_id,)).fetchall()]

    # Time log
    tiempos = db.execute("""
        SELECT b.*, u.nombre as autor_nombre
        FROM bitacora_tiempo b JOIN usuarios u ON u.id = b.usuario_id
        WHERE b.ticket_id = ? ORDER BY b.creado_en DESC
    """, (ticket_id,)).fetchall()
    d["tiempo_registrado"] = [dict(t) for t in tiempos]
    d["total_horas"] = round(sum(t["horas"] for t in tiempos), 2)

    # Audit log
    d["historial"] = [dict(l) for l in db.execute("""
        SELECT l.*, u.nombre as usuario_nombre
        FROM logs_auditoria l LEFT JOIN usuarios u ON u.id = l.usuario_id
        WHERE l.ticket_id = ? ORDER BY l.creado_en ASC
    """, (ticket_id,)).fetchall()]

    total, ok = _pasos_conteo_ticket(db, ticket_id)
    d["pasos_total"] = total
    d["pasos_completados"] = ok
    return d


def crear_ticket(data: dict, usuario_id: int, archivo_nombre: str | None = None) -> tuple:
    with _conn() as db:
        numero = _generar_numero(db)
        try:
            asignado_a = int(data["asignado_a"]) if data.get("asignado_a") else None
            db.execute("""
                INSERT INTO tickets
                    (numero, titulo, categoria, descripcion, prioridad,
                     creado_por, asignado_a, soporte_archivo)
                VALUES (?,?,?,?,?,?,?,?)
            """, (
                numero, data["titulo"], data["categoria"],
                data["descripcion"], data.get("prioridad", "media"),
                usuario_id, asignado_a, archivo_nombre,
            ))
            tid = db.execute("SELECT last_insert_rowid() as id").fetchone()["id"]
            _log(db, tid, usuario_id, "ticket_creado", detalles=f"Ticket {numero} creado")
            if asignado_a:
                _log(db, tid, usuario_id, "asignado",
                     val_new=str(asignado_a), detalles="Asignado al crear")
                db.execute(
                    "UPDATE tickets SET estado='en_proceso', actualizado_en=datetime('now') WHERE id=?",
                    (tid,),
                )
                _log(db, tid, usuario_id, "estado_cambiado", "pendiente", "en_proceso",
                     "Asignado al crear → en proceso")
            db.commit()
            return _ticket_full(db, tid), None
        except Exception as e:
            return None, str(e)


def listar_tickets(usuario: dict, filtros: dict | None = None) -> list:
    filtros = filtros or {}
    with _conn() as db:
        nivel = (usuario.get("rol") or {}).get("nivel", 1)
        conds, params = [], []
        if nivel < 2:
            conds.append("(t.creado_por=? OR t.asignado_a=? OR EXISTS("
                         "SELECT 1 FROM ticket_participantes tp "
                         "WHERE tp.ticket_id=t.id AND tp.usuario_id=?))")
            params += [usuario["id"], usuario["id"], usuario["id"]]
        for key in ("estado", "categoria", "prioridad"):
            if filtros.get(key):
                conds.append(f"t.{key}=?")
                params.append(filtros[key])
        if filtros.get("asignado_a"):
            conds.append("t.asignado_a=?")
            params.append(filtros["asignado_a"])
        if filtros.get("mision_id"):
            conds.append("t.mision_id=?")
            params.append(filtros["mision_id"])
        where = ("WHERE " + " AND ".join(conds)) if conds else ""
        rows = db.execute(f"""
            SELECT t.*,
                   uc.nombre  AS creado_por_nombre,
                   ua.nombre  AS asignado_a_nombre,
                   m.titulo   AS mision_titulo,
                   m.color    AS mision_color,
                   m.tipo     AS mision_tipo,
                   m.reino    AS mision_reino,
                   m.zona_id  AS mision_zona_id,
                   bt.numero  AS bloqueado_por_numero,
                   (SELECT COUNT(*) FROM ticket_pasos tp WHERE tp.ticket_id = t.id)
                       AS pasos_total,
                   (SELECT COUNT(*) FROM ticket_pasos tp
                    WHERE tp.ticket_id = t.id AND tp.completado = 1)
                       AS pasos_completados
            FROM tickets t
            LEFT JOIN usuarios uc ON uc.id = t.creado_por
            LEFT JOIN usuarios ua ON ua.id = t.asignado_a
            LEFT JOIN misiones m  ON m.id  = t.mision_id
            LEFT JOIN tickets  bt ON bt.id = t.bloqueado_por
            {where}
            ORDER BY
                CASE t.prioridad
                    WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1
                    WHEN 'media'   THEN 2 ELSE 3
                END,
                t.creado_en DESC
        """, params).fetchall()
        return [dict(r) for r in rows]


def get_ticket(ticket_id: int, usuario: dict) -> dict | None:
    with _conn() as db:
        t = db.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        if not t:
            return None
        nivel = (usuario.get("rol") or {}).get("nivel", 1)
        if nivel < 2:
            is_part = db.execute(
                "SELECT 1 FROM ticket_participantes WHERE ticket_id=? AND usuario_id=?",
                (ticket_id, usuario["id"]),
            ).fetchone()
            if not is_part and t["creado_por"] != usuario["id"] and t["asignado_a"] != usuario["id"]:
                return None
        d = _ticket_full(db, ticket_id)
        if not d:
            return None
        from app.services.ticket_timing import adjuntar_corrida_ticket
        return adjuntar_corrida_ticket(d, usuario["id"])


def cambiar_estado(ticket_id: int, nuevo_estado: str, usuario: dict, motivo: str = "") -> tuple:
    valid = {"pendiente", "en_proceso", "esperando_aprobacion", "resuelto", "rechazado"}
    if nuevo_estado not in valid:
        return False, "Estado inválido"
    with _conn() as db:
        t = db.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        if not t:
            return False, "Ticket no encontrado"
        nivel = (usuario.get("rol") or {}).get("nivel", 1)
        uid   = usuario["id"]

        if nuevo_estado == "resuelto":
            if t["categoria"] == "rrhh" and nivel < 3:
                return False, "Solo Administración puede aprobar tickets de RR.HH."
            is_authorized = (nivel >= 2 or t["creado_por"] == uid or t["asignado_a"] == uid)
            if not is_authorized:
                return False, "Sin autorización"
        if nuevo_estado == "rechazado" and nivel < 2:
            return False, "Sin autorización para rechazar tickets"
        if nuevo_estado == "esperando_aprobacion":
            if t["asignado_a"] != uid and nivel < 2:
                return False, "Solo el responsable puede marcar como listo"

        # Find sequential dependents before resolving
        blocked_deps = []
        if nuevo_estado == "resuelto":
            blocked_deps = db.execute(
                "SELECT id, asignado_a FROM tickets WHERE bloqueado_por=?", (ticket_id,)
            ).fetchall()

        sql = "UPDATE tickets SET estado=?, actualizado_en=datetime('now')"
        p   = [nuevo_estado]
        if nuevo_estado == "resuelto":
            sql += ", resuelto_en=datetime('now')"
        sql += " WHERE id=?"
        p.append(ticket_id)
        db.execute(sql, p)

        _log(db, ticket_id, uid, "estado_cambiado", t["estado"], nuevo_estado, motivo or None)
        if motivo:
            db.execute(
                "INSERT INTO comentarios_tickets (ticket_id, usuario_id, texto, es_interno) "
                "VALUES (?,?,?,1)",
                (ticket_id, uid, f"[{nuevo_estado.upper()}] {motivo}"),
            )

        # Unlock sequential dependents
        for dep in blocked_deps:
            dep_state = "en_proceso"
            db.execute(
                "UPDATE tickets SET bloqueado_por=NULL, estado=?, actualizado_en=datetime('now') "
                "WHERE id=?",
                (dep_state, dep["id"]),
            )
            db.execute(
                "UPDATE etapas_mision SET estado='activa' WHERE ticket_id=?", (dep["id"],)
            )
            _log(db, dep["id"], uid, "estado_cambiado", "bloqueado", dep_state,
                 "Desbloqueado al resolver la etapa anterior")

        # Update mission progress
        if t["mision_id"]:
            _actualizar_mision(db, t["mision_id"])
        if nuevo_estado == "resuelto":
            _programar_renovacion_ticket(db, ticket_id)

        db.commit()
        if nuevo_estado == "resuelto":
            from app.services.ticket_timing import finalizar_corridas_abiertas_ticket
            finalizar_corridas_abiertas_ticket(ticket_id)
        return True, None


def asignar_ticket(ticket_id: int, asignado_a: int | None, usuario: dict) -> tuple:
    if (usuario.get("rol") or {}).get("nivel", 1) < 2:
        return False, "Sin autorización"
    with _conn() as db:
        t = db.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        if not t:
            return False, "No encontrado"
        nombre = ""
        if asignado_a:
            u = db.execute("SELECT nombre FROM usuarios WHERE id=?", (asignado_a,)).fetchone()
            nombre = u["nombre"] if u else str(asignado_a)
        db.execute(
            "UPDATE tickets SET asignado_a=?, estado='en_proceso', actualizado_en=datetime('now') "
            "WHERE id=?",
            (asignado_a, ticket_id),
        )
        _log(db, ticket_id, usuario["id"], "asignado",
             str(t["asignado_a"]), str(asignado_a), f"Asignado a {nombre}")
        _log(db, ticket_id, usuario["id"], "estado_cambiado", t["estado"], "en_proceso")
        db.commit()
        return True, None


def agregar_comentario(ticket_id: int, usuario_id: int,
                       texto: str, es_interno: bool = False) -> bool:
    with _conn() as db:
        db.execute(
            "INSERT INTO comentarios_tickets (ticket_id, usuario_id, texto, es_interno) VALUES (?,?,?,?)",
            (ticket_id, usuario_id, texto, 1 if es_interno else 0),
        )
        _log(db, ticket_id, usuario_id, "comentario_agregado", detalles=texto[:100])
        db.execute("UPDATE tickets SET actualizado_en=datetime('now') WHERE id=?", (ticket_id,))
        db.commit()
        return True


def registrar_tiempo(ticket_id: int, usuario_id: int,
                     horas: float, notas: str = "") -> bool:
    with _conn() as db:
        db.execute(
            "INSERT INTO bitacora_tiempo (ticket_id, usuario_id, horas, notas) VALUES (?,?,?,?)",
            (ticket_id, usuario_id, horas, notas),
        )
        _log(db, ticket_id, usuario_id, "tiempo_registrado", detalles=f"{horas}h - {notas}")
        db.commit()
        return True


def dashboard_carga() -> list:
    with _conn() as db:
        uids = [r["id"] for r in db.execute("SELECT id FROM usuarios WHERE activo=1").fetchall()]
        result = []
        for uid in uids:
            u = _usuario_full(db, uid)
            u["tickets_abiertos"] = db.execute(
                "SELECT COUNT(*) as n FROM tickets WHERE asignado_a=? "
                "AND estado NOT IN ('resuelto','rechazado')", (uid,)
            ).fetchone()["n"]
            u["resueltos_semana"] = db.execute(
                "SELECT COUNT(*) as n FROM tickets WHERE asignado_a=? "
                "AND estado='resuelto' AND resuelto_en >= datetime('now','-7 days')", (uid,)
            ).fetchone()["n"]
            u["total_horas"] = db.execute(
                "SELECT COALESCE(SUM(horas),0) as h FROM bitacora_tiempo WHERE usuario_id=?",
                (uid,),
            ).fetchone()["h"]
            result.append(u)
        return sorted(result, key=lambda x: x["tickets_abiertos"], reverse=True)


# ── PASOS DE TICKET ───────────────────────────────────────────────────────────

def _insertar_pasos_ticket(db, ticket_id: int, pasos_raw) -> None:
    """Crea filas en ticket_pasos desde lista de strings o dicts con descripcion."""
    if not pasos_raw:
        return
    orden = 0
    for p in pasos_raw:
        notas = None
        if isinstance(p, str):
            desc = p.strip()
        elif isinstance(p, dict):
            desc = (p.get("descripcion") or p.get("texto") or "").strip()
            raw_n = (p.get("notas") or "").strip()
            notas = raw_n or None
        else:
            continue
        if not desc:
            continue
        orden += 1
        db.execute(
            "INSERT INTO ticket_pasos (ticket_id, orden, descripcion, notas) VALUES (?,?,?,?)",
            (ticket_id, orden, desc, notas),
        )


def listar_pasos(ticket_id: int) -> list:
    with _conn() as db:
        rows = db.execute("""
            SELECT p.*, u.nombre AS completado_por_nombre
            FROM ticket_pasos p
            LEFT JOIN usuarios u ON u.id = p.completado_por
            WHERE p.ticket_id = ? ORDER BY p.orden
        """, (ticket_id,)).fetchall()
        return [dict(r) for r in rows]


def agregar_paso(ticket_id: int, descripcion: str, usuario_id: int, notas: str = None) -> tuple:
    descripcion = descripcion.strip()
    if not descripcion:
        return None, "Descripción requerida"
    notas_val = (notas or "").strip() or None
    with _conn() as db:
        t = db.execute("SELECT id FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        if not t:
            return None, "Ticket no encontrado"
        orden = db.execute(
            "SELECT COALESCE(MAX(orden),0)+1 AS n FROM ticket_pasos WHERE ticket_id=?", (ticket_id,)
        ).fetchone()["n"]
        db.execute(
            "INSERT INTO ticket_pasos (ticket_id, orden, descripcion, notas) VALUES (?,?,?,?)",
            (ticket_id, orden, descripcion, notas_val),
        )
        db.commit()
        return listar_pasos(ticket_id), None


def actualizar_paso_notas(ticket_id: int, paso_id: int, notas: str) -> tuple:
    notas_val = (notas or "").strip() or None
    with _conn() as db:
        row = db.execute(
            "SELECT id FROM ticket_pasos WHERE id=? AND ticket_id=?",
            (paso_id, ticket_id),
        ).fetchone()
        if not row:
            return None, "Paso no encontrado en este ticket"
        db.execute("UPDATE ticket_pasos SET notas=? WHERE id=?", (notas_val, paso_id))
        db.commit()
    return listar_pasos(ticket_id), None


def _pasos_checklist_completo(db, ticket_id: int) -> bool:
    row = db.execute(
        """
        SELECT COUNT(*) AS n, SUM(CASE WHEN completado=1 THEN 1 ELSE 0 END) AS ok
        FROM ticket_pasos WHERE ticket_id=?
        """,
        (ticket_id,),
    ).fetchone()
    n = int(row["n"] or 0)
    if n == 0:
        return False
    return int(row["ok"] or 0) >= n


def _resolver_ticket_si_pasos_completos(db, ticket_id: int, usuario_id: int) -> bool:
    """Si todos los pasos están marcados, cierra el ticket como resuelto."""
    if not _pasos_checklist_completo(db, ticket_id):
        return False
    t = db.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
    if not t or t["estado"] in ("resuelto", "rechazado"):
        return False

    prev = t["estado"]
    blocked_deps = db.execute(
        "SELECT id FROM tickets WHERE bloqueado_por=?", (ticket_id,),
    ).fetchall()
    db.execute(
        "UPDATE tickets SET estado='resuelto', resuelto_en=datetime('now'), "
        "actualizado_en=datetime('now') WHERE id=?",
        (ticket_id,),
    )
    _log(
        db, ticket_id, usuario_id, "estado_cambiado", prev, "resuelto",
        "Checklist completado — cierre automático",
    )
    for dep in blocked_deps:
        db.execute(
            "UPDATE tickets SET bloqueado_por=NULL, estado='en_proceso', "
            "actualizado_en=datetime('now') WHERE id=?",
            (dep["id"],),
        )
        db.execute(
            "UPDATE etapas_mision SET estado='activa' WHERE ticket_id=?", (dep["id"],),
        )
        _log(
            db, dep["id"], usuario_id, "estado_cambiado", "bloqueado", "en_proceso",
            "Desbloqueado al resolver la etapa anterior",
        )
    if t["mision_id"]:
        _actualizar_mision(db, t["mision_id"])
    _programar_renovacion_ticket(db, ticket_id)
    return True


def completar_paso(paso_id: int, usuario_id: int) -> tuple:
    auto_resuelto = False
    ticket_id = None
    with _conn() as db:
        p = db.execute("SELECT * FROM ticket_pasos WHERE id=?", (paso_id,)).fetchone()
        if not p:
            return None, "Paso no encontrado", False
        ticket_id = p["ticket_id"]
        actual = int(p["completado"] or 0)
        nuevo = 0 if actual else 1
        db.execute(
            "UPDATE ticket_pasos SET completado=?, completado_en=?, completado_por=? WHERE id=?",
            (nuevo, datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S") if nuevo else None,
             usuario_id if nuevo else None, paso_id)
        )
        if nuevo == 1:
            t = db.execute(
                "SELECT estado, bloqueado_por FROM tickets WHERE id=?",
                (ticket_id,),
            ).fetchone()
            if t and t["estado"] == "pendiente":
                db.execute(
                    "UPDATE tickets SET estado='en_proceso', actualizado_en=datetime('now') WHERE id=?",
                    (ticket_id,),
                )
            auto_resuelto = _resolver_ticket_si_pasos_completos(db, ticket_id, usuario_id)
        db.commit()
    if auto_resuelto and ticket_id:
        from app.services.ticket_timing import finalizar_corridas_abiertas_ticket
        finalizar_corridas_abiertas_ticket(ticket_id)
    return listar_pasos(ticket_id), None, auto_resuelto


def completar_paso_ticket(ticket_id: int, paso_id: int, usuario_id: int) -> tuple:
    with _conn() as db:
        row = db.execute(
            "SELECT id FROM ticket_pasos WHERE id=? AND ticket_id=?",
            (paso_id, ticket_id),
        ).fetchone()
        if not row:
            return None, "Paso no encontrado en este ticket", False
    return completar_paso(paso_id, usuario_id)


def establecer_paso_completado(
    ticket_id: int, paso_id: int, usuario_id: int, completado: int,
) -> tuple:
    """Marca o desmarca un paso (0/1) sin depender del toggle."""
    nuevo = 1 if int(completado or 0) else 0
    auto_resuelto = False
    with _conn() as db:
        row = db.execute(
            "SELECT id, ticket_id FROM ticket_pasos WHERE id=? AND ticket_id=?",
            (paso_id, ticket_id),
        ).fetchone()
        if not row:
            return None, "Paso no encontrado en este ticket", False
        db.execute(
            "UPDATE ticket_pasos SET completado=?, completado_en=?, completado_por=? WHERE id=?",
            (
                nuevo,
                datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S") if nuevo else None,
                usuario_id if nuevo else None,
                paso_id,
            ),
        )
        if nuevo == 1:
            t = db.execute(
                "SELECT estado FROM tickets WHERE id=?", (ticket_id,),
            ).fetchone()
            if t and t["estado"] == "pendiente":
                db.execute(
                    "UPDATE tickets SET estado='en_proceso', actualizado_en=datetime('now') WHERE id=?",
                    (ticket_id,),
                )
            auto_resuelto = _resolver_ticket_si_pasos_completos(db, ticket_id, usuario_id)
        db.commit()
    if auto_resuelto:
        from app.services.ticket_timing import finalizar_corridas_abiertas_ticket
        finalizar_corridas_abiertas_ticket(ticket_id)
    return listar_pasos(ticket_id), None, auto_resuelto


def _pasos_conteo_ticket(db, ticket_id: int) -> tuple[int, int]:
    row = db.execute(
        """
        SELECT COUNT(*) AS n,
               SUM(CASE WHEN completado = 1 THEN 1 ELSE 0 END) AS ok
        FROM ticket_pasos WHERE ticket_id=?
        """,
        (ticket_id,),
    ).fetchone()
    return int(row["n"] or 0), int(row["ok"] or 0)


def pasos_ticket_json(ticket_id: int, pasos: list, auto_resuelto: bool = False) -> dict:
    with _conn() as db:
        row = db.execute("SELECT estado FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        total, ok = _pasos_conteo_ticket(db, ticket_id)
    return {
        "pasos": pasos,
        "estado": row["estado"] if row else None,
        "auto_resuelto": bool(auto_resuelto),
        "pasos_total": total,
        "pasos_completados": ok,
    }


def eliminar_paso(paso_id: int) -> tuple:
    with _conn() as db:
        p = db.execute("SELECT ticket_id FROM ticket_pasos WHERE id=?", (paso_id,)).fetchone()
        if not p:
            return None, "Paso no encontrado"
        tid = p["ticket_id"]
        db.execute("DELETE FROM ticket_pasos WHERE id=?", (paso_id,))
        db.commit()
        return listar_pasos(tid), None


def reordenar_pasos(ticket_id: int, paso_ids: list) -> tuple:
    with _conn() as db:
        existing = {r["id"] for r in db.execute(
            "SELECT id FROM ticket_pasos WHERE ticket_id=?", (ticket_id,)
        ).fetchall()}
        if set(paso_ids) != existing:
            return None, "Lista de pasos inválida"
        for i, pid in enumerate(paso_ids, 1):
            db.execute("UPDATE ticket_pasos SET orden=? WHERE id=?", (i, pid))
        db.commit()
        return listar_pasos(ticket_id), None


# ── MATERIALES CATÁLOGO ────────────────────────────────────────────────────────

def _generar_numero_oc(db) -> str:
    year = datetime.utcnow().year
    max_n = db.execute(
        "SELECT MAX(CAST(SUBSTR(numero,10) AS INTEGER)) AS n FROM ordenes_compra WHERE numero LIKE ?",
        (f"OC-{year}-%",)
    ).fetchone()["n"] or 0
    return f"OC-{year}-{max_n+1:04d}"


def _parse_zona_ids(data: dict) -> list[int] | None:
    if "zona_ids" not in data:
        return None
    raw = data.get("zona_ids")
    if not isinstance(raw, list):
        return []
    ids = []
    for x in raw:
        try:
            ids.append(int(x))
        except (TypeError, ValueError):
            continue
    return ids


def _set_material_zonas(db, material_id: int, zona_ids: list[int]) -> None:
    db.execute("DELETE FROM material_zonas WHERE material_id=?", (material_id,))
    for zid in zona_ids:
        if db.execute(
            "SELECT id FROM zonas_trabajo WHERE id=? AND activo=1", (zid,)
        ).fetchone():
            db.execute(
                "INSERT OR IGNORE INTO material_zonas (material_id, zona_id) VALUES (?,?)",
                (material_id, zid),
            )


def _zonas_map_for_materials(db, material_ids: list[int]) -> dict[int, list]:
    if not material_ids:
        return {}
    ph = ",".join("?" * len(material_ids))
    rows = db.execute(
        f"""
        SELECT mz.material_id, z.id, z.nombre, z.parent_id, p.nombre AS parent_nombre
        FROM material_zonas mz
        JOIN zonas_trabajo z ON z.id = mz.zona_id AND z.activo = 1
        LEFT JOIN zonas_trabajo p ON p.id = z.parent_id AND p.activo = 1
        WHERE mz.material_id IN ({ph})
        ORDER BY COALESCE(z.parent_id, z.id), z.parent_id IS NOT NULL, z.orden, z.nombre
        """,
        material_ids,
    ).fetchall()
    out: dict[int, list] = {}
    for r in rows:
        d = dict(r)
        mid = d.pop("material_id")
        out.setdefault(mid, []).append(d)
    return out


def _zona_tiene_subzonas_activas(db, zona_id: int) -> bool:
    """True si la zona tiene hijos explícitamente marcados como subzona."""
    row = db.execute(
        """
        SELECT 1 FROM zonas_trabajo
        WHERE parent_id=? AND activo=1
          AND LOWER(COALESCE(tipo,''))='subzona'
        LIMIT 1
        """,
        (zona_id,),
    ).fetchone()
    if row:
        return True
    for r in db.execute(
        "SELECT id FROM zonas_trabajo WHERE parent_id=? AND activo=1", (zona_id,)
    ).fetchall():
        if _zona_tipo(db, r["id"]) == "subzona":
            return True
    return False


def _zona_nivel(db, zona_id: int) -> int:
    """Compatibilidad numérica: preferir _zona_tipo para reglas de negocio."""
    tipo = _zona_tipo(db, zona_id)
    if tipo == "reino":
        return 0
    if tipo == "zona":
        return 1
    if tipo == "subzona":
        return 2
    if tipo == "departamento":
        row = db.execute(
            "SELECT parent_id FROM zonas_trabajo WHERE id=?", (zona_id,)
        ).fetchone()
        if row and row["parent_id"] and _zona_tipo(db, row["parent_id"]) == "zona":
            return 2
        return 3
    return _zona_profundidad_arbol(db, zona_id)


def _zona_profundidad(db, zona_id: int) -> int:
    """Alias de _zona_nivel."""
    return _zona_nivel(db, zona_id)


def _zona_descendientes_ids(db, zona_id: int, solo_activas: bool = True) -> list[int]:
    ids = [zona_id]
    queue = [zona_id]
    activo_sql = " AND activo=1" if solo_activas else ""
    while queue:
        pid = queue.pop(0)
        hijos = db.execute(
            f"SELECT id FROM zonas_trabajo WHERE parent_id=?{activo_sql}", (pid,)
        ).fetchall()
        for h in hijos:
            ids.append(h["id"])
            queue.append(h["id"])
    return ids


def _zona_nombre_ocupado(db, nombre: str, parent_id: int | None, excluir_id: int | None = None) -> bool:
    if parent_id:
        q = "SELECT 1 FROM zonas_trabajo WHERE activo=1 AND parent_id=? AND nombre=?"
        params: list = [parent_id, nombre]
    else:
        q = "SELECT 1 FROM zonas_trabajo WHERE activo=1 AND parent_id IS NULL AND nombre=?"
        params = [nombre]
    if excluir_id is not None:
        q += " AND id!=?"
        params.append(excluir_id)
    return bool(db.execute(q, params).fetchone())


def _get_zona_row(db, zona_id: int) -> dict | None:
    r = db.execute(
        """
        SELECT z.*, p.nombre AS parent_nombre
        FROM zonas_trabajo z
        LEFT JOIN zonas_trabajo p ON p.id = z.parent_id
        WHERE z.id=?
        """,
        (zona_id,),
    ).fetchone()
    return dict(r) if r else None


def listar_zonas_trabajo(solo_activas: bool = True) -> list:
    with _conn() as db:
        q = """
            SELECT z.*, p.nombre AS parent_nombre
            FROM zonas_trabajo z
            LEFT JOIN zonas_trabajo p ON p.id = z.parent_id
        """
        if solo_activas:
            q += " WHERE z.activo=1"
        q += " ORDER BY COALESCE(z.parent_id, z.id), z.parent_id IS NOT NULL, z.orden, z.nombre"
        return [dict(r) for r in db.execute(q).fetchall()]


def crear_zona_trabajo(data: dict) -> tuple:
    nombre = (data.get("nombre") or "").strip()
    if not nombre:
        return None, "Nombre requerido"
    parent_id = data.get("parent_id")
    try:
        parent_id = int(parent_id) if parent_id not in (None, "", 0) else None
    except (TypeError, ValueError):
        return None, "parent_id inválido"
    nivel = (data.get("nivel") or "").strip().lower()
    with _conn() as db:
        if nivel == "reino":
            if parent_id is not None:
                return None, "Un reino no lleva zona padre"
            parent_id = None
        elif nivel == "zona":
            if parent_id is None:
                return None, "Indica el reino padre"
            padre = db.execute(
                "SELECT id FROM zonas_trabajo WHERE id=? AND activo=1", (parent_id,)
            ).fetchone()
            if not padre:
                return None, "Reino padre no encontrado"
            if _zona_tipo(db, parent_id) != "reino":
                return None, "La zona debe crearse bajo un reino (nivel raíz)"
        elif nivel == "subzona":
            if parent_id is None:
                return None, "Indica la zona padre"
            padre = db.execute(
                "SELECT id FROM zonas_trabajo WHERE id=? AND activo=1", (parent_id,)
            ).fetchone()
            if not padre:
                return None, "Zona padre no encontrada"
            tipo_padre = _zona_tipo(db, parent_id)
            if tipo_padre == "reino":
                return None, (
                    "La subzona no puede ir directo bajo el reino. "
                    "Primero crea una zona en ese reino y luego la subzona bajo esa zona."
                )
            if tipo_padre != "zona":
                return None, "La subzona debe crearse bajo una zona"
        elif nivel == "departamento":
            if parent_id is None:
                return None, "Indica la zona o subzona padre"
            padre = db.execute(
                "SELECT id FROM zonas_trabajo WHERE id=? AND activo=1", (parent_id,)
            ).fetchone()
            if not padre:
                return None, "Zona o subzona padre no encontrada"
            tipo_padre = _zona_tipo(db, parent_id)
            if tipo_padre == "zona":
                if _zona_tiene_subzonas_activas(db, parent_id):
                    return None, (
                        "Esta zona ya tiene subzonas: crea el departamento bajo la subzona. "
                        "Si no usas subzonas (ej. Hogar Dulce Hogar), crea labores directo bajo la zona."
                    )
            elif tipo_padre == "subzona":
                pass
            elif tipo_padre in ("reino", "departamento"):
                return None, "El departamento va bajo una zona o subzona"
            else:
                return None, "El departamento va bajo una zona o subzona"
        elif parent_id is not None:
            padre = db.execute(
                "SELECT id, parent_id FROM zonas_trabajo WHERE id=? AND activo=1", (parent_id,)
            ).fetchone()
            if not padre:
                return None, "Zona padre no encontrada"
            if _zona_nivel(db, parent_id) >= 3:
                return None, (
                    "No se pueden crear más niveles "
                    "(máx: reino → zona → subzona → departamento)"
                )
        if _zona_nombre_ocupado(db, nombre, parent_id):
            return None, "Ya existe una zona o subárea con ese nombre en el mismo nivel"
        tipo_guardar = nivel if nivel in ("reino", "zona", "subzona", "departamento") else _inferir_tipo_zona(db, parent_id) if parent_id else "reino"
        _PALETTE = (
            "#0c6069", "#2563eb", "#7c3aed", "#db2777", "#ea580c",
            "#16a34a", "#0d9488", "#ca8a04", "#dc2626", "#4f46e5",
            "#0891b2", "#65a30d", "#c026d3", "#f59e0b",
        )
        color = (data.get("color") or "").strip()
        if not color:
            if parent_id is None:
                n = db.execute(
                    "SELECT COUNT(*) AS n FROM zonas_trabajo WHERE parent_id IS NULL AND activo=1"
                ).fetchone()["n"]
            else:
                n = db.execute(
                    "SELECT COUNT(*) AS n FROM zonas_trabajo WHERE parent_id=? AND activo=1",
                    (parent_id,),
                ).fetchone()["n"]
            color = _PALETTE[int(n) % len(_PALETTE)]
        try:
            db.execute(
                """
                INSERT INTO zonas_trabajo (nombre, parent_id, descripcion, color, icono, orden, tipo)
                VALUES (?,?,?,?,?,?,?)
                """,
                (nombre, parent_id, "", color, "🏭", int(data.get("orden") or 0), tipo_guardar),
            )
            zid = db.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
            if nivel == "departamento":
                slug = _slug_departamento(nombre)
                dept_color = (data.get("color") or color or "#0c6069").strip()
                icono = (data.get("icono") or "🏢").strip()
                db.execute(
                    "INSERT OR IGNORE INTO categorias (slug, nombre, color, icono) VALUES (?,?,?,?)",
                    (slug, nombre, dept_color, icono),
                )
            db.commit()
            return _get_zona_row(db, zid), None
        except Exception as exc:
            return None, str(exc)


def actualizar_zona_trabajo(zona_id: int, data: dict) -> tuple:
    with _conn() as db:
        actual = db.execute(
            "SELECT id, parent_id FROM zonas_trabajo WHERE id=?", (zona_id,)
        ).fetchone()
        if not actual:
            return None, "Zona no encontrada"
        campos = {}
        if "nombre" in data and data["nombre"] is not None:
            nombre = str(data["nombre"]).strip()
            if not nombre:
                return None, "Nombre requerido"
            if _zona_nombre_ocupado(db, nombre, actual["parent_id"], excluir_id=zona_id):
                return None, "Ya existe una zona o subárea con ese nombre en el mismo nivel"
            campos["nombre"] = nombre
        for k in ("descripcion", "color", "icono", "orden"):
            if k in data and data[k] is not None:
                campos[k] = data[k]
        if "activo" in data:
            campos["activo"] = 1 if data["activo"] in (1, True, "1", "true") else 0
        if "orden" in campos:
            try:
                campos["orden"] = int(campos["orden"])
            except (TypeError, ValueError):
                return None, "orden debe ser entero"
        if campos:
            set_cl = ", ".join(f"{k}=?" for k in campos)
            db.execute(f"UPDATE zonas_trabajo SET {set_cl} WHERE id=?", (*campos.values(), zona_id))
        db.commit()
        return _get_zona_row(db, zona_id), None


def eliminar_zona_trabajo(zona_id: int) -> tuple:
    """Archiva zona (activo=0), quita vínculos en material_zonas; si es principal, archiva subáreas."""
    with _conn() as db:
        row = db.execute(
            "SELECT id, nombre, parent_id FROM zonas_trabajo WHERE id=? AND activo=1", (zona_id,)
        ).fetchone()
        if not row:
            return None, "Zona no encontrada o ya eliminada"
        ids = _zona_descendientes_ids(db, zona_id, solo_activas=True)
        ph = ",".join("?" * len(ids))
        db.execute(f"DELETE FROM material_zonas WHERE zona_id IN ({ph})", ids)
        db.execute(f"UPDATE zonas_trabajo SET activo=0 WHERE id IN ({ph})", ids)
        db.commit()
        return {"id": zona_id, "nombre": row["nombre"], "archivadas": ids}, None


def listar_materiales(solo_activos: bool = True, zona_id: int | None = None) -> list:
    with _conn() as db:
        conds, params = [], []
        if solo_activos:
            conds.append("activo=1")
        if zona_id is not None:
            conds.append(
                """id IN (
                    SELECT material_id FROM material_zonas WHERE zona_id=?
                    UNION
                    SELECT mz.material_id FROM material_zonas mz
                    JOIN zonas_trabajo z ON z.id = mz.zona_id AND z.activo=1
                    WHERE z.parent_id=?
                )"""
            )
            params.extend([zona_id, zona_id])
        q = "SELECT * FROM materiales_catalogo"
        if conds:
            q += " WHERE " + " AND ".join(conds)
        q += " ORDER BY nombre"
        mats = [dict(r) for r in db.execute(q, params).fetchall()]
        zmap = _zonas_map_for_materials(db, [m["id"] for m in mats])
        for m in mats:
            m["zonas"] = zmap.get(m["id"], [])
        return mats


def get_material(material_id: int) -> dict | None:
    with _conn() as db:
        r = db.execute("SELECT * FROM materiales_catalogo WHERE id=?", (material_id,)).fetchone()
        if not r:
            return None
        m = dict(r)
        m["zonas"] = _zonas_map_for_materials(db, [material_id]).get(material_id, [])
        return m


def crear_material(data: dict) -> tuple:
    nombre = (data.get("nombre") or "").strip()
    if not nombre:
        return None, "Nombre requerido"
    tipo = _normalizar_tipo_material(data.get("tipo"))
    if tipo not in MATERIAL_TIPOS_VALIDOS:
        return None, "tipo debe ser uno de: materia_prima, elaborado, consumibles, repuestos, herramientas"
    mision_origen_id = data.get("mision_origen_id") or None
    with _conn() as db:
        try:
            db.execute("""
                INSERT INTO materiales_catalogo
                    (nombre, descripcion, unidad, stock_actual, stock_minimo,
                     precio_unitario, proveedor, tipo, mision_origen_id)
                VALUES (?,?,?,?,?,?,?,?,?)
            """, (
                nombre,
                data.get("descripcion") or "",
                data.get("unidad") or "unidad",
                float(data.get("stock_actual") or 0),
                float(data.get("stock_minimo") or 0),
                float(data.get("precio_unitario") or 0),
                data.get("proveedor") or "",
                tipo,
                int(mision_origen_id) if mision_origen_id else None,
            ))
            mid = db.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
            zona_ids = _parse_zona_ids(data)
            if zona_ids is not None:
                _set_material_zonas(db, mid, zona_ids)
            db.commit()
            return get_material(mid), None
        except Exception as exc:
            return None, str(exc)


def actualizar_material(material_id: int, data: dict) -> tuple:
    with _conn() as db:
        m = db.execute("SELECT id FROM materiales_catalogo WHERE id=?", (material_id,)).fetchone()
        if not m:
            return None, "Material no encontrado"
        campos = {}
        for k in ("nombre", "descripcion", "unidad", "proveedor", "tipo"):
            if k in data and data[k] is not None:
                campos[k] = data[k]
        if "activo" in data:
            campos["activo"] = 1 if data["activo"] in (1, True, "1", "true") else 0
        if "tipo" in campos:
            campos["tipo"] = _normalizar_tipo_material(campos["tipo"])
            if campos["tipo"] not in MATERIAL_TIPOS_VALIDOS:
                return None, "tipo debe ser uno de: materia_prima, elaborado, consumibles, repuestos, herramientas"
        for k in ("stock_minimo", "precio_unitario", "stock_actual"):
            if k in data and data[k] is not None:
                try:
                    campos[k] = float(data[k])
                except (TypeError, ValueError):
                    return None, f"{k} debe ser numérico"
        if "stock_actual" in campos and campos["stock_actual"] < 0:
            return None, "stock_actual no puede ser negativo"
        if "stock_minimo" in campos and campos["stock_minimo"] < 0:
            return None, "stock_minimo no puede ser negativo"
        if campos:
            set_cl = ", ".join(f"{k}=?" for k in campos)
            db.execute(
                f"UPDATE materiales_catalogo SET {set_cl}, actualizado_en=datetime('now') WHERE id=?",
                (*campos.values(), material_id)
            )
        zona_ids = _parse_zona_ids(data)
        if zona_ids is not None:
            _set_material_zonas(db, material_id, zona_ids)
        db.commit()
        return get_material(material_id), None


def eliminar_materiales_catalogo(ids: list[int]) -> tuple:
    """Archiva materiales del catálogo (activo=0). No borra filas por referencias históricas."""
    clean = []
    for i in ids:
        try:
            clean.append(int(i))
        except (TypeError, ValueError):
            continue
    if not clean:
        return None, "Sin IDs válidos"
    with _conn() as db:
        ph = ",".join("?" * len(clean))
        rows = db.execute(
            f"SELECT id, nombre FROM materiales_catalogo WHERE id IN ({ph}) AND activo=1",
            clean,
        ).fetchall()
        found = {r["id"] for r in rows}
        eliminados = []
        errores = []
        for i in clean:
            if i not in found:
                errores.append({"id": i, "error": "No encontrado o ya eliminado"})
        for r in rows:
            db.execute(
                "UPDATE materiales_catalogo SET activo=0, actualizado_en=datetime('now') WHERE id=?",
                (r["id"],),
            )
            eliminados.append({"id": r["id"], "nombre": r["nombre"]})
        db.commit()
        return {"eliminados": eliminados, "errores": errores}, None


# ── MATERIALES DE TICKET ───────────────────────────────────────────────────────

def listar_materiales_ticket(ticket_id: int) -> list:
    with _conn() as db:
        rows = db.execute("""
            SELECT tm.*, mc.nombre, mc.unidad, mc.stock_actual, mc.precio_unitario, mc.tipo
            FROM ticket_materiales tm
            JOIN materiales_catalogo mc ON mc.id = tm.material_id
            WHERE tm.ticket_id = ?
            ORDER BY mc.nombre
        """, (ticket_id,)).fetchall()
        items = [dict(r) for r in rows]
        zmap = _zonas_map_for_materials(db, [i["material_id"] for i in items])
        for it in items:
            it["zonas"] = zmap.get(it["material_id"], [])
        return items


def agregar_material_ticket(ticket_id: int, material_id: int, cantidad: float, notas: str = None) -> tuple:
    if cantidad <= 0:
        return None, "Cantidad debe ser mayor a 0"
    with _conn() as db:
        try:
            db.execute(
                "INSERT INTO ticket_materiales (ticket_id, material_id, cantidad_requerida, notas) VALUES (?,?,?,?)",
                (ticket_id, material_id, cantidad, notas)
            )
            db.commit()
            return listar_materiales_ticket(ticket_id), None
        except Exception as exc:
            return None, "Material ya está en este ticket" if "UNIQUE" in str(exc) else str(exc)


def actualizar_material_ticket(tm_id: int, cantidad: float = None, notas: str = None) -> tuple:
    with _conn() as db:
        tm = db.execute("SELECT ticket_id, cantidad_requerida, notas FROM ticket_materiales WHERE id=?", (tm_id,)).fetchone()
        if not tm:
            return None, "No encontrado"
        
        cant = cantidad if cantidad is not None else tm["cantidad_requerida"]
        note = notas if notas is not None else tm["notas"]
        
        if cant <= 0:
            return None, "Cantidad debe ser mayor a 0"

        db.execute("UPDATE ticket_materiales SET cantidad_requerida=?, notas=? WHERE id=?", (cant, note, tm_id))
        db.commit()
        return listar_materiales_ticket(tm["ticket_id"]), None


def eliminar_material_ticket(tm_id: int) -> tuple:
    with _conn() as db:
        tm = db.execute("SELECT ticket_id FROM ticket_materiales WHERE id=?", (tm_id,)).fetchone()
        if not tm:
            return None, "No encontrado"
        tid = tm["ticket_id"]
        db.execute("DELETE FROM ticket_materiales WHERE id=?", (tm_id,))
        db.commit()
        return listar_materiales_ticket(tid), None


def get_observaciones_materiales(ticket_id: int) -> tuple:
    with _conn() as db:
        r = db.execute(
            "SELECT observaciones_materiales FROM tickets WHERE id=?", (ticket_id,)
        ).fetchone()
        if not r:
            return None, "Ticket no encontrado"
        return {"observaciones": r["observaciones_materiales"] or ""}, None


def set_observaciones_materiales(ticket_id: int, texto: str) -> tuple:
    with _conn() as db:
        if not db.execute("SELECT id FROM tickets WHERE id=?", (ticket_id,)).fetchone():
            return None, "Ticket no encontrado"
        note = (texto or "").strip()
        db.execute(
            "UPDATE tickets SET observaciones_materiales=?, actualizado_en=datetime('now') WHERE id=?",
            (note, ticket_id),
        )
        db.commit()
        return {"observaciones": note}, None


# ── CONSUMO Y STOCK ────────────────────────────────────────────────────────────

def registrar_consumo(ticket_id: int | None, material_id: int, cantidad: float,
                      tipo: str, notas: str, usuario_id: int) -> tuple:
    with _conn() as db:
        m = db.execute("SELECT * FROM materiales_catalogo WHERE id=?", (material_id,)).fetchone()
        if not m:
            return None, "Material no encontrado"
        if tipo in ("consumo", "ajuste_salida"):
            nuevo_stock = max(0, m["stock_actual"] - cantidad)
        elif tipo in ("ajuste_entrada", "devolucion"):
            nuevo_stock = m["stock_actual"] + cantidad
        else:
            return None, "Tipo inválido"
        db.execute(
            "INSERT INTO consumo_materiales (ticket_id, material_id, cantidad, tipo, notas, registrado_por) "
            "VALUES (?,?,?,?,?,?)",
            (ticket_id, material_id, cantidad, tipo, notas or "", usuario_id)
        )
        db.execute(
            "UPDATE materiales_catalogo SET stock_actual=?, actualizado_en=datetime('now') WHERE id=?",
            (nuevo_stock, material_id)
        )
        # Auto-generate purchase order if stock drops below minimum
        oc_generada = None
        if nuevo_stock < m["stock_minimo"] and m["stock_minimo"] > 0:
            ya_existe = db.execute(
                "SELECT id FROM ordenes_compra WHERE material_id=? AND estado='pendiente'",
                (material_id,)
            ).fetchone()
            if not ya_existe:
                num = _generar_numero_oc(db)
                cantidad_oc = m["stock_minimo"] * 2 - nuevo_stock
                db.execute("""
                    INSERT INTO ordenes_compra
                        (numero, material_id, cantidad, precio_unitario, proveedor, notas, creado_por)
                    VALUES (?,?,?,?,?,?,?)
                """, (
                    num, material_id, max(cantidad_oc, cantidad),
                    m["precio_unitario"], m["proveedor"] or "",
                    f"Generada automáticamente — stock bajo ({nuevo_stock} {m['unidad']} < mínimo {m['stock_minimo']})",
                    usuario_id
                ))
                oc_generada = num
        db.commit()
        return {"stock_nuevo": nuevo_stock, "oc_generada": oc_generada}, None


def historial_consumo(material_id: int | None = None, ticket_id: int | None = None, limit: int = 50) -> list:
    with _conn() as db:
        q = """
            SELECT c.*, mc.nombre AS material_nombre, mc.unidad,
                   u.nombre AS registrado_por_nombre, t.numero AS ticket_numero
            FROM consumo_materiales c
            JOIN materiales_catalogo mc ON mc.id = c.material_id
            LEFT JOIN usuarios u ON u.id = c.registrado_por
            LEFT JOIN tickets t ON t.id = c.ticket_id
            WHERE 1=1
        """
        params = []
        if material_id:
            q += " AND c.material_id=?"; params.append(material_id)
        if ticket_id:
            q += " AND c.ticket_id=?"; params.append(ticket_id)
        q += f" ORDER BY c.creado_en DESC LIMIT {limit}"
        return [dict(r) for r in db.execute(q, params).fetchall()]


# ── ÓRDENES DE COMPRA ─────────────────────────────────────────────────────────

def listar_ordenes_compra(estado: str | None = None) -> list:
    with _conn() as db:
        q = """
            SELECT oc.*, mc.nombre AS material_nombre, mc.unidad,
                   u.nombre AS creado_por_nombre
            FROM ordenes_compra oc
            JOIN materiales_catalogo mc ON mc.id = oc.material_id
            LEFT JOIN usuarios u ON u.id = oc.creado_por
            WHERE 1=1
        """
        params = []
        if estado:
            q += " AND oc.estado=?"; params.append(estado)
        q += " ORDER BY oc.creado_en DESC"
        return [dict(r) for r in db.execute(q, params).fetchall()]


def crear_orden_compra(material_id: int, cantidad: float, precio_unitario: float,
                       proveedor: str, notas: str, usuario_id: int) -> tuple:
    if cantidad <= 0:
        return None, "Cantidad debe ser mayor a 0"
    with _conn() as db:
        m = db.execute("SELECT id FROM materiales_catalogo WHERE id=?", (material_id,)).fetchone()
        if not m:
            return None, "Material no encontrado"
        num = _generar_numero_oc(db)
        db.execute("""
            INSERT INTO ordenes_compra
                (numero, material_id, cantidad, precio_unitario, proveedor, notas, creado_por)
            VALUES (?,?,?,?,?,?,?)
        """, (num, material_id, cantidad, precio_unitario or 0, proveedor or "", notas or "", usuario_id))
        db.commit()
        ocs = listar_ordenes_compra()
        return next((o for o in ocs if o["numero"] == num), None), None


def actualizar_orden_compra(orden_id: int, data: dict, usuario_id: int) -> tuple:
    with _conn() as db:
        oc = db.execute("SELECT * FROM ordenes_compra WHERE id=?", (orden_id,)).fetchone()
        if not oc:
            return None, "Orden no encontrada"
        nuevo_estado = data.get("estado", oc["estado"])
        campos = {k: v for k, v in data.items()
                  if k in ("estado","cantidad","precio_unitario","proveedor","notas") and v is not None}
        if campos:
            set_cl = ", ".join(f"{k}=?" for k in campos)
            db.execute(f"UPDATE ordenes_compra SET {set_cl} WHERE id=?", (*campos.values(), orden_id))
        # When received: increment stock
        if nuevo_estado == "recibida" and oc["estado"] != "recibida":
            db.execute(
                "UPDATE ordenes_compra SET recibida_en=datetime('now') WHERE id=?", (orden_id,)
            )
            cantidad_recibida = float(data.get("cantidad", oc["cantidad"]))
            db.execute(
                "UPDATE materiales_catalogo SET stock_actual=stock_actual+?, actualizado_en=datetime('now') WHERE id=?",
                (cantidad_recibida, oc["material_id"])
            )
            db.execute(
                "INSERT INTO consumo_materiales (material_id, cantidad, tipo, notas, registrado_por) VALUES (?,?,?,?,?)",
                (oc["material_id"], cantidad_recibida, "ajuste_entrada",
                 f"Recepción de orden {oc['numero']}", usuario_id)
            )
        db.commit()
        return listar_ordenes_compra(), None


# ── CATEGORÍAS ────────────────────────────────────────────────────────────────

def listar_categorias() -> list:
    with _conn() as db:
        rows = db.execute(
            "SELECT * FROM categorias WHERE activo=1 ORDER BY nombre"
        ).fetchall()
        return [dict(r) for r in rows]


def crear_categoria(slug: str, nombre: str, color: str = "#0c6069", icono: str = "📋") -> tuple:
    slug = slug.strip().lower().replace(" ", "_")
    nombre = nombre.strip()
    if not slug or not nombre:
        return None, "slug y nombre son requeridos"
    if not slug.replace("_", "").replace("-", "").isalnum():
        return None, "slug solo puede contener letras, números, _ y -"
    with _conn() as db:
        existing = db.execute("SELECT id FROM categorias WHERE slug=?", (slug,)).fetchone()
        if existing:
            return None, f"Ya existe una categoría con el slug '{slug}'"
        db.execute(
            "INSERT INTO categorias (slug, nombre, color, icono) VALUES (?,?,?,?)",
            (slug, nombre, color, icono),
        )
        db.commit()
        row = db.execute("SELECT * FROM categorias WHERE slug=?", (slug,)).fetchone()
        return dict(row), None


def eliminar_categoria(slug: str) -> tuple:
    if slug in ("rrhh", "logistica", "mantenimiento"):
        return False, "No se pueden eliminar las categorías del sistema"
    with _conn() as db:
        cat = db.execute("SELECT id FROM categorias WHERE slug=?", (slug,)).fetchone()
        if not cat:
            return False, "Categoría no encontrada"
        en_uso = db.execute(
            "SELECT COUNT(*) as n FROM tickets WHERE categoria=?", (slug,)
        ).fetchone()["n"]
        if en_uso:
            return False, f"No se puede eliminar: {en_uso} ticket(s) usan esta categoría"
        db.execute("DELETE FROM categorias WHERE slug=?", (slug,))
        db.commit()
        return True, None
