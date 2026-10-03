/**
 * Colaboradores: el proyecto que Armando construye con un colaborador externo (primero Sebastián).
 *
 * Desde el 3-oct-2026 un proyecto es UN gran mapa — un cladograma por linaje
 * (colaboradores/MapaProyecto): la raíz es el proyecto y cada tarjeta cuelga de la que la originó.
 * El edificio pixel (26-sep) y el tablero por secciones (3-oct, mañana) se retiraron: las cajas del
 * edificio entraron al mapa como la rama «Proceso» (colab_tablero.absorber_edificio) y su documento
 * sigue en el historial del servidor.
 *
 * Tiempo real «suficiente»: el mapa se consulta cada 4 s y cada tarjeta se guarda sola, así dos
 * personas no se pisan. Backend: app/services/colab_tablero.py (+ colaboradores.py para el proyecto).
 */
import "./colaboradores/pixel.css";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { api } from "../api/client";
import { Sprite } from "./colaboradores/pixel";
import MapaProyecto from "./colaboradores/MapaProyecto";
import type { Adjunto, Diagrama, Lista } from "./colaboradores/modelo";

function Editor({ inicial, yo, onVolver }: { inicial: Diagrama; yo?: { id: number; nombre: string }; onVolver: () => void }) {
  const qc = useQueryClient();
  const [titulo, setTitulo] = useState(inicial.titulo);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pleno, setPleno] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const timer = useRef<number | null>(null);

  /** El nombre vive en el proyecto (colab_diagramas); su documento viejo se reenvía tal cual. */
  async function guardarTitulo(t: string, reintento = false): Promise<void> {
    try {
      const d = await api.get<Diagrama>(`/api/colaboradores/diagramas/${inicial.id}`);
      await api.put<Diagrama>(`/api/colaboradores/diagramas/${inicial.id}`,
        { doc: d.doc, version: d.version, titulo: t, resumen: "nombre del proyecto" });
      setAviso(null);
      void qc.invalidateQueries({ queryKey: ["colab-diagramas"] });
    } catch (e) {
      if ((e as Error).message === "conflicto" && !reintento) return guardarTitulo(t, true);
      setAviso((e as Error).message || "No se pudo guardar el nombre");
    }
  }

  async function subirMedia(file: File): Promise<Adjunto | null> {
    try {
      const form = new FormData();
      form.append("archivo", file);
      return await api.upload<Adjunto>(`/api/colaboradores/diagramas/${inicial.id}/media`, form);
    } catch (e) {
      setAviso((e as Error).message || "No se pudo subir el archivo");
      return null;
    }
  }

  return (
    <div className={`colab-pixel ${pleno ? "fixed inset-0 z-40 flex h-[100dvh] flex-col gap-2 bg-surface p-2" : "flex min-h-0 flex-1 flex-col gap-2"}`}
         style={pleno ? { paddingTop: "max(0.5rem, env(safe-area-inset-top, 0px))" } : undefined}>
      <div className="px-hud flex min-w-0 items-center gap-2">
        <button type="button" onClick={onVolver} aria-label="Volver a los proyectos"
                className="shrink-0 rounded-lg border border-border px-2 py-1 text-sm font-bold text-muted">←</button>
        <Sprite s="bandera" px={2} titulo="Proyecto" />
        <input value={titulo} aria-label="Nombre del proyecto"
               onChange={(e) => {
                 const v = e.target.value;
                 setTitulo(v);
                 if (timer.current) window.clearTimeout(timer.current);
                 if (v.trim()) timer.current = window.setTimeout(() => void guardarTitulo(v.trim()), 1200);
               }}
               className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-base font-bold text-ink focus:border-border" />
        {aviso && <span className="px-t max-w-[40%] shrink-0 truncate text-[11px] text-[#FF004D]">{aviso}</span>}
        <button type="button" onClick={() => setPleno((v) => !v)} aria-label={pleno ? "Salir de pantalla completa" : "Pantalla completa"}
                className="shrink-0 rounded-lg border border-border px-2 py-1 text-sm font-bold text-muted">{pleno ? "⤡" : "⛶"}</button>
      </div>
      <MapaProyecto did={inicial.id} yoId={yo?.id ?? 0} titulo={titulo} subir={subirMedia} />
    </div>
  );
}

// ─── Panel: los proyectos ────────────────────────────────────────────────────

export default function ColaboradoresPanel() {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState<Diagrama | null>(null);
  const [archivados, setArchivados] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery<Lista>({
    queryKey: ["colab-diagramas", archivados],
    queryFn: () => api.get(`/api/colaboradores/diagramas${archivados ? "?archivados=1" : ""}`),
    refetchInterval: abierto ? false : 10_000,
  });

  async function abrir(id: number) {
    setError(null);
    try { setAbierto(await api.get<Diagrama>(`/api/colaboradores/diagramas/${id}`)); }
    catch (e) { setError((e as Error).message); }
  }
  async function crear() {
    const titulo = window.prompt("Nombre del proyecto (ej. Collar persa):");
    if (!titulo?.trim()) return;
    try {
      const d = await api.post<Diagrama>("/api/colaboradores/diagramas", { titulo: titulo.trim() });
      void qc.invalidateQueries({ queryKey: ["colab-diagramas"] });
      setAbierto(d);
    } catch (e) { setError((e as Error).message); }
  }
  async function archivar(id: number, a: boolean) {
    await api.post(`/api/colaboradores/diagramas/${id}/archivar`, { archivado: a });
    void qc.invalidateQueries({ queryKey: ["colab-diagramas"] });
  }

  if (abierto) {
    return (
      <Editor key={abierto.id} inicial={abierto} yo={q.data?.yo}
              onVolver={() => { setAbierto(null); void qc.invalidateQueries({ queryKey: ["colab-diagramas"] }); }} />
    );
  }

  const lista = q.data?.diagramas ?? [];
  const yoId = String(q.data?.yo.id ?? "");
  return (
    <div className="colab-pixel mx-auto min-h-0 w-full max-w-3xl flex-1 space-y-3 overflow-y-auto px-1 pb-4">
      <div>
        <h2 className="text-base font-bold text-ink">Colaboradores</h2>
        <p className="text-xs text-muted">
          Cada proyecto es un mapa que crece como un árbol: de dónde parten, la meta, y cada resultado, obstáculo y
          decisión colgando de lo que lo originó, con a quién le toca. Lo que guarda uno lo ve el otro en segundos.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void crear()} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-white">＋ Nuevo proyecto</button>
        <label className="flex items-center gap-1 text-xs text-muted">
          <input type="checkbox" checked={archivados} onChange={(e) => setArchivados(e.target.checked)} /> ver archivados
        </label>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {q.isLoading && <p className="text-sm text-muted">Cargando…</p>}
      {q.error && <p className="text-sm text-red-500">{(q.error as Error).message}</p>}
      {!q.isLoading && !lista.length && !q.error && (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
          Todavía no hay proyectos. Creen uno y empiecen por de dónde parten.
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {lista.map((d) => {
          const tb = d.tablero;
          const mio = tb?.turno[yoId] ?? 0;
          const otro = Object.entries(tb?.turno ?? {}).filter(([k]) => k !== yoId).reduce((s, [, n]) => s + n, 0);
          return (
            <div key={d.id} className="border-2 border-ink bg-surface-panel shadow-[3px_3px_0_rgb(var(--mck-ink))]">
              <button type="button" onClick={() => void abrir(d.id)} className="block w-full p-2.5 text-left hover:bg-surface-hover" data-proyecto={d.id}>
                <span className="flex items-center gap-1.5"><Sprite s="bandera" px={2} /><b className="text-ink">{d.titulo}</b></span>
                <span className="mt-1 block text-xs text-ink-secondary">{tb?.meta ? `Meta: ${tb.meta}` : "Sin meta escrita"}</span>
                <span className="mt-1 flex flex-wrap gap-1 text-[11px]">
                  <span className="border border-border px-1.5">{tb?.tarjetas ?? 0} tarjetas</span>
                  {mio > 0 && <span className="bg-accent px-1.5 text-white">te tocan {mio}</span>}
                  {otro > 0 && <span className="border border-border px-1.5">al otro {otro}</span>}
                </span>
                <span className="mt-1 block text-[11px] text-muted">
                  {d.actualizado_por_nombre ? `${d.actualizado_por_nombre} · ` : ""}{d.actualizado_en}
                </span>
              </button>
              <button type="button" onClick={() => void archivar(d.id, !d.archivado)}
                      className="w-full border-t border-border px-2 py-0.5 text-left text-[11px] font-bold text-muted">
                {d.archivado ? "Desarchivar" : "Archivar"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
