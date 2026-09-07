/**
 * Aplica una plantilla de ficha MP a varios SKUs de una sola vez, vía
 * POST /api/plantillas-visuales/aplicar-lote (motor backend con autofit:
 * el mismo que usa Diligenciar etiqueta al exportar, ver
 * FichaMpDiligenciarPanel.tsx::rasterizar). Reemplaza "repetir el
 * formulario a mano por producto", que era como se rompían los formatos.
 */
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import {
  CAMPOS_PRODUCTO_FIJOS_MARCA,
  CAMPOS_TEXTO_FICHA_MP,
  contenidoCampoProductoFichaMp,
  fusionarDatosFichaMp,
  parsearFichaMpDePlantilla,
  type CampoTextoFichaMp,
  type DatosFichaTecnicaMp,
} from "../../lib/plantillaFichaTecnicaMp";
import type { PlantillaVisualDoc } from "../../lib/plantillasVisuales";

/** Campo de la tabla de lote → campo de `DatosFichaTecnicaMp` que alimenta
 *  (los compuestos como concentración/CAS/destacados se resuelven aparte). */
const CAMPO_A_DATOS: Partial<Record<CampoTextoFichaMp, keyof DatosFichaTecnicaMp>> = {
  abreviatura: "abreviatura",
  nombre: "nombre",
  tagline: "tagline",
  concentracion: "concentracionValor",
  concentracionValor: "concentracionValor",
  cas: "cas",
  casNumero: "cas",
  descripcion: "descripcion",
  aplicaciones: "aplicaciones",
  incorporacion: "incorporacion",
  peso: "peso",
  atencion: "atencionTexto",
  almacenamiento: "almacenamiento",
  origen: "origen",
  apariencia: "apariencia",
  olor: "olor",
  composicion: "composicion",
  grado: "grado",
  ghs: "ghs",
};

interface FilaLote {
  sku: string;
  valores: Partial<Record<CampoTextoFichaMp, string>>;
}

function filaVacia(): FilaLote {
  return { sku: "", valores: {} };
}

interface ResultadoLote {
  sku: string | null;
  ok: boolean;
  ruta?: string;
  requiere_revision?: boolean;
  motivo?: string | null;
}

export default function AplicarLotePanel({
  plantillaId,
  nombrePlantilla,
  onVolver,
}: {
  plantillaId: string;
  nombrePlantilla: string;
  onVolver: () => void;
}) {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [datosBase, setDatosBase] = useState<DatosFichaTecnicaMp | null>(null);
  const [camposDisponibles, setCamposDisponibles] = useState<CampoTextoFichaMp[]>([]);
  const [filas, setFilas] = useState<FilaLote[]>([filaVacia(), filaVacia(), filaVacia()]);
  const [aplicando, setAplicando] = useState(false);
  const [resultados, setResultados] = useState<ResultadoLote[] | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      setCargando(true);
      setError(null);
      try {
        const res = await api.get<{ plantilla: PlantillaVisualDoc }>(
          `/api/plantillas-visuales/${plantillaId}`,
        );
        if (cancelado) return;
        const usados = new Set<CampoTextoFichaMp>();
        for (const el of res.plantilla.elementos || []) {
          if (el.type === "text" && el.campoProducto) {
            usados.add(el.campoProducto as CampoTextoFichaMp);
          }
        }
        if (usados.size === 0) {
          setError("Esta plantilla no tiene campos de producto — no se puede aplicar en lote.");
          return;
        }
        const parsed = parsearFichaMpDePlantilla(res.plantilla);
        setDatosBase(parsed?.datos ?? fusionarDatosFichaMp());
        const todos = CAMPOS_TEXTO_FICHA_MP.map((c) => c.id).filter(
          (id) => !CAMPOS_PRODUCTO_FIJOS_MARCA.includes(id),
        );
        const disponibles = todos.filter((id) => usados.has(id));
        setCamposDisponibles(disponibles.length ? disponibles : todos);
      } catch (e) {
        if (!cancelado) setError(e instanceof Error ? e.message : "No se pudo cargar la plantilla");
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [plantillaId]);

  const patchValor = (i: number, campo: CampoTextoFichaMp, valor: string) => {
    setFilas((prev) =>
      prev.map((f, idx) => (idx === i ? { ...f, valores: { ...f.valores, [campo]: valor } } : f)),
    );
  };
  const patchSku = (i: number, sku: string) => {
    setFilas((prev) => prev.map((f, idx) => (idx === i ? { ...f, sku } : f)));
  };
  const agregarFila = () => setFilas((prev) => [...prev, filaVacia()]);
  const quitarFila = (i: number) => setFilas((prev) => prev.filter((_, idx) => idx !== i));

  const aplicar = async () => {
    if (!datosBase) return;
    const validas = filas.filter((f) => f.sku.trim());
    if (!validas.length) {
      setError("Agrega al menos un SKU.");
      return;
    }
    setAplicando(true);
    setError(null);
    setResultados(null);
    try {
      const productos = validas.map((f) => {
        const parcial: Partial<DatosFichaTecnicaMp> = {};
        for (const [campo, campoDatos] of Object.entries(CAMPO_A_DATOS) as [
          CampoTextoFichaMp,
          keyof DatosFichaTecnicaMp,
        ][]) {
          const v = f.valores[campo];
          if (v !== undefined && v !== "") {
            (parcial as Record<string, unknown>)[campoDatos] = v;
          }
        }
        if (
          f.valores.feat0 !== undefined ||
          f.valores.feat1 !== undefined ||
          f.valores.feat2 !== undefined
        ) {
          parcial.features = datosBase.features.map((feat, idx) => ({
            ...feat,
            titulo: f.valores[`feat${idx}` as CampoTextoFichaMp] ?? feat.titulo,
          }));
        }
        const datosCompletos = fusionarDatosFichaMp({ ...datosBase, ...parcial });
        const valoresFinales: Record<string, string> = {};
        for (const campo of camposDisponibles) {
          valoresFinales[campo] = contenidoCampoProductoFichaMp(campo, datosCompletos);
        }
        return { sku: f.sku.trim(), datos: valoresFinales };
      });
      const res = await api.post<{
        ok: boolean;
        resultados: ResultadoLote[];
        total: number;
        exitosos: number;
        con_revision: number;
      }>("/api/plantillas-visuales/aplicar-lote", { plantilla_id: plantillaId, productos });
      setResultados(res.resultados);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo aplicar el lote");
    } finally {
      setAplicando(false);
    }
  };

  const labelCampo = (id: CampoTextoFichaMp) =>
    CAMPOS_TEXTO_FICHA_MP.find((c) => c.id === id)?.label || id;

  return (
    <div className="mx-auto flex h-full max-w-6xl min-h-0 flex-col p-4">
      <header className="mb-3 flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={onVolver}
          className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface-hover hover:text-ink"
        >
          ← Volver
        </button>
        <div>
          <h2 className="text-base font-bold text-ink">Aplicar en lote · {nombrePlantilla}</h2>
          <p className="text-xs text-muted">
            Un SKU por fila. Los campos vacíos conservan el valor de la plantilla base.
          </p>
        </div>
      </header>

      {error && (
        <p className="mb-3 shrink-0 rounded-lg border border-red-300/40 bg-red-500/10 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {cargando ? (
        <p className="text-sm text-muted">Cargando plantilla…</p>
      ) : datosBase ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-surface-panel">
                <tr>
                  <th className="border-b border-border px-2 py-2 text-left font-semibold text-ink">SKU</th>
                  {camposDisponibles.map((campo) => (
                    <th
                      key={campo}
                      className="border-b border-border px-2 py-2 text-left font-semibold text-ink"
                    >
                      {labelCampo(campo)}
                    </th>
                  ))}
                  <th className="border-b border-border px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {filas.map((fila, i) => (
                  <tr key={i} className="odd:bg-surface even:bg-surface-panel">
                    <td className="border-b border-border px-2 py-1.5">
                      <input
                        value={fila.sku}
                        onChange={(e) => patchSku(i, e.target.value)}
                        placeholder="SKU / código Siigo"
                        className="w-32 rounded border border-border bg-surface-input px-2 py-1 text-xs"
                      />
                    </td>
                    {camposDisponibles.map((campo) => (
                      <td key={campo} className="border-b border-border px-2 py-1.5">
                        <input
                          value={fila.valores[campo] ?? ""}
                          onChange={(e) => patchValor(i, campo, e.target.value)}
                          className="w-40 rounded border border-border bg-surface-input px-2 py-1 text-xs"
                        />
                      </td>
                    ))}
                    <td className="border-b border-border px-2 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => quitarFila(i)}
                        className="text-[11px] text-red-500 hover:text-red-700"
                      >
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={agregarFila}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-hover"
            >
              + Agregar fila
            </button>
            <button
              type="button"
              onClick={() => void aplicar()}
              disabled={aplicando}
              className="ml-auto rounded-lg bg-accent px-4 py-1.5 text-xs font-bold text-white shadow hover:opacity-90 disabled:opacity-50"
            >
              {aplicando ? "Aplicando…" : `Aplicar a ${filas.filter((f) => f.sku.trim()).length} producto(s)`}
            </button>
          </div>

          {resultados && (
            <div className="shrink-0 space-y-1 overflow-auto rounded-xl border border-border p-3 text-xs">
              <p className="mb-1 font-semibold text-ink">
                {resultados.filter((r) => r.ok).length}/{resultados.length} generados
                {resultados.some((r) => r.requiere_revision) &&
                  ` · ${resultados.filter((r) => r.requiere_revision).length} requieren revisión`}
              </p>
              {resultados.map((r, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-2 rounded px-2 py-1 ${
                    !r.ok
                      ? "bg-red-500/10 text-red-600"
                      : r.requiere_revision
                        ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  }`}
                >
                  <span className="font-semibold">{r.sku ?? "?"}</span>
                  <span>
                    {!r.ok
                      ? `✕ ${r.motivo || "error"}`
                      : r.requiere_revision
                        ? `⚠ requiere revisión — ${r.motivo || "el texto no cabe ni al tamaño mínimo"}`
                        : `✓ ${r.ruta}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
