"""Expediente fiscal de socios (Declarador) + extractos por titular."""
from __future__ import annotations

import json
import os

import pytest


@pytest.fixture()
def db(monkeypatch, tmp_path):
    import app.services.contabilidad_core as core
    import app.services.contabilidad_db as cdb
    import app.services.declarador as dl
    import app.services.extracto_bancario as eb

    # Ambos módulos apuntan al mismo archivo en producción; en pruebas los dos
    # deben ir a la copia temporal, o el test escribe en la base real.
    monkeypatch.setattr(cdb, "_DB_PATH", str(tmp_path / "contab.db"))
    monkeypatch.setattr(cdb, "_initialized", False)
    monkeypatch.setattr(core, "_DB_PATH", str(tmp_path / "contab.db"))
    monkeypatch.setattr(core, "_initialized", False)
    monkeypatch.setattr(eb, "_EXTRACTOS_DIR", str(tmp_path / "extractos"))
    monkeypatch.setattr(dl, "_DOCS_DIR", str(tmp_path / "docs"))
    monkeypatch.setattr(dl, "_tables_ready", False)
    cdb.init_db()
    eb.ensure_extracto_tables()
    dl._ensure()
    from app.services.contabilidad_core import crear_tercero

    socio = crear_tercero({"nombre": "Armando Garcia", "tipo": "socio", "tipo_persona": "natural", "usuario_id": 8})
    return {"eb": eb, "dl": dl, "socio": socio, "tmp": tmp_path}


CSV_EMPRESA = (
    "Fecha;Descripción;Débito;Crédito;Saldo\n"
    "2026-08-03;PAGO A PROVEEDOR ARMANDO GARCIA;1500000;;10000000\n"
    "2026-08-10;PAGO WOMPI;;300000;10300000\n"
)
CSV_SOCIO = (
    "Fecha;Descripción;Débito;Crédito;Saldo\n"
    "2026-08-04;PAGO DE PROV MCKENNA GROUP;;1500000;2000000\n"
    "2026-08-20;PAGO DE PROV MCKENNA GROUP;;800000;2800000\n"
    "2026-08-22;TRANSFERENCIA CTA SUC VIRTUAL;500000;;2300000\n"
)


def test_extractos_por_titular_no_se_mezclan(db):
    eb, socio = db["eb"], db["socio"]
    e_emp = eb.importar_extracto(CSV_EMPRESA.encode(), "empresa.csv", banco="Bancolombia", cuenta="428")
    e_soc = eb.importar_extracto(CSV_SOCIO.encode(), "socio.csv", banco="Bancolombia", cuenta="912", tercero_id=socio["id"])
    assert e_emp["tercero_id"] is None and e_soc["tercero_id"] == socio["id"]

    # Listados separados
    assert [e["id"] for e in eb.listar_extractos()] == [e_emp["id"]]
    assert [e["id"] for e in eb.listar_extractos(tercero_id=socio["id"])] == [e_soc["id"]]
    assert len(eb.listar_extractos(todos=True)) == 2

    # Pendientes de la empresa no incluyen líneas del socio
    pend = eb.pendientes_por_clasificar("2026-08-01", "2026-08-31")
    assert {p["extracto_id"] for p in pend} == {e_emp["id"]}
    pend_s = eb.pendientes_por_clasificar("2026-08-01", "2026-08-31", tercero_id=socio["id"])
    assert {p["extracto_id"] for p in pend_s} == {e_soc["id"]}

    # Candidatos para un egreso de la empresa: solo banco de la empresa
    cands = eb.candidatos_para_movimiento(fecha="2026-08-04", monto=1500000, tipo_libro="egreso")
    assert cands and all(c["extracto_id"] == e_emp["id"] for c in cands)
    # …y para un ingreso del libro de 1.500.000 no aparece el crédito del socio
    cands_in = eb.candidatos_para_movimiento(fecha="2026-08-04", monto=1500000, tipo_libro="ingreso")
    assert cands_in == []

    # Saldo bancario reciente = empresa (aunque el socio tenga fecha más reciente)
    assert eb.saldo_bancario_mas_reciente()["extracto_id"] == e_emp["id"]

    # Cobertura mensual del socio
    cob = eb.cobertura_mensual(socio["id"])
    assert cob["anios"]["2026"]["meses_con"] == 1 and "2026-01" in cob["anios"]["2026"]["faltan"]


def test_cruces_socio_empresa(db):
    eb, dl, socio = db["eb"], db["dl"], db["socio"]
    eb.importar_extracto(CSV_EMPRESA.encode(), "empresa.csv", banco="B", cuenta="428")
    eb.importar_extracto(CSV_SOCIO.encode(), "socio.csv", banco="B", cuenta="912", tercero_id=socio["id"])
    c = dl.cruces_socio_empresa(socio["id"], desde="2026-08-01", hasta="2026-08-31")
    assert c["resumen"]["pares"] == 1
    par = c["empresa_a_socio"][0]
    assert par["monto"] == 1500000 and par["dias"] == 1 and par["contabilizado"] is False
    # El giro de 800.000 nombra a McKenna y no tiene contraparte en el banco de la empresa
    assert [x["monto"] for x in c["mencionan_mckenna_sin_par"]] == [800000]


def test_importar_carpeta_declarador(db):
    dl, socio, tmp = db["dl"], db["socio"], db["tmp"]
    raiz = tmp / "Declarador"
    carpeta = raiz / "Armando"
    (carpeta / "Extractos Bancarios 2025" / "01_ENERO").mkdir(parents=True)
    (carpeta / "Declaracion2021.pdf").write_bytes(b"%PDF-1.4 fake")
    (carpeta / "reporteExogena2023.xlsx").write_bytes(b"x")
    (carpeta / "Extractos Bancarios 2025" / "01_ENERO" / "8017_ENE2025.xlsx").write_bytes(b"x")
    (carpeta / "Formulario 210-3.png").write_bytes(b"x")
    (carpeta / "declarado_f210.json").write_text(json.dumps({
        "titular": {"cedula": "1013630698", "binance_uid": "37840249"},
        "anios": [
            {"ano": 2021, "formulario": "F1", "presentada_en": "2022-10-18", "patrimonio_bruto": 46003000, "renta_liquida": 35218000, "impuesto_pagado": 0, "estado": "presentada"},
            {"ano": 2025, "formulario": "F5", "estado": "borrador"},
        ],
        "pendientes": [{"clave": "p2p_2021", "ano": 2021, "severidad": "alta", "titulo": "Ventas P2P 2021", "detalle": "x"}],
    }), encoding="utf-8")
    calc = carpeta / "Calculos"
    calc.mkdir()
    (calc / "eventos_realizados_fifo.csv").write_text(
        "fecha,coin,cedula,ganancia_cop\n"
        "2021-05-01 10:00:00,USDT,renta_ordinaria,19860862\n"
        "2021-06-01 10:00:00,BTC,ganancia_ocasional,0\n"
        "2021-07-01 10:00:00,DOGE,sin_costo_base,170867\n"
        "2025-01-01 10:00:00,SOL,renta_ordinaria,1000\n",
        encoding="utf-8",
    )
    (calc / "Informe_Contador_Criptoactivos.md").write_text("# informe", encoding="utf-8")

    r = dl.importar_carpeta(socio["id"], str(carpeta))
    assert r["documentos_nuevos"] >= 5 and r["imagenes"] == 1
    assert r["anios_sembrados"] == 2 and r["hallazgos_sembrados"] == 1

    exp = dl.obtener_expediente(socio["id"])
    assert exp["perfil"]["cedula"] == "1013630698"
    cats = {d["archivo_nombre"]: d["categoria"] for d in exp["documentos"]}
    assert cats["Declaracion2021.pdf"] == "declaracion_f210"
    assert cats["reporteExogena2023.xlsx"] == "exogena"
    assert cats["8017_ENE2025.xlsx"] == "extracto_tarjeta"
    assert cats["Informe_Contador_Criptoactivos.md"] == "informe"
    a2021 = next(a for a in exp["anios"] if a["ano"] == 2021)
    assert a2021["cripto_renta_ordinaria"] == 19860862 and a2021["cripto_eventos"] == 3
    assert a2021["requiere_revision"] is True
    claves = {h["clave"] for h in exp["hallazgos"]}
    assert {"p2p_2021", "auto_omision_2021"} <= claves
    # El borrador de un año solo es pendiente cuando su ventana de presentación ya cerró.
    assert ("auto_borrador_2025" in claves) == (dl.ventana_f210(2025)["estado"] == "vencida")

    # Reimportar no duplica
    r2 = dl.importar_carpeta(socio["id"])
    assert r2["documentos_nuevos"] == 0
    assert len(dl.listar_hallazgos(socio["id"])) == len(exp["hallazgos"])

    # Pasos del wizard: declarador parcial (hay años por corregir), cierre pendiente (hallazgo alta)
    pasos = {p["id"]: p["estado"] for p in exp["pasos"]}
    assert pasos["declarador"] == "parcial" and pasos["cierre"] == "pendiente"
    # Resolver hallazgos → paso cierre cambia
    for h in dl.listar_hallazgos(socio["id"]):
        dl.actualizar_hallazgo(socio["id"], h["id"], {"estado": "resuelto", "resolucion": "ok"})
    pasos = {p["id"]: p["estado"] for p in dl.obtener_expediente(socio["id"])["pasos"]}
    assert pasos["cierre"] == "hecho"


def test_documento_subido_y_texto(db):
    dl, socio = db["dl"], db["socio"]
    d = dl.guardar_documento(socio["id"], b"col1,col2\n1,2\n", "prueba.csv", categoria="calculo", ano=2024)
    assert d["origen"] == "subido" and d["ano"] == 2024
    assert "col1,col2" in dl.leer_documento_texto(socio["id"], d["id"])
    assert dl.eliminar_documento(socio["id"], d["id"]) is True
    assert not os.path.exists(d["archivo_path"])


def test_rutas_privacidad(db, monkeypatch):
    """Cada socio solo ve su expediente; el token de sistema ve todos."""
    from flask import Flask

    from app.routes_declarador import register_declarador_routes
    import app.routes_declarador as rd

    monkeypatch.setenv("CHAT_API_TOKEN", "tok-sistema")
    app = Flask(__name__)
    register_declarador_routes(app)
    c = app.test_client()
    sid = db["socio"]["id"]

    assert c.get(f"/api/socios/{sid}/expediente").status_code == 401
    r = c.get(f"/api/socios/{sid}/expediente", headers={"Authorization": "Bearer tok-sistema"})
    assert r.status_code == 200 and r.get_json()["perfil"]["tercero"]["id"] == sid

    # Usuario de sesión que es otro socio (usuario 6) → 403; el propio (8) → 200
    def fake_get_usuario(token):
        return {"id": 6, "username": "cynthia"} if token == "jwt-cynthia" else ({"id": 8, "username": "armando"} if token == "jwt-armando" else None)

    import app.services.tickets_db as tdb

    monkeypatch.setattr(tdb, "get_usuario_by_token", fake_get_usuario)
    assert c.get(f"/api/socios/{sid}/expediente", headers={"Authorization": "Bearer jwt-cynthia"}).status_code == 403
    assert c.get(f"/api/socios/{sid}/expediente", headers={"Authorization": "Bearer jwt-armando"}).status_code == 200
    lst = c.get("/api/socios", headers={"Authorization": "Bearer jwt-cynthia"}).get_json()
    assert lst["socios"] == [] and lst["es_admin"] is False
    assert rd._es_admin_real({"username": "admin"}) is True


def test_cuestionario_plan_y_carpeta(db, tmp_path, monkeypatch):
    dl, socio = db["dl"], db["socio"]
    monkeypatch.setattr(dl, "DECLARADOR_DIR", str(tmp_path / "Declarador"))
    from app.services.contabilidad_core import crear_tercero

    otra = crear_tercero({"nombre": "Cynthia Ruiz", "tipo": "socio", "tipo_persona": "natural", "usuario_id": 6})

    # Sin respuestas: el paso «perfil» pide cuestionario; el plan no exige cripto
    exp = dl.obtener_expediente(otra["id"])
    assert exp["plan"]["cuestionario"]["_completo"] is False
    assert {p["id"] for p in exp["pasos"]} >= {"perfil", "plan"}
    binance = next(r for r in exp["plan"]["requisitos"] if r["id"] == "binance_csv")
    assert binance["aplica"] is False and binance["estado"] == "no_aplica"

    # Responder: solo lo que cambia lo que se pide
    dl.guardar_perfil(otra["id"], {"cedula": "1019044839", "cuestionario": {"cripto": True, "declaro_antes": False, "desde": 2023, "otras_plataformas": False, "prestamos_familia": False, "telefono": "no-se-guarda"}})
    perfil = dl.obtener_perfil(otra["id"])
    assert "telefono" not in perfil["cuestionario"] and perfil["cuestionario"]["desde"] == 2023
    exp = dl.obtener_expediente(otra["id"])
    cq = exp["plan"]["cuestionario"]
    assert cq["_completo"] and cq["cripto"] is True
    req = {r["id"]: r for r in exp["plan"]["requisitos"]}
    assert req["binance_csv"]["aplica"] is True and req["f210"]["aplica"] is False
    assert [x["ano"] for x in req["binance_csv"]["anios"]] == list(range(2023, __import__("datetime").datetime.now().year))
    assert next(p for p in exp["pasos"] if p["id"] == "perfil")["estado"] == "hecho"

    # Omitir un requisito lo saca del progreso
    dl.guardar_perfil(otra["id"], {"cuestionario": {"omitidos": ["binance_api"]}})
    plan = dl.plan_carga(otra["id"])
    assert next(r for r in plan["requisitos"] if r["id"] == "binance_api")["estado"] == "omitido"

    # Socio de referencia: el otro con documentos (solo conteos, sin cifras)
    dl.guardar_documento(socio["id"], b"x", "Declaracion2023.pdf", categoria="declaracion_f210", ano=2023)
    plan = dl.plan_carga(otra["id"])
    assert plan["referencia"]["nombre"] == "Armando" and plan["referencia"]["por_categoria"]["declaracion_f210"]["2023"] == 1
    assert "patrimonio" not in json.dumps(plan["referencia"])

    # Carpeta con la misma estructura que Armando, LEEME y plantilla; idempotente
    r = dl.crear_carpeta_socio(otra["id"])
    assert r["carpeta"].endswith("/Cynthia") and "LEEME.md" in r["creadas"] and "declarado_f210.json" in r["creadas"]
    assert os.path.isdir(os.path.join(r["carpeta"], "04_Binance"))
    seed = json.load(open(os.path.join(r["carpeta"], "declarado_f210.json")))
    assert seed["titular"]["cedula"] == "1019044839" and seed["anios"][0]["ano"] == 2023
    r2 = dl.crear_carpeta_socio(otra["id"])
    assert r2["existia"] is True and r2["creadas"] == []

    # Cuestionario inferido para quien ya cargó todo (Armando): no se le vuelve a preguntar
    dl.guardar_documento(socio["id"], b"x", "2024.csv", categoria="binance_csv", ano=2024)
    cq = dl.cuestionario_efectivo(socio["id"])
    assert cq["cripto"] is True and cq["declaro_antes"] is True and "cripto" in cq["_inferido"]


def test_impuesto_art241_reproduce_lo_declarado():
    """La tabla del Art. 241 con la UVT de cada año debe reproducir el impuesto
    que la DIAN liquidó en los F210 ya presentados (tolerancia: redondeo a miles)."""
    from app.services.declarador import impuesto_renta_art241

    assert abs(impuesto_renta_art241(50_045_000, 2022) - 1_638_000) < 1_000
    assert abs(impuesto_renta_art241(61_408_000, 2023) - 2_884_000) < 1_000
    assert impuesto_renta_art241(10_255_000, 2020) == 0  # bajo 1.090 UVT
    assert impuesto_renta_art241(55_249_729, 2021) == 2_978_062
    assert impuesto_renta_art241(1_000_000, 1999) is None  # UVT no cargada: nunca se extrapola


def test_tenencia_fifo_por_anio(tmp_path):
    """Lo que queda al 31-dic se valora al costo FIFO de los lotes vivos; las
    stablecoins sin precio valen 1 USD; los traslados internos no cuentan."""
    from app.services.declarador import tenencia_fifo_por_anio

    ledger = tmp_path / "ledger_final.csv"
    ledger.write_text(
        "row_id,User_ID,UTC_Time,Account,Operation,Coin,Change,Remark,price_usd,fuente,trm\n"
        "1,1,2023-03-01 10:00:00,Spot,Buy,BTC,1.0,,20000,x,4000\n"
        "2,1,2023-06-01 10:00:00,Spot,Buy,BTC,1.0,,30000,x,4000\n"
        "3,1,2023-09-01 10:00:00,Spot,Sell,BTC,-1.0,,35000,x,4000\n"
        "4,1,2023-10-01 10:00:00,Spot,Deposit,USDC,100,,,x,4000\n"
        "5,1,2023-11-01 10:00:00,Spot,Transfer Between Main and Funding Wallet,BTC,-1.0,,36000,x,4000\n"
        "6,1,2024-02-01 10:00:00,Spot,Sell,BTC,-1.0,,40000,x,4000\n",
        encoding="utf-8",
    )
    trm = tmp_path / "trm_diaria.csv"
    trm.write_text("fecha,trm\n2023-12-31,4000\n2024-12-31,4400\n", encoding="utf-8")
    t = tenencia_fifo_por_anio(str(ledger), str(trm))
    # 2023: queda el lote de 30.000 (FIFO consumió el de 20.000) + 100 USDC a 1 USD
    assert t[2023]["cripto_costo_cierre_usd"] == 30_100.0
    assert t[2023]["cripto_costo_cierre_cop"] == 30_100 * 4000
    # 2024: se vendió el BTC; solo quedan los USDC
    assert t[2024]["cripto_costo_cierre_usd"] == 100.0
    assert t[2024]["trm_cierre"] == 4400
