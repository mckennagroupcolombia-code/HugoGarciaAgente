"""Reportes de liquidaciones de Mercado Pago (settlement report) como fuente del cruce fiscal.

Mercado Pago entrega el «settlement report» en Excel, por tramos de máximo 62
días: una fila por movimiento (venta, envío cobrado, devolución, disputa,
cashback) con el valor bruto que pagó el comprador, la comisión y el neto que
quedó liquidado en la cuenta. NO trae los retiros al banco ni el saldo, así que
NO es un extracto: cargarlo en Conciliación sumaría dos veces la misma plata (la
venta acá y el giro en Bancolombia). Se resume por mes en
`docs/contabilidad/<año>/mercadopago_liquidaciones.json` (gitignored) y lo usa
`declaraciones_impuestos.cruce_tripartito()`.

Los valores brutos traen IVA: es lo que pagó el comprador.
"""

from __future__ import annotations

import glob
import json
import warnings
from collections import defaultdict
from pathlib import Path

_DOCS = Path(__file__).resolve().parents[2] / "docs" / "contabilidad"
DESCARGAS = Path.home() / "Descargas"

_GRUPO = {
    "SETTLEMENT": "ventas", "SETTLEMENT_SHIPPING": "envios",
    "REFUND": "devoluciones", "REFUND_SHIPPING": "devoluciones",
    "DISPUTE": "disputas", "DISPUTE_SHIPPING": "disputas",
    "CASHBACK": "cashback", "CASHBACK_CANCEL": "cashback",
    "SHIPPING": "envios_cobrados_a_mckenna",
}


def importar(carpeta: Path | None = None) -> dict:
    """Lee todos los settlement-report-*.xlsx de la carpeta, sin duplicar filas
    entre tramos, y guarda el resumen mensual por fecha de la transacción."""
    import openpyxl

    carpeta = carpeta or DESCARGAS
    vistos: set[tuple] = set()
    meses: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    archivos = sorted(glob.glob(str(carpeta / "settlement-report-*.xlsx")))
    liq_min, liq_max = "9999", "0000"
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for f in archivos:
            filas = openpyxl.load_workbook(f, read_only=True).worksheets[0].iter_rows(values_only=True)
            cab = next(filas)
            for r in filas:
                if not r or r[0] is None:
                    continue
                d = dict(zip(cab, r))
                clave = (d.get("SOURCE_ID"), d.get("TRANSACTION_TYPE"), d.get("TRANSACTION_AMOUNT"), d.get("SETTLEMENT_DATE"))
                if clave in vistos:
                    continue
                vistos.add(clave)
                fecha = str(d.get("TRANSACTION_DATE") or "")[:7]
                if not fecha:
                    continue
                liq = str(d.get("SETTLEMENT_DATE") or "")[:10]
                liq_min, liq_max = min(liq_min, liq), max(liq_max, liq)
                m = meses[fecha]
                m[_GRUPO.get(d.get("TRANSACTION_TYPE"), "otros")] += float(d.get("TRANSACTION_AMOUNT") or 0)
                m["comisiones"] += float(d.get("FEE_AMOUNT") or 0)
                m["neto"] += float(d.get("SETTLEMENT_NET_AMOUNT") or 0)
                m["movimientos"] += 1
    por_anio: dict[str, dict] = defaultdict(dict)
    for k, v in sorted(meses.items()):
        por_anio[k[:4]][k] = {c: round(x, 2) for c, x in v.items()}
    for anio, datos in por_anio.items():
        (_DOCS / anio).mkdir(parents=True, exist_ok=True)
        (_DOCS / anio / "mercadopago_liquidaciones.json").write_text(
            json.dumps({"liquidado_desde": liq_min, "liquidado_hasta": liq_max, "meses": datos},
                       ensure_ascii=False, indent=1), encoding="utf-8")
    return {"archivos": len(archivos), "filas": len(vistos), "liquidado_desde": liq_min,
            "liquidado_hasta": liq_max, "meses": sorted(meses)}


def por_mes(anio: int) -> dict[str, dict]:
    f = _DOCS / str(anio) / "mercadopago_liquidaciones.json"
    if not f.exists():
        return {}
    try:
        return json.loads(f.read_text(encoding="utf-8")).get("meses") or {}
    except Exception:
        return {}
