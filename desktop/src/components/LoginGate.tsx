import { useState, type FormEvent } from "react";
import { useAuthStore } from "../stores/auth";

export default function LoginGate() {
  const setToken = useAuthStore((s) => s.setToken);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = value.trim();
    if (!t) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/preventa/pendientes", {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.status === 401) {
        setError(
          "Token rechazado por el servidor. Comprueba que en .env sea exactamente CHAT_API_TOKEN=... sin espacios alrededor del =, sin comillas salvo que el valor vaya entre comillas, y que no haya dos líneas CHAT_API_TOKEN (systemd usa la primera). Luego: sudo systemctl restart agente-pro",
        );
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error || `Error HTTP ${res.status}`);
        return;
      }
      setToken(t);
    } catch {
      setError("No se pudo conectar. ¿Flask en :8081 y URL http://localhost:8081/app ?");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-6 rounded-paper-xl border border-border bg-surface-panel p-8 shadow-paper"
      >
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-accent-sun text-2xl font-black text-ink shadow-[0_4px_0_#e8a838]">
            M
          </div>
          <h1 className="text-xl font-semibold text-ink">
            McKenna Group
          </h1>
          <p className="mt-1 text-sm text-muted">Panel de Operaciones</p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-muted">
            Token de acceso
          </label>
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="CHAT_API_TOKEN"
            className="w-full rounded-lg border border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted/50 focus:border-accent"
            autoFocus
          />
        </div>

        {error && (
          <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!value.trim() || loading}
          className="w-full rounded-full bg-accent py-3 text-sm font-bold text-white shadow-[0_3px_0_rgba(0,0,0,0.15)] transition hover:-translate-y-px hover:bg-accent-hover disabled:opacity-40 disabled:hover:translate-y-0"
        >
          {loading ? "Comprobando…" : "Ingresar"}
        </button>
      </form>
    </div>
  );
}
