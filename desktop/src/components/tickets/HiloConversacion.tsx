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
  uidEq, fechaServidorToDate, getDateLabel, horaDe, iniciales, tiempoRelativo, ESTADO_LABEL,
} from "./ticketsFormat";
import { sonarRevisado } from "../combos/sonidoMoneda";
import VisorFotos, { type FotoVisor } from "./VisorFotos";
import "./hiloPixel.css";

/** La solicitud/acción que la persona está atendiendo (la bandeja la ofrece como «Seguir con…»). */
export const CLAVE_HILO_ACTUAL = "mck_hilo_actual";

function esImagen(nombre: string, mime?: string | null) {
  return Boolean(mime?.startsWith("image/")) || /\.(jpe?g|png|gif|webp|heic)$/i.test(nombre);
}

/** Las cuatro casillas del wizard, como las piezas del taller de combos. */
const PASOS_HACER = ["Leer", "Empezar", "Evidencia", "Entregar"] as const;
const PASOS_PEDIDO = ["Pedida", "Tomada", "Evidencia", "Entregada"] as const;

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
    if (/^(📎|📷)/u.test(ev.texto.trim())) {
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
  // Wizard: la tarjeta de lo pedido, el visor de fotos, «lo leí» y la cámara de evidencia.
  // En el celular el pedido arranca plegado a una línea (se abre al tocarlo): desplegado, más
  // las casillas y el botón grande, dejaba el chat y el cuadro de escribir sin espacio.
  const [verPedido, setVerPedido] = useState(() => {
    try { return !window.matchMedia("(max-width: 1023px)").matches; } catch { return true; }
  });
  const [visor, setVisor] = useState<number | null>(null);
  const [leido, setLeido] = useState(() => {
    try { return localStorage.getItem(`mck_hilo_leido_${ticketId}`) === "1"; } catch { return false; }
  });
  const [pasoRecien, setPasoRecien] = useState<number | null>(null);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const camRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const pasoPrevio = useRef<number | null>(null);

  useEffect(() => {
    void marcarVisto.mutateAsync(ticketId).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  const items = useMemo(() => fusionarTimeline(timeline, adjuntos), [timeline, adjuntos]);
  // Todas las fotos del hilo en orden: tocar cualquiera abre el visor y se pasa entre ellas.
  const fotos = useMemo<(FotoVisor & { adjId: number | null })[]>(() => {
    const lista: (FotoVisor & { adjId: number | null })[] = [];
    if (ticket?.soporte_archivo && esImagen(ticket.soporte_archivo)) {
      lista.push({ src: ticketsUploadUrl(ticket.soporte_archivo, token), pie: `${ticket.creado_por_nombre ?? ""} · al crearla`, adjId: null });
    }
    for (const a of [...adjuntos].sort((x, y) => x.creado_en.localeCompare(y.creado_en))) {
      if (!esImagen(a.nombre_original, a.mime)) continue;
      lista.push({ src: ticketsUploadUrl(a.nombre_archivo, token), pie: `${a.creado_por_nombre ?? ""} · ${horaDe(a.creado_en)}`, adjId: a.id });
    }
    return lista;
  }, [adjuntos, ticket?.soporte_archivo, ticket?.creado_por_nombre, token]);

  // Etapa del wizard (0‥4 casillas cumplidas). Se calcula aquí para animar la casilla que se
  // acaba de cumplir; el sonido lo pone quien hizo la jugada (y la moneda, el servidor).
  const etapa = useMemo(() => {
    if (!ticket) return 0;
    const cerrada = ["resuelto", "esperando_aprobacion"].includes(ticket.estado);
    const empezada = ticket.estado !== "pendiente";
    const quien = ticket.asignado_a;
    const pasosOk = (ticket.pasos_total ?? 0) === 0 || (ticket.pasos_completados ?? 0) >= (ticket.pasos_total ?? 0);
    const evidencia = quien != null && (
      adjuntos.some((a) => uidEq(a.creado_por, quien))
      || timeline.some((e) => e.tipo === "mensaje" && uidEq(e.usuario_id, quien) && !uidEq(quien, ticket.creado_por))
    );
    let n = 0;
    if (leido || empezada) n = 1;
    if (empezada) n = 2;
    if (empezada && pasosOk && evidencia) n = 3;
    if (cerrada) n = 4;
    return n;
  }, [ticket, adjuntos, timeline, leido]);

  useEffect(() => {
    if (pasoPrevio.current != null && etapa > pasoPrevio.current) {
      setPasoRecien(etapa - 1);
      const t = setTimeout(() => setPasoRecien(null), 700);
      pasoPrevio.current = etapa;
      return () => clearTimeout(t);
    }
    pasoPrevio.current = etapa;
  }, [etapa]);

  // «Seguir con…»: la que tengo en curso queda recordada para la bandeja.
  useEffect(() => {
    if (!ticket) return;
    try {
      const mia = uidEq(ticket.asignado_a, user.id);
      if (mia && ticket.estado === "en_proceso") localStorage.setItem(CLAVE_HILO_ACTUAL, String(ticket.id));
      else if (localStorage.getItem(CLAVE_HILO_ACTUAL) === String(ticket.id) && ticket.estado !== "en_proceso") {
        localStorage.removeItem(CLAVE_HILO_ACTUAL);
      }
    } catch { /* sin almacenamiento */ }
  }, [ticket, user.id]);
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
  const puedePreguntarCreador = !esCreadoPorMi && ticket.creado_por != null;
  // Las solicitudes de compra se cierran marcando cada producto (comprado o "no se
  // consiguió" con motivo); el backend rechaza "resuelto" mientras quede alguno
  // pendiente. Sin esta lista aquí, el hilo mostraba ese error sin dónde marcar.
  const esCompra = esSolicitudCompraDelegada(ticket);
  const companeros = equipo.filter((u) => u.id !== user.id);
  // Entregar ≠ finalizar: si la pidió otra persona, al entregarla le llega a ella para que la
  // finalice y así se archive (criterio de `_requiere_finalizar_el_solicitante` en tickets_db.py).
  const entregaAlSolicitante = !esAccion && ticket.creado_por != null && !esCreadoPorMi && !ticket.ticket_padre_id
    && !["compra", "etiqueta"].includes((ticket.subtipo ?? "").trim());
  const solicitanteNombre = ticket.creado_por_nombre ?? "quien la pidió";

  async function enviarMensaje() {
    const texto = draft.trim();
    if ((!texto && archivos.length === 0) || enviar.isPending || !puedeEscribir) return;
    try {
      await enviar.mutateAsync({ ticketId, texto, archivos });
      setDraft("");
      setArchivos([]);
      if (draftRef.current) draftRef.current.style.height = "";
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
      titulo: "¿Entregar esta tarea?",
      detalle: entregaAlSolicitante
        ? `${ticket!.titulo}\n\nLe llega a ${solicitanteNombre} para que la revise y la finalice.`
        : ticket!.titulo,
      okLabel: "★ Sí, entregar",
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
      titulo: "¿Finalizar la solicitud?",
      detalle: `${ticket!.titulo}\n\nQueda archivada en el historial de hechas.`,
      okLabel: "✓ Finalizar",
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
    marcarLeido();
    try {
      if (ticket!.asignado_a == null) await tomarla();
      if (ticket!.estado === "pendiente") {
        await cambiarEstado.mutateAsync({ ticketId, body: { estado: "en_proceso" } });
        sonarRevisado();
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
    marcarLeido();
    try {
      if (ticket!.asignado_a == null) await tomarla();
      if (ticket!.estado === "pendiente") {
        await cambiarEstado.mutateAsync({ ticketId, body: { estado: "en_proceso" } });
        sonarRevisado();
      }
      await api.post(`/api/tickets/${ticketId}/corridas/iniciar`, { segundos_previos: cronometro.segundos });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "No se pudo iniciar el cronómetro");
      setTimeout(() => setMsg(""), 4000);
    } finally {
      await cronometro.syncDesdeServidor(false);
    }
  }

  function marcarLeido() {
    if (leido) return;
    setLeido(true);
    try { localStorage.setItem(`mck_hilo_leido_${ticketId}`, "1"); } catch { /* sin almacenamiento */ }
  }

  /** Casilla 3: la foto de cómo quedó sale directo de la cámara, sin pasar por el cuadro de texto. */
  async function subirEvidencia(lista: File[]) {
    if (lista.length === 0 || subiendoFoto) return;
    setSubiendoFoto(true);
    try {
      await enviar.mutateAsync({
        ticketId,
        texto: lista.length > 1 ? `📷 ${lista.length} fotos de evidencia` : "📷 Foto de evidencia",
        archivos: lista,
      });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "No se pudo subir la foto");
      setTimeout(() => setMsg(""), 4000);
    } finally {
      setSubiendoFoto(false);
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

  // ── Qué ve cada quien ──────────────────────────────────────────────────────
  // «Hacedor»: a quien le toca (o cualquiera si está sin asignar y no la pidió). Juega el
  // wizard con el botón grande. Quien la pidió ve las mismas casillas contadas desde su lado.
  const hacedor = esAsignado || (ticket.asignado_a == null && !esCreadoPorMi);
  const nombresPasos = hacedor || !esCreadoPorMi ? PASOS_HACER : PASOS_PEDIDO;
  const textoPedido = ticket.descripcion?.trim() && ticket.descripcion.trim() !== ticket.titulo.trim()
    ? ticket.descripcion.trim() : "";
  // Las fotos que mandó quien la pidió van en la tarjeta de lo pedido, a la vista siempre.
  const fotosPedido = fotos
    .map((f, idx) => ({ ...f, idx }))
    .filter((f) => f.adjId == null || uidEq(adjuntos.find((a) => a.id === f.adjId)?.creado_por, ticket.creado_por));
  const docsPedido = adjuntos.filter((a) => uidEq(a.creado_por, ticket.creado_por) && !esImagen(a.nombre_original, a.mime));
  const soporteNoImagen = ticket.soporte_archivo && !esImagen(ticket.soporte_archivo) ? ticket.soporte_archivo : null;
  const abrirFoto = (src: string) => {
    const i = fotos.findIndex((f) => f.src === src);
    if (i >= 0) setVisor(i);
  };
  const pasosFaltan = Math.max(0, (ticket.pasos_total ?? 0) - (ticket.pasos_completados ?? 0));
  const puedeEntregar = hacedor && !resuelta && !bloqueada && !noIniciada && ticket.estado !== "esperando_aprobacion" && !esCompra;

  /** El botón grande: la siguiente jugada según la casilla en la que va. */
  function siguienteJugada() {
    if (resuelta || bloqueada) return null;
    if (esCreadoPorMi && ticket!.estado === "esperando_aprobacion") {
      return (
        <div className="space-y-2">
          <p className="text-center text-[15px] font-bold text-ink">
            {ticket!.asignado_a_nombre ?? "Quien la hizo"} la entregó. Revísala y finalízala para archivarla.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={aprobar} className="hp-boton verde">✓ Finalizar</button>
            <button type="button" onClick={pedirCambios} className="hp-boton blanco">↺ Falta algo</button>
          </div>
          <button type="button" onClick={rechazar} className="w-full text-center text-[14px] font-semibold text-ink-muted underline underline-offset-2">
            Rechazarla
          </button>
        </div>
      );
    }
    if (!hacedor) return null;
    if (noIniciada) {
      return (
        <button type="button" className="hp-boton w-full"
          onClick={() => void (esAccion ? iniciarOReanudarCrono() : iniciarSolicitud())}>
          ▶ Lo leí · Empezar
        </button>
      );
    }
    if (ticket!.estado === "esperando_aprobacion") {
      return (
        <p className="text-center text-[15px] font-bold text-ink">
          ★ Entregada. Falta que {solicitanteNombre} la finalice.
        </p>
      );
    }
    if (esCompra) {
      return <p className="text-center text-[15px] font-bold text-ink">Marca cada producto de la lista de arriba: al terminar se entrega sola.</p>;
    }
    if (etapa < 3) {
      return (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <button type="button" className="hp-boton" disabled={subiendoFoto} onClick={() => camRef.current?.click()}>
              {subiendoFoto ? "Subiendo…" : "📷 Foto de cómo quedó"}
            </button>
            <button type="button" className="hp-boton blanco" onClick={() => draftRef.current?.focus()} title="Contar con un mensaje">
              ✎
            </button>
          </div>
          {pasosFaltan > 0 && (
            <p className="text-center text-[14px] font-bold text-ink-muted">Faltan {pasosFaltan} paso{pasosFaltan === 1 ? "" : "s"} de la lista de arriba</p>
          )}
          <button type="button" onClick={marcarResuelto} className="w-full text-center text-[14px] font-semibold text-ink-muted underline underline-offset-2">
            Entregar sin foto
          </button>
        </div>
      );
    }
    return puedeEntregar ? (
      <button type="button" onClick={marcarResuelto} className="hp-boton verde w-full">
        ★ {entregaAlSolicitante ? `Entregar a ${solicitanteNombre.split(" ")[0]}` : "Entregar"} · +25
      </button>
    ) : null;
  }
  const jugada = siguienteJugada();

  return (
    <div className="relative min-w-0 flex-1 min-h-0 flex flex-col bg-surface">
      {/* Cabezote: quién y en qué va. El pedido completo va en la tarjeta de abajo (antes el
          título se cortaba en «Empacar …» y no había dónde leerlo entero). */}
      <div className="flex items-center gap-3 border-b-2 border-ink px-3 py-2.5">
        {onCerrar && (
          <button type="button" onClick={onCerrar} className="hp-boton-sm lg:hidden" aria-label="Volver a la bandeja">←</button>
        )}
        <Avatar nombre={contraparteNombre} enLinea={contraparteId != null ? enLineaIds.has(contraparteId) : undefined} size={10} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-extrabold text-ink">
            {esCreadoPorMi ? `Para ${contraparteNombre}` : `De ${contraparteNombre}`}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span className={`hp-etiqueta ${ticket.estado}`}>{ESTADO_LABEL[ticket.estado] ?? ticket.estado}</span>
            <span className="hp-etiqueta tipo">{esAccion ? "Acción" : "Solicitud"}</span>
            <span className="text-[13px] text-ink-muted">{ticket.numero}</span>
          </div>
        </div>
        <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
          <CategoriaBadge cat={ticket.categoria} />
          <PrioridadBadge p={ticket.prioridad} />
        </div>
      </div>

      {/* Lo pedido y las casillas quedan FIJOS arriba: el chat baja solo al último mensaje y
          antes se llevaba la solicitud fuera de la vista («¿qué era lo que me pidieron?»). */}
      <div className="hp-fijo max-h-[34dvh] shrink-0 space-y-2 overflow-y-auto border-b-2 border-ink/15 px-3 pt-2 pb-2 lg:max-h-[48vh] lg:pt-3 lg:pb-2.5">
        {/* ── Lo que te piden: siempre arriba, completo, con sus fotos ── */}
        <section className="hp-pedido">
          <button type="button" onClick={() => setVerPedido((v) => !v)} className="hp-pedido-cinta w-full text-left">
            <span className="flex-1">{hacedor ? "Lo que te piden" : esCreadoPorMi ? "Lo que pediste" : "Lo que se pidió"}</span>
            <span aria-hidden>{verPedido ? "▲ ocultar" : "▼ ver"}</span>
          </button>
          {verPedido ? (
            <div className="space-y-2.5 p-3">
              <p className="hp-pedido-titulo">{ticket.titulo}</p>
              {textoPedido && <p className="hp-pedido-texto">{textoPedido}</p>}
              {fotosPedido.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {fotosPedido.map((f) => (
                    <button key={f.src} type="button" onClick={() => setVisor(f.idx)} aria-label="Ver foto">
                      <img src={f.src} alt="Foto de la solicitud" className="hp-foto" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
              {(soporteNoImagen || docsPedido.length > 0) && (
                <div className="flex flex-wrap gap-2">
                  {soporteNoImagen && (
                    <a href={ticketsUploadUrl(soporteNoImagen, token)} target="_blank" rel="noreferrer" className="hp-boton-sm">
                      <Ico e="📎" /> Adjunto de apertura
                    </a>
                  )}
                  {docsPedido.map((a) => (
                    <a key={a.id} href={ticketsUploadUrl(a.nombre_archivo, token)} target="_blank" rel="noreferrer" className="hp-boton-sm max-w-full">
                      <span>{/\.pdf$/i.test(a.nombre_original) ? "📄" : "📁"}</span>
                      <span className="truncate">{a.nombre_original}</span>
                    </a>
                  ))}
                </div>
              )}
              <p className="text-[14px] text-ink-muted">
                Pedida por <b className="text-ink">{ticket.creado_por_nombre ?? "—"}</b> · {tiempoRelativo(ticket.creado_en)} ({fmtDate(ticket.creado_en)})
              </p>
            </div>
          ) : (
            <p className="truncate px-3 py-2 text-[16px] font-bold text-ink">{ticket.titulo}</p>
          )}
        </section>

        {/* ── Wizard: cuatro casillas y la barra ── */}
        <section className="hp-caja space-y-1.5 p-1.5 lg:space-y-2 lg:p-2.5">
          <div className="hp-pasos">
            {nombresPasos.map((nombre, i) => {
              const hecho = i < etapa;
              const actual = i === etapa && !resuelta;
              return (
                <div key={nombre} className={`hp-paso ${hecho ? "hecho" : actual ? "actual" : ""} ${pasoRecien === i ? "recien" : ""}`}>
                  <span className="hp-paso-num">{hecho ? "✓" : i + 1}</span>
                  <span>{nombre}</span>
                </div>
              );
            })}
          </div>
          <div className="hp-barra" aria-label={`${etapa} de 4`}><span style={{ width: `${(etapa / 4) * 100}%` }} /></div>
          {ticket.estado === "rechazado" && <p className="text-[14px] font-bold text-accent-rose">Rechazada.</p>}
        </section>

      </div>

      <div className="min-w-0 flex-1 min-h-[30dvh] overflow-x-hidden overflow-y-auto px-3 pt-3 pb-2 space-y-3 lg:min-h-0">
        {esAccion && !resuelta && !bloqueada && esAsignado && (
          <CorridaCronometroBlock
            segundos={cronometro.segundos}
            estado={cronometro.corridaId ? (cronometro.activo ? "activa" : "pausada") : null}
            onIniciar={() => void iniciarOReanudarCrono()}
            onReanudar={() => void iniciarOReanudarCrono()}
            onPausar={() => void cronometro.pausar()}
            onFinalizar={marcarResuelto}
            compact
          />
        )}
        {esAccion && !resuelta && !bloqueada && !esAsignado && ticket.asignado_a != null && (
          <p className="text-[14px] font-bold text-ink-muted">⏱ {fmtTiempo(cronometro.segundos)} · en curso de {contraparteNombre}</p>
        )}

        {/* Ayuda y demás jugadas secundarias. */}
        {(bloqueada || (hacedor && !resuelta && !noIniciada) || (esCreadoPorMi && resuelta)) && (
          <div className="flex flex-wrap items-center gap-2">
            {bloqueada && (
              <span className="hp-etiqueta tipo !text-[13px] !normal-case">
                <Ico e="🔒" /> En pausa{ticket.bloqueado_por_asignado_nombre ? ` — esperando a ${ticket.bloqueado_por_asignado_nombre}` : ""}
                {ticket.bloqueado_por_numero ? ` (${ticket.bloqueado_por_numero})` : ""}
              </span>
            )}
            {hacedor && !resuelta && !bloqueada && !noIniciada && (
              <button
                type="button"
                onClick={() => (pedirAbierto ? setPedirAbierto(false) : abrirPedirIntervencion())}
                className={`hp-boton-sm ${pedirAbierto ? "activo" : ""}`}
              >
                <Ico e="🙋" /> Pedir ayuda
              </button>
            )}
            {esCreadoPorMi && resuelta && (
              <button type="button" onClick={pedirCambios} className="hp-boton-sm">↺ Pedir cambios</button>
            )}
          </div>
        )}

        {pedirAbierto && (
          <div className="hp-caja space-y-3 p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {puedePreguntarCreador && (
                <button type="button" onClick={() => setModoInter("preguntar")}
                  className={`hp-boton-sm !flex-col !items-start text-left ${modoInter === "preguntar" ? "activo" : ""}`}>
                  <span>❓ Preguntarle a {ticket.creado_por_nombre ?? "quien la pidió"}</span>
                  <span className="text-[13px] font-medium opacity-80">Le llega un aviso. Se reactiva sola cuando responda.</span>
                </button>
              )}
              <button type="button" onClick={() => setModoInter("pausar")}
                className={`hp-boton-sm !flex-col !items-start text-left ${modoInter === "pausar" ? "activo" : ""}`}>
                <span><Ico e="🛑" /> Pausar y delegar</span>
                <span className="text-[13px] font-medium opacity-80">Crea una sub-solicitud. Ésta queda en pausa hasta que la resuelvan.</span>
              </button>
              <button type="button" onClick={() => setModoInter("colaborar")}
                className={`hp-boton-sm !flex-col !items-start text-left ${modoInter === "colaborar" ? "activo" : ""}`}>
                <span><Ico e="👥" /> Invitar a colaborar</span>
                <span className="text-[13px] font-medium opacity-80">Comparte el hilo sin pausar.</span>
              </button>
            </div>
            {modoInter !== "preguntar" && (
              <select
                value={interDestino}
                onChange={(e) => setInterDestino(e.target.value ? Number(e.target.value) : "")}
                className="hp-campo w-full px-3 py-2.5"
              >
                <option value="">¿A quién?</option>
                {companeros.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            )}
            <textarea
              value={interTexto}
              onChange={(e) => setInterTexto(e.target.value)}
              placeholder={modoInter === "preguntar" ? "¿Qué necesitas preguntarle?" : modoInter === "colaborar" ? "Nota para quien invitas (opcional)" : "¿Qué necesitas que resuelva?"}
              rows={2}
              className="hp-campo w-full resize-none px-3 py-2.5"
            />
            {errorInter && <p className="text-[14px] font-bold text-accent-rose">{errorInter}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPedirAbierto(false)} className="hp-boton-sm">Cancelar</button>
              <button type="button" onClick={() => void enviarIntervencion()} disabled={enviandoInter} className="hp-boton-sm activo disabled:opacity-40">
                {enviandoInter ? "Enviando…" : "Enviar"}
              </button>
            </div>
          </div>
        )}

        {esCompra && (
          <div className="hp-caja p-3">
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
          <PasosSection
            ticketId={ticketId}
            token={token}
            editMode={puedeEditarPasos}
            allowCheck={ticketPermiteMarcarPasos(ticket)}
          />
        )}
        <MaterialesSection ticketId={ticketId} token={token} user={user} readonly hideIfEmpty />

        {/* ── Conversación ── */}
        {cargandoTimeline && items.length === 0 && (
          <p className="py-4 text-center text-[15px] text-ink-muted">Cargando mensajes…</p>
        )}
        <div className="space-y-2">
          {items.map((item, idx) => {
            const fechaLabel = getDateLabel(item.ts);
            const prevTs = items[idx - 1]?.ts;
            const mostrarSep = fechaLabel && fechaLabel !== (prevTs ? getDateLabel(prevTs) : null);
            const sep = mostrarSep ? (
              <div className="flex items-center gap-2 py-1.5">
                <div className="h-0.5 flex-1 bg-ink/15" />
                <span className="px-1 text-[14px] font-bold text-ink-muted">{fechaLabel}</span>
                <div className="h-0.5 flex-1 bg-ink/15" />
              </div>
            ) : null;

            if (item.kind === "sistema") {
              return (
                <div key={item.id}>
                  {sep}
                  <div className="flex justify-center py-0.5">
                    <span className="hp-sistema">{item.ev.texto}</span>
                  </div>
                </div>
              );
            }

            const autorId = item.kind === "adjunto" ? item.adjunto.creado_por : item.ev.usuario_id;
            const autorNombre = item.kind === "adjunto" ? (item.adjunto.creado_por_nombre ?? "?") : (item.ev.autor_nombre ?? "?");
            const esMio = uidEq(autorId, user.id);
            return (
              <div key={item.id}>
                {sep}
                <div className={`flex items-end gap-2 ${esMio ? "justify-end" : "justify-start"}`}>
                  {!esMio && <Avatar nombre={autorNombre} enLinea={autorId != null ? enLineaIds.has(autorId) : undefined} size={8} />}
                  <div className="max-w-[85%] space-y-1 lg:max-w-[65%]">
                    {!esMio && <p className="hp-autor px-0.5">{autorNombre}</p>}
                    {item.kind === "adjunto" ? (
                      esImagen(item.adjunto.nombre_original, item.adjunto.mime) ? (
                        <button type="button" onClick={() => abrirFoto(ticketsUploadUrl(item.adjunto.nombre_archivo, token))} aria-label="Ver foto">
                          <img
                            src={ticketsUploadUrl(item.adjunto.nombre_archivo, token)}
                            alt={item.adjunto.nombre_original}
                            className="hp-img-chat"
                            loading="lazy"
                          />
                        </button>
                      ) : (
                        <a
                          href={ticketsUploadUrl(item.adjunto.nombre_archivo, token)}
                          target="_blank" rel="noreferrer"
                          className={`hp-burbuja flex items-center gap-2 ${esMio ? "mia" : "otra"}`}
                        >
                          <span className="shrink-0 text-lg">{/\.pdf$/i.test(item.adjunto.nombre_original) ? "📄" : "📁"}</span>
                          <span className="truncate underline underline-offset-2">{item.adjunto.nombre_original}</span>
                        </a>
                      )
                    ) : (
                      <div className={`hp-burbuja ${esMio ? "mia" : "otra"}`}>
                        <p className="whitespace-pre-wrap">{item.ev.texto}</p>
                      </div>
                    )}
                    <p className={`hp-hora px-0.5 ${esMio ? "text-right" : "text-left"}`}>{horaDe(item.ts)}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div ref={bottomRef} />
      </div>

      {msg && <p className="px-4 py-1 text-[14px] font-bold text-accent-rose">{msg}</p>}

      {/* ── Siguiente jugada: un solo botón grande según la casilla ── */}
      {jugada && <div className="hp-jugada border-t-2 border-ink bg-surface-panel px-3 py-2 lg:py-2.5">{jugada}</div>}
      <input
        ref={camRef} type="file" accept="image/*" capture="environment" multiple hidden
        onChange={(e) => {
          const lista = e.target.files ? Array.from(e.target.files) : [];
          e.target.value = "";
          void subirEvidencia(lista);
        }}
      />

      {puedeEscribir ? (
        <div className="border-t-2 border-ink p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:p-2.5">
          {archivos.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {archivos.map((f, i) => (
                <span key={i} className="hp-etiqueta tipo !normal-case !text-[13px]">
                  {f.name}
                  <button type="button" onClick={() => setArchivos((prev) => prev.filter((_, j) => j !== i))} aria-label="Quitar">✕</button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="hp-boton-sm shrink-0 !px-2.5"
              title="Adjuntar archivo"
              aria-label="Adjuntar archivo"
            >
              <Icon name="paperclip" size={20} />
            </button>
            <input
              ref={fileRef} type="file" multiple hidden
              onChange={(e) => {
                if (e.target.files) setArchivos((prev) => [...prev, ...Array.from(e.target.files!)]);
                e.target.value = "";
              }}
            />
            <textarea
              ref={draftRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                // Crece con el texto (hasta ~6 líneas) para leer lo que se escribe.
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
              }}
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
              placeholder="Escribe aquí…"
              rows={1}
              className="hp-campo min-h-[52px] min-w-0 flex-1 resize-none px-3 py-3"
            />
            <button
              type="button"
              onClick={() => void enviarMensaje()}
              disabled={enviar.isPending || (!draft.trim() && archivos.length === 0)}
              className="hp-boton-sm activo shrink-0 !min-h-[48px] disabled:opacity-40"
            >
              Enviar
            </button>
          </div>
        </div>
      ) : (
        !jugada && (
          <div className="border-t-2 border-ink p-3 text-center text-[15px] font-semibold text-ink-muted">
            {bloqueada
              ? "En pausa por una intervención pendiente."
              : noIniciada
                ? "Aún no empieza."
                : "Esta conversación ya está cerrada."}
          </div>
        )
      )}

      {visor != null && fotos.length > 0 && (
        <VisorFotos fotos={fotos} inicio={Math.min(visor, fotos.length - 1)} onCerrar={() => setVisor(null)} />
      )}

      {dialogo && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !dialogoOcupado && setDialogo(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="hp-pedido w-full max-w-sm space-y-3 p-4"
          >
            <p className="text-[18px] font-extrabold text-ink">{dialogo.titulo}</p>
            {dialogo.detalle && <p className="whitespace-pre-line text-[15px] leading-snug text-ink-muted">{dialogo.detalle}</p>}
            {dialogo.campo && (
              <textarea
                autoFocus
                value={dialogoTexto}
                onChange={(e) => { setDialogoTexto(e.target.value); setDialogoError(""); }}
                placeholder={dialogo.campo.placeholder}
                rows={3}
                className="hp-campo w-full resize-none px-3 py-2"
              />
            )}
            {dialogoError && <p className="text-[14px] font-bold text-accent-rose">{dialogoError}</p>}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setDialogo(null)} disabled={dialogoOcupado} className="hp-boton blanco">
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmarDialogo()}
                disabled={dialogoOcupado}
                className={`hp-boton ${dialogo.tono === "peligro" ? "rosa" : dialogo.tono === "aviso" ? "" : "verde"}`}
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
