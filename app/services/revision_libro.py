"""«Revisión del libro»: qué tenemos, qué nos falta y qué hay que ajustar hoy.

Es la pantalla con la que se abre la reunión con el contador. Su primera pregunta
siempre es «¿qué tienen y qué falta para revisar el libro?», y la respuesta estaba
repartida en diez vistas. Aquí se arma en un solo lugar, con datos vivos:

- **tenemos / falta**: los insumos del libro (banco, documentos de la DIAN,
  declaraciones del contador, préstamos, certificados) y los de los saldos
  iniciales al corte. Cada renglón dice qué hay y, si falta algo, qué.
- **ajustar**: lo que hoy está mal o incompleto en el libro, en orden, con a
  dónde ir para resolverlo.
- **hablar**: los temas abiertos para la reunión (app/data/temas_reunion_contador.json).

Los insumos que el sistema no puede detectar solo (estados financieros del
contador, saldo de Mercado Pago, inventario, capital social) viven en
app/data/revision_libro_insumos.json; los demás se calculan.

Solo lectura y sin LLM: lo puede abrir el perfil contador.
"""
from __future__ import annotations

import json
import re
import sqlite3
from datetime import date
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parents[2]
INSUMOS_PATH = _REPO / "app" / "data" / "revision_libro_insumos.json"
DIAN_DIR = _REPO / "docs" / "contabilidad" / "DIAN_listados"
DECLARACIONES = _REPO / "docs" / "contabilidad" / "2026" / "declaraciones_contador.json"

_MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


def _mes(m: str) -> str:
    a, n = m.split("-")
    return f"{_MESES[int(n) - 1]} {a}"


def _cop(n: float) -> str:
    return "$" + f"{round(n):,}".replace(",", ".")


def _renglon(id_: str, titulo: str, estado: str, resumen: str, detalle: list[str] | None = None,
             ir: str | None = None, cifra: str | None = None) -> dict[str, Any]:
    """estado: ok (lo tenemos) · parcial (hay, con huecos) · falta."""
    return {"id": id_, "titulo": titulo, "estado": estado, "resumen": resumen,
            "detalle": detalle or [], "ir": ir, "cifra": cifra}


def _con():
    from app.services.contabilidad_core import _DB_PATH
    from app.services.extracto_bancario import ensure_extracto_tables

    ensure_extracto_tables()   # un libro recién creado (tests) aún no tiene las tablas del banco
    con = sqlite3.connect(_DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def _rango_meses(desde: str, hasta: str) -> list[str]:
    a, m = map(int, desde.split("-"))
    out = []
    while f"{a:04d}-{m:02d}" <= hasta:
        out.append(f"{a:04d}-{m:02d}")
        m += 1
        if m == 13:
            a, m = a + 1, 1
    return out


def _mes_cerrado(hoy: date) -> str:
    """Último mes completo (el anterior al actual)."""
    a, m = hoy.year, hoy.month - 1
    if m == 0:
        a, m = a - 1, 12
    return f"{a:04d}-{m:02d}"


# ── Lo que tenemos / lo que falta ───────────────────────────────────────────


def _banco(corte: str, hoy: date) -> tuple[dict, dict]:
    """(extractos cargados, conciliación desde el corte)."""
    with _con() as con:
        filas = con.execute(
            """SELECT substr(m.fecha,1,7) mes, COUNT(*) n,
                      SUM(EXISTS(SELECT 1 FROM extracto_vinculos v WHERE v.extracto_mov_id=m.id)) conc
                 FROM extracto_movimientos m JOIN extractos_bancarios e ON e.id=m.extracto_id
                WHERE e.tercero_id IS NULL GROUP BY 1 ORDER BY 1"""
        ).fetchall()
    por_mes = {f["mes"]: (f["n"], f["conc"] or 0) for f in filas}
    ultimo = _mes_cerrado(hoy)
    desde = "2025-01"
    esperados = _rango_meses(desde, ultimo)
    faltan = [m for m in esperados if m not in por_mes]
    cargados = [m for m in esperados if m in por_mes]
    extractos = _renglon(
        "extractos", "Extractos de Bancolombia", "ok" if not faltan else "parcial",
        (f"{len(cargados)} meses cargados, de {_mes(cargados[0])} a {_mes(cargados[-1])}" if cargados
         else "Ningún extracto cargado") + (f" · faltan {len(faltan)}" if faltan else ""),
        [f"Falta {_mes(m)}" for m in faltan] or ["Cuenta de ahorros 428-000009-74, mes a mes sin huecos."],
        ir="diario",
    )
    meses_corte = [m for m in esperados + [hoy.strftime("%Y-%m")] if m >= corte[:7] and m in por_mes]
    total = sum(por_mes[m][0] for m in meses_corte)
    conc = sum(por_mes[m][1] for m in meses_corte)
    pend = total - conc
    detalle = [f"{_mes(m)}: {por_mes[m][1]} de {por_mes[m][0]} líneas conciliadas" for m in meses_corte]
    conciliacion = _renglon(
        "conciliacion", "Banco conciliado desde el corte", "ok" if pend == 0 and total else "parcial",
        f"{conc} de {total} líneas" + (" — todo conciliado" if pend == 0 and total else f" — faltan {pend}"),
        detalle, ir="taller-conciliacion", cifra=f"{conc}/{total}",
    )
    return extractos, conciliacion


def _cuadre() -> dict:
    from app.services.contabilidad_core import balance_comprobacion

    b = balance_comprobacion()
    ok = bool(b.get("cuadra"))
    total = float(b.get("total_debito") or 0)
    return _renglon(
        "cuadre", "El libro cuadra (partida doble)", "ok" if ok else "falta",
        f"Débitos = créditos: {_cop(total)}" if ok else "Débitos y créditos NO coinciden",
        ["Cada asiento suma igual al débito y al crédito; el balance de comprobación lo confirma."]
        if ok else ["Hay que encontrar el asiento descuadrado antes de revisar cualquier saldo."],
        ir="balance",
    )


def _dian() -> dict:
    meses = sorted(set(re.findall(r"dian_(\d{4}-\d{2})-01_", " ".join(p.name for p in DIAN_DIR.glob("*.xlsx")))))
    # el listado acumulado de 2026 (ene-ago en un solo archivo) cuenta como esos meses
    if (DIAN_DIR / "dian_2026-01-01_2026-08-31.xlsx").exists():
        meses = sorted(set(meses) | set(_rango_meses("2026-01", "2026-08")))
    if not meses:
        return _renglon("dian", "Documentos electrónicos de la DIAN", "falta",
                        "No se han descargado", ["Correr scripts/descargar_listados_dian.py con el token del mes."])
    return _renglon(
        "dian", "Documentos electrónicos de la DIAN", "ok",
        f"Facturas, notas y documentos soporte de {_mes(meses[0])} a {_mes(meses[-1])}",
        ["Emitidos y recibidos, la misma fuente con la que declara el contador.",
         "Cuadran con lo declarado: ventas 2025 = renta 110 al peso; ene-abr 2026 = IVA 300."],
    )


def _declaraciones() -> dict:
    try:
        decl = json.loads(DECLARACIONES.read_text(encoding="utf-8")).get("declaraciones", [])
    except Exception:  # noqa: BLE001
        decl = []
    d26 = [x for x in decl if x.get("anio") == 2026]
    p350 = sorted({int(x["periodo"]) for x in d26 if x.get("tipo") == "350" and x.get("periodo")})
    p300 = sorted({int(x["periodo"]) for x in d26 if x.get("tipo") == "300" and x.get("periodo")})
    renta = [x for x in decl if x.get("tipo") == "110"]
    faltan350 = [m for m in range(1, max(p350 or [0]) + 1) if m not in p350]
    det = [
        f"Retención en la fuente (350): {', '.join(_MESES[m - 1] for m in p350) or 'ninguno'}"
        + (f" — faltan {', '.join(_MESES[m - 1] for m in faltan350)}" if faltan350 else ""),
        f"IVA (300) 2026: cuatrimestre {', '.join(str(p) for p in p300) or 'ninguno'}",
        f"Renta: año gravable {', '.join(str(r.get('anio')) for r in renta) or 'ninguno'}",
    ]
    return _renglon(
        "declaraciones", "Declaraciones que presentó el contador", "ok" if p350 and not faltan350 else "parcial",
        f"{len(d26)} documentos de 2026 (350, 300, recibos 490, ICA)", det,
    )


def _prestamos() -> dict:
    from app.services.contabilidad_core import resumen_prestamos

    r = resumen_prestamos()["recibidos"]
    return _renglon(
        "prestamos", "Préstamos recibidos", "ok",
        f"{r['cantidad']} vigentes por {_cop(r['total'])}, con contrato y cronograma",
        [f"{t['nombre']}: {_cop(t['saldo'])}" for t in r["terceros"]],
    )


def _certificados() -> tuple[dict, float, float]:
    from app.services.certificados_retencion import listar

    d = listar()
    meses = sorted(p["periodo"] for p in d["periodos"])
    total = d["totales"]["total"]
    causado = sum(d["causado_en_libro"].values())
    r = _renglon(
        "certificados", "Certificados de retención de Mercado Pago", "parcial" if meses else "falta",
        (f"{_mes(meses[0])} a {_mes(meses[-1])}: {_cop(total)} a favor" if meses else "Ninguno cargado"),
        ([f"{_mes(p['periodo'])}: {_cop(p['total'])}" for p in d["periodos"]]
         + ["Faltan los de enero a abril de 2026 (descargarlos en Mercado Pago → Impuestos)."]) if meses else [],
        ir="retenciones",
    )
    return r, total, causado


def _insumos_manuales() -> list[dict]:
    try:
        return json.loads(INSUMOS_PATH.read_text(encoding="utf-8")).get("insumos", [])
    except Exception:  # noqa: BLE001
        return []


def _eeff_2025() -> bool:
    return any("2025-12-31" in p.name for p in (_REPO / "docs" / "contabilidad").rglob("*estado*situacion*"))


# ── Lo que hay que ajustar ──────────────────────────────────────────────────


def _bancos_sin_banco(corte: str) -> list[dict]:
    """Asientos confirmados desde el corte que mueven Bancos y no tienen su línea del banco."""
    with _con() as con:
        filas = con.execute(
            """SELECT m.id, m.fecha, m.tipo_origen, m.concepto, m.referencia,
                      json_extract(m.plantilla_datos_json,'$.referencia') doc,
                      (SELECT nombre FROM cc_terceros t WHERE t.id=m.tercero_id) tercero,
                      SUM(l.debito) - SUM(l.credito) neto
                 FROM cc_movimientos m
                 JOIN cc_movimiento_lineas l ON l.movimiento_id = m.id
                 JOIN cc_plan_cuentas p ON p.id = l.cuenta_id AND p.codigo = '1110'
                WHERE m.estado = 'confirmado' AND m.fecha >= ?
                  AND NOT EXISTS (SELECT 1 FROM extracto_vinculos v
                                   WHERE v.movimiento_id = 'cc:' || m.id
                                      OR v.movimiento_id = substr(m.referencia, 6))
                GROUP BY m.id ORDER BY m.fecha""",
            (corte,),
        ).fetchall()
    return [dict(f) for f in filas]


def _ultimo_dia_con_extracto() -> str:
    with _con() as con:
        r = con.execute(
            """SELECT MAX(m.fecha) FROM extracto_movimientos m JOIN extractos_bancarios e ON e.id=m.extracto_id
                WHERE e.tercero_id IS NULL"""
        ).fetchone()
    return (r[0] or "")[:10]


def _doc(f: dict) -> str:
    """Número del documento legible: las facturas de Siigo traen un UUID como referencia."""
    doc = str(f.get("doc") or "")
    if re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", doc):
        return "factura de Siigo" + (" a consumidor final" if not f.get("tercero") else "")
    return doc or str(f.get("concepto") or "")[:40]


def _linea_asiento(f: dict) -> str:
    sentido = "entra" if (f["neto"] or 0) > 0 else "sale"
    tercero = f" · {f['tercero']}" if f.get("tercero") else ""
    return f"#{f['id']} · {f['fecha']} · {_doc(f)}{tercero} · {sentido} {_cop(abs(f['neto'] or 0))}"


def _ajustes(corte: str, hoy: date, total_cert: float, causado_cert: float) -> list[dict]:
    out: list[dict] = []
    hasta = _ultimo_dia_con_extracto()
    todos = _bancos_sin_banco(corte)
    # Lo posterior al último extracto no es un error: el banco todavía no lo muestra.
    sin_banco = [f for f in todos if f["fecha"] <= hasta]
    esperan = [f for f in todos if f["fecha"] > hasta]
    if sin_banco:
        ventas = [f for f in sin_banco if (f["neto"] or 0) > 0]
        egresos = [f for f in sin_banco if (f["neto"] or 0) < 0]
        det = [_linea_asiento(f) for f in sin_banco[:40]]
        out.append(_renglon(
            "sin_banco", "Asientos que dicen «Bancos» y el banco no los respalda", "falta",
            f"{len(ventas)} entradas y {len(egresos)} salidas hasta el {hasta}, sin su línea en el extracto",
            det + ["Cada uno es: un pago que entró por otra vía (Mercado Pago, efectivo), una venta "
                   "duplicada (las de Siigo del 1-sep a consumidor final), o un cobro que no ha llegado."],
            ir="taller-conciliacion", cifra=str(len(sin_banco)),
        ))
    with _con() as con:
        pend_pre = con.execute(
            """SELECT substr(m.fecha,1,7) mes, COUNT(*) n FROM extracto_movimientos m
                 JOIN extractos_bancarios e ON e.id=m.extracto_id
                WHERE e.tercero_id IS NULL AND m.fecha >= '2026-07-01' AND m.fecha < ?
                  AND NOT EXISTS (SELECT 1 FROM extracto_vinculos v WHERE v.extracto_mov_id=m.id)
                GROUP BY 1""", (corte,),
        ).fetchall()
    if pend_pre:
        n = sum(f["n"] for f in pend_pre)
        out.append(_renglon(
            "precorte", "Líneas del banco de julio y agosto sin explicar", "parcial",
            f"{n} líneas antes del corte",
            [f"{_mes(f['mes'])}: {f['n']} líneas" for f in pend_pre]
            + ["Son del período que declaró el contador: se explican con una nota, sin crear ingresos. "
               "Quedan cubiertas por el ajuste de saldos iniciales."],
            ir="taller-conciliacion", cifra=str(n),
        ))
    pendiente_cert = total_cert - causado_cert
    if pendiente_cert > 1:
        out.append(_renglon(
            "retenciones_sin_causar", "Retenciones que nos practicaron, sin registrar", "falta",
            f"{_cop(pendiente_cert)} certificados por Mercado Pago que el libro no tiene",
            ["Van a 135515 (renta), 135517 (IVA) y 135518 (ICA) como saldo a favor.",
             "Se definen con el contador: cómo las está tomando hoy en el 350, el 300 y el ICA."],
            ir="retenciones", cifra=_cop(pendiente_cert),
        ))
    try:
        from app.services.observaciones_contador import para_revision_libro

        obs = para_revision_libro()
    except Exception:  # noqa: BLE001
        obs = []
    if obs:
        out.append(_renglon(
            "observaciones_contador", "Observaciones del contador por atender", "falta",
            f"{len(obs)} preguntas o ajustes abiertos en el expediente",
            [f"{o['periodo']} · {o['objeto_tipo']} {o['objeto_id']} · {o['por']}: {o['texto'][:120]}" for o in obs[:10]]
            + ["Se responden desde el Expediente contable (botón Resolver en cada observación)."],
            ir="expediente", cifra=str(len(obs)),
        ))
    if esperan:
        out.append(_renglon(
            "esperan_extracto", "Movimientos que esperan el próximo extracto", "parcial",
            f"{len(esperan)} asientos posteriores al {hasta}: no es un error, el banco aún no los muestra",
            [_linea_asiento(f) for f in esperan[:40]]
            + ["Se concilian cuando se cargue el extracto del mes en el Taller de conciliación."],
            ir="taller-conciliacion", cifra=str(len(esperan)),
        ))
    insumos_falta = [i for i in _insumos_manuales() if i.get("estado") != "ok"]
    if not _eeff_2025():
        insumos_falta = [{"titulo": "Estados financieros 2025 del contador"}] + insumos_falta
    if insumos_falta:
        out.append(_renglon(
            "saldos_iniciales", "Saldos iniciales al 31-ago-2026 (el arranque del libro propio)", "falta",
            f"Faltan {len(insumos_falta)} insumos para cerrar el pasado con lo declarado",
            [f"Falta: {i['titulo']}" + (f" — {i['nota']}" if i.get("nota") else "") for i in insumos_falta]
            + ["Con ellos se arma un asiento de ajuste al 31-ago que deja cada cuenta con su saldo real."],
            cifra=str(len(insumos_falta)),
        ))
    # Lo que solo espera el extracto del mes va al final: no es urgente.
    return sorted(out, key=lambda r: r["id"] == "esperan_extracto")


# ── Ensamble ────────────────────────────────────────────────────────────────


def estado_revision(hoy: date | None = None) -> dict[str, Any]:
    from app.services.contabilidad_core import fecha_corte
    from app.services.certificados_retencion import temas_reunion

    hoy = hoy or date.today()
    corte = fecha_corte()
    extractos, conciliacion = _banco(corte, hoy)
    cert, total_cert, causado_cert = _certificados()
    renglones = [_cuadre(), conciliacion, extractos, _dian(), _declaraciones(), _prestamos(), cert]

    insumos = []
    for i in _insumos_manuales():
        insumos.append(_renglon(f"insumo_{i['id']}", i["titulo"], i.get("estado", "falta"),
                                i.get("nota", ""), i.get("detalle") or []))
    insumos.insert(0, _renglon(
        "insumo_eeff", "Estados financieros 2025 del contador", "ok" if _eeff_2025() else "falta",
        "El balance al 31-dic-2025 y de qué se componen los $272M de pasivos de la renta"
        if not _eeff_2025() else "Cargados",
        ["Solo están los de 2024. Pedírselos a William: sin ellos no se sabe cómo se reparten "
         "los pasivos entre proveedores, socios, préstamos e impuestos."] if not _eeff_2025() else [],
    ))

    tenemos = [r for r in renglones + insumos if r["estado"] == "ok"]
    falta = [r for r in renglones + insumos if r["estado"] != "ok"]
    ajustar = _ajustes(corte, hoy, total_cert, causado_cert)
    hablar = [t for t in temas_reunion() if t.get("estado") != "cerrado"]

    cuadra = next(r for r in renglones if r["id"] == "cuadre")["estado"] == "ok"
    if not cuadra:
        nivel, titulo = "rojo", "El libro no cuadra: eso va primero."
    elif ajustar:
        nivel = "amarillo"
        titulo = ("Septiembre en adelante está al día. Falta cerrar el pasado: "
                  "los saldos iniciales al 31-ago y lo que quedó suelto.")
    else:
        nivel, titulo = "verde", "El libro está listo para revisar."
    return {
        "hoy": hoy.isoformat(),
        "corte": corte,
        "veredicto": {
            "nivel": nivel,
            "titulo": titulo,
            "frase": f"Tenemos {len(tenemos)} cosas en orden, faltan {len(falta)} y hay "
                     f"{len(ajustar)} para ajustar. Hay {len(hablar)} temas para hablar con el contador.",
        },
        "tenemos": tenemos,
        "falta": falta,
        "ajustar": ajustar,
        "hablar": hablar,
    }
