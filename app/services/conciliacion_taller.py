"""Tablero del Taller de conciliación: una línea de banco, todo lo que le falta.

La bandeja anterior respondía dos preguntas por separado —«¿qué asiento del
libro calza con qué línea del banco?» (`sugerencias_auto`) y «¿a qué cuenta
mandaría esta línea?» (`extracto_clasificador`)— en dos pantallas distintas, y
el operador tenía que sostener el cruce en la cabeza. Acá se responden juntas,
y del lado del BANCO, que es el lado que se recorre: el extracto es la verdad
externa y lo que se concilia es cada una de sus líneas hasta que no queda
ninguna suelta.

Solo lee. Nada de este módulo escribe en la contabilidad: vincular y causar
siguen pasando por `extracto_bancario.vincular` y las plantillas de
`contabilidad_core`, que son las que ya saben hacerlo bien.

Sobre el tiempo: armar el libro consulta Alegra y MeLi y tarda ~30 s. El
tablero NO espera eso. Responde al instante con lo que está en la base (las
líneas del banco, sus vínculos, la propuesta del clasificador) y arma el libro
en un hilo aparte; la pantalla vuelve a preguntar hasta que `libro_listo`. Y el
libro se guarda acá, aparte de la caché de `armar_libro`: esa se borra cada vez
que se vincula una línea, y en el taller se vincula una línea cada pocos
segundos — con la caché compartida, cada clic volvía a costar 30 s.
"""

from __future__ import annotations

import copy
import threading
import time
from datetime import datetime, timedelta
from typing import Any, Callable

from app.services import extracto_bancario as eb

# Un pago se registra en el libro con la fecha de la factura o de la cuenta de
# cobro, y sale del banco dos o tres días después. Misma ventana que
# `sugerencias_auto`, por la misma razón y medida contra los mismos datos.
VENTANA_DIAS = 7
TOLERANCIA = 0.5

# banco → libro. Un débito es plata que salió: en el libro es un egreso.
_DIRECCION = {"debito": "egreso", "credito": "ingreso"}

# Caché propia del libro (sin el overlay de vínculos, que se pone fresco en
# cada llamada). Cinco minutos: lo que tarda una sesión de conciliación en
# necesitar asientos nuevos de Alegra/MeLi, y mucho menos que lo que tardaría
# volver a pedirlos en cada clic.
_TTL_S = 300.0
_libro_cache: dict[str, tuple[float, list[dict[str, Any]], list[str]]] = {}
_armando: set[str] = set()
_lock = threading.Lock()


def _dias(a: str, b: str) -> int:
    try:
        return abs(
            (datetime.strptime(a[:10], "%Y-%m-%d") - datetime.strptime(b[:10], "%Y-%m-%d")).days
        )
    except ValueError:
        return 999


def _lineas_banco(desde: str, hasta: str, tercero_id: int | None) -> list[dict[str, Any]]:
    """Todas las líneas del rango, vinculadas o no — la bandeja de pendientes
    solo trae las sueltas y el taller necesita mostrar también lo ya resuelto
    para que el avance («23 de 110») signifique algo."""
    eb.ensure_extracto_tables()
    w_tit, p_tit = eb._filtro_titular(tercero_id)
    with eb._conn() as con:
        rows = con.execute(
            f"""SELECT m.*, e.banco, e.cuenta, e.nombre AS extracto_nombre,
                       v.id AS vinculo_id, v.movimiento_id
                  FROM extracto_movimientos m
                  JOIN extractos_bancarios e ON e.id = m.extracto_id
                  LEFT JOIN extracto_vinculos v ON v.extracto_mov_id = m.id
                 WHERE {w_tit} AND m.fecha BETWEEN ? AND ?
                 ORDER BY m.fecha DESC, m.id DESC""",
            (*p_tit, desde, hasta),
        ).fetchall()
    return [dict(r) for r in rows]


def _traer_libro(
    desde: str, hasta: str, *, incluir_meli: bool, incluir_siigo: bool
) -> tuple[list[dict[str, Any]], list[str]]:
    """Libro del rango, ensanchado por la ventana: un pago del 1 puede calzar
    con un asiento del 28 del mes anterior. Es lo lento (Alegra + MeLi)."""
    from app.services.contabilidad_ledger import armar_libro, movimientos_manuales_como_libro

    d = (datetime.strptime(desde, "%Y-%m-%d") - timedelta(days=VENTANA_DIAS)).strftime("%Y-%m-%d")
    h = (datetime.strptime(hasta, "%Y-%m-%d") + timedelta(days=VENTANA_DIAS)).strftime("%Y-%m-%d")
    libro = armar_libro(d, h, incluir_meli=incluir_meli, incluir_siigo=incluir_siigo)
    movs = list(libro.get("movimientos") or []) + list(movimientos_manuales_como_libro(d, h))
    for m in movs:
        if not m.get("id"):
            m["id"] = eb.id_movimiento_ledger(m)
        # El vínculo se pone fresco en cada llamada; lo que se guarda es el libro pelado.
        m.pop("extracto", None)
    movs.extend(_asientos_auto_como_libro(d, h, {str(m["id"]) for m in movs}))
    return movs, list(libro.get("avisos") or [])


def _asientos_auto_como_libro(desde: str, hasta: str, ya: set[str]) -> list[dict[str, Any]]:
    """Los asientos auto-posteados del libro propio, como filas del taller.

    `movimientos_manuales_como_libro` los excluye a propósito —en la Tabla de
    contabilidad ya están representados por su fila de `armar_libro`—, pero
    esa fila solo existe si Alegra o MeLi respondieron a tiempo. Cuando no
    (Alegra se corta a los 28 s), la venta ya causada quedaba invisible para el
    taller y su línea del banco aparecía como «nadie registró esta operación»:
    FE465, 22-sep-2026. Acá se toman del libro propio, que no depende de nadie,
    con el mismo id (el hash que llevan en `referencia = auto:<hash>`), y se
    omiten los que `armar_libro` ya trajo.
    """
    import json

    import app.services.contabilidad_core as cc

    salida: list[dict[str, Any]] = []
    for m in cc.listar_movimientos(desde=desde, hasta=hasta, limit=5000):
        origen = str(m.get("tipo_origen") or "")
        ref = str(m.get("referencia") or "")
        if not origen.startswith("auto_") or not ref.startswith("auto:") or (m.get("estado") or "") == "anulado":
            continue
        mid = ref[5:]
        if mid in ya:
            continue
        try:
            fila = json.loads(m.get("plantilla_datos_json") or "{}") or {}
        except ValueError:
            fila = {}
        lineas = m.get("lineas") or []
        en_banco = [l for l in lineas if str(l.get("cuenta_codigo") or "").startswith("11")]
        entra = sum(float(l.get("debito") or 0) for l in en_banco) >= sum(float(l.get("credito") or 0) for l in en_banco)
        monto = round(max(sum(float(l.get("debito") or 0) for l in en_banco), sum(float(l.get("credito") or 0) for l in en_banco)), 2) or round(float(fila.get("monto") or 0), 2)
        salida.append({
            "id": mid,
            "fecha": str(m.get("fecha") or fila.get("fecha") or "")[:10],
            "tipo": fila.get("tipo") or ("ingreso" if entra else "egreso"),
            "fuente": fila.get("fuente") or origen[5:],
            "concepto": m.get("concepto") or fila.get("concepto") or "",
            "monto": monto,
            "referencia": str(fila.get("referencia") or ""),
            "contraparte": str(fila.get("contraparte") or ""),
            "extra": fila.get("extra") or {},
            "cc_id": m.get("id"),
        })
    return salida


def _documento_de(row: dict[str, Any]) -> dict[str, Any] | None:
    """El documento detrás de una venta: la factura y su cliente.

    Una venta no es «plata que entró»: es una factura a un cliente. Cuando la
    factura salió de una venta directa (cotizar-facturar), ahí están el nombre
    del cliente, su NIT y el enlace a Alegra; el taller los enseña para que
    nadie tenga que elegir un tercero a mano por una venta que ya lo trae.
    """
    if row.get("fuente") not in ("siigo_venta", "web_venta") or not row.get("referencia"):
        return None
    numero = str(row.get("referencia") or "")
    try:
        from app.services import ventas_directas as vd

        with vd._conn() as con:
            fila = con.execute(
                "SELECT numero, cliente, factura_numero, factura_url, factura_id FROM ventas_directas WHERE factura_numero = ? LIMIT 1",
                (numero,),
            ).fetchone()
    except Exception:  # noqa: BLE001 — sin esa base (pruebas) no hay documento que enseñar
        fila = None
    if not fila:
        if row.get("fuente") == "web_venta":
            return {"tipo": "pedido web", "numero": numero, "cliente": {"nombre": row.get("contraparte") or "", "identificacion": ""}, "url": ""}
        return {"tipo": "factura", "numero": numero, "cliente": {"nombre": "", "identificacion": row.get("contraparte") or ""}, "url": ""}
    import json

    try:
        cliente = json.loads(fila["cliente"] or "{}") if isinstance(fila["cliente"], str) else (fila["cliente"] or {})
    except ValueError:
        cliente = {}
    return {
        "tipo": "factura",
        "numero": fila["factura_numero"] or numero,
        "url": fila["factura_url"] or "",
        "cotizacion": fila["numero"] or "",
        "cliente": {"nombre": cliente.get("nombre") or "", "identificacion": cliente.get("identificacion") or (row.get("contraparte") or ""),
                    "correo": cliente.get("correo") or ""},
    }


def _clave(desde: str, hasta: str, incluir_meli: bool, incluir_siigo: bool) -> str:
    return f"{desde}|{hasta}|{int(incluir_meli)}|{int(incluir_siigo)}"


def _armar_en_segundo_plano(clave: str, traer: Callable[[], tuple[list[dict[str, Any]], list[str]]]) -> None:
    """Arranca (una sola vez por clave) el hilo que arma el libro."""
    with _lock:
        if clave in _armando:
            return
        _armando.add(clave)

    def _correr() -> None:
        try:
            movs, avisos = traer()
            with _lock:
                _libro_cache[clave] = (time.time(), movs, avisos)
        except Exception as e:  # noqa: BLE001 — el aviso llega al tablero, no al journal
            with _lock:
                _libro_cache[clave] = (time.time(), [], [f"Libro: {e}"])
        finally:
            with _lock:
                _armando.discard(clave)

    threading.Thread(target=_correr, name=f"taller-libro:{clave}", daemon=True).start()


def _libro_cacheado(clave: str, *, refrescar: bool) -> tuple[list[dict[str, Any]], list[str]] | None:
    with _lock:
        hit = _libro_cache.get(clave)
        if refrescar and hit:
            del _libro_cache[clave]
            return None
    if hit and (time.time() - hit[0]) < _TTL_S:
        return copy.deepcopy(hit[1]), list(hit[2])
    return None


def invalidar_cache_taller() -> None:
    """Para las pruebas y para quien cargue un extracto: el libro no cambia por
    eso, pero vale tenerlo a mano."""
    with _lock:
        _libro_cache.clear()


def _con_vinculos(movs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Le pone a cada asiento su vínculo actual con el banco (fresco, de la base)."""
    vinculos = eb.mapa_vinculos_por_movimiento([str(m["id"]) for m in movs])
    for m in movs:
        m["extracto"] = vinculos.get(str(m["id"]))
    return movs



def _asientos_vinculados(
    lineas_raw: list[dict[str, Any]], libro: list[dict[str, Any]]
) -> dict[str, dict[str, Any]]:
    """El asiento real detrás de cada vínculo, para COMPROBAR, no para confiar.

    Un vínculo es una fila en `extracto_vinculos`; que exista no prueba nada
    sobre el asiento al que apunta: puede haberse anulado, o tener otro monto
    (un PUT en Alegra, una corrección a mano). Acá se va a buscar el asiento y
    se trae con su monto, para que el tablero pueda decir «cuadra al peso» o
    «descuadra $X» línea por línea, y sumar ambos lados.

    Los `cc:<id>` (asientos propios) se leen de la base — siempre, esté o no el
    libro armado. El resto (ventas MeLi, Alegra…) solo se conoce cuando el
    libro está en caché; mientras no, se reporta como «sin verificar».
    """
    ids = [str(l["movimiento_id"]) for l in lineas_raw if l.get("movimiento_id")]
    if not ids:
        return {}
    salida: dict[str, dict[str, Any]] = {}
    por_id = {str(m["id"]): m for m in libro}
    for mid in ids:
        m = por_id.get(mid)
        if m:
            salida[mid] = {
                "fecha": m.get("fecha") or "",
                "concepto": m.get("concepto") or "",
                "fuente": m.get("fuente") or "",
                "tipo": m.get("tipo") or "",
                "monto": round(abs(float(m.get("monto") or 0)), 2),
                "existe": True,
            }
    # Los asientos propios se traen ENTEROS: no basta con que cuadre el total.
    # Lo que se comprueba es cómo quedó —contra qué cuentas, si tocó inventario
    # por SKU o se fue a un gasto genérico, si separó el IVA descontable, si
    # tiene factura cotejada y comprobante, si se espejó en Alegra—, porque una
    # compra causada como «gasto» cuadra al peso igual que una causada contra
    # 1435 con sus productos, y solo la segunda deja el inventario bien.
    import app.services.contabilidad_core as cc

    for mid in ids:
        if mid.startswith("cc:") and mid[3:].isdigit():
            salida[mid] = _detalle_asiento_propio(int(mid[3:]), salida.get(mid))
            continue
        with cc._conn() as con:
            fila = con.execute(
                "SELECT id FROM cc_movimientos WHERE referencia = ? AND estado <> 'anulado' ORDER BY id DESC LIMIT 1",
                (f"auto:{mid}",),
            ).fetchone()
        if fila:
            salida[mid] = _detalle_asiento_propio(int(fila[0]), salida.get(mid))
    return salida


def _detalle_asiento_propio(movimiento_id: int, base: dict[str, Any] | None) -> dict[str, Any]:
    """Un asiento del libro propio con todo lo que hay que mirar de él."""
    import json

    import app.services.contabilidad_core as cc
    from app.services.pagos_wizard import _conn as _conn_pagos

    mov = cc.obtener_movimiento(movimiento_id)
    if not mov:
        return {**(base or {}), "fecha": "", "concepto": "", "fuente": "cc", "tipo": "", "monto": 0.0, "existe": False,
                "lineas": [], "items": [], "cuentas": [], "inventario": False, "iva_descontable": False}
    lineas = [
        {
            "cuenta": l.get("cuenta_codigo") or "",
            "nombre": l.get("cuenta_nombre") or "",
            "debito": round(float(l.get("debito") or 0), 2),
            "credito": round(float(l.get("credito") or 0), 2),
            "tercero": l.get("tercero_nombre") or "",
            "descripcion": l.get("descripcion") or "",
        }
        for l in mov.get("lineas") or []
    ]
    cuentas = sorted({l["cuenta"] for l in lineas if l["cuenta"]})
    # Lo que se compara con el banco es lo que el asiento dice que pasó por el
    # banco (cuentas 11xx), no el total del asiento: una compra con retención
    # debita inventario e IVA por el total de la factura y acredita a bancos
    # solo lo girado. Comparar contra el total marcaba descuadre en cada
    # asiento con retención, que es justo el que estaba bien hecho.
    en_banco = [l for l in lineas if l["cuenta"].startswith("11")]
    monto_banco = round(max(sum(l["credito"] for l in en_banco), sum(l["debito"] for l in en_banco)), 2)
    # La solicitud de pago que lo originó, si la hubo: ahí viven los ítems con
    # SKU, la factura cotejada, el comprobante y el espejo en Alegra.
    sol: dict[str, Any] = {}
    try:
        with _conn_pagos() as con:
            fila = con.execute(
                """SELECT id, categoria, items_json, factura_numero, factura_nombre,
                          alegra_journal_id, comprobante_nombre, estado
                     FROM cc_solicitudes_pago WHERE movimiento_id = ? ORDER BY id DESC LIMIT 1""",
                (movimiento_id,),
            ).fetchone()
            if fila:
                sol = dict(fila)
    except Exception:  # noqa: BLE001 — sin tabla de solicitudes (pruebas) se sigue sin ella
        sol = {}
    try:
        items = json.loads(sol.get("items_json") or "[]")
    except ValueError:
        items = []
    try:
        fila_auto = json.loads(mov.get("plantilla_datos_json") or "{}") if str(mov.get("tipo_origen") or "").startswith("auto_") else {}
    except ValueError:
        fila_auto = {}
    return {
        "fecha": mov.get("fecha") or "",
        "concepto": mov.get("concepto") or "",
        "fuente": mov.get("tipo_origen") or "cc",
        "tipo": "",
        "documento": _documento_de(fila_auto) if fila_auto else None,
        "monto": monto_banco if en_banco else round(float(mov.get("total_debito") or 0), 2),
        "total_asiento": round(float(mov.get("total_debito") or 0), 2),
        # Partida doble: si débitos y créditos no dan lo mismo, alguien tocó una
        # línea por debajo. Un asiento así no cuadra con nada, diga lo que diga bancos.
        "balanceado": abs(float(mov.get("total_debito") or 0) - float(mov.get("total_credito") or 0)) < 0.5,
        "existe": (mov.get("estado") or "confirmado") != "anulado",
        "lineas": lineas,
        "cuentas": cuentas,
        "inventario": any(c.startswith("1435") for c in cuentas),
        "iva_descontable": any(c.startswith("2408") for c in cuentas),
        "items": [
            {"sku": i.get("sku") or "", "nombre": i.get("nombre") or "", "cantidad": i.get("cantidad"), "precio": i.get("precio")}
            for i in items if isinstance(i, dict)
        ],
        "solicitud_id": sol.get("id"),
        "categoria": sol.get("categoria") or "",
        "factura_numero": sol.get("factura_numero") or "",
        "factura_nombre": sol.get("factura_nombre") or "",
        "alegra_journal_id": sol.get("alegra_journal_id") or "",
        "comprobante_nombre": sol.get("comprobante_nombre") or "",
    }


def _comprobar(linea: dict[str, Any], asiento: dict[str, Any] | None) -> dict[str, Any] | None:
    """La verificación de un vínculo: ¿el asiento existe y dice la misma plata?"""
    if not asiento:
        return None
    monto_banco = round(float(linea.get("monto") or 0), 2)
    dif = round(monto_banco - float(asiento.get("monto") or 0), 2)
    return {
        **asiento,
        "diferencia": dif,
        "dias": _dias(str(asiento.get("fecha") or ""), str(linea.get("fecha") or "")) if asiento.get("fecha") else None,
        "cuadra": bool(asiento.get("existe")) and asiento.get("balanceado", True) and abs(dif) < 0.5,
    }



def _cuentas_t(lineas: list[dict[str, Any]], *, posteado: bool) -> list[dict[str, Any]]:
    """Las cuentas T de un asiento, con el saldo de cada cuenta antes y después.

    Es la misma función que usa la solicitud de pago para mostrar el asiento
    antes de aprobarlo. Con `posteado` (el asiento ya está en el libro) el saldo
    «actual» ya lo incluye: se descuenta para que «antes → después» siga
    contando la verdad y no sume el movimiento dos veces.
    """
    from app.services.pagos_wizard import _cuentas_t as base

    salida = base(lineas)
    if posteado:
        for t in salida:
            t["saldo_despues"] = t["saldo_antes"]
            t["saldo_antes"] = round(t["saldo_antes"] - t["efecto"], 2)
    return salida


def _movimiento_propio(mid: str) -> dict[str, Any] | None:
    """El asiento del libro propio detrás de un id del taller.

    `cc:<id>` es un asiento manual (socios, préstamos, solicitudes). Cualquier
    otro id es el hash de una fila de `armar_libro` (venta Alegra, web, MeLi…):
    si el auto-posteo —o la causación en el momento— ya le creó su asiento, ese
    asiento lleva `referencia = auto:<hash>` y es el que se enseña y se
    comprueba, con sus líneas y sus cuentas T.
    """
    import app.services.contabilidad_core as cc

    if mid.startswith("cc:") and mid[3:].isdigit():
        return cc.obtener_movimiento(int(mid[3:]))
    if not mid:
        return None
    with cc._conn() as con:
        fila = con.execute(
            "SELECT id FROM cc_movimientos WHERE referencia = ? AND estado <> 'anulado' ORDER BY id DESC LIMIT 1",
            (f"auto:{mid}",),
        ).fetchone()
    return cc.obtener_movimiento(int(fila[0])) if fila else None


def _asiento_vista(linea: dict[str, Any], cands: list[dict[str, Any]],
                   comprobacion: dict[str, Any] | None, prop: dict[str, Any] | None) -> dict[str, Any] | None:
    """El asiento que explica esta línea del banco, para mostrarlo como
    comprobante y como cuentas T: el real si ya está vinculada, el candidato si
    el libro tiene uno que calza, o el que se propone causar si nadie lo hizo.

    Solo los asientos propios (`cc:`) tienen líneas que enseñar; una venta de
    MeLi o Alegra se muestra por su total, sin cuentas T.
    """
    import app.services.contabilidad_core as cc

    def lineas_de_cc(mid: str) -> list[dict[str, Any]]:
        mov = _movimiento_propio(mid)
        return [
            {"cuenta_codigo": l.get("cuenta_codigo") or "", "cuenta_nombre": l.get("cuenta_nombre") or "",
             "debito": round(float(l.get("debito") or 0), 2), "credito": round(float(l.get("credito") or 0), 2),
             "descripcion": l.get("descripcion") or "", "tercero": l.get("tercero_nombre") or ""}
            for l in (mov or {}).get("lineas") or []
        ]

    if linea.get("vinculo_id"):
        lineas = lineas_de_cc(str(linea.get("movimiento_id") or ""))
        return {"origen": "real", "lineas": lineas, "cuentas_t": _cuentas_t(lineas, posteado=True) if lineas else [],
                "titulo": (comprobacion or {}).get("concepto") or "Asiento vinculado"}
    if cands:
        c = cands[0]
        lineas = lineas_de_cc(str(c["movimiento_id"]))
        return {"origen": "candidato", "lineas": lineas, "cuentas_t": _cuentas_t(lineas, posteado=True) if lineas else [],
                "titulo": c.get("concepto") or "", "fuente": c.get("fuente") or "", "monto": c.get("monto")}
    if prop and prop.get("cuenta"):
        with cc._conn() as con:
            cta = con.execute("SELECT codigo, nombre FROM cc_plan_cuentas WHERE codigo=?", (prop["cuenta"],)).fetchone()
            banco = con.execute("SELECT codigo, nombre FROM cc_plan_cuentas WHERE codigo='1110'").fetchone()
        if not cta or not banco:
            return None
        monto = round(float(linea.get("monto") or 0), 2)
        salida = (linea.get("tipo") or "").lower() == "debito"
        desc = f"{prop.get('concepto') or ''} — {linea.get('descripcion') or ''}".strip(" —")
        lineas = [
            {"cuenta_codigo": cta["codigo"], "cuenta_nombre": cta["nombre"], "debito": monto if salida else 0, "credito": 0 if salida else monto,
             "descripcion": desc, "tercero": (prop.get("tercero") or {}).get("nombre") or ""},
            {"cuenta_codigo": banco["codigo"], "cuenta_nombre": banco["nombre"], "debito": 0 if salida else monto, "credito": monto if salida else 0,
             "descripcion": "Banco", "tercero": ""},
        ]
        return {"origen": "propuesto", "lineas": lineas, "cuentas_t": _cuentas_t(lineas, posteado=False),
                "titulo": prop.get("concepto") or "", "confianza": prop.get("confianza")}
    return None


def _candidatos(linea: dict[str, Any], libro: list[dict[str, Any]]) -> list[dict[str, Any]]:
    quiero = _DIRECCION.get((linea.get("tipo") or "").lower())
    if not quiero:
        return []
    monto = abs(float(linea.get("monto") or 0))
    fecha = str(linea.get("fecha") or "")
    salida = []
    for m in libro:
        if m.get("tipo") != quiero or m.get("extracto"):
            continue
        dif = abs(abs(float(m.get("monto") or 0)) - monto)
        if dif > TOLERANCIA:
            continue
        dias = _dias(str(m.get("fecha") or ""), fecha)
        if dias > VENTANA_DIAS:
            continue
        salida.append(
            {
                "movimiento_id": m["id"],
                "fecha": m.get("fecha"),
                "tipo": m.get("tipo"),
                "concepto": m.get("concepto") or "",
                "contraparte": m.get("contraparte") or "",
                "fuente": m.get("fuente") or "",
                "referencia": m.get("referencia") or "",
                "monto": round(abs(float(m.get("monto") or 0)), 2),
                "diferencia": round(dif, 2),
                "dias": dias,
                "documento": _documento_de(m),
            }
        )
    salida.sort(key=lambda c: (c["diferencia"], c["dias"]))
    return salida[:5]


def tablero(
    desde: str,
    hasta: str,
    *,
    incluir_meli: bool = True,
    incluir_siigo: bool = True,
    tercero_id: int | None = None,
    refrescar: bool = False,
    esperar: bool = False,
    _traer: Callable[..., tuple[list[dict[str, Any]], list[str]]] = _traer_libro,
) -> dict[str, Any]:
    """Cada línea del banco con su estado, sus candidatos del libro y la cuenta
    que le propondría el clasificador.

    Estados:
      `vinculada`  ya tiene su asiento — no hay nada que hacer.
      `sugerida`   hay asiento en el libro que calza: falta unirlos.
      `sin_causar` nadie registró la operación: hay que crear el asiento.
      `revisando`  el libro todavía se está armando: no se sabe aún.

    `libro_listo=False` significa que el libro se está armando en segundo plano
    y hay que volver a preguntar. `esperar=True` lo arma en línea (para scripts
    y pruebas). `refrescar=True` tira la caché y lo vuelve a pedir.
    """
    from app.services import extracto_clasificador as ec

    lineas_raw = _lineas_banco(desde, hasta, tercero_id)
    clave = _clave(desde, hasta, incluir_meli, incluir_siigo)

    cache = _libro_cacheado(clave, refrescar=refrescar)
    if cache is None and esperar:
        movs, avisos = _traer(desde, hasta, incluir_meli=incluir_meli, incluir_siigo=incluir_siigo)
        with _lock:
            _libro_cache[clave] = (time.time(), copy.deepcopy(movs), list(avisos))
        cache = movs, avisos
    if cache is None:
        _armar_en_segundo_plano(
            clave, lambda: _traer(desde, hasta, incluir_meli=incluir_meli, incluir_siigo=incluir_siigo)
        )
    libro_listo = cache is not None
    libro = _con_vinculos(cache[0]) if cache else []
    avisos = cache[1] if cache else []

    propuestas = {p["extracto_mov_id"]: p for p in ec.proponer(desde, hasta)}
    asientos = _asientos_vinculados(lineas_raw, libro)

    # Un asiento del libro no puede ser candidato de dos líneas del banco a la
    # vez: se reparte primero a la que menos diferencia tiene, como haría quien
    # concilia a mano.
    tomados: set[str] = {str(l["movimiento_id"]) for l in lineas_raw if l.get("movimiento_id")}

    lineas: list[dict[str, Any]] = []
    for l in lineas_raw:
        cands = [] if l.get("vinculo_id") or not libro_listo else _candidatos(l, libro)
        cands = [c for c in cands if str(c["movimiento_id"]) not in tomados]
        if cands:
            tomados.add(str(cands[0]["movimiento_id"]))
        if l.get("vinculo_id"):
            estado = "vinculada"
        elif not libro_listo:
            estado = "revisando"
        elif cands:
            estado = "sugerida"
        else:
            estado = "sin_causar"
        prop = propuestas.get(l["id"])
        comp = _comprobar(l, asientos.get(str(l["movimiento_id"]))) if l.get("vinculo_id") else None
        lineas.append(
            {
                "id": l["id"],
                "extracto_id": l["extracto_id"],
                "extracto_nombre": l.get("extracto_nombre") or "",
                "banco": l.get("banco") or "",
                "cuenta": l.get("cuenta") or "",
                "fecha": l.get("fecha") or "",
                "descripcion": l.get("descripcion") or "",
                "referencia": l.get("referencia") or "",
                "monto": round(float(l.get("monto") or 0), 2),
                "tipo": (l.get("tipo") or "credito").lower(),
                "estado": estado,
                "vinculo": (
                    {"vinculo_id": l["vinculo_id"], "movimiento_id": l["movimiento_id"]}
                    if l.get("vinculo_id")
                    else None
                ),
                # La comprobación del vínculo: el asiento real y si cuadra al peso.
                # None cuando el asiento viene de una fuente que aún no está en caché.
                "comprobacion": comp,
                # El asiento como comprobante y como cuentas T (real, candidato o propuesto).
                "asiento_vista": _asiento_vista(l, cands, comp, prop),
                "candidatos": cands,
                "propuesta": (
                    {
                        "cuenta": prop.get("cuenta"),
                        "concepto": prop.get("concepto"),
                        "confianza": prop.get("confianza"),
                        "nota": prop.get("nota") or "",
                        "tercero": prop.get("tercero"),
                    }
                    if prop
                    else None
                ),
            }
        )

    # El otro lado del hueco: asientos del libro, dentro del rango, que ningún
    # movimiento del banco respalda. O el banco todavía no los ejecutó, o el
    # asiento está mal. Cualquiera de las dos cosas hay que mirarla.
    usados = {str(c["movimiento_id"]) for l in lineas for c in l["candidatos"]} | tomados
    libro_sin_banco = [
        {
            "movimiento_id": m["id"],
            "fecha": m.get("fecha"),
            "tipo": m.get("tipo"),
            "concepto": m.get("concepto") or "",
            "contraparte": m.get("contraparte") or "",
            "fuente": m.get("fuente") or "",
            "monto": round(abs(float(m.get("monto") or 0)), 2),
        }
        for m in libro
        if desde <= str(m.get("fecha") or "") <= hasta
        and not m.get("extracto")
        and str(m["id"]) not in usados
    ]
    libro_sin_banco.sort(key=lambda m: (m["fecha"], -m["monto"]), reverse=True)

    def _suma(pred) -> float:
        return round(sum(l["monto"] for l in lineas if pred(l)), 2)

    conteo = {e: sum(1 for l in lineas if l["estado"] == e) for e in
              ("vinculada", "sugerida", "sin_causar", "revisando")}
    # Los dos lados de lo conciliado, sumados aparte: si no dan lo mismo, hay
    # un vínculo que apunta a un asiento con otra plata, y ese es el que se busca.
    vinculadas = [l for l in lineas if l["estado"] == "vinculada"]
    con_comp = [l for l in vinculadas if l["comprobacion"]]
    cuadradas = [l for l in con_comp if l["comprobacion"]["cuadra"]]
    comprobacion = {
        "vinculadas": len(vinculadas),
        "verificadas": len(con_comp),
        "cuadradas": len(cuadradas),
        "descuadradas": len(con_comp) - len(cuadradas),
        "sin_verificar": len(vinculadas) - len(con_comp),
        "banco_conciliado": round(sum(l["monto"] for l in con_comp), 2),
        "libro_conciliado": round(sum(float(l["comprobacion"]["monto"] or 0) for l in con_comp), 2),
        "diferencia": round(sum(float(l["comprobacion"]["diferencia"] or 0) for l in con_comp), 2),
        "banco_pendiente": _suma(lambda l: l["estado"] != "vinculada"),
    }
    return {
        "desde": desde,
        "hasta": hasta,
        "libro_listo": libro_listo,
        "avisos": avisos,
        "totales": {
            "lineas": len(lineas),
            **conteo,
            "dudosas": sum(
                1 for l in lineas if l["estado"] == "sugerida" and len(l["candidatos"]) > 1
            ),
            "debitos": _suma(lambda l: l["tipo"] == "debito"),
            "creditos": _suma(lambda l: l["tipo"] == "credito"),
            "monto_sin_causar": _suma(lambda l: l["estado"] == "sin_causar"),
            "libro_sin_banco": len(libro_sin_banco),
        },
        "comprobacion": comprobacion,
        "lineas": lineas,
        "libro_sin_banco": libro_sin_banco[:100],
    }
