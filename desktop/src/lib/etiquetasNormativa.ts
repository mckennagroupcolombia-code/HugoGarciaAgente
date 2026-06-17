import type { DiagramacionEtiqueta, DiagramacionGraficos } from "./etiquetasDiagramacion";

export type PerfilEtiqueta = "materia_prima_alimentaria" | "insumo_cosmetico" | "insumo_tecnico";

export type SeveridadNorma = "error" | "warning" | "info";

export interface ReglaNormativa {
  id: string;
  severidad: SeveridadNorma;
  mensaje: string;
  campo?: string;
}

export interface EtiquetaStudioDatos {
  sku: string;
  nombre_producto: string;
  subtitulo: string;
  perfil: PerfilEtiqueta;
  ingrediente: string;
  contenido_neto: string;
  unidad: string;
  presentacion_extra: string;
  aplicaciones: string;
  descripcion_etiqueta: string;
  cas: string;
  concentracion: string;
  formula_molecular: string;
  pureza: string;
  lote: string;
  vencimiento: string;
  mostrar_lote_vencimiento: boolean;
  placeholders_lote_vencimiento: boolean;
  codigo_barras: string;
  incluye_cuchara: boolean;
  texto_cuchara: string;
  mostrar_bloque_legal: boolean;
  mostrar_res_2674: boolean;
  distribuidor: string;
  nit: string;
  ciudad: string;
  notas_tecnicas: string;
  tipo_etiqueta: string;
  ancho_mm: number;
  alto_mm: number;
  /** Archivo .ai en Etiquetas Modelo SVG/ (ej. CITRATO MAGNESIO 250g.ai) */
  archivo_ai?: string;
  /** Si true, ignora plantillas Illustrator y usa SVG genérico */
  forzar_plantilla_svg?: boolean;
  /** Etiqueta alternativa MeLi: mostrar fórmula molecular en caja técnica */
  mostrar_formula_molecular: boolean;
  /** Etiqueta alternativa MeLi: mostrar línea # CAS */
  mostrar_cas: boolean;
  /** Etiqueta alternativa MeLi: mostrar concentración/pureza en caja */
  mostrar_concentracion: boolean;
  /** original | alternativa — controla sanitización al renderizar */
  modo_etiqueta?: "original" | "alternativa";
  /** Ancho del bloque B1 (% del espacio hasta la línea vertical). 50–100. */
  b1_ancho_pct?: number;
  /** Posición/color por bloque (editor de diagramación). */
  diagramacion?: DiagramacionEtiqueta;
  /** Posición de líneas y recuadros decorativos. */
  diagramacion_graficos?: DiagramacionGraficos;
}

export const ETIQUETA_STUDIO_DEFAULT: EtiquetaStudioDatos = {
  sku: "",
  nombre_producto: "",
  subtitulo: "Insumo alimentario 100% puro en polvo",
  perfil: "materia_prima_alimentaria",
  ingrediente: "",
  contenido_neto: "250",
  unidad: "g",
  presentacion_extra: "",
  aplicaciones: "Alimentos, formulación, cosmética e industria",
  descripcion_etiqueta:
    "Polvo fino. Materia prima alimentaria para formulación. Reenvase Res. 2674/2013 Art. 37-3. No es suplemento dietario terminado ni medicamento.",
  cas: "",
  concentracion: "99 %",
  formula_molecular: "",
  pureza: "100% puro",
  lote: "",
  vencimiento: "",
  mostrar_lote_vencimiento: true,
  placeholders_lote_vencimiento: true,
  codigo_barras: "",
  incluye_cuchara: false,
  texto_cuchara: "Cuchara incluida para dosificación en formulación",
  mostrar_bloque_legal: true,
  mostrar_res_2674: true,
  distribuidor: "MCKENNA GROUP S.A.S",
  nit: "901316016-3",
  ciudad: "Bogotá — Colombia",
  notas_tecnicas: "COA y ficha técnica en www.mckennagroup.co",
  tipo_etiqueta: "250 g",
  ancho_mm: 76,
  alto_mm: 66,
  mostrar_formula_molecular: false,
  mostrar_cas: true,
  mostrar_concentracion: true,
  modo_etiqueta: "alternativa",
  b1_ancho_pct: 100,
};

const PALABRAS_PROHIBIDAS_CLIENTE = [
  "grado farmacológico",
  "grado farmacologico",
  "farmacológico",
  "farmacologico",
  "tratamiento",
  "cura ",
  " cura",
  "medicamento para",
  "dosis recomendada",
  "porción diaria",
  "dolores musculares",
  "laxante",
  "suplemento dietario terminado",
  "registro invima",
  "invima n°",
];

const PALABRAS_ALERTA_SUPLEMENTO = [
  "suplemento",
  "beneficios",
  "tómalo",
  "tomalo",
  "consumir de una a dos veces",
  "sal de magnesio",
];

/** Texto sensible en plantillas .ai originales que la alternativa debe omitir o reemplazar. */
export const ETIQUETA_SENSIBLE_OMITIR = [
  "grado farmacológico",
  "grado farmacologico",
  "ph. eur",
  "jpc.",
  "usp;",
  "suplementos dietéticos",
  "antiácidos",
  "laxante",
  "estreñimiento",
  "salud ósea",
  "dolores musculares",
  "absorbido por el organismo",
  "magnesio elemental",
  "16.2%",
] as const;

export function subtituloAlternativo(perfil: PerfilEtiqueta = "materia_prima_alimentaria"): string {
  if (perfil === "insumo_cosmetico") {
    return "Insumo cosmético · materia prima para formulación";
  }
  if (perfil === "insumo_tecnico") {
    return "Materia prima técnica · uso industrial";
  }
  return "Insumo alimentario 100% puro · Res. 2674/2013 Art. 37-3";
}

export function descripcionAlternativaDefault(
  nombre: string,
  ingrediente: string,
): string {
  const id = (ingrediente || nombre || "producto").trim();
  return [
    `Polvo fino. Materia prima alimentaria para formulación.`,
    `Reenvase Res. 2674/2013 Art. 37-3.`,
    `No es suplemento dietario terminado ni medicamento.`,
  ].join(" ");
}

/** Defaults MeLi-safe al crear/editar versión alternativa. */
export function aplicarDefaultsAlternativa(
  d: Partial<EtiquetaStudioDatos>,
): Partial<EtiquetaStudioDatos> {
  const perfil = d.perfil || "materia_prima_alimentaria";
  const nombre = (d.nombre_producto || d.ingrediente || "").trim();
  const subtituloRaw = (d.subtitulo || "").toLowerCase();
  const descRaw = (d.descripcion_etiqueta || "").toLowerCase();
  const subtituloSensible =
    !d.subtitulo ||
    subtituloRaw.includes("farmacol") ||
    subtituloRaw.includes("ph. eur") ||
    subtituloRaw.includes("usp");
  const descSensible =
    !d.descripcion_etiqueta ||
    (d.descripcion_etiqueta.length < 120 &&
      (ETIQUETA_SENSIBLE_OMITIR.some((p) => descRaw.includes(p)) ||
        /\bsuplemento diet/i.test(descRaw) ||
        descRaw.includes("grado farmacol")));
  return {
    ...d,
    perfil,
    subtitulo: subtituloSensible ? subtituloAlternativo(perfil) : d.subtitulo,
    descripcion_etiqueta: descSensible
      ? descripcionAlternativaDefault(nombre, d.ingrediente || nombre)
      : d.descripcion_etiqueta,
    mostrar_formula_molecular: d.mostrar_formula_molecular ?? false,
    mostrar_cas: d.mostrar_cas ?? true,
    mostrar_concentracion: d.mostrar_concentracion ?? true,
    mostrar_bloque_legal: d.mostrar_bloque_legal ?? true,
    mostrar_res_2674: d.mostrar_res_2674 ?? true,
    modo_etiqueta: "alternativa",
    b1_ancho_pct: d.b1_ancho_pct ?? 100,
  };
}

export function perfilSubtitulo(perfil: PerfilEtiqueta): string {
  switch (perfil) {
    case "insumo_cosmetico":
      return "Insumo cosmético — materia prima para formulación";
    case "insumo_tecnico":
      return "Materia prima técnica — uso industrial";
    default:
      return "Insumo alimentario 100% puro en polvo";
  }
}

export function textoLegalRes2674(d: EtiquetaStudioDatos): string {
  return [
    "REENVASE DE MATERIA PRIMA ALIMENTARIA",
    "Res. 2674/2013 Art. 37 num. 3",
    "NO ES MEDICAMENTO",
    "NO ES SUPLEMENTO DIETARIO TERMINADO",
    d.notas_tecnicas,
    `${d.distribuidor} · NIT ${d.nit} · ${d.ciudad}`,
  ].join(" · ");
}

export function tituloMeliSugerido(d: EtiquetaStudioDatos): string {
  const nombre = (d.nombre_producto || d.ingrediente || "Producto").trim();
  const neto = `${d.contenido_neto}${d.unidad}`.replace(/\s+/g, "");
  const extra = d.presentacion_extra ? ` ${d.presentacion_extra}` : "";
  const base = nombre.toLowerCase().includes("polvo")
    ? nombre
    : `${nombre} En Polvo Puro`;
  return `${base} ${neto}${extra} — Materia Prima`.slice(0, 60).trim();
}

export function descripcionMeliSugerida(d: EtiquetaStudioDatos): string {
  const neto = `${d.contenido_neto} ${d.unidad}`.trim();
  return [
    `${(d.nombre_producto || d.ingrediente).toUpperCase()} — MATERIA PRIMA ALIMENTARIA`,
    `Contenido neto: ${neto}`,
    "",
    "¿Qué es?",
    `${d.subtitulo}. Producto de reenvase y fraccionamiento para formulación. No es un suplemento dietario terminado ni un medicamento.`,
    "",
    "Aplicaciones:",
    d.aplicaciones,
    "",
    "Calidad:",
    `- ${d.pureza}`,
    "- COA por lote y ficha técnica disponibles en www.mckennagroup.co",
    "",
    "Marco regulatorio (Colombia):",
    "Materia prima alimentaria. Exención Resolución 2674 de 2013, Artículo 37 numeral 3.",
    "La trazabilidad del lote se entrega en Certificado de Análisis (COA).",
    "",
    "Advertencias:",
    "- No es un medicamento",
    "- No incluir claims de salud en esta presentación",
    "- Quien elabora producto terminado es responsable de su registro sanitario si aplica",
    "",
    `Distribuido por: ${d.distribuidor} | NIT ${d.nit} | ${d.ciudad}`,
  ].join("\n");
}

export function atributosMeliSugeridos(d: EtiquetaStudioDatos): Record<string, string> {
  const esMineral = /magnesio|citrato|zinc|potasio|calcio|mineral/i.test(
    `${d.nombre_producto} ${d.ingrediente}`,
  );
  const attrs: Record<string, string> = {
    domain_id: "MCO-SUPPLEMENTS",
    category_id: "MCO8830",
    LINE: esMineral ? "Materias primas alimentarias" : "Insumos alimentarios",
    BRAND: "Mckenna Group",
    INGREDIENTS: d.ingrediente || d.nombre_producto,
    SUPPLEMENT_FORMAT: "Polvo",
    SALE_FORMAT: "Unidad",
    UNITS_PER_PACK: "1",
    SELLER_SKU: d.sku,
    IS_GLUTEN_FREE: "Sí",
    IS_VEGAN: "Sí",
    CONTAINS_LACTOSE: "No",
    ITEM_CONDITION: "Nuevo",
  };
  if (esMineral) {
    attrs.MAIN_SUPPLEMENT = d.ingrediente || d.nombre_producto;
    attrs.SUPPLEMENT_CLASS = "Vitaminas/Multivitamínicos/Minerales";
    attrs.SUPPLEMENT_TYPE = "Nutricional/Deportivo";
  }
  return attrs;
}

function textoEtiquetaImpresa(d: EtiquetaStudioDatos): string {
  return [
    d.nombre_producto,
    d.subtitulo,
    d.aplicaciones,
    d.descripcion_etiqueta,
    d.notas_tecnicas,
    d.texto_cuchara,
    d.pureza,
    d.concentracion,
    d.formula_molecular,
    d.cas,
    textoLegalRes2674(d),
  ]
    .join(" ")
    .toLowerCase();
}

/** Evita falsos positivos en frases legales: «no es suplemento…», «sin registro invima». */
function contieneFraseProhibida(texto: string, frase: string): boolean {
  const low = texto.toLowerCase();
  const fraseLow = frase.toLowerCase().trim();
  if (!fraseLow) return false;
  let idx = 0;
  while (idx < low.length) {
    const pos = low.indexOf(fraseLow, idx);
    if (pos < 0) return false;
    const ventana = low.slice(Math.max(0, pos - 48), pos);
    const negado =
      /\bno\s+(es(\s+un)?|incluir|incluye|contiene)\s*$/i.test(ventana) ||
      /\bsin\s+$/i.test(ventana.slice(-12));
    if (!negado) return true;
    idx = pos + fraseLow.length;
  }
  return false;
}

function textoCompletoRevision(d: EtiquetaStudioDatos): string {
  return [
    textoEtiquetaImpresa(d),
    descripcionMeliSugerida(d),
    tituloMeliSugerido(d),
  ].join(" ");
}

export function validarEtiquetaStudio(d: EtiquetaStudioDatos): ReglaNormativa[] {
  const reglas: ReglaNormativa[] = [];
  const textoEtiqueta = textoEtiquetaImpresa(d);
  const textoCompleto = textoCompletoRevision(d);

  if (!d.sku.trim()) {
    reglas.push({ id: "sku", severidad: "error", mensaje: "SKU / código Siigo obligatorio", campo: "sku" });
  }
  if (!d.nombre_producto.trim()) {
    reglas.push({
      id: "nombre",
      severidad: "error",
      mensaje: "Nombre del producto en etiqueta es obligatorio",
      campo: "nombre_producto",
    });
  }
  if (!d.ingrediente.trim()) {
    reglas.push({
      id: "ingrediente",
      severidad: "error",
      mensaje: "Ingrediente principal obligatorio (etiqueta e MeLi)",
      campo: "ingrediente",
    });
  }
  if (!d.contenido_neto.trim()) {
    reglas.push({
      id: "neto",
      severidad: "error",
      mensaje: "Contenido neto obligatorio",
      campo: "contenido_neto",
    });
  }

  if (d.perfil === "materia_prima_alimentaria" && !d.mostrar_res_2674) {
    reglas.push({
      id: "res2674",
      severidad: "warning",
      mensaje: "Se recomienda mostrar Res. 2674/2013 Art. 37-3 en etiqueta alimentaria",
      campo: "mostrar_res_2674",
    });
  }

  if (d.mostrar_formula_molecular) {
    reglas.push({
      id: "formula_meli",
      severidad: "warning",
      mensaje: "Fórmula molecular visible: MeLi puede leer señal farmacéutica",
      campo: "mostrar_formula_molecular",
    });
  }

  if (/^sal\s+de\s+magnesio/i.test(d.nombre_producto)) {
    reglas.push({
      id: "titulo_sal",
      severidad: "error",
      mensaje: 'Evita "Sal de magnesio" en título; usa "Citrato de magnesio en polvo"',
      campo: "nombre_producto",
    });
  }

  for (const p of PALABRAS_PROHIBIDAS_CLIENTE) {
    if (contieneFraseProhibida(textoEtiqueta, p)) {
      reglas.push({
        id: `prohibida_${p.slice(0, 12)}`,
        severidad: "error",
        mensaje: `Texto no permitido en etiqueta impresa: "${p}"`,
      });
    }
  }

  for (const p of PALABRAS_ALERTA_SUPLEMENTO) {
    if (contieneFraseProhibida(textoEtiqueta, p)) {
      reglas.push({
        id: `alerta_${p.slice(0, 10)}`,
        severidad: "warning",
        mensaje: `Puede leerse como suplemento terminado en etiqueta: "${p}"`,
      });
    }
  }

  for (const p of PALABRAS_ALERTA_SUPLEMENTO) {
    if (contieneFraseProhibida(textoCompleto, p) && !contieneFraseProhibida(textoEtiqueta, p)) {
      reglas.push({
        id: `alerta_meli_${p.slice(0, 10)}`,
        severidad: "info",
        mensaje: `Borrador MeLi menciona "${p}" (no va en PDF de etiqueta)`,
      });
    }
  }

  if (d.incluye_cuchara && !/formulaci/i.test(d.texto_cuchara)) {
    reglas.push({
      id: "cuchara",
      severidad: "warning",
      mensaje: "Con cuchara, aclara que es para dosificación en formulación",
      campo: "texto_cuchara",
    });
  }

  if (!d.mostrar_bloque_legal) {
    reglas.push({
      id: "legal",
      severidad: "warning",
      mensaje: "Activa el bloque legal (no medicamento / no suplemento terminado)",
      campo: "mostrar_bloque_legal",
    });
  }

  if (reglas.filter((r) => r.severidad === "error").length === 0) {
    reglas.push({
      id: "ok",
      severidad: "info",
      mensaje: "Cumple criterios mínimos McKenna para materia prima reenvasada",
    });
  }

  return reglas;
}

export function puedeExportarEtiqueta(d: EtiquetaStudioDatos): boolean {
  return !validarEtiquetaStudio(d).some((r) => r.severidad === "error");
}

export function erroresExportarEtiqueta(d: EtiquetaStudioDatos): string[] {
  return validarEtiquetaStudio(d)
    .filter((r) => r.severidad === "error")
    .map((r) => r.mensaje);
}

export interface BorradorMeliStudio {
  titulo: string;
  descripcion: string;
  family_name: string;
  domain_id: string;
  category_id: string;
  atributos: Record<string, string>;
  checklist: string[];
}

export function borradorMeliCompleto(d: EtiquetaStudioDatos): BorradorMeliStudio {
  const titulo = tituloMeliSugerido(d);
  return {
    titulo,
    descripcion: descripcionMeliSugerida(d),
    family_name: (d.nombre_producto || d.ingrediente).slice(0, 60),
    domain_id: "MCO-SUPPLEMENTS",
    category_id: "MCO8830",
    atributos: atributosMeliSugeridos(d),
    checklist: [
      "Dominio MCO-SUPPLEMENTS (nunca MCO-SALT para minerales)",
      "Una sola publicación por SKU",
      "Foto principal = etiqueta generada en Studio",
      "Sin claims de salud en descripción",
      "LINE = Materias primas / Insumos alimentarios",
    ],
  };
}
