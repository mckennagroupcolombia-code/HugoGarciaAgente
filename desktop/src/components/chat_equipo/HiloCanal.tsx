import { useEffect, useMemo, useRef, useState } from "react";
import { useTicketsAuth } from "../../stores/ticketsAuth";
import { useAppStore } from "../../stores/app";
import {
  useEnviarCanal,
  useMarcarCanalLeido,
  useMensajesCanal,
  type CanalEquipo,
  type MensajeCanal,
} from "../../hooks/useCanalesEquipo";

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

function urlAdjunto(m: MensajeCanal, token: string): string | null {
  const t = encodeURIComponent(token);
  if (m.adjunto_archivo) return `/api/canales/uploads/${encodeURIComponent(m.adjunto_archivo)}?token=${t}`;
  if (m.wa_media_path) return `/api/canales/media-wa/${m.id}?token=${t}`;
  return null;
}

/** Un mensaje del chat → solicitud en la Agenda (con responsable y cronómetro), ya llenada. */
function reportarIncidente(canal: CanalEquipo, m?: MensajeCanal) {
  const st = useAppStore.getState();
  const origen = m ? `${m.autor_nombre} escribió en «${canal.nombre}»: ${m.texto || "(foto)"}` : `Reportado desde el canal «${canal.nombre}».`;
  st.setSolicitudBoot({
    abrirWizard: true,
    prefillTitulo: m?.texto ? `Incidente: ${m.texto.slice(0, 70)}` : "Incidente: ",
    prefillDescripcion: origen,
  });
  st.setTicketsBootView("solicitudes");
  st.setPanel("hugo");
}

function Burbuja({ m, propio, token, onIncidente }: { m: MensajeCanal; propio: boolean; token: string; onIncidente: () => void }) {
  const url = urlAdjunto(m, token);
  if (m.tipo === "sistema") {
    return (
      <div className="mx-auto max-w-[85%] rounded-lg border border-accent/30 bg-accent/5 px-3 py-1.5 text-center text-[11.5px] text-ink">
        <span className="font-mono text-[9.5px] uppercase tracking-wide text-muted">{m.autor_nombre} · {hora(m.creado_en)}</span>
        <p className="whitespace-pre-wrap">{m.texto}</p>
      </div>
    );
  }
  return (
    <div className={`flex ${propio ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[78%] rounded-2xl px-3 py-1.5 shadow-sm ${propio ? "rounded-br-sm bg-accent/15" : "rounded-bl-sm border border-border bg-surface-panel"}`}>
        {!propio && (
          <p className="text-[10.5px] font-bold text-accent">
            {m.autor_nombre}
            {m.origen === "wa" && <span className="ml-1 font-normal text-muted" title="Llegó por el grupo de WhatsApp enlazado">· vía WhatsApp</span>}
          </p>
        )}
        {url && esImagen(m) && (
          <a href={url} target="_blank" rel="noreferrer" className="mt-1 block">
            <img src={url} alt={m.adjunto_nombre || "foto"} loading="lazy" className="max-h-72 rounded-lg border border-border object-contain" />
          </a>
        )}
        {url && !esImagen(m) && (
          <a href={url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-bold text-ink hover:border-accent/60">
            📎 {m.adjunto_nombre || "archivo"}
          </a>
        )}
        {m.texto && <p className="whitespace-pre-wrap break-words text-[13px] leading-snug text-ink">{m.texto}</p>}
        <p className="mt-0.5 flex items-center justify-end gap-2 font-mono text-[9.5px] text-muted">
          <button onClick={onIncidente} className="mck-btn-no-fx opacity-60 hover:text-accent hover:opacity-100"
            title="Convertir este mensaje en una solicitud de la Agenda (con responsable)">→ tarea</button>
          {hora(m.creado_en)}
        </p>
      </div>
    </div>
  );
}

/** Un canal del equipo: se escribe sin cronómetro (a diferencia del hilo de un ticket). */
export default function HiloCanal({ canal, onVolver }: { canal: CanalEquipo; onVolver?: () => void }) {
  const token = useTicketsAuth((s) => s.token) || "";
  const yo = useTicketsAuth((s) => s.user?.id);
  const mensajes = useMensajesCanal(canal.id);
  const enviar = useEnviarCanal(canal.id);
  const leido = useMarcarCanalLeido();
  const [texto, setTexto] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const finRef = useRef<HTMLDivElement>(null);
  const fotoRef = useRef<HTMLInputElement>(null);
  const archivoRef = useRef<HTMLInputElement>(null);

  const lista = mensajes.data?.mensajes ?? [];
  const ultimoId = lista.length ? lista[lista.length - 1].id : 0;

  useEffect(() => {
    finRef.current?.scrollIntoView({ block: "end" });
    if (ultimoId && canal.no_leidos > 0) leido.mutate(canal.id);
  }, [ultimoId, canal.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const vistaPrevia = useMemo(() => (archivo && archivo.type.startsWith("image/") ? URL.createObjectURL(archivo) : null), [archivo]);
  useEffect(() => () => { if (vistaPrevia) URL.revokeObjectURL(vistaPrevia); }, [vistaPrevia]);

  const mandar = async () => {
    if (!texto.trim() && !archivo) return;
    setError(null);
    try {
      await enviar.mutateAsync({ texto: texto.trim(), archivo });
      setTexto("");
      setArchivo(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        {onVolver && (
          <button onClick={onVolver} className="rounded-md border border-border px-2 py-1 text-[12px] lg:hidden" aria-label="Volver a los canales">←</button>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-bold text-ink">{canal.nombre}</p>
          <p className="truncate text-[11px] text-muted">
            {canal.descripcion || (canal.miembros.length ? `${canal.miembros.length} miembros` : "Todo el equipo")}
            {canal.wa_jid && (
              <span title="Lo que se escribe en el grupo de WhatsApp aparece aquí">
                {" "}· enlazado a «{canal.wa_nombre || "grupo de WhatsApp"}»{canal.espejo_salida ? " (ida y vuelta)" : " (solo llegada)"}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => reportarIncidente(canal)}
          className="rounded-md border border-border bg-surface-input px-2 py-1 text-[11px] text-ink hover:border-accent/60"
          title="Un incidente o una petición que alguien debe resolver va como solicitud en la Agenda: ahí tiene responsable y cronómetro"
        >
          Reportar incidente
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {mensajes.isLoading && <p className="text-[12px] text-muted">Cargando…</p>}
        {!mensajes.isLoading && lista.length === 0 && (
          <p className="py-8 text-center text-[12px] text-muted">Todavía no hay mensajes. Lo que se escriba aquí queda registrado y cuenta como actividad.</p>
        )}
        {lista.map((m) => (
          <Burbuja key={m.id} m={m} propio={m.origen === "panel" && m.usuario_id === yo} token={token}
            onIncidente={() => reportarIncidente(canal, m)} />
        ))}
        <div ref={finRef} />
      </div>

      <div className="border-t border-border p-2">
        {archivo && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-surface-input p-1.5">
            {vistaPrevia ? <img src={vistaPrevia} alt="" className="h-12 w-12 rounded object-cover" /> : <span className="text-[18px]">📎</span>}
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">{archivo.name}</span>
            <button onClick={() => setArchivo(null)} className="rounded px-2 text-[12px] text-muted hover:text-ink" aria-label="Quitar adjunto">✕</button>
          </div>
        )}
        {error && <p className="mb-1 text-[11.5px] text-accent-rose">{error}</p>}
        <div className="flex items-end gap-1.5">
          <input ref={fotoRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); e.target.value = ""; }} />
          <input ref={archivoRef} type="file" className="hidden"
            accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.heic,.doc,.docx,.xls,.xlsx,.txt,.csv"
            onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); e.target.value = ""; }} />
          <button onClick={() => fotoRef.current?.click()} className="rounded-lg border border-border bg-surface-input px-2.5 py-2 text-[15px]" title="Tomar o subir una foto" aria-label="Foto">📷</button>
          <button onClick={() => archivoRef.current?.click()} className="rounded-lg border border-border bg-surface-input px-2.5 py-2 text-[15px]" title="Adjuntar archivo" aria-label="Adjuntar">📎</button>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void mandar();
              }
            }}
            rows={1}
            placeholder="Escribe un mensaje…"
            className="max-h-32 min-h-[40px] flex-1 resize-none rounded-lg border border-border bg-surface-input px-3 py-2 text-[13px] text-ink"
          />
          <button
            onClick={() => void mandar()}
            disabled={enviar.isPending || (!texto.trim() && !archivo)}
            className="rounded-lg bg-accent px-3 py-2 text-[13px] font-bold text-white disabled:opacity-50"
          >
            {enviar.isPending ? "…" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}
