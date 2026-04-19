import { useAuthStore } from "../stores/auth";
import { useStatus } from "../hooks/useStatus";

export default function Settings() {
  const token = useAuthStore((s) => s.token);
  const logout = useAuthStore((s) => s.clear);
  const { data: status } = useStatus();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h2 className="text-lg font-semibold text-ink">Ajustes</h2>

      <section className="rounded-xl border border-border bg-surface-panel p-5">
        <h3 className="mb-3 text-sm font-medium text-ink">Sesion</h3>
        <p className="mb-4 text-sm text-muted">
          Token: <code className="text-xs text-ink-muted">{token.slice(0, 8)}...{token.slice(-4)}</code>
        </p>
        <button
          onClick={logout}
          className="rounded-lg bg-danger/15 px-4 py-2 text-sm font-medium text-danger transition hover:bg-danger/25"
        >
          Cerrar sesion
        </button>
      </section>

      {status && (
        <section className="rounded-xl border border-border bg-surface-panel p-5">
          <h3 className="mb-3 text-sm font-medium text-ink">Sistema</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Version</dt>
              <dd className="text-ink">{status.version}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Estado</dt>
              <dd className="text-success">{status.estado}</dd>
            </div>
          </dl>
        </section>
      )}
    </div>
  );
}
