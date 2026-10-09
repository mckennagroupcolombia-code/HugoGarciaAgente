/**
 * Empresa viva: McKenna como un RPG de Super Nintendo (Agenda → Empresa viva y el selector
 * «Mapa · Juego» del Mapa).
 *
 * Tú manejas tu personaje por el barrio real de la empresa — el Búnker Suba, la Sede McKenna Sur y
 * la Tienda digital — y vas hasta donde está cada quien para hablarle. La cámara te sigue a ti
 * (no es una vista de todo el barrio): al entrar a una casa se le levanta el techo. Los demás
 * caminan solos al lugar del panel que tienen abierto, o como ellos los manejen si también están
 * jugando. Cada pregunta de MeLi o cliente de WhatsApp hace fila en la tienda; cada compra es una
 * caja que se alista y se lleva el mensajero en moto; el proveedor llega en camión.
 *
 * Reglas:
 * - El juego no hace nada de la operación por su cuenta: hablar con un cliente o examinar un lugar
 *   abre el panel de verdad (responder, alistar, registrar se hacen donde siempre).
 * - Lo que se ve sale de /api/empresa-viva/estado (app/services/empresa_viva.py), recortado a los
 *   permisos de cada quien. Sin LLM. Las posiciones de quienes juegan van por
 *   /api/empresa-viva/jugador y no se guardan.
 * - Hablarle a alguien es CONVERSAR: «Hablar» abre el chat directo de los dos (ChatPersona.tsx), que
 *   queda guardado y le llega con aviso. Una tarea es otra cosa: «Pedirle una tarea» (solicitud).
 * - Nada de puntajes, rankings ni tiempos por persona (RRHH).
 *
 * Motor: Phaser 4 (juego.ts, escena.ts, motor.ts). Arte: personajes LPC por capas (personajes.ts)
 * y el barrio que arma scripts/empresa_viva/armar_mapa.py en public/empresa/pixel/.
 */
import "./empresa-viva.css";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { puedeVerSeccionPanel } from "../../lib/panelAccess";
import { PANEL_INFO } from "../../lib/panelInfo";
import { ponerSonidos, sonidosActivos, tocarSonido } from "../../lib/sonidosJuego";
import { interceptarPanel, useAppStore, type Panel } from "../../stores/app";
import { useTicketsAuth } from "../../stores/ticketsAuth";
import { CompartirEnGrupo, EditorAvatar, pedirTarea } from "./acciones";
import { ChatPersona } from "./ChatPersona";
import { VentanaModulo } from "./VentanaModulo";
import { VentanaAjedrez, meToca, rivalDe, type ListaAjedrez, type PartidaAjedrez } from "./Ajedrez";
import { MenuAtencion, type ItemAtencion } from "./MenuAtencion";
import { VentanaTenis, equipoDe, type Equipo, type ListaTenis, type PartidoTenis } from "./Tenis";
import { DecorarCasa } from "./Casa";
import { nivelDe, type EstadoVecindario } from "./vecindario";
import { useResumenMensajes } from "../../hooks/useCanalesEquipo";
import { guardarVistaMensajes } from "../chat_equipo/SelectorMensajes";
import { ETAPAS_APP } from "../../lib/flujoApp";
import { TAREA, colorModulo, infoModulo, objetoDe, tituloEtapa } from "./barrio";
import { BuscadorModulos } from "./buscador";
import { VentanaDialogo, type Dialogo, type OpcionDialogo } from "./dialogo";
import { JuegoEmpresa } from "./juego";
import { BASE_PIXEL, claveAvatar, componerAvatar, normalizarAvatar, retrato } from "./personajes";
import type { AvatarPixel, EstadoEmpresa, EventoApi, Examinable, InteraccionApi, PersonaApi, RespuestaJugador } from "./tipos";

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
const primerNombre = (n?: string | null) => (n || "").trim().split(/\s+/)[0] || "";

function textoEvento(e: EventoApi): string {
  const quien = e.por?.bot ? "Hugo" : primerNombre(e.por?.nombre);
  switch (e.tipo) {
    case "atendido":
      if (e.objeto.startsWith("q")) return quien ? `${quien} respondió una pregunta de MercadoLibre` : "Se respondió una pregunta de MercadoLibre";
      return quien ? `${quien} contestó a un cliente de WhatsApp` : "Se contestó a un cliente de WhatsApp";
    case "alistado": return quien ? `${quien} alistó un paquete` : "Se alistó un paquete";
    case "salio": return "El mensajero se llevó un paquete";
    case "registrado": return quien ? `${quien} registró la mercancía de un proveedor` : "Se registró la mercancía de un proveedor";
    case "llego_proveedor": return "Llegó un proveedor a la recepción";
    default: return "";
  }
}
function textoAccion(quien: string, tipo: string, titulo: string): string {
  const de = titulo ? `: ${titulo}` : "";
  switch (tipo) {
    case "resolvio": return `${quien} resolvió una solicitud${de}`;
    case "comento": return `${quien} comentó en una solicitud${de}`;
    case "creo": return `${quien} creó una solicitud${de}`;
    case "en_proceso": return `${quien} empezó${titulo ? ` «${titulo}»` : " una tarea"}`;
    case "zumbido": return `${quien} mandó un zumbido`;
    default: return "";
  }
}
function textoInteraccion(quien: string, para: string[], i: { tipo: string; canal?: string }): string {
  const a = para.length === 1 ? para[0] : para.length ? `${para.length} personas` : "el equipo";
  switch (i.tipo) {
    case "pregunta": return `${quien} le preguntó algo a ${a}`;
    case "solicitud": return `${quien} le pidió algo a ${a}`;
    case "respuesta": return `${quien} le respondió a ${a}`;
    case "idea": return `${quien} compartió una idea${i.canal ? ` en «${i.canal}»` : ""}`;
    case "grupo": return `${quien} escribió${i.canal ? ` en «${i.canal}»` : " en un grupo"}`;
    case "chat": return `${quien} le escribió a ${a}`;
    default: return "";
  }
}

const CANAL: Record<string, string> = { meli: "MercadoLibre", web: "Tienda web", whatsapp: "WhatsApp" };
const ESTADO_PAQUETE: Record<string, string> = { por_alistar: "Por alistar, en la mesa de empaque", alistado: "Alistado, esperando al mensajero en el portón", en_ruta: "En ruta" };
const CLAVE_AYUDA = "mck-ev-ayuda-vista";

function useTactil(): boolean {
  const [t, setT] = useState(() => window.matchMedia?.("(pointer: coarse)").matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.("(pointer: coarse)");
    if (!m) return;
    const f = () => setT(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return t;
}

/** Retratos pixel de cada persona (cabeza y hombros), para la barra y los diálogos. */
function useRetratos(avatares: { id: number; a: AvatarPixel }[]): Record<number, string> {
  const [out, setOut] = useState<Record<number, string>>({});
  const cache = useRef(new Map<string, string>());
  const clave = avatares.map((x) => `${x.id}:${claveAvatar(x.a)}`).join(";");
  useEffect(() => {
    let vivo = true;
    void Promise.all(avatares.map(async ({ id, a }) => {
      const k = claveAvatar(a);
      let r = cache.current.get(k);
      if (!r) {
        try { r = retrato(await componerAvatar(a)); cache.current.set(k, r); } catch { r = ""; }
      }
      return [id, r] as const;
    })).then((pares) => { if (vivo) setOut(Object.fromEntries(pares)); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);
  return out;
}

export default function EmpresaViva() {
  const user = useTicketsAuth((s) => s.user);
  const setPanel = useAppStore((s) => s.setPanel);
  const setCentroMandoView = useAppStore((s) => s.setCentroMandoView);
  const setTicketsBootView = useAppStore((s) => s.setTicketsBootView);
  const qc = useQueryClient();
  const contRef = useRef<HTMLDivElement>(null);
  const juegoRef = useRef<JuegoEmpresa | null>(null);
  const [listo, setListo] = useState(false);
  const [falla, setFalla] = useState("");
  const [cerca, setCerca] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [chatCon, setChatCon] = useState<PersonaApi | null>(null);
  const colaChats = useRef<InteraccionApi[]>([]);
  const [modal, setModal] = useState<null | "avatar" | "compartir">(null);
  const [aviso, setAviso] = useState("");
  const [sonido, setSonido] = useState(sonidosActivos);
  const [sinTechos, setSinTechos] = useState(false);
  const [ayuda, setAyuda] = useState(() => { try { return !localStorage.getItem(CLAVE_AYUDA); } catch { return true; } });
  const [enJuego, setEnJuego] = useState<number[]>([]);
  const [equipoAbierto, setEquipoAbierto] = useState(true);
  const [buscando, setBuscando] = useState(false);
  /** El menú «Atender» (tecla Q): lo que necesita tu atención. */
  const [atencion, setAtencion] = useState(false);
  /** Decorando mi casa del vecindario (Casa.tsx). */
  const [decorando, setDecorando] = useState(false);
  /** Los módulos abiertos dentro del juego (el último es el que se ve). */
  const [pila, setPila] = useState<Panel[]>([]);
  const pilaRef = useRef<Panel[]>([]);
  pilaRef.current = pila;
  const origenVentana = useRef(false);
  /** La partida de ajedrez abierta (la mesa del parque) y si juego en ella o solo miro. */
  const [ajedrezId, setAjedrezId] = useState<number | null>(null);
  const ajedrezJugador = useRef(false);
  ajedrezJugador.current = ajedrezId !== null && ajedrezJugador.current;
  /** El partido de tenis abierto (la cancha del parque) y si juego en él o solo miro. */
  const [tenisId, setTenisId] = useState<number | null>(null);
  const tenisJugador = useRef(false);
  tenisJugador.current = tenisId !== null && tenisJugador.current;
  /** El letrero del cuarto al que se acaba de entrar (como el nombre de la zona en los RPG). */
  const [letrero, setLetrero] = useState<{ titulo: string; etapas: string; hace: string } | null>(null);
  const letreroT = useRef(0);
  const tactil = useTactil();

  const { data, error } = useQuery({
    queryKey: ["empresa-viva", user?.id],
    queryFn: () => api.get<EstadoEmpresa>("/api/empresa-viva/estado"),
    // Cada 4 s: lo vivo (quién está, qué hace, qué acaba de hacer) cuesta poco en el servidor.
    refetchInterval: 4_000,
    staleTime: 2_000,
  });
  const dataRef = useRef<EstadoEmpresa | undefined>(undefined);
  dataRef.current = data;
  const { data: ajedrez } = useQuery({
    queryKey: ["ev-ajedrez-lista", user?.id],
    queryFn: () => api.get<ListaAjedrez>("/api/empresa-viva/ajedrez"),
    refetchInterval: 4_000,
    enabled: Boolean(user?.id),
  });
  const { data: vecindario } = useQuery({
    queryKey: ["ev-vecindario", user?.id],
    queryFn: () => api.get<EstadoVecindario>("/api/empresa-viva/vecindario"),
    refetchInterval: 15_000,
    enabled: Boolean(user?.id),
  });
  const { data: tenis } = useQuery({
    queryKey: ["ev-tenis-lista", user?.id],
    queryFn: () => api.get<ListaTenis>("/api/empresa-viva/tenis"),
    refetchInterval: 4_000,
    enabled: Boolean(user?.id),
  });

  const puede = useCallback((p: string) => p === "perfil" || Boolean(user && puedeVerSeccionPanel(user, p)), [user]);
  /** Abrir un módulo SIN salir del juego: se abre en su ventana y el personaje camina hasta su
   *  objeto en el barrio (así los demás lo ven ahí). `adentro` = se pidió desde otro módulo abierto. */
  const abrirEnJuego = useCallback((p: string, adentro = false) => {
    const panel = (p === "tickets" ? "hugo" : p) as Panel;
    if (panel === "empresa-viva") return;
    if (!puede(panel)) { setAviso(`No tienes acceso a ${PANEL_INFO[panel]?.label ?? panel}`); window.setTimeout(() => setAviso(""), 4000); return; }
    setDialogo(null);
    setChatCon(null);
    setBuscando(false);
    setAjedrezId(null);
    setTenisId(null);
    setPila((prev) => (adentro && prev.length ? (prev[prev.length - 1] === panel ? prev : [...prev, panel]) : [panel]));
    if (!adentro) juegoRef.current?.irAModulo(panel, false);
  }, [puede]);
  const abrir = abrirEnJuego;
  const avisar = useCallback((t: string) => { setAviso(t); window.setTimeout(() => setAviso(""), 4500); }, []);
  // El juego y la red llaman funciones que se crearon en el primer render: van por refs para que
  // siempre usen los datos y retratos de ahora.
  const construirRef = useRef<(e: Examinable) => Dialogo>(() => ({ paginas: [] }));
  const avisoChatRef = useRef<(i: InteraccionApi) => void>(() => {});
  const cerrar = useCallback(() => {
    const sig = colaChats.current.shift();
    if (sig) { avisoChatRef.current(sig); return; }
    setDialogo(null);
  }, []);

  /** Tras una acción propia: la foto nueva ya, sin esperar el caché de 10 s. */
  const refrescarYa = useCallback(async () => {
    try {
      const d = await api.get<EstadoEmpresa>("/api/empresa-viva/estado?refrescar=1");
      qc.setQueryData(["empresa-viva", user?.id], d);
    } catch { /* la próxima consulta la trae */ }
  }, [qc, user?.id]);

  function irMensajes() {
    setTicketsBootView("mensajes");
    setCentroMandoView("mensajes");
    abrirEnJuego("hugo");
  }

  // ── Avatares y retratos
  const avatarDe = useCallback((p: PersonaApi): AvatarPixel => {
    const cfg = data?.casas?.usuarios?.[p.username];
    return normalizarAvatar(p.avatar?.pixel ?? cfg?.pixel ?? null, `persona-${p.id}`);
  }, [data?.casas]);
  const avatares = useMemo(() => (data?.personas ?? []).map((p) => ({ id: p.id, a: avatarDe(p) })), [data?.personas, avatarDe]);
  const retratos = useRetratos(avatares);
  const yo = data?.personas.find((p) => p.id === data.yo);

  // ── El juego
  useEffect(() => {
    const c = contRef.current;
    if (!c) return;
    const j = new JuegoEmpresa(c, {
      onListo: () => setListo(true),
      onExaminar: (e) => { if (e) setDialogo(construirRef.current(e)); },
      onCerca: setCerca,
      onMover: (p) => { posRef.current = p; void sincronizarJugadores(); },
      onError: (m) => setFalla(m),
      onSonido: (n) => tocarSonido(n),
      onLugar: (l) => {
        window.clearTimeout(letreroT.current);
        const info = l ? j.lugar(l) : null;
        if (!info) { setLetrero(null); return; }
        const d = dataRef.current;
        const duermen = l?.startsWith("cuarto") ? Object.entries(d?.casas?.usuarios ?? {}).filter(([, u]) => u.cuarto === l)
          .map(([username]) => primerNombre(d?.personas.find((p) => p.username === username)?.nombre)).filter(Boolean) : [];
        setLetrero({ titulo: duermen.length ? `Cuarto de ${duermen.join(" y ")}` : info.titulo,
                     etapas: info.etapas.map(tituloEtapa).join(" · "), hace: duermen.length ? "Descanso y la repisa de trofeos" : info.hace });
        letreroT.current = window.setTimeout(() => setLetrero(null), 3200);
      },
    });
    juegoRef.current = j;
    if (import.meta.env.DEV) (window as unknown as { __empresaViva?: JuegoEmpresa }).__empresaViva = j;
    c.focus();
    return () => { j.destruir(); juegoRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (data) juegoRef.current?.sincronizar(data); }, [data]);
  useEffect(() => {
    juegoRef.current?.bloquear(Boolean(dialogo || modal || chatCon || buscando || atencion || decorando || pila.length || ajedrezId !== null || tenisId !== null));
  }, [dialogo, modal, chatCon, buscando, atencion, decorando, pila.length, ajedrezId, tenisId]);
  // Q abre «Atender» (y lo cierra el propio menú), si no hay otra ventana encima ni se está escribiendo.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.code !== "KeyQ" || e.ctrlKey || e.metaKey || e.altKey || e.repeat || atencion) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (dialogo || modal || chatCon || buscando || decorando || pila.length || ajedrezId !== null || tenisId !== null) return;
      if (!contRef.current?.isConnected || contRef.current.offsetParent === null) return;
      e.preventDefault();
      setAtencion(true);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [atencion, dialogo, modal, chatCon, buscando, decorando, pila.length, ajedrezId, tenisId]);
  // Con un módulo abierto, lo que se navegue desde su ventana (aunque vaya por el store) se queda
  // en el juego. Solo si el clic salió de la ventana: la barra de la app sigue funcionando normal.
  useEffect(() => {
    if (!pila.length) return;
    interceptarPanel((p) => {
      if (!origenVentana.current) return false;
      abrirEnJuego(p, true);
      return true;
    });
    return () => interceptarPanel(null);
  }, [pila.length, abrirEnJuego]);
  useEffect(() => { juegoRef.current?.techos(sinTechos); }, [sinTechos]);

  // ── Multijugador: mi posición ↔ la de los demás que están jugando
  const posRef = useRef<{ x: number; y: number; dir: string; pose: string } | null>(null);
  const enviando = useRef(false);
  const sincronizarJugadores = useCallback(async () => {
    if (enviando.current || document.hidden || !juegoRef.current) return;
    enviando.current = true;
    try {
      const r = await api.post<RespuestaJugador>("/api/empresa-viva/jugador",
        { ...(posRef.current ?? {}),
          modulo: ajedrezJugador.current ? "ajedrez" : tenisJugador.current ? "tenis" : pilaRef.current[pilaRef.current.length - 1] ?? "" });
      juegoRef.current?.jugadores(r.jugadores);
      setEnJuego((prev) => {
        const ids = r.jugadores.map((x) => x.id).sort((a, b) => a - b);
        return prev.join() === ids.join() ? prev : ids;
      });
    } catch { /* la red volverá; el juego sigue solo */ } finally {
      enviando.current = false;
    }
  }, []);
  useEffect(() => {
    let t = 0;
    const ciclo = () => {
      void sincronizarJugadores();
      t = window.setTimeout(ciclo, enJuego.length ? 700 : 2500);
    };
    t = window.setTimeout(ciclo, 600);
    return () => window.clearTimeout(t);
  }, [sincronizarJugadores, enJuego.length]);

  // Alguien te escribió por el chat de los dos: aviso al estilo del juego, con «Responder».
  const chatsAvisados = useRef(new Set<string>());
  avisoChatRef.current = avisarChat;
  function avisarChat(i: InteraccionApi) {
    const p = dataRef.current?.personas.find((x) => x.id === i.de);
    if (!p) return;
    const nombre = primerNombre(p.nombre);
    setDialogo({
      hablante: nombre, retrato: retratos[i.de] ?? null, paginas: [i.texto || "Te escribió."],
      opciones: [
        { texto: "Responder", hacer: () => abrirChat(p) },
        { texto: "Ir hasta donde está", hacer: () => { setDialogo(null); juegoRef.current?.irDonde(i.de); } },
        { texto: "Luego", hacer: () => cerrar() },
      ],
    });
  }
  useEffect(() => {
    if (!data) return;
    const ahora = Date.now() / 1000;
    for (const i of data.interacciones ?? []) {
      if (i.tipo !== "chat" || !i.para.includes(data.yo) || i.de === data.yo || chatsAvisados.current.has(i.id)) continue;
      chatsAvisados.current.add(i.id);
      // Solo lo de los últimos 3 min, y no si ya tienes abierto el chat con esa persona.
      if (ahora - i.ts > 180 || chatCon?.id === i.de) continue;
      tocarSonido("vista");
      if (dialogoAbierto.current || modal || chatCon) colaChats.current.push(i);
      else avisarChat(i);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  const dialogoAbierto = useRef(false);
  dialogoAbierto.current = Boolean(dialogo);

  /** El chat directo con esa persona (y lo que te había escrito queda leído en el juego). */
  function abrirChat(p: PersonaApi) {
    setDialogo(null);
    for (const i of dataRef.current?.interacciones ?? []) {
      if ((i.tipo === "chat" || i.tipo === "respuesta") && i.de === p.id) juegoRef.current?.leerRespuesta(i.id);
    }
    setChatCon(p);
  }

  // ── Ajedrez en la mesa del parque (Ajedrez.tsx + app/services/empresa_viva_ajedrez.py)
  const nombreDe = useCallback((id: number) => primerNombre(data?.personas.find((p) => p.id === id)?.nombre) || "Alguien", [data?.personas]);
  /** Abre el tablero; quien juega camina a su banco (blancas a la izquierda, negras a la derecha). */
  const abrirAjedrez = useCallback((p: PartidaAjedrez, caminar = true) => {
    const yoId = dataRef.current?.yo ?? 0;
    const juego = p.blancas === yoId || p.negras === yoId;
    setDialogo(null);
    setChatCon(null);
    setBuscando(false);
    setPila([]);
    setTenisId(null);
    ajedrezJugador.current = juego;
    setAjedrezId(p.id);
    if (juego && caminar) juegoRef.current?.irAMesaAjedrez(p.blancas === yoId ? 0 : 1);
  }, []);
  async function retarAjedrez(p: PersonaApi) {
    setDialogo(null);
    try {
      const partida = await api.post<PartidaAjedrez>("/api/empresa-viva/ajedrez", { a: p.id });
      ajedrezVisto.current?.set(partida.id, partida.estado);
      tocarSonido("reto");
      avisar(`Le llegó tu reto a ${primerNombre(p.nombre)}. Cuando acepte, se juega en la mesa del parque.`);
      juegoRef.current?.irAMesaAjedrez(partida.blancas === data?.yo ? 0 : 1);
      void qc.invalidateQueries({ queryKey: ["ev-ajedrez-lista"] });
    } catch (e) {
      avisar(e instanceof Error ? e.message : "No se pudo enviar el reto");
    }
  }
  async function responderReto(p: PartidaAjedrez, acepta: boolean) {
    setDialogo(null);
    try {
      const r = await api.post<PartidaAjedrez>(`/api/empresa-viva/ajedrez/${p.id}/${acepta ? "aceptar" : "rechazar"}`, {});
      ajedrezVisto.current?.set(r.id, r.estado);
      void qc.invalidateQueries({ queryKey: ["ev-ajedrez-lista"] });
      if (acepta) abrirAjedrez(r);
    } catch (e) {
      avisar(e instanceof Error ? e.message : "No se pudo responder el reto");
    }
  }
  function dialogoReto(p: PartidaAjedrez): Dialogo {
    return {
      hablante: nombreDe(p.reta), retrato: retratos[p.reta] ?? null,
      paginas: ["¡Te reto a una partida de ajedrez! Jugamos en la mesa de piedra del parque, cada quien desde su panel."],
      opciones: [
        { texto: "Aceptar y jugar", hacer: () => void responderReto(p, true) },
        { texto: "Ahora no", hacer: () => void responderReto(p, false) },
        { texto: "Lo pienso", hacer: () => cerrar() },
      ],
    };
  }
  function dialogoRetar(): Dialogo {
    const d = dataRef.current;
    const gente = (d?.personas ?? []).filter((p) => p.id !== d?.yo)
      .map((p) => ({ p, orden: enJuego.includes(p.id) ? 0 : (p.presente ?? p.en_linea) ? 1 : 2 }))
      .sort((a, b) => a.orden - b.orden || a.p.nombre.localeCompare(b.p.nombre));
    return {
      hablante: "Mesa de ajedrez", retrato: null,
      paginas: [
        <div key="retar" data-no-avanza>
          <p>¿A quién retas? Le llega el reto en el juego (si no anda por el barrio, lo ve cuando entre).</p>
          <div className="mt-2 flex max-h-48 flex-wrap gap-1 overflow-y-auto pr-1">
            {gente.map(({ p, orden }) => (
              <button key={p.id} type="button" className="ev-boton mck-btn-no-fx" onClick={() => void retarAjedrez(p)}>
                {primerNombre(p.nombre)}{orden === 0 ? " · jugando" : orden === 1 ? " · en línea" : ""}
              </button>
            ))}
          </div>
        </div>,
      ],
      opciones: [{ texto: "Cerrar", hacer: () => cerrar() }],
    };
  }
  // Retos que me llegan y respuestas a los míos: aviso al estilo del juego (uno a la vez, cuando
  // no hay otra ventana encima). En la primera lectura solo se avisan los retos pendientes.
  const ajedrezVisto = useRef<Map<number, string> | null>(null);
  useEffect(() => {
    if (!ajedrez || !data) return;
    const yoId = data.yo;
    if (!ajedrezVisto.current)
      ajedrezVisto.current = new Map(ajedrez.mias.filter((p) => !(p.estado === "invitada" && p.reta !== yoId)).map((p) => [p.id, p.estado]));
    const visto = ajedrezVisto.current;
    for (const p of ajedrez.mias) {
      const antes = visto.get(p.id);
      if (antes === p.estado) continue;
      if (p.estado === "invitada" && p.reta !== yoId) {
        if (dialogo || modal || chatCon || ajedrezId !== null || pila.length || decorando || tenisId !== null) continue;   // espera a que se libere
        visto.set(p.id, p.estado);
        tocarSonido("reto");
        setDialogo(dialogoReto(p));
        break;
      }
      visto.set(p.id, p.estado);
      if (p.reta !== yoId || antes !== "invitada") continue;
      const rival = nombreDe(rivalDe(p, yoId));
      if (p.estado === "jugando") {
        tocarSonido("reto");
        avisar(`${rival} aceptó el reto: ¡a jugar!`);
        if (ajedrezId === null && tenisId === null && !decorando && !pila.length && !chatCon && !modal) abrirAjedrez(p);
      } else if (p.estado === "rechazada") avisar(`${rival} no puede jugar ahora.`);
      else if (p.estado === "vencida") avisar(`El reto a ${rival} venció.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ajedrez, data?.yo, dialogo, modal, chatCon, ajedrezId, pila.length, decorando, tenisId]);
  // ── Trofeos: cada partida ganada queda en la repisa al lado de la cama de quien ganó (su cuarto
  // en empresa_viva_casas.json). Quien no tiene cuarto en el barrio los tiene guardados igual.
  const cuartoDe = useCallback((id: number) => {
    const p = data?.personas.find((x) => x.id === id);
    return (p && data?.casas?.usuarios?.[p.username]?.cuarto) || null;
  }, [data?.personas, data?.casas]);
  useEffect(() => {
    if (!listo || !ajedrez) return;
    const por: Record<string, string[]> = {};
    for (const t of ajedrez.trofeos ?? []) {
      // Si puso la repisa en su casa del vecindario, los trofeos viven allá.
      const c = juegoRef.current?.repisaDe(t.usuario) ?? cuartoDe(t.usuario);
      if (c) (por[c] ??= []).push(t.medalla);
    }
    juegoRef.current?.trofeos(por);
  }, [listo, ajedrez, cuartoDe, vecindario]);
  const trofeosVistos = useRef<Set<number> | null>(null);
  useEffect(() => {
    if (!ajedrez || !data) return;
    const lista = ajedrez.trofeos ?? [];
    if (!trofeosVistos.current) { trofeosVistos.current = new Set(lista.map((t) => t.id)); return; }
    for (const t of lista) {
      if (trofeosVistos.current.has(t.id)) continue;
      trofeosVistos.current.add(t.id);
      if (t.usuario !== data.yo) continue;
      avisar(`¡Trofeo ${t.medalla === "oro" ? "de oro" : "de plata"}! Le ganaste a ${nombreDe(t.rival)}. `
        + (cuartoDe(data.yo) ? "Quedó en tu cuarto, al lado de la cama." : "Quedó guardado con tus trofeos."));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ajedrez, data?.yo]);
  const trofeosDe = (ids: number[]) => (ajedrez?.trofeos ?? []).filter((t) => ids.includes(t.usuario));

  // ── Tenis en equipo en la cancha del parque (Tenis.tsx + app/services/empresa_viva_tenis.py)
  const abrirTenis = useCallback((p: PartidoTenis) => {
    const yoId = dataRef.current?.yo ?? 0;
    setDialogo(null);
    setChatCon(null);
    setBuscando(false);
    setPila([]);
    setAjedrezId(null);
    const eq = equipoDe(p, yoId);
    tenisJugador.current = Boolean(eq);
    setTenisId(p.id);
    if (eq) juegoRef.current?.irATenis(eq, p.equipos[eq].indexOf(yoId));
    else juegoRef.current?.irATenis("A", 2);
  }, []);
  async function armarTenis() {
    setDialogo(null);
    try {
      const p = await api.post<PartidoTenis>("/api/empresa-viva/tenis", {});
      tenisVisto.current.add(p.id);
      void qc.invalidateQueries({ queryKey: ["ev-tenis-lista"] });
      abrirTenis(p);
    } catch (e) {
      avisar(e instanceof Error ? e.message : "No se pudo armar el partido");
    }
  }
  /** «Jugar tenis» al hablarle a alguien: arma el partido con esa persona invitada (o la invita al
   *  que ya tienes armado); a ella le sale el diálogo con «Unirme». */
  async function jugarTenisCon(persona: PersonaApi) {
    setDialogo(null);
    const yoId = dataRef.current?.yo ?? 0;
    const mio = tenis?.partidos.find((p) => p.estado !== "terminada" && equipoDe(p, yoId));
    try {
      if (mio?.estado === "jugando") { avisar("Ya estás jugando un partido: termínalo primero"); abrirTenis(mio); return; }
      const p = mio
        ? await api.post<PartidoTenis>(`/api/empresa-viva/tenis/${mio.id}/invitar`, { a: [persona.id] })
        : await api.post<PartidoTenis>("/api/empresa-viva/tenis", { invitar: [persona.id] });
      tenisVisto.current.add(p.id);
      tocarSonido("reto");
      avisar(`Le llegó tu invitación a ${primerNombre(persona.nombre)}: cuando se una, empiezan en la cancha del parque.`);
      void qc.invalidateQueries({ queryKey: ["ev-tenis-lista"] });
      abrirTenis(p);
    } catch (e) {
      avisar(e instanceof Error ? e.message : "No se pudo armar el partido");
    }
  }
  async function unirseTenis(p: PartidoTenis, equipo: Equipo) {
    setDialogo(null);
    try {
      const r = await api.post<PartidoTenis>(`/api/empresa-viva/tenis/${p.id}/unirse`, { equipo });
      void qc.invalidateQueries({ queryKey: ["ev-tenis-lista"] });
      abrirTenis(r);
    } catch (e) {
      avisar(e instanceof Error ? e.message : "No se pudo unir al partido");
    }
  }
  /** El equipo que le conviene a quien llega: el que tenga menos gente (si empatan, el contrario al de quien lo armó). */
  const equipoParaMi = (p: PartidoTenis): Equipo =>
    p.equipos.A.length === p.equipos.B.length ? (p.equipos.A.includes(p.creador) ? "B" : "A") : p.equipos.A.length < p.equipos.B.length ? "A" : "B";
  function dialogoInvitacionTenis(p: PartidoTenis): Dialogo {
    const eq = equipoParaMi(p);
    const companeros = p.equipos[eq].map((u) => nombreDe(u));
    return {
      hablante: nombreDe(p.creador), retrato: retratos[p.creador] ?? null,
      paginas: [`¡Vamos a jugar tenis en la cancha del parque! Equipo A: ${nombresDe(p.equipos.A) || "nadie"} · Equipo B: ${nombresDe(p.equipos.B) || "nadie"}. Gana quien se lleve 2 juegos.`],
      opciones: [
        { texto: `Unirme al equipo ${eq}${companeros.length ? ` (con ${companeros.join(", ")})` : ""}`, hacer: () => void unirseTenis(p, eq) },
        { texto: "Ver la cancha primero", hacer: () => abrirTenis(p) },
        { texto: "Ahora no", hacer: () => cerrar() },
      ],
    };
  }
  function nombresDe(uids: number[]) {
    return uids.map((u) => nombreDe(u)).join(", ");
  }
  // Un partido nuevo que armó otra persona: aviso para unirse (los que ya estaban al abrir, no). Si
  // me invitaron a mí, en vez del aviso sale el diálogo con «Unirme» (cuando no haya otra ventana).
  const tenisVisto = useRef(new Set<number>());
  const invitacionVista = useRef(new Set<number>());
  const tenisAutoAbierto = useRef(new Set<number>());
  const tenisPrimera = useRef(true);
  useEffect(() => {
    if (!tenis || !data) return;
    const libre = !dialogo && !modal && !chatCon && tenisId === null && ajedrezId === null && !pila.length && !atencion && !buscando && !decorando;
    if (tenisPrimera.current) {
      tenisPrimera.current = false;
      tenis.partidos.forEach((p) => { tenisVisto.current.add(p.id); if (p.estado === "jugando") tenisAutoAbierto.current.add(p.id); });
    }
    for (const p of tenis.partidos) {
      const invitado = p.estado === "sala" && (p.invitados ?? []).includes(data.yo) && !equipoDe(p, data.yo);
      if (invitado && !invitacionVista.current.has(p.id)) {
        tenisVisto.current.add(p.id);
        if (!libre) continue;                                  // espera a que se libere la pantalla
        invitacionVista.current.add(p.id);
        tocarSonido("reto");
        setDialogo(dialogoInvitacionTenis(p));
        break;
      }
      if (tenisVisto.current.has(p.id)) continue;
      tenisVisto.current.add(p.id);
      if (p.estado === "sala" && p.creador !== data.yo) {
        tocarSonido("reto");
        avisar(`${nombreDe(p.creador)} armó un partido de tenis en el parque: ¡únete! (Atender · Q)`);
      }
    }
    // Si estoy en una sala que acaba de empezar y no tengo la cancha abierta, se abre sola (una vez).
    const mia = tenis.partidos.find((p) => p.estado === "jugando" && equipoDe(p, data.yo) && !tenisAutoAbierto.current.has(p.id));
    if (mia && libre) { tenisAutoAbierto.current.add(mia.id); abrirTenis(mia); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenis, data?.yo, dialogo, modal, chatCon, tenisId, ajedrezId, pila.length, atencion, buscando, decorando]);

  // ── El vecindario: cada quien compra su terreno, construye y decora (casas.ts, Casa.tsx,
  // app/services/empresa_viva_vecindario.py). Las monedas son del juego: iguales para todos.
  useEffect(() => {
    if (!listo || !vecindario || !data) return;
    juegoRef.current?.vecindario(vecindario, Object.fromEntries(data.personas.map((p) => [p.id, primerNombre(p.nombre)])));
  }, [listo, vecindario, data?.personas]);
  const miLote = vecindario?.lotes.find((l) => l.dueno === data?.yo) ?? null;
  // Los diálogos que siguen a una compra se arman con la respuesta, no con lo de antes de comprar.
  const vecindarioRef = useRef<EstadoVecindario | undefined>(vecindario);
  vecindarioRef.current = vecindario ?? vecindarioRef.current;
  const accionCasa = useCallback(async (ruta: string, cuerpo: object = {}): Promise<EstadoVecindario | null> => {
    try {
      const r = await api.post<EstadoVecindario>(`/api/empresa-viva/vecindario/${ruta}`, cuerpo);
      vecindarioRef.current = r;
      qc.setQueryData(["ev-vecindario", user?.id], r);
      return r;
    } catch (e) {
      avisar(e instanceof Error ? e.message : "No se pudo");
      tocarSonido("error");
      return null;
    }
  }, [qc, user?.id, avisar]);
  const miLoteAhora = () => vecindarioRef.current?.lotes.find((l) => l.dueno === dataRef.current?.yo) ?? null;
  function irAMiCasa() {
    setDialogo(null);
    const v = vecindarioRef.current;
    if (!v) return;
    const miLote = miLoteAhora();
    const destino = miLote?.id ?? v.lotes.find((l) => !l.dueno && l.precio <= v.billetera.saldo)?.id ?? v.lotes.find((l) => !l.dueno)?.id;
    if (!destino || !juegoRef.current?.irALote(destino)) avisar("No encontré un terreno en el vecindario");
    contRef.current?.focus();
  }
  function empezarDecorar() {
    setDialogo(null);
    const miLote = miLoteAhora();
    if (!miLote?.casa) { avisar("Primero construye tu casa"); return; }
    juegoRef.current?.irALote(miLote.id, false);
    setDecorando(true);
  }
  function dialogoCuentas(): Dialogo {
    const v = vecindarioRef.current!;
    const movs = v.billetera.movimientos.slice(0, 10);
    return {
      hablante: "Mis monedas", retrato: null,
      paginas: [
        <div key="cuentas" data-no-avanza>
          <p>Tienes <span className="text-[#ffe14d]">◉ {v.billetera.saldo}</span> {v.moneda}. Cada mes llegan {v.asignacion_mensual}
            {v.acumula ? " y lo que no gastes se guarda" : " (lo que no gastes no se acumula)"}. Son del juego: iguales para todo el equipo.</p>
          <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto pr-1 text-sm">
            {movs.map((m, i) => (
              <li key={i} className="flex gap-2">
                <span className={`w-16 shrink-0 text-right ${m.monto < 0 ? "text-[#ffb4b4]" : "text-[#8fe08a]"}`}>{m.monto > 0 ? "+" : ""}{m.monto}</span>
                <span className="min-w-0 flex-1 truncate">{m.concepto}</span>
              </li>
            ))}
          </ul>
        </div>,
      ],
      opciones: [
        { texto: miLoteAhora() ? "Ir a mi casa" : "Ver terrenos", hacer: () => irAMiCasa() },
        ...(miLoteAhora()?.casa ? [{ texto: "Decorar mi casa", hacer: () => empezarDecorar() }] : []),
        { texto: "Cerrar", hacer: () => cerrar() },
      ],
    };
  }

  // ── «Atender»: lo que necesita tu atención (MenuAtencion.tsx)
  const { data: resumen } = useResumenMensajes(Boolean(user?.id));
  /** Abre una solicitud en Mensajes → Solicitudes, dentro del juego (como lib abrirSolicitud, sin salir). */
  function abrirSolicitudEnJuego(ticketId: number) {
    guardarVistaMensajes("solicitudes");
    const st = useAppStore.getState();
    st.setAccionesBootTab(null);
    st.setTicketsBootView("mensajes");
    st.setCentroMandoView("mensajes");
    st.setSolicitudBoot({ abrirTicketId: ticketId });
    abrirEnJuego("hugo");
  }
  const iconoDe = (panel: string) => (juegoRef.current?.estaciones() ?? []).find((e) => e.panel === objetoDe(panel))?.icono ?? null;
  function itemsAtencion(): ItemAtencion[] {
    const d = data;
    if (!d) return [];
    const out: ItemAtencion[] = [];
    const y = (fn: () => void) => () => { setAtencion(false); fn(); contRef.current?.focus(); };
    const irA = (id: number) => y(() => { if (!juegoRef.current?.irDonde(id)) avisar("No está en el barrio ahora"); });
    // Para ti
    for (const sol of resumen?.solicitudes_para_mi ?? []) {
      out.push({ clave: `s${sol.id}`, grupo: "Para ti", titulo: `${sol.numero} · ${sol.titulo}`,
                 detalle: `Te la pidió ${primerNombre(sol.creado_por_nombre) || "alguien"}`, color: colorModulo("hugo").fondo, icono: iconoDe("hugo"),
                 atender: y(() => abrirSolicitudEnJuego(sol.id)), ir: sol.creado_por ? irA(sol.creado_por) : undefined });
    }
    for (const p of d.personas) {
      if (p.id === d.yo) continue;
      const r = juegoRef.current?.respuestaPendiente(p.id);
      if (!r) continue;
      out.push({ clave: `c${r.id}`, grupo: "Para ti", titulo: r.tipo === "chat" ? `${primerNombre(p.nombre)} te escribió` : `${primerNombre(p.nombre)} te respondió`,
                 detalle: `«${r.texto || "…"}»`, color: "#FF77A8", icono: "charla",
                 atender: y(() => (r.tipo === "chat" ? abrirChat(p) : irMensajes())), ir: irA(p.id) });
    }
    const noLeidos = resumen?.canales_no_leidos ?? 0, menciones = resumen?.menciones_pendientes ?? 0;
    if (noLeidos) {
      out.push({ clave: "grupos", grupo: "Para ti", titulo: menciones ? `Te nombraron en los grupos (${menciones})` : "Mensajes sin leer en los grupos",
                 detalle: `${noLeidos} sin leer en el chat del equipo`, alta: menciones > 0, color: colorModulo("chat-equipo").fondo, icono: "charla",
                 atender: y(() => abrirEnJuego("chat-equipo")), ir: y(() => irAModulo("chat-equipo")) });
    }
    for (const p of ajedrez?.mias ?? []) {
      const lado = p.blancas === d.yo ? 0 : 1;
      if (p.estado === "invitada" && p.reta !== d.yo) {
        out.push({ clave: `a${p.id}`, grupo: "Para ti", titulo: `${nombreDe(p.reta)} te retó al ajedrez`, detalle: "Se juega en la mesa del parque",
                   color: "#C2C3C7", icono: "ajedrez", atender: y(() => setDialogo(dialogoReto(p))), ir: y(() => { juegoRef.current?.irAMesaAjedrez(lado); }) });
      } else if (meToca(p, d.yo)) {
        out.push({ clave: `a${p.id}`, grupo: "Para ti", titulo: `Te toca en el ajedrez con ${nombreDe(rivalDe(p, d.yo))}`,
                   detalle: `${Math.ceil(p.jugadas.length / 2)} jugadas`, color: "#C2C3C7", icono: "ajedrez",
                   atender: y(() => abrirAjedrez(p)), ir: y(() => { juegoRef.current?.irAMesaAjedrez(lado); }) });
      }
    }
    for (const p of tenis?.partidos ?? []) {
      const eq = equipoDe(p, d.yo);
      if (p.estado === "sala" && !eq) {
        out.push({ clave: `t${p.id}`, grupo: "Para ti",
                   titulo: (p.invitados ?? []).includes(d.yo) ? `${nombreDe(p.creador)} te invitó a jugar tenis` : `${nombreDe(p.creador)} armó un partido de tenis`,
                   detalle: `Equipo A: ${p.equipos.A.length} · Equipo B: ${p.equipos.B.length} — únete en la cancha del parque`,
                   color: "#00E436", icono: "tenis", atender: y(() => setDialogo(dialogoInvitacionTenis(p))), ir: y(() => { juegoRef.current?.irATenis("A", 2); }) });
      } else if (eq && p.estado !== "terminada" && tenisId !== p.id) {
        out.push({ clave: `t${p.id}`, grupo: "Para ti", titulo: p.estado === "sala" ? "Tu partido de tenis espera" : "Tu partido de tenis está en juego",
                   detalle: `Equipo ${eq}`, alta: p.estado === "jugando", color: "#00E436", icono: "tenis",
                   atender: y(() => abrirTenis(p)), ir: y(() => { juegoRef.current?.irATenis(eq, p.equipos[eq].indexOf(d.yo)); }) });
      }
    }
    if (vecindario && !miLote) {
      out.push({ clave: "casa", grupo: "Para ti", titulo: "Tu casa en el vecindario: compra un terreno",
                 detalle: `Tienes ${vecindario.billetera.saldo} ${vecindario.moneda} este mes · los terrenos están al sur del parque`,
                 color: "#FFA300", icono: "casa", atender: y(() => irAMiCasa()), ir: y(() => irAMiCasa()) });
    } else if (vecindario && miLote && !miLote.casa) {
      out.push({ clave: "casa", grupo: "Para ti", titulo: "Ya tienes terreno: construye tu casa",
                 detalle: `Tienes ${vecindario.billetera.saldo} ${vecindario.moneda}`, color: "#FFA300", icono: "casa",
                 atender: y(() => irAMiCasa()), ir: y(() => irAMiCasa()) });
    }
    // Detenido en tus módulos (el «Detenido ahora» del Mapa, ya recortado a tus permisos en el servidor)
    const orden = ETAPAS_APP.map((e) => e.id as string);
    const detenidos = Object.entries(d.oficina ?? {}).sort(([a], [b]) => orden.indexOf(a) - orden.indexOf(b))
      .flatMap(([, e]) => e.items ?? []).filter((it) => puede(it.panel))
      .sort((a, b) => Number(b.severidad === "alta") - Number(a.severidad === "alta"));
    for (const it of detenidos) {
      out.push({ clave: `d${it.id}`, grupo: "Detenido en tus módulos", titulo: infoModulo(it.panel).nombre, detalle: `${it.n} ${it.texto}`,
                 alta: it.severidad === "alta", color: colorModulo(it.panel).fondo, icono: iconoDe(it.panel),
                 atender: y(() => abrirEnJuego(it.panel)), ir: y(() => irAModulo(it.panel)) });
    }
    // En el barrio, si no lo dijo ya el Mapa
    const yaDicho = new Set(detenidos.map((x) => x.panel));
    const porPanel = new Map<string, number>();
    for (const v of d.visitantes) if (v.puede && v.panel) porPanel.set(v.panel, (porPanel.get(v.panel) ?? 0) + 1);
    for (const [panel, n] of porPanel) {
      if (yaDicho.has(panel)) continue;
      out.push({ clave: `v${panel}`, grupo: "En el barrio", titulo: `${n} cliente${n === 1 ? "" : "s"} esperando en la tienda`,
                 detalle: infoModulo(panel).nombre, color: colorModulo(panel).fondo, icono: iconoDe(panel),
                 atender: y(() => abrirEnJuego(panel)), ir: y(() => irAModulo(panel)) });
    }
    const porAlistar = d.paquetes.filter((p) => p.puede && p.estado === "por_alistar");
    if (porAlistar.length && !yaDicho.has(porAlistar[0].panel)) {
      const panel = porAlistar[0].panel;
      out.push({ clave: "alistar", grupo: "En el barrio", titulo: `${porAlistar.length} paquete${porAlistar.length === 1 ? "" : "s"} por alistar`,
                 detalle: "En la mesa de empaque de la sede", color: colorModulo(panel).fondo, icono: iconoDe(panel),
                 atender: y(() => abrirEnJuego(panel)), ir: y(() => irAModulo(panel)) });
    }
    const llegando = d.proveedores.filter((p) => p.puede);
    if (llegando.length && !yaDicho.has(llegando[0].panel)) {
      const panel = llegando[0].panel;
      out.push({ clave: "proveedor", grupo: "En el barrio", titulo: `${llegando.length === 1 ? "Llega un proveedor" : `Llegan ${llegando.length} proveedores`}`,
                 detalle: "Recibir la mercancía en el patio", color: colorModulo(panel).fondo, icono: iconoDe(panel),
                 atender: y(() => abrirEnJuego(panel)), ir: y(() => irAModulo(panel)) });
    }
    return out;
  }


  function campoTarea(p: PersonaApi): Dialogo {
    const nombre = primerNombre(p.nombre);
    return {
      hablante: "Tú", retrato: yo ? retratos[yo.id] : null,
      paginas: [`¿Qué tarea le pides a ${nombre}? Le llega como solicitud a su Agenda, con aviso. (Para preguntarle algo, mejor «Hablar»: es un chat.)`],
      campo: {
        placeholder: "Lo que necesitas que haga…", boton: "Pedir", largo: 400,
        enviar: async (t) => {
          const id = await pedirTarea(p.id, t);
          if (data) juegoRef.current?.lanzar({ id: `t${id}`, tipo: "solicitud", de: data.yo, para: [p.id], ts: Date.now() / 1000, texto: t });
          avisar(`Tarea enviada a ${nombre}: le llega a su Agenda`);
          void refrescarYa();
          cerrar();
          return null;
        },
      },
    };
  }

  // ── Lo que dice cada cosa al hablarle o examinarla
  function construir(ex: Examinable): Dialogo {
    const d = dataRef.current;
    const botones = (lista: { panel: string; texto: string }[]): OpcionDialogo[] => {
      const vistos = new Set<string>();
      return lista.filter((b) => !vistos.has(b.panel) && vistos.add(b.panel) && puede(b.panel))
        .map((b) => ({ texto: b.texto, hacer: () => { setDialogo(null); abrirEnJuego(b.panel); } }));
    };
    const salir: OpcionDialogo = { texto: "Nada, gracias", hacer: () => cerrar() };
    switch (ex.tipo) {
      case "persona": {
        const p = ex.datos;
        const nombre = primerNombre(p.nombre);
        const presente = ex.jugando || (p.presente ?? p.en_linea);
        const paginas: string[] = [];
        if (ex.jugando) paginas.push("¡Hola! Yo también ando por el barrio.");
        else if (!presente) paginas.push(ex.lugar.startsWith("cuarto") ? "Zzz… (Está descansando: no está conectado.)" : "(No está conectado ahora.)");
        else if (p.tarea) paginas.push(`Ahora mismo: ${(TAREA[p.tarea.funcion]?.corto ?? p.tarea.hace).toLowerCase()}${p.tarea.titulo ? `, «${p.tarea.titulo}»` : ""}.`);
        else if (p.via === "whatsapp") paginas.push("Ando trabajando desde el celular, por WhatsApp.");
        else {
          const info = PANEL_INFO[p.panel as Panel];
          paginas.push(info ? `Estoy en ${info.label}.` : "Aquí, en mi puesto.");
        }
        const resp = juegoRef.current?.respuestaPendiente(p.id);
        if (resp) {
          paginas.push(resp.tipo === "chat" ? `Te escribí: «${resp.texto || "…"}»` : `Te respondí: «${resp.texto || "mira tus Mensajes"}»`);
          juegoRef.current?.leerRespuesta(resp.id);
        }
        const opciones: OpcionDialogo[] = [];
        opciones.push({ texto: resp?.tipo === "chat" ? "Responderle" : "Hablar", hacer: () => abrirChat(p) });
        opciones.push({ texto: "Pedirle una tarea", hacer: () => setDialogo(campoTarea(p)) });
        const partida = ajedrez?.mias.find((x) => (x.estado === "jugando" || x.estado === "invitada") && rivalDe(x, d?.yo ?? 0) === p.id);
        if (partida && !(partida.estado === "invitada" && partida.reta !== d?.yo)) opciones.push({ texto: "Ver nuestra partida", hacer: () => abrirAjedrez(partida) });
        else if (partida) opciones.push({ texto: "Responder su reto", hacer: () => setDialogo(dialogoReto(partida)) });
        else opciones.push({ texto: "Jugar ajedrez", hacer: () => void retarAjedrez(p) });
        const suTenis = tenis?.partidos.find((x) => x.estado !== "terminada" && equipoDe(x, p.id));
        if (suTenis && equipoDe(suTenis, d?.yo ?? 0)) opciones.push({ texto: "Ver nuestro partido de tenis", hacer: () => abrirTenis(suTenis) });
        else if (suTenis?.estado === "sala") opciones.push({ texto: "Unirme a su partido de tenis", hacer: () => setDialogo(dialogoInvitacionTenis(suTenis)) });
        else if (!suTenis) opciones.push({ texto: "Jugar tenis", hacer: () => void jugarTenisCon(p) });
        opciones.push({
          texto: "¿Qué haces?", hacer: () => {
            const copas = trofeosDe([p.id]).length;
            const lineas = [ex.rol ? `${ex.rol}.` : "", p.funciones?.length ? `Lo que hago: ${p.funciones.join(" · ")}.` : "",
                            copas ? `En ajedrez llevo ${copas} trofeo${copas === 1 ? "" : "s"}${cuartoDe(p.id) ? ", en la repisa de mi cuarto" : ""}.` : ""].filter(Boolean);
            const info = PANEL_INFO[p.panel as Panel];
            setDialogo({
              hablante: nombre, retrato: retratos[p.id] ?? null,
              paginas: lineas.length ? lineas : ["Un poco de todo."],
              opciones: [
                ...(p.via === "panel" && info && presente ? botones([{ panel: p.panel, texto: `Ir a ${info.label}` }]) : []),
                { texto: "Hablar", hacer: () => abrirChat(p) },
                salir,
              ],
            });
          },
        });
        if (resp?.tipo === "respuesta") opciones.push({ texto: "Ver la conversación", hacer: () => { setDialogo(null); irMensajes(); } });
        opciones.push(salir);
        return { hablante: nombre, retrato: retratos[p.id] ?? null, paginas, opciones };
      }
      case "visitante": {
        const v = ex.datos;
        const paginas = [
          v.puede ? `${v.producto ? `(${v.producto}) ` : ""}«${v.texto || "Hola…"}»` : "(El detalle lo ve quien atiende ese canal.)",
          `Llevo esperando ${hace(v.desde)}.`,
        ];
        return {
          hablante: v.tipo === "preventa" ? "Cliente de MercadoLibre" : "Cliente de WhatsApp", paginas,
          opciones: [...botones([{ panel: v.panel, texto: v.tipo === "preventa" ? "Responder en Preventa" : "Abrir WhatsApp" }]), { texto: "Luego", hacer: () => cerrar() }],
        };
      }
      case "paquete": {
        const p = ex.datos;
        const lineas = [ESTADO_PAQUETE[p.estado] ?? p.estado];
        if (p.producto) lineas.push(`${p.producto}${p.unidades > 1 ? ` · ${p.unidades} unidades` : ""}`);
        if (p.lugar) lineas.push(`Va para ${p.lugar}`);
        if (p.alistado_por?.nombre) lineas.push(`Lo alistó ${primerNombre(p.alistado_por.nombre)}`);
        lineas.push(`Compra ${hace(p.desde)}.`);
        return {
          hablante: `Paquete · ${CANAL[p.canal] ?? p.canal}${p.flex ? " Flex" : ""}`, paginas: [lineas.join("\n")],
          opciones: [...botones([{ panel: "empaque", texto: "Abrir Empaque" }, ...(p.flex ? [{ panel: "entregas-flex", texto: "Entregas Flex" }] : []),
                                 ...(p.canal === "web" ? [{ panel: "pedidos", texto: "Pedidos web" }] : [])]), { texto: "Cerrar", hacer: () => cerrar() }],
        };
      }
      case "proveedor": {
        const p = ex.datos;
        return {
          hablante: p.proveedor || "Proveedor",
          paginas: [`¡Buenas! Traigo la mercancía${p.items ? `: ${p.items} producto${p.items === 1 ? "" : "s"} por contar` : ""}.${p.recibe?.nombre ? ` Me recibe ${primerNombre(p.recibe.nombre)}.` : ""}`],
          opciones: [...botones([{ panel: "recepcion-mercancia", texto: "Abrir Recepción" }]), { texto: "Cerrar", hacer: () => cerrar() }],
        };
      }
      case "hugo":
        return {
          hablante: "Hugo", retrato: `${BASE_PIXEL}hugo.png`,
          paginas: ["¡Hola! Soy Hugo, el agente de IA de McKenna.", "Atiendo WhatsApp y el chat de la web, y preparo los borradores de preventa. Cuando contesto yo, el cliente se va con «¡Gracias, Hugo!»."],
          opciones: [...botones([{ panel: "chat", texto: "Preguntarle a Hugo" }, { panel: "supervisor", texto: "Supervisar a Hugo" }]),
                     { texto: "Chao, Hugo", hacer: () => cerrar() }],
        };
      case "mensajero":
        return {
          hablante: "Mensajero",
          paginas: [ex.alistados ? `¡Quiubo! Vengo por ${ex.alistados} paquete${ex.alistados === 1 ? "" : "s"} alistado${ex.alistados === 1 ? "" : "s"}.` : "Ya me llevé todo. ¡Hasta la próxima!"],
          opciones: [...botones([{ panel: "entregas-flex", texto: "Entregas Flex" }, { panel: "guias-envio", texto: "Rótulos" }]), { texto: "Cerrar", hacer: () => cerrar() }],
        };
      case "lugar": {
        const l = ex.lugar;
        const info = juegoRef.current?.lugar(l);
        if (!info) return { paginas: ["…"], opciones: [salir] };
        const paginas: (string | React.ReactNode)[] = [info.hace ? `${info.hace}.` : info.titulo];
        const lista: { panel: string; texto: string }[] = [];
        if (info.panel && !l.startsWith("cuarto")) lista.push({ panel: info.panel, texto: `Abrir ${PANEL_INFO[info.panel as Panel]?.label ?? info.titulo}` });
        if (l === "bodega" && d?.bodega) {
          paginas.push(`${d.bodega.agotados} publicaciones agotadas y ${d.bodega.criticos} por acabarse, de ${d.bodega.publicaciones}.`);
          const rep = d.bodega.por_reponer ?? [];
          if (rep.length) paginas.push(
            <ul className="max-h-40 space-y-0.5 overflow-y-auto pr-1 text-sm">
              {rep.map((r) => (
                <li key={r.sku + r.nombre} className="flex gap-2">
                  <span className={r.estado === "agotado" ? "text-[#ff8a8a]" : "text-[#ffc46b]"}>■</span>
                  <span className="min-w-0 flex-1 truncate">{r.nombre}</span>
                  <span className="shrink-0 tabular-nums text-[#b9c2ff]">{r.estado === "agotado" ? "agotado" : `${r.stock ?? "?"} und`}</span>
                </li>
              ))}
            </ul>,
          );
        }
        const detenidos = info.etapas.flatMap((et) => d?.oficina[et]?.items ?? []);
        if (detenidos.length) {
          paginas.push(detenidos.map((it) => `• ${it.n} ${it.texto}`).join("\n"));
          for (const it of detenidos) lista.push({ panel: it.panel, texto: PANEL_INFO[it.panel as Panel]?.label ?? it.panel });
        }
        const modulos = (juegoRef.current?.estaciones() ?? []).filter((e) => e.lugar === l && e.tipo === "modulo");
        if (modulos.length) paginas.push(<ListaModulos titulo="Aquí están" estaciones={modulos} puede={puede} onIr={irAModulo} />);
        return { hablante: info.titulo, paginas, opciones: [...botones(lista), { texto: "Cerrar", hacer: () => cerrar() }] };
      }
      case "modulo": {
        const m = infoModulo(ex.panel);
        const usan = (d?.personas ?? []).filter((p) => p.id !== d?.yo && p.via === "panel" && (p.presente ?? p.en_linea) && p.panel === ex.panel)
          .map((p) => primerNombre(p.nombre));
        const detenidos = Object.values(d?.oficina ?? {}).flatMap((et) => et.items ?? []).filter((it) => it.panel === ex.panel);
        // Una sola página con lo esencial: «Usar» queda a un toque (el módulo es a lo que se viene).
        const donde = [m.etapa ? `Etapa «${m.etapa}»${m.tramo ? ` → ${m.tramo}` : ""}.` : "", usan.length ? `Ahora lo usa: ${usan.join(", ")}.` : ""].filter(Boolean).join(" ");
        const paginas: (string | React.ReactNode)[] = [[`${m.hace}.`, donde].filter(Boolean).join("\n")];
        if (detenidos.length) paginas.push(`Pendiente aquí:\n${detenidos.map((it) => `• ${it.n} ${it.texto}`).join("\n")}`);
        const abre = puede(ex.panel);
        if (!abre) paginas.push("Este módulo no está entre tus permisos. Si lo necesitas, pídeselo a administración.");
        return {
          hablante: m.nombre, retrato: null, paginas,
          opciones: [...(abre ? [{ texto: `Usar ${m.nombre}`, hacer: () => { setDialogo(null); abrirEnJuego(ex.panel, false); } }] : []),
                     { texto: "Cerrar", hacer: () => cerrar() }],
        };
      }
      case "lote": {
        const v = vecindarioRef.current;
        const lm = juegoRef.current?.lote(ex.lote);
        const le = v?.lotes.find((l) => l.id === ex.lote);
        const miLote = v?.lotes.find((l) => l.dueno === d?.yo) ?? null;
        if (!v || !lm || !le) return { paginas: ["Este terreno todavía no carga. Intenta de nuevo en un momento."], opciones: [salir] };
        const saldo = v.billetera.saldo, mon = v.moneda;
        const frente = lm.frente === "abajo" ? "La puerta mira a la calle de las casas; el fondo da al parque." : "La puerta mira a la calle de las casas.";
        if (!le.dueno) {
          const puede = !miLote && saldo >= le.precio;
          return {
            hablante: `Terreno ${le.id} · en venta`, retrato: null,
            paginas: [`Se vende: ${le.precio} ${mon}. Mide 8 × 8 baldosas. ${frente}\nTienes ${saldo} ${mon}.${miLote ? " Ya tienes tu terreno: cada quien tiene uno." : ""}`],
            opciones: [
              ...(!miLote ? [{ texto: `Comprar este terreno (${le.precio})`, deshabilitada: !puede,
                               hacer: () => void accionCasa("terreno", { lote: le.id }).then((r) => {
                                 if (!r) return;
                                 tocarSonido("vender");
                                 setDialogo(construirRef.current({ tipo: "lote", lote: le.id }));
                               }) }] : []),
              { texto: "Mis monedas", hacer: () => setDialogo(dialogoCuentas()) },
              { texto: "Cerrar", hacer: () => cerrar() },
            ],
          };
        }
        const dueno = d?.personas.find((p) => p.id === le.dueno);
        const nombre = primerNombre(dueno?.nombre) || "alguien";
        if (le.dueno !== d?.yo) {
          const nivel = nivelDe(v, le.casa?.nivel);
          return {
            hablante: le.casa ? `Casa de ${nombre}` : `Terreno de ${nombre}`, retrato: dueno ? retratos[dueno.id] ?? null : null,
            paginas: [le.casa ? `${nivel?.nombre ?? "Casa"}, con ${le.items.length} cosa${le.items.length === 1 ? "" : "s"} entre jardín, muebles y accesorios.` : "Todavía no ha construido."],
            opciones: [salir],
          };
        }
        if (!le.casa) {
          const precio = v.catalogo.casa.precio;
          return {
            hablante: "Tu terreno", retrato: null,
            paginas: [`Ya es tuyo. Para vivir aquí, construye tu casa (${precio} ${mon}; después la puedes ampliar). Tienes ${saldo} ${mon}. ¿De qué estilo?`],
            opciones: [
              ...v.catalogo.casa.modelos.map((m): OpcionDialogo => ({
                texto: `Construir: ${m.nombre} (${precio})`, deshabilitada: saldo < precio,
                hacer: () => void accionCasa("construir", { modelo: m.id }).then((r) => {
                  if (!r) return;
                  tocarSonido("logro");
                  avisar("¡Tu casa quedó lista! Ahora decórala a tu gusto.");
                  setDialogo(construirRef.current({ tipo: "lote", lote: le.id }));
                }),
              })),
              { texto: "Cerrar", hacer: () => cerrar() },
            ],
          };
        }
        const nivel = nivelDe(v, le.casa.nivel);
        const siguiente = v.catalogo.niveles.find((n) => n.nivel === le.casa!.nivel + 1);
        return {
          hablante: "Tu casa", retrato: null,
          paginas: [`${nivel?.nombre ?? "Casa"} · ${le.items.length} cosa${le.items.length === 1 ? "" : "s"}. Tienes ${saldo} ${mon}.`],
          opciones: [
            { texto: "Decorar", hacer: () => empezarDecorar() },
            ...(siguiente ? [{ texto: `${siguiente.nombre} (${siguiente.precio})`, deshabilitada: saldo < siguiente.precio,
                               hacer: () => void accionCasa("ampliar").then((r) => { if (r) { tocarSonido("logro"); setDialogo(construirRef.current({ tipo: "lote", lote: le.id })); } }) }] : []),
            { texto: "Mis monedas", hacer: () => setDialogo(dialogoCuentas()) },
            { texto: "Cerrar", hacer: () => cerrar() },
          ],
        };
      }
      case "tenis": {
        const lista = tenis?.partidos ?? [];
        const salas = lista.filter((p) => p.estado === "sala");
        const enJuego = lista.filter((p) => p.estado === "jugando");
        const mio = lista.find((p) => p.estado !== "terminada" && equipoDe(p, d?.yo ?? 0));
        const paginas = ["La cancha de tenis del parque. Arma un partido y que se unan: hasta 3 por equipo; gana el equipo que se lleve 2 juegos, y cada quien del equipo ganador se lleva un trofeo a su cuarto."];
        if (enJuego.length) paginas[0] += `\nSe está jugando: ${enJuego.map((p) => `${nombresDe(p.equipos.A)} contra ${nombresDe(p.equipos.B)}`).join("; ")}.`;
        return {
          hablante: "Cancha de tenis", retrato: null, paginas,
          opciones: [
            ...(mio ? [{ texto: "Volver a mi partido", hacer: () => abrirTenis(mio) }] : []),
            ...(!mio ? salas.map((p): OpcionDialogo => ({ texto: `Unirme al partido de ${nombreDe(p.creador)} (${p.equipos.A.length} vs ${p.equipos.B.length})`, hacer: () => abrirTenis(p) })) : []),
            ...(!mio ? [{ texto: "Armar un partido", hacer: () => void armarTenis() }] : []),
            ...enJuego.filter((p) => p !== mio).slice(0, 2).map((p): OpcionDialogo => ({ texto: `Mirar: ${nombresDe(p.equipos.A)} vs ${nombresDe(p.equipos.B)}`, hacer: () => abrirTenis(p) })),
            { texto: "Cerrar", hacer: () => cerrar() },
          ],
        };
      }
      case "trofeos": {
        const duermen = Object.entries(d?.casas?.usuarios ?? {}).filter(([, u]) => u.cuarto === ex.lugar)
          .map(([username]) => d?.personas.find((p) => p.username === username)).filter((p): p is PersonaApi => Boolean(p));
        const dueno = duermen[0];
        const mia = dueno?.id === d?.yo;
        const lista = trofeosDe(duermen.map((p) => p.id));
        const nombre = dueno ? primerNombre(dueno.nombre) : "";
        const paginas: (string | React.ReactNode)[] = [];
        if (!lista.length) {
          paginas.push(mia
            ? "Todavía está vacía. Cada partida de ajedrez que ganes en la mesa del parque deja aquí un trofeo: de oro por jaque mate, de plata si el otro se rinde."
            : `${nombre ? `${nombre} todavía no tiene trofeos` : "Todavía no hay trofeos"}. Se ganan jugando ajedrez en la mesa del parque.`);
        } else {
          const oro = lista.filter((t) => t.medalla === "oro").length, plata = lista.filter((t) => t.medalla === "plata").length;
          const deTenis = lista.filter((t) => t.juego === "tenis").length;
          const cuenta = [oro ? `${oro} de oro` : "", plata ? `${plata} de plata` : "", deTenis ? `${deTenis} de tenis` : ""].filter(Boolean)
            .join(", ").replace(/, ([^,]*)$/, " y $1");
          paginas.push(`${mia ? "Tus trofeos" : `Los trofeos de ${nombre}`}: ${cuenta}.`);
          const fecha = (ts: number) => new Date(ts * 1000).toLocaleDateString("es-CO", { day: "numeric", month: "short" });
          paginas.push(
            <ul key="trofeos" className="max-h-48 space-y-0.5 overflow-y-auto pr-1" data-no-avanza>
              {[...lista].reverse().map((t) => t.juego === "tenis" ? (
                <li key={t.id}>
                  <span style={{ color: "#8fe08a" }}>Tenis</span>
                  {" · "}{mia ? "ganaste" : "ganó"}{t.detalle?.companeros?.length ? ` con ${nombresDe(t.detalle.companeros)}` : ""}
                  {" contra "}{nombresDe(t.detalle?.rivales ?? [t.rival])}{t.detalle?.marcador ? ` (${t.detalle.marcador})` : ""} · {fecha(t.ganado)}
                </li>
              ) : (
                <li key={t.id}>
                  <span style={{ color: t.medalla === "oro" ? "#ffe14d" : "#d3d9e6" }}>{t.medalla === "oro" ? "Oro" : "Plata"}</span>
                  {" · "}{mia ? "le ganaste a" : "le ganó a"} {nombreDe(t.rival)}{t.motivo === "jaque mate" ? " con jaque mate" : " (se rindió)"}
                  {t.jugadas ? ` en ${Math.ceil(t.jugadas / 2)} jugadas` : ""} · {fecha(t.ganado)}
                </li>
              ))}
            </ul>,
          );
        }
        return {
          hablante: mia ? "Tu repisa de trofeos" : nombre ? `Repisa de ${nombre}` : "Repisa de trofeos", retrato: dueno ? retratos[dueno.id] ?? null : null, paginas,
          opciones: [{ texto: "Jugar ajedrez", hacer: () => setDialogo(dialogoRetar()) },
                     { texto: "Jugar tenis", hacer: () => setDialogo(construirRef.current({ tipo: "tenis" })) },
                     { texto: "Cerrar", hacer: () => cerrar() }],
        };
      }
      case "ajedrez": {
        const yoId = d?.yo ?? 0;
        const mias = (ajedrez?.mias ?? []).filter((p) => p.estado === "jugando" || p.estado === "invitada");
        const enCurso = (ajedrez?.en_curso ?? []).slice(0, 3);
        const paginas = ["La mesa de ajedrez del parque. Reta a alguien del equipo: juegan por turnos, cada quien desde su panel, y cualquiera puede mirar."];
        if (enCurso.length) paginas[0] += `\nSe está jugando: ${enCurso.map((p) => `${nombreDe(p.blancas)} contra ${nombreDe(p.negras)}`).join(", ")}.`;
        return {
          hablante: "Mesa de ajedrez", retrato: null, paginas,
          opciones: [
            ...mias.map((p): OpcionDialogo => p.estado === "invitada" && p.reta !== yoId
              ? { texto: `Reto de ${nombreDe(p.reta)}`, hacer: () => setDialogo(dialogoReto(p)) }
              : { texto: `${p.estado === "invitada" ? "Esperando a" : meToca(p, yoId) ? "Te toca con" : "Seguir con"} ${nombreDe(rivalDe(p, yoId))}`, hacer: () => abrirAjedrez(p) }),
            { texto: "Retar a alguien", hacer: () => setDialogo(dialogoRetar()) },
            { texto: "Jugar tenis (la cancha de al lado)", hacer: () => setDialogo(construirRef.current({ tipo: "tenis" })) },
            ...enCurso.map((p): OpcionDialogo => ({ texto: `Mirar: ${nombreDe(p.blancas)} vs ${nombreDe(p.negras)}`, hacer: () => abrirAjedrez(p, false) })),
            { texto: "Cerrar", hacer: () => cerrar() },
          ],
        };
      }
      case "directorio": {
        const casa = juegoRef.current?.casa(ex.casa);
        const todas = juegoRef.current?.estaciones() ?? [];
        const cuartos = juegoRef.current?.lugaresDe(ex.casa) ?? [];
        const paginas: (string | React.ReactNode)[] = [`${casa?.titulo ?? "Esta casa"}: qué se hace en cada cuarto. Toca un módulo y te llevo caminando.`];
        paginas.push(
          <div className="max-h-56 space-y-2 overflow-y-auto pr-1" data-no-avanza>
            {cuartos.map(([id, l]) => {
              const aqui = todas.filter((e) => e.tipo === "modulo" && (e.lugar === id || (juegoRef.current?.lugarDeEstacion(e) === id)));
              if (!aqui.length) return null;
              return <ListaModulos key={id} titulo={`${l.titulo}${l.etapas.length ? ` · ${l.etapas.map(tituloEtapa).join(" · ")}` : ""}`} estaciones={aqui} puede={puede} onIr={irAModulo} />;
            })}
            {(() => {
              const pasillo = todas.filter((e) => e.tipo === "modulo" && e.lugar === `pasillo_${ex.casa}`);
              return pasillo.length ? <ListaModulos titulo="Pasillo y entrada" estaciones={pasillo} puede={puede} onIr={irAModulo} /> : null;
            })()}
          </div>,
        );
        return { hablante: "Directorio", paginas, opciones: [{ texto: "Cerrar", hacer: () => cerrar() }] };
      }
    }
  }

  construirRef.current = construir;

  /** Caminar hasta el objeto de un módulo (desde el directorio, un cuarto o «¿Dónde está…?»). */
  function irAModulo(panel: string) {
    setDialogo(null);
    setBuscando(false);
    if (!juegoRef.current?.irAModulo(panel)) avisar("Ese módulo no tiene un lugar en el barrio");
    contRef.current?.focus();
  }

  // ── Barra de arriba
  const cuentas = useMemo(() => {
    const pq = data?.paquetes ?? [];
    return {
      visitantes: (data?.visitantes.length ?? 0) + (data?.visitantes_mas ?? 0),
      porAlistar: pq.filter((p) => p.estado === "por_alistar").length,
      alistados: pq.filter((p) => p.estado === "alistado").length,
      equipo: data?.personas.filter((p) => p.presente ?? p.en_linea).length ?? 0,
      reponer: (data?.bodega?.agotados ?? 0) + (data?.bodega?.criticos ?? 0),
    };
  }, [data]);

  const enVivoLista = useMemo(() => {
    if (!data) return [];
    const nombre = (id: number) => primerNombre(data.personas.find((p) => p.id === id)?.nombre) || "Alguien";
    const items = [
      ...data.eventos.map((e) => ({ clave: `e${e.seq}`, ts: e.ts, texto: textoEvento(e) })),
      ...(data.acciones ?? []).map((a) => ({ clave: a.id, ts: a.ts, texto: textoAccion(nombre(a.de), a.tipo, a.titulo) })),
      ...(data.interacciones ?? []).map((i) => ({ clave: i.id, ts: i.ts, texto: textoInteraccion(nombre(i.de), i.para.map(nombre), i) })),
    ];
    return items.filter((x) => x.texto).sort((a, b) => b.ts - a.ts).slice(0, 3);
  }, [data]);

  function cambiarSonido() {
    const nuevo = !sonido;
    setSonido(nuevo);
    ponerSonidos(nuevo);
    if (nuevo) tocarSonido("vender");
  }

  function irDonde(p: PersonaApi) {
    const j = juegoRef.current;
    if (!j || p.id === data?.yo) return;
    const ok = j.irDonde(p.id, () => setDialogo(construir({ tipo: "persona", datos: p, lugar: "", rol: data?.casas?.usuarios?.[p.username]?.rol, jugando: enJuego.includes(p.id) })));
    if (!ok) avisar(`${primerNombre(p.nombre)} no está en el barrio ahora`);
    contRef.current?.focus();
  }

  const avatarYo = yo ? avatarDe(yo) : null;
  const itemsAtender = data ? itemsAtencion() : [];
  const nAtencion = itemsAtender.length;

  return (
    <div className="ev-raiz relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="z-10 flex items-center gap-1.5 overflow-x-auto border-b-2 border-[#0b1140] bg-[#1b2470] px-2 py-1 text-white"
           style={{ fontFamily: "PixelifyMck, monospace" }}>
        <h2 className="mr-1 hidden shrink-0 text-base text-[#ffe14d] xl:block">Empresa viva</h2>
        <button type="button" className={`ev-boton mck-btn-no-fx shrink-0 ${nAtencion ? "ev-latido" : ""}`} aria-pressed={nAtencion > 0}
                onClick={() => setAtencion(true)} title="Lo que necesita tu atención (tecla Q)">
          ¡! Atender{nAtencion ? ` · ${nAtencion}` : ""}
        </button>
        <Ficha color="#FFE600" titulo="Clientes esperando en la Tienda digital (abrir Preventa)" onClick={() => abrirEnJuego("preventa")}>{cuentas.visitantes} en tienda</Ficha>
        <Ficha color="#FFA300" titulo="Paquetes en la mesa de empaque, por alistar (abrir Empaque)" onClick={() => abrirEnJuego("empaque")}>{cuentas.porAlistar} por alistar</Ficha>
        <Ficha color="#25D366" titulo="Paquetes alistados esperando al mensajero (abrir Entregas Flex)" onClick={() => abrirEnJuego("entregas-flex")}>{cuentas.alistados} listos</Ficha>
        <Ficha color="#FF4D4D" titulo="Publicaciones agotadas o por acabarse (abrir Control de inventario)" onClick={() => abrirEnJuego("control-inventario")}>{cuentas.reponer} reponer</Ficha>
        <Ficha color="#FF77A8" titulo="Personas del equipo conectadas">{cuentas.equipo} en línea</Ficha>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button type="button" className="ev-boton mck-btn-no-fx" onClick={() => setSinTechos((v) => !v)} aria-pressed={sinTechos}
                  title={sinTechos ? "Volver a poner los techos" : "Ver todas las casas por dentro (sin techos)"}>Sin techos</button>
          <button type="button" className="ev-boton mck-btn-no-fx" onClick={() => juegoRef.current?.zoom(-1)} title="Alejar">−</button>
          <button type="button" className="ev-boton mck-btn-no-fx" onClick={() => juegoRef.current?.zoom(1)} title="Acercar">+</button>
          <button type="button" className="ev-boton mck-btn-no-fx" onClick={cambiarSonido} aria-pressed={sonido} title={sonido ? "Silenciar" : "Activar sonidos"}>♪</button>
          {vecindario && (
            <button type="button" className="ev-boton mck-btn-no-fx" onClick={() => setDialogo(dialogoCuentas())}
                    title={`Tus ${vecindario.moneda} del mes para tu casa del vecindario`}>
              ◉ {vecindario.billetera.saldo}
            </button>
          )}
          <button type="button" className="ev-boton mck-btn-no-fx" onClick={() => setBuscando(true)} title="Buscar un módulo de la app y caminar hasta él" aria-pressed="true">¿Dónde está…?</button>
          <button type="button" className="ev-boton mck-btn-no-fx" onClick={() => setAyuda(true)} title="Cómo se juega">?</button>
          <button type="button" className="ev-boton mck-btn-no-fx" onClick={() => setModal("compartir")} title="Compartir una idea o un mensaje con un grupo del equipo">Idea</button>
          <button type="button" className="ev-boton mck-btn-no-fx" aria-pressed="true" onClick={() => setModal("avatar")} title="Elegir cómo te ven">Mi personaje</button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={contRef} tabIndex={0} className="absolute inset-0 outline-none" aria-label="El barrio de McKenna: maneja tu personaje con las flechas y habla con el equipo" />

        {data && (
          <BarraEquipo personas={data.personas} yo={data.yo} retratos={retratos} enJuego={enJuego} onTocar={irDonde}
                       abierta={equipoAbierto} onPlegar={() => setEquipoAbierto((v) => !v)} />
        )}

        {(!listo || !data) && !falla && <Aviso>Abriendo el barrio…</Aviso>}
        {falla && <Aviso>{falla}</Aviso>}
        {error && !data && <Aviso>No se pudo leer el estado de la empresa. ¿Se reinició el agente después de actualizar?</Aviso>}

        {enVivoLista.length > 0 && !tactil && !dialogo && !chatCon && (
          <div className="pointer-events-none absolute bottom-2 left-2 max-w-[min(24rem,calc(100%-1rem))] space-y-1">
            {enVivoLista.map((e) => (
              <p key={e.clave} className="ev-ventana-clara px-2 py-0.5 text-xs">{e.texto} <span className="opacity-60">· {hace(e.ts)}</span></p>
            ))}
          </div>
        )}

        {cerca && !dialogo && !modal && !chatCon && (
          <button type="button" onClick={() => juegoRef.current?.accion()}
                  className="ev-boton mck-btn-no-fx absolute bottom-3 left-1/2 z-20 -translate-x-1/2 px-3 py-1 text-sm">
            {tactil ? "A" : "Espacio"} · {cerca}
          </button>
        )}

        {data && data.sin_senal.length > 0 && (
          <p className="ev-ventana-clara absolute right-2 top-14 max-w-xs px-2 py-1 text-xs" title={data.sin_senal.map((s) => `${s.fuente}: ${s.error}`).join("\n")}>
            Sin señal de: {data.sin_senal.map((s) => s.fuente).join(", ")}
          </p>
        )}

        {aviso && <p className="ev-ventana absolute left-1/2 top-16 z-30 -translate-x-1/2 px-4 py-1.5 text-sm">{aviso}</p>}

        {letrero && !aviso && !dialogo && !chatCon && (
          <div className="ev-ventana pointer-events-none absolute left-1/2 top-14 z-20 -translate-x-1/2 px-4 py-1.5 text-center" role="status">
            <div className="ev-nombre-dialogo text-base tracking-wide">{letrero.titulo.toUpperCase()}{letrero.etapas ? ` · ${letrero.etapas}` : ""}</div>
            {letrero.hace && !letrero.titulo.startsWith("Cuarto") && <div className="text-xs text-[#b9c2ff]">{letrero.hace}</div>}
          </div>
        )}

        {tactil && !dialogo && !modal && !chatCon && <Controles juego={juegoRef} />}

        {dialogo && !chatCon && <VentanaDialogo key={JSON.stringify(dialogo.paginas.map((p) => (typeof p === "string" ? p : "·")))} d={dialogo} onCerrar={cerrar} />}

        {chatCon && data && (
          <ChatPersona persona={chatCon} yo={data.yo} retratoOtro={retratos[chatCon.id]} retratoYo={retratos[data.yo]}
                       onCerrar={() => { setChatCon(null); const sig = colaChats.current.shift(); if (sig) avisarChat(sig); contRef.current?.focus(); }}
                       onEnviado={(id, texto, canalId) => juegoRef.current?.lanzar({ id: `m${id}`, tipo: "chat", de: data.yo, para: [chatCon.id],
                                                                                    ts: Date.now() / 1000, texto, canal_id: canalId })}
                       onVerEnEquipo={(canalId) => {
                         try { sessionStorage.setItem("mck-chat-equipo-canal", String(canalId)); } catch { /* */ }
                         abrirEnJuego("chat-equipo");
                       }} />
        )}

        {ayuda && !dialogo && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 p-3" onClick={() => { setAyuda(false); try { localStorage.setItem(CLAVE_AYUDA, "1"); } catch { /* */ } }}>
            <div className="ev-ventana w-[min(30rem,100%)] p-4 text-[15px] leading-relaxed">
              <p className="ev-nombre-dialogo mb-1 text-lg">Cómo se juega</p>
              <p>{tactil ? "Mueve tu personaje con la cruceta; mantén B para correr." : "Camina con las flechas o W A S D; mantén Shift para correr."}</p>
              <p>{tactil ? "A" : "Espacio o Enter"} para hablar con quien tienes enfrente o examinar el lugar.</p>
              <p>También puedes tocar el piso para ir allá, o tocar a alguien para ir a hablarle. Arriba, toca la cara de alguien del equipo y caminas solo hasta donde está.</p>
              <p>Cada módulo de la app es un objeto del barrio con su ícono (el Libro Mayor en la biblioteca de Contabilidad, Facturación en un escritorio de la Sede…): acércate y pulsa A para ver para qué sirve y abrirlo. «¿Dónde está…?» te lleva caminando a cualquiera.</p>
              <p className="mt-1 text-[#b9c2ff]">Al entrar a una casa se le levanta el techo. «Hablar» abre el chat con esa persona: queda guardado y le llega aunque no esté jugando. Quien tiene ★ también está jugando.</p>
              <p className="mt-2 text-right"><span className="ev-sigue">▼</span> Toca para empezar</p>
            </div>
          </div>
        )}

        {pila.length > 0 && (
          <VentanaModulo pila={pila} origen={origenVentana}
                         iconoDe={(p) => (juegoRef.current?.estaciones() ?? []).find((e) => e.panel === p)?.icono ?? null}
                         onIr={(p) => abrirEnJuego(p, true)}
                         onAtras={() => setPila((prev) => prev.slice(0, -1))}
                         onCerrar={() => { setPila([]); contRef.current?.focus(); }} />
        )}

        {ajedrezId !== null && data && (
          <VentanaAjedrez id={ajedrezId} yo={data.yo} nombreDe={nombreDe} retratoDe={(i) => retratos[i] || null}
                          onCerrar={() => { setAjedrezId(null); contRef.current?.focus(); }}
                          onVerTrofeo={cuartoDe(data.yo) ? () => {
                            setAjedrezId(null);
                            juegoRef.current?.irATrofeos(cuartoDe(data.yo)!);
                            contRef.current?.focus();
                          } : undefined} />
        )}

        {tenisId !== null && data && (
          <VentanaTenis id={tenisId} yo={data.yo} nombreDe={nombreDe} retratoDe={(i) => retratos[i] || null}
                        onCerrar={() => { setTenisId(null); contRef.current?.focus(); void qc.invalidateQueries({ queryKey: ["ev-tenis-lista"] }); }}
                        onLado={(eq: Equipo, i: number) => { tenisJugador.current = true; juegoRef.current?.irATenis(eq, i); }}
                        onVerTrofeo={cuartoDe(data.yo) ? () => { setTenisId(null); juegoRef.current?.irATrofeos(cuartoDe(data.yo)!); } : undefined} />
        )}

        {decorando && miLote?.casa && vecindario && juegoRef.current?.lote(miLote.id) && (
          <DecorarCasa juego={juegoRef.current} lote={juegoRef.current.lote(miLote.id)!} mio={miLote} v={vecindario}
                       onAccion={accionCasa} onCerrar={() => { setDecorando(false); contRef.current?.focus(); }} />
        )}

        {atencion && <MenuAtencion items={itemsAtender} onCerrar={() => { setAtencion(false); contRef.current?.focus(); }} />}

        {buscando && (
          <BuscadorModulos estaciones={juegoRef.current?.estaciones() ?? []} puede={puede} onIr={irAModulo} onCerrar={() => setBuscando(false)} />
        )}

        {modal === "avatar" && yo && avatarYo && (
          <EditorAvatar inicial={avatarYo} colorInicial={yo.avatar?.color ?? ""} onCerrar={() => setModal(null)}
                        onGuardado={() => { setModal(null); avisar("Listo: así te ven ahora en el barrio"); void refrescarYa(); }} />
        )}
        {modal === "compartir" && data && (
          <CompartirEnGrupo onCerrar={() => setModal(null)}
                            onEnviado={(id, canal, texto, esIdea) => {
                              setModal(null);
                              juegoRef.current?.lanzar({ id: `m${id}`, tipo: esIdea ? "idea" : "grupo", de: data.yo,
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

/** Retratos del equipo: tocar a alguien = tu personaje camina solo hasta donde está. */
function BarraEquipo({ personas, yo, retratos, enJuego, onTocar, abierta, onPlegar }: {
  personas: PersonaApi[]; yo: number; retratos: Record<number, string>; enJuego: number[]; onTocar: (p: PersonaApi) => void;
  abierta: boolean; onPlegar: () => void;
}) {
  const gente = [...personas].filter((p) => p.id !== yo)
    .sort((a, b) => Number(enJuego.includes(b.id)) - Number(enJuego.includes(a.id)) || Number(b.presente ?? b.en_linea) - Number(a.presente ?? a.en_linea));
  return (
    <div className="pointer-events-none absolute left-2 right-2 top-2 z-10 flex gap-1 overflow-x-auto pb-1" role="list" aria-label="El equipo ahora">
      <button type="button" onClick={onPlegar} className="ev-boton mck-btn-no-fx pointer-events-auto shrink-0 self-start"
              title={abierta ? "Esconder el equipo" : "Ver al equipo"} aria-expanded={abierta}>{abierta ? "◂" : "Equipo ▸"}</button>
      {abierta && gente.map((p) => {
        const presente = enJuego.includes(p.id) || (p.presente ?? p.en_linea);
        const hace = p.tarea ? TAREA[p.tarea.funcion]?.corto ?? p.tarea.hace : enJuego.includes(p.id) ? "Jugando" : !presente ? "Ausente"
          : p.via === "whatsapp" ? "Por WhatsApp" : PANEL_INFO[p.panel as Panel]?.label ?? "En la app";
        return (
          // Un <div> y no un <button>: los temas del panel pintan todos los botones (borde, sombra).
          <div key={p.id} role="listitem" tabIndex={0} onClick={() => onTocar(p)}
               onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onTocar(p); } }}
               title={`Caminar hasta ${primerNombre(p.nombre)}`}
               className={`ev-ventana-clara pointer-events-auto flex shrink-0 cursor-pointer select-none items-center gap-1 py-0 pl-0 pr-1.5 ${presente ? "" : "opacity-60"}`}>
            <span className="relative">
              {retratos[p.id] ? <img src={retratos[p.id]} alt="" className="ev-retrato h-7 w-7 rounded bg-[#cfe9ff]" draggable={false} />
                : <span className="block h-7 w-7 rounded bg-[#cfe9ff]" />}
              <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${presente ? "bg-[#22C55E]" : "bg-[#9CA3AF]"}`} />
              {enJuego.includes(p.id) && <span className="absolute -left-1 -top-1 text-xs text-[#e6a800]">★</span>}
            </span>
            <span className="leading-tight">
              <span className="block text-xs">{primerNombre(p.nombre)}</span>
              <span className="block max-w-[7rem] truncate text-[10px] opacity-75">{hace}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Cruceta y botones A/B en pantalla (celular y tableta). */
function Controles({ juego }: { juego: React.RefObject<JuegoEmpresa | null> }) {
  const [on, setOn] = useState<Record<string, boolean>>({});
  const pulsar = (accion: string, v: boolean) => {
    setOn((o) => ({ ...o, [accion]: v }));
    juego.current?.virtual(accion, v);
  };
  const props = (accion: string) => ({
    "data-on": on[accion] ? "1" : "0",
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); pulsar(accion, true); },
    onPointerUp: (e: React.PointerEvent) => { e.preventDefault(); pulsar(accion, false); },
    onPointerCancel: () => pulsar(accion, false),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });
  return (
    <>
      <div className="ev-cruceta" aria-label="Cruceta">
        <button type="button" className="mck-btn-no-fx absolute" style={{ left: 44, top: 0 }} aria-label="Arriba" {...props("arriba")}>▲</button>
        <button type="button" className="mck-btn-no-fx absolute" style={{ left: 0, top: 44 }} aria-label="Izquierda" {...props("izquierda")}>◀</button>
        <button type="button" className="mck-btn-no-fx absolute" style={{ left: 88, top: 44 }} aria-label="Derecha" {...props("derecha")}>▶</button>
        <button type="button" className="mck-btn-no-fx absolute" style={{ left: 44, top: 88 }} aria-label="Abajo" {...props("abajo")}>▼</button>
      </div>
      <div className="ev-botones">
        <button type="button" className="ev-a mck-btn-no-fx absolute" aria-label="A: hablar" {...props("accion")}>A</button>
        <button type="button" className="ev-b mck-btn-no-fx absolute" aria-label="B: correr" {...props("correr")}>B</button>
      </div>
    </>
  );
}

function Ficha({ color, titulo, children, onClick }: { color: string; titulo: string; children: React.ReactNode; onClick?: () => void }) {
  const cuerpo = (
    <>
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} aria-hidden />
      {children}
    </>
  );
  if (!onClick) return <span title={titulo} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded bg-white/10 px-1.5 py-0.5 text-xs">{cuerpo}</span>;
  return (
    <button type="button" title={titulo} onClick={onClick}
            className="mck-btn-no-fx inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded bg-white/10 px-1.5 py-0.5 text-xs text-white hover:bg-white/20">
      {cuerpo}
    </button>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return <div className="ev-ventana absolute inset-x-0 top-16 z-20 mx-auto w-fit max-w-sm px-4 py-2 text-center text-sm">{children}</div>;
}

/** Módulos de un cuarto como botones: tocar uno = caminar hasta su objeto. */
function ListaModulos({ titulo, estaciones, puede, onIr }: {
  titulo: string; estaciones: { panel: string; icono: string }[]; puede: (p: string) => boolean; onIr: (panel: string) => void;
}) {
  const vistos = new Set<string>();
  const unicos = estaciones.filter((e) => !vistos.has(e.panel) && vistos.add(e.panel));
  return (
    <div data-no-avanza>
      <div className="mb-1 text-sm text-[#ffe14d]">{titulo}</div>
      <div className="flex flex-wrap gap-1">
        {unicos.map((e) => (
          <button key={e.panel} type="button" onClick={() => onIr(e.panel)} className="ev-boton mck-btn-no-fx"
                  title={`${infoModulo(e.panel).hace}${puede(e.panel) ? "" : " (no está en tus permisos)"}`}>
            {infoModulo(e.panel).nombre}{puede(e.panel) ? "" : " · sin acceso"}
          </button>
        ))}
      </div>
    </div>
  );
}
