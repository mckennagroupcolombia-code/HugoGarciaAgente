import { useState, useRef, useEffect } from "react";
import { useTicketsAuth, type TicketsUser } from "../stores/ticketsAuth";
import { useAppStore } from "../stores/app";
import { useProfilePhotoPending } from "../stores/profilePhotoPending";
import { Icon } from "../icons";
import UserAvatar from "./UserAvatar";
import { uploadProfilePhoto, removeProfilePhoto, isImageFile, ticketsUploadUrl } from "../lib/profilePhoto";
import ImageLightbox from "./ImageLightbox";

function tapi(path: string, token: string, options: RequestInit = {}) {
  const isForm = options.body instanceof FormData;
  const hasJsonBody = options.body != null && options.body !== "" && !isForm;
  const method = (options.method ?? "GET").toUpperCase();
  let url = `/api/tickets${path}`;
  if (method === "GET" || method === "HEAD") {
    url += `${path.includes("?") ? "&" : "?"}_t=${Date.now()}`;
  }
  return fetch(url, {
    cache: "no-store",
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Pragma: "no-cache",
      ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  }).then(async (r) => {
    let data: any;
    try {
      data = await r.json();
    } catch {
      if (!r.ok) throw new Error(`Error ${r.status}`);
      return {};
    }
    if (!r.ok) throw new Error(data?.error || `Error ${r.status}`);
    return data;
  });
}

function PerfilContent({
  token,
  user,
  onUserUpdated,
}: {
  token: string;
  user: TicketsUser;
  onUserUpdated: (u: TicketsUser) => void;
}) {
  const setPanel = useAppStore((s) => s.setPanel);
  const setCentroMandoView = useAppStore((s) => s.setCentroMandoView);
  const pendingFromSidebar = useProfilePhotoPending((s) => s.file);
  const clearPendingFromSidebar = useProfilePhotoPending((s) => s.setFile);

  const [nombre, setNombre] = useState(user.nombre);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingFoto, setUploadingFoto] = useState(false);
  const [fotoPendiente, setFotoPendiente] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [fotoAmpliada, setFotoAmpliada] = useState<string | null>(null);
  const fotoInputRef = useRef<HTMLInputElement>(null);

  const fotoUrl =
    previewUrl ?? (user.foto ? ticketsUploadUrl(user.foto, token, user.foto) : null);

  useEffect(() => {
    setNombre(user.nombre);
  }, [user.nombre]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!pendingFromSidebar) return;
    seleccionarFoto(pendingFromSidebar);
    clearPendingFromSidebar(null);
  }, [pendingFromSidebar, clearPendingFromSidebar]);

  function volver() {
    setPanel("hugo");
    setCentroMandoView("home");
  }

  function handleUserUpdated(u: TicketsUser) {
    onUserUpdated(u);
    setNombre(u.nombre);
  }

  function seleccionarFoto(file: File) {
    setMsg(null);
    if (!isImageFile(file)) {
      setMsg({ type: "err", text: "Selecciona una imagen (JPG, PNG, GIF o WEBP)." });
      return;
    }
    const localPreview = URL.createObjectURL(file);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return localPreview;
    });
    setFotoPendiente(file);
    if (fotoInputRef.current) fotoInputRef.current.value = "";
  }

  async function guardarFoto() {
    if (!fotoPendiente) return;
    setMsg(null);
    setUploadingFoto(true);
    try {
      const updated = await uploadProfilePhoto(token, fotoPendiente);
      handleUserUpdated(updated);
      setFotoPendiente(null);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setMsg({ type: "ok", text: "Foto guardada en tu perfil." });
    } catch (e: any) {
      setMsg({ type: "err", text: e?.message || "Error al guardar la foto" });
    } finally {
      setUploadingFoto(false);
    }
  }

  async function guardar(ev: React.FormEvent) {
    ev.preventDefault();
    setMsg(null);
    if (!nombre.trim()) {
      setMsg({ type: "err", text: "El nombre no puede estar vacío." });
      return;
    }
    if (password && password !== password2) {
      setMsg({ type: "err", text: "Las contraseñas no coinciden." });
      return;
    }
    if (password && password.length < 6) {
      setMsg({ type: "err", text: "La contraseña debe tener al menos 6 caracteres." });
      return;
    }
    setSaving(true);
    const habiaFotoPendiente = Boolean(fotoPendiente);
    try {
      if (fotoPendiente) {
        const updated = await uploadProfilePhoto(token, fotoPendiente);
        handleUserUpdated(updated);
        setFotoPendiente(null);
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
      }
      const body: { nombre: string; password?: string } = { nombre: nombre.trim() };
      if (password) body.password = password;
      const res = await tapi("/auth/me", token, { method: "PUT", body: JSON.stringify(body) });
      if (res.usuario) handleUserUpdated(res.usuario as TicketsUser);
      setPassword("");
      setPassword2("");
      setMsg({
        type: "ok",
        text: habiaFotoPendiente ? "Perfil y foto guardados en la base de datos." : "Perfil actualizado.",
      });
    } catch (e: any) {
      setMsg({ type: "err", text: e?.message || "Error al guardar" });
    } finally {
      setSaving(false);
    }
  }

  async function quitarFoto() {
    setMsg(null);
    setFotoPendiente(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    if (!user.foto) return;
    setUploadingFoto(true);
    try {
      const updated = await removeProfilePhoto(token);
      handleUserUpdated(updated);
      setMsg({ type: "ok", text: "Foto de perfil eliminada." });
    } catch (e: any) {
      setMsg({ type: "err", text: e?.message || "Error al quitar la foto" });
    } finally {
      setUploadingFoto(false);
    }
  }

  const hayFotoPendiente = Boolean(fotoPendiente);

  return (
    <div className="space-y-5 max-w-lg">
      {fotoAmpliada && <ImageLightbox url={fotoAmpliada} onClose={() => setFotoAmpliada(null)} />}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={volver}
          className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted transition hover:border-accent hover:text-accent"
        >
          ←
        </button>
        <h2 className="text-xl font-extrabold text-ink flex items-center gap-2">
          <Icon name="settings" size={22} weight="duotone" className="text-accent" />
          Mi perfil
        </h2>
      </div>

      <div className="rounded-paper border-2 border-border bg-surface-panel p-5 shadow-paper-sm space-y-3">
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            <button
              type="button"
              title={fotoUrl ? "Ampliar foto" : "Elegir foto"}
              disabled={uploadingFoto}
              onClick={() => {
                if (fotoUrl) setFotoAmpliada(fotoUrl);
                else fotoInputRef.current?.click();
              }}
              className={`group relative rounded-full transition disabled:opacity-60 ${
                fotoUrl ? "cursor-zoom-in hover:opacity-90" : "hover:opacity-90"
              }`}
            >
              <UserAvatar user={user} token={token} size="lg" previewUrl={previewUrl} />
              {uploadingFoto && (
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-[10px] font-bold text-white">
                  …
                </span>
              )}
              {fotoUrl && !uploadingFoto && (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/0 opacity-0 transition group-hover:bg-black/25 group-hover:opacity-100">
                  <Icon name="expand" size={22} weight="bold" className="text-white drop-shadow" />
                </span>
              )}
            </button>
            {fotoUrl && (
              <button
                type="button"
                title="Cambiar foto"
                disabled={uploadingFoto}
                onClick={() => fotoInputRef.current?.click()}
                className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface-panel bg-accent text-white shadow transition hover:bg-accent-hover disabled:opacity-50"
              >
                <Icon name="camera" size={14} weight="bold" />
              </button>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-extrabold text-ink">{nombre}</p>
            <p className="text-sm text-muted">@{user.username}</p>
            {user.email && (
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                <svg width="12" height="12" viewBox="0 0 48 48" fill="none" className="shrink-0">
                  <path d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34 6.5 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.5-.4-3.5z" fill="#FFC107"/>
                  <path d="M6.3 14.7l6.6 4.8C14.7 16.1 19 13 24 13c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34 6.5 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" fill="#FF3D00"/>
                  <path d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.3 26.8 36 24 36c-5.3 0-9.7-3.3-11.3-8H6.1C9.5 35.6 16.2 44 24 44z" fill="#4CAF50"/>
                  <path d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.4 44 33 44 24c0-1.2-.1-2.5-.4-3.5z" fill="#1976D2"/>
                </svg>
                {user.email}
              </p>
            )}
            <div className="mt-1 flex flex-wrap gap-2">
              {user.rol && (
                <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] font-bold text-muted">
                  {user.rol.nombre} · Nivel {user.rol.nivel}
                </span>
              )}
              {user.departamento && (
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                  style={{
                    background: `${user.departamento.color}22`,
                    color: user.departamento.color,
                  }}
                >
                  {user.departamento.nombre}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="border-t border-border pt-3 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">Foto de perfil</p>
          <input
            ref={fotoInputRef}
            type="file"
            accept="image/*,.jpg,.jpeg,.png,.gif,.webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) seleccionarFoto(f);
            }}
          />
          <div
            role="button"
            tabIndex={0}
            onClick={() => !uploadingFoto && fotoInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (!uploadingFoto) fotoInputRef.current?.click();
              }
            }}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const f = e.dataTransfer.files?.[0];
              if (f && !uploadingFoto) seleccionarFoto(f);
            }}
            className={`cursor-pointer rounded-paper border-2 border-dashed p-4 text-center transition ${
              hayFotoPendiente
                ? "border-amber-400 bg-amber-50/50 dark:bg-amber-950/20"
                : previewUrl || user.foto
                  ? "border-accent bg-surface-hover"
                  : "border-border hover:border-accent"
            }`}
          >
            {hayFotoPendiente ? (
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                Archivo listo: {fotoPendiente?.name}
                <span className="mt-1 block text-xs font-normal text-muted">Pulsa Guardar para subirlo a la base de datos</span>
              </p>
            ) : uploadingFoto ? (
              <p className="text-sm font-semibold text-muted">Guardando foto…</p>
            ) : previewUrl || user.foto ? (
              <p className="text-sm font-semibold text-accent">
                Toca o arrastra otra imagen para cambiar la foto
              </p>
            ) : (
              <p className="text-sm text-muted">
                Toca o arrastra una imagen (JPG, PNG, GIF, WEBP)
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={uploadingFoto}
              onClick={() => fotoInputRef.current?.click()}
              className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-ink transition hover:border-accent hover:text-accent disabled:opacity-50"
            >
              Elegir archivo
            </button>
            {fotoUrl && (
              <button
                type="button"
                disabled={uploadingFoto}
                onClick={() => setFotoAmpliada(fotoUrl)}
                className="inline-flex items-center gap-1.5 rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-ink transition hover:border-accent hover:text-accent disabled:opacity-50"
              >
                <Icon name="expand" size={14} weight="bold" className="shrink-0" />
                Ampliar
              </button>
            )}
            {hayFotoPendiente && (
              <button
                type="button"
                disabled={uploadingFoto}
                onClick={() => void guardarFoto()}
                className="inline-flex items-center gap-1.5 rounded-paper border-2 border-accent bg-accent px-3 py-1.5 text-xs font-bold text-white transition hover:bg-accent-hover disabled:opacity-50"
              >
                <Icon name="floppyDisk" size={14} weight="bold" className="shrink-0" />
                {uploadingFoto ? "Guardando..." : "Guardar foto"}
              </button>
            )}
            {(user.foto || previewUrl) && (
              <button
                type="button"
                disabled={uploadingFoto}
                onClick={() => void quitarFoto()}
                className="rounded-paper border-2 border-red-300 px-3 py-1.5 text-xs font-bold text-red-700 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
              >
                Quitar foto
              </button>
            )}
          </div>
          <p className="text-[11px] text-muted">
            La foto se guarda en la base de datos y aparece en el menú lateral.
          </p>
        </div>
      </div>

      <form onSubmit={guardar} className="rounded-paper border-2 border-border bg-surface-panel p-5 shadow-paper-sm space-y-4">
        <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">Editar datos</h3>
        <div>
          <label className="mb-1 block text-xs font-bold text-muted">Nombre para mostrar</label>
          <input
            className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-muted">Usuario (no editable)</label>
          <input
            disabled
            className="w-full rounded-paper border-2 border-border bg-surface-hover px-3 py-2 text-sm text-muted"
            value={user.username}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-muted">Nueva contraseña (opcional)</label>
          <input
            type="password"
            autoComplete="new-password"
            className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Dejar vacío para no cambiar"
          />
        </div>
        {password && (
          <div>
            <label className="mb-1 block text-xs font-bold text-muted">Confirmar contraseña</label>
            <input
              type="password"
              autoComplete="new-password"
              className="w-full rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
            />
          </div>
        )}
        {msg && (
          <p className={`rounded-lg px-3 py-2 text-xs font-semibold ${msg.type === "ok" ? "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300" : "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300"}`}>
            {msg.text}
          </p>
        )}
        <button
          type="submit"
          disabled={saving || uploadingFoto}
          className="inline-flex items-center gap-2 rounded-paper border-2 border-accent bg-accent px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          <Icon name="floppyDisk" size={16} weight="bold" className="shrink-0" />
          {saving ? "Guardando..." : hayFotoPendiente ? "Guardar todo" : "Guardar cambios"}
        </button>
      </form>
    </div>
  );
}

export default function PerfilPanel() {
  const { token, user, setAuth } = useTicketsAuth();
  if (!token || !user) return null;
  return (
    <PerfilContent
      token={token}
      user={user}
      onUserUpdated={(u) => setAuth(token, u)}
    />
  );
}
