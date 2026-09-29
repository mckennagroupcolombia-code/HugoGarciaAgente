import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "../../stores/app";
import { useTicketsAuth } from "../../stores/ticketsAuth";
import {
  useConversaciones, useTimeline, useAdjuntosConversacion, useMarcarVisto,
  useEnviarMensajeConversacion, type Conversacion, type Adjunto, type TimelineEvento,
} from "../../hooks/useConversaciones";
import {
  ESTADO_LABEL, ESTADO_PILL_CLASS, getDateLabel, horaDe, iniciales, tiempoRelativo, uidEq,
} from "../tickets/ticketsFormat";
import { ticketsUploadUrl } from "../../lib/profilePhoto";
import { Icon } from "../../icons";

/**
 * Burbuja flotante global (portal a body, mismo patrón que CrearSiigoFab): mientras el
 * usuario navega por otros paneles, recuerda sus solicitudes/acciones "en proceso" o
 * "esperando aprobación" (mismo agrupado que la pestaña Mensajes del Centro de Mando).
 * Funciona como un chat: la lista muestra el último mensaje de cada una y al tocarla se
 * conversa ahí mismo (leer, escribir, adjuntar fotos); «⤢» la agranda. Para pasos,
 * cronómetro y cierre está «Abrir completo». Se oculta dentro del propio Centro de Mando
 * (panel "hugo"/"tickets"), donde el inbox ya está a la vista.
 */

const CLAVE_GRANDE = "mck_fab_chat_grande";

type ItemChat =
  | { kind: "mensaje"; id: string; ts: string; ev: TimelineEvento }
  | { kind: "sistema"; id: string; ts: string; ev: TimelineEvento }
  | { kind: "adjunto"; id: string; ts: string; adjunto: Adjunto };

// Al subir una foto el hilo guarda además «📎 Imagen adjunta»: se muestra la foto, no ese texto.
const TEXTO_AUTO_ADJUNTO = /^📎\s*(\d+\s+)?(imagen|imágenes)\s+adjunt/i;

function esImagen(a: Adjunto) {
  return Boolean(a.mime?.startsWith("image/")) || /\.(jpe?g|png|gif|webp|heic)$/i.test(a.nombre_original);
}

function leerGrande(): boolean {
  try {
    return localStorage.getItem(CLAVE_GRANDE) === "1";
  } catch {
    return false;
  }
}

export default function SolicitudesEnProcesoFab() {
  const [abierta, setAbierta] = useState(false);
  const [chatId, setChatId] = useState<number | null>(null);
  const [grande, setGrande] = useState(leerGrande);

  const panel = useAppStore((s) => s.panel);
  const setPanel = useAppStore((s) => s.setPanel);
  const setCentroMandoView = useAppStore((s) => s.setCentroMandoView);
  const setSolicitudBoot = useAppStore((s) => s.setSolicitudBoot);
  const user = useTicketsAuth((s) => s.user);

  const { data: conversaciones = [] } = useConversaciones("todas", "mias");
  const enProceso = conversaciones
    .filter((c) => c.estado === "en_proceso" || c.estado === "esperando_aprobacion")
    .sort((a, b) => b.ultima_actividad.localeCompare(a.ultima_actividad));
  const noLeidos = enProceso.reduce((n, c) => n + (c.no_leidos || 0), 0);
  const chat = chatId != null ? enProceso.find((c) => c.id === chatId) ?? null : null;

  useEffect(() => {
    if (!abierta) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (chatId != null) setChatId(null);
      else setAbierta(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [abierta, chatId]);

  // Si la conversación abierta se cerró (resuelta) sale de la lista: volver a la lista.
  useEffect(() => {
    if (chatId != null && !chat) setChatId(null);
  }, [chatId, chat]);

  function cambiarTamano() {
    setGrande((v) => {
      try {
        localStorage.setItem(CLAVE_GRANDE, v ? "0" : "1");
      } catch {
        /* sin localStorage: solo esta vez */
      }
      return !v;
    });
  }

  // Nunca se muestra dentro del propio Centro de Mando, sin sesión, o sin nada pendiente.
  const enCentroMando = panel === "hugo" || panel === "tickets";
  useEffect(() => {
    if (enCentroMando) setAbierta(false);
  }, [enCentroMando]);
  if (!user || enCentroMando || enProceso.length === 0) return null;
  if (typeof document === "undefined") return null;

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
      {abierta && (
        <div
          className={`pointer-events-auto flex flex-col overflow-hidden rounded-paper-lg border-2 border-accent/50 bg-surface-panel shadow-paper-lg ${
            grande
              ? "h-[min(82vh,46rem)] w-[min(calc(100vw-1.5rem),38rem)]"
              : "h-[min(70vh,32rem)] w-[min(calc(100vw-1.5rem),22rem)]"
          }`}
          role="dialog"
          aria-label="Chat de solicitudes en proceso"
        >
          <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-accent/10 px-2 py-1.5">
            {chat ? (
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
              </>
            ) : (
              <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1 text-accent">
                <Icon name="chat" size={15} weight="bold" />
                <span className="text-[11px] font-extrabold uppercase tracking-wide">
                  En proceso ({enProceso.length})
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={cambiarTamano}
              className="rounded-lg p-1 text-muted hover:bg-surface-hover hover:text-ink"
              title={grande ? "Achicar" : "Agrandar"}
              aria-label={grande ? "Achicar el chat" : "Agrandar el chat"}
            >
              <Icon name={grande ? "collapse" : "expand"} size={15} weight="bold" />
            </button>
            <button
              type="button"
              onClick={() => setAbierta(false)}
              className="rounded-lg px-2 py-0.5 text-sm text-muted hover:bg-surface-hover hover:text-ink"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>

          {chat ? (
            <ChatHilo key={chat.id} conversacion={chat} onAbrirCompleto={() => irA(chat)} />
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {enProceso.map((c) => {
                  const mio = uidEq(c.ultimo_usuario_id, user.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setChatId(c.id)}
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
        onClick={() => setAbierta((v) => !v)}
        className={`pointer-events-auto group relative flex h-14 w-14 items-center justify-center rounded-full border-2 shadow-paper-lg transition active:scale-95 ${
          abierta
            ? "border-accent bg-accent text-white"
            : "border-accent/70 bg-surface-panel text-accent hover:border-accent hover:bg-accent hover:text-white"
        }`}
        title={noLeidos > 0 ? `${noLeidos} mensaje(s) sin leer` : "Chat de solicitudes en proceso"}
        aria-label={abierta ? "Cerrar chat de solicitudes" : "Abrir chat de solicitudes en proceso"}
        aria-expanded={abierta}
      >
        <span
          className={`absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-black text-white shadow-sm ${
            noLeidos > 0 ? "bg-emerald-500 animate-pulse" : "bg-accent"
          }`}
        >
          {(() => {
            const n = noLeidos > 0 ? noLeidos : enProceso.length;
            return n > 99 ? "99+" : n;
          })()}
        </span>
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
                    esImagen(it.adjunto) ? (
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

      <div className="shrink-0 space-y-1.5 border-t border-border/60 bg-surface px-2.5 py-2">
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
        <span className="block">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void mandar();
              }
            }}
            onPaste={(e) => {
              const imgs = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
              if (imgs.length) {
                e.preventDefault();
                agregarArchivos(imgs);
              }
            }}
            rows={2}
            maxLength={2000}
            placeholder="Escribe un mensaje… (Enter envía · Ctrl+V pega una foto)"
            className="w-full resize-none rounded-xl border-2 border-border bg-surface-panel px-2.5 py-1.5 text-[13px] text-ink placeholder:text-muted focus:border-accent focus:outline-none"
          />
        </span>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => archivoRef.current?.click()}
            className="shrink-0 rounded-lg border border-border px-2 py-1 text-muted hover:border-accent hover:text-accent"
            title="Adjuntar foto o PDF" aria-label="Adjuntar foto o PDF">
            <Icon name="camera" size={15} />
          </button>
          <input ref={archivoRef} type="file" accept="image/*,.pdf,application/pdf" multiple className="sr-only"
            onChange={(e) => { agregarArchivos(e.target.files); e.target.value = ""; }} />
          <button type="button" onClick={onAbrirCompleto}
            className="min-w-0 truncate text-[11px] font-bold text-accent hover:underline"
            title="Pasos, cronómetro y cerrar la solicitud">
            Abrir completo →
          </button>
          <div className="flex-1" />
          <button type="button" onClick={() => void mandar()}
            disabled={enviar.isPending || (!texto.trim() && archivos.length === 0)}
            className="quest-btn-primary shrink-0 px-4 py-1.5 text-xs font-bold disabled:opacity-40">
            {enviar.isPending ? "…" : "Enviar"}
          </button>
        </div>
      </div>
    </>
  );
}
