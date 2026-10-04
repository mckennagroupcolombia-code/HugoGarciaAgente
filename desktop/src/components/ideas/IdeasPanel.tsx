/**
 * Diseño de producto → Desarrollar idea: una idea de producto se abre en un
 * cladograma. La raíz es la idea; la IA la ramifica en las siete etapas del
 * ciclo de diseño (usuario, requerimientos, arquitectura, ingeniería y DFM,
 * prototipado, sostenibilidad, riesgos), cada una en sus sub-ramas y puntos.
 * Cualquier nodo se edita con un clic, se ramifica de nuevo con la IA o a mano,
 * y se contrae. API: app/routes_ideas.py (la IA va en segundo plano).
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { esperarJobScan } from "../../lib/scanJobPoll";

interface Nodo {
  id: string;
  texto: string;
  hijos: Nodo[];
}

interface Idea {
  id?: string;
  titulo: string;
  descripcion: string;
  arbol: Nodo | null;
  actualizado?: string;
  actualizado_por?: string;
}

const VACIA: Idea = { titulo: "", descripcion: "", arbol: null };

const CAMPO = "mck-field-lg w-full rounded-lg border border-border bg-surface-input px-2.5 py-1.5 text-sm text-ink";
const BOTON = "rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-40";
const BOTON_SUAVE =
  "rounded border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-40";
const MINI = "rounded px-1 text-[11px] leading-5 text-ink-muted hover:bg-surface-hover hover:text-ink disabled:opacity-40";

/** Un color por rama principal: lo heredan sus sub-ramas y las líneas que las unen. */
const COLORES = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#0ea5e9", "#a855f7", "#84cc16", "#ec4899"];

/** Líneas del cladograma: cada hijo dibuja su tramo horizontal y su parte de la vertical común. */
const CSS_CLADO = `
.clado-hijos { position: relative; padding-left: 18px; }
.clado-hijos::before { content: ""; position: absolute; left: 0; top: 50%; width: 18px; border-top: 2px solid currentColor; }
.clado-hijo { position: relative; padding: 3px 0 3px 18px; }
.clado-hijo::before { content: ""; position: absolute; left: 0; top: 50%; width: 18px; border-top: 2px solid currentColor; }
.clado-hijo::after { content: ""; position: absolute; left: 0; top: 0; bottom: 0; border-left: 2px solid currentColor; }
.clado-hijo:first-child::after { top: 50%; }
.clado-hijo:last-child::after { bottom: 50%; }
.clado-hijo:only-child::after { display: none; }
`;

function nuevoId(): string {
  return Math.random().toString(16).slice(2, 12);
}

/** Copia del árbol con `fn` aplicada al nodo `id` (si `fn` devuelve null, el nodo se quita). */
function editarNodo(n: Nodo, id: string, fn: (n: Nodo) => Nodo | null): Nodo | null {
  if (n.id === id) return fn(n);
  return { ...n, hijos: n.hijos.map((h) => editarNodo(h, id, fn)).filter((h): h is Nodo => h !== null) };
}

/** Textos de la raíz al nodo `id` (para darle contexto a la IA). */
function rutaA(n: Nodo, id: string): string[] | null {
  if (n.id === id) return [n.texto];
  for (const h of n.hijos) {
    const r = rutaA(h, id);
    if (r) return [n.texto, ...r];
  }
  return null;
}

function contar(n: Nodo): number {
  return 1 + n.hijos.reduce((s, h) => s + contar(h), 0);
}

/** El cladograma como esquema de texto con sangría, para pegarlo en un documento. */
function comoTexto(n: Nodo, nivel = 0): string {
  const linea = nivel === 0 ? `# ${n.texto}` : `${"  ".repeat(nivel - 1)}- ${n.texto}`;
  return [linea, ...n.hijos.map((h) => comoTexto(h, nivel + 1))].join("\n");
}

async function pedirIA<T>(ruta: string, cuerpo: unknown): Promise<T> {
  const r = await api.post<{ job_id?: string; error?: string }>(ruta, cuerpo, { timeoutMs: 30000 });
  if (!r.job_id) throw new Error(r.error || "La IA no respondió");
  return esperarJobScan<T & { status?: string; error?: string }>(
    (id) => `/api/ideas/job/${encodeURIComponent(id)}`,
    r.job_id,
    { timeoutMs: 5 * 60 * 1000 },
  );
}

export default function IdeasPanel() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["ideas"],
    queryFn: () => api.get<{ ideas: Idea[] }>("/api/ideas"),
  });
  const ideas = data?.ideas ?? [];
  const [editando, setEditando] = useState<Idea | null>(null);
  const [cambios, setCambios] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);

  const guardar = useMutation({
    mutationFn: (i: Idea) => api.post<{ idea: Idea }>("/api/ideas", i),
    onSuccess: (r) => {
      // Solo se toma el id: lo demás ya está en pantalla y pudo cambiar mientras se guardaba.
      setEditando((i) => (i ? { ...i, id: r.idea.id, actualizado: r.idea.actualizado } : i));
      setCambios(false);
      setAviso({ ok: true, texto: "Idea guardada." });
      void qc.invalidateQueries({ queryKey: ["ideas"] });
    },
    onError: (e: Error) => setAviso({ ok: false, texto: e.message || "No se pudo guardar." }),
  });

  const eliminar = useMutation({
    mutationFn: (id: string) => api.delete<{ ok: boolean }>(`/api/ideas/${encodeURIComponent(id)}`),
    onSuccess: () => {
      setEditando(null);
      setCambios(false);
      setConfirmarBorrado(false);
      setAviso({ ok: true, texto: "Idea eliminada." });
      void qc.invalidateQueries({ queryKey: ["ideas"] });
    },
    onError: (e: Error) => setAviso({ ok: false, texto: e.message || "No se pudo eliminar." }),
  });

  function abrir(i: Idea | null) {
    if (cambios && !window.confirm("Hay cambios sin guardar en esta idea. ¿Descartarlos?")) return;
    setEditando(i ? structuredClone(i) : { ...VACIA });
    setCambios(false);
    setAviso(null);
    setConfirmarBorrado(false);
  }

  function cambiar(patch: Partial<Idea> | ((i: Idea) => Partial<Idea>)) {
    setEditando((i) => (i ? { ...i, ...(typeof patch === "function" ? patch(i) : patch) } : i));
    setCambios(true);
    setAviso(null);
  }

  return (
    <div className="flex min-h-0 flex-col gap-4 p-3 md:flex-row md:p-4">
      <style>{CSS_CLADO}</style>
      {/* ── Lista ── */}
      <aside className="flex w-full shrink-0 flex-col gap-2 md:w-64">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">Ideas</h2>
          <button type="button" className={BOTON} onClick={() => abrir(null)}>
            + Nueva idea
          </button>
        </div>
        {isLoading && <p className="text-xs text-muted">Cargando…</p>}
        {error && <p className="text-xs text-red-600">{(error as Error).message}</p>}
        {!isLoading && !error && ideas.length === 0 && (
          <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted">
            Aún no hay ideas. Crea la primera con «+ Nueva idea».
          </p>
        )}
        <ul className="flex flex-col gap-1.5">
          {ideas.map((i) => {
            const activa = editando?.id === i.id;
            return (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => abrir(i)}
                  className={`w-full rounded-lg border px-3 py-2 text-left ${
                    activa ? "border-accent bg-accent/10" : "border-border bg-surface hover:border-accent/50"
                  }`}
                >
                  <span className="block truncate text-sm font-medium text-ink">{i.titulo}</span>
                  <span className="block truncate text-[11px] text-muted">
                    {i.arbol ? `${contar(i.arbol) - 1} ramas` : "sin desarrollar"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* ── Editor ── */}
      <section className="min-w-0 flex-1">
        {editando ? (
          <EditorIdea
            key={editando.id ?? "nueva"}
            idea={editando}
            onChange={cambiar}
            onGuardar={(i) => guardar.mutate(i ?? editando)}
            guardando={guardar.isPending}
            aviso={aviso}
            setAviso={setAviso}
            cambios={cambios}
            confirmarBorrado={confirmarBorrado}
            setConfirmarBorrado={setConfirmarBorrado}
            eliminando={eliminar.isPending}
            onEliminar={() => editando.id && eliminar.mutate(editando.id)}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">
            Escribe una idea de producto y la IA la abre en un cladograma: usuario, requerimientos, arquitectura,
            ingeniería y manufactura, prototipado, sostenibilidad y riesgos. Luego cada rama se puede editar,
            ramificar más o contraer.
            {aviso && <p className={`mt-2 text-xs ${aviso.ok ? "text-green-700" : "text-red-600"}`}>{aviso.texto}</p>}
          </div>
        )}
      </section>
    </div>
  );
}

function EditorIdea({
  idea,
  onChange,
  onGuardar,
  guardando,
  aviso,
  setAviso,
  cambios,
  confirmarBorrado,
  setConfirmarBorrado,
  eliminando,
  onEliminar,
}: {
  idea: Idea;
  onChange: (patch: Partial<Idea> | ((i: Idea) => Partial<Idea>)) => void;
  onGuardar: (i?: Idea) => void;
  guardando: boolean;
  aviso: { ok: boolean; texto: string } | null;
  setAviso: (a: { ok: boolean; texto: string } | null) => void;
  cambios: boolean;
  confirmarBorrado: boolean;
  setConfirmarBorrado: (v: boolean) => void;
  eliminando: boolean;
  onEliminar: () => void;
}) {
  const [desarrollando, setDesarrollando] = useState(false);
  /** Nodos que la IA está ramificando ahora mismo. */
  const [ramificando, setRamificando] = useState<Set<string>>(new Set());
  const [contraidos, setContraidos] = useState<Set<string>>(new Set());
  const arbol = idea.arbol;
  const titulo = idea.titulo.trim();

  function cambiarArbol(fn: (a: Nodo) => Nodo | null) {
    // Sobre el estado vigente, no sobre el de este render: la IA puede responder mientras se edita otra rama.
    onChange((i) => ({ arbol: i.arbol ? fn(i.arbol) : i.arbol }));
  }

  async function desarrollar() {
    if (!titulo) return;
    if (arbol && !window.confirm("Se reemplaza el cladograma actual por uno nuevo. ¿Seguir?")) return;
    setDesarrollando(true);
    setAviso(null);
    try {
      const r = await pedirIA<{ arbol: Nodo }>("/api/ideas/desarrollar", {
        titulo,
        descripcion: idea.descripcion,
      });
      setContraidos(new Set());
      const nueva = { ...idea, arbol: r.arbol };
      onChange({ arbol: r.arbol });
      onGuardar(nueva); // un minuto de IA no se pierde por olvidar «Guardar»
    } catch (e) {
      setAviso({ ok: false, texto: (e as Error).message || "La IA no respondió." });
    } finally {
      setDesarrollando(false);
    }
  }

  function empezarAMano() {
    onChange({ arbol: { id: nuevoId(), texto: titulo, hijos: [] } });
  }

  async function ramificar(n: Nodo) {
    if (!arbol) return;
    const ruta = rutaA(arbol, n.id) ?? [n.texto];
    setRamificando((s) => new Set(s).add(n.id));
    try {
      const r = await pedirIA<{ hijos: Nodo[] }>("/api/ideas/ramificar", {
        titulo,
        descripcion: idea.descripcion,
        ruta,
        existentes: n.hijos.map((h) => h.texto),
      });
      setContraidos((s) => {
        const c = new Set(s);
        c.delete(n.id);
        return c;
      });
      cambiarArbol((a) => editarNodo(a, n.id, (x) => ({ ...x, hijos: [...x.hijos, ...r.hijos] })));
    } catch (e) {
      setAviso({ ok: false, texto: (e as Error).message || "La IA no respondió." });
    } finally {
      setRamificando((s) => {
        const c = new Set(s);
        c.delete(n.id);
        return c;
      });
    }
  }

  const todosLosIds = useMemo(() => {
    const ids: string[] = [];
    const recorrer = (n: Nodo, nivel: number) => {
      if (nivel >= 1 && n.hijos.length) ids.push(n.id);
      n.hijos.forEach((h) => recorrer(h, nivel + 1));
    };
    if (arbol) recorrer(arbol, 0);
    return ids;
  }, [arbol]);

  async function copiar() {
    if (!arbol) return;
    try {
      await navigator.clipboard.writeText(comoTexto(arbol));
      setAviso({ ok: true, texto: "Cladograma copiado como texto." });
    } catch {
      setAviso({ ok: false, texto: "No se pudo copiar al portapapeles." });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 md:grid-cols-[1fr_1.4fr]">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Idea</span>
          <input
            value={idea.titulo}
            onChange={(e) => {
              const t = e.target.value;
              onChange({ titulo: t, arbol: arbol ? { ...arbol, texto: t } : arbol });
            }}
            placeholder="Ej.: envase airless de 30 mL para sérum"
            className={CAMPO}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Para quién, precio y restricciones (opcional)
          </span>
          <textarea
            value={idea.descripcion}
            onChange={(e) => onChange({ descripcion: e.target.value })}
            rows={2}
            placeholder="Ej.: mujeres 25-40, gama media, inyección PP, costo < 1 USD, monomaterial reciclable"
            className={CAMPO}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BOTON} disabled={!titulo || desarrollando} onClick={desarrollar}>
          {desarrollando ? "Desarrollando… (≈1 min)" : arbol ? "🌿 Volver a desarrollar con IA" : "🌿 Desarrollar cladograma"}
        </button>
        {!arbol && (
          <button type="button" className={BOTON_SUAVE} disabled={!titulo || desarrollando} onClick={empezarAMano}>
            Empezar a mano
          </button>
        )}
        {arbol && (
          <>
            <button type="button" className={BOTON_SUAVE} onClick={() => setContraidos(new Set())}>
              Expandir todo
            </button>
            <button
              type="button"
              className={BOTON_SUAVE}
              onClick={() => setContraidos(new Set(todosLosIds))}
            >
              Solo ramas principales
            </button>
            <button type="button" className={BOTON_SUAVE} onClick={copiar}>
              Copiar como texto
            </button>
          </>
        )}
        <span className="flex-1" />
        <button type="button" className={BOTON} disabled={!titulo || guardando || !cambios} onClick={() => onGuardar()}>
          {guardando ? "Guardando…" : cambios ? "Guardar" : "Guardado"}
        </button>
        {idea.id &&
          (confirmarBorrado ? (
            <span className="flex items-center gap-1 text-xs">
              ¿Eliminar la idea?
              <button type="button" className="rounded bg-red-600 px-2 py-1 font-semibold text-white" disabled={eliminando} onClick={onEliminar}>
                Sí
              </button>
              <button type="button" className={MINI} onClick={() => setConfirmarBorrado(false)}>
                No
              </button>
            </span>
          ) : (
            <button type="button" className={MINI} onClick={() => setConfirmarBorrado(true)}>
              Eliminar
            </button>
          ))}
      </div>
      {aviso && <p className={`text-xs ${aviso.ok ? "text-green-700" : "text-red-600"}`}>{aviso.texto}</p>}

      {arbol ? (
        <div className="overflow-auto rounded-xl border border-border bg-surface p-4">
          <RamaClado
            nodo={arbol}
            nivel={0}
            color="rgb(var(--mck-border-strong))"
            contraidos={contraidos}
            ramificando={ramificando}
            onToggle={(id) =>
              setContraidos((s) => {
                const c = new Set(s);
                if (c.has(id)) c.delete(id);
                else c.add(id);
                return c;
              })
            }
            onTexto={(id, texto) => cambiarArbol((a) => editarNodo(a, id, (x) => ({ ...x, texto })))}
            onAgregar={(id) =>
              cambiarArbol((a) =>
                editarNodo(a, id, (x) => ({ ...x, hijos: [...x.hijos, { id: nuevoId(), texto: "Nueva rama", hijos: [] }] })),
              )
            }
            onQuitar={(id) => cambiarArbol((a) => editarNodo(a, id, () => null))}
            onRamificar={ramificar}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">
          {desarrollando
            ? "La IA está abriendo la idea en ramas: usuario, requerimientos, arquitectura, ingeniería, prototipado, sostenibilidad y riesgos…"
            : "Escribe la idea y pulsa «Desarrollar cladograma». Si prefieres armarlo tú, «Empezar a mano»."}
        </div>
      )}
    </div>
  );
}

function RamaClado({
  nodo,
  nivel,
  color,
  contraidos,
  ramificando,
  onToggle,
  onTexto,
  onAgregar,
  onQuitar,
  onRamificar,
}: {
  nodo: Nodo;
  nivel: number;
  color: string;
  contraidos: Set<string>;
  ramificando: Set<string>;
  onToggle: (id: string) => void;
  onTexto: (id: string, texto: string) => void;
  onAgregar: (id: string) => void;
  onQuitar: (id: string) => void;
  onRamificar: (n: Nodo) => void;
}) {
  const [editando, setEditando] = useState(false);
  const contraido = contraidos.has(nodo.id);
  const ocupado = ramificando.has(nodo.id);
  const raiz = nivel === 0;
  const caja = raiz
    ? "border-2 px-3 py-2 text-sm font-semibold w-[15rem]"
    : nivel === 1
      ? "border-2 px-2.5 py-1.5 text-xs font-semibold w-[14rem]"
      : nivel === 2
        ? "border px-2 py-1 text-xs font-medium w-[12rem]"
        : "border border-dashed px-2 py-1 text-[11px] max-w-[22rem]";

  return (
    <div className="flex items-center">
      <div className="group flex shrink-0 items-center gap-0.5">
        <div
          className={`rounded-lg bg-surface-panel text-ink ${caja}`}
          style={{ borderColor: color, ...(nivel === 1 ? { background: `${color}1a` } : {}) }}
        >
          {editando ? (
            <textarea
              autoFocus
              defaultValue={nodo.texto}
              rows={2}
              onBlur={(e) => {
                const t = e.target.value.trim();
                if (t && t !== nodo.texto) onTexto(nodo.id, t);
                setEditando(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) (e.target as HTMLTextAreaElement).blur();
                if (e.key === "Escape") setEditando(false);
              }}
              className="w-56 resize-y rounded border border-border bg-surface-input px-1 text-xs text-ink"
            />
          ) : (
            <button
              type="button"
              title={raiz ? "La raíz es la idea: se cambia arriba" : "Clic para editar"}
              onClick={() => !raiz && setEditando(true)}
              className="whitespace-pre-wrap text-left"
            >
              {nodo.texto}
            </button>
          )}
        </div>
        <div className="flex flex-col opacity-30 transition-opacity group-hover:opacity-100">
          <div className="flex">
            {nodo.hijos.length > 0 && (
              <button type="button" className={MINI} title={contraido ? "Mostrar ramas" : "Contraer"} onClick={() => onToggle(nodo.id)}>
                {contraido ? `▸${nodo.hijos.length}` : "◂"}
              </button>
            )}
            <button type="button" className={MINI} title="Ramificar con IA" disabled={ocupado} onClick={() => onRamificar(nodo)}>
              {ocupado ? "…" : "✨"}
            </button>
          </div>
          <div className="flex">
            <button type="button" className={MINI} title="Agregar rama a mano" onClick={() => onAgregar(nodo.id)}>
              +
            </button>
            {!raiz && (
              <button type="button" className={MINI} title="Quitar esta rama" onClick={() => onQuitar(nodo.id)}>
                ×
              </button>
            )}
          </div>
        </div>
      </div>
      {nodo.hijos.length > 0 && !contraido && (
        <div className="clado-hijos" style={{ color }}>
          {nodo.hijos.map((h, k) => (
            <div key={h.id} className="clado-hijo">
              <RamaClado
                nodo={h}
                nivel={nivel + 1}
                color={raiz ? COLORES[k % COLORES.length] : color}
                contraidos={contraidos}
                ramificando={ramificando}
                onToggle={onToggle}
                onTexto={onTexto}
                onAgregar={onAgregar}
                onQuitar={onQuitar}
                onRamificar={onRamificar}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
