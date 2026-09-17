"""
Ventas directas por WhatsApp: cotizar y facturar desde /app, no desde Alegra.

Por qué existe (16-sep-2026): Jenniffer cotizaba directamente en la interfaz de
Alegra y el total salía con el IVA sumado dos veces. La causa no es de ella: la
lista de precios de Alegra guarda el precio FINAL (con IVA), porque
`precios_canales` y `precios_trm` le copian el precio de MeLi, y además cada
ítem trae su IVA del 19%. La interfaz de Alegra toma ese precio como base y le
vuelve a sumar el impuesto — LECITINA SOYA 500g: lista $19.800 → la cotización
sugiere $23.562. Nuestras facturas por API no sufren esto porque
`crear_factura_venta_alegra` descuenta el IVA antes de mandar el precio
(`_precio_base_con_impuesto`); este módulo hace lo mismo para la cotización.

Una venta directa vive aquí de principio a fin:

    borrador → cotizada → facturada        (o anulada)

- El precio que escribe el asesor es SIEMPRE el que paga el cliente (IVA
  incluido). El IVA sale línea por línea de la ficha del producto en Alegra —
  no una sola tasa para todo el documento, que era lo que hacía la versión
  anterior del panel con productos exentos mezclados.
- La cotización se registra también en Alegra (`POST /estimates`) con el precio
  base, para que la numeración y el historial sigan donde el contador los ve.
  Si Alegra falla, el PDF igual sale y el aviso queda en la venta.
- Facturar una venta ya facturada se rechaza aquí, antes de llegar a la DIAN
  (una factura electrónica solo se corrige con nota crédito).

Fuentes para arrancar una venta (el paso 1 del wizard):
  manual · pedido armado por el agente IA de WhatsApp (`ventas_wa`) ·
  conversación de WhatsApp (extracción con IA, gateada por llm_budget en
  `extraccion_cotizacion_wa`).

Sin LLM en este módulo.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

_DB = os.getenv(
    "VENTAS_DIRECTAS_DB",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "ventas_directas.db"),
)
_lock = threading.Lock()

# "facturando" es transitorio: la factura se pidió a Alegra y aún no volvió.
ESTADOS = ("borrador", "cotizada", "facturando", "facturada", "anulada")
ORIGENES = ("manual", "pedido_ia", "conversacion")
VIGENCIA_DIAS = int(os.getenv("VENTAS_DIRECTAS_VIGENCIA_DIAS", "15"))
ENVIO_SKU_GENERICO = os.getenv("WEB_SIIGO_SHIPPING_CODE_GENERIC", "WEB-ENVIO-VAR").strip() or "WEB-ENVIO-VAR"


def _conn() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(_DB), exist_ok=True)
    c = sqlite3.connect(_DB, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute(
        """CREATE TABLE IF NOT EXISTS ventas_directas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            numero TEXT NOT NULL UNIQUE,
            estado TEXT NOT NULL DEFAULT 'borrador',
            origen TEXT NOT NULL DEFAULT 'manual',
            origen_ref TEXT NOT NULL DEFAULT '',
            cliente TEXT NOT NULL DEFAULT '{}',
            telefono TEXT NOT NULL DEFAULT '',
            lineas TEXT NOT NULL DEFAULT '[]',
            envio REAL NOT NULL DEFAULT 0,
            subtotal REAL NOT NULL DEFAULT 0,
            iva REAL NOT NULL DEFAULT 0,
            total REAL NOT NULL DEFAULT 0,
            notas TEXT NOT NULL DEFAULT '',
            medio_pago TEXT NOT NULL DEFAULT '',
            alegra_cotizacion_id TEXT,
            alegra_cotizacion_numero TEXT,
            factura_id TEXT,
            factura_numero TEXT,
            factura_cufe TEXT,
            factura_url TEXT,
            enviado_whatsapp INTEGER NOT NULL DEFAULT 0,
            avisos TEXT NOT NULL DEFAULT '[]',
            creado_por TEXT NOT NULL DEFAULT '',
            facturado_por TEXT NOT NULL DEFAULT '',
            creado TEXT NOT NULL,
            actualizado TEXT NOT NULL,
            cotizado TEXT,
            facturado TEXT
        )"""
    )
    c.execute("CREATE INDEX IF NOT EXISTS ix_vd_estado ON ventas_directas(estado, actualizado)")
    c.execute("CREATE INDEX IF NOT EXISTS ix_vd_origen ON ventas_directas(origen, origen_ref)")
    return c


def _ahora() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _redondear(v: float, nd: int = 2) -> float:
    q = Decimal("1") if nd == 0 else Decimal("1." + "0" * nd)
    return float(Decimal(str(v)).quantize(q, rounding=ROUND_HALF_UP))


# --------------------------------------------------------------------------- cálculo


def _producto_alegra(codigo: str) -> dict | None:
    from app.services.alegra import resolver_producto_venta_alegra

    try:
        return resolver_producto_venta_alegra(codigo)
    except Exception:
        return None


def calcular(lineas: list[dict], envio: float = 0, *, resolver=None) -> dict:
    """Totales de una venta con el IVA de CADA producto según Alegra.

    `lineas`: [{codigo, nombre, cantidad, precio_unitario}] con el precio que paga
    el cliente (IVA incluido). Devuelve las líneas enriquecidas (iva_pct, base
    unitaria, iva y total de la línea, existe_en_alegra) + subtotal/iva/total.
    No lanza por un SKU desconocido: lo marca, y facturar lo rechaza después.
    """
    resolver = resolver or _producto_alegra
    salida: list[dict] = []
    subtotal = iva = total = 0.0
    errores: list[str] = []
    for i, ln in enumerate(lineas or []):
        codigo = str(ln.get("codigo") or "").strip()
        nombre = str(ln.get("nombre") or codigo or "Producto").strip()
        try:
            cantidad = float(ln.get("cantidad") or 0)
            precio = float(ln.get("precio_unitario") or 0)
        except (TypeError, ValueError):
            errores.append(f"Línea {i + 1}: cantidad o precio no numérico.")
            continue
        if cantidad <= 0 or precio < 0:
            errores.append(f"Línea {i + 1} ({nombre}): cantidad debe ser > 0 y precio ≥ 0.")
            continue
        prod = resolver(codigo) if codigo else None
        tasa = float((prod or {}).get("tax_rate_total") or 0) if (prod or {}).get("tax_ids") else 0.0
        base_unit = precio / (1 + tasa / 100) if tasa else precio
        linea_total = cantidad * precio
        linea_base = cantidad * base_unit
        salida.append({
            "codigo": codigo,
            "nombre": nombre,
            "cantidad": cantidad,
            "precio_unitario": precio,
            "iva_pct": tasa,
            "base_unitaria": _redondear(base_unit),
            "base": _redondear(linea_base),
            "iva": _redondear(linea_total - linea_base),
            "total": _redondear(linea_total),
            "existe_en_alegra": bool(prod),
            "alias_de": (prod or {}).get("alias_de") or "",
        })
        subtotal += linea_base
        iva += linea_total - linea_base
        total += linea_total

    try:
        envio = max(0.0, float(envio or 0))
    except (TypeError, ValueError):
        envio = 0.0
    if envio:
        subtotal += envio
        total += envio

    return {
        "lineas": salida,
        "envio": _redondear(envio),
        "subtotal": _redondear(subtotal),
        "iva": _redondear(iva),
        "total": _redondear(total),
        "errores": errores,
        "sin_alegra": [ln["codigo"] or ln["nombre"] for ln in salida if not ln["existe_en_alegra"]],
    }


def _lineas_para_documento(calc: dict) -> list[dict]:
    """Líneas en el shape de `crear_factura_venta_alegra` — el envío va como un
    producto más (sin IVA), igual que en los pedidos web."""
    out = [
        {"codigo": ln["codigo"], "nombre": ln["nombre"], "cantidad": ln["cantidad"],
         "precio_unitario": ln["precio_unitario"]}
        for ln in calc["lineas"]
    ]
    if calc["envio"]:
        out.append({"codigo": _sku_envio(calc["envio"]), "nombre": "Envío",
                    "cantidad": 1, "precio_unitario": calc["envio"]})
    return out


def _sku_envio(valor: float) -> str:
    """Mismo criterio que los pedidos web: producto propio por monto si existe,
    si no el genérico de precio variable."""
    propio = f"WEB-ENVIO-{int(round(valor))}"
    return propio if _producto_alegra(propio) else ENVIO_SKU_GENERICO


# --------------------------------------------------------------------------- persistencia


def _fila(r: sqlite3.Row | None) -> dict | None:
    if r is None:
        return None
    d = dict(r)
    for k in ("cliente", "lineas", "avisos"):
        try:
            d[k] = json.loads(d.get(k) or ("{}" if k == "cliente" else "[]"))
        except ValueError:
            d[k] = {} if k == "cliente" else []
    d["enviado_whatsapp"] = bool(d.get("enviado_whatsapp"))
    return d


def obtener(venta_id: int) -> dict | None:
    with _lock, _conn() as c:
        return _fila(c.execute("SELECT * FROM ventas_directas WHERE id=?", (int(venta_id),)).fetchone())


def listar(estado: str = "", q: str = "", limite: int = 50) -> list[dict]:
    sql = "SELECT * FROM ventas_directas WHERE 1=1"
    args: list = []
    if estado in ESTADOS:
        sql += " AND estado=?"
        args.append(estado)
    if q:
        sql += " AND (numero LIKE ? OR cliente LIKE ? OR telefono LIKE ? OR factura_numero LIKE ?)"
        args += [f"%{q}%"] * 4
    sql += " ORDER BY actualizado DESC LIMIT ?"
    args.append(max(1, min(int(limite), 200)))
    with _lock, _conn() as c:
        return [_fila(r) for r in c.execute(sql, args).fetchall()]


def _numero_nuevo(c: sqlite3.Connection) -> str:
    base = f"COT-{datetime.now():%Y%m%d}"
    n = c.execute("SELECT COUNT(*) FROM ventas_directas WHERE numero LIKE ?", (base + "-%",)).fetchone()[0]
    return f"{base}-{n + 1:03d}"


def guardar(datos: dict, *, usuario: str = "", venta_id: int | None = None) -> dict:
    """Crea o actualiza un borrador/cotización. Una venta facturada o anulada
    ya no se edita: el documento que recibió el cliente tiene que coincidir con
    lo guardado."""
    origen = str(datos.get("origen") or "manual")
    if origen not in ORIGENES:
        origen = "manual"
    cliente = {k: str((datos.get("cliente") or {}).get(k) or "").strip()
               for k in ("nombre", "identificacion", "correo", "direccion", "ciudad")}
    calc = calcular(datos.get("lineas") or datos.get("productos") or [], datos.get("envio") or 0)
    ahora = _ahora()
    campos = {
        "origen": origen,
        "origen_ref": str(datos.get("origen_ref") or "")[:120],
        "cliente": json.dumps(cliente, ensure_ascii=False),
        "telefono": str(datos.get("telefono") or "").strip(),
        "lineas": json.dumps(calc["lineas"], ensure_ascii=False),
        "envio": calc["envio"],
        "subtotal": calc["subtotal"],
        "iva": calc["iva"],
        "total": calc["total"],
        "notas": str(datos.get("notas") or "")[:1000],
        "medio_pago": str(datos.get("medio_pago") or "")[:40],
        "actualizado": ahora,
    }
    with _lock, _conn() as c:
        if venta_id:
            actual = c.execute("SELECT estado FROM ventas_directas WHERE id=?", (int(venta_id),)).fetchone()
            if not actual:
                raise ValueError("La venta no existe.")
            if actual["estado"] in ("facturada", "anulada"):
                raise ValueError(f"La venta está {actual['estado']}; ya no se puede editar.")
            sets = ", ".join(f"{k}=?" for k in campos)
            c.execute(f"UPDATE ventas_directas SET {sets} WHERE id=?", [*campos.values(), int(venta_id)])
            vid = int(venta_id)
        else:
            campos.update({"numero": _numero_nuevo(c), "estado": "borrador", "creado": ahora,
                           "creado_por": usuario or ""})
            cols = ", ".join(campos)
            cur = c.execute(
                f"INSERT INTO ventas_directas ({cols}) VALUES ({', '.join('?' * len(campos))})",
                list(campos.values()),
            )
            vid = int(cur.lastrowid)
    venta = obtener(vid)
    venta["errores"] = calc["errores"]
    venta["sin_alegra"] = calc["sin_alegra"]
    return venta


def _actualizar(venta_id: int, **campos) -> None:
    for k in ("avisos",):
        if k in campos and not isinstance(campos[k], str):
            campos[k] = json.dumps(campos[k], ensure_ascii=False)
    campos["actualizado"] = _ahora()
    sets = ", ".join(f"{k}=?" for k in campos)
    with _lock, _conn() as c:
        c.execute(f"UPDATE ventas_directas SET {sets} WHERE id=?", [*campos.values(), int(venta_id)])


def anular(venta_id: int) -> dict:
    venta = obtener(venta_id)
    if not venta:
        return {"ok": False, "error": "La venta no existe."}
    if venta["estado"] == "facturada":
        return {"ok": False, "error": "Ya tiene factura electrónica: se anula con nota crédito, no desde aquí."}
    _actualizar(venta_id, estado="anulada")
    return {"ok": True}


# --------------------------------------------------------------------------- Alegra


def crear_cotizacion_alegra(venta: dict) -> dict:
    """Registra la cotización en Alegra (`POST /estimates`) con precio BASE.

    Alegra suma el IVA del ítem encima del precio que recibe; si le mandamos el
    precio final, sale duplicado — exactamente el error que se veía al cotizar a
    mano en la interfaz de Alegra."""
    import requests

    from app.services.alegra import (
        _ALEGRA_BASE,
        _alegra_headers,
        _resolver_o_crear_contacto_alegra,
    )

    cli = venta.get("cliente") or {}
    ident = "".join(ch for ch in str(cli.get("identificacion") or "") if ch.isdigit())
    if not ident:
        return {"ok": False, "error": "Sin identificación: la cotización no se registra en Alegra (el PDF sí sale)."}
    try:
        headers = _alegra_headers()
    except RuntimeError as e:
        return {"ok": False, "error": str(e)}
    contacto_id, err = _resolver_o_crear_contacto_alegra(
        nombre=cli.get("nombre") or "", identificacion=ident, email=cli.get("correo") or "",
        telefono=venta.get("telefono") or "", direccion=cli.get("direccion") or "",
    )
    if not contacto_id:
        return {"ok": False, "error": f"No se pudo resolver el cliente en Alegra. {err or ''}".strip()}

    items = []
    calc = calcular(venta.get("lineas") or [], venta.get("envio") or 0)
    for ln in _lineas_para_documento(calc):
        prod = _producto_alegra(ln["codigo"])
        if not prod:
            return {"ok": False, "error": f"{ln['nombre']} ({ln['codigo']}) no existe en Alegra."}
        tax_ids = prod.get("tax_ids") or []
        tasa = float(prod.get("tax_rate_total") or 0) if tax_ids else 0.0
        precio = float(ln["precio_unitario"])
        item = {
            "id": prod["id"],
            "price": _redondear(precio / (1 + tasa / 100)) if tasa else precio,
            "quantity": ln["cantidad"],
        }
        if tax_ids:
            item["tax"] = [{"id": t} for t in tax_ids]
        items.append(item)

    hoy = datetime.now()
    payload = {
        "date": hoy.strftime("%Y-%m-%d"),
        "dueDate": (hoy + timedelta(days=VIGENCIA_DIAS)).strftime("%Y-%m-%d"),
        "client": {"id": contacto_id},
        "items": items,
        "observations": f"Venta directa WhatsApp · {venta.get('numero')}"[:500],
    }
    if venta.get("notas"):
        payload["anotation"] = str(venta["notas"])[:500]
    try:
        res = requests.post(f"{_ALEGRA_BASE}/estimates", headers=headers, json=payload, timeout=20)
    except requests.RequestException as e:
        return {"ok": False, "error": f"Error de red con Alegra: {e}"}
    if res.status_code not in (200, 201):
        return {"ok": False, "error": f"Alegra rechazó la cotización ({res.status_code}): {res.text[:300]}"}
    est = res.json() or {}
    total_alegra = float(est.get("total") or 0)
    out = {
        "ok": True,
        "id": str(est.get("id") or ""),
        "numero": str((est.get("numberTemplate") or {}).get("fullNumber") or est.get("number") or ""),
        "total": total_alegra,
    }
    # Control: Alegra redondea por línea; más de $5 de diferencia es otra cosa
    # (un IVA mal configurado en el ítem) y hay que verlo antes de mandarla.
    if total_alegra and abs(total_alegra - float(venta.get("total") or 0)) > 5:
        out["aviso"] = (
            f"Alegra calculó ${total_alegra:,.0f} y la app ${float(venta.get('total') or 0):,.0f}: "
            "revisa el IVA de los productos en Alegra."
        )
    return out


# --------------------------------------------------------------------------- acciones


def _jid(telefono: str) -> str | None:
    from app.tools.facturacion_directa import _telefono_a_jid

    return _telefono_a_jid(telefono)


def cotizar(venta_id: int, *, enviar_whatsapp: bool = True, registrar_en_alegra: bool = True) -> dict:
    """PDF de cotización (sin DIAN) + registro en Alegra + envío al cliente."""
    from app.tools.cotizacion_pdf import generar_cotizacion_pdf

    venta = obtener(venta_id)
    if not venta:
        return {"ok": False, "error": "La venta no existe."}
    if venta["estado"] in ("facturada", "anulada"):
        return {"ok": False, "error": f"La venta está {venta['estado']}."}
    if not venta["lineas"]:
        return {"ok": False, "error": "La cotización no tiene productos."}
    jid = _jid(venta["telefono"]) if enviar_whatsapp else None
    if enviar_whatsapp and not jid:
        return {"ok": False, "error": f"Teléfono inválido: {venta['telefono']!r}."}

    avisos: list[str] = []
    campos: dict = {}
    if registrar_en_alegra and not venta.get("alegra_cotizacion_id"):
        r = crear_cotizacion_alegra(venta)
        if r.get("ok"):
            campos.update(alegra_cotizacion_id=r["id"], alegra_cotizacion_numero=r["numero"])
            if r.get("aviso"):
                avisos.append(r["aviso"])
        else:
            avisos.append(f"Alegra: {r.get('error')}")

    cli = venta["cliente"]
    doc = {
        "numero": venta["numero"],
        "fecha": datetime.now().strftime("%d/%m/%Y"),
        "cliente": {"nombre": cli.get("nombre") or "Cliente", "nit": cli.get("identificacion") or "",
                    "correo": cli.get("correo") or "", "direccion": cli.get("direccion") or ""},
        "productos": [
            {"nombre": ln["nombre"], "sku": ln["codigo"], "cantidad": ln["cantidad"],
             "precio_unit": ln["precio_unitario"], "subtotal": ln["total"]}
            for ln in venta["lineas"]
        ] + ([{"nombre": "Envío", "sku": "", "cantidad": 1, "precio_unit": venta["envio"],
               "subtotal": venta["envio"]}] if venta["envio"] else []),
        "subtotal": venta["subtotal"],
        "iva": venta["iva"],
        "total": venta["total"],
        "notas": venta["notas"],
    }
    try:
        ruta = generar_cotizacion_pdf(doc)
    except Exception as e:
        return {"ok": False, "error": f"No se pudo generar el PDF: {e}"}

    enviado = False
    if jid:
        from app.utils import enviar_whatsapp_archivo

        caption = (
            f"📋 *Cotización {venta['numero']}*\n"
            f"👤 {doc['cliente']['nombre']}\n"
            f"💵 Total: *${venta['total']:,.0f} COP* (IVA incluido)\n\n"
            f"📌 Válida por {VIGENCIA_DIAS} días. Cuando realice el pago, envíenos el "
            f"comprobante para emitir la factura electrónica y despachar."
        )
        enviado = bool(enviar_whatsapp_archivo(ruta, caption, numero_destino=jid))
        if not enviado:
            avisos.append("El PDF no se pudo enviar por WhatsApp — compártelo a mano.")

    campos.update(estado="cotizada", cotizado=_ahora(), enviado_whatsapp=int(enviado),
                  avisos=(venta.get("avisos") or []) + avisos)
    _actualizar(venta_id, **campos)
    return {"ok": True, "venta": obtener(venta_id), "pdf_path": ruta, "avisos": avisos,
            "enviado_whatsapp": enviado}


def facturar(venta_id: int, *, usuario: str = "", medio_pago: str = "", enviar_whatsapp: bool = True) -> dict:
    """Factura electrónica real en Alegra (DIAN) a partir de la venta guardada."""
    from app.services.alegra import crear_factura_venta_alegra

    venta = obtener(venta_id)
    if not venta:
        return {"ok": False, "error": "La venta no existe."}
    if venta["estado"] == "facturada" or venta.get("factura_id"):
        return {"ok": False, "error": f"Esta venta ya tiene la factura {venta.get('factura_numero')}."}
    if venta["estado"] == "anulada":
        return {"ok": False, "error": "La venta está anulada."}
    cli = venta["cliente"]
    if not (cli.get("nombre") or "").strip() or not (cli.get("identificacion") or "").strip():
        return {"ok": False, "error": "Faltan nombre o identificación del cliente — obligatorios para facturar."}
    calc = calcular(venta["lineas"], venta["envio"])
    if calc["errores"]:
        return {"ok": False, "error": " ".join(calc["errores"])}
    if calc["sin_alegra"]:
        return {"ok": False, "error": "No existen en Alegra: " + ", ".join(calc["sin_alegra"])}
    jid = _jid(venta["telefono"]) if enviar_whatsapp else None
    if enviar_whatsapp and not jid:
        return {"ok": False, "error": f"Teléfono inválido: {venta['telefono']!r}."}

    # Se marca antes de llamar a Alegra: si el proceso muere entre la factura y
    # la respuesta, un segundo clic no debe emitir otra (pasó con FE275/278/295).
    with _lock, _conn() as c:
        cur = c.execute(
            "UPDATE ventas_directas SET estado='facturando', actualizado=? WHERE id=? AND estado IN ('borrador','cotizada')",
            (_ahora(), int(venta_id)),
        )
        if cur.rowcount == 0:
            return {"ok": False, "error": "La venta se está facturando en otra pestaña o cambió de estado."}

    medio = medio_pago or venta.get("medio_pago") or ""
    ref = venta["numero"]
    try:
        res = crear_factura_venta_alegra(
            nombre_cliente=cli["nombre"],
            identificacion=cli["identificacion"],
            direccion_envio=cli.get("direccion") or "",
            productos=_lineas_para_documento(calc),
            total=calc["total"],
            email=cli.get("correo") or "",
            telefono=venta["telefono"],
            observaciones=f"Venta directa WhatsApp — {ref}.",
            purchase_order=ref,
            medio_pago=medio,
            descargar_pdf=True,
            enviar_dian=True,
            enviar_correo=False,
        )
    except Exception as e:
        res = {"ok": False, "error": f"Error inesperado: {e}"}

    if not res.get("ok"):
        # Sin factura creada: vuelve a su estado anterior para poder corregir y reintentar.
        _actualizar(venta_id, estado=venta["estado"])
        return {"ok": False, "error": res.get("error") or "Alegra no emitió la factura."}

    numero = str(res.get("number") or res.get("invoice_id") or "")
    avisos = [f"DIAN: {a}" for a in (res.get("avisos_dian") or [])]
    enviado = False
    if jid and res.get("pdf_path"):
        from app.utils import enviar_whatsapp_archivo

        caption = (
            f"🧾 *Factura electrónica {numero}*\n"
            f"👤 {cli['nombre']}\n"
            f"💵 Total: *${calc['total']:,.0f} COP*"
        )
        enviado = bool(enviar_whatsapp_archivo(res["pdf_path"], caption, numero_destino=jid))
    if jid and not enviado:
        avisos.append("La factura quedó emitida pero el PDF no llegó por WhatsApp — envíalo a mano.")

    _actualizar(
        venta_id, estado="facturada", facturado=_ahora(), facturado_por=usuario or "",
        factura_id=str(res.get("invoice_id") or ""), factura_numero=numero,
        factura_cufe=res.get("cufe") or "", factura_url=res.get("url") or "",
        medio_pago=medio, enviado_whatsapp=int(enviado or venta["enviado_whatsapp"]),
        avisos=(venta.get("avisos") or []) + avisos,
    )
    _cerrar_pedido_origen(venta)
    try:
        from app.utils import enviar_whatsapp_reporte, jid_grupo_facturacion_ventas_wa

        enviar_whatsapp_reporte(
            f"🧾 *Venta directa facturada* {numero} — {cli['nombre']} — ${calc['total']:,.0f} COP ({ref})"
            + (f"\n⚠️ {' · '.join(avisos)}" if avisos else ""),
            numero_destino=jid_grupo_facturacion_ventas_wa(),
        )
    except Exception:
        pass
    return {"ok": True, "venta": obtener(venta_id), "avisos": avisos, "enviado_whatsapp": enviado}


def _cerrar_pedido_origen(venta: dict) -> None:
    """Un pedido del agente IA que ya se facturó deja de aparecer como pendiente."""
    if venta.get("origen") != "pedido_ia" or not str(venta.get("origen_ref") or "").isdigit():
        return
    try:
        from app.agent.ventas_wa import pedido as ped

        ped.cambiar_estado("activo", int(venta["origen_ref"]), "cerrado")
    except Exception:
        pass


# --------------------------------------------------------------------------- fuentes


def pedidos_ia_para_facturar(dias: int = 14) -> list[dict]:
    """Pedidos REALES del agente IA (nunca los de sombra: el cliente no los vio)
    que tienen productos, con la venta directa ya creada a partir de ellos si existe."""
    try:
        from app.agent.ventas_wa import pedido as ped

        pedidos = ped.listar_para_panel("activo", dias=dias)
    except Exception:
        return []
    with _lock, _conn() as c:
        ya = {
            r["origen_ref"]: dict(r)
            for r in c.execute(
                "SELECT id, numero, estado, origen_ref FROM ventas_directas WHERE origen='pedido_ia' AND estado!='anulada'"
            ).fetchall()
        }
    out = []
    for p in pedidos:
        if not p.get("items") or p.get("estado") in ("cancelado",):
            continue
        p["venta_directa"] = ya.get(str(p["id"]))
        out.append(p)
    return out


def venta_desde_pedido_ia(pedido: dict) -> dict:
    """Traduce un pedido del agente IA al formato del wizard (precios de la web,
    que es lo que el bot le cotizó al cliente)."""
    cli = pedido.get("cliente") or {}
    # El chat del pedido es el destino más seguro (puede ser @lid, que no tiene
    # número visible); el teléfono que dictó el cliente solo si no hay chat.
    telefono = str(pedido.get("jid") or "") or str(cli.get("telefono") or "")
    direccion = ", ".join(x for x in (cli.get("direccion"), cli.get("ciudad"), cli.get("departamento")) if x)
    return {
        "origen": "pedido_ia",
        "origen_ref": str(pedido.get("id")),
        "cliente": {"nombre": cli.get("nombre") or "", "identificacion": cli.get("documento") or "",
                    "correo": cli.get("correo") or "", "direccion": direccion, "ciudad": cli.get("ciudad") or ""},
        "telefono": telefono,
        "lineas": [{"codigo": i["ref"], "nombre": i["nombre"], "cantidad": i["cantidad"],
                    "precio_unitario": i["precio"]} for i in pedido.get("items") or []],
        "envio": pedido.get("envio") or 0,
        "notas": "",
    }


def precio_sugerido(codigo: str) -> dict:
    """Precio para una línea nueva: el de la PÁGINA WEB (decisión del negocio
    para WhatsApp, 11-sep-2026) y, de referencia, el de lista de Alegra/MeLi.
    Ambos ya traen el IVA incluido."""
    web = None
    try:
        from app.agent.ventas_wa.catalogo import cargar

        pres = cargar().obtener(codigo)
        if pres:
            web = pres.precio
    except Exception:
        pass
    prod = _producto_alegra(codigo) or {}
    lista = float(prod.get("price") or 0) or None
    tasa = float(prod.get("tax_rate_total") or 0) if prod.get("tax_ids") else 0.0
    return {
        "codigo": codigo,
        "precio_web": web,
        "precio_lista": lista,
        "precio": web or lista or 0,
        "iva_pct": tasa,
        "existe_en_alegra": bool(prod),
    }
