/**
 * Diseño de producto → Fórmulas: la receta de elaboración de cada producto
 * propio (crema, bálsamo, jabón…). Ingredientes en porcentaje —materias primas
 * del catálogo de Alegra o texto libre—, fase y función; los gramos se calculan
 * para el tamaño de lote que se escriba. Se guarda la fórmula en %, que no
 * cambia con el lote (API: app/routes_formulas.py).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

interface Ingrediente {
  codigo: string;
  nombre: string;
  fase: string;
  porcentaje: number;
  funcion: string;
}

interface Formula {
  id?: string;
  nombre: string;
  categoria: string;
  descripcion: string;
  ingredientes: Ingrediente[];
  lote_g: number;
  procedimiento: string;
  notas: string;
  actualizado?: string;
  actualizado_por?: string;
}

const VACIA: Formula = {
  nombre: "",
  categoria: "",
  descripcion: "",
  ingredientes: [],
  lote_g: 1000,
  procedimiento: "",
  notas: "",
};

const FILA_VACIA: Ingrediente = { codigo: "", nombre: "", fase: "", porcentaje: 0, funcion: "" };

const CAMPO = "mck-field-lg w-full rounded-lg border border-border bg-surface-input px-2.5 py-1.5 text-sm text-ink";
const CAMPO_TABLA = "mck-field-lg w-full rounded border border-border bg-surface-input px-1.5 py-1 text-xs text-ink";
const BOTON = "rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-40";
const BOTON_SUAVE =
  "rounded border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-40";

/** Números a la colombiana: coma decimal, sin ceros de sobra. */
function num(n: number, dec = 2): string {
  return n.toLocaleString("es-CO", { maximumFractionDigits: dec });
}

export default function FormulasPanel() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["formulas"],
    queryFn: () => api.get<{ formulas: Formula[] }>("/api/formulas"),
  });
  const formulas = data?.formulas ?? [];
  const [buscar, setBuscar] = useState("");
  const [editando, setEditando] = useState<Formula | null>(null);
  const [cambios, setCambios] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    if (!q) return formulas;
    return formulas.filter((f) =>
      [f.nombre, f.categoria, ...f.ingredientes.map((i) => i.nombre)].some((t) => (t || "").toLowerCase().includes(q)),
    );
  }, [formulas, buscar]);

  const guardar = useMutation({
    mutationFn: (f: Formula) => api.post<{ formula: Formula }>("/api/formulas", f),
    onSuccess: (r) => {
      setEditando(r.formula);
      setCambios(false);
      setAviso({ ok: true, texto: "Fórmula guardada." });
      void qc.invalidateQueries({ queryKey: ["formulas"] });
    },
    onError: (e: Error) => setAviso({ ok: false, texto: e.message || "No se pudo guardar." }),
  });

  const eliminar = useMutation({
    mutationFn: (id: string) => api.delete<{ ok: boolean }>(`/api/formulas/${encodeURIComponent(id)}`),
    onSuccess: () => {
      setEditando(null);
      setCambios(false);
      setConfirmarBorrado(false);
      setAviso({ ok: true, texto: "Fórmula eliminada." });
      void qc.invalidateQueries({ queryKey: ["formulas"] });
    },
    onError: (e: Error) => setAviso({ ok: false, texto: e.message || "No se pudo eliminar." }),
  });

  function abrir(f: Formula | null) {
    if (cambios && !window.confirm("Hay cambios sin guardar en esta fórmula. ¿Descartarlos?")) return;
    setEditando(f ? structuredClone(f) : { ...VACIA, ingredientes: [{ ...FILA_VACIA }] });
    setCambios(false);
    setAviso(null);
    setConfirmarBorrado(false);
  }

  function cambiar(patch: Partial<Formula>) {
    setEditando((f) => (f ? { ...f, ...patch } : f));
    setCambios(true);
    setAviso(null);
  }

  return (
    <div className="flex min-h-0 flex-col gap-4 p-3 md:flex-row md:p-4">
      {/* ── Lista ── */}
      <aside className="flex w-full shrink-0 flex-col gap-2 md:w-72">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">Fórmulas</h2>
          <button type="button" className={BOTON} onClick={() => abrir(null)}>
            + Nueva fórmula
          </button>
        </div>
        <input
          type="search"
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          placeholder="Buscar por nombre o ingrediente…"
          className={CAMPO}
        />
        {isLoading && <p className="text-xs text-muted">Cargando…</p>}
        {error && <p className="text-xs text-red-600">{(error as Error).message}</p>}
        {!isLoading && !error && formulas.length === 0 && (
          <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted">
            Aún no hay fórmulas. Crea la primera con «+ Nueva fórmula».
          </p>
        )}
        <ul className="flex flex-col gap-1.5">
          {visibles.map((f) => {
            const activa = editando?.id === f.id;
            return (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => abrir(f)}
                  className={`w-full rounded-lg border px-3 py-2 text-left ${
                    activa ? "border-accent bg-accent/10" : "border-border bg-surface hover:border-accent/50"
                  }`}
                >
                  <span className="block truncate text-sm font-medium text-ink">{f.nombre}</span>
                  <span className="block truncate text-[11px] text-muted">
                    {[f.categoria, `${f.ingredientes.length} ingredientes`].filter(Boolean).join(" · ")}
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
          <EditorFormula
            formula={editando}
            onChange={cambiar}
            guardando={guardar.isPending}
            onGuardar={() => editando && guardar.mutate(editando)}
            aviso={aviso}
            cambios={cambios}
            confirmarBorrado={confirmarBorrado}
            setConfirmarBorrado={setConfirmarBorrado}
            eliminando={eliminar.isPending}
            onEliminar={() => editando?.id && eliminar.mutate(editando.id)}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">
            Elige una fórmula de la lista o crea una nueva. Cada fórmula guarda sus ingredientes en porcentaje, la
            fase y función de cada uno, el procedimiento y las notas; los gramos se calculan para el lote que escribas.
            {aviso && <p className={`mt-2 text-xs ${aviso.ok ? "text-green-700" : "text-red-600"}`}>{aviso.texto}</p>}
          </div>
        )}
      </section>
    </div>
  );
}

function EditorFormula({
  formula,
  onChange,
  guardando,
  onGuardar,
  aviso,
  cambios,
  confirmarBorrado,
  setConfirmarBorrado,
  eliminando,
  onEliminar,
}: {
  formula: Formula;
  onChange: (patch: Partial<Formula>) => void;
  guardando: boolean;
  onGuardar: () => void;
  aviso: { ok: boolean; texto: string } | null;
  cambios: boolean;
  confirmarBorrado: boolean;
  setConfirmarBorrado: (v: boolean) => void;
  eliminando: boolean;
  onEliminar: () => void;
}) {
  const ingredientes = formula.ingredientes;
  const total = ingredientes.reduce((s, i) => s + (Number(i.porcentaje) || 0), 0);
  const cuadra = Math.abs(total - 100) < 0.005;
  const lote = Number(formula.lote_g) || 0;

  function cambiarFila(idx: number, patch: Partial<Ingrediente>) {
    onChange({ ingredientes: ingredientes.map((i, k) => (k === idx ? { ...i, ...patch } : i)) });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Nombre de la fórmula
          <input
            value={formula.nombre}
            onChange={(e) => onChange({ nombre: e.target.value })}
            placeholder="p. ej. Crema corporal de karité"
            className={CAMPO}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Categoría
          <input
            value={formula.categoria}
            onChange={(e) => onChange({ categoria: e.target.value })}
            placeholder="p. ej. Cremas"
            className={CAMPO}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Descripción
        <textarea
          rows={2}
          value={formula.descripcion}
          onChange={(e) => onChange({ descripcion: e.target.value })}
          placeholder="Para qué es, textura, tipo de envase…"
          className={`${CAMPO} resize-y`}
        />
      </label>

      {/* Ingredientes */}
      <div className="rounded-xl border border-border bg-surface p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">Ingredientes</h3>
          <label className="flex items-center gap-2 text-xs text-muted">
            Lote de
            <span>
              <input
                type="number"
                min={0}
                step="any"
                value={formula.lote_g || ""}
                onChange={(e) => onChange({ lote_g: Number(e.target.value) || 0 })}
                className="mck-field-lg w-24 rounded border border-border bg-surface-input px-1.5 py-1 text-right text-xs text-ink"
              />
            </span>
            g
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-xs">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="w-14 px-1 py-1 font-medium">Fase</th>
                <th className="px-1 py-1 font-medium">Ingrediente</th>
                <th className="w-40 px-1 py-1 font-medium">Función</th>
                <th className="w-20 px-1 py-1 text-right font-medium">%</th>
                <th className="w-24 px-1 py-1 text-right font-medium">Gramos</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {ingredientes.map((ing, idx) => (
                <tr key={idx} className="border-t border-border/60 align-top">
                  <td className="px-1 py-1">
                    <input
                      value={ing.fase}
                      onChange={(e) => cambiarFila(idx, { fase: e.target.value })}
                      placeholder="A"
                      className={CAMPO_TABLA}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <BuscadorIngrediente
                      valor={ing}
                      onElegir={(codigo, nombre) => cambiarFila(idx, { codigo, nombre })}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      value={ing.funcion}
                      onChange={(e) => cambiarFila(idx, { funcion: e.target.value })}
                      placeholder="Emoliente, conservante…"
                      className={CAMPO_TABLA}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={ing.porcentaje || ""}
                      onChange={(e) => cambiarFila(idx, { porcentaje: Number(e.target.value) || 0 })}
                      className={`${CAMPO_TABLA} text-right`}
                    />
                  </td>
                  <td className="px-1 py-1.5 text-right tabular-nums text-ink">
                    {num((lote * (Number(ing.porcentaje) || 0)) / 100)}
                  </td>
                  <td className="px-1 py-1 text-center">
                    <button
                      type="button"
                      title="Quitar ingrediente"
                      onClick={() => onChange({ ingredientes: ingredientes.filter((_, k) => k !== idx) })}
                      className="text-muted hover:text-red-600"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td colSpan={3} className="px-1 py-1.5">
                  <button
                    type="button"
                    className={BOTON_SUAVE}
                    onClick={() => onChange({ ingredientes: [...ingredientes, { ...FILA_VACIA }] })}
                  >
                    + Agregar ingrediente
                  </button>
                </td>
                <td className={`px-1 py-1.5 text-right tabular-nums ${cuadra ? "text-green-700" : "text-amber-600"}`}>
                  {num(total)} %
                </td>
                <td className="px-1 py-1.5 text-right tabular-nums text-ink">{num((lote * total) / 100)} g</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        {!cuadra && ingredientes.length > 0 && (
          <p className="mt-1 text-[11px] text-amber-600">
            Los porcentajes suman {num(total)} %: {total < 100 ? `faltan ${num(100 - total)}` : `sobran ${num(total - 100)}`} %
            para llegar a 100 %.
          </p>
        )}
      </div>

      <label className="flex flex-col gap-1 text-xs text-muted">
        Procedimiento
        <textarea
          rows={6}
          value={formula.procedimiento}
          onChange={(e) => onChange({ procedimiento: e.target.value })}
          placeholder={"1. Calentar la fase A a 75 °C…\n2. …"}
          className={`${CAMPO} resize-y`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Notas
        <textarea
          rows={3}
          value={formula.notas}
          onChange={(e) => onChange({ notas: e.target.value })}
          placeholder="pH final, viscosidad, pruebas de estabilidad, proveedores…"
          className={`${CAMPO} resize-y`}
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={BOTON}
          disabled={guardando || !formula.nombre.trim()}
          onClick={onGuardar}
        >
          {guardando ? "Guardando…" : "Guardar fórmula"}
        </button>
        {formula.id &&
          (confirmarBorrado ? (
            <span className="flex items-center gap-2 text-xs text-ink">
              ¿Eliminar «{formula.nombre}»?
              <button
                type="button"
                className="rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                disabled={eliminando}
                onClick={onEliminar}
              >
                Sí, eliminar
              </button>
              <button type="button" className="text-muted underline" onClick={() => setConfirmarBorrado(false)}>
                No
              </button>
            </span>
          ) : (
            <button type="button" className="text-xs text-muted underline hover:text-red-600" onClick={() => setConfirmarBorrado(true)}>
              Eliminar
            </button>
          ))}
        {cambios && !guardando && <span className="text-[11px] text-amber-600">Cambios sin guardar</span>}
        {aviso && <span className={`text-xs ${aviso.ok ? "text-green-700" : "text-red-600"}`}>{aviso.texto}</span>}
        {!cambios && formula.actualizado && (
          <span className="text-[11px] text-muted">
            Última edición {formula.actualizado.replace("T", " ").slice(0, 16)}
            {formula.actualizado_por ? ` · ${formula.actualizado_por}` : ""}
          </span>
        )}
      </div>
    </div>
  );
}

/** Ingrediente: se escribe libre o se elige una materia prima del catálogo de
 *  Alegra (sin combos). Elegida, guarda su código; si se reescribe, vuelve a texto libre. */
function BuscadorIngrediente({
  valor,
  onElegir,
}: {
  valor: Ingrediente;
  onElegir: (codigo: string, nombre: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(valor.nombre.trim()), 250);
    return () => clearTimeout(t);
  }, [valor.nombre]);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  const { data } = useQuery({
    queryKey: ["formulas-materias", q],
    queryFn: () => api.get<{ items: { codigo: string; nombre: string }[] }>(`/api/formulas/materias?q=${encodeURIComponent(q)}`),
    enabled: abierto && q.length >= 2 && !valor.codigo,
    staleTime: 60_000,
  });
  const items = data?.items ?? [];

  return (
    <div ref={caja} className="relative">
      <input
        value={valor.nombre}
        onChange={(e) => {
          onElegir("", e.target.value);
          setAbierto(true);
        }}
        onFocus={() => setAbierto(true)}
        placeholder="Buscar materia prima o escribir…"
        className={CAMPO_TABLA}
      />
      {valor.codigo && <span className="mt-0.5 block text-[10px] text-muted">Alegra · {valor.codigo}</span>}
      {abierto && !valor.codigo && items.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
          {items.map((it) => (
            <li key={it.codigo}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onElegir(it.codigo, it.nombre);
                  setAbierto(false);
                }}
                className="w-full px-2.5 py-1.5 text-left text-xs text-ink hover:bg-accent/10"
              >
                {it.nombre}
                <span className="ml-1 text-[10px] text-muted">{it.codigo}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
