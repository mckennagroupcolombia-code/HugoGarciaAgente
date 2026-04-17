import { useMetricas } from "../hooks/useMetricas";
import { useStatus } from "../hooks/useStatus";
import { usePreventa } from "../hooks/usePreventa";

function StatCard({
  label,
  value,
  sub,
  color = "text-gray-100",
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-panel p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

function ServiceBadge({ name, ok }: { name: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
      <span className={`h-2.5 w-2.5 rounded-full ${ok ? "bg-success" : "bg-danger"}`} />
      <span className="text-sm text-gray-100">{name}</span>
    </div>
  );
}

export default function Dashboard() {
  const { data: m, isLoading: loadingM } = useMetricas();
  const { data: status } = useStatus();
  const { data: prev } = usePreventa();

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
        <h2 className="text-lg font-semibold text-gray-100">Dashboard</h2>
        {m?.fecha && (
          <span className="text-xs text-muted">{m.fecha}</span>
        )}
      </div>

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
          color="text-accent"
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
          label="Version"
          value={status?.version ?? "-"}
          sub={status?.estado ?? ""}
        />
      </div>
    </div>
  );
}
