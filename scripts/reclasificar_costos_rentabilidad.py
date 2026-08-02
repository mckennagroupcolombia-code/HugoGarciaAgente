#!/usr/bin/env python3
"""Reclasifica categorias de componentes en contabilidad.db."""
import sys
sys.path.insert(0, "/home/mckg/mi-agente")

from app.services.rentabilidad import reclasificar_categorias_componentes

r = reclasificar_categorias_componentes()
print("actualizados:", r["actualizados"])
for d in r["detalle"]:
    print(f"  {d['antes']:10} -> {d['despues']:10} | {d['nombre']}")
