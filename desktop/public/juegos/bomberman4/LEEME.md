# Super Bomberman 4 (SNES) — en preparación

El 2026-10-08 el usuario pidió agregarlo y dejó en `~/Descargas/Super Bomberman 4 (S).zip`: **es solo el parche
de traducción al español**, no el juego. Falta la ROM `Super Bomberman 4 (Japan).sfc` (CRC32 `3BBAEB19`, MD5
`DF33E261104EFEE409DE8F294D80AD6E`, según el léame del parche). El otro zip que había, «Super Bomberman (USA)
(Sample)», es la demo del primer Super Bomberman, no el 4.

- **Traducción:** Max1323 (Traducciones Max1323), v1.1 del 13-feb-2026, basada en la de Svambo. Su léame va completo
  en `traduccion/leame_traduccion.txt` (pasado a UTF-8); hay que mantener el crédito.
- **Cuando llegue la ROM** a Descargas: `python3 traduccion/aplicar_parche.py` (verifica el CRC32, quita la cabecera
  SMC si la trae, aplica `traduccion/SB4_ES_1.1.ips` y escribe `rom/bomberman4_es.sfc`). Después se arma igual que
  Chrono Trigger: `index.html` + `emulador.js` (importa el Snes9x de `../bass/externalLib/`), la entrada en
  `JuegosPanel.tsx`, `bomberman4` en `_JUEGOS_WASM` (app/routes.py) y en `tests/test_juegos.py`. Mientras no esté la
  ROM, el juego **no** está en la lista.
