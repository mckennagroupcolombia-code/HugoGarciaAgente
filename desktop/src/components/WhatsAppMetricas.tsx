import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

/* ── Tipos API ─────────────────────────────────────────────────────────── */

interface CriterioTiempo {
  id: string;
  label: string;
  max_min: number | null;
  color: string;
  significado: string;
}

interface GlosarioItem {
  termino: string;
  explicacion: string;
}

interface SlaItem {
  label: string;
  count: number;
  pct: number;
  grado: string;
  grado_label: string;
  significado: string;
}

interface TiempoResumen {
  n: number;
  mediana_min: number | null;
  media_min?: number | null;
  p90_min?: number | null;
  sla_15_pct?: number;
  sla_60_pct?: number;
  calificacion?: { id: string; label: string; color: string };
}

interface WaMetricas {
  generado_en: string;
  zona_horaria: string;
  periodo: { dias: number; desde: string; hasta: string };
  glosario: GlosarioItem[];
  criterios_tiempo: CriterioTiempo[];
  objetivos: Record<string, number>;
  nota_metodologia: string;
  resumen: {
    mensajes_cliente: number;
    respuestas_humano: number;
    respuestas_bot: number;
    chats_unicos: number;
    mediana_humana_min: number | null;
    mediana_equipo_min: number | null;
    mediana_laboral_min: number | null;
    nota_humano: number;
    nota_bot: number;
  };
  tiempos: {
    primera_respuesta_humana: TiempoResumen;
    primera_respuesta_equipo: TiempoResumen;
    tiempo_laboral_humano: TiempoResumen;
    seguimiento_humano: TiempoResumen;
    sla_humana: SlaItem[];
    sla_equipo: SlaItem[];
    pares_primera_humana: {
      delta_min: number;
      pregunta: string;
      fecha_cli: string;
    }[];
  };
  ventas: {
    embudo: { etapa: string; label: string; chats: number; pct_del_total: number; pct_del_anterior: number }[];
    resumen: {
      chats_analizados: number;
      con_intencion_compra: number;
      ventas_cerradas: number;
      solo_consulta: number;
      abandonados: number;
      en_proceso: number;
      tasa_conversion_intencion_pct: number;
      tasa_conversion_total_pct: number;
      conversion_explicacion?: {
        titulo: string;
        formula: string;
        numerador: number;
        denominador: number;
        resultado_pct: number;
        texto: string;
        venta_significa: string;
      };
    };
    chats_muestra: {
      jid: string;
      etapa_max: string;
      resultado: string;
      etapas: string[];
      ultimo_texto: string;
    }[];
  };
  atencion_cliente?: {
    explicacion: string;
    resumen: {
      consultas_medidas: number;
      mediana_espera_equipo_min: number | null;
      mediana_espera_humano_min: number | null;
      bot_respondio_primero_pct: number;
      sin_respuesta_pct: number;
      huecos_mas_60min: number;
    };
    correlacion_intencion_espera: {
      rango: string;
      chats_intencion: number;
      ventas: number;
      conversion_pct: number;
      interpretacion: string;
    }[];
    huecos: {
      jid: string;
      cliente_escribio: string;
      espera_min: number | null;
      texto: string;
      convirtio: boolean;
    }[];
    ejemplos_timeline: {
      cliente: string;
      equipo: string;
      humano: string;
      espera_equipo_min: number | null;
      resultado: string;
      pregunta: string;
    }[];
    actividad_cliente_hora: { hora: number; consultas: number; intensidad_pct: number }[];
  };
  calificacion: {
    humano: {
      nota: number;
      nivel: { label: string; color: string };
      componentes: { nombre: string; peso_pct: number; nota: number; detalle: string }[];
    };
    bot: {
      nota: number;
      nivel: { label: string; color: string };
      componentes: { nombre: string; peso_pct: number; nota: number; detalle: string }[];
      chats_solo_bot: number;
      chats_con_humano: number;
    };
  };
  actividad_horaria: {
    titulo: string;
    nota: string;
    filas: { hora: number; humano: number; bot: number; total: number; intensidad_pct: number }[];
  };
  cola_pendiente: { jid: string; espera_min: number; texto: string; desde: string }[];
  recomendaciones: { prioridad: string; texto: string }[];
}

interface AlertaIntencion {
  jid: string;
  display: string;
  texto: string;
  espera_min: number;
  bot_respondio: boolean;
  alerta_enviada: boolean;
}

type Seccion = "panorama" | "atencion" | "tiempos" | "ventas" | "equipo" | "guia";

const PERIODOS = [
  { dias: 7, label: "7 días" },
  { dias: 30, label: "30 días" },
  { dias: 90, label: "90 días" },
  { dias: 0, label: "Todo" },
];

const SECCIONES: { id: Seccion; label: string; icon: string }[] = [
  { id: "panorama", label: "Panorama", icon: "◎" },
  { id: "atencion", label: "Atención", icon: "↔" },
  { id: "tiempos", label: "Tiempos", icon: "⏱" },
  { id: "ventas", label: "Ventas", icon: "₿" },
  { id: "equipo", label: "Human vs Bot", icon: "⚖" },
  { id: "guia", label: "Guía", icon: "?" },
];

const RESULTADO_LABEL: Record<string, { label: string; color: string }> = {
  venta_cerrada: { label: "Venta cerrada", color: "text-emerald-400" },
  en_proceso: { label: "En proceso", color: "text-sky-400" },
  abandonado: { label: "Abandonado", color: "text-amber-400" },
  solo_consulta: { label: "Solo consulta", color: "text-muted" },
  contacto_sin_conversion: { label: "Sin conversión", color: "text-muted" },
};

function fmtMin(min: number | null | undefined): string {
  if (min == null) return "—";
  if (min < 60) return min < 10 ? `${min.toFixed(1)} min` : `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function colorNota(n: number): string {
  if (n >= 85) return "text-emerald-400";
  if (n >= 70) return "text-sky-400";
  if (n >= 50) return "text-amber-400";
  return "text-red-400";
}

function ringNota(n: number): string {
  if (n >= 85) return "stroke-emerald-500";
  if (n >= 70) return "stroke-sky-500";
  if (n >= 50) return "stroke-amber-500";
  return "stroke-red-500";
}

function ScoreRing({ nota, label, sub }: { nota: number; label: string; sub: string }) {
  const r = 42;
  const circ = 2 * Math.PI * r;
  const offset = circ - (nota / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-28 h-28">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeWidth="8" className="text-surface-hover" />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            className={ringNota(nota)}
            strokeDasharray={circ}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-2xl font-bold tabular-nums ${colorNota(nota)}`}>{nota}</span>
          <span className="text-[9px] text-muted uppercase">/ 100</span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-ink">{label}</p>
        <p className="text-[11px] text-muted">{sub}</p>
      </div>
    </div>
  );
}

function MetricCard({
  titulo,
  valor,
  explicacion,
  meta,
  cumple,
}: {
  titulo: string;
  valor: string;
  explicacion: string;
  meta?: string;
  cumple?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-panel p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-ink">{titulo}</p>
        {cumple != null && (
          <span
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
              cumple ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"
            }`}
          >
            {cumple ? "En meta" : "Mejorar"}
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-ink tabular-nums">{valor}</p>
      {meta && <p className="text-[10px] text-muted">Meta: {meta}</p>}
      <p className="text-[11px] text-muted leading-relaxed border-t border-border/50 pt-2">{explicacion}</p>
    </div>
  );
}

function SlaBar({ item }: { item: SlaItem }) {
  const colors: Record<string, string> = {
    excelente: "bg-emerald-500",
    bueno: "bg-sky-500",
    aceptable: "bg-amber-500",
    lento: "bg-orange-500",
    muy_lento: "bg-orange-600",
    critico: "bg-red-500",
  };
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs gap-2">
        <span className="text-ink">
          {item.label}{" "}
          <span className="text-muted font-normal">({item.grado_label})</span>
        </span>
        <span className="text-muted tabular-nums shrink-0">
          {item.count} · {item.pct.toFixed(0)}%
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-surface-hover overflow-hidden">
        <div
          className={`h-full rounded-full ${colors[item.grado] ?? "bg-accent"}`}
          style={{ width: `${Math.min(item.pct, 100)}%` }}
        />
      </div>
      <p className="text-[10px] text-muted">{item.significado}</p>
    </div>
  );
}

function ComponenteBar({
  nombre,
  peso,
  nota,
  detalle,
}: {
  nombre: string;
  peso: number;
  nota: number;
  detalle: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-ink">{nombre} <span className="text-muted">({peso}%)</span></span>
        <span className={`font-bold tabular-nums ${colorNota(nota)}`}>{nota}</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-hover overflow-hidden">
        <div className="h-full bg-accent/80 rounded-full" style={{ width: `${nota}%` }} />
      </div>
      <p className="text-[10px] text-muted">{detalle}</p>
    </div>
  );
}

function SemaforoPill({
  ok, warn, val, label, meta, tip,
}: {
  ok: boolean; warn: boolean; val: string; label: string; meta: string; tip: string;
}) {
  const cls = ok
    ? "border-emerald-500/40 bg-emerald-500/5"
    : warn
      ? "border-amber-500/40 bg-amber-500/5"
      : "border-red-500/40 bg-red-500/5";
  const dot = ok ? "bg-emerald-500" : warn ? "bg-amber-500" : "bg-red-500";
  const txt = ok ? "text-emerald-300" : warn ? "text-amber-300" : "text-red-300";
  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot}`} />
        <p className="text-xs font-semibold text-ink">{label}</p>
      </div>
      <p className={`text-2xl font-bold tabular-nums ${txt}`}>{val}</p>
      <p className="text-[10px] text-muted mt-1">Meta: {meta}</p>
      <p className="text-[11px] text-ink/70 mt-1.5 leading-relaxed">{tip}</p>
    </div>
  );
}

export default function WhatsAppMetricas() {
  const [dias, setDias] = useState(30);
  const [seccion, setSeccion] = useState<Seccion>("panorama");
  const [data, setData] = useState<WaMetricas | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [alertas, setAlertas] = useState<AlertaIntencion[]>([]);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const d = await api.get<WaMetricas>(`/api/bot/metricas?dias=${dias}`);
      setData(d);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "No se pudieron calcular las métricas");
    } finally {
      setLoading(false);
    }
  }, [dias]);

  const cargarAlertas = useCallback(async () => {
    try {
      const r = await api.get<{ alertas: AlertaIntencion[] }>("/api/alertas/intencion");
      setAlertas(r.alertas ?? []);
    } catch {
      // silencioso — no bloquea la UI principal
    }
  }, []);

  const descartarAlerta = useCallback(async (jid: string) => {
    try {
      await api.delete(`/api/alertas/intencion/${encodeURIComponent(jid)}`);
      setAlertas((prev) => prev.filter((a) => a.jid !== jid));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    cargarAlertas();
    const id = setInterval(cargarAlertas, 30_000);
    return () => clearInterval(id);
  }, [cargarAlertas]);

  const obj = data?.objetivos;
  const r = data?.resumen;
  const hum = data?.tiempos?.primera_respuesta_humana;
  const emb = data?.ventas?.resumen;
  const att = data?.atencion_cliente;
  const convExp = emb?.conversion_explicacion;

  return (
    <div className="space-y-4">
      {/* Barra superior */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-border bg-surface-panel p-0.5">
          {PERIODOS.map((p) => (
            <button
              key={p.dias}
              type="button"
              onClick={() => setDias(p.dias)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                dias === p.dias ? "bg-accent text-white" : "text-muted hover:text-ink"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={cargar}
          disabled={loading}
          className="rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-sm text-muted hover:text-ink disabled:opacity-40"
        >
          {loading ? "Calculando…" : "↻ Actualizar"}
        </button>
        {data && (
          <span className="text-[11px] text-muted ml-auto">
            {data.periodo.desde} → {data.periodo.hasta}
          </span>
        )}
      </div>

      {/* Sub-navegación */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-surface-panel p-1">
        {SECCIONES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSeccion(s.id)}
            className={`rounded-lg px-3 py-2 text-xs font-semibold transition flex items-center gap-1.5 ${
              seccion === s.id ? "bg-accent/15 text-accent border border-accent/30" : "text-muted hover:text-ink"
            }`}
          >
            <span>{s.icon}</span>
            {s.label}
            {s.id === "panorama" && alertas.length > 0 && (
              <span className="ml-0.5 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
                {alertas.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
      )}

      {loading && !data && (
        <div className="rounded-xl border border-border bg-surface-panel px-6 py-16 text-center text-sm text-muted">
          Analizando conversaciones y embudo comercial…
        </div>
      )}

      {data && r && (
        <>
          {/* ── PANORAMA ── */}
          {seccion === "panorama" && (
            <div className="space-y-5">
              {/* Strip de cifras clave */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 rounded-xl border border-border bg-surface-panel px-4 py-4">
                {[
                  { label: "Conversaciones", val: emb?.chats_analizados ?? r.chats_unicos, color: "text-ink" },
                  { label: "Msgs cliente", val: r.mensajes_cliente, color: "text-muted" },
                  { label: "Resp. humano", val: r.respuestas_humano, color: "text-blue-300" },
                  { label: "Resp. bot", val: r.respuestas_bot, color: "text-emerald-300" },
                  { label: "Con intención", val: emb?.con_intencion_compra ?? 0, color: "text-violet-300" },
                  { label: "Ventas cerradas", val: emb?.ventas_cerradas ?? 0, color: "text-emerald-400" },
                ].map(({ label, val, color }) => (
                  <div key={label} className="text-center py-1">
                    <p className={`text-xl font-bold tabular-nums ${color}`}>{val}</p>
                    <p className="text-[9px] font-semibold text-muted mt-0.5 uppercase tracking-wide leading-tight">{label}</p>
                  </div>
                ))}
              </div>

              {/* Semáforo de desempeño */}
              <div className="grid sm:grid-cols-3 gap-3">
                <SemaforoPill
                  ok={(r.mediana_humana_min ?? 999) <= (obj?.mediana_humana_min ?? 10)}
                  warn={(r.mediana_humana_min ?? 999) <= 30}
                  val={fmtMin(r.mediana_humana_min)}
                  label="Velocidad de respuesta"
                  meta={`≤ ${obj?.mediana_humana_min ?? 10} min (mediana)`}
                  tip="Tiempo típico que el cliente espera hasta recibir respuesta del asesor."
                />
                <SemaforoPill
                  ok={(hum?.sla_15_pct ?? 0) >= (obj?.sla_15_pct ?? 55)}
                  warn={(hum?.sla_15_pct ?? 0) >= 35}
                  val={`${hum?.sla_15_pct ?? 0}%`}
                  label="Atención en ≤15 min"
                  meta={`≥ ${obj?.sla_15_pct ?? 55}% de consultas`}
                  tip="Porcentaje de clientes atendidos antes de 15 minutos."
                />
                <SemaforoPill
                  ok={(emb?.tasa_conversion_intencion_pct ?? 0) >= (obj?.conversion_intencion_pct ?? 35)}
                  warn={(emb?.tasa_conversion_intencion_pct ?? 0) >= 15}
                  val={`${emb?.tasa_conversion_intencion_pct ?? 0}%`}
                  label="Conversión a venta"
                  meta={`≥ ${obj?.conversion_intencion_pct ?? 35}% de intenciones`}
                  tip={`${emb?.ventas_cerradas ?? 0} ventas de ${emb?.con_intencion_compra ?? 0} chats con intención de compra detectada.`}
                />
              </div>

              {/* Score asesor + bot como badges simples */}
              <div className="flex flex-wrap gap-3">
                {[
                  { titulo: "Asesor humano", nota: data.calificacion.humano.nota, nivel: data.calificacion.humano.nivel.label },
                  { titulo: "Bot Hugo", nota: data.calificacion.bot.nota, nivel: data.calificacion.bot.nivel.label },
                ].map(({ titulo, nota, nivel }) => (
                  <div key={titulo} className="rounded-xl border border-border bg-surface-panel px-5 py-3">
                    <p className="text-[10px] text-muted uppercase font-semibold tracking-wide">{titulo}</p>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className={`text-3xl font-bold tabular-nums ${colorNota(nota)}`}>{nota}</span>
                      <span className="text-sm text-muted">/100</span>
                    </div>
                    <p className="text-[11px] text-muted mt-0.5">{nivel}</p>
                  </div>
                ))}
              </div>

              {convExp && (
                <section className="rounded-xl border border-border bg-surface-panel px-4 py-4 text-xs text-ink/80 leading-relaxed">
                  <p className="font-semibold text-ink mb-1">{convExp.titulo}</p>
                  <p className="font-mono text-[11px] mb-2 text-muted">
                    {convExp.numerador} ventas ÷ {convExp.denominador} chats con intención × 100 = <span className="text-emerald-300 font-bold">{convExp.resultado_pct}%</span>
                  </p>
                  <p className="text-muted">{convExp.venta_significa}</p>
                </section>
              )}

              {alertas.length > 0 && (
                <section className="rounded-xl border border-red-500/50 bg-red-500/5 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-red-200 flex items-center gap-2">
                      🚨 Intención de compra sin atención humana
                      <span className="text-[10px] bg-red-500 text-white px-1.5 py-0.5 rounded-full font-bold">
                        {alertas.length}
                      </span>
                    </h3>
                    <button
                      type="button"
                      onClick={cargarAlertas}
                      className="text-[11px] text-muted hover:text-ink"
                    >
                      ↻
                    </button>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {alertas.map((a) => (
                      <div
                        key={a.jid}
                        className="rounded-lg border border-red-500/20 bg-black/10 px-3 py-2 flex flex-col gap-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-red-300">
                            {a.display} · {a.espera_min} min
                          </span>
                          <div className="flex items-center gap-2">
                            {a.bot_respondio && (
                              <span className="text-[10px] text-sky-400">🤖 bot</span>
                            )}
                            {a.alerta_enviada && (
                              <span className="text-[10px] text-emerald-400">✓ alertado</span>
                            )}
                            <button
                              type="button"
                              onClick={() => descartarAlerta(a.jid)}
                              className="text-[11px] text-muted hover:text-red-400 leading-none"
                              title="Descartar alerta"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                        <p className="text-xs text-ink/80 line-clamp-2">{a.texto}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {data.cola_pendiente.length > 0 && (
                <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
                  <h3 className="text-sm font-semibold text-amber-200 mb-2">
                    ⚠ Cola urgente — sin respuesta humana &gt;30 min
                  </h3>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {data.cola_pendiente.slice(0, 6).map((p) => (
                      <div key={p.jid + p.desde} className="rounded-lg border border-amber-500/20 bg-black/10 px-3 py-2">
                        <span className="text-xs font-bold text-amber-300">{fmtMin(p.espera_min)}</span>
                        <p className="text-xs text-ink line-clamp-2 mt-0.5">{p.texto}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {data.recomendaciones.length > 0 && (
                <section className="rounded-xl border border-accent/30 bg-accent/5 px-4 py-4">
                  <h3 className="text-sm font-semibold text-ink mb-3">Acciones recomendadas</h3>
                  <ul className="space-y-2">
                    {data.recomendaciones.map((rec, i) => (
                      <li key={i} className="flex gap-2 text-xs text-ink/90">
                        <span
                          className={`shrink-0 font-bold uppercase text-[9px] px-1.5 py-0.5 rounded ${
                            rec.prioridad === "alta"
                              ? "bg-red-500/20 text-red-300"
                              : rec.prioridad === "media"
                                ? "bg-amber-500/20 text-amber-300"
                                : "bg-surface-hover text-muted"
                          }`}
                        >
                          {rec.prioridad}
                        </span>
                        <span>{rec.texto}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <p className="text-[10px] text-muted italic">{data.nota_metodologia}</p>
            </div>
          )}

          {/* ── ATENCIÓN (cliente escribe → equipo responde) ── */}
          {seccion === "atencion" && att && (
            <div className="space-y-5">
              <div className="rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-xs text-ink/90 leading-relaxed">
                {att.explicacion}
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <MetricCard
                  titulo="Espera típica del cliente (equipo)"
                  valor={fmtMin(att.resumen.mediana_espera_equipo_min)}
                  explicacion="Desde que el cliente escribe hasta la primera respuesta de Hugo o del asesor."
                />
                <MetricCard
                  titulo="Espera hasta el asesor"
                  valor={fmtMin(att.resumen.mediana_espera_humano_min)}
                  explicacion="Tiempo extra si Hugo respondió primero y el humano entró después."
                />
                <MetricCard
                  titulo="Hugo respondió primero"
                  valor={`${att.resumen.bot_respondio_primero_pct}%`}
                  explicacion="Consultas donde el bot cubrió antes que el asesor humano."
                />
                <MetricCard
                  titulo="Huecos >60 min"
                  valor={String(att.resumen.huecos_mas_60min)}
                  explicacion={`${att.resumen.sin_respuesta_pct}% de consultas sin respuesta del equipo en la sesión.`}
                />
              </div>

              <section className="rounded-xl border border-border bg-surface-panel p-5">
                <h3 className="text-sm font-semibold text-ink mb-1">
                  ¿La espera afecta la conversión?
                </h3>
                <p className="text-[11px] text-muted mb-4">
                  Por cada chat con intención de compra, medimos cuánto tardó el equipo en responder
                  y si terminó en venta cerrada.
                </p>
                <div className="space-y-3">
                  {att.correlacion_intencion_espera.map((c) => (
                    <div key={c.rango} className="rounded-lg border border-border/60 bg-surface-hover/40 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                        <span className="text-sm font-semibold text-ink">Espera {c.rango}</span>
                        <span className="text-xs tabular-nums">
                          <span className="text-emerald-400 font-bold">{c.conversion_pct}%</span>
                          <span className="text-muted"> · {c.ventas}/{c.chats_intencion} intenciones</span>
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-surface-hover overflow-hidden mb-1">
                        <div
                          className="h-full bg-emerald-500/70 rounded-full"
                          style={{ width: `${Math.min(c.conversion_pct, 100)}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-muted">{c.interpretacion}</p>
                    </div>
                  ))}
                </div>
              </section>

              <div className="grid lg:grid-cols-2 gap-4">
                <section className="rounded-xl border border-border bg-surface-panel p-4">
                  <h3 className="text-sm font-semibold text-ink mb-1">Cuándo escriben los clientes</h3>
                  <p className="text-[11px] text-muted mb-3">
                    Hora del día en que llegan consultas reales (no respuestas del equipo).
                  </p>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {att.actividad_cliente_hora
                      .filter((h) => h.hora >= 7 && h.hora <= 22 && h.consultas > 0)
                      .map((h) => (
                        <div key={h.hora} className="flex items-center gap-2 text-[11px]">
                          <span className="w-9 text-muted tabular-nums">{h.hora.toString().padStart(2, "0")}h</span>
                          <div className="flex-1 h-3 rounded bg-surface-hover overflow-hidden">
                            <div
                              className="h-full bg-sky-500/70 rounded"
                              style={{ width: `${h.intensidad_pct}%` }}
                            />
                          </div>
                          <span className="w-8 text-right tabular-nums text-muted">{h.consultas}</span>
                        </div>
                      ))}
                  </div>
                </section>

                <section className="rounded-xl border border-border bg-surface-panel p-4 overflow-x-auto">
                  <h3 className="text-sm font-semibold text-ink mb-2">Línea de tiempo (ejemplos)</h3>
                  <p className="text-[11px] text-muted mb-3">
                    Cliente → primera respuesta equipo → primera respuesta humano → resultado.
                  </p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted border-b border-border">
                        <th className="pb-2 text-left">Cliente</th>
                        <th className="pb-2 text-left">Equipo</th>
                        <th className="pb-2 text-left">Humano</th>
                        <th className="pb-2 text-left">Espera</th>
                        <th className="pb-2 text-left">Resultado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {att.ejemplos_timeline.map((e, i) => {
                        const meta = RESULTADO_LABEL[e.resultado] ?? { label: e.resultado, color: "text-muted" };
                        return (
                          <tr key={i} className="border-b border-border/40">
                            <td className="py-2 tabular-nums">{e.cliente}</td>
                            <td className="py-2 text-violet-300">{e.equipo}</td>
                            <td className="py-2 text-accent">{e.humano}</td>
                            <td className="py-2 tabular-nums">{fmtMin(e.espera_equipo_min)}</td>
                            <td className={`py-2 font-semibold ${meta.color}`}>{meta.label}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
              </div>

              {att.huecos.length > 0 && (
                <section className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
                  <h3 className="text-sm font-semibold text-red-200 mb-2">
                    Huecos sin respuesta (&gt;60 min o sin contestar)
                  </h3>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {att.huecos.slice(0, 6).map((h, i) => (
                      <div key={i} className="rounded-lg border border-red-500/20 bg-black/10 px-3 py-2">
                        <div className="flex justify-between text-[10px]">
                          <span className="text-muted">{h.cliente_escribio}</span>
                          <span className={h.convirtio ? "text-emerald-400" : "text-red-300"}>
                            {h.convirtio ? "Cerró venta" : "Sin venta"}
                          </span>
                        </div>
                        <p className="text-xs text-ink line-clamp-2 mt-0.5">{h.texto}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}

          {/* ── TIEMPOS ── */}
          {seccion === "tiempos" && (
            <div className="space-y-5">
              <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 px-4 py-3 text-xs text-sky-100 leading-relaxed">
                <strong>Criterios McKenna (horario laboral):</strong> Excelente ≤5 min · Bueno ≤15 min · Aceptable ≤30 min ·
                Lento ≤60 min · Crítico &gt;1 h. El tiempo laboral ajustado no penaliza noches ni fines de semana.
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { t: "Primera respuesta humana", d: data.tiempos.primera_respuesta_humana },
                  { t: "Primera respuesta (bot o humano)", d: data.tiempos.primera_respuesta_equipo },
                  { t: "Tiempo laboral ajustado", d: data.tiempos.tiempo_laboral_humano },
                  { t: "Seguimiento humano", d: data.tiempos.seguimiento_humano },
                ].map(({ t, d }) => (
                  <MetricCard
                    key={t}
                    titulo={t}
                    valor={fmtMin(d.mediana_min)}
                    explicacion={`${d.n} casos medidos · P90: ${fmtMin(d.p90_min ?? null)} · ≤15 min: ${d.sla_15_pct ?? 0}%`}
                    meta={t.includes("humana") && !t.includes("Primera respuesta (") ? `Meta mediana ≤ ${obj?.mediana_humana_min} min` : undefined}
                  />
                ))}
              </div>

              <div className="grid lg:grid-cols-2 gap-4">
                <section className="rounded-xl border border-border bg-surface-panel p-4 space-y-4">
                  <h3 className="text-sm font-semibold text-ink">Tiempo de espera del cliente (asesor)</h3>
                  <p className="text-[11px] text-muted -mt-2">
                    Desde que el cliente escribe hasta la primera respuesta del asesor humano.
                  </p>
                  {data.tiempos.sla_humana.map((s) => (
                    <SlaBar key={s.label} item={s} />
                  ))}
                </section>
                <section className="rounded-xl border border-border bg-surface-panel p-4">
                  <h3 className="text-sm font-semibold text-ink mb-1">
                    {data.actividad_horaria?.titulo ?? "Cuándo responde el equipo"}
                  </h3>
                  <p className="text-[11px] text-muted mb-3">
                    {data.actividad_horaria?.nota ??
                      "Mensajes salientes del asesor o Hugo por hora (no cuándo escriben los clientes)."}
                  </p>
                  <div className="space-y-1 max-h-72 overflow-y-auto">
                    {(data.actividad_horaria?.filas ?? [])
                      .filter((h) => h.hora >= 7 && h.hora <= 21 && h.total > 0)
                      .map((h) => (
                        <div key={h.hora} className="flex items-center gap-2 text-[11px]">
                          <span className="w-9 text-muted tabular-nums">{h.hora.toString().padStart(2, "0")}h</span>
                          <div className="flex-1 h-3 rounded bg-surface-hover overflow-hidden flex">
                            <div
                              className="h-full bg-accent/80"
                              style={{ width: `${h.total ? (h.humano / h.total) * h.intensidad_pct : 0}%` }}
                            />
                            <div
                              className="h-full bg-violet-500/60"
                              style={{ width: `${h.total ? (h.bot / h.total) * h.intensidad_pct : 0}%` }}
                            />
                          </div>
                          <span className="w-12 text-right tabular-nums text-muted">
                            {h.humano}+{h.bot}
                          </span>
                        </div>
                      ))}
                  </div>
                </section>
              </div>

              {data.tiempos.pares_primera_humana.length > 0 && (
                <section className="rounded-xl border border-border bg-surface-panel p-4 overflow-x-auto">
                  <h3 className="text-sm font-semibold text-ink mb-2">Casos más lentos (primera respuesta humana)</h3>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted border-b border-border">
                        <th className="pb-2 text-left">Espera</th>
                        <th className="pb-2 text-left">Cliente escribió</th>
                        <th className="pb-2 text-left">Pregunta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.tiempos.pares_primera_humana.map((c, i) => (
                        <tr key={i} className="border-b border-border/40">
                          <td className="py-2 text-amber-300 tabular-nums">{fmtMin(c.delta_min)}</td>
                          <td className="py-2 text-muted whitespace-nowrap">{c.fecha_cli}</td>
                          <td className="py-2 text-ink/80 max-w-md truncate">{c.pregunta}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}
            </div>
          )}

          {/* ── VENTAS ── */}
          {seccion === "ventas" && emb && (
            <div className="space-y-5">
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-100/90 leading-relaxed">
                <p className="font-semibold text-amber-200 mb-1">¿Por qué las ventas detectadas parecen pocas?</p>
                <p>
                  Una conversación cuenta como <strong>venta cerrada</strong> solo cuando el sistema
                  detecta en el texto del chat: (a) una frase de confirmación del asesor como
                  "pago confirmado", "ya queda registrado", "pedido confirmado", etc.; o (b) un número
                  de guía/envío después de que el cliente envió comprobante. Si el asesor confirmó
                  con otras palabras, el pago se tramitó por MercadoLibre, o la conversación
                  continuó por llamada, esa venta no queda registrada aquí. Los datos mejoran con el tiempo.
                </p>
              </div>
              {convExp && (
                <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-5 py-4">
                  <h3 className="text-sm font-semibold text-emerald-200 mb-2">{convExp.titulo}</h3>
                  <div className="flex flex-wrap items-baseline gap-3 mb-2">
                    <span className="text-3xl font-bold text-emerald-300 tabular-nums">{convExp.resultado_pct}%</span>
                    <span className="font-mono text-xs text-emerald-100/80">
                      {convExp.numerador} ventas ÷ {convExp.denominador} intenciones × 100
                    </span>
                  </div>
                  <p className="text-xs text-emerald-100/90 leading-relaxed">{convExp.texto}</p>
                  <p className="text-[11px] text-muted mt-2">
                    Tasa sobre todos los chats: {emb.tasa_conversion_total_pct}% ({emb.ventas_cerradas}/
                    {emb.chats_analizados})
                  </p>
                </section>
              )}

              <div className="grid sm:grid-cols-3 gap-3">
                <MetricCard
                  titulo="Ventas cerradas"
                  valor={String(emb.ventas_cerradas)}
                  explicacion="Chats con pago confirmado o envío/guía tras intención de compra."
                />
                <MetricCard
                  titulo="Sin venta (consulta o abandono)"
                  valor={String(emb.solo_consulta + emb.abandonados)}
                  explicacion={`${emb.solo_consulta} solo consulta · ${emb.abandonados} abandonados · ${emb.en_proceso} en proceso`}
                />
                <MetricCard
                  titulo="Tasa conversión"
                  valor={`${emb.tasa_conversion_intencion_pct}%`}
                  explicacion={`${emb.con_intencion_compra} chats con intención de compra detectada.`}
                />
              </div>

              <section className="rounded-xl border border-border bg-surface-panel p-5">
                <h3 className="text-sm font-semibold text-ink mb-4">Embudo comercial</h3>
                <div className="space-y-2">
                  {data.ventas.embudo.map((e, i) => {
                    const w = Math.max(8, e.pct_del_total);
                    const colors = [
                      "bg-slate-500/50",
                      "bg-sky-500/50",
                      "bg-violet-500/50",
                      "bg-amber-500/50",
                      "bg-emerald-500/60",
                      "bg-emerald-500/80",
                    ];
                    return (
                      <div key={e.etapa} className="flex items-center gap-3">
                        <div className="w-36 shrink-0 text-xs text-ink text-right">{e.label}</div>
                        <div className="flex-1 h-8 rounded-lg bg-surface-hover overflow-hidden relative">
                          <div
                            className={`h-full ${colors[i] ?? "bg-accent/50"} flex items-center px-2 transition-all`}
                            style={{ width: `${w}%` }}
                          >
                            <span className="text-xs font-bold text-white drop-shadow">{e.chats} chats</span>
                          </div>
                        </div>
                        <div className="w-20 text-[10px] text-muted tabular-nums">
                          {e.pct_del_total}% total
                          {i > 0 && <span className="block">{e.pct_del_anterior}% del paso ant.</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-xl border border-border bg-surface-panel p-4 overflow-x-auto">
                <h3 className="text-sm font-semibold text-ink mb-2">Detalle por chat (muestra)</h3>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted border-b border-border">
                      <th className="pb-2 text-left">Resultado</th>
                      <th className="pb-2 text-left">Etapa máxima</th>
                      <th className="pb-2 text-left">Etapas</th>
                      <th className="pb-2 text-left">Último mensaje</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ventas.chats_muestra.map((c, i) => {
                      const meta = RESULTADO_LABEL[c.resultado] ?? { label: c.resultado, color: "text-muted" };
                      return (
                        <tr key={i} className="border-b border-border/40">
                          <td className={`py-2 font-semibold ${meta.color}`}>{meta.label}</td>
                          <td className="py-2 text-muted">{c.etapa_max.replace(/_/g, " ")}</td>
                          <td className="py-2 text-[10px] text-muted">{c.etapas.join(" → ")}</td>
                          <td className="py-2 text-ink/80 max-w-xs truncate">{c.ultimo_texto}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            </div>
          )}

          {/* ── EQUIPO ── */}
          {seccion === "equipo" && (
            <div className="space-y-5">
              <div className="grid lg:grid-cols-2 gap-4">
                <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-ink">Asesor humano</h3>
                    <span className={`text-lg font-bold ${colorNota(data.calificacion.humano.nota)}`}>
                      {data.calificacion.humano.nota}/100
                    </span>
                  </div>
                  <p className="text-xs text-muted">
                    Evalúa velocidad, cumplimiento de tiempos, conversión comercial y cierre tras comprobante.
                  </p>
                  {data.calificacion.humano.componentes.map((c) => (
                    <ComponenteBar key={c.nombre} nombre={c.nombre} peso={c.peso_pct} nota={c.nota} detalle={c.detalle} />
                  ))}
                </section>
                <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-ink">Bot Hugo</h3>
                    <span className={`text-lg font-bold ${colorNota(data.calificacion.bot.nota)}`}>
                      {data.calificacion.bot.nota}/100
                    </span>
                  </div>
                  <p className="text-xs text-muted">
                    Evalúa rapidez de primera respuesta, chats resueltos sin humano y participación en salidas.
                  </p>
                  {data.calificacion.bot.componentes.map((c) => (
                    <ComponenteBar key={c.nombre} nombre={c.nombre} peso={c.peso_pct} nota={c.nota} detalle={c.detalle} />
                  ))}
                  <div className="flex gap-4 text-xs text-muted pt-2 border-t border-border">
                    <span>{data.calificacion.bot.chats_solo_bot} chats solo bot</span>
                    <span>{data.calificacion.bot.chats_con_humano} con intervención humana</span>
                  </div>
                </section>
              </div>

              <section className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4 text-xs text-violet-100 leading-relaxed">
                <strong>Cómo interpretar:</strong> Un bot con nota alta y humano con nota baja en velocidad sugiere delegar
                consultas de catálogo a Hugo y reservar al asesor para cierre, pago y envío. Si ambos están bajos, revise
                cola pendiente y turnos en horas pico (pestaña Tiempos).
              </section>
            </div>
          )}

          {/* ── GUÍA ── */}
          {seccion === "guia" && (
            <div className="space-y-5">
              <section className="rounded-xl border border-border bg-surface-panel p-5">
                <h3 className="text-sm font-semibold text-ink mb-4">Escalas de tiempo de respuesta</h3>
                <div className="grid sm:grid-cols-2 gap-3">
                  {data.criterios_tiempo.map((c) => (
                    <div key={c.id} className="rounded-lg border border-border/60 bg-surface-hover/50 p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            c.color === "emerald"
                              ? "bg-emerald-500"
                              : c.color === "sky"
                                ? "bg-sky-500"
                                : c.color === "amber"
                                  ? "bg-amber-500"
                                  : c.color === "orange"
                                    ? "bg-orange-500"
                                    : "bg-red-500"
                          }`}
                        />
                        <span className="text-sm font-semibold text-ink">{c.label}</span>
                        <span className="text-[10px] text-muted">
                          {c.max_min != null ? `≤ ${c.max_min} min` : "> 60 min"}
                        </span>
                      </div>
                      <p className="text-xs text-muted">{c.significado}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border border-border bg-surface-panel p-5">
                <h3 className="text-sm font-semibold text-ink mb-4">Glosario</h3>
                <dl className="space-y-3">
                  {data.glosario.map((g) => (
                    <div key={g.termino}>
                      <dt className="text-sm font-semibold text-accent">{g.termino}</dt>
                      <dd className="text-xs text-muted mt-0.5 leading-relaxed">{g.explicacion}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section className="rounded-xl border border-border bg-surface-panel p-5 text-xs text-muted space-y-2">
                <h3 className="text-sm font-semibold text-ink mb-2">Metas sugeridas McKenna</h3>
                <ul className="space-y-1 list-disc list-inside">
                  <li>Mediana humana ≤ {obj?.mediana_humana_min} min en horario laboral</li>
                  <li>≥ {obj?.sla_15_pct}% de consultas respondidas en ≤15 min</li>
                  <li>≥ {obj?.sla_60_pct}% respondidas en ≤60 min</li>
                  <li>≥ {obj?.conversion_intencion_pct}% de intenciones de compra → venta cerrada</li>
                </ul>
                <p className="pt-2 italic">{data.nota_metodologia}</p>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
