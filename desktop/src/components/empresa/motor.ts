/**
 * Motor del juego de la empresa: convierte cada foto del servidor (/api/empresa-viva/estado)
 * en lo que pasa en el barrio 3D (escena.ts). No guarda ni decide nada: cada foto nueva se
 * vuelve destinos, y los personajes caminan hacia ellos por las puertas y la calle.
 *
 * - Cada persona del equipo va al lugar del panel que tiene abierto (barrio.lugarDePanel); con
 *   la Agenda o el Mapa abiertos, a su puesto de siempre; desconectada, a su cuarto si vive en
 *   el barrio (sentada, «zzz»), o se va por la calle si no.
 * - Cada pregunta de MeLi o cliente de WhatsApp es alguien en la fila de la Tienda digital.
 *   Cuando lo atienden se va con «¡Gracias, …!» y quien lo atendió celebra.
 * - Cada compra es una caja en la oficina de la sede; alistada pasa al portón; el mensajero la
 *   recoge y se va en su furgón. El proveedor llega en camión a la recepción y se va cuando se
 *   registra la mercancía.
 */
import * as THREE from "three";
import type { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import {
  ANDEN_Z, CAMION_PROVEEDOR_PARQUEO, CARRIL_IDA, CARRIL_VUELTA, CASA, ENTRADA_RECEPCION, HUGO_PUESTO,
  LUGAR, LUGARES, MENSAJERO_PARQUEO, casaDeLugar, lugarDePanel, puestoFila, puestoPaqueteAlistado,
  puestoPaquetePorAlistar, type Animacion, type LugarId,
} from "./barrio";
import { Escena, type Elegible } from "./escena";
import { animar, objeto, objetoAlto, personaje, ponerAccesorio, type Personaje } from "./recursos";

// ─── Lo que manda el servidor ────────────────────────────────────────────────

export type Por = { id: number | null; nombre: string; bot?: boolean } | null;
export interface AvatarElegido { avatar: string; accesorio: string; color: string }
export interface PersonaApi {
  id: number; nombre: string; username: string; en_linea: boolean; panel: string; via: "panel" | "whatsapp" | "";
  avatar?: AvatarElegido | null; funciones?: string[];
}
export interface InteraccionApi {
  id: string; tipo: "pregunta" | "solicitud" | "respuesta" | "grupo" | "idea"; de: number; para: number[]; todos?: boolean;
  ts: number; texto: string; canal?: string; canal_id?: number; ticket_id?: number;
}
export interface VisitanteApi {
  id: string; tipo: "preventa" | "whatsapp"; desde: string; producto: string; texto: string; panel: string; puede: boolean;
}
export interface PaqueteApi {
  id: string; canal: "meli" | "web" | "whatsapp"; flex: boolean; estado: "por_alistar" | "alistado" | "en_ruta";
  desde: string; unidades: number; producto: string; lugar: string; alistado_por: Por; panel: string; puede: boolean;
}
export interface ProveedorApi {
  id: string; estado: "descargando" | "registrado"; proveedor: string; items: number; recibe: Por; desde: string;
  panel: string; puede: boolean;
}
export interface Detenido { id: string; n: number; texto: string; panel: string; severidad: string }
export interface EventoApi { seq: number; ts: number; tipo: string; objeto: string; por: Por }
export interface ConfigCasas {
  usuarios: Record<string, { vive?: string; cuarto?: LugarId; trabaja?: LugarId; avatar?: string; rol?: string }>;
  avatar_por_defecto?: string;
  clientes?: string[];
  proveedor?: string;
  mensajero?: string;
}
export interface Reponer { sku: string; nombre: string; estado: "agotado" | "critico"; stock: number | null }
export interface EstadoEmpresa {
  yo: number;
  personas: PersonaApi[];
  casas: ConfigCasas;
  visitantes: VisitanteApi[];
  visitantes_mas: number;
  paquetes: PaqueteApi[];
  paquetes_mas: number;
  proveedores: ProveedorApi[];
  bodega: { publicaciones: number; agotados: number; criticos: number; por_reponer?: Reponer[]; panel: string } | null;
  oficina: Record<string, { alta: number; media: number; items: Detenido[] }>;
  eventos: EventoApi[];
  interacciones?: InteraccionApi[];
  sin_senal: { fuente: string; error: string }[];
  generado: string;
}

export type Seleccion =
  | { tipo: "persona"; datos: PersonaApi; lugar: LugarId; rol?: string }
  | { tipo: "visitante"; datos: VisitanteApi }
  | { tipo: "paquete"; datos: PaqueteApi }
  | { tipo: "proveedor"; datos: ProveedorApi }
  | { tipo: "hugo" }
  | { tipo: "mensajero"; alistados: number }
  | { tipo: "lugar"; lugar: LugarId };

// ─── Entidades ───────────────────────────────────────────────────────────────

type Punto = { x: number; z: number };
type Tipo = "persona" | "visitante" | "paquete" | "proveedor" | "mensajero" | "camion" | "furgon" | "caja" | "hugo";

interface Ent {
  id: string;
  tipo: Tipo;
  obj: THREE.Group;
  pj?: Personaje;
  /** Puesto final: dónde se queda y qué hace allí. */
  base: Punto & { rot: number; anim: Animacion };
  ruta: Punto[];
  vel: number;
  lugar?: LugarId;
  sale?: boolean;
  /** Animación de un momento (celebrar) antes de seguir. */
  momento?: { anim: string; hasta: number };
  pausaHasta?: number;
  sel?: Seleccion;
  nombre?: CSS2DObject;
  globo?: { o: CSS2DObject; hasta: number };
  icono?: CSS2DObject;
  vehiculo?: boolean;
  /** avatar|accesorio con el que se creó: si la persona lo cambia, se vuelve a crear. */
  look?: string;
}

/** Un avioncito de papel volando de un avatar a otro. */
interface Avion {
  obj: THREE.Group;
  desde: THREE.Vector3;
  hacia: () => THREE.Vector3;
  t0: number;
  dur: number;
  llegar: () => void;
  llego?: boolean;
}

const COLOR_AVION: Record<string, string> = {
  pregunta: "#FF9F1C", solicitud: "#3BA7FF", respuesta: "#2ECC71", grupo: "#FFFFFF", idea: "#FFE14D",
};

const VEL_PERSONA = 1.7;
const VEL_CARRO = 6;
const COLOR_CANAL: Record<string, string> = { meli: "#FFE600", web: "#3BA7FF", whatsapp: "#25D366" };

function primerNombre(n: string): string {
  return (n || "").trim().split(/\s+/)[0] || "";
}
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export interface OpcionesMotor {
  onSelect: (s: Seleccion | null) => void;
  onSonido?: (nombre: string) => void;
  onListo?: () => void;
}

export class Motor {
  readonly escena: Escena;
  private ents = new Map<string, Ent>();
  private estado: EstadoEmpresa | null = null;
  private ultimoSeq = -1;
  private listo = false;
  private pendiente: EstadoEmpresa | null = null;
  private reducido: boolean;
  private seleccionado: string | null = null;
  private cargando = new Set<string>();
  private cajasEstante: THREE.Object3D[] = [];
  private llenando = false;
  private estadoCasillas = { vacias: -1, criticas: -1 };
  private pilas = new Map<string, { grupo: THREE.Group; etiqueta: CSS2DObject }>();
  private avisoBodega: CSS2DObject | null = null;
  private mensajeroVuelve = 0;
  private aviones: Avion[] = [];
  private interVistas = new Set<string>();

  constructor(cont: HTMLElement, private op: OpcionesMotor) {
    this.reducido = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    this.escena = new Escena(cont);
    this.escena.onFrame = (dt, t) => this.actualizar(dt, t);
    this.escena.onElegir = (e) => this.alElegir(e);
    void this.escena.construir().then(() => {
      this.crearHugo();
      this.listo = true;
      this.op.onListo?.();
      if (this.pendiente) this.sincronizar(this.pendiente);
    });
  }

  destruir() {
    this.escena.destruir();
  }

  deseleccionar() {
    this.seleccionado = null;
    this.escena.marcar(null);
  }

  private alElegir(e: Elegible | null) {
    if (!e) { this.deseleccionar(); this.op.onSelect(null); return; }
    if (e.tipo === "lugar") {
      this.deseleccionar();
      this.op.onSelect({ tipo: "lugar", lugar: e.id as LugarId });
      return;
    }
    const ent = this.ents.get(e.id);
    if (!ent?.sel) return;
    this.seleccionado = ent.id;
    this.escena.marcar(ent.obj);
    this.op.onSelect(ent.sel);
  }

  // ─── Crear figuras ─────────────────────────────────────────────────────────

  /** Caja invisible para tocar (más fácil que acertarle a un brazo). */
  private tocable(ent: Ent, w = 0.7, h = 1.4, d = 0.7) {
    const caja = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
    caja.position.y = h / 2;
    ent.obj.add(caja);
    this.escena.elegible(caja, { tipo: ent.tipo, id: ent.id });
  }

  private async crearPersonaje(id: string, tipo: Tipo, avatar: string, desde: Punto, base: Ent["base"], extra: Partial<Ent> = {}): Promise<Ent | null> {
    if (this.cargando.has(id) || this.ents.has(id)) return null;
    this.cargando.add(id);
    try {
      const pj = await personaje(avatar);
      const obj = new THREE.Group();
      obj.add(pj.raiz);
      obj.position.set(desde.x, 0.12, desde.z);
      obj.rotation.y = THREE.MathUtils.degToRad(base.rot);
      this.escena.scene.add(obj);
      const ent: Ent = { id, tipo, obj, pj, base, ruta: [], vel: VEL_PERSONA, ...extra };
      this.tocable(ent);
      this.ents.set(id, ent);
      return ent;
    } catch {
      return null;
    } finally {
      this.cargando.delete(id);
    }
  }

  private crearHugo() {
    // Hugo es un robot: no hay modelo de robot en los packs, se arma con formas simples.
    const g = new THREE.Group();
    const azul = new THREE.MeshStandardMaterial({ color: "#5DB8FF", roughness: 0.4, metalness: 0.2 });
    const blanco = new THREE.MeshStandardMaterial({ color: "#F4F8FF", roughness: 0.35 });
    const ojo = new THREE.MeshStandardMaterial({ color: "#1B2A4A", emissive: "#3FE0FF", emissiveIntensity: 1.2 });
    const cuerpo = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.22, 6, 14), blanco);
    cuerpo.position.y = 0.38;
    const cabeza = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 16), azul);
    cabeza.position.y = 0.82;
    cabeza.scale.set(1.15, 0.92, 1);
    for (const x of [-0.08, 0.08]) {
      const o = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), ojo);
      o.position.set(x, 0.84, 0.19);
      g.add(o);
    }
    const antena = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16), blanco);
    antena.position.y = 1.08;
    const luz = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8),
      new THREE.MeshStandardMaterial({ color: "#FFD34D", emissive: "#FFB000", emissiveIntensity: 1.5 }));
    luz.position.y = 1.18;
    luz.name = "luz";
    g.add(cuerpo, cabeza, antena, luz);
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    const obj = new THREE.Group();
    g.scale.setScalar(1.25);
    obj.add(g);
    obj.position.set(HUGO_PUESTO.x, 0.12, HUGO_PUESTO.z);
    this.escena.scene.add(obj);
    const ent: Ent = { id: "hugo", tipo: "hugo", obj, base: { ...HUGO_PUESTO, anim: "idle" }, ruta: [], vel: 0, sel: { tipo: "hugo" } };
    ent.nombre = Escena.etiqueta("Hugo", "ev-nombre ev-nombre-hugo");
    ent.nombre.position.set(0, 1.75, 0);
    obj.add(ent.nombre);
    this.tocable(ent, 0.6, 1.3, 0.6);
    this.ents.set("hugo", ent);
  }

  private async crearVehiculo(id: string, tipo: Tipo, ruta: string, desde: Punto, base: Ent["base"], sel?: Seleccion): Promise<Ent | null> {
    if (this.cargando.has(id) || this.ents.has(id)) return null;
    this.cargando.add(id);
    try {
      const modelo = await objeto(ruta, 0.85);
      const obj = new THREE.Group();
      obj.add(modelo);
      obj.position.set(desde.x, 0.02, desde.z);
      this.escena.scene.add(obj);
      const ent: Ent = { id, tipo, obj, base, ruta: [], vel: VEL_CARRO, vehiculo: true, sel };
      this.tocable(ent, 1.4, 1.6, 2.8);
      this.ents.set(id, ent);
      return ent;
    } catch {
      return null;
    } finally {
      this.cargando.delete(id);
    }
  }

  private async crearCaja(id: string, tipo: Tipo, canal: string | null, desde: Punto, base: Ent["base"], sel?: Seleccion): Promise<Ent | null> {
    if (this.cargando.has(id) || this.ents.has(id)) return null;
    this.cargando.add(id);
    try {
      const caja = await objeto("muebles/cardboardBoxClosed", 1.6);
      const obj = new THREE.Group();
      obj.add(caja);
      if (canal) {
        // La etiqueta del canal encima de la caja: amarilla MeLi, azul web, verde WhatsApp.
        const marca = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.12),
          new THREE.MeshStandardMaterial({ color: COLOR_CANAL[canal] ?? "#FFFFFF" }));
        marca.position.y = 0.455;
        obj.add(marca);
      }
      obj.position.set(desde.x, 0.12, desde.z);
      obj.rotation.y = THREE.MathUtils.degToRad(base.rot);
      this.escena.scene.add(obj);
      const ent: Ent = { id, tipo, obj, base, ruta: [], vel: VEL_PERSONA * 1.3, sel };
      if (sel) this.tocable(ent, 0.5, 0.55, 0.5);
      this.ents.set(id, ent);
      return ent;
    } catch {
      return null;
    } finally {
      this.cargando.delete(id);
    }
  }

  private quitar(ent: Ent) {
    this.escena.scene.remove(ent.obj);
    ent.obj.traverse((o) => {
      this.escena.olvidar(o);
      // Los CSS2DObject dejan su <div> en el DOM si no se quitan a mano.
      const css = o as unknown as CSS2DObject & { isCSS2DObject?: boolean };
      if (css.isCSS2DObject) css.element.remove();
    });
    ent.pj?.mixer.stopAllAction();
    this.ents.delete(ent.id);
    if (this.seleccionado === ent.id) this.deseleccionar();
  }

  private ponerGlobo(ent: Ent, texto: string, ms = 5500, clase = "ev-globo") {
    if (ent.globo) { ent.globo.o.element.remove(); ent.obj.remove(ent.globo.o); }
    const o = Escena.etiqueta(esc(texto), clase);
    o.position.set(0, ent.vehiculo ? 2.4 : 2.0, 0);
    ent.obj.add(o);
    ent.globo = { o, hasta: performance.now() + ms };
  }

  private ponerIcono(ent: Ent, html: string, clase: string) {
    if (ent.icono) { Escena.cambiar(ent.icono, html, clase); return; }
    ent.icono = Escena.etiqueta(html, clase);
    ent.icono.position.set(0.55, 1.95, 0);
    ent.obj.add(ent.icono);
  }
  private quitarIcono(ent: Ent) {
    if (!ent.icono) return;
    ent.icono.element.remove();
    ent.obj.remove(ent.icono);
    ent.icono = undefined;
  }

  // ─── Caminos ───────────────────────────────────────────────────────────────

  /** Por dónde se camina de un lugar a otro: puertas de los cuartos, la puerta de la casa,
   *  el andén. Así nadie atraviesa un muro. Devuelve los puntos intermedios y el destino. */
  private camino(desde: LugarId | undefined, hacia: LugarId | undefined, destino: Punto): Punto[] {
    if (!desde || !hacia || desde === hacia) return [destino];
    const salir = (l: LugarId): Punto[] => {
      const lu = LUGAR[l], casa = CASA[lu.casa];
      if (l === "porton") return [{ x: casa.puertaFuera.x, z: casa.puertaFuera.z + 0.6 }];
      if (l === "recepcion") return [lu.puerta, LUGAR.bodega.puerta, casa.puertaDentro, casa.puertaFuera];
      return [lu.puerta, casa.puertaDentro, casa.puertaFuera];
    };
    const entrar = (l: LugarId): Punto[] => salir(l).reverse();
    if (casaDeLugar(desde) === casaDeLugar(hacia)) {
      if (desde === "porton" || hacia === "porton") return [...salir(desde), ...entrar(hacia), destino];
      const medio = desde === "recepcion" || hacia === "recepcion" ? [LUGAR.bodega.puerta] : [];
      return [LUGAR[desde].puerta, ...medio, LUGAR[hacia].puerta, destino];
    }
    const ca = CASA[casaDeLugar(desde)].puertaFuera, cb = CASA[casaDeLugar(hacia)].puertaFuera;
    return [...salir(desde), { x: ca.x, z: ANDEN_Z }, { x: cb.x, z: ANDEN_Z }, ...entrar(hacia), destino];
  }

  // ─── Sincronizar con el servidor ───────────────────────────────────────────

  sincronizar(est: EstadoEmpresa) {
    if (!this.listo) { this.pendiente = est; return; }
    const primera = this.estado === null;
    this.estado = est;
    const nuevos = primera ? [] : est.eventos.filter((e) => e.seq > this.ultimoSeq);
    this.ultimoSeq = Math.max(this.ultimoSeq, ...est.eventos.map((e) => e.seq), -1);
    const evento = new Map(nuevos.map((e) => [e.objeto, e]));
    const vivos = new Set<string>(["hugo"]);
    const sonidos = new Set<string>();

    this.sincronizarPersonas(est, primera, vivos);
    this.sincronizarVisitantes(est, primera, vivos, sonidos);
    this.sincronizarPaquetes(est, primera, vivos, evento, sonidos);
    this.sincronizarProveedores(est, primera, vivos, sonidos);
    this.sincronizarMensajero(est, primera, vivos, nuevos, sonidos);
    this.sincronizarBodega(est);
    this.sincronizarPilas(est);
    this.sincronizarInteracciones(est, primera, sonidos);

    for (const ent of [...this.ents.values()]) {
      if (vivos.has(ent.id) || ent.sale) continue;
      this.despedir(ent, evento, sonidos);
    }
    if (this.reducido) for (const e of this.ents.values()) { e.obj.position.x = e.base.x; e.obj.position.z = e.base.z; e.ruta = []; }
    for (const n of sonidos) this.op.onSonido?.(n);
  }

  private sincronizarPersonas(est: EstadoEmpresa, primera: boolean, vivos: Set<string>) {
    const cfg = est.casas?.usuarios ?? {};
    const destinos = new Map<LugarId, PersonaApi[]>();
    for (const p of est.personas) {
      const c = cfg[p.username] ?? {};
      let l: LugarId | null;
      if (p.en_linea) l = lugarDePanel(p.panel) ?? c.trabaja ?? (c.vive === "bunker" ? "gerencia" : "oficina_sede");
      else l = c.cuarto ?? null; // desconectado: a su cuarto, si vive en el barrio
      if (!l || !LUGAR[l]) continue;
      destinos.set(l, [...(destinos.get(l) ?? []), p]);
    }
    for (const [l, gente] of destinos) {
      const puestos = LUGAR[l].puestos;
      gente.forEach((p, i) => {
        const id = `p${p.id}`;
        vivos.add(id);
        const pu = puestos[i % puestos.length];
        const extra = Math.floor(i / puestos.length);
        // Si hay más gente que puestos, el resto se para al lado.
        const base = { x: pu.x + extra * 0.5, z: pu.z + extra * 0.4, rot: pu.rot,
                       anim: (p.en_linea ? pu.anim : pu.anim === "sit" ? "sit" : "idle") as Animacion };
        const c = cfg[p.username] ?? {};
        const sel: Seleccion = { tipo: "persona", datos: p, lugar: l, rol: c.rol };
        const avatar = p.avatar?.avatar || c.avatar || est.casas?.avatar_por_defecto || "character-male-d";
        const look = `${avatar}|${p.avatar?.accesorio ?? ""}|${p.avatar?.color ?? ""}`;
        let ent = this.ents.get(id);
        if (ent && !ent.sale && ent.look !== look) {
          // Cambió de avatar: se vuelve a crear en el mismo sitio, con un saltito.
          const donde = { x: ent.obj.position.x, z: ent.obj.position.z };
          this.quitar(ent);
          ent = undefined;
          this.nacerPersona(id, p, est, avatar, look, donde, base, l, sel, false, true);
          return;
        }
        if (ent && !ent.sale) {
          if (ent.lugar !== l) ent.ruta = this.camino(ent.lugar, l, base).slice(0, -1);
          ent.lugar = l; ent.base = base; ent.sel = sel;
          this.marcarPersona(ent, p);
          return;
        }
        // Quien vive en el barrio ya está en su casa; los demás llegan caminando por la calle.
        const vive = Boolean(c.vive);
        const desde = primera || vive ? base : { x: -37, z: ANDEN_Z };
        this.nacerPersona(id, p, est, avatar, look, desde, base, l, sel, !primera && !vive, false);
      });
    }
  }

  private nacerPersona(id: string, p: PersonaApi, est: EstadoEmpresa, avatar: string, look: string, desde: Punto,
                       base: Ent["base"], l: LugarId, sel: Seleccion, llegaPorLaCalle: boolean, saltito: boolean) {
    void this.crearPersonaje(id, "persona", avatar, desde, base, { lugar: l, sel, look })
      .then(async (e) => {
        if (!e) return;
        e.nombre = Escena.etiqueta(esc(primerNombre(p.nombre)), p.id === est.yo ? "ev-nombre ev-nombre-yo" : "ev-nombre");
        const color = p.avatar?.color;
        if (color) (e.nombre.element.firstElementChild as HTMLElement).style.background = color;
        e.nombre.position.set(0, 1.5, 0);
        e.obj.add(e.nombre);
        if (llegaPorLaCalle) {
          const casa = CASA[casaDeLugar(l)];
          e.ruta = l === "porton" || LUGAR[l].afuera && l !== "recepcion"
            ? [{ x: casa.puertaFuera.x, z: ANDEN_Z }, casa.puertaFuera]
            : [{ x: casa.puertaFuera.x, z: ANDEN_Z }, casa.puertaFuera, casa.puertaDentro,
               ...(l === "recepcion" ? [LUGAR.bodega.puerta] : []), LUGAR[l].puerta];
        }
        if (saltito) { e.momento = { anim: "jump", hasta: performance.now() + 900 }; }
        this.marcarPersona(e, p);
        if (p.avatar?.accesorio && e.pj) await ponerAccesorio(e.pj, p.avatar.accesorio);
      });
  }

  /** «zzz» para quien está en su cuarto desconectado; WA para quien trabaja por WhatsApp. */
  private marcarPersona(ent: Ent, p: PersonaApi) {
    if (!p.en_linea) this.ponerIcono(ent, "z<small>z</small><small>z</small>", "ev-icono ev-zzz");
    else if (p.via === "whatsapp") this.ponerIcono(ent, "WA", "ev-icono ev-wa");
    else this.quitarIcono(ent);
  }

  private sincronizarVisitantes(est: EstadoEmpresa, primera: boolean, vivos: Set<string>, sonidos: Set<string>) {
    const clientes = est.casas?.clientes?.length ? est.casas.clientes : ["character-female-a", "character-male-a"];
    est.visitantes.forEach((v, i) => {
      const id = `v${v.id}`;
      vivos.add(id);
      const f = puestoFila(i);
      // Miran hacia la puerta de la tienda.
      const base = { ...f, rot: i < 3 ? 180 : 90, anim: "idle" as Animacion };
      const sel: Seleccion = { tipo: "visitante", datos: v };
      const ent = this.ents.get(id);
      if (ent) { ent.base = base; ent.sel = sel; return; }
      const desde = primera ? f : { x: 37, z: ANDEN_Z + 0.3 };
      void this.crearPersonaje(id, "visitante", clientes[hash(v.id) % clientes.length], desde, base, { sel, vel: VEL_PERSONA * 1.15 })
        .then((e) => {
          if (e) this.ponerIcono(e, v.tipo === "whatsapp" ? "…" : "?", v.tipo === "whatsapp" ? "ev-icono ev-pide-wa" : "ev-icono ev-pide-meli");
        });
      if (!primera) sonidos.add("inicio");
    });
  }

  private sincronizarPaquetes(est: EstadoEmpresa, primera: boolean, vivos: Set<string>, evento: Map<string, EventoApi>, sonidos: Set<string>) {
    let iMesa = 0, iPorton = 0;
    for (const p of est.paquetes) {
      const id = `k${p.id}`;
      const ent = this.ents.get(id);
      if (p.estado === "en_ruta") {
        if (ent && !ent.sale) this.alFurgon(ent);
        if (ent) vivos.add(id);
        continue;
      }
      vivos.add(id);
      const pos = p.estado === "alistado" ? puestoPaqueteAlistado(iPorton++) : puestoPaquetePorAlistar(iMesa++);
      const base = { x: pos.x, z: pos.z, rot: (hash(p.id) % 30) - 15, anim: "idle" as Animacion };
      const sel: Seleccion = { tipo: "paquete", datos: p };
      if (ent) {
        const estabaAdentro = ent.base.z < 1;
        ent.base = base; ent.sel = sel;
        if (estabaAdentro && base.z > 1) {
          // De la oficina al portón, por la puerta de la casa.
          ent.ruta = [LUGAR.oficina_sede.puerta, CASA.sede.puertaDentro, CASA.sede.puertaFuera];
          const ev = evento.get(p.id);
          if (ev?.tipo === "alistado") { sonidos.add("preparar"); this.celebrar(ev.por, "¡Alistado!"); }
        }
        continue;
      }
      // Una compra nueva aparece en la oficina de la sede, con su globo.
      void this.crearCaja(id, "paquete", p.canal, base, base, sel).then((e) => {
        if (e && !primera) { e.obj.scale.setScalar(0.01); this.ponerGlobo(e, "¡Nueva venta!", 4000, "ev-globo ev-globo-venta"); }
      });
      if (!primera) sonidos.add("vender");
    }
  }

  private alFurgon(ent: Ent) {
    const furgon = this.ents.get("furgon");
    const destino = furgon ? { x: furgon.obj.position.x, z: furgon.obj.position.z } : MENSAJERO_PARQUEO;
    ent.ruta = [{ x: -5, z: 7.4 }, destino];
    ent.sale = true;
  }

  private sincronizarProveedores(est: EstadoEmpresa, primera: boolean, vivos: Set<string>, sonidos: Set<string>) {
    const pv = est.proveedores.find((p) => p.estado === "descargando");
    if (!pv) return;
    const sel: Seleccion = { tipo: "proveedor", datos: pv };
    vivos.add("camion");
    vivos.add("proveedor");
    const parqueo = { ...CAMION_PROVEEDOR_PARQUEO, rot: 180, anim: "idle" as Animacion };
    const camion = this.ents.get("camion");
    if (!camion) {
      const llega = !primera;
      void this.crearVehiculo("camion", "camion", "carros/truck", llega ? { x: -38, z: CARRIL_IDA } : parqueo, parqueo, sel).then((e) => {
        if (!e) return;
        e.obj.rotation.y = llega ? Math.PI / 2 : Math.PI;
        if (llega) e.ruta = [ENTRADA_RECEPCION, { x: CAMION_PROVEEDOR_PARQUEO.x, z: 3 }];
      });
      if (llega) sonidos.add("abastecer");
    } else camion.sel = sel;
    const puesto = { x: 8.6, z: -5.6, rot: 90, anim: "holding-both" as Animacion };
    if (!this.ents.has("proveedor")) {
      void this.crearPersonaje("proveedor", "proveedor", est.casas?.proveedor ?? "character-male-d",
        primera ? puesto : { x: 10.2, z: 6 }, puesto, { sel, lugar: "recepcion" })
        .then((e) => { if (e && !primera) e.pausaHasta = performance.now() + 4500; });
    }
    // Cajas de la mercancía en el patio.
    const n = Math.max(2, Math.min(8, pv.items || 4));
    for (let i = 0; i < n; i++) {
      const id = `c${pv.id}-${i}`;
      vivos.add(id);
      if (this.ents.has(id)) continue;
      const pos = { x: 7.6 + (i % 4) * 0.42, z: -2.4 + Math.floor(i / 4) * 0.42 };
      void this.crearCaja(id, "caja", null, primera ? pos : { x: CAMION_PROVEEDOR_PARQUEO.x, z: -3 }, { ...pos, rot: i * 13, anim: "idle" })
        .then((e) => { if (e && !primera) e.pausaHasta = performance.now() + 5000 + i * 500; });
    }
  }

  private sincronizarMensajero(est: EstadoEmpresa, primera: boolean, vivos: Set<string>, nuevos: EventoApi[], sonidos: Set<string>) {
    const alistados = est.paquetes.filter((p) => p.estado === "alistado").length;
    const salio = nuevos.some((e) => e.tipo === "salio");
    const furgon = this.ents.get("furgon");
    const sel: Seleccion = { tipo: "mensajero", alistados };
    if (furgon) furgon.sel = sel;
    const m = this.ents.get("mensajero");
    if (m) m.sel = sel;
    if (furgon && !furgon.sale && !primera && (salio || alistados === 0)) {
      // Recoge y se va hacia el oriente; vuelve después si quedan paquetes alistados.
      this.mensajeroVuelve = performance.now() + 14000;
      if (m && !m.sale) { m.ruta = [{ x: -5, z: 8.6 }, { x: furgon.obj.position.x - 0.8, z: furgon.obj.position.z }]; m.sale = true; }
      furgon.pausaHasta = performance.now() + 3000;
      furgon.ruta = [{ x: 40, z: CARRIL_VUELTA }];
      furgon.sale = true;
      sonidos.add("entregar");
      return;
    }
    if (furgon) vivos.add("furgon");
    if (m) vivos.add("mensajero");
    if (alistados === 0 || furgon || performance.now() < this.mensajeroVuelve) return;
    const parqueo = { ...MENSAJERO_PARQUEO, rot: -90, anim: "idle" as Animacion };
    void this.crearVehiculo("furgon", "furgon", "carros/delivery", primera ? parqueo : { x: 40, z: CARRIL_VUELTA }, parqueo, sel)
      .then((e) => { if (e) e.obj.rotation.y = -Math.PI / 2; });
    vivos.add("furgon");
    const puesto = { x: -4.2, z: 6.6, rot: 180, anim: "idle" as Animacion };
    if (!m) {
      vivos.add("mensajero");
      void this.crearPersonaje("mensajero", "mensajero", est.casas?.mensajero ?? "character-male-a",
        primera ? puesto : { x: -5.8, z: CARRIL_VUELTA - 0.8 }, puesto, { sel })
        .then((e) => { if (e && !primera) e.pausaHasta = performance.now() + 3500; });
    }
  }

  /** Los estantes: cada casilla es una parte del catálogo. Caja normal = hay, caja que brilla
   *  naranja = crítico, casilla vacía = agotado. */
  private sincronizarBodega(est: EstadoEmpresa) {
    const b = est.bodega;
    if (!b) return;
    this.actualizarAvisoBodega(b);
    const casillas = this.escena.estantes.length * 6;
    const total = Math.max(1, b.publicaciones);
    const vacias = Math.round(casillas * b.agotados / total);
    const criticas = Math.round(casillas * b.criticos / total);
    if (this.cajasEstante.length) this.colorearEstantes(vacias, criticas);
    else if (!this.llenando) void this.llenarEstantes(vacias, criticas);
  }

  private async llenarEstantes(vacias: number, criticas: number) {
    this.llenando = true;
    // Frascos y cajas de materia prima (KayKit Restaurant), alternados para que se vea variado.
    const modelos = ["jar_A_large", "jar_B_large", "jar_C_large", "jar_D_large"];
    const bases = await Promise.all(modelos.map((m) => objetoAlto(`kaykit/cocina/${m}.gltf`, 0.27)));
    const marcaRoja = new THREE.MeshStandardMaterial({ color: "#FF3B3B", emissive: "#FF0000", emissiveIntensity: 0.5 });
    let k = 0;
    for (const est of this.escena.estantes) {
      const casillas = (est.userData.casillas as THREE.Vector3[] | undefined) ?? [];
      for (const pos of casillas) {
        const c = bases[(k++ * 7) % bases.length].clone(true);
        c.position.copy(pos);
        c.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) m.material = (m.material as THREE.Material).clone();
        });
        // Marca roja de «agotado»: se ve cuando la casilla queda vacía.
        const marca = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.02), marcaRoja);
        marca.name = "marca-agotado";
        marca.position.set(0, 0.02, 0.17);
        marca.visible = false;
        c.add(marca);
        est.add(c);
        this.cajasEstante.push(c);
      }
    }
    this.colorearEstantes(vacias, criticas);
  }

  /** Casilla llena = caja del color de su línea de producto; crítica = naranja que brilla;
   *  agotada = hueco con una marca roja en el borde del estante. */
  private colorearEstantes(vacias: number, criticas: number) {
    if (this.estadoCasillas.vacias === vacias && this.estadoCasillas.criticas === criticas) return;
    this.estadoCasillas = { vacias, criticas };
    const n = this.cajasEstante.length;
    // Lo vacío y lo crítico, repartido por toda la bodega (no amontonado en un rincón).
    const orden = [...Array(n).keys()].sort((a, b) => hash(`c${a}x`) - hash(`c${b}x`));
    orden.forEach((idx, k) => {
      const caja = this.cajasEstante[idx];
      const vacia = k < vacias;
      const critica = !vacia && k < vacias + criticas;
      caja.visible = true;
      caja.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if (m.name === "marca-agotado") { m.visible = vacia; return; }
        m.visible = !vacia;
        const mat = m.material as THREE.MeshStandardMaterial;
        // Los frascos traen su textura: el color solo se tiñe en lo crítico (naranja que brilla).
        mat.color = new THREE.Color(critica ? "#FFB066" : "#FFFFFF");
        mat.emissive = new THREE.Color(critica ? "#FF5A00" : "#000000");
        mat.emissiveIntensity = critica ? 0.6 : 0;
      });
    });
  }

  private actualizarAvisoBodega(b: NonNullable<EstadoEmpresa["bodega"]>) {
    const n = b.agotados + b.criticos;
    const html = n ? `<b>${b.agotados}</b> agotados · <b>${b.criticos}</b> por acabarse` : "Bodega al día";
    const clase = n ? "ev-aviso ev-aviso-rojo" : "ev-aviso";
    if (!this.avisoBodega) {
      this.avisoBodega = Escena.etiqueta(html, clase);
      this.avisoBodega.position.set(3, 2.4, -4.6);
      this.escena.scene.add(this.avisoBodega);
    } else {
      Escena.cambiar(this.avisoBodega, html, clase);
    }
  }

  /** Papeles por resolver en cada oficina (lo detenido del Mapa, ya filtrado por permisos). */
  private sincronizarPilas(est: EstadoEmpresa) {
    const papel = new THREE.MeshStandardMaterial({ color: "#FAFAF5", roughness: 0.9 });
    const sitios: Partial<Record<LugarId, Punto & { y: number }>> = {
      contabilidad: { x: -18.8, z: -0.35, y: 0.47 }, estudio: { x: -18.1, z: -7.75, y: 0.52 },
      gerencia: { x: -27.15, z: -2.9, y: 0.52 }, tienda: { x: 18.5, z: -2.2, y: 0.58 },
    };
    for (const l of LUGARES) {
      const sitio = sitios[l.id];
      if (!sitio) continue;
      const items = l.etapas.flatMap((et) => est.oficina[et]?.items ?? []);
      const n = items.reduce((a, it) => a + it.n, 0);
      const alta = items.some((it) => it.severidad === "alta");
      let pila = this.pilas.get(l.id);
      if (!pila) {
        const grupo = new THREE.Group();
        grupo.position.set(sitio.x, sitio.y, sitio.z);
        const etiqueta = Escena.etiqueta("", "ev-pila");
        grupo.add(etiqueta);
        this.escena.scene.add(grupo);
        pila = { grupo, etiqueta };
        this.pilas.set(l.id, pila);
      }
      const hojas = n ? Math.min(14, Math.max(2, Math.ceil(Math.log2(n + 1) * 2))) : 0;
      const papeles = pila.grupo.children.filter((c) => (c as THREE.Mesh).isMesh);
      for (const h of papeles.slice(hojas)) pila.grupo.remove(h);
      for (let k = papeles.length; k < hojas; k++) {
        const h = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.016, 0.17), papel);
        h.position.set((k % 2) * 0.01, 0.01 + k * 0.018, 0);
        h.rotation.y = (((k * 37) % 20) - 10) * 0.01;
        h.castShadow = true;
        pila.grupo.add(h);
      }
      pila.etiqueta.position.set(0, 0.12 + hojas * 0.018, 0);
      Escena.cambiar(pila.etiqueta, n ? String(n) : "", n ? (alta ? "ev-pila ev-pila-alta" : "ev-pila") : "ev-pila ev-oculto");
    }
  }

  // ─── Quién le habla a quién: avioncitos de papel ───────────────────────────

  private sincronizarInteracciones(est: EstadoEmpresa, primera: boolean, sonidos: Set<string>) {
    const ahora = Date.now() / 1000;
    for (const it of est.interacciones ?? []) {
      if (this.interVistas.has(it.id)) continue;
      this.interVistas.add(it.id);
      // Al abrir, solo lo del último minuto y medio: lo anterior ya pasó.
      if (primera && ahora - it.ts > 90) continue;
      if (this.lanzar(it, est)) sonidos.add(it.tipo === "pregunta" || it.tipo === "solicitud" ? "inicio" : "blip");
    }
  }

  /** Lanza los avioncitos de una interacción. También la usa el panel justo después de
   *  preguntar o compartir, para que se vea al instante (luego la foto del servidor la trae
   *  con el mismo id y no se repite). */
  lanzar(it: InteraccionApi, est: EstadoEmpresa | null = this.estado): boolean {
    this.interVistas.add(it.id);
    const de = this.ents.get(`p${it.de}`);
    if (!de || !est) return false;
    const enLinea = new Set(est.personas.filter((p) => p.en_linea).map((p) => p.id));
    const para = it.todos
      ? [...this.ents.values()].filter((e) => e.tipo === "persona" && e.id !== de.id && enLinea.has(Number(e.id.slice(1))))
      : it.para.map((id) => this.ents.get(`p${id}`)).filter((e): e is Ent => Boolean(e));
    const nombreDe = primerNombre(est.personas.find((p) => p.id === it.de)?.nombre ?? "");
    const nombrePara = para.length === 1 ? primerNombre(est.personas.find((p) => `p${p.id}` === para[0].id)?.nombre ?? "") : "";
    const corto = (t: string) => (t.length > 46 ? `${t.slice(0, 44)}…` : t);
    const textoSale: Record<string, string> = {
      pregunta: it.texto ? `«${corto(it.texto)}»` : nombrePara ? `Pregunta para ${nombrePara}` : "Pregunta",
      solicitud: it.texto ? corto(it.texto) : nombrePara ? `Solicitud para ${nombrePara}` : "Solicitud",
      respuesta: it.texto ? corto(it.texto) : "Respondió",
      grupo: it.canal ? `En «${it.canal}»` : "Escribió en un grupo",
      idea: it.texto ? corto(it.texto) : it.canal ? `Idea en «${it.canal}»` : "Compartió una idea",
    };
    const textoLlega: Record<string, string> = {
      pregunta: `Pregunta de ${nombreDe}`, solicitud: `Solicitud de ${nombreDe}`, respuesta: `${nombreDe} te respondió`,
      grupo: it.canal ? `${nombreDe} en «${it.canal}»` : `Mensaje de ${nombreDe}`, idea: `Idea de ${nombreDe}`,
    };
    this.ponerGlobo(de, textoSale[it.tipo] ?? "", 5000, `ev-globo ev-globo-${it.tipo}`);
    if (de.pj && !de.momento) de.momento = { anim: "interact-right", hasta: performance.now() + 1200 };
    para.slice(0, 8).forEach((destino, i) => {
      const avion = this.crearAvion(COLOR_AVION[it.tipo] ?? "#FFFFFF");
      const desde = de.obj.position.clone().setY(1.6);
      avion.position.copy(desde);
      this.escena.scene.add(avion);
      this.aviones.push({
        obj: avion, desde, hacia: () => destino.obj.position.clone().setY(1.55),
        t0: performance.now() + i * 280, dur: 1800 + Math.min(1600, desde.distanceTo(destino.obj.position) * 45),
        llegar: () => {
          if (!this.ents.has(destino.id)) return;
          this.ponerGlobo(destino, it.tipo === "respuesta" && nombrePara ? `${nombreDe} te respondió` : textoLlega[it.tipo] ?? "", 5500,
                          `ev-globo ev-globo-${it.tipo}`);
          if (destino.pj && !destino.momento) destino.momento = { anim: "emote-yes", hasta: performance.now() + 1000 };
        },
      });
    });
    return true;
  }

  /** Un avioncito de papel: dos alas y una quilla, del color del tipo de mensaje. */
  private crearAvion(color: string): THREE.Group {
    const g = new THREE.Group();
    const ala = new THREE.BufferGeometry();
    ala.setAttribute("position", new THREE.Float32BufferAttribute([
      0, 0, 0.32, -0.2, 0.03, -0.18, 0, 0, -0.1,
      0, 0, 0.32, 0, 0, -0.1, 0.2, 0.03, -0.18,
      0, 0, 0.32, 0, -0.07, -0.12, 0, 0, -0.1,
    ], 3));
    ala.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: "#FFFFFF", side: THREE.DoubleSide, roughness: 0.6 });
    const cuerpo = new THREE.Mesh(ala, mat);
    cuerpo.castShadow = true;
    const borde = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.3), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4 }));
    borde.position.set(0, 0.012, 0.05);
    g.add(cuerpo, borde);
    g.scale.setScalar(1.6);
    return g;
  }

  private volarAviones() {
    const ahora = performance.now();
    this.aviones = this.aviones.filter((a) => {
      const k = (ahora - a.t0) / a.dur;
      if (k < 0) { a.obj.visible = false; return true; }
      a.obj.visible = true;
      if (k >= 1) {
        if (!a.llego) { a.llego = true; a.llegar(); }
        this.escena.scene.remove(a.obj);
        return false;
      }
      const fin = a.hacia();
      const pos = (q: number) => {
        const v = a.desde.clone().lerp(fin, q);
        v.y += Math.sin(Math.PI * q) * (1.6 + a.desde.distanceTo(fin) * 0.08);
        return v;
      };
      const suave = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      a.obj.position.copy(pos(suave));
      a.obj.lookAt(pos(Math.min(1, suave + 0.02)));
      return true;
    });
  }

  /** Quien resolvió algo celebra con su globo. Si fue Hugo, Hugo. */
  private celebrar(por: Por, texto: string) {
    if (por?.bot) {
      const h = this.ents.get("hugo");
      if (h) { this.ponerGlobo(h, "¡Respondí!", 5000, "ev-globo ev-globo-hugo"); h.momento = { anim: "salto", hasta: performance.now() + 1200 }; }
      return;
    }
    if (!por?.id) return;
    const p = this.ents.get(`p${por.id}`);
    if (!p || p.sale) return;
    this.ponerGlobo(p, texto, 5500, "ev-globo ev-globo-ok");
    p.momento = { anim: "emote-yes", hasta: performance.now() + 1800 };
  }

  private despedir(ent: Ent, evento: Map<string, EventoApi>, sonidos: Set<string>) {
    if (ent.tipo === "mensajero" || ent.tipo === "furgon" || ent.tipo === "hugo") return;
    ent.sale = true;
    if (ent.tipo === "persona") {
      const l = ent.lugar ?? "oficina_sede";
      const casa = CASA[casaDeLugar(l)];
      const salida = l === "porton" ? [] : this.camino(l, "porton", casa.puertaFuera);
      ent.ruta = [...salida, { x: casa.puertaFuera.x, z: ANDEN_Z }, { x: -37, z: ANDEN_Z }];
      return;
    }
    if (ent.tipo === "visitante") {
      const ev = evento.get(ent.id.slice(1));
      const quien = ev?.por?.bot ? "Hugo" : primerNombre(ev?.por?.nombre ?? "");
      this.quitarIcono(ent);
      this.ponerGlobo(ent, quien ? `¡Gracias, ${quien}!` : "¡Gracias!", 6000, "ev-globo ev-globo-ok");
      ent.momento = { anim: "emote-yes", hasta: performance.now() + 1500 };
      if (ev) { this.celebrar(ev.por, "¡Respondí!"); sonidos.add("vender"); }
      ent.ruta = [{ x: ent.obj.position.x + 0.6, z: ANDEN_Z + 0.3 }, { x: 38, z: ANDEN_Z + 0.3 }];
      return;
    }
    if (ent.tipo === "paquete") { ent.sale = false; this.alFurgon(ent); return; }
    if (ent.tipo === "proveedor" || ent.tipo === "camion") {
      const ev = [...evento.values()].find((e) => e.tipo === "registrado");
      if (ent.tipo === "proveedor") {
        this.ponerGlobo(ent, "¡Registrado!", 4500, "ev-globo ev-globo-ok");
        if (ev) { this.celebrar(ev.por, "¡Recibido!"); sonidos.add("inicio"); }
        ent.ruta = [{ x: 10.2, z: 4.5 }, { x: 10.2, z: ANDEN_Z }, { x: -37, z: ANDEN_Z }];
      } else {
        ent.pausaHasta = performance.now() + 2500;
        ent.ruta = [{ x: CAMION_PROVEEDOR_PARQUEO.x, z: CARRIL_IDA }, { x: 40, z: CARRIL_IDA }];
      }
      return;
    }
    if (ent.tipo === "caja") {
      // La mercancía registrada entra a la bodega.
      ent.ruta = [LUGAR.recepcion.puerta, { x: 3, z: -5 }];
      return;
    }
    this.quitar(ent);
  }

  // ─── Animación ─────────────────────────────────────────────────────────────

  private actualizar(dt: number, t: number) {
    const ahora = performance.now();
    this.volarAviones();
    for (const ent of [...this.ents.values()]) {
      ent.pj?.mixer.update(dt);
      const o = ent.obj;
      if (ent.globo && ahora > ent.globo.hasta) { ent.globo.o.element.remove(); o.remove(ent.globo.o); ent.globo = undefined; }
      // Aparecer con un rebote (cajas nuevas).
      if (o.scale.x < 1) o.scale.setScalar(Math.min(1, o.scale.x + dt * 2.5));
      if (ent.tipo === "hugo") {
        const luz = o.getObjectByName("luz") as THREE.Mesh | undefined;
        if (luz) (luz.material as THREE.MeshStandardMaterial).emissiveIntensity = 1 + Math.sin(t * 4) * 0.8;
        const salto = ent.momento && ahora < ent.momento.hasta ? Math.abs(Math.sin(t * 9)) * 0.25 : Math.sin(t * 2) * 0.03;
        o.position.y = 0.12 + salto;
        continue;
      }
      if (ent.momento && ahora < ent.momento.hasta) {
        if (ent.pj) animar(ent.pj, ent.momento.anim);
        continue;
      }
      ent.momento = undefined;
      if (ent.pausaHasta && ahora < ent.pausaHasta) {
        if (ent.pj) animar(ent.pj, "idle");
        continue;
      }
      ent.pausaHasta = undefined;
      const destino = ent.ruta[0] ?? (ent.sale ? null : ent.base);
      if (!destino) { this.quitar(ent); continue; }
      const dx = destino.x - o.position.x, dz = destino.z - o.position.z;
      const d = Math.hypot(dx, dz);
      const paso = ent.vel * dt;
      if (d <= paso || d < 0.01) {
        o.position.x = destino.x; o.position.z = destino.z;
        if (ent.ruta.length) { ent.ruta.shift(); continue; }
        if (ent.sale) { this.quitar(ent); continue; }
        // Llegó a su puesto: mira hacia donde trabaja y hace lo suyo.
        if (!ent.vehiculo) {
          const meta = THREE.MathUtils.degToRad(ent.base.rot);
          let dif = meta - o.rotation.y;
          dif = Math.atan2(Math.sin(dif), Math.cos(dif));
          o.rotation.y += dif * Math.min(1, dt * 8);
        }
        if (ent.pj) animar(ent.pj, ent.base.anim);
        continue;
      }
      o.position.x += (dx / d) * paso;
      o.position.z += (dz / d) * paso;
      o.rotation.y = Math.atan2(dx, dz);
      if (ent.pj) animar(ent.pj, ent.tipo === "proveedor" || ent.tipo === "mensajero" ? "holding-both" : "walk");
    }
  }

  /** Acercar la cámara a un lugar. */
  irALugar(id: LugarId, zoom = 2.2) {
    const c = Escena.centro(id);
    this.escena.irA(c.x, c.z, zoom);
  }
}
