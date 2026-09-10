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
  { id: "aceites-esenciales", etiqueta: "Aceites esenciales", claves: ["aceite esencial", "esencia de", "oleorresina"] },
  { id: "aceites", etiqueta: "Aceites y grasas", claves: ["aceite", "oleo", "grasa vegetal", "trigliceridos"] },
  { id: "ceras-mantecas", etiqueta: "Ceras y mantecas", claves: ["cera ", "manteca", "karite", "butter", "parafina", "vaselina", "cetilico", "cetearilico", "estearilico", "alcohol graso"] },
  { id: "extractos", etiqueta: "Extractos vegetales", claves: ["extracto", "tintura", "polvo de hoja", "hidrolato"] },
  { id: "frutos-secos", etiqueta: "Frutos secos", claves: ["mani", "almendra", "nuez", "marañon", "maranon", "pistacho", "avellana", "uva pasa", "ciruela pasa", "arandano"] },
  { id: "semillas", etiqueta: "Semillas", claves: ["semilla", "chia", "linaza", "ajonjoli", "sesamo", "quinua", "amapola", "girasol"] },
  { id: "cereales-harinas", etiqueta: "Cereales y harinas", claves: ["harina", "avena", "salvado", "almidon", "fecula", "maiz", "arroz"] },
  { id: "vitaminas", etiqueta: "Vitaminas", claves: ["vitamina", "ascorbico", "tocoferol", "retinol", "niacinamida", "biotina", "acido folico", "cianocobalamina", "colecalciferol", "pantenol"] },
  { id: "sales-minerales", etiqueta: "Sales minerales", claves: ["citrato de", "gluconato", "bisglicinato", "quelato", "sulfato de magnesio", "cloruro de magnesio", "carbonato de calcio", "oxido de zinc", "oxido de magnesio", "mineral"] },
  { id: "sales", etiqueta: "Sales y ácidos inorgánicos", claves: ["bicarbonato", "carbonato", "cloruro", "sulfato", "fosfato", "nitrato", "hidroxido", "soda caustica", "sal "] },
  { id: "acidos", etiqueta: "Ácidos orgánicos", claves: ["acido citrico", "acido lactico", "acido malico", "acido tartarico", "acido salicilico", "acido glicolico", "acido"] },
  { id: "aminoacidos-proteinas", etiqueta: "Aminoácidos y proteínas", claves: ["colageno", "proteina", "arginina", "glicina", "lisina", "creatina", "taurina", "glutamina", "carnitina", "aminoacido", "peptido", "keratina", "queratina"] },
  { id: "enzimas", etiqueta: "Enzimas y fermentos", claves: ["enzima", "asa ", "papaina", "bromelina", "amilasa", "proteasa", "lipasa", "lactasa", "probiotico", "fermento", "levadura"] },
  { id: "conservantes", etiqueta: "Conservantes", claves: ["conservante", "sharomix", "benzoato", "sorbato", "fenoxietanol", "parabeno", "geogard", "cosgard", "propionato"] },
  { id: "aditivos", etiqueta: "Aditivos alimentarios", claves: ["aditivo", "antiaglomerante", "antioxidante", "acidulante", "regulador de acidez", "potenciador", "saborizante", "aroma", "colorante", "edulcorante", "estevia", "sucralosa"] },
  { id: "gelificantes", etiqueta: "Gelificantes y espesantes", claves: ["goma", "xantan", "xantana", "guar", "carragenina", "pectina", "gelatina", "agar", "carbomer", "carbopol", "espesante", "gelificante", "alginato", "celulosa"] },
  { id: "emulsificantes", etiqueta: "Emulsificantes", claves: ["emulsificante", "emulsionante", "polawax", "cera autoemulsionante", "lecitina", "polisorbato", "tween", "span ", "monoestearato", "olivem"] },
  { id: "tensoactivos", etiqueta: "Tensoactivos", claves: ["tensoactivo", "betaina", "sulfato de sodio lauril", "lauril", "laureth", "coco glucosido", "cocamidopropil", "sles", "sls"] },
  { id: "solventes", etiqueta: "Solventes", claves: ["solvente", "alcohol", "etanol", "isopropilico", "glicerina", "propilenglicol", "butilenglicol", "acetona", "thinner", "varsol", "dpg"] },
  { id: "arcillas", etiqueta: "Arcillas y minerales", claves: ["arcilla", "bentonita", "caolin", "kaolin", "talco", "silice", "diatomea", "zeolita", "carbon activado"] },
  { id: "excipientes", etiqueta: "Excipientes y cápsulas", claves: ["capsula", "excipiente", "estearato de magnesio", "dioxido de silicio", "celulosa microcristalina", "aglutinante", "desintegrante", "pastillero"] },
  { id: "activos-cosmeticos", etiqueta: "Activos cosméticos", claves: ["hialuronico", "retinal", "peptidos", "coenzima", "argireline", "matrixyl", "urea", "alantoina", "aloe", "bisabolol"] },
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


/** Catálogo de categorías del servidor, con la semilla local como respaldo. */
export function useCategoriasEtiqueta() {
  return useQuery({
    queryKey: ["etiquetas-categorias"],
    queryFn: async () => {
      const res = await api.get<{ categorias: CategoriaEtiqueta[] }>("/api/etiquetas/categorias");
      return res.categorias?.length ? res.categorias : CATEGORIAS_ETIQUETA;
    },
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
