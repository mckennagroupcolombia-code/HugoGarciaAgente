"""Follow-up de cantidad tras oferta de producto (evita contradicción tipo '1 unidad' → no manejamos)."""

from __future__ import annotations

import pytest


ASISTENTE_EJEMPLO = """Sí veci, sí lo manejamos.
- Producto: ACEITE NEEM 120mL
- Referencia: C-ACENEE120mL
- Precio: $34,500 COP
Si desea cotización, me indica la cantidad."""


@pytest.mark.parametrize(
    "msg,expected",
    [
        ("1", 1.0),
        ("2", 2.0),
        ("1 unidad", 1.0),
        ("2 unidades", 2.0),
        ("120 ml", 1.0),
        ("una", 1.0),
    ],
)
def test_parse_cantidad_respuesta_cliente(msg: str, expected: float) -> None:
    from app.core import _parse_cantidad_respuesta_cliente

    assert _parse_cantidad_respuesta_cliente(msg) == expected


def test_resolver_cantidad_tras_oferta_producto_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core import resolver_cantidad_tras_oferta_producto

    def fake_buscar(sku: str):
        assert sku == "C-ACENEE120mL"
        return {
            "sku": sku,
            "nombre": "ACEITE NEEM 120mL",
            "precio": 34500.0,
            "unidad": "und",
        }

    monkeypatch.setattr("app.core.buscar_producto_siigo_por_sku", fake_buscar)

    messages = [
        {"role": "user", "content": "Usuario_x: 120ml"},
        {"role": "assistant", "content": ASISTENTE_EJEMPLO},
        {"role": "user", "content": "Usuario_x: 1 unidad"},
    ]
    out = resolver_cantidad_tras_oferta_producto(messages, "1 unidad")
    assert out is not None
    assert "C-ACENEE120mL" in out
    assert "34,500" in out or "34500" in out.replace(",", "")
    assert "subtotal" in out.lower()
    assert "no lo manejamos" not in out.lower()


def test_resolver_sin_contexto_producto(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core import resolver_cantidad_tras_oferta_producto

    monkeypatch.setattr(
        "app.core.buscar_producto_siigo_por_sku",
        lambda sku: (_ for _ in ()).throw(AssertionError("no debe consultar SIIGO")),
    )

    messages = [
        {"role": "user", "content": "hola"},
        {"role": "assistant", "content": "¿En qué le ayudo veci?"},
        {"role": "user", "content": "Usuario_x: 1 unidad"},
    ]
    assert resolver_cantidad_tras_oferta_producto(messages, "1 unidad") is None


def test_resolver_referencia_desde_sku_slash(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core import resolver_cantidad_tras_oferta_producto

    asst = """✅ Producto encontrado en catálogo McKenna Group:
- Nombre oficial: X
- SKU/Referencia: C-TEST123
- Precio: $10,000 COP
¿Cuántas unidades necesita?"""

    monkeypatch.setattr(
        "app.core.buscar_producto_siigo_por_sku",
        lambda sku: {"nombre": "X", "precio": 10000.0} if sku == "C-TEST123" else None,
    )

    messages = [
        {"role": "user", "content": "u"},
        {"role": "assistant", "content": asst},
        {"role": "user", "content": "Usuario_x: 3"},
    ]
    out = resolver_cantidad_tras_oferta_producto(messages, "3")
    assert out is not None
    assert "C-TEST123" in out
    assert "30,000" in out or "30000" in out.replace(",", "")
