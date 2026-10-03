# Bassin's Black Bass with Hank Parker (SNES) — emulado

El 2026-09-21 el usuario trajo `~/Descargas/Bassin's Black Bass (USA).zip` (TorrentZip; dentro
`Bassin's Black Bass (USA).sfc`, 2 MB, LoROM, 8 KB de SRAM, sin cabecera de copiadora; SHA-256
`e2be173c…d96fa1`). Es el cartucho de Hot-B / Starfish (1994; en Japón «Super Black Bass 2»): un
juego de pesca por torneos, con mucho texto.

- **Uso solo interno**, dentro de /app → Agenda → Juegos, detrás de la sesión del panel. La ROM es
  de Hot-B: no publicar fuera del panel. Va como archivo (`rom/bassin.sfc`) porque el emulador la
  carga con `fetch`.
- **Emulador:** `externalLib/snes9x/` = `@wasm-gaming/snes9x-wasm` 0.1.1 (MIT) bajado con `npm pack`;
  Snes9x compilado a WebAssembly (`snes9x.wasm`, 2,1 MB) con su `LICENSE`. Revisado: sin red salvo
  cargar su propio `.wasm`; la persistencia (OPFS/localStorage) queda apagada porque el iframe con
  sandbox no la tiene. `emulador.js` (propio) carga la ROM, arranca el motor y pone los botones táctiles.
- **CSP propia** (`_csp_juego` en `app/routes.py`, lista `_JUEGOS_WASM`): `'wasm-unsafe-eval'` para
  compilar el núcleo, `blob:` para el AudioWorklet y `connect-src 'self'` (no se puede limitar a la carpeta: el túnel
  de Cloudflare le pasa a Flask el host `127.0.0.1:8081` y la URL absoluta rompía en el dominio).
  La API sigue cerrada porque exige el token Bearer. Cambiar esa lista exige reiniciar `agente-pro`.
- **Partidas guardadas (2026-09-22):** el cartucho guarda en SRAM (8 KB). Como el iframe no tiene
  localStorage ni OPFS, `emulador.js` captura el módulo Emscripten (accesor sobre
  `createSnes9xModule`), pide la SRAM al panel por `postMessage` antes de encender el juego y se la
  manda cada 10 s si cambió (y al ocultar la pestaña). El panel (`JuegosPanel.tsx`) la guarda con su
  Bearer en `GET/PUT /api/juegos/partidas/<juego>` → `juegos_partidas/usuario_<id>/<juego>.sav`
  (gitignored; `comun/` si el token no identifica usuario). Así la partida sigue al usuario entre
  dispositivos. La escritura es «último gana»: dos pestañas del mismo usuario se pisan.
  Al salir (Esc o «✕ Salir») el panel le pide la SRAM al juego antes de desmontarlo (1,5 s máx.).
- **QUIT del juego:** la opción de salir del propio juego («READY TO QUIT?») está hecha para apagar
  la consola y deja la pantalla congelada. No se puede quitar sin parchear el código de la ROM; se
  cambió su texto por «GUARDADO. PULSA ESC O SALIR PARA VOLVER.» y **Esc dentro del juego sale al
  panel** (emulador.js avisa por postMessage). Si alguien queda en la pantalla congelada: Esc, o
  «Reiniciar» (recarga el juego con la partida guardada).
- **Controles:** ← → ↑ ↓ · A = S · B = X · X = A · Y = Z · L = Q · R = W · Start = Enter · Select =
  Shift derecho. Táctil: cruceta, A/B/X/Y en rombo, SELECT y START.
- **Traducción al español (2026-09-22):** `traduccion/`. Los textos van en ASCII plano en el banco
  LoROM `$31` (`0x188000–0x18FFFF`, más uno en `$35` y otro en `$3C`): `FB id` = hablante, `FC 00` =
  salto de línea, `FC 01` = fin de página, `FE xx xx xx` = variable, `00` = fin; el juego los localiza
  con tablas de punteros de 16 bits (p. ej. `0x00C9BA`), así que **cada mensaje se traduce en su mismo
  sitio y con su mismo largo** (relleno con espacios). La caja muestra 3 líneas de ~19 caracteres; la
  fuente tiene mayúsculas, minúsculas y símbolos pero **no acentos ni Ñ** (por eso "vara", "cebo",
  "pececillo"). Flujo: `traducir_rom.py extraer` → editar `es.txt` (índice|texto, " / " línea, " ¶ "
  página) → `fusionar.py` → `traducir_rom.py aplicar` (verifica largo y ancho) → `rom/bassin_es.sfc`.
  Cubre los 421 mensajes con texto (diálogos, consejos, cebos, especies, reglas, intro); quedan en
  inglés los nombres propios, las unidades (LBS.) y los rótulos con fuente grande de los menús
  (START GAME, REGISTRATION, PLAYER'S DATA, EMPTY…), que son gráficos, no texto.
