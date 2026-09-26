import { Ico } from "../../icons/Ico";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { TicketsUser } from "../../stores/ticketsAuth";
import { ticketsUploadUrl } from "../../lib/profilePhoto";
import { Icon } from "../../icons";
import { api } from "../../api/client";
import { useTicketCronometro, CorridaCronometroBlock, fmtTiempo } from "../Cronometro";
import {
  PasosSection, MaterialesSection, CategoriaBadge, PrioridadBadge, fmtDate, ticketPermiteMarcarPasos,
  SolicitudCompraChecklist, esSolicitudCompraDelegada,
} from "../TicketsPanel";
import {
  useTimeline, useAdjuntosConversacion, useMarcarVisto, useEnviarMensajeConversacion,
  useCambiarEstadoConversacion, useAsignarConversacion, useTicketResumen, useUsuariosEquipo,
  type Adjunto, type TimelineEvento,
} from "../../hooks/useConversaciones";
import {
  uidEq, fechaServidorToDate, getDateLabel, horaDe, iniciales, ESTADO_LABEL, ESTADO_DOT_CLASS,
} from "./ticketsFormat";

type TimelineItem =
  | { kind: "mensaje"; id: string; ts: string; ev: TimelineEvento }
  | { kind: "adjunto"; id: string; ts: string; adjunto: Adjunto }
  | { kind: "sistema"; id: string; ts: string; ev: TimelineEvento };

function fusionarTimeline(eventos: TimelineEvento[], adjuntos: Adjunto[]): TimelineItem[] {
  const esImagenAdj = (a: Adjunto) =>
    (a.mime?.startsWith("image/")) || /\.(jpg|jpeg|png|gif|webp)$/i.test(a.nombre_original);
  const usados = new Set<number>();
  const items: TimelineItem[] = [];
  for (const ev of eventos) {
    if (ev.tipo === "sistema") {
      if (ev.accion === "adjunto_agregado") continue; // se muestra vía el adjunto real, no como texto
      items.push({ kind: "sistema", id: String(ev.id), ts: ev.creado_en, ev });
      continue;
    }
    if (/^📎/.test(ev.texto.trim())) {
      const evTs = fechaServidorToDate(ev.creado_en).getTime();
      const match = adjuntos.find((a) =>
        !usados.has(a.id) && esImagenAdj(a) && a.creado_por_nombre === ev.autor_nombre
        && Math.abs(fechaServidorToDate(a.creado_en).getTime() - evTs) < 20000);
      if (match) {
        usados.add(match.id);
        items.push({ kind: "adjunto", id: `adj-${match.id}`, ts: match.creado_en, adjunto: match });
        continue;
      }
    }
    items.push({ kind: "mensaje", id: String(ev.id), ts: ev.creado_en, ev });
  }
  for (const a of adjuntos) {
    if (!usados.has(a.id)) items.push({ kind: "adjunto", id: `adj-${a.id}`, ts: a.creado_en, adjunto: a });
  }
  items.sort((x, y) => x.ts.localeCompare(y.ts));
  return items;
}

/** `enLinea` se ignora: el punto de conexión se quitó el 23-sep-2026. */
export function Avatar({ nombre, size = 8 }: { nombre: string | null | undefined; enLinea?: boolean; size?: number }) {
  return (
    <span
      className="relative shrink-0 flex items-center justify-center rounded-full bg-accent/15 text-[12px] font-black text-accent"
      style={{ width: `${size * 0.25}rem`, height: `${size * 0.25}rem` }}
    >
      {iniciales(nombre)}
    </span>
  );
}

/** Confirmación propia de la app. `confirm()`/`prompt()` del navegador no se
 *  dibujan en el modo instalado (PWA / webview del móvil): el texto llegaba a
 *  aparecer sin botones, así que "Marcar resuelta" no se podía aceptar. */
type Dialogo = {
  titulo: string;
  detalle?: string;
  okLabel: string;
  tono: "ok" | "aviso" | "peligro";
  campo?: { placeholder: string; obligatorio: boolean; vacioMsg?: string };
  onConfirmar: (texto: string) => void | Promise<void>;
};

export default function HiloConversacion({
  ticketId, token, user, enLineaIds, onCerrar,
}: {
  ticketId: number;
  token: string;
  user: TicketsUser;
  enLineaIds: Set<number>;
  onCerrar?: () => void;
}) {
  const { data: ticket } = useTicketResumen(ticketId);
  const { data: timeline = [], isLoading: cargandoTimeline } = useTimeline(ticketId);
  const { data: adjuntos = [] } = useAdjuntosConversacion(ticketId);
  const { data: equipo = [] } = useUsuariosEquipo();
  const marcarVisto = useMarcarVisto();
  const enviar = useEnviarMensajeConversacion();
  const cambiarEstado = useCambiarEstadoConversacion();
  const asignar = useAsignarConversacion();
  const qc = useQueryClient();
  // autoResume:false — abrir el hilo para leer no debe arrancar el cronómetro de
  // otra persona; solo un clic explícito en "Iniciar/Reanudar" lo hace.
  const cronometro = useTicketCronometro(ticketId, token, { autoResume: false });

  const [draft, setDraft] = useState("");
  const [archivos, setArchivos] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [msg, setMsg] = useState("");
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [dialogoTexto, setDialogoTexto] = useState("");
  const [dialogoError, setDialogoError] = useState("");
  const [dialogoOcupado, setDialogoOcupado] = useState(false);
  // Pedir intervención — pausa la solicitud y crea una sub-solicitud a otro usuario
  // (o al mismo solicitante), o invita a alguien a colaborar sin pausar. Todo queda
  // en la misma pantalla del chat, sin navegar a otra vista.
  const [pedirAbierto, setPedirAbierto] = useState(false);
  const [modoInter, setModoInter] = useState<"preguntar" | "pausar" | "colaborar">("pausar");
  const [interDestino, setInterDestino] = useState<number | "">("");
  const [interTexto, setInterTexto] = useState("");
  const [enviandoInter, setEnviandoInter] = useState(false);
  const [errorInter, setErrorInter] = useState("");

  useEffect(() => {
    void marcarVisto.mutateAsync(ticketId).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  const items = useMemo(() => fusionarTimeline(timeline, adjuntos), [timeline, adjuntos]);
  const ultimoIdVisto = useRef<string | null>(null);
  useEffect(() => {
    const last = items[items.length - 1]?.id ?? null;
    if (last && last !== ultimoIdVisto.current && document.visibilityState === "visible") {
      ultimoIdVisto.current = last;
      void marcarVisto.mutateAsync(ticketId).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, ticketId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items.length]);

  if (!ticket) {
    return <div className="flex-1 flex items-center justify-center text-sm text-muted">Cargando conversación…</div>;
  }

  const esAccion = ticket.tipo === "accion";
  const esAsignado = uidEq(ticket.asignado_a, user.id);
  const esCreadoPorMi = uidEq(ticket.creado_por, user.id);
  const resuelta = ticket.estado === "resuelto" || ticket.estado === "rechazado";
  const bloqueada = !!ticket.bloqueado_por;
  const noIniciada = ticket.estado === "pendiente";
  const puedeEscribir = !resuelta && !bloqueada && !noIniciada;
  const contraparteNombre = esCreadoPorMi ? (ticket.asignado_a_nombre ?? "Sin asignar") : (ticket.creado_por_nombre ?? "—");
  const contraparteId = esCreadoPorMi ? ticket.asignado_a : ticket.creado_por;
  const puedeEditarPasos = ticketPermiteMarcarPasos(ticket) && (esAsignado || esCreadoPorMi || (user.rol?.nivel ?? 1) >= 2);
  const tieneDatosApertura = Boolean(
    (ticket.descripcion && ticket.descripcion.trim() && ticket.descripcion.trim() !== ticket.titulo.trim())
    || ticket.soporte_archivo,
  );
  const puedePreguntarCreador = !esCreadoPorMi && ticket.creado_por != null;
  // Las solicitudes de compra se cierran marcando cada producto (comprado o "no se
  // consiguió" con motivo); el backend rechaza "resuelto" mientras quede alguno
  // pendiente. Sin esta lista aquí, el hilo mostraba ese error sin dónde marcar.
  const esCompra = esSolicitudCompraDelegada(ticket);
  const companeros = equipo.filter((u) => u.id !== user.id);

  async function enviarMensaje() {
    const texto = draft.trim();
    if ((!texto && archivos.length === 0) || enviar.isPending || !puedeEscribir) return;
    try {
      await enviar.mutateAsync({ ticketId, texto, archivos });
      setDraft("");
      setArchivos([]);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "No se pudo enviar el mensaje");
      setTimeout(() => setMsg(""), 3500);
    }
  }

  function abrirDialogo(d: Dialogo) {
    setDialogoTexto("");
    setDialogoError("");
    setDialogo(d);
  }
  async function confirmarDialogo() {
    if (!dialogo || dialogoOcupado) return;
    const texto = dialogoTexto.trim();
    if (dialogo.campo?.obligatorio && !texto) {
      setDialogoError(dialogo.campo.vacioMsg ?? "Completa este campo.");
      return;
    }
    setDialogoOcupado(true);
    try {
      await dialogo.onConfirmar(dialogoTexto);
      setDialogo(null);
    } finally {
      setDialogoOcupado(false);
    }
  }
  async function cambiar(body: Record<string, unknown>) {
    try { await cambiarEstado.mutateAsync({ ticketId, body }); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Error"); setTimeout(() => setMsg(""), 4000); }
  }

  function marcarResuelto() {
    abrirDialogo({
      titulo: "¿Marcar como resuelta?",
      detalle: ticket!.titulo,
      okLabel: "Sí, marcar resuelta",
      tono: "ok",
      onConfirmar: () => cambiar({ estado: "resuelto" }),
    });
  }
  function pedirCambios() {
    abrirDialogo({
      titulo: "Pedir cambios",
      detalle: `¿Qué falta o qué debería cambiar en "${ticket!.titulo}"? Esto la reabre y se lo notifica a ${contraparteNombre}.`,
      okLabel: "Pedir cambios",
      tono: "aviso",
      campo: {
        placeholder: "Qué necesitas que se corrija o agregue",
        obligatorio: true,
        vacioMsg: "Escribe qué necesitas que se corrija o agregue.",
      },
      onConfirmar: (motivo) => cambiar({ estado: "pendiente", motivo: motivo.trim() }),
    });
  }
  function aprobar() {
    abrirDialogo({
      titulo: "¿Aprobar y cerrar?",
      detalle: ticket!.titulo,
      okLabel: "Aprobar y cerrar",
      tono: "ok",
      onConfirmar: () => cambiar({ estado: "resuelto" }),
    });
  }
  function rechazar() {
    abrirDialogo({
      titulo: "Rechazar la solicitud",
      detalle: ticket!.titulo,
      okLabel: "Rechazar",
      tono: "peligro",
      campo: { placeholder: "Motivo del rechazo (opcional)", obligatorio: false },
      onConfirmar: (motivo) => cambiar({ estado: "rechazado", motivo: motivo.trim() || undefined }),
    });
  }
  async function tomarla() {
    try { await asignar.mutateAsync({ ticketId, asignadoA: user.id }); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Error"); setTimeout(() => setMsg(""), 4000); }
  }
  /** Botón único "▶ Iniciar" — se autoasigna si hace falta y pasa a "en_proceso",
   *  lo que desbloquea el chat (ver `puedeEscribir`). Cada ticket lleva su propio
   *  estado en el servidor, así que iniciar varias solicitudes/acciones en
   *  paralelo funciona sin ningún ajuste extra — no hay "una activa a la vez". */
  async function iniciarSolicitud() {
    try {
      if (ticket!.asignado_a == null) await tomarla();
      if (ticket!.estado === "pendiente") {
        await cambiarEstado.mutateAsync({ ticketId, body: { estado: "en_proceso" } });
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "No se pudo iniciar");
      setTimeout(() => setMsg(""), 4000);
    }
  }
  /** Arranca o reanuda la corrida sin salir del hilo — `autoResume:false` en el
   *  hook de arriba bloquea también su auto-inicio interno, así que el POST va
   *  directo y luego se refresca el estado del cronómetro. */
  async function iniciarOReanudarCrono() {
    try {
      if (ticket!.asignado_a == null) await tomarla();
      if (ticket!.estado === "pendiente") {
        await cambiarEstado.mutateAsync({ ticketId, body: { estado: "en_proceso" } });
      }
      await api.post(`/api/tickets/${ticketId}/corridas/iniciar`, { segundos_previos: cronometro.segundos });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "No se pudo iniciar el cronómetro");
      setTimeout(() => setMsg(""), 4000);
    } finally {
      await cronometro.syncDesdeServidor(false);
    }
  }

  function abrirPedirIntervencion() {
    setModoInter(puedePreguntarCreador ? "preguntar" : "pausar");
    setInterDestino("");
    setInterTexto("");
    setErrorInter("");
    setPedirAbierto(true);
  }

  function invalidarTrasIntervencion() {
    qc.invalidateQueries({ queryKey: ["tickets-resumen", ticketId] });
    qc.invalidateQueries({ queryKey: ["tickets-timeline", ticketId] });
    qc.invalidateQueries({ queryKey: ["tickets-conversaciones"] });
  }

  /** Pausa esta solicitud y crea una sub-solicitud a otro usuario (o pregunta al
   *  solicitante), o invita a alguien a colaborar en el mismo hilo sin pausar. Al
   *  resolverse la sub-solicitud, el servidor desbloquea ésta automáticamente. */
  async function enviarIntervencion() {
    const texto = interTexto.trim();
    if (modoInter !== "colaborar" && !texto) {
      setErrorInter("Escribe qué necesitas.");
      return;
    }
    if (modoInter !== "preguntar" && !interDestino) {
      setErrorInter("Elige a quién.");
      return;
    }
    setEnviandoInter(true);
    setErrorInter("");
    try {
      if (modoInter === "colaborar") {
        await api.post(`/api/tickets/${ticketId}/participantes`, {
          usuario_id: Number(interDestino), rol: "colaborador",
        });
        const nombre = companeros.find((u) => u.id === Number(interDestino))?.nombre ?? "Compañero";
        await api.post(`/api/tickets/${ticketId}/comentarios`, {
          texto: `👥 ${nombre} fue invitado a colaborar en este hilo.${texto ? ` (${texto})` : ""}`,
        });
      } else {
        const destino = modoInter === "preguntar" ? ticket!.creado_por : Number(interDestino);
        await api.post(`/api/tickets/${ticketId}/pedir-intervencion`, {
          titulo: texto,
          descripcion: "",
          asignado_a: destino,
          ...(modoInter === "preguntar" ? { subtipo: "pregunta" } : {}),
        });
      }
      setPedirAbierto(false);
      invalidarTrasIntervencion();
    } catch (e) {
      setErrorInter(e instanceof Error ? e.message : "No se pudo enviar");
    } finally {
      setEnviandoInter(false);
    }
  }

  return (
    <div className="relative min-w-0 flex-1 min-h-0 flex flex-col bg-surface">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        {onCerrar && (
          <button type="button" onClick={onCerrar} className="lg:hidden text-lg text-muted px-1" aria-label="Volver">←</button>
        )}
        <Avatar nombre={contraparteNombre} enLinea={contraparteId != null ? enLineaIds.has(contraparteId) : undefined} size={9} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-ink">{ticket.titulo}</p>
          <p className="truncate text-[12px] text-muted">
            {ticket.numero} · {contraparteNombre}
            <span className={`ml-2 inline-block h-1.5 w-1.5 rounded-full align-middle ${ESTADO_DOT_CLASS[ticket.estado] ?? "bg-muted/40"}`} />
            <span className="ml-1">{ESTADO_LABEL[ticket.estado] ?? ticket.estado}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <CategoriaBadge cat={ticket.categoria} />
          <PrioridadBadge p={ticket.prioridad} />
        </div>
      </div>

      {esAccion && !resuelta && !bloqueada && esAsignado && (
        <div className="border-b border-border/60 px-4 py-2">
          <CorridaCronometroBlock
            segundos={cronometro.segundos}
            estado={cronometro.corridaId ? (cronometro.activo ? "activa" : "pausada") : null}
            onIniciar={() => void iniciarOReanudarCrono()}
            onReanudar={() => void iniciarOReanudarCrono()}
            onPausar={() => void cronometro.pausar()}
            onFinalizar={marcarResuelto}
            compact
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 px-4 py-2">
        {esAccion && !resuelta && !bloqueada ? (
          esAsignado ? null : ticket.asignado_a == null ? (
            <button type="button" onClick={() => void iniciarOReanudarCrono()} className="rounded-full bg-accent/15 px-2.5 py-1 text-[12px] font-bold text-accent hover:bg-accent/25">
              ▶ Tomar e iniciar
            </button>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full bg-muted/10 px-2.5 py-1 text-[12px] font-bold text-muted">
              ⏱ {fmtTiempo(cronometro.segundos)} · en curso de {contraparteNombre}
            </span>
          )
        ) : (
          !resuelta && !bloqueada && (
            noIniciada ? (
              <button type="button" onClick={() => void iniciarSolicitud()} className="rounded-full bg-accent px-3 py-1.5 text-[12px] font-bold text-white hover:bg-accent-hover">
                ▶ Iniciar
              </button>
            ) : ticket.asignado_a == null && (
              <button type="button" onClick={tomarla} className="rounded-full bg-accent/15 px-2.5 py-1 text-[12px] font-bold text-accent hover:bg-accent/25">
                Tomar esta solicitud
              </button>
            )
          )
        )}
        {esAsignado && !resuelta && !esAccion && !esCompra && ticket.estado !== "esperando_aprobacion" && !bloqueada && (
          <button type="button" onClick={marcarResuelto} className="rounded-full bg-emerald-600/15 px-2.5 py-1 text-[12px] font-bold text-emerald-600 hover:bg-emerald-600/25">
            ✓ Marcar resuelta
          </button>
        )}
        {esAsignado && !resuelta && !bloqueada && !noIniciada && (
          <button
            type="button"
            onClick={() => (pedirAbierto ? setPedirAbierto(false) : abrirPedirIntervencion())}
            className={`rounded-full px-2.5 py-1 text-[12px] font-bold ${pedirAbierto ? "bg-accent/20 text-accent" : "bg-muted/10 text-muted hover:bg-muted/20 hover:text-ink"}`}
          >
            <Ico e="🙋" /> Pedir intervención
          </button>
        )}
        {esCreadoPorMi && ticket.estado === "esperando_aprobacion" && (
          <>
            <button type="button" onClick={aprobar} className="rounded-full bg-emerald-600/15 px-2.5 py-1 text-[12px] font-bold text-emerald-600 hover:bg-emerald-600/25">
              ✓ Aprobar
            </button>
            <button type="button" onClick={rechazar} className="rounded-full bg-rose-600/15 px-2.5 py-1 text-[12px] font-bold text-rose-600 hover:bg-rose-600/25">
              Rechazar
            </button>
          </>
        )}
        {esCreadoPorMi && resuelta && (
          <button type="button" onClick={pedirCambios} className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[12px] font-bold text-amber-600 hover:bg-amber-500/25">
            ↺ Pedir cambios
          </button>
        )}
        {bloqueada && (
          <span className="rounded-full bg-muted/10 px-2.5 py-1 text-[12px] font-semibold text-muted">
            <Ico e="🔒" /> En pausa{ticket.bloqueado_por_asignado_nombre ? ` — esperando a ${ticket.bloqueado_por_asignado_nombre}` : ""}
            {ticket.bloqueado_por_numero ? ` (${ticket.bloqueado_por_numero})` : ""}
          </span>
        )}
      </div>

      {pedirAbierto && (
        <div className="border-b border-border/60 bg-surface-panel/60 px-4 py-3 space-y-3">
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
            {puedePreguntarCreador && (
              <button
                type="button"
                onClick={() => setModoInter("preguntar")}
                className={`rounded-xl border px-3 py-2 text-left transition ${modoInter === "preguntar" ? "border-accent/50 bg-accent/10" : "border-border hover:border-accent/40"}`}
              >
                <p className="text-[12px] font-bold text-ink">❓ Preguntarle a {ticket.creado_por_nombre ?? "quien la pidió"}</p>
                <p className="mt-0.5 text-[11px] text-muted leading-snug">Le llega un aviso. Se reactiva sola cuando responda.</p>
              </button>
            )}
            <button
              type="button"
              onClick={() => setModoInter("pausar")}
              className={`rounded-xl border px-3 py-2 text-left transition ${modoInter === "pausar" ? "border-accent/50 bg-accent/10" : "border-border hover:border-accent/40"}`}
            >
              <p className="text-[12px] font-bold text-ink"><Ico e="🛑" /> Pausar y delegar</p>
              <p className="mt-0.5 text-[11px] text-muted leading-snug">Crea una sub-solicitud. Ésta queda bloqueada hasta que la resuelvan.</p>
            </button>
            <button
              type="button"
              onClick={() => setModoInter("colaborar")}
              className={`rounded-xl border px-3 py-2 text-left transition ${modoInter === "colaborar" ? "border-accent/50 bg-accent/10" : "border-border hover:border-accent/40"}`}
            >
              <p className="text-[12px] font-bold text-ink"><Ico e="👥" /> Invitar a colaborar</p>
              <p className="mt-0.5 text-[11px] text-muted leading-snug">Comparte el hilo sin pausar. Puede ver y escribir aquí mismo.</p>
            </button>
          </div>

          {modoInter !== "preguntar" && (
            <select
              value={interDestino}
              onChange={(e) => setInterDestino(e.target.value ? Number(e.target.value) : "")}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent/50"
            >
              <option value="">¿A quién?</option>
              {companeros.map((u) => (
                <option key={u.id} value={u.id}>{u.nombre}</option>
              ))}
            </select>
          )}

          <textarea
            value={interTexto}
            onChange={(e) => setInterTexto(e.target.value)}
            placeholder={modoInter === "preguntar" ? "¿Qué necesitas preguntarle?" : modoInter === "colaborar" ? "Nota para quien invitas (opcional)" : "¿Qué necesitas que resuelva?"}
            rows={2}
            className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent/50"
          />

          {errorInter && <p className="text-[12px] text-rose-500">{errorInter}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setPedirAbierto(false)} className="rounded-full px-3 py-1.5 text-[12px] font-semibold text-muted hover:text-ink">
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void enviarIntervencion()}
              disabled={enviandoInter}
              className="rounded-full bg-accent px-4 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
            >
              {enviandoInter ? "Enviando…" : "Enviar"}
            </button>
          </div>
        </div>
      )}

      <div className="min-w-0 flex-1 min-h-0 overflow-x-hidden overflow-y-auto px-4 pt-3 pb-1 space-y-1.5">
        {/* Detalles con los que arrancó la solicitud/acción — inline, al comienzo del
            chat, en vez de una pantalla "Ver detalle completo" aparte. Solo aparece lo
            que realmente existe (descripción propia, adjunto de apertura, pasos o
            materiales cargados). */}
        {tieneDatosApertura && (
          <div className="mb-2 space-y-1.5 rounded-2xl border border-border bg-surface-panel/60 p-3.5">
            {ticket.descripcion && ticket.descripcion.trim() && ticket.descripcion.trim() !== ticket.titulo.trim() && (
              <p className="whitespace-pre-wrap text-sm text-ink">{ticket.descripcion}</p>
            )}
            {ticket.soporte_archivo && (
              <a
                href={`/api/tickets/uploads/${ticket.soporte_archivo}?token=${token}`}
                target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl border border-border px-2.5 py-1 text-[12px] font-semibold text-accent hover:border-accent/50"
              >
                <Ico e="📎" /> Ver adjunto de apertura
              </a>
            )}
            <p className="text-[11px] text-muted">
              Creado {fmtDate(ticket.creado_en)} por {ticket.creado_por_nombre ?? "—"}
            </p>
          </div>
        )}
        {esCompra && (
          <div className="mb-2 rounded-xl border border-accent/40 bg-surface p-3 shadow-sm">
            <SolicitudCompraChecklist
              ticket={ticket}
              token={token}
              user={user}
              onChanged={() => {
                void qc.invalidateQueries({ queryKey: ["tickets-resumen", ticketId] });
                void qc.invalidateQueries({ queryKey: ["tickets-timeline", ticketId] });
                void qc.invalidateQueries({ queryKey: ["tickets-conversaciones"] });
              }}
              supervision={!esAsignado}
            />
          </div>
        )}
        {(ticket.pasos_total ?? 0) > 0 && (
          <div className="mb-2">
            <PasosSection
              ticketId={ticketId}
              token={token}
              editMode={puedeEditarPasos}
              allowCheck={ticketPermiteMarcarPasos(ticket)}
            />
          </div>
        )}
        <div className="mb-2">
          <MaterialesSection ticketId={ticketId} token={token} user={user} readonly hideIfEmpty />
        </div>
        {cargandoTimeline && items.length === 0 && (
          <p className="text-xs text-muted text-center py-4">Cargando mensajes…</p>
        )}
        {!cargandoTimeline && items.length === 0 && (
          <p className="text-xs text-muted text-center py-6 italic">Aún no hay mensajes. Escribe abajo para empezar.</p>
        )}
        {items.map((item, idx) => {
          const fechaLabel = getDateLabel(item.ts);
          const prevTs = items[idx - 1]?.ts;
          const mostrarSep = fechaLabel && fechaLabel !== (prevTs ? getDateLabel(prevTs) : null);
          const sep = mostrarSep ? (
            <div key={`sep-${item.id}`} className="flex items-center gap-2 py-2">
              <div className="flex-1 h-px bg-border/40" />
              <span className="text-[12px] text-muted/70 font-medium px-1">{fechaLabel}</span>
              <div className="flex-1 h-px bg-border/40" />
            </div>
          ) : null;

          if (item.kind === "sistema") {
            return (
              <div key={item.id}>
                {sep}
                <div className="flex justify-center py-1">
                  <span className="rounded-full bg-muted/10 px-3 py-1 text-[12px] text-muted italic">{item.ev.texto}</span>
                </div>
              </div>
            );
          }

          const autorId = item.kind === "adjunto" ? item.adjunto.creado_por : item.ev.usuario_id;
          const autorNombre = item.kind === "adjunto" ? (item.adjunto.creado_por_nombre ?? "?") : (item.ev.autor_nombre ?? "?");
          const esMio = uidEq(autorId, user.id);
          const burbujaCls = esMio
            ? "rounded-br-sm bg-accent text-white"
            : "rounded-bl-sm border border-border bg-surface-panel text-ink";
          return (
            <div key={item.id}>
              {sep}
              <div className={`flex items-end gap-2 mb-1.5 ${esMio ? "justify-end" : "justify-start"}`}>
                {!esMio && <Avatar nombre={autorNombre} enLinea={autorId != null ? enLineaIds.has(autorId) : undefined} size={7} />}
                <div className="max-w-[75%] lg:max-w-[60%] space-y-0.5">
                  {!esMio && <p className="px-1 text-[12px] font-bold text-muted">{autorNombre}</p>}
                  {item.kind === "adjunto" ? (
                    (item.adjunto.mime?.startsWith("image/")) || /\.(jpg|jpeg|png|gif|webp)$/i.test(item.adjunto.nombre_original) ? (
                      <a
                        href={ticketsUploadUrl(item.adjunto.nombre_archivo, token)}
                        target="_blank" rel="noreferrer"
                        className="group relative block overflow-hidden rounded-2xl border border-border shadow-sm"
                      >
                        <img
                          src={ticketsUploadUrl(item.adjunto.nombre_archivo, token)}
                          alt={item.adjunto.nombre_original}
                          className="max-h-72 w-full max-w-[280px] object-cover transition group-hover:opacity-85"
                        />
                      </a>
                    ) : (
                      <a
                        href={ticketsUploadUrl(item.adjunto.nombre_archivo, token)}
                        target="_blank" rel="noreferrer"
                        className={`flex items-center gap-2 rounded-2xl px-3 py-2.5 text-sm ${burbujaCls}`}
                      >
                        <span className="text-lg shrink-0">{/\.pdf$/i.test(item.adjunto.nombre_original) ? "📄" : "📁"}</span>
                        <span className="truncate underline underline-offset-2">{item.adjunto.nombre_original}</span>
                      </a>
                    )
                  ) : (
                    <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ${burbujaCls}`}>
                      <p className="whitespace-pre-wrap">{item.ev.texto}</p>
                    </div>
                  )}
                  <p className={`px-1 text-[12px] text-muted/70 ${esMio ? "text-right" : "text-left"}`}>{horaDe(item.ts)}</p>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {msg && <p className="px-4 py-1 text-[12px] text-rose-500">{msg}</p>}

      {puedeEscribir ? (
        <div className="border-t border-border p-3">
          {archivos.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {archivos.map((f, i) => (
                <span key={i} className="flex items-center gap-1 rounded-full bg-surface-panel border border-border px-2 py-1 text-[12px] text-muted">
                  {f.name}
                  <button type="button" onClick={() => setArchivos((prev) => prev.filter((_, j) => j !== i))} className="text-muted hover:text-ink">✕</button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="shrink-0 rounded-full border border-border p-2 text-muted hover:text-ink hover:border-accent/40"
              title="Adjuntar archivo"
            >
              <Icon name="paperclip" size={18} />
            </button>
            <input
              ref={fileRef} type="file" multiple hidden
              onChange={(e) => {
                if (e.target.files) setArchivos((prev) => [...prev, ...Array.from(e.target.files!)]);
                e.target.value = "";
              }}
            />
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviarMensaje(); } }}
              onPaste={(e) => {
                const item = Array.from(e.clipboardData.items).find((it) => it.type.startsWith("image/"));
                if (!item) return;
                e.preventDefault();
                const file = item.getAsFile();
                if (file) {
                  setArchivos((prev) => [...prev, new File([file], `captura-${Date.now()}.png`, { type: file.type })]);
                }
              }}
              placeholder="Escribe un mensaje… (puedes pegar una captura de pantalla)"
              rows={1}
              className="flex-1 resize-none rounded-2xl border border-border bg-surface-panel px-3.5 py-2.5 text-sm text-ink outline-none focus:border-accent/50"
            />
            <button
              type="button"
              onClick={() => void enviarMensaje()}
              disabled={enviar.isPending || (!draft.trim() && archivos.length === 0)}
              className="shrink-0 rounded-full bg-accent px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
            >
              Enviar
            </button>
          </div>
        </div>
      ) : (
        <div className="border-t border-border p-3 text-center text-[13px] text-muted italic">
          {bloqueada
            ? "En pausa por una intervención pendiente."
            : noIniciada
              ? "Dale ▶ Iniciar arriba para poder escribir o adjuntar archivos."
              : "Esta conversación ya está cerrada."}
        </div>
      )}

      {dialogo && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !dialogoOcupado && setDialogo(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border border-border bg-surface p-4 shadow-xl space-y-3"
          >
            <p className="text-sm font-extrabold text-ink">{dialogo.titulo}</p>
            {dialogo.detalle && <p className="text-[12px] leading-snug text-muted">{dialogo.detalle}</p>}
            {dialogo.campo && (
              <textarea
                autoFocus
                value={dialogoTexto}
                onChange={(e) => { setDialogoTexto(e.target.value); setDialogoError(""); }}
                placeholder={dialogo.campo.placeholder}
                rows={3}
                className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent/50"
              />
            )}
            {dialogoError && <p className="text-[12px] text-rose-500">{dialogoError}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialogo(null)}
                disabled={dialogoOcupado}
                className="rounded-full px-3 py-1.5 text-[12px] font-semibold text-muted hover:text-ink disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmarDialogo()}
                disabled={dialogoOcupado}
                className={`rounded-full px-4 py-1.5 text-[12px] font-bold text-white disabled:opacity-40 ${
                  dialogo.tono === "peligro" ? "bg-rose-600 hover:bg-rose-700"
                    : dialogo.tono === "aviso" ? "bg-amber-500 hover:bg-amber-600"
                      : "bg-emerald-600 hover:bg-emerald-700"
                }`}
              >
                {dialogoOcupado ? "Guardando…" : dialogo.okLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
