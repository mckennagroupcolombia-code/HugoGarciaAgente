"""
Base de clientes de WhatsApp de la empresa (app/data/clientes.db, fuera de git).

Se alimenta sin LLM desde tres fuentes: las herramientas del agente de ventas v2
(datos que el cliente da al bot), los chats que atiende el asesor (plantilla
«_nombre _cedula -Direccion _ciudad _Cel -correo» que el equipo pide tras el pago)
y las confirmaciones de pago (compras). Un dato existente nunca se pisa con uno
vacío; el más reciente gana y queda registrado de dónde salió.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
import time

_DB = os.getenv("CLIENTES_WA_DB", os.path.join(os.path.dirname(__file__), "..", "data", "clientes.db"))
_lock = threading.Lock()

CAMPOS = ("nombre", "documento", "tipo_documento", "correo", "telefono", "direccion", "ciudad", "departamento")
INTENCIONES = (
    "cotizacion", "pedido_listo", "cliente_pide_asesor", "conversacion_dificil", "consulta_tecnica",
    "producto_no_disponible", "seguimiento", "pago", "saludo", "otro",
)


def _conn() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(os.path.abspath(_DB)), exist_ok=True)
    c = sqlite3.connect(_DB, check_same_thread=False, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute(
        """CREATE TABLE IF NOT EXISTS clientes (
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
        )"""
    )
    cols = {r[1] for r in c.execute("PRAGMA table_info(clientes)").fetchall()}
    for col, tipo in (
        ("lid", "TEXT"), ("telefono", "TEXT"), ("departamento", "TEXT"), ("tipo_documento", "TEXT"),
        ("documento_valido", "INTEGER"), ("productos_interes", "TEXT"), ("ultimo_contacto", "REAL"),
        ("fuente", "TEXT"), ("fuentes", "TEXT"), ("actualizado", "REAL"),
    ):
        if col not in cols:
            c.execute(f"ALTER TABLE clientes ADD COLUMN {col} {tipo}")
    c.execute(
        """CREATE TABLE IF NOT EXISTS compras (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            cliente_id  INTEGER,
            order_id    TEXT,
            plataforma  TEXT,
            productos   TEXT,
            total       REAL,
            fecha       TEXT,
            FOREIGN KEY(cliente_id) REFERENCES clientes(id)
        )"""
    )
    c.execute(
        """CREATE TABLE IF NOT EXISTS interacciones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts REAL NOT NULL,
            numero_wa TEXT NOT NULL,
            canal TEXT NOT NULL,
            intencion TEXT,
            productos TEXT,
            handoff TEXT,
            atendido_por TEXT,
            detalle TEXT
        )"""
    )
    c.execute("CREATE INDEX IF NOT EXISTS ix_interacciones_num ON interacciones(numero_wa, ts)")
    return c


def _digitos(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def clave_wa(jid: str) -> str:
    """Número o LID sin sufijo: '573001234567@c.us' → '573001234567', 'web:abc' → 'web:abc'."""
    j = str(jid or "").strip()
    if j.startswith("web:"):
        return j
    return j.split("@")[0]


def _telefono_de_jid(jid: str) -> str:
    j = str(jid or "")
    if j.endswith("@c.us"):
        return _digitos(j)
    try:
        from app.services.wa_jid import telefono_desde_jid

        return _digitos(telefono_desde_jid(j) or "")
    except Exception:
        return ""


def clasificar_documento(documento: str) -> tuple[str, str, bool | None]:
    """(documento normalizado, tipo CC|NIT, DV válido o None si no aplica)."""
    d = str(documento or "").strip()
    dig = _digitos(d)
    if not dig:
        return "", "", None
    # NIT de empresa: 9 dígitos que empiezan por 8 o 9 (con o sin DV).
    if len(dig) in (9, 10) and dig[0] in "89":
        try:
            from app.services.empresa import digito_verificacion, nit_valido

            if "-" in d:
                return d, "NIT", nit_valido(d)
            base, dv = (dig[:9], dig[9]) if len(dig) == 10 else (dig, None)
            if dv is not None:
                return f"{base}-{dv}", "NIT", digito_verificacion(base) == int(dv)
            return base, "NIT", None
        except Exception:
            return dig, "NIT", None
    return dig, "CC", None


def upsert_cliente(jid: str, datos: dict, *, fuente: str) -> dict:
    """Crea o completa el cliente; no pisa con vacío. Devuelve los campos que cambiaron."""
    clave = clave_wa(jid)
    if not clave:
        return {}
    ahora = time.time()
    nuevos = {}
    for k in CAMPOS:
        v = str((datos or {}).get(k) or "").strip()
        if v:
            nuevos[k] = v[:200]
    doc_valido = None
    if nuevos.get("documento"):
        doc, tipo, doc_valido = clasificar_documento(nuevos["documento"])
        nuevos["documento"] = doc
        nuevos.setdefault("tipo_documento", tipo)
    tel = nuevos.get("telefono") or _telefono_de_jid(jid)
    if tel:
        nuevos["telefono"] = _digitos(tel)[:20]
    with _lock, _conn() as c:
        fila = c.execute("SELECT * FROM clientes WHERE numero_wa=?", (clave,)).fetchone()
        cambios = {}
        if fila is None:
            c.execute(
                "INSERT INTO clientes (numero_wa, lid, ultimo_contacto, fuente, fuentes, actualizado) VALUES (?, ?, ?, ?, ?, ?)",
                (clave, str(jid) if str(jid).endswith("@lid") else None, ahora, fuente, json.dumps([fuente]), ahora),
            )
            fila = c.execute("SELECT * FROM clientes WHERE numero_wa=?", (clave,)).fetchone()
        for k, v in nuevos.items():
            col = "nit" if k == "documento" else k
            if str(fila[col] or "").strip() != v:
                cambios[k] = v
        if cambios or doc_valido is not None:
            sets = [f"{'nit' if k == 'documento' else k}=?" for k in cambios]
            vals = list(cambios.values())
            if doc_valido is not None:
                sets.append("documento_valido=?")
                vals.append(1 if doc_valido else 0)
            fuentes = set(json.loads(fila["fuentes"] or "[]")) | {fuente}
            sets += ["ultimo_contacto=?", "fuente=?", "fuentes=?", "actualizado=?"]
            vals += [ahora, fuente, json.dumps(sorted(fuentes)), ahora]
            c.execute(f"UPDATE clientes SET {', '.join(sets)} WHERE id=?", (*vals, fila["id"]))
        else:
            c.execute("UPDATE clientes SET ultimo_contacto=? WHERE id=?", (ahora, fila["id"]))
    if doc_valido is False:
        cambios["aviso"] = "NIT con dígito de verificación inválido"
    return cambios


def registrar_interes(jid: str, refs: list[str], *, fuente: str) -> None:
    clave = clave_wa(jid)
    refs = [str(r).strip().upper() for r in refs or [] if str(r).strip()]
    if not clave or not refs:
        return
    with _lock, _conn() as c:
        fila = c.execute("SELECT id, productos_interes FROM clientes WHERE numero_wa=?", (clave,)).fetchone()
        if fila is None:
            c.execute(
                "INSERT INTO clientes (numero_wa, ultimo_contacto, fuente, fuentes, actualizado) VALUES (?, ?, ?, ?, ?)",
                (clave, time.time(), fuente, json.dumps([fuente]), time.time()),
            )
            fila = c.execute("SELECT id, productos_interes FROM clientes WHERE numero_wa=?", (clave,)).fetchone()
        actuales = json.loads(fila["productos_interes"] or "[]")
        for r in refs:
            if r in actuales:
                actuales.remove(r)
            actuales.insert(0, r)
        c.execute(
            "UPDATE clientes SET productos_interes=?, ultimo_contacto=?, actualizado=? WHERE id=?",
            (json.dumps(actuales[:30]), time.time(), time.time(), fila["id"]),
        )


def registrar_interaccion(
    jid: str, *, canal: str, intencion: str, productos: list[str] | None = None,
    handoff: str | None = None, atendido_por: str = "bot_v2", detalle: str = "",
) -> None:
    clave = clave_wa(jid)
    if not clave:
        return
    intencion = intencion if intencion in INTENCIONES else "otro"
    with _lock, _conn() as c:
        c.execute(
            "INSERT INTO interacciones (ts, numero_wa, canal, intencion, productos, handoff, atendido_por, detalle)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (time.time(), clave, canal, intencion, json.dumps(productos or []), handoff, atendido_por, (detalle or "")[:500]),
        )


def registrar_compra(jid: str, *, plataforma: str, total: float | None, order_id: str = "", productos: str = "") -> None:
    clave = clave_wa(jid)
    if not clave:
        return
    hoy = time.strftime("%Y-%m-%d")
    with _lock, _conn() as c:
        fila = c.execute("SELECT id, primera_compra FROM clientes WHERE numero_wa=?", (clave,)).fetchone()
        if fila is None:
            c.execute(
                "INSERT INTO clientes (numero_wa, ultimo_contacto, fuente, fuentes, actualizado) VALUES (?, ?, ?, ?, ?)",
                (clave, time.time(), plataforma, json.dumps([plataforma]), time.time()),
            )
            fila = c.execute("SELECT id, primera_compra FROM clientes WHERE numero_wa=?", (clave,)).fetchone()
        c.execute(
            "INSERT INTO compras (cliente_id, order_id, plataforma, productos, total, fecha) VALUES (?, ?, ?, ?, ?, ?)",
            (fila["id"], order_id or None, plataforma, productos or None, total, hoy),
        )
        c.execute(
            "UPDATE clientes SET primera_compra=COALESCE(primera_compra, ?), ultima_compra=?, "
            "total_compras=total_compras+1, valor_total=valor_total+?, actualizado=? WHERE id=?",
            (hoy, hoy, float(total or 0), time.time(), fila["id"]),
        )


def intencion_de_turno(herramientas: list[str], handoff: str | None, entrada: str = "") -> str:
    """Intención sin LLM, a partir de lo que hizo el agente en el turno."""
    if handoff in INTENCIONES:
        return handoff
    h = set(herramientas or [])
    t = (entrada or "").lower()
    if "consultar_pedido_web" in h or re.search(r"\b(gu[ií]a|rastreo|d[oó]nde (va|viene)|estado del pedido)\b", t):
        return "seguimiento"
    if "actualizar_pedido" in h or "guardar_datos_cliente" in h:
        return "cotizacion"
    if re.search(r"\b(comprobante|pagu[eé]|transferencia|consign)", t) or "[envió un" in t and "imagen" in t:
        return "pago"
    if "buscar_producto" in h or "ficha_producto" in h:
        return "cotizacion"
    if re.search(r"^\W*(?:hola\W*)?(?:buen[oa]s?(?:\s+(?:d[ií]as|tardes|noches))?|hola|c[oó]mo est[aá]s?)?\W*$", t.strip()) and t.strip():
        return "saludo"
    return "otro"


# --- Plantilla de datos en chats atendidos por el asesor -------------------------------

_PAT_CORREO = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PAT_CEDULA = re.compile(r"(?:c[eé]dula|c\.?c\.?|nit|documento)\s*:?\s*(\d[\d.]{5,14})", re.I)
_PAT_CEL = re.compile(r"(?:cel(?:ular)?|tel(?:[eé]fono)?|whatsapp)\s*:?\s*(\+?57\s?)?(3\d{2}[\s.-]?\d{3}[\s.-]?\d{4})", re.I)
_PAT_NOMBRE_ETQ = re.compile(r"(?:^|\n)\s*[_\-*]*\s*nombre(?:\s+completo)?\s*[:*]*\s*(.+)", re.I)
_PAT_DIR_ETQ = re.compile(r"(?:^|\n)\s*[_\-*]*\s*direcci[oó]n\s*[:*]*\s*(.+)", re.I)
_PAT_CIUDAD_ETQ = re.compile(r"(?:^|\n)\s*[_\-*]*\s*ciudad\s*[:*]*\s*(.+)", re.I)
_PAT_DIR_LIBRE = re.compile(
    r"\b(?:calle|cll|cl|carrera|cra|cr|kr|avenida|av|diagonal|dg|transversal|tv|manzana|mz)\b\.?\s*\d[\w\s#\-.,°ºª]*",
    re.I,
)
_PAT_NUM_SUELTO = re.compile(r"(?<![\d.])(\d{6,10})(?![\d.])")
_PAT_CEL_SUELTO = re.compile(r"(?<!\d)(3\d{9})(?!\d)")


def _es_ciudad_conocida(texto: str) -> bool:
    try:
        from app.services.tarifas_envio import _datos, normalizar_lugar

        nc = normalizar_lugar(texto)
        return bool(nc) and nc in (_datos().get("zona_por_ciudad") or {})
    except Exception:
        return False


def extraer_datos_plantilla(texto: str) -> dict:
    """Datos de despacho que el cliente escribe (con o sin las etiquetas de la plantilla)."""
    t = (texto or "").replace("**", "").strip()
    if not t:
        return {}
    out: dict[str, str] = {}
    m = _PAT_CORREO.search(t)
    if m:
        out["correo"] = m.group(0).strip(".")
    m = _PAT_CEDULA.search(t)
    if m:
        out["documento"] = m.group(1)
    m = _PAT_CEL.search(t)
    if m:
        out["telefono"] = _digitos(m.group(2))
    for pat, k in ((_PAT_NOMBRE_ETQ, "nombre"), (_PAT_DIR_ETQ, "direccion"), (_PAT_CIUDAD_ETQ, "ciudad")):
        m = pat.search(t)
        if m and m.group(1).strip(" :*_-"):
            out[k] = m.group(1).strip(" :*_-")[:200]
    if "direccion" not in out:
        m = _PAT_DIR_LIBRE.search(t)
        if m:
            out["direccion"] = m.group(0).strip(" ,.")[:200]
    lineas = [ln.strip(" _-*:") for ln in t.splitlines() if ln.strip(" _-*:")]
    # Plantilla sin etiquetas: nombre / cédula / dirección / ciudad / cel en líneas sueltas.
    if len(lineas) >= 3:
        if "documento" not in out:
            for ln in lineas:
                if _PAT_NUM_SUELTO.fullmatch(ln.replace(".", "")) or re.fullmatch(r"(?:cc|c\.c\.?)\s*\d[\d.]{5,}", ln, re.I):
                    out["documento"] = _digitos(ln)
                    break
        if "telefono" not in out:
            for ln in lineas:
                if _PAT_CEL_SUELTO.fullmatch(_digitos(ln)) and len(_digitos(ln)) == 10:
                    out["telefono"] = _digitos(ln)
                    break
        if "nombre" not in out:
            primera = lineas[0]
            if re.fullmatch(r"[A-Za-zÁÉÍÓÚÑáéíóúñ.'\s]{5,80}", primera) and len(primera.split()) >= 2 and not re.search(
                r"\b(hola|buen|gracias|listo|env[ií]o|pedido|favor|porfa)\b", primera, re.I
            ):
                out["nombre"] = primera[:120]
        if "ciudad" not in out:
            candidatas = [
                ln for ln in lineas[1:]
                if re.fullmatch(r"[A-Za-zÁÉÍÓÚÑáéíóúñ\s]{4,40}", ln) and len(ln.split()) <= 3
                and ln.lower() != out.get("nombre", "").lower()
                and not re.search(r"\b(gracias|listo|hola|buen|barrio|apto|torre|casa|piso|local|oficina|etapa|conjunto)\b", ln, re.I)
            ]
            conocida = next((ln for ln in candidatas if _es_ciudad_conocida(ln)), None)
            if conocida or candidatas:
                out["ciudad"] = (conocida or candidatas[-1]).title()[:60]
    # Sin al menos dos datos reales no es una plantilla, es un mensaje cualquiera.
    reales = [k for k in ("nombre", "documento", "direccion", "correo") if out.get(k)]
    if len(reales) < 2:
        return {k: v for k, v in out.items() if k == "correo"} if out.get("correo") and len(lineas) == 1 else {}
    return out


def capturar_desde_chats(desde_ts: float, *, hasta_ts: float | None = None) -> dict:
    """Recorre los mensajes de clientes en wa_chats.db desde `desde_ts` y guarda plantillas de datos."""
    from app.services.wa_chats import _conn as _wa_conn, _lock as _wa_lock

    hasta_ts = hasta_ts or time.time()
    with _wa_lock, _wa_conn() as c:
        filas = c.execute(
            """SELECT jid, ts, texto FROM mensajes WHERE direccion='entrada' AND eliminado=0
               AND jid NOT LIKE '%@g.us' AND ts > ? AND ts <= ? AND texto IS NOT NULL AND length(texto) >= 20
               ORDER BY ts""",
            (float(desde_ts), float(hasta_ts)),
        ).fetchall()
    n = 0
    for r in filas:
        datos = extraer_datos_plantilla(r["texto"] or "")
        if datos:
            if upsert_cliente(r["jid"], datos, fuente="chat_humano"):
                n += 1
    return {"revisados": len(filas), "guardados": n, "hasta_ts": hasta_ts}


def listar(limite: int = 200, q: str = "") -> list[dict]:
    q = (q or "").strip().lower()
    with _lock, _conn() as c:
        filas = c.execute("SELECT * FROM clientes ORDER BY COALESCE(actualizado, 0) DESC LIMIT ?", (int(limite) * (3 if q else 1),)).fetchall()
    out = []
    for r in filas:
        d = dict(r)
        d["documento"] = d.pop("nit", None)
        try:
            d["productos_interes"] = json.loads(d.get("productos_interes") or "[]")
            d["fuentes"] = json.loads(d.get("fuentes") or "[]")
        except ValueError:
            pass
        if q and q not in json.dumps(d, ensure_ascii=False).lower():
            continue
        out.append(d)
    return out[:limite]


def ficha(jid: str) -> dict | None:
    clave = clave_wa(jid)
    with _lock, _conn() as c:
        r = c.execute("SELECT * FROM clientes WHERE numero_wa=?", (clave,)).fetchone()
        if not r:
            return None
        d = dict(r)
        d["documento"] = d.pop("nit", None)
        for k in ("productos_interes", "fuentes"):
            try:
                d[k] = json.loads(d.get(k) or "[]")
            except ValueError:
                d[k] = []
        d["compras"] = [dict(x) for x in c.execute("SELECT * FROM compras WHERE cliente_id=? ORDER BY id DESC LIMIT 20", (r["id"],))]
        d["interacciones"] = [dict(x) for x in c.execute("SELECT * FROM interacciones WHERE numero_wa=? ORDER BY ts DESC LIMIT 20", (clave,))]
    return d
