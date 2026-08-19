# Module: Competencia a ojo (MeLi)

## Proposito

Ranking de **más vendidos McKenna** + comparación **manual** de precios: el operador
abre el listado de Mercado Libre **en su navegador**, ve el precio y lo anota en el panel.

**No** scraping, **no** `/sites/MCO/search`, **no** GET de ítems ajenos.

## Archivos ancla

- `app/tools/analisis_competencia_precios.py`
- `desktop/src/components/CompetenciaPreciosPanel.tsx`
- `app/data/analisis_competencia_precios.json` — ranking propio
- `app/data/competencia_observaciones_manual.json` — precios anotados a ojo

## Flujo

1. «Actualizar más vendidos» → órdenes pagadas + nuestros `/items`.
2. En cada producto, «Buscar en MeLi (tu navegador)» abre `listado.mercadolibre.com.co/...` (pestaña nueva).
3. El operador anota precio (y opcional vendedor/link). Se guarda en JSON local.
4. El veredicto (más caros / similares / más baratos) se calcula contra esas anotaciones.

## Invariantes

- El servidor no descarga listados ni publicaciones ajenas.
- Un permalink solo se guarda si es `mercadolibre.com.co`; no se visita.
- No WhatsApp automático de competencia.

## Validar

```bash
python -m pytest tests/test_analisis_competencia_precios.py -q
```
