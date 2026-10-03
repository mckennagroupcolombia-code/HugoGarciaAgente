#!/usr/bin/env python3
"""Cierra cronómetros que siguen abiertos aunque su tarea ya se cerró (sin sumar tiempo).

Uso:  python3 scripts/cerrar_cronometros_huerfanos.py            # ensayo: lista lo que cerraría
      python3 scripts/cerrar_cronometros_huerfanos.py --aplicar  # los cierra

Ver `app.services.ticket_timing.cerrar_corridas_huerfanas` para el porqué.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.ticket_timing import cerrar_corridas_huerfanas  # noqa: E402

aplicar = "--aplicar" in sys.argv
filas = cerrar_corridas_huerfanas(aplicar=aplicar)
for f in filas:
    print(f"corrida {f['id']:>5}  {f['estado']:<8} desde {f['iniciada_en']}  "
          f"ticket {f['ticket_id']} ({f['ticket_estado']}): {(f['titulo'] or '')[:60]}")
print(f"\n{len(filas)} cronómetro(s) huérfano(s) {'cerrados' if aplicar else '— ensayo, usa --aplicar para cerrarlos'}.")
