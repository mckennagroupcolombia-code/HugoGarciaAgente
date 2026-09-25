import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import FotoInsumo from "./FotoInsumo";

/**
 * Contador de insumos por lotes: cada compra registrada con SKU suma unidades, cada venta
 * de un combo descuenta las piezas de su receta, y el control de inventario (conteo físico)
 * antes de comprar otro lote corrige el desfase. Sin compra registrada ni conteo no hay
 * existencia («sin lote»): no se inventa. Backend: app/services/insumos.py (sin LLM, sin
 * llamar a Alegra ni a MeLi).
 */

type Fila = {
  sku: string; nombre: string; unidad: string;
  combos: string[]; n_combos: number;
  comprado: number; consumido: number; neto_desde_corte: number;
  existencia: number | null;
  existencia_base: "conteo" | "lotes" | "";
  existencia_desde: string;
  conteo: { cantidad: number; fecha: string; por: string } | null;
  ultima_compra: { fecha: string; cantidad: number; proveedor: string; precio: number; ref: string } | null;
  foto: boolean; foto_v: string;
  equivalentes: string[];
  estado: "revisar" | "sin_lote" | "ok" | "sin_uso";
};
type Resp = { desde: string; filas: Fila[]; totales: Record<string, number>; ventas_sin_resolver: Record<string, number> };

const ESTADOS: { id: string; txt: string; ayuda: string }[] = [
  { id: "", txt: "Todos", ayuda: "" },
  { id: "ok", txt: "Con existencia", ayuda: "Tiene lote registrado o control de inventario: la existencia se lleva desde ahí." },
  { id: "revisar", txt: "Revisar", ayuda: "La existencia dio negativa: se vendió más de lo registrado (inventario viejo o una compra sin registrar). Haz el control de inventario." },
  { id: "sin_lote", txt: "Sin lote", ayuda: "Se usa, pero todavía no se ha registrado ninguna compra ni control: su inventario aún no entró al sistema." },
  { id: "sin_uso", txt: "Sin uso", ayuda: "No está en ningún combo, no se ha comprado ni vendido desde el corte: candidato a inactivar." },
];
const TONO: Record<Fila["estado"], string> = {
  revisar: "bg-red-500/10 text-red-600",
  sin_lote: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  sin_uso: "bg-surface-input text-muted",
};
const TXT: Record<Fila["estado"], string> = { revisar: "revisar", sin_lote: "sin lote", ok: "ok", sin_uso: "sin uso" };

const n = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("es-CO", { maximumFractionDigits: 2 });
const unidadCorta = (u: string) => ({ unit: "und", gram: "g", mililiter: "mL", milliliter: "mL" } as Record<string, string>)[u] ?? u;

function Conteo({ f }: { f: Fila }) {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [cant, setCant] = useState("");
  const [nota, setNota] = useState("");
  const m = useMutation({
    mutationFn: () => api.post(`/api/insumos/${encodeURIComponent(f.sku)}/conteo`, { cantidad: cant, nota }),
    onSuccess: () => { setAbierto(false); setCant(""); setNota(""); void qc.invalidateQueries({ queryKey: ["insumos"] }); },
  });
  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)}
        className="rounded-md border border-border px-2 py-1 text-[11.5px] font-bold text-ink hover:border-accent">
        Control de inventario
      </button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1">
      <input autoFocus value={cant} onChange={(e) => setCant(e.target.value)} inputMode="decimal"
        placeholder={`¿Cuántos ${unidadCorta(f.unidad)} hay?`}
        className="w-28 rounded-md border border-border bg-surface px-2 py-1 text-[12px]" />
      <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="nota (opcional)"
        className="w-28 rounded-md border border-border bg-surface px-2 py-1 text-[12px]" />
      <button type="button" disabled={!cant || m.isPending} onClick={() => m.mutate()}
        className="rounded-md bg-accent px-2 py-1 text-[11.5px] font-bold text-white disabled:opacity-50">
        {m.isPending ? "…" : "Guardar"}
      </button>
      <button type="button" onClick={() => setAbierto(false)} className="text-[11px] text-muted underline">cancelar</button>
      {m.error && <span className="w-full text-[11px] text-red-600">{(m.error as Error).message}</span>}
    </span>
  );
}

export default function InsumosVista() {
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const r = useQuery<Resp>({
    queryKey: ["insumos", q, estado],
    queryFn: () => api.get(`/api/insumos?q=${encodeURIComponent(q)}&estado=${estado}`),
    placeholderData: (prev) => prev,
  });
  const d = r.data;
  const tot = d?.totales ?? {};
  const sinResolver = Object.entries(d?.ventas_sin_resolver ?? {});

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-surface-panel p-3">
        <p className="text-[13px] text-ink">
          Cada producto de inventario con su <b>foto de referencia</b> y su <b>existencia</b>: cada compra registrada
          con SKU suma sus unidades y cada venta de un combo descuenta las piezas de su receta. Antes de comprar otro
          lote, haz el <b>control de inventario</b>: lo contado reemplaza lo calculado y corrige el desfase.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por SKU o nombre… (pastillero, TAP38)"
            className="min-w-[220px] flex-1 rounded-lg border border-border bg-surface-input px-3 py-2 text-[13px]" />
          {ESTADOS.map((e) => (
            <button key={e.id} type="button" title={e.ayuda} onClick={() => setEstado(e.id)}
              className={`rounded-full border px-2.5 py-1 text-[12px] font-bold ${estado === e.id ? "border-accent bg-accent/10 text-accent" : "border-border text-ink"}`}>
              {e.txt}{e.id && tot[e.id] != null ? ` · ${tot[e.id]}` : ""}
            </button>
          ))}
        </div>
      </div>

      {r.isLoading && <p className="text-[12.5px] text-muted">Calculando…</p>}
      {r.error && <p className="text-[12.5px] text-red-600">{(r.error as Error).message}</p>}

      <div className="space-y-1.5">
        {(d?.filas ?? []).slice(0, 200).map((f) => (
          <div key={f.sku} className="rounded-lg border border-border bg-surface-input p-2">
            <div className="flex items-start gap-2.5">
              <FotoInsumo sku={f.sku} tiene={f.foto} version={f.foto_v} tam={52} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5">
                  <code className="text-[12.5px] font-bold text-accent">{f.sku}</code>
                  <span className="text-[13px] font-bold text-ink">{f.nombre}</span>
                  <span className={`rounded-full px-1.5 text-[10px] font-bold ${TONO[f.estado]}`}>{TXT[f.estado]}</span>
                </p>
                {f.existencia != null && f.n_combos === 0 && (
                  <p className="text-[11.5px] text-muted">
                    Producto nuevo en bodega, aún sin combo: la existencia se mantiene hasta que entre en la receta de
                    un combo y este se venda.
                  </p>
                )}
                {f.equivalentes.length > 0 && (
                  <p className="text-[11px] text-muted">Incluye {f.equivalentes.join(", ")} (ya no se compra con ese código)</p>
                )}
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-ink-secondary">
                  <span>Comprado <b className="text-ink">{n(f.comprado)}</b></span>
                  <span>Vendido en combos <b className="text-ink">{n(f.consumido)}</b></span>
                  {f.existencia != null ? (
                    <span>
                      Existencia <b className={f.existencia < 0 ? "text-red-600" : "text-ink"}>{n(f.existencia)} {unidadCorta(f.unidad)}</b>
                      <span className="text-muted"> ({f.existencia_base === "conteo" ? "desde el control del" : "desde el lote del"} {f.existencia_desde})</span>
                    </span>
                  ) : (
                    <span className="text-muted" title="Aún no se registra una compra ni un control de inventario de este SKU">
                      Existencia: sin lote registrado
                    </span>
                  )}
                  <button type="button" onClick={() => setAbierto(abierto === f.sku ? null : f.sku)}
                    className="text-accent underline">
                    {f.n_combos} combo{f.n_combos === 1 ? "" : "s"}
                  </button>
                  {f.ultima_compra && (
                    <span className="text-muted">Última compra {f.ultima_compra.fecha} · {n(f.ultima_compra.cantidad)} · {f.ultima_compra.proveedor}</span>
                  )}
                  <span className="text-muted">
                    {f.conteo ? `Último control ${f.conteo.fecha.slice(0, 10)}: ${n(f.conteo.cantidad)} (${f.conteo.por})` : "Sin control de inventario"}
                  </span>
                </p>
                {abierto === f.sku && (
                  <p className="mt-1 text-[11.5px] text-muted">
                    {f.combos.length ? f.combos.join(" · ") : "No está en la receta de ningún combo activo."}
                  </p>
                )}
              </div>
              <Conteo f={f} />
            </div>
          </div>
        ))}
        {d && d.filas.length > 200 && <p className="text-[12px] text-muted">Mostrando 200 de {d.filas.length}: afina la búsqueda.</p>}
        {d && d.filas.length === 0 && <p className="text-[12.5px] text-muted">Nada con ese filtro.</p>}
      </div>

      {sinResolver.length > 0 && (
        <details className="rounded-lg border border-border p-2 text-[12px] text-muted">
          <summary className="cursor-pointer font-bold">
            {sinResolver.length} SKU vendidos que no se pudieron llevar a insumos
          </summary>
          <p className="mt-1">
            Vendidos desde el corte pero sin receta en la copia local de Alegra (o con otro código): su consumo no
            entra al contador. {sinResolver.map(([s, u]) => `${s} (${n(u)})`).join(" · ")}
          </p>
        </details>
      )}
    </div>
  );
}
