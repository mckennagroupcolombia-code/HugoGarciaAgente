"""Cotizaciones pedidas a proveedores, enlazadas a la solicitud de pago (8-oct-2026).

Hasta hoy la cotización de un proveedor entraba a Solicitudes de pago como un
archivo suelto: alguien la pedía por WhatsApp o correo, la respuesta llegaba
por cualquier lado y se tecleaba en el wizard. No quedaba registro de **qué se
pidió**, ni a quién, ni si esa cotización ya se había pagado.

Ciclo (todo dentro de Contabilidad → Solicitudes de pago, sin LLM):

    solicitada  →  recibida  →  usada (en una solicitud de pago)
         └──────────┴──────→  descartada

  crear()                 proveedor (tercero del Libro Mayor) + materias primas del
                          catálogo de Alegra con su cantidad → COTP-0001.
  editar()                corregir el pedido mientras no esté usada ni descartada
                          (el proveedor, solo mientras no haya respondido).
  pdf() / texto()         el pedido para mandárselo al proveedor. El sistema NO lo
                          envía (decisión del usuario, 8-oct-2026): se descarga o se
                          copia y el operador lo manda por su canal.
  registrar_respuesta()   precios e IVA que cotizó el proveedor + su documento.
                          Cuadra al peso igual que una compra (`validar_compra`):
                          es la misma cotización que después se paga.
  validar_para_solicitud() / vincular()
                          `crear_solicitud` la usa: la solicitud de pago queda con
                          `cotizacion_proveedor_id` y el documento del proveedor como
                          soporte. Una cotización se paga una sola vez; si esa
                          solicitud se rechaza o se anula, la cotización vuelve a
                          quedar disponible.

Vive en `contabilidad.db`, junto a `cc_solicitudes_pago`.
"""
from __future__ import annotations

import io
import json
import re
from datetime import datetime
from pathlib import Path

from app.services.pagos_wizard import _conn

_ROOT = Path(__file__).resolve().parents[2]
DIR_COTIZACIONES = _ROOT / "comprobantes" / "cotizaciones_proveedor"

ESTADOS = ("solicitada", "recibida", "usada", "descartada")
# Una solicitud en estos estados ya no paga la cotización: queda libre otra vez.
_SOLICITUD_MUERTA = ("rechazada", "anulada")

_initialized = False


def _ensure() -> None:
    global _initialized
    if _initialized:
        return
    from app.services import pagos_wizard

    pagos_wizard.init_db()
    with _conn() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS cc_cotizaciones_proveedor (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            numero TEXT NOT NULL DEFAULT '',
            tercero_id INTEGER NOT NULL REFERENCES cc_terceros(id),
            estado TEXT NOT NULL DEFAULT 'solicitada',
            items_json TEXT NOT NULL DEFAULT '[]',
            notas TEXT NOT NULL DEFAULT '',
            fecha_requerida TEXT NOT NULL DEFAULT '',
            creada_por INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            -- La respuesta del proveedor
            items_cotizados_json TEXT NOT NULL DEFAULT '[]',
            total_documento REAL NOT NULL DEFAULT 0,
            numero_documento TEXT NOT NULL DEFAULT '',
            valida_hasta TEXT NOT NULL DEFAULT '',
            archivo TEXT NOT NULL DEFAULT '',
            archivo_nombre TEXT NOT NULL DEFAULT '',
            recibida_por INTEGER,
            recibida_at TEXT NOT NULL DEFAULT '',
            -- A qué pago fue a parar
            solicitud_pago_id INTEGER REFERENCES cc_solicitudes_pago(id),
            usada_at TEXT NOT NULL DEFAULT '',
            descartada_motivo TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_cc_cotizaciones_tercero
            ON cc_cotizaciones_proveedor(tercero_id, estado);
        """)
    _initialized = True


def _ahora() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ───────────────────────────────────────────── lectura ────────────────────


def _hidratar(con, r) -> dict:
    d = dict(r)
    d["items"] = json.loads(d.pop("items_json") or "[]")
    d["items_cotizados"] = json.loads(d.pop("items_cotizados_json") or "[]")
    t = con.execute(
        "SELECT id, nombre, identificacion, email, telefono FROM cc_terceros WHERE id=?",
        (d["tercero_id"],),
    ).fetchone()
    d["tercero"] = dict(t) if t else None
    sol = None
    if d.get("solicitud_pago_id"):
        s = con.execute(
            "SELECT id, estado, monto FROM cc_solicitudes_pago WHERE id=?", (d["solicitud_pago_id"],)
        ).fetchone()
        sol = dict(s) if s else None
    d["solicitud"] = sol
    # «usada» por una solicitud que después se rechazó o anuló: vuelve a estar
    # disponible. Se deriva al leer en vez de tocar rechazar()/borrar_borrador().
    if d["estado"] == "usada" and (not sol or sol["estado"] in _SOLICITUD_MUERTA):
        d["estado"] = "recibida"
    d["disponible"] = d["estado"] == "recibida"
    return d


def obtener(cid: int) -> dict | None:
    _ensure()
    with _conn() as con:
        r = con.execute("SELECT * FROM cc_cotizaciones_proveedor WHERE id=?", (int(cid),)).fetchone()
        return _hidratar(con, r) if r else None


def listar(estado: str | None = None, tercero_id: int | None = None, limit: int = 200) -> list[dict]:
    _ensure()
    sql, args = "SELECT * FROM cc_cotizaciones_proveedor", []
    if tercero_id:
        sql += " WHERE tercero_id=?"
        args.append(int(tercero_id))
    sql += " ORDER BY id DESC LIMIT ?"
    args.append(int(limit))
    with _conn() as con:
        filas = [_hidratar(con, r) for r in con.execute(sql, args)]
    # El estado se filtra después de derivarlo (una «usada» puede volver a «recibida»).
    return [f for f in filas if not estado or f["estado"] == estado]


# ───────────────────────────────────────────── pedir ──────────────────────


def _validar_renglones_pedido(items: list) -> list[dict]:
    """Lo que se pide: materia prima del catálogo de Alegra + cantidad.

    Las mismas reglas que una compra (`pagos_proveedor.validar_compra`) salvo
    precio y total, que todavía no existen: si la cotización se pide por un
    código que después no se puede pagar, el problema aparece al final.
    """
    from app.services.pagos_proveedor import _item_catalogo

    if not isinstance(items, list) or not items:
        raise ValueError("Agrega al menos una materia prima con su cantidad")
    out, problemas, vistos = [], [], set()
    for n, raw in enumerate(items, 1):
        if not isinstance(raw, dict):
            continue
        sku = str(raw.get("sku") or "").strip()
        etiqueta = f"Renglón {n} ({sku or raw.get('nombre') or 'sin nombre'})"
        try:
            cantidad = float(str(raw.get("cantidad") or 0).replace(",", "."))
        except ValueError:
            cantidad = 0
        if not sku:
            problemas.append(f"{etiqueta}: elígelo del catálogo de Alegra")
            continue
        if sku in vistos:
            problemas.append(f"{etiqueta}: está repetido")
            continue
        vistos.add(sku)
        if sku.upper().startswith("C-"):
            problemas.append(f"{etiqueta}: es un combo de venta; se cotiza la materia prima")
            continue
        item = _item_catalogo(sku)
        if not item:
            problemas.append(f"{etiqueta}: no existe en el catálogo de Alegra")
            continue
        if (item.get("type") or "") == "kit":
            problemas.append(f"{etiqueta}: es un combo de venta; se cotiza la materia prima")
            continue
        if cantidad <= 0:
            problemas.append(f"{etiqueta}: la cantidad debe ser mayor que cero")
            continue
        out.append({
            "sku": sku,
            "nombre": str(raw.get("nombre") or item.get("name") or "").strip(),
            "unidad": str(raw.get("unidad") or "").strip(),
            "cantidad": cantidad,
        })
    if problemas:
        raise ValueError("No se puede pedir la cotización: " + " · ".join(problemas))
    return out


def crear(payload: dict, creada_por: int | None = None) -> dict:
    _ensure()
    from app.services.contabilidad_core import obtener_tercero

    tid = int(payload.get("tercero_id") or 0)
    if not tid or not obtener_tercero(tid):
        raise ValueError("Elige el proveedor")
    items = _validar_renglones_pedido(payload.get("items"))
    fecha_req = str(payload.get("fecha_requerida") or "").strip()[:10]
    with _conn() as con:
        cur = con.execute(
            "INSERT INTO cc_cotizaciones_proveedor (tercero_id, items_json, notas, fecha_requerida, creada_por)"
            " VALUES (?,?,?,?,?)",
            (tid, json.dumps(items, ensure_ascii=False), str(payload.get("notas") or "").strip(),
             fecha_req, creada_por),
        )
        cid = int(cur.lastrowid)
        con.execute("UPDATE cc_cotizaciones_proveedor SET numero=? WHERE id=?", (f"COTP-{cid:04d}", cid))
    return obtener(cid)


def editar(cid: int, payload: dict, por: int | None = None) -> dict:
    """Corrige el pedido (materias primas, cantidades, fecha, nota) mientras no se
    haya pagado ni descartado. El proveedor solo cambia antes de que responda: lo
    que cotizó es suyo. Lo cotizado se corrige aparte (`registrar_respuesta`)."""
    _ensure()
    from app.services.contabilidad_core import obtener_tercero

    c = obtener(cid)
    if not c:
        raise ValueError(f"Cotización {cid} no encontrada")
    if c["estado"] in ("usada", "descartada"):
        raise ValueError(f"La cotización {c['numero']} está «{c['estado']}»: ya no se modifica")
    tid = int(payload.get("tercero_id") or c["tercero_id"])
    if tid != int(c["tercero_id"]):
        if c["estado"] != "solicitada":
            raise ValueError(f"{(c.get('tercero') or {}).get('nombre')} ya respondió la cotización {c['numero']}: "
                             "para otro proveedor pide una cotización nueva")
        if not obtener_tercero(tid):
            raise ValueError("Elige el proveedor")
    items = _validar_renglones_pedido(payload.get("items"))
    fecha_req = str(payload.get("fecha_requerida") or "").strip()[:10]
    with _conn() as con:
        con.execute(
            "UPDATE cc_cotizaciones_proveedor SET tercero_id=?, items_json=?, notas=?, fecha_requerida=?"
            " WHERE id=? AND estado IN ('solicitada','recibida')",
            (tid, json.dumps(items, ensure_ascii=False), str(payload.get("notas") or "").strip(),
             fecha_req, int(cid)),
        )
    return obtener(cid)


def _cantidad(v: float) -> str:
    """1000 → «1.000», 2.5 → «2,5» (formato colombiano, hasta 3 decimales)."""
    s = f"{float(v or 0):,.3f}".rstrip("0").rstrip(".")
    return s.replace(",", "X").replace(".", ",").replace("X", ".")


def texto(cid: int) -> str:
    """El pedido en texto plano, para pegarlo en WhatsApp o en un correo."""
    from app.services import empresa

    c = obtener(cid)
    if not c:
        raise ValueError(f"Cotización {cid} no encontrada")
    nombre = (c.get("tercero") or {}).get("nombre") or "proveedor"
    lineas = [
        f"Buen día, {nombre.rstrip('.')}.",
        "",
        f"{empresa.razon_social()} (NIT {empresa.nit()}) les solicita cotización de:",
        "",
    ]
    for n, it in enumerate(c["items"], 1):
        u = f" {it['unidad']}" if it.get("unidad") else ""
        lineas.append(f"{n}. {it['nombre']} — {_cantidad(it['cantidad'])}{u} (ref. {it['sku']})")
    lineas += [
        "",
        "Por favor indicar precio unitario sin IVA, tarifa de IVA, total, tiempo de entrega",
        "y vigencia de la cotización.",
    ]
    if c.get("fecha_requerida"):
        lineas.append(f"La necesitamos para el {c['fecha_requerida']}.")
    if c.get("notas"):
        lineas += ["", c["notas"]]
    lineas += ["", f"Referencia de nuestra solicitud: {c['numero']}", "", "Gracias."]
    return "\n".join(lineas)


def pdf(cid: int) -> bytes:
    """El mismo pedido como PDF, con la identidad de los documentos de la app
    (logotipo turquesa, Montserrat, pie de `cotizacion_pdf`, igual que el
    comprobante de egreso).

    Siempre en **media carta horizontal** (21,6 × 14 cm), decisión del usuario
    (8-oct-2026): cabecera compacta y tabla apretada para que un pedido normal
    quepa en una hoja; uno largo sigue en otra hoja de media carta (repite el
    encabezado de la tabla), nunca pasa a carta."""
    return _pdf(cid)[0]


def _pdf(cid: int) -> tuple[bytes, int]:
    """(PDF, número de páginas)."""
    from reportlab.lib.pagesizes import landscape
    from reportlab.lib.units import cm
    from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    from app.services import empresa
    from app.tools import comprobante_contable as cc_pdf
    from app.tools import cotizacion_pdf as marca

    c = obtener(cid)
    if not c:
        raise ValueError(f"Cotización {cid} no encontrada")
    esc = cc_pdf._esc
    t = c.get("tercero") or {}
    st = cc_pdf.estilos()
    buf = io.BytesIO()
    # Media carta horizontal: 21,6 × 14 cm (el ancho de la carta, la mitad de alto).
    # El pie de `cotizacion_pdf` se dibuja a lo ancho de la carta: es el mismo ancho.
    tamano = landscape((14.0 * cm, 21.59 * cm))
    margen = 1.5 * cm
    doc = SimpleDocTemplate(buf, pagesize=tamano, leftMargin=margen, rightMargin=margen,
                            topMargin=0.7 * cm, bottomMargin=1.6 * cm,
                            title=f"Solicitud de cotización {c['numero']}", author=empresa.razon_social())
    ancho = tamano[0] - 2 * margen

    # Cabecera compacta: logotipo pequeño a la izquierda, título y datos a la derecha.
    logo_png, aspecto = marca._logo()
    logo = (Image(io.BytesIO(logo_png), width=3.6 * cm, height=3.6 * cm / aspecto)
            if logo_png else Paragraph(esc(empresa.razon_social()), st["fuerte"]))
    logo.hAlign = "LEFT"
    meta = [Paragraph("SOLICITUD DE COTIZACIÓN", st["titulo"]),
            Paragraph(f"N.º <b>{esc(c['numero'])}</b>  ·  Fecha <b>{esc(str(c['created_at'])[:10])}</b>", st["meta"]),
            Paragraph(f"{esc(empresa.razon_social())}  ·  NIT {esc(empresa.nit())}", st["meta"])]
    cab = Table([[logo, meta]], colWidths=[ancho * 0.35, ancho * 0.65])
    cab.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                             ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                             ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    filete = Table([[""]], colWidths=[ancho], rowHeights=[1.5])
    filete.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), marca.ACENTO)]))
    story = [cab, Spacer(1, 4), filete, Spacer(1, 6)]

    # Datos en dos columnas (rótulo · valor | rótulo · valor): en horizontal sobra ancho.
    pares = [("PROVEEDOR", (t.get("nombre") or "—")
              + (f"  ·  NIT/CC {t['identificacion']}" if t.get("identificacion") else ""))]
    contacto = "  ·  ".join(x for x in (t.get("email"), t.get("telefono")) if x)
    if contacto:
        pares.append(("CONTACTO", contacto))
    if c.get("fecha_requerida"):
        pares.append(("REQUERIDA", c["fecha_requerida"]))
    if c.get("notas"):
        pares.append(("NOTA", c["notas"]))
    rot = 2.2 * cm
    col = ancho / 2
    celdas = [[Paragraph(esc(k), st["rotulo"]), Paragraph(esc(v), st["cuerpo"])] for k, v in pares]
    filas_datos = []
    for k in range(0, len(celdas), 2):
        izq = celdas[k]
        der = celdas[k + 1] if k + 1 < len(celdas) else ["", ""]
        filas_datos.append(izq + der)
    td = Table(filas_datos, colWidths=[rot, col - rot, rot, col - rot])
    td.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), marca.TINTE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, marca.BORDE),
    ]))
    story += [td, Spacer(1, 8)]

    filas = [[Paragraph("#", st["cab"]), Paragraph("REFERENCIA", st["cab"]),
              Paragraph("MATERIA PRIMA", st["cab"]), Paragraph("CANTIDAD", st["cab_der"])]]
    for n, it in enumerate(c["items"], 1):
        filas.append([Paragraph(str(n), st["cuerpo"]),
                      Paragraph(esc(it["sku"]), st["codigo"]),
                      Paragraph(esc(it["nombre"]), st["cuerpo"]),
                      Paragraph(esc(f"{_cantidad(it['cantidad'])} {it.get('unidad') or ''}".strip()), st["num"])])
    w_ref, w_cant, w_n = 5.0 * cm, 3.0 * cm, 0.8 * cm
    ti = Table(filas, colWidths=[w_n, w_ref, ancho - w_n - w_ref - w_cant, w_cant], repeatRows=1)
    ti.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), marca.ACENTO_OSCURO),
                            ("LINEBELOW", (0, 1), (-1, -1), 0.4, marca.BORDE),
                            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                            ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    story += [ti, Spacer(1, 5),
              Paragraph(f"Solicitud generada desde {esc(empresa.razon_social())} el "
                        f"{datetime.now():%Y-%m-%d %H:%M}. No es una orden de compra: la compra se "
                        "confirma por separado al aceptar la cotización.", st["pie"])]
    pie = marca._pie_de_pagina(marca._empresa(), marca._fuentes())
    doc.build(story, onFirstPage=pie, onLaterPages=pie)
    return buf.getvalue(), doc.page


# ───────────────────────────────────────────── respuesta ──────────────────


def _guardar_archivo(cid: int, numero: str, contenido: bytes, nombre: str) -> tuple[str, str]:
    DIR_COTIZACIONES.mkdir(parents=True, exist_ok=True)
    seguro = re.sub(r"[^A-Za-z0-9._-]+", "_", nombre or "cotizacion")[:80] or "cotizacion"
    destino = DIR_COTIZACIONES / f"{numero or cid}_{seguro}"
    destino.write_bytes(contenido)
    return str(destino.relative_to(_ROOT)), seguro


def registrar_respuesta(cid: int, payload: dict, archivo: tuple[bytes, str] | None = None,
                        por: int | None = None) -> dict:
    """Lo que cotizó el proveedor. Se puede corregir mientras no se haya pagado.

    Los renglones pueden diferir de lo pedido (no tenía un producto, cotizó otra
    cantidad): manda lo que dice su documento, porque es eso lo que se paga.
    """
    _ensure()
    from app.services.pagos_proveedor import normalizar_items, validar_compra

    c = obtener(cid)
    if not c:
        raise ValueError(f"Cotización {cid} no encontrada")
    if c["estado"] in ("usada", "descartada"):
        raise ValueError(f"La cotización {c['numero']} está «{c['estado']}»: ya no se modifica")
    items = normalizar_items(payload.get("items"))
    total = round(float(str(payload.get("total_documento") or 0).replace(",", ".") or 0), 2)
    validar_compra(items, total)
    if not archivo and not c.get("archivo"):
        raise ValueError("Adjunta el documento que mandó el proveedor (PDF, imagen o XML)")
    with _conn() as con:
        con.execute(
            "UPDATE cc_cotizaciones_proveedor SET estado='recibida', items_cotizados_json=?,"
            " total_documento=?, numero_documento=?, valida_hasta=?, recibida_por=?, recibida_at=?"
            " WHERE id=?",
            (json.dumps(items, ensure_ascii=False), total,
             str(payload.get("numero_documento") or "").strip(),
             str(payload.get("valida_hasta") or "").strip()[:10], por, _ahora(), int(cid)),
        )
    if archivo:
        ruta, nombre = _guardar_archivo(cid, c["numero"], archivo[0], archivo[1])
        with _conn() as con:
            con.execute("UPDATE cc_cotizaciones_proveedor SET archivo=?, archivo_nombre=? WHERE id=?",
                        (ruta, nombre, int(cid)))
    return obtener(cid)


def descartar(cid: int, motivo: str = "", por: int | None = None) -> dict:
    _ensure()
    c = obtener(cid)
    if not c:
        raise ValueError(f"Cotización {cid} no encontrada")
    if c["estado"] == "usada":
        raise ValueError(f"La cotización {c['numero']} ya está en la solicitud de pago "
                         f"#{c['solicitud_pago_id']}: rechaza o anula esa solicitud primero")
    with _conn() as con:
        con.execute("UPDATE cc_cotizaciones_proveedor SET estado='descartada', descartada_motivo=? WHERE id=?",
                    (str(motivo or "sin motivo").strip(), int(cid)))
    return obtener(cid)


def ruta_archivo(cid: int) -> Path | None:
    c = obtener(cid)
    if not c or not c.get("archivo"):
        return None
    p = _ROOT / c["archivo"]
    return p if p.exists() else None


# ─────────────────────────────── enlace con el pago ──────────────────────


def validar_para_solicitud(cid: int, tercero_id, total_documento: float) -> dict:
    """La cotización que llega con una solicitud de pago: recibida, del mismo
    proveedor, sin otro pago vivo y por el mismo total."""
    c = obtener(cid)
    if not c:
        raise ValueError(f"Cotización {cid} no encontrada")
    if c["estado"] != "recibida":
        if c["estado"] == "usada":
            raise ValueError(f"La cotización {c['numero']} ya se está pagando en la solicitud "
                             f"#{c['solicitud_pago_id']}")
        raise ValueError(f"La cotización {c['numero']} está «{c['estado']}»: registra primero la "
                         "respuesta del proveedor")
    if int(tercero_id or 0) != int(c["tercero_id"]):
        raise ValueError(f"La cotización {c['numero']} es de {(c.get('tercero') or {}).get('nombre')}, "
                         "no del proveedor elegido")
    if abs(float(total_documento or 0) - float(c["total_documento"] or 0)) > 1:
        raise ValueError(
            f"El total de la solicitud ({float(total_documento or 0):,.0f}) no es el de la cotización "
            f"{c['numero']} ({float(c['total_documento']):,.0f})".replace(",", ".")
        )
    return c


def vincular(cid: int, sid: int) -> dict | None:
    """Marca la cotización como usada por esa solicitud. Condicional: si otra
    solicitud viva la tomó en el medio, no la pisa y devuelve None."""
    _ensure()
    with _conn() as con:
        cur = con.execute(
            "UPDATE cc_cotizaciones_proveedor SET estado='usada', solicitud_pago_id=?, usada_at=?"
            " WHERE id=? AND estado IN ('recibida','usada') AND (solicitud_pago_id IS NULL"
            "   OR solicitud_pago_id IN (SELECT id FROM cc_solicitudes_pago WHERE estado IN ('rechazada','anulada')))",
            (int(sid), _ahora(), int(cid)),
        )
        if not cur.rowcount:
            return None
    return obtener(cid)
