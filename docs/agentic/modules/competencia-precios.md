# Module: Competencia MeLi (pantallazo)

## Proposito

Ranking de **más vendidos McKenna** + reporte de competencia por **pantallazo**
del listado que el operador abre en su navegador.

**No** scraping, **no** `/sites/MCO/search`, **no** GET de ítems ajenos.

## Archivos ancla

- `app/tools/analisis_competencia_precios.py`
- `desktop/src/components/CompetenciaPreciosPanel.tsx`
- `desktop/src/lib/capturaCompetenciaMeli.ts`
- `app/data/analisis_competencia_precios.json` — ranking propio
- `app/data/competencia_observaciones_manual.json` — precios (ojo o visión)
- `app/data/competencia_reportes_captura.json` — último reporte por item

## Flujo

1. «Actualizar más vendidos» → órdenes pagadas + nuestros `/items`.
2. «Buscar en MeLi y armar reporte» abre `listado.mercadolibre.com.co/...` y pide
   capturar esa pestaña (o Ctrl+V / subir imagen).
3. Gemini Flash lee **solo esa imagen** y arma el reporte (precios, vendedor, veredicto).
4. Esos precios se guardan como observaciones `fuente=captura_vision`.
5. Sigue existiendo el formulario para anotar un precio a mano.

## Invariantes

- El servidor no descarga listados ni publicaciones ajenas.
- Un permalink solo se guarda si es `mercadolibre.com.co`; no se visita.
- Cada clic de reporte = 1 llamada Gemini (pasa por `llm_budget`).
- No WhatsApp automático de competencia.

## Validar

```bash
python -m pytest tests/test_analisis_competencia_precios.py -q
```
