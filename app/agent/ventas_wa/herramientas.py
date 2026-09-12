"""
Herramientas del agente de ventas WA. Cada una devuelve texto para el modelo.

Reglas de diseño:
- Precios y totales solo salen de aquí (catálogo web + pedido.py).
- Ninguna herramienta cierra la venta ni entrega datos de pago: eso lo hace el
  asesor humano (decisión del negocio, sep-2026).
- pasar_a_asesor es la única que habla con el equipo; deduplica para no
  llenar el grupo de tarjetas repetidas.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
from dataclasses import dataclass, field

from app.agent.ventas_wa import catalogo as cat_mod
from app.agent.ventas_wa import pedido as ped_mod
from app.agent.ventas_wa.catalogo import _miles

_RUTA_ORDERS = os.getenv(
    "WA_V2_ORDERS_DB",
    os.path.join(cat_mod._BASE, "PAGINA_WEB", "site", "data", "orders.db"),
)
_REAVISO_S = int(os.getenv("WA_V2_REAVISO_MIN", "30")) * 60

TIPOS_HANDOFF = (
    "pedido_listo",
    "cliente_pide_asesor",
    "conversacion_dificil",
    "consulta_tecnica",
    "producto_no_disponible",
    "otro",
)

DEFINICIONES = [
    {
        "name": "buscar_producto",
        "description": (
            "Busca en el catálogo de la página web de McKenna (única fuente de precios). "
            "Devuelve una línea por presentación: referencia | nombre | precio | stock. "
            "Úsala SIEMPRE antes de mencionar un producto, presentación o precio, también "
            "cuando el cliente responde corto ('la de 250', 'el kilo'): busca el producto del "
            "que se viene hablando. Si no hay resultados, prueba otro término (nombre químico, "
            "sinónimo) antes de concluir que no lo vendemos."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "consulta": {"type": "string", "description": "Nombre del producto, p. ej. 'creatina' o 'manteca de karite'."}
            },
            "required": ["consulta"],
            "additionalProperties": False,
        },
    },
    {
        "name": "ficha_producto",
        "description": (
            "Ficha técnica publicada en la web para una referencia (propiedades, usos, "
            "concentraciones). Úsala para preguntas de uso o formulación. No contiene COA ni "
            "certificados: esos los envía el asesor."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"ref": {"type": "string", "description": "Referencia exacta devuelta por buscar_producto."}},
            "required": ["ref"],
            "additionalProperties": False,
        },
    },
    {
        "name": "actualizar_pedido",
        "description": (
            "Agrega, cambia o quita productos del pedido del cliente. 'cantidad' es la cantidad "
            "FINAL de esa referencia (0 la quita). Usa solo referencias devueltas por "
            "buscar_producto. Devuelve el pedido actualizado con los totales calculados."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "cambios": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "ref": {"type": "string"},
                            "cantidad": {"type": "integer", "minimum": 0, "maximum": 500},
                        },
                        "required": ["ref", "cantidad"],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["cambios"],
            "additionalProperties": False,
        },
    },
    {
        "name": "guardar_datos_cliente",
        "description": (
            "Guarda los datos de despacho que el cliente vaya dando (todos opcionales; manda "
            "solo los nuevos). Guárdalos apenas aparezcan en la conversación, aunque vengan "
            "sueltos o en otro orden."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "nombre": {"type": "string", "description": "Nombre completo o razón social"},
                "documento": {"type": "string", "description": "Cédula o NIT"},
                "correo": {"type": "string"},
                "telefono": {"type": "string"},
                "direccion": {"type": "string"},
                "ciudad": {"type": "string"},
                "departamento": {"type": "string"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "ver_pedido",
        "description": "Estado actual del pedido: productos, subtotal, envío referencial, datos guardados y lo que falta.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "consultar_pedido_web",
        "description": (
            "Estado de un pedido hecho en la tienda web, por su referencia (formato MCKG-XXXXXXXXXX). "
            "Úsala cuando el cliente pregunte por un pedido de la página."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"referencia": {"type": "string"}},
            "required": ["referencia"],
            "additionalProperties": False,
        },
    },
    {
        "name": "pasar_a_asesor",
        "description": (
            "Avisa al equipo de ventas con una tarjeta del caso para que un asesor humano "
            "continúe por este mismo chat. Úsala: (1) cuando el pedido tenga productos y los "
            "datos mínimos (tipo pedido_listo) — el asesor confirma el total, comparte los datos "
            "de pago y cierra la venta; (2) si el cliente pide hablar con una persona; (3) si la "
            "conversación se complica (reclamo, devolución, descuento o precio por mayor, "
            "cliente molesto, no logras entenderlo tras dos intentos); (4) si piden algo que "
            "no puedes resolver (COA/certificados, producto que no está en la web, "
            "presentación especial, dudas técnicas fuera de la ficha). Llámala una sola vez por motivo."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "tipo": {"type": "string", "enum": list(TIPOS_HANDOFF)},
                "resumen_para_asesor": {
                    "type": "string",
                    "description": "Qué necesita el cliente y qué falta resolver, en 1-3 frases.",
                },
            },
            "required": ["tipo", "resumen_para_asesor"],
            "additionalProperties": False,
        },
    },
]


DEFINICIONES_WEB_EXTRA = [
    {
        "name": "llevar_al_carrito",
        "description": (
            "Pone en el carrito de la página web del visitante los productos del pedido actual "
            "(todos deben estar disponibles). La burbuja le muestra el botón 'Ver carrito y pagar'. "
            "Úsala cuando el cliente confirme productos y cantidades y todo esté disponible."
        ),
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "continuar_por_whatsapp",
        "description": (
            "Genera el botón para seguir la compra por WhatsApp con un código de pedido: allí un "
            "asesor retoma el mismo pedido sin volver a preguntar. Úsala si algo no está "
            "disponible o no está en la web, si pide presentación especial, precio por mayor, "
            "COA/certificados, si quiere hablar con una persona o si prefiere pagar por otro medio."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"motivo": {"type": "string", "description": "Por qué sigue por WhatsApp, en una frase."}},
            "required": ["motivo"],
            "additionalProperties": False,
        },
    },
]

_NOMBRES_WEB = {"buscar_producto", "ficha_producto", "actualizar_pedido", "guardar_datos_cliente", "ver_pedido", "consultar_pedido_web"}


def definiciones(canal: str) -> list[dict]:
    if canal == "web":
        return [d for d in DEFINICIONES if d["name"] in _NOMBRES_WEB] + DEFINICIONES_WEB_EXTRA
    return DEFINICIONES


WA_NUMERO_NEGOCIO = os.getenv("WA_NUMERO_NEGOCIO", "573195183596")


@dataclass
class ContextoTurno:
    jid: str
    display: str
    modo: str = "activo"  # "activo" | "sombra" (sombra: no avisa ni ejecuta acciones)
    canal: str = "whatsapp"  # "whatsapp" | "web"
    llamadas_herramientas: list[str] = field(default_factory=list)
    handoff: dict | None = None
    acciones: list[dict] = field(default_factory=list)  # web: carrito / botón WhatsApp
    evidencia: list[str] = field(default_factory=list)  # salidas de herramientas (para el supervisor)


def destinos_alerta() -> list[str]:
    """
    A quién le llega la tarjeta del caso. Por decisión del negocio (sep-2026) va
    por mensaje directo al asesor que cierra las ventas (WA_V2_ALERTA_DESTINO,
    varios separados por coma); GRUPO_VENTAS_WA agrega además un grupo.
    Los números se envían a su @lid si se conoce: WhatsApp Web rechaza cada vez
    más los envíos a @c.us con "No LID for user".
    """
    crudos = [
        x.strip()
        for x in os.getenv("WA_V2_ALERTA_DESTINO", "573182432463@c.us").split(",")
        if x.strip()
    ]
    grupo = os.getenv("GRUPO_VENTAS_WA", "").strip()
    if grupo:
        crudos.append(grupo)
    out: list[str] = []
    for d in crudos:
        destino = d
        if not d.endswith("@g.us"):
            try:
                from app.services.wa_jid import jids_relacionados

                rel = jids_relacionados(d if "@" in d else f"{d}@c.us")
                destino = next((j for j in rel if j.endswith("@lid")), d)
            except Exception:
                pass
        if destino not in out:
            out.append(destino)
    return out


def enviar_alerta_asesor(texto: str) -> bool:
    """
    Envía la alerta al asesor DESDE la cuenta supervisora (bot-supervisor, :3001,
    número 573196529076) para que se distinga de los chats de clientes que llegan
    al número de la empresa. Si el supervisor no responde, respaldo por el puente
    principal (:3000): la alerta no se pierde. GRUPO_VENTAS_WA siempre va por el principal.
    """
    import requests

    base = os.getenv("WHATSAPP_SUPERVISOR_URL", "http://127.0.0.1:3001").rstrip("/")
    token = os.getenv("WHATSAPP_SUPERVISOR_TOKEN", "").strip()
    numeros = [x.strip() for x in os.getenv("WA_V2_ALERTA_DESTINO", "573182432463@c.us").split(",") if x.strip()]
    algun_ok = False
    for crudo in numeros:
        numero = crudo.split("@")[0] if crudo.endswith("@c.us") else crudo
        ok = False
        try:
            r = requests.post(
                f"{base}/enviar",
                json={"numero": numero, "mensaje": texto},
                headers={"X-Bridge-Token": token} if token else {},
                timeout=60,
            )
            ok = r.ok and (r.json() or {}).get("status") == "success"
        except Exception as e:
            print(f"[ventas_wa] supervisor no envió la alerta: {e}")
        if not ok:
            from app.utils import enviar_whatsapp_reporte

            destino = next((d for d in destinos_alerta() if not d.endswith("@g.us")), crudo)
            ok = bool(enviar_whatsapp_reporte(texto, numero_destino=destino))
        algun_ok = algun_ok or ok
    grupo = os.getenv("GRUPO_VENTAS_WA", "").strip()
    if grupo:
        from app.utils import enviar_whatsapp_reporte

        algun_ok = bool(enviar_whatsapp_reporte(texto, numero_destino=grupo)) or algun_ok
    return algun_ok


def _buscar_producto(ctx: ContextoTurno, consulta: str) -> str:
    res = cat_mod.cargar().buscar(consulta)
    if not res:
        return (
            f"Sin resultados para '{consulta}' en el catálogo web. Si ya probaste otros "
            "términos, dile al cliente que ese producto no aparece en la tienda y ofrécele "
            "consultar con un asesor (pasar_a_asesor tipo producto_no_disponible)."
        )
    return "\n".join(p.linea() for p in res)


def _ficha_producto(ctx: ContextoTurno, ref: str) -> str:
    cat = cat_mod.cargar()
    prod = cat.obtener(ref)
    if not prod:
        return f"La referencia '{ref}' no existe. Usa buscar_producto primero."
    ficha = cat.ficha(prod.ref)
    return f"{prod.nombre}\n{ficha}" if ficha else f"{prod.nombre}: no tiene ficha publicada en la web."


def _actualizar_pedido(ctx: ContextoTurno, cambios: list[dict]) -> str:
    cat = cat_mod.cargar()
    p = ped_mod.activo(ctx.jid)
    avisos = []
    for c in cambios or []:
        prod = cat.obtener(c.get("ref", ""))
        if not prod:
            avisos.append(f"Referencia '{c.get('ref')}' no existe: búscala con buscar_producto.")
            continue
        cant = int(c.get("cantidad") or 0)
        if cant > 0 and not prod.disponible:
            avisos.append(f"{prod.nombre} está agotado/no disponible: no se agregó.")
            continue
        if cant > 0 and prod.stock is not None and cant > prod.stock:
            avisos.append(
                f"{prod.nombre}: pidió {cant} y en la web figuran {prod.stock}. Se agregaron "
                f"{cant}; avísale al cliente que el asesor confirma la disponibilidad."
            )
        ped_mod.fijar_item(p, prod, cant)
    ped_mod.guardar(p)
    return ("\n".join(avisos) + "\n\n" if avisos else "") + p.resumen()


def _guardar_datos_cliente(ctx: ContextoTurno, **datos) -> str:
    p = ped_mod.activo(ctx.jid)
    cambiados = ped_mod.fijar_cliente(p, datos)
    ped_mod.guardar(p)
    return (f"Guardado: {', '.join(cambiados)}.\n" if cambiados else "Sin cambios.\n") + p.resumen()


def _ver_pedido(ctx: ContextoTurno) -> str:
    return ped_mod.activo(ctx.jid).resumen()


def _consultar_pedido_web(ctx: ContextoTurno, referencia: str) -> str:
    ref = str(referencia or "").strip().upper()
    if not ref:
        return "Falta la referencia del pedido."
    try:
        con = sqlite3.connect(f"file:{_RUTA_ORDERS}?mode=ro", uri=True, timeout=5)
        con.row_factory = sqlite3.Row
        r = con.execute(
            """SELECT reference, buyer_name, buyer_city, total, status, shipping_status,
                      tracking_number, tracking_carrier, created_at, delivered_at, cancelled_at
               FROM orders WHERE UPPER(reference)=?""",
            (ref,),
        ).fetchone()
        con.close()
    except sqlite3.Error as e:
        return f"No pude consultar los pedidos web ({e}). Pásalo a un asesor."
    if not r:
        return f"No hay ningún pedido web con referencia {ref}."
    partes = [
        f"Pedido {r['reference']} de {r['buyer_name'] or 'cliente'} ({r['buyer_city'] or 'sin ciudad'})",
        f"creado {r['created_at']}, total ${_miles(r['total'] or 0)}",
        f"pago: {r['status']}, envío: {r['shipping_status']}",
    ]
    if r["tracking_number"]:
        partes.append(f"guía {r['tracking_carrier'] or ''} {r['tracking_number']}".strip())
    if r["delivered_at"]:
        partes.append(f"entregado {r['delivered_at']}")
    if r["cancelled_at"]:
        partes.append(f"cancelado {r['cancelled_at']}")
    return "; ".join(partes)


def _tarjeta(ctx: ContextoTurno, tipo: str, resumen: str, p: ped_mod.Pedido) -> str:
    titulos = {
        "pedido_listo": "🛒 *PEDIDO WA LISTO PARA CERRAR*",
        "cliente_pide_asesor": "🙋 *CLIENTE PIDE ASESOR*",
        "conversacion_dificil": "⚠️ *CONVERSACIÓN PARA ASESOR*",
        "consulta_tecnica": "🧪 *CONSULTA TÉCNICA*",
        "producto_no_disponible": "🔎 *PRODUCTO FUERA DEL CATÁLOGO WEB*",
    }
    lineas = [titulos.get(tipo, "📌 *CLIENTE WA PARA ASESOR*"), f"👤 {ctx.display}"]
    cli = p.cliente
    if cli.get("nombre") or cli.get("documento"):
        lineas.append(f"🪪 {cli.get('nombre', '')} · {cli.get('documento', '')}".strip(" ·"))
    if cli.get("direccion") or cli.get("ciudad"):
        lineas.append(f"📍 {cli.get('direccion', '')}, {cli.get('ciudad', '')} {cli.get('departamento', '')}".strip(" ,"))
    if cli.get("correo"):
        lineas.append(f"✉️ {cli['correo']}")
    if p.items:
        lineas.append("")
        for i in p.items:
            lineas.append(f"• {i.nombre} x{i.cantidad} = ${_miles(i.subtotal)}")
        lineas.append(f"Subtotal: ${_miles(p.subtotal)}")
        env = p.envio()
        if env:
            lineas.append(f"Envío tabla ({env['zona_nombre']}, ~{env['peso_kg']} kg): ${_miles(env['costo'])}")
            lineas.append(f"*Total referencial: ${_miles(p.subtotal + env['costo'])}*")
        falt = p.faltantes()
        if falt:
            lineas.append(f"Faltan datos: {', '.join(falt)}")
    lineas += ["", f"💬 {resumen[:500]}", "", "➡️ Responde al cliente desde WhatsApp; cuando escribas, Hugo se calla en ese chat. Pedidos agrupados en /app → Agente WA → Pedidos IA."]
    return "\n".join(lineas)


def _pasar_a_asesor(ctx: ContextoTurno, tipo: str, resumen_para_asesor: str) -> str:
    tipo = tipo if tipo in TIPOS_HANDOFF else "otro"
    p = ped_mod.activo(ctx.jid)
    firma = hashlib.sha1(
        json.dumps([tipo, [i.__dict__ for i in p.items], p.cliente], sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()[:16]
    if p.handoff_firma == firma and p.handoff_ts and time.time() - p.handoff_ts < _REAVISO_S:
        return "El equipo ya tiene esta misma tarjeta; no se reenvió. Dile al cliente que un asesor le escribe por este chat."
    texto = _tarjeta(ctx, tipo, resumen_para_asesor, p)
    enviado = True
    if ctx.modo == "activo":
        try:
            enviado = enviar_alerta_asesor(texto)
        except Exception as e:
            print(f"[ventas_wa] no se pudo avisar al grupo: {e}")
            enviado = False
    ctx.handoff = {"tipo": tipo, "tarjeta": texto, "enviado": enviado}
    if not enviado:
        return (
            "No se pudo avisar al equipo (falla de conexión). Dile al cliente que ya quedó "
            "registrado y que un asesor le escribe por este chat; no prometas un tiempo."
        )
    p.handoff_ts = time.time()
    p.handoff_motivo = tipo
    p.handoff_firma = firma
    if tipo == "pedido_listo":
        p.estado = "esperando_asesor"
    ped_mod.guardar(p)
    return "Aviso enviado al equipo. Dile al cliente que un asesor continúa por este mismo chat."


def _llevar_al_carrito(ctx: ContextoTurno) -> str:
    cat = cat_mod.cargar()
    p = ped_mod.activo(ctx.jid)
    if not p.items:
        return "El pedido no tiene productos: agrégalos con actualizar_pedido antes."
    items, problemas = [], []
    for i in p.items:
        prod = cat.obtener(i.ref)
        if not prod or not prod.disponible:
            problemas.append(f"{i.nombre} ya no está disponible en la web")
            continue
        cant = i.cantidad if prod.stock is None else min(i.cantidad, prod.stock)
        if cant < i.cantidad:
            problemas.append(f"{i.nombre}: solo hay {prod.stock} en la web")
        items.append({"ref": prod.ref, "cantidad": cant, "nombre": prod.nombre})
    if problemas and not items:
        return "No se pudo llevar nada al carrito: " + "; ".join(problemas) + ". Ofrece continuar por WhatsApp."
    ctx.acciones = [a for a in ctx.acciones if a.get("tipo") != "carrito"] + [{"tipo": "carrito", "items": items}]
    texto = f"Listo: {len(items)} producto(s) quedan en el carrito de la web; dile que use el botón 'Ver carrito y pagar'."
    if problemas:
        texto += " Ojo: " + "; ".join(problemas) + ". Explícaselo y ofrece continuar por WhatsApp para lo que falta."
    return texto


def _continuar_por_whatsapp(ctx: ContextoTurno, motivo: str) -> str:
    from urllib.parse import quote

    p = ped_mod.activo(ctx.jid)
    codigo = ped_mod.asignar_codigo(p)
    p.notas = (p.notas + f"\nMotivo WhatsApp: {motivo[:200]}").strip()
    ped_mod.guardar(p)
    mensaje = f"Hola, vengo del chat de la página. Mi pedido es {codigo}"
    url = f"https://wa.me/{WA_NUMERO_NEGOCIO}?text={quote(mensaje)}"
    if not any(a.get("tipo") == "whatsapp" for a in ctx.acciones):
        ctx.acciones.append({"tipo": "whatsapp", "url": url, "codigo": codigo})
    return (
        f"Botón de WhatsApp listo con el código {codigo}. Dile al cliente que con ese botón sigue "
        "por WhatsApp y que allá retoman su pedido sin volver a preguntarle nada."
    )


_IMPL = {
    "buscar_producto": _buscar_producto,
    "ficha_producto": _ficha_producto,
    "actualizar_pedido": _actualizar_pedido,
    "guardar_datos_cliente": _guardar_datos_cliente,
    "ver_pedido": _ver_pedido,
    "consultar_pedido_web": _consultar_pedido_web,
    "pasar_a_asesor": _pasar_a_asesor,
    "llevar_al_carrito": _llevar_al_carrito,
    "continuar_por_whatsapp": _continuar_por_whatsapp,
}


def ejecutar(ctx: ContextoTurno, nombre: str, entrada: dict) -> tuple[str, bool]:
    """(resultado, es_error). Nunca lanza: un fallo vuelve al modelo como is_error."""
    ctx.llamadas_herramientas.append(nombre)
    fn = _IMPL.get(nombre)
    if fn is None:
        return f"Herramienta desconocida: {nombre}", True
    try:
        salida = fn(ctx, **(entrada or {}))
        ctx.evidencia.append(salida)
        return salida, False
    except TypeError as e:
        return f"Parámetros inválidos para {nombre}: {e}", True
    except Exception as e:
        print(f"[ventas_wa] error en {nombre}: {e}")
        return f"Error interno en {nombre}. Si es necesario, pasa el caso a un asesor.", True
