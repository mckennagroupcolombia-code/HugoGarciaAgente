/**
 * Documentos soporte de Solicitudes de pago (Res. DIAN 000167/2021).
 *
 * Al aprobar un pago a quien no está obligado a facturar, el documento nace
 * BORRADOR con la foto exacta de lo que se va a emitir. Viaja a la DIAN solo
 * cuando alguien de Administración pulsa «Emitir a la DIAN» — mismo patrón que
 * «Facturar ahora» en Ventas AstroKiller. Lo transmitido no se borra: se corrige
 * con nota de ajuste, por eso se revisa antes.
 *
 * El backend se niega a emitir si algo no cuadra al peso o si falta alguna
 * retención en Alegra: el DSMG1 (18-sep-2026) salió sin retenciones y dejó un
 * saldo por pagar fantasma.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";

export type PagoDoc = { fecha: string; valor: number; solicitud_id?: number };

export type DetalleDoc = {
  nombre?: string; identificacion?: string; fecha?: string; descripcion?: string; cuenta_puc?: string;
  base?: number; retencion?: number; retencion_concepto?: string; retencion_ica?: number; ica_por_mil?: number;
  girado?: number; solicitudes?: number[]; pagos?: PagoDoc[]; pagos_alegra?: string[];
};

export type DocSoporte = {
  solicitud_id: number; estado: string; numero: string; cuds: string; estado_dian: string;
  alegra_id: string; valor: number; mensaje: string; emitido_at?: string; fecha?: string;
  tercero_nombre?: string; tercero_identificacion?: string; detalle: DetalleDoc | null;
};

type Yo = { puede: boolean };

function cop(n: number | null | undefined): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency", currency: "COP", maximumFractionDigits: 0,
  }).format(n || 0);
}

const ESTADO: Record<string, { label: string; cls: string }> = {
  borrador: { label: "📝 Borrador — falta emitir a la DIAN", cls: "bg-amber-500/15 text-amber-600" },
  success: { label: "✅ Emitido", cls: "bg-emerald-500/15 text-emerald-600" },
  error: { label: "⚠️ Error al emitir", cls: "bg-red-500/15 text-red-500" },
  por_emitir: { label: "⏳ Creado en Alegra — la DIAN no lo ha recibido", cls: "bg-amber-500/15 text-amber-600" },
  vista_previa: { label: "👁 Vista previa — queda en borrador al aprobar", cls: "bg-sky-500/15 text-sky-600" },
};

function Fila({ k, v, fuerte }: { k: string; v: React.ReactNode; fuerte?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/50 py-1 last:border-0">
      <span className="text-muted">{k}</span>
      <span className={`tabular-nums text-ink ${fuerte ? "font-extrabold" : ""}`}>{v}</span>
    </div>
  );
}

export function DocumentoSoporteDetalle({ doc }: { doc: DocSoporte }) {
  const qc = useQueryClient();
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const yoQ = useQuery<Yo>({ queryKey: ["pagos-puedo-registrar"], queryFn: () => api.get("/api/pagos/puedo-registrar") });
  const puedeEmitir = Boolean(yoQ.data?.puede);

  const d = doc.detalle ?? {};
  const base = d.base ?? doc.valor;
  const ret = d.retencion ?? 0;
  const ica = d.retencion_ica ?? 0;
  const girado = d.girado ?? base - ret - ica;
  const estado = ESTADO[doc.estado] ?? { label: doc.estado, cls: "bg-surface text-muted" };
  const emitible = doc.estado === "borrador" || doc.estado === "error" || doc.estado === "por_emitir";

  async function emitir() {
    const resumen =
      `Emitir a la DIAN el documento soporte de ${d.nombre ?? doc.tercero_nombre ?? ""}\n\n` +
      `Base: ${cop(base)}\n` +
      (ret > 0 ? `Retención en la fuente: ${cop(ret)}\n` : "") +
      (ica > 0 ? `ReteICA ${d.ica_por_mil ?? ""} por mil: ${cop(ica)}\n` : "") +
      `Total a pagar: ${cop(girado)}\n\n` +
      "Una vez transmitido NO se puede borrar: solo se corrige con nota de ajuste. ¿Continuar?";
    if (!window.confirm(resumen)) return;
    setOcupado(true);
    setMsg(null);
    try {
      const r = await api.post<{ error?: string; status?: string; message?: string; numero?: string; avisos?: string[] }>(
        `/api/pagos/solicitudes/${doc.solicitud_id}/documento-soporte/emitir`, {},
      );
      if (r.error) setMsg({ ok: false, texto: r.error });
      else setMsg({ ok: !r.status || r.status === "success" || r.status === "ya_emitido",
                    texto: [r.message, ...(r.avisos ?? [])].filter(Boolean).join(" ") });
    } catch (e) {
      setMsg({ ok: false, texto: (e as Error).message || "No se pudo emitir." });
    } finally {
      setOcupado(false);
      void qc.invalidateQueries({ queryKey: ["pagos-solicitudes"] });
      void qc.invalidateQueries({ queryKey: ["pagos-documentos-soporte"] });
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-border bg-surface p-3 text-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold text-ink">
          📄 Documento soporte{doc.numero ? ` ${doc.numero}` : ""}
          {d.solicitudes && d.solicitudes.length > 1 && (
            <span className="ml-1 font-normal text-muted">
              (cubre las solicitudes {d.solicitudes.map((x) => `#${x}`).join(" y ")})
            </span>
          )}
        </p>
        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${estado.cls}`}>{estado.label}</span>
      </div>

      <div className="grid gap-x-6 sm:grid-cols-2">
        <div>
          <Fila k="Proveedor" v={d.nombre ?? doc.tercero_nombre ?? "—"} />
          <Fila k="NIT" v={d.identificacion ?? doc.tercero_identificacion ?? "—"} />
          <Fila k="Fecha" v={d.fecha ?? doc.fecha ?? "—"} />
          <Fila k="Cuenta" v={d.cuenta_puc ?? "—"} />
          {d.descripcion && <p className="pt-1 text-xs text-muted">{d.descripcion}</p>}
        </div>
        <div>
          <Fila k="Base" v={cop(base)} />
          <Fila k="Retención en la fuente" v={ret > 0 ? cop(ret) : "$ 0"} />
          <Fila k={`ReteICA${d.ica_por_mil ? ` ${d.ica_por_mil} ‰` : ""}`} v={cop(ica)} />
          <Fila k="Total a pagar" v={cop(girado)} fuerte />
        </div>
      </div>

      {d.pagos && d.pagos.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          Pagos: {d.pagos.map((p) => `${p.fecha} ${cop(p.valor)}`).join(" · ")}
        </p>
      )}
      {doc.cuds && <p className="mt-1 break-all font-mono text-[11px] text-muted">CUDS {doc.cuds}</p>}
      {doc.estado_dian && <p className="mt-1 text-xs text-emerald-600">DIAN: {doc.estado_dian}</p>}
      {doc.mensaje && doc.estado !== "borrador" && <p className="mt-1 text-xs text-amber-600">{doc.mensaje}</p>}
      {doc.estado === "vista_previa" && (
        <p className="mt-2 text-xs text-muted">
          Así quedará el documento soporte. Al aprobar pasa a borrador y se emite a la DIAN con el botón
          «Emitir a la DIAN» — desde esta solicitud o desde Libro Mayor → Documentos soporte.
        </p>
      )}

      {emitible && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {!puedeEmitir && <span className="text-xs italic text-muted">Lo emite Administración</span>}
          {puedeEmitir && (
            <button type="button" onClick={() => void emitir()} disabled={ocupado}
                    className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">
              {ocupado ? "Emitiendo…" : doc.estado === "por_emitir" ? "Reintentar emisión a la DIAN" : "Emitir a la DIAN"}
            </button>
          )}
        </div>
      )}
      {msg && (
        <p className={`mt-2 rounded-lg px-2 py-1 text-xs ${msg.ok ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"}`}>
          {msg.texto}
        </p>
      )}
    </div>
  );
}

/** Apartado del Libro Mayor: todos los documentos soporte, borradores y emitidos. */
export default function DocumentosSoporteTab() {
  const [estado, setEstado] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [abierto, setAbierto] = useState<number | null>(null);

  const q = useQuery<{ documentos: DocSoporte[] }>({
    queryKey: ["pagos-documentos-soporte", estado, desde, hasta],
    queryFn: () => api.get(
      `/api/pagos/documentos-soporte?${new URLSearchParams({ estado, desde, hasta }).toString()}`),
  });
  const docs = q.data?.documentos ?? [];
  const borradores = docs.filter((x) => x.estado === "borrador").length;

  return (
    <div className="space-y-3">
      <div className="lm-card flex flex-wrap items-end gap-2 p-3">
        <label className="text-xs font-bold text-muted">Estado
          <select value={estado} onChange={(e) => setEstado(e.target.value)}
                  className="mt-0.5 block rounded border border-border bg-surface-input px-2 py-1 text-sm text-ink">
            <option value="">Todos</option>
            <option value="borrador">Borradores (por emitir)</option>
            <option value="success">Emitidos</option>
            <option value="error">Con error</option>
          </select></label>
        <label className="text-xs font-bold text-muted">Desde
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
                 className="mt-0.5 block rounded border border-border bg-surface-input px-2 py-1 text-sm text-ink" /></label>
        <label className="text-xs font-bold text-muted">Hasta
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
                 className="mt-0.5 block rounded border border-border bg-surface-input px-2 py-1 text-sm text-ink" /></label>
        <p className="ml-auto text-xs text-muted">
          {docs.length} documento(s){borradores ? ` · ${borradores} por emitir` : ""}
        </p>
      </div>

      {q.isLoading && <p className="text-sm text-muted">Cargando documentos soporte…</p>}
      {q.error && <p className="text-sm text-red-500">{(q.error as Error).message}</p>}
      {!q.isLoading && !docs.length && (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
          No hay documentos soporte con ese filtro.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          {docs.length > 0 && (
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="py-1 pr-2">Número</th><th className="pr-2">Fecha</th><th className="pr-2">Proveedor</th>
                <th className="pr-2 text-right">Base</th><th className="pr-2 text-right">Retenciones</th>
                <th className="pr-2 text-right">Total a pagar</th><th className="pr-2">Estado</th><th />
              </tr>
            </thead>
          )}
          <tbody>
            {docs.map((doc) => {
              const d = doc.detalle ?? {};
              const base = d.base ?? doc.valor;
              const rets = (d.retencion ?? 0) + (d.retencion_ica ?? 0);
              const est = ESTADO[doc.estado] ?? { label: doc.estado, cls: "bg-surface text-muted" };
              const open = abierto === doc.solicitud_id;
              return [
                <tr key={doc.solicitud_id} className="border-b border-border/50">
                  <td className="py-1.5 pr-2 font-mono font-bold text-ink">{doc.numero || "—"}</td>
                  <td className="pr-2 text-muted">{d.fecha ?? doc.fecha}</td>
                  <td className="pr-2 text-ink">{d.nombre ?? doc.tercero_nombre}</td>
                  <td className="pr-2 text-right tabular-nums">{cop(base)}</td>
                  <td className="pr-2 text-right tabular-nums">{doc.detalle ? cop(rets) : "—"}</td>
                  <td className="pr-2 text-right font-bold tabular-nums">{doc.detalle ? cop(d.girado ?? base - rets) : "—"}</td>
                  <td className="pr-2"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${est.cls}`}>{est.label}</span></td>
                  <td className="text-right">
                    <button type="button" onClick={() => setAbierto(open ? null : doc.solicitud_id)}
                            className="rounded-lg border border-border px-2 py-0.5 text-xs font-bold text-muted hover:border-accent hover:text-accent">
                      {open ? "Cerrar" : doc.estado === "borrador" ? "Revisar y emitir" : "Ver"}
                    </button>
                  </td>
                </tr>,
                open && (
                  <tr key={`${doc.solicitud_id}-d`}>
                    <td colSpan={8} className="pb-3"><DocumentoSoporteDetalle doc={doc} /></td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
