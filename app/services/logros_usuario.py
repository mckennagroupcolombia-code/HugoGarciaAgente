"""
Logros y monedas de cada usuario del panel: lo que cada quien hace en la app (resolver una tarea,
responder a un cliente, empacar un pedido, conciliar un extracto, aprobar una etiqueta…) se juega
como una misión y paga monedas según su dificultad.

La tarifa vive AQUÍ, no en el navegador. Hay dos formas de cobrar:
  - el árbitro del servidor (`logros_hook.py`) paga solo las acciones de su catálogo al terminar
    bien la petición;
  - el panel avisa las aprobaciones que ocurren en el navegador (`POST /api/tickets/auth/logros`),
    pero solo dice cuál misión y sobre qué referencia: el monto lo pone esta tabla.
La misma misión sobre la misma referencia paga una sola vez al día, y las misiones repetitivas
tienen tope diario (comentar 200 veces no paga 200 veces).
Las monedas son del juego: no son dinero ni se cruzan con nómina o cuentas de cobro.
"""
from __future__ import annotations

import sqlite3
from datetime import date, datetime, timedelta
from typing import NamedTuple

from app.services.tickets_db import DB_PATH


class Mision(NamedTuple):
    titulo: str
    monedas: int
    dificultad: str  # fácil · media · difícil
    area: str
    tope_dia: int | None = None  # cuántas veces al día paga (None = sin tope)


# Ordenadas por área y, dentro de cada una, de fácil a difícil.
MISIONES: dict[str, Mision] = {
    # Tareas y equipo (tickets, misiones, producción) — lo que hace todo el equipo.
    "ticket_comentario": Mision("Comentar una tarea", 2, "fácil", "Tareas y equipo", 10),
    "ticket_creado": Mision("Crear una tarea o solicitud", 3, "fácil", "Tareas y equipo", 10),
    "evidencia": Mision("Subir una evidencia (foto o adjunto)", 3, "fácil", "Tareas y equipo", 15),
    "ticket_paso": Mision("Completar un paso de una tarea", 5, "fácil", "Tareas y equipo", 40),
    "produccion_proceso": Mision("Completar un proceso de producción", 5, "fácil", "Tareas y equipo", 40),
    "accion_completada": Mision("Completar una acción pendiente", 10, "fácil", "Tareas y equipo", 20),
    "rutina_5s": Mision("Registrar una rutina 5S", 10, "fácil", "Tareas y equipo", 5),
    "ticket_resuelto": Mision("Resolver una tarea o solicitud", 25, "media", "Tareas y equipo"),
    "mision_corrida": Mision("Terminar una misión programada", 30, "media", "Tareas y equipo"),
    "protocolo": Mision("Documentar un procedimiento", 30, "media", "Tareas y equipo", 5),
    "produccion_lote": Mision("Terminar una producción (receta)", 50, "difícil", "Tareas y equipo"),
    # Ventas y clientes.
    "respuesta_cliente": Mision("Responder a un cliente", 5, "fácil", "Ventas y clientes", 40),
    "venta_revisada": Mision("Revisar una venta", 5, "fácil", "Ventas y clientes", 40),
    "factura_emitida": Mision("Facturar una venta", 15, "media", "Ventas y clientes", 40),
    # Despachos e inventario.
    "rotulos": Mision("Generar rótulos de envío", 5, "fácil", "Despachos e inventario", 10),
    "conteo_stock": Mision("Contar o ajustar inventario", 5, "fácil", "Despachos e inventario", 30),
    "empaque_evidencia": Mision("Registrar la evidencia de un empaque", 10, "fácil", "Despachos e inventario", 60),
    "solicitud_compra": Mision("Pedir la compra de un insumo", 10, "fácil", "Despachos e inventario", 10),
    # Contabilidad y pagos.
    "comprobante": Mision("Subir un comprobante", 3, "fácil", "Contabilidad y pagos", 30),
    "movimiento_contable": Mision("Registrar un movimiento contable", 5, "fácil", "Contabilidad y pagos", 40),
    "conciliacion": Mision("Conciliar un movimiento del extracto", 5, "fácil", "Contabilidad y pagos", 60),
    "pago_solicitado": Mision("Solicitar un pago", 10, "fácil", "Contabilidad y pagos", 20),
    "pago_aprobado": Mision("Aprobar un pago", 10, "fácil", "Contabilidad y pagos"),
    "factura_proveedor": Mision("Procesar una factura de proveedor", 15, "media", "Contabilidad y pagos", 30),
    "pago_confirmado": Mision("Confirmar un pago hecho", 15, "media", "Contabilidad y pagos"),
    "conciliacion_lote": Mision("Conciliar un extracto en lote", 20, "media", "Contabilidad y pagos", 5),
    # Catálogo y publicaciones.
    "ean_asignado": Mision("Asignar un código de barras", 5, "fácil", "Catálogo y publicaciones", 30),
    "publicacion_imagen": Mision("Mejorar las fotos de una publicación", 5, "fácil", "Catálogo y publicaciones", 30),
    "publicacion_editada": Mision("Mejorar una publicación", 10, "fácil", "Catálogo y publicaciones", 30),
    "meli_republicar": Mision("Republicar en Mercado Libre", 20, "media", "Catálogo y publicaciones", 20),
    "meli_crear": Mision("Crear una publicación nueva en Mercado Libre", 30, "media", "Catálogo y publicaciones", 20),
    # Calidad y etiquetas (aprobaciones: las avisa el panel).
    "revision_marcada": Mision("Marcar un producto revisado", 5, "fácil", "Calidad y etiquetas"),
    "etiqueta_lote": Mision("Etiqueta aprobada en lote", 5, "fácil", "Calidad y etiquetas", 100),
    "sds_visto_bueno": Mision("Visto bueno a una hoja de seguridad", 10, "fácil", "Calidad y etiquetas"),
    "lote_documentado": Mision("Documentar un lote", 10, "fácil", "Calidad y etiquetas", 30),
    "etiqueta_aprobada": Mision("Aprobar una etiqueta", 20, "media", "Calidad y etiquetas"),
    "combo_completo": Mision("Completar un combo en el taller", 30, "media", "Calidad y etiquetas"),
    "documento_calidad": Mision("Generar un COA o una SDS", 30, "media", "Calidad y etiquetas"),
    "ficha_aprobada": Mision("Aprobar una ficha técnica (FT + COA + SDS)", 50, "difícil", "Calidad y etiquetas"),
}

# Niveles por monedas acumuladas.
NIVELES: list[tuple[int, str]] = [
    (0, "Aprendiz"),
    (100, "Colaborador"),
    (300, "Experto"),
    (700, "Referente del equipo"),
    (1500, "Maestro McKenna"),
    (3000, "Leyenda McKenna"),
]

# clave → (nombre, descripción, icono); las condiciones están en `_condiciones`.
LOGROS: list[tuple[str, str, str, str]] = [
    ("primera_mision", "Primer paso", "Cumpliste tu primera misión", "🌱"),
    ("tareas_10", "Resolutivo", "10 tareas o solicitudes resueltas", "✅"),
    ("tareas_50", "Imparable", "50 tareas o solicitudes resueltas", "🚀"),
    ("pasos_100", "Paso a paso", "100 pasos de tareas completados", "👣"),
    ("produccion_1", "Manos a la obra", "Tu primera producción terminada", "⚗️"),
    ("clientes_50", "Voz del cliente", "50 respuestas a clientes", "💬"),
    ("despachos_25", "Empacador estrella", "25 empaques con evidencia", "📦"),
    ("contable_50", "Cuentas claras", "50 movimientos o conciliaciones", "📒"),
    ("publicaciones_10", "Vitrina brillante", "10 publicaciones mejoradas", "🛍️"),
    ("primera_etiqueta", "Primera etiqueta", "Aprobaste tu primera etiqueta", "🏷️"),
    ("etiquetas_50", "Imprenta humana", "50 etiquetas aprobadas", "🖨️"),
    ("primera_ficha", "Primera ficha", "Aprobaste tu primera ficha técnica", "📄"),
    ("fichas_10", "Químico de escritorio", "10 fichas técnicas aprobadas", "🧪"),
    ("revisiones_25", "Ojo de halcón", "25 revisiones marcadas", "🦅"),
    ("combos_10", "Armador de combos", "10 combos completos", "🧩"),
    ("todoterreno", "Todoterreno", "Misiones en 3 áreas distintas", "🧭"),
    ("dia_10", "Día productivo", "10 misiones en un mismo día", "⚡"),
    ("racha_3", "Racha de 3 días", "Misiones 3 días seguidos", "🔥"),
    ("racha_7", "Semana perfecta", "Misiones 7 días seguidos", "🏆"),
    ("monedas_1000", "Cofre lleno", "1.000 monedas acumuladas", "💰"),
]


def _conn():
    c = sqlite3.connect(DB_PATH, timeout=5)
    c.row_factory = sqlite3.Row
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS logros_misiones (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id  INTEGER NOT NULL,
            mision      TEXT NOT NULL,
            ref         TEXT NOT NULL DEFAULT '',
            detalle     TEXT NOT NULL DEFAULT '',
            monedas     INTEGER NOT NULL,
            dia         TEXT NOT NULL,
            creado_en   TEXT NOT NULL,
            UNIQUE (usuario_id, mision, ref, dia)
        )
        """
    )
    c.execute(
        "CREATE INDEX IF NOT EXISTS idx_logros_misiones_usuario ON logros_misiones (usuario_id, creado_en)"
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS logros_desbloqueados (
            usuario_id  INTEGER NOT NULL,
            logro       TEXT NOT NULL,
            creado_en   TEXT NOT NULL,
            PRIMARY KEY (usuario_id, logro)
        )
        """
    )
    return c


def _nivel(monedas: int) -> dict:
    idx = max(i for i, (desde, _) in enumerate(NIVELES) if monedas >= desde)
    desde, nombre = NIVELES[idx]
    siguiente = NIVELES[idx + 1] if idx + 1 < len(NIVELES) else None
    return {
        "numero": idx + 1,
        "nombre": nombre,
        "desde": desde,
        "hasta": siguiente[0] if siguiente else None,
        "siguiente": siguiente[1] if siguiente else None,
    }


def _racha(dias: set[str]) -> int:
    """Días seguidos con misiones terminando hoy (o ayer, si hoy aún no hay)."""
    d = date.today()
    if d.isoformat() not in dias:
        d -= timedelta(days=1)
    n = 0
    while d.isoformat() in dias:
        n += 1
        d -= timedelta(days=1)
    return n


def _condiciones(db, uid: int) -> dict[str, bool]:
    cuenta = {
        r["mision"]: r["n"]
        for r in db.execute(
            "SELECT mision, COUNT(*) n FROM logros_misiones WHERE usuario_id=? GROUP BY mision", (uid,)
        )
    }

    def n(*claves: str) -> int:
        return sum(cuenta.get(c, 0) for c in claves)

    max_dia = db.execute(
        "SELECT COALESCE(MAX(n),0) FROM (SELECT COUNT(*) n FROM logros_misiones WHERE usuario_id=? GROUP BY dia)",
        (uid,),
    ).fetchone()[0]
    dias = {r[0] for r in db.execute("SELECT DISTINCT dia FROM logros_misiones WHERE usuario_id=?", (uid,))}
    racha = _racha(dias)
    total = db.execute("SELECT COALESCE(SUM(monedas),0) FROM logros_misiones WHERE usuario_id=?", (uid,)).fetchone()[0]
    areas = {MISIONES[c].area for c in cuenta if c in MISIONES}
    return {
        "primera_mision": sum(cuenta.values()) >= 1,
        "tareas_10": n("ticket_resuelto", "mision_corrida") >= 10,
        "tareas_50": n("ticket_resuelto", "mision_corrida") >= 50,
        "pasos_100": n("ticket_paso", "produccion_proceso") >= 100,
        "produccion_1": n("produccion_lote") >= 1,
        "clientes_50": n("respuesta_cliente") >= 50,
        "despachos_25": n("empaque_evidencia") >= 25,
        "contable_50": n("movimiento_contable", "conciliacion", "conciliacion_lote") >= 50,
        "publicaciones_10": n("publicacion_editada", "meli_republicar", "meli_crear") >= 10,
        "primera_etiqueta": n("etiqueta_aprobada", "etiqueta_lote") >= 1,
        "etiquetas_50": n("etiqueta_aprobada", "etiqueta_lote") >= 50,
        "primera_ficha": n("ficha_aprobada") >= 1,
        "fichas_10": n("ficha_aprobada") >= 10,
        "revisiones_25": n("revision_marcada") >= 25,
        "combos_10": n("combo_completo") >= 10,
        "todoterreno": len(areas) >= 3,
        "dia_10": max_dia >= 10,
        "racha_3": racha >= 3,
        "racha_7": racha >= 7,
        "monedas_1000": total >= 1000,
    }


def registrar_mision(uid: int, mision: str, ref: str = "", detalle: str = "") -> dict:
    """Paga la misión (una vez al día por referencia, hasta su tope diario) y devuelve lo
    ganado y los logros nuevos."""
    if mision not in MISIONES:
        raise ValueError(f"Misión desconocida: {mision}")
    m = MISIONES[mision]
    ref = (ref or "").strip()[:200]
    detalle = (detalle or "").strip()[:200]
    ahora = datetime.now()
    dia = ahora.date().isoformat()
    with _conn() as db:
        pagada = False
        motivo = ""
        veces_hoy = db.execute(
            "SELECT COUNT(*) FROM logros_misiones WHERE usuario_id=? AND mision=? AND dia=?", (uid, mision, dia)
        ).fetchone()[0]
        if m.tope_dia is not None and veces_hoy >= m.tope_dia:
            motivo = "tope"
        else:
            cur = db.execute(
                "INSERT OR IGNORE INTO logros_misiones (usuario_id, mision, ref, detalle, monedas, dia, creado_en) "
                "VALUES (?,?,?,?,?,?,?)",
                (uid, mision, ref, detalle, m.monedas, dia, ahora.isoformat(timespec="seconds")),
            )
            pagada = cur.rowcount > 0
            motivo = "" if pagada else "repetida"
        nuevos = []
        if pagada:
            ya = {r[0] for r in db.execute("SELECT logro FROM logros_desbloqueados WHERE usuario_id=?", (uid,))}
            for clave, ok in _condiciones(db, uid).items():
                if ok and clave not in ya:
                    db.execute(
                        "INSERT INTO logros_desbloqueados (usuario_id, logro, creado_en) VALUES (?,?,?)",
                        (uid, clave, ahora.isoformat(timespec="seconds")),
                    )
                    nuevos.append(clave)
        total = db.execute("SELECT COALESCE(SUM(monedas),0) FROM logros_misiones WHERE usuario_id=?", (uid,)).fetchone()[0]
        hoy = db.execute("SELECT COUNT(*) FROM logros_misiones WHERE usuario_id=? AND dia=?", (uid, dia)).fetchone()[0]
    info = {c: (nom, d, i) for c, nom, d, i in LOGROS}
    return {
        "mision": mision,
        "titulo": m.titulo,
        "pagada": pagada,
        "motivo": motivo,
        "monedas": m.monedas if pagada else 0,
        "total": total,
        "hoy": hoy,
        "nivel": _nivel(total),
        "logros_nuevos": [{"clave": c, "nombre": info[c][0], "descripcion": info[c][1], "icono": info[c][2]} for c in nuevos],
    }


def resumen_usuario(uid: int) -> dict:
    with _conn() as db:
        total = db.execute("SELECT COALESCE(SUM(monedas),0) FROM logros_misiones WHERE usuario_id=?", (uid,)).fetchone()[0]
        hoy_iso = date.today().isoformat()
        hoy = db.execute(
            "SELECT COUNT(*), COALESCE(SUM(monedas),0) FROM logros_misiones WHERE usuario_id=? AND dia=?", (uid, hoy_iso)
        ).fetchone()
        por_mision = {
            r["mision"]: {"veces": r["n"], "ganado": r["m"]}
            for r in db.execute(
                "SELECT mision, COUNT(*) n, SUM(monedas) m FROM logros_misiones WHERE usuario_id=? GROUP BY mision", (uid,)
            )
        }
        desbloqueados = {
            r["logro"]: r["creado_en"]
            for r in db.execute("SELECT logro, creado_en FROM logros_desbloqueados WHERE usuario_id=?", (uid,))
        }
        dias = {r[0] for r in db.execute("SELECT DISTINCT dia FROM logros_misiones WHERE usuario_id=?", (uid,))}
        historial = [
            dict(r)
            for r in db.execute(
                "SELECT mision, ref, detalle, monedas, creado_en FROM logros_misiones WHERE usuario_id=? "
                "ORDER BY id DESC LIMIT 30",
                (uid,),
            )
        ]
    for h in historial:
        h["titulo"] = MISIONES[h["mision"]].titulo if h["mision"] in MISIONES else h["mision"]
    return {
        "total": total,
        "nivel": _nivel(total),
        "hoy": {"misiones": hoy[0], "monedas": hoy[1]},
        "racha": _racha(dias),
        "tarifa": [
            {
                "clave": c,
                "titulo": m.titulo,
                "monedas": m.monedas,
                "dificultad": m.dificultad,
                "area": m.area,
                "tope_dia": m.tope_dia,
                **por_mision.get(c, {"veces": 0, "ganado": 0}),
            }
            for c, m in MISIONES.items()
        ],
        "logros": [
            {"clave": c, "nombre": n, "descripcion": d, "icono": i, "desbloqueado_en": desbloqueados.get(c)}
            for c, n, d, i in LOGROS
        ],
        "historial": historial,
    }
