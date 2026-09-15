/**
 * Corrección ortográfica del módulo de etiquetas.
 *
 * Dos capas, porque ninguna sola alcanza:
 *
 * 1. **Corrector del navegador** (`spellCheck` + `lang="es"` en las casillas
 *    de texto): subraya en rojo y ofrece sugerencias al clic derecho mientras
 *    se escribe. Cubre cualquier palabra del español, pero solo en la casilla
 *    que se está editando, no avisa nada al imprimir, y no sabe corregir en
 *    bloque. Se apaga en las casillas que no son prosa (CAS, EAN, fórmula
 *    química, web, correo, teléfono): ahí todo saldría subrayado y el
 *    operador aprendería a ignorar el subrayado — que es peor que no tenerlo.
 *
 * 2. **Esta revisión** (`revisarOrtografiaEtiqueta`): recorre TODAS las
 *    casillas de la etiqueta a la vez, incluidas las que nadie tocó porque
 *    llegaron de la ficha técnica, y corrige en un clic. Ataca el error que
 *    de verdad aparece en estas etiquetas: **la tilde que se pierde**
 *    ("ACIDO CITRICO", "CAPSULAS", "conservacion"). Se pierde porque el
 *    nombre se escribe en mayúsculas (el `text-transform: uppercase` es del
 *    CSS, el dato se guarda como se escribió) y porque los datos entran
 *    copiados de fichas y catálogos de proveedores.
 *
 * Sin diccionario descargado y sin LLM: son reglas deterministas sobre una
 * lista cerrada de palabras del dominio. Es a propósito — un corrector de
 * verdad marcaría media etiqueta (los nombres químicos no están en ningún
 * diccionario) y una etiqueta impresa mal cuesta el rollo completo.
 */
import type { ProductLabelData } from "../components/etiqueta-ficha/productLabelTypes";

// ─────────────────────────────────────────────────────────────────────────────
// Capa 1 · qué casillas revisa el navegador
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Casillas donde el corrector del navegador estorba: no son prosa, así que
 * cada valor legítimo saldría subrayado. La clave es el `styleKey` del campo
 * (= el nombre del dato), compartido por `EditableField` y `CampoEtiqueta`.
 */
const CAMPOS_SIN_CORRECTOR = new Set<string>([
  "cas",
  "casTitulo",
  "barcode",
  "barcodeTitle",
  "concentration",
  "netContent",
  "composition", // fórmula molecular / lista de ácidos grasos
  "compositionTitulo",
  "website",
  "email",
  "phone",
  "ghs",
  "technicalDocuments",
  "cucharaCantidad",
  "cucharaUnidad",
  "esloganLogo",
]);

/** ¿Esta casilla la revisa el corrector del navegador? */
export function campoRevisaOrtografia(styleKey: string): boolean {
  return !CAMPOS_SIN_CORRECTOR.has(styleKey);
}

// ─────────────────────────────────────────────────────────────────────────────
// Capa 2 · revisión propia antes de imprimir
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Palabras del dominio en su forma correcta.
 *
 * **Regla para agregar una:** solo entra si su versión sin tilde NO es otra
 * palabra válida del español. Por eso no están "más" (mas), "está" (esta),
 * "sí" (si), "té" (te), "sólo", "papá" ni "sabía": corregirlas a ciegas
 * cambiaría el sentido de una frase correcta. "acido", "capsula" y
 * "conservacion" no son palabras, así que corregirlas es seguro.
 */
const PALABRAS_CON_TILDE: readonly string[] = [
  // Química y nomenclatura
  "ácido", "ácidos", "ácida", "ácidas", "álcali", "anhídrido",
  "óxido", "óxidos", "hidróxido", "hidróxidos", "peróxido", "dióxido",
  "cítrico", "cítrica", "málico", "láctico", "láctica", "ascórbico",
  "salicílico", "glicólico", "hialurónico", "pantoténico", "fólico",
  "tánico", "sórbico", "fosfórico", "sulfúrico", "clorhídrico", "nítrico",
  "acético", "butírico", "cáprico", "caprílico", "mirístico", "behénico",
  "gálico", "elágico", "esteárico", "palmítico", "fenólico",
  "sódico", "sódica", "potásico", "cálcico", "magnésico", "férrico",
  "molécula", "moléculas", "átomo", "átomos", "polímero", "monómero",
  "glucósido", "glucósidos", "polisacárido", "aminoácido", "aminoácidos",
  "péptido", "péptidos", "éster", "ésteres", "éter", "glicérido",
  "triglicérido", "lípido", "lípidos",
  // Estado, apariencia y manejo
  "líquido", "líquida", "líquidos", "sólido", "sólida", "sólidos",
  "cápsula", "cápsulas", "lámina", "láminas", "película", "cáscara",
  "cáscaras", "mucílago", "traslúcido", "higroscópico", "estéril",
  "tóxico", "tóxica", "frío", "fría", "cálido", "húmedo", "húmeda",
  "sequía", "aromático", "aromática", "orgánico", "orgánica", "inorgánico",
  "básico", "básica",
  // Vocabulario de la etiqueta y la ficha
  "fórmula", "fórmulas", "información", "conservación", "clasificación",
  "composición", "presentación", "aplicación", "aplicaciones",
  "fabricación", "manipulación", "refrigeración", "ventilación",
  "ignición", "exposición", "solución", "disolución", "suspensión",
  "emulsión", "hidratación", "protección", "descripción", "indicación",
  "indicaciones", "precaución", "precauciones", "identificación",
  "certificación", "elaboración", "importación", "distribución",
  "producción", "nutrición", "digestión", "absorción", "oxidación",
  "degradación", "concentración", "proporción", "irritación", "versión",
  "revisión", "emisión", "prohibición", "utilización", "observación",
  "verificación", "autorización", "notificación", "región",
  "alérgeno", "alérgenos", "alérgico", "alérgica",
  "técnico", "técnica", "técnicos", "técnicas", "específico", "específica",
  "característico", "característica", "características", "físico", "física",
  "químico", "química", "químicos", "químicas", "biológico", "biológica",
  "microbiológico", "farmacológico", "terapéutico", "farmacéutico",
  "farmacéutica", "cosmético", "cosmética", "cosméticos", "cosméticas",
  "vitamínico", "proteína", "proteínas", "caseína", "alantoína",
  "almidón", "colágeno", "energía", "calorías",
  // Cantidades, lugar y tiempo
  "mínimo", "mínima", "máximo", "máxima", "número", "números", "teléfono",
  "teléfonos", "dirección", "ubicación", "almacén", "envío", "envíos",
  "país", "países", "día", "días", "después", "según", "también",
  "último", "última", "único", "única", "únicamente", "próximo", "así",
  // Productos e insumos
  "maní", "plátano", "arándano", "arándanos", "almíbar", "cúrcuma",
  "pimentón", "ajonjolí", "sésamo", "azúcar", "carbón", "café", "Bogotá",
];

/** sin tilde y en minúscula → forma correcta. */
const CANONICAS: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const p of PALABRAS_CON_TILDE) m.set(sinTildes(p).toLowerCase(), p);
  return m;
})();

export function sinTildes(t: string): string {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Pasa a `canonica` el uso de mayúsculas de `original` ("ACIDO" → "ÁCIDO"). */
function aplicarCaso(original: string, canonica: string): string {
  if (original === original.toUpperCase()) return canonica.toUpperCase();
  if (original[0] === original[0]?.toUpperCase()) {
    return canonica[0].toUpperCase() + canonica.slice(1);
  }
  return canonica;
}

export type MotivoOrtografia = "tilde" | "espacios" | "repetida";

export interface HallazgoOrtografia {
  /** Lo que está escrito. */
  original: string;
  /** Cómo debería quedar. */
  sugerencia: string;
  motivo: MotivoOrtografia;
}

const PALABRA = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/g;

/**
 * Hallazgos de un texto. No modifica nada — `corregirTexto` aplica lo mismo.
 * Cada hallazgo se reporta una sola vez por palabra distinta, que una lista de
 * 14 veces "ACIDO" no se lee.
 */
export function revisarTexto(texto: string): HallazgoOrtografia[] {
  const t = texto || "";
  const out: HallazgoOrtografia[] = [];
  const vistos = new Set<string>();
  const agregar = (h: HallazgoOrtografia) => {
    const clave = `${h.motivo}·${h.original}`;
    if (vistos.has(clave)) return;
    vistos.add(clave);
    out.push(h);
  };

  // Tildes perdidas
  for (const m of t.matchAll(PALABRA)) {
    const palabra = m[0];
    const canonica = CANONICAS.get(sinTildes(palabra).toLowerCase());
    if (!canonica) continue;
    const esperada = aplicarCaso(palabra, canonica);
    if (palabra !== esperada) agregar({ original: palabra, sugerencia: esperada, motivo: "tilde" });
  }

  // Espacios: dobles, y espacio antes de coma o punto. El espacio ANTES del
  // «%» no se toca: en español «100 %» es la forma correcta.
  if (/ {2,}/.test(t)) agregar({ original: "espacios dobles", sugerencia: "un solo espacio", motivo: "espacios" });
  if (/\s+[,.;:]/.test(t)) {
    agregar({ original: "espacio antes de , o .", sugerencia: "sin espacio antes", motivo: "espacios" });
  }
  // Coma sin espacio después, solo entre letras — «1,5 kg» y «www.` quedan fuera.
  if (/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ],[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(t)) {
    agregar({ original: "coma sin espacio", sugerencia: "espacio después de la coma", motivo: "espacios" });
  }

  // Palabra repetida seguida ("de de", "en en")
  const rep = /\b([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,})\s+\1\b/gi;
  for (const m of t.matchAll(rep)) {
    agregar({ original: `${m[1]} ${m[1]}`, sugerencia: m[1], motivo: "repetida" });
  }

  return out;
}

/** El mismo texto con todo lo anterior corregido. */
export function corregirTexto(texto: string): string {
  let t = (texto || "").replace(PALABRA, (palabra) => {
    const canonica = CANONICAS.get(sinTildes(palabra).toLowerCase());
    return canonica ? aplicarCaso(palabra, canonica) : palabra;
  });
  t = t.replace(/\b([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,})(\s+)\1\b/gi, "$1");
  t = t.replace(/[ \t]{2,}/g, " ");
  t = t.replace(/[ \t]+([,.;:])/g, "$1");
  t = t.replace(/([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]),([A-Za-zÁÉÍÓÚÜÑáéíóúüñ])/g, "$1, $2");
  return t;
}

/** Casillas de prosa que se revisan, con el nombre que ve el operador. */
const CAMPOS_REVISADOS: readonly { campo: keyof ProductLabelData; titulo: string }[] = [
  { campo: "productName", titulo: "Nombre del producto" },
  { campo: "classification", titulo: "Clasificación" },
  { campo: "clasificacionTexto", titulo: "Clasificación SGA" },
  { campo: "grade", titulo: "Grado" },
  { campo: "gradoInsumo", titulo: "Grado del insumo" },
  { campo: "origin", titulo: "Origen" },
  { campo: "appearance", titulo: "Apariencia" },
  { campo: "odor", titulo: "Aroma" },
  { campo: "storage", titulo: "Conservación" },
  { campo: "alergenos", titulo: "Alérgenos" },
  { campo: "city", titulo: "Ciudad" },
];

export interface CampoOrtografia {
  campo: keyof ProductLabelData;
  titulo: string;
  valor: string;
  corregido: string;
  hallazgos: HallazgoOrtografia[];
}

/** Las casillas de la etiqueta que tienen algo que corregir. */
export function revisarOrtografiaEtiqueta(data: ProductLabelData): CampoOrtografia[] {
  const out: CampoOrtografia[] = [];
  for (const { campo, titulo } of CAMPOS_REVISADOS) {
    const valor = ((data as unknown as Record<string, unknown>)[campo] as string | undefined) || "";
    if (!valor.trim()) continue;
    const hallazgos = revisarTexto(valor);
    if (!hallazgos.length) continue;
    const corregido = corregirTexto(valor);
    if (corregido === valor) continue;
    out.push({ campo, titulo, valor, corregido, hallazgos });
  }
  return out;
}

/** Parche con todas las casillas corregidas, para un solo `onChange`. */
export function parcheOrtografia(campos: CampoOrtografia[]): Partial<ProductLabelData> {
  const patch: Record<string, string> = {};
  for (const c of campos) patch[c.campo as string] = c.corregido;
  return patch as Partial<ProductLabelData>;
}
