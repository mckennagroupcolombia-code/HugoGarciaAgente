import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../../api/client";
import { CLASIF, type FilaCategoria } from "./tipos";

type Resp = { filas: FilaCategoria[]; total: number; generado: string };

/** Las tres taxonomías lado a lado. Sirve para ver la desalineación antes de ordenar
 *  las categorías: la misma familia de etiquetas repartida en varias categorías web, o
 *  productos que ninguna regla clasifica («otros» / sin categoría web). */
export default function VistaCategorias() {
  const datos = useQuery({
    queryKey: ["canales-producto-categorias"],
    queryFn: () => api.get<Resp>("/api/canales-producto/categorias"),
  });
  const [q, setQ] = useState("");
  const [soloSinCat, setSoloSinCat] = useState(false);

  const filas = useMemo(() => {
    const t = q.trim().toUpperCase();
    return (datos.data?.filas ?? []).filter(
      (f) =>
        (!t || f.nombre.toUpperCase().includes(t) || f.sku.toUpperCase().includes(t)) &&
        (!soloSinCat || !f.cat_web || f.cat_etiquetas === "otros"),
    );
  }, [datos.data, q, soloSinCat]);

  // Cuántas categorías web distintas caen en cada categoría de etiquetas.
  const cruce = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const f of datos.data?.filas ?? []) {
      const k = f.cat_etiquetas || "—";
      const w = f.cat_web || "(sin categoría web)";
      if (!m.has(k)) m.set(k, new Map());
      m.get(k)!.set(w, (m.get(k)!.get(w) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1].size - a[1].size);
  }, [datos.data]);

  if (datos.isLoading) return <p className="text-xs text-muted">Leyendo categorías…</p>;
  if (datos.isError) return <p className="text-xs text-accent-rose">No se pudieron leer las categorías: {(datos.error as Error).message}</p>;

  return (
    <div className="grid min-h-0 gap-3 xl:grid-cols-[1fr_340px]">
      <div className="flex min-h-0 flex-col rounded-xl border border-border bg-surface-panel p-2">
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" className="w-56 rounded-md border border-border bg-surface-input px-2 py-1.5 text-[12px] text-ink" />
          <label className="flex items-center gap-1 text-[11.5px] text-ink">
            <input type="checkbox" checked={soloSinCat} onChange={(e) => setSoloSinCat(e.target.checked)} />
            Solo sin clasificar
          </label>
          <span className="font-mono text-[10px] text-muted">{filas.length} de {datos.data?.total ?? 0}</span>
        </div>
        <div className="mt-2 min-h-0 flex-1 overflow-auto">
          <table className="w-full text-left text-[11.5px]">
            <thead className="sticky top-0 bg-surface-panel text-[10px] uppercase text-muted">
              <tr>
                <th className="py-1 pr-2">Producto</th>
                <th className="py-1 pr-2">Etiquetas</th>
                <th className="py-1 pr-2">Web</th>
                <th className="py-1 pr-2">MeLi</th>
                <th className="py-1">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.sku} className="border-t border-border/60">
                  <td className="py-1 pr-2">
                    <span className="block max-w-[320px] truncate font-bold text-ink">{f.nombre}</span>
                    <code className="text-[9.5px] text-muted">{f.sku}</code>
                  </td>
                  <td className={`py-1 pr-2 ${f.cat_etiquetas === "otros" ? "text-accent-rose" : "text-ink"}`}>{f.cat_etiquetas || "—"}</td>
                  <td className={`py-1 pr-2 ${f.cat_web ? "text-ink" : "text-accent-rose"}`}>{f.cat_web || "sin categoría"}</td>
                  <td className="py-1 pr-2 text-muted" title="MeLi no guarda la categoría en ningún archivo local todavía">sin dato local</td>
                  <td className="py-1"><span className={`rounded-full px-1.5 text-[9.5px] font-bold ${CLASIF[f.clasificacion].tono}`}>{CLASIF[f.clasificacion].corto}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="min-h-0 overflow-y-auto rounded-xl border border-border bg-surface-panel p-3">
        <p className="font-mono text-[9.5px] font-bold uppercase tracking-wide text-muted">Cómo se reparte cada categoría de etiquetas en la web</p>
        <p className="mt-1 text-[11px] text-ink-secondary">Una categoría de etiquetas que cae en muchas categorías web es donde las dos taxonomías más se contradicen.</p>
        <div className="mt-2 space-y-2">
          {cruce.map(([etq, webs]) => (
            <div key={etq} className="rounded-md border border-border bg-surface-input p-2">
              <p className="text-[11.5px] font-bold text-ink">{etq} <span className="font-mono text-[10px] text-muted">→ {webs.size} en la web</span></p>
              <div className="mt-1 flex flex-wrap gap-1">
                {[...webs.entries()].sort((a, b) => b[1] - a[1]).map(([w, n]) => (
                  <span key={w} className="rounded border border-border bg-surface px-1.5 text-[10px] text-ink-secondary">{w} <span className="tabular-nums text-muted">{n}</span></span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
