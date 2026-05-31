import { useMetricas } from "../hooks/useMetricas";
import { useStatus } from "../hooks/useStatus";
import { usePreventa } from "../hooks/usePreventa";
import { usePanelMetricas, usePanelMiResumen } from "../hooks/usePanelMetricas";
import { useTicketsAuth } from "../stores/ticketsAuth";

function StatCard({
  label,
  value,
  sub,
  color = "text-ink",
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="rounded-paper border border-border bg-surface-panel p-4 shadow-paper-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

function ServiceBadge({ name, ok }: { name: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-paper border border-border bg-surface px-3 py-2 shadow-paper-sm">
      <span className={`h-2.5 w-2.5 rounded-full ${ok ? "bg-success" : "bg-danger"}`} />
      <span className="text-sm text-ink">{name}</span>
    </div>
  );
}

export default function Dashboard() {
  const { data: m, isLoading: loadingM } = useMetricas();
  const { data: status } = useStatus();
  const { data: prev } = usePreventa();
  const user = useTicketsAuth((s) => s.user);
  const isAdmin = (user?.rol?.nivel ?? 0) >= 3;
  const { data: panelOps } = usePanelMetricas(isAdmin);
  const { data: miResumen } = usePanelMiResumen(!isAdmin && !!user);

  if (loadingM) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-muted">Cargando metricas...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">Dashboard</h2>
        {m?.fecha && (
          <span className="text-xs text-muted">{m.fecha}</span>
        )}
      </div>

      {!isAdmin && miResumen?.resumen && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="Tu sesión hoy"
            value={`${miResumen.resumen.minutos_sesion} min`}
            sub={miResumen.resumen.en_linea ? "En línea ahora" : "Panel"}
          />
          <StatCard
            label="Tareas completadas"
            value={miResumen.resumen.tareas_completadas}
            sub="hoy en el panel"
            color="text-accent"
          />
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="WhatsApp"
          value={m?.mensajes_whatsapp ?? 0}
          sub="mensajes hoy"
        />
        <StatCard
          label="Preguntas MeLi"
          value={m?.preguntas_meli ?? 0}
          sub="preventa"
          color="text-accent-sky"
        />
        <StatCard
          label="Ordenes MeLi"
          value={m?.ordenes_meli ?? 0}
          sub="pagadas"
          color="text-success"
        />
        <StatCard
          label="Pendientes"
          value={prev?.total ?? 0}
          sub="preventa sin responder"
          color={(prev?.total ?? 0) > 0 ? "text-warning" : "text-success"}
        />
      </div>

      {/* Services status */}
      {status && (
        <section>
          <h3 className="mb-3 text-sm font-medium text-muted">Servicios conectados</h3>
          <div className="flex flex-wrap gap-2">
            <ServiceBadge name="MercadoLibre" ok={status.servicios.mercadolibre} />
            <ServiceBadge name="Google Sheets" ok={status.servicios.google} />
            <ServiceBadge name="Siigo ERP" ok={status.servicios.siigo} />
            <ServiceBadge name="Token MeLi" ok={m?.token_meli ?? false} />
          </div>
        </section>
      )}

      {/* Extra metrics */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          label="Posventa"
          value={m?.mensajes_posventa ?? 0}
          sub="mensajes hoy"
        />
        <StatCard
          label="Pagos confirmados"
          value={m?.pagos_confirmados ?? 0}
          sub="hoy"
          color="text-success"
        />
        <StatCard
          label="Chat web"
          value={m?.web_chat_interacciones_hoy ?? 0}
          sub={
            (m?.web_chat_sin_revisar ?? 0) > 0
              ? `${m?.web_chat_sin_revisar} sin revisar`
              : "interacciones hoy"
          }
          color={
            (m?.web_chat_sin_revisar ?? 0) > 0
              ? "text-warning"
              : "text-accent-sky"
          }
        />
        <StatCard
          label="Version"
          value={status?.version ?? "-"}
          sub={status?.estado ?? ""}
        />
      </div>

      {isAdmin && panelOps && panelOps.operadores.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-medium text-muted">
            Operadores en panel ({panelOps.fecha})
          </h3>
          <div className="overflow-x-auto rounded-paper border border-border bg-surface-panel shadow-paper-sm">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 font-medium">Operador</th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                  <th className="px-3 py-2 font-medium text-right">Min. sesión</th>
                  <th className="px-3 py-2 font-medium text-right">Tareas</th>
                  <th className="px-3 py-2 font-medium">Sección</th>
                </tr>
              </thead>
              <tbody>
                {panelOps.operadores.map((op) => (
                  <tr
                    key={op.usuario_id}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="px-3 py-2.5 font-medium text-ink">
                      {op.nombre}
                      <span className="ml-1 text-xs font-normal text-muted">
                        @{op.username}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                          op.en_linea ? "text-success" : "text-muted"
                        }`}
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${
                            op.en_linea ? "bg-success" : "bg-border"
                          }`}
                        />
                        {op.en_linea ? "En línea" : "Desconectado"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">
                      {op.minutos_sesion}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-accent">
                      {op.tareas_completadas}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted">
                      {op.panel_actual ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">
            Tareas: tickets/solicitudes resueltos, pasos completados, preventa MeLi, etc.
            Tiempo de sesión solo cuenta pestaña activa (heartbeat cada minuto).
          </p>
        </section>
      )}
    </div>
  );
}
