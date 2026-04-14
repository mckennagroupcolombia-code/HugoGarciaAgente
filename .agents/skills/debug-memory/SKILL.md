---
name: debug-memory
description: Guarda y consulta bugs resueltos en memoria vectorial ChromaDB. Usar cuando usuario pida registrar debugging, incidentes, fixes repetibles, lecciones aprendidas o historial tecnico del ajuste agentico.
---

# Debug Memory

## Objetivo

Guardar cada bug resuelto con formato consistente para que agente pueda buscar por similitud semantica y reusar soluciones.

## Flujo minimo

1. Registrar bug con `scripts/guardar_memoria_debug.py`.
2. Confirmar `OK memoria debug guardada`.
3. Consultar con `scripts/consultar_memoria_debug.py --q "<tema>"`.
4. Si resultado sirve, citar fix y archivos.

## Comando de guardado

```bash
source venv/bin/activate
python3 scripts/guardar_memoria_debug.py \
  --titulo "..." \
  --problema "..." \
  --causa-raiz "..." \
  --solucion "..." \
  --archivos "app/a.py,app/b.py" \
  --tags "meli,oauth,debug" \
  --fuente "chat-actual"
```

## Comando de consulta

```bash
source venv/bin/activate
python3 scripts/consultar_memoria_debug.py --q "oauth meli credenciales vacias" --n 5
```

## Reglas de calidad

- `problema`: sintoma observable.
- `causa_raiz`: causa tecnica concreta.
- `solucion`: accion exacta aplicada.
- `archivos`: rutas reales separadas por coma.
- `tags`: 3-8 tags tecnicos.
