"""El IVA de comprar y el IVA de vender son dos cosas distintas.

El de VENDER lo decide Alegra: `crear_factura_venta_alegra` lee `tax_ids` y
`tax_rate_total` del producto **en vivo**, y la factura tiene que cuadrar al peso
con lo cotizado. El de COMPRAR lo decide el documento del proveedor.

Estos tests fijan que los cambios del selector de compras (18-sep-2026: excluir
los combos por prefijo `C-`, ignorar preposiciones, casar por raíz) **no puedan**
alcanzar la facturación.
"""
from __future__ import annotations

import ast
import pathlib

RAIZ = pathlib.Path(__file__).resolve().parents[1]


def _importadores(modulo: str) -> set[str]:
    """Archivos de app/ que importan algo de `modulo`."""
    out = set()
    for py in (RAIZ / "app").rglob("*.py"):
        try:
            arbol = ast.parse(py.read_text(encoding="utf8"))
        except (SyntaxError, UnicodeDecodeError):
            continue
        for n in ast.walk(arbol):
            if isinstance(n, ast.ImportFrom) and (n.module or "").endswith(modulo):
                out.add(str(py.relative_to(RAIZ)))
            elif isinstance(n, ast.Import):
                if any(a.name.endswith(modulo) for a in n.names):
                    out.add(str(py.relative_to(RAIZ)))
    return out


def test_el_selector_de_compras_no_lo_usa_nada_de_ventas():
    """`pagos_proveedor` es de compras. Si mañana lo importa un módulo de
    facturación, este test lo dice antes de que una factura salga mal."""
    VENTAS = ("ventas_directas", "alegra.py", "precios_canales", "precios_trm",
              "iva_ventas", "facturacion")
    usuarios = _importadores("pagos_proveedor")
    intrusos = [u for u in usuarios if any(v in u for v in VENTAS)]
    assert intrusos == [], f"módulos de ventas usando el selector de compras: {intrusos}"


def test_la_factura_de_venta_toma_el_iva_del_producto_en_vivo():
    """No del espejo `alegra_items`, cuyo flag de IVA para materias primas nunca
    se curó (la misma sustancia está 19% como combo y 0% como insumo)."""
    fuente = (RAIZ / "app" / "services" / "alegra.py").read_text(encoding="utf8")
    i = fuente.index("def crear_factura_venta_alegra")
    cuerpo = fuente[i:i + 8000]
    assert "producto_alegra.get(\"tax_ids\")" in cuerpo
    assert "alegra_items" not in cuerpo
    assert "pagos_proveedor" not in cuerpo


def test_ventas_directas_no_lee_el_espejo_del_catalogo():
    fuente = (RAIZ / "app" / "services" / "ventas_directas.py").read_text(encoding="utf8")
    for prohibido in ("alegra_items", "alegra_catalogo_db", "pagos_proveedor"):
        assert prohibido not in fuente, prohibido
