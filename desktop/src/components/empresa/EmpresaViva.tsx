/**
 * Empresa viva: McKenna como un juego de gestión (Agenda → Empresa viva).
 *
 * Convive con el Mapa (MapaVivo.tsx) y no lo reemplaza: el Mapa es la aplicación ordenada por
 * etapas; esto es la OPERACIÓN de ahora mismo, dibujada como el barrio real de la empresa: el
 * Búnker Suba, la Sede McKenna Sur y la Tienda digital, en 3D isométrico (Three.js, modelos
 * CC0 de Kenney en public/empresa/). Cada persona del equipo camina al lugar del panel que
 * tiene abierto; cada pregunta de MeLi o cliente de WhatsApp hace fila en la tienda; cada
 * compra es una caja que se alista y se lleva el mensajero; cada proveedor llega en camión.
 *
 * Reglas:
 * - El juego no hace nada por su cuenta: tocar algo muestra qué es y abre el panel de verdad
 *   (responder, alistar, registrar se hacen donde siempre, con sus confirmaciones).
 * - Lo que se ve sale de /api/empresa-viva/estado (app/services/empresa_viva.py), que recorta
 *   los detalles a los permisos de cada quien. Sin LLM.
 * - Nada de puntajes, rankings ni tiempos por persona: se celebra lo que se resuelve, no a quién
 *   le rinde más (RRHH: el control de horas no se convierte en competencia).
 */
import "./empresa-viva.css";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { puedeVerSeccionPanel } from "../../lib/panelAccess";
import { PANEL_INFO } from "../../lib/panelInfo";
import { ponerSonidos, sonidosActivos, tocarSonido } from "../../lib/sonidosJuego";
import { useAppStore, type Panel } from "../../stores/app";
import { useTicketsAuth } from "../../stores/ticketsAuth";
import { CASAS, LUGAR, lugarDePanel, type LugarId } from "./barrio";
import { CompartirEnGrupo, EditorAvatar, PreguntarA } from "./acciones";
import { Motor, type EstadoEmpresa, type EventoApi, type PersonaApi, type Seleccion } from "./motor";

function hace(desde: string | number): string {
  const t = typeof desde === "number" ? desde * 1000 : Date.parse(desde);
  if (!Number.isFinite(t)) return "";
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

function primerNombre(n?: string | null): string {
  return (n || "").trim().split(/\s+/)[0] || "";
}

function textoEvento(e: EventoApi): string {
  const quien = e.por?.bot ? "Hugo" : primerNombre(e.por?.nombre);
  switch (e.tipo) {
    case "atendido":
      if (e.objeto.startsWith("q")) return quien ? `${quien} respondió una pregunta de MercadoLibre` : "Se respondió una pregunta de MercadoLibre";
      return quien ? `${quien} contestó a un cliente de WhatsApp` : "Se contestó a un cliente de WhatsApp";
    case "alistado":
      return quien ? `${quien} alistó un paquete` : "Se alistó un paquete";
    case "salio":
      return "El mensajero se llevó un paquete";
    case "registrado":
      return quien ? `${quien} registró la mercancía de un proveedor` : "Se registró la mercancía de un proveedor";
    case "llego_proveedor":
      return "Llegó un proveedor a la recepción";
    default:
      return e.tipo;
  }
}

const CANAL: Record<string, string> = { meli: "MercadoLibre", web: "Tienda web", whatsapp: "WhatsApp" };
const ESTADO_PAQUETE: Record<string, string> = { por_alistar: "Por alistar, en la oficina", alistado: "Alistado, esperando al mensajero", en_ruta: "En ruta" };
const CASA_DE_LUGAR: Record<string, string> = Object.fromEntries(CASAS.map((c) => [c.id, c.titulo]));
const VISTA_CASA: Record<string, LugarId> = { bunker: "gerencia", sede: "oficina_sede", tienda: "tienda" };

export default function EmpresaViva() {
  const user = useTicketsAuth((s) => s.user);
  const setPanel = useAppStore((s) => s.setPanel);
  const contRef = useRef<HTMLDivElement>(null);
  const motorRef = useRef<Motor | null>(null);
  const [sel, setSel] = useState<Seleccion | null>(null);
  const [sonido, setSonido] = useState(sonidosActivos);
  const [cargado, setCargado] = useState(false);
  const [fallo3d, setFallo3d] = useState(false);
  const [modal, setModal] = useState<null | "avatar" | "compartir" | { preguntar: PersonaApi }>(null);
  const [aviso, setAviso] = useState("");
  const [modoCasas, setModoCasas] = useState<"auto" | "abierta" | "cerrada">("auto");
  const [calidad, setCalidad] = useState<"alta" | "media" | "baja" | null>(null);
  const qc = useQueryClient();
  const setCentroMandoView = useAppStore((s) => s.setCentroMandoView);
  const setTicketsBootView = useAppStore((s) => s.setTicketsBootView);

  const { data, error, isLoading } = useQuery({
    queryKey: ["empresa-viva", user?.id],
    queryFn: () => api.get<EstadoEmpresa>("/api/empresa-viva/estado"),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  useEffect(() => {
    const c = contRef.current;
    if (!c) return;
    let m: Motor;
    try {
      m = new Motor(c, { onSelect: setSel, onSonido: (n) => tocarSonido(n), onListo: () => setCargado(true) });
    } catch {
      setFallo3d(true); // sin WebGL (navegador viejo o aceleración apagada)
      return;
    }
    motorRef.current = m;
    setCalidad(m.escena.calidad);
    // Solo en desarrollo: el banco de pruebas mueve la cámara desde afuera para revisar cada casa.
    if (import.meta.env.DEV) (window as unknown as { __empresaViva?: Motor }).__empresaViva = m;
    return () => { m.destruir(); motorRef.current = null; };
  }, []);

  useEffect(() => {
    if (data) motorRef.current?.sincronizar(data);
  }, [data]);

  /** Tras una acción propia: la foto nueva ya, sin esperar el caché de 10 s. */
  const refrescarYa = useCallback(async () => {
    try {
      const d = await api.get<EstadoEmpresa>("/api/empresa-viva/estado?refrescar=1");
      qc.setQueryData(["empresa-viva", user?.id], d);
    } catch { /* la próxima consulta la trae */ }
  }, [qc, user?.id]);

  function avisar(t: string) {
    setAviso(t);
    window.setTimeout(() => setAviso(""), 5000);
  }

  function irMensajes() {
    setTicketsBootView("mensajes");
    setCentroMandoView("mensajes");
    setPanel("hugo");
  }

  const puede = useCallback((p: string) => Boolean(user && puedeVerSeccionPanel(user, p)), [user]);
  const abrir = useCallback((p: string) => { if (puede(p)) setPanel(p as Panel); }, [puede, setPanel]);

  const cuentas = useMemo(() => {
    const pq = data?.paquetes ?? [];
    return {
      visitantes: (data?.visitantes.length ?? 0) + (data?.visitantes_mas ?? 0),
      porAlistar: pq.filter((p) => p.estado === "por_alistar").length,
      alistados: pq.filter((p) => p.estado === "alistado").length,
      enRuta: pq.filter((p) => p.estado === "en_ruta").length,
      equipo: data?.personas.filter((p) => p.en_linea).length ?? 0,
      reponer: (data?.bodega?.agotados ?? 0) + (data?.bodega?.criticos ?? 0),
    };
  }, [data]);

  const eventos = useMemo(() => [...(data?.eventos ?? [])].reverse().slice(0, 4), [data]);

  function cerrar() {
    setSel(null);
    motorRef.current?.deseleccionar();
  }

  function cambiarSonido() {
    const nuevo = !sonido;
    setSonido(nuevo);
    ponerSonidos(nuevo);
    if (nuevo) tocarSonido("vender");
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#B6E2F8]">
      <div className="z-10 flex items-center gap-1.5 overflow-x-auto border-b border-black/10 bg-white/85 px-3 py-2 text-[#1D2B53] backdrop-blur sm:flex-wrap sm:overflow-visible">
        <h2 className="mr-1 hidden shrink-0 text-base font-bold sm:block">Empresa viva</h2>
        <Ficha color="#FFE600" titulo="Clientes esperando en la Tienda digital">{cuentas.visitantes} en la tienda</Ficha>
        <Ficha color="#FFA300" titulo="Paquetes en la oficina de la sede, por alistar">{cuentas.porAlistar} por alistar</Ficha>
        <Ficha color="#25D366" titulo="Paquetes alistados esperando al mensajero">{cuentas.alistados} alistados</Ficha>
        <Ficha color="#3BA7FF" titulo="Paquetes que ya van en camino">{cuentas.enRuta} en ruta</Ficha>
        <Ficha color="#FF4D4D" titulo="Publicaciones agotadas o por acabarse">{cuentas.reponer} por reponer</Ficha>
        <Ficha color="#FF77A8" titulo="Personas del equipo conectadas">{cuentas.equipo} trabajando</Ficha>
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:flex-wrap">
          {CASAS.map((c) => (
            <BotonBarra key={c.id} onClick={() => motorRef.current?.irALugar(VISTA_CASA[c.id], 2)} titulo={`Ir a ${c.titulo}`}>{c.titulo}</BotonBarra>
          ))}
          <BotonBarra onClick={() => motorRef.current?.escena.encuadrar()} titulo="Ver todo el barrio">Todo</BotonBarra>
          <BotonBarra onClick={() => motorRef.current?.escena.zoom(1 / 1.25)} titulo="Alejar">−</BotonBarra>
          <BotonBarra onClick={() => motorRef.current?.escena.zoom(1.25)} titulo="Acercar">+</BotonBarra>
          <BotonBarra onClick={() => {
            const sig = modoCasas === "auto" ? "abierta" : modoCasas === "abierta" ? "cerrada" : "auto";
            setModoCasas(sig);
            motorRef.current?.escena.modoCasas(sig);
          }} titulo="Casas: se abren solas al acercarte, todas abiertas o todas cerradas">
            {modoCasas === "auto" ? "Casas: auto" : modoCasas === "abierta" ? "Casas: abiertas" : "Casas: cerradas"}
          </BotonBarra>
          {calidad && (
            <BotonBarra onClick={() => {
              const sig = calidad === "alta" ? "media" : calidad === "media" ? "baja" : "alta";
              setCalidad(sig);
              motorRef.current?.escena.cambiarCalidad(sig);
            }} titulo="Calidad gráfica: baja va mejor en celulares sencillos">Gráficos: {calidad}</BotonBarra>
          )}
          <BotonBarra onClick={cambiarSonido} titulo={sonido ? "Silenciar" : "Activar sonidos"}>{sonido ? "Sonido sí" : "Sonido no"}</BotonBarra>
          <BotonBarra onClick={() => setModal("avatar")} titulo="Elegir mi avatar" fuerte>Mi avatar</BotonBarra>
          <BotonBarra onClick={() => setModal("compartir")} titulo="Compartir una idea o un mensaje con un grupo del equipo" fuerte>Compartir idea</BotonBarra>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={contRef} className="absolute inset-0" aria-label="El barrio de McKenna en vivo: el equipo, los clientes, los paquetes y los proveedores" />

        {(!cargado || isLoading) && !fallo3d && <Aviso>Abriendo el barrio…</Aviso>}
        {fallo3d && <Aviso>Este navegador no puede dibujar en 3D (WebGL apagado o no disponible).</Aviso>}
        {error && !data && <Aviso>No se pudo leer el estado de la empresa. ¿Se reinició el agente después de actualizar?</Aviso>}

        {eventos.length > 0 && (
          <div className="pointer-events-none absolute bottom-2 left-2 max-w-[min(22rem,calc(100%-1rem))] space-y-1">
            {eventos.map((e) => (
              <p key={e.seq} className="rounded-lg bg-white/90 px-2.5 py-1 text-xs font-medium text-[#1D2B53] shadow">
                {textoEvento(e)} <span className="text-[#6B7280]">· {hace(e.ts)}</span>
              </p>
            ))}
          </div>
        )}

        {data && data.sin_senal.length > 0 && (
          <p className="absolute right-2 top-2 max-w-xs rounded-lg bg-white/90 px-2 py-1 text-xs font-semibold text-[#B45309] shadow"
             title={data.sin_senal.map((s) => `${s.fuente}: ${s.error}`).join("\n")}>
            Sin señal de: {data.sin_senal.map((s) => s.fuente).join(", ")}
          </p>
        )}

        {sel && data && (
          <Tarjeta sel={sel} data={data} onCerrar={cerrar} abrir={abrir} puede={puede}
                   onPreguntar={(p) => setModal({ preguntar: p })} onMiAvatar={() => setModal("avatar")}
                   onCompartir={() => setModal("compartir")} onMensajes={irMensajes} />
        )}

        {aviso && (
          <p className="absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-full bg-[#1D2B53] px-4 py-1.5 text-sm font-semibold text-white shadow-lg">{aviso}</p>
        )}

        {modal === "avatar" && data && (
          <EditorAvatar actual={data.personas.find((p) => p.id === data.yo)?.avatar ?? null} onCerrar={() => setModal(null)}
                        onGuardado={() => { setModal(null); avisar("Listo: así te ven ahora en el barrio"); void refrescarYa(); }} />
        )}
        {modal && typeof modal === "object" && data && (
          <PreguntarA persona={modal.preguntar} onCerrar={() => setModal(null)}
                      onEnviada={(id, asunto) => {
                        setModal(null);
                        motorRef.current?.lanzar({ id: `t${id}`, tipo: "pregunta", de: data.yo, para: [modal.preguntar.id], ts: Date.now() / 1000, texto: asunto });
                        avisar(`Pregunta enviada a ${primerNombre(modal.preguntar.nombre)}: le llega a Mensajes`);
                        void refrescarYa();
                      }} />
        )}
        {modal === "compartir" && data && (
          <CompartirEnGrupo onCerrar={() => setModal(null)}
                            onEnviado={(id, canal, texto, esIdea) => {
                              setModal(null);
                              motorRef.current?.lanzar({ id: `m${id}`, tipo: esIdea ? "idea" : "grupo", de: data.yo,
                                                         para: canal.miembros.filter((m) => m !== data.yo), todos: !canal.miembros.length,
                                                         ts: Date.now() / 1000, texto, canal: canal.nombre, canal_id: canal.id });
                              avisar(`${esIdea ? "Idea compartida" : "Mensaje enviado"} en «${canal.nombre}»`);
                              void refrescarYa();
                            }} />
        )}
      </div>
    </div>
  );
}

function Ficha({ color, titulo, children }: { color: string; titulo: string; children: React.ReactNode }) {
  return (
    <span title={titulo} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[#1D2B53]/5 px-2 py-0.5 text-xs font-semibold">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden />
      {children}
    </span>
  );
}

function BotonBarra({ onClick, titulo, children, fuerte }: { onClick: () => void; titulo: string; children: React.ReactNode; fuerte?: boolean }) {
  return (
    <button type="button" onClick={onClick} title={titulo} aria-label={titulo}
            className={`min-w-8 shrink-0 rounded-lg border px-2 py-1 text-xs font-semibold shadow-sm ${fuerte
              ? "border-accent bg-accent text-white hover:bg-accent-hover"
              : "border-[#1D2B53]/15 bg-white text-[#1D2B53] hover:bg-[#F2F6FF]"}`}>
      {children}
    </button>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-x-0 top-6 mx-auto w-fit max-w-sm rounded-lg bg-white/90 px-3 py-2 text-center text-sm font-medium text-[#1D2B53] shadow">
      {children}
    </div>
  );
}

/** Lo que se tocó: qué es, y el botón al panel donde se resuelve (si esta persona lo puede abrir). */
function Tarjeta({ sel, data, onCerrar, abrir, puede, onPreguntar, onMiAvatar, onCompartir, onMensajes }: {
  sel: Seleccion; data: EstadoEmpresa; onCerrar: () => void; abrir: (p: string) => void; puede: (p: string) => boolean;
  onPreguntar: (p: PersonaApi) => void; onMiAvatar: () => void; onCompartir: () => void; onMensajes: () => void;
}) {
  const acciones: { texto: string; hacer: () => void; fuerte?: boolean }[] = [];
  let titulo = "";
  let color = "#FFE600";
  const lineas: React.ReactNode[] = [];
  const botones: { panel: string; texto: string }[] = [];

  switch (sel.tipo) {
    case "persona": {
      const p = sel.datos;
      const l = LUGAR[sel.lugar];
      titulo = p.nombre;
      color = "#FF77A8";
      if (sel.rol) lineas.push(<i>{sel.rol}</i>);
      if (!p.en_linea) lineas.push(<>Desconectado: está en su cuarto, en {CASA_DE_LUGAR[l.casa]}.</>);
      else {
        lineas.push(<>Está en <b>{l.titulo}</b> ({CASA_DE_LUGAR[l.casa]}){p.via === "whatsapp" ? ", desde el celular por WhatsApp" : ""}.</>);
        const info = PANEL_INFO[p.panel as Panel];
        if (info && p.via === "panel") lineas.push(<>Tiene abierto: {info.label}</>);
        if (p.id !== data.yo && p.via === "panel" && info) botones.push({ panel: p.panel, texto: `Ir a ${info.label}` });
      }
      if (p.funciones?.length) lineas.push(
        <div className="mt-1"><span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Lo que hace</span>
          <ul className="list-disc pl-4">{p.funciones.map((f) => <li key={f}>{f}</li>)}</ul></div>,
      );
      if (p.id === data.yo) {
        lineas.push(<>Eres tú.</>);
        acciones.push({ texto: "Cambiar mi avatar", hacer: onMiAvatar, fuerte: true }, { texto: "Compartir una idea", hacer: onCompartir });
      } else {
        acciones.push({ texto: `Preguntarle algo a ${primerNombre(p.nombre)}`, hacer: () => onPreguntar(p), fuerte: true },
                      { texto: "Ver nuestras conversaciones", hacer: onMensajes });
      }
      break;
    }
    case "visitante": {
      const v = sel.datos;
      titulo = v.tipo === "preventa" ? "Pregunta en MercadoLibre" : "Cliente de WhatsApp";
      color = v.tipo === "preventa" ? "#FFE600" : "#25D366";
      if (v.producto) lineas.push(<b>{v.producto}</b>);
      if (v.texto) lineas.push(<>«{v.texto}»</>);
      if (!v.puede) lineas.push(<span className="text-ink-muted">El detalle lo ve quien atiende ese canal.</span>);
      lineas.push(<>Esperando {hace(v.desde)}.</>);
      botones.push({ panel: v.panel, texto: v.tipo === "preventa" ? "Responder en Preventa" : "Abrir WhatsApp" });
      break;
    }
    case "paquete": {
      const p = sel.datos;
      titulo = `Paquete · ${CANAL[p.canal] ?? p.canal}${p.flex ? " Flex" : ""}`;
      color = p.canal === "web" ? "#3BA7FF" : p.canal === "whatsapp" ? "#25D366" : "#FFE600";
      lineas.push(<b>{ESTADO_PAQUETE[p.estado]}</b>);
      if (p.producto) lineas.push(<>{p.producto}{p.unidades > 1 ? ` · ${p.unidades} unidades` : ""}</>);
      if (p.lugar) lineas.push(<>Va para {p.lugar}</>);
      if (p.alistado_por?.nombre) lineas.push(<>Lo alistó {primerNombre(p.alistado_por.nombre)}</>);
      lineas.push(<>Compra {hace(p.desde)}.</>);
      botones.push({ panel: "empaque", texto: "Abrir Empaque" });
      if (p.flex) botones.push({ panel: "entregas-flex", texto: "Entregas Flex" });
      if (p.canal === "web") botones.push({ panel: "pedidos", texto: "Pedidos web" });
      break;
    }
    case "proveedor": {
      const p = sel.datos;
      titulo = p.proveedor || "Proveedor";
      color = "#AB5236";
      lineas.push(<b>{p.estado === "descargando" ? "Descargando en la recepción" : "Mercancía registrada"}</b>);
      if (p.items) lineas.push(<>{p.items} producto{p.items === 1 ? "" : "s"} por contar</>);
      if (p.recibe?.nombre) lineas.push(<>Recibe {primerNombre(p.recibe.nombre)}</>);
      lineas.push(<>Llegó {hace(p.desde)}.</>);
      botones.push({ panel: "recepcion-mercancia", texto: "Abrir Recepción" });
      break;
    }
    case "hugo":
      titulo = "Hugo";
      color = "#5DB8FF";
      lineas.push(<>El agente atiende WhatsApp y la web, y prepara los borradores de preventa. Cuando contesta él, el cliente se va con «¡Gracias, Hugo!».</>);
      botones.push({ panel: "supervisor", texto: "Supervisar a Hugo" });
      break;
    case "mensajero":
      titulo = "Mensajero";
      color = "#3BA7FF";
      lineas.push(<>{sel.alistados} paquete{sel.alistados === 1 ? "" : "s"} alistado{sel.alistados === 1 ? "" : "s"} para recoger en el portón.</>);
      botones.push({ panel: "entregas-flex", texto: "Entregas Flex" });
      botones.push({ panel: "guias-envio", texto: "Rótulos" });
      break;
    case "lugar": {
      const l = LUGAR[sel.lugar];
      titulo = `${l.titulo} · ${CASA_DE_LUGAR[l.casa]}`;
      color = l.piso;
      lineas.push(<>{l.hace}.</>);
      const aqui = data.personas.filter((p) => p.en_linea && (lugarDePanel(p.panel) ?? data.casas?.usuarios?.[p.username]?.trabaja) === l.id);
      if (!l.id.startsWith("cuarto")) lineas.push(<>{aqui.length ? `Aquí: ${aqui.map((p) => primerNombre(p.nombre)).join(", ")}` : "No hay nadie trabajando aquí ahora."}</>);
      if (l.id === "bodega" && data.bodega) {
        lineas.push(<><b>{data.bodega.agotados}</b> publicaciones agotadas y <b>{data.bodega.criticos}</b> por acabarse, de {data.bodega.publicaciones}.</>);
        const lista = data.bodega.por_reponer ?? [];
        if (lista.length) lineas.push(
          <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto pr-1 text-xs">
            {lista.map((r) => (
              <li key={r.sku + r.nombre} className="flex gap-1.5">
                <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${r.estado === "agotado" ? "bg-[#FF4D4D]" : "bg-[#FFA300]"}`} />
                <span className="min-w-0 flex-1 truncate" title={`${r.sku} · ${r.nombre}`}>{r.nombre}</span>
                <span className="shrink-0 tabular-nums text-ink-muted">{r.estado === "agotado" ? "agotado" : `${r.stock ?? "?"} und`}</span>
              </li>
            ))}
          </ul>,
        );
      }
      for (const et of l.etapas)
        for (const it of data.oficina[et]?.items ?? []) {
          lineas.push(<span className={it.severidad === "alta" ? "text-danger" : ""}>{it.n} {it.texto}</span>);
          botones.push({ panel: it.panel, texto: PANEL_INFO[it.panel as Panel]?.label ?? it.panel });
        }
      if (!l.id.startsWith("cuarto")) botones.unshift({ panel: l.panel, texto: `Abrir ${PANEL_INFO[l.panel]?.label ?? l.titulo}` });
      break;
    }
  }

  const vistos = new Set<string>();
  const accesibles = botones.filter((b) => !vistos.has(b.panel) && vistos.add(b.panel) && puede(b.panel));

  return (
    <div className="absolute bottom-2 right-2 z-20 w-[min(21rem,calc(100%-1rem))] rounded-xl border border-border bg-surface-panel p-3 text-sm text-ink shadow-xl">
      <div className="mb-2 flex items-start gap-2">
        <span className="mt-1 inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
        <h3 className="min-w-0 flex-1 font-bold leading-tight">{titulo}</h3>
        <button type="button" onClick={onCerrar} aria-label="Cerrar" className="rounded px-1.5 text-ink-muted hover:bg-surface-hover">✕</button>
      </div>
      <div className="space-y-1 text-ink-secondary">
        {lineas.map((l, i) => <div key={i}>{l}</div>)}
      </div>
      {acciones.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {acciones.map((a) => (
            <button key={a.texto} type="button" onClick={a.hacer}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${a.fuerte ? "bg-[#FF9F1C] text-white hover:brightness-105" : "border border-border text-ink hover:bg-surface-hover"}`}>
              {a.texto}
            </button>
          ))}
        </div>
      )}
      {accesibles.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {accesibles.map((b) => (
            <button key={b.panel} type="button" onClick={() => abrir(b.panel)}
                    className="rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-white hover:bg-accent-hover">
              {b.texto}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
