import { useMetricas } from "../hooks/useMetricas";
import { useStatus } from "../hooks/useStatus";
import { usePreventa } from "../hooks/usePreventa";
import { usePanelMetricas, usePanelMiResumen } from "../hooks/usePanelMetricas";
import { useTicketsAuth } from "../stores/ticketsAuth";
import { esAdminPanel } from "../lib/adminAccess";
import { IllustrationIcon } from "../icons/IllustrationIcon";
import type { IllustrationTone } from "../icons/IllustrationIcon";
import type { UiIconName } from "../icons";

function StatCard({
  label,
  value,
  sub,
  color = "text-ink",
  icon,
  tone = "accent",
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  icon: UiIconName;
  tone?: IllustrationTone;
}) {
  return (
    <div className="mck-card mck-card-interactive group flex gap-3 p-4">
      <IllustrationIcon
        name={icon}
        size={36}
        tone={tone}
        className="mck-illus-icon--hoverable shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        <p className={`mt-0.5 text-2xl font-bold tabular-nums transition-colors ${color}`}>{value}</p>
        {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
    </div>
  );
}

function ServiceBadge({ name, ok }: { name: string; ok: boolean }) {
  return (
    <div
      className={`mck-card mck-card-interactive flex items-center gap-2 px-3 py-2 ${
        ok ? "border-success/30" : "border-danger/30"
      }`}
    >
      <span
        className={`h-2.5 w-2.5 rounded-full transition-shadow ${
          ok ? "bg-success shadow-[0_0_8px_rgb(var(--mck-success)/0.5)]" : "bg-danger"
        }`}
      />
      <span className="text-sm font-medium text-ink">{name}</span>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="mck-skeleton h-24 w-full" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className="mck-skeleton h-24 rounded-paper" />
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: m, isLoading: loadingM } = useMetricas();
  const { data: status } = useStatus();
  const { data: prev } = usePreventa();
  const user = useTicketsAuth((s) => s.user);
  const isAdmin = esAdminPanel(user);
  const { data: panelOps } = usePanelMetricas(isAdmin);
  const { data: miResumen } = usePanelMiResumen(!isAdmin && !!user);

  if (loadingM) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <IllustrationIcon name="chartBar" size={40} tone="sky" className="mck-illus-icon--hoverable" />
          <h2 className="text-xl font-extrabold text-ink">Métricas del día</h2>
        </div>
        {m?.fecha && (
          <span className="mck-card shrink-0 px-3 py-1 text-xs font-semibold text-muted">{m.fecha}</span>
        )}
      </div>

      {!isAdmin && miResumen?.resumen && (
        <div className="mck-stagger grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="Tu sesión hoy"
            value={`${miResumen.resumen.minutos_sesion} min`}
            sub={miResumen.resumen.en_linea ? "En línea ahora" : "Panel"}
            icon="clock"
            tone="plum"
          />
          <StatCard
            label="Tareas completadas"
            value={miResumen.resumen.tareas_completadas}
            sub="hoy en el panel"
            color="text-accent"
            icon="check"
            tone="leaf"
          />
        </div>
      )}

      <div className="mck-stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="WhatsApp"
          value={m?.mensajes_whatsapp ?? 0}
          sub="mensajes hoy"
          icon="chat"
          tone="leaf"
        />
        <StatCard
          label="Preguntas MeLi"
          value={m?.preguntas_meli ?? 0}
          sub="preventa"
          color="text-accent-sky"
          icon="question"
          tone="sky"
        />
        <StatCard
          label="Ordenes MeLi"
          value={m?.ordenes_meli ?? 0}
          sub="pagadas"
          color="text-success"
          icon="cart"
          tone="sun"
        />
        <StatCard
          label="Pendientes"
          value={prev?.total ?? 0}
          sub="preventa sin responder"
          color={(prev?.total ?? 0) > 0 ? "text-warning" : "text-success"}
          icon="bell"
          tone={(prev?.total ?? 0) > 0 ? "sun" : "leaf"}
        />
      </div>

      {status && (
        <section>
          <h3 className="mb-3 text-sm font-medium text-muted">Servicios conectados</h3>
          <div className="mck-stagger flex flex-wrap gap-2">
            <ServiceBadge name="MercadoLibre" ok={status.servicios.mercadolibre} />
            <ServiceBadge name="Google Sheets" ok={status.servicios.google} />
            <ServiceBadge name="Siigo ERP" ok={status.servicios.siigo} />
            <ServiceBadge name="Token MeLi" ok={m?.token_meli ?? false} />
          </div>
        </section>
      )}

      <div className="mck-stagger grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          label="Posventa"
          value={m?.mensajes_posventa ?? 0}
          sub="mensajes hoy"
          icon="inbox"
          tone="rose"
        />
        <StatCard
          label="Pagos confirmados"
          value={m?.pagos_confirmados ?? 0}
          sub="hoy"
          color="text-success"
          icon="check"
          tone="leaf"
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
          icon="phone"
          tone="plum"
        />
        <StatCard
          label="Version"
          value={status?.version ?? "-"}
          sub={status?.estado ?? ""}
          icon="nut"
          tone="neutral"
        />
      </div>

      {isAdmin && panelOps && panelOps.operadores.length > 0 && (
        <section className="mck-animate-enter">
          <h3 className="mb-3 text-sm font-medium text-muted">
            Operadores en panel ({panelOps.fecha})
          </h3>
          <div className="mck-card overflow-x-auto">
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
                    className="border-b border-border/60 transition-colors last:border-0 hover:bg-surface-hover/60"
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
                            op.en_linea ? "bg-success animate-pulse" : "bg-border"
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
