/**
 * Iconos vectoriales minimalistas y modernos para los 6 atributos de la ficha
 * técnica de materias primas (Origen, Aroma, Apariencia, Composición, Calidad,
 * Conservación). Cada icono cuenta con estética limpia, trazo fino/medio,
 * proporción armónica y encerrado en un círculo perfecto.
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

export const ICONOS_QUIMICA_CIRCULARES: IconoQuimicoCircular[] = [
  // --- PAÍS DE ORIGEN / ORIGEN ---
  {
    id: "origen_globo_meridianos",
    nombre: "Globo Terráqueo & Meridianos",
    categoria: "origen",
    tags: ["origen", "pais", "globo", "mundo", "geografia", "procedencia", "internacional"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="3.2"/>
      <circle cx="50" cy="50" r="24" stroke-width="2.8"/>
      <ellipse cx="50" cy="50" rx="9" ry="24" stroke-width="2.4"/>
      <line x1="26" y1="50" x2="74" y2="50" stroke-width="2.6"/>
      <path d="M28 38 Q50 44 72 38" stroke-width="2.2"/>
      <path d="M28 62 Q50 56 72 62" stroke-width="2.2"/>
      <circle cx="64" cy="40" r="6" stroke-width="2"/>
      <circle cx="64" cy="40" r="2.6" fill="currentColor"/>
    </svg>`,
  },
  {
    id: "origen_pin_ubicacion",
    nombre: "Pin de Ubicación / Punto de Origen",
    categoria: "origen",
    tags: ["origen", "pin", "ubicacion", "mapa", "punto", "procedencia", "lugar"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="3.2"/>
      <path d="M50 24 C61 24 70 33 70 44 C70 58 50 78 50 78 C50 78 30 58 30 44 C30 33 39 24 50 24 Z" stroke-width="3"/>
      <circle cx="50" cy="44" r="8" stroke-width="2.6"/>
      <ellipse cx="50" cy="83" rx="14" ry="2.6" stroke-width="2"/>
    </svg>`,
  },
  {
    id: "origen_bandera",
    nombre: "Bandera / País de Procedencia",
    categoria: "origen",
    tags: ["origen", "bandera", "pais", "procedencia", "nacion", "importado"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="3.2"/>
      <circle cx="32" cy="80" r="2.6" fill="currentColor"/>
      <line x1="32" y1="78" x2="32" y2="22" stroke-width="3.2"/>
      <path d="M32 26 L60 26 C64 30 56 34 60 38 L32 38 Z" stroke-width="2.8"/>
    </svg>`,
  },

  // --- AROMA ---
  {
    id: "aroma_ondas_gota",
    nombre: "Ondas de Aroma / Gota",
    categoria: "aroma",
    tags: ["aroma", "olor", "esencia", "gota", "fragancia", "ondas", "perfume"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="3.2"/>
      <path d="M50 46 C50 46 38 62 38 72 C38 79 43 84 50 84 C57 84 62 79 62 72 C62 62 50 46 50 46 Z" stroke-width="3"/>
      <circle cx="44" cy="68" r="1.8" fill="currentColor"/>
      <path d="M38 44 Q42 36 38 28" stroke-width="2.4"/>
      <path d="M50 40 Q54 32 50 22" stroke-width="2.6"/>
      <path d="M62 44 Q58 36 62 28" stroke-width="2.4"/>
    </svg>`,
  },
  {
    id: "aroma_frasco_spray",
    nombre: "Frasco Atomizador / Fragancia",
    categoria: "aroma",
    tags: ["aroma", "olor", "frasco", "perfume", "atomizador", "spray", "fragancia"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="3.2"/>
      <rect x="38" y="46" width="24" height="30" rx="4" stroke-width="2.8"/>
      <rect x="44" y="34" width="12" height="12" rx="2" stroke-width="2.6"/>
      <circle cx="50" cy="26" r="6" stroke-width="2.6"/>
      <line x1="50" y1="34" x2="50" y2="32" stroke-width="2.4"/>
      <line x1="60" y1="22" x2="66" y2="16" stroke-width="2.2"/>
      <line x1="64" y1="28" x2="72" y2="26" stroke-width="2.2"/>
      <line x1="62" y1="34" x2="70" y2="36" stroke-width="2.2"/>
      <circle cx="68" cy="20" r="1.5" fill="currentColor"/>
      <circle cx="74" cy="27" r="1.3" fill="currentColor"/>
    </svg>`,
  },
  {
    id: "aroma_flor_ondas",
    nombre: "Flor & Ondas de Fragancia",
    categoria: "aroma",
    tags: ["aroma", "olor", "flor", "esencia", "botanico", "fragancia", "floral"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="3.2"/>
      <circle cx="50" cy="58" r="6" stroke-width="2.6"/>
      <ellipse cx="50" cy="48" rx="5" ry="8" stroke-width="2.4"/>
      <ellipse cx="50" cy="68" rx="5" ry="8" stroke-width="2.4"/>
      <ellipse cx="40" cy="58" rx="8" ry="5" stroke-width="2.4"/>
      <ellipse cx="60" cy="58" rx="8" ry="5" stroke-width="2.4"/>
      <path d="M40 34 Q44 26 40 18" stroke-width="2.4"/>
      <path d="M50 32 Q54 24 50 16" stroke-width="2.6"/>
      <path d="M60 34 Q56 26 60 18" stroke-width="2.4"/>
    </svg>`,
  },

  {
    id: "aroma_nariz_percepcion",
    nombre: "Nariz / Percepción Olfativa",
    categoria: "aroma",
    tags: ["aroma", "olor", "nariz", "percepcion", "olfativo", "nota"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="3.2"/>
      <path d="M46 24 C46 24 35 44 37 57 C38 65 46 68 54 64" stroke-width="2.8"/>
      <circle cx="43" cy="58" r="2.2" fill="currentColor" stroke="none"/>
      <path d="M27 42 Q22 33 27 24" stroke-width="2.2"/>
      <path d="M34 36 Q29 27 34 18" stroke-width="2.2"/>
    </svg>`,
  },
  {
    id: "aroma_nube_notas",
    nombre: "Nube de Aroma / Notas al Aire",
    categoria: "aroma",
    tags: ["aroma", "olor", "nube", "notas", "difusion", "ambiente", "fragancia"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="3.2"/>
      <path d="M34 58 C28 58 24 53 24 47 C24 41 28 37 34 37 C35 30 41 25 49 25 C57 25 63 30 65 37 C71 37 75 42 75 48 C75 54 71 58 65 58 Z" stroke-width="2.6"/>
      <path d="M40 66 Q42 72 38 76" stroke-width="2.2"/>
      <path d="M50 66 Q52 72 48 76" stroke-width="2.2"/>
      <path d="M60 66 Q62 72 58 76" stroke-width="2.2"/>
    </svg>`,
  },

  // --- COMPOSICIÓN ---
  {
    id: "composicion_molecula_enlazada",
    nombre: "Molécula Enlazada / Ball-and-Stick",
    categoria: "composicion",
    tags: ["composicion", "molecula", "atomo", "quimica", "enlace", "estructura", "formula"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="3.2"/>
      <line x1="37" y1="38" x2="61" y2="30" stroke-width="2.6"/>
      <line x1="37" y1="38" x2="33" y2="62" stroke-width="2.6"/>
      <line x1="37" y1="38" x2="63" y2="58" stroke-width="2.6"/>
      <line x1="63" y1="58" x2="61" y2="30" stroke-width="2.6"/>
      <circle cx="37" cy="38" r="8" stroke-width="2.6"/>
      <circle cx="61" cy="30" r="5.5" stroke-width="2.4"/>
      <circle cx="33" cy="62" r="5.5" stroke-width="2.4"/>
      <circle cx="63" cy="58" r="6.5" stroke-width="2.4"/>
    </svg>`,
  },
  {
    id: "composicion_atomo_orbitas",
    nombre: "Átomo / Estructura Atómica",
    categoria: "composicion",
    tags: ["composicion", "atomo", "molecula", "quimica", "orbita", "electron", "estructura"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="3.2"/>
      <circle cx="50" cy="50" r="4.5" fill="currentColor" stroke="none"/>
      <ellipse cx="50" cy="50" rx="27" ry="10.5" stroke-width="2.4"/>
      <ellipse cx="50" cy="50" rx="27" ry="10.5" stroke-width="2.4" transform="rotate(60 50 50)"/>
      <ellipse cx="50" cy="50" rx="27" ry="10.5" stroke-width="2.4" transform="rotate(120 50 50)"/>
    </svg>`,
  },
  {
    id: "composicion_anillo_hexagonal",
    nombre: "Anillo Molecular / Hexágono",
    categoria: "composicion",
    tags: ["composicion", "molecula", "quimica", "hexagono", "anillo", "benceno", "formula"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="3.2"/>
      <path d="M50 25 L71 37.5 L71 62.5 L50 75 L29 62.5 L29 37.5 Z" stroke-width="2.8"/>
      <circle cx="50" cy="25" r="2.4" fill="currentColor" stroke="none"/>
      <circle cx="71" cy="37.5" r="2.4" fill="currentColor" stroke="none"/>
      <circle cx="71" cy="62.5" r="2.4" fill="currentColor" stroke="none"/>
      <circle cx="50" cy="75" r="2.4" fill="currentColor" stroke="none"/>
      <circle cx="29" cy="62.5" r="2.4" fill="currentColor" stroke="none"/>
      <circle cx="29" cy="37.5" r="2.4" fill="currentColor" stroke="none"/>
    </svg>`,
  },

  // --- APARIENCIA ---
  {
    id: "apariencia_ojo",
    nombre: "Ojo / Inspección Visual",
    categoria: "apariencia",
    tags: ["apariencia", "ojo", "visual", "inspeccion", "color", "aspecto"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="3.2"/>
      <path d="M28 38 C38 30 62 30 72 38" stroke-width="2.6"/>
      <path d="M22 50 C34 36 66 36 78 50 C66 64 34 64 22 50 Z" stroke-width="3"/>
      <circle cx="50" cy="50" r="9" stroke-width="2.6"/>
      <circle cx="50" cy="50" r="3.5" fill="currentColor"/>
    </svg>`,
  },
  {
    id: "apariencia_lupa_muestra",
    nombre: "Lupa sobre Muestra",
    categoria: "apariencia",
    tags: ["apariencia", "lupa", "muestra", "textura", "inspeccion", "detalle"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="3.2"/>
      <circle cx="44" cy="44" r="16" stroke-width="3"/>
      <line x1="56" y1="56" x2="72" y2="72" stroke-width="3.6"/>
      <circle cx="40" cy="40" r="2" fill="currentColor"/>
      <circle cx="48" cy="46" r="2.3" fill="currentColor"/>
      <circle cx="42" cy="50" r="1.6" fill="currentColor"/>
    </svg>`,
  },
  {
    id: "apariencia_paleta_tono",
    nombre: "Paleta de Tono / Color",
    categoria: "apariencia",
    tags: ["apariencia", "color", "tono", "paleta", "aspecto", "visual"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="3.2"/>
      <circle cx="42" cy="42" r="14" stroke-width="2.6"/>
      <circle cx="58" cy="42" r="14" stroke-width="2.6"/>
      <circle cx="50" cy="58" r="14" stroke-width="2.6"/>
    </svg>`,
  },
  {
    id: "apariencia_polvo_granulado",
    nombre: "Polvo / Textura Granulada",
    categoria: "apariencia",
    tags: ["apariencia", "polvo", "granulado", "textura", "solido", "particulas", "harina"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="3.2"/>
      <path d="M30 66 Q50 74 70 66 L66 40 Q50 34 34 40 Z" stroke-width="2.6"/>
      <circle cx="40" cy="48" r="1.8" fill="currentColor" stroke="none"/>
      <circle cx="50" cy="44" r="1.6" fill="currentColor" stroke="none"/>
      <circle cx="60" cy="48" r="1.8" fill="currentColor" stroke="none"/>
      <circle cx="44" cy="56" r="1.6" fill="currentColor" stroke="none"/>
      <circle cx="56" cy="56" r="1.6" fill="currentColor" stroke="none"/>
      <circle cx="50" cy="62" r="1.8" fill="currentColor" stroke="none"/>
    </svg>`,
  },
  {
    id: "apariencia_liquido_nivel",
    nombre: "Líquido / Nivel en Vaso",
    categoria: "apariencia",
    tags: ["apariencia", "liquido", "nivel", "vaso", "fluido", "textura", "viscosidad"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="3.2"/>
      <path d="M36 28 H64 L60 68 C60 74 40 74 40 68 Z" stroke-width="2.8"/>
      <line x1="34" y1="28" x2="66" y2="28" stroke-width="2.6"/>
      <path d="M41 52 Q50 47 59 52 L59.4 60 C59.4 65 40.6 65 40.6 60 Z" stroke-width="2"/>
    </svg>`,
  },

  // --- CALIDAD ---
  {
    id: "calidad_medalla",
    nombre: "Medalla & Cinta de Calidad",
    categoria: "calidad",
    tags: ["calidad", "grado", "medalla", "sello", "certificacion", "premium"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="3.2"/>
      <path d="M40 20 L34 46 L44 40 L50 50 Z" stroke-width="2.6"/>
      <path d="M60 20 L66 46 L56 40 L50 50 Z" stroke-width="2.6"/>
      <circle cx="50" cy="58" r="18" stroke-width="3"/>
      <path d="M43 58 L48 64 L59 51" stroke-width="3.4"/>
    </svg>`,
  },
  {
    id: "calidad_escudo_sello",
    nombre: "Escudo de Grado / Sello",
    categoria: "calidad",
    tags: ["calidad", "grado", "escudo", "sello", "garantia", "certificacion"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="3.2"/>
      <path d="M50 22 L72 30 C72 50 62 68 50 76 C38 68 28 50 28 30 Z" stroke-width="3"/>
      <path d="M41 52 Q50 52 50 43 Q50 52 59 52 Q50 52 50 61 Q50 52 41 52 Z" stroke-width="2.2" fill="currentColor"/>
    </svg>`,
  },
  {
    id: "calidad_certificado_sello",
    nombre: "Certificado & Sello de Control",
    categoria: "calidad",
    tags: ["calidad", "grado", "certificado", "sello", "control", "documento", "usp"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="3.2"/>
      <rect x="32" y="22" width="36" height="48" rx="3" stroke-width="2.8"/>
      <path d="M58 22 L68 32 L58 32 Z" stroke-width="2.4"/>
      <line x1="38" y1="40" x2="56" y2="40" stroke-width="2.2"/>
      <line x1="38" y1="48" x2="56" y2="48" stroke-width="2.2"/>
      <circle cx="62" cy="68" r="14" stroke-width="3"/>
      <path d="M56 68 L61 73 L70 62" stroke-width="3"/>
    </svg>`,
  },

  // --- CONSERVACIÓN ---
  {
    id: "conservacion_reloj_arena",
    nombre: "Reloj de Arena / Vida Útil",
    categoria: "conservacion",
    tags: ["conservacion", "almacen", "vida util", "vencimiento", "reloj", "tiempo"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.9" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="3.2"/>
      <line x1="30" y1="24" x2="70" y2="24" stroke-width="3.2"/>
      <line x1="30" y1="76" x2="70" y2="76" stroke-width="3.2"/>
      <path d="M34 24 L66 24 L66 30 C66 38 58 44 50 50 C58 56 66 62 66 70 L66 76 L34 76 L34 70 C34 62 42 56 50 50 C42 44 34 38 34 30 Z" stroke-width="2.8"/>
      <path d="M42 30 L58 30 L50 40 Z" fill="currentColor"/>
      <path d="M42 70 L58 70 L50 60 Z" fill="currentColor"/>
    </svg>`,
  },
  {
    id: "conservacion_lugar_seco",
    nombre: "Lugar Seco / Sin Humedad",
    categoria: "conservacion",
    tags: ["conservacion", "almacen", "seco", "humedad", "gota", "clima"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.9" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="3.2"/>
      <circle cx="50" cy="49" r="26" stroke-width="2.6"/>
      <path d="M50 34 C50 34 40 46 40 54 C40 60 44 64 50 64 C56 64 60 60 60 54 C60 46 50 34 50 34 Z" stroke-width="2.8"/>
      <line x1="30" y1="69" x2="70" y2="29" stroke-width="3.6"/>
    </svg>`,
  },
  {
    id: "conservacion_envase_sellado",
    nombre: "Envase Sellado / Seguro",
    categoria: "conservacion",
    tags: ["conservacion", "almacen", "envase", "sellado", "candado", "hermetico"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.9" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="3.2"/>
      <rect x="30" y="44" width="40" height="32" rx="4" stroke-width="3"/>
      <line x1="30" y1="54" x2="70" y2="54" stroke-width="2.6"/>
      <rect x="44" y="30" width="12" height="14" rx="3" stroke-width="2.8"/>
      <path d="M46 30 L46 24 C46 20 54 20 54 24 L54 30" stroke-width="2.8"/>
      <circle cx="50" cy="37" r="1.8" fill="currentColor"/>
    </svg>`,
  },
];
