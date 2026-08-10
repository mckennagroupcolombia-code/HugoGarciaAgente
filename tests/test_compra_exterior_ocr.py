"""Tests puros de prorrateo TRM/flete y unidades ml/g/un para compras exterior."""
from __future__ import annotations

from app.services.compra_exterior_ocr import (
    calcular_landed,
    inferir_unidad_y_contenido,
    inferir_unidades_por_pack,
    normalizar_lineas,
    normalizar_unidad_base,
)


def test_normalizar_completa_subtotal():
    lineas = normalizar_lineas(
        [{"nombre": "Urea", "cantidad": 2, "precio_unit": 10, "unidad": "kg"}]
    )
    assert len(lineas) == 1
    assert lineas[0]["subtotal"] == 20
    # "kg" sin número → unidad g con contenido 1 (fallback)
    assert lineas[0]["unidad"] == "g"
    assert lineas[0]["unidades_por_pack"] == 1.0
    assert lineas[0]["unidades_totales"] == 2.0


def test_normalizar_unidad_base_sinonimos():
    assert normalizar_unidad_base("mL") == "ml"
    assert normalizar_unidad_base("gramos") == "g"
    assert normalizar_unidad_base("pcs") == "un"
    assert normalizar_unidad_base("litros") == "ml"
    assert normalizar_unidad_base("kg") == "g"


def test_inferir_100pcs_del_nombre():
    assert inferir_unidades_por_pack("mascara tubes, 100pcs") == 100.0
    assert inferir_unidades_por_pack("tubos 50 piezas") == 50.0
    assert inferir_unidades_por_pack("pack of 25 bottles") == 25.0
    u, c = inferir_unidad_y_contenido("mascara tubes, 100pcs")
    assert u == "un" and c == 100.0


def test_inferir_ml_desde_texto():
    u, c = inferir_unidad_y_contenido("Glycerin USP 500ml")
    assert u == "ml" and c == 500.0
    u, c = inferir_unidad_y_contenido("Aceite esencial 1L")
    assert u == "ml" and c == 1000.0
    u, c = inferir_unidad_y_contenido("Serum 30 mL")
    assert u == "ml" and c == 30.0


def test_inferir_g_desde_texto():
    u, c = inferir_unidad_y_contenido("Urea cosmética 250g")
    assert u == "g" and c == 250.0
    u, c = inferir_unidad_y_contenido("Clay powder 1kg")
    assert u == "g" and c == 1000.0
    u, c = inferir_unidad_y_contenido("Manteca de cacao 500 gramos")
    assert u == "g" and c == 500.0


def test_normalizar_sets_de_100():
    lineas = normalizar_lineas(
        [
            {
                "nombre": "mascara tubes, 100pcs",
                "cantidad": 3,
                "precio_unit": 166623,
                "subtotal": 499869,
                "unidad": "pcs",
            }
        ]
    )
    assert lineas[0]["unidad"] == "un"
    assert lineas[0]["unidades_por_pack"] == 100.0
    assert lineas[0]["unidades_totales"] == 300.0


def test_normalizar_materia_prima_ml():
    # 10 frascos de glicerina 500ml → 5000 ml; costo por ml
    lineas = normalizar_lineas(
        [
            {
                "nombre": "Glycerin 500ml",
                "cantidad": 10,
                "precio_unit": 5,
                "subtotal": 50,
                "unidad": "ml",
                "unidades_por_pack": 500,
            }
        ]
    )
    assert lineas[0]["unidad"] == "ml"
    assert lineas[0]["unidades_por_pack"] == 500.0
    assert lineas[0]["unidades_totales"] == 5000.0


def test_normalizar_materia_prima_g_desde_kg():
    lineas = normalizar_lineas(
        [
            {
                "nombre": "Urea 1kg",
                "cantidad": 2,
                "precio_unit": 20,
                "subtotal": 40,
            }
        ]
    )
    assert lineas[0]["unidad"] == "g"
    assert lineas[0]["unidades_por_pack"] == 1000.0
    assert lineas[0]["unidades_totales"] == 2000.0


def test_landed_costo_por_ml():
    lineas = normalizar_lineas(
        [
            {
                "nombre": "Glycerin 500ml",
                "cantidad": 10,
                "unidades_por_pack": 500,
                "unidad": "ml",
                "precio_unit": 5,
                "subtotal": 50,
            }
        ]
    )
    out = calcular_landed(lineas, trm=4000, flete=0, moneda="USD")
    # 50 USD × 4000 = 200000 COP / 5000 ml = 40 COP/ml
    assert out[0]["unidades_totales"] == 5000.0
    assert out[0]["unidad"] == "ml"
    assert out[0]["costo_unitario_cop"] == 40.0


def test_landed_costo_por_g():
    lineas = normalizar_lineas(
        [{"nombre": "Urea 1kg", "cantidad": 2, "precio_unit": 20, "subtotal": 40}]
    )
    out = calcular_landed(lineas, trm=4000, flete=0, moneda="USD")
    # 40×4000 / 2000g = 80 COP/g
    assert out[0]["unidad"] == "g"
    assert out[0]["costo_unitario_cop"] == 80.0


def test_landed_costo_por_pieza_no_por_set():
    lineas = normalizar_lineas(
        [
            {
                "nombre": "mascara tubes, 100pcs",
                "cantidad": 3,
                "unidades_por_pack": 100,
                "precio_unit": 166623,
                "subtotal": 499869,
            }
        ]
    )
    out = calcular_landed(lineas, trm=1, flete=0, moneda="COP")
    assert out[0]["unidad"] == "un"
    assert out[0]["unidades_totales"] == 300.0
    assert out[0]["costo_unitario_cop"] == 1666.23


def test_landed_sin_flete_usd():
    lineas = [
        {"nombre": "A", "cantidad": 2, "precio_unit": 5, "subtotal": 10, "unidades_por_pack": 1, "unidad": "un"},
        {"nombre": "B", "cantidad": 1, "precio_unit": 10, "subtotal": 10, "unidades_por_pack": 1, "unidad": "un"},
    ]
    out = calcular_landed(lineas, trm=4000, flete=0, moneda="USD")
    assert out[0]["costo_unitario_cop"] == 20000.0
    assert out[1]["costo_unitario_cop"] == 40000.0


def test_landed_flete_prorrateo_por_unidades():
    """Flete se reparte por unidades compradas, no por valor $."""
    lineas = [
        # 1 unidad cara
        {"nombre": "A", "cantidad": 1, "precio_unit": 30, "subtotal": 30, "unidades_por_pack": 1, "unidad": "un"},
        # 3 unidades baratas (mismo valor total que A)
        {"nombre": "B", "cantidad": 3, "precio_unit": 10, "subtotal": 30, "unidades_por_pack": 1, "unidad": "un"},
    ]
    out = calcular_landed(lineas, trm=4000, flete=100, moneda="USD", moneda_flete="USD")
    # 100 USD × 4000 = 400_000 COP → A 1/4, B 3/4
    assert out[0]["peso_flete"] == 0.25
    assert out[0]["flete_asignado_cop"] == 100000.0
    assert out[0]["flete_por_unidad_cop"] == 100000.0
    # precio pack A = 30×4000=120000 + flete/pack 100000 → 220000 / 1
    assert out[0]["costo_unitario_cop"] == 220000.0
    assert out[1]["peso_flete"] == 0.75
    assert out[1]["flete_asignado_cop"] == 300000.0
    assert out[1]["flete_por_unidad_cop"] == 100000.0
    # precio pack B = 10×4000=40000 + flete/pack 100000 → 140000 / 1
    assert out[1]["costo_unitario_cop"] == 140000.0


def test_landed_flete_prorrateo_por_contenido():
    """Más contenido (ml) absorbe más flete."""
    lineas = [
        {"nombre": "500ml", "cantidad": 1, "precio_unit": 10, "subtotal": 10, "unidades_por_pack": 500, "unidad": "ml"},
        {"nombre": "100ml", "cantidad": 1, "precio_unit": 10, "subtotal": 10, "unidades_por_pack": 100, "unidad": "ml"},
    ]
    out = calcular_landed(lineas, trm=4000, flete=60, moneda="USD", moneda_flete="USD")
    # 600 uds total → 500/600 y 100/600; flete 60×4000=240000
    assert out[0]["peso_flete"] == round(500 / 600, 6)
    assert out[0]["flete_asignado_cop"] == 200000.0
    assert out[1]["flete_asignado_cop"] == 40000.0
    # A: (40000 + 200000) / 500 = 480; B: (40000 + 40000) / 100 = 800
    assert out[0]["costo_unitario_cop"] == 480.0
    assert out[1]["costo_unitario_cop"] == 800.0


def test_landed_flete_en_cop():
    lineas = [{"nombre": "A", "cantidad": 2, "precio_unit": 1, "subtotal": 2, "unidades_por_pack": 1, "unidad": "un"}]
    out = calcular_landed(lineas, trm=4000, flete=20000, moneda="USD", moneda_flete="COP")
    assert out[0]["costo_unitario_cop"] == 14000.0


def test_landed_moneda_cop_sin_trm():
    lineas = [{"nombre": "A", "cantidad": 1, "precio_unit": 5000, "subtotal": 5000, "unidades_por_pack": 1, "unidad": "un"}]
    out = calcular_landed(lineas, trm=0, flete=0, moneda="COP")
    assert out[0]["costo_unitario_cop"] == 5000.0


def test_num_formato_latam_via_normalizar():
    lineas = normalizar_lineas(
        [{"nombre": "X 100pcs", "cantidad": "3", "precio_unit": "166.623,00", "subtotal": "499.869,00"}]
    )
    assert lineas[0]["precio_unit"] == 166623.0
    assert lineas[0]["subtotal"] == 499869.0
    assert lineas[0]["unidad"] == "un"
    assert lineas[0]["unidades_totales"] == 300.0


def test_empaque_vacio_prefiere_un_sobre_ml():
    u, c = inferir_unidad_y_contenido("Empty dropper bottles 100pcs 30ml")
    assert u == "un" and c == 100.0


def test_materia_prima_liquida_prefiere_ml_sobre_pcs():
    u, c = inferir_unidad_y_contenido("Glycerin bottles 100pcs 500ml")
    assert u == "ml" and c == 500.0


def test_normalizar_descuento_pct_linea():
    lineas = normalizar_lineas(
        [
            {
                "nombre": "Glycerin 500ml",
                "cantidad": 2,
                "precio_unit": 10,
                "subtotal": 20,
                "descuento_pct": 20,
                "unidad": "ml",
                "unidades_por_pack": 500,
            }
        ]
    )
    assert lineas[0]["descuento"] == 4.0


def test_landed_descuento_linea():
    # 2 packs × $10 = $20, desc $4 → neto $16 → COP 64000 / 1000 ml = 64
    lineas = normalizar_lineas(
        [
            {
                "nombre": "Glycerin 500ml",
                "cantidad": 2,
                "precio_unit": 10,
                "subtotal": 20,
                "descuento": 4,
                "unidad": "ml",
                "unidades_por_pack": 500,
            }
        ]
    )
    out = calcular_landed(lineas, trm=4000, flete=0, moneda="USD")
    assert out[0]["subtotal_neto"] == 16.0
    assert out[0]["costo_unitario_cop"] == 64.0


def test_landed_descuento_pedido_prorrateado():
    # A $30 + B $10, cupón $8 → A absorbe 6, B 2
    lineas = [
        {"nombre": "A", "cantidad": 3, "precio_unit": 10, "subtotal": 30, "unidades_por_pack": 1, "unidad": "un", "descuento": 0},
        {"nombre": "B", "cantidad": 1, "precio_unit": 10, "subtotal": 10, "unidades_por_pack": 1, "unidad": "un", "descuento": 0},
    ]
    out = calcular_landed(lineas, trm=4000, flete=0, moneda="USD", descuento=8)
    assert out[0]["descuento_pedido_asignado"] == 6.0
    assert out[1]["descuento_pedido_asignado"] == 2.0
    # A neto 24 → 96000 COP / 3 = 32000
    assert out[0]["costo_unitario_cop"] == 32000.0
    assert out[1]["costo_unitario_cop"] == 32000.0


def test_landed_descuento_pct_pedido():
    lineas = [
        {"nombre": "A", "cantidad": 1, "precio_unit": 100, "subtotal": 100, "unidades_por_pack": 1, "unidad": "un"},
    ]
    out = calcular_landed(lineas, trm=4000, flete=0, moneda="USD", descuento_pct=10)
    # neto 90 → 360000 COP
    assert out[0]["subtotal_neto"] == 90.0
    assert out[0]["costo_unitario_cop"] == 360000.0


def test_normalizar_unidad_lista_compras():
    from app.services.compra_exterior_ocr import normalizar_unidad_lista_compras

    assert normalizar_unidad_lista_compras("pcs") == "und"
    assert normalizar_unidad_lista_compras("gramos") == "g"
    assert normalizar_unidad_lista_compras("litros") == "L"
    assert normalizar_unidad_lista_compras("kg") == "kg"
    assert normalizar_unidad_lista_compras("") == "und"


def test_normalizar_items_lista_compras_dedupe():
    from app.services.compra_exterior_ocr import normalizar_items_lista_compras

    items = normalizar_items_lista_compras(
        [
            {"nombre": "Urea", "cantidad": 500, "unidad": "gramos"},
            {"nombre": "urea", "cantidad": 1, "unidad": "g"},
            {"nombre": "Glicerina", "cantidad": "1,5", "unidad": "L"},
            {"nombre": "", "cantidad": 1},
        ]
    )
    assert len(items) == 2
    assert items[0] == {"nombre": "Urea", "cantidad": 500.0, "unidad": "g"}
    assert items[1]["nombre"] == "Glicerina"
    assert items[1]["unidad"] == "L"
    assert items[1]["cantidad"] == 1.5


def test_normalizar_items_lista_etiquetas():
    from app.services.compra_exterior_ocr import normalizar_items_lista_etiquetas

    items = normalizar_items_lista_etiquetas(
        [
            {"nombre": "Elastina 30 ml", "cantidad": 50},
            {"nombre": "elastina 30 ml", "cantidad": 10},
            {"nombre": "Urea 125 g", "cantidad": 1.4},
            {"nombre": "", "cantidad": 5},
        ]
    )
    assert len(items) == 2
    assert items[0] == {"nombre": "Elastina 30 ml", "cantidad": 50.0, "unidad": "u"}
    assert items[1] == {"nombre": "Urea 125 g", "cantidad": 1.0, "unidad": "u"}
