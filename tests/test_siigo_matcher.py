"""Regresión del matcher de combos SIIGO (afinado jul 2026).

Fallas reales del chat web que motivaron el ajuste:
- Refs exactas intermitentes (C-PROCONSUE80PKg encontrada y luego "no encontré").
- Frases largas muertas por exigir TODOS los tokens ≥4 en el producto.
- Dos productos en un mensaje ("glicerina vegetal y arcilla caolín") sin match.
- Caché que devolvía [] si la API fallaba justo al vencer el TTL.
"""
from __future__ import annotations

from unittest.mock import patch

import app.services.siigo as siigo
from app.services.siigo import buscar_combos_siigo_estructurado


_COMBOS = [
    {"code": "C-PROCONSUE80PKg", "name": "PROTEINA CONCENTRADA SUERO LECHE 80P Kg", "active": True, "prices": [{"price_list": [{"value": 101000}]}]},
    {"code": "C-FLOSECLAV100g", "name": "FLORES SECAS LAVANDA 100g", "active": True, "prices": [{"price_list": [{"value": 18000}]}]},
    {"code": "C-GLIVEG500mL", "name": "GLICERINA VEGETAL USP 500mL", "active": True, "prices": [{"price_list": [{"value": 20000}]}]},
    {"code": "C-ARCCAO250g", "name": "ARCILLA CAOLIN 250g", "active": True, "prices": [{"price_list": [{"value": 14000}]}]},
    {"code": "C-ACISAL50g", "name": "ACIDO SALICILICO 50g", "active": True, "prices": [{"price_list": [{"value": 15000}]}]},
    {"code": "C-ACILAC30mL", "name": "ACIDO LACTICO 30mL", "active": True, "prices": [{"price_list": [{"value": 12000}]}]},
    {"code": "C-GOMGUA500g", "name": "GOMA GUAR 500g", "active": True, "prices": [{"price_list": [{"value": 25000}]}]},
]


def _patch(monkeypatch):
    monkeypatch.setattr(
        "app.services.siigo.listar_productos_combo_siigo", lambda: _COMBOS
    )


def _nombres(consulta):
    items, _ = buscar_combos_siigo_estructurado(consulta)
    return [i["name"] for i in items]


def test_ref_exacta_directa(monkeypatch):
    _patch(monkeypatch)
    assert _nombres("C-PROCONSUE80PKg") == ["PROTEINA CONCENTRADA SUERO LECHE 80P Kg"]


def test_ref_exacta_dentro_de_frase(monkeypatch):
    _patch(monkeypatch)
    q = "C-FLOSECLAV100g es la referencia, pero favor me envía cotización"
    assert _nombres(q) == ["FLORES SECAS LAVANDA 100g"]


def test_ref_como_slug_web(monkeypatch):
    _patch(monkeypatch)
    assert _nombres("c-floseclav100g") == ["FLORES SECAS LAVANDA 100g"]


def test_frase_larga_no_mata_el_match(monkeypatch):
    _patch(monkeypatch)
    q = (
        "He mirado su catálogo y encontré flores secas de lavanda. Quiero saber "
        "a partir de qué cantidad se puede hacer pedido. Y las condiciones del "
        "envío a Bucaramanga."
    )
    assert "FLORES SECAS LAVANDA 100g" in _nombres(q)


def test_dos_productos_en_un_mensaje(monkeypatch):
    _patch(monkeypatch)
    nombres = _nombres("Glicerina vegetal y arcilla caolín vegetal")
    assert "GLICERINA VEGETAL USP 500mL" in nombres
    assert "ARCILLA CAOLIN 250g" in nombres


def test_producto_con_ruido_conversacional(monkeypatch):
    _patch(monkeypatch)
    assert _nombres("Goma Guar por kilo") == ["GOMA GUAR 500g"]
    assert _nombres("que precio tiene la goma guar") == ["GOMA GUAR 500g"]
    assert "FLORES SECAS LAVANDA 100g" in _nombres(
        "tienen lavanda para hacer jabones artesanales?"
    )


def test_variante_inexistente_no_ofrece_la_familia(monkeypatch):
    """'ácido tánico' no existe: no ofrecer salicílico/láctico en su lugar."""
    _patch(monkeypatch)
    assert _nombres("Quisiera por favor cotizar acido tanico?") == []


def test_no_producto_sigue_vacio(monkeypatch):
    _patch(monkeypatch)
    assert _nombres("tienes barro del mar muerto") == []
    assert _nombres("Buen día señor Hugo") == []


def test_cache_stale_si_api_falla(monkeypatch):
    """API caída al vencer el TTL: devolver catálogo viejo, no lista vacía.

    El test apuntaba a `siigo._combos_cache` / `siigo._siigo_get`, pero el
    2026-09-03 `listar_productos_combo_siigo` pasó a delegar en Alegra y esos
    atributos quedaron muertos: el test golpeaba la API real y fallaba en
    cualquier máquina con credenciales. Ahora ejercita la caché que de verdad
    se usa — y con ello la red de seguridad que la migración había perdido.
    """
    from app.services import alegra

    monkeypatch.setattr(alegra, "_combos_alegra_cache", list(_COMBOS))
    monkeypatch.setattr(alegra, "_combos_alegra_cache_ts", 0)  # TTL vencido
    monkeypatch.setattr(alegra, "_alegra_headers", lambda: {"Authorization": "test"})

    class _RespFallo:
        status_code = 500

        def json(self):  # pragma: no cover - no debería llamarse
            return []

    monkeypatch.setattr(alegra.requests, "get", lambda *a, **k: _RespFallo())
    assert len(siigo.listar_productos_combo_siigo()) == len(_COMBOS)


def test_cache_stale_no_se_pisa_por_excepcion_de_red(monkeypatch):
    """Un timeout no puede dejar el catálogo en blanco durante todo el TTL."""
    from app.services import alegra

    monkeypatch.setattr(alegra, "_combos_alegra_cache", list(_COMBOS))
    monkeypatch.setattr(alegra, "_combos_alegra_cache_ts", 0)
    monkeypatch.setattr(alegra, "_alegra_headers", lambda: {"Authorization": "test"})

    def _boom(*_a, **_k):
        raise alegra.requests.RequestException("timeout")

    monkeypatch.setattr(alegra.requests, "get", _boom)
    assert len(alegra.listar_productos_combo_alegra()) == len(_COMBOS)
    # La caché en memoria queda intacta para el siguiente turno
    assert len(alegra._combos_alegra_cache) == len(_COMBOS)


# --- Bloque B (sep-2026): variantes morfológicas del español ------------------
#
# Caso real: el 2026-09-09 un cliente pidió creatina 1 kg cinco veces y el bot
# respondió "el precio no me figura en el sistema" sobre un producto que estaba
# en catálogo con stock 9. "precio creatina" sí encontraba; "creatina
# monohidratADA" no, porque la comparación era substring pura contra
# "CREATINA MONOHIDRATO".


def test_raiz_token_tolera_genero_y_sufijos_quimicos() -> None:
    from app.services.siigo import _raiz_token_combo

    assert _raiz_token_combo("monohidratada") == _raiz_token_combo("monohidrato")
    assert _raiz_token_combo("ascorbica") == _raiz_token_combo("ascorbico")
    # Tokens cortos no se recortan: dejarían raíces ambiguas entre productos.
    assert _raiz_token_combo("urea") == "urea"
    assert _raiz_token_combo("soya") == "soya"
    # Nunca por debajo de la raíz mínima
    assert len(_raiz_token_combo("sales")) >= 5


def test_token_en_blob_no_confunde_productos_distintos() -> None:
    from app.services.siigo import _token_en_blob

    assert _token_en_blob("monohidratada", "creatina monohidrato 1000g c-cremon1000g")
    assert _token_en_blob("creatina", "creatina monohidrato 1000g c-cremon1000g")
    # La raíz del cliente tiene que ser prefijo de una palabra real del producto,
    # no al revés: "tanico" no puede arrastrar otros ácidos.
    assert not _token_en_blob("tanico", "acido citrico 250g c-acicit250g")
    assert not _token_en_blob("salicilico", "sales de epsom 500g c-saleps500g")


def test_seleccion_presentacion_no_traga_productos_fuera_del_allowlist() -> None:
    from app import core

    # Nombra un producto real -> es una consulta de catálogo, no la elección de
    # una presentación ya ofrecida. Antes dependía de una lista escrita a mano
    # que no incluía creatina, taurina ni sucralosa.
    for msg in ("creatina monohidratada 1kg", "taurina 250g", "sucralosa kilo"):
        assert not core._es_seleccion_presentacion_web(msg), msg

    # Respuestas cortas que sí eligen variante de lo ya ofrecido
    for msg in ("500g", "la grande", "el de 1 kilo", "2"):
        assert core._es_seleccion_presentacion_web(msg), msg


def test_notas_hardcodeadas_por_producto_no_contradicen_el_catalogo() -> None:
    from app import core

    # Ylang Ylang SÍ está en catálogo (C-ACEESEYLAYLA5mL): la nota que decía lo
    # contrario se eliminó. COSGARD duplicaba el texto de "no encontrado".
    assert core._nota_producto_alternativo_web("ylang ylang") == ""
    assert core._nota_producto_alternativo_web("cosgard") == ""
    # BTMS-25 se conserva: aporta la referencia equivalente, que el catálogo
    # por sí solo no puede dar.
    assert "BTMS 50" in core._nota_producto_alternativo_web("btms 25")
