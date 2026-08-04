import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

// ── Types ────────────────────────────────────────────────────────────────────

interface CompraItem {
  factura: string;
  precio_unitario: number;
  fecha: string;
}

interface ProductoCosto {
  codigo: string;
  nombre: string;
  unidad: string;
  historial: CompraItem[];
  n_compras: number;
  precio_min: number | null;
  precio_max: number | null;
  precio_reciente: number;
  fecha_reciente: string;
}

interface CostosResponse {
  productos: ProductoCosto[];
  total: number;
  facturas_leidas: number;
  errores: string[];
  ultima_actualizacion: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function cop(n: number) {
  return `$ ${n.toLocaleString("es-CO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function variacionPct(min: number | null, max: number | null): string | null {
  if (!min || !max || min === 0 || min === max) return null;
  const pct = ((max - min) / min) * 100;
  return `+${pct.toFixed(1)}%`;
}

// ── Fila de producto expandible ───────────────────────────────────────────────

function ProductoRow({ p }: { p: ProductoCosto }) {
  const [expanded, setExpanded] = useState(false);
  const variacion = variacionPct(p.precio_min, p.precio_max);
  const multiCompra = p.n_compras > 1;

  return (
    <>
      <tr
        onClick={() => setExpanded((v) => !v)}
        className={`cursor-pointer transition-colors ${
          expanded
            ? "bg-accent/8"
            : "hover:bg-surface-hover"
        }`}
      >
        {/* Código */}
        <td className="px-3 py-2.5 font-mono text-xs text-accent whitespace-nowrap">
          {p.codigo}
        </td>

        {/* Nombre */}
        <td className="px-3 py-2.5 text-sm font-semibold text-ink max-w-[220px]">
          <span className="block truncate" title={p.nombre}>{p.nombre}</span>
        </td>

        {/* Unidad */}
        <td className="px-3 py-2.5 text-xs text-center font-mono text-muted">
          {p.unidad || "—"}
        </td>

        {/* # Compras */}
        <td className="px-3 py-2.5 text-center">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
              multiCompra
                ? "bg-accent/15 text-accent"
                : "bg-border text-muted"
            }`}
          >
            {p.n_compras}
          </span>
        </td>

        {/* Precio más reciente */}
        <td className="px-3 py-2.5 text-sm font-bold text-ink text-right whitespace-nowrap">
          {cop(p.precio_reciente)}
        </td>

        {/* Mínimo */}
        <td className="px-3 py-2.5 text-xs text-muted text-right font-mono whitespace-nowrap">
          {p.precio_min != null ? cop(p.precio_min) : "—"}
        </td>

        {/* Máximo */}
        <td className="px-3 py-2.5 text-xs text-muted text-right font-mono whitespace-nowrap">
          {p.precio_max != null ? cop(p.precio_max) : "—"}
        </td>

        {/* Variación */}
        <td className="px-3 py-2.5 text-center text-xs">
          {variacion ? (
            <span className="rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 font-bold px-1.5 py-0.5">
              {variacion}
            </span>
          ) : (
            <span className="text-muted">—</span>
          )}
        </td>

        {/* Última compra */}
        <td className="px-3 py-2.5 text-xs text-muted text-center whitespace-nowrap">
          {p.fecha_reciente || "—"}
        </td>

        {/* Toggle */}
        <td className="px-2 py-2.5 text-center text-muted text-xs">
          <span
            className={`inline-block transition-transform ${expanded ? "rotate-180" : ""} text-accent`}
          >
            ▾
          </span>
        </td>
      </tr>

      {/* Historial expandido */}
      {expanded && (
        <tr>
          <td colSpan={10} className="bg-surface p-0">
            <div className="border-l-4 border-accent mx-3 mb-2 mt-0.5 rounded-r-lg bg-surface-panel">
              <div className="px-4 py-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted">
                  Historial de compras — {p.nombre}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted text-left border-b border-border/50">
                        <th className="pb-1.5 pr-6 font-semibold">Factura proveedor</th>
                        <th className="pb-1.5 pr-6 font-semibold">Fecha procesada</th>
                        <th className="pb-1.5 text-right font-semibold">
                          Costo por {p.unidad || "unidad"}
                        </th>
                        <th className="pb-1.5 pl-4 text-center font-semibold">Variación</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {[...p.historial].reverse().map((h, i, arr) => {
                        const prev = arr[i + 1];
                        let diff: number | null = null;
                        if (prev && prev.precio_unitario > 0 && h.precio_unitario > 0) {
                          diff = ((h.precio_unitario - prev.precio_unitario) / prev.precio_unitario) * 100;
                        }
                        return (
                          <tr key={`${h.factura}-${i}`} className="hover:bg-surface-hover">
                            <td className="py-2 pr-6 font-mono text-accent">{h.factura}</td>
                            <td className="py-2 pr-6 text-muted">{h.fecha}</td>
                            <td className="py-2 text-right font-bold text-ink">
                              {cop(h.precio_unitario)}
                            </td>
                            <td className="py-2 pl-4 text-center">
                              {diff !== null ? (
                                <span
                                  className={`text-[10px] font-bold rounded px-1.5 py-0.5 ${
                                    diff > 0
                                      ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                                      : diff < 0
                                      ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                                      : "bg-border text-muted"
                                  }`}
                                >
                                  {diff > 0 ? "+" : ""}{diff.toFixed(1)}%
                                </span>
                              ) : (
                                <span className="text-muted text-[10px]">Primer precio</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Panel principal ───────────────────────────────────────────────────────────

type Orden = "nombre" | "precio_reciente" | "n_compras" | "fecha_reciente";

export default function CostosProductosPanel() {
  const [busqueda, setBusqueda] = useState("");
  const [orden, setOrden] = useState<Orden>("nombre");
  const [soloMultiples, setSoloMultiples] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = useQuery<CostosResponse>({
    queryKey: ["costos-productos"],
    queryFn: () => api.get("/api/facturas/costos-productos"),
    staleTime: 3 * 60_000,
  });

  const filtrados = useMemo(() => {
    let lista = data?.productos ?? [];
    const q = busqueda.trim().toLowerCase();
    if (q) {
      lista = lista.filter(
        (p) =>
          p.nombre.toLowerCase().includes(q) ||
          p.codigo.toLowerCase().includes(q),
      );
    }
    if (soloMultiples) {
      lista = lista.filter((p) => p.n_compras > 1);
    }
    return [...lista].sort((a, b) => {
      if (orden === "nombre") return a.nombre.localeCompare(b.nombre);
      if (orden === "precio_reciente") return b.precio_reciente - a.precio_reciente;
      if (orden === "n_compras") return b.n_compras - a.n_compras;
      if (orden === "fecha_reciente") return b.fecha_reciente.localeCompare(a.fecha_reciente);
      return 0;
    });
  }, [busqueda, soloMultiples, orden, data?.productos]);

  const conVariacion = useMemo(
    () => (data?.productos ?? []).filter((p) => variacionPct(p.precio_min, p.precio_max) !== null).length,
    [data?.productos],
  );

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="rounded-xl border-2 border-border bg-surface-panel p-4">
        <div className="flex flex-wrap items-center justify-end gap-4">
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="shrink-0 rounded-xl border-2 border-border px-4 py-2.5 text-sm font-semibold text-muted hover:text-ink hover:border-accent disabled:opacity-50 flex items-center gap-2 transition"
          >
            {isFetching ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            ) : (
              <span className="text-base">↻</span>
            )}
            Actualizar
          </button>
        </div>

        {/* Stats */}
        {data && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: "Productos únicos", val: String(data.total) },
              { label: "Facturas leídas", val: String(data.facturas_leidas) },
              {
                label: "Con múlt. compras",
                val: String((data.productos).filter((p) => p.n_compras > 1).length),
              },
              {
                label: "Con variación de precio",
                val: String(conVariacion),
              },
            ].map(({ label, val }) => (
              <div
                key={label}
                className="rounded-lg border border-border bg-surface px-3 py-2"
              >
                <p className="text-[10px] text-muted uppercase tracking-wide">{label}</p>
                <p className="text-xl font-bold text-ink">{val}</p>
              </div>
            ))}
          </div>
        )}

        {data?.errores && data.errores.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
            <p className="text-xs font-bold text-amber-700 dark:text-amber-300">
              {data.errores.length} archivo(s) con error al leer
            </p>
            <ul className="mt-1 text-[11px] text-amber-800 dark:text-amber-400 space-y-0.5 font-mono">
              {data.errores.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}
      </div>

      {/* ── Filtros y búsqueda ── */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[240px]">
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o código SIIGO…"
            className="w-full rounded-xl border-2 border-border bg-surface-panel px-4 py-2.5 pl-9 text-sm text-ink placeholder:text-muted outline-none focus:border-accent transition"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">🔍</span>
          {busqueda && (
            <button
              type="button"
              onClick={() => setBusqueda("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink text-xs px-1"
            >
              ✕
            </button>
          )}
        </div>

        {/* Ordenar */}
        <select
          value={orden}
          onChange={(e) => setOrden(e.target.value as Orden)}
          className="rounded-xl border-2 border-border bg-surface-panel px-3 py-2.5 text-sm text-ink outline-none focus:border-accent cursor-pointer"
        >
          <option value="nombre">Ordenar: Nombre A→Z</option>
          <option value="precio_reciente">Ordenar: Precio más alto</option>
          <option value="n_compras">Ordenar: Más compras</option>
          <option value="fecha_reciente">Ordenar: Más reciente</option>
        </select>

        {/* Filtro múltiples compras */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={soloMultiples}
            onChange={(e) => setSoloMultiples(e.target.checked)}
            className="accent-accent w-4 h-4"
          />
          <span className="text-sm text-ink-secondary font-medium whitespace-nowrap">
            Solo con múltiples compras
          </span>
        </label>
      </div>

      {/* Contador de resultados */}
      {(busqueda || soloMultiples) && !isLoading && (
        <p className="text-xs text-muted -mt-2">
          {filtrados.length} resultado{filtrados.length !== 1 ? "s" : ""}
          {busqueda ? ` para "${busqueda}"` : ""}
          {soloMultiples ? " con múltiples compras" : ""}
        </p>
      )}

      {/* ── Estados de carga / error / vacío ── */}
      {isLoading && (
        <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          Leyendo historial de facturas de compra…
        </div>
      )}

      {!isLoading && error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-8 text-center">
          <p className="text-2xl mb-2">⚠️</p>
          <p className="text-sm font-semibold text-red-400">No se pudo cargar el historial</p>
          <p className="text-xs text-muted mt-1">Verifica que el servidor esté disponible.</p>
        </div>
      )}

      {!isLoading && !error && data?.total === 0 && (
        <div className="rounded-xl border-2 border-dashed border-border p-14 text-center">
          <p className="text-4xl mb-3">📦</p>
          <p className="text-base font-bold text-ink">Sin productos inventariados aún</p>
          <p className="text-sm text-muted mt-2 max-w-sm mx-auto">
            Los productos aparecen aquí después de procesar facturas de compra como{" "}
            <strong>inventario</strong> en el panel de Facturas de compra.
          </p>
        </div>
      )}

      {!isLoading && !error && filtrados.length === 0 && (data?.total ?? 0) > 0 && (
        <div className="rounded-xl border-2 border-dashed border-border p-10 text-center">
          <p className="text-2xl mb-2">🔍</p>
          <p className="text-sm font-semibold text-ink">Sin resultados</p>
          <p className="text-xs text-muted mt-1">Prueba con otro término de búsqueda.</p>
        </div>
      )}

      {/* ── Tabla ── */}
      {!isLoading && !error && filtrados.length > 0 && (
        <div className="rounded-xl border-2 border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-surface-hover border-b-2 border-border text-[10px] font-bold uppercase tracking-wide text-muted">
                  <th className="px-3 py-3 whitespace-nowrap">Código SIIGO</th>
                  <th className="px-3 py-3">Nombre del producto</th>
                  <th className="px-3 py-3 text-center">U/M</th>
                  <th className="px-3 py-3 text-center whitespace-nowrap">
                    # Compras
                  </th>
                  <th className="px-3 py-3 text-right whitespace-nowrap">
                    Precio reciente
                  </th>
                  <th className="px-3 py-3 text-right whitespace-nowrap">Mínimo</th>
                  <th className="px-3 py-3 text-right whitespace-nowrap">Máximo</th>
                  <th className="px-3 py-3 text-center whitespace-nowrap">Variación</th>
                  <th className="px-3 py-3 text-center whitespace-nowrap">
                    Última compra
                  </th>
                  <th className="px-2 py-3 w-6"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filtrados.map((p) => (
                  <ProductoRow key={p.codigo} p={p} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer de la tabla */}
          <div className="border-t border-border bg-surface-hover px-4 py-2 flex items-center justify-between gap-4">
            <p className="text-[11px] text-muted">
              {filtrados.length} de {data?.total ?? 0} productos
              {data?.ultima_actualizacion
                ? ` · Actualizado ${new Date(data.ultima_actualizacion).toLocaleTimeString("es-CO", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : ""}
            </p>
            <p className="text-[11px] text-muted hidden sm:block">
              Haz clic en una fila para ver el historial completo
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
