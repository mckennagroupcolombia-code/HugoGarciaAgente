/**
 * El premio de aprobar: aprobar una ficha técnica o una etiqueta es una tarea de revisión y se
 * juega como una misión — sonido, animación y monedas que quedan en el perfil.
 *
 *  - `grande`: aprobación final (etiqueta guardada, ficha FT+COA+SDS generada). Tarjeta al
 *    centro con la moneda que gira.
 *  - `moneda`: un paso de revisión (marcar revisado, visto bueno de la SDS, combo del taller).
 *    Aviso pequeño abajo a la derecha con la moneda.
 *
 * Desde el 6-oct-2026 toda acción, flujo o formulario completado lo celebra el perro que se ríe
 * de Duck Hunt (`perroSeRie`), en lugar del confeti y la fanfarria/moneda de 8 bits. Desde el
 * 8-oct-2026 el perro se sigue viendo, pero suena el «logro» del lenguaje sonoro (arpegio y
 * acorde, lib/lenguajeSonoro.ts) y no la risa del juego: así cerrar algo suena igual en toda la app.
 *
 * Cuánto paga cada misión lo decide el servidor (`app/services/logros_usuario.py`): aquí solo
 * se dice cuál se cumplió y sobre qué referencia. La misma referencia paga una vez al día.
 * Las demás acciones del equipo (resolver tareas, responder clientes, empacar, conciliar…) las
 * paga el árbitro del servidor (`logros_hook.py`), que avisa en la cabecera `X-Mck-Monedas`:
 * `escucharMonedasDelServidor` la lee en cada respuesta y muestra la moneda.
 * Se monta sola sobre `document.body` (no depende del panel abierto: la ficha puede volver al
 * taller justo al aprobar). El silencio es el mismo interruptor 🔊 del taller.
 */
import { sonarLogro, sonarMoneda } from "../components/combos/sonidoMoneda";
import spritePerro from "../assets/duckhunt/laughing_dog.png";

type Tipo = "grande" | "moneda";

/** Claves de `MISIONES` en el servidor. */
export type MisionAprobacion =
  | "revision_marcada"
  | "sds_visto_bueno"
  | "etiqueta_lote"
  | "etiqueta_aprobada"
  | "combo_completo"
  | "ficha_aprobada";

export interface LogroNuevo {
  clave: string;
  nombre: string;
  descripcion: string;
  icono: string;
}

export interface PagoMision {
  titulo?: string;
  pagada: boolean;
  monedas: number;
  total: number;
  hoy: number;
  nivel: { numero: number; nombre: string };
  logros_nuevos: LogroNuevo[];
}

const CSS = `
.mck-apr-capa { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; overflow: hidden; }
.mck-apr-tarjeta { position: absolute; left: 50%; top: 38%; transform: translate(-50%, -50%); pointer-events: auto; cursor: pointer;
  min-width: 260px; max-width: min(420px, calc(100vw - 32px)); padding: 22px 28px 18px; border-radius: 18px; text-align: center;
  background: rgb(var(--mck-surface-panel, 255 255 255) / 0.97); color: rgb(var(--mck-ink, 17 17 17));
  border: 3px solid #facc15; box-shadow: 0 0 0 6px rgb(250 204 21 / 0.25), 0 24px 60px rgb(0 0 0 / 0.35);
  animation: mck-apr-entra 520ms cubic-bezier(.2,1.6,.4,1) both; }
.mck-apr-fuera { animation: mck-apr-sale 380ms ease-in forwards !important; }
.mck-apr-moneda { display: inline-block; font-size: 46px; line-height: 1; animation: mck-apr-gira 700ms linear 3, mck-apr-salta 700ms ease-out; }
.mck-apr-titulo { margin-top: 8px; font: 900 22px/1.1 ui-monospace, "Courier New", monospace; letter-spacing: .06em; text-transform: uppercase;
  color: #d97706; text-shadow: 2px 2px 0 rgb(0 0 0 / 0.18); }
.mck-apr-detalle { margin-top: 6px; font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.mck-apr-puntos { margin-top: 10px; font: 700 12px ui-monospace, monospace; color: #059669; min-height: 1.3em; }
.mck-apr-paga { display: inline-block; margin-top: 8px; padding: 3px 12px; border-radius: 999px; background: #facc15; color: #422006;
  font: 900 17px ui-monospace, monospace; animation: mck-apr-salta 600ms ease-out; }
.mck-apr-logro { margin-top: 10px; padding: 8px 10px; border-radius: 10px; background: rgb(124 58 237 / 0.12); color: #7c3aed;
  font-size: 13px; font-weight: 800; animation: mck-apr-toast 480ms cubic-bezier(.2,1.6,.4,1) both; }
.mck-apr-toast { position: absolute; right: 20px; bottom: 24px; display: flex; align-items: center; gap: 10px; pointer-events: auto; cursor: pointer;
  max-width: calc(100vw - 40px); padding: 10px 16px; border-radius: 14px; background: rgb(var(--mck-surface-panel, 255 255 255) / 0.97);
  color: rgb(var(--mck-ink, 17 17 17)); border: 2px solid #facc15; box-shadow: 0 12px 30px rgb(0 0 0 / 0.25); font-size: 13px; font-weight: 700;
  animation: mck-apr-toast 420ms cubic-bezier(.2,1.6,.4,1) both; }
.mck-apr-toast .mck-apr-moneda { font-size: 26px; }
.mck-apr-toast .mck-apr-puntos, .mck-apr-toast .mck-apr-detalle { margin-top: 2px; }
@keyframes mck-apr-entra { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.3); } 100% { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
@keyframes mck-apr-toast { 0% { opacity: 0; transform: translateY(40px) scale(.6); } 100% { opacity: 1; transform: none; } }
@keyframes mck-apr-sale { to { opacity: 0; } }
@keyframes mck-apr-gira { 0% { transform: rotateY(0); } 100% { transform: rotateY(360deg); } }
@keyframes mck-apr-salta { 0% { translate: 0 0; } 35% { translate: 0 -14px; } 100% { translate: 0 0; } }
@media (prefers-reduced-motion: reduce) {
  .mck-apr-tarjeta, .mck-apr-toast, .mck-apr-logro { animation: none; }
  .mck-apr-moneda, .mck-apr-paga { animation: none; }
}`;

function el(tag: string, clase: string, texto?: string) {
  const e = document.createElement(tag);
  e.className = clase;
  if (texto) e.textContent = texto;
  return e;
}

/** Cobra la misión en el perfil del usuario. `null` si no hay sesión o falla la red. */
export async function registrarMision(mision: MisionAprobacion, ref = "", detalle = ""): Promise<PagoMision | null> {
  try {
    const { api } = await import("../api/client");
    return await api.post<PagoMision>("/api/tickets/auth/logros", { mision, ref, detalle });
  } catch {
    return null;
  }
}

// Una capa por tipo: la moneda de una acción del servidor no borra la tarjeta de una aprobación.
const capas: Partial<Record<Tipo, HTMLElement>> = {};

export function celebrarAprobacion(opc: {
  titulo: string;
  detalle?: string;
  tipo?: Tipo;
  /** Misión que se cobra en el perfil; sin ella solo se celebra. */
  mision?: MisionAprobacion;
  /** Referencia de lo aprobado (nombre de la etiqueta, ref del producto…). */
  ref?: string;
  /** false si el perro ya salió por esta misma acción (no se ríe dos veces). */
  sonido?: boolean;
  /** Pago ya hecho por el servidor: solo se muestra, no se cobra otra vez. */
  pago?: PagoMision;
}) {
  if (typeof document === "undefined") return;
  const tipo = opc.tipo ?? "grande";
  if (opc.sonido !== false) perroSeRie();

  if (!document.getElementById("mck-apr-estilo")) {
    const s = document.createElement("style");
    s.id = "mck-apr-estilo";
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  capas[tipo]?.remove();
  const capa = el("div", "mck-apr-capa");
  capa.setAttribute("role", "status");
  capa.setAttribute("aria-live", "polite");
  capas[tipo] = capa;

  let vence = 0;
  const cerrar = () => {
    capa.remove();
    if (capas[tipo] === capa) delete capas[tipo];
  };
  const programarCierre = (ms: number) => {
    window.clearTimeout(vence);
    vence = window.setTimeout(() => {
      caja.classList.add("mck-apr-fuera");
      window.setTimeout(cerrar, 400);
    }, ms);
  };

  const puntos = el("div", "mck-apr-puntos", opc.mision && !opc.pago ? "cobrando…" : "");
  let caja: HTMLElement;
  if (tipo === "grande") {
    const barbie = document.documentElement.dataset.mckSkin === "barbie";
    caja = el("div", "mck-apr-tarjeta");
    caja.appendChild(el("div", "mck-apr-moneda", barbie ? "💖" : "🪙"));
    caja.appendChild(el("div", "mck-apr-titulo", opc.titulo));
    if (opc.detalle) caja.appendChild(el("div", "mck-apr-detalle", opc.detalle));
    caja.appendChild(puntos);
  } else {
    caja = el("div", "mck-apr-toast");
    caja.appendChild(el("span", "mck-apr-moneda", "🪙"));
    const txt = el("span", "");
    txt.appendChild(el("div", "", opc.titulo));
    if (opc.detalle) txt.appendChild(el("div", "mck-apr-detalle", opc.detalle));
    txt.appendChild(puntos);
    caja.appendChild(txt);
  }
  caja.title = "Toca para cerrar";
  caja.addEventListener("click", cerrar);
  capa.appendChild(caja);
  document.body.appendChild(capa);
  programarCierre(tipo === "grande" ? 3200 : 2300);

  const mostrarPago = (pago: PagoMision | null) => {
    if (capas[tipo] !== capa) return;
    if (!pago) {
      puntos.textContent = "";
      return;
    }
    puntos.textContent = "";
    if (pago.pagada) {
      const paga = el("span", "mck-apr-paga", `+${pago.monedas} 🪙`);
      if (tipo === "grande") {
        puntos.appendChild(paga);
        puntos.appendChild(el("div", "", `${pago.total.toLocaleString("es-CO")} monedas · nivel ${pago.nivel.numero} ${pago.nivel.nombre} · ${pago.hoy} hoy`));
      } else {
        puntos.textContent = `+${pago.monedas} 🪙 · ${pago.total.toLocaleString("es-CO")} en total`;
      }
    } else {
      puntos.textContent = "ya cobrada hoy · sin monedas nuevas";
    }
    for (const l of pago.logros_nuevos) {
      const d = el("div", "mck-apr-logro", `${l.icono} ¡Logro desbloqueado! ${l.nombre}`);
      d.title = l.descripcion;
      (tipo === "grande" ? caja : caja.lastElementChild ?? caja).appendChild(d);
    }
    if (pago.logros_nuevos.length) programarCierre(4500);
    window.dispatchEvent(new CustomEvent("mck-logros-cambio"));
  };
  if (opc.pago) mostrarPago(opc.pago);
  else if (opc.mision) void registrarMision(opc.mision, opc.ref ?? opc.detalle ?? "", opc.detalle ?? "").then(mostrarPago);
}

/**
 * Escucha los pagos del árbitro del servidor en TODAS las respuestas (el cliente de la API y los
 * `fetch` sueltos de cada panel) y muestra la moneda. Se instala una sola vez al arrancar.
 */
export function escucharMonedasDelServidor() {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __mckMonedas?: boolean };
  if (w.__mckMonedas) return;
  w.__mckMonedas = true;
  const original = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const res = await original(...args);
    try {
      // La tarea cumplida la celebra el perro con su risa: la moneda que la acompaña va callada.
      const tarea = res.ok ? tareaCumplidaEn(args[0], args[1]) : null;
      const celebrada = tarea != null && celebrarTareaCumplida(tarea);
      const h = res.headers.get("X-Mck-Monedas");
      if (h) {
        const pago = JSON.parse(decodeURIComponent(h)) as PagoMision;
        if (pago.pagada) {
          // El perro es solo para cerrar un flujo (7-oct-2026): escribir un mensaje, subir una
          // evidencia o marcar un paso paga su moneda con un tono corto, no con la risa.
          celebrarAprobacion({ tipo: "moneda", titulo: pago.titulo || "¡Misión cumplida!", pago, sonido: false });
          if (!celebrada) {
            if (res.ok && cierraUnFlujo(args[0], args[1])) perroSeRie();
            else sonarMoneda();
          }
        }
      }
    } catch {
      /* cabecera ilegible: la moneda ya quedó en el perfil */
    }
    return res;
  };
}

/** Acciones que terminan un flujo (además de cerrar una tarea): ahí sí sale el perro. */
const RUTAS_DE_CIERRE = [
  /\/finalizar\/?$/,                                   // corrida, misión o lote de producción
  /^\/api\/facturacion\/(ventas-unificadas\/facturar-ahora|facturar-directo)\/?$/,
  /^\/api\/pedidos\/web\/facturar\/?$/,
];

function cierraUnFlujo(entrada: RequestInfo | URL, init?: RequestInit): boolean {
  if (typeof entrada !== "string" && !(entrada instanceof URL)) return false;
  if ((init?.method ?? "GET").toUpperCase() !== "POST") return false;
  const ruta = new URL(String(entrada), window.location.href).pathname;
  return RUTAS_DE_CIERRE.some((r) => r.test(ruta));
}

/**
 * ¿Esta petición cumplió una tarea? Marcarla lista (`PUT /api/tickets/<id>/estado` con
 * `resuelto`) o completar una acción (`POST /api/tickets/<id>/completar-accion`), venga del
 * panel de tareas, de una misión, de la Agenda o de la app de colaboradores. Devuelve el id.
 */
function tareaCumplidaEn(entrada: RequestInfo | URL, init?: RequestInit): number | null {
  if (typeof entrada !== "string" && !(entrada instanceof URL)) return null;
  const ruta = new URL(String(entrada), window.location.href).pathname;
  const metodo = (init?.method ?? "GET").toUpperCase();
  let m = /^\/api\/tickets\/(\d+)\/completar-accion\/?$/.exec(ruta);
  if (m && metodo === "POST") return Number(m[1]);
  m = /^\/api\/tickets\/(\d+)\/estado\/?$/.exec(ruta);
  if (!m || metodo !== "PUT" || typeof init?.body !== "string") return null;
  try {
    return (JSON.parse(init.body) as { estado?: string }).estado === "resuelto" ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

// Tareas ya celebradas hoy: reabrir y volver a cerrar la misma tarea no repite el efecto.
const CLAVE_CELEBRADAS = "mck-tareas-celebradas";
const celebradasEnMemoria = new Set<string>();

function yaCelebradaHoy(id: number): boolean {
  const dia = new Date().toLocaleDateString("sv");
  const clave = `${dia}:${id}`;
  if (celebradasEnMemoria.has(clave)) return true;
  celebradasEnMemoria.add(clave);
  try {
    const previo = JSON.parse(localStorage.getItem(CLAVE_CELEBRADAS) || "{}") as { dia?: string; ids?: number[] };
    const ids = previo.dia === dia ? previo.ids ?? [] : [];
    if (ids.includes(id)) return true;
    localStorage.setItem(CLAVE_CELEBRADAS, JSON.stringify({ dia, ids: [...ids, id].slice(-300) }));
  } catch {
    /* sin almacenamiento: basta la memoria de esta pestaña */
  }
  return false;
}

/**
 * El perro que se ríe de Duck Hunt (4-oct-2026): el sprite es el MISMO archivo del
 * juego interno de /app → Agenda → Juegos (`public/juegos/duckhunt`, copiados a
 * `assets/duckhunt/`; ver su LEEME: son de Nintendo, solo uso interno detrás de la sesión).
 * Se anima como en el juego (`src/Dog.js` → `makeDogLaugh`): dos cuadros de 112×78 a 10 fps,
 * sube a 80 px/s hasta asomar entero, espera 500 ms y baja igual; aquí a escala ×2.
 */
const ESCALA = 2;
const CUADRO_W = 112 * ESCALA;
const CUADRO_H = 78 * ESCALA;
// 78 px a 80 px/s, ida y vuelta, más la pausa de 500 ms arriba.
const SUBE_MS = Math.round((78 / 80) * 1000);
const QUIETO_MS = 500;
const TOTAL_MS = SUBE_MS * 2 + QUIETO_MS;

const CSS_TAREA = `
.mck-perro-capa { position: fixed; left: 50%; bottom: 0; z-index: 2147482999; width: ${CUADRO_W}px; height: ${CUADRO_H}px;
  margin-left: -${CUADRO_W / 2}px; pointer-events: none; overflow: hidden; }
.mck-perro { width: ${CUADRO_W}px; height: ${CUADRO_H}px; background-size: ${CUADRO_W * 2}px ${CUADRO_H}px;
  background-repeat: no-repeat; image-rendering: pixelated; transform: translateY(100%);
  animation: mck-perro-risa 200ms steps(2) infinite, mck-perro-asoma ${TOTAL_MS}ms linear forwards; }
@keyframes mck-perro-risa { from { background-position: 0 0; } to { background-position: -${CUADRO_W * 2}px 0; } }
@keyframes mck-perro-asoma { 0% { transform: translateY(100%); } ${((SUBE_MS / TOTAL_MS) * 100).toFixed(2)}% { transform: translateY(0); }
  ${(((SUBE_MS + QUIETO_MS) / TOTAL_MS) * 100).toFixed(2)}% { transform: translateY(0); } 100% { transform: translateY(100%); } }
@media (prefers-reduced-motion: reduce) { .mck-perro { animation: none; transform: none; } }`;

/** Una tarea cumplida: el perro, una sola vez por tarea y por día. Devuelve si celebró. */
export function celebrarTareaCumplida(id: number): boolean {
  if (typeof document === "undefined" || yaCelebradaHoy(id)) return false;
  perroSeRie();
  return true;
}

/**
 * El efecto de completar algo: el perro de Duck Hunt asoma abajo al centro y se ríe, con el sonido
 * de «logro» (callado con el mismo interruptor 🔊 del taller; el perro igual se ve). Si ya está
 * afuera, vuelve a empezar en vez de apilarse.
 */
export function perroSeRie() {
  if (typeof document === "undefined") return;
  if (!document.getElementById("mck-tarea-estilo")) {
    const s = document.createElement("style");
    s.id = "mck-tarea-estilo";
    s.textContent = CSS_TAREA;
    document.head.appendChild(s);
  }
  document.querySelector(".mck-perro-capa")?.remove();
  const capa = el("div", "mck-perro-capa");
  capa.setAttribute("aria-hidden", "true");
  const perro = el("div", "mck-perro");
  perro.style.backgroundImage = `url("${spritePerro}")`;
  capa.appendChild(perro);
  document.body.appendChild(capa);
  window.setTimeout(() => capa.remove(), TOTAL_MS + 100);
  sonarLogro();
}
