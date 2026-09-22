# Circus Charlie (juego interno del panel)

Origen: https://github.com/HyunjungLee-dev/Circus-Charlie (commit 4e9f8c2, 2020), un remake de la
etapa 1 en **C++/WinAPI** (programa de Windows). No se puede ejecutar en el navegador, así que el
2026-09-21 se **portó a JavaScript/canvas** (`juego.js`, ~450 líneas) conservando sus sprites,
la disposición del escenario, los puntajes y el ciclo del juego. No se usa ningún binario del
repositorio original (traía `.exe`, `.obj` y 2,6 GB de caché de Visual Studio).

- **Uso solo interno**, dentro de /app → Agenda → Juegos, detrás de la sesión del panel. El
  repositorio no trae licencia y los sprites son de Konami (Circus Charlie, 1984): no publicar
  fuera del panel.
- `res/*.png`: los 24 BMP que el original carga, convertidos con el magenta (#FF00FF) como
  transparencia (era la clave de `TransparentBlt`). Los `enemy_l*.bmp` no se usaban y no se copiaron.
- **Sonido:** el original no tiene. Los efectos (salto, punto, premio, caída, podio) se sintetizan con
  Web Audio; no hay archivos de audio. Arrancan tras el primer toque o tecla. La **música** es
  `musica.js`: cuatro piezas de dominio público transcritas de oído en chiptune, en lista y en el
  orden pedido el 2026-09-21 (Stage 1 «American Patrol», Stage 2 «Entrada de los gladiadores»,
  Stage 5 «El Danubio azul», Stage 4 «Sobre las olas»); suena solo durante la partida y la lista
  sigue donde iba tras perder una vida. **M** silencia (música y efectos), **N** pasa a la siguiente.
  Stage 1 y 5 están identificadas (Meacham / Strauss); Stage 2 y 4 son la mejor suposición.
- **Controles:** ← → / A D mueven, Espacio / ↑ / W salta, Enter (o tocar la pantalla) inicia. En
  pantalla táctil aparecen botones (◀ ▶ SALTAR).
- Corre en un `<iframe sandbox="allow-scripts">` con la misma CSP que Duck Hunt (`connect-src 'none'`):
  no ve el token ni las cookies del panel y no puede llamar a la red.
- Diferencias asumidas respecto al C++: la velocidad va en px/s (el original movía 0,5 px por vuelta
  del bucle, o sea dependía de la CPU; a 150 px/s el jarrón exigía ±0,09 s de precisión, se dejó en
  200 y la caja de choque del jarrón 12 px más angosta que el dibujo); el podio se deja visible antes de detener el desplazamiento
  (en el original quedaba fuera de pantalla); el HI se actualiza si se supera.
- `window.__circus` expone ganchos de solo lectura para las pruebas automáticas.
