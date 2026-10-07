"""Expediente contable del mes: el Libro Mayor como lo recorre un contador.

Período → cuenta → auxiliar → asiento → documentos y verificaciones. Es la única
pantalla que necesita el contador (perfil `contador`) para saber qué hay, qué falta
y de dónde sale cada cifra. El plan de cuentas es la espina; el banco, los listados
de la DIAN, Mercado Pago, las declaraciones y Alegra son fuentes de verificación
colgadas de la cuenta que respaldan — no apartados aparte.

Reglas:
- Solo lee SQLite y disco. Nada de Alegra, MeLi ni `armar_libro()` en la vista: eso
  tarda y falla; lo remoto ocurre al abrir un documento o al generar el paquete.
- Los meses anteriores al corte (`contabilidad_core.fecha_corte()`, 2026-09-01) son
  «período del contador»: se muestran sus fuentes y lo declarado, sin pretender que
  el libro los cuadre.
- Nunca escribe asientos. Sin LLM.
"""
from __future__ import annotations

import calendar
import json
import re
import sqlite3
import time
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parents[2]
PRIMER_PERIODO = "2025-01"

# Las cuentas que un contador mira primero, en este orden. Lo demás va plegado.
CUENTAS_CLAVE = ["1110", "130505", "1435", "2205", "2365", "2367", "2368", "2408",
                 "135515", "135517", "135518", "2195", "4135", "4175", "5"]

# Cuenta de impuesto → (formulario, qué renglón del contador la declara)
CUENTAS_IMPUESTO = {
    "2365": ("350", "retefuente"), "2367": ("350", "reteiva"), "2368": ("rtica", "reteica"),
    "2408": ("300", "iva"), "135515": ("certificados", "retefuente"),
    "135517": ("certificados", "reteiva"), "135518": ("certificados", "reteica"),
}

_RE_PERIODO = re.compile(r"^\d{4}-\d{2}$")
_cache: dict[str, dict[str, Any]] = {}
_TTL = 120


def _validar_periodo(periodo: str) -> str:
    periodo = (periodo or "").strip()
    if not _RE_PERIODO.match(periodo) or not 1 <= int(periodo[5:7]) <= 12:
        raise ValueError("Período inválido: use AAAA-MM")
    return periodo


def _rango(periodo: str) -> tuple[str, str]:
    a, m = int(periodo[:4]), int(periodo[5:7])
    return f"{periodo}-01", f"{periodo}-{calendar.monthrange(a, m)[1]:02d}"


def _periodo_anterior(periodo: str) -> str:
    a, m = int(periodo[:4]), int(periodo[5:7]) - 1
    if m == 0:
        a, m = a - 1, 12
    return f"{a:04d}-{m:02d}"


def _meses(desde: str, hasta: str) -> list[str]:
    out, p = [], desde
    while p <= hasta:
        out.append(p)
        a, m = int(p[:4]), int(p[5:7]) + 1
        if m == 13:
            a, m = a + 1, 1
        p = f"{a:04d}-{m:02d}"
    return out


def _conn() -> sqlite3.Connection:
    from app.services.contabilidad_core import _DB_PATH
    from app.services.extracto_bancario import ensure_extracto_tables

    ensure_extracto_tables()   # un libro recién creado todavía no tiene las tablas del banco
    con = sqlite3.connect(_DB_PATH, timeout=30)
    con.row_factory = sqlite3.Row
    return con


def _tipo(periodo: str) -> str:
    from app.services.contabilidad_core import fecha_corte

    return "libro_propio" if periodo >= fecha_corte()[:7] else "periodo_contador"


def _r(v: Any) -> float:
    return round(float(v or 0), 2)


# ── Banco ───────────────────────────────────────────────────────────────────


def _banco_mes(con: sqlite3.Connection, periodo: str) -> dict[str, Any]:
    """Saldos del extracto (leídos o derivados), saldo del libro en 1110 y vínculos."""
    import app.services.contabilidad_core as cc

    desde, hasta = _rango(periodo)
    extractos = [dict(r) for r in con.execute(
        """SELECT e.id, e.nombre, e.banco, e.cuenta, e.archivo_nombre,
                  MIN(m.fecha) AS desde, MAX(m.fecha) AS hasta, COUNT(m.id) AS lineas
             FROM extractos_bancarios e JOIN extracto_movimientos m ON m.extracto_id = e.id
            WHERE e.tercero_id IS NULL AND m.fecha BETWEEN ? AND ?
            GROUP BY e.id ORDER BY MIN(m.fecha)""", (desde, hasta),
    )]
    tot = con.execute(
        """SELECT COUNT(*) AS n,
                  SUM(EXISTS(SELECT 1 FROM extracto_vinculos v WHERE v.extracto_mov_id = m.id)) AS vinc,
                  SUM(CASE WHEN m.tipo='credito' THEN m.monto ELSE 0 END) AS abonos,
                  SUM(CASE WHEN m.tipo='debito' THEN m.monto ELSE 0 END) AS cargos,
                  MAX(m.fecha) AS ultima
             FROM extracto_movimientos m JOIN extractos_bancarios e ON e.id = m.extracto_id
            WHERE e.tercero_id IS NULL AND m.fecha BETWEEN ? AND ?""", (desde, hasta),
    ).fetchone()
    saldo_ext_ini, saldo_ext_fin, metodo = _saldos_extracto(con, periodo)

    with_1110 = cc._cuenta_id_por_codigo(con, "1110")
    libro = cc.mayor_cuenta(with_1110, desde, hasta) if with_1110 else {"saldo_inicial": 0, "saldo_final": 0}
    sin_banco = con.execute(
        """SELECT COUNT(DISTINCT m.id) FROM cc_movimientos m
             JOIN cc_movimiento_lineas l ON l.movimiento_id = m.id
             JOIN cc_plan_cuentas p ON p.id = l.cuenta_id AND p.codigo = '1110'
            WHERE m.estado = 'confirmado' AND m.fecha BETWEEN ? AND ?
              AND NOT EXISTS (SELECT 1 FROM extracto_vinculos v
                               WHERE v.movimiento_id = 'cc:' || m.id OR v.movimiento_id = substr(m.referencia, 6))""",
        (desde, hasta),
    ).fetchone()[0]
    diferencia = None
    if saldo_ext_fin is not None:
        diferencia = round(saldo_ext_fin - _r(libro["saldo_final"]), 2)
    return {
        "extractos": extractos,
        "lineas": int(tot["n"] or 0), "vinculadas": int(tot["vinc"] or 0),
        "sin_vincular": int(tot["n"] or 0) - int(tot["vinc"] or 0),
        "abonos": _r(tot["abonos"]), "cargos": _r(tot["cargos"]), "cobertura_hasta": tot["ultima"] or "",
        "saldo_extracto_inicial": saldo_ext_ini, "saldo_extracto_final": saldo_ext_fin, "saldo_metodo": metodo,
        "saldo_libro_inicial": _r(libro["saldo_inicial"]), "saldo_libro_final": _r(libro["saldo_final"]),
        "diferencia": diferencia, "libro_sin_banco": int(sin_banco or 0),
        "cuadra": diferencia is not None and abs(diferencia) <= 1 and int(tot["n"] or 0) > 0
                  and int(tot["vinc"] or 0) == int(tot["n"] or 0) and int(sin_banco or 0) == 0,
    }


def _saldos_extracto(con: sqlite3.Connection, periodo: str) -> tuple[float | None, float | None, str]:
    """(inicial, final, método). Los extractos «estado de cuenta» traen saldo corrido; los
    CSV diarios no. Cuando el mes no trae saldo se encadena desde el último mes que sí lo
    tiene: saldo + abonos − cargos, mes a mes (así agosto-2026 da 21.866.839,17, que es lo
    que dice el PDF del banco)."""
    desde, hasta = _rango(periodo)
    fila = con.execute(
        """SELECT m.saldo, m.tipo, m.monto FROM extracto_movimientos m JOIN extractos_bancarios e ON e.id=m.extracto_id
            WHERE e.tercero_id IS NULL AND m.fecha BETWEEN ? AND ? AND m.saldo IS NOT NULL
            ORDER BY m.fecha DESC, m.fila_origen DESC, m.id DESC LIMIT 1""", (desde, hasta),
    ).fetchone()
    primera = con.execute(
        """SELECT m.saldo, m.tipo, m.monto FROM extracto_movimientos m JOIN extractos_bancarios e ON e.id=m.extracto_id
            WHERE e.tercero_id IS NULL AND m.fecha BETWEEN ? AND ? AND m.saldo IS NOT NULL
            ORDER BY m.fecha, m.fila_origen, m.id LIMIT 1""", (desde, hasta),
    ).fetchone()
    if fila and primera:
        ini = _r(primera["saldo"]) - (_r(primera["monto"]) if primera["tipo"] == "credito" else -_r(primera["monto"]))
        return round(ini, 2), _r(fila["saldo"]), "extracto"
    # Derivar: buscar hacia atrás (hasta 12 meses) un mes con saldo final leído.
    p = _periodo_anterior(periodo)
    cadena = [periodo]
    for _ in range(12):
        d0, h0 = _rango(p)
        f0 = con.execute(
            """SELECT m.saldo FROM extracto_movimientos m JOIN extractos_bancarios e ON e.id=m.extracto_id
                WHERE e.tercero_id IS NULL AND m.fecha BETWEEN ? AND ? AND m.saldo IS NOT NULL
                ORDER BY m.fecha DESC, m.fila_origen DESC, m.id DESC LIMIT 1""", (d0, h0),
        ).fetchone()
        if f0:
            saldo = _r(f0["saldo"])
            ini = None
            for q in reversed(cadena):
                dq, hq = _rango(q)
                t = con.execute(
                    """SELECT SUM(CASE WHEN tipo='credito' THEN monto ELSE 0 END), SUM(CASE WHEN tipo='debito' THEN monto ELSE 0 END)
                         FROM extracto_movimientos m JOIN extractos_bancarios e ON e.id=m.extracto_id
                        WHERE e.tercero_id IS NULL AND m.fecha BETWEEN ? AND ?""", (dq, hq),
                ).fetchone()
                ini = saldo
                saldo = round(saldo + _r(t[0]) - _r(t[1]), 2)
            return ini, saldo, f"derivado desde {p}"
        cadena.append(p)
        p = _periodo_anterior(p)
    return None, None, "sin saldo en el extracto"


# ── Impuestos ───────────────────────────────────────────────────────────────


def _declarado(periodo: str, formulario: str, concepto: str) -> dict[str, Any] | None:
    """Lo que el contador presentó para ese mes y concepto, desde declaraciones_contador.json."""
    from app.services.declaraciones_impuestos import _declaraciones_contador

    anio, mes = int(periodo[:4]), int(periodo[5:7])
    decl = _declaraciones_contador()
    if formulario == "350":
        for d in decl:
            if d.get("tipo") == "350" and int(d.get("anio") or 0) == anio and int(d.get("periodo") or 0) == mes:
                compras = d.get("compras") or {}
                otros = d.get("otros_renglones_con_valor") or {}
                valor = (_r(compras.get("pj_retencion")) + _r(compras.get("pn_retencion")) if concepto == "retefuente"
                         else _r(otros.get("131")))
                return {"valor": valor, "numero": d.get("numero_formulario"), "fecha": d.get("fecha_presentacion"),
                        "ref": f"declaracion:{d.get('archivo')}" if d.get("archivo") else None,
                        "periodo": f"{anio}-{mes:02d}", "total_formulario": _r(d.get("total_mas_sanciones_138"))}
    elif formulario == "rtica":
        bim = (mes + 1) // 2
        for d in decl:
            if d.get("tipo") == "RTICA" and int(d.get("anio") or 0) == anio and int(d.get("periodo") or 0) == bim:
                valor = next((_r(d[k]) for k in ("total_retencion", "total", "valor_a_pagar", "retencion") if d.get(k) is not None), None)
                return {"valor": valor, "numero": d.get("numero_formulario"), "fecha": d.get("fecha_presentacion"),
                        "ref": f"declaracion:{d.get('archivo')}" if d.get("archivo") else None,
                        "periodo": f"{anio}-B{bim}", "total_formulario": valor}
    elif formulario == "300":
        cuat = (mes + 3) // 4
        for d in decl:
            if d.get("tipo") == "300" and int(d.get("anio") or 0) == anio and int(d.get("periodo") or 0) == cuat:
                return {"valor": _r(d.get("impuesto_generado_67")), "descontable": _r(d.get("impuesto_descontable_81")),
                        "numero": d.get("numero_formulario"), "fecha": d.get("fecha_presentacion"),
                        "ref": f"declaracion:{d.get('archivo')}" if d.get("archivo") else None,
                        "periodo": f"{anio}-C{cuat}", "total_formulario": _r(d.get("total_saldo_a_pagar_88"))}
    return None


def _impuestos_mes(con: sqlite3.Connection, periodo: str) -> list[dict[str, Any]]:
    import app.services.contabilidad_core as cc

    desde, hasta = _rango(periodo)
    certs = None
    out = []
    for codigo, (formulario, concepto) in CUENTAS_IMPUESTO.items():
        cid = cc._cuenta_id_por_codigo(con, codigo)
        if not cid:
            continue
        cuenta = dict(con.execute("SELECT codigo, nombre, naturaleza FROM cc_plan_cuentas WHERE id=?", (cid,)).fetchone())
        m = cc.mayor_cuenta(cid, desde, hasta)
        pasivo = cuenta["naturaleza"] == "credito"
        causado = _r(m["total_credito"] if pasivo else m["total_debito"])
        pagado = _r(m["total_debito"] if pasivo else m["total_credito"])
        fila: dict[str, Any] = {
            "cuenta": codigo, "nombre": cuenta["nombre"], "formulario": formulario, "concepto": concepto,
            "saldo_inicial": _r(m["saldo_inicial"]), "causado": causado, "pagado": pagado, "saldo_final": _r(m["saldo_final"]),
            "declarado": None, "veredicto": "sin_declaracion", "nota": "",
        }
        if formulario == "certificados":
            if certs is None:
                from app.services.certificados_retencion import listar

                try:
                    certs = {p["periodo"]: p for p in listar()["periodos"]}
                except Exception:  # noqa: BLE001
                    certs = {}
            p = certs.get(periodo)
            if p:
                fila["declarado"] = {"valor": _r(p.get(concepto)), "periodo": periodo,
                                     "ref": f"certificado:{p['certificados'][0]['archivo']}" if p.get("certificados") else None,
                                     "fuente": "certificado Mercado Pago"}
                fila["veredicto"] = "cuadra" if abs(_r(p.get(concepto)) - causado) <= 1 else "difiere"
                if causado == 0:
                    fila["nota"] = "Certificado sin causar en el libro."
        else:
            d = _declarado(periodo, formulario, concepto)
            if d:
                fila["declarado"] = {**d, "fuente": f"formulario {formulario} del contador"}
                if d.get("valor") is None:
                    fila["veredicto"] = "presentada"
                else:
                    fila["veredicto"] = "cuadra" if abs(_r(d["valor"]) - causado) <= 1000 else "difiere"
            elif _tipo(periodo) == "periodo_contador":
                fila["veredicto"] = "sin_declaracion"
            else:
                fila["veredicto"] = "pendiente"
        out.append(fila)
    return out


# ── Verificaciones por cuenta ───────────────────────────────────────────────


def _verificaciones_por_cuenta(con: sqlite3.Connection, periodo: str) -> dict[str, dict[str, Any]]:
    """Tres consultas agregadas sobre el mes; nunca asiento por asiento."""
    desde, hasta = _rango(periodo)
    base = """FROM cc_movimiento_lineas l
              JOIN cc_movimientos m ON m.id = l.movimiento_id AND m.estado = 'confirmado' AND m.fecha BETWEEN ? AND ?
              JOIN cc_plan_cuentas p ON p.id = l.cuenta_id"""
    por_cuenta: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "asientos": 0, "con_soporte": 0, "sin_soporte": 0, "banco": None, "alegra": None, "dian": None,
        "declaracion": None, "observaciones": {"abiertas": 0, "revisado": False}, "pendiente": False, "motivos": [],
    })
    # Soporte: adjunto al asiento, o factura/captura de su solicitud de pago.
    try:
        filas = con.execute(
            f"""SELECT p.codigo, COUNT(DISTINCT m.id) AS n,
                       COUNT(DISTINCT CASE WHEN COALESCE(m.soporte_path,'')<>''
                                             OR COALESCE(s.factura_archivo,'')<>'' OR COALESCE(s.comprobante_archivo,'')<>''
                                            THEN m.id END) AS con_sop
                {base}
                LEFT JOIN cc_solicitudes_pago s ON s.id = CAST(json_extract(m.plantilla_datos_json, '$.solicitud_id') AS INTEGER)
                GROUP BY p.codigo""", (desde, hasta),
        ).fetchall()
    except sqlite3.OperationalError:
        filas = con.execute(
            f"""SELECT p.codigo, COUNT(DISTINCT m.id) AS n,
                       COUNT(DISTINCT CASE WHEN COALESCE(m.soporte_path,'')<>'' THEN m.id END) AS con_sop
                {base} GROUP BY p.codigo""", (desde, hasta),
        ).fetchall()
    for f in filas:
        v = por_cuenta[f["codigo"]]
        v["asientos"], v["con_soporte"] = int(f["n"]), int(f["con_sop"])
        v["sin_soporte"] = v["asientos"] - v["con_soporte"]
    # Banco: solo cuentas 1110*.
    for f in con.execute(
        f"""SELECT p.codigo, COUNT(DISTINCT m.id) AS n,
                   COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM extracto_vinculos v
                        WHERE v.movimiento_id = 'cc:' || m.id OR v.movimiento_id = substr(m.referencia, 6)) THEN m.id END) AS vinc
            {base} WHERE p.codigo LIKE '1110%' GROUP BY p.codigo""", (desde, hasta),
    ).fetchall():
        v = por_cuenta[f["codigo"]]
        v["banco"] = {"vinculados": int(f["vinc"]), "sin_vincular": int(f["n"]) - int(f["vinc"])}
        if v["banco"]["sin_vincular"]:
            v["pendiente"] = True
            v["motivos"].append(f"{v['banco']['sin_vincular']} asientos sin línea del banco")
    # Alegra: espejados.
    try:
        for f in con.execute(
            f"""SELECT p.codigo, COUNT(DISTINCT e.movimiento_id) AS n {base}
                JOIN cc_alegra_espejo e ON e.movimiento_id = m.id GROUP BY p.codigo""", (desde, hasta),
        ).fetchall():
            por_cuenta[f["codigo"]]["alegra"] = {"espejados": int(f["n"])}
    except sqlite3.OperationalError:
        pass
    return por_cuenta


def _aplanar(nodos: list[dict], out: list[dict]) -> None:
    for n in nodos:
        if n.get("es_movimiento") or n.get("existe"):
            out.append({k: n.get(k) for k in ("codigo", "nombre", "nivel", "tipo", "naturaleza", "cuenta_id",
                                              "es_movimiento", "descripcion", "saldo_inicial", "debito", "credito",
                                              "lineas", "saldo_final")})
        _aplanar(n.get("hijos") or [], out)


def _fuentes(con: sqlite3.Connection, periodo: str, banco: dict, impuestos: list[dict]) -> list[dict[str, Any]]:
    from app.services.dian_cruce import periodos_con_listado
    from app.services.expediente_documentos import listado_dian

    fuentes: list[dict[str, Any]] = []
    for e in banco["extractos"]:
        fuentes.append({"ref": f"extracto:{e['id']}", "tipo": "extracto", "titulo": e["nombre"] or e["archivo_nombre"],
                        "detalle": f"{e['desde']} → {e['hasta']} · {e['lineas']} líneas", "cuentas": ["1110"],
                        "disponible_local": bool(e.get("archivo_nombre"))})
    if periodo in periodos_con_listado():
        p = listado_dian(periodo)
        fuentes.append({"ref": f"dian_listado:{periodo}", "tipo": "dian", "titulo": f"Listado DIAN {periodo}",
                        "detalle": p.name if p else "", "cuentas": ["4135", "1435", "2205", "2408"], "disponible_local": bool(p)})
    vistos = set()
    for f in impuestos:
        d = f.get("declarado") or {}
        if d.get("ref") and d["ref"] not in vistos:
            vistos.add(d["ref"])
            fuentes.append({"ref": d["ref"], "tipo": "declaracion" if d["ref"].startswith("declaracion") else "certificado",
                            "titulo": f"{d.get('fuente', '')} · {d.get('periodo', '')}".strip(" ·"),
                            "detalle": f"presentada {d.get('fecha')}" if d.get("fecha") else "", "cuentas": [f["cuenta"]],
                            "disponible_local": True})
    try:
        from app.services.pagos_impuestos import recibos

        for r in recibos().get("recibos", []):
            if str(r.get("fecha_pago") or "")[:7] == periodo and r.get("numero"):
                fuentes.append({"ref": f"recibo:{r['numero']}", "tipo": "recibo", "titulo": f"Recibo {r.get('recibo')} {r['numero']}",
                                "detalle": f"{r.get('etiqueta') or ''} · ${_r(r.get('valor')):,.0f}".replace(",", "."),
                                "cuentas": [str(r.get("cuenta") or "")], "disponible_local": bool(r.get("archivo"))})
    except Exception:  # noqa: BLE001
        pass
    try:
        desde, hasta = _rango(periodo)
        for r in con.execute("SELECT p.id, t.nombre, p.capital FROM cc_prestamos p JOIN cc_terceros t ON t.id=p.tercero_id "
                             "WHERE p.fecha_desembolso BETWEEN ? AND ?", (desde, hasta)):
            fuentes.append({"ref": f"prestamo_contrato:{r[0]}", "tipo": "contrato", "titulo": f"Contrato de préstamo · {r[1]}",
                            "detalle": f"${_r(r[2]):,.0f}".replace(",", "."), "cuentas": ["2195"], "disponible_local": True})
    except sqlite3.OperationalError:
        pass
    return fuentes


# ── API pública ─────────────────────────────────────────────────────────────


def periodos(hoy: date | None = None) -> list[dict[str, Any]]:
    """Todos los meses desde PRIMER_PERIODO hasta hoy, con qué hay de cada uno."""
    hoy = hoy or date.today()
    actual = hoy.strftime("%Y-%m")
    from app.services.dian_cruce import periodos_con_listado
    from app.services.declaraciones_impuestos import _declaraciones_contador

    con_dian = set(periodos_con_listado())
    decl = defaultdict(int)
    for d in _declaraciones_contador():
        if d.get("tipo") == "350" and d.get("anio") and d.get("periodo"):
            decl[f"{int(d['anio']):04d}-{int(d['periodo']):02d}"] += 1
    with _conn() as con:
        asientos = {r[0]: r[1] for r in con.execute(
            "SELECT substr(fecha,1,7), COUNT(*) FROM cc_movimientos WHERE estado='confirmado' GROUP BY 1")}
        extracto = {r[0] for r in con.execute(
            "SELECT DISTINCT substr(m.fecha,1,7) FROM extracto_movimientos m JOIN extractos_bancarios e ON e.id=m.extracto_id "
            "WHERE e.tercero_id IS NULL")}
        obs = defaultdict(int)
        try:
            for r in con.execute("SELECT periodo, COUNT(*) FROM cc_observaciones_contador "
                                 "WHERE estado IN ('pregunta','ajuste') AND resuelto_en IS NULL GROUP BY periodo"):
                obs[r[0]] = r[1]
        except sqlite3.OperationalError:
            pass
    out = []
    for p in _meses(PRIMER_PERIODO, actual):
        out.append({
            "periodo": p, "tipo": _tipo(p), "en_curso": p == actual,
            "asientos": int(asientos.get(p, 0)), "extracto": p in extracto, "dian": p in con_dian,
            "declaraciones": int(decl.get(p, 0)), "observaciones_abiertas": int(obs.get(p, 0)),
            "paquete": _estado_paquete(p),
        })
    return out


def _estado_paquete(periodo: str) -> str:
    try:
        from app.services.expediente_paquete import estado

        return estado(periodo).get("estado", "no")
    except Exception:  # noqa: BLE001 — llega con la fase 3
        return "no"


def _observaciones_resumen(periodo: str) -> dict[str, Any]:
    try:
        from app.services.observaciones_contador import resumen

        return resumen(periodo)
    except Exception:  # noqa: BLE001 — llega con la fase 2
        return {"total": 0, "abiertas": 0, "revisados": 0, "por_objeto": {}}


def expediente_mes(periodo: str, *, hoy: date | None = None) -> dict[str, Any]:
    periodo = _validar_periodo(periodo)
    import app.services.contabilidad_core as cc
    from app.services.contabilidad_mayor import arbol_cuentas
    from app.services.dian_cruce import cruce_mes, resumen_para_cuenta

    desde, hasta = _rango(periodo)
    tipo = _tipo(periodo)
    with _conn() as con:
        firma = _firma(con, periodo)
        c = _cache.get(periodo)
        if c and c["firma"] == firma and time.time() - c["t"] < _TTL:
            return c["datos"]
        conteo = con.execute(
            "SELECT SUM(estado='confirmado'), SUM(estado='anulado') FROM cc_movimientos WHERE fecha BETWEEN ? AND ?",
            (desde, hasta),
        ).fetchone()
        banco = _banco_mes(con, periodo)
        impuestos = _impuestos_mes(con, periodo)
        verif = _verificaciones_por_cuenta(con, periodo)
        mp_id = cc._cuenta_id_por_codigo(con, "130505")
        mp = cc.mayor_cuenta(mp_id, desde, hasta) if mp_id else None
        fuentes = _fuentes(con, periodo, banco, impuestos)
        obs = _observaciones_resumen(periodo)

    balance = cc.balance_comprobacion(desde=desde, hasta=hasta)
    try:
        cruce = cruce_mes(periodo)
        dian = {"listado": cruce["listado"], **{g: cruce[g]["totales"] for g in ("emitidos", "notas_credito", "documentos_soporte", "recibidos")}}
    except Exception as e:  # noqa: BLE001 — sin cruce la vista sigue, avisando
        cruce, dian = None, {"listado": False, "error": str(e)}

    cuentas: list[dict[str, Any]] = []
    if tipo == "libro_propio":
        _aplanar(arbol_cuentas(desde, hasta, solo_con_movimiento=True)["arbol"], cuentas)
        imp_por_cuenta = {f["cuenta"]: f for f in impuestos}
        for c_ in cuentas:
            v = dict(verif.get(c_["codigo"]) or verif.default_factory())
            if cruce and cruce["listado"]:
                v["dian"] = resumen_para_cuenta(periodo, c_["codigo"])
                if v["dian"] and (v["dian"]["solo_libro"] or v["dian"]["solo_dian"] or v["dian"]["difieren"]):
                    v["pendiente"] = True
                    v["motivos"].append("cruce con la DIAN con diferencias")
            imp = imp_por_cuenta.get(c_["codigo"])
            if imp:
                v["declaracion"] = {k: imp[k] for k in ("formulario", "declarado", "veredicto", "causado", "pagado", "nota")}
                if imp["veredicto"] in ("difiere", "pendiente"):
                    v["pendiente"] = True
                    v["motivos"].append("declaración " + ("difiere del libro" if imp["veredicto"] == "difiere" else "pendiente"))
            po = (obs.get("por_objeto") or {}).get(f"cuenta:{c_['codigo']}") or {}
            v["observaciones"] = {"abiertas": int(po.get("abiertas", 0)), "revisado": bool(po.get("revisado")),
                                  "revisado_por": po.get("revisado_por")}
            if v["observaciones"]["abiertas"]:
                v["pendiente"] = True
                v["motivos"].append("observación del contador abierta")
            if c_["codigo"] == "130505":
                v["fuente_externa"] = None
                v["motivos"].append("sin fuente externa (saldo de Mercado Pago pendiente)")
            v["fuentes"] = [f["ref"] for f in fuentes if any(c_["codigo"].startswith(x) or x.startswith(c_["codigo"]) for x in f["cuentas"] if x)]
            c_["verificacion"] = v
            c_["clave"] = any(c_["codigo"] == k or (k == "5" and c_["codigo"].startswith("5") and len(c_["codigo"]) <= 2) for k in CUENTAS_CLAVE)

    n_conf = int(conteo[0] or 0)
    con_sop = sum(v["con_soporte"] for k, v in verif.items() if len(k) >= 4)  # aprox por línea de cuenta
    pendientes = [c_ for c_ in cuentas if c_.get("verificacion", {}).get("pendiente")]
    estado = {
        "tipo": tipo, "cuadra": bool(balance["cuadra"]),
        "total_debito": _r(balance["total_debito"]), "total_credito": _r(balance["total_credito"]),
        "asientos": n_conf, "anulados": int(conteo[1] or 0),
        "banco": banco,
        "mercadopago": {"saldo_libro_inicial": _r(mp["saldo_inicial"]) if mp else None,
                        "saldo_libro_final": _r(mp["saldo_final"]) if mp else None,
                        "fuente": None, "nota": "Falta el reporte de saldo de Mercado Pago para verificarlo."},
        "dian": dian,
        "impuestos": impuestos,
        "observaciones": {k: obs.get(k, 0) for k in ("total", "abiertas", "revisados")},
        "paquete": _paquete_estado(periodo),
        "cuentas_con_movimiento": len(cuentas), "cuentas_por_revisar": len(pendientes),
    }
    if tipo == "periodo_contador":
        estado["libro"] = {"informativo": True, "asientos": n_conf,
                           "nota": "El libro propio arranca el 2026-09-01; estas cifras no pretenden cuadrar el mes."}
    veredicto = _veredicto(estado, tipo)
    datos = {
        "periodo": periodo, "desde": desde, "hasta": hasta, "tipo": tipo,
        "corte": cc.fecha_corte(), "generado_en": date.today().isoformat(),
        "veredicto": veredicto, "estado": estado, "cuentas": cuentas, "cuentas_clave": CUENTAS_CLAVE,
        "fuentes": fuentes,
    }
    _cache[periodo] = {"firma": firma, "t": time.time(), "datos": datos}
    return datos


def _paquete_estado(periodo: str) -> dict[str, Any]:
    try:
        from app.services.expediente_paquete import estado

        return estado(periodo)
    except Exception:  # noqa: BLE001
        return {"estado": "no"}


def _veredicto(estado: dict, tipo: str) -> dict[str, str]:
    if tipo == "periodo_contador":
        return {"nivel": "neutro", "titulo": "Período declarado por el contador",
                "frase": "Se muestran el extracto, los documentos de la DIAN y lo que se declaró. El libro propio arranca en septiembre de 2026."}
    b = estado["banco"]
    partes = []
    if not estado["cuadra"]:
        return {"nivel": "rojo", "titulo": "El libro no cuadra: eso va primero.", "frase": ""}
    partes.append("banco conciliado" if b["cuadra"] else f"banco: {b['sin_vincular']} líneas sin asiento y {b['libro_sin_banco']} asientos sin banco")
    d = estado["dian"]
    if d.get("listado"):
        e = d["emitidos"]
        partes.append(f"DIAN: {e['en_ambos']} ventas en ambos, {e['solo_dian']} solo en la DIAN, {e['solo_libro']} solo en el libro")
    difieren = [i["cuenta"] for i in estado["impuestos"] if i["veredicto"] == "difiere"]
    if difieren:
        partes.append("impuestos que difieren de lo declarado: " + ", ".join(difieren))
    nivel = "verde" if b["cuadra"] and not difieren and estado["cuentas_por_revisar"] == 0 else "amarillo"
    titulo = ("El mes cuadra y está verificado." if nivel == "verde"
              else f"El libro cuadra; hay {estado['cuentas_por_revisar']} cuentas por revisar.")
    frase = " · ".join(partes)
    return {"nivel": nivel, "titulo": titulo, "frase": (frase[:1].upper() + frase[1:] + ".") if frase else ""}


def _firma(con: sqlite3.Connection, periodo: str) -> str:
    desde, hasta = _rango(periodo)
    a = con.execute("SELECT COUNT(*), COALESCE(MAX(id),0), COALESCE(MAX(created_at),'') FROM cc_movimientos WHERE fecha BETWEEN ? AND ?",
                    (desde, hasta)).fetchone()
    b = con.execute("SELECT COUNT(*), COALESCE(MAX(v.id),0) FROM extracto_movimientos m LEFT JOIN extracto_vinculos v ON v.extracto_mov_id=m.id "
                    "WHERE m.fecha BETWEEN ? AND ?", (desde, hasta)).fetchone()
    try:
        c = con.execute("SELECT COUNT(*), COALESCE(MAX(id),0) FROM cc_observaciones_contador WHERE periodo=?", (periodo,)).fetchone()
    except sqlite3.OperationalError:
        c = (0, 0)
    return f"{tuple(a)}|{tuple(b)}|{tuple(c)}"


def auxiliar_cuenta(periodo: str, codigo: str, *, incluir_subcuentas: bool = False, tercero_id: int | None = None,
                    limite: int = 200, offset: int = 0, agrupar: str | None = None) -> dict[str, Any]:
    """El auxiliar de una cuenta en el mes, con la verificación de cada fila."""
    periodo = _validar_periodo(periodo)
    if not re.fullmatch(r"\d{1,8}", str(codigo or "")):
        raise ValueError("Cuenta inválida")
    from app.services.contabilidad_mayor import extracto_cuenta
    from app.services.dian_cruce import estados_por_movimiento
    from app.services.extracto_bancario import mapa_vinculos_por_movimiento

    desde, hasta = _rango(periodo)
    ext = extracto_cuenta(codigo=str(codigo), desde=desde, hasta=hasta, incluir_subcuentas=incluir_subcuentas,
                          tercero_id=tercero_id, limite=5000)
    filas = ext["movimientos"]
    ids = sorted({int(f["movimiento_id"]) for f in filas})
    vinculos = mapa_vinculos_por_movimiento([f"cc:{i}" for i in ids]) if ids and str(codigo).startswith("1110") else {}
    try:
        dian = estados_por_movimiento(periodo) if str(codigo)[:2] in ("41", "42", "14", "22", "51", "52", "53", "24") else {}
    except Exception:  # noqa: BLE001
        dian = {}
    soportes, espejos, obs_mov = _extras_por_movimiento(ids, periodo)
    for f in filas:
        mid = int(f["movimiento_id"])
        v = vinculos.get(f"cc:{mid}")
        f["verificaciones"] = {
            "banco": ({"estado": "vinculado", "linea_id": v["extracto_mov_id"], "extracto_id": v["extracto_id"],
                       "fecha_banco": v["fecha"], "monto_banco": v["monto"], "descripcion_banco": v["descripcion"]}
                      if v else ({"estado": "sin_banco"} if str(codigo).startswith("1110") else {"estado": "no_aplica"})),
            "dian": dian.get(mid) or {"estado": "no_aplica" if not dian else "sin_documento"},
            "soporte": soportes.get(mid) or {"estado": "no", "n": 0},
            "alegra": espejos.get(mid),
            "observacion": obs_mov.get(mid),
        }
    agrupado = None
    if agrupar == "dia":
        por_dia: dict[str, dict[str, Any]] = {}
        for f in filas:
            g = por_dia.setdefault(f["fecha"], {"fecha": f["fecha"], "n": 0, "debito": 0.0, "credito": 0.0, "saldo": f["saldo"],
                                                "con_soporte": 0, "sin_banco": 0, "dian_solo_libro": 0})
            g["n"] += 1
            g["debito"] = round(g["debito"] + f["debito"], 2)
            g["credito"] = round(g["credito"] + f["credito"], 2)
            g["saldo"] = f["saldo"]
            g["con_soporte"] += 1 if f["verificaciones"]["soporte"]["estado"] == "si" else 0
            g["sin_banco"] += 1 if f["verificaciones"]["banco"]["estado"] == "sin_banco" else 0
            g["dian_solo_libro"] += 1 if f["verificaciones"]["dian"].get("estado") == "solo_libro" else 0
        agrupado = list(por_dia.values())
    total = len(filas)
    pagina = filas[offset: offset + max(1, min(int(limite), 1000))]
    return {
        "periodo": periodo, "cuenta": ext["cuenta"], "saldo_inicial": ext["saldo_inicial"], "saldo_final": ext["saldo_final"],
        "total_debito": ext["total_debito"], "total_credito": ext["total_credito"], "truncado": ext["truncado"],
        "total": total, "offset": offset, "limite": limite, "filas": pagina, "por_dia": agrupado,
        "por_tercero": ext["por_tercero"], "incluir_subcuentas": incluir_subcuentas, "tercero_id": tercero_id,
    }


def _extras_por_movimiento(ids: list[int], periodo: str) -> tuple[dict, dict, dict]:
    if not ids:
        return {}, {}, {}
    soportes: dict[int, dict] = {}
    espejos: dict[int, dict] = {}
    obs: dict[int, dict] = {}
    with _conn() as con:
        for i in range(0, len(ids), 900):
            lote = ids[i:i + 900]
            q = ",".join("?" * len(lote))
            try:
                filas = con.execute(
                    f"""SELECT m.id, COALESCE(m.soporte_path,'') AS sp, COALESCE(s.factura_archivo,'') AS fa,
                               COALESCE(s.comprobante_archivo,'') AS ca
                          FROM cc_movimientos m
                          LEFT JOIN cc_solicitudes_pago s ON s.id = CAST(json_extract(m.plantilla_datos_json,'$.solicitud_id') AS INTEGER)
                         WHERE m.id IN ({q})""", lote).fetchall()
            except sqlite3.OperationalError:
                filas = con.execute(f"SELECT id, COALESCE(soporte_path,'') AS sp, '' AS fa, '' AS ca FROM cc_movimientos WHERE id IN ({q})", lote).fetchall()
            for f in filas:
                n = sum(1 for x in (f["sp"], f["fa"], f["ca"]) if x)
                soportes[int(f["id"])] = {"estado": "si" if n else "no", "n": n}
            try:
                for f in con.execute(f"SELECT movimiento_id, alegra_journal_id FROM cc_alegra_espejo WHERE movimiento_id IN ({q})", lote):
                    from app.services.alegra_espejo import url_journal

                    espejos[int(f[0])] = {"journal_id": f[1], "url": url_journal(f[1])}
            except sqlite3.OperationalError:
                pass
            try:
                for f in con.execute(
                    f"""SELECT objeto_id, SUM(estado IN ('pregunta','ajuste') AND resuelto_en IS NULL) AS abiertas,
                               MAX(estado='revisado') AS revisado
                          FROM cc_observaciones_contador WHERE objeto_tipo='asiento' AND objeto_id IN ({q})
                         GROUP BY objeto_id""", [str(x) for x in lote]):
                    obs[int(f[0])] = {"abiertas": int(f[1] or 0), "revisado": bool(f[2])}
            except sqlite3.OperationalError:
                pass
    return soportes, espejos, obs


def asiento(periodo: str, movimiento_id: int) -> dict[str, Any]:
    periodo = _validar_periodo(periodo)
    import app.services.contabilidad_core as cc
    from app.services.dian_cruce import estados_por_movimiento
    from app.services.expediente_documentos import documentos_de_asiento
    from app.services.extracto_bancario import mapa_vinculos_por_movimiento

    mov = cc.obtener_movimiento(int(movimiento_id))
    if not mov:
        raise ValueError("Asiento no encontrado")
    v = mapa_vinculos_por_movimiento([f"cc:{mov['id']}"]).get(f"cc:{mov['id']}")
    try:
        dian = estados_por_movimiento(mov["fecha"][:7]).get(int(mov["id"]))
    except Exception:  # noqa: BLE001
        dian = None
    soportes, espejos, obs = _extras_por_movimiento([int(mov["id"])], periodo)
    observaciones: list[dict] = []
    try:
        from app.services.observaciones_contador import listar

        observaciones = listar(objeto_tipo="asiento", objeto_id=str(mov["id"]))
    except Exception:  # noqa: BLE001
        pass
    return {
        "movimiento": {k: mov.get(k) for k in ("id", "fecha", "concepto", "tipo_origen", "referencia", "estado", "tercero",
                                               "total_debito", "total_credito", "soporte_nombre", "created_at")},
        "lineas": [{k: l.get(k) for k in ("cuenta_codigo", "cuenta_nombre", "debito", "credito", "descripcion", "tercero_nombre")}
                   for l in mov.get("lineas") or []],
        "cuadra": abs(_r(mov.get("total_debito")) - _r(mov.get("total_credito"))) < 0.01,
        "documentos": documentos_de_asiento(mov),
        "banco_linea": v,
        "dian": dian,
        "alegra": espejos.get(int(mov["id"])),
        "soporte": soportes.get(int(mov["id"])),
        "observaciones": observaciones,
    }


def conciliacion_mes(periodo: str) -> dict[str, Any]:
    """Cada línea del banco del mes con su asiento (si lo tiene) y los asientos de 1110 sin banco."""
    periodo = _validar_periodo(periodo)
    desde, hasta = _rango(periodo)
    with _conn() as con:
        banco = _banco_mes(con, periodo)
        lineas = [dict(r) for r in con.execute(
            """SELECT m.id, m.extracto_id, m.fecha, m.descripcion, m.referencia, m.monto, m.tipo, m.saldo,
                      v.movimiento_id AS vinculo, v.notas AS vinculo_notas
                 FROM extracto_movimientos m JOIN extractos_bancarios e ON e.id = m.extracto_id
                 LEFT JOIN extracto_vinculos v ON v.extracto_mov_id = m.id
                WHERE e.tercero_id IS NULL AND m.fecha BETWEEN ? AND ?
                ORDER BY m.fecha, m.fila_origen, m.id""", (desde, hasta),
        )]
        ids = [int(l["vinculo"][3:]) for l in lineas if l["vinculo"] and l["vinculo"].startswith("cc:") and l["vinculo"][3:].isdigit()]
        asientos: dict[int, dict] = {}
        for i in range(0, len(ids), 900):
            lote = ids[i:i + 900]
            q = ",".join("?" * len(lote))
            for r in con.execute(
                f"""SELECT m.id, m.concepto, m.tipo_origen, t.nombre AS tercero,
                           (SELECT GROUP_CONCAT(p.codigo, ',') FROM cc_movimiento_lineas l JOIN cc_plan_cuentas p ON p.id=l.cuenta_id
                             WHERE l.movimiento_id=m.id AND p.codigo NOT LIKE '1110%') AS contrapartida
                      FROM cc_movimientos m LEFT JOIN cc_terceros t ON t.id=m.tercero_id WHERE m.id IN ({q})""", lote):
                asientos[int(r["id"])] = dict(r)
        sin_banco = [dict(r) for r in con.execute(
            """SELECT m.id, m.fecha, m.concepto, m.tipo_origen, t.nombre AS tercero,
                      SUM(l.debito) - SUM(l.credito) AS neto
                 FROM cc_movimientos m JOIN cc_movimiento_lineas l ON l.movimiento_id = m.id
                 JOIN cc_plan_cuentas p ON p.id = l.cuenta_id AND p.codigo = '1110'
                 LEFT JOIN cc_terceros t ON t.id = m.tercero_id
                WHERE m.estado = 'confirmado' AND m.fecha BETWEEN ? AND ?
                  AND NOT EXISTS (SELECT 1 FROM extracto_vinculos v
                                   WHERE v.movimiento_id = 'cc:' || m.id OR v.movimiento_id = substr(m.referencia, 6))
                GROUP BY m.id ORDER BY m.fecha""", (desde, hasta),
        )]
    for l in lineas:
        v = l.pop("vinculo")
        l["estado"] = "vinculada" if v else "sin_asiento"
        l["asiento"] = None
        if v and v.startswith("cc:") and v[3:].isdigit():
            l["asiento"] = asientos.get(int(v[3:]))
            l["movimiento_id"] = int(v[3:])
        elif v and v.startswith("nota:"):
            l["estado"] = "con_nota"
    return {"periodo": periodo, "comprobacion": banco, "lineas": lineas, "libro_sin_banco": sin_banco}
