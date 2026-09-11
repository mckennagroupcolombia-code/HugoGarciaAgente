/**
 * Extracción de campos de producto desde una ficha técnica (`/api/fichas/datos`)
 * y filtro de códigos EAN por texto — usados por "Ficha de etiqueta"
 * (`components/etiqueta-ficha/`). Extraído de `etiquetaFormulario.ts` (que
 * pertenecía al viejo Formulario de etiqueta física / Estudio Visual, ya
 * removido) porque estas funciones no dependen de nada de ese sistema.
 */
import { clasificacionSgaDesdeSds, codigosGhs } from "./ghsIconos";

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
 *  de ficha de etiqueta como en el buscador de código de barras. */
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

/** Placeholder que reemplaza cualquier campo del formulario para el que la
 *  ficha técnica cargada no trae dato (ver `camposDesdeFichaTecnica`) — a
 *  propósito muy visible, para que nadie lo confunda con un dato real. */
export const FICHA_SIN_DATO = "— completar —";

/**
 * Extrae los campos de una etiqueta desde una ficha técnica
 * (`datosDesdeFormulario` / YAML de `fichas_word/datos`). Siempre devuelve
 * los 12 campos (nunca omite uno por falta de dato) — el que no venga en la
 * ficha se llena con `FICHA_SIN_DATO`, para que quede visible qué falta
 * diligenciar a mano en vez de dejarlo con lo que hubiera antes (dato de
 * otro producto, si se venía de una ficha distinta).
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

  const nombreRaw = pick(
    datos.nombre_producto,
    datos.titulo,
    ident.nombre_comercial,
    coaIdent.nombre_comercial,
  );
  const gradoRaw = pick(datos.grado, ident.grado, coaIdent.grado);
  const casRaw = pick(datos.cas, ident.cas, coaIdent.cas).replace(/^(CAS\s*#?\s*)/i, "");
  const origenRaw = pick(
    datos.pais_origen,
    lote.pais_origen,
    coaLote.pais_origen,
    valorEnFilas(datos.identidad, "pais de origen", "origen"),
  );
  const aparienciaRaw = pick(
    cf.apariencia,
    valorEnFilas(datos.propiedades, "apariencia", "appearance"),
  );
  const olorRaw = pick(cf.olor, valorEnFilas(datos.propiedades, "olor", "odour", "odor"));
  const composicionRaw = flattenComposicion(datos.composicion);
  const almacenamientoRaw = pick(
    datos.almacenamiento,
    emp.almacenamiento,
    Array.isArray(datos.estabilidad) ? (datos.estabilidad as unknown[]).map(texto).filter(Boolean).join(" ") : "",
  );
  const concentracionRaw = pick(datos.concentracion, ident.concentracion, coaIdent.concentracion);
  const pesoRaw = pick(datos.presentacion, ident.presentacion, lote.tamano_lote);
  // El GHS solo puede venir de un campo dedicado a clasificación de peligro
  // (nunca de "recomendaciones" de uso). Sin campo explícito, el valor
  // seguro por defecto es "NO GHS": a diferencia de los demás campos, la
  // ausencia de dato SÍ tiene un valor correcto y conocido, así que no es
  // FICHA_SIN_DATO como el resto.
  //
  // Las fichas guardan los pictogramas en la sección de peligros de la SDS
  // (`_sds.peligros.pictogramas`: "GHS07 - Nocivo\nH302: …"), no en un campo
  // `ghs`. Sin leerla, ÁCIDO SALICÍLICO, CLORURO DE CALCIO, INULINA… salían
  // como "NO GHS" y "No está clasificado como peligroso".
  const sds = datos._sds && typeof datos._sds === "object" ? (datos._sds as Record<string, unknown>) : {};
  const peligros =
    sds.peligros && typeof sds.peligros === "object" ? (sds.peligros as Record<string, unknown>) : {};
  const pictogramasSds = texto(peligros.pictogramas);
  const codigosSds = codigosGhs(pictogramasSds);
  const ghs =
    pick(datos.ghs, datos.ghsCodigo, ident.ghs, coaIdent.ghs)
    || (codigosSds.length > 0 ? codigosSds.join(", ") : "")
    || "NO GHS";
  // Clasificación corta (palabra de advertencia + frases H), solo si la SDS
  // trae pictogramas de peligro; si no, la etiqueta pone la frase del SGA.
  const clasificacionSga = clasificacionSgaDesdeSds(pictogramasSds, texto(peligros.clasificacion));

  const nombre = nombreRaw ? partirNombreEtiqueta(nombreRaw) : FICHA_SIN_DATO;
  const grado = gradoRaw || FICHA_SIN_DATO;
  const tagline = (
    pick(datos.tagline) || (gradoRaw ? `MATERIA PRIMA GRADO ${gradoRaw.toUpperCase()}` : "")
  ) || `MATERIA PRIMA GRADO ${FICHA_SIN_DATO}`;

  return {
    nombre,
    tagline: tagline.toUpperCase(),
    concentracionValor: concentracionRaw || FICHA_SIN_DATO,
    casNumero: casRaw || FICHA_SIN_DATO,
    ghs,
    clasificacionSga,
    origen: origenRaw || FICHA_SIN_DATO,
    apariencia: aparienciaRaw || FICHA_SIN_DATO,
    olor: olorRaw || FICHA_SIN_DATO,
    composicion: composicionRaw || FICHA_SIN_DATO,
    grado,
    almacenamiento: almacenamientoRaw ? sintetizarConservacion(almacenamientoRaw) : FICHA_SIN_DATO,
    peso: pesoRaw || FICHA_SIN_DATO,
  };
}

/** Registro del catálogo EAN con lo mínimo para deducir la presentación. */
interface CodigoEanPresentacion {
  sku: string;
  nombre_producto: string;
  presentacion?: string;
}

function unidadNormal(u: string): string {
  const l = u.toLowerCase();
  if (l === "kg" || l.startsWith("kilo")) return " Kg";
  if (l === "l" || l === "lt" || l.startsWith("litro")) return " Lt";
  if (l === "ml") return "mL";
  if (l === "g" || l === "gr" || l === "grs") return "g";
  if (l === "mg") return "mg";
  if (l === "oz") return " oz";
  return " un";
}

/** Contenido neto a partir del SKU elegido en el código de barras:
 *  "ACIDO SALICILICO 30mL" → "30mL", "C-INUKg" → "1 Kg", "MANTECA DE CACAO
 *  REFINADA" + presentación "500" + SKU "…500g" → "500g". Vacío si no se
 *  puede deducir (el operador lo escribe a mano). */
export function contenidoNetoDesdeCodigo(c: CodigoEanPresentacion): string {
  const fuentes = [c.nombre_producto || "", c.sku || ""];
  const conNumero = /(\d+(?:[.,]\d+)?)\s*(kg|kilos?|grs?|g|mg|ml|lt|l|litros?|oz|un|und)\b/i;
  for (const f of fuentes) {
    const m = conNumero.exec(f);
    if (m) return `${m[1].replace(",", ".")}${unidadNormal(m[2])}`;
  }
  for (const f of fuentes) {
    if (/\b(kg|kilos?)\b|kg$/i.test(f)) return "1 Kg";
    if (/\b(lt|litros?)\b|lt$/i.test(f)) return "1 Lt";
  }
  const n = parseInt(c.presentacion || "", 10);
  if (Number.isFinite(n) && n > 1) {
    const liquido = /\b(ml|lt)\b|ml$|lt$/i.test(fuentes.join(" "));
    return `${n}${liquido ? "mL" : "g"}`;
  }
  if (n === 1) return "1 Kg";
  return "";
}

/** Términos propios de una instrucción de conservación: dónde y cómo se
 *  guarda (ambiente, humedad, temperatura, luz, envase). */
const CLAVES_CONSERVACION =
  /guard|almacen|conserv|\blugar\b|envase|recipiente|empaque|temperatur|°\s*c\b|grados|refriger|congel|ventil|oscur|alejad|protegid|herm[eé]tic|cerrad|\bluz\b|calor|humedad|fresc|\bsec[oa]s?\b|ambient|\bsol\b|contamin/i;
/** Verbos/expresiones que confirman que la frase habla de almacenar (no
 *  de usar el producto): tienen prioridad al armar el resumen. */
const CLAVES_ALMACENAR =
  /guard|almacen|conserv|\blugar\b|mantenga el envase|mantener el envase|mantenga el empaque|envase bien cerrado|empaque bien cerrado|refriger|congel/i;
/** Frases de MODO DE USO o preparación (piel, dosis, cocina…): nunca van
 *  en Conservación aunque mencionen temperatura o humedad. */
const CLAVES_USO =
  /\bpiel\b|cabello|rostro|aplic|dilu|\buso\b|\busar\b|utiliz|dosis|mezcl|ingerir|ingesta|consum|prueba de parche|al[eé]rgic|irrit|gelific|hervir|cocin|prepar|postre|receta|proporci|cucharad|\btaza\b|calent|enfr[ií]e|formulaci|medici[oó]n/i;
/** Frases de caducidad / fechas: no son conservación (solo se admiten en
 *  el fallback, recortando la cola "hasta por 24 meses…"). */
const CLAVES_CADUCIDAD =
  /caduc|vencim|fabricaci|\bfecha|\bmeses\b|\baños?\b|\blote\b|garant|vida [uú]til|reanalisis|reanálisis/i;
/** Cola de caducidad dentro de una frase de conservación. */
const COLA_CADUCIDAD = /\s*,?\s*(hasta por|durante|por un per[ií]odo de|por)\s+\d+\s*(meses|años)[^.;]*/gi;
/** ~3 renglones de 14 px en la celda de la ficha (≈ 45-50 caracteres por renglón). */
const MAX_CARACTERES_CONSERVACION = 150;

function limpiarFrase(f: string): string {
  const sin = f
    .replace(COLA_CADUCIDAD, "")
    .replace(/\s*\(\s*\)/g, "")
    .replace(/^(se recomienda|es recomendable|se sugiere|se debe|se deben|debe|deben|recomendamos|el producto debe|se aconseja|es importante)\s+/i, "")
    .replace(/^(ser\s+)/i, "")
    .trim()
    .replace(/[,;\s]+$/, "");
  return sin.charAt(0).toUpperCase() + sin.slice(1);
}

/** Resume el texto de almacenamiento de la ficha técnica a lo esencial de
 *  CÓMO conservar el producto — ambiente, humedad, temperatura, luz,
 *  envase — en no más de ~3 renglones. Se descartan las frases de modo de
 *  uso, caducidad o fecha de fabricación, se quitan las muletillas ("Se
 *  recomienda…") y van primero las frases con verbo de almacenar. Si el
 *  texto no dice nada de conservación (solo modo de uso), devuelve "" para
 *  que el operador lo escriba. */
export function sintetizarConservacion(texto: string, maxChars = MAX_CARACTERES_CONSERVACION): string {
  const limpio = (texto || "").replace(/\s+/g, " ").trim();
  if (!limpio) return "";
  const frases = limpio
    .split(/(?<=[.;])\s+/)
    .map((f) => f.trim())
    .filter(Boolean);
  const utiles = frases.filter(
    (f) => CLAVES_CONSERVACION.test(f) && !CLAVES_USO.test(f) && !CLAVES_CADUCIDAD.test(f),
  );
  let candidatas = [
    ...utiles.filter((f) => CLAVES_ALMACENAR.test(f)),
    ...utiles.filter((f) => !CLAVES_ALMACENAR.test(f)),
  ];
  if (candidatas.length === 0) candidatas = frases.filter((f) => CLAVES_ALMACENAR.test(f) && !CLAVES_USO.test(f));
  if (candidatas.length === 0) return "";

  let out = "";
  for (const f of candidatas) {
    const frase = limpiarFrase(f);
    if (!frase) continue;
    if (!out) out = frase;
    else if (`${out} ${frase}`.length <= maxChars) out = `${out} ${frase}`;
    else break;
  }
  if (out.length > maxChars) {
    // Cortar en la última coma o espacio antes del límite, nunca a mitad
    // de palabra ni dejando un paréntesis abierto.
    let corte = out.slice(0, maxChars);
    const paren = corte.lastIndexOf("(");
    if (paren > 0 && !corte.slice(paren).includes(")")) corte = corte.slice(0, paren);
    const idx = Math.max(corte.lastIndexOf(","), corte.lastIndexOf(";"), corte.lastIndexOf(" "));
    out = corte.slice(0, idx > 40 ? idx : corte.length);
  }
  out = out.replace(/[,;\s]+$/, "");
  if (!out) return "";
  if (!/[.!?]$/.test(out)) out += ".";
  return out;
}
