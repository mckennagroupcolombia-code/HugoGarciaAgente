"""Recetas operativas: ingredientes ↔ inventario, procesos y corridas con cronómetro."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

from app.services.tickets_db import _conn

_RECETAS_JSON = Path(__file__).resolve().parents[2] / "PAGINA_WEB" / "site" / "data" / "recetas.json"


def _migrate_recetas_ops():
    with _conn() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS recetas_ops (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                origen_id    INTEGER,
                titulo       TEXT NOT NULL,
                descripcion  TEXT,
                categoria    TEXT,
                base         REAL,
                unidad_base  TEXT,
                tip          TEXT,
                activo       INTEGER DEFAULT 1,
                creado_en    TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS receta_lineas (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                receta_id    INTEGER NOT NULL REFERENCES recetas_ops(id) ON DELETE CASCADE,
                material_id  INTEGER REFERENCES materiales_catalogo(id),
                etiqueta     TEXT,
                cantidad     REAL NOT NULL DEFAULT 0,
                unidad       TEXT NOT NULL DEFAULT 'g',
                orden        INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS receta_procesos (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                receta_id    INTEGER NOT NULL REFERENCES recetas_ops(id) ON DELETE CASCADE,
                orden        INTEGER NOT NULL,
                descripcion  TEXT NOT NULL,
                duracion_min INTEGER
            );
            CREATE TABLE IF NOT EXISTS receta_corridas (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                receta_id           INTEGER NOT NULL REFERENCES recetas_ops(id),
                usuario_id          INTEGER NOT NULL REFERENCES usuarios(id),
                estado              TEXT NOT NULL DEFAULT 'activa'
                                        CHECK(estado IN ('activa','pausada','finalizada')),
                iniciada_en         TEXT NOT NULL,
                reanudada_en        TEXT,
                segundos_acumulados INTEGER NOT NULL DEFAULT 0,
                proceso_orden_actual INTEGER NOT NULL DEFAULT 1,
                procesos_hechos     TEXT NOT NULL DEFAULT '[]',
                finalizada_en       TEXT
            );
        """)
        cols = {row[1] for row in db.execute("PRAGMA table_info(recetas_ops)").fetchall()}
        if "reino_id" not in cols:
            db.execute(
                "ALTER TABLE recetas_ops ADD COLUMN reino_id INTEGER REFERENCES zonas_trabajo(id)"
            )
        db.commit()


def _reino_raiz_id(db, zona_id: int) -> int | None:
    """Devuelve el id del reino (zona raíz) para un id de zonas_trabajo."""
    cur = zona_id
    for _ in range(8):
        row = db.execute(
            "SELECT id, parent_id FROM zonas_trabajo WHERE id=? AND activo=1", (cur,)
        ).fetchone()
        if not row:
            return None
        if row["parent_id"] is None:
            return row["id"]
        cur = row["parent_id"]
    return None


def _validar_reino_id(db, reino_id) -> tuple[int | None, str | None]:
    try:
        zid = int(reino_id)
    except (TypeError, ValueError):
        return None, "Reino requerido"
    raiz = _reino_raiz_id(db, zid)
    if raiz is None:
        return None, "Reino no encontrado"
    return raiz, None


def _clasificacion_receta(origen_id) -> str:
    """catalogo = importadas del sitio (origen_id); reino = creadas en Centro de Mando."""
    return "catalogo" if origen_id is not None else "reino"


def _enriquecer_reino(db, d: dict) -> dict:
    rid = d.get("reino_id")
    if not rid:
        d.setdefault("reino_nombre", None)
        d.setdefault("reino_icono", None)
        d.setdefault("reino_color", None)
        return d
    row = db.execute(
        "SELECT nombre, color, icono FROM zonas_trabajo WHERE id=? AND activo=1",
        (rid,),
    ).fetchone()
    if row:
        d["reino_nombre"] = row["nombre"]
        d["reino_icono"] = row["icono"]
        d["reino_color"] = row["color"]
    return d


def _enriquecer_meta_receta(db, d: dict) -> dict:
    oid = d.get("origen_id")
    d["es_propia"] = oid is None
    d["clasificacion"] = _clasificacion_receta(oid)
    d["es_catalogo"] = d["clasificacion"] == "catalogo"
    d["es_receta_reino"] = d["clasificacion"] == "reino"
    _enriquecer_reino(db, d)
    return d


def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        try:
            return datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        except ValueError:
            return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _match_material_id(db, nombre: str) -> int | None:
    n = (nombre or "").strip().lower()
    if not n:
        return None
    row = db.execute(
        "SELECT id FROM materiales_catalogo WHERE activo=1 AND LOWER(nombre)=?",
        (n,),
    ).fetchone()
    if row:
        return row["id"]
    token = re.sub(r"[^a-z0-9áéíóúñ ]", " ", n).split()
    for t in token:
        if len(t) < 4:
            continue
        row = db.execute(
            "SELECT id FROM materiales_catalogo WHERE activo=1 AND LOWER(nombre) LIKE ? LIMIT 1",
            (f"%{t}%",),
        ).fetchone()
        if row:
            return row["id"]
    return None


def _ensure_seeded():
    _migrate_recetas_ops()
    with _conn() as db:
        n = db.execute("SELECT COUNT(*) AS c FROM recetas_ops WHERE activo=1").fetchone()["c"]
        if n > 0:
            return
    if not _RECETAS_JSON.is_file():
        return
    try:
        items = json.loads(_RECETAS_JSON.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return
    if not isinstance(items, list):
        return
    with _conn() as db:
        for r in items:
            oid = r.get("id")
            titulo = f"{r.get('title', '')} {r.get('title2', '')}".strip() or f"Receta {oid}"
            cur = db.execute(
                "SELECT id FROM recetas_ops WHERE origen_id=? AND activo=1",
                (oid,),
            ).fetchone()
            if cur:
                rid = cur["id"]
            else:
                db.execute(
                    """
                    INSERT INTO recetas_ops (origen_id, titulo, descripcion, categoria, base, unidad_base, tip)
                    VALUES (?,?,?,?,?,?,?)
                    """,
                    (
                        oid,
                        titulo,
                        r.get("desc") or "",
                        r.get("cat") or "",
                        r.get("base"),
                        r.get("unidad") or "ml",
                        r.get("tip") or "",
                    ),
                )
                rid = db.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
            for i, ing in enumerate(r.get("ings") or []):
                mid = _match_material_id(db, ing.get("n") or "")
                db.execute(
                    """
                    INSERT INTO receta_lineas (receta_id, material_id, etiqueta, cantidad, unidad, orden)
                    VALUES (?,?,?,?,?,?)
                    """,
                    (
                        rid,
                        mid,
                        ing.get("n") or "",
                        float(ing.get("q") or 0),
                        ing.get("u") or "g",
                        i,
                    ),
                )
            for j, paso in enumerate(r.get("pasos") or []):
                txt = paso if isinstance(paso, str) else str(paso)
                db.execute(
                    """
                    INSERT INTO receta_procesos (receta_id, orden, descripcion)
                    VALUES (?,?,?)
                    """,
                    (rid, j + 1, txt),
                )
        db.commit()


def _lineas_receta(db, receta_id: int) -> list:
    rows = db.execute(
        """
        SELECT l.*, m.nombre AS material_nombre, m.stock_actual, m.unidad AS material_unidad
        FROM receta_lineas l
        LEFT JOIN materiales_catalogo m ON m.id = l.material_id
        WHERE l.receta_id=?
        ORDER BY l.orden, l.id
        """,
        (receta_id,),
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["nombre"] = d.get("material_nombre") or d.get("etiqueta") or "—"
        out.append(d)
    return out


def _procesos_receta(db, receta_id: int) -> list:
    return [
        dict(r)
        for r in db.execute(
            "SELECT * FROM receta_procesos WHERE receta_id=? ORDER BY orden, id",
            (receta_id,),
        ).fetchall()
    ]


def _corrida_dict(db, row) -> dict:
    d = dict(row)
    hechos = []
    try:
        hechos = json.loads(d.get("procesos_hechos") or "[]")
    except json.JSONDecodeError:
        pass
    d["procesos_hechos"] = hechos
    d["segundos_transcurridos"] = _segundos_corrida(d)
    return d


def _segundos_corrida(c: dict) -> int:
    acc = int(c.get("segundos_acumulados") or 0)
    if c.get("estado") == "finalizada":
        return acc
    anchor = c.get("reanudada_en") or c.get("iniciada_en")
    dt = _parse_dt(anchor)
    if c.get("estado") == "activa" and dt:
        now = datetime.now(timezone.utc)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return acc + max(0, int((now - dt).total_seconds()))
    return acc


def listar_recetas_ops(usuario_id: int | None = None) -> list:
    _ensure_seeded()
    with _conn() as db:
        rows = db.execute(
            "SELECT * FROM recetas_ops WHERE activo=1 ORDER BY titulo"
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            _enriquecer_meta_receta(db, d)
            d["num_lineas"] = db.execute(
                "SELECT COUNT(*) AS n FROM receta_lineas WHERE receta_id=?", (r["id"],)
            ).fetchone()["n"]
            d["num_procesos"] = db.execute(
                "SELECT COUNT(*) AS n FROM receta_procesos WHERE receta_id=?", (r["id"],)
            ).fetchone()["n"]
            if usuario_id:
                act = db.execute(
                    """
                    SELECT id, estado FROM receta_corridas
                    WHERE receta_id=? AND usuario_id=? AND estado IN ('activa','pausada')
                    ORDER BY id DESC LIMIT 1
                    """,
                    (r["id"], usuario_id),
                ).fetchone()
                d["corrida_activa_id"] = act["id"] if act else None
                d["corrida_estado"] = act["estado"] if act else None
            out.append(d)
        return out


def _receta_editable(usuario_nivel: int, origen_id) -> bool:
    """Recetas propias (sin origen web) las edita cualquier usuario; catálogo importado solo supervisor+."""
    if origen_id is None:
        return True
    return usuario_nivel >= 2


def crear_receta_ops(data: dict) -> tuple[dict | None, str | None]:
    titulo = (data.get("titulo") or "").strip()
    if not titulo:
        return None, "Título requerido"
    desc = (data.get("descripcion") or "").strip()
    tip = (data.get("tip") or "").strip()
    unidad_base = (data.get("unidad_base") or "g").strip() or "g"
    base = data.get("base")
    try:
        base = float(base) if base not in (None, "") else None
    except (TypeError, ValueError):
        return None, "Base debe ser numérica"
    with _conn() as db:
        reino_id, err = _validar_reino_id(db, data.get("reino_id"))
        if err:
            return None, err
        db.execute(
            """
            INSERT INTO recetas_ops (
                origen_id, titulo, descripcion, categoria, reino_id, base, unidad_base, tip
            )
            VALUES (NULL, ?, ?, '', ?, ?, ?, ?)
            """,
            (titulo, desc, reino_id, base, unidad_base, tip),
        )
        rid = db.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
        lineas = data.get("lineas") if isinstance(data.get("lineas"), list) else []
        for i, ln in enumerate(lineas):
            mid = ln.get("material_id")
            try:
                mid = int(mid) if mid not in (None, "", 0) else None
            except (TypeError, ValueError):
                mid = None
            cantidad = float(ln.get("cantidad") or 0)
            unidad = (ln.get("unidad") or "g").strip() or "g"
            etiqueta = (ln.get("etiqueta") or "").strip()
            if not mid and not etiqueta:
                continue
            db.execute(
                """
                INSERT INTO receta_lineas (receta_id, material_id, etiqueta, cantidad, unidad, orden)
                VALUES (?,?,?,?,?,?)
                """,
                (rid, mid, etiqueta, cantidad, unidad, i),
            )
        procesos = data.get("procesos") if isinstance(data.get("procesos"), list) else []
        orden = 1
        for p in procesos:
            desc_p = (p.get("descripcion") or p.get("texto") or "").strip()
            if not desc_p:
                continue
            dm = p.get("duracion_min")
            try:
                dm = int(dm) if dm not in (None, "") else None
            except (TypeError, ValueError):
                dm = None
            db.execute(
                """
                INSERT INTO receta_procesos (receta_id, orden, descripcion, duracion_min)
                VALUES (?,?,?,?)
                """,
                (rid, orden, desc_p, dm),
            )
            orden += 1
        db.commit()
        return get_receta_ops(rid), None


def actualizar_receta_ops(receta_id: int, data: dict, usuario_nivel: int = 1) -> tuple[dict | None, str | None]:
    with _conn() as db:
        row = db.execute(
            "SELECT origen_id FROM recetas_ops WHERE id=? AND activo=1", (receta_id,)
        ).fetchone()
        if not row:
            return None, "Receta no encontrada"
        if not _receta_editable(usuario_nivel, row["origen_id"]):
            return None, "Solo un supervisor puede editar recetas del catálogo importado"
        campos = {}
        if "titulo" in data:
            t = (data.get("titulo") or "").strip()
            if not t:
                return None, "Título requerido"
            campos["titulo"] = t
        for k, col in (
            ("descripcion", "descripcion"),
            ("tip", "tip"),
            ("unidad_base", "unidad_base"),
        ):
            if k in data:
                campos[col] = (data.get(k) or "").strip()
        if "reino_id" in data:
            reino_id, err = _validar_reino_id(db, data.get("reino_id"))
            if err:
                return None, err
            campos["reino_id"] = reino_id
        if "base" in data:
            b = data.get("base")
            if b in (None, ""):
                campos["base"] = None
            else:
                try:
                    campos["base"] = float(b)
                except (TypeError, ValueError):
                    return None, "Base debe ser numérica"
        if campos:
            set_clause = ", ".join(f"{k}=?" for k in campos)
            db.execute(
                f"UPDATE recetas_ops SET {set_clause} WHERE id=?",
                (*campos.values(), receta_id),
            )
        db.commit()
        return get_receta_ops(receta_id), None


def eliminar_receta_ops(receta_id: int, usuario_nivel: int = 1) -> tuple[bool, str | None]:
    """Archiva (soft-delete) receta del recetario operativo."""
    _ = usuario_nivel
    with _conn() as db:
        row = db.execute(
            "SELECT 1 FROM recetas_ops WHERE id=? AND activo=1", (receta_id,)
        ).fetchone()
        if not row:
            return False, "Receta no encontrada"
        activa = db.execute(
            """
            SELECT 1 FROM receta_corridas
            WHERE receta_id=? AND estado IN ('activa','pausada') LIMIT 1
            """,
            (receta_id,),
        ).fetchone()
        if activa:
            return False, "Hay una elaboración en curso; finalízala antes de archivar."
        db.execute("UPDATE recetas_ops SET activo=0 WHERE id=?", (receta_id,))
        db.commit()
        return True, None


def get_receta_ops(receta_id: int, usuario_id: int | None = None) -> dict | None:
    _ensure_seeded()
    with _conn() as db:
        r = db.execute(
            "SELECT * FROM recetas_ops WHERE id=? AND activo=1", (receta_id,)
        ).fetchone()
        if not r:
            return None
        d = dict(r)
        _enriquecer_meta_receta(db, d)
        d["lineas"] = _lineas_receta(db, receta_id)
        d["procesos"] = _procesos_receta(db, receta_id)
        if usuario_id:
            c = db.execute(
                """
                SELECT * FROM receta_corridas
                WHERE receta_id=? AND usuario_id=? AND estado IN ('activa','pausada')
                ORDER BY id DESC LIMIT 1
                """,
                (receta_id, usuario_id),
            ).fetchone()
            d["corrida"] = _corrida_dict(db, c) if c else None
        return d


def guardar_lineas_receta(
    receta_id: int, lineas: list, usuario_nivel: int = 2
) -> tuple[dict | None, str | None]:
    with _conn() as db:
        row = db.execute(
            "SELECT origen_id FROM recetas_ops WHERE id=? AND activo=1", (receta_id,)
        ).fetchone()
        if not row:
            return None, "Receta no encontrada"
        if not _receta_editable(usuario_nivel, row["origen_id"]):
            return None, "Sin permiso para editar materiales de esta receta"
        db.execute("DELETE FROM receta_lineas WHERE receta_id=?", (receta_id,))
        for i, ln in enumerate(lineas):
            mid = ln.get("material_id")
            try:
                mid = int(mid) if mid not in (None, "", 0) else None
            except (TypeError, ValueError):
                mid = None
            cantidad = float(ln.get("cantidad") or 0)
            unidad = (ln.get("unidad") or "g").strip() or "g"
            etiqueta = (ln.get("etiqueta") or "").strip()
            if not mid and not etiqueta:
                continue
            db.execute(
                """
                INSERT INTO receta_lineas (receta_id, material_id, etiqueta, cantidad, unidad, orden)
                VALUES (?,?,?,?,?,?)
                """,
                (receta_id, mid, etiqueta, cantidad, unidad, i),
            )
        db.commit()
        return get_receta_ops(receta_id), None


def guardar_procesos_receta(
    receta_id: int, procesos: list, usuario_nivel: int = 2
) -> tuple[dict | None, str | None]:
    with _conn() as db:
        row = db.execute(
            "SELECT origen_id FROM recetas_ops WHERE id=? AND activo=1", (receta_id,)
        ).fetchone()
        if not row:
            return None, "Receta no encontrada"
        if not _receta_editable(usuario_nivel, row["origen_id"]):
            return None, "Sin permiso para editar procesos de esta receta"
        db.execute("DELETE FROM receta_procesos WHERE receta_id=?", (receta_id,))
        for i, p in enumerate(procesos):
            desc = (p.get("descripcion") or p.get("texto") or "").strip()
            if not desc:
                continue
            dm = p.get("duracion_min")
            try:
                dm = int(dm) if dm not in (None, "") else None
            except (TypeError, ValueError):
                dm = None
            db.execute(
                """
                INSERT INTO receta_procesos (receta_id, orden, descripcion, duracion_min)
                VALUES (?,?,?,?)
                """,
                (receta_id, i + 1, desc, dm),
            )
        db.commit()
        return get_receta_ops(receta_id), None


def iniciar_corrida(
    receta_id: int,
    usuario_id: int,
    segundos_previos: int = 0,
) -> tuple[dict | None, str | None]:
    with _conn() as db:
        if not db.execute("SELECT 1 FROM recetas_ops WHERE id=? AND activo=1", (receta_id,)).fetchone():
            return None, "Receta no encontrada"
        prev = db.execute(
            """
            SELECT id FROM receta_corridas
            WHERE receta_id=? AND usuario_id=? AND estado IN ('activa','pausada')
            """,
            (receta_id, usuario_id),
        ).fetchone()
        if prev:
            return None, "Ya hay una elaboración en curso para esta receta"
        seg0 = max(0, int(segundos_previos or 0))
        now = _now_iso()
        db.execute(
            """
            INSERT INTO receta_corridas (
                receta_id, usuario_id, estado, iniciada_en, reanudada_en,
                segundos_acumulados, proceso_orden_actual, procesos_hechos
            ) VALUES (?,?,?,?,?,?,1,'[]')
            """,
            (receta_id, usuario_id, "activa", now, now, seg0),
        )
        cid = db.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
        db.commit()
        row = db.execute("SELECT * FROM receta_corridas WHERE id=?", (cid,)).fetchone()
        return _corrida_dict(db, row), None


def get_corrida(corrida_id: int, usuario_id: int) -> dict | None:
    with _conn() as db:
        row = db.execute(
            "SELECT * FROM receta_corridas WHERE id=? AND usuario_id=?",
            (corrida_id, usuario_id),
        ).fetchone()
        return _corrida_dict(db, row) if row else None


def pausar_corrida(corrida_id: int, usuario_id: int) -> tuple[dict | None, str | None]:
    with _conn() as db:
        row = db.execute(
            "SELECT * FROM receta_corridas WHERE id=? AND usuario_id=?",
            (corrida_id, usuario_id),
        ).fetchone()
        if not row:
            return None, "Corrida no encontrada"
        c = dict(row)
        if c["estado"] != "activa":
            return None, "La elaboración no está activa"
        seg = _segundos_corrida(c)
        db.execute(
            """
            UPDATE receta_corridas
            SET estado='pausada', segundos_acumulados=?, reanudada_en=NULL
            WHERE id=?
            """,
            (seg, corrida_id),
        )
        db.commit()
        row = db.execute("SELECT * FROM receta_corridas WHERE id=?", (corrida_id,)).fetchone()
        return _corrida_dict(db, row), None


def reanudar_corrida(corrida_id: int, usuario_id: int) -> tuple[dict | None, str | None]:
    with _conn() as db:
        row = db.execute(
            "SELECT * FROM receta_corridas WHERE id=? AND usuario_id=?",
            (corrida_id, usuario_id),
        ).fetchone()
        if not row:
            return None, "Corrida no encontrada"
        if row["estado"] != "pausada":
            return None, "La elaboración no está en pausa"
        now = _now_iso()
        db.execute(
            """
            UPDATE receta_corridas SET estado='activa', reanudada_en=? WHERE id=?
            """,
            (now, corrida_id),
        )
        db.commit()
        row = db.execute("SELECT * FROM receta_corridas WHERE id=?", (corrida_id,)).fetchone()
        return _corrida_dict(db, row), None


def completar_proceso_corrida(corrida_id: int, usuario_id: int, proceso_id: int) -> tuple[dict | None, str | None]:
    with _conn() as db:
        row = db.execute(
            "SELECT * FROM receta_corridas WHERE id=? AND usuario_id=?",
            (corrida_id, usuario_id),
        ).fetchone()
        if not row:
            return None, "Corrida no encontrada"
        c = dict(row)
        hechos = []
        try:
            hechos = json.loads(c.get("procesos_hechos") or "[]")
        except json.JSONDecodeError:
            pass
        if proceso_id not in hechos:
            hechos.append(proceso_id)
        proc = db.execute(
            "SELECT orden FROM receta_procesos WHERE id=? AND receta_id=?",
            (proceso_id, c["receta_id"]),
        ).fetchone()
        next_orden = (proc["orden"] + 1) if proc else c["proceso_orden_actual"]
        db.execute(
            """
            UPDATE receta_corridas
            SET procesos_hechos=?, proceso_orden_actual=?
            WHERE id=?
            """,
            (json.dumps(hechos), next_orden, corrida_id),
        )
        db.commit()
        row = db.execute("SELECT * FROM receta_corridas WHERE id=?", (corrida_id,)).fetchone()
        return _corrida_dict(db, row), None


def guardar_corrida(corrida_id: int, usuario_id: int) -> tuple[dict | None, str | None]:
    """Persiste segundos acumulados sin finalizar; si está activa, reinicia el tramo."""
    with _conn() as db:
        row = db.execute(
            "SELECT * FROM receta_corridas WHERE id=? AND usuario_id=?",
            (corrida_id, usuario_id),
        ).fetchone()
        if not row:
            return None, "Corrida no encontrada"
        c = dict(row)
        if c["estado"] == "finalizada":
            return None, "La elaboración ya finalizó"
        now = _now_iso()
        if c["estado"] == "activa":
            seg = _segundos_corrida(c)
            db.execute(
                """
                UPDATE receta_corridas
                SET segundos_acumulados=?, reanudada_en=?
                WHERE id=?
                """,
                (seg, now, corrida_id),
            )
        db.commit()
        row = db.execute("SELECT * FROM receta_corridas WHERE id=?", (corrida_id,)).fetchone()
        return _corrida_dict(db, row), None


def finalizar_corrida(corrida_id: int, usuario_id: int) -> tuple[dict | None, str | None]:
    with _conn() as db:
        row = db.execute(
            "SELECT * FROM receta_corridas WHERE id=? AND usuario_id=?",
            (corrida_id, usuario_id),
        ).fetchone()
        if not row:
            return None, "Corrida no encontrada"
        c = dict(row)
        if c["estado"] == "activa":
            seg = _segundos_corrida(c)
        else:
            seg = int(c.get("segundos_acumulados") or 0)
        now = _now_iso()
        db.execute(
            """
            UPDATE receta_corridas
            SET estado='finalizada', segundos_acumulados=?, finalizada_en=?, reanudada_en=NULL
            WHERE id=?
            """,
            (seg, now, corrida_id),
        )
        db.commit()
        row = db.execute("SELECT * FROM receta_corridas WHERE id=?", (corrida_id,)).fetchone()
        return _corrida_dict(db, row), None
