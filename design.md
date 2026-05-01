# McKenna Group UI Design System

Fuente de verdad visual para futuros desarrollos web, PDF y agentes de IA. Extraído del sitio actual en `PAGINA_WEB/site`.

## Principios Visuales

McKenna usa una estética técnica, limpia y editorial: laboratorio farmacéutico, catálogo B2B y marca institucional colombiana. El diseño debe sentirse confiable, ordenado y premium sin perder velocidad comercial.

- Look & feel: científico, moderno, minimalista, institucional, con acento natural.
- Jerarquía: titulares grandes, números/secciones editoriales, etiquetas en mayúscula y cards amplias.
- Ritmo visual: mucho aire, bloques verdes profundos contra superficies aqua claras.
- Producto: las fotos deben vivir sobre fondos suaves, con `object-fit: contain`, sin recortes agresivos.
- Movimiento web: hover sutil, elevación leve, escalado de imagen moderado. En PDF se conserva la composición, no la animación.

## Paleta De Colores

Tokens existentes en `main.css`:

| Token | Hex | Uso |
| --- | --- | --- |
| `--green` | `#0c6069` | Primario, botones, acentos, links, bordes activos |
| `--green-dark` | `#045159` | Hover, énfasis, navegación |
| `--green-deep` | `#022D33` | Fondos hero/footer, texto principal oscuro |
| `--green-light` | `#6aacb3` | Acentos secundarios, texto sobre fondos oscuros |
| `--green-pale` | `#c0f0f5` | Bordes, fondos de imagen, separadores suaves |
| `--green-ultra` | `#e3fcff` | Fondo base claro |
| `--text-dark` | `#022D33` | Texto principal |
| `--text-mid` | `#045159` | Texto intermedio |
| `--text-soft` | `#0c6069` | Texto secundario con marca |
| `--text-muted` | `#3a7e87` | Metadatos, descripciones, labels |
| `--border` | `rgba(12,96,105,0.18)` | Líneas y contornos suaves |

Estados:

- Éxito/WhatsApp: `#25D366`, hover `#1EBF5A`.
- Error: fondo `#fff5f5`, borde `#feb2b2`, texto `#c53030`.
- Info: `--green-ultra` con borde `--green-pale`.
- Advertencia: fondo claro aqua con borde izquierdo `--green`.

## Tipografía

Fuente actual: `Montserrat`. Si `Geomanist` llega a estar configurada como fuente local, puede usarse como fuente principal de marca, pero no inventarla si no está cargada.

Escala usada:

- Hero title: `clamp(36px, 10vw, 56px)` en móvil y hasta `52px+` en secciones.
- Section title: `clamp(34px, 3.5vw, 52px)`, peso `800`, tracking `-1px`.
- Body: `16px`, line-height `1.75`, peso `400`.
- Labels/eyebrows: `10px-12px`, peso `700`, uppercase, letter-spacing `2px-3px`.
- Nav/buttons: `10px-12px`, peso `700`, uppercase, letter-spacing `1.5px-2px`.
- Precios: peso `800`, color primario, tracking leve negativo.

Regla: usar pesos contrastados (`300/400` para texto editorial, `700/800` para marca y precios). Evitar fuentes mezcladas.

## Geometría Y Espaciado

La geometría es recta con radios moderados. No usar estilo “pill” excepto badges pequeños.

- Border radius base: `4px`.
- Radius mini card/footer social: `4px-6px`.
- Radius notificaciones/inputs grandes: `8px-12px`.
- Bordes: `1px-2px`, preferir `1.5px solid var(--green-pale)`.
- Layout máximo: `1280px`.
- Header desktop: `72px` alto, padding horizontal `64px`.
- Secciones: `96px 64px` desktop; `56px 20px` móvil.
- Cards producto: grid `300px 1fr` en catálogo; colapsa a una columna en móvil.
- Gaps: `10px`, `14px`, `16px`, `24px`, `32px`, `40px`, `48px`, `64px`, `96px`.

## Sistema De Rejilla

- Desktop: layouts divididos 2 columnas para hero y cards.
- Catálogo: sticky nav horizontal, secciones verticales, cards anchas.
- Cards: sidebar oscuro/coloreado para foto y precio, cuerpo blanco para descripción y acciones.
- Mobile: ocultar nav principal, colapsar cards, mantener botones full-width cuando aplique.
- PDF: usar grilla de cards compactas, conservar colores, labels, fotos y precios, sin navegación interactiva.

## Componentes Clave

### Botones

Base:
- `inline-flex`, centrado, gap `8px`.
- Padding `14px 36px`, radius `4px`.
- Texto uppercase, `11px`, peso `700`, letter-spacing `1.5px`.
- Borde `1.5px`.

Variantes:
- Primario: fondo `--green`, texto blanco.
- Oscuro: fondo `--green-deep`, texto blanco.
- Outline: transparente, borde/texto `--green`.
- WhatsApp: `#25D366`.
- Ghost oscuro: texto `--text-muted`, transparente.

### Cards

Producto catálogo:
- Grid `300px 1fr`.
- Sidebar con `cat_color`, foto sobre fondo suave.
- Cuerpo blanco con padding amplio (`48px 56px`).
- Hover: sombra suave + translate `-2px`; imagen scale máximo `1.05`.

Mini cards:
- Fondo blanco/aqua, borde `green-pale`, radius `4px`, overflow hidden.
- Imagen `aspect-ratio: 1`, `object-fit: contain`.

### Inputs

- Fuente Montserrat.
- Radius `4px`.
- Estados focus con borde `green-light`.
- No usar sombras pesadas.

### Badges Y Labels

- Uppercase, tracking alto.
- Colores suaves (`green-light`, `text-muted`).
- Badges en hero/categoría pueden usar borde claro y fondo translúcido.

## Reglas De Oro

### Do

- Usar tokens existentes antes de crear nuevos colores.
- Mantener fondos claros aqua y bloques verde profundo.
- Usar `object-fit: contain` para fotos de producto.
- Mantener precios muy visibles.
- Usar labels uppercase para navegación, categorías y metadatos.
- Conservar separación generosa: el diseño respira.
- Para PDF, reproducir la lógica visual de la web, no screenshots ni coordenadas rígidas.

### Don’t

- No crear categoría pública `Combos`; es manejo interno de SIIGO.
- No mezclar fotos entre productos si hay SKU/foto propia esperada.
- No usar fondos grises genéricos cuando existe `green-ultra`.
- No usar radios grandes tipo SaaS moderno (`20px+`) en componentes base.
- No usar sombras duras o negras pesadas.
- No recortar envases/fotos con `cover` si deben mostrarse completos.
- No inventar paletas nuevas ni colores saturados fuera de WhatsApp/estados.
- No introducir Bootstrap/Tailwind visual si rompe el ADN actual.

## Aplicación A Catálogo PDF

El PDF debe usar el mismo ADN:

- Portada con bloque verde profundo, isotipo como marca de agua y hero editorial.
- Cards limpias por producto, foto arriba o lateral, precio destacado y ref visible.
- Secciones por categoría, con contador y barra/label editorial.
- Fondo claro `#e3fcff`, superficies blancas y bordes `#c0f0f5`.
- Generación preferida: HTML/CSS print con Jinja + WeasyPrint.
