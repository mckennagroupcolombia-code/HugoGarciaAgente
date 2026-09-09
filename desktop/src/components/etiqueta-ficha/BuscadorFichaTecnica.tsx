/**
 * Buscador compacto de fichas técnicas — botón de lupa junto al nombre del
 * producto que abre un desplegable chico (no un panel de pantalla completa)
 * con sugerencias en vivo a medida que se escribe, igual que el buscador de
 * SKU de `BarcodeBlock`. Antes era un panel lateral que se abría solo al
 * enfocar el título: quedaba encima de todo (z-index alto) y bloqueaba el
 * menú de tamaño/fuente del propio título. Ahora es una acción aparte,
 * explícita, que no compite con nada más.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { camposDesdeFichaTecnica, FICHA_SIN_DATO } from "../../lib/etiquetaFormulario";
import type { ProductLabelData } from "./productLabelTypes";

interface FichaItem {
  id: string;
  titulo: string;
  archivo: string;
}

/** `camposDesdeFichaTecnica` habla el vocabulario del Formulario de
 *  etiqueta física (76×66); esta ficha usa nombres en inglés — un solo
 *  mapa entre los dos para no duplicar la lógica de extracción. */
const MAPA_A_PRODUCT_LABEL: Partial<Record<string, keyof ProductLabelData>> = {
  nombre: "productName",
  tagline: "classification",
  concentracionValor: "concentration",
  casNumero: "cas",
  origen: "origin",
  apariencia: "appearance",
  olor: "odor",
  composicion: "composition",
  grado: "grade",
  almacenamiento: "storage",
  peso: "netContent",
  ghs: "ghs",
};

const MAX_SUGERENCIAS = 8;

export default function BuscadorFichaTecnica({
  onAplicar,
}: {
  onAplicar: (patch: Partial<ProductLabelData>) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [fichas, setFichas] = useState<FichaItem[]>([]);
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
    (async () => {
      try {
        const res = await api.get<{ items: FichaItem[] }>("/api/fichas/datos");
        if (!cancel) setFichas(res.items || []);
      } catch (e) {
        if (!cancel) setError(e instanceof Error ? e.message : "No se pudieron cargar las fichas técnicas");
      } finally {
        if (!cancel) setCargando(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [abierto, fichas.length]);

  useEffect(() => {
    if (!abierto) return;
    const onMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setAbierto(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [abierto]);

  const aplicar = async (ficha: FichaItem) => {
    setAplicandoId(ficha.id);
    setError(null);
    try {
      const res = await api.get<{ datos: Record<string, unknown> }>(
        `/api/fichas/datos/${encodeURIComponent(ficha.id)}`,
      );
      const mapeado = camposDesdeFichaTecnica(res.datos || {});
      const patch: Partial<ProductLabelData> = {};
      for (const [origenId, destino] of Object.entries(MAPA_A_PRODUCT_LABEL)) {
        if (!destino) continue;
        const valor = mapeado[origenId];
        const tieneValor = Boolean(valor) && valor !== FICHA_SIN_DATO;
        // Todos los campos de MAPA_A_PRODUCT_LABEL son de texto — el cast
        // evita que TS exija que el valor sea compatible con TODAS las
        // props de ProductLabelData (incluida `logoScale`, numérica) al
        // escribir por una key genérica.
        if (tieneValor) {
          (patch as unknown as Record<keyof ProductLabelData, string>)[destino] = valor as string;
        } else {
          // Sin dato para este campo en la ficha elegida: se deja en
          // blanco (no se conserva texto de otra ficha ni el ejemplo de
          // fábrica, que no corresponde a este producto) para que quede
          // claro qué falta diligenciar a mano.
          (patch as unknown as Record<keyof ProductLabelData, string>)[destino] = "";
        }
      }
      onAplicar(patch);
      setAbierto(false);
      setQ("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la ficha técnica");
    } finally {
      setAplicandoId(null);
    }
  };

  const qNorm = q.trim().toLowerCase();
  const sugeridas = (qNorm ? fichas.filter((f) => f.titulo.toLowerCase().includes(qNorm)) : fichas).slice(
    0,
    MAX_SUGERENCIAS,
  );

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        title="Buscar ficha técnica para autorellenar la etiqueta"
        className="flex h-6 w-6 items-center justify-center rounded border border-[#111111]/15 bg-white text-[11px] text-[#111111]/50 hover:border-[#FFA500] hover:text-[#FFA500]"
      >
        🔍
      </button>

      {abierto && (
        <div
          className="absolute left-1/2 top-full z-[150] mt-1.5 w-72 -translate-x-1/2 rounded-lg border border-border bg-surface-panel p-2.5 text-left shadow-2xl"
          onMouseDown={(e) => e.stopPropagation()}
        >
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
            className="mb-2 w-full rounded-lg border border-border bg-surface-input px-2.5 py-1.5 text-xs"
          />
          {error && <p className="mb-1.5 rounded bg-danger/10 px-2 py-1 text-[11px] text-danger">{error}</p>}
          <ul className="max-h-56 space-y-1 overflow-y-auto">
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
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
