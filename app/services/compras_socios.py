"""
Documento soporte por la mercancía que un socio le vende a McKenna.

El socio compra en Amazon u otros comercios de EEUU con su tarjeta personal, la
mercancía llega a su nombre y se la entrega a la empresa. McKenna **adquiere
bienes a una persona natural no obligada a facturar**, que es el supuesto del
documento soporte (Res. DIAN 000167 de 2021).

⚠️ Dos límites que este módulo NO cruza:

1. **El documento soporte NO sanea el estatus aduanero.** Soporta el costo para
   renta; no convierte en legalmente importada una mercancía que entró por una
   modalidad personal. Ver `docs/agentic/modules/relaciones-socios-terceros.md`.
2. **No se toma IVA descontable.** No hay declaración de importación a nombre de
   la empresa (Art. 485 E.T.), así que el documento va sin IVA.

Arranca en **modo sombra** (`COMPRAS_SOCIOS_DOC_SOPORTE_ACTIVO=0`): un documento
soporte emitido ya viajó a la DIAN y solo se corrige con nota de ajuste.
"""

from __future__ import annotations

import os

# Cuenta contable de Alegra para la línea del documento soporte: la mercancía
# del socio entra al inventario. Va cuenta y no ítem — ver
# alegra.crear_documento_soporte_alegra.
CUENTA_ALEGRA_MERCANCIA_DEFAULT = "5047"   # Inventario de mercancías


def _activo() -> bool:
    return (os.getenv("COMPRAS_SOCIOS_DOC_SOPORTE_ACTIVO", "0") or "0").strip() == "1"


def _cuenta_alegra() -> str:
    return (os.getenv("COMPRAS_SOCIOS_ALEGRA_CUENTA", "") or CUENTA_ALEGRA_MERCANCIA_DEFAULT).strip()


def base_documento_soporte(compra: dict) -> dict:
    """Qué se documenta de una compra: base, retención y datos del socio."""
    from app.services.contabilidad_ledger import _total_compra_exterior_cop
    from app.services.retenciones import calcular

    mercancia_flete = _total_compra_exterior_cop(compra)
    cuota = round(float(compra.get("cuota_manejo_cop") or 0), 2)
    total = round(mercancia_flete + cuota, 2)
    # MISMA fecha que usa el asiento contable (`_egresos_compras_exterior`):
    # la de registro en el panel, con respaldo en la de compra. Si el documento
    # soporte usara otra, quedaría en un mes distinto al del asiento y la
    # declaración de retención no cuadraría contra el Libro Mayor.
    fecha = str(compra.get("created_at") or compra.get("fecha_compra") or "")[:10]
    try:
        anio = int(fecha[:4])
    except ValueError:
        anio = 0

    declarante = True
    socio_id = compra.get("emisor_usuario_id")
    identificacion = str(compra.get("emisor_documento") or "").strip()
    if socio_id:
        import app.services.contabilidad_core as cc

        cc._ensure()
        with cc._conn() as con:
            row = con.execute(
                "SELECT identificacion, declarante FROM cc_terceros WHERE usuario_id=? AND activo=1",
                (int(socio_id),),
            ).fetchone()
        if row:
            identificacion = identificacion or str(row["identificacion"] or "")
            if row["declarante"] is not None:
                declarante = bool(row["declarante"])

    ret = calcular("compras", total, anio=anio, declarante=declarante) if anio else {
        "aplica": False, "retencion": 0.0, "motivo": "Fecha inválida."
    }
    return {
        "compra_id": compra.get("id"),
        "fecha": fecha,
        "socio": str(compra.get("emisor_nombre") or "").strip(),
        "identificacion": identificacion,
        "declarante": declarante,
        "mercancia_flete": mercancia_flete,
        "cuota_manejo": cuota,
        "total": total,
        "retencion": ret,
        "neto_a_girar": round(total - float(ret.get("retencion") or 0), 2),
    }


def emitir_documento_soporte_compra(compra_id: int, *, forzar_envio: bool = False) -> dict:
    """Emite (o simula) el documento soporte de una compra a un socio."""
    from app.services.alegra import crear_documento_soporte_alegra
    from app.services.contabilidad_db import listar_compras_exterior

    compra = next((c for c in listar_compras_exterior(limit=500) if int(c["id"]) == int(compra_id)), None)
    if not compra:
        raise ValueError(f"Compra {compra_id} no encontrada")

    d = base_documento_soporte(compra)
    if d["total"] <= 0:
        return {"status": "no_aplica", "motivo": "La compra no tiene valor.", **d}
    if not d["identificacion"]:
        return {"status": "error", "message": f"El socio «{d['socio']}» no tiene cédula registrada.", **d}

    dry = not (_activo() or forzar_envio)
    r = crear_documento_soporte_alegra(
        identificacion=d["identificacion"],
        nombre=d["socio"],
        fecha=d["fecha"],
        valor=d["total"],
        descripcion=(
            f"Mercancía adquirida en el exterior por el socio "
            f"(incl. cuota de manejo {d['cuota_manejo']:,.0f})".replace(",", ".")
        ),
        cuenta_contable=_cuenta_alegra(),
        observaciones=(
            f"Compra #{d['compra_id']} — mercancía comprada por {d['socio']} con tarjeta personal "
            "y entregada a McKenna Group S.A.S. Sin IVA descontable: la mercancía no ingresó por "
            "importación ordinaria a nombre de la empresa (Art. 485 E.T.)."
        ),
        retencion=d["retencion"] if d["retencion"].get("aplica") else None,
        dry_run=dry,
    )
    return {**r, "detalle": d}


def previsualizar_lote() -> dict:
    """Modo sombra sobre todas las compras con cuenta de cobro: qué documento
    soporte se emitiría, con qué retención y cuáles quedan bloqueadas."""
    from app.services.contabilidad_db import listar_compras_exterior

    filas, bloqueadas = [], []
    for c in sorted(listar_compras_exterior(limit=500), key=lambda x: x["id"]):
        if not (c.get("tiene_cuenta_cobro") or c.get("tiene_cuenta_flete")):
            continue
        try:
            r = emitir_documento_soporte_compra(c["id"])
        except Exception as e:
            bloqueadas.append({"compra_id": c["id"], "error": str(e)})
            continue
        if r.get("status") == "error":
            bloqueadas.append({"compra_id": c["id"], "error": r.get("message")})
            continue
        filas.append(r)
    total = round(sum(f["detalle"]["total"] for f in filas), 2)
    retencion = round(sum(float(f["detalle"]["retencion"].get("retencion") or 0) for f in filas), 2)
    return {
        "activo": _activo(),
        "cuenta_contable": _cuenta_alegra(),
        "documentos": filas,
        "bloqueadas": bloqueadas,
        "total_documentado": total,
        "total_retencion": retencion,
        "con_retencion": sum(1 for f in filas if f["detalle"]["retencion"].get("aplica")),
    }


# ─── Reintegro al socio ─────────────────────────────────────────────────────
# El momento en que McKenna sí mueve su banco. Es **la línea que aparece en el
# extracto**, y por eso es la que se concilia — no la compra, que salió de la
# tarjeta del socio.
#
#     Débito   2380  Cuentas por pagar - socios    [tercero]
#         Crédito  1110  Bancos
#
# La retención ya se descontó al registrar la compra, así que el saldo de 2380
# es el NETO: lo que efectivamente hay que girarle.

def saldo_socios(tercero_id: int | None = None) -> list[dict]:
    """Lo que McKenna le debe a cada socio, con el desglose de qué lo compone.

    El saldo sale de la cuenta 2380 del Libro Mayor (no de las compras), porque
    ahí ya están reflejados los abonos parciales y cualquier asiento manual.
    """
    import app.services.contabilidad_core as cc

    cc._ensure()
    where = "AND t.id = ?" if tercero_id else ""
    params = [int(tercero_id)] if tercero_id else []
    with cc._conn() as con:
        filas = [
            dict(r)
            for r in con.execute(
                f"""
                SELECT t.id AS tercero_id, t.nombre, t.identificacion, t.tipo,
                       ROUND(SUM(l.credito - l.debito), 2) AS saldo,
                       SUM(CASE WHEN l.credito > 0 THEN l.credito ELSE 0 END) AS cargado,
                       SUM(CASE WHEN l.debito  > 0 THEN l.debito  ELSE 0 END) AS abonado,
                       COUNT(DISTINCT m.id) AS movimientos
                  FROM cc_movimiento_lineas l
                  JOIN cc_movimientos m ON m.id = l.movimiento_id AND m.estado <> 'anulado'
                  JOIN cc_plan_cuentas c ON c.id = l.cuenta_id
                  JOIN cc_terceros t ON t.id = l.tercero_id
                 WHERE c.codigo = '2380' {where}
                 GROUP BY t.id
                HAVING ROUND(SUM(l.credito - l.debito), 2) <> 0
                 ORDER BY saldo DESC
                """,
                params,
            )
        ]
    for f in filas:
        f["saldo"] = round(float(f["saldo"] or 0), 2)
        f["cargado"] = round(float(f["cargado"] or 0), 2)
        f["abonado"] = round(float(f["abonado"] or 0), 2)
    return filas


def detalle_pendiente_socio(tercero_id: int) -> dict:
    """Qué compone el saldo de un socio: las compras que lo cargaron y los
    reintegros que ya se hicieron. Sirve para que quien gira sepa qué está
    pagando y para conciliar después contra el extracto."""
    import app.services.contabilidad_core as cc

    cc._ensure()
    with cc._conn() as con:
        movs = [
            dict(r)
            for r in con.execute(
                """
                SELECT m.id, m.fecha, m.concepto, m.tipo_origen, m.referencia,
                       l.debito, l.credito
                  FROM cc_movimiento_lineas l
                  JOIN cc_movimientos m ON m.id = l.movimiento_id AND m.estado <> 'anulado'
                  JOIN cc_plan_cuentas c ON c.id = l.cuenta_id
                 WHERE c.codigo = '2380' AND l.tercero_id = ?
                 ORDER BY m.fecha, m.id
                """,
                (int(tercero_id),),
            )
        ]
    saldos = saldo_socios(tercero_id)
    return {
        "tercero_id": int(tercero_id),
        "saldo": saldos[0]["saldo"] if saldos else 0.0,
        "nombre": saldos[0]["nombre"] if saldos else "",
        "movimientos": [
            {
                "id": m["id"], "fecha": m["fecha"], "concepto": m["concepto"],
                "tipo_origen": m["tipo_origen"], "referencia": m["referencia"],
                "carga": round(float(m["credito"] or 0), 2),
                "abono": round(float(m["debito"] or 0), 2),
            }
            for m in movs
        ],
    }


def registrar_reintegro(payload: dict, created_by: int | None = None) -> dict:
    """Gira al socio lo que se le debe (total o parcial) y deja el asiento.

    Valida contra el saldo vivo: girar más de lo adeudado dejaría 2380 en débito,
    o sea que el socio le quedaría debiendo a la empresa. Puede ser legítimo (un
    anticipo), pero tiene que ser una decisión explícita y no un dedazo, así que
    exige `permitir_exceso`.
    """
    import app.services.contabilidad_core as cc

    tercero_id = int(payload.get("tercero_id") or 0)
    monto = round(float(payload.get("monto") or 0), 2)
    if not tercero_id or monto <= 0:
        raise ValueError("tercero_id y monto (> 0) son requeridos")

    tercero = cc.obtener_tercero(tercero_id)
    if not tercero:
        raise ValueError("Tercero no encontrado")

    saldos = saldo_socios(tercero_id)
    saldo = saldos[0]["saldo"] if saldos else 0.0
    if saldo <= 0:
        raise ValueError(
            f"A {tercero['nombre']} no se le debe nada en la cuenta 2380 "
            f"(saldo actual: ${saldo:,.0f}).".replace(",", ".")
        )
    if monto > saldo + 0.01 and not payload.get("permitir_exceso"):
        raise ValueError(
            f"El giro (${monto:,.0f}) supera lo que se le debe a {tercero['nombre']} "
            f"(${saldo:,.0f}). Si es un anticipo a propósito, marca «permitir exceso»."
            .replace(",", ".")
        )

    mov = cc.registrar_pago_socio(
        {
            "fecha": payload.get("fecha"),
            "tercero_id": tercero_id,
            "monto": monto,
            "medio_pago_id": payload.get("medio_pago_id"),
            "referencia": payload.get("referencia") or "",
            "concepto": payload.get("concepto")
            or "reintegro por mercancía comprada con tarjeta personal",
        },
        created_by=created_by,
    )
    nuevo = saldo_socios(tercero_id)
    return {
        "ok": True,
        "movimiento": mov,
        "saldo_anterior": saldo,
        "saldo_nuevo": nuevo[0]["saldo"] if nuevo else 0.0,
        # El id con el que se vincula esta línea al extracto bancario
        "movimiento_id_conciliacion": f"cc:{mov.get('id')}",
    }
