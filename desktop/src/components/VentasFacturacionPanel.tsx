import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

type EstadoSegmento = "canceladas" | "concretadas";

interface VentaConciliacion {
  pack_id: string;
  fecha: string | null;
  total: number | null;
  factura_numero: string | null;
  factura_total: number | null;
  iva_discrepancia: boolean;
  integracion: "astroselling" | "mckenna" | "otro" | null;
  nota_credito: string | null;
  nc_subida_meli: boolean | null;
  estado_auditoria: string;
}

interface VentasResp {
  actualizado_en: string | null;
  ventas: VentaConciliacion[];
}

interface DocumentoResp {
  ok?: boolean;
  base64?: string;
  nombre?: string;
  error?: string;
}

const DIAS_OPCIONES = [7, 15, 30, 60, 90] as const;

const ESTADO_BADGE: Record<string, { label: string; cls: string }> = {
  resuelto: { label: "✅ Resuelto", cls: "bg-emerald-500/15 text-emerald-500" },
  nc_sin_subir_meli: { label: "⚠️ NC sin subir a MeLi", cls: "bg-amber-500/15 text-amber-500" },
  en_margen: { label: "⏳ En margen (48h)", cls: "bg-sky-500/15 text-sky-500" },
  pendiente_revisar: { label: "🔴 Revisar", cls: "bg-danger/15 text-danger" },
  sin_factura: { label: "➖ Sin factura", cls: "bg-surface text-muted" },
  facturada: { label: "✅ Facturada", cls: "bg-emerald-500/15 text-emerald-500" },
  sin_facturar: { label: "⚠️ Sin facturar", cls: "bg-amber-500/15 text-amber-500" },
  iva_incorrecto: { label: "🔴 Monto no coincide", cls: "bg-danger/15 text-danger" },
};

const INTEGRACION_LABEL: Record<string, string> = {
  astroselling: "Astroselling (externa)",
  mckenna: "McKenna (propia)",
  otro: "Otra / manual",
};

function formatCop(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatFecha(f: string | null): string {
  if (!f) return "—";
  try {
    return new Date(f).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return f;
  }
}

function abrirPdfBase64(base64: string, nombre: string) {
  try {
    const byteChars = atob(base64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    alert(`No se pudo abrir el PDF de ${nombre}.`);
  }
}

/**
 * Contabilidad → Facturación → Ventas y NC: conciliación de ventas MeLi
 * contra su factura Alegra y (si aplica) nota crédito — para auditar que
 * toda cancelación con factura ya emitida termine con NC confiable, subida
 * a MeLi. Lee un índice local (actualizado a diario por el cron de notas
 * crédito) cruzado en vivo con MeLi.
 */
export default function VentasFacturacionPanel() {
  const [segmento, setSegmento] = useState<EstadoSegmento>("canceladas");
  const [dias, setDias] = useState<number>(30);
  const [verLoading, setVerLoading] = useState<string | null>(null);
  const [verError, setVerError] = useState<string | null>(null);

  const q = useQuery<VentasResp>({
    queryKey: ["ventas-facturacion", segmento, dias],
    queryFn: () =>
      api.get(`/api/contabilidad/ventas-facturacion?estado=${segmento}&dias=${dias}`),
  });

  const ventas = q.data?.ventas ?? [];

  async function verDocumento(pack_id: string, tipo: "factura" | "nota_credito") {
    const key = `${pack_id}:${tipo}`;
    setVerError(null);
    setVerLoading(key);
    try {
      const res = await api.get<DocumentoResp>(
        `/api/contabilidad/ventas-facturacion/documento?pack_id=${pack_id}&tipo=${tipo}`,
      );
      if (!res.ok || !res.base64) {
        setVerError(res.error || "No se pudo obtener el documento.");
        return;
      }
      abrirPdfBase64(res.base64, res.nombre || pack_id);
    } catch (e) {
      setVerError((e as Error).message || "No se pudo obtener el documento.");
    } finally {
      setVerLoading(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">Ventas y notas crédito</h2>
          <p className="mt-1 text-xs text-muted">
            Conciliación ventas MeLi ↔ factura Alegra ↔ nota crédito. Útil para verificar que toda
            cancelación con factura ya emitida haya terminado con nota crédito confiable, subida a
            MeLi. "Total factura" se resalta en rojo cuando no coincide con lo que pagó el
            cliente (posible IVA mal facturado).
          </p>
        </div>
        <div className="text-right text-[10px] text-muted">
          {q.data?.actualizado_en ? (
            <>Índice de facturación actualizado: {formatFecha(q.data.actualizado_en)}</>
          ) : (
            "Índice de facturación aún no se ha generado."
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-border bg-surface-panel p-1">
          {(["canceladas", "concretadas"] as EstadoSegmento[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSegmento(s)}
              className={`rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${
                segmento === s ? "bg-accent text-white" : "text-muted hover:text-ink"
              }`}
            >
              {s === "canceladas" ? "Canceladas" : "Concretadas"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          Últimos
          <select
            value={dias}
            onChange={(e) => setDias(Number(e.target.value))}
            className="rounded-lg border border-border bg-surface-input px-2 py-1.5 text-xs text-ink"
          >
            {DIAS_OPCIONES.map((d) => (
              <option key={d} value={d}>
                {d} días
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-muted">{ventas.length} venta(s)</span>
      </div>

      {verError && <p className="text-xs font-semibold text-danger">{verError}</p>}
      {q.isError && (
        <p className="text-xs text-danger">
          {(q.error as Error).message || "No se pudo cargar la conciliación."}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="min-w-[860px] w-full text-left text-xs">
          <thead className="border-b border-border bg-surface text-[10px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2 font-bold">Fecha</th>
              <th className="px-3 py-2 font-bold">Pack / Orden</th>
              <th className="px-3 py-2 font-bold">Total venta</th>
              <th className="px-3 py-2 font-bold">Factura</th>
              <th className="px-3 py-2 font-bold">Total factura</th>
              <th className="px-3 py-2 font-bold">Integración</th>
              {segmento === "canceladas" && <th className="px-3 py-2 font-bold">Nota crédito</th>}
              <th className="px-3 py-2 font-bold">Estado</th>
              <th className="px-3 py-2 font-bold" />
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-muted">
                  Cargando…
                </td>
              </tr>
            )}
            {!q.isLoading && ventas.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-muted">
                  Sin ventas {segmento} en el período.
                </td>
              </tr>
            )}
            {ventas.map((v) => {
              const badge = ESTADO_BADGE[v.estado_auditoria] ?? {
                label: v.estado_auditoria,
                cls: "bg-surface text-muted",
              };
              const clavFactura = `${v.pack_id}:factura`;
              const claveNc = `${v.pack_id}:nota_credito`;
              return (
                <tr key={v.pack_id} className="border-t border-border/60">
                  <td className="px-3 py-2 tabular-nums text-ink">{formatFecha(v.fecha)}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-ink">{v.pack_id}</td>
                  <td className="px-3 py-2 font-bold tabular-nums text-ink">
                    {formatCop(v.total)}
                  </td>
                  <td className="px-3 py-2 text-muted">{v.factura_numero || "—"}</td>
                  <td
                    className={`px-3 py-2 font-bold tabular-nums ${
                      v.iva_discrepancia ? "text-danger" : "text-ink"
                    }`}
                    title={
                      v.iva_discrepancia
                        ? "El total de la factura no coincide con lo que pagó el cliente en MeLi — revisar IVA."
                        : undefined
                    }
                  >
                    {formatCop(v.factura_total)}
                    {v.iva_discrepancia ? " ⚠️" : ""}
                  </td>
                  <td className="px-3 py-2 text-muted">
                    {v.integracion ? INTEGRACION_LABEL[v.integracion] ?? v.integracion : "—"}
                  </td>
                  {segmento === "canceladas" && (
                    <td className="px-3 py-2 text-muted">
                      {v.nota_credito
                        ? `${v.nota_credito}${v.nc_subida_meli ? "" : " (sin subir)"}`
                        : "—"}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      {v.factura_numero && (
                        <button
                          type="button"
                          disabled={verLoading === clavFactura}
                          onClick={() => verDocumento(v.pack_id, "factura")}
                          className="text-[10px] font-bold text-accent hover:underline disabled:opacity-40"
                        >
                          {verLoading === clavFactura ? "Abriendo…" : "Ver factura"}
                        </button>
                      )}
                      {v.nota_credito && (
                        <button
                          type="button"
                          disabled={verLoading === claveNc}
                          onClick={() => verDocumento(v.pack_id, "nota_credito")}
                          className="text-[10px] font-bold text-accent hover:underline disabled:opacity-40"
                        >
                          {verLoading === claveNc ? "Abriendo…" : "Ver nota crédito"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
