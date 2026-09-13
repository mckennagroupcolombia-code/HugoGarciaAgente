"""
Métricas de uso del contenido de la web (Fase 4 del plan de guías vivas,
sep-2026): responde si el recetario paso a paso y la guía viva se usan y si
llevan a la compra, con datos y no con impresiones.

Eventos (lista cerrada, cualquier otro se descarta):

  receta_abierta        se abrió /recetario/<slug>            detalle: ''
  receta_paso           se llegó a un paso del wizard         detalle: nº de paso
  receta_terminada      se llegó al panel "Listo"             detalle: ''
  receta_carrito        "me falta" → productos al carrito     detalle: nº de unidades
  guia_abierta          se abrió una guía viva                detalle: ''
  guia_dosificador      se movió el dosificador               detalle: ''
  guia_ph               se movió el medidor de pH             detalle: ''
  guia_receta_click     de la guía a una receta               detalle: slug destino
  producto_aprende      clic en "Aprende a usarlo" (producto) detalle: url destino

Los manda el navegador con `navigator.sendBeacon` (static/js/contenido-eventos.js)
a `POST /api/eventos-contenido` de website.py (:8083). Solo cuenta gente con JS,
así que los robots quedan fuera; una sesión = id aleatorio en sessionStorage
(se pierde al cerrar la pestaña, no identifica a nadie).

Almacén: SQLite `app/data/metricas_contenido.db` (en .gitignore, cambia a
diario), modo WAL porque escriben website.py y lee agente_pro.py a la vez.
Lo lee `GET /api/web/metricas-contenido` (:8081) para el panel Vitrina Web.
"""

from __future__ import annotations

import os
import sqlite3
import threading
from datetime import datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DB_PATH = Path(os.getenv("METRICAS_CONTENIDO_DB") or (REPO / "app" / "data" / "metricas_contenido.db"))

EVENTOS = {
    "receta_abierta", "receta_paso", "receta_terminada", "receta_carrito",
    "guia_abierta", "guia_dosificador", "guia_ph", "guia_receta_click",
    "producto_aprende",
    # embudo de compra (diagnóstico de abandono, app/tools/recuperacion_compra.py):
    # detalle = 'movil' | 'escritorio' en los de vista/clic, el mensaje en los errores,
    # y el estado (approved/declined/pending) en pago_respuesta
    "carrito_visto", "checkout_visto", "checkout_pagar_click", "checkout_error",
    "checkout_envio_error", "pago_respuesta",
}
TIPO_DE_EVENTO = {e: e.split("_")[0] for e in EVENTOS}  # receta | guia | producto

_lock = threading.Lock()


def _conectar(path: Path | None = None) -> sqlite3.Connection:
    p = Path(path or DB_PATH)
    p.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(p), timeout=5)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute(
        """CREATE TABLE IF NOT EXISTS eventos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL,
            dia TEXT NOT NULL,
            evento TEXT NOT NULL,
            tipo TEXT NOT NULL,
            slug TEXT NOT NULL DEFAULT '',
            sesion TEXT NOT NULL DEFAULT '',
            detalle TEXT NOT NULL DEFAULT ''
        )"""
    )
    con.execute("CREATE INDEX IF NOT EXISTS ix_eventos_dia ON eventos(dia, evento)")
    con.execute("CREATE INDEX IF NOT EXISTS ix_eventos_slug ON eventos(evento, slug)")
    return con


def registrar(evento: str, slug: str = "", sesion: str = "", detalle: str = "", *, path: Path | None = None) -> bool:
    """Guarda un evento. Devuelve False (sin excepción) si el evento no está en
    la lista cerrada: el endpoint público no debe poder inventar nombres."""
    evento = (evento or "").strip()
    if evento not in EVENTOS:
        return False
    ahora = datetime.now()
    fila = (
        ahora.isoformat(timespec="seconds"),
        ahora.strftime("%Y-%m-%d"),
        evento,
        TIPO_DE_EVENTO[evento],
        str(slug or "")[:120],
        str(sesion or "")[:64],
        str(detalle or "")[:200],
    )
    with _lock:
        con = _conectar(path)
        try:
            con.execute("INSERT INTO eventos (ts, dia, evento, tipo, slug, sesion, detalle) VALUES (?,?,?,?,?,?,?)", fila)
            con.commit()
        finally:
            con.close()
    return True


def resumen(dias: int = 14, *, path: Path | None = None) -> dict:
    """Agregados para el panel: totales por evento, embudo del recetario,
    ranking de recetas y guías, y serie diaria. Solo lectura."""
    dias = max(1, min(int(dias or 14), 365))
    desde = (datetime.now() - timedelta(days=dias - 1)).strftime("%Y-%m-%d")
    con = _conectar(path)
    try:
        con.row_factory = sqlite3.Row
        q = lambda sql, *a: [dict(r) for r in con.execute(sql, a).fetchall()]  # noqa: E731

        totales = {r["evento"]: r["n"] for r in q("SELECT evento, COUNT(*) n FROM eventos WHERE dia >= ? GROUP BY evento", desde)}
        sesiones = {r["evento"]: r["n"] for r in q(
            "SELECT evento, COUNT(DISTINCT sesion) n FROM eventos WHERE dia >= ? AND sesion != '' GROUP BY evento", desde)}

        def ses(ev: str) -> int:
            return int(sesiones.get(ev, 0))

        embudo = {
            "abrieron": ses("receta_abierta"),
            "empezaron": ses("receta_paso"),
            "terminaron": ses("receta_terminada"),
            "al_carrito": ses("receta_carrito"),
            "unidades_al_carrito": int(con.execute(
                "SELECT COALESCE(SUM(CAST(detalle AS INTEGER)),0) FROM eventos WHERE dia >= ? AND evento='receta_carrito'", (desde,)
            ).fetchone()[0] or 0),
        }
        recetas = q(
            """SELECT slug,
                      COUNT(DISTINCT CASE WHEN evento='receta_abierta' THEN sesion END) abiertas,
                      COUNT(DISTINCT CASE WHEN evento='receta_terminada' THEN sesion END) terminadas,
                      COUNT(DISTINCT CASE WHEN evento='receta_carrito' THEN sesion END) carrito
               FROM eventos WHERE dia >= ? AND tipo='receta' AND slug != ''
               GROUP BY slug ORDER BY abiertas DESC, terminadas DESC LIMIT 15""", desde)
        guias = q(
            """SELECT slug,
                      COUNT(DISTINCT CASE WHEN evento='guia_abierta' THEN sesion END) abiertas,
                      COUNT(DISTINCT CASE WHEN evento='guia_dosificador' THEN sesion END) dosificador,
                      COUNT(DISTINCT CASE WHEN evento='guia_ph' THEN sesion END) ph,
                      COUNT(DISTINCT CASE WHEN evento='guia_receta_click' THEN sesion END) a_receta
               FROM eventos WHERE dia >= ? AND tipo='guia' AND slug != ''
               GROUP BY slug ORDER BY abiertas DESC, dosificador DESC LIMIT 15""", desde)
        productos = q(
            """SELECT slug, COUNT(*) clics, COUNT(DISTINCT sesion) sesiones
               FROM eventos WHERE dia >= ? AND evento='producto_aprende' AND slug != ''
               GROUP BY slug ORDER BY clics DESC LIMIT 10""", desde)
        serie = q(
            """SELECT dia,
                      COUNT(DISTINCT CASE WHEN evento='receta_abierta' THEN sesion END) recetas,
                      COUNT(DISTINCT CASE WHEN evento='guia_abierta' THEN sesion END) guias,
                      COUNT(DISTINCT CASE WHEN evento='receta_carrito' THEN sesion END) carrito
               FROM eventos WHERE dia >= ? GROUP BY dia ORDER BY dia""", desde)
    finally:
        con.close()
    return {
        "dias": dias,
        "desde": desde,
        "totales": totales,
        "sesiones": sesiones,
        "embudo": embudo,
        "recetas": recetas,
        "guias": guias,
        "productos": productos,
        "serie": serie,
    }
