/**
 * La escena de Phaser: el barrio en pixel art y todo lo que se mueve en él. No decide nada de la
 * operación (eso es motor.ts): dibuja, mueve figuras por sus rutas, sigue al jugador con la cámara
 * y levanta el techo de la casa donde él entra.
 *
 * Profundidad: cada cosa se ordena por la y de donde toca el piso (quien pasa detrás de un estante
 * queda detrás). Los techos van con la y de su fachada; los avioncitos y lo de la interfaz, encima.
 */
import Phaser from "phaser";
import { colorModulo, infoModulo, tituloEtapa } from "./barrio";
import { Rejilla } from "./camino";
import { BASE_PIXEL, claveAvatar, componerAvatar, FILA } from "./personajes";
import type { AvatarPixel, Dir, EstacionMapa, Examinable, Mapa, Pose, PuntoMapa } from "./tipos";

export const FUENTE = "PixelifyMck";
const CUADROS = 25;
const PIE_Y = 60 / 64;                 // dónde están los pies dentro del cuadro de 64×64 de LPC
const VEL_CAMINA = 92, VEL_CORRE = 168;
const Z_TECHO = 0, Z_AVION = 40000, Z_NOCHE = 50000;

export type TipoFigura = "persona" | "jugador" | "visitante" | "proveedor" | "mensajero" | "hugo" | "vehiculo" | "objeto";
/** `sobre` = la y del mueble donde queda puesto (una caja en la mesa): se dibuja por delante de él. */
export interface Paso { x: number; y: number; dir?: Dir; pose?: Pose; pausa?: number; sobre?: number }

export interface Figura {
  id: string;
  tipo: TipoFigura;
  spr: Phaser.GameObjects.Sprite;
  tex: string;
  x: number;
  y: number;
  dir: Dir;
  pose: Pose;
  ruta: Paso[];
  base: Paso | null;
  vel: number;
  sale?: boolean;
  nombre?: Phaser.GameObjects.Text;
  icono?: Phaser.GameObjects.Text;
  globo?: { c: Phaser.GameObjects.Container; hasta: number };
  ex?: Examinable;
  lugar?: string;
  momento?: { pose: Pose; hasta: number; dir?: Dir };
  pausaHasta?: number;
  /** Para lo que va y viene (alistar, aseo) y las pausas de la vida diaria. */
  ronda?: Paso[];
  rondaK?: number;
  vidaEn?: number;
  presente?: boolean;
  ocupado?: boolean;
  /** Persona que también está jugando: su posición llega por la red. */
  remoto?: { x: number; y: number; dir: Dir; pose: Pose; t: number } | null;
  /** Los vehículos solo miran a izquierda o derecha (se voltea el dibujo). */
  vehiculo?: boolean;
  look?: string;
  alLlegar?: () => void;
  aparecer?: number;
}

export interface Ajustes {
  onListo: () => void;
  onExaminar: (e: Examinable | null) => void;
  onCerca: (texto: string | null) => void;
  onMover: (p: { x: number; y: number; dir: Dir; pose: Pose }) => void;
  onError: (msg: string) => void;
  onSonido: (n: string) => void;
  posicionInicial: () => { x: number; y: number; dir: Dir } | null;
  /** El jugador entró a otro cuarto o patio (null = la calle, un pasillo). */
  onLugar: (lugar: string | null) => void;
}

/** Teclas → acción. Ni se roban teclas cuando se escribe en un campo de texto. */
const TECLAS: Record<string, string> = {
  ArrowUp: "arriba", KeyW: "arriba", ArrowDown: "abajo", KeyS: "abajo", ArrowLeft: "izquierda", KeyA: "izquierda",
  ArrowRight: "derecha", KeyD: "derecha", ShiftLeft: "correr", ShiftRight: "correr", KeyX: "correr",
  Space: "accion", Enter: "accion", KeyE: "accion", KeyZ: "accion", NumpadEnter: "accion",
};

function esCampo(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export class EscenaBarrio extends Phaser.Scene {
  mapa!: Mapa;
  rejilla!: Rejilla;
  ajustes!: Ajustes;
  jugador: Figura | null = null;
  figuras = new Map<string, Figura>();
  private techos = new Map<string, { img: Phaser.GameObjects.Image; letrero: Phaser.GameObjects.Text; quien: Phaser.GameObjects.Text; rect: number[] }>();
  private repisas = new Map<string, { clave: string; objs: Phaser.GameObjects.GameObject[] }>();
  /** Los objetos de los módulos: ícono, nombre (sale al acercarse) y globito de pendientes. */
  /** Cada objeto-módulo: `ico` = la placa flotante (marco del color de su etapa + ícono + globito de
   *  pendientes), `nombre` = su rótulo. */
  estaciones: { e: EstacionMapa; ico: Phaser.GameObjects.Container; nombre: Phaser.GameObjects.Text; badge: Phaser.GameObjects.Text; casa: string | null }[] = [];
  private rotulos = new Map<string, Phaser.GameObjects.Text>();
  private lugarActual: string | null = null;
  private teclas = new Set<string>();
  private virtuales = new Set<string>();
  private bloqueado = false;
  private rutaJugador: Paso[] = [];
  private alLlegarJugador: (() => void) | null = null;
  private cercaActual: string | null = null;
  private ultimoEnvio = 0;
  private ultimaPos = "";
  private texturas = new Map<string, Promise<string>>();
  private noche!: Phaser.GameObjects.Rectangle;
  private luces: Phaser.GameObjects.Image[] = [];
  private marca!: Phaser.GameObjects.Text;
  private aviso!: Phaser.GameObjects.Text;
  sinTechos = false;
  zoom = 2;
  private escuchas: [string, EventListener][] = [];
  listo = false;

  constructor() {
    super("barrio");
  }

  init(datos: { ajustes: Ajustes }) {
    this.ajustes = datos.ajustes;
  }

  preload() {
    const B = BASE_PIXEL;
    this.load.json("mapa", `${B}mapa.json?v=1`);
    this.load.image("suelo", `${B}suelo.png?v=1`);
    this.load.atlas("muebles", `${B}muebles.png?v=1`, `${B}muebles.json?v=1`);
    this.load.atlas("objetos", `${B}objetos.png?v=1`, `${B}objetos.json?v=1`);
    this.load.spritesheet("hugo", `${B}hugo.png?v=1`, { frameWidth: 48, frameHeight: 64 });
    for (const casa of ["bunker", "sede", "tienda"]) this.load.image(`techo-${casa}`, `${B}techos/${casa}.png?v=1`);
    this.load.on("loaderror", (f: { key: string }) => this.ajustes.onError(`No cargó «${f.key}» del barrio. Recarga la página; si sigue, avisa a sistemas.`));
  }

  create() {
    this.mapa = this.cache.json.get("mapa") as Mapa;
    this.rejilla = new Rejilla(this.mapa.solido, this.mapa.celda);
    this.add.image(0, 0, "suelo").setOrigin(0, 0).setDepth(-100000);
    for (const m of this.mapa.muebles) {
      const img = this.add.image(m.x, m.y, "muebles", m.f);
      this.origenDeCuadro(img);
      img.setDepth((m.zbase ?? m.y) + (m.z ?? 0) * 0.01);
    }
    this.crearEstaciones();
    this.crearRotulos();
    for (const [id, casa] of Object.entries(this.mapa.casas)) {
      const t = casa.techo;
      const img = this.add.image(t.x, t.y, `techo-${id}`).setOrigin(0, 0).setDepth(t.base_y + Z_TECHO);
      const letrero = this.texto(t.letrero.x, t.letrero.y, t.letrero.texto, 9, "#ffffff", "#2b2d42")
        .setOrigin(0.5, 0.5).setDepth(t.base_y + 1);
      const quien = this.texto(t.x + t.w / 2, t.y + 30, "", 9, "#1d2b53", "#ffffff").setOrigin(0.5, 0).setDepth(t.base_y + 2);
      this.techos.set(id, { img, letrero, quien, rect: casa.rect });
    }
    // Luces de la calle (de noche) en cada poste: un halo con degradé, más fuerte bajo la lámpara.
    if (!this.textures.exists("halo")) {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const g = c.getContext("2d")!;
      const r = g.createRadialGradient(64, 64, 4, 64, 64, 64);
      r.addColorStop(0, "rgba(255,236,170,0.9)");
      r.addColorStop(0.45, "rgba(255,226,150,0.35)");
      r.addColorStop(1, "rgba(255,220,140,0)");
      g.fillStyle = r;
      g.fillRect(0, 0, 128, 128);
      this.textures.addCanvas("halo", c);
    }
    for (const m of this.mapa.muebles) if (m.f === "poste") {
      this.luces.push(this.add.image(m.x, m.y - 20, "halo").setScale(1.3, 0.9).setAlpha(0).setDepth(Z_NOCHE + 1).setBlendMode(Phaser.BlendModes.ADD));
    }
    this.noche = this.add.rectangle(0, 0, 10, 10, 0x1b2550, 0).setOrigin(0, 0).setScrollFactor(0).setDepth(Z_NOCHE)
      .setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.marca = this.texto(0, 0, "▼", 10, "#ffe14d", "#1d2b53").setOrigin(0.5, 1).setDepth(Z_AVION).setVisible(false);
    this.aviso = this.texto(0, 0, "", 9, "#ffffff", "#1d2b53").setOrigin(0.5, 1).setDepth(Z_AVION).setVisible(false);
    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.mapa.ancho, this.mapa.alto);
    cam.setBackgroundColor("#2f6b2f");
    this.ajustarZoom();
    this.scale.on("resize", () => this.ajustarZoom());
    this.instalarTeclado();
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => this.tocar(p));
    this.listo = true;
    this.ajustes.onListo();
  }

  // ─── Los módulos de la app como objetos del barrio ─────────────────────────

  private crearEstaciones() {
    for (const e of this.mapa.estaciones ?? []) {
      // Para que no se confunda con los muebles: una placa del color de la etapa del Mapa (con borde
      // claro, que se lee en piso claro y oscuro), una puntita hacia el mueble y un vaivén suave.
      const c = e.tipo === "modulo" ? colorModulo(e.panel)
        : e.tipo === "ajedrez" ? { fondo: "#C2C3C7", tinta: "#000000" } : e.tipo === "tenis" ? { fondo: "#00E436", tinta: "#000000" }
        : { fondo: "#FFF1E8", tinta: "#000000" };
      const fondo = Phaser.Display.Color.HexStringToColor(c.fondo).color;
      const marco = this.add.graphics();
      marco.fillStyle(0xfff1e8, 1).fillRoundedRect(-15, -25, 30, 30, 7);
      marco.fillStyle(0x0b0f2a, 1).fillRoundedRect(-14, -24, 28, 28, 6);
      marco.fillStyle(fondo, 1).fillRoundedRect(-12, -22, 24, 24, 5);
      marco.fillStyle(0xfff1e8, 1).fillTriangle(-6, 4, 6, 4, 0, 10);
      marco.fillStyle(0x0b0f2a, 1).fillTriangle(-4, 4, 4, 4, 0, 8);
      const img = this.add.image(0, 0, "objetos", `ico_${e.icono}`).setOrigin(0.5, 1);
      const badge = this.texto(11, -22, "", 8, "#ffffff", "#c0392b").setOrigin(0.5, 0.5).setVisible(false);
      const ico = this.add.container(e.x, e.y - 2, [marco, img, badge]).setDepth(e.z + 2).setSize(30, 34);
      // La repisa de trofeos no lleva placa: lo que se ve son los trofeos mismos (queda
      // transparente para que se pueda tocar).
      if (e.tipo === "trofeos") ico.setAlpha(0);
      else this.tweens.add({ targets: ico, y: e.y - 4, duration: 1100, yoyo: true, repeat: -1, ease: "Sine.easeInOut", delay: (e.x * 7 + e.y * 3) % 1100 });
      const titulo = e.tipo === "directorio" ? "Directorio de la casa" : e.tipo === "ajedrez" ? "Mesa de ajedrez"
        : e.tipo === "trofeos" ? "Repisa de trofeos" : e.tipo === "tenis" ? "Cancha de tenis" : infoModulo(e.panel).nombre;
      const nombre = this.add.text(e.x, e.y - 30, titulo, {
        fontFamily: FUENTE, fontSize: "8px", color: c.tinta, backgroundColor: c.fondo, padding: { x: 3, y: 1 },
        resolution: Math.max(2, Math.ceil(this.zoom * (window.devicePixelRatio || 1))),
      }).setOrigin(0.5, 1).setDepth(Z_AVION - 2).setVisible(false);
      this.estaciones.push({ e, ico, nombre, badge, casa: this.casaDe(e.x, e.z - 2) });
    }
  }

  /** El nombre de cada cuarto en su muro (y la etapa del Mapa de la app que se trabaja ahí). */
  private crearRotulos() {
    for (const [id, l] of Object.entries(this.mapa.lugares)) {
      if (!l.rotulo || id.startsWith("cuarto")) continue;
      const etapas = l.etapas.map(tituloEtapa).join(" · ");
      const casa = this.mapa.casas[l.casa];
      const t = this.texto(l.rotulo.x, l.rotulo.y, etapas ? `${l.titulo.toUpperCase()}\n${etapas}` : l.titulo.toUpperCase(), 10, "#ffffff", "#1d2b53")
        .setOrigin(0.5, 0).setLineSpacing(-1)
        .setDepth(Z_AVION - 3);
      void casa;
      this.rotulos.set(id, t);
    }
  }

  /** Los cuartos llevan el nombre de quien duerme ahí (lo dice empresa_viva_casas.json). */
  nombrarCuarto(lugar: string, texto: string) {
    const l = this.mapa.lugares[lugar];
    if (!l?.rotulo) return;
    let t = this.rotulos.get(lugar);
    if (!t) {
      t = this.texto(l.rotulo.x, l.rotulo.y, "", 9, "#ffffff", "#1d2b53").setOrigin(0.5, 0).setDepth(Z_AVION - 3);
      this.rotulos.set(lugar, t);
    }
    if (t.text !== texto) t.setText(texto);
  }

  /** Lo detenido de cada módulo (del Mapa): un globito rojo con el número sobre su objeto. */
  pendientes(por: Record<string, { n: number; alta: boolean }>) {
    for (const s of this.estaciones) {
      const p = s.e.tipo === "modulo" ? por[s.e.panel] : undefined;
      s.badge.setVisible(Boolean(p?.n));
      if (p?.n) s.badge.setText(p.n > 999 ? "999+" : String(p.n)).setStroke(p.alta ? "#c0392b" : "#b9770e", 4);
    }
  }

  /** Dónde está el objeto de un módulo (el más cercano a `cerca`, si hay varios: la agenda, el chat). */
  estacionDe(panel: string, cerca?: { x: number; y: number }, casa?: string): EstacionMapa | null {
    const todas = this.estaciones.filter((s) => s.e.panel === panel && s.e.tipo === "modulo");
    if (!todas.length) return null;
    const enCasa = casa ? todas.filter((s) => s.casa === casa) : [];
    const lista = enCasa.length ? enCasa : todas;
    if (!cerca) return lista[0].e;
    return lista.reduce((a, b) => (Math.hypot(a.e.uso.x - cerca.x, a.e.uso.y - cerca.y) <= Math.hypot(b.e.uso.x - cerca.x, b.e.uso.y - cerca.y) ? a : b)).e;
  }

  private exDeEstacion(e: EstacionMapa): Examinable {
    if (e.tipo === "ajedrez") return { tipo: "ajedrez" };
    if (e.tipo === "trofeos") return { tipo: "trofeos", lugar: e.lugar };
    if (e.tipo === "tenis") return { tipo: "tenis" };
    return e.tipo === "directorio" ? { tipo: "directorio", casa: e.casa ?? "" } : { tipo: "modulo", panel: e.panel, lugar: e.lugar };
  }

  /** Los trofeos de cada cuarto en su repisa, al lado de la cama (`medallas` en el orden en que se
   *  ganaron). Caben 8; desde el noveno, el último puesto dice cuántos más hay. */
  trofeos(porCuarto: Record<string, string[]>) {
    for (const [nombre, punto] of Object.entries(this.mapa.puntos)) {
      if (!nombre.startsWith("trofeos_")) continue;
      const p = punto as PuntoMapa;
      const cuarto = nombre.slice("trofeos_".length);
      const medallas = porCuarto[cuarto] ?? [];
      const clave = medallas.join(",");
      const antes = this.repisas.get(cuarto);
      if (antes?.clave === clave) continue;
      antes?.objs.forEach((o) => o.destroy());
      const cols = p.columnas ?? 4, filas = p.filas ?? 2, caben = cols * filas;
      const mostrar = medallas.length > caben ? medallas.slice(-(caben - 1)) : medallas;
      const objs: Phaser.GameObjects.GameObject[] = mostrar.map((m, i) =>
        this.add.image(p.x + (i % cols) * (p.paso ?? 10), p.y + Math.floor(i / cols) * (p.alto_fila ?? 22), "objetos", `trofeo_${m}`)
          .setOrigin(0.5, 1).setDepth((p.sobre ?? p.y) + 0.5));
      if (medallas.length > caben) {
        const i = caben - 1;
        objs.push(this.texto(p.x + (i % cols) * (p.paso ?? 10), p.y + Math.floor(i / cols) * (p.alto_fila ?? 22) - 4,
          `+${medallas.length - mostrar.length}`, 8, "#ffe14d", "#1d2b53").setOrigin(0.5, 1).setDepth((p.sobre ?? p.y) + 0.5));
      }
      this.repisas.set(cuarto, { clave, objs });
    }
  }

  /** A la cancha de tenis: al lado de tu equipo (A a la izquierda de la red), uno detrás de otro. */
  irATenis(equipo: "A" | "B", i: number): boolean {
    const p = this.mapa.puntos[`tenis_${equipo}`] as PuntoMapa | undefined;
    if (!p || !this.jugador) return false;
    const fila = [0, -1, 1][Math.max(0, Math.min(2, i))];
    this.llevarJugador(p.x, p.y + fila * (p.paso ?? 24), p.dir);
    return true;
  }

  /** Camina hasta la repisa de trofeos de un cuarto y la mira. */
  irATrofeos(cuarto: string): boolean {
    const e = this.estaciones.find((s) => s.e.tipo === "trofeos" && s.e.lugar === cuarto)?.e;
    if (!e || !this.jugador) return false;
    this.irAEstacion(e, true);
    return true;
  }

  /** A la mesa de ajedrez del parque: lado 0 = el banco de la izquierda, 1 = el de la derecha
   *  (punto «ajedrez_der» de mapa.json). Se sienta de lado, mirando el tablero. */
  irAMesaAjedrez(lado: 0 | 1, alLlegar?: () => void): boolean {
    const mesa = this.estaciones.find((s) => s.e.tipo === "ajedrez")?.e;
    const der = this.mapa.puntos.ajedrez_der;
    if (!mesa || !this.jugador) return false;
    const p = lado === 1 && der ? { x: der.x, y: der.y, dir: der.dir } : { x: mesa.uso.x, y: mesa.uso.y, dir: mesa.uso.dir };
    this.llevarJugador(p.x, p.y, p.dir, alLlegar);
    const ult = this.rutaJugador[this.rutaJugador.length - 1];
    if (ult) ult.pose = "sentado";
    return true;
  }

  /** El jugador camina hasta el objeto de un módulo y lo examina al llegar. */
  irAEstacion(e: EstacionMapa, examinar = true) {
    this.llevarJugador(e.uso.x, e.uso.y, e.uso.pose === "sentado" ? "abajo" : e.uso.dir, () => {
      if (examinar) { this.ajustes.onSonido("blip"); this.ajustes.onExaminar(this.exDeEstacion(e)); }
    });
    // Si el uso es sentado (un escritorio), al llegar se sienta.
    const ult = this.rutaJugador[this.rutaJugador.length - 1];
    if (ult && e.uso.pose === "sentado") ult.pose = "sentado";
  }

  /** El nombre del objeto más cercano (solo uno, para que no se monten) y, al cambiar de cuarto,
   *  el letrero con el nombre del cuarto (lo muestra el panel). Con «sin techos» se ven los nombres
   *  de todos los cuartos. */
  private nombresCerca() {
    const j = this.jugador;
    if (!j) return;
    const lugar = this.lugarDe(j.x, j.y);
    // Los nombres de los módulos del cuarto donde estás (y lo que tengas a unos pasos), del más
    // cercano al más lejano, sin que se monten: el que choca con uno ya puesto no sale.
    const candidatos: { s: EscenaBarrio["estaciones"][number]; d: number }[] = [];
    for (const s of this.estaciones) {
      const techo = s.casa ? this.techos.get(s.casa) : null;
      const visible = !techo || techo.img.alpha < 0.4;
      s.ico.setVisible(visible);
      s.nombre.setVisible(false);
      if (!visible || s.e.tipo === "trofeos") continue;
      const d = Math.hypot(s.e.uso.x - j.x, s.e.uso.y - j.y);
      if (d < 110 || (lugar && s.e.lugar === lugar && d < 420)) candidatos.push({ s, d });
    }
    candidatos.sort((a, b) => a.d - b.d);
    const puestos: Phaser.Geom.Rectangle[] = [];
    for (const { s, d } of candidatos.slice(0, 14)) {
      const r = s.nombre.getBounds();
      Phaser.Geom.Rectangle.Inflate(r, 2, 1);
      if (puestos.some((o) => Phaser.Geom.Intersects.RectangleToRectangle(o, r))) continue;
      puestos.push(r);
      s.nombre.setVisible(true).setAlpha(d < 60 ? 1 : 0.88);
    }
    for (const [id, r] of this.rotulos) r.setVisible(this.sinTechos || Boolean(this.mapa.lugares[id]?.afuera));
    if (lugar !== this.lugarActual) {
      this.lugarActual = lugar;
      this.ajustes.onLugar(lugar);
    }
  }

  // ─── Utilidades de dibujo ──────────────────────────────────────────────────

  texto(x: number, y: number, t: string, tam = 9, color = "#ffffff", borde = "#1d2b53"): Phaser.GameObjects.Text {
    return this.add.text(x, y, t, {
      fontFamily: FUENTE, fontSize: `${tam}px`, color, stroke: borde, strokeThickness: 3, align: "center",
      resolution: Math.max(2, Math.ceil(this.zoom * (window.devicePixelRatio || 1))),
    });
  }

  origenDeCuadro(img: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite) {
    const f = img.frame as Phaser.Textures.Frame & { customPivot?: boolean; pivotX?: number; pivotY?: number };
    if (f.customPivot) img.setOrigin(f.pivotX, f.pivotY);
    else img.setOrigin(0.5, 1);
  }

  ajustarZoom(forzar?: number) {
    const w = this.scale.width, h = this.scale.height;
    // De a medio paso (1, 1,5, 2…): ~17 × 9 baldosas a la vista, cerca del personaje como en
    // los RPG de Super Nintendo, sin que el pixel art se deforme mucho.
    const auto = Math.max(1, Math.min(4, Math.round(Math.min(w / 560, h / 300) * 2) / 2));
    this.zoom = forzar ?? auto;
    this.cameras.main.setZoom(this.zoom);
    // Lo que no se mueve con la cámara igual se escala con el zoom (desde el centro): el velo de
    // la noche se agranda para cubrir toda la pantalla con cualquier zoom.
    const z = this.zoom;
    this.noche.setSize(w / z + 4, h / z + 4).setPosition(w / 2 - w / (2 * z) - 2, h / 2 - h / (2 * z) - 2);
  }

  cambiarZoom(paso: number) {
    this.ajustarZoom(Math.max(0.5, Math.min(4, this.zoom + paso * 0.5)));
  }

  // ─── Personajes ────────────────────────────────────────────────────────────

  /** Registra la textura y las animaciones de un avatar (una vez por combinación). */
  texturaAvatar(a: AvatarPixel): Promise<string> {
    const clave = `av:${claveAvatar(a)}`;
    let p = this.texturas.get(clave);
    if (p) return p;
    p = componerAvatar(a).then((lienzo) => {
      if (!this.sys || !this.textures) return clave;
      if (this.textures.exists(clave)) return clave;
      const tex = this.textures.addCanvas(clave, lienzo);
      if (!tex) return clave;
      for (let fila = 0; fila < 4; fila++) for (let col = 0; col < CUADROS; col++) tex.add(fila * CUADROS + col, 0, col * 64, fila * 64, 64, 64);
      const anim = (nombre: string, fila: number, cols: number[], fps: number, repetir = -1) =>
        this.anims.create({ key: `${clave}:${nombre}`, frames: this.anims.generateFrameNumbers(clave, { frames: cols.map((c) => fila * CUADROS + c) }), frameRate: fps, repeat: repetir });
      for (const [dir, fila] of Object.entries(FILA)) {
        anim(`camina:${dir}`, fila, [1, 2, 3, 4, 5, 6, 7, 8], 11);
        anim(`corre:${dir}`, fila, [17, 18, 19, 20, 21, 22, 23, 24], 15);
        anim(`quieto:${dir}`, fila, [9, 9, 9, 10, 10, 10], 3);
        anim(`sentado:${dir}`, fila, [13], 1);
        anim(`celebra:${dir}`, FILA.abajo, [14, 15, 16, 16, 16, 15, 14], 8, 0);
      }
      return clave;
    });
    this.texturas.set(clave, p);
    return p;
  }

  crearFigura(id: string, tipo: TipoFigura, x: number, y: number, dir: Dir = "abajo"): Figura {
    const spr = this.add.sprite(x, y, "objetos", "papeles1").setOrigin(0.5, PIE_Y).setVisible(false);
    const f: Figura = { id, tipo, spr, tex: "", x, y, dir, pose: "quieto", ruta: [], base: null, vel: VEL_CAMINA * 0.85 };
    this.figuras.set(id, f);
    // La cámara va con el jugador (un poco por delante de los pies, a la altura de la cara).
    if (tipo === "jugador") this.cameras.main.startFollow(spr, true, 0.12, 0.12, 0, 24);
    return f;
  }

  async vestir(f: Figura, a: AvatarPixel) {
    const look = claveAvatar(a);
    if (f.look === look) return;
    f.look = look;
    const tex = await this.texturaAvatar(a);
    if (!this.figuras.has(f.id) && f !== this.jugador) return;
    f.tex = tex;
    f.spr.setTexture(tex, FILA[f.dir] * CUADROS + 9).setOrigin(0.5, PIE_Y).setVisible(true);
    this.animar(f, true);
  }

  quitarFigura(f: Figura) {
    f.spr.destroy();
    f.nombre?.destroy();
    f.icono?.destroy();
    f.globo?.c.destroy();
    this.figuras.delete(f.id);
  }

  ponerNombre(f: Figura, nombre: string, sub: string, color?: string, yo = false) {
    const txt = sub ? `${nombre}\n${sub}` : nombre;
    if (!f.nombre) {
      f.nombre = this.texto(f.x, f.y - 52, txt, 8, yo ? "#ffe14d" : "#ffffff", "#1d2b53").setOrigin(0.5, 1).setLineSpacing(-2);
    } else if (f.nombre.text !== txt) f.nombre.setText(txt);
    if (color) f.nombre.setColor(color);
  }

  ponerIcono(f: Figura, t: string | null, color = "#ffe14d") {
    if (!t) { f.icono?.destroy(); f.icono = undefined; return; }
    if (!f.icono) f.icono = this.texto(f.x + 16, f.y - 50, t, 10, color, "#1d2b53").setOrigin(0.5, 1);
    else { f.icono.setText(t); f.icono.setColor(color); }
  }

  /** Globo de texto sobre la cabeza (lo que dice o lo que acaba de pasar). */
  ponerGlobo(f: Figura, texto: string, ms = 5000, color = 0xffffff) {
    f.globo?.c.destroy();
    const t = this.add.text(0, 0, texto, {
      fontFamily: FUENTE, fontSize: "8px", color: "#1d2b53", align: "center", wordWrap: { width: 120 },
      resolution: Math.max(2, Math.ceil(this.zoom * (window.devicePixelRatio || 1))),
    }).setOrigin(0.5, 1);
    const w = Math.max(24, t.width + 10), h = t.height + 6;
    const g = this.add.graphics();
    g.fillStyle(color, 0.96).fillRoundedRect(-w / 2, -h - 4, w, h, 4);
    g.lineStyle(1, 0x1d2b53, 1).strokeRoundedRect(-w / 2, -h - 4, w, h, 4);
    g.fillStyle(color, 0.96).fillTriangle(-4, -5, 4, -5, 0, 1);
    g.lineStyle(1, 0x1d2b53, 1).lineBetween(-4, -4, 0, 1).lineBetween(4, -4, 0, 1);
    t.setPosition(0, -7);
    const c = this.add.container(f.x, f.y - 60, [g, t]);
    f.globo = { c, hasta: this.time.now + ms };
  }

  animar(f: Figura, forzar = false) {
    if (f.tipo === "hugo" || f.vehiculo || f.tipo === "objeto") return;
    if (!f.tex) return;
    const pose = f.momento && this.time.now < f.momento.hasta ? f.momento.pose : f.pose;
    const dir = f.momento?.dir && this.time.now < f.momento.hasta ? f.momento.dir : f.dir;
    const clave = `${f.tex}:${pose}:${dir}`;
    if (forzar || f.spr.anims.currentAnim?.key !== clave) f.spr.play(clave, true);
  }

  // ─── Movimiento ────────────────────────────────────────────────────────────

  /** Manda a una figura a un punto por un camino que no atraviese muros. */
  irA(f: Figura, destino: Paso, antes: Paso[] = []): boolean {
    const desde = antes.length ? antes[antes.length - 1] : f;
    const camino = this.rejilla.buscar(desde.x, desde.y, destino.x, destino.y);
    if (!camino) { f.ruta = [...antes, destino]; return false; }
    const ult = camino[camino.length - 1];
    Object.assign(ult, { dir: destino.dir, pose: destino.pose, pausa: destino.pausa });
    f.ruta = [...antes, ...camino];
    return true;
  }

  private mover(f: Figura, dt: number) {
    const ahora = this.time.now;
    if (f.remoto) {
      // Otro jugador: se acerca suave a donde dice la red.
      const r = f.remoto;
      const dx = r.x - f.x, dy = r.y - f.y, d = Math.hypot(dx, dy);
      if (d > 220) { f.x = r.x; f.y = r.y; }
      else if (d > 0.5) {
        const paso = Math.min(d, (r.pose === "corre" ? VEL_CORRE : VEL_CAMINA) * 1.25 * dt);
        f.x += (dx / d) * paso; f.y += (dy / d) * paso;
      }
      f.dir = r.dir;
      f.pose = d > 2 ? (r.pose === "corre" ? "corre" : "camina") : (r.pose === "camina" || r.pose === "corre" ? "quieto" : r.pose);
      return;
    }
    if (f.momento && ahora < f.momento.hasta) return;
    f.momento = undefined;
    if (f.pausaHasta && ahora < f.pausaHasta) { if (f.pose === "camina" || f.pose === "corre") f.pose = "quieto"; return; }
    f.pausaHasta = undefined;
    const destino = f.ruta[0] ?? (f.sale ? null : f.base);
    if (!destino) {
      if (f.sale) this.quitarFigura(f);
      return;
    }
    const dx = destino.x - f.x, dy = destino.y - f.y, d = Math.hypot(dx, dy);
    const paso = f.vel * dt;
    if (d <= paso || d < 0.5) {
      f.x = destino.x; f.y = destino.y;
      if (f.ruta.length) {
        const p = f.ruta.shift()!;
        if (p.pausa) {
          f.momento = { pose: p.pose ?? "quieto", hasta: ahora + p.pausa, dir: p.dir };
          if (p.dir) f.dir = p.dir;
        }
        if (!f.ruta.length && f.alLlegar) { const cb = f.alLlegar; f.alLlegar = undefined; cb(); }
        return;
      }
      if (f.sale) { this.quitarFigura(f); return; }
      if (destino.dir) f.dir = destino.dir;
      f.pose = destino.pose ?? "quieto";
      return;
    }
    f.x += (dx / d) * paso; f.y += (dy / d) * paso;
    f.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "derecha" : "izquierda") : (dy > 0 ? "abajo" : "arriba");
    f.pose = "camina";
  }

  private moverJugador(f: Figura, dt: number) {
    // Con un diálogo o un módulo abierto no se maneja con el teclado, pero si iba caminando solo
    // hacia el objeto del módulo que abrió, sigue (los demás lo ven llegar).
    if (this.bloqueado && !this.rutaJugador.length) { f.pose = f.pose === "sentado" ? "sentado" : "quieto"; return; }
    const t = this.bloqueado ? new Set<string>() : new Set([...this.teclas, ...this.virtuales]);
    let dx = (t.has("derecha") ? 1 : 0) - (t.has("izquierda") ? 1 : 0);
    let dy = (t.has("abajo") ? 1 : 0) - (t.has("arriba") ? 1 : 0);
    const corre = t.has("correr");
    if (dx || dy) {
      this.rutaJugador = [];
      this.alLlegarJugador = null;
      const n = Math.hypot(dx, dy);
      dx /= n; dy /= n;
      const v = (corre ? VEL_CORRE : VEL_CAMINA) * dt;
      const nx = f.x + dx * v, ny = f.y + dy * v;
      // Se intenta por ejes: así se resbala por los muros en vez de quedarse pegado.
      if (this.rejilla.cabe(nx, f.y)) f.x = nx;
      if (this.rejilla.cabe(f.x, ny)) f.y = ny;
      f.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "derecha" : "izquierda") : (dy > 0 ? "abajo" : "arriba");
      f.pose = corre ? "corre" : "camina";
      return;
    }
    const p = this.rutaJugador[0];
    if (p) {
      const ddx = p.x - f.x, ddy = p.y - f.y, d = Math.hypot(ddx, ddy);
      const v = VEL_CORRE * 0.9 * dt;
      if (d <= v) {
        f.x = p.x; f.y = p.y;
        this.rutaJugador.shift();
        if (!this.rutaJugador.length) {
          if (p.dir) f.dir = p.dir;
          f.pose = p.pose === "sentado" ? "sentado" : "quieto";
          const cb = this.alLlegarJugador;
          this.alLlegarJugador = null;
          cb?.();
        }
      } else {
        f.x += (ddx / d) * v; f.y += (ddy / d) * v;
        f.dir = Math.abs(ddx) > Math.abs(ddy) ? (ddx > 0 ? "derecha" : "izquierda") : (ddy > 0 ? "abajo" : "arriba");
        f.pose = "corre";
      }
      return;
    }
    if (f.pose === "camina" || f.pose === "corre") f.pose = "quieto";
  }

  /** Dónde pararse para hablarle a alguien: delante (al sur) si se puede, si no a un lado;
   *  a ~40 px, para que los dos se vean y los nombres no se monten. */
  puntoParaHablar(f: Figura): { x: number; y: number; dir: Dir } {
    const opciones: [number, number, Dir][] = [[0, 40, "arriba"], [-36, 4, "derecha"], [36, 4, "izquierda"], [0, -34, "abajo"]];
    for (const [dx, dy, dir] of opciones) {
      if (this.rejilla.cabe(f.x + dx, f.y + dy)) return { x: f.x + dx, y: f.y + dy, dir };
    }
    const p = this.rejilla.cercaLibre(f.x, f.y + 40);
    return { ...p, dir: "arriba" };
  }

  /** El jugador y con quien habla se miran (si el otro no está sentado trabajando ni lo maneja alguien). */
  mirarse(f: Figura) {
    const j = this.jugador;
    if (!j) return;
    const dx = f.x - j.x, dy = f.y - j.y;
    j.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "derecha" : "izquierda") : (dy > 0 ? "abajo" : "arriba");
    if ((f.tipo === "persona" || f.tipo === "visitante" || f.tipo === "proveedor" || f.tipo === "mensajero") && f.pose !== "sentado" && !f.remoto) {
      const haciaJ: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "izquierda" : "derecha") : (dy > 0 ? "arriba" : "abajo");
      f.momento = { pose: "quieto", hasta: this.time.now + 6000, dir: haciaJ };
    }
  }

  /** El jugador camina solo hasta un punto (tocar el piso, «ir donde» alguien). */
  llevarJugador(x: number, y: number, dir?: Dir, alLlegar?: () => void) {
    const f = this.jugador;
    if (!f) return;
    const camino = this.rejilla.buscar(f.x, f.y, x, y);
    if (!camino) { this.avisar("No hay por dónde llegar ahí"); return; }
    const ruta: Paso[] = camino;
    if (dir) ruta[ruta.length - 1].dir = dir;
    this.rutaJugador = ruta;
    this.alLlegarJugador = alLlegar ?? null;
  }

  // ─── Cuadro a cuadro ───────────────────────────────────────────────────────

  update(_t: number, dms: number) {
    if (!this.listo) return;
    const dt = Math.min(0.05, dms / 1000);
    const ahora = this.time.now;
    for (const f of [...this.figuras.values()]) {
      if (f.tipo === "jugador") this.moverJugador(f, dt);
      else this.mover(f, dt);
      if (!this.figuras.has(f.id)) continue;
      this.colocar(f, ahora);
    }
    this.techosSegunJugador();
    this.nombresCerca();
    this.revisarCerca();
    this.enviarPosicion(ahora);
  }

  private colocar(f: Figura, ahora: number) {
    const s = f.spr;
    let dy = 0;
    if (f.tipo === "hugo") {
      const k = f.momento && ahora < f.momento.hasta ? 3 : Math.floor(ahora / 450) % 3;
      s.setFrame(k);
      dy = Math.sin(ahora / 420) * 1.5;
    } else if (f.aparecer && ahora < f.aparecer) {
      s.setScale(Math.max(0.2, 1 - (f.aparecer - ahora) / 500));
    } else if (s.scale !== 1) s.setScale(1);
    if (f.vehiculo) s.setFlipX(f.dir === "derecha" ? s.getData("miraIzquierda") : !s.getData("miraIzquierda"));
    s.setPosition(Math.round(f.x), Math.round(f.y + dy));
    const quieto = !f.ruta.length && f.base && Math.abs(f.x - f.base.x) < 1 && Math.abs(f.y - f.base.y) < 1;
    s.setDepth(quieto && f.base?.sobre ? f.base.sobre : f.y);
    this.animar(f);
    const alto = f.vehiculo ? s.displayHeight : f.tipo === "objeto" ? s.displayHeight + 4 : f.pose === "sentado" ? 50 : 56;
    if (f.nombre) f.nombre.setPosition(Math.round(f.x), Math.round(f.y - alto)).setDepth(f.y + 0.6);
    if (f.icono) f.icono.setPosition(Math.round(f.x + 14), Math.round(f.y - alto - (f.nombre ? 14 : 0))).setDepth(f.y + 0.7);
    if (f.globo) {
      if (ahora > f.globo.hasta) { f.globo.c.destroy(); f.globo = undefined; }
      else f.globo.c.setPosition(Math.round(f.x), Math.round(f.y - alto - (f.nombre ? 16 : 2))).setDepth(f.y + 0.8);
    }
  }

  /** El techo de la casa donde está el jugador se levanta (y vuelve al salir). */
  private techosSegunJugador() {
    const j = this.jugador;
    for (const [id, t] of this.techos) {
      const [x0, y0, x1, y1] = t.rect;
      const dentro = j ? j.x > x0 && j.x < x1 && j.y > y0 && j.y < y1 + 2 : false;
      const meta = this.sinTechos || dentro ? 0 : 1;
      const a = t.img.alpha + (meta - t.img.alpha) * 0.18;
      t.img.setAlpha(Math.abs(a - meta) < 0.01 ? meta : a);
      t.letrero.setAlpha(t.img.alpha);
      t.quien.setAlpha(t.img.alpha);
      void id;
    }
  }

  /** Nombres de quién está adentro de cada casa, escritos sobre el techo. */
  ocupantes(casa: string, nombres: string[]) {
    const t = this.techos.get(casa);
    if (!t) return;
    const txt = nombres.length ? `Adentro: ${nombres.slice(0, 4).join(", ")}${nombres.length > 4 ? ` y ${nombres.length - 4} más` : ""}` : "";
    if (t.quien.text !== txt) t.quien.setText(txt);
  }

  casaDe(x: number, y: number): string | null {
    for (const [id, c] of Object.entries(this.mapa.casas)) {
      const [x0, y0, x1, y1] = c.rect;
      if (x > x0 && x < x1 && y > y0 && y < y1 + 2) return id;
    }
    return null;
  }

  lugarDe(x: number, y: number): string | null {
    for (const [id, l] of Object.entries(this.mapa.lugares)) {
      const [x0, y0, x1, y1] = l.rect;
      if (x >= x0 && x < x1 && y >= y0 && y < y1 + 2) return id;
    }
    return null;
  }

  // ─── Hablar y examinar ─────────────────────────────────────────────────────

  private enfrente(): { f: Figura | null; lugar: string | null; est: EstacionMapa | null } {
    const j = this.jugador;
    if (!j) return { f: null, lugar: null, est: null };
    const v = { arriba: [0, -1], abajo: [0, 1], izquierda: [-1, 0], derecha: [1, 0] }[j.dir];
    let mejor: Figura | null = null, dmin = 999;
    for (const f of this.figuras.values()) {
      if (f === j || !f.ex || !f.spr.visible) continue;
      const dx = f.x - j.x, dy = (f.y - 10) - (j.y - 10), d = Math.hypot(dx, dy);
      const alcance = f.tipo === "vehiculo" ? 90 : f.tipo === "objeto" ? 40 : 50;
      if (d > alcance) continue;
      const frente = d < 18 ? 1 : (dx * v[0] + dy * v[1]) / d;
      if (frente < 0.35) continue;
      if (d < dmin) { dmin = d; mejor = f; }
    }
    // El objeto de un módulo: estar parado en su sitio de uso, o tenerlo justo enfrente.
    let est: EstacionMapa | null = null, dEst = 999;
    const fx = j.x + v[0] * 26, fy = j.y + v[1] * 26;
    for (const s of this.estaciones) {
      if (!s.ico.visible) continue;
      const enSitio = Math.hypot(s.e.uso.x - j.x, s.e.uso.y - j.y);
      const alFrente = Math.hypot(s.e.x - fx, s.e.z - 10 - fy);
      const d = Math.min(enSitio < 26 ? enSitio : 999, alFrente < 30 ? alFrente + 4 : 999);
      if (d < dEst) { dEst = d; est = s.e; }
    }
    // Si hay una persona y un objeto, gana el que esté más cerca (la persona, por poquito).
    if (mejor && est && dEst + 8 >= dmin) est = null;
    else if (est) mejor = null;
    const lugar = this.lugarDe(j.x + v[0] * 30, j.y + v[1] * 30);
    return { f: mejor, lugar, est };
  }

  private revisarCerca() {
    const { f, est } = this.enfrente();
    const j = this.jugador;
    let texto: string | null = null;
    if (est && j && !this.bloqueado) {
      texto = est.tipo === "directorio" ? "Leer el directorio" : est.tipo === "ajedrez" ? "Jugar ajedrez"
        : est.tipo === "trofeos" ? "Ver los trofeos" : est.tipo === "tenis" ? "Jugar tenis" : `Ver ${infoModulo(est.panel).nombre}`;
      this.marca.setPosition(est.x, est.y - 22 + Math.sin(this.time.now / 160) * 2).setVisible(true);
      if (texto !== this.cercaActual) { this.cercaActual = texto; this.ajustes.onCerca(texto); }
      return;
    }
    if (f && j && !this.bloqueado) {
      const nombre = f.ex?.tipo === "persona" ? `Hablar con ${f.ex.datos.nombre.split(" ")[0]}` :
        f.ex?.tipo === "visitante" ? "Atender al cliente" : f.ex?.tipo === "hugo" ? "Hablar con Hugo" :
        f.ex?.tipo === "paquete" ? "Ver el paquete" : f.ex?.tipo === "proveedor" ? "Hablar con el proveedor" :
        f.ex?.tipo === "mensajero" ? "Hablar con el mensajero" : "Examinar";
      texto = nombre;
      const alto = f.vehiculo ? f.spr.displayHeight : 62;
      this.marca.setPosition(Math.round(f.x), Math.round(f.y - alto - (f.nombre ? 18 : 0) + Math.sin(this.time.now / 160) * 2)).setVisible(true);
    } else this.marca.setVisible(false);
    if (texto !== this.cercaActual) {
      this.cercaActual = texto;
      this.ajustes.onCerca(texto);
    }
  }

  /** Botón A: habla con quien tiene enfrente, o examina el lugar. */
  accion() {
    if (this.bloqueado || !this.jugador) return;
    const { f, lugar, est } = this.enfrente();
    if (est) {
      this.ajustes.onSonido("blip");
      this.ajustes.onExaminar(this.exDeEstacion(est));
      return;
    }
    if (f?.ex) {
      this.mirarse(f);
      this.ajustes.onSonido("blip");
      this.ajustes.onExaminar(f.ex);
      return;
    }
    if (lugar && !lugar.startsWith("pasillo")) {
      this.ajustes.onSonido("blip");
      this.ajustes.onExaminar({ tipo: "lugar", lugar });
    }
  }

  private tocar(p: Phaser.Input.Pointer) {
    if (this.bloqueado || !this.jugador) return;
    const x = p.worldX, y = p.worldY;
    // ¿Tocó a alguien? Camina hasta quedar a su lado y le habla.
    let toco: Figura | null = null;
    for (const f of this.figuras.values()) {
      if (!f.ex || f === this.jugador || !f.spr.visible) continue;
      const b = f.spr.getBounds();
      if (b.contains(x, y)) { if (!toco || f.y > toco.y) toco = f; }
    }
    if (!toco) {
      // ¿Tocó el ícono de un módulo? Camina hasta su sitio y lo examina.
      for (const x of this.estaciones) {
        if (x.ico.visible && x.ico.getBounds().contains(p.worldX, p.worldY)) { this.irAEstacion(x.e); return; }
      }
    }
    if (toco) {
      const objetivo = toco;
      const lado = this.puntoParaHablar(objetivo);
      const dist = Math.hypot(this.jugador.x - objetivo.x, this.jugador.y - objetivo.y);
      const hablar = () => {
        if (!this.jugador) return;
        this.mirarse(objetivo);
        if (objetivo.ex) { this.ajustes.onSonido("blip"); this.ajustes.onExaminar(objetivo.ex); }
      };
      if (dist < 56) { hablar(); return; }
      this.llevarJugador(lado.x, lado.y, lado.dir, hablar);
      return;
    }
    this.llevarJugador(x, y);
  }

  // ─── Teclado y controles en pantalla ───────────────────────────────────────

  private instalarTeclado() {
    const abajo = (e: KeyboardEvent) => {
      if (esCampo(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const a = TECLAS[e.code];
      // Bloqueado (un diálogo, el chat o un módulo abierto encima): las flechas y el espacio son de
      // lo que está abierto (desplazar el módulo, elegir una opción), no del juego.
      if (!a || this.bloqueado || !this.activo()) return;
      e.preventDefault();
      if (a === "accion") { if (!e.repeat) this.accion(); return; }
      this.teclas.add(a);
    };
    const arriba = (e: KeyboardEvent) => {
      const a = TECLAS[e.code];
      if (a) this.teclas.delete(a);
    };
    const fuera = () => this.teclas.clear();
    window.addEventListener("keydown", abajo);
    window.addEventListener("keyup", arriba);
    window.addEventListener("blur", fuera);
    this.escuchas.push(["keydown", abajo as EventListener], ["keyup", arriba as EventListener], ["blur", fuera]);
  }

  /** El juego atiende el teclado solo si está a la vista y nadie escribe en otro lado. */
  private activo(): boolean {
    const lienzo = this.game.canvas;
    if (!lienzo || !lienzo.isConnected || lienzo.offsetParent === null) return false;
    const foco = document.activeElement;
    return !foco || foco === document.body || lienzo.parentElement?.contains(foco) || foco === lienzo;
  }

  /** Con un diálogo abierto el personaje se queda quieto; si iba caminando solo (tocó el piso o
   *  «ir donde»), sigue al cerrarlo. */
  bloquear(b: boolean) {
    this.bloqueado = b;
    if (b) { this.teclas.clear(); this.virtuales.clear(); }
  }

  virtual(accion: string, presionada: boolean) {
    if (accion === "accion") { if (presionada) this.accion(); return; }
    if (presionada) this.virtuales.add(accion); else this.virtuales.delete(accion);
  }

  // ─── Red: dónde está el jugador ────────────────────────────────────────────

  private enviarPosicion(ahora: number) {
    const j = this.jugador;
    if (!j) return;
    const clave = `${Math.round(j.x)}|${Math.round(j.y)}|${j.dir}|${j.pose}`;
    const moviendo = j.pose === "camina" || j.pose === "corre";
    const cada = moviendo ? 300 : 4000;
    if (clave === this.ultimaPos && ahora - this.ultimoEnvio < 4000) return;
    if (ahora - this.ultimoEnvio < cada && clave !== this.ultimaPos && moviendo) return;
    this.ultimoEnvio = ahora;
    this.ultimaPos = clave;
    this.ajustes.onMover({ x: Math.round(j.x), y: Math.round(j.y), dir: j.dir, pose: j.pose });
  }

  // ─── Avisos, noche, avioncitos ─────────────────────────────────────────────

  avisar(t: string) {
    const j = this.jugador;
    if (!j) return;
    this.aviso.setText(t).setPosition(j.x, j.y - 70).setVisible(true);
    this.time.delayedCall(2200, () => this.aviso.setVisible(false));
  }

  /** De noche se oscurece el barrio y se prenden los postes (hora de Bogotá). */
  aplicarHora(h: number) {
    const noche = h < 5.5 || h > 19 ? 1 : h < 6.5 ? 1 - (h - 5.5) : h > 18 ? h - 18 : 0;
    this.noche.setFillStyle(0x1b2550, 0.55 * noche);
    for (const l of this.luces) l.setAlpha(0.75 * noche);
  }

  /** Un avioncito de papel de un avatar a otro (una pregunta, una respuesta, una idea). */
  avion(de: Figura, para: Figura, tipo: string, retraso: number, alLlegar: () => void) {
    const s = this.add.image(de.x, de.y - 44, "objetos", `avion_${tipo}`).setDepth(Z_AVION).setVisible(false);
    const ax = de.x, ay = de.y - 44;
    const dist = Math.hypot(para.x - de.x, para.y - de.y);
    const dur = 1500 + Math.min(1800, dist * 2.2);
    const altura = 30 + dist * 0.15;
    this.tweens.addCounter({
      from: 0, to: 1, duration: dur, delay: retraso, ease: "Sine.easeInOut",
      onStart: () => s.setVisible(true),
      onUpdate: (tw) => {
        const k = tw.getValue() ?? 0;
        const bx = para.x, by = para.y - 44;
        const x = ax + (bx - ax) * k, y = ay + (by - ay) * k - Math.sin(Math.PI * k) * altura;
        s.setFlipX(bx < ax).setPosition(x, y).setRotation((by - ay) * 0.0006 + (k < 0.5 ? -0.25 : 0.25) * (bx < ax ? -1 : 1));
      },
      onComplete: () => { s.destroy(); alLlegar(); },
    });
  }

  destruir() {
    for (const [ev, fn] of this.escuchas) window.removeEventListener(ev, fn);
    this.escuchas = [];
  }
}
