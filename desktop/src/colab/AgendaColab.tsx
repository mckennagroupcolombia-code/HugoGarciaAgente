/**
 * Agenda del colaborador externo: solo lo que hay entre él y Armando.
 *
 * El backend ya recorta (`_guard_colaborador_externo` y `listar_tickets`): acá
 * se lista, se crea una solicitud para Armando, se comenta y se marca como
 * hecha una acción que le asignaron. Nada de misiones, equipo ni categorías.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import type { TicketsUser } from "./stubs/ticketsAuth";

type Ticket = {
  id: number;
  numero?: string | null;
  titulo: string;
  descripcion?: string | null;
  estado: string;
  tipo: string;
  creado_por: number;
  creado_por_nombre?: string | null;
  asignado_a?: number | null;
  asignado_a_nombre?: string | null;
  creado_en: string;
  actualizado_en?: string | null;
};

type Comentario = { id: number; texto: string; creado_en: string; usuario_id: number; autor_nombre?: string | null };

const ESTADOS: Record<string, string> = {
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  esperando_aprobacion: "Por revisar",
  resuelto: "Hecha",
  rechazado: "Rechazada",
  cerrado: "Cerrada",
};

const ABIERTOS = new Set(["pendiente", "en_proceso", "esperando_aprobacion"]);

function fecha(s?: string | null) {
  return (s || "").replace("T", " ").slice(0, 16);
}

function Detalle({ t, yo, onVolver }: { t: Ticket; yo: TicketsUser; onVolver: () => void }) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const q = useQuery<Comentario[]>({
    queryKey: ["colab-comentarios", t.id],
    queryFn: () => api.get(`/api/tickets/${t.id}/comentarios`),
    refetchInterval: 10_000,
  });

  async function comentar() {
    if (!texto.trim()) return;
    setEnviando(true);
    setError(null);
    try {
      await api.post(`/api/tickets/${t.id}/comentarios`, { texto: texto.trim() });
      setTexto("");
      void qc.invalidateQueries({ queryKey: ["colab-comentarios", t.id] });
    } catch (e) { setError((e as Error).message); }
    finally { setEnviando(false); }
  }

  async function marcarHecha() {
    setError(null);
    try {
      await api.put(`/api/tickets/${t.id}/estado`, { estado: "resuelto" });
      void qc.invalidateQueries({ queryKey: ["colab-agenda"] });
      onVolver();
    } catch (e) { setError((e as Error).message); }
  }

  const meToca = t.asignado_a === yo.id && ABIERTOS.has(t.estado);

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-3 overflow-y-auto px-1 pb-4">
      <button type="button" onClick={onVolver} className="self-start text-sm font-bold text-muted hover:text-ink">← Volver</button>
      <div className="rounded-xl border border-border bg-surface-panel p-3">
        <p className="text-xs text-muted">{t.numero || `#${t.id}`} · {ESTADOS[t.estado] ?? t.estado}</p>
        <h3 className="mt-0.5 text-base font-bold text-ink">{t.titulo}</h3>
        {t.descripcion && <p className="mt-2 whitespace-pre-wrap text-sm text-ink-secondary">{t.descripcion}</p>}
        <p className="mt-2 text-xs text-muted">
          De {t.creado_por_nombre || "—"} para {t.asignado_a_nombre || "—"} · {fecha(t.creado_en)}
        </p>
        {meToca && (
          <button type="button" onClick={() => void marcarHecha()} className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-white">
            Marcar como hecha
          </button>
        )}
      </div>

      <div className="space-y-2">
        {q.isLoading && <p className="text-sm text-muted">Cargando conversación…</p>}
        {(q.data ?? []).map((c) => (
          <div
            key={c.id}
            className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${c.usuario_id === yo.id ? "ml-auto bg-accent/10" : "border border-border bg-surface-panel"}`}
          >
            <p className="text-[11px] font-bold text-muted">{c.autor_nombre || "—"} · {fecha(c.creado_en)}</p>
            <p className="whitespace-pre-wrap text-ink">{c.texto}</p>
          </div>
        ))}
        {!q.isLoading && !(q.data ?? []).length && <p className="text-sm text-muted">Sin mensajes todavía.</p>}
      </div>

      <div className="flex gap-2">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={2}
          placeholder="Escribe un mensaje…"
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface-input px-3 py-2 text-sm"
        />
        <button type="button" disabled={enviando || !texto.trim()} onClick={() => void comentar()} className="self-end rounded-lg bg-accent px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
          Enviar
        </button>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}

function Nueva({ onCreada, onCancelar }: { onCreada: () => void; onCancelar: () => void }) {
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function crear() {
    if (!titulo.trim()) return;
    setEnviando(true);
    setError(null);
    try {
      // Sin `asignado_a`: el backend la asigna al anfitrión (Armando).
      await api.post("/api/tickets/", {
        titulo: titulo.trim(),
        descripcion: descripcion.trim(),
        categoria: "colaboradores",
        tipo: "solicitud",
        prioridad: "media",
      });
      onCreada();
    } catch (e) { setError((e as Error).message); }
    finally { setEnviando(false); }
  }

  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface-panel p-3">
      <p className="text-sm font-bold text-ink">Nueva solicitud para Armando</p>
      <input
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        placeholder="¿Qué necesitas?"
        className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm"
      />
      <textarea
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
        rows={3}
        placeholder="Detalle (opcional)"
        className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm"
      />
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancelar} className="text-sm font-bold text-muted hover:text-ink">Cancelar</button>
        <button type="button" disabled={enviando || !titulo.trim()} onClick={() => void crear()} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50">
          Enviar
        </button>
      </div>
    </div>
  );
}

export default function AgendaColab({ yo }: { yo: TicketsUser }) {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState<Ticket | null>(null);
  const [nueva, setNueva] = useState(false);
  const [verCerradas, setVerCerradas] = useState(false);
  const q = useQuery<Ticket[]>({
    queryKey: ["colab-agenda"],
    queryFn: () => api.get("/api/tickets/"),
    refetchInterval: abierto ? false : 15_000,
  });

  if (abierto) return <Detalle t={abierto} yo={yo} onVolver={() => setAbierto(null)} />;

  const todas = q.data ?? [];
  const lista = verCerradas ? todas : todas.filter((t) => ABIERTOS.has(t.estado));
  const meToca = lista.filter((t) => t.asignado_a === yo.id);
  const pedi = lista.filter((t) => t.asignado_a !== yo.id);

  const grupo = (titulo: string, filas: Ticket[]) => (
    <section className="space-y-2">
      <h3 className="text-xs font-bold uppercase tracking-wide text-muted">{titulo}</h3>
      {!filas.length && <p className="text-sm text-muted">Nada por ahora.</p>}
      {filas.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setAbierto(t)}
          className="block w-full rounded-xl border border-border bg-surface-panel p-3 text-left hover:bg-surface-hover"
        >
          <p className="font-bold text-ink">{t.titulo}</p>
          <p className="mt-0.5 text-xs text-muted">
            {t.numero || `#${t.id}`} · {ESTADOS[t.estado] ?? t.estado} · {fecha(t.actualizado_en || t.creado_en)}
          </p>
        </button>
      ))}
    </section>
  );

  return (
    <div className="mx-auto min-h-0 w-full max-w-2xl flex-1 space-y-4 overflow-y-auto px-1 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        {!nueva && (
          <button type="button" onClick={() => setNueva(true)} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-white">
            ＋ Pedirle algo a Armando
          </button>
        )}
        <label className="ml-auto flex items-center gap-1 text-xs text-muted">
          <input type="checkbox" checked={verCerradas} onChange={(e) => setVerCerradas(e.target.checked)} /> ver cerradas
        </label>
      </div>
      {nueva && (
        <Nueva
          onCancelar={() => setNueva(false)}
          onCreada={() => { setNueva(false); void qc.invalidateQueries({ queryKey: ["colab-agenda"] }); }}
        />
      )}
      {q.isLoading && <p className="text-sm text-muted">Cargando…</p>}
      {q.error && <p className="text-sm text-red-500">{(q.error as Error).message}</p>}
      {!q.isLoading && !q.error && (
        <>
          {grupo("Te pidió Armando", meToca)}
          {grupo("Le pediste a Armando", pedi)}
        </>
      )}
    </div>
  );
}
