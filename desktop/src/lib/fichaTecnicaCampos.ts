/**
 * Extracción de campos de producto desde una ficha técnica (`/api/fichas/datos`)
 * y filtro de códigos EAN por texto — usados por "Ficha de etiqueta"
 * (`components/etiqueta-ficha/`). Extraído de `etiquetaFormulario.ts` (que
 * pertenecía al viejo Formulario de etiqueta física / Estudio Visual, ya
 * removido) porque estas funciones no dependen de nada de ese sistema.
 */

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
  const ghs = pick(datos.ghs, datos.ghsCodigo, ident.ghs, coaIdent.ghs) || "NO GHS";

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
    origen: origenRaw || FICHA_SIN_DATO,
    apariencia: aparienciaRaw || FICHA_SIN_DATO,
    olor: olorRaw || FICHA_SIN_DATO,
    composicion: composicionRaw || FICHA_SIN_DATO,
    grado,
    almacenamiento: almacenamientoRaw || FICHA_SIN_DATO,
    peso: pesoRaw || FICHA_SIN_DATO,
  };
}
