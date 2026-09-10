/**
 * Categorías de producto de las etiquetas: primer nivel de Studio visual.
 *
 * Lista PROPIA del módulo de etiquetas (decisión del 2026-09-10): a
 * propósito NO reusa las líneas/subcategorías de `proveedores_db`, porque
 * aquello clasifica el catálogo comercial y esto agrupa etiquetas por cómo
 * se diseñan.
 *
 * El catálogo vive en el servidor (`GET|PUT /api/etiquetas/categorias`,
 * app/tools/etiquetas_categorias.py) para que el operador pueda crear
 * categorías nuevas. La lista de abajo es la SEMILLA con la que se creó y
 * el respaldo si el endpoint no responde — no la fuente de verdad: usa
 * `useCategoriasEtiqueta()`.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export interface CategoriaEtiqueta {
  id: string;
  etiqueta: string;
  claves: string[];
}

/** Se recorre EN ORDEN: la primera que coincida gana, así que lo específico
 *  ("aceite esencial") tiene que ir antes que lo genérico ("aceite"). */
export const CATEGORIAS_ETIQUETA: CategoriaEtiqueta[] = [
  { id: "fragancias", etiqueta: "Fragancias", claves: ["fragancia", "perfume", "aroma lipo", "aroma hidro"] },
  { id: "aceites-esenciales", etiqueta: "Aceites esenciales", claves: ["aceite esencial", "esencial ", "esencia de", "oleorresina"] },
  { id: "aceites", etiqueta: "Aceites y grasas", claves: ["aceite", "oleo", "grasa vegetal", "trigliceridos"] },
  { id: "ceras-mantecas", etiqueta: "Ceras y mantecas", claves: ["cera ", "manteca", "karite", "butter", "parafina", "vaselina", "lanolina", "cetilico", "cetearilico", "estearilico", "alcohol graso"] },
  { id: "extractos", etiqueta: "Extractos vegetales", claves: ["extracto", "tintura", "polvo de hoja", "hidrolato", "agua de "] },
  { id: "frutos-secos", etiqueta: "Frutos secos", claves: ["mani", "almendra", "nuez", "marañon", "maranon", "pistacho", "avellana", "uva pasa", "ciruela", "arandano"] },
  { id: "deshidratados", etiqueta: "Deshidratados y hongos", claves: ["deshidratad", "orellana", "flor de jamaica", "hongo", "champinon", "seco", "seca"] },
  { id: "semillas", etiqueta: "Semillas", claves: ["semilla", "chia", "linaza", "ajonjoli", "sesamo", "quinua", "amapola", "girasol"] },
  { id: "cereales-harinas", etiqueta: "Cereales y harinas", claves: ["harina", "avena", "salvado", "almidon", "fecula", "maiz", "arroz"] },
  { id: "vitaminas", etiqueta: "Vitaminas y suplementos", claves: ["vitamina", "ascorbico", "tocoferol", "retinol", "niacinamida", "biotina", "acido folico", "cianocobalamina", "colecalciferol", "pantenol", "melatonina"] },
  { id: "sales-minerales", etiqueta: "Sales minerales", claves: ["citrato", "gluconato", "bisglicinato", "quelato", "lactato de", "sulfato de magnesio", "cloruro de magnesio", "carbonato de calcio", "oxido de zinc", "oxido de magnesio", "mineral"] },
  { id: "sales", etiqueta: "Sales y ácidos inorgánicos", claves: ["bicarbonato", "carbonato", "cloruro", "sulfato", "fosfato", "nitrato", "hidroxido", "soda caustica", "alumbre", "molibdato", "cremor tartaro", "azufre", "lactato", "sal "] },
  { id: "acidos", etiqueta: "Ácidos orgánicos", claves: ["acido citrico", "acido lactico", "acido malico", "acido tartarico", "acido salicilico", "acido glicolico", "acido"] },
  { id: "aminoacidos-proteinas", etiqueta: "Aminoácidos y proteínas", claves: ["colageno", "proteina", "arginina", "glicina", "lisina", "creatina", "taurina", "glutamina", "carnitina", "citrulina", "fenilalanina", "ornitina", "prolina", "teanina", "triptofano", "metionina", "aminoacido", "peptido", "keratina", "queratina", "elastina"] },
  { id: "enzimas", etiqueta: "Enzimas y fermentos", claves: ["enzima", "papaina", "bromelina", "amilasa", "proteasa", "lipasa", "lactasa", "probiotico", "fermento", "levadura"] },
  { id: "conservantes", etiqueta: "Conservantes", claves: ["conservante", "sharomix", "benzoato", "sorbato", "fenoxietanol", "parabeno", "geogard", "cosgard", "propionato", "glutaraldehido"] },
  { id: "aditivos", etiqueta: "Aditivos alimentarios", claves: ["aditivo", "antiaglomerante", "antioxidante", "acidulante", "regulador de acidez", "potenciador", "saborizante", "colorante", "edulcorante", "estevia", "sucralosa", "eritritol", "sorbitol", "xilitol", "maltitol"] },
  { id: "gelificantes", etiqueta: "Gelificantes y espesantes", claves: ["goma", "xantan", "xantana", "guar", "carragenina", "pectina", "gelatina", "agar", "carbomer", "carbopol", "espesante", "gelificante", "alginato", "celulosa", "inulina", "fibra"] },
  { id: "emulsificantes", etiqueta: "Emulsificantes", claves: ["emulsificante", "emulsionante", "polawax", "cera autoemulsionante", "lecitina", "polisorbato", "tween", "span ", "monoestearato", "olivem"] },
  { id: "tensoactivos", etiqueta: "Tensoactivos", claves: ["tensoactivo", "tensosil", "betaina", "lauril", "laureth", "coco glucosido", "cocamidopropil", "cocoamida", "btms", "sci ", "isetionato", "nonilfenol", "jabon", "sles", "sls"] },
  { id: "solventes", etiqueta: "Solventes", claves: ["solvente", "alcohol", "etanol", "isopropilico", "glicerina", "propilenglicol", "butilenglicol", "acetona", "thinner", "varsol", "dpg", "agua destilada", "agua destilda", "dmso"] },
  { id: "arcillas", etiqueta: "Arcillas y minerales", claves: ["arcilla", "bentonita", "caolin", "kaolin", "talco", "silice", "silica", "diatomea", "zeolita", "carbon activado"] },
  { id: "excipientes", etiqueta: "Excipientes y cápsulas", claves: ["capsula", "excipiente", "estearato de magnesio", "dioxido de silicio", "celulosa microcristalina", "aglutinante", "desintegrante", "pastillero"] },
  { id: "colorantes-reactivos", etiqueta: "Colorantes y reactivos", claves: ["azul de metileno", "verde malaquita", "violeta de genciana", "fucsina", "reactivo", "indicador"] },
  { id: "activos-cosmeticos", etiqueta: "Activos cosméticos", claves: ["hialuronico", "retinal", "peptidos", "coenzima", "argireline", "matrixyl", "urea", "alantoina", "aloe", "bisabolol", "arbutina", "cafeina", "mentol", "embrion", "gusano de seda", "baba de caracol"] },
  { id: "quimicos-industriales", etiqueta: "Químicos industriales", claves: ["resina", "epoxi", "poliuretano", "catalizador", "endurecedor", "pigmento industrial"] },
  { id: "otros", etiqueta: "Otros", claves: [] },
];

/** Id de la categoría de respaldo cuando no se reconoce el producto. */
export const CATEGORIA_ETIQUETA_OTROS = "otros";

const _POR_ID = new Map(CATEGORIAS_ETIQUETA.map((c) => [c.id, c]));

/** minúsculas, sin tildes, espacios colapsados — igual criterio que el resto del sistema. */
function normalizar(texto: string): string {
  return (texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Nombre visible de una categoría (o el id crudo si ya no existe en la lista). */
export function etiquetaCategoria(id: string | undefined | null): string {
  if (!id) return "";
  return _POR_ID.get(id)?.etiqueta ?? id;
}

/**
 * Deduce la categoría a partir del nombre del producto del SKU.
 * Devuelve "otros" cuando ninguna palabra clave coincide — nunca adivina.
 */
export function detectarCategoriaEtiqueta(nombreProducto: string): string {
  const texto = ` ${normalizar(nombreProducto)} `;
  if (texto.trim().length === 0) return CATEGORIA_ETIQUETA_OTROS;
  for (const cat of CATEGORIAS_ETIQUETA) {
    for (const clave of cat.claves) {
      if (texto.includes(normalizar(clave))) return cat.id;
    }
  }
  return CATEGORIA_ETIQUETA_OTROS;
}

/** Id reservado de la plantilla global (la que había antes de las categorías). */
export const PLANTILLA_FICHA_ID = "__plantilla__";

/** Id reservado de la plantilla de una categoría concreta. */
export function idPlantillaCategoria(categoriaId: string): string {
  return `${PLANTILLA_FICHA_ID}:${categoriaId}`;
}

/** Categoría de un id de plantilla, o null si no es una plantilla de categoría. */
export function categoriaDeIdPlantilla(id: string): string | null {
  if (!id.startsWith(`${PLANTILLA_FICHA_ID}:`)) return null;
  return id.slice(PLANTILLA_FICHA_ID.length + 1) || null;
}

/** true para la plantilla global y para cualquier plantilla de categoría. */
export function esIdPlantillaFicha(id: string): boolean {
  return id === PLANTILLA_FICHA_ID || id.startsWith(`${PLANTILLA_FICHA_ID}:`);
}


export const QK_CATEGORIAS_ETIQUETA = ["etiquetas-categorias"] as const;

/** Carga el catálogo del servidor (semilla local como respaldo).
 *
 *  Exportada a propósito: la precarga de Diseño llena esta MISMA clave de caché,
 *  y si allá se guardaba la respuesta cruda `{categorias: […]}` mientras el hook
 *  esperaba el arreglo, el panel reventaba con "n.map is not a function". Una
 *  clave de caché, una sola función que decide la forma del dato. */
export async function fetchCategoriasEtiqueta(): Promise<CategoriaEtiqueta[]> {
  const res = await api.get<{ categorias: CategoriaEtiqueta[] }>("/api/etiquetas/categorias");
  return res.categorias?.length ? res.categorias : CATEGORIAS_ETIQUETA;
}

/** Catálogo de categorías del servidor, con la semilla local como respaldo. */
export function useCategoriasEtiqueta() {
  return useQuery({
    queryKey: QK_CATEGORIAS_ETIQUETA,
    queryFn: fetchCategoriasEtiqueta,
    staleTime: 60_000,
    gcTime: 60 * 60 * 1000,
  });
}

/** Nombre visible usando el catálogo que ya se tenga a mano (evita releer el hook). */
export function etiquetaCategoriaEn(cats: CategoriaEtiqueta[], id: string | undefined | null): string {
  if (!id) return "";
  return cats.find((c) => c.id === id)?.etiqueta ?? etiquetaCategoria(id);
}

/** Igual que `detectarCategoriaEtiqueta` pero contra un catálogo dado. */
export function detectarCategoriaEn(cats: CategoriaEtiqueta[], nombreProducto: string): string {
  const texto = ` ${normalizar(nombreProducto)} `;
  if (texto.trim().length === 0) return CATEGORIA_ETIQUETA_OTROS;
  for (const cat of cats) {
    for (const clave of cat.claves) {
      if (texto.includes(normalizar(clave))) return cat.id;
    }
  }
  return CATEGORIA_ETIQUETA_OTROS;
}

/** Id legible a partir del nombre escrito por el operador ("Sales de baño" → "sales-de-bano"). */
export function idCategoriaDesdeNombre(nombre: string): string {
  const base = normalizar(nombre).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return base || CATEGORIA_ETIQUETA_OTROS;
}
