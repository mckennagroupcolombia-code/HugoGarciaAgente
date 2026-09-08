"""
Motor de Resolución de Anulaciones (RA).

Detecta, clasifica, decide y emite. Un solo camino para todo evento que anula
o reduce una venta ya facturada, en vez de los cuatro que competían por el
mismo trabajo y por eso perdían casos (ver `docs/agentic/modules/anulaciones-nc.md`).

Tres decisiones de diseño que hay que respetar al tocar este archivo:

1. EL DISPARADOR ES EL REINTEGRO, NO EL ESTADO DE LA ORDEN.
   `scripts/emitir_notas_credito_cron.py` partía de `order.status == "cancelled"`.
   Una devolución deja la orden PAGADA con un reclamo encima, así que nunca
   entraba al barrido — por eso el pack 2000014813807951 quedó sin nota crédito
   y sin rastro. La pregunta contable es "¿al comprador le devolvieron dinero,
   y cuánto?", observable en `order.payments[].status == "refunded"`, y el
   monto distingue total de parcial sin lógica extra.

2. TRES EJES INDEPENDIENTES.
   Fiscal (¿hubo reintegro? → nota crédito), inventario (¿volvió el producto?
   → reingreso o baja) y económico (¿quién puso la plata? → perdida propia o
   ingreso por compensación de MeLi). Un reembolso a cargo de MeLi anula la
   venta IGUAL; lo que MeLi reconoce es un ingreso aparte, no la venta original
   sobreviviendo. Son dos asientos, no uno neteado.

3. LA DECISIÓN DE EMITIR ES DETERMINISTA.
   `evaluar_autonomia()` es código, no criterio de un modelo. El LLM redacta el
   relato y explica el caso; NO autoriza la emisión ni fija el monto. Los
   campos duros (montos, ids, CUFE, fechas) se llenan desde la API. Un relato
   que los contradiga es un bug.

Gateado por `RA_EMISION_ACTIVA` (default `0` = modo sombra): mientras esté en
0, clasifica, decide y deja el expediente en `lista`, pero no llama a Alegra.
Precedente que justifica el default: en abril/2026 se asumió que unos tópicos
de MeLi estaban suscritos y no era cierto, dejando flujos rotos en silencio
durante semanas. Encender solo tras ver expedientes reales bien clasificados.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta
from typing import Any

from app.services import anulaciones_db as adb

# Cuenta PUC de devoluciones en ventas (contra-ingreso). Sembrada por
# `contabilidad_core._migrar_cuentas_v3_anulaciones`.
CUENTA_DEVOLUCIONES_VENTAS = "4175"
CUENTA_BANCOS = "1110"
CUENTA_INGRESOS_DIVERSOS = "4295"


# ── Configuración ─────────────────────────────────────────────────────────────


def emision_activa() -> bool:
    return (os.getenv("RA_EMISION_ACTIVA", "0") or "0").strip() == "1"


def umbral_autonomia() -> float:
    """Monto máximo que el motor emite sin aprobación humana."""
    try:
        return float(os.getenv("RA_UMBRAL_AUTONOMIA", "300000") or "300000")
    except ValueError:
        return 300000.0


def margen_horas() -> float:
    """Reusa la variable que ya existía para el cron viejo, para no tener dos
    márgenes distintos conviviendo con nombres parecidos."""
    try:
        return float(os.getenv("NOTAS_CREDITO_MARGEN_HORAS", "48") or "48")
    except ValueError:
        return 48.0


# ── 1. Detección: el reintegro ────────────────────────────────────────────────


def reintegro_de_orden(orden: dict) -> dict:
    """Extrae el reintegro de una orden MeLi.

    Devuelve {"hubo": bool, "monto": float, "fecha": str|None, "fuente": str}.

    Mira `payments[]` porque es donde el dinero se mueve de verdad. `status ==
    "cancelled"` es solo UNA de las formas en que aparece un reintegro (y no
    aparece en devoluciones ni en reclamos resueltos a favor del comprador), así
    que se usa como señal secundaria, nunca como única.
    """
    monto = 0.0
    fecha = None
    for p in (orden.get("payments") or []):
        estado = str(p.get("status") or "").lower()
        devuelto = float(p.get("transaction_amount_refunded") or 0)
        if estado in ("refunded", "charged_back") and devuelto <= 0:
            # Pago marcado como devuelto sin desglose del monto → se toma el total.
            devuelto = float(p.get("transaction_amount") or 0)
        if devuelto > 0:
            monto += devuelto
            f = p.get("date_last_modified") or p.get("date_approved") or p.get("date_created")
            if f and (fecha is None or str(f) > str(fecha)):
                fecha = f
    if monto > 0:
        return {"hubo": True, "monto": round(monto, 2), "fecha": fecha, "fuente": "payments"}

    if str(orden.get("status") or "").lower() == "cancelled":
        # Cancelada sin reintegro visible en payments: pasa cuando MeLi aún no
        # refleja el movimiento. Se toma el total de la orden y la fecha real de
        # cancelación (`cancel_detail.date`, no `date_closed`: usar date_closed
        # adelanta el margen de seguridad, ver el cron viejo).
        return {
            "hubo": True,
            "monto": round(float(orden.get("total_amount") or 0), 2),
            "fecha": (orden.get("cancel_detail") or {}).get("date") or orden.get("date_closed"),
            "fuente": "status_cancelled",
        }

    return {"hubo": False, "monto": 0.0, "fecha": None, "fuente": ""}


# ── 2. Clasificación: la matriz de situaciones ────────────────────────────────


def clasificar(orden: dict, reintegro: dict, *, claim: dict | None = None) -> dict:
    """Aplica la matriz de situaciones documentada en la ficha del módulo.

    Devuelve {"motivo", "alcance", "producto_retorna", "financia", "emite_nc"}.
    Función PURA: no toca red ni base de datos, para poder testearla con dicts.
    """
    total = float(orden.get("total_amount") or 0)
    monto = float(reintegro.get("monto") or 0)
    estado_orden = str(orden.get("status") or "").lower()
    claim = claim or {}
    tipo_claim = str(claim.get("type") or "").lower()
    resolucion = str(
        (claim.get("resolution") or {}).get("reason")
        or (claim.get("resolution") or {}).get("expected_resolution")
        or ""
    ).lower()
    beneficiado = str((claim.get("resolution") or {}).get("benefited") or "").lower()
    envio_retorno = bool(claim.get("return_shipment") or claim.get("returns"))

    # Reclamo cerrado a favor del vendedor: NO se emite nota crédito. Es la
    # trampa que tenía el flujo viejo — `crear_accion_anular_factura_por_reclamo`
    # pedía anular la factura al ABRIR el reclamo, no al resolverse. Si alguien
    # trabajaba ese ticket obedientemente, anulaba ventas vivas.
    if not reintegro.get("hubo"):
        if claim and beneficiado in ("seller", "respondent"):
            return _clas("desconocido", "", None, "", emite_nc=False,
                         nota="Reclamo cerrado a favor del vendedor: no hubo reintegro, no aplica nota crédito.")
        return _clas("desconocido", "", None, "", emite_nc=False,
                     nota="Sin reintegro confirmado todavía: no hay hecho contable que revertir.")

    # Cambio de producto por el mismo valor: la factura sigue siendo válida.
    if resolucion == "change_product" and monto <= 0:
        return _clas("cambio_producto", "", None, "vendedor", emite_nc=False,
                     nota="Cambio de producto sin reintegro: la factura original sigue válida.")

    parcial = total > 0 and monto > 0 and monto < (total - 0.5)
    alcance = "parcial" if parcial else "total"

    # ¿Quién financia? MeLi lo indica cuando cubre el reembolso; si no lo dice,
    # se asume el vendedor (el caso mayoritario) y queda registrado para que
    # la conciliación de cobros lo corrija si hace falta.
    financia = "meli" if str(claim.get("refund_at") or "").lower() == "meli" or \
        str(claim.get("player_responsible") or "").lower() in ("meli", "mercadolibre") else "vendedor"

    if parcial:
        return _clas("devolucion_parcial", alcance, True, financia, emite_nc=True,
                     nota=f"Reintegro parcial de ${monto:,.0f} sobre una factura de ${total:,.0f}.")

    if financia == "meli":
        return _clas("reembolso_meli", alcance, envio_retorno or None, "meli", emite_nc=True,
                     nota="Reembolso a cargo de Mercado Libre: la venta al comprador se anula igual; "
                          "la compensación de MeLi es un ingreso aparte, no la venta sobreviviendo.")

    # Cancelada antes de que saliera el envío: el producto nunca salió.
    envio = orden.get("shipping") or {}
    estado_envio = str(envio.get("status") or "").lower()
    if estado_orden == "cancelled" and estado_envio in ("", "pending", "handling", "cancelled", "to_be_agreed"):
        return _clas("cancelacion_pre_despacho", alcance, False, "vendedor", emite_nc=True,
                     nota="Cancelada antes del despacho: el producto no salió de bodega.")

    if tipo_claim == "return" or resolucion in ("return_product", "refund") or envio_retorno:
        if envio_retorno or resolucion == "return_product":
            return _clas("devolucion_producto", alcance, True, "vendedor", emite_nc=True,
                         nota="Devolución con retorno del producto: el reingreso de inventario se "
                              "registra cuando llegue físicamente, no al emitir la nota crédito.")
        return _clas("reembolso_sin_devolucion", alcance, False, "vendedor", emite_nc=True,
                     nota="Reintegro sin devolución del producto: el inventario NO reingresa, "
                          "se da de baja como pérdida.")

    return _clas("devolucion_producto", alcance, None, "vendedor", emite_nc=True,
                 nota="Reintegro total confirmado; falta saber si el producto retorna.")


def _clas(motivo, alcance, retorna, financia, *, emite_nc, nota="") -> dict:
    return {
        "motivo": motivo,
        "alcance": alcance,
        "producto_retorna": (None if retorna is None else int(bool(retorna))),
        "financia": financia,
        "emite_nc": emite_nc,
        "nota": nota,
    }


# ── 3. Política de autonomía: determinista, en código ─────────────────────────

MOTIVOS_AUTONOMOS = ("cancelacion_pre_despacho", "devolucion_producto", "reembolso_sin_devolucion")


def evaluar_autonomia(caso: dict) -> dict:
    """¿Puede el motor emitir esta nota crédito sin aprobación humana?

    Devuelve {"autonomia": "automatica"|"aprobada"|"manual", "motivos": [...]}.
    `manual` = requiere decisión humana ANTES de tocar Alegra.

    Esta función es la frontera de la autonomía del sistema. No la relaje sin
    entender qué caso concreto la hizo necesaria — cada regla de abajo
    corresponde a un riesgo real documentado en la ficha del módulo.
    """
    razones: list[str] = []

    if caso.get("motivo") not in MOTIVOS_AUTONOMOS:
        razones.append(f"motivo '{caso.get('motivo')}' fuera de la lista blanca")
    if caso.get("alcance") == "parcial":
        razones.append("devolución parcial: la nota crédito debe ir por líneas, no por el total")
    if caso.get("financia") == "meli":
        razones.append(
            "reembolso a cargo de MeLi: el tratamiento del ingreso por compensación "
            "lo define el contador, no el sistema"
        )
    if caso.get("factura_proveedor") == "siigo":
        razones.append(
            "factura de la era Siigo: exige nota crédito sin referencia en Alegra, "
            "con el CUFE original en observaciones"
        )
    monto = float(caso.get("monto_reintegrado") or caso.get("factura_total") or 0)
    if monto > umbral_autonomia():
        razones.append(f"monto ${monto:,.0f} supera el umbral de ${umbral_autonomia():,.0f}")
    doc = str(caso.get("cliente_doc") or "").strip()
    nit_generico = (os.getenv("SIIGO_MELI_NIT_CONSUMIDOR_FINAL") or "222222222222").strip()
    if doc and doc != nit_generico:
        razones.append("cliente con identificación real (no consumidor final): revisar antes de anular")

    if not razones:
        return {"autonomia": "automatica", "motivos": []}
    return {"autonomia": "manual", "motivos": razones}


def paso_el_margen(caso: dict, fecha_reintegro: str | None) -> bool:
    """El margen de seguridad da tiempo a que contabilidad resuelva el caso a
    mano si ya lo estaba trabajando."""
    if not fecha_reintegro:
        return True
    try:
        f = datetime.fromisoformat(str(fecha_reintegro).replace("Z", "+00:00"))
    except ValueError:
        return True
    ahora = datetime.now(f.tzinfo) if f.tzinfo else datetime.now()
    return (ahora - f) >= timedelta(hours=margen_horas())


# ── 4. El relato ──────────────────────────────────────────────────────────────

_ETIQUETA_MOTIVO = {
    "cancelacion_pre_despacho": "cancelacion antes del despacho",
    "devolucion_producto": "devolucion del producto",
    "reembolso_sin_devolucion": "reintegro sin devolucion del producto",
    "reembolso_meli": "reembolso a cargo de Mercado Libre",
    "devolucion_parcial": "devolucion parcial",
    "cambio_producto": "cambio de producto",
    "desconocido": "anulacion",
}


def relato_para_observaciones(caso: dict, *, limite: int | None = None) -> str:
    """El relato que va DENTRO del documento electrónico.

    Es lo único que el contador ve del caso cuando revisa en Alegra, así que
    lleva plantilla fija y sin adornos: qué venta, qué factura original (con
    CUFE, el hilo entre Siigo y Alegra), por qué, qué pasó con el producto y
    el código del expediente para ampliar.

    Sin tildes a propósito: el documento electrónico viaja por varios sistemas
    (Alegra → DIAN → PDF → MeLi) y los acentos se han corrompido antes.
    """
    if limite is None:
        try:
            from app.services.alegra import MAX_OBSERVACIONES_NC_ALEGRA as limite  # type: ignore
        except Exception:
            limite = 500

    ref = caso.get("pack_id") or caso.get("order_id") or caso.get("referencia") or ""
    lineas = [f"NC por {_ETIQUETA_MOTIVO.get(caso.get('motivo'), 'anulacion')} - venta MeLi {ref}".strip()]
    if caso.get("claim_id"):
        lineas[0] += f" - reclamo {caso['claim_id']}"

    if caso.get("factura_numero"):
        prov = (caso.get("factura_proveedor") or "").capitalize()
        trozo = f"Factura {caso['factura_numero']}"
        if prov:
            trozo += f" ({prov})"
        if caso.get("factura_cufe"):
            trozo += f" CUFE {caso['factura_cufe']}"
        if caso.get("factura_fecha"):
            trozo += f" del {str(caso['factura_fecha'])[:10]}"
        if caso.get("factura_total"):
            trozo += f" por ${float(caso['factura_total']):,.0f}"
        lineas.append(trozo)

    if caso.get("monto_reintegrado"):
        quien = "Mercado Libre" if caso.get("financia") == "meli" else "el vendedor"
        lineas.append(f"Reintegro al comprador de ${float(caso['monto_reintegrado']):,.0f} a cargo de {quien}")

    retorna = caso.get("producto_retorna")
    if retorna == 1:
        lineas.append("El producto retorna a bodega; reingreso de inventario al recibirlo")
    elif retorna == 0:
        lineas.append("El producto no retorna; se da de baja del inventario")

    lineas.append(
        f"Expediente {caso.get('codigo', '')} - "
        + ("emitida automaticamente" if caso.get("autonomia") == "automatica" else "emitida con aprobacion")
    )

    texto = "\n".join(lineas)
    if len(texto) <= limite:
        return texto
    # Recortar por líneas completas antes que cortar una frase por la mitad:
    # un relato cortado a la mitad es peor que uno corto.
    while len(lineas) > 2 and len("\n".join(lineas)) > limite:
        lineas.pop(-2)
    return "\n".join(lineas)[:limite]


def relato_largo(caso: dict, eventos: list[dict] | None = None) -> str:
    """El relato completo del expediente: para el panel, para el ticket y para
    el próximo agente que abra el caso."""
    partes = [relato_para_observaciones(caso, limite=10_000)]
    if caso.get("bloqueo_motivo"):
        partes.append(f"Bloqueado por: {caso['bloqueo_motivo']}")
    if caso.get("nc_numero"):
        partes.append(f"Nota credito {caso['nc_numero']} ({caso.get('nc_proveedor') or ''}) - {caso.get('nc_url') or ''}")
    if caso.get("movimiento_id"):
        partes.append(f"Asiento contable {caso['movimiento_id']} en el libro mayor propio.")
    for ev in (eventos or []):
        partes.append(f"[{ev.get('ts', '')[:16]}] {ev.get('actor', '')}: {ev.get('resumen', '')}")
    return "\n".join(p for p in partes if p)


# ── 5. Emisión ────────────────────────────────────────────────────────────────


def emitir(caso_id: int, *, actor: str = "cron", forzar: bool = False) -> dict:
    """Emite la nota crédito del expediente y deja todo registrado.

    Secuencia: revalida autonomía → doble chequeo de NC existente → emite en
    Alegra (con o sin referencia según dónde viva la factura) → sube el PDF a
    MeLi → postea el asiento en el libro mayor propio.

    Cada paso que falla deja el expediente en `bloqueada` con el motivo
    estructurado, nunca perdido dentro del texto de un ticket — que es lo que
    pasaba con el `read_only` de Siigo, reintentado a ciegas cada corrida.
    """
    caso = adb.obtener(caso_id)
    if not caso:
        return {"ok": False, "error": f"Expediente {caso_id} no existe."}
    if caso["estado"] in ("emitida", "subida_meli", "posteado_libro", "cerrada"):
        return {"ok": True, "ya_emitida": True, "nc_numero": caso.get("nc_numero")}

    politica = evaluar_autonomia(caso)
    if politica["autonomia"] != "automatica" and not forzar:
        adb.transicionar(
            caso_id, "requiere_decision", actor=actor,
            resumen="Fuera de la politica de autonomia: " + "; ".join(politica["motivos"]),
            autonomia="manual", datos=politica,
        )
        return {"ok": False, "requiere_decision": True, "motivos": politica["motivos"]}

    if not emision_activa():
        adb.registrar_evento(
            caso_id, tipo="decidido", actor=actor, dedupe=True,
            resumen="Modo sombra (RA_EMISION_ACTIVA=0): se habria emitido la nota credito ahora.",
        )
        return {"ok": True, "modo_sombra": True}

    from app.services.alegra import (
        buscar_nota_credito_existente_alegra,
        crear_nota_credito_alegra,
        crear_nota_credito_sin_referencia_alegra,
    )

    # Doble chequeo justo antes del POST. La corrida manual del 10-ago-2026
    # generó 4 notas crédito duplicadas exactamente por no tenerlo: alguien las
    # estaba haciendo a mano en paralelo.
    if caso.get("factura_proveedor") == "alegra" and caso.get("factura_id"):
        existente = buscar_nota_credito_existente_alegra(caso["factura_id"])
        if existente:
            numero = (existente.get("numberTemplate") or {}).get("fullNumber") or ""
            adb.transicionar(
                caso_id, "emitida", actor=actor,
                resumen=f"La factura ya tenia la nota credito {numero} (resuelta por otra via).",
                tipo_evento="emitido", nc_proveedor="alegra",
                nc_id=str(existente.get("id") or ""), nc_numero=numero,
                nc_total=float(existente.get("total") or 0),
                nc_url=f"https://app.alegra.com/credit-note/view/id/{existente.get('id')}",
            )
            return {"ok": True, "ya_existia": True, "nc_numero": numero}

    adb.transicionar(caso_id, "emitiendo", actor=actor, resumen="Emitiendo nota credito en Alegra.")
    caso = adb.obtener(caso_id)
    observaciones = relato_para_observaciones(caso)

    if caso.get("factura_proveedor") == "alegra" and caso.get("factura_id"):
        resultado = crear_nota_credito_alegra(factura_id=caso["factura_id"], motivo=observaciones)
    else:
        # Factura de la era Siigo (o sin factura localizable en Alegra): la
        # cuenta de Siigo está en solo lectura desde la migración, así que la
        # única vía es una nota crédito sin referencia en Alegra.
        resultado = crear_nota_credito_sin_referencia_alegra(
            cliente_nombre=caso.get("cliente_nombre") or "",
            cliente_identificacion=caso.get("cliente_doc") or "",
            total=float(caso.get("monto_reintegrado") or caso.get("factura_total") or 0),
            motivo=observaciones,
        )

    if not resultado.get("ok"):
        motivo_bloqueo = _motivo_bloqueo(resultado)
        adb.transicionar(
            caso_id, "bloqueada", actor=actor, tipo_evento="fallo",
            resumen=f"Fallo la emision: {str(resultado.get('error'))[:400]}",
            bloqueo_motivo=motivo_bloqueo, datos={"resultado": resultado},
        )
        return {"ok": False, "error": resultado.get("error"), "bloqueo": motivo_bloqueo}

    caso = adb.transicionar(
        caso_id, "emitida", actor=actor, tipo_evento="emitido",
        resumen=f"Nota credito {resultado.get('name')} emitida en Alegra ({resultado.get('status')}).",
        nc_proveedor="alegra", nc_id=str(resultado.get("credit_note_id") or ""),
        nc_numero=str(resultado.get("name") or ""), nc_cufe=str(resultado.get("cufe") or ""),
        nc_total=float(resultado.get("total") or 0), nc_url=str(resultado.get("url") or ""),
    )

    _subir_a_meli(caso, actor=actor)
    postear_asiento(caso["id"], actor=actor)
    return {"ok": True, "nc_numero": caso.get("nc_numero"), "nc_url": caso.get("nc_url")}


def _motivo_bloqueo(resultado: dict) -> str:
    """Clasifica el fallo para que quede estructurado y reintentable, en vez de
    perderse dentro del texto libre de un ticket."""
    texto = str(resultado.get("error") or "").lower()
    if resultado.get("requiere_descubrimiento"):
        return "falta_tipo_nc_sin_referencia"
    if "read_only" in texto or "read-only" in texto:
        return "proveedor_read_only"
    if "parameter_inactive" in texto or "inactive" in texto:
        return "item_inactivo"
    if "cliente" in texto or "contact" in texto:
        return "cliente_inexistente"
    if "item_generico" in texto or "ALEGRA_NC_ITEM_GENERICO_SKU" in str(resultado.get("error") or ""):
        return "falta_item_generico"
    return "error_proveedor"


def _subir_a_meli(caso: dict, *, actor: str) -> None:
    """Sube el PDF de la nota crédito al pack en MeLi.

    Sin esto el proveedor queda con la nota crédito correcta pero MeLi sigue
    mostrando solo la factura original en "ver factura", como si la anulación
    nunca se hubiera resuelto. MeLi admite UN solo documento fiscal por pack
    (409 "there can be only one fiscal_document per pack"), así que hay que
    borrar el anterior antes de subir. El proveedor conserva ambos documentos.
    """
    pack_id = caso.get("pack_id")
    nc_id = caso.get("nc_id")
    if not pack_id or not nc_id:
        return
    try:
        from app.services.alegra import descargar_nota_credito_pdf_alegra
        from app.services.meli import subir_factura_meli, eliminar_documentos_fiscales_meli

        pdf_b64 = descargar_nota_credito_pdf_alegra(nc_id)
        if not pdf_b64:
            raise RuntimeError("No se pudo descargar el PDF de la nota credito en Alegra.")
        ok, err = eliminar_documentos_fiscales_meli(pack_id)
        if not ok:
            raise RuntimeError(f"No se pudo borrar el documento fiscal anterior en MeLi: {err}")
        res = subir_factura_meli(pack_id, pdf_b64, formato="pdf", prefijo_archivo="NC")
        if "✅" not in str(res):
            raise RuntimeError(f"MeLi rechazo la subida: {res}")
    except Exception as e:
        adb.registrar_evento(
            caso["id"], tipo="fallo", actor=actor, dedupe=True,
            resumen=f"Nota credito emitida pero no se pudo publicar en MeLi: {e}",
        )
        return
    adb.transicionar(
        caso["id"], "subida_meli", actor=actor, tipo_evento="subido_meli",
        resumen="Nota credito publicada en MeLi (reemplaza la factura en 'ver factura').",
    )


def postear_asiento(caso_id: int, *, actor: str = "cron") -> dict:
    """Postea la nota crédito en el libro mayor propio de partida doble.

    Débito 4175 (devoluciones en ventas, contra-ingreso) contra crédito 1110
    (Bancos) — el dinero salió. El módulo es parte del libro, no un satélite de
    Alegra.

    Si el reembolso lo financió MeLi, se postea ADEMÁS un segundo asiento por
    la compensación (débito Bancos / crédito 4295 ingresos diversos). Son dos
    asientos, no uno neteado: la venta al comprador se anula igual, y lo que
    MeLi reconoce es un ingreso aparte.
    """
    caso = adb.obtener(caso_id)
    if not caso:
        return {"ok": False, "error": "expediente inexistente"}
    if caso.get("movimiento_id"):
        return {"ok": True, "ya_posteado": True}
    monto = float(caso.get("nc_total") or caso.get("monto_reintegrado") or 0)
    if monto <= 0:
        return {"ok": False, "error": "monto en cero, no hay asiento que postear"}

    try:
        from app.services import contabilidad_core as cc

        cc._ensure()
        cuentas = {c["codigo"]: c["id"] for c in cc.listar_plan_cuentas(solo_activas=False)}
        faltantes = [c for c in (CUENTA_DEVOLUCIONES_VENTAS, CUENTA_BANCOS) if c not in cuentas]
        if faltantes:
            raise ValueError(f"Faltan cuentas PUC {faltantes} (¿corrió la migración de contabilidad_core?)")

        referencia = f"ra:{caso['codigo']}"
        fecha = datetime.now().strftime("%Y-%m-%d")
        cc.crear_movimiento(
            fecha=fecha,
            concepto=f"Nota credito {caso.get('nc_numero') or ''} - {caso['codigo']}".strip(),
            lineas=[
                {"cuenta_id": cuentas[CUENTA_DEVOLUCIONES_VENTAS], "debito": monto, "credito": 0},
                {"cuenta_id": cuentas[CUENTA_BANCOS], "debito": 0, "credito": monto},
            ],
            referencia=referencia,
            tipo_origen="ra_nota_credito",
            plantilla_datos={"expediente": caso["codigo"], "pack_id": caso.get("pack_id")},
        )

        if caso.get("financia") == "meli" and CUENTA_INGRESOS_DIVERSOS in cuentas:
            cc.crear_movimiento(
                fecha=fecha,
                concepto=f"Compensacion MeLi por reembolso - {caso['codigo']}",
                lineas=[
                    {"cuenta_id": cuentas[CUENTA_BANCOS], "debito": monto, "credito": 0},
                    {"cuenta_id": cuentas[CUENTA_INGRESOS_DIVERSOS], "debito": 0, "credito": monto},
                ],
                referencia=f"{referencia}:compensacion",
                tipo_origen="ra_compensacion_meli",
                plantilla_datos={"expediente": caso["codigo"]},
            )
    except Exception as e:
        adb.registrar_evento(
            caso_id, tipo="fallo", actor=actor, dedupe=True,
            resumen=f"No se pudo postear el asiento contable: {e}",
        )
        return {"ok": False, "error": str(e)}

    adb.transicionar(
        caso_id, "posteado_libro", actor=actor, tipo_evento="posteado_libro",
        resumen=f"Asiento {referencia} posteado en el libro mayor (debito 4175 / credito 1110).",
        movimiento_id=referencia,
    )
    return {"ok": True, "referencia": referencia}


def registrar_retorno_inventario(caso_id: int, *, recibido: bool, actor: str, nota: str = "") -> dict:
    """El eje de inventario, independiente del fiscal.

    El reingreso ocurre cuando el producto LLEGA físicamente, no cuando se
    emite la nota crédito: pueden estar separados por días.
    """
    estado = "reingresado" if recibido else "baja"
    resumen = (
        "Producto recibido en bodega y reingresado a inventario."
        if recibido else
        "El producto no retorna: se da de baja del inventario como perdida."
    )
    adb.actualizar(caso_id, inventario_estado=estado, producto_retorna=int(bool(recibido)), actor=actor)
    adb.registrar_evento(caso_id, tipo="inventario", actor=actor, resumen=f"{resumen} {nota}".strip())
    return adb.obtener(caso_id) or {}


def cerrar_si_completo(caso_id: int, *, actor: str = "cron") -> dict | None:
    """Cierra el expediente cuando ya no queda nada pendiente: nota crédito
    emitida, publicada en MeLi, asiento posteado e inventario resuelto."""
    caso = adb.obtener(caso_id)
    if not caso or caso["estado"] == "cerrada":
        return caso
    if caso["estado"] not in ("emitida", "subida_meli", "posteado_libro"):
        return caso
    if not caso.get("nc_numero") or not caso.get("movimiento_id"):
        return caso
    if caso.get("inventario_estado") == "pendiente" and caso.get("producto_retorna") == 1:
        return caso
    return adb.transicionar(
        caso_id, "cerrada", actor=actor,
        resumen="Caso cerrado: nota credito emitida, asiento posteado e inventario resuelto.",
    )
