/** Modelo de datos de la ficha/etiqueta de materia prima. Todo campo es
 *  texto editable — nada aquí se calcula ni se deriva de otro campo. */
export interface ProductLabelData {
  /** Data URL de la imagen del logo (vacío = sin logo adjunto todavía). */
  logoUrl: string;
  /** Multiplicador manual del tamaño del logo (1 = tamaño por defecto).
   *  Ajustable en el header con los botones －/＋ en modo edición. */
  logoScale?: number;
  productName: string;
  classification: string;
  concentration: string;
  cas: string;

  origin: string;
  appearance: string;
  odor: string;
  composition: string;
  grade: string;
  storage: string;

  ghs: string;

  technicalDocuments: string;
  website: string;

  netContent: string;
  barcode: string;

  city: string;
  phone: string;
  email: string;
}

/** Retícula maestra de 3 columnas iguales — header, grid de atributos y
 *  bloque inferior la usan por igual para que todas las líneas verticales
 *  de la ficha coincidan exactamente. No definir anchos independientes
 *  (2fr/1fr, %, px) en cada sección: siempre esta misma clase. */
export const RETICULA_MAESTRA = "grid grid-cols-3";

export const PRODUCTO_EJEMPLO: ProductLabelData = {
  logoUrl: "",
  logoScale: 1,
  productName: "MANTECA DE\nCACAO REFINADA",
  classification: "MATERIA PRIMA GRADO COSMÉTICO — REFINADA",
  concentration: "100 %",
  cas: "8002-31-9",

  origin: "Colombia",
  appearance:
    "Sólido, blanco a blanco amarillento, pálido, de textura suave y untuosa, presentándose en bloques o piezas.",
  odor: "Olor dulce y cremoso, con un trasfondo sutil de cacao.",
  composition: "Ácido Esteárico, Ácido Oleico, Ácido Palmítico, Ácido Linoleico",
  grade: "Cosmético — Refinada",
  storage: "Guardar en lugar fresco, seco y bien cerrado.",

  ghs: "NO GHS",

  technicalDocuments: "TDS - COA",
  website: "www.mckennagroup.co",

  netContent: "1000g",
  barcode: "7701545002636",

  city: "Bogotá · Colombia",
  phone: "+57 319 652 90 76",
  email: "info@mckennagroup.co",
};

/** Paleta fija de la ficha — ver especificación: naranja corporativo,
 *  fondo blanco, texto principal casi negro, retícula gris translúcida. */
export const COLOR_FICHA = {
  naranja: "#FFA500",
  fondo: "#FFFFFF",
  texto: "#111111",
  reticula: "rgba(17, 17, 17, 0.06)",
} as const;
