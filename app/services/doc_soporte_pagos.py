"""Documento soporte en adquisiciones a no obligados a facturar.

**Qué resuelve.** El Art. 771-2 E.T. solo acepta un costo o una deducción si
está soportado en factura o documento equivalente. Cuando el proveedor **no
está obligado a facturar** —una persona natural que cobra con cuenta de cobro
amparada en el Art. 616-2— no hay factura que pedirle: el soporte lo tiene que
**emitir McKenna**, y es el «documento soporte en adquisiciones efectuadas a
sujetos no obligados a expedir factura o documento equivalente» (Res. DIAN
000167/2021). Es electrónico, se transmite a la DIAN y trae su **CUDS**.

Sin él, el gasto está pagado, conciliado y contabilizado… y aun así no es
deducible. El caso que lo motivó es la mensajería de Fidel Rocha: ~$1,93M por
quincena, unos $46,4M al año, que hoy no tienen soporte fiscal. A la tarifa de
renta del 35% son $16,2M de mayor impuesto, más la sanción por inexactitud.

**Quién NO necesita esto**, para no emitirlo de más:

* Quien factura electrónicamente. Su factura ya es el soporte, y emitirle
  además un documento soporte duplicaría el gasto ante la DIAN. Se detecta con
  `perfil_tributario_dian`: si el NIT tiene facturas en `facturas_descargadas/`,
  factura.
* Los contribuyentes del **Régimen SIMPLE**, que **sí** están obligados a
  expedir factura electrónica (Art. 915 E.T.). De hecho, que alguien cobre con
  cuenta de cobro amparado en el 616-2 es evidencia de que **no** es del SIMPLE:
  las dos cosas son incompatibles.
* Las personas jurídicas, todas obligadas a facturar.

**Lo que este módulo NO hace.** No decide solo a quién emitirle: lo propone y lo
marca en la ficha del tercero (`emite_doc_soporte`), porque equivocarse emite un
documento fiscal irreversible —solo se corrige con nota de ajuste— a nombre de
alguien real.
"""

from __future__ import annotations

import os

# La línea del documento se carga contra una **cuenta contable**, no contra un
# ítem de inventario: Alegra rechaza `purchases.items` con el error 11034 en
# esta cuenta (verificado en vivo el 2026-09-11, ver `alegra.py`). La cuenta
# sale del PUC del asiento vía `_cuenta_alegra`; no hay cuenta por defecto a
# propósito — ver ahí por qué.


def activo() -> bool:
    """Si se emite de verdad o solo se calcula (modo sombra).

    Arranca apagado a propósito: un documento soporte emitido **ya viajó a la
    DIAN** y consume numeración de la resolución. No se emite un documento
    fiscal irreversible por defecto.
    """
    return (os.getenv("PAGOS_DOC_SOPORTE_ACTIVO") or "0").strip() not in ("", "0", "false", "False")


def _ensure() -> None:
    import app.services.contabilidad_core as cc

    cc._ensure()
    with cc._conn() as con:
        # `emite_doc_soporte` la crea `contabilidad_core`, que es el dueño de
        # `cc_terceros`: crearla aquí dejaba el campo inexistente hasta que
        # alguien emitiera el primer documento.
        con.execute("""
            CREATE TABLE IF NOT EXISTS cc_doc_soporte (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                solicitud_id INTEGER,
                movimiento_id INTEGER,
                tercero_id INTEGER NOT NULL,
                fecha TEXT NOT NULL,
                valor REAL NOT NULL,
                alegra_id TEXT NOT NULL DEFAULT '',
                numero TEXT NOT NULL DEFAULT '',
                cuds TEXT NOT NULL DEFAULT '',
                estado TEXT NOT NULL DEFAULT '',
                mensaje TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        # Un pago no puede generar dos documentos soporte: cada uno consume
        # numeración de la resolución y duplicaría el gasto ante la DIAN.
        con.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_soporte_solicitud"
            " ON cc_doc_soporte(solicitud_id) WHERE solicitud_id IS NOT NULL"
        )


def requiere(tercero: dict | None) -> tuple[bool, str]:
    """¿A este tercero hay que emitirle documento soporte? Con el porqué."""
    if not tercero:
        return False, "Sin tercero: el documento soporte va a nombre de alguien."
    if int(tercero.get("emite_doc_soporte") or 0):
        return True, "Marcado en su ficha como no obligado a facturar."
    if (tercero.get("tipo_persona") or "") != "natural":
        return False, "Persona jurídica: está obligada a facturar."
    if int(tercero.get("regimen_simple") or 0):
        return False, (
            "Está marcado como Régimen SIMPLE, y los del SIMPLE SÍ están obligados a "
            "expedir factura electrónica (Art. 915 E.T.). Si de verdad cobra con cuenta "
            "de cobro, una de las dos cosas está mal."
        )
    return False, (
        "Persona natural, pero no está marcada como no obligada a facturar. "
        "Revisa si factura electrónicamente; si cobra con cuenta de cobro, "
        "márcalo en su ficha (emite_doc_soporte)."
    )


def emitir_por_solicitud(solicitud_id: int, *, forzar: bool = False) -> dict:
    """Emite el documento soporte de una solicitud de pago ya aprobada.

    Idempotente: si esa solicitud ya tiene uno, lo devuelve sin emitir otro.
    """
    _ensure()
    import app.services.contabilidad_core as cc
    from app.services import pagos_wizard as pw
    from app.services.alegra import crear_documento_soporte_alegra

    sol = pw.obtener(int(solicitud_id))
    if not sol:
        return {"status": "error", "message": f"Solicitud {solicitud_id} no encontrada"}

    with cc._conn() as con:
        ya = con.execute(
            "SELECT * FROM cc_doc_soporte WHERE solicitud_id=? AND estado='success'",
            (int(solicitud_id),),
        ).fetchone()
    if ya:
        return {"status": "ya_emitido", "id": ya["alegra_id"], "numero": ya["numero"],
                "message": f"La solicitud {solicitud_id} ya tiene el documento soporte {ya['numero']}."}

    if not sol.get("movimiento_id"):
        return {"status": "no_aplica",
                "message": "La solicitud aún no está aprobada: el documento soporte se emite "
                           "sobre un gasto ya contabilizado."}
    # Antes del corte manda el contador; no se emiten documentos fiscales de un
    # período que él ya declaró.
    if cc.antes_del_corte(sol.get("fecha")):
        return {"status": "bloqueado_por_corte", "message": cc.motivo_corte(sol.get("fecha"))}

    tercero = cc.obtener_tercero(int(sol["tercero_id"])) if sol.get("tercero_id") else None
    hay, motivo = requiere(tercero)
    if not hay and not forzar:
        return {"status": "no_aplica", "message": motivo}

    cuenta_alegra_linea = _cuenta_alegra(sol.get("cuenta_debito"))
    if not cuenta_alegra_linea:
        return {
            "status": "error",
            "message": (
                f"La cuenta {sol.get('cuenta_debito')} no tiene equivalente en el catálogo de "
                "Alegra, así que el documento saldría contra una cuenta equivocada — y un "
                "documento soporte emitido ya viajó a la DIAN. Revisa "
                "`alegra_puc.construir_mapa()['sin_equivalente']`."
            ),
        }

    # La base es lo facturado por el tercero, no lo girado: la retención es suya
    # y el documento la informa aparte, igual que una factura.
    valor = round(float(sol.get("monto") or 0), 2)
    retencion = None
    if float(sol.get("retencion") or 0) > 0:
        retencion = {
            "concepto": sol.get("retencion_concepto") or "",
            "tarifa_pct": round(float(sol["retencion"]) / valor * 100, 2) if valor else 0,
            "retencion": float(sol["retencion"]),
        }

    r = crear_documento_soporte_alegra(
        identificacion=str((tercero or {}).get("identificacion") or ""),
        nombre=str((tercero or {}).get("nombre") or ""),
        email=str((tercero or {}).get("email") or ""),
        fecha=str(sol.get("fecha"))[:10],
        valor=valor,
        descripcion=str(sol.get("concepto") or "")[:255],
        cuenta_contable=cuenta_alegra_linea,
        observaciones=f"Documento soporte de la solicitud de pago #{solicitud_id} "
                      f"· asiento {sol.get('movimiento_id')}",
        retencion=retencion,
        # El ICA también: sin él, el «total a pagar» del documento no coincide
        # con lo que salió del banco.
        retencion_ica=float(sol.get("retencion_ica") or 0),
        # La tarifa, para que el documento imprima «4,14 por mil» y no «(0%)».
        ica_por_mil=float(sol.get("ica_por_mil") or 0),
        dry_run=not (activo() or forzar),
    )
    data = r.get("data") or {}
    with cc._conn() as con:
        con.execute(
            "INSERT OR REPLACE INTO cc_doc_soporte"
            " (solicitud_id, movimiento_id, tercero_id, fecha, valor, alegra_id, numero, cuds,"
            "  estado, mensaje)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            (int(solicitud_id), sol.get("movimiento_id"), (tercero or {}).get("id"),
             str(sol.get("fecha"))[:10], valor, str(r.get("id") or ""), str(r.get("numero") or ""),
             str(data.get("cude") or data.get("cuds") or ""), r.get("status") or "",
             str(r.get("message") or r.get("aviso") or "")[:400]),
        )
    return r


def _cuenta_alegra(codigo_puc: str | None) -> str | None:
    """Cuenta de Alegra donde cargar la línea, a partir del PUC del asiento.

    ⚠️ La función vive en **`alegra_espejo`**, no en `alegra_puc`. Es la que
    resuelve por el mapa de códigos y solo cae al `MAPA_PUC` viejo si esa id
    **todavía existe** en Alegra: al pasar al catálogo PUC, Alegra reasignó
    todas sus ids internas. Llamando a otra cosa, 523550 resolvía a la id 5214
    —del catálogo NIIF, muerta— y Alegra rechazaba el documento con el error
    11060 «No se encontró una de las cuentas contables». Pasó al emitir el
    primer documento soporte (18-sep-2026).

    Devuelve `None` si no hay equivalente: **no se inventa una cuenta de
    respaldo**. Un documento soporte emitido contra la cuenta equivocada ya
    viajó a la DIAN y solo se corrige con nota de ajuste.
    """
    try:
        from app.services.alegra_espejo import cuenta_alegra

        return cuenta_alegra(str(codigo_puc or "")) or None
    except Exception:
        return None


def pendientes(desde: str | None = None) -> list[dict]:
    """Pagos ya aprobados a no obligados a facturar que aún no tienen documento.

    Es la lista que evita que esto se vuelva un paso manual que nadie hace: lo
    que se deja al criterio de cada quien, un día se deja de hacer.
    """
    _ensure()
    import app.services.contabilidad_core as cc

    corte = desde or cc.fecha_corte()
    with cc._conn() as con:
        filas = con.execute(
            """SELECT s.id, s.fecha, s.concepto, s.monto, s.tercero_id, t.nombre, t.identificacion
                 FROM cc_solicitudes_pago s
                 JOIN cc_terceros t ON t.id = s.tercero_id
                WHERE s.movimiento_id IS NOT NULL AND s.fecha >= ?
                  AND COALESCE(t.emite_doc_soporte,0) = 1
                  AND NOT EXISTS (SELECT 1 FROM cc_doc_soporte d
                                   WHERE d.solicitud_id = s.id AND d.estado='success')
                ORDER BY s.fecha""",
            (corte,),
        ).fetchall()
    return [dict(f) for f in filas]


def registrar_pago_en_alegra(solicitud_id: int, *, referencia: str = "") -> dict:
    """Salda en Alegra el documento soporte cuando el giro ya se confirmó.

    **Por qué hace falta.** El documento soporte crea una cuenta por pagar en
    Alegra, igual que la factura de un proveedor. Si nadie la salda, queda un
    pasivo fantasma con el beneficiario: sobre la quincena de Fidel eran $2
    millones que McKenna no debe, apareciendo en el auxiliar de proveedores.

    Va en `confirmar_pago` y no al aprobar porque **al aprobar la plata todavía
    no ha salido**: falta montarla en la Sucursal Virtual con el primer token y
    aprobarla con el segundo. El documento se emite antes (soporta el gasto
    causado); el pago se registra cuando de verdad salió.

    El monto es lo **girado**, no el total: la retención no se le pagó a él,
    se le consignará a la DIAN. Así el saldo del documento queda en cero.
    """
    _ensure()
    import app.services.contabilidad_core as cc
    from app.services import pagos_wizard as pw

    with cc._conn() as con:
        doc = con.execute(
            "SELECT * FROM cc_doc_soporte WHERE solicitud_id=? AND estado='success'",
            (int(solicitud_id),),
        ).fetchone()
    if not doc or not doc["alegra_id"]:
        return {"status": "no_aplica", "message": "Esa solicitud no tiene documento soporte emitido."}

    sol = pw.obtener(int(solicitud_id))
    girado = round(float((sol or {}).get("girado") or 0), 2)
    if girado <= 0:
        return {"status": "no_aplica", "message": "No hay valor girado que registrar."}

    from app.services.alegra import registrar_pago_documento_soporte

    r = registrar_pago_documento_soporte(
        bill_id=str(doc["alegra_id"]),
        fecha=str((sol or {}).get("pagado_at") or (sol or {}).get("fecha") or "")[:10],
        valor=girado,
        observaciones=(
            f"Pago de la solicitud #{solicitud_id} · asiento {(sol or {}).get('movimiento_id')}"
            + (f" · ref. {referencia}" if referencia else "")
        ),
    )
    if r.get("status") == "success":
        with cc._conn() as con:
            con.execute(
                "UPDATE cc_doc_soporte SET mensaje=TRIM(COALESCE(mensaje,'')||' · pago Alegra '||?)"
                " WHERE solicitud_id=?", (str(r.get("id")), int(solicitud_id)),
            )
    return r
