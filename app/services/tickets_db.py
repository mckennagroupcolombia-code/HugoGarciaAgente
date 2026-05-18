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


def init_db():
    os.makedirs(UPLOADS_DIR, exist_ok=True)
    with _conn() as db:
        db.executescript("""
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
        """)

        # Migrate tickets table with new columns
        _add_col(db, "tickets", "mision_id",    "INTEGER REFERENCES misiones(id)")
        _add_col(db, "tickets", "etapa_id",     "INTEGER REFERENCES etapas_mision(id)")
        _add_col(db, "tickets", "bloqueado_por","INTEGER REFERENCES tickets(id)")

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
    return d


def crear_mision(data: dict, usuario_id: int) -> tuple:
    titulo     = (data.get("titulo") or "").strip()
    etapas_raw = data.get("etapas") or []
    if not titulo:
        return None, "titulo requerido"
    if not etapas_raw:
        return None, "Se requiere al menos una etapa"
    with _conn() as db:
        db.execute("""
            INSERT INTO misiones
                (titulo, descripcion, reino, color, tipo, categoria, creado_por, total_etapas)
            VALUES (?,?,?,?,?,?,?,?)
        """, (
            titulo,
            data.get("descripcion", ""),
            data.get("reino", ""),
            data.get("color", "#0c6069"),
            data.get("tipo", "secuencial"),
            data.get("categoria", "logistica"),
            usuario_id,
            len(etapas_raw),
        ))
        mid = db.execute("SELECT last_insert_rowid() as id").fetchone()["id"]
        for i, etapa in enumerate(etapas_raw, 1):
            db.execute(
                "INSERT INTO etapas_mision (mision_id, orden, titulo, descripcion) VALUES (?,?,?,?)",
                (mid, i, etapa.get("titulo", ""), etapa.get("descripcion", "")),
            )
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


def actualizar_mision(mision_id: int, data: dict) -> tuple:
    """Update mission metadata and/or replace all etapas atomically. Borrador only."""
    with _conn() as db:
        m = db.execute("SELECT * FROM misiones WHERE id=?", (mision_id,)).fetchone()
        if not m:
            return None, "Misión no encontrada"
        if m["estado"] != "borrador":
            return None, "Solo se pueden editar misiones en estado borrador"
        campos = {k: v for k, v in data.items()
                  if k in ("titulo", "descripcion", "reino", "color", "tipo", "categoria")
                  and v is not None}
        if campos:
            set_clause = ", ".join(f"{k}=?" for k in campos)
            db.execute(f"UPDATE misiones SET {set_clause} WHERE id=?", (*campos.values(), mision_id))
        etapas_raw = data.get("etapas")
        if etapas_raw is not None:
            db.execute("DELETE FROM etapas_mision WHERE mision_id=?", (mision_id,))
            for i, etapa in enumerate(etapas_raw, 1):
                db.execute(
                    "INSERT INTO etapas_mision (mision_id, orden, titulo, descripcion) VALUES (?,?,?,?)",
                    (mision_id, i, (etapa.get("titulo") or "").strip(), etapa.get("descripcion") or ""),
                )
            db.execute("UPDATE misiones SET total_etapas=? WHERE id=?", (len(etapas_raw), mision_id))
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
        db.execute(
            "UPDATE misiones SET estado='completada', etapas_completadas=?, "
            "completada_en=datetime('now') WHERE id=?",
            (completadas, mision_id),
        )
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
            # Unblock dependents
            db.execute("UPDATE tickets SET bloqueado_por=NULL WHERE bloqueado_por=?", (tid,))
            db.execute("DELETE FROM logs_auditoria WHERE ticket_id=?", (tid,))
        if ticket_ids:
            placeholders = ",".join("?" * len(ticket_ids))
            db.execute(f"DELETE FROM tickets WHERE id IN ({placeholders})", ticket_ids)
        # etapas_mision has ON DELETE CASCADE from misiones
        db.execute("DELETE FROM misiones WHERE id=?", (mision_id,))
        db.commit()
        return True, None


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
    n = db.execute(
        "SELECT COUNT(*) as c FROM tickets WHERE numero LIKE ?", (f"TKT-{year}-%",)
    ).fetchone()["c"]
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
