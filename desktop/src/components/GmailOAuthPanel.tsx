import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";

type EstadoGmailOAuth = {
  valido: boolean;
  motivo: string | null;
  expira: string | null;
  existe_token: boolean;
  cliente_configurado: boolean;
  email: string | null;
  conectado_en: string | null;
  redirect_uri: string;
};

const cardClass = "space-y-3 rounded-xl border border-border bg-surface-panel p-4";
const PASO_1_REDIRECT_URI_FALLBACK = "https://bot.mckennagroup.co/api/gmail-oauth/callback";

function PasoTitulo({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-extrabold text-white">
        {n}
      </span>
      {children}
    </h3>
  );
}

export default function GmailOAuthPanel() {
  const qc = useQueryClient();
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [copiadoRedirect, setCopiadoRedirect] = useState(false);

  const estadoQ = useQuery<EstadoGmailOAuth>({
    queryKey: ["gmail-oauth-estado"],
    queryFn: () => api.get("/api/gmail-oauth/estado"),
    // Polling en vivo: mientras el panel está abierto, detecta solo cuando el
    // usuario termina de autorizar en la otra pestaña (o cuando se desautoriza).
    refetchInterval: 15000,
  });

  const conectado = Boolean(estadoQ.data?.valido);
  const redirectUri = estadoQ.data?.redirect_uri || PASO_1_REDIRECT_URI_FALLBACK;

  const linkMut = useMutation({
    mutationFn: () => api.get<{ url: string; redirect_uri: string }>("/api/gmail-oauth/auth-url"),
    onSuccess: (data) => {
      setAuthUrl(data.url);
      setCopiado(false);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["gmail-oauth-estado"] });
    },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h2 className="text-base font-bold text-ink">Conexión Gmail (OAuth)</h2>
        <p className="mt-1 text-xs text-muted">
          Reactiva el acceso a mckenna.group.colombia@gmail.com cuando el token expira o se
          desautoriza — sin terminal. Equivale a correr{" "}
          <code className="text-[11px]">scripts/reautorizar_gmail.py</code>.
        </p>
      </div>

      <div className={cardClass}>
        {estadoQ.isLoading && <p className="text-xs text-muted">Consultando estado…</p>}
        {estadoQ.isError && (
          <p className="text-xs text-danger">
            {(estadoQ.error as Error).message || "No se pudo consultar el estado."}
          </p>
        )}
        {estadoQ.data && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
            <span
              className={`rounded-full px-2 py-1 font-bold ${
                conectado ? "bg-emerald-500/10 text-emerald-600" : "bg-danger/10 text-danger"
              }`}
            >
              {conectado ? "● Conectado" : "● Sin conexión activa"}
            </span>
            {estadoQ.data.email && (
              <span className="text-muted">
                Cuenta: <span className="font-bold text-ink">{estadoQ.data.email}</span>
              </span>
            )}
            {!conectado && estadoQ.data.motivo && (
              <span className="text-muted">
                Motivo: <span className="font-bold text-ink">{estadoQ.data.motivo}</span>
              </span>
            )}
            <span className="text-muted">
              Cliente OAuth:{" "}
              <span className="font-bold text-ink">
                {estadoQ.data.cliente_configurado ? "configurado" : "falta credenciales_google.json"}
              </span>
            </span>
          </div>
        )}
      </div>

      {/* Aviso — requisito único en Google Cloud Console */}
      <div className={`${cardClass} border-amber-500/30 bg-amber-500/5`}>
        <PasoTitulo n={0}>Requisito único (no automatizable desde aquí)</PasoTitulo>
        <p className="text-xs text-muted">
          Agrega este <span className="font-bold text-ink">Redirect URI</span> en Google Cloud
          Console → APIs &amp; Services → Credentials → tu cliente OAuth (Web) → "Authorized
          redirect URIs". Sin esto, el paso 1 fallará con{" "}
          <code className="text-[11px]">redirect_uri_mismatch</code> al volver de Google.
        </p>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
          <code className="flex-1 break-all text-[11px] text-ink">{redirectUri}</code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(redirectUri).then(() => {
                setCopiadoRedirect(true);
                window.setTimeout(() => setCopiadoRedirect(false), 2000);
              });
            }}
            className="shrink-0 rounded-lg border border-border px-2 py-1 text-[10px] font-bold text-ink hover:bg-surface-panel"
          >
            {copiadoRedirect ? "Copiado ✓" : "Copiar"}
          </button>
        </div>
      </div>

      {/* Paso 1 */}
      <div className={cardClass}>
        <PasoTitulo n={1}>Generar link de autorización</PasoTitulo>
        <p className="text-xs text-muted">
          Ábrelo logueado con mckenna.group.colombia@gmail.com y acepta los permisos. Al aceptar,
          Google te redirige de vuelta y el servidor completa la conexión solo — no hay que copiar
          ni pegar nada. El estado de arriba se actualiza automáticamente en unos segundos.
        </p>
        <button
          type="button"
          onClick={() => linkMut.mutate()}
          disabled={linkMut.isPending}
          className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
        >
          {linkMut.isPending ? "Generando…" : "Generar link de autorización"}
        </button>
        {linkMut.isError && (
          <p className="text-xs text-danger">{(linkMut.error as Error).message}</p>
        )}
        {authUrl && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
            <a
              href={authUrl}
              target="_blank"
              rel="noreferrer"
              className="flex-1 break-all text-[11px] text-accent underline"
            >
              {authUrl}
            </a>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(authUrl).then(() => {
                  setCopiado(true);
                  window.setTimeout(() => setCopiado(false), 2000);
                });
              }}
              className="shrink-0 rounded-lg border border-border px-2 py-1 text-[10px] font-bold text-ink hover:bg-surface-panel"
            >
              {copiado ? "Copiado ✓" : "Copiar"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
