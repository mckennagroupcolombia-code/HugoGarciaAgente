import { useEffect, useMemo, useRef, useState } from "react";
import { useTicketsAuth } from "../../stores/ticketsAuth";
import { useAppStore } from "../../stores/app";
import {
  useCanalesEquipo,
  useEnviarCanal,
  useMarcarCanalLeido,
  useMensajesCanal,
  type CanalEquipo,
  type CitaMensaje,
  type MensajeCanal,
  type ModuloCanal,
  type RefMensaje,
} from "../../hooks/useCanalesEquipo";
import { ChipVinculo, SelectorVinculo } from "./VinculoModulo";
import SolicitudesDelGrupo from "./SolicitudesDelGrupo";
import { canalesEnPantalla } from "../../hooks/useAvisosMensajes";
import BarraEscritura, { BotonCaja, IconoCamara, IconoClip, IconoEnlace } from "./BarraEscritura";

function hora(ts: number): string {
  const d = new Date(ts * 1000);
  const hoy = new Date();
  const mismoDia = d.toDateString() === hoy.toDateString();
  return mismoDia
    ? d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function esImagen(m: MensajeCanal): boolean {
  const mime = m.adjunto_mime || "";
  if (mime.startsWith("image/")) return true;
  const n = (m.adjunto_nombre || m.adjunto_archivo || m.wa_media_path || "").toLowerCase();
  return /\.(png|jpe?g|gif|webp|heic)$/.test(n);
}

/** Nota de voz grabada en el panel o audio que llegó por el grupo de WhatsApp enlazado. */
function esAudio(m: MensajeCanal): boolean {
  if ((m.adjunto_mime || "").startsWith("audio/")) return true;
  const n = (m.adjunto_nombre || m.adjunto_archivo || m.wa_media_path || "").toLowerCase();
  return /\.(webm|ogg|oga|opus|mp3|m4a|aac|wav)$/.test(n);
}

function urlAdjunto(m: MensajeCanal, token: string): string | null {
  const t = encodeURIComponent(token);
  if (m.adjunto_archivo) return `/api/canales/uploads/${encodeURIComponent(m.adjunto_archivo)}?token=${t}`;
  if (m.wa_media_path) return `/api/canales/media-wa/${m.id}?token=${t}`;
  return null;
}

/** Resumen de una línea de lo citado: texto, o qué tipo de adjunto era. */
function resumenCita(c: Pick<CitaMensaje, "texto" | "adjunto_nombre" | "adjunto_mime"> & { eliminado?: boolean }): string {
  if (c.eliminado) return "Mensaje eliminado";
  if (c.texto) return c.texto;
  const mime = c.adjunto_mime || "";
  if (mime.startsWith("audio/")) return "🎤 Nota de voz";
  if (mime.startsWith("image/")) return "📷 Foto";
  return c.adjunto_nombre ? `📎 ${c.adjunto_nombre}` : "Adjunto";
}

/** Cita al estilo WhatsApp: franja de color con el autor y el texto citado. */
function Cita({ cita, onClick, onQuitar }: { cita: CitaMensaje; onClick?: () => void; onQuitar?: () => void }) {
  return (
    <div className="flex items-stretch gap-1 overflow-hidden rounded-lg border-l-4 border-accent bg-accent/10">
      <button type="button" onClick={onClick} disabled={!onClick}
        className="mck-btn-no-fx min-w-0 flex-1 px-2 py-1 text-left disabled:cursor-default"
        title={onClick ? "Ver el mensaje original" : undefined}>
        <span className="block truncate text-[10.5px] font-bold text-accent">{cita.autor_nombre}</span>
        <span className={`line-clamp-2 block break-words text-[12px] leading-snug text-muted ${cita.eliminado ? "italic" : ""}`}>{resumenCita(cita)}</span>
      </button>
      {onQuitar && (
        <button type="button" onClick={onQuitar} className="mck-btn-no-fx shrink-0 px-2 text-[13px] text-muted hover:text-ink" aria-label="Cancelar respuesta">✕</button>
      )}
    </div>
  );
}

function citaDe(m: MensajeCanal): CitaMensaje {
  return { id: m.id, autor_nombre: m.autor_nombre, texto: m.texto, adjunto_nombre: m.adjunto_nombre, adjunto_mime: m.adjunto_mime, eliminado: false };
}

/** Un mensaje del chat → solicitud en la Agenda (con responsable y cronómetro), ya llenada. */
function reportarIncidente(canal: CanalEquipo, m?: MensajeCanal) {
  const st = useAppStore.getState();
  const enlace = m?.ref && typeof m.ref.titulo === "string" ? `\nVinculado: ${m.ref.titulo}${m.ref.detalle ? ` (${String(m.ref.detalle)})` : ""}` : "";
  const origen = (m ? `${m.autor_nombre} escribió en «${canal.nombre}»: ${m.texto || "(foto)"}` : `Reportado desde el canal «${canal.nombre}».`) + enlace;
  st.setSolicitudBoot({
    abrirWizard: true,
    prefillTitulo: m?.texto ? `Incidente: ${m.texto.slice(0, 70)}` : "Incidente: ",
    prefillDescripcion: origen,
  });
  st.setTicketsBootView("solicitudes");
  st.setPanel("hugo");
}

function Burbuja({ m, propio, token, modulos, onIncidente, onResponder, onIrA, resaltado }: {
  m: MensajeCanal; propio: boolean; token: string; modulos: ModuloCanal[];
  onIncidente: () => void; onResponder: () => void; onIrA: (id: number) => void; resaltado: boolean;
}) {
  const url = urlAdjunto(m, token);
  // Deslizar la burbuja a la derecha (celular) responde, como en WhatsApp.
  const toque = useRef<{ x: number; y: number } | null>(null);
  const [arrastre, setArrastre] = useState(0);
  if (m.tipo === "sistema") {
    return (
      <div className="mx-auto max-w-[85%] rounded-lg border border-accent/30 bg-accent/5 px-3 py-1.5 text-center text-[11.5px] text-ink">
        <span className="font-mono text-[9.5px] uppercase tracking-wide text-muted">{m.autor_nombre} · {hora(m.creado_en)}</span>
        <p className="whitespace-pre-wrap">{m.texto}</p>
        <div className="flex justify-center"><ChipVinculo refm={m.ref} modulos={modulos} /></div>
      </div>
    );
  }
  return (
    <div id={`msg-canal-${m.id}`} className={`group flex items-center gap-1 ${propio ? "flex-row-reverse" : ""}`}
      onTouchStart={(e) => { toque.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
      onTouchMove={(e) => {
        const t = toque.current;
        if (!t) return;
        const dx = e.touches[0].clientX - t.x;
        if (Math.abs(e.touches[0].clientY - t.y) > 30) { toque.current = null; setArrastre(0); return; }
        setArrastre(Math.max(0, Math.min(dx, 80)));
      }}
      onTouchEnd={() => { if (arrastre > 55) onResponder(); toque.current = null; setArrastre(0); }}>
      <div style={arrastre ? { transform: `translateX(${arrastre}px)` } : undefined}
        className={`max-w-[78%] rounded-2xl px-3 py-1.5 shadow-sm transition-[box-shadow] ${arrastre ? "" : "duration-700"} ${resaltado ? "ring-2 ring-accent" : ""} ${propio ? "rounded-br-sm bg-accent/15" : "rounded-bl-sm border border-border bg-surface-panel"}`}>
        {!propio && (
          <p className="text-[10.5px] font-bold text-accent">
            {m.autor_nombre}
            {m.origen === "wa" && <span className="ml-1 font-normal text-muted" title="Llegó por el grupo de WhatsApp enlazado">· vía WhatsApp</span>}
          </p>
        )}
        {m.cita && <div className="mb-1 mt-0.5"><Cita cita={m.cita} onClick={() => onIrA(m.cita!.id)} /></div>}
        {url && esImagen(m) && (
          <a href={url} target="_blank" rel="noreferrer" className="mt-1 block">
            <img src={url} alt={m.adjunto_nombre || "foto"} loading="lazy" className="max-h-72 rounded-lg border border-border object-contain" />
          </a>
        )}
        {url && esAudio(m) && (
          <audio src={url} controls preload="metadata" className="mt-1 h-10 w-64 max-w-full" />
        )}
        {url && !esImagen(m) && !esAudio(m) && (
          <a href={url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-bold text-ink hover:border-accent/60">
            📎 {m.adjunto_nombre || "archivo"}
          </a>
        )}
        {m.texto && <p className="whitespace-pre-wrap break-words text-[13px] leading-snug text-ink">{m.texto}</p>}
        <ChipVinculo refm={m.ref} modulos={modulos} />
        <p className="mt-0.5 flex items-center justify-end gap-2 font-mono text-[9.5px] text-muted">
          <button onClick={onResponder} className="mck-btn-no-fx opacity-60 hover:text-accent hover:opacity-100"
            title="Responder a este mensaje">↩ responder</button>
          <button onClick={onIncidente} className="mck-btn-no-fx opacity-60 hover:text-accent hover:opacity-100"
            title="Convertir este mensaje en una solicitud de este grupo (responsable y fecha límite)">→ tarea</button>
          {hora(m.creado_en)}
        </p>
      </div>
      {arrastre > 0 && <span className="text-[18px] text-accent" style={{ opacity: arrastre / 55 }} aria-hidden>↩</span>}
    </div>
  );
}

/** Un canal del equipo: se escribe sin cronómetro (a diferencia del hilo de un ticket). */
export default function HiloCanal({ canal, onVolver, compacto }: { canal: CanalEquipo; onVolver?: () => void; compacto?: boolean }) {
  const token = useTicketsAuth((s) => s.token) || "";
  const yo = useTicketsAuth((s) => s.user?.id);
  const mensajes = useMensajesCanal(canal.id);
  const modulos = useCanalesEquipo().data?.modulos ?? [];
  const moduloCanal = modulos.find((x) => x.clave === canal.modulo) ?? null;
  const [vinculo, setVinculo] = useState<RefMensaje | null>(null);
  const [eligiendo, setEligiendo] = useState(false);
  // «→ tarea» en un mensaje: abre el formulario de solicitud del grupo con ese mensaje.
  const [tareaDesde, setTareaDesde] = useState<MensajeCanal | null>(null);
  // «↩ responder»: el mensaje citado va arriba de la caja hasta enviar o cancelar.
  const [respondiendo, setRespondiendo] = useState<MensajeCanal | null>(null);
  const [resaltado, setResaltado] = useState<number | null>(null);
  const cajaRef = useRef<HTMLTextAreaElement>(null);
  const enviar = useEnviarCanal(canal.id);
  const leido = useMarcarCanalLeido();
  const [texto, setTexto] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const finRef = useRef<HTMLDivElement>(null);
  const fotoRef = useRef<HTMLInputElement>(null);
  const archivoRef = useRef<HTMLInputElement>(null);

  const lista = mensajes.data?.mensajes ?? [];

  // Mientras este grupo está abierto no sale la tarjeta de aviso por sus propios mensajes.
  useEffect(() => {
    canalesEnPantalla.add(canal.id);
    return () => { canalesEnPantalla.delete(canal.id); };
  }, [canal.id]);
  const ultimoId = lista.length ? lista[lista.length - 1].id : 0;

  useEffect(() => {
    finRef.current?.scrollIntoView({ block: "end" });
    if (ultimoId && canal.no_leidos > 0) leido.mutate(canal.id);
  }, [ultimoId, canal.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const vistaPrevia = useMemo(() => (archivo && archivo.type.startsWith("image/") ? URL.createObjectURL(archivo) : null), [archivo]);
  useEffect(() => () => { if (vistaPrevia) URL.revokeObjectURL(vistaPrevia); }, [vistaPrevia]);

  const mandar = async () => {
    if (!texto.trim() && !archivo && !vinculo) return;
    setError(null);
    try {
      await enviar.mutateAsync({ texto: texto.trim(), archivo, ref: vinculo, respondeA: respondiendo?.id ?? null });
      setTexto("");
      setArchivo(null);
      setVinculo(null);
      setRespondiendo(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // La nota de voz sale sola al terminar de grabar; lo escrito y el vínculo se quedan en la caja.
  const mandarVoz = async (voz: File) => {
    setError(null);
    try {
      await enviar.mutateAsync({ texto: "", archivo: voz, ref: null, respondeA: respondiendo?.id ?? null });
      setRespondiendo(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const responder = (m: MensajeCanal) => {
    setRespondiendo(m);
    setTimeout(() => cajaRef.current?.focus(), 0);
  };

  // Tocar una cita lleva al mensaje original y lo resalta un momento.
  const irA = (id: number) => {
    const el = document.getElementById(`msg-canal-${id}`);
    if (!el) { setError("El mensaje original es más antiguo que los que se muestran aquí."); return; }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setResaltado(id);
    setTimeout(() => setResaltado((r) => (r === id ? null : r)), 1600);
  };

  // Al cambiar de grupo no se arrastra la respuesta pendiente.
  useEffect(() => { setRespondiendo(null); }, [canal.id]);

  return (
    <div className={`flex min-h-0 min-w-0 flex-1 flex-col bg-surface ${compacto ? "" : "rounded-xl border border-border"}`}>
      {/* En la burbuja flotante (compacto) el nombre ya va en su propia cabecera. */}
      {!compacto && <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        {onVolver && (
          <button onClick={onVolver} className="rounded-md border border-border px-2 py-1 text-[12px] lg:hidden" aria-label="Volver a los canales">←</button>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-bold text-ink">{canal.nombre}</p>
          <p className="truncate text-[11px] text-muted">
            {moduloCanal && <span className="mr-1 rounded bg-accent/15 px-1 font-bold text-accent" title="Grupo de trabajo vinculado a este módulo">↔ {moduloCanal.nombre}</span>}
            {canal.descripcion || (canal.miembros.length ? `${canal.miembros.length} miembros` : "Todo el equipo")}
            {canal.wa_jid && (
              <span title="Lo que se escribe en el grupo de WhatsApp aparece aquí">
                {" "}· enlazado a «{canal.wa_nombre || "grupo de WhatsApp"}»{canal.espejo_salida ? " (ida y vuelta)" : " (solo llegada)"}
              </span>
            )}
          </p>
        </div>
      </div>}

      <SolicitudesDelGrupo canal={canal} modulo={moduloCanal} desde={tareaDesde} onDesdeUsado={() => setTareaDesde(null)} />

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {mensajes.isLoading && <p className="text-[12px] text-muted">Cargando…</p>}
        {!mensajes.isLoading && lista.length === 0 && (
          <p className="py-8 text-center text-[12px] text-muted">Todavía no hay mensajes. Lo que se escriba aquí queda registrado y cuenta como actividad.</p>
        )}
        {lista.map((m) => (
          <Burbuja key={m.id} m={m} propio={m.origen === "panel" && m.usuario_id === yo} token={token} modulos={modulos}
            onIncidente={() => setTareaDesde(m)} onResponder={() => responder(m)} onIrA={irA} resaltado={resaltado === m.id} />
        ))}
        <div ref={finRef} />
      </div>

      <div className="border-t border-border p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {archivo && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-surface-input p-1.5">
            {vistaPrevia ? <img src={vistaPrevia} alt="" className="h-12 w-12 rounded object-cover" /> : <span className="text-[18px]">📎</span>}
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">{archivo.name}</span>
            <button onClick={() => setArchivo(null)} className="rounded px-2 text-[12px] text-muted hover:text-ink" aria-label="Quitar adjunto">✕</button>
          </div>
        )}
        {eligiendo && modulos.length > 0 && (
          <SelectorVinculo modulos={modulos} moduloInicial={canal.modulo} onCerrar={() => setEligiendo(false)}
            onElegir={(r) => { setVinculo(r); setEligiendo(false); }} />
        )}
        {vinculo && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-accent/40 bg-surface-input p-1.5">
            <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide text-accent">
              {modulos.find((x) => x.clave === vinculo.modulo)?.item || "Enlace"}
            </span>
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">{vinculo.titulo}</span>
            <button onClick={() => setVinculo(null)} className="rounded px-2 text-[12px] text-muted hover:text-ink" aria-label="Quitar vínculo">✕</button>
          </div>
        )}
        {respondiendo && (
          <div className="mb-2">
            <Cita cita={citaDe(respondiendo)} onClick={() => irA(respondiendo.id)} onQuitar={() => setRespondiendo(null)} />
          </div>
        )}
        {error && <p className="mb-1 text-[11.5px] text-accent-rose">{error}</p>}
        <input ref={fotoRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); e.target.value = ""; }} />
        <input ref={archivoRef} type="file" className="hidden"
          accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.heic,.doc,.docx,.xls,.xlsx,.txt,.csv"
          onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); e.target.value = ""; }} />
        <BarraEscritura
          texto={texto} onTexto={setTexto} onEnviar={() => void mandar()} onVoz={(f) => void mandarVoz(f)}
          hayAdjunto={Boolean(archivo || vinculo)} enviando={enviar.isPending} onError={setError} textareaRef={cajaRef}
          placeholder={respondiendo ? `Responder a ${respondiendo.autor_nombre}` : undefined}
          iconos={<>
            {modulos.length > 0 && (
              <BotonCaja onClick={() => setEligiendo((v) => !v)} activo={eligiendo || Boolean(vinculo)}
                titulo={`Vincular ${moduloCanal ? moduloCanal.item.toLowerCase() : "un elemento"} a este mensaje`}><IconoEnlace /></BotonCaja>
            )}
            <BotonCaja onClick={() => archivoRef.current?.click()} titulo="Adjuntar archivo"><IconoClip /></BotonCaja>
          </>}
          iconosSinTexto={<BotonCaja onClick={() => fotoRef.current?.click()} titulo="Tomar o subir una foto"><IconoCamara /></BotonCaja>}
        />
      </div>
    </div>
  );
}
