"""
Auto-posteo del libro operativo hacia el libro de partida doble propio.

`app/services/contabilidad_ledger.py::armar_libro()` ya agrega ventas MeLi/web/
Siigo, compras, compras al exterior, servicios, impuestos y cuotas de créditos
desde sus fuentes operativas — pero es de solo lectura, nunca pasa por
`app/services/contabilidad_core.py` (el libro de partida doble real). Este
módulo cierra esa brecha sin tocar `armar_libro()` ni sus consumidores: lee su
salida y, por cada fila nueva, crea un asiento real en `cc_movimientos`.

Dedup: cada fila de `armar_libro()` ya trae un id estable
(`extracto_bancario.id_movimiento_ledger`, hash de fecha/tipo/fuente/monto/
concepto/etc.). Se guarda como `referencia=f"auto:{hash}"` en el asiento
creado; antes de crear uno nuevo se verifica que esa referencia no exista.
"""
from __future__ import annotations

from typing import Any

from app.services import contabilidad_core as cc
from app.services.contabilidad_ledger import armar_libro
from app.services.extracto_bancario import id_movimiento_ledger

CUENTA_BANCOS = "1110"

# fuente (armar_libro) -> código de cuenta PUC contraparte de Bancos.
# Ingreso: Debe Bancos / Haber esta cuenta. Egreso: Debe esta cuenta / Haber Bancos.
FUENTE_MAPEO: dict[str, str] = {
    "meli_venta": "4135",
    "web_venta": "4135",
    "siigo_venta": "4135",
    "meli_cobro": "5299",
    "compra_gmail": "1435",
    # OJO: `compra_exterior` sigue listada para que el balance de fuentes no la
    # reporte como "sin mapeo", pero su asiento lo arma `_lineas_compra_socio`
    # (ver FUENTES_ESPECIALES): NO es un par Bancos<->inventario.
    "compra_exterior": "1435",
    "operativos_impuestos": "5195",
    "operativos_servicios": "5135",
    "mensajeria_pago": "5135",
    "cuenta_cobro_correo": "5195",
}
# Fuentes con tratamiento especial (no es un simple par Bancos <-> cuenta única)
FUENTES_ESPECIALES = {"creditos_adquiridos", "compra_exterior", "compra_gmail"}
FUENTES_SOPORTADAS = set(FUENTE_MAPEO) | FUENTES_ESPECIALES


def _cuenta_id(cuentas_por_codigo: dict[str, int], codigo: str) -> int:
    cid = cuentas_por_codigo.get(codigo)
    if not cid:
        raise ValueError(f"Cuenta PUC {codigo} no existe (¿falta sembrar/migrar el plan de cuentas?)")
    return cid


def _lineas_creditos_adquiridos(row: dict[str, Any], cuentas_por_codigo: dict[str, int]) -> list[dict]:
    """Cuota de crédito bancario: separa capital (pasivo) e intereses (gasto financiero)."""
    extra = row.get("extra") or {}
    capital = round(float(extra.get("capital") or 0), 2)
    intereses = round(float(extra.get("intereses") or 0), 2)
    extras = round(float(extra.get("extras") or 0), 2)
    concepto = row["concepto"]

    lineas: list[dict] = []
    if capital > 0:
        lineas.append({
            "cuenta_id": _cuenta_id(cuentas_por_codigo, "2105"),
            "debito": capital,
            "credito": 0,
            "descripcion": f"Abono a capital — {concepto}",
        })
    if intereses > 0:
        lineas.append({
            "cuenta_id": _cuenta_id(cuentas_por_codigo, "5305"),
            "debito": intereses,
            "credito": 0,
            "descripcion": f"Intereses — {concepto}",
        })
    if extras > 0:
        lineas.append({
            "cuenta_id": _cuenta_id(cuentas_por_codigo, "5195"),
            "debito": extras,
            "credito": 0,
            "descripcion": f"Otros cargos del crédito — {concepto}",
        })

    total = round(capital + intereses + extras, 2)
    monto = round(float(row["monto"] or 0), 2)
    if not lineas or total <= 0:
        # No vino desglosado (capital/intereses en 0): postear el total como
        # gasto financiero en vez de perder la operación.
        lineas = [{
            "cuenta_id": _cuenta_id(cuentas_por_codigo, "5305"),
            "debito": monto,
            "credito": 0,
            "descripcion": concepto,
        }]
        total = monto
    elif round(total, 2) != monto:
        # Descuadre entre `monto` y la suma del desglose: ajusta el resto a
        # intereses en vez de dejar el asiento descuadrado.
        ajuste = round(monto - total, 2)
        lineas.append({
            "cuenta_id": _cuenta_id(cuentas_por_codigo, "5305"),
            "debito": ajuste,
            "credito": 0,
            "descripcion": f"Ajuste desglose — {concepto}",
        })
        total = monto

    lineas.append({
        "cuenta_id": _cuenta_id(cuentas_por_codigo, CUENTA_BANCOS),
        "debito": 0,
        "credito": total,
        "descripcion": f"Salida vía Bancos — {concepto}",
    })
    return lineas


# Cuota de manejo: el socio cobra un % por conseguir la mercancía. Es un mayor
# costo de esa mercancía para McKenna, no un gasto aparte — se incorpora al
# inventario porque sin ese servicio el producto no habría llegado.
CUENTA_INVENTARIO_MERCANCIA = "1435"
CUENTA_PASIVO_SOCIO = "2380"
CUENTA_RETENCION = "2365"


def _retencion_compra_socio(base: float, tercero_id: int | None, fecha: str | None) -> dict:
    """Retención por compras sobre lo que se le paga al socio.

    Si no se puede determinar (año sin UVT cargada, tercero desconocido) NO se
    retiene y queda el motivo: retener a ciegas es peor que no retener, porque
    devolverle plata a un tercero es más difícil que completarle después.
    """
    from app.services.retenciones import calcular

    try:
        anio = int(str(fecha or "")[:4])
    except (TypeError, ValueError):
        return {"retencion": 0.0, "motivo": "Fecha inválida: no se calcula retención."}

    declarante = True
    if tercero_id:
        with cc._conn() as con:
            row = con.execute(
                "SELECT declarante FROM cc_terceros WHERE id=?", (int(tercero_id),)
            ).fetchone()
        if row is not None and row["declarante"] is not None:
            declarante = bool(row["declarante"])
    return calcular("compras", base, anio=anio, declarante=declarante)


def _tercero_socio_id(emisor_usuario_id: Any) -> int | None:
    """Socio de `cc_terceros` a partir del usuario del panel que registró la
    compra. Devuelve None si no está enlazado — ahí el asiento se hace igual,
    sin tercero, y queda visible que falta enlazarlo."""
    try:
        uid = int(emisor_usuario_id or 0)
    except (TypeError, ValueError):
        return None
    if uid <= 0:
        return None
    with cc._conn() as con:
        row = con.execute(
            "SELECT id FROM cc_terceros WHERE usuario_id=? AND activo=1 LIMIT 1", (uid,)
        ).fetchone()
    return int(row["id"]) if row else None


def _lineas_compra_socio(row: dict[str, Any], cuentas_por_codigo: dict[str, int]) -> list[dict]:
    """Compra que un socio hizo con su tarjeta personal y entrega a la empresa.

    La mercancía llega a nombre del socio (persona natural) y él se la entrega a
    McKenna para que pueda venderla. **El banco de McKenna no se mueve acá**: se
    mueve después, cuando se le reintegra (`registrar_pago_socio`). Por eso el
    crédito va a 2380 y no a 1110 — acreditar Bancos en este momento duplicaría
    la salida de caja y haría imposible cuadrar el extracto.

        Débito   1435  Inventarios - Mercancías        valor + cuota de manejo
            Crédito  2380  Cuentas por pagar - socios  valor + cuota   [tercero]
    """
    extra = row.get("extra") or {}
    monto = round(float(row["monto"] or 0), 2)
    concepto = row["concepto"]
    tercero_id = _tercero_socio_id(extra.get("emisor_usuario_id"))
    socio = str(extra.get("emisor_nombre") or "").strip() or "socio"

    # La cuota ya viene liquidada desde el panel (se cobra sobre la mercancía, no
    # sobre mercancía+flete, que es lo que trae `monto`). Solo si no viniera se
    # recalcula por porcentaje, y sobre el mismo `monto` disponible.
    try:
        pct = float(extra.get("cuota_manejo_pct") or 0)
    except (TypeError, ValueError):
        pct = 0.0
    cuota_liquidada = extra.get("cuota_manejo_cop")
    if cuota_liquidada not in (None, ""):
        try:
            cuota = round(float(cuota_liquidada), 2)
        except (TypeError, ValueError):
            cuota = 0.0
    else:
        cuota = round(monto * pct / 100, 2) if pct > 0 else 0.0
    total = round(monto + cuota, 2)

    detalle = f"{concepto} — comprada por {socio}"
    if cuota > 0:
        detalle += f" (incl. cuota de manejo {pct:g}%)"

    # Retención en la fuente por COMPRAS. McKenna es agente retenedor y el socio
    # es el beneficiario. Solo aplica desde 27 UVT: la mayoría de estas compras
    # queda por debajo y no lleva retención — aplicarla igual sería incorrecto.
    # El pasivo con el socio queda NETO: se le gira lo retenido a la DIAN.
    ret = _retencion_compra_socio(total, tercero_id, row.get("fecha"))
    retencion = round(float(ret.get("retencion") or 0), 2)

    lineas = [
        {
            "cuenta_id": _cuenta_id(cuentas_por_codigo, CUENTA_INVENTARIO_MERCANCIA),
            "debito": total,
            "credito": 0,
            "descripcion": detalle,
        }
    ]
    if retencion > 0:
        lineas.append({
            "cuenta_id": _cuenta_id(cuentas_por_codigo, CUENTA_RETENCION),
            "debito": 0,
            "credito": retencion,
            "tercero_id": tercero_id,
            "descripcion": f"Retención por compras {ret.get('tarifa_pct')}% — {socio}",
        })
    lineas.append({
        "cuenta_id": _cuenta_id(cuentas_por_codigo, CUENTA_PASIVO_SOCIO),
        "debito": 0,
        "credito": round(total - retencion, 2),
        "tercero_id": tercero_id,
        "descripcion": f"Por pagar a {socio} — mercancía comprada con tarjeta personal",
    })
    return lineas


CUENTA_PROVEEDORES = "2205"


def _tercero_proveedor_id(nit: str, nombre: str) -> int | None:
    """Tercero del proveedor, creándolo si no existe.

    Una cuenta por pagar sin tercero no sirve: el saldo dice *cuánto* se debe
    pero no *a quién*, y no se puede pagar ni conciliar. Los proveedores salen
    de facturas reales ya registradas, así que darlos de alta es registrar algo
    que ya existe, no inventar nada.
    """
    digits = "".join(ch for ch in str(nit or "") if ch.isdigit())
    if not digits:
        return None
    with cc._conn() as con:
        for row in con.execute("SELECT id, identificacion FROM cc_terceros WHERE activo=1"):
            if "".join(ch for ch in str(row["identificacion"] or "") if ch.isdigit()) == digits:
                return int(row["id"])
    try:
        t = cc.crear_tercero({
            "nombre": (nombre or f"Proveedor NIT {digits}")[:120],
            "tipo": "proveedor",
            # Un NIT de empresa tiene 9+ dígitos; menos es cédula de natural.
            "tipo_persona": "juridica" if len(digits) >= 9 else "natural",
            "identificacion": digits,
            "notas": "Creado automáticamente desde facturas de compra (Gmail).",
        })
        return int(t["id"])
    except Exception:
        return None


def _lineas_factura_proveedor(row: dict[str, Any], cuentas_por_codigo: dict[str, int]) -> list[dict]:
    """Factura de compra de un proveedor (flujo Gmail).

    Registrar la factura **no** es pagarla: genera una cuenta por pagar, no una
    salida de caja. Hasta sep-2026 esto se posteaba contra Bancos y dejó el banco
    en −$105.010.470, un saldo imposible. El pago al proveedor es un evento
    aparte, y es el que aparece en el extracto.

        Débito   1435/5195  Inventario o gasto, según la factura
            Crédito  2205   Proveedores nacionales   [tercero]
    """
    monto = round(float(row["monto"] or 0), 2)
    extra = row.get("extra") or {}
    concepto = row["concepto"]
    proveedor = str(row.get("contraparte") or "").strip() or "proveedor"
    # `accion` viene del panel: la factura se clasificó como inventario o gasto.
    destino = "1435" if str(extra.get("accion") or "").lower() == "inventario" else "5195"
    tercero_id = _tercero_proveedor_id(extra.get("nit"), proveedor)

    return [
        {
            "cuenta_id": _cuenta_id(cuentas_por_codigo, destino),
            "debito": monto,
            "credito": 0,
            "descripcion": f"{concepto} — {proveedor} (factura {row.get('referencia') or 's/n'})",
        },
        {
            "cuenta_id": _cuenta_id(cuentas_por_codigo, CUENTA_PROVEEDORES),
            "debito": 0,
            "credito": monto,
            "tercero_id": tercero_id,
            "descripcion": f"Por pagar a {proveedor}",
        },
    ]


def _lineas_para_fila(row: dict[str, Any], cuentas_por_codigo: dict[str, int]) -> list[dict]:
    fuente = row["fuente"]
    if fuente == "creditos_adquiridos":
        return _lineas_creditos_adquiridos(row, cuentas_por_codigo)
    if fuente == "compra_exterior":
        return _lineas_compra_socio(row, cuentas_por_codigo)
    if fuente == "compra_gmail":
        return _lineas_factura_proveedor(row, cuentas_por_codigo)

    monto = round(float(row["monto"] or 0), 2)
    bancos_id = _cuenta_id(cuentas_por_codigo, CUENTA_BANCOS)
    cuenta_id = _cuenta_id(cuentas_por_codigo, FUENTE_MAPEO[fuente])
    concepto = row["concepto"]

    if row["tipo"] == "ingreso":
        return [
            {"cuenta_id": bancos_id, "debito": monto, "credito": 0,
             "descripcion": f"Entrada vía Bancos — {concepto}"},
            {"cuenta_id": cuenta_id, "debito": 0, "credito": monto,
             "descripcion": concepto},
        ]
    return [
        {"cuenta_id": cuenta_id, "debito": monto, "credito": 0,
         "descripcion": concepto},
        {"cuenta_id": bancos_id, "debito": 0, "credito": monto,
         "descripcion": f"Salida vía Bancos — {concepto}"},
    ]


def _ya_posteado(referencia: str) -> bool:
    with cc._conn() as con:
        row = con.execute(
            "SELECT 1 FROM cc_movimientos WHERE referencia=? LIMIT 1", (referencia,)
        ).fetchone()
        return row is not None


def auto_postear_periodo(
    desde: str,
    hasta: str | None = None,
    *,
    incluir_meli: bool = True,
    incluir_siigo: bool = True,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Postea al libro de partida doble lo que `armar_libro()` trae para el
    rango [desde, hasta] y aún no se ha posteado. No lanza excepción por fila:
    los errores por fila quedan en `errores` y las fuentes que armar_libro trae
    pero este módulo todavía no sabe clasificar quedan en `fuentes_sin_mapeo`
    (nunca se descartan en silencio)."""
    cc._ensure()
    libro = armar_libro(desde, hasta, incluir_meli=incluir_meli, incluir_siigo=incluir_siigo)
    cuentas_por_codigo = {c["codigo"]: c["id"] for c in cc.listar_plan_cuentas(solo_activas=False)}

    creados = 0
    omitidos = 0
    fuentes_sin_mapeo: dict[str, int] = {}
    errores: list[dict[str, Any]] = []

    for row in libro["movimientos"]:
        fuente = row.get("fuente") or ""
        if fuente not in FUENTES_SOPORTADAS:
            fuentes_sin_mapeo[fuente] = fuentes_sin_mapeo.get(fuente, 0) + 1
            continue
        monto = float(row.get("monto") or 0)
        if monto <= 0:
            continue

        referencia = f"auto:{id_movimiento_ledger(row)}"
        if _ya_posteado(referencia):
            omitidos += 1
            continue
        if dry_run:
            creados += 1
            continue

        try:
            lineas = _lineas_para_fila(row, cuentas_por_codigo)
            cc.crear_movimiento(
                fecha=row["fecha"],
                concepto=row["concepto"],
                lineas=lineas,
                referencia=referencia,
                tipo_origen=f"auto_{fuente}",
                plantilla_datos=row,
            )
            creados += 1
        except Exception as e:
            errores.append({"fuente": fuente, "referencia": referencia, "error": str(e)})

    return {
        "desde": libro["desde"],
        "hasta": libro["hasta"],
        "creados": creados,
        "omitidos": omitidos,
        "fuentes_sin_mapeo": fuentes_sin_mapeo,
        "errores": errores,
        "dry_run": dry_run,
    }
