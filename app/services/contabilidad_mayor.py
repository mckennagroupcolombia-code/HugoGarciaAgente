"""Libro Mayor discriminado por cuenta contable: árbol del PUC con saldos y
extracto (estado de cuenta) de cualquier cuenta.

Existe porque el libro ya tenía los datos —1.600 asientos, partida doble que
cuadra— pero solo se podían ver de dos formas: un desplegable plano con 39
cuentas para pintar una cuenta T sin saldo corrido, y un balance de
comprobación de una sola lista sin jerarquía ni forma de entrar al asiento.
Un contador lee el libro al revés: baja por clase → grupo → cuenta → subcuenta
hasta encontrar la cifra rara, y ahí pide el extracto de ESA cuenta para ver
línea por línea contra qué se movió.

Dos piezas:

* `arbol_cuentas()` — la jerarquía del PUC (clase 1 dígito → grupo 2 → cuenta 4
  → subcuenta 6) reconstruida a partir del código, con saldo inicial, débitos,
  créditos y saldo final acumulados en cada nivel. Los niveles intermedios que
  no existen en `cc_plan_cuentas` (no hay cuenta «5295» aunque sí «529505») se
  sintetizan: sin ellos la 529505 quedaría colgando de la nada.
* `extracto_cuenta()` — el estado de cuenta: saldo inicial, cada línea con su
  **contrapartida** (contra qué otras cuentas se movió ese asiento) y el saldo
  corrido, más el resumen por tercero. La contrapartida es lo que convierte una
  lista de cifras en algo legible: «$2.400.000 al crédito de 2205» no dice nada
  hasta que se ve que el débito fue a 1435 Inventarios.

Un nodo distingue lo **propio** (líneas asentadas directamente en esa cuenta)
de lo **total** (propio + descendientes). En este libro no es un detalle
teórico: 1110 Bancos y 111010 MercadoPago tienen movimiento las dos, y sumar
una dentro de la otra sin separarlas escondería $201M de traslados.

Solo lectura: ninguna función de este módulo escribe en la base.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from app.services.contabilidad_core import _conn, _ensure, obtener_cuenta

# Nombres de los niveles del PUC que no existen como cuenta en el libro. Solo
# se usan para rotular el árbol; ninguno se crea en cc_plan_cuentas.
_NOMBRES_CLASE = {
    "1": "Activo",
    "2": "Pasivo",
    "3": "Patrimonio",
    "4": "Ingresos",
    "5": "Gastos",
    "6": "Costos de ventas",
    "7": "Costos de producción",
    "8": "Cuentas de orden deudoras",
    "9": "Cuentas de orden acreedoras",
}

_NOMBRES_GRUPO = {
    "11": "Disponible",
    "12": "Inversiones",
    "13": "Deudores",
    "14": "Inventarios",
    "15": "Propiedad planta y equipo",
    "21": "Obligaciones financieras",
    "22": "Proveedores",
    "23": "Cuentas por pagar",
    "24": "Impuestos, gravámenes y tasas",
    "25": "Obligaciones laborales",
    "31": "Capital social",
    "36": "Resultados del ejercicio",
    "41": "Operacionales",
    "42": "No operacionales",
    "51": "Operacionales de administración",
    "52": "Operacionales de ventas",
    "53": "No operacionales",
    "61": "Costo de ventas",
    "62": "Compras",
}

# Cuentas de 4 dígitos que el libro no tiene creadas pero aparecen como nivel
# intermedio (hay 529505 pero no 5295). Nombre del PUC 2650/1993.
_NOMBRES_CUENTA = {
    "1110": "Bancos",
    "5295": "Diversos",
    "5305": "Financieros",
}

_TIPO_POR_CLASE = {
    "1": ("activo", "debito"),
    "2": ("pasivo", "credito"),
    "3": ("patrimonio", "credito"),
    "4": ("ingreso", "credito"),
    "5": ("gasto", "debito"),
    "6": ("costo", "debito"),
    "7": ("costo", "debito"),
    "8": ("orden", "debito"),
    "9": ("orden", "credito"),
}

# Longitudes de código que forman un nivel del PUC. Un código de 6 dígitos
# cuelga de 4, que cuelga de 2, que cuelga de 1.
_NIVELES = (1, 2, 4, 6)

_ETIQUETA_NIVEL = {1: "clase", 2: "grupo", 4: "cuenta", 6: "subcuenta"}


def _nombre_sintetico(codigo: str) -> str:
    if len(codigo) == 1:
        return _NOMBRES_CLASE.get(codigo, f"Clase {codigo}")
    if len(codigo) == 2:
        return _NOMBRES_GRUPO.get(codigo, f"Grupo {codigo}")
    if len(codigo) == 4:
        return _NOMBRES_CUENTA.get(codigo, f"Cuenta {codigo}")
    return f"Subcuenta {codigo}"


def _tipo_naturaleza(codigo: str) -> tuple[str, str]:
    return _TIPO_POR_CLASE.get(codigo[:1], ("otro", "debito"))


def _saldo(naturaleza: str, debito: float, credito: float) -> float:
    return (debito - credito) if naturaleza == "debito" else (credito - debito)


def _agregados_por_cuenta(
    con: sqlite3.Connection, desde: str | None, hasta: str | None
) -> dict[int, dict[str, float]]:
    """Débitos y créditos de cada cuenta: los anteriores a `desde` (que forman el
    saldo inicial) y los del rango, en una sola pasada por las líneas."""
    where = ["m.estado != 'anulado'"]
    params: list = []
    if hasta:
        where.append("m.fecha <= ?")
        params.append(hasta)
    sql = f"""
        SELECT ml.cuenta_id AS cuenta_id,
               COALESCE(SUM(CASE WHEN {'m.fecha < ?' if desde else '0'} THEN ml.debito ELSE 0 END), 0) AS ini_d,
               COALESCE(SUM(CASE WHEN {'m.fecha < ?' if desde else '0'} THEN ml.credito ELSE 0 END), 0) AS ini_c,
               COALESCE(SUM(CASE WHEN {'m.fecha >= ?' if desde else '1'} THEN ml.debito ELSE 0 END), 0) AS per_d,
               COALESCE(SUM(CASE WHEN {'m.fecha >= ?' if desde else '1'} THEN ml.credito ELSE 0 END), 0) AS per_c,
               COUNT(CASE WHEN {'m.fecha >= ?' if desde else '1'} THEN 1 END) AS n
          FROM cc_movimiento_lineas ml
          JOIN cc_movimientos m ON m.id = ml.movimiento_id
         WHERE {" AND ".join(where)}
         GROUP BY ml.cuenta_id
    """
    # Los cinco CASE con `desde` (ini_d, ini_c, per_d, per_c y el COUNT) van
    # antes del WHERE en el orden en que sqlite liga los parámetros.
    binds = ([desde] * 5 if desde else []) + params
    out: dict[int, dict[str, float]] = {}
    for r in con.execute(sql, binds):
        out[r["cuenta_id"]] = {
            "ini_d": r["ini_d"] or 0.0,
            "ini_c": r["ini_c"] or 0.0,
            "debito": r["per_d"] or 0.0,
            "credito": r["per_c"] or 0.0,
            "lineas": r["n"] or 0,
        }
    return out


def _agregados_por_cuenta_tercero(
    con: sqlite3.Connection, desde: str | None, hasta: str | None
) -> list[dict[str, Any]]:
    """Lo mismo que `_agregados_por_cuenta`, abierto por tercero.

    El tercero puede venir en la línea o solo en la cabecera del asiento — el
    mismo criterio que usa `extracto_cuenta`, para que el auxiliar y el
    extracto digan lo mismo.
    """
    where = ["m.estado != 'anulado'"]
    params: list = []
    if hasta:
        where.append("m.fecha <= ?")
        params.append(hasta)
    antes = "m.fecha < ?" if desde else "0"
    durante = "m.fecha >= ?" if desde else "1"
    sql = f"""
        SELECT ml.cuenta_id AS cuenta_id,
               COALESCE(ml.tercero_id, m.tercero_id) AS tercero_id,
               t.nombre AS tercero_nombre, t.identificacion AS identificacion, t.tipo AS tercero_tipo,
               COALESCE(SUM(CASE WHEN {antes} THEN ml.debito ELSE 0 END), 0) AS ini_d,
               COALESCE(SUM(CASE WHEN {antes} THEN ml.credito ELSE 0 END), 0) AS ini_c,
               COALESCE(SUM(CASE WHEN {durante} THEN ml.debito ELSE 0 END), 0) AS per_d,
               COALESCE(SUM(CASE WHEN {durante} THEN ml.credito ELSE 0 END), 0) AS per_c,
               COUNT(CASE WHEN {durante} THEN 1 END) AS n
          FROM cc_movimiento_lineas ml
          JOIN cc_movimientos m ON m.id = ml.movimiento_id
          LEFT JOIN cc_terceros t ON t.id = COALESCE(ml.tercero_id, m.tercero_id)
         WHERE {" AND ".join(where)}
         GROUP BY ml.cuenta_id, COALESCE(ml.tercero_id, m.tercero_id)
    """
    binds = ([desde] * 5 if desde else []) + params
    return [dict(r) for r in con.execute(sql, binds)]


def _fila_tercero(r: dict[str, Any], naturaleza: str) -> dict[str, Any]:
    ini = _saldo(naturaleza, r["ini_d"] or 0.0, r["ini_c"] or 0.0)
    deb, cre = r["per_d"] or 0.0, r["per_c"] or 0.0
    return {
        "tercero_id": r["tercero_id"],
        "nombre": r["tercero_nombre"] or "Sin tercero",
        "identificacion": r.get("identificacion") or "",
        "saldo_inicial": round(ini, 2),
        "debito": round(deb, 2),
        "credito": round(cre, 2),
        "saldo_final": round(ini + _saldo(naturaleza, deb, cre), 2),
        "lineas": int(r["n"] or 0),
    }


def auxiliar_terceros(desde: str | None = None, hasta: str | None = None) -> dict[str, Any]:
    """El libro visto por tercero: cada tercero con las cuentas en que tiene
    movimiento o saldo, y su saldo en cada una.

    Es el «auxiliar por tercero» que pide un contador: cuánto se le debe a un
    proveedor, cuánto se le retuvo, qué le queda por pagar a un socio.
    """
    _ensure()
    with _conn() as con:
        cuentas = {r["id"]: dict(r) for r in con.execute("SELECT * FROM cc_plan_cuentas")}
        filas = _agregados_por_cuenta_tercero(con, desde, hasta)
    por_tercero: dict[Any, dict[str, Any]] = {}
    for r in filas:
        c = cuentas.get(r["cuenta_id"])
        if not c:
            continue
        f = _fila_tercero(r, c["naturaleza"])
        if not f["lineas"] and not f["saldo_inicial"]:
            continue
        clave = r["tercero_id"] or 0
        t = por_tercero.setdefault(clave, {
            "tercero_id": r["tercero_id"], "nombre": f["nombre"],
            "identificacion": f["identificacion"], "tipo": r.get("tercero_tipo") or "",
            "cuentas": [], "debito": 0.0, "credito": 0.0, "lineas": 0,
        })
        t["cuentas"].append({
            "cuenta_id": c["id"], "codigo": c["codigo"], "nombre": c["nombre"],
            "tipo": c["tipo"], "naturaleza": c["naturaleza"],
            **{k: f[k] for k in ("saldo_inicial", "debito", "credito", "saldo_final", "lineas")},
        })
        t["debito"] = round(t["debito"] + f["debito"], 2)
        t["credito"] = round(t["credito"] + f["credito"], 2)
        t["lineas"] += f["lineas"]
    salida = []
    for t in por_tercero.values():
        t["cuentas"].sort(key=lambda x: x["codigo"])
        # Lo que se le debe (pasivos a su nombre) y lo que debe (activos): es la
        # cifra que se busca primero al abrir un tercero.
        t["por_pagar"] = round(sum(x["saldo_final"] for x in t["cuentas"] if x["codigo"][:1] == "2"), 2)
        t["por_cobrar"] = round(sum(x["saldo_final"] for x in t["cuentas"]
                                    if x["codigo"][:2] in ("13",)), 2)
        salida.append(t)
    salida.sort(key=lambda t: (t["tercero_id"] is None, -abs(t["por_pagar"]), t["nombre"].lower()))
    return {"desde": desde, "hasta": hasta, "terceros": salida}


def arbol_cuentas(
    desde: str | None = None,
    hasta: str | None = None,
    solo_con_movimiento: bool = False,
    con_terceros: bool = False,
) -> dict[str, Any]:
    """El PUC del libro como árbol, con saldo inicial / débito / crédito / saldo
    final en cada nodo.

    `solo_con_movimiento` deja fuera las ramas que no tuvieron ni saldo inicial
    ni movimiento en el rango — es lo que se quiere al revisar un mes, mientras
    que el árbol completo sirve para ver qué cuentas existen y están sin usar.
    """
    _ensure()
    with _conn() as con:
        cuentas = [
            dict(r)
            for r in con.execute(
                "SELECT * FROM cc_plan_cuentas ORDER BY codigo"
            ).fetchall()
        ]
        agregados = _agregados_por_cuenta(con, desde, hasta)
        por_tercero: dict[int, list[dict[str, Any]]] = {}
        if con_terceros:
            for r in _agregados_por_cuenta_tercero(con, desde, hasta):
                por_tercero.setdefault(r["cuenta_id"], []).append(r)

    nodos: dict[str, dict[str, Any]] = {}

    def _nodo(codigo: str) -> dict[str, Any]:
        n = nodos.get(codigo)
        if n is None:
            tipo, naturaleza = _tipo_naturaleza(codigo)
            n = {
                "codigo": codigo,
                "nombre": _nombre_sintetico(codigo),
                "nivel": _ETIQUETA_NIVEL.get(len(codigo), "detalle"),
                "tipo": tipo,
                "naturaleza": naturaleza,
                "cuenta_id": None,
                "existe": False,
                "activa": True,
                "es_movimiento": False,
                # Lo asentado directamente en esta cuenta.
                "propio": {"saldo_inicial": 0.0, "debito": 0.0, "credito": 0.0, "lineas": 0},
                # Propio + todo lo que cuelga debajo.
                "saldo_inicial": 0.0,
                "debito": 0.0,
                "credito": 0.0,
                "lineas": 0,
                "hijos_map": {},
            }
            nodos[codigo] = n
        return n

    for c in cuentas:
        codigo = str(c["codigo"]).strip()
        if not codigo:
            continue
        n = _nodo(codigo)
        n.update(
            {
                "nombre": c["nombre"],
                "tipo": c["tipo"],
                "naturaleza": c["naturaleza"],
                "cuenta_id": c["id"],
                "existe": True,
                "activa": bool(c["activa"]),
                "es_movimiento": bool(c["es_movimiento"]),
            }
        )
        a = agregados.get(c["id"])
        if a:
            ini = _saldo(c["naturaleza"], a["ini_d"], a["ini_c"])
            n["propio"] = {
                "saldo_inicial": ini,
                "debito": a["debito"],
                "credito": a["credito"],
                "lineas": int(a["lineas"]),
            }
        if con_terceros and c["id"] in por_tercero:
            # Solo lo propio de la cuenta: el tercero de una subcuenta se ve al
            # abrir la subcuenta, no duplicado en el padre.
            filas_t = [_fila_tercero(r, c["naturaleza"]) for r in por_tercero[c["id"]]]
            filas_t = [f for f in filas_t if f["lineas"] or f["saldo_inicial"]]
            # «Sin tercero» como único renglón no discrimina nada: no se muestra.
            if not (len(filas_t) == 1 and filas_t[0]["tercero_id"] is None):
                n["terceros"] = sorted(filas_t, key=lambda f: (f["tercero_id"] is None, -abs(f["saldo_final"])))

        # Los ancestros del PUC: sin esto la 529505 no tendría de dónde colgar.
        for largo in _NIVELES:
            if largo < len(codigo):
                _nodo(codigo[:largo])

    # Enlazar cada nodo con su padre más cercano que exista en el árbol.
    raices: list[dict[str, Any]] = []
    for codigo in sorted(nodos, key=lambda x: (len(x), x)):
        n = nodos[codigo]
        padre = None
        for largo in sorted(_NIVELES, reverse=True):
            if largo < len(codigo) and codigo[:largo] in nodos:
                padre = nodos[codigo[:largo]]
                break
        if padre is None:
            raices.append(n)
        else:
            padre["hijos_map"][codigo] = n

    # Acumular de abajo hacia arriba: un nodo suma lo propio más sus hijos ya
    # acumulados. Recorrer por longitud de código descendente garantiza que los
    # hijos estén listos antes que el padre.
    for codigo in sorted(nodos, key=lambda x: (len(x), x), reverse=True):
        n = nodos[codigo]
        ini = n["propio"]["saldo_inicial"]
        deb = n["propio"]["debito"]
        cre = n["propio"]["credito"]
        lin = n["propio"]["lineas"]
        for h in n["hijos_map"].values():
            # El hijo puede tener otra naturaleza que el padre (4175 Devoluciones
            # es débito dentro de la clase 4, que es crédito): se acumula el
            # saldo con el signo del padre, no el del hijo.
            ini += h["saldo_inicial"] if h["naturaleza"] == n["naturaleza"] else -h["saldo_inicial"]
            deb += h["debito"]
            cre += h["credito"]
            lin += h["lineas"]
        n["saldo_inicial"] = round(ini, 2)
        n["debito"] = round(deb, 2)
        n["credito"] = round(cre, 2)
        n["lineas"] = lin
        n["saldo_final"] = round(ini + _saldo(n["naturaleza"], deb, cre), 2)
        n["propio"] = {
            "saldo_inicial": round(n["propio"]["saldo_inicial"], 2),
            "debito": round(n["propio"]["debito"], 2),
            "credito": round(n["propio"]["credito"], 2),
            "lineas": n["propio"]["lineas"],
            "saldo_final": round(
                n["propio"]["saldo_inicial"]
                + _saldo(n["naturaleza"], n["propio"]["debito"], n["propio"]["credito"]),
                2,
            ),
        }

    def _tiene_movimiento(n: dict[str, Any]) -> bool:
        return bool(n["lineas"]) or round(n["saldo_inicial"], 2) != 0

    def _serializar(n: dict[str, Any]) -> dict[str, Any] | None:
        hijos = []
        for codigo in sorted(n["hijos_map"]):
            s = _serializar(n["hijos_map"][codigo])
            if s is not None:
                hijos.append(s)
        if solo_con_movimiento and not hijos and not _tiene_movimiento(n):
            return None
        salida = {k: v for k, v in n.items() if k != "hijos_map"}
        salida["hijos"] = hijos
        return salida

    arbol = []
    for r in sorted(raices, key=lambda n: n["codigo"]):
        s = _serializar(r)
        if s is not None:
            arbol.append(s)

    total_debito = round(sum(n["debito"] for n in nodos.values() if len(n["codigo"]) == 1), 2)
    total_credito = round(sum(n["credito"] for n in nodos.values() if len(n["codigo"]) == 1), 2)

    return {
        "desde": desde,
        "hasta": hasta,
        "arbol": arbol,
        "total_debito": total_debito,
        "total_credito": total_credito,
        "cuadra": total_debito == total_credito,
    }


def _codigos_descendientes(con: sqlite3.Connection, codigo: str) -> list[int]:
    filas = con.execute(
        "SELECT id FROM cc_plan_cuentas WHERE codigo = ? OR codigo LIKE ?",
        (codigo, f"{codigo}%"),
    ).fetchall()
    return [r["id"] for r in filas]


def extracto_cuenta(
    cuenta_id: int | None = None,
    *,
    codigo: str | None = None,
    desde: str | None = None,
    hasta: str | None = None,
    incluir_subcuentas: bool = False,
    tercero_id: int | None = None,
    limite: int = 2000,
) -> dict[str, Any]:
    """Estado de cuenta de una cuenta contable, con saldo corrido y contrapartida.

    `incluir_subcuentas` mira también lo asentado en las cuentas cuyo código
    empieza por el de esta (1110 → 111010). `tercero_id` acota el extracto a un
    tercero, que es como se revisa «cuánto le debemos a este proveedor» sin
    leerse los 215 movimientos de 2205.
    """
    _ensure()
    with _conn() as con:
        if cuenta_id is None:
            if not codigo:
                raise ValueError("Falta la cuenta")
            fila = con.execute(
                "SELECT * FROM cc_plan_cuentas WHERE codigo = ?", (str(codigo).strip(),)
            ).fetchone()
            if not fila:
                raise ValueError(f"No existe la cuenta {codigo}")
            cuenta = dict(fila)
        else:
            fila = con.execute(
                "SELECT * FROM cc_plan_cuentas WHERE id = ?", (cuenta_id,)
            ).fetchone()
            if not fila:
                raise ValueError("Cuenta no encontrada")
            cuenta = dict(fila)

        naturaleza = cuenta["naturaleza"]
        ids = (
            _codigos_descendientes(con, str(cuenta["codigo"]))
            if incluir_subcuentas
            else [cuenta["id"]]
        )
        marcadores = ",".join("?" for _ in ids)

        filtro_tercero = ""
        extra: list = []
        if tercero_id:
            # El tercero puede venir en la línea o solo en la cabecera del asiento.
            filtro_tercero = " AND COALESCE(ml.tercero_id, m.tercero_id) = ?"
            extra = [tercero_id]

        saldo_inicial = 0.0
        if desde:
            r = con.execute(
                f"""SELECT COALESCE(SUM(ml.debito),0) d, COALESCE(SUM(ml.credito),0) c
                      FROM cc_movimiento_lineas ml
                      JOIN cc_movimientos m ON m.id = ml.movimiento_id
                     WHERE ml.cuenta_id IN ({marcadores})
                       AND m.estado != 'anulado' AND m.fecha < ?{filtro_tercero}""",
                [*ids, desde, *extra],
            ).fetchone()
            saldo_inicial = _saldo(naturaleza, r["d"] or 0, r["c"] or 0)

        where = [f"ml.cuenta_id IN ({marcadores})", "m.estado != 'anulado'"]
        params: list = list(ids)
        if desde:
            where.append("m.fecha >= ?")
            params.append(desde)
        if hasta:
            where.append("m.fecha <= ?")
            params.append(hasta)
        sql = f"""
            SELECT ml.id AS linea_id, ml.movimiento_id, ml.debito, ml.credito,
                   ml.descripcion, ml.cuenta_id,
                   pc.codigo AS cuenta_codigo, pc.nombre AS cuenta_nombre,
                   m.fecha, m.concepto, m.referencia, m.tipo_origen, m.estado,
                   COALESCE(ml.tercero_id, m.tercero_id) AS tercero_id,
                   t.nombre AS tercero_nombre
              FROM cc_movimiento_lineas ml
              JOIN cc_movimientos m ON m.id = ml.movimiento_id
              JOIN cc_plan_cuentas pc ON pc.id = ml.cuenta_id
              LEFT JOIN cc_terceros t ON t.id = COALESCE(ml.tercero_id, m.tercero_id)
             WHERE {" AND ".join(where)}{filtro_tercero}
             ORDER BY m.fecha, m.id, ml.orden
             LIMIT ?
        """
        filas = [dict(r) for r in con.execute(sql, [*params, *extra, int(limite)])]

        # Contrapartidas: las otras cuentas de cada asiento. Es lo que hace
        # legible el extracto — ver contra qué se movió sin abrir el asiento.
        contrapartidas: dict[int, list[dict[str, Any]]] = {}
        mov_ids = sorted({f["movimiento_id"] for f in filas})
        for i in range(0, len(mov_ids), 400):
            lote = mov_ids[i : i + 400]
            mk = ",".join("?" for _ in lote)
            for r in con.execute(
                f"""SELECT ml.movimiento_id, pc.id AS cuenta_id, pc.codigo, pc.nombre,
                           ml.debito, ml.credito
                      FROM cc_movimiento_lineas ml
                      JOIN cc_plan_cuentas pc ON pc.id = ml.cuenta_id
                     WHERE ml.movimiento_id IN ({mk})
                     ORDER BY ml.orden""",
                lote,
            ):
                contrapartidas.setdefault(r["movimiento_id"], []).append(dict(r))

    ids_set = set(ids)
    saldo = saldo_inicial
    total_debito = 0.0
    total_credito = 0.0
    por_tercero: dict[Any, dict[str, Any]] = {}
    movimientos: list[dict[str, Any]] = []

    for f in filas:
        debito = f["debito"] or 0.0
        credito = f["credito"] or 0.0
        total_debito += debito
        total_credito += credito
        saldo += _saldo(naturaleza, debito, credito)

        contra = [
            {
                "codigo": c["codigo"],
                "nombre": c["nombre"],
                "cuenta_id": c["cuenta_id"],
                "valor": round((c["debito"] or 0) + (c["credito"] or 0), 2),
                "lado": "debito" if (c["debito"] or 0) > 0 else "credito",
            }
            for c in contrapartidas.get(f["movimiento_id"], [])
            if c["cuenta_id"] not in ids_set
        ]

        clave = f["tercero_id"] or 0
        agg = por_tercero.setdefault(
            clave,
            {
                "tercero_id": f["tercero_id"],
                "nombre": f["tercero_nombre"] or "Sin tercero",
                "debito": 0.0,
                "credito": 0.0,
                "movimientos": 0,
            },
        )
        agg["debito"] += debito
        agg["credito"] += credito
        agg["movimientos"] += 1

        movimientos.append(
            {
                "linea_id": f["linea_id"],
                "movimiento_id": f["movimiento_id"],
                "fecha": f["fecha"],
                "concepto": f["concepto"],
                "referencia": f["referencia"],
                "tipo_origen": f["tipo_origen"],
                "descripcion": f["descripcion"],
                "tercero_id": f["tercero_id"],
                "tercero_nombre": f["tercero_nombre"] or "",
                "cuenta_codigo": f["cuenta_codigo"],
                "cuenta_nombre": f["cuenta_nombre"],
                "debito": round(debito, 2),
                "credito": round(credito, 2),
                "saldo": round(saldo, 2),
                "contrapartida": contra,
            }
        )

    resumen_terceros = sorted(
        (
            {
                **v,
                "debito": round(v["debito"], 2),
                "credito": round(v["credito"], 2),
                "saldo": round(_saldo(naturaleza, v["debito"], v["credito"]), 2),
            }
            for v in por_tercero.values()
        ),
        key=lambda x: abs(x["saldo"]),
        reverse=True,
    )

    return {
        "cuenta": cuenta,
        "desde": desde,
        "hasta": hasta,
        "incluir_subcuentas": incluir_subcuentas,
        "tercero_id": tercero_id,
        "saldo_inicial": round(saldo_inicial, 2),
        "movimientos": movimientos,
        "total_debito": round(total_debito, 2),
        "total_credito": round(total_credito, 2),
        "saldo_final": round(saldo, 2),
        "truncado": len(filas) >= int(limite),
        "por_tercero": resumen_terceros,
    }


def extracto_csv(extracto: dict[str, Any]) -> str:
    """El extracto en CSV, para abrirlo en Excel o mandárselo al contador."""
    import csv
    import io

    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    cuenta = extracto["cuenta"]
    w.writerow([f"Extracto contable {cuenta['codigo']} - {cuenta['nombre']}"])
    w.writerow(["Desde", extracto.get("desde") or "inicio", "Hasta", extracto.get("hasta") or "hoy"])
    w.writerow([])
    w.writerow(
        ["Fecha", "Asiento", "Concepto", "Tercero", "Referencia", "Contrapartida", "Débito", "Crédito", "Saldo"]
    )
    w.writerow(["", "", "Saldo inicial", "", "", "", "", "", extracto["saldo_inicial"]])
    for m in extracto["movimientos"]:
        w.writerow(
            [
                m["fecha"],
                m["movimiento_id"],
                m["concepto"],
                m["tercero_nombre"],
                m["referencia"],
                " / ".join(f"{c['codigo']}" for c in m["contrapartida"]),
                m["debito"],
                m["credito"],
                m["saldo"],
            ]
        )
    w.writerow([])
    w.writerow(["", "", "Totales", "", "", "", extracto["total_debito"], extracto["total_credito"], extracto["saldo_final"]])
    return buf.getvalue()
