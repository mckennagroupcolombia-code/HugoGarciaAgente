#!/usr/bin/env python3
"""Lee los PDF bajados por `descargar_soportes_contador.py` y extrae los valores declarados.

Reconoce por el contenido (no por el nombre) ocho documentos:

  350        Retención en la fuente mensual (DIAN): renglones 27-138. Guarda todos los
             renglones con valor y, aparte, compras PJ (36/49) y PN (86/102), total 130/136.
  490        Recibo oficial de pago DIAN: concepto, período, fecha y valor pagado.
  300        IVA cuatrimestral: renglones con valor (saldo a pagar 82/88, a favor 83/89).
  RTICA      Retención de ICA bimestral Bogotá: base (BR), retenciones (RP), saldo (HA),
             fecha de presentación y valor pagado.
  CERT       Certificado de retención en la fuente por tercero: NIT, concepto, tarifa,
             base y retención (lo que McKenna le certificó a cada proveedor por el año).
  110        Renta anual: patrimonio, ingresos, costos, renta líquida, impuesto, saldo.
  ICA        ICA anual Bogotá: base (BE), impuesto (IC), retenido (BI), saldo (HA), pago (VP).
  PAGO_SDH   Recibo oficial de pago de Hacienda Bogotá (ICA anual o RTICA): fecha y valor.

Escribe `docs/contabilidad/<año>/declaraciones_contador.json` por año del correo y, si
se pasa --comparar, cruza cada 350 por AÑO GRAVABLE contra la cuenta 2365 del Libro Mayor
(`app/data/contabilidad.db`) mes a mes, separando personas jurídicas y naturales por
`cc_terceros.tipo_persona` (→ `docs/contabilidad/comparacion_350_vs_2365.json`).

Uso:
    source venv/bin/activate
    python3 scripts/extraer_declaraciones_contador.py                 # todos los años
    python3 scripts/extraer_declaraciones_contador.py --anio 2026 --comparar

No llama a ningún LLM. Necesita `pdftotext` (poppler) o PyMuPDF como respaldo.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sqlite3
import subprocess
import sys
import unicodedata
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(ch for ch in s if not unicodedata.combining(ch)).lower()


def texto_pdf(path: Path) -> str:
    if shutil.which("pdftotext"):
        r = subprocess.run(["pdftotext", "-layout", str(path), "-"], capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout
    try:
        import fitz  # PyMuPDF

        with fitz.open(path) as doc:
            return "\n".join(page.get_text() for page in doc)
    except Exception as e:  # pragma: no cover
        raise RuntimeError(f"No pude leer {path}: {e}")


def _int(s: str) -> int:
    return int(s.replace(",", "").replace(".", "") or 0)


def _digitos_espaciados(s: str) -> str:
    """'2 0 2 6' → '2026'."""
    return re.sub(r"\s+", "", s)


def _renglones(texto: str, minimo: int, maximo: int) -> dict[int, int]:
    """Pares 'NN  valor' en la misma línea → {renglón: valor}. Solo renglones en [minimo, maximo]."""
    out: dict[int, int] = {}
    for linea in texto.splitlines():
        for m in re.finditer(r"(?<![\d,.])(\d{2,3})\s{2,}(\d{1,3}(?:,\d{3})+|\d+)(?![\d,])", linea):
            r, v = int(m.group(1)), _int(m.group(2))
            if minimo <= r <= maximo and r not in out:
                out[r] = v
    return out


# ---------------------------------------------------------------- parsers


def parse_350(t: str) -> dict:
    anio = re.search(r"1\.\s*Año\s+((?:\d\s*){4})", t)
    per = re.search(r"3\.\s*Per[ií]odo\s+(\d\s?\d?)(?!\d)", t)
    nform = re.search(r"4\.\s*Número de formulario\s+(\d{10,})", t)
    reng = _renglones(t, 27, 138)
    fecha = re.search(r"(20\d\d-\d\d-\d\d) / \d\d:\d\d:\d\d", t)
    compras = {
        "pj_base": reng.get(36, 0), "pj_retencion": reng.get(49, 0),
        "pn_base": reng.get(86, 0), "pn_retencion": reng.get(102, 0),
    }
    otros = {
        str(r): v for r, v in sorted(reng.items())
        if v and r not in (36, 49, 86, 102, 130, 136, 138)
    }
    return {
        "tipo": "350",
        "anio": int(_digitos_espaciados(anio.group(1))) if anio else None,
        "periodo": int(_digitos_espaciados(per.group(1))) if per else None,
        "numero_formulario": nform.group(1) if nform else None,
        "fecha_presentacion": fecha.group(1) if fecha else None,
        "compras": compras,
        "total_renta_130": reng.get(130, 0),
        "total_retenciones_136": reng.get(136, 0),
        "total_mas_sanciones_138": reng.get(138, 0),
        "otros_renglones_con_valor": otros,
        "renglones": {str(k): v for k, v in sorted(reng.items())},
    }


def parse_490(t: str) -> dict:
    anio = re.search(r"1\.\s*Año\s+((?:\d\s*){4})", t)
    concepto = re.search(r"2\.\s*Concepto\s+((?:\d\s*){2})", t)
    per = re.search(r"3\.\s*Per[ií]odo\s+(\d\s?\d?)(?!\d)", t)
    nform = re.search(r"4\.\s*Número de formulario\s+(\d{10,})", t)
    ref = re.search(r"29\s*\.\s*No\. de formulario\s+(\d{10,})", t) or re.search(r"(?m)^\s+\d\s+\d\s+(\d{13})\s*$", t)
    fecha = re.search(r"recibo\s+((?:\d\s*){8})", t)
    imp = re.search(r"Valor pago impuesto\s+([\d,]+)", t)
    san = re.search(r"Valor pago sanci[oó]n\s+([\d,]+)", t)
    mora = re.search(r"Valor pago intereses de mora\s+([\d,]+)", t)
    f = _digitos_espaciados(fecha.group(1)) if fecha else ""
    return {
        "tipo": "490",
        "anio": int(_digitos_espaciados(anio.group(1))) if anio else None,
        "concepto": _digitos_espaciados(concepto.group(1)) if concepto else None,  # 61 = retefuente, 15 = IVA…
        "periodo": int(_digitos_espaciados(per.group(1))) if per else None,
        "numero_formulario": nform.group(1) if nform else None,
        "formulario_pagado": ref.group(1) if ref else None,
        "fecha_pago": f"{f[:4]}-{f[4:6]}-{f[6:8]}" if len(f) == 8 else None,
        "valor_impuesto": _int(imp.group(1)) if imp else 0,
        "valor_sancion": _int(san.group(1)) if san else 0,
        "valor_mora": _int(mora.group(1)) if mora else 0,
    }


def parse_300(t: str) -> dict:
    anio = re.search(r"1\.\s*Año\s+((?:\d\s*){4})", t)
    per = re.search(r"3\.\s*Per[ií]odo\s+(\d\s?\d?)(?!\d)", t)
    nform = re.search(r"4\.\s*Número de formulario\s+(\d{10,})", t)
    reng = _renglones(t, 27, 91)
    return {
        "tipo": "300",
        "anio": int(_digitos_espaciados(anio.group(1))) if anio else None,
        "periodo": int(_digitos_espaciados(per.group(1))) if per else None,
        "numero_formulario": nform.group(1) if nform else None,
        "ingresos_gravados_28": reng.get(28, 0),
        "total_ingresos_netos_43": reng.get(43, 0),
        "impuesto_generado_67": reng.get(67, 0),
        "impuesto_descontable_81": reng.get(81, 0),
        "saldo_a_pagar_periodo_82": reng.get(82, 0),
        "saldo_a_favor_periodo_83": reng.get(83, 0),
        "retenciones_iva_practicadas_85": reng.get(85, 0),
        "total_saldo_a_pagar_88": reng.get(88, 0),
        "total_saldo_a_favor_89": reng.get(89, 0),
        "renglones": {str(k): v for k, v in sorted(reng.items())},
    }


def parse_rtica(t: str) -> dict:
    anio = re.search(r"AÑO GRAVABLE\s+(\d{4})", t)
    # "PERIODO   1   2   3  X   4 ..." → el número justo antes de la X
    per = re.search(r"PERIODO\s+((?:\d\s+)*)X", t)
    periodo = int(per.group(1).split()[-1]) if per and per.group(1).split() else None
    nform = re.search(r"Formulario No\.\s*\n?\s*(?:\d{3}\s*\n)?\s*(\d{15,})", t)
    def val(cod: str) -> int:
        m = re.search(rf"\b{cod}\s+([\d,]+)", t)
        return _int(m.group(1)) if m else 0
    fecha = re.search(r"FECHA DE PRESENTACI[OÓ]N\s+(\d{2})/(\d{2})/(\d{4})", t)
    pagado = re.search(r"VALOR PAGADO:\s+(.+)", t)
    return {
        "tipo": "RTICA",
        "anio": int(anio.group(1)) if anio else None,
        "periodo": periodo,
        "numero_formulario": nform.group(1) if nform else None,
        "base_retencion_BR": val("BR"),
        "retenciones_practicadas_RP": val("RP"),
        "total_a_declarar_BH": val("BH"),
        "saldo_a_cargo_HA": val("HA"),
        "fecha_presentacion": f"{fecha.group(3)}-{fecha.group(2)}-{fecha.group(1)}" if fecha else None,
        "valor_pagado_texto": pagado.group(1).strip() if pagado else None,
    }


def parse_certificado(t: str) -> dict:
    anio = re.search(r"Año Gravable:\s+([\d,]+)", t)
    a = re.search(r"Retuvo a:\s+(.+)", t)
    nit = re.search(r"NIT\s+([\d,]+)\s*(?:-\s*(\d))?", t[t.find("Retuvo a:"):] if "Retuvo a:" in t else "")
    filas = []
    for m in re.finditer(r"(?m)^\s*([A-ZÁÉÍÓÚÑ ]{3,40}?)\s+(\d+(?:\.\d+)?)\s+([\d,]+)\s+([\d,]+)\s*$", t):
        filas.append({
            "concepto": m.group(1).strip(), "tarifa": float(m.group(2)),
            "base": _int(m.group(3)), "retencion": _int(m.group(4)),
        })
    return {
        "tipo": "CERT",
        "anio": _int(anio.group(1)) if anio else None,
        "tercero": a.group(1).strip() if a else None,
        "nit": nit.group(1).replace(",", "") if nit else None,
        "conceptos": filas,
        "base_total": sum(f["base"] for f in filas),
        "retencion_total": sum(f["retencion"] for f in filas),
    }


def parse_110(t: str) -> dict:
    anio = re.search(r"1\.\s*Año\s+((?:\d\s*){4})", t)
    nform = re.search(r"4\.\s*Número de formulario\s+(\d{10,})", t)
    reng = _renglones(t, 33, 117)
    fecha = re.search(r"(20\d\d-\d\d-\d\d) / \d\d:\d\d:\d\d", t)
    otras_ret = re.search(r"Otras retenciones\s+([\d,]+)", t)
    return {
        "tipo": "110",
        "anio": int(_digitos_espaciados(anio.group(1))) if anio else None,
        "periodo": 1,
        "numero_formulario": nform.group(1) if nform else None,
        "fecha_presentacion": fecha.group(1) if fecha else None,
        "patrimonio_bruto_44": reng.get(44, 0),
        "pasivos_45": reng.get(45, 0),
        "patrimonio_liquido_46": reng.get(46, 0),
        "ingresos_brutos_ordinarios_47": reng.get(47, 0),
        "total_ingresos_brutos_58": reng.get(58, 0),
        "costos_62": reng.get(62, 0),
        "total_costos_gastos_67": reng.get(67, 0),
        "renta_liquida_75": reng.get(75, 0),
        "impuesto_neto_renta_96": reng.get(96, 0),
        "total_impuesto_a_cargo_99": reng.get(99, 0),
        "otras_retenciones_106": _int(otras_ret.group(1)) if otras_ret else 0,
        "saldo_a_pagar_impuesto_111": reng.get(111, 0),
        "total_saldo_a_pagar_113": reng.get(113, 0),
        "total_saldo_a_favor_114": reng.get(114, 0),
        "renglones": {str(k): v for k, v in sorted(reng.items())},
    }


def _periodo_bogota(t: str) -> int | None:
    m = re.search(r"Anual\s+(\d)\s+X", t)
    if m:
        return int(m.group(1))
    m = re.search(r"PERIODO\s+((?:\d\s+)*)X", t)
    return int(m.group(1).split()[-1]) if m and m.group(1).split() else None


def _cod(t: str, cod: str) -> int:
    m = re.search(rf"\b{cod}\s+([\d,]+)\s*$", t, re.M)
    return _int(m.group(1)) if m else 0


def _fecha_bogota(t: str) -> str | None:
    m = re.search(r"(\d{2})/([A-Z]{3}|\d{2})/(\d{4})", t)
    if not m:
        return None
    mes = m.group(2)
    if not mes.isdigit():
        tabla = {"ENE": "01", "FEB": "02", "MAR": "03", "ABR": "04", "MAY": "05", "JUN": "06",
                 "JUL": "07", "AGO": "08", "SEP": "09", "OCT": "10", "NOV": "11", "DIC": "12"}
        mes = tabla.get(mes, "00")
    return f"{m.group(3)}-{mes}-{m.group(1)}"


def parse_ica_anual(t: str) -> dict:
    anio = re.search(r"AÑO GRAVABLE\s+(\d{4})", t)
    nform = re.search(r"Formulario No\.\s*\n?\s*(\d{15,})", t)
    fecha = re.search(r"FECHA DE PRESENTACI[OÓ]N\s+(\d{2})/(\d{2})/(\d{4})", t)
    pagado = re.search(r"VALOR PAGADO:\s+(.+)", t)
    return {
        "tipo": "ICA",
        "anio": int(anio.group(1)) if anio else None,
        "periodo": _periodo_bogota(t),
        "numero_formulario": nform.group(1) if nform else None,
        "ingresos_netos_gravables_BE": _cod(t, "BE"),
        "impuesto_ica_IC": _cod(t, "IC"),
        "avisos_tableros_BF": _cod(t, "BF"),
        "total_impuesto_a_cargo_FU": _cod(t, "FU"),
        "retenido_ica_BI": _cod(t, "BI"),
        "saldo_a_cargo_HA": _cod(t, "HA"),
        "valor_a_pagar_VP": _cod(t, "VP"),
        "fecha_presentacion": f"{fecha.group(3)}-{fecha.group(2)}-{fecha.group(1)}" if fecha else None,
        "valor_pagado_texto": pagado.group(1).strip() if pagado else None,
    }


def parse_pago_bogota(t: str) -> dict:
    """Recibo oficial de pago de la Secretaría de Hacienda de Bogotá (ICA anual o RTICA)."""
    anio = re.search(r"AÑO GRAVABLE\s+(\d{4})", t)
    nform = re.search(r"Formulario No\.\s*\n?\s*(\d{15,})", t)
    ref = re.search(r"Referencia de Recaudo\s*\n?\s*(\d{8,})", t)
    impuesto = "RTICA" if "retenciones del impuesto" in _norm(t) else "ICA"
    return {
        "tipo": "PAGO_SDH",
        "impuesto": impuesto,
        "anio": int(anio.group(1)) if anio else None,
        "periodo": _periodo_bogota(t),
        "numero_formulario": nform.group(1) if nform else None,
        "referencia_recaudo": ref.group(1) if ref else None,
        "fecha_pago": _fecha_bogota(t),
        "valor_a_pagar_VP": _cod(t, "VP"),
        "intereses_mora_IM": _cod(t, "IM"),
        "total_a_pagar_TP": _cod(t, "TP"),
    }


def detectar(t: str) -> str | None:
    n = _norm(t)
    if "total retenciones renta y complementario" in n:
        return "350"
    if "valor pago impuesto" in n and "concepto" in n:
        return "490"
    if "total impuesto generado por operaciones" in n or ("impuesto descontable" in n and "saldo a pagar por el periodo fiscal" in n):
        return "300"
    if ("retenciones de industria y" in n or "retenciones del impuesto de industria y comercio" in n) and "base de la retencion" in n:
        return "RTICA"
    if "certificado de retencion en la fuente" in n and "retuvo a" in n:
        return "CERT"
    if "recibo oficial de pago" in n and ("industria y comercio" in n or "industria y" in n):
        return "PAGO_SDH"
    if "impuesto de industria y comercio" in n and "total ingresos netos gravables" in n:
        return "ICA"
    if "renta liquida gravable" in n and "total impuesto a cargo" in n:
        return "110"
    return None


PARSERS = {
    "350": parse_350, "490": parse_490, "300": parse_300, "110": parse_110,
    "RTICA": parse_rtica, "ICA": parse_ica_anual, "PAGO_SDH": parse_pago_bogota, "CERT": parse_certificado,
}


# ---------------------------------------------------------------- comparación con el Libro Mayor


def libro_mayor_2365(anio: int) -> dict[int, dict]:
    """Créditos (causación) y débitos (pagos) de la 2365 por mes, PJ/PN según cc_terceros.tipo_persona."""
    db = _ROOT / "app" / "data" / "contabilidad.db"
    out: dict[int, dict] = {m: {"pj": 0.0, "pn": 0.0, "sin_tercero": 0.0, "pagos": 0.0, "terceros": {}} for m in range(1, 13)}
    if not db.exists():
        return out
    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row
    q = """
        SELECT substr(m.fecha, 6, 2) AS mes, l.credito, l.debito,
               t.nombre AS tercero, t.tipo_persona, t.identificacion
          FROM cc_movimiento_lineas l
          JOIN cc_movimientos m ON m.id = l.movimiento_id AND m.estado <> 'anulado'
          JOIN cc_plan_cuentas c ON c.id = l.cuenta_id
          LEFT JOIN cc_terceros t ON t.id = COALESCE(l.tercero_id, m.tercero_id)
         WHERE c.codigo LIKE '2365%' AND substr(m.fecha, 1, 4) = ?
    """
    for r in con.execute(q, (str(anio),)):
        mes = int(r["mes"])
        if r["debito"]:
            out[mes]["pagos"] += r["debito"]
        if r["credito"]:
            tp = (r["tipo_persona"] or "").lower()
            clave = "pn" if tp == "natural" else ("pj" if tp else "sin_tercero")
            out[mes][clave] += r["credito"]
            nombre = r["tercero"] or "(sin tercero)"
            d = out[mes]["terceros"].setdefault(nombre, {"tipo_persona": tp or "?", "retencion": 0.0})
            d["retencion"] += r["credito"]
    con.close()
    return out


def comparar(decls: list[dict], anio: int) -> list[dict]:
    lm = libro_mayor_2365(anio)
    f350 = {d["periodo"]: d for d in decls if d["tipo"] == "350" and d["anio"] == anio}
    f490 = {d["periodo"]: d for d in decls if d["tipo"] == "490" and d["anio"] == anio and d.get("concepto") == "61"}
    filas = []
    for mes in range(1, 13):
        d = f350.get(mes)
        p = f490.get(mes)
        l = lm[mes]
        if not d and not (l["pj"] or l["pn"] or l["pagos"]):
            continue
        filas.append({
            "mes": mes,
            "declarado_pj": d["compras"]["pj_retencion"] if d else None,
            "declarado_pn": d["compras"]["pn_retencion"] if d else None,
            "declarado_total": d["total_retenciones_136"] if d else None,
            "declarado_base_pn": d["compras"]["pn_base"] if d else None,
            "pagado_490": p["valor_impuesto"] if p else None,
            "fecha_pago_490": p["fecha_pago"] if p else None,
            "libro_pj": round(l["pj"]),
            "libro_pn": round(l["pn"]),
            "libro_sin_tercero": round(l["sin_tercero"]),
            "libro_pagos_2365": round(l["pagos"]),
            "dif_pj": (d["compras"]["pj_retencion"] - round(l["pj"])) if d else None,
            "dif_pn": (d["compras"]["pn_retencion"] - round(l["pn"])) if d else None,
            "libro_terceros": l["terceros"],
        })
    return filas


def _fmt(v) -> str:
    return "—" if v is None else f"{v:,.0f}".replace(",", ".")


def imprimir_comparacion(filas: list[dict], anio: int) -> None:
    print(f"\n=== Formulario 350 (compras) vs. cuenta 2365 del Libro Mayor — {anio} ===")
    print(f"{'mes':4} {'350 PJ':>10} {'LM PJ':>10} {'dif PJ':>9} | {'350 PN':>9} {'LM PN':>9} {'dif PN':>9} | {'350 tot':>9} {'490 pag':>9} {'LM pagos':>9}")
    tot = {k: 0 for k in ("dpj", "lpj", "dpn", "lpn", "dt", "pag", "lpag")}
    for f in filas:
        print(f"{MESES[f['mes']-1]:4} {_fmt(f['declarado_pj']):>10} {_fmt(f['libro_pj']):>10} {_fmt(f['dif_pj']):>9} | "
              f"{_fmt(f['declarado_pn']):>9} {_fmt(f['libro_pn']):>9} {_fmt(f['dif_pn']):>9} | "
              f"{_fmt(f['declarado_total']):>9} {_fmt(f['pagado_490']):>9} {_fmt(f['libro_pagos_2365']):>9}")
        if f["declarado_pj"] is not None:
            tot["dpj"] += f["declarado_pj"]; tot["dpn"] += f["declarado_pn"]; tot["dt"] += f["declarado_total"]
            tot["lpj"] += f["libro_pj"]; tot["lpn"] += f["libro_pn"]
        tot["pag"] += f["pagado_490"] or 0; tot["lpag"] += f["libro_pagos_2365"]
    print(f"{'tot*':4} {_fmt(tot['dpj']):>10} {_fmt(tot['lpj']):>10} {_fmt(tot['dpj']-tot['lpj']):>9} | "
          f"{_fmt(tot['dpn']):>9} {_fmt(tot['lpn']):>9} {_fmt(tot['dpn']-tot['lpn']):>9} | "
          f"{_fmt(tot['dt']):>9} {_fmt(tot['pag']):>9} {_fmt(tot['lpag']):>9}")
    print("  * totales solo de los meses con 350 declarado. PJ/PN del Libro Mayor según cc_terceros.tipo_persona.")


# ---------------------------------------------------------------- main


def procesar_anio(anio: int) -> dict:
    base = _ROOT / "docs" / "contabilidad" / str(anio) / "Soportes_Contador"
    if not base.exists():
        print(f"(sin carpeta {base.relative_to(_ROOT)})")
        return {}
    decls: list[dict] = []
    no_reconocidos: list[str] = []
    for pdf in sorted(base.rglob("*.pdf")):
        try:
            t = texto_pdf(pdf)
        except Exception as e:
            no_reconocidos.append(f"{pdf.name}: {e}")
            continue
        tipo = detectar(t)
        if not tipo:
            no_reconocidos.append(pdf.relative_to(base).as_posix())
            continue
        d = PARSERS[tipo](t)
        d["archivo"] = pdf.relative_to(_ROOT).as_posix()
        decls.append(d)

    resumen = {
        "carpeta": base.relative_to(_ROOT).as_posix(),
        "documentos": len(decls),
        "por_tipo": {k: sum(1 for d in decls if d["tipo"] == k) for k in PARSERS},
        "no_reconocidos": no_reconocidos,
        "declaraciones": decls,
    }
    out = _ROOT / "docs" / "contabilidad" / str(anio) / "declaraciones_contador.json"
    out.write_text(json.dumps(resumen, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{anio}: {len(decls)} documentos reconocidos {resumen['por_tipo']} → {out.relative_to(_ROOT)}")
    if no_reconocidos:
        print(f"  no reconocidos ({len(no_reconocidos)}):")
        for n in no_reconocidos:
            print(f"    - {n}")
    return resumen


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--anio", type=int, action="append", help="Año de la carpeta (repetible). Default: todos los que existan")
    ap.add_argument("--comparar", action="store_true", help="Cruzar los 350 contra la cuenta 2365 del Libro Mayor")
    args = ap.parse_args()
    anios = args.anio or sorted(
        int(p.name) for p in (_ROOT / "docs" / "contabilidad").glob("20*") if (p / "Soportes_Contador").exists()
    )
    todas: list[dict] = []
    for a in anios:
        todas += procesar_anio(a).get("declaraciones", [])
    if args.comparar and todas:
        # Se compara por AÑO GRAVABLE del formulario, no por el año del correo: el periodo 12
        # llega en enero del año siguiente y vive en la otra carpeta.
        anios_grav = sorted({d["anio"] for d in todas if d["tipo"] == "350" and d["anio"]})
        comparaciones = {}
        for ag in anios_grav:
            filas = comparar(todas, ag)
            comparaciones[str(ag)] = filas
            imprimir_comparacion(filas, ag)
        out = _ROOT / "docs" / "contabilidad" / "comparacion_350_vs_2365.json"
        out.write_text(json.dumps(comparaciones, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nComparación → {out.relative_to(_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
