"""Plan Único de Cuentas colombiano (Decreto 2650 de 1993) para el libro de McKenna.

El libro nació con códigos "estilo PUC" escritos a ojo, y varios no existen en el
decreto o significan otra cosa. El contador arma las declaraciones con el PUC
real, así que un código inventado le obliga a traducir cada cifra a mano — y una
traducción a mano es donde se pierden los $164.542 que nadie vuelve a mirar.

Tres piezas:

* `PUC_MCKENNA` — las cuentas reales que McKenna usa, cada una verificada contra
  el decreto (puc.com.co / Decreto 2650). No es el PUC completo: es el subconjunto
  que este libro necesita, y crece cuando el negocio lo necesita.
* `ALIAS` — código viejo → código PUC real. Existe para que la migración no sea un
  big-bang: `contabilidad_core._cuenta_id_por_codigo()` consulta este mapa cuando
  no encuentra el código exacto, así que los ~60 call-sites que todavía dicen
  `"2380"` siguen resolviendo a la cuenta correcta (2355) mientras se limpian de a
  poco. Un alias NO es deuda escondida: es lo que permite mover los datos hoy sin
  romper préstamos, socios y pagos el mismo día.
* `migrar()` — mueve los asientos existentes de la cuenta vieja a la nueva, en una
  transacción, con `dry_run` por defecto.

**Ojo con tres códigos que parecen obvios y no lo son** (los tres estaban mal en
este libro antes de sep-2026):

* `2367` NO es "costos y gastos por pagar" — es **IVA retenido**. Los costos y
  gastos por pagar son `2335`.
* `2380` NO es la cuenta de socios — es "Acreedores varios". Las deudas con socios
  van a `2355`.
* `236515` NO es rendimientos financieros — es **honorarios**. Los rendimientos
  financieros (el 7% de los préstamos de particulares) son `236535`.
"""

from __future__ import annotations

import sqlite3
from typing import Any

# ─── El PUC que McKenna usa, verificado contra el Decreto 2650 ──────────────
# (codigo, nombre, tipo). La naturaleza se deduce del tipo, igual que en
# contabilidad_core._naturaleza_por_tipo.
PUC_MCKENNA: tuple[tuple[str, str, str], ...] = (
    # ── 1 Activo ──
    ("1105", "Caja", "activo"),
    ("110505", "Caja general", "activo"),
    ("1110", "Bancos", "activo"),
    ("111005", "Moneda nacional", "activo"),
    ("1120", "Cuentas de ahorro", "activo"),
    # MercadoPago no es un banco: es dinero de McKenna en poder de un tercero
    # hasta que se traslada. 1110 lo trataba como cuenta bancaria.
    ("1125", "Fondos", "activo"),
    # El decreto llama 112505 «Rotatorios moneda nacional» (caja menor rotativa
    # en manos de un empleado), que no es lo que pasa con MercadoPago: es plata
    # de McKenna en poder de un tercero hasta el traslado. 112515 «Especiales»
    # —fondos con destinación específica— es el encaje real. Se corrige porque
    # todo este trabajo existe para que un código signifique lo que dice el
    # decreto; dejarlo en 112505 repetiría el error de 2367 y 2380.
    ("112515", "Fondos especiales moneda nacional", "activo"),
    ("1325", "Cuentas por cobrar a socios y accionistas", "activo"),
    ("1370", "Préstamos a particulares", "activo"),
    ("1405", "Materias primas", "activo"),
    ("1435", "Mercancías no fabricadas por la empresa", "activo"),
    # ── 2 Pasivo ──
    ("2105", "Bancos nacionales", "pasivo"),
    ("2195", "Otras obligaciones financieras", "pasivo"),
    ("219505", "Particulares", "pasivo"),
    ("2205", "Proveedores nacionales", "pasivo"),
    ("2335", "Costos y gastos por pagar", "pasivo"),
    ("2355", "Deudas con accionistas o socios", "pasivo"),
    ("235510", "Socios", "pasivo"),
    ("2365", "Retención en la fuente", "pasivo"),
    ("236515", "Retención — honorarios", "pasivo"),
    ("236520", "Retención — comisiones", "pasivo"),
    ("236525", "Retención — servicios", "pasivo"),
    ("236530", "Retención — arrendamientos", "pasivo"),
    ("236535", "Retención — rendimientos financieros", "pasivo"),
    ("236540", "Retención — compras", "pasivo"),
    ("236595", "Retención — otras", "pasivo"),
    # ── 24 Impuestos, gravámenes y tasas: lo que McKenna debe como
    # CONTRIBUYENTE, distinto de las 23xx, que es lo que retuvo a terceros y
    # consigna a nombre de ellos. Confundirlos hace que el pago de una
    # declaración baje una deuda que no era.
    ("2404", "De renta y complementarios", "pasivo"),
    ("2408", "Impuesto sobre las ventas por pagar", "pasivo"),
    # Las dos mitades del formulario 300: lo que McKenna cobró en sus ventas y
    # lo que pagó en sus compras. Lo que se declara es la diferencia, así que
    # tenerlas separadas no es un lujo — es lo que hace que el 300 se pueda
    # armar leyendo el libro. Mismos códigos que usa Alegra en sus facturas
    # (`categoryToBePaid` / `categoryFavorable`), para que el espejo case.
    ("240805", "IVA generado", "pasivo"),
    ("240810", "IVA descontable por compras", "pasivo"),
    ("2412", "De industria y comercio", "pasivo"),
    ("2367", "Impuesto a las ventas retenido", "pasivo"),
    ("2368", "Impuesto de industria y comercio retenido", "pasivo"),
    # ── 3 Patrimonio ──
    ("3115", "Aportes sociales", "patrimonio"),
    # ── 4 Ingresos ──
    ("4135", "Comercio al por mayor y al por menor", "ingreso"),
    ("4175", "Devoluciones en ventas", "ingreso"),
    ("4295", "Ingresos diversos", "ingreso"),
    # ── 5 Gastos · 51 Operacionales de administración ──
    ("5105", "Gastos de personal", "gasto"),
    ("510506", "Sueldos", "gasto"),
    ("5110", "Honorarios", "gasto"),
    ("511025", "Asesoría jurídica", "gasto"),
    ("511030", "Asesoría financiera", "gasto"),
    ("511035", "Asesoría técnica", "gasto"),
    ("511095", "Honorarios — otros", "gasto"),
    ("5115", "Impuestos", "gasto"),
    ("5120", "Arrendamientos", "gasto"),
    ("5130", "Seguros", "gasto"),
    ("5135", "Servicios", "gasto"),
    ("513505", "Aseo y vigilancia", "gasto"),
    ("513515", "Asistencia técnica", "gasto"),
    ("513520", "Procesamiento electrónico de datos", "gasto"),
    ("513525", "Acueducto y alcantarillado", "gasto"),
    ("513530", "Energía eléctrica", "gasto"),
    ("513535", "Teléfono", "gasto"),
    ("513550", "Transporte, fletes y acarreos", "gasto"),
    ("513555", "Gas", "gasto"),
    ("513595", "Servicios — otros", "gasto"),
    ("5140", "Gastos legales", "gasto"),
    ("514010", "Registro mercantil", "gasto"),
    ("5145", "Mantenimiento y reparaciones", "gasto"),
    ("514515", "Maquinaria y equipo", "gasto"),
    ("5155", "Gastos de viaje", "gasto"),
    ("5195", "Diversos", "gasto"),
    ("519510", "Libros, suscripciones, periódicos y revistas", "gasto"),
    ("519525", "Elementos de aseo y cafetería", "gasto"),
    ("519595", "Diversos — otros", "gasto"),
    # ── 5 Gastos · 52 Operacionales de ventas ──
    ("5235", "Servicios (ventas)", "gasto"),
    ("523560", "Publicidad, propaganda y promoción", "gasto"),
    ("5295", "Diversos (ventas)", "gasto"),
    ("529505", "Comisiones", "gasto"),
    # ── 5 Gastos · 53 No operacionales ──
    ("5305", "Financieros", "gasto"),
    ("530505", "Gastos bancarios", "gasto"),
    ("530515", "Comisiones (financieras)", "gasto"),
    ("530520", "Intereses", "gasto"),
    ("530595", "Financieros — otros", "gasto"),
    # ── 6 Costos de ventas ──
    ("6135", "Comercio al por mayor y al por menor", "costo"),
    ("6205", "De mercancías", "costo"),
)

# ─── Códigos viejos → código PUC real ───────────────────────────────────────
# La clave es el código que el libro usó hasta sep-2026; el valor, el del
# decreto. `migrar()` mueve los asientos y `contabilidad_core` resuelve por acá
# los call-sites que todavía no se han limpiado.
ALIAS: dict[str, str] = {
    # Nombre correcto, código equivocado: 1355 en el PUC es "Anticipo de
    # impuestos", no cuentas por cobrar a socios.
    "1355": "1325",
    "1290": "1370",
    # 1436 no existe en el decreto; las materias primas son 1405.
    "1436": "1405",
    # Un préstamo de un particular es una obligación financiera (2195), no un
    # proveedor. 2295 no existe.
    "2295": "2195",
    # OJO: aquí NO va "2367": "2335". El libro usaba 2367 con el nombre
    # equivocado («costos y gastos por pagar»), y el alias movió esa data a
    # 2335 — ya está hecho y registrado en `cc_puc_alias_aplicados`. Dejarlo
    # puesto secuestraría el código: 2367 es «Impuesto a las ventas retenido»
    # (reteIVA) en el decreto, y McKenna lo necesita para eso. El alias se
    # retira una vez la migración corrió; los call-sites que quedaban apuntando
    # a 2367 como «costos por pagar» ya dicen 2335.
    # 2380 es "Acreedores varios"; las deudas con socios son 2355.
    "2380": "2355",
    # MercadoPago estaba colgado de Bancos con un código inventado.
    "111010": "112515",
    "112505": "112515",
    # SaaS no tiene código propio en el PUC; lo más cercano y defendible es
    # procesamiento electrónico de datos.
    "513560": "513520",
    # Los dos que estaban cruzados: la publicidad de MeLi es 523560 y las
    # comisiones de la plataforma son 529505. 5299 en el PUC es "Provisiones",
    # que no tiene nada que ver.
    "529505": "523560",
    "5299": "529505",
}

# Concepto de retención → subcuenta de 2365. El contador arma el formulario 350
# por concepto; con todo en 2365 plana tiene que desglosarlo a mano.
CUENTA_RETENCION: dict[str, str] = {
    "compras": "236540",
    "servicios": "236525",
    "honorarios": "236515",
    "arrendamientos": "236530",
    "rendimientos_financieros": "236535",
}


def naturaleza(tipo: str) -> str:
    return "debito" if tipo in ("activo", "gasto", "costo") else "credito"


def resolver(codigo: str) -> str:
    """Código PUC real para un código que puede ser viejo. Idempotente."""
    c = str(codigo or "").strip()
    return ALIAS.get(c, c)


def cuenta_retencion(concepto: str) -> str:
    """Subcuenta de 2365 para ese concepto de retención; 236595 si no se conoce."""
    return CUENTA_RETENCION.get(str(concepto or "").strip(), "236595")


def sembrar(con: sqlite3.Connection) -> int:
    """Crea las cuentas del PUC que falten. Idempotente (`INSERT OR IGNORE`)."""
    n = 0
    for codigo, nombre, tipo in PUC_MCKENNA:
        cur = con.execute(
            """INSERT OR IGNORE INTO cc_plan_cuentas
                 (codigo, nombre, tipo, naturaleza, es_movimiento, activa)
               VALUES (?, ?, ?, ?, 1, 1)""",
            (codigo, nombre, tipo, naturaleza(tipo)),
        )
        n += cur.rowcount or 0
    return n


def _asegurar_registro(con: sqlite3.Connection) -> None:
    """Deja constancia de qué alias ya se aplicaron.

    Sin esto `migrar()` NO es idempotente para un código reutilizado: tras la
    primera corrida, `529505` ya no es publicidad sino Comisiones, y volver a
    aplicar el alias `529505 → 523560` se llevaría los $52M de comisiones a
    publicidad. El estado del plan de cuentas no alcanza para saberlo (la cuenta
    quedó activa y con otro nombre, indistinguible de una que nunca se migró),
    así que se registra el hecho en vez de deducirlo.
    """
    con.execute("""
        CREATE TABLE IF NOT EXISTS cc_puc_alias_aplicados (
            alias TEXT PRIMARY KEY,
            destino TEXT NOT NULL,
            lineas INTEGER NOT NULL DEFAULT 0,
            aplicado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)


def alias_aplicados() -> set[str]:
    from app.services.contabilidad_core import _conn, _ensure

    _ensure()
    with _conn() as con:
        _asegurar_registro(con)
        return {r["alias"] for r in con.execute("SELECT alias FROM cc_puc_alias_aplicados")}


def _cuenta(con: sqlite3.Connection, codigo: str) -> dict | None:
    r = con.execute("SELECT * FROM cc_plan_cuentas WHERE codigo=?", (codigo,)).fetchone()
    return dict(r) if r else None


def _orden_migracion() -> list[tuple[str, str]]:
    """Alias ordenados para que un código se vacíe ANTES de recibir lo ajeno.

    `529505` es a la vez origen (la publicidad de MeLi se va a 523560) y destino
    (las comisiones de la plataforma llegan desde 5299). Si se procesa primero
    `5299 → 529505`, las comisiones aterrizan encima de la publicidad y después
    el paso `529505 → 523560` se lleva las dos a publicidad. Procesar un código
    como origen antes que como destino evita ese pisón.
    """
    pendientes = dict(ALIAS)
    orden: list[tuple[str, str]] = []
    while pendientes:
        # Un alias se puede correr cuando su DESTINO ya no es origen de otro
        # alias pendiente: así `529505 → 523560` (vaciar publicidad) corre antes
        # que `5299 → 529505` (traer comisiones), y no al revés.
        seguros = [o for o, d in pendientes.items() if d not in pendientes]
        if not seguros:  # ciclo: no lo hay hoy, pero no se falla en silencio
            raise ValueError(f"Ciclo de alias PUC sin resolver: {sorted(pendientes)}")
        for origen in sorted(seguros):
            orden.append((origen, pendientes.pop(origen)))
    return orden


def migrar(dry_run: bool = True) -> dict[str, Any]:
    """Mueve todo lo asentado en los códigos viejos a su código PUC real.

    Toca las tres tablas que apuntan a una cuenta: las líneas de los asientos,
    los medios de pago y la cuenta por pagar por defecto de cada tercero.

    Un código que queda vacío se desactiva con una nota que dice a dónde se fue
    — no se borra, porque un código que estuvo en uso es historia del libro. La
    excepción es un código **reutilizado** (`529505` deja de ser publicidad y
    pasa a ser comisiones): ese se queda activo y se le corrige el nombre al del
    decreto, porque sigue en uso, solo que para otra cosa.

    Con `dry_run=True` (el default) no escribe nada y devuelve lo que haría.
    """
    from app.services.contabilidad_core import _conn, _ensure

    _ensure()
    nombres_puc = {c: (n, t) for c, n, t in PUC_MCKENNA}
    reutilizados = set(ALIAS) & set(ALIAS.values())
    plan: list[dict[str, Any]] = []
    creadas = 0
    with _conn() as con:
        con.execute("BEGIN")
        try:
            _asegurar_registro(con)
            creadas = sembrar(con)
            hechos = {r["alias"] for r in con.execute("SELECT alias FROM cc_puc_alias_aplicados")}
            for viejo, nuevo in _orden_migracion():
                if viejo in hechos:
                    continue   # ya se aplicó: repetirlo movería lo que no toca
                origen = _cuenta(con, viejo)
                if not origen:
                    continue
                destino = _cuenta(con, nuevo)
                if not destino:
                    raise ValueError(f"Falta la cuenta destino {nuevo} en el PUC")
                if destino["id"] == origen["id"]:
                    raise ValueError(f"Alias circular en {viejo} → {nuevo}")
                lineas = con.execute(
                    "SELECT COUNT(*) n, COALESCE(SUM(debito),0) d, COALESCE(SUM(credito),0) c"
                    "  FROM cc_movimiento_lineas WHERE cuenta_id=?",
                    (origen["id"],),
                ).fetchone()
                medios = con.execute(
                    "SELECT COUNT(*) n FROM cc_medios_pago WHERE cuenta_id=?", (origen["id"],)
                ).fetchone()["n"]
                terceros = con.execute(
                    "SELECT COUNT(*) n FROM cc_terceros WHERE cuenta_por_pagar_id=?", (origen["id"],)
                ).fetchone()["n"]
                plan.append({
                    "de": viejo, "de_nombre": origen["nombre"],
                    "a": nuevo, "a_nombre": destino["nombre"],
                    "lineas": lineas["n"], "debito": round(lineas["d"], 2),
                    "credito": round(lineas["c"], 2),
                    "medios_pago": medios, "terceros": terceros,
                    "codigo_reutilizado": viejo in reutilizados,
                })
                con.execute(
                    "UPDATE cc_movimiento_lineas SET cuenta_id=? WHERE cuenta_id=?",
                    (destino["id"], origen["id"]),
                )
                con.execute(
                    "UPDATE cc_medios_pago SET cuenta_id=? WHERE cuenta_id=?",
                    (destino["id"], origen["id"]),
                )
                con.execute(
                    "UPDATE cc_terceros SET cuenta_por_pagar_id=? WHERE cuenta_por_pagar_id=?",
                    (destino["id"], origen["id"]),
                )
                if viejo in reutilizados:
                    # Sigue en uso, con otro significado: se le pone el nombre del
                    # decreto en vez de dejarlo diciendo lo que ya no es.
                    nombre_real, tipo_real = nombres_puc.get(viejo, (origen["nombre"], origen["tipo"]))
                    con.execute(
                        """UPDATE cc_plan_cuentas
                              SET nombre=?, tipo=?, naturaleza=?, activa=1,
                                  notas = TRIM(COALESCE(notas,'') || ' · Hasta sep-2026 este código se '
                                          || 'usó para «' || ? || '», que pasó a ' || ?)
                            WHERE id=?""",
                        (nombre_real, tipo_real, naturaleza(tipo_real),
                         origen["nombre"], nuevo, origen["id"]),
                    )
                else:
                    con.execute(
                        """UPDATE cc_plan_cuentas
                              SET activa=0,
                                  notas = TRIM(COALESCE(notas,'') || ' · Migrada al PUC real: ahora es '
                                          || ? || ' ' || ?)
                            WHERE id=?""",
                        (nuevo, destino["nombre"], origen["id"]),
                    )
                con.execute(
                    "INSERT OR REPLACE INTO cc_puc_alias_aplicados (alias, destino, lineas) VALUES (?,?,?)",
                    (viejo, nuevo, lineas["n"]),
                )
            if dry_run:
                con.execute("ROLLBACK")
            else:
                con.execute("COMMIT")
        except Exception:
            con.execute("ROLLBACK")
            raise

    return {
        "dry_run": dry_run,
        "cuentas_creadas": creadas,
        "movimientos": plan,
        "lineas_afectadas": sum(p["lineas"] for p in plan),
    }
