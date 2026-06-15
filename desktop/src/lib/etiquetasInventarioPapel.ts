export interface InventarioPapel {
  id: string;
  tipo: "papel";
  ref: string;
  nombre: string;
  ancho_mm: number;
  alto_mm: number;
  ancho_pulg: number;
  alto_pulg: number;
  unidades_por_rollo: number;
  rollos: number;
  etiquetas_sueltas: number;
  minimo_rollos?: number;
  minimo?: number;
  formato_etiqueta?: string;
  notas?: string;
  total_etiquetas?: number;
  cantidad?: number;
  unidad?: string;
  updated_at?: string;
}

export interface InventarioTinta {
  id: string;
  tipo: "tinta";
  nombre: string;
  cantidad: number;
  unidad: string;
  minimo: number;
  notas?: string;
  updated_at?: string;
}

export type InventarioConsumible = InventarioPapel | InventarioTinta;

export function mmAPulgadas(mm: number): number {
  if (!Number.isFinite(mm) || mm <= 0) return 0;
  return Math.round((mm / 25.4) * 1000) / 1000;
}

export function totalEtiquetasPapel(item: Pick<InventarioPapel, "rollos" | "unidades_por_rollo" | "etiquetas_sueltas">): number {
  const upr = Math.max(0, item.unidades_por_rollo || 0);
  const rollos = Math.max(0, item.rollos || 0);
  const sueltas = Math.max(0, item.etiquetas_sueltas || 0);
  if (upr > 0) return Math.floor(rollos * upr) + sueltas;
  return sueltas;
}

export function esInventarioPapel(item: InventarioConsumible): item is InventarioPapel {
  return item.tipo === "papel";
}

export function papelBajoMinimo(item: InventarioPapel): boolean {
  const min = item.minimo_rollos ?? item.minimo ?? 0;
  if (min <= 0) return false;
  return (item.rollos || 0) < min;
}

export function nombreDisplayPapel(
  datos: Pick<InventarioPapel, "ref" | "ancho_mm" | "alto_mm">,
): string {
  const ref = (datos.ref || "").trim();
  const aw = datos.ancho_mm || 0;
  const ah = datos.alto_mm || 0;
  if (ref && aw > 0 && ah > 0) return `${ref} · ${aw}×${ah} mm`;
  return ref || "Papel";
}

export function bodyPapelInventario(
  datos: Omit<InventarioPapel, "id" | "tipo" | "nombre" | "updated_at" | "cantidad" | "unidad" | "minimo" | "total_etiquetas">,
): Omit<InventarioPapel, "id" | "updated_at"> {
  return {
    tipo: "papel",
    ref: datos.ref.trim(),
    nombre: nombreDisplayPapel(datos),
    ancho_mm: datos.ancho_mm,
    alto_mm: datos.alto_mm,
    ancho_pulg: datos.ancho_pulg,
    alto_pulg: datos.alto_pulg,
    unidades_por_rollo: datos.unidades_por_rollo,
    rollos: datos.rollos,
    etiquetas_sueltas: datos.etiquetas_sueltas,
    minimo_rollos: datos.minimo_rollos,
    formato_etiqueta: datos.formato_etiqueta,
    notas: datos.notas,
  };
}

export function papelDesdeItem(
  item: Partial<InventarioPapel> & { nombre?: string; cantidad?: number },
): Omit<InventarioPapel, "id" | "tipo" | "nombre" | "updated_at" | "cantidad" | "unidad" | "minimo" | "total_etiquetas"> {
  let ref = (item.ref || "").trim();
  let ancho_mm = Number(item.ancho_mm) || 0;
  let alto_mm = Number(item.alto_mm) || 0;
  const nombre = (item.nombre || "").trim();
  if (!ref && nombre.includes(" · ")) {
    ref = nombre.split(" · ", 1)[0].trim();
  }
  if ((ancho_mm <= 0 || alto_mm <= 0) && nombre) {
    const m = nombre.match(/(\d+(?:[.,]\d+)?)\s*[×x*]\s*(\d+(?:[.,]\d+)?)\s*mm/i);
    if (m) {
      ancho_mm = Number(m[1].replace(",", "."));
      alto_mm = Number(m[2].replace(",", "."));
    }
  }
  const rollos = item.rollos ?? item.cantidad ?? 0;
  const upr = Number(item.unidades_por_rollo) || 500;
  return {
    ref: ref || nombre || "Papel",
    ancho_mm,
    alto_mm,
    ancho_pulg: Number(item.ancho_pulg) || mmAPulgadas(ancho_mm),
    alto_pulg: Number(item.alto_pulg) || mmAPulgadas(alto_mm),
    unidades_por_rollo: upr,
    rollos: Number(rollos) || 0,
    etiquetas_sueltas: Number(item.etiquetas_sueltas) || 0,
    minimo_rollos: item.minimo_rollos ?? item.minimo ?? 1,
    formato_etiqueta: item.formato_etiqueta || "",
    notas: item.notas || "",
  };
}

export function inventarioPapelCompleto(
  item: Partial<InventarioPapel> & { id: string; tipo?: string; nombre?: string },
): InventarioPapel {
  const datos = papelDesdeItem(item);
  const rollos = datos.rollos;
  const upr = datos.unidades_por_rollo;
  const sueltas = datos.etiquetas_sueltas;
  return {
    id: item.id,
    tipo: "papel",
    nombre: nombreDisplayPapel(datos),
    ...datos,
    cantidad: rollos,
    unidad: "rollos",
    minimo: datos.minimo_rollos ?? 0,
    total_etiquetas: Math.floor(rollos * upr) + sueltas,
    updated_at: item.updated_at,
  };
}

export function normalizarInventarioItems(items: InventarioConsumible[]): InventarioConsumible[] {
  const cache = leerCachePapelInventario();
  return items.map((it) => {
    if (it.tipo === "papel" || (it.nombre && /mm/i.test(it.nombre))) {
      const cached = cache[it.id];
      const merged = cached ? { ...it, ...cached, id: it.id, tipo: "papel" as const } : it;
      return inventarioPapelCompleto(merged as InventarioPapel);
    }
    return it;
  });
}

const CACHE_PAPEL_KEY = "etiquetas-inventario-papel-v2";

type CachePapel = Pick<
  InventarioPapel,
  | "ref"
  | "ancho_mm"
  | "alto_mm"
  | "ancho_pulg"
  | "alto_pulg"
  | "unidades_por_rollo"
  | "rollos"
  | "etiquetas_sueltas"
  | "minimo_rollos"
  | "formato_etiqueta"
  | "notas"
>;

export function leerCachePapelInventario(): Record<string, CachePapel> {
  try {
    const raw = localStorage.getItem(CACHE_PAPEL_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, CachePapel>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function guardarCachePapelInventario(item: InventarioPapel | InventarioConsumible): void {
  if (item.tipo !== "papel") return;
  const full = inventarioPapelCompleto(item as InventarioPapel);
  const cache = leerCachePapelInventario();
  cache[full.id] = {
    ref: full.ref,
    ancho_mm: full.ancho_mm,
    alto_mm: full.alto_mm,
    ancho_pulg: full.ancho_pulg,
    alto_pulg: full.alto_pulg,
    unidades_por_rollo: full.unidades_por_rollo,
    rollos: full.rollos,
    etiquetas_sueltas: full.etiquetas_sueltas,
    minimo_rollos: full.minimo_rollos,
    formato_etiqueta: full.formato_etiqueta,
    notas: full.notas,
  };
  try {
    localStorage.setItem(CACHE_PAPEL_KEY, JSON.stringify(cache));
  } catch {
    /* quota */
  }
}

export function eliminarCachePapelInventario(id: string): void {
  const cache = leerCachePapelInventario();
  if (!cache[id]) return;
  delete cache[id];
  try {
    localStorage.setItem(CACHE_PAPEL_KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

export const PAPEL_VACIO: Omit<InventarioPapel, "id" | "tipo" | "nombre" | "updated_at" | "cantidad" | "unidad" | "minimo" | "total_etiquetas"> = {
  ref: "",
  ancho_mm: 0,
  alto_mm: 0,
  ancho_pulg: 0,
  alto_pulg: 0,
  unidades_por_rollo: 500,
  rollos: 0,
  etiquetas_sueltas: 0,
  minimo_rollos: 1,
  formato_etiqueta: "",
  notas: "",
};
