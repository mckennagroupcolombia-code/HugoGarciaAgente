"""Certificados de las retenciones que le PRACTICARON a McKenna, y temas para el contador.

Mercado Pago no le paga a McKenna el total de cada venta con tarjeta: el banco
retiene renta (1,5 %), IVA (15 % del IVA) e ICA Bogotá (4,14 ‰) y lo consigna a
la DIAN y a la SHD. Eso es plata a favor de McKenna que el contador descuenta en
el 350, el 300 y el ICA, pero solo si tiene el certificado. Mercado Pago los
expide por mes (Tu negocio → Impuestos → Certificados) en un zip con dos PDF:
«IVA y Fuente» e «ICA Bogotá».

Los PDF viven en `docs/contabilidad/Certificados_Retencion/<emisor>/<AAAA-MM>/`
(gitignored, como los soportes del contador). `importar_descargas()` los trae
de ~/Descargas; `listar()` los lee con pdftotext cada vez —son pocos y pequeños—
para que lo que ve el contador sea siempre lo que dice el PDF.

Estos valores NO están causados en el Libro Mayor (cuentas 135515/135517/135518,
anticipo de impuestos): queda como tema para el contador en
`app/data/temas_reunion_contador.json`, que `temas_reunion()` sirve con las
cifras calculadas en vivo.
"""
from __future__ import annotations

import json
import re
import shutil
import sqlite3
import subprocess
import zipfile
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parents[2]
CARPETA = _REPO / "docs" / "contabilidad" / "Certificados_Retencion"
TEMAS_PATH = _REPO / "app" / "data" / "temas_reunion_contador.json"

_MESES = {
    "ene": 1, "enero": 1, "feb": 2, "febrero": 2, "mar": 3, "marzo": 3, "abr": 4, "abril": 4,
    "may": 5, "mayo": 5, "jun": 6, "junio": 6, "jul": 7, "julio": 7, "ago": 8, "agosto": 8,
    "sep": 9, "sept": 9, "septiembre": 9, "oct": 10, "octubre": 10, "nov": 11, "noviembre": 11,
    "dic": 12, "diciembre": 12,
}

# Cuenta del PUC (Dec. 2650) donde se causa cada retención que nos practicaron.
CUENTA_POR_IMPUESTO = {
    "retefuente": ("135515", "Retención en la fuente"),
    "reteiva": ("135517", "Impuesto a las ventas retenido"),
    "reteica": ("135518", "Impuesto de industria y comercio retenido"),
}


def _num(txt: str) -> float:
    """«$26.084.815,10» → 26084815.10"""
    t = txt.replace("$", "").replace(".", "").replace(",", ".").strip()
    try:
        return float(t)
    except ValueError:
        return 0.0


def _impuesto_de(concepto: str) -> str:
    c = concepto.lower()
    if "iva" in c:
        return "reteiva"
    if "ica" in c:
        return "reteica"
    return "retefuente"


def _texto_pdf(path: Path) -> str:
    try:
        return subprocess.run(
            ["pdftotext", "-layout", str(path), "-"],
            capture_output=True, text=True, timeout=30,
        ).stdout
    except Exception:  # noqa: BLE001 — un PDF ilegible se muestra sin cifras, no tumba la lista
        return ""


_RE_LINEA = re.compile(
    r"^\s*(Retenci[oó]n .+?)\s{2,}\$\s?([\d.,]+)\s+([\d.,]+)\s*%\s+\$\s?([\d.,]+)", re.M
)


def leer_certificado(path: Path) -> dict[str, Any]:
    """Lo que dice un certificado: emisor, período, conceptos y total."""
    txt = _texto_pdf(path)
    emisor = (txt.strip().splitlines() or [""])[0].strip()
    nit = re.search(r"NIT:\s*([\d.\s-]+\d)", txt)
    fecha = re.search(r"(\d{2})/(\d{2})/(\d{4})", txt)
    mes = re.search(r"mes de (\w+) del a[ñn]o (\d{4})", txt)
    conceptos = []
    for m in _RE_LINEA.finditer(txt):
        concepto = re.sub(r"\s+", " ", m.group(1)).strip()
        imp = _impuesto_de(concepto)
        conceptos.append({
            "concepto": concepto,
            "impuesto": imp,
            "cuenta": CUENTA_POR_IMPUESTO[imp][0],
            "base": _num(m.group(2)),
            "tarifa_pct": _num(m.group(3)),
            "retencion": _num(m.group(4)),
        })
    periodo = None
    if mes and mes.group(1).lower() in _MESES:
        periodo = f"{mes.group(2)}-{_MESES[mes.group(1).lower()]:02d}"
    return {
        "archivo": str(path.relative_to(CARPETA)),
        "nombre": path.name,
        "emisor": emisor,
        "nit_emisor": re.sub(r"\s", "", nit.group(1)) if nit else "",
        "fecha_expedicion": f"{fecha.group(3)}-{fecha.group(2)}-{fecha.group(1)}" if fecha else "",
        "periodo": periodo or path.parent.name,
        "tipo": "ICA" if "ICA" in path.name else "IVA y Fuente",
        "conceptos": conceptos,
        "total": round(sum(c["retencion"] for c in conceptos), 2),
        "legible": bool(conceptos),
    }


def listar() -> dict[str, Any]:
    """Todos los certificados guardados, agrupados por período, con totales."""
    certs = [leer_certificado(p) for p in sorted(CARPETA.rglob("*.pdf"))] if CARPETA.exists() else []
    por_periodo: dict[str, dict[str, Any]] = {}
    totales = {k: 0.0 for k in CUENTA_POR_IMPUESTO}
    for c in certs:
        p = por_periodo.setdefault(c["periodo"], {
            "periodo": c["periodo"], "certificados": [],
            **{k: 0.0 for k in CUENTA_POR_IMPUESTO}, "total": 0.0,
        })
        p["certificados"].append(c)
        for x in c["conceptos"]:
            p[x["impuesto"]] = round(p[x["impuesto"]] + x["retencion"], 2)
            totales[x["impuesto"]] = round(totales[x["impuesto"]] + x["retencion"], 2)
        p["total"] = round(p["total"] + c["total"], 2)
    return {
        "periodos": [por_periodo[k] for k in sorted(por_periodo, reverse=True)],
        "totales": {**totales, "total": round(sum(totales.values()), 2)},
        "cuentas": {k: {"codigo": v[0], "nombre": v[1]} for k, v in CUENTA_POR_IMPUESTO.items()},
        "causado_en_libro": _causado_en_libro(),
    }


def _causado_en_libro() -> dict[str, float]:
    """Saldo de las cuentas de anticipo en el Libro Mayor (hoy no existen → 0)."""
    from app.services.contabilidad_core import _DB_PATH

    out = {k: 0.0 for k in CUENTA_POR_IMPUESTO}
    try:
        with sqlite3.connect(_DB_PATH) as con:
            for imp, (cod, _n) in CUENTA_POR_IMPUESTO.items():
                r = con.execute(
                    "SELECT COALESCE(SUM(l.debito - l.credito), 0) FROM cc_movimiento_lineas l "
                    "JOIN cc_plan_cuentas p ON p.id = l.cuenta_id "
                    "JOIN cc_movimientos m ON m.id = l.movimiento_id "
                    "WHERE p.codigo LIKE ? AND m.estado != 'anulado'", (cod + "%",),
                ).fetchone()
                out[imp] = round(float(r[0] or 0), 2)
    except Exception:  # noqa: BLE001
        pass
    return out


def ruta_certificado(archivo: str) -> Path | None:
    """Ruta absoluta de un certificado, solo si está dentro de CARPETA."""
    p = (CARPETA / archivo).resolve()
    if CARPETA.resolve() not in p.parents or p.suffix.lower() != ".pdf" or not p.is_file():
        return None
    return p


_RE_ZIP_MP = re.compile(r"Certificados-de-impuestos-([a-z]+)(\d{4})-.*MercadoPago\.zip$", re.I)


def importar_descargas(carpeta: str | Path | None = None) -> dict[str, Any]:
    """Copia los certificados de Mercado Pago de ~/Descargas a CARPETA. Idempotente."""
    origen = Path(carpeta or Path.home() / "Descargas")
    hechos, saltados = [], []
    for z in sorted(origen.glob("Certificados-de-impuestos-*MercadoPago.zip")):
        m = _RE_ZIP_MP.search(z.name)
        if not m or m.group(1).lower() not in _MESES:
            saltados.append({"archivo": z.name, "motivo": "no se reconoce el período"})
            continue
        destino = CARPETA / "MercadoPago" / f"{m.group(2)}-{_MESES[m.group(1).lower()]:02d}"
        destino.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(z) as zf:
            for info in zf.infolist():
                if not info.filename.lower().endswith(".pdf"):
                    continue
                final = destino / Path(info.filename).name
                with zf.open(info) as src, open(final, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                hechos.append(str(final.relative_to(CARPETA)))
    return {"importados": hechos, "saltados": saltados}


# ── Temas para la próxima reunión con el contador ───────────────────────────


def _iva_comisiones_bancarias() -> list[dict[str, Any]]:
    """IVA que Bancolombia cobra por cada pago automático, por mes, desde el extracto."""
    from app.services.contabilidad_core import _DB_PATH

    with sqlite3.connect(_DB_PATH) as con:
        filas = con.execute(
            "SELECT substr(m.fecha, 1, 7), COUNT(*), SUM(m.monto) FROM extracto_movimientos m "
            "JOIN extractos_bancarios e ON e.id = m.extracto_id "
            "WHERE e.tercero_id IS NULL AND m.descripcion LIKE 'COBRO IVA PAGOS AUTOMATICOS%' "
            "GROUP BY 1 ORDER BY 1"
        ).fetchall()
    return [{"periodo": p, "lineas": n, "valor": round(v or 0, 2)} for p, n, v in filas]


_CALCULOS = {"iva_comisiones_bancarias": _iva_comisiones_bancarias}


def temas_reunion() -> list[dict[str, Any]]:
    """Temas abiertos/cerrados para tratar con el contador, con sus cifras en vivo."""
    try:
        temas = json.loads(TEMAS_PATH.read_text(encoding="utf-8")).get("temas", [])
    except Exception:  # noqa: BLE001
        return []
    for t in temas:
        calc = _CALCULOS.get(t.get("calculo") or "")
        if calc:
            try:
                t["cifras"] = calc()
            except Exception as e:  # noqa: BLE001
                t["cifras_error"] = str(e)
        if t.get("calculo") == "certificados_retencion":
            t["cifras_certificados"] = listar()["totales"]
    return temas


if __name__ == "__main__":  # pragma: no cover
    import sys

    if "--importar" in sys.argv:
        print(json.dumps(importar_descargas(), ensure_ascii=False, indent=2))
    print(json.dumps(listar()["totales"], ensure_ascii=False, indent=2))
