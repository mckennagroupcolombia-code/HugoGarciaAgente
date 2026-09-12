"""Pagos de mensajería (Interrapidísimo y otras transportadoras).

Reemplaza el Excel "ENVIOS INTERRA" que llevaba aparte el área de despachos
(TKT-2026-1219): una fila por día con la cantidad de envíos, el enlace a la
factura/guías del transportador y el valor; los días se agrupan en un **lote de
pago** que se solicita, se aprueba y se paga con su comprobante adjunto.

Estructura (contabilidad.db, junto a servicios/nómina):

    mensajeria_envios   un día de despachos (unique transportadora+fecha)
    mensajeria_lotes    el pago que cubre N días (solicitado → pagado)

Un lote pagado entra al libro (`contabilidad_ledger._egresos_mensajeria`,
fuente "mensajeria_pago") y de ahí al Libro Mayor vía autopost — igual que los
servicios públicos, sin doble digitación.
"""
from __future__ import annotations

import os
import re
from datetime import datetime
from typing import Any

from app.services.contabilidad_db import _conn, _ensure

TRANSPORTADORA_DEFAULT = "Interrapidísimo"
ESTADOS_LOTE = ("solicitado", "pagado")

# Comprobante del pago (transferencia): misma convención que contabilidad —
# carpeta de repo en .gitignore, no en git.
_COMPROBANTES_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "comprobantes", "mensajeria"
)


def ensure_mensajeria_tables() -> None:
    _ensure()
    with _conn() as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS mensajeria_lotes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                transportadora TEXT NOT NULL DEFAULT 'Interrapidísimo',
                estado TEXT NOT NULL DEFAULT 'solicitado',
                total REAL NOT NULL DEFAULT 0,
                fecha_solicitud TEXT NOT NULL DEFAULT (date('now')),
                fecha_pago TEXT,
                banco TEXT NOT NULL DEFAULT '',
                referencia TEXT NOT NULL DEFAULT '',
                notas TEXT NOT NULL DEFAULT '',
                ticket_id INTEGER,
                soporte_path TEXT NOT NULL DEFAULT '',
                soporte_nombre TEXT NOT NULL DEFAULT '',
                soporte_mime TEXT NOT NULL DEFAULT '',
                created_by INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS mensajeria_envios (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                transportadora TEXT NOT NULL DEFAULT 'Interrapidísimo',
                fecha TEXT NOT NULL,
                cantidad INTEGER NOT NULL DEFAULT 0,
                enlace TEXT NOT NULL DEFAULT '',
                valor REAL NOT NULL DEFAULT 0,
                nota TEXT NOT NULL DEFAULT '',
                lote_id INTEGER REFERENCES mensajeria_lotes(id) ON DELETE SET NULL,
                created_by INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_mensajeria_envios_dia
                ON mensajeria_envios(transportadora, fecha);
            CREATE INDEX IF NOT EXISTS idx_mensajeria_envios_lote
                ON mensajeria_envios(lote_id);
            """
        )


# ─── Helpers ────────────────────────────────────────────────────────────────

_MESES = {
    "ene": "01", "feb": "02", "mar": "03", "abr": "04", "may": "05", "jun": "06",
    "jul": "07", "ago": "08", "sep": "09", "set": "09", "oct": "10", "nov": "11",
    "dic": "12",
}


def normalizar_fecha(valor: Any, anio_ref: int | None = None) -> str:
    """'18/08/2026', '2026-08-18', '19-ago' → 'YYYY-MM-DD' ('' si no se puede)."""
    s = str(valor or "").strip()
    if not s:
        return ""
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$", s)
    if m:
        d, mes, a = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if a < 100:
            a += 2000
        try:
            return datetime(a, mes, d).strftime("%Y-%m-%d")
        except ValueError:
            return ""
    # "19-ago" / "01-sep" (sin año: usa el de referencia)
    m = re.match(r"^(\d{1,2})[-\s]([a-záéíóú]{3,})\.?$", s.lower())
    if m:
        mes = _MESES.get(m.group(2)[:3])
        if mes:
            a = anio_ref or datetime.now().year
            try:
                return datetime(a, int(mes), int(m.group(1))).strftime("%Y-%m-%d")
            except ValueError:
                return ""
    return ""


def _monto(valor: Any) -> float:
    """'$ 50.700' / '50700' / '50.700,50' → float."""
    s = re.sub(r"[^\d,.\-]", "", str(valor or ""))
    if not s:
        return 0.0
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        # Coma decimal solo si deja 1-2 decimales; si no, es separador de miles.
        s = s.replace(",", "." if len(s.split(",")[-1]) <= 2 else "")
    elif s.count(".") >= 1 and len(s.split(".")[-1]) == 3:
        s = s.replace(".", "")
    try:
        return round(float(s), 2)
    except ValueError:
        return 0.0


def _hoy() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def _fila_envio(row: Any) -> dict[str, Any]:
    d = dict(row)
    d["valor"] = round(float(d.get("valor") or 0), 2)
    d["cantidad"] = int(d.get("cantidad") or 0)
    return d


# ─── Envíos (días) ──────────────────────────────────────────────────────────

def listar_envios(
    desde: str = "",
    hasta: str = "",
    *,
    transportadora: str = "",
    solo_pendientes: bool = False,
) -> list[dict[str, Any]]:
    ensure_mensajeria_tables()
    where, params = ["1=1"], []
    if desde:
        where.append("e.fecha >= ?")
        params.append(normalizar_fecha(desde) or desde)
    if hasta:
        where.append("e.fecha <= ?")
        params.append(normalizar_fecha(hasta) or hasta)
    if transportadora:
        where.append("e.transportadora = ?")
        params.append(transportadora)
    if solo_pendientes:
        where.append("e.lote_id IS NULL AND e.valor > 0")
    with _conn() as con:
        rows = con.execute(
            f"""SELECT e.*, l.estado AS lote_estado, l.fecha_pago AS fecha_pago
                  FROM mensajeria_envios e
                  LEFT JOIN mensajeria_lotes l ON l.id = e.lote_id
                 WHERE {' AND '.join(where)}
                 ORDER BY e.fecha DESC, e.id DESC""",
            params,
        ).fetchall()
    out = []
    for r in rows:
        d = _fila_envio(r)
        d["estado"] = (
            "pagado" if d.get("lote_estado") == "pagado"
            else "en_aprobacion" if d.get("lote_id")
            else "pendiente"
        )
        out.append(d)
    return out


def obtener_envio(envio_id: int) -> dict[str, Any] | None:
    ensure_mensajeria_tables()
    with _conn() as con:
        row = con.execute(
            "SELECT * FROM mensajeria_envios WHERE id = ?", (int(envio_id),)
        ).fetchone()
    return _fila_envio(row) if row else None


def guardar_envio(data: dict[str, Any], *, created_by: int | None = None) -> dict[str, Any]:
    """Crea o actualiza el registro de un día. Un día (transportadora+fecha) es
    único: volver a guardarlo lo actualiza en vez de duplicarlo."""
    ensure_mensajeria_tables()
    fecha = normalizar_fecha(data.get("fecha"))
    if not fecha:
        raise ValueError("Fecha inválida (usa YYYY-MM-DD o DD/MM/AAAA)")
    transportadora = str(data.get("transportadora") or TRANSPORTADORA_DEFAULT).strip()
    cantidad = int(data.get("cantidad") or 0)
    valor = _monto(data.get("valor"))
    if cantidad < 0 or valor < 0:
        raise ValueError("Cantidad y valor no pueden ser negativos")
    enlace = str(data.get("enlace") or "").strip()[:500]
    nota = str(data.get("nota") or "").strip()[:300]

    envio_id = data.get("id")
    with _conn() as con:
        existente = con.execute(
            "SELECT * FROM mensajeria_envios WHERE transportadora = ? AND fecha = ?",
            (transportadora, fecha),
        ).fetchone()
        if existente and (not envio_id or int(envio_id) != int(existente["id"])):
            envio_id = int(existente["id"])
        if envio_id:
            actual = con.execute(
                "SELECT * FROM mensajeria_envios WHERE id = ?", (int(envio_id),)
            ).fetchone()
            if not actual:
                raise ValueError("Registro no encontrado")
            if actual["lote_id"]:
                raise ValueError(
                    "Ese día ya está en un lote de pago; quita el lote antes de editarlo"
                )
            con.execute(
                """UPDATE mensajeria_envios
                      SET transportadora = ?, fecha = ?, cantidad = ?, enlace = ?,
                          valor = ?, nota = ?, updated_at = datetime('now')
                    WHERE id = ?""",
                (transportadora, fecha, cantidad, enlace, valor, nota, int(envio_id)),
            )
            row_id = int(envio_id)
        else:
            cur = con.execute(
                """INSERT INTO mensajeria_envios
                       (transportadora, fecha, cantidad, enlace, valor, nota, created_by)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (transportadora, fecha, cantidad, enlace, valor, nota, created_by),
            )
            row_id = int(cur.lastrowid)
        row = con.execute("SELECT * FROM mensajeria_envios WHERE id = ?", (row_id,)).fetchone()
    return _fila_envio(row)


def eliminar_envio(envio_id: int) -> bool:
    ensure_mensajeria_tables()
    with _conn() as con:
        actual = con.execute(
            "SELECT lote_id FROM mensajeria_envios WHERE id = ?", (int(envio_id),)
        ).fetchone()
        if not actual:
            return False
        if actual["lote_id"]:
            raise ValueError("Ese día ya está en un lote de pago; quita el lote primero")
        con.execute("DELETE FROM mensajeria_envios WHERE id = ?", (int(envio_id),))
    return True


# ─── Importar desde el Excel (pegar filas) ──────────────────────────────────

_RE_URL = re.compile(r"https?://\S+")


def parsear_pegado(texto: str, *, anio_ref: int | None = None) -> dict[str, Any]:
    """Interpreta filas copiadas del Excel "ENVIOS INTERRA".

    Columnas esperadas (en cualquier orden dentro de la fila, separadas por
    tabulador o 2+ espacios): FECHA · CANT ENVIOS · FACTURA GUIAS · VALOR TOTAL
    · ESTADO · FECHA DE PAGO. Devuelve filas normalizadas + líneas ignoradas.
    """
    filas: list[dict[str, Any]] = []
    ignoradas: list[str] = []
    for linea in (texto or "").splitlines():
        if not linea.strip():
            continue
        celdas = [c.strip() for c in re.split(r"\t|\s{2,}|\s*\|\s*", linea) if c.strip()]
        if not celdas:
            continue
        fecha = normalizar_fecha(celdas[0], anio_ref)
        if not fecha:
            ignoradas.append(linea.strip()[:120])
            continue
        anio_ref = int(fecha[:4])
        resto = celdas[1:]

        enlace = ""
        for c in list(resto):
            m = _RE_URL.search(c)
            if m:
                enlace = m.group(0)
                resto.remove(c)
                break

        estado_txt = ""
        fecha_pago = ""
        for c in list(resto):
            up = c.upper()
            if "CANCELADO" in up or "PAGADO" in up:
                estado_txt = "pagado"
                resto.remove(c)
            elif "PTE" in up or "PENDIENTE" in up:
                estado_txt = "pendiente"
                resto.remove(c)

        valor = 0.0
        for c in list(resto):
            if "$" in c or re.fullmatch(r"[\d.,]{4,}", c):
                valor = _monto(c)
                resto.remove(c)
                break

        cantidad = 0
        nota = ""
        for c in list(resto):
            if re.fullmatch(r"\d{1,3}", c):
                cantidad = int(c)
                resto.remove(c)
                break
        for c in list(resto):
            f = normalizar_fecha(c, anio_ref)
            if f and not fecha_pago:
                fecha_pago = f
                resto.remove(c)
        if resto:
            nota = " ".join(resto)[:300]

        filas.append({
            "fecha": fecha,
            "cantidad": cantidad,
            "enlace": enlace,
            "valor": valor,
            "nota": nota,
            "estado": estado_txt or ("pagado" if fecha_pago else "pendiente"),
            "fecha_pago": fecha_pago,
        })
    filas.sort(key=lambda f: f["fecha"])
    return {
        "filas": filas,
        "ignoradas": ignoradas,
        "total": round(sum(f["valor"] for f in filas), 2),
        "pendiente": round(
            sum(f["valor"] for f in filas if f["estado"] != "pagado"), 2
        ),
    }


def importar_pegado(
    texto: str,
    *,
    transportadora: str = TRANSPORTADORA_DEFAULT,
    created_by: int | None = None,
) -> dict[str, Any]:
    """Carga las filas del Excel. Las que venían CANCELADAS con fecha de pago se
    agrupan en un lote ya pagado por fecha de pago, para conservar el histórico."""
    parsed = parsear_pegado(texto)
    creados = actualizados = 0
    por_fecha_pago: dict[str, list[int]] = {}
    for f in parsed["filas"]:
        antes = obtener_envio_por_dia(transportadora, f["fecha"])
        envio = guardar_envio(
            {
                "fecha": f["fecha"],
                "transportadora": transportadora,
                "cantidad": f["cantidad"],
                "enlace": f["enlace"],
                "valor": f["valor"],
                "nota": f["nota"],
            },
            created_by=created_by,
        )
        if antes:
            actualizados += 1
        else:
            creados += 1
        if f["estado"] == "pagado" and f["valor"] > 0 and not envio.get("lote_id"):
            por_fecha_pago.setdefault(f["fecha_pago"] or f["fecha"], []).append(envio["id"])

    lotes = []
    for fecha_pago, ids in sorted(por_fecha_pago.items()):
        lote = crear_lote(
            ids,
            transportadora=transportadora,
            notas="Importado del Excel de envíos",
            created_by=created_by,
        )
        lote = marcar_lote_pagado(
            lote["id"], fecha_pago=fecha_pago, notas="Importado del Excel de envíos"
        )
        lotes.append(lote)

    return {
        "ok": True,
        "creados": creados,
        "actualizados": actualizados,
        "ignoradas": parsed["ignoradas"],
        "lotes_pagados": len(lotes),
    }


def obtener_envio_por_dia(transportadora: str, fecha: str) -> dict[str, Any] | None:
    ensure_mensajeria_tables()
    with _conn() as con:
        row = con.execute(
            "SELECT * FROM mensajeria_envios WHERE transportadora = ? AND fecha = ?",
            (transportadora, normalizar_fecha(fecha) or fecha),
        ).fetchone()
    return _fila_envio(row) if row else None


# ─── Lotes de pago ──────────────────────────────────────────────────────────

def _lote_dict(row: Any, con: Any) -> dict[str, Any]:
    d = dict(row)
    d["total"] = round(float(d.get("total") or 0), 2)
    dias = con.execute(
        "SELECT * FROM mensajeria_envios WHERE lote_id = ? ORDER BY fecha",
        (int(d["id"]),),
    ).fetchall()
    d["dias"] = [_fila_envio(x) for x in dias]
    d["rango"] = (
        f"{d['dias'][0]['fecha']} → {d['dias'][-1]['fecha']}" if d["dias"] else ""
    )
    return d


def listar_lotes(estado: str = "", limite: int = 60) -> list[dict[str, Any]]:
    ensure_mensajeria_tables()
    with _conn() as con:
        if estado:
            rows = con.execute(
                "SELECT * FROM mensajeria_lotes WHERE estado = ? ORDER BY id DESC LIMIT ?",
                (estado, int(limite)),
            ).fetchall()
        else:
            rows = con.execute(
                "SELECT * FROM mensajeria_lotes ORDER BY id DESC LIMIT ?", (int(limite),)
            ).fetchall()
        return [_lote_dict(r, con) for r in rows]


def obtener_lote(lote_id: int) -> dict[str, Any] | None:
    ensure_mensajeria_tables()
    with _conn() as con:
        row = con.execute(
            "SELECT * FROM mensajeria_lotes WHERE id = ?", (int(lote_id),)
        ).fetchone()
        return _lote_dict(row, con) if row else None


def crear_lote(
    envio_ids: list[int],
    *,
    transportadora: str = TRANSPORTADORA_DEFAULT,
    notas: str = "",
    created_by: int | None = None,
) -> dict[str, Any]:
    """Agrupa días pendientes en una solicitud de pago."""
    ensure_mensajeria_tables()
    ids = [int(i) for i in (envio_ids or [])]
    if not ids:
        raise ValueError("Selecciona al menos un día para pagar")
    with _conn() as con:
        marcas = ",".join("?" * len(ids))
        rows = con.execute(
            f"SELECT * FROM mensajeria_envios WHERE id IN ({marcas})", ids
        ).fetchall()
        if len(rows) != len(ids):
            raise ValueError("Algún día seleccionado ya no existe")
        for r in rows:
            if r["lote_id"]:
                raise ValueError(f"El día {r['fecha']} ya está en otro lote de pago")
        total = round(sum(float(r["valor"] or 0) for r in rows), 2)
        if total <= 0:
            raise ValueError("El total del lote debe ser mayor a cero")
        cur = con.execute(
            """INSERT INTO mensajeria_lotes
                   (transportadora, estado, total, fecha_solicitud, notas, created_by)
               VALUES (?, 'solicitado', ?, ?, ?, ?)""",
            (transportadora, total, _hoy(), str(notas or "").strip()[:500], created_by),
        )
        lote_id = int(cur.lastrowid)
        con.execute(
            f"""UPDATE mensajeria_envios
                   SET lote_id = ?, updated_at = datetime('now')
                 WHERE id IN ({marcas})""",
            [lote_id, *ids],
        )
        row = con.execute("SELECT * FROM mensajeria_lotes WHERE id = ?", (lote_id,)).fetchone()
        return _lote_dict(row, con)


def marcar_lote_pagado(
    lote_id: int,
    *,
    fecha_pago: str = "",
    banco: str = "",
    referencia: str = "",
    notas: str = "",
    monto: float | None = None,
) -> dict[str, Any]:
    ensure_mensajeria_tables()
    lote = obtener_lote(lote_id)
    if not lote:
        raise ValueError("Lote no encontrado")
    fecha = normalizar_fecha(fecha_pago) or _hoy()
    total = round(float(monto), 2) if monto not in (None, "") else lote["total"]
    if total <= 0:
        raise ValueError("El monto pagado debe ser mayor a cero")
    with _conn() as con:
        con.execute(
            """UPDATE mensajeria_lotes
                  SET estado = 'pagado', fecha_pago = ?, total = ?, banco = ?,
                      referencia = ?, notas = CASE WHEN ? = '' THEN notas ELSE ? END,
                      updated_at = datetime('now')
                WHERE id = ?""",
            (
                fecha,
                total,
                str(banco or "").strip()[:100],
                str(referencia or "").strip()[:100],
                str(notas or "").strip(),
                str(notas or "").strip()[:500],
                int(lote_id),
            ),
        )
    _invalidar_libro()
    return obtener_lote(lote_id)


def reabrir_lote(lote_id: int) -> dict[str, Any]:
    """Vuelve un lote pagado a 'solicitado' (corrección de un pago mal marcado)."""
    ensure_mensajeria_tables()
    if not obtener_lote(lote_id):
        raise ValueError("Lote no encontrado")
    with _conn() as con:
        con.execute(
            """UPDATE mensajeria_lotes
                  SET estado = 'solicitado', fecha_pago = NULL, updated_at = datetime('now')
                WHERE id = ?""",
            (int(lote_id),),
        )
    _invalidar_libro()
    return obtener_lote(lote_id)


def eliminar_lote(lote_id: int) -> bool:
    """Deshace el lote: los días vuelven a quedar pendientes de pago."""
    ensure_mensajeria_tables()
    lote = obtener_lote(lote_id)
    if not lote:
        return False
    if lote.get("soporte_path"):
        try:
            ruta = os.path.join(_COMPROBANTES_DIR, os.path.basename(lote["soporte_path"]))
            if os.path.isfile(ruta):
                os.remove(ruta)
        except OSError:
            pass
    with _conn() as con:
        con.execute(
            "UPDATE mensajeria_envios SET lote_id = NULL, updated_at = datetime('now') WHERE lote_id = ?",
            (int(lote_id),),
        )
        con.execute("DELETE FROM mensajeria_lotes WHERE id = ?", (int(lote_id),))
    _invalidar_libro()
    return True


def _invalidar_libro() -> None:
    try:
        from app.services.contabilidad_ledger import invalidar_cache_libro

        invalidar_cache_libro()
    except Exception:
        pass


# ─── Comprobante del pago ───────────────────────────────────────────────────

def guardar_comprobante(lote_id: int, contenido: bytes, nombre: str, mime: str) -> dict[str, Any]:
    lote = obtener_lote(lote_id)
    if not lote:
        raise ValueError("Lote no encontrado")
    if not contenido:
        raise ValueError("Archivo vacío")
    os.makedirs(_COMPROBANTES_DIR, exist_ok=True)
    ext = os.path.splitext(nombre or "")[1][:10] or ""
    archivo = f"lote{int(lote_id)}_{datetime.now().strftime('%Y%m%d%H%M%S')}{ext}"
    with open(os.path.join(_COMPROBANTES_DIR, archivo), "wb") as f:
        f.write(contenido)
    anterior = (lote.get("soporte_path") or "").strip()
    if anterior:
        try:
            ruta = os.path.join(_COMPROBANTES_DIR, os.path.basename(anterior))
            if os.path.isfile(ruta):
                os.remove(ruta)
        except OSError:
            pass
    with _conn() as con:
        con.execute(
            """UPDATE mensajeria_lotes
                  SET soporte_path = ?, soporte_nombre = ?, soporte_mime = ?,
                      updated_at = datetime('now')
                WHERE id = ?""",
            (archivo, (nombre or "")[:200], (mime or "")[:100], int(lote_id)),
        )
    return obtener_lote(lote_id)


def ruta_comprobante(lote_id: int) -> tuple[str, str, str] | None:
    lote = obtener_lote(lote_id)
    if not lote:
        return None
    archivo = (lote.get("soporte_path") or "").strip()
    if not archivo:
        return None
    ruta = os.path.join(_COMPROBANTES_DIR, os.path.basename(archivo))
    if not os.path.isfile(ruta):
        return None
    return (
        ruta,
        lote.get("soporte_mime") or "application/octet-stream",
        lote.get("soporte_nombre") or archivo,
    )


def eliminar_comprobante(lote_id: int) -> bool:
    lote = obtener_lote(lote_id)
    if not lote or not (lote.get("soporte_path") or "").strip():
        return False
    try:
        ruta = os.path.join(_COMPROBANTES_DIR, os.path.basename(lote["soporte_path"]))
        if os.path.isfile(ruta):
            os.remove(ruta)
    except OSError:
        pass
    with _conn() as con:
        con.execute(
            """UPDATE mensajeria_lotes
                  SET soporte_path = '', soporte_nombre = '', soporte_mime = '',
                      updated_at = datetime('now')
                WHERE id = ?""",
            (int(lote_id),),
        )
    return True


# ─── Solicitud de aprobación (ticket en el Centro de Mando) ─────────────────

def _formato_cop(valor: float) -> str:
    return "$ " + f"{int(round(valor)):,}".replace(",", ".")


def solicitar_aprobacion(lote_id: int, *, creado_por: int | None = None) -> dict[str, Any]:
    """Crea el ticket de aprobación del lote — el mismo trámite que antes se
    abría a mano ("APROBAR PAGO DE INTERRAPIDISIMO", TKT-2026-1219)."""
    lote = obtener_lote(lote_id)
    if not lote:
        raise ValueError("Lote no encontrado")
    if lote.get("ticket_id"):
        return {"ok": True, "ticket_id": lote["ticket_id"], "mensaje": "Ya tenía ticket de aprobación."}

    from app.services import tickets_db as _tdb

    _tdb.init_db()
    creador = creado_por or _usuario_aprobador_id()
    if not creador:
        raise ValueError("No hay usuario activo para crear el ticket")

    detalle = "\n".join(
        f"- {d['fecha']} · {d['cantidad']} envío(s) · {_formato_cop(d['valor'])}"
        + (f" · {d['enlace']}" if d.get("enlace") else "")
        for d in lote["dias"]
    )
    descripcion = (
        f"Aprobar pago a **{lote['transportadora']}** por {_formato_cop(lote['total'])}.\n\n"
        f"Días incluidos ({len(lote['dias'])}):\n{detalle}\n\n"
        "Al pagar, registrar la transferencia en /app → Operativos → Mensajería "
        f"(lote #{lote['id']}) y adjuntar el comprobante."
    )
    data = {
        "tipo": "solicitud",
        "titulo": f"Aprobar pago {lote['transportadora']} — {_formato_cop(lote['total'])}",
        "categoria": "logistica",
        "descripcion": descripcion,
        "prioridad": "media",
        "asignado_a": _usuario_aprobador_id(),
    }
    ticket, err = _tdb.crear_ticket(data, creador, None)
    if err:
        raise ValueError(f"No se pudo crear el ticket: {err}")
    with _conn() as con:
        con.execute(
            "UPDATE mensajeria_lotes SET ticket_id = ?, updated_at = datetime('now') WHERE id = ?",
            (int(ticket.get("id")), int(lote_id)),
        )
    return {
        "ok": True,
        "ticket_id": ticket.get("id"),
        "numero": ticket.get("numero"),
        "lote": obtener_lote(lote_id),
    }


def _usuario_aprobador_id() -> int | None:
    """A quién se le asigna la aprobación del pago.

    `MENSAJERIA_APROBADOR` (username del panel) manda; por defecto quien viene
    aprobando estos pagos en la práctica (ver TKT-2026-1219) y, si esa cuenta no
    existe o está inactiva, la cuenta admin genérica.
    """
    candidatos = [
        os.getenv("MENSAJERIA_APROBADOR", "").strip().lower(),
        "armando",
        "admin",
    ]
    try:
        from app.services import tickets_db as _tdb
        import sqlite3

        db = sqlite3.connect(_tdb.DB_PATH)
        db.row_factory = sqlite3.Row
        try:
            for username in [c for c in candidatos if c]:
                row = db.execute(
                    "SELECT id FROM usuarios WHERE lower(username) = ? AND activo = 1",
                    (username,),
                ).fetchone()
                if row:
                    return int(row["id"])
            row = db.execute(
                "SELECT id FROM usuarios WHERE activo = 1 ORDER BY id ASC LIMIT 1"
            ).fetchone()
            return int(row["id"]) if row else None
        finally:
            db.close()
    except Exception:
        return None


# ─── Resumen y consumo contable ─────────────────────────────────────────────

def resumen() -> dict[str, Any]:
    ensure_mensajeria_tables()
    with _conn() as con:
        pend = con.execute(
            """SELECT COUNT(*) c, COALESCE(SUM(valor), 0) v
                 FROM mensajeria_envios WHERE lote_id IS NULL AND valor > 0"""
        ).fetchone()
        aprob = con.execute(
            """SELECT COUNT(*) c, COALESCE(SUM(total), 0) v
                 FROM mensajeria_lotes WHERE estado = 'solicitado'"""
        ).fetchone()
        mes = con.execute(
            """SELECT COALESCE(SUM(total), 0) v FROM mensajeria_lotes
                WHERE estado = 'pagado' AND substr(fecha_pago, 1, 7) = ?""",
            (datetime.now().strftime("%Y-%m"),),
        ).fetchone()
        ultimo = con.execute(
            """SELECT fecha_pago, total FROM mensajeria_lotes
                WHERE estado = 'pagado' ORDER BY fecha_pago DESC, id DESC LIMIT 1"""
        ).fetchone()
        envios_mes = con.execute(
            """SELECT COALESCE(SUM(cantidad), 0) c FROM mensajeria_envios
                WHERE substr(fecha, 1, 7) = ?""",
            (datetime.now().strftime("%Y-%m"),),
        ).fetchone()
    return {
        "dias_pendientes": int(pend["c"]),
        "pendiente_por_pagar": round(float(pend["v"]), 2),
        "lotes_en_aprobacion": int(aprob["c"]),
        "total_en_aprobacion": round(float(aprob["v"]), 2),
        "pagado_mes": round(float(mes["v"]), 2),
        "envios_mes": int(envios_mes["c"]),
        "ultimo_pago": (
            {"fecha": ultimo["fecha_pago"], "total": round(float(ultimo["total"]), 2)}
            if ultimo
            else None
        ),
    }


def pagos_en_rango(desde: str, hasta: str) -> list[dict[str, Any]]:
    """Lotes pagados en el rango — insumo de contabilidad_ledger."""
    ensure_mensajeria_tables()
    with _conn() as con:
        rows = con.execute(
            """SELECT * FROM mensajeria_lotes
                WHERE estado = 'pagado' AND fecha_pago >= ? AND fecha_pago <= ?
                ORDER BY fecha_pago""",
            (normalizar_fecha(desde) or desde, normalizar_fecha(hasta) or hasta),
        ).fetchall()
        return [_lote_dict(r, con) for r in rows]
