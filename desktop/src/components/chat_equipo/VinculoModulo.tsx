import { useEffect, useState } from "react";
import { useAppStore, type Panel } from "../../stores/app";
import { useBuscarVinculos, type ModuloCanal, type RefMensaje } from "../../hooks/useCanalesEquipo";

/**
 * Grupos de trabajo: un mensaje puede vincular un elemento real de un módulo
 * (documento técnico, fórmula, solicitud de pago, importación, guía).
 * Back: app/services/canales_vinculos.py.
 */

/** Enlace dentro de una burbuja: abre el módulo donde vive el elemento. */
export function ChipVinculo({ refm, modulos }: { refm: Record<string, unknown> | null; modulos: ModuloCanal[] }) {
  const setPanel = useAppStore((s) => s.setPanel);
  if (!refm) return null;
  let etiqueta = "";
  let titulo = "";
  let detalle = "";
  let panel = "";
  if (typeof refm.modulo === "string") {
    const mod = modulos.find((m) => m.clave === refm.modulo);
    etiqueta = mod?.item || "Enlace";
    titulo = String(refm.titulo || refm.id || "");
    detalle = String(refm.detalle || "");
    panel = mod?.panel || "";
  } else if (refm.recepcion_id != null) {
    // Avisos automáticos de recepción de mercancía (recepcion_mercancia.py).
    etiqueta = "Recepción";
    titulo = `#${String(refm.recepcion_id)}`;
    panel = "recepcion-mercancia";
  } else {
    return null;
  }
  return (
    <button
      type="button"
      onClick={() => panel && setPanel(panel as Panel)}
      disabled={!panel}
      title={panel ? `Abrir ${etiqueta.toLowerCase()} en su módulo` : undefined}
      className="mck-btn-no-fx mt-1 flex w-full max-w-[340px] items-start gap-2 rounded-lg border border-accent/40 bg-surface px-2 py-1.5 text-left hover:border-accent"
    >
      <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide text-accent">{etiqueta}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-bold text-ink">{titulo}</span>
        {detalle && <span className="block truncate text-[10.5px] text-muted">{detalle}</span>}
      </span>
      {panel && <span className="shrink-0 text-[12px] text-accent">→</span>}
    </button>
  );
}

/** Buscador para elegir qué vincular: arranca en el módulo del grupo. */
export function SelectorVinculo({
  modulos, moduloInicial, onElegir, onCerrar,
}: {
  modulos: ModuloCanal[];
  moduloInicial: string | null;
  onElegir: (r: RefMensaje) => void;
  onCerrar: () => void;
}) {
  const [modulo, setModulo] = useState(moduloInicial || modulos[0]?.clave || "");
  const [q, setQ] = useState("");
  const [qDeb, setQDeb] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQDeb(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const res = useBuscarVinculos(modulo, qDeb);
  const items = res.data?.items ?? [];

  return (
    <div className="mb-2 rounded-lg border border-accent/40 bg-surface-input p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <select value={modulo} onChange={(e) => setModulo(e.target.value)} aria-label="Módulo"
          className="rounded-md border border-border bg-surface px-2 py-1 text-[12px]">
          {modulos.map((m) => <option key={m.clave} value={m.clave}>{m.nombre}</option>)}
        </select>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, número o proveedor…"
          className="min-w-[160px] flex-1 rounded-md border border-border bg-surface px-2 py-1 text-[12px]" />
        <button type="button" onClick={onCerrar} className="rounded px-2 text-[12px] text-muted hover:text-ink" aria-label="Cerrar">✕</button>
      </div>
      <div className="mt-1.5 max-h-48 space-y-1 overflow-y-auto">
        {res.isLoading && <p className="px-1 text-[11.5px] text-muted">Buscando…</p>}
        {res.error && <p className="px-1 text-[11.5px] text-accent-rose">{(res.error as Error).message}</p>}
        {!res.isLoading && !res.error && items.length === 0 && (
          <p className="px-1 text-[11.5px] text-muted">{qDeb ? "Nada coincide con esa búsqueda." : "No hay elementos en este módulo."}</p>
        )}
        {items.map((it) => (
          <button key={it.id} type="button"
            onClick={() => onElegir({ modulo, id: it.id, titulo: it.titulo, detalle: it.detalle })}
            className="mck-btn-no-fx block w-full rounded-md border border-border bg-surface px-2 py-1 text-left hover:border-accent/60">
            <span className="block truncate text-[12px] font-bold text-ink">{it.titulo}</span>
            {it.detalle && <span className="block truncate text-[10.5px] text-muted">{it.detalle}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
