/**
 * Iconos vectoriales para los 6 atributos de la ficha técnica de materias
 * primas (Origen, Aroma, Apariencia, Composición, Calidad, Conservación).
 *
 * Criterios de dibujo (rediseño 2026-09): se priorizó que cada ícono se
 * ENTIENDA de un vistazo e impreso a ~1 cm:
 *  - Trazo grueso y uniforme (4–5 en el lienzo de 100): a 2–3 el dibujo se
 *    perdía en la etiqueta impresa.
 *  - Una sola idea por ícono, sin detalles decorativos pequeños (puntos,
 *    brillos, sombras) que a tamaño etiqueta se vuelven ruido.
 *  - Siluetas conocidas (pin de mapa, escudo con chulo, gota tachada,
 *    anillo de benceno, reloj de arena) en vez de composiciones abstractas.
 *  - Relleno sólido en la parte que da identidad (bandera, bolas de la
 *    molécula, cuerpo del candado, pupila) para ganar contraste.
 *
 * Todos usan viewBox 0 0 100 100, `currentColor` y un círculo exterior
 * r=44 que la galería puede quitar (ver `quitarCirculoExterior`). El
 * contenido se dibuja dentro de 18..82 para que, al quitar el círculo y
 * acercar ×1.3, nada quede recortado.
 */

export interface IconoQuimicoCircular {
  id: string;
  nombre: string;
  categoria: "origen" | "aroma" | "apariencia" | "composicion" | "calidad" | "conservacion";
  tags: string[];
  /** SVG markup con viewBox 0 0 100 100 y círculos/líneas limpios */
  svg: string;
}

/** Sin el círculo exterior (r=44), el contenido queda tal como se dibujó
 *  para caber DENTRO de ese círculo — con margen hacia las cuatro esquinas
 *  del lienzo cuadrado 100×100 que antes ocupaba el propio círculo. Sin él,
 *  ese margen se ve como espacio en blanco de sobra. Este factor acerca
 *  (zoom) el resto del dibujo hacia el centro para aprovechar mejor el
 *  cuadro; 1.3 es conservador — deja aire suficiente para los íconos con
 *  detalles más hacia las esquinas (ej. frasco atomizador). */
const ESCALA_SIN_CIRCULO = 1.3;

/** Quita el círculo exterior (r=44) y acerca el resto del dibujo hacia el
 *  centro (ver `ESCALA_SIN_CIRCULO`) para que no quede con espacio en
 *  blanco de sobra en las esquinas del lienzo cuadrado. Compartida por
 *  `iconoQuimicoASvgDataUrl` (ícono ya insertado) y la vista previa de la
 *  galería, para que se vean igual de acercados en los dos lados. */
export function quitarCirculoExterior(svg: string): string {
  const sinCirculo = svg.replace(/<circle[^>]*r="44"[^>]*\/>/g, "");
  return sinCirculo.replace(
    /^(<svg[^>]*>)([\s\S]*)(<\/svg>)$/,
    (_m, apertura: string, contenido: string, cierre: string) =>
      `${apertura}<g transform="translate(50 50) scale(${ESCALA_SIN_CIRCULO}) translate(-50 -50)">${contenido}</g>${cierre}`,
  );
}

export function iconoQuimicoASvgDataUrl(
  svg: string,
  colorTinta = "#1a1a1a",
  conCirculoExterior = true,
): string {
  let processed = svg.replace(/currentColor/g, colorTinta);
  if (!conCirculoExterior) {
    processed = quitarCirculoExterior(processed);
  }
  try {
    return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(processed)));
  } catch {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(processed);
  }
}

export const CATEGORIAS_ICONOS_QUIMICA = [
  { id: "todos", label: "✨ Todos" },
  { id: "origen", label: "🌍 País de Origen" },
  { id: "aroma", label: "🌸 Aroma" },
  { id: "apariencia", label: "👁️ Apariencia" },
  { id: "composicion", label: "⚛️ Composición" },
  { id: "calidad", label: "🏅 Calidad" },
  { id: "conservacion", label: "📦 Conservación" },
] as const;

/** Apertura común: trazo 4, puntas redondas, sin relleno por defecto. */
const SVG_ABRE =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">`;
const CIRCULO_EXT = `<circle cx="50" cy="50" r="44" stroke-width="3.2"/>`;

export const ICONOS_QUIMICA_CIRCULARES: IconoQuimicoCircular[] = [
  // --- PAÍS DE ORIGEN / ORIGEN ---
  {
    id: "origen_globo_meridianos",
    nombre: "Globo Terráqueo & Meridianos",
    categoria: "origen",
    tags: ["origen", "pais", "globo", "mundo", "geografia", "procedencia", "internacional"],
    // Globo clásico: círculo, un meridiano central y dos paralelos curvos.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <circle cx="50" cy="50" r="27" stroke-width="4.5"/>
      <ellipse cx="50" cy="50" rx="11" ry="27" stroke-width="3.5"/>
      <line x1="23" y1="50" x2="77" y2="50" stroke-width="3.5"/>
      <path d="M27.5 36 Q50 42 72.5 36" stroke-width="3.5"/>
      <path d="M27.5 64 Q50 58 72.5 64" stroke-width="3.5"/>
    </svg>`,
  },
  {
    id: "origen_pin_ubicacion",
    nombre: "Pin de Ubicación / Punto de Origen",
    categoria: "origen",
    tags: ["origen", "pin", "ubicacion", "mapa", "punto", "procedencia", "lugar"],
    // Pin de mapa grande con punto central relleno.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M50 18 C63.5 18 74 28.5 74 42 C74 59 50 82 50 82 C50 82 26 59 26 42 C26 28.5 36.5 18 50 18 Z" stroke-width="4.5"/>
      <circle cx="50" cy="42" r="8" fill="currentColor" stroke="none"/>
    </svg>`,
  },
  {
    id: "origen_bandera",
    nombre: "Bandera / País de Procedencia",
    categoria: "origen",
    tags: ["origen", "bandera", "pais", "procedencia", "nacion", "importado"],
    // Bandera ondeando rellena sobre un mástil grueso.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <line x1="30" y1="18" x2="30" y2="82" stroke-width="5"/>
      <line x1="22" y1="82" x2="38" y2="82" stroke-width="4"/>
      <path d="M30 22 C38 17 46 27 54 22 C60 18 66 19 72 22 L72 50 C66 47 60 46 54 50 C46 55 38 45 30 50 Z" fill="currentColor" stroke-width="3"/>
    </svg>`,
  },

  // --- AROMA ---
  {
    id: "aroma_ondas_gota",
    nombre: "Ondas de Aroma / Gota",
    categoria: "aroma",
    tags: ["aroma", "olor", "esencia", "gota", "fragancia", "ondas", "perfume"],
    // Gota de esencia con tres ondas de vapor que suben.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M50 40 C50 40 34 57 34 69 C34 78 41 84 50 84 C59 84 66 78 66 69 C66 57 50 40 50 40 Z" stroke-width="4.5"/>
      <path d="M36 30 C32 25 40 20 36 14" stroke-width="3.5"/>
      <path d="M50 30 C46 25 54 20 50 14" stroke-width="3.5"/>
      <path d="M64 30 C60 25 68 20 64 14" stroke-width="3.5"/>
    </svg>`,
  },
  {
    id: "aroma_frasco_spray",
    nombre: "Frasco Atomizador / Fragancia",
    categoria: "aroma",
    tags: ["aroma", "olor", "frasco", "perfume", "atomizador", "spray", "fragancia"],
    // Frasco de perfume con cabezal y chorro de spray hacia la derecha.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <rect x="32" y="42" width="34" height="40" rx="6" stroke-width="4.5"/>
      <line x1="36" y1="64" x2="62" y2="64" stroke-width="3.5"/>
      <rect x="43" y="32" width="12" height="10" stroke-width="4"/>
      <rect x="38" y="22" width="22" height="10" rx="3" stroke-width="4"/>
      <line x1="60" y1="27" x2="68" y2="27" stroke-width="4"/>
      <line x1="74" y1="27" x2="82" y2="27" stroke-width="3.5"/>
      <line x1="73" y1="21" x2="80" y2="16" stroke-width="3.5"/>
      <line x1="73" y1="33" x2="80" y2="38" stroke-width="3.5"/>
    </svg>`,
  },
  {
    id: "aroma_flor_ondas",
    nombre: "Flor & Ondas de Fragancia",
    categoria: "aroma",
    tags: ["aroma", "olor", "flor", "esencia", "botanico", "fragancia", "floral"],
    // Flor de cinco pétalos con centro relleno.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <g stroke-width="3.8">
        <ellipse cx="50" cy="34" rx="8.5" ry="15" transform="rotate(0 50 50)"/>
        <ellipse cx="50" cy="34" rx="8.5" ry="15" transform="rotate(72 50 50)"/>
        <ellipse cx="50" cy="34" rx="8.5" ry="15" transform="rotate(144 50 50)"/>
        <ellipse cx="50" cy="34" rx="8.5" ry="15" transform="rotate(216 50 50)"/>
        <ellipse cx="50" cy="34" rx="8.5" ry="15" transform="rotate(288 50 50)"/>
      </g>
      <circle cx="50" cy="50" r="7.5" fill="currentColor" stroke="none"/>
    </svg>`,
  },
  {
    id: "aroma_nariz_percepcion",
    nombre: "Nariz / Percepción Olfativa",
    categoria: "aroma",
    tags: ["aroma", "olor", "nariz", "percepcion", "olfativo", "nota"],
    // Perfil de rostro (frente, nariz, labios, mentón) con ondas de olor
    // que llegan a la nariz — una nariz sola no se reconocía.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M40 18 C54 18 62 26 60 36 C59 40 58 42 62 46 L65 49 L60 51 C59 54 61 56 59 58 C59 61 57 62 55 63 C56 66 55 68 51 68 C48 68 45 70 44 75 L44 82" stroke-width="4.5"/>
      <path d="M30 40 C26 34 32 28 28 22" stroke-width="3.5"/>
      <path d="M22 54 C18 48 24 42 20 36" stroke-width="3.5"/>
      <path d="M30 68 C26 62 32 56 28 50" stroke-width="3.5"/>
    </svg>`,
  },
  {
    id: "aroma_nube_notas",
    nombre: "Nube de Aroma / Notas al Aire",
    categoria: "aroma",
    tags: ["aroma", "olor", "nube", "notas", "difusion", "ambiente", "fragancia"],
    // Nube grande con tres ondas debajo.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M32 60 C24 60 19 54 19 47 C19 40 25 35 32 36 C34 27 42 21 51 21 C60 21 67 27 69 35 C75 36 80 41 80 47 C80 54 74 60 67 60 Z" stroke-width="4.5"/>
      <path d="M36 70 C34 74 38 78 36 82" stroke-width="3.5"/>
      <path d="M50 70 C48 74 52 78 50 82" stroke-width="3.5"/>
      <path d="M64 70 C62 74 66 78 64 82" stroke-width="3.5"/>
    </svg>`,
  },

  // --- COMPOSICIÓN ---
  {
    id: "composicion_molecula_enlazada",
    nombre: "Molécula Enlazada / Ball-and-Stick",
    categoria: "composicion",
    tags: ["composicion", "molecula", "atomo", "quimica", "enlace", "estructura", "formula"],
    // Átomo central relleno con tres átomos enlazados (bolas rellenas).
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <line x1="50" y1="50" x2="28" y2="32" stroke-width="4.5"/>
      <line x1="50" y1="50" x2="72" y2="32" stroke-width="4.5"/>
      <line x1="50" y1="50" x2="50" y2="78" stroke-width="4.5"/>
      <circle cx="50" cy="50" r="10.5" fill="currentColor" stroke="none"/>
      <circle cx="28" cy="32" r="7.5" fill="currentColor" stroke="none"/>
      <circle cx="72" cy="32" r="7.5" fill="currentColor" stroke="none"/>
      <circle cx="50" cy="78" r="7.5" fill="currentColor" stroke="none"/>
    </svg>`,
  },
  {
    id: "composicion_atomo_orbitas",
    nombre: "Átomo / Estructura Atómica",
    categoria: "composicion",
    tags: ["composicion", "atomo", "molecula", "quimica", "orbita", "electron", "estructura"],
    // Núcleo relleno y tres órbitas.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <circle cx="50" cy="50" r="6.5" fill="currentColor" stroke="none"/>
      <ellipse cx="50" cy="50" rx="30" ry="12" stroke-width="3.6"/>
      <ellipse cx="50" cy="50" rx="30" ry="12" stroke-width="3.6" transform="rotate(60 50 50)"/>
      <ellipse cx="50" cy="50" rx="30" ry="12" stroke-width="3.6" transform="rotate(120 50 50)"/>
    </svg>`,
  },
  {
    id: "composicion_anillo_hexagonal",
    nombre: "Anillo Molecular / Hexágono",
    categoria: "composicion",
    tags: ["composicion", "molecula", "quimica", "hexagono", "anillo", "benceno", "formula"],
    // Anillo de benceno: hexágono con tres dobles enlaces internos.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M50 22 L74.2 36 L74.2 64 L50 78 L25.8 64 L25.8 36 Z" stroke-width="4.5"/>
      <line x1="50" y1="30" x2="67.3" y2="40" stroke-width="3.5"/>
      <line x1="67.3" y1="60" x2="50" y2="70" stroke-width="3.5"/>
      <line x1="32.7" y1="60" x2="32.7" y2="40" stroke-width="3.5"/>
    </svg>`,
  },

  // --- APARIENCIA ---
  {
    id: "apariencia_ojo",
    nombre: "Ojo / Inspección Visual",
    categoria: "apariencia",
    tags: ["apariencia", "ojo", "visual", "inspeccion", "color", "aspecto"],
    // Ojo almendrado con iris y pupila rellena.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M18 50 C30 31 70 31 82 50 C70 69 30 69 18 50 Z" stroke-width="4.5"/>
      <circle cx="50" cy="50" r="11.5" stroke-width="4"/>
      <circle cx="50" cy="50" r="5" fill="currentColor" stroke="none"/>
    </svg>`,
  },
  {
    id: "apariencia_lupa_muestra",
    nombre: "Lupa sobre Muestra",
    categoria: "apariencia",
    tags: ["apariencia", "lupa", "muestra", "textura", "inspeccion", "detalle"],
    // Lupa grande con mango grueso y tres partículas dentro del lente.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <circle cx="42" cy="42" r="21" stroke-width="4.5"/>
      <line x1="57" y1="57" x2="78" y2="78" stroke-width="6.5"/>
      <circle cx="36" cy="38" r="2.8" fill="currentColor" stroke="none"/>
      <circle cx="47" cy="44" r="3.2" fill="currentColor" stroke="none"/>
      <circle cx="39" cy="49" r="2.4" fill="currentColor" stroke="none"/>
    </svg>`,
  },
  {
    id: "apariencia_paleta_tono",
    nombre: "Paleta de Tono / Color",
    categoria: "apariencia",
    tags: ["apariencia", "color", "tono", "paleta", "aspecto", "visual"],
    // Paleta de pintor con cuatro pozos de color rellenos.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M50 22 C68 22 82 35 82 50 C82 57 77 61 70 59 C64 57 61 62 63 68 C65 76 59 82 50 82 C32 82 18 68 18 50 C18 35 32 22 50 22 Z" stroke-width="4.5"/>
      <circle cx="36" cy="42" r="5.5" fill="currentColor" stroke="none"/>
      <circle cx="51" cy="35" r="5.5" fill="currentColor" stroke="none"/>
      <circle cx="66" cy="42" r="5.5" fill="currentColor" stroke="none"/>
      <circle cx="33" cy="58" r="5.5" fill="currentColor" stroke="none"/>
    </svg>`,
  },
  {
    id: "apariencia_polvo_granulado",
    nombre: "Polvo / Textura Granulada",
    categoria: "apariencia",
    tags: ["apariencia", "polvo", "granulado", "textura", "solido", "particulas", "harina"],
    // Montículo de polvo relleno con partículas cayendo encima.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M18 76 C30 74 34 58 42 54 C46 52 48 46 50 46 C52 46 54 52 58 54 C66 58 70 74 82 76 Z" fill="currentColor" stroke-width="3"/>
      <circle cx="34" cy="36" r="3" fill="currentColor" stroke="none"/>
      <circle cx="50" cy="26" r="3.4" fill="currentColor" stroke="none"/>
      <circle cx="66" cy="36" r="3" fill="currentColor" stroke="none"/>
      <circle cx="42" cy="20" r="2.4" fill="currentColor" stroke="none"/>
      <circle cx="59" cy="20" r="2.4" fill="currentColor" stroke="none"/>
    </svg>`,
  },
  {
    id: "apariencia_liquido_nivel",
    nombre: "Líquido / Nivel en Vaso",
    categoria: "apariencia",
    tags: ["apariencia", "liquido", "nivel", "vaso", "fluido", "textura", "viscosidad"],
    // Vaso de laboratorio con línea de nivel ondulada y dos burbujas.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M34 20 L34 62 C34 72 41 78 50 78 C59 78 66 72 66 62 L66 20" stroke-width="4.5"/>
      <line x1="28" y1="20" x2="72" y2="20" stroke-width="4.5"/>
      <path d="M34 50 C40 45 46 55 51 50 C56 45 61 55 66 50" stroke-width="3.5"/>
      <circle cx="44" cy="64" r="2.6" fill="currentColor" stroke="none"/>
      <circle cx="55" cy="68" r="2.2" fill="currentColor" stroke="none"/>
    </svg>`,
  },

  // --- CALIDAD ---
  {
    id: "calidad_medalla",
    nombre: "Medalla & Cinta de Calidad",
    categoria: "calidad",
    tags: ["calidad", "grado", "medalla", "sello", "certificacion", "premium"],
    // Medalla con cintas rellenas y estrella rellena en el centro.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M38 18 L30 46 L44 42 L50 52 L46 18 Z" fill="currentColor" stroke-width="3"/>
      <path d="M62 18 L70 46 L56 42 L50 52 L54 18 Z" fill="currentColor" stroke-width="3"/>
      <circle cx="50" cy="62" r="18" stroke-width="4.5"/>
      <path d="M50 53 L52.2 58.9 L58.6 59.2 L53.6 63.2 L55.3 69.3 L50 65.8 L44.7 69.3 L46.4 63.2 L41.4 59.2 L47.8 58.9 Z" fill="currentColor" stroke-width="2"/>
    </svg>`,
  },
  {
    id: "calidad_escudo_sello",
    nombre: "Escudo de Grado / Sello",
    categoria: "calidad",
    tags: ["calidad", "grado", "escudo", "sello", "garantia", "certificacion"],
    // Escudo con chulo grande: garantía / calidad comprobada.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M50 18 L76 28 C76 50 66 70 50 80 C34 70 24 50 24 28 Z" stroke-width="4.5"/>
      <path d="M39 50 L47 58 L62 41" stroke-width="5.5"/>
    </svg>`,
  },
  {
    id: "calidad_certificado_sello",
    nombre: "Certificado & Sello de Control",
    categoria: "calidad",
    tags: ["calidad", "grado", "certificado", "sello", "control", "documento", "usp"],
    // Documento con líneas de texto y sello circular con chulo en la esquina.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <rect x="28" y="18" width="40" height="52" rx="4" stroke-width="4.5"/>
      <line x1="36" y1="32" x2="60" y2="32" stroke-width="3.5"/>
      <line x1="36" y1="42" x2="60" y2="42" stroke-width="3.5"/>
      <line x1="36" y1="52" x2="50" y2="52" stroke-width="3.5"/>
      <circle cx="64" cy="66" r="13" fill="currentColor" stroke="none"/>
      <path d="M58 66 L63 71 L71 61" stroke="#ffffff" stroke-width="4"/>
    </svg>`,
  },

  // --- CONSERVACIÓN ---
  {
    id: "conservacion_reloj_arena",
    nombre: "Reloj de Arena / Vida Útil",
    categoria: "conservacion",
    tags: ["conservacion", "almacen", "vida util", "vencimiento", "reloj", "tiempo"],
    // Reloj de arena con arena rellena arriba y abajo.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <line x1="32" y1="20" x2="68" y2="20" stroke-width="5"/>
      <line x1="32" y1="80" x2="68" y2="80" stroke-width="5"/>
      <path d="M36 20 L36 28 C36 38 46 44 48 50 C46 56 36 62 36 72 L36 80" stroke-width="4.5"/>
      <path d="M64 20 L64 28 C64 38 54 44 52 50 C54 56 64 62 64 72 L64 80" stroke-width="4.5"/>
      <path d="M40 28 L60 28 L50 42 Z" fill="currentColor" stroke="none"/>
      <path d="M39 80 L61 80 L50 66 Z" fill="currentColor" stroke="none"/>
    </svg>`,
  },
  {
    id: "conservacion_lugar_seco",
    nombre: "Lugar Seco / Sin Humedad",
    categoria: "conservacion",
    tags: ["conservacion", "almacen", "seco", "humedad", "gota", "clima"],
    // Pictograma estándar "mantener seco": gota grande tachada.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <path d="M50 18 C50 18 30 42 30 56 C30 68 39 78 50 78 C61 78 70 68 70 56 C70 42 50 18 50 18 Z" stroke-width="4.5"/>
      <line x1="24" y1="76" x2="76" y2="24" stroke-width="6"/>
    </svg>`,
  },
  {
    id: "conservacion_envase_sellado",
    nombre: "Envase Sellado / Seguro",
    categoria: "conservacion",
    tags: ["conservacion", "almacen", "envase", "sellado", "candado", "hermetico"],
    // Frasco con tapa y candado relleno al frente.
    svg: `${SVG_ABRE}
      ${CIRCULO_EXT}
      <rect x="30" y="20" width="40" height="12" rx="3" stroke-width="4.5"/>
      <path d="M33 32 L33 74 C33 78 36 81 40 81 L60 81 C64 81 67 78 67 74 L67 32" stroke-width="4.5"/>
      <path d="M43 52 L43 47 C43 39 57 39 57 47 L57 52" stroke-width="3.8"/>
      <rect x="39" y="52" width="22" height="17" rx="3" fill="currentColor" stroke="none"/>
    </svg>`,
  },
];
