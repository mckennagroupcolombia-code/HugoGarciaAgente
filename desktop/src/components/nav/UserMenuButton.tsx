import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../../stores/app";
import { useTicketsAuth } from "../../stores/ticketsAuth";
import { useAuthStore } from "../../stores/auth";
import UserAvatar from "../UserAvatar";
import { useProfilePhotoPending } from "../../stores/profilePhotoPending";
import { usePreventa } from "../../hooks/usePreventa";
import { usePostventa } from "../../hooks/usePostventa";
import { api } from "../../api/client";
import { cerrarSesionPanel } from "../../hooks/usePanelSession";
import { modoAvanzadoEfectivo } from "../../lib/adminAccess";
import { useUiMode } from "../../stores/uiMode";
import { flushSaveUserUiPreferences } from "../../lib/userThemeSync";
import { Icon } from "../../icons";

/** Reemplaza la tarjeta de perfil + ajustes + logout que antes vivían en el
 * sidebar izquierdo (ya retirado) — todo cabe en este menú del avatar, en el
 * cabezote, sin ocupar una franja permanente de pantalla. */
export default function UserMenuButton() {
  const panel = useAppStore((s) => s.panel);
  const setPanel = useAppStore((s) => s.setPanel);
  const { user, token, clear: clearTickets } = useTicketsAuth();
  const clearMain = useAuthStore((s) => s.clear);
  const setFotoPendiente = useProfilePhotoPending((s) => s.setFile);
  const { advanced, toggleAdvanced } = useUiMode();
  const advancedEfectivo = modoAvanzadoEfectivo(user, advanced);
  const { data: preventaData } = usePreventa();
  const { data: postventaData } = usePostventa();
  const totalAlerts = (preventaData?.total ?? 0) + (postventaData?.total ?? 0);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fotoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user || !token) return null;

  function elegirFotoPerfil(file: File) {
    setFotoPendiente(file);
    setPanel("perfil");
    setOpen(false);
    if (fotoInputRef.current) fotoInputRef.current.value = "";
  }

  async function logout() {
    setOpen(false);
    await flushSaveUserUiPreferences(token!);
    let sid = "";
    try { sid = sessionStorage.getItem("mckenna-panel-session-uuid") ?? ""; } catch { /* */ }
    await cerrarSesionPanel(token!);
    try { await api.post("/api/tickets/auth/logout", { session_uuid: sid }); } catch { /* */ }
    clearTickets();
    clearMain();
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={user.nombre}
        aria-label="Cuenta"
        className="mck-press relative shrink-0 rounded-full ring-2 ring-transparent transition hover:ring-accent/30"
      >
        <UserAvatar user={user} token={token} size="sm" />
        {totalAlerts > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-[9px] font-bold text-white">
            {totalAlerts > 9 ? "9+" : totalAlerts}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-border bg-surface-panel/95 p-2 shadow-paper-lg backdrop-blur-md">
          <input
            ref={fotoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) elegirFotoPerfil(f); }}
          />
          <button
            type="button"
            onClick={() => fotoInputRef.current?.click()}
            title="Cambiar foto de perfil"
            className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left hover:bg-surface-hover"
          >
            <UserAvatar user={user} token={token} />
            <span className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-extrabold leading-tight text-ink">{user.nombre}</p>
              <p className="truncate text-[11px] leading-tight text-muted">
                {user.rol?.nombre ?? user.departamento?.nombre ?? `@${user.username}`}
              </p>
            </span>
          </button>

          <div className="my-1.5 h-px bg-border/60" />

          <button
            type="button"
            onClick={() => { setPanel("perfil"); setOpen(false); }}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold ${panel === "perfil" ? "bg-accent/10 text-accent" : "text-ink-secondary hover:bg-surface-hover hover:text-ink"}`}
          >
            <Icon name="user" size={16} weight="duotone" /> Mi perfil
          </button>
          <button
            type="button"
            onClick={() => { setPanel("settings"); setOpen(false); }}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold ${panel === "settings" ? "bg-accent/10 text-accent" : "text-ink-secondary hover:bg-surface-hover hover:text-ink"}`}
          >
            <Icon name="wrench" size={16} weight="duotone" /> Ajustes
          </button>
          <button
            type="button"
            onClick={toggleAdvanced}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold ${advancedEfectivo ? "text-accent" : "text-ink-secondary hover:bg-surface-hover hover:text-ink"}`}
          >
            <Icon name={advancedEfectivo ? "flask" : "lock"} size={16} weight="duotone" />
            {advancedEfectivo ? "Modo avanzado activo" : "Activar modo avanzado"}
          </button>

          <div className="my-1.5 h-px bg-border/60" />

          <button
            type="button"
            onClick={() => void logout()}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold text-muted hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
          >
            <Icon name="signOut" size={16} weight="duotone" /> Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}
