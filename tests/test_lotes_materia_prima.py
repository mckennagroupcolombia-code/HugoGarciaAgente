"""Historial de lotes por producto: inferencia de estado y búsqueda pública."""

from __future__ import annotations

import re

import app.services.documentos_catalogo as documentos_catalogo
from app.services.lotes_materia_prima import (
    buscar_lote_publico,
    listar_lotes,
    lote_vigente,
    registrar_lote,
)


def _aislar_mapa(tmp_path, monkeypatch):
    ruta = tmp_path / "documentos_producto.json"
    monkeypatch.setattr(documentos_catalogo, "MAP_PATH", ruta)
    return ruta


def test_primer_lote_se_marca_nuevo(tmp_path, monkeypatch) -> None:
    _aislar_mapa(tmp_path, monkeypatch)
    entry = registrar_lote(
        "ref-001",
        lote_numero="L-001",
        fabricante="Fabricante A",
        nombre_producto="Carbonato de Magnesio",
    )
    assert entry["estado"] == "nuevo"
    assert entry["vigente"] is True


def test_mismo_lote_se_marca_sin_cambios(tmp_path, monkeypatch) -> None:
    _aislar_mapa(tmp_path, monkeypatch)
    registrar_lote("ref-001", lote_numero="L-001", fabricante="Fabricante A")
    segunda = registrar_lote("ref-001", lote_numero="L-001", fabricante="Fabricante A")
    assert segunda["estado"] == "sin_cambios"


def test_mismo_fabricante_lote_distinto_se_marca_actualizado(tmp_path, monkeypatch) -> None:
    _aislar_mapa(tmp_path, monkeypatch)
    registrar_lote("ref-001", lote_numero="L-001", fabricante="Fabricante A")
    segunda = registrar_lote("ref-001", lote_numero="L-002", fabricante="Fabricante A")
    assert segunda["estado"] == "actualizado"


def test_fabricante_distinto_se_marca_nuevo(tmp_path, monkeypatch) -> None:
    _aislar_mapa(tmp_path, monkeypatch)
    registrar_lote("ref-001", lote_numero="L-001", fabricante="Fabricante A")
    segunda = registrar_lote("ref-001", lote_numero="L-002", fabricante="Fabricante B")
    assert segunda["estado"] == "nuevo"


def test_solo_el_ultimo_lote_queda_vigente(tmp_path, monkeypatch) -> None:
    _aislar_mapa(tmp_path, monkeypatch)
    registrar_lote("ref-001", lote_numero="L-001", fabricante="Fabricante A")
    registrar_lote("ref-001", lote_numero="L-002", fabricante="Fabricante A")

    historial = listar_lotes("ref-001")
    assert len(historial) == 2
    assert historial[0]["lote_numero"] == "L-002"  # más reciente primero
    assert historial[0]["vigente"] is True
    assert historial[1]["vigente"] is False

    vigente = lote_vigente("ref-001")
    assert vigente is not None
    assert vigente["lote_numero"] == "L-002"


def test_estado_explicito_no_se_sobreescribe(tmp_path, monkeypatch) -> None:
    _aislar_mapa(tmp_path, monkeypatch)
    entry = registrar_lote(
        "ref-001", lote_numero="L-001", fabricante="Fabricante A", estado="actualizado"
    )
    assert entry["estado"] == "actualizado"


def test_lote_numero_se_autogenera_formato_corto_aleatorio(tmp_path, monkeypatch) -> None:
    _aislar_mapa(tmp_path, monkeypatch)
    entry = registrar_lote("cit-500", nombre_producto="Citrato de Magnesio", fabricante="Fabricante A")
    assert re.fullmatch(r"[A-Z]{3}[0-9]{3}", entry["lote_numero"])
    assert not set(entry["lote_numero"]) & set("01OI")


def test_lote_numero_autogenerado_es_unico_entre_lotes(tmp_path, monkeypatch) -> None:
    _aislar_mapa(tmp_path, monkeypatch)
    primero = registrar_lote("cit-500", nombre_producto="Citrato de Magnesio", fabricante="Fabricante A")
    segundo = registrar_lote("cit-500", nombre_producto="Citrato de Magnesio", fabricante="Fabricante B")
    assert primero["lote_numero"] != segundo["lote_numero"]


def test_lote_numero_explicito_no_se_sobreescribe(tmp_path, monkeypatch) -> None:
    _aislar_mapa(tmp_path, monkeypatch)
    entry = registrar_lote(
        "ref-001", lote_numero="L-CUSTOM", fabricante="Fabricante A", nombre_producto="Carbonato de Magnesio"
    )
    assert entry["lote_numero"] == "L-CUSTOM"


def test_buscar_lote_publico_por_codigo_verificacion(tmp_path, monkeypatch) -> None:
    _aislar_mapa(tmp_path, monkeypatch)
    registrar_lote(
        "ref-001",
        lote_numero="L-001",
        fabricante="Fabricante A",
        codigo_verificacion="MKG-COA-0001",
        nombre_producto="Ácido Cítrico",
    )

    hallado = buscar_lote_publico("mkg-coa-0001")  # case/espacios insensibles
    assert hallado is not None
    assert hallado["ref"] == "REF-001"
    assert hallado["nombre"] == "Ácido Cítrico"
    assert hallado["lote"]["fabricante"] == "Fabricante A"


def test_buscar_lote_publico_por_numero_de_lote(tmp_path, monkeypatch) -> None:
    _aislar_mapa(tmp_path, monkeypatch)
    registrar_lote(
        "ref-002",
        lote_numero="GXO765",
        fabricante="Fabricante B",
        nombre_producto="Ácido Cítrico",
    )

    hallado = buscar_lote_publico("gxo765")  # case insensible, igual que el código
    assert hallado is not None
    assert hallado["ref"] == "REF-002"
    assert hallado["lote"]["lote_numero"] == "GXO765"


def test_buscar_lote_publico_sin_match_retorna_none(tmp_path, monkeypatch) -> None:
    _aislar_mapa(tmp_path, monkeypatch)
    registrar_lote("ref-001", lote_numero="L-001", fabricante="Fabricante A")

    assert buscar_lote_publico("NO-EXISTE") is None


def test_codigo_verificacion_se_autogenera_si_falta(tmp_path, monkeypatch) -> None:
    _aislar_mapa(tmp_path, monkeypatch)
    entry = registrar_lote("ref-003", lote_numero="L-001", fabricante="Fabricante C")

    assert entry["codigo_verificacion"]
    assert len(entry["codigo_verificacion"]) == 6
    # Ambigüedad: sin 0/O/1/I
    assert not set(entry["codigo_verificacion"]) & set("01OI")

    hallado = buscar_lote_publico(entry["codigo_verificacion"])
    assert hallado is not None
    assert hallado["ref"] == "REF-003"


def test_codigo_verificacion_explicito_no_se_sobreescribe(tmp_path, monkeypatch) -> None:
    _aislar_mapa(tmp_path, monkeypatch)
    entry = registrar_lote(
        "ref-004", lote_numero="L-001", fabricante="Fabricante D", codigo_verificacion="MI-CODIGO"
    )
    assert entry["codigo_verificacion"] == "MI-CODIGO"


def test_generar_lotes_faltantes_desde_fichas_guardadas(tmp_path, monkeypatch) -> None:
    import yaml

    import app.services.ficha_tecnica as ficha_tecnica
    import app.services.lotes_materia_prima as lotes_materia_prima
    from app.services.lotes_materia_prima import generar_lotes_faltantes

    _aislar_mapa(tmp_path, monkeypatch)
    datos_dir = tmp_path / "datos"
    datos_dir.mkdir()
    monkeypatch.setattr(ficha_tecnica, "DATOS_DIR", datos_dir)
    # Sin catálogos reales (Siigo/Códigos EAN): aísla el test de red/credenciales.
    monkeypatch.setattr(lotes_materia_prima, "_catalogo_siigo_para_match", lambda: [])
    monkeypatch.setattr(lotes_materia_prima, "_catalogo_codigos_ean_para_match", lambda: [])

    (datos_dir / "citrato_magnesio.yaml").write_text(
        yaml.dump({
            "titulo": "CITRATO DE MAGNESIO",
            "nombre_producto": "Citrato de Magnesio",
            "referencia": "CIT-500",
            "fabricante": "Proveedor A",
            "pais_origen": "China",
        }),
        encoding="utf-8",
    )
    (datos_dir / "sin_referencia.yaml").write_text(
        yaml.dump({"titulo": "SIN REF", "nombre_producto": "Producto sin referencia"}),
        encoding="utf-8",
    )
    (datos_dir / "plantilla_ejemplo.yaml").write_text(
        yaml.dump({"titulo": "PLANTILLA"}), encoding="utf-8"
    )
    (datos_dir / "coa_algo.yaml").write_text(
        yaml.dump({"titulo": "COA ALGO", "referencia": "X"}), encoding="utf-8"
    )

    r = generar_lotes_faltantes()
    assert len(r["creados"]) == 1
    assert r["creados"][0]["ref"] == "CIT-500"
    assert re.fullmatch(r"[A-Z]{3}[0-9]{3}", r["creados"][0]["lote_numero"])
    assert any("sin referencia" in o.get("motivo", "") for o in r["omitidos"])

    # Segunda pasada: no duplica
    r2 = generar_lotes_faltantes()
    assert r2["creados"] == []


def test_resolver_referencias_por_nombre_conservador() -> None:
    from app.services.lotes_materia_prima import _resolver_referencias_por_nombre

    catalogo = [
        {"ref": "ACD-KOJ", "name": "Acido Kojico 30ml"},
        {"ref": "CLO-500", "name": "Cloruro de Magnesio x 500g"},
    ]
    assert _resolver_referencias_por_nombre("Ácido Kójico", catalogo) == ["ACD-KOJ"]
    assert _resolver_referencias_por_nombre("Producto Inexistente", catalogo) == []


def test_resolver_referencias_por_nombre_agrupa_presentaciones() -> None:
    """Varias presentaciones del mismo ingrediente (250g/500g/Kg) se agrupan;
    un producto combinado con OTRO ingrediente (Potasio) se excluye."""
    from app.services.lotes_materia_prima import _resolver_referencias_por_nombre

    catalogo = [
        {"ref": "C-CITMAG250g", "name": "CITRATO MAGNESIO 250g"},
        {"ref": "C-CITMAG500g", "name": "CITRATO MAGNESIO 500g"},
        {"ref": "C-CITMAGKg", "name": "CITRATO MAGNESIO Kg"},
        {"ref": "C-CITPOTMAG", "name": "CITRATO POTASIO 250g MAGNESIO 250g"},
    ]
    refs = _resolver_referencias_por_nombre("Citrato de Magnesio", catalogo)
    assert set(refs) == {"C-CITMAG250g", "C-CITMAG500g", "C-CITMAGKg"}
    assert "C-CITPOTMAG" not in refs


def test_resolver_referencias_por_nombre_no_fusiona_variantes_con_sufijo_corto() -> None:
    """"VITAMINA B3", "VITAMINA C" y "VITAMINA E" son productos distintos que
    solo se diferencian por un sufijo corto (B3/C/E) — no deben fusionarse
    en el mismo match ni con el otro. Antes de este fix, la tokenización
    descartaba tokens de 2 caracteres o menos ("b3", "c", "e"), dejando a
    las tres fichas reducidas a {"vitamina"} y fusionándolas."""
    from app.services.lotes_materia_prima import _resolver_referencias_por_nombre

    catalogo = [
        {"ref": "C-VITE30mL", "name": "VITAMINA E 30mL"},
        {"ref": "C-VITC30P30mL", "name": "VITAMINA C 30% 30mL"},
    ]
    assert _resolver_referencias_por_nombre("VITAMINA B3", catalogo) == []
    assert _resolver_referencias_por_nombre("VITAMINA E", catalogo) == ["C-VITE30mL"]


def test_resolver_referencias_por_nombre_no_fusiona_potencias_distintas() -> None:
    """"POLISORBATO 20" y "POLISORBATO 80P" son productos (Tween 20/80)
    químicamente distintos — el "20"/"80p" no debe perderse ni tratarse
    como si fuera un tamaño de presentación."""
    from app.services.lotes_materia_prima import _resolver_referencias_por_nombre

    catalogo = [
        {"ref": "C-POLTWE20P500mL", "name": "POLISORBATO TWEEN 20 500mL"},
        {"ref": "C-POLTWE80P500mL", "name": "POLISORBATO TWEEN 80P 500mL"},
    ]
    assert _resolver_referencias_por_nombre("POLISORBATO 20", catalogo) == ["C-POLTWE20P500mL"]


def test_resolver_referencias_por_nombre_acepta_descriptor_consistente() -> None:
    """Cuando el catálogo agrega un descriptor que la ficha no trae (ej.
    "extracto", "vegetal", "refinada") pero TODOS los candidatos que matchean
    comparten exactamente ese mismo descriptor, no hay ambigüedad real."""
    from app.services.lotes_materia_prima import _resolver_referencias_por_nombre

    catalogo = [
        {"ref": "C-EXTALOVER30mL", "name": "EXTRACTO ALOE VERA 30mL"},
        {"ref": "C-EXTALOVER1L", "name": "EXTRACTO ALOE VERA 1L"},
    ]
    assert set(_resolver_referencias_por_nombre("ALOE VERA", catalogo)) == {
        "C-EXTALOVER30mL",
        "C-EXTALOVER1L",
    }


def test_resolver_referencias_por_nombre_rechaza_descriptores_distintos() -> None:
    """Si los candidatos con descriptor extra NO comparten el mismo
    descriptor (ej. "alto peso" vs "bajo peso"), sí hay ambigüedad real de
    producto y se descarta todo."""
    from app.services.lotes_materia_prima import _resolver_referencias_por_nombre

    catalogo = [
        {"ref": "C-ACIHIAALT30mL", "name": "ACIDO HIALURONICO ALTO PESO MOLECULAR 30mL"},
        {"ref": "C-ACIHIABAJ30mL", "name": "ACIDO HIALURONICO BAJO PESO MOLECULAR 30mL"},
    ]
    assert _resolver_referencias_por_nombre("ACIDO HIALURONICO", catalogo) == []


def test_generar_lotes_faltantes_resuelve_referencia_por_siigo(tmp_path, monkeypatch) -> None:
    import yaml

    import app.services.ficha_tecnica as ficha_tecnica
    import app.services.lotes_materia_prima as lotes_materia_prima

    _aislar_mapa(tmp_path, monkeypatch)
    datos_dir = tmp_path / "datos"
    datos_dir.mkdir()
    monkeypatch.setattr(ficha_tecnica, "DATOS_DIR", datos_dir)
    monkeypatch.setattr(
        lotes_materia_prima,
        "_catalogo_siigo_para_match",
        lambda: [{"ref": "CIT-500", "name": "Citrato de Magnesio x 500g"}],
    )
    monkeypatch.setattr(lotes_materia_prima, "_catalogo_codigos_ean_para_match", lambda: [])

    (datos_dir / "citrato_magnesio.yaml").write_text(
        yaml.dump({"titulo": "CITRATO DE MAGNESIO", "nombre_producto": "Citrato de Magnesio"}),
        encoding="utf-8",
    )

    r = lotes_materia_prima.generar_lotes_faltantes()
    assert len(r["creados"]) == 1
    assert r["creados"][0]["ref"] == "CIT-500"
    assert r["creados"][0]["referencia_inferida"] is True


def test_generar_lotes_faltantes_comparte_lote_entre_presentaciones(tmp_path, monkeypatch) -> None:
    import yaml

    import app.services.ficha_tecnica as ficha_tecnica
    import app.services.lotes_materia_prima as lotes_materia_prima

    _aislar_mapa(tmp_path, monkeypatch)
    datos_dir = tmp_path / "datos"
    datos_dir.mkdir()
    monkeypatch.setattr(ficha_tecnica, "DATOS_DIR", datos_dir)
    monkeypatch.setattr(
        lotes_materia_prima,
        "_catalogo_siigo_para_match",
        lambda: [
            {"ref": "C-CITMAG250g", "name": "CITRATO MAGNESIO 250g"},
            {"ref": "C-CITMAG500g", "name": "CITRATO MAGNESIO 500g"},
            {"ref": "C-CITPOTMAG", "name": "CITRATO POTASIO 250g MAGNESIO 250g"},
        ],
    )
    monkeypatch.setattr(lotes_materia_prima, "_catalogo_codigos_ean_para_match", lambda: [])

    (datos_dir / "citrato_magnesio.yaml").write_text(
        yaml.dump({"titulo": "CITRATO DE MAGNESIO", "nombre_producto": "Citrato de Magnesio"}),
        encoding="utf-8",
    )

    r = lotes_materia_prima.generar_lotes_faltantes()
    creados = {c["ref"]: c for c in r["creados"]}
    assert set(creados) == {"C-CITMAG250g", "C-CITMAG500g"}
    assert "C-CITPOTMAG" not in creados
    # Mismo lote/código para las dos presentaciones
    assert creados["C-CITMAG250g"]["lote_numero"] == creados["C-CITMAG500g"]["lote_numero"]
    assert creados["C-CITMAG250g"]["codigo_verificacion"] == creados["C-CITMAG500g"]["codigo_verificacion"]


def test_catalogo_codigos_ean_para_match_lee_archivo_real(tmp_path, monkeypatch) -> None:
    import json

    import app.services.lotes_materia_prima as lotes_materia_prima

    ruta_ean = tmp_path / "etiquetas_codigos_ean.json"
    ruta_ean.write_text(
        json.dumps({
            "codigos": [
                {"sku": "C-VAS400g", "nombre_producto": "VASELINA 400g"},
                {"sku": "", "nombre_producto": "SIN SKU"},
                {"sku": "C-X", "nombre_producto": ""},
            ]
        }),
        encoding="utf-8",
    )
    monkeypatch.setattr(lotes_materia_prima, "_CODIGOS_EAN_PATH", ruta_ean)

    catalogo = lotes_materia_prima._catalogo_codigos_ean_para_match()
    assert catalogo == [{"ref": "C-VAS400g", "name": "VASELINA 400g"}]


def test_catalogo_codigos_ean_para_match_sin_archivo_no_falla(tmp_path, monkeypatch) -> None:
    import app.services.lotes_materia_prima as lotes_materia_prima

    monkeypatch.setattr(lotes_materia_prima, "_CODIGOS_EAN_PATH", tmp_path / "no_existe.json")
    assert lotes_materia_prima._catalogo_codigos_ean_para_match() == []


def test_generar_lotes_faltantes_resuelve_por_codigos_ean_cuando_falta_en_siigo(
    tmp_path, monkeypatch
) -> None:
    import yaml

    import app.services.ficha_tecnica as ficha_tecnica
    import app.services.lotes_materia_prima as lotes_materia_prima

    _aislar_mapa(tmp_path, monkeypatch)
    datos_dir = tmp_path / "datos"
    datos_dir.mkdir()
    monkeypatch.setattr(ficha_tecnica, "DATOS_DIR", datos_dir)
    monkeypatch.setattr(lotes_materia_prima, "_catalogo_siigo_para_match", lambda: [])
    monkeypatch.setattr(
        lotes_materia_prima,
        "_catalogo_codigos_ean_para_match",
        lambda: [{"ref": "C-VAS400g", "name": "VASELINA 400g"}],
    )

    (datos_dir / "vaselina.yaml").write_text(
        yaml.dump({"titulo": "VASELINA", "nombre_producto": "VASELINA"}),
        encoding="utf-8",
    )

    r = lotes_materia_prima.generar_lotes_faltantes()
    assert len(r["creados"]) == 1
    assert r["creados"][0]["ref"] == "C-VAS400g"
