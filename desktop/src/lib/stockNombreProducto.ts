/** Prefiere título MeLi / nombre Alegra sobre códigos pegados en Sheets. */
export function nombreProductoFila(
  stockNombre: string,
  tituloMeli?: string | null,
  nombreSiigo?: string | null,
): string {
  const meli = (tituloMeli || "").trim();
  if (meli) return meli;
  const siigo = (nombreSiigo || "").trim();
  const stock = (stockNombre || "").trim();
  const pareceCodigo = (s: string) =>
    Boolean(s) && !/\s/.test(s) && /^[A-Z0-9._-]{3,48}$/i.test(s);
  if (siigo && (!stock || pareceCodigo(stock))) return siigo;
  return stock || siigo || "";
}
