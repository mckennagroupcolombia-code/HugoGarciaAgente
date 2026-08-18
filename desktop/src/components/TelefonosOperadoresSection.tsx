import { useCallback, useEffect, useMemo, useState } from "react";
import { useTicketsAuth } from "../stores/ticketsAuth";

export interface UsuarioTelefono {
  id: number;
  nombre: string;
  username: string;
  email?: string | null;
  telefono?: string | null;
  activo: number;
  rol: { id: number; nombre: string; nivel: number } | null;
}

function normalizarTelefonoInput(raw: string): string {
  const s = raw.replace(/\D/g, "");
  if (!s) return "";
  if (s.length === 10 && s.startsWith("3")) return `57${s}`;
  return s;
}

function telefonoConfigurado(t: string | undefined | null): boolean {
  return Boolean(normalizarTelefonoInput(t || ""));
}

async function ticketsFetch(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`/api/tickets${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...init?.headers,
    },
  });
}

export default function TelefonosOperadoresSection({
  className = "",
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { token } = useTicketsAuth();
  const [usuarios, setUsuarios] = useState<UsuarioTelefono[]>([]);
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [filtro, setFiltro] = useState("");
  const [toast, setToast] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const cargar = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await ticketsFetch("/usuarios", token);
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || `Error ${r.status}`);
      const list = Array.isArray(data) ? (data as UsuarioTelefono[]) : [];
      list.sort((a, b) => {
        if (a.activo !== b.activo) return b.activo - a.activo;
        return a.nombre.localeCompare(b.nombre, "es");
      });
      setUsuarios(list);
      const next: Record<number, string> = {};
      for (const u of list) {
        next[u.id] = u.telefono || "";
      }
      setDraft(next);
    } catch (e: unknown) {
      setToast({
        type: "err",
        text: e instanceof Error ? e.message : "No se pudo cargar usuarios",
      });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void cargar(); }, [cargar]);

  const visibles = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    if (!q) return usuarios;
    return usuarios.filter(
      (u) =>
        u.nombre.toLowerCase().includes(q)
        || u.username.toLowerCase().includes(q)
        || (u.email || "").toLowerCase().includes(q),
    );
  }, [usuarios, filtro]);

  const pendientes = useMemo(
    () => usuarios.filter((u) => (draft[u.id] ?? "") !== (u.telefono || "")),
    [usuarios, draft],
  );

  const sinTelefonoActivos = useMemo(
    () => usuarios.filter((u) => u.activo && !telefonoConfigurado(draft[u.id] ?? u.telefono)),
    [usuarios, draft],
  );

  function flash(type: "ok" | "err", text: string) {
    setToast({ type, text });
    setTimeout(() => setToast(null), 4000);
  }

  async function guardarUsuario(u: UsuarioTelefono) {
    if (!token) return;
    const raw = draft[u.id] ?? "";
    const telefono = normalizarTelefonoInput(raw) || null;
    setSavingId(u.id);
    try {
      const r = await ticketsFetch(`/usuarios/${u.id}`, token, {
        method: "PUT",
        body: JSON.stringify({ telefono }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || `Error ${r.status}`);
      setUsuarios((prev) =>
        prev.map((x) => (x.id === u.id ? { ...x, telefono } : x)),
      );
      setDraft((d) => ({ ...d, [u.id]: telefono || "" }));
      flash("ok", `Teléfono de ${u.nombre} guardado`);
    } catch (e: unknown) {
      flash("err", e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSavingId(null);
    }
  }

  async function guardarTodos() {
    if (!token || pendientes.length === 0) return;
    setSavingAll(true);
    let ok = 0;
    let fail = 0;
    for (const u of pendientes) {
      try {
        const telefono = normalizarTelefonoInput(draft[u.id] ?? "") || null;
        const r = await ticketsFetch(`/usuarios/${u.id}`, token, {
          method: "PUT",
          body: JSON.stringify({ telefono }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error);
        setUsuarios((prev) =>
          prev.map((x) => (x.id === u.id ? { ...x, telefono } : x)),
        );
        setDraft((d) => ({ ...d, [u.id]: telefono || "" }));
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    setSavingAll(false);
    if (fail === 0) flash("ok", `${ok} teléfono(s) actualizado(s)`);
    else flash("err", `${ok} guardados, ${fail} con error`);
  }

  async function probarNota(u: UsuarioTelefono) {
    if (!token) return;
    const numero = normalizarTelefonoInput(draft[u.id] ?? u.telefono ?? "");
    if (!numero) {
      flash("err", "Configura y guarda un número antes de probar");
      return;
    }
    setTestingId(u.id);
    try {
      const r = await ticketsFetch(`/usuarios/${u.id}/probar-notificacion`, token, {
        method: "POST",
        body: JSON.stringify({ numero }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || `Error ${r.status}`);
      flash("ok", `Mensaje de prueba enviado a ${u.nombre}`);
    } catch (e: unknown) {
      flash("err", e instanceof Error ? e.message : "No se pudo enviar la prueba");
    } finally {
      setTestingId(null);
    }
  }

  return (
    <section
      className={`rounded-xl border border-border bg-surface-panel space-y-4 ${compact ? "p-4" : "p-5"} ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
            <span>📱</span> Teléfonos — notificaciones del panel
          </h3>
          <p className="text-xs text-muted mt-0.5 max-w-xl">
            Número WhatsApp de cada operador. El panel envía un mensaje de texto corto cuando le
            asignan tareas, resuelven sus solicitudes o terminan listas de compras. Formato Colombia:
            <code className="mx-1 text-[10px] text-ink">573001234567</code>
            o celular de 10 dígitos.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void cargar()}
            disabled={loading}
            className="rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-accent disabled:opacity-40"
          >
            Actualizar
          </button>
          {pendientes.length > 0 && (
            <button
              type="button"
              onClick={() => void guardarTodos()}
              disabled={savingAll}
              className="rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/25 disabled:opacity-40"
            >
              {savingAll ? "Guardando…" : `Guardar ${pendientes.length} cambio(s)`}
            </button>
          )}
        </div>
      </div>

      {sinTelefonoActivos.length > 0 && (
        <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {sinTelefonoActivos.length} usuario(s) activo(s) sin teléfono — no recibirán notificaciones.
        </p>
      )}

      {toast && (
        <p
          className={`rounded-lg px-3 py-2 text-xs font-semibold ${
            toast.type === "ok"
              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
              : "bg-red-500/10 text-red-400 border border-red-500/20"
          }`}
        >
          {toast.text}
        </p>
      )}

      <input
        type="search"
        placeholder="Buscar por nombre, alias o correo…"
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        className="w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-ink outline-none focus:border-accent"
      />

      {loading ? (
        <p className="py-6 text-center text-sm text-muted">Cargando usuarios…</p>
      ) : visibles.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Sin resultados</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-hover text-[11px] font-bold uppercase tracking-wide text-muted">
                <th className="px-3 py-2">Usuario</th>
                <th className="px-3 py-2">Rol</th>
                <th className="px-3 py-2 min-w-[200px]">WhatsApp</th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((u) => {
                const dirty = (draft[u.id] ?? "") !== (u.telefono || "");
                const ok = telefonoConfigurado(draft[u.id] ?? u.telefono);
                return (
                  <tr
                    key={u.id}
                    className={`border-b border-border/60 last:border-0 ${
                      !u.activo ? "opacity-50" : ""
                    }`}
                  >
                    <td className="px-3 py-2.5">
                      <p className="font-semibold text-ink">{u.nombre}</p>
                      <p className="text-[11px] text-muted font-mono">@{u.username}</p>
                      {!u.activo && (
                        <span className="text-[10px] font-bold text-red-400">Inactivo</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted">{u.rol?.nombre ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <input
                          type="tel"
                          inputMode="numeric"
                          placeholder="573001234567"
                          value={draft[u.id] ?? ""}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, [u.id]: e.target.value }))
                          }
                          className="w-full min-w-[140px] rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-xs text-ink outline-none focus:border-accent"
                        />
                        <span
                          title={ok ? "Configurado" : "Sin número"}
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            ok ? "bg-emerald-400" : "bg-amber-400"
                          }`}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1.5 flex-wrap">
                        <button
                          type="button"
                          disabled={!dirty || savingId === u.id}
                          onClick={() => void guardarUsuario(u)}
                          className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-bold text-ink hover:border-accent disabled:opacity-30"
                        >
                          {savingId === u.id ? "…" : "Guardar"}
                        </button>
                        <button
                          type="button"
                          disabled={!ok || testingId === u.id}
                          onClick={() => void probarNota(u)}
                          className="rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-bold text-accent hover:bg-accent/20 disabled:opacity-30"
                        >
                          {testingId === u.id ? "…" : "Probar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
