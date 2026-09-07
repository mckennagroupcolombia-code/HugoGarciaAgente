/**
 * Formulario lateral: edita solo el `content` de las cajas con `campoProducto`.
 * No mueve x/y/width/height. Carga opcional desde fichas técnicas.
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import {
  aplicarCamposAPlantilla,
  camposDesdeFichaTecnica,
  camposUsadosEnPlantilla,
  labelCampoEtiqueta,
  valoresActualesFormulario,
} from "../../lib/etiquetaFormulario";
import type { PlantillaVisualDoc } from "../../lib/plantillasVisuales";

interface FichaItem {
  id: string;
  titulo: string;
  archivo: string;
}

export default function FormularioEtiquetaPanel({
  doc,
  onChange,
}: {
  doc: PlantillaVisualDoc;
  onChange: (doc: PlantillaVisualDoc) => void;
}) {
  const campos = useMemo(() => camposUsadosEnPlantilla(doc), [doc]);
  const valores = useMemo(() => valoresActualesFormulario(doc), [doc]);
  const [fichas, setFichas] = useState<FichaItem[]>([]);
  const [fichaId, setFichaId] = useState("");
  const [cargando, setCargando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await api.get<{ items: FichaItem[] }>("/api/fichas/datos");
        if (!cancel) setFichas(res.items || []);
      } catch {
        if (!cancel) setFichas([]);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  if (campos.length === 0) return null;

  const patchCampo = (campo: string, valor: string) => {
    onChange(aplicarCamposAPlantilla(doc, { [campo]: valor }));
  };

  const cargarFicha = async () => {
    if (!fichaId) return;
    setCargando(true);
    setMsg(null);
    try {
      const res = await api.get<{ datos: Record<string, unknown> }>(
        `/api/fichas/datos/${encodeURIComponent(fichaId)}`,
      );
      const mapped = camposDesdeFichaTecnica(res.datos || {});
      const usados = Object.fromEntries(
        Object.entries(mapped).filter(([k]) => campos.includes(k as (typeof campos)[number])),
      );
      if (!Object.keys(usados).length) {
        setMsg("Esa ficha no tiene datos mapeables a esta etiqueta.");
        return;
      }
      onChange(aplicarCamposAPlantilla(doc, usados));
      setMsg(`Cargados ${Object.keys(usados).length} campos. El formato no se movió.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "No se pudo cargar la ficha");
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-accent/30 bg-accent/5 p-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-accent">Formulario de etiqueta</p>
        <p className="mt-0.5 text-[10px] leading-snug text-muted">
          Cada caja queda en su sitio. Un texto más largo reduce la fuente (autofit); no se
          sobrepone.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="block text-[10px] font-medium text-muted">Cargar ficha técnica</label>
        <div className="flex gap-1">
          <select
            value={fichaId}
            onChange={(e) => setFichaId(e.target.value)}
            className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 text-[11px]"
          >
            <option value="">Elegir ficha…</option>
            {fichas.map((f) => (
              <option key={f.id} value={f.id}>
                {f.titulo}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!fichaId || cargando}
            onClick={() => void cargarFicha()}
            className="shrink-0 rounded border border-accent/40 bg-accent/10 px-2 py-1 text-[10px] font-semibold text-accent hover:bg-accent/20 disabled:opacity-40"
          >
            {cargando ? "…" : "Cargar"}
          </button>
        </div>
        {fichas.length === 0 && (
          <p className="text-[10px] text-muted">No hay fichas en Documentos técnicos aún.</p>
        )}
      </div>

      {msg && <p className="text-[10px] leading-snug text-ink">{msg}</p>}

      <div className="space-y-2">
        {campos.map((campo) => {
          const largo = ["apariencia", "composicion", "almacenamiento", "nombre", "tagline"].includes(
            campo,
          );
          return (
            <label key={campo} className="block">
              <span className="text-[10px] font-medium text-muted">{labelCampoEtiqueta(campo)}</span>
              {largo ? (
                <textarea
                  rows={campo === "nombre" ? 2 : 3}
                  value={valores[campo] ?? ""}
                  onChange={(e) => patchCampo(campo, e.target.value)}
                  className="mt-0.5 w-full resize-y rounded border border-border bg-surface px-2 py-1 text-[11px] leading-snug"
                />
              ) : (
                <input
                  type="text"
                  value={valores[campo] ?? ""}
                  onChange={(e) => patchCampo(campo, e.target.value)}
                  className="mt-0.5 w-full rounded border border-border bg-surface px-2 py-1 text-[11px]"
                />
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}
