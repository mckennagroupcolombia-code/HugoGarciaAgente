/**
 * Lo que se hace DESDE el juego, siempre por los caminos de siempre de la app:
 * - Preguntarle algo a alguien → una solicitud `subtipo: "pregunta"` (POST /api/tickets/), la
 *   misma que llega a su bandeja de Mensajes con su aviso.
 * - Compartir una idea o un mensaje con un grupo → el chat del equipo (POST /api/canales/<id>/mensajes).
 *   Si el grupo tiene espejo a WhatsApp, se avisa antes: el mensaje sale también allá.
 * - Cambiar mi avatar → preferencias_ui.empresa (PUT /api/tickets/auth/me/preferencias).
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import { useTicketsAuth } from "../../stores/ticketsAuth";
import type { AvatarElegido } from "./motor";

const BASE = `${import.meta.env.BASE_URL}empresa/personajes/previews/`;
export const AVATARES = ["female", "male"].flatMap((g) => "abcdef".split("").map((l) => `character-${g}-${l}`));
const ACCESORIOS: { id: string; nombre: string }[] = [
  { id: "", nombre: "Sin accesorio" }, { id: "aid-glasses", nombre: "Gafas" }, { id: "aid-sunglasses", nombre: "Gafas de sol" },
];
const COLORES = ["", "#FFE14D", "#FF9F1C", "#FF77A8", "#5DB8FF", "#2ECC71", "#B388FF"];

function Modal({ titulo, onCerrar, children }: { titulo: string; onCerrar: () => void; children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/35 p-3" onClick={onCerrar}>
      <div className="max-h-full w-[min(30rem,100%)] overflow-y-auto rounded-2xl border border-border bg-surface-panel p-4 text-sm text-ink shadow-2xl"
           onClick={(e) => e.stopPropagation()} role="dialog" aria-label={titulo}>
        <div className="mb-3 flex items-center gap-2">
          <h3 className="flex-1 text-base font-bold">{titulo}</h3>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="rounded px-2 text-ink-muted hover:bg-surface-hover">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const btnPrincipal = "rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50";
const btnSecundario = "rounded-lg px-3 py-1.5 text-sm font-semibold text-ink-muted hover:bg-surface-hover";
const campo = "w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm";

// ─── Mi avatar ───────────────────────────────────────────────────────────────

export function EditorAvatar({ actual, onCerrar, onGuardado }: {
  actual: AvatarElegido | null; onCerrar: () => void; onGuardado: () => void;
}) {
  const token = useTicketsAuth((s) => s.token);
  const [avatar, setAvatar] = useState(actual?.avatar || AVATARES[0]);
  const [accesorio, setAccesorio] = useState(actual?.accesorio ?? "");
  const [color, setColor] = useState(actual?.color ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function guardar() {
    if (!token) return;
    setGuardando(true);
    setError("");
    try {
      const r = await fetch("/api/tickets/auth/me/preferencias", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ empresa: { avatar, accesorio, color } }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      onGuardado();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Mi avatar" onCerrar={onCerrar}>
      <p className="mb-2 text-ink-secondary">Elige cómo te ven los demás en el barrio.</p>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {AVATARES.map((a) => (
          <button key={a} type="button" onClick={() => setAvatar(a)} aria-label={a} aria-pressed={avatar === a}
                  className={`rounded-xl border-2 bg-[#EAF6FF] p-1 transition ${avatar === a ? "border-accent ring-2 ring-accent/40" : "border-transparent hover:border-border-strong"}`}>
            <img src={`${BASE}${a}.png`} alt="" className="mx-auto h-14 w-14 object-contain" draggable={false} />
          </button>
        ))}
      </div>
      <p className="mb-1 mt-3 font-semibold">Accesorio</p>
      <div className="flex flex-wrap gap-1.5">
        {ACCESORIOS.map((a) => (
          <button key={a.id} type="button" onClick={() => setAccesorio(a.id)} aria-pressed={accesorio === a.id}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${accesorio === a.id ? "border-accent bg-accent text-white" : "border-border text-ink-secondary hover:border-border-strong"}`}>
            {a.nombre}
          </button>
        ))}
      </div>
      <p className="mb-1 mt-3 font-semibold">Color de tu nombre</p>
      <div className="flex flex-wrap gap-2">
        {COLORES.map((c) => (
          <button key={c || "blanco"} type="button" onClick={() => setColor(c)} aria-label={c || "Blanco"} aria-pressed={color === c}
                  className={`h-7 w-7 rounded-full border-2 ${color === c ? "border-accent ring-2 ring-accent/40" : "border-border"}`}
                  style={{ background: c || "#FFFFFF" }} />
        ))}
      </div>
      {error && <p className="mt-2 text-danger">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCerrar} className={btnSecundario}>Cancelar</button>
        <button type="button" onClick={guardar} disabled={guardando} className={btnPrincipal}>{guardando ? "Guardando…" : "Guardar"}</button>
      </div>
    </Modal>
  );
}

// ─── Preguntarle algo a alguien ──────────────────────────────────────────────

export function PreguntarA({ persona, onCerrar, onEnviada }: {
  persona: { id: number; nombre: string }; onCerrar: () => void; onEnviada: (ticketId: number, asunto: string) => void;
}) {
  const [asunto, setAsunto] = useState("");
  const [detalle, setDetalle] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const nombre = persona.nombre.split(" ")[0];

  async function enviar() {
    if (!asunto.trim()) return;
    setEnviando(true);
    setError("");
    try {
      const t = await api.post<{ id: number }>("/api/tickets/", {
        titulo: asunto.trim(), descripcion: "", categoria: "logistica", prioridad: "media",
        asignado_a: persona.id, tipo: "solicitud", subtipo: "pregunta",
      });
      if (detalle.trim()) await api.post(`/api/tickets/${t.id}/comentarios`, { texto: detalle.trim() });
      onEnviada(t.id, asunto.trim());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal titulo={`Preguntarle algo a ${nombre}`} onCerrar={onCerrar}>
      <p className="mb-2 text-ink-secondary">Le llega a {nombre} en su bandeja de Mensajes, con aviso. La respuesta te llega a ti igual.</p>
      <input value={asunto} onChange={(e) => setAsunto(e.target.value)} placeholder="¿Qué le quieres preguntar?" className={campo}
             maxLength={140} autoFocus onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) void enviar(); }} />
      <textarea value={detalle} onChange={(e) => setDetalle(e.target.value)} rows={3} placeholder="Más detalle (opcional)" className={`${campo} mt-2`} />
      {error && <p className="mt-2 text-danger">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCerrar} className={btnSecundario}>Cancelar</button>
        <button type="button" onClick={enviar} disabled={enviando || !asunto.trim()} className={btnPrincipal}>{enviando ? "Enviando…" : "Enviar pregunta"}</button>
      </div>
    </Modal>
  );
}

// ─── Compartir una idea con un grupo ─────────────────────────────────────────

type Canal = { id: number; nombre: string; descripcion: string; miembros: number[]; espejo_salida: boolean; wa_jid: string; wa_nombre: string };

export function CompartirEnGrupo({ onCerrar, onEnviado }: {
  onCerrar: () => void; onEnviado: (mensajeId: number, canal: Canal, texto: string, esIdea: boolean) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["empresa-viva-canales"],
    queryFn: () => api.get<{ canales: Canal[] }>("/api/canales"),
    staleTime: 60_000,
  });
  const canales = data?.canales ?? [];
  const [canalId, setCanalId] = useState<number | null>(null);
  const [esIdea, setEsIdea] = useState(true);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const canal = canales.find((c) => c.id === canalId) ?? null;
  const vaAWhatsapp = Boolean(canal?.espejo_salida && canal?.wa_jid);

  async function enviar() {
    if (!canal || !texto.trim()) return;
    setEnviando(true);
    setError("");
    const cuerpo = esIdea ? `Idea: ${texto.trim()}` : texto.trim();
    try {
      const m = await api.post<{ id: number }>(`/api/canales/${canal.id}/mensajes`, { texto: cuerpo });
      onEnviado(m.id, canal, cuerpo, esIdea);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal titulo="Compartir con un grupo" onCerrar={onCerrar}>
      <div className="mb-3 flex gap-1.5">
        {([[true, "Una idea"], [false, "Un mensaje"]] as const).map(([v, t]) => (
          <button key={t} type="button" onClick={() => setEsIdea(v)} aria-pressed={esIdea === v}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${esIdea === v ? "border-accent bg-accent text-white" : "border-border text-ink-secondary"}`}>
            {t}
          </button>
        ))}
      </div>
      <p className="mb-1 font-semibold">¿En qué grupo?</p>
      {isLoading && <p className="text-ink-muted">Cargando grupos…</p>}
      <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
        {canales.map((c) => (
          <button key={c.id} type="button" onClick={() => setCanalId(c.id)} aria-pressed={canalId === c.id} title={c.descripcion || c.nombre}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${canalId === c.id ? "border-accent bg-accent/10 text-ink" : "border-border text-ink-secondary hover:border-border-strong"}`}>
            {c.nombre}{c.espejo_salida && c.wa_jid ? " · WhatsApp" : ""}
          </button>
        ))}
      </div>
      <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={4} className={`${campo} mt-3`}
                placeholder={esIdea ? "Cuéntale tu idea al grupo" : "Escribe tu mensaje"} />
      {vaAWhatsapp && (
        <p className="mt-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-800 dark:text-amber-300">
          Este grupo está enlazado con WhatsApp{canal?.wa_nombre ? ` («${canal.wa_nombre}»)` : ""}: el mensaje también se publica allá.
        </p>
      )}
      {error && <p className="mt-2 text-danger">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCerrar} className={btnSecundario}>Cancelar</button>
        <button type="button" onClick={enviar} disabled={enviando || !canal || !texto.trim()} className={btnPrincipal}>
          {enviando ? "Enviando…" : esIdea ? "Compartir idea" : "Enviar"}
        </button>
      </div>
    </Modal>
  );
}
