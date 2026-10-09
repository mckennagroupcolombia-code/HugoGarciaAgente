/**
 * Tenis en equipo en Empresa viva: el minijuego de la cancha del parque. Alguien arma el partido,
 * los demás se unen al equipo A (izquierda de la red) o al B (derecha), hasta 3 por lado, y se juega
 * en tiempo real; gana el equipo que se lleve 2 juegos (15, 30, 40, iguales, ventaja). Cada quien
 * del equipo ganador recibe un trofeo de tenis en su repisa.
 *
 * Red: cada jugador manda su raqueta ~10 veces por segundo (`/estado`) y recibe la de los demás. El
 * **anfitrión** (quien armó el partido, o el siguiente si se va) simula la pelota aquí, en su
 * navegador, con las raquetas que le llegan, y la manda con cada envío; también anota los puntos
 * (con `punto_seq`, para que un reenvío no cuente dos veces). Los demás dibujan la pelota que les
 * llega, adelantada con su velocidad. El servidor (app/services/empresa_viva_tenis.py) solo reparte.
 *
 * Coordenadas de 0 a 1 en x (de izquierda a derecha) y en y (de arriba abajo); la cancha mide 2 × 1.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { tocarSonido } from "../../lib/sonidosJuego";

export type Equipo = "A" | "B";
export interface PartidoTenis {
  id: number; creador: number; host: number; estado: "sala" | "jugando" | "terminada" | "cerrada";
  equipos: Record<Equipo, number[]>; puntos: Record<Equipo, number>; juegos: Record<Equipo, number>;
  saca: Equipo; ganador: Equipo | null; motivo: string;
  pelota: { x: number; y: number; vx: number; vy: number; t: number; quieta?: boolean } | null;
  punto_seq: number; raquetas: Record<string, { x: number; y: number; t: number }>; activos: number[];
  juegos_para_ganar: number; max_por_equipo: number; creada: number; actualizada: number; ahora: number;
}
export interface ListaTenis { partidos: PartidoTenis[]; ahora: number }

export const equipoDe = (p: PartidoTenis, uid: number): Equipo | null =>
  p.equipos.A.includes(uid) ? "A" : p.equipos.B.includes(uid) ? "B" : null;

const COLOR: Record<Equipo, string> = { A: "#29ADFF", B: "#FF77A8" };
const ALTO_RAQ = 0.17;       // alto de la raqueta (en y)
const R_PELOTA = 0.011;      // radio de la pelota (en x)
const VEL_BASE = 0.5;        // canchas por segundo al sacar
const VEL_MAX = 1.15;
const MEDIA = { A: [0.03, 0.46], B: [0.54, 0.97] } as const;

/** 15, 30, 40, iguales, ventaja. */
export function cantoTenis(a: number, b: number): [string, string] {
  const N = ["0", "15", "30", "40"];
  if (a >= 3 && b >= 3) {
    if (a === b) return ["Iguales", "Iguales"];
    return a > b ? ["Ventaja", "40"] : ["40", "Ventaja"];
  }
  return [N[Math.min(a, 3)], N[Math.min(b, 3)]];
}

type Pelota = { x: number; y: number; vx: number; vy: number; quieta: boolean; hasta: number };

export function VentanaTenis({ id, yo, nombreDe, retratoDe, onCerrar, onLado, onVerTrofeo }: {
  id: number;
  yo: number;
  nombreDe: (id: number) => string;
  retratoDe: (id: number) => string | null;
  onCerrar: () => void;
  /** Al unirse a un equipo: el personaje camina a ese lado de la cancha (índice dentro del equipo). */
  onLado?: (equipo: Equipo, i: number) => void;
  onVerTrofeo?: () => void;
}) {
  const [p, setP] = useState<PartidoTenis | null>(null);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const caja = useRef<HTMLDivElement>(null);
  // Lo que cambia 60 veces por segundo vive en refs (no en estado de React).
  const srv = useRef<PartidoTenis | null>(null);
  const reloj = useRef(0);                         // servidor − local (s)
  const mia = useRef({ x: 0.15, y: 0.5 });
  const teclas = useRef(new Set<string>());
  const dedo = useRef<{ x: number; y: number } | null>(null);
  const pelota = useRef<Pelota | null>(null);
  const puntoPend = useRef<{ equipo: Equipo; seq: number } | null>(null);
  const vistas = useRef(new Map<number, { x: number; y: number }>());   // raquetas ajenas, suavizadas
  const ultimoVx = useRef(0);                      // quien mira oye el golpe cuando la pelota cambia de lado

  const equipo = p ? equipoDe(p, yo) : null;
  const soyHost = Boolean(p && equipo && p.host === yo);

  const aplicar = useCallback((nuevo: PartidoTenis) => {
    const antes = srv.current;
    srv.current = nuevo;
    reloj.current = nuevo.ahora - Date.now() / 1000;
    if (antes && nuevo.punto_seq > antes.punto_seq && nuevo.estado !== "terminada") tocarSonido("blip");
    if (antes && antes.estado !== "terminada" && nuevo.estado === "terminada") {
      const gane = nuevo.ganador && equipoDe(nuevo, yo) === nuevo.ganador;
      tocarSonido(gane ? "logro" : "volver");
    }
    if (antes && antes.estado === "sala" && nuevo.estado === "jugando") tocarSonido("reto");
    if (puntoPend.current && nuevo.punto_seq >= puntoPend.current.seq) puntoPend.current = null;
    // Solo lo que se muestra en React (marcador, equipos, estado): no 10 renders por segundo.
    setP((viejo) => (viejo && viejo.estado === nuevo.estado && viejo.punto_seq === nuevo.punto_seq && viejo.host === nuevo.host
      && JSON.stringify(viejo.equipos) === JSON.stringify(nuevo.equipos) && viejo.activos.join() === nuevo.activos.join() ? viejo : nuevo));
  }, [yo]);

  // ── Red: cada 100 ms jugando (cada 800 ms en la sala), como jugador o como quien mira
  useEffect(() => {
    let vivo = true, t = 0;
    const ciclo = async () => {
      const s = srv.current;
      const juego = s?.estado === "jugando";
      const soy = s ? equipoDe(s, yo) : null;
      try {
        let r: PartidoTenis;
        if (soy && s?.estado !== "terminada") {
          const cuerpo: Record<string, unknown> = { raqueta: { x: mia.current.x, y: mia.current.y } };
          if (juego && s?.host === yo && pelota.current) {
            const b = pelota.current;
            cuerpo.pelota = { x: b.x, y: b.y, vx: b.vx, vy: b.vy, quieta: b.quieta };
          }
          if (juego && s?.host === yo && puntoPend.current) {
            cuerpo.punto = puntoPend.current.equipo;
            cuerpo.punto_seq = puntoPend.current.seq;
          }
          r = await api.post<PartidoTenis>(`/api/empresa-viva/tenis/${id}/estado`, cuerpo);
        } else {
          r = await api.get<PartidoTenis>(`/api/empresa-viva/tenis/${id}`);
        }
        if (vivo) { aplicar(r); setError(""); }
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : "Sin conexión con la cancha");
      }
      if (vivo) t = window.setTimeout(ciclo, srv.current?.estado === "jugando" ? 100 : 800);
    };
    void ciclo();
    return () => { vivo = false; window.clearTimeout(t); };
  }, [id, yo, aplicar]);

  // Al empezar (o al cambiar de lado), mi raqueta arranca en mi media cancha.
  useEffect(() => {
    if (!equipo) return;
    mia.current = { x: equipo === "A" ? 0.12 : 0.88, y: 0.5 };
  }, [equipo]);

  // ── Teclado y dedo
  useEffect(() => {
    const abajo = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCerrar(); return; }
      if ((e.target as HTMLElement | null)?.tagName === "INPUT") return;
      const k = { ArrowUp: "u", KeyW: "u", ArrowDown: "d", KeyS: "d", ArrowLeft: "l", KeyA: "l", ArrowRight: "r", KeyD: "r" }[e.code];
      if (k && srv.current?.estado === "jugando") { e.preventDefault(); e.stopPropagation(); teclas.current.add(k); }
    };
    const arriba = (e: KeyboardEvent) => {
      const k = { ArrowUp: "u", KeyW: "u", ArrowDown: "d", KeyS: "d", ArrowLeft: "l", KeyA: "l", ArrowRight: "r", KeyD: "r" }[e.code];
      if (k) teclas.current.delete(k);
    };
    const fuera = () => teclas.current.clear();
    window.addEventListener("keydown", abajo, true);
    window.addEventListener("keyup", arriba, true);
    window.addEventListener("blur", fuera);
    return () => { window.removeEventListener("keydown", abajo, true); window.removeEventListener("keyup", arriba, true); window.removeEventListener("blur", fuera); };
  }, [onCerrar]);

  // ── El cuadro: mover mi raqueta, simular la pelota (si soy anfitrión) y dibujar
  useEffect(() => {
    let raf = 0, antes = performance.now();
    const sacar = (s: PartidoTenis, ahora: number): Pelota => {
      const quien = s.saca;
      const r = s.raquetas[String(s.equipos[quien][0])];
      return { x: quien === "A" ? 0.1 : 0.9, y: r?.y ?? 0.5, vx: 0, vy: 0, quieta: true, hasta: ahora + 1200 };
    };
    const raquetasDe = (s: PartidoTenis) => {
      const out: { uid: number; eq: Equipo; x: number; y: number }[] = [];
      for (const eq of ["A", "B"] as Equipo[])
        for (const uid of s.equipos[eq]) {
          if (uid === yo) { out.push({ uid, eq, ...mia.current }); continue; }
          const r = s.raquetas[String(uid)];
          if (!r) continue;
          const v = vistas.current.get(uid) ?? { x: r.x, y: r.y };
          v.x += (r.x - v.x) * 0.35;
          v.y += (r.y - v.y) * 0.35;
          vistas.current.set(uid, v);
          out.push({ uid, eq, x: v.x, y: v.y });
        }
      return out;
    };
    const cuadro = (t: number) => {
      const dt = Math.min(0.05, (t - antes) / 1000);
      antes = t;
      const s = srv.current;
      const eq = s ? equipoDe(s, yo) : null;
      // Mi raqueta (teclado o dedo), dentro de mi media cancha
      if (s?.estado === "jugando" && eq) {
        const m = mia.current, v = 0.75;
        if (dedo.current) {
          m.x += (dedo.current.x - m.x) * Math.min(1, dt * 12);
          m.y += (dedo.current.y - m.y) * Math.min(1, dt * 12);
        } else {
          if (teclas.current.has("u")) m.y -= v * dt;
          if (teclas.current.has("d")) m.y += v * dt;
          if (teclas.current.has("l")) m.x -= v * dt * 0.5;
          if (teclas.current.has("r")) m.x += v * dt * 0.5;
        }
        m.y = Math.min(1 - ALTO_RAQ / 2, Math.max(ALTO_RAQ / 2, m.y));
        m.x = Math.min(MEDIA[eq][1], Math.max(MEDIA[eq][0], m.x));
      }
      const raqs = s ? raquetasDe(s) : [];
      // La pelota
      if (s?.estado === "jugando") {
        if (s.host === yo && eq) {
          let b = pelota.current;
          if (!b) b = pelota.current = sacar(s, t);
          if (b.quieta) {
            const r = raqs.find((x) => x.eq === s.saca);
            if (r) { b.y = r.y; b.x = s.saca === "A" ? Math.min(0.42, r.x + 0.03) : Math.max(0.58, r.x - 0.03); }
            if (t >= b.hasta && !puntoPend.current) {
              b.quieta = false;
              b.vx = (s.saca === "A" ? 1 : -1) * VEL_BASE;
              b.vy = (Math.random() - 0.5) * 0.7;
            }
          } else {
            b.x += b.vx * dt;
            b.y += b.vy * dt * 2;                     // la cancha mide 2 × 1: el mismo paso se ve igual
            if (b.y < R_PELOTA * 2) { b.y = R_PELOTA * 2; b.vy = Math.abs(b.vy); }
            if (b.y > 1 - R_PELOTA * 2) { b.y = 1 - R_PELOTA * 2; b.vy = -Math.abs(b.vy); }
            for (const r of raqs) {
              const haciaMi = r.eq === "A" ? b.vx < 0 : b.vx > 0;
              if (!haciaMi) continue;
              if (Math.abs(b.x - r.x) < R_PELOTA + 0.012 && Math.abs(b.y - r.y) < ALTO_RAQ / 2 + R_PELOTA * 2) {
                const vel = Math.min(VEL_MAX, Math.hypot(b.vx, b.vy) * 1.06 + 0.02);
                const desvio = (b.y - r.y) / (ALTO_RAQ / 2);          // -1 arriba, 1 abajo
                b.vx = (r.eq === "A" ? 1 : -1) * vel * Math.cos(desvio * 0.9);
                b.vy = vel * Math.sin(desvio * 0.9);
                b.x = r.eq === "A" ? r.x + R_PELOTA + 0.013 : r.x - R_PELOTA - 0.013;
                tocarSonido("blip");
                break;
              }
            }
            if ((b.x < -0.02 || b.x > 1.02) && !puntoPend.current) {
              const gana: Equipo = b.x < 0 ? "B" : "A";
              puntoPend.current = { equipo: gana, seq: s.punto_seq + 1 };
              // El saque lo hace quien sacaba en este juego; el servidor dice quién saca al cambiar de juego.
              pelota.current = { ...sacar(s, t), hasta: t + 1500 };
            }
          }
        } else if (s.pelota) {
          // Quien no es anfitrión: la última pelota, adelantada con su velocidad (y su rebote).
          const b = s.pelota;
          const ahoraSrv = Date.now() / 1000 + reloj.current;
          const dtp = b.quieta ? 0 : Math.min(0.3, Math.max(0, ahoraSrv - b.t));
          let y = b.y + b.vy * dtp * 2;
          if (y < 0) y = -y;
          if (y > 1) y = 2 - y;
          pelota.current = { x: b.x + b.vx * dtp, y, vx: b.vx, vy: b.vy, quieta: Boolean(b.quieta), hasta: 0 };
          if (b.vx && Math.sign(b.vx) !== Math.sign(ultimoVx.current) && ultimoVx.current) tocarSonido("blip");
          ultimoVx.current = b.vx;
        }
      } else {
        pelota.current = null;
      }
      dibujar(raqs);
      raf = requestAnimationFrame(cuadro);
    };
    const dibujar = (raqs: { uid: number; eq: Equipo; x: number; y: number }[]) => {
      const cv = lienzo.current;
      if (!cv) return;
      const W = cv.clientWidth, H = cv.clientHeight, k = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(W * k)) { cv.width = Math.round(W * k); cv.height = Math.round(H * k); }
      const c = cv.getContext("2d");
      if (!c) return;
      c.setTransform(k, 0, 0, k, 0, 0);
      c.imageSmoothingEnabled = false;
      c.fillStyle = "#2f7a45"; c.fillRect(0, 0, W, H);
      const m = Math.round(H * 0.05);
      c.fillStyle = "#3f9a58"; c.fillRect(m, m, W - 2 * m, H - 2 * m);
      c.strokeStyle = "#f4f1e8"; c.lineWidth = 2;
      c.strokeRect(m, m, W - 2 * m, H - 2 * m);
      c.beginPath();
      const al = H * 0.12;
      c.moveTo(m, m + al); c.lineTo(W - m, m + al); c.moveTo(m, H - m - al); c.lineTo(W - m, H - m - al);
      c.moveTo(W * 0.27, m + al); c.lineTo(W * 0.27, H - m - al); c.moveTo(W * 0.73, m + al); c.lineTo(W * 0.73, H - m - al);
      c.moveTo(W * 0.27, H / 2); c.lineTo(W * 0.73, H / 2);
      c.stroke();
      // red
      c.fillStyle = "#1f5c35"; c.fillRect(W / 2 + 1, m - 4, 3, H - 2 * m + 8);
      c.fillStyle = "#e6e9f0";
      for (let y = m - 4; y < H - m + 4; y += 6) c.fillRect(W / 2 - 2, y, 3, 4);
      // raquetas
      c.font = `${Math.max(9, Math.round(H * 0.045))}px PixelifyMck, monospace`;
      c.textAlign = "center";
      for (const r of raqs) {
        const x = r.x * W, y = r.y * H, h = ALTO_RAQ * H, w = Math.max(5, W * 0.012);
        c.fillStyle = "rgba(0,0,0,0.25)"; c.fillRect(x - w / 2 + 3, y - h / 2 + 4, w, h);
        c.fillStyle = COLOR[r.eq]; c.fillRect(x - w / 2, y - h / 2, w, h);
        c.lineWidth = r.uid === yo ? 3 : 1.5; c.strokeStyle = r.uid === yo ? "#ffe14d" : "#0b0f2a";
        c.strokeRect(x - w / 2, y - h / 2, w, h);
        c.fillStyle = "#ffffff"; c.strokeStyle = "#0b0f2a"; c.lineWidth = 3;
        const nombre = r.uid === yo ? "Tú" : nombreDe(r.uid);
        c.strokeText(nombre, x, y - h / 2 - 5); c.fillText(nombre, x, y - h / 2 - 5);
      }
      // pelota
      const b = pelota.current;
      if (b) {
        const x = b.x * W, y = b.y * H, rr = Math.max(4, R_PELOTA * W);
        c.fillStyle = "rgba(0,0,0,0.3)"; c.beginPath(); c.ellipse(x + 3, y + 5, rr, rr * 0.6, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#d9f75a"; c.strokeStyle = "#0b0f2a"; c.lineWidth = 1.5;
        c.beginPath(); c.arc(x, y, rr, 0, Math.PI * 2); c.fill(); c.stroke();
      }
    };
    raf = requestAnimationFrame(cuadro);
    return () => cancelAnimationFrame(raf);
  }, [yo, nombreDe]);

  const posDedo = (e: React.PointerEvent) => {
    const r = lienzo.current?.getBoundingClientRect();
    if (!r) return;
    dedo.current = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const accion = useCallback(async (ruta: string, cuerpo: object = {}) => {
    setEnviando(true);
    setError("");
    try {
      const r = await api.post<PartidoTenis>(`/api/empresa-viva/tenis/${id}/${ruta}`, cuerpo);
      aplicar(r);
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo");
      tocarSonido("error");
      return null;
    } finally {
      setEnviando(false);
    }
  }, [id, aplicar]);

  const nombres = (uids: number[]) => uids.map((u) => (u === yo ? "tú" : nombreDe(u))).join(", ") || "nadie todavía";
  const [ca, cb] = p ? cantoTenis(p.puntos.A, p.puntos.B) : ["0", "0"];
  const puedeEmpezar = p && (p.creador === yo || p.host === yo) && p.estado === "sala";

  return (
    <div className="absolute inset-0 z-[36] flex items-center justify-center bg-black/40 p-1.5 sm:p-3">
      <div className="ev-ventana flex h-full w-full max-w-[64rem] flex-col p-2 sm:p-3" role="dialog" aria-label="Tenis en el parque">
        <div className="mb-2 flex shrink-0 items-center gap-2">
          <span className="ev-nombre-dialogo flex-1 truncate text-lg">Tenis en el parque</span>
          <button type="button" className="ev-boton mck-btn-no-fx shrink-0" aria-pressed="true" onClick={onCerrar}
                  title={p?.estado === "jugando" && equipo ? "Si sales, tu equipo se queda sin ti mientras no vuelvas" : "Volver al barrio"}>
            Volver al barrio
          </button>
        </div>
        {!p && <p className="p-6 text-center">{error || "Llegando a la cancha…"}</p>}
        {p && (
          <div ref={caja} className="ev-tenis-area min-h-0 flex-1 overflow-y-auto">
            {/* Marcador */}
            <div className="mb-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded border-2 border-[#8a95d6] bg-[#0b1140]/60 p-2">
              {(["A", "B"] as Equipo[]).map((eq, i) => (
                <div key={eq} className={`min-w-0 ${i === 1 ? "order-3 text-right" : ""}`}>
                  <div className="truncate" style={{ color: COLOR[eq] }}>Equipo {eq}{equipo === eq ? " (el tuyo)" : ""}</div>
                  <div className={`flex gap-1 ${i === 1 ? "justify-end" : ""}`}>
                    {p.equipos[eq].map((u) => {
                      const ret = retratoDe(u);
                      return ret
                        ? <img key={u} src={ret} alt={nombreDe(u)} title={nombreDe(u)} draggable={false}
                               className={`ev-retrato h-8 w-8 rounded border bg-[#0b1140] ${p.activos.includes(u) || p.estado === "sala" ? "border-[#8a95d6]" : "border-[#555] opacity-50"}`} />
                        : <span key={u} className="text-xs">{nombreDe(u)}</span>;
                    })}
                  </div>
                </div>
              ))}
              <div className="order-2 text-center leading-tight">
                <div className="text-xl"><span style={{ color: COLOR.A }}>{ca}</span> · <span style={{ color: COLOR.B }}>{cb}</span></div>
                <div className="text-xs text-[#b9c2ff]">Juegos {p.juegos.A} – {p.juegos.B} · a {p.juegos_para_ganar}</div>
              </div>
            </div>

            {p.estado === "sala" && (
              <div className="space-y-3">
                <p>Armen los equipos: hasta {p.max_por_equipo} por lado. Lo empieza {p.creador === yo ? "quien lo armó (tú)" : nombreDe(p.creador)} cuando haya al menos uno en cada equipo.</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(["A", "B"] as Equipo[]).map((eq) => (
                    <div key={eq} className="rounded border-2 p-2" style={{ borderColor: COLOR[eq] }}>
                      <div className="mb-1" style={{ color: COLOR[eq] }}>Equipo {eq} · {eq === "A" ? "izquierda" : "derecha"} de la red</div>
                      <div className="mb-2 text-sm">{nombres(p.equipos[eq])}</div>
                      {equipo !== eq && (
                        <button type="button" className="ev-boton mck-btn-no-fx" disabled={enviando || p.equipos[eq].length >= p.max_por_equipo}
                                onClick={() => void accion("unirse", { equipo: eq }).then((r) => { if (r) onLado?.(eq, r.equipos[eq].indexOf(yo)); })}>
                          {equipo ? `Pasarme al ${eq}` : `Unirme al ${eq}`}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {puedeEmpezar && (
                    <button type="button" className="ev-boton mck-btn-no-fx" aria-pressed="true"
                            disabled={enviando || !p.equipos.A.length || !p.equipos.B.length} onClick={() => void accion("empezar")}>
                      ¡A jugar!
                    </button>
                  )}
                  {equipo && <button type="button" className="ev-boton mck-btn-no-fx" disabled={enviando} onClick={() => void accion("salir").then((r) => { if (r) onCerrar(); })}>Salir del partido</button>}
                </div>
              </div>
            )}

            {(p.estado === "jugando" || p.estado === "terminada") && (
              <div className="ev-tenis-cancha mx-auto">
                <canvas ref={lienzo} className="block aspect-[2/1] w-full touch-none rounded-sm border-4 border-[#1f5c35]"
                        style={{ imageRendering: "pixelated" }}
                        onPointerDown={(e) => { if (!equipo) return; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); posDedo(e); }}
                        onPointerMove={(e) => { if (dedo.current) posDedo(e); }}
                        onPointerUp={() => { dedo.current = null; }} onPointerCancel={() => { dedo.current = null; }} />
                <p className="mt-1 text-xs text-[#b9c2ff]">
                  {equipo ? "Mueve tu raqueta con las flechas o WASD (o arrastrando el dedo en tu lado de la cancha)." : "Estás mirando el partido."}
                  {p.estado === "jugando" && ` Saca el equipo ${p.saca}.`}
                  {soyHost && p.estado === "jugando" && " Tu navegador lleva la pelota: no cierres esta ventana."}
                </p>
              </div>
            )}

            {p.estado === "terminada" && (
              <div className="mt-2 rounded border-2 border-[#ffe14d] p-2" role="status">
                {p.ganador
                  ? <>¡Ganó el equipo {p.ganador} ({nombres(p.equipos[p.ganador])})! {p.juegos[p.ganador]} – {p.juegos[p.ganador === "A" ? "B" : "A"]}.
                      {equipo === p.ganador && " Te llevas un trofeo de tenis para tu cuarto."}</>
                  : <>Partido sin terminar: {p.motivo}.</>}
                {equipo && equipo === p.ganador && onVerTrofeo && (
                  <button type="button" className="ev-boton mck-btn-no-fx ml-2" aria-pressed="true" onClick={onVerTrofeo}>Ver mi trofeo</button>
                )}
              </div>
            )}
            {error && <p className="mt-1 text-sm text-[#ffb4b4]">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
