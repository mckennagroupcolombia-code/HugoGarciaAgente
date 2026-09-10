/**
 * Buscador compacto de fichas técnicas — botón de lupa junto al nombre del
 * producto que abre un desplegable chico (no un panel de pantalla completa)
 * con sugerencias en vivo a medida que se escribe, igual que el buscador de
 * SKU de `BarcodeBlock`.
 *
 * Las sugerencias se ordenan por afinidad de PALABRAS CLAVE con lo escrito
 * (ver `lib/fichaTecnicaMatch.ts`), no por subcadena: "PISTACHOS TOSTADOS
 * Kg" encuentra "PISTACHO TOSTADO" aunque no coincida letra a letra. Al
 * abrirse con un código de barras ya elegido, la consulta arranca con el
 * título de ese código (`consultaInicial`).
 */
import { useEffect, useRef, useState } from "react";
import { cargarPatchDesdeFichaTecnica, listarFichasTecnicas, type FichaTecnicaItem } from "../../lib/fichaTecnicaAplicar";
import { ordenarFichasPorConsulta, palabrasClave } from "../../lib/fichaTecnicaMatch";
import type { ProductLabelData } from "./productLabelTypes";
import PopoverFlotante from "./PopoverFlotante";

const MAX_SUGERENCIAS = 8;

export default function BuscadorFichaTecnica({
  onAplicar,
  consultaInicial = "",
}: {
  onAplicar: (patch: Partial<ProductLabelData>) => void;
  /** Texto con el que arranca la búsqueda al abrir (título del código de barras). */
  consultaInicial?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [fichas, setFichas] = useState<FichaTecnicaItem[]>([]);
  const [q, setQ] = useState("");
  const [cargando, setCargando] = useState(false);
  const [aplicandoId, setAplicandoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto || fichas.length > 0) return;
    let cancel = false;
    setCargando(true);
    setError(null);
    listarFichasTecnicas()
      .then((items) => {
        if (!cancel) setFichas(items);
      })
      .catch((e) => {
        if (!cancel) setError(e instanceof Error ? e.message : "No se pudieron cargar las fichas técnicas");
      })
      .finally(() => {
        if (!cancel) setCargando(false);
      });
    return () => {
      cancel = true;
    };
  }, [abierto, fichas.length]);

  const abrir = () => {
    setAbierto((v) => {
      if (!v && !q.trim() && consultaInicial.trim()) setQ(consultaInicial.trim());
      return !v;
    });
  };

  const aplicar = async (ficha: FichaTecnicaItem) => {
    setAplicandoId(ficha.id);
    setError(null);
    try {
      const patch = await cargarPatchDesdeFichaTecnica(ficha.id);
      onAplicar({ ...patch, fichaTecnicaId: ficha.id, fichaTecnicaTitulo: ficha.titulo });
      setAbierto(false);
      setQ("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la ficha técnica");
    } finally {
      setAplicandoId(null);
    }
  };

  const claves = palabrasClave(q);
  const sugeridas = (q.trim() ? ordenarFichasPorConsulta(fichas, q) : fichas).slice(0, MAX_SUGERENCIAS);

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={abrir}
        title="Buscar ficha técnica para autorellenar la etiqueta"
        className="flex h-6 w-6 items-center justify-center rounded border border-[#111111]/15 bg-white text-[11px] text-[#111111]/50 hover:border-[color:var(--acento)] hover:text-[color:var(--acento)]"
      >
        🔍
      </button>

      <PopoverFlotante anchorRef={wrapRef} abierto={abierto} onCerrar={() => setAbierto(false)} alinear="centro" ancho={300}>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-semibold text-ink">Buscar ficha técnica</p>
            <button type="button" onClick={() => setAbierto(false)} className="text-muted hover:text-ink">
              ✕
            </button>
          </div>
          <p className="mb-1.5 text-[11px] text-muted">
            Autorellena origen, apariencia, olor, composición, grado, conservación, pureza, CAS y contenido neto —
            lo que no tenga la ficha elegida queda en blanco.
          </p>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nombre del producto…"
            className="mb-1 w-full rounded-lg border border-border bg-surface-input px-2.5 py-1.5 text-xs"
          />
          {claves.length > 0 && (
            <p className="mb-1.5 text-[10px] text-muted">
              Palabras clave:{" "}
              {claves.map((c) => (
                <span key={c} className="mr-1 rounded bg-accent/10 px-1 py-px font-mono text-accent">
                  {c}
                </span>
              ))}
            </p>
          )}
          {error && <p className="mb-1.5 rounded bg-danger/10 px-2 py-1 text-[11px] text-danger">{error}</p>}
          <ul className="space-y-1">
            {cargando && <li className="px-1 py-1 text-xs text-muted">Cargando…</li>}
            {!cargando && sugeridas.length === 0 && (
              <li className="px-1 py-1 text-xs text-muted">Sin resultados.</li>
            )}
            {sugeridas.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  disabled={aplicandoId === f.id}
                  onClick={() => void aplicar(f)}
                  className="w-full rounded px-2 py-1.5 text-left text-xs text-ink hover:bg-accent/10 disabled:opacity-50"
                >
                  {aplicandoId === f.id ? "Cargando…" : f.titulo}
                  {f.borrador && <span className="ml-1 text-[10px] text-muted">(borrador)</span>}
                </button>
              </li>
            ))}
          </ul>
      </PopoverFlotante>
    </div>
  );
}
