import { useEffect } from "react";
import { CLASIF, ORDEN_CLASIF, tonoPieza, type Clasificacion, type FilaSku } from "./tipos";
import { PIEZAS } from "./piezas";

const SEG: Record<string, string> = {
  ok: "bg-accent-leaf",
  aviso: "bg-accent-sun",
  falta: "bg-accent-rose",
  na: "bg-border",
};

/** La lista es la cola: lo que se filtra es lo que se recorre. Cada segmento es una pieza del tablero. */
export default function ListaSkus({
  filas, total, actual, q, setQ, filtro, setFiltro, resumen, onElegir,
}: {
  filas: FilaSku[];
  total: number;
  actual: string | null;
  q: string;
  setQ: (v: string) => void;
  filtro: Clasificacion | "problemas" | "todos";
  setFiltro: (v: Clasificacion | "problemas" | "todos") => void;
  resumen: Record<Clasificacion, number>;
  onElegir: (sku: string, pieza?: string) => void;
}) {
  useEffect(() => {
    if (actual) document.getElementById(`canal-fila-${actual}`)?.scrollIntoView({ block: "nearest" });
  }, [actual, filas.length]);

  const problemas = ORDEN_CLASIF.filter((c) => c !== "completo").reduce((n, c) => n + (resumen[c] ?? 0), 0);
  const chips: { id: Clasificacion | "problemas" | "todos"; nombre: string; n: number }[] = [
    { id: "problemas", nombre: "Con problemas", n: problemas },
    ...ORDEN_CLASIF.map((c) => ({ id: c, nombre: CLASIF[c].corto, n: resumen[c] ?? 0 })),
    { id: "todos", nombre: "Todos", n: total },
  ];

  return (
    <div className="flex min-h-0 min-w-0 flex-col rounded-xl border border-border bg-surface-panel p-2">
      <input
        value={q}
        onChange={(ev) => setQ(ev.target.value)}
        placeholder="Buscar SKU o nombre…"
        aria-label="Buscar SKU"
        className="w-full rounded-md border border-border bg-surface-input px-2 py-1.5 text-[12px] text-ink"
      />
      <div className="mt-1.5 flex flex-wrap gap-1">
        {chips.map((f) => (
          <button
            key={f.id}
            onClick={() => setFiltro(f.id)}
            aria-pressed={filtro === f.id}
            title={f.id in CLASIF ? CLASIF[f.id as Clasificacion].ayuda : undefined}
            className={`mck-flujo-nodo whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10.5px] font-bold ${
              filtro === f.id ? "border-accent bg-accent text-white" : "border-border bg-surface-input text-ink-secondary hover:border-accent/50"
            }`}
          >
            {f.nombre} <span className="tabular-nums opacity-75">{f.n}</span>
          </button>
        ))}
      </div>
      <p className="mt-1 font-mono text-[9.5px] text-muted">{filas.length} de {total} · primero lo más grave</p>
      <div className="mt-1 min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
        {filas.map((f) => {
          const aqui = f.sku === actual;
          const cl = CLASIF[f.clasificacion];
          return (
            <div
              key={f.sku}
              id={`canal-fila-${f.sku}`}
              className={`rounded-lg border p-1.5 transition ${aqui ? "border-accent bg-accent/10" : "border-border bg-surface-input hover:border-accent/50"}`}
            >
              <button onClick={() => onElegir(f.sku)} aria-current={aqui ? "true" : undefined} className="mck-btn-no-fx flex w-full items-center gap-2 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px] font-bold leading-tight text-ink">{f.nombre}</span>
                  <code className="block truncate text-[9.5px] text-muted">{f.sku}</code>
                </span>
                <span className={`shrink-0 rounded-full px-1.5 text-[9.5px] font-bold ${cl.tono}`}>{cl.corto}</span>
              </button>
              <div className="mt-1 flex gap-0.5">
                {PIEZAS.map((p) => {
                  const est = p.estado(f);
                  return (
                    <button
                      key={p.clave}
                      onClick={() => onElegir(f.sku, p.clave)}
                      title={`${p.titulo}: ${p.texto(f)}`}
                      aria-label={`${f.nombre}: ${p.titulo}`}
                      className={`mck-btn-no-fx h-2 flex-1 rounded-full transition hover:scale-y-150 ${SEG[tonoPieza(est)]}`}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
        {filas.length === 0 && <p className="px-1 py-3 text-[11.5px] text-muted">Ningún SKU coincide con ese filtro.</p>}
      </div>
    </div>
  );
}
