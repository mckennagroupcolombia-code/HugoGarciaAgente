"""Hoja 1 del Sheet al día con las publicaciones (app/services/sheet_productos.py) — sin red."""

from __future__ import annotations

import re

import pytest

from app.services import sheet_productos as sp

ENCABEZADO = [" ", "SKU", "PRESENTACION ", "NOMBRE PRODUCTO", "PRECIO", "STOCK MERCADOLIBRE", "STOCK SIIGO", "LINK PUBLICACION ", "TDS", "LINK TDS"]


class _HojaFalsa:
    def __init__(self, filas):
        self.filas = [list(ENCABEZADO)] + [list(f) for f in filas]
        self.agregadas, self.actualizadas = [], []

    def get_all_values(self):
        return [list(f) for f in self.filas]

    row_count = 10**6

    def batch_update(self, cambios, **kw):
        self.actualizadas.append(cambios)
        for c in cambios:
            m = re.match(r"A(\d+):H\d+$", c["range"])
            if m and int(m.group(1)) > len(self.filas):  # escritura al final
                self.agregadas.append((c["values"][0], {"fila": int(m.group(1))}))
                self.filas.append(list(c["values"][0]))


@pytest.fixture(autouse=True)
def sin_meli(monkeypatch):
    def _prohibido(*a, **kw):
        raise AssertionError("prueba intentó llamar a MeLi")

    monkeypatch.setattr(sp, "_item_meli", _prohibido)
    monkeypatch.delenv("SHEET_PRODUCTOS_AUTOFILA", raising=False)


def test_presentacion_desde_titulo_y_sku():
    assert sp.presentacion_de("C-PSYESC250g", "Psyllium En Escamas Puro 250gr") == "250 g"
    assert sp.presentacion_de("C-ALGSOD500g", "Alginato De Sodio En Polvo Puro 500g - Cocina Molecular") == "500 g"
    assert sp.presentacion_de("C-PROCONSUE80PKg", "Proteína 80% Suero De Leche") == "1 kg"
    assert sp.presentacion_de("C-VITE30mL", "Vitamina E 30mL") == "30 mL"
    assert sp.presentacion_de("C-X", "Sin medida") == ""


def test_agrega_fila_con_el_formato_de_la_hoja():
    hoja = _HojaFalsa([["MCO1", "C-UNO250g", "250 g", "Uno 250g", 1000, 5, "", "https://x/1"]])
    r = sp.asegurar_fila(
        "mco-2240278527", "C-PSYESC250g", titulo="Psyllium En Escamas Puro 250gr", precio=31000, stock=20,
        permalink="https://articulo.mercadolibre.com.co/MCO-2240278527-psyllium-_JM", hoja=hoja,
    )
    assert r["ok"] and r["accion"] == "agregada"
    fila, kw = hoja.agregadas[0]
    assert fila == [
        "MCO2240278527", "C-PSYESC250g", "250 g", "Psyllium En Escamas Puro 250gr", 31000.0, 20, "",
        "https://articulo.mercadolibre.com.co/MCO-2240278527-psyllium-_JM",
    ]
    assert kw["fila"] == 3  # encabezado + 1 fila de datos → la siguiente libre; jamás la fila 1
    assert hoja.filas[0] == ENCABEZADO


def test_idempotente_por_id_y_no_duplica_por_sku():
    hoja = _HojaFalsa([["MCO2240278527", "C-PSYESC250g", "250 g", "Psyllium", 31000, 20, "", "https://x"]])
    r = sp.asegurar_fila("MCO2240278527", "C-PSYESC250g", titulo="Psyllium", precio=31000, stock=20, permalink="https://x", hoja=hoja)
    assert r["accion"] == "ya_estaba" and not hoja.agregadas
    # Fila con el SKU pero sin ID de MeLi: se completa, no se duplica.
    hoja2 = _HojaFalsa([["", "C-SEMCHI250g", "250 g", "Chía 250g", "", "", "", ""]])
    r2 = sp.asegurar_fila("MCO4485107370", "C-SEMCHI250g", titulo="Chía 250gr", precio=9000, stock=20, permalink="https://x/chia", hoja=hoja2)
    assert r2["accion"] == "completada" and r2["fila"] == 2 and not hoja2.agregadas
    assert hoja2.actualizadas[0][0] == {"range": "A2", "values": [["MCO4485107370"]]}


def test_lee_de_meli_lo_que_falta(monkeypatch):
    monkeypatch.setattr(
        sp, "_item_meli",
        lambda mid: {"title": "Ajo Negro 250gr", "price": 18000, "available_quantity": 20, "permalink": "https://x/ajo",
                     "attributes": [{"id": "SELLER_SKU", "value_name": "C-AJONEG250g"}]},
    )
    hoja = _HojaFalsa([])
    r = sp.asegurar_fila("MCO2242423745", hoja=hoja)
    assert r["accion"] == "agregada" and hoja.agregadas[0][0][:6] == ["MCO2242423745", "C-AJONEG250g", "250 g", "Ajo Negro 250gr", 18000.0, 20]


def test_nunca_lanza_y_respeta_el_interruptor(monkeypatch):
    class _Rota(_HojaFalsa):
        def get_all_values(self):
            raise RuntimeError("Sheets 503")

    r = sp.asegurar_fila("MCO2242423745", "C-X", titulo="X 250g", precio=1, stock=1, permalink="p", hoja=_Rota([]))
    assert r["ok"] is False and r["accion"] == "error"
    assert sp.asegurar_fila("no-es-un-id", hoja=_HojaFalsa([]))["accion"] == "omitida"
    monkeypatch.setenv("SHEET_PRODUCTOS_AUTOFILA", "0")
    hoja = _HojaFalsa([])
    assert sp.asegurar_fila("MCO2242423745", "C-X", titulo="X", precio=1, stock=1, permalink="p", hoja=hoja)["accion"] == "omitida"
    assert not hoja.agregadas


def test_actualizar_publicacion_dispara_la_fila(monkeypatch, tmp_path):
    from app.services import publicaciones as pub

    monkeypatch.setattr(pub, "_OVERRIDES_PATH", tmp_path / "ov.json")
    llamadas = []
    monkeypatch.setattr(sp, "asegurar_fila_en_segundo_plano", lambda mid, sku, **kw: llamadas.append((mid, sku)))
    pub.actualizar_publicacion("C-NUEVO250g", {"meli_item_id": "MCO2240278527"})
    pub.actualizar_publicacion("C-NUEVO250g", {"descripcion": "solo texto"})  # sin ID nuevo: no dispara
    assert llamadas == [("MCO2240278527", "C-NUEVO250g")]


def test_nunca_toca_el_encabezado_ni_filas_existentes():
    hoja = _HojaFalsa([["MCO1", "C-UNO", "250 g", "Uno", 1, 1, "", "l"], ["MCO2", "C-DOS", "250 g", "Dos", 2, 2, "", "l"]])
    antes = [list(f) for f in hoja.filas]
    for n in range(3):
        sp.asegurar_fila(f"MCO900000{n}", f"C-N{n}", titulo=f"N{n} 250g", precio=1, stock=1, permalink="p", hoja=hoja)
    assert hoja.filas[:3] == antes and len(hoja.filas) == 6
    assert [a[1]["fila"] for a in hoja.agregadas] == [4, 5, 6]
    # Hoja vacía (sin encabezado): se niega a escribir.
    vacia = _HojaFalsa([])
    vacia.filas = []
    assert sp.asegurar_fila("MCO9000009", "C-Z", titulo="Z 250g", precio=1, stock=1, permalink="p", hoja=vacia)["accion"] == "error"
