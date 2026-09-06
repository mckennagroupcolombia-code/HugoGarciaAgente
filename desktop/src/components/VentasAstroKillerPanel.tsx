import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

type Segmento = "concretadas" | "canceladas" | "todas";

interface NotaCredito {
  id: string | number;
  numero: string | null;
  fecha: string | null;
  total: number | null;
  tipo: string | null;
  cufe: string;
  legal_status: string | null;
  url: string;
}

interface ItemLinea {
  sku: string;
  nombre: string | null;
  cantidad: number | null;
  total?: number | null;
  precio_unitario?: number | null;
}

interface FacturaAlegra {
  factura_id: string;
  numero: string | null;
  fecha: string | null;
  estado: string | null;
  total: number | null;
  cufe: string;
  url: string;
  notas_credito: NotaCredito[];
  items: ItemLinea[];
}

interface FacturaLegado {
  factura_id: string | number;
  factura_numero: string | null;
  factura_fecha: string | null;
  total: number | null;
  integracion: string | null;
}

interface VentaOriginal {
  total_pagado: number;
  items: ItemLinea[];
}

interface Cliente {
  nombre: string | null;
  identificacion: string | null;
}

interface VentaUnificada {
  order_id: string;
  pack_id: string;
  es_meli: boolean;
  es_cancelada: boolean;
  fecha: string | null;
  total: number | null;
  meli_url: string | null;
  cliente: Cliente | null;
  facturas_cliente_en_rango: number;
  facturas: FacturaAlegra[];
  factura_legado: FacturaLegado | null;
  posible_duplicado: boolean;
  monto_discrepancia: boolean;
  nota_credito_legado: string | null;
  nc_subida_meli_legado: boolean | null;
  revisado: boolean;
  revisado_notas: string | null;
  ticket_id: number | null;
  paso_id: number | null;
  venta_original: VentaOriginal | null;
  shipping_status?: string | null;
  estado_facturacion: string;
}

interface VentasResp {
  ventas: VentaUnificada[];
  total: number;
  total_en_rango: number;
  actualizado_en: string | null;
}

/** Límite por defecto según el rango elegido — más días, más filas
 * permitidas, pero acotado para no arriesgar un timeout de proxy en la
 * primera carga (sin caché el costo real es de MeLi, ~1-3s por fila). */
function limiteParaDias(dias: number): number {
  if (dias <= 7) return 30;
  if (dias <= 15) return 50;
  if (dias <= 30) return 80;
  if (dias <= 60) return 110;
  return 150;
}

interface DocumentoResp {
  ok?: boolean;
  base64?: string;
  nombre?: string;
  error?: string;
}

interface CompradorResp {
  ok?: boolean;
  nombre?: string | null;
  identificacion?: string | null;
  error?: string;
}

interface ConteoResp {
  ok?: boolean;
  total_facturas?: number;
  error?: string;
}

const DIAS_OPCIONES = [7, 15, 30, 60, 90] as const;

const ESTADO_BADGE: Record<string, { label: string; cls: string }> = {
  facturada_completa: { label: "✅ Facturada", cls: "bg-emerald-500/15 text-emerald-500" },
  facturada_pendiente_subir_meli: { label: "⚠️ Falta subir a MeLi", cls: "bg-amber-500/15 text-amber-500" },
  en_transito: { label: "🚚 En tránsito", cls: "bg-surface text-muted" },
  en_margen_entrega: { label: "⏳ Entregada, en margen 48h", cls: "bg-sky-500/15 text-sky-500" },
  sin_facturar: { label: "🔴 Sin facturar", cls: "bg-danger/15 text-danger" },
  cancelada_sin_factura: { label: "➖ Cancelada, sin factura", cls: "bg-surface text-muted" },
  cancelada_resuelta: { label: "✅ NC resuelta", cls: "bg-emerald-500/15 text-emerald-500" },
  cancelada_nc_sin_subir_meli: { label: "⚠️ NC sin subir a MeLi", cls: "bg-amber-500/15 text-amber-500" },
  cancelada_en_margen: { label: "⏳ Cancelada, en margen 48h", cls: "bg-sky-500/15 text-sky-500" },
  cancelada_pendiente_nc: { label: "🔴 Falta nota crédito", cls: "bg-danger/15 text-danger" },
};

const NEEDS_REVIEW = new Set([
  "facturada_pendiente_subir_meli",
  "sin_facturar",
  "cancelada_pendiente_nc",
]);

function nombreIntegracionLegado(integracion: string | null) {
  if (integracion === "astroselling") return "Astroselling (Siigo)";
  if (integracion === "mckenna") return "Siigo (McKenna)";
  return integracion ?? "Siigo";
}

function pesos(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(v);
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

function TablaItems({ items, columnaValor }: { items: ItemLinea[]; columnaValor: "total" | "precio_unitario" }) {
  if (items.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted">Sin ítems.</p>;
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
          <th className="px-3 py-1 font-semibold">SKU</th>
          <th className="px-1 py-1 font-semibold">Producto</th>
          <th className="px-1 py-1 text-right font-semibold">Cant</th>
          <th className="px-3 py-1 text-right font-semibold">Valor</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border/40">
        {items.map((it, idx) => {
          const valor = columnaValor === "total" ? it.total : it.precio_unitario;
          return (
            <tr key={idx}>
              <td className="px-3 py-1 font-mono text-[11px] text-ink">{it.sku || "—"}</td>
              <td className="px-1 py-1 text-ink-secondary">{it.nombre ?? "—"}</td>
              <td className="px-1 py-1 text-right text-ink-secondary">{it.cantidad ?? "—"}</td>
              <td className="px-3 py-1 text-right font-semibold text-ink">{pesos(valor)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Nombre + cédula del cliente, con conteo de facturas y comprador MeLi bajo demanda. */
function ClienteInfo({ venta }: { venta: VentaUnificada }) {
  const [comprador, setComprador] = useState<CompradorResp | null>(null);
  const [conteo, setConteo] = useState<ConteoResp | null>(null);
  const [cargando, setCargando] = useState<"comprador" | "conteo" | null>(null);

  const cliente = venta.cliente ?? (comprador?.ok ? { nombre: comprador.nombre ?? null, identificacion: comprador.identificacion ?? null } : null);

  async function verComprador() {
    setCargando("comprador");
    try {
      const res = await api.get<CompradorResp>(`/api/facturacion/ventas-unificadas/comprador/${venta.order_id}`);
      setComprador(res);
    } catch (e) {
      setComprador({ ok: false, error: (e as Error).message });
    } finally {
      setCargando(null);
    }
  }

  async function verHistorico() {
    if (!cliente?.identificacion) return;
    setCargando("conteo");
    try {
      const res = await api.get<ConteoResp>(`/api/facturacion/ventas-unificadas/cliente/${cliente.identificacion}/conteo`);
      setConteo(res);
    } catch (e) {
      setConteo({ ok: false, error: (e as Error).message });
    } finally {
      setCargando(null);
    }
  }

  if (!cliente) {
    if (!venta.es_meli) return <span className="text-muted">—</span>;
    return (
      <button
        type="button"
        onClick={() => void verComprador()}
        disabled={cargando === "comprador"}
        className="text-[11px] font-semibold text-accent hover:underline disabled:opacity-40"
      >
        {cargando === "comprador" ? "Consultando MeLi…" : "Ver comprador MeLi"}
      </button>
    );
  }

  return (
    <div className="space-y-0.5">
      <p className="font-semibold text-ink">{cliente.nombre || "—"}</p>
      <p className="font-mono text-[10px] text-muted">{cliente.identificacion || "—"}</p>
      {venta.facturas_cliente_en_rango > 0 && (
        <p className="text-[10px] text-muted">
          {venta.facturas_cliente_en_rango} factura{venta.facturas_cliente_en_rango !== 1 ? "s" : ""} en el rango
        </p>
      )}
      {cliente.identificacion && (
        <button
          type="button"
          onClick={() => void verHistorico()}
          disabled={cargando === "conteo"}
          className="text-[10px] font-semibold text-accent hover:underline disabled:opacity-40"
        >
          {cargando === "conteo"
            ? "Consultando…"
            : conteo
              ? conteo.ok
                ? `${conteo.total_facturas} factura(s) histórico`
                : conteo.error || "Error"
              : "Ver histórico completo"}
        </button>
      )}
    </div>
  );
}

/** Botón "Revisar" inline: crea/reusa el paso del ticket de Centro de Mando y lo marca completado con un motivo opcional. */
function RevisarBoton({ venta, dias, onRevisado }: { venta: VentaUnificada; dias: number; onRevisado: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmar() {
    setEnviando(true);
    setError(null);
    try {
      let ticketId = venta.ticket_id;
      let pasoId = venta.paso_id;
      if (!pasoId) {
        await api.post(`/api/facturacion/ventas-unificadas/generar-ticket-revision?segmento=todas&dias=${dias}`);
        onRevisado(); // fuerza refetch para traer ticket_id/paso_id nuevos
        setError("Se creó el ticket de revisión — pulsa \"Revisar\" de nuevo para marcarlo.");
        setEnviando(false);
        return;
      }
      await api.put(`/api/tickets/${ticketId}/pasos/${pasoId}`, { completado: true, notas: motivo || undefined });
      setAbierto(false);
      setMotivo("");
      onRevisado();
    } catch (e) {
      setError((e as Error).message || "No se pudo marcar como revisado.");
    } finally {
      setEnviando(false);
    }
  }

  if (venta.revisado) {
    return (
      <span className="text-[10px] text-muted" title={venta.revisado_notas ?? undefined}>
        ✓ Revisado{venta.revisado_notas ? ` — ${venta.revisado_notas}` : ""}
      </span>
    );
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="rounded-paper border border-border px-2 py-1 text-[10px] font-bold text-ink hover:border-accent hover:text-accent"
      >
        Revisar
      </button>
    );
  }

  return (
    <div className="w-56 space-y-1.5 rounded-lg border border-border bg-surface p-2">
      <textarea
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Motivo de la discrepancia (opcional)…"
        rows={2}
        className="w-full rounded border border-border bg-surface-input px-2 py-1 text-[11px] text-ink outline-none focus:border-accent"
      />
      {error && <p className="text-[10px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setAbierto(false)} className="text-[10px] text-muted hover:text-ink">
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => void confirmar()}
          disabled={enviando}
          className="rounded bg-accent px-2 py-1 text-[10px] font-bold text-white disabled:opacity-40"
        >
          {enviando ? "Guardando…" : "✓ Marcar revisado"}
        </button>
      </div>
    </div>
  );
}

/**
 * Facturación → Ventas, NC y Astro Killer: fusiona lo que antes eran dos
 * paneles separados ("Astro Killer" y "Ventas y NC") en un solo lugar — cada
 * venta MeLi/web comparada contra su factura en Alegra (o el índice legado
 * Siigo), con doble verificación contra el documento fiscal de MeLi, cliente
 * identificado, y un botón "Revisar" que deja registro en el Centro de Mando
 * en vez de una alerta de WhatsApp en texto plano que se repite para siempre.
 */
export default function VentasAstroKillerPanel() {
  const [segmento, setSegmento] = useState<Segmento>("concretadas");
  // Con el volumen real de ventas MeLi de McKenna, listar 30 días implica
  // ~1.600 órdenes y puede tardar >40s en frío (sin caché) — arriesga un 504
  // de proxy/túnel (confirmado en vivo 2026-09-04). 7 días por defecto: es
  // la ventana que realmente importa para esta alerta (48h desde entrega);
  // rangos más amplios quedan disponibles para auditorías puntuales, a
  // sabiendas de que tardan más.
  const [dias, setDias] = useState<number>(7);
  const [busqueda, setBusqueda] = useState("");
  const [verLoading, setVerLoading] = useState<string | null>(null);
  const [verError, setVerError] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);
  const [generarMsg, setGenerarMsg] = useState<string | null>(null);
  const qc = useQueryClient();

  // null = usar el default según `dias` (limiteParaDias); se fija a un
  // número explícito solo cuando el usuario pide "cargar todas" tras ver que
  // el rango tenía más filas de las mostradas.
  const [limiteManual, setLimiteManual] = useState<number | null>(null);
  const limite = limiteManual ?? limiteParaDias(dias);

  useEffect(() => {
    setLimiteManual(null);
  }, [segmento, dias]);

  const q = useQuery<VentasResp>({
    queryKey: ["ventas-unificadas", segmento, dias, limite],
    queryFn: () => api.get(`/api/facturacion/ventas-unificadas?segmento=${segmento}&dias=${dias}&limit=${limite}`),
    staleTime: 60_000,
  });

  const ventas = q.data?.ventas ?? [];
  const totalEnRango = q.data?.total_en_rango ?? ventas.length;
  const hayMas = totalEnRango > ventas.length;
  const filtradasLocal = busqueda.trim() ? ventas.filter((v) => v.order_id.includes(busqueda.trim())) : ventas;
  const pendientesRevision = ventas.filter((v) => !v.revisado && (v.posible_duplicado || NEEDS_REVIEW.has(v.estado_facturacion)));

  // Búsqueda puntual en MeLi: la lista cargada solo trae `limite` filas del
  // rango — un ID que exista pero no esté entre esas filas daba "sin
  // resultados" aunque la venta esté resuelta (confirmado en vivo 2026-09-05,
  // ticket TKT-2026-1156/1160). Se dispara aparte, solo con Enter/click,
  // porque es una consulta en vivo a MeLi+Alegra (no instantánea).
  const [resultadoBusqueda, setResultadoBusqueda] = useState<VentaUnificada | null>(null);
  const [buscandoEnMeli, setBuscandoEnMeli] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);
  const idBuscable = /^\d{9,17}$/.test(busqueda.trim());
  const filtradas = resultadoBusqueda ? [resultadoBusqueda] : filtradasLocal;

  useEffect(() => {
    setResultadoBusqueda(null);
    setErrorBusqueda(null);
  }, [busqueda]);

  async function buscarEnMeli() {
    const id = busqueda.trim();
    if (!id) return;
    setBuscandoEnMeli(true);
    setErrorBusqueda(null);
    try {
      const res = await api.get<{ ok: boolean; venta?: VentaUnificada; error?: string }>(
        `/api/facturacion/ventas-unificadas/buscar/${id}`,
      );
      if (!res.ok || !res.venta) {
        setErrorBusqueda(res.error || "No se encontró esa orden/pack en MeLi.");
        setResultadoBusqueda(null);
        return;
      }
      setResultadoBusqueda(res.venta);
    } catch (e) {
      setErrorBusqueda((e as Error).message || "No se pudo buscar en MeLi.");
    } finally {
      setBuscandoEnMeli(false);
    }
  }

  function refrescar() {
    void qc.invalidateQueries({ queryKey: ["ventas-unificadas", segmento, dias, limite] });
  }

  // Incremental, no directo al máximo: con volumen real (miles de órdenes en
  // rangos amplios) saltar de una vez a 150 filas puede tardar varios
  // minutos (cada fila cuesta 1-3 llamadas reales a MeLi). Cada click suma
  // un tramo más, para que el usuario decida cuánto esperar.
  const PASO_CARGA = 30;
  function cargarMas() {
    setLimiteManual(Math.min(limite + PASO_CARGA, totalEnRango, 150));
  }

  async function verDocumento(venta: VentaUnificada, tipo: "factura" | "nota_credito", alegraId?: string) {
    const key = `${venta.order_id}:${tipo}:${alegraId ?? ""}`;
    setVerError(null);
    setVerLoading(key);
    try {
      const params = alegraId
        ? `alegra_id=${alegraId}&tipo=${tipo}`
        : `pack_id=${venta.pack_id}&tipo=${tipo}`;
      const res = await api.get<DocumentoResp>(`/api/facturacion/ventas-unificadas/documento?${params}`);
      if (!res.ok || !res.base64) {
        setVerError(res.error || "No se pudo obtener el documento.");
        return;
      }
      abrirPdfBase64(res.base64, res.nombre || venta.order_id);
    } catch (e) {
      setVerError((e as Error).message || "No se pudo obtener el documento.");
    } finally {
      setVerLoading(null);
    }
  }

  async function generarTicketRevision() {
    setGenerando(true);
    setGenerarMsg(null);
    try {
      const res = await api.post<{ ok: boolean; mensaje: string; casos: number }>(
        `/api/facturacion/ventas-unificadas/generar-ticket-revision?segmento=${segmento}&dias=${dias}`,
      );
      setGenerarMsg(res.mensaje);
      refrescar();
    } catch (e) {
      setGenerarMsg((e as Error).message || "No se pudo generar el ticket.");
    } finally {
      setGenerando(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Ventas, NC y Astro Killer</h2>
          <p className="mt-1 text-xs text-muted">
            Cada venta MeLi/web comparada contra su factura en Alegra (o el índice legado Siigo), con
            doble verificación contra el documento fiscal de MeLi y el estado real de entrega — para no
            disparar falsas alarmas antes del plazo de {" "}
            <span className="font-semibold">48h</span> tras la entrega.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pendientesRevision.length > 0 && (
            <span className="rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-bold uppercase text-red-700 dark:bg-red-900/30 dark:text-red-400">
              ⚠️ {pendientesRevision.length} caso{pendientesRevision.length !== 1 ? "s" : ""} por revisar
            </span>
          )}
          <button
            type="button"
            onClick={() => void generarTicketRevision()}
            disabled={generando || pendientesRevision.length === 0}
            className="rounded-paper border-2 border-border px-3 py-2 text-xs font-semibold text-ink transition hover:border-accent hover:text-accent disabled:opacity-40"
          >
            {generando ? "Generando…" : "🎫 Generar ticket de revisión"}
          </button>
          <button
            type="button"
            onClick={refrescar}
            disabled={q.isFetching}
            className="rounded-paper border-2 border-border px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent hover:text-accent disabled:opacity-40"
          >
            {q.isFetching ? "Actualizando…" : "Actualizar"}
          </button>
        </div>
      </div>

      {generarMsg && <p className="text-xs text-muted">{generarMsg}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-border bg-surface-panel p-1">
          {(["concretadas", "canceladas", "todas"] as Segmento[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSegmento(s)}
              className={`rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${
                segmento === s ? "bg-accent text-white" : "text-muted hover:text-ink"
              }`}
            >
              {s === "concretadas" ? "Concretadas" : s === "canceladas" ? "Canceladas" : "Todas"}
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
        <input
          type="text"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && idBuscable) void buscarEnMeli();
          }}
          placeholder="Buscar por ID de orden MeLi o referencia web…"
          className="min-w-[220px] flex-1 rounded-paper border-2 border-border bg-surface px-3 py-1.5 text-xs text-ink outline-none focus:border-accent"
        />
        {idBuscable && !resultadoBusqueda && (
          <button
            type="button"
            onClick={() => void buscarEnMeli()}
            disabled={buscandoEnMeli}
            className="text-xs font-bold text-accent hover:underline disabled:opacity-40"
            title="La lista solo trae las últimas filas del rango — esto busca ese ID puntual directo en MeLi, esté o no entre ellas"
          >
            {buscandoEnMeli ? "Buscando en MeLi…" : "🔎 Buscar en MeLi"}
          </button>
        )}
        {resultadoBusqueda && (
          <button
            type="button"
            onClick={() => setResultadoBusqueda(null)}
            className="text-xs font-bold text-muted hover:text-ink"
          >
            × Ver lista normal
          </button>
        )}
        <span className="text-xs text-muted">
          {resultadoBusqueda
            ? "Resultado de búsqueda directa en MeLi"
            : busqueda
            ? `${filtradas.length} venta(s) filtradas`
            : hayMas
              ? `Mostrando ${ventas.length} de ${totalEnRango} en el rango`
              : `${ventas.length} venta(s)`}
        </span>
        {hayMas && !busqueda && (
          <button
            type="button"
            onClick={cargarMas}
            disabled={q.isFetching}
            className="text-xs font-bold text-accent hover:underline disabled:opacity-40"
          >
            {q.isFetching
              ? "Cargando…"
              : `Cargar ${Math.min(PASO_CARGA, totalEnRango - ventas.length)} más — puede tardar ~${Math.min(PASO_CARGA, totalEnRango - ventas.length) * 2}s`}
          </button>
        )}
      </div>

      {errorBusqueda && <p className="text-xs font-semibold text-danger">{errorBusqueda}</p>}
      {verError && <p className="text-xs font-semibold text-danger">{verError}</p>}
      {q.isError && <p className="text-xs text-danger">{(q.error as Error).message || "No se pudo cargar el listado."}</p>}
      {q.isLoading && (
        <p className="text-sm text-muted">
          Consultando Alegra y MeLi… la primera carga puede tardar un momento (cruza cada venta con su
          detalle real, entrega y documento fiscal en MeLi).
        </p>
      )}
      {!q.isLoading && !q.isError && filtradas.length === 0 && (
        <p className="text-sm text-muted">{busqueda ? "Sin resultados para esa búsqueda." : "Sin ventas en el período."}</p>
      )}

      <div className="space-y-3">
        {filtradas.map((venta) => {
          const badge = ESTADO_BADGE[venta.estado_facturacion] ?? {
            label: venta.estado_facturacion,
            cls: "bg-surface text-muted",
          };
          const necesitaRevision = !venta.revisado && (venta.posible_duplicado || NEEDS_REVIEW.has(venta.estado_facturacion));

          return (
            <div
              key={venta.order_id}
              className={`overflow-hidden rounded-xl border bg-surface-panel ${
                necesitaRevision ? "border-red-300 dark:border-red-800" : "border-border"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-hover px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                      venta.es_meli
                        ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                        : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                    }`}
                  >
                    {venta.es_meli ? "MeLi" : "Web"}
                  </span>
                  {venta.meli_url ? (
                    <a
                      href={venta.meli_url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-sm font-semibold text-accent hover:underline"
                      title="Ver detalle de la venta en MercadoLibre"
                    >
                      {venta.order_id} ↗
                    </a>
                  ) : (
                    <span className="font-mono text-sm font-semibold text-ink">{venta.order_id}</span>
                  )}
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>{badge.label}</span>
                  {venta.posible_duplicado && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700 dark:bg-red-900/30 dark:text-red-400">
                      ⚠️ Posible doble
                    </span>
                  )}
                  {venta.monto_discrepancia && (
                    <span
                      className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      title="El total facturado no coincide con lo que pagó el cliente"
                    >
                      ⚠️ Monto no coincide
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted">{formatFecha(venta.fecha)}</span>
                  <span className="font-semibold text-ink">{pesos(venta.total ?? venta.venta_original?.total_pagado)}</span>
                  {necesitaRevision && <RevisarBoton venta={venta} dias={dias} onRevisado={refrescar} />}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-0 divide-y divide-border md:grid-cols-[220px_1fr_1fr] md:divide-x md:divide-y-0">
                <div className="min-w-0 px-3 py-2">
                  <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted">Cliente</p>
                  <ClienteInfo venta={venta} />
                </div>

                <div className="min-w-0">
                  <p className="border-b border-border/60 bg-surface px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">
                    Vendido en {venta.es_meli ? "MeLi" : "la web"}
                  </p>
                  {venta.venta_original ? (
                    <div className="overflow-x-auto">
                      <TablaItems items={venta.venta_original.items} columnaValor="precio_unitario" />
                    </div>
                  ) : (
                    <p className="px-3 py-2 text-xs text-muted">No se pudo consultar el detalle de la venta.</p>
                  )}
                </div>

                <div className="min-w-0">
                  <p className="border-b border-border/60 bg-surface px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">
                    Facturado en Alegra
                  </p>
                  {venta.facturas.length === 0 && !venta.factura_legado && (
                    <p className="px-3 py-2 text-xs text-muted">Sin factura.</p>
                  )}
                  <div className="divide-y divide-border/60">
                    {venta.facturas.map((f) => (
                      <div key={f.factura_id} className="px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => void verDocumento(venta, "factura", f.factura_id)}
                            disabled={verLoading === `${venta.order_id}:factura:${f.factura_id}`}
                            className="font-semibold text-accent hover:underline disabled:opacity-40"
                          >
                            {verLoading === `${venta.order_id}:factura:${f.factura_id}` ? "Abriendo…" : f.numero ?? f.factura_id}
                          </button>
                          <span className="text-xs text-muted">{f.fecha ?? "—"}</span>
                        </div>
                        <div className="overflow-x-auto">
                          <TablaItems items={f.items} columnaValor="total" />
                        </div>
                        {f.notas_credito.length > 0 && (
                          <div className="mt-2 space-y-1.5 border-l-2 border-red-300 pl-3 dark:border-red-800">
                            {f.notas_credito.map((nc) => (
                              <div key={nc.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                <div className="flex items-center gap-2">
                                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                    Nota crédito
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => void verDocumento(venta, "nota_credito", String(nc.id))}
                                    disabled={verLoading === `${venta.order_id}:nota_credito:${nc.id}`}
                                    className="font-semibold text-accent hover:underline disabled:opacity-40"
                                  >
                                    {nc.numero ?? nc.id}
                                  </button>
                                </div>
                                <span className="font-semibold text-ink">{pesos(nc.total)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    {venta.factura_legado && (
                      <div className="px-3 py-2 text-xs text-red-800 dark:text-red-300">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold">
                            {nombreIntegracionLegado(venta.factura_legado.integracion)}:{" "}
                            <button
                              type="button"
                              onClick={() => void verDocumento(venta, "factura")}
                              disabled={verLoading === `${venta.order_id}:factura:`}
                              className="font-mono font-semibold text-accent hover:underline disabled:opacity-40"
                            >
                              {venta.factura_legado.factura_numero ?? venta.factura_legado.factura_id}
                            </button>
                          </span>
                          <span>{venta.factura_legado.factura_fecha ?? "—"} · {pesos(venta.factura_legado.total)}</span>
                        </div>
                        {venta.nota_credito_legado && (
                          <p className="mt-1">
                            NC: {venta.nota_credito_legado}
                            {venta.nc_subida_meli_legado ? "" : " (sin subir a MeLi)"}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted">
        Fuente: Alegra (facturas + notas crédito) + índice legado Siigo, cruzado con MeLi (detalle de
        venta, entrega y documento fiscal) · {q.data?.total ?? 0} venta{(q.data?.total ?? 0) !== 1 ? "s" : ""}
      </p>
    </div>
  );
}
