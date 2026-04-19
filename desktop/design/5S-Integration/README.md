# 5S Integration (diseño de referencia)

## Origen del archivo oficial

La URL pública de Anthropic

`https://api.anthropic.com/v1/design/h/Gs5JxXNBFd239nJsh0Ikeg?open_file=5S+Integration.html`

solo sirve el HTML cuando la petición va **autenticada** (sesión de Claude / token de API de diseño). Desde este entorno devuelve **404**, así que no pudimos copiar el HTML literal del paquete.

## Qué hay en este directorio

| Archivo | Uso |
|--------|-----|
| `5S-Integration.html` | Maqueta estática **local** (layout, tipografía, colores) alineada al README de integración típico: canvas Pampas, acento Crail, rail derecho, tablero de notas, checklist modular. |
| Este `README.md` | Tokens y comportamiento implementados en React (`CincoSExperiencePanel`, wizard). |

## Tokens implementados en Tailwind (`c5s.*`)

- **Canvas** `#f4f3ee` — fondo principal (Pampas).
- **Panel** `#fafaf8` — tarjetas y rail.
- **Línea** `#e5e3dc` — bordes suaves.
- **Tinta** `#141413` — texto principal.
- **Muted** `#6b6962` — secundario.
- **Acento** `#c15f3c` — botones primarios y chips activos (Crail).

Los **LEDs** de estado (rojo / verde) siguen en el tablero; las **notas** usan pastels sin rojo/verde de fondo (`c5s-note-*`).

## Cómo sustituir por el HTML oficial

1. Abrí el diseño en Claude y exportá / copiá `5S-Integration.html`.
2. Reemplazá `5S-Integration.html` en esta carpeta (o pegá fragmentos en un issue).
3. Ajustá clases en `desktop/src/components/CincoSExperiencePanel.tsx` y `CincoSGuidedFlow.tsx` para igualar spacing y copy.
