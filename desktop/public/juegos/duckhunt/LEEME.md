# Duck Hunt (juego interno del panel)

Origen: https://github.com/grosbouddha/duckhunt (commit c591966, 2013), revisado y limpiado el 2026-09-21.

- **Uso solo interno**, dentro de /app → Agenda → Juegos, detrás de la sesión del panel.
  El repositorio original no trae licencia y los sprites/sonidos son de Nintendo: no publicar
  fuera del panel.
- Se quitó: `mongoose-3.7.exe`, los `.swf` de Flash, los `.psd`, capturas, Google Analytics,
  el widget de Twitter y Google Fonts. No hace ninguna llamada de red.
- Corre en un `<iframe sandbox="allow-scripts">` (origen opaco): no puede leer el token ni las
  cookies del panel. Flask lo sirve con CSP `connect-src 'none'` (ver `serve_spa_juegos`).
- Cambios al código: `index.html` (sin parámetros de URL, `serverRoot` = carpeta de la página,
  viewport de celular) y `src/SoundManager.js` (`url` relativo a esa carpeta).
- **Sonido:** SoundManager2 se reemplazó por `externalLib/sonido_webaudio.js` (Web Audio, misma
  interfaz). En el celular SoundManager2 no sonaba. Los MP3 van incrustados en
  `statics/sounds/sonidos_datos.js` porque la CSP no deja pedir nada por red: si cambias un MP3,
  regenera ese archivo (base64 de cada `statics/sounds/*.mp3`).
- **Toque:** `src/Tactil.js`. cake.js calcula el objetivo una vez por cuadro con el último
  `mousemove`; con el dedo el disparo se evaluaba contra la posición anterior. Esa capa mueve la
  mira, recalcula el objetivo y recién entonces dispara.
- Al cambiar el juego, subir el `?v=` del `src` en `desktop/src/components/JuegosPanel.tsx`.
