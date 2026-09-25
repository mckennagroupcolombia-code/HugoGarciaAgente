import { useState } from "react";
import { api } from "../../api/client";
import { useAppStore, type Panel } from "../../stores/app";
import { PANEL_INFO } from "../../lib/panelInfo";
import { PIEZAS } from "./piezas";
import { CLASIF, tonoPieza, type FilaSku, type Verificacion } from "./tipos";

const ETAPAS: { id: string; titulo: string }[] = [
  { id: "inventario", titulo: "Inventario" },
  { id: "respaldo", titulo: "Respaldo" },
  { id: "canal", titulo: "Canales" },
  { id: "factura", titulo: "Venta" },
];

const NODO: Record<string, string> = {
  ok: "border-accent-leaf/60 bg-accent-leaf/10",
  aviso: "border-accent-sun/70 bg-accent-sun/10",
  falta: "border-accent-rose/70 border-dashed bg-accent-rose/10",
  na: "border-border border-dashed bg-surface-input opacity-60",
};
const PUNTO: Record<string, string> = {
  ok: "bg-accent-leaf",
  aviso: "bg-accent-sun",
  falta: "bg-accent-rose",
  na: "bg-border",
};

/** Un SKU en todos sus canales, de izquierda a derecha en el orden en que nace el producto.
 *  Solo diagnóstico: cada problema salta al apartado donde se corrige. */
export default function TableroCanales({
  fila, pieza, setPieza, onAnterior, onSiguiente, posicion,
}: {
  fila: FilaSku;
  pieza: string | null;
  setPieza: (p: string | null) => void;
  onAnterior: () => void;
  onSiguiente: () => void;
  posicion: string;
}) {
  const saltarDesdeTaller = useAppStore((s) => s.saltarDesdeTaller);
  const [verif, setVerif] = useState<Verificacion | null>(null);
  const [verificando, setVerificando] = useState(false);
  const cl = CLASIF[fila.clasificacion];
  const sel = PIEZAS.find((p) => p.clave === pieza) ?? null;

  const verificar = async () => {
    setVerificando(true);
    setVerif(null);
    try {
      setVerif(await api.post<Verificacion>(`/api/canales-producto/verificar/${encodeURIComponent(fila.sku)}`));
    } catch (e) {
      setVerif({ ok: false, sku: fila.sku, error: (e as Error).message });
    } finally {
      setVerificando(false);
    }
  };

  const saltar = (panel: string, buscar: string) => {
    saltarDesdeTaller(
      { ref: fila.sku, nombre: fila.nombre, origen: "canales-producto" },
      { panel: panel as Panel, buscar, sku: buscar },
    );
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-2 overflow-y-auto rounded-xl border border-border bg-surface-panel p-3">
      {/* Cabecera del caso */}
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-bold text-ink">{fila.nombre}</h2>
          <code className="text-[11px] text-muted">{fila.sku}</code>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${cl.tono}`} title={cl.ayuda}>{cl.nombre}</span>
        <div className="flex items-center gap-1">
          <button onClick={onAnterior} className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-ink hover:bg-surface-hover" aria-label="SKU anterior">←</button>
          <span className="font-mono text-[10px] text-muted">{posicion}</span>
          <button onClick={onSiguiente} className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-ink hover:bg-surface-hover" aria-label="SKU siguiente">→</button>
        </div>
      </div>

      {fila.motivos.length > 0 && (
        <div className="rounded-lg border border-border bg-surface-input px-3 py-2 text-[12px] text-ink">
          {fila.motivos.map((m) => <p key={m}>{m}</p>)}
        </div>
      )}

      {/* La cadena */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {ETAPAS.map((et, i) => (
          <div key={et.id} className="relative flex flex-col gap-1.5 rounded-lg border border-border/60 bg-surface p-2">
            <p className="font-mono text-[9.5px] font-bold uppercase tracking-wide text-muted">{i + 1} · {et.titulo}</p>
            {PIEZAS.filter((p) => p.etapa === et.id).map((p) => {
              const tono = tonoPieza(p.estado(fila));
              const activa = pieza === p.clave;
              return (
                <button
                  key={p.clave}
                  onClick={() => setPieza(activa ? null : p.clave)}
                  aria-pressed={activa}
                  className={`mck-flujo-nodo mck-btn-no-fx flex items-start gap-2 rounded-md border px-2 py-1.5 text-left transition ${NODO[tono]} ${activa ? "ring-2 ring-accent" : ""}`}
                >
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${PUNTO[tono]}`} />
                  <span className="min-w-0">
                    <span className="block text-[11.5px] font-bold text-ink">{p.titulo}</span>
                    <span className="block text-[10.5px] leading-snug text-ink-secondary">{p.texto(fila)}</span>
                  </span>
                </button>
              );
            })}
            {i < ETAPAS.length - 1 && (
              <span aria-hidden="true" className="absolute -right-2 top-1/2 z-10 hidden -translate-y-1/2 text-[12px] text-muted md:block">⇢</span>
            )}
          </div>
        ))}
      </div>

      {/* Detalle de la pieza tocada */}
      {sel && (
        <div className="rounded-lg border border-accent/40 bg-accent/5 px-3 py-2 text-[12px] text-ink">
          <p className="font-bold">{sel.titulo}</p>
          <p className="text-ink-secondary">{sel.texto(fila)}</p>
          {sel.clave === "meli" && fila.canales.meli.permalink && (
            <a href={fila.canales.meli.permalink} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[11px] font-bold text-accent underline">
              Ver la publicación {fila.canales.meli.meli_id} ↗
            </a>
          )}
          {sel.clave === "web" && fila.canales.web.stock != null && (
            <p className="mt-1 text-[11px] text-muted">Stock en la web: {fila.canales.web.stock}</p>
          )}
        </div>
      )}

      {/* Facturación en vivo: la única consulta a Alegra de este panel */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
        <button
          onClick={verificar}
          disabled={verificando}
          className="rounded-md border border-accent bg-accent/15 px-2 py-1 text-[11px] font-bold text-ink hover:bg-accent/25 disabled:opacity-50"
          title="Pregunta a Alegra lo mismo que preguntaría la facturación de una venta con este SKU"
        >
          {verificando ? "Preguntando a Alegra…" : "Verificar facturación en vivo"}
        </button>
        {verif && (
          <span className={`text-[11.5px] ${verif.ok && verif.facturable ? "text-accent-leaf" : "text-accent-rose"}`}>
            {verif.error ? `No se pudo consultar: ${verif.error}` : verif.mensaje}
          </span>
        )}
      </div>

      {/* Dónde se corrige: solo navegación, este panel no escribe */}
      {fila.saltos.length > 0 && (
        <div className="rounded-lg border border-border bg-surface px-3 py-2">
          <p className="mb-1.5 font-mono text-[9.5px] font-bold uppercase tracking-wide text-muted">Dónde se corrige</p>
          <div className="flex flex-wrap gap-1.5">
            {fila.saltos.map((s) => (
              <button
                key={`${s.panel}-${s.motivo}`}
                onClick={() => saltar(s.panel, s.buscar)}
                className="mck-flujo-nodo rounded-md border border-border bg-surface-input px-2 py-1 text-[11px] text-ink hover:border-accent/60"
              >
                <span className="font-bold">{PANEL_INFO[s.panel as Panel]?.label ?? s.panel}</span>
                <span className="text-ink-secondary"> — {s.motivo} →</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
