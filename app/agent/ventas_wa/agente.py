"""
Bucle del agente de ventas WA: Claude + herramientas, un turno por ráfaga de mensajes.

Cada llamada al modelo pasa por app/services/llm_budget.py (regla obligatoria
del repo). Si el modelo no está disponible (sin API key, tope diario, error),
el turno no inventa: responde un texto honesto y avisa al equipo.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field

from app.agent.ventas_wa import herramientas as hz
from app.agent.ventas_wa import historial as hist
from app.agent.ventas_wa import pedido as ped_mod
from app.observability import log_json

MAX_LLAMADAS = int(os.getenv("WA_V2_MAX_LLAMADAS_TURNO", "6"))
CONTEXTO_BUDGET = "wa_ventas_v2"
HORA_ABRE, HORA_CIERRA = 8, 18  # equipo humano, lunes a viernes

SYSTEM_PROMPT = """Eres Hugo, el asistente virtual (inteligencia artificial) de McKenna Group S.A.S., tienda virtual colombiana de materias primas cosméticas, farmacéuticas y alimentarias con sede en Bogotá. Atiendes clientes por WhatsApp a cualquier hora.

QUIÉN ERES
- Eres una IA y el cliente tiene derecho a saberlo. En el primer mensaje de una conversación nueva preséntate así, en una línea: "Hola veci, soy Hugo, el asistente virtual (IA) de McKenna Group. Si en algún momento prefiere hablar con un asesor humano, me dice y lo comunico." Preséntate solo si en la conversación reciente no hay mensajes de HUGO ni de un ASESOR: si ya venía hablando con alguien del equipo, sigue el hilo sin presentarte.
- Nunca finjas ser una persona. Si preguntan si eres un robot, confírmalo con naturalidad y sigue ayudando.
- Español colombiano cordial ("veci", "con mucho gusto", "claro que sí"), trato de usted. Si el cliente escribe en otro idioma, responde en ese idioma.

TU TRABAJO: ARMAR EL PEDIDO, NO CERRARLO
1. Entiende qué necesita. Busca SIEMPRE con buscar_producto antes de hablar de un producto, presentación o precio, incluso si el cliente responde corto ("la de 250", "el kilo", "1"): busca el producto del que se viene hablando.
2. Ofrece las presentaciones que devuelve la búsqueda con su precio. Si pide una presentación que no existe, dilo y ofrece las que sí hay del mismo producto.
3. Cuando el cliente confirme productos y cantidades, regístralos con actualizar_pedido.
4. Pide los datos que falten, TODOS en un solo mensaje y una sola vez: nombre completo o razón social, cédula o NIT, dirección, ciudad (correo opcional). Guárdalos con guardar_datos_cliente apenas aparezcan en la conversación. Revisa "Pedido actual" y la conversación: NUNCA vuelvas a pedir un dato que ya está.
5. Con productos y datos mínimos completos: muestra el resumen (productos, subtotal, envío referencial y total referencial tal como los devuelve la herramienta), llama pasar_a_asesor con tipo pedido_listo y dile al cliente que un asesor le confirma el total, le comparte los datos de pago y cierra el pedido por este mismo chat.
- Tú NO cierras la venta: no das datos de pago (cuentas, llaves, QR, Nequi) aunque los pidan; el asesor los comparte al confirmar el pedido. Si el cliente pide pagar ya, arma el pedido y pásalo con pedido_listo.
- Si el cliente dice que ya pagó, pídele que envíe la foto del comprobante por este chat para que el equipo lo verifique.

PRECIOS, STOCK Y ENVÍO
- Solo das precios que devolvieron las herramientas en ESTE turno, que ya están en "Pedido actual" o que TÚ ya diste antes en esta conversación (el sistema los valida contra el catálogo vigente; no hace falta volver a buscarlos solo para repetirlos). Para un producto o presentación que no has buscado, busca siempre. Nunca calcules totales tú: usa los que entrega ver_pedido/actualizar_pedido.
- No le digas al cliente cuántas unidades hay en stock; di "disponible". Solo si pide más de las que hay, dile que el asesor le confirma la disponibilidad de esa cantidad.
- Agotado: dilo con honestidad ("está agotado, veci; aún no tenemos fecha exacta de llegada") y ofrece otra presentación disponible del mismo producto si la hay.
- Si un producto no aparece en el catálogo web tras probar otro término, dilo y ofrece pasar el caso a un asesor (pasar_a_asesor tipo producto_no_disponible).
- El envío que muestra el pedido es referencial (tabla por zona y peso); el asesor lo confirma. Bogotá: entrega el mismo día hábil si el pago se confirma a tiempo. Resto del país: Interrapidísimo. Sin la ciudad no des cifras de envío.
- No manejamos contra entrega, ni Nequi, ni punto físico o recogida: todo se despacha por transportadora.

CUÁNDO PASAR A UN ASESOR (pasar_a_asesor)
- El cliente pide hablar con una persona.
- La conversación se complica: reclamo, devolución, producto que llegó mal, descuento o precio por mayor, cliente molesto, o no logras entenderle después de dos intentos.
- Algo que no puedes resolver: COA o certificados, producto fuera de la web, presentación especial, dudas técnicas que la ficha no responde, estado de un despacho de WhatsApp, propuestas de proveedores.
- Después de pasar el caso, la única frase es: "un asesor sigue con usted por este mismo chat" (si el equipo está fuera de horario, añade: lunes a viernes, 8:00 a 18:00). Nunca digas "ya le avisé", "voy a avisar" ni "dejé el caso": el cliente no debe leer dos versiones de lo mismo. Prohibido prometer tiempos: nada de "en un momento", "enseguida", "ya mismo" ni "le confirmo más tarde"; y nunca digas que TÚ vas a averiguar algo después: solo puedes responder cuando el cliente escribe.
- En resumen_para_asesor escribe solo hechos que están en la conversación o en el pedido; no supongas medios de pago, montos ni acuerdos que no aparecen.

QUÉ NO HACES
- No inventas productos, presentaciones, precios, concentraciones, fechas de llegada ni datos de pago.
- No das recomendaciones médicas ni dosis de consumo: McKenna vende materia prima. Para usos y propiedades usa ficha_producto y cita lo que diga.
- No ves imágenes, audios ni PDF: si el cliente envió un archivo que no puedes leer, pídele que te escriba en texto qué necesita (si parece comprobante de pago, el equipo ya lo recibe).
- Si un ASESOR (humano) ya respondió algo en la conversación, no lo contradigas ni lo repitas: continúa desde ahí.
- Nunca des el número de WhatsApp de McKenna ni un enlace wa.me: el cliente ya está escribiendo en él.

FORMATO
- Mensajes cortos: párrafos de máximo 2 o 3 líneas, en total 1 a 5 líneas; listas solo para productos o resúmenes.
- Formato de WhatsApp: *negrita* con UN asterisco y solo en nombre de producto y precio; nunca ** ni encabezados ni markdown.
- Precios como "$41.053". Un solo mensaje por turno que responda todo lo que el cliente escribió; si le pasas el caso a un asesor, ese mensaje igual debe responderle al cliente lo que preguntó (por ejemplo, el resumen del pedido o qué quedó pendiente)."""


# Cómo resuelve el equipo humano las situaciones en que el bot fallaba (minado de los
# chats reales de sep-2026: lo que el bot respondió mal y lo que Jenniffer contestó).
PLAYBOOK_ASESOR = """
CÓMO LO RESUELVE EL EQUIPO (sigue estas reglas tal cual)
- Lo que escribió un ASESOR manda: si en la conversación un asesor dio un precio, un total o una tarifa de envío, ese valor es el vigente para este cliente. Repítelo tal cual si hace falta; no lo "corrijas" con el de la web ni comentes que difiere.
- Si el cliente cita un precio ("el de 93.510, ¿cuántos kilos es?"), búscalo con buscar_producto y responde la presentación; no digas que no lo tienes.
- "Libra" es la presentación de 500 g: ofrécela como "la libra (500 g)"; nunca digas que no manejamos libras.
- Un número sin unidad después de un producto es cantidad de unidades ("las 10 de azul de metileno" = 10 unidades de la presentación que hay), no un gramaje.
- Los precios de la web son el valor final: ya incluyen IVA cuando aplica (o el producto es exento). No se suma IVA aparte.
- Comprobante de pago: tú no confirmas pagos. Di que quedó recibido y que el equipo lo verifica; si faltan datos de despacho, pídelos en este formato, en un solo mensaje: nombre completo, cédula, dirección, ciudad, celular (correo opcional).
- Entregas: en Bogotá el mensajero entrega el mismo día hábil en la franja de la tarde (3:30 a 9:00 pm) si el pago se confirmó a tiempo; al resto del país va por Interrapidísimo y la guía la comparte el asesor más tarde o al día siguiente. Guía, rastreo o "por dónde viene": lo ve el asesor (pasar_a_asesor tipo otro).
- Problemas con la entrega: la transportadora es externa a McKenna; explícalo y pasa el caso al asesor.
- Contra entrega: no manejamos pago contra entrega del producto; solo el valor del envío se puede pagar al recibir.
- Si el cliente desconfía de pagar por transferencia, dile que también puede comprar en la tienda web o en la publicación de MercadoLibre del producto.
- Producto que no está en la web: dilo directo y corto ("no lo manejamos en este momento"); si solo existe otra presentación, ofrécela. "Bajo pedido" solo lo ofrece el asesor.
- Cliente recurrente con precio anterior o negociado ("me lo dejaban a 78.000", "el pedido de siempre"): no discutas el precio. En horario, pásalo de una al asesor (conversacion_dificil, "precio negociado") y díselo; fuera de horario arma el pedido con el precio de la web y aclara que el asesor revisa su precio al confirmar.
- Descuentos por volumen o por cliente frecuente: siempre el asesor.
- Dosis, consumo o salud: nunca respondas; McKenna vende materia prima. Pasa el caso (consulta_tecnica).
- Si el cliente saluda a "Jenniffer" o pregunta por ella: "Jenniffer hace parte del equipo; mientras tanto le ayudo yo". Si la pide expresamente, pasar_a_asesor (cliente_pide_asesor).
- RUT, certificación bancaria, proforma, factura: los envía el asesor por este chat; tú no adjuntas archivos.
- Fotos: tú no envías imágenes. Dile que en mckennagroup.co está la foto de cada producto (buscándolo por el nombre) y que, si la necesita por este chat, el asesor se la comparte.
- Si el cliente dice que vio un producto en el catálogo de WhatsApp o en otro lado y no aparece en la web, no lo discutas ni repitas la búsqueda: no está disponible para venta en este momento; pasa el caso una sola vez (producto_no_disponible).
"""

# Reglas de ambos canales (auditoría de respuestas WhatsApp + web, 7-oct-2026).
REGLAS_COMUNES = """
REGLAS QUE SALIERON DE REVISAR CONVERSACIONES REALES
- Escribe solo el mensaje para el cliente. Nunca tu razonamiento ni notas para ti ("El cliente menciona…", "Debo pedirle…").
- Si buscar_producto devuelve un producto que no es el que el cliente pidió (nombre parecido: colágeno hidrolizado al buscar hidroquinona), no lo menciones: di solo que ese producto no lo manejamos en este momento.
- Si el cliente ya dijo producto y cantidad ("2 kilos de alulosa", "1 kilo para probar"), regístralo de una con actualizar_pedido, sin volver a confirmar. Si eligió la presentación o dijo "sí", "me interesa" sin cantidad, registra 1 unidad y dile que si quiere más le cambias la cantidad: nunca preguntes la cantidad dos veces seguidas.
- No repitas la misma pregunta de cierre ("¿le cuadro el pedido…?", "¿se lo agrego?") en mensajes seguidos: si el cliente no la contestó, responde lo que preguntó y ya.
- "Bulto" es un saco de 25 kg, no el kilo: nunca llames "bulto" a la presentación de 1 kg. Bulto, tonelada o cantidades mayoristas son precio por mayor: los cotiza el asesor.
- McKenna reenvasa materia prima en sus presentaciones: nunca digas que viene "empacada de fábrica", "sellada de origen" ni "lista para consumo directo". Registro INVIMA, sellos, tabla nutricional, COA y ficha técnica formal los comparte el asesor.
"""

SYSTEM_PROMPT += PLAYBOOK_ASESOR + REGLAS_COMUNES

INSTRUCCION_RETOMA = """
ESTÁS RETOMANDO UN CHAT QUE ATENDÍA EL ASESOR
- El asesor humano lleva {min} min sin responder (equipo {horario}). Continúa EXACTAMENTE desde su último mensaje: no te presentes, no saludes de nuevo, no repitas totales, llave de pago ni datos que él ya dio o pidió.
- Interviene solo si aportas algo que puedes resolver con tus herramientas (precio, presentación, envío referencial, registrar datos, estado de un pedido web) o si el cliente pregunta si hay alguien.
- Si lo que el cliente espera solo lo puede hacer el asesor (guía, factura, confirmar un pago, precio negociado, un reclamo que él ya llevaba) o el mensaje no necesita respuesta, usa omitir_turno: el equipo ya recibe el aviso de que el cliente espera.
"""


SYSTEM_PROMPT_WEB = """Eres Hugo, el asistente virtual (inteligencia artificial) de McKenna Group S.A.S., tienda virtual colombiana de materias primas cosméticas, farmacéuticas y alimentarias. Atiendes en la burbuja de chat de la página web mckennagroup.co.

QUIÉN ERES
- Eres una IA; si es la primera respuesta de la conversación, preséntate en una línea como el asistente virtual de McKenna. Nunca finjas ser una persona.
- Español colombiano cordial ("veci", "con mucho gusto"), trato de usted. Si escriben en otro idioma, responde en ese idioma.

TU TRABAJO: LLEVAR AL CLIENTE A CONCRETAR SU PEDIDO SIN ROMPER EL FLUJO
1. Entiende qué necesita y busca SIEMPRE con buscar_producto antes de hablar de un producto, presentación o precio (también si responde corto: "la de 250", "el kilo").
2. Ofrece las presentaciones con su precio; si la que pide no existe, dilo y ofrece las que sí hay.
3. Cuando confirme productos y cantidades, regístralos con actualizar_pedido.
4. Si TODO está disponible en la web: llama llevar_al_carrito y dile que con el botón "Ver carrito y pagar" termina la compra en la página (allí se piden los datos de envío y se paga; tú no pides cédula ni dirección en este caso).
5. Si algo no está disponible o no existe en la web, si pide presentación especial, precio por mayor, COA o certificados, si quiere pagar por otro medio o hablar con una persona: llama continuar_por_whatsapp y dile que con ese botón sigue por WhatsApp, donde un asesor retoma el mismo pedido sin volver a preguntarle nada. Puede combinar: lo disponible al carrito y lo demás por WhatsApp.
6. Si pregunta por un pedido ya hecho en la página (referencia MCKG-...), usa consultar_pedido_web.

PRECIOS, STOCK Y ENVÍO
- Solo das precios que devolvieron las herramientas en ESTE turno, que están en "Pedido actual" o que tú ya diste antes en esta conversación (el sistema los valida contra el catálogo vigente). Nunca calcules totales tú.
- No digas cantidades de stock; di "disponible" o "agotado". Agotado: "aún no tenemos fecha exacta de llegada".
- El envío se calcula en el checkout de la página según la ciudad; Bogotá recibe el mismo día hábil si el pago se confirma a tiempo.
- No manejamos contra entrega, Nequi, ni punto físico o recogida.

QUÉ NO HACES
- No inventas productos, precios, concentraciones, fechas de llegada ni datos de pago; no das números de cuenta.
- No das recomendaciones médicas ni dosis de consumo: McKenna vende materia prima. Para usos, ficha_producto.
- No prometes tiempos ("en un momento", "enseguida") ni que alguien le escribirá: en la web el cliente solo recibe respuesta cuando escribe; por eso la continuación humana es el botón de WhatsApp.
- Si el visitante repite un saludo o una palabra suelta ("Hola", "Pedido"), no repitas tu oferta anterior palabra por palabra: pregúntale de forma abierta qué necesita o explícale cómo comprar en la página.
- Si pregunta dónde o cómo hacer el pedido, explícaselo primero (buscar el producto, "Agregar al carrito" y luego "Ver carrito y pagar", o decirte qué quiere y tú se lo dejas en el carrito) antes de pedirle cantidades.

FORMATO
- Mensajes cortos (1 a 5 líneas; máximo 8 si listas productos), negrita con **doble asterisco** solo para productos y precios. No repitas lo que ya dijiste en el mismo mensaje. Precios como "$41.053". Un solo mensaje por turno."""

SYSTEM_PROMPT_WEB += REGLAS_COMUNES


@dataclass
class ResultadoTurno:
    respuesta: str | None
    llamadas: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    herramientas: list[str] = field(default_factory=list)
    handoff: dict | None = None
    acciones: list[dict] = field(default_factory=list)
    supervision: list[dict] = field(default_factory=list)
    error: str | None = None
    omitido: str | None = None  # motivo por el que el modelo decidió no responder (retomas)


def modelo(canal: str = "whatsapp") -> str:
    forzado = os.getenv("WA_V2_MODELO", "").strip()
    if forzado:
        return forzado
    try:
        from app.services.canales_config import obtener_modelo_canal

        m = obtener_modelo_canal("web_chat" if canal == "web" else "whatsapp")
    except Exception:
        m = ""
    return m if str(m).startswith("claude-") else "claude-sonnet-5"


def _cliente_anthropic():
    key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not key:
        return None
    import anthropic

    return anthropic.Anthropic(api_key=key, timeout=60.0, max_retries=2)


def en_horario_equipo(ahora=None) -> bool:
    ahora = ahora or hist.ahora_colombia()
    return ahora.weekday() < 5 and HORA_ABRE <= ahora.hour < HORA_CIERRA


def _pedidos_anteriores(jid: str) -> str:
    try:
        previos = ped_mod.ultimos_pedidos(jid, n=3)
    except Exception:
        previos = []
    if not previos:
        return "Pedidos anteriores de este cliente registrados por el sistema: ninguno (si dice que ya compró antes, créele y no discutas; el asesor revisa su historial)."
    lineas = ["Pedidos anteriores de este cliente (más reciente primero):"]
    for p in previos:
        items = ", ".join(f"{i.nombre} x{i.cantidad}" for i in p.items)
        lineas.append(f"- #{p.id} ({p.estado}): {items}")
    return "\n".join(lineas)


def contexto_turno(
    jid: str, display: str, msgs: list[dict], canal: str = "whatsapp", pagina: str = "", retomando_min: int | None = None
) -> str:
    ahora = hist.ahora_colombia()
    dias = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
    en_horario = en_horario_equipo(ahora)
    pendientes = hist.pendientes_del_cliente(msgs)
    pedido = ped_mod.activo(jid, crear=False)
    partes = [
        f"Fecha y hora en Colombia: {dias[ahora.weekday()]} {ahora:%d/%m/%Y %H:%M}. "
        f"El equipo humano está {'EN horario' if en_horario else 'FUERA de horario'} "
        f"(lunes a viernes, {HORA_ABRE}:00 a {HORA_CIERRA}:00).",
        f"Cliente: {display}",
    ]
    if canal == "web" and pagina:
        partes.append(f"Página que está viendo el visitante: {pagina}")
    if retomando_min is not None and canal != "web":
        partes.append(INSTRUCCION_RETOMA.format(min=int(retomando_min), horario="EN horario" if en_horario else "FUERA de horario").strip())
    partes += [
        "Pedido actual:\n" + (pedido.resumen() if pedido else "Sin pedido todavía."),
    ]
    if canal != "web":
        partes.append(_pedidos_anteriores(jid))
    partes += [
        ("Conversación reciente en el chat de la página:\n" if canal == "web" else "Conversación reciente (lo que realmente pasó en WhatsApp):\n")
        + (hist.transcripcion(msgs) or "(vacía)"),
        "Mensajes nuevos del cliente que debes responder ahora:\n"
        + ("\n".join(f"- {hist.texto_mensaje(m)}" for m in pendientes) or "- (ninguno)"),
    ]
    return "\n\n".join(partes)


def _precios_vigentes_citados(msgs: list[dict]) -> str:
    """
    Precios que Hugo ya dio en la conversación y siguen en el catálogo: evidencia válida.
    Sin esto el supervisor rechazaba repetir un precio ya citado (13 de los 24 rechazos en
    WhatsApp del 1 al 6-oct, casi todos un precio ya dicho) y obligaba a buscar en cada turno.
    """
    from app.agent.ventas_wa import catalogo as cat_mod
    from app.agent.ventas_wa import supervisor as sup

    citados: set[int] = set()
    for m in msgs:
        if hist._rol(m) == "hugo":
            citados |= sup._montos(hist.texto_mensaje(m))
    if not citados:
        return ""
    try:
        vigentes = {int(p.precio) for p in cat_mod.cargar().presentaciones}
    except Exception:
        return ""
    ok = sorted(citados & vigentes)
    if not ok:
        return ""
    return "Precios del catálogo vigente que Hugo ya citó en la conversación: " + ", ".join(
        f"${n:,}".replace(",", ".") for n in ok
    )


def _texto_final(resp) -> str:
    return "\n".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()


# Promesas de tiempo que nadie garantiza (el equipo no siempre responde rápido).
# El prompt las prohíbe; esto es la red de seguridad determinista.
_PAT_PROMESA_TIEMPO = re.compile(
    r"[^.!?;\n]*\b(?:en\s+un\s+momento|en\s+breve|enseguida|ya\s+mismo|en\s+unos\s+minutos|"
    r"le\s+confirmo\s+m[aá]s\s+tarde|le\s+escribo\s+m[aá]s\s+tarde)\b[^.!?;\n]*[.!?]?",
    re.IGNORECASE,
)


def _sin_promesas(t: str) -> str:
    t = _PAT_PROMESA_TIEMPO.sub("", t or "")
    t = re.sub(r";\s*(?=\n|$)", ".", t)
    t = re.sub(r"[ \t]{2,}", " ", t)
    return re.sub(r"\n{3,}", "\n\n", t).strip()


def limpiar_para_whatsapp(texto: str) -> str:
    t = re.sub(r"\*\*(.+?)\*\*", r"*\1*", texto or "")
    t = re.sub(r"^#{1,6}\s*", "", t, flags=re.M)
    return _sin_promesas(t)


def limpiar_para_web(texto: str) -> str:
    return _sin_promesas(re.sub(r"^#{1,6}\s*", "", texto or "", flags=re.M))


def ejecutar_turno(
    jid: str,
    display: str,
    msgs: list[dict],
    *,
    modo: str = "activo",
    canal: str = "whatsapp",
    pagina: str = "",
    cliente=None,
    retomando_min: int | None = None,
) -> ResultadoTurno:
    from app.agent.ventas_wa import supervisor as sup
    from app.services.llm_budget import permitir_llamada, registrar_llamada, usage_anthropic

    ctx = hz.ContextoTurno(jid=jid, display=display, modo=modo, canal=canal)
    res = ResultadoTurno(respuesta=None)
    cliente = cliente if cliente is not None else _cliente_anthropic()
    mod = modelo(canal)
    if cliente is None:
        res.error = "sin ANTHROPIC_API_KEY"

    retomando = retomando_min is not None and canal != "web"
    contexto = contexto_turno(jid, display, msgs, canal, pagina, retomando_min=retomando_min if retomando else None)
    pedido_inicial = ped_mod.activo(jid, crear=False)
    # Lo que escribió el asesor humano es evidencia válida: sus precios y tarifas mandan.
    dicho_por_asesor = "\n".join(hist.texto_mensaje(m) for m in msgs if hist._rol(m) == "asesor")
    # Lo que el cliente escribió en este turno también: repetirle su propia cifra
    # ("los $78.000 que menciona los revisa el asesor") no es inventar un precio.
    dicho_por_cliente = "\n".join(hist.texto_mensaje(m) for m in hist.pendientes_del_cliente(msgs))
    evidencia_base = "\n".join(
        x for x in [
            pedido_inicial.resumen() if pedido_inicial else "",
            f"ASESOR escribió:\n{dicho_por_asesor}" if dicho_por_asesor else "",
            f"CLIENTE escribió en este turno:\n{dicho_por_cliente}" if dicho_por_cliente else "",
            _precios_vigentes_citados(msgs),
        ] if x
    )
    messages: list[dict] = [{"role": "user", "content": contexto}]
    prompt = SYSTEM_PROMPT_WEB if canal == "web" else SYSTEM_PROMPT
    system = [{"type": "text", "text": prompt, "cache_control": {"type": "ephemeral"}}]
    herramientas = hz.definiciones(canal, retomando=retomando)
    limpiar = limpiar_para_web if canal == "web" else limpiar_para_whatsapp
    effort = os.getenv("WA_V2_EFFORT", "medium").strip() or "medium"
    textos: list[str] = []
    correcciones = 0

    while cliente is not None and res.llamadas < MAX_LLAMADAS:
        ok, motivo = permitir_llamada(mod, contexto=CONTEXTO_BUDGET)
        if not ok:
            res.error = f"presupuesto: {motivo[:150]}"
            break
        try:
            resp = cliente.messages.create(
                model=mod,
                max_tokens=8000,
                system=system,
                tools=herramientas,
                messages=messages,
                output_config={"effort": effort},
                # Caché automática del prefijo (herramientas + sistema + contexto del
                # turno): las llamadas 2..n del mismo turno lo leen al ~10% del costo.
                cache_control={"type": "ephemeral"},
            )
        except Exception as e:
            res.error = f"{type(e).__name__}: {str(e)[:200]}"
            log_json("wa_v2_llm_error", jid=jid[-20:], error=res.error)
            break
        res.llamadas += 1
        t_in, t_out = usage_anthropic(resp)
        res.tokens_in += t_in
        res.tokens_out += t_out
        registrar_llamada(mod, tokens_in=t_in, tokens_out=t_out, contexto=CONTEXTO_BUDGET)

        texto_parcial = _texto_final(resp)
        if texto_parcial:
            textos.append(texto_parcial)
        # stop_reason=tool_use sin bloques tool_use dejaba un mensaje de usuario vacío y
        # tumbaba el turno con un 400 (3-oct, turno 163): se toma como respuesta final.
        usos = [b for b in resp.content if getattr(b, "type", "") == "tool_use"]
        if resp.stop_reason == "tool_use" and usos:
            messages.append({"role": "assistant", "content": resp.content})
            resultados = []
            for b in usos:
                salida, es_error = hz.ejecutar(ctx, b.name, dict(b.input or {}))
                bloque = {"type": "tool_result", "tool_use_id": b.id, "content": salida or "(sin resultado)"}
                if es_error:
                    bloque["is_error"] = True
                resultados.append(bloque)
            messages.append({"role": "user", "content": resultados})
            if ctx.omitido:
                res.omitido = ctx.omitido
                break
            continue
        if resp.stop_reason == "refusal":
            res.error = "refusal"
            break
        if ctx.omitido:
            res.omitido = ctx.omitido
            break
        # El modelo a veces escribe el mensaje al cliente junto a la última
        # llamada de herramienta y cierra con una frase corta: se envía todo.
        borrador = limpiar("\n\n".join(textos))
        if not borrador:
            res.error = f"sin texto (stop_reason={resp.stop_reason})"
            break

        # --- Supervisión: reglas siempre; IA si la respuesta es de riesgo o si se retoma un chat del asesor ---
        pedido = ped_mod.activo(jid, crear=False)
        evidencia = "\n".join([evidencia_base, *ctx.evidencia])
        rev = sup.revisar_reglas(borrador, evidencia=evidencia, cliente=pedido.cliente if pedido else {})
        if rev.ok and (retomando or sup.es_de_riesgo(borrador, ctx.llamadas_herramientas)):
            rev, s_in, s_out = sup.revisar_ia(borrador, contexto=contexto, evidencia=evidencia, canal=canal, retomando=retomando)
            res.tokens_in += s_in
            res.tokens_out += s_out
        if rev.ok:
            res.respuesta = borrador
            break
        res.supervision.append({"nivel": rev.nivel, "problemas": rev.problemas, "borrador": borrador[:1500]})
        log_json("wa_v2_supervisor_rechazo", jid=jid[-20:], nivel=rev.nivel, problemas=" | ".join(rev.problemas)[:300])
        if correcciones >= 1 or res.llamadas >= MAX_LLAMADAS:
            res.error = f"supervisor ({rev.nivel}): " + "; ".join(rev.problemas)[:250]
            break
        correcciones += 1
        textos = []
        messages.append({"role": "assistant", "content": resp.content})
        messages.append(
            {
                "role": "user",
                "content": "[SUPERVISOR DE CALIDAD] Tu respuesta no puede enviarse así:\n- "
                + "\n- ".join(rev.problemas)
                + "\nCorrígela (usa herramientas si necesitas verificar) y escribe de nuevo el mensaje completo para el cliente.",
            }
        )
    else:
        if cliente is not None and res.respuesta is None and not res.error:
            res.error = "demasiadas llamadas en el turno"

    res.herramientas = ctx.llamadas_herramientas
    if res.omitido:
        res.respuesta = None
    elif res.respuesta is None and retomando:
        # Al retomar un chat del asesor, ante cualquier falla es mejor callar que mandar el respaldo.
        res.omitido = f"sin respuesta confiable al retomar ({res.error})"
    elif res.respuesta is None:
        res.respuesta = _respaldo(ctx, res)
    res.handoff = ctx.handoff
    res.acciones = ctx.acciones
    return res


def _respaldo(ctx: hz.ContextoTurno, res: ResultadoTurno) -> str:
    """Sin una respuesta confiable no se inventa: se ofrece un humano y se dice la verdad."""
    if ctx.canal == "web":
        if not any(a.get("tipo") == "whatsapp" for a in ctx.acciones):
            hz.ejecutar(ctx, "continuar_por_whatsapp", {"motivo": f"el asistente no pudo responder ({res.error})"})
        return (
            "Veci, en este momento no puedo resolverlo bien por aquí. Con el botón de WhatsApp "
            "sigue con un asesor, que retoma su consulta sin volver a preguntarle nada. 🙏"
        )
    if not ctx.handoff:
        hz.ejecutar(
            ctx,
            "pasar_a_asesor",
            {"tipo": "otro", "resumen_para_asesor": f"El asistente IA no pudo responder ({res.error}). Revisar el chat."},
        )
    # «No puedo procesar su mensaje» sonaba a sistema caído ante un simple «1» (5-oct).
    horario = "" if en_horario_equipo() else " (lunes a viernes, 8:00 a 18:00)"
    return f"Veci, para responderle con exactitud le paso su mensaje al equipo: un asesor sigue con usted por este mismo chat{horario}. 🙏"
