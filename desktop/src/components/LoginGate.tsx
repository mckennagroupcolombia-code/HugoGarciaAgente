import { useState, type FormEvent } from "react";
import { useAuthStore } from "../stores/auth";

export default function LoginGate() {
  const setToken = useAuthStore((s) => s.setToken);
  const [value, setValue] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = value.trim();
    if (t) setToken(t);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-6 rounded-2xl border border-border bg-surface-panel p-8"
      >
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-xl bg-accent text-2xl font-bold text-white">
            M
          </div>
          <h1 className="text-xl font-semibold text-gray-100">
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
            className="w-full rounded-lg border border-border bg-surface-input px-3 py-2.5 text-sm text-gray-100 outline-none placeholder:text-muted/50 focus:border-accent"
            autoFocus
          />
        </div>

        <button
          type="submit"
          disabled={!value.trim()}
          className="w-full rounded-lg bg-accent py-2.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-40"
        >
          Ingresar
        </button>
      </form>
    </div>
  );
}
