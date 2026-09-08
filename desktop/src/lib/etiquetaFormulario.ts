/**
 * Formulario sobre una etiqueta física (p. ej. 76×66 MANTECA DE CACAO):
 * las cajas no se mueven; solo cambia `content` de los textos con
 * `campoProducto`. Los datos salen de las fichas técnicas (YAML/JSON).
 */
import {
  CAMPOS_TEXTO_FICHA_MP,
  type CampoTextoFichaMp,
  type DatosFichaTecnicaMp,
} from "./plantillaFichaTecnicaMp";
import {
  recolorearElemento,
  type ElementoImagen,
  type ElementoTexto,
  type ElementoVisual,
  type PlantillaVisualDoc,
} from "./plantillasVisuales";
import { generarEAN13, svgToDataUrl } from "./ean13";
import { PRESENTACIONES_CONOCIDAS } from "./etiquetasCodigosEan";

export const CAMPOS_ETIQUETA_FISICA: readonly CampoTextoFichaMp[] = [
  "nombre",
  "tagline",
  "concentracionValor",
  "casNumero",
  "ghs",
  "origen",
  "apariencia",
  "olor",
  "composicion",
  "grado",
  "almacenamiento",
  "peso",
];

export function labelCampoEtiqueta(id: string): string {
  const cortos: Record<string, string> = {
    nombre: "NOMBRE",
    tagline: "CATEGORÍA",
    concentracionValor: "CONCENTRACIÓN",
    casNumero: "CAS",
    origen: "ORIGEN",
    apariencia: "APARIENCIA",
    olor: "OLOR",
    composicion: "COMPOSICIÓN",
    grado: "GRADO",
    almacenamiento: "CONSERVACIÓN",
    peso: "CONTENIDO NETO",
    ghs: "GHS",
  };
  return cortos[id] || CAMPOS_TEXTO_FICHA_MP.find((c) => c.id === id)?.label || id;
}

/** Recorta a un máximo de palabras (para casillas chicas con tope duro,
 *  p. ej. "Conservación") — nunca corta a mitad de palabra. */
export function limitarPalabras(texto: string, maxPalabras: number): string {
  const palabras = (texto || "").trim().split(/\s+/).filter(Boolean);
  if (palabras.length <= maxPalabras) return texto;
  return palabras.slice(0, maxPalabras).join(" ");
}

/** Bloques del formulario = la etiqueta: título naranja + valor negro. */
export type BloqueFormularioEtiqueta = {
  id: string;
  titulo: string;
  campo: CampoTextoFichaMp;
  largo?: boolean;
  /** Tope duro de palabras (la casilla es chica y comparte grilla con las
   *  otras 5 — un párrafo largo desborda incluso con autofit). */
  maxPalabras?: number;
};

export const BLOQUES_FICHA_GRID: readonly BloqueFormularioEtiqueta[] = [
  { id: "origen", titulo: "ORIGEN", campo: "origen" },
  { id: "apariencia", titulo: "APARIENCIA", campo: "apariencia", largo: true },
  { id: "olor", titulo: "OLOR", campo: "olor" },
  { id: "composicion", titulo: "COMPOSICIÓN", campo: "composicion", largo: true },
  { id: "grado", titulo: "GRADO", campo: "grado" },
  { id: "conservacion", titulo: "CONSERVACIÓN", campo: "almacenamiento", largo: true, maxPalabras: 10 },
];

export const BLOQUES_SPECS: readonly BloqueFormularioEtiqueta[] = [
  { id: "concentracion", titulo: "CONCENTRACIÓN", campo: "concentracionValor" },
  { id: "cas", titulo: "CAS", campo: "casNumero" },
  { id: "ghs", titulo: "GHS", campo: "ghs" },
];

/** Tope de palabras por campo (derivado de los bloques) — se aplica también
 *  al cargar una ficha técnica, no solo al escribir a mano en el formulario. */
const MAX_PALABRAS_POR_CAMPO: Partial<Record<CampoTextoFichaMp, number>> = Object.fromEntries(
  [...BLOQUES_FICHA_GRID, ...BLOQUES_SPECS]
    .filter((b): b is BloqueFormularioEtiqueta & { maxPalabras: number } => Boolean(b.maxPalabras))
    .map((b) => [b.campo, b.maxPalabras]),
);

export type LogoLinea = {
  id: string;
  label: string;
  hex: string;
  archivo: string;
};

/** Paleta de línea comercial → archivo de logo en Recursos PNG. */
export const PALETA_LOGO_LINEA: readonly LogoLinea[] = [
  { id: "aceites-ceras-grasas", label: "Aceites, ceras y grasas", hex: "#FFA500", archivo: "LOGO AMARILLO.png" },
  { id: "agro", label: "Agro", hex: "#359441", archivo: "logo verde MCKG.png" },
  { id: "alimentario", label: "Alimentario", hex: "#1F91DC", archivo: "LOGO AZUL.png" },
  { id: "cosmetica", label: "Cosmética", hex: "#990099", archivo: "LOGO MORADO.png" },
  { id: "industria", label: "Industria", hex: "#5C6570", archivo: "LOGO GRIS.png" },
  { id: "laboratorio", label: "Laboratorio", hex: "#865E3C", archivo: "LOGO CAFE.png" },
];

export function urlLogoRecurso(archivo: string): string {
  return `/api/etiquetas/recursos-png/archivo/${encodeURIComponent(archivo)}`;
}

export function logoLineaDesdeSrc(src: string): LogoLinea | undefined {
  const decoded = decodeURIComponent(src || "");
  return PALETA_LOGO_LINEA.find((p) => decoded.includes(p.archivo));
}

export function elementoPorRolCapa(
  doc: PlantillaVisualDoc,
  rol: "logo" | "barcode",
): ElementoImagen | undefined {
  return doc.elementos.find(
    (el): el is ElementoImagen => el.type === "image" && el.rolCapa === rol,
  );
}

export function eanDesdeSrcBarcode(src: string): string {
  if (!src || !src.startsWith("data:image/svg+xml")) return "";
  try {
    const comma = src.indexOf(",");
    const meta = src.slice(0, comma);
    const payload = src.slice(comma + 1);
    const svg = meta.includes("base64")
      ? decodeURIComponent(escape(atob(payload)))
      : decodeURIComponent(payload);
    const bits = [...svg.matchAll(/>(\d{1,8})</g)].map((m) => m[1]).join("");
    return bits.replace(/\D/g, "").slice(0, 13);
  } catch {
    return "";
  }
}

export function srcBarcodeDesdeEan(ean: string): string | null {
  const r = generarEAN13(ean);
  return r ? svgToDataUrl(r.svg) : null;
}

interface CodigoEanBuscable {
  nombre_producto: string;
  sku: string;
  codigo: string;
}

function normalizarTextoBusqueda(t: string): string {
  return (t || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Filtra códigos EAN por SKU/nombre/código; usado tanto en el formulario
 *  lateral como en el buscador que se abre al clicar el código de barras
 *  en el lienzo — una sola definición para no divergir. */
export function filtrarCodigosEanPorTexto<T extends CodigoEanBuscable>(
  codigos: T[],
  query: string,
  limite = 8,
): T[] {
  const t = normalizarTextoBusqueda(query);
  if (!t) return codigos.slice(0, limite);
  const partes = t.split(/\s+/).filter(Boolean);
  return codigos
    .filter((c) => {
      const blob = normalizarTextoBusqueda([c.nombre_producto, c.sku, c.codigo].join(" "));
      return partes.every((p) => blob.includes(p));
    })
    .slice(0, limite);
}

function palabrasClave(texto: string): Set<string> {
  const DIACRITICOS = new RegExp("[\\u0300-\\u036f]", "g");
  return new Set(
    (texto || "")
      .normalize("NFD")
      .replace(DIACRITICOS, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4),
  );
}

/**
 * ¿El nombre de la ficha que se va a cargar tiene alguna palabra clave en
 * común con el nombre/título actual de la plantilla? Si no comparten
 * ninguna, cargar esa ficha aquí probablemente es una prueba de OTRO
 * producto sobre este formato — y como `cargarFicha` solo cambia el
 * `content` de los textos (nunca el nombre/id de la plantilla), quien
 * guarde después sobrescribiría en silencio una plantilla ya publicada con
 * datos de un producto distinto, sin que el título de la plantilla en la
 * biblioteca lo refleje. Pasó de verdad: "MANTECA DE CACAO REFINADA 1000g"
 * terminó con todo el contenido de "ALCOHOL CETÍLICO" adentro — el título
 * de la plantilla nunca avisó del cambio. Sin info suficiente en algún lado
 * (nombre muy corto/genérico), no bloquea — mejor un falso negativo que
 * trabar el flujo normal.
 */
export function coincideConNombrePlantilla(nombreFicha: string, nombrePlantilla: string): boolean {
  const a = palabrasClave(nombreFicha);
  const b = palabrasClave(nombrePlantilla);
  if (!a.size || !b.size) return true;
  for (const w of a) {
    if (b.has(w)) return true;
  }
  return false;
}

export function textosConCampoProducto(doc: PlantillaVisualDoc): ElementoTexto[] {
  return (doc.elementos || []).filter(
    (el): el is ElementoTexto => el.type === "text" && Boolean(el.campoProducto),
  );
}

export function camposUsadosEnPlantilla(doc: PlantillaVisualDoc): CampoTextoFichaMp[] {
  const vistos = new Set<string>();
  const out: CampoTextoFichaMp[] = [];
  for (const el of textosConCampoProducto(doc)) {
    const id = el.campoProducto as CampoTextoFichaMp;
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    out.push(id);
  }
  return out;
}

function texto(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function valorEnFilas(filas: unknown, ...claves: string[]): string {
  if (!Array.isArray(filas)) return "";
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  const keys = new Set(claves.map(norm));
  for (const row of filas) {
    if (!Array.isArray(row) || row.length < 2) continue;
    if (keys.has(norm(String(row[0]))) && texto(row[1])) return texto(row[1]);
  }
  return "";
}

function flattenComposicion(raw: unknown): string {
  if (typeof raw === "string") return raw.trim();
  if (!Array.isArray(raw)) return "";
  const nombres: string[] = [];
  for (const row of raw) {
    if (Array.isArray(row) && texto(row[0])) nombres.push(texto(row[0]));
    else if (row && typeof row === "object") {
      const o = row as Record<string, unknown>;
      const n = texto(o.componente || o.nombre || o[0]);
      if (n) nombres.push(n);
    }
  }
  return nombres.join(", ");
}

function pick(...vals: unknown[]): string {
  for (const v of vals) {
    const s = texto(v);
    if (s) return s;
  }
  return "";
}

/** Parte el nombre en 2 líneas al estilo de la etiqueta MANTECA (primeras 2 palabras / resto). */
export function partirNombreEtiqueta(nombre: string): string {
  const t = nombre.trim().replace(/\s+/g, " ");
  if (!t || t.includes("\n")) return t;
  const words = t.split(" ");
  if (words.length <= 2) return t.toUpperCase();
  return `${words.slice(0, 2).join(" ")}\n${words.slice(2).join(" ")}`.toUpperCase();
}

/**
 * Extrae los campos de una etiqueta 76×66 desde una ficha técnica
 * (`datosDesdeFormulario` / YAML de `fichas_word/datos`).
 */
export function camposDesdeFichaTecnica(datos: Record<string, unknown>): Record<string, string> {
  const cf =
    datos.caracteristicas_fisicas && typeof datos.caracteristicas_fisicas === "object"
      ? (datos.caracteristicas_fisicas as Record<string, unknown>)
      : {};
  const ident =
    datos.identificacion && typeof datos.identificacion === "object"
      ? (datos.identificacion as Record<string, unknown>)
      : {};
  const lote =
    datos.lote && typeof datos.lote === "object" && !Array.isArray(datos.lote)
      ? (datos.lote as Record<string, unknown>)
      : {};
  const emp =
    datos.empaque && typeof datos.empaque === "object"
      ? (datos.empaque as Record<string, unknown>)
      : {};
  const coa =
    datos._coa && typeof datos._coa === "object" ? (datos._coa as Record<string, unknown>) : {};
  const coaIdent =
    coa.identificacion && typeof coa.identificacion === "object"
      ? (coa.identificacion as Record<string, unknown>)
      : {};
  const coaLote =
    coa.lote && typeof coa.lote === "object" ? (coa.lote as Record<string, unknown>) : {};

  const nombre = pick(
    datos.nombre_producto,
    datos.titulo,
    ident.nombre_comercial,
    coaIdent.nombre_comercial,
  );
  const grado = pick(datos.grado, ident.grado, coaIdent.grado);
  const cas = pick(datos.cas, ident.cas, coaIdent.cas).replace(/^(CAS\s*#?\s*)/i, "");
  const origen = pick(
    datos.pais_origen,
    lote.pais_origen,
    coaLote.pais_origen,
    valorEnFilas(datos.identidad, "pais de origen", "origen"),
  );
  const apariencia = pick(
    cf.apariencia,
    valorEnFilas(datos.propiedades, "apariencia", "appearance"),
  );
  const olor = pick(cf.olor, valorEnFilas(datos.propiedades, "olor", "odour", "odor"));
  const composicion = flattenComposicion(datos.composicion);
  const almacenamiento = pick(
    datos.almacenamiento,
    emp.almacenamiento,
    Array.isArray(datos.estabilidad) ? (datos.estabilidad as unknown[]).map(texto).filter(Boolean).join(" ") : "",
  );
  const concentracion = pick(datos.concentracion, ident.concentracion, coaIdent.concentracion);
  const peso = pick(datos.presentacion, ident.presentacion, lote.tamano_lote);
  // El GHS solo puede venir de un campo dedicado a clasificación de peligro
  // (nunca de "recomendaciones" de uso — antes, a falta de `ghs`, se tomaba
  // la primera línea de las recomendaciones como si fuera el pictograma,
  // p. ej. "Combina el colágeno con una dieta saludable…" mostrado como
  // GHS). Sin campo explícito, el valor seguro por defecto es "NO GHS".
  const ghsRaw = pick(datos.ghs, datos.ghsCodigo, ident.ghs, coaIdent.ghs);
  const ghs = ghsRaw || "NO GHS";
  const tagline = pick(
    datos.tagline,
    grado ? `MATERIA PRIMA GRADO ${grado.toUpperCase()}` : "",
  );

  const out: Record<string, string> = {};
  if (nombre) out.nombre = partirNombreEtiqueta(nombre);
  if (tagline) out.tagline = tagline.toUpperCase();
  if (concentracion) out.concentracionValor = concentracion;
  if (cas) out.casNumero = cas;
  if (ghs) out.ghs = ghs;
  if (origen) out.origen = origen;
  if (apariencia) out.apariencia = apariencia;
  if (olor) out.olor = olor;
  if (composicion) out.composicion = composicion;
  if (grado) out.grado = grado;
  if (almacenamiento) out.almacenamiento = almacenamiento;
  if (peso) out.peso = peso;
  return out;
}

export function aplicarCamposAPlantilla(
  doc: PlantillaVisualDoc,
  campos: Record<string, string>,
): PlantillaVisualDoc {
  const elementos: ElementoVisual[] = doc.elementos.map((el) => {
    if (el.type === "text" && el.campoProducto && el.campoProducto in campos) {
      const valor = campos[el.campoProducto];
      const max = MAX_PALABRAS_POR_CAMPO[el.campoProducto as CampoTextoFichaMp];
      return { ...el, content: max ? limitarPalabras(valor, max) : valor };
    }
    return el;
  });
  return { ...doc, elementos };
}

/** Colores que nunca se tratan como "acento" al detectar el dominante
 *  (texto de cuerpo en negro/gris, fondos blancos, líneas de contacto…). */
const NEUTROS_ACENTO = new Set([
  "",
  "transparent",
  "none",
  "#fff",
  "#ffffff",
  "white",
  "#000",
  "#000000",
  "black",
]);

/**
 * Color de acento dominante de la plantilla: el más repetido entre
 * colores de texto/línea/relleno, excluyendo neutros. Sirve como "desde"
 * al cambiar la línea del logo — en la práctica casi ninguna plantilla usa
 * el hex exacto de `PALETA_LOGO_LINEA` (todas nacieron con el mismo
 * naranja de marca fijo, #ffa348, sin importar qué logo llevaban), así que
 * no basta con comparar contra el hex de la línea actual del logo.
 */
function colorAcentoDominante(doc: PlantillaVisualDoc): string | null {
  const conteo = new Map<string, number>();
  const sumar = (c?: string) => {
    const k = (c || "").trim().toLowerCase();
    if (!k || NEUTROS_ACENTO.has(k)) return;
    conteo.set(k, (conteo.get(k) ?? 0) + 1);
  };
  for (const el of doc.elementos) {
    if (el.type === "text") sumar(el.color);
    else if (el.type === "line") sumar(el.stroke);
    else if (el.type === "rect") {
      sumar(el.fill);
      sumar(el.stroke);
    }
  }
  let mejor: string | null = null;
  let mejorN = 0;
  for (const [color, n] of conteo) {
    if (n > mejorN) {
      mejor = color;
      mejorN = n;
    }
  }
  return mejor;
}

/** ¿Aparece este hex en algún texto/línea/relleno de la plantilla? Antes de
 *  confiar en el hex de la línea "actual" del logo hay que verificar esto:
 *  si la etiqueta se clonó de una plantilla de otra línea (logo heredado
 *  "Cosmética" pero acento aún en el naranja de marca universal), el logo
 *  SÍ mapea a una línea conocida pero ese hex no es el acento real — sin
 *  esta verificación, `aplicarLogoLinea` cree que ya está en ese color y
 *  el recambio no encuentra nada que recolorear (se ve el logo cambiar
 *  pero bordes/títulos se quedan como estaban). */
function colorUsadoEnElementos(doc: PlantillaVisualDoc, hex: string): boolean {
  const h = hex.trim().toLowerCase();
  return doc.elementos.some((el) => {
    if (el.type === "text") return (el.color || "").trim().toLowerCase() === h;
    if (el.type === "line") return (el.stroke || "").trim().toLowerCase() === h;
    if (el.type === "rect") {
      return (el.fill || "").trim().toLowerCase() === h || (el.stroke || "").trim().toLowerCase() === h;
    }
    return false;
  });
}

/** Cambia el logo Y recolorea todo lo que usaba el acento anterior (bordes,
 *  títulos, líneas, franjas…) al hex de la nueva línea comercial — así la
 *  etiqueta cambia de "vestido" completo, no solo el logo. */
export function aplicarLogoLinea(doc: PlantillaVisualDoc, linea: LogoLinea): PlantillaVisualDoc {
  const src = urlLogoRecurso(linea.archivo);
  const logoActual = doc.elementos.find(
    (el): el is ElementoImagen => el.type === "image" && el.rolCapa === "logo",
  );
  const lineaActual = logoActual ? logoLineaDesdeSrc(logoActual.src) : undefined;
  const desde =
    lineaActual && colorUsadoEnElementos(doc, lineaActual.hex)
      ? lineaActual.hex
      : colorAcentoDominante(doc);
  const hacia = linea.hex;
  const elementos = doc.elementos.map((el) => {
    if (el.type === "image" && el.rolCapa === "logo") return { ...el, src };
    if (desde && desde.toLowerCase() !== hacia.toLowerCase()) {
      return recolorearElemento(el, desde, hacia);
    }
    return el;
  });
  return { ...doc, elementos };
}

/** Contenidos netos que McKenna maneja habitualmente (mismos tamaños que
 *  `PRESENTACIONES_CONOCIDAS` usa para los códigos EAN), en el formato ya
 *  usado en el texto de la etiqueta (p. ej. "1000g", sin espacio). */
export const CONTENIDOS_NETOS_SUGERIDOS: readonly { grupo: "Gramos" | "Mililitros"; valor: string }[] = [
  ...[...PRESENTACIONES_CONOCIDAS].reverse().map((n) => ({ grupo: "Gramos" as const, valor: `${n}g` })),
  ...[...PRESENTACIONES_CONOCIDAS].reverse().map((n) => ({ grupo: "Mililitros" as const, valor: `${n}mL` })),
];

/** Extrae el contenido neto (p. ej. "1000g", "500mL") de un SKU o nombre de
 *  producto tipo "MANTECA DE CACAO REFINADA 1000g" / "SHAROMIX 705 50mL" —
 *  mismo formato que ya usan las etiquetas (número pegado a la unidad). */
export function contenidoNetoDesdeTexto(texto: string): string | null {
  const t = (texto || "").trim();
  if (!t) return null;
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(kg|kilo?s?|g|gr|ml|mL|lt|l)\b/i);
  if (m) {
    const n = parseFloat(m[1].replace(",", "."));
    if (Number.isFinite(n) && n > 0) {
      const unidad = m[2].toLowerCase();
      if (unidad.startsWith("kg") || unidad.startsWith("kilo")) return `${Math.round(n * 1000)}g`;
      if (unidad === "lt" || unidad === "l") return `${Math.round(n * 1000)}mL`;
      if (unidad === "ml") return `${Math.round(n)}mL`;
      return `${Math.round(n)}g`;
    }
  }
  // Sin número explícito (común en el catálogo: "…REFINADA Kg", "BETAINA DE
  // COCO Lt") — el nombre implica una unidad completa.
  if (/\bkg\b/i.test(t) || /\bkilos?\b/i.test(t)) return "1000g";
  if (/\blitros?\b/i.test(t)) return "1000mL";
  return null;
}

export function aplicarBarcodeEan(doc: PlantillaVisualDoc, ean: string): PlantillaVisualDoc {
  const src = srcBarcodeDesdeEan(ean);
  if (!src) return doc;
  return {
    ...doc,
    elementos: doc.elementos.map((el) =>
      el.type === "image" && el.rolCapa === "barcode" ? { ...el, src } : el,
    ),
  };
}

export function valoresActualesFormulario(doc: PlantillaVisualDoc): Record<string, string> {
  const out: Record<string, string> = {};
  for (const el of textosConCampoProducto(doc)) {
    if (el.campoProducto && !(el.campoProducto in out)) {
      out[el.campoProducto] = el.content || "";
    }
  }
  return out;
}

/** Convierte valores del formulario a `DatosFichaTecnicaMp` parcial (lote). */
export function valoresFormularioADatos(
  valores: Record<string, string>,
): Partial<DatosFichaTecnicaMp> {
  const d: Partial<DatosFichaTecnicaMp> = {};
  if (valores.nombre) d.nombre = valores.nombre;
  if (valores.tagline) d.tagline = valores.tagline;
  if (valores.concentracionValor) d.concentracionValor = valores.concentracionValor;
  if (valores.casNumero) d.cas = valores.casNumero;
  if (valores.cas) d.cas = valores.cas;
  if (valores.ghs) d.ghs = valores.ghs;
  if (valores.origen) d.origen = valores.origen;
  if (valores.apariencia) d.apariencia = valores.apariencia;
  if (valores.olor) d.olor = valores.olor;
  if (valores.composicion) d.composicion = valores.composicion;
  if (valores.grado) d.grado = valores.grado;
  if (valores.almacenamiento) d.almacenamiento = valores.almacenamiento;
  if (valores.peso) d.peso = valores.peso;
  if (valores.descripcion) d.descripcion = valores.descripcion;
  return d;
}
