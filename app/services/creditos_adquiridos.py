"""Créditos adquiridos (pasivo): préstamos, leasing, crédito proveedor.

Cálculo de cuota (sistema francés / alemán / solo interés), tabla de
amortización y bitácora de pagos. Persistencia en contabilidad.db.
"""
from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta
from typing import Any

from app.services.contabilidad_db import _conn, _ensure

TIPOS = (
    "prestamo_bancario",
    "credito_rotativo",
    "leasing",
    "credito_proveedor",
    "tarjeta",
    "socio",
    "otro",
)
TIPOS_TASA = ("EA", "NA_MV")
SISTEMAS = ("frances", "aleman", "interes_solo")
PERIODICIDADES = ("mensual", "quincenal", "trimestral")
ESTADOS = ("activo", "pagado", "en_mora", "cancelado")

_TIPO_LABEL = {
    "prestamo_bancario": "Préstamo bancario",
    "credito_rotativo": "Crédito rotativo",
    "leasing": "Leasing",
    "credito_proveedor": "Crédito de proveedor",
    "tarjeta": "Tarjeta empresarial",
    "socio": "Préstamo de socio",
    "otro": "Otro",
}


def ensure_creditos_tables() -> None:
    _ensure()
    with _conn() as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS creditos_adquiridos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL,
                acreedor TEXT NOT NULL DEFAULT '',
                tipo TEXT NOT NULL DEFAULT 'prestamo_bancario',
                numero_contrato TEXT NOT NULL DEFAULT '',
                monto_original REAL NOT NULL,
                tasa_anual_pct REAL NOT NULL DEFAULT 0,
                tipo_tasa TEXT NOT NULL DEFAULT 'EA',
                sistema TEXT NOT NULL DEFAULT 'frances',
                plazo_meses INTEGER NOT NULL,
                periodicidad TEXT NOT NULL DEFAULT 'mensual',
                cuota_pactada REAL,
                seguro_cuota REAL NOT NULL DEFAULT 0,
                fecha_desembolso TEXT NOT NULL DEFAULT '',
                fecha_primera_cuota TEXT NOT NULL DEFAULT '',
                dia_pago INTEGER,
                garantia TEXT NOT NULL DEFAULT '',
                estado TEXT NOT NULL DEFAULT 'activo',
                notas TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS creditos_pagos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                credito_id INTEGER NOT NULL
                    REFERENCES creditos_adquiridos(id) ON DELETE CASCADE,
                fecha TEXT NOT NULL,
                monto REAL NOT NULL,
                capital REAL NOT NULL DEFAULT 0,
                intereses REAL NOT NULL DEFAULT 0,
                extras REAL NOT NULL DEFAULT 0,
                numero_cuota INTEGER,
                notas TEXT NOT NULL DEFAULT '',
                comprobante TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_creditos_pagos_credito
                ON creditos_pagos(credito_id, fecha);
            """
        )


def periodos_por_anio(periodicidad: str) -> int:
    p = (periodicidad or "mensual").strip().lower()
    if p == "quincenal":
        return 24
    if p == "trimestral":
        return 4
    return 12


def n_cuotas(plazo_meses: int, periodicidad: str) -> int:
    meses = max(1, int(plazo_meses or 1))
    ppy = periodos_por_anio(periodicidad)
    return max(1, int(round(meses * ppy / 12.0)))


def tasa_periodo(tasa_anual_pct: float, tipo_tasa: str, periodicidad: str) -> float:
    """Tasa efectiva por periodo (decimal). EA = efectiva anual; NA_MV = nominal anual."""
    anual = max(0.0, float(tasa_anual_pct or 0)) / 100.0
    ppy = periodos_por_anio(periodicidad)
    tipo = (tipo_tasa or "EA").strip().upper().replace(".", "_")
    if anual <= 0:
        return 0.0
    if tipo in ("NA_MV", "NA", "NAMV", "NOMINAL"):
        return anual / ppy
    # Efectiva anual → efectiva del periodo
    return (1.0 + anual) ** (1.0 / ppy) - 1.0


def calcular_cuota(
    monto: float,
    tasa_anual_pct: float,
    plazo_meses: int,
    *,
    tipo_tasa: str = "EA",
    sistema: str = "frances",
    periodicidad: str = "mensual",
) -> float:
    """Cuota de capital+interés (sin seguro). Primera cuota en alemán/interés."""
    p = float(monto or 0)
    if p <= 0:
        return 0.0
    n = n_cuotas(plazo_meses, periodicidad)
    r = tasa_periodo(tasa_anual_pct, tipo_tasa, periodicidad)
    sis = (sistema or "frances").strip().lower()
    if sis == "aleman":
        capital = p / n
        return round(capital + p * r, 2)
    if sis == "interes_solo":
        return round(p * r, 2) if r > 0 else 0.0
    if r <= 0:
        return round(p / n, 2)
    factor = (1.0 + r) ** n
    return round(p * r * factor / (factor - 1.0), 2)


def tabla_amortizacion(
    monto: float,
    tasa_anual_pct: float,
    plazo_meses: int,
    *,
    tipo_tasa: str = "EA",
    sistema: str = "frances",
    periodicidad: str = "mensual",
    cuota_pactada: float | None = None,
    seguro_cuota: float = 0.0,
    fecha_primera: str = "",
) -> list[dict[str, Any]]:
    p = float(monto or 0)
    if p <= 0:
        return []
    n = n_cuotas(plazo_meses, periodicidad)
    r = tasa_periodo(tasa_anual_pct, tipo_tasa, periodicidad)
    sis = (sistema or "frances").strip().lower()
    seguro = max(0.0, float(seguro_cuota or 0))
    cuota_fija = float(cuota_pactada) if cuota_pactada and float(cuota_pactada) > 0 else None
    if cuota_fija is None and sis == "frances":
        cuota_fija = calcular_cuota(
            p, tasa_anual_pct, plazo_meses,
            tipo_tasa=tipo_tasa, sistema="frances", periodicidad=periodicidad,
        )
    saldo = p
    capital_fijo = p / n if sis == "aleman" else 0.0
    fecha0 = _parse_fecha(fecha_primera)
    rows: list[dict[str, Any]] = []
    for k in range(1, n + 1):
        interes = round(saldo * r, 2)
        if sis == "aleman":
            capital = round(saldo if k == n else capital_fijo, 2)
            cuota = round(capital + interes, 2)
        elif sis == "interes_solo":
            if k == n:
                capital = round(saldo, 2)
                cuota = round(capital + interes, 2)
            else:
                capital = 0.0
                cuota = round(interes, 2)
        else:
            cuota_base = cuota_fija or 0.0
            capital = round(cuota_base - interes, 2)
            if k == n or capital > saldo:
                capital = round(saldo, 2)
            if capital < 0:
                capital = 0.0
            cuota = round(capital + interes, 2)
        saldo = round(max(0.0, saldo - capital), 2)
        fecha_k = _fecha_cuota(fecha0, k - 1, periodicidad) if fecha0 else ""
        rows.append(
            {
                "numero": k,
                "fecha": fecha_k,
                "capital": capital,
                "intereses": interes,
                "seguro": round(seguro, 2),
                "cuota": round(cuota + seguro, 2),
                "saldo": saldo,
            }
        )
    return rows


def simular(payload: dict[str, Any]) -> dict[str, Any]:
    monto = float(payload.get("monto_original") or payload.get("monto") or 0)
    tasa = float(payload.get("tasa_anual_pct") or 0)
    plazo = int(payload.get("plazo_meses") or 0)
    tipo_tasa = str(payload.get("tipo_tasa") or "EA")
    sistema = str(payload.get("sistema") or "frances")
    periodicidad = str(payload.get("periodicidad") or "mensual")
    cuota_pactada = payload.get("cuota_pactada")
    cuota_p = float(cuota_pactada) if cuota_pactada not in (None, "", 0, "0") else None
    seguro = float(payload.get("seguro_cuota") or 0)
    tabla = tabla_amortizacion(
        monto, tasa, plazo,
        tipo_tasa=tipo_tasa, sistema=sistema, periodicidad=periodicidad,
        cuota_pactada=cuota_p, seguro_cuota=seguro,
        fecha_primera=str(payload.get("fecha_primera_cuota") or ""),
    )
    cuota = tabla[0]["cuota"] if tabla else 0.0
    total = round(sum(r["cuota"] for r in tabla), 2)
    intereses = round(sum(r["intereses"] for r in tabla), 2)
    return {
        "cuota": cuota,
        "n_cuotas": len(tabla),
        "total_pagar": total,
        "total_intereses": intereses,
        "tasa_periodo_pct": round(tasa_periodo(tasa, tipo_tasa, periodicidad) * 100, 6),
        "tabla": tabla,
    }


def listar_creditos() -> list[dict[str, Any]]:
    ensure_creditos_tables()
    with _conn() as con:
        rows = con.execute(
            "SELECT * FROM creditos_adquiridos ORDER BY estado ASC, fecha_desembolso DESC, id DESC"
        ).fetchall()
        pagos_por = _pagos_agrupados(con)
    return [_enriquecer(dict(r), pagos_por.get(int(r["id"]), [])) for r in rows]


def obtener_credito(credito_id: int, *, con_tabla: bool = True) -> dict[str, Any] | None:
    ensure_creditos_tables()
    with _conn() as con:
        row = con.execute(
            "SELECT * FROM creditos_adquiridos WHERE id = ?", (int(credito_id),)
        ).fetchone()
        if not row:
            return None
        pagos = [
            dict(p)
            for p in con.execute(
                "SELECT * FROM creditos_pagos WHERE credito_id = ? ORDER BY fecha DESC, id DESC",
                (int(credito_id),),
            ).fetchall()
        ]
    data = _enriquecer(dict(row), pagos)
    if con_tabla:
        data["tabla"] = tabla_amortizacion(
            float(data["monto_original"]),
            float(data["tasa_anual_pct"]),
            int(data["plazo_meses"]),
            tipo_tasa=data["tipo_tasa"],
            sistema=data["sistema"],
            periodicidad=data["periodicidad"],
            cuota_pactada=data.get("cuota_pactada"),
            seguro_cuota=float(data.get("seguro_cuota") or 0),
            fecha_primera=str(data.get("fecha_primera_cuota") or ""),
        )
    data["pagos"] = pagos
    return data


def crear_credito(payload: dict[str, Any]) -> dict[str, Any]:
    campos = _validar_payload(payload, creando=True)
    ensure_creditos_tables()
    with _conn() as con:
        cur = con.execute(
            """
            INSERT INTO creditos_adquiridos (
                nombre, acreedor, tipo, numero_contrato, monto_original,
                tasa_anual_pct, tipo_tasa, sistema, plazo_meses, periodicidad,
                cuota_pactada, seguro_cuota, fecha_desembolso, fecha_primera_cuota,
                dia_pago, garantia, estado, notas
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                campos["nombre"], campos["acreedor"], campos["tipo"],
                campos["numero_contrato"], campos["monto_original"],
                campos["tasa_anual_pct"], campos["tipo_tasa"], campos["sistema"],
                campos["plazo_meses"], campos["periodicidad"],
                campos["cuota_pactada"], campos["seguro_cuota"],
                campos["fecha_desembolso"], campos["fecha_primera_cuota"],
                campos["dia_pago"], campos["garantia"], campos["estado"],
                campos["notas"],
            ),
        )
        new_id = int(cur.lastrowid)
    return obtener_credito(new_id, con_tabla=False) or {"id": new_id}


def actualizar_credito(credito_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    ensure_creditos_tables()
    existente = obtener_credito(credito_id, con_tabla=False)
    if not existente:
        raise KeyError("crédito no encontrado")
    merged = {**existente, **payload}
    campos = _validar_payload(merged, creando=False)
    with _conn() as con:
        con.execute(
            """
            UPDATE creditos_adquiridos SET
                nombre=?, acreedor=?, tipo=?, numero_contrato=?, monto_original=?,
                tasa_anual_pct=?, tipo_tasa=?, sistema=?, plazo_meses=?, periodicidad=?,
                cuota_pactada=?, seguro_cuota=?, fecha_desembolso=?, fecha_primera_cuota=?,
                dia_pago=?, garantia=?, estado=?, notas=?,
                updated_at=datetime('now')
            WHERE id=?
            """,
            (
                campos["nombre"], campos["acreedor"], campos["tipo"],
                campos["numero_contrato"], campos["monto_original"],
                campos["tasa_anual_pct"], campos["tipo_tasa"], campos["sistema"],
                campos["plazo_meses"], campos["periodicidad"],
                campos["cuota_pactada"], campos["seguro_cuota"],
                campos["fecha_desembolso"], campos["fecha_primera_cuota"],
                campos["dia_pago"], campos["garantia"], campos["estado"],
                campos["notas"], int(credito_id),
            ),
        )
    return obtener_credito(credito_id, con_tabla=False) or existente


def eliminar_credito(credito_id: int) -> bool:
    ensure_creditos_tables()
    with _conn() as con:
        cur = con.execute("DELETE FROM creditos_adquiridos WHERE id = ?", (int(credito_id),))
        return cur.rowcount > 0


def registrar_pago(credito_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    credito = obtener_credito(credito_id, con_tabla=False)
    if not credito:
        raise KeyError("crédito no encontrado")
    monto = float(payload.get("monto") or 0)
    if monto <= 0:
        raise ValueError("monto debe ser > 0")
    fecha = str(payload.get("fecha") or date.today().isoformat())[:10]
    seguro = float(credito.get("seguro_cuota") or 0)
    extras = float(payload.get("extras") if payload.get("extras") not in (None, "") else seguro)
    capital_in = payload.get("capital")
    intereses_in = payload.get("intereses")
    r = tasa_periodo(
        float(credito["tasa_anual_pct"]),
        str(credito["tipo_tasa"]),
        str(credito["periodicidad"]),
    )
    saldo = float(credito.get("saldo") or credito["monto_original"])
    if intereses_in not in (None, "") and capital_in not in (None, ""):
        intereses = round(float(intereses_in), 2)
        capital = round(float(capital_in), 2)
    else:
        intereses = round(min(saldo * r, max(0.0, monto - extras)), 2)
        capital = round(max(0.0, monto - extras - intereses), 2)
        if capital > saldo:
            capital = round(saldo, 2)
    numero = payload.get("numero_cuota")
    if numero in (None, ""):
        numero = int(credito.get("cuotas_pagadas") or 0) + 1
    ensure_creditos_tables()
    with _conn() as con:
        cur = con.execute(
            """
            INSERT INTO creditos_pagos (
                credito_id, fecha, monto, capital, intereses, extras,
                numero_cuota, notas, comprobante
            ) VALUES (?,?,?,?,?,?,?,?,?)
            """,
            (
                int(credito_id), fecha, round(monto, 2), capital, intereses,
                round(extras, 2), int(numero),
                str(payload.get("notas") or "").strip(),
                str(payload.get("comprobante") or "").strip(),
            ),
        )
        pago_id = int(cur.lastrowid)
        nuevo_saldo = round(max(0.0, saldo - capital), 2)
        if nuevo_saldo <= 1 and str(credito.get("estado")) == "activo":
            con.execute(
                "UPDATE creditos_adquiridos SET estado='pagado', updated_at=datetime('now') WHERE id=?",
                (int(credito_id),),
            )
    try:
        from app.services.contabilidad_ledger import invalidar_cache_libro
        invalidar_cache_libro()
    except Exception:
        pass
    return {
        "id": pago_id,
        "credito_id": int(credito_id),
        "fecha": fecha,
        "monto": round(monto, 2),
        "capital": capital,
        "intereses": intereses,
        "extras": round(extras, 2),
        "numero_cuota": int(numero),
        "notas": str(payload.get("notas") or "").strip(),
        "comprobante": str(payload.get("comprobante") or "").strip(),
    }


def eliminar_pago(pago_id: int) -> bool:
    ensure_creditos_tables()
    with _conn() as con:
        row = con.execute(
            "SELECT credito_id FROM creditos_pagos WHERE id = ?", (int(pago_id),)
        ).fetchone()
        if not row:
            return False
        credito_id = int(row["credito_id"])
        con.execute("DELETE FROM creditos_pagos WHERE id = ?", (int(pago_id),))
        con.execute(
            """
            UPDATE creditos_adquiridos SET estado='activo', updated_at=datetime('now')
            WHERE id=? AND estado='pagado'
            """,
            (credito_id,),
        )
    try:
        from app.services.contabilidad_ledger import invalidar_cache_libro
        invalidar_cache_libro()
    except Exception:
        pass
    return True


def pagos_en_rango(desde: str, hasta: str) -> list[dict[str, Any]]:
    """Pagos de créditos para el libro de ingresos/egresos."""
    ensure_creditos_tables()
    with _conn() as con:
        rows = con.execute(
            """
            SELECT p.id, p.fecha, p.monto, p.capital, p.intereses, p.extras,
                   p.numero_cuota, p.comprobante, p.notas,
                   c.nombre, c.acreedor
            FROM creditos_pagos p
            JOIN creditos_adquiridos c ON c.id = p.credito_id
            WHERE p.fecha >= ? AND p.fecha <= ?
            ORDER BY p.fecha DESC, p.id DESC
            """,
            (desde, hasta),
        ).fetchall()
    return [dict(r) for r in rows]


def resumen() -> dict[str, Any]:
    creditos = listar_creditos()
    vigentes = [c for c in creditos if c.get("estado") in ("activo", "en_mora")]
    deuda = round(sum(float(c.get("saldo") or 0) for c in vigentes), 2)
    cuota_mes = round(
        sum(float(c.get("cuota_periodo") or 0) for c in vigentes if c.get("periodicidad") == "mensual")
        + sum(float(c.get("cuota_periodo") or 0) * 2 for c in vigentes if c.get("periodicidad") == "quincenal")
        + sum(float(c.get("cuota_periodo") or 0) / 3 for c in vigentes if c.get("periodicidad") == "trimestral"),
        2,
    )
    proximas = [c for c in vigentes if c.get("proxima_cuota_fecha")]
    proximas.sort(key=lambda c: c["proxima_cuota_fecha"])
    return {
        "creditos": len(creditos),
        "activos": len(vigentes),
        "deuda_vigente": deuda,
        "cuota_mensual_consolidada": cuota_mes,
        "proxima_cuota_fecha": proximas[0]["proxima_cuota_fecha"] if proximas else "",
        "proxima_cuota_nombre": proximas[0]["nombre"] if proximas else "",
        "proxima_cuota_monto": proximas[0]["cuota_periodo"] if proximas else 0,
    }


# ── internos ──────────────────────────────────────────────────────────────────

def _pagos_agrupados(con) -> dict[int, list[dict[str, Any]]]:
    out: dict[int, list[dict[str, Any]]] = {}
    for p in con.execute(
        "SELECT * FROM creditos_pagos ORDER BY fecha ASC, id ASC"
    ).fetchall():
        cid = int(p["credito_id"])
        out.setdefault(cid, []).append(dict(p))
    return out


def _enriquecer(row: dict[str, Any], pagos: list[dict[str, Any]]) -> dict[str, Any]:
    monto = float(row.get("monto_original") or 0)
    capital_pagado = round(sum(float(p.get("capital") or 0) for p in pagos), 2)
    intereses_pagados = round(sum(float(p.get("intereses") or 0) for p in pagos), 2)
    total_pagado = round(sum(float(p.get("monto") or 0) for p in pagos), 2)
    saldo = round(max(0.0, monto - capital_pagado), 2)
    n = n_cuotas(int(row.get("plazo_meses") or 1), str(row.get("periodicidad") or "mensual"))
    pagadas = len(pagos)
    restantes = max(0, n - pagadas)
    cuota_calc = calcular_cuota(
        monto,
        float(row.get("tasa_anual_pct") or 0),
        int(row.get("plazo_meses") or 1),
        tipo_tasa=str(row.get("tipo_tasa") or "EA"),
        sistema=str(row.get("sistema") or "frances"),
        periodicidad=str(row.get("periodicidad") or "mensual"),
    )
    pactada = row.get("cuota_pactada")
    cuota_base = float(pactada) if pactada not in (None, "") and float(pactada) > 0 else cuota_calc
    seguro = float(row.get("seguro_cuota") or 0)
    cuota_periodo = round(cuota_base + seguro, 2)
    primera = str(row.get("fecha_primera_cuota") or row.get("fecha_desembolso") or "")
    proxima = _proxima_fecha(primera, pagadas, str(row.get("periodicidad") or "mensual"), row.get("dia_pago"))
    hoy = date.today().isoformat()
    estado = str(row.get("estado") or "activo")
    en_mora = estado == "activo" and bool(proxima) and proxima < hoy and saldo > 1
    sim = simular({
        "monto_original": monto,
        "tasa_anual_pct": row.get("tasa_anual_pct"),
        "plazo_meses": row.get("plazo_meses"),
        "tipo_tasa": row.get("tipo_tasa"),
        "sistema": row.get("sistema"),
        "periodicidad": row.get("periodicidad"),
        "cuota_pactada": pactada,
        "seguro_cuota": seguro,
    })
    return {
        **row,
        "tipo_label": _TIPO_LABEL.get(str(row.get("tipo") or ""), str(row.get("tipo") or "")),
        "saldo": saldo,
        "capital_pagado": capital_pagado,
        "intereses_pagados": intereses_pagados,
        "total_pagado": total_pagado,
        "cuota_calculada": cuota_calc,
        "cuota_periodo": cuota_periodo,
        "n_cuotas": n,
        "cuotas_pagadas": pagadas,
        "cuotas_restantes": restantes,
        "proxima_cuota_fecha": proxima if saldo > 1 else "",
        "en_mora": en_mora,
        "total_pagar_estimado": sim["total_pagar"],
        "total_intereses_estimado": sim["total_intereses"],
        "tasa_periodo_pct": sim["tasa_periodo_pct"],
        "n_pagos": pagadas,
    }


def _validar_payload(payload: dict[str, Any], *, creando: bool) -> dict[str, Any]:
    nombre = str(payload.get("nombre") or "").strip()
    if not nombre:
        raise ValueError("nombre requerido")
    monto = float(payload.get("monto_original") or 0)
    if monto <= 0:
        raise ValueError("monto_original debe ser > 0")
    plazo = int(payload.get("plazo_meses") or 0)
    if plazo <= 0:
        raise ValueError("plazo_meses debe ser > 0")
    tipo = str(payload.get("tipo") or "prestamo_bancario").strip()
    if tipo not in TIPOS:
        tipo = "otro"
    tipo_tasa = str(payload.get("tipo_tasa") or "EA").strip().upper().replace(".", "_")
    if tipo_tasa not in TIPOS_TASA:
        tipo_tasa = "EA"
    sistema = str(payload.get("sistema") or "frances").strip().lower()
    if sistema not in SISTEMAS:
        sistema = "frances"
    periodicidad = str(payload.get("periodicidad") or "mensual").strip().lower()
    if periodicidad not in PERIODICIDADES:
        periodicidad = "mensual"
    estado = str(payload.get("estado") or "activo").strip().lower()
    if estado not in ESTADOS:
        estado = "activo"
    cuota_raw = payload.get("cuota_pactada")
    cuota_pactada = None
    if cuota_raw not in (None, "", 0, "0"):
        cuota_pactada = float(cuota_raw)
        if cuota_pactada <= 0:
            cuota_pactada = None
    dia = payload.get("dia_pago")
    dia_pago = int(dia) if dia not in (None, "") else None
    if dia_pago is not None and not (1 <= dia_pago <= 31):
        dia_pago = None
    fecha_des = str(payload.get("fecha_desembolso") or date.today().isoformat())[:10]
    fecha_1 = str(payload.get("fecha_primera_cuota") or fecha_des)[:10]
    if creando and not fecha_1:
        fecha_1 = fecha_des
    return {
        "nombre": nombre[:160],
        "acreedor": str(payload.get("acreedor") or "").strip()[:120],
        "tipo": tipo,
        "numero_contrato": str(payload.get("numero_contrato") or "").strip()[:80],
        "monto_original": round(monto, 2),
        "tasa_anual_pct": round(float(payload.get("tasa_anual_pct") or 0), 4),
        "tipo_tasa": tipo_tasa,
        "sistema": sistema,
        "plazo_meses": plazo,
        "periodicidad": periodicidad,
        "cuota_pactada": round(cuota_pactada, 2) if cuota_pactada else None,
        "seguro_cuota": round(float(payload.get("seguro_cuota") or 0), 2),
        "fecha_desembolso": fecha_des,
        "fecha_primera_cuota": fecha_1,
        "dia_pago": dia_pago,
        "garantia": str(payload.get("garantia") or "").strip()[:200],
        "estado": estado,
        "notas": str(payload.get("notas") or "").strip()[:2000],
    }


def _parse_fecha(val: str) -> date | None:
    s = str(val or "").strip()[:10]
    if len(s) < 10:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        return None


def _add_months(d: date, months: int) -> date:
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    last = calendar.monthrange(y, m)[1]
    return date(y, m, min(d.day, last))


def _fecha_cuota(primera: date, index_0: int, periodicidad: str) -> str:
    p = (periodicidad or "mensual").strip().lower()
    if p == "quincenal":
        return (primera + timedelta(days=15 * index_0)).isoformat()
    if p == "trimestral":
        return _add_months(primera, 3 * index_0).isoformat()
    return _add_months(primera, index_0).isoformat()


def _proxima_fecha(primera: str, pagadas: int, periodicidad: str, dia_pago: Any) -> str:
    d0 = _parse_fecha(primera)
    if not d0:
        return ""
    nxt = _parse_fecha(_fecha_cuota(d0, max(0, int(pagadas)), periodicidad))
    if not nxt:
        return ""
    if dia_pago not in (None, ""):
        try:
            dia = int(dia_pago)
            last = calendar.monthrange(nxt.year, nxt.month)[1]
            nxt = date(nxt.year, nxt.month, min(max(1, dia), last))
        except (TypeError, ValueError):
            pass
    return nxt.isoformat()
