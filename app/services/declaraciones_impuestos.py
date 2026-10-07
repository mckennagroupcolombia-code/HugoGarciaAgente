"""Borradores de las declaraciones de retención que se preparan con el contador.

**Por qué existe (oct-2026).** Cada mes el contador (William Novoa) arma el
formulario 350 de la DIAN y, cada dos meses, el RTICA de la Secretaría de
Hacienda de Bogotá, y McKenna solo se enteraba de las cifras cuando llegaba el
recibo de pago. Desde la fecha de corte (2026-09-01) el Libro Mayor propio es la
fuente de verdad, así que el borrador sale de ahí y se revisa con él ANTES de
que lo presente. Es lo que se lleva a la reunión, no lo que se presenta.

Formularios:

* **350 — Retención en la fuente (DIAN, mensual).** Lleva la retención a título
  de renta (renglones 29-130) y la de IVA (131-134). La reteIVA no es una
  declaración aparte: va en este mismo formulario.
* **RTICA — Retención de ICA Bogotá (SDH, bimestral).** Base, retenciones
  practicadas y saldo a cargo.

De dónde sale cada cifra:

* Renta: créditos a la 2365 y sus subcuentas (236515 honorarios … 236540
  compras). El concepto sale de la subcuenta y, en la 2365 plana, de la
  descripción del asiento; la persona (jurídica/natural) sale del tercero.
* ReteIVA: créditos a la 2367. ReteICA: créditos a la 2368.
* La **base** se toma, en este orden, de la descripción del asiento («sobre base
  2.296.000»), de los débitos de costo/gasto/inventario del mismo asiento, o se
  estima dividiendo la retención por la tarifa — y la fila dice cuál de las tres
  fue, porque una base estimada se revisa con el contador.
* Los pagos a la DIAN / SDH (débito a la cuenta + crédito a Bancos, o
  `tipo_origen='pago_impuestos'`) NO restan: extinguen la deuda, no la
  retención. Un débito sin banco (ajuste, «practicada de más») sí resta en su
  mes.

Los valores del formulario se redondean al múltiplo de mil más cercano
(Art. 577 E.T.), igual que en los 350 que ha presentado el contador. El detalle
por tercero queda al peso.

⚠️ No se inventan vencimientos (misma regla dura que `calendario_tributario`):
el 350 usa el calendario cargado; el del RTICA no está cargado y se muestra lo
que el contador ha hecho antes como referencia, sin fecha límite.
"""

from __future__ import annotations

import calendar as _cal
import json
import re
from datetime import date, datetime
from typing import Any

MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
         "septiembre", "octubre", "noviembre", "diciembre"]

# Primer período que se prepara desde el libro. Lo anterior lo liquidó el contador
# con sus propias cifras (CONTABILIDAD_FECHA_CORTE = 2026-09-01); agosto se lista
# solo para comparar porque ya está presentado.
PRIMER_PERIODO = (2026, 8)

ESTADOS = ("borrador", "revisado", "enviado_contador", "presentado")

# concepto -> (renglón base PJ, retención PJ, base PN, retención PN, etiqueta)
RENGLONES_350: dict[str, tuple[int, int, int, int, str]] = {
    "honorarios": (29, 42, 79, 95, "Honorarios"),
    "comisiones": (30, 43, 80, 96, "Comisiones"),
    "servicios": (31, 44, 81, 97, "Servicios"),
    "rendimientos_financieros": (32, 45, 82, 98, "Rendimientos financieros e intereses"),
    "arrendamientos": (33, 46, 83, 99, "Arrendamientos (muebles e inmuebles)"),
    "compras": (36, 49, 86, 102, "Compras"),
    "otros": (41, 54, 92, 108, "Otros pagos sujetos a retención"),
}

# Subcuenta PUC -> concepto del 350.
_SUBCUENTA_CONCEPTO = {
    "236515": "honorarios",
    "236520": "comisiones",
    "236525": "servicios",
    "236530": "arrendamientos",
    "236535": "rendimientos_financieros",
    "236540": "compras",
    "236595": "otros",
}

# Tarifa de referencia (declarante) para estimar la base cuando el asiento no la
# trae, y para avisar cuando la tarifa efectiva no cuadra. Transporte de carga
# va en «servicios» pero al 1%.
_TARIFA_REF = {
    "honorarios": 10.0,
    "comisiones": 10.0,
    "servicios": 4.0,
    "transporte": 1.0,
    "rendimientos_financieros": 7.0,
    "arrendamientos": 3.5,
    "compras": 2.5,
    "otros": 2.5,
}



def _tarifa_ref(concepto: str, no_declarante: bool) -> float:
    """Tarifa de `retenciones.CONCEPTOS` según el tercero (declarante o no)."""
    try:
        from app.services.retenciones import CONCEPTOS

        clave = {"transporte": "transporte_carga", "arrendamientos": "arrendamiento_inmueble",
                 "otros": "otros_ingresos"}.get(concepto, concepto)
        if clave in CONCEPTOS:
            dec, no_dec = CONCEPTOS[clave][:2]
            return no_dec if no_declarante else dec
    except Exception:
        pass
    return _TARIFA_REF[concepto]


# Cuentas cuyo débito en el mismo asiento es la base de la retención.
_PREFIJOS_BASE = ("14", "15", "5", "6", "7")
_EXCLUIR_BASE = ("240810", "1330", "1355", "1105", "1110")


# ─── utilidades ────────────────────────────────────────────────────────────

def _p(v: float) -> str:
    """Pesos con punto de miles: 1234567 → '1.234.567'."""
    return f"{round(float(v or 0)):,}".replace(",", ".")


def _r(v: float) -> float:
    return round(float(v or 0), 2)


def _miles(v: float) -> int:
    """Múltiplo de mil más cercano (Art. 577 E.T.). La mitad sube."""
    v = float(v or 0)
    signo = -1 if v < 0 else 1
    return signo * int((abs(v) + 500) // 1000 * 1000)


def _num(txt: str) -> float | None:
    """'2.296.000' · '1,302,083.33' · '806.554,62' · '$1.120.000' → float."""
    s = re.sub(r"[^\d.,]", "", txt or "")
    if not s:
        return None
    if "." in s and "," in s:
        dec = "." if s.rfind(".") > s.rfind(",") else ","
        mil = "," if dec == "." else "."
        s = s.replace(mil, "").replace(dec, ".")
    elif "," in s or "." in s:
        sep = "," if "," in s else "."
        partes = s.split(sep)
        if len(partes) > 2 or all(len(p) == 3 for p in partes[1:]):
            s = s.replace(sep, "")
        else:
            s = s.replace(sep, ".")
    try:
        return float(s)
    except ValueError:
        return None


_RE_BASE = re.compile(r"(?:base|sobre)\s+(?:de\s+)?\$?\s*([\d][\d.,]*\d)", re.I)


def _base_en_texto(texto: str) -> float | None:
    m = _RE_BASE.search(texto or "")
    if not m:
        return None
    v = _num(m.group(1))
    return v if v and v > 0 else None


def _rango_mes(anio: int, mes: int) -> tuple[str, str]:
    return (f"{anio:04d}-{mes:02d}-01",
            f"{anio:04d}-{mes:02d}-{_cal.monthrange(anio, mes)[1]:02d}")


def _rango_bimestre(anio: int, bim: int) -> tuple[str, str]:
    return _rango_mes(anio, 2 * bim - 1)[0], _rango_mes(anio, 2 * bim)[1]


def _nombre_periodo(formulario: str, periodo: str) -> str:
    anio, p = _parse_periodo(formulario, periodo)
    if formulario == "350":
        return f"{MESES[p - 1]} {anio}"
    return f"bimestre {p} ({MESES[2 * p - 2][:3]}–{MESES[2 * p - 1][:3]}) {anio}"


def _parse_periodo(formulario: str, periodo: str) -> tuple[int, int]:
    """'2026-09' (350) · '2026-B5' (RTICA) → (2026, 9) / (2026, 5)."""
    periodo = (periodo or "").strip().upper()
    if formulario == "350":
        m = re.fullmatch(r"(\d{4})-(\d{2})", periodo)
        if not m or not 1 <= int(m.group(2)) <= 12:
            raise ValueError("Período del 350 inválido: use AAAA-MM")
    elif formulario == "rtica":
        m = re.fullmatch(r"(\d{4})-B([1-6])", periodo)
        if not m:
            raise ValueError("Período del RTICA inválido: use AAAA-B1 … AAAA-B6")
    else:
        raise ValueError(f"Formulario desconocido: {formulario}")
    return int(m.group(1)), int(m.group(2))


# ─── lectura del libro ─────────────────────────────────────────────────────

def _lineas_cuenta(con, condicion: str, params: tuple, desde: str, hasta: str) -> list[dict]:
    """Líneas de las cuentas de retención en el rango, sin los pagos al fisco."""
    return [
        dict(r)
        for r in con.execute(
            f"""
            SELECT l.id AS linea_id, m.id AS movimiento_id, m.fecha, m.concepto AS asiento,
                   m.tipo_origen, c.codigo, l.debito, l.credito, l.descripcion,
                   t.id AS tercero_id, t.nombre AS tercero, t.identificacion,
                   t.tipo_persona, t.declarante, t.ica_por_mil
              FROM cc_movimiento_lineas l
              JOIN cc_movimientos m ON m.id = l.movimiento_id AND m.estado <> 'anulado'
              JOIN cc_plan_cuentas c ON c.id = l.cuenta_id
              LEFT JOIN cc_terceros t ON t.id = l.tercero_id
             WHERE ({condicion})
               AND m.fecha BETWEEN ? AND ?
               AND COALESCE(m.tipo_origen, '') <> 'pago_impuestos'
               AND NOT (
                   l.debito > 0
                   AND EXISTS (
                       SELECT 1 FROM cc_movimiento_lineas l2
                         JOIN cc_plan_cuentas c2 ON c2.id = l2.cuenta_id
                        WHERE l2.movimiento_id = m.id
                          AND c2.codigo LIKE '11%' AND l2.credito > 0
                   )
               )
             ORDER BY m.fecha, m.id, l.id
            """,
            (*params, desde, hasta),
        )
    ]


def _base_del_asiento(con, movimiento_id: int, tercero_id: int | None) -> float:
    """Débitos de costo/gasto/inventario del asiento: del mismo tercero o sin tercero."""
    total = 0.0
    for r in con.execute(
        """
        SELECT c.codigo, l.debito, l.tercero_id
          FROM cc_movimiento_lineas l
          JOIN cc_plan_cuentas c ON c.id = l.cuenta_id
         WHERE l.movimiento_id = ? AND l.debito > 0
        """,
        (movimiento_id,),
    ):
        cod = r["codigo"] or ""
        if not cod.startswith(_PREFIJOS_BASE) or cod.startswith(_EXCLUIR_BASE):
            continue
        if tercero_id and r["tercero_id"] and r["tercero_id"] != tercero_id:
            continue
        total += float(r["debito"] or 0)
    return total


def _concepto_renta(linea: dict) -> tuple[str, bool]:
    """(concepto del 350, es_transporte)."""
    d = f"{linea.get('descripcion') or ''} {linea.get('asiento') or ''}".lower()
    transporte = "transporte" in d or "flete" in d or "mensajer" in d
    sub = _SUBCUENTA_CONCEPTO.get(linea.get("codigo") or "")
    if sub:
        return sub, transporte and sub == "servicios"
    if "rendimiento" in d or "financier" in d or "interes" in d:
        return "rendimientos_financieros", False
    if "honorario" in d:
        return "honorarios", False
    if "comisi" in d:
        return "comisiones", False
    if "arrend" in d:
        return "arrendamientos", False
    if "compra" in d:
        return "compras", False
    if "servicio" in d or transporte:
        return "servicios", transporte
    return "otros", False


def _base_linea(con, linea: dict, valor: float, tarifa_pct: float) -> tuple[float, str]:
    """(base con signo, origen). Un débito (reverso) resta su base estimada."""
    if valor < 0:
        return (valor / (tarifa_pct / 100) if tarifa_pct else 0.0), "estimada"
    b = _base_en_texto(linea.get("descripcion") or "") or _base_en_texto(linea.get("asiento") or "")
    if b:
        return b, "descripción"
    b = _base_del_asiento(con, linea["movimiento_id"], linea.get("tercero_id"))
    if b > 0:
        return b, "asiento"
    return (valor / (tarifa_pct / 100) if tarifa_pct else 0.0), "estimada"


def _persona(linea: dict) -> str:
    tp = (linea.get("tipo_persona") or "").lower()
    if tp in ("juridica", "natural"):
        return tp
    # Las compras al exterior hechas por un socio quedaron sin tercero en el
    # libro; los socios son personas naturales.
    if "socio" in (linea.get("descripcion") or "").lower():
        return "natural"
    return "juridica"


# ─── declaraciones ya presentadas ──────────────────────────────────────────

def _declaraciones_contador() -> list[dict]:
    try:
        from app.services.pagos_impuestos import _declaraciones

        return _declaraciones()
    except Exception:
        return []


def _presentada_contador(formulario: str, anio: int, p: int) -> dict | None:
    tipo = "350" if formulario == "350" else "RTICA"
    for d in _declaraciones_contador():
        if d.get("tipo") == tipo and int(d.get("anio") or 0) == anio and int(d.get("periodo") or 0) == p:
            return d
    return None


def _pago_en_libro(con, formulario: str, anio: int, p: int) -> dict | None:
    """Un pago ya registrado en el libro para ese período (recibo 490 / PSE SDH)."""
    if formulario == "350":
        patron = f"%{MESES[p - 1]} de {anio}%"
        extra = "AND (m.concepto LIKE '%350%' OR m.concepto LIKE '%DIAN%')"
    else:
        patron = f"%bimestre {p} de {anio}%"
        extra = "AND (m.concepto LIKE '%RTICA%' OR m.concepto LIKE '%ICA%')"
    r = con.execute(
        f"""
        SELECT m.id, m.fecha, m.concepto, SUM(l.debito) AS valor
          FROM cc_movimientos m JOIN cc_movimiento_lineas l ON l.movimiento_id = m.id
         WHERE m.estado <> 'anulado' AND m.tipo_origen = 'pago_impuestos'
           AND m.concepto LIKE ? {extra}
           AND l.debito > 0
         GROUP BY m.id ORDER BY m.fecha LIMIT 1
        """,
        (patron,),
    ).fetchone()
    return dict(r) if r else None


# ─── estado y ajustes del borrador ─────────────────────────────────────────

def _ensure_tabla(con) -> None:
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS cc_declaraciones_borrador (
            formulario TEXT NOT NULL,
            periodo TEXT NOT NULL,
            estado TEXT NOT NULL DEFAULT 'borrador',
            ajustes_json TEXT NOT NULL DEFAULT '{}',
            notas TEXT NOT NULL DEFAULT '',
            numero_formulario TEXT NOT NULL DEFAULT '',
            actualizado_por TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (formulario, periodo)
        )
        """
    )


def _estado_guardado(con, formulario: str, periodo: str) -> dict:
    _ensure_tabla(con)
    r = con.execute(
        "SELECT * FROM cc_declaraciones_borrador WHERE formulario = ? AND periodo = ?",
        (formulario, periodo),
    ).fetchone()
    if not r:
        return {"estado": "borrador", "ajustes": {}, "notas": "", "numero_formulario": "",
                "actualizado_por": "", "updated_at": None}
    d = dict(r)
    try:
        d["ajustes"] = json.loads(d.pop("ajustes_json") or "{}")
    except Exception:
        d["ajustes"] = {}
    return d


def guardar_estado(formulario: str, periodo: str, *, estado: str | None = None,
                   ajustes: dict | None = None, notas: str | None = None,
                   numero_formulario: str | None = None, usuario: str = "") -> dict:
    """Guarda el avance del borrador. `ajustes` = {renglón: {valor, nota}}; un
    valor None borra el ajuste de ese renglón."""
    import app.services.contabilidad_core as cc

    _parse_periodo(formulario, periodo)
    if estado is not None and estado not in ESTADOS:
        raise ValueError(f"Estado inválido. Use: {', '.join(ESTADOS)}")
    cc._ensure()
    with cc._conn() as con:
        actual = _estado_guardado(con, formulario, periodo)
        aj = dict(actual.get("ajustes") or {})
        for k, v in (ajustes or {}).items():
            k = str(k)
            if v is None or (isinstance(v, dict) and v.get("valor") is None):
                aj.pop(k, None)
                continue
            valor = float(v["valor"] if isinstance(v, dict) else v)
            nota = (v.get("nota") or "").strip() if isinstance(v, dict) else ""
            if not nota:
                raise ValueError(f"El ajuste del renglón {k} necesita una nota (quién lo pidió y por qué).")
            aj[k] = {"valor": valor, "nota": nota, "por": usuario,
                     "fecha": datetime.now().isoformat(timespec="seconds")}
        con.execute(
            """
            INSERT INTO cc_declaraciones_borrador
                (formulario, periodo, estado, ajustes_json, notas, numero_formulario,
                 actualizado_por, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(formulario, periodo) DO UPDATE SET
                estado = excluded.estado, ajustes_json = excluded.ajustes_json,
                notas = excluded.notas, numero_formulario = excluded.numero_formulario,
                actualizado_por = excluded.actualizado_por, updated_at = excluded.updated_at
            """,
            (
                formulario, periodo,
                estado if estado is not None else actual["estado"],
                json.dumps(aj, ensure_ascii=False),
                notas if notas is not None else actual.get("notas", ""),
                (numero_formulario if numero_formulario is not None else actual.get("numero_formulario", "")).strip(),
                usuario,
            ),
        )
    return borrador(formulario, periodo)


# ─── borrador del 350 ──────────────────────────────────────────────────────

def _borrador_350(con, anio: int, mes: int) -> dict:
    desde, hasta = _rango_mes(anio, mes)
    renta = _lineas_cuenta(con, "c.codigo = '2365' OR c.codigo LIKE '2365__'", (), desde, hasta)
    reteiva = _lineas_cuenta(con, "c.codigo = '2367' OR c.codigo LIKE '2367__'", (), desde, hasta)

    grupos: dict[tuple, dict] = {}
    alertas: list[dict] = []
    # Los créditos primero: un reverso («anula la retención practicada de más»)
    # no dice el concepto en su texto y tiene que caer en el del tercero.
    renta.sort(key=lambda l: float(l["credito"] or 0) <= 0)
    for ln in renta:
        valor = _r(float(ln["credito"] or 0) - float(ln["debito"] or 0))
        if not valor:
            continue
        concepto, transporte = _concepto_renta(ln)
        if valor < 0 and concepto == "otros" and ln.get("tercero_id"):
            previos = [g for g in grupos.values() if g["tercero_id"] == ln["tercero_id"] and g["retencion"] > 0]
            if previos:
                concepto = max(previos, key=lambda g: g["retencion"])["concepto"]
        no_declarante = ln.get("declarante") is not None and not ln.get("declarante")
        tarifa = _tarifa_ref("transporte" if transporte else concepto, no_declarante)
        base, origen = _base_linea(con, ln, valor, tarifa)
        persona = _persona(ln)
        clave = (ln.get("tercero_id"), concepto, persona)
        g = grupos.setdefault(clave, {
            "tercero_id": ln.get("tercero_id"),
            "tercero": ln.get("tercero") or "(sin tercero)",
            "identificacion": ln.get("identificacion") or "",
            "persona": persona,
            "concepto": concepto,
            "base": 0.0, "retencion": 0.0, "lineas": [],
        })
        g["base"] = _r(g["base"] + base)
        g["retencion"] = _r(g["retencion"] + valor)
        g["lineas"].append({
            "movimiento_id": ln["movimiento_id"], "fecha": ln["fecha"], "asiento": ln["asiento"],
            "cuenta": ln["codigo"], "descripcion": ln["descripcion"] or "",
            "base": _r(base), "base_origen": origen, "retencion": valor,
            "tarifa_efectiva": round(valor / base * 100, 2) if base else None,
            "tarifa_referencia": tarifa,
        })
        if not ln.get("tercero_id"):
            alertas.append({"nivel": "media", "movimiento_id": ln["movimiento_id"],
                            "texto": f"Asiento #{ln['movimiento_id']} ({ln['fecha']}): retención sin tercero; "
                                     f"se tomó como persona {persona}. Asignar el tercero en el libro."})
        if valor > 0 and base and origen != "estimada":
            efectiva = valor / base * 100
            if abs(efectiva - tarifa) > 0.3:
                alertas.append({
                    "nivel": "alta", "movimiento_id": ln["movimiento_id"],
                    "texto": (f"Asiento #{ln['movimiento_id']} ({ln['fecha']}, {ln.get('tercero') or 'sin tercero'}): "
                              f"retención ${_p(valor)} sobre base ${_p(base)} = {efectiva:.2f}% "
                              f"y la tarifa de {concepto.replace('_', ' ')} es {tarifa:g}%. "
                              "Revisar la base o la tarifa antes de llevarlo al 350."),
                })

    # Grupos que se anulan dentro del mes (retención practicada y reversada) no
    # van al formulario; se listan para que se vea por qué no están.
    anulados = [g for g in grupos.values() if abs(g["retencion"]) < 1]
    items = sorted((g for g in grupos.values() if abs(g["retencion"]) >= 1), key=lambda g: -g["retencion"])

    renglones: dict[str, float] = {}
    filas: list[dict] = []
    for concepto, (rbpj, rrpj, rbpn, rrpn, etiqueta) in RENGLONES_350.items():
        pj = [g for g in items if g["concepto"] == concepto and g["persona"] == "juridica"]
        pn = [g for g in items if g["concepto"] == concepto and g["persona"] == "natural"]
        vals = {
            rbpj: sum(g["base"] for g in pj), rrpj: sum(g["retencion"] for g in pj),
            rbpn: sum(g["base"] for g in pn), rrpn: sum(g["retencion"] for g in pn),
        }
        for r, v in vals.items():
            renglones[str(r)] = _miles(v)
        filas.append({
            "concepto": concepto, "etiqueta": etiqueta,
            "pj": {"renglon_base": rbpj, "renglon_ret": rrpj, "base": _r(vals[rbpj]), "retencion": _r(vals[rrpj])},
            "pn": {"renglon_base": rbpn, "renglon_ret": rrpn, "base": _r(vals[rbpn]), "retencion": _r(vals[rrpn])},
        })

    iva_total = _r(sum(float(l["credito"] or 0) - float(l["debito"] or 0) for l in reteiva))
    renglones["129"] = 0
    renglones["131"] = _miles(iva_total)
    renglones["132"] = 0
    renglones["133"] = 0
    renglones["137"] = 0

    detalle_iva = [{
        "movimiento_id": l["movimiento_id"], "fecha": l["fecha"], "asiento": l["asiento"],
        "tercero": l.get("tercero") or "(sin tercero)", "descripcion": l["descripcion"] or "",
        "valor": _r(float(l["credito"] or 0) - float(l["debito"] or 0)),
    } for l in reteiva]

    return {
        "desde": desde, "hasta": hasta,
        "filas": filas, "terceros": items, "anulados_en_el_mes": anulados,
        "detalle_reteiva": detalle_iva,
        "renglones_calculados": renglones,
        "alertas": alertas,
    }


def _totales_350(r: dict[str, float]) -> dict[str, float]:
    ret_renta = sum(r.get(str(rr), 0) for (_, rrpj, _, rrpn, _) in RENGLONES_350.values() for rr in (rrpj, rrpn))
    r["130"] = ret_renta - r.get("129", 0)
    r["134"] = r.get("131", 0) + r.get("132", 0) - r.get("133", 0)
    r["136"] = r["130"] + r["134"]
    r["138"] = r["136"] + r.get("137", 0)
    return r


# ─── borrador del RTICA ────────────────────────────────────────────────────

def _borrador_rtica(con, anio: int, bim: int) -> dict:
    desde, hasta = _rango_bimestre(anio, bim)
    lineas = _lineas_cuenta(con, "c.codigo = '2368' OR c.codigo LIKE '2368__'", (), desde, hasta)
    grupos: dict[tuple, dict] = {}
    alertas: list[dict] = []
    for ln in lineas:
        valor = _r(float(ln["credito"] or 0) - float(ln["debito"] or 0))
        if not valor:
            continue
        txt = f"{ln.get('descripcion') or ''} {ln.get('asiento') or ''}"
        m = re.search(r"(\d+[.,]\d+|\d+)\s*(?:‰|por\s*mil)", txt, re.I)
        tarifa = _num(m.group(1).replace(".", ",")) if m else None
        if not tarifa:
            tarifa = float(ln.get("ica_por_mil") or 0) or None
        base, origen = (0.0, "estimada")
        if valor < 0:
            base = valor / (tarifa / 1000) if tarifa else 0.0
        else:
            b = _base_en_texto(ln.get("descripcion") or "") or _base_en_texto(ln.get("asiento") or "")
            if b:
                base, origen = b, "descripción"
            else:
                b = _base_del_asiento(con, ln["movimiento_id"], ln.get("tercero_id"))
                if b > 0:
                    base, origen = b, "asiento"
                elif tarifa:
                    base = valor / (tarifa / 1000)
        if not tarifa and base:
            tarifa = round(valor / base * 1000, 2)
        clave = (ln.get("tercero_id"), tarifa)
        g = grupos.setdefault(clave, {
            "tercero_id": ln.get("tercero_id"), "tercero": ln.get("tercero") or "(sin tercero)",
            "identificacion": ln.get("identificacion") or "", "persona": _persona(ln),
            "tarifa_por_mil": tarifa, "base": 0.0, "retencion": 0.0, "lineas": [],
        })
        g["base"] = _r(g["base"] + base)
        g["retencion"] = _r(g["retencion"] + valor)
        asumida = "asumid" in txt.lower()
        g["lineas"].append({
            "movimiento_id": ln["movimiento_id"], "fecha": ln["fecha"], "asiento": ln["asiento"],
            "descripcion": ln["descripcion"] or "", "base": _r(base), "base_origen": origen,
            "retencion": valor, "asumida_por_mckenna": asumida,
        })
        if base and tarifa and valor > 0 and abs(valor / base * 1000 - tarifa) > 0.3:
            alertas.append({"nivel": "alta", "movimiento_id": ln["movimiento_id"],
                            "texto": (f"Asiento #{ln['movimiento_id']} ({ln['fecha']}): ReteICA ${_p(valor)} sobre "
                                      f"${_p(base)} = {valor / base * 1000:.2f}‰ y la tarifa anotada es {tarifa:g}‰.")})
        if not ln.get("tercero_id"):
            alertas.append({"nivel": "media", "movimiento_id": ln["movimiento_id"],
                            "texto": f"Asiento #{ln['movimiento_id']}: ReteICA sin tercero. Asignarlo en el libro."})
    items = sorted((g for g in grupos.values() if abs(g["retencion"]) >= 1), key=lambda g: -g["retencion"])
    base_total = sum(g["base"] for g in items)
    ret_total = sum(g["retencion"] for g in items)
    meses_con_datos = sorted({l["fecha"][:7] for g in items for l in g["lineas"]})
    return {
        "desde": desde, "hasta": hasta, "terceros": items, "alertas": alertas,
        "meses_con_datos": meses_con_datos,
        "renglones_calculados": {"BR": _miles(base_total), "RP": _miles(ret_total), "RD": 0, "SA": 0},
        "base_peso": _r(base_total), "retencion_peso": _r(ret_total),
    }


def _totales_rtica(r: dict[str, float]) -> dict[str, float]:
    r["BH"] = r.get("RP", 0) - r.get("RD", 0)
    r["HA"] = r["BH"] + r.get("SA", 0)
    return r


RENGLONES_RTICA = [
    ("BR", "Base de retención (pagos sujetos a ReteICA)"),
    ("RP", "Retenciones practicadas en el bimestre"),
    ("RD", "Menos retenciones en exceso o devueltas"),
    ("BH", "Total retenciones a declarar"),
    ("SA", "Sanciones"),
    ("HA", "Saldo a cargo"),
]
_EDITABLES = {"350": {"129", "131", "132", "133", "137"}, "rtica": {"RD", "SA"}}


# ─── API pública ───────────────────────────────────────────────────────────

def borrador(formulario: str, periodo: str) -> dict:
    """Borrador completo de un formulario y período, con ajustes y estado."""
    import app.services.contabilidad_core as cc

    anio, p = _parse_periodo(formulario, periodo)
    cc._ensure()
    with cc._conn() as con:
        guardado = _estado_guardado(con, formulario, periodo)
        datos = _borrador_350(con, anio, p) if formulario == "350" else _borrador_rtica(con, anio, p)
        pago = _pago_en_libro(con, formulario, anio, p)

    calc = dict(datos["renglones_calculados"])
    finales = dict(calc)
    ajustados: list[str] = []
    for k, aj in (guardado.get("ajustes") or {}).items():
        finales[k] = _miles(aj["valor"])
        ajustados.append(k)
    finales = _totales_350(finales) if formulario == "350" else _totales_rtica(finales)
    calc = _totales_350(dict(calc)) if formulario == "350" else _totales_rtica(dict(calc))

    presentado = _presentada_contador(formulario, anio, p)
    # El último declarado por el contador, para comparar renglón por renglón.
    pa, pp = (anio, p - 1) if p > 1 else (anio - 1, 12 if formulario == "350" else 6)
    anterior = _presentada_contador(formulario, pa, pp)

    alertas = list(datos["alertas"])
    if formulario == "350" and anterior:
        iva_ant = int((anterior.get("renglones") or {}).get("131") or 0)
        if iva_ant and not finales.get("131"):
            alertas.insert(0, {
                "nivel": "alta",
                "texto": (f"En el período anterior el contador declaró ${_p(iva_ant)} de reteIVA (renglón 131) "
                          "y el libro no tiene reteIVA causada este mes (cuenta 2367). Preguntarle de qué "
                          "operación sale y, si aplica, registrarla aquí como ajuste."),
            })
    if formulario == "rtica":
        meses = {f"{anio:04d}-{2 * p - 1:02d}", f"{anio:04d}-{2 * p:02d}"}
        hoy = date.today()
        faltan = [m for m in sorted(meses) if m < f"{hoy.year:04d}-{hoy.month:02d}"
                  and m not in datos.get("meses_con_datos", [])]
        if faltan:
            alertas.append({"nivel": "media",
                            "texto": f"Sin ReteICA causada en {', '.join(faltan)}: confirmar que no hubo pagos sujetos."})

    if formulario == "350":
        from app.services.calendario_tributario import info_vencimiento_retencion

        vencimiento = info_vencimiento_retencion(anio, p)
    else:
        vencimiento = _vencimiento_rtica(anio, p)

    return {
        "formulario": formulario,
        "periodo": periodo,
        "nombre_periodo": _nombre_periodo(formulario, periodo),
        "titulo": "Formulario 350 · Retención en la fuente (renta + IVA)" if formulario == "350"
                  else "RTICA Bogotá · Retención de ICA",
        **{k: v for k, v in datos.items() if k not in ("renglones_calculados", "alertas")},
        "renglones": finales,
        "renglones_calculados": calc,
        "ajustes": guardado.get("ajustes") or {},
        "ajustados": ajustados,
        "editables": sorted(_EDITABLES[formulario]),
        "etiquetas_rtica": RENGLONES_RTICA if formulario == "rtica" else None,
        "estado": guardado.get("estado", "borrador"),
        "notas": guardado.get("notas", ""),
        "numero_formulario": guardado.get("numero_formulario", ""),
        "actualizado_por": guardado.get("actualizado_por", ""),
        "updated_at": guardado.get("updated_at"),
        "alertas": alertas,
        "vencimiento": vencimiento,
        "presentado_contador": _resumen_presentado(presentado),
        "anterior_contador": _resumen_presentado(anterior),
        "pago_en_libro": pago,
        "total_a_pagar": finales.get("138") if formulario == "350" else finales.get("HA"),
    }


def _resumen_presentado(d: dict | None) -> dict | None:
    if not d:
        return None
    out = {k: d.get(k) for k in ("anio", "periodo", "numero_formulario", "fecha_presentacion", "archivo")}
    if d.get("tipo") == "350":
        out["renglones"] = {k: v for k, v in (d.get("renglones") or {}).items() if v}
        out["total"] = d.get("total_mas_sanciones_138")
    else:
        out["renglones"] = {"BR": d.get("base_retencion_BR"), "RP": d.get("retenciones_practicadas_RP"),
                            "BH": d.get("total_a_declarar_BH"), "HA": d.get("saldo_a_cargo_HA")}
        out["total"] = d.get("saldo_a_cargo_HA")
    return out


def _vencimiento_rtica(anio: int, bim: int) -> dict:
    """Sin calendario cargado: se muestra lo que hizo el contador, no una fecha límite."""
    previas = sorted(
        (d for d in _declaraciones_contador() if d.get("tipo") == "RTICA" and d.get("fecha_presentacion")),
        key=lambda d: (d.get("anio"), d.get("periodo")),
    )
    ref = ", ".join(f"bim. {d['periodo']}/{d['anio']} → {d['fecha_presentacion']}" for d in previas[-3:])
    return {
        "conocido": False, "estado": "desconocido",
        "motivo": ("El calendario distrital del RTICA no está cargado en el sistema; confirmar la fecha con "
                   "el contador. Se presenta en el mes siguiente al bimestre."
                   + (f" Antes lo presentó así: {ref}." if ref else "")),
    }


def obligaciones(hoy: date | None = None) -> list[dict]:
    """Los formularios de estas fechas: los vencidos o por presentar y el que va en curso."""
    import app.services.contabilidad_core as cc

    hoy = hoy or date.today()
    out: list[dict] = []
    cc._ensure()

    # 350: de PRIMER_PERIODO al mes actual (en curso).
    a, m = PRIMER_PERIODO
    meses: list[tuple[int, int]] = []
    while (a, m) <= (hoy.year, hoy.month):
        meses.append((a, m))
        a, m = (a + 1, 1) if m == 12 else (a, m + 1)
    bims: list[tuple[int, int]] = []
    a, b = PRIMER_PERIODO[0], (PRIMER_PERIODO[1] + 1) // 2
    while (a, 2 * b - 1) <= (hoy.year, hoy.month):
        bims.append((a, b))
        a, b = (a + 1, 1) if b == 6 else (a, b + 1)

    from app.services.calendario_tributario import info_vencimiento_retencion

    with cc._conn() as con:
        _ensure_tabla(con)
        for (a, m) in meses:
            periodo = f"{a:04d}-{m:02d}"
            out.append(_fila_obligacion(con, "350", periodo, a, m,
                                        en_curso=(a, m) == (hoy.year, hoy.month),
                                        vencimiento=info_vencimiento_retencion(a, m)))
        for (a, b) in bims:
            periodo = f"{a:04d}-B{b}"
            en_curso = (a == hoy.year and hoy.month in (2 * b - 1, 2 * b))
            out.append(_fila_obligacion(con, "rtica", periodo, a, b, en_curso=en_curso,
                                        vencimiento=_vencimiento_rtica(a, b)))

    # IVA cuatrimestral: solo para tenerlo a la vista; el borrador no se arma aquí.
    cuat = (hoy.month - 1) // 4 + 1
    out.append({
        "formulario": "300", "periodo": f"{hoy.year}-C{cuat}",
        "nombre_periodo": f"cuatrimestre {cuat} {hoy.year}",
        "titulo": "Formulario 300 · IVA cuatrimestral", "estado": "en_curso",
        "borrador_disponible": False,
        "nota": "Se presenta en el mes siguiente al cuatrimestre; el borrador del 300 todavía no se arma aquí.",
    })
    orden = {"vencido": 0, "pendiente": 1, "en_curso": 2, "presentado": 3}
    out.sort(key=lambda o: (orden.get(o["estado"], 9), o["periodo"]))
    return out


def _fila_obligacion(con, formulario: str, periodo: str, anio: int, p: int, *,
                     en_curso: bool, vencimiento: dict) -> dict:
    guardado = _estado_guardado(con, formulario, periodo)
    presentado = _presentada_contador(formulario, anio, p)
    pago = _pago_en_libro(con, formulario, anio, p)
    if presentado or pago or guardado.get("estado") == "presentado":
        estado = "presentado"
    elif en_curso:
        estado = "en_curso"
    elif vencimiento.get("estado") == "vencido":
        estado = "vencido"
    else:
        estado = "pendiente"
    return {
        "formulario": formulario, "periodo": periodo,
        "nombre_periodo": _nombre_periodo(formulario, periodo),
        "titulo": "Formulario 350 · Retefuente + reteIVA" if formulario == "350" else "RTICA Bogotá · ReteICA",
        "estado": estado,
        "estado_borrador": guardado.get("estado", "borrador"),
        "borrador_disponible": True,
        "vencimiento": vencimiento,
        "presentado_contador": _resumen_presentado(presentado),
        "pago_en_libro": pago,
    }


def csv_borrador(formulario: str, periodo: str) -> str:
    """El borrador en CSV (renglones + detalle por tercero) para mandarlo o abrirlo en Excel."""
    import csv
    import io

    b = borrador(formulario, periodo)
    f = io.StringIO()
    w = csv.writer(f, delimiter=";")
    w.writerow([b["titulo"], b["nombre_periodo"], f"estado: {b['estado']}"])
    w.writerow([])
    w.writerow(["Renglón", "Valor borrador", "Calculado del libro", "Ajuste / nota"])
    for k in sorted(b["renglones"], key=lambda x: (len(x), x)):
        aj = b["ajustes"].get(k)
        w.writerow([k, b["renglones"][k], b["renglones_calculados"].get(k, ""), aj["nota"] if aj else ""])
    w.writerow([])
    w.writerow(["Tercero", "Identificación", "Persona", "Concepto / tarifa", "Base", "Retención", "Asientos"])
    for t in b["terceros"]:
        w.writerow([
            t["tercero"], t["identificacion"], t["persona"],
            t.get("concepto") or f"{t.get('tarifa_por_mil')}‰",
            f"{t['base']:.0f}", f"{t['retencion']:.0f}",
            " ".join(f"#{l['movimiento_id']}" for l in t["lineas"]),
        ])
    if b["alertas"]:
        w.writerow([])
        w.writerow(["Alertas"])
        for a in b["alertas"]:
            w.writerow([a["texto"]])
    return f.getvalue()


def enviar_al_contador(formulario: str, periodo: str, destinatario: str = "", nota: str = "",
                       usuario: str = "") -> dict:
    """Manda el borrador al contador por correo (CSV adjunto) y lo marca «enviado_contador»."""
    import os

    from app.services import empresa
    from app.tools.web_pedidos import _send_smtp_with_attachments, _smtp_ready

    correo = (destinatario or os.getenv("EMAIL_CONTADOR") or "").strip()
    if not correo:
        raise ValueError("No hay correo del contador. Configúralo en EMAIL_CONTADOR o escríbelo.")
    if not _smtp_ready():
        raise ValueError("SMTP no configurado (SMTP_HOST / SMTP_USER / SMTP_PASSWORD / EMAIL_FROM)")
    b = borrador(formulario, periodo)

    def cop(v):
        return "$" + _p(v)

    if formulario == "350":
        resumen = [("130 · Retenciones a título de renta", b["renglones"].get("130")),
                   ("134 · Retenciones a título de IVA", b["renglones"].get("134")),
                   ("138 · Total a pagar", b["renglones"].get("138"))]
    else:
        resumen = [("Base de retención", b["renglones"].get("BR")),
                   ("Retenciones practicadas", b["renglones"].get("RP")),
                   ("Saldo a cargo", b["renglones"].get("HA"))]
    lineas = "\n".join(f"- {k}: {cop(v)}" for k, v in resumen)
    texto = (
        f"Cordial saludo, William.\n\n"
        f"Te enviamos el borrador de {b['titulo']} — {b['nombre_periodo']} de "
        f"{empresa.razon_social()} (NIT {empresa.nit()}), armado desde nuestro Libro Mayor, "
        f"para revisarlo contigo antes de presentarlo.\n\n{lineas}\n\n"
        "En el CSV adjunto va cada renglón y el detalle por tercero con los asientos que lo soportan."
        + (f"\n\nPuntos para revisar:\n" + "\n".join(f"- {a['texto']}" for a in b["alertas"]) if b["alertas"] else "")
        + (f"\n\n{nota.strip()}" if nota.strip() else "")
        + f"\n\n{empresa.razon_social()}"
    )
    html = "<div style='font-family:system-ui,sans-serif;white-space:pre-wrap'>" + (
        texto.replace("&", "&amp;").replace("<", "&lt;")) + "</div>"
    nombre = f"borrador_{formulario}_{periodo}.csv"
    ok = _send_smtp_with_attachments(
        correo, f"Borrador {b['titulo']} — {b['nombre_periodo']} — {empresa.razon_social()}",
        texto, html, [(nombre, "text/csv", csv_borrador(formulario, periodo).encode("utf-8-sig"))],
    )
    if not ok:
        raise ValueError("Falló el envío SMTP (revisa credenciales y red)")
    guardar_estado(formulario, periodo, estado="enviado_contador", usuario=usuario)
    return {"ok": True, "destinatario": correo}


# ─── Lo que declaró el contador vs. el libro ───────────────────────────────
#
# Cada declaración que William presentó (350, RTICA, 300, ICA anual, renta 110),
# leída de los PDF que manda por correo (`scripts/descargar_soportes_contador.py`
# + `scripts/extraer_declaraciones_contador.py`), al lado de lo que da el Libro
# Mayor para el mismo período, renglón por renglón. Tres cosas que se confunden
# fácil y aquí se separan a propósito:
#
#   * cobertura — el libro solo está completo desde julio de 2026 (antes tiene
#     un puñado de asientos sueltos). Un período sin libro no «difiere»: no hay
#     contra qué comparar, y la vista lo dice así.
#   * diferencia — con el período cubierto, cada renglón distinto se vuelve una
#     pregunta concreta para William, con las facturas del libro que la explican.
#   * pago — lo declarado contra los recibos 490 / formularios de pago SDH. Una
#     declaración «presentada sin pago» que nunca se pagó genera intereses.

_MIN_MOVS_MES = 200   # un mes con menos asientos no está llevado en el libro
_CORTE = "2026-09-01"

_ETIQ_300 = {
    "28": "Ingresos por operaciones gravadas", "40": "Ingresos por operaciones excluidas / no gravadas",
    "43": "Total ingresos netos del período", "67": "Total impuesto generado (IVA de ventas)",
    "81": "Total impuestos descontables (IVA de compras)", "82": "Saldo a pagar del período",
    "83": "Saldo a favor del período", "85": "Retenciones de IVA que le practicaron",
    "88": "Total saldo a pagar", "89": "Total saldo a favor",
}
_ETIQ_110 = {
    "44": "Patrimonio bruto", "45": "Deudas", "46": "Patrimonio líquido",
    "47": "Ingresos brutos de actividades ordinarias", "58": "Total ingresos brutos",
    "67": "Total costos y gastos deducibles", "75": "Renta líquida gravable",
    "96": "Impuesto neto de renta", "99": "Total impuesto a cargo", "106": "Otras retenciones",
    "114": "Total saldo a favor",
}


def _meses_cubiertos(con) -> set[str]:
    return {r[0] for r in con.execute(
        "SELECT substr(fecha,1,7) FROM cc_movimientos WHERE estado <> 'anulado' "
        "GROUP BY 1 HAVING COUNT(*) >= ?", (_MIN_MOVS_MES,))}


def _neto_cuentas(con, patron: str, desde: str, hasta: str, signo: str = "credito") -> float:
    expr = "l.credito - l.debito" if signo == "credito" else "l.debito - l.credito"
    r = con.execute(
        f"""SELECT COALESCE(SUM({expr}),0) FROM cc_movimiento_lineas l
              JOIN cc_movimientos m ON m.id = l.movimiento_id AND m.estado <> 'anulado'
              JOIN cc_plan_cuentas c ON c.id = l.cuenta_id
             WHERE c.codigo LIKE ? AND m.fecha BETWEEN ? AND ?""",
        (patron, desde, hasta)).fetchone()
    return float(r[0] or 0)


def _archivo_rel(ruta: str | None) -> str | None:
    return ruta if ruta and ruta.startswith("docs/contabilidad/") else None


def _comunicados_dian() -> list[dict]:
    from pathlib import Path

    out: list[dict] = []
    for f in sorted((Path(__file__).resolve().parents[2] / "docs" / "contabilidad").glob("*/comunicados_dian.json")):
        try:
            out.extend(json.loads(f.read_text(encoding="utf-8")))
        except Exception:
            continue
    return out


def _fila(r: str, etiqueta: str, contador: float | None, libro: float | None) -> dict:
    dif = None if contador is None or libro is None else float(libro) - float(contador)
    return {"renglon": r, "etiqueta": etiqueta, "contador": contador, "libro": libro,
            "diferencia": dif, "cuadra": dif is not None and abs(dif) <= 1000}


def contraste_contador() -> dict:
    """Todo lo que William presentó en el año (y las anuales del año gravable
    anterior) contra el libro. Lo más reciente primero."""
    import app.services.contabilidad_core as cc

    decls = _declaraciones_contador()
    hoy = date.today()
    anio_actual = hoy.year
    pagos_490: dict[str, list[dict]] = {}
    pagos_sdh: dict[tuple, dict] = {}
    for d in decls:
        if d.get("tipo") == "490" and d.get("formulario_pagado"):
            pagos_490.setdefault(str(d["formulario_pagado"]), []).append(d)
        if d.get("tipo") == "PAGO_SDH":
            pagos_sdh[(d.get("impuesto"), d.get("anio"), d.get("periodo"))] = d

    def presentada_este_anio(d: dict) -> bool:
        f = str(d.get("fecha_presentacion") or "")
        if not f and d.get("numero_formulario"):
            # El 300 no trae fecha en el PDF: vale la del recibo 490 con que se pagó.
            f = str(next((x.get("fecha_pago") for x in pagos_490.get(str(d["numero_formulario"]), [])), "") or "")
        if f:
            return f.startswith(str(anio_actual))
        return int(d.get("anio") or 0) >= anio_actual - 1

    vistos: set[tuple] = set()
    out: list[dict] = []
    cc._ensure()
    with cc._conn() as con:
        cubiertos = _meses_cubiertos(con)
        for d in decls:
            tipo = d.get("tipo")
            if tipo not in ("350", "RTICA", "300", "ICA", "110") or not presentada_este_anio(d):
                continue
            clave = (tipo, d.get("anio"), d.get("periodo"))
            if clave in vistos:
                continue
            vistos.add(clave)
            try:
                out.append(_contraste_una(con, d, cubiertos, pagos_490, pagos_sdh))
            except Exception as e:  # una declaración rara no tumba la vista
                out.append({"formulario": tipo, "anio": d.get("anio"), "periodo": d.get("periodo"),
                            "titulo": tipo, "nombre_periodo": "", "error": str(e), "renglones": [],
                            "veredicto": "error", "preguntas": []})

    # Por fin del período: el 300 a favor no trae fecha de presentación.
    out.sort(key=lambda x: (x.get("hasta") or "", x.get("formulario")), reverse=True)
    resumen = {
        "declaraciones": len(out),
        "cuadran": sum(1 for x in out if x["veredicto"] == "cuadra"),
        "difieren": sum(1 for x in out if x["veredicto"] == "difiere"),
        "sin_libro": sum(1 for x in out if x["veredicto"] in ("sin_libro", "libro_parcial")),
        "sin_pago": sum(1 for x in out if (x.get("pago") or {}).get("estado") == "sin_pago"),
        "preguntas": sum(len(x.get("preguntas") or []) for x in out),
        "meses_con_libro": sorted(cubiertos),
    }
    return {"resumen": resumen, "declaraciones": out}


def _contraste_una(con, d: dict, cubiertos: set[str], pagos_490: dict, pagos_sdh: dict) -> dict:
    tipo = d["tipo"]
    anio = int(d.get("anio") or 0)
    per = d.get("periodo")
    reng = {str(k): v for k, v in (d.get("renglones") or {}).items()}
    filas: list[dict] = []
    preguntas: list[str] = []
    terceros_libro: list[dict] = []
    total_contador: float | None = None
    total_libro: float | None = None

    if tipo == "350":
        desde, hasta = _rango_mes(anio, int(per))
        titulo, nombre = "Formulario 350 · Retefuente + reteIVA", f"{MESES[int(per) - 1]} {anio}"
        meses = [desde[:7]]
    elif tipo == "RTICA":
        desde, hasta = _rango_bimestre(anio, int(per))
        titulo, nombre = "RTICA Bogotá · ReteICA", f"bimestre {per} ({MESES[2 * int(per) - 2][:3]}–{MESES[2 * int(per) - 1][:3]}) {anio}"
        meses = [desde[:7], hasta[:7]]
    elif tipo == "300":
        c = int(per)
        desde, hasta = _rango_mes(anio, 4 * c - 3)[0], _rango_mes(anio, 4 * c)[1]
        titulo, nombre = "Formulario 300 · IVA cuatrimestral", f"cuatrimestre {c} {anio}"
        meses = [f"{anio:04d}-{m:02d}" for m in range(4 * c - 3, 4 * c + 1)]
    else:
        desde, hasta = f"{anio:04d}-01-01", f"{anio:04d}-12-31"
        titulo = "Formulario 110 · Renta" if tipo == "110" else "ICA Bogotá · anual"
        nombre = f"año gravable {anio}"
        meses = [f"{anio:04d}-{m:02d}" for m in range(1, 13)]

    con_libro = [m for m in meses if m in cubiertos]
    cobertura = {"meses": meses, "con_libro": con_libro, "completa": len(con_libro) == len(meses)}

    if tipo == "350":
        b = _borrador_350(con, anio, int(per))
        lib = _totales_350(dict(b["renglones_calculados"]))
        for concepto, (rbpj, rrpj, rbpn, rrpn, et) in RENGLONES_350.items():
            for r, sub in ((rbpj, "PJ base"), (rrpj, "PJ retención"), (rbpn, "PN base"), (rrpn, "PN retención")):
                c_v, l_v = float(reng.get(str(r)) or 0), float(lib.get(str(r)) or 0)
                if c_v or l_v:
                    filas.append(_fila(str(r), f"{et} · {sub}", c_v, l_v))
        for r, et in RENGLONES_350_TOTALES_PY:
            c_v, l_v = float(reng.get(r) or 0), float(lib.get(r) or 0)
            if c_v or l_v or r in ("130", "138"):
                filas.append(_fila(r, et, c_v, l_v))
        total_contador = float(d.get("total_mas_sanciones_138") or reng.get("138") or 0)
        total_libro = float(lib.get("138") or 0)
        terceros_libro = [{"tercero": t["tercero"], "identificacion": t["identificacion"], "persona": t["persona"],
                           "concepto": t["concepto"], "base": t["base"], "retencion": t["retencion"],
                           "asientos": [l["movimiento_id"] for l in t["lineas"]]} for t in b["terceros"]]
        numero = d.get("numero_formulario")
        recibos = pagos_490.get(str(numero), [])
        pagado = sum(float(x.get("valor_impuesto") or 0) + float(x.get("valor_sancion") or 0)
                     + float(x.get("valor_mora") or 0) for x in recibos)
        pago = {"recibos": [{"numero": x.get("numero_formulario"), "fecha": x.get("fecha_pago"),
                             "valor": x.get("valor_impuesto"), "concepto": "renta" if x.get("concepto") == "61" else
                             "IVA" if x.get("concepto") == "62" else x.get("concepto"),
                             "archivo": _archivo_rel(x.get("archivo"))} for x in recibos],
                "pagado": pagado}
    elif tipo == "RTICA":
        b = _borrador_rtica(con, anio, int(per))
        lib = _totales_rtica(dict(b["renglones_calculados"]))
        cont = {"BR": d.get("base_retencion_BR"), "RP": d.get("retenciones_practicadas_RP"),
                "BH": d.get("total_a_declarar_BH"), "HA": d.get("saldo_a_cargo_HA")}
        for r, et in RENGLONES_RTICA:
            if r in cont:
                filas.append(_fila(r, et, float(cont[r] or 0), float(lib.get(r) or 0)))
        total_contador, total_libro = float(cont["HA"] or 0), float(lib.get("HA") or 0)
        terceros_libro = [{"tercero": t["tercero"], "identificacion": t["identificacion"], "persona": t["persona"],
                           "concepto": f"{t['tarifa_por_mil']}‰", "base": t["base"], "retencion": t["retencion"],
                           "asientos": [l["movimiento_id"] for l in t["lineas"]]} for t in b["terceros"]]
        p = pagos_sdh.get(("RTICA", anio, int(per)))
        pago = {"recibos": ([{"numero": p.get("numero_formulario"), "fecha": p.get("fecha_pago"),
                              "valor": p.get("total_a_pagar_TP"), "concepto": "pago SDH",
                              "archivo": _archivo_rel(p.get("archivo"))}] if p else []),
                "pagado": float((p or {}).get("total_a_pagar_TP") or 0)}
    elif tipo == "300":
        ingresos = _neto_cuentas(con, "41%", desde, hasta)
        generado = _neto_cuentas(con, "240805%", desde, hasta)
        descontable = _neto_cuentas(con, "240810%", desde, hasta, signo="debito")
        reteiva = _neto_cuentas(con, "135517%", desde, hasta, signo="debito")
        lib = {"43": _miles(ingresos), "67": _miles(generado), "81": _miles(descontable), "85": _miles(reteiva)}
        lib["82"] = max(lib["67"] - lib["81"], 0)
        for r in ("28", "40", "43", "67", "81", "82", "85", "88", "89"):
            c_v = float(reng.get(r) or 0)
            filas.append(_fila(r, _ETIQ_300[r], c_v, float(lib[r]) if r in lib else None))
        total_contador = float(reng.get("88") or 0) - float(reng.get("89") or 0)
        total_libro = None
        pago = {"recibos": [], "pagado": 0.0}
        for x in pagos_490.get(str(d.get("numero_formulario")), []):
            pago["recibos"].append({"numero": x.get("numero_formulario"), "fecha": x.get("fecha_pago"),
                                    "valor": x.get("valor_impuesto"), "concepto": "IVA",
                                    "archivo": _archivo_rel(x.get("archivo"))})
            pago["pagado"] += float(x.get("valor_impuesto") or 0)
    elif tipo == "ICA":
        for r, k, et in (("BE", "ingresos_netos_gravables_BE", "Ingresos netos gravables"),
                         ("IC", "impuesto_ica_IC", "Impuesto de industria y comercio"),
                         ("FU", "total_impuesto_a_cargo_FU", "Total impuesto a cargo"),
                         ("BI", "retenido_ica_BI", "Menos ReteICA que le practicaron"),
                         ("HA", "saldo_a_cargo_HA", "Saldo a cargo")):
            filas.append(_fila(r, et, float(d.get(k) or 0), None))
        total_contador = float(d.get("valor_a_pagar_VP") or d.get("saldo_a_cargo_HA") or 0)
        p = pagos_sdh.get(("ICA", anio, 7)) or next((v for k2, v in pagos_sdh.items() if k2[0] == "ICA" and k2[1] == anio), None)
        pago = {"recibos": ([{"numero": p.get("numero_formulario"), "fecha": p.get("fecha_pago"),
                              "valor": p.get("total_a_pagar_TP"), "concepto": "pago SDH",
                              "archivo": _archivo_rel(p.get("archivo"))}] if p else []),
                "pagado": float((p or {}).get("total_a_pagar_TP") or 0)}
    else:  # 110
        for r, et in _ETIQ_110.items():
            v = reng.get(r)
            if v is None:
                v = {"44": d.get("patrimonio_bruto_44"), "45": d.get("pasivos_45"), "46": d.get("patrimonio_liquido_46"),
                     "47": d.get("ingresos_brutos_ordinarios_47"), "58": d.get("total_ingresos_brutos_58"),
                     "67": d.get("total_costos_gastos_67"), "75": d.get("renta_liquida_75"),
                     "96": d.get("impuesto_neto_renta_96"), "99": d.get("total_impuesto_a_cargo_99"),
                     "106": d.get("otras_retenciones_106"), "114": d.get("total_saldo_a_favor_114")}.get(r)
            filas.append(_fila(r, et, float(v or 0), None))
        total_contador = float(d.get("total_saldo_a_pagar_113") or 0) - float(d.get("total_saldo_a_favor_114") or 0)
        pago = {"recibos": [], "pagado": 0.0}
        for com in _comunicados_dian():
            if str(com.get("numero_formulario")) == str(d.get("numero_formulario")):
                preguntas.append(
                    f"La DIAN (comunicado {com.get('radicado')}, {com.get('fecha')}) dice que terceros le reportaron "
                    f"ingresos por ${_p(com['ingresos_terceros'])} y en la renta se declararon ${_p(com['ingresos_declarados'])} "
                    f"(diferencia ${_p(com['ingresos_terceros'] - com['ingresos_declarados'])}); y que los costos "
                    f"declarados superan los ${_p(com['compras_terceros'])} que reportaron los proveedores. "
                    f"¿Corrige la declaración o responde con soportes? Plazo: {com.get('plazo')}.")

    # Pago: lo declarado contra lo que se pagó.
    if tipo in ("350", "RTICA", "ICA") and total_contador:
        pagado = pago["pagado"]
        pago["estado"] = ("pagado" if pagado >= total_contador - 1000 else
                          "pago_parcial" if pagado > 0 else "sin_pago")
    else:
        pago["estado"] = "no_aplica" if not total_contador or total_contador <= 0 else ("pagado" if pago["pagado"] else "sin_pago")
    pago["pago_en_libro"] = _pago_en_libro(con, "350" if tipo == "350" else "rtica", anio, int(per)) \
        if tipo in ("350", "RTICA") else None

    if not con_libro:
        veredicto = "sin_libro"
    elif not cobertura["completa"]:
        veredicto = "libro_parcial"
    else:
        veredicto = "cuadra" if all(f["cuadra"] for f in filas if f["libro"] is not None) else "difiere"

    # Preguntas concretas, solo cuando el libro cubre el período.
    if veredicto == "difiere":
        for f in filas:
            if f["libro"] is None or f["cuadra"]:
                continue
            txt = (f"Renglón {f['renglon']} ({f['etiqueta']}): declaraste ${_p(f['contador'])} y el libro da "
                   f"${_p(f['libro'])} (diferencia ${_p(f['diferencia'])}).")
            if tipo == "350" and f["renglon"] in {str(x[1]) for x in RENGLONES_350.values()} | {str(x[3]) for x in RENGLONES_350.values()}:
                txt += " ¿Qué facturas o pagos incluiste? El detalle del libro está abajo."
            if tipo == "350" and f["renglon"] == "131" and not f["libro"]:
                txt += " En el libro no hay reteIVA causada (2367): ¿de qué operación sale?"
            if tipo == "RTICA" and f["renglon"] == "BR" and (f["libro"] or 0) < (f["contador"] or 0) / 2:
                txt += (" ¿Qué pagos incluiste en la base? En el libro solo llevan ReteICA los honorarios y el "
                        "transporte; desde el 23-sep-2026 las compras de materia prima no llevan ReteICA en el sistema. "
                        "Si tú sí la practicas en compras, hay que acordar la regla.")
            if tipo == "350" and f["renglon"] == "129":
                txt += " ¿Qué retención de meses anteriores se descontó como practicada en exceso?"
            preguntas.append(txt)
    if pago["estado"] == "sin_pago" and total_contador and total_contador > 0:
        preguntas.append(f"No aparece el pago de esta declaración (${_p(total_contador)}). ¿Se pagó? Si no, corren intereses.")
    elif pago["estado"] == "pago_parcial":
        preguntas.append(f"Se declaró ${_p(total_contador)} y los recibos suman ${_p(pago['pagado'])}.")

    return {
        "formulario": tipo, "anio": anio, "periodo": per, "titulo": titulo, "nombre_periodo": nombre,
        "numero_formulario": d.get("numero_formulario"),
        "fecha_presentacion": d.get("fecha_presentacion") or (pago["recibos"][0]["fecha"] if pago["recibos"] else None),
        "archivo": _archivo_rel(d.get("archivo")),
        "desde": desde, "hasta": hasta,
        "antes_del_corte": hasta < _CORTE,
        "cobertura": cobertura, "veredicto": veredicto,
        "total_contador": total_contador, "total_libro": total_libro,
        "renglones": filas, "preguntas": preguntas, "pago": pago,
        "terceros_libro": terceros_libro,
    }


RENGLONES_350_TOTALES_PY = [
    ("129", "Menos retenciones en exceso (períodos anteriores)"),
    ("130", "Total retenciones renta"),
    ("131", "ReteIVA a responsables de IVA"),
    ("132", "ReteIVA servicios a no residentes"),
    ("134", "Total retenciones IVA"),
    ("137", "Sanciones"),
    ("138", "Total a pagar"),
]


def ruta_soporte(archivo: str):
    """Ruta absoluta de un PDF del contador, solo dentro de docs/contabilidad/*/Soportes_Contador."""
    from pathlib import Path

    raiz = (Path(__file__).resolve().parents[2] / "docs" / "contabilidad").resolve()
    p = (Path(__file__).resolve().parents[2] / (archivo or "")).resolve()
    if raiz not in p.parents or "Soportes_Contador" not in p.parts or not p.is_file():
        return None
    return p


# ─── Cruce de tres fuentes: lo declarado ↔ la DIAN ↔ el banco ──────────────
#
# * William: las declaraciones que presentó (350, RTICA, 300) y sus recibos 490/SDH.
# * DIAN: el reporte mensual de facturación electrónica (`reportes_dian_fe`), lo
#   que la DIAN ve facturado a nombre de McKenna — con IVA incluido.
# * Banco: los extractos de la cuenta de la EMPRESA cargados en Conciliación
#   (`extractos_bancarios.tercero_id IS NULL`; el banco de un socio nunca entra).
#
# Tres cruces, cada uno con su propio margen, porque no miden lo mismo:
#   1. Ventas: total facturado del 300 (renglón 43 + IVA 67) contra ventas netas
#      de la DIAN (facturas − notas crédito). Deben coincidir casi al peso.
#   2. Compras: base sujeta del 350 contra compras que la DIAN ve recibidas. NO
#      deben coincidir (autorretenedores, grandes contribuyentes, bajo el mínimo);
#      se muestra el porcentaje para preguntar si ese resto está bien explicado.
#   3. Pagos: cada recibo 490 / pago SDH contra la línea del extracto (monto exacto,
#      ±5 días). Y al revés: pagos a la DIAN/SDH del banco sin recibo conocido.

_PALABRAS_FISCO = ("DIAN", "HACIE", "IMPUEST", "TESORER", "DISTRITAL")


def _lineas_banco_empresa(con) -> list[dict]:
    return [dict(r) for r in con.execute(
        """SELECT m.id, m.extracto_id, m.fecha, m.descripcion, m.monto, m.tipo
             FROM extracto_movimientos m JOIN extractos_bancarios e ON e.id = m.extracto_id
            WHERE e.tercero_id IS NULL ORDER BY m.fecha""")]


def _categoria_abono(desc: str) -> str:
    d = (desc or "").upper()
    if "MERCADO" in d:
        return "mercado_pago"
    if d.startswith(("PAGO QR", "PAGO LLAVE", "TRANSFERENCIA DESDE NEQ")) or "NEQUI" in d:
        return "clientes"
    return "otros"


def cruce_tripartito(anio: int | None = None) -> dict:
    import app.services.contabilidad_core as cc
    from app.services import reportes_dian_fe

    anio = anio or date.today().year
    dian = {k: v for k, v in reportes_dian_fe.por_mes().items() if k.startswith(f"{anio:04d}-")}
    decls = [d for d in _declaraciones_contador() if int(d.get("anio") or 0) == anio]
    try:
        from app.services.pagos_impuestos import recibos as _recibos

        recibos = _recibos(f"{anio:04d}-01-01")["recibos"]
    except Exception:
        recibos = []

    cc._ensure()
    with cc._conn() as con:
        banco = [l for l in _lineas_banco_empresa(con) if l["fecha"].startswith(f"{anio:04d}-")]
    meses_banco = sorted({l["fecha"][:7] for l in banco})

    from app.services import mercadopago_liquidaciones

    mp = mercadopago_liquidaciones.por_mes(anio)

    # ── por mes ──
    hasta_mes = date.today().month if anio == date.today().year else 12
    meses: list[dict] = []
    for m in range(1, hasta_mes + 1):
        k = f"{anio:04d}-{m:02d}"
        d350 = next((d for d in decls if d.get("tipo") == "350" and int(d.get("periodo") or 0) == m), None)
        r = {str(a): float(b or 0) for a, b in ((d350 or {}).get("renglones") or {}).items()}
        bases = [str(x[0]) for x in RENGLONES_350.values()] + [str(x[2]) for x in RENGLONES_350.values()]
        lb = [l for l in banco if l["fecha"].startswith(k)]
        abonos = [l for l in lb if l["tipo"] == "credito"]
        cat = {"mercado_pago": 0.0, "clientes": 0.0, "otros": 0.0}
        for l in abonos:
            cat[_categoria_abono(l["descripcion"])] += float(l["monto"])
        fisco = [l for l in lb if l["tipo"] == "debito" and any(p in (l["descripcion"] or "").upper() for p in _PALABRAS_FISCO)]
        dm = dian.get(k)
        mpm = mp.get(k)
        meses.append({
            "mes": k,
            "mercado_pago": ({"ventas": mpm.get("ventas", 0), "envios": mpm.get("envios", 0),
                              "devoluciones": round(mpm.get("devoluciones", 0) + mpm.get("disputas", 0), 2),
                              "cashback": mpm.get("cashback", 0), "comisiones": mpm.get("comisiones", 0),
                              "neto": mpm.get("neto", 0)} if mpm else None),
            "dian": ({"ventas_netas": dm["ventas_netas"], "compras_netas": dm["compras_netas"],
                      "doc_soporte": dm["doc_soporte"], "fuente": dm["fuente"]} if dm else None),
            "william_350": ({"base_sujeta": sum(r.get(b, 0) for b in bases),
                             "compras_base": r.get("36", 0) + r.get("86", 0),
                             "total": float(d350.get("total_mas_sanciones_138") or 0),
                             "numero": d350.get("numero_formulario")} if d350 else None),
            "banco": ({"abonos": round(sum(float(l["monto"]) for l in abonos), 2),
                       "cargos": round(sum(float(l["monto"]) for l in lb if l["tipo"] == "debito"), 2),
                       **{f"abonos_{c}": round(v, 2) for c, v in cat.items()},
                       "pagos_fisco": round(sum(float(l["monto"]) for l in fisco), 2)} if lb else None),
        })

    hallazgos: list[dict] = []

    # ── 1. ventas: 300 vs DIAN ──
    ivas: list[dict] = []
    for d in sorted((d for d in decls if d.get("tipo") == "300"), key=lambda d: int(d.get("periodo") or 0)):
        c = int(d["periodo"])
        ks = [f"{anio:04d}-{m:02d}" for m in range(4 * c - 3, 4 * c + 1)]
        reng = {str(a): float(b or 0) for a, b in (d.get("renglones") or {}).items()}
        ingresos = float(d.get("total_ingresos_netos_43") or reng.get("43") or 0)
        iva_gen = float(d.get("impuesto_generado_67") or reng.get("67") or 0)
        iva_desc = float(d.get("impuesto_descontable_81") or reng.get("81") or 0)
        faltan = [k for k in ks if k not in dian]
        dian_ventas = sum(dian[k]["ventas_netas"] for k in ks if k in dian)
        dian_compras = sum(dian[k]["compras_netas"] for k in ks if k in dian)
        w_fact = ingresos + iva_gen
        dif = dian_ventas - w_fact
        fila = {
            "cuatrimestre": c, "meses": ks, "numero": d.get("numero_formulario"), "dian_completa": not faltan,
            "william_ingresos": ingresos, "william_iva_generado": iva_gen, "william_total_facturado": w_fact,
            "dian_ventas": round(dian_ventas, 2), "diferencia_ventas": round(dif, 2),
            "pct_ventas": round(dif / w_fact * 100, 2) if w_fact else None,
            "william_iva_descontable": iva_desc,
            "william_compras_gravadas_con_iva": round(iva_desc / 0.19 * 1.19, 2),
            "dian_compras": round(dian_compras, 2),
            "mp_ventas_netas": round(sum((mp.get(k) or {}).get("ventas", 0) + (mp.get(k) or {}).get("devoluciones", 0)
                                         + (mp.get(k) or {}).get("disputas", 0) for k in ks), 2) if mp else None,
        }
        ivas.append(fila)
        if not faltan and w_fact and abs(dif) / w_fact > 0.01:
            hallazgos.append({"nivel": "alta", "tema": "ventas",
                              "texto": f"IVA cuatrimestre {c}: la DIAN ve ${_p(dian_ventas)} facturados (con IVA) y el 300 "
                                       f"declara ${_p(w_fact)} (ingresos + IVA). Diferencia ${_p(dif)} "
                                       f"({fila['pct_ventas']}%). Preguntarle a William qué facturas o notas no entraron."})

    # ── 2. compras: 350 vs DIAN ──
    for mm in meses:
        if mm["dian"] and mm["william_350"] and mm["dian"]["compras_netas"]:
            mm["pct_compras_con_retencion"] = round(
                mm["william_350"]["compras_base"] / (mm["dian"]["compras_netas"] / 1.19) * 100, 1)
    bajos = [mm for mm in meses if (mm.get("pct_compras_con_retencion") or 100) < 40]
    if bajos:
        hallazgos.append({"nivel": "media", "tema": "compras",
                          "texto": "En " + ", ".join(f"{MESES[int(x['mes'][5:]) - 1]} ({x['pct_compras_con_retencion']}%)" for x in bajos)
                                   + " menos del 40% de las compras que la DIAN ve recibidas (sin IVA aprox.) tienen "
                                     "retención en el 350. Confirmar con William que el resto son autorretenedores, "
                                     "grandes contribuyentes, régimen simple o compras bajo el mínimo — y cuáles."})

    # ── 3. pagos: recibo ↔ banco ↔ libro ──
    # Dos pasadas. Primero exacto (mismo valor, ±5 días). Después tolerante: el
    # banco puede mostrar unos pesos MÁS y unos días DESPUÉS que el recibo — el
    # pago salió tarde y la DIAN/SDH cobró intereses de mora (2025: $7.987.000 del
    # recibo vs $7.992.000 en el banco). Eso no es «no pagado»: se marca como pago
    # con diferencia y se dice cuánto y cuántos días.
    usados: set[int] = set()
    pagos: list[dict] = []
    fisco = [l for l in banco if l["tipo"] == "debito" and any(p in (l["descripcion"] or "").upper() for p in _PALABRAS_FISCO)]

    def _entidad(desc: str) -> str:
        d = (desc or "").upper()
        return "DIAN" if "DIAN" in d else "SDH"

    def _buscar(valor: float, fecha: str, entidad: str, antes: int, despues: int, tolerante: bool):
        fd = date.fromisoformat(fecha[:10])
        mejor = None
        for l in fisco:
            if l["id"] in usados or _entidad(l["descripcion"]) != entidad:
                continue
            dias = (date.fromisoformat(l["fecha"][:10]) - fd).days
            if not -antes <= dias <= despues:
                continue
            dif = float(l["monto"]) - valor
            ok = abs(dif) <= 1 if not tolerante else 0 <= dif <= max(15000.0, valor * 0.015)
            if ok and (mejor is None or abs(dias) < abs(mejor[1])):
                mejor = (l, dias, dif)
        return mejor

    pendientes_rc = []
    for rc in recibos:
        f = rc.get("fecha_pago")
        valor = float(rc.get("valor") or 0) + float(rc.get("sancion") or 0) + float(rc.get("mora") or 0)
        ent = "DIAN" if rc.get("recibo") == "490" else "SDH"
        en_cobertura = bool(f) and f[:7] in meses_banco
        hit = _buscar(valor, f, ent, 5, 5, False) if en_cobertura else None
        if hit:
            usados.add(hit[0]["id"])
        pendientes_rc.append([rc, f, valor, ent, en_cobertura, hit])
    for item in pendientes_rc:
        rc, f, valor, ent, en_cobertura, hit = item
        if en_cobertura and not hit:
            hit = _buscar(valor, f, ent, 3, 20, True)
            if hit:
                usados.add(hit[0]["id"])
                item[5] = hit

    for rc, f, valor, ent, en_cobertura, hit in pendientes_rc:
        linea, dias, dif = hit if hit else (None, 0, 0.0)
        estado_b = ("encontrado" if linea and abs(dif) <= 1 else "pagado_con_diferencia" if linea
                    else "no_encontrado" if en_cobertura else "sin_extracto")
        pagos.append({
            "recibo": rc.get("recibo"), "numero": rc.get("numero"), "etiqueta": rc.get("etiqueta"),
            "periodo": rc.get("periodo"), "fecha_pago": f, "valor": valor, "archivo": _archivo_rel(rc.get("archivo")),
            "banco": ({"fecha": linea["fecha"], "descripcion": linea["descripcion"], "monto": linea["monto"],
                       "diferencia": round(dif, 2), "dias": dias} if linea else None),
            "banco_estado": estado_b,
            # Antes del corte el pago lo cubre el saldo inicial (31-ago, reconstruido con
            # lo declarado ante la DIAN): registrarlo otra vez lo duplicaría.
            "libro_estado": ("antes_del_corte" if rc.get("estado") == "pendiente" and (f or "") < _CORTE
                             else rc.get("estado")),
            "movimiento_id": rc.get("movimiento_id"),
        })
        if estado_b == "no_encontrado":
            hallazgos.append({"nivel": "alta", "tema": "pagos",
                              "texto": f"El recibo {rc.get('recibo')} {rc.get('numero')} ({rc.get('etiqueta')}, {rc.get('periodo')}) "
                                       f"por ${_p(valor)} con fecha {f} no aparece en el extracto de la empresa. "
                                       "¿Se pagó desde otra cuenta?"})
        elif estado_b == "pagado_con_diferencia":
            hallazgos.append({"nivel": "media", "tema": "pagos",
                              "texto": f"{rc.get('etiqueta')} ({rc.get('periodo')}): el recibo es por ${_p(valor)} y del banco salieron "
                                       f"${_p(linea['monto'])} el {linea['fecha']} ({dias} día(s) después del recibo). "
                                       f"Los ${_p(dif)} de más son, casi seguro, intereses de mora por pagar tarde."})
        if rc.get("estado") == "pendiente" and (f or "") >= _CORTE:
            hallazgos.append({"nivel": "media", "tema": "pagos", "accion": "registrar_recibo", "numero": rc.get("numero"),
                              "texto": f"El pago {rc.get('recibo')} {rc.get('numero')} ({rc.get('etiqueta')}, {rc.get('periodo')}, "
                                       f"${_p(valor)}) no está registrado en el Libro Mayor. Registrarlo desde "
                                       "Contabilidad → Solicitudes de pago → Impuestos."})

    # Declaraciones con saldo a pagar y sin recibo: ¿hay un pago en el banco que las cubra?
    sin_recibo: list[dict] = []
    for d in decls:
        if d.get("tipo") not in ("350", "RTICA", "ICA"):
            continue
        total = float(d.get("total_mas_sanciones_138") or d.get("saldo_a_cargo_HA") or d.get("valor_a_pagar_VP") or 0)
        num = str(d.get("numero_formulario"))
        if total <= 0:
            continue
        if d.get("tipo") == "350" and any(str((rc.get("declaracion") or {}).get("numero")) == num for rc in recibos):
            continue
        if d.get("tipo") in ("RTICA", "ICA") and any(
                rc.get("recibo") == "SDH" and str(rc.get("periodo") or "").startswith(
                    f"bimestre {d.get('periodo')} de {d.get('anio')}" if d.get("tipo") == "RTICA" else f"año {d.get('anio')}")
                for rc in recibos):
            continue
        fp = d.get("fecha_presentacion")
        nombre = (f"350 de {MESES[int(d['periodo']) - 1]} {d.get('anio')}" if d["tipo"] == "350"
                  else f"RTICA bimestre {d.get('periodo')} de {d.get('anio')}" if d["tipo"] == "RTICA"
                  else f"ICA anual {d.get('anio')}")
        hit = None
        if fp and fp[:7] in meses_banco:
            ent = "DIAN" if d["tipo"] == "350" else "SDH"
            hit = _buscar(total, fp, ent, 3, 10, False) or _buscar(total, fp, ent, 3, 45, True)
        if hit:
            usados.add(hit[0]["id"])
            sin_recibo.append({"declaracion": nombre, "total": total, "banco": hit[0]["fecha"], "monto": hit[0]["monto"]})
            hallazgos.append({"nivel": "media", "tema": "pagos",
                              "texto": f"{nombre}: declaró ${_p(total)} y no tenemos el recibo de pago, pero el banco pagó "
                                       f"${_p(hit[0]['monto'])} el {hit[0]['fecha']}. Pedirle a William el recibo para el archivo."})
        elif fp and fp[:7] in meses_banco:
            hallazgos.append({"nivel": "alta", "tema": "pagos",
                              "texto": f"{nombre}: declaró ${_p(total)} (presentado el {fp}) y no aparece ningún pago: ni recibo "
                                       "ni línea en el extracto. Si no se pagó, está corriendo mora. Preguntarle a William ya."})

    sueltos = [l for l in fisco if l["id"] not in usados]
    for l in sueltos:
        hallazgos.append({"nivel": "alta", "tema": "pagos",
                          "texto": f"El banco tiene un pago a la {'DIAN' if _entidad(l['descripcion']) == 'DIAN' else 'Secretaría de Hacienda'} "
                                   f"el {l['fecha']} por ${_p(l['monto'])} («{l['descripcion']}») que no corresponde a ninguna "
                                   "declaración ni recibo que tengamos. Pedirle a William qué pagó."})

    # ── 4. Mercado Pago ↔ banco y puente de la renta ──
    mp_anual = {c: round(sum((m.get("mercado_pago") or {}).get(c, 0) for m in meses), 2)
                for c in ("ventas", "envios", "devoluciones", "cashback", "comisiones", "neto")}
    banco_mp = round(sum((m.get("banco") or {}).get("abonos_mercado_pago", 0) for m in meses), 2)
    mercado_pago = None
    if any(m.get("mercado_pago") for m in meses):
        dif_mp = banco_mp - mp_anual["neto"]
        mercado_pago = {**mp_anual, "banco_desde_mp": banco_mp, "diferencia_banco": round(dif_mp, 2),
                        "meses": sorted(m["mes"] for m in meses if m.get("mercado_pago"))}
        if banco_mp and mp_anual["neto"] and abs(dif_mp) / mp_anual["neto"] > 0.03:
            hallazgos.append({"nivel": "media", "tema": "mercado_pago",
                              "texto": f"Mercado Pago liquidó ${_p(mp_anual['neto'])} netos en {anio} y al banco llegaron "
                                       f"${_p(banco_mp)} desde Mercado Pago (diferencia ${_p(dif_mp)}). Puede ser saldo que "
                                       "quedó en Mercado Pago o pagos hechos desde allá; revisar."})

    renta = None
    d110 = next((d for d in _declaraciones_contador() if d.get("tipo") == "110" and int(d.get("anio") or 0) == anio), None)
    if d110:
        reng = {str(a): float(b or 0) for a, b in (d110.get("renglones") or {}).items()}
        ingresos = float(d110.get("total_ingresos_brutos_58") or reng.get("58") or 0)
        iva = sum(float(d.get("impuesto_generado_67") or 0) for d in decls if d.get("tipo") == "300")
        com = next((c for c in _comunicados_dian() if int(c.get("anio") or 0) == anio), None)
        pasos = [
            {"concepto": "Ingresos declarados en la renta (renglón 58)", "valor": ingresos},
            {"concepto": "+ IVA cobrado en las ventas (renglón 67 de los 300 del año)", "valor": iva},
        ]
        if mercado_pago:
            pasos += [
                {"concepto": "+ Envíos que pagaron los compradores por Mercado Pago (no son ingreso de McKenna)",
                 "valor": mp_anual["envios"]},
                {"concepto": "+ Devoluciones y disputas (los terceros reportan la venta antes de devolverla)",
                 "valor": -mp_anual["devoluciones"]},
                {"concepto": "+ Cashback / bonificaciones de Mercado Libre", "valor": mp_anual["cashback"]},
            ]
        explicado = round(sum(x["valor"] for x in pasos), 2)
        renta = {"pasos": pasos, "explicado": explicado,
                 "terceros": com.get("ingresos_terceros") if com else None,
                 "sin_explicar": round(com["ingresos_terceros"] - explicado, 2) if com else None,
                 "plazo": com.get("plazo") if com else None, "radicado": com.get("radicado") if com else None,
                 "nota": ("Hipótesis, no conclusión: muestra que la cifra de terceros puede incluir IVA, envíos y ventas "
                          "luego devueltas, que no son ingreso gravable. Para confirmarla hay que bajar de MUISCA "
                          "«Información reportada por terceros» del año y cruzarla tercero por tercero.")}

    # Renta del año anterior contra lo que la DIAN dice que reportaron terceros.
    for com in _comunicados_dian():
        hallazgos.append({"nivel": "alta", "tema": "dian",
                          "texto": f"Comunicado DIAN {com.get('radicado')}: renta {com.get('anio')} declaró ingresos por "
                                   f"${_p(com['ingresos_declarados'])} y terceros reportaron ${_p(com['ingresos_terceros'])} "
                                   f"(diferencia ${_p(com['ingresos_terceros'] - com['ingresos_declarados'])}). "
                                   f"Responder antes del {com.get('plazo')}."})

    orden = {"alta": 0, "media": 1}
    hallazgos.sort(key=lambda h: orden.get(h["nivel"], 2))
    return {
        "anio": anio,
        "fuentes": {
            "dian_meses": sorted(dian), "dian_meses_deducidos": sorted(k for k, v in dian.items() if v["fuente"] != "reporte"),
            "extractos_meses": meses_banco, "declaraciones": len(decls), "recibos": len(recibos),
            "mercado_pago_meses": sorted(mp),
        },
        "meses": meses, "iva": ivas, "pagos": pagos, "hallazgos": hallazgos,
        "mercado_pago": mercado_pago, "renta": renta,
    }


def actualizar_fuentes() -> dict:
    """Trae del correo lo último del contador (PDF → declaraciones_contador.json) y
    los reportes mensuales de la DIAN. Sin LLM; puede tardar ~1 min."""
    from app.services import reportes_dian_fe
    from app.services.conciliacion_contador import _descargar_y_extraer

    nuevos_contador = _descargar_y_extraer()
    dian = reportes_dian_fe.actualizar_desde_gmail()
    try:
        from app.services import mercadopago_liquidaciones

        mp = mercadopago_liquidaciones.importar()
    except Exception as e:
        mp = {"error": str(e)}
    try:
        from app.services.pagos_impuestos import invalidar_cache_recibos

        invalidar_cache_recibos()
    except Exception:
        pass
    return {"soportes_contador_nuevos": nuevos_contador, "reportes_dian_nuevos": dian["nuevos"],
            "meses_dian": dian["meses"], "mercado_pago": mp}
