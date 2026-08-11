import os
import json
import sqlite3
import secrets
from datetime import datetime, timedelta
from werkzeug.security import generate_password_hash, check_password_hash

_HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_HERE, "..", "data", "tickets.db")
UPLOADS_DIR = os.path.join(_HERE, "..", "..", "uploads", "tickets")

# Cuenta de servicio creada por app/tools/sede_sur.py para registrar tickets
# desde WhatsApp. No es una persona con sesión en el panel.
_USERNAME_BOT_SEDE_SUR = "hugo_ia_bot"


def _conn():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
    return c


def _add_col(db, table: str, col: str, defn: str):
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    if table not in tables:
        return
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
        # Fresh database — tables will be created by init_db's executescript; nothing to migrate
        if "misiones" not in tables:
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
            ("contabilidad",  "Contabilidad",     "#0c6069", "🧾"),
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


def _migrate_ticket_paso_duracion():
    """Segundos invertidos en cada paso del checklist."""
    with _conn() as db:
        _add_col(db, "ticket_pasos", "duracion_segundos", "INTEGER")
        db.commit()


def _migrate_ticket_tipo():
    """Columna tipo en tickets: 'ticket' (normal), 'accion' o 'solicitud'."""
    with _conn() as db:
        _add_col(db, "tickets", "tipo", "TEXT NOT NULL DEFAULT 'ticket'")
        db.commit()


def _migrate_ticket_fecha_inicio():
    """Columna fecha_inicio para solicitudes periódicas (YYYY-MM-DD)."""
    with _conn() as db:
        _add_col(db, "tickets", "fecha_inicio", "TEXT")
        db.commit()


def _migrate_usuario_google():
    """Columnas email y google_sub para autenticación OAuth de Google."""
    with _conn() as db:
        _add_col(db, "usuarios", "email", "TEXT")
        _add_col(db, "usuarios", "google_sub", "TEXT")
        db.commit()


def _migrate_usuario_permisos():
    """Columna permisos_secciones: JSON con accesos por sección del panel."""
    with _conn() as db:
        _add_col(db, "usuarios", "permisos_secciones", "TEXT DEFAULT NULL")
        db.commit()


def _migrate_usuario_preferencias_ui():
    """Preferencias visuales del panel por usuario (tema, acento, modo quest)."""
    with _conn() as db:
        _add_col(db, "usuarios", "preferencias_ui", "TEXT DEFAULT NULL")
        db.commit()


def _migrate_ticket_protocolo_id():
    """Vincula tickets/solicitudes con un protocolo estándar reutilizable."""
    with _conn() as db:
        _add_col(db, "tickets", "protocolo_id", "INTEGER")
        db.commit()


def _migrate_protocolos_alcance():
    """Procedimientos personales vs protocolos delegables (global)."""
    with _conn() as db:
        _add_col(db, "protocolos", "alcance", "TEXT DEFAULT 'global'")
        _add_col(db, "protocolos", "lista_compras", "TEXT DEFAULT '[]'")
        db.commit()


def _migrate_ticket_subtipo():
    """subtipo en solicitudes: 'compra' = solo checklist de compras."""
    with _conn() as db:
        _add_col(db, "tickets", "subtipo", "TEXT")
        db.commit()


def _migrate_usuario_telefono():
    """Teléfono WhatsApp del operador para notas de voz del supervisor."""
    with _conn() as db:
        _add_col(db, "usuarios", "telefono", "TEXT")
        db.commit()


def _migrate_usuario_documento_identidad():
    """CC/NIT del operador para cuentas de cobro (emisor en PDF)."""
    with _conn() as db:
        _add_col(db, "usuarios", "documento_identidad", "TEXT")
        db.commit()


def _migrate_pendientes():
    """Tabla de pendientes personales con recordatorio opcional."""
    with _conn() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS pendientes (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                usuario_id          INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
                titulo              TEXT NOT NULL,
                descripcion         TEXT,
                fecha_recordatorio  TEXT,
                estado              TEXT NOT NULL DEFAULT 'pendiente'
                                        CHECK(estado IN ('pendiente','iniciado','descartado')),
                ticket_id           INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
                creado_en           TEXT DEFAULT (datetime('now')),
                actualizado_en      TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_pendientes_usuario ON pendientes(usuario_id);
        """)
        db.commit()


def _migrate_recordatorios():
    """Tabla de recordatorios con repetición configurable."""
    with _conn() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS recordatorios (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                usuario_id       INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
                titulo           TEXT NOT NULL,
                descripcion      TEXT,
                tipo_rep         TEXT NOT NULL DEFAULT 'una_vez'
                                     CHECK(tipo_rep IN
                                       ('una_vez','diario','semanal','mensual','cada_n_dias')),
                proxima_fecha    TEXT NOT NULL,
                cada_n_dias      INTEGER,
                dias_semana      TEXT,
                dias_mes         TEXT,
                activo           INTEGER DEFAULT 1,
                creado_en        TEXT DEFAULT (datetime('now')),
                actualizado_en   TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_recordatorios_usuario
                ON recordatorios(usuario_id, activo);
        """)
        db.commit()


def _migrate_recordatorios_hora():
    """Agrega columna hora a recordatorios."""
    with _conn() as db:
        _add_col(db, "recordatorios", "hora", "TEXT")


def _migrate_recordatorios_bimestral():
    """Amplía el CHECK constraint de recordatorios para incluir 'bimestral'."""
    with _conn() as db:
        sql = db.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='recordatorios'"
        ).fetchone()
        if not sql or "bimestral" in (sql["sql"] or ""):
            return  # ya migrado o tabla inexistente
        db.executescript("""
            PRAGMA foreign_keys = OFF;
            ALTER TABLE recordatorios RENAME TO _recordatorios_old;
            CREATE TABLE recordatorios (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                usuario_id       INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
                titulo           TEXT NOT NULL,
                descripcion      TEXT,
                tipo_rep         TEXT NOT NULL DEFAULT 'una_vez'
                                     CHECK(tipo_rep IN
                                       ('una_vez','diario','semanal','mensual','cada_n_dias','bimestral')),
                proxima_fecha    TEXT NOT NULL,
                cada_n_dias      INTEGER,
                dias_semana      TEXT,
                dias_mes         TEXT,
                activo           INTEGER DEFAULT 1,
                creado_en        TEXT DEFAULT (datetime('now')),
                actualizado_en   TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_recordatorios_usuario
                ON recordatorios(usuario_id, activo);
            INSERT INTO recordatorios SELECT * FROM _recordatorios_old;
            DROP TABLE _recordatorios_old;
            PRAGMA foreign_keys = ON;
        """)
        db.commit()


def _migrate_recordatorios_asignado():
    """Columna asignado_a para recordatorios del equipo."""
    with _conn() as db:
        _add_col(db, "recordatorios", "asignado_a", "INTEGER")
        _add_col(db, "recordatorios", "creado_por", "INTEGER")


def _migrate_adjunto_paso_id():
    """Columna paso_id opcional en ticket_adjuntos para adjuntos por paso."""
    with _conn() as db:
        _add_col(db, "ticket_adjuntos", "paso_id",
                 "INTEGER REFERENCES ticket_pasos(id) ON DELETE CASCADE")
        db.commit()


def _migrate_protocolo_accesos():
    """Tabla de accesos específicos por usuario para procedimientos con alcance 'seleccionado'."""
    with _conn() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS protocolo_accesos (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                protocolo_id INTEGER NOT NULL REFERENCES protocolos(id) ON DELETE CASCADE,
                usuario_id   INTEGER NOT NULL REFERENCES usuarios(id)   ON DELETE CASCADE,
                creado_en    TEXT DEFAULT (datetime('now')),
                UNIQUE(protocolo_id, usuario_id)
            )
        """)
        db.commit()


def _migrate_usuario_departamentos():
    """Junction table usuario_departamentos para pertenencia a múltiples departamentos."""
    with _conn() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS usuario_departamentos (
                usuario_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
                departamento_id INTEGER NOT NULL REFERENCES departamentos(id) ON DELETE CASCADE,
                PRIMARY KEY (usuario_id, departamento_id)
            )
        """)
        # Seed from existing departamento_id FK
        rows = db.execute(
            "SELECT id, departamento_id FROM usuarios WHERE departamento_id IS NOT NULL"
        ).fetchall()
        for r in rows:
            db.execute(
                "INSERT OR IGNORE INTO usuario_departamentos (usuario_id, departamento_id) VALUES (?,?)",
                (r["id"], r["departamento_id"]),
            )
        db.commit()


def _safe_migrate(fn):
    """Run a migration silently skipping OperationalError (fresh-DB tables don't exist yet)."""
    try:
        fn()
    except sqlite3.OperationalError:
        pass


def init_db():
    _safe_migrate(_repair_broken_fk)
    _safe_migrate(_migrate_categorias)
    _safe_migrate(_migrate_materiales_tipo)
    _safe_migrate(_migrate_zonas_subareas)
    _safe_migrate(_migrate_mision_zona_id)
    _safe_migrate(_migrate_zonas_tipo)
    _safe_migrate(_migrate_mision_frecuencia)
    _safe_migrate(_migrate_mision_modo_ciclo)
    _safe_migrate(_migrate_ticket_frecuencia)
    _safe_migrate(_migrate_ticket_paso_notas)
    _safe_migrate(_migrate_ticket_paso_duracion)
    from app.services.misiones_timing import _migrate_mision_corridas
    from app.services.ticket_timing import _migrate_ticket_corridas
    from app.services.recetas_ops import _migrate_recetas_ops
    _safe_migrate(_migrate_mision_corridas)
    _safe_migrate(_migrate_ticket_corridas)
    _safe_migrate(_migrate_recetas_ops)
    _safe_migrate(_migrate_dependencias_prerequisitos)
    _safe_migrate(_migrate_ticket_tipo)
    _safe_migrate(_migrate_ticket_fecha_inicio)
    _safe_migrate(_migrate_usuario_google)
    _safe_migrate(_migrate_usuario_permisos)
    _safe_migrate(_migrate_usuario_preferencias_ui)
    _safe_migrate(_migrate_usuario_departamentos)
    _safe_migrate(_migrate_usuario_telefono)
    _safe_migrate(_migrate_usuario_documento_identidad)
    _safe_migrate(_migrate_ticket_protocolo_id)
    _safe_migrate(_migrate_protocolos_alcance)
    _safe_migrate(_migrate_ticket_subtipo)
    from app.services.panel_presencia import _migrate_panel_presencia
    _safe_migrate(_migrate_panel_presencia)
    _safe_migrate(_migrate_adjunto_paso_id)
    _safe_migrate(_migrate_pendientes)
    _safe_migrate(_migrate_recordatorios)
    _safe_migrate(_migrate_recordatorios_hora)
    _safe_migrate(_migrate_recordatorios_bimestral)
    _safe_migrate(_migrate_recordatorios_asignado)
    _safe_migrate(_migrate_protocolo_accesos)
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
            -- Asignaciones de labores operativas a "aliados" (usuarios).
            -- Ejemplo: reclamos MeLi → anular factura / nota crédito SIIGO.
            CREATE TABLE IF NOT EXISTS aliados_asignaciones (
                tarea_slug      TEXT PRIMARY KEY,
                usuario_id      INTEGER REFERENCES usuarios(id),
                actualizado_por INTEGER REFERENCES usuarios(id),
                actualizado_en  TEXT DEFAULT (datetime('now'))
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
            ("contabilidad",  "Contabilidad",     "#0c6069", "🧾"),
            ("contratos",     "Contratos",        "#64748b", "📄"),
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
        _add_col(db, "tickets", "datos_sensibles_enc", "TEXT")
        _add_col(db, "ticket_pasos", "bloqueado_por", "INTEGER REFERENCES tickets(id)")
        _add_col(db, "tickets", "ticket_padre_id", "INTEGER REFERENCES tickets(id)")
        _add_col(db, "tickets", "paso_origen_id",  "INTEGER REFERENCES ticket_pasos(id)")
        _add_col(db, "tickets", "notas_accion",    "TEXT")
        _add_col(db, "usuarios", "bolsillo_enc",   "TEXT")

        db.executescript("""
            CREATE TABLE IF NOT EXISTS lista_compras_ticket (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id       INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
                nombre          TEXT NOT NULL,
                sku             TEXT,
                material_id     INTEGER REFERENCES materiales_catalogo(id),
                cantidad        REAL DEFAULT 1,
                unidad          TEXT DEFAULT 'und',
                precio_estimado REAL,
                comprado        INTEGER DEFAULT 0,
                notas           TEXT,
                creado_por      INTEGER REFERENCES usuarios(id),
                creado_en       TEXT DEFAULT (datetime('now')),
                actualizado_en  TEXT DEFAULT (datetime('now'))
            );
        """)
        db.executescript("""
            CREATE TABLE IF NOT EXISTS ticket_adjuntos (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id       INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
                nombre_archivo  TEXT NOT NULL,
                nombre_original TEXT NOT NULL,
                mime            TEXT,
                creado_por      INTEGER REFERENCES usuarios(id),
                creado_en       TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS protocolos (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                titulo          TEXT NOT NULL,
                descripcion     TEXT,
                categoria       TEXT,
                pasos           TEXT NOT NULL DEFAULT '[]',
                ticket_origen   INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
                creado_por      INTEGER REFERENCES usuarios(id),
                creado_en       TEXT DEFAULT (datetime('now')),
                activo          INTEGER DEFAULT 1
            );
        """)
        db.executescript("""
            CREATE TABLE IF NOT EXISTS notas_personales (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                usuario_id     INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
                contenido      TEXT NOT NULL,
                creado_en      TEXT DEFAULT (datetime('now')),
                actualizado_en TEXT DEFAULT (datetime('now'))
            );
        """)
        db.commit()
    print("✅ Centro de Mando (tickets DB) inicializado")


# ── NOTAS PERSONALES ──────────────────────────────────────────────────────────

def listar_notas(usuario_id: int) -> list[dict]:
    with _conn() as db:
        rows = db.execute(
            "SELECT id, contenido, creado_en, actualizado_en FROM notas_personales "
            "WHERE usuario_id = ? ORDER BY creado_en DESC",
            (usuario_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def crear_nota(usuario_id: int, contenido: str) -> dict:
    with _conn() as db:
        cur = db.execute(
            "INSERT INTO notas_personales (usuario_id, contenido) VALUES (?, ?)",
            (usuario_id, contenido.strip()),
        )
        db.commit()
        row = db.execute(
            "SELECT id, contenido, creado_en, actualizado_en FROM notas_personales WHERE id = ?",
            (cur.lastrowid,),
        ).fetchone()
    return dict(row)


def actualizar_nota(nota_id: int, usuario_id: int, contenido: str) -> bool:
    with _conn() as db:
        cur = db.execute(
            "UPDATE notas_personales SET contenido = ?, actualizado_en = datetime('now') "
            "WHERE id = ? AND usuario_id = ?",
            (contenido.strip(), nota_id, usuario_id),
        )
        db.commit()
    return cur.rowcount > 0


def eliminar_nota(nota_id: int, usuario_id: int) -> bool:
    with _conn() as db:
        cur = db.execute(
            "DELETE FROM notas_personales WHERE id = ? AND usuario_id = ?",
            (nota_id, usuario_id),
        )
        db.commit()
    return cur.rowcount > 0


# ── HELPERS ──────────────────────────────────────────────────────────────────

def _usuario_full(db, user_id: int) -> dict | None:
    import json as _json
    row = db.execute("""
        SELECT u.id, u.nombre, u.username, u.email, u.telefono, u.documento_identidad,
               u.activo, u.creado_en, u.foto,
               u.permisos_secciones, u.preferencias_ui,
               r.id as rol_id, r.nombre as rol_nombre, r.nivel as rol_nivel,
               d.id as dept_id, d.nombre as dept_nombre, d.color as dept_color
        FROM usuarios u
        LEFT JOIN roles r ON r.id = u.rol_id
        LEFT JOIN departamentos d ON d.id = u.departamento_id
        WHERE u.id = ?
    """, (user_id,)).fetchone()
    if not row:
        return None
    permisos = None
    if row["permisos_secciones"]:
        try:
            permisos = _json.loads(row["permisos_secciones"])
        except Exception:
            pass
    preferencias_ui = None
    if row["preferencias_ui"]:
        try:
            preferencias_ui = _json.loads(row["preferencias_ui"])
        except Exception:
            pass
    # Multi-department: query junction table
    dept_rows = db.execute("""
        SELECT d.id, d.nombre, d.color FROM departamentos d
        JOIN usuario_departamentos ud ON ud.departamento_id = d.id
        WHERE ud.usuario_id = ? ORDER BY d.nombre
    """, (user_id,)).fetchall()
    departamentos = [{"id": r["id"], "nombre": r["nombre"], "color": r["color"]} for r in dept_rows]
    # Primary dept: first in junction table, or legacy departamento_id column
    primary_dept = departamentos[0] if departamentos else (
        {"id": row["dept_id"], "nombre": row["dept_nombre"], "color": row["dept_color"]}
        if row["dept_id"] else None
    )
    return {
        "id":       row["id"],
        "nombre":   row["nombre"],
        "username": row["username"],
        "email":    row["email"],
        "telefono": row["telefono"],
        "documento_identidad": row["documento_identidad"],
        "activo":   row["activo"],
        "creado_en": row["creado_en"],
        "foto":     row["foto"],
        "permisos_secciones": permisos,
        "preferencias_ui": preferencias_ui,
        "rol": {"id": row["rol_id"], "nombre": row["rol_nombre"], "nivel": row["rol_nivel"]}
               if row["rol_id"] else None,
        "departamento": primary_dept,
        "departamentos": departamentos,
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


def login_usuario_google(email: str, sub: str) -> tuple:
    """Crea o renueva sesión para un usuario autenticado con Google OAuth."""
    email = email.strip().lower()
    with _conn() as db:
        # Buscar por email primero, luego por google_sub
        row = db.execute(
            "SELECT * FROM usuarios WHERE LOWER(email)=? AND activo=1", (email,)
        ).fetchone()
        if not row:
            row = db.execute(
                "SELECT * FROM usuarios WHERE google_sub=? AND activo=1", (sub,)
            ).fetchone()
        if not row:
            return None, f"El correo {email} no tiene acceso al panel. Pide al administrador que lo vincule."
        # Guardar/actualizar google_sub si cambió
        if row["google_sub"] != sub or (row["email"] or "").lower() != email:
            db.execute(
                "UPDATE usuarios SET google_sub=?, email=? WHERE id=?",
                (sub, email, row["id"]),
            )
        token = secrets.token_urlsafe(32)
        expira = (datetime.utcnow() + timedelta(hours=12)).isoformat()
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


def get_usuario_by_id(user_id: int) -> dict | None:
    with _conn() as db:
        return _usuario_full(db, int(user_id))


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


# ── ALIADOS: ASIGNACIONES DE LABORES ───────────────────────────────────────────

TAREA_RECLAMO_MELI_ANULAR_FACTURA = "meli_reclamo_anular_factura_siigo"
TAREA_SYNC_FACTURAS_FALTANTES_SIIGO = "meli_sync_facturas_faltantes_siigo"

# Marker line embedded in ticket.descripcion for automated re-sync on resolution.
# Example:
# SYS_SYNC_FALTANTES_PACKS_JSON: ["123","456"]
SYS_SYNC_FALTANTES_PACKS_JSON_PREFIX = "SYS_SYNC_FALTANTES_PACKS_JSON:"


def get_aliados_asignaciones() -> dict:
    """Devuelve mapa {tarea_slug: {usuario_id, actualizado_en}}."""
    with _conn() as db:
        rows = db.execute(
            "SELECT tarea_slug, usuario_id, actualizado_en FROM aliados_asignaciones"
        ).fetchall()
        return {
            r["tarea_slug"]: {
                "usuario_id": r["usuario_id"],
                "actualizado_en": r["actualizado_en"],
            }
            for r in rows
        }


def set_aliado_asignacion(
    tarea_slug: str,
    usuario_id: int | None,
    *,
    actualizado_por: int | None = None,
) -> dict:
    """Crea/actualiza la asignación de una tarea a un usuario (aliado)."""
    tarea_slug = (tarea_slug or "").strip()
    if not tarea_slug:
        raise ValueError("tarea_slug requerido")
    uid = int(usuario_id) if usuario_id else None
    with _conn() as db:
        db.execute(
            """
            INSERT INTO aliados_asignaciones (tarea_slug, usuario_id, actualizado_por, actualizado_en)
            VALUES (?,?,?,datetime('now'))
            ON CONFLICT(tarea_slug) DO UPDATE SET
                usuario_id=excluded.usuario_id,
                actualizado_por=excluded.actualizado_por,
                actualizado_en=datetime('now')
            """,
            (tarea_slug, uid, int(actualizado_por) if actualizado_por else None),
        )
        db.commit()
    return {"tarea_slug": tarea_slug, "usuario_id": uid}


# ── USUARIOS ──────────────────────────────────────────────────────────────────

def listar_usuarios(incluir_bots: bool = False) -> list:
    """Lista usuarios del panel.

    Por defecto excluye la cuenta de servicio "hugo_ia_bot" (creada por
    app/tools/sede_sur.py para registrar tickets desde WhatsApp): nadie
    inicia sesión con ella, así que si aparece en un selector de "asignar a"
    los tickets le quedan asignados y nunca los puede marcar como resueltos.
    """
    with _conn() as db:
        rows = db.execute("SELECT id, username FROM usuarios ORDER BY nombre").fetchall()
        if not incluir_bots:
            rows = [r for r in rows if r["username"] != _USERNAME_BOT_SEDE_SUR]
        return [_usuario_full(db, r["id"]) for r in rows]


def crear_usuario(
    nombre: str,
    username: str,
    rol_id: int,
    departamentos_ids: list[int] | None = None,
    password: str | None = None,
    email: str | None = None,
    departamento_id: int | None = None,  # legacy single-dept fallback
) -> tuple:
    import secrets as _sec
    pwd = password or _sec.token_urlsafe(16)  # auto-generate if not provided
    # Collect dept ids (support both new multi and legacy single)
    dept_ids: list[int] = []
    if departamentos_ids:
        dept_ids = [int(d) for d in departamentos_ids]
    elif departamento_id:
        dept_ids = [int(departamento_id)]
    primary_dept = dept_ids[0] if dept_ids else None
    with _conn() as db:
        try:
            db.execute(
                "INSERT INTO usuarios (nombre, username, password_hash, rol_id, departamento_id, email) "
                "VALUES (?,?,?,?,?,?)",
                (nombre, username, generate_password_hash(pwd), rol_id, primary_dept,
                 email.strip().lower() if email else None),
            )
            db.commit()
            row = db.execute("SELECT id FROM usuarios WHERE username=?", (username,)).fetchone()
            uid = row["id"]
            for did in dept_ids:
                db.execute(
                    "INSERT OR IGNORE INTO usuario_departamentos (usuario_id, departamento_id) VALUES (?,?)",
                    (uid, did),
                )
            db.commit()
            return _usuario_full(db, uid), None
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


def get_bolsillo_usuario(user_id: int) -> str | None:
    with _conn() as db:
        row = db.execute("SELECT bolsillo_enc FROM usuarios WHERE id=?", (user_id,)).fetchone()
        return row["bolsillo_enc"] if row else None


def set_bolsillo_usuario(user_id: int, blob: str) -> bool:
    if len(blob) > 500_000:
        return False
    with _conn() as db:
        db.execute("UPDATE usuarios SET bolsillo_enc=? WHERE id=?", (blob, user_id))
        db.commit()
    return True


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


_TEMA_COLOR_KEYS = {
    "surface", "surfacePanel", "surfaceInput", "surfaceHover",
    "ink", "inkSecondary", "muted", "border", "borderStrong",
    "menuBg", "menuText", "menuActiveBg", "menuActiveText",
    "submenuBg", "submenuText", "title", "subtitle", "cardBg", "sectionBg",
}


def _rgb_tema_ok(value: object) -> bool:
    parts = str(value).strip().split()
    return len(parts) == 3 and all(p.isdigit() and 0 <= int(p) <= 255 for p in parts)


def _limpiar_colores_tema(raw: object) -> dict | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for key, val in raw.items():
        if key in _TEMA_COLOR_KEYS and _rgb_tema_ok(val):
            out[str(key)] = " ".join(str(int(p)) for p in str(val).split())
    return out


def _limpiar_temas_custom(raw: object) -> list | None:
    if raw is None:
        return None
    if not isinstance(raw, list):
        return []
    fonts = {
        "Montserrat", "Inter", "DM Sans", "Nunito", "Outfit",
        "JetBrains Mono", "Share Tech Mono", "system-ui",
    }
    out: list[dict] = []
    for item in raw[:12]:
        if not isinstance(item, dict):
            continue
        tid = str(item.get("id") or "")
        name = str(item.get("name") or "").strip()[:40]
        if not tid.startswith("u_") or not name:
            continue
        accent = item.get("accentRgb")
        if not _rgb_tema_ok(accent):
            accent = "12 96 105"
        mode = item.get("mode") if item.get("mode") in ("light", "dark", "system") else "light"
        font = item.get("fontSans") if item.get("fontSans") in fonts else "Montserrat"
        radius = item.get("radius") if item.get("radius") in ("sm", "md", "lg") else "md"
        skin = item.get("skin") if item.get("skin") in ("clasica", "atelier", "matrix", "sakura") else "clasica"
        font_scale = item.get("fontScale") if item.get("fontScale") in ("sm", "md", "lg", "xl") else "md"
        menu_scale = item.get("menuScale") if item.get("menuScale") in ("sm", "md", "lg") else "md"
        colors = _limpiar_colores_tema(item.get("colors")) or {}
        out.append({
            "id": tid[:40],
            "name": name,
            "mode": mode,
            "fontSans": font,
            "accentRgb": " ".join(str(int(p)) for p in str(accent).split()),
            "radius": radius,
            "skin": skin,
            "fontScale": font_scale,
            "menuScale": menu_scale,
            "colors": colors,
        })
    return out


def actualizar_preferencias_ui(user_id: int, preferencias: dict) -> tuple[bool, str | None, dict | None]:
    """Guarda tema del panel asociado al usuario (JSON validado)."""
    import json as _json

    if not isinstance(preferencias, dict):
        return False, "preferencias inválidas", None

    panel_in = preferencias.get("panel")
    quest_in = preferencias.get("quest")
    clean: dict = {}

    if panel_in is not None:
        if not isinstance(panel_in, dict):
            return False, "panel inválido", None
        panel: dict = {}
        mode = panel_in.get("mode")
        if mode is not None:
            if mode not in ("light", "dark", "system"):
                return False, "mode inválido", None
            panel["mode"] = mode
        font = panel_in.get("fontSans")
        if font is not None:
            if font not in (
                "Montserrat",
                "Inter",
                "DM Sans",
                "Nunito",
                "Outfit",
                "JetBrains Mono",
                "Share Tech Mono",
                "system-ui",
            ):
                return False, "fontSans inválido", None
            panel["fontSans"] = font
        accent = panel_in.get("accentRgb")
        if accent is not None:
            parts = str(accent).strip().split()
            if len(parts) != 3 or not all(p.isdigit() and 0 <= int(p) <= 255 for p in parts):
                return False, "accentRgb inválido", None
            panel["accentRgb"] = " ".join(str(int(p)) for p in parts)
        radius = panel_in.get("radius")
        if radius is not None:
            if radius not in ("sm", "md", "lg"):
                return False, "radius inválido", None
            panel["radius"] = radius
        skin = panel_in.get("skin")
        if skin is not None:
            if skin not in ("clasica", "atelier", "matrix", "sakura"):
                return False, "skin inválido", None
            panel["skin"] = skin
        font_scale = panel_in.get("fontScale")
        if font_scale is not None:
            if font_scale not in ("sm", "md", "lg", "xl"):
                return False, "fontScale inválido", None
            panel["fontScale"] = font_scale
        menu_scale = panel_in.get("menuScale")
        if menu_scale is not None:
            if menu_scale not in ("sm", "md", "lg"):
                return False, "menuScale inválido", None
            panel["menuScale"] = menu_scale
        colors = _limpiar_colores_tema(panel_in.get("colors"))
        if colors is not None:
            panel["colors"] = colors
        custom = _limpiar_temas_custom(panel_in.get("customThemes"))
        if custom is not None:
            panel["customThemes"] = custom
        active_custom = panel_in.get("activeCustomId")
        if active_custom is None or active_custom == "":
            if "activeCustomId" in panel_in:
                panel["activeCustomId"] = None
        elif isinstance(active_custom, str) and active_custom.startswith("u_"):
            panel["activeCustomId"] = active_custom[:40]
        if panel:
            clean["panel"] = panel

    if quest_in is not None:
        if not isinstance(quest_in, dict):
            return False, "quest inválido", None
        quest: dict = {}
        if "dark" in quest_in:
            quest["dark"] = bool(quest_in["dark"])
        if quest:
            clean["quest"] = quest

    if not clean:
        return False, "Nada que guardar", None

    with _conn() as db:
        row = db.execute(
            "SELECT preferencias_ui FROM usuarios WHERE id=? AND activo=1",
            (user_id,),
        ).fetchone()
        if not row:
            return False, "Usuario no encontrado", None
        merged = {}
        if row["preferencias_ui"]:
            try:
                merged = _json.loads(row["preferencias_ui"]) or {}
            except Exception:
                merged = {}
        if "panel" in clean:
            merged["panel"] = {**(merged.get("panel") or {}), **clean["panel"]}
        if "quest" in clean:
            merged["quest"] = {**(merged.get("quest") or {}), **clean["quest"]}
        db.execute(
            "UPDATE usuarios SET preferencias_ui=? WHERE id=?",
            (_json.dumps(merged), user_id),
        )
        db.commit()
    return True, None, merged


def actualizar_permisos_secciones(user_id: int, permisos: dict, admin_id: int) -> tuple[bool, str | None]:
    import json as _json
    with _conn() as db:
        admin = _usuario_full(db, admin_id)
        if not admin or (admin.get("rol") or {}).get("nivel", 0) < 3:
            return False, "No autorizado"
        db.execute(
            "UPDATE usuarios SET permisos_secciones=? WHERE id=?",
            (_json.dumps(permisos), user_id),
        )
        db.commit()
    return True, None


def actualizar_usuario(user_id: int, data: dict) -> tuple:
    import json as _json
    campos = {k: v for k, v in data.items()
              if k in ("nombre", "username", "rol_id", "departamento_id", "activo", "email",
                       "telefono", "documento_identidad", "permisos_secciones")}
    if "telefono" in campos:
        from app.services.tickets_notificaciones import normalizar_telefono_wa
        raw = campos.get("telefono")
        campos["telefono"] = normalizar_telefono_wa(str(raw or "")) or None
    if "documento_identidad" in campos:
        raw_doc = str(campos.get("documento_identidad") or "").strip()
        doc = "".join(raw_doc.split())
        campos["documento_identidad"] = doc or None
    if "email" in campos and campos["email"]:
        campos["email"] = campos["email"].strip().lower()
    if "permisos_secciones" in campos:
        val = campos["permisos_secciones"]
        campos["permisos_secciones"] = _json.dumps(val) if isinstance(val, dict) else (val or None)
    if "password" in data and data["password"]:
        campos["password_hash"] = generate_password_hash(data["password"])
    dept_ids: list[int] | None = None
    if "departamentos_ids" in data and isinstance(data["departamentos_ids"], list):
        dept_ids = [int(d) for d in data["departamentos_ids"] if d]
        if dept_ids:
            campos["departamento_id"] = dept_ids[0]  # keep primary FK in sync
    with _conn() as db:
        try:
            if campos:
                set_clause = ", ".join(f"{k}=?" for k in campos)
                db.execute(f"UPDATE usuarios SET {set_clause} WHERE id=?", (*campos.values(), user_id))
            if dept_ids is not None:
                db.execute("DELETE FROM usuario_departamentos WHERE usuario_id=?", (user_id,))
                for did in dept_ids:
                    db.execute(
                        "INSERT OR IGNORE INTO usuario_departamentos (usuario_id, departamento_id) VALUES (?,?)",
                        (user_id, did),
                    )
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
    d["creado_por_info"] = (
        {"id": creador["id"], "nombre": creador["nombre"], "foto": creador.get("foto")}
        if creador else None
    )
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
            mats = list(etapa_raw.get("materiales") or [])
            if i == 1 and not mats and data.get("materiales"):
                mats = list(data.get("materiales") or [])
            _vincular_materiales_ticket(db, tid, mats)

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
            if usuario_id:
                from app.services.misiones_timing import adjuntar_corrida_mision
                adjuntar_corrida_mision(d, usuario_id)
            else:
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
                         frecuencia: str | None = None,
                         materiales: list | None = None) -> tuple:
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
        _vincular_materiales_ticket(db, tid, materiales)
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
            db.execute(
                "UPDATE etapas_mision SET ticket_id=NULL, estado='pendiente' WHERE ticket_id=?",
                (tid,),
            )
            db.execute("DELETE FROM logs_auditoria WHERE ticket_id=?", (tid,))
            db.execute(
                "UPDATE consumo_materiales SET ticket_id=NULL WHERE ticket_id=?",
                (tid,),
            )
        if ticket_ids:
            placeholders = ",".join("?" * len(ticket_ids))
            db.execute(f"DELETE FROM tickets WHERE id IN ({placeholders})", ticket_ids)
        # Materiales elaborados creados por la misión referencian misiones(id) sin CASCADE
        db.execute(
            "UPDATE materiales_catalogo SET mision_origen_id=NULL WHERE mision_origen_id=?",
            (mision_id,),
        )
        db.execute(
            "UPDATE misiones SET producto_resultante_id=NULL WHERE id=?",
            (mision_id,),
        )
        db.execute("DELETE FROM etapas_mision WHERE mision_id=?", (mision_id,))
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
    uid = usuario.get("id")
    nivel = (usuario.get("rol") or {}).get("nivel", 0)
    with _conn() as db:
        t = db.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        if not t:
            return None, "Ticket no encontrado"
        if nivel < 2 and t["creado_por"] != uid and t["asignado_a"] != uid:
            return None, "Solo el creador o un supervisor puede editar este ticket"
        campos = {}
        if "titulo" in data and data["titulo"] is not None:
            campos["titulo"] = str(data["titulo"]).strip()
        if "descripcion" in data and data["descripcion"] is not None:
            campos["descripcion"] = str(data["descripcion"]).strip()
        if "prioridad" in data and data["prioridad"] is not None:
            if data["prioridad"] not in ("baja", "media", "alta", "urgente"):
                return None, "Prioridad inválida"
            campos["prioridad"] = data["prioridad"]
        if "notas_accion" in data:
            campos["notas_accion"] = str(data["notas_accion"]).strip() if data["notas_accion"] is not None else ""
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


_ESTADOS_ACTIVOS = ("pendiente", "en_proceso", "esperando_aprobacion", "resuelto", "rechazado")

def renovar_mision(mision_id: int, usuario_id: int | None = None, forzar: bool = False) -> tuple:
    """Reinicia los tickets de la misión para un nuevo ciclo.

    forzar=False (renovación clásica): solo resetea tickets en estado 'resuelto'.
    forzar=True  (iniciar misión):     resetea todos los tickets sin importar estado.
    """
    with _conn() as db:
        m = db.execute("SELECT id FROM misiones WHERE id=?", (mision_id,)).fetchone()
        if not m:
            return False, "Misión no encontrada"
        etapas = db.execute(
            "SELECT ticket_id FROM etapas_mision WHERE mision_id=? AND ticket_id IS NOT NULL",
            (mision_id,),
        ).fetchall()
        if not etapas:
            return False, "La misión no tiene tickets"
        renovados = 0
        for et in etapas:
            t = db.execute(
                "SELECT estado FROM tickets WHERE id=?", (et["ticket_id"],),
            ).fetchone()
            if t and (forzar or t["estado"] == "resuelto"):
                from app.services.ticket_timing import finalizar_corridas_abiertas_ticket
                finalizar_corridas_abiertas_ticket(et["ticket_id"])
                _reset_ticket_ciclo(db, et["ticket_id"], usuario_id, mision_id)
                # Al iniciar forzado, el usuario que arranca la misión se vuelve participante
                # del ticket para que nivel 1 tenga acceso durante la ejecución.
                if forzar and usuario_id:
                    db.execute(
                        "INSERT OR IGNORE INTO ticket_participantes (ticket_id, usuario_id, rol) "
                        "VALUES (?,?,'colaborador')",
                        (et["ticket_id"], usuario_id),
                    )
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
    d["creado_por_info"] = (
        {"id": creador["id"], "nombre": creador["nombre"], "foto": creador.get("foto")}
        if creador else None
    )
    if t["asignado_a"]:
        asig = _usuario_full(db, t["asignado_a"])
        d["asignado_a_info"] = (
            {"id": asig["id"], "nombre": asig["nombre"], "foto": asig.get("foto")}
            if asig else None
        )
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
    if d.get("protocolo_id"):
        pr = db.execute(
            "SELECT titulo FROM protocolos WHERE id=? AND activo=1", (d["protocolo_id"],),
        ).fetchone()
        d["protocolo_titulo"] = pr["titulo"] if pr else None
    else:
        d["protocolo_titulo"] = None
    # Indica si hay datos sensibles sin exponer el contenido
    d["tiene_datos_sensibles"] = bool(d.get("datos_sensibles_enc"))
    d.pop("datos_sensibles_enc", None)
    return d


# ── DATOS SENSIBLES (cifrado Fernet) ─────────────────────────────────────────

def _get_fernet():
    import hashlib, base64
    from cryptography.fernet import Fernet
    raw = (os.getenv("TICKETS_SECRET_KEY") or "").strip()
    if not raw:
        return None
    key_bytes = hashlib.sha256(raw.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key_bytes))


def _encrypt_sensible(text: str) -> str:
    f = _get_fernet()
    if not f:
        return "plain:" + text
    return f.encrypt(text.encode()).decode()


def _decrypt_sensible(enc: str) -> str:
    if not enc:
        return ""
    if enc.startswith("plain:"):
        return enc[6:]
    f = _get_fernet()
    if not f:
        return enc
    try:
        return f.decrypt(enc.encode()).decode()
    except Exception:
        return "(error al descifrar — clave incorrecta o datos corruptos)"


def get_datos_sensibles(ticket_id: int, usuario: dict) -> tuple:
    nivel = (usuario.get("rol") or {}).get("nivel", 1)
    uid = usuario.get("id")
    with _conn() as db:
        t = db.execute(
            "SELECT datos_sensibles_enc, asignado_a, creado_por FROM tickets WHERE id=?",
            (ticket_id,),
        ).fetchone()
        if not t:
            return None, "Ticket no encontrado"
        es_participante = db.execute(
            "SELECT 1 FROM ticket_participantes WHERE ticket_id=? AND usuario_id=?",
            (ticket_id, uid),
        ).fetchone() is not None
        puede_ver = nivel >= 2 or t["asignado_a"] == uid or t["creado_por"] == uid or es_participante
        if not puede_ver:
            return None, "Sin permisos para ver datos sensibles"
        enc = t["datos_sensibles_enc"]
        if not enc:
            return "", None
        return _decrypt_sensible(enc), None


def set_datos_sensibles(ticket_id: int, texto: str, usuario: dict) -> tuple:
    nivel = (usuario.get("rol") or {}).get("nivel", 1)
    if nivel < 2:
        return False, "Sin permisos para editar datos sensibles"
    enc = _encrypt_sensible(texto.strip()) if (texto or "").strip() else None
    with _conn() as db:
        t = db.execute("SELECT id FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        if not t:
            return False, "Ticket no encontrado"
        db.execute(
            "UPDATE tickets SET datos_sensibles_enc=?, actualizado_en=datetime('now') WHERE id=?",
            (enc, ticket_id),
        )
        _log(db, ticket_id, usuario["id"], "datos_sensibles_actualizado",
             detalles="Datos sensibles actualizados")
        db.commit()
        return True, None


# ── INTERVENCIÓN (sub-solicitud que bloquea el ticket padre) ─────────────────

def pedir_intervencion(ticket_id: int, titulo: str, asignado_a: int,
                       descripcion: str, usuario_id: int, paso_id: int | None = None) -> tuple:
    with _conn() as db:
        t = db.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        if not t:
            return None, "Ticket no encontrado"
        if t["estado"] not in ("en_proceso", "pendiente"):
            return None, "Solo se puede pedir intervención en tickets activos"

        numero = _generar_numero(db)
        db.execute("""
            INSERT INTO tickets (numero, titulo, categoria, descripcion, prioridad,
                                 creado_por, asignado_a, tipo, ticket_padre_id, paso_origen_id)
            VALUES (?,?,?,?,?,?,?,'solicitud',?,?)
        """, (
            numero,
            titulo.strip(),
            t["categoria"],
            (descripcion or "").strip() or f"Intervención requerida para {t['numero']}",
            "alta",
            usuario_id,
            asignado_a,
            ticket_id,
            paso_id,
        ))
        nueva_id = db.execute("SELECT last_insert_rowid() as id").fetchone()["id"]
        _log(db, nueva_id, usuario_id, "ticket_creado",
             detalles=f"Solicitud de intervención para ticket {t['numero']}")

        # Bloquear el ticket original hasta que la intervención se resuelva
        db.execute(
            "UPDATE tickets SET bloqueado_por=?, estado='pendiente', "
            "actualizado_en=datetime('now') WHERE id=?",
            (nueva_id, ticket_id),
        )
        _log(db, ticket_id, usuario_id, "estado_cambiado", t["estado"], "pendiente",
             f"Bloqueado — esperando intervención {numero}")
        # Dar acceso al intervener al hilo del ticket padre para que vea el contexto
        db.execute(
            "INSERT OR IGNORE INTO ticket_participantes (ticket_id, usuario_id, rol) VALUES (?,?,?)",
            (ticket_id, asignado_a, "colaborador"),
        )
        db.commit()

    return get_ticket(ticket_id, {"id": usuario_id, "rol": {"nivel": 3}}), None


def crear_ticket(data: dict, usuario_id: int, archivo_nombre: str | None = None) -> tuple:
    with _conn() as db:
        numero = _generar_numero(db)
        try:
            asignado_a = int(data["asignado_a"]) if data.get("asignado_a") else None
            tipo = data.get("tipo", "ticket")
            if tipo not in ("ticket", "accion", "solicitud"):
                tipo = "ticket"
            # Acción asignada a otro usuario → es una solicitud, no una acción personal
            if tipo == "accion" and asignado_a and asignado_a != usuario_id:
                tipo = "solicitud"
            frecuencia = data.get("frecuencia") or None
            fecha_inicio = data.get("fecha_inicio") or None
            ticket_padre_id = data.get("ticket_padre_id")
            try:
                ticket_padre_id = int(ticket_padre_id) if ticket_padre_id else None
            except (TypeError, ValueError):
                ticket_padre_id = None
            subtipo = (data.get("subtipo") or "").strip() or None
            if subtipo and tipo != "solicitud":
                subtipo = None
            db.execute("""
                INSERT INTO tickets
                    (numero, titulo, categoria, descripcion, prioridad,
                     creado_por, asignado_a, soporte_archivo, tipo,
                     frecuencia, fecha_inicio, ticket_padre_id, subtipo)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                numero, data["titulo"], data["categoria"],
                data.get("descripcion") or data["titulo"],
                data.get("prioridad", "media"),
                usuario_id, asignado_a, archivo_nombre, tipo,
                frecuencia, fecha_inicio, ticket_padre_id, subtipo,
            ))
            tid = db.execute("SELECT last_insert_rowid() as id").fetchone()["id"]
            _log(db, tid, usuario_id, "ticket_creado", detalles=f"Ticket {numero} creado")
            # Las solicitudes quedan en pendiente al crearse (el asignado debe aceptarlas)
            if asignado_a and tipo != "solicitud":
                _log(db, tid, usuario_id, "asignado",
                     val_new=str(asignado_a), detalles="Asignado al crear")
                db.execute(
                    "UPDATE tickets SET estado='en_proceso', actualizado_en=datetime('now') WHERE id=?",
                    (tid,),
                )
                _log(db, tid, usuario_id, "estado_cambiado", "pendiente", "en_proceso",
                     "Asignado al crear → en proceso")
            elif asignado_a and tipo == "solicitud":
                _log(db, tid, usuario_id, "asignado",
                     val_new=str(asignado_a), detalles="Solicitud asignada al crear")
            protocolo_id = data.get("protocolo_id")
            if protocolo_id:
                try:
                    protocolo_id = int(protocolo_id)
                except (TypeError, ValueError):
                    protocolo_id = None
            if protocolo_id:
                prot = db.execute(
                    "SELECT id FROM protocolos WHERE id=? AND activo=1", (protocolo_id,),
                ).fetchone()
                if prot:
                    db.execute(
                        "UPDATE tickets SET protocolo_id=? WHERE id=?", (protocolo_id, tid),
                    )
            pasos_raw = data.get("pasos")
            if not pasos_raw and protocolo_id:
                pasos_raw = _pasos_desde_protocolo(db, protocolo_id)
            _insertar_pasos_ticket(db, tid, pasos_raw)
            db.commit()
            try:
                from app.services.tickets_notificaciones import notificar_ticket_creado
                from app.observability import spawn_thread
                spawn_thread(notificar_ticket_creado, (tid,), daemon=True)
            except Exception:
                pass
            return _ticket_full(db, tid), None
        except Exception as e:
            return None, str(e)


def usuario_tiene_accion_en_proceso(usuario_id: int) -> bool:
    """True si el usuario tiene al menos una acción asignada en estado en_proceso."""
    with _conn() as db:
        row = db.execute(
            """SELECT 1 FROM tickets
               WHERE tipo='accion' AND estado='en_proceso' AND asignado_a=?
               LIMIT 1""",
            (usuario_id,),
        ).fetchone()
        return row is not None


def listar_tickets(usuario: dict, filtros: dict | None = None) -> list:
    filtros = filtros or {}
    with _conn() as db:
        conds, params = [], []
        tipo_filtro = filtros.get("tipo")
        vista_equipo = bool(filtros.get("vista_equipo"))
        equipo_tipos = tipo_filtro in ("solicitud", "accion")
        # Cynthia con nivel elevado: solo su agenda personal (no la del administrador)
        if es_cynthia_etiquetas(usuario):
            vista_equipo = False
        ver_todo_equipo = es_admin_vista_equipo(usuario)
        if not ver_todo_equipo and not (vista_equipo and equipo_tipos):
            conds.append("(t.creado_por=? OR t.asignado_a=? OR EXISTS("
                         "SELECT 1 FROM ticket_participantes tp "
                         "WHERE tp.ticket_id=t.id AND tp.usuario_id=?))")
            params += [usuario["id"], usuario["id"], usuario["id"]]
        if filtros.get("activas"):
            conds.append("t.estado NOT IN ('resuelto', 'rechazado')")
        for key in ("estado", "categoria", "prioridad", "tipo"):
            if filtros.get(key):
                conds.append(f"t.{key}=?")
                params.append(filtros[key])
        if filtros.get("asignado_a"):
            conds.append("t.asignado_a=?")
            params.append(filtros["asignado_a"])
        if filtros.get("mision_id"):
            conds.append("t.mision_id=?")
            params.append(filtros["mision_id"])
        if filtros.get("sin_mision"):
            conds.append("t.mision_id IS NULL")
        if filtros.get("subtipo"):
            conds.append("TRIM(COALESCE(t.subtipo, ''))=?")
            params.append(filtros["subtipo"].strip())
        if filtros.get("mis_solicitudes"):
            conds.append("t.asignado_a=?")
            params.append(usuario["id"])
        # Quien solo va de compras (solicitud hijo) no debe ver la acción padre en su lista de acciones
        if tipo_filtro == "accion" and not vista_equipo:
            conds.append("""
                NOT EXISTS (
                    SELECT 1 FROM tickets s
                    WHERE s.ticket_padre_id = t.id
                      AND s.tipo = 'solicitud'
                      AND TRIM(COALESCE(s.subtipo, '')) = 'compra'
                      AND s.asignado_a = ?
                      AND s.estado NOT IN ('resuelto', 'rechazado')
                )
            """)
            params.append(usuario["id"])
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
                   tp.numero  AS ticket_padre_numero,
                   tp.titulo  AS ticket_padre_titulo,
                   ucp.nombre AS ticket_padre_solicitante,
                   (SELECT COUNT(*) FROM ticket_pasos tps WHERE tps.ticket_id = t.id)
                       AS pasos_total,
                   (SELECT COUNT(*) FROM ticket_pasos tps
                    WHERE tps.ticket_id = t.id AND tps.completado = 1)
                       AS pasos_completados,
                   pr.titulo AS protocolo_titulo
            FROM tickets t
            LEFT JOIN usuarios uc  ON uc.id  = t.creado_por
            LEFT JOIN usuarios ua  ON ua.id  = t.asignado_a
            LEFT JOIN misiones m   ON m.id   = t.mision_id
            LEFT JOIN tickets  bt  ON bt.id  = t.bloqueado_por
            LEFT JOIN tickets  tp  ON tp.id  = t.ticket_padre_id
            LEFT JOIN usuarios ucp ON ucp.id = tp.creado_por
            LEFT JOIN protocolos pr ON pr.id = t.protocolo_id AND pr.activo = 1
            {where}
            ORDER BY
                CASE t.prioridad
                    WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1
                    WHEN 'media'   THEN 2 ELSE 3
                END,
                t.creado_en DESC
        """, params).fetchall()
        return [dict(r) for r in rows]


def _sql_compra_delegada_cond(alias: str = "t") -> str:
    return (
        f"{alias}.tipo = 'solicitud' AND ("
        f"TRIM(COALESCE({alias}.subtipo, '')) = 'compra' OR "
        f"(LOWER(TRIM({alias}.titulo)) LIKE 'compras:%' AND {alias}.ticket_padre_id IS NOT NULL)"
        f")"
    )


def listar_compras_delegadas(usuario_id: int, solo_activas: bool = True) -> list:
    """Solicitudes de compra asignadas al usuario (flujo ir de compras)."""
    with _conn() as db:
        cond = _sql_compra_delegada_cond("t")
        extra = " AND t.estado NOT IN ('resuelto', 'rechazado')" if solo_activas else ""
        rows = db.execute(f"""
            SELECT t.*,
                   uc.nombre  AS creado_por_nombre,
                   ua.nombre  AS asignado_a_nombre,
                   tp.numero  AS ticket_padre_numero,
                   tp.titulo  AS ticket_padre_titulo
            FROM tickets t
            LEFT JOIN usuarios uc ON uc.id = t.creado_por
            LEFT JOIN usuarios ua ON ua.id = t.asignado_a
            LEFT JOIN tickets tp ON tp.id = t.ticket_padre_id
            WHERE t.asignado_a = ? AND {cond}{extra}
            ORDER BY
                CASE t.prioridad
                    WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1
                    WHEN 'media'   THEN 2 ELSE 3
                END,
                t.creado_en DESC
        """, (usuario_id,)).fetchall()
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


def _es_solicitud_etiqueta_ticket(t: dict) -> bool:
    """Solicitud de impresión de etiquetas (checklist de productos, no pasos de protocolo)."""
    st = (t.get("subtipo") or "").strip().lower()
    if st in ("etiqueta", "etiquetas"):
        return True
    if st:
        return False
    tit = (t.get("titulo") or "").strip().lower()
    if not tit:
        return False
    if tit in ("etiquetas", "etiqueta"):
        return True
    if tit.startswith("etiquetas:") or tit.startswith("etiqueta:"):
        return True
    if "pedido de etiqueta" in tit:
        return True
    return False


def cambiar_estado(ticket_id: int, nuevo_estado: str, usuario: dict, motivo: str = "") -> tuple:
    valid = {"pendiente", "en_proceso", "esperando_aprobacion", "resuelto", "rechazado"}
    if nuevo_estado not in valid:
        return False, "Estado inválido"
    with _conn() as db:
        _row = db.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        if not _row:
            return False, "Ticket no encontrado"
        t = dict(_row)
        nivel = (usuario.get("rol") or {}).get("nivel", 1)
        uid   = usuario["id"]

        if nuevo_estado == "resuelto":
            if t["categoria"] in ("rrhh", "contratos") and nivel < 3:
                return False, "Solo Administración puede aprobar este tipo de ticket."
            # Las solicitudes solo pueden resolverlas el asignado,
            # EXCEPTO cuando están en revisión: el creador puede aprobarlas.
            if t["tipo"] == "solicitud" and t["asignado_a"] != uid:
                aprobacion_por_creador = (
                    t["estado"] == "esperando_aprobacion" and t["creado_por"] == uid
                )
                if not aprobacion_por_creador:
                    return False, "Solo el usuario asignado puede resolver esta solicitud"
            is_authorized = (nivel >= 2 or t["creado_por"] == uid or t["asignado_a"] == uid)
            if not is_authorized:
                return False, "Sin autorización"
            if (t.get("subtipo") or "").strip() == "compra":
                pend = db.execute(
                    "SELECT COUNT(*) AS n FROM lista_compras_ticket "
                    "WHERE ticket_id=? AND comprado=0",
                    (ticket_id,),
                ).fetchone()["n"]
                if pend:
                    return False, f"Faltan {pend} producto(s) por marcar en la lista de compras"
            elif _es_solicitud_etiqueta_ticket(t):
                n_lista = db.execute(
                    "SELECT COUNT(*) AS n FROM lista_compras_ticket WHERE ticket_id=?",
                    (ticket_id,),
                ).fetchone()["n"]
                if n_lista > 0:
                    pend = db.execute(
                        "SELECT COUNT(*) AS n FROM lista_compras_ticket "
                        "WHERE ticket_id=? AND comprado=0",
                        (ticket_id,),
                    ).fetchone()["n"]
                    if pend:
                        return False, (
                            f"Faltan {pend} producto(s) por marcar como impreso en el pedido"
                        )
            # Solicitudes con pasos: todos deben estar completados antes de resolver
            elif t["tipo"] == "solicitud" and _pasos_checklist_completo is not None:
                total = db.execute(
                    "SELECT COUNT(*) AS n FROM ticket_pasos WHERE ticket_id=?", (ticket_id,)
                ).fetchone()["n"]
                if total > 0 and not _pasos_checklist_completo(db, ticket_id):
                    pendientes = db.execute(
                        "SELECT COUNT(*) AS n FROM ticket_pasos WHERE ticket_id=? AND completado=0",
                        (ticket_id,),
                    ).fetchone()["n"]
                    return False, f"Faltan {pendientes} paso(s) por completar antes de marcar como lista"
        if nuevo_estado == "rechazado" and nivel < 2:
            # El creador puede rechazar una solicitud que espera su revisión
            rechaza_creador = (
                t.get("tipo") == "solicitud"
                and t["estado"] == "esperando_aprobacion"
                and t["creado_por"] == uid
            )
            # El asignado puede cancelar (rechazar) su propia acción
            cancela_accion = (
                t.get("tipo") == "accion"
                and t.get("asignado_a") == uid
            )
            if not rechaza_creador and not cancela_accion:
                return False, "Sin autorización para cancelar este ticket"
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

        # Si este ticket era una intervención, propagar la respuesta al ticket padre
        padre_id = t.get("ticket_padre_id")
        if nuevo_estado == "resuelto" and padre_id:
            # Usar el asignado_a (ejecutor real) para la atribución, no el uid del aprobador
            interventor_id = t.get("asignado_a") or uid
            # Recuperar el último comentario del interventor (la respuesta que escribió)
            ultimo_com = db.execute(
                "SELECT texto FROM comentarios_tickets "
                "WHERE ticket_id=? AND usuario_id=? "
                "ORDER BY creado_en DESC LIMIT 1",
                (ticket_id, interventor_id),
            ).fetchone()
            if ultimo_com:
                resp_texto = ultimo_com["texto"]
            else:
                resp_texto = t.get("titulo") or "Intervención resuelta"
            u_nombre = db.execute(
                "SELECT nombre FROM usuarios WHERE id=?", (interventor_id,)
            ).fetchone()
            nombre = u_nombre["nombre"] if u_nombre else "Interventor"
            inter_num = t.get("numero", "")
            msg_padre = (
                f"✅ Intervención {inter_num} resuelta por {nombre}:\n\n{resp_texto}"
            )
            db.execute(
                "INSERT INTO comentarios_tickets (ticket_id, usuario_id, texto, es_interno) "
                "VALUES (?,?,?,0)",
                (padre_id, uid, msg_padre),
            )
            _log(db, padre_id, uid, "intervencion_resuelta",
                 detalles=f"Respuesta de intervención {inter_num} agregada")
            # Registrar la respuesta en las notas del paso que originó la intervención
            paso_origen = t.get("paso_origen_id")
            if paso_origen:
                db.execute(
                    "UPDATE ticket_pasos SET notas=? WHERE id=? AND ticket_id=?",
                    (f"💬 Respuesta ({nombre}): {resp_texto}", paso_origen, padre_id),
                )

        # Update mission progress
        if t["mision_id"]:
            _actualizar_mision(db, t["mision_id"])
        if nuevo_estado == "resuelto":
            _programar_renovacion_ticket(db, ticket_id)

        db.commit()
        if nuevo_estado == "resuelto":
            try:
                from app.services.tickets_notificaciones import notificar_ticket_resuelto
                from app.observability import spawn_thread
                spawn_thread(
                    notificar_ticket_resuelto, (ticket_id, uid), daemon=True,
                )
            except Exception:
                pass
            from app.services.ticket_timing import finalizar_corridas_abiertas_ticket
            finalizar_corridas_abiertas_ticket(ticket_id)

            # ── Hook automático: sincronizar facturas faltantes ─────────────
            # Cuando una acción de "contabilidad" se resuelve, y la descripción del ticket
            # contiene el marker SYS_SYNC_FALTANTES_PACKS_JSON, ejecutamos el re-sync
            # solo para los Pack IDs faltantes.
            if t.get("tipo") == "accion" and t.get("categoria") == "contabilidad":
                try:
                    descripcion = t.get("descripcion") or ""
                    packs: list[str] = []
                    for line in str(descripcion).splitlines():
                        if line.strip().startswith(SYS_SYNC_FALTANTES_PACKS_JSON_PREFIX):
                            payload = line.split(":", 1)[1].strip()
                            decoded = json.loads(payload) if payload else []
                            if isinstance(decoded, list):
                                packs = [str(x).strip() for x in decoded if str(x).strip()]
                            break

                    if packs:
                        from app.observability import spawn_thread, log_json

                        def _runner() -> None:
                            try:
                                from app.sync import sincronizar_manual_por_packs

                                resumen = sincronizar_manual_por_packs(packs)
                                cats = resumen.get("categorias") or {}
                                detalle_cats = ", ".join(
                                    f"{k}={len(v)}"
                                    for k, v in cats.items()
                                    if v
                                ) or "ninguna"
                                agregar_comentario(
                                    ticket_id,
                                    uid,
                                    f"[SYS_SYNC] Resync ejecutado desde acción #{ticket_id}. "
                                    f"Exitosas: {len(resumen.get('exitosas', []) or [])}. "
                                    f"Sin cruce Siigo: {len(resumen.get('faltantes', []) or [])}. "
                                    f"Pendientes total: {len(resumen.get('fallidas', []) or [])}. "
                                    f"Por categoría: {detalle_cats}.",
                                    es_interno=True,
                                )
                                log_json(
                                    "sys_sync_faltantes_done",
                                    ticket_id=ticket_id,
                                    pack_ids=len(packs),
                                    resumen=resumen,
                                )
                            except Exception as e:
                                try:
                                    agregar_comentario(
                                        ticket_id,
                                        uid,
                                        f"[SYS_SYNC] Error en resync automático: {e}",
                                        es_interno=True,
                                    )
                                except Exception:
                                    pass
                                try:
                                    log_json(
                                        "sys_sync_faltantes_error",
                                        ticket_id=ticket_id,
                                        pack_ids=len(packs),
                                        error=str(e),
                                    )
                                except Exception:
                                    pass

                        spawn_thread(_runner, daemon=True)
                except Exception:
                    pass
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
        if asignado_a:
            try:
                from app.services.tickets_notificaciones import notificar_ticket_reasignado
                from app.observability import spawn_thread
                spawn_thread(
                    notificar_ticket_reasignado, (ticket_id, int(asignado_a)), daemon=True,
                )
            except Exception:
                pass
        return True, None


def listar_comentarios(ticket_id: int) -> list:
    with _conn() as db:
        rows = db.execute("""
            SELECT c.id, c.texto, c.es_interno, c.creado_en, c.usuario_id,
                   u.nombre AS autor_nombre
            FROM comentarios_tickets c
            LEFT JOIN usuarios u ON u.id = c.usuario_id
            WHERE c.ticket_id = ?
            ORDER BY c.creado_en ASC
        """, (ticket_id,)).fetchall()
        return [dict(r) for r in rows]


def agregar_comentario(ticket_id: int, usuario_id: int,
                       texto: str, es_interno: bool = False) -> int:
    with _conn() as db:
        cur = db.execute(
            "INSERT INTO comentarios_tickets (ticket_id, usuario_id, texto, es_interno) VALUES (?,?,?,?)",
            (ticket_id, usuario_id, texto, 1 if es_interno else 0),
        )
        new_id: int = cur.lastrowid
        _log(db, ticket_id, usuario_id, "comentario_agregado", detalles=texto[:100])
        db.execute("UPDATE tickets SET actualizado_en=datetime('now') WHERE id=?", (ticket_id,))
        db.commit()
        return new_id


def eliminar_comentario(comentario_id: int, usuario_id: int) -> tuple[bool, str | None]:
    with _conn() as db:
        row = db.execute(
            "SELECT ticket_id, usuario_id FROM comentarios_tickets WHERE id=?", (comentario_id,)
        ).fetchone()
        if not row:
            return False, "Comentario no encontrado"
        if row["usuario_id"] != usuario_id:
            return False, "Sin permisos para eliminar este comentario"
        db.execute("DELETE FROM comentarios_tickets WHERE id=?", (comentario_id,))
        db.execute("UPDATE tickets SET actualizado_en=datetime('now') WHERE id=?", (row["ticket_id"],))
        db.commit()
        return True, None


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
            rows = db.execute(
                "SELECT numero, titulo, tipo, estado, prioridad, creado_en "
                "FROM tickets WHERE asignado_a=? "
                "AND estado NOT IN ('resuelto','rechazado') "
                "ORDER BY CASE prioridad WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 "
                "WHEN 'media' THEN 2 ELSE 3 END, creado_en DESC",
                (uid,),
            ).fetchall()
            u["tickets_lista"] = [dict(r) for r in rows]
            result.append(u)
        return sorted(result, key=lambda x: x["tickets_abiertos"], reverse=True)


# ── PASOS DE TICKET ───────────────────────────────────────────────────────────

def _vincular_materiales_ticket(db, ticket_id: int, materiales_raw) -> None:
    """Vincula materiales del catálogo a un ticket (etapa de misión)."""
    if not materiales_raw:
        return
    for mat in materiales_raw:
        try:
            mid_mat = int(mat.get("material_id") or 0)
            cant = float(mat.get("cantidad") or 0)
        except (TypeError, ValueError):
            continue
        if mid_mat <= 0 or cant <= 0:
            continue
        existe = db.execute(
            "SELECT id FROM materiales_catalogo WHERE id=? AND activo=1",
            (mid_mat,),
        ).fetchone()
        if not existe:
            continue
        notas_mat = (mat.get("notas") or "").strip() or None
        try:
            db.execute(
                "INSERT INTO ticket_materiales "
                "(ticket_id, material_id, cantidad_requerida, notas) VALUES (?,?,?,?)",
                (ticket_id, mid_mat, cant, notas_mat),
            )
        except Exception:
            pass


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
            SELECT p.*,
                   u.nombre AS completado_por_nombre,
                   (SELECT ti.numero FROM tickets ti
                    WHERE ti.paso_origen_id = p.id
                      AND ti.estado NOT IN ('resuelto','rechazado')
                    LIMIT 1) AS intervencion_pendiente_numero,
                   (SELECT ti.asignado_a FROM tickets ti
                    WHERE ti.paso_origen_id = p.id
                      AND ti.estado NOT IN ('resuelto','rechazado')
                    LIMIT 1) AS intervencion_asignado_id,
                   (SELECT ua.nombre FROM tickets ti
                    JOIN usuarios ua ON ua.id = ti.asignado_a
                    WHERE ti.paso_origen_id = p.id
                      AND ti.estado NOT IN ('resuelto','rechazado')
                    LIMIT 1) AS intervencion_asignado_nombre,
                   (SELECT c.texto FROM comentarios_tickets c
                    JOIN tickets ti ON ti.id = c.ticket_id
                    WHERE ti.paso_origen_id = p.id
                      AND ti.estado = 'resuelto'
                    ORDER BY c.creado_en DESC LIMIT 1) AS respuesta_intervencion
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


def actualizar_paso_descripcion(ticket_id: int, paso_id: int, descripcion: str, notas: str | None = None) -> tuple:
    """Permite editar el texto de un paso (y opcionalmente sus notas)."""
    desc = (descripcion or "").strip()
    if not desc:
        return None, "La descripcion no puede estar vacia"
    with _conn() as db:
        row = db.execute(
            "SELECT id FROM ticket_pasos WHERE id=? AND ticket_id=?",
            (paso_id, ticket_id),
        ).fetchone()
        if not row:
            return None, "Paso no encontrado en este ticket"
        if notas is not None:
            notas_val = notas.strip() or None
            db.execute(
                "UPDATE ticket_pasos SET descripcion=?, notas=? WHERE id=?",
                (desc, notas_val, paso_id),
            )
        else:
            db.execute("UPDATE ticket_pasos SET descripcion=? WHERE id=?", (desc, paso_id))
        db.commit()
    return listar_pasos(ticket_id), None


# ── LISTA DE COMPRAS POR TICKET ───────────────────────────────────────────────

def listar_compras_ticket(ticket_id: int) -> list:
    with _conn() as db:
        rows = db.execute("""
            SELECT lc.*, u.nombre AS creado_por_nombre,
                   mc.nombre AS material_nombre, mc.unidad AS material_unidad
            FROM lista_compras_ticket lc
            LEFT JOIN usuarios u ON u.id = lc.creado_por
            LEFT JOIN materiales_catalogo mc ON mc.id = lc.material_id
            WHERE lc.ticket_id = ? ORDER BY lc.id
        """, (ticket_id,)).fetchall()
        return [dict(r) for r in rows]


def agregar_compra_ticket(ticket_id: int, data: dict, usuario_id: int) -> tuple:
    nombre = (data.get("nombre") or "").strip()
    if not nombre:
        return None, "nombre requerido"
    with _conn() as db:
        t = db.execute("SELECT id FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        if not t:
            return None, "Ticket no encontrado"
        material_id = data.get("material_id") or None
        if material_id:
            material_id = int(material_id)
        db.execute("""
            INSERT INTO lista_compras_ticket
                (ticket_id, nombre, sku, material_id, cantidad, unidad, precio_estimado, notas, creado_por)
            VALUES (?,?,?,?,?,?,?,?,?)
        """, (
            ticket_id, nombre,
            (data.get("sku") or "").strip() or None,
            material_id,
            float(data.get("cantidad") or 1),
            (data.get("unidad") or "und").strip(),
            float(data.get("precio_estimado")) if data.get("precio_estimado") not in (None, "", 0) else None,
            (data.get("notas") or "").strip() or None,
            usuario_id,
        ))
        db.commit()
    return listar_compras_ticket(ticket_id), None


def actualizar_compra_ticket(item_id: int, data: dict) -> tuple:
    with _conn() as db:
        row = db.execute("SELECT ticket_id FROM lista_compras_ticket WHERE id=?", (item_id,)).fetchone()
        if not row:
            return None, "Item no encontrado"
        tid = row["ticket_id"]
        campos = {}
        if "nombre" in data and (data["nombre"] or "").strip():
            campos["nombre"] = data["nombre"].strip()
        if "sku" in data:
            campos["sku"] = (data["sku"] or "").strip() or None
        if "cantidad" in data and data["cantidad"] is not None:
            campos["cantidad"] = float(data["cantidad"])
        if "unidad" in data and data["unidad"]:
            campos["unidad"] = data["unidad"].strip()
        if "precio_estimado" in data:
            campos["precio_estimado"] = float(data["precio_estimado"]) if data["precio_estimado"] not in (None, "", 0) else None
        if "notas" in data:
            campos["notas"] = (data["notas"] or "").strip() or None
        if "comprado" in data:
            campos["comprado"] = 1 if data["comprado"] in (1, True, "1", "true") else 0
        if "material_id" in data:
            campos["material_id"] = int(data["material_id"]) if data["material_id"] else None
        if not campos:
            return listar_compras_ticket(tid), None
        set_sql = ", ".join(f"{k}=?" for k in campos)
        db.execute(
            f"UPDATE lista_compras_ticket SET {set_sql}, actualizado_en=datetime('now') WHERE id=?",
            [*campos.values(), item_id],
        )
        db.commit()
    return listar_compras_ticket(tid), None


def eliminar_compra_ticket(item_id: int) -> tuple:
    with _conn() as db:
        row = db.execute("SELECT ticket_id FROM lista_compras_ticket WHERE id=?", (item_id,)).fetchone()
        if not row:
            return None, "Item no encontrado"
        tid = row["ticket_id"]
        db.execute("DELETE FROM lista_compras_ticket WHERE id=?", (item_id,))
        db.commit()
    return listar_compras_ticket(tid), None


def buscar_productos_para_compra(q: str, limite: int = 15) -> list:
    """Busca en materiales_catalogo por nombre o codigo para autocompletar lista de compras."""
    q = (q or "").strip()
    if not q:
        return []
    pattern = f"%{q}%"
    with _conn() as db:
        rows = db.execute("""
            SELECT id, nombre, unidad, tipo
            FROM materiales_catalogo
            WHERE activo=1 AND nombre LIKE ?
            ORDER BY nombre LIMIT ?
        """, (pattern, limite)).fetchall()
        return [dict(r) for r in rows]


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
    """Si todos los pasos están marcados, cierra el ticket como resuelto.
    Las solicitudes NO se auto-cierran — solo el botón Listo puede hacerlo."""
    if not _pasos_checklist_completo(db, ticket_id):
        return False
    t = db.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
    if not t or t["estado"] in ("resuelto", "rechazado"):
        return False
    if t["tipo"] == "solicitud":
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
    duracion_segundos: int | None = None,
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
        dur_sql = ""
        dur_params: list = []
        if nuevo == 1 and duracion_segundos is not None:
            dur = max(0, int(duracion_segundos))
            dur_sql = ", duracion_segundos=?"
            dur_params = [dur]
        db.execute(
            f"UPDATE ticket_pasos SET completado=?, completado_en=?, completado_por=?{dur_sql} WHERE id=?",
            (
                nuevo,
                datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S") if nuevo else None,
                usuario_id if nuevo else None,
                *dur_params,
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
    if slug in ("rrhh", "logistica", "mantenimiento", "contratos"):
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


# ── ETIQUETAS AVANZADAS (Cynthia) ─────────────────────────────────────────────

_CYNTHIA_ETIQUETAS_EMAILS = frozenset({
    "cynthua0418@gmail.com",
})


def es_cynthia_etiquetas(usuario: dict | None) -> bool:
    """Studio / Papel-tinta / EAN: solo Cynthia Ruiz (usuarios.id=6). Sin bypass admin."""
    if not usuario:
        return False
    try:
        uid = int(usuario.get("id") or 0)
    except (TypeError, ValueError):
        uid = 0
    if uid == 6:
        return True
    username = (usuario.get("username") or "").strip().lower().lstrip("@")
    if username == "cynthia":
        return True
    email = (usuario.get("email") or "").strip().lower()
    return email in _CYNTHIA_ETIQUETAS_EMAILS


def es_admin_efectivo(usuario: dict | None) -> bool:
    """Admin real (nivel >= 3) o Cynthia con privilegios de administrador en el panel."""
    if not usuario:
        return False
    if ((usuario.get("rol") or {}).get("nivel", 0)) >= 3:
        return True
    return es_cynthia_etiquetas(usuario)


def es_admin_vista_equipo(usuario: dict | None) -> bool:
    """Métricas/acciones/historial de todo el equipo: solo admin real.

    Cynthia puede tener nivel 3 elevado para menú/API, pero su Agenda y Acciones
    siguen siendo personales (no ve la agenda del administrador).
    """
    if not usuario:
        return False
    if es_cynthia_etiquetas(usuario):
        return False
    return int((usuario.get("rol") or {}).get("nivel") or 0) >= 3


def aplicar_privilegios_admin_cynthia(usuario: dict | None) -> dict | None:
    """Copia del usuario con rol.nivel=3 si es Cynthia (menú/API como administrador).

    No implica vista de equipo: usar es_admin_vista_equipo para Agenda/Acciones.
    """
    if not usuario or not es_cynthia_etiquetas(usuario):
        return usuario
    u = dict(usuario)
    rol = dict(u.get("rol") or {})
    if int(rol.get("nivel") or 0) < 3:
        rol["nivel"] = 3
        if not rol.get("id"):
            rol["id"] = rol.get("id") or 0
        if not (rol.get("nombre") or "").strip():
            rol["nombre"] = "Administrador"
        u["rol"] = rol
    return u


def puede_ver_studio_visual(usuario: dict | None) -> bool:
    """Alias histórico; misma regla que es_cynthia_etiquetas."""
    return es_cynthia_etiquetas(usuario)


# ── PROTOCOLOS ────────────────────────────────────────────────────────────────

_PROTOCOLOS_CREAR_EMAILS = frozenset({
    "cynthua0418@gmail.com",
})


def puede_crear_protocolos(usuario: dict | None) -> bool:
    """Supervisor+, permiso tickets_protocolos_crear o correos autorizados."""
    if not usuario:
        return False
    nivel = (usuario.get("rol") or {}).get("nivel") or 0
    if nivel >= 2:
        return True
    email = (usuario.get("email") or "").strip().lower()
    if email in _PROTOCOLOS_CREAR_EMAILS:
        return True
    permisos = usuario.get("permisos_secciones") or {}
    return bool(permisos.get("tickets_protocolos_crear"))


def _pasos_desde_protocolo(db, protocolo_id: int) -> list:
    import json
    row = db.execute(
        "SELECT pasos FROM protocolos WHERE id=? AND activo=1", (protocolo_id,),
    ).fetchone()
    if not row:
        return []
    try:
        return json.loads(row["pasos"]) if row["pasos"] else []
    except Exception:
        return []


def listar_protocolos(usuario: dict | None = None, alcance: str | None = None) -> list:
    import json
    with _conn() as db:
        conds = ["p.activo = 1"]
        params: list = []
        if alcance == "personal":
            conds.append("p.alcance = 'personal'")
            if usuario:
                conds.append("p.creado_por = ?")
                params.append(usuario["id"])
        elif alcance == "mis":
            # Todos los protocolos creados por este usuario + compartidos específicamente con él
            if usuario:
                uid = usuario["id"]
                conds.append(
                    "(p.creado_por = ? OR (p.alcance = 'seleccionado' AND EXISTS("
                    "  SELECT 1 FROM protocolo_accesos pa WHERE pa.protocolo_id = p.id AND pa.usuario_id = ?"
                    ")))",
                )
                params.extend([uid, uid])
        elif alcance == "global":
            conds.append("(p.alcance IS NULL OR p.alcance = 'global')")
        elif usuario:
            uid = usuario["id"]
            conds.append(
                "(p.alcance IS NULL OR p.alcance = 'global' OR "
                " (p.alcance = 'personal' AND p.creado_por = ?) OR "
                " (p.alcance = 'seleccionado' AND ("
                "   p.creado_por = ? OR EXISTS("
                "     SELECT 1 FROM protocolo_accesos pa"
                "     WHERE pa.protocolo_id = p.id AND pa.usuario_id = ?"
                "   )"
                " )))",
            )
            params.extend([uid, uid, uid])
        where = " AND ".join(conds)
        rows = db.execute(f"""
            SELECT p.*, u.nombre AS creado_por_nombre,
                   t.numero AS ticket_origen_numero, t.titulo AS ticket_origen_titulo
            FROM protocolos p
            LEFT JOIN usuarios u ON u.id = p.creado_por
            LEFT JOIN tickets t ON t.id = p.ticket_origen
            WHERE {where}
            ORDER BY p.creado_en DESC
        """, params).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            try:
                d["pasos"] = json.loads(d["pasos"]) if d["pasos"] else []
            except Exception:
                d["pasos"] = []
            try:
                d["lista_compras"] = json.loads(d.get("lista_compras") or "[]")
            except Exception:
                d["lista_compras"] = []
            if not d.get("alcance"):
                d["alcance"] = "global"
            if d["alcance"] == "seleccionado":
                shared = db.execute(
                    "SELECT u.id, u.nombre FROM usuarios u "
                    "JOIN protocolo_accesos pa ON pa.usuario_id = u.id "
                    "WHERE pa.protocolo_id = ?",
                    (d["id"],),
                ).fetchall()
                d["usuarios_compartidos"] = [{"id": r["id"], "nombre": r["nombre"]} for r in shared]
            else:
                d["usuarios_compartidos"] = []
            result.append(d)
        return result


def _notas_lista_compras_json(items: list) -> str:
    lineas = ["📦 Lista de compras:"]
    for it in items or []:
        if not isinstance(it, dict):
            continue
        nombre = (it.get("n") or it.get("nombre") or "").strip()
        if not nombre:
            continue
        cant = (it.get("cantidad") or it.get("c") or "").strip()
        unidad = (it.get("unidad") or "g").strip()
        suf = f"{cant} {unidad}" if cant else ""
        lineas.append(f"• {nombre}" + (f" — {suf}" if suf else ""))
    return "\n".join(lineas)


def _extraer_plantilla_desde_ticket(db, ticket_id: int) -> tuple[list, list]:
    """Separa pasos de ejecución y lista de compras desde ticket_pasos.

    Incluye adjuntos_ref (imágenes/archivos subidos al paso) para que sirvan
    como guía visual al repetir el protocolo.
    """
    import json
    rows = db.execute(
        "SELECT id, descripcion, notas FROM ticket_pasos WHERE ticket_id=? ORDER BY orden",
        (ticket_id,),
    ).fetchall()
    pasos_ejec = []
    lista_compras: list = []
    for r in rows:
        desc = (r["descripcion"] or "").strip()
        notas = (r["notas"] or "").strip()
        if desc == "Ir de compras":
            for line in (notas or "").split("\n"):
                line = line.strip()
                if not line.startswith("•"):
                    continue
                body = line.lstrip("•").strip()
                nombre, cantidad, unidad = body, "", "g"
                if "—" in body:
                    nombre, resto = body.split("—", 1)
                    nombre = nombre.strip()
                    partes = resto.strip().split()
                    if len(partes) >= 2:
                        cantidad, unidad = partes[0], partes[1]
                    elif len(partes) == 1:
                        cantidad = partes[0]
                lista_compras.append({
                    "n": nombre, "cantidad": cantidad, "unidad": unidad if unidad in ("g", "u") else "g",
                    "comprado": False,
                })
        elif desc:
            adj_rows = db.execute(
                "SELECT nombre_archivo, mime FROM ticket_adjuntos "
                "WHERE paso_id=? ORDER BY creado_en LIMIT 5",
                (r["id"],),
            ).fetchall()
            paso_dict: dict = {"descripcion": desc, "notas": notas or None}
            if adj_rows:
                paso_dict["adjuntos_ref"] = [
                    {"nombre_archivo": a["nombre_archivo"], "mime": a["mime"] or ""}
                    for a in adj_rows
                ]
            pasos_ejec.append(paso_dict)
    return pasos_ejec, lista_compras


def guardar_procedimiento_desde_accion(
    ticket_id: int,
    usuario_id: int,
    lista_compras: list | None = None,
    alcance: str = "personal",
) -> tuple:
    """Guarda o actualiza un procedimiento (personal o compartido) a partir de una acción terminada."""
    import json
    with _conn() as db:
        t = db.execute(
            "SELECT id, titulo, descripcion, categoria, tipo, creado_por, asignado_a "
            "FROM tickets WHERE id=?",
            (ticket_id,),
        ).fetchone()
        if not t:
            return None, "Acción no encontrada"
        if t["tipo"] not in ("accion", "solicitud"):
            return None, "Solo aplica a acciones o solicitudes"
        if t["creado_por"] != usuario_id and t["asignado_a"] != usuario_id:
            return None, "Sin permiso para guardar este procedimiento"
        pasos_ejec, lista_parseada = _extraer_plantilla_desde_ticket(db, ticket_id)
        lista_final = lista_compras if lista_compras is not None else lista_parseada
        existente = db.execute(
            "SELECT id FROM protocolos WHERE ticket_origen=? AND activo=1",
            (ticket_id,),
        ).fetchone()
        pasos_json = json.dumps(pasos_ejec, ensure_ascii=False)
        lista_json = json.dumps(lista_final or [], ensure_ascii=False)
        titulo = (t["titulo"] or "").strip()
        alcance_val = alcance if alcance in ("personal", "global") else "personal"
        if existente:
            db.execute(
                """UPDATE protocolos SET titulo=?, descripcion=?, categoria=?,
                   pasos=?, lista_compras=?, alcance=?, creado_en=datetime('now') WHERE id=?""",
                (titulo, t["descripcion"], t["categoria"], pasos_json, lista_json,
                 alcance_val, existente["id"]),
            )
            protocolo_id = existente["id"]
        else:
            db.execute(
                """INSERT INTO protocolos
                   (titulo, descripcion, categoria, pasos, lista_compras, ticket_origen,
                    creado_por, alcance)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (titulo, t["descripcion"], t["categoria"], pasos_json, lista_json,
                 ticket_id, usuario_id, alcance_val),
            )
            protocolo_id = db.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
        db.execute(
            "UPDATE tickets SET protocolo_id=?, actualizado_en=datetime('now') WHERE id=?",
            (protocolo_id, ticket_id),
        )
        _log(db, ticket_id, usuario_id, "procedimiento_guardado",
             detalles=f"Procedimiento personal #{protocolo_id}")
        db.commit()
        return {"id": protocolo_id, "titulo": titulo, "pasos": pasos_ejec, "lista_compras": lista_final}, None


def crear_accion_desde_procedimiento(
    protocolo_id: int,
    usuario_id: int,
    solicitud_padre_id: int | None = None,
) -> tuple:
    """Nueva ejecución de acción a partir de un procedimiento/protocolo guardado."""
    import json
    with _conn() as db:
        p = db.execute(
            "SELECT * FROM protocolos WHERE id=? AND activo=1", (protocolo_id,),
        ).fetchone()
        if not p:
            return None, "Procedimiento no encontrado"
        alcance = (p["alcance"] or "global").strip()
        if alcance == "personal" and p["creado_por"] != usuario_id:
            return None, "Procedimiento personal de otro usuario"
        if solicitud_padre_id:
            sol = db.execute(
                "SELECT id, tipo, asignado_a, titulo, descripcion, categoria, protocolo_id "
                "FROM tickets WHERE id=?",
                (solicitud_padre_id,),
            ).fetchone()
            if not sol or sol["tipo"] != "solicitud":
                return None, "Solicitud padre no válida"
            if sol["asignado_a"] != usuario_id:
                return None, "Solo el asignado puede ejecutar esta solicitud"
    try:
        pasos_prot = json.loads(p["pasos"]) if p["pasos"] else []
    except Exception:
        pasos_prot = []
    try:
        lista = json.loads(p.get("lista_compras") or "[]")
    except Exception:
        lista = []
    pasos_raw: list = []
    if lista:
        pasos_raw.append({
            "descripcion": "Ir de compras",
            "notas": _notas_lista_compras_json(lista),
        })
    pasos_raw.extend(pasos_prot)
    data = {
        "titulo": p["titulo"],
        "descripcion": (p["descripcion"] or p["titulo"]),
        "categoria": p["categoria"] or "logistica",
        "prioridad": "media",
        "asignado_a": usuario_id,
        "tipo": "accion",
        "pasos": pasos_raw,
        "protocolo_id": protocolo_id,
        "ticket_padre_id": solicitud_padre_id,
    }
    return crear_ticket(data, usuario_id)


def listar_acciones_historial(usuario_id: int, limit: int = 80, todos: bool = False) -> list:
    """Acciones resueltas. Si todos=True devuelve las de todo el equipo (solo para admins)."""
    with _conn() as db:
        if todos:
            rows = db.execute("""
                SELECT t.*,
                       pr.id AS procedimiento_id,
                       pr.titulo AS procedimiento_titulo,
                       pr.alcance AS procedimiento_alcance,
                       u.nombre AS responsable_nombre
                FROM tickets t
                LEFT JOIN protocolos pr ON pr.id = t.protocolo_id AND pr.activo = 1
                LEFT JOIN usuarios u ON u.id = COALESCE(t.asignado_a, t.creado_por)
                WHERE t.tipo = 'accion'
                  AND t.estado = 'resuelto'
                ORDER BY t.actualizado_en DESC
                LIMIT ?
            """, (limit,)).fetchall()
        else:
            rows = db.execute("""
                SELECT t.*,
                       pr.id AS procedimiento_id,
                       pr.titulo AS procedimiento_titulo,
                       pr.alcance AS procedimiento_alcance,
                       u.nombre AS responsable_nombre
                FROM tickets t
                LEFT JOIN protocolos pr ON pr.id = t.protocolo_id AND pr.activo = 1
                LEFT JOIN usuarios u ON u.id = COALESCE(t.asignado_a, t.creado_por)
                WHERE t.tipo = 'accion'
                  AND t.estado = 'resuelto'
                  AND (t.creado_por = ? OR t.asignado_a = ?)
                ORDER BY t.actualizado_en DESC
                LIMIT ?
            """, (usuario_id, usuario_id, limit)).fetchall()
    usuario_stub = {"id": usuario_id, "rol": {"nivel": 3}}
    out = []
    for r in rows:
        t = get_ticket(r["id"], usuario_stub)
        if t:
            t["procedimiento_id"] = r["procedimiento_id"]
            t["procedimiento_titulo"] = r["procedimiento_titulo"]
            t["procedimiento_alcance"] = r["procedimiento_alcance"]
            t["responsable_nombre"] = r["responsable_nombre"]
            out.append(t)
    return out


def obtener_protocolo(protocolo_id: int) -> dict | None:
    import json
    items = listar_protocolos()
    for p in items:
        if p.get("id") == protocolo_id:
            return p
    with _conn() as db:
        row = db.execute(
            "SELECT * FROM protocolos WHERE id=? AND activo=1", (protocolo_id,),
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        try:
            d["pasos"] = json.loads(d["pasos"]) if d["pasos"] else []
        except Exception:
            d["pasos"] = []
        try:
            d["lista_compras"] = json.loads(d.get("lista_compras") or "[]")
        except Exception:
            d["lista_compras"] = []
        return d


def completar_accion_y_reportar_solicitud(
    accion_id: int,
    usuario_id: int,
    reporte_texto: str = "",
    marcar_solicitud_resuelta: bool = True,
) -> tuple:
    """Cierra la acción y, si viene de una solicitud, publica reporte al solicitante."""
    reporte = (reporte_texto or "").strip()
    with _conn() as db:
        a = db.execute("SELECT * FROM tickets WHERE id=?", (accion_id,)).fetchone()
        if not a or a["tipo"] != "accion":
            return None, "Acción no encontrada"
        if a["asignado_a"] != usuario_id and a["creado_por"] != usuario_id:
            return None, "Sin permiso"
        padre_id = a["ticket_padre_id"]
        if padre_id:
            padre = db.execute("SELECT id, tipo, creado_por, numero FROM tickets WHERE id=?", (padre_id,)).fetchone()
            if padre and padre["tipo"] == "solicitud":
                if reporte:
                    u = db.execute("SELECT nombre FROM usuarios WHERE id=?", (usuario_id,)).fetchone()
                    nombre = u["nombre"] if u else "Operador"
                    msg = (
                        f"📋 **Reporte de ejecución** — acción {a['numero']}\n"
                        f"Por: {nombre}\n\n{reporte}"
                    )
                    db.execute(
                        "INSERT INTO comentarios_tickets (ticket_id, usuario_id, texto, es_interno) "
                        "VALUES (?,?,?,0)",
                        (padre_id, usuario_id, msg),
                    )
                    _log(db, padre_id, usuario_id, "reporte_ejecucion",
                         detalles=f"Desde acción {a['numero']}")
                # Cerrar la solicitud padre siempre que se indique, independiente de si hay reporte
                if marcar_solicitud_resuelta:
                    db.execute(
                        "UPDATE tickets SET estado='resuelto', actualizado_en=datetime('now') WHERE id=?",
                        (padre_id,),
                    )
                    _log(db, padre_id, usuario_id, "estado_cambiado",
                         val_ant="en_proceso", val_new="resuelto",
                         detalles="Solicitud cerrada al terminar la acción asociada")
        db.execute(
            "UPDATE tickets SET estado='resuelto', actualizado_en=datetime('now') WHERE id=?",
            (accion_id,),
        )
        _log(db, accion_id, usuario_id, "estado_cambiado",
             val_ant=a["estado"], val_new="resuelto", detalles="Acción terminada")
        db.commit()
    usuario_stub = {"id": usuario_id, "rol": {"nivel": 3}}
    return get_ticket(accion_id, usuario_stub), None


def promover_procedimiento_a_protocolo(protocolo_id: int, usuario_id: int, nivel: int) -> tuple:
    """Procedimiento personal → compartido con el equipo (cualquier usuario puede compartir el suyo)."""
    with _conn() as db:
        p = db.execute(
            "SELECT id, alcance, creado_por FROM protocolos WHERE id=? AND activo=1", (protocolo_id,),
        ).fetchone()
        if not p:
            return None, "Procedimiento no encontrado"
        if p["creado_por"] != usuario_id and nivel < 2:
            return None, "Solo el creador o un supervisor puede compartir este procedimiento"
        db.execute("UPDATE protocolos SET alcance='global' WHERE id=?", (protocolo_id,))
        db.commit()
        return {"id": protocolo_id, "alcance": "global"}, None


def hacer_procedimiento_personal(protocolo_id: int, usuario_id: int, nivel: int) -> tuple:
    """Procedimiento compartido → privado (solo el creador o supervisor)."""
    return cambiar_visibilidad_protocolo(protocolo_id, "personal", [], usuario_id, nivel)


def cambiar_visibilidad_protocolo(
    protocolo_id: int,
    alcance: str,
    usuario_ids: list,
    usuario_id: int,
    nivel: int,
) -> tuple:
    """Cambia la visibilidad de un procedimiento: personal / global / seleccionado."""
    if alcance not in ("personal", "global", "seleccionado"):
        return None, "Alcance inválido"
    if alcance == "seleccionado" and not usuario_ids:
        return None, "Debes seleccionar al menos un usuario"
    with _conn() as db:
        p = db.execute(
            "SELECT id, alcance, creado_por FROM protocolos WHERE id=? AND activo=1",
            (protocolo_id,),
        ).fetchone()
        if not p:
            return None, "Procedimiento no encontrado"
        if p["creado_por"] != usuario_id and nivel < 2:
            return None, "Solo el creador o un supervisor puede cambiar la visibilidad"
        db.execute("UPDATE protocolos SET alcance=? WHERE id=?", (alcance, protocolo_id))
        db.execute("DELETE FROM protocolo_accesos WHERE protocolo_id=?", (protocolo_id,))
        shared: list = []
        if alcance == "seleccionado":
            for uid in set(int(u) for u in usuario_ids if u != usuario_id):
                db.execute(
                    "INSERT OR IGNORE INTO protocolo_accesos (protocolo_id, usuario_id) VALUES (?,?)",
                    (protocolo_id, uid),
                )
            rows = db.execute(
                "SELECT u.id, u.nombre FROM usuarios u "
                "JOIN protocolo_accesos pa ON pa.usuario_id = u.id "
                "WHERE pa.protocolo_id=?",
                (protocolo_id,),
            ).fetchall()
            shared = [{"id": r["id"], "nombre": r["nombre"]} for r in rows]
        db.commit()
        return {"id": protocolo_id, "alcance": alcance, "usuarios_compartidos": shared}, None


def obtener_plantilla_accion(ticket_id: int, usuario_id: int) -> tuple:
    """Plantilla reutilizable desde una acción (historial), con o sin procedimiento guardado."""
    with _conn() as db:
        t = db.execute(
            "SELECT id, titulo, tipo, creado_por, asignado_a, protocolo_id, estado "
            "FROM tickets WHERE id=?",
            (ticket_id,),
        ).fetchone()
        if not t:
            return None, "Acción no encontrada"
        if t["tipo"] != "accion":
            return None, "Solo aplica a acciones"
        if t["creado_por"] != usuario_id and t["asignado_a"] != usuario_id:
            return None, "Sin permiso"
        pasos_ejec, lista_compras = _extraer_plantilla_desde_ticket(db, ticket_id)
    return {
        "titulo": (t["titulo"] or "").strip(),
        "lista_compras": lista_compras,
        "pasos": pasos_ejec,
        "protocolo_id": t["protocolo_id"],
    }, None


def _unidad_item_compra_delegada(unidad: str) -> str:
    u = (unidad or "g").strip().lower()
    if u in ("u", "und", "un", "unidad", "unidades"):
        return "und"
    return "g"


def crear_solicitud_compra_delegada(
    accion_id: int,
    asignado_a: int,
    items: list,
    usuario_id: int,
) -> tuple:
    """Crea solicitud tipo compra (solo checklist) para otro usuario."""
    try:
        asignado_a = int(asignado_a)
    except (TypeError, ValueError):
        return None, "Usuario asignado inválido"
    if asignado_a == usuario_id:
        return None, "Elige otro usuario para las compras"
    items_ok = []
    for it in items or []:
        if not isinstance(it, dict):
            continue
        nombre = (it.get("n") or it.get("nombre") or "").strip()
        if not nombre:
            continue
        cant = (it.get("cantidad") or it.get("c") or "1").strip() or "1"
        try:
            cant_f = float(str(cant).replace(",", "."))
        except ValueError:
            cant_f = 1.0
        items_ok.append({
            "nombre": nombre,
            "cantidad": cant_f,
            "unidad": _unidad_item_compra_delegada(it.get("unidad")),
        })
    if not items_ok:
        return None, "La lista de compras está vacía"

    with _conn() as db:
        acc = db.execute(
            "SELECT id, titulo, numero, tipo, creado_por, asignado_a FROM tickets WHERE id=?",
            (accion_id,),
        ).fetchone()
        if not acc or acc["tipo"] != "accion":
            return None, "Acción no encontrada"
        if acc["creado_por"] != usuario_id and acc["asignado_a"] != usuario_id:
            return None, "Sin permiso sobre esta acción"
        u = db.execute("SELECT id, nombre FROM usuarios WHERE id=? AND activo=1", (asignado_a,)).fetchone()
        if not u:
            return None, "Usuario no encontrado"

        numero = _generar_numero(db)
        titulo_sol = f"Compras: {(acc['titulo'] or 'acción').strip()}"
        desc = f"Lista de compras delegada desde acción {acc['numero']}."
        db.execute("""
            INSERT INTO tickets
                (numero, titulo, categoria, descripcion, prioridad,
                 creado_por, asignado_a, soporte_archivo, tipo,
                 frecuencia, fecha_inicio, ticket_padre_id, subtipo)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            numero, titulo_sol, "logistica", desc, "media",
            usuario_id, asignado_a, None, "solicitud",
            None, None, accion_id, "compra",
        ))
        sol_id = db.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
        _log(db, sol_id, usuario_id, "ticket_creado",
             detalles=f"Solicitud de compra {numero} delegada desde {acc['numero']}")
        _log(db, sol_id, usuario_id, "asignado", val_new=str(asignado_a),
             detalles="Compras delegadas")

        for it in items_ok:
            db.execute("""
                INSERT INTO lista_compras_ticket
                    (ticket_id, nombre, cantidad, unidad, comprado, creado_por)
                VALUES (?,?,?,?,0,?)
            """, (sol_id, it["nombre"], it["cantidad"], it["unidad"], usuario_id))

        acc_estado = db.execute("SELECT estado FROM tickets WHERE id=?", (accion_id,)).fetchone()
        if acc_estado and acc_estado["estado"] not in ("resuelto", "rechazado"):
            db.execute(
                "UPDATE tickets SET bloqueado_por=?, actualizado_en=datetime('now') WHERE id=?",
                (sol_id, accion_id),
            )
            if acc_estado["estado"] == "pendiente":
                db.execute(
                    "UPDATE tickets SET estado='en_proceso', actualizado_en=datetime('now') WHERE id=?",
                    (accion_id,),
                )
            _log(db, accion_id, usuario_id, "estado_cambiado",
                 val_ant=acc_estado["estado"], val_new="en_proceso",
                 detalles=f"Bloqueado — esperando compras {numero} ({u['nombre']})")

        _log(db, accion_id, usuario_id, "compras_delegadas",
             detalles=f"Solicitud {numero} → {u['nombre']}")
        db.commit()
        try:
            from app.services.tickets_notificaciones import notificar_compra_delegada
            from app.observability import spawn_thread
            spawn_thread(notificar_compra_delegada, (sol_id,), daemon=True)
        except Exception:
            pass

    usuario_stub = {"id": usuario_id, "rol": {"nivel": 3}}
    sol = get_ticket(sol_id, usuario_stub)
    padre = get_ticket(accion_id, usuario_stub)
    return {"solicitud": sol, "accion": padre}, None


def estado_bloqueo_compras_accion(accion_id: int, usuario_id: int) -> dict | None:
    """Si la acción espera una solicitud de compra delegada, devuelve datos del bloqueo."""
    with _conn() as db:
        acc = db.execute(
            "SELECT id, bloqueado_por, creado_por, asignado_a FROM tickets WHERE id=?",
            (accion_id,),
        ).fetchone()
        if not acc or acc["creado_por"] != usuario_id and acc["asignado_a"] != usuario_id:
            return None
        bid = acc["bloqueado_por"]
        if not bid:
            return None
        sol = db.execute(
            "SELECT id, numero, titulo, estado, subtipo, asignado_a FROM tickets WHERE id=?",
            (bid,),
        ).fetchone()
        if not sol or (sol["subtipo"] or "").strip() != "compra":
            return None
        if sol["estado"] in ("resuelto", "rechazado"):
            return None
        ua = db.execute("SELECT nombre FROM usuarios WHERE id=?", (sol["asignado_a"],)).fetchone()
        return {
            "solicitud_id": sol["id"],
            "numero": sol["numero"],
            "titulo": sol["titulo"],
            "estado": sol["estado"],
            "asignado_nombre": ua["nombre"] if ua else None,
        }


def crear_protocolo(titulo: str, descripcion: str, categoria: str,
                    pasos: list, usuario_id: int) -> tuple:
    import json
    titulo = titulo.strip()
    if not titulo:
        return None, "El título es requerido"
    with _conn() as db:
        db.execute(
            """INSERT INTO protocolos (titulo, descripcion, categoria, pasos, creado_por)
               VALUES (?, ?, ?, ?, ?)""",
            (titulo, descripcion or None, categoria or None,
             json.dumps(pasos or [], ensure_ascii=False), usuario_id),
        )
        protocolo_id = db.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
        db.commit()
        return {"id": protocolo_id, "titulo": titulo, "pasos": pasos or []}, None


def crear_protocolo_desde_ticket(ticket_id: int, titulo: str, descripcion: str,
                                  categoria: str, usuario_id: int) -> tuple:
    import json
    titulo = titulo.strip()
    if not titulo:
        return None, "El título es requerido"
    with _conn() as db:
        t = db.execute(
            "SELECT id, estado FROM tickets WHERE id=?", (ticket_id,)
        ).fetchone()
        if not t:
            return None, "Ticket no encontrado"
        pasos_rows = db.execute(
            "SELECT id, descripcion, notas FROM ticket_pasos WHERE ticket_id=? ORDER BY orden",
            (ticket_id,),
        ).fetchall()
        pasos = []
        for r in pasos_rows:
            paso_dict = {"descripcion": r["descripcion"], "notas": r["notas"]}
            adj_rows = db.execute(
                "SELECT nombre_archivo, mime FROM ticket_adjuntos "
                "WHERE paso_id=? ORDER BY creado_en LIMIT 5",
                (r["id"],),
            ).fetchall()
            if adj_rows:
                paso_dict["adjuntos_ref"] = [
                    {"nombre_archivo": a["nombre_archivo"], "mime": a["mime"] or ""}
                    for a in adj_rows
                ]
            pasos.append(paso_dict)
        db.execute(
            """INSERT INTO protocolos (titulo, descripcion, categoria, pasos, ticket_origen, creado_por)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (titulo, descripcion or None, categoria or None,
             json.dumps(pasos, ensure_ascii=False), ticket_id, usuario_id),
        )
        protocolo_id = db.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
        _log(db, ticket_id, usuario_id, "protocolo_creado",
             detalles=f"Protocolo '{titulo}' creado desde este ticket")
        db.commit()
        return {"id": protocolo_id, "titulo": titulo, "pasos": pasos}, None


def actualizar_protocolo(protocolo_id: int, titulo: str, descripcion: str,
                          categoria: str, pasos: list, usuario_id: int,
                          nivel: int = 2) -> tuple:
    import json
    titulo = titulo.strip()
    if not titulo:
        return None, "El título es requerido"
    with _conn() as db:
        p = db.execute("SELECT id, creado_por FROM protocolos WHERE id=? AND activo=1", (protocolo_id,)).fetchone()
        if not p:
            return None, "Protocolo no encontrado"
        if nivel < 2 and p["creado_por"] != usuario_id:
            return None, "Solo el creador o un supervisor puede editar este procedimiento"
        db.execute(
            """UPDATE protocolos SET titulo=?, descripcion=?, categoria=?, pasos=?
               WHERE id=?""",
            (titulo, descripcion or None, categoria or None,
             json.dumps(pasos or [], ensure_ascii=False), protocolo_id),
        )
        db.commit()
        return {"id": protocolo_id, "titulo": titulo}, None


def eliminar_protocolo(protocolo_id: int, usuario_id: int, nivel: int = 2) -> tuple:
    with _conn() as db:
        p = db.execute(
            "SELECT id, creado_por FROM protocolos WHERE id=? AND activo=1",
            (protocolo_id,),
        ).fetchone()
        if not p:
            return False, "Protocolo no encontrado"
        if nivel < 2 and p["creado_por"] != usuario_id:
            return False, "Solo el creador o un supervisor puede eliminar este procedimiento"
        db.execute("UPDATE protocolos SET activo=0 WHERE id=?", (protocolo_id,))
        db.commit()
        return True, None


def _puede_vincular_protocolo_ticket(db, ticket_id: int, usuario_id: int, nivel: int) -> tuple:
    t = db.execute("SELECT id, creado_por, asignado_a FROM tickets WHERE id=?", (ticket_id,)).fetchone()
    if not t:
        return None, "Ticket no encontrado"
    if nivel >= 2:
        return t, None
    if t["creado_por"] == usuario_id or t["asignado_a"] == usuario_id:
        return t, None
    is_part = db.execute(
        "SELECT 1 FROM ticket_participantes WHERE ticket_id=? AND usuario_id=?",
        (ticket_id, usuario_id),
    ).fetchone()
    if is_part:
        return t, None
    return None, "Sin permisos para vincular protocolo"


def vincular_protocolo_a_ticket(ticket_id: int, protocolo_id: int, usuario_id: int,
                                 nivel: int = 1, reemplazar_pasos: bool = False) -> tuple:
    with _conn() as db:
        t, err = _puede_vincular_protocolo_ticket(db, ticket_id, usuario_id, nivel)
        if err:
            return None, err
        p = db.execute(
            "SELECT id, titulo FROM protocolos WHERE id=? AND activo=1", (protocolo_id,),
        ).fetchone()
        if not p:
            return None, "Protocolo no encontrado"
        pasos_prot = _pasos_desde_protocolo(db, protocolo_id)
        total = db.execute(
            "SELECT COUNT(*) AS n FROM ticket_pasos WHERE ticket_id=?", (ticket_id,),
        ).fetchone()["n"]
        completados = db.execute(
            "SELECT COUNT(*) AS n FROM ticket_pasos WHERE ticket_id=? AND completado=1",
            (ticket_id,),
        ).fetchone()["n"]
        if total > 0 and not reemplazar_pasos:
            db.execute(
                "UPDATE tickets SET protocolo_id=?, actualizado_en=datetime('now') WHERE id=?",
                (protocolo_id, ticket_id),
            )
            _log(db, ticket_id, usuario_id, "protocolo_vinculado",
                 detalles=f"Protocolo '{p['titulo']}' vinculado (pasos existentes conservados)")
            db.commit()
            return _ticket_full(db, ticket_id), None
        if completados > 0 and reemplazar_pasos:
            return None, "No se pueden reemplazar pasos con progreso completado"
        if reemplazar_pasos or total == 0:
            db.execute("DELETE FROM ticket_pasos WHERE ticket_id=?", (ticket_id,))
            _insertar_pasos_ticket(db, ticket_id, pasos_prot)
        db.execute(
            "UPDATE tickets SET protocolo_id=?, actualizado_en=datetime('now') WHERE id=?",
            (protocolo_id, ticket_id),
        )
        det = f"Protocolo '{p['titulo']}' vinculado"
        if reemplazar_pasos or total == 0:
            det += f" con {len(pasos_prot)} paso(s)"
        _log(db, ticket_id, usuario_id, "protocolo_vinculado", detalles=det)
        db.commit()
        return _ticket_full(db, ticket_id), None


# ── ADJUNTOS POR TICKET ───────────────────────────────────────────────────────

def listar_adjuntos(ticket_id: int) -> list:
    with _conn() as db:
        rows = db.execute("""
            SELECT a.*, u.nombre AS creado_por_nombre
            FROM ticket_adjuntos a
            LEFT JOIN usuarios u ON u.id = a.creado_por
            WHERE a.ticket_id = ?
            ORDER BY a.creado_en
        """, (ticket_id,)).fetchall()
        return [dict(r) for r in rows]


def registrar_adjunto(ticket_id: int, nombre_archivo: str,
                      nombre_original: str, mime: str | None,
                      usuario_id: int, paso_id: int | None = None) -> dict:
    with _conn() as db:
        db.execute(
            """INSERT INTO ticket_adjuntos
               (ticket_id, nombre_archivo, nombre_original, mime, creado_por, paso_id)
               VALUES (?,?,?,?,?,?)""",
            (ticket_id, nombre_archivo, nombre_original, mime, usuario_id, paso_id),
        )
        adj_id = db.execute("SELECT last_insert_rowid() as id").fetchone()["id"]
        _log(db, ticket_id, usuario_id, "adjunto_agregado",
             detalles=f"Archivo: {nombre_original}")
        db.commit()
        return {"id": adj_id, "nombre_archivo": nombre_archivo,
                "nombre_original": nombre_original, "mime": mime,
                "paso_id": paso_id}


def listar_adjuntos_paso(paso_id: int) -> list:
    with _conn() as db:
        rows = db.execute("""
            SELECT a.*, u.nombre AS creado_por_nombre
            FROM ticket_adjuntos a
            LEFT JOIN usuarios u ON u.id = a.creado_por
            WHERE a.paso_id = ?
            ORDER BY a.creado_en
        """, (paso_id,)).fetchall()
        return [dict(r) for r in rows]


# ── Pendientes ────────────────────────────────────────────────────────────────

def listar_pendientes(usuario_id: int) -> list:
    with _conn() as db:
        rows = db.execute("""
            SELECT * FROM pendientes
            WHERE usuario_id = ? AND estado = 'pendiente'
            ORDER BY
                CASE WHEN fecha_recordatorio IS NULL THEN 1 ELSE 0 END,
                fecha_recordatorio ASC,
                creado_en ASC
        """, (usuario_id,)).fetchall()
        return [dict(r) for r in rows]


def crear_pendiente(usuario_id: int, titulo: str,
                    descripcion: str | None = None,
                    fecha_recordatorio: str | None = None) -> dict:
    titulo = titulo.strip()
    if not titulo:
        raise ValueError("El título es requerido")
    with _conn() as db:
        db.execute(
            """INSERT INTO pendientes (usuario_id, titulo, descripcion, fecha_recordatorio)
               VALUES (?, ?, ?, ?)""",
            (usuario_id, titulo, descripcion or None, fecha_recordatorio or None),
        )
        pid = db.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
        db.commit()
        return dict(db.execute("SELECT * FROM pendientes WHERE id=?", (pid,)).fetchone())


def actualizar_pendiente(pendiente_id: int, usuario_id: int,
                         titulo: str | None = None,
                         descripcion: str | None = None,
                         fecha_recordatorio: str | None = None) -> tuple:
    with _conn() as db:
        row = db.execute(
            "SELECT * FROM pendientes WHERE id=? AND usuario_id=?",
            (pendiente_id, usuario_id),
        ).fetchone()
        if not row:
            return None, "Pendiente no encontrado"
        nuevo_titulo = (titulo or row["titulo"]).strip()
        db.execute(
            """UPDATE pendientes SET titulo=?, descripcion=?, fecha_recordatorio=?,
               actualizado_en=datetime('now') WHERE id=?""",
            (nuevo_titulo,
             descripcion if descripcion is not None else row["descripcion"],
             fecha_recordatorio if fecha_recordatorio is not None else row["fecha_recordatorio"],
             pendiente_id),
        )
        db.commit()
        return dict(db.execute("SELECT * FROM pendientes WHERE id=?", (pendiente_id,)).fetchone()), None


def descartar_pendiente(pendiente_id: int, usuario_id: int) -> tuple:
    with _conn() as db:
        row = db.execute(
            "SELECT id FROM pendientes WHERE id=? AND usuario_id=?",
            (pendiente_id, usuario_id),
        ).fetchone()
        if not row:
            return False, "Pendiente no encontrado"
        db.execute(
            "UPDATE pendientes SET estado='descartado', actualizado_en=datetime('now') WHERE id=?",
            (pendiente_id,),
        )
        db.commit()
        return True, None


def iniciar_pendiente(pendiente_id: int, usuario_id: int, ticket_id: int | None = None) -> tuple:
    """Marca el pendiente como iniciado, opcionalmente enlazándolo al ticket creado."""
    with _conn() as db:
        row = db.execute(
            "SELECT id FROM pendientes WHERE id=? AND usuario_id=?",
            (pendiente_id, usuario_id),
        ).fetchone()
        if not row:
            return False, "Pendiente no encontrado"
        db.execute(
            """UPDATE pendientes SET estado='iniciado', ticket_id=?,
               actualizado_en=datetime('now') WHERE id=?""",
            (ticket_id, pendiente_id),
        )
        db.commit()
        return True, None


def eliminar_adjunto(adjunto_id: int, usuario_id: int) -> tuple:
    with _conn() as db:
        row = db.execute(
            "SELECT nombre_archivo, ticket_id FROM ticket_adjuntos WHERE id=?",
            (adjunto_id,),
        ).fetchone()
        if not row:
            return None, "Adjunto no encontrado"
        db.execute("DELETE FROM ticket_adjuntos WHERE id=?", (adjunto_id,))
        _log(db, row["ticket_id"], usuario_id, "adjunto_eliminado",
             detalles=f"Adjunto #{adjunto_id} eliminado")
        db.commit()
        return row["nombre_archivo"], None


# ── Recordatorios ─────────────────────────────────────────────────────────────

from datetime import date, timedelta
import calendar as _calendar
import json as _json


def _add_months(d: date, meses: int) -> date:
    m = d.month - 1 + meses
    year = d.year + m // 12
    month = m % 12 + 1
    day = min(d.day, _calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _proxima_fecha(tipo: str, desde: str, cada_n: int | None,
                   dias_semana: list | None, dias_mes: list | None) -> str:
    """Calcula la próxima fecha de disparo a partir de `desde` (YYYY-MM-DD inclusive)."""
    base = date.fromisoformat(desde)
    hoy = date.today()
    inicio = base if base >= hoy else hoy

    if tipo == "una_vez":
        return base.isoformat()

    if tipo == "diario":
        return inicio.isoformat()

    if tipo == "cada_n_dias":
        n = max(1, cada_n or 1)
        if base >= hoy:
            return base.isoformat()
        delta = (hoy - base).days
        saltos = (delta // n) + (1 if delta % n else 0)
        return (base + timedelta(days=saltos * n)).isoformat()

    if tipo == "semanal":
        dias = sorted(dias_semana or [])  # 0=Mon … 6=Sun (isoweekday-1)
        if not dias:
            return inicio.isoformat()
        d = inicio
        for _ in range(14):
            if (d.isoweekday() - 1) in dias:
                return d.isoformat()
            d += timedelta(days=1)
        return inicio.isoformat()

    if tipo == "mensual":
        dias = sorted(dias_mes or [])
        if not dias:
            return inicio.isoformat()
        d = inicio
        for _ in range(62):
            if d.day in dias:
                return d.isoformat()
            d += timedelta(days=1)
        return inicio.isoformat()

    if tipo == "bimestral":
        d = base
        while d < inicio:
            d = _add_months(d, 2)
        return d.isoformat()

    return inicio.isoformat()


def _siguiente_tras_hoy(r: dict) -> str:
    """Calcula la próxima fecha POSTERIOR a hoy para avanzar tras marcar visto."""
    manana = (date.today() + timedelta(days=1)).isoformat()
    return _proxima_fecha(
        r["tipo_rep"], manana,
        r.get("cada_n_dias"), r.get("dias_semana_parsed"), r.get("dias_mes_parsed"),
    )


def _parse_rec(row) -> dict:
    d = dict(row)
    for campo in ("dias_semana", "dias_mes"):
        try:
            d[campo + "_parsed"] = _json.loads(d[campo]) if d[campo] else []
        except Exception:
            d[campo + "_parsed"] = []
    return d


def listar_recordatorios(usuario_id: int) -> list:
    with _conn() as db:
        rows = db.execute("""
            SELECT r.*,
                   u.nombre AS asignado_a_nombre,
                   c.nombre AS creado_por_nombre
            FROM recordatorios r
            LEFT JOIN usuarios u ON u.id = r.asignado_a
            LEFT JOIN usuarios c ON c.id = r.creado_por
            WHERE (r.usuario_id=? OR r.asignado_a=?) AND r.activo=1
            ORDER BY r.proxima_fecha ASC, r.creado_en ASC
        """, (usuario_id, usuario_id)).fetchall()
        return [_parse_rec(r) for r in rows]


def crear_recordatorio(usuario_id: int, titulo: str, descripcion: str | None,
                       tipo: str, fecha_inicio: str,
                       cada_n: int | None = None,
                       dias_semana: list | None = None,
                       dias_mes: list | None = None,
                       hora: str | None = None,
                       asignado_a: int | None = None) -> dict:
    proxima = _proxima_fecha(tipo, fecha_inicio, cada_n, dias_semana, dias_mes)
    hora_val = hora.strip()[:5] if hora and hora.strip() else None
    destino = asignado_a if asignado_a and asignado_a != usuario_id else None
    with _conn() as db:
        db.execute(
            """INSERT INTO recordatorios
               (usuario_id, titulo, descripcion, tipo_rep, proxima_fecha,
                cada_n_dias, dias_semana, dias_mes, hora, asignado_a, creado_por)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (usuario_id, titulo.strip(), descripcion or None, tipo, proxima,
             cada_n, _json.dumps(dias_semana) if dias_semana else None,
             _json.dumps(dias_mes) if dias_mes else None, hora_val,
             destino, usuario_id if destino else None),
        )
        rid = db.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
        db.commit()
        return _parse_rec(db.execute("SELECT * FROM recordatorios WHERE id=?", (rid,)).fetchone())


def actualizar_recordatorio(rec_id: int, usuario_id: int,
                            titulo: str | None = None,
                            descripcion: str | None = None,
                            tipo: str | None = None,
                            fecha_inicio: str | None = None,
                            cada_n: int | None = None,
                            dias_semana: list | None = None,
                            dias_mes: list | None = None,
                            hora: str | None = None,
                            asignado_a: int | None = -1) -> tuple:
    with _conn() as db:
        row = db.execute(
            "SELECT * FROM recordatorios WHERE id=? AND (usuario_id=? OR asignado_a=?) AND activo=1",
            (rec_id, usuario_id, usuario_id),
        ).fetchone()
        if not row:
            return None, "Recordatorio no encontrado"
        r = _parse_rec(row)
        nuevo_tipo = tipo or r["tipo_rep"]
        nuevo_n = cada_n if cada_n is not None else r["cada_n_dias"]
        nuevos_ds = dias_semana if dias_semana is not None else r["dias_semana_parsed"]
        nuevos_dm = dias_mes if dias_mes is not None else r["dias_mes_parsed"]
        nueva_fecha = fecha_inicio or r["proxima_fecha"]
        proxima = _proxima_fecha(nuevo_tipo, nueva_fecha, nuevo_n, nuevos_ds, nuevos_dm)
        hora_val = hora.strip()[:5] if hora and hora.strip() else r.get("hora")
        # asignado_a=-1 significa "no cambiar"; None significa "quitar asignación"
        nuevo_asignado = r.get("asignado_a") if asignado_a == -1 else (asignado_a or None)
        db.execute(
            """UPDATE recordatorios SET titulo=?, descripcion=?, tipo_rep=?,
               proxima_fecha=?, cada_n_dias=?, dias_semana=?, dias_mes=?, hora=?,
               asignado_a=?, actualizado_en=datetime('now') WHERE id=?""",
            (titulo.strip() if titulo else r["titulo"],
             descripcion if descripcion is not None else r["descripcion"],
             nuevo_tipo, proxima, nuevo_n,
             _json.dumps(nuevos_ds) if nuevos_ds else None,
             _json.dumps(nuevos_dm) if nuevos_dm else None,
             hora_val, nuevo_asignado, rec_id),
        )
        db.commit()
        return _parse_rec(db.execute("SELECT * FROM recordatorios WHERE id=?", (rec_id,)).fetchone()), None


def marcar_visto_recordatorio(rec_id: int, usuario_id: int) -> tuple:
    """Marca como visto y avanza a la próxima ocurrencia (o desactiva si es una_vez)."""
    with _conn() as db:
        row = db.execute(
            "SELECT * FROM recordatorios WHERE id=? AND usuario_id=? AND activo=1",
            (rec_id, usuario_id),
        ).fetchone()
        if not row:
            return None, "Recordatorio no encontrado"
        r = _parse_rec(row)
        if r["tipo_rep"] == "una_vez":
            db.execute("UPDATE recordatorios SET activo=0 WHERE id=?", (rec_id,))
            db.commit()
            return {"id": rec_id, "activo": 0}, None
        proxima = _siguiente_tras_hoy(r)
        db.execute(
            "UPDATE recordatorios SET proxima_fecha=?, actualizado_en=datetime('now') WHERE id=?",
            (proxima, rec_id),
        )
        db.commit()
        return _parse_rec(db.execute("SELECT * FROM recordatorios WHERE id=?", (rec_id,)).fetchone()), None


def eliminar_recordatorio(rec_id: int, usuario_id: int) -> tuple:
    with _conn() as db:
        row = db.execute(
            "SELECT id FROM recordatorios WHERE id=? AND usuario_id=?",
            (rec_id, usuario_id),
        ).fetchone()
        if not row:
            return False, "Recordatorio no encontrado"
        db.execute("UPDATE recordatorios SET activo=0 WHERE id=?", (rec_id,))
        db.commit()
        return True, None
