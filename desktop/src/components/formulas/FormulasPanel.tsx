/**
 * Diseño de producto → Fórmulas: la receta de elaboración de cada producto
 * propio (crema, bálsamo, jabón…). Ingredientes en porcentaje —materias primas
 * del catálogo de Alegra o texto libre—; la pantalla pide solo nombre,
 * ingredientes y porcentajes (fase, función, categoría y notas viejas se
 * conservan al guardar, pero ya no se muestran). Los gramos se calculan
 * para la cantidad que se escriba. Se guarda la fórmula en %, que no
 * cambia con el lote (API: app/routes_formulas.py).
 * Cada fórmula se asocia a su SKU de Alegra (el combo C-FOR-…mL que la representa).
 * «Leer de pantallazo» llena los ingredientes desde una captura: la IA
 * transcribe y el servidor calcula los porcentajes (formulas_captura.py).
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

/** La cantidad a preparar va en gramos o en mililitros; el listado sale en la misma unidad. */
type Unidad = "g" | "mL";

interface Formula {
  id?: string;
  nombre: string;
  categoria: string;
  descripcion: string;
  ingredientes: Ingrediente[];
  /** Combo de Alegra que representa la fórmula ("" = sin asociar). */
  sku_alegra?: string;
  /** Nombre de ese combo en Alegra (solo lectura, lo agrega el servidor). */
  sku_alegra_nombre?: string;
  /** Cantidad a preparar, en la unidad de `unidad` (el nombre del campo es histórico). */
  lote_g: number;
  unidad?: Unidad;
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
  lote_g: 0,
  unidad: "g",
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
      [f.nombre, f.categoria, f.sku_alegra, ...f.ingredientes.map((i) => i.nombre)].some((t) => (t || "").toLowerCase().includes(q)),
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
                    {f.sku_alegra ? (
                      <span className="font-medium text-accent">{f.sku_alegra}</span>
                    ) : (
                      <span className="text-amber-600">Sin SKU de Alegra</span>
                    )}
                    {" · "}
                    {f.ingredientes.length} ingredientes
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
            key={editando.id ?? "nueva"}
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
            Elige una fórmula de la lista o crea una nueva: primero ingresas los ingredientes con su porcentaje,
            luego la cantidad que vas a preparar, y las cantidades de cada ingrediente se calculan al instante.
            {aviso && <p className={`mt-2 text-xs ${aviso.ok ? "text-green-700" : "text-red-600"}`}>{aviso.texto}</p>}
          </div>
        )}
      </section>
    </div>
  );
}

/** Un color por ingrediente: el mismo en la barra de composición, la tabla y el listado. */
const COLORES = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#0ea5e9", "#a855f7", "#84cc16", "#ec4899", "#14b8a6", "#f97316"];
const color = (k: number) => COLORES[k % COLORES.length];

/** Cantidades frecuentes para la calculadora, en la unidad elegida. */
const RAPIDAS = [100, 250, 500, 1000];

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
  const conNombre = ingredientes.filter((i) => i.nombre.trim());
  const total = ingredientes.reduce((s, i) => s + (Number(i.porcentaje) || 0), 0);
  const cuadra = Math.abs(total - 100) < 0.005;
  const cantidad = Number(formula.lote_g) || 0;
  const unidad: Unidad = formula.unidad === "mL" ? "mL" : "g";
  const listo = conNombre.length > 0 && cuadra && cantidad > 0;
  /** Fila recién agregada: su buscador toma el foco al aparecer. */
  const [nueva, setNueva] = useState<number | null>(null);
  /** Fila resaltada al pasar el mouse por la barra o por la tabla. */
  const [resaltada, setResaltada] = useState<number | null>(null);
  const [captura, setCaptura] = useState(false);

  /** Lo leído del pantallazo reemplaza los ingredientes; si la captura traía cantidades, la calculadora queda en ese total. */
  function usarCaptura(r: LecturaCaptura) {
    const patch: Partial<Formula> = {
      ingredientes: r.ingredientes.map((i) => ({ ...FILA_VACIA, nombre: i.nombre, porcentaje: i.porcentaje })),
    };
    if (!formula.nombre.trim() && r.nombre) patch.nombre = r.nombre;
    if (r.total > 0) {
      patch.lote_g = Math.round(r.total * 100) / 100;
      patch.unidad = r.unidad;
    }
    setNueva(null);
    onChange(patch);
  }

  function cambiarFila(idx: number, patch: Partial<Ingrediente>) {
    onChange({ ingredientes: ingredientes.map((i, k) => (k === idx ? { ...i, ...patch } : i)) });
  }

  function agregarFila() {
    setNueva(ingredientes.length);
    onChange({ ingredientes: [...ingredientes, { ...FILA_VACIA }] });
  }

  /** Lo que falta (o sobra) para 100 % se le suma a la fila indicada. */
  function completar(idx: number) {
    const actual = Number(ingredientes[idx]?.porcentaje) || 0;
    const nuevo = Math.max(0, Math.round((actual + 100 - total) * 10000) / 10000);
    cambiarFila(idx, { porcentaje: nuevo });
  }
  /** Se completa con el último ingrediente que tenga nombre (suele ser el agua o la base). */
  const ultimaConNombre = ingredientes.reduce((u, i, k) => (i.nombre.trim() ? k : u), -1);
  const filaCompletar = ultimaConNombre >= 0 ? ultimaConNombre : ingredientes.length - 1;

  const filas = ingredientes
    .map((i, k) => ({ ...i, k, gramos: (cantidad * (Number(i.porcentaje) || 0)) / 100 }))
    .filter((i) => i.nombre.trim());

  function imprimir() {
    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) return;
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    const cuerpo = filas
      .map(
        (f, k) =>
          `<tr><td>${k + 1}</td><td>${esc(f.nombre)}</td>` +
          `<td class="n">${num(f.porcentaje, 4)} %</td><td class="n"><b>${num(f.gramos)} ${unidad}</b></td><td class="c">☐</td></tr>`,
      )
      .join("");
    w.document.write(
      `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(formula.nombre || "Fórmula")}</title>` +
        `<style>body{font-family:system-ui,sans-serif;margin:24px;color:#111}h1{font-size:20px;margin:0}p{margin:4px 0 16px;color:#444}` +
        `table{width:100%;border-collapse:collapse;font-size:14px}th,td{border-bottom:1px solid #ccc;padding:6px 8px;text-align:left}` +
        `.n{text-align:right;font-variant-numeric:tabular-nums}.c{text-align:center}tfoot td{font-weight:700;border-top:2px solid #111}</style></head><body>` +
        `<h1>${esc(formula.nombre || "Fórmula")}</h1>` +
        `<p>Cantidad a preparar: <b>${num(cantidad)} ${unidad}</b> · ${new Date().toLocaleDateString("es-CO")}</p>` +
        `<table><thead><tr><th>#</th><th>Ingrediente</th><th class="n">%</th><th class="n">Cantidad</th><th class="c">Pesado</th></tr></thead>` +
        `<tbody>${cuerpo}</tbody><tfoot><tr><td></td><td>Total</td><td class="n">${num(total)} %</td>` +
        `<td class="n">${num(cantidad)} ${unidad}</td><td></td></tr></tfoot></table></body></html>`,
    );
    w.document.close();
    w.focus();
    w.print();
  }

  const numeroPaso = (n: number, hecho: boolean) => (
    <span
      className={`mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] text-white transition-colors ${
        hecho ? "bg-green-600" : "bg-accent"
      }`}
    >
      {hecho ? "✓" : n}
    </span>
  );

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-xs text-muted">
        Nombre de la fórmula
        <input
          value={formula.nombre}
          onChange={(e) => onChange({ nombre: e.target.value })}
          placeholder="p. ej. Crema corporal de karité"
          className={CAMPO}
        />
      </label>

      <SkuAlegra
        sku={formula.sku_alegra || ""}
        nombre={formula.sku_alegra_nombre || ""}
        onElegir={(sku_alegra, sku_alegra_nombre) => onChange({ sku_alegra, sku_alegra_nombre })}
      />

      {/* ── Paso 1: ingredientes y porcentajes ── */}
      <div className="rounded-xl border border-border bg-surface p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">
            {numeroPaso(1, conNombre.length > 0 && cuadra)}
            Ingredientes y porcentajes
          </h3>
          <button
            type="button"
            className={`${BOTON_SUAVE} ml-auto`}
            onClick={() => setCaptura((v) => !v)}
            title="Sube o pega (Ctrl+V) el pantallazo de una fórmula y se calculan los porcentajes"
          >
            {captura ? "Cerrar pantallazo" : "📷 Leer de pantallazo"}
          </button>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums transition-colors ${
              cuadra ? "bg-green-600/15 text-green-700" : total > 100 ? "bg-red-600/15 text-red-600" : "bg-amber-500/15 text-amber-600"
            }`}
          >
            {num(total)} % {cuadra ? "✓" : ""}
          </span>
        </div>

        {captura && (
          <LeerCaptura
            hayIngredientes={conNombre.length > 0}
            onUsar={(r) => {
              usarCaptura(r);
              setCaptura(false);
            }}
          />
        )}

        {/* Barra de composición: cada ingrediente ocupa su porcentaje. */}
        <div className="mb-3 flex h-3 w-full overflow-hidden rounded-full bg-border/50" title="Composición de la fórmula">
          {ingredientes.map((ing, k) => {
            const p = Number(ing.porcentaje) || 0;
            if (p <= 0) return null;
            return (
              <div
                key={k}
                onMouseEnter={() => setResaltada(k)}
                onMouseLeave={() => setResaltada(null)}
                title={`${ing.nombre || "Sin nombre"} · ${num(p, 4)} %`}
                className="h-full transition-all duration-300"
                style={{
                  width: `${(p / Math.max(100, total)) * 100}%`,
                  background: color(k),
                  opacity: resaltada === null || resaltada === k ? 1 : 0.35,
                }}
              />
            );
          })}
        </div>

        {/* Sin overflow aquí: recortaba la lista de materias primas de la última fila. */}
        <div>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="w-4" />
                <th className="px-1 py-1 font-medium">Ingrediente</th>
                <th className="w-24 px-1 py-1 text-right font-medium">%</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {ingredientes.map((ing, idx) => (
                <tr
                  key={idx}
                  onMouseEnter={() => setResaltada(idx)}
                  onMouseLeave={() => setResaltada(null)}
                  className={`border-t border-border/60 align-top transition-colors ${resaltada === idx ? "bg-accent/5" : ""}`}
                >
                  <td className="py-2 pl-1">
                    <span className="block h-2.5 w-2.5 rounded-full" style={{ background: color(idx) }} />
                  </td>
                  <td className="px-1 py-1">
                    <BuscadorIngrediente
                      valor={ing}
                      autoFocus={idx === nueva}
                      onElegir={(codigo, nombre) => cambiarFila(idx, { codigo, nombre })}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={ing.porcentaje || ""}
                      onChange={(e) => cambiarFila(idx, { porcentaje: Number(e.target.value) || 0 })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && idx === ingredientes.length - 1) agregarFila();
                      }}
                      placeholder="0"
                      className={`${CAMPO_TABLA} text-right`}
                    />
                  </td>
                  <td className="px-1 py-1 text-center">
                    <button
                      type="button"
                      title="Quitar ingrediente"
                      onClick={() => {
                        setNueva(null);
                        onChange({ ingredientes: ingredientes.filter((_, k) => k !== idx) });
                      }}
                      className="text-muted hover:text-red-600"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className={BOTON_SUAVE} onClick={agregarFila}>
            + Agregar ingrediente
          </button>
          {!cuadra && ingredientes.length > 0 && filaCompletar >= 0 && (
            <>
              <span className={`text-[11px] ${total > 100 ? "text-red-600" : "text-amber-600"}`}>
                {total < 100 ? `Faltan ${num(100 - total)} %` : `Sobran ${num(total - 100)} %`}
              </span>
              {(Number(ingredientes[filaCompletar]?.porcentaje) || 0) + 100 - total >= 0 && (
                <button
                  type="button"
                  className={BOTON_SUAVE}
                  onClick={() => completar(filaCompletar)}
                  title="Ajusta el porcentaje de ese ingrediente para que el total sea 100 %"
                >
                  Completar a 100 % con «{ingredientes[filaCompletar]?.nombre.trim() || "la última fila"}»
                </button>
              )}
            </>
          )}
        </div>
        <p className="mt-1.5 text-[10px] text-muted">Enter en el % de la última fila agrega otro ingrediente.</p>
      </div>

      {/* ── Paso 2: calculadora de cantidades ── */}
      <div className="rounded-xl border border-border bg-surface p-3">
        <h3 className="mb-2 text-sm font-semibold text-ink">
          {numeroPaso(2, listo)}
          Calculadora de cantidades
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={0}
            step="any"
            value={cantidad || ""}
            onChange={(e) => onChange({ lote_g: Number(e.target.value) || 0 })}
            placeholder="0"
            className="mck-field-lg w-32 rounded-lg border border-border bg-surface-input px-2.5 py-1.5 text-right text-sm text-ink"
          />
          <div className="flex overflow-hidden rounded-lg border border-border">
            {(["g", "mL"] as Unidad[]).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => onChange({ unidad: u })}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  unidad === u ? "bg-accent text-white" : "bg-surface-input text-ink hover:bg-accent/10"
                }`}
              >
                {u === "g" ? "gramos" : "mililitros"}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-muted">Rápido:</span>
          {RAPIDAS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onChange({ lote_g: n })}
              className={`rounded-full border px-2.5 py-1 text-xs tabular-nums transition-colors ${
                cantidad === n ? "border-accent bg-accent text-white" : "border-border text-ink hover:border-accent/60"
              }`}
            >
              {num(n)} {unidad}
            </button>
          ))}
        </div>

        {listo ? (
          <div className="mt-3 rounded-lg border border-accent/30 bg-accent/5 p-2.5">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-ink">
                Para {num(cantidad)} {unidad} necesitas:
              </span>
              <button type="button" className={BOTON_SUAVE} onClick={imprimir}>
                Imprimir listado
              </button>
            </div>
            <table className="w-full border-collapse text-sm">
              <tbody>
                {filas.map((f) => (
                  <tr
                    key={f.k}
                    onMouseEnter={() => setResaltada(f.k)}
                    onMouseLeave={() => setResaltada(null)}
                    className={`border-t border-border/60 transition-colors ${resaltada === f.k ? "bg-accent/10" : ""}`}
                  >
                    <td className="w-4 py-1.5 pl-1">
                      <span className="block h-2.5 w-2.5 rounded-full" style={{ background: color(f.k) }} />
                    </td>
                    <td className="px-1 py-1.5 text-ink">{f.nombre}</td>
                    <td className="w-20 px-1 py-1.5 text-right text-xs tabular-nums text-muted">{num(f.porcentaje, 4)} %</td>
                    <td className="w-32 px-1 py-1.5 text-right text-base font-semibold tabular-nums text-ink">
                      {num(f.gramos)} {unidad}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink/40 font-semibold">
                  <td />
                  <td className="px-1 py-1.5 text-ink">Total</td>
                  <td className="px-1 py-1.5 text-right text-xs tabular-nums">{num(total)} %</td>
                  <td className="px-1 py-1.5 text-right tabular-nums text-ink">
                    {num(cantidad)} {unidad}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-muted">
            {conNombre.length === 0
              ? "Primero ingresa los ingredientes con su porcentaje."
              : !cuadra
                ? "Cuando los porcentajes sumen 100 % aquí aparecen las cantidades."
                : "Escribe la cantidad o elige una rápida: las cantidades se calculan al instante."}
          </p>
        )}
      </div>

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

interface LecturaCaptura {
  nombre: string;
  ingredientes: { nombre: string; porcentaje: number; cantidad_captura: string }[];
  /** Suma de las cantidades de la captura (0 si solo traía porcentajes). */
  total: number;
  unidad: Unidad;
  origen: "cantidades" | "porcentajes" | "mixto" | "";
  avisos: string[];
}

function leerArchivo(f: File): Promise<string> {
  return new Promise((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => mal(new Error("No se pudo abrir la imagen."));
    r.readAsDataURL(f);
  });
}

/** Pantallazo de una fórmula → porcentajes. Se sube, se arrastra o se pega con Ctrl+V;
 *  se ve el resultado (cantidad de la captura → %) antes de pasarlo a la tabla. */
function LeerCaptura({ hayIngredientes, onUsar }: { hayIngredientes: boolean; onUsar: (r: LecturaCaptura) => void }) {
  const [imagen, setImagen] = useState<string | null>(null);
  const [encima, setEncima] = useState(false);
  const archivo = useRef<HTMLInputElement>(null);

  const leer = useMutation({
    mutationFn: (dataUrl: string) => api.post<LecturaCaptura>("/api/formulas/leer-captura", { imagen: dataUrl }),
  });

  async function tomar(f: File | null | undefined) {
    if (!f || !f.type.startsWith("image/")) return;
    const url = await leerArchivo(f);
    setImagen(url);
    leer.mutate(url);
  }

  // Ctrl+V en cualquier parte mientras el panel está abierto.
  useEffect(() => {
    const pegar = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith("image/"));
      if (!f) return;
      e.preventDefault();
      void tomar(f);
    };
    document.addEventListener("paste", pegar);
    return () => document.removeEventListener("paste", pegar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const r = leer.data;
  const unidadCaptura = r?.unidad ?? "g";

  return (
    <div className="mb-3 rounded-lg border border-accent/40 bg-accent/5 p-2.5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setEncima(true);
        }}
        onDragLeave={() => setEncima(false)}
        onDrop={(e) => {
          e.preventDefault();
          setEncima(false);
          void tomar(e.dataTransfer.files[0]);
        }}
        onClick={() => archivo.current?.click()}
        className={`flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed p-3 transition-colors ${
          encima ? "border-accent bg-accent/10" : "border-border hover:border-accent/60"
        }`}
      >
        {imagen ? (
          <img src={imagen} alt="Pantallazo de la fórmula" className="max-h-28 max-w-[40%] rounded border border-border object-contain" />
        ) : (
          <span className="text-2xl">📷</span>
        )}
        <span className="text-xs text-ink">
          {leer.isPending ? (
            "Leyendo la fórmula de la captura…"
          ) : (
            <>
              <b>Pega el pantallazo con Ctrl+V</b>, arrástralo aquí o haz clic para elegirlo.
              <span className="block text-[11px] text-muted">
                Sirve con gramos, kilos, mililitros o porcentajes: se calcula el % de cada ingrediente.
              </span>
            </>
          )}
        </span>
        <input
          ref={archivo}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void tomar(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      {leer.error && <p className="mt-2 text-xs text-red-600">{(leer.error as Error).message}</p>}

      {r && !leer.isPending && r.ingredientes.length > 0 && (
        <div className="mt-2.5">
          <p className="mb-1 text-xs text-ink">
            {r.ingredientes.length} ingredientes
            {r.total > 0 ? ` · la captura suma ${num(r.total)} ${unidadCaptura}` : " · la captura traía porcentajes"}
          </p>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="px-1 py-1 font-medium">Ingrediente</th>
                <th className="px-1 py-1 text-right font-medium">En la captura</th>
                <th className="px-1 py-1 text-right font-medium">%</th>
              </tr>
            </thead>
            <tbody>
              {r.ingredientes.map((i, k) => (
                <tr key={k} className="border-t border-border/60">
                  <td className="px-1 py-1 text-ink">{i.nombre}</td>
                  <td className="px-1 py-1 text-right tabular-nums text-muted">{i.cantidad_captura || "—"}</td>
                  <td className="px-1 py-1 text-right font-semibold tabular-nums text-ink">{num(i.porcentaje, 4)} %</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.avisos.map((a, k) => (
            <p key={k} className="mt-1 text-[11px] text-amber-600">
              {a}
            </p>
          ))}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={BOTON}
              onClick={() => {
                if (hayIngredientes && !window.confirm("Esto reemplaza los ingredientes que ya tiene la fórmula. ¿Continuar?")) return;
                onUsar(r);
              }}
            >
              Usar estos porcentajes
            </button>
            <span className="text-[11px] text-muted">Revisa los nombres: la IA puede equivocarse en letras borrosas.</span>
          </div>
        </div>
      )}
      {r && !leer.isPending && r.ingredientes.length === 0 && (
        <p className="mt-2 text-xs text-amber-600">{r.avisos[0] || "No encontré ingredientes en la imagen."}</p>
      )}
    </div>
  );
}

/** Ingrediente: se escribe libre o se elige una materia prima del catálogo de
 *  Alegra (sin combos). Elegida, guarda su código; si se reescribe, vuelve a texto libre. */
function BuscadorIngrediente({
  valor,
  autoFocus,
  onElegir,
}: {
  valor: Ingrediente;
  autoFocus?: boolean;
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
        onBlur={() => {
          // Código o nombre escrito completo (p. ej. «AGUDESmL») queda enlazado sin tener que hacer clic.
          const t = valor.nombre.trim().toLowerCase();
          const igual = !valor.codigo && t ? items.find((it) => it.codigo.toLowerCase() === t || it.nombre.trim().toLowerCase() === t) : undefined;
          if (igual) onElegir(igual.codigo, igual.nombre);
        }}
        autoFocus={autoFocus}
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

/** SKU de Alegra de la fórmula: se elige entre los combos (C-FOR-…mL). */
function SkuAlegra({ sku, nombre, onElegir }: { sku: string; nombre: string; onElegir: (sku: string, nombre: string) => void }) {
  const [q, setQ] = useState("");
  const [qDeb, setQDeb] = useState("");
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setQDeb(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  const { data, isFetching } = useQuery({
    queryKey: ["formulas-combos", qDeb],
    queryFn: () => api.get<{ items: { codigo: string; nombre: string }[] }>(`/api/formulas/combos?q=${encodeURIComponent(qDeb)}`),
    enabled: abierto && qDeb.length >= 2,
    staleTime: 60_000,
  });
  const items = data?.items ?? [];

  if (sku) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        SKU en Alegra
        <span className="rounded-full border border-accent/50 bg-accent/10 px-2.5 py-1 font-semibold text-accent">{sku}</span>
        {nombre && <span className="text-ink">{nombre}</span>}
        <button type="button" className="text-muted underline hover:text-red-600" onClick={() => onElegir("", "")}>
          Quitar
        </button>
      </div>
    );
  }

  return (
    <div ref={caja} className="relative flex flex-col gap-1 text-xs text-muted">
      SKU en Alegra
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setAbierto(true);
        }}
        onFocus={() => setAbierto(true)}
        placeholder="Buscar el combo de la fórmula, p. ej. C-FOR o FORMULA…"
        className={CAMPO}
      />
      {abierto && qDeb.length >= 2 && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
          {items.map((it) => (
            <li key={it.codigo}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onElegir(it.codigo, it.nombre);
                  setQ("");
                  setAbierto(false);
                }}
                className="w-full px-2.5 py-1.5 text-left text-xs text-ink hover:bg-accent/10"
              >
                <span className="font-semibold">{it.codigo}</span>
                <span className="ml-1.5 text-muted">{it.nombre}</span>
              </button>
            </li>
          ))}
          {!isFetching && items.length === 0 && <li className="px-2.5 py-1.5 text-xs text-muted">Ningún combo coincide.</li>}
        </ul>
      )}
    </div>
  );
}
