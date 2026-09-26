/**
 * Los relevos (26-sep-2026): cómo viaja algo por un edificio pixel, con la lógica de quien trabaja
 * ahí. La usan el edificio de Colaboradores (EdificioColab) y el Edificio del Mapa de McKenna
 * (MapaEdificio, que cuenta la operación real: recepción, bodega, dosificación, empaque, etiqueta,
 * almacén, alistamiento, guía, transportadora, factura, pago, Libro Mayor…).
 *
 *   · Dos personas, mismo piso: quien envía lleva la cosa y se la ENTREGA EN LA MANO a quien recibe,
 *     que la deja en su estación y hace lo suyo (la burbuja lo dice: «Pesa y envasa»).
 *   · Dos personas, otro piso: quien envía la lleva al ASCENSOR (que primero viene a buscarlo), la
 *     cabina viaja CON LA COSA ADENTRO y quien recibe la saca en su piso y la lleva a su estación.
 *   · Una sola persona (hace los dos pasos): la lleva ella misma; si es a otro piso, se sube con
 *     la cosa al ascensor y sale en el otro piso.
 *
 * Los relevos van UNO TRAS OTRO, en el orden dado (el del proceso). El ascensor es de la capa y se
 * queda donde terminó el relevo anterior. Los «residentes» (cada persona en su puesto) están quietos
 * y se ocultan mientras les toca actuar. Todo sale de un plan por relevo con fotogramas clave
 * (x/y de cada actor, x/y de la carga, y de la cabina), a 12 cuadros por segundo: se mueve «a
 * saltos», como un juego de 8 bits. Con prefers-reduced-motion no se anima.
 */
import "./relevos.css";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Sprite } from "../colaboradores/pixel";

/** Una estación: dónde está (x dentro de la torre) y en qué piso. */
export type Punto = { x: number; piso: string };
/** Quien lleva o recibe. `figura` (filas de un sprite) y `colores` son opcionales. `nombre` identifica
 *  a la persona: si es el mismo en los dos lados, lo lleva ella sola. */
export type Actor = { color: string; nombre?: string; figura?: string[]; colores?: Record<string, string> };
export type Carga = "caja" | "doc" | "materia" | "bolsa" | "producto" | "paquete" | "guia";
export type Relevo = {
  id: string;
  desde: Punto;
  hasta: Punto;
  carga: Carga;
  etiqueta?: string;
  /** Lo que hace quien recibe al dejarla (sale en su burbuja). */
  accion?: string;
  emisor: Actor;
  receptor: Actor;
};
export type Residente = { id: string; x: number; piso: string; actor: Actor };
/** La torre medida: la línea del suelo de cada piso (y) y la x de la puerta del ascensor. */
export type Geometria = { pisos: Record<string, { suelo: number }>; puertaX: number };

const SPRITES: Record<Carga, string[]> = {
  caja: ["kkkkkkkk", "knnnonnk", "knnnonnk", "kkkkkkkk", "knnnnnnk", "knnnnnnk", "kkkkkkkk"],
  doc: ["kkkkk...", "kwwwkk..", "kwwwkwk.", "kwwwkkkk", "kwSSSSwk", "kwwwwwwk", "kwSSSSwk", "kkkkkkkk"],
  // saco de materia prima
  materia: ["..kkkk..", ".knkknk.", "knnnnnnk", "knnwwnnk", "knnwwnnk", "knnnnnnk", ".kkkkkk."],
  // bolsa dosificada y sellada (sin etiqueta todavía)
  bolsa: ["kkkkkkkk", "kssssssk", ".kwwwwk.", ".kwwwwk.", ".kwwwwk.", ".kwwwwk.", ".kkkkkk."],
  // producto terminado: bolsa con su etiqueta
  producto: ["kkkkkkkk", "kssssssk", ".kwwwwk.", ".kyyyyk.", ".kbbbbk.", ".kwwwwk.", ".kkkkkk."],
  // paquete de envío y paquete con la guía pegada
  paquete: ["kkkkkkkkk", "knnnnonnk", "knnnnonnk", "kkkkkkkkk", "knnnnnnnk", "knnnnnnnk", "kkkkkkkkk"],
  guia: ["kkkkkkkkk", "knnnnonnk", "knwwwwnnk", "kkwSSwkkk", "knwwwwnnk", "knnnnnnnk", "kkkkkkkkk"],
};
const V = 0.13;        // px por ms caminando
const VC = 0.18;       // px por ms del ascensor
const JUNTO = 22;      // a qué distancia se para uno del otro o de la puerta
const TRABAJO = 1500;  // cuánto se ve lo que hace quien recibe

type Kf = { t: number; v: number };
type KfCaja = { t: number; x: number; y: number };
type Pista = { piso: string; kx: Kf[]; ky?: Kf[] };
type Burbuja = { t0: number; t1: number; quien: "emisor" | "receptor"; texto: string; accion?: boolean };
type Plan = {
  dur: number;
  emisor: Pista;
  receptor: Pista | null;
  caja: { k: KfCaja[]; hasta: number };
  cabina: Kf[];
  cabinaFinal: string;
  burbujas: Burbuja[];
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
  return { x: interp(k.map((p) => ({ t: p.t, v: p.x })), t), y: interp(k.map((p) => ({ t: p.t, v: p.y })), t) };
}
const altoDe = (a: Actor) => (a.figura?.length ?? 8) * 3;
/** La carga sobre la cabeza de alguien que se mueve según sus pistas, hasta `hasta`. */
function sobreCabeza(p: Pista, yPiso: number, alto: number, hasta: number): KfCaja[] {
  const tiempos = [...new Set([...p.kx.map((k) => k.t), ...(p.ky ?? []).map((k) => k.t), hasta])].filter((t) => t <= hasta).sort((a, b) => a - b);
  return tiempos.map((t) => ({ t, x: interp(p.kx, t), y: (p.ky ? interp(p.ky, t) : yPiso) - alto - 12 }));
}

/** El plan de un relevo, a partir de dónde está el ascensor. */
function planear(r: Relevo, g: Geometria, cabinaEn: string): Plan | null {
  const pa = g.pisos[r.desde.piso], pb = g.pisos[r.hasta.piso];
  if (!pa || !pb) return null;
  const yA = pa.suelo, yB = pb.suelo;
  const xA = r.desde.x, xB = r.hasta.x;
  const suelo = (y: number) => y - 6;
  const yCab0 = g.pisos[cabinaEn]?.suelo ?? yA;
  const puerta = g.puertaX - JUNTO;
  const solo = Boolean(r.emisor.nombre && r.emisor.nombre === r.receptor.nombre);
  const mismoPiso = r.desde.piso === r.hasta.piso;
  const accion = (t0: number, quien: "emisor" | "receptor"): Burbuja[] =>
    r.accion ? [{ t0, t1: t0 + TRABAJO, quien, texto: r.accion, accion: true }] : [];

  if (solo && mismoPiso) {
    // La misma persona: la lleva y hace lo suyo en la otra estación.
    const tw = Math.abs(xB - xA) / V;
    const llega = 400 + tw, deja = llega + 350;
    const emisor: Pista = { piso: r.desde.piso, kx: [{ t: 0, v: xA }, { t: 400, v: xA }, { t: llega, v: xB }] };
    return {
      dur: deja + TRABAJO + 300, emisor, receptor: null,
      caja: { k: [...sobreCabeza(emisor, yA, altoDe(r.emisor), llega), { t: deja, x: xB, y: suelo(yB) }], hasta: deja },
      cabina: [{ t: 0, v: yCab0 }], cabinaFinal: cabinaEn,
      burbujas: accion(deja, "emisor"),
      destello: { t0: deja, x: xB, y: suelo(yB) },
    };
  }

  if (solo) {
    // La misma persona sube (o baja) con la cosa en el ascensor.
    const tw1 = Math.abs(puerta - xA) / V, tw2 = Math.abs(xB - puerta) / V;
    const tc1 = Math.abs(yCab0 - yA) / VC, tc2 = Math.abs(yA - yB) / VC;
    const encuentro = Math.max(400 + tw1, tc1);
    const adentro = encuentro + 300;
    const llega = adentro + tc2;
    const afuera = llega + 300;
    const enEstacion = afuera + tw2;
    const deja = enEstacion + 350;
    const emisor: Pista = {
      piso: r.desde.piso,
      kx: [{ t: 0, v: xA }, { t: 400, v: xA }, { t: 400 + tw1, v: puerta }, { t: encuentro, v: puerta }, { t: adentro, v: g.puertaX },
           { t: llega, v: g.puertaX }, { t: afuera, v: puerta }, { t: enEstacion, v: xB }],
      ky: [{ t: 0, v: yA }, { t: adentro, v: yA }, { t: llega, v: yB }],
    };
    return {
      dur: deja + TRABAJO + 300, emisor, receptor: null,
      caja: { k: [...sobreCabeza(emisor, yA, altoDe(r.emisor), enEstacion), { t: deja, x: xB, y: suelo(yB) }], hasta: deja },
      cabina: [{ t: 0, v: yCab0 }, { t: tc1, v: yA }, { t: adentro, v: yA }, { t: llega, v: yB }],
      cabinaFinal: r.hasta.piso,
      burbujas: [{ t0: 400 + tw1, t1: adentro + 200, quien: "emisor", texto: yB < yA ? "¡Arriba!" : "¡Abajo!" }, ...accion(deja, "emisor")],
      destello: { t0: deja, x: xB, y: suelo(yB) },
    };
  }

  const cabezaE = (y: number) => y - altoDe(r.emisor) - 12;
  const cabezaR = (y: number) => y - altoDe(r.receptor) - 12;

  if (mismoPiso) {
    // Dos personas en el mismo piso: se entrega en la mano.
    const dir = xB >= xA ? 1 : -1;
    const xEncuentro = xB - dir * JUNTO;
    const tw = Math.abs(xEncuentro - xA) / V;
    const t1 = 400, t2 = t1 + tw, t3 = t2 + 450, t4 = t3 + 450;
    return {
      dur: Math.max(t4 + TRABAJO, t4 + tw) + 300,
      emisor: { piso: r.desde.piso, kx: [{ t: 0, v: xA }, { t: t1, v: xA }, { t: t2, v: xEncuentro }, { t: t4, v: xEncuentro }, { t: t4 + tw, v: xA }] },
      receptor: { piso: r.hasta.piso, kx: [{ t: 0, v: xB }] },
      caja: { k: [{ t: 0, x: xA, y: cabezaE(yA) }, { t: t1, x: xA, y: cabezaE(yA) }, { t: t2, x: xEncuentro, y: cabezaE(yA) },
                  { t: t3, x: xB, y: cabezaR(yB) }, { t: t4, x: xB, y: suelo(yB) }], hasta: t4 },
      cabina: [{ t: 0, v: yCab0 }],
      cabinaFinal: cabinaEn,
      burbujas: [{ t0: t2, t1: t3 + 250, quien: "emisor", texto: "¡Toma!" }, ...accion(t4, "receptor")],
      destello: { t0: t4, x: xB, y: suelo(yB) },
    };
  }

  // Dos personas en pisos distintos: al ascensor, viaja con la cosa adentro, el otro la recoge.
  const tw1 = Math.abs(puerta - xA) / V, tw2 = Math.abs(xB - puerta) / V;
  const tc1 = Math.abs(yCab0 - yA) / VC, tc2 = Math.abs(yA - yB) / VC;
  const encuentro1 = Math.max(400 + tw1, tc1);            // el ascensor tiene que estar ahí
  const adentro = encuentro1 + 400;                         // la carga entró a la cabina
  const llega = adentro + tc2;                              // la cabina llegó al otro piso
  const sale = Math.max(0, llega - tw2);                    // quien recibe sale a tiempo hacia la puerta
  const encuentro2 = Math.max(llega, sale + tw2);
  const recogida = encuentro2 + 400;
  const deja = recogida + tw2;
  const suelta = deja + 400;
  const cabinaCarga = (y: number) => y - 18;
  return {
    dur: Math.max(suelta + TRABAJO, adentro + tw1) + 300,
    emisor: { piso: r.desde.piso, kx: [{ t: 0, v: xA }, { t: 400, v: xA }, { t: 400 + tw1, v: puerta }, { t: adentro, v: puerta }, { t: adentro + tw1, v: xA }] },
    receptor: { piso: r.hasta.piso, kx: [{ t: 0, v: xB }, { t: sale, v: xB }, { t: sale + tw2, v: puerta }, { t: recogida, v: puerta }, { t: deja, v: xB }] },
    caja: {
      k: [{ t: 0, x: xA, y: cabezaE(yA) }, { t: 400, x: xA, y: cabezaE(yA) }, { t: 400 + tw1, x: puerta, y: cabezaE(yA) },
          { t: encuentro1, x: puerta, y: cabezaE(yA) }, { t: adentro, x: g.puertaX, y: cabinaCarga(yA) },
          { t: llega, x: g.puertaX, y: cabinaCarga(yB) }, { t: encuentro2, x: g.puertaX, y: cabinaCarga(yB) },
          { t: recogida, x: puerta, y: cabezaR(yB) }, { t: deja, x: xB, y: cabezaR(yB) }, { t: suelta, x: xB, y: suelo(yB) }],
      hasta: suelta,
    },
    cabina: [{ t: 0, v: yCab0 }, { t: tc1, v: yA }, { t: adentro, v: yA }, { t: llega, v: yB }],
    cabinaFinal: r.hasta.piso,
    burbujas: [
      { t0: 400 + tw1, t1: adentro + 200, quien: "emisor", texto: yB < yA ? "¡Arriba!" : "¡Abajo!" },
      { t0: encuentro2, t1: recogida + 300, quien: "receptor", texto: "¡Llegó!" },
      ...accion(suelta, "receptor"),
    ],
    destello: { t0: suelta, x: xB, y: suelo(yB) },
  };
}

export default function CapaRelevos({ relevos, geometria, residentes = [], nombres = false, onTocar, onPaso }: {
  relevos: Relevo[];
  geometria: Geometria | null;
  /** Cada persona en su puesto, quieta; se oculta mientras le toca actuar (se la reconoce por el nombre). */
  residentes?: Residente[];
  /** Mostrar el nombre de cada persona sobre su cabeza. */
  nombres?: boolean;
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
      } else if (lista.length && !p) {
        // Un relevo que no se pudo planear (su piso no está medido): se salta.
        estado.current = { ...e, i: (e.i + 1) % lista.length, t0: ahoraMs };
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

  const muñeco = (clave: string, actor: Actor, x: number, y: number, xAntes: number, relevo?: string, burbuja?: Burbuja) => {
    const anda = Math.abs(x - xAntes) > 0.5;
    const alto = altoDe(actor);
    const dibujo = <Sprite s={actor.figura ?? "jugador"} px={3} colores={actor.colores ?? { X: actor.color }} />;
    const voltea = { transform: x < xAntes ? "scaleX(-1)" : undefined };
    return (
      <div key={clave} className={`rl-actor ${anda ? "rl-anda" : ""}`}
           style={{ transform: `translate(${Math.round(x / 2) * 2 - 12}px, ${Math.round(y) - alto}px)` }}>
        {burbuja && <span className={`rl-burbuja ${burbuja.accion ? "rl-accion" : ""}`}>{burbuja.texto}</span>}
        {nombres && actor.nombre && <span className="rl-nombre">{actor.nombre}</span>}
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
  const actuando = new Set<string>();
  if (activo && actual) {
    const burb = (quien: "emisor" | "receptor") => activo.burbujas.find((b) => b.quien === quien && t >= b.t0 && t <= b.t1);
    const pos = (p: Pista) => ({ x: interp(p.kx, t), xa: interp(p.kx, t - 90), y: p.ky ? interp(p.ky, t) : pisoY(p.piso)! });
    const e = pos(activo.emisor);
    piezas.push(muñeco("emisor", actual.emisor, e.x, e.y, e.xa, actual.id, burb("emisor")));
    if (actual.emisor.nombre) actuando.add(actual.emisor.nombre);
    if (activo.receptor) {
      const rr = pos(activo.receptor);
      piezas.push(muñeco("receptor", actual.receptor, rr.x, rr.y, rr.xa, actual.id, burb("receptor")));
      if (actual.receptor.nombre) actuando.add(actual.receptor.nombre);
    }
    if (t <= activo.caja.hasta) {
      const c = interpCaja(activo.caja.k, t);
      piezas.push(
        <div key="caja" className="rl-caja" style={{ transform: `translate(${Math.round(c.x / 2) * 2 - 8}px, ${Math.round(c.y) - 14}px)` }}>
          <Sprite s={SPRITES[actual.carga] ?? SPRITES.caja} px={2} />
          {actual.etiqueta && <span className="rl-etq">{actual.etiqueta}</span>}
        </div>,
      );
    } else if (t <= activo.destello.t0 + 500) {
      piezas.push(<div key="destello" className="rl-destello" style={{ transform: `translate(${activo.destello.x - 8}px, ${activo.destello.y - 22}px)` }}>
        <Sprite s="estrella" px={2} />
      </div>);
    }
  }
  // Los residentes: cada persona en su puesto, quieta, mientras no le toque actuar.
  for (const r of residentes) {
    if ((r.actor.nombre && actuando.has(r.actor.nombre)) || pisoY(r.piso) == null) continue;
    piezas.push(muñeco(`res-${r.id}`, r.actor, r.x, pisoY(r.piso)!, r.x));
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
