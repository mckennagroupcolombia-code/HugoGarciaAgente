/**
 * Vecindario de EJEMPLO para el banco de pruebas: mismas reglas que
 * app/services/empresa_viva_vecindario.py (un terreno por persona, construir, ampliar, pintar, poner,
 * mover y quitar con las monedas del mes), en memoria. Cynthia ya tiene casa colonial ampliada y
 * decorada, Stella una moderna con jardín y Victor solo el terreno; tú empiezas con 1000 monedas.
 */
import CONFIG from "../../app/data/empresa_viva_vecindario.json";
import MAPA from "../public/empresa/pixel/mapa.json";
import { errorLugar, type ItemCatalogo, type LoteMapa } from "../src/components/empresa/vecindario";

type Item = { id: number; item: string; cx: number; cy: number; precio: number };
const lotes = (MAPA as unknown as { lotes: LoteMapa[] }).lotes;
const catalogo = CONFIG.items as ItemCatalogo[];
const duenos = new Map<string, number>([["L02", 6], ["L06", 9], ["L12", 7]]);
const casas = new Map<number, { modelo: string; nivel: number }>([[6, { modelo: "colonial", nivel: 2 }], [9, { modelo: "moderna", nivel: 1 }]]);
let sig = 1;
const it = (item: string, cx: number, cy: number): Item => ({ id: sig++, item, cx, cy, precio: catalogo.find((c) => c.id === item)?.precio ?? 0 });
const items = new Map<number, Item[]>([
  [6, [it("cama_doble", 1, 2), it("sofa", 4, 2), it("alfombra_roja", 4, 3), it("repisa_trofeos", 5, 3), it("planta_interior", 6, 2),
       it("flor_roja", 0, 6), it("flor_amarilla", 1, 6), it("flor_morada", 6, 6), it("banca", 5, 7), it("arbolito", 0, 0)]],
  [9, [it("cama", 2, 4), it("nevera", 5, 4), it("huerta", 0, 0), it("flor_blanca", 7, 1), it("buzon", 6, 0)]],
]);
const movs = new Map<number, { tipo: string; monto: number; concepto: string; ts: number }[]>();
const mes = () => new Date().toISOString().slice(0, 7);
const respuesta = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
const falla = (texto: string, status = 400) => respuesta({ error: texto }, status);

function libro(u: number) {
  let l = movs.get(u);
  if (!l) { l = [{ tipo: "asignacion", monto: CONFIG.asignacion_mensual, concepto: `Asignación de ${mes()}`, ts: Date.now() / 1000 }]; movs.set(u, l); }
  return l;
}
const saldo = (u: number) => libro(u).reduce((a, m) => a + m.monto, 0);
function cobrar(u: number, monto: number, concepto: string) {
  if (monto > saldo(u)) throw new Error(`No te alcanza: cuesta ${monto} monedas y tienes ${saldo(u)}`);
  libro(u).unshift({ tipo: "compra", monto: -monto, concepto, ts: Date.now() / 1000 });
}

function estado(u: number) {
  return {
    moneda: CONFIG.moneda, asignacion_mensual: CONFIG.asignacion_mensual, acumula: CONFIG.acumula, mes: mes(),
    billetera: { saldo: saldo(u), movimientos: libro(u).slice(0, 15) },
    lotes: lotes.map((l) => {
      const d = duenos.get(l.id) ?? null;
      return { id: l.id, precio: l.precio, frente: l.frente, dueno: d, casa: d ? casas.get(d) ?? null : null,
               items: d ? (items.get(d) ?? []).map(({ id, item, cx, cy }) => ({ id, item, cx, cy })) : [] };
    }),
    catalogo: { items: catalogo, categorias: CONFIG.categorias, casa: CONFIG.casa, niveles: CONFIG.niveles, devolucion: CONFIG.devolucion_al_quitar },
  };
}

export function vecindarioEjemplo(ruta: string, init: RequestInit | undefined, yo: number): Response | null {
  if (!ruta.startsWith("/api/empresa-viva/vecindario")) return null;
  if (ruta === "/api/empresa-viva/vecindario") return respuesta(estado(yo));
  const accion = ruta.split("/").pop();
  const b = (() => { try { return JSON.parse(String(init?.body || "{}")); } catch { return {}; } })();
  const miLote = [...duenos].find(([, u]) => u === yo)?.[0];
  const lm = lotes.find((l) => l.id === miLote);
  const casa = casas.get(yo);
  const nivel = casa ? CONFIG.niveles.find((n) => n.nivel === casa.nivel) ?? null : null;
  const mios = items.get(yo) ?? [];
  try {
    switch (accion) {
      case "terreno": {
        const l = lotes.find((x) => x.id === b.lote);
        if (!l) return falla("Ese terreno no existe", 404);
        if (miLote) return falla("Ya tienes un terreno: cada quien tiene uno");
        if (duenos.has(l.id)) return falla("Ese terreno ya tiene dueño");
        cobrar(yo, l.precio, `Terreno ${l.id}`);
        duenos.set(l.id, yo);
        break;
      }
      case "construir":
        if (!miLote) return falla("Primero compra un terreno en el vecindario");
        if (casa) return falla("Tu casa ya está construida: puedes ampliarla");
        cobrar(yo, CONFIG.casa.precio, "Construir la casa");
        casas.set(yo, { modelo: b.modelo, nivel: 1 });
        break;
      case "ampliar": {
        const s = CONFIG.niveles.find((n) => n.nivel === (casa?.nivel ?? 0) + 1);
        if (!casa || !s) return falla("No se puede ampliar");
        cobrar(yo, s.precio, s.nombre);
        casa.nivel = s.nivel;
        break;
      }
      case "pintar":
        if (!casa) return falla("Primero construye la casa");
        cobrar(yo, CONFIG.casa.pintar, "Pintar la casa");
        casa.modelo = b.modelo;
        break;
      case "poner": {
        const c = catalogo.find((x) => x.id === b.item);
        if (!c || !lm) return falla("Eso no está en el catálogo");
        const err = errorLugar(catalogo, lm.frente, nivel, c, b.cx, b.cy, mios);
        if (err) return falla(err);
        cobrar(yo, c.precio, c.nombre);
        items.set(yo, [...mios, it(c.id, b.cx, b.cy)]);
        break;
      }
      case "mover": {
        const o = mios.find((x) => x.id === b.id);
        const c = o && catalogo.find((x) => x.id === o.item);
        if (!o || !c || !lm) return falla("Eso no está en tu casa", 404);
        const err = errorLugar(catalogo, lm.frente, nivel, c, b.cx, b.cy, mios, o.id);
        if (err) return falla(err);
        o.cx = b.cx; o.cy = b.cy;
        break;
      }
      case "quitar": {
        const o = mios.find((x) => x.id === b.id);
        if (!o) return falla("Eso no está en tu casa", 404);
        items.set(yo, mios.filter((x) => x !== o));
        libro(yo).unshift({ tipo: "devolucion", monto: Math.floor(o.precio / 2), concepto: `Quitar ${o.item}`, ts: Date.now() / 1000 });
        break;
      }
      default:
        return falla("Acción desconocida", 404);
    }
  } catch (e) {
    return falla(e instanceof Error ? e.message : "No se pudo");
  }
  return respuesta(estado(yo));
}
