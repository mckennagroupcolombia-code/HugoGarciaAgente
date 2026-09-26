/**
 * El premio de aprobar: aprobar una ficha técnica o una etiqueta es una tarea de revisión y se
 * juega como una misión — sonido de 8 bits, animación y monedas que quedan en el perfil.
 *
 *  - `grande`: aprobación final (etiqueta guardada, ficha FT+COA+SDS generada). Tarjeta al
 *    centro con la moneda que gira, confeti (estrellas en el tema Barbie) y la fanfarria.
 *  - `moneda`: un paso de revisión (marcar revisado, visto bueno de la SDS, combo del taller).
 *    Aviso pequeño abajo a la derecha con la moneda.
 *
 * Cuánto paga cada misión lo decide el servidor (`app/services/logros_usuario.py`): aquí solo
 * se dice cuál se cumplió y sobre qué referencia. La misma referencia paga una vez al día.
 * Las demás acciones del equipo (resolver tareas, responder clientes, empacar, conciliar…) las
 * paga el árbitro del servidor (`logros_hook.py`), que avisa en la cabecera `X-Mck-Monedas`:
 * `escucharMonedasDelServidor` la lee en cada respuesta y muestra la moneda.
 * Se monta sola sobre `document.body` (no depende del panel abierto: la ficha puede volver al
 * taller justo al aprobar). El silencio es el mismo interruptor 🔊 del taller.
 */
import { sonarAprobado, sonarRevisado } from "../components/combos/sonidoMoneda";

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

const COLORES = ["#0891b2", "#059669", "#d97706", "#7c3aed", "#e11d48", "#facc15"];
const COLORES_BARBIE = ["#f6c945", "#ffd76a", "#ff4fa3", "#ffe9a8", "#e0a820"];

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
.mck-apr-confeti { position: absolute; top: -14px; width: 8px; height: 13px; border-radius: 2px; animation: mck-apr-cae 2.6s ease-in forwards; }
.mck-apr-estrella { position: absolute; top: -20px; line-height: 1; text-shadow: 0 0 6px currentColor; animation: mck-apr-cae 2.8s ease-in forwards; }
@keyframes mck-apr-entra { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.3); } 100% { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
@keyframes mck-apr-toast { 0% { opacity: 0; transform: translateY(40px) scale(.6); } 100% { opacity: 1; transform: none; } }
@keyframes mck-apr-sale { to { opacity: 0; } }
@keyframes mck-apr-gira { 0% { transform: rotateY(0); } 100% { transform: rotateY(360deg); } }
@keyframes mck-apr-salta { 0% { translate: 0 0; } 35% { translate: 0 -14px; } 100% { translate: 0 0; } }
@keyframes mck-apr-cae { 0% { transform: translateY(0) rotate(0); opacity: 1; } 100% { transform: translateY(105vh) rotate(600deg); opacity: .2; } }
@media (prefers-reduced-motion: reduce) {
  .mck-apr-tarjeta, .mck-apr-toast, .mck-apr-logro { animation: none; }
  .mck-apr-moneda, .mck-apr-paga { animation: none; }
  .mck-apr-confeti, .mck-apr-estrella { display: none; }
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
  /** false si quien llama ya tiene su propio sonido (el taller de combos). */
  sonido?: boolean;
  /** Pago ya hecho por el servidor: solo se muestra, no se cobra otra vez. */
  pago?: PagoMision;
}) {
  if (typeof document === "undefined") return;
  const tipo = opc.tipo ?? "grande";
  if (opc.sonido !== false) {
    if (tipo === "grande") sonarAprobado();
    else sonarRevisado();
  }

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
    for (let i = 0; i < 40; i++) {
      const izq = `${(i * 37 + 5) % 100}%`;
      const retardo = `${(i % 10) * 80}ms`;
      if (barbie) {
        const p = el("span", "mck-apr-estrella", i % 3 ? "✦" : "★");
        Object.assign(p.style, { left: izq, animationDelay: retardo, fontSize: `${12 + (i % 4) * 6}px`, color: COLORES_BARBIE[i % 5] });
        capa.appendChild(p);
      } else {
        const p = el("span", "mck-apr-confeti");
        Object.assign(p.style, { left: izq, animationDelay: retardo, background: COLORES[i % COLORES.length] });
        capa.appendChild(p);
      }
    }
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
    if (pago.logros_nuevos.length) {
      sonarAprobado();
      programarCierre(4500);
    }
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
      // La tarea cumplida lleva su propio efecto con sonido: la moneda que la acompaña va callada.
      const tarea = res.ok ? tareaCumplidaEn(args[0], args[1]) : null;
      const celebrada = tarea != null && celebrarTareaCumplida(tarea);
      const h = res.headers.get("X-Mck-Monedas");
      if (h) {
        const pago = JSON.parse(decodeURIComponent(h)) as PagoMision;
        if (pago.pagada) celebrarAprobacion({ tipo: "moneda", titulo: pago.titulo || "¡Misión cumplida!", pago, sonido: !celebrada });
      }
    } catch {
      /* cabecera ilegible: la moneda ya quedó en el perfil */
    }
    return res;
  };
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

const CSS_TAREA = `
.mck-tarea-capa { position: fixed; inset: 0; z-index: 2147482999; pointer-events: none; overflow: hidden; }
.mck-tarea-estrella { display: block; clip-path: polygon(50% 0, 61% 39%, 100% 50%, 61% 61%, 50% 100%, 39% 61%, 0 50%, 39% 39%);
  background: radial-gradient(circle, #fffaf0 0%, #ffe28a 35%, #f2b938 70%, #c98a12 100%); }
.mck-tarea-estrella.rosa { background: radial-gradient(circle, #fff 0%, #ffc2df 45%, #ff4fa3 100%); }
.mck-tarea-brillo { position: absolute; top: -40px; animation: mck-tarea-cae var(--dur, 2.8s) cubic-bezier(.3,.1,.6,1) var(--ret, 0ms) forwards;
  filter: drop-shadow(0 0 6px rgb(255 205 80 / .95)) drop-shadow(0 0 14px rgb(255 190 60 / .6)); }
.mck-tarea-estallido { position: absolute; left: 50%; top: 42%; }
.mck-tarea-estallido .mck-tarea-brillo { top: 0; left: 0; animation: mck-tarea-sale 1.3s cubic-bezier(.15,.8,.3,1) var(--ret, 0ms) forwards; }
.mck-tarea-destello { position: absolute; left: 50%; top: 42%; width: 360px; height: 360px; margin: -180px 0 0 -180px; border-radius: 50%;
  background: radial-gradient(circle, rgb(255 236 170 / .75) 0%, rgb(246 201 69 / .3) 35%, transparent 70%);
  animation: mck-tarea-destello 1.1s ease-out forwards; }
@keyframes mck-tarea-cae { 0% { transform: translate(0, 0) rotate(0) scale(.6); opacity: 0; } 8% { opacity: 1; }
  100% { transform: translate(var(--dx, 0px), 110vh) rotate(var(--giro, 360deg)) scale(1); opacity: .15; } }
@keyframes mck-tarea-sale { 0% { transform: translate(0, 0) scale(.2) rotate(0); opacity: 1; }
  70% { opacity: 1; } 100% { transform: translate(var(--x), var(--y)) scale(1) rotate(var(--giro, 180deg)); opacity: 0; } }
@keyframes mck-tarea-destello { 0% { transform: scale(.2); opacity: 0; } 25% { opacity: 1; } 100% { transform: scale(1.6); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .mck-tarea-capa { display: none; } }`;

function estrella(tam: number, rosa: boolean): HTMLElement {
  const brillo = el("span", "mck-tarea-brillo");
  const e = el("span", rosa ? "mck-tarea-estrella rosa" : "mck-tarea-estrella");
  Object.assign(e.style, { width: `${tam}px`, height: `${tam}px` });
  brillo.appendChild(e);
  return brillo;
}

/**
 * El efecto de cumplir una tarea: una lluvia de estrellas doradas con un estallido al centro
 * (en el tema Barbie Agenda, casi todas de oro con algún destello rosa; en los demás temas, oro
 * y confeti). Una sola vez por tarea y por día, y con una sola fanfarria. Devuelve si celebró.
 */
export function celebrarTareaCumplida(id: number): boolean {
  if (typeof document === "undefined" || yaCelebradaHoy(id)) return false;
  sonarAprobado();
  if (!document.getElementById("mck-tarea-estilo")) {
    const s = document.createElement("style");
    s.id = "mck-tarea-estilo";
    s.textContent = CSS_TAREA;
    document.head.appendChild(s);
  }
  const barbie = document.documentElement.dataset.mckSkin === "barbie";
  const capa = el("div", "mck-tarea-capa");
  capa.setAttribute("aria-hidden", "true");
  capa.appendChild(el("div", "mck-tarea-destello"));

  const lluvia = barbie ? 90 : 50;
  for (let i = 0; i < lluvia; i++) {
    const rosa = barbie && i % 7 === 3;
    const p = estrella(16 + ((i * 7) % 5) * 7, rosa);
    Object.assign(p.style, { left: `${(i * 37 + 3) % 100}%` });
    p.style.setProperty("--ret", `${(i % 15) * 70}ms`);
    p.style.setProperty("--dur", `${2.3 + ((i * 13) % 10) / 8}s`);
    p.style.setProperty("--dx", `${((i * 29) % 80) - 40}px`);
    p.style.setProperty("--giro", `${i % 2 ? 420 : -360}deg`);
    capa.appendChild(p);
    if (!barbie && i % 2) {
      const c = el("span", "mck-apr-confeti");
      Object.assign(c.style, { left: `${(i * 53 + 11) % 100}%`, animationDelay: `${(i % 10) * 90}ms`, background: COLORES[i % COLORES.length] });
      capa.appendChild(c);
    }
  }

  const estallido = el("div", "mck-tarea-estallido");
  const rayos = barbie ? 24 : 16;
  for (let i = 0; i < rayos; i++) {
    const ang = (i / rayos) * Math.PI * 2;
    const dist = 140 + (i % 3) * 60;
    const p = estrella(22 + (i % 3) * 10, barbie && i % 6 === 5);
    p.style.setProperty("--x", `${Math.cos(ang) * dist}px`);
    p.style.setProperty("--y", `${Math.sin(ang) * dist}px`);
    p.style.setProperty("--ret", `${(i % 4) * 40}ms`);
    estallido.appendChild(p);
  }
  capa.appendChild(estallido);

  if (!document.getElementById("mck-apr-estilo")) {
    // El confeti de los demás temas usa las clases de la celebración de aprobar.
    const s = document.createElement("style");
    s.id = "mck-apr-estilo";
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  document.body.appendChild(capa);
  window.setTimeout(() => capa.remove(), 4800);
  return true;
}
