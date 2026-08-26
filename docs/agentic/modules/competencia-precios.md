# Module: Competencia MeLi (pantallazo)

## Proposito

Ranking de **más vendidos McKenna** + reporte de competencia por **pantallazo**
del listado que el operador abre en su navegador.

**No** scraping, **no** `/sites/MCO/search`, **no** GET de ítems ajenos.

## Archivos ancla

- `app/tools/analisis_competencia_precios.py`
- `desktop/src/components/CompetenciaPreciosPanel.tsx`
- `desktop/src/components/MeliPromocionesItem.tsx`
- `desktop/src/lib/capturaCompetenciaMeli.ts`
- `app/data/analisis_competencia_precios.json` — ranking propio
- `app/data/competencia_observaciones_manual.json` — precios (ojo o visión)
- `app/data/competencia_reportes_captura.json` — último reporte por item

## Flujo

1. «Actualizar más vendidos» → órdenes pagadas + nuestros `/items`.
2. Clic en el producto abre **Captura y buscar en MeLi** (desplegable). Pegar
   (Ctrl+V), arrastrar o subir el pantallazo analiza esa publicación.
   «Buscar en MeLi» solo abre el listado. **Promociones ofertadas** es otro
   desplegable, aparte.
3. La comparación es por **precio de la unidad** ($ / g o $ / ml),
   en barras (más larga = más caro). Se admiten otros tamaños de la misma
   unidad (250 g vs 500 g); no se mezclan gramos con mililitros.
   El precio base de nuestra publicación se edita y se publica en MeLi.
4. **Promociones ofertadas** (desplegable aparte) lista campañas candidatas
   y permite vincular/quitar (`/api/stock/promociones/*`).
5. Gemini Flash lee **solo esa imagen** y arma el reporte.
6. Esos precios se guardan como observaciones `fuente=captura_vision`.
7. Sigue existiendo el formulario para anotar un precio a mano.

## Invariantes

- El servidor no descarga listados ni publicaciones ajenas.
- Un permalink solo se guarda si es `mercadolibre.com.co`; no se visita.
- Cada clic de reporte = 1 llamada Gemini (pasa por `llm_budget`).
- No WhatsApp automático de competencia.

## Validar

```bash
python -m pytest tests/test_analisis_competencia_precios.py -q
```
