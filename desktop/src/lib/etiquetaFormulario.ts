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
import type { ElementoTexto, ElementoVisual, PlantillaVisualDoc } from "./plantillasVisuales";

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
  return CAMPOS_TEXTO_FICHA_MP.find((c) => c.id === id)?.label || id;
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
  const ghsRaw = pick(datos.ghs, datos.ghsCodigo, ident.ghs);
  const rec = pick(datos.recomendaciones);
  const ghs = ghsRaw || (/no\s*ghs/i.test(rec) ? "NO GHS" : rec ? rec.split("\n")[0] : "NO GHS");
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
    if (el.type !== "text" || !el.campoProducto) return el;
    if (!(el.campoProducto in campos)) return el;
    return { ...el, content: campos[el.campoProducto] };
  });
  return { ...doc, elementos };
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
