/**
 * El chat con una persona, dentro del juego (Empresa viva → hablarle a alguien → «Hablar»).
 *
 * Preguntarle algo a alguien es una CONVERSACIÓN, no una solicitud: esto es el chat directo de los
 * dos del chat del equipo (POST /api/canales/directo → canales_internos.canal_directo). Queda
 * guardado, le llega con su aviso aunque no esté jugando, y lo ven los dos en «Equipo». Nadie más
 * lo lee (ni administración). Para pedirle una tarea está «Pedirle una tarea» (solicitud).
 *
 * Mientras está abierto se consulta cada 2,5 s lo nuevo (`despues_de`) y se marca leído.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { tocarSonido } from "../../lib/sonidosJuego";

interface Mensaje {
  id: number; usuario_id: number | null; autor_nombre: string; texto: string; creado_en: number;
  adjunto_nombre?: string | null; adjunto_mime?: string | null; tipo?: string;
}
interface Canal { id: number; nombre: string }

const hora = (s: number) => new Date(s * 1000).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function ChatPersona({ persona, yo, retratoOtro, retratoYo, onCerrar, onEnviado, onVerEnEquipo }: {
  persona: { id: number; nombre: string };
  yo: number;
  retratoOtro?: string | null;
  retratoYo?: string | null;
  onCerrar: () => void;
  /** Para lanzar el avioncito al instante (luego la foto del servidor trae el mismo mensaje). */
  onEnviado: (mensajeId: number, texto: string, canalId: number) => void;
  onVerEnEquipo: (canalId: number) => void;
}) {
  const nombre = persona.nombre.split(" ")[0];
  const [canal, setCanal] = useState<Canal | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const lista = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const ultimo = useRef(0);

  const traer = useCallback(async (c: Canal, primera: boolean) => {
    const r = await api.get<{ mensajes: Mensaje[] }>(
      `/api/canales/${c.id}/mensajes?${primera ? "limite=40" : `despues_de=${ultimo.current}`}`);
    const nuevos = (r.mensajes ?? []).filter((m) => m.tipo !== "sistema" || m.texto);
    if (!nuevos.length) return;
    ultimo.current = Math.max(ultimo.current, ...nuevos.map((m) => m.id));
    setMensajes((prev) => {
      const vistos = new Set(prev.map((m) => m.id));
      return [...prev, ...nuevos.filter((m) => !vistos.has(m.id))];
    });
    if (!primera && nuevos.some((m) => m.usuario_id !== yo)) tocarSonido("blip");
    void api.post(`/api/canales/${c.id}/leido`, {}).catch(() => {});
  }, [yo]);

  useEffect(() => {
    let vivo = true;
    let t = 0;
    api.post<Canal>("/api/canales/directo", { con: persona.id })
      .then(async (c) => {
        if (!vivo) return;
        setCanal(c);
        await traer(c, true).catch(() => setError("No se pudieron leer los mensajes."));
        const ciclo = () => { if (vivo) void traer(c, false).catch(() => {}).finally(() => { t = window.setTimeout(ciclo, 2500); }); };
        t = window.setTimeout(ciclo, 2500);
      })
      .catch((e: Error) => vivo && setError(e.message || "No se pudo abrir el chat."));
    return () => { vivo = false; window.clearTimeout(t); };
  }, [persona.id, traer]);

  useEffect(() => { lista.current?.scrollTo({ top: lista.current.scrollHeight }); }, [mensajes.length]);
  useEffect(() => { campo.current?.focus(); }, [canal]);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onCerrar(); } };
    window.addEventListener("keydown", tecla, true);
    return () => window.removeEventListener("keydown", tecla, true);
  }, [onCerrar]);

  async function enviar() {
    if (!canal || !texto.trim() || enviando) return;
    setEnviando(true);
    setError("");
    try {
      const m = await api.post<Mensaje>(`/api/canales/${canal.id}/mensajes`, { texto: texto.trim() });
      ultimo.current = Math.max(ultimo.current, m.id);
      setMensajes((prev) => [...prev, m]);
      onEnviado(m.id, texto.trim(), canal.id);
      setTexto("");
      tocarSonido("blip");
    } catch (e) {
      setError((e as Error).message || "No se pudo enviar.");
    } finally {
      setEnviando(false);
      campo.current?.focus();
    }
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center p-2 sm:p-3">
      <div className="ev-ventana pointer-events-auto relative flex max-h-[min(70%,32rem)] w-[min(46rem,100%)] flex-col p-3 sm:p-4" role="dialog"
           aria-label={`Chat con ${nombre}`}>
        <div className="mb-2 flex items-center gap-2">
          {retratoOtro && <img src={retratoOtro} alt="" className="ev-retrato h-10 w-10 rounded border-2 border-[#8a95d6] bg-[#0b1140]" draggable={false} />}
          <div className="min-w-0 flex-1 leading-tight">
            <div className="ev-nombre-dialogo truncate">Chat con {nombre}</div>
            <div className="text-xs text-[#b9c2ff]">Queda guardado y le llega con aviso. Solo lo leen ustedes dos.</div>
          </div>
          {canal && (
            <button type="button" className="ev-boton mck-btn-no-fx" onClick={() => onVerEnEquipo(canal.id)} title="Abrir este chat en Equipo (fotos, notas de voz…)">
              Ver en Equipo
            </button>
          )}
          <button type="button" onClick={onCerrar} aria-label="Cerrar (Esc)" className="ev-boton mck-btn-no-fx">Esc ✕</button>
        </div>
        <div ref={lista} className="min-h-[7rem] flex-1 space-y-1.5 overflow-y-auto rounded border-2 border-[#8a95d6]/60 bg-[#0b1140]/55 p-2 text-[15px]">
          {!canal && !error && <p className="text-[#b9c2ff]">Abriendo el chat…</p>}
          {canal && !mensajes.length && <p className="text-[#b9c2ff]">Todavía no se han escrito. Salúdale o pregúntale lo que necesites.</p>}
          {mensajes.map((m) => {
            const mio = m.usuario_id === yo;
            const cuerpo = m.texto || (m.adjunto_nombre ? `📎 ${m.adjunto_nombre}` : m.adjunto_mime?.startsWith("audio/") ? "🎤 Nota de voz" : "");
            return (
              <div key={m.id} className={`flex items-end gap-1.5 ${mio ? "justify-end" : ""}`}>
                {!mio && (retratoOtro ? <img src={retratoOtro} alt="" className="ev-retrato h-6 w-6 rounded" draggable={false} /> : null)}
                <div className={`max-w-[80%] rounded-md px-2 py-1 ${mio ? "bg-[#ffe14d] text-[#1d2b53] [text-shadow:none]" : "bg-[#2b3a8c]"}`}>
                  <div className="whitespace-pre-wrap break-words">{cuerpo}</div>
                  <div className={`mt-0.5 text-[10px] ${mio ? "text-[#1d2b53]/70" : "text-[#b9c2ff]"}`}>{hora(m.creado_en)}</div>
                </div>
                {mio && (retratoYo ? <img src={retratoYo} alt="" className="ev-retrato h-6 w-6 rounded" draggable={false} /> : null)}
              </div>
            );
          })}
        </div>
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
          <input ref={campo} className="ev-campo" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={4000}
                 placeholder={`Escríbele a ${nombre}…`} aria-label={`Escríbele a ${nombre}`} disabled={!canal} />
          <button type="submit" className="ev-boton mck-btn-no-fx shrink-0" disabled={enviando || !texto.trim() || !canal}>
            {enviando ? "…" : "Enviar"}
          </button>
        </form>
        {error && <p className="mt-1 text-sm text-[#ffb4b4]">{error}</p>}
      </div>
    </div>
  );
}
