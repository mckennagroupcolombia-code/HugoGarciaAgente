"""El almacén de etiquetas no puede perder fichas por guardados simultáneos ni
tratar un archivo ilegible como «vacío» (incidente 2026-09-19: quedaron 3 de 190)."""
import json
import threading

import pytest

from app.tools import etiquetas_fichas as ef


@pytest.fixture()
def almacen(tmp_path, monkeypatch):
    ruta = tmp_path / "etiquetas_fichas.json"
    monkeypatch.setattr(ef, "_DATA_PATH", ruta)
    monkeypatch.setitem(ef._cache, "mtime", None)
    monkeypatch.setitem(ef._cache, "items", None)
    return ruta


def test_guardados_simultaneos_no_pierden_fichas(almacen):
    errores: list[str] = []

    def escribir(i: int) -> None:
        try:
            for j in range(5):
                ef.guardar_ficha({"nombre": f"ETIQUETA {i}-{j}", "data": {"relleno": "x" * 5000}})
        except Exception as exc:  # pragma: no cover - el fallo se reporta abajo
            errores.append(repr(exc))

    hilos = [threading.Thread(target=escribir, args=(i,)) for i in range(8)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()
    assert not errores
    assert len(json.loads(almacen.read_text(encoding="utf-8"))["fichas"]) == 40


def test_archivo_ilegible_no_se_toma_por_vacio(almacen):
    almacen.write_text('{"fichas": [{"id": "a", "nombre": "A", "data"', encoding="utf-8")  # JSON cortado
    with pytest.raises(ef.AlmacenFichasIlegible):
        ef.listar_fichas()
    with pytest.raises(ef.AlmacenFichasIlegible):
        ef.guardar_ficha({"nombre": "NUEVA", "data": {}})
    # Lo que había en disco sigue ahí: nadie escribió encima.
    assert almacen.read_text(encoding="utf-8").startswith('{"fichas": [{"id": "a"')


def test_guardar_deja_copia_de_la_version_anterior(almacen):
    ef.guardar_ficha({"nombre": "UNA", "data": {}})
    ef.guardar_ficha({"nombre": "DOS", "data": {}})
    bak = almacen.with_suffix(".json.bak")
    assert bak.is_file()
    assert len(json.loads(bak.read_text(encoding="utf-8"))["fichas"]) == 1
