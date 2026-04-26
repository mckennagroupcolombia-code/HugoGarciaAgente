# Agentic Memory

Memoria local estilo Engram para que el agente aprenda del proyecto sin meter todo el contexto en cada sesion.

## Fuentes Existentes

| Fuente | Uso |
| --- | --- |
| `CLAUDE.md` | Arquitectura global estable |
| `HISTORIAL_MODIFICACIONES.md` | Cambios grandes y decisiones historicas |
| `docs/agentic/DECISIONS.md` | Decisiones agenticas/tecnicas resumidas |
| `docs/agentic/learned_context.md` | Contexto portable para sync con devs/agentes |
| `app/data/debugging_resuelto.jsonl` | Bugs resueltos con causa y solucion |
| `scripts/guardar_memoria_debug.py` | Guardar fixes repetibles |
| `scripts/consultar_memoria_debug.py` | Buscar fixes por semantica |
| `app/tools/memoria.py` | SQLite/Chroma para memoria conversacional y vectorial |
| `engram` (opcional futuro) | Memoria agent-agnostic con SQLite + FTS5, MCP, HTTP API, CLI, TUI y sync |

## Qué Guardar

Guardar solo conocimiento reutilizable:

- Invariante de negocio o produccion.
- Bug con causa raiz clara.
- Contrato entre servicios.
- Comando de validacion que detecta una regresion real.
- Decision arquitectonica con tradeoff.
- Riesgo de deployment o credencial.

No guardar:

- Resumen de cada edicion trivial.
- Preferencias temporales.
- Logs largos.
- Datos sensibles.

## Esquema Recomendado

```json
{
  "tipo": "bug|decision|contrato|invariante|validacion",
  "modulo": "webhook-meli|whatsapp-routes|core-tools|sync|desktop|ops",
  "titulo": "texto corto",
  "hecho": "observacion reusable",
  "evidencia": "archivo o comando que lo demuestra",
  "archivos": ["ruta/archivo.py"],
  "tags": ["meli", "postventa"],
  "confianza": "alta|media|baja",
  "fecha": "YYYY-MM-DD"
}
```

## Flujo de Uso

Antes del cambio:

```bash
python3 scripts/consultar_memoria_debug.py --q "webhook meli messages x-version"
```

Despues de resolver bug o decision reusable:

```bash
python3 scripts/guardar_memoria_debug.py \
  --titulo "Titulo corto" \
  --problema "Que se rompia" \
  --causa-raiz "Causa raiz" \
  --solucion "Fix aplicado" \
  --archivos "archivo1.py,archivo2.py" \
  --tags "meli,webhook"
```

## Sync Colaborativo

Para compartir contexto con otro dev/agente, exportar aprendizaje estable a:

- `docs/agentic/INDEX.md` si cambia mapa de lectura.
- `docs/agentic/modules/*.md` si cambia invariante de modulo.
- `docs/agentic/DECISIONS.md` si cambia metodologia, arquitectura o regla durable.
- `HISTORIAL_MODIFICACIONES.md` si cambia arquitectura o flujo productivo.
- `app/data/debugging_resuelto.jsonl` si es bug repetible.
- `docs/agentic/learned_context.md` para resumen portable de aprendizajes que otro dev/agente debe cargar al entrar.

La memoria vectorial ayuda al agente; los docs versionados ayudan al equipo.

## Ruta Engram

Adopcion recomendada:

1. Instalar/evaluar `engram` solo en maquina dev.
2. Configurar Cursor/MCP segun docs de Engram o mediante `gentle-ai`.
3. Mapear aprendizajes McKenna a formato `title`, `type`, `What`, `Why`, `Where`, `Learned`.
4. Mantener `docs/agentic/learned_context.md` como resumen versionado.
5. Usar `engram sync` solo despues de revisar que no hay secretos.
