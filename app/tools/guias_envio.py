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
_LOGO = os.path.join(_ROOT, "DISENO CORPORATIVO ", "isotipo_final.png")

# Tamaños de rollo soportados (ancho x alto en mm). El de la Vretti es 10x15.
TAMANOS: dict[str, tuple[float, float]] = {
    "10x15": (100.0, 150.0),
    "10x10": (100.0, 100.0),
    "5x7.5": (50.0, 75.0),
}
TAMANO_DEFAULT = "10x15"

_REMITENTE_DEFAULT = {
    "nombre": "McKenna Group S.A.S.",
    "nit": "",
    "direccion": "",
    "ciudad": "Bogotá D.C.",
    "telefono": "",
    "correo": "",
    "nota": "Materias primas farmacéuticas y cosméticas",
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
    """Deja un rótulo listo para dibujar (manual o desde pedido)."""
    contenido = data.get("contenido")
    if isinstance(contenido, str):
        contenido = [c.strip() for c in contenido.splitlines() if c.strip()]
    nombre = str(data.get("nombre") or "").strip()
    if not nombre:
        raise ValueError("El rótulo necesita el nombre del destinatario")
    ciudad = str(data.get("ciudad") or "").strip()
    direccion = str(data.get("direccion") or "").strip()
    if not (ciudad and direccion):
        raise ValueError("El rótulo necesita dirección y ciudad de destino")
    try:
        valor = float(data.get("valor_declarado") or 0)
    except (TypeError, ValueError):
        valor = 0.0
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
        "contenido": [str(c)[:60] for c in (contenido or [])][:6],
        "piezas": max(1, int(data.get("piezas") or 1)),
        "peso_kg": str(data.get("peso_kg") or "").strip()[:10],
        "valor_declarado": round(valor, 2),
        "contra_entrega": bool(data.get("contra_entrega")),
        "guia": str(data.get("guia") or "").strip()[:40],
        "transportadora": str(data.get("transportadora") or "Interrapidísimo").strip()[:40],
    }


# ─── PDF del rótulo ─────────────────────────────────────────────────────────

def _cop(n: float) -> str:
    return "$ " + f"{int(round(n or 0)):,}".replace(",", ".")


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


def generar_pdf(rotulos: list[dict[str, Any]], *, tamano: str = TAMANO_DEFAULT) -> bytes:
    """Un rótulo por página, listo para mandar a la térmica sin escalar."""
    import io

    from reportlab.graphics.barcode import code128
    from reportlab.lib.units import mm
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas as rl_canvas

    if not rotulos:
        raise ValueError("No hay rótulos para imprimir")
    ancho_mm, alto_mm = TAMANOS.get(tamano, TAMANOS[TAMANO_DEFAULT])
    remitente = leer_remitente()
    # Un solo ImageReader para todas las páginas: así el PNG del isotipo se
    # incrusta una vez y no una copia por rótulo (un lote de 20 pesaba ~16 MB).
    logo = None
    if os.path.isfile(_LOGO):
        try:
            logo = ImageReader(_LOGO)
        except Exception:
            logo = None
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(ancho_mm * mm, alto_mm * mm))
    # Escala: el diseño está pensado para 10x15; en rollos menores se reduce
    # proporcionalmente el tamaño de letra para que todo siga cabiendo.
    k = min(ancho_mm / 100.0, alto_mm / 150.0)
    margen = 4.0

    for datos in rotulos:
        d = normalizar_datos(datos)
        c.setLineWidth(1.0)
        c.rect(
            (margen - 2) * mm,
            (margen - 2) * mm,
            (ancho_mm - 2 * (margen - 2)) * mm,
            (alto_mm - 2 * (margen - 2)) * mm,
        )
        y = alto_mm - margen

        # Encabezado: isotipo + remitente corto + referencia del pedido
        alto_head = 14.0 * k
        if logo is not None:
            try:
                c.drawImage(
                    logo,
                    margen * mm,
                    (y - alto_head) * mm,
                    width=alto_head * mm,
                    height=alto_head * mm,
                    mask="auto",
                    preserveAspectRatio=True,
                )
            except Exception:
                pass
        c.setFont("Helvetica-Bold", 10 * k)
        c.drawString((margen + alto_head + 2) * mm, (y - 5 * k) * mm, remitente["nombre"][:34])
        c.setFont("Helvetica", 6.5 * k)
        c.drawString((margen + alto_head + 2) * mm, (y - 9 * k) * mm, remitente.get("nota", "")[:46])
        c.setFont("Helvetica-Bold", 8 * k)
        c.drawRightString(
            (ancho_mm - margen) * mm, (y - 5 * k) * mm, d["pedido_id"][:22] or "ENVÍO"
        )
        c.setFont("Helvetica", 6.5 * k)
        c.drawRightString(
            (ancho_mm - margen) * mm,
            (y - 9 * k) * mm,
            datetime.now().strftime("%d/%m/%Y %H:%M"),
        )
        y -= alto_head + 2

        c.setLineWidth(1.2)
        c.line(margen * mm, y * mm, (ancho_mm - margen) * mm, y * mm)
        y -= 5 * k

        # Destinatario — el bloque que lee el mensajero
        c.setFont("Helvetica-Bold", 7 * k)
        c.drawString(margen * mm, y * mm, "DESTINATARIO")
        y -= 6 * k
        c.setFont("Helvetica-Bold", 14 * k)
        for linea in _wrap(d["nombre"], ancho_mm - 2 * margen, "Helvetica-Bold", 14 * k, c, 2):
            c.drawString(margen * mm, y * mm, linea)
            y -= 6 * k
        if d["documento"]:
            c.setFont("Helvetica", 8 * k)
            c.drawString(margen * mm, y * mm, f"CC/NIT {d['documento']}")
            y -= 4.5 * k
        if d["telefono"]:
            c.setFont("Helvetica-Bold", 12 * k)
            c.drawString(margen * mm, y * mm, f"Tel. {d['telefono']}")
            y -= 6 * k

        c.setFont("Helvetica-Bold", 12 * k)
        for linea in _wrap(d["direccion"], ancho_mm - 2 * margen, "Helvetica-Bold", 12 * k, c, 3):
            c.drawString(margen * mm, y * mm, linea)
            y -= 5.5 * k
        if d["observaciones"]:
            c.setFont("Helvetica-Oblique", 8 * k)
            for linea in _wrap(
                d["observaciones"], ancho_mm - 2 * margen, "Helvetica-Oblique", 8 * k, c, 2
            ):
                c.drawString(margen * mm, y * mm, linea)
                y -= 4 * k
        y -= 1 * k
        ciudad = d["ciudad"] + (f" · {d['departamento']}" if d["departamento"] else "")
        c.setFont("Helvetica-Bold", 15 * k)
        for linea in _wrap(ciudad.upper(), ancho_mm - 2 * margen, "Helvetica-Bold", 15 * k, c, 2):
            c.drawString(margen * mm, y * mm, linea)
            y -= 6.5 * k

        # El bloque inferior (remitente/contenido) arranca a una altura fija para
        # que un destinatario corto no deje un hueco en la mitad del rótulo; si
        # la dirección fue larga, sigue justo debajo de donde quedó.
        y = min(y - 2 * k, alto_mm * 0.46)
        c.setLineWidth(0.7)
        c.line(margen * mm, y * mm, (ancho_mm - margen) * mm, y * mm)
        y -= 5 * k

        # Remitente
        c.setFont("Helvetica-Bold", 7 * k)
        c.drawString(margen * mm, y * mm, "REMITENTE")
        y -= 4.5 * k
        c.setFont("Helvetica", 8 * k)
        partes = [remitente["nombre"]]
        if remitente.get("nit"):
            partes.append(f"NIT {remitente['nit']}")
        c.drawString(margen * mm, y * mm, " · ".join(partes)[:60])
        y -= 4 * k
        linea_rem = " · ".join(
            p for p in (remitente.get("direccion"), remitente.get("ciudad"), remitente.get("telefono")) if p
        )
        if linea_rem:
            c.drawString(margen * mm, y * mm, linea_rem[:60])
            y -= 4 * k

        # Contenido — solo las líneas que caben sin invadir el pie
        base = margen + 2
        tope_pie = base + 26 * k
        if d["contenido"]:
            y -= 1.5 * k
            c.setFont("Helvetica-Bold", 7 * k)
            c.drawString(margen * mm, y * mm, "CONTENIDO")
            y -= 4 * k
            c.setFont("Helvetica", 7.5 * k)
            restantes = list(d["contenido"])
            while restantes and y - 3.6 * k > tope_pie:
                linea = restantes.pop(0)
                if restantes and y - 7.2 * k <= tope_pie:
                    c.drawString(margen * mm, y * mm, f"• …y {len(restantes) + 1} ítem(s) más")
                    y -= 3.6 * k
                    restantes = []
                    break
                c.drawString(margen * mm, y * mm, f"• {linea}")
                y -= 3.6 * k

        # Piezas / peso / valor — anclado justo encima del pie
        c.setFont("Helvetica-Bold", 8.5 * k)
        resumen = [f"Piezas: {d['piezas']}"]
        if d["peso_kg"]:
            resumen.append(f"Peso: {d['peso_kg']} kg")
        if d["valor_declarado"] > 0:
            etiqueta = "A COBRAR" if d["contra_entrega"] else "Valor declarado"
            resumen.append(f"{etiqueta}: {_cop(d['valor_declarado'])}")
        c.drawString(margen * mm, (tope_pie + 1.5 * k) * mm, "   ".join(resumen)[:64])

        # Pie: transportadora, guía y código de barras
        codigo = d["guia"] or d["pedido_id"]
        if codigo:
            try:
                barra = code128.Code128(
                    codigo, barHeight=13 * k * mm, barWidth=0.38 * k * mm, humanReadable=False
                )
                ancho_barra = barra.width / mm
                barra.drawOn(
                    c, max(margen, (ancho_mm - ancho_barra) / 2) * mm, (base + 5 * k) * mm
                )
            except Exception:
                pass
            c.setFont("Helvetica-Bold", 8 * k)
            c.drawCentredString((ancho_mm / 2) * mm, (base + 1.5 * k) * mm, codigo[:30])
        c.setFont("Helvetica-Bold", 8 * k)
        pie = d["transportadora"] + (f" · Guía {d['guia']}" if d["guia"] else "")
        c.drawString(margen * mm, (base + 20 * k) * mm, pie[:52])

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
