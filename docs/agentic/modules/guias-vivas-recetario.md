# Guías vivas y recetario paso a paso (web pública)

**Origen:** plan UX del 2026-09-12 para mckennagroup.co (artefacto "Guías Vivas McKenna").
Las 61 guías y 48 recetas eran texto para leer; la meta es que se usen mientras se formula.

## Estado por fase

| Fase | Qué | Estado |
|---|---|---|
| 0 | Guías y recetario heredan la paleta del tema; `.reveal` visible en reposo | Hecho (12-sep-2026) |
| 1 | Recetas v2 + `/recetario/<slug>` (wizard) + `/carrito/agregar-lote` | Hecho (12-sep-2026) |
| 2 | Guía viva: datos en `viva` (conc., pH, temp., compat., incorporación, FAQ) como módulos interactivos | Hecho (12-sep-2026) |
| 3 | Cruces producto ↔ guía ↔ receta (`producto.html` "Aprende a usarlo", receta → guías de activos, guía → recetas) | Hecho (12-sep-2026) |
| 4 | Métricas de uso: 9 eventos, SQLite, `GET /api/web/metricas-contenido`, pestaña "Uso de guías y recetas" en Vitrina Web | Hecho (12-sep-2026) |

## Piezas

- `scripts/extraer_ficha_rapida_guias.py` — sin IA, `--confirmar` para escribir. Deja `guia.viva` con
  `concentraciones[]`, `conc_max_pct`, `ph`, `temp_max_c`, `datos[]`, `compatibles[]`, `incompatibles[]`,
  `compat_texto`, `incorporacion[]`, `almacenamiento`, `faq[]`, `normativa`, `faltan[]`. `viva.manual: true`
  protege correcciones a mano; `viva.desactivar: true` fuerza la plantilla clásica.
- `templates/guia_viva.html` + `static/js/guia-viva.js` — módulos; `website.py::_guia_es_viva()` decide
  la plantilla. Cada módulo se muestra solo si su dato existe; el texto original va plegado al final.

- `scripts/migrar_recetas_v2.py` — sin IA, idempotente, `--confirmar` para escribir. Campos que agrega:
  `slug`, `pasos[] = {texto, accion, min?}`, `ings[] += {propio, slug?, producto?, familia?}`.
  Respeta lo marcado `"manual": true`. Reporta ingredientes sin producto.
- `PAGINA_WEB/site/website.py` — `_cargar_recetas()` (tolera el modelo viejo), `_receta_jsonld()`,
  `receta_detalle()`, `_sumar_al_carrito()` compartido por `/carrito/agregar` y `/carrito/agregar-lote`.
- `templates/receta_detalle.html` + `static/js/recetario-wizard.js` — wizard. El JS es ASCII puro
  (escapes `\uXXXX`) para que no dependa del charset con que se sirva.
- `tests/test_recetario_wizard.py` — inferencia de acción/tiempo, cruce ingrediente → producto,
  rutas, sitemap, lote y paridad formulario/lote.

- `website.py::buscar_contenido_relacionado()` es el único cruce por palabras clave; `contenido_para_producto()`,
  `guias_para_receta()` y `recetas_para_guia()` lo reutilizan en las tres direcciones.
  `tests/test_cruces_producto_guia_receta.py`.

- `app/services/metricas_contenido.py` — eventos (lista cerrada `EVENTOS`), `registrar()`, `resumen(dias)`.
  Escribe website.py vía `POST /api/eventos-contenido`; lee agente_pro vía `GET /api/web/metricas-contenido`.
  Cliente: `static/js/contenido-eventos.js` (`window.mckEvento(evento, slug, detalle, unaVez)`).
  Panel: `VitrinaWebPanel.tsx` → pestaña "Uso de guías y recetas". `tests/test_metricas_contenido.py`.

## Reglas que ya costaron algo

- **Nunca inventar producto.** El cruce exige que todas las palabras clave del ingrediente estén en el
  nombre del producto. Las letras sueltas cuentan: sin eso "Vitamina C" cayó en "VITAMINA E" en la
  primera corrida del migrador, y otra vez en el cruce receta → guía de la Fase 3 (`_claves()` en
  `buscar_contenido_relacionado` las conserva; `_palabras_clave` de drive_documentos NO).
- **`min` solo con tiempo explícito en el texto.** Un temporizador con un número inventado es peor que
  ninguno.
- **Familias no entran al carrito** (`carrito_agregar` lo rechaza). Por eso el wizard muestra
  "Elegir presentación" enlazando a la ficha cuando el cruce cae en una familia.
- **Paleta:** el `color` de `guias.json` es la paleta vieja (`#143D36`, `#1E5C51`, `#2E8B7A`).
  Se traduce a `var(--green-deep|--green-dark|--green)` en las plantillas; no reintroducir hex fijos.
- **El embudo cuenta sesiones, no eventos.** Repetir un paso no es usar tres veces la receta. Para agregar
  un evento nuevo: sumarlo a `EVENTOS` (si no, el endpoint lo rechaza con 400) y llamarlo desde el JS.
- **Sin LLM en ningún endpoint del módulo.** Si se decide completar con IA lo que el extractor no
  encuentra (pH en 28 guías, temperatura en 35), va por `llm_budget` con flag explícito y confirmación
  del usuario (61 guías, del orden de US$1).
- **Un solo `position: relative` de más rompe el fondo:** el SVG hexagonal es absoluto dentro de la
  tarjeta; la regla que eleva el contenido debe excluirlo (`.gv > *:not(.gv-hex)`).

## Cómo probar

```bash
python3 scripts/migrar_recetas_v2.py            # simulación con reporte
python3 scripts/extraer_ficha_rapida_guias.py    # cobertura por guía; --slug X --json para una
venv/bin/python -m pytest tests/test_recetario_wizard.py tests/test_guia_viva.py -q
sudo systemctl restart mckenna-website          # publica (Flask :8083 sin autoreload)
```
