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
    "compra_exterior": "1436",
    "operativos_impuestos": "5195",
    "operativos_servicios": "5135",
    "cuenta_cobro_correo": "5195",
}
# Fuentes con tratamiento especial (no es un simple par Bancos <-> cuenta única)
FUENTES_ESPECIALES = {"creditos_adquiridos"}
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


def _lineas_para_fila(row: dict[str, Any], cuentas_por_codigo: dict[str, int]) -> list[dict]:
    fuente = row["fuente"]
    if fuente == "creditos_adquiridos":
        return _lineas_creditos_adquiridos(row, cuentas_por_codigo)

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
