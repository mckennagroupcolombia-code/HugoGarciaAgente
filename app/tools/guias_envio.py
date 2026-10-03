"""Rótulos (guías) de envío para impresora térmica.

Reemplaza el formato en Excel/Word que se llenaba a mano para pegar en la caja.
Genera un PDF a la medida del rollo de la Vretti (10x15 cm por defecto), con los
datos del pedido ya registrado en el sistema — pedidos de la tienda web y
despachos de WhatsApp — o escritos a mano para envíos sueltos.

Cada rótulo impreso queda registrado (`rotulos_envio` en app/data/despachos.db)
para poder reimprimirlo igual y para saber cuántos paquetes salieron cada día
(ese conteo alimenta la casilla "envíos del día" de Operativos → Mensajería).

Nota MeLi: las ventas de Mercado Libre viajan con la etiqueta que genera la
propia plataforma (Colecta/Flex), así que este módulo no las incluye — pegar un
rótulo propio no reemplaza esa etiqueta.
"""
from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timedelta
from typing import Any

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DESPACHOS_DB = os.path.join(_ROOT, "app", "data", "despachos.db")
ORDERS_WEB_DB = os.path.join(_ROOT, "PAGINA_WEB", "site", "data", "orders.db")
REMITENTE_PATH = os.path.join(_ROOT, "app", "data", "remitente_envios.json")
# Logotipo horizontal (con el nombre). La térmica es monocroma, así que se
# imprime en negro puro usando el canal alfa como máscara — ver `_logo_negro()`.
_LOGO = os.path.join(_ROOT, "DISENO CORPORATIVO ", "LOGOTIPO TURQUESA.png")
_LOGO_ISOTIPO = os.path.join(_ROOT, "DISENO CORPORATIVO ", "isotipo_final.png")
LEMA = "Proveemos a tus ideas"

# Tamaños de rollo soportados (ancho x alto en mm). El de la Vretti es 10x15.
TAMANOS: dict[str, tuple[float, float]] = {
    "10x15": (100.0, 150.0),
    "10x10": (100.0, 100.0),
    "5x7.5": (50.0, 75.0),
}
TAMANO_DEFAULT = "10x15"

def _empresa_default(campo: str, alterno: str) -> str:
    """Identidad fiscal desde app/services/empresa.py (fuente única, decisión 8)."""
    try:
        from app.services import empresa

        return str(getattr(empresa, campo)())
    except Exception:
        return alterno


_REMITENTE_DEFAULT = {
    "nombre": _empresa_default("razon_social", "McKenna Group S.A.S.").upper(),
    "nit": _empresa_default("nit", "901.316.016-3"),
    "direccion": "",
    "ciudad": _empresa_default("ciudad", "Bogotá D.C."),
    "telefono": "319 518 35 96",
    "correo": "www.mckennagroup.co",
    "nota": LEMA,
}


# ─── Remitente (editable desde el panel) ────────────────────────────────────

def leer_remitente() -> dict[str, Any]:
    datos = dict(_REMITENTE_DEFAULT)
    try:
        with open(REMITENTE_PATH, encoding="utf-8") as f:
            guardado = json.load(f)
        if isinstance(guardado, dict):
            datos.update({k: v for k, v in guardado.items() if k in _REMITENTE_DEFAULT})
    except Exception:
        pass
    return datos


def guardar_remitente(data: dict[str, Any]) -> dict[str, Any]:
    actual = leer_remitente()
    for k in _REMITENTE_DEFAULT:
        if k in data:
            actual[k] = str(data.get(k) or "").strip()[:120]
    if not actual["nombre"]:
        raise ValueError("El nombre del remitente es obligatorio")
    os.makedirs(os.path.dirname(REMITENTE_PATH), exist_ok=True)
    with open(REMITENTE_PATH, "w", encoding="utf-8") as f:
        json.dump(actual, f, ensure_ascii=False, indent=2)
    return actual


# ─── Registro de rótulos impresos ───────────────────────────────────────────

def _conn_despachos() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DESPACHOS_DB), exist_ok=True)
    con = sqlite3.connect(DESPACHOS_DB)
    con.row_factory = sqlite3.Row
    return con


def _ensure_tabla() -> None:
    with _conn_despachos() as con:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS rotulos_envio (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                canal TEXT NOT NULL DEFAULT 'manual',
                pedido_id TEXT NOT NULL DEFAULT '',
                destinatario TEXT NOT NULL DEFAULT '',
                ciudad TEXT NOT NULL DEFAULT '',
                guia TEXT NOT NULL DEFAULT '',
                copias INTEGER NOT NULL DEFAULT 1,
                datos_json TEXT NOT NULL DEFAULT '{}',
                creado_por INTEGER,
                creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )
            """
        )
        con.execute(
            "CREATE INDEX IF NOT EXISTS idx_rotulos_envio_fecha ON rotulos_envio(creado_en)"
        )


def registrar_rotulo(datos: dict[str, Any], *, copias: int = 1, creado_por: int | None = None) -> int:
    _ensure_tabla()
    with _conn_despachos() as con:
        cur = con.execute(
            """INSERT INTO rotulos_envio
                   (canal, pedido_id, destinatario, ciudad, guia, copias, datos_json, creado_por)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                str(datos.get("canal") or "manual"),
                str(datos.get("pedido_id") or ""),
                str(datos.get("nombre") or ""),
                str(datos.get("ciudad") or ""),
                str(datos.get("guia") or ""),
                max(1, int(copias or 1)),
                json.dumps(datos, ensure_ascii=False),
                creado_por,
            ),
        )
        return int(cur.lastrowid)


def obtener_rotulos(ids: list[int]) -> list[dict[str, Any]]:
    _ensure_tabla()
    ids = [int(i) for i in ids if str(i).strip()]
    if not ids:
        return []
    with _conn_despachos() as con:
        marcas = ",".join("?" * len(ids))
        rows = con.execute(
            f"SELECT * FROM rotulos_envio WHERE id IN ({marcas})", ids
        ).fetchall()
    por_id = {}
    for r in rows:
        d = dict(r)
        try:
            d["datos"] = json.loads(d.get("datos_json") or "{}")
        except Exception:
            d["datos"] = {}
        por_id[int(d["id"])] = d
    return [por_id[i] for i in ids if i in por_id]


def historial(dias: int = 15) -> list[dict[str, Any]]:
    _ensure_tabla()
    corte = (datetime.now() - timedelta(days=max(1, int(dias or 15)))).strftime("%Y-%m-%d")
    with _conn_despachos() as con:
        rows = con.execute(
            "SELECT id, canal, pedido_id, destinatario, ciudad, guia, copias, creado_en "
            "FROM rotulos_envio WHERE date(creado_en) >= ? ORDER BY id DESC LIMIT 300",
            (corte,),
        ).fetchall()
    return [dict(r) for r in rows]


def conteo_por_dia(fecha: str = "") -> dict[str, Any]:
    """Cuántos rótulos se imprimieron ese día — sugerencia para «envíos del día»."""
    _ensure_tabla()
    dia = (fecha or "").strip()[:10] or datetime.now().strftime("%Y-%m-%d")
    with _conn_despachos() as con:
        row = con.execute(
            "SELECT COUNT(*) n, COALESCE(SUM(copias), 0) c FROM rotulos_envio WHERE date(creado_en) = ?",
            (dia,),
        ).fetchone()
    return {"fecha": dia, "rotulos": int(row["n"] or 0), "copias": int(row["c"] or 0)}


# ─── Pedidos con datos de envío ─────────────────────────────────────────────

def _items_resumen(items: list[dict[str, Any]], limite: int = 6) -> list[str]:
    out = []
    for it in items[:limite]:
        if not isinstance(it, dict):
            continue
        nombre = str(it.get("name") or it.get("nombre") or it.get("title") or "").strip()
        cant = it.get("qty") or it.get("quantity") or it.get("cantidad") or 1
        if nombre:
            out.append(f"{nombre[:46]} x{cant}")
    if len(items) > limite:
        out.append(f"…y {len(items) - limite} ítem(s) más")
    return out


def _pedidos_web(dias: int, q: str = "") -> list[dict[str, Any]]:
    if not os.path.isfile(ORDERS_WEB_DB):
        return []
    corte = (datetime.now() - timedelta(days=max(1, dias))).isoformat()
    try:
        con = sqlite3.connect(ORDERS_WEB_DB)
        con.row_factory = sqlite3.Row
        rows = con.execute(
            "SELECT * FROM orders WHERE lower(status) IN ('approved','paid') "
            "AND (created_at >= ? OR created_at IS NULL) "
            "AND (cancelled_at IS NULL OR cancelled_at = '') "
            "ORDER BY id DESC LIMIT 120",
            (corte,),
        ).fetchall()
        con.close()
    except Exception:
        return []

    qn = (q or "").strip().lower()
    out = []
    for row in rows:
        d = dict(row)
        try:
            raw = json.loads(d.get("items_json") or "{}")
        except Exception:
            raw = {}
        raw = raw if isinstance(raw, dict) else {}
        items = raw.get("items") if isinstance(raw.get("items"), list) else []
        billing = raw.get("billing") if isinstance(raw.get("billing"), dict) else {}
        ref = str(d.get("reference") or d.get("id") or "")
        nombre = str(d.get("buyer_name") or billing.get("name") or "")
        direccion = str(raw.get("address") or billing.get("address") or "")
        ciudad = str(d.get("buyer_city") or billing.get("city") or "")
        blob = f"{ref} {nombre} {ciudad} {d.get('buyer_phone') or ''}".lower()
        if qn and qn not in blob:
            continue
        out.append({
            "canal": "web",
            "pedido_id": ref,
            "fecha": str(d.get("created_at") or "")[:16],
            "estado": str(d.get("shipping_status") or d.get("status") or ""),
            "nombre": nombre,
            "documento": str(raw.get("cedula") or billing.get("nit") or ""),
            "telefono": str(d.get("buyer_phone") or ""),
            "direccion": direccion,
            "ciudad": ciudad,
            "departamento": str(raw.get("dept") or ""),
            "observaciones": str(raw.get("notes") or ""),
            "contenido": _items_resumen(items),
            "piezas": 1,
            "valor_declarado": float(d.get("total") or 0),
            "guia": str(d.get("tracking_number") or ""),
            "transportadora": str(d.get("tracking_carrier") or "Interrapidísimo"),
            "listo": bool(direccion and ciudad),
        })
    return out


def _pedidos_whatsapp(dias: int, q: str = "") -> list[dict[str, Any]]:
    if not os.path.isfile(DESPACHOS_DB):
        return []
    corte = (datetime.now() - timedelta(days=max(1, dias))).isoformat()
    try:
        with _conn_despachos() as con:
            rows = con.execute(
                "SELECT * FROM despachos WHERE creado_en >= ? OR creado_en IS NULL "
                "ORDER BY id DESC LIMIT 120",
                (corte,),
            ).fetchall()
    except Exception:
        return []

    qn = (q or "").strip().lower()
    out = []
    for r in rows:
        d = dict(r)
        nombre = str(d.get("cliente") or "")
        ciudad = str(d.get("ciudad") or "")
        pid = str(d.get("order_id") or d.get("id") or "")
        blob = f"{pid} {nombre} {ciudad} {d.get('numero_wa') or ''}".lower()
        if qn and qn not in blob:
            continue
        productos = [p.strip() for p in str(d.get("productos") or "").split(",") if p.strip()]
        out.append({
            "canal": "whatsapp",
            "pedido_id": pid,
            "fecha": str(d.get("creado_en") or "")[:16],
            "estado": str(d.get("estado") or ""),
            "nombre": nombre,
            "documento": "",
            "telefono": str(d.get("numero_wa") or ""),
            "direccion": str(d.get("direccion") or ""),
            "ciudad": ciudad,
            "departamento": "",
            "observaciones": "",
            "contenido": productos[:6],
            "piezas": 1,
            "valor_declarado": 0.0,
            "guia": str(d.get("guia") or ""),
            "transportadora": str(d.get("transportadora") or "Interrapidísimo"),
            "listo": bool(d.get("direccion") and ciudad),
        })
    return out


def listar_pedidos(dias: int = 10, q: str = "", canal: str = "") -> dict[str, Any]:
    """Pedidos despachables por McKenna (web y WhatsApp), con datos de envío."""
    dias = max(1, min(60, int(dias or 10)))
    canal_f = (canal or "").strip().lower()
    pedidos: list[dict[str, Any]] = []
    if canal_f in ("", "web"):
        pedidos.extend(_pedidos_web(dias, q))
    if canal_f in ("", "whatsapp"):
        pedidos.extend(_pedidos_whatsapp(dias, q))
    pedidos.sort(key=lambda p: p.get("fecha") or "", reverse=True)
    return {
        "pedidos": pedidos,
        "total": len(pedidos),
        "sin_direccion": sum(1 for p in pedidos if not p.get("listo")),
        "dias": dias,
    }


def datos_de_pedido(canal: str, pedido_id: str) -> dict[str, Any] | None:
    for p in listar_pedidos(dias=60, canal=canal)["pedidos"]:
        if str(p.get("pedido_id")) == str(pedido_id):
            return p
    return None


def normalizar_datos(data: dict[str, Any]) -> dict[str, Any]:
    """Deja un rótulo listo para dibujar (manual o desde pedido).

    El rótulo **no** lleva contenido ni valor declarado: va pegado por fuera de
    la caja, a la vista de cualquiera, y detallar qué hay dentro y cuánto vale
    es justo lo que no conviene en un paquete que viaja. Si el pedido trae esos
    campos (los usa el listado del panel), se descartan aquí a propósito.
    """
    nombre = str(data.get("nombre") or "").strip()
    if not nombre:
        raise ValueError("El rótulo necesita el nombre del destinatario")
    ciudad = str(data.get("ciudad") or "").strip()
    direccion = str(data.get("direccion") or "").strip()
    if not (ciudad and direccion):
        raise ValueError("El rótulo necesita dirección y ciudad de destino")
    return {
        "canal": str(data.get("canal") or "manual"),
        "pedido_id": str(data.get("pedido_id") or "").strip(),
        "nombre": nombre[:70],
        "documento": str(data.get("documento") or "").strip()[:30],
        "telefono": str(data.get("telefono") or "").strip()[:40],
        "direccion": direccion[:160],
        "ciudad": ciudad[:50],
        "departamento": str(data.get("departamento") or "").strip()[:40],
        "observaciones": str(data.get("observaciones") or "").strip()[:160],
        "piezas": max(1, int(data.get("piezas") or 1)),
        "peso_kg": str(data.get("peso_kg") or "").strip()[:10],
        "guia": str(data.get("guia") or "").strip()[:40],
        "transportadora": str(data.get("transportadora") or "Interrapidísimo").strip()[:40],
    }


# ─── PDF del rótulo ─────────────────────────────────────────────────────────

_LOGO_CACHE: dict[str, Any] = {}


def _logo_negro():
    """Logotipo en negro puro sobre transparente, para la térmica monocroma.

    Usa el canal alfa del PNG corporativo como máscara: lo que está pintado
    queda negro y el fondo sigue transparente. Se cachea en memoria porque el
    archivo pesa ~0,5 MB y convertirlo por cada PDF no tiene sentido.
    """
    if "reader" in _LOGO_CACHE:
        return _LOGO_CACHE["reader"]
    _LOGO_CACHE["reader"] = None
    ruta = _LOGO if os.path.isfile(_LOGO) else _LOGO_ISOTIPO
    try:
        import io

        from PIL import Image
        from reportlab.lib.utils import ImageReader

        img = Image.open(ruta).convert("RGBA")
        alpha = img.getchannel("A")
        negro = Image.new("RGBA", img.size, (0, 0, 0, 0))
        negro.putalpha(alpha)
        buf = io.BytesIO()
        negro.save(buf, format="PNG")
        buf.seek(0)
        _LOGO_CACHE["reader"] = ImageReader(buf)
        _LOGO_CACHE["aspect"] = img.size[0] / max(1, img.size[1])
    except Exception:
        pass
    return _LOGO_CACHE["reader"]


def _wrap(texto: str, ancho_mm: float, font: str, size: float, canvas_obj, max_lineas: int = 3) -> list[str]:
    from reportlab.lib.units import mm

    palabras = str(texto or "").split()
    lineas: list[str] = []
    actual = ""
    for palabra in palabras:
        prueba = f"{actual} {palabra}".strip()
        if canvas_obj.stringWidth(prueba, font, size) <= ancho_mm * mm:
            actual = prueba
        else:
            if actual:
                lineas.append(actual)
            actual = palabra
        if len(lineas) == max_lineas:
            break
    if actual and len(lineas) < max_lineas:
        lineas.append(actual)
    return lineas or [""]


def _ajustar(texto: str, ancho_mm: float, font: str, size: float, canvas_obj, minimo: float) -> float:
    """Baja el cuerpo de letra hasta que el texto quepa en una línea."""
    from reportlab.lib.units import mm

    while size > minimo and canvas_obj.stringWidth(texto, font, size) > ancho_mm * mm:
        size -= 0.5
    return size


def generar_pdf(rotulos: list[dict[str, Any]], *, tamano: str = TAMANO_DEFAULT) -> bytes:
    """Un rótulo por página, listo para mandar a la térmica sin escalar.

    El rótulo se dibuja por bandas de altura fija (encabezado · destinatario ·
    remitente · pie), no en flujo continuo: así dos paquetes con datos de
    distinto largo salen con la misma pinta y el mensajero encuentra siempre la
    dirección en el mismo sitio. No lleva contenido ni valor declarado.
    """
    import io

    from reportlab.graphics.barcode import code128
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas as rl_canvas

    if not rotulos:
        raise ValueError("No hay rótulos para imprimir")
    ancho_mm, alto_mm = TAMANOS.get(tamano, TAMANOS[TAMANO_DEFAULT])
    remitente = leer_remitente()
    logo = _logo_negro()
    aspect = float(_LOGO_CACHE.get("aspect") or 2.9)
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(ancho_mm * mm, alto_mm * mm))
    # Escala: el diseño está pensado para 10x15; en rollos menores se reduce
    # proporcionalmente el tamaño de letra para que todo siga cabiendo.
    k = min(ancho_mm / 100.0, alto_mm / 150.0)
    m = 4.0
    util = ancho_mm - 2 * m

    # Bandas, como fracción del alto: el rótulo se lee siempre igual.
    y_top = alto_mm - m
    y_head = y_top - 0.135 * alto_mm          # fin del encabezado
    y_remit = m + 0.355 * alto_mm             # inicio del bloque remitente
    y_pie = m + 0.205 * alto_mm               # inicio del pie (guía y barras)

    for datos in rotulos:
        d = normalizar_datos(datos)

        c.setLineWidth(1.0)
        c.rect((m - 2) * mm, (m - 2) * mm, (ancho_mm - 2 * (m - 2)) * mm, (alto_mm - 2 * (m - 2)) * mm)

        # ── Encabezado: logotipo + lema, y la referencia del pedido a la derecha
        logo_h = 0.075 * alto_mm
        logo_w = min(logo_h * aspect, util * 0.56)
        logo_h = logo_w / aspect
        if logo is not None:
            try:
                c.drawImage(
                    logo, m * mm, (y_top - logo_h) * mm,
                    width=logo_w * mm, height=logo_h * mm,
                    mask="auto", preserveAspectRatio=True, anchor="sw",
                )
            except Exception:
                pass
        else:
            c.setFont("Helvetica-Bold", 13 * k)
            c.drawString(m * mm, (y_top - logo_h * 0.75) * mm, remitente["nombre"].upper()[:24])
        c.setFont("Helvetica-Oblique", 7.5 * k)
        c.drawString(m * mm, (y_head + 2.2 * k) * mm, LEMA)

        c.setFont("Helvetica", 6 * k)
        c.drawRightString((ancho_mm - m) * mm, (y_top - 3.4 * k) * mm, "PEDIDO")
        ref = d["pedido_id"][:22] or "ENVÍO"
        size_ref = _ajustar(ref, util * 0.45, "Helvetica-Bold", 11 * k, c, 6 * k)
        c.setFont("Helvetica-Bold", size_ref)
        c.drawRightString((ancho_mm - m) * mm, (y_top - 8.4 * k) * mm, ref)
        c.setFont("Helvetica", 6.5 * k)
        c.drawRightString(
            (ancho_mm - m) * mm, (y_head + 2.2 * k) * mm,
            datetime.now().strftime("%d/%m/%Y %H:%M"),
        )

        c.setLineWidth(1.2)
        c.line(m * mm, y_head * mm, (ancho_mm - m) * mm, y_head * mm)

        # ── Destinatario: lo primero que busca el mensajero
        y = y_head - 5.5 * k
        c.setFont("Helvetica-Bold", 7 * k)
        c.drawString(m * mm, y * mm, "DESTINATARIO")
        y -= 7 * k
        c.setFont("Helvetica-Bold", 14 * k)
        for linea in _wrap(d["nombre"], util, "Helvetica-Bold", 14 * k, c, 2):
            c.drawString(m * mm, y * mm, linea)
            y -= 6 * k

        sub = []
        if d["documento"]:
            sub.append(f"CC/NIT {d['documento']}")
        if d["telefono"]:
            sub.append(f"Tel. {d['telefono']}")
        if sub:
            c.setFont("Helvetica-Bold", 10.5 * k)
            c.drawString(m * mm, y * mm, "   ".join(sub)[:52])
            y -= 6.5 * k

        y -= 1.5 * k
        c.setFont("Helvetica", 6.5 * k)
        c.drawString(m * mm, y * mm, "DIRECCIÓN")
        y -= 5.5 * k
        c.setFont("Helvetica-Bold", 12 * k)
        for linea in _wrap(d["direccion"], util, "Helvetica-Bold", 12 * k, c, 3):
            c.drawString(m * mm, y * mm, linea)
            y -= 5.5 * k
        if d["observaciones"]:
            c.setFont("Helvetica-Oblique", 8 * k)
            for linea in _wrap(d["observaciones"], util, "Helvetica-Oblique", 8 * k, c, 2):
                c.drawString(m * mm, y * mm, linea)
                y -= 4.2 * k

        # Ciudad anclada al pie de la banda: el destino queda siempre a la misma
        # altura, aunque la dirección sea de una línea o de tres.
        ciudad = d["ciudad"] + (f" · {d['departamento']}" if d["departamento"] else "")
        ciudad = ciudad.upper()
        size_ciudad = _ajustar(ciudad, util, "Helvetica-Bold", 16 * k, c, 9 * k)
        c.setFont("Helvetica-Bold", size_ciudad)
        c.drawString(m * mm, (y_remit + 5 * k) * mm, ciudad)

        c.setLineWidth(0.7)
        c.line(m * mm, y_remit * mm, (ancho_mm - m) * mm, y_remit * mm)

        # ── Remitente
        y = y_remit - 5 * k
        c.setFont("Helvetica-Bold", 7 * k)
        c.drawString(m * mm, y * mm, "REMITENTE")
        y -= 5 * k
        c.setFont("Helvetica-Bold", 9 * k)
        c.drawString(m * mm, y * mm, remitente["nombre"].upper()[:46])
        y -= 4.6 * k
        c.setFont("Helvetica", 8 * k)
        # Dos renglones, no cuatro: la banda del remitente es estrecha y lo que
        # importa es que quepa completo, no que cada dato tenga su línea.
        for linea in [
            " · ".join(
                p for p in (
                    f"NIT: {remitente['nit']}" if remitente.get("nit") else "",
                    f"Teléfono: {remitente['telefono']}" if remitente.get("telefono") else "",
                ) if p
            ),
            " · ".join(
                p for p in (
                    remitente.get("direccion"),
                    remitente.get("ciudad"),
                    remitente.get("correo"),
                ) if p
            ),
        ]:
            if not linea:
                continue
            c.drawString(m * mm, y * mm, linea[:66])
            y -= 4.4 * k

        c.setLineWidth(0.7)
        c.line(m * mm, y_pie * mm, (ancho_mm - m) * mm, y_pie * mm)

        # ── Pie: piezas, transportadora y código de barras
        resumen = f"Piezas: {d['piezas']}"
        if d["peso_kg"]:
            resumen += f"   Peso: {d['peso_kg']} kg"
        pie = d["transportadora"] + (f" · Guía {d['guia']}" if d["guia"] else "")
        # Los dos textos comparten renglón: si no caben (rollos chicos, guías
        # largas) se achica la letra y, en último caso, se deja solo la guía —
        # antes se montaban uno encima del otro y no se leía ninguno.
        size_pie = 8.5 * k
        while size_pie > 6 * k and (
            c.stringWidth(resumen, "Helvetica-Bold", size_pie)
            + c.stringWidth(pie, "Helvetica-Bold", size_pie)
            + 3 * mm
        ) > util * mm:
            size_pie -= 0.4
        if (
            c.stringWidth(resumen, "Helvetica-Bold", size_pie)
            + c.stringWidth(pie, "Helvetica-Bold", size_pie)
            + 3 * mm
        ) > util * mm and d["guia"]:
            pie = f"Guía {d['guia']}"
        c.setFont("Helvetica-Bold", size_pie)
        c.drawString(m * mm, (y_pie - 5 * k) * mm, resumen)
        c.drawRightString((ancho_mm - m) * mm, (y_pie - 5 * k) * mm, pie[:40])

        codigo = d["guia"] or d["pedido_id"]
        if codigo:
            try:
                barra = code128.Code128(
                    codigo, barHeight=13 * k * mm, barWidth=0.38 * k * mm, humanReadable=False
                )
                ancho_barra = barra.width / mm
                barra.drawOn(c, max(m, (ancho_mm - ancho_barra) / 2) * mm, (m + 5.5 * k) * mm)
            except Exception:
                pass
            c.setFont("Helvetica-Bold", 8 * k)
            c.drawCentredString((ancho_mm / 2) * mm, (m + 1.5 * k) * mm, codigo[:30])

        c.showPage()

    c.save()
    return buf.getvalue()


def generar_desde_ids(ids: list[int], *, tamano: str = TAMANO_DEFAULT) -> bytes:
    registros = obtener_rotulos(ids)
    if not registros:
        raise ValueError("No se encontraron esos rótulos")
    paginas: list[dict[str, Any]] = []
    for r in registros:
        for _ in range(max(1, int(r.get("copias") or 1))):
            paginas.append(r["datos"])
    return generar_pdf(paginas, tamano=tamano)
