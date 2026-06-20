/** Pictogramas GHS / SGA (Sistema Globalmente Armonizado) — UNECE GHS Rev.9 + símbolo de atención ISO 7010. */

export interface GHSIcono {
  codigo: string;
  nombre: string;
  descripcion: string;
  svg: string;
}

const FRAME = `<polygon points="50,4 96,50 50,96 4,50" fill="white" stroke="#DA291C" stroke-width="6.5" stroke-linejoin="miter"/>`;

/** GHS01 — Explosivo */
const GHS01_SYMBOL = `
  <!-- Cuerpo bomba -->
  <ellipse cx="50" cy="62" rx="14" ry="13" fill="black"/>
  <!-- Mecha -->
  <path d="M50,49 Q58,36 55,26" fill="none" stroke="black" stroke-width="3" stroke-linecap="round"/>
  <!-- Chispa mecha -->
  <circle cx="54" cy="24" r="3.5" fill="black"/>
  <!-- Explosión rayos -->
  <line x1="38" y1="30" x2="43" y2="40" stroke="black" stroke-width="3" stroke-linecap="round"/>
  <line x1="30" y1="38" x2="41" y2="44" stroke="black" stroke-width="3" stroke-linecap="round"/>
  <line x1="62" y1="30" x2="57" y2="40" stroke="black" stroke-width="3" stroke-linecap="round"/>
  <line x1="70" y1="38" x2="59" y2="44" stroke="black" stroke-width="3" stroke-linecap="round"/>
  <line x1="50" y1="26" x2="50" y2="37" stroke="black" stroke-width="3" stroke-linecap="round"/>
`;

/** GHS02 — Inflamable */
const GHS02_SYMBOL = `
  <!-- Llama principal -->
  <path d="M50,73
    C36,68 30,58 34,46
    C31,52 36,54 37,48
    C37,42 43,36 40,28
    C47,36 46,42 50,40
    C54,42 53,36 60,28
    C57,36 63,42 63,48
    C64,54 69,52 66,46
    C70,58 64,68 50,73Z"
    fill="black"/>
`;

/** GHS03 — Comburente (llama sobre círculo) */
const GHS03_SYMBOL = `
  <!-- Círculo -->
  <circle cx="50" cy="70" r="9" fill="none" stroke="black" stroke-width="4"/>
  <!-- Línea base -->
  <line x1="35" y1="70" x2="65" y2="70" stroke="black" stroke-width="4" stroke-linecap="round"/>
  <!-- Llama -->
  <path d="M50,58
    C40,53 36,44 39,35
    C37,40 41,42 42,37
    C42,32 47,27 44,20
    C51,27 50,33 53,31
    C57,33 56,27 63,20
    C60,27 64,32 64,37
    C65,42 69,40 67,35
    C70,44 66,53 50,58Z"
    fill="black"/>
`;

/** GHS04 — Gas a presión */
const GHS04_SYMBOL = `
  <!-- Cuerpo cilindro -->
  <rect x="38" y="38" width="26" height="36" rx="6" fill="black"/>
  <!-- Tapa superior -->
  <rect x="35" y="33" width="32" height="8" rx="3" fill="black"/>
  <!-- Válvula -->
  <rect x="46" y="24" width="8" height="10" rx="2" fill="black"/>
  <!-- Sombrero -->
  <ellipse cx="50" cy="24" rx="7" ry="3.5" fill="black"/>
  <!-- Líneas base -->
  <line x1="38" y1="74" x2="62" y2="74" stroke="black" stroke-width="3" stroke-linecap="round"/>
  <!-- Pie soporte -->
  <rect x="41" y="72" width="18" height="4" rx="2" fill="black"/>
`;

/** GHS05 — Corrosivo */
const GHS05_SYMBOL = `
  <!-- Recipiente izq derramando sobre mano -->
  <rect x="18" y="25" width="22" height="16" rx="2" fill="black"/>
  <path d="M22,41 Q25,50 30,55 Q28,58 26,60 Q30,65 36,60 Q40,55 36,48 Q34,44 29,41Z" fill="black"/>
  <!-- Gotas corrosivas -->
  <ellipse cx="25" cy="38" rx="2" ry="3" fill="black" transform="rotate(-15,25,38)"/>
  <!-- Superficie corroída izq -->
  <path d="M18,62 Q22,58 26,62 Q30,66 34,62 Q38,58 42,62" fill="none" stroke="black" stroke-width="2.5" stroke-linecap="round"/>
  <!-- Tubo/recipiente der sobre superficie -->
  <rect x="58" y="25" width="22" height="14" rx="2" fill="black"/>
  <path d="M62,39 Q65,46 65,52" fill="none" stroke="black" stroke-width="4" stroke-linecap="round"/>
  <!-- Superficie corroída der -->
  <path d="M55,62 Q58,58 62,62 Q66,66 70,62 Q74,58 78,62" fill="none" stroke="black" stroke-width="2.5" stroke-linecap="round"/>
`;

/** GHS06 — Tóxico (calavera y tibias) */
const GHS06_SYMBOL = `
  <!-- Calavera -->
  <ellipse cx="50" cy="42" rx="17" ry="16" fill="black"/>
  <!-- Ojos -->
  <ellipse cx="43" cy="40" rx="5.5" ry="5.5" fill="white"/>
  <ellipse cx="57" cy="40" rx="5.5" ry="5.5" fill="white"/>
  <!-- Nariz -->
  <path d="M47,48 L50,44 L53,48Z" fill="white"/>
  <!-- Mandíbula -->
  <rect x="38" y="54" width="24" height="7" rx="2" fill="black"/>
  <!-- Dientes -->
  <line x1="44" y1="54" x2="44" y2="61" stroke="white" stroke-width="2"/>
  <line x1="50" y1="54" x2="50" y2="61" stroke="white" stroke-width="2"/>
  <line x1="56" y1="54" x2="56" y2="61" stroke="white" stroke-width="2"/>
  <!-- Tibias cruzadas -->
  <line x1="27" y1="68" x2="73" y2="82" stroke="black" stroke-width="5" stroke-linecap="round"/>
  <line x1="27" y1="82" x2="73" y2="68" stroke="black" stroke-width="5" stroke-linecap="round"/>
  <!-- Extremos tibias -->
  <circle cx="25" cy="67" r="5" fill="black"/>
  <circle cx="75" cy="83" r="5" fill="black"/>
  <circle cx="25" cy="83" r="5" fill="black"/>
  <circle cx="75" cy="67" r="5" fill="black"/>
`;

/** GHS07 — Irritante / Nocivo (signo de exclamación) */
const GHS07_SYMBOL = `
  <!-- Cuerpo exclamación -->
  <rect x="45" y="23" width="10" height="38" rx="3" fill="black"/>
  <!-- Punto exclamación -->
  <circle cx="50" cy="72" r="6" fill="black"/>
`;

/** GHS08 — Peligro para la salud (silueta + explosión en pecho) */
const GHS08_SYMBOL = `
  <!-- Cabeza -->
  <circle cx="50" cy="28" r="9" fill="black"/>
  <!-- Torso -->
  <path d="M34,65 C34,50 38,42 50,40 C62,42 66,50 66,65Z" fill="black"/>
  <!-- Brazos -->
  <line x1="34" y1="50" x2="22" y2="62" stroke="black" stroke-width="5" stroke-linecap="round"/>
  <line x1="66" y1="50" x2="78" y2="62" stroke="black" stroke-width="5" stroke-linecap="round"/>
  <!-- Piernas -->
  <line x1="43" y1="65" x2="40" y2="82" stroke="black" stroke-width="5" stroke-linecap="round"/>
  <line x1="57" y1="65" x2="60" y2="82" stroke="black" stroke-width="5" stroke-linecap="round"/>
  <!-- Asterisco pecho (efecto salud) -->
  <line x1="50" y1="44" x2="50" y2="60" stroke="white" stroke-width="3" stroke-linecap="round"/>
  <line x1="42" y1="48" x2="58" y2="56" stroke="white" stroke-width="3" stroke-linecap="round"/>
  <line x1="58" y1="48" x2="42" y2="56" stroke="white" stroke-width="3" stroke-linecap="round"/>
`;

/** GHS09 — Peligroso para el medio ambiente (árbol muerto + pez) */
const GHS09_SYMBOL = `
  <!-- Árbol muerto tronco -->
  <rect x="47" y="55" width="7" height="22" rx="2" fill="black"/>
  <!-- Ramas principales -->
  <line x1="50" y1="55" x2="32" y2="38" stroke="black" stroke-width="4" stroke-linecap="round"/>
  <line x1="50" y1="55" x2="68" y2="38" stroke="black" stroke-width="4" stroke-linecap="round"/>
  <line x1="50" y1="45" x2="36" y2="30" stroke="black" stroke-width="3" stroke-linecap="round"/>
  <line x1="50" y1="45" x2="64" y2="30" stroke="black" stroke-width="3" stroke-linecap="round"/>
  <!-- Suelo -->
  <line x1="38" y1="77" x2="62" y2="77" stroke="black" stroke-width="3" stroke-linecap="round"/>
  <!-- Pez (simplificado) -->
  <ellipse cx="75" cy="63" rx="9" ry="5" fill="black"/>
  <path d="M84,63 L91,56 L91,70Z" fill="black"/>
  <!-- Ojo pez -->
  <circle cx="72" cy="61" r="2" fill="white"/>
`;

function makeGHSSvg(symbol: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${FRAME}${symbol}</svg>`;
}

export const GHS_ICONOS: GHSIcono[] = [
  {
    codigo: "GHS01",
    nombre: "Explosivo",
    descripcion: "Explosivos inestables, artículos explosivos, sustancias con riesgo de masa explosiva.",
    svg: makeGHSSvg(GHS01_SYMBOL),
  },
  {
    codigo: "GHS02",
    nombre: "Inflamable",
    descripcion: "Gases, aerosoles, líquidos, sólidos inflamables. Sustancias que reaccionan espontáneamente.",
    svg: makeGHSSvg(GHS02_SYMBOL),
  },
  {
    codigo: "GHS03",
    nombre: "Comburente",
    descripcion: "Gases, líquidos o sólidos oxidantes. Pueden intensificar el fuego.",
    svg: makeGHSSvg(GHS03_SYMBOL),
  },
  {
    codigo: "GHS04",
    nombre: "Gas a presión",
    descripcion: "Gases comprimidos, licuados, disueltos o refrigerados. Peligro de explosión por calor.",
    svg: makeGHSSvg(GHS04_SYMBOL),
  },
  {
    codigo: "GHS05",
    nombre: "Corrosivo",
    descripcion: "Corrosivo para metales. Causa quemaduras graves en piel y daños oculares graves.",
    svg: makeGHSSvg(GHS05_SYMBOL),
  },
  {
    codigo: "GHS06",
    nombre: "Tóxico",
    descripcion: "Toxicidad aguda (oral, dérmica, inhalación) — categorías 1, 2 y 3. Puede ser mortal.",
    svg: makeGHSSvg(GHS06_SYMBOL),
  },
  {
    codigo: "GHS07",
    nombre: "Irritante / Nocivo",
    descripcion: "Toxicidad aguda categoría 4. Irritación cutánea, ocular, sensibilización cutánea, toxicidad para órganos.",
    svg: makeGHSSvg(GHS07_SYMBOL),
  },
  {
    codigo: "GHS08",
    nombre: "Peligro para la salud",
    descripcion: "Carcinogénesis, mutagenicidad, toxicidad reproductiva, sensibilización respiratoria, toxicidad sistémica.",
    svg: makeGHSSvg(GHS08_SYMBOL),
  },
  {
    codigo: "GHS09",
    nombre: "Medio ambiente",
    descripcion: "Peligroso para el medio ambiente acuático (agudo y crónico). Bioacumulación.",
    svg: makeGHSSvg(GHS09_SYMBOL),
  },
];
