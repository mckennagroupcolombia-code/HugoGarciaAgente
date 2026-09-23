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
import re
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
ORIGENES = ("manual", "pedido_ia", "conversacion", "meli")
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
               for k in ("nombre", "identificacion", "tipo_documento", "correo", "direccion", "ciudad")}
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
    tipo_doc, ident, err_ident = identificacion_fiscal(cli)
    if err_ident:
        return {"ok": False, "error": err_ident}
    if not ident:
        return {"ok": False, "error": "Sin identificación: la cotización no se registra en Alegra (el PDF sí sale)."}
    try:
        headers = _alegra_headers()
    except RuntimeError as e:
        return {"ok": False, "error": str(e)}
    contacto_id, err = _resolver_o_crear_contacto_alegra(
        nombre=cli.get("nombre") or "", identificacion=ident, email=cli.get("correo") or "",
        telefono=venta.get("telefono") or "", direccion=cli.get("direccion") or "",
        tipo_documento=tipo_doc,
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


_EMPRESA = re.compile(
    r"\b(S\.?\s?A\.?\s?S|S\.?\s?A|LTDA|E\.?\s?U|S\.?\s?C\.?\s?A|SOCIEDAD|FUNDACI[OÓ]N|CORPORACI[OÓ]N|"
    r"UNIVERSIDAD|ASOCIACI[OÓ]N|COOPERATIVA|INSTITUTO|CL[IÍ]NICA|HOSPITAL|COLEGIO|EMPRESA)\b\.?",
    re.I,
)


def identificacion_fiscal(cliente: dict) -> tuple[str, str, str | None]:
    """(tipo_documento, identificación, error) para Alegra.

    Sin tipo, Alegra lo adivina por longitud y un NIT de empresa de 9-10 dígitos
    queda como CC: EQUISURE S.A.S (FE465) salió así. Se toma el tipo elegido en
    el panel; si no hay, es NIT cuando el nombre es de empresa o el número tiene
    forma de NIT (9-10 dígitos que empiezan en 8 o 9). Un NIT con DV (con guion,
    o 10 dígitos como lo entrega MeLi) se comprueba con el algoritmo de la DIAN.
    """
    from app.services.empresa import digito_verificacion

    crudo = str(cliente.get("identificacion") or "").strip()
    digitos = re.sub(r"\D", "", crudo)
    tipo = str(cliente.get("tipo_documento") or "").strip().upper()
    if tipo not in ("NIT", "CC"):
        forma_nit = len(digitos) in (9, 10) and digitos[:1] in ("8", "9")
        tipo = "NIT" if (_EMPRESA.search(cliente.get("nombre") or "") or forma_nit) else "CC"
    if tipo != "NIT" or not digitos:
        return tipo, digitos, None
    if "-" in crudo:
        base, _, dv = crudo.rpartition("-")
        base, dv = re.sub(r"\D", "", base), re.sub(r"\D", "", dv)
        if dv and digito_verificacion(base) != int(dv):
            return tipo, digitos, (f"El NIT {crudo} no cuadra: a {base} le corresponde el dígito de verificación "
                                   f"{digito_verificacion(base)}. Revísalo en el RUT.")
        return tipo, base, None  # Alegra quiere la base y calcula el DV
    if len(digitos) == 10 and digito_verificacion(digitos[:-1]) != int(digitos[-1]):
        return tipo, digitos, (f"El NIT {digitos} tiene 10 dígitos pero el último no es su dígito de verificación. "
                               "Escríbelo como en el RUT: 900409216-6.")
    return tipo, (digitos[:-1] if len(digitos) == 10 else digitos), None


def _jid(telefono: str) -> str | None:
    from app.tools.facturacion_directa import _telefono_a_jid

    return _telefono_a_jid(telefono)


def _destino_whatsapp(telefono: str, enviar: bool) -> tuple[str | None, str | None]:
    """(jid, error). Sin teléfono (una venta de MeLi no lo trae: el operador ponía
    «.» y la factura nunca salía) no se envía por WhatsApp y se sigue. Un número
    escrito pero mal formado sí detiene: probablemente es un error de digitación."""
    if not enviar:
        return None, None
    jid = _jid(telefono)
    if jid:
        return jid, None
    if not re.sub(r"\D", "", telefono or ""):
        return None, None
    return None, f"Teléfono inválido: {telefono!r} (10 dígitos empezando en 3, o déjalo vacío)."


# ── Venta de Mercado Libre facturada desde aquí ──────────────────────────────
# Caso recurrente: una empresa compra en MeLi y manda el RUT pidiendo factura con
# sus datos. Se factura por este wizard, pero la factura queda ligada al PACK
# (purchase_order = pack_id, igual que «Facturar ahora»): así ninguna de las dos
# vías emite una segunda factura y el PDF queda subido en la venta de MeLi.


def _claves_meli(ref: str) -> dict:
    """Pack u orden → {pack_id, order_ids, orden}. Error si MeLi no la encuentra."""
    from app.tools.meli_autofactura_entrega import consultar_orden_meli_completa, consultar_pack_meli

    ref = re.sub(r"\D", "", str(ref or ""))
    if not ref:
        return {"ok": False, "error": "Escribe el número de la venta de MeLi (pack u orden)."}
    orden = consultar_orden_meli_completa(ref)
    pack = None
    if not orden:
        pack = consultar_pack_meli(ref)
        oid = str((((pack or {}).get("orders") or [{}])[0]).get("id") or "")
        orden = consultar_orden_meli_completa(oid) if oid else None
    if not orden:
        return {"ok": False, "error": f"MeLi no encontró la venta {ref}."}
    pack_id = str(orden.get("pack_id") or orden.get("id"))
    if pack is None and pack_id != str(orden.get("id")):
        pack = consultar_pack_meli(pack_id)
    order_ids = [str(o.get("id")) for o in (pack or {}).get("orders") or [] if o.get("id")]
    if str(orden.get("id")) not in order_ids:
        order_ids.append(str(orden.get("id")))
    return {"ok": True, "pack_id": pack_id, "order_ids": order_ids, "orden": orden}


def _bloqueo_meli(pack_id: str, order_ids: list[str], *, revisar_alegra: bool = True) -> str | None:
    """Las mismas barreras de «Facturar ahora»: si algo ya facturó esta venta, no se emite.
    Revisar Alegra tarda ~30 s (dos páginas de /invoices): al consultar la venta se
    omite y se hace siempre justo antes de emitir."""
    from app.services.meli import meli_pack_tiene_documento_fiscal
    from app.tools.meli_autofactura_entrega import (
        _ESTADOS_TERMINALES,
        _estado_existente_orden,
        _facturas_alegra_existentes,
    )

    for oid in order_ids:
        previo = _estado_existente_orden(oid) or {}
        if previo.get("estado") in _ESTADOS_TERMINALES:
            return (f"La orden {oid} de esa venta ya está {previo.get('estado')!r} "
                    f"({previo.get('siigo_invoice_number') or 'sin número'}). No se emite otra factura.")
    if meli_pack_tiene_documento_fiscal(pack_id):
        return (f"La venta {pack_id} ya tiene un documento fiscal cargado en MeLi. "
                "Si esa factura está mal, primero anúlala con nota crédito.")
    if not revisar_alegra:
        return None
    try:
        existentes = _facturas_alegra_existentes({pack_id, *order_ids})
    except Exception as e:  # noqa: BLE001 - sin poder verificar, no se emite
        return f"No se pudo verificar en Alegra si la venta ya tiene factura ({e}). No se emitió nada."
    if existentes:
        nums = ", ".join((f.get("numberTemplate") or {}).get("fullNumber") or str(f.get("id")) for f in existentes)
        return f"La venta de MeLi {pack_id} ya tiene factura en Alegra ({nums}). No se emite otra."
    return None


def consultar_venta_meli(ref: str) -> dict:
    """Para el wizard: comprador (billing_info de MeLi), productos y si ya está facturada."""
    from app.tools.meli_autofactura_entrega import (
        _construir_lineas_factura_desde_orden_meli,
        _extraer_datos_comprador,
        consultar_orden_meli_completa,
    )

    r = _claves_meli(ref)
    if not r.get("ok"):
        return r
    pack_id, order_ids, orden = r["pack_id"], r["order_ids"], r["orden"]
    lineas: list[dict] = []
    avisos: list[str] = []
    for oid in order_ids:
        o = orden if oid == str(orden.get("id")) else consultar_orden_meli_completa(oid)
        if not o:
            avisos.append(f"No se pudo leer la orden {oid}.")
            continue
        ls, err = _construir_lineas_factura_desde_orden_meli(o)
        if err:
            avisos.append(err)
        lineas.extend(ls)
    comprador = _extraer_datos_comprador(str(orden.get("id")), {})
    return {
        "ok": True,
        "pack_id": pack_id,
        "order_ids": order_ids,
        "cliente": {
            "nombre": comprador.get("nombre_cliente") or "",
            "identificacion": comprador.get("identificacion") or "",
            "tipo_documento": (comprador.get("tipo_documento") or "").upper(),
            "direccion": comprador.get("direccion_envio") or "",
            "correo": comprador.get("email") or "",
        },
        "lineas": [{"codigo": l["codigo"], "nombre": l.get("nombre") or l["codigo"],
                    "cantidad": l["cantidad"], "precio_unitario": l["precio_unitario"]} for l in lineas],
        "bloqueo": _bloqueo_meli(pack_id, order_ids, revisar_alegra=False),
        "avisos": avisos,
    }


def asegurar_tercero_cliente(venta: dict) -> dict | None:
    """El cliente de la venta, como tercero del Libro Mayor (tipo cliente).

    Se llama al cotizar y al facturar. Antes el cliente vivía solo en la venta
    y en Alegra: la factura FE465 (EQUISURE, sep-2026) llegó al taller de
    conciliación sin que existiera ningún tercero tipo cliente en el libro, y
    el asiento de la venta nació sin tercero. Un cliente al que se le cotiza ya
    es un tercero; se registra en ese momento y se reutiliza por identificación.

    Nunca frena la venta: si el libro falla, se sigue sin tercero.
    """
    return registrar_tercero_cliente(
        venta.get("cliente") or {}, telefono=venta.get("telefono") or "",
        nota=f"Cliente registrado desde la venta directa {venta.get('numero') or ''}",
    )


def registrar_tercero_cliente(cli: dict, *, telefono: str = "", nota: str = "") -> dict | None:
    """El cliente como tercero tipo `cliente` del Libro Mayor: lo busca por
    identificación y, si no está, lo crea. Si ya existe, completa correo y
    teléfono que estuvieran vacíos (nunca pisa lo que ya había)."""
    import re

    nombre = (cli.get("nombre") or "").strip()
    ident = re.sub(r"\D", "", cli.get("identificacion") or "")
    if not nombre or not ident:
        return None
    import app.services.contabilidad_core as cc

    for t in cc.listar_terceros(solo_activos=False):
        if cc.mismo_documento(t.get("identificacion") or "", ident):
            faltantes = {k: v for k, v in (("email", cli.get("correo") or ""), ("telefono", telefono or ""))
                         if v and not (t.get(k) or "").strip()}
            if faltantes:
                try:
                    return cc.actualizar_tercero(int(t["id"]), faltantes)
                except Exception:  # noqa: BLE001 — completar datos no frena nada
                    pass
            return t
    tipo = str(cli.get("tipo_documento") or "").strip().upper()
    if tipo in ("NIT", "CC"):
        tipo_persona = "juridica" if tipo == "NIT" else "natural"
    else:
        # NIT de 9 dígitos = persona jurídica; cédula = natural. Alegra lo sabe
        # mejor, pero acá alcanza para que el tercero nazca bien clasificado.
        tipo_persona = "juridica" if len(ident) in (9, 10) else "natural"
    return cc.crear_tercero({
        "nombre": nombre,
        "tipo": "cliente",
        "identificacion": cli.get("identificacion") or ident,
        "tipo_persona": tipo_persona,
        "email": cli.get("correo") or "",
        "telefono": telefono or "",
        "notas": nota,
    })


def crear_cliente(datos: dict, *, usuario: str = "") -> dict:
    """Alta de un cliente desde el paso «¿A quién le vendemos?» del wizard:
    contacto en Alegra (con el tipo de documento correcto) + tercero tipo
    cliente en el Libro Mayor, en un solo paso.

    Por qué los dos: la factura nace en Alegra con ese contacto, y la venta se
    causa en el libro (`causar_venta_directa`) buscando el tercero por
    identificación — sin tercero el asiento quedaba sin contraparte (FE465).
    Alegra manda: si rechaza el contacto no se crea nada y se devuelve el
    motivo; el operador puede corregir y volver a intentar.
    """
    from app.services.alegra import _resolver_o_crear_contacto_alegra

    cli = {k: str(datos.get(k) or "").strip()
           for k in ("nombre", "identificacion", "tipo_documento", "correo", "direccion", "ciudad")}
    telefono = str(datos.get("telefono") or "").strip()
    if not cli["nombre"]:
        return {"ok": False, "error": "El nombre o razón social es obligatorio."}
    if not cli["identificacion"]:
        return {"ok": False, "error": "La cédula o NIT es obligatoria para crear el cliente."}
    tipo_doc, ident, err = identificacion_fiscal(cli)
    if err:
        return {"ok": False, "error": err}
    if not ident:
        return {"ok": False, "error": "La identificación debe tener dígitos."}
    cli["tipo_documento"] = tipo_doc

    resultado: dict = {}
    telefono_alegra = telefono if _jid(telefono) else ""
    alegra_id, err_alegra = _resolver_o_crear_contacto_alegra(
        nombre=cli["nombre"], identificacion=ident, tipo_documento=tipo_doc,
        email=cli["correo"], telefono=telefono_alegra, direccion=cli["direccion"],
        resultado=resultado,
    )
    if not alegra_id:
        return {"ok": False, "error": f"Alegra no aceptó el cliente: {err_alegra}"}

    avisos: list[str] = []
    tercero = None
    try:
        tercero = registrar_tercero_cliente(
            cli, telefono=telefono,
            nota=f"Cliente creado desde Cotizar/Facturar por {usuario or 'panel'}; contacto Alegra {alegra_id}",
        )
    except Exception as e:  # noqa: BLE001 — el libro no frena el alta; se reintenta al cotizar
        avisos.append(f"No se pudo registrar el tercero en el Libro Mayor: {e}")

    return {
        "ok": True,
        "cliente": {**cli, "telefono": telefono},
        "alegra_id": str(alegra_id),
        "alegra_creado": bool(resultado.get("creado")),
        "tercero_id": int(tercero["id"]) if tercero else None,
        "avisos": avisos,
    }


def _telefono_visible(telefono: str) -> str:
    """WhatsApp para imprimir en el PDF: un JID de chat (…@lid) no es un número."""
    t = str(telefono or "")
    if "@" in t:
        t = t.split("@")[0] if t.endswith("@c.us") or t.endswith("@s.whatsapp.net") else ""
    return t


def documento_cotizacion(venta: dict) -> dict:
    """Lo que recibe `generar_cotizacion_pdf` a partir de una venta (guardada o no).
    Una sola función para la cotización real y para la vista previa del panel:
    lo que el operador ve antes de enviar es exactamente lo que recibe el cliente."""
    cli = venta.get("cliente") or {}
    envio = float(venta.get("envio") or 0)
    return {
        "numero": venta.get("numero") or "BORRADOR",
        "fecha": datetime.now().strftime("%d/%m/%Y"),
        "vigencia_dias": VIGENCIA_DIAS,
        "cliente": {"nombre": cli.get("nombre") or "Cliente", "nit": cli.get("identificacion") or "",
                    "correo": cli.get("correo") or "", "direccion": cli.get("direccion") or "",
                    "telefono": _telefono_visible(venta.get("telefono") or "")},
        "productos": [
            {"nombre": ln["nombre"], "sku": ln["codigo"], "cantidad": ln["cantidad"],
             "precio_unit": ln["precio_unitario"], "subtotal": ln["total"],
             "iva_pct": ln.get("iva_pct", 0)}
            for ln in venta.get("lineas") or []
        ] + ([{"nombre": "Envío", "sku": "", "cantidad": 1, "precio_unit": envio,
               "subtotal": envio, "iva_pct": 0}] if envio else []),
        "subtotal": venta.get("subtotal") or 0,
        "iva": venta.get("iva") or 0,
        "total": venta.get("total") or 0,
        "notas": venta.get("notas") or "",
    }


def vista_previa_pdf(datos: dict) -> bytes:
    """PDF de cotización con lo que hay en pantalla, SIN guardar la venta, sin
    Alegra y sin WhatsApp. Los totales se recalculan igual que al cotizar."""
    import tempfile

    from app.tools.cotizacion_pdf import generar_cotizacion_pdf

    calc = calcular(datos.get("lineas") or [], datos.get("envio") or 0)
    venta = {
        "numero": str(datos.get("numero") or "").strip() or "BORRADOR",
        "cliente": datos.get("cliente") or {},
        "telefono": datos.get("telefono") or "",
        "lineas": calc["lineas"],
        "envio": calc["envio"],
        "subtotal": calc["subtotal"],
        "iva": calc["iva"],
        "total": calc["total"],
        "notas": datos.get("notas") or "",
    }
    with tempfile.TemporaryDirectory() as tmp:
        ruta = generar_cotizacion_pdf(documento_cotizacion(venta), carpeta=tmp)
        with open(ruta, "rb") as f:
            return f.read()


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
    jid, err = _destino_whatsapp(venta["telefono"], enviar_whatsapp)
    if err:
        return {"ok": False, "error": err}

    avisos: list[str] = []
    campos: dict = {}
    # El cliente queda en el libro desde la cotización, no desde la conciliación.
    try:
        asegurar_tercero_cliente(venta)
    except Exception as e:  # noqa: BLE001 — el libro no frena una cotización
        avisos.append(f"No se pudo registrar el cliente en el Libro Mayor: {e}")
    if registrar_en_alegra and not venta.get("alegra_cotizacion_id"):
        r = crear_cotizacion_alegra(venta)
        if r.get("ok"):
            campos.update(alegra_cotizacion_id=r["id"], alegra_cotizacion_numero=r["numero"])
            if r.get("aviso"):
                avisos.append(r["aviso"])
        else:
            avisos.append(f"Alegra: {r.get('error')}")

    doc = documento_cotizacion(venta)
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
    tipo_doc, ident, err_ident = identificacion_fiscal(cli)
    if err_ident:
        return {"ok": False, "error": err_ident}
    try:
        asegurar_tercero_cliente(venta)
    except Exception:  # noqa: BLE001 — se reintenta al causar; la factura no espera al libro
        pass
    calc = calcular(venta["lineas"], venta["envio"])
    if calc["errores"]:
        return {"ok": False, "error": " ".join(calc["errores"])}
    if calc["sin_alegra"]:
        return {"ok": False, "error": "No existen en Alegra: " + ", ".join(calc["sin_alegra"])}
    jid, err = _destino_whatsapp(venta["telefono"], enviar_whatsapp)
    if err:
        return {"ok": False, "error": err}

    meli = None
    if venta.get("origen") == "meli":
        meli = _claves_meli(venta.get("origen_ref") or "")
        if not meli.get("ok"):
            return meli
        bloqueo = _bloqueo_meli(meli["pack_id"], meli["order_ids"])
        if bloqueo:
            return {"ok": False, "error": bloqueo}

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
    if meli:
        observaciones = (f"Venta MercadoLibre — Pack {meli['pack_id']}. Órdenes: {', '.join(meli['order_ids'])}. "
                         f"Facturada con los datos del RUT del cliente ({ref}).")
        orden_compra = meli["pack_id"]
    else:
        observaciones, orden_compra = f"Venta directa WhatsApp — {ref}.", ref
    try:
        res = crear_factura_venta_alegra(
            nombre_cliente=cli["nombre"],
            identificacion=ident,
            tipo_documento=tipo_doc,
            direccion_envio=cli.get("direccion") or "",
            productos=_lineas_para_documento(calc),
            total=calc["total"],
            email=cli.get("correo") or "",
            telefono=venta["telefono"] if jid else "",
            observaciones=observaciones,
            purchase_order=orden_compra,
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
    if meli:
        avisos += _registrar_en_meli(meli, res)

    _actualizar(
        venta_id, estado="facturada", facturado=_ahora(), facturado_por=usuario or "",
        factura_id=str(res.get("invoice_id") or ""), factura_numero=numero,
        factura_cufe=res.get("cufe") or "", factura_url=res.get("url") or "",
        medio_pago=medio, enviado_whatsapp=int(enviado or venta["enviado_whatsapp"]),
        avisos=(venta.get("avisos") or []) + avisos,
    )
    _cerrar_pedido_origen(venta)
    # La venta nace con su asiento, como la solicitud de pago: no se espera al
    # cron de seis horas para que el libro y el taller de conciliación la vean.
    # Si el libro falla, la factura ya está emitida y eso no se deshace: se
    # avisa y el cron la recoge después.
    try:
        from app.services.contabilidad_autopost import causar_venta_directa

        causado = causar_venta_directa(obtener(venta_id) or {})
        if causado.get("creado"):
            avisos.append(f"Causada en el Libro Mayor (asiento #{causado['movimiento_id']}).")
    except Exception as e:  # noqa: BLE001 — el libro no puede tumbar una factura ya emitida
        avisos.append(f"No se pudo causar en el Libro Mayor ({e}); el cron la posteará.")
        _actualizar(venta_id, avisos=(obtener(venta_id) or {}).get("avisos", []) + [avisos[-1]])
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


def _registrar_en_meli(meli: dict, res: dict) -> list[str]:
    """Sube el PDF a la venta de MeLi y marca sus órdenes como facturadas en el
    mismo registro que usa «Facturar ahora» (así esa vía ve que ya está hecha)."""
    from app.services.meli import subir_factura_meli
    from app.tools.meli_autofactura_entrega import _registrar_estado_orden

    avisos: list[str] = []
    subido = False
    if res.get("pdf_base64"):
        subida = subir_factura_meli(meli["pack_id"], res["pdf_base64"], formato="pdf", prefijo_archivo="Fac")
        subido = subida == "✅"
        if not subido:
            avisos.append(f"No se pudo subir el PDF a MeLi ({subida}) — súbelo a mano en la venta.")
    else:
        avisos.append("No se descargó el PDF de Alegra — súbelo a mano en la venta de MeLi.")
    for i, oid in enumerate(meli["order_ids"]):
        try:
            _registrar_estado_orden(
                oid, estado="facturada", proveedor="alegra", pack_id=meli["pack_id"],
                siigo_invoice_id=res.get("invoice_id"), siigo_invoice_number=res.get("number"),
                siigo_invoice_status=res.get("status"), siigo_invoice_cufe=res.get("cufe") or None,
                pdf_subido_meli=subido and i == 0,
                nota="Facturada desde Cotizar/Facturar con los datos del RUT del cliente.",
            )
        except Exception as e:  # noqa: BLE001
            avisos.append(f"No se pudo marcar la orden {oid} como facturada: {e}")
    return avisos


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
