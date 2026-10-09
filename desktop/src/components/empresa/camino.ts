/**
 * Caminos por el barrio: A* sobre la rejilla de choques de mapa.json (celdas de 16 px) y luego
 * «cuerda tirante» (se quitan los puntos intermedios que se ven entre sí) para que nadie camine
 * en zigzag de celda en celda. Lo usan los personajes que el juego mueve solo y el jugador cuando
 * toca el piso o pide «ir donde» alguien.
 */

export class Rejilla {
  readonly ancho: number;
  readonly alto: number;
  private libre: Uint8Array;

  constructor(filas: string[], readonly celda: number) {
    this.alto = filas.length;
    this.ancho = filas[0]?.length ?? 0;
    this.libre = new Uint8Array(this.ancho * this.alto);
    filas.forEach((f, y) => {
      for (let x = 0; x < f.length; x++) this.libre[y * this.ancho + x] = f.charCodeAt(x) === 48 ? 1 : 0;
    });
  }

  libreEn(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.ancho && cy < this.alto && this.libre[cy * this.ancho + cx] === 1;
  }

  /** ¿Cabe un pie de `w`×`h` px centrado en (x, y)? (y = la planta de los pies). */
  cabe(x: number, y: number, w = 16, h = 8): boolean {
    const c = this.celda;
    const x0 = Math.floor((x - w / 2) / c), x1 = Math.floor((x + w / 2 - 0.01) / c);
    const y0 = Math.floor((y - h) / c), y1 = Math.floor((y - 0.01) / c);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) if (!this.libreEn(cx, cy)) return false;
    return true;
  }

  /** La celda libre más cercana (por si alguien quedó encima de un mueble). */
  cercaLibre(x: number, y: number): { x: number; y: number } {
    const c = this.celda;
    const cx0 = Math.floor(x / c), cy0 = Math.floor(y / c);
    if (this.libreEn(cx0, cy0)) return { x, y };
    for (let r = 1; r < 40; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (this.libreEn(cx0 + dx, cy0 + dy)) return { x: (cx0 + dx) * c + c / 2, y: (cy0 + dy) * c + c - 2 };
      }
    }
    return { x, y };
  }

  private vista(ax: number, ay: number, bx: number, by: number): boolean {
    // Se recorre la recta en pasos de media celda revisando que quepa el pie.
    const d = Math.hypot(bx - ax, by - ay);
    const pasos = Math.ceil(d / (this.celda / 2));
    for (let i = 1; i < pasos; i++) {
      const t = i / pasos;
      if (!this.cabe(ax + (bx - ax) * t, ay + (by - ay) * t, 12, 6)) return false;
    }
    return true;
  }

  /** Camino de (ax, ay) a (bx, by) en px. Devuelve los puntos a seguir (sin el de partida), o
   *  `null` si no hay por dónde. `max` limita las celdas exploradas. */
  buscar(ax: number, ay: number, bx: number, by: number, max = 20000): { x: number; y: number }[] | null {
    const c = this.celda, W = this.ancho;
    const ini = this.cercaLibre(ax, ay), fin = this.cercaLibre(bx, by);
    const sx = Math.floor(ini.x / c), sy = Math.floor(Math.max(0, ini.y - 1) / c);
    const tx = Math.floor(fin.x / c), ty = Math.floor(Math.max(0, fin.y - 1) / c);
    if (sx === tx && sy === ty) return [{ x: bx, y: by }];
    const n = W * this.alto;
    const g = new Float32Array(n).fill(Infinity);
    const de = new Int32Array(n).fill(-1);
    const cerrado = new Uint8Array(n);
    const abiertos = new Monticulo();
    const h = (x: number, y: number) => {
      const dx = Math.abs(x - tx), dy = Math.abs(y - ty);
      return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy);
    };
    const s = sy * W + sx, t = ty * W + tx;
    g[s] = 0;
    abiertos.meter(s, h(sx, sy));
    let explorados = 0;
    while (abiertos.tamano) {
      const u = abiertos.sacar();
      if (u === t) break;
      if (cerrado[u]) continue;
      cerrado[u] = 1;
      if (++explorados > max) return null;
      const ux = u % W, uy = (u - ux) / W;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const vx = ux + dx, vy = uy + dy;
        if (!this.libreEn(vx, vy)) continue;
        // En diagonal no se corta esquina: las dos celdas de al lado tienen que estar libres.
        if (dx && dy && (!this.libreEn(ux + dx, uy) || !this.libreEn(ux, uy + dy))) continue;
        const v = vy * W + vx;
        const costo = g[u] + (dx && dy ? 1.4142 : 1);
        if (costo < g[v]) {
          g[v] = costo;
          de[v] = u;
          abiertos.meter(v, costo + h(vx, vy));
        }
      }
    }
    if (de[t] === -1) return null;
    const celdas: { x: number; y: number }[] = [];
    for (let k = t; k !== s && k !== -1; k = de[k]) {
      const kx = k % W, ky = (k - kx) / W;
      celdas.push({ x: kx * c + c / 2, y: ky * c + c - 2 });
    }
    celdas.reverse();
    celdas[celdas.length - 1] = { x: bx, y: by };
    // Cuerda tirante.
    const out: { x: number; y: number }[] = [];
    let ax_ = ini.x, ay_ = ini.y, i = 0;
    while (i < celdas.length) {
      let j = celdas.length - 1;
      while (j > i && !this.vista(ax_, ay_, celdas[j].x, celdas[j].y)) j--;
      out.push(celdas[j]);
      ax_ = celdas[j].x;
      ay_ = celdas[j].y;
      i = j + 1;
    }
    return out;
  }
}

/** Montículo binario de mínimos (índice, prioridad). */
class Monticulo {
  private ids: number[] = [];
  private pr: number[] = [];
  get tamano() { return this.ids.length; }
  meter(id: number, p: number) {
    const a = this.ids, b = this.pr;
    a.push(id); b.push(p);
    let i = a.length - 1;
    while (i > 0) {
      const padre = (i - 1) >> 1;
      if (b[padre] <= b[i]) break;
      [a[padre], a[i]] = [a[i], a[padre]];
      [b[padre], b[i]] = [b[i], b[padre]];
      i = padre;
    }
  }
  sacar(): number {
    const a = this.ids, b = this.pr;
    const top = a[0];
    const ua = a.pop()!, ub = b.pop()!;
    if (a.length) {
      a[0] = ua; b[0] = ub;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && b[l] < b[m]) m = l;
        if (r < a.length && b[r] < b[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        [b[m], b[i]] = [b[i], b[m]];
        i = m;
      }
    }
    return top;
  }
}
