# Chrono Trigger (SNES) — emulado y en español

El 2026-10-08 el usuario trajo `~/Descargas/Chrono Trigger (USA).zip` (TorrentZip; dentro
`Chrono Trigger (USA).sfc`, 4 MB = 32 Mbit, HiROM + FastROM, 8 KB de SRAM, sin cabecera de copiadora;
CRC32 `2D206BF7`, SHA-256 `06d1c2b06b716052c5596aaa0c2e5632a027fee1a9a28439e509f813c30829a9`) y el
parche `~/Descargas/Chrono_Trigger~U~SNES~T_Esp~Rod_Merida_rh-1·07.zip` (traducción al español, v1.07).

- **Uso solo interno**, dentro de /app → Agenda → Juegos, detrás de la sesión del panel. La ROM es de
  Square: no publicar fuera del panel. Va como archivo (`rom/chrono_es.sfc`) porque el emulador la carga
  con `fetch`.
- **Traducción:** Rod Mérida (traducción y ROMhack), Vicks Delgado (control beta), Mireya Scarlet
  (traducción auxiliar, escena de Flea y Slash) — https://crackowia.com. 100 % traducido, con ñ, tildes
  y ¡¿. El autor exige **mantener su crédito** y **prohíbe distribuirla con ánimo de lucro**: por eso
  se guarda su léame completo en `traduccion/leame_traduccion.txt` (pasado a UTF-8, sin tocar el
  texto) y el crédito sale en la descripción del juego en el panel.
- **Solo la ROM traducida va en el repositorio.** La original se queda en Descargas; para rearmarla:
  `python3 traduccion/aplicar_parche.py` (lee el .zip de Descargas, o se le pasa la ruta del .sfc/.zip).
  El script verifica tamaño y CRC32 de la original (quita la cabecera SMC si la trae), aplica
  `traduccion/CRONO_SP.IPS` (IPS con registros RLE y la extensión de truncado) y escribe
  `rom/chrono_es.sfc`: 4.194.304 bytes, CRC32 `E4389FB6`, SHA-256
  `2680c500569767fec4130e99b3516cc67c77b348c00172daed1ced2a09a32e71`. El parche ya corrige la suma de
  verificación interna del cartucho (cabecera `11DE`/`EE21`).
- **No se aplicó** el parche opcional del mismo autor `extra/CVINAGAR.IPS`, que además cambia Ozzie, Flea
  y Slash por los nombres japoneses castellanizados (Vinagar, Mayón y Saltz). Se aplica en lugar de
  `CRONO_SP.IPS`, nunca encima.
- **Emulador:** el mismo Snes9x en WebAssembly de Bassin's Black Bass. `emulador.js` importa
  `../bass/externalLib/snes9x/snes9x.sdk.js` en vez de copiar el núcleo (2,1 MB): el SDK ubica
  `snes9x.js` y `snes9x.wasm` junto a su propio archivo (`import.meta.url`), y Flask sirve la carpeta de
  bass con la cabecera CORS que necesita el iframe con sandbox. Por eso `_JUEGOS_WASM` (app/routes.py)
  lleva `bass` y `chrono`; si algún día se quita Bassin's, hay que mover su `externalLib/`, no borrarlo.
  Cambiar esa lista exige reiniciar `agente-pro`.
- **CSP propia** (`_csp_juego` en `app/routes.py`): `'wasm-unsafe-eval'`, `blob:` para el AudioWorklet y
  `connect-src 'self'`. La API sigue cerrada porque exige el token Bearer.
- **Partidas guardadas:** el cartucho guarda en SRAM (8 KB, tres ranuras). Mismo protocolo que bass:
  `emulador.js` pide la SRAM al panel por `postMessage` antes de encender, la manda cada 10 s si cambió
  (y al ocultar la pestaña o al salir), y `JuegosPanel.tsx` la guarda con el Bearer del usuario en
  `/api/juegos/partidas/chrono` → `juegos_partidas/usuario_<id>/chrono.sav` (gitignored, con respaldos).
  Dentro del juego se guarda en los puntos de guardado (el destello) o desde el menú en el mapa del mundo.
- **Controles:** ← → ↑ ↓ · A = S · B = X · X = A · Y = Z · L = Q · R = W · Start = Enter · Select =
  Shift derecho. En Chrono Trigger: A habla, examina y confirma; B cancela y, sostenida, corre; X abre el
  menú. Esc sale al panel (guardando antes la SRAM si cambió).
  Táctil: cruceta, A/B/X/Y en rombo, SELECT y START.
