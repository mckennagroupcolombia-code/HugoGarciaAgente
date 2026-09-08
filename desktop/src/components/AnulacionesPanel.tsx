import { useMemo, useState } from "react";
import {
  useAnulaciones,
  useAnulacionesDeuda,
  useAnulacionExpediente,
  useAgregarNota,
  useDescartarAnulacion,
  useEmitirNotaCredito,
  useRegistrarInventario,
  type Anulacion,
  type AnulacionEstado,
} from "../hooks/useAnulaciones";

/**
 * Contabilidad → Anulaciones.
 *
 * La vista del contador sobre las ventas anuladas y sus notas crédito. Lo
 * primero que muestra es la DEUDA (cuántas anulaciones siguen sin nota crédito,
 * por cuánto, y desde hace cuántos días la más antigua), no la actividad del
 * día: el mecanismo que dejó acumular 44 casos y $2,1 M entre junio y agosto de
 * 2026 fue precisamente que un caso pendiente se veía igual que un día sin
 * devoluciones.
 *
 * Cada fila abre el expediente completo con su línea de tiempo — el mismo
 * contenido que un agente IA recibe con `consultar_expediente_anulacion`, para
 * que persona y agente estén mirando exactamente el mismo caso.
 */

const ESTADO_LABEL: Record<AnulacionEstado, string> = {
  detectada: "Detectada",
  en_margen: "En margen (48h)",
  lista: "Lista para emitir",
  emitiendo: "Emitiendo",
  emitida: "NC emitida",
  subida_meli: "Publicada en MeLi",
  posteado_libro: "Posteada al libro",
  cerrada: "Cerrada",
  requiere_decision: "Requiere decisión",
  bloqueada: "Bloqueada",
  descartada: "Descartada",
};

/** Semántica de color: rojo = alguien tiene que actuar; ámbar = esperando; verde = resuelto. */
const ESTADO_CLASE: Record<AnulacionEstado, string> = {
  detectada: "bg-sky-500/10 text-sky-400 border-sky-500/25",
  en_margen: "bg-sky-500/10 text-sky-400 border-sky-500/25",
  lista: "bg-amber-500/10 text-amber-400 border-amber-500/25",
  emitiendo: "bg-amber-500/10 text-amber-400 border-amber-500/25",
  emitida: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
  subida_meli: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
  posteado_libro: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
  cerrada: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
  requiere_decision: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  bloqueada: "bg-red-500/10 text-red-400 border-red-500/30",
  descartada: "bg-white/5 text-muted border-border",
};

const MOTIVO_LABEL: Record<string, string> = {
  cancelacion_pre_despacho: "Cancelación antes del despacho",
  devolucion_producto: "Devolución del producto",
  reembolso_sin_devolucion: "Reintegro sin devolución",
  reembolso_meli: "Reembolso a cargo de MeLi",
  devolucion_parcial: "Devolución parcial",
  cambio_producto: "Cambio de producto",
  desconocido: "Sin clasificar",
};

const BLOQUEO_EXPLICACION: Record<string, string> = {
  proveedor_read_only:
    "La cuenta de Siigo está en modo solo lectura desde la migración. Esta factura necesita una nota crédito sin referencia en Alegra.",
  falta_tipo_nc_sin_referencia:
    "Falta ALEGRA_NC_SIN_REFERENCIA_TYPE. El operador debe crear una nota crédito sin referencia a mano en Alegra para descubrir el tipo correcto.",
  falta_item_generico:
    "Falta ALEGRA_NC_ITEM_GENERICO_SKU: un ítem de servicio en Alegra, sin movimiento de inventario.",
  factura_no_encontrada:
    "No se encontró la factura de esta venta ni en Siigo ni en Alegra. Hay que ubicarla a mano.",
  item_inactivo: "Alegra rechazó un ítem inactivo de la factura original.",
  cliente_inexistente: "El cliente de la factura no existe como contacto en Alegra.",
  error_proveedor: "El proveedor rechazó la emisión. Ver el detalle en la línea de tiempo.",
};

function pesos(v: number | null | undefined): string {
  return `$${Math.round(Number(v ?? 0)).toLocaleString("es-CO")}`;
}

function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short" });
}

function diasDesde(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

function EstadoChip({ estado }: { estado: AnulacionEstado }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        ESTADO_CLASE[estado] ?? "bg-white/5 text-muted border-border"
      }`}
    >
      {ESTADO_LABEL[estado] ?? estado}
    </span>
  );
}

function Deuda() {
  const { data, isLoading } = useAnulacionesDeuda();
  if (isLoading) {
    return <div className="rounded-xl border border-border bg-surface-panel p-4 text-sm text-muted">Cargando…</div>;
  }
  if (!data || !data.abiertas) {
    return (
      <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 text-sm text-emerald-400">
        Sin anulaciones pendientes: toda venta anulada tiene su nota crédito.
      </div>
    );
  }
  const alerta = (data.dias_mas_antigua ?? 0) >= 7;
  return (
    <div
      className={`rounded-xl border p-4 ${
        alerta ? "border-red-500/30 bg-red-500/5" : "border-amber-500/25 bg-amber-500/5"
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className="text-2xl font-bold tabular-nums text-ink">{data.abiertas}</span>
        <span className="text-sm text-muted">
          anulación(es) abierta(s) por <span className="font-semibold text-ink">{pesos(data.monto)}</span>
        </span>
        {data.dias_mas_antigua != null && (
          <span className={`text-sm font-semibold ${alerta ? "text-red-400" : "text-amber-400"}`}>
            La más antigua lleva {data.dias_mas_antigua} día(s) sin resolver
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {Object.entries(data.por_estado)
          .sort((a, b) => b[1].n - a[1].n)
          .map(([estado, d]) => (
            <span
              key={estado}
              className="rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] text-muted"
            >
              {ESTADO_LABEL[estado as AnulacionEstado] ?? estado}:{" "}
              <span className="font-semibold text-ink tabular-nums">{d.n}</span> ({pesos(d.monto)})
            </span>
          ))}
      </div>
    </div>
  );
}

function Expediente({ codigo, onCerrar }: { codigo: string; onCerrar: () => void }) {
  const { data: e, isLoading } = useAnulacionExpediente(codigo);
  const emitir = useEmitirNotaCredito();
  const nota = useAgregarNota();
  const inventario = useRegistrarInventario();
  const descartar = useDescartarAnulacion();
  const [texto, setTexto] = useState("");
  const [motivoDescarte, setMotivoDescarte] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);

  if (isLoading || !e) {
    return (
      <div className="rounded-xl border border-border bg-surface-panel p-6 text-sm text-muted">
        Cargando expediente…
      </div>
    );
  }

  const puedeEmitir = !e.nc_numero && e.estado !== "descartada" && e.estado !== "cerrada";
  const necesitaAprobacion = e.estado === "requiere_decision" || e.estado === "bloqueada";

  async function lanzarEmision(forzar: boolean) {
    setMensaje(null);
    try {
      const r = await emitir.mutateAsync({ id: e!.id, forzar });
      if (r.modo_sombra) {
        setMensaje(
          "Modo sombra: el caso quedó listo pero no se llamó a Alegra. Para emitir de verdad hay que poner RA_EMISION_ACTIVA=1.",
        );
      } else if (r.requiere_decision) {
        setMensaje(`Requiere aprobación: ${(r.motivos ?? []).join(" · ")}`);
      } else if (r.ok) {
        setMensaje(`Nota crédito ${r.nc_numero ?? ""} emitida.`);
      } else {
        setMensaje(r.error ?? "No se pudo emitir.");
      }
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : "No se pudo emitir.");
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-mono text-lg font-bold text-ink">{e.codigo}</h3>
            <EstadoChip estado={e.estado} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {MOTIVO_LABEL[e.motivo] ?? e.motivo}
            {e.alcance ? ` · ${e.alcance}` : ""} · abierto {fechaCorta(e.abierta_en)}
          </p>
        </div>
        <button
          type="button"
          onClick={onCerrar}
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:text-ink"
        >
          Cerrar
        </button>
      </div>

      {e.bloqueo_motivo && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
          <span className="font-semibold">Bloqueado:</span>{" "}
          {BLOQUEO_EXPLICACION[e.bloqueo_motivo] ?? e.bloqueo_motivo}
        </div>
      )}

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Dato k="Venta MeLi" v={e.pack_id || e.order_id || "—"} mono />
        <Dato k="Reclamo" v={e.claim_id || "—"} mono />
        <Dato
          k="Factura"
          v={
            e.factura_numero
              ? `${e.factura_numero} (${e.factura_proveedor || "?"}) · ${pesos(e.factura_total)}`
              : "no localizada"
          }
        />
        <Dato k="CUFE factura" v={e.factura_cufe || "—"} mono />
        <Dato
          k="Reintegro al comprador"
          v={
            e.monto_reintegrado
              ? `${pesos(e.monto_reintegrado)} a cargo de ${e.financia === "meli" ? "Mercado Libre" : "el vendedor"}`
              : "—"
          }
        />
        <Dato k="Inventario" v={e.inventario_estado} />
        <Dato
          k="Nota crédito"
          v={e.nc_numero ? `${e.nc_numero} · ${pesos(e.nc_total)}` : "aún no emitida"}
        />
        <Dato k="Asiento contable" v={e.movimiento_id || "—"} mono />
      </dl>

      {Object.keys(e.enlaces ?? {}).length > 0 && (
        <div className="flex flex-wrap gap-3 text-sm">
          {Object.entries(e.enlaces).map(([k, url]) => (
            <a
              key={k}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-accent underline underline-offset-2"
            >
              {k.replace(/_/g, " ")}
            </a>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {puedeEmitir && (
          <button
            type="button"
            disabled={emitir.isPending}
            onClick={() => void lanzarEmision(necesitaAprobacion)}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {emitir.isPending
              ? "Emitiendo…"
              : necesitaAprobacion
                ? "Aprobar y emitir nota crédito"
                : "Emitir nota crédito"}
          </button>
        )}
        {e.producto_retorna !== 0 && e.inventario_estado === "pendiente" && (
          <>
            <button
              type="button"
              onClick={() => void inventario.mutateAsync({ id: e.id, recibido: true })}
              className="rounded-lg border border-border px-3 py-2 text-sm text-ink"
            >
              Producto recibido en bodega
            </button>
            <button
              type="button"
              onClick={() => void inventario.mutateAsync({ id: e.id, recibido: false })}
              className="rounded-lg border border-border px-3 py-2 text-sm text-muted"
            >
              No retorna (baja)
            </button>
          </>
        )}
      </div>

      {necesitaAprobacion && (
        <p className="text-xs text-muted">
          Este caso no se emite solo por política: rezago de Siigo, reembolso a cargo de MeLi, monto
          sobre el umbral, devolución parcial o cliente con identificación real. Al aprobarlo queda
          registrado tu nombre en la línea de tiempo.
        </p>
      )}

      {mensaje && (
        <div className="rounded-lg border border-border bg-surface p-3 text-sm text-ink">{mensaje}</div>
      )}

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          Línea de tiempo
        </h4>
        <ol className="flex flex-col gap-2 border-l border-border pl-4">
          {e.eventos.map((ev) => (
            <li key={ev.id} className="text-sm">
              <span className="font-mono text-[11px] text-muted">{ev.ts.slice(0, 16).replace("T", " ")}</span>
              <span className="mx-2 text-[11px] text-muted">·</span>
              <span className="text-[11px] text-muted">{ev.actor}</span>
              <p className="text-ink/90">{ev.resumen}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-col gap-2">
        <textarea
          value={texto}
          onChange={(ev) => setTexto(ev.target.value)}
          rows={2}
          placeholder="Deja una nota en el expediente (la verá quien lo abra después, persona o agente)"
          className="w-full rounded-lg border border-border bg-surface p-2 text-sm text-ink"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!texto.trim() || nota.isPending}
            onClick={async () => {
              await nota.mutateAsync({ id: e.id, texto: texto.trim() });
              setTexto("");
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-ink disabled:opacity-40"
          >
            Guardar nota
          </button>
        </div>
      </div>

      {e.estado !== "descartada" && !e.nc_numero && (
        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm text-muted">
            Este caso no necesita nota crédito
          </summary>
          <p className="mt-2 text-xs text-muted">
            Por ejemplo, un reclamo cerrado a favor del vendedor: no hubo reintegro, así que la
            factura sigue siendo válida. El expediente no se borra, queda como descartado con tu
            explicación.
          </p>
          <input
            value={motivoDescarte}
            onChange={(ev) => setMotivoDescarte(ev.target.value)}
            placeholder="¿Por qué no aplica?"
            className="mt-2 w-full rounded-lg border border-border bg-surface p-2 text-sm text-ink"
          />
          <button
            type="button"
            disabled={!motivoDescarte.trim() || descartar.isPending}
            onClick={async () => {
              await descartar.mutateAsync({ id: e.id, motivo: motivoDescarte.trim() });
              setMotivoDescarte("");
            }}
            className="mt-2 rounded-lg border border-border px-3 py-1.5 text-sm text-muted disabled:opacity-40"
          >
            Descartar expediente
          </button>
        </details>
      )}
    </div>
  );
}

function Dato({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] uppercase tracking-wider text-muted">{k}</dt>
      <dd className={`text-ink ${mono ? "font-mono text-xs" : ""}`}>{v}</dd>
    </div>
  );
}

function Fila({ a, onAbrir }: { a: Anulacion; onAbrir: (codigo: string) => void }) {
  const dias = diasDesde(a.abierta_en);
  return (
    <tr
      onClick={() => onAbrir(a.codigo)}
      className="cursor-pointer border-b border-border hover:bg-white/[0.03]"
    >
      <td className="px-3 py-2 font-mono text-xs text-ink">{a.codigo}</td>
      <td className="px-3 py-2">
        <EstadoChip estado={a.estado} />
      </td>
      <td className="px-3 py-2 text-sm text-ink/90">{MOTIVO_LABEL[a.motivo] ?? a.motivo}</td>
      <td className="px-3 py-2 font-mono text-xs text-muted">{a.pack_id || a.order_id || "—"}</td>
      <td className="px-3 py-2 font-mono text-xs text-muted">{a.factura_numero || "—"}</td>
      <td className="px-3 py-2 text-right text-sm tabular-nums text-ink">{pesos(a.factura_total)}</td>
      <td className="px-3 py-2 font-mono text-xs text-emerald-400">{a.nc_numero || ""}</td>
      <td
        className={`px-3 py-2 text-right text-xs tabular-nums ${
          dias != null && dias >= 7 && !a.nc_numero ? "font-semibold text-red-400" : "text-muted"
        }`}
      >
        {dias != null ? `${dias}d` : "—"}
      </td>
    </tr>
  );
}

const FILTROS = [
  { id: "abiertos", label: "Abiertas" },
  { id: "requiere_decision", label: "Requieren decisión" },
  { id: "bloqueada", label: "Bloqueadas" },
  { id: "cerrada", label: "Cerradas" },
  { id: "", label: "Todas" },
] as const;

export default function AnulacionesPanel() {
  const [filtro, setFiltro] = useState<string>("abiertos");
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);

  const consulta = useMemo(
    () =>
      q.trim()
        ? { q: q.trim() }
        : filtro === "abiertos"
          ? { abiertos: true }
          : filtro
            ? { estado: filtro }
            : {},
    [filtro, q],
  );
  const { data, isLoading } = useAnulaciones(consulta);
  const filas = data?.anulaciones ?? [];

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h2 className="text-lg font-bold text-ink">Anulaciones y notas crédito</h2>
        <p className="text-sm text-muted">
          Cada venta anulada —cancelación, devolución, reclamo o reembolso— abre un expediente que se
          cierra cuando su nota crédito queda emitida, publicada en MeLi y posteada al libro mayor.
        </p>
      </div>

      <Deuda />

      <div className="flex flex-wrap items-center gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => {
              setFiltro(f.id);
              setQ("");
            }}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              filtro === f.id && !q
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-muted hover:text-ink"
            }`}
          >
            {f.label}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por código, pack, factura o motivo…"
          className="ml-auto w-64 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink"
        />
      </div>

      {abierto && <Expediente codigo={abierto} onCerrar={() => setAbierto(null)} />}

      <div className="overflow-x-auto rounded-xl border border-border bg-surface-panel">
        <table className="min-w-[860px] w-full">
          <thead>
            <tr className="border-b border-border bg-white/[0.02] text-left text-[11px] uppercase tracking-wider text-muted">
              <th className="px-3 py-2 font-semibold">Expediente</th>
              <th className="px-3 py-2 font-semibold">Estado</th>
              <th className="px-3 py-2 font-semibold">Motivo</th>
              <th className="px-3 py-2 font-semibold">Venta</th>
              <th className="px-3 py-2 font-semibold">Factura</th>
              <th className="px-3 py-2 text-right font-semibold">Valor</th>
              <th className="px-3 py-2 font-semibold">Nota crédito</th>
              <th className="px-3 py-2 text-right font-semibold">Antigüedad</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((a) => (
              <Fila key={a.id} a={a} onAbrir={setAbierto} />
            ))}
          </tbody>
        </table>
        {!isLoading && !filas.length && (
          <p className="p-6 text-center text-sm text-muted">
            {q ? "Ningún expediente coincide con esa búsqueda." : "Nada por aquí."}
          </p>
        )}
        {isLoading && <p className="p-6 text-center text-sm text-muted">Cargando…</p>}
      </div>
    </div>
  );
}
