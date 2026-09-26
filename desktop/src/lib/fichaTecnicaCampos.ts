/**
 * Extracción de campos de producto desde una ficha técnica (`/api/fichas/datos`)
 * y filtro de códigos EAN por texto — usados por "Ficha de etiqueta"
 * (`components/etiqueta-ficha/`). Extraído de `etiquetaFormulario.ts` (que
 * pertenecía al viejo Formulario de etiqueta física / Estudio Visual, ya
 * removido) porque estas funciones no dependen de nada de ese sistema.
 */
import { clasificacionSgaDesdeSds, codigosGhs } from "./ghsIconos";
import { formatearFormulaMolecular } from "./formulaMolecular";

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
 * los 14 campos (nunca omite uno por falta de dato) — el que no venga en la
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
  const sds = datos._sds && typeof datos._sds === "object" ? (datos._sds as Record<string, unknown>) : {};

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
  // La fila de la ficha se titula "Aroma"; las guardadas antes dicen "Olor".
  const olorRaw = pick(
    cf.olor,
    valorEnFilas(datos.propiedades, "aroma", "olor", "odour", "odor"),
  );
  // En el formulario FT+COA+SDS la composición se diligencia en el COA
  // (`_coa.composicion`, desde 21-sep-2026); los documentos anteriores la tienen
  // en la SDS (`_sds.composicion`). La de la FT suele quedar vacía.
  const composicionRaw =
    flattenComposicion(datos.composicion) ||
    flattenComposicion((coa as Record<string, unknown>).composicion) ||
    flattenComposicion(sds.composicion);
  // Fórmula molecular: la casilla de la etiqueta muestra el MISMO dato que la
  // fila "Fórmula molecular" del documento técnico (`caracteristicas_fisicas.
  // formula_quimica`; en el COA/SDS viaja como `formula_molecular`). Se
  // formatea para que se lea como química: los subíndices bajan y los
  // coeficientes (·2H₂O) se quedan en tamaño normal.
  const formulaRaw = formatearFormulaMolecular(
    pick(
      cf.formula_quimica,
      cf.formula_molecular,
      datos.formula_quimica,
      datos.formula_molecular,
      ident.formula_molecular,
      coaIdent.formula_molecular,
      valorEnFilas(datos.propiedades, "formula molecular", "formula quimica", "formula"),
    ),
  );
  // "Conservación y almacenamiento" del formulario FT+COA+SDS: es lo que
  // escribió una persona para ESTE producto, así que va tal cual y manda
  // sobre cualquier cosa que se deduzca de la SDS.
  const conservacionFicha = pick(datos.conservacion, datos.almacenamiento, emp.almacenamiento);
  // Sin ese campo, lo que la ficha diga sobre conservar el producto vive
  // dentro del bloque de recomendaciones de la SDS, bajo el encabezado
  // "ALMACENAMIENTO:", mezclado con las frases P. De ahí hay que resumirlo.
  // La mayoría de las fichas (CITRATO DE POTASIO y el resto de Sales
  // minerales entre ellas) NO traen ese encabezado: "recomendaciones" es un
  // párrafo corrido ("Se recomienda guardar en empaques bien cerrados…").
  // Por eso, si no hay sección, se usa el bloque entero — `sintetizarConservacion`
  // ya se queda solo con las frases de conservar y descarta modo de uso y
  // caducidad. Sin este respaldo la casilla Conservación salía vacía.
  const almacenamientoRaw = pick(
    seccionRecomendaciones(sds.recomendaciones, "ALMACENAMIENTO"),
    seccionRecomendaciones(datos.recomendaciones, "ALMACENAMIENTO"),
    texto(datos.recomendaciones),
    texto(sds.recomendaciones),
    Array.isArray(datos.estabilidad) ? (datos.estabilidad as unknown[]).map(texto).filter(Boolean).join(" ") : "",
  );
  // Pureza. Muchas fichas la guardaron como fila suelta de `propiedades`
  // ("Pureza" / "Concentracion") en vez del campo propio: se lee tambien de
  // ahi para que la casilla PUREZA de la etiqueta no salga vacia.
  const concentracionRaw = pick(
    datos.concentracion,
    ident.concentracion,
    coaIdent.concentracion,
    valorEnFilas(datos.propiedades, "pureza", "concentracion"),
  );
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
    formulaMolecular: formulaRaw || FICHA_SIN_DATO,
    grado,
    // La casilla es una síntesis de máximo 15 palabras, venga de donde venga:
    // también se resume lo que una persona escribió en "Conservación y
    // almacenamiento" (si el resumen sale vacío se respeta su texto tal cual).
    almacenamiento:
      (conservacionFicha
        ? sintetizarConservacion(conservacionFicha) || conservacionFicha
        : "")
      || (almacenamientoRaw ? sintetizarConservacion(almacenamientoRaw) : "")
      || FICHA_SIN_DATO,
    // Declaración de alérgenos del formulario FT+COA+SDS ("Contiene: …").
    // No se deduce de nada: o la ficha la trae, o no hay.
    alergenos: pick(datos.alergenos) || FICHA_SIN_DATO,
    // Descripción y aplicaciones (formato circular): la ficha las guarda como
    // texto y como lista; la etiqueta quiere una aplicación por renglón.
    descripcion: pick(datos.descripcion) || FICHA_SIN_DATO,
    aplicaciones:
      (Array.isArray(datos.aplicaciones)
        ? (datos.aplicaciones as unknown[]).map(texto).filter(Boolean).join("\n")
        : texto(datos.aplicaciones))
      || FICHA_SIN_DATO,
    // «Modo de uso» del formulario FT+COA+SDS, resumido: en la ficha es un
    // párrafo y en la etiqueta 30 mL la casilla tiene tres renglones.
    modoUso: sintetizarModoUso(texto(datos.modo_uso)) || FICHA_SIN_DATO,
    // Beneficios del formato vertical 38 × 102: dos, de máximo 10 palabras.
    ...beneficiosDesdeFicha(datos),
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

/** Saca una sección del bloque de recomendaciones de la SDS, que llega como
 *  un texto con encabezados en mayúscula separados por renglón en blanco
 *  ("SEÑAL DE PELIGRO: …", "PREVENCIÓN: …", "ALMACENAMIENTO: …",
 *  "ELIMINACIÓN: …"). Devuelve lo que sigue a los dos puntos del encabezado
 *  pedido, o "" si la ficha no lo trae. */
function seccionRecomendaciones(valor: unknown, encabezado: string): string {
  const t = texto(valor);
  if (!t) return "";
  const re = new RegExp(`^${encabezado}\\s*:`, "i");
  const parrafo = t
    .split(/\n+/)
    .map((linea) => linea.trim())
    .find((linea) => re.test(linea));
  return parrafo ? parrafo.replace(/^[^:]*:\s*/, "").trim() : "";
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
/** Regla del usuario: la casilla Conservación es una SÍNTESIS concreta, nunca
 *  el párrafo de la ficha. Tope duro de 15 palabras — lo que cabe leer de un
 *  vistazo en la etiqueta. */
export const MAX_PALABRAS_CONSERVACION = 15;

function contarPalabras(t: string): number {
  return (t.trim().match(/\S+/g) || []).length;
}

/** Recorta una frase a `max` palabras cortando por cláusulas (comas y punto
 *  y coma), para que el resultado siga siendo una instrucción completa:
 *  "Guardar en empaques bien cerrados en un lugar fresco y seco, alejado de
 *  la luz, el calor y la humedad." → "Guardar en empaques bien cerrados en un
 *  lugar fresco y seco". Solo si la primera cláusula ya se pasa se corta a
 *  mitad de cláusula (nunca a mitad de palabra). */
function recortarAPalabras(frase: string, max: number): string {
  if (contarPalabras(frase) <= max) return frase;
  const clausulas = frase.split(/(?<=[,;])\s+/);
  let out = "";
  for (const c of clausulas) {
    const cand = out ? `${out} ${c}` : c;
    if (contarPalabras(cand) > max) break;
    out = cand;
  }
  if (!out) {
    const palabras = frase.match(/\S+/g) || [];
    out = palabras.slice(0, max).join(" ");
  }
  const paren = out.lastIndexOf("(");
  if (paren > 0 && !out.slice(paren).includes(")")) out = out.slice(0, paren);
  return out.replace(/[,;\s]+$/, "");
}

function limpiarFrase(f: string): string {
  const sin = f
    // "P402 Almacenar en un lugar seco", "P403+P233: Almacenar…": el código
    // de la frase precautoria es de la SDS, no de la etiqueta.
    .replace(/^(?:P\d{3}(?:\s*\+\s*P\d{3})*\s*:?\s*)+/i, "")
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
 *  envase — en una síntesis concreta de máximo 15 palabras (regla del
 *  usuario). Se descartan las frases de modo de uso, caducidad o fecha de
 *  fabricación, se quitan las muletillas ("Se recomienda…") y van primero
 *  las frases con verbo de almacenar. Si el texto no dice nada de
 *  conservación (solo modo de uso), devuelve "" para que el operador lo
 *  escriba. */
export function sintetizarConservacion(
  texto: string,
  maxPalabras = MAX_PALABRAS_CONSERVACION,
  maxChars = MAX_CARACTERES_CONSERVACION,
): string {
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

  // Se van sumando frases mientras quepan en el tope de palabras; la primera
  // se recorta por cláusulas si ella sola ya se pasa.
  let out = "";
  for (const f of candidatas) {
    const frase = limpiarFrase(f);
    if (!frase) continue;
    if (!out) {
      out = recortarAPalabras(frase, maxPalabras);
      if (contarPalabras(out) >= maxPalabras) break;
    } else {
      const cand = `${out} ${frase}`;
      if (contarPalabras(cand) <= maxPalabras && cand.length <= maxChars) out = cand;
      else break;
    }
  }
  out = out.replace(/[,;\s]+$/, "");
  if (!out) return "";
  if (!/[.!?]$/.test(out)) out += ".";
  return out;
}

/** Tope de la casilla «Modo de uso» (30 mL): tres renglones, como Conservación. */
export const MAX_PALABRAS_MODO_USO = 25;

/** Resume el modo de uso de la ficha técnica a sus primeras frases
 *  completas, sin muletillas («Se recomienda…», «Es importante…»), hasta
 *  `maxPalabras`. «Uso externo y siempre diluido. Incorporar en la fase
 *  oleosa…» → «Uso externo y siempre diluido.» Si la primera frase ya se
 *  pasa, se recorta por cláusulas. */
export function sintetizarModoUso(texto: string, maxPalabras = MAX_PALABRAS_MODO_USO): string {
  const limpio = (texto || "").replace(/\s+/g, " ").trim();
  if (!limpio) return "";
  const frases = limpio
    .split(/(?<=[.;])\s+/)
    .map((f) => limpiarFrase(f.trim()))
    .filter(Boolean);
  let out = "";
  for (const frase of frases) {
    if (!out) {
      out = recortarAPalabras(frase, maxPalabras);
      if (contarPalabras(out) >= maxPalabras) break;
      continue;
    }
    const cand = `${out.replace(/;$/, ".")} ${frase}`;
    if (contarPalabras(cand) > maxPalabras) break;
    out = cand;
  }
  out = out.replace(/[,;:\s]+$/, "");
  if (!out) return "";
  return /[.!?]$/.test(out) ? out : `${out}.`;
}

/** Tope de cada beneficio del formato vertical (regla del usuario). */
export const MAX_PALABRAS_BENEFICIO = 10;

/** Propiedades que describen cómo se obtiene o qué contiene el producto:
 *  son ciertas, pero no son un beneficio para quien lo usa. */
const PROPIEDAD_NO_BENEFICIO =
  /^(extra[ií]d|obtenid|prensad|refinad|destilad|rico en|contiene|fuente de|origen|pureza|grado|punto de|densidad|[ií]ndice|ph\b|solubilid|viscosidad|peso molecular|rotaci[oó]n|humedad|acidez)/i;

/** Palabras que no pueden cerrar un resumen («… al cabello y»). */
const CONECTOR_FINAL = /^(y|e|o|u|a|al|lo|de|del|en|con|sin|por|para|que|el|la|los|las|un|una|su|sus|como|entre)$/i;

/** Palabra con la que una idea no puede terminar: un infinitivo o un «así»
 *  esperan lo que sigue («contribuye a reducir», «no aporta sabor, así»). */
const FINAL_COLGANTE = /^(as[ií]|tambi[eé]n|adem[aá]s|obtiene|logra|consigue|\p{L}+(ar|er|ir))$/iu;

/** Primeras palabras de `frase`, hasta `max`, cortando donde empieza otra
 *  idea (coma, «y», «que», «para»…) sin dejar la frase colgando. Vacío si
 *  ninguna idea completa de 3 palabras o más cabe. */
function primeraIdea(frase: string, max: number): string {
  const palabras = frase.replace(/[.;:]+$/, "").split(/\s+/).filter(Boolean);
  if (palabras.length <= max) return palabras.join(" ");
  const cortes: number[] = [];
  for (let i = 1; i <= max; i++) {
    const anterior = palabras[i - 1];
    const siguiente = palabras[i] || "";
    if (/[,;]$/.test(anterior) || /^(y|e|o|que|para|pero|aunque|mientras|donde)$/i.test(siguiente)) cortes.push(i);
  }
  for (const corte of cortes.reverse()) {
    let out = palabras.slice(0, corte);
    while (out.length && CONECTOR_FINAL.test(out[out.length - 1].replace(/[,;]$/, ""))) out = out.slice(0, -1);
    const ultima = (out[out.length - 1] || "").replace(/[,;]$/, "");
    if (out.length >= 3 && !FINAL_COLGANTE.test(ultima)) return out.join(" ").replace(/[,;]$/, "");
  }
  return "";
}

/** Un beneficio en máximo `max` palabras: «Acondicionador capilar|Aporta
 *  cuerpo y brillo al cabello y ayuda…» → «Acondicionador capilar: aporta
 *  cuerpo y brillo al cabello.» */
export function resumirBeneficio(item: string, max = MAX_PALABRAS_BENEFICIO): string {
  const [tituloRaw, ...resto] = (item || "").split("|");
  const titulo = limpiarFrase(tituloRaw.replace(/\s+/g, " ").trim()).replace(/[.:]+$/, "");
  const detalle = limpiarFrase(resto.join(" ").replace(/\s+/g, " ").trim());
  if (!titulo) return "";
  const nTitulo = contarPalabras(titulo);
  if (nTitulo >= max || !detalle) {
    const t = primeraIdea(titulo, max) || recortarAPalabras(titulo, max);
    return /[.!?]$/.test(t) ? t : `${t}.`;
  }
  const idea = primeraIdea(detalle, max - nTitulo);
  if (!idea) return `${titulo}.`;
  return `${titulo}: ${idea.charAt(0).toLowerCase()}${idea.slice(1)}.`;
}

/** Dos beneficios desde la ficha: sus propiedades («Título|detalle»),
 *  primero las que hablan del uso; sin propiedades, sus aplicaciones. */
function beneficiosDesdeFicha(datos: Record<string, unknown>): { beneficio1: string; beneficio2: string } {
  const lista = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map(texto).filter(Boolean) : []);
  const propiedades = lista(datos.propiedades_lista);
  const deUso = propiedades.filter((p) => !PROPIEDAD_NO_BENEFICIO.test(p.split("|")[0].trim()));
  const fuente = [...deUso, ...propiedades.filter((p) => !deUso.includes(p)), ...lista(datos.aplicaciones)];
  const [b1 = "", b2 = ""] = fuente.map((p) => resumirBeneficio(p)).filter(Boolean);
  return { beneficio1: b1 || FICHA_SIN_DATO, beneficio2: b2 || FICHA_SIN_DATO };
}
