# Circus Charlie (NES) — el juego original, emulado

El 2026-09-21 el usuario trajo `~/Descargas/Circus Charlie - 53594.zip` (de un sitio de ROMs; dentro
venía `Circus Charlie (ESP).nes`, iNES de 24.592 bytes: mapper 0, 16 KB PRG + 8 KB CHR, espejo
vertical, sin datos extra; SHA-256 `4acdde88…3142533`). Es la imagen del cartucho de Konami (1986):
el juego completo con sus cinco etapas, música y sonido originales.

- **Uso solo interno**, dentro de /app → Agenda → Juegos, detrás de la sesión del panel. La ROM es
  de Konami: no publicar fuera del panel. El `.nes` no se guarda como archivo; va en base64 dentro
  de `rom_datos.js` (33 KB), porque la CSP del juego no deja `fetch`.
- **Emulador:** `externalLib/jsnes.min.js` = jsnes 2.1.0 (Apache-2.0, `LICENSE` al lado), bajado con
  `npm pack jsnes` (verifica la integridad contra el registro). Revisado: sin llamadas de red ni
  almacenamiento. `emulador.js` (propio) hace el video (256×240 → canvas ×2), el audio (anillo de
  muestras → ScriptProcessorNode; se desbloquea con el primer toque o tecla) y los controles.
- **Controles:** ← → ↑ ↓ (o WASD) · A = Espacio / Z / K · B = X / J · Start = Enter · Select = Shift ·
  M silencia. En pantalla táctil salen botones (◀ ▶ · B · A·SALTAR · SELECT · START).
- Ritmo fijo a 60,1 cuadros/s con acumulador (independiente de la frecuencia de la pantalla).
- Corre en un `<iframe sandbox="allow-scripts">` con la misma CSP que los demás juegos.
- `window.__nes` expone ganchos para las pruebas automáticas.

Antes hubo un port propio en canvas (`../circus/`, etapas 1 y 2) hecho a partir de un remake en C++;
se borró el 2026-09-21 cuando llegó la ROM original.
