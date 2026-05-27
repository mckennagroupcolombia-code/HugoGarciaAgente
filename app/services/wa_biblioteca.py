"""
Biblioteca de recursos rápidos para el panel de WhatsApp.
Textos predefinidos, links y archivos que el operador envía con un clic.
"""
import sqlite3
import os
import time
import uuid
import threading

_BASE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
_DB = os.path.join(_BASE_DIR, "wa_biblioteca.db")
_FILES_DIR = os.path.join(_BASE_DIR, "wa_biblioteca_files")
_lock = threading.Lock()

CATEGORIAS = ["General", "Pagos", "Envíos", "Catálogos", "Información", "Otros"]


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(_DB, check_same_thread=False, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c


def _init() -> None:
    os.makedirs(_FILES_DIR, exist_ok=True)
    with _lock, _conn() as c:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS items (
                id          TEXT    PRIMARY KEY,
                tipo        TEXT    NOT NULL CHECK(tipo IN ('texto','link','archivo')),
                titulo      TEXT    NOT NULL,
                contenido   TEXT    NOT NULL DEFAULT '',
                url         TEXT    NOT NULL DEFAULT '',
                nombre_arch TEXT    NOT NULL DEFAULT '',
                mime_type   TEXT    NOT NULL DEFAULT '',
                categoria   TEXT    NOT NULL DEFAULT 'General',
                ts          REAL    NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_cat_ts ON items(categoria, ts);
        """)


_init()


def listar() -> list[dict]:
    try:
        with _lock, _conn() as c:
            rows = c.execute(
                "SELECT * FROM items ORDER BY categoria, ts DESC"
            ).fetchall()
            return [dict(r) for r in rows]
    except Exception as e:
        print(f"[wa_biblioteca] error listar: {e}")
        return []


def obtener(item_id: str) -> dict | None:
    try:
        with _lock, _conn() as c:
            row = c.execute(
                "SELECT * FROM items WHERE id=?", (item_id,)
            ).fetchone()
            return dict(row) if row else None
    except Exception as e:
        print(f"[wa_biblioteca] error obtener: {e}")
        return None


def agregar_texto(titulo: str, contenido: str, categoria: str = "General") -> dict:
    item_id = str(uuid.uuid4())[:12]
    cat = categoria if categoria in CATEGORIAS else "General"
    try:
        with _lock, _conn() as c:
            c.execute(
                "INSERT INTO items(id,tipo,titulo,contenido,categoria,ts) VALUES(?,?,?,?,?,?)",
                (item_id, "texto", titulo[:120], contenido[:4000], cat, time.time()),
            )
        return {"ok": True, "id": item_id}
    except Exception as e:
        print(f"[wa_biblioteca] error agregar_texto: {e}")
        return {"ok": False, "error": str(e)}


def agregar_link(titulo: str, url: str, categoria: str = "General") -> dict:
    item_id = str(uuid.uuid4())[:12]
    cat = categoria if categoria in CATEGORIAS else "General"
    try:
        with _lock, _conn() as c:
            c.execute(
                "INSERT INTO items(id,tipo,titulo,url,categoria,ts) VALUES(?,?,?,?,?,?)",
                (item_id, "link", titulo[:120], url[:2000], cat, time.time()),
            )
        return {"ok": True, "id": item_id}
    except Exception as e:
        print(f"[wa_biblioteca] error agregar_link: {e}")
        return {"ok": False, "error": str(e)}


def agregar_archivo(titulo: str, nombre_arch: str, datos: bytes, mime_type: str, categoria: str = "General") -> dict:
    item_id = str(uuid.uuid4())[:12]
    cat = categoria if categoria in CATEGORIAS else "General"
    # Sanitize filename
    ext = os.path.splitext(nombre_arch)[1].lower()[:8]
    safe_name = item_id + ext
    ruta = os.path.join(_FILES_DIR, safe_name)
    try:
        with open(ruta, "wb") as f:
            f.write(datos)
        with _lock, _conn() as c:
            c.execute(
                "INSERT INTO items(id,tipo,titulo,nombre_arch,mime_type,categoria,ts,contenido) VALUES(?,?,?,?,?,?,?,?)",
                (item_id, "archivo", titulo[:120], nombre_arch[:200], mime_type[:100], cat, time.time(), safe_name),
            )
        return {"ok": True, "id": item_id}
    except Exception as e:
        print(f"[wa_biblioteca] error agregar_archivo: {e}")
        return {"ok": False, "error": str(e)}


def eliminar(item_id: str) -> dict:
    item = obtener(item_id)
    if not item:
        return {"ok": False, "error": "no encontrado"}
    try:
        if item["tipo"] == "archivo" and item["contenido"]:
            ruta = os.path.join(_FILES_DIR, item["contenido"])
            if os.path.exists(ruta):
                os.remove(ruta)
        with _lock, _conn() as c:
            c.execute("DELETE FROM items WHERE id=?", (item_id,))
        return {"ok": True}
    except Exception as e:
        print(f"[wa_biblioteca] error eliminar: {e}")
        return {"ok": False, "error": str(e)}


def ruta_archivo(item_id: str) -> str | None:
    """Devuelve la ruta absoluta al archivo si existe."""
    item = obtener(item_id)
    if not item or item["tipo"] != "archivo" or not item["contenido"]:
        return None
    ruta = os.path.join(_FILES_DIR, item["contenido"])
    return ruta if os.path.exists(ruta) else None
