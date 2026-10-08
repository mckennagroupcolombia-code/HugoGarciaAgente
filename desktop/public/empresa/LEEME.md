# Modelos 3D de «Empresa viva»

Solo los modelos que usa el juego (`desktop/src/components/empresa/`). Todos con licencia **CC0 1.0** (dominio público).

| Carpeta | Pack de origen | Licencia |
|---|---|---|
| `kaykit/ciudad/` | KayKit City Builder Bits (edificios vecinos, postes, carros, setos) | `kaykit/LICENSE-kaykit.txt` |
| `kaykit/muebles/` | KayKit Furniture Bits (interiores) | idem |
| `kaykit/cocina/` | KayKit Restaurant Bits (cocina, mostrador, frascos de la bodega) | idem |
| `kaykit/medieval/decoration/nature/` | KayKit Medieval Hexagon (árboles redondos) | idem |
| `personajes/` | Kenney Mini Characters (12 personajes animados + gafas; `previews/` = miniaturas) | `LICENSE-kenney.txt` |
| `muebles/`, `carros/`, `naturaleza/` | Kenney Furniture Kit, Car Kit, Nature Kit (lo que KayKit no trae) | idem |

KayKit: https://github.com/KayKit-Game-Assets (Kay Lousberg). Kenney: https://kenney.nl.
Cada `.gltf` de KayKit trae su `.bin` y la textura del pack al lado; los `.glb` de Kenney leen `Textures/colormap.png`.
No mover un modelo a la carpeta de otro pack. Para agregar uno: copiar sus archivos a la carpeta de su pack y
registrarlo en `MUEBLE` (`escena.ts`) con su escala (KayKit Furniture/Restaurant: `s: 0.5`).
