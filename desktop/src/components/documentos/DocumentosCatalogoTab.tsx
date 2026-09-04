import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

export interface ProductoDocumentacion {
  ref: string;
  nombre: string;
  nombre_base: string;
}

interface DocEstado {
  tiene: boolean;
  origen?: string | null;
  webViewLink?: string | null;
  nombre_archivo?: string;
  drive_id?: string;
}

interface ProductoRow {
  ref: string;
  nombre: string;
  nombre_base: string;
  documentos: { ft: DocEstado; coa: DocEstado; sds: DocEstado };
  completo: boolean;
  faltantes: string[];
}

interface CatalogResponse {
  total: number;
  indices_drive: Record<string, number>;
  drive_index?: { origen?: string; mensaje?: string; actualizado_at?: string | null };
  duracion_ms?: number;
  productos: ProductoRow[];
}

interface DriveHit {
  drive_id?: string;
  webViewLink?: string;
  nombre_archivo?: string;
}

const TIPO_LABEL: Record<string, string> = { ft: "FT", coa: "COA", sds: "SDS" };

function FichaTecnicaBadge({
  completo,
  faltantes,
  onVerPdf,
}: {
  completo: boolean;
  faltantes: string[];
  onVerPdf?: () => void;
}) {
  const cls = completo
    ? "bg-emerald-500/15 text-emerald-700 ring-emerald-500/30"
    : "bg-amber-500/15 text-amber-700 ring-amber-500/30";
  const label = completo ? "Ficha Técnica" : `Falta ${faltantes.map((t) => TIPO_LABEL[t] ?? t).join(", ")}`;
  if (onVerPdf) {
    return (
      <button
        type="button"
        onClick={onVerPdf}
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 hover:underline ${cls}`}
      >
        {label}
      </button>
    );
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${cls}`}>
      {label}
    </span>
  );
}

interface Props {
  onGenerar: (producto: ProductoDocumentacion) => void;
}

export default function DocumentosCatalogoTab({ onGenerar }: Props) {
  const qc = useQueryClient();
  const [buscar, setBuscar] = useState("");
  const [soloFaltantes, setSoloFaltantes] = useState(false);
  const [tipoFaltante, setTipoFaltante] = useState("");
  const [expandido, setExpandido] = useState<string | null>(null);
  const [asociar, setAsociar] = useState<{ producto: ProductoRow; tipo: string } | null>(null);
  const [linkManual, setLinkManual] = useState("");

  const params = useMemo(() => {
    const q = new URLSearchParams();
    if (buscar.trim()) q.set("buscar", buscar.trim());
    if (soloFaltantes) q.set("solo_faltantes", "1");
    if (tipoFaltante) q.set("tipo_faltante", tipoFaltante);
    q.set("limit", "500");
    return q.toString();
  }, [buscar, soloFaltantes, tipoFaltante]);

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["documentos-productos", params],
    queryFn: () =>
      api.get<CatalogResponse>(`/api/documentos/productos?${params}`, { timeoutMs: 120000 }),
    staleTime: 60_000,
    retry: 1,
  });

  const reindexMut = useMutation({
    mutationFn: () =>
      api.get<CatalogResponse>(
        `/api/documentos/productos?${params}&refrescar_drive=1`,
        { timeoutMs: 600000 },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["documentos-productos"] });
    },
  });

  const sugerenciasQ = useQuery({
    queryKey: ["documentos-buscar-drive", asociar?.producto.ref, asociar?.producto.nombre],
    queryFn: () =>
      api.get<Record<string, DriveHit[]>>(
        `/api/documentos/buscar-drive?${new URLSearchParams({
          nombre: asociar!.producto.nombre,
          ref: asociar!.producto.ref,
        })}`,
      ),
    enabled: !!asociar,
  });

  const asociarMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ ok: boolean }>("/api/documentos/asociar", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["documentos-productos"] });
      setAsociar(null);
      setLinkManual("");
    },
  });

  const productos = data?.productos ?? [];

  const verFichaPdf = async (nombreArchivo: string) => {
    const { resolvePanelApiUrl } = await import("../../api/client");
    const { useTicketsAuth } = await import("../../stores/ticketsAuth");
    const { useAuthStore } = await import("../../stores/auth");
    const t = useTicketsAuth.getState();
    const token = t.apiToken || t.token || useAuthStore.getState().token || "";
    const url = resolvePanelApiUrl(`/api/fichas/biblioteca/descargar?archivo=${encodeURIComponent(nombreArchivo)}&inline=1`, "GET");
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) return;
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), "_blank");
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-ink">Catálogo de productos (combos Alegra)</h3>
        {data?.indices_drive && (
          <p className="mt-1 text-xs text-muted">
            PDFs indexados en Drive — FT: {data.indices_drive.ft ?? 0} · COA: {data.indices_drive.coa ?? 0} · SDS:{" "}
            {data.indices_drive.sds ?? 0}
            {data.drive_index?.origen === "pendiente" && (
              <span className="text-amber-600"> · índice Drive pendiente (asociaciones manuales y Sheets sí aplican)</span>
            )}
            {data.duracion_ms != null && data.duracion_ms > 0 && (
              <span className="text-muted/70"> · {Math.round(data.duracion_ms / 1000)}s</span>
            )}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          onClick={() => reindexMut.mutate()}
          disabled={reindexMut.isPending || isFetching}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:border-accent disabled:opacity-40"
        >
          {reindexMut.isPending ? "Indexando Drive… (1–3 min)" : "Actualizar índice Drive"}
        </button>
        {reindexMut.isError && (
          <span className="text-xs text-danger">{reindexMut.error.message}</span>
        )}
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-muted">Buscar ref o nombre</label>
          <input
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Ej. C-AMIBCA o amido"
            className="mt-1 w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input type="checkbox" checked={soloFaltantes} onChange={(e) => setSoloFaltantes(e.target.checked)} />
          Solo con faltantes
        </label>
        <select
          value={tipoFaltante}
          onChange={(e) => setTipoFaltante(e.target.value)}
          className="rounded-lg border border-border bg-surface-input px-3 py-2 text-sm"
        >
          <option value="">Falta cualquier tipo</option>
          <option value="ft">Falta FT</option>
          <option value="coa">Falta COA</option>
          <option value="sds">Falta SDS</option>
        </select>
      </div>

      {isLoading && (
        <p className="text-sm text-muted">Cargando combos Alegra y estado documental…</p>
      )}
      {error && (
        <p className="text-sm text-danger">
          {error.message}
          <button
            type="button"
            className="ml-2 text-accent underline"
            onClick={() => void qc.invalidateQueries({ queryKey: ["documentos-productos"] })}
          >
            Reintentar
          </button>
        </p>
      )}

      <div className="max-h-[min(70vh,800px)] overflow-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 border-b border-border bg-surface-panel text-left text-xs text-muted shadow-[0_1px_0_0_var(--color-border,rgba(0,0,0,0.08))] [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-surface-panel">
            <tr>
              <th className="px-3 py-2 font-medium">Ref</th>
              <th className="px-3 py-2 font-medium">Producto</th>
              <th className="px-3 py-2 font-medium">Documentos</th>
              <th className="px-3 py-2 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {productos.map((p) => (
              <Fragment key={p.ref}>
                <tr className="hover:bg-surface-panel/50">
                  <td className="px-3 py-2 font-mono text-xs">{p.ref}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-ink">{p.nombre}</div>
                  </td>
                  <td className="px-3 py-2">
                    <FichaTecnicaBadge
                      completo={p.completo}
                      faltantes={p.faltantes}
                      onVerPdf={
                        p.documentos.ft.origen === "ficha_tecnica_generada" && p.documentos.ft.nombre_archivo
                          ? () => void verFichaPdf(p.documentos.ft.nombre_archivo!)
                          : undefined
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setExpandido(expandido === p.ref ? null : p.ref)}
                      className="text-xs text-accent hover:underline"
                    >
                      {expandido === p.ref ? "Ocultar" : "Gestionar"}
                    </button>
                  </td>
                </tr>
                {expandido === p.ref && (
                  <tr>
                    <td colSpan={4} className="bg-surface-panel/80 px-4 py-4">
                      <div className="flex flex-wrap gap-2 mb-3">
                        <button
                          type="button"
                          onClick={() =>
                            onGenerar({ ref: p.ref, nombre: p.nombre, nombre_base: p.nombre_base })
                          }
                          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:border-accent"
                        >
                          Generar Ficha Técnica
                        </button>
                      </div>
                      {p.documentos.ft.origen === "ficha_tecnica_generada" ? (
                        <div className="rounded-lg border border-border p-3 space-y-2 text-xs sm:max-w-xs">
                          <div className="font-medium">Ficha Técnica (FT + COA + SDS)</div>
                          <div className="text-muted truncate">{p.documentos.ft.nombre_archivo}</div>
                          <button
                            type="button"
                            onClick={() => void verFichaPdf(p.documentos.ft.nombre_archivo!)}
                            className="text-accent hover:underline"
                          >
                            Ver PDF
                          </button>
                        </div>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-3 text-xs">
                          {(["ft", "coa", "sds"] as const).map((t) => {
                            const d = p.documentos[t];
                            return (
                              <div key={t} className="rounded-lg border border-border p-3 space-y-2">
                                <div className="font-medium">{TIPO_LABEL[t]}</div>
                                {d.tiene ? (
                                  <>
                                    {d.nombre_archivo && <div className="text-muted truncate">{d.nombre_archivo}</div>}
                                    {d.webViewLink && (
                                      <a
                                        href={d.webViewLink}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-accent hover:underline"
                                      >
                                        Ver en Drive
                                      </a>
                                    )}
                                    {!d.webViewLink && (
                                      <span className="text-amber-600">Solo borrador/texto ({d.origen})</span>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-muted">Sin documento</span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAsociar({ producto: p, tipo: t });
                                    setLinkManual("");
                                  }}
                                  className="text-accent hover:underline"
                                >
                                  Asociar archivo
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!isLoading && productos.length === 0 && (
          <p className="p-4 text-sm text-muted text-center">No hay productos que coincidan con el filtro.</p>
        )}
      </div>

      {asociar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface-panel p-5 space-y-4 shadow-xl">
            <h4 className="text-sm font-semibold text-ink">
              Asociar {TIPO_LABEL[asociar.tipo] ?? asociar.tipo} — {asociar.producto.ref}
            </h4>
            <p className="text-xs text-muted">{asociar.producto.nombre}</p>

            {sugerenciasQ.isLoading && <p className="text-xs text-muted">Buscando en Drive…</p>}
            {(sugerenciasQ.data?.[asociar.tipo] ?? []).length > 0 && (
              <ul className="space-y-2 text-xs">
                <li className="font-medium text-muted">Sugerencias en Drive:</li>
                {(sugerenciasQ.data?.[asociar.tipo] ?? []).map((h) => (
                  <li key={h.drive_id || h.nombre_archivo}>
                    <button
                      type="button"
                      disabled={asociarMut.isPending}
                      onClick={() =>
                        asociarMut.mutate({
                          ref: asociar.producto.ref,
                          tipo: asociar.tipo,
                          drive_id: h.drive_id,
                          webViewLink: h.webViewLink,
                          nombre_archivo: h.nombre_archivo,
                          nombre: asociar.producto.nombre,
                        })
                      }
                      className="w-full text-left rounded-lg border border-border px-3 py-2 hover:border-accent"
                    >
                      {h.nombre_archivo}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="space-y-2">
              <label className="text-xs text-muted">O pegue enlace de Drive</label>
              <input
                value={linkManual}
                onChange={(e) => setLinkManual(e.target.value)}
                placeholder="https://drive.google.com/file/d/…"
                className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={!linkManual.trim() || asociarMut.isPending}
                onClick={() =>
                  asociarMut.mutate({
                    ref: asociar.producto.ref,
                    tipo: asociar.tipo,
                    webViewLink: linkManual.trim(),
                    nombre: asociar.producto.nombre,
                  })
                }
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Asociar enlace
              </button>
            </div>

            {asociarMut.isError && <p className="text-sm text-danger">{asociarMut.error.message}</p>}

            <button
              type="button"
              onClick={() => {
                setAsociar(null);
                setLinkManual("");
              }}
              className="text-sm text-muted hover:text-ink"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
