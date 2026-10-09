/**
 * El vecindario de Empresa viva: tipos y la geometría de cada terreno (8 × 8 baldosas). La misma
 * cuenta que app/services/empresa_viva_vecindario.py (`casa_rect`, `zonas`, `_error_lugar`): el
 * servidor valida de verdad; aquí sirve para pintar la casa y para que al decorar se vea en verde o
 * rojo dónde cabe algo antes de pagar. Si se cambia una, se cambia la otra.
 */
export interface LoteMapa {
  id: string; x: number; y: number; lado: number; baldosa: number; frente: "abajo" | "arriba"; precio: number;
  entrada: { x: number; y: number }; letrero: { x: number; y: number };
}
export interface ItemCatalogo {
  id: string; nombre: string; categoria: string; precio: number; w: number; h: number;
  donde: "jardin" | "adentro" | "ambos"; pisable?: boolean; capa?: "suelo" | "objeto"; maximo?: number;
}
export interface NivelCasa { nivel: number; w: number; h: number; precio: number; nombre: string }
export interface ModeloCasa { id: string; nombre: string; pared: string; piso: string; techo: string }
export interface ItemCasa { id: number; item: string; cx: number; cy: number }
export interface LoteEstado {
  id: string; precio: number; frente: "abajo" | "arriba"; dueno: number | null;
  casa: { modelo: string; nivel: number } | null; items: ItemCasa[];
}
export interface EstadoVecindario {
  moneda: string; asignacion_mensual: number; acumula: boolean; mes: string;
  billetera: { saldo: number; movimientos: { tipo: string; monto: number; concepto: string; ts: number }[] };
  lotes: LoteEstado[];
  catalogo: {
    items: ItemCatalogo[]; categorias: { id: string; nombre: string }[];
    casa: { precio: number; pintar: number; modelos: ModeloCasa[] }; niveles: NivelCasa[]; devolucion: number;
  };
}

export const LADO = 8;
export const PUERTA = [3, 4];
const k = (x: number, y: number) => `${x},${y}`;

/** (x0, y0, w, h) de la casa en baldosas, relativo al terreno. */
export function casaRect(frente: LoteMapa["frente"], nivel: NivelCasa) {
  const x0 = Math.floor((LADO - nivel.w) / 2);
  const y0 = frente === "abajo" ? 1 : LADO - 1 - nivel.h;
  return { x0, y0, w: nivel.w, h: nivel.h };
}

/** Celdas donde se puede poner algo: adentro (sin el muro ni la entrada) y jardín (sin el camino). */
export function zonas(frente: LoteMapa["frente"], nivel: NivelCasa | null) {
  const adentro = new Set<string>(), jardin = new Set<string>();
  if (!nivel) return { adentro, jardin };
  const { x0, y0, w, h } = casaRect(frente, nivel);
  const enCasa = (x: number, y: number) => x >= x0 && x < x0 + w && y >= y0 && y < y0 + h;
  const reservada = (x: number, y: number) => PUERTA.includes(x) && (frente === "abajo"
    ? y === y0 + h - 1 || y >= y0 + h
    : y === y0 + 1 || y < y0);
  for (let x = 0; x < LADO; x++)
    for (let y = 0; y < LADO; y++) {
      if (reservada(x, y)) continue;
      if (enCasa(x, y)) { if (y > y0) adentro.add(k(x, y)); }
      else jardin.add(k(x, y));
    }
  return { adentro, jardin };
}

const celdas = (it: { w: number; h: number }, cx: number, cy: number) => {
  const out: string[] = [];
  for (let x = cx; x < cx + it.w; x++) for (let y = cy; y < cy + it.h; y++) out.push(k(x, y));
  return out;
};

/** Por qué no se puede poner `it` en (cx, cy), o null si se puede. */
export function errorLugar(catalogo: ItemCatalogo[], frente: LoteMapa["frente"], nivel: NivelCasa | null, it: ItemCatalogo,
                           cx: number, cy: number, items: ItemCasa[], salvo?: number): string | null {
  if (!nivel) return "Primero construye la casa";
  const { adentro, jardin } = zonas(frente, nivel);
  const cs = celdas(it, cx, cy);
  const dentroDe = (z: Set<string>) => cs.every((c) => z.has(c));
  if (it.donde === "adentro" && !dentroDe(adentro)) return "Eso va adentro de la casa (y sin tapar la puerta)";
  if (it.donde === "jardin" && !dentroDe(jardin)) return "Eso va en el jardín (sin tapar el camino a la puerta)";
  if (it.donde === "ambos" && !dentroDe(adentro) && !dentroDe(jardin)) return "No cabe ahí";
  const capa = it.capa ?? "objeto";
  for (const o of items) {
    if (o.id === salvo) continue;
    const oi = catalogo.find((x) => x.id === o.item);
    if (!oi || (oi.capa ?? "objeto") !== capa) continue;
    const otras = new Set(celdas(oi, o.cx, o.cy));
    if (cs.some((c) => otras.has(c))) return `Ahí ya está ${oi.nombre.toLowerCase()}`;
  }
  return null;
}

export const nivelDe = (v: EstadoVecindario, n: number | undefined) => v.catalogo.niveles.find((x) => x.nivel === n) ?? null;
export const modeloDe = (v: EstadoVecindario, id: string | undefined) => v.catalogo.casa.modelos.find((m) => m.id === id) ?? v.catalogo.casa.modelos[0];
