# Diagramas de arquitectura (Archify)

Toda la lógica del proyecto, dibujada con un mismo lenguaje: **una franja por persona o
sistema, el tiempo de izquierda a derecha y las fases arriba**. Se ven en
`/app → Inventario → Mapa del sistema → Los flujos del proyecto`, incrustados e interactivos
(zoom, búsqueda, recorridos guiados, exportar).

| Archivo | Qué muestra |
|---|---|
| `00-mapa-global` | De la compra al Libro Mayor: cómo se encadenan los flujos |
| `01-flujo-pago` | Solicitud de pago: 3 personas, 2 tokens; el asiento nace antes de girar |
| `02-flujo-producto` | Materia prima → combo → documento → EAN → etiqueta → publicación |
| `cadena-producto` | Dónde se rompe esa cadena (el caso propionato) |
| `03-venta-meli` · `04-venta-web` · `05-venta-whatsapp` | Los tres canales de venta |
| `06-contabilidad` | De cada operación al Libro Mayor, Alegra, banco y contador |
| `mi-agente` | Procesos, puertos y el monolito de rutas |

**Se versiona la fuente (`*.json`) y el índice (`indice.json`); el HTML es derivado y está
en `.gitignore`.** Tras clonar o editar:

```bash
python3 scripts/diagramas_arquitectura.py entregar            # valida y genera todos los HTML
python3 scripts/diagramas_arquitectura.py validar 01-flujo-pago
python3 scripts/diagramas_arquitectura.py anchos  01-flujo-pago   # fija node.width desde el texto
```

Requiere la skill de Archify: `npx skills add tt-a1i/archify -g`. Sin LLM.

## Añadir un flujo nuevo

1. Copiar un `*.workflow.json` parecido y cambiar carriles, nodos y aristas.
2. `anchos` → `validar` hasta que pase → `entregar`.
3. Agregarlo a `indice.json` (orden, grupo y resumen que muestra el panel). Un test falla si
   una fuente no está en el índice o al revés (`tests/test_mapa_producto.py`).

Colores con significado (leyenda de cada diagrama): `frontend` lo hace una persona ·
`backend` lo hace la plataforma · `database` queda guardado · `cloud` sistema externo ·
`external` cliente o tercero · `messagebus` mensajería · **`security` hoy no existe o está
apagado** — no usarlo para resaltar algo que sí funciona.

## Reglas del tipo `workflow` que costó descubrir (2026-09-20)

- **Solo 6 columnas** (`col` 0–5) y ~12 nodos. Un proceso largo se comprime (varios nodos
  por columna, en carriles distintos) o se parte en dos diagramas. Por eso existe el mapa global.
- **Etiquetas de arista cortas (≤ ~10 caracteres).** Una etiqueta larga («por orden de
  llegada») deja a la arista «sin ruta legible posible». Es el error más engañoso: el mensaje
  no menciona la etiqueta.
- **No usar presets de ruta** (`drop`, `outside-right`, `return-left`): en `schema_version 2`
  fallan casi siempre. Ruteo automático, y los cruces se arreglan moviendo o quitando nodos.
- **Un nodo ancho invade el corredor vertical de la columna vecina.** Si una arista vertical
  no encuentra ruta, mirar qué nodo del carril intermedio le tapa el paso.
- El ancho por defecto del nodo es 92 px: sin `anchos`, casi todo título en español no cabe.
- Si dos nodos del mismo carril quedan a 28 px exactos («too short»), ponerle etiqueta a esa
  arista obliga al compilador a abrir el hueco.
- Con 5–6 carriles el diagrama mide más que una pantalla, así que `archify visual-check`
  reporta «containment fail». En el panel va en un marco con desplazamiento; `deliver` sí pasa.

## Reglas de `architecture` y `dataflow`

- `sources` en un componente exige `meta.repository` (URL + SHA de 40) y `--repo-root`.
  `link_mode: "local-only"` porque el repo es privado.
- `fromSide`/`toSide` son un contrato de dirección: entre dos nodos de la misma columna,
  `right`→`left` falla siempre.
- El ancho del `viewBox` manda sobre la legibilidad (el validador proyecta a 1440 px y exige
  ≥ 6 px): acortar texto no basta, hay que estrechar el lienzo.
- En `dataflow` la etiqueta de un flujo mide mínimo 81 px: si el hueco entre etapas es menor,
  sacarla con `labelDy` a la banda libre entre filas.

## Mantener los diagramas honestos

Las cifras están ancladas al 2026-09-20 (24.887 líneas y 1.023 rutas en `routes.py`; 243
combos, 101 documentos sin combo). Los números vivos están en el mismo panel, arriba de
los diagramas: si un diagrama y el panel se contradicen, manda el panel y hay que
actualizar la fuente.
