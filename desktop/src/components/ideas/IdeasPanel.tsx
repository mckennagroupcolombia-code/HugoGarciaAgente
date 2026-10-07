/**
 * Diseño de producto → Desarrollar idea: cada idea de producto se construye
 * como un cladograma, rama por rama. La raíz es la idea; cada proyecto tiene sus
 * propios parámetros (usuario, precio, manufactura, restricciones o los que se
 * agreguen). En cada rama, «＋» abre una bandeja con tres fuentes: la guía del
 * ciclo de diseño (siete etapas y sus sub-ramas, solo como ejemplo), opciones de
 * la IA según los parámetros del proyecto, o una rama escrita a mano. Nada entra
 * al árbol sin elegirlo. API: app/routes_ideas.py (la IA va en segundo plano).
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

interface Parametro {
  nombre: string;
  valor: string;
}

interface Idea {
  id?: string;
  titulo: string;
  /** Notas de la primera versión; ya no se muestra, pero se le sigue dando a la IA. */
  descripcion: string;
  parametros?: Parametro[];
  arbol: Nodo | null;
  actualizado?: string;
  actualizado_por?: string;
}

/** Los parámetros del ejemplo con que arranca cada idea nueva; se cambian, quitan o agregan por proyecto. */
const EJEMPLO_PARAMETRO: Record<string, string> = {
  "Tipo de producto": "Ej.: envase cosmético airless, cepillo eléctrico, dispositivo IoT",
  "Usuario objetivo": "Ej.: adultos jóvenes urbanos, profesionales de la salud",
  "Rango de precio": "Ej.: económico, gama media, premium",
  "Proceso de manufactura": "Ej.: inyección de plástico, termoformado, CNC, impresión 3D",
  "Restricciones clave": "Ej.: biodegradable, costo < 5 USD, IP67",
};

const VACIA: Idea = {
  titulo: "",
  descripcion: "",
  parametros: Object.keys(EJEMPLO_PARAMETRO).map((nombre) => ({ nombre, valor: "" })),
  arbol: null,
};

/** Guía del ciclo de diseño: ramas que la bandeja ofrece como ejemplo (en la raíz, y en cada etapa sus sub-ramas). */
const GUIA: { rama: string; subs: string[] }[] = [
  { rama: "Usuario (Descubrir)", subs: ["Perfil del usuario", "Contexto de uso diario", "Puntos de dolor", "Ergonomía y antropometría", "UX física: agarre, peso, feedback"] },
  { rama: "Requerimientos (Definir)", subs: ["Requerimientos funcionales", "Vida útil y cargas", "Lenguaje formal y ADN de marca", "CMF: color, material, acabado", "Costo objetivo (COGS)", "Time-to-market"] },
  { rama: "Arquitectura (Idear)", subs: ["Componentes (BOM preliminar)", "Mecanismos internos", "Electrónica / actuadores", "Fijaciones", "Secuencia de ensamble"] },
  { rama: "Ingeniería y DFM (Desarrollar)", subs: ["Materiales", "Espesores de pared", "Ángulos de desmolde", "Nervaduras y torres", "Tolerancias GD&T", "Uniones: snap-fit, ultrasonido, tornillos"] },
  { rama: "Prototipado y pruebas", subs: ["Mock-up", "Prueba de concepto (POC)", "Prototipo alfa (SLA/CNC)", "Prototipo beta (pre-serie)", "Pruebas de caída / estanqueidad / fatiga", "Certificaciones"] },
  { rama: "Sostenibilidad (ciclo de vida)", subs: ["Desensamble", "Reciclabilidad", "Biomateriales", "Empaque y transporte"] },
  { rama: "Riesgos y siguientes pasos", subs: ["FMEA preliminar", "Puntos de falla en fabricación", "Puntos de falla en uso", "Entregables para CAD 3D"] },
];

/** «4 · Ingeniería y DFM (Desarrollar)» (cladogramas de la primera versión) también cuenta como la etapa de la guía. */
function mismaRama(guia: string, texto: string): boolean {
  const limpio = (t: string) => t.replace(/^\s*\d+\s*·\s*/, "").trim().toLowerCase();
  return limpio(guia) === limpio(texto);
}

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
                    {i.arbol && i.arbol.hijos.length ? `${contar(i.arbol) - 1} ramas` : "sin ramas aún"}
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
            Crea una idea y constrúyela como un cladograma, rama por rama: cada proyecto tiene sus propios
            parámetros y sus propias ramas. La guía del ciclo de diseño (usuario, requerimientos, arquitectura,
            ingeniería, prototipado, sostenibilidad, riesgos) sale como sugerencia, y la IA propone opciones según
            los parámetros de cada proyecto.
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
  const [contraidos, setContraidos] = useState<Set<string>>(new Set());
  /** Rama que se está desarrollando: debajo de ella sale la bandeja de opciones. */
  // Una idea sin ramas abre la bandeja de la raíz: es el primer paso.
  const [abierto, setAbierto] = useState<string | null>(idea.arbol && idea.arbol.hijos.length ? null : (idea.arbol?.id ?? "raiz"));
  const [verParametros, setVerParametros] = useState(!idea.id);
  const titulo = idea.titulo.trim();
  const parametros = idea.parametros ?? [];
  // Ideas viejas o recién creadas sin árbol: la raíz es la idea misma.
  const arbol: Nodo | null = idea.arbol ?? (titulo ? { id: "raiz", texto: titulo, hijos: [] } : null);

  function cambiarArbol(fn: (a: Nodo) => Nodo | null) {
    // Sobre el estado vigente, no sobre el de este render: la IA puede responder mientras se edita otra rama.
    onChange((i) => {
      const base = i.arbol ?? { id: "raiz", texto: i.titulo.trim(), hijos: [] };
      return { arbol: fn(base) };
    });
  }

  function agregarRama(padre: string, texto: string) {
    const t = texto.trim();
    if (!t) return;
    setContraidos((s) => {
      const c = new Set(s);
      c.delete(padre);
      return c;
    });
    cambiarArbol((a) => editarNodo(a, padre, (x) => ({ ...x, hijos: [...x.hijos, { id: nuevoId(), texto: t, hijos: [] }] })));
  }

  async function sugerirIA(n: Nodo): Promise<string[]> {
    if (!arbol) return [];
    const r = await pedirIA<{ opciones: string[] }>("/api/ideas/ramificar", {
      titulo,
      parametros,
      descripcion: idea.descripcion,
      ruta: rutaA(arbol, n.id) ?? [n.texto],
      existentes: n.hijos.map((h) => h.texto),
    });
    return r.opciones ?? [];
  }

  function cambiarParametro(k: number, patch: Partial<Parametro>) {
    onChange({ parametros: parametros.map((p, j) => (j === k ? { ...p, ...patch } : p)) });
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
    const cabeza = parametros.filter((p) => p.valor.trim()).map((p) => `> ${p.nombre}: ${p.valor}`);
    try {
      await navigator.clipboard.writeText([comoTexto(arbol), ...(cabeza.length ? ["", ...cabeza] : [])].join("\n"));
      setAviso({ ok: true, texto: "Cladograma copiado como texto." });
    } catch {
      setAviso({ ok: false, texto: "No se pudo copiar al portapapeles." });
    }
  }

  const conValor = parametros.filter((p) => p.valor.trim()).length;

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Idea</span>
        <input
          value={idea.titulo}
          onChange={(e) => {
            const t = e.target.value;
            onChange((i) => ({ titulo: t, arbol: i.arbol ? { ...i.arbol, texto: t } : i.arbol }));
          }}
          placeholder="Ej.: envase airless de 30 mL para sérum"
          className={CAMPO}
        />
      </label>

      {/* ── Parámetros del proyecto ── */}
      <div className="rounded-xl border border-border bg-surface p-3">
        <button
          type="button"
          onClick={() => setVerParametros((v) => !v)}
          className="flex w-full items-center justify-between text-left text-xs font-semibold text-ink"
        >
          <span>
            Parámetros del proyecto{" "}
            <span className="font-normal text-muted">
              ({conValor} de {parametros.length} con dato) · la IA los usa al sugerir ramas
            </span>
          </span>
          <span className="text-muted">{verParametros ? "▾" : "▸"}</span>
        </button>
        {verParametros && (
          <div className="mt-2 flex flex-col gap-1.5">
            {parametros.map((p, k) => (
              <div key={k} className="grid grid-cols-[11rem_1fr_auto] items-center gap-1.5">
                <input
                  value={p.nombre}
                  onChange={(e) => cambiarParametro(k, { nombre: e.target.value })}
                  placeholder="Parámetro"
                  className={`${CAMPO} font-medium`}
                />
                <input
                  value={p.valor}
                  onChange={(e) => cambiarParametro(k, { valor: e.target.value })}
                  placeholder={EJEMPLO_PARAMETRO[p.nombre] ?? "Valor para este proyecto"}
                  className={CAMPO}
                />
                <button
                  type="button"
                  className={MINI}
                  title="Quitar este parámetro"
                  onClick={() => onChange({ parametros: parametros.filter((_, j) => j !== k) })}
                >
                  ×
                </button>
              </div>
            ))}
            <div>
              <button
                type="button"
                className={BOTON_SUAVE}
                onClick={() => onChange({ parametros: [...parametros, { nombre: "", valor: "" }] })}
              >
                + Parámetro propio
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {arbol && arbol.hijos.length > 0 && (
          <>
            <button type="button" className={BOTON_SUAVE} onClick={() => setContraidos(new Set())}>
              Expandir todo
            </button>
            <button type="button" className={BOTON_SUAVE} onClick={() => setContraidos(new Set(todosLosIds))}>
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
        <div className={`overflow-auto rounded-xl border border-border bg-surface p-4 ${abierto ? "pb-80" : ""}`}>
          <p className="mb-3 text-[11px] text-muted">
            Pulsa <b>＋</b> en una rama para desarrollarla: elige de la guía, pide opciones a la IA o escribe la tuya.
            Clic en el texto para editarlo.
          </p>
          <RamaClado
            nodo={arbol}
            nivel={0}
            color="rgb(var(--mck-border-strong))"
            contraidos={contraidos}
            abierto={abierto}
            onAbrir={(id) => setAbierto((a) => (a === id ? null : id))}
            onToggle={(id) =>
              setContraidos((s) => {
                const c = new Set(s);
                if (c.has(id)) c.delete(id);
                else c.add(id);
                return c;
              })
            }
            onTexto={(id, texto) => cambiarArbol((a) => editarNodo(a, id, (x) => ({ ...x, texto })))}
            onAgregar={agregarRama}
            onQuitar={(id) => cambiarArbol((a) => editarNodo(a, id, () => null))}
            onSugerirIA={sugerirIA}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">
          Escribe la idea arriba: será la raíz del cladograma. Luego llena los parámetros de este proyecto y
          desarrolla rama por rama.
        </div>
      )}
    </div>
  );
}

/** Bandeja bajo una rama: opciones de la guía, opciones de la IA y una rama escrita a mano. */
function BandejaRama({
  nodo,
  nivel,
  onAgregar,
  onSugerirIA,
  onCerrar,
}: {
  nodo: Nodo;
  nivel: number;
  onAgregar: (padre: string, texto: string) => void;
  onSugerirIA: (n: Nodo) => Promise<string[]>;
  onCerrar: () => void;
}) {
  const [propia, setPropia] = useState("");
  const [ia, setIa] = useState<string[]>([]);
  const [pidiendo, setPidiendo] = useState(false);
  const [error, setError] = useState("");
  const ya = new Set(nodo.hijos.map((h) => h.texto.trim().toLowerCase()));
  const guia = (nivel === 0 ? GUIA.map((g) => g.rama) : (GUIA.find((g) => mismaRama(g.rama, nodo.texto))?.subs ?? [])).filter(
    (t) => !ya.has(t.toLowerCase()),
  );
  const iaLibres = ia.filter((t) => !ya.has(t.trim().toLowerCase()));

  async function pedir() {
    setPidiendo(true);
    setError("");
    try {
      setIa(await onSugerirIA(nodo));
    } catch (e) {
      setError((e as Error).message || "La IA no respondió.");
    } finally {
      setPidiendo(false);
    }
  }

  const chip =
    "rounded-full border border-border bg-surface-panel px-2.5 py-1 text-left text-[11px] text-ink hover:border-accent hover:bg-accent/10";

  return (
    <div className="mt-1.5 flex w-[22rem] flex-col gap-2 rounded-lg border border-accent/40 bg-surface-panel p-2.5 shadow-sm">
      {guia.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">De la guía (ejemplo)</span>
          <div className="flex flex-wrap gap-1">
            {guia.map((t) => (
              <button key={t} type="button" className={chip} onClick={() => onAgregar(nodo.id, t)}>
                + {t}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Según los parámetros del proyecto</span>
        {iaLibres.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {iaLibres.map((t) => (
              <button key={t} type="button" className={chip} onClick={() => onAgregar(nodo.id, t)}>
                + {t}
              </button>
            ))}
          </div>
        )}
        <div>
          <button type="button" className={BOTON_SUAVE} disabled={pidiendo} onClick={pedir}>
            {pidiendo ? "Pensando… (≈30 s)" : iaLibres.length ? "✨ Otras opciones" : "✨ Sugerir con IA"}
          </button>
        </div>
        {error && <span className="text-[11px] text-red-600">{error}</span>}
      </div>
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          onAgregar(nodo.id, propia);
          setPropia("");
        }}
      >
        <span className="flex-1">
          <input
            value={propia}
            onChange={(e) => setPropia(e.target.value)}
            placeholder="Escribe una rama propia y Enter"
            className="mck-field-lg w-full rounded border border-border bg-surface-input px-2 py-1 text-xs text-ink"
          />
        </span>
        <button type="button" className={MINI} onClick={onCerrar}>
          Listo
        </button>
      </form>
    </div>
  );
}

function RamaClado({
  nodo,
  nivel,
  color,
  contraidos,
  abierto,
  onAbrir,
  onToggle,
  onTexto,
  onAgregar,
  onQuitar,
  onSugerirIA,
}: {
  nodo: Nodo;
  nivel: number;
  color: string;
  contraidos: Set<string>;
  abierto: string | null;
  onAbrir: (id: string) => void;
  onToggle: (id: string) => void;
  onTexto: (id: string, texto: string) => void;
  onAgregar: (padre: string, texto: string) => void;
  onQuitar: (id: string) => void;
  onSugerirIA: (n: Nodo) => Promise<string[]>;
}) {
  const [editando, setEditando] = useState(false);
  const contraido = contraidos.has(nodo.id);
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
      <div className="flex shrink-0 flex-col">
        <div className="group flex items-center gap-0.5">
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
          <div className="flex flex-col">
            <button
              type="button"
              className={`rounded px-1 text-sm font-bold leading-5 text-accent hover:bg-accent/15 ${abierto === nodo.id ? "bg-accent/15" : ""}`}
              title="Desarrollar esta rama"
              onClick={() => onAbrir(nodo.id)}
            >
              ＋
            </button>
            <div className="flex opacity-30 transition-opacity group-hover:opacity-100">
              {nodo.hijos.length > 0 && (
                <button type="button" className={MINI} title={contraido ? "Mostrar ramas" : "Contraer"} onClick={() => onToggle(nodo.id)}>
                  {contraido ? `▸${nodo.hijos.length}` : "◂"}
                </button>
              )}
              {!raiz && (
                <button type="button" className={MINI} title="Quitar esta rama (y lo que cuelga de ella)" onClick={() => onQuitar(nodo.id)}>
                  ×
                </button>
              )}
            </div>
          </div>
        </div>
        {abierto === nodo.id && (
          // Flota bajo la rama (alto 0): si ocupara lugar, las líneas hacia los hijos se correrían.
          <div className="relative h-0">
            <div className="absolute left-0 top-0 z-20">
              <BandejaRama nodo={nodo} nivel={nivel} onAgregar={onAgregar} onSugerirIA={onSugerirIA} onCerrar={() => onAbrir(nodo.id)} />
            </div>
          </div>
        )}
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
                abierto={abierto}
                onAbrir={onAbrir}
                onToggle={onToggle}
                onTexto={onTexto}
                onAgregar={onAgregar}
                onQuitar={onQuitar}
                onSugerirIA={onSugerirIA}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
