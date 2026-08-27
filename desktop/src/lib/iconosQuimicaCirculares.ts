/**
 * Iconos vectoriales minimalistas y modernos de Química, Alquimia y Laboratorio
 * diseñados específicamente para etiquetas de materias primas e industria cosmética/química.
 * Cada icono cuenta con estética limpia, trazo fino/medio, proporción armónica
 * y encerrado en un círculo perfecto.
 */

export interface IconoQuimicoCircular {
  id: string;
  nombre: string;
  categoria: "cuidado_piel" | "frutos_secos" | "texturas" | "quimica" | "alquimia" | "laboratorio" | "cosmetica" | "propiedades" | "seguridad";
  tags: string[];
  /** SVG markup con viewBox 0 0 100 100 y círculos/líneas limpios */
  svg: string;
}

export function iconoQuimicoASvgDataUrl(
  svg: string,
  colorTinta = "#1a1a1a",
  conCirculoExterior = true,
): string {
  let processed = svg.replace(/currentColor/g, colorTinta);
  if (!conCirculoExterior) {
    // Si el usuario desactiva el marco circular, removemos el círculo exterior r="44"
    processed = processed.replace(/<circle[^>]*r="44"[^>]*\/>/g, "");
  }
  try {
    return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(processed)));
  } catch {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(processed);
  }
}

export const CATEGORIAS_ICONOS_QUIMICA = [
  { id: "todos", label: "✨ Todos" },
  { id: "cuidado_piel", label: "💆‍♀️ Cuidado de Piel / Skincare" },
  { id: "frutos_secos", label: "🌰 Frutos Secos & Semillas" },
  { id: "texturas", label: "🧴 Texturas & Formas" },
  { id: "quimica", label: "🧪 Química & Fórmulas" },
  { id: "alquimia", label: "⚗️ Alquimia & Elementos" },
  { id: "laboratorio", label: "🔬 Laboratorio & Instrumental" },
  { id: "cosmetica", label: "🌿 Cosmética & Botánica" },
  { id: "propiedades", label: "💧 Propiedades & Pureza" },
  { id: "seguridad", label: "🛡️ Cuidado & Almacén" },
] as const;

export const ICONOS_QUIMICA_CIRCULARES: IconoQuimicoCircular[] = [
  // --- CUIDADO DE PIEL & DERMOCOSMÉTICA (SKINCARE) ---
  {
    id: "skincare_rostro_perfil",
    nombre: "Perfil Facial & Luminosidad (Glow)",
    categoria: "cuidado_piel",
    tags: ["rostro", "facial", "skincare", "piel", "belleza", "perfil", "brillo", "glow", "dermatologia"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Silueta de perfil facial orgánico continuo -->
      <path d="M42 22 C37 28 36 34 39 37 C41 40 46 41 44 46 C42 50 37 51 38 56 C39 59 43 61 44 65 C45 69 39 74 38 78" stroke-width="2.6"/>
      <!-- Cuello y hombro con curvas suaves -->
      <path d="M48 68 C50 72 55 77 62 78" stroke-width="2.4"/>
      <!-- Destellos de luz y luminosidad dérmica -->
      <path d="M60 30 Q65 30 65 25 Q65 30 70 30 Q65 30 65 35 Q65 30 60 30 Z" stroke-width="2" fill="currentColor"/>
      <path d="M66 46 Q70 46 70 42 Q70 46 74 46 Q70 46 70 50 Q70 46 66 46 Z" stroke-width="1.8" fill="currentColor"/>
      <!-- Líneas de tensión y cuidado reafirmante -->
      <path d="M52 40 C57 44 58 52 54 58" stroke-width="2"/>
      <circle cx="58" cy="62" r="2.2" stroke-width="1.8"/>
    </svg>`,
  },
  {
    id: "skincare_barrera_cutanea",
    nombre: "Barrera Cutánea & Capas Dérmicas",
    categoria: "cuidado_piel",
    tags: ["barrera", "cutanea", "epidermis", "dermis", "ceramidas", "escudo", "lipidos", "proteccion"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Arco de escudo protector superior frente a agresores -->
      <path d="M26 36 C34 26 66 26 74 36" stroke-width="2.6"/>
      <!-- Capas dérmicas onduladas orgánicas -->
      <path d="M22 50 C30 46 42 52 50 48 C58 44 70 50 78 46" stroke-width="2.6"/>
      <path d="M22 62 C30 58 42 64 50 60 C58 56 70 62 78 58" stroke-width="2.4"/>
      <path d="M22 74 C30 70 42 76 50 72 C58 68 70 74 78 70" stroke-width="2.2"/>
      <!-- Células y ceramidas de unión intercelular -->
      <circle cx="36" cy="55" r="2.2" fill="currentColor"/>
      <circle cx="50" cy="54" r="2.2" fill="currentColor"/>
      <circle cx="64" cy="55" r="2.2" fill="currentColor"/>
      <circle cx="43" cy="67" r="2" fill="currentColor"/>
      <circle cx="57" cy="66" r="2" fill="currentColor"/>
      <!-- Gota lipídica de sellado -->
      <path d="M50 20 C50 20 44 26 44 30 C44 33 47 35 50 35 C53 35 56 33 56 30 C56 26 50 20 50 20 Z" stroke-width="2"/>
    </svg>`,
  },
  {
    id: "skincare_anti_edad_colageno",
    nombre: "Anti-Edad / Colágeno & Firmeza",
    categoria: "cuidado_piel",
    tags: ["antiedad", "antiage", "arrugas", "colageno", "elastina", "firmeza", "tensor", "lifting", "juventud"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Triple hélice / fibra entrelazada de colágeno -->
      <path d="M36 76 C32 60 68 56 64 40 C60 26 44 24 40 20" stroke-width="2.6"/>
      <path d="M64 76 C68 60 32 56 36 40 C40 26 56 24 60 20" stroke-width="2.6"/>
      <!-- Enlaces peptídicos intermoleculares -->
      <line x1="36" y1="64" x2="64" y2="64" stroke-width="2"/>
      <line x1="42" y1="48" x2="58" y2="48" stroke-width="2.4"/>
      <line x1="36" y1="32" x2="64" y2="32" stroke-width="2"/>
      <!-- Destellos de efecto lifting & firmeza -->
      <path d="M50 14 Q52 18 56 18 Q52 18 50 22 Q48 18 44 18 Q48 18 50 14 Z" stroke-width="1.8" fill="currentColor"/>
      <circle cx="26" cy="48" r="2.5" stroke-width="1.8"/>
      <circle cx="74" cy="48" r="2.5" stroke-width="1.8"/>
    </svg>`,
  },
  {
    id: "skincare_hidratacion_profunda",
    nombre: "Hidratación Profunda & Ácido Hialurónico",
    categoria: "cuidado_piel",
    tags: ["hidratacion", "humectante", "hialuronico", "agua", "profunda", "retencion", "suavidad", "relleno"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Gota principal de ácido hialurónico con volumen orgánico -->
      <path d="M50 18 C50 18 32 38 32 52 C32 64 40 72 50 72 C60 72 68 64 68 52 C68 38 50 18 50 18 Z" stroke-width="2.6"/>
      <!-- Ondas concéntricas de absorción celular profunda -->
      <path d="M42 46 C42 56 46 62 50 62" stroke-width="2.2"/>
      <circle cx="58" cy="42" r="3" fill="currentColor"/>
      <!-- Ondas expansivas de hidratación en la base dérmica -->
      <path d="M24 74 C34 68 66 68 76 74" stroke-width="2.4"/>
      <path d="M32 80 C40 76 60 76 68 80" stroke-width="2"/>
      <circle cx="26" cy="44" r="2.2" stroke-width="1.8"/>
      <circle cx="74" cy="44" r="2.2" stroke-width="1.8"/>
    </svg>`,
  },
  {
    id: "skincare_calmante_sensible",
    nombre: "Piel Sensible / Calmante & Anti-Rojeces",
    categoria: "cuidado_piel",
    tags: ["calmante", "sensible", "alivio", "antirojeces", "suave", "reparador", "soothing", "cica", "centella"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Hoja botánica de centella asiática / cica calmante -->
      <path d="M30 65 C26 50 34 34 50 30 C66 34 74 50 70 65 C62 70 56 66 50 62 C44 66 38 70 30 65 Z" stroke-width="2.6"/>
      <path d="M50 30 Q50 48 50 62" stroke-width="2.2"/>
      <path d="M42 42 Q48 46 50 50" stroke-width="1.8"/>
      <path d="M58 42 Q52 46 50 50" stroke-width="1.8"/>
      <!-- Ondas de alivio y caricia dérmica -->
      <path d="M24 38 Q34 26 50 26 Q66 26 76 38" stroke-width="2.2"/>
      <circle cx="50" cy="19" r="2.5" fill="currentColor"/>
      <circle cx="34" cy="74" r="2" stroke-width="1.8"/>
      <circle cx="66" cy="74" r="2" stroke-width="1.8"/>
    </svg>`,
  },
  {
    id: "skincare_contorno_ojos",
    nombre: "Contorno de Ojos & Bolsas / Ojeras",
    categoria: "cuidado_piel",
    tags: ["ojos", "contorno", "ojeras", "bolsas", "mirada", "arrugas", "reafirmante", "cafeina"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Ceja orgánica y natural superior -->
      <path d="M26 32 C36 26 62 26 74 36" stroke-width="2.6"/>
      <!-- Ojo almendrado sereno y elegante -->
      <path d="M24 52 C34 40 66 40 76 52 C66 64 34 64 24 52 Z" stroke-width="2.6"/>
      <!-- Iris y pupila con destello luminoso -->
      <circle cx="50" cy="52" r="8" stroke-width="2.4"/>
      <circle cx="50" cy="52" r="3.5" fill="currentColor"/>
      <!-- Línea semicircular de cuidado del contorno periocular y ojeras -->
      <path d="M30 66 C40 74 60 74 70 66" stroke-width="2.2"/>
      <path d="M36 72 C44 78 56 78 64 72" stroke-width="1.8" stroke-dasharray="3 2"/>
      <!-- Destellos de mirada descansada -->
      <circle cx="78" cy="42" r="2" fill="currentColor"/>
    </svg>`,
  },
  {
    id: "skincare_proteccion_solar_uv",
    nombre: "Fotoprotección / Filtro Solar UV (SPF)",
    categoria: "cuidado_piel",
    tags: ["solar", "fotoproteccion", "uv", "uva", "uvb", "spf", "escudo", "bloqueador", "sol", "defensa"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Sol radiante con rayos orgánicos curvos -->
      <circle cx="36" cy="36" r="11" stroke-width="2.6"/>
      <path d="M36 18 L36 22 M18 36 L22 36 M23 23 L26 26 M49 23 L46 26" stroke-width="2.4"/>
      <!-- Escudo dérmico protector curvado frente a radiación -->
      <path d="M44 42 C62 42 74 50 74 62 C74 74 58 80 44 82 C34 78 30 68 30 62 C30 54 36 44 44 42 Z" stroke-width="2.6"/>
      <!-- Ondas de desvío de rayos UV -->
      <path d="M50 50 C58 52 64 58 64 64" stroke-width="2.2"/>
      <path d="M58 32 Q66 38 72 44" stroke-width="2" stroke-dasharray="3 2"/>
      <circle cx="36" cy="36" r="4" fill="currentColor"/>
    </svg>`,
  },
  {
    id: "skincare_despigmentante_glow",
    nombre: "Despigmentante / Tono Uniforme & Glow",
    categoria: "cuidado_piel",
    tags: ["despigmentante", "antimanchas", "aclarante", "niacinamida", "vitamina c", "tono uniforme", "iluminador", "glow"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Destello estelar central de alta luminosidad (Glow & Brillo) -->
      <path d="M50 18 C50 36 32 50 18 50 C32 50 50 64 50 82 C50 64 68 50 82 50 C68 50 50 36 50 18 Z" stroke-width="2.6"/>
      <!-- Destello secundario en diagonal de tono uniforme -->
      <path d="M50 32 C50 43 41 50 32 50 C41 50 50 57 50 68 C50 57 59 50 68 50 C59 50 50 43 50 32 Z" stroke-width="2"/>
      <circle cx="50" cy="50" r="4" fill="currentColor"/>
      <circle cx="28" cy="28" r="2.2" stroke-width="1.8"/>
      <circle cx="72" cy="28" r="2.2" stroke-width="1.8"/>
      <circle cx="28" cy="72" r="2.2" stroke-width="1.8"/>
      <circle cx="72" cy="72" r="2.2" stroke-width="1.8"/>
    </svg>`,
  },
  {
    id: "skincare_renovacion_peeling",
    nombre: "Renovación Celular / Peeling Químico (AHA/BHA)",
    categoria: "cuidado_piel",
    tags: ["exfoliacion", "peeling", "aha", "bha", "renovacion", "celular", "acido glicolico", "acido salicilico", "textura"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Capa de piel vieja desprendiéndose en curva ascendente -->
      <path d="M22 46 C34 46 44 42 54 36 C64 30 72 24 76 20" stroke-width="2.6"/>
      <path d="M48 38 C56 34 66 28 72 24" stroke-width="2"/>
      <!-- Nueva capa dérmica lisa, fresca y renovada -->
      <path d="M22 62 C36 62 48 58 62 58 C70 58 76 60 78 62" stroke-width="2.6"/>
      <!-- Células nuevas en renovación activa -->
      <circle cx="32" cy="72" r="3" stroke-width="2"/>
      <circle cx="48" cy="70" r="3.5" stroke-width="2"/>
      <circle cx="66" cy="72" r="3" stroke-width="2"/>
      <!-- Gotas activas exfoliantes de AHA/BHA -->
      <path d="M34 26 C34 26 30 32 30 35 C30 37 32 39 34 39 C36 39 38 37 38 35 C38 32 34 26 34 26 Z" stroke-width="2"/>
      <circle cx="48" cy="70" r="1.5" fill="currentColor"/>
    </svg>`,
  },
  {
    id: "skincare_poros_seborregulador",
    nombre: "Control de Sebo / Poros Limpios (Matificante)",
    categoria: "cuidado_piel",
    tags: ["poros", "sebo", "matificante", "grasa", "acne", "purificante", "astringente", "control de brillo", "zinc"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Embudo dérmico del poro en superficie cutánea -->
      <path d="M22 36 C34 36 40 46 46 58 L54 58 C60 46 66 36 78 36" stroke-width="2.6"/>
      <!-- Base del folículo y glándula sebácea purificada -->
      <path d="M44 58 C44 68 56 68 56 58" stroke-width="2.4"/>
      <!-- Micro-gota de aceite equilibrada / regulada -->
      <path d="M50 20 C50 20 44 28 44 32 C44 35 47 38 50 38 C53 38 56 35 56 32 C56 28 50 20 50 20 Z" stroke-width="2.2"/>
      <!-- Hojas botánicas de purificación y frescura astringente -->
      <path d="M28 66 C36 60 42 66 38 74 C30 76 26 72 28 66 Z" stroke-width="2.2"/>
      <path d="M72 66 C64 60 58 66 62 74 C70 76 74 72 72 66 Z" stroke-width="2.2"/>
      <circle cx="50" cy="33" r="1.8" fill="currentColor"/>
    </svg>`,
  },
  {
    id: "skincare_mascarilla_nutritiva",
    nombre: "Mascarilla Facial / Velo de Tratamiento",
    categoria: "cuidado_piel",
    tags: ["mascarilla", "sheet mask", "tratamiento", "intensivo", "spa", "nutricion", "velo facial", "concentrado"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Silueta oval de mascarilla facial con contorno suave -->
      <path d="M50 20 C32 20 25 32 25 52 C25 72 34 80 50 80 C66 80 75 72 75 52 C75 32 68 20 50 20 Z" stroke-width="2.6"/>
      <!-- Aberturas de ojos de la mascarilla -->
      <ellipse cx="38" cy="42" rx="6" ry="3.5" stroke-width="2.2"/>
      <ellipse cx="62" cy="42" rx="6" ry="3.5" stroke-width="2.2"/>
      <!-- Abertura de nariz y boca -->
      <path d="M47 50 L53 50 L50 56 Z" stroke-width="2"/>
      <ellipse cx="50" cy="65" rx="7" ry="3" stroke-width="2.2"/>
      <!-- Gotas y destellos de serum intensivo -->
      <circle cx="50" cy="30" r="2" fill="currentColor"/>
      <circle cx="20" cy="36" r="2.2" stroke-width="1.8"/>
      <circle cx="80" cy="36" r="2.2" stroke-width="1.8"/>
    </svg>`,
  },
  {
    id: "skincare_microbioma_cutaneo",
    nombre: "Microbioma & Probióticos Dérmicos",
    categoria: "cuidado_piel",
    tags: ["microbioma", "probioticos", "prebioticos", "flora cutanea", "defensa", "balance", "inmune", "fermentos"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Escudo orgánico biológico central -->
      <path d="M50 22 C64 22 72 32 72 46 C72 64 56 76 50 78 C44 76 28 64 28 46 C28 32 36 22 50 22 Z" stroke-width="2.6"/>
      <!-- Bacterias y fermentos simbióticos benéficos -->
      <path d="M42 36 C46 32 52 36 50 42 C48 48 42 46 42 36 Z" stroke-width="2" fill="none"/>
      <circle cx="58" cy="46" r="4" stroke-width="2"/>
      <ellipse cx="44" cy="58" rx="5" ry="3" transform="rotate(-25 44 58)" stroke-width="2"/>
      <circle cx="58" cy="62" r="2.8" stroke-width="1.8"/>
      <!-- Destellos de defensa inmunitaria dérmica -->
      <circle cx="50" cy="48" r="1.8" fill="currentColor"/>
      <path d="M22 28 Q26 28 26 24 Q26 28 30 28 Q26 28 26 32 Q26 28 22 28 Z" stroke-width="1.6" fill="currentColor"/>
      <path d="M70 28 Q74 28 74 24 Q74 28 78 28 Q74 28 74 32 Q74 28 70 28 Z" stroke-width="1.6" fill="currentColor"/>
    </svg>`,
  },
  // --- FRUTOS SECOS, NUECES & SEMILLAS BOTÁNICAS ---
  {
    id: "fruto_almendra",
    nombre: "Almendra (Entera & Partida)",
    categoria: "frutos_secos",
    tags: ["almendra", "almond", "prunus", "aceite", "nutritivo", "fruto seco", "suavizante"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Almendra principal en silueta botánica curvada natural -->
      <path d="M44 21 C54 27 67 41 65 61 C63 73 51 79 40 76 C28 72 23 55 30 40 C35 29 41 23 44 21 Z" stroke-width="2.6"/>
      <!-- Estrías y venas curvadas y fluidas -->
      <path d="M43 30 C50 40 52 56 46 68" stroke-width="2"/>
      <path d="M35 42 C39 51 40 62 35 69" stroke-width="1.8"/>
      <path d="M51 38 C56 47 57 59 52 67" stroke-width="1.8"/>
      <!-- Media almendra / corte transversal con contorno orgánico suave -->
      <path d="M57 37 C67 43 76 54 74 67 C72 74 65 77 59 74" stroke-width="2.2"/>
      <path d="M60 48 C66 52 68 62 64 68 C61 71 58 69 57 65 C56 60 57 52 60 48 Z" stroke-width="1.8"/>
      <circle cx="46" cy="46" r="1.6" fill="currentColor"/>
      <circle cx="43" cy="58" r="1.6" fill="currentColor"/>
    </svg>`,
  },
  {
    id: "fruto_nuez_nogal",
    nombre: "Nuez de Nogal (Cáscara & Núcleo)",
    categoria: "frutos_secos",
    tags: ["nuez", "nogal", "walnut", "juglans", "omega", "antioxidante", "fruto seco", "cerebro"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Borde de cáscara exterior sinuosa y rugosa natural -->
      <path d="M50 21 C64 21 75 32 75 49 C75 64 65 77 50 78 C35 77 25 64 25 49 C25 32 36 21 50 21 Z" stroke-width="2.6"/>
      <path d="M50 24 C60 25 69 34 69 49 C69 63 61 73 50 74 C39 73 31 63 31 49 C31 34 40 25 50 24 Z" stroke-width="1.8" stroke-dasharray="3.5 2"/>
      <!-- Eje y tabique leñoso ondulado -->
      <path d="M50 21 Q48 50 50 78" stroke-width="2.4"/>
      <!-- Pliegues cerebriformes orgánicos fluidos -->
      <path d="M43 29 C35 33 34 42 41 46 C34 52 35 63 43 69" stroke-width="2.2"/>
      <path d="M41 46 C47 46 47 52 42 56" stroke-width="1.8"/>
      <path d="M37 36 Q34 40 37 43" stroke-width="1.6"/>
      <path d="M38 58 Q35 62 38 65" stroke-width="1.6"/>
      <!-- Hemisferio derecho -->
      <path d="M57 29 C65 33 66 42 59 46 C66 52 65 63 57 69" stroke-width="2.2"/>
      <path d="M59 46 C53 46 53 52 58 56" stroke-width="1.8"/>
      <path d="M63 36 Q66 40 63 43" stroke-width="1.6"/>
      <path d="M62 58 Q65 62 62 65" stroke-width="1.6"/>
    </svg>`,
  },
  {
    id: "fruto_avellana",
    nombre: "Avellana Botánica (Cúpula & Hojas)",
    categoria: "frutos_secos",
    tags: ["avellana", "hazelnut", "corylus", "astringente", "aceite", "lipidos", "fruto seco"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Hojas dentadas y rizadas de la cúpula vegetal superior -->
      <path d="M25 35 C28 23 40 22 47 28 C51 19 63 21 72 31 C67 37 59 37 51 42 C43 37 33 40 25 35 Z" stroke-width="2.4"/>
      <path d="M37 25 Q41 30 43 36 M57 24 Q55 30 53 36" stroke-width="1.8"/>
      <!-- Fruto de avellana con curvas suaves y naturales -->
      <path d="M29 39 C25 55 33 73 49 78 C65 74 73 55 69 39" stroke-width="2.6"/>
      <!-- Vetas curvas y orgánicas de la cáscara -->
      <path d="M41 41 C37 51 40 65 49 75" stroke-width="2"/>
      <path d="M57 41 C61 51 58 65 49 75" stroke-width="2"/>
      <path d="M49 41 Q50 58 49 77" stroke-width="1.8"/>
      <!-- Pequeño ápice botánico curvo -->
      <path d="M47 77 Q49 81 52 77" stroke-width="2"/>
    </svg>`,
  },
  {
    id: "fruto_castana_marron",
    nombre: "Castaña (Erizo con Púas & Castaña)",
    categoria: "frutos_secos",
    tags: ["castana", "chestnut", "castano", "indias", "circulacion", "venotonico", "fruto seco"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Púas curvas orgánicas del erizo botánico -->
      <path d="M23 43 Q18 37 19 35 M21 52 Q15 51 15 53 M23 63 Q17 68 18 70 M77 43 Q82 37 81 35 M79 52 Q85 51 85 53 M77 63 Q83 68 82 70 M35 25 Q32 19 34 18 M65 25 Q68 19 66 18" stroke-width="2.2"/>
      <!-- Silueta acorazonada suave y natural de la castaña -->
      <path d="M50 23 C60 32 73 46 71 63 C69 75 58 78 50 78 C42 78 31 75 29 63 C27 46 40 32 50 23 Z" stroke-width="2.6"/>
      <!-- Hilio / zona basal leñosa curvada -->
      <path d="M31 65 C39 59 61 59 69 65" stroke-width="2.4"/>
      <path d="M37 72 Q50 69 63 72" stroke-width="1.8"/>
      <!-- Reflejos curvos de la piel pulida -->
      <path d="M46 33 C53 39 57 47 55 55" stroke-width="2.2"/>
      <path d="M49 23 Q50 18 51 22" stroke-width="2.4"/>
    </svg>`,
  },
  {
    id: "fruto_coco_abierto",
    nombre: "Coco (Mitad con Pulpa & Gotas)",
    categoria: "frutos_secos",
    tags: ["coco", "coconut", "cocos", "aceite de coco", "manteca", "acido laurico", "fruto seco"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Corteza exterior con textura fibrosa natural -->
      <path d="M23 47 C23 72 77 72 77 47 Z" stroke-width="2.8"/>
      <path d="M21 55 Q16 57 19 60 M24 66 Q20 71 23 72 M77 55 Q82 57 79 60 M74 66 Q78 71 75 72" stroke-width="2"/>
      <!-- Borde de corteza y pulpa blanca orgánica suave -->
      <path d="M24 47 C24 39 36 37 50 37 C64 37 76 39 76 47 C76 55 64 58 50 58 C36 58 24 55 24 47 Z" stroke-width="2.6"/>
      <path d="M31 47 C31 42 40 40 50 40 C60 40 69 42 69 47 C69 52 60 54 50 54 C40 54 31 52 31 47 Z" stroke-width="2.2"/>
      <path d="M38 47 C38 44 43 43 50 43 C57 43 62 44 62 47 C62 50 57 51 50 51 C43 51 38 50 38 47 Z" stroke-width="1.8" stroke-dasharray="3 2"/>
      <!-- Gotas y ondas naturales de aceite de coco -->
      <path d="M50 20 C50 20 42 30 42 36 C42 41 45 43 50 43 C55 43 58 41 58 36 C58 30 50 20 50 20 Z" stroke-width="2.2"/>
      <circle cx="33" cy="30" r="2.8" stroke-width="2"/>
      <circle cx="67" cy="30" r="2.8" stroke-width="2"/>
    </svg>`,
  },
  {
    id: "fruto_mani_cacahuate",
    nombre: "Maní / Cacahuate (Vaina Abierta & Granos)",
    categoria: "frutos_secos",
    tags: ["mani", "cacahuate", "peanut", "arachis", "emoliente", "proteina", "vaina"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Vaina de curvas suaves, naturales y cintura orgánica -->
      <path d="M48 19 C57 19 65 25 65 35 C65 43 59 47 55 50 C61 53 66 60 66 68 C66 77 57 81 48 81 C39 81 30 77 30 68 C30 60 35 53 41 50 C37 47 31 43 31 35 C31 25 39 19 48 19 Z" stroke-width="2.6"/>
      <!-- Granos de maní interiores orgánicos y redondeados -->
      <path d="M48 24 C54 24 58 29 58 36 C58 43 53 46 48 46 C43 46 38 43 38 36 C38 29 42 24 48 24 Z" stroke-width="2"/>
      <path d="M48 54 C55 54 59 60 59 68 C59 75 54 77 48 77 C42 77 37 75 37 68 C37 60 41 54 48 54 Z" stroke-width="2"/>
      <!-- Textura leñosa en curvas orgánicas -->
      <path d="M32 29 Q38 33 34 38 M63 29 Q58 33 62 38 M31 63 Q37 67 33 72 M64 63 Q59 67 63 72" stroke-width="1.8"/>
      <circle cx="48" cy="34" r="2" fill="currentColor"/>
      <circle cx="48" cy="65" r="2" fill="currentColor"/>
    </svg>`,
  },
  {
    id: "fruto_pistacho",
    nombre: "Pistacho (Valvas Abiertas & Fruto)",
    categoria: "frutos_secos",
    tags: ["pistacho", "pistacia", "antioxidante", "verde", "fruto seco", "semilla"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Cáscaras leñosas con curvas sinuosas naturales -->
      <path d="M46 21 C27 31 25 63 46 79 C37 63 37 37 46 21 Z" stroke-width="2.6"/>
      <path d="M35 37 Q31 47 39 67" stroke-width="1.8"/>
      <path d="M54 21 C73 31 75 63 54 79 C63 63 63 37 54 21 Z" stroke-width="2.6"/>
      <path d="M65 37 Q69 47 61 67" stroke-width="1.8"/>
      <!-- Semilla de pistacho verde central redondeada y orgánica -->
      <path d="M50 31 C56 31 60 40 60 50 C60 62 55 69 50 69 C45 69 40 62 40 50 C40 40 44 31 50 31 Z" stroke-width="2.4"/>
      <!-- Pliegue y piel fina de la semilla -->
      <path d="M48 39 Q53 45 47 59" stroke-width="2"/>
      <path d="M45 33 Q50 30 55 33" stroke-width="1.8"/>
      <circle cx="50" cy="61" r="1.6" fill="currentColor"/>
    </svg>`,
  },
  {
    id: "fruto_macadamia",
    nombre: "Nuez de Macadamia (Cáscara & Semilla)",
    categoria: "frutos_secos",
    tags: ["macadamia", "nuez", "palmitoleico", "rejuvenecedor", "aceite fino", "fruto seco"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Cáscara leñosa con trazo curvado libre -->
      <path d="M23 49 C23 34 35 23 50 23 C65 23 77 34 77 49 C77 64 65 77 50 77 C35 77 23 64 23 49 Z" stroke-width="2.6"/>
      <path d="M21 49 Q26 49 29 49 M71 49 Q75 49 79 49" stroke-width="2.4"/>
      <!-- Núcleo de macadamia suave y cremoso -->
      <path d="M50 31 C61 31 69 39 69 50 C69 61 61 69 50 69 C39 69 31 61 31 50 C31 39 39 31 50 31 Z" stroke-width="2.4"/>
      <!-- Hendidura orgánica y brillo -->
      <path d="M45 37 C41 45 41 53 47 62" stroke-width="2.2"/>
      <circle cx="56" cy="43" r="3.2" stroke-width="1.8"/>
      <circle cx="54" cy="56" r="2.2" stroke-width="1.6"/>
    </svg>`,
  },
  {
    id: "fruto_semilla_girasol",
    nombre: "Semillas de Girasol (Pipeta & Grano)",
    categoria: "frutos_secos",
    tags: ["girasol", "semilla", "pepitas", "helianthus", "vitamina e", "fruto seco"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Semilla principal con curvas aerodinámicas botánicas -->
      <path d="M39 19 C53 29 59 57 47 77 C39 79 31 69 33 50 C35 36 38 23 39 19 Z" stroke-width="2.6"/>
      <path d="M38 25 Q43 47 41 73" stroke-width="2"/>
      <path d="M43 33 Q47 48 44 69" stroke-width="1.8"/>
      <path d="M34 39 Q38 49 37 69" stroke-width="1.8"/>
      <!-- Semilla pelada con forma suave de lágrima -->
      <path d="M59 35 C69 43 73 61 65 73 C59 73 55 67 57 54 C58 44 59 37 59 35 Z" stroke-width="2.2"/>
      <path d="M60 41 Q64 53 62 67" stroke-width="1.6" stroke-dasharray="2 2"/>
    </svg>`,
  },
  {
    id: "fruto_semilla_sesamo_ajonjoli",
    nombre: "Semillas de Sésamo / Ajonjolí (Vaina & Semillas)",
    categoria: "frutos_secos",
    tags: ["sesamo", "ajonjoli", "sesamum", "semillas", "calcio", "aceite", "antioxidante"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Fruto de sésamo con líneas curvas florales -->
      <path d="M50 19 Q50 34 50 47 M41 23 C41 33 45 43 50 47 C55 43 59 33 59 23" stroke-width="2.2"/>
      <!-- Gotas y semillas con formas redondeadas naturales -->
      <path d="M50 47 C56 53 58 65 50 73 C44 65 44 53 50 47 Z" stroke-width="2.6"/>
      <path d="M29 51 C35 57 37 69 29 77 C23 69 23 57 29 51 Z" stroke-width="2.4" transform="rotate(-20 29 64)"/>
      <path d="M71 51 C77 57 79 69 71 77 C65 69 65 57 71 51 Z" stroke-width="2.4" transform="rotate(20 71 64)"/>
      <path d="M50 51 Q51 60 50 69" stroke-width="1.8"/>
      <circle cx="50" cy="29" r="2.2" fill="currentColor"/>
    </svg>`,
  },
  {
    id: "fruto_coco_abierto",
    nombre: "Coco (Mitad con Pulpa, Ojos & Gotas)",
    categoria: "frutos_secos",
    tags: ["coco", "coconut", "cocos", "aceite de coco", "manteca", "acido laurico", "fruto seco"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Corteza exterior rugosa / fibrosa con fibras -->
      <path d="M24 48 C24 72 76 72 76 48 Z" stroke-width="2.8"/>
      <path d="M22 56 L18 58 M25 66 L21 70 M75 56 L79 58 M72 66 L76 70" stroke-width="2"/>
      <!-- Borde de cáscara y pulpa blanca espesa -->
      <ellipse cx="50" cy="48" rx="26" ry="11" stroke-width="2.6"/>
      <ellipse cx="50" cy="48" rx="19" ry="7" stroke-width="2.2"/>
      <ellipse cx="50" cy="48" rx="12" ry="4" stroke-width="1.8" stroke-dasharray="3 2"/>
      <!-- Gotas y salpicaduras de leche/aceite de coco puro -->
      <path d="M50 22 C50 22 42 32 42 38 C42 42 45 44 50 44 C55 44 58 42 58 38 C58 32 50 22 50 22 Z" stroke-width="2.2"/>
      <circle cx="34" cy="32" r="2.5" stroke-width="2"/>
      <circle cx="66" cy="32" r="2.5" stroke-width="2"/>
    </svg>`,
  },
  {
    id: "fruto_mani_cacahuate",
    nombre: "Maní / Cacahuate (Vaina Abierta & Granos)",
    categoria: "frutos_secos",
    tags: ["mani", "cacahuate", "peanut", "arachis", "emoliente", "proteina", "vaina"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Silueta de la vaina con cintura pronunciada -->
      <path d="M48 20 C58 20 65 26 65 36 C65 44 60 48 56 50 C62 53 66 60 66 68 C66 77 58 80 48 80 C38 80 30 77 30 68 C30 60 34 53 40 50 C36 48 31 44 31 36 C31 26 38 20 48 20 Z" stroke-width="2.6"/>
      <!-- Ventana abierta mostrando los dos granos de maní -->
      <ellipse cx="48" cy="35" rx="9" ry="11" stroke-width="2"/>
      <ellipse cx="48" cy="65" rx="10" ry="11" stroke-width="2"/>
      <!-- Textura de cáscara con retícula de rombos -->
      <path d="M33 30 L40 36 M56 36 L63 30 M32 64 L39 70 M57 70 L64 64" stroke-width="1.8"/>
      <circle cx="48" cy="35" r="2" fill="currentColor"/>
      <circle cx="48" cy="65" r="2" fill="currentColor"/>
    </svg>`,
  },
  {
    id: "fruto_pistacho",
    nombre: "Pistacho (Valvas Abiertas & Fruto)",
    categoria: "frutos_secos",
    tags: ["pistacho", "pistacia", "antioxidante", "verde", "fruto seco", "semilla"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Cáscara leñosa izquierda -->
      <path d="M46 22 C28 32 26 64 46 78 C38 62 38 38 46 22 Z" stroke-width="2.6"/>
      <path d="M36 38 C32 48 34 60 40 68" stroke-width="1.8"/>
      <!-- Cáscara leñosa derecha -->
      <path d="M54 22 C72 32 74 64 54 78 C62 62 62 38 54 22 Z" stroke-width="2.6"/>
      <path d="M64 38 C68 48 66 60 60 68" stroke-width="1.8"/>
      <!-- Semilla de pistacho verde central redondeada -->
      <ellipse cx="50" cy="50" rx="9.5" ry="18" stroke-width="2.4"/>
      <!-- Piel fina y hendidura botánica de la semilla -->
      <path d="M48 40 Q53 45 48 60" stroke-width="2"/>
      <path d="M46 34 Q50 30 54 34" stroke-width="1.8"/>
      <circle cx="50" cy="62" r="1.5" fill="currentColor"/>
    </svg>`,
  },
  {
    id: "fruto_macadamia",
    nombre: "Nuez de Macadamia (Cáscara Bivalva & Semilla Esférica)",
    categoria: "frutos_secos",
    tags: ["macadamia", "nuez", "palmitoleico", "rejuvenecedor", "aceite fino", "fruto seco"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Cáscara dura exterior esférica partida -->
      <path d="M24 50 C24 35 36 24 50 24 C65 24 76 35 76 50 C76 65 65 76 50 76 C36 76 24 65 24 50 Z" stroke-width="2.6"/>
      <path d="M22 50 L30 50 M70 50 L78 50" stroke-width="2.4"/>
      <!-- Núcleo esférico cremoso de macadamia -->
      <circle cx="50" cy="50" r="18" stroke-width="2.4"/>
      <!-- Hendidura y brillo del aceite de macadamia -->
      <path d="M46 38 C42 46 42 54 48 62" stroke-width="2.2"/>
      <circle cx="56" cy="44" r="3" stroke-width="1.8"/>
      <circle cx="54" cy="56" r="2" stroke-width="1.6"/>
    </svg>`,
  },
  {
    id: "fruto_semilla_girasol",
    nombre: "Semillas de Girasol (Pipeta Estriada & Grano Pelado)",
    categoria: "frutos_secos",
    tags: ["girasol", "semilla", "pepitas", "helianthus", "vitamina e", "fruto seco"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Semilla completa en cáscara negra estriada -->
      <path d="M40 20 C54 30 60 58 48 76 C40 78 32 68 34 50 C36 36 39 24 40 20 Z" stroke-width="2.6"/>
      <line x1="39" y1="26" x2="42" y2="72" stroke-width="2"/>
      <path d="M44 34 C46 44 46 58 44 68" stroke-width="1.8"/>
      <path d="M35 40 C36 50 37 60 38 68" stroke-width="1.8"/>
      <!-- Semilla pelada / pepita clara al lado -->
      <path d="M60 36 C70 44 74 62 66 72 C60 72 56 66 58 54 C59 44 60 38 60 36 Z" stroke-width="2.2"/>
      <line x1="61" y1="42" x2="63" y2="66" stroke-width="1.6" stroke-dasharray="2 2"/>
    </svg>`,
  },
  {
    id: "fruto_semilla_sesamo_ajonjoli",
    nombre: "Semillas de Sésamo / Ajonjolí (Vaina & Semillas)",
    categoria: "frutos_secos",
    tags: ["sesamo", "ajonjoli", "sesamum", "semillas", "calcio", "aceite", "antioxidante"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Cápsula botánica / fruto de sésamo abierta en 4 valvas -->
      <path d="M50 20 L50 48 M42 24 C42 34 46 44 50 48 C54 44 58 34 58 24" stroke-width="2.2"/>
      <!-- Semillas de sésamo con relieve y gotas de aceite -->
      <path d="M50 48 C56 54 58 66 50 72 C44 66 44 54 50 48 Z" stroke-width="2.6"/>
      <path d="M30 52 C36 58 38 70 30 76 C24 70 24 58 30 52 Z" stroke-width="2.4" transform="rotate(-20 30 64)"/>
      <path d="M70 52 C76 58 78 70 70 76 C64 70 64 58 70 52 Z" stroke-width="2.4" transform="rotate(20 70 64)"/>
      <line x1="50" y1="52" x2="50" y2="68" stroke-width="1.8"/>
      <circle cx="50" cy="30" r="2" fill="currentColor"/>
    </svg>`,
  },
  // --- TEXTURAS & FORMAS DE MATERIAS PRIMAS ---
  {
    id: "espuma_nube_burbujas",
    nombre: "Espuma Abundante / Nube de Burbujas",
    categoria: "texturas",
    tags: ["espuma", "burbujas", "foam", "jabon", "shampoo", "limpieza", "tensioactivo", "suave"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Nube de espuma esponjosa -->
      <path d="M28 66 C22 66 20 58 24 52 C22 44 30 38 38 40 C42 32 54 30 62 36 C70 34 78 40 76 48 C82 52 82 62 74 66 Z" stroke-width="2.8"/>
      <!-- Burbujas flotantes superiores -->
      <circle cx="38" cy="24" r="5.5" stroke-width="2.6"/>
      <circle cx="68" cy="22" r="4" stroke-width="2.4"/>
      <circle cx="26" cy="38" r="3.2" stroke-width="2.2"/>
      <circle cx="78" cy="36" r="3" stroke-width="2.2"/>
      <!-- Destellos y detalles internos -->
      <path d="M44 48 Q48 44 54 44" stroke-width="2.2"/>
      <path d="M64 54 Q68 52 70 56" stroke-width="2.2"/>
    </svg>`,
  },
  {
    id: "textura_crema_tarro",
    nombre: "Crema / Pomada / Emulsión Densa",
    categoria: "texturas",
    tags: ["crema", "pomada", "emulsion", "tarro", "textura", "densa", "hidratante", "balsamo"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <path d="M28 54 C28 70 72 70 72 54 L28 54 Z" stroke-width="2.8"/>
      <line x1="24" y1="54" x2="76" y2="54" stroke-width="3"/>
      <path d="M34 54 C34 38 50 32 50 32 C50 32 66 38 66 54" stroke-width="2.6"/>
      <path d="M44 32 C44 24 56 24 56 32" stroke-width="2.4"/>
      <!-- Destello estilo ilustración -->
      <path d="M38 62 Q44 64 48 64" stroke-width="2.2"/>
    </svg>`,
  },
  {
    id: "textura_swirl_crema",
    nombre: "Espiral de Crema / Swirl Suave",
    categoria: "texturas",
    tags: ["crema", "swirl", "textura", "espiral", "untura", "suave", "emulsion"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <path d="M26 68 C32 74 68 74 74 68 C78 60 72 52 64 50 C50 48 38 46 44 36 C48 30 58 30 62 36" stroke-width="2.8"/>
      <path d="M34 58 C38 62 62 62 66 58" stroke-width="2.4"/>
      <circle cx="52" cy="25" r="3.5" stroke-width="2.4"/>
    </svg>`,
  },
  {
    id: "textura_locion_dispensador",
    nombre: "Loción / Fluido / Botella Pump",
    categoria: "texturas",
    tags: ["locion", "fluido", "dispensador", "pump", "dosificador", "serum", "leche"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <rect x="34" y="44" width="32" height="32" rx="7" stroke-width="2.8"/>
      <line x1="42" y1="44" x2="58" y2="44" stroke-width="2.8"/>
      <line x1="50" y1="44" x2="50" y2="32" stroke-width="2.8"/>
      <path d="M40 32 L60 32 M40 32 L34 38" stroke-width="2.8"/>
      <!-- Gotitas dispensadas -->
      <circle cx="28" cy="44" r="2.8" stroke-width="2.2"/>
      <circle cx="24" cy="54" r="2" stroke-width="2"/>
    </svg>`,
  },
  {
    id: "textura_polvo_granulos",
    nombre: "Polvo / Gránulos / Micronizado",
    categoria: "texturas",
    tags: ["polvo", "granulos", "solido", "micronizado", "cristales", "esferas", "talco", "particulas"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <path d="M24 70 C34 54 66 54 76 70 Z" stroke-width="2.8"/>
      <!-- Partículas de polvo de trazo redondeado -->
      <circle cx="50" cy="44" r="3.5" stroke-width="2.4"/>
      <circle cx="38" cy="48" r="3" stroke-width="2.4"/>
      <circle cx="62" cy="48" r="3" stroke-width="2.4"/>
      <circle cx="44" cy="34" r="2.8" stroke-width="2.2"/>
      <circle cx="56" cy="34" r="2.8" stroke-width="2.2"/>
      <circle cx="32" cy="38" r="2.2" stroke-width="2"/>
      <circle cx="68" cy="38" r="2.2" stroke-width="2"/>
      <circle cx="50" cy="24" r="2.5" stroke-width="2.2"/>
    </svg>`,
  },
  {
    id: "textura_cera_panal",
    nombre: "Ceras / Bloque & Panal / Escamas",
    categoria: "texturas",
    tags: ["cera", "panal", "candelilla", "abejas", "carnauba", "bloque", "escamas", "lipido"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <polygon points="50,26 68,36 68,56 50,66 32,56 32,36" stroke-width="2.8"/>
      <polygon points="50,46 68,56 68,76 50,86 32,76 32,56" stroke-width="2.8"/>
      <polygon points="68,36 86,46 86,66 68,76 50,66 50,46" stroke-width="2.4" stroke-dasharray="3 3"/>
    </svg>`,
  },
  {
    id: "textura_cera_gotas_pastillas",
    nombre: "Cera en Pastillas / Perlas",
    categoria: "texturas",
    tags: ["cera", "perlas", "pastillas", "emulsionante", "solido", "esferas"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <ellipse cx="50" cy="40" rx="15" ry="10" stroke-width="2.8"/>
      <ellipse cx="34" cy="62" rx="13" ry="9" stroke-width="2.8"/>
      <ellipse cx="66" cy="62" rx="13" ry="9" stroke-width="2.8"/>
      <path d="M46 38 Q50 36 54 38" stroke-width="2.2"/>
      <path d="M30 60 Q34 58 38 60" stroke-width="2.2"/>
      <path d="M62 60 Q66 58 70 60" stroke-width="2.2"/>
    </svg>`,
  },
  {
    id: "textura_aceite_gota_ondas",
    nombre: "Aceite / Oleoso / Viscosidad",
    categoria: "texturas",
    tags: ["aceite", "oleo", "viscosidad", "gota", "liquido", "graso", "emoliente"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Gota con brillo lateral -->
      <path d="M50 22 C50 22 36 38 36 50 C36 58 42 64 50 64 C58 64 64 58 64 50 C64 38 50 22 50 22 Z" stroke-width="2.8"/>
      <path d="M44 44 C44 54 48 58 50 58" stroke-width="2.4"/>
      <!-- Ondas concéntricas -->
      <ellipse cx="50" cy="72" rx="24" ry="6" stroke-width="2.6"/>
      <ellipse cx="50" cy="78" rx="16" ry="4" stroke-width="2"/>
    </svg>`,
  },
  {
    id: "textura_gel_viscoso",
    nombre: "Gel / Gelificante / Viscosidad Cristalina",
    categoria: "texturas",
    tags: ["gel", "gelificante", "carbopol", "goma", "viscoso", "transparente", "polimero"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <path d="M34 68 C26 58 30 44 42 42 C54 40 50 26 60 26 C70 26 74 42 66 56 C60 64 68 70 58 74 C44 76 38 76 34 68 Z" stroke-width="2.8"/>
      <circle cx="44" cy="52" r="3.5" stroke-width="2.2"/>
      <circle cx="58" cy="44" r="2.8" stroke-width="2.2"/>
      <circle cx="48" cy="64" r="2.5" stroke-width="2"/>
    </svg>`,
  },
  {
    id: "textura_serum_elixir",
    nombre: "Serum / Elixir Concentrado",
    categoria: "texturas",
    tags: ["serum", "elixir", "activo", "gotero", "fluido", "facial", "capilar"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <path d="M40 76 C34 76 32 70 32 56 C32 44 40 36 40 36 L60 36 C60 36 68 44 68 56 C68 70 66 76 60 76 Z" stroke-width="2.8"/>
      <rect x="43" y="26" width="14" height="10" rx="2" stroke-width="2.6"/>
      <path d="M45 26 C45 18 55 18 55 26" stroke-width="2.6"/>
      <!-- Gotita central de activo -->
      <path d="M50 48 C50 48 44 54 44 58 C44 62 47 64 50 64 C53 64 56 62 56 58 C56 54 50 48 50 48 Z" stroke-width="2.2"/>
    </svg>`,
  },
  {
    id: "textura_mantequilla_balsamo",
    nombre: "Manteca / Bálsamo Untuoso",
    categoria: "texturas",
    tags: ["manteca", "karite", "cacao", "balsamo", "untuoso", "solido", "nutritivo"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <polygon points="26,48 50,34 74,48 50,62" stroke-width="2.8"/>
      <polygon points="26,48 50,62 50,78 26,64" stroke-width="2.8"/>
      <polygon points="74,48 50,62 50,78 74,64" stroke-width="2.8"/>
    </svg>`,
  },

  // --- QUÍMICA & FÓRMULAS ---
  {
    id: "molecula_hexagonal",
    nombre: "Molécula & Anillo Aromático",
    categoria: "quimica",
    tags: ["molecula", "hexagonal", "benceno", "sintesis", "quimica", "enlace"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <polygon points="50,24 70,35.5 70,58.5 50,70 30,58.5 30,35.5" fill="none" stroke-width="2.6"/>
      <!-- Dobles enlaces internos de resonancia aromática -->
      <line x1="47" y1="30" x2="65" y2="40" stroke-width="2"/>
      <line x1="65" y1="55" x2="48" y2="65" stroke-width="2"/>
      <line x1="35" y1="55" x2="35" y2="40" stroke-width="2"/>
      <!-- Nodos atómicos bien contrastados -->
      <circle cx="50" cy="24" r="3.5" fill="currentColor"/>
      <circle cx="70" cy="35.5" r="3.5" fill="currentColor"/>
      <circle cx="70" cy="58.5" r="3.5" fill="currentColor"/>
      <circle cx="50" cy="70" r="3.5" fill="currentColor"/>
      <circle cx="30" cy="58.5" r="3.5" fill="currentColor"/>
      <circle cx="30" cy="35.5" r="3.5" fill="currentColor"/>
      <!-- Orbital central de resonancia -->
      <circle cx="50" cy="47" r="10" stroke-width="2" stroke-dasharray="3.5 2.5"/>
    </svg>`,
  },
  {
    id: "atomo_orbitales",
    nombre: "Átomo & Enlaces Cuánticos",
    categoria: "quimica",
    tags: ["atomo", "orbital", "electron", "fisica", "quimica", "energia"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- 3 Orbitales elípticos de electrones -->
      <ellipse cx="50" cy="50" rx="30" ry="12" transform="rotate(30 50 50)" stroke-width="2.4"/>
      <ellipse cx="50" cy="50" rx="30" ry="12" transform="rotate(-30 50 50)" stroke-width="2.4"/>
      <ellipse cx="50" cy="50" rx="30" ry="12" transform="rotate(90 50 50)" stroke-width="2.4"/>
      <!-- Electrones orbitando -->
      <circle cx="73" cy="37" r="2.8" fill="currentColor"/>
      <circle cx="27" cy="37" r="2.8" fill="currentColor"/>
      <circle cx="50" cy="78" r="2.8" fill="currentColor"/>
      <!-- Núcleo atómico central (protones y neutrones) -->
      <circle cx="50" cy="50" r="6.5" stroke-width="2"/>
      <circle cx="48" cy="48" r="2" fill="currentColor"/>
      <circle cx="52" cy="52" r="2" fill="currentColor"/>
    </svg>`,
  },
  {
    id: "cadena_molecular",
    nombre: "Polímero / Cadena Molecular",
    categoria: "quimica",
    tags: ["polimero", "cadena", "enlaces", "adhesivo", "sintesis"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Enlaces dobles y simples en zigzag -->
      <path d="M24 60 L36 40 L50 58 L64 38 L76 50" stroke-width="2.8"/>
      <path d="M38 46 L48 58" stroke-width="2" stroke-dasharray="2 2"/>
      <path d="M52 52 L62 40" stroke-width="2" stroke-dasharray="2 2"/>
      <!-- Grupos funcionales ramificados -->
      <line x1="36" y1="40" x2="36" y2="28" stroke-width="2.4"/>
      <line x1="64" y1="38" x2="64" y2="26" stroke-width="2.4"/>
      <line x1="50" y1="58" x2="50" y2="70" stroke-width="2.4"/>
      <!-- Esferas atómicas -->
      <circle cx="24" cy="60" r="4.5" fill="currentColor"/>
      <circle cx="36" cy="40" r="4.5" fill="currentColor"/>
      <circle cx="50" cy="58" r="4.5" fill="currentColor"/>
      <circle cx="64" cy="38" r="4.5" fill="currentColor"/>
      <circle cx="76" cy="50" r="4.5" fill="currentColor"/>
      <circle cx="36" cy="28" r="3" stroke-width="2"/>
      <circle cx="64" cy="26" r="3" stroke-width="2"/>
      <circle cx="50" cy="70" r="3" stroke-width="2"/>
    </svg>`,
  },
  {
    id: "ph_balanceado",
    nombre: "pH Neutro & Equilibrio Químico",
    categoria: "quimica",
    tags: ["ph", "balance", "acido", "base", "neutro", "alcalino"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Tipografía destacada de pH -->
      <text x="50" y="52" font-family="'Montserrat', sans-serif" font-size="25" font-weight="900" text-anchor="middle" fill="currentColor" stroke="none">pH</text>
      <!-- Arco medidor de escala 0-14 -->
      <path d="M26 68 C32 76 68 76 74 68" stroke-width="2.6"/>
      <line x1="26" y1="68" x2="24" y2="71" stroke-width="2.4"/>
      <line x1="50" y1="74" x2="50" y2="78" stroke-width="2.4"/>
      <line x1="74" y1="68" x2="76" y2="71" stroke-width="2.4"/>
      <!-- Indicador neutro 5.5 / 7.0 -->
      <circle cx="50" cy="66" r="3" fill="currentColor"/>
      <!-- Indicadores de acidez y alcalinidad -->
      <circle cx="28" cy="46" r="3.2" stroke-width="2"/>
      <circle cx="72" cy="46" r="3.2" stroke-width="2"/>
    </svg>`,
  },

  // --- ALQUIMIA & ELEMENTOS ---
  {
    id: "alquimia_quintessence",
    nombre: "Quintaesencia Alquímica",
    categoria: "alquimia",
    tags: ["alquimia", "quintaesencia", "geometria", "sagrada", "pureza", "elixir"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <circle cx="50" cy="50" r="28" stroke-width="2"/>
      <polygon points="50,22 74.2,64 25.8,64" stroke-width="2.2"/>
      <polygon points="50,78 74.2,36 25.8,36" stroke-width="2.2"/>
      <circle cx="50" cy="50" r="4" fill="currentColor"/>
    </svg>`,
  },
  {
    id: "alquimia_fuego",
    nombre: "Elemento Fuego (Calcinación)",
    categoria: "alquimia",
    tags: ["fuego", "alquimia", "calor", "energia", "transformacion"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <polygon points="50,24 74,68 26,68" stroke-width="2.5"/>
      <line x1="50" y1="36" x2="50" y2="58" stroke-width="2.2"/>
      <circle cx="50" cy="62" r="2.5" fill="currentColor"/>
    </svg>`,
  },
  {
    id: "alquimia_agua",
    nombre: "Elemento Agua (Disolución)",
    categoria: "alquimia",
    tags: ["agua", "alquimia", "solvente", "humectante", "liquido", "purificacion"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <polygon points="50,72 26,28 74,28" stroke-width="2.5"/>
      <line x1="50" y1="60" x2="50" y2="38" stroke-width="2.2"/>
      <circle cx="50" cy="34" r="2.5" fill="currentColor"/>
    </svg>`,
  },
  {
    id: "alquimia_aire",
    nombre: "Elemento Aire (Sublimación)",
    categoria: "alquimia",
    tags: ["aire", "alquimia", "sublimacion", "esencia", "volatil", "aroma"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <polygon points="50,24 74,68 26,68" stroke-width="2.5"/>
      <line x1="33" y1="52" x2="67" y2="52" stroke-width="2.4"/>
      <circle cx="50" cy="38" r="3" fill="currentColor"/>
    </svg>`,
  },
  {
    id: "alquimia_tierra",
    nombre: "Elemento Tierra (Precipitación)",
    categoria: "alquimia",
    tags: ["tierra", "alquimia", "mineral", "arcilla", "solido", "arcillas"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <polygon points="50,72 26,28 74,28" stroke-width="2.5"/>
      <line x1="33" y1="44" x2="67" y2="44" stroke-width="2.4"/>
      <circle cx="50" cy="58" r="3" fill="currentColor"/>
    </svg>`,
  },
  {
    id: "simbolo_oro_solar",
    nombre: "Sol / Oro Alquímico (Pureza Prima)",
    categoria: "alquimia",
    tags: ["sol", "oro", "perfeccion", "brillo", "alquimia", "antiage"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <circle cx="50" cy="50" r="26" stroke-width="2.4"/>
      <circle cx="50" cy="50" r="5" fill="currentColor"/>
      <line x1="50" y1="18" x2="50" y2="12" stroke-width="2.2"/>
      <line x1="50" y1="82" x2="50" y2="88" stroke-width="2.2"/>
      <line x1="18" y1="50" x2="12" y2="50" stroke-width="2.2"/>
      <line x1="82" y1="50" x2="88" y2="50" stroke-width="2.2"/>
    </svg>`,
  },
  {
    id: "simbolo_luna_plata",
    nombre: "Luna / Plata Alquímica (Regeneración)",
    categoria: "alquimia",
    tags: ["luna", "plata", "hidratacion", "noche", "alquimia", "calmante"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <path d="M54 26 C40 32 36 60 54 74 C42 70 38 48 54 26 Z" fill="none" stroke-width="2.5"/>
      <circle cx="64" cy="42" r="2.5" fill="currentColor"/>
      <circle cx="62" cy="58" r="2" fill="currentColor"/>
    </svg>`,
  },

  // --- LABORATORIO & INSTRUMENTAL ---
  {
    id: "alambique_destilador",
    nombre: "Alambique / Matraz de Destilación",
    categoria: "laboratorio",
    tags: ["alambique", "destilacion", "extractos", "aceites", "pureza", "laboratorio"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Matraz redondo de ebullición con soporte/mechero -->
      <circle cx="42" cy="56" r="17" stroke-width="2.4"/>
      <path d="M42 39 L42 24" stroke-width="2.4"/>
      <line x1="38" y1="24" x2="46" y2="24" stroke-width="2.8"/>
      <!-- Cuello de cisne y serpentín refrigerante descendente -->
      <path d="M42 24 Q44 18 50 20 L74 36" stroke-width="2.6"/>
      <!-- Tubo condensador exterior con mangueras de reflujo -->
      <rect x="52" y="24" width="18" height="8" rx="2" transform="rotate(34 52 24)" stroke-width="1.8"/>
      <!-- Gotas purificadas recolectadas en matraz receptor -->
      <path d="M72 46 C70 54 66 68 76 72 C80 68 78 56 74 46" stroke-width="2"/>
      <ellipse cx="42" cy="62" rx="12" ry="5" stroke-width="1.8"/>
      <circle cx="42" cy="54" r="2.5" fill="currentColor"/>
      <circle cx="36" cy="58" r="2" fill="currentColor"/>
      <circle cx="73" cy="42" r="2" fill="currentColor"/>
    </svg>`,
  },
  {
    id: "matraz_erlenmeyer",
    nombre: "Matraz Erlenmeyer / Formulación",
    categoria: "laboratorio",
    tags: ["matraz", "erlenmeyer", "reaccion", "quimica", "mezcla", "laboratorio"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Boca y cuello del matraz con reborde -->
      <line x1="43" y1="24" x2="57" y2="24" stroke-width="2.8"/>
      <path d="M46 24 L46 36 L69 68 C72 72 69 76 64 76 L36 76 C31 76 28 72 31 68 L54 36 L54 24" stroke-width="2.6"/>
      <!-- Líneas de graduación volumétrica (ml) -->
      <line x1="48" y1="44" x2="55" y2="44" stroke-width="2"/>
      <line x1="44" y1="52" x2="53" y2="52" stroke-width="2"/>
      <line x1="40" y1="60" x2="51" y2="60" stroke-width="2"/>
      <!-- Nivel de solución química con menisco y burbujas reactivas -->
      <path d="M35 64 Q50 61 65 64" stroke-width="2.2"/>
      <circle cx="46" cy="56" r="2.8" stroke-width="1.8"/>
      <circle cx="55" cy="67" r="3.2" stroke-width="1.8"/>
      <circle cx="42" cy="70" r="2.2" stroke-width="1.6"/>
    </svg>`,
  },
  {
    id: "mortero_pestilo",
    nombre: "Mortero & Pistilo / Molienda",
    categoria: "laboratorio",
    tags: ["mortero", "pistilo", "polvo", "molienda", "farmacia", "incorporacion"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Mortero de porcelana con pico vertedor y base plana -->
      <path d="M26 46 C26 66 74 66 74 46 L26 46 Z" stroke-width="2.6"/>
      <path d="M24 46 L21 44 L26 46" stroke-width="2.4"/>
      <path d="M36 66 L34 72 L66 72 L64 66" stroke-width="2.4"/>
      <line x1="26" y1="46" x2="74" y2="46" stroke-width="2"/>
      <!-- Mano / pistilo ergonómico en ángulo de molienda -->
      <path d="M64 22 C68 22 70 26 67 30 L48 54 C45 57 41 57 39 53 C37 49 39 45 42 43 L60 23 C61 22 63 22 64 22 Z" stroke-width="2.4"/>
      <!-- Partículas de molienda fina en el fondo -->
      <circle cx="46" cy="58" r="2.2" fill="currentColor"/>
      <circle cx="54" cy="58" r="2.2" fill="currentColor"/>
      <circle cx="50" cy="53" r="1.8" fill="currentColor"/>
    </svg>`,
  },
  {
    id: "gotero_pipeta",
    nombre: "Gotero / Dosificación Precisa",
    categoria: "laboratorio",
    tags: ["gotero", "pipeta", "precision", "dosificacion", "serum", "activo"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Bulbo de goma de succión superior -->
      <path d="M60 22 C66 18 74 26 68 32 L58 42 L50 34 Z" stroke-width="2.4"/>
      <line x1="52" y1="36" x2="56" y2="40" stroke-width="2.6"/>
      <!-- Tubo de vidrio graduado con marcas de volumen -->
      <path d="M54 38 L36 56 L32 68 L44 64 L62 46" stroke-width="2.4"/>
      <line x1="46" y1="48" x2="49" y2="51" stroke-width="2"/>
      <line x1="42" y1="52" x2="45" y2="55" stroke-width="2"/>
      <line x1="38" y1="56" x2="41" y2="59" stroke-width="2"/>
      <!-- Punta capilar y gota esférica cayendo con onda -->
      <line x1="32" y1="68" x2="28" y2="72" stroke-width="2.6"/>
      <path d="M25 78 C25 78 21 82 21 85 C21 87 23 89 25 89 C27 89 29 87 29 85 C29 82 25 78 25 78 Z" stroke-width="2.2"/>
    </svg>`,
  },
  {
    id: "tubo_ensayo",
    nombre: "Tubos de Ensayo / Gradilla de Control",
    categoria: "laboratorio",
    tags: ["tubo", "ensayo", "test", "clinico", "control", "calidad"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Dos tubos de ensayo cruzados o en paralelo con soporte -->
      <rect x="36" y="24" width="14" height="46" rx="7" stroke-width="2.4"/>
      <line x1="33" y1="24" x2="53" y2="24" stroke-width="2.6"/>
      <rect x="54" y="30" width="14" height="40" rx="7" stroke-width="2.4"/>
      <line x1="51" y1="30" x2="71" y2="30" stroke-width="2.6"/>
      <!-- Líquido y aforo con marcas -->
      <path d="M36 50 Q43 48 50 50" stroke-width="2"/>
      <path d="M54 54 Q61 52 68 54" stroke-width="2"/>
      <line x1="38" y1="40" x2="42" y2="40" stroke-width="1.8"/>
      <line x1="38" y1="45" x2="42" y2="45" stroke-width="1.8"/>
      <circle cx="43" cy="58" r="2.2" fill="currentColor"/>
      <circle cx="61" cy="62" r="2.2" fill="currentColor"/>
      <!-- Base de gradilla de laboratorio -->
      <line x1="28" y1="74" x2="76" y2="74" stroke-width="2.6"/>
    </svg>`,
  },
  {
    id: "microscopio_investigacion",
    nombre: "Microscopio / Grado Científico",
    categoria: "laboratorio",
    tags: ["microscopio", "investigacion", "ciencia", "analisis", "pureza"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Base sólida y pie del microscopio -->
      <path d="M30 76 L70 76 M46 76 L46 64" stroke-width="2.8"/>
      <!-- Brazo curvo estativo -->
      <path d="M46 64 C34 64 34 42 48 40" stroke-width="2.8"/>
      <!-- Tubo óptico con ocular y revólver de objetivos -->
      <rect x="46" y="22" width="13" height="26" transform="rotate(-30 46 22)" stroke-width="2.4" rx="2"/>
      <ellipse cx="61" cy="20" rx="6" ry="3" transform="rotate(-30 61 20)" stroke-width="2.2"/>
      <line x1="42" y1="43" x2="38" y2="50" stroke-width="2.4"/>
      <!-- Platina con pinza y fuente de luz -->
      <line x1="34" y1="56" x2="58" y2="56" stroke-width="2.6"/>
      <circle cx="46" cy="68" r="3" fill="currentColor"/>
    </svg>`,
  },

  // --- COSMÉTICA & BOTÁNICA ---
  {
    id: "hoja_organica",
    nombre: "Extracto Botánico / Origen Natural",
    categoria: "cosmetica",
    tags: ["botanico", "hoja", "natural", "vegano", "organico", "planta"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Hoja botánica con curvatura natural y nervaduras orgánicas -->
      <path d="M28 68 C28 68 31 36 68 30 C68 30 70 64 35 69 Z" stroke-width="2.6"/>
      <path d="M30 67 Q47 50 67 32" stroke-width="2.2"/>
      <path d="M44 54 Q53 52 57 47" stroke-width="2"/>
      <path d="M38 60 Q46 60 50 56" stroke-width="1.8"/>
      <path d="M51 46 Q58 43 62 38" stroke-width="1.8"/>
      <circle cx="68" cy="30" r="1.8" fill="currentColor"/>
    </svg>`,
  },
  {
    id: "espuma_micelar",
    nombre: "Espuma Cremosa / Tensioactivo",
    categoria: "cosmetica",
    tags: ["espuma", "burbujas", "tensioactivo", "limpiador", "shampoo", "jabon"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <circle cx="44" cy="46" r="14" stroke-width="2.4"/>
      <circle cx="62" cy="54" r="10" stroke-width="2.4"/>
      <circle cx="40" cy="64" r="8" stroke-width="2.2"/>
      <circle cx="58" cy="36" r="5.5" stroke-width="2"/>
      <circle cx="38" cy="42" r="2.8" fill="currentColor"/>
      <circle cx="59" cy="52" r="2.2" fill="currentColor"/>
      <path d="M42 40 Q47 38 50 42" stroke-width="1.8"/>
    </svg>`,
  },
  {
    id: "gota_oleosa",
    nombre: "Gota Lipídica / Aceite / Emulsión",
    categoria: "cosmetica",
    tags: ["gota", "aceite", "lipido", "emulsion", "hidratante", "oleo"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <path d="M50 24 C50 24 30 46 30 60 C30 71 39 77 50 77 C61 77 70 71 70 60 C70 46 50 24 50 24 Z" stroke-width="2.6"/>
      <!-- Reflejo curvo interior -->
      <path d="M40 54 C40 64 45 69 50 69" stroke-width="2.2"/>
      <circle cx="58" cy="48" r="2.5" fill="currentColor"/>
    </svg>`,
  },
  {
    id: "flor_esencia",
    nombre: "Esencia Floral / Fragancia",
    categoria: "cosmetica",
    tags: ["flor", "esencia", "fragancia", "perfume", "aroma", "botanico"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <!-- Pétalos con curvatura orgánica botánica -->
      <circle cx="50" cy="50" r="7" stroke-width="2.2"/>
      <path d="M50 43 C44 33 44 23 50 23 C56 23 56 33 50 43 Z" stroke-width="2.2"/>
      <path d="M50 57 C44 67 44 77 50 77 C56 77 56 67 50 57 Z" stroke-width="2.2"/>
      <path d="M43 50 C33 44 23 44 23 50 C23 56 33 56 43 50 Z" stroke-width="2.2"/>
      <path d="M57 50 C67 44 77 44 77 50 C77 56 67 56 57 50 Z" stroke-width="2.2"/>
      <circle cx="50" cy="50" r="3" fill="currentColor"/>
    </svg>`,
  },

  // --- PROPIEDADES & PUREZA ---
  {
    id: "cristal_pureza",
    nombre: "Pureza Cristalina / Alta Concentración",
    categoria: "propiedades",
    tags: ["cristal", "pureza", "concentracion", "diamante", "calidad", "usp"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <polygon points="50,26 74,44 50,74 26,44" stroke-width="2.4"/>
      <line x1="26" y1="44" x2="74" y2="44" stroke-width="2.2"/>
      <line x1="50" y1="26" x2="42" y2="44" stroke-width="2"/>
      <line x1="50" y1="26" x2="58" y2="44" stroke-width="2"/>
      <line x1="42" y1="44" x2="50" y2="74" stroke-width="2"/>
      <line x1="58" y1="44" x2="50" y2="74" stroke-width="2"/>
    </svg>`,
  },
  {
    id: "solubilidad_agua",
    nombre: "Hidrosoluble / Fácil Dispersión",
    categoria: "propiedades",
    tags: ["solubilidad", "agua", "hidrosoluble", "dispersion", "fase"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <path d="M50 30 C50 30 38 45 38 53 C38 60 43 65 50 65 C57 65 62 60 62 53 C62 45 50 30 50 30 Z" stroke-width="2.2"/>
      <circle cx="30" cy="52" r="2.5" fill="currentColor"/>
      <circle cx="70" cy="52" r="2.5" fill="currentColor"/>
      <circle cx="36" cy="68" r="2.5" fill="currentColor"/>
      <circle cx="64" cy="68" r="2.5" fill="currentColor"/>
      <circle cx="50" cy="74" r="2.5" fill="currentColor"/>
    </svg>`,
  },
  {
    id: "antiage_escudo",
    nombre: "Protector Celular / Antioxidante",
    categoria: "propiedades",
    tags: ["escudo", "antioxidante", "antiage", "proteccion", "filtro", "radicales"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <path d="M50 26 L68 34 C68 52 58 66 50 72 C42 66 32 52 32 34 Z" stroke-width="2.4"/>
      <path d="M50 36 L50 62 M40 48 L60 48" stroke-width="2.2"/>
    </svg>`,
  },

  // --- SEGURIDAD & ALMACÉN ---
  {
    id: "frasco_conservacion",
    nombre: "Frasco Hermético / Almacenamiento",
    categoria: "seguridad",
    tags: ["frasco", "almacen", "conservar", "fresco", "sombra", "envase"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <rect x="42" y="24" width="16" height="8" rx="2" stroke-width="2.3"/>
      <rect x="34" y="32" width="32" height="42" rx="6" stroke-width="2.3"/>
      <line x1="40" y1="46" x2="60" y2="46" stroke-width="2"/>
      <line x1="40" y1="54" x2="54" y2="54" stroke-width="2"/>
    </svg>`,
  },
  {
    id: "proteccion_solar_uv",
    nombre: "Protección UV / Proteger de la Luz",
    categoria: "seguridad",
    tags: ["luz", "uv", "fotosensible", "sol", "oscuro", "almacen"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <circle cx="50" cy="50" r="14" stroke-width="2.3"/>
      <line x1="50" y1="26" x2="50" y2="22" stroke-width="2.5"/>
      <line x1="50" y1="78" x2="50" y2="74" stroke-width="2.5"/>
      <line x1="26" y1="50" x2="22" y2="50" stroke-width="2.5"/>
      <line x1="78" y1="50" x2="74" y2="50" stroke-width="2.5"/>
      <line x1="33" y1="33" x2="30" y2="30" stroke-width="2.5"/>
      <line x1="67" y1="67" x2="70" y2="70" stroke-width="2.5"/>
      <line x1="33" y1="67" x2="30" y2="70" stroke-width="2.5"/>
      <line x1="67" y1="33" x2="70" y2="30" stroke-width="2.5"/>
      <line x1="32" y1="68" x2="68" y2="32" stroke-width="2.5" stroke-linecap="round"/>
    </svg>`,
  },
  {
    id: "temperatura_fresca",
    nombre: "Lugar Fresco / Control Térmico",
    categoria: "seguridad",
    tags: ["temperatura", "fresco", "termometro", "refrigeracion", "almacen"],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="50" r="44" stroke-width="2.8"/>
      <path d="M47 30 L53 30 L53 54 C56 56 58 60 58 64 C58 68 54 72 50 72 C46 72 42 68 42 64 C42 60 44 56 47 54 Z" stroke-width="2.3"/>
      <circle cx="50" cy="64" r="4" fill="currentColor"/>
      <line x1="50" y1="46" x2="50" y2="60" stroke-width="2.5"/>
      <line x1="56" y1="36" x2="60" y2="36" stroke-width="2"/>
      <line x1="56" y1="42" x2="60" y2="42" stroke-width="2"/>
      <line x1="56" y1="48" x2="60" y2="48" stroke-width="2"/>
    </svg>`,
  },
];
