"""
Préstamos recibidos de terceros: cronograma, retención en la fuente y documentos.

Generaliza lo que `contabilidad_core.registrar_prestamo_recibido` ya hacía (un
solo asiento de desembolso contra 2295/2380) para el producto que McKenna
ofrece a prestamistas particulares desde sep-2026:

  - Plazo 24 cuotas mensuales, tasa pactada **efectiva anual** (default 25% E.A.).
  - El capital NO se amortiza en línea recta: se define qué porcentaje se
    devuelve en el primer tramo y el resto en el segundo (default 30% en los
    primeros 12 meses, 70% en los últimos 12). Devolver capital tarde sube el
    rendimiento del prestamista SIN cambiar la tasa — ver
    `docs/agentic/modules/prestamos.md` para la sustentación del diseño.
  - Interés sobre saldo insoluto, con **retención en la fuente por rendimientos
    financieros (7%, Art. 395 ET)** que McKenna practica como agente retenedor
    y consigna a la DIAN. La retención la asume el prestamista salvo que se
    pacte `gross_up=True`.

Tres cifras distintas que NO deben confundirse (van las tres en el contrato):
  - `tasa_ea`            tasa pactada (25% E.A. = 1,8769% mensual vencido)
  - `rendimiento_bruto`  interés que genera el cronograma (27,97% del capital
                         a 24 meses con el reparto 30/70) — es consecuencia de
                         la tasa y el cronograma, no una promesa contractual
  - `rendimiento_neto`   lo que efectivamente se le gira, después de retención
                         (26,01%). El prestamista recupera la retención en su
                         declaración de renta solo si es declarante.

Este módulo es puro cálculo + persistencia. Los asientos los arma
`contabilidad_core`, el PDF `app/tools/prestamos_pdf.py` y el recordatorio
mensual a despachos `scripts/prestamos_recordatorio_cron.py`.
"""

from __future__ import annotations

import calendar
from datetime import date, datetime

# Defaults del producto vigente (sep-2026). Se pueden sobreescribir por préstamo
# al crearlo — no hardcodear estos valores en el resto del código.
TASA_EA_DEFAULT = 0.25
PLAZO_MESES_DEFAULT = 24
MESES_TRAMO1_DEFAULT = 12
PCT_CAPITAL_TRAMO1_DEFAULT = 0.30
RETENCION_RENDIMIENTOS_PCT = 0.07


def tasa_mensual_desde_ea(tasa_ea: float) -> float:
    """Tasa mensual vencida equivalente a una efectiva anual.

    25% E.A. -> 1,8769% mensual. Ojo: NO es tasa_ea/12 (eso sería nominal, y
    daría 2,0833% = 28% E.A., sobrecobrando 3 puntos).
    """
    if tasa_ea <= -1:
        raise ValueError("tasa_ea inválida")
    return (1.0 + tasa_ea) ** (1.0 / 12.0) - 1.0


def ea_desde_tasa_mensual(i_mensual: float) -> float:
    """Inversa de `tasa_mensual_desde_ea`, para mostrar el costo real cuando el
    operador digita la tasa mensual en vez de la efectiva anual."""
    return (1.0 + i_mensual) ** 12 - 1.0


def _sumar_meses(d: date, meses: int) -> date:
    """Misma fecha N meses después, recortando el día si el mes es más corto
    (un desembolso el 31 de enero vence el 28/29 de febrero, no el 3 de marzo)."""
    total = d.month - 1 + meses
    anio = d.year + total // 12
    mes = total % 12 + 1
    dia = min(d.day, calendar.monthrange(anio, mes)[1])
    return date(anio, mes, dia)


def _fecha_cuota(desembolso: date, n: int, dia_pago: int | None) -> date:
    """Vencimiento de la cuota `n` (1-indexada). Si se fija `dia_pago`, todas
    las cuotas caen ese día del mes — es lo que permite un único recordatorio
    mensual a despachos en vez de uno por préstamo."""
    base = _sumar_meses(desembolso, n)
    if not dia_pago:
        return base
    dia = min(int(dia_pago), calendar.monthrange(base.year, base.month)[1])
    return date(base.year, base.month, dia)


def calcular_cronograma(
    capital: float,
    *,
    tasa_ea: float = TASA_EA_DEFAULT,
    plazo_meses: int = PLAZO_MESES_DEFAULT,
    meses_tramo1: int = MESES_TRAMO1_DEFAULT,
    pct_capital_tramo1: float = PCT_CAPITAL_TRAMO1_DEFAULT,
    retencion_pct: float = RETENCION_RENDIMIENTOS_PCT,
    gross_up: bool = False,
    fecha_desembolso: str | date | None = None,
    dia_pago: int | None = None,
) -> dict:
    """Cronograma completo de un préstamo recibido.

    `pct_capital_tramo1` = fracción del capital que se amortiza durante los
    primeros `meses_tramo1` meses; el resto se reparte en línea recta en los
    meses restantes. 0,5 con tramo1=12 y plazo=24 equivale a amortización recta.
    0,0 es período de gracia de capital (solo intereses el primer tramo).

    `gross_up=True` significa que McKenna asume la retención: se le gira al
    prestamista el interés bruto completo y el 7% sale de más, encareciendo la
    operación. Por defecto la retención la asume el prestamista (estándar).

    Devuelve {"cuotas": [...], "totales": {...}, "parametros": {...}}.
    """
    capital = round(float(capital or 0), 2)
    if capital <= 0:
        raise ValueError("capital debe ser mayor que cero")
    plazo_meses = int(plazo_meses)
    meses_tramo1 = int(meses_tramo1)
    if plazo_meses < 1:
        raise ValueError("plazo_meses debe ser al menos 1")
    if not 0 <= meses_tramo1 <= plazo_meses:
        raise ValueError("meses_tramo1 debe estar entre 0 y plazo_meses")
    if not 0.0 <= float(pct_capital_tramo1) <= 1.0:
        raise ValueError("pct_capital_tramo1 debe estar entre 0 y 1")
    if meses_tramo1 == 0 and pct_capital_tramo1 > 0:
        raise ValueError("no se puede amortizar capital en un tramo de 0 meses")
    if meses_tramo1 == plazo_meses and pct_capital_tramo1 < 1.0:
        raise ValueError(
            "si el primer tramo cubre todo el plazo, pct_capital_tramo1 debe ser 1.0 "
            "(de lo contrario quedaría un saldo sin amortizar al vencimiento)"
        )

    i = tasa_mensual_desde_ea(float(tasa_ea))
    ret_pct = float(retencion_pct or 0)

    meses_tramo2 = plazo_meses - meses_tramo1
    capital_tramo1 = capital * float(pct_capital_tramo1)
    capital_tramo2 = capital - capital_tramo1
    abono1 = (capital_tramo1 / meses_tramo1) if meses_tramo1 else 0.0
    abono2 = (capital_tramo2 / meses_tramo2) if meses_tramo2 else 0.0

    if isinstance(fecha_desembolso, str) and fecha_desembolso.strip():
        desembolso = datetime.strptime(fecha_desembolso.strip()[:10], "%Y-%m-%d").date()
    elif isinstance(fecha_desembolso, date):
        desembolso = fecha_desembolso
    else:
        desembolso = None

    cuotas: list[dict] = []
    saldo = capital
    for n in range(1, plazo_meses + 1):
        interes_bruto = round(saldo * i, 2)
        retencion = round(interes_bruto * ret_pct, 2)
        # Con gross-up McKenna gira el bruto y asume el 7%; sin gross-up el
        # prestamista recibe el neto y recupera la retención en su renta.
        interes_girado = interes_bruto if gross_up else round(interes_bruto - retencion, 2)

        abono = abono1 if n <= meses_tramo1 else abono2
        abono = round(abono, 2)
        if n == plazo_meses:
            abono = round(saldo, 2)  # absorbe el redondeo: el saldo cierra en 0
        abono = min(abono, round(saldo, 2))

        saldo_final = round(saldo - abono, 2)
        cuotas.append(
            {
                "numero": n,
                "fecha": _fecha_cuota(desembolso, n, dia_pago).isoformat() if desembolso else None,
                "saldo_inicial": round(saldo, 2),
                "interes_bruto": interes_bruto,
                "retencion": retencion,
                "interes_girado": interes_girado,
                "abono_capital": abono,
                # Lo que le cuesta a McKenna (gasto financiero + capital)
                "cuota_causada": round(abono + interes_bruto + (retencion if gross_up else 0), 2),
                # Lo que efectivamente sale del banco hacia el prestamista
                "cuota_girada": round(abono + interes_girado, 2),
                "saldo_final": saldo_final,
            }
        )
        saldo = saldo_final

    tot_interes = round(sum(c["interes_bruto"] for c in cuotas), 2)
    tot_retencion = round(sum(c["retencion"] for c in cuotas), 2)
    tot_girado_interes = round(sum(c["interes_girado"] for c in cuotas), 2)
    tot_causado = round(sum(c["cuota_causada"] for c in cuotas), 2)
    tot_girado = round(sum(c["cuota_girada"] for c in cuotas), 2)
    # Capital promedio realmente prestado: es lo que explica por qué 25% E.A.
    # produce 27,97% y no 50% a dos años.
    saldo_promedio = round(sum(c["saldo_inicial"] for c in cuotas) / plazo_meses, 2)

    # Costo real para McKenna. Sin gross-up coincide con la tasa pactada; con
    # gross-up sale mayor porque el 7% de la DIAN lo pone la empresa.
    tir = _tir_mensual(capital, cuotas)
    costo_real_ea = ea_desde_tasa_mensual(tir) if tir is not None else float(tasa_ea)

    return {
        "cuotas": cuotas,
        "totales": {
            "capital": capital,
            "interes_bruto": tot_interes,
            "retencion": tot_retencion,
            "interes_girado": tot_girado_interes,
            "total_causado": tot_causado,
            "total_girado": tot_girado,
            "saldo_promedio": saldo_promedio,
            # Rendimientos expresados sobre el capital original, a todo el plazo
            "rendimiento_bruto_pct": round(tot_interes / capital * 100, 4),
            "rendimiento_neto_pct": round(tot_girado_interes / capital * 100, 4),
            "costo_real_ea_pct": round(costo_real_ea * 100, 4),
        },
        "parametros": {
            "tasa_ea_pct": round(float(tasa_ea) * 100, 4),
            "tasa_mensual_pct": round(i * 100, 4),
            "plazo_meses": plazo_meses,
            "meses_tramo1": meses_tramo1,
            "pct_capital_tramo1": round(float(pct_capital_tramo1) * 100, 2),
            "retencion_pct": round(ret_pct * 100, 2),
            "gross_up": bool(gross_up),
            "fecha_desembolso": desembolso.isoformat() if desembolso else None,
            "dia_pago": int(dia_pago) if dia_pago else None,
        },
    }


def _tir_mensual(capital: float, cuotas: list[dict]) -> float | None:
    """TIR mensual del flujo que realmente desembolsa McKenna (`cuota_causada`).

    Sin gross-up coincide con la tasa pactada; con gross-up sale mayor, que es
    justo el punto: muestra cuánto encarece asumir la retención. Bisección
    simple — el flujo tiene un solo cambio de signo, así que converge siempre.
    """
    flujos = [c["cuota_causada"] for c in cuotas]
    if not flujos or capital <= 0:
        return None

    def vpn(r: float) -> float:
        return sum(f / (1.0 + r) ** (n + 1) for n, f in enumerate(flujos)) - capital

    lo, hi = 1e-9, 1.0
    if vpn(lo) < 0:
        return None  # no cubre ni el capital: no hay tasa positiva
    for _ in range(200):
        mid = (lo + hi) / 2
        if vpn(mid) > 0:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


# ─── Persistencia ───────────────────────────────────────────────────────────
# Tablas propias en la misma base del Libro Mayor (app/data/contabilidad.db),
# prefijadas `cc_prestamo*`. El asiento de cada operación lo crea
# `contabilidad_core`; acá solo se guarda el vínculo (movimiento_id) para poder
# navegar del cronograma al asiento y viceversa.

import json
import os
import re
import sqlite3
from contextlib import contextmanager

_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "contabilidad.db")
_initialized = False

ESTADOS_PRESTAMO = ("vigente", "pagado", "anulado")
ESTADOS_CUOTA = ("pendiente", "solicitada", "pagada")


@contextmanager
def _conn():
    con = sqlite3.connect(_DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def init_db() -> None:
    global _initialized
    if _initialized:
        return
    import app.services.contabilidad_core as cc

    cc.init_db()  # plan de cuentas, terceros y medios de pago viven allá
    with _conn() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS cc_prestamos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tercero_id INTEGER NOT NULL REFERENCES cc_terceros(id),
            capital REAL NOT NULL,
            tasa_ea REAL NOT NULL,
            plazo_meses INTEGER NOT NULL,
            meses_tramo1 INTEGER NOT NULL,
            pct_capital_tramo1 REAL NOT NULL,
            retencion_pct REAL NOT NULL,
            gross_up INTEGER NOT NULL DEFAULT 0,
            fecha_desembolso TEXT NOT NULL,
            dia_pago INTEGER,
            medio_pago_id INTEGER REFERENCES cc_medios_pago(id),
            estado TEXT NOT NULL DEFAULT 'vigente',
            movimiento_desembolso_id INTEGER REFERENCES cc_movimientos(id),
            referencia TEXT NOT NULL DEFAULT '',
            notas TEXT NOT NULL DEFAULT '',
            created_by INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS cc_prestamo_cuotas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            prestamo_id INTEGER NOT NULL REFERENCES cc_prestamos(id) ON DELETE CASCADE,
            numero INTEGER NOT NULL,
            fecha_vencimiento TEXT NOT NULL,
            saldo_inicial REAL NOT NULL,
            interes_bruto REAL NOT NULL,
            retencion REAL NOT NULL,
            interes_girado REAL NOT NULL,
            abono_capital REAL NOT NULL,
            cuota_causada REAL NOT NULL,
            cuota_girada REAL NOT NULL,
            saldo_final REAL NOT NULL,
            estado TEXT NOT NULL DEFAULT 'pendiente',
            fecha_pago TEXT NOT NULL DEFAULT '',
            movimiento_id INTEGER REFERENCES cc_movimientos(id),
            ticket_id INTEGER,
            UNIQUE (prestamo_id, numero)
        );

        CREATE INDEX IF NOT EXISTS idx_cc_prestamo_cuotas_prestamo
            ON cc_prestamo_cuotas(prestamo_id);
        CREATE INDEX IF NOT EXISTS idx_cc_prestamo_cuotas_venc
            ON cc_prestamo_cuotas(fecha_vencimiento, estado);
        CREATE INDEX IF NOT EXISTS idx_cc_prestamos_tercero
            ON cc_prestamos(tercero_id);
        """)
        _migrar_doc_soporte(con)
    _initialized = True


def _migrar_doc_soporte(con: sqlite3.Connection) -> None:
    """Columnas del documento soporte a la DIAN por los intereses. Idempotente
    (mismo patrón que contabilidad_core._migrar_columnas_v3)."""
    cols = {r["name"] for r in con.execute("PRAGMA table_info(cc_prestamo_cuotas)")}
    for col, defn in (
        ("doc_soporte_estado", "TEXT NOT NULL DEFAULT ''"),
        ("doc_soporte_id", "TEXT NOT NULL DEFAULT ''"),
        ("doc_soporte_numero", "TEXT NOT NULL DEFAULT ''"),
    ):
        if col not in cols:
            con.execute(f"ALTER TABLE cc_prestamo_cuotas ADD COLUMN {col} {defn}")


def _ensure() -> None:
    if not _initialized:
        init_db()


def _cuenta_pasivo_codigo(tercero: dict) -> str:
    """Misma convención que contabilidad_core: 2380 para socios, 2295 terceros."""
    return "2380" if (tercero or {}).get("tipo") == "socio" else "2295"


def crear_prestamo(payload: dict, created_by: int | None = None) -> dict:
    """Registra un préstamo recibido: guarda condiciones, genera el cronograma
    completo y crea el asiento de desembolso (débito banco / crédito 2295-2380).

    payload: tercero_id, capital, medio_pago_id, fecha_desembolso, y opcionales
    tasa_ea, plazo_meses, meses_tramo1, pct_capital_tramo1, retencion_pct,
    gross_up, dia_pago, referencia, notas.
    """
    _ensure()
    import app.services.contabilidad_core as cc

    tercero_id = int(payload.get("tercero_id") or 0)
    capital = round(float(payload.get("capital") or 0), 2)
    medio_pago_id = int(payload.get("medio_pago_id") or 0)
    fecha = str(payload.get("fecha_desembolso") or "").strip()[:10]
    if not tercero_id or capital <= 0 or not medio_pago_id or not fecha:
        raise ValueError("tercero_id, capital, medio_pago_id y fecha_desembolso son requeridos")

    tercero = cc.obtener_tercero(tercero_id)
    if not tercero:
        raise ValueError("Tercero no encontrado")
    # El documento que se le envía lleva nombre, cédula y correo: sin eso no se
    # puede emitir, y descubrirlo al final (con el préstamo ya desembolsado) es
    # peor que bloquearlo acá.
    faltan = [
        etiqueta
        for campo, etiqueta in (("identificacion", "cédula/NIT"), ("email", "correo"))
        if not str(tercero.get(campo) or "").strip()
    ]
    if faltan:
        raise ValueError(
            f"El tercero «{tercero['nombre']}» no tiene {' ni '.join(faltan)}. "
            "Complétalo en Contabilidad → Terceros antes de registrar el préstamo."
        )

    tasa_ea = float(payload.get("tasa_ea", TASA_EA_DEFAULT))
    plazo = int(payload.get("plazo_meses", PLAZO_MESES_DEFAULT))
    meses_tramo1 = int(payload.get("meses_tramo1", MESES_TRAMO1_DEFAULT))
    pct_tramo1 = float(payload.get("pct_capital_tramo1", PCT_CAPITAL_TRAMO1_DEFAULT))
    ret_pct = float(payload.get("retencion_pct", RETENCION_RENDIMIENTOS_PCT))
    gross_up = bool(payload.get("gross_up"))
    dia_pago = int(payload.get("dia_pago") or 0) or None
    referencia = str(payload.get("referencia") or "").strip()
    notas = str(payload.get("notas") or "").strip()

    # Valida parámetros y calcula antes de tocar la base o la contabilidad
    crono = calcular_cronograma(
        capital,
        tasa_ea=tasa_ea,
        plazo_meses=plazo,
        meses_tramo1=meses_tramo1,
        pct_capital_tramo1=pct_tramo1,
        retencion_pct=ret_pct,
        gross_up=gross_up,
        fecha_desembolso=fecha,
        dia_pago=dia_pago,
    )

    mov = cc.registrar_prestamo_recibido(
        {
            "fecha": fecha,
            "tercero_id": tercero_id,
            "monto": capital,
            "medio_pago_id": medio_pago_id,
            "referencia": referencia,
            "concepto": f"{plazo} cuotas al {tasa_ea * 100:.2f}% E.A.",
            "tasa_interes_pct": round(tasa_ea * 100, 4),
            "plazo_meses": plazo,
        },
        created_by=created_by,
    )

    with _conn() as con:
        cur = con.execute(
            """INSERT INTO cc_prestamos
                 (tercero_id, capital, tasa_ea, plazo_meses, meses_tramo1,
                  pct_capital_tramo1, retencion_pct, gross_up, fecha_desembolso,
                  dia_pago, medio_pago_id, estado, movimiento_desembolso_id,
                  referencia, notas, created_by)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,'vigente',?,?,?,?)""",
            (
                tercero_id, capital, tasa_ea, plazo, meses_tramo1, pct_tramo1,
                ret_pct, 1 if gross_up else 0, fecha, dia_pago, medio_pago_id,
                mov.get("id"), referencia, notas, created_by,
            ),
        )
        prestamo_id = int(cur.lastrowid)
        con.executemany(
            """INSERT INTO cc_prestamo_cuotas
                 (prestamo_id, numero, fecha_vencimiento, saldo_inicial,
                  interes_bruto, retencion, interes_girado, abono_capital,
                  cuota_causada, cuota_girada, saldo_final)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            [
                (
                    prestamo_id, c["numero"], c["fecha"], c["saldo_inicial"],
                    c["interes_bruto"], c["retencion"], c["interes_girado"],
                    c["abono_capital"], c["cuota_causada"], c["cuota_girada"],
                    c["saldo_final"],
                )
                for c in crono["cuotas"]
            ],
        )
    return obtener_prestamo(prestamo_id)


def _fila_prestamo(con: sqlite3.Connection, row: sqlite3.Row) -> dict:
    p = dict(row)
    p["gross_up"] = bool(p.get("gross_up"))
    tercero = con.execute(
        "SELECT id, nombre, tipo, tipo_persona, identificacion, email, telefono,"
        " cuenta_bancaria, obligado_a_facturar FROM cc_terceros WHERE id=?",
        (p["tercero_id"],),
    ).fetchone()
    p["tercero"] = dict(tercero) if tercero else None
    agg = con.execute(
        """SELECT
             COUNT(*) AS n,
             SUM(CASE WHEN estado='pagada' THEN 1 ELSE 0 END) AS pagadas,
             SUM(CASE WHEN estado='pagada' THEN abono_capital ELSE 0 END) AS capital_pagado,
             SUM(CASE WHEN estado='pagada' THEN interes_bruto ELSE 0 END) AS interes_pagado,
             SUM(CASE WHEN estado='pagada' THEN retencion ELSE 0 END) AS retencion_practicada,
             SUM(interes_bruto) AS interes_total,
             SUM(retencion) AS retencion_total
           FROM cc_prestamo_cuotas WHERE prestamo_id=?""",
        (p["id"],),
    ).fetchone()
    capital_pagado = round(float(agg["capital_pagado"] or 0), 2)
    interes_total = round(float(agg["interes_total"] or 0), 2)
    docs = con.execute(
        """SELECT doc_soporte_estado AS estado, COUNT(*) AS n
             FROM cc_prestamo_cuotas WHERE prestamo_id=? GROUP BY doc_soporte_estado""",
        (p["id"],),
    ).fetchall()
    p["doc_soporte"] = {(r["estado"] or "pendiente"): int(r["n"]) for r in docs}
    p["resumen"] = {
        "cuotas": int(agg["n"] or 0),
        "cuotas_pagadas": int(agg["pagadas"] or 0),
        "capital_pagado": capital_pagado,
        "capital_pendiente": round(p["capital"] - capital_pagado, 2),
        "interes_pagado": round(float(agg["interes_pagado"] or 0), 2),
        "interes_total": interes_total,
        "retencion_practicada": round(float(agg["retencion_practicada"] or 0), 2),
        "retencion_total": round(float(agg["retencion_total"] or 0), 2),
        # Las tres cifras del contrato, recalculadas sobre lo efectivamente guardado
        "rendimiento_bruto_pct": round(interes_total / p["capital"] * 100, 4) if p["capital"] else 0,
        "rendimiento_neto_pct": round(
            (interes_total - float(agg["retencion_total"] or 0)) / p["capital"] * 100, 4
        ) if p["capital"] else 0,
        "tasa_mensual_pct": round(tasa_mensual_desde_ea(p["tasa_ea"]) * 100, 4),
    }
    return p


def listar_prestamos(estado: str | None = None) -> list[dict]:
    _ensure()
    with _conn() as con:
        sql = "SELECT * FROM cc_prestamos"
        params: list = []
        if estado:
            sql += " WHERE estado=?"
            params.append(estado)
        sql += " ORDER BY fecha_desembolso DESC, id DESC"
        return [_fila_prestamo(con, r) for r in con.execute(sql, params)]


def obtener_prestamo(prestamo_id: int) -> dict | None:
    _ensure()
    with _conn() as con:
        row = con.execute("SELECT * FROM cc_prestamos WHERE id=?", (prestamo_id,)).fetchone()
        if not row:
            return None
        p = _fila_prestamo(con, row)
        p["cuotas"] = [
            dict(c)
            for c in con.execute(
                "SELECT * FROM cc_prestamo_cuotas WHERE prestamo_id=? ORDER BY numero",
                (prestamo_id,),
            )
        ]
    return p


def registrar_pago_cuota(
    prestamo_id: int, numero: int, payload: dict | None = None, created_by: int | None = None
) -> dict:
    """Paga una cuota del cronograma y deja el asiento correspondiente.

    El asiento separa las tres cosas que la cuota mezcla, y es donde queda
    explícito quién asume la retención:

        Débito  2295/2380  abono a capital          (baja el pasivo)
        Débito  5305       interés bruto            (gasto de McKenna)
        Crédito 2365       retención practicada     (pasivo con la DIAN)
        Crédito banco      cuota girada             (lo que recibe el prestamista)

    Con `gross_up` el interés bruto se le gira completo y McKenna asume además
    la retención, así que el gasto financiero es interés + retención.

    payload: fecha (default el vencimiento), medio_pago_id (default el del
    préstamo), referencia.
    """
    _ensure()
    import app.services.contabilidad_core as cc

    payload = payload or {}
    prestamo = obtener_prestamo(prestamo_id)
    if not prestamo:
        raise ValueError("Préstamo no encontrado")
    if prestamo["estado"] == "anulado":
        raise ValueError("El préstamo está anulado")

    cuota = next((c for c in prestamo["cuotas"] if c["numero"] == int(numero)), None)
    if not cuota:
        raise ValueError(f"El préstamo no tiene cuota {numero}")
    if cuota["estado"] == "pagada":
        raise ValueError(f"La cuota {numero} ya está pagada")
    # Pagar la 7 dejando pendiente la 3 descuadraría el saldo del cronograma
    # frente al saldo real del pasivo. Se paga en orden.
    anterior = next(
        (c for c in prestamo["cuotas"] if c["numero"] < int(numero) and c["estado"] != "pagada"),
        None,
    )
    if anterior:
        raise ValueError(
            f"Falta pagar la cuota {anterior['numero']} (vence {anterior['fecha_vencimiento']}). "
            "Las cuotas se pagan en orden."
        )

    fecha = str(payload.get("fecha") or "").strip()[:10] or cuota["fecha_vencimiento"]
    medio_pago_id = int(payload.get("medio_pago_id") or prestamo["medio_pago_id"] or 0)
    if not medio_pago_id:
        raise ValueError("medio_pago_id requerido")
    medio = cc.obtener_medio_pago(medio_pago_id)
    if not medio:
        raise ValueError("Medio de pago no encontrado")

    tercero = prestamo["tercero"] or {}
    with cc._conn() as con:
        cuenta_pasivo_id = con.execute(
            "SELECT cuenta_por_pagar_id FROM cc_terceros WHERE id=?", (prestamo["tercero_id"],)
        ).fetchone()["cuenta_por_pagar_id"] or cc._cuenta_id_por_codigo(
            con, _cuenta_pasivo_codigo(tercero)
        )
        cuenta_gasto_id = cc._cuenta_id_por_codigo(con, "5305")
        cuenta_ret_id = cc._cuenta_id_por_codigo(con, "2365")
    if not cuenta_pasivo_id or not cuenta_gasto_id:
        raise ValueError("Faltan cuentas en el plan (pasivo del préstamo o 5305 gastos financieros)")

    capital = round(float(cuota["abono_capital"]), 2)
    interes_bruto = round(float(cuota["interes_bruto"]), 2)
    retencion = round(float(cuota["retencion"]), 2)
    girado = round(float(cuota["cuota_girada"]), 2)
    gasto_financiero = round(interes_bruto + (retencion if prestamo["gross_up"] else 0), 2)

    if retencion > 0 and not cuenta_ret_id:
        raise ValueError("Falta la cuenta 2365 (Retención en la fuente por pagar) en el plan")

    nombre = tercero.get("nombre") or "prestamista"
    lineas = [
        {
            "cuenta_id": cuenta_pasivo_id,
            "debito": capital,
            "credito": 0,
            "tercero_id": prestamo["tercero_id"],
            "descripcion": f"Abono a capital cuota {numero}/{prestamo['plazo_meses']}",
        },
        {
            "cuenta_id": cuenta_gasto_id,
            "debito": gasto_financiero,
            "credito": 0,
            "tercero_id": prestamo["tercero_id"],
            "descripcion": (
                f"Intereses cuota {numero}/{prestamo['plazo_meses']} "
                f"({prestamo['tasa_ea'] * 100:.2f}% E.A.)"
                + (" incl. retención asumida (gross-up)" if prestamo["gross_up"] else "")
            ),
        },
    ]
    if retencion > 0:
        lineas.append(
            {
                "cuenta_id": cuenta_ret_id,
                "debito": 0,
                "credito": retencion,
                "tercero_id": prestamo["tercero_id"],
                "descripcion": f"Retención rendimientos financieros {prestamo['retencion_pct'] * 100:.0f}%",
            }
        )
    lineas.append(
        {
            "cuenta_id": medio["cuenta_id"],
            "debito": 0,
            "credito": girado,
            "descripcion": f"Giro a {nombre} vía {medio['nombre']}",
        }
    )

    mov = cc.crear_movimiento(
        fecha=fecha,
        concepto=f"Cuota {numero}/{prestamo['plazo_meses']} préstamo de {nombre}",
        lineas=lineas,
        tercero_id=prestamo["tercero_id"],
        referencia=str(payload.get("referencia") or f"PREST-{prestamo_id}-{numero:02d}"),
        tipo_origen="abono_prestamo_recibido",
        plantilla_datos={
            "prestamo_id": prestamo_id,
            "cuota": numero,
            "capital": capital,
            "interes_bruto": interes_bruto,
            "retencion": retencion,
            "girado": girado,
        },
        created_by=created_by,
    )

    with _conn() as con:
        con.execute(
            "UPDATE cc_prestamo_cuotas SET estado='pagada', fecha_pago=?, movimiento_id=?"
            " WHERE prestamo_id=? AND numero=?",
            (fecha, mov.get("id"), prestamo_id, int(numero)),
        )
        pendientes = con.execute(
            "SELECT COUNT(*) AS n FROM cc_prestamo_cuotas WHERE prestamo_id=? AND estado<>'pagada'",
            (prestamo_id,),
        ).fetchone()["n"]
        if not pendientes:
            con.execute("UPDATE cc_prestamos SET estado='pagado' WHERE id=?", (prestamo_id,))

    # Documento soporte por los intereses (DIAN Concepto 000112 int 7 de 2024).
    # Nunca tumba el pago: el asiento ya quedó y es la verdad contable; si el
    # documento falla se reintenta desde el panel. Al revés — perder el asiento
    # por un error de red con Alegra — sí sería grave.
    try:
        emitir_documento_soporte_cuota(prestamo_id, int(numero))
    except Exception as e:
        print(f"⚠️ Préstamo {prestamo_id} cuota {numero}: documento soporte no emitido: {e}", flush=True)

    return obtener_prestamo(prestamo_id)


def cuotas_del_mes(anio: int, mes: int, incluir_pagadas: bool = False) -> list[dict]:
    """Cuotas que vencen en un mes, de todos los préstamos vigentes.

    Es la fuente del recordatorio mensual único a despachos: un solo ticket con
    todo lo que hay que montar en el banco ese mes, en vez de uno por préstamo.
    """
    _ensure()
    desde = f"{int(anio):04d}-{int(mes):02d}-01"
    hasta = f"{int(anio):04d}-{int(mes):02d}-{calendar.monthrange(int(anio), int(mes))[1]:02d}"
    sql = """
        SELECT q.*, p.tercero_id, p.plazo_meses, p.gross_up, p.retencion_pct,
               t.nombre AS tercero_nombre, t.identificacion, t.email,
               t.cuenta_bancaria, t.tipo_persona
          FROM cc_prestamo_cuotas q
          JOIN cc_prestamos p ON p.id = q.prestamo_id
          JOIN cc_terceros  t ON t.id = p.tercero_id
         WHERE p.estado = 'vigente'
           AND q.fecha_vencimiento BETWEEN ? AND ?
    """
    if not incluir_pagadas:
        sql += " AND q.estado <> 'pagada'"
    sql += " ORDER BY q.fecha_vencimiento, t.nombre"
    with _conn() as con:
        return [dict(r) for r in con.execute(sql, (desde, hasta))]


# ─── Recordatorio mensual a despachos ───────────────────────────────────────
# Un solo ticket al mes, el día configurado, con TODAS las cuotas que vencen
# ese mes de todos los préstamos vigentes. Un ticket por préstamo obligaría a
# despachos a abrir N tickets para montar N transferencias en la misma sesión
# de Sucursal Negocios.

# Username del panel que monta los pagos en el banco (Jenniffer García).
USUARIO_PAGOS_DEFAULT = "jerry"
DIA_RECORDATORIO_DEFAULT = 5

# Marca en la descripción para deduplicar el ticket del mes sin depender del
# título (que un operador puede editar). Mismo patrón que
# tickets_db.SYS_SYNC_FALTANTES_PACKS_JSON_PREFIX.
MARCA_TICKET = "SYS_PRESTAMOS_PAGOS_MES:"


def _fmt_cop(n: float) -> str:
    return "$" + f"{round(float(n or 0)):,}".replace(",", ".")


def _usuario_id_por_username(db_path: str, username: str) -> int | None:
    try:
        db = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row
        row = db.execute(
            "SELECT id FROM usuarios WHERE username=? AND activo=1", (username,)
        ).fetchone()
        return int(row["id"]) if row else None
    except Exception:
        return None
    finally:
        try:
            db.close()
        except Exception:
            pass


def _ticket_del_mes_existe(db_path: str, marca_completa: str) -> int | None:
    """`marca_completa` es la marca YA armada con su período, p.ej.
    "SYS_PRESTAMOS_PAGOS_MES: 2026-10" — hay dos marcas distintas (pagos y
    retenciones) y cada caller arma la suya."""
    try:
        db = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row
        row = db.execute(
            "SELECT id FROM tickets WHERE descripcion LIKE ? ORDER BY id DESC LIMIT 1",
            (f"%{marca_completa}%",),
        ).fetchone()
        return int(row["id"]) if row else None
    except Exception:
        return None
    finally:
        try:
            db.close()
        except Exception:
            pass


def crear_recordatorio_pagos_mes(
    anio: int, mes: int, *, usuario_username: str | None = None, dry_run: bool = False
) -> dict:
    """Crea el ticket mensual con las cuotas de préstamos a pagar en el mes.

    Idempotente: si ya existe el ticket de ese período no crea otro. Si no hay
    cuotas pendientes no crea nada (un ticket vacío cada mes entrena a la gente
    a ignorarlos).
    """
    _ensure()
    from app.services import tickets_db as _tdb

    periodo = f"{int(anio):04d}-{int(mes):02d}"
    cuotas = cuotas_del_mes(anio, mes)
    if not cuotas:
        return {"ok": True, "creado": False, "motivo": "sin cuotas pendientes", "periodo": periodo}

    _tdb.init_db()
    existente = _ticket_del_mes_existe(_tdb.DB_PATH, f"{MARCA_TICKET} {periodo}")
    if existente:
        return {
            "ok": True, "creado": False, "motivo": "ya existe",
            "ticket_id": existente, "periodo": periodo, "cuotas": len(cuotas),
        }

    username = (usuario_username or os.getenv("PRESTAMOS_USUARIO_PAGOS") or USUARIO_PAGOS_DEFAULT).strip()
    asignado_a = _usuario_id_por_username(_tdb.DB_PATH, username)
    creador_id = _usuario_id_por_username(_tdb.DB_PATH, "admin") or asignado_a
    if not creador_id:
        return {"ok": False, "creado": False, "error": "No hay usuario admin/activo para crear el ticket"}

    total_girar = sum(float(c["cuota_girada"]) for c in cuotas)
    total_retencion = sum(float(c["retencion"]) for c in cuotas)

    filas = []
    for c in cuotas:
        filas.append(
            f"- **{c['tercero_nombre']}** (CC/NIT {c['identificacion'] or '—'}) — "
            f"cuota {c['numero']}/{c['plazo_meses']}, vence {c['fecha_vencimiento']}\n"
            f"  - Cuenta: {c['cuenta_bancaria'] or '⚠️ sin cuenta registrada'}\n"
            f"  - **Girar: {_fmt_cop(c['cuota_girada'])}** "
            f"(capital {_fmt_cop(c['abono_capital'])} + interés neto {_fmt_cop(c['interes_girado'])})\n"
            f"  - Retención practicada: {_fmt_cop(c['retencion'])} — NO se le gira, va a la DIAN"
        )

    descripcion = (
        f"Pagos de préstamos a terceros del período **{periodo}**.\n\n"
        f"Montar en Sucursal Negocios **{len(cuotas)} transferencia(s)** por un total de "
        f"**{_fmt_cop(total_girar)}**.\n\n"
        + "\n".join(filas)
        + "\n\n**Importante:** el valor a girar ya viene con la retención en la fuente del 7% "
        "descontada (rendimientos financieros). Ese descuento lo asume el prestamista y McKenna "
        f"lo consigna a la DIAN — total retenido este mes: {_fmt_cop(total_retencion)}.\n\n"
        "Al terminar, **comenta en este ticket** confirmando qué se giró (fecha y "
        "referencia de cada transferencia). Con eso, quien lleva el Libro Mayor marca "
        "las cuotas como pagadas y queda el asiento contable.\n\n"
        f"{MARCA_TICKET} {periodo}"
    )

    if dry_run:
        return {
            "ok": True, "creado": False, "dry_run": True, "periodo": periodo,
            "cuotas": len(cuotas), "total_girar": round(total_girar, 2),
            "asignado_a": asignado_a, "descripcion": descripcion,
        }

    ticket, err = _tdb.crear_ticket(
        {
            "tipo": "solicitud",
            "titulo": f"Pagos de préstamos — {periodo}",
            "categoria": "contabilidad",
            "descripcion": descripcion,
            "prioridad": "alta",
            "asignado_a": asignado_a,
        },
        creador_id,
        None,
    )
    if err:
        return {"ok": False, "creado": False, "error": err, "periodo": periodo}

    ticket_id = ticket.get("id")
    with _conn() as con:
        con.executemany(
            "UPDATE cc_prestamo_cuotas SET ticket_id=?, estado='solicitada'"
            " WHERE id=? AND estado='pendiente'",
            [(ticket_id, c["id"]) for c in cuotas],
        )
    return {
        "ok": True, "creado": True, "ticket_id": ticket_id, "periodo": periodo,
        "cuotas": len(cuotas), "total_girar": round(total_girar, 2), "asignado_a": asignado_a,
    }


# ─── Documentos y envío al prestamista ──────────────────────────────────────

TIPOS_DOCUMENTO = ("contrato", "certificado")


def generar_documento(prestamo_id: int, tipo: str = "contrato", corte: str | None = None) -> dict:
    """Genera el PDF del préstamo y devuelve {"ruta", "nombre", "tipo"}.

    Generar es siempre seguro (no sale nada de la empresa); el envío al tercero
    es un paso aparte y explícito — ver `enviar_documento`.
    """
    _ensure()
    from app.tools import prestamos_pdf as _pdf

    tipo = (tipo or "contrato").strip().lower()
    if tipo not in TIPOS_DOCUMENTO:
        raise ValueError(f"tipo debe ser uno de: {', '.join(TIPOS_DOCUMENTO)}")
    prestamo = obtener_prestamo(prestamo_id)
    if not prestamo:
        raise ValueError("Préstamo no encontrado")

    if tipo == "contrato":
        ruta = _pdf.generar_pdf_contrato(prestamo)
    else:
        ruta = _pdf.generar_pdf_certificado(prestamo, corte=corte)
    return {
        "ruta": ruta,
        "nombre": os.path.basename(ruta),
        "tipo": tipo,
        "numero": _pdf.numero_documento(prestamo, tipo),
    }


def enviar_documento(
    prestamo_id: int, tipo: str = "contrato", corte: str | None = None, destinatario: str | None = None
) -> dict:
    """Envía el PDF al correo del prestamista.

    Se dispara SIEMPRE desde una acción explícita del panel, nunca como efecto
    secundario de registrar un préstamo o un pago: es correspondencia
    financiera hacia un tercero, y un documento equivocado ya enviado no se
    puede recoger.
    """
    _ensure()
    from app.tools import prestamos_pdf as _pdf
    from app.tools import correo_marca as _marca
    from app.tools.web_pedidos import _send_smtp_with_attachments, _smtp_ready

    prestamo = obtener_prestamo(prestamo_id)
    if not prestamo:
        raise ValueError("Préstamo no encontrado")
    tercero = prestamo.get("tercero") or {}
    correo = (destinatario or tercero.get("email") or "").strip()
    if not correo:
        raise ValueError(f"El tercero «{tercero.get('nombre', '')}» no tiene correo registrado")
    if not _smtp_ready():
        raise ValueError("SMTP no configurado (SMTP_HOST / SMTP_USER / SMTP_PASSWORD / EMAIL_FROM)")

    doc = generar_documento(prestamo_id, tipo, corte=corte)
    with open(doc["ruta"], "rb") as fh:
        contenido = fh.read()

    r = prestamo["resumen"]
    nombre = tercero.get("nombre") or ""
    if tipo == "contrato":
        asunto = f"Contrato de préstamo {doc['numero']} — McKenna Group S.A.S."
        intro = (
            f"Adjuntamos el contrato de mutuo por {_fmt_cop(prestamo['capital'])}, "
            f"pactado a {prestamo['plazo_meses']} cuotas mensuales a la tasa de "
            f"{prestamo['tasa_ea'] * 100:.2f}% efectivo anual, junto con el cronograma completo."
        )
        detalle = [
            ("Capital", _fmt_cop(prestamo["capital"])),
            ("Tasa pactada", f"{prestamo['tasa_ea'] * 100:.2f}% E.A."),
            ("Rendimiento bruto del plazo", f"{_fmt_cop(r['interes_total'])} ({r['rendimiento_bruto_pct']:.2f}%)"),
            ("Retención en la fuente (7%)", f"− {_fmt_cop(r['retencion_total'])}"),
            ("Rendimiento neto a girar", f"{_fmt_cop(r['interes_total'] - r['retencion_total'])}"),
        ]
    else:
        asunto = f"Estado de su préstamo {doc['numero']} — McKenna Group S.A.S."
        intro = (
            f"Adjuntamos el certificado de estado de su préstamo a corte de "
            f"{corte or date.today().isoformat()}."
        )
        detalle = [
            ("Cuotas pagadas", f"{r['cuotas_pagadas']} de {r['cuotas']}"),
            ("Capital pendiente", _fmt_cop(r["capital_pendiente"])),
            ("Intereses pagados (brutos)", _fmt_cop(r["interes_pagado"])),
            ("Retención practicada", _fmt_cop(r["retencion_practicada"])),
        ]

    nota_ret = (
        "La retención en la fuente del 7% sobre rendimientos financieros la practica McKenna "
        "Group S.A.S. como agente retenedor y se consigna a la DIAN a su nombre; no es un cobro "
        "nuestro sino un anticipo de su impuesto de renta, y cada año le expedimos el certificado "
        "para que lo descuente."
    )
    texto = (
        f"Cordial saludo, {nombre}.\n\n{intro}\n\n"
        + "\n".join(f"- {k}: {v}" for k, v in detalle)
        + f"\n\n{nota_ret}\n\nCualquier inquietud, quedamos atentos.\n\n"
        + _marca.firma_texto()
    )
    filas_html = "".join(
        f'<tr><td style="padding:7px 12px 7px 0;color:{_marca.TENUE};font-size:14px;">{k}</td>'
        f'<td style="padding:7px 0;text-align:right;color:{_marca.VERDE_PROFUNDO};font-weight:600;">{v}</td></tr>'
        for k, v in detalle
    )
    inner = (
        f"<p style=\"margin:0 0 14px 0;\">Cordial saludo, <strong>{nombre}</strong>.</p>"
        f"<p style=\"margin:0 0 4px 0;\">{intro}</p>"
        f'<table role="presentation" style="border-collapse:collapse;margin:14px 0 18px 0;width:100%;'
        f'border-top:1px solid rgba(12,96,105,0.18);border-bottom:1px solid rgba(12,96,105,0.18);">'
        f"{filas_html}</table>"
        f'<p style="margin:0 0 14px 0;font-size:13px;color:{_marca.TENUE};line-height:1.7;">{nota_ret}</p>'
        f'<p style="margin:0;">Cualquier inquietud, quedamos atentos.</p>'
        f"{_marca.firma_html()}"
    )
    html = _marca.marco(preheader=asunto, inner_html=inner)

    enviado = _send_smtp_with_attachments(
        correo, asunto, texto, html, [(doc["nombre"], "application/pdf", contenido)]
    )
    if not enviado:
        raise ValueError("Falló el envío SMTP (revisa credenciales y red)")
    return {"ok": True, "destinatario": correo, "documento": doc["nombre"], "numero": doc["numero"]}


def estado_alegra(prestamo_id: int) -> dict:
    """Si el prestamista ya está inscrito como contacto en Alegra.

    Consulta de solo lectura: NO crea el contacto. Se crea recién cuando haya
    que emitirle un documento en Alegra, no por abrir la pantalla.
    """
    _ensure()
    from app.services.alegra import consultar_contacto_alegra

    prestamo = obtener_prestamo(prestamo_id)
    if not prestamo:
        raise ValueError("Préstamo no encontrado")
    tercero = prestamo.get("tercero") or {}
    tipo_doc = "NIT" if (tercero.get("tipo_persona") == "juridica") else "CC"
    return consultar_contacto_alegra(tercero.get("identificacion") or "", tipo_doc)


# ─── Documento soporte a la DIAN por los intereses ──────────────────────────
# Base legal: DIAN, Concepto 000112 (int 7) del 09-01-2024.
#
#   - Por el CAPITAL (desembolso y sus abonos): NO se emite documento soporte.
#     El mutuo no es venta de bienes ni prestación de servicios, así que no hay
#     obligación de facturar. Se respalda con el contrato de mutuo firmado y el
#     comprobante de la transferencia — que es justo lo que produce este módulo.
#   - Por los INTERESES pagados a una persona natural NO obligada a facturar:
#     SÍ se emite documento soporte electrónico. Son un gasto financiero que
#     McKenna va a deducir, y sin el documento transmitido a la DIAN la
#     deducción no procede.
#   - Si el prestamista es persona jurídica, entidad financiera u obligado a
#     facturar: NO se emite. Es ÉL quien debe expedir factura electrónica por
#     los intereses (o, si es banco, el extracto es el soporte válido).
#
# Por eso el documento se emite por el interés BRUTO de cada cuota, nunca por
# la cuota completa: el abono a capital no es gasto, es baja de pasivo.

# Cuenta contable de Alegra para la línea del documento soporte. Los intereses
# de un mutuo son gasto financiero, no un producto: por eso va cuenta y no ítem
# (ver alegra.crear_documento_soporte_alegra).
CUENTA_ALEGRA_INTERESES_DEFAULT = "5252"   # Gastos por Intereses financieros


def _doc_soporte_activo() -> bool:
    """Modo sombra por defecto. No es duda legal (el Concepto 000112 de 2024 la
    resolvió), sino que un documento soporte emitido ya viajó a la DIAN y solo
    se corrige con nota de ajuste: no se prende sin que alguien lo decida y sin
    que exista el ítem de intereses en Alegra."""
    return (os.getenv("PRESTAMOS_DOC_SOPORTE_ACTIVO", "0") or "0").strip() == "1"


def _cuenta_alegra_intereses() -> str:
    return (os.getenv("PRESTAMOS_ALEGRA_CUENTA", "") or CUENTA_ALEGRA_INTERESES_DEFAULT).strip()


def requiere_documento_soporte(tercero: dict) -> tuple[bool, str]:
    """Si los intereses pagados a este prestamista necesitan documento soporte.

    Devuelve (requiere, motivo) — el motivo se guarda y se muestra en el panel
    para que quede trazable por qué un préstamo no generó documento.
    """
    tipo_persona = (tercero or {}).get("tipo_persona") or ""
    if str((tercero or {}).get("obligado_a_facturar") or "0") == "1":
        return False, "El prestamista está marcado como obligado a facturar: debe expedir él la factura por los intereses."
    if tipo_persona == "juridica":
        return False, "Prestamista persona jurídica: debe expedir él la factura electrónica por los intereses."
    if tipo_persona != "natural":
        return False, "Falta definir si el prestamista es persona natural o jurídica (Contabilidad → Terceros)."
    return True, "Persona natural no obligada a facturar: McKenna emite el documento soporte por los intereses."


def emitir_documento_soporte_cuota(prestamo_id: int, numero: int, forzar: bool = False) -> dict:
    """Emite (o simula) el documento soporte por los intereses de una cuota.

    Idempotente: si la cuota ya tiene documento emitido no crea otro — un
    duplicado en la DIAN se corrige con nota de ajuste, no borrando.
    """
    _ensure()
    from app.services.alegra import crear_documento_soporte_alegra

    prestamo = obtener_prestamo(prestamo_id)
    if not prestamo:
        raise ValueError("Préstamo no encontrado")
    cuota = next((c for c in prestamo["cuotas"] if c["numero"] == int(numero)), None)
    if not cuota:
        raise ValueError(f"El préstamo no tiene cuota {numero}")
    if cuota.get("doc_soporte_id") and not forzar:
        return {
            "status": "ya_emitido",
            "id": cuota["doc_soporte_id"],
            "numero": cuota.get("doc_soporte_numero") or "",
        }

    tercero = prestamo.get("tercero") or {}
    requiere, motivo = requiere_documento_soporte(tercero)
    if not requiere:
        with _conn() as con:
            con.execute(
                "UPDATE cc_prestamo_cuotas SET doc_soporte_estado=? WHERE prestamo_id=? AND numero=?",
                ("no_aplica", prestamo_id, int(numero)),
            )
        return {"status": "no_aplica", "motivo": motivo}

    interes_bruto = round(float(cuota["interes_bruto"]), 2)
    if interes_bruto <= 0:
        return {"status": "no_aplica", "motivo": "La cuota no tiene intereses."}

    retencion_cuota = round(float(cuota["retencion"] or 0), 2)
    dry = not _doc_soporte_activo()
    r = crear_documento_soporte_alegra(
        identificacion=tercero.get("identificacion") or "",
        nombre=tercero.get("nombre") or "",
        email=tercero.get("email") or "",
        fecha=cuota.get("fecha_pago") or cuota["fecha_vencimiento"],
        valor=interes_bruto,
        descripcion=(
            f"Intereses de mutuo — cuota {numero}/{prestamo['plazo_meses']}, "
            f"{prestamo['tasa_ea'] * 100:.2f}% E.A."
        ),
        cuenta_contable=_cuenta_alegra_intereses(),
        retencion=(
            {
                "concepto": "rendimientos_financieros",
                "tarifa_pct": round(prestamo["retencion_pct"] * 100, 2),
                "retencion": retencion_cuota,
            }
            if retencion_cuota > 0
            else None
        ),
        observaciones=(
            f"Documento soporte por intereses del préstamo #{prestamo_id} "
            f"({tercero.get('nombre', '')}, CC {tercero.get('identificacion', '')}). "
            f"Capital no facturable (contrato de mutuo, Concepto DIAN 000112 int 7 de 2024)."
        ),
        dry_run=dry,
    )

    estado = {"success": "emitido", "dry_run": "sombra", "error": "error"}.get(r.get("status"), "error")
    with _conn() as con:
        con.execute(
            "UPDATE cc_prestamo_cuotas SET doc_soporte_estado=?, doc_soporte_id=?, doc_soporte_numero=?"
            " WHERE prestamo_id=? AND numero=?",
            (estado, r.get("id") or "", r.get("numero") or "", prestamo_id, int(numero)),
        )
    return {**r, "estado": estado, "motivo": motivo, "valor": interes_bruto}


# ─── Declaración mensual de retención en la fuente ──────────────────────────
# La retención que se practica en cada cuota se acredita a 2365 y queda como
# deuda con la DIAN hasta que se declara y se paga. El módulo no declara (eso
# lo hace el contador en el portal de la DIAN); lo que hace es que nadie se
# entere tarde: reúne lo practicado en el mes y lo pone en un ticket con el
# detalle listo para el formulario 350.
#
# NO se codifica el calendario tributario: los vencimientos de retención van por
# el último dígito del NIT y cambian cada año por decreto. El módulo avisa
# temprano en el mes siguiente y deja que el contador ponga la fecha exacta.

MARCA_TICKET_RETENCIONES = "SYS_PRESTAMOS_RETENCIONES_MES:"
DIA_AVISO_RETENCIONES_DEFAULT = 3


def resumen_retenciones_mes(anio: int, mes: int) -> dict:
    """Retención practicada sobre intereses de préstamos en un mes.

    Detalle por prestamista (lo que necesita el formulario 350) y, como cifra
    de control, el movimiento de la cuenta 2365 en el mismo período: si no
    coinciden es que hay retenciones de otro origen o un asiento manual, y eso
    hay que mirarlo antes de declarar.
    """
    _ensure()
    desde = f"{int(anio):04d}-{int(mes):02d}-01"
    hasta = f"{int(anio):04d}-{int(mes):02d}-{calendar.monthrange(int(anio), int(mes))[1]:02d}"

    with _conn() as con:
        filas = [
            dict(r)
            for r in con.execute(
                """
                SELECT t.nombre AS tercero_nombre, t.identificacion, t.tipo_persona,
                       q.numero, q.fecha_pago, q.interes_bruto, q.retencion,
                       q.doc_soporte_estado, q.doc_soporte_numero,
                       p.id AS prestamo_id, p.plazo_meses, p.retencion_pct
                  FROM cc_prestamo_cuotas q
                  JOIN cc_prestamos p ON p.id = q.prestamo_id
                  JOIN cc_terceros  t ON t.id = p.tercero_id
                 WHERE q.estado = 'pagada'
                   AND q.retencion > 0
                   AND q.fecha_pago BETWEEN ? AND ?
                 ORDER BY t.nombre, q.numero
                """,
                (desde, hasta),
            )
        ]

    # Por tercero, que es como se reporta
    por_tercero: dict[str, dict] = {}
    for f in filas:
        k = f["identificacion"] or f["tercero_nombre"]
        acc = por_tercero.setdefault(
            k,
            {
                "nombre": f["tercero_nombre"],
                "identificacion": f["identificacion"],
                "tipo_persona": f["tipo_persona"],
                "base": 0.0,
                "retencion": 0.0,
                "cuotas": [],
            },
        )
        acc["base"] += float(f["interes_bruto"] or 0)
        acc["retencion"] += float(f["retencion"] or 0)
        acc["cuotas"].append(
            {
                "prestamo_id": f["prestamo_id"],
                "numero": f["numero"],
                "plazo_meses": f["plazo_meses"],
                "fecha_pago": f["fecha_pago"],
                "doc_soporte_estado": f["doc_soporte_estado"],
                "doc_soporte_numero": f["doc_soporte_numero"],
            }
        )
    for acc in por_tercero.values():
        acc["base"] = round(acc["base"], 2)
        acc["retencion"] = round(acc["retencion"], 2)

    # Cifra de control: movimiento de 2365 en el período
    control_2365 = 0.0
    try:
        import app.services.contabilidad_core as cc

        with cc._conn() as con:
            row = con.execute(
                """
                SELECT COALESCE(SUM(l.credito - l.debito), 0) AS saldo
                  FROM cc_movimiento_lineas l
                  JOIN cc_movimientos m ON m.id = l.movimiento_id
                  JOIN cc_plan_cuentas c ON c.id = l.cuenta_id
                 WHERE c.codigo = '2365'
                   AND m.estado <> 'anulado'
                   AND m.fecha BETWEEN ? AND ?
                """,
                (desde, hasta),
            ).fetchone()
            control_2365 = round(float(row["saldo"] or 0), 2)
    except Exception:
        control_2365 = 0.0

    total = round(sum(a["retencion"] for a in por_tercero.values()), 2)
    base_total = round(sum(a["base"] for a in por_tercero.values()), 2)
    # Documentos soporte que aún no llegaron a la DIAN: declarar la retención
    # con el soporte pendiente deja el gasto expuesto en una revisión.
    sin_doc = [
        c
        for a in por_tercero.values()
        for c in a["cuotas"]
        if a["tipo_persona"] == "natural" and c["doc_soporte_estado"] not in ("emitido", "no_aplica")
    ]
    try:
        from app.services.calendario_tributario import info_vencimiento_retencion

        vencimiento = info_vencimiento_retencion(int(anio), int(mes))
    except Exception:
        vencimiento = {"conocido": False, "estado": "desconocido", "motivo": "Calendario no disponible."}

    return {
        "periodo": f"{int(anio):04d}-{int(mes):02d}",
        "desde": desde,
        "hasta": hasta,
        "vencimiento": vencimiento,
        "terceros": sorted(por_tercero.values(), key=lambda a: -a["retencion"]),
        "base_total": base_total,
        "total_retencion": total,
        "pagos": len(filas),
        "control_2365": control_2365,
        "cuadra_con_libro": abs(control_2365 - total) < 1,
        "documentos_soporte_pendientes": len(sin_doc),
    }


def _texto_vencimiento(resumen: dict) -> str:
    """Bloque de vencimiento para el ticket. Si el año no está en el calendario
    lo dice explícitamente en vez de callar — quien lea el ticket tiene que
    saber que la fecha no está confirmada."""
    v = resumen.get("vencimiento") or {}
    if not v.get("conocido"):
        return (
            "⚠️ **Fecha de vencimiento no confirmada.** "
            + str(v.get("motivo") or "El sistema no tiene el calendario de este año.")
            + "\n\n"
        )
    dias = v.get("dias_restantes", 0)
    if v["estado"] == "vencido":
        urgencia = f"🔴 **VENCIÓ hace {abs(dias)} día(s).** Hay sanción por extemporaneidad e intereses de mora."
    elif v["estado"] == "hoy":
        urgencia = "🔴 **VENCE HOY.**"
    elif v["estado"] == "proximo":
        urgencia = f"🟠 **Quedan {dias} día(s).**"
    else:
        urgencia = f"🟢 Quedan {dias} día(s)."
    return (
        f"**Vence: {v['fecha']}** (NIT {v['nit']}, último dígito {v['ultimo_digito']}). "
        f"{urgencia}\n_{v.get('fuente', '')}_\n\n"
    )


def crear_ticket_retenciones_mes(anio: int, mes: int, *, dry_run: bool = False) -> dict:
    """Ticket con la retención practicada en el mes, para que se declare.

    Idempotente por período. Si no se practicó ninguna retención no crea nada:
    un ticket vacío cada mes entrena a la gente a ignorar la bandeja.
    """
    _ensure()
    from app.services import tickets_db as _tdb

    from app.services.retenciones import resumen_periodo

    r = resumen_retenciones_mes(anio, mes)          # detalle de préstamos
    unificado = resumen_periodo(anio, mes)          # TODOS los conceptos (cuenta 2365)
    periodo = r["periodo"]
    # Se condiciona al total UNIFICADO, no al de préstamos: un mes con retención
    # solo por compras a socios también hay que declararlo, y gatear por
    # préstamos lo dejaba pasar en silencio (bug detectado el 2026-09-10 con el
    # período 2026-08, que tenía $96.251 de compras y 0 de préstamos).
    if unificado["total_retencion"] <= 0:
        return {"ok": True, "creado": False, "motivo": "sin retenciones practicadas", "periodo": periodo}
    # El vencimiento sale del resumen unificado, que ya lo trae calculado
    r["vencimiento"] = unificado["vencimiento"]

    _tdb.init_db()
    existente = _ticket_del_mes_existe(_tdb.DB_PATH, f"{MARCA_TICKET_RETENCIONES} {periodo}")
    if existente:
        return {"ok": True, "creado": False, "motivo": "ya existe", "ticket_id": existente, "periodo": periodo}

    username = (os.getenv("PRESTAMOS_USUARIO_CONTABILIDAD") or "").strip()
    asignado_a = _usuario_id_por_username(_tdb.DB_PATH, username) if username else None
    if not asignado_a:
        try:
            asignado_a = (
                _tdb.get_aliados_asignaciones()
                .get(_tdb.TAREA_PRESTAMOS_DECLARAR_RETENCIONES, {})
                .get("usuario_id")
            )
        except Exception:
            asignado_a = None
    creador_id = _usuario_id_por_username(_tdb.DB_PATH, "admin") or asignado_a
    if not creador_id:
        return {"ok": False, "creado": False, "error": "No hay usuario admin/activo para crear el ticket"}

    filas = []
    for a in r["terceros"]:
        cuotas = ", ".join(f"#{c['prestamo_id']} cuota {c['numero']}/{c['plazo_meses']}" for c in a["cuotas"])
        filas.append(
            f"- **{a['nombre']}** — CC/NIT {a['identificacion'] or '—'}\n"
            f"  - Base (intereses brutos pagados): {_fmt_cop(a['base'])}\n"
            f"  - **Retención practicada: {_fmt_cop(a['retencion'])}**\n"
            f"  - Origen: {cuotas}"
        )

    # Otros conceptos del mismo período (compras a socios, servicios…). El
    # contador declara TODO junto en el formulario 350, así que un ticket que
    # solo hable de préstamos lo llevaría a declarar de menos.
    otros_texto = ""
    try:
        from app.services.retenciones import resumen_periodo

        todos = resumen_periodo(anio, mes)
        otros = [t for t in todos["terceros"] if t["concepto"] != "rendimientos_financieros"]
        if otros:
            lineas_otros = [
                f"- **{t['tercero']}** — CC/NIT {t['identificacion'] or '—'} · "
                f"{t['concepto'].replace('_', ' ')} ({t['norma']}): "
                f"**{_fmt_cop(t['retencion'])}**"
                for t in otros
            ]
            otros_texto = (
                "\n\n**Otros conceptos del mismo período** (van en la misma declaración):\n"
                + "\n".join(lineas_otros)
            )
    except Exception as e:
        otros_texto = f"\n\n⚠️ No se pudieron leer los otros conceptos del período: {e}"

    avisos = []
    # El cuadre se hace contra el DETALLE por tercero del resumen unificado, no
    # contra el de préstamos: un período con retención solo por compras cuadra
    # perfectamente aunque los préstamos sumen cero.
    detalle_sumado = round(sum(t["retencion"] for t in unificado["terceros"]), 2)
    if abs(detalle_sumado - unificado["total_retencion"]) >= 1:
        avisos.append(
            f"⚠️ **No cuadra.** La cuenta 2365 movió "
            f"{_fmt_cop(unificado['total_retencion'])} pero el detalle por tercero suma "
            f"{_fmt_cop(detalle_sumado)} — revisar antes de declarar."
        )
    if unificado.get("sin_tercero"):
        avisos.append(
            f"⚠️ **{unificado['sin_tercero']} retención(es) sin tercero identificado.** "
            "El formulario 350 va por beneficiario: hay que asignarles el tercero en el Libro Mayor."
        )
    if r["documentos_soporte_pendientes"]:
        avisos.append(
            f"⚠️ **{r['documentos_soporte_pendientes']} documento(s) soporte sin emitir a la DIAN.** "
            "Declarar la retención con el soporte pendiente deja el gasto por intereses expuesto en "
            "una revisión. Ver el panel de Préstamos."
        )

    conceptos_txt = ", ".join(
        f"{c.replace('_', ' ')} {_fmt_cop(v)}" for c, v in sorted(unificado["por_concepto"].items())
    )
    encabezado_prestamos = (
        f"**Intereses de préstamos:** {_fmt_cop(r['total_retencion'])} sobre una base de "
        f"{_fmt_cop(r['base_total'])} en {r['pagos']} pago(s) — rendimientos financieros "
        f"(Art. 395 E.T.).\n\n" + "\n".join(filas)
        if r["total_retencion"] > 0
        else "_Este período no tuvo retención por intereses de préstamos._"
    )
    descripcion = (
        f"Retención en la fuente practicada en **{periodo}**, para la declaración "
        f"mensual (formulario 350).\n\n"
        f"**TOTAL A DECLARAR Y PAGAR: {_fmt_cop(unificado['total_retencion'])}**\n\n"
        f"Por concepto: {conceptos_txt}\n\n"
        + encabezado_prestamos
        + otros_texto
        + "\n\n"
        + ("\n\n".join(avisos) + "\n\n" if avisos else "")
        + _texto_vencimiento(r)
        + "**Qué hay que hacer:**\n"
        "- Pasarle este detalle al contador para incluirlo en la declaración mensual de retención "
        "en la fuente.\n"
        "- Al pagar, comentar acá la fecha y el comprobante: quien lleva el Libro Mayor "
        "registra el egreso contra 2365 para que deje de figurar como deuda con la DIAN.\n\n"
        f"{MARCA_TICKET_RETENCIONES} {periodo}"
    )

    if dry_run:
        return {"ok": True, "creado": False, "dry_run": True, "periodo": periodo,
                "resumen": r, "descripcion": descripcion, "asignado_a": asignado_a}

    ticket, err = _tdb.crear_ticket(
        {
            "tipo": "solicitud",
            # Sin "préstamos" en el título: el ticket cubre TODOS los conceptos
            # del período (compras a socios, servicios, intereses).
            "titulo": (
                f"Declarar retención en la fuente — {periodo}"
                + (f" (vence {r['vencimiento']['fecha']})" if r["vencimiento"].get("conocido") else "")
            ),
            "categoria": "contabilidad",
            "descripcion": descripcion,
            # El esquema de tickets admite baja|media|alta|urgente — no "critica".
            "prioridad": (
                "urgente"
                if r["vencimiento"].get("estado") in ("vencido", "hoy", "proximo")
                else "alta"
            ),
            "asignado_a": asignado_a,
        },
        creador_id,
        None,
    )
    if err:
        return {"ok": False, "creado": False, "error": err, "periodo": periodo}
    return {
        "ok": True, "creado": True, "ticket_id": ticket.get("id"), "periodo": periodo,
        # Del resumen UNIFICADO: el de préstamos daría 0 en un mes de solo compras
        "total_retencion": unificado["total_retencion"],
        "terceros": len(unificado["terceros"]),
        "por_concepto": unificado["por_concepto"],
    }


# ─── Alta de prestamistas ───────────────────────────────────────────────────
# Un prestamista es un `cc_tercero` con requisitos más estrictos que el resto:
# sin cédula, correo y cuenta bancaria no se le puede emitir el contrato, ni
# girarle la cuota, ni decidir si lleva documento soporte. Se valida acá, al
# darlo de alta, y no cuando ya hay plata desembolsada.

CAMPOS_PRESTAMISTA = (
    "nombre", "identificacion", "tipo_persona", "email", "telefono",
    "cuenta_bancaria", "obligado_a_facturar", "notas",
)


def _validar_datos_prestamista(payload: dict, *, parcial: bool = False) -> dict:
    """Normaliza y valida. `parcial=True` para actualizaciones (solo revisa lo
    que venga en el payload)."""
    datos: dict = {}
    if not parcial or "nombre" in payload:
        nombre = str(payload.get("nombre") or "").strip()
        if not nombre:
            raise ValueError("El nombre del prestamista es obligatorio.")
        datos["nombre"] = nombre
    if not parcial or "identificacion" in payload:
        ident = re.sub(r"[^\dA-Za-z-]", "", str(payload.get("identificacion") or "")).strip()
        if not re.sub(r"\D", "", ident):
            raise ValueError("La cédula/NIT es obligatoria: va en el contrato y en el documento soporte.")
        datos["identificacion"] = ident
    if not parcial or "email" in payload:
        email = str(payload.get("email") or "").strip()
        # Validación deliberadamente laxa: exige estructura mínima (algo@algo.algo,
        # sin espacios) y nada más. Un patrón estricto rechaza direcciones válidas
        # raras, y el costo de eso —no poder registrar al prestamista— es peor que
        # el de dejar pasar un correo mal escrito, que se ve al primer envío.
        if not re.fullmatch(r"[^@\s]+@[^@\s.]+(\.[^@\s.]+)+", email):
            raise ValueError(
                "El correo es obligatorio y debe tener forma de correo: ahí llegan "
                "el contrato y los reportes."
            )
        datos["email"] = email
    if not parcial or "tipo_persona" in payload:
        tp = str(payload.get("tipo_persona") or "").strip()
        if tp not in ("natural", "juridica"):
            raise ValueError(
                "Indica si es persona natural o jurídica: de eso depende quién emite el "
                "documento soporte por los intereses."
            )
        datos["tipo_persona"] = tp
    for campo in ("telefono", "cuenta_bancaria", "notas"):
        if campo in payload:
            datos[campo] = str(payload.get(campo) or "").strip()
    if "obligado_a_facturar" in payload:
        datos["obligado_a_facturar"] = 1 if payload.get("obligado_a_facturar") else 0
    return datos


def _set_obligado_a_facturar(tercero_id: int, valor: int) -> None:
    """Columna propia del módulo, fuera del `actualizar_tercero` genérico."""
    with _conn() as con:
        con.execute(
            "UPDATE cc_terceros SET obligado_a_facturar=? WHERE id=?", (int(valor), int(tercero_id))
        )


def sincronizar_prestamista_alegra(tercero_id: int, crear_si_falta: bool = True) -> dict:
    """Deja al prestamista inscrito como contacto en Alegra.

    Se llama explícitamente (al darlo de alta o con el botón del panel), nunca
    al solo abrir una pantalla: crear contactos por navegar ensucia el
    directorio de Alegra con terceros que quizá nunca reciban un documento.
    """
    _ensure()
    import app.services.contabilidad_core as cc
    from app.services.alegra import (
        _resolver_o_crear_proveedor_persona_natural_alegra,
        consultar_contacto_alegra,
    )

    tercero = cc.obtener_tercero(int(tercero_id))
    if not tercero:
        raise ValueError("Tercero no encontrado")
    ident = str(tercero.get("identificacion") or "").strip()
    if not ident:
        raise ValueError("El tercero no tiene cédula/NIT: no se puede inscribir en Alegra.")

    tipo_doc = "NIT" if tercero.get("tipo_persona") == "juridica" else "CC"
    estado = consultar_contacto_alegra(ident, tipo_doc)
    if estado.get("existe"):
        return {"ok": True, "creado": False, **estado}
    if estado.get("error"):
        return {"ok": False, "creado": False, **estado}
    if not crear_si_falta:
        return {"ok": True, "creado": False, **estado}

    contacto_id, err = _resolver_o_crear_proveedor_persona_natural_alegra(
        identificacion=ident,
        nombre=str(tercero.get("nombre") or ""),
        email=str(tercero.get("email") or ""),
    )
    if not contacto_id:
        return {"ok": False, "creado": False, "existe": False, "id": None, "error": err}
    return {
        "ok": True, "creado": True, "existe": True, "id": contacto_id,
        "nombre": tercero.get("nombre") or "", "email": tercero.get("email") or "",
        "identificacion": ident, "error": "",
    }


def crear_prestamista(payload: dict, *, inscribir_en_alegra: bool = True) -> dict:
    """Da de alta un prestamista y, si se pide, lo inscribe en Alegra.

    Si ya existe un tercero con esa identificación **no lo duplica**: completa
    los datos que falten y lo devuelve. Duplicar terceros parte el histórico de
    saldos por tercero y descuadra `resumen_prestamos()`.
    """
    _ensure()
    import app.services.contabilidad_core as cc

    datos = _validar_datos_prestamista(payload)
    ident_digits = re.sub(r"\D", "", datos["identificacion"])

    existente = None
    with _conn() as con:
        for row in con.execute(
            "SELECT * FROM cc_terceros WHERE activo=1 AND identificacion<>''"
        ):
            if re.sub(r"\D", "", str(row["identificacion"] or "")) == ident_digits:
                existente = dict(row)
                break

    obligado = datos.pop("obligado_a_facturar", None)
    if existente:
        cc.actualizar_tercero(existente["id"], {k: v for k, v in datos.items() if v})
        tercero_id = existente["id"]
        reutilizado = True
    else:
        tercero = cc.crear_tercero({**datos, "tipo": str(payload.get("tipo") or "otro")})
        tercero_id = tercero["id"]
        reutilizado = False
    if obligado is not None:
        _set_obligado_a_facturar(tercero_id, obligado)

    alegra = {"ok": True, "creado": False, "existe": False, "error": "No se intentó."}
    if inscribir_en_alegra:
        try:
            alegra = sincronizar_prestamista_alegra(tercero_id)
        except Exception as e:
            # Que Alegra falle no debe perder el tercero ya creado: se reintenta
            # desde el panel con el botón "Inscribir en Alegra".
            alegra = {"ok": False, "creado": False, "existe": False, "error": str(e)}

    tercero = cc.obtener_tercero(tercero_id) or {}
    requiere, motivo = requiere_documento_soporte(tercero)
    return {
        "ok": True,
        "tercero": tercero,
        "reutilizado": reutilizado,
        "alegra": alegra,
        "documento_soporte": {"requiere": requiere, "motivo": motivo},
    }


def actualizar_prestamista(tercero_id: int, payload: dict) -> dict:
    """Edita los datos de contacto/bancarios de un prestamista ya creado."""
    _ensure()
    import app.services.contabilidad_core as cc

    datos = _validar_datos_prestamista(payload, parcial=True)
    obligado = datos.pop("obligado_a_facturar", None)
    if datos:
        cc.actualizar_tercero(int(tercero_id), datos)
    if obligado is not None:
        _set_obligado_a_facturar(int(tercero_id), obligado)
    tercero = cc.obtener_tercero(int(tercero_id)) or {}
    requiere, motivo = requiere_documento_soporte(tercero)
    return {"ok": True, "tercero": tercero, "documento_soporte": {"requiere": requiere, "motivo": motivo}}


def enviar_reporte_mensual(prestamo_id: int, anio: int, mes: int, destinatario: str | None = None) -> dict:
    """Reporte del mes al prestamista: qué se le giró y cómo va el préstamo.

    Adjunta el certificado de estado a la fecha de corte, para que tenga el
    soporte y no solo el texto del correo. Como todo envío a un tercero, se
    dispara desde una acción explícita (botón del panel o el cron mensual con
    su flag), nunca como efecto colateral de registrar un pago.
    """
    _ensure()
    from app.tools import prestamos_pdf as _pdf
    from app.tools import correo_marca as _marca
    from app.tools.web_pedidos import _send_smtp_with_attachments, _smtp_ready

    prestamo = obtener_prestamo(prestamo_id)
    if not prestamo:
        raise ValueError("Préstamo no encontrado")
    tercero = prestamo.get("tercero") or {}
    correo = (destinatario or tercero.get("email") or "").strip()
    if not correo:
        raise ValueError(f"El prestamista «{tercero.get('nombre', '')}» no tiene correo registrado")
    if not _smtp_ready():
        raise ValueError("SMTP no configurado (SMTP_HOST / SMTP_USER / SMTP_PASSWORD / EMAIL_FROM)")

    desde = f"{int(anio):04d}-{int(mes):02d}-01"
    hasta = f"{int(anio):04d}-{int(mes):02d}-{calendar.monthrange(int(anio), int(mes))[1]:02d}"
    del_mes = [
        c for c in prestamo["cuotas"]
        if c["estado"] == "pagada" and desde <= (c["fecha_pago"] or "") <= hasta
    ]
    if not del_mes:
        return {"ok": False, "enviado": False, "motivo": f"No hubo desembolsos en {desde[:7]}."}

    corte = max(c["fecha_pago"] for c in del_mes)
    ruta = _pdf.generar_pdf_certificado(prestamo, corte=corte)
    with open(ruta, "rb") as fh:
        contenido = fh.read()

    r = prestamo["resumen"]
    girado = sum(float(c["cuota_girada"]) for c in del_mes)
    capital = sum(float(c["abono_capital"]) for c in del_mes)
    interes = sum(float(c["interes_bruto"]) for c in del_mes)
    retencion = sum(float(c["retencion"]) for c in del_mes)
    nums = ", ".join(f"{c['numero']}/{prestamo['plazo_meses']}" for c in del_mes)
    periodo = f"{int(mes):02d}/{int(anio)}"

    detalle = [
        (f"Cuota(s) del período {periodo}", nums),
        ("Abono a capital", _fmt_cop(capital)),
        ("Intereses del período (brutos)", _fmt_cop(interes)),
        (f"(−) Retención en la fuente {prestamo['retencion_pct'] * 100:.0f}%", f"− {_fmt_cop(retencion)}"),
        ("Total consignado", _fmt_cop(girado)),
        ("Saldo de capital pendiente", _fmt_cop(r["capital_pendiente"])),
        ("Cuotas pagadas", f"{r['cuotas_pagadas']} de {r['cuotas']}"),
    ]
    nombre = tercero.get("nombre") or ""
    nota_ret = (
        f"La retención en la fuente sobre rendimientos financieros la practica {_pdf.MCKENNA_RAZON} "
        "como agente retenedor y se consigna a la DIAN a su nombre; cada año le expedimos el "
        "certificado para que la impute en su declaración de renta."
    )
    texto = (
        f"Cordial saludo, {nombre}.\n\n"
        f"Le informamos el movimiento de su préstamo en el período {periodo}.\n\n"
        + "\n".join(f"- {k}: {v}" for k, v in detalle)
        + f"\n\nAdjuntamos el certificado de estado del préstamo a corte de {corte}.\n\n"
        + f"{nota_ret}\n\nCualquier inquietud, quedamos atentos.\n\n"
        + _marca.firma_texto()
    )
    filas = "".join(
        f'<tr><td style="padding:7px 12px 7px 0;color:{_marca.TENUE};font-size:14px;">{k}</td>'
        f'<td style="padding:7px 0;text-align:right;color:{_marca.VERDE_PROFUNDO};font-weight:600;">{v}</td></tr>'
        for k, v in detalle
    )
    inner = (
        f"<p style=\"margin:0 0 14px 0;\">Cordial saludo, <strong>{nombre}</strong>.</p>"
        f"<p style=\"margin:0 0 4px 0;\">Le informamos el movimiento de su préstamo en el período "
        f"<strong>{periodo}</strong>.</p>"
        f'<table role="presentation" style="border-collapse:collapse;margin:14px 0 18px 0;width:100%;'
        f'border-top:1px solid rgba(12,96,105,0.18);border-bottom:1px solid rgba(12,96,105,0.18);">{filas}</table>'
        f'<p style="margin:0 0 14px 0;font-size:13px;color:{_marca.TENUE};line-height:1.7;">'
        f"Adjuntamos el certificado de estado a corte de {corte}. {nota_ret}</p>"
        f'<p style="margin:0;">Cualquier inquietud, quedamos atentos.</p>'
        f"{_marca.firma_html()}"
    )
    html = _marca.marco(preheader=f"Movimiento de su préstamo — {periodo}", inner_html=inner)
    enviado = _send_smtp_with_attachments(
        correo, f"Su préstamo — movimiento de {periodo}", texto, html,
        [(os.path.basename(ruta), "application/pdf", contenido)],
    )
    if not enviado:
        raise ValueError("Falló el envío SMTP (revisa credenciales y red)")
    return {
        "ok": True, "enviado": True, "destinatario": correo, "periodo": f"{anio:04d}-{mes:02d}",
        "cuotas": [c["numero"] for c in del_mes], "girado": round(girado, 2),
    }
