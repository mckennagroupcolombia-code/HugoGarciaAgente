import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { modoAvanzadoEfectivo } from "../../lib/adminAccess";
import { ETAPAS_APP, ORIGEN_APP, type EtapaApp } from "../../lib/flujoApp";
import { puedeVerSeccionPanel } from "../../lib/panelAccess";
import { PANEL_INFO } from "../../lib/panelInfo";
import { useAppStore, type Panel } from "../../stores/app";
import { useTicketsAuth } from "../../stores/ticketsAuth";
import { useUiMode } from "../../stores/uiMode";
import InicioNavTabs from "./InicioNavTabs";

/**
 * La navegación de toda la app como un flujo, en el cabezote. Va de lo general a lo
 * avanzado, y solo muestra el nivel que se pidió:
 *
 *   Nivel 0 — «Mi agenda», el origen: siempre primero. Con la Agenda abierta, debajo
 *             solo están sus vistas (Agenda · Mensajes); ninguna etapa se despliega sola.
 *   Nivel 1 — las etapas del negocio en secuencia, con lo que cada una tiene detenido.
 *   Nivel 2 — al tocar una etapa, sus tramos en orden con los paneles de uso diario.
 *             Tocarla otra vez la recoge.
 *   Nivel 3 — «+N avanzado» al final de la fila: los paneles de uso ocasional.
 *
 * La estructura sale de lib/flujoApp.ts, la misma del Mapa: menú y mapa no pueden divergir.
 * Cada quien ve solo lo que tiene permitido; los conteos de bloqueos son de administración
 * (si la API responde 403 simplemente no se muestran).
 */

type Bloqueos = { por_etapa: Record<string, { alta: number; media: number; items: { panel: string; n: number; severidad: string }[] }> };

function etapaDe(panel: Panel): string | null {
  for (const e of ETAPAS_APP) for (const t of e.tramos) if (t.pasos.some((p) => p.panel === panel)) return e.id;
  return null;
}

export default function FlujoNav() {
  const panel = useAppStore((s) => s.panel);
  const setPanel = useAppStore((s) => s.setPanel);
  const setCombosVista = useAppStore((s) => s.setCombosVista);
  const user = useTicketsAuth((s) => s.user);
  const { advanced: advToggle } = useUiMode();
  const modoAvanzado = modoAvanzadoEfectivo(user, advToggle);
  const panelNorm: Panel = panel === "tickets" ? "hugo" : panel;
  const enAgenda = panelNorm === ORIGEN_APP.panel;
  const enMapa = panelNorm === "mapa-sistema";
  const etapaActual = enMapa ? null : etapaDe(panelNorm);
  const [abierta, setAbierta] = useState<string | null>(etapaActual);
  const [verAvanzado, setVerAvanzado] = useState(false);
  useEffect(() => {
    setAbierta(etapaActual);
    setVerAvanzado(false);
  }, [etapaActual, panelNorm]);

  const bloq = useQuery({
    queryKey: ["mapa-app-bloqueos"],
    queryFn: () => api.get<Bloqueos>("/api/mapa-sistema/bloqueos"),
    refetchInterval: 60_000,
    retry: false,
  });

  const permitido = (p: Panel) => Boolean(user && puedeVerSeccionPanel(user, p));
  const esAvanzado = (p: Panel) => PANEL_INFO[p]?.tier === "advanced";

  const etapas = useMemo(
    () => ETAPAS_APP.map((e) => ({ ...e, tramos: e.tramos.map((t) => ({ ...t, pasos: t.pasos.filter((p) => permitido(p.panel)) })).filter((t) => t.pasos.length) })).filter((e) => e.tramos.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user],
  );
  const linea = etapas.filter((e) => e.tipo === "linea");
  const transversales = etapas.filter((e) => e.tipo === "transversal");
  const etapa = etapas.find((e) => e.id === abierta) ?? null;
  const conAvanzado = modoAvanzado || verAvanzado;
  const ocultos = etapa ? etapa.tramos.reduce((a, t) => a + t.pasos.filter((p) => esAvanzado(p.panel) && p.panel !== panelNorm).length, 0) : 0;

  const Chip = ({ e }: { e: EtapaApp }) => {
    const b = bloq.data?.por_etapa?.[e.id];
    const aqui = e.id === etapaActual;
    const sel = e.id === abierta;
    return (
      <button
        type="button"
        onClick={() => setAbierta(sel ? null : e.id)}
        aria-expanded={sel}
        title={e.pregunta}
        className={`mck-flujo-nodo flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-bold transition ${
          sel ? "border-accent bg-accent/15 text-ink" : "border-border bg-surface-input text-ink-secondary hover:border-accent/50 hover:text-ink"
        }`}
      >
        {aqui && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="estás aquí" />}
        {e.titulo}
        {b && b.alta > 0 ? (
          <span className="rounded-full bg-accent-rose px-1.5 text-[10px] tabular-nums text-white">{b.alta}</span>
        ) : b && b.media > 0 ? (
          <span className="rounded-full bg-accent-sun px-1.5 text-[10px] tabular-nums text-white">{b.media}</span>
        ) : null}
      </button>
    );
  };

  const Flecha = () => (
    <span className="shrink-0 select-none text-[11px] text-muted" aria-hidden="true">
      ⇢
    </span>
  );

  if (!user) return null;

  return (
    <nav aria-label="Navegación por flujo" className="mck-flujo-nav flex min-w-0 flex-col gap-1.5">
      {/* Origen → etapas en secuencia → las que acompañan → todo el flujo */}
      <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto pb-0.5">
        <button
          type="button"
          onClick={() => setPanel(ORIGEN_APP.panel)}
          aria-current={enAgenda ? "page" : undefined}
          title={ORIGEN_APP.hace}
          className={`mck-flujo-nodo mck-flujo-origen flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-bold transition ${
            enAgenda ? "border-accent bg-accent text-white" : "border-accent/60 bg-accent/10 text-ink hover:bg-accent/20"
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${enAgenda ? "bg-white" : "bg-accent"}`} aria-hidden="true" />
          {ORIGEN_APP.titulo}
        </button>
        {linea.map((e) => (
          <span key={e.id} className="flex shrink-0 items-center gap-1.5">
            <Flecha />
            <Chip e={e} />
          </span>
        ))}
        {transversales.length > 0 && <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />}
        {transversales.map((e) => (
          <Chip key={e.id} e={e} />
        ))}
        <span className="min-w-2 flex-1" />
        {permitido("mapa-sistema") && (
          <button
            type="button"
            onClick={() => setPanel("mapa-sistema")}
            aria-current={enMapa ? "page" : undefined}
            title="Ver toda la aplicación en un solo diagrama"
            className={`mck-flujo-nodo flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1 text-[12px] font-bold ${
              enMapa ? "border-accent bg-accent text-white" : "border-accent/50 text-accent hover:bg-accent/10"
            }`}
          >
            ◇ Todo el flujo
          </button>
        )}
      </div>

      {/* Con la Agenda abierta y ninguna etapa desplegada: solo las vistas de la Agenda. */}
      {enAgenda && !etapa && (
        <div className="mck-flujo-vistas flex min-w-0 items-center gap-1.5">
          <InicioNavTabs soloVistas />
        </div>
      )}

      {/* La etapa desplegada: tramos en orden → paneles de uso diario → «+N avanzado» */}
      {etapa && (
        <div className="flex min-w-0 items-stretch gap-1.5 overflow-x-auto pb-0.5">
          {etapa.guia && permitido(etapa.guia.abre) && (() => {
            const g = etapa.guia!;
            const n = (bloq.data?.por_etapa?.[etapa.id]?.items ?? []).filter((b) => b.panel === g.abre).reduce((a, b) => a + b.n, 0);
            return (
              <span className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    if (g.abre === "combos") setCombosVista("mision");
                    setPanel(g.abre);
                  }}
                  title={g.hace}
                  className="mck-flujo-nodo flex shrink-0 items-center gap-1.5 self-center rounded-full border border-accent bg-accent px-3 py-1 text-[12px] font-bold text-white hover:opacity-90"
                >
                  ▶ {g.titulo}
                  {n > 0 && <span className="rounded-full bg-white/25 px-1.5 text-[10px] tabular-nums">{n}</span>}
                </button>
                <Flecha />
              </span>
            );
          })()}
          {etapa.tramos.map((t, i) => {
            const pasos = t.pasos.filter((p) => conAvanzado || !esAvanzado(p.panel) || p.panel === panelNorm);
            if (!pasos.length) return null;
            return (
              <span key={t.titulo} className="flex shrink-0 items-stretch gap-1.5">
                {i > 0 && (
                  <span className="flex items-center">
                    <Flecha />
                  </span>
                )}
                <span className="mck-flujo-tramo flex items-center gap-1 rounded-lg border border-dashed border-border px-1.5 py-1">
                  <span className="px-1 font-mono text-[9.5px] font-bold uppercase tracking-wider text-muted">
                    {i + 1}·{t.titulo}
                  </span>
                  {pasos.map((p) => {
                    const inf = PANEL_INFO[p.panel];
                    const activo = p.panel === panelNorm;
                    const n = (bloq.data?.por_etapa?.[etapa.id]?.items ?? []).filter((b) => b.panel === p.panel).reduce((a, b) => a + b.n, 0);
                    return (
                      <button
                        key={p.panel}
                        type="button"
                        onClick={() => setPanel(p.panel)}
                        aria-current={activo ? "page" : undefined}
                        title={p.hace}
                        className={`mck-flujo-nodo flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-semibold transition ${
                          activo
                            ? "border-accent bg-accent text-white"
                            : `${esAvanzado(p.panel) ? "border-dashed" : ""} border-border bg-surface-input text-ink-secondary hover:border-accent/50 hover:text-ink`
                        }`}
                      >
                        <span aria-hidden="true">{inf?.emoji}</span>
                        {inf?.label ?? p.panel}
                        {n > 0 && <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${activo ? "bg-white/25 text-white" : "bg-accent-rose text-white"}`}>{n}</span>}
                      </button>
                    );
                  })}
                </span>
              </span>
            );
          })}
          {!modoAvanzado && ocultos > 0 && (
            <button
              type="button"
              onClick={() => setVerAvanzado((v) => !v)}
              aria-expanded={verAvanzado}
              title="Paneles de uso ocasional de esta etapa"
              className="mck-flujo-nodo flex shrink-0 items-center self-center rounded-md border border-dashed border-border px-2 py-1 text-[11px] font-semibold text-muted hover:border-accent/50 hover:text-ink"
            >
              {verAvanzado ? "− recoger avanzado" : `+${ocultos} avanzado`}
            </button>
          )}
        </div>
      )}
    </nav>
  );
}
