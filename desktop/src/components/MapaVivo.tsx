/**
 * Mapa vivo: TODA la aplicación en una sola pantalla, como un tablero de juego.
 *
 * Es la pantalla de inicio de todo el equipo (25-sep-2026). Dibuja la secuencia del
 * negocio —Mi agenda ⇢ Abastecer ⇢ Preparar ⇢ Publicar ⇢ Vender ⇢ Entregar ⇢ Facturar
 * ⇢ Contar, con Dirigir y Sistema acompañando— en un lienzo que se arrastra y se acerca,
 * con el mismo lenguaje pixel del tablero de Colaboradores.
 *
 * - La estructura NO vive aquí: sale de lib/flujoApp.ts (reordenar la app sigue siendo
 *   editar ese archivo) y cada panel aparece solo si esta persona lo puede abrir
 *   (lib/panelAccess, la misma regla del menú). Una etapa donde no participa se ve
 *   apagada, sin nombrar sus paneles.
 * - Lo vivo: lo que cada etapa tiene detenido (/api/mapa-sistema/bloqueos, solo a quien
 *   la API se lo responde) y las solicitudes asignadas a esta persona, ubicadas por
 *   etapa con lib/flujoTickets (reglas por título, sin IA). Donde hay algo suyo, la
 *   etapa brilla: es «tu camino de hoy».
 * - Tocar un panel acerca la cámara y lo abre de verdad; el interior de cada panel no
 *   cambia. Se vuelve con «◇ Mapa» del cabezote.
 */
import "@xyflow/react/dist/style.css";
import "./colaboradores/pixel.css";
import "./mapa-vivo.css";
import {
  Background, BackgroundVariant, BaseEdge, EdgeLabelRenderer, Handle, Position, ReactFlow, ReactFlowProvider,
  getStraightPath, useReactFlow,
  type Edge, type EdgeProps, type Node, type NodeChange, type NodeProps, type Viewport,
} from "@xyflow/react";
import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { PanelIcon } from "../icons";
import { ETAPAS_APP, ORIGEN_APP, type EtapaApp, type TramoApp } from "../lib/flujoApp";
import { etapaDeTicket } from "../lib/flujoTickets";
import { esAdminPanel, puedeVerSeccionPanel } from "../lib/panelAccess";
import { PANEL_INFO } from "../lib/panelInfo";
import { useAppStore, type Panel } from "../stores/app";
import { useTicketsAuth } from "../stores/ticketsAuth";
import { puedeVerTabInicio } from "./nav/InicioNavTabs";
import { Sprite } from "./colaboradores/pixel";
import {
  COLOR, COLOR_DEF, useInicio,
  type Bloqueos, type DatosEtapa, type DatosOrigen, type Urgencia,
} from "./mapaComun";
import { BotonMiFicha } from "./MiRendimiento";
import MapaEdificio from "./MapaEdificio";

// ─── Datos vivos ─────────────────────────────────────────────────────────────

type Ticket = { id: number; titulo?: string | null; categoria?: string | null; asignado_a?: number | null; prioridad?: string | null };
type Recordatorio = { id?: number; titulo?: string | null; proxima_fecha?: string | null };

/** Lo mismo que carga la Agenda (TicketsPanel.cargar), con el token de la persona. */
async function ticketsGet<T>(ruta: string, token: string): Promise<T> {
  const r = await fetch(`/api/tickets${ruta}${ruta.includes("?") ? "&" : "?"}_t=${Date.now()}`, {
    cache: "no-store", headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(String(r.status));
  return r.json() as Promise<T>;
}

// ─── Aspecto ─────────────────────────────────────────────────────────────────

const NIVELES = [
  { n: 0, titulo: "Etapas", ayuda: "Solo la secuencia y lo detenido" },
  { n: 1, titulo: "Cotidiano", ayuda: "Lo que se usa todos los días" },
  { n: 2, titulo: "Operación", ayuda: "La operación completa" },
  { n: 3, titulo: "Todo", ayuda: "Todo, con lo que hace cada panel y sus datos" },
] as const;
const CLAVE_NIVEL = "mck-mapa-vivo-nivel";
const CLAVE_VISTA = "mck-mapa-vivo-vista";
/** «mapa» (el tablero) o «edificio» (el diorama: cada etapa es un piso). */
const CLAVE_MODO = "mck-mapa-vivo-modo";

/** A partir de qué nivel aparece un panel (solo para administración: ve 61 paneles). */
function nivelDe(p: Panel): number {
  const t = PANEL_INFO[p]?.tier;
  return t === "core" ? 1 : t === "advanced" ? 3 : 2;
}
function leer(clave: string): string | null {
  try { return localStorage.getItem(clave); } catch { return null; }
}
function guardar(clave: string, v: string) {
  try { localStorage.setItem(clave, v); } catch { /* sin almacenamiento: vale por la visita */ }
}

// ─── Lo que cada carta necesita para dibujarse ───────────────────────────────

/** Abrir un panel desde una carta (la cámara se acerca y luego abre). */
const AbrirCtx = createContext<(p: Panel, nodoId: string) => void>(() => {});

/** Por dónde entra y sale la secuencia de cada carta (el camino da la vuelta entre filas). */
type Lados = { entra: Position; sale: Position };

function Manijas({ entra, sale }: Lados) {
  // A los lados, a la altura del título: con las cartas alineadas arriba, las flechas
  // de una misma fila quedan rectas aunque cada carta mida distinto.
  const estilo = (p: Position) => ({
    opacity: 0, width: 1, height: 1, border: 0, minWidth: 0, minHeight: 0,
    ...(p === Position.Left || p === Position.Right ? { top: 18 } : {}),
  });
  return (
    <>
      <Handle type="target" position={entra} style={estilo(entra)} isConnectable={false} />
      <Handle type="source" position={sale} style={estilo(sale)} isConnectable={false} />
    </>
  );
}

function CartaOrigen({ id, data }: NodeProps) {
  const d = data as DatosOrigen & Lados;
  const abrir = useContext(AbrirCtx);
  const { token, verMensajes, vistaAgenda, espacios } = useInicio((p) => abrir(p, id));
  return (
    <div className="mv-carta mv-origen">
      <Manijas entra={d.entra} sale={d.sale} />
      <div className="mv-cab" style={{ background: "#FFEC27", color: "#000" }}>
        <Sprite s="jugador" px={2} colores={{ X: "#29ADFF" }} /> Inicio
      </div>
      <div className="space-y-1 p-2">
        <p className="mv-nombre">{d.nombre}</p>
        <p className="mv-linea"><Sprite s="urna" px={2} /> {d.pedidas} te pidieron</p>
        {d.urgentes > 0 && (
          <p className="mv-linea mv-linea-urgente"><Sprite s="alerta" px={2} /> {d.urgentes} urgente{d.urgentes === 1 ? "" : "s"}</p>
        )}
        <p className="mv-linea"><Sprite s="reloj" px={2} /> {d.recordatorios} recordatorios hoy</p>
        {d.puede && (
          <button type="button" className="mv-btn nodrag nopan w-full" data-panel={ORIGEN_APP.panel}
                  onClick={() => vistaAgenda("home")}>
            ▶ {ORIGEN_APP.titulo}
          </button>
        )}
        {/* La ficha del mes de cada quien (Mi rendimiento), justo bajo su agenda. */}
        {token && <BotonMiFicha token={token} className="mv-btn mv-ficha nodrag nopan w-full" />}
        <div className="space-y-1">
          {d.puede && verMensajes && (
            <button type="button" className="mv-panel nodrag nopan" data-panel={ORIGEN_APP.panel} data-vista="mensajes"
                    onClick={() => vistaAgenda("mensajes")} title="Solicitudes y acciones, como un chat">
              <PanelIcon panel="tickets" size={18} bubble={false} />
              <span className="min-w-0 flex-1 truncate text-left">Mensajes</span>
            </button>
          )}
          {espacios.map((p) => (
            <button key={p} type="button" className="mv-panel nodrag nopan" data-panel={p} onClick={() => abrir(p, id)}>
              <PanelIcon panel={p} size={18} bubble={false} />
              <span className="min-w-0 flex-1 truncate text-left">{PANEL_INFO[p]?.label ?? p}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function CartaEtapa({ id, data }: NodeProps) {
  const d = data as DatosEtapa & Lados;
  const abrir = useContext(AbrirCtx);
  const c = COLOR[d.etapa.id] ?? COLOR_DEF;
  const alta = d.bloqueos?.alta ?? 0;
  const media = d.bloqueos?.media ?? 0;
  const hayUrgente = Object.keys(d.urgentes).length > 0;
  // En «Etapas» no se listan paneles… salvo los urgentes: lo urgente siempre se ve.
  const tramos = d.nivel > 0 ? d.tramos
    : d.tramos.map((t) => ({ ...t, visibles: t.visibles.filter((p) => d.urgentes[p.panel]) })).filter((t) => t.visibles.length);
  return (
    <div className={`mv-carta ${d.participa ? "" : "mv-apagada"} ${d.mias > 0 ? "mv-camino" : ""} ${hayUrgente ? "mv-hay-urgente" : ""} ${d.ancha ? "mv-ancha" : ""}`}
         data-urgente={hayUrgente ? "1" : undefined}>
      <Manijas entra={d.entra} sale={d.sale} />
      <div className="mv-cab" style={{ background: c.fondo, color: c.tinta }}>
        <Sprite s={c.s} px={2} />
        <span className="min-w-0 flex-1 truncate">{d.etapa.titulo}</span>
        {d.mias > 0 && <span className="mv-insignia mv-tuyas" title="Solicitudes tuyas en esta etapa">TÚ {d.mias}</span>}
        {alta > 0 && <span className="mv-insignia mv-alta" title="Detenido: urgente">! {alta}</span>}
        {media > 0 && <span className="mv-insignia mv-media" title="Detenido">{media}</span>}
      </div>
      <div className="p-2">
        <p className="mv-pregunta">{d.etapa.pregunta}</p>
        {!d.participa && <p className="mv-nota">No participas en esta etapa.</p>}
        {d.participa && d.guia && d.etapa.guia && (
          <button type="button" className="mv-btn mv-guia nodrag nopan" title={d.etapa.guia.hace}
                  onClick={() => abrir(d.etapa.guia!.abre, id)}>
            ▶ {d.etapa.guia.titulo}
          </button>
        )}
        {d.participa && tramos.length > 0 && (
          <div className={d.ancha ? "mv-tramos-anchos" : "space-y-2"}>
            {tramos.map((t, i) => (
              <div key={t.titulo} className="mv-tramo">
                <p className="mv-tramo-t">{i + 1} · {t.titulo}</p>
                {d.nivel >= 3 && t.datos.length > 0 && <p className="mv-datos">{t.datos.join(" · ")}</p>}
                <div className="mt-1 space-y-1">
                  {t.visibles.map((p) => {
                    const u = d.urgentes[p.panel];
                    return (
                      <button key={p.panel} type="button" className={`mv-panel nodrag nopan ${u ? "mv-urgente" : ""}`}
                              data-panel={p.panel} onClick={() => abrir(p.panel, id)}
                              title={u ? `Urgente — ${u.porque.join(" · ")}` : p.hace}>
                        <PanelIcon panel={p.panel} size={18} bubble={false} />
                        <span className="min-w-0 flex-1 text-left">
                          <span className="block truncate">{PANEL_INFO[p.panel]?.label ?? p.panel}</span>
                          {d.nivel >= 3 && <span className="mv-hace">{p.hace}</span>}
                        </span>
                        {u && <span className="mv-urg-n" aria-label={`${u.n} urgentes`}>! {u.n}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        {d.participa && d.nivel >= 3 && (d.bloqueos?.items.length ?? 0) > 0 && (
          <div className="mv-detenido">
            <p className="mv-tramo-t">Detenido ahora</p>
            {d.bloqueos!.items.slice(0, 3).map((b) => (
              <button key={b.id} type="button" className="mv-bloqueo nodrag nopan" onClick={() => abrir(b.panel as Panel, id)}>
                <b>{b.n}</b> {b.texto}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Flecha entre etapas: lo que una le entrega a la otra. Etiqueta en HTML (se ajusta a la fuente). */
function Entrega({ id, sourceX, sourceY, targetX, targetY, label, data }: EdgeProps) {
  const [ruta, lx, ly] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const apagada = Boolean((data as { apagada?: boolean } | undefined)?.apagada);
  return (
    <>
      <BaseEdge id={id} path={ruta} className={apagada ? "mv-flecha mv-flecha-apagada" : "mv-flecha"}
                markerEnd="url(#mv-punta)" />
      {label ? (
        <EdgeLabelRenderer>
          <div className="mv-etq" style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}>{label}</div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const TIPOS_NODO = { origen: CartaOrigen, etapa: CartaEtapa };
const TIPOS_FLECHA = { entrega: Entrega };

// ─── El mapa ─────────────────────────────────────────────────────────────────

const ANCHO = 300;
const ANCHO_ORIGEN = 230;
const SEP_X = 130;            // cabe la etiqueta de la flecha («producto listo») sin tapar cartas
const SEP_Y = 70;
const COLUMNAS = 4;           // cartas por fila del camino en escritorio

/** Alto aproximado antes de medir: solo para la primera pintura. */
function altoEstimado(d: DatosEtapa): number {
  let h = 96;
  if (!d.participa) return h + 24;
  if (d.guia) h += 40;
  if (d.nivel > 0)
    for (const t of d.tramos) h += 30 + (d.nivel >= 3 ? 20 : 0) + t.visibles.length * (d.nivel >= 3 ? 48 : 34);
  if (d.ancha) h = Math.max(140, h / 2);
  return h;
}

function Mapa() {
  const rf = useReactFlow();
  const user = useTicketsAuth((s) => s.user);
  const token = useTicketsAuth((s) => s.token);
  const setPanel = useAppStore((s) => s.setPanel);
  const contenedor = useRef<HTMLDivElement>(null);
  // Desde el primer render: si esperara al ResizeObserver, el celular arrancaría con el
  // diseño de escritorio y el encuadre inicial quedaría hecho para ese diseño.
  const [ancho, setAncho] = useState(() => (typeof window !== "undefined" ? window.innerWidth - 16 : 1200));
  useEffect(() => {
    const el = contenedor.current;
    if (!el) return;
    // Un cuadro después: cambiar el diseño DENTRO del aviso del observador vuelve a medir en el
    // mismo cuadro y Chrome se queja («ResizeObserver loop…»).
    let cuadro = 0;
    const ro = new ResizeObserver(([e]) => {
      cancelAnimationFrame(cuadro);
      cuadro = requestAnimationFrame(() => setAncho(e.contentRect.width));
    });
    ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(cuadro); };
  }, []);
  // En el celular la secuencia va de arriba abajo: se lee con el pulgar.
  const vertical = ancho < 700;

  const esAdmin = Boolean(user && esAdminPanel(user));
  const [nivel, setNivel] = useState(() => {
    const v = Number(leer(CLAVE_NIVEL));
    return Number.isInteger(v) && v >= 0 && v <= 3 && leer(CLAVE_NIVEL) !== null ? v : 1;
  });
  const cambiarNivel = (n: number) => { setNivel(n); guardar(CLAVE_NIVEL, String(n)); };
  const [modo, setModo] = useState<"mapa" | "edificio">(() => (leer(CLAVE_MODO) === "edificio" ? "edificio" : "mapa"));
  const cambiarModo = (m: "mapa" | "edificio") => { setModo(m); guardar(CLAVE_MODO, m); };

  // Lo detenido que ESTA persona puede atender: el servidor lo filtra por los paneles que
  // puede abrir (app/services/acceso_paneles.py), así que la ve todo el equipo interno.
  const bloq = useQuery({
    queryKey: ["mapa-vivo-urgencias", user?.id],
    queryFn: () => api.get<Bloqueos>("/api/mapa-sistema/urgencias"),
    enabled: Boolean(user),
    refetchInterval: 60_000,
    retry: false,
  });
  const tareas = useQuery({
    queryKey: ["mapa-vivo-tareas", user?.id],
    enabled: Boolean(token && user),
    refetchInterval: 60_000,
    retry: false,
    queryFn: async () => {
      const [sol, rec] = await Promise.allSettled([
        ticketsGet<Ticket[]>("/?tipo=solicitud&activas=1", token!),
        ticketsGet<Recordatorio[]>("/recordatorios", token!),
      ]);
      const mias = (sol.status === "fulfilled" && Array.isArray(sol.value) ? sol.value : [])
        .filter((t) => t.asignado_a === user!.id);
      const hoy = new Date().toLocaleDateString("en-CA");
      // Vencen hoy o antes: el mismo criterio con que la Agenda los pone primero.
      const recordatorios = (rec.status === "fulfilled" && Array.isArray(rec.value) ? rec.value : [])
        .filter((r) => r.proxima_fecha && r.proxima_fecha.slice(0, 10) <= hoy);
      return { mias, recordatorios };
    },
  });

  // Qué ve esta persona de cada etapa.
  const cartas = useMemo(() => {
    if (!user) return [];
    const porEtapa = new Map<string, number>();
    // Qué titila: lo detenido grave (severidad alta) y tus solicitudes de prioridad alta/urgente,
    // cada cosa en el panel donde se resuelve.
    const urgentes = new Map<string, Record<string, Urgencia>>();
    const marcar = (etapa: string, panel: string, n: number, porque: string) => {
      const e = urgentes.get(etapa) ?? {};
      const u = e[panel] ?? { n: 0, porque: [] };
      e[panel] = { n: u.n + n, porque: [...u.porque, porque] };
      urgentes.set(etapa, e);
    };
    for (const t of tareas.data?.mias ?? []) {
      const u = etapaDeTicket(t);
      if (!u) continue;
      porEtapa.set(u.etapa.id, (porEtapa.get(u.etapa.id) ?? 0) + 1);
      if (t.prioridad === "urgente" || t.prioridad === "alta") marcar(u.etapa.id, u.panel, 1, `Solicitud ${t.prioridad}: ${t.titulo ?? ""}`);
    }
    for (const [etapa, e] of Object.entries(bloq.data?.por_etapa ?? {}))
      for (const b of e.items) if (b.severidad === "alta") marcar(etapa, b.panel, b.n, `${b.n} ${b.texto}`);
    return ETAPAS_APP.map((etapa): DatosEtapa => {
      const tramos = etapa.tramos
        .map((t) => ({
          ...t,
          // Administración ve 61 paneles: el nivel los dosifica. Los demás ven todos los
          // suyos siempre (ya son pocos, y esconderlos dejaría etapas vacías sin explicación).
          // Un panel URGENTE se muestra aunque el nivel de detalle lo esconda: lo urgente no se esconde.
          visibles: t.pasos.filter((p) => puedeVerSeccionPanel(user, p.panel)
            && (!esAdmin || nivelDe(p.panel) <= Math.max(nivel, 1) || Boolean(urgentes.get(etapa.id)?.[p.panel]))),
        }))
        .filter((t) => t.visibles.length > 0);
      const participa = etapa.tramos.some((t) => t.pasos.some((p) => puedeVerSeccionPanel(user, p.panel)));
      return {
        etapa, tramos, participa, nivel,
        bloqueos: bloq.data?.por_etapa?.[etapa.id],
        mias: porEtapa.get(etapa.id) ?? 0,
        urgentes: urgentes.get(etapa.id) ?? {},
        guia: Boolean(etapa.guia && puedeVerSeccionPanel(user, etapa.guia.abre)),
        ancha: etapa.tipo === "transversal" && !vertical,
      };
    });
  }, [user, tareas.data, bloq.data, nivel, esAdmin, vertical]);

  // Medidas reales (llegan como cambios «dimensions»). Sirven para acomodar la fila de
  // abajo y la columna del celular, y HAY que devolverlas en `measured`: React Flow v12
  // toma de ahí las medidas de un nodo controlado, y sin ellas no ubica los puntos de
  // conexión y las flechas no se dibujan.
  const [medidas, setMedidas] = useState<Record<string, { width: number; height: number }>>({});
  const onNodesChange = useCallback((cambios: NodeChange[]) => {
    const nuevas: Record<string, { width: number; height: number }> = {};
    for (const c of cambios) if (c.type === "dimensions" && c.dimensions) nuevas[c.id] = c.dimensions;
    if (!Object.keys(nuevas).length) return;
    setMedidas((m) => Object.entries(nuevas).every(([k, v]) =>
      Math.abs((m[k]?.width ?? -9) - v.width) < 1 && Math.abs((m[k]?.height ?? -9) - v.height) < 1) ? m : { ...m, ...nuevas });
  }, []);
  const altos = useMemo(() => Object.fromEntries(Object.entries(medidas).map(([k, v]) => [k, v.height])), [medidas]);

  const origen = useMemo<DatosOrigen>(() => ({
    nombre: user?.nombre?.split(" ")[0] ?? "",
    pedidas: tareas.data?.mias.length ?? 0,
    urgentes: (tareas.data?.mias ?? []).filter((t) => t.prioridad === "urgente" || t.prioridad === "alta").length,
    recordatorios: tareas.data?.recordatorios.length ?? 0,
    puede: Boolean(user && puedeVerSeccionPanel(user, ORIGEN_APP.panel)),
  }), [user, tareas.data]);

  const { nodes, edges } = useMemo(() => {
    const linea = cartas.filter((c) => c.etapa.tipo === "linea");
    const transv = cartas.filter((c) => c.etapa.tipo === "transversal");
    const alto = (c: DatosEtapa) => altos[c.etapa.id] ?? altoEstimado(c);
    const ns: Node[] = [];
    const es: Edge[] = [];
    // La secuencia completa: el origen y las etapas de la línea, en orden.
    const cadena = ["origen", ...linea.map((c) => c.etapa.id)];
    const datos = (i: number) => (i === 0 ? origen : linea[i - 1]);
    const altoDe = (i: number) => (i === 0 ? (altos.origen ?? 170) : alto(linea[i - 1]));
    if (vertical) {
      // Celular: de arriba abajo, una columna que se recorre con el pulgar.
      let y = 0;
      cadena.forEach((id, i) => {
        const lados = { entra: Position.Top, sale: Position.Bottom };
        const x = i === 0 ? (ANCHO - ANCHO_ORIGEN) / 2 : 0;
        ns.push({ id, type: i === 0 ? "origen" : "etapa", position: { x, y }, data: { ...datos(i), ...lados } });
        y += altoDe(i) + SEP_Y;
      });
      for (const c of transv) {
        ns.push({ id: c.etapa.id, type: "etapa", position: { x: 0, y }, data: { ...c, entra: Position.Top, sale: Position.Bottom } });
        y += alto(c) + SEP_Y;
      }
    } else {
      // Escritorio: un camino en serpentina, como un tablero de juego. La primera fila va
      // de izquierda a derecha, baja, y la segunda vuelve: ocho cartas en una sola fila
      // obligaban a alejar tanto la cámara que no se leía nada.
      const filas = Math.ceil(cadena.length / COLUMNAS);
      const yFila: number[] = [];
      let y = 0;
      for (let f = 0; f < filas; f++) {
        yFila.push(y);
        const enFila = cadena.map((_, i) => i).filter((i) => Math.floor(i / COLUMNAS) === f);
        y += Math.max(...enFila.map(altoDe)) + SEP_Y * 1.6;
      }
      cadena.forEach((id, i) => {
        const f = Math.floor(i / COLUMNAS), k = i % COLUMNAS;
        const ida = f % 2 === 0;
        const col = ida ? k : COLUMNAS - 1 - k;
        const ultimaDeFila = k === COLUMNAS - 1 && i < cadena.length - 1;
        const lados = {
          entra: k === 0 && i > 0 ? Position.Top : ida ? Position.Left : Position.Right,
          sale: ultimaDeFila ? Position.Bottom : ida ? Position.Right : Position.Left,
        };
        const x = col * (ANCHO + SEP_X) + (i === 0 ? (ANCHO - ANCHO_ORIGEN) / 2 : 0);
        ns.push({ id, type: i === 0 ? "origen" : "etapa", position: { x, y: yFila[f] }, data: { ...datos(i), ...lados } });
      });
      // Dirigir y Sistema acompañan a todas: bandas anchas debajo del camino.
      const anchoTotal = COLUMNAS * (ANCHO + SEP_X) - SEP_X;
      const anchoBanda = (anchoTotal - SEP_X * (transv.length - 1)) / Math.max(1, transv.length);
      transv.forEach((c, i) => ns.push({
        id: c.etapa.id, type: "etapa", style: { width: anchoBanda },
        position: { x: i * (anchoBanda + SEP_X), y },
        data: { ...c, entra: Position.Top, sale: Position.Bottom },
      }));
    }
    // Las flechas: origen ⇢ cada etapa, con lo que le entrega a la siguiente.
    for (let i = 0; i < cadena.length - 1; i++) {
      const de = linea[i - 1];
      const a = linea[i];
      es.push({
        id: `${cadena[i]}-${cadena[i + 1]}`, source: cadena[i], target: cadena[i + 1], type: "entrega",
        label: i === 0 ? "tu día" : de?.etapa.entrega,
        data: { apagada: !a.participa || (de ? !de.participa : false) },
      });
    }
    for (const n of ns) if (medidas[n.id]) n.measured = medidas[n.id];
    return { nodes: ns, edges: es };
  }, [cartas, altos, medidas, vertical, origen]);

  // La cámara: la última vista de esta persona. La primera vez, en escritorio se encuadra
  // todo; en el celular NO (nueve etapas en una pantalla angosta quedan ilegibles): la
  // columna arranca arriba, a tamaño de lectura, y se baja con el dedo.
  const vistaInicial = useMemo<Viewport | undefined>(() => {
    try {
      const v = JSON.parse(leer(CLAVE_VISTA) ?? "null") as (Viewport & { vertical?: boolean }) | null;
      if (v && v.vertical === vertical && Number.isFinite(v.zoom)) return { x: v.x, y: v.y, zoom: v.zoom };
    } catch { /* vista guardada ilegible: se arranca de cero */ }
    if (!vertical) return undefined;
    // Holgura de 60 px: el ancho sale de la ventana y no descuenta márgenes ni el borde del lienzo.
    const zoom = Math.min(1, (ancho - 60) / ANCHO);
    return { x: (ancho - ANCHO * zoom) / 2, y: 12, zoom };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vertical]);

  const abrir = useCallback((p: Panel, nodoId: string) => {
    const n = rf.getNode(nodoId);
    const w = n?.measured?.width ?? ANCHO, h = n?.measured?.height ?? 200;
    const reducir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (n && !reducir) void rf.setCenter(n.position.x + w / 2, n.position.y + Math.min(h / 2, 160), { zoom: 1.5, duration: 260 });
    window.setTimeout(() => setPanel(p), reducir ? 0 : 240);
  }, [rf, setPanel]);

  if (!user) return null;
  const participa = cartas.filter((c) => c.participa).length;
  // Cuánto titila en total y en qué cartas, para «¡Ir a lo urgente!».
  const conUrgente = cartas.filter((c) => Object.keys(c.urgentes).length > 0);
  const totalUrgente = conUrgente.reduce((s, c) => s + Object.values(c.urgentes).reduce((a, u) => a + u.n, 0), 0);
  const irALoUrgente = () => {
    if (modo === "edificio") {
      document.querySelector(".ed-piso[data-urgente]")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    void rf.fitView({ nodes: conUrgente.map((c) => ({ id: c.etapa.id })), padding: 0.15, maxZoom: 1.2, duration: 400 });
  };

  return (
    <div ref={contenedor} className="colab-pixel mapa-vivo flex min-h-0 flex-1 flex-col gap-2">
      <div className="px-hud flex min-w-0 flex-wrap items-center gap-2">
        <Sprite s="control" px={2} titulo="Mapa de la aplicación" />
        <span className="px-t min-w-0 flex-1 truncate" style={{ color: "#FFEC27", fontSize: 16 }}>Mapa de McKenna</span>
        <span className="px-t hidden sm:inline" style={{ fontSize: 11, color: "#C2C3C7" }}>
          {participa} de {cartas.length} etapas son tuyas
        </span>
        <div className="flex shrink-0 gap-1" role="group" aria-label="Cómo ver la aplicación">
          <button type="button" aria-pressed={modo === "mapa"} onClick={() => cambiarModo("mapa")}
                  className={`mv-nivel ${modo === "mapa" ? "mv-nivel-on" : ""}`} title="El tablero: la secuencia del negocio">Mapa</button>
          <button type="button" aria-pressed={modo === "edificio"} onClick={() => cambiarModo("edificio")}
                  className={`mv-nivel ${modo === "edificio" ? "mv-nivel-on" : ""}`} title="El diorama: cada departamento es un piso">Edificio</button>
        </div>
        <div className="flex shrink-0 gap-1" role="group" aria-label="Nivel de detalle">
          {NIVELES.filter((n) => esAdmin || n.n !== 2).map((n) => (
            <button key={n.n} type="button" title={n.ayuda} aria-pressed={nivel === n.n} onClick={() => cambiarNivel(n.n)}
                    className={`mv-nivel ${nivel === n.n ? "mv-nivel-on" : ""}`}>{n.titulo}</button>
          ))}
        </div>
        {totalUrgente > 0 && (
          <button type="button" className="mv-nivel mv-ir-urgente" onClick={irALoUrgente}
                  title="Llevar la cámara a lo que necesita atención ya">
            ¡Ir a lo urgente! ({totalUrgente})
          </button>
        )}
        {modo === "mapa" && (
          <button type="button" className="mv-nivel" title="Ver todo el mapa"
                  onClick={() => void rf.fitView({ padding: 0.08, duration: 300 })}>Encuadrar</button>
        )}
      </div>
      {modo === "edificio" ? (
        <MapaEdificio cartas={cartas} origen={origen} vertical={vertical} onAbrir={(p) => setPanel(p)} />
      ) : (
      <div className="px-lienzo relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <svg width="0" height="0" className="absolute" aria-hidden="true">
          <defs>
            <marker id="mv-punta" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="#000" />
            </marker>
          </defs>
        </svg>
        <AbrirCtx.Provider value={abrir}>
          <ReactFlow
            key={vertical ? "columna" : "camino"}   // al girar el teléfono, cámara nueva para el otro diseño
            nodes={nodes} edges={edges} nodeTypes={TIPOS_NODO} edgeTypes={TIPOS_FLECHA}
            onNodesChange={onNodesChange}
            nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
            // React Flow escribe `pointer-events: none` EN LÍNEA sobre un nodo que no se arrastra,
            // no se selecciona y no tiene manejador de clic — o sea, cada carta del mapa: todo clic
            // atravesaba sus botones y caía al fondo (25-sep-2026: 0 de 14 paneles abrían con clics
            // reales; element.click() sí, por eso no se vio). Con un manejador, los nodos reciben
            // eventos. Los botones llevan además `nopan`: un clic con temblor no arrastra el lienzo.
            onNodeClick={() => { /* el clic lo atiende cada botón de la carta */ }}
            defaultViewport={vistaInicial} fitView={!vistaInicial} fitViewOptions={{ padding: 0.08 }}
            minZoom={0.15} maxZoom={2} panOnScroll={false} zoomOnDoubleClick={false}
            onMoveEnd={(_, v) => guardar(CLAVE_VISTA, JSON.stringify({ ...v, vertical }))}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} variant={BackgroundVariant.Lines} color="#F3DDCB" />
          </ReactFlow>
        </AbrirCtx.Provider>
        {tareas.isError && (
          <p className="mv-aviso">No se pudieron traer tus pendientes; el mapa sigue funcionando.</p>
        )}
      </div>
      )}
    </div>
  );
}

export default function MapaVivo() {
  return (
    <ReactFlowProvider>
      <Mapa />
    </ReactFlowProvider>
  );
}
