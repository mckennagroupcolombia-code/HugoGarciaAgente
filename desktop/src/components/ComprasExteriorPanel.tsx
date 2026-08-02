import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";

type LineaEditable = {
  id: string;
  seleccionada: boolean;
  nombre: string;
  cantidad: number;
  unidad: string;
  precio_unit: number;
  subtotal: number;
  categoria: string;
  costo_unitario_cop: number | null;
};

type LineaApi = {
  id?: string;
  nombre: string;
  cantidad: number;
  unidad: string;
  precio_unit: number;
  subtotal: number;
  costo_unitario_cop?: number | null;
};

type ExtractResp = {
  moneda: string;
  proveedor?: string;
  referencia?: string;
  flete_detectado?: number | null;
  moneda_flete_detectada?: string | null;
  lineas: LineaApi[];
  lineas_landed?: LineaApi[];
  error?: string;
};

function n(v: unknown, fallback = 0): number {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", ""));
  return Number.isFinite(x) ? x : fallback;
}

/** Misma fórmula que el backend: prorrateo de flete por valor de línea. */
export function calcularLandedCliente(
  lineas: Array<Pick<LineaEditable, "cantidad" | "precio_unit" | "subtotal">>,
  opts: { trm: number; flete: number; moneda: string; monedaFlete: string },
): number[] {
  const mon = (opts.moneda || "USD").toUpperCase();
  const monF = (opts.monedaFlete || mon).toUpperCase();
  const rate = mon === "COP" ? 1 : Math.max(opts.trm, 0);
  let fleteCop = 0;
  if (opts.flete > 0) {
    if (monF === "COP") fleteCop = opts.flete;
    else fleteCop = opts.flete * (monF === "COP" ? 1 : rate || 0);
  }
  const suma = lineas.reduce((a, l) => a + Math.max(l.subtotal, 0), 0);
  return lineas.map((l) => {
    const cantidad = Math.max(l.cantidad, 0) || 1;
    const peso = suma > 0 ? Math.max(l.subtotal, 0) / suma : 1 / (lineas.length || 1);
    const base = l.precio_unit * (mon === "COP" ? 1 : rate);
    const fleteUnit = fleteCop > 0 ? (fleteCop * peso) / cantidad : 0;
    return Math.round((base + fleteUnit) * 1e4) / 1e4;
  });
}

function fmtCop(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 2,
  }).format(v);
}

export default function ComprasExteriorPanel() {
  const [scanning, setScanning] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [moneda, setMoneda] = useState("USD");
  const [trm, setTrm] = useState("");
  const [flete, setFlete] = useState("");
  const [monedaFlete, setMonedaFlete] = useState("USD");
  const [proveedor, setProveedor] = useState("");
  const [lineas, setLineas] = useState<LineaEditable[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const zonaRef = useRef<HTMLDivElement>(null);

  const trmNum = n(trm);
  const fleteNum = n(flete);
  const necesitaTrm = moneda.toUpperCase() !== "COP";

  const costosRecalc = useMemo(() => {
    if (!lineas.length) return [] as number[];
    if (necesitaTrm && trmNum <= 0) return lineas.map(() => NaN);
    return calcularLandedCliente(lineas, {
      trm: necesitaTrm ? trmNum : 1,
      flete: fleteNum,
      moneda,
      monedaFlete,
    });
  }, [lineas, trmNum, fleteNum, moneda, monedaFlete, necesitaTrm]);

  useEffect(() => {
    if (!lineas.length) return;
    setLineas((prev) =>
      prev.map((l, i) => {
        const c = costosRecalc[i];
        const next = Number.isFinite(c) ? c : null;
        if (l.costo_unitario_cop === next) return l;
        return { ...l, costo_unitario_cop: next };
      }),
    );
    // Solo cuando cambian los inputs de cálculo; no re-entrar por lineas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [costosRecalc]);

  const aplicarExtract = useCallback((json: ExtractResp) => {
    const mon = (json.moneda || "USD").toUpperCase();
    setMoneda(mon);
    setMonedaFlete((json.moneda_flete_detectada || mon).toUpperCase());
    setProveedor(json.proveedor || "");
    if (json.flete_detectado != null && json.flete_detectado > 0) {
      setFlete(String(json.flete_detectado));
    }
    const src = json.lineas_landed?.length ? json.lineas_landed : json.lineas;
    setLineas(
      (src || []).map((l, i) => ({
        id: l.id || `L${i + 1}`,
        seleccionada: true,
        nombre: l.nombre,
        cantidad: n(l.cantidad, 1),
        unidad: l.unidad || "un",
        precio_unit: n(l.precio_unit),
        subtotal: n(l.subtotal) || n(l.cantidad, 1) * n(l.precio_unit),
        categoria: "material",
        costo_unitario_cop:
          l.costo_unitario_cop != null && Number.isFinite(l.costo_unitario_cop)
            ? Number(l.costo_unitario_cop)
            : null,
      })),
    );
  }, []);

  const enviar = async (file: File, opts?: { trm?: string; flete?: string; monedaFlete?: string }) => {
    setError(null);
    setOkMsg(null);
    setScanning(true);
    try {
      const fd = new FormData();
      fd.append("imagen", file);
      const t = opts?.trm ?? trm;
      const f = opts?.flete ?? flete;
      const mf = opts?.monedaFlete ?? monedaFlete;
      if (t.trim()) fd.append("trm", t.trim());
      if (f.trim()) fd.append("flete", f.trim());
      if (mf.trim()) fd.append("moneda_flete", mf.trim());
      const json = await api.upload<ExtractResp>("/api/rentabilidad/extraer-compra-imagen", fd);
      if (json.error) throw new Error(json.error);
      aplicarExtract(json);
      setOkMsg(`Extraídas ${json.lineas?.length ?? 0} líneas. Revisa TRM/flete y confirma.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  const fromFile = (file: File) => {
    setOkMsg(null);
    setError(null);
    if (file.type.startsWith("image/")) {
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(file));
    } else {
      setPreview(null);
    }
    setFileName(file.name);
    void enviar(file);
  };

  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            fromFile(file);
            e.preventDefault();
          }
          break;
        }
      }
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const limpiar = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setFileName(null);
    setLineas([]);
    setOkMsg(null);
    setError(null);
    setProveedor("");
  };

  const patchLinea = (id: string, patch: Partial<LineaEditable>) => {
    setLineas((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, ...patch };
        if (patch.cantidad != null || patch.precio_unit != null) {
          next.subtotal = Math.round(next.cantidad * next.precio_unit * 1e6) / 1e6;
        }
        return next;
      }),
    );
  };

  const seleccionadas = lineas.filter((l) => l.seleccionada);
  const puedenGuardar =
    seleccionadas.length > 0 &&
    seleccionadas.every((l) => l.nombre.trim() && l.costo_unitario_cop != null && l.costo_unitario_cop >= 0) &&
    (!necesitaTrm || trmNum > 0);

  const guardar = async () => {
    if (!puedenGuardar) return;
    setGuardando(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await api.post<{
        ok: boolean;
        total: number;
        errores: Array<{ nombre: string; error: string }>;
      }>("/api/rentabilidad/confirmar-compra-exterior", {
        items: seleccionadas.map((l) => ({
          nombre: l.nombre.trim(),
          costo_unitario: l.costo_unitario_cop,
          categoria: l.categoria || "material",
          iva_incluido: false,
        })),
      });
      if (res.errores?.length) {
        setError(
          `Guardados ${res.total}. Errores: ${res.errores.map((e) => `${e.nombre}: ${e.error}`).join("; ")}`,
        );
      } else {
        setOkMsg(`Guardados ${res.total} costos en Rentabilidad (sin IVA).`);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  };

  const esValido = (f: File) => f.type.startsWith("image/") || f.type === "application/pdf";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-ink">Compras exterior</h2>
        <p className="text-sm text-muted">
          Pega o sube un pantallazo de compra/cotización en el exterior. La IA extrae líneas; tú
          ajustas TRM y flete opcional (prorrateado por valor) y guardas el costo unitario COP en
          Rentabilidad.
        </p>
      </div>

      <div
        ref={zonaRef}
        className="rounded-xl border border-dashed border-accent/50 bg-accent/5 p-3 space-y-2"
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f && esValido(f)) fromFile(f);
        }}
        onDragOver={(e) => e.preventDefault()}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-medium text-accent">Pantallazo de compra</p>
            <p className="text-[10px] text-muted">Ctrl+V, arrastra o adjunta imagen/PDF</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={scanning}
              className="rounded border border-accent/40 px-3 py-1 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
            >
              {scanning ? "Extrayendo…" : "Adjuntar"}
            </button>
            {(preview || fileName) && (
              <button
                type="button"
                onClick={limpiar}
                className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-danger hover:border-danger"
              >
                Limpiar
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f && esValido(f)) fromFile(f);
            }}
          />
        </div>
        {preview && (
          <img
            src={preview}
            alt="Vista previa"
            className="max-h-40 rounded border border-border object-contain"
          />
        )}
        {!preview && fileName && (
          <p className="text-xs text-ink truncate">{fileName}</p>
        )}
        {scanning && (
          <p className="text-xs text-accent animate-pulse">Analizando con IA…</p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-xs">
          <span className="font-bold text-muted">Moneda factura</span>
          <input
            value={moneda}
            onChange={(e) => setMoneda(e.target.value.toUpperCase())}
            className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-1.5 text-sm font-mono"
          />
        </label>
        <label className="block text-xs">
          <span className="font-bold text-muted">
            TRM {necesitaTrm ? "(obligatoria)" : "(N/A si COP)"}
          </span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={trm}
            disabled={!necesitaTrm}
            onChange={(e) => setTrm(e.target.value)}
            placeholder={necesitaTrm ? "Ej. 4100" : "1"}
            className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-1.5 text-sm font-mono disabled:opacity-40"
          />
        </label>
        <label className="block text-xs">
          <span className="font-bold text-muted">Flete (opcional)</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={flete}
            onChange={(e) => setFlete(e.target.value)}
            placeholder="0"
            className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-1.5 text-sm font-mono"
          />
        </label>
        <label className="block text-xs">
          <span className="font-bold text-muted">Moneda flete</span>
          <input
            value={monedaFlete}
            onChange={(e) => setMonedaFlete(e.target.value.toUpperCase())}
            className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-1.5 text-sm font-mono"
          />
        </label>
      </div>

      {proveedor && (
        <p className="text-xs text-muted">
          Proveedor detectado: <span className="font-semibold text-ink">{proveedor}</span>
        </p>
      )}

      {error && (
        <div className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}
      {okMsg && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
          {okMsg}
        </div>
      )}

      {lineas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-surface-panel text-[10px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-2 py-2">
                  <input
                    type="checkbox"
                    checked={lineas.every((l) => l.seleccionada)}
                    onChange={(e) =>
                      setLineas((prev) => prev.map((l) => ({ ...l, seleccionada: e.target.checked })))
                    }
                  />
                </th>
                <th className="px-2 py-2">Producto</th>
                <th className="px-2 py-2">Cant.</th>
                <th className="px-2 py-2">Un.</th>
                <th className="px-2 py-2">P. unit</th>
                <th className="px-2 py-2">Subtotal</th>
                <th className="px-2 py-2">Costo unit. COP</th>
                <th className="px-2 py-2">Cat.</th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={l.seleccionada}
                      onChange={(e) => patchLinea(l.id, { seleccionada: e.target.checked })}
                    />
                  </td>
                  <td className="px-2 py-1.5 min-w-[12rem]">
                    <input
                      value={l.nombre}
                      onChange={(e) => patchLinea(l.id, { nombre: e.target.value })}
                      className="w-full rounded border border-border bg-surface-input px-1.5 py-1"
                    />
                  </td>
                  <td className="px-2 py-1.5 w-20">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={l.cantidad}
                      onChange={(e) => patchLinea(l.id, { cantidad: n(e.target.value, 1) })}
                      className="w-full rounded border border-border bg-surface-input px-1.5 py-1 font-mono"
                    />
                  </td>
                  <td className="px-2 py-1.5 w-16">
                    <input
                      value={l.unidad}
                      onChange={(e) => patchLinea(l.id, { unidad: e.target.value })}
                      className="w-full rounded border border-border bg-surface-input px-1.5 py-1"
                    />
                  </td>
                  <td className="px-2 py-1.5 w-24">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={l.precio_unit}
                      onChange={(e) => patchLinea(l.id, { precio_unit: n(e.target.value) })}
                      className="w-full rounded border border-border bg-surface-input px-1.5 py-1 font-mono"
                    />
                  </td>
                  <td className="px-2 py-1.5 font-mono text-muted whitespace-nowrap">
                    {l.subtotal.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={l.costo_unitario_cop ?? ""}
                      onChange={(e) =>
                        patchLinea(l.id, {
                          costo_unitario_cop: e.target.value === "" ? null : n(e.target.value),
                        })
                      }
                      className="w-28 rounded border border-accent/40 bg-accent/5 px-1.5 py-1 font-mono font-semibold"
                    />
                    <div className="text-[9px] text-muted">{fmtCop(l.costo_unitario_cop)}</div>
                  </td>
                  <td className="px-2 py-1.5 w-24">
                    <select
                      value={l.categoria}
                      onChange={(e) => patchLinea(l.id, { categoria: e.target.value })}
                      className="w-full rounded border border-border bg-surface-input px-1 py-1"
                    >
                      <option value="material">material</option>
                      <option value="empaque">empaque</option>
                      <option value="servicio">servicio</option>
                      <option value="otro">otro</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lineas.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted">
            Flete prorrateado por valor de línea. IVA no incluido. Se guarda en costos manuales de
            Rentabilidad (y Siigo si hay match por nombre).
          </p>
          <button
            type="button"
            disabled={!puedenGuardar || guardando}
            onClick={() => void guardar()}
            className="rounded-lg border-2 border-accent bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40 hover:bg-accent-hover"
          >
            {guardando ? "Guardando…" : `Guardar seleccionados (${seleccionadas.length})`}
          </button>
        </div>
      )}
    </div>
  );
}
