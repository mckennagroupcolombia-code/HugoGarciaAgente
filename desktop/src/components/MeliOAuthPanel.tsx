import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api } from "../api/client";

type EstadoMeliOAuth = {
  existe_archivo: boolean;
  app_id: string;
  tiene_client_secret: boolean;
  tiene_access_token: boolean;
  tiene_refresh_token: boolean;
  seller_id: number | string | null;
  redirect_uri: string;
};

const inputClass =
  "mt-1 w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink";
const labelClass = "block text-xs";
const cardClass = "space-y-3 rounded-xl border border-border bg-surface-panel p-4";

function PasoTitulo({ n, children }: { n: number; children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-extrabold text-white">
        {n}
      </span>
      {children}
    </h3>
  );
}

export default function MeliOAuthPanel() {
  const qc = useQueryClient();
  const [appId, setAppId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [codigoTg, setCodigoTg] = useState("");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [codeVerifier, setCodeVerifier] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const estadoQ = useQuery<EstadoMeliOAuth>({
    queryKey: ["meli-oauth-estado"],
    queryFn: () => api.get("/api/meli-oauth/estado"),
  });

  const conectado = Boolean(
    estadoQ.data?.tiene_access_token && estadoQ.data?.tiene_refresh_token,
  );

  const guardarMut = useMutation({
    mutationFn: (body: { app_id: string; client_secret?: string; redirect_uri?: string }) =>
      api.post<{ ok: boolean; app_id: string; tiene_client_secret: boolean }>(
        "/api/meli-oauth/credenciales",
        body,
      ),
    onSuccess: () => {
      setClientSecret("");
      void qc.invalidateQueries({ queryKey: ["meli-oauth-estado"] });
    },
  });

  const linkMut = useMutation({
    mutationFn: () =>
      api.get<{ url: string; redirect_uri: string; code_verifier: string }>(
        "/api/meli-oauth/auth-url",
      ),
    onSuccess: (data) => {
      setAuthUrl(data.url);
      setCodeVerifier(data.code_verifier);
      setCopiado(false);
    },
  });

  const activarMut = useMutation({
    mutationFn: (codigo: string) =>
      api.post<{ ok: boolean; mensaje: string; seller_id: number | string | null }>(
        "/api/meli-oauth/activar",
        { codigo_tg: codigo, code_verifier: codeVerifier },
      ),
    onSuccess: () => {
      setCodigoTg("");
      void qc.invalidateQueries({ queryKey: ["meli-oauth-estado"] });
    },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h2 className="text-base font-bold text-ink">Conexión MercadoLibre (OAuth)</h2>
        <p className="mt-1 text-xs text-muted">
          Reactiva la conexión cuando la app de MeLi queda inactiva o creas una nueva — sin
          terminal. Equivale a correr <code className="text-[11px]">scripts/activar_meli.py</code>.
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
                conectado
                  ? "bg-emerald-500/10 text-emerald-600"
                  : "bg-danger/10 text-danger"
              }`}
            >
              {conectado ? "● Conectado" : "● Sin conexión activa"}
            </span>
            <span className="text-muted">
              App ID: <span className="font-bold text-ink">{estadoQ.data.app_id || "—"}</span>
            </span>
            <span className="text-muted">
              Client Secret:{" "}
              <span className="font-bold text-ink">
                {estadoQ.data.tiene_client_secret ? "guardado" : "no configurado"}
              </span>
            </span>
            <span className="text-muted">
              Seller ID:{" "}
              <span className="font-bold text-ink">{estadoQ.data.seller_id ?? "—"}</span>
            </span>
          </div>
        )}
      </div>

      {/* Paso 1 */}
      <form
        className={cardClass}
        onSubmit={(e) => {
          e.preventDefault();
          if (!appId.trim()) return;
          guardarMut.mutate({
            app_id: appId.trim(),
            client_secret: clientSecret.trim() || undefined,
            redirect_uri: redirectUri.trim() || undefined,
          });
        }}
      >
        <PasoTitulo n={1}>Guardar Client ID / Client Secret</PasoTitulo>
        <p className="text-xs text-muted">
          Cópialos desde la pestaña "Credenciales" de tu app en developers.mercadolibre.com.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            <span className="font-bold text-muted">Client ID (app_id)</span>
            <input
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              placeholder={estadoQ.data?.app_id || "Ej. 3970048211162635"}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            <span className="font-bold text-muted">Client Secret</span>
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={
                estadoQ.data?.tiene_client_secret ? "•••• (ya guardado, dejar vacío para no cambiar)" : "Pegar Client Secret"
              }
              className={inputClass}
              autoComplete="off"
            />
          </label>
        </div>
        <label className={labelClass}>
          <span className="font-bold text-muted">Redirect URI</span>
          <input
            value={redirectUri}
            onChange={(e) => setRedirectUri(e.target.value)}
            placeholder={estadoQ.data?.redirect_uri || "https://bot.mckennagroup.co/callback"}
            className={inputClass}
          />
          <span className="mt-1 block text-[10px] text-muted">
            Debe coincidir exactamente con el "Redirect URI" configurado en la app de MeLi.
          </span>
        </label>
        <button
          type="submit"
          disabled={guardarMut.isPending || !appId.trim()}
          className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
        >
          {guardarMut.isPending ? "Guardando…" : "Guardar credenciales"}
        </button>
        {guardarMut.isSuccess && (
          <p className="text-xs font-semibold text-emerald-600">Credenciales guardadas.</p>
        )}
        {guardarMut.isError && (
          <p className="text-xs text-danger">{(guardarMut.error as Error).message}</p>
        )}
      </form>

      {/* Paso 2 */}
      <div className={cardClass}>
        <PasoTitulo n={2}>Generar link de autorización</PasoTitulo>
        <p className="text-xs text-muted">
          Ábrelo logueado con tu usuario vendedor de MeLi y acepta los permisos. Te redirige a una
          URL con <code className="text-[11px]">?code=TG-xxxx</code> — aunque la página no cargue,
          el código queda en la barra de direcciones.
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

      {/* Paso 3 */}
      <form
        className={cardClass}
        onSubmit={(e) => {
          e.preventDefault();
          if (!codigoTg.trim()) return;
          activarMut.mutate(codigoTg.trim());
        }}
      >
        <PasoTitulo n={3}>Pegar el código y activar</PasoTitulo>
        <p className="text-xs text-muted">
          El código caduca en ~10 minutos y es de un solo uso.
        </p>
        {!codeVerifier && (
          <p className="text-xs text-amber-600">
            Aún no generaste el link en el paso 2 en esta sesión del panel — si esta app exige
            PKCE, el canje fallará con "code_verifier is a required parameter". Genera el link de
            nuevo arriba y usa el código que te dé esa misma vez.
          </p>
        )}
        <label className={labelClass}>
          <span className="font-bold text-muted">Código de autorización</span>
          <input
            value={codigoTg}
            onChange={(e) => setCodigoTg(e.target.value)}
            placeholder="TG-xxxxxxxx"
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          disabled={activarMut.isPending || !codigoTg.trim()}
          className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
        >
          {activarMut.isPending ? "Activando…" : "Activar conexión"}
        </button>
        {activarMut.isSuccess && (
          <p
            className={`text-xs font-semibold ${
              activarMut.data.ok ? "text-emerald-600" : "text-danger"
            }`}
          >
            {activarMut.data.mensaje}
          </p>
        )}
        {activarMut.isError && (
          <p className="text-xs text-danger">{(activarMut.error as Error).message}</p>
        )}
      </form>

      {/* Paso 4 — recordatorio manual */}
      <div className={`${cardClass} border-amber-500/30 bg-amber-500/5`}>
        <PasoTitulo n={4}>Revisar en el panel de MeLi (no automatizable desde aquí)</PasoTitulo>
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
          <li>
            <span className="font-bold text-ink">Callback URL</span> en Notificaciones:{" "}
            <code className="text-[11px]">https://bot.mckennagroup.co/notifications</code> (puerto
            8080, webhook_meli.py).
          </li>
          <li>
            <span className="font-bold text-ink">Tópicos habilitados</span>: questions, orders_v2,
            messages, shipments (y claims/mediations/returns si están disponibles). Si falta uno,
            ese flujo queda mudo sin avisar.
          </li>
        </ul>
      </div>
    </div>
  );
}
