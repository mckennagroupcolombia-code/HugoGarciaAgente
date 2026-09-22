import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { BTN, BTN_SEC, type MateriaPrima } from "./comun";

/**
 * Buscar un documento técnico y asociarlo a la materia prima de un combo.
 *
 * Una sola pieza para los dos sitios donde hace falta: el inspector del taller de combos y la
 * biblioteca de Docs técnicos cuando se llega desde un producto (antes esa biblioteca solo
 * listaba PDF y no había cómo decir «este es el documento de aquel combo»).
 *
 * El documento es de la MATERIA PRIMA: al asociarlo, todas las presentaciones que la usan lo
 * heredan. Escribe por POST /api/mapa-sistema/documentos/fijar-sku (una línea del YAML, con
 * respaldo): corrige una referencia caduca y solo comparte un documento si se confirma.
 */

export type DocLista = { archivo: string; titulo: string; estado: string; referencia: string; equivalentes: string[] };

export default function EnlazarDocumento({
  mps,
  inicial = "",
  etiquetaBoton = "Asociar",
  onHecho,
  onCancelar,
}: {
  mps: MateriaPrima[];
  /** Texto con el que abre el buscador (el nombre de la materia prima, normalmente). */
  inicial?: string;
  etiquetaBoton?: string;
  onHecho: (r: { titulo: string; sku: string; archivo: string }) => void | Promise<void>;
  onCancelar?: () => void;
}) {
  const qc = useQueryClient();
  const [q, setQ] = useState(inicial);
  const [sku, setSku] = useState(mps[0]?.codigo ?? "");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compartir, setCompartir] = useState<string | null>(null); // archivo que pidió confirmación para compartirse
  useEffect(() => setSku((v) => v || mps[0]?.codigo || ""), [mps]);

  const lista = useQuery({
    queryKey: ["mision-documentos", q],
    queryFn: () => api.get<{ documentos: DocLista[] }>(`/api/mapa-sistema/documentos?q=${encodeURIComponent(q)}`),
    staleTime: 60_000,
  });

  const asociar = async (d: DocLista) => {
    setOcupado(d.archivo);
    setError(null);
    try {
      const r = await api.post<{ ok: boolean; errores: { error: string }[] }>("/api/mapa-sistema/documentos/fijar-sku", {
        items: [{ archivo: d.archivo, sku, compartir: compartir === d.archivo }],
      });
      if (!r.ok) {
        const msg = r.errores[0]?.error || "No se pudo asociar";
        if (/otro producto activo/.test(msg)) setCompartir(d.archivo);
        throw new Error(msg);
      }
      setCompartir(null);
      await api.post("/api/mapa-sistema/invalidar").catch(() => null);
      await qc.invalidateQueries({ queryKey: ["mapa-sistema-combos"] });
      await qc.invalidateQueries({ queryKey: ["mision-documentos"] });
      await qc.invalidateQueries({ queryKey: ["mapa-app-bloqueos"] });
      await onHecho({ titulo: d.titulo, sku, archivo: d.archivo });
    } catch (err) {
      setError((err as Error)?.message || "No se pudo asociar");
    } finally {
      setOcupado(null);
    }
  };

  if (!mps.length)
    return <p className="rounded-md border border-accent-sun/60 bg-accent-sun/10 p-2 text-[11px] text-ink">Este combo no tiene una materia prima reconocible en su receta, y el documento se asocia a la materia prima. Primero hay que arreglar la receta del kit en Alegra.</p>;

  const mp = mps.find((m) => m.codigo === sku) ?? mps[0];
  return (
    <div className="space-y-2">
      {mps.length > 1 ? (
        <label className="block text-[10px] font-bold uppercase tracking-wide text-muted">
          ¿De cuál materia prima es el documento?
          <select className="mt-0.5 w-full rounded-md border border-border bg-surface-input px-2 py-1 text-[12px] font-normal normal-case text-ink" value={sku} onChange={(ev) => setSku(ev.target.value)}>
            {mps.map((m) => <option key={m.codigo} value={m.codigo}>{m.nombre} · {m.codigo}</option>)}
          </select>
        </label>
      ) : (
        <p className="text-[11px] text-muted">Se asocia a su materia prima: ⚗️ <b className="text-ink">{mp.nombre}</b> <code>{mp.codigo}</code></p>
      )}
      <input value={q} onChange={(ev) => { setQ(ev.target.value); setCompartir(null); setError(null); }} placeholder="Buscar el documento por nombre o SKU…" className="w-full rounded-md border border-border bg-surface-input px-2 py-1.5 text-[12px] text-ink" />
      <div className="max-h-60 space-y-1 overflow-y-auto">
        {lista.isLoading && <p className="text-[11px] text-muted">Buscando…</p>}
        {lista.isError && <p className="text-[11px] text-accent-rose">{(lista.error as Error)?.message}</p>}
        {(lista.data?.documentos ?? []).map((d) => {
          const yaEs = [d.referencia, ...d.equivalentes].some((x) => x && x.toLowerCase() === sku.toLowerCase());
          return (
            <div key={d.archivo} className="flex items-center gap-2 rounded-md border border-border bg-surface-input px-2 py-1">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11.5px] font-semibold text-ink">{d.titulo}</span>
                <span className="block truncate font-mono text-[9.5px] text-muted">{d.estado}{d.referencia ? ` · ${[d.referencia, ...d.equivalentes].join(", ")}` : " · sin SKU"}</span>
              </span>
              {yaEs ? (
                <span className="shrink-0 font-mono text-[10px] font-bold text-accent-leaf">ya asociado</span>
              ) : (
                <button className={BTN} disabled={ocupado !== null} onClick={() => asociar(d)}>
                  {ocupado === d.archivo ? "Asociando…" : compartir === d.archivo ? "Sí, compartirlo" : etiquetaBoton}
                </button>
              )}
            </div>
          );
        })}
        {lista.data && lista.data.documentos.length === 0 && <p className="text-[11px] text-muted">Ningún documento coincide. Si de verdad no existe, hay que redactarlo.</p>}
      </div>
      {error && <p className="text-[11px] text-accent-rose">{error}{compartir ? " Si son la misma sustancia, pulsa «Sí, compartirlo» en ese documento." : ""}</p>}
      {onCancelar && <button className={BTN_SEC} onClick={onCancelar}>Cancelar</button>}
    </div>
  );
}
