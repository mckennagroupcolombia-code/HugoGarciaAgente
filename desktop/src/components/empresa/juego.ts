/**
 * Empresa viva en Phaser (se carga lazy desde EmpresaViva.tsx: Phaser pesa ~1,4 MB). Arma el juego,
 * une la escena (escena.ts) con el motor (motor.ts) y le da al panel React una interfaz corta.
 */
import Phaser from "phaser";
import { EscenaBarrio, FUENTE, type Ajustes, type Decorar } from "./escena";
import type { EstadoVecindario, LoteMapa } from "./vecindario";
import { Motor, marcarRespuestaLeida } from "./motor";
import { BASE_PIXEL, cargarCatalogo, type Catalogo } from "./personajes";
import type { Dir, EstacionMapa, EstadoEmpresa, Examinable, InteraccionApi, JugadorApi, LugarMapa, Pose } from "./tipos";
import { objetoDe } from "./barrio";

export interface OpcionesJuego {
  onListo: () => void;
  onExaminar: (e: Examinable | null) => void;
  onCerca: (texto: string | null) => void;
  onMover: (p: { x: number; y: number; dir: Dir; pose: Pose }) => void;
  onError: (msg: string) => void;
  onSonido: (n: string) => void;
  onLugar: (lugar: string | null) => void;
}

const CLAVE_POS = "mck-ev-posicion";

let fuente: Promise<void> | null = null;
function cargarFuente(): Promise<void> {
  fuente ??= (async () => {
    try {
      const f = new FontFace(FUENTE, `url(${BASE_PIXEL}fuente/pixelify-sans-latin.woff2)`, { weight: "400 700" });
      await f.load();
      document.fonts.add(f);
    } catch {
      /* sin la fuente: Phaser usa la del sistema */
    }
  })();
  return fuente;
}

export class JuegoEmpresa {
  private game: Phaser.Game | null = null;
  private escena: EscenaBarrio | null = null;
  private motor: Motor | null = null;
  private pendiente: EstadoEmpresa | null = null;
  private jugadoresPend: JugadorApi[] | null = null;
  private reloj = 0;
  private catalogo: Catalogo | null = null;
  /** React (modo estricto) monta y desmonta antes de que termine de cargar la fuente: un juego
   *  destruido no debe arrancar después, o quedan dos lienzos uno encima del otro. */
  private destruido = false;

  constructor(private cont: HTMLElement, private op: OpcionesJuego) {
    void this.arrancar();
  }

  private async arrancar() {
    await Promise.all([cargarFuente(), cargarCatalogo().then((c) => { this.catalogo = c; }).catch(() => { this.op.onError("No cargó el catálogo de personajes."); })]);
    if (this.destruido || !this.cont.isConnected) return;
    const ajustes: Ajustes = {
      onListo: () => this.alListo(),
      onExaminar: (e) => this.op.onExaminar(e),
      onCerca: (t) => this.op.onCerca(t),
      onMover: (p) => { this.guardarPos(p); this.op.onMover(p); },
      onError: (m) => this.op.onError(m),
      onSonido: (n) => this.op.onSonido(n),
      posicionInicial: () => this.posGuardada(),
      onLugar: (l) => this.op.onLugar(l),
    };
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: this.cont,
      pixelArt: true,
      roundPixels: true,
      backgroundColor: "#2f6b2f",
      scale: { mode: Phaser.Scale.RESIZE, width: this.cont.clientWidth || 800, height: this.cont.clientHeight || 600 },
      input: { keyboard: false, gamepad: false },
      audio: { noAudio: true },
      banner: false,
      fps: { target: 60, smoothStep: true },
    });
    this.game.scene.add("barrio", EscenaBarrio, true, { ajustes });
  }

  private alListo() {
    const esc = this.game?.scene.getScene("barrio") as EscenaBarrio | null;
    if (!esc) return;
    this.escena = esc;
    this.motor = new Motor(esc, { onSonido: (n) => this.op.onSonido(n), catalogo: this.catalogo });
    const hora = () => {
      const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", hour12: false })
        .format(new Date()).split(":").map(Number);
      esc.aplicarHora(h + m / 60);
    };
    hora();
    this.reloj = window.setInterval(() => { this.motor?.vidaDiaria(); if (Date.now() % 60000 < 1000) hora(); }, 1000);
    if (this.pendiente) {
      const ini = this.posGuardada();
      this.motor.crearJugador(this.pendiente, ini);
      this.motor.sincronizar(this.pendiente);
      this.pendiente = null;
    }
    if (this.jugadoresPend) { this.motor.jugadores(this.jugadoresPend); this.jugadoresPend = null; }
    this.op.onListo();
  }

  private posGuardada(): { x: number; y: number; dir: Dir } | null {
    try {
      const p = JSON.parse(localStorage.getItem(CLAVE_POS) || "null") as { x: number; y: number; dir: Dir; t: number } | null;
      if (p && Date.now() - p.t < 12 * 3600_000) return p;
    } catch { /* sin almacenamiento */ }
    return null;
  }

  private guardarPos(p: { x: number; y: number; dir: Dir }) {
    try { localStorage.setItem(CLAVE_POS, JSON.stringify({ ...p, t: Date.now() })); } catch { /* sin almacenamiento */ }
  }

  // ─── Lo que usa el panel ───────────────────────────────────────────────────

  sincronizar(est: EstadoEmpresa) {
    if (!this.motor) { this.pendiente = est; return; }
    if (!this.escena?.jugador) this.motor.crearJugador(est, this.posGuardada());
    this.motor.sincronizar(est);
  }

  jugadores(lista: JugadorApi[]) {
    if (!this.motor) { this.jugadoresPend = lista; return; }
    this.motor.jugadores(lista);
  }

  jugando(id: number): boolean {
    return this.motor?.jugando(id) ?? false;
  }

  respuestaPendiente(id: number): InteraccionApi | null {
    return this.motor?.respuestaPendiente(id) ?? null;
  }

  leerRespuesta(id: string) {
    marcarRespuestaLeida(id);
  }

  lanzar(it: InteraccionApi) {
    this.motor?.lanzar(it);
  }

  /** Mientras hay un diálogo o un formulario abierto, el personaje no se mueve. */
  bloquear(b: boolean) {
    this.escena?.bloquear(b);
  }

  virtual(accion: string, presionada: boolean) {
    this.escena?.virtual(accion, presionada);
  }

  /** Camina solo hasta quedar al lado de alguien del equipo (y le habla al llegar). */
  irDonde(personaId: number, alLlegar?: () => void, intentos = 3): boolean {
    const esc = this.escena;
    const f = esc?.figuras.get(`p${personaId}`);
    if (!esc || !f || !esc.jugador) return false;
    const lado = esc.puntoParaHablar(f);
    esc.llevarJugador(lado.x, lado.y, lado.dir, () => {
      // Si mientras caminaba la persona se movió (un tinto, otra tarea), se la sigue.
      const j = esc.jugador;
      if (j && intentos > 1 && Math.hypot(j.x - f.x, j.y - f.y) > 64 && esc.figuras.has(f.id)) {
        this.irDonde(personaId, alLlegar, intentos - 1);
        return;
      }
      esc.mirarse(f);
      alLlegar?.();
    });
    return true;
  }

  /** Camina solo hasta un lugar (sus puestos de pie o la puerta). */
  irALugar(lugar: string) {
    const esc = this.escena;
    const l = esc?.mapa.lugares[lugar];
    if (!esc || !l) return;
    const pu = l.puestos.find((p) => p.pose === "parado") ?? l.puestos[0];
    const destino = pu ? esc.rejilla.cercaLibre(pu.x, pu.y + 26) : esc.rejilla.cercaLibre((l.rect[0] + l.rect[2]) / 2, (l.rect[1] + l.rect[3]) / 2);
    esc.llevarJugador(destino.x, destino.y);
  }

  /** Los objetos de los módulos (para «¿Dónde está…?» y los directorios). */
  estaciones(): EstacionMapa[] {
    return this.escena?.estaciones.map((s) => s.e) ?? [];
  }

  /** Camina hasta el objeto de un módulo (el más cercano, si hay dos) y lo examina al llegar. */
  /** `examinar` = al llegar abre el diálogo del objeto; sin él solo camina (el módulo ya está abierto). */
  irAModulo(panel: string, examinar = true): boolean {
    const esc = this.escena;
    if (!esc?.jugador) return false;
    if (panel === "chat" || panel === "supervisor") {
      // Esos dos se hacen hablando con Hugo, en el mostrador de la tienda.
      const h = esc.figuras.get("hugo");
      if (!h) return false;
      const lado = esc.puntoParaHablar(h);
      esc.llevarJugador(lado.x, lado.y, lado.dir, () => { esc.mirarse(h); if (examinar) this.op.onExaminar({ tipo: "hugo" }); });
      return true;
    }
    const e = esc.estacionDe(objetoDe(panel), esc.jugador);
    if (!e) return false;
    esc.irAEstacion(e, examinar);
    return true;
  }

  /** Los trofeos de cada cuarto (medallas en orden) en la repisa al lado de su cama. */
  trofeos(porCuarto: Record<string, string[]>) {
    this.escena?.trofeos(porCuarto);
  }

  /** El vecindario: terrenos, casas y lo que hay en cada una (casas.ts). */
  vecindario(v: EstadoVecindario, nombres: Record<number, string>) {
    this.escena?.casasV.sincronizar(v, nombres);
  }

  /** La repisa de trofeos de su casa (`casa_<lote>`), si la puso. */
  repisaDe(usuario: number): string | null {
    return this.escena?.casasV?.repisaDe(usuario) ?? null;
  }

  /** Caminar hasta el letrero de un terreno (y mirarlo al llegar). */
  irALote(id: string, examinar = true): boolean {
    return this.escena?.irALote(id, examinar) ?? false;
  }

  lote(id: string): LoteMapa | null {
    return this.escena?.casasV.lote(id) ?? null;
  }

  /** Decorar mi casa: ver Decorar (escena.ts). null = salir. */
  modoDecorar(d: Decorar | null) {
    this.escena?.modoDecorar(d);
  }

  /** A la cancha de tenis, al lado de tu equipo. */
  irATenis(equipo: "A" | "B", i = 0): boolean {
    return this.escena?.irATenis(equipo, i) ?? false;
  }

  /** Caminar hasta la repisa de trofeos de un cuarto. */
  irATrofeos(cuarto: string): boolean {
    return this.escena?.irATrofeos(cuarto) ?? false;
  }

  /** A la mesa de ajedrez del parque: lado 0 = banco de la izquierda, 1 = el de la derecha. */
  irAMesaAjedrez(lado: 0 | 1, alLlegar?: () => void): boolean {
    return this.escena?.irAMesaAjedrez(lado, alLlegar) ?? false;
  }

  /** Lo que dice mapa.json de un lugar (título, qué se hace, su panel, sus etapas del Mapa). */
  lugar(id: string): LugarMapa | null {
    return this.escena?.mapa.lugares[id] ?? null;
  }

  casa(id: string): { titulo: string } | null {
    return this.escena?.mapa.casas[id] ?? null;
  }

  /** Los cuartos y patios de una casa, en el orden del plano (sin los cuartos de dormir). */
  lugaresDe(casa: string): [string, LugarMapa][] {
    return Object.entries(this.escena?.mapa.lugares ?? {}).filter(([id, l]) => l.casa === casa && !id.startsWith("cuarto"));
  }

  /** El lugar al que pertenece un objeto (los de los pasillos van con su casa). */
  lugarDeEstacion(e: EstacionMapa): string {
    return this.escena?.mapa.lugares[e.lugar] ? e.lugar : "";
  }

  zoom(paso: number) {
    this.escena?.cambiarZoom(paso);
  }

  techos(sin: boolean) {
    if (this.escena) this.escena.sinTechos = sin;
  }

  accion() {
    this.escena?.accion();
  }

  posicion(): { x: number; y: number } | null {
    const j = this.escena?.jugador;
    return j ? { x: j.x, y: j.y } : null;
  }

  destruir() {
    this.destruido = true;
    window.clearInterval(this.reloj);
    this.escena?.destruir();
    this.game?.destroy(true);
    this.game = null;
    this.escena = null;
    this.motor = null;
  }
}
