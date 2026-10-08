/**
 * La escena 3D del barrio con el «look» de juego (render.ts, referencia FarmVille 3): cámara en
 * perspectiva, luz cálida, oclusión ambiental, pasto vivo. Pueblo moderno: calle con andenes,
 * postes, carros y edificios vecinos (KayKit City), árboles redondos.
 *
 * Las casas se arman aquí (muros, ventanas, puerta y techo aparte) para que el techo se levante:
 * de lejos se ven cerradas, como en FarmVille; al acercarse o al tocar una, el techo sube, los
 * muros del frente bajan y se ve quién trabaja adentro. Los muebles son de KayKit Furniture /
 * Restaurant (catálogo MUEBLE: el nombre lógico de barrio.ts → modelo y medida humana).
 *
 * Lo vivo (personas, clientes, paquetes, carros) lo pone motor.ts encima.
 * Controles: arrastrar = moverse; rueda o dos dedos = acercar; tocar = seleccionar o abrir una casa.
 */
import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import {
  ANDEN_Z, CALLE, CASAS, ESTANTES, LIMITE, LUGARES, type Casa, type CasaId, type Lugar, type LugarId, type Rect,
} from "./barrio";
import { objeto, objetoAlto } from "./recursos";
import { Ambiente, type Calidad } from "./render";

export type Elegible = { tipo: string; id: string };

const DIR_CAMARA = new THREE.Vector3(Math.sin(Math.PI / 4), 1.3, Math.cos(Math.PI / 4)).normalize();
const DIST_MIN = 11, DIST_MAX = 100;
const ALTO_MURO = 1.85, MURO_ABIERTO = 0.32, GROSOR = 0.14;

const K = "kaykit/";
/** Nombre lógico de un mueble (barrio.ts) → modelo y medida. 1 unidad del mundo ≈ 1,4 m.
 *  KayKit Furniture/Restaurant miden ~0,7 m por unidad: van con UNA escala (`s: 0.5`) para que
 *  conserven sus proporciones (escalar por altura deforma lo plano: un mesón, una estufa).
 *  Lo de Kenney va por altura (`alto`). `y` = sobre qué altura se apoya (un mesón, un escritorio). */
const KK = 0.5;
const MESA = 0.5; // alto de mesas y mesones KayKit a esa escala
const MUEBLE: Record<string, { ruta: string; s?: number; alto?: number; ancho?: number; y?: number }> = {
  "muebles/desk": { ruta: `${K}muebles/table_medium.gltf`, s: KK },
  "muebles/computerScreen": { ruta: "muebles/computerScreen", alto: 0.34, y: MESA },
  "muebles/laptop": { ruta: "muebles/laptop", ancho: 0.3, y: MESA },
  "muebles/chairDesk": { ruta: `${K}muebles/chair_A.gltf`, s: KK },
  "muebles/chair": { ruta: `${K}muebles/chair_B.gltf`, s: KK },
  "muebles/bedDouble": { ruta: `${K}muebles/bed_double_A.gltf`, s: KK },
  "muebles/bedSingle": { ruta: `${K}muebles/bed_single_A.gltf`, s: KK },
  "muebles/cabinetBedDrawer": { ruta: `${K}muebles/cabinet_small.gltf`, s: KK },
  "muebles/rugRound": { ruta: `${K}muebles/rug_oval_A.gltf`, s: KK },
  "muebles/rugRectangle": { ruta: `${K}muebles/rug_rectangle_stripes_A.gltf`, s: KK },
  "muebles/lampRoundFloor": { ruta: `${K}muebles/lamp_standing.gltf`, s: KK },
  "muebles/pottedPlant": { ruta: `${K}muebles/cactus_medium_A.gltf`, s: KK },
  "muebles/plantSmall1": { ruta: `${K}muebles/cactus_small_A.gltf`, s: KK },
  "muebles/bookcaseOpen": { ruta: "muebles/bookcaseOpen", alto: 1.3 },
  "muebles/bookcaseClosedWide": { ruta: `${K}muebles/cabinet_medium_decorated.gltf`, s: KK },
  "muebles/loungeSofa": { ruta: `${K}muebles/couch_pillows.gltf`, s: KK },
  "muebles/table": { ruta: `${K}muebles/table_medium_long.gltf`, s: KK },
  "muebles/televisionModern": { ruta: "muebles/televisionModern", alto: 0.55 },
  "muebles/radio": { ruta: "muebles/radio", alto: 0.25 },
  "muebles/cardboardBoxOpen": { ruta: "muebles/cardboardBoxOpen", alto: 0.3, y: MESA },
  "muebles/cardboardBoxClosed": { ruta: "muebles/cardboardBoxClosed", alto: 0.3, y: MESA },
  "muebles/kitchenFridgeLarge": { ruta: `${K}cocina/fridge_A.gltf`, s: 0.42 },
  "muebles/kitchenStove": { ruta: `${K}cocina/stove_multi.gltf`, s: KK },
  "muebles/kitchenSink": { ruta: `${K}cocina/kitchencounter_sink.gltf`, s: KK },
  "muebles/kitchenCoffeeMachine": { ruta: `${K}cocina/pot_A.gltf`, s: KK, y: MESA },
  "muebles/kitchenBar": { ruta: `${K}cocina/kitchencounter_straight_B.gltf`, s: KK },
  "muebles/kitchenBarEnd": { ruta: `${K}cocina/kitchencounter_straight_A_decorated.gltf`, s: KK },
};

interface MuroVivo { mesh: THREE.Mesh; fijo: boolean }
interface CasaViva {
  casa: Casa;
  muros: MuroVivo[];
  techo: THREE.Group;
  ventanas: THREE.Group;
  modo: "auto" | "abierta" | "cerrada";
  /** 0 = cerrada, 1 = abierta (se anima). */
  k: number;
}

export class Escena {
  readonly scene: THREE.Scene;
  readonly camara: THREE.PerspectiveCamera;
  private amb: Ambiente;
  private etiquetas: CSS2DRenderer;
  private objetivo = new THREE.Vector3(4, 0, -1);
  private distancia = 40;
  private obs: ResizeObserver;
  private raf = 0;
  private reloj = new THREE.Clock();
  private visible = true;
  private punteros = new Map<number, { x: number; y: number }>();
  private arrastre: { x: number; y: number; obj: THREE.Vector3; movio: boolean; dist?: number; d0?: number } | null = null;
  private elegibles: THREE.Object3D[] = [];
  private anillo: THREE.Mesh;
  private seguido: THREE.Object3D | null = null;
  private casas = new Map<CasaId, CasaViva>();
  readonly estantes: THREE.Group[] = [];
  onFrame: (dt: number, t: number) => void = () => {};
  onElegir: (e: Elegible | null) => void = () => {};

  constructor(private cont: HTMLElement, calidad?: Calidad) {
    this.amb = new Ambiente(cont, calidad);
    this.scene = this.amb.scene;
    this.camara = this.amb.camara;

    this.etiquetas = new CSS2DRenderer();
    // overflow hidden: una etiqueta que sale del borde no puede ensanchar ni correr el panel.
    Object.assign(this.etiquetas.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none", overflow: "hidden" });
    cont.appendChild(this.etiquetas.domElement);

    this.anillo = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.55, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: "#FFE14D", transparent: true, opacity: 0.95, depthWrite: false }),
    );
    this.anillo.visible = false;
    this.anillo.renderOrder = 2;
    this.scene.add(this.anillo);

    this.obs = new ResizeObserver(() => this.ajustar());
    this.obs.observe(cont);
    this.ajustar();
    this.colocarCamara();

    const c = this.amb.renderer.domElement;
    c.addEventListener("pointerdown", this.alBajar);
    c.addEventListener("pointermove", this.alMover);
    c.addEventListener("pointerup", this.alSubir);
    c.addEventListener("pointercancel", this.alSubir);
    c.addEventListener("wheel", this.alRueda, { passive: false });
    document.addEventListener("visibilitychange", this.alVisibilidad);
    this.raf = requestAnimationFrame(this.cuadro);
  }

  get calidad(): Calidad { return this.amb.calidad; }
  cambiarCalidad(c: Calidad) { this.amb.cambiarCalidad(c); }

  destruir() {
    cancelAnimationFrame(this.raf);
    this.obs.disconnect();
    const c = this.amb.renderer.domElement;
    c.removeEventListener("pointerdown", this.alBajar);
    c.removeEventListener("pointermove", this.alMover);
    c.removeEventListener("pointerup", this.alSubir);
    c.removeEventListener("pointercancel", this.alSubir);
    c.removeEventListener("wheel", this.alRueda);
    document.removeEventListener("visibilitychange", this.alVisibilidad);
    this.amb.dispose();
    this.etiquetas.domElement.remove();
  }

  // ─── Cámara ────────────────────────────────────────────────────────────────

  private ajustar() {
    const w = Math.max(1, this.cont.clientWidth), h = Math.max(1, this.cont.clientHeight);
    this.amb.ajustar(w, h);
    this.etiquetas.setSize(w, h);
  }

  private colocarCamara() {
    this.camara.position.copy(this.objetivo).addScaledVector(DIR_CAMARA, this.distancia);
    this.camara.lookAt(this.objetivo);
    this.camara.updateMatrixWorld();
    const fog = this.scene.fog as THREE.Fog | null;
    if (fog) { fog.near = this.distancia * 1.5; fog.far = this.distancia * 3.4; }
  }

  /** Todo el barrio a la vista. */
  encuadrar() {
    this.objetivo.set(0, 0, 1);
    this.distancia = this.cont.clientWidth < 640 ? DIST_MAX : 78;
    this.colocarCamara();
  }

  /** Acercar (factor > 1) o alejar, hacia un punto de la pantalla. */
  zoom(factor: number, sx?: number, sy?: number) {
    const antes = sx !== undefined && sy !== undefined ? this.alPiso(sx, sy) : null;
    this.distancia = Math.max(DIST_MIN, Math.min(DIST_MAX, this.distancia / factor));
    this.colocarCamara();
    if (antes && sx !== undefined && sy !== undefined) {
      const despues = this.alPiso(sx, sy);
      if (despues) this.objetivo.add(antes.sub(despues));
    }
    this.limitar();
    this.colocarCamara();
  }

  /** Ir a un punto; `zoom` como en la vista ortográfica de antes (2 ≈ una casa de cerca). */
  irA(x: number, z: number, zoom?: number) {
    this.objetivo.set(x, 0, z);
    if (zoom) this.distancia = Math.max(DIST_MIN, Math.min(DIST_MAX, 64 / zoom));
    this.limitar();
    this.colocarCamara();
  }

  private limitar() {
    this.objetivo.x = Math.max(LIMITE.x0, Math.min(LIMITE.x1, this.objetivo.x));
    this.objetivo.z = Math.max(LIMITE.z0, Math.min(LIMITE.z1, this.objetivo.z));
  }

  private alPiso(cx: number, cy: number): THREE.Vector3 | null {
    const r = this.amb.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camara);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p);
  }

  private alBajar = (e: PointerEvent) => {
    this.amb.renderer.domElement.setPointerCapture(e.pointerId);
    this.punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.punteros.size === 2) {
      const [a, b] = [...this.punteros.values()];
      this.arrastre = { x: e.clientX, y: e.clientY, obj: this.objetivo.clone(), movio: true,
                        dist: Math.hypot(a.x - b.x, a.y - b.y), d0: this.distancia };
    } else {
      this.arrastre = { x: e.clientX, y: e.clientY, obj: this.objetivo.clone(), movio: false };
    }
  };

  private alMover = (e: PointerEvent) => {
    if (!this.punteros.has(e.pointerId)) {
      this.amb.renderer.domElement.style.cursor = this.elegir(e.clientX, e.clientY) ? "pointer" : "grab";
      return;
    }
    this.punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const a = this.arrastre;
    if (!a) return;
    if (this.punteros.size === 2 && a.dist && a.d0) {
      const [p, q] = [...this.punteros.values()];
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      this.zoom(this.distancia / (a.d0 / (d / a.dist)), (p.x + q.x) / 2, (p.y + q.y) / 2);
      return;
    }
    if (!a.movio && Math.hypot(e.clientX - a.x, e.clientY - a.y) < 6) return;
    a.movio = true;
    this.seguido = null;
    // Lo que estaba bajo el dedo sigue bajo el dedo.
    this.objetivo.copy(a.obj);
    this.colocarCamara();
    const p0 = this.alPiso(a.x, a.y), p1 = this.alPiso(e.clientX, e.clientY);
    if (p0 && p1) this.objetivo.add(p0.sub(p1));
    this.limitar();
    this.colocarCamara();
    this.amb.renderer.domElement.style.cursor = "grabbing";
  };

  private alSubir = (e: PointerEvent) => {
    const a = this.arrastre;
    this.punteros.delete(e.pointerId);
    if (this.punteros.size > 0) return;
    this.arrastre = null;
    this.amb.renderer.domElement.style.cursor = "grab";
    if (!a || a.movio) return;
    const elegido = this.elegir(e.clientX, e.clientY);
    // Tocar el techo (o un muro) de una casa cerrada: se abre.
    if (elegido?.tipo === "casa") { this.alternarCasa(elegido.id as CasaId); return; }
    this.onElegir(elegido);
  };

  private alRueda = (e: WheelEvent) => {
    e.preventDefault();
    this.zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
  };

  private alVisibilidad = () => {
    this.visible = document.visibilityState === "visible";
    if (this.visible) {
      this.reloj.getDelta();
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.cuadro);
    }
  };

  // ─── Selección ─────────────────────────────────────────────────────────────

  elegible(o: THREE.Object3D, e: Elegible) {
    o.userData.elegible = e;
    this.elegibles.push(o);
  }
  olvidar(o: THREE.Object3D) {
    this.elegibles = this.elegibles.filter((x) => x !== o);
    if (this.seguido === o) this.seguido = null;
  }

  private elegir(cx: number, cy: number): Elegible | null {
    const r = this.amb.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camara);
    const golpes = ray.intersectObjects(this.elegibles.filter((o) => o.visible !== false && this.visibleDeVerdad(o)), true);
    const peso = (o: THREE.Object3D) => {
      const t = this.de(o)?.tipo;
      return t === "lugar" ? 2 : t === "casa" ? 1 : 0;
    };
    golpes.sort((a, b) => peso(a.object) - peso(b.object) || a.distance - b.distance);
    for (const g of golpes) {
      const e = this.de(g.object);
      if (e) return e;
    }
    return null;
  }
  private de(o: THREE.Object3D): Elegible | null {
    let x: THREE.Object3D | null = o;
    while (x && !x.userData.elegible) x = x.parent;
    return (x?.userData.elegible as Elegible | undefined) ?? null;
  }
  private visibleDeVerdad(o: THREE.Object3D): boolean {
    let x: THREE.Object3D | null = o;
    while (x) {
      if (x.userData.oculto) return false;
      x = x.parent;
    }
    return true;
  }

  marcar(o: THREE.Object3D | null) {
    this.seguido = o;
    this.anillo.visible = Boolean(o);
  }

  // ─── Casas que se abren ────────────────────────────────────────────────────

  /** Tocar una casa: si estaba en automático o cerrada, se abre; si estaba abierta, se cierra. */
  alternarCasa(id: CasaId) {
    const c = this.casas.get(id);
    if (!c) return;
    c.modo = c.k > 0.5 ? "cerrada" : "abierta";
  }
  /** Para la barra: todas abiertas, todas cerradas o automático (según la distancia). */
  modoCasas(modo: CasaViva["modo"]) {
    for (const c of this.casas.values()) c.modo = modo;
  }

  private animarCasas(dt: number) {
    for (const c of this.casas.values()) {
      const cx = (c.casa.casa.x0 + c.casa.casa.x1) / 2, cz = (c.casa.casa.z0 + c.casa.casa.z1) / 2;
      const cerca = Math.hypot(cx - this.objetivo.x, cz - this.objetivo.z) < 16;
      const abrir = c.modo === "abierta" || (c.modo === "auto" && this.distancia < 46 && cerca);
      const meta = abrir ? 1 : 0;
      if (Math.abs(c.k - meta) < 0.001) continue;
      c.k += Math.sign(meta - c.k) * Math.min(Math.abs(meta - c.k), dt * 2.2);
      const k = c.k * c.k * (3 - 2 * c.k); // suave
      c.techo.position.y = k * 6;
      c.techo.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        // `transparent` ya viene encendido desde techo(): cambiarlo en caliente no surte efecto
        // sin recompilar el material.
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.opacity = 1 - k;
        mat.depthWrite = k < 0.5;
      });
      c.techo.visible = k < 0.99;
      c.techo.userData.oculto = k > 0.5;
      for (const muro of c.muros) if (!muro.fijo) muro.mesh.scale.y = 1 - k * (1 - MURO_ABIERTO / ALTO_MURO);
      c.ventanas.visible = k < 0.4;
    }
  }

  // ─── Ciclo ─────────────────────────────────────────────────────────────────

  private cuadro = () => {
    if (!this.visible) return;
    const dt = Math.min(0.05, this.reloj.getDelta());
    const t = this.reloj.elapsedTime;
    this.onFrame(dt, t);
    this.animarCasas(dt);
    if (this.seguido) {
      this.anillo.position.set(this.seguido.position.x, 0.14, this.seguido.position.z);
      this.anillo.scale.setScalar(1 + Math.sin(t * 5) * 0.06);
    }
    this.amb.render(t);
    this.etiquetas.render(this.scene, this.camara);
    this.raf = requestAnimationFrame(this.cuadro);
  };

  // ─── Etiquetas ─────────────────────────────────────────────────────────────

  /** Una etiqueta HTML pegada a un punto del mundo (nombres, letreros, globos). */
  static etiqueta(html: string, clase: string): CSS2DObject {
    // El renderer mueve el <div> de afuera con `transform`; la clase (y sus animaciones) van en
    // el de adentro para no pisarse.
    const fuera = document.createElement("div");
    const dentro = document.createElement("div");
    dentro.className = clase;
    dentro.innerHTML = html;
    fuera.appendChild(dentro);
    const o = new CSS2DObject(fuera);
    o.center.set(0.5, 1);
    return o;
  }

  /** Cambia el contenido y la clase de una etiqueta ya creada. */
  static cambiar(o: CSS2DObject, html: string, clase: string) {
    const dentro = o.element.firstElementChild as HTMLElement | null;
    if (!dentro) return;
    if (dentro.className !== clase) dentro.className = clase;
    if (dentro.innerHTML !== html) dentro.innerHTML = html;
  }

  /** Centro de un lugar (para acercar la cámara). */
  static centro(id: LugarId): { x: number; z: number } {
    const l = LUGARES.find((x) => x.id === id)!;
    return { x: (l.rect.x0 + l.rect.x1) / 2, z: (l.rect.z0 + l.rect.z1) / 2 };
  }

  // ─── El barrio fijo ────────────────────────────────────────────────────────

  async construir(): Promise<void> {
    this.amb.suelo(200, 140, 0, 2);
    this.calle();
    for (const c of CASAS) this.lote(c);
    for (const l of LUGARES) this.lugar(l);
    for (const c of CASAS) this.casa(c);
    const pendientes: Promise<unknown>[] = [];
    for (const l of LUGARES) for (const m of l.muebles) pendientes.push(this.mueble(m.m, m.x, m.z, m.rot ?? 0));
    pendientes.push(this.bodegaEstantes(), this.cultivoHongos(), this.decorar());
    await Promise.all(pendientes);
    // El pasto y las flores al final: no crecen donde quedó algo.
    const fuera: Rect[] = [
      ...CASAS.map((c) => crecer(c.casa, 0.4)),
      ...LUGARES.filter((l) => l.afuera).map((l) => crecer(l.rect, 0.2)),
      { x0: -80, z0: CALLE.z0 - 1.2, x1: 80, z1: CALLE.z1 + 1.3 },
      ...CASAS.map((c) => ({ x0: c.puertaFuera.x - 0.7, z0: c.puertaFuera.z - 0.5, x1: c.puertaFuera.x + 0.7, z1: ANDEN_Z })),
      ...this.huellas,
    ];
    this.amb.pastoVivo({ x0: -48, z0: -24, x1: 48, z1: 30 }, 34000, fuera);
    this.amb.flores({ x0: -34, z0: -13, x1: 34, z1: 8 }, 90, fuera);
  }

  private huellas: Rect[] = [];

  private async mueble(nombre: string, x: number, z: number, rot = 0): Promise<THREE.Object3D | null> {
    const def = MUEBLE[nombre] ?? { ruta: nombre, alto: 0.5 };
    try {
      let o: THREE.Object3D;
      if (def.s) o = await objeto(def.ruta, def.s);
      else if (def.ancho) {
        o = await objeto(def.ruta, 1);
        const t = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
        o.scale.setScalar(def.ancho / Math.max(t.x, t.z, 0.01));
      } else o = await objetoAlto(def.ruta, def.alto ?? 0.5);
      o.position.set(x, 0.12 + (def.y ?? 0), z);
      o.rotation.y = THREE.MathUtils.degToRad(rot);
      this.scene.add(o);
      return o;
    } catch {
      return null; // un modelo que no cargó no tumba el barrio
    }
  }

  async poner(ruta: string, x: number, z: number, rot = 0, alto = 1, y = 0): Promise<THREE.Object3D | null> {
    try {
      const o = await objetoAlto(ruta, alto);
      o.position.set(x, y, z);
      o.rotation.y = THREE.MathUtils.degToRad(rot);
      this.scene.add(o);
      return o;
    } catch {
      return null;
    }
  }

  private textura(dibujar: (g: CanvasRenderingContext2D, n: number) => void, n = 256): THREE.CanvasTexture {
    const c = document.createElement("canvas");
    c.width = c.height = n;
    dibujar(c.getContext("2d")!, n);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  private calle() {
    // Asfalto con textura (no un gris plano) y línea amarilla discontinua.
    const asfalto = this.textura((g, n) => {
      g.fillStyle = "#62666E"; g.fillRect(0, 0, n, n);
      let s = 5;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 2200; i++) { g.fillStyle = rnd() > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.07)"; g.fillRect(rnd() * n, rnd() * n, 2, 2); }
    });
    asfalto.repeat.set(40, 2);
    const ancho = CALLE.z1 - CALLE.z0;
    const via = new THREE.Mesh(new THREE.PlaneGeometry(160, ancho).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: asfalto, roughness: 0.95 }));
    via.position.set(0, 0.005, (CALLE.z0 + CALLE.z1) / 2);
    via.receiveShadow = true;
    this.scene.add(via);
    const linea = new THREE.MeshStandardMaterial({ color: "#FFD84A", roughness: 0.6 });
    for (let x = -78; x < 78; x += 2.6) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.01, 0.13), linea);
      m.position.set(x, 0.012, (CALLE.z0 + CALLE.z1) / 2);
      this.scene.add(m);
    }
    // Andenes de baldosa con bordillo.
    const baldosa = this.textura((g, n) => {
      g.fillStyle = "#DCD6CB"; g.fillRect(0, 0, n, n);
      g.strokeStyle = "rgba(0,0,0,0.13)"; g.lineWidth = 4;
      for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo((i * n) / 4, 0); g.lineTo((i * n) / 4, n); g.stroke(); }
      g.beginPath(); g.moveTo(0, n / 2); g.lineTo(n, n / 2); g.stroke();
    });
    baldosa.repeat.set(60, 1);
    for (const z of [ANDEN_Z, CALLE.z1 + 0.55]) {
      const anden = new THREE.Mesh(new THREE.BoxGeometry(160, 0.1, 1.1), new THREE.MeshStandardMaterial({ map: baldosa, roughness: 0.9 }));
      anden.position.set(0, 0.05, z);
      anden.receiveShadow = true;
      this.scene.add(anden);
      const bordillo = new THREE.Mesh(new THREE.BoxGeometry(160, 0.13, 0.12), new THREE.MeshStandardMaterial({ color: "#B8B2A6" }));
      bordillo.position.set(0, 0.065, z + (z === ANDEN_Z ? 0.55 : -0.55));
      bordillo.receiveShadow = true;
      this.scene.add(bordillo);
    }
  }

  private lote(c: Casa) {
    // Camino de concreto de la puerta al andén.
    const mat = new THREE.MeshStandardMaterial({ color: "#E4DED2", roughness: 0.95 });
    const largo = ANDEN_Z - c.puertaFuera.z;
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, largo), mat);
    p.position.set(c.puertaFuera.x, 0.025, c.puertaFuera.z + largo / 2);
    p.receiveShadow = true;
    this.scene.add(p);
    const letrero = Escena.etiqueta(c.titulo, "ev-letrero-casa");
    letrero.position.set((c.casa.x0 + c.casa.x1) / 2, 4.6, (c.casa.z0 + c.casa.z1) / 2);
    this.scene.add(letrero);
  }

  private lugar(l: Lugar) {
    const w = l.rect.x1 - l.rect.x0, d = l.rect.z1 - l.rect.z0;
    const cx = (l.rect.x0 + l.rect.x1) / 2, cz = (l.rect.z0 + l.rect.z1) / 2;
    const tex = this.textura((g, n) => {
      g.fillStyle = l.piso; g.fillRect(0, 0, n, n);
      if (l.afuera) {
        // Adoquín / concreto en losas.
        g.strokeStyle = "rgba(0,0,0,0.12)"; g.lineWidth = 3;
        for (let i = 0; i <= 2; i++) { g.strokeRect(0, (i * n) / 2, n, n / 2); g.strokeRect((i * n) / 2, 0, n / 2, n); }
      } else {
        // Tablas de madera con vetas.
        for (let i = 0; i < 6; i++) {
          g.fillStyle = i % 2 ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.06)";
          g.fillRect(0, (i * n) / 6, n, n / 6);
          g.fillStyle = "rgba(60,30,10,0.22)";
          g.fillRect(0, (i * n) / 6, n, 2);
          g.fillRect((i * 97) % n, (i * n) / 6, 2, n / 6);
        }
      }
    });
    tex.repeat.set(w / 2, d / 2);
    const piso = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 }));
    piso.position.set(cx, 0.06, cz);
    piso.receiveShadow = true;
    this.scene.add(piso);
    this.elegible(piso, { tipo: "lugar", id: l.id });
    if (!l.id.startsWith("cuarto")) {
      const e = Escena.etiqueta(l.titulo, "ev-letrero-lugar");
      e.position.set(cx, 0.2, l.rect.z0 + 0.4);
      this.scene.add(e);
    }
  }

  /** Una casa: muros (con huecos de puerta), ventanas, y el techo aparte para que se levante. */
  private casa(c: Casa) {
    const lugares = LUGARES.filter((l) => l.casa === c.id && !l.afuera);
    const puertas = [c.puertaDentro, ...lugares.map((l) => l.puerta),
                     ...LUGARES.filter((l) => l.casa === c.id && l.afuera).map((l) => l.puerta)];
    const matExt = new THREE.MeshStandardMaterial({ color: c.muro, roughness: 0.85 });
    const matInt = new THREE.MeshStandardMaterial({ color: "#F7F1E6", roughness: 0.9 });
    const viva: CasaViva = { casa: c, muros: [], techo: new THREE.Group(), ventanas: new THREE.Group(), modo: "auto", k: 0 };

    const segmentos = new Map<string, { x0: number; z0: number; x1: number; z1: number; exterior: boolean; fijo: boolean }>();
    for (const l of lugares) {
      const { x0, z0, x1, z1 } = l.rect;
      const bordes = [
        { x0, z0, x1, z1: z0 }, { x0, z0, x1: x0, z1 }, { x0, z0: z1, x1, z1 }, { x0: x1, z0, x1, z1 },
      ];
      for (const b of bordes) {
        const exterior = b.z0 === c.casa.z0 && b.z1 === c.casa.z0 || b.x0 === c.casa.x0 && b.x1 === c.casa.x0
          || b.z0 === c.casa.z1 && b.z1 === c.casa.z1 || b.x0 === c.casa.x1 && b.x1 === c.casa.x1;
        // Los muros del fondo (norte y occidente de la casa) no bajan: la cámara mira desde el sureste.
        const fijo = (b.z0 === c.casa.z0 && b.z1 === c.casa.z0) || (b.x0 === c.casa.x0 && b.x1 === c.casa.x0);
        segmentos.set(`${b.x0},${b.z0},${b.x1},${b.z1}`, { ...b, exterior, fijo });
      }
    }
    const HUECO = 0.55;
    for (const s of segmentos.values()) {
      const horizontal = s.z0 === s.z1;
      const largo = horizontal ? s.x1 - s.x0 : s.z1 - s.z0;
      const cortes = puertas
        .filter((p) => horizontal
          ? Math.abs(p.z - s.z0) < 0.75 && p.x > s.x0 && p.x < s.x1
          : Math.abs(p.x - s.x0) < 0.75 && p.z > s.z0 && p.z < s.z1)
        .map((p) => (horizontal ? p.x - s.x0 : p.z - s.z0))
        .sort((a, b) => a - b);
      let desde = 0;
      const tramos: [number, number][] = [];
      for (const c0 of cortes) { if (c0 - HUECO > desde) tramos.push([desde, c0 - HUECO]); desde = c0 + HUECO; }
      if (desde < largo) tramos.push([desde, largo]);
      for (const [a, b] of tramos) {
        const geo = horizontal ? new THREE.BoxGeometry(b - a, ALTO_MURO, GROSOR) : new THREE.BoxGeometry(GROSOR, ALTO_MURO, b - a);
        geo.translate(0, ALTO_MURO / 2, 0);
        const m = new THREE.Mesh(geo, s.exterior ? matExt : matInt);
        m.position.set(horizontal ? s.x0 + (a + b) / 2 : s.x0, 0.1, horizontal ? s.z0 : s.z0 + (a + b) / 2);
        m.castShadow = true;
        m.receiveShadow = true;
        this.scene.add(m);
        viva.muros.push({ mesh: m, fijo: s.fijo });
        this.elegible(m, { tipo: "casa", id: c.id });
        // Ventanas en los muros de afuera que dan a la cámara (sur y oriente).
        const daAFrente = s.exterior && !s.fijo;
        if (daAFrente && b - a > 1.6) {
          for (let v = a + 0.9; v < b - 0.7; v += 2.2) this.ventana(viva.ventanas, c, horizontal, s.x0, s.z0, v);
        }
      }
    }
    // Zócalo de color en todo el contorno exterior: amarra la casa al piso.
    this.scene.add(viva.ventanas);
    this.techo(viva);
    this.casas.set(c.id, viva);
  }

  private ventana(grupo: THREE.Group, c: Casa, horizontal: boolean, x0: number, z0: number, v: number) {
    const marco = new THREE.MeshStandardMaterial({ color: "#FFFFFF", roughness: 0.6 });
    const vidrio = new THREE.MeshStandardMaterial({ color: "#9ED8F5", roughness: 0.15, metalness: 0.2, emissive: "#2A6A8A", emissiveIntensity: 0.15 });
    const g = new THREE.Group();
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.75, 0.06), marco);
    const vi = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.07), vidrio);
    const cruz = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.08), marco);
    const jardinera = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.12, 0.16), new THREE.MeshStandardMaterial({ color: c.acento }));
    jardinera.position.set(0, -0.42, 0.06);
    g.add(f, vi, cruz, jardinera);
    g.position.set(horizontal ? x0 + v : x0 + 0.08, 1.15, horizontal ? z0 + 0.08 : z0 + v);
    if (!horizontal) g.rotation.y = Math.PI / 2;
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    grupo.add(g);
  }

  private techo(viva: CasaViva) {
    const { casa: c } = viva;
    const r = c.casa;
    const w = r.x1 - r.x0, d = r.z1 - r.z0, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    const base = 0.1 + ALTO_MURO;
    const VUELO = 0.45;
    const g = viva.techo;
    if (c.techo === "teja") {
      // Dos aguas con teja de barro (textura de filas de tejas redondeadas).
      const teja = this.textura((ctx, n) => {
        ctx.fillStyle = c.acento; ctx.fillRect(0, 0, n, n);
        for (let fila = 0; fila < 8; fila++) {
          for (let col = 0; col < 8; col++) {
            const x = col * (n / 8) + (fila % 2) * (n / 16), y = fila * (n / 8);
            const gr = ctx.createLinearGradient(0, y, 0, y + n / 8);
            gr.addColorStop(0, "rgba(255,255,255,0.18)");
            gr.addColorStop(1, "rgba(0,0,0,0.28)");
            ctx.fillStyle = gr;
            ctx.beginPath();
            ctx.ellipse(x + n / 16, y + n / 12, n / 17, n / 13, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });
      const alto = d * 0.32;
      const faldon = Math.hypot(d / 2 + VUELO, alto);
      const ang = Math.atan2(alto, d / 2 + VUELO);
      teja.repeat.set((w + VUELO * 2) / 1.6, faldon / 1.6);
      const mat = new THREE.MeshStandardMaterial({ map: teja, roughness: 0.75 });
      for (const lado of [-1, 1]) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(w + VUELO * 2, 0.12, faldon), mat);
        f.position.set(cx, base + alto / 2, cz + lado * (d / 4 + VUELO / 2));
        f.rotation.x = lado * ang;
        f.castShadow = true;
        g.add(f);
      }
      // Hastiales (los triángulos de los extremos), del color de la casa.
      const tri = new THREE.Shape();
      tri.moveTo(-d / 2, 0); tri.lineTo(d / 2, 0); tri.lineTo(0, alto); tri.closePath();
      const geo = new THREE.ExtrudeGeometry(tri, { depth: GROSOR, bevelEnabled: false });
      for (const x of [r.x0, r.x1 - GROSOR]) {
        const h = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: c.muro, roughness: 0.85 }));
        h.rotation.y = Math.PI / 2;
        h.position.set(x + GROSOR, base, cz);
        h.castShadow = true;
        g.add(h);
      }
      // Cumbrera.
      const cumbrera = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, w + VUELO * 2, 10), new THREE.MeshStandardMaterial({ color: "#8E3B2A" }));
      cumbrera.rotation.z = Math.PI / 2;
      cumbrera.position.set(cx, base + alto + 0.04, cz);
      g.add(cumbrera);
    } else {
      // Techo plano moderno: losa, antepecho del color de acento y detalles en la azotea.
      const losa = new THREE.Mesh(new THREE.BoxGeometry(w + VUELO, 0.22, d + VUELO), new THREE.MeshStandardMaterial({ color: "#D9D4CC", roughness: 0.9 }));
      losa.position.set(cx, base + 0.11, cz);
      losa.castShadow = true;
      g.add(losa);
      const ante = new THREE.MeshStandardMaterial({ color: c.acento, roughness: 0.7 });
      for (const [bx, bz, bw, bd] of [[cx, r.z0 - VUELO / 2, w + VUELO, 0.18], [cx, r.z1 + VUELO / 2, w + VUELO, 0.18],
                                       [r.x0 - VUELO / 2, cz, 0.18, d + VUELO], [r.x1 + VUELO / 2, cz, 0.18, d + VUELO]]) {
        const a = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.4, bd), ante);
        a.position.set(bx, base + 0.4, bz);
        a.castShadow = true;
        g.add(a);
      }
      if (c.id === "bunker") {
        // Paneles solares en la azotea del Búnker.
        const panel = new THREE.MeshStandardMaterial({ color: "#1F3B73", roughness: 0.25, metalness: 0.5 });
        for (let i = 0; i < 5; i++) {
          const p = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 1), panel);
          p.position.set(r.x0 + 2 + i * 2.2, base + 0.45, cz - 1);
          p.rotation.x = -0.35;
          p.castShadow = true;
          g.add(p);
        }
      } else {
        // Tienda digital: toldo a rayas sobre la puerta y letrero.
        const rayas = this.textura((ctx, n) => {
          for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? "#FFFFFF" : c.acento; ctx.fillRect((i * n) / 8, 0, n / 8, n); }
        });
        rayas.repeat.set(2, 1);
        const toldo = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 0.06, 1.3), new THREE.MeshStandardMaterial({ map: rayas, roughness: 0.8 }));
        toldo.position.set(c.puertaFuera.x, base - 0.25, r.z1 + 0.55);
        toldo.rotation.x = 0.32;
        toldo.castShadow = true;
        this.scene.add(toldo); // el toldo no se levanta con el techo: es de la fachada
      }
    }
    for (const o of g.children) this.elegible(o, { tipo: "casa", id: c.id });
    // Materiales propios y transparentes desde ya, para poder desvanecer el techo al abrir.
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.material = (m.material as THREE.Material).clone();
      (m.material as THREE.Material).transparent = true;
    });
    this.scene.add(g);
  }

  /** Bodega: 3 filas × 6 estantes; `userData.casillas` = dónde va cada frasco o caja (motor.ts los
   *  llena según el stock). */
  private async bodegaEstantes() {
    for (const z of ESTANTES.filas) {
      for (let i = 0; i < ESTANTES.porFila; i++) {
        const x = ESTANTES.x0 + 0.65 + i * ESTANTES.paso;
        const g = new THREE.Group();
        g.position.set(x, 0.12, z);
        const est = await objetoAlto("muebles/bookcaseOpen", 1.35);
        g.add(est);
        const t = new THREE.Box3().setFromObject(est).getSize(new THREE.Vector3());
        g.userData.casillas = [0.04, 0.36, 0.68].flatMap((nivel) => [-1, 1].map((lado) =>
          new THREE.Vector3(lado * t.x * 0.22, t.y * nivel + 0.02, 0.02)));
        this.scene.add(g);
        this.estantes.push(g);
      }
    }
  }

  /** Camas de cultivo con hongos hechos con formas (tallo + sombrero), bajo un techito. */
  private async cultivoHongos() {
    const tallo = new THREE.MeshStandardMaterial({ color: "#F3E9D2", roughness: 0.8 });
    const sombreros = ["#C8875A", "#B5703F", "#E0B48A"].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
    const tierra = new THREE.MeshStandardMaterial({ color: "#5B3B24", roughness: 1 });
    const madera = new THREE.MeshStandardMaterial({ color: "#9A6B43", roughness: 0.9 });
    for (let cama = 0; cama < 2; cama++) {
      const cx = 2.2 + cama * 2.6, cz = 5.4;
      const marco = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.26, 1.2), madera);
      marco.position.set(cx, 0.13, cz);
      const suelo = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.05, 1.05), tierra);
      suelo.position.set(cx, 0.27, cz);
      marco.castShadow = marco.receiveShadow = suelo.receiveShadow = true;
      this.scene.add(marco, suelo);
      for (let i = 0; i < 14; i++) {
        const hx = cx - 0.82 + (i % 7) * 0.27, hz = cz - 0.28 + Math.floor(i / 7) * 0.56 + ((i * 13) % 5) * 0.03;
        const alto = 0.08 + ((i * 7) % 4) * 0.025;
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, alto, 8), tallo);
        t.position.set(hx, 0.29 + alto / 2, hz);
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), sombreros[i % 3]);
        s.position.set(hx, 0.29 + alto, hz);
        s.scale.y = 0.75;
        s.castShadow = true;
        this.scene.add(t, s);
      }
    }
    const lona = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.06, 2.4), new THREE.MeshStandardMaterial({ color: "#3F8E5A", roughness: 0.9 }));
    lona.position.set(3.5, 1.65, 5.4);
    lona.castShadow = true;
    this.scene.add(lona);
    for (const [x, z] of [[0.8, 4.3], [6.2, 4.3], [0.8, 6.5], [6.2, 6.5]]) {
      const poste = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.65, 8), madera);
      poste.position.set(x, 0.83, z);
      poste.castShadow = true;
      this.scene.add(poste);
    }
  }

  private async decorar() {
    const tareas: Promise<unknown>[] = [];
    const p = (ruta: string, x: number, z: number, rot: number, alto: number, ocupa = 0) => {
      tareas.push(this.poner(ruta, x, z, rot, alto));
      if (ocupa) this.huellas.push({ x0: x - ocupa, z0: z - ocupa, x1: x + ocupa, z1: z + ocupa });
    };
    const C = `${K}ciudad/`, N = `${K}medieval/decoration/nature/`;
    // Al otro lado de la calle: edificios del pueblo, árboles en el andén.
    const vecinos = ["building_A", "building_B", "building_C", "building_D", "building_E", "building_F", "building_G", "building_H"];
    for (let i = 0; i < 10; i++) {
      p(`${C}${vecinos[i % vecinos.length]}_withoutBase.gltf`, -34 + i * 7.6, 17.5, 180, 4.2 + ((i * 37) % 4) * 0.9, 3);
    }
    for (let i = 0; i < 14; i++) p(`${N}tree_single_${i % 2 ? "A" : "B"}.gltf`, -33 + i * 5, 14.2, i * 40, 2.8 + (i % 3) * 0.3);
    // Postes de luz en los dos andenes, hidrante, bancas y canecas.
    for (let i = 0; i < 9; i++) {
      p(`${C}streetlight.gltf`, -32 + i * 8, ANDEN_Z + 0.35, 180, 2.7);
      p(`${C}streetlight.gltf`, -28 + i * 8, CALLE.z1 + 0.7, 0, 2.7);
    }
    p(`${C}firehydrant.gltf`, -9.4, ANDEN_Z + 0.2, 0, 0.45);
    p(`${C}bench.gltf`, 14.4, ANDEN_Z, 180, 0.55);
    p(`${C}trash_A.gltf`, 15.8, ANDEN_Z + 0.1, 0, 0.6);
    p(`${C}dumpster.gltf`, 12.6, -10.2, 0, 0.9, 1);
    // Carros parqueados enfrente.
    p(`${C}car_sedan.gltf`, -20, CALLE.z1 - 0.7, 90, 0.85);
    p(`${C}car_taxi.gltf`, 4.5, CALLE.z1 - 0.7, 90, 0.85);
    p(`${C}car_hatchback.gltf`, 26, CALLE.z1 - 0.7, 90, 0.85);
    // Fondo: bosque que cierra el barrio.
    for (let i = 0; i < 22; i++) p(`${N}trees_A_${i % 3 ? "large" : "medium"}.gltf`, -38 + i * 3.6, -15 - (i % 3) * 1.4, i * 31, 3.6 + (i % 4) * 0.4);
    // Jardines: setos (bush) junto a la cerca, árboles y la huerta del Búnker.
    for (const c of CASAS) {
      for (let x = c.lote.x0 + 0.8; x < c.lote.x1 - 0.4; x += 1.6) {
        if (Math.abs(x - c.puertaFuera.x) < 1.4) continue;
        if (c.id === "sede" && (Math.abs(x - 10.2) < 1.8 || Math.abs(x + 5) < 4.4)) continue;
        p(`${C}bush.gltf`, x, 7.9, x * 20, 0.6);
      }
    }
    for (const [x, z] of [[-17, 4.6], [-29.6, 3], [-14.6, 6.4], [12.6, 4.2], [-10.2, 5.6], [18.2, 4.2], [29.4, 4], [30.2, -2]]) {
      p(`${N}tree_single_${x > 0 ? "A" : "B"}.gltf`, x, z, x * 10, 2.7, 0.8);
    }
    for (let i = 0; i < 6; i++) p("naturaleza/crops_cornStageD", -28.4 + i * 0.9, 5.6, 0, 1.0);
    for (let i = 0; i < 4; i++) p("naturaleza/crop_pumpkin", -28 + i * 1.3, 6.8, i * 30, 0.45);
    this.huellas.push({ x0: -29, z0: 5, x1: -22.5, z1: 7.4 });
    await Promise.all(tareas);
  }
}

function crecer(r: Rect, m: number): Rect {
  return { x0: r.x0 - m, z0: r.z0 - m, x1: r.x1 + m, z1: r.z1 + m };
}
