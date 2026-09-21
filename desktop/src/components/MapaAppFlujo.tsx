import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api/client";
import { ETAPAS_APP, FUERA_DEL_FLUJO, ORIGEN_APP, type EtapaApp, type PasoApp, type TramoApp } from "../lib/flujoApp";
import { puedeVerSeccionPanel } from "../lib/panelAccess";
import { PANEL_INFO } from "../lib/panelInfo";
import { useAppStore, type Panel } from "../stores/app";
import { useTicketsAuth } from "../stores/ticketsAuth";

/**
 * TODO el proyecto en UN solo diagrama de flujo, que se despliega de lo general a lo avanzado.
 *
 *   origen «Mi agenda» ⇢ abastecer ⇢ preparar ⇢ publicar ⇢ vender ⇢ entregar ⇢ facturar ⇢ contar
 *   y debajo, como carriles que acompañan a todas: Dirigir y Sistema.
 *
 * El nivel de detalle es un zoom semántico, no otra pantalla:
 *   0 Etapas      solo la secuencia y lo que cada etapa tiene detenido
 *   1 Cotidiano   + los tramos y los paneles de uso diario (tier core)
 *   2 Operación   + los paneles de la operación normal (tier standard)
 *   3 Todo        + los de uso ocasional, qué hace cada panel y las VARIABLES de cada tramo
 * En «Etapas», tocar una etapa despliega solo esa columna.
 *
 * Estructura: lib/flujoApp.ts. Bloqueos: /api/mapa-sistema/bloqueos (señales que cada módulo
 * ya produce; sin LLM). Un panel siempre abre de verdad.
 */

type Bloqueo = { etapa: string; id: string; n: number; texto: string; panel: string; severidad: "alta" | "media" };
type Bloqueos = {
  por_etapa: Record<string, { alta: number; media: number; items: Bloqueo[] }>;
  sin_senal: { fuente: string; error: string }[];
  generado: string;
};
type Estado = { servicios?: Record<string, boolean> };

const NIVELES = [
  { n: 0, titulo: "Etapas", ayuda: "La secuencia y lo detenido" },
  { n: 1, titulo: "Cotidiano", ayuda: "Lo que se usa todos los días" },
  { n: 2, titulo: "Operación", ayuda: "La operación normal completa" },
  { n: 3, titulo: "Todo", ayuda: "Todo, con variables y descripciones" },
] as const;
const CLAVE_NIVEL = "mck-mapa-flujo-nivel";

function nivelGuardado(): number {
  try {
    const v = Number(localStorage.getItem(CLAVE_NIVEL));
    return v >= 0 && v <= 3 ? v : 2;
  } catch {
    return 2;
  }
}

function info(p: Panel) {
  return PANEL_INFO[p] ?? { emoji: "•", label: p, tier: "standard" as const };
}

/** A partir de qué nivel del zoom aparece un panel. */
function nivelDe(p: Panel): number {
  const t = PANEL_INFO[p]?.tier;
  return t === "core" ? 1 : t === "advanced" ? 3 : 2;
}

function Conector() {
  return (
    <div className="flex w-[22px] shrink-0 items-center pt-[51px]" aria-hidden="true">
      <svg width="22" height="10" viewBox="0 0 22 10">
        <line x1="0" y1="5" x2="16" y2="5" className="stroke-muted" strokeWidth="1.4" strokeDasharray="4 3">
          <animate attributeName="stroke-dashoffset" from="14" to="0" dur="1.1s" repeatCount="indefinite" />
        </line>
        <path d="M15,1 L22,5 L15,9 z" className="fill-muted" />
      </svg>
    </div>
  );
}

function Baja() {
  return <div className="mx-auto h-3 w-px bg-border-strong/70" aria-hidden="true" />;
}

export default function MapaAppFlujo({
  onVerDiagrama,
  titulosDiagramas = {},
}: {
  onVerDiagrama?: (nombre: string) => void;
  /** nombre del archivo → título corto, para que dos diagramas de una etapa no se llamen igual */
  titulosDiagramas?: Record<string, string>;
}) {
  const setPanel = useAppStore((s) => s.setPanel);
  const setCombosVista = useAppStore((s) => s.setCombosVista);
  const user = useTicketsAuth((s) => s.user);
  const [nivel, setNivelEstado] = useState<number>(nivelGuardado);
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const setNivel = (n: number) => {
    setNivelEstado(n);
    setAbiertas(new Set());
    try {
      localStorage.setItem(CLAVE_NIVEL, String(n));
    } catch {
      /* sin almacenamiento: el nivel vive solo en esta visita */
    }
  };

  const bloq = useQuery({
    queryKey: ["mapa-app-bloqueos"],
    queryFn: () => api.get<Bloqueos>("/api/mapa-sistema/bloqueos"),
    refetchInterval: 60_000,
  });
  const estado = useQuery({ queryKey: ["mapa-sistema-status"], queryFn: () => api.get<Estado>("/api/status"), refetchInterval: 30_000 });

  // Las conexiones caídas son el bloqueo de la etapa «Sistema»: salen de /api/status.
  const porEtapa = useMemo(() => {
    const base: Bloqueos["por_etapa"] = { ...(bloq.data?.por_etapa ?? {}) };
    const caidos = Object.entries(estado.data?.servicios ?? {}).filter(([, ok]) => !ok);
    if (caidos.length) {
      base.sistema = {
        alta: caidos.length,
        media: 0,
        items: caidos.map(([k]) => ({ etapa: "sistema", id: `caido-${k}`, n: 1, texto: `conexión con ${k} caída`, panel: k === "mercadolibre" ? "meli-oauth" : k === "google" ? "gmail-oauth" : "telemetria", severidad: "alta" as const })),
      };
    }
    return base;
  }, [bloq.data, estado.data]);

  const linea = ETAPAS_APP.filter((e) => e.tipo === "linea");
  const transversales = ETAPAS_APP.filter((e) => e.tipo === "transversal");
  const totalPaneles = 1 + ETAPAS_APP.reduce((a, e) => a + e.tramos.reduce((b, t) => b + t.pasos.length, 0), 0) + FUERA_DEL_FLUJO.length;
  const masDetenida = linea.reduce<EtapaApp | null>((m, e) => ((porEtapa[e.id]?.alta ?? 0) > (m ? porEtapa[m.id]?.alta ?? 0 : 0) ? e : m), null);

  const puede = (p: Panel) => Boolean(user && puedeVerSeccionPanel(user, p));
  const abrir = (p: Panel) => {
    if (puede(p)) setPanel(p);
  };
  /** Nivel efectivo de una etapa: en «Etapas», la que se toca se despliega como «Operación». */
  const nivelEtapa = (id: string) => (nivel === 0 && abiertas.has(id) ? 2 : nivel);
  const alternar = (id: string) =>
    setAbiertas((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const Insignia = ({ id }: { id: string }) => {
    const b = porEtapa[id];
    if (b && b.alta > 0) return <span className="rounded-md border border-accent-rose/60 bg-accent-rose/15 px-1.5 py-0.5 text-[10.5px] font-bold text-ink"><span className="tabular-nums">{b.alta}</span> <span className="font-normal text-muted">detenidos</span></span>;
    if (b && b.media > 0) return <span className="rounded-md border border-accent-sun/60 bg-accent-sun/15 px-1.5 py-0.5 text-[10.5px] font-bold text-ink"><span className="tabular-nums">{b.media}</span> <span className="font-normal text-muted">por revisar</span></span>;
    return <span className="text-[10.5px] font-semibold text-accent-leaf">{bloq.isLoading ? "leyendo…" : "fluye"}</span>;
  };

  const NodoPanel = ({ paso, etapaId, conTexto }: { paso: PasoApp; etapaId: string; conTexto: boolean }) => {
    const i = info(paso.panel);
    const ok = puede(paso.panel);
    const bs = (porEtapa[etapaId]?.items ?? []).filter((b) => b.panel === paso.panel);
    const alta = bs.filter((b) => b.severidad === "alta").reduce((a, b) => a + b.n, 0);
    const media = bs.filter((b) => b.severidad === "media").reduce((a, b) => a + b.n, 0);
    const avanzado = nivelDe(paso.panel) === 3;
    return (
      <button
        onClick={() => abrir(paso.panel)}
        disabled={!ok}
        title={ok ? `Abrir ${i.label}` : "No tienes acceso a este panel"}
        className={`mck-flujo-nodo w-full rounded-md border px-1.5 py-1 text-left transition ${avanzado ? "border-dashed" : ""} ${
          alta ? "border-accent-rose/60 bg-accent-rose/10" : media ? "border-accent-sun/60 bg-accent-sun/10" : "border-border bg-surface-input"
        } ${ok ? "hover:border-accent/60 hover:bg-surface-hover" : "cursor-not-allowed opacity-50"}`}
      >
        <span className="flex items-center gap-1.5">
          <span className="text-[13px] leading-none" aria-hidden="true">{i.emoji}</span>
          <span className="min-w-0 flex-1 break-words text-[11.5px] font-bold leading-tight text-ink">{i.label}</span>
          {(alta > 0 || media > 0) && <span className={`shrink-0 rounded-full px-1.5 text-[10px] font-bold tabular-nums text-white ${alta ? "bg-accent-rose" : "bg-accent-sun"}`}>{alta || media}</span>}
        </span>
        {conTexto && <span className="mt-0.5 block font-sans text-[10px] leading-snug text-muted">{paso.hace}</span>}
      </button>
    );
  };

  const Datos = ({ datos }: { datos: string[] }) => (
    <div className="mb-1 flex flex-wrap gap-1" aria-label="Variables de este tramo">
      {datos.map((d) => (
        <span key={d} className="rounded border border-accent-plum/40 bg-accent-plum/10 px-1 py-px font-mono text-[9px] leading-tight text-ink-secondary">{d}</span>
      ))}
    </div>
  );

  const Tramo = ({ t, i, etapaId, nv }: { t: TramoApp; i: number; etapaId: string; nv: number }) => {
    const visibles = t.pasos.filter((p) => nivelDe(p.panel) <= nv);
    const resto = t.pasos.length - visibles.length;
    return (
      <div className="mck-flujo-tramo rounded-lg border border-dashed border-border p-1.5">
        <div className="mb-1 font-mono text-[9.5px] font-bold uppercase tracking-wider text-muted">{i + 1} · {t.titulo}</div>
        {nv >= 3 && <Datos datos={t.datos} />}
        <div className="space-y-1">
          {visibles.map((p) => (
            <NodoPanel key={p.panel} paso={p} etapaId={etapaId} conTexto={nv >= 3} />
          ))}
        </div>
        {resto > 0 && <div className="mt-1 font-mono text-[9.5px] text-muted">+{resto} al desplegar más</div>}
      </div>
    );
  };

  const Cabeza = ({ e }: { e: EtapaApp }) => {
    const n = e.tramos.reduce((a, t) => a + t.pasos.length, 0);
    const abierta = nivelEtapa(e.id) > 0;
    return (
      <button
        onClick={() => nivel === 0 && alternar(e.id)}
        aria-expanded={abierta}
        title={nivel === 0 ? (abierta ? "Recoger esta etapa" : "Desplegar esta etapa") : e.pregunta}
        className={`mck-flujo-nodo flex h-[112px] w-full flex-col rounded-xl border px-2.5 py-2 text-left transition ${abierta && nivel === 0 ? "border-accent bg-surface-hover" : "border-border-strong/70 bg-surface-input"} ${nivel === 0 ? "hover:border-accent" : "cursor-default"}`}
      >
        <span className="flex items-baseline justify-between gap-1">
          <span className="text-[13.5px] font-bold text-ink">{e.titulo}</span>
          <span className="font-mono text-[9px] text-muted">{n} {n === 1 ? "panel" : "paneles"}</span>
        </span>
        <span className="mt-0.5 line-clamp-2 font-sans text-[10px] leading-snug text-muted">{e.pregunta}</span>
        <span className="mt-auto flex flex-col gap-0.5">
          <span className="whitespace-nowrap"><Insignia id={e.id} /></span>
          <span className="truncate font-mono text-[9px] text-muted">{e.entrega ? `entrega ⇢ ${e.entrega}` : "cierra el ciclo"}</span>
        </span>
      </button>
    );
  };

  const Detenidos = ({ id }: { id: string }) => {
    const items = porEtapa[id]?.items ?? [];
    if (!items.length) return null;
    return (
      <ul className="space-y-0.5 rounded-lg border border-accent-rose/30 bg-accent-rose/5 p-1">
        {items.map((b) => (
          <li key={b.id}>
            <button onClick={() => abrir(b.panel as Panel)} title={`Ir a ${info(b.panel as Panel).label}`} className="flex w-full items-baseline gap-1.5 rounded px-1 py-0.5 text-left font-sans text-[10px] leading-snug hover:bg-surface-hover">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${b.severidad === "alta" ? "bg-accent-rose" : "bg-accent-sun"}`} />
              <span className="font-bold tabular-nums text-ink">{b.n}</span>
              <span className="text-ink-secondary">{b.texto}</span>
            </button>
          </li>
        ))}
      </ul>
    );
  };

  const Diagramas = ({ e }: { e: EtapaApp }) =>
    e.diagramas && onVerDiagrama ? (
      <div className="flex flex-wrap gap-1">
        {e.diagramas.map((d) => (
          <button key={d} onClick={() => onVerDiagrama(d)} className="mck-flujo-nodo rounded-md border border-accent/40 px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent/10">
            ◇ {titulosDiagramas[d] ?? d}
          </button>
        ))}
      </div>
    ) : null;

  return (
    <section className="rounded-xl border border-border bg-surface-panel p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-ink">Todo el proyecto en un solo flujo</h3>
          <p className="mt-0.5 max-w-3xl text-[11px] text-muted">
            Empieza en tu agenda y sigue el orden en que pasa el negocio. Cada caja abre de verdad; el número es lo que está detenido ahí ahora.
            {masDetenida && (porEtapa[masDetenida.id]?.alta ?? 0) > 0 && (
              <> Hoy lo que más frena es <b className="text-ink">{masDetenida.titulo}</b>.</>
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div role="group" aria-label="Nivel de detalle" className="mck-flujo-nav flex overflow-hidden rounded-lg border border-border">
            {NIVELES.map((n) => (
              <button
                key={n.n}
                onClick={() => setNivel(n.n)}
                aria-pressed={nivel === n.n}
                title={n.ayuda}
                className={`border-r border-border px-2.5 py-1 text-[11px] font-bold last:border-r-0 ${nivel === n.n ? "bg-accent text-white" : "bg-surface-input text-ink-secondary hover:bg-surface-hover"}`}
              >
                {n.n + 1} {n.titulo}
              </button>
            ))}
          </div>
          <span className="font-mono text-[9.5px] text-muted">{NIVELES[nivel].ayuda} · {totalPaneles} paneles</span>
        </div>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="min-w-[1506px]">
          {/* La línea principal: origen ⇢ etapas */}
          <div className="flex items-start">
            <div className="w-[148px] shrink-0 space-y-0">
              <button
                onClick={() => abrir(ORIGEN_APP.panel)}
                title="Abrir tu agenda"
                className="mck-flujo-nodo flex h-[112px] w-full flex-col rounded-[22px] border-2 border-accent bg-accent/10 px-3 py-2 text-left hover:bg-accent/20"
              >
                <span className="flex items-center gap-1.5 text-[13.5px] font-bold text-ink">
                  <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
                  {ORIGEN_APP.titulo}
                </span>
                <span className="mt-0.5 line-clamp-4 font-sans text-[10px] leading-snug text-muted">{ORIGEN_APP.hace}</span>
                <span className="mt-auto font-mono text-[9px] font-bold uppercase tracking-wider text-accent">origen</span>
              </button>
              {nivel >= 3 && (
                <>
                  <Baja />
                  <Datos datos={ORIGEN_APP.datos} />
                </>
              )}
            </div>
            {linea.map((e, i) => {
              const nv = nivelEtapa(e.id);
              return (
                <div key={e.id} className="flex flex-1 items-start">
                  <Conector />
                  <div className="min-w-[172px] flex-1">
                    <Cabeza e={e} />
                    {nv > 0 && (
                      <>
                        {(porEtapa[e.id]?.items ?? []).length > 0 && (
                          <>
                            <Baja />
                            <Detenidos id={e.id} />
                          </>
                        )}
                        {e.guia && puede(e.guia.abre) && (
                          <>
                            <Baja />
                            <button
                              onClick={() => {
                                if (e.guia!.abre === "combos") setCombosVista("mision");
                                abrir(e.guia!.abre);
                              }}
                              title={e.guia.hace}
                              className="mck-flujo-nodo w-full rounded-full border border-accent bg-accent px-2 py-1 text-center text-[11.5px] font-bold text-white hover:opacity-90"
                            >
                              ▶ {e.guia.titulo}
                            </button>
                          </>
                        )}
                        {e.tramos.map((t, k) => (
                          <div key={t.titulo}>
                            <Baja />
                            <Tramo t={t} i={k} etapaId={e.id} nv={nv} />
                          </div>
                        ))}
                        {nv >= 2 && e.diagramas && onVerDiagrama && (
                          <>
                            <Baja />
                            <Diagramas e={e} />
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Los carriles que acompañan a toda la línea */}
          <div className="mt-4 space-y-2">
            {transversales.map((e) => {
              const nv = nivelEtapa(e.id);
              return (
                <div key={e.id} className="rounded-xl border border-dashed border-border-strong/70 bg-surface/60 p-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <button onClick={() => nivel === 0 && alternar(e.id)} aria-expanded={nv > 0} className={`mck-flujo-nodo text-[13px] font-bold text-ink ${nivel === 0 ? "hover:text-accent" : "cursor-default"}`}>
                      {e.titulo}
                    </button>
                    <span className="font-sans text-[10.5px] text-muted">acompaña a todas las etapas · {e.pregunta}</span>
                    <span className="ml-auto"><Insignia id={e.id} /></span>
                  </div>
                  {nv > 0 && (
                    <div className="mt-2 flex flex-col gap-1.5 lg:flex-row lg:items-start">
                      {(porEtapa[e.id]?.items ?? []).length > 0 && <div className="lg:w-[220px] lg:shrink-0"><Detenidos id={e.id} /></div>}
                      {e.tramos.map((t, k) => (
                        <div key={t.titulo} className="flex min-w-0 flex-1 items-start gap-1.5">
                          {k > 0 && <span className="hidden pt-2 text-[11px] text-muted lg:inline" aria-hidden="true">⇢</span>}
                          <div className="min-w-0 flex-1"><Tramo t={t} i={k} etapaId={e.id} nv={nv} /></div>
                        </div>
                      ))}
                      {nv >= 2 && e.diagramas && onVerDiagrama && <div className="lg:w-[150px] lg:shrink-0"><Diagramas e={e} /></div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Cómo leerlo */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-sans text-[10.5px] text-muted">
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded-full border-2 border-accent bg-accent/10" /> origen</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded-sm border border-border-strong bg-surface-input" /> etapa o panel</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded-sm border border-dashed border-border-strong" /> tramo · uso ocasional</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded-sm border border-accent-plum/50 bg-accent-plum/10" /> variable</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded-sm border border-accent-rose/60 bg-accent-rose/15" /> detenido</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded-sm border border-accent-sun/60 bg-accent-sun/15" /> por revisar</span>
        <span className="inline-flex items-center gap-1 text-accent">◇ flujo detallado (Archify)</span>
      </div>

      {(bloq.data?.sin_senal ?? []).length > 0 && (
        <p className="mt-2 text-[10.5px] text-muted">Sin señal de: {bloq.data!.sin_senal.map((s) => s.fuente).join(", ")}. Esas etapas pueden tener bloqueos que hoy no se ven.</p>
      )}
      <p className="mt-1 text-[10.5px] text-muted">
        Fuera de la secuencia:{" "}
        {FUERA_DEL_FLUJO.map((p) => (
          <button key={p.panel} onClick={() => abrir(p.panel)} className="text-accent hover:underline">
            {info(p.panel).label}
          </button>
        ))}{" "}
        — {FUERA_DEL_FLUJO[0].hace.toLowerCase()}.
      </p>
    </section>
  );
}
