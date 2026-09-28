/**
 * El Edificio McKenna: la otra vista de la pantalla de inicio (26-sep-2026). La misma
 * aplicación que el tablero, dibujada como un diorama en corte, en pixel art: cada etapa
 * del negocio es un PISO, y la mercancía «sube» piso a piso — llega por el muelle de
 * Abastecer y termina en Contar; Dirigir es el último piso y Sistema el sótano. Se entra
 * por la recepción (Inicio), donde están Mi agenda y Mi ficha.
 *
 * Cada piso muestra sus ESTACIONES reales (mapa/operacionMcKenna.ts: recepción, bodega, dosificar,
 * empacar, lote, etiquetar, almacén, foto, pedidos, alistar, embalar, guía, transportadora, factura,
 * solicitud y aprobación del pago, Libro Mayor, análisis) con QUIEN LAS HACE de verdad
 * (/api/mapa-sistema/quien-hace, las mismas funciones de la ficha de rendimiento), y el recorrido
 * del día avanza de relevo en relevo (relevos/CapaRelevos): la materia prima se vuelve producto, el
 * producto paquete, y los papeles llegan a contabilidad.
 *
 * Lo demás que se mueve tampoco es decoración suelta: la sirena gira donde hay algo urgente, las
 * notas en la pared son lo detenido de verdad (/api/mapa-sistema/urgencias), tu muñeco
 * está en los pisos donde tienes solicitudes, y un piso donde no participas tiene las
 * luces apagadas (sin nombrar sus paneles, igual que el tablero).
 *
 * Los datos llegan ya calculados desde MapaVivo (mapaComun.tsx): el edificio y el tablero
 * no pueden contar cosas distintas. Tocar una estación sube el ascensor y abre el panel.
 * Con `prefers-reduced-motion` todo queda quieto.
 */
import "./mapa-edificio.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon, PanelIcon } from "../icons";
import { ORIGEN_APP } from "../lib/flujoApp";
import { PANEL_INFO } from "../lib/panelInfo";
import type { Panel } from "../stores/app";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { Sprite } from "./colaboradores/pixel";
import CapaRelevos, { type Actor, type Geometria, type Relevo, type Residente } from "./relevos/CapaRelevos";
import { ESTACIONES, RECORRIDO, type Estacion } from "./mapa/operacionMcKenna";
import { BotonMiFicha } from "./MiRendimiento";
import {
  COLOR, COLOR_DEF, SOTANO, pisosDelEdificio, placaDePiso, useInicio, type DatosEtapa, type DatosOrigen,
} from "./mapaComun";

// ─── Sprites propios del diorama (misma paleta PICO-8, letra = píxel) ──────────────────

/** Persona de perfil, mirando a la derecha (el ojo va a ese lado: al voltearla se nota). */
const CUERPO = [
  "..kkkk..", ".knnnnk.", ".kcckck.", ".kcccck.", "..kkkk..",
  ".kXXXXk.", "kXXXXXXk", "kcXXXXck", ".kXXXXk.", ".kBBBBk.",
];
const PASO_A = [...CUERPO, ".kk..kk.", "kk....kk"];
const PASO_B = [...CUERPO, "..kBBk..", "..kkkk.."];
/** Mujer: el pelo largo le cae por la espalda y lleva falda (mismo alto que el muñeco). */
const CUERPO_MUJER = [
  "..kkkk..", ".knnnnk.", "knncckck", "knncccck", "knnkkkk.",
  "knXXXXk.", "kXXXXXXk", "kcXXXXck", ".kXXXXk.", "kXXXXXXk",
];
const MUJER_A = [...CUERPO_MUJER, ".kc..ck.", "kk....kk"];
const MUJER_B = [...CUERPO_MUJER, "..kcck..", "..kkkk.."];
/** Princesa: corona con gema, pelo rubio y vestido largo hasta el piso (asoman los zapatos). */
const CORONA = ["..y..y..", "..yryy.."];
const VESTIDO = [...CORONA, ...CUERPO_MUJER, "kXXXXXXk", "kPPPPPPk"];
const PRINCESA_A = [...VESTIDO, "kk....kk"];
const PRINCESA_B = [...VESTIDO, "..kkkk.."];
const FIGURAS = {
  hombre: [PASO_A, PASO_B],
  mujer: [MUJER_A, MUJER_B],
  princesa: [PRINCESA_A, PRINCESA_B],
} as const;
type Figura = keyof typeof FIGURAS;

const CAJA = ["kkkkkkkk", "knnnonnk", "knnnonnk", "kkkkkkkk", "knnnnnnk", "knnnnnnk", "kkkkkkkk"];
const FRASCO = ["..kkkk..", "..kssk..", ".kkkkkk.", "kwwwwwwk", "kwbbbbwk", "kwbbbbwk", "kwwwwwwk", ".kkkkkk."];
const PLANTA = ["..g..g..", ".gGg.gG.", "..gGgG..", "...GG...", "..kkkk..", ".knnnnk.", ".knnnnk.", "..kkkk.."];
const IMPRESORA = ["..kkkkkk..", "..kwwwwk..", "kkkkkkkkkk", "kssssssssk", "ksssssgssk", "kkkkkkkkkk", "kSSSSSSSSk", "kkkkkkkkkk"];
const CAMARA = ["...kkk....", "kkkkkkkkkk", "kSSSkkkSSk", "kSSkbbkSSk", "kSSkbbkSSk", "kSSSkkkSSk", "kkkkkkkkkk"];
const SIRENA = ["...kk...", "..krrk..", ".krwrrk.", ".krrrrk.", "kkkkkkkk"];
const NUBE = ["....wwww......", "..wwwwwwww....", ".wwwwwwwwwwww.", "wwwwwwwwwwwwww", "..ssssssssss.."];
const PAJARO = ["k...k", ".k.k.", "..k.."];
const ROBOT = ["..kkkk..", ".kssssk.", ".ksbsbk.", ".kssssk.", "..kkkk..", "kkssssk.", "k.kssk.k", "..k..k.."];

/** Colores de camisa y pelo del equipo del edificio (se reparten por piso para variar). */
const CAMISAS = ["#29ADFF", "#FF004D", "#00E436", "#FFA300", "#FF77A8", "#83769C", "#FFEC27"];
const PELOS = ["#AB5236", "#000000", "#5F574F", "#FFA300"];

type Var = CSSProperties & Record<`--${string}`, string | number>;

// ─── Las estaciones de la operación (mapa/operacionMcKenna.ts) ──────────────────────────
const BASCULA = ["..kkkk..", "..kwwk..", "kkkkkkkk", "kssssssk", "ksgssssk", "kkkkkkkk"];
const SELLADORA = ["kkkkkkkkkk", "kSSSSSSSSk", "kkkkkkkkkk", "....kk....", "..kkkkkk..", "..kssssk..", "..kkkkkk.."];
const SELLO = ["..kkkk..", "..krrk..", "..krrk..", ".kkkkkk.", "krrrrrrk", "kkkkkkkk"];
const TELEFONO = ["kkkkkk", "kbbbbk", "kbwwbk", "kbbbbk", "kSSSSk", "kkkkkk"];
const CANASTA = ["k......k", "kkkkkkkk", "knknknkk", "kkkkkkkk", "knknknkk", ".kkkkkk."];
const TERMICA = ["..kkkkk...", "..kwwwk...", "kkkkkkkkkk", "kssssssssk", "ksssgssssk", "kkkkkkkkkk"];
const LIBRO = ["kkkkkkkk", "kPPPPPwk", "kPyyPPwk", "kPPPPPwk", "kPPPPPwk", "kkkkkkkk"];
const SACO = ["..kkkk..", ".knkknk.", "knnnnnnk", "knnwwnnk", "knnnnnnk", ".kkkkkk."];
const BOLSA_LISTA = ["kkkkkkkk", "kssssssk", ".kwwwwk.", ".kyyyyk.", ".kbbbbk.", ".kkkkkk."];

/** El objeto de cada estación: lo que la hace reconocible de un vistazo. */
function PropEstacion({ prop, sale }: { prop: Estacion["prop"]; sale?: boolean }) {
  switch (prop) {
    case "camion": return <span className={sale ? "ed-camion-parte inline-block" : "inline-block"}><Sprite s="camion" px={5} /></span>;
    case "mesa": return <span className="ed-op-mesa"><Sprite s="doc" px={2} /></span>;
    case "estante": return <span className="ed-op-estante">{[0, 1, 2, 3].map((k) => <Sprite key={k} s={SACO} px={2} />)}</span>;
    case "almacen": return <span className="ed-op-estante ed-op-almacen">{[0, 1, 2, 3, 4, 5].map((k) => <Sprite key={k} s={BOLSA_LISTA} px={2} />)}</span>;
    case "bascula": return <Sprite s={BASCULA} px={3} />;
    case "selladora": return <Sprite s={SELLADORA} px={3} />;
    case "sello": return <Sprite s={SELLO} px={3} />;
    case "impresora": return <span className="ed-impresora"><span className="ed-hoja"><Sprite s="doc" px={2} /></span><Sprite s={IMPRESORA} px={3} /></span>;
    case "termica": return <Sprite s={TERMICA} px={3} />;
    case "camara": return <span className="ed-tripode"><Sprite s={CAMARA} px={3} /></span>;
    case "pantalla": return <span className="ed-pantalla"><Sprite s="ventana" px={4} /></span>;
    case "telefono": return <span className="ed-op-telefono"><Sprite s={TELEFONO} px={3} /><span className="ed-op-timbre" /></span>;
    case "canasta": return <Sprite s={CANASTA} px={3} />;
    case "cajas": return <span className="ed-op-cajas">{[0, 1, 2].map((k) => <Sprite key={k} s={CAJA} px={2} />)}</span>;
    case "escritorio": return <span className="ed-escritorio ed-op-escritorio" />;
    case "libro": return <Sprite s={LIBRO} px={3} />;
    case "grafica": return <span className="ed-grafica ed-op-grafica">{[0, 1, 2, 3, 4].map((k) => <span key={k} style={{ "--retraso": `${-k * 0.6}s` } as Var} />)}</span>;
    default: return <Sprite s="bloques" px={3} />;
  }
}

/** Colores de las personas del equipo (estables por id). */
const COLOR_PERSONA = ["#29ADFF", "#FF004D", "#00E436", "#FFA300", "#FF77A8", "#83769C", "#FFEC27", "#AB5236"];
type Persona = { id: number; nombre: string; peso: number };
const actorDe = (p: Persona): Actor => ({ color: COLOR_PERSONA[p.id % COLOR_PERSONA.length], nombre: p.nombre });
const EXTERNO: Actor = { color: "#5F574F", nombre: "Proveedor" };

/** Un objeto quieto sobre el piso, a `x`% del borde izquierdo. */
function Cosa({ x, children, className, abajo = 6 }: { x: number; children?: ReactNode; className?: string; abajo?: number }) {
  return <div className={`ed-cosa ${className ?? ""}`} style={{ left: `${x}%`, bottom: abajo }} aria-hidden="true">{children}</div>;
}

/** Lo que pasa en cada piso. Cada escena cuenta, a su manera, qué se hace ahí. */
/** Las estaciones de un piso, con su letrero y su objeto. */
function EstacionesDelPiso({ piso, camionSale }: { piso: string; camionSale: boolean }) {
  return (<>
    {piso === "dirigir" && <div className="ed-ciudad" aria-hidden="true" />}
    {ESTACIONES.filter((e) => e.piso === piso).map((e) => (
      <div key={e.id} className="ed-op" data-estacion={e.id} style={{ left: `${e.x * 100}%` }} title={e.hace}>
        <span className="ed-op-letrero">{e.nombre}</span>
        <PropEstacion prop={e.prop} sale={e.id === "transportadora" && camionSale} />
      </div>
    ))}
  </>);
}

/** Lo que pasa en el sótano (y en cualquier piso sin estaciones). */
function Escena({ id }: { id: string }) {
  switch (id) {
    case "sistema": // el sótano: los servidores parpadean y el robot hace la ronda
      return (<>
        {[6, 16, 26, 74, 84].map((x, k) => (
          <Cosa key={x} x={x} className="ed-rack"><span style={{ "--retraso": `${-k * 0.37}s` } as Var} /></Cosa>
        ))}
        <div className="ed-andante ed-robot" style={{ "--dur": "16s", "--retraso": "0s", "--desde": "34cqw", "--hasta": "62cqw" } as Var} aria-hidden="true">
          <div className="ed-voltea"><Sprite s={ROBOT} px={3} /></div>
        </div>
      </>);
    default:
      return null;
  }
}

// ─── El edificio ───────────────────────────────────────────────────────────────────────

export default function MapaEdificio({ cartas, origen, vertical, onAbrir }: {
  cartas: DatosEtapa[];
  origen: DatosOrigen;
  vertical: boolean;
  onAbrir: (p: Panel) => void;
}) {
  const porId = new Map(cartas.map((c) => [c.etapa.id, c]));
  const pisos = pisosDelEdificio(cartas.map((c) => c.etapa.id));
  const numero = (id: string) => placaDePiso(id) ?? "";

  const torre = useRef<HTMLDivElement>(null);
  const cielo = useRef<HTMLDivElement>(null);
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const reducir = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // La torre medida (suelo de cada piso, puerta del ascensor, x de cada estación) para los relevos.
  const [geo, setGeo] = useState<{ g: Geometria; estaciones: Record<string, { x: number; piso: string }> } | null>(null);
  const [llegando, setLlegando] = useState<string | null>(null);
  const [camionSale, setCamionSale] = useState(false);
  const medir = useCallback(() => {
    const t = torre.current;
    if (!t) return;
    const tr = t.getBoundingClientRect();
    const pisosG: Geometria["pisos"] = {};
    const estaciones: Record<string, { x: number; piso: string }> = {};
    let puertaX = tr.width - 29;
    t.querySelectorAll<HTMLElement>("section[data-etapa]").forEach((el) => {
      const r = el.getBoundingClientRect();
      const id = el.dataset.etapa!;
      pisosG[id] = { suelo: r.bottom - tr.top - 16 };
      el.querySelectorAll<HTMLElement>("[data-estacion]").forEach((est) => {
        const e = est.getBoundingClientRect();
        estaciones[est.dataset.estacion!] = { x: e.left - tr.left + e.width / 2, piso: id };
      });
      const hueco = el.querySelector<HTMLElement>(".ed-hueco")?.getBoundingClientRect();
      if (hueco && hueco.width) puertaX = hueco.left - tr.left + hueco.width / 2;
    });
    setGeo({ g: { pisos: pisosG, puertaX }, estaciones });
  }, []);
  useLayoutEffect(() => { medir(); }, [medir, cartas, vertical]);
  useEffect(() => {
    const t = torre.current;
    if (!t) return;
    let cuadro = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(cuadro); cuadro = requestAnimationFrame(medir); });
    ro.observe(t);
    return () => { ro.disconnect(); cancelAnimationFrame(cuadro); };
  }, [medir]);

  // Quién hace cada función (las mismas de la ficha de rendimiento): así cada estación tiene a su gente.
  const quien = useQuery<{ funciones: Record<string, Persona[]> }>({
    queryKey: ["mapa-quien-hace"],
    queryFn: () => api.get("/api/mapa-sistema/quien-hace"),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const personaDe = useCallback((e?: Estacion): Persona | undefined =>
    e?.funcion ? quien.data?.funciones[e.funcion]?.[0] : undefined, [quien.data]);

  // El recorrido del día como relevos: de estación en estación, con quien de verdad lo hace.
  const relevos = useMemo<Relevo[]>(() => {
    if (!geo) return [];
    const est = new Map(ESTACIONES.map((e) => [e.id, e]));
    return RECORRIDO.flatMap((p, i): Relevo[] => {
      const a = geo.estaciones[p.de], b = geo.estaciones[p.a];
      if (!a || !b) return [];
      const de = est.get(p.de), hacia = est.get(p.a);
      const quienEnvia = de?.externo ? { ...EXTERNO, nombre: de.externo } : personaDe(de) ? actorDe(personaDe(de)!) : { color: "#83769C" };
      const quienRecibe = personaDe(hacia) ? actorDe(personaDe(hacia)!) : { color: "#83769C" };
      return [{ id: `${p.de}>${p.a}#${i}`, desde: a, hasta: b, carga: p.carga, etiqueta: p.etiqueta, accion: p.accion,
                emisor: quienEnvia, receptor: quienRecibe }];
    });
  }, [geo, personaDe]);

  // Cada persona, quieta en su puesto principal: la estación de la función que más hace.
  const residentes = useMemo<Residente[]>(() => {
    if (!geo) return [];
    const mejor = new Map<number, { e: Estacion; peso: number; p: Persona }>();
    for (const e of ESTACIONES) {
      for (const p of (e.funcion ? quien.data?.funciones[e.funcion] : undefined) ?? []) {
        const actual = mejor.get(p.id);
        if (!actual || p.peso > actual.peso) mejor.set(p.id, { e, peso: p.peso, p });
      }
    }
    return [...mejor.values()].flatMap(({ e, p }) => {
      const pos = geo.estaciones[e.id];
      return pos ? [{ id: String(p.id), x: pos.x + 38, piso: pos.piso, actor: actorDe(p) }] : [];   // al lado de su estación, sin tapar el letrero
    });
  }, [geo, quien.data]);

  // Cuando el paquete con guía llega a la transportadora, el camión arranca a repartir (y vuelve).
  const alPaso = useCallback((id: string) => {
    if (id.startsWith("guia>transportadora")) { setCamionSale(true); window.setTimeout(() => setCamionSale(false), 3600); }
  }, []);

  // Se entra por la recepción: la primera vez el edificio se muestra con la planta baja a la vista.
  useLayoutEffect(() => {
    const c = cielo.current, r = refs.current.inicio;
    if (c && r) c.scrollTop = Math.max(0, r.offsetTop + r.offsetHeight - c.clientHeight + 150);
  }, []);

  const ir = useCallback((piso: string, p: Panel) => {
    if (reducir) { onAbrir(p); return; }
    setLlegando(piso);                              // el piso destella y se abre el panel
    window.setTimeout(() => onAbrir(p), 300);
  }, [reducir, onAbrir]);

  const inicio = useInicio((p) => ir("inicio", p));

  const estacion = (d: DatosEtapa, p: Panel, hace: string, tramo: string) => {
    const u = d.urgentes[p];
    return (
      <button key={p} type="button" data-panel={p} className={`ed-estacion ${u ? "ed-urgente" : ""}`}
              onClick={() => ir(d.etapa.id, p)} title={u ? `Urgente — ${u.porque.join(" · ")}` : `${tramo} — ${hace}`}>
        <PanelIcon panel={p} size={18} bubble={false} />
        <span className="min-w-0 truncate">{PANEL_INFO[p]?.label ?? p}</span>
        {u && <span className="ed-urg-n" aria-label={`${u.n} urgentes`}>! {u.n}</span>}
      </button>
    );
  };

  const piso = (id: string, sotano = false) => {
    const d = porId.get(id)!;
    const c = COLOR[id] ?? COLOR_DEF;
    const urgente = Object.keys(d.urgentes).length > 0;
    const alta = d.bloqueos?.alta ?? 0;
    const notas = (d.bloqueos?.items ?? []).slice(0, vertical ? 1 : 2);
    return (
      <section key={id} ref={(el) => { refs.current[id] = el; }}
               className={`ed-piso ${sotano ? "ed-sotano" : ""} ${d.participa ? "" : "ed-apagado"} ${llegando === id ? "ed-llega" : ""}`}
               data-etapa={id} data-urgente={urgente ? "1" : undefined}
               style={{ "--fondo": c.fondo, "--tinta": c.tinta } as Var} aria-label={`${sotano ? "Sótano" : `Piso ${numero(id)}`} · ${d.etapa.titulo}`}>
        <header className="ed-placa">
          <span className="ed-numero">{numero(id)}</span>
          <div className="min-w-0">
            <p className="ed-titulo"><Sprite s={c.s} px={2} /> {d.etapa.titulo}</p>
            <p className="ed-pregunta">{d.etapa.pregunta}</p>
            <p className="flex flex-wrap gap-1">
              {d.mias > 0 && <span className="ed-insignia ed-tuyas" title="Solicitudes tuyas en este piso">TÚ {d.mias}</span>}
              {alta > 0 && <span className="ed-insignia ed-alta" title="Detenido: urgente">! {alta}</span>}
            </p>
          </div>
        </header>
        <div className="ed-sala">
          <div className="ed-pared">
            {d.participa ? (<>
              {d.guia && d.etapa.guia && (
                <button type="button" className="ed-estacion ed-guia" onClick={() => ir(id, d.etapa.guia!.abre)} title={d.etapa.guia.hace}>
                  ▶ {d.etapa.guia.titulo}
                </button>
              )}
              {d.tramos.flatMap((t) => t.visibles.map((p) => estacion(d, p.panel, p.hace, t.titulo)))}
              {notas.map((b, i) => (
                <button key={`${b.id}-${i}`} type="button" className={`ed-nota ${b.severidad === "alta" ? "ed-nota-alta" : ""}`}
                        onClick={() => ir(id, b.panel as Panel)} title="Lo que está detenido ahora">
                  <b>{b.n}</b> {b.texto}
                </button>
              ))}
            </>) : (
              <p className="ed-luces">Luces apagadas: no participas en este piso.</p>
            )}
          </div>
          <div className="ed-suelo">
            {ESTACIONES.some((e) => e.piso === id)
              ? <EstacionesDelPiso piso={id} camionSale={camionSale} />
              : <Escena id={id} />}
          </div>
          {urgente && <div className="ed-sirena" aria-hidden="true"><Sprite s={SIRENA} px={3} /></div>}
        </div>
        <div className="ed-hueco" aria-hidden="true" />
        {/* El sótano está bajo tierra: el césped y la tierra siguen a los lados del edificio. */}
        {sotano && <><span className="ed-cesped ed-cesped-izq" aria-hidden="true" /><span className="ed-cesped ed-cesped-der" aria-hidden="true" /></>}
      </section>
    );
  };

  return (
    <div ref={cielo} className="ed-cielo min-h-0 flex-1">
      <div className="ed-nubes" aria-hidden="true">
        <Sprite s={NUBE} px={5} className="ed-nube" />
        <Sprite s={NUBE} px={4} className="ed-nube ed-nube-2" />
        <Sprite s={NUBE} px={6} className="ed-nube ed-nube-3" />
        <Sprite s={PAJARO} px={3} className="ed-pajaro" />
      </div>
      <div ref={torre} className="ed-torre">
        <div className="ed-techo">
          <span className="ed-antena" aria-hidden="true" />
          <span className="ed-letrero">McKenna Group</span>
          <Sprite s="bandera" px={4} className="ed-bandera" />
        </div>

        {pisos.map((id) => piso(id))}

        {/* Planta baja: la recepción. Aquí empieza el día de cada quien. */}
        <section ref={(el) => { refs.current.inicio = el; }} className={`ed-piso ed-recepcion ${llegando === "inicio" ? "ed-llega" : ""}`}
                 data-etapa="inicio" style={{ "--fondo": "var(--ed-amarillo, #FFEC27)", "--tinta": "var(--ed-negro, #000)" } as Var} aria-label="Planta baja · Inicio">
          <header className="ed-placa">
            <span className="ed-numero">PB</span>
            <div className="min-w-0">
              <p className="ed-titulo"><Sprite s="jugador" px={2} colores={{ X: "#29ADFF" }} /> Inicio</p>
              <p className="ed-pregunta">Hola, {origen.nombre}. Aquí empieza tu día.</p>
              <p className="ed-cifras">
                <span><Sprite s="urna" px={2} /> {origen.pedidas} te pidieron</span>
                {origen.urgentes > 0 && <span className="ed-cifra-urgente"><Sprite s="alerta" px={2} /> {origen.urgentes} urgente{origen.urgentes === 1 ? "" : "s"}</span>}
                <span><Sprite s="reloj" px={2} /> {origen.recordatorios} hoy</span>
              </p>
            </div>
          </header>
          <div className="ed-sala">
            <div className="ed-pared">
              {inicio.token && <BotonMiFicha token={inicio.token} className="ed-estacion ed-ficha" />}
              {origen.puede && inicio.verMensajes && (
                <button type="button" className="ed-estacion" data-panel={ORIGEN_APP.panel} data-vista="mensajes" onClick={() => inicio.vistaAgenda("mensajes")}>
                  <PanelIcon panel="tickets" size={18} bubble={false} /> Mensajes
                </button>
              )}
              {origen.puede && (
                <button type="button" className="ed-estacion" data-panel={ORIGEN_APP.panel} data-vista="recordatorios" onClick={() => inicio.irAcciones("agenda")}>
                  <Icon name="bell" size={18} weight="bold" /> Recordatorios
                </button>
              )}
              {origen.puede && (
                <button type="button" className="ed-estacion" data-panel={ORIGEN_APP.panel} data-vista="notas" onClick={() => inicio.irAcciones("notas")}>
                  <Icon name="note" size={18} weight="bold" /> Notas
                </button>
              )}
              {inicio.espacios.map((p) => (
                <button key={p} type="button" className="ed-estacion" data-panel={p} onClick={() => ir("inicio", p)}>
                  <PanelIcon panel={p} size={18} bubble={false} /> <span className="truncate">{PANEL_INFO[p]?.label ?? p}</span>
                </button>
              ))}
            </div>
            <div className="ed-suelo">
              <Cosa x={4} className="ed-puerta" />
              <Cosa x={20}><Sprite s={PLANTA} px={3} /></Cosa>
              <Cosa x={44} className="ed-recepcion-mesa" />
              <div className="ed-tu ed-tu-recepcion" aria-hidden="true">
                <Sprite s="jugador" px={4} colores={{ X: "#29ADFF" }} />
              </div>
              {/* La recepcionista, en su puesto (antes caminaba sin rumbo). */}
              <Cosa x={34}><Sprite s={MUJER_A} px={3} colores={{ X: CAMISAS[4], n: PELOS[0] }} /></Cosa>
              <Cosa x={90}><Sprite s={PLANTA} px={3} /></Cosa>
            </div>
          </div>
          <div className="ed-hueco" aria-hidden="true" />
        </section>

        {porId.has(SOTANO) && piso(SOTANO, true)}

        {/* La cadena del negocio: de mano en mano en cada piso, por el ascensor entre pisos. */}
        <CapaRelevos relevos={relevos} geometria={geo?.g ?? null} residentes={residentes} onPaso={alPaso} nombres />
      </div>
    </div>
  );
}
