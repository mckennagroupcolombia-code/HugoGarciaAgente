import { useEffect, useMemo, useState } from "react";
import { resolvePanelApiUrl } from "../api/client";
import { useAuthStore } from "../stores/auth";
import { useTicketsAuth } from "../stores/ticketsAuth";
import CuentaCobroAprobacion, {
  type CuentaCobroTipo,
} from "./CuentaCobroAprobacion";
import { Modal } from "./etiquetas/ui/Modal";

export type CompraRevisionLinea = {
  nombre: string;
  codigo?: string | null;
  nombre_ocr?: string;
  costo_unitario?: number;
  cantidad?: number;
  unidades_por_pack?: number;
  unidades_totales?: number;
  unidad?: string;
  precio_unit?: number;
  subtotal?: number;
  descuento?: number;
  categoria?: string;
  ok?: boolean;
};

export type CompraRevision = {
  id: number;
  created_at?: string;
  proveedor?: string;
  numero_pedido?: string;
  fecha_compra?: string;
  moneda?: string;
  moneda_flete?: string;
  trm?: number;
  trm_fuente?: string;
  flete?: number;
  valor_compra_cop?: number;
  cuota_manejo_cop?: number;
  total_cobro_cop?: number;
  flete_cobro_cop?: number;
  cuota_pct?: number;
  lineas?: CompraRevisionLinea[];
  cuenta_cobro_estado?: string;
  tiene_cuenta_cobro?: boolean;
  cuenta_cobro_pendiente?: boolean;
  cuenta_flete_estado?: string;
  tiene_cuenta_flete?: boolean;
  cuenta_flete_pendiente?: boolean;
  emisor_usuario_id?: number | null;
  emisor_nombre?: string;
  emisor_documento?: string;
  tiene_soporte?: boolean;
  soporte_url?: string | null;
  soporte_urls?: string[];
  soportes_count?: number;
  total_guardados?: number;
  envio?: { id: number; fecha_envio?: string } | null;
};

function bearerPanel(): string {
  const t = useTicketsAuth.getState();
  return t.apiToken || t.token || useAuthStore.getState().token || "";
}

async function fetchAuthBlobUrl(apiPath: string): Promise<string | null> {
  try {
    const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
    const url = resolvePanelApiUrl(path, "GET");
    const res = await fetch(url, {
      headers: bearerPanel() ? { Authorization: `Bearer ${bearerPanel()}` } : {},
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

function fmtCop(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(v);
}

type Props = {
  compra: CompraRevision;
  onClose: () => void;
  onAprobada: (historial: CompraRevision) => void;
  onDescargar: (tipo: CuentaCobroTipo) => void;
  onEditar?: () => void;
};

/**
 * Al hacer clic en un pedido: adjunto(s) + datos extraídos + vista previa PDF / aprobación.
 */
export default function CompraExteriorRevisionModal({
  compra,
  onClose,
  onAprobada,
  onDescargar,
  onEditar,
}: Props) {
  const [soporteUrls, setSoporteUrls] = useState<string[]>([]);
  const [soporteIdx, setSoporteIdx] = useState(0);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfTipo, setPdfTipo] = useState<CuentaCobroTipo>("mercancia");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfErr, setPdfErr] = useState<string | null>(null);

  const tienePdfMerc =
    compra.tiene_cuenta_cobro || compra.cuenta_cobro_estado === "aprobada";
  const tienePdfFlete =
    !compra.envio &&
    (compra.tiene_cuenta_flete || compra.cuenta_flete_estado === "aprobada");
  const puedeAprobarMerc = (compra.total_cobro_cop ?? 0) > 0;
  const puedeAprobarFlete = (compra.flete_cobro_cop ?? 0) > 0 && !compra.envio;

  useEffect(() => {
    let cancelled = false;
    const paths =
      compra.soporte_urls && compra.soporte_urls.length > 0
        ? compra.soporte_urls
        : compra.soporte_url
          ? [compra.soporte_url]
          : compra.tiene_soporte
            ? [`/api/rentabilidad/compras-exterior/${compra.id}/soporte`]
            : [];
    void (async () => {
      const blobs: string[] = [];
      for (const p of paths) {
        const u = await fetchAuthBlobUrl(p);
        if (u) blobs.push(u);
      }
      if (!cancelled) {
        setSoporteUrls(blobs);
        setSoporteIdx(0);
      }
    })();
    return () => {
      cancelled = true;
      // revoke on next effect / unmount below
    };
  }, [compra.id, compra.soporte_url, compra.tiene_soporte, compra.soportes_count]);

  useEffect(() => {
    return () => {
      soporteUrls.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soporteUrls]);

  const cargarPdf = async (tipo: CuentaCobroTipo) => {
    const puedeMerc = (compra.total_cobro_cop ?? 0) > 0;
    const puedeFlete =
      !compra.envio && (compra.flete_cobro_cop ?? 0) > 0;
    if (tipo === "mercancia" && !puedeMerc) {
      setPdfUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setPdfErr(
        (compra.total_cobro_cop ?? 0) <= 0
          ? "Sin monto de mercancía para previsualizar"
          : null,
      );
      return;
    }
    if (tipo === "flete" && !puedeFlete) {
      setPdfUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setPdfErr(null);
      return;
    }
    setPdfBusy(true);
    setPdfErr(null);
    setPdfTipo(tipo);
    try {
      const q = new URLSearchParams({ preview: "1", tipo });
      if (compra.emisor_usuario_id) {
        q.set("emisor_usuario_id", String(compra.emisor_usuario_id));
      }
      if (compra.cuota_pct != null && compra.cuota_pct > 0) {
        q.set("cuota_pct", String(compra.cuota_pct));
      }
      const u = await fetchAuthBlobUrl(
        `/api/rentabilidad/compras-exterior/${compra.id}/cuenta-cobro?${q.toString()}`,
      );
      if (!u) throw new Error("No se pudo generar la vista previa del PDF");
      setPdfUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return u;
      });
    } catch (e: unknown) {
      setPdfErr(e instanceof Error ? e.message : String(e));
      setPdfUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    } finally {
      setPdfBusy(false);
    }
  };

  useEffect(() => {
    if ((compra.total_cobro_cop ?? 0) > 0) void cargarPdf("mercancia");
    else if (!compra.envio && (compra.flete_cobro_cop ?? 0) > 0) void cargarPdf("flete");
    else {
      setPdfUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    compra.id,
    compra.total_cobro_cop,
    compra.flete_cobro_cop,
    compra.cuota_pct,
    compra.emisor_usuario_id,
    compra.tiene_cuenta_cobro,
    compra.tiene_cuenta_flete,
    compra.cuenta_cobro_estado,
    compra.cuenta_flete_estado,
  ]);

  const lineas = compra.lineas || [];
  const titulo = useMemo(() => {
    const bits = [`Compra #${compra.id}`];
    if (compra.proveedor) bits.push(compra.proveedor);
    if (compra.numero_pedido) bits.push(`ped. ${compra.numero_pedido}`);
    return bits.join(" · ");
  }, [compra.id, compra.proveedor, compra.numero_pedido]);

  const thumb = soporteUrls[soporteIdx] || null;

  return (
    <Modal
      onClose={onClose}
      title={titulo}
      maxWidthClassName="max-w-7xl"
      fixedHeight
      headerExtra={
        onEditar ? (
          <button
            type="button"
            onClick={onEditar}
            className="rounded border border-border px-2 py-1 text-[11px] font-medium text-muted hover:text-accent hover:border-accent"
          >
            Editar
          </button>
        ) : null
      }
    >
      <div className="grid h-full min-h-0 grid-cols-1 gap-0 lg:grid-cols-12">
        {/* Adjunto */}
        <section className="flex min-h-0 flex-col border-b border-border lg:col-span-4 lg:border-b-0 lg:border-r">
          <header className="shrink-0 border-b border-border/60 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted">
              Adjunto / pantallazo
            </p>
          </header>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3">
            {thumb ? (
              <a href={thumb} target="_blank" rel="noreferrer" className="block">
                <img
                  src={thumb}
                  alt={`Soporte ${soporteIdx + 1}`}
                  className="max-h-[55vh] w-full rounded-lg border border-border bg-surface object-contain"
                />
              </a>
            ) : (
              <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border bg-surface-input/40 p-6 text-center text-xs text-muted">
                Sin pantallazo de soporte
              </div>
            )}
            {soporteUrls.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {soporteUrls.map((u, i) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setSoporteIdx(i)}
                    className={`h-12 w-12 overflow-hidden rounded border ${
                      i === soporteIdx ? "border-accent ring-2 ring-accent/30" : "border-border"
                    }`}
                  >
                    <img src={u} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Datos extraídos */}
        <section className="flex min-h-0 flex-col border-b border-border lg:col-span-4 lg:border-b-0 lg:border-r">
          <header className="shrink-0 border-b border-border/60 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted">
              Datos extraídos
            </p>
          </header>
          <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3 text-[12px]">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
              <div>
                <dt className="text-muted">Fecha compra</dt>
                <dd className="font-semibold text-ink">{compra.fecha_compra || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">Pedido</dt>
                <dd className="font-mono font-semibold text-ink">{compra.numero_pedido || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">Moneda / TRM</dt>
                <dd className="font-semibold text-ink">
                  {compra.moneda || "—"}
                  {compra.trm
                    ? ` · ${compra.trm}${compra.trm_fuente === "banrep" ? " BanRep" : ""}`
                    : ""}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Flete</dt>
                <dd className="font-semibold text-ink">
                  {compra.envio
                    ? `En paquete #${compra.envio.id}`
                    : compra.flete
                      ? `${compra.flete} ${compra.moneda_flete || compra.moneda || ""}`
                      : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Mercancía cobro</dt>
                <dd className="font-mono font-semibold text-accent">
                  {fmtCop(compra.total_cobro_cop)}
                  {compra.cuenta_cobro_estado ? ` · ${compra.cuenta_cobro_estado}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Flete cobro</dt>
                <dd className="font-mono font-semibold text-ink">
                  {compra.envio
                    ? "vía envío"
                    : `${fmtCop(compra.flete_cobro_cop)}${
                        compra.cuenta_flete_estado ? ` · ${compra.cuenta_flete_estado}` : ""
                      }`}
                </dd>
              </div>
              {compra.emisor_nombre && (
                <div className="col-span-2">
                  <dt className="text-muted">A nombre de</dt>
                  <dd className="font-semibold text-ink">{compra.emisor_nombre}</dd>
                </div>
              )}
            </dl>

            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-left text-[11px]">
                <thead className="border-b border-border bg-surface-input/50 text-[10px] uppercase text-muted">
                  <tr>
                    <th className="px-2 py-1.5">SKU</th>
                    <th className="px-2 py-1.5">Producto</th>
                    <th className="px-2 py-1.5 text-right">Cant.</th>
                    <th className="px-2 py-1.5 text-right">Costo/ud</th>
                  </tr>
                </thead>
                <tbody>
                  {lineas.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-2 py-3 text-center text-muted">
                        Sin líneas
                      </td>
                    </tr>
                  ) : (
                    lineas.map((l, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="px-2 py-1 font-mono text-accent">{l.codigo || "—"}</td>
                        <td className="px-2 py-1">
                          <span className="font-medium text-ink">{l.nombre}</span>
                          {l.precio_unit != null && l.precio_unit > 0 && (
                            <span className="mt-0.5 block font-mono text-[10px] text-muted">
                              {l.precio_unit}
                              {l.subtotal != null ? ` · sub ${l.subtotal}` : ""}
                              {l.descuento ? ` · −${l.descuento}` : ""}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-right font-mono">
                          {l.unidades_totales ?? l.cantidad ?? "—"}{" "}
                          <span className="text-muted">{(l.unidad || "un").toLowerCase()}</span>
                        </td>
                        <td className="px-2 py-1 text-right font-mono">
                          {l.costo_unitario != null
                            ? `${fmtCop(Number(l.costo_unitario))}/${(l.unidad || "un").toLowerCase()}`
                            : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* PDF / aprobación */}
        <section className="flex min-h-0 flex-col lg:col-span-4">
          <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted">
              Vista previa PDF
            </p>
            <div className="ml-auto flex flex-wrap gap-1">
              {puedeAprobarMerc && (
                <button
                  type="button"
                  onClick={() => void cargarPdf("mercancia")}
                  className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                    pdfTipo === "mercancia" && pdfUrl
                      ? "bg-accent text-white"
                      : "border border-border text-muted hover:text-ink"
                  }`}
                >
                  Mercancía
                </button>
              )}
              {puedeAprobarFlete && (
                <button
                  type="button"
                  onClick={() => void cargarPdf("flete")}
                  className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                    pdfTipo === "flete" && pdfUrl
                      ? "bg-accent text-white"
                      : "border border-border text-muted hover:text-ink"
                  }`}
                >
                  Flete
                </button>
              )}
              {pdfUrl && (
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded border border-border px-2 py-0.5 text-[10px] font-semibold text-muted hover:text-ink"
                >
                  Abrir PDF
                </a>
              )}
              {(tienePdfMerc || tienePdfFlete) && (
                <button
                  type="button"
                  onClick={() => onDescargar(pdfTipo)}
                  className="rounded border border-emerald-600/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
                >
                  Descargar
                </button>
              )}
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-auto p-3 space-y-3">
            {pdfBusy && (
              <p className="text-[11px] text-muted animate-pulse">Generando vista previa PDF…</p>
            )}
            {pdfErr && <p className="text-[11px] text-danger">{pdfErr}</p>}
            {pdfUrl && (
              <div className="space-y-1">
                <p className="text-[10px] text-muted">
                  {tienePdfMerc || tienePdfFlete
                    ? "PDF (vista previa / aprobado)"
                    : "Borrador — aún no aprobado; así se verá al generar"}
                </p>
                <iframe
                  title={`Cuenta de cobro ${pdfTipo}`}
                  src={`${pdfUrl}#toolbar=1&navpanes=0`}
                  className="h-[min(62vh,560px)] w-full rounded-lg border border-border bg-white"
                />
              </div>
            )}
            {!pdfUrl && !puedeAprobarMerc && !puedeAprobarFlete && (
              <p className="rounded-lg border border-dashed border-border bg-surface-input/40 px-3 py-4 text-center text-[11px] text-muted">
                Sin montos de cuenta de cobro aún. Edita la compra o espera el cálculo de cuota /
                flete.
              </p>
            )}
            {(puedeAprobarMerc || puedeAprobarFlete) && (
              <details open={!pdfUrl} className="rounded-lg border border-border bg-surface-panel">
                <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold text-accent">
                  {pdfUrl ? "Regenerar / ajustar cuenta de cobro" : "Aprobar y generar PDF"}
                </summary>
                <div className="space-y-3 border-t border-border p-3">
                  {puedeAprobarMerc && (
                    <CuentaCobroAprobacion
                      compra={compra}
                      tipo="mercancia"
                      compact
                      onAprobada={(h) => {
                        onAprobada({ ...compra, ...h });
                      }}
                      onDescargar={() => onDescargar("mercancia")}
                    />
                  )}
                  {puedeAprobarFlete && (
                    <CuentaCobroAprobacion
                      compra={compra}
                      tipo="flete"
                      compact
                      onAprobada={(h) => {
                        onAprobada({ ...compra, ...h });
                      }}
                      onDescargar={() => onDescargar("flete")}
                    />
                  )}
                  {compra.envio && (compra.flete_cobro_cop ?? 0) > 0 && (
                    <p className="text-[11px] text-muted">
                      El flete va en el paquete envío #{compra.envio.id}
                      {compra.envio.fecha_envio ? ` (${compra.envio.fecha_envio})` : ""}.
                      Apruébalo desde la cabecera del envío en el historial.
                    </p>
                  )}
                </div>
              </details>
            )}
          </div>
        </section>
      </div>
    </Modal>
  );
}
