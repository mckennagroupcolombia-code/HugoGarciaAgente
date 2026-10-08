import { useEffect, useMemo, useRef, useState } from "react";
import { Cara } from "../../lib/fotoPersona";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { useAppStore } from "../../stores/app";
import { useTicketsAuth } from "../../stores/ticketsAuth";
import {
  useConversaciones, useTimeline, useAdjuntosConversacion, useMarcarVisto, useUsuariosEquipo,
  useEnviarMensajeConversacion, type Conversacion, type Adjunto, type TimelineEvento,
} from "../../hooks/useConversaciones";
import { api } from "../../api/client";
import {
  ESTADO_LABEL, ESTADO_PILL_CLASS, getDateLabel, horaDe, iniciales, tiempoRelativo, uidEq,
} from "../tickets/ticketsFormat";
import { ticketsUploadUrl } from "../../lib/profilePhoto";
import { Icon } from "../../icons";
import { useCanalesEquipo, useResumenMensajes } from "../../hooks/useCanalesEquipo";
import HiloCanal from "../chat_equipo/HiloCanal";
import BarraEscritura, { BotonCaja, IconoCamara, IconoClip } from "../chat_equipo/BarraEscritura";
import { guardarVistaMensajes } from "../chat_equipo/SelectorMensajes";
import { useAvisosMensajes, type AvisoMensaje } from "../../hooks/useAvisosMensajes";
import "../chat_equipo/chatEquipo.css";
import { colorDePersona } from "../../lib/personaColor";
import { useBandeja, useBandejaAngosta } from "../../lib/bandeja";
import { esSolicitudDePago, irASolicitudPago } from "../../lib/irAPago";
import { abrirCanalEnBandeja } from "../tickets/BandejaUnificada";
import { BotonZumbido } from "../../lib/zumbido";

/**
 * Burbuja de chat global (portal a body, mismo patrón que CrearSiigoFab): mensajería
 * instantánea del equipo sobre las solicitudes. La lista trae las abiertas de cada quien
 * (por hacer, en proceso, por finalizar) con su último mensaje; al tocar una se conversa
 * ahí mismo (leer, escribir, adjuntar fotos) y «⤢» la agranda. «＋ Nuevo chat» elige a
 * alguien del equipo y el asunto: crea la solicitud para esa persona (le llega el aviso por
 * WhatsApp, igual que desde el asistente) y abre su chat; si ya hay una abierta con ella,
 * la ofrece primero para no duplicar. Para pasos, cronómetro y cierre está «Abrir completo».
 * Se oculta dentro del propio Centro de Mando (panel "hugo"/"tickets"), donde el inbox ya
 * está a la vista.
 */

const CLAVE_VISTA = "mck_fab_chat_vista";

/** Dos conversaciones en la misma burbuja: las de las solicitudes y los grupos de trabajo (pestaña «Equipo»). */
type VistaFab = "solicitudes" | "grupos";

function leerVista(): VistaFab {
  try {
    return localStorage.getItem(CLAVE_VISTA) === "grupos" ? "grupos" : "solicitudes";
  } catch {
    return "solicitudes";
  }
}

/** Los canales traen segundos Unix (no la fecha del servidor de las solicitudes). */
function haceSeg(ts: number): string {
  const s = Date.now() / 1000 - ts;
  if (s < 60) return "recién";
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

type ItemChat =
  | { kind: "mensaje"; id: string; ts: string; ev: TimelineEvento }
  | { kind: "sistema"; id: string; ts: string; ev: TimelineEvento }
  | { kind: "adjunto"; id: string; ts: string; adjunto: Adjunto };

// Al subir una foto el hilo guarda además «📎 Imagen adjunta»: se muestra la foto, no ese texto.
const TEXTO_AUTO_ADJUNTO = /^📎\s*(\d+\s+)?(imagen|imágenes)\s+adjunt/i;

function esImagen(a: Adjunto) {
  return Boolean(a.mime?.startsWith("image/")) || /\.(jpe?g|png|gif|webp|heic)$/i.test(a.nombre_original);
}

function esAudio(a: Adjunto) {
  return Boolean(a.mime?.startsWith("audio/")) || /\.(webm|ogg|oga|opus|mp3|m4a|aac|wav)$/i.test(a.nombre_original);
}

/** `soloAvisos`: sin la bolita, solo las tarjetas con sonido (pantallas del celular fuera del
 *  Layout, como Mensajes en MobileHub). Tocar el aviso de un grupo lo abre en la bandeja. */
export default function SolicitudesEnProcesoFab({ soloAvisos = false }: { soloAvisos?: boolean } = {}) {
  const [abierta, setAbierta] = useState(false);
  const [chatId, setChatId] = useState<number | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [soloSinLeer, setSoloSinLeer] = useState(false);
  // La solicitud recién creada tarda un refresco en llegar a la lista: mientras, se usa esta.
  const [recien, setRecien] = useState<Conversacion | null>(null);
  const [vista, setVistaState] = useState<VistaFab>(leerVista);
  const [canalId, setCanalId] = useState<number | null>(null);

  const panel = useAppStore((s) => s.panel);
  const setPanel = useAppStore((s) => s.setPanel);
  const setCentroMandoView = useAppStore((s) => s.setCentroMandoView);
  const setSolicitudBoot = useAppStore((s) => s.setSolicitudBoot);
  const user = useTicketsAuth((s) => s.user);
  const resumenGrupos = useResumenMensajes(Boolean(user));
  const noLeidosGrupos = resumenGrupos.data?.canales_no_leidos ?? 0;
  const grupos = useCanalesEquipo(Boolean(user) && abierta && vista === "grupos");
  const listaGrupos = grupos.data?.canales ?? [];
  const canal = canalId != null ? listaGrupos.find((c) => c.id === canalId) ?? null : null;
  // Mensajes nuevos de los grupos: tarjeta con sonido (app a la vista) y push (app cerrada).
  const { aviso, cerrarAviso, permiso, activarAvisos } = useAvisosMensajes(
    Boolean(user), abierta && vista === "grupos" ? canalId : null,
  );

  function setVista(v: VistaFab) {
    setVistaState(v);
    setCanalId(null);
    try {
      localStorage.setItem(CLAVE_VISTA, v);
    } catch {
      /* sin localStorage: solo esta vez */
    }
  }

  const { data: conversaciones = [] } = useConversaciones("todas", "mias");
  const enProceso = conversaciones
    .filter((c) => c.estado === "pendiente" || c.estado === "en_proceso" || c.estado === "esperando_aprobacion")
    .sort((a, b) => b.ultima_actividad.localeCompare(a.ultima_actividad));
  const noLeidos = enProceso.reduce((n, c) => n + (c.no_leidos || 0), 0);
  // El número de la bolita es el mismo de la barra de abajo y de la bandeja: lo que te toca +
  // lo que tiene algo nuevo (lib/bandeja.ts). En pantalla angosta tocarla lleva a la bandeja.
  const porAtender = useBandeja().porAtender;
  const angosta = useBandejaAngosta();
  const visibles = soloSinLeer ? enProceso.filter((c) => c.no_leidos > 0) : enProceso;
  const chat = chatId != null
    ? enProceso.find((c) => c.id === chatId) ?? (recien?.id === chatId ? recien : null)
    : null;

  useEffect(() => {
    if (!abierta) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (canalId != null) setCanalId(null);
      else if (chatId != null) setChatId(null);
      else if (nuevo) setNuevo(false);
      else setAbierta(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [abierta, chatId, nuevo, canalId]);

  function abrirChat(c: Conversacion) {
    // «Aprobar pago — …» se aprueba en Solicitudes de pago, no en el chat de la solicitud.
    if (esSolicitudDePago(c)) { setAbierta(false); irASolicitudPago(c.pago_id); return; }
    setNuevo(false);
    setChatId(c.id);
  }

  // Si la conversación abierta se cerró (resuelta) sale de la lista: volver a la lista.
  useEffect(() => {
    if (chatId != null && !chat) setChatId(null);
  }, [chatId, chat]);

  // ✕ cierra y deja la burbuja en la lista; «—» solo la minimiza y conserva la conversación abierta.
  function cerrar() {
    setAbierta(false);
    setChatId(null);
    setCanalId(null);
    setNuevo(false);
  }

  // Siempre visible (sirve para empezar un chat), salvo sin sesión o dentro del Centro de Mando.
  // En el chat del equipo tampoco: la bolita tapaba el botón de enviar (el aviso sí sale).
  const enCentroMando = panel === "hugo" || panel === "tickets" || panel === "chat-equipo";
  useEffect(() => {
    if (enCentroMando) setAbierta(false);
  }, [enCentroMando]);
  if (!user) return null;
  if (typeof document === "undefined") return null;

  /** Tocar el aviso abre ese grupo: en la burbuja o, dentro de la Agenda, en Mensajes → Grupos. */
  function abrirAviso(a: AvisoMensaje) {
    cerrarAviso();
    if (soloAvisos) {
      const st = useAppStore.getState();
      st.setMobileTab("mensajes");
      if (a.tipo === "solicitud" || a.tipo === "zumbido") st.setSolicitudBoot({ abrirTicketId: a.id });
      else window.setTimeout(() => abrirCanalEnBandeja(a.canal_id), 250);
      return;
    }
    if (a.tipo === "solicitud" || a.tipo === "zumbido") {
      setCentroMandoView("mensajes");
      setSolicitudBoot({ abrirTicketId: a.id });
      setPanel("hugo");
      setAbierta(false);
      return;
    }
    if (enCentroMando) {
      guardarVistaMensajes("grupos");
      try {
        sessionStorage.setItem("mck-chat-equipo-canal", String(a.canal_id));
      } catch {
        /* sin almacenamiento */
      }
      setPanel("chat-equipo");
      return;
    }
    setVista("grupos");
    setCanalId(a.canal_id);
    setAbierta(true);
  }

  const esSolicitud = aviso?.tipo === "solicitud" || aviso?.tipo === "zumbido";
  const tarjetaAviso = aviso && (
    <div className={`mck-aviso-entra pointer-events-auto flex w-[min(calc(100vw-1.5rem),22rem)] items-start gap-2.5 rounded-paper-lg border-2 bg-surface-panel p-3 shadow-paper-lg ${
      esSolicitud ? "border-amber-400" : "border-accent/60"}`}
      role="status" aria-live="polite">
      <button type="button" onClick={() => abrirAviso(aviso)} className="mck-btn-no-fx flex min-w-0 flex-1 items-start gap-2.5 text-left">
        <Cara nombre={aviso.autor_nombre}
          className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-black text-white"
          style={{ background: colorDePersona(aviso.autor_nombre) }} fallback={iniciales(aviso.autor_nombre)}
          extra={aviso.icono && <span className="absolute -bottom-1 -right-1 text-[15px] leading-none" aria-hidden>{aviso.icono}</span>} />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-bold uppercase tracking-wide text-muted">
            {aviso.tipo === "zumbido" ? `📳 Te envió un zumbido · ${aviso.canal_nombre}` : esSolicitud ? `Te pidió algo · ${aviso.canal_nombre}` : aviso.mencion ? `@ Te mencionó · ${aviso.canal_nombre}` : aviso.canal_nombre}
          </span>
          <span className="block truncate text-[14px] font-bold text-ink">{aviso.autor_nombre}</span>
          <span className="line-clamp-2 block text-[13.5px] leading-snug text-ink-secondary">{aviso.texto}</span>
        </span>
      </button>
      <button type="button" onClick={cerrarAviso} className="mck-btn-no-fx px-1 text-[14px] text-muted hover:text-ink" aria-label="Cerrar aviso">✕</button>
    </div>
  );

  // Dentro de la Agenda la burbuja se oculta (el inbox ya está a la vista), pero el aviso sí sale.
  if (enCentroMando || soloAvisos) {
    if (!tarjetaAviso) return null;
    return createPortal(
      <div className="pointer-events-none fixed bottom-5 right-5 z-[900] max-md:bottom-[5.5rem] sm:bottom-6 sm:right-6"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        {tarjetaAviso}
      </div>,
      document.body,
    );
  }

  function irA(c?: Conversacion) {
    setCentroMandoView("mensajes");
    setSolicitudBoot(c ? { abrirTicketId: c.id } : null);
    setPanel("hugo");
    setAbierta(false);
  }

  return createPortal(
    <div
      className="pointer-events-none fixed bottom-5 right-5 z-[900] flex flex-col items-end gap-3 max-md:bottom-[5.5rem] sm:bottom-6 sm:right-6"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {!(abierta && vista === "grupos" && canalId === aviso?.canal_id) && tarjetaAviso}
      {abierta && (
        <div
          // Siempre al tamaño máximo: todo el alto libre sobre la bolita (en el celular, sobre la barra de abajo).
          className="pointer-events-auto flex h-[min(calc(100dvh-7rem),52rem)] w-[min(calc(100vw-1.5rem),42rem)] flex-col overflow-hidden rounded-paper-lg border-2 border-accent/50 bg-surface-panel shadow-paper-lg max-md:h-[calc(100dvh-10.5rem)]"
          role="dialog"
          aria-label="Chat del equipo"
        >
          <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-accent/10 px-2 py-1.5">
            {vista === "grupos" && canal ? (
              <>
                <button
                  type="button"
                  onClick={() => setCanalId(null)}
                  className="rounded-lg px-1.5 py-0.5 text-lg font-black leading-none text-accent hover:bg-surface-hover"
                  title="Volver a los grupos"
                  aria-label="Volver a los grupos"
                >
                  ‹
                </button>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-black text-accent">
                  {canal.nombre.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold text-ink">{canal.nombre}</p>
                  <p className="truncate text-[10px] text-muted">
                    {canal.descripcion || (canal.miembros.length ? `${canal.miembros.length} miembros` : "Todo el equipo")}
                  </p>
                </div>
              </>
            ) : vista === "solicitudes" && chat ? (
              <>
                <button
                  type="button"
                  onClick={() => setChatId(null)}
                  className="rounded-lg px-1.5 py-0.5 text-lg font-black leading-none text-accent hover:bg-surface-hover"
                  title="Volver a la lista"
                  aria-label="Volver a la lista"
                >
                  ‹
                </button>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-black text-accent">
                  {iniciales(chat.contraparte_nombre)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold text-ink">{chat.titulo}</p>
                  <p className="truncate text-[10px] text-muted">
                    {chat.contraparte_nombre ?? "Sin asignar"} · {ESTADO_LABEL[chat.estado] ?? chat.estado}
                  </p>
                </div>
                {chat.contraparte_id != null && (
                  <BotonZumbido ticketId={chat.id} conTexto={false}
                    className="rounded-lg px-1.5 py-0.5 text-[15px] leading-none hover:bg-surface-hover" />
                )}
              </>
            ) : vista === "solicitudes" && nuevo ? (
              <>
                <button
                  type="button"
                  onClick={() => setNuevo(false)}
                  className="rounded-lg px-1.5 py-0.5 text-lg font-black leading-none text-accent hover:bg-surface-hover"
                  title="Volver a la lista"
                  aria-label="Volver a la lista"
                >
                  ‹
                </button>
                <span className="min-w-0 flex-1 truncate text-[12px] font-extrabold uppercase tracking-wide text-accent">
                  Nuevo chat
                </span>
              </>
            ) : (
              <div className="flex min-w-0 flex-1 items-center gap-1 px-0.5" role="tablist" aria-label="Tipo de chat">
                {([
                  ["solicitudes", `Solicitudes (${enProceso.length})`, noLeidos],
                  ["grupos", "Grupos", noLeidosGrupos],
                ] as const).map(([v, texto, n]) => (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={vista === v}
                    onClick={() => setVista(v)}
                    className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide transition ${
                      vista === v ? "bg-accent text-white" : "text-accent hover:bg-accent/10"
                    }`}
                  >
                    {texto}
                    {n > 0 && (
                      <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-emerald-500 px-1 text-[9.5px] text-white">
                        {n > 99 ? "99+" : n}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setAbierta(false)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-hover hover:text-ink"
              title="Minimizar (la conversación queda abierta)"
              aria-label="Minimizar el chat"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                <path d="M5 18h14" />
              </svg>
            </button>
            <button
              type="button"
              onClick={cerrar}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-sm text-muted hover:bg-surface-hover hover:text-ink"
              title="Cerrar"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>

          {vista === "grupos" ? (
            canal ? (
              <HiloCanal key={canal.id} canal={canal} compacto />
            ) : (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {permiso === "pendiente" && (
                    <button type="button" onClick={() => void activarAvisos()}
                      className="mck-btn-no-fx flex w-full items-center gap-2 border-b border-border/40 bg-accent/10 px-3 py-2 text-left text-[12px] font-bold text-accent hover:bg-accent/15">
                      🔔 Activar avisos de mensajes en este dispositivo
                    </button>
                  )}
                  {permiso === "bloqueado" && (
                    <p className="border-b border-border/40 px-3 py-2 text-[11px] text-muted">
                      Los avisos están bloqueados en este navegador. Para recibirlos, permite las notificaciones de bot.mckennagroup.co en la configuración del sitio.
                    </p>
                  )}
                  {grupos.isLoading && <p className="px-4 py-6 text-center text-[12.5px] text-muted">Cargando grupos…</p>}
                  {!grupos.isLoading && listaGrupos.length === 0 && (
                    <p className="px-4 py-10 text-center text-[13px] text-muted">Todavía no hay grupos del equipo.</p>
                  )}
                  {listaGrupos.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setCanalId(g.id)}
                      className="flex w-full items-start gap-2.5 border-b border-border/40 px-3 py-2.5 text-left transition hover:bg-surface-hover"
                    >
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[12px] font-black text-accent">
                        {g.nombre.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{g.nombre}</span>
                          {g.ultimo && <span className="shrink-0 text-[10px] text-muted/70">{haceSeg(g.ultimo.creado_en)}</span>}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <span className={`min-w-0 flex-1 truncate text-[12px] ${g.no_leidos > 0 ? "font-semibold text-ink" : "text-muted"}`}>
                            {g.ultimo
                              ? `${(g.ultimo.autor_nombre || "").split(" ")[0]}: ${g.ultimo.texto || (g.ultimo.adjunto_nombre ? "📎 adjunto" : "🔗 enlace")}`
                              : g.descripcion || "Sin mensajes todavía"}
                          </span>
                          {g.no_leidos > 0 && (
                            <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white">
                              {g.no_leidos > 99 ? "99+" : g.no_leidos}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => { guardarVistaMensajes("grupos"); setPanel("chat-equipo"); setAbierta(false); }}
                  className="shrink-0 border-t border-border px-3 py-2 text-center text-[12px] font-bold text-accent hover:bg-accent/5"
                >
                  Ver todo en Mensajes →
                </button>
              </>
            )
          ) : chat ? (
            <ChatHilo key={chat.id} conversacion={chat} onAbrirCompleto={() => irA(chat)} />
          ) : nuevo ? (
            <NuevoChat
              abiertas={enProceso}
              onAbrir={abrirChat}
              onCreada={(c) => { setRecien(c); abrirChat(c); }}
            />
          ) : (
            <>
              <div className="flex shrink-0 items-center gap-1.5 border-b border-border/40 px-2.5 py-2">
                <button
                  type="button"
                  onClick={() => setNuevo(true)}
                  className="flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-[12px] font-bold text-white hover:brightness-110"
                >
                  <Icon name="plus" size={13} weight="bold" /> Nuevo chat
                </button>
                <div className="flex-1" />
                {(["todas", "sin_leer"] as const).map((f) => {
                  const activo = (f === "sin_leer") === soloSinLeer;
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setSoloSinLeer(f === "sin_leer")}
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition ${
                        activo ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:text-ink"
                      }`}
                    >
                      {f === "todas" ? "Todas" : `Sin leer${noLeidos > 0 ? ` (${noLeidos})` : ""}`}
                    </button>
                  );
                })}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {visibles.length === 0 && (
                  <div className="space-y-2 px-4 py-10 text-center">
                    <p className="text-[13px] text-muted">
                      {soloSinLeer ? "Estás al día: no hay mensajes sin leer." : "No tienes chats abiertos."}
                    </p>
                    {!soloSinLeer && (
                      <button type="button" onClick={() => setNuevo(true)}
                        className="text-[12px] font-bold text-accent hover:underline">
                        Escríbele a alguien del equipo →
                      </button>
                    )}
                  </div>
                )}
                {visibles.map((c) => {
                  const mio = uidEq(c.ultimo_usuario_id, user.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => abrirChat(c)}
                      className="flex w-full items-start gap-2.5 border-b border-border/40 px-3 py-2.5 text-left transition hover:bg-surface-hover"
                    >
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[12px] font-black text-accent">
                        {iniciales(c.contraparte_nombre)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{c.titulo}</span>
                          <span className="shrink-0 text-[10px] text-muted/70">{tiempoRelativo(c.ultima_actividad)}</span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <span className={`min-w-0 flex-1 truncate text-[12px] ${c.no_leidos > 0 ? "font-semibold text-ink" : "text-muted"}`}>
                            {c.ultimo_texto
                              ? `${mio ? "Tú" : (c.ultimo_autor ?? "").split(" ")[0] || "?"}: ${c.ultimo_texto}`
                              : "Sin mensajes todavía"}
                          </span>
                          {c.no_leidos > 0 && (
                            <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white">
                              {c.no_leidos > 99 ? "99+" : c.no_leidos}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-[10px]">
                          <span className={`shrink-0 rounded px-1.5 py-0.5 font-bold uppercase tracking-wide ${ESTADO_PILL_CLASS[c.estado] ?? "bg-muted/10 text-muted"}`}>
                            {ESTADO_LABEL[c.estado] ?? c.estado}
                          </span>
                          <span className="min-w-0 truncate text-muted/80">{c.contraparte_nombre}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => irA()}
                className="shrink-0 border-t border-border px-3 py-2 text-center text-[12px] font-bold text-accent hover:bg-accent/5"
              >
                Ver todo en Mensajes →
              </button>
            </>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => (angosta && !abierta ? irA() : setAbierta((v) => !v))}
        className={`pointer-events-auto group relative flex h-14 w-14 items-center justify-center rounded-full border-2 shadow-paper-lg transition active:scale-95 ${
          abierta
            ? "border-accent bg-accent text-white"
            : "border-accent/70 bg-surface-panel text-accent hover:border-accent hover:bg-accent hover:text-white"
        }`}
        title={porAtender > 0 ? `${porAtender} por atender` : "Chat del equipo"}
        aria-label={abierta ? "Cerrar chat del equipo" : "Abrir chat del equipo"}
        aria-expanded={abierta}
      >
        {porAtender > 0 && (
          <span
            className={`absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-black text-white shadow-sm ${
              noLeidos + noLeidosGrupos > 0 ? "bg-emerald-500 animate-pulse" : "bg-accent"
            }`}
          >
            {porAtender > 99 ? "99+" : porAtender}
          </span>
        )}
        <Icon name="chat" size={24} weight={abierta ? "bold" : "regular"} />
      </button>
    </div>,
    document.body,
  );
}

function ChatHilo({ conversacion, onAbrirCompleto }: { conversacion: Conversacion; onAbrirCompleto: () => void }) {
  const user = useTicketsAuth((s) => s.user);
  const token = useTicketsAuth((s) => s.token) ?? "";
  const { data: eventos = [], isLoading } = useTimeline(conversacion.id);
  const { data: adjuntos = [] } = useAdjuntosConversacion(conversacion.id);
  const marcarVisto = useMarcarVisto();
  const enviar = useEnviarMensajeConversacion();
  const [texto, setTexto] = useState("");
  const [archivos, setArchivos] = useState<File[]>([]);
  const [error, setError] = useState("");
  const finRef = useRef<HTMLDivElement>(null);
  const archivoRef = useRef<HTMLInputElement>(null);
  const fotoRef = useRef<HTMLInputElement>(null);

  const items = useMemo<ItemChat[]>(() => {
    const out: ItemChat[] = [];
    for (const ev of eventos) {
      if (ev.tipo === "sistema") {
        if (ev.accion !== "adjunto_agregado") out.push({ kind: "sistema", id: `s-${ev.id}`, ts: ev.creado_en, ev });
      } else if (!TEXTO_AUTO_ADJUNTO.test(ev.texto.trim())) {
        out.push({ kind: "mensaje", id: `m-${ev.id}`, ts: ev.creado_en, ev });
      }
    }
    for (const a of adjuntos) out.push({ kind: "adjunto", id: `a-${a.id}`, ts: a.creado_en, adjunto: a });
    return out.sort((x, y) => x.ts.localeCompare(y.ts));
  }, [eventos, adjuntos]);

  const conNoLeidos = conversacion.no_leidos > 0;
  useEffect(() => {
    if (conNoLeidos) marcarVisto.mutate(conversacion.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversacion.id, conNoLeidos]);

  useEffect(() => {
    finRef.current?.scrollIntoView({ block: "end" });
  }, [items.length]);

  async function mandar() {
    if ((!texto.trim() && archivos.length === 0) || enviar.isPending) return;
    setError("");
    try {
      await enviar.mutateAsync({ ticketId: conversacion.id, texto, archivos });
      setTexto("");
      setArchivos([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar");
    }
  }

  // La nota de voz sale sola al terminar de grabar; lo escrito se queda en la caja.
  async function mandarVoz(voz: File) {
    setError("");
    try {
      await enviar.mutateAsync({ ticketId: conversacion.id, texto: "", archivos: [voz] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar la nota de voz");
    }
  }

  function agregarArchivos(lista: FileList | File[] | null | undefined) {
    const nuevos = Array.from(lista ?? []).filter((f) => f.type.startsWith("image/") || /\.pdf$/i.test(f.name));
    if (nuevos.length) setArchivos((prev) => [...prev, ...nuevos]);
  }

  return (
    <>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto bg-surface/50 px-3 py-3">
        {isLoading && items.length === 0 && <p className="py-6 text-center text-xs text-muted">Cargando mensajes…</p>}
        {!isLoading && items.length === 0 && (
          <p className="py-6 text-center text-xs italic text-muted">Aún no hay mensajes. Escribe abajo para empezar.</p>
        )}
        {items.map((it, idx) => {
          const fecha = getDateLabel(it.ts);
          const sep = fecha && fecha !== (idx > 0 ? getDateLabel(items[idx - 1].ts) : null);
          const separador = sep ? (
            <div key={`sep-${it.id}`} className="flex items-center gap-2 py-1.5">
              <div className="h-px flex-1 bg-border/40" />
              <span className="px-1 text-[10px] font-medium text-muted/70">{fecha}</span>
              <div className="h-px flex-1 bg-border/40" />
            </div>
          ) : null;
          if (it.kind === "sistema") {
            return (
              <div key={it.id}>
                {separador}
                <p className="px-4 text-center text-[10px] italic text-muted/80">{it.ev.texto}</p>
              </div>
            );
          }
          const autorId = it.kind === "mensaje" ? it.ev.usuario_id : it.adjunto.creado_por;
          const autor = it.kind === "mensaje" ? it.ev.autor_nombre : it.adjunto.creado_por_nombre;
          const mio = uidEq(autorId ?? null, user?.id);
          const burbuja = mio
            ? "rounded-br-sm bg-accent text-white"
            : "rounded-bl-sm border border-border bg-surface-panel text-ink";
          return (
            <div key={it.id}>
              {separador}
              <div className={`flex ${mio ? "justify-end" : "justify-start"}`}>
                <div className="max-w-[82%] space-y-0.5">
                  {!mio && <p className="px-1 text-[10px] font-bold text-muted">{autor ?? "?"}</p>}
                  {it.kind === "adjunto" ? (
                    esAudio(it.adjunto) ? (
                      <audio src={ticketsUploadUrl(it.adjunto.nombre_archivo, token)} controls preload="metadata" className="h-10 w-60 max-w-full" />
                    ) : esImagen(it.adjunto) ? (
                      <a href={ticketsUploadUrl(it.adjunto.nombre_archivo, token)} target="_blank" rel="noreferrer"
                        className="block overflow-hidden rounded-2xl border border-border" title="Ver imagen completa">
                        <img src={ticketsUploadUrl(it.adjunto.nombre_archivo, token)} alt={it.adjunto.nombre_original}
                          className="max-h-56 w-full max-w-[240px] object-cover" />
                      </a>
                    ) : (
                      <a href={ticketsUploadUrl(it.adjunto.nombre_archivo, token)} target="_blank" rel="noreferrer"
                        className={`flex items-center gap-1.5 rounded-2xl px-3 py-2 text-xs ${burbuja}`}>
                        <Icon name="paperclip" size={13} />
                        <span className="truncate underline underline-offset-2">{it.adjunto.nombre_original}</span>
                      </a>
                    )
                  ) : (
                    <div className={`rounded-2xl px-3 py-2 text-[13px] leading-relaxed shadow-sm ${burbuja}`}>
                      <p className="whitespace-pre-wrap break-words">{it.ev.texto}</p>
                    </div>
                  )}
                  <p className={`px-1 text-[10px] text-muted/70 ${mio ? "text-right" : ""}`}>{horaDe(it.ts)}</p>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={finRef} />
      </div>

      <div className="shrink-0 space-y-1.5 border-t border-border/60 bg-surface px-2 py-2">
        {archivos.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {archivos.map((f, i) => (
              <span key={`${f.name}-${i}`} className="flex max-w-[10rem] items-center gap-1 rounded-lg border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] text-accent">
                <Icon name="paperclip" size={11} />
                <span className="truncate">{f.name || "captura.png"}</span>
                <button type="button" onClick={() => setArchivos((p) => p.filter((_, j) => j !== i))}
                  className="font-bold hover:text-red-500" aria-label="Quitar archivo">✕</button>
              </span>
            ))}
          </div>
        )}
        {error && <p className="text-[11px] text-red-500">{error}</p>}
        <button type="button" onClick={onAbrirCompleto}
          className="mck-btn-no-fx block px-1 text-[11px] font-bold text-accent hover:underline"
          title="Pasos, cronómetro y cerrar la solicitud">
          Abrir completo →
        </button>
        <input ref={archivoRef} type="file" accept="image/*,.pdf,application/pdf" multiple className="sr-only"
          onChange={(e) => { agregarArchivos(e.target.files); e.target.value = ""; }} />
        <input ref={fotoRef} type="file" accept="image/*" capture="environment" className="sr-only"
          onChange={(e) => { agregarArchivos(e.target.files); e.target.value = ""; }} />
        <BarraEscritura
          texto={texto} onTexto={(t) => setTexto(t.slice(0, 2000))} onEnviar={() => void mandar()} onVoz={(f) => void mandarVoz(f)}
          hayAdjunto={archivos.length > 0} enviando={enviar.isPending} onError={setError}
          onPaste={(e) => {
            const imgs = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
            if (imgs.length) {
              e.preventDefault();
              agregarArchivos(imgs);
            }
          }}
          iconos={<BotonCaja onClick={() => archivoRef.current?.click()} titulo="Adjuntar foto o PDF"><IconoClip /></BotonCaja>}
          iconosSinTexto={<BotonCaja onClick={() => fotoRef.current?.click()} titulo="Tomar una foto"><IconoCamara /></BotonCaja>}
        />
      </div>
    </>
  );
}

type SolicitudPasada = {
  id: number; titulo: string; estado: string;
  creado_por: number | null; asignado_a: number | null;
  creado_en?: string | null; actualizado_en?: string | null;
};
type ProcedimientoLite = { id: number; titulo: string; categoria?: string | null; pasos?: unknown[] };
type Sugerencia = { clave: string; titulo: string; detalle: string; protocoloId?: number };

function normalizar(t: string) {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Sugerencias para «¿Sobre qué es?»: primero los temas que ya se han tratado con esa
 * persona (en cualquier sentido, más repetidos y recientes primero; las abiertas no, ya
 * salen arriba como «Seguir»), luego los procedimientos del equipo, que al elegirse crean
 * la solicitud con sus pasos. Al escribir se filtran por palabras.
 */
function sugerenciasPara(
  personaId: number, miId: number, pasadas: SolicitudPasada[], procedimientos: ProcedimientoLite[],
  abiertas: Conversacion[], escrito: string,
): Sugerencia[] {
  const abiertasN = new Set(abiertas.filter((c) => uidEq(c.contraparte_id, personaId)).map((c) => normalizar(c.titulo)));
  const temas = new Map<string, { titulo: string; veces: number; ultima: string }>();
  for (const t of pasadas) {
    const conElla = (uidEq(t.creado_por, miId) && uidEq(t.asignado_a, personaId))
      || (uidEq(t.creado_por, personaId) && uidEq(t.asignado_a, miId));
    if (!conElla || !t.titulo?.trim()) continue;
    const k = normalizar(t.titulo);
    if (abiertasN.has(k)) continue;
    const fecha = t.actualizado_en || t.creado_en || "";
    const prev = temas.get(k);
    if (prev) {
      prev.veces += 1;
      if (fecha > prev.ultima) { prev.ultima = fecha; prev.titulo = t.titulo.trim(); }
    } else {
      temas.set(k, { titulo: t.titulo.trim(), veces: 1, ultima: fecha });
    }
  }
  const palabras = normalizar(escrito).split(" ").filter((w) => w.length > 1);
  const coincide = (titulo: string) => {
    const n = normalizar(titulo);
    return palabras.every((w) => n.includes(w)) && n !== normalizar(escrito);
  };
  const conPersona: Sugerencia[] = [...temas.entries()]
    .filter(([, v]) => coincide(v.titulo))
    .sort((a, b) => b[1].veces - a[1].veces || b[1].ultima.localeCompare(a[1].ultima))
    .slice(0, palabras.length ? 6 : 5)
    .map(([k, v]) => ({
      clave: `t-${k}`, titulo: v.titulo,
      detalle: v.veces > 1 ? `${v.veces} veces` : "1 vez",
    }));
  const vistos = new Set(conPersona.map((x) => normalizar(x.titulo)));
  const procs: Sugerencia[] = procedimientos
    .filter((p) => p.titulo?.trim() && !vistos.has(normalizar(p.titulo)) && coincide(p.titulo))
    .slice(0, palabras.length ? 5 : 3)
    .map((p) => ({
      clave: `p-${p.id}`, titulo: p.titulo.trim(), protocoloId: p.id,
      detalle: p.pasos?.length ? `procedimiento · ${p.pasos.length} pasos` : "procedimiento",
    }));
  return [...conPersona, ...procs];
}

/** «Nuevo chat»: con quién y sobre qué. Crea una solicitud para esa persona y abre su chat. */
function NuevoChat({
  abiertas, onAbrir, onCreada,
}: {
  abiertas: Conversacion[];
  onAbrir: (c: Conversacion) => void;
  onCreada: (c: Conversacion) => void;
}) {
  const user = useTicketsAuth((s) => s.user);
  const qc = useQueryClient();
  const { data: equipo = [], isLoading } = useUsuariosEquipo();
  const [busqueda, setBusqueda] = useState("");
  const [personaId, setPersonaId] = useState<number | null>(null);
  const [asunto, setAsunto] = useState("");
  // Procedimiento elegido de las sugerencias: se manda con la solicitud (trae sus pasos)
  // mientras el asunto siga siendo su nombre.
  const [procElegido, setProcElegido] = useState<{ id: number; titulo: string } | null>(null);
  const { data: pasadas = [] } = useQuery<SolicitudPasada[]>({
    queryKey: ["fab-chat-solicitudes-pasadas"],
    queryFn: () => api.get("/api/tickets/?tipo=solicitud"),
    staleTime: 5 * 60 * 1000,
  });
  const { data: procedimientos = [] } = useQuery<ProcedimientoLite[]>({
    queryKey: ["fab-chat-procedimientos"],
    queryFn: () => api.get("/api/tickets/protocolos"),
    staleTime: 10 * 60 * 1000,
  });
  const [mensaje, setMensaje] = useState("");
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState("");

  const personas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return equipo
      .filter((u) => u.activo !== 0 && !uidEq(u.id, user?.id))
      .filter((u) => !q || u.nombre.toLowerCase().includes(q) || (u.username ?? "").toLowerCase().includes(q))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [equipo, busqueda, user?.id]);
  const persona = personaId != null ? equipo.find((u) => u.id === personaId) ?? null : null;
  const conElla = persona ? abiertas.filter((c) => uidEq(c.contraparte_id, persona.id)) : [];
  const sugerencias = persona && user
    ? sugerenciasPara(
      persona.id, user.id,
      Array.isArray(pasadas) ? pasadas : [],
      Array.isArray(procedimientos) ? procedimientos : [],
      abiertas, asunto,
    )
    : [];
  const protocoloId = procElegido && normalizar(procElegido.titulo) === normalizar(asunto) ? procElegido.id : null;

  async function iniciar() {
    if (!persona || !asunto.trim() || creando || !user) return;
    setCreando(true);
    setError("");
    try {
      const t = await api.post<{ id: number; numero?: string }>("/api/tickets/", {
        titulo: asunto.trim(),
        descripcion: "",
        categoria: "logistica",
        prioridad: "media",
        asignado_a: persona.id,
        tipo: "solicitud",
        ...(protocoloId ? { protocolo_id: protocoloId } : {}),
      });
      if (mensaje.trim()) {
        await api.post(`/api/tickets/${t.id}/comentarios`, { texto: mensaje.trim() });
      }
      qc.invalidateQueries({ queryKey: ["tickets-conversaciones"] });
      const ahora = new Date().toISOString().slice(0, 19).replace("T", " ");
      onCreada({
        id: t.id, numero: t.numero ?? "", titulo: asunto.trim(), tipo: "solicitud", subtipo: null,
        estado: "pendiente", prioridad: "media", creado_por: user.id, asignado_a: persona.id,
        creado_en: ahora, actualizado_en: ahora, creado_por_nombre: user.nombre ?? null,
        asignado_a_nombre: persona.nombre, adjuntos_total: 0, ultimo_texto: mensaje.trim() || null,
        ultimo_en: null, ultimo_usuario_id: user.id, ultimo_autor: user.nombre ?? null, no_leidos: 0,
        contraparte_id: persona.id, contraparte_nombre: persona.nombre, ultima_actividad: ahora,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el chat");
      setCreando(false);
    }
  }

  const campo = "w-full rounded-xl border-2 border-border bg-surface-panel px-2.5 py-1.5 text-[13px] text-ink placeholder:text-muted focus:border-accent focus:outline-none";

  if (!persona) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 space-y-1.5 px-3 pt-3 pb-2">
          <p className="text-[12px] font-bold text-ink">¿Con quién quieres hablar?</p>
          <input
            autoFocus
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar en el equipo…"
            className={campo}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading && <p className="py-6 text-center text-xs text-muted">Cargando equipo…</p>}
          {!isLoading && personas.length === 0 && (
            <p className="py-6 text-center text-xs text-muted">Nadie coincide con «{busqueda.trim()}».</p>
          )}
          {personas.map((u) => {
            const abiertasCon = abiertas.filter((c) => uidEq(c.contraparte_id, u.id)).length;
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => setPersonaId(u.id)}
                className="flex w-full items-center gap-2.5 border-b border-border/40 px-3 py-2 text-left transition hover:bg-surface-hover"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-black text-accent">
                  {iniciales(u.nombre)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink">{u.nombre}</span>
                  {u.rol?.nombre && <span className="block truncate text-[10px] text-muted">{u.rol.nombre}</span>}
                </span>
                {abiertasCon > 0 && (
                  <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">
                    {abiertasCon} abierta{abiertasCon !== 1 ? "s" : ""}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[12px] font-black text-accent">
            {iniciales(persona.nombre)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold text-ink">{persona.nombre}</p>
            <button type="button" onClick={() => setPersonaId(null)} className="text-[11px] font-semibold text-accent hover:underline">
              Cambiar persona
            </button>
          </div>
        </div>

        {conElla.length > 0 && (
          <div className="space-y-1.5 rounded-xl border border-accent/30 bg-accent/5 p-2.5">
            <p className="text-[11px] font-bold text-ink">
              Ya tienes {conElla.length === 1 ? "un chat abierto" : `${conElla.length} chats abiertos`} con {persona.nombre.split(" ")[0]}:
            </p>
            {conElla.slice(0, 4).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onAbrir(c)}
                className="flex w-full items-center gap-1.5 rounded-lg border border-border bg-surface-panel px-2.5 py-1.5 text-left hover:border-accent"
              >
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink">{c.titulo}</span>
                <span className="shrink-0 text-[11px] font-bold text-accent">Seguir ›</span>
              </button>
            ))}
            <p className="text-[10px] text-muted">O empieza uno nuevo sobre otro tema:</p>
          </div>
        )}

        <label className="block space-y-1">
          <span className="text-[12px] font-bold text-ink">¿Sobre qué es? <span className="font-normal text-muted">(la solicitud)</span></span>
          <input
            autoFocus
            value={asunto}
            onChange={(e) => setAsunto(e.target.value)}
            maxLength={140}
            placeholder="Ej.: Etiquetar el lote de neem de hoy"
            className={campo}
          />
        </label>
        {sugerencias.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              {asunto.trim() ? "Parecidos" : `Sugerencias con ${persona.nombre.split(" ")[0]}`}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {sugerencias.map((sg) => (
                <button
                  key={sg.clave}
                  type="button"
                  onClick={() => {
                    setAsunto(sg.titulo);
                    setProcElegido(sg.protocoloId ? { id: sg.protocoloId, titulo: sg.titulo } : null);
                  }}
                  title={sg.protocoloId ? "Crea la solicitud con los pasos de este procedimiento" : "Tema que ya trataron"}
                  className={`max-w-full rounded-full border px-2.5 py-1 text-left text-[11px] transition hover:border-accent hover:text-accent ${
                    sg.protocoloId ? "border-accent/40 bg-accent/5 text-ink" : "border-border bg-surface-panel text-ink"
                  }`}
                >
                  <span className="font-semibold">{sg.protocoloId ? "📋 " : "↺ "}{sg.titulo}</span>
                  <span className="ml-1 text-[10px] text-muted">· {sg.detalle}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {protocoloId && (
          <p className="rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-[11px] text-ink">
            📋 Se crea con los pasos del procedimiento «{procElegido?.titulo}».
          </p>
        )}
        <label className="block space-y-1">
          <span className="text-[12px] font-bold text-ink">Mensaje <span className="font-normal text-muted">(opcional)</span></span>
          <textarea
            value={mensaje}
            onChange={(e) => setMensaje(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void iniciar();
              }
            }}
            rows={3}
            maxLength={2000}
            placeholder="Escribe lo que necesitas…"
            className={`${campo} resize-none`}
          />
        </label>
        {error && <p className="text-[11px] text-red-500">{error}</p>}
      </div>
      <div className="shrink-0 space-y-1 border-t border-border/60 bg-surface px-3 py-2">
        <button
          type="button"
          disabled={!asunto.trim() || creando}
          onClick={() => void iniciar()}
          className="quest-btn-primary w-full py-2 text-[13px] font-bold disabled:opacity-40"
        >
          {creando ? "Creando…" : `Iniciar chat con ${persona.nombre.split(" ")[0]}`}
        </button>
        <p className="text-center text-[10px] text-muted">
          Queda como solicitud para {persona.nombre.split(" ")[0]} y le llega el aviso por WhatsApp.
        </p>
      </div>
    </div>
  );
}
