/**
 * Ajedrez en Empresa viva: el minijuego de la mesa de piedra del parque. Dos personas del equipo
 * juegan por turnos (cada quien desde su panel) y cualquiera puede mirar.
 *
 * - Las reglas las pone chess.js (BSD-2): de la lista de jugadas del servidor se reconstruye la
 *   partida jugada por jugada; si alguna no vale, la partida se marca rota en vez de adivinar.
 * - El servidor (app/services/empresa_viva_ajedrez.py) guarda las jugadas, revisa el turno y pone
 *   el resultado según el motivo que mande quien hizo la última jugada (jaque mate, ahogado…).
 * - Se mueve con dos toques (la pieza y la casilla): igual con el mouse que en el celular.
 * - Las piezas son pixel art propio (máscaras de 16 × 16 abajo), en el estilo del barrio.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { tocarSonido } from "../../lib/sonidosJuego";

export interface PartidaAjedrez {
  id: number;
  blancas: number;
  negras: number;
  reta: number;
  estado: "invitada" | "jugando" | "terminada" | "rechazada" | "cancelada" | "vencida";
  jugadas: string[];
  turno: "blancas" | "negras";
  resultado: "" | "1-0" | "0-1" | "1/2-1/2";
  motivo: string;
  tablas_ofrece: number | null;
  creada: number;
  actualizada: number;
}
/** Un trofeo: quien gana una partida se lo lleva a la repisa al lado de su cama (oro = jaque mate,
 *  plata = el rival se rindió). */
export interface TrofeoAjedrez {
  id: number; usuario: number; juego: "ajedrez" | "tenis"; partida: number; rival: number;
  medalla: "oro" | "plata" | "tenis"; motivo: string; jugadas: number; ganado: number;
  /** Tenis: con quién ganó, contra quiénes y el marcador en juegos. */
  detalle?: { companeros?: number[]; rivales?: number[]; marcador?: string };
}
export interface ListaAjedrez { mias: PartidaAjedrez[]; en_curso: PartidaAjedrez[]; trofeos: TrofeoAjedrez[]; ahora: number }

export const rivalDe = (p: PartidaAjedrez, yo: number) => (p.blancas === yo ? p.negras : p.blancas);
export const meToca = (p: PartidaAjedrez, yo: number) =>
  p.estado === "jugando" && (p.turno === "blancas" ? p.blancas : p.negras) === yo;

// ─── Piezas en pixel art ─────────────────────────────────────────────────────

const MASCARAS: Record<PieceSymbol, string[]> = {
  p: ["................", "................", "................", "................", "......XXXX......", ".....XXXXXX.....",
      ".....XXXXXX.....", "......XXXX......", ".....XXXXXX.....", "......XXXX......", "......XXXX......", ".....XXXXXX.....",
      "....XXXXXXXX....", "...XXXXXXXXXX...", "...XXXXXXXXXX...", "................"],
  r: ["................", "................", "...XX.XXXX.XX...", "...XXXXXXXXXX...", "...XXXXXXXXXX...", "....XXXXXXXX....",
      ".....XXXXXX.....", ".....XXXXXX.....", ".....XXXXXX.....", ".....XXXXXX.....", ".....XXXXXX.....", "....XXXXXXXX....",
      "....XXXXXXXX....", "..XXXXXXXXXXXX..", "..XXXXXXXXXXXX..", "................"],
  n: ["................", "................", "........XX......", ".......XXXX.....", "......XXXXXX....", ".....XXXXXXXX...",
      "....XXX.XXXXX...", "...XXXXXXXXXXX..", "...XXXXXXXXXXX..", "....XX..XXXXXX..", "........XXXXX...", ".......XXXXXX...",
      "......XXXXXXX...", "..XXXXXXXXXXXX..", "..XXXXXXXXXXXX..", "................"],
  b: ["................", ".......XX.......", "......XXXX......", ".....XXXXXX.....", ".....XXX.XX.....", ".....XX.XXX.....",
      ".....XXXXXX.....", "......XXXX......", ".......XX.......", "......XXXX......", "......XXXX......", ".....XXXXXX.....",
      "....XXXXXXXX....", "...XXXXXXXXXX...", "...XXXXXXXXXX...", "................"],
  q: ["................", "..X...X..X...X..", "..XX..XXXX..XX..", "..XXX.XXXX.XXX..", "..XXXXXXXXXXXX..", "...XXXXXXXXXX...",
      "....XXXXXXXX....", ".....XXXXXX.....", ".....XXXXXX.....", ".....XXXXXX.....", ".....XXXXXX.....", "....XXXXXXXX....",
      "....XXXXXXXX....", "..XXXXXXXXXXXX..", "..XXXXXXXXXXXX..", "................"],
  k: [".......XX.......", "......XXXX......", ".......XX.......", "...XXX.XX.XXX...", "..XXXXXXXXXXXX..", "..XXXXXXXXXXXX..",
      "...XXXXXXXXXX...", "....XXXXXXXX....", ".....XXXXXX.....", ".....XXXXXX.....", ".....XXXXXX.....", "....XXXXXXXX....",
      "....XXXXXXXX....", "..XXXXXXXXXXXX..", "..XXXXXXXXXXXX..", "................"],
};

/** Cada máscara → cuatro trazos (contorno, cuerpo, luz a la izquierda, sombra a la derecha). */
function trazos(m: string[]) {
  const lleno = (x: number, y: number) => y >= 0 && y < 16 && x >= 0 && x < 16 && m[y][x] === "X";
  const t = { borde: "", cuerpo: "", luz: "", sombra: "" };
  const px = (x: number, y: number) => `M${x} ${y}h1v1h-1z`;
  for (let y = -1; y <= 16; y++)
    for (let x = -1; x <= 16; x++) {
      if (lleno(x, y)) {
        if (!lleno(x + 1, y)) t.sombra += px(x, y);
        else if (!lleno(x - 1, y)) t.luz += px(x, y);
        else t.cuerpo += px(x, y);
      } else if (lleno(x - 1, y) || lleno(x + 1, y) || lleno(x, y - 1) || lleno(x, y + 1)) t.borde += px(x, y);
    }
  return t;
}
const SPRITES = Object.fromEntries(Object.entries(MASCARAS).map(([k, m]) => [k, trazos(m)])) as Record<PieceSymbol, ReturnType<typeof trazos>>;
const TINTAS: Record<Color, { borde: string; cuerpo: string; luz: string; sombra: string }> = {
  w: { borde: "#2a2233", cuerpo: "#f3ead6", luz: "#ffffff", sombra: "#c4b593" },
  b: { borde: "#0c0a10", cuerpo: "#3b3047", luz: "#6d5d80", sombra: "#231b2b" },
};
const NOMBRE_PIEZA: Record<PieceSymbol, string> = { p: "peón", r: "torre", n: "caballo", b: "alfil", q: "dama", k: "rey" };

export function PiezaPixel({ tipo, color, className = "" }: { tipo: PieceSymbol; color: Color; className?: string }) {
  const s = SPRITES[tipo], c = TINTAS[color];
  return (
    <svg viewBox="-1 -1 18 18" className={className} shapeRendering="crispEdges" aria-hidden>
      <path d={s.borde} fill={c.borde} />
      <path d={s.cuerpo} fill={c.cuerpo} />
      <path d={s.luz} fill={c.luz} />
      <path d={s.sombra} fill={c.sombra} />
    </svg>
  );
}

// ─── La partida ──────────────────────────────────────────────────────────────

const COLUMNAS = "abcdefgh";

function reconstruir(jugadas: string[]) {
  const ch = new Chess();
  const san: string[] = [];
  let ultima: { from: Square; to: Square } | null = null;
  for (const u of jugadas) {
    try {
      const m = ch.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });
      san.push(m.san);
      ultima = { from: m.from, to: m.to };
    } catch {
      return { ch, san, ultima, rota: true };
    }
  }
  return { ch, san, ultima, rota: false };
}

/** Por qué se acabó la partida con la última jugada (lo que espera el servidor), o "". */
function motivoFin(ch: Chess): string {
  if (ch.isCheckmate()) return "jaque mate";
  if (ch.isStalemate()) return "ahogado";
  if (ch.isInsufficientMaterial()) return "material insuficiente";
  if (ch.isThreefoldRepetition()) return "triple repetición";
  if (ch.isDraw()) return "50 jugadas";
  return "";
}

const INICIALES: Record<PieceSymbol, number> = { p: 8, r: 2, n: 2, b: 2, q: 1, k: 1 };

/** Las piezas que cada color ya perdió (para mostrarlas a un lado del tablero). */
function capturadas(ch: Chess): Record<Color, PieceSymbol[]> {
  const quedan: Record<Color, Record<string, number>> = { w: {}, b: {} };
  for (const fila of ch.board()) for (const c of fila) if (c) quedan[c.color][c.type] = (quedan[c.color][c.type] ?? 0) + 1;
  const out: Record<Color, PieceSymbol[]> = { w: [], b: [] };
  for (const color of ["w", "b"] as Color[])
    for (const t of ["q", "r", "b", "n", "p"] as PieceSymbol[]) {
      const n = Math.max(0, INICIALES[t] - (quedan[color][t] ?? 0));
      for (let i = 0; i < n; i++) out[color].push(t);
    }
  return out;
}

export function VentanaAjedrez({ id, yo, nombreDe, retratoDe, onCerrar, onVerTrofeo }: {
  id: number;
  yo: number;
  nombreDe: (id: number) => string;
  retratoDe: (id: number) => string | null;
  onCerrar: () => void;
  /** Ir a ver el trofeo ganado a la repisa del cuarto (si quien ganó tiene cuarto en el barrio). */
  onVerTrofeo?: () => void;
}) {
  const qc = useQueryClient();
  const { data: partida, error: errorCarga, refetch } = useQuery({
    queryKey: ["ev-ajedrez", id],
    queryFn: () => api.get<PartidaAjedrez>(`/api/empresa-viva/ajedrez/${id}`),
    refetchInterval: (q) => (q.state.data && !["invitada", "jugando"].includes(q.state.data.estado) ? false : 1200),
  });
  // La jugada propia se ve ya; el servidor la confirma (o se deshace con el error).
  const [pendiente, setPendiente] = useState<string[] | null>(null);
  const [sel, setSel] = useState<Square | null>(null);
  const [promo, setPromo] = useState<{ from: Square; to: Square } | null>(null);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [seguro, setSeguro] = useState(false);
  const lista = useRef<HTMLOListElement>(null);

  const jugadas = pendiente ?? partida?.jugadas ?? [];
  const clave = jugadas.join(" ");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { ch, san, ultima, rota } = useMemo(() => reconstruir(jugadas), [clave]);
  const miColor: Color | null = partida ? (partida.blancas === yo ? "w" : partida.negras === yo ? "b" : null) : null;
  const jugando = partida?.estado === "jugando";
  const puedoMover = Boolean(jugando && miColor && ch.turn() === miColor && !rota && !enviando && !pendiente);
  const destinos = useMemo(() => (sel && puedoMover ? ch.moves({ square: sel, verbose: true }) : []), [ch, sel, puedoMover]);
  const volteado = miColor === "b";
  const perdidas = useMemo(() => capturadas(ch), [ch]);
  const enJaque = ch.inCheck();
  const reyEnJaque = useMemo(() => {
    if (!enJaque) return null;
    for (const fila of ch.board()) for (const c of fila) if (c && c.type === "k" && c.color === ch.turn()) return c.square;
    return null;
  }, [ch, enJaque]);

  // Sonidos: la jugada del otro, el jaque y el final.
  const antes = useRef<{ n: number; estado: string } | null>(null);
  useEffect(() => {
    if (!partida) return;
    const prev = antes.current;
    antes.current = { n: partida.jugadas.length, estado: partida.estado };
    if (!prev) return;
    if (partida.estado === "terminada" && prev.estado !== "terminada") {
      const gane = miColor && ((partida.resultado === "1-0" && miColor === "w") || (partida.resultado === "0-1" && miColor === "b"));
      tocarSonido(gane ? "logro" : "volver");
    } else if (partida.jugadas.length > prev.n) {
      const ultimaEsMia = miColor && ((partida.jugadas.length - 1) % 2 === 0 ? "w" : "b") === miColor;
      if (!ultimaEsMia) tocarSonido(enJaque ? "jaque" : "vista");
    }
  }, [partida, miColor, enJaque]);

  // Si el servidor ya trae la jugada propia, se suelta la copia local.
  useEffect(() => {
    if (pendiente && partida && partida.jugadas.length >= pendiente.length) setPendiente(null);
  }, [partida, pendiente]);
  useEffect(() => { lista.current?.scrollTo({ top: lista.current.scrollHeight }); }, [san.length]);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (promo) setPromo(null);
      else if (sel) setSel(null);
      else onCerrar();
    };
    window.addEventListener("keydown", tecla, true);
    return () => window.removeEventListener("keydown", tecla, true);
  }, [promo, sel, onCerrar]);

  const accion = useCallback(async (ruta: string, cuerpo: object = {}) => {
    setError("");
    setEnviando(true);
    try {
      const p = await api.post<PartidaAjedrez>(`/api/empresa-viva/ajedrez/${id}/${ruta}`, cuerpo);
      qc.setQueryData(["ev-ajedrez", id], p);
      void qc.invalidateQueries({ queryKey: ["ev-ajedrez-lista"] });
      return p;
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo");
      tocarSonido("error");
      void refetch();
      return null;
    } finally {
      setEnviando(false);
    }
  }, [id, qc, refetch]);

  const mover = useCallback((from: Square, to: Square, promotion?: PieceSymbol) => {
    const base = reconstruir(jugadas).ch;
    let uci = "";
    try {
      const m = base.move({ from, to, promotion });
      uci = `${m.from}${m.to}${m.promotion ?? ""}`;
    } catch {
      return;
    }
    const fin = motivoFin(base);
    const n = jugadas.length;
    setSel(null);
    setPromo(null);
    setPendiente([...jugadas, uci]);
    tocarSonido(base.inCheck() && !fin ? "jaque" : "blip");   // el final lo suena el efecto de arriba
    void accion("jugada", { uci, n, fin }).then((p) => { if (!p) setPendiente(null); });
  }, [jugadas, accion]);

  const tocar = (sq: Square) => {
    if (!puedoMover) return;
    const destino = destinos.filter((m) => m.to === sq);
    if (sel && destino.length) {
      if (destino.some((m) => m.promotion)) setPromo({ from: sel, to: sq });
      else mover(sel, sq);
      return;
    }
    const pieza = ch.get(sq);
    setSel(pieza && pieza.color === miColor && sq !== sel ? sq : null);
  };

  const filas = useMemo(() => {
    const out: Square[][] = [];
    for (let r = 0; r < 8; r++) {
      const fila: Square[] = [];
      for (let c = 0; c < 8; c++) {
        const col = volteado ? 7 - c : c, rango = volteado ? r + 1 : 8 - r;
        fila.push(`${COLUMNAS[col]}${rango}` as Square);
      }
      out.push(fila);
    }
    return out;
  }, [volteado]);

  if (!partida) {
    return (
      <Marco onCerrar={onCerrar}>
        <p className="p-6 text-center">{errorCarga ? (errorCarga as Error).message : "Sacando el tablero…"}</p>
      </Marco>
    );
  }

  const nb = nombreDe(partida.blancas), nn = nombreDe(partida.negras);
  const rival = miColor ? nombreDe(rivalDe(partida, yo)) : "";
  const turnoDe = ch.turn() === "w" ? nb : nn;
  let estado: string;
  if (rota) estado = "Esta partida tiene una jugada que no vale. Avísale a sistemas.";
  else if (partida.estado === "invitada") estado = partida.reta === yo ? `Esperando que ${rival} acepte el reto…` : `${nombreDe(partida.reta)} te retó.`;
  else if (jugando) {
    if (!miColor) estado = `Le toca a ${turnoDe}${enJaque ? " · ¡jaque!" : ""}`;
    else if (ch.turn() === miColor) estado = enJaque ? "¡Jaque! Te toca salir." : "Te toca.";
    else estado = `Juega ${rival}…${enJaque ? " (le diste jaque)" : ""}`;
  } else if (partida.estado === "terminada") {
    const motivo = partida.motivo ? ` · ${partida.motivo}` : "";
    if (partida.resultado === "1/2-1/2") estado = `Tablas${motivo}.`;
    else {
      const ganaColor: Color = partida.resultado === "1-0" ? "w" : "b";
      const medalla = partida.motivo === "jaque mate" ? "de oro" : "de plata";
      estado = miColor
        ? (ganaColor === miColor ? `¡Ganaste!${motivo}. Te llevas un trofeo ${medalla} para tu cuarto.` : `Ganó ${rival}${motivo}.`)
        : `Ganó ${ganaColor === "w" ? nb : nn}${motivo}: se lleva un trofeo ${medalla}.`;
    }
  } else estado = partida.estado === "rechazada" ? "No se jugó: el reto no fue aceptado." : partida.estado === "cancelada" ? "Reto retirado." : "El reto venció.";

  const ofreceOtro = partida.tablas_ofrece && partida.tablas_ofrece !== yo && miColor;
  const arriba = volteado ? "w" : "b";   // el color que se sienta enfrente
  const jugador = (color: Color) => {
    const pid = color === "w" ? partida.blancas : partida.negras;
    const ret = retratoDe(pid);
    const leToca = jugando && ch.turn() === color;
    return (
      <div className={`flex items-center gap-2 rounded px-1.5 py-1 ${leToca ? "bg-white/10 ring-1 ring-[#ffe14d]" : ""}`}>
        {ret ? <img src={ret} alt="" className="ev-retrato h-9 w-9 rounded border border-[#8a95d6] bg-[#0b1140]" draggable={false} />
             : <span className="h-9 w-9 rounded border border-[#8a95d6] bg-[#0b1140]" />}
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate">{nombreDe(pid)}{pid === yo ? " (tú)" : ""}</div>
          <div className="text-xs text-[#b9c2ff]">{color === "w" ? "Blancas" : "Negras"}{leToca ? " · le toca" : ""}</div>
        </div>
        <div className="flex max-w-[45%] flex-wrap justify-end">
          {perdidas[color === "w" ? "b" : "w"].map((t, i) => (
            <PiezaPixel key={i} tipo={t} color={color === "w" ? "b" : "w"} className="-mx-0.5 h-4 w-4" />
          ))}
        </div>
      </div>
    );
  };

  return (
    <Marco onCerrar={onCerrar}>
      <div className="ev-ajedrez-area min-h-0 flex-1 overflow-y-auto">
       <div className="flex flex-col gap-3 md:flex-row md:items-start">
        <div className="ev-ajedrez-col mx-auto shrink-0">
          <div className="mb-1">{jugador(arriba)}</div>
          <div className="relative aspect-square w-full select-none rounded-sm border-4 border-[#5a4a3f] bg-[#5a4a3f] shadow-[0_4px_0_rgba(0,0,0,0.35)]"
               role="grid" aria-label="Tablero de ajedrez">
            <div className="grid h-full w-full grid-cols-8 grid-rows-8">
              {filas.flat().map((sq) => {
                const col = COLUMNAS.indexOf(sq[0]), rango = Number(sq[1]);
                const oscura = (col + rango) % 2 === 1;
                const pieza = ch.get(sq);
                const destino = destinos.find((m) => m.to === sq);
                const marcada = ultima && (ultima.from === sq || ultima.to === sq);
                const nombre = pieza ? `${NOMBRE_PIEZA[pieza.type]} ${pieza.color === "w" ? "blanco" : "negro"} en ${sq}` : sq;
                return (
                  <button key={sq} type="button" role="gridcell" aria-label={nombre} onClick={() => tocar(sq)}
                          className="mck-btn-no-fx relative flex items-center justify-center p-0"
                          style={{ background: oscura ? "#a9744c" : "#ecd9b0", cursor: puedoMover ? "pointer" : "default" }}>
                    {marcada && <span className="absolute inset-0 bg-[#ffe14d]/35" />}
                    {sel === sq && <span className="absolute inset-0 bg-[#5db8ff]/45" />}
                    {reyEnJaque === sq && <span className="absolute inset-0 bg-[radial-gradient(circle,rgba(231,76,60,0.9)_10%,transparent_70%)]" />}
                    {pieza && <PiezaPixel tipo={pieza.type} color={pieza.color} className="relative h-[86%] w-[86%]" />}
                    {destino && (pieza
                      ? <span className="absolute inset-[6%] rounded-full border-[3px] border-[#1d2b53]/55" />
                      : <span className="absolute h-[26%] w-[26%] rounded-full bg-[#1d2b53]/45" />)}
                    {(volteado ? col === 7 : col === 0) && (
                      <span className="absolute left-0.5 top-0 text-[9px] leading-none" style={{ color: oscura ? "#ecd9b0" : "#a9744c" }}>{rango}</span>
                    )}
                    {(volteado ? rango === 8 : rango === 1) && (
                      <span className="absolute bottom-0 right-0.5 text-[9px] leading-none" style={{ color: oscura ? "#ecd9b0" : "#a9744c" }}>{sq[0]}</span>
                    )}
                  </button>
                );
              })}
            </div>
            {promo && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/55" onClick={() => setPromo(null)}>
                <div className="ev-ventana p-3 text-center" onClick={(e) => e.stopPropagation()}>
                  <div className="mb-2">¿En qué se convierte el peón?</div>
                  <div className="flex gap-2">
                    {(["q", "r", "b", "n"] as PieceSymbol[]).map((t) => (
                      <button key={t} type="button" className="ev-boton mck-btn-no-fx flex flex-col items-center p-1"
                              onClick={() => mover(promo.from, promo.to, t)} aria-label={NOMBRE_PIEZA[t]}>
                        <PiezaPixel tipo={t} color={miColor ?? "w"} className="h-10 w-10" />
                        <span className="text-xs">{NOMBRE_PIEZA[t]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="mt-1">{jugador(arriba === "w" ? "b" : "w")}</div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2 md:max-w-xs">
          <div className="rounded border-2 border-[#8a95d6] bg-[#0b1140]/60 p-2 text-[15px]" role="status">{estado}</div>
          {error && <p className="text-sm text-[#ffb4b4]">{error}</p>}
          {partida.estado === "terminada" && miColor && onVerTrofeo
            && ((partida.resultado === "1-0" && miColor === "w") || (partida.resultado === "0-1" && miColor === "b")) && (
            <button type="button" className="ev-boton mck-btn-no-fx self-start" aria-pressed="true" onClick={onVerTrofeo}>
              Ver mi trofeo en el cuarto
            </button>
          )}
          {partida.estado === "invitada" && partida.reta !== yo && miColor && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="ev-boton mck-btn-no-fx" aria-pressed="true" disabled={enviando} onClick={() => void accion("aceptar")}>Aceptar y jugar</button>
              <button type="button" className="ev-boton mck-btn-no-fx" disabled={enviando} onClick={() => void accion("rechazar")}>Ahora no</button>
            </div>
          )}
          {partida.estado === "invitada" && partida.reta === yo && (
            <button type="button" className="ev-boton mck-btn-no-fx self-start" disabled={enviando} onClick={() => void accion("cancelar")}>Retirar el reto</button>
          )}
          {ofreceOtro && jugando && (
            <div className="rounded border-2 border-[#ffe14d] p-2">
              <div className="mb-1">{rival} ofrece tablas.</div>
              <div className="flex gap-2">
                <button type="button" className="ev-boton mck-btn-no-fx" aria-pressed="true" disabled={enviando} onClick={() => void accion("tablas", { accion: "aceptar" })}>Aceptar tablas</button>
                <button type="button" className="ev-boton mck-btn-no-fx" disabled={enviando} onClick={() => void accion("tablas", { accion: "rechazar" })}>Seguir jugando</button>
              </div>
            </div>
          )}
          <ol ref={lista} className="max-h-40 min-h-[3rem] overflow-y-auto rounded border border-[#8a95d6]/60 p-1.5 text-sm md:max-h-72" aria-label="Jugadas">
            {Array.from({ length: Math.ceil(san.length / 2) }, (_, i) => (
              <li key={i} className="grid grid-cols-[2.2rem_1fr_1fr] gap-1">
                <span className="text-[#b9c2ff]">{i + 1}.</span><span>{san[i * 2]}</span><span>{san[i * 2 + 1] ?? ""}</span>
              </li>
            ))}
            {!san.length && <li className="text-[#b9c2ff]">{jugando ? "Abren las blancas." : "Sin jugadas."}</li>}
          </ol>
          {jugando && miColor && (
            <div className="flex flex-wrap gap-2">
              {!partida.tablas_ofrece && (
                <button type="button" className="ev-boton mck-btn-no-fx" disabled={enviando} onClick={() => void accion("tablas", { accion: "ofrecer" })}>Ofrecer tablas</button>
              )}
              {partida.tablas_ofrece === yo && <span className="self-center text-sm text-[#b9c2ff]">Ofreciste tablas…</span>}
              <button type="button" className="ev-boton mck-btn-no-fx" disabled={enviando}
                      onClick={() => { if (seguro) { setSeguro(false); void accion("rendirse"); } else { setSeguro(true); window.setTimeout(() => setSeguro(false), 4000); } }}>
                {seguro ? "¿Seguro? Toca otra vez" : "Rendirse"}
              </button>
            </div>
          )}
          {!miColor && <p className="text-sm text-[#b9c2ff]">Estás mirando: juegan {nb} (blancas) y {nn} (negras).</p>}
        </div>
       </div>
      </div>
    </Marco>
  );
}

function Marco({ children, onCerrar }: { children: React.ReactNode; onCerrar: () => void }) {
  return (
    <div className="absolute inset-0 z-[36] flex items-center justify-center bg-black/40 p-1.5 sm:p-3">
      <div className="ev-ventana flex h-full w-full max-w-[60rem] flex-col p-2 sm:p-3" role="dialog" aria-label="Ajedrez en el parque">
        <div className="mb-2 flex shrink-0 items-center gap-2">
          <PiezaPixel tipo="n" color="w" className="h-8 w-8" />
          <div className="ev-nombre-dialogo flex-1 truncate text-lg">Ajedrez en el parque</div>
          <button type="button" className="ev-boton mck-btn-no-fx shrink-0" aria-pressed="true" onClick={onCerrar} title="La partida sigue: vuelves cuando quieras">
            Volver al barrio
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
