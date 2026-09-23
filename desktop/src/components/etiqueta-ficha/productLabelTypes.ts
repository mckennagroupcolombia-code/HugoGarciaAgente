/** Modelo de datos de la ficha/etiqueta de materia prima. Todo campo es
 *  texto editable — nada aquí se calcula ni se deriva de otro campo. */
import type { CSSProperties } from "react";

export interface ProductLabelData {
  /** Data URL de la imagen del logo (vacío = sin logo adjunto todavía). */
  logoUrl: string;
  /** Multiplicador del tamaño del logo (1.3 = 130 %, el valor por defecto
   *  y el máximo; una ficha guardada sin este dato también se ve al 130 %).
   *  Ajustable en el header con los botones －/＋ en modo edición. */
  logoScale?: number;
  /** Nombre del archivo elegido en la carpeta DISEÑO CORPORATIVO (vacío =
   *  logo subido a mano o sin logo). Solo informativo. */
  logoNombre?: string;
  /** Color de acento de la ficha (bandas, bordes, títulos, íconos). Se toma
   *  del logo elegido; sin dato se usa el naranja corporativo. */
  accentColor?: string;
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
  /** Data URL del pictograma GHS elegido en la galería (vacío = sin
   *  pictograma, se ve el texto de `ghs` en su lugar). */
  ghsIconSvg?: string;
  /** Desplazamiento vertical del pictograma GHS, en % de su caja (negativo =
   *  más arriba). Solo mueve el rombo, no el resto de la columna. */
  ghsDesplazamiento?: number;
  /** Título del atributo de composición (sin dato = "Composición"). */
  compositionTitulo?: string;
  /** Rótulo del número de registro del cuadro técnico (sin dato = "CAS"). */
  casTitulo?: string;
  /** Cuchara medidora incluida: cantidad (vacío = no se imprime) y unidad. */
  /** Beneficios del formato vertical 38 × 102: tres textos cortos. */
  beneficio1?: string;
  beneficio2?: string;
  beneficio3?: string;
  cucharaCantidad?: string;
  cucharaUnidad?: string;
  /** Rótulo de la casilla: cuchara o copa (ver `TITULOS_CUCHARA`). */
  cucharaUtensilio?: string;
  /** Formato 30 mL: grado del subtítulo "INSUMO GRADO …" (sin dato = COSMÉTICO). */
  gradoInsumo?: string;
  /** Formato 30 mL: texto de clasificación SGA (vacío = frase por defecto si
   *  el producto no es peligroso). */
  clasificacionTexto?: string;
  /** Formato 30 mL: título del bloque de clasificación. Un producto sin
   *  pictograma GHS puede usar ese espacio para «Modo de uso» o «Sugerencia»
   *  (ver `TITULOS_CLASIFICACION_30ML`). Dato de plantilla. */
  clasificacionTitulo?: string;
  /** Formato 30 mL: orden de las seis casillas del panel izquierdo, claves
   *  separadas por coma en orden de lectura ("origin,appearance,…"). Dato de
   *  plantilla: cada categoría decide el suyo; sin dato, el orden de siempre. */
  ordenCeldas?: string;
  /** Formato 30 mL: texto de conservación de la FAMILIA. Dato de plantilla
   *  (`storage` es dato de producto y nunca se hereda): es el ejemplo en gris
   *  de la casilla y el texto con que nace cada etiqueta hecha con la plantilla. */
  storageSugerido?: string;
  /** Formato 30 mL: sin el espacio del timbre bajo la tabla Pureza/CAS; la
   *  tabla ocupa ese alto. El timbre físico sigue teniendo su zona junto al
   *  código de barras. Dato de plantilla. */
  sinTimbreCentro?: boolean;
  /** Formato 69 × 51 mm (alimentos): línea de alérgenos ("Contiene: frutos
   *  secos…"). Dato de plantilla: toda etiqueta de la familia la hereda y se
   *  ajusta por producto. */
  alergenos?: string;

  // ── Formato circular 53 × 53 mm (ceras y mantecas) ───────────────────────
  /** Descripción corta bajo el título curvo. */
  descripcionProducto?: string;
  /** Encabezado del bloque central ("Aplicaciones:"). Dato de plantilla. */
  aplicacionesTitulo?: string;
  /** Una aplicación por renglón; cada una sale con su viñeta. */
  aplicaciones?: string;
  /** Razón social sobre el arco izquierdo. Dato de plantilla. */
  empresa?: string;
  /** Registro sanitario, sobre el arco inferior izquierdo. */
  registro?: string;
  /** Aviso de control de calidad del arco derecho. Dato de plantilla: es la
   *  misma frase para toda la familia. */
  controlCalidad?: string;

  technicalDocuments: string;
  website: string;

  netContent: string;
  barcode: string;
  /** Título del producto del código de barras elegido (catálogo EAN) —
   *  nombra el PNG y la ficha guardada, y guía el enlace con la ficha técnica. */
  barcodeTitle?: string;
  /** Ficha técnica enlazada (id de `/api/fichas/datos`) y su título. */
  fichaTecnicaId?: string;
  fichaTecnicaTitulo?: string;
  /** Cómo venían los datos de la ficha técnica la última vez que se pasaron a
   *  la etiqueta. Al abrirla se compara con la ficha actual y se aplica SOLO lo
   *  que cambió allá: lo corregido en la ficha llega solo y lo ajustado a mano
   *  en la etiqueta (sin tocar la ficha) se respeta. Ver `lib/fichaTecnicaSync`. */
  fichaTecnicaBase?: Record<string, string>;

  city: string;
  phone: string;
  email: string;
}

/** Retícula maestra de 3 columnas iguales — header, grid de atributos y
 *  bloque inferior la usan por igual para que todas las líneas verticales
 *  de la ficha coincidan exactamente. No definir anchos independientes
 *  (2fr/1fr, %, px) en cada sección: siempre esta misma clase. */
/** Alto de la franja de color sobre el código de barras, en unidades del
 *  SVG del código (ver `FranjaEAN13`): se escala con él, así que no hay
 *  que tocarlo si cambia el tamaño de la etiqueta. */
export const ALTO_FRANJA_FICHA = 10;

export const RETICULA_MAESTRA = "grid grid-cols-3";

/** Naranja corporativo — acento por defecto mientras no se elija un logo. */
export const ACENTO_POR_DEFECTO = "#FFA500";

export function normalizarHex(color?: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((color || "").trim());
  return m ? `#${m[1].toUpperCase()}` : ACENTO_POR_DEFECTO;
}

/** Variables CSS del acento. Los componentes de la ficha usan
 *  `text-[color:var(--acento)]`, `border-[color:var(--acento)]`, etc. en
 *  vez del hex fijo; las variantes con alfa (hex de 8 dígitos) reemplazan
 *  a los modificadores `/50`, `/60`, `/5`, `/[0.08]` de Tailwind, que no
 *  funcionan sobre un `var()`. */
export function variablesAcento(color?: string): CSSProperties {
  const hex = normalizarHex(color);
  return {
    "--acento": hex,
    "--acento-60": `${hex}99`,
    "--acento-50": `${hex}80`,
    "--acento-08": `${hex}14`,
    "--acento-05": `${hex}0D`,
  } as CSSProperties;
}

export const PRODUCTO_EJEMPLO: ProductLabelData = {
  logoUrl: "",
  logoScale: 1.3,
  logoNombre: "",
  accentColor: ACENTO_POR_DEFECTO,
  productName: "MANTECA DE\nCACAO REFINADA",
  classification: "MATERIA PRIMA GRADO COSMÉTICO — REFINADA",
  concentration: "100 %",
  cas: "8002-31-9",

  origin: "Colombia",
  appearance:
    "Sólido, blanco a blanco amarillento, pálido, de textura suave y untuosa, presentándose en bloques o piezas.",
  odor: "Aroma dulce y cremoso, con un trasfondo sutil de cacao.",
  composition: "Ácido Esteárico, Ácido Oleico, Ácido Palmítico, Ácido Linoleico",
  grade: "Cosmético — Refinada",
  storage: "Guardar en lugar fresco, seco y bien cerrado.",

  ghs: "NO GHS",
  ghsIconSvg: "",

  technicalDocuments: "TDS - COA",
  website: "www.mckennagroup.co",

  netContent: "1000g",
  barcode: "7701545002636",
  barcodeTitle: "",
  fichaTecnicaId: "",
  fichaTecnicaTitulo: "",

  city: "Bogotá · Colombia",
  phone: "+57 319 652 90 76",
  email: "info@mckennagroup.co",
};

/** Ejemplo de referencia de cada casilla, compartido por todos los formatos.
 *  En edición se ve en gris dentro de la casilla vacía, como guía de qué va
 *  ahí; nunca se guarda ni sale en el PNG ni en la impresión (que se generan
 *  en modo vista). `EditableField` lo toma por su `styleKey`, que es el
 *  nombre del dato. */
export const EJEMPLO_ETIQUETA = {
  productName: "NOMBRE DEL PRODUCTO",
  classification: "MATERIA PRIMA GRADO COSMÉTICO",
  composition: "C₁₆H₃₄O",
  grade: "Cosmético",
  storage: "Lugar fresco y seco",
  origin: "Malasia",
  appearance: "Escamas blancas",
  odor: "Suave, característico",
  concentration: "99%",
  cas: "36653-82-4",
  netContent: "500 g",
  barcode: "7700875002637",
  technicalDocuments: "TDS - COA",
  website: "www.mckennagroup.co",
  city: "Bogotá - Colombia",
  phone: "+57 319 652 90 76",
  email: "info@mckennagroup.co",
  alergenos: "Contiene: frutos secos. Puede contener trazas de maní.",
} as const satisfies Partial<Record<keyof ProductLabelData, string>>;

/** Campos FIJOS de la empresa que forman la "plantilla del formulario":
 *  se guardan una vez y toda ficha nueva arranca con ellos. El resto de
 *  campos (producto, atributos, código de barras…) llega del SKU elegido y
 *  de su ficha técnica, nunca de un ejemplo. */
export const CAMPOS_PLANTILLA = [
  "logoUrl",
  "logoNombre",
  "logoScale",
  "accentColor",
  "technicalDocuments",
  "website",
  "city",
  "phone",
  "email",
  "ghsDesplazamiento",
  "compositionTitulo",
  "casTitulo",
  "cucharaCantidad",
  "cucharaUnidad",
  "cucharaUtensilio",
  "gradoInsumo",
  "clasificacionTitulo",
  "ordenCeldas",
  "storageSugerido",
  "sinTimbreCentro",
  "alergenos",
  "aplicacionesTitulo",
  "empresa",
  "controlCalidad",
] as const satisfies readonly (keyof ProductLabelData)[];

/** Títulos elegibles de la casilla de composición (menú del título). Se
 *  guarda en `compositionTitulo`, el mismo dato que usa el formato de
 *  30 mL; si una ficha antigua trae un título que ya no está en la lista,
 *  se ve el primero. El título es "Fórmula molecular" (no "química"), igual
 *  que en el documento técnico — es el mismo dato. */
export const TITULOS_COMPOSICION = ["Composición", "Fórmula molecular"] as const;

export function tituloComposicion(data: ProductLabelData): string {
  const t = data.compositionTitulo || "";
  return (TITULOS_COMPOSICION as readonly string[]).includes(t) ? t : TITULOS_COMPOSICION[0];
}
export const TITULOS_CAS = ["CAS", "EINECS"] as const;
/** Rótulos elegibles de la casilla del utensilio de medida (menú del
 *  título), igual que `TITULOS_CAS` y `TITULOS_COMPOSICION`. Se guarda
 *  en `cucharaUtensilio`; las fichas que no lo traen ven el primero. */
export const TITULOS_CUCHARA = [
  "Incluye cuchara medidora de:",
  "Incluye copa medidora de:",
] as const;

export function tituloCuchara(data: ProductLabelData): string {
  const t = data.cucharaUtensilio || "";
  return (TITULOS_CUCHARA as readonly string[]).includes(t) ? t : TITULOS_CUCHARA[0];
}
export const UNIDADES_CUCHARA = ["g", "mL"] as const;

/** Ficha vacía: sin información de producto. Los campos fijos traen el
 *  valor corporativo por defecto (se reemplazan por la plantilla guardada). */
export const PRODUCTO_VACIO: ProductLabelData = {
  logoUrl: "",
  logoScale: 1.3,
  logoNombre: "",
  accentColor: ACENTO_POR_DEFECTO,
  productName: "",
  classification: "",
  concentration: "",
  cas: "",
  origin: "",
  appearance: "",
  odor: "",
  composition: "",
  grade: "",
  storage: "",
  ghs: "NO GHS",
  ghsIconSvg: "",
  clasificacionTexto: "",
  technicalDocuments: "TDS - COA",
  website: "www.mckennagroup.co",
  netContent: "",
  barcode: "",
  barcodeTitle: "",
  fichaTecnicaId: "",
  fichaTecnicaTitulo: "",
  city: "Bogotá · Colombia",
  phone: "+57 319 652 90 76",
  email: "info@mckennagroup.co",
  descripcionProducto: "",
  aplicaciones: "",
  registro: "",
};

/** Datos de UN producto: los traen su código de barras y su ficha técnica.
 *  Una etiqueta nueva nunca los hereda de la plantilla — antes se copiaban
 *  y, si la ficha técnica no se cargaba, la etiqueta quedaba con el nombre,
 *  la composición y el CAS de otro producto sin que nada lo notara (así
 *  salió CITRATO POTASIO con los datos de CITRATO DE MAGNESIO). */
export const CAMPOS_PRODUCTO = [
  "productName",
  "classification",
  "concentration",
  "cas",
  "origin",
  "appearance",
  "odor",
  "composition",
  "grade",
  "storage",
  "netContent",
  "ghs",
  "ghsIconSvg",
  "clasificacionTexto",
  "barcode",
  "barcodeTitle",
  "fichaTecnicaId",
  "fichaTecnicaTitulo",
  "fichaTecnicaBase",
  "descripcionProducto",
  "aplicaciones",
  "registro",
] as const satisfies readonly (keyof ProductLabelData)[];

/** El diseño de una ficha (logo, acento, contacto, títulos, GHS, cuchara…)
 *  con los datos de producto en blanco. */
export function sinDatosDeProducto(data: ProductLabelData): ProductLabelData {
  const out = { ...data } as unknown as Record<string, unknown>;
  const vacio = PRODUCTO_VACIO as unknown as Record<string, unknown>;
  for (const k of CAMPOS_PRODUCTO) out[k] = vacio[k];
  return out as unknown as ProductLabelData;
}

/** ¿Queda algún dato de producto distinto del de una ficha vacía? */
export function tieneDatosDeProducto(data: ProductLabelData): boolean {
  const d = data as unknown as Record<string, unknown>;
  const vacio = PRODUCTO_VACIO as unknown as Record<string, unknown>;
  return CAMPOS_PRODUCTO.some((k) => (d[k] ?? "") !== (vacio[k] ?? ""));
}

/** Paleta fija de la ficha — ver especificación: naranja corporativo,
 *  fondo blanco, texto principal casi negro, retícula gris translúcida. */
export const COLOR_FICHA = {
  naranja: ACENTO_POR_DEFECTO,
  fondo: "#FFFFFF",
  texto: "#111111",
  reticula: "rgba(17, 17, 17, 0.06)",
} as const;
