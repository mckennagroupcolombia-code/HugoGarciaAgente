"""Acciones frecuentes por usuario y detección de empaque con cantidad."""

from app.services import tickets_db as td


def test_accion_pide_cantidad_empaque():
    assert td.accion_pide_cantidad("Empacar productos en polvo") is True
    assert td.accion_pide_cantidad("Voy a empacar y etiquetar unos productos") is True
    assert td.accion_pide_cantidad("Sync facturas MeLi") is False
    assert td.accion_pide_cantidad("") is False


def test_listar_acciones_frecuentes_vacio_sin_datos(monkeypatch):
    class FakeRow:
        def __init__(self, data):
            self._d = data

        def __getitem__(self, k):
            return self._d[k]

    class FakeDb:
        def execute(self, *args, **kwargs):
            return self

        def fetchall(self):
            return []

        def __enter__(self):
            return self

        def __exit__(self, *a):
            pass

    monkeypatch.setattr(td, "_conn", lambda: FakeDb())
    assert td.listar_acciones_frecuentes(99) == []
