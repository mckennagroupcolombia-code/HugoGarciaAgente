import { useMemo, useState } from "react";
import {
  useAnalizarCompetenciaPrecios,
  useBorrarObservacionCompetencia,
  useGuardarObservacionCompetencia,
  useUltimoAnalisisCompetencia,
  type ProductoCompetencia,
  type VeredictoCompetencia,
} from "../hooks/useCompetenciaPrecios";

function cop(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `$${Math.round(Number(n)).toLocaleString("es-CO")}`;
}

const VEREDICTO: Record<
  VeredictoCompetencia,
  { label: string; className: string }
> = {
  mas_caro: {
    label: "Nosotros más caros",
    className: "bg-red-50 text-red-800 border-red-200",
  },
  similar: {
    label: "Precio similar",
    className: "bg-amber-50 text-amber-900 border-amber-200",
  },
  mas_barato: {
    label: "Nosotros más baratos",
    className: "bg-green-50 text-green-800 border-green-200",
  },
  sin_competencia: {
    label: "Sin anotar",
    className: "bg-gray-50 text-gray-600 border-gray-200",
  },
};

function BadgeVeredicto({ v }: { v: VeredictoCompetencia }) {
  const meta = VEREDICTO[v] ?? VEREDICTO.sin_competencia;
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

function FilaProducto({ p }: { p: ProductoCompetencia }) {
  const [open, setOpen] = useState(true);
  const [precio, setPrecio] = useState("");
  const [vendedor, setVendedor] = useState("");
  const [permalink, setPermalink] = useState("");
  const guardar = useGuardarObservacionCompetencia();
  const borrar = useBorrarObservacionCompetencia();
  const delta = p.delta_pct_vs_min;
  const obs = p.observaciones_manual ?? [];
  const busqueda = p.url_busqueda_meli;

  return (
    <div className="rounded-xl border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 p-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{p.titulo}</p>
          <p className="mt-0.5 text-[11px] text-muted">
            {p.sku ? `${p.sku} · ` : ""}
            {p.unidades_periodo} uds en el período
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-black text-ink">{cop(p.precio)}</p>
          {delta != null && p.veredicto !== "sin_competencia" ? (
            <p
              className={`text-[11px] font-semibold ${
                delta > 0 ? "text-red-600" : delta < 0 ? "text-green-700" : "text-muted"
              }`}
            >
              {delta > 0 ? "+" : ""}
              {delta}% vs anotado
            </p>
          ) : null}
          <div className="mt-1">
            <BadgeVeredicto v={p.veredicto} />
          </div>
        </div>
      </button>
      {open && (
        <div className="space-y-3 border-t border-border px-3 pb-3 pt-3">
          <div className="flex flex-wrap gap-2">
            {busqueda ? (
              <a
                href={busqueda}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-white"
              >
                Buscar en MeLi (tu navegador)
              </a>
            ) : null}
            {p.permalink ? (
              <a
                href={p.permalink}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink"
              >
                Nuestra publicación
              </a>
            ) : null}
          </div>
          <p className="text-[11px] leading-relaxed text-muted">
            Se abre Mercado Libre en otra pestaña. Anotá acá el precio que ves
            (vendedor y link son opcionales). El servidor no visita esas páginas.
          </p>
          <form
            className="grid grid-cols-1 gap-2 sm:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!precio.trim()) return;
              guardar.mutate(
                {
                  item_id: p.item_id,
                  precio: precio.trim(),
                  vendedor: vendedor.trim() || undefined,
                  permalink: permalink.trim() || undefined,
                },
                {
                  onSuccess: () => {
                    setPrecio("");
                    setVendedor("");
                    setPermalink("");
                  },
                },
              );
            }}
          >
            <input
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              placeholder="Precio visto ($24.900)"
              className="rounded-lg border border-border bg-surface-panel px-2 py-1.5 text-sm text-ink sm:col-span-1"
              required
            />
            <input
              value={vendedor}
              onChange={(e) => setVendedor(e.target.value)}
              placeholder="Vendedor (opcional)"
              className="rounded-lg border border-border bg-surface-panel px-2 py-1.5 text-sm text-ink"
            />
            <input
              value={permalink}
              onChange={(e) => setPermalink(e.target.value)}
              placeholder="Link MeLi (opcional)"
              className="rounded-lg border border-border bg-surface-panel px-2 py-1.5 text-sm text-ink sm:col-span-1"
            />
            <button
              type="submit"
              disabled={guardar.isPending}
              className="rounded-lg border border-accent px-3 py-1.5 text-xs font-bold text-accent disabled:opacity-60"
            >
              {guardar.isPending ? "Guardando…" : "Anotar precio"}
            </button>
          </form>
          {guardar.isError ? (
            <p className="text-[11px] text-danger">
              {guardar.error instanceof Error ? guardar.error.message : "No se pudo guardar"}
            </p>
          ) : null}
          {obs.length === 0 ? (
            <p className="text-[11px] text-muted">Todavía no hay precios anotados a ojo.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {obs.map((o) => (
                <li
                  key={o.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-surface-panel px-2 py-1.5"
                >
                  <span className="min-w-0 truncate text-ink">
                    <span className="font-semibold">{cop(o.precio)}</span>
                    {o.vendedor ? ` · ${o.vendedor}` : ""}
                    {o.visto_en ? (
                      <span className="text-muted"> · {o.visto_en.replace("T", " ")}</span>
                    ) : null}
                    {o.permalink ? (
                      <>
                        {" "}
                        <a
                          href={o.permalink}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent hover:underline"
                        >
                          ver
                        </a>
                      </>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => borrar.mutate(o.id)}
                    className="shrink-0 text-[11px] text-muted hover:text-danger"
                  >
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function CompetenciaPreciosPanel() {
  const ultimo = useUltimoAnalisisCompetencia();
  const mut = useAnalizarCompetenciaPrecios();
  const [topN, setTopN] = useState(12);
  const [dias, setDias] = useState(30);
  const [consulta, setConsulta] = useState("");
  const [filtro, setFiltro] = useState<VeredictoCompetencia | "todos">("todos");

  const data = mut.data ?? ultimo.data;
  const productos = data?.productos ?? [];
  const visibles = useMemo(
    () =>
      filtro === "todos"
        ? productos
        : productos.filter((p) => p.veredicto === filtro),
    [filtro, productos],
  );
  const r = data?.resumen;
  const cargando = mut.isPending;
  const error = mut.error
    ? mut.error instanceof Error
      ? mut.error.message
      : String(mut.error)
    : data && data.ok === false
      ? data.error ?? "El análisis falló."
      : ultimo.error instanceof Error
        ? ultimo.error.message
        : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-surface-panel p-4">
      <div>
        <h2 className="text-base font-black text-ink">Competencia a ojo</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
          El ranking sale de nuestras ventas. La comparación la hacés vos en el
          navegador: se abre el listado de MeLi, ves el precio y lo anotás acá.
          No hay scraping ni consulta a publicaciones ajenas.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] font-semibold text-muted">
          Top
          <input
            type="number"
            min={1}
            max={25}
            value={topN}
            onChange={(e) => setTopN(Number(e.target.value) || 12)}
            className="mt-0.5 block w-16 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink"
          />
        </label>
        <label className="text-[11px] font-semibold text-muted">
          Días
          <input
            type="number"
            min={7}
            max={90}
            value={dias}
            onChange={(e) => setDias(Number(e.target.value) || 30)}
            className="mt-0.5 block w-16 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink"
          />
        </label>
        <label className="min-w-[12rem] flex-1 text-[11px] font-semibold text-muted">
          Producto (opcional)
          <input
            type="search"
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            placeholder="urea, SKU o MCO…"
            className="mt-0.5 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink"
          />
        </label>
        <button
          type="button"
          disabled={cargando}
          onClick={() =>
            mut.mutate({
              top_n: topN,
              dias,
              consulta: consulta.trim() || undefined,
            })
          }
          className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
        >
          {cargando ? "Actualizando…" : "Actualizar más vendidos"}
        </button>
      </div>

      {data?.generado_en ? (
        <p className="text-[11px] text-muted">
          Ranking: {data.generado_en.replace("T", " ")}
          {data.stale ? " · conviene actualizar" : ""}
        </p>
      ) : (
        <p className="text-[11px] text-muted">
          Pulsa «Actualizar más vendidos» para cargar el ranking de nuestra cuenta.
        </p>
      )}

      {error ? <p className="text-xs text-danger">{error}</p> : null}

      {r ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button
            type="button"
            onClick={() => setFiltro("todos")}
            className={`rounded-xl border p-3 text-center ${filtro === "todos" ? "border-accent" : "border-border"}`}
          >
            <p className="text-lg font-black text-ink">{r.productos}</p>
            <p className="text-[11px] text-muted">Más vendidos</p>
          </button>
          <button
            type="button"
            onClick={() => setFiltro("mas_caro")}
            className={`rounded-xl border p-3 text-center ${filtro === "mas_caro" ? "border-red-400 bg-red-50" : "border-red-200 bg-red-50/50"}`}
          >
            <p className="text-lg font-black text-red-700">{r.nosotros_mas_caros}</p>
            <p className="text-[11px] text-red-700">A revisar</p>
          </button>
          <button
            type="button"
            onClick={() => setFiltro("mas_barato")}
            className={`rounded-xl border p-3 text-center ${filtro === "mas_barato" ? "border-green-400 bg-green-50" : "border-green-200 bg-green-50/50"}`}
          >
            <p className="text-lg font-black text-green-700">{r.nosotros_mas_baratos}</p>
            <p className="text-[11px] text-green-700">Más baratos</p>
          </button>
          <button
            type="button"
            onClick={() => setFiltro("sin_competencia")}
            className={`rounded-xl border p-3 text-center ${filtro === "sin_competencia" ? "border-border bg-surface" : "border-border"}`}
          >
            <p className="text-lg font-black text-ink">{r.sin_match}</p>
            <p className="text-[11px] text-muted">Sin anotar</p>
          </button>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {visibles.map((p) => (
          <FilaProducto key={p.item_id} p={p} />
        ))}
      </div>
    </div>
  );
}
