"""
Expedientes de anulación (RA) — persistencia y línea de tiempo.

Un "expediente" es la unidad de trabajo del módulo de Resolución de
Anulaciones: todo evento que anula o reduce una venta ya facturada
(cancelación, devolución, reclamo, reembolso, cambio) abre uno, y ese
expediente acompaña el caso hasta que la nota crédito queda emitida, subida a
MeLi y posteada en el libro mayor propio.

Reemplaza a `app/data/notas_credito_auto_log.json`, que solo sabía decir
"emitida" / "ya_tenia_nc" y por eso no distinguía un caso resuelto de uno que
nunca se intentó — la razón por la que el pack 2000014813807951 quedó sin
nota crédito sin dejar rastro (ver `docs/agentic/modules/anulaciones-nc.md`).

Dos tablas en `app/data/contabilidad.db` (la misma base del libro de partida
doble, para que el expediente y su asiento vivan juntos):

  anulaciones        — estado actual + campos duros (montos, ids, CUFE)
  anulacion_eventos  — línea de tiempo APPEND-ONLY

`anulacion_eventos` no se edita nunca. Una corrección se registra como un
evento nuevo que la explica. Eso es lo que convierte el historial en corpus de
precedentes consultable por otros agentes, y no solo en un campo de estado.

Invariantes:
  - `referencia` es única y determinista ("meli:pack:<id>") → idempotencia.
  - Los campos duros se llenan desde la API, nunca desde texto generado.
  - Un expediente nunca se borra; `descartada` es un estado, no un DELETE.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from typing import Any

_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "contabilidad.db")
_initialized = False


# ── Vocabulario cerrado ───────────────────────────────────────────────────────

ORIGENES = (
    "meli_cancelacion",
    "meli_reclamo",
    "web",
    "whatsapp",
    "manual",
)

# Ver la matriz de situaciones en docs/agentic/modules/anulaciones-nc.md
MOTIVOS = (
    "cancelacion_pre_despacho",
    "devolucion_producto",
    "reembolso_sin_devolucion",
    "reembolso_meli",
    "devolucion_parcial",
    "cambio_producto",
    "desconocido",
)

ESTADOS = (
    "detectada",
    "en_margen",
    "lista",
    "emitiendo",
    "emitida",
    "subida_meli",
    "posteado_libro",
    "cerrada",
    "requiere_decision",
    "bloqueada",
    "descartada",
)

# Transiciones permitidas. Cualquier otra lanza ValueError: un expediente que
# salta de "detectada" a "cerrada" sin pasar por la emisión es un bug, no un
# atajo.
_TRANSICIONES: dict[str, set[str]] = {
    "detectada": {"en_margen", "lista", "requiere_decision", "bloqueada", "descartada"},
    "en_margen": {"lista", "requiere_decision", "bloqueada", "descartada"},
    "lista": {"emitiendo", "requiere_decision", "bloqueada", "descartada"},
    "emitiendo": {"emitida", "bloqueada", "requiere_decision"},
    "emitida": {"subida_meli", "posteado_libro", "cerrada", "bloqueada"},
    "subida_meli": {"posteado_libro", "cerrada", "bloqueada"},
    "posteado_libro": {"subida_meli", "cerrada", "bloqueada"},
    "cerrada": set(),
    # Un caso bloqueado o pendiente de decisión SIEMPRE puede volver al ruedo:
    # el `read_only` de Siigo se resuelve reactivando la cuenta, y una decisión
    # humana desbloquea el resto.
    "requiere_decision": {"lista", "bloqueada", "descartada", "emitiendo"},
    "bloqueada": {"detectada", "lista", "requiere_decision", "descartada", "emitiendo"},
    "descartada": {"detectada"},
}

ESTADOS_ABIERTOS = (
    "detectada",
    "en_margen",
    "lista",
    "emitiendo",
    "emitida",
    "subida_meli",
    "posteado_libro",
    "requiere_decision",
    "bloqueada",
)

TIPOS_EVENTO = (
    "detectado",
    "enriquecido",
    "decidido",
    "emitido",
    "fallo",
    "subido_meli",
    "posteado_libro",
    "inventario",
    "nota",
)


# ── Conexión / esquema ────────────────────────────────────────────────────────


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
    """Crea las tablas si no existen. Idempotente — se llama en cada entrada
    pública del módulo, igual que `contabilidad_db.init_db()`."""
    global _initialized
    if _initialized:
        return
    os.makedirs(os.path.dirname(os.path.abspath(_DB_PATH)), exist_ok=True)
    with _conn() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS anulaciones (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo            TEXT NOT NULL UNIQUE,
            referencia        TEXT NOT NULL UNIQUE,
            origen            TEXT NOT NULL,
            order_id          TEXT NOT NULL DEFAULT '',
            pack_id           TEXT NOT NULL DEFAULT '',
            claim_id          TEXT NOT NULL DEFAULT '',
            cliente_nombre    TEXT NOT NULL DEFAULT '',
            cliente_doc       TEXT NOT NULL DEFAULT '',
            factura_proveedor TEXT NOT NULL DEFAULT '',
            factura_id        TEXT NOT NULL DEFAULT '',
            factura_numero    TEXT NOT NULL DEFAULT '',
            factura_cufe      TEXT NOT NULL DEFAULT '',
            factura_fecha     TEXT NOT NULL DEFAULT '',
            factura_total     REAL NOT NULL DEFAULT 0,
            motivo            TEXT NOT NULL DEFAULT 'desconocido',
            monto_reintegrado REAL NOT NULL DEFAULT 0,
            alcance           TEXT NOT NULL DEFAULT '',
            producto_retorna  INTEGER,
            financia          TEXT NOT NULL DEFAULT '',
            estado            TEXT NOT NULL DEFAULT 'detectada',
            autonomia         TEXT NOT NULL DEFAULT '',
            bloqueo_motivo    TEXT NOT NULL DEFAULT '',
            nc_proveedor      TEXT NOT NULL DEFAULT '',
            nc_id             TEXT NOT NULL DEFAULT '',
            nc_numero         TEXT NOT NULL DEFAULT '',
            nc_cufe           TEXT NOT NULL DEFAULT '',
            nc_total          REAL NOT NULL DEFAULT 0,
            nc_url            TEXT NOT NULL DEFAULT '',
            movimiento_id     TEXT NOT NULL DEFAULT '',
            inventario_estado TEXT NOT NULL DEFAULT 'pendiente',
            ticket_id         INTEGER,
            relato            TEXT NOT NULL DEFAULT '',
            abierta_en        TEXT NOT NULL,
            cerrada_en        TEXT,
            actualizado_en    TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_anulaciones_estado ON anulaciones(estado);
        CREATE INDEX IF NOT EXISTS idx_anulaciones_pack ON anulaciones(pack_id);
        CREATE INDEX IF NOT EXISTS idx_anulaciones_factura ON anulaciones(factura_id);

        CREATE TABLE IF NOT EXISTS anulacion_eventos (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            anulacion_id INTEGER NOT NULL REFERENCES anulaciones(id),
            ts           TEXT NOT NULL,
            actor        TEXT NOT NULL DEFAULT 'sistema',
            tipo         TEXT NOT NULL,
            resumen      TEXT NOT NULL,
            datos_json   TEXT NOT NULL DEFAULT '',
            hash         TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_anul_eventos_caso ON anulacion_eventos(anulacion_id, id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_anul_eventos_hash
            ON anulacion_eventos(anulacion_id, hash) WHERE hash <> '';
        """)
    _initialized = True


def _ahora() -> str:
    return datetime.now().isoformat(timespec="seconds")


# ── Código público del expediente ─────────────────────────────────────────────


def _siguiente_codigo(con: sqlite3.Connection) -> str:
    """`RA-2026-0142`. Es el identificador que atraviesa el ticket, las
    observaciones de la nota crédito, la referencia del asiento contable y el
    log — un agente que lo vea en cualquier superficie recupera todo lo demás."""
    anio = datetime.now().year
    row = con.execute(
        "SELECT codigo FROM anulaciones WHERE codigo LIKE ? ORDER BY id DESC LIMIT 1",
        (f"RA-{anio}-%",),
    ).fetchone()
    consecutivo = 1
    if row:
        try:
            consecutivo = int(str(row["codigo"]).rsplit("-", 1)[-1]) + 1
        except (ValueError, IndexError):
            consecutivo = 1
    return f"RA-{anio}-{consecutivo:04d}"


def referencia_meli(pack_id: str) -> str:
    return f"meli:pack:{str(pack_id or '').strip()}"


def referencia_web(ref: str) -> str:
    return f"web:{str(ref or '').strip()}"


# ── Escritura ─────────────────────────────────────────────────────────────────

_CAMPOS_ACTUALIZABLES = {
    "origen", "order_id", "pack_id", "claim_id",
    "cliente_nombre", "cliente_doc",
    "factura_proveedor", "factura_id", "factura_numero", "factura_cufe",
    "factura_fecha", "factura_total",
    "motivo", "monto_reintegrado", "alcance", "producto_retorna", "financia",
    "autonomia", "bloqueo_motivo",
    "nc_proveedor", "nc_id", "nc_numero", "nc_cufe", "nc_total", "nc_url",
    "movimiento_id", "inventario_estado", "ticket_id", "relato",
}


def abrir_expediente(
    *,
    referencia: str,
    origen: str,
    resumen: str = "",
    actor: str = "sistema",
    **campos: Any,
) -> dict:
    """Abre el expediente o devuelve el existente (idempotente por `referencia`).

    Reabrir no pisa lo que ya se sabe: solo rellena campos vacíos. Un segundo
    webhook del mismo reclamo no puede borrar el número de factura que la
    corrida anterior ya resolvió.
    """
    init_db()
    referencia = str(referencia or "").strip()
    if not referencia:
        raise ValueError("referencia requerida")
    if origen not in ORIGENES:
        raise ValueError(f"origen inválido: {origen!r} (esperado uno de {ORIGENES})")

    desconocidos = set(campos) - _CAMPOS_ACTUALIZABLES
    if desconocidos:
        raise ValueError(f"campos desconocidos: {sorted(desconocidos)}")

    with _conn() as con:
        row = con.execute(
            "SELECT * FROM anulaciones WHERE referencia=?", (referencia,)
        ).fetchone()
        if row:
            existente = dict(row)
            faltantes = {
                k: v for k, v in campos.items()
                if v not in (None, "", 0) and not existente.get(k)
            }
            if faltantes:
                sets = ", ".join(f"{k}=?" for k in faltantes)
                con.execute(
                    f"UPDATE anulaciones SET {sets}, actualizado_en=? WHERE id=?",
                    (*faltantes.values(), _ahora(), existente["id"]),
                )
            nuevo = False
            caso_id = int(existente["id"])
            codigo = existente["codigo"]
        else:
            codigo = _siguiente_codigo(con)
            cols = ["codigo", "referencia", "origen", "abierta_en", "actualizado_en"]
            vals: list[Any] = [codigo, referencia, origen, _ahora(), _ahora()]
            for k, v in campos.items():
                if v is not None:
                    cols.append(k)
                    vals.append(v)
            con.execute(
                f"INSERT INTO anulaciones ({', '.join(cols)}) "
                f"VALUES ({', '.join('?' for _ in cols)})",
                vals,
            )
            caso_id = int(con.execute("SELECT last_insert_rowid() AS i").fetchone()["i"])
            nuevo = True

    if nuevo:
        registrar_evento(
            caso_id,
            tipo="detectado",
            resumen=resumen or f"Expediente abierto desde {origen}.",
            actor=actor,
            datos=campos,
        )
    return obtener(caso_id)


def actualizar(caso_id: int, *, actor: str = "sistema", resumen: str = "", **campos: Any) -> dict:
    """Actualiza campos duros del expediente y deja constancia como evento
    `enriquecido`. No cambia el estado — para eso está `transicionar()`."""
    init_db()
    desconocidos = set(campos) - _CAMPOS_ACTUALIZABLES
    if desconocidos:
        raise ValueError(f"campos desconocidos: {sorted(desconocidos)}")
    if not campos:
        return obtener(caso_id)
    with _conn() as con:
        sets = ", ".join(f"{k}=?" for k in campos)
        con.execute(
            f"UPDATE anulaciones SET {sets}, actualizado_en=? WHERE id=?",
            (*campos.values(), _ahora(), int(caso_id)),
        )
    if resumen:
        registrar_evento(caso_id, tipo="enriquecido", resumen=resumen, actor=actor, datos=campos)
    return obtener(caso_id)


def transicionar(
    caso_id: int,
    nuevo_estado: str,
    *,
    resumen: str,
    actor: str = "sistema",
    tipo_evento: str = "decidido",
    datos: dict | None = None,
    **campos: Any,
) -> dict:
    """Cambia el estado validando la máquina de estados y registra el evento.

    Una transición no permitida lanza ValueError en vez de escribir: un
    expediente en un estado imposible es peor que un error visible.
    """
    init_db()
    if nuevo_estado not in ESTADOS:
        raise ValueError(f"estado inválido: {nuevo_estado!r}")
    caso = obtener(caso_id)
    if not caso:
        raise ValueError(f"expediente {caso_id} no existe")
    actual = caso["estado"]
    if nuevo_estado != actual and nuevo_estado not in _TRANSICIONES.get(actual, set()):
        raise ValueError(
            f"transición no permitida: {actual} → {nuevo_estado} "
            f"(permitidas desde {actual}: {sorted(_TRANSICIONES.get(actual, set()))})"
        )
    if campos:
        desconocidos = set(campos) - _CAMPOS_ACTUALIZABLES
        if desconocidos:
            raise ValueError(f"campos desconocidos: {sorted(desconocidos)}")

    cerrada_en = _ahora() if nuevo_estado == "cerrada" else caso.get("cerrada_en")
    with _conn() as con:
        sets = "".join(f"{k}=?, " for k in campos)
        con.execute(
            f"UPDATE anulaciones SET {sets}estado=?, cerrada_en=?, actualizado_en=? WHERE id=?",
            (*campos.values(), nuevo_estado, cerrada_en, _ahora(), int(caso_id)),
        )
    registrar_evento(
        caso_id,
        tipo=tipo_evento,
        resumen=resumen,
        actor=actor,
        datos={**(datos or {}), "estado_anterior": actual, "estado_nuevo": nuevo_estado},
    )
    return obtener(caso_id)


def registrar_evento(
    caso_id: int,
    *,
    tipo: str,
    resumen: str,
    actor: str = "sistema",
    datos: dict | None = None,
    dedupe: bool = False,
) -> None:
    """Agrega un evento a la línea de tiempo. APPEND-ONLY.

    `dedupe=True` calcula un hash de (tipo, resumen) y evita repetir el mismo
    evento — útil para reintentos del mismo fallo, que si no llenan el
    expediente de ruido idéntico.
    """
    init_db()
    if tipo not in TIPOS_EVENTO:
        raise ValueError(f"tipo de evento inválido: {tipo!r} (esperado uno de {TIPOS_EVENTO})")
    resumen = (resumen or "").strip()
    if not resumen:
        raise ValueError("resumen requerido: un evento sin frase legible no sirve de precedente")

    h = ""
    if dedupe:
        h = hashlib.sha1(f"{tipo}|{resumen}".encode("utf-8")).hexdigest()[:16]

    try:
        datos_txt = json.dumps(datos or {}, ensure_ascii=False, default=str)[:20000]
    except (TypeError, ValueError):
        datos_txt = ""

    with _conn() as con:
        try:
            con.execute(
                """INSERT INTO anulacion_eventos
                     (anulacion_id, ts, actor, tipo, resumen, datos_json, hash)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (int(caso_id), _ahora(), actor, tipo, resumen, datos_txt, h),
            )
        except sqlite3.IntegrityError:
            # Choque con idx_anul_eventos_hash: el mismo evento ya está.
            return
        con.execute(
            "UPDATE anulaciones SET actualizado_en=? WHERE id=?", (_ahora(), int(caso_id))
        )


def agregar_nota(caso_id: int, texto: str, *, actor: str) -> dict:
    """Nota libre de un humano o de un agente que resolvió el caso.

    Es lo que cierra el ciclo de la recursividad: la conclusión de quien
    atendió el ticket vuelve al expediente, y el siguiente agente la hereda en
    vez de repetir el análisis.
    """
    texto = (texto or "").strip()
    if not texto:
        raise ValueError("La nota no puede estar vacía.")
    registrar_evento(caso_id, tipo="nota", resumen=texto[:2000], actor=actor)
    return obtener(caso_id)


# ── Lectura ───────────────────────────────────────────────────────────────────


def obtener(caso_id: int) -> dict | None:
    init_db()
    with _conn() as con:
        row = con.execute("SELECT * FROM anulaciones WHERE id=?", (int(caso_id),)).fetchone()
    return dict(row) if row else None


def obtener_por_referencia(referencia: str) -> dict | None:
    init_db()
    with _conn() as con:
        row = con.execute(
            "SELECT * FROM anulaciones WHERE referencia=?", (str(referencia or "").strip(),)
        ).fetchone()
    return dict(row) if row else None


def obtener_por_codigo(codigo: str) -> dict | None:
    init_db()
    with _conn() as con:
        row = con.execute(
            "SELECT * FROM anulaciones WHERE codigo=?", (str(codigo or "").strip().upper(),)
        ).fetchone()
    return dict(row) if row else None


def resolver(identificador: str) -> dict | None:
    """Acepta código (`RA-2026-0142`), referencia (`meli:pack:200…`), pack id
    suelto o número de factura. Es la puerta que usan los agentes: reciben el
    identificador que traiga el ticket, sin saber de qué tipo es."""
    init_db()
    ident = str(identificador or "").strip()
    if not ident:
        return None
    for fn in (obtener_por_codigo, obtener_por_referencia):
        caso = fn(ident)
        if caso:
            return caso
    with _conn() as con:
        row = con.execute(
            """SELECT * FROM anulaciones
               WHERE pack_id=? OR order_id=? OR factura_numero=? OR nc_numero=?
               ORDER BY id DESC LIMIT 1""",
            (ident, ident, ident, ident),
        ).fetchone()
    return dict(row) if row else None


def eventos(caso_id: int, *, limite: int = 200) -> list[dict]:
    init_db()
    with _conn() as con:
        rows = con.execute(
            "SELECT * FROM anulacion_eventos WHERE anulacion_id=? ORDER BY id ASC LIMIT ?",
            (int(caso_id), int(limite)),
        ).fetchall()
    return [dict(r) for r in rows]


def listar(
    *,
    estados: tuple[str, ...] | list[str] | None = None,
    abiertos: bool = False,
    origen: str | None = None,
    limite: int = 200,
) -> list[dict]:
    init_db()
    cond: list[str] = []
    args: list[Any] = []
    if abiertos:
        estados = ESTADOS_ABIERTOS
    if estados:
        cond.append(f"estado IN ({', '.join('?' for _ in estados)})")
        args.extend(estados)
    if origen:
        cond.append("origen=?")
        args.append(origen)
    where = f"WHERE {' AND '.join(cond)}" if cond else ""
    with _conn() as con:
        rows = con.execute(
            f"SELECT * FROM anulaciones {where} ORDER BY abierta_en DESC LIMIT ?",
            (*args, int(limite)),
        ).fetchall()
    return [dict(r) for r in rows]


def deuda_abierta() -> dict:
    """Resumen para el reporte diario: cuántas anulaciones siguen abiertas, por
    cuánto, y desde hace cuánto la más antigua.

    Esta función existe para que el reporte informe DEUDA y no ACTIVIDAD. El
    cron viejo solo avisaba cuando emitía o cuando fallaba al emitir, así que
    un caso que nunca llegaba a intentarse producía la misma salida que un día
    sin devoluciones — el mecanismo exacto que dejó acumular 44 casos y
    $2,1 M entre el 26-jun y el 10-ago de 2026.
    """
    init_db()
    with _conn() as con:
        rows = con.execute(
            f"""SELECT estado, COUNT(*) AS n, COALESCE(SUM(factura_total),0) AS monto,
                       MIN(abierta_en) AS mas_antigua
                FROM anulaciones
                WHERE estado IN ({', '.join('?' for _ in ESTADOS_ABIERTOS)})
                GROUP BY estado""",
            ESTADOS_ABIERTOS,
        ).fetchall()
    por_estado = {r["estado"]: {"n": r["n"], "monto": r["monto"]} for r in rows}
    total = sum(v["n"] for v in por_estado.values())
    monto = sum(v["monto"] for v in por_estado.values())
    fechas = [r["mas_antigua"] for r in rows if r["mas_antigua"]]
    mas_antigua = min(fechas) if fechas else None
    dias = None
    if mas_antigua:
        try:
            dias = (datetime.now() - datetime.fromisoformat(mas_antigua)).days
        except ValueError:
            dias = None
    return {
        "abiertas": total,
        "monto": round(monto, 2),
        "mas_antigua": mas_antigua,
        "dias_mas_antigua": dias,
        "por_estado": por_estado,
    }


def buscar(texto: str, *, limite: int = 10) -> list[dict]:
    """Búsqueda de precedentes por palabras sueltas sobre relato/motivo/ids.

    Deliberadamente sin dependencia del índice vectorial: un agente tiene que
    poder consultar precedentes aunque `memoria_vectorial` no esté disponible.
    El ranking es simple (cuántos términos aparecen), suficiente para "¿cómo
    resolvimos las devoluciones de colágeno?".
    """
    init_db()
    terminos = [t for t in str(texto or "").lower().split() if len(t) > 2][:8]
    if not terminos:
        return []
    campos = "LOWER(relato || ' ' || motivo || ' ' || origen || ' ' || codigo || ' ' || pack_id || ' ' || factura_numero)"
    puntaje = " + ".join(f"(CASE WHEN {campos} LIKE ? THEN 1 ELSE 0 END)" for _ in terminos)
    args = [f"%{t}%" for t in terminos]
    # El alias de una columna calculada no se puede usar en WHERE en SQLite —
    # de ahí la subconsulta en vez de `WHERE _score > 0`.
    with _conn() as con:
        rows = con.execute(
            f"""SELECT * FROM (
                    SELECT *, ({puntaje}) AS _score FROM anulaciones
                ) WHERE _score > 0
                ORDER BY _score DESC, abierta_en DESC LIMIT ?""",
            (*args, int(limite)),
        ).fetchall()
    return [dict(r) for r in rows]


def expediente_completo(caso_id: int) -> dict:
    """El caso entero en un solo bloque: campos duros + relato + línea de
    tiempo + enlaces. Es lo que recibe un agente cuando pide un expediente —
    una llamada, todo el contexto."""
    caso = obtener(caso_id)
    if not caso:
        return {}
    caso = dict(caso)
    caso["eventos"] = eventos(caso_id)
    caso["enlaces"] = _enlaces(caso)
    return caso


def _enlaces(caso: dict) -> dict:
    enlaces: dict[str, str] = {}
    fid = caso.get("factura_id") or ""
    if fid:
        enlaces["factura"] = (
            f"https://app.alegra.com/invoice/view/id/{fid}"
            if caso.get("factura_proveedor") == "alegra"
            else f"https://siigonube.siigo.com/#/invoice/843/{fid}"
        )
    if caso.get("nc_url"):
        enlaces["nota_credito"] = caso["nc_url"]
    if caso.get("pack_id"):
        enlaces["orden_meli"] = f"https://www.mercadolibre.com.co/ventas/{caso['pack_id']}/detalle"
    if caso.get("claim_id"):
        enlaces["reclamo_meli"] = f"https://www.mercadolibre.com.co/claims/{caso['claim_id']}"
    return enlaces
