"""Búsqueda de facturas de proveedores (Gmail) por producto."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

from app.tools.importar_productos_siigo import (
    _coincidencias_producto_items,
    anios_consulta_archivo,
    consultar_facturas_por_producto,
)


def test_coincidencias_producto_por_nombre():
    items = [
        {"nombre": "MENTOL CRYSTAL NATURAL", "codigo": "MENCRYg", "precio_neto": 10},
        {"description": "Creatina monohidrato", "quantity": 2, "price": 100},
    ]
    hits = _coincidencias_producto_items(items, "MENTOL")
    assert len(hits) == 1
    assert "MENTOL" in hits[0]["nombre"].upper()


def test_anios_consulta_archivo_desde_2022():
    assert anios_consulta_archivo(2024) == [2022, 2023, 2024]
    assert anios_consulta_archivo(2021) == []


def test_consultar_facturas_por_producto_pendiente_e_historial(tmp_path: Path):
    pendientes = {
        "pendientes": {
            "8450": {
                "numero_factura": "FV8450",
                "proveedor": "Proveedor Test",
                "nit": "900",
                "items_count": 1,
                "total": 5000,
                "estado": "pendiente",
                "timestamp": "2026-08-01T10:00:00",
                "datos_json": json.dumps(
                    {
                        "number": "FV8450",
                        "proveedor": "Proveedor Test",
                        "fecha": "2026-07-30",
                        "items": [
                            {
                                "description": "AMINOACIDO CREATINA MONOHIDRATO",
                                "quantity": 10,
                                "price": 100,
                                "subtotal": 1000,
                            }
                        ],
                    }
                ),
            }
        }
    }
    historial = {
        "historial": [
            {
                "id": "h1",
                "sufijo": "9981",
                "numero_factura": "FEE99814",
                "proveedor": "FACTORES",
                "nit": "800",
                "total": 100,
                "fecha_factura": "2026-07-01",
                "items_count": 1,
                "accion": "inventario",
                "estado": "ok",
                "timestamp": "2026-07-02T12:00:00",
                "items_resumen": [
                    {"nombre": "ALULOSA/ALLULOSE", "codigo": "ALU", "precio_neto": 20}
                ],
                "ruta_xml": None,
            }
        ]
    }
    indice_2025 = {
        "anio": 2025,
        "facturas": [
            {
                "origen": "gmail-2025",
                "id": "gmail-2025-FV9001",
                "sufijo": "9001",
                "numero_factura": "FV9001",
                "proveedor": "Proveedor 2025",
                "nit": "700",
                "fecha": "2025-06-15",
                "total": 2000,
                "accion": None,
                "estado": "archivo",
                "timestamp": "2025-06-15T12:00:00",
                "items_resumen": [
                    {"nombre": "MENTOL CRYSTAL", "codigo": "MEN", "precio_unitario": 50}
                ],
                "items_count": 1,
            }
        ],
        "actualizado": "2026-08-01T00:00:00",
        "fuente": "test",
    }
    indice_2022 = {
        "anio": 2022,
        "facturas": [
            {
                "origen": "gmail-2022",
                "id": "gmail-2022-FV2201",
                "sufijo": "2201",
                "numero_factura": "FV2201",
                "proveedor": "Proveedor 2022",
                "nit": "600",
                "fecha": "2022-03-10",
                "total": 900,
                "accion": None,
                "estado": "archivo",
                "timestamp": "2022-03-10T12:00:00",
                "items_resumen": [
                    {"nombre": "MENTOL CRYSTAL", "codigo": "MEN", "precio_unitario": 40}
                ],
                "items_count": 1,
            }
        ],
        "actualizado": "2026-08-01T00:00:00",
        "fuente": "test",
    }

    def _cargar_indice(anio: int) -> dict:
        if int(anio) == 2025:
            return indice_2025
        if int(anio) == 2022:
            return indice_2022
        return {"anio": int(anio), "facturas": [], "actualizado": None, "fuente": None}

    with (
        patch("app.tools.importar_productos_siigo.sincronizar_historial_desde_importaciones", return_value=0),
        patch("app.tools.importar_productos_siigo._cargar_pendientes", return_value=pendientes),
        patch("app.tools.importar_productos_siigo._cargar_historial", return_value=historial),
        patch("app.tools.importar_productos_siigo._calcular_tendencias_precio_historial", return_value={}),
        patch("app.tools.importar_productos_siigo._cargar_indice_consulta_anio", side_effect=_cargar_indice),
        patch("app.tools.importar_productos_siigo.construir_indice_consulta_anio", return_value={"ok": True}),
    ):
        creatina = consultar_facturas_por_producto("creatina")
        assert creatina["total"] == 1
        assert creatina["resultados"][0]["origen"] == "pendiente"
        assert creatina["resultados"][0]["numero_factura"] == "FV8450"
        assert "CREATINA" in creatina["resultados"][0]["coincidencias"][0]["nombre"].upper()

        alulosa = consultar_facturas_por_producto("alulosa")
        assert alulosa["total"] == 1
        assert alulosa["resultados"][0]["origen"] == "historial"
        assert alulosa["resultados"][0]["numero_factura"] == "FEE99814"

        mentol_2025 = consultar_facturas_por_producto("mentol", anio=2025)
        assert mentol_2025["total"] == 1
        assert mentol_2025["resultados"][0]["numero_factura"] == "FV9001"
        assert mentol_2025["resultados"][0]["origen"] == "gmail-2025"

        mentol_2022 = consultar_facturas_por_producto("mentol", anio=2022)
        assert mentol_2022["total"] == 1
        assert mentol_2022["resultados"][0]["numero_factura"] == "FV2201"
        assert mentol_2022["resultados"][0]["origen"] == "gmail-2022"

        mentol_todos = consultar_facturas_por_producto("mentol")
        nums = {r["numero_factura"] for r in mentol_todos["resultados"]}
        assert "FV9001" in nums
        assert "FV2201" in nums

        solo_2026 = consultar_facturas_por_producto("mentol", anio=2026)
        assert solo_2026["total"] == 0

        vacio = consultar_facturas_por_producto("xyznoexiste")
        assert vacio["total"] == 0
