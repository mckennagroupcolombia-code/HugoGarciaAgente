export type ParamRow = { parametro: string; especificacion: string; resultado: string };

/** Tabla COA si la IA no responde: especificación genérica, resultado Conforme. */
export const PARAMETROS_COA_FALLBACK = [
  "Aspecto|Conforme a especificación del proveedor|Conforme",
  "Identificación|Positiva / Cumple|Conforme",
  "Ensayo / Pureza|Según especificación del proveedor|Conforme",
  "Pérdida por secado|Según especificación del proveedor|Conforme",
  "pH (solución acuosa)|Según especificación del proveedor|Conforme",
  "Metales pesados|Según especificación del proveedor|Conforme",
  "Arsénico|Según especificación del proveedor|Conforme",
  "Recuento de aerobios totales|Según especificación del proveedor|Conforme",
  "Hongos y levaduras|Según especificación del proveedor|Conforme",
  "Escherichia coli|Ausente|Conforme",
  "Salmonella spp.|Ausente|Conforme",
].join("\n");

/** `editable`: para la tabla que se edita tecla a tecla. No recorta espacios,
 *  porque recortar en cada tecla se comía el espacio entre palabras. */
export function parseParamRows(text: string, { editable = false }: { editable?: boolean } = {}): ParamRow[] {
  // En edición, una fila recién agregada («||») se conserva hasta que se escriba en ella.
  const lines = editable ? text.split("\n").filter((l) => l.length > 0) : text.trim().split("\n").filter(Boolean);
  if (!lines.length) return [];
  const limpiar = (v: string | undefined) => (editable ? v ?? "" : (v ?? "").trim());
  return lines.map((line) => {
    const parts = line.split("|");
    return {
      parametro: limpiar(parts[0]),
      especificacion: limpiar(parts[1]),
      resultado: limpiar(parts[2]),
    };
  });
}

export function rowsToParamString(rows: ParamRow[]): string {
  return rows.map((r) => `${r.parametro}|${r.especificacion}|${r.resultado}`).join("\n");
}

export function mergeParamStrings(existing: string, incoming: string): string {
  const merged = new Map<string, ParamRow>();
  const order: string[] = [];
  const take = (row: ParamRow, fillCells: boolean) => {
    const key = row.parametro.trim().toLowerCase();
    if (!key) return;
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, { ...row });
      order.push(key);
      return;
    }
    if (!fillCells) return;
    if (row.especificacion.trim()) prev.especificacion = row.especificacion;
    if (row.resultado.trim()) prev.resultado = row.resultado;
  };
  for (const row of parseParamRows(existing)) take(row, false);
  for (const row of parseParamRows(incoming)) take(row, true);
  return rowsToParamString(order.map((k) => merged.get(k)!));
}
