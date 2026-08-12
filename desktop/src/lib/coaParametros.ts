export type ParamRow = { parametro: string; especificacion: string; resultado: string };

export function parseParamRows(text: string): ParamRow[] {
  const lines = text.trim().split("\n").filter(Boolean);
  if (!lines.length) return [];
  return lines.map((line) => {
    const parts = line.split("|");
    return {
      parametro: (parts[0] ?? "").trim(),
      especificacion: (parts[1] ?? "").trim(),
      resultado: (parts[2] ?? "").trim(),
    };
  });
}

export function rowsToParamString(rows: ParamRow[]): string {
  return rows.map((r) => `${r.parametro}|${r.especificacion}|${r.resultado}`).join("\n");
}

export function mergeParamStrings(existing: string, incoming: string): string {
  const merged = new Map<string, ParamRow>();
  for (const row of parseParamRows(existing)) {
    const key = row.parametro.trim().toLowerCase();
    if (key) merged.set(key, row);
  }
  for (const row of parseParamRows(incoming)) {
    const key = row.parametro.trim().toLowerCase();
    if (key) merged.set(key, row);
  }
  const rows = [...merged.values()];
  return rowsToParamString(rows);
}
