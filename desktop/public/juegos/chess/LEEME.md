# Chessmaster (Game Boy Advance) — emulado

El 2026-09-22 el usuario trajo `~/Descargas/Chessmaster (USA).zip` (TorrentZip; dentro
`Chessmaster (USA).gba`, 4 MB, código `ACYE`, Ubisoft 2002; SHA-256 `adc7b798…19f7490`).

- **Uso solo interno**, dentro de /app → Agenda → Juegos, detrás de la sesión del panel. La ROM es de
  Ubisoft: no publicar fuera del panel. Va como archivo (`rom/chessmaster.gba`; `rom/chessmaster_es.gba`
  cuando exista la traducción, el emulador prueba primero esa).
- **Emulador:** `externalLib/mgba/` = `@wasm-gaming/mgba-wasm` 0.1.1 (MPL-2.0; `LICENSE` es la de mGBA)
  bajado con `npm pack`. Sin BIOS (mGBA trae reemplazo). `emulador.js` sigue el mismo esquema que
  `../bass/emulador.js`: CSP propia (`_JUEGOS_WASM` en `app/routes.py`), partida guardada por
  `postMessage` con el panel (`/api/juegos/partidas/chess`), Esc sale al panel.
- **Controles:** ← → ↑ ↓ · A = X · B = Z · L = A · R = S · Start = Enter · Select = Shift derecho.
  Táctil: cruceta, A, B, L, R, SELECT, START.
- **Textos:** ASCII plano, ~325 KB (5.000 cadenas): menús, nombres de aperturas, tutorial, comentarios de
  aperturas y de ~800 partidas clásicas (188 KB solo estos). Casi ninguna cadena tiene puntero de 32
  bits directo, así que la traducción es **en el mismo sitio y con el mismo largo** (como Bassin's),
  aprovechando los 00 de alineación que siguen a cada texto. `traduccion/es.txt` (OFFSET|original|
  traducción) + `traducir_rom.py aplicar` → `rom/chessmaster_es.gba`. Traducido (511 textos): menús,
  opciones, niveles, rivales, estilos de piezas, mensajes del recuadro (8 caracteres por línea),
  piezas del armado de tablero, títulos del tutor y las frases del consejero (que el juego concatena,
  así que la gramática es aproximada). Sin traducir: el tutorial, los comentarios de aperturas y de
  las partidas clásicas (≈300 KB de prosa) y unas pocas palabras del consejero que no caben
  (rook/knight/pawns, win/lose). Sin acentos ni Ñ.
