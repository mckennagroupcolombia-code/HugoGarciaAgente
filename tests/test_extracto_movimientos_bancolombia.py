"""CSV de «Movimientos» de Sucursal Negocios y recarga sin duplicar.

La conciliación no espera al cierre del mes: se baja el detalle de movimientos
(Reportes y archivos → Saldos consolidados → Movimientos) desde el 1 hasta hoy,
varias veces al mes. Eso significa que el MISMO día llega una y otra vez, y que
el archivo no trae encabezados ni líneas de saldo con las cuales verificarse.
Estos tests cubren esas dos cosas: que se lea bien y que recargarlo no duplique.
"""
from __future__ import annotations

import pytest


@pytest.fixture()
def extracto_db(monkeypatch, tmp_path):
    """Base de contabilidad aislada — las DOS rutas.

    `contabilidad_db` y `contabilidad_core` apuntan cada uno a su propio
    `_DB_PATH`. Aislar solo el primero dejó al segundo escribiendo en la base
    REAL: el 22-sep-2026 cada corrida de esta suite creó en producción once
    «Compra empaques», un «Pago proveedor», un «Intereses» y un «Cobro» que
    hubo que borrar a mano. Cualquier fixture que toque el libro tiene que
    aislar las dos.
    """
    db = tmp_path / "contabilidad_test.db"
    extractos_dir = tmp_path / "extractos"
    extractos_dir.mkdir()

    import app.services.contabilidad_core as cc
    import app.services.contabilidad_db as cdb
    import app.services.extracto_bancario as eb

    monkeypatch.setattr(cdb, "_DB_PATH", str(db))
    monkeypatch.setattr(cdb, "_initialized", False)
    monkeypatch.setattr(cc, "_DB_PATH", str(db))
    monkeypatch.setattr(cc, "_initialized", False)
    monkeypatch.setattr(eb, "_EXTRACTOS_DIR", str(extractos_dir))
    monkeypatch.setenv("CONTABILIDAD_FECHA_CORTE", "2026-01-01")
    cdb.init_db()
    cc.init_db()
    eb.ensure_extracto_tables()
    return eb


# Forma real del archivo: cuenta · sucursal · · AAAAMMDD · · valor con signo ·
# código · descripción · 0 · . El valor negativo es plata que salió.
CSV_SEP = (
    "428-000009-74, 428, , 20260901, , -1300000.00, 8162, PAGO A PROVE COMERCIALIZADOR, 0,\n"
    "428-000009-74, 428, , 20260901, , 39600.00, 4065, PAGO LLAVE TATIANA RA, 0,\n"
    "428-000009-74, 428, , 20260902, , 27.00, 2999, ABONO INTERESES AHORROS, 0,\n"
    "428-000009-74, 428, , 20260903, , -2586300.00, 8162, PAGO A PROVE CADIEP DISTRIBU, 0,\n"
    "428-000009-74, 428, , 20260903, , -2586300.00, 8162, PAGO A PROVE CADIEP DISTRIBU, 0,\n"
).encode("latin-1")


def test_lee_el_csv_de_movimientos(extracto_db):
    rows = extracto_db.parse_extracto_bytes(CSV_SEP, "CSV_42800000974_20260922.csv")
    assert len(rows) == 5
    assert rows[0]["fecha"] == "2026-09-01"
    assert rows[0]["tipo"] == "debito"
    assert rows[0]["monto"] == 1_300_000
    assert rows[0]["descripcion"] == "PAGO A PROVE COMERCIALIZADOR"
    # El código de transacción es lo único estable para reconocer la clase de
    # movimiento cuando el banco trunca la descripción.
    assert rows[0]["referencia"] == "8162"
    assert rows[1]["tipo"] == "credito"
    assert rows[1]["monto"] == 39_600


def test_no_se_confunde_con_un_csv_con_encabezados(extracto_db):
    con_encabezado = (
        "Fecha;Descripción;Débito;Crédito;Saldo\n"
        "01/09/2026;PAGO PROVEEDOR;1500000;;5000000\n"
    ).encode("utf-8")
    rows = extracto_db.parse_extracto_bytes(con_encabezado, "otro.csv")
    assert len(rows) == 1
    assert rows[0]["monto"] == 1_500_000


def test_recargar_el_mismo_archivo_no_duplica(extracto_db):
    primera = extracto_db.importar_extracto(CSV_SEP, "mov.csv", banco="Bancolombia")
    assert primera["lineas_count"] == 5
    assert primera["lineas_repetidas"] == 0

    # Se vuelve a bajar el mismo rango: no entra nada.
    with pytest.raises(ValueError, match="Nada nuevo"):
        extracto_db.importar_extracto(CSV_SEP, "mov.csv", banco="Bancolombia")

    with extracto_db._conn() as con:
        n = con.execute("SELECT COUNT(*) FROM extracto_movimientos").fetchone()[0]
    assert n == 5


def test_un_rango_mas_largo_solo_agrega_los_dias_nuevos(extracto_db):
    extracto_db.importar_extracto(CSV_SEP, "hasta_el_3.csv", banco="Bancolombia")
    mas_largo = CSV_SEP + (
        "428-000009-74, 428, , 20260904, , -517650.00, 8162, PAGO A PROVE TODO CAJAS, 0,\n"
    ).encode("latin-1")
    segunda = extracto_db.importar_extracto(mas_largo, "hasta_el_4.csv", banco="Bancolombia")
    assert segunda["lineas_leidas"] == 6
    assert segunda["lineas_count"] == 1
    assert segunda["lineas_repetidas"] == 5

    with extracto_db._conn() as con:
        n = con.execute("SELECT COUNT(*) FROM extracto_movimientos").fetchone()[0]
    assert n == 6


def test_dos_movimientos_iguales_el_mismo_dia_son_dos(extracto_db):
    """Los dos giros de $2.586.300 del 3-sep son pagos distintos, no una copia."""
    extracto_db.importar_extracto(CSV_SEP, "mov.csv", banco="Bancolombia")
    with extracto_db._conn() as con:
        n = con.execute(
            "SELECT COUNT(*) FROM extracto_movimientos WHERE fecha = ? AND monto = ?",
            ("2026-09-03", 2_586_300.0),
        ).fetchone()[0]
    assert n == 2


def test_la_recarga_mejora_una_descripcion_pobre(extracto_db):
    """El PDF del banco dice «Pago A Proveedores»; el CSV dice a quién."""
    pobre = (
        "Fecha;Descripción;Débito;Crédito\n"
        "01/09/2026;Pago A Proveedores;1300000;\n"
    ).encode("utf-8")
    extracto_db.importar_extracto(pobre, "historial.csv", banco="Bancolombia")

    solo_esa = (
        "428-000009-74, 428, , 20260901, , -1300000.00, 8162, PAGO A PROVE COMERCIALIZADOR, 0,\n"
    ).encode("latin-1")
    with pytest.raises(ValueError, match="Nada nuevo"):
        extracto_db.importar_extracto(solo_esa, "mov.csv", banco="Bancolombia")

    with extracto_db._conn() as con:
        fila = con.execute(
            "SELECT descripcion, referencia FROM extracto_movimientos WHERE fecha = ?",
            ("2026-09-01",),
        ).fetchone()
    assert fila[0] == "PAGO A PROVE COMERCIALIZADOR"
    assert fila[1] == "8162"


# ── Emparejado del taller (app/services/conciliacion_taller.py) ─────────────


def _libro(**kw):
    base = {
        "id": "x1",
        "fecha": "2026-09-15",
        "tipo": "egreso",
        "monto": 1_200_000.0,
        "concepto": "Servicios",
        "contraparte": "",
        "fuente": "solicitud_pago",
        "referencia": "",
    }
    base.update(kw)
    return base


def _banco(**kw):
    base = {"fecha": "2026-09-15", "tipo": "debito", "monto": 1_200_000.0}
    base.update(kw)
    return base


def test_candidato_solo_del_lado_correcto():
    """Un débito del banco es plata que salió: solo puede calzar con un egreso."""
    from app.services import conciliacion_taller as ct

    assert ct._candidatos(_banco(), [_libro()])
    assert not ct._candidatos(_banco(), [_libro(tipo="ingreso")])
    assert ct._candidatos(_banco(tipo="credito"), [_libro(tipo="ingreso")])


def test_candidato_dentro_de_la_ventana_de_dias():
    """El asiento va con la fecha de la cuenta de cobro; el banco paga después."""
    from app.services import conciliacion_taller as ct

    assert ct._candidatos(_banco(), [_libro(fecha="2026-09-12")])
    assert not ct._candidatos(_banco(), [_libro(fecha="2026-09-01")])


def test_un_asiento_ya_vinculado_no_vuelve_a_ser_candidato():
    from app.services import conciliacion_taller as ct

    assert not ct._candidatos(_banco(), [_libro(extracto={"vinculo_id": 1})])


def test_el_candidato_mas_parecido_va_primero():
    from app.services import conciliacion_taller as ct

    cands = ct._candidatos(
        _banco(),
        [_libro(id="lejos", fecha="2026-09-12"), _libro(id="mismo_dia")],
    )
    assert [c["movimiento_id"] for c in cands] == ["mismo_dia", "lejos"]


# ── El archivo llega comprimido ────────────────────────────────────────────


def _zip_con(nombres_y_datos):
    import io
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for nombre, datos in nombres_y_datos:
            z.writestr(nombre, datos)
    return buf.getvalue()


def test_se_puede_subir_el_zip_tal_como_lo_da_el_banco(extracto_db):
    z = _zip_con([("CSV_42800000974_20260922.csv", CSV_SEP)])
    rows = extracto_db.parse_extracto_bytes(z, "CSV_42800000974_20260922.zip")
    assert len(rows) == 5
    assert rows[0]["descripcion"] == "PAGO A PROVE COMERCIALIZADOR"


def test_un_zip_con_varios_archivos_no_adivina(extracto_db):
    z = _zip_con([("uno.csv", CSV_SEP), ("dos.csv", CSV_SEP)])
    with pytest.raises(ValueError, match="2 archivos"):
        extracto_db.parse_extracto_bytes(z, "varios.zip")


# ── El tablero no espera a Alegra/MeLi ─────────────────────────────────────


@pytest.fixture()
def tablero_db(extracto_db, monkeypatch):
    """Un extracto de dos líneas y la caché del taller limpia. Sin la causación
    automática del 4x1000 y los intereses: estos tests miran esas líneas SIN causar."""
    from app.services import conciliacion_taller as ct

    monkeypatch.setenv("EXTRACTO_CAUSAR_AUTOMATICO", "0")
    extracto_db.importar_extracto(CSV_SEP, "mov.csv", banco="Bancolombia")
    ct.invalidar_cache_taller()
    return ct


def _libro_de_prueba(*_a, **_k):
    """Un asiento que calza con el giro de $1.300.000 del 1-sep."""
    return [_libro(id="asiento-1", fecha="2026-09-01", monto=1_300_000.0, concepto="Pago proveedor")], []


def test_con_el_libro_frio_responde_sin_esperar(tablero_db, monkeypatch):
    """Cold cache: responde ya, dice que el libro se está armando, y no marca
    nada como «sin causar» — eso todavía no se sabe."""
    ct = tablero_db
    arranques = []
    monkeypatch.setattr(ct, "_armar_en_segundo_plano", lambda clave, traer: arranques.append(clave))
    t = ct.tablero("2026-09-01", "2026-09-30", _traer=_libro_de_prueba)
    assert t["libro_listo"] is False
    assert arranques, "debe arrancar el hilo que arma el libro"
    assert {l["estado"] for l in t["lineas"]} == {"revisando"}
    assert t["totales"]["sin_causar"] == 0


def test_con_el_libro_listo_empareja(tablero_db):
    ct = tablero_db
    t = ct.tablero("2026-09-01", "2026-09-30", esperar=True, _traer=_libro_de_prueba)
    assert t["libro_listo"] is True
    por_monto = {l["monto"]: l for l in t["lineas"]}
    assert por_monto[1_300_000.0]["estado"] == "sugerida"
    assert por_monto[1_300_000.0]["candidatos"][0]["movimiento_id"] == "asiento-1"
    assert por_monto[39_600.0]["estado"] == "sin_causar"


def test_el_libro_vencido_se_sigue_usando_mientras_se_rearma(tablero_db, monkeypatch):
    """Un libro vencido NO devuelve el taller a «revisando».

    Esto fue un bug reportado: cada cinco minutos vencía la caché y, durante los
    ~30 s que tarda Alegra, todas las líneas volvían a `revisando`. El emergente
    del asiento reemplaza entonces los botones por «Buscando en el libro…», así
    que el operador le daba clic a «Causar así» y no pasaba nada —el botón se
    había ido debajo del cursor—. El libro viejo se sigue sirviendo mientras el
    hilo trae el nuevo.
    """
    ct = tablero_db
    t = ct.tablero("2026-09-01", "2026-09-30", esperar=True, _traer=_libro_de_prueba)
    assert t["libro_listo"] is True and t["libro_fresco"] is True

    monkeypatch.setattr(ct, "_TTL_S", -1.0)  # todo lo guardado queda vencido
    arranques = []
    monkeypatch.setattr(ct, "_armar_en_segundo_plano", lambda clave, traer: arranques.append(clave))

    t2 = ct.tablero("2026-09-01", "2026-09-30", _traer=_libro_de_prueba)
    assert t2["libro_listo"] is True, "el libro viejo se sigue usando"
    assert t2["libro_fresco"] is False, "pero se avisa que está viejo"
    assert arranques, "y se rearma en segundo plano"
    por_monto = {l["monto"]: l for l in t2["lineas"]}
    assert por_monto[1_300_000.0]["estado"] == "sugerida"
    assert por_monto[39_600.0]["estado"] == "sin_causar"
    assert "revisando" not in {l["estado"] for l in t2["lineas"]}


def test_vincular_no_vuelve_a_pedir_el_libro(tablero_db):
    """Después de vincular, el tablero sale de la caché propia y ya no propone
    el asiento que acaba de quedar unido: el vínculo se lee fresco de la base."""
    ct = tablero_db
    llamadas = []

    def traer(*a, **k):
        llamadas.append(1)
        return _libro_de_prueba()

    t = ct.tablero("2026-09-01", "2026-09-30", esperar=True, _traer=traer)
    linea = next(l for l in t["lineas"] if l["monto"] == 1_300_000.0)
    tablero_db and __import__("app.services.extracto_bancario", fromlist=["vincular"]).vincular(linea["id"], "asiento-1")

    t2 = ct.tablero("2026-09-01", "2026-09-30", esperar=True, _traer=traer)
    assert len(llamadas) == 1, "el libro no se vuelve a pedir por vincular"
    linea2 = next(l for l in t2["lineas"] if l["monto"] == 1_300_000.0)
    assert linea2["estado"] == "vinculada"
    assert all(c["movimiento_id"] != "asiento-1" for l in t2["lineas"] for c in l["candidatos"])


def test_refrescar_tira_la_cache(tablero_db):
    ct = tablero_db
    llamadas = []

    def traer(*a, **k):
        llamadas.append(1)
        return _libro_de_prueba()

    ct.tablero("2026-09-01", "2026-09-30", esperar=True, _traer=traer)
    ct.tablero("2026-09-01", "2026-09-30", esperar=True, refrescar=True, _traer=traer)
    assert len(llamadas) == 2


# ── Comprobaciones: un vínculo se verifica contra el asiento, no se cree ────


def test_un_vinculo_a_un_asiento_propio_se_comprueba_al_peso(tablero_db, monkeypatch):
    """`cc:<id>` se lee de la base aunque el libro no esté: si el asiento dice la
    misma plata, cuadra; si alguien lo cambió, descuadra y se ve cuánto."""
    import app.services.contabilidad_core as cc
    from app.services import extracto_bancario as eb

    ct = tablero_db
    monkeypatch.setattr(ct, "_armar_en_segundo_plano", lambda *a, **k: None)
    t = ct.tablero("2026-09-01", "2026-09-30")
    linea = next(l for l in t["lineas"] if l["monto"] == 1_300_000.0)

    with cc._conn() as con:
        banco = con.execute("SELECT id FROM cc_plan_cuentas WHERE codigo='1110'").fetchone()[0]
        gasto = con.execute("SELECT id FROM cc_plan_cuentas WHERE codigo='2205'").fetchone()[0]
    mov = cc.crear_movimiento(
        fecha="2026-09-01", concepto="Pago proveedor",
        lineas=[{"cuenta_id": gasto, "debito": 1_300_000, "credito": 0},
                {"cuenta_id": banco, "debito": 0, "credito": 1_300_000}],
        referencia=f"extracto:{linea['id']}", tipo_origen="egreso",
    )
    eb.vincular(linea["id"], f"cc:{mov['id']}")

    t2 = ct.tablero("2026-09-01", "2026-09-30")
    l2 = next(l for l in t2["lineas"] if l["id"] == linea["id"])
    assert l2["estado"] == "vinculada"
    assert l2["comprobacion"]["cuadra"] is True
    assert l2["comprobacion"]["diferencia"] == 0
    assert t2["comprobacion"]["cuadradas"] == 1
    assert t2["comprobacion"]["banco_conciliado"] == t2["comprobacion"]["libro_conciliado"] == 1_300_000.0

    # Alguien cambia la línea de bancos por debajo: el vínculo sigue, la
    # comprobación lo delata por dos lados — no gira lo que el banco giró, y el
    # asiento quedó descuadrado (débitos ≠ créditos).
    with cc._conn() as con:
        con.execute("UPDATE cc_movimiento_lineas SET credito = ? WHERE movimiento_id = ? AND credito > 0", (1_250_000, mov["id"]))
    t3 = ct.tablero("2026-09-01", "2026-09-30")
    l3 = next(l for l in t3["lineas"] if l["id"] == linea["id"])
    assert l3["comprobacion"]["cuadra"] is False
    assert l3["comprobacion"]["balanceado"] is False
    assert l3["comprobacion"]["diferencia"] == 50_000.0
    assert t3["comprobacion"]["descuadradas"] == 1
    assert t3["comprobacion"]["diferencia"] == 50_000.0

    # Y si solo tocan inventario, bancos sigue diciendo lo del banco pero el
    # asiento ya no balancea: tampoco cuadra.
    with cc._conn() as con:
        con.execute("UPDATE cc_movimiento_lineas SET credito = ? WHERE movimiento_id = ? AND credito > 0", (1_300_000, mov["id"]))
        con.execute("UPDATE cc_movimiento_lineas SET debito = ? WHERE movimiento_id = ? AND debito > 0", (1_250_000, mov["id"]))
    l4 = next(l for l in ct.tablero("2026-09-01", "2026-09-30")["lineas"] if l["id"] == linea["id"])
    assert l4["comprobacion"]["diferencia"] == 0
    assert l4["comprobacion"]["balanceado"] is False
    assert l4["comprobacion"]["cuadra"] is False


def test_un_vinculo_a_un_asiento_anulado_no_cuadra(tablero_db, monkeypatch):
    import app.services.contabilidad_core as cc
    from app.services import extracto_bancario as eb

    ct = tablero_db
    monkeypatch.setattr(ct, "_armar_en_segundo_plano", lambda *a, **k: None)
    linea = next(l for l in ct.tablero("2026-09-01", "2026-09-30")["lineas"] if l["monto"] == 39_600.0)
    with cc._conn() as con:
        banco = con.execute("SELECT id FROM cc_plan_cuentas WHERE codigo='1110'").fetchone()[0]
        ventas = con.execute("SELECT id FROM cc_plan_cuentas WHERE codigo='4135'").fetchone()[0]
    mov = cc.crear_movimiento(
        fecha="2026-09-01", concepto="Cobro",
        lineas=[{"cuenta_id": banco, "debito": 39_600, "credito": 0},
                {"cuenta_id": ventas, "debito": 0, "credito": 39_600}],
        tipo_origen="ingreso",
    )
    eb.vincular(linea["id"], f"cc:{mov['id']}")
    with cc._conn() as con:
        con.execute("UPDATE cc_movimientos SET estado='anulado' WHERE id=?", (mov["id"],))
    l = next(x for x in ct.tablero("2026-09-01", "2026-09-30")["lineas"] if x["id"] == linea["id"])
    assert l["comprobacion"]["existe"] is False
    assert l["comprobacion"]["cuadra"] is False


def test_la_comprobacion_dice_si_la_compra_toco_inventario(tablero_db, monkeypatch):
    """Cuadrar al peso no basta: una compra causada como gasto y una causada contra
    1435 con sus productos cuadran igual. La comprobación tiene que distinguirlas."""
    import app.services.contabilidad_core as cc
    from app.services import extracto_bancario as eb

    ct = tablero_db
    monkeypatch.setattr(ct, "_armar_en_segundo_plano", lambda *a, **k: None)
    linea = next(l for l in ct.tablero("2026-09-01", "2026-09-30")["lineas"] if l["monto"] == 1_300_000.0)

    with cc._conn() as con:
        banco = con.execute("SELECT id FROM cc_plan_cuentas WHERE codigo='1110'").fetchone()[0]
        inventario = con.execute("SELECT id FROM cc_plan_cuentas WHERE codigo='1435'").fetchone()[0]
    mov = cc.crear_movimiento(
        fecha="2026-09-01", concepto="Compra de insumos",
        lineas=[{"cuenta_id": inventario, "debito": 1_300_000, "credito": 0, "descripcion": "CITCALg CITRATO · 10 kg × 130.000"},
                {"cuenta_id": banco, "debito": 0, "credito": 1_300_000}],
        tipo_origen="solicitud_pago",
    )
    eb.vincular(linea["id"], f"cc:{mov['id']}")

    l = next(x for x in ct.tablero("2026-09-01", "2026-09-30")["lineas"] if x["id"] == linea["id"])
    c = l["comprobacion"]
    assert c["cuadra"] is True
    assert c["inventario"] is True
    assert c["iva_descontable"] is False
    assert [x["cuenta"] for x in c["lineas"]] == ["1435", "1110"]
    assert c["lineas"][0]["debito"] == 1_300_000.0 and c["lineas"][1]["credito"] == 1_300_000.0


def test_una_compra_con_retencion_cuadra_contra_lo_girado(tablero_db, monkeypatch):
    """Factura 1.000.000 con retención 25.000: el asiento debita 1.000.000 y
    acredita a bancos 975.000. El banco dice 975.000. Eso CUADRA."""
    import app.services.contabilidad_core as cc
    from app.services import extracto_bancario as eb

    ct = tablero_db
    monkeypatch.setattr(ct, "_armar_en_segundo_plano", lambda *a, **k: None)
    with cc._conn() as con:
        banco = con.execute("SELECT id FROM cc_plan_cuentas WHERE codigo='1110'").fetchone()[0]
        inventario = con.execute("SELECT id FROM cc_plan_cuentas WHERE codigo='1435'").fetchone()[0]
        ret = con.execute("SELECT id FROM cc_plan_cuentas WHERE codigo LIKE '2365%' ORDER BY codigo LIMIT 1").fetchone()
        ret_id = ret[0] if ret else cc.crear_cuenta({"codigo": "2365", "nombre": "Retención en la fuente", "tipo": "pasivo"})["id"]
    # La línea del banco: 975.000 el 2 de septiembre.
    csv = "428-000009-74, 428, , 20260902, , -975000.00, 8162, PAGO A PROVE EMPAQUES SAS, 0,\n".encode("latin-1")
    eb.importar_extracto(csv, "ret.csv", banco="Bancolombia")
    linea = next(l for l in ct.tablero("2026-09-01", "2026-09-30")["lineas"] if l["monto"] == 975_000.0)
    mov = cc.crear_movimiento(
        fecha="2026-09-02", concepto="Compra empaques",
        lineas=[{"cuenta_id": inventario, "debito": 1_000_000, "credito": 0},
                {"cuenta_id": ret_id, "debito": 0, "credito": 25_000},
                {"cuenta_id": banco, "debito": 0, "credito": 975_000}],
        tipo_origen="solicitud_pago",
    )
    eb.vincular(linea["id"], f"cc:{mov['id']}")
    l = next(x for x in ct.tablero("2026-09-01", "2026-09-30")["lineas"] if x["id"] == linea["id"])
    assert l["comprobacion"]["cuadra"] is True
    assert l["comprobacion"]["monto"] == 975_000.0
    assert l["comprobacion"]["total_asiento"] == 1_000_000.0


def test_la_linea_del_banco_respalda_el_registro_directo(extracto_db, monkeypatch):
    """Sin ser admin, con `origen_ref = extracto:<id>` de una salida sin vínculo se
    puede registrar; si el asiento no gira lo que el banco giró, se niega."""
    from app.services import pagos_wizard as pw

    csv = "428-000009-74, 428, , 20260902, , -5000.00, 8162, PAGO A PROVE EMPAQUES SAS, 0,\n".encode("latin-1")
    ex = extracto_db.importar_extracto(csv, "bolsa.csv", banco="Bancolombia")
    linea_id = extracto_db.obtener_extracto(ex["id"])["movimientos"][0]["id"]

    assert pw._linea_banco_que_respalda({"origen_ref": f"extracto:{linea_id}"})
    assert pw._linea_banco_que_respalda({"origen_ref": "extracto:999999"}) is None
    assert pw._linea_banco_que_respalda({"origen_ref": "factura 12"}) is None

    operario = {"id": 7, "nombre": "Jenniffer", "rol": {"nivel": 1}}
    monkeypatch.setattr(pw, "previsualizar", lambda payload: {"girado": 4_500, "monto": 5_000, "retencion": 500, "retencion_ica": 0})
    with pytest.raises(ValueError, match="banco giró 5.000"):
        pw.registrar_pago_directo({"origen_ref": f"extracto:{linea_id}"}, operario)
    with pytest.raises(ValueError, match="administrador"):
        pw.registrar_pago_directo({"origen_ref": ""}, operario)


def test_cada_linea_trae_su_asiento_como_cuentas_t(tablero_db, monkeypatch):
    """Sin causar: el asiento PROPUESTO (cuenta del clasificador contra bancos) con
    saldo antes → después. Vinculada: el asiento REAL sin contar el movimiento dos veces."""
    import app.services.contabilidad_core as cc
    from app.services import extracto_bancario as eb

    ct = tablero_db
    monkeypatch.setattr(ct, "_armar_en_segundo_plano", lambda *a, **k: None)
    t = ct.tablero("2026-09-01", "2026-09-30", esperar=True, _traer=lambda *a, **k: ([], []))
    intereses = next(l for l in t["lineas"] if l["monto"] == 27.0)   # ABONO INTERESES AHORROS → 421005, alta
    v = intereses["asiento_vista"]
    assert v and v["origen"] == "propuesto"
    assert [x["cuenta_codigo"] for x in v["lineas"]] == ["421005", "1110"]
    assert v["lineas"][0]["credito"] == 27.0 and v["lineas"][1]["debito"] == 27.0
    banco_t = next(x for x in v["cuentas_t"] if x["cuenta_codigo"] == "1110")
    assert banco_t["saldo_despues"] == banco_t["saldo_antes"] + 27.0

    with cc._conn() as con:
        banco = con.execute("SELECT id FROM cc_plan_cuentas WHERE codigo='1110'").fetchone()[0]
        ing = con.execute("SELECT id FROM cc_plan_cuentas WHERE codigo='4295'").fetchone()
        ing_id = ing[0] if ing else cc.crear_cuenta({"codigo": "4295", "nombre": "Diversos", "tipo": "ingreso"})["id"]
    mov = cc.crear_movimiento(fecha="2026-09-02", concepto="Intereses",
                              lineas=[{"cuenta_id": banco, "debito": 27, "credito": 0}, {"cuenta_id": ing_id, "debito": 0, "credito": 27}],
                              tipo_origen="ingreso")
    eb.vincular(intereses["id"], f"cc:{mov['id']}")
    l2 = next(x for x in ct.tablero("2026-09-01", "2026-09-30")["lineas"] if x["id"] == intereses["id"])
    v2 = l2["asiento_vista"]
    assert v2["origen"] == "real"
    banco_t2 = next(x for x in v2["cuentas_t"] if x["cuenta_codigo"] == "1110")
    # Ya posteado: «después» es el saldo actual; «antes» lo descuenta una sola vez.
    assert banco_t2["saldo_despues"] - banco_t2["saldo_antes"] == 27.0


# ── Causación en el momento: la venta nace con su asiento ───────────────────


@pytest.fixture()
def libro_propio(monkeypatch, tmp_path):
    import app.services.contabilidad_core as cc

    db = str(tmp_path / "cc.db")
    monkeypatch.setattr(cc, "_DB_PATH", db)
    monkeypatch.setattr(cc, "_initialized", False)
    monkeypatch.setenv("CONTABILIDAD_FECHA_CORTE", "2026-01-01")
    cc.init_db()
    return cc


VENTA = {
    "id": 1, "numero": "COT-20260918-001", "origen": "manual", "estado": "facturada",
    "cliente": {"nombre": "EQUISURE S.A.S", "identificacion": "901504420"},
    "total": 2_353_000.0, "factura_numero": "FE465", "facturado": "2026-09-19T10:35:55",
}


def test_la_venta_directa_se_causa_al_facturar_y_el_cron_no_la_repite(libro_propio):
    from app.services import contabilidad_autopost as ap
    from app.services.contabilidad_ledger import _row
    from app.services.extracto_bancario import id_movimiento_ledger

    r = ap.causar_venta_directa(VENTA)
    assert r["creado"] and r["movimiento_id"]
    mov = libro_propio.obtener_movimiento(r["movimiento_id"])
    assert sorted(l["cuenta_codigo"] for l in mov["lineas"]) == ["1110", "4135"]
    assert mov["total_debito"] == 2_353_000.0

    # Segunda vez: nada.
    assert ap.causar_venta_directa(VENTA)["omitido"] is True

    # La fila que el cron armará desde Alegra tiene el MISMO hash…
    fila_cron = _row(fecha="2026-09-19", tipo="ingreso", fuente="siigo_venta", concepto="Venta Alegra",
                     monto=2_353_000, referencia="FE465", contraparte="901504420")
    assert r["referencia"] == f"auto:{id_movimiento_ledger(fila_cron)}"
    assert ap.postear_fila(fila_cron)["omitido"] is True

    # …y aunque Alegra trajera el NIT con otro formato (otro hash), el número
    # de factura la frena igual.
    fila_distinta = _row(fecha="2026-09-19", tipo="ingreso", fuente="siigo_venta", concepto="Venta Alegra",
                         monto=2_353_000, referencia="FE465", contraparte="901504420-1")
    assert ap.postear_fila(fila_distinta)["omitido"] is True


def test_una_venta_meli_no_se_causa_como_venta_alegra(libro_propio):
    from app.services import contabilidad_autopost as ap

    r = ap.causar_venta_directa({**VENTA, "origen": "meli"})
    assert r["omitido"] and "meli" in r["motivo"]


def test_el_taller_comprueba_la_venta_causada_por_su_hash(tablero_db, monkeypatch):
    """La línea del banco se vincula al id-hash de la venta (como hace el libro);
    el taller encuentra el asiento auto:<hash> y lo verifica con sus líneas."""
    import app.services.contabilidad_core as cc
    from app.services import contabilidad_autopost as ap
    from app.services import extracto_bancario as eb
    from app.services.contabilidad_ledger import _row
    from app.services.extracto_bancario import id_movimiento_ledger

    ct = tablero_db
    monkeypatch.setattr(ct, "_armar_en_segundo_plano", lambda *a, **k: None)
    monkeypatch.setenv("CONTABILIDAD_FECHA_CORTE", "2026-01-01")
    csv = "428-000009-74, 428, , 20260918, , 2353000.00, 4160, TRANSFERENCIA CTA SUC VIRTUAL, 0,\n".encode("latin-1")
    eb.importar_extracto(csv, "equisure.csv", banco="Bancolombia")
    linea = next(l for l in ct.tablero("2026-09-01", "2026-09-30")["lineas"] if l["monto"] == 2_353_000.0)

    fila = _row(fecha="2026-09-19", tipo="ingreso", fuente="siigo_venta", concepto="Venta Alegra",
                monto=2_353_000, referencia="FE465", contraparte="901504420")
    ap.postear_fila(fila)
    eb.vincular(linea["id"], id_movimiento_ledger(fila))   # el id del libro, no cc:

    l = next(x for x in ct.tablero("2026-09-01", "2026-09-30")["lineas"] if x["id"] == linea["id"])
    c = l["comprobacion"]
    assert c["cuadra"] is True
    assert [x["cuenta"] for x in c["lineas"]] == ["1110", "4135"]
    assert l["asiento_vista"]["origen"] == "real"
    assert any(t["cuenta_codigo"] == "4135" for t in l["asiento_vista"]["cuentas_t"])


def test_una_venta_ya_causada_es_candidata_aunque_alegra_no_responda(tablero_db, monkeypatch):
    """FE465, 22-sep-2026: el cron ya la había posteado, Alegra no la devolvió a
    tiempo y el taller decía «nadie registró esta operación»."""
    from app.services import contabilidad_autopost as ap
    from app.services import extracto_bancario as eb
    from app.services.contabilidad_ledger import _row

    ct = tablero_db
    monkeypatch.setenv("CONTABILIDAD_FECHA_CORTE", "2026-01-01")
    csv = "428-000009-74, 428, , 20260918, , 2353000.00, 4160, TRANSFERENCIA CTA SUC VIRTUAL, 0,\n".encode("latin-1")
    eb.importar_extracto(csv, "equisure.csv", banco="Bancolombia")
    fila = _row(fecha="2026-09-19", tipo="ingreso", fuente="siigo_venta", concepto="Venta Alegra",
                monto=2_353_000, referencia="FE465", contraparte="901504420")
    ap.postear_fila(fila)

    # Alegra «no responde»: armar_libro no trae nada. El taller igual la encuentra en el libro propio.
    t = ct.tablero("2026-09-01", "2026-09-30", esperar=True, refrescar=True,
                   _traer=lambda d, h, **k: (ct._asientos_auto_como_libro(d, h, set()), []))
    l = next(x for x in t["lineas"] if x["monto"] == 2_353_000.0)
    assert l["estado"] == "sugerida"
    c = l["candidatos"][0]
    assert c["fuente"] == "siigo_venta" and c["referencia"] == "FE465" and c["dias"] == 1
    assert c["documento"]["tipo"] == "factura" and c["documento"]["numero"] == "FE465"
    assert c["documento"]["cliente"]["identificacion"] == "901504420"
    assert l["asiento_vista"]["origen"] == "candidato"
    assert [x["cuenta_codigo"] for x in l["asiento_vista"]["lineas"]] == ["1110", "4135"]


def test_el_cliente_queda_como_tercero_desde_la_cotizacion_y_el_asiento_lo_lleva(libro_propio):
    from app.services import contabilidad_autopost as ap
    from app.services import ventas_directas as vd

    t1 = vd.asegurar_tercero_cliente(VENTA)
    assert t1 and t1["tipo"] == "cliente" and t1["tipo_persona"] == "juridica"
    # Segunda vez (al facturar): el mismo, por identificación, aunque venga con puntos o DV.
    t2 = vd.asegurar_tercero_cliente({**VENTA, "cliente": {"nombre": "EQUISURE SAS", "identificacion": "901.504.420-1"}})
    assert t2["id"] == t1["id"]
    assert len([t for t in libro_propio.listar_terceros(solo_activos=False) if t["tipo"] == "cliente"]) == 1

    r = ap.causar_venta_directa(VENTA)
    assert r["creado"] and r["tercero_id"] == t1["id"]
    mov = libro_propio.obtener_movimiento(r["movimiento_id"])
    assert mov["tercero"]["nombre"] == "EQUISURE S.A.S"


def test_sin_identificacion_no_se_inventa_tercero(libro_propio):
    from app.services import ventas_directas as vd

    assert vd.asegurar_tercero_cliente({**VENTA, "cliente": {"nombre": "Alguien", "identificacion": ""}}) is None


# ── MercadoPago: la venta entra a la plataforma; el retiro es un traslado ───


def test_la_venta_meli_se_postea_contra_mercadopago_no_contra_bancos(libro_propio):
    from app.services import contabilidad_autopost as ap
    from app.services.contabilidad_ledger import _row

    r = ap.postear_fila(_row(fecha="2026-09-15", tipo="ingreso", fuente="meli_venta", concepto="Venta MeLi",
                             monto=67_915, referencia="2000015039438233", contraparte="X", extra={"order_id": "2000018591066186"}))
    PLATAFORMA = {"111010", "112515", "130505"}   # la cuenta por cobrar a Mercado Pago; nunca Bancos
    mov = libro_propio.obtener_movimiento(r["movimiento_id"])
    mp = next(l["cuenta_codigo"] for l in mov["lineas"] if l["debito"] > 0)
    assert mp in PLATAFORMA
    assert {(l["cuenta_codigo"], l["debito"], l["credito"]) for l in mov["lineas"]} == {(mp, 67_915.0, 0.0), ("4135", 0.0, 67_915.0)}
    r2 = ap.postear_fila(_row(fecha="2026-09-15", tipo="egreso", fuente="meli_cobro", concepto="Comisión MeLi",
                              monto=8_000, referencia="2000015039438233", contraparte="X", extra={"order_id": "2000018591066186"}))
    mov2 = libro_propio.obtener_movimiento(r2["movimiento_id"])
    assert {(l["cuenta_codigo"], l["debito"], l["credito"]) for l in mov2["lineas"]} == {("5299", 8_000.0, 0.0), (mp, 0.0, 8_000.0)}


def test_el_retiro_de_mercadopago_se_propone_como_traslado(tablero_db, monkeypatch):
    from app.services import extracto_bancario as eb

    ct = tablero_db
    monkeypatch.setattr(ct, "_armar_en_segundo_plano", lambda *a, **k: None)
    csv = "428-000009-74, 428, , 20260921, , 9000000.00, 2142, PAGO INTERBANC MERCADOPAGO SA, 0,\n".encode("latin-1")
    eb.importar_extracto(csv, "mp.csv", banco="Bancolombia")
    l = next(x for x in ct.tablero("2026-09-01", "2026-09-30")["lineas"] if x["monto"] == 9_000_000.0)
    assert l["propuesta"]["cuenta"] == "130505" and l["propuesta"]["confianza"] == "alta"


def test_el_lote_de_un_retiro_es_lo_liberado_desde_el_anterior(tablero_db, monkeypatch, tmp_path):
    import json
    from app.services import extracto_bancario as eb
    from app.services import mp_liberaciones as mp
    from app.services import contabilidad_autopost as ap
    from app.services.contabilidad_ledger import _row

    monkeypatch.setenv("CONTABILIDAD_FECHA_CORTE", "2026-01-01")
    csv = ("428-000009-74, 428, , 20260914, , 9000000.00, 2142, PAGO INTERBANC MERCADOPAGO SA, 0,\n"
           "428-000009-74, 428, , 20260921, , 9000000.00, 2142, PAGO INTERBANC MERCADOPAGO SA, 0,\n").encode("latin-1")
    ex = eb.importar_extracto(csv, "mp.csv", banco="Bancolombia")
    lineas = {m["fecha"]: m["id"] for m in eb.obtener_extracto(ex["id"])["movimientos"]}

    # Índice de facturación MeLi de prueba.
    idx = tmp_path / "idx.json"
    idx.write_text(json.dumps({"indice": {"O1": {"factura_numero": "FV-2-71423", "factura_fecha": "2026-09-16", "total": 100_000}}}), encoding="utf-8")
    monkeypatch.setattr(mp, "_INDICE_FACTURAS", str(idx))
    # Y la venta O1 ya posteada en el libro.
    ap.postear_fila(_row(fecha="2026-09-15", tipo="ingreso", fuente="meli_venta", concepto="Venta MeLi", monto=100_000,
                         referencia="P1", contraparte="C", extra={"order_id": "O1"}))

    ventanas = []
    def pagos_falsos(desde, hasta):
        ventanas.append((desde, hasta))
        return [
            {"payment_id": "p1", "order_id": "O1", "referencia": "", "fecha_pago": "2026-09-15", "fecha_liberacion": "2026-09-18",
             "bruto": 100_000, "comision": 12_000, "neto": 88_000, "descripcion": "", "estado_liberacion": "released"},
            {"payment_id": "p2", "order_id": "O2", "referencia": "", "fecha_pago": "2026-09-16", "fecha_liberacion": "2026-09-20",
             "bruto": 50_000, "comision": 6_000, "neto": 44_000, "descripcion": "", "estado_liberacion": "released"},
        ]
    lote = mp.lote_de_retiro(lineas["2026-09-21"], _pagos=pagos_falsos)
    assert ventanas == [("2026-09-15", "2026-09-21")]   # el día después del retiro anterior, hasta éste
    assert lote["retiro_anterior"]["fecha"] == "2026-09-14"
    assert lote["n_pagos"] == 2 and lote["liberado_bruto"] == 150_000 and lote["liberado_neto"] == 132_000
    assert lote["queda_en_plataforma"] == 132_000 - 9_000_000
    p1 = next(p for p in lote["pagos"] if p["order_id"] == "O1")
    assert p1["asiento"]["monto"] == 100_000 and p1["factura"]["numero"] == "FV-2-71423"
    assert lote["n_con_asiento"] == 1 and lote["n_con_factura"] == 1


# ── Pagar de más deja un anticipo a favor con el proveedor ──────────────────


def test_pagar_mas_que_la_factura_deja_anticipo_al_proveedor(libro_propio, monkeypatch):
    """La transferencia salió por la cotización (1.300.000); la factura vino por
    1.190.000. El exceso no es gasto: es un anticipo (133005) con el tercero."""
    from app.services import pagos_wizard as pw

    cc = libro_propio
    monkeypatch.setattr(pw, "_DB_PATH", cc._DB_PATH, raising=False)
    pw._ensure()
    prov = cc.crear_tercero({"nombre": "COMERCIALIZADORA INTERNACIONAL C.I. S.A.S.", "tipo": "proveedor", "tipo_persona": "juridica", "identificacion": "811000608"})
    with cc._conn() as con:
        banco = con.execute("SELECT id FROM cc_plan_cuentas WHERE codigo='1110'").fetchone()[0]
        medio = con.execute("SELECT id FROM cc_medios_pago LIMIT 1").fetchone()
        medio_id = medio[0] if medio else con.execute("INSERT INTO cc_medios_pago (nombre, cuenta_id, activo) VALUES ('Bancolombia', ?, 1)", (banco,)).lastrowid
    cat_id = next(k for k, c in pw.CATEGORIAS.items() if c.get("con_productos") and c.get("permite_parcial"))
    prev = pw.previsualizar({
        "categoria": cat_id, "fecha": "2026-09-01", "tercero_id": prov["id"], "medio_pago_id": medio_id,
        "concepto": "Compra insumos", "monto": 0,
        "items": [{"sku": "X1", "nombre": "Insumo", "cantidad": 1, "precio": 1_000_000, "iva_pct": 19}],
        "pagado_ahora": 1_300_000, "retencion_modo": "ninguna", "ica_por_mil": 0,
    })
    assert prev["monto"] == 1_190_000
    assert prev["anticipo"] == 110_000 and prev["cuenta_anticipo"] == "133005"
    por_cuenta = {l["cuenta_codigo"]: l for l in prev["lineas"]}
    assert por_cuenta["133005"]["debito"] == 110_000
    assert por_cuenta["1110"]["credito"] == 1_300_000
    assert prev["cuadra"] is True


def test_al_cargar_el_extracto_se_causan_solos_el_4x1000_y_los_intereses(extracto_db):
    """25-sep-2026: el cargue causa y vincula el 4x1000 y los intereses (destino sin
    duda); lo demás sigue esperando al Taller."""
    r = extracto_db.importar_extracto(CSV_SEP, "mov.csv", banco="Bancolombia")
    auto = r.get("causados_automaticos") or {}
    assert auto.get("n", 0) >= 1 and not auto.get("errores")
