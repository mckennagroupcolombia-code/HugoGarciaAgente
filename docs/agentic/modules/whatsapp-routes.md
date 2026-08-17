# Module: WhatsApp Routes

## Proposito

Procesar mensajes entrantes de WhatsApp en Flask principal puerto 8081: comandos de grupos, comprobantes, preventa, postventa, pedidos web y chat IA.

## Archivos Ancla

- `app/routes.py`
- `app/utils.py`
- `modulo_posventa.py`
- `app/tools/web_pedidos.py`
- `app/core.py`

## Invariantes

- `/whatsapp` no debe bloquear con trabajo pesado.
- Grupos oficiales vienen de env o `app/data/grupos_whatsapp_oficiales.json`.
- Comandos preventa usan `resp ...`; comandos postventa usan `posventa <codigo>: ...`.
- Postventa generada por IA requiere aprobacion si aplica, no envio directo accidental.
- Imagen de comprobante crea pendiente y alerta al grupo.
- Estadísticas de postventa (`app/services/postventa_stats.py`, panel `/app` → Postventa): clasificación por palabras clave (sin LLM). Cierres (responder / omitir / auto / hugo dale ok) deben llamar `marcar_mensaje_cerrado`. Reclamos se registran en `crear_accion_anular_factura_por_reclamo` aunque el ticket ya exista (dedup).

## Riesgos

- `app/routes.py` es monolito; cambios pequenos pueden afectar varios flujos.
- Parsers de comandos dependen de texto normalizado de WhatsApp.
- JSON en `app/data/` puede tener carreras si dos hilos escriben.
- Imports desde raiz (`modulo_posventa.py`) dependen de cwd/PYTHONPATH.

## Validacion

- Tests de helpers puros: normalizacion, deteccion de comandos, sufijos.
- `pytest tests/test_smoke.py`
- `python scripts/auditar_scripts_cron.py`

## Memoria Antes de Cambiar

```bash
python3 scripts/consultar_memoria_debug.py --q "whatsapp routes comandos preventa postventa"
```
