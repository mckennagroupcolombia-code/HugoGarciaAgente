/**
 * Motor de Empresa viva: convierte cada foto del servidor (/api/empresa-viva/estado) en lo que
 * pasa en el barrio (escena.ts). No guarda ni decide nada de la operación: cada foto nueva se
 * vuelve destinos, y los personajes caminan hacia ellos (A* por las puertas, camino.ts).
 *
 * - El jugador (tú) se mueve con las flechas, el dedo o el mouse; los demás que también estén
 *   jugando llegan por /api/empresa-viva/jugador y se mueven como ellos los manejan.
 * - Quien no está jugando va solo al lugar del panel que tiene abierto (barrio.lugarDePanel) o al
 *   sitio de la tarea con cronómetro (barrio.TAREA); ausente, a su cuarto si vive en el barrio.
 * - Cada pregunta de MeLi o cliente de WhatsApp hace fila en la Tienda digital; cada compra es una
 *   caja que se alista y se lleva el mensajero en su moto; el proveedor llega en camión.
 */
import type Phaser from "phaser";
import { PANEL_INFO } from "../../lib/panelInfo";
import type { Panel } from "../../stores/app";
import { CAFE, TAREA, infoModulo, lugarDePanel, type CasaId } from "./barrio";
import type { EscenaBarrio, Figura, Paso } from "./escena";
import { avatarDeSemilla, normalizarAvatar, type Catalogo } from "./personajes";
import type {
  AvatarPixel, Dir, EstadoEmpresa, EventoApi, InteraccionApi, JugadorApi, PersonaApi, Pose,
} from "./tipos";

const VEL_PERSONA = 78;
const VEL_CARRO = 190;

function primerNombre(n: string): string {
  return (n || "").trim().split(/\s+/)[0] || "";
}
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
const corto = (t: string, n = 46) => (t.length > n ? `${t.slice(0, n - 2)}…` : t);

export interface OpcionesMotor {
  onSonido: (n: string) => void;
  catalogo: Catalogo | null;
}

export class Motor {
  private estado: EstadoEmpresa | null = null;
  private ultimoSeq = -1;
  private interVistas = new Set<string>();
  private accVistas = new Set<string>();
  private remotos = new Map<number, JugadorApi>();
  private mensajeroVuelve = 0;
  private slots: { img: Phaser.GameObjects.Image; marca: Phaser.GameObjects.Rectangle }[] = [];
  private casillas = { vacias: -1, criticas: -1 };
  private avisoBodega: Phaser.GameObjects.Text | null = null;
  private reducido: boolean;

  constructor(private esc: EscenaBarrio, private op: OpcionesMotor) {
    this.reducido = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    this.crearHugo();
    this.crearEstantes();
  }

  private get mapa() { return this.esc.mapa; }
  private punto(nombre: string): Paso & { dir: Dir } {
    const p = this.mapa.puntos[nombre] as { x: number; y: number; dir: Dir } | undefined;
    return p ? { x: p.x, y: p.y, dir: p.dir } : { x: this.mapa.ancho / 2, y: this.mapa.alto / 2, dir: "abajo" };
  }
  private casaDeLugar(l: string): CasaId {
    return (this.mapa.lugares[l]?.casa ?? "sede") as CasaId;
  }

  // ─── El jugador ────────────────────────────────────────────────────────────

  crearJugador(est: EstadoEmpresa, inicio: { x: number; y: number; dir: Dir } | null): Figura {
    const yo = est.personas.find((p) => p.id === est.yo);
    let pos = inicio;
    if (!pos) {
      const cfg = yo ? est.casas?.usuarios?.[yo.username] : undefined;
      const lugar = (cfg?.trabaja && this.mapa.lugares[cfg.trabaja]) ? cfg.trabaja : "tienda";
      const pu = this.mapa.lugares[lugar]?.puestos.find((p) => p.pose === "parado") ?? this.mapa.lugares[lugar]?.puestos[0];
      pos = pu ? { x: pu.x, y: pu.y + 24, dir: "abajo" } : { x: this.punto("llegada_oeste").x + 60, y: this.punto("llegada_oeste").y, dir: "derecha" };
    }
    const libre = this.esc.rejilla.cercaLibre(pos.x, pos.y);
    const f = this.esc.crearFigura(`p${est.yo}`, "jugador", libre.x, libre.y, pos.dir);
    f.vel = VEL_PERSONA;
    this.esc.jugador = f;
    if (yo) void this.esc.vestir(f, this.avatarDe(yo, est));
    return f;
  }

  private avatarDe(p: PersonaApi, est: EstadoEmpresa): AvatarPixel {
    const cfg = est.casas?.usuarios?.[p.username];
    return normalizarAvatar(p.avatar?.pixel ?? cfg?.pixel ?? null, `persona-${p.id}`, this.op.catalogo);
  }

  // ─── Sincronizar con el servidor ───────────────────────────────────────────

  sincronizar(est: EstadoEmpresa) {
    const primera = this.estado === null;
    this.estado = est;
    const nuevos = primera ? [] : est.eventos.filter((e) => e.seq > this.ultimoSeq);
    this.ultimoSeq = Math.max(this.ultimoSeq, ...est.eventos.map((e) => e.seq), -1);
    const evento = new Map(nuevos.map((e) => [e.objeto, e]));
    const vivos = new Set<string>(["hugo"]);
    const sonidos = new Set<string>();
    if (!this.esc.jugador) this.crearJugador(est, null);
    vivos.add(`p${est.yo}`);

    this.sincronizarPersonas(est, primera, vivos);
    this.sincronizarVisitantes(est, primera, vivos, sonidos);
    this.sincronizarPaquetes(est, primera, vivos, evento, sonidos);
    this.sincronizarProveedores(est, primera, vivos, sonidos);
    this.sincronizarMensajero(est, primera, vivos, nuevos, sonidos);
    this.sincronizarBodega(est);
    this.sincronizarPendientes(est);
    this.nombrarCuartos(est);
    this.sincronizarInteracciones(est, primera, sonidos);
    this.sincronizarAcciones(est, primera, sonidos);
    this.ocupantes(est);

    for (const f of [...this.esc.figuras.values()]) {
      if (vivos.has(f.id) || f.sale || f.tipo === "jugador") continue;
      this.despedir(f, evento, sonidos);
    }
    for (const n of sonidos) this.op.onSonido(n);
  }

  /** Lo que se lee bajo el nombre: lo que hace con las manos, o el panel donde está. */
  queHace(p: PersonaApi, jugando = false): string {
    const t = p.tarea ? TAREA[p.tarea.funcion] : undefined;
    if (t) return t.corto;
    if (p.tarea?.hace) return p.tarea.hace;
    const modulo = this.remotos.get(p.id)?.modulo;
    if (jugando && modulo === "ajedrez") return "Jugando ajedrez en el parque";
    if (jugando && modulo === "tenis") return "Jugando tenis en el parque";
    if (jugando && modulo) return `Usando ${infoModulo(modulo).nombre}`;
    if (jugando) return "Paseando por el barrio";
    if (!(p.presente ?? p.en_linea)) return "";
    if (p.via === "whatsapp") return "Por WhatsApp";
    const info = PANEL_INFO[p.panel as Panel];
    return info && lugarDePanel(p.panel) ? info.label : "En su puesto";
  }

  /** Otros jugadores: posición y pose como ellos los manejan. */
  jugadores(lista: JugadorApi[]) {
    const ahora = Date.now() / 1000;
    this.remotos = new Map(lista.filter((j) => ahora - j.t < 12).map((j) => [j.id, j]));
    for (const [id, j] of this.remotos) {
      const f = this.esc.figuras.get(`p${id}`);
      if (!f || f.tipo === "jugador") continue;
      f.remoto = { x: j.x, y: j.y, dir: j.dir, pose: j.pose, t: j.t };
      f.ruta = [];
    }
    for (const f of this.esc.figuras.values()) {
      if (f.remoto && !this.remotos.has(Number(f.id.slice(1)))) {
        // Dejó de jugar: vuelve a su sitio solo.
        f.remoto = null;
        f.x = Math.round(f.x); f.y = Math.round(f.y);
        if (f.base) this.esc.irA(f, f.base);
      }
    }
    if (this.estado) this.sincronizarPersonas(this.estado, false, new Set());
  }

  jugando(id: number): boolean {
    return this.remotos.has(id);
  }

  private sincronizarPersonas(est: EstadoEmpresa, primera: boolean, vivos: Set<string>) {
    const cfg = est.casas?.usuarios ?? {};
    const conPuesto = new Map<string, PersonaApi[]>();
    const fijos: { p: PersonaApi; l: string; base: Paso; ronda?: Paso[] }[] = [];
    for (const p of est.personas) {
      if (p.id === est.yo) {
        const j = this.esc.jugador;
        if (j) void this.esc.vestir(j, this.avatarDe(p, est));
        continue;
      }
      const c = cfg[p.username] ?? {};
      const remoto = this.remotos.get(p.id);
      const presente = Boolean(remoto) || (p.presente ?? p.en_linea);
      const t = p.tarea ? TAREA[p.tarea.funcion] : undefined;
      let l: string | null;
      if (!presente) l = c.cuarto ?? null;
      else l = t?.lugar ?? lugarDePanel(p.panel) ?? c.trabaja ?? (c.vive === "bunker" ? "gerencia" : "oficina_sede");
      if (!l || !this.mapa.lugares[l]) continue;
      // Con un módulo abierto (y sin tarea con las manos), va al objeto de ese módulo: Facturación
      // es un escritorio de la oficina de la sede, el Libro Mayor la biblioteca de contabilidad…
      const estacion = presente && !t?.lugar && (remoto || p.via === "panel") ? this.estacionPara(p.panel, c) : null;
      if (estacion && !remoto) {
        const uso = estacion.uso;
        fijos.push({ p, l: this.lugarDeEstacion(estacion), base: { x: uso.x, y: uso.y, dir: uso.dir, pose: uso.pose === "sentado" ? "sentado" : "quieto" } });
        continue;
      }
      if (presente && t?.lugar === l && (t.punto || t.ronda)) {
        const pts = (t.ronda ?? [t.punto!]).map((n) => ({ ...this.punto(n), pose: (t.sentado ? "sentado" : "quieto") as Pose }));
        fijos.push({ p, l, base: pts[0], ronda: t.ronda ? pts : undefined });
      } else conPuesto.set(l, [...(conPuesto.get(l) ?? []), p]);
    }
    const ubicar = (p: PersonaApi, l: string, base: Paso, ronda?: Paso[]) => {
      const id = `p${p.id}`;
      vivos.add(id);
      const c = cfg[p.username] ?? {};
      const remoto = this.remotos.get(p.id);
      const presente = Boolean(remoto) || (p.presente ?? p.en_linea);
      const ex = { tipo: "persona" as const, datos: p, lugar: l, rol: c.rol, jugando: Boolean(remoto) };
      let f = this.esc.figuras.get(id);
      if (f && f.sale) { this.esc.quitarFigura(f); f = undefined; }
      if (!f) {
        // Quien vive en el barrio ya está en su casa; los demás llegan caminando por el andén.
        const vive = Boolean(c.vive);
        const desde = remoto ? { x: remoto.x, y: remoto.y } : primera || vive ? base : this.punto("llegada_oeste");
        f = this.esc.crearFigura(id, "persona", desde.x, desde.y, base.dir ?? "abajo");
        f.vel = VEL_PERSONA;
        f.vidaEn = performance.now() + 8000 + (hash(id) % 20000);
        f.rondaK = 0;
        if (!remoto && desde.x === base.x && desde.y === base.y) { f.pose = base.pose ?? "quieto"; f.dir = base.dir ?? "abajo"; }
      }
      // Una ronda que sigue igual (alistar, aseo) se deja donde iba; si no, nuevo destino.
      const mismaRonda = Boolean(ronda && f.ronda && ronda.length === f.ronda.length
        && ronda.every((r, k) => r.x === f!.ronda![k].x && r.y === f!.ronda![k].y));
      if (!mismaRonda) {
        const cambia = f.lugar !== l || f.base?.x !== base.x || f.base?.y !== base.y;
        f.ronda = ronda;
        f.rondaK = 0;
        f.base = base;
        if (cambia && !f.remoto && f.tipo === "persona" && (f.x !== base.x || f.y !== base.y)) this.esc.irA(f, base);
      }
      f.lugar = l;
      f.ex = ex;
      f.presente = presente;
      f.ocupado = Boolean(p.tarea && TAREA[p.tarea.funcion]?.lugar);
      void this.esc.vestir(f, this.avatarDe(p, est));
      this.esc.ponerNombre(f, primerNombre(p.nombre), this.queHace(p, Boolean(remoto)), p.avatar?.color || undefined);
      if (!presente) this.esc.ponerIcono(f, "z z z", "#bfe3ff");
      else if (remoto) this.esc.ponerIcono(f, "★", "#ffe14d");
      else if (p.via === "whatsapp" && !p.tarea) this.esc.ponerIcono(f, "WA", "#25d366");
      else this.esc.ponerIcono(f, this.respuestaPendiente(p.id) ? "!" : null, "#ff9f1c");
    };
    // Dos personas en el mismo objeto: la segunda se para al lado.
    const ocupados = new Map<string, number>();
    for (const fj of fijos) {
      const k = `${fj.base.x},${fj.base.y}`;
      const n = ocupados.get(k) ?? 0;
      ocupados.set(k, n + 1);
      const base = n ? { ...fj.base, x: fj.base.x + (n % 2 ? 26 : -26) * Math.ceil(n / 2), pose: "quieto" as Pose } : fj.base;
      ubicar(fj.p, fj.l, base, fj.ronda);
    }
    for (const [l, gente] of conPuesto) {
      const puestos = this.mapa.lugares[l].puestos;
      gente.forEach((p, i) => {
        const pu = puestos[i % Math.max(1, puestos.length)] ?? { x: this.mapa.lugares[l].rect[0] + 64, y: this.mapa.lugares[l].rect[1] + 120, dir: "abajo", pose: "parado" };
        const extra = Math.floor(i / Math.max(1, puestos.length));
        const presente = this.remotos.has(p.id) || (p.presente ?? p.en_linea);
        const pose: Pose = pu.pose === "sentado" ? "sentado" : "quieto";
        ubicar(p, l, { x: pu.x + extra * 22, y: pu.y + extra * 6, dir: presente ? pu.dir : "abajo", pose });
      });
    }
  }

  /** ¿Esa persona me escribió o me respondió algo hace poco? (un «!» sobre su cabeza hasta que lo leo). */
  respuestaPendiente(id: number): InteraccionApi | null {
    const est = this.estado;
    if (!est) return null;
    const vistas = respuestasLeidas();
    return (est.interacciones ?? []).find((i) => (i.tipo === "respuesta" || i.tipo === "chat") && i.de === id
      && i.para.includes(est.yo) && !vistas.has(i.id)) ?? null;
  }

  private sincronizarVisitantes(est: EstadoEmpresa, primera: boolean, vivos: Set<string>, sonidos: Set<string>) {
    const fila = this.mapa.puntos.fila?.puntos ?? [];
    est.visitantes.forEach((v, i) => {
      const id = `v${v.id}`;
      vivos.add(id);
      const p = fila[Math.min(i, fila.length - 1)] ?? this.punto("mostrador_cliente");
      const base: Paso = { x: p.x + (i >= fila.length ? (i - fila.length + 1) * 30 : 0), y: p.y, dir: i < 5 ? "arriba" : "izquierda", pose: "quieto" };
      const ex = { tipo: "visitante" as const, datos: v };
      let f = this.esc.figuras.get(id);
      if (f) {
        if (f.base?.x !== base.x || f.base?.y !== base.y) this.esc.irA(f, base);
        f.base = base; f.ex = ex;
        return;
      }
      const desde = primera ? base : this.punto("llegada_este");
      f = this.esc.crearFigura(id, "visitante", desde.x, desde.y, "izquierda");
      f.vel = VEL_PERSONA * 1.1;
      f.base = base; f.ex = ex;
      if (!primera) this.esc.irA(f, base);
      const preset = est.casas?.clientes?.length ? est.casas.clientes[hash(v.id) % est.casas.clientes.length] : null;
      void this.esc.vestir(f, preset ? normalizarAvatar(preset, `cliente-${v.id}`, this.op.catalogo) : avatarDeSemilla(`cliente-${v.id}`, this.op.catalogo));
      this.esc.ponerIcono(f, v.tipo === "whatsapp" ? "…" : "?", v.tipo === "whatsapp" ? "#25d366" : "#ffe600");
      if (!primera) sonidos.add("vender");
    });
  }

  private grilla(nombre: string, i: number): Paso {
    const p = this.mapa.puntos[nombre] as { x: number; y: number; columnas?: number; paso?: number; sobre?: number } | undefined;
    if (!p) return { x: 0, y: 0 };
    const col = i % (p.columnas ?? 6), fila = Math.floor(i / (p.columnas ?? 6));
    return { x: p.x + col * (p.paso ?? 14), y: p.y + fila * 10, sobre: p.sobre };
  }

  private sincronizarPaquetes(est: EstadoEmpresa, primera: boolean, vivos: Set<string>, evento: Map<string, EventoApi>, sonidos: Set<string>) {
    let iMesa = 0, iPorton = 0;
    for (const p of est.paquetes) {
      const id = `k${p.id}`;
      const f = this.esc.figuras.get(id);
      if (p.estado === "en_ruta") {
        if (f && !f.sale) this.alaMoto(f);
        if (f) vivos.add(id);
        continue;
      }
      vivos.add(id);
      const alistado = p.estado === "alistado";
      const pos = this.grilla(alistado ? "paquetes_alistados" : "paquetes_por_alistar", alistado ? iPorton++ : iMesa++);
      const base: Paso = { x: pos.x, y: pos.y, sobre: pos.sobre };
      const ex = { tipo: "paquete" as const, datos: p };
      if (f) {
        const estabaEnMesa = f.base && f.base.y < this.mapa.casas.sede.rect[3];
        if (estabaEnMesa && alistado) {
          this.esc.irA(f, base);
          const ev = evento.get(p.id);
          if (ev?.tipo === "alistado") { sonidos.add("preparar"); this.celebrar(ev.por, "¡Alistado!"); }
        } else if (f.base?.x !== base.x || f.base?.y !== base.y) this.esc.irA(f, base);
        f.base = base; f.ex = ex;
        continue;
      }
      const n = this.esc.crearFigura(id, "objeto", base.x, base.y);
      n.spr.setTexture("objetos", `caja_${p.canal}`).setOrigin(0.5, 1).setVisible(true);
      n.vel = VEL_PERSONA * 1.2;
      n.base = base; n.ex = ex;
      if (!primera) { n.aparecer = this.esc.time.now + 500; this.esc.ponerGlobo(n, "¡Nueva venta!", 4000, 0xfff6a8); sonidos.add("vender"); }
    }
  }

  private alaMoto(f: Figura) {
    const moto = this.esc.figuras.get("moto");
    const destino = moto ? { x: moto.x + 10, y: moto.y - 4 } : this.punto("moto");
    this.esc.irA(f, destino);
    f.sale = true;
  }

  private sincronizarProveedores(est: EstadoEmpresa, primera: boolean, vivos: Set<string>, sonidos: Set<string>) {
    const pv = est.proveedores.find((p) => p.estado === "descargando");
    if (!pv) return;
    const ex = { tipo: "proveedor" as const, datos: pv };
    vivos.add("camion"); vivos.add("proveedor");
    const parqueo = this.punto("camion");
    let camion = this.esc.figuras.get("camion");
    if (!camion) {
      camion = this.vehiculo("camion", "camion", primera ? parqueo : { x: -140, y: parqueo.y }, false);
      camion.base = parqueo;
      if (!primera) {
        // Llega por la calle; el proveedor se baja cuando el camión se estaciona.
        camion.ruta = [parqueo];
        camion.alLlegar = () => this.bajarProveedor(est, false);
        sonidos.add("abastecer");
      }
    }
    camion.ex = ex;
    if (primera) this.bajarProveedor(est, true);
    const pf = this.esc.figuras.get("proveedor");
    if (pf) pf.ex = ex;
    const n = Math.max(2, Math.min(8, pv.items || 4));
    for (let i = 0; i < n; i++) {
      const id = `c${pv.id}-${i}`;
      vivos.add(id);
      if (this.esc.figuras.has(id)) continue;
      const pos = this.grilla("cajas_proveedor", i);
      const c = this.esc.crearFigura(id, "objeto", pos.x, pos.y);
      c.spr.setTexture("objetos", "caja_proveedor").setOrigin(0.5, 1).setVisible(true).setScale(1.6);
      c.base = { x: pos.x, y: pos.y };
      c.ex = ex;
      // Las cajas aparecen cuando el proveedor ya las bajó.
      if (!primera) { c.spr.setVisible(false); this.esc.time.delayedCall(9000 + i * 450, () => { c.spr.setVisible(true); c.aparecer = this.esc.time.now + 500; }); }
    }
  }

  private bajarProveedor(est: EstadoEmpresa, primera: boolean) {
    if (this.esc.figuras.has("proveedor")) return;
    const pv = this.estado?.proveedores.find((p) => p.estado === "descargando");
    const camion = this.esc.figuras.get("camion");
    if (!pv || !camion) return;
    const puesto = { ...this.punto("proveedor"), pose: "quieto" as Pose };
    const desde = primera ? puesto : this.esc.rejilla.cercaLibre(camion.x + 40, camion.y - 60);
    const pf = this.esc.crearFigura("proveedor", "proveedor", desde.x, desde.y, "arriba");
    pf.vel = VEL_PERSONA;
    pf.base = puesto;
    pf.ex = { tipo: "proveedor", datos: pv };
    if (!primera) this.esc.irA(pf, puesto);
    void this.esc.vestir(pf, normalizarAvatar(est.casas?.proveedor ?? { delantal: "overol", color_delantal: "blue" }, "proveedor", this.op.catalogo));
  }

  private vehiculo(id: string, cuadro: string, desde: { x: number; y: number }, miraIzquierda: boolean): Figura {
    const f = this.esc.crearFigura(id, "vehiculo", desde.x, desde.y, miraIzquierda ? "izquierda" : "derecha");
    f.vehiculo = true;
    f.vel = VEL_CARRO;
    f.spr.setTexture("objetos", cuadro).setVisible(true);
    this.esc.origenDeCuadro(f.spr);
    f.spr.setData("miraIzquierda", miraIzquierda);
    return f;
  }

  private sincronizarMensajero(est: EstadoEmpresa, primera: boolean, vivos: Set<string>, nuevos: EventoApi[], sonidos: Set<string>) {
    const alistados = est.paquetes.filter((p) => p.estado === "alistado").length;
    const salio = nuevos.some((e) => e.tipo === "salio");
    const moto = this.esc.figuras.get("moto");
    const ex = { tipo: "mensajero" as const, alistados };
    if (moto) moto.ex = ex;
    const m = this.esc.figuras.get("mensajero");
    if (m) m.ex = ex;
    if (moto && !moto.sale && !primera && (salio || alistados === 0)) {
      // Recoge y se va hacia el occidente; vuelve después si quedan paquetes alistados.
      this.mensajeroVuelve = performance.now() + 14000;
      if (m && !m.sale) {
        this.esc.irA(m, { x: moto.x + 6, y: moto.y - 6 });
        m.sale = true;
      }
      moto.pausaHasta = this.esc.time.now + 3500;
      moto.ruta = [{ x: -160, y: moto.y }];
      moto.sale = true;
      sonidos.add("entregar");
      return;
    }
    if (moto) vivos.add("moto");
    if (m) vivos.add("mensajero");
    if (alistados === 0 || moto || performance.now() < this.mensajeroVuelve) return;
    const parqueo = this.punto("moto");
    const nm = this.vehiculo("moto", "moto", primera ? parqueo : { x: this.mapa.ancho + 120, y: parqueo.y }, true);
    nm.base = parqueo; nm.ex = ex;
    vivos.add("moto"); vivos.add("mensajero");
    if (primera) this.bajarMensajero(est, true);
    else {
      // Llega en la moto y se baja cuando se estaciona frente al portón.
      nm.ruta = [parqueo];
      nm.alLlegar = () => this.bajarMensajero(est, false);
    }
  }

  private bajarMensajero(est: EstadoEmpresa, primera: boolean) {
    const moto = this.esc.figuras.get("moto");
    if (this.esc.figuras.has("mensajero") || !moto) return;
    const puesto = { ...this.punto("mensajero"), pose: "quieto" as Pose };
    const desde = primera ? puesto : this.esc.rejilla.cercaLibre(moto.x - 6, moto.y - 22);
    const mf = this.esc.crearFigura("mensajero", "mensajero", desde.x, desde.y, "arriba");
    mf.vel = VEL_PERSONA;
    mf.base = puesto;
    mf.ex = moto.ex;
    if (!primera) this.esc.irA(mf, puesto);
    void this.esc.vestir(mf, normalizarAvatar(est.casas?.mensajero ?? { torso: "buzo", color_torso: "red" }, "mensajero", this.op.catalogo));
  }

  // ─── Bodega: cada casilla de los estantes es una parte del catálogo ─────────

  private crearEstantes() {
    for (const [k, s] of this.mapa.estantes.entries()) {
      const img = this.esc.add.image(s.x, s.y, "objetos", `frasco${(hash(`f${k}`) % 6)}`).setOrigin(0.5, 1).setDepth(s.z + 1);
      const marca = this.esc.add.rectangle(s.x, s.y - 1, 9, 2, 0xff3b3b).setDepth(s.z + 1).setVisible(false);
      this.slots.push({ img, marca });
    }
  }

  private sincronizarBodega(est: EstadoEmpresa) {
    const b = est.bodega;
    if (!b) return;
    const n = this.slots.length;
    const total = Math.max(1, b.publicaciones);
    const vacias = Math.round(n * b.agotados / total);
    const criticas = Math.round(n * b.criticos / total);
    const txt = b.agotados + b.criticos ? `${b.agotados} agotados · ${b.criticos} por acabarse` : "Bodega al día";
    if (!this.avisoBodega) {
      const p = this.punto("aviso_bodega");
      this.avisoBodega = this.esc.texto(p.x, p.y, txt, 9, "#ffffff", "#b42318").setOrigin(0.5, 0).setDepth(p.y + 70);
    } else this.avisoBodega.setText(txt);
    if (this.casillas.vacias === vacias && this.casillas.criticas === criticas) return;
    this.casillas = { vacias, criticas };
    const orden = [...Array(n).keys()].sort((a, c) => hash(`c${a}x`) - hash(`c${c}x`));
    orden.forEach((idx, k) => {
      const s = this.slots[idx];
      const vacia = k < vacias, critica = !vacia && k < vacias + criticas;
      s.img.setVisible(!vacia);
      s.marca.setVisible(vacia);
      this.esc.tweens.killTweensOf(s.img);
      s.img.setAlpha(1);
      if (critica) {
        s.img.setTint(0xffa060);
        if (!this.reducido) this.esc.tweens.add({ targets: s.img, alpha: 0.55, duration: 700, yoyo: true, repeat: -1 });
      } else s.img.clearTint();
    });
  }

  /** Lo detenido del Mapa (recortado a permisos), como globito rojo sobre el objeto de cada módulo. */
  private sincronizarPendientes(est: EstadoEmpresa) {
    const por: Record<string, { n: number; alta: boolean }> = {};
    for (const etapa of Object.values(est.oficina ?? {}))
      for (const it of etapa.items ?? []) {
        const a = (por[it.panel] ??= { n: 0, alta: false });
        a.n += it.n;
        a.alta ||= it.severidad === "alta";
      }
    this.esc.pendientes(por);
  }

  private nombrarCuartos(est: EstadoEmpresa) {
    const nombres = new Map(est.personas.map((p) => [p.username, primerNombre(p.nombre)]));
    for (const [username, c] of Object.entries(est.casas?.usuarios ?? {})) {
      if (c.cuarto && nombres.get(username)) this.esc.nombrarCuarto(c.cuarto, `Cuarto de ${nombres.get(username)}`);
    }
  }

  /** El objeto del módulo que la persona tiene abierto (si hay dos, el de su casa). */
  private estacionPara(panel: string, cfg: { vive?: string; trabaja?: string }) {
    const casa = cfg.vive ?? (cfg.trabaja ? this.mapa.lugares[cfg.trabaja]?.casa : undefined);
    return this.esc.estacionDe(panel, undefined, casa);
  }

  /** El lugar de un objeto; los de los pasillos cuentan como de su casa (su primer lugar). */
  private lugarDeEstacion(e: { lugar: string; x: number; z: number }): string {
    if (this.mapa.lugares[e.lugar]) return e.lugar;
    const casa = this.esc.casaDe(e.x, e.z - 2);
    return Object.entries(this.mapa.lugares).find(([, l]) => l.casa === casa && !l.afuera)?.[0] ?? "oficina_sede";
  }

  private crearHugo() {
    const p = this.punto("hugo");
    const f = this.esc.crearFigura("hugo", "hugo", p.x, p.y, "abajo");
    f.spr.setTexture("hugo", 0).setOrigin(24 / 48, 60 / 64).setVisible(true);
    f.vel = 0;
    f.base = { x: p.x, y: p.y };
    f.ex = { tipo: "hugo" };
    this.esc.ponerNombre(f, "Hugo", "Agente de IA", "#9fd6ff");
  }

  /** Quién está adentro de cada casa (se escribe sobre el techo cuando estás afuera). */
  private ocupantes(est: EstadoEmpresa) {
    const por: Record<string, string[]> = {};
    for (const f of this.esc.figuras.values()) {
      if (f.tipo !== "persona" || f.ex?.tipo !== "persona" || !f.presente) continue;
      const casa = this.esc.casaDe(f.x, f.y);
      if (casa) (por[casa] ??= []).push(primerNombre(f.ex.datos.nombre));
    }
    for (const casa of Object.keys(this.mapa.casas)) this.esc.ocupantes(casa, por[casa] ?? []);
    void est;
  }

  // ─── Quién le habla a quién: avioncitos de papel ───────────────────────────

  private sincronizarInteracciones(est: EstadoEmpresa, primera: boolean, sonidos: Set<string>) {
    const ahora = Date.now() / 1000;
    for (const it of est.interacciones ?? []) {
      if (this.interVistas.has(it.id)) continue;
      this.interVistas.add(it.id);
      if (primera && ahora - it.ts > 90) continue;
      if (this.lanzar(it, est)) sonidos.add(it.tipo === "pregunta" || it.tipo === "solicitud" || it.tipo === "chat" ? "vista" : "blip");
    }
  }

  /** Lanza los avioncitos de una interacción. También lo usa el panel justo después de preguntar
   *  o compartir, para que se vea al instante (la foto del servidor la trae luego con el mismo id). */
  lanzar(it: InteraccionApi, est: EstadoEmpresa | null = this.estado): boolean {
    this.interVistas.add(it.id);
    const de = this.esc.figuras.get(`p${it.de}`);
    if (!de || !est) return false;
    const presentes = new Set(est.personas.filter((p) => p.presente ?? p.en_linea).map((p) => `p${p.id}`));
    const para = it.todos
      ? [...this.esc.figuras.values()].filter((f) => (f.tipo === "persona" || f.tipo === "jugador") && f.id !== de.id && presentes.has(f.id))
      : it.para.map((id) => this.esc.figuras.get(`p${id}`)).filter((f): f is Figura => Boolean(f));
    const nombre = (id: number) => primerNombre(est.personas.find((p) => p.id === id)?.nombre ?? "");
    const nombreDe = nombre(it.de);
    const nombrePara = para.length === 1 ? nombre(Number(para[0].id.slice(1))) : "";
    const sale: Record<string, string> = {
      pregunta: it.texto ? `«${corto(it.texto)}»` : nombrePara ? `Pregunta para ${nombrePara}` : "Pregunta",
      solicitud: it.texto ? corto(it.texto) : nombrePara ? `Solicitud para ${nombrePara}` : "Solicitud",
      respuesta: it.texto ? corto(it.texto) : "Respondió",
      grupo: it.canal ? `En «${it.canal}»` : "Escribió en un grupo",
      idea: it.texto ? corto(it.texto) : it.canal ? `Idea en «${it.canal}»` : "Compartió una idea",
      chat: it.texto ? `«${corto(it.texto)}»` : "…",
    };
    const llega: Record<string, string> = {
      pregunta: `Pregunta de ${nombreDe}`, solicitud: `Solicitud de ${nombreDe}`, respuesta: `${nombreDe} te respondió`,
      grupo: it.canal ? `${nombreDe} en «${it.canal}»` : `Mensaje de ${nombreDe}`, idea: `Idea de ${nombreDe}`,
      chat: `${nombreDe} te escribió`,
    };
    // Pregunta a alguien de la misma casa (y nadie lo maneja): camina hasta su puesto y conversan.
    const uno = para.length === 1 ? para[0] : null;
    if ((it.tipo === "pregunta" || it.tipo === "solicitud" || it.tipo === "chat") && uno && de.tipo === "persona" && !de.remoto && de.lugar && uno.lugar
        && this.casaDeLugar(de.lugar) === this.casaDeLugar(uno.lugar) && de.presente && uno.presente && !de.ruta.length && !de.ronda && !this.reducido) {
      this.visitar(de, uno, sale[it.tipo] ?? "…", 5500);
      return true;
    }
    this.esc.ponerGlobo(de, sale[it.tipo] ?? "", 5000, it.tipo === "idea" ? 0xfff6a8 : 0xffffff);
    para.slice(0, 8).forEach((destino, i) => {
      this.esc.avion(de, destino, it.tipo, i * 280, () => {
        if (!this.esc.figuras.has(destino.id)) return;
        this.esc.ponerGlobo(destino, it.tipo === "respuesta" && nombrePara ? `${nombreDe} te respondió` : llega[it.tipo] ?? "", 5500, 0xe8f4ff);
        if (!destino.remoto && destino.tipo !== "jugador" && destino.pose !== "sentado") destino.momento = { pose: "celebra", hasta: this.esc.time.now + 900 };
      });
    });
    return true;
  }

  private celebrar(por: EventoApi["por"], texto: string) {
    if (por?.bot) {
      const h = this.esc.figuras.get("hugo");
      if (h) { this.esc.ponerGlobo(h, "¡Respondí!", 5000, 0xdff3ff); h.momento = { pose: "celebra", hasta: this.esc.time.now + 1200 }; }
      return;
    }
    if (!por?.id) return;
    const f = this.esc.figuras.get(`p${por.id}`);
    if (!f || f.sale) return;
    this.esc.ponerGlobo(f, texto, 5500, 0xd9ffd9);
    if (f.pose !== "sentado" && !f.remoto && f.tipo !== "jugador") f.momento = { pose: "celebra", hasta: this.esc.time.now + 1600 };
  }

  private despedir(f: Figura, evento: Map<string, EventoApi>, sonidos: Set<string>) {
    if (f.tipo === "hugo" || f.id === "moto" || f.id === "mensajero") return;
    if (f.tipo === "persona") {
      f.sale = true;
      this.esc.irA(f, this.punto("llegada_oeste"));
      return;
    }
    if (f.tipo === "visitante") {
      const ev = evento.get(f.id.slice(1));
      const quien = ev?.por?.bot ? "Hugo" : primerNombre(ev?.por?.nombre ?? "");
      this.esc.ponerIcono(f, null);
      this.esc.ponerGlobo(f, quien ? `¡Gracias, ${quien}!` : "¡Gracias!", 6000, 0xd9ffd9);
      f.momento = { pose: "celebra", hasta: this.esc.time.now + 1300 };
      if (ev) { this.celebrar(ev.por, "¡Respondí!"); sonidos.add("vender"); }
      f.ex = undefined;
      this.esc.irA(f, this.punto("llegada_este"));
      f.sale = true;
      return;
    }
    if (f.id.startsWith("k")) { this.alaMoto(f); return; }
    if (f.id === "proveedor") {
      const ev = [...evento.values()].find((e) => e.tipo === "registrado");
      this.esc.ponerGlobo(f, "¡Registrado!", 4500, 0xd9ffd9);
      if (ev) { this.celebrar(ev.por, "¡Recibido!"); sonidos.add("contar"); }
      f.ex = undefined;
      const camion = this.esc.figuras.get("camion");
      this.esc.irA(f, camion ? { x: camion.x + 30, y: camion.y - 12 } : this.punto("llegada_oeste"));
      f.sale = true;
      return;
    }
    if (f.id === "camion") {
      f.pausaHasta = this.esc.time.now + 6000;
      f.ruta = [{ x: this.mapa.ancho + 200, y: f.y }];
      f.sale = true;
      return;
    }
    if (f.id.startsWith("c")) {
      // La mercancía registrada entra a la bodega.
      this.esc.irA(f, this.punto("preparar"));
      f.sale = true;
      return;
    }
    f.sale = true;
  }

  // ─── La vida de todos los días ─────────────────────────────────────────────

  /** Lo llama juego.ts cada segundo: rondas (alistar, aseo) y pausas cortas (tinto, visitas). */
  vidaDiaria() {
    if (this.reducido) return;
    const ahora = performance.now();
    const j = this.esc.jugador;
    for (const f of this.esc.figuras.values()) {
      if (f.tipo !== "persona" || !f.presente || f.remoto || !f.lugar || f.ruta.length || f.sale) continue;
      if (f.momento && this.esc.time.now < f.momento.hasta) continue;
      // Si el jugador está cerca (le va a hablar), no se va de pausa.
      if (j && Math.hypot(j.x - f.x, j.y - f.y) < 110) continue;
      const azar = (hash(f.id + Math.floor(ahora / 1000)) % 1000) / 1000;
      if (f.ronda?.length) {
        if (f.vidaEn && ahora < f.vidaEn) continue;
        f.rondaK = ((f.rondaK ?? 0) + 1) % f.ronda.length;
        f.base = f.ronda[f.rondaK];
        this.esc.irA(f, f.base);
        f.vidaEn = ahora + 4500 + azar * 3500;
        continue;
      }
      if (!f.vidaEn) { f.vidaEn = ahora + 15000 + azar * 30000; continue; }
      if (ahora < f.vidaEn) continue;
      f.vidaEn = ahora + (f.ocupado ? 80000 : 40000) + azar * 45000;
      const casa = this.casaDeLugar(f.lugar);
      const companeros = [...this.esc.figuras.values()].filter((o) => o.tipo === "persona" && o !== f && o.presente && !o.remoto && o.lugar
        && this.casaDeLugar(o.lugar) === casa && !o.ruta.length && !o.ronda);
      if (azar < 0.3) {
        f.momento = { pose: "quieto", hasta: this.esc.time.now + 2400, dir: (["izquierda", "derecha", "abajo"] as Dir[])[Math.floor(azar * 30) % 3] };
      } else if (azar < 0.7 || !companeros.length) {
        const c = this.punto(CAFE[casa]);
        const parada: Paso = { x: c.x + (azar - 0.5) * 24, y: c.y, pausa: 4500, pose: "quieto", dir: c.dir };
        this.irYVolver(f, parada);
        this.esc.ponerGlobo(f, "Un tintico", 3000, 0xfff1d6);
      } else {
        this.visitar(f, companeros[Math.floor(azar * 997) % companeros.length], "…", 5000);
      }
    }
  }

  private irYVolver(f: Figura, parada: Paso) {
    if (!f.base) return;
    const ida = this.esc.rejilla.buscar(f.x, f.y, parada.x, parada.y);
    const vuelta = this.esc.rejilla.buscar(parada.x, parada.y, f.base.x, f.base.y);
    if (!ida || !vuelta) return;
    Object.assign(ida[ida.length - 1], { pausa: parada.pausa, pose: parada.pose, dir: parada.dir });
    f.ruta = [...ida, ...vuelta];
  }

  /** Pasar al puesto de alguien a conversar: los dos se miran, globos de charla, y vuelve. */
  private visitar(f: Figura, otro: Figura, texto: string, ms: number) {
    const lado = this.esc.rejilla.cercaLibre(otro.x + 22, otro.y + 14);
    const dir: Dir = otro.x < lado.x ? "izquierda" : "derecha";
    this.irYVolver(f, { x: lado.x, y: lado.y, pausa: ms, pose: "quieto", dir });
    const llegada = Math.min(12000, (Math.hypot(f.x - lado.x, f.y - lado.y) / VEL_PERSONA) * 1000 * 1.3);
    window.setTimeout(() => {
      if (!this.esc.figuras.has(otro.id) || !this.esc.figuras.has(f.id)) return;
      if (otro.pose !== "sentado" && !otro.remoto) otro.momento = { pose: "quieto", hasta: this.esc.time.now + ms - 500, dir: dir === "izquierda" ? "derecha" : "izquierda" };
      this.esc.ponerGlobo(f, texto, ms - 800, 0xffffff);
      this.esc.ponerGlobo(otro, "…", ms - 800, 0xffffff);
    }, llegada);
  }

  // ─── Lo que cada quien acaba de hacer en las solicitudes ───────────────────

  private sincronizarAcciones(est: EstadoEmpresa, primera: boolean, sonidos: Set<string>) {
    const ahora = Date.now() / 1000;
    const TEXTO: Record<string, string> = {
      resolvio: "¡Resuelta!", comento: "Comentó", creo: "Nueva solicitud", adjunto: "Adjuntó un archivo",
      midio: "Registró su tiempo", en_proceso: "¡Manos a la obra!", reporto: "Reportó avance", zumbido: "¡Bzz!",
    };
    for (const a of est.acciones ?? []) {
      if (this.accVistas.has(a.id)) continue;
      this.accVistas.add(a.id);
      if (primera && ahora - a.ts > 20) continue;
      const f = this.esc.figuras.get(`p${a.de}`);
      const texto = TEXTO[a.tipo];
      if (!f || !texto) continue;
      const detalle = a.titulo ? `: ${corto(a.titulo, 30)}` : "";
      this.esc.ponerGlobo(f, `${texto}${detalle}`, 4500, a.tipo === "resolvio" ? 0xd9ffd9 : 0xffffff);
      if (a.tipo === "resolvio" && f.pose !== "sentado" && !f.remoto && f.tipo !== "jugador") f.momento = { pose: "celebra", hasta: this.esc.time.now + 1600 };
      if (a.tipo === "resolvio") sonidos.add("preparar");
    }
  }
}

// Respuestas ya leídas en el juego (para no repetir el «!»): en este navegador, por un rato.
const CLAVE_LEIDAS = "mck-ev-respuestas-leidas";
export function respuestasLeidas(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(CLAVE_LEIDAS) || "[]") as string[]);
  } catch {
    return new Set();
  }
}
export function marcarRespuestaLeida(id: string) {
  try {
    const s = respuestasLeidas();
    s.add(id);
    sessionStorage.setItem(CLAVE_LEIDAS, JSON.stringify([...s].slice(-200)));
  } catch {
    /* sin almacenamiento: el «!» vuelve a salir hasta que la respuesta salga de la ventana de 20 min */
  }
}
