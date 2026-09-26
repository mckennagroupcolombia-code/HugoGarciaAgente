/**
 * Los relevos (26-sep-2026): cómo viaja un paquete por un edificio pixel, con lógica de verdad.
 * La usan el edificio de Colaboradores (EdificioColab) y el Edificio del Mapa de McKenna
 * (MapaEdificio). Cada relevo es una entrega de una estación a otra:
 *
 *   · Mismo piso: quien envía toma la caja, camina hasta la otra habitación y se la ENTREGA EN LA
 *     MANO a quien recibe, que la deja en su estación. Quien envió vuelve a su puesto.
 *   · Otro piso: quien envía camina hasta la puerta del ASCENSOR (que primero viene a buscarlo), mete
 *     la caja, el ascensor sube o baja CON LA CAJA ADENTRO, y en el otro piso quien recibe ya camina
 *     hacia la puerta, la saca, la lleva a su estación y la deja.
 *
 * Los relevos van UNO TRAS OTRO, en el orden en que se dan (el del proceso): se lee como la historia
 * del paquete. El ascensor es de la capa (no hay otro) y se queda donde terminó el relevo anterior.
 *
 * Todo sale de un plan por relevo: fotogramas clave por actor (x en el tiempo), por la caja (x, y) y
 * por la cabina (y); cada cuadro se interpola. Se avanza a 12 cuadros por segundo (se mueve «a
 * saltos», como un juego de 8 bits). Con prefers-reduced-motion no se anima: solo los residentes quietos.
 */
import "./relevos.css";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Sprite } from "../colaboradores/pixel";

/** Una estación: dónde está (x dentro de la torre) y en qué piso. */
export type Punto = { x: number; piso: string };
/** Quien lleva o recibe. `figura` (filas de un sprite, p. ej. la mujer o la princesa del Mapa) y
 *  `colores` son opcionales: por defecto, el muñeco de siempre con la camisa del color. */
export type Actor = { color: string; nombre?: string; figura?: string[]; colores?: Record<string, string> };
export type Relevo = {
  id: string;
  desde: Punto;
  hasta: Punto;
  carga: "caja" | "doc";
  etiqueta?: string;
  emisor: Actor;
  receptor: Actor;
};
/** La torre medida: la línea del suelo de cada piso (y) y la x de la puerta del ascensor. */
export type Geometria = { pisos: Record<string, { suelo: number }>; puertaX: number };

const CAJA = ["kkkkkkkk", "knnnonnk", "knnnonnk", "kkkkkkkk", "knnnnnnk", "knnnnnnk", "kkkkkkkk"];
const DOC = ["kkkkk...", "kwwwkk..", "kwwwkwk.", "kwwwkkkk", "kwSSSSwk", "kwwwwwwk", "kwSSSSwk", "kkkkkkkk"];
const V = 0.11;        // px por ms caminando
const VC = 0.17;       // px por ms del ascensor
const JUNTO = 22;      // a qué distancia se para uno del otro o de la puerta

type Kf = { t: number; v: number };
type KfCaja = { t: number; x: number; y: number };
type Plan = {
  dur: number;
  emisor: { piso: string; kx: Kf[] };
  receptor: { piso: string; kx: Kf[] };
  caja: { k: KfCaja[]; hasta: number };
  cabina: Kf[];
  cabinaFinal: string;
  burbujas: { t0: number; t1: number; quien: "emisor" | "receptor"; texto: string }[];
  destello: { t0: number; x: number; y: number };
};

function interp(k: Kf[], t: number): number {
  if (t <= k[0].t) return k[0].v;
  for (let i = 1; i < k.length; i++) {
    if (t <= k[i].t) {
      const a = k[i - 1], b = k[i];
      return b.t === a.t ? b.v : a.v + (b.v - a.v) * ((t - a.t) / (b.t - a.t));
    }
  }
  return k[k.length - 1].v;
}
function interpCaja(k: KfCaja[], t: number): { x: number; y: number } {
  const xs = k.map((p) => ({ t: p.t, v: p.x })), ys = k.map((p) => ({ t: p.t, v: p.y }));
  return { x: interp(xs, t), y: interp(ys, t) };
}

/** El plan de un relevo, a partir de dónde está el ascensor. */
function planear(r: Relevo, g: Geometria, cabinaEn: string): Plan | null {
  const pa = g.pisos[r.desde.piso], pb = g.pisos[r.hasta.piso];
  if (!pa || !pb) return null;
  const yA = pa.suelo, yB = pb.suelo;
  const xA = r.desde.x, xB = r.hasta.x;
  // La caja va sobre la cabeza de quien la lleva (las figuras del Mapa son más altas que el muñeco).
  const altoDe = (a: Actor) => (a.figura?.length ?? 8) * 3;
  const cabezaE = (y: number) => y - altoDe(r.emisor) - 12;
  const cabezaR = (y: number) => y - altoDe(r.receptor) - 12;
  const cabeza = cabezaE;
  const piso = (y: number) => y - 6;
  const yCab0 = g.pisos[cabinaEn]?.suelo ?? yA;

  if (r.desde.piso === r.hasta.piso) {
    // Mismo piso: camina, entrega en la mano, el otro la deja; quien envió vuelve.
    const dir = xB >= xA ? 1 : -1;
    const xEncuentro = xB - dir * JUNTO;
    const tw = Math.abs(xEncuentro - xA) / V;
    const t1 = 500, t2 = t1 + tw, t3 = t2 + 450, t4 = t3 + 450;
    const fin = Math.max(t4 + tw, t4 + 700) + 500;
    return {
      dur: fin,
      emisor: { piso: r.desde.piso, kx: [{ t: 0, v: xA }, { t: t1, v: xA }, { t: t2, v: xEncuentro }, { t: t4, v: xEncuentro }, { t: t4 + tw, v: xA }] },
      receptor: { piso: r.hasta.piso, kx: [{ t: 0, v: xB }] },
      caja: { k: [{ t: 0, x: xA, y: cabeza(yA) }, { t: t1, x: xA, y: cabeza(yA) }, { t: t2, x: xEncuentro, y: cabeza(yA) },
                  { t: t3, x: xB, y: cabezaR(yB) }, { t: t4, x: xB, y: piso(yB) }], hasta: t4 },
      cabina: [{ t: 0, v: yCab0 }],
      cabinaFinal: cabinaEn,
      burbujas: [{ t0: t2, t1: t3 + 250, quien: "emisor", texto: "¡Toma!" }],
      destello: { t0: t4, x: xB, y: piso(yB) },
    };
  }

  // Otro piso: al ascensor, sube/baja con la caja, el otro la recoge en la puerta.
  const puerta = g.puertaX - JUNTO;
  const tw1 = Math.abs(puerta - xA) / V, tw2 = Math.abs(xB - puerta) / V;
  const tc1 = Math.abs(yCab0 - yA) / VC, tc2 = Math.abs(yA - yB) / VC;
  const encuentro1 = Math.max(500 + tw1, tc1);            // el ascensor tiene que estar ahí
  const adentro = encuentro1 + 400;                         // la caja entró a la cabina
  const llega = adentro + tc2;                              // la cabina llegó al otro piso
  const sale = Math.max(0, llega - tw2);                    // quien recibe sale a tiempo hacia la puerta
  const encuentro2 = Math.max(llega, sale + tw2);
  const recogida = encuentro2 + 400;
  const deja = recogida + tw2;
  const suelta = deja + 450;
  const fin = Math.max(suelta + 700, adentro + tw1) + 500;
  const cabinaCaja = (y: number) => y - 18;
  return {
    dur: fin,
    emisor: { piso: r.desde.piso, kx: [{ t: 0, v: xA }, { t: 500, v: xA }, { t: 500 + tw1, v: puerta }, { t: adentro, v: puerta }, { t: adentro + tw1, v: xA }] },
    receptor: { piso: r.hasta.piso, kx: [{ t: 0, v: xB }, { t: sale, v: xB }, { t: sale + tw2, v: puerta }, { t: recogida, v: puerta }, { t: deja, v: xB }] },
    caja: {
      k: [{ t: 0, x: xA, y: cabeza(yA) }, { t: 500, x: xA, y: cabeza(yA) }, { t: 500 + tw1, x: puerta, y: cabeza(yA) },
          { t: encuentro1, x: puerta, y: cabeza(yA) }, { t: adentro, x: g.puertaX, y: cabinaCaja(yA) },
          { t: llega, x: g.puertaX, y: cabinaCaja(yB) }, { t: encuentro2, x: g.puertaX, y: cabinaCaja(yB) },
          { t: recogida, x: puerta, y: cabezaR(yB) }, { t: deja, x: xB, y: cabezaR(yB) }, { t: suelta, x: xB, y: piso(yB) }],
      hasta: suelta,
    },
    cabina: [{ t: 0, v: yCab0 }, { t: tc1, v: yA }, { t: adentro, v: yA }, { t: llega, v: yB }],
    cabinaFinal: r.hasta.piso,
    burbujas: [
      { t0: 500 + tw1, t1: adentro + 200, quien: "emisor", texto: yB < yA ? "¡Arriba!" : "¡Abajo!" },
      { t0: encuentro2, t1: recogida + 300, quien: "receptor", texto: "¡Llegó!" },
    ],
    destello: { t0: suelta, x: xB, y: piso(yB) },
  };
}

export default function CapaRelevos({ relevos, geometria, residentes = {}, onTocar, onPaso }: {
  relevos: Relevo[];
  geometria: Geometria | null;
  /** Quien trabaja en cada piso, quieto en su puesto mientras no participa (el Mapa los usa). */
  residentes?: Record<string, { x: number } & Actor>;
  onTocar?: (id: string) => void;
  /** Se avisa cuando un relevo deja su carga (p. ej. el camión del Mapa arranca). */
  onPaso?: (id: string) => void;
}) {
  const reducir = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [ahora, setAhora] = useState(0);
  const estado = useRef({ i: 0, t0: 0, cabina: "", avisado: false });
  const firma = relevos.map((r) => `${r.id}:${r.desde.piso}>${r.hasta.piso}`).join("|");
  useEffect(() => { estado.current = { i: 0, t0: performance.now(), cabina: "", avisado: false }; }, [firma]);

  // El reloj: avanza el cuadro y, fuera del render, pasa al siguiente relevo y avisa cuando se deja la carga.
  const planRef = useRef<Plan | null>(null);
  const onPasoRef = useRef(onPaso); onPasoRef.current = onPaso;
  const relevosRef = useRef(relevos); relevosRef.current = relevos;
  useEffect(() => {
    if (reducir || !relevos.length || !geometria) return;
    const id = window.setInterval(() => {
      const ahoraMs = performance.now();
      const p = planRef.current, e = estado.current, lista = relevosRef.current;
      if (p && lista.length) {
        const t = ahoraMs - e.t0;
        if (!e.avisado && t >= p.caja.hasta) { e.avisado = true; onPasoRef.current?.(lista[e.i % lista.length].id); }
        if (t >= p.dur) estado.current = { i: (e.i + 1) % lista.length, t0: ahoraMs, cabina: p.cabinaFinal, avisado: false };
      }
      setAhora(ahoraMs);
    }, 83);
    return () => window.clearInterval(id);
  }, [reducir, relevos.length, geometria]);

  const actual = relevos.length ? relevos[estado.current.i % relevos.length] : null;
  const plan = useMemo(() => {
    if (!actual || !geometria) return null;
    return planear(actual, geometria, estado.current.cabina || actual.desde.piso);
    // El plan se recalcula al cambiar de relevo o de medidas, no en cada cuadro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actual?.id, estado.current.i, geometria]);
  planRef.current = plan;

  if (!geometria) return null;
  const pisoY = (p: string) => geometria.pisos[p]?.suelo;

  const t = Math.max(0, ahora - estado.current.t0);
  const activo = plan && !reducir ? plan : null;
  const yCabina = activo ? interp(activo.cabina, t) : pisoY(estado.current.cabina) ?? Object.values(geometria.pisos)[0]?.suelo ?? 0;

  const muñeco = (clave: string, actor: Actor, x: number, y: number, xAntes: number, relevo?: string, burbuja?: string) => {
    const anda = Math.abs(x - xAntes) > 0.5;
    const alto = (actor.figura?.length ?? 8) * 3;
    const dibujo = <Sprite s={actor.figura ?? "jugador"} px={3} colores={actor.colores ?? { X: actor.color }} />;
    const voltea = { transform: x < xAntes ? "scaleX(-1)" : undefined };
    return (
      <div key={clave} className={`rl-actor ${anda ? "rl-anda" : ""}`}
           style={{ transform: `translate(${Math.round(x / 2) * 2 - 12}px, ${Math.round(y) - alto}px)` }}>
        {burbuja && <span className="rl-burbuja">{burbuja}</span>}
        {relevo && onTocar ? (
          <button type="button" className="rl-actor-btn" onClick={() => onTocar(relevo)} data-relevo={relevo} style={voltea}
                  title={actor.nombre}>{dibujo}</button>
        ) : (
          <span className="rl-actor-btn" style={voltea}>{dibujo}</span>
        )}
      </div>
    );
  };

  const piezas: ReactElement[] = [];
  const ocupados = new Set<string>();
  if (activo && actual) {
    ocupados.add(activo.emisor.piso);
    ocupados.add(activo.receptor.piso);
    const burb = (quien: "emisor" | "receptor") => activo.burbujas.find((b) => b.quien === quien && t >= b.t0 && t <= b.t1)?.texto;
    const ex = interp(activo.emisor.kx, t), exA = interp(activo.emisor.kx, t - 90);
    const rx = interp(activo.receptor.kx, t), rxA = interp(activo.receptor.kx, t - 90);
    piezas.push(muñeco("emisor", actual.emisor, ex, pisoY(activo.emisor.piso)!, exA, actual.id, burb("emisor")));
    piezas.push(muñeco("receptor", actual.receptor, rx, pisoY(activo.receptor.piso)!, rxA, actual.id, burb("receptor")));
    if (t <= activo.caja.hasta) {
      const c = interpCaja(activo.caja.k, t);
      piezas.push(
        <div key="caja" className="rl-caja" style={{ transform: `translate(${Math.round(c.x / 2) * 2 - 8}px, ${Math.round(c.y) - 14}px)` }}>
          <Sprite s={actual.carga === "doc" ? DOC : CAJA} px={2} />
          {actual.etiqueta && <span className="rl-etq">{actual.etiqueta}</span>}
        </div>,
      );
    } else if (t <= activo.destello.t0 + 500) {
      piezas.push(<div key="destello" className="rl-destello" style={{ transform: `translate(${activo.destello.x - 8}px, ${activo.destello.y - 22}px)` }}>
        <Sprite s="estrella" px={2} />
      </div>);
    }
  }
  // Los residentes: cada piso tiene a alguien en su puesto (quieto) mientras no le toque el relevo.
  for (const [p, r] of Object.entries(residentes)) {
    if (ocupados.has(p) || pisoY(p) == null) continue;
    piezas.push(muñeco(`res-${p}`, r, r.x, pisoY(p)!, r.x));
  }

  return (
    <div className="rl-capa" aria-hidden={onTocar ? undefined : true}>
      <div className="rl-cabina" style={{ transform: `translate(${geometria.puertaX - 17}px, ${Math.round(yCabina) - 44}px)` }}>
        <span /><span />
      </div>
      {piezas}
    </div>
  );
}
