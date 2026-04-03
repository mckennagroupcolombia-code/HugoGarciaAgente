"""
REC-04: Base de Datos de Clientes con Historial de Compras
SQLite con perfil completo por cliente (WA / NIT).
Permite al agente personalizar la atención y detectar clientes recurrentes.
"""

import os
import sqlite3
from datetime import datetime

DB_PATH = os.path.join("/home/mckg/mi-agente", "app", "data", "clientes.db")


def _init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS clientes (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            numero_wa   TEXT UNIQUE,
            nit         TEXT,
            nombre      TEXT,
            correo      TEXT,
            direccion   TEXT,
            ciudad      TEXT,
            primera_compra TEXT,
            ultima_compra  TEXT,
            total_compras  INTEGER DEFAULT 0,
            valor_total    REAL    DEFAULT 0,
            notas          TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS compras (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            cliente_id  INTEGER,
            order_id    TEXT,
            plataforma  TEXT,
            productos   TEXT,
            total       REAL,
            fecha       TEXT,
            FOREIGN KEY(cliente_id) REFERENCES clientes(id)
        )
    """)
    conn.commit()
    conn.close()

_init_db()


def upsert_cliente(numero_wa: str = None, nit: str = None, nombre: str = None,
                   correo: str = None, direccion: str = None, ciudad: str = None) -> int:
    """Crea o actualiza un cliente. Retorna su ID."""
    conn = sqlite3.connect(DB_PATH)
    ahora = datetime.now().isoformat()
    existing = None

    if numero_wa:
        existing = conn.execute("SELECT id FROM clientes WHERE numero_wa=?", (numero_wa,)).fetchone()
    if not existing and nit:
        existing = conn.execute("SELECT id FROM clientes WHERE nit=?", (nit,)).fetchone()

    if existing:
        cid = existing[0]
        updates, vals = [], []
        for campo, valor in [("nombre", nombre), ("correo", correo), ("direccion", direccion),
                               ("ciudad", ciudad), ("nit", nit), ("numero_wa", numero_wa)]:
            if valor:
                updates.append(f"{campo}=?")
                vals.append(valor)
        if updates:
            vals.append(cid)
            conn.execute(f"UPDATE clientes SET {','.join(updates)} WHERE id=?", vals)
    else:
        conn.execute(
            "INSERT INTO clientes (numero_wa, nit, nombre, correo, direccion, ciudad, primera_compra) "
            "VALUES (?,?,?,?,?,?,?)",
            (numero_wa, nit, nombre, correo, direccion, ciudad, ahora)
        )
        cid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

    conn.commit()
    conn.close()
    return cid


def registrar_compra(numero_wa: str, order_id: str, plataforma: str,
                     productos: list, total: float):
    """
    Registra una compra para un cliente y actualiza sus estadísticas.
    productos = [{"nombre": "...", "cantidad": 1}]
    """
    conn = sqlite3.connect(DB_PATH)
    ahora = datetime.now().isoformat()

    # Buscar o crear cliente
    row = conn.execute("SELECT id FROM clientes WHERE numero_wa=?", (numero_wa,)).fetchone()
    if not row:
        conn.execute("INSERT INTO clientes (numero_wa, primera_compra) VALUES (?,?)", (numero_wa, ahora))
        conn.commit()
        row = conn.execute("SELECT id FROM clientes WHERE numero_wa=?", (numero_wa,)).fetchone()

    cid = row[0]
    productos_str = ", ".join(f"{p.get('nombre','')} x{p.get('cantidad',1)}" for p in productos)

    conn.execute(
        "INSERT INTO compras (cliente_id, order_id, plataforma, productos, total, fecha) VALUES (?,?,?,?,?,?)",
        (cid, order_id, plataforma, productos_str, total, ahora)
    )
    conn.execute(
        "UPDATE clientes SET ultima_compra=?, total_compras=total_compras+1, valor_total=valor_total+? WHERE id=?",
        (ahora, total, cid)
    )
    conn.commit()
    conn.close()
    print(f"👤 [CLIENTES DB] Compra registrada: {numero_wa} | {order_id} | ${total:,.0f}")


def obtener_perfil_cliente(numero_wa: str) -> dict | None:
    """Retorna el perfil completo de un cliente y su historial de compras."""
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT id, numero_wa, nit, nombre, correo, direccion, ciudad, "
        "primera_compra, ultima_compra, total_compras, valor_total, notas "
        "FROM clientes WHERE numero_wa=?", (numero_wa,)
    ).fetchone()

    if not row:
        conn.close()
        return None

    cid = row[0]
    compras = conn.execute(
        "SELECT order_id, plataforma, productos, total, fecha FROM compras WHERE cliente_id=? ORDER BY fecha DESC LIMIT 5",
        (cid,)
    ).fetchall()
    conn.close()

    return {
        "id": cid, "numero_wa": row[1], "nit": row[2], "nombre": row[3],
        "correo": row[4], "direccion": row[5], "ciudad": row[6],
        "primera_compra": row[7], "ultima_compra": row[8],
        "total_compras": row[9], "valor_total": row[10], "notas": row[11],
        "historial": [
            {"order_id": c[0], "plataforma": c[1], "productos": c[2], "total": c[3], "fecha": c[4]}
            for c in compras
        ]
    }


def saludo_personalizado(numero_wa: str) -> str | None:
    """
    Si el cliente tiene historial, genera un saludo personalizado.
    Retorna None si es cliente nuevo.
    """
    perfil = obtener_perfil_cliente(numero_wa)
    if not perfil or perfil["total_compras"] == 0:
        return None

    nombre = perfil["nombre"].split()[0] if perfil["nombre"] else "veci"
    n_compras = perfil["total_compras"]
    ultimo = ""
    if perfil["historial"]:
        ultimo = perfil["historial"][0]["productos"]

    if n_compras == 1:
        return f"¡Hola de nuevo {nombre}! 👋 La última vez adquiriste {ultimo}. ¿En qué te puedo ayudar hoy?"
    else:
        return (f"¡Hola {nombre}! Bienvenido de vuelta 👋 — ya tienes {n_compras} compras con nosotros. "
                f"Cuéntame en qué te puedo ayudar hoy.")


def resumen_clientes() -> dict:
    """Retorna estadísticas generales de la base de clientes."""
    conn = sqlite3.connect(DB_PATH)
    total = conn.execute("SELECT COUNT(*) FROM clientes").fetchone()[0]
    recurrentes = conn.execute("SELECT COUNT(*) FROM clientes WHERE total_compras > 1").fetchone()[0]
    valor = conn.execute("SELECT SUM(valor_total) FROM clientes").fetchone()[0] or 0
    conn.close()
    return {"total_clientes": total, "recurrentes": recurrentes, "valor_total_acumulado": valor}
