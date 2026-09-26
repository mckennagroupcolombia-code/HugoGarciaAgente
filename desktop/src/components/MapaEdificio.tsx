/**
 * El Edificio McKenna: la otra vista de la pantalla de inicio (26-sep-2026). La misma
 * aplicación que el tablero, dibujada como un diorama en corte, en pixel art: cada etapa
 * del negocio es un PISO, y la mercancía «sube» piso a piso — llega por el muelle de
 * Abastecer y termina en Contar; Dirigir es el último piso y Sistema el sótano. Se entra
 * por la recepción (Inicio), donde están Mi agenda y Mi ficha.
 *
 * Lo que se ve moverse NO es decoración suelta: la sirena gira donde hay algo urgente, las
 * notas en la pared son lo detenido de verdad (/api/mapa-sistema/urgencias), tu muñeco
 * está en los pisos donde tienes solicitudes, y un piso donde no participas tiene las
 * luces apagadas (sin nombrar sus paneles, igual que el tablero).
 *
 * Los datos llegan ya calculados desde MapaVivo (mapaComun.tsx): el edificio y el tablero
 * no pueden contar cosas distintas. Tocar una estación sube el ascensor y abre el panel.
 * Con `prefers-reduced-motion` todo queda quieto.
 */
import "./mapa-edificio.css";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PanelIcon } from "../icons";
import { ORIGEN_APP } from "../lib/flujoApp";
import { PANEL_INFO } from "../lib/panelInfo";
import type { Panel } from "../stores/app";
import { Sprite } from "./colaboradores/pixel";
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

/** Alguien que camina de un lado al otro del piso (dos cuadros de paso, como un juego de 8 bits). */
function Andante({ i, dur = 12, retraso = 0, desde = 4, hasta = 70, carga, figura = "hombre" }: {
  i: number; dur?: number; retraso?: number; desde?: number; hasta?: number; carga?: string[]; figura?: Figura;
}) {
  const colores = figura === "princesa"
    ? { X: "#FF77A8", n: "#FFEC27" } // vestido rosado y pelo rubio, siempre
    : { X: CAMISAS[i % CAMISAS.length], n: PELOS[i % PELOS.length] };
  const [pasoA, pasoB] = FIGURAS[figura];
  const estilo: Var = { "--dur": `${dur}s`, "--retraso": `${-retraso}s`, "--desde": `${desde}cqw`, "--hasta": `${hasta}cqw` };
  return (
    <div className="ed-andante" style={estilo} aria-hidden="true">
      <div className="ed-voltea">
        <div className="ed-pasos">
          <Sprite s={pasoA} px={3} colores={colores} className="ed-paso-a" />
          <Sprite s={pasoB} px={3} colores={colores} className="ed-paso-b" />
        </div>
        {carga && <Sprite s={carga} px={2} className="ed-carga" />}
      </div>
    </div>
  );
}

/** Un objeto quieto sobre el piso, a `x`% del borde izquierdo. */
function Cosa({ x, children, className, abajo = 6 }: { x: number; children?: ReactNode; className?: string; abajo?: number }) {
  return <div className={`ed-cosa ${className ?? ""}`} style={{ left: `${x}%`, bottom: abajo }} aria-hidden="true">{children}</div>;
}

/** Lo que pasa en cada piso. Cada escena cuenta, a su manera, qué se hace ahí. */
function Escena({ id }: { id: string }) {
  switch (id) {
    case "abastecer": // el muelle de carga: llega el camión y se descargan cajas
      return (<>
        <div className="ed-camion-llega"><Sprite s="camion" px={5} /></div>
        <Cosa x={44}><Sprite s={CAJA} px={3} /></Cosa>
        <Cosa x={48}><Sprite s={CAJA} px={3} /></Cosa>
        <Cosa x={46} abajo={27}><Sprite s={CAJA} px={3} /></Cosa>
        <Andante i={3} dur={9} desde={20} hasta={40} carga={CAJA} />
        <Cosa x={88}><Sprite s="cofre" px={4} /></Cosa>
      </>);
    case "preparar": // el taller: la cinta lleva frascos a llenar y etiquetar
      return (<>
        <div className="ed-cinta" style={{ left: "22%", width: "46%" }}>
          <div className="ed-sobre-cinta">
            {[0, 1, 2, 3].map((k) => <div key={k} className="ed-viaja" style={{ "--retraso": `${-k * 1.5}s` } as Var}><Sprite s={FRASCO} px={2} /></div>)}
          </div>
        </div>
        <Cosa x={70} className="ed-maquina"><span className="ed-luz ed-luz-verde" /></Cosa>
        <Andante i={1} dur={14} desde={2} hasta={16} figura="mujer" />
        <Cosa x={88}><Sprite s="bloques" px={4} /></Cosa>
      </>);
    case "publicar": // el estudio: la cámara dispara al producto y las pantallas se encienden
      return (<>
        <div className="ed-flash" />
        <Cosa x={16} className="ed-tripode"><Sprite s={CAMARA} px={3} /></Cosa>
        <Cosa x={30} className="ed-pedestal"><Sprite s={FRASCO} px={3} /></Cosa>
        <Cosa x={52} abajo={18} className="ed-pantalla"><Sprite s="ventana" px={4} /></Cosa>
        <Cosa x={62} abajo={18} className="ed-pantalla ed-pantalla-2"><Sprite s="ventana" px={4} /></Cosa>
        <Andante i={4} dur={11} desde={72} hasta={90} />
      </>);
    case "vender": // la tienda: clientes entran, el mostrador suelta monedas
      return (<>
        <Cosa x={34} className="ed-mostrador" />
        {[0, 1, 2].map((k) => (
          <div key={k} className="ed-moneda" style={{ left: `${37 + k * 4}%`, "--retraso": `${-k * 0.7}s` } as Var} aria-hidden="true">
            <Sprite s="moneda" px={2} />
          </div>
        ))}
        <Andante i={0} dur={10} desde={52} hasta={86} />
        <Andante i={5} dur={13} retraso={5} desde={50} hasta={80} figura="mujer" carga={["..k..k..", "...kk...", "..kook..", ".kooyok.", "kooyyook", "koooyook", "kooyyook", ".kkkkkk."]} />
        <Cosa x={6}><Sprite s={PLANTA} px={3} /></Cosa>
      </>);
    case "entregar": // despacho: las cajas bajan por la cinta y el camión sale a repartir
      return (<>
        <div className="ed-cinta" style={{ left: "4%", width: "34%" }}>
          <div className="ed-sobre-cinta">
            {[0, 1, 2].map((k) => <div key={k} className="ed-viaja" style={{ "--retraso": `${-k * 2}s` } as Var}><Sprite s={CAJA} px={2} /></div>)}
          </div>
        </div>
        <Andante i={2} dur={8} desde={40} hasta={52} carga={CAJA} />
        <div className="ed-camion-sale"><Sprite s="camion" px={5} /></div>
      </>);
    case "facturar": // la oficina de facturas: la impresora no para
      return (<>
        <Cosa x={12} className="ed-escritorio" />
        <Cosa x={14} abajo={30}><Sprite s="ventana" px={3} /></Cosa>
        <Cosa x={44} className="ed-impresora">
          <div className="ed-hoja"><Sprite s="doc" px={2} /></div>
          <Sprite s={IMPRESORA} px={3} />
        </Cosa>
        <Cosa x={52}><Sprite s="doc" px={2} /></Cosa>
        <Andante i={6} dur={12} desde={60} hasta={88} figura="mujer" />
      </>);
    case "contar": // contabilidad: la gráfica sube y baja, la calculadora trabaja
      return (<>
        <div className="ed-grafica" style={{ left: "8%" }} aria-hidden="true">
          {[0, 1, 2, 3, 4].map((k) => <span key={k} style={{ "--retraso": `${-k * 0.6}s` } as Var} />)}
        </div>
        <Cosa x={34} className="ed-escritorio" />
        <Cosa x={36} abajo={30}><Sprite s="datos" px={3} /></Cosa>
        <Andante i={3} dur={15} desde={50} hasta={88} carga={["kkkkkkkk", "kwwwwwwk", "kwSSSSwk", "kwwwwwwk", "kkkkkkkk"]} />
      </>);
    case "dirigir": // la última planta: vista a la ciudad, el trofeo, alguien pensando
      return (<>
        <div className="ed-ciudad" aria-hidden="true" />
        <Cosa x={8}><Sprite s="trofeo" px={4} /></Cosa>
        <Cosa x={60} className="ed-escritorio ed-escritorio-grande" />
        <Andante i={4} dur={18} desde={16} hasta={52} figura="princesa" />
        <Cosa x={90}><Sprite s={PLANTA} px={3} /></Cosa>
      </>);
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
      return <Andante i={0} dur={12} />;
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

  // El ascensor: pasea solo entre los pisos donde participas; al tocar una estación va a ese piso.
  const [cabina, setCabina] = useState<{ top: number; piso: string } | null>(null);
  const [llegando, setLlegando] = useState<string | null>(null);
  const moverA = useCallback((piso: string) => {
    const el = refs.current[piso];
    if (el) setCabina({ top: el.offsetTop + el.offsetHeight - 58, piso });
  }, []);
  const activos = [...pisos, "inicio", SOTANO].filter((id) => id === "inicio" || porId.get(id)?.participa);
  useEffect(() => {
    if (vertical) return;
    moverA("inicio");
    if (reducir) return;
    const t = window.setInterval(() => {
      if (llegando) return;
      moverA(activos[Math.floor(Math.random() * activos.length)]);
    }, 4200);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vertical, llegando, activos.join(",")]);

  // Se entra por la recepción: la primera vez el edificio se muestra con la planta baja a la vista.
  useLayoutEffect(() => {
    const c = cielo.current, r = refs.current.inicio;
    if (c && r) c.scrollTop = Math.max(0, r.offsetTop + r.offsetHeight - c.clientHeight + 150);
  }, []);

  const ir = useCallback((piso: string, p: Panel) => {
    if (vertical || reducir) { onAbrir(p); return; }
    setLlegando(piso);
    moverA(piso);
    window.setTimeout(() => onAbrir(p), 650);
  }, [vertical, reducir, onAbrir, moverA]);

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
              {notas.map((b) => (
                <button key={b.id} type="button" className={`ed-nota ${b.severidad === "alta" ? "ed-nota-alta" : ""}`}
                        onClick={() => ir(id, b.panel as Panel)} title="Lo que está detenido ahora">
                  <b>{b.n}</b> {b.texto}
                </button>
              ))}
            </>) : (
              <p className="ed-luces">Luces apagadas: no participas en este piso.</p>
            )}
          </div>
          <div className="ed-suelo">
            <Escena id={id} />
            {d.mias > 0 && (
              <div className="ed-tu" aria-hidden="true">
                <span className="ed-burbuja">TÚ</span>
                <Sprite s="jugador" px={3} colores={{ X: "#29ADFF" }} />
              </div>
            )}
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
              <Andante i={2} dur={10} desde={4} hasta={36} figura="mujer" />
              <Cosa x={90}><Sprite s={PLANTA} px={3} /></Cosa>
            </div>
          </div>
          <div className="ed-hueco" aria-hidden="true" />
        </section>

        {porId.has(SOTANO) && piso(SOTANO, true)}

        {!vertical && cabina && (
          <div className={`ed-cabina ${llegando ? "ed-cabina-llega" : ""}`} style={{ top: cabina.top }} aria-hidden="true">
            <span className="ed-puerta-cabina" /><span className="ed-puerta-cabina" />
          </div>
        )}
      </div>
    </div>
  );
}
