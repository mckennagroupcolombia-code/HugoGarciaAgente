# Recursos de «Empresa viva» (pixel art)

El juego (`desktop/src/components/empresa/`, Phaser 4) carga todo de `pixel/`. Flask lo sirve en
`/app/empresa/<ruta>` (`serve_spa_empresa` en `app/routes.py`, mismo guardia de sesión que el panel).

| Archivo | Qué es | Lo arma |
|---|---|---|
| `pixel/suelo.png` | el piso de todo el barrio (pasto, calle, andenes, pisos y muros) | `scripts/empresa_viva/armar_mapa.py` |
| `pixel/muebles.png` + `.json` | atlas de muebles (se ordenan por profundidad con los personajes) | idem |
| `pixel/objetos.png` + `.json` | lo que se mueve o cambia: cajas, avioncitos, frascos, papeles, moto, camión | idem |
| `pixel/techos/<casa>.png` | techo + fachada de cada casa (se desvanece cuando el jugador entra) | idem |
| `pixel/hugo.png` | Hugo, el agente (4 cuadros) | idem |
| `pixel/mapa.json` | lugares, puestos, puntos con nombre, muebles, estantes, rejilla de choques | idem |
| `pixel/personajes/` | capas LPC por pieza y tipo de cuerpo + `personajes.json` (catálogo y paletas) | `scripts/empresa_viva/armar_personajes.py` |
| `pixel/fuente/` | Pixelify Sans (OFL) para diálogos y nombres | bajada de Google Fonts |

**No editar a mano** lo generado: se cambia el plano en `armar_mapa.py` (o el catálogo en
`armar_personajes.py`) y se vuelve a correr — el dibujo y la lógica salen del mismo plano, así no se
desalinean. `--vista ruta.jpg` deja una imagen de control del barrio armado.

Créditos y licencias: `pixel/CREDITOS.md` y `pixel/personajes/CREDITOS.md`. El barrio 3D anterior
(Three.js + KayKit/Kenney) se retiró el 2026-10-08; está en el historial de git (commit c13a36ab).
