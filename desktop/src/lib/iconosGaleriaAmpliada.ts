/**
 * Ampliación de la galería de íconos (2026-09): ~10 íconos más por categoría,
 * para que cada atributo de la ficha tenga opciones variadas (p. ej. origen
 * marino, mineral o importado; aroma cítrico, herbal o especiado; los
 * pictogramas de conservación y los EPP de seguridad).
 *
 * Mismos criterios que `iconosQuimicaCirculares.ts`: viewBox 0 0 100 100,
 * `currentColor`, trazo 4–5, una sola idea por ícono y el círculo exterior
 * r=44 que la galería puede quitar. Los detalles en blanco (#ffffff) son
 * recortes sobre una parte rellena.
 */

import type { IconoQuimicoCircular } from "./iconosQuimicaCirculares";

const SVG_ABRE =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">`;
const CIRCULO_EXT = `<circle cx="50" cy="50" r="44" stroke-width="3.2"/>`;

export const ICONOS_GALERIA_AMPLIADA: IconoQuimicoCircular[] = [

  // --- PAÍS DE ORIGEN / ORIGEN ---
  {
    id: "origen_montanas",
    nombre: "Montañas / Origen Andino",
    categoria: "origen",
    tags: ["origen", "montaña", "andes", "sierra", "altura", "paisaje", "natural"],
    // Dos picos y un sol relleno.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M18 74 L38 40 L50 58 L60 46 L82 74 Z" stroke-width="4.5"/>
      <path d="M32 50 L38 40 L44 50" stroke-width="3.5"/>
      <circle cx="66" cy="30" r="7" fill="currentColor" stroke="none"/>
    </svg>`,
  },
  {
    id: "origen_brote_planta",
    nombre: "Brote / Origen Vegetal",
    categoria: "origen",
    tags: ["origen", "planta", "brote", "vegetal", "natural", "cultivo", "botanico"],
    // Tallo con dos hojas (una rellena) sobre la tierra.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M50 80 L50 46" stroke-width="4.5"/>
      <path d="M50 60 C36 60 26 50 26 36 C40 36 50 46 50 60 Z" stroke-width="4"/>
      <path d="M50 46 C50 32 60 22 74 22 C74 36 64 46 50 46 Z" fill="currentColor" stroke-width="3"/>
      <line x1="32" y1="80" x2="68" y2="80" stroke-width="4.5"/>
    </svg>`,
  },
  {
    id: "origen_arbol",
    nombre: "Árbol / Origen Forestal",
    categoria: "origen",
    tags: ["origen", "arbol", "bosque", "forestal", "madera", "corteza", "natural"],
    // Copa redonda con tronco ramificado.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <circle cx="50" cy="38" r="20" stroke-width="4.5"/>
      <path d="M50 58 L50 80 M50 68 L42 60 M50 64 L58 56" stroke-width="4.5"/>
      <line x1="36" y1="80" x2="64" y2="80" stroke-width="4.5"/>
    </svg>`,
  },
  {
    id: "origen_avion_importado",
    nombre: "Avión / Importado",
    categoria: "origen",
    tags: ["origen", "importado", "avion", "internacional", "extranjero", "envio"],
    // Silueta de avión rellena, vista desde arriba.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M50 18 C53 18 55 21 55 25 L55 42 L80 56 L80 62 L55 55 L55 70 L63 76 L63 81 L50 78 L37 81 L37 76 L45 70 L45 55 L20 62 L20 56 L45 42 L45 25 C45 21 47 18 50 18 Z" fill="currentColor" stroke-width="2"/>
    </svg>`,
  },
  {
    id: "origen_barco_carga",
    nombre: "Barco de Carga / Importación",
    categoria: "origen",
    tags: ["origen", "importado", "barco", "maritimo", "contenedor", "exportacion"],
    // Casco relleno con dos contenedores y oleaje.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M20 56 L80 56 L71 70 L29 70 Z" fill="currentColor" stroke-width="3"/>
      <rect x="30" y="40" width="17" height="12" rx="1.5" stroke-width="4"/>
      <rect x="51" y="40" width="17" height="12" rx="1.5" stroke-width="4"/>
      <path d="M58 40 L58 28" stroke-width="4"/>
      <path d="M22 80 C28 75 34 85 40 80 C46 75 52 85 58 80 C64 75 70 85 78 80" stroke-width="3.5"/>
    </svg>`,
  },
  {
    id: "origen_brujula",
    nombre: "Brújula / Procedencia",
    categoria: "origen",
    tags: ["origen", "brujula", "norte", "direccion", "procedencia", "ubicacion"],
    // Brújula con la aguja norte rellena.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <circle cx="50" cy="50" r="30" stroke-width="4.5"/>
      <path d="M50 26 L58 50 L42 50 Z" fill="currentColor" stroke-width="3"/>
      <path d="M42 50 L50 74 L58 50" stroke-width="3.5"/>
      <circle cx="50" cy="50" r="3" fill="#ffffff" stroke="none"/>
    </svg>`,
  },
  {
    id: "origen_campo_cultivo",
    nombre: "Campo de Cultivo / Agrícola",
    categoria: "origen",
    tags: ["origen", "campo", "cultivo", "agricola", "cosecha", "finca", "granja"],
    // Surcos en perspectiva hacia el horizonte con sol relleno.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <circle cx="50" cy="32" r="9" fill="currentColor" stroke="none"/>
      <line x1="20" y1="52" x2="80" y2="52" stroke-width="4.5"/>
      <path d="M22 80 L42 52 M50 80 L50 52 M78 80 L58 52" stroke-width="4"/>
      <path d="M34 80 L46 52 M66 80 L54 52" stroke-width="3"/>
    </svg>`,
  },
  {
    id: "origen_mar",
    nombre: "Mar / Origen Marino",
    categoria: "origen",
    tags: ["origen", "mar", "marino", "oceano", "sal marina", "agua", "costa", "olas"],
    // Tres olas apiladas.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M20 36 C27 29 34 43 41 36 C48 29 55 43 62 36 C69 29 76 43 80 38" stroke-width="4.5"/>
      <path d="M20 52 C27 45 34 59 41 52 C48 45 55 59 62 52 C69 45 76 59 80 54" stroke-width="4.5"/>
      <path d="M20 68 C27 61 34 75 41 68 C48 61 55 75 62 68 C69 61 76 75 80 70" stroke-width="4.5"/>
    </svg>`,
  },
  {
    id: "origen_mina_mineral",
    nombre: "Mina / Origen Mineral",
    categoria: "origen",
    tags: ["origen", "mineral", "mina", "roca", "piedra", "yacimiento", "pico"],
    // Pica sobre una roca rellena.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M22 80 L30 62 L44 56 L58 60 L70 68 L76 80 Z" fill="currentColor" stroke-width="3"/>
      <path d="M30 36 C38 24 52 18 68 20" stroke-width="5"/>
      <line x1="50" y1="23" x2="64" y2="48" stroke-width="5"/>
    </svg>`,
  },
  {
    id: "origen_fabrica",
    nombre: "Planta / Fabricado",
    categoria: "origen",
    tags: ["origen", "fabrica", "planta", "industrial", "fabricado", "manufactura", "produccion"],
    // Nave con techo de sierra y chimenea.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M22 80 L22 50 L35 41 L35 50 L48 41 L48 50 L61 41 L61 80" stroke-width="4.5"/>
      <path d="M66 80 L66 24 L76 24 L76 80" stroke-width="4.5"/>
      <line x1="18" y1="80" x2="82" y2="80" stroke-width="4.5"/>
      <rect x="29" y="60" width="8" height="8" fill="currentColor" stroke="none"/>
      <rect x="45" y="60" width="8" height="8" fill="currentColor" stroke="none"/>
    </svg>`,
  },

  // --- AROMA ---
  {
    id: "aroma_hoja_menta",
    nombre: "Hoja / Mentolado-Herbal",
    categoria: "aroma",
    tags: ["aroma", "menta", "hoja", "herbal", "fresco", "mentol", "verde"],
    // Hoja con nervio central y nervaduras.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M22 78 C22 44 44 22 78 22 C78 56 56 78 22 78 Z" stroke-width="4.5"/>
      <path d="M22 78 L62 38" stroke-width="3.5"/>
      <path d="M36 64 L36 52 M46 54 L46 42 M36 64 L48 64 M46 54 L58 54" stroke-width="3"/>
    </svg>`,
  },
  {
    id: "aroma_citrico",
    nombre: "Rodaja Cítrica / Cítrico",
    categoria: "aroma",
    tags: ["aroma", "citrico", "limon", "naranja", "mandarina", "fresco", "fruta"],
    // Rodaja con gajos.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <circle cx="50" cy="50" r="30" stroke-width="4.5"/>
      <circle cx="50" cy="50" r="22" stroke-width="3"/>
      <path d="M50 50 L50 30 M50 50 L67.3 40 M50 50 L67.3 60 M50 50 L50 70 M50 50 L32.7 60 M50 50 L32.7 40" stroke-width="3.5"/>
    </svg>`,
  },
  {
    id: "aroma_lavanda",
    nombre: "Lavanda / Floral",
    categoria: "aroma",
    tags: ["aroma", "lavanda", "floral", "flor", "relajante", "espiga"],
    // Espiga con botones rellenos alternados.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M50 82 L50 34" stroke-width="4"/>
      <ellipse cx="50" cy="24" rx="4.5" ry="6.5" fill="currentColor" stroke="none"/>
      <ellipse cx="43" cy="34" rx="4.5" ry="7" transform="rotate(-30 43 34)" fill="currentColor" stroke="none"/>
      <ellipse cx="57" cy="34" rx="4.5" ry="7" transform="rotate(30 57 34)" fill="currentColor" stroke="none"/>
      <ellipse cx="42" cy="46" rx="4.5" ry="7" transform="rotate(-30 42 46)" fill="currentColor" stroke="none"/>
      <ellipse cx="58" cy="46" rx="4.5" ry="7" transform="rotate(30 58 46)" fill="currentColor" stroke="none"/>
      <ellipse cx="42" cy="58" rx="4.5" ry="7" transform="rotate(-30 42 58)" fill="currentColor" stroke="none"/>
      <ellipse cx="58" cy="58" rx="4.5" ry="7" transform="rotate(30 58 58)" fill="currentColor" stroke="none"/>
    </svg>`,
  },
  {
    id: "aroma_canela",
    nombre: "Canela / Especiado",
    categoria: "aroma",
    tags: ["aroma", "canela", "especia", "especiado", "calido", "dulce"],
    // Dos ramas de canela enrolladas.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <g transform="rotate(-35 50 50)">
      <rect x="20" y="36" width="60" height="11" rx="5.5" stroke-width="4"/>
      <rect x="20" y="53" width="60" height="11" rx="5.5" stroke-width="4"/>
      <path d="M26 41.5 C26 38 30 38 30 41.5" stroke-width="3"/>
      <path d="M26 58.5 C26 55 30 55 30 58.5" stroke-width="3"/>
      </g>
    </svg>`,
  },
  {
    id: "aroma_incienso",
    nombre: "Incienso / Resinoso",
    categoria: "aroma",
    tags: ["aroma", "incienso", "resina", "amaderado", "humo", "sandalo"],
    // Varilla en su base con humo ondulado.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <line x1="50" y1="78" x2="50" y2="50" stroke-width="4.5"/>
      <circle cx="50" cy="47" r="3.5" fill="currentColor" stroke="none"/>
      <path d="M36 80 L64 80" stroke-width="5"/>
      <path d="M50 40 C42 34 58 28 50 20" stroke-width="3.5"/>
      <path d="M58 40 C54 36 62 32 58 26" stroke-width="3"/>
    </svg>`,
  },
  {
    id: "aroma_cafe",
    nombre: "Grano de Café / Tostado",
    categoria: "aroma",
    tags: ["aroma", "cafe", "tostado", "grano", "intenso", "amargo"],
    // Grano de café relleno con la ranura en blanco.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <ellipse cx="50" cy="50" rx="19" ry="28" transform="rotate(30 50 50)" fill="currentColor" stroke-width="3"/>
      <path d="M40 30 C52 40 48 60 60 70" stroke="#ffffff" stroke-width="4"/>
    </svg>`,
  },
  {
    id: "aroma_hierbas",
    nombre: "Hierbas / Herbal",
    categoria: "aroma",
    tags: ["aroma", "hierba", "herbal", "pasto", "verde", "campo", "fresco"],
    // Tres tallos de hierba que salen del mismo punto.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M50 80 C50 60 46 40 38 22" stroke-width="4.5"/>
      <path d="M50 80 C52 62 60 46 74 36" stroke-width="4.5"/>
      <path d="M50 80 C46 68 36 58 24 54" stroke-width="4.5"/>
      <line x1="36" y1="80" x2="64" y2="80" stroke-width="4.5"/>
    </svg>`,
  },
  {
    id: "aroma_frutal",
    nombre: "Manzana / Frutal",
    categoria: "aroma",
    tags: ["aroma", "frutal", "fruta", "manzana", "dulce", "fresco"],
    // Manzana con tallo y hoja rellena.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M50 38 C42 30 24 32 24 52 C24 70 36 82 50 78 C64 82 76 70 76 52 C76 32 58 30 50 38 Z" stroke-width="4.5"/>
      <path d="M50 38 C50 30 52 25 55 21" stroke-width="4"/>
      <path d="M54 29 C58 21 66 20 71 22 C67 29 60 31 54 29 Z" fill="currentColor" stroke-width="2.5"/>
    </svg>`,
  },
  {
    id: "aroma_pino",
    nombre: "Pino / Amaderado Fresco",
    categoria: "aroma",
    tags: ["aroma", "pino", "bosque", "amaderado", "conifera", "eucalipto", "fresco"],
    // Pino de dos pisos con tronco.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M50 18 L66 42 L58 42 L72 64 L28 64 L42 42 L34 42 Z" stroke-width="4.5"/>
      <line x1="50" y1="64" x2="50" y2="80" stroke-width="5"/>
    </svg>`,
  },
  {
    id: "aroma_picante",
    nombre: "Chile / Picante",
    categoria: "aroma",
    tags: ["aroma", "picante", "chile", "aji", "especia", "pungente", "fuerte"],
    // Chile relleno con tallo.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M30 36 C24 52 36 74 72 78 C58 70 50 56 48 42 C46 32 36 28 30 36 Z" fill="currentColor" stroke-width="3"/>
      <path d="M36 32 C34 26 36 22 42 20" stroke-width="4"/>
    </svg>`,
  },
  {
    id: "aroma_inodoro",
    nombre: "Sin Olor / Inodoro",
    categoria: "aroma",
    tags: ["aroma", "inodoro", "sin olor", "neutro", "sin fragancia", "suave"],
    // Tres ondas de olor tachadas.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M36 72 C30 64 42 58 36 50 C30 42 42 36 36 28" stroke-width="4"/>
      <path d="M50 72 C44 64 56 58 50 50 C44 42 56 36 50 28" stroke-width="4"/>
      <path d="M64 72 C58 64 70 58 64 50 C58 42 70 36 64 28" stroke-width="4"/>
      <line x1="24" y1="76" x2="76" y2="24" stroke-width="6"/>
    </svg>`,
  },

  // --- APARIENCIA ---
  {
    id: "apariencia_cristales",
    nombre: "Cristales / Cristalino",
    categoria: "apariencia",
    tags: ["apariencia", "cristal", "cristalino", "sal", "mineral", "cuarzo", "solido"],
    // Tres prismas de cristal sobre una base.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M44 78 L44 32 L50 22 L56 32 L56 78" stroke-width="4.5"/>
      <path d="M30 78 L30 50 L35 42 L40 50 L40 78" stroke-width="4"/>
      <path d="M60 78 L60 44 L65 36 L70 44 L70 78" stroke-width="4"/>
      <line x1="22" y1="80" x2="78" y2="80" stroke-width="4.5"/>
    </svg>`,
  },
  {
    id: "apariencia_cubo_solido",
    nombre: "Cubo / Sólido en Bloque",
    categoria: "apariencia",
    tags: ["apariencia", "solido", "bloque", "cubo", "trozo", "pastilla", "barra"],
    // Cubo isométrico con la cara superior rellena.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M50 20 L76 34 L50 48 L24 34 Z" fill="currentColor" stroke-width="4"/>
      <path d="M24 34 L24 64 L50 78 L76 64 L76 34" stroke-width="4.5"/>
      <line x1="50" y1="48" x2="50" y2="78" stroke-width="4.5"/>
    </svg>`,
  },
  {
    id: "apariencia_gota_aceite",
    nombre: "Gota de Aceite / Oleoso",
    categoria: "apariencia",
    tags: ["apariencia", "aceite", "oleoso", "liquido", "gota", "brillo", "graso"],
    // Gota rellena con un brillo.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M50 18 C50 18 28 44 28 58 C28 71 38 80 50 80 C62 80 72 71 72 58 C72 44 50 18 50 18 Z" fill="currentColor" stroke-width="3"/>
      <path d="M39 58 C39 65 43 70 49 71" stroke="#ffffff" stroke-width="4"/>
    </svg>`,
  },
  {
    id: "apariencia_viscoso",
    nombre: "Viscoso / Gel Espeso",
    categoria: "apariencia",
    tags: ["apariencia", "viscoso", "gel", "espeso", "miel", "denso", "chorreado"],
    // Capa espesa que escurre en goterones.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M22 22 L78 22 L78 34 C78 40 72 40 70 46 C68 52 70 62 64 64 C58 66 58 56 56 48 C54 42 48 42 46 50 C44 60 44 76 36 76 C30 76 32 60 30 48 C29 40 22 40 22 34 Z" fill="currentColor" stroke-width="3"/>
      <circle cx="64" cy="75" r="3.5" fill="currentColor" stroke="none"/>
    </svg>`,
  },
  {
    id: "apariencia_semillas",
    nombre: "Semillas / Granos Enteros",
    categoria: "apariencia",
    tags: ["apariencia", "semillas", "granos", "enteros", "chia", "linaza", "cereal"],
    // Cinco semillas rellenas en distintas direcciones.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <ellipse cx="36" cy="36" rx="6.5" ry="10.5" transform="rotate(-30 36 36)" fill="currentColor" stroke="none"/>
      <ellipse cx="62" cy="32" rx="6.5" ry="10.5" transform="rotate(25 62 32)" fill="currentColor" stroke="none"/>
      <ellipse cx="50" cy="54" rx="6.5" ry="10.5" transform="rotate(70 50 54)" fill="currentColor" stroke="none"/>
      <ellipse cx="30" cy="64" rx="6.5" ry="10.5" transform="rotate(15 30 64)" fill="currentColor" stroke="none"/>
      <ellipse cx="66" cy="68" rx="6.5" ry="10.5" transform="rotate(-40 66 68)" fill="currentColor" stroke="none"/>
    </svg>`,
  },
  {
    id: "apariencia_perlas",
    nombre: "Perlas / Esferas",
    categoria: "apariencia",
    tags: ["apariencia", "perlas", "esferas", "bolitas", "microesferas", "capsulas", "pellets"],
    // Nueve esferas; la del centro rellena.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <g stroke-width="4">
      <circle cx="30" cy="30" r="8"/><circle cx="50" cy="30" r="8"/><circle cx="70" cy="30" r="8"/>
      <circle cx="30" cy="50" r="8"/><circle cx="70" cy="50" r="8"/>
      <circle cx="30" cy="70" r="8"/><circle cx="50" cy="70" r="8"/><circle cx="70" cy="70" r="8"/>
      </g>
      <circle cx="50" cy="50" r="10" fill="currentColor" stroke="none"/>
    </svg>`,
  },
  {
    id: "apariencia_capsulas",
    nombre: "Cápsulas",
    categoria: "apariencia",
    tags: ["apariencia", "capsulas", "capsula", "gelatina", "pastillas", "llenado", "color"],
    // Dos cápsulas de dos piezas cruzadas; una mitad de cada una rellena.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <g transform="rotate(-40 38 46)">
        <rect x="16" y="37" width="44" height="18" rx="9" stroke-width="4.5"/>
        <path d="M38 37 H51 A9 9 0 0 1 51 55 H38 Z" fill="currentColor" stroke="none"/>
      </g>
      <g transform="rotate(35 62 62)">
        <rect x="40" y="53" width="44" height="18" rx="9" stroke-width="4.5"/>
        <path d="M62 53 H75 A9 9 0 0 1 75 71 H62 Z" fill="currentColor" stroke="none"/>
      </g>
    </svg>`,
  },
  {
    id: "apariencia_crema",
    nombre: "Crema / Pasta",
    categoria: "apariencia",
    tags: ["apariencia", "crema", "pasta", "untuoso", "manteca", "balsamo", "tarro"],
    // Tarro abierto con copete de crema.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M28 50 L72 50 L72 74 C72 78 69 80 65 80 L35 80 C31 80 28 78 28 74 Z" stroke-width="4.5"/>
      <path d="M32 50 C32 40 44 42 46 34 C48 28 56 28 58 34 C60 40 68 42 68 50" fill="currentColor" stroke-width="3.5"/>
      <path d="M52 30 C54 26 52 22 48 20" stroke-width="4"/>
    </svg>`,
  },
  {
    id: "apariencia_brillo_gema",
    nombre: "Gema / Brillante",
    categoria: "apariencia",
    tags: ["apariencia", "brillo", "brillante", "gema", "diamante", "transparente", "cristalino"],
    // Gema tallada con facetas.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M34 26 L66 26 L80 42 L50 78 L20 42 Z" stroke-width="4.5"/>
      <line x1="20" y1="42" x2="80" y2="42" stroke-width="3.5"/>
      <path d="M42 26 L36 42 L50 78 L64 42 L58 26" stroke-width="3"/>
    </svg>`,
  },
  {
    id: "apariencia_tonos",
    nombre: "Tonos / Mezcla de Color",
    categoria: "apariencia",
    tags: ["apariencia", "color", "tono", "muestras", "matiz", "pigmento", "colorante"],
    // Tres círculos de color superpuestos; uno relleno.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <circle cx="38" cy="60" r="16" fill="currentColor" stroke="none"/>
      <circle cx="50" cy="39" r="16" stroke-width="4.5"/>
      <circle cx="62" cy="60" r="16" stroke-width="4.5"/>
    </svg>`,
  },
  {
    id: "apariencia_tamiz",
    nombre: "Tamiz / Granulometría",
    categoria: "apariencia",
    tags: ["apariencia", "tamiz", "malla", "granulometria", "fino", "cernido", "particula"],
    // Tamiz con malla y partículas que caen.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <line x1="20" y1="38" x2="80" y2="38" stroke-width="4.5"/>
      <path d="M24 38 C24 58 36 68 50 68 C64 68 76 58 76 38" stroke-width="4.5"/>
      <path d="M30 48 L70 48 M36 57 L64 57 M40 40 L40 64 M50 40 L50 68 M60 40 L60 64" stroke-width="2.5"/>
      <circle cx="42" cy="76" r="2.5" fill="currentColor" stroke="none"/>
      <circle cx="52" cy="80" r="2.5" fill="currentColor" stroke="none"/>
      <circle cx="59" cy="75" r="2" fill="currentColor" stroke="none"/>
    </svg>`,
  },

  // --- COMPOSICIÓN ---
  {
    id: "composicion_tubos_ensayo",
    nombre: "Tubos de Ensayo / Análisis",
    categoria: "composicion",
    tags: ["composicion", "tubos", "ensayo", "laboratorio", "analisis", "muestras", "quimica"],
    // Tres tubos con distintos niveles de líquido.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <g stroke-width="4">
      <path d="M26 22 L26 70 C26 76 38 76 38 70 L38 22"/>
      <path d="M44 22 L44 70 C44 76 56 76 56 70 L56 22"/>
      <path d="M62 22 L62 70 C62 76 74 76 74 70 L74 22"/>
      </g>
      <path d="M26 54 L38 54 L38 70 C38 76 26 76 26 70 Z" fill="currentColor" stroke="none"/>
      <path d="M44 42 L56 42 L56 70 C56 76 44 76 44 70 Z" fill="currentColor" stroke="none"/>
      <path d="M62 62 L74 62 L74 70 C74 76 62 76 62 70 Z" fill="currentColor" stroke="none"/>
      <line x1="20" y1="30" x2="80" y2="30" stroke-width="4"/>
    </svg>`,
  },
  {
    id: "composicion_porcentaje",
    nombre: "Porcentaje / Concentración",
    categoria: "composicion",
    tags: ["composicion", "porcentaje", "concentracion", "pureza", "dosis", "proporcion"],
    // Signo de porcentaje grande.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <line x1="68" y1="24" x2="32" y2="76" stroke-width="5.5"/>
      <circle cx="35" cy="32" r="9" stroke-width="5"/>
      <circle cx="65" cy="68" r="9" stroke-width="5"/>
    </svg>`,
  },
  {
    id: "composicion_torta",
    nombre: "Gráfico de Torta / Proporción",
    categoria: "composicion",
    tags: ["composicion", "proporcion", "mezcla", "grafico", "porcentaje", "partes"],
    // Círculo con una porción rellena.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <circle cx="50" cy="50" r="29" stroke-width="4.5"/>
      <path d="M50 50 L50 21 A29 29 0 0 1 75.1 64.5 Z" fill="currentColor" stroke-width="3"/>
      <line x1="50" y1="50" x2="26" y2="66" stroke-width="4"/>
    </svg>`,
  },
  {
    id: "composicion_cadena_carbono",
    nombre: "Cadena Molecular / Ácido Graso",
    categoria: "composicion",
    tags: ["composicion", "cadena", "carbono", "acido graso", "lipido", "molecula", "aceite"],
    // Cadena en zigzag con un doble enlace y un grupo terminal relleno.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M20 60 L32 44 L44 60 L56 44 L68 60" stroke-width="4.5"/>
      <line x1="39.6" y1="45.8" x2="44.4" y2="52.2" stroke-width="3.5"/>
      <line x1="68" y1="60" x2="74" y2="44" stroke-width="4.5"/>
      <circle cx="75" cy="40" r="6.5" fill="currentColor" stroke="none"/>
      <circle cx="20" cy="60" r="4" fill="currentColor" stroke="none"/>
    </svg>`,
  },
  {
    id: "composicion_gotero",
    nombre: "Gotero / Dosificación",
    categoria: "composicion",
    tags: ["composicion", "gotero", "pipeta", "dosis", "gota", "suero", "concentrado"],
    // Gotero de bulbo relleno soltando una gota.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M42 18 L58 18 L58 30 C58 34 56 36 54 36 L46 36 C44 36 42 34 42 30 Z" fill="currentColor" stroke-width="3"/>
      <line x1="38" y1="38" x2="62" y2="38" stroke-width="4.5"/>
      <path d="M46 40 L46 58 L50 64 L54 58 L54 40" stroke-width="4"/>
      <path d="M50 69 C50 69 44 75 44 78 C44 81 47 83 50 83 C53 83 56 81 56 78 C56 75 50 69 50 69 Z" fill="currentColor" stroke="none"/>
    </svg>`,
  },
  {
    id: "composicion_balanza",
    nombre: "Balanza / Pesaje",
    categoria: "composicion",
    tags: ["composicion", "balanza", "peso", "pesaje", "equilibrio", "formulacion", "dosificacion"],
    // Balanza de dos platillos.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <line x1="50" y1="24" x2="50" y2="78" stroke-width="4.5"/>
      <line x1="36" y1="78" x2="64" y2="78" stroke-width="5"/>
      <line x1="24" y1="32" x2="76" y2="32" stroke-width="4.5"/>
      <circle cx="50" cy="24" r="4" fill="currentColor" stroke="none"/>
      <path d="M28 32 L20 52 M28 32 L36 52 M72 32 L64 52 M72 32 L80 52" stroke-width="3"/>
      <path d="M18 52 C20 61 36 61 38 52 Z" fill="currentColor" stroke-width="2.5"/>
      <path d="M62 52 C64 61 80 61 82 52 Z" fill="currentColor" stroke-width="2.5"/>
    </svg>`,
  },
  {
    id: "composicion_lista_ingredientes",
    nombre: "Lista de Ingredientes / INCI",
    categoria: "composicion",
    tags: ["composicion", "ingredientes", "inci", "lista", "formula", "componentes"],
    // Tres renglones con casilla marcada.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <g stroke-width="4">
      <rect x="22" y="24" width="12" height="12" rx="2"/>
      <rect x="22" y="44" width="12" height="12" rx="2"/>
      <rect x="22" y="64" width="12" height="12" rx="2"/>
      </g>
      <path d="M24 30 L28 34 L34 24 M24 50 L28 54 L34 44" stroke-width="3.5"/>
      <path d="M42 30 L78 30 M42 50 L78 50 M42 70 L66 70" stroke-width="4.5"/>
    </svg>`,
  },
  {
    id: "composicion_mortero",
    nombre: "Mortero / Extracto Molido",
    categoria: "composicion",
    tags: ["composicion", "mortero", "molido", "extracto", "polvo", "triturado", "botica"],
    // Mortero relleno con su mano.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <line x1="56" y1="48" x2="74" y2="22" stroke-width="7"/>
      <path d="M22 50 L78 50 C78 66 66 76 50 76 C34 76 22 66 22 50 Z" fill="currentColor" stroke-width="3"/>
      <path d="M40 76 L38 82 L62 82 L60 76" stroke-width="4"/>
    </svg>`,
  },
  {
    id: "composicion_activo_natural",
    nombre: "Activo Natural / Botánico",
    categoria: "composicion",
    tags: ["composicion", "natural", "botanico", "activo", "extracto", "vegetal", "organico"],
    // Hexágono molecular con una hoja dentro.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M50 20 L76 35 L76 65 L50 80 L24 65 L24 35 Z" stroke-width="4.5"/>
      <path d="M36 64 C36 46 46 36 64 36 C64 54 54 64 36 64 Z" fill="currentColor" stroke-width="2.5"/>
      <path d="M36 64 L54 46" stroke="#ffffff" stroke-width="3"/>
    </svg>`,
  },
  {
    id: "composicion_mezcla",
    nombre: "Mezcla / Disolución",
    categoria: "composicion",
    tags: ["composicion", "mezcla", "disolucion", "solucion", "agitar", "vaso", "preparacion"],
    // Vaso de precipitado con varilla y remolino.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M30 26 L30 72 C30 77 33 80 38 80 L62 80 C67 80 70 77 70 72 L70 26" stroke-width="4.5"/>
      <line x1="24" y1="26" x2="34" y2="26" stroke-width="4.5"/>
      <line x1="60" y1="18" x2="46" y2="70" stroke-width="4"/>
      <path d="M36 58 C42 50 58 66 64 56" stroke-width="3.5"/>
      <path d="M36 68 C42 62 54 72 62 66" stroke-width="3"/>
    </svg>`,
  },

  // --- CALIDAD ---
  {
    id: "calidad_estrellas",
    nombre: "Estrellas / Excelencia",
    categoria: "calidad",
    tags: ["calidad", "estrellas", "excelencia", "premium", "valoracion", "calificacion"],
    // Tres estrellas; la central más grande.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M28.0 43.0 L30.7 50.3 L38.5 50.6 L32.4 55.4 L34.5 62.9 L28.0 58.6 L21.5 62.9 L23.6 55.4 L17.5 50.6 L25.3 50.3 Z" fill="currentColor" stroke-width="2.5"/>
      <path d="M50.0 27.0 L53.7 36.9 L64.3 37.4 L56.0 43.9 L58.8 54.1 L50.0 48.3 L41.2 54.1 L44.0 43.9 L35.7 37.4 L46.3 36.9 Z" fill="currentColor" stroke-width="2.5"/>
      <path d="M72.0 43.0 L74.7 50.3 L82.5 50.6 L76.4 55.4 L78.5 62.9 L72.0 58.6 L65.5 62.9 L67.6 55.4 L61.5 50.6 L69.3 50.3 Z" fill="currentColor" stroke-width="2.5"/>
      <path d="M30 72 C42 78 58 78 70 72" stroke-width="4"/>
    </svg>`,
  },
  {
    id: "calidad_pulgar",
    nombre: "Pulgar Arriba / Aprobado",
    categoria: "calidad",
    tags: ["calidad", "aprobado", "pulgar", "ok", "bueno", "recomendado", "satisfaccion"],
    // Mano con el pulgar arriba y puño de manga relleno.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <rect x="22" y="46" width="12" height="34" rx="2" fill="currentColor" stroke="none"/>
      <path d="M38 50 L48 30 C50 24 58 24 58 31 L56 44 L70 44 C76 44 79 49 77 54 L72 74 C71 78 68 80 64 80 L38 80 Z" stroke-width="4.5"/>
    </svg>`,
  },
  {
    id: "calidad_laurel",
    nombre: "Laurel / Distinción",
    categoria: "calidad",
    tags: ["calidad", "laurel", "distincion", "premio", "reconocimiento", "grado", "premium"],
    // Corona de laurel con una estrella al centro.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M38.6 74.5 A27 27 0 0 1 40.8 24.6 M61.4 74.5 A27 27 0 0 0 59.2 24.6" stroke-width="3"/><ellipse cx="38.6" cy="25.5" rx="3.8" ry="8" transform="rotate(35.0 38.6 25.5)" fill="currentColor" stroke="none"/>
      <ellipse cx="29.6" cy="32.3" rx="3.8" ry="8" transform="rotate(11.0 29.6 32.3)" fill="currentColor" stroke="none"/>
      <ellipse cx="24.2" cy="42.1" rx="3.8" ry="8" transform="rotate(-13.0 24.2 42.1)" fill="currentColor" stroke="none"/>
      <ellipse cx="23.2" cy="53.3" rx="3.8" ry="8" transform="rotate(-37.0 23.2 53.3)" fill="currentColor" stroke="none"/>
      <ellipse cx="26.9" cy="63.9" rx="3.8" ry="8" transform="rotate(-61.0 26.9 63.9)" fill="currentColor" stroke="none"/>
      <ellipse cx="34.5" cy="72.1" rx="3.8" ry="8" transform="rotate(-85.0 34.5 72.1)" fill="currentColor" stroke="none"/>
      <ellipse cx="61.4" cy="25.5" rx="3.8" ry="8" transform="rotate(-35.0 61.4 25.5)" fill="currentColor" stroke="none"/>
      <ellipse cx="70.4" cy="32.3" rx="3.8" ry="8" transform="rotate(-11.0 70.4 32.3)" fill="currentColor" stroke="none"/>
      <ellipse cx="75.8" cy="42.1" rx="3.8" ry="8" transform="rotate(13.0 75.8 42.1)" fill="currentColor" stroke="none"/>
      <ellipse cx="76.8" cy="53.3" rx="3.8" ry="8" transform="rotate(37.0 76.8 53.3)" fill="currentColor" stroke="none"/>
      <ellipse cx="73.1" cy="63.9" rx="3.8" ry="8" transform="rotate(61.0 73.1 63.9)" fill="currentColor" stroke="none"/>
      <ellipse cx="65.5" cy="72.1" rx="3.8" ry="8" transform="rotate(85.0 65.5 72.1)" fill="currentColor" stroke="none"/>
      <path d="M50 38 L53.2 46.6 L62.4 47 L55.2 52.7 L57.6 61.5 L50 56.5 L42.4 61.5 L44.8 52.7 L37.6 47 L46.8 46.6 Z" fill="currentColor" stroke-width="2"/>
    </svg>`,
  },
  {
    id: "calidad_corona",
    nombre: "Corona / Premium",
    categoria: "calidad",
    tags: ["calidad", "corona", "premium", "superior", "exclusivo", "grado", "lujo"],
    // Corona de tres puntas con base.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M24 38 L36 54 L50 30 L64 54 L76 38 L72 68 L28 68 Z" stroke-width="4.5"/>
      <line x1="28" y1="78" x2="72" y2="78" stroke-width="5"/>
      <circle cx="24" cy="34" r="4" fill="currentColor" stroke="none"/>
      <circle cx="50" cy="25" r="4" fill="currentColor" stroke="none"/>
      <circle cx="76" cy="34" r="4" fill="currentColor" stroke="none"/>
    </svg>`,
  },
  {
    id: "calidad_trofeo",
    nombre: "Trofeo / Primera Calidad",
    categoria: "calidad",
    tags: ["calidad", "trofeo", "copa", "primera", "ganador", "mejor", "premio"],
    // Copa con asas y base.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M34 22 L66 22 L66 40 C66 52 58 58 50 58 C42 58 34 52 34 40 Z" fill="currentColor" stroke-width="3.5"/>
      <path d="M34 28 L24 28 C24 40 28 46 36 47 M66 28 L76 28 C76 40 72 46 64 47" stroke-width="4"/>
      <line x1="50" y1="58" x2="50" y2="70" stroke-width="5"/>
      <path d="M36 78 L40 70 L60 70 L64 78 Z" stroke-width="4"/>
    </svg>`,
  },
  {
    id: "calidad_coa",
    nombre: "Certificado de Análisis / COA",
    categoria: "calidad",
    tags: ["calidad", "coa", "analisis", "certificado", "laboratorio", "control", "lote"],
    // Portapapeles con chulo grande.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <rect x="28" y="24" width="44" height="56" rx="4" stroke-width="4.5"/>
      <rect x="40" y="18" width="20" height="11" rx="3" fill="currentColor" stroke="none"/>
      <path d="M38 54 L47 63 L63 42" stroke-width="5.5"/>
    </svg>`,
  },
  {
    id: "calidad_microscopio",
    nombre: "Microscopio / Control Analítico",
    categoria: "calidad",
    tags: ["calidad", "microscopio", "analisis", "laboratorio", "control", "investigacion"],
    // Microscopio de perfil sobre su base.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <line x1="40" y1="22" x2="54" y2="46" stroke-width="9"/>
      <line x1="55" y1="48" x2="58" y2="54" stroke-width="5"/>
      <line x1="42" y1="62" x2="66" y2="62" stroke-width="4.5"/>
      <path d="M58 34 C74 40 74 64 62 72 L62 80" stroke-width="4.5"/>
      <line x1="30" y1="80" x2="72" y2="80" stroke-width="5"/>
    </svg>`,
  },
  {
    id: "calidad_lote_trazabilidad",
    nombre: "Código de Lote / Trazabilidad",
    categoria: "calidad",
    tags: ["calidad", "lote", "trazabilidad", "codigo", "barras", "registro", "control"],
    // Código de barras dentro de un marco.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <rect x="20" y="28" width="60" height="44" rx="4" stroke-width="4.5"/>
      <path d="M30 38 V62 M36 38 V62 M46 38 V62 M54 38 V62 M60 38 V62 M70 38 V62" stroke-width="3"/>
      <path d="M40 38 V62 M65 38 V62" stroke-width="5"/>
    </svg>`,
  },
  {
    id: "calidad_aprobado",
    nombre: "Aprobado / Conforme",
    categoria: "calidad",
    tags: ["calidad", "aprobado", "conforme", "cumple", "ok", "verificado", "valido"],
    // Círculo relleno con chulo en blanco.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <circle cx="50" cy="50" r="30" fill="currentColor" stroke="none"/>
      <path d="M37 51 L46 60 L64 40" stroke="#ffffff" stroke-width="6"/>
    </svg>`,
  },
  {
    id: "calidad_proceso_bpm",
    nombre: "Proceso Controlado / BPM",
    categoria: "calidad",
    tags: ["calidad", "bpm", "proceso", "engranaje", "iso", "control", "buenas practicas"],
    // Engranaje con chulo al centro.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M74.5 45.2 L81.8 46.7 L81.8 53.3 L74.5 54.8 L70.7 64.0 L74.9 70.1 L70.1 74.9 L64.0 70.7 L54.8 74.5 L53.3 81.8 L46.7 81.8 L45.2 74.5 L36.0 70.7 L29.9 74.9 L25.1 70.1 L29.3 64.0 L25.5 54.8 L18.2 53.3 L18.2 46.7 L25.5 45.2 L29.3 36.0 L25.1 29.9 L29.9 25.1 L36.0 29.3 L45.2 25.5 L46.7 18.2 L53.3 18.2 L54.8 25.5 L64.0 29.3 L70.1 25.1 L74.9 29.9 L70.7 36.0 Z" stroke-width="4"/>
      <path d="M40 50 L47 57 L61 42" stroke-width="5"/>
    </svg>`,
  },
  {
    id: "calidad_sello_natural",
    nombre: "Sello Natural / Garantía",
    categoria: "calidad",
    tags: ["calidad", "sello", "natural", "garantia", "organico", "certificado", "roseta"],
    // Sello con borde ondulado y una hoja rellena.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M82.5 50.0 L78.8 53.8 L74.6 56.6 L76.8 61.1 L78.1 66.2 L73.0 67.7 L68.0 68.0 L67.7 73.0 L66.2 78.1 L61.1 76.8 L56.6 74.6 L53.8 78.8 L50.0 82.5 L46.2 78.8 L43.4 74.6 L38.9 76.8 L33.8 78.1 L32.3 73.0 L32.0 68.0 L27.0 67.7 L21.9 66.2 L23.2 61.1 L25.4 56.6 L21.2 53.8 L17.5 50.0 L21.2 46.2 L25.4 43.4 L23.2 38.9 L21.9 33.8 L27.0 32.3 L32.0 32.0 L32.3 27.0 L33.7 21.9 L38.9 23.2 L43.4 25.4 L46.2 21.2 L50.0 17.5 L53.8 21.2 L56.6 25.4 L61.1 23.2 L66.2 21.9 L67.7 27.0 L68.0 32.0 L73.0 32.3 L78.1 33.7 L76.8 38.9 L74.6 43.4 L78.8 46.2 Z" stroke-width="4"/>
      <path d="M38 62 C38 46 46 38 62 38 C62 54 54 62 38 62 Z" fill="currentColor" stroke-width="2.5"/>
      <path d="M38 62 L54 46" stroke="#ffffff" stroke-width="3"/>
    </svg>`,
  },

  // --- CONSERVACIÓN ---
  {
    id: "conservacion_proteger_luz",
    nombre: "Proteger de la Luz",
    categoria: "conservacion",
    tags: ["conservacion", "luz", "sol", "proteger", "fotosensible", "oscuro", "ambar"],
    // Sol tachado.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <circle cx="50" cy="50" r="12" stroke-width="4.5"/>
      <path d="M50 20 V28 M50 72 V80 M20 50 H28 M72 50 H80 M29 29 L34 34 M66 66 L71 71 M71 29 L66 34 M34 66 L29 71" stroke-width="4.5"/>
      <line x1="24" y1="76" x2="76" y2="24" stroke-width="6"/>
    </svg>`,
  },
  {
    id: "conservacion_refrigerar",
    nombre: "Refrigerar / Frío",
    categoria: "conservacion",
    tags: ["conservacion", "refrigerar", "frio", "nevera", "congelar", "copo", "2-8"],
    // Copo de nieve de seis brazos.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M50 20 V80 M24 35 L76 65 M24 65 L76 35" stroke-width="4.5"/>
      <path d="M42 24 L50 32 L58 24 M42 76 L50 68 L58 76" stroke-width="3.5"/>
      <path d="M22 44 L32.9 41 L30 30 M78 56 L67.1 59 L70 70" stroke-width="3.5"/>
      <path d="M22 56 L32.9 59 L30 70 M78 44 L67.1 41 L70 30" stroke-width="3.5"/>
    </svg>`,
  },
  {
    id: "conservacion_lugar_oscuro",
    nombre: "Lugar Oscuro",
    categoria: "conservacion",
    tags: ["conservacion", "oscuro", "sombra", "noche", "luna", "sin luz"],
    // Luna creciente rellena con dos estrellas.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M58 20 C42 22 28 36 28 54 C28 70 42 80 58 80 C66 80 72 78 76 74 C60 72 48 60 48 44 C48 34 52 26 58 20 Z" fill="currentColor" stroke-width="3"/>
      <path d="M68 34 L68 42 M64 38 L72 38" stroke-width="3"/>
      <path d="M74 52 L74 58 M71 55 L77 55" stroke-width="3"/>
    </svg>`,
  },
  {
    id: "conservacion_calendario",
    nombre: "Fecha de Vencimiento",
    categoria: "conservacion",
    tags: ["conservacion", "vencimiento", "fecha", "calendario", "caducidad", "vida util"],
    // Calendario con un día marcado.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <rect x="22" y="26" width="56" height="52" rx="5" stroke-width="4.5"/>
      <path d="M22 31 C22 28 24 26 27 26 L73 26 C76 26 78 28 78 31 L78 40 L22 40 Z" fill="currentColor" stroke="none"/>
      <path d="M36 20 V30 M64 20 V30" stroke-width="5"/>
      <g fill="currentColor" stroke="none">
      <rect x="31" y="48" width="8" height="7" rx="1"/><rect x="46" y="48" width="8" height="7" rx="1"/>
      <rect x="31" y="61" width="8" height="7" rx="1"/><rect x="46" y="61" width="8" height="7" rx="1"/>
      </g>
      <path d="M59 58 L63 62 L71 51" stroke-width="4"/>
    </svg>`,
  },
  {
    id: "conservacion_lado_arriba",
    nombre: "Este Lado Arriba",
    categoria: "conservacion",
    tags: ["conservacion", "arriba", "posicion", "vertical", "transporte", "caja", "flechas"],
    // Pictograma estándar: dos flechas hacia arriba sobre una base.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <line x1="24" y1="80" x2="76" y2="80" stroke-width="5"/>
      <path d="M38 72 V28 M28 40 L38 26 L48 40" stroke-width="5"/>
      <path d="M62 72 V28 M52 40 L62 26 L72 40" stroke-width="5"/>
    </svg>`,
  },
  {
    id: "conservacion_fragil",
    nombre: "Frágil",
    categoria: "conservacion",
    tags: ["conservacion", "fragil", "vidrio", "copa", "cuidado", "romper", "transporte"],
    // Copa con grieta (pictograma de frágil).
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M34 20 L66 20 L64 36 C62 48 56 54 50 54 C44 54 38 48 36 36 Z" stroke-width="4.5"/>
      <path d="M46 20 L51 29 L46 36" stroke-width="3.5"/>
      <line x1="50" y1="54" x2="50" y2="76" stroke-width="4.5"/>
      <line x1="38" y1="78" x2="62" y2="78" stroke-width="5"/>
    </svg>`,
  },
  {
    id: "conservacion_bien_cerrado",
    nombre: "Mantener Bien Cerrado",
    categoria: "conservacion",
    tags: ["conservacion", "cerrado", "tapa", "hermetico", "cerrar", "envase", "frasco"],
    // Frasco con tapa rellena y flecha de giro.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <rect x="28" y="34" width="44" height="10" rx="3" fill="currentColor" stroke="none"/>
      <path d="M31 44 L31 74 C31 78 34 81 38 81 L62 81 C66 81 69 78 69 74 L69 44" stroke-width="4.5"/>
      <path d="M32 26 C40 18 60 18 68 26" stroke-width="4"/>
      <path d="M68 26 L60 27 M68 26 L67 18" stroke-width="4"/>
    </svg>`,
  },
  {
    id: "conservacion_ventilado",
    nombre: "Lugar Ventilado",
    categoria: "conservacion",
    tags: ["conservacion", "ventilado", "aire", "viento", "ventilacion", "fresco"],
    // Tres corrientes de aire con remolino.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M20 36 L58 36 C64 36 68 32 68 27 C68 22 64 19 60 19 C56 19 53 22 53 26" stroke-width="4.5"/>
      <path d="M20 52 L70 52 C76 52 80 56 80 62 C80 67 76 70 71 70 C67 70 63 67 63 63" stroke-width="4.5"/>
      <path d="M20 68 L46 68" stroke-width="4.5"/>
    </svg>`,
  },
  {
    id: "conservacion_lejos_calor",
    nombre: "Lejos del Calor / Fuego",
    categoria: "conservacion",
    tags: ["conservacion", "calor", "fuego", "llama", "inflamable", "lejos", "temperatura"],
    // Llama tachada.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M50 18 C54 30 68 38 68 56 C68 70 60 80 50 80 C40 80 32 70 32 56 C32 46 38 40 42 32 C44 40 46 42 50 44 C50 34 48 26 50 18 Z" stroke-width="4.5"/>
      <line x1="24" y1="76" x2="76" y2="24" stroke-width="6"/>
    </svg>`,
  },
  {
    id: "conservacion_temperatura_ambiente",
    nombre: "Temperatura Ambiente",
    categoria: "conservacion",
    tags: ["conservacion", "ambiente", "temperatura", "15-25", "casa", "interior", "templado"],
    // Casa con termómetro dentro.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M20 48 L50 22 L80 48" stroke-width="4.5"/>
      <path d="M28 42 L28 80 L72 80 L72 42" stroke-width="4.5"/>
      <path d="M46 62 L46 42 A4 4 0 0 1 54 42 L54 62 A7 7 0 1 1 46 62 Z" stroke-width="3.5"/>
      <circle cx="50" cy="67" r="3" fill="currentColor" stroke="none"/>
    </svg>`,
  },

  // --- SEGURIDAD ---
  {
    id: "seguridad_advertencia",
    nombre: "Advertencia / Precaución",
    categoria: "seguridad",
    tags: ["seguridad", "advertencia", "precaucion", "cuidado", "peligro", "triangulo"],
    // Triángulo con signo de exclamación.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M50 20 L80 74 L20 74 Z" stroke-width="5"/>
      <line x1="50" y1="40" x2="50" y2="58" stroke-width="6"/>
      <line x1="50" y1="66" x2="50" y2="67" stroke-width="7"/>
    </svg>`,
  },
  {
    id: "seguridad_guantes",
    nombre: "Usar Guantes",
    categoria: "seguridad",
    tags: ["seguridad", "guantes", "manos", "proteccion", "epp", "manipulacion"],
    // Guante con puño marcado.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M36 80 L36 58 L28 46 C26 42 30 38 34 41 L38 46 L38 26 C38 22 44 22 44 26 L44 42 L44 22 C44 18 50 18 50 22 L50 42 L50 24 C50 20 56 20 56 24 L56 44 L56 30 C56 26 62 26 62 30 L62 60 C62 68 60 72 60 80" stroke-width="4"/>
      <path d="M34 80 L62 80 L62 72 L34 72 Z" fill="currentColor" stroke-width="2.5"/>
    </svg>`,
  },
  {
    id: "seguridad_gafas",
    nombre: "Usar Gafas de Protección",
    categoria: "seguridad",
    tags: ["seguridad", "gafas", "ojos", "proteccion", "epp", "salpicaduras", "lentes"],
    // Gafas de seguridad con correa.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M22 42 C22 38 24 36 28 36 L72 36 C76 36 78 38 78 42 L78 56 C78 61 75 64 70 64 L60 64 C56 64 54 56 50 56 C46 56 44 64 40 64 L30 64 C25 64 22 61 22 56 Z" stroke-width="4.5"/>
      <path d="M22 46 L16 46 M78 46 L84 46" stroke-width="4.5"/>
      <path d="M30 44 L38 44 M62 44 L70 44" stroke-width="3"/>
    </svg>`,
  },
  {
    id: "seguridad_mascarilla",
    nombre: "Usar Mascarilla",
    categoria: "seguridad",
    tags: ["seguridad", "mascarilla", "tapabocas", "respiracion", "polvo", "epp", "inhalar"],
    // Mascarilla con pliegues y elásticos.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M28 38 C40 32 60 32 72 38 L72 58 C60 68 40 68 28 58 Z" stroke-width="4.5"/>
      <path d="M28 42 C16 42 16 56 28 56 M72 42 C84 42 84 56 72 56" stroke-width="3.5"/>
      <path d="M34 46 L66 46 M34 54 L66 54" stroke-width="3"/>
    </svg>`,
  },
  {
    id: "seguridad_ninos",
    nombre: "Fuera del Alcance de los Niños",
    categoria: "seguridad",
    tags: ["seguridad", "niños", "alcance", "infantil", "menores", "proteger"],
    // Figura de niño tachada.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <circle cx="50" cy="28" r="8" fill="currentColor" stroke="none"/>
      <path d="M50 38 L50 60 M36 48 L50 42 L64 48 M50 60 L42 78 M50 60 L58 78" stroke-width="4.5"/>
      <line x1="24" y1="76" x2="76" y2="24" stroke-width="6"/>
    </svg>`,
  },
  {
    id: "seguridad_no_ingerir",
    nombre: "No Ingerir",
    categoria: "seguridad",
    tags: ["seguridad", "no ingerir", "no comer", "alimento", "uso externo", "boca"],
    // Tenedor y cuchillo tachados.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M36 22 L36 38 C36 44 46 44 46 38 L46 22 M41 22 L41 78 M41 42 L41 42" stroke-width="4"/>
      <path d="M62 22 C55 30 55 46 62 50 L62 78" stroke-width="4"/>
      <line x1="24" y1="76" x2="76" y2="24" stroke-width="6"/>
    </svg>`,
  },
  {
    id: "seguridad_primeros_auxilios",
    nombre: "Primeros Auxilios",
    categoria: "seguridad",
    tags: ["seguridad", "primeros auxilios", "cruz", "emergencia", "salud", "botiquin"],
    // Cruz rellena.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M41 22 L59 22 L59 41 L78 41 L78 59 L59 59 L59 78 L41 78 L41 59 L22 59 L22 41 L41 41 Z" fill="currentColor" stroke-width="3"/>
    </svg>`,
  },
  {
    id: "seguridad_lavar_ojos",
    nombre: "Contacto con los Ojos / Lavar",
    categoria: "seguridad",
    tags: ["seguridad", "ojos", "lavar", "enjuagar", "agua", "contacto", "irritacion"],
    // Ojo con una gota de agua encima.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M50 18 C50 18 43 27 43 32 C43 36 46 39 50 39 C54 39 57 36 57 32 C57 27 50 18 50 18 Z" fill="currentColor" stroke="none"/>
      <path d="M20 62 C31 46 69 46 80 62 C69 78 31 78 20 62 Z" stroke-width="4.5"/>
      <circle cx="50" cy="62" r="7" fill="currentColor" stroke="none"/>
    </svg>`,
  },
  {
    id: "seguridad_casco",
    nombre: "Uso Industrial / Casco",
    categoria: "seguridad",
    tags: ["seguridad", "casco", "industrial", "profesional", "epp", "obra"],
    // Casco de seguridad con visera.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M24 64 C24 42 34 28 50 28 C66 28 76 42 76 64" stroke-width="4.5"/>
      <path d="M18 64 L82 64 L82 70 L18 70 Z" fill="currentColor" stroke-width="3"/>
      <path d="M44 29 L44 46 M56 29 L56 46" stroke-width="4"/>
    </svg>`,
  },
  {
    id: "seguridad_uso_externo",
    nombre: "Solo Uso Externo / Piel",
    categoria: "seguridad",
    tags: ["seguridad", "uso externo", "piel", "topico", "mano", "aplicar", "cosmetico"],
    // Palma de la mano con una gota.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M32 80 L32 50 L26 40 C24 36 28 32 32 35 L36 42 L36 24 C36 20 42 20 42 24 L42 40 L42 20 C42 16 48 16 48 20 L48 40 L48 22 C48 18 54 18 54 22 L54 42 L54 30 C54 26 60 26 60 30 L60 56 C60 66 58 72 58 80" stroke-width="4"/>
      <path d="M70 46 C70 46 64 54 64 58 C64 62 67 64 70 64 C73 64 76 62 76 58 C76 54 70 46 70 46 Z" fill="currentColor" stroke="none"/>
    </svg>`,
  },
  {
    id: "seguridad_ventilacion",
    nombre: "Usar en Área Ventilada",
    categoria: "seguridad",
    tags: ["seguridad", "ventilacion", "vapores", "inhalar", "aire", "ventilador"],
    // Ventilador de tres aspas.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <circle cx="50" cy="50" r="30" stroke-width="4.5"/>
      <path d="M50 50 C44 42 44 30 52 26 C58 30 58 42 50 50 Z" fill="currentColor" stroke-width="2.5"/>
      <path d="M50 50 C44 42 44 30 52 26 C58 30 58 42 50 50 Z" fill="currentColor" stroke-width="2.5" transform="rotate(120 50 50)"/>
      <path d="M50 50 C44 42 44 30 52 26 C58 30 58 42 50 50 Z" fill="currentColor" stroke-width="2.5" transform="rotate(240 50 50)"/>
      <circle cx="50" cy="50" r="4" fill="#ffffff" stroke="none"/>
    </svg>`,
  },
];
