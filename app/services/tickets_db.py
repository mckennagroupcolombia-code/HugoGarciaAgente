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


def init_db():
    _repair_broken_fk()
    _migrate_categorias()
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
                depende_de_id   INTEGER NOT NULL REFERENCES misiones(id) ON DELETE CASCADE,
                PRIMARY KEY (mision_id, depende_de_id)
            );
        """)

        # Migrate tickets table with new columns
        _add_col(db, "tickets", "mision_id",    "INTEGER REFERENCES misiones(id)")
        _add_col(db, "tickets", "etapa_id",     "INTEGER REFERENCES etapas_mision(id)")
        _add_col(db, "tickets", "bloqueado_por","INTEGER REFERENCES tickets(id)")

        # Migrate misiones table with recurrence columns
        _add_col(db, "misiones", "frecuencia",
                 "TEXT CHECK(frecuencia IN ('diaria','semanal','quincenal','mensual','bimestral','trimestral','semestral'))")
        _add_col(db, "misiones", "proxima_renovacion", "TEXT")

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

        db.commit()
    print("✅ Centro de Mando (tickets DB) inicializado")


# ── HELPERS ──────────────────────────────────────────────────────────────────

def _usuario_full(db, user_id: int) -> dict | None:
    row = db.execute("""
        SELECT u.id, u.nombre, u.username, u.activo, u.creado_en,
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
               t.asignado_a,
               t.bloqueado_por AS ticket_bloqueado_por,
               ua.nombre AS asignado_nombre,
               bt.numero AS bloqueado_por_numero
        FROM etapas_mision e
        LEFT JOIN tickets   t  ON t.id  = e.ticket_id
        LEFT JOIN usuarios  ua ON ua.id = t.asignado_a
        LEFT JOIN tickets   bt ON bt.id = t.bloqueado_por
        WHERE e.mision_id = ?
        ORDER BY e.orden
    """, (mision_id,)).fetchall()
    d["etapas"] = [dict(e) for e in etapas]
    deps = db.execute("""
        SELECT dm.depende_de_id AS id, m.titulo, m.estado, m.reino
        FROM dependencias_misiones dm
        JOIN misiones m ON m.id = dm.depende_de_id
        WHERE dm.mision_id = ?
        ORDER BY m.titulo
    """, (mision_id,)).fetchall()
    d["dependencias"] = [dict(dep) for dep in deps]
    return d


def crear_mision(data: dict, usuario_id: int) -> tuple:
    """Crea la misión y sus tickets en un solo paso (sin fase borrador)."""
    titulo       = (data.get("titulo") or "").strip()
    etapas_raw   = data.get("etapas") or []
    asignaciones = data.get("asignaciones") or {}   # {"1": user_id, "2": user_id, ...}
    tipo         = data.get("tipo", "secuencial")
    categoria    = data.get("categoria", "logistica")
    frecuencia   = data.get("frecuencia") or None    # None = one-time

    if not titulo:
        return None, "titulo requerido"
    if not etapas_raw:
        return None, "Se requiere al menos una etapa"

    proxima = _calcular_proxima(frecuencia) if frecuencia else None

    with _conn() as db:
        db.execute("""
            INSERT INTO misiones
                (titulo, descripcion, reino, color, tipo, categoria, creado_por, total_etapas, estado, frecuencia, proxima_renovacion)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
        """, (
            titulo,
            data.get("descripcion", ""),
            data.get("reino", ""),
            data.get("color", "#0c6069"),
            tipo,
            categoria,
            usuario_id,
            len(etapas_raw),
            "activa",
            frecuencia,
            proxima,
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
            estado_inicial = "en_proceso" if (not bloqueado_por and asig) else "pendiente"

            db.execute("""
                INSERT INTO tickets
                    (numero, titulo, categoria, descripcion, prioridad,
                     creado_por, asignado_a, mision_id, etapa_id, bloqueado_por, estado)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)
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
            ))
            tid = db.execute("SELECT last_insert_rowid() as id").fetchone()["id"]

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


def listar_misiones() -> list:
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
        return [dict(r) for r in rows]


def get_mision(mision_id: int) -> dict | None:
    with _conn() as db:
        return _mision_full(db, mision_id)


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
        if m["estado"] in ("completada", "cancelada"):
            return None, f"La misión está {m['estado']} y no puede editarse"

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
                         asignado_a: int | None, usuario_id: int) -> tuple:
    """Añade una etapa+ticket a una misión activa."""
    titulo = titulo.strip()
    if not titulo:
        return None, "Título requerido"
    with _conn() as db:
        m = db.execute("SELECT * FROM misiones WHERE id=?", (mision_id,)).fetchone()
        if not m:
            return None, "Misión no encontrada"
        if m["estado"] in ("completada", "cancelada"):
            return None, f"La misión está {m['estado']} y no puede editarse"

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

        estado_ticket = "en_proceso" if (not bloqueado_por and asignado_a) else "pendiente"
        if bloqueado_por:
            estado_ticket = "pendiente"

        numero = _generar_numero(db)
        db.execute("""
            INSERT INTO tickets
                (numero, titulo, categoria, descripcion, prioridad,
                 creado_por, asignado_a, mision_id, etapa_id, bloqueado_por, estado)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
        """, (
            numero, titulo, m["categoria"], descripcion or titulo,
            "media", usuario_id, asignado_a, mision_id, etapa_id, bloqueado_por, estado_ticket,
        ))
        tid = db.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
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
        if m["estado"] in ("completada", "cancelada"):
            return None, f"La misión está {m['estado']} y no puede editarse"
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
        if m["estado"] in ("completada", "cancelada"):
            return None, f"La misión está {m['estado']} y no puede editarse"
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
                            "frecuencia", "estado")
                  and v is not None}
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
        rows = db.execute("""
            SELECT dm.depende_de_id AS id, m.titulo, m.estado, m.reino
            FROM dependencias_misiones dm
            JOIN misiones m ON m.id = dm.depende_de_id
            WHERE dm.mision_id = ?
            ORDER BY m.titulo
        """, (mision_id,)).fetchall()
        return [dict(r) for r in rows]


def agregar_dependencia_mision(mision_id: int, depende_de_id: int) -> tuple:
    if mision_id == depende_de_id:
        return None, "Una misión no puede depender de sí misma"
    with _conn() as db:
        if not db.execute("SELECT id FROM misiones WHERE id=?", (mision_id,)).fetchone():
            return None, "Misión no encontrada"
        if not db.execute("SELECT id FROM misiones WHERE id=?", (depende_de_id,)).fetchone():
            return None, "Misión prerequisito no encontrada"
        # prevent circular: depende_de_id must not depend (directly or indirectly) on mision_id
        # Simple one-level check is enough for the UI use case
        if db.execute(
            "SELECT 1 FROM dependencias_misiones WHERE mision_id=? AND depende_de_id=?",
            (depende_de_id, mision_id)
        ).fetchone():
            return None, "Dependencia circular: la misión prerequisito ya depende de esta misión"
        try:
            db.execute(
                "INSERT OR IGNORE INTO dependencias_misiones (mision_id, depende_de_id) VALUES (?,?)",
                (mision_id, depende_de_id)
            )
            db.commit()
        except Exception as e:
            return None, str(e)
        return _mision_full(db, mision_id), None


def eliminar_dependencia_mision(mision_id: int, depende_de_id: int) -> tuple:
    with _conn() as db:
        db.execute(
            "DELETE FROM dependencias_misiones WHERE mision_id=? AND depende_de_id=?",
            (mision_id, depende_de_id)
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
            estado_inicial = "pendiente"
            if not bloqueado_por and asig:
                estado_inicial = "en_proceso"

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
    """Auto-deduct required materials from all resolved tickets when mission completes."""
    tickets = db.execute(
        "SELECT id FROM tickets WHERE mision_id=? AND estado='resuelto'", (mision_id,)
    ).fetchall()
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
        m = db.execute("SELECT frecuencia, estado FROM misiones WHERE id=?", (mision_id,)).fetchone()
        frecuencia = m["frecuencia"] if m else None
        proxima = _calcular_proxima(frecuencia) if frecuencia else None
        already_done = m and m["estado"] == "completada"
        db.execute(
            "UPDATE misiones SET estado='completada', etapas_completadas=?, "
            "completada_en=datetime('now'), proxima_renovacion=? WHERE id=?",
            (completadas, proxima, mision_id),
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
        # logs_auditoria has no CASCADE — delete manually
        db.execute("DELETE FROM logs_auditoria WHERE ticket_id=?", (ticket_id,))
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
    "semanal":    timedelta(weeks=1),
    "quincenal":  timedelta(days=15),
    "mensual":    timedelta(days=30),
    "bimestral":  timedelta(days=60),
    "trimestral": timedelta(days=90),
    "semestral":  timedelta(days=180),
}

_FRECUENCIA_LABEL = {
    "diaria":     "Diaria",
    "semanal":    "Semanal",
    "quincenal":  "Quincenal",
    "mensual":    "Mensual",
    "bimestral":  "Bimestral",
    "trimestral": "Trimestral",
    "semestral":  "Semestral",
}


def _calcular_proxima(frecuencia: str) -> str:
    delta = _FRECUENCIA_DELTA.get(frecuencia)
    if not delta:
        return ""
    return (datetime.utcnow() + delta).strftime("%Y-%m-%d %H:%M:%S")


def renovar_mision(mision_id: int, usuario_id: int | None = None) -> tuple:
    """
    Clona los tickets de la misión con las mismas asignaciones, resetea etapas
    a pendiente/activa, cambia estado a 'activa' y calcula la próxima renovación.
    Solo aplica a misiones con frecuencia definida.
    """
    with _conn() as db:
        m = db.execute("SELECT * FROM misiones WHERE id=?", (mision_id,)).fetchone()
        if not m:
            return False, "Misión no encontrada"
        if not m["frecuencia"]:
            return False, "La misión no tiene frecuencia de recurrencia"

        etapas = db.execute(
            "SELECT * FROM etapas_mision WHERE mision_id=? ORDER BY orden", (mision_id,)
        ).fetchall()

        # Collect assignees from last cycle's tickets before wiping them
        asig_por_orden: dict[int, int | None] = {}
        for etapa in etapas:
            if etapa["ticket_id"]:
                t = db.execute("SELECT asignado_a FROM tickets WHERE id=?", (etapa["ticket_id"],)).fetchone()
                if t:
                    asig_por_orden[etapa["orden"]] = t["asignado_a"]

        # Remove old tickets (same cleanup as eliminar_mision but per-ticket)
        old_ticket_ids = [e["ticket_id"] for e in etapas if e["ticket_id"]]
        for tid in old_ticket_ids:
            db.execute("UPDATE tickets SET bloqueado_por=NULL WHERE bloqueado_por=?", (tid,))
            db.execute("UPDATE etapas_mision SET ticket_id=NULL WHERE ticket_id=?", (tid,))
            db.execute("DELETE FROM logs_auditoria WHERE ticket_id=?", (tid,))
        if old_ticket_ids:
            ph = ",".join("?" * len(old_ticket_ids))
            db.execute(f"DELETE FROM tickets WHERE id IN ({ph})", old_ticket_ids)

        # Recreate tickets
        creator = usuario_id or m["creado_por"]
        prev_ticket_id = None
        for etapa in etapas:
            asig = asig_por_orden.get(etapa["orden"])
            numero = _generar_numero(db)
            bloqueado_por = prev_ticket_id if m["tipo"] == "secuencial" else None
            estado_inicial = "en_proceso" if (not bloqueado_por and asig) else "pendiente"

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
                creator,
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
            _log(db, tid, creator, "ticket_renovado",
                 detalles=f"Renovación automática — misión '{m['titulo']}' (frecuencia: {m['frecuencia']})")
            prev_ticket_id = tid

        proxima = _calcular_proxima(m["frecuencia"])
        db.execute("""
            UPDATE misiones
            SET estado='activa', etapas_completadas=0, completada_en=NULL,
                proxima_renovacion=?
            WHERE id=?
        """, (proxima, mision_id))
        db.commit()
        return True, proxima


def procesar_renovaciones() -> list[int]:
    """Check all recurring missions and renew those past their proxima_renovacion date."""
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    renovadas = []
    with _conn() as db:
        pendientes = db.execute("""
            SELECT id FROM misiones
            WHERE frecuencia IS NOT NULL
              AND estado = 'completada'
              AND proxima_renovacion IS NOT NULL
              AND proxima_renovacion <= ?
        """, (now,)).fetchall()
    for row in pendientes:
        ok, _ = renovar_mision(row["id"])
        if ok:
            renovadas.append(row["id"])
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

    # Bloqueado por
    if d.get("bloqueado_por"):
        bt = db.execute("SELECT numero FROM tickets WHERE id=?", (d["bloqueado_por"],)).fetchone()
        d["bloqueado_por_numero"] = bt["numero"] if bt else None
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
                   bt.numero  AS bloqueado_por_numero
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
        return _ticket_full(db, ticket_id)


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
            if t["creado_por"] != uid and nivel < 2:
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
            dep_state = "en_proceso" if dep["asignado_a"] else "pendiente"
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

        db.commit()
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
            u["total_horas"] = round(db.execute(
                "SELECT COALESCE(SUM(horas),0) as h FROM bitacora_tiempo WHERE usuario_id=?",
                (uid,),
            ).fetchone()["h"], 1)
            result.append(u)
        return sorted(result, key=lambda x: x["tickets_abiertos"], reverse=True)


# ── PASOS DE TICKET ───────────────────────────────────────────────────────────

def listar_pasos(ticket_id: int) -> list:
    with _conn() as db:
        rows = db.execute("""
            SELECT p.*, u.nombre AS completado_por_nombre
            FROM ticket_pasos p
            LEFT JOIN usuarios u ON u.id = p.completado_por
            WHERE p.ticket_id = ? ORDER BY p.orden
        """, (ticket_id,)).fetchall()
        return [dict(r) for r in rows]


def agregar_paso(ticket_id: int, descripcion: str, usuario_id: int) -> tuple:
    descripcion = descripcion.strip()
    if not descripcion:
        return None, "Descripción requerida"
    with _conn() as db:
        t = db.execute("SELECT id FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        if not t:
            return None, "Ticket no encontrado"
        orden = db.execute(
            "SELECT COALESCE(MAX(orden),0)+1 AS n FROM ticket_pasos WHERE ticket_id=?", (ticket_id,)
        ).fetchone()["n"]
        db.execute(
            "INSERT INTO ticket_pasos (ticket_id, orden, descripcion) VALUES (?,?,?)",
            (ticket_id, orden, descripcion)
        )
        db.commit()
        return listar_pasos(ticket_id), None


def completar_paso(paso_id: int, usuario_id: int) -> tuple:
    with _conn() as db:
        p = db.execute("SELECT * FROM ticket_pasos WHERE id=?", (paso_id,)).fetchone()
        if not p:
            return None, "Paso no encontrado"
        nuevo = 0 if p["completado"] else 1
        db.execute(
            "UPDATE ticket_pasos SET completado=?, completado_en=?, completado_por=? WHERE id=?",
            (nuevo, datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S") if nuevo else None,
             usuario_id if nuevo else None, paso_id)
        )
        db.commit()
        return listar_pasos(p["ticket_id"]), None


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


def listar_materiales(solo_activos: bool = True) -> list:
    with _conn() as db:
        q = "SELECT * FROM materiales_catalogo"
        if solo_activos:
            q += " WHERE activo=1"
        q += " ORDER BY nombre"
        return [dict(r) for r in db.execute(q).fetchall()]


def get_material(material_id: int) -> dict | None:
    with _conn() as db:
        r = db.execute("SELECT * FROM materiales_catalogo WHERE id=?", (material_id,)).fetchone()
        return dict(r) if r else None


def crear_material(data: dict) -> tuple:
    nombre = (data.get("nombre") or "").strip()
    if not nombre:
        return None, "Nombre requerido"
    with _conn() as db:
        try:
            db.execute("""
                INSERT INTO materiales_catalogo
                    (nombre, descripcion, unidad, stock_actual, stock_minimo, precio_unitario, proveedor)
                VALUES (?,?,?,?,?,?,?)
            """, (
                nombre,
                data.get("descripcion") or "",
                data.get("unidad") or "unidad",
                float(data.get("stock_actual") or 0),
                float(data.get("stock_minimo") or 0),
                float(data.get("precio_unitario") or 0),
                data.get("proveedor") or "",
            ))
            mid = db.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
            db.commit()
            return get_material(mid), None
        except Exception as exc:
            return None, str(exc)


def actualizar_material(material_id: int, data: dict) -> tuple:
    with _conn() as db:
        m = db.execute("SELECT id FROM materiales_catalogo WHERE id=?", (material_id,)).fetchone()
        if not m:
            return None, "Material no encontrado"
        campos = {k: v for k, v in data.items()
                  if k in ("nombre","descripcion","unidad","stock_minimo","precio_unitario","proveedor","activo")
                  and v is not None}
        if campos:
            set_cl = ", ".join(f"{k}=?" for k in campos)
            db.execute(
                f"UPDATE materiales_catalogo SET {set_cl}, actualizado_en=datetime('now') WHERE id=?",
                (*campos.values(), material_id)
            )
        db.commit()
        return get_material(material_id), None


# ── MATERIALES DE TICKET ───────────────────────────────────────────────────────

def listar_materiales_ticket(ticket_id: int) -> list:
    with _conn() as db:
        rows = db.execute("""
            SELECT tm.*, mc.nombre, mc.unidad, mc.stock_actual, mc.precio_unitario
            FROM ticket_materiales tm
            JOIN materiales_catalogo mc ON mc.id = tm.material_id
            WHERE tm.ticket_id = ?
            ORDER BY mc.nombre
        """, (ticket_id,)).fetchall()
        return [dict(r) for r in rows]


def agregar_material_ticket(ticket_id: int, material_id: int, cantidad: float) -> tuple:
    if cantidad <= 0:
        return None, "Cantidad debe ser mayor a 0"
    with _conn() as db:
        try:
            db.execute(
                "INSERT INTO ticket_materiales (ticket_id, material_id, cantidad_requerida) VALUES (?,?,?)",
                (ticket_id, material_id, cantidad)
            )
            db.commit()
            return listar_materiales_ticket(ticket_id), None
        except Exception as exc:
            return None, "Material ya está en este ticket" if "UNIQUE" in str(exc) else str(exc)


def actualizar_material_ticket(tm_id: int, cantidad: float) -> tuple:
    if cantidad <= 0:
        return None, "Cantidad debe ser mayor a 0"
    with _conn() as db:
        tm = db.execute("SELECT ticket_id FROM ticket_materiales WHERE id=?", (tm_id,)).fetchone()
        if not tm:
            return None, "No encontrado"
        db.execute("UPDATE ticket_materiales SET cantidad_requerida=? WHERE id=?", (cantidad, tm_id))
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
