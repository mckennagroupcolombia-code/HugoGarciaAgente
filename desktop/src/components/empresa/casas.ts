/**
 * Las casas del vecindario dibujadas en vivo (no van en el arte fijo del barrio: cambian cada vez que
 * alguien compra, construye o decora). Por cada terreno de mapa.json → `lotes`:
 * - el letrero («Se vende · 400», «Casa de Cynthia»),
 * - la casa del dueño (piso, muro norte con ventanas, muros, puerta) y su **techo**, que se levanta
 *   cuando alguien entra (como en las casas de la empresa),
 * - lo que compró (sprites `casa_<id>` de objetos.png), cada cosa en su celda del terreno,
 * - los choques (muros y muebles) en la capa en vivo de la rejilla (Rejilla.bloqueosDinamicos), y
 * - un «lugar» para el juego (`casa_<lote>`): ahí duerme el dueño cuando no está conectado y sale el
 *   letrero «Casa de …» al entrar.
 * Geometría: vecindario.ts (la misma del servidor).
 */
import Phaser from "phaser";
import type { EscenaBarrio } from "./escena";
import type { PuestoMapa } from "./tipos";
import { casaRect, modeloDe, nivelDe, type EstadoVecindario, type LoteEstado, type LoteMapa } from "./vecindario";

const T = 32;
const Z_PISO = -60000;
const col = (hex: string) => Phaser.Display.Color.HexStringToColor(hex).color;
const tono = (hex: string, f: number) => {
  const c = Phaser.Display.Color.HexStringToColor(hex);
  return f < 0 ? c.darken(-f).color : c.lighten(f).color;
};

interface Dibujo {
  clave: string;
  objs: Phaser.GameObjects.GameObject[];
  techo: Phaser.GameObjects.Graphics | null;
  rect: [number, number, number, number] | null;
  bloqueos: [number, number, number, number][];
  items: { id: number; x0: number; y0: number; x1: number; y1: number }[];
}

export class CasasVecindario {
  private dibujos = new Map<string, Dibujo>();
  private duenos = new Map<number, string>();          // usuario → lote
  v: EstadoVecindario | null = null;
  ocultarTecho: string | null = null;                  // el lote que se está decorando

  constructor(private esc: EscenaBarrio) {}

  get lotes(): LoteMapa[] {
    return this.esc.mapa.lotes ?? [];
  }

  lote(id: string): LoteMapa | null {
    return this.lotes.find((l) => l.id === id) ?? null;
  }

  loteDe(usuario: number): string | null {
    return this.duenos.get(usuario) ?? null;
  }

  /** El lugar donde vive (para que el motor la mande a dormir allá), si ya construyó. */
  /** Dónde van sus trofeos: la repisa de su casa si la puso (`casa_<lote>`), o null. */
  repisaDe(usuario: number): string | null {
    const id = this.duenos.get(usuario);
    return id && this.esc.mapa.puntos[`trofeos_casa_${id}`] ? `casa_${id}` : null;
  }

  lugarDe(usuario: number): string | null {
    const id = this.duenos.get(usuario);
    return id && this.esc.mapa.lugares[`casa_${id}`] ? `casa_${id}` : null;
  }

  sincronizar(v: EstadoVecindario, nombres: Record<number, string>) {
    this.v = v;
    this.duenos.clear();
    const bloqueos: [number, number, number, number][] = [];
    for (const lm of this.lotes) {
      const le = v.lotes.find((x) => x.id === lm.id) ?? null;
      if (le?.dueno) this.duenos.set(le.dueno, lm.id);
      const nombre = le?.dueno ? nombres[le.dueno] ?? "alguien" : "";
      const clave = JSON.stringify([le?.dueno, le?.casa, le?.items, nombre, le?.precio]);
      let d = this.dibujos.get(lm.id);
      if (!d || d.clave !== clave) {
        d?.objs.forEach((o) => o.destroy());
        d = this.dibujar(lm, le, nombre, clave);
        this.dibujos.set(lm.id, d);
      }
      bloqueos.push(...d.bloqueos);
      this.registrarLugares(lm, le, nombre);
    }
    this.esc.rejilla.bloqueosDinamicos(bloqueos);
  }

  /** El techo de cada casa se levanta si alguien que yo manejo está adentro (o si la estoy decorando). */
  techos(jx: number, jy: number) {
    for (const [id, d] of this.dibujos) {
      if (!d.techo || !d.rect) continue;
      const [x0, y0, x1, y1] = d.rect;
      const dentro = (jx > x0 && jx < x1 && jy > y0 && jy < y1 + 2) || this.ocultarTecho === id;
      const meta = dentro || this.esc.sinTechos ? 0 : 1;
      const a = d.techo.alpha + (meta - d.techo.alpha) * 0.18;
      d.techo.setAlpha(Math.abs(a - meta) < 0.01 ? meta : a);
    }
  }

  /** La cosa de mi casa que está bajo el puntero (para moverla o quitarla al decorar). */
  itemEn(lote: string, x: number, y: number): number | null {
    const d = this.dibujos.get(lote);
    if (!d) return null;
    let mejor: { id: number; y1: number } | null = null;
    for (const it of d.items) if (x >= it.x0 && x < it.x1 && y >= it.y0 && y < it.y1 && (!mejor || it.y1 > mejor.y1)) mejor = { id: it.id, y1: it.y1 };
    return mejor?.id ?? null;
  }

  private registrarLugares(lm: LoteMapa, le: LoteEstado | null, nombre: string) {
    const lugares = this.esc.mapa.lugares;
    const nivel = this.v && le?.casa ? nivelDe(this.v, le.casa.nivel) : null;
    lugares[`terreno_${lm.id}`] = {
      casa: "vecindario", titulo: le?.dueno ? (le.casa ? `Casa de ${nombre}` : `Terreno de ${nombre}`) : `Terreno en venta · ${lm.precio} ${this.v?.moneda ?? "monedas"}`,
      hace: le?.dueno ? (le.casa ? "Su casa en el vecindario" : "Todavía sin construir") : "Se compra en el letrero de la entrada",
      panel: "", etapas: [], rect: [lm.x, lm.y, lm.x + lm.lado * T, lm.y + lm.lado * T], afuera: true, puestos: [],
    };
    // Si puso la repisa de trofeos, sus trofeos se mudan a la casa (escena.trofeos usa este punto).
    const repisa = le?.casa ? le.items.find((i) => i.item === "repisa_trofeos") : undefined;
    const clavePunto = `trofeos_casa_${lm.id}`;
    if (repisa) {
      const rx = lm.x + (repisa.cx + 1) * T, ry = lm.y + (repisa.cy + 1) * T - 2;
      this.esc.mapa.puntos[clavePunto] = { x: rx - 15, y: ry - 30, dir: "abajo", columnas: 4, paso: 10, filas: 2, alto_fila: 22, sobre: ry + 1 };
    } else delete this.esc.mapa.puntos[clavePunto];
    if (!le?.casa || !nivel) { delete lugares[`casa_${lm.id}`]; return; }
    const { x0, y0, w, h } = casaRect(lm.frente, nivel);
    const hx0 = lm.x + x0 * T, hy0 = lm.y + y0 * T, hx1 = hx0 + w * T, hy1 = hy0 + h * T;
    const puestos: PuestoMapa[] = [];
    const cama = le.items.find((i) => i.item === "cama" || i.item === "cama_doble");
    if (cama) puestos.push({ x: lm.x + (cama.cx + 1) * T, y: lm.y + (cama.cy + 2) * T + 10, dir: "arriba", pose: "parado" } as PuestoMapa);
    puestos.push({ x: Math.round((hx0 + hx1) / 2), y: Math.round(hy0 + T + (hy1 - hy0 - T) / 2 + 8), dir: "abajo", pose: "parado" } as PuestoMapa);
    lugares[`casa_${lm.id}`] = { casa: "vecindario", titulo: `Casa de ${nombre}`, hace: "Su casa en el vecindario",
      panel: "", etapas: [], rect: [hx0, hy0, hx1, hy1], afuera: false, puestos };
  }

  private dibujar(lm: LoteMapa, le: LoteEstado | null, nombre: string, clave: string): Dibujo {
    const esc = this.esc, v = this.v;
    const objs: Phaser.GameObjects.GameObject[] = [];
    const bloqueos: [number, number, number, number][] = [];
    const items: Dibujo["items"] = [];
    // El letrero
    const texto = le?.dueno ? (le.casa ? `Casa de ${nombre}` : `Lote de ${nombre}`) : `Se vende · ${lm.precio}`;
    objs.push(esc.texto(lm.letrero.x, lm.letrero.y - 30, texto, 7, le?.dueno ? "#ffffff" : "#ffe14d", "#3b2414")
      .setOrigin(0.5, 0.5).setDepth(lm.letrero.y + 1));
    const nivel = v && le?.casa ? nivelDe(v, le.casa.nivel) : null;
    if (!v || !le?.dueno) return { clave, objs, techo: null, rect: null, bloqueos, items };
    if (!le.casa || !nivel) {
      // Comprado sin construir: dónde irá la casa, con línea punteada.
      const n1 = v.catalogo.niveles[0];
      const { x0, y0, w, h } = casaRect(lm.frente, n1);
      const g = esc.add.graphics().setDepth(Z_PISO);
      g.lineStyle(2, 0xfff1e8, 0.7);
      const ax = lm.x + x0 * T, ay = lm.y + y0 * T;
      for (let x = ax; x < ax + w * T; x += 12) { g.lineBetween(x, ay, Math.min(x + 6, ax + w * T), ay); g.lineBetween(x, ay + h * T, Math.min(x + 6, ax + w * T), ay + h * T); }
      for (let y = ay; y < ay + h * T; y += 12) { g.lineBetween(ax, y, ax, Math.min(y + 6, ay + h * T)); g.lineBetween(ax + w * T, y, ax + w * T, Math.min(y + 6, ay + h * T)); }
      objs.push(g);
      return { clave, objs, techo: null, rect: null, bloqueos, items };
    }
    const m = modeloDe(v, le.casa.modelo);
    const { x0, y0, w, h } = casaRect(lm.frente, nivel);
    const hx0 = lm.x + x0 * T, hy0 = lm.y + y0 * T, hx1 = hx0 + w * T, hy1 = hy0 + h * T;
    const c = lm.x + 4 * T;                    // centro de la puerta
    const g = esc.add.graphics().setDepth(Z_PISO);
    // Piso con tablas
    g.fillStyle(col(m.piso), 1).fillRect(hx0, hy0 + T, hx1 - hx0, hy1 - hy0 - T);
    g.fillStyle(tono(m.piso, -12), 0.55);
    for (let y = hy0 + T + 8; y < hy1; y += 8) g.fillRect(hx0, y, hx1 - hx0, 1);
    for (let y = hy0 + T, k = 0; y < hy1; y += 8, k++)
      for (let x = hx0 + (k % 2 ? 12 : 28); x < hx1; x += 32) g.fillRect(x, y, 1, 8);
    // Muro norte (la cara que se ve), con ventanas o con la puerta si la casa mira al norte
    g.fillStyle(col(m.pared), 1).fillRect(hx0, hy0, hx1 - hx0, T);
    g.fillStyle(tono(m.pared, -20), 1).fillRect(hx0, hy0, hx1 - hx0, 4).fillRect(hx0, hy0 + T - 3, hx1 - hx0, 3);
    const ventanas = lm.frente === "abajo" ? [hx0 + T * 0.9, hx1 - T * 0.9] : [hx0 + T * 0.9, hx1 - T * 0.9];
    for (const vx of ventanas) {
      g.fillStyle(0x1d2b53, 1).fillRect(vx - 9, hy0 + 8, 18, 14);
      g.fillStyle(0xbfe6f5, 1).fillRect(vx - 7, hy0 + 10, 14, 10);
      g.fillStyle(0xffffff, 0.8).fillRect(vx - 6, hy0 + 11, 4, 3);
    }
    if (lm.frente === "arriba") {
      g.fillStyle(0x3b2414, 1).fillRect(c - 13, hy0 + 4, 26, T - 4);
      g.fillStyle(col("#8f5a35"), 1).fillRect(c - 11, hy0 + 6, 22, T - 6);
    }
    // Muros de los lados y el del sur (con la puerta si la casa mira al sur)
    const muro = tono(m.pared, -28);
    g.fillStyle(muro, 1).fillRect(hx0, hy0, 6, hy1 - hy0).fillRect(hx1 - 6, hy0, 6, hy1 - hy0);
    if (lm.frente === "abajo") {
      g.fillRect(hx0, hy1 - 6, c - 16 - hx0, 6).fillRect(c + 16, hy1 - 6, hx1 - c - 16, 6);
      g.fillStyle(col("#8f5a35"), 1).fillRect(c - 16, hy1 - 4, 32, 4);
    } else g.fillRect(hx0, hy1 - 6, hx1 - hx0, 6);
    g.lineStyle(1, 0x271920, 0.8).strokeRect(hx0, hy0, hx1 - hx0, hy1 - hy0);
    objs.push(g);
    // Choques de los muros (la puerta queda libre)
    if (lm.frente === "arriba") bloqueos.push([hx0, hy0, c - 16, hy0 + T], [c + 16, hy0, hx1, hy0 + T]);
    else bloqueos.push([hx0, hy0, hx1, hy0 + T]);
    bloqueos.push([hx0, hy0, hx0 + 8, hy1], [hx1 - 8, hy0, hx1, hy1]);
    if (lm.frente === "abajo") bloqueos.push([hx0, hy1 - 8, c - 16, hy1], [c + 16, hy1 - 8, hx1, hy1]);
    else bloqueos.push([hx0, hy1 - 8, hx1, hy1]);
    // Lo que compró
    for (const o of le.items) {
      const it = v.catalogo.items.find((x) => x.id === o.item);
      if (!it) continue;
      const px = lm.x + (o.cx + it.w / 2) * T, py = lm.y + (o.cy + it.h) * T - 2;
      const img = esc.add.image(px, py, "objetos", `casa_${it.id}`);
      esc.origenDeCuadro(img);
      img.setDepth(it.capa === "suelo" ? Z_PISO + 1 : py);
      objs.push(img);
      const r: [number, number, number, number] = [lm.x + o.cx * T, lm.y + o.cy * T, lm.x + (o.cx + it.w) * T, lm.y + (o.cy + it.h) * T];
      items.push({ id: o.id, x0: r[0], y0: Math.min(r[1], py - img.displayHeight), x1: r[2], y1: r[3] });
      if (!it.pisable) bloqueos.push([r[0] + 4, r[1] + (it.h > 1 ? 4 : 10), r[2] - 4, r[3] - 2]);
    }
    // El techo (encima de quien está adentro; se levanta al entrar)
    const t = esc.add.graphics().setDepth(hy1 + 2);
    const tc = m.techo;
    t.fillStyle(col(tc), 1).fillRect(hx0 - 6, hy0 - 16, hx1 - hx0 + 12, hy1 - hy0 + 18);
    t.fillStyle(tono(tc, -18), 1);
    for (let y = hy0 - 10; y < hy1; y += 8) t.fillRect(hx0 - 6, y, hx1 - hx0 + 12, 2);
    t.fillStyle(tono(tc, 14), 1).fillRect(hx0 - 6, hy0 - 16 + Math.round((hy1 - hy0 + 18) / 2) - 2, hx1 - hx0 + 12, 4);
    t.fillStyle(0x5a5e6e, 1).fillRect(hx1 - 30, hy0 - 26, 12, 18);
    t.fillStyle(0x3b3d4a, 1).fillRect(hx1 - 32, hy0 - 28, 16, 4);
    t.lineStyle(2, 0x271920, 1).strokeRect(hx0 - 6, hy0 - 16, hx1 - hx0 + 12, hy1 - hy0 + 18);
    objs.push(t);
    return { clave, objs, techo: t, rect: [hx0, hy0, hx1, hy1], bloqueos, items };
  }
}
