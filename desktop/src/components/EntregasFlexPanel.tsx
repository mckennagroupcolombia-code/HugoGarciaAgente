import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";

/**
 * Entregas Flex de MeLi: a qué hora llega el reparto propio y cómo cambia eso
 * semana a semana. Los datos los acumula el cron nocturno
 * (scripts/entregas_flex_cron.py) en app/data/entregas_flex.db; este panel
 * solo lee `/api/entregas-flex/resumen`, así que abrirlo no llama a MeLi.
 *
 * Las horas llegan en decimal (17.33 = 17:20), ya en hora de Bogotá.
 */

type Metricas = {
  envios: number;
  entregados: number;
  dias_reparto: number;
  envios_por_dia: number | null;
  hora_mediana: number | null;
  hora_p90: number | null;
  pct_antes_18: number | null;
  pct_despues_20: number | null;
  salida_mediana: number | null;
  transito_mediano: number | null;
  fin_ruta_mediano: number | null;
  fin_ruta_max: number | null;
  pct_mismo_dia: number | null;
  pct_mismo_dia_antes_corte: number | null;
  compras_antes_corte: number;
  perdidas_corte: number;
  pct_a_tiempo: number | null;
  tarde: number;
};

type Semana = { semana: string; etiqueta: string; en_curso: boolean; metricas: Metricas };
type Patron = { tipo: "alerta" | "mejora" | "info"; texto: string };
type Localidad = {
  localidad: string;
  envios: number;
  hora_mediana: number | null;
  transito_mediano: number | null;
  pct_despues_20: number | null;
  hora_actual: number | null;
  hora_anterior: number | null;
  cambio_confiable: boolean;
};
type Ruta = { fecha: string; dia: string; envios: number; salida: number | null; primera: number; ultima: number };
type Abierto = {
  shipment_id: string;
  order_id: string;
  compra: string;
  estado: string;
  subestado: string | null;
  localidad: string | null;
  limite: string | null;
  alerta: string | null;
};
type Tardio = { shipment_id: string; compra: string | null; limite: string; entregado: string; dias_tarde: number; localidad: string | null };
type SyncEstado = {
  corriendo: boolean;
  avance?: number;
  total?: number;
  registrados: number;
  primera_entrega: string | null;
  ultima_entrega: string | null;
  ultima: { inicio: string; fin: string; dias: number; revisados: number; nuevos: number; error: string | null } | null;
};

type Resumen = {
  generado: string;
  semanas: number;
  corte_hora: number;
  serie: Semana[];
  actual: Metricas;
  anterior: Metricas;
  histograma_actual: number[];
  histograma_anterior: number[];
  por_dia: (Metricas & { dia: string })[];
  por_localidad: Localidad[];
  corte: { tramo: string; compras: number; pct_mismo_dia: number | null }[];
  rutas: Ruta[];
  abiertos: Abierto[];
  tardios: Tardio[];
  madrugada: { shipment_id: string; entregado: string; localidad: string | null }[];
  patrones: Patron[];
  sync: SyncEstado;
};

// ── Formato ──────────────────────────────────────────────────────────────────

function fmtHora(h: number | null | undefined): string {
  if (h == null) return "—";
  let hh = Math.floor(h);
  let mm = Math.round((h - hh) * 60);
  if (mm === 60) {
    hh += 1;
    mm = 0;
  }
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function fmtPct(v: number | null | undefined): string {
  return v == null ? "—" : `${Math.round(v)}%`;
}

function fmtDuracion(h: number | null | undefined): string {
  if (h == null) return "—";
  const m = Math.round(h * 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

function fmtFechaHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("es-CO", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// ── Indicadores ──────────────────────────────────────────────────────────────

type Kpi = {
  clave: keyof Metricas;
  titulo: string;
  tipo: "hora" | "pct" | "num";
  /** true = que suba es malo (entregas más tarde); false = que suba es bueno. */
  peorSiSube: boolean;
  ayuda: string;
};

const KPIS: Kpi[] = [
  { clave: "hora_mediana", titulo: "Hora mediana de entrega", tipo: "hora", peorSiSube: true, ayuda: "La mitad de los envíos llega antes de esta hora" },
  { clave: "salida_mediana", titulo: "Salida de la ruta", tipo: "hora", peorSiSube: true, ayuda: "Cuando el mensajero escanea los paquetes" },
  { clave: "fin_ruta_mediano", titulo: "Última entrega del día", tipo: "hora", peorSiSube: true, ayuda: "Hora típica en que termina la ruta" },
  { clave: "pct_despues_20", titulo: "Entregas después de las 20 h", tipo: "pct", peorSiSube: true, ayuda: "Clientes que reciben de noche" },
  { clave: "pct_mismo_dia_antes_corte", titulo: "Mismo día (compra antes del corte)", tipo: "pct", peorSiSube: false, ayuda: "Compras de lunes a viernes antes del corte que salieron ese día" },
  { clave: "pct_a_tiempo", titulo: "A tiempo", tipo: "pct", peorSiSube: false, ayuda: "Entregados dentro de la fecha que MeLi prometió" },
];

function fmtValor(tipo: Kpi["tipo"], v: number | null | undefined): string {
  if (tipo === "hora") return fmtHora(v);
  if (tipo === "pct") return fmtPct(v);
  return v == null ? "—" : String(Math.round(v));
}

function Delta({ kpi, actual, anterior }: { kpi: Kpi; actual: number | null; anterior: number | null }) {
  if (actual == null || anterior == null) return <span className="text-[11px] text-muted">sin período anterior</span>;
  const d = actual - anterior;
  const umbral = kpi.tipo === "hora" ? 5 / 60 : 1;
  if (Math.abs(d) < umbral) return <span className="text-[11px] text-muted">= igual que las 4 semanas previas</span>;
  const peor = d > 0 === kpi.peorSiSube;
  const txt =
    kpi.tipo === "hora"
      ? `${Math.round(Math.abs(d) * 60)} min ${d > 0 ? "más tarde" : "más temprano"}`
      : `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(0)} pts`;
  return (
    <span className={`text-[11px] font-semibold ${peor ? "text-danger" : "text-success"}`}>
      {peor ? "▲ peor" : "▼ mejor"} · {txt}
    </span>
  );
}

// ── Gráficas (SVG propio, como SaludNegocioPanel: sin librerías) ─────────────

type SerieDef = { clave: keyof Metricas; titulo: string; tipo: "hora" | "pct" | "num" };

const SERIES: SerieDef[] = [
  { clave: "hora_mediana", titulo: "Hora mediana de entrega", tipo: "hora" },
  { clave: "salida_mediana", titulo: "Salida de la ruta", tipo: "hora" },
  { clave: "fin_ruta_mediano", titulo: "Última entrega del día", tipo: "hora" },
  { clave: "pct_despues_20", titulo: "% después de las 20 h", tipo: "pct" },
  { clave: "pct_mismo_dia_antes_corte", titulo: "% mismo día (antes del corte)", tipo: "pct" },
  { clave: "pct_a_tiempo", titulo: "% a tiempo", tipo: "pct" },
  { clave: "transito_mediano", titulo: "Tiempo en ruta (mediana)", tipo: "num" },
  { clave: "entregados", titulo: "Envíos entregados", tipo: "num" },
];

function valorSerie(def: SerieDef, v: number | null | undefined): string {
  if (def.clave === "transito_mediano") return fmtDuracion(v);
  return fmtValor(def.tipo, v);
}

function LineaSemanal({ serie, def }: { serie: Semana[]; def: SerieDef }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 680;
  const H = 220;
  const padL = 44;
  const padR = 24;
  const padT = 14;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const vals = serie.map((s) => (s.metricas[def.clave] as number | null) ?? null);
  const def_ = vals.filter((v): v is number => v != null);
  let min = def_.length ? Math.min(...def_) : 0;
  let max = def_.length ? Math.max(...def_) : 1;
  if (def.tipo === "pct") {
    min = Math.max(0, Math.floor((min - 5) / 10) * 10);
    max = Math.min(100, Math.ceil((max + 5) / 10) * 10);
  } else if (def.tipo === "hora") {
    min = Math.floor(min * 2 - 1) / 2;
    max = Math.ceil(max * 2 + 1) / 2;
  } else {
    min = 0;
    max = Math.max(1, max * 1.15);
  }
  if (max - min < 1e-6) max = min + 1;

  const n = serie.length;
  const x = (i: number) => padL + (n <= 1 ? plotW / 2 : (plotW * i) / (n - 1));
  const y = (v: number) => padT + plotH - ((v - min) / (max - min)) * plotH;
  const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);

  // La semana en curso va punteada: está incompleta y no debe leerse como tendencia.
  const puntos = vals.map((v, i) => (v == null ? null : { i, px: x(i), py: y(v) }));
  const cerrados = puntos.filter((p, i) => p && !serie[i].en_curso) as { i: number; px: number; py: number }[];
  const ultimoCerrado = cerrados[cerrados.length - 1];
  const enCurso = puntos.findIndex((p, i) => p && serie[i].en_curso);
  const path = cerrados.map((p, k) => `${k ? "L" : "M"}${p.px},${p.py}`).join(" ");

  const h = hover != null ? serie[hover] : null;
  const promedio = def_.length ? def_.reduce((a, b) => a + b, 0) / def_.length : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${def.titulo} por semana`}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" className="fill-muted" fontSize={10}>
              {valorSerie(def, t)}
            </text>
          </g>
        ))}
        {promedio != null && (
          <g>
            <line
              x1={padL}
              x2={W - padR}
              y1={y(promedio)}
              y2={y(promedio)}
              className="stroke-muted"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            <text x={padL + 16} y={y(promedio) + 13} textAnchor="start" className="fill-muted" fontSize={10}>
              promedio {valorSerie(def, promedio)}
            </text>
          </g>
        )}
        {serie.map((s, i) =>
          i % Math.ceil(n / 12) === 0 || i === n - 1 ? (
            <text
              key={s.semana}
              x={x(i)}
              y={H - 8}
              textAnchor={i === n - 1 ? "end" : i === 0 ? "start" : "middle"}
              className="fill-muted"
              fontSize={10}
            >
              {s.etiqueta}
            </text>
          ) : null,
        )}
        {hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + plotH} className="stroke-border-strong" strokeWidth={1} />
        )}
        <path d={path} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {enCurso >= 0 && ultimoCerrado && puntos[enCurso] && (
          <line
            x1={ultimoCerrado.px}
            y1={ultimoCerrado.py}
            x2={puntos[enCurso]!.px}
            y2={puntos[enCurso]!.py}
            className="stroke-accent"
            strokeWidth={2}
            strokeDasharray="4 4"
          />
        )}
        {puntos.map((p, i) =>
          p ? (
            <circle
              key={i}
              cx={p.px}
              cy={p.py}
              r={hover === i ? 5 : 4}
              className={serie[i].en_curso ? "fill-surface-panel stroke-accent" : "fill-accent stroke-surface-panel"}
              strokeWidth={2}
            />
          ) : null,
        )}
        {serie.map((s, i) => (
          <rect
            key={s.semana}
            x={x(i) - plotW / Math.max(1, n - 1) / 2}
            y={padT}
            width={plotW / Math.max(1, n - 1)}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
      {h && (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-lg border border-border bg-surface-panel px-3 py-2 text-xs shadow-lg"
          style={{ left: `${(x(hover!) / W) * 100}%`, transform: `translateX(${hover! > n / 2 ? "-105%" : "5%"})` }}
        >
          <div className="font-bold text-ink">
            Semana del {h.etiqueta}
            {h.en_curso ? " (en curso)" : ""}
          </div>
          <div className="text-ink-secondary">
            {def.titulo}: <span className="font-semibold text-ink">{valorSerie(def, h.metricas[def.clave] as number | null)}</span>
          </div>
          <div className="text-muted">
            {h.metricas.entregados} entregados · {h.metricas.dias_reparto} días de reparto
          </div>
        </div>
      )}
    </div>
  );
}

function HistogramaHoras({ actual, anterior }: { actual: number[]; anterior: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // Solo las horas con entregas (el reparto vive entre 13 y 22 h); madrugada aparte.
  const horas = Array.from({ length: 24 }, (_, i) => i).filter((h) => h >= 12 && h <= 22);
  const totA = actual.reduce((a, b) => a + b, 0) || 1;
  const totP = anterior.reduce((a, b) => a + b, 0) || 1;
  const pA = horas.map((h) => (100 * actual[h]) / totA);
  const pP = horas.map((h) => (100 * anterior[h]) / totP);
  const max = Math.max(5, ...pA, ...pP);
  const W = 460;
  const H = 200;
  const padL = 34;
  const padB = 24;
  const padT = 10;
  const plotH = H - padT - padB;
  const slot = (W - padL - 8) / horas.length;
  const barW = Math.min(18, slot * 0.36);
  const y = (v: number) => padT + plotH - (v / max) * plotH;

  return (
    <div className="relative">
      <div className="mb-2 flex flex-wrap gap-4 text-[11px] text-ink-secondary">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-accent" /> Últimas 4 semanas
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-ink-muted/50" /> 4 semanas anteriores
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Porcentaje de entregas por hora del día" onMouseLeave={() => setHover(null)}>
        {[0, max / 2, max].map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - 8} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" className="fill-muted" fontSize={10}>
              {Math.round(t)}%
            </text>
          </g>
        ))}
        {horas.map((h, i) => {
          const cx = padL + slot * i + slot / 2;
          const alto = (v: number) => Math.max(0, padT + plotH - y(v));
          return (
            <g key={h} onMouseEnter={() => setHover(i)}>
              <rect x={cx - barW - 1} y={y(pP[i])} width={barW} height={alto(pP[i])} rx={3} className="fill-ink-muted" opacity={0.45} />
              <rect x={cx + 1} y={y(pA[i])} width={barW} height={alto(pA[i])} rx={3} className="fill-accent" />
              <text x={cx} y={H - 8} textAnchor="middle" className="fill-muted" fontSize={10}>
                {h}h
              </text>
              <rect x={cx - slot / 2} y={padT} width={slot} height={plotH} fill="transparent" />
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div
          className="pointer-events-none absolute top-6 z-10 rounded-lg border border-border bg-surface-panel px-3 py-2 text-xs shadow-lg"
          style={{ left: `${((padL + slot * hover + slot / 2) / W) * 100}%`, transform: hover > horas.length / 2 ? "translateX(-105%)" : "translateX(5%)" }}
        >
          <div className="font-bold text-ink">
            {horas[hover]}:00 – {horas[hover]}:59
          </div>
          <div className="text-ink-secondary">
            Últimas 4 semanas: <b className="text-ink">{pA[hover].toFixed(1)}%</b> ({actual[horas[hover]]})
          </div>
          <div className="text-ink-secondary">
            Anteriores: <b className="text-ink">{pP[hover].toFixed(1)}%</b> ({anterior[horas[hover]]})
          </div>
        </div>
      )}
    </div>
  );
}

function CargaVsFin({ rutas }: { rutas: Ruta[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 460;
  const H = 220;
  const padL = 44;
  const padB = 30;
  const padT = 10;
  const padR = 12;
  const maxX = Math.max(10, ...rutas.map((r) => r.envios));
  const minY = Math.min(17, ...rutas.map((r) => r.ultima));
  const maxY = Math.max(22, ...rutas.map((r) => r.ultima));
  const x = (v: number) => padL + (v / maxX) * (W - padL - padR);
  const y = (v: number) => padT + (H - padT - padB) - ((v - minY) / (maxY - minY)) * (H - padT - padB);
  const r = hover != null ? rutas[hover] : null;
  const ticksY = [];
  for (let t = Math.ceil(minY); t <= Math.floor(maxY); t++) ticksY.push(t);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Envíos del día contra hora de la última entrega" onMouseLeave={() => setHover(null)}>
        {ticksY.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" className="fill-muted" fontSize={10}>
              {t}:00
            </text>
          </g>
        ))}
        {[0, Math.round(maxX / 2), maxX].map((t) => (
          <text key={t} x={x(t)} y={H - 14} textAnchor="middle" className="fill-muted" fontSize={10}>
            {t}
          </text>
        ))}
        <text x={(W + padL) / 2} y={H - 2} textAnchor="middle" className="fill-muted" fontSize={10}>
          envíos entregados ese día
        </text>
        {rutas.map((ru, i) => (
          <circle
            key={ru.fecha}
            cx={x(ru.envios)}
            cy={y(ru.ultima)}
            r={hover === i ? 6 : 4.5}
            className="fill-accent stroke-surface-panel"
            strokeWidth={2}
            opacity={hover == null || hover === i ? 0.9 : 0.45}
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
      {r && (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-lg border border-border bg-surface-panel px-3 py-2 text-xs shadow-lg"
          style={{ left: `${(x(r.envios) / W) * 100}%`, transform: r.envios > maxX / 2 ? "translateX(-105%)" : "translateX(5%)" }}
        >
          <div className="font-bold text-ink">
            {r.dia} {r.fecha}
          </div>
          <div className="text-ink-secondary">{r.envios} envíos</div>
          <div className="text-ink-secondary">
            Salida {fmtHora(r.salida)} · primera {fmtHora(r.primera)} · última <b className="text-ink">{fmtHora(r.ultima)}</b>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────

function FilaAbierto({ a }: { a: Abierto }) {
  return (
    <li className="flex flex-wrap gap-x-2 text-ink-secondary">
      <span>{a.alerta ? "⚠️" : "•"}</span>
      <span className="font-semibold text-ink">{a.shipment_id}</span>
      <span>compra {fmtFechaHora(a.compra)}</span>
      <span>· {a.localidad ?? "—"}</span>
      <span>
        · {a.estado}
        {a.subestado ? ` / ${a.subestado}` : ""}
      </span>
      {a.limite && <span>· límite {a.limite}</span>}
      {a.alerta && <span className="font-semibold text-danger">· {a.alerta}</span>}
    </li>
  );
}

function Tarjeta({ titulo, children, nota }: { titulo: string; nota?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface-panel p-4">
      <h3 className="text-sm font-bold text-ink">{titulo}</h3>
      {nota && <p className="mt-0.5 text-xs text-muted">{nota}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function EntregasFlexPanel() {
  const qc = useQueryClient();
  const [semanas, setSemanas] = useState(12);
  const [serieSel, setSerieSel] = useState<keyof Metricas>("hora_mediana");
  const [verTabla, setVerTabla] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = useQuery<Resumen>({
    queryKey: ["entregas-flex", semanas],
    queryFn: () => api.get(`/api/entregas-flex/resumen?semanas=${semanas}`, { timeoutMs: 60_000 }),
    staleTime: 5 * 60_000,
  });

  const estado = useQuery<SyncEstado>({
    queryKey: ["entregas-flex-estado"],
    queryFn: () => api.get("/api/entregas-flex/estado"),
    refetchInterval: (query) => (query.state.data?.corriendo ? 2500 : false),
  });

  const corriendo = Boolean(estado.data?.corriendo);
  const corriaAntes = useRef(false);
  useEffect(() => {
    // Al terminar una sincronización (corriendo: true → false), recargar el resumen.
    if (corriaAntes.current && !corriendo) qc.invalidateQueries({ queryKey: ["entregas-flex"] });
    corriaAntes.current = corriendo;
  }, [corriendo, qc]);

  const sync = useMutation({
    mutationFn: () => api.post("/api/entregas-flex/sincronizar", { dias: 10 }),
    onMutate: () => setError(null),
    onSuccess: () => estado.refetch(),
    onError: (e: Error) => setError(e.message),
  });

  const def = SERIES.find((s) => s.clave === serieSel) ?? SERIES[0];
  const d = q.data;
  const alertasAbiertas = useMemo(() => (d?.abiertos ?? []).filter((a) => a.alerta), [d]);

  const ultimaSync = estado.data?.ultima ?? d?.sync.ultima;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">Entregas Flex</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted">
            A qué hora llegan los envíos Flex de MercadoLibre (nuestro reparto en Bogotá) y cómo cambia semana a semana.
            Se actualiza solo cada noche; las comparaciones son siempre de las últimas 4 semanas contra las 4 anteriores.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={semanas}
            onChange={(e) => setSemanas(Number(e.target.value))}
            className="rounded-lg border border-border bg-surface-input px-2 py-1.5 text-xs text-ink"
            aria-label="Semanas a mostrar"
          >
            {[8, 12, 26, 52].map((n) => (
              <option key={n} value={n}>
                Últimas {n} semanas
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => sync.mutate()}
            disabled={corriendo || sync.isPending}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
          >
            {corriendo
              ? `Actualizando… ${estado.data?.avance ?? 0}/${estado.data?.total || "?"}`
              : "Actualizar ahora"}
          </button>
        </div>
      </div>

      <p className="text-[11px] text-muted">
        {estado.data?.registrados ?? d?.sync.registrados ?? 0} envíos Flex registrados
        {d?.sync.primera_entrega ? ` desde el ${d.sync.primera_entrega.slice(0, 10)}` : ""}
        {ultimaSync ? ` · última actualización ${fmtFechaHora(ultimaSync.fin)}` : ""}
        {ultimaSync?.error ? ` · ⚠️ ${ultimaSync.error}` : ""}
      </p>
      {error && <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

      {q.isLoading && <p className="text-sm text-muted">Cargando…</p>}
      {q.isError && <p className="text-sm text-danger">No se pudo cargar el resumen: {(q.error as Error).message}</p>}

      {d && d.sync.registrados === 0 && (
        <p className="rounded-xl border border-border bg-surface-panel p-4 text-sm text-ink-secondary">
          Todavía no hay envíos registrados. Dale «Actualizar ahora» o corre el backfill:{" "}
          <code className="text-xs">scripts/entregas_flex_cron.py --dias 90 --forzar</code>
        </p>
      )}

      {d && d.sync.registrados > 0 && (
        <>
          {/* Indicadores */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {KPIS.map((k) => (
              <div key={k.clave} className="rounded-xl border border-border bg-surface-panel p-3" title={k.ayuda}>
                <div className="text-[11px] font-semibold text-muted">{k.titulo}</div>
                <div className="mt-1 text-2xl font-bold tabular-nums text-ink">
                  {fmtValor(k.tipo, d.actual[k.clave] as number | null)}
                </div>
                <Delta kpi={k} actual={d.actual[k.clave] as number | null} anterior={d.anterior[k.clave] as number | null} />
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted">
            Últimas 4 semanas: {d.actual.entregados} entregas en {d.actual.dias_reparto} días (≈{d.actual.envios_por_dia ?? "—"}{" "}
            por día) · tiempo en ruta mediano {fmtDuracion(d.actual.transito_mediano)} · el 90% llega antes de las{" "}
            {fmtHora(d.actual.hora_p90)} · corte del mismo día {fmtHora(d.corte_hora)}
            {d.actual.perdidas_corte > 0 && ` (${d.actual.perdidas_corte} compras antes del corte no salieron ese día)`}
          </p>

          {/* Patrones */}
          <Tarjeta titulo="Patrones detectados" nota="Solo se listan cambios de 15 min o más en horas y de 5 puntos o más en porcentajes.">
            <ul className="space-y-1.5">
              {d.patrones.map((p, i) => (
                <li key={i} className="flex gap-2 text-sm text-ink-secondary">
                  <span aria-hidden>{p.tipo === "alerta" ? "⚠️" : p.tipo === "mejora" ? "✅" : "ℹ️"}</span>
                  <span>
                    <b className="text-ink">{p.tipo === "alerta" ? "Empeoró" : p.tipo === "mejora" ? "Mejoró" : "Nota"}:</b> {p.texto}
                  </span>
                </li>
              ))}
            </ul>
          </Tarjeta>

          {/* Evolución semanal */}
          <Tarjeta titulo="Evolución semana a semana" nota="El último punto (hueco, línea punteada) es la semana en curso: todavía está incompleta.">
            <div className="mb-3 flex flex-wrap gap-1.5">
              {SERIES.map((s) => (
                <button
                  key={s.clave}
                  type="button"
                  onClick={() => setSerieSel(s.clave)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                    s.clave === serieSel ? "border-accent bg-accent text-white" : "border-border text-ink-secondary hover:bg-surface-hover"
                  }`}
                >
                  {s.titulo}
                </button>
              ))}
            </div>
            <LineaSemanal serie={d.serie} def={def} />
            <button type="button" onClick={() => setVerTabla((v) => !v)} className="mt-2 text-[11px] font-semibold text-accent">
              {verTabla ? "Ocultar tabla" : "Ver como tabla"}
            </button>
            {verTabla && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-muted">
                    <tr>
                      <th className="px-2 py-1">Semana</th>
                      <th className="px-2 py-1 text-right">Entregas</th>
                      <th className="px-2 py-1 text-right">Salida</th>
                      <th className="px-2 py-1 text-right">Mediana</th>
                      <th className="px-2 py-1 text-right">Fin ruta</th>
                      <th className="px-2 py-1 text-right">&gt; 20 h</th>
                      <th className="px-2 py-1 text-right">Mismo día</th>
                      <th className="px-2 py-1 text-right">A tiempo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...d.serie].reverse().map((s) => (
                      <tr key={s.semana} className="border-t border-border/60 tabular-nums text-ink-secondary">
                        <td className="px-2 py-1 text-ink">
                          {s.etiqueta}
                          {s.en_curso ? " (en curso)" : ""}
                        </td>
                        <td className="px-2 py-1 text-right">{s.metricas.entregados}</td>
                        <td className="px-2 py-1 text-right">{fmtHora(s.metricas.salida_mediana)}</td>
                        <td className="px-2 py-1 text-right">{fmtHora(s.metricas.hora_mediana)}</td>
                        <td className="px-2 py-1 text-right">{fmtHora(s.metricas.fin_ruta_mediano)}</td>
                        <td className="px-2 py-1 text-right">{fmtPct(s.metricas.pct_despues_20)}</td>
                        <td className="px-2 py-1 text-right">{fmtPct(s.metricas.pct_mismo_dia_antes_corte)}</td>
                        <td className="px-2 py-1 text-right">{fmtPct(s.metricas.pct_a_tiempo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Tarjeta>

          <div className="grid gap-4 lg:grid-cols-2">
            <Tarjeta titulo="A qué hora se entrega" nota="Porcentaje de entregas en cada hora del día.">
              <HistogramaHoras actual={d.histograma_actual} anterior={d.histograma_anterior} />
            </Tarjeta>
            <Tarjeta titulo="Carga del día y fin de la ruta" nota={`Cada punto es un día de reparto (últimas ${d.semanas} semanas).`}>
              <CargaVsFin rutas={d.rutas} />
            </Tarjeta>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Tarjeta titulo="Corte del mismo día" nota="Compras de lunes a viernes: qué parte se entregó el mismo día según la hora de compra.">
              <div className="space-y-1.5">
                {d.corte.map((c) => (
                  <div key={c.tramo} className="flex items-center gap-2 text-xs">
                    <span className="w-16 shrink-0 tabular-nums text-ink-secondary">{c.tramo}</span>
                    <div className="h-4 flex-1 rounded bg-surface">
                      <div className="h-4 rounded bg-accent" style={{ width: `${c.pct_mismo_dia ?? 0}%` }} />
                    </div>
                    <span className="w-24 shrink-0 text-right tabular-nums text-ink">
                      {fmtPct(c.pct_mismo_dia)} <span className="text-muted">({c.compras})</span>
                    </span>
                  </div>
                ))}
              </div>
            </Tarjeta>
            <Tarjeta titulo="Por día de la semana" nota={`Últimas ${d.semanas} semanas.`}>
              <table className="w-full text-xs">
                <thead className="text-left text-muted">
                  <tr>
                    <th className="py-1">Día</th>
                    <th className="py-1 text-right">Entregas</th>
                    <th className="py-1 text-right">Mediana</th>
                    <th className="py-1 text-right">Fin ruta</th>
                    <th className="py-1 text-right">&gt; 20 h</th>
                  </tr>
                </thead>
                <tbody>
                  {d.por_dia.map((r) => (
                    <tr key={r.dia} className="border-t border-border/60 tabular-nums text-ink-secondary">
                      <td className="py-1 text-ink">{r.dia}</td>
                      <td className="py-1 text-right">{r.entregados}</td>
                      <td className="py-1 text-right">{fmtHora(r.hora_mediana)}</td>
                      <td className="py-1 text-right">{fmtHora(r.fin_ruta_mediano)}</td>
                      <td className="py-1 text-right">{fmtPct(r.pct_despues_20)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Tarjeta>
          </div>

          <Tarjeta
            titulo="Por localidad"
            nota="Ordenadas por volumen. «Cambio» compara la hora mediana de las últimas 4 semanas contra las 4 anteriores; con menos de 8 entregas en alguno de los dos períodos no se calcula."
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted">
                  <tr>
                    <th className="px-2 py-1">Localidad</th>
                    <th className="px-2 py-1 text-right">Entregas</th>
                    <th className="px-2 py-1 text-right">Hora mediana</th>
                    <th className="px-2 py-1 text-right">Tiempo en ruta</th>
                    <th className="px-2 py-1 text-right">&gt; 20 h</th>
                    <th className="px-2 py-1 text-right">Cambio</th>
                  </tr>
                </thead>
                <tbody>
                  {d.por_localidad.map((l) => {
                    const delta =
                      l.cambio_confiable && l.hora_actual != null && l.hora_anterior != null
                        ? l.hora_actual - l.hora_anterior
                        : null;
                    return (
                      <tr key={l.localidad} className="border-t border-border/60 tabular-nums text-ink-secondary">
                        <td className="px-2 py-1 text-ink">{l.localidad}</td>
                        <td className="px-2 py-1 text-right">{l.envios}</td>
                        <td className="px-2 py-1 text-right">{fmtHora(l.hora_mediana)}</td>
                        <td className="px-2 py-1 text-right">{fmtDuracion(l.transito_mediano)}</td>
                        <td className="px-2 py-1 text-right">{fmtPct(l.pct_despues_20)}</td>
                        <td
                          className={`px-2 py-1 text-right ${
                            delta == null || Math.abs(delta) < 0.25 ? "text-muted" : delta > 0 ? "text-danger" : "text-success"
                          }`}
                        >
                          {delta == null ? "—" : `${delta > 0 ? "+" : "−"}${Math.round(Math.abs(delta) * 60)} min`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Tarjeta>

          <Tarjeta titulo="Para revisar" nota="Envíos abiertos, entregas fuera de la fecha prometida y marcas de entrega de madrugada.">
            <div className="space-y-4 text-xs">
              <div>
                <h4 className="font-bold text-ink">
                  Abiertos ({d.abiertos.length}
                  {alertasAbiertas.length ? `, ${alertasAbiertas.length} con alerta` : ""})
                </h4>
                {d.abiertos.length === 0 ? (
                  <p className="mt-1 text-muted">Nada pendiente.</p>
                ) : (
                  <>
                    {alertasAbiertas.length > 0 && (
                      <ul className="mt-1 space-y-1">{alertasAbiertas.map((a) => <FilaAbierto key={a.shipment_id} a={a} />)}</ul>
                    )}
                    {d.abiertos.length > alertasAbiertas.length && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-muted">
                          {d.abiertos.length - alertasAbiertas.length} esperando su ruta (normal)
                        </summary>
                        <ul className="mt-1 space-y-1">
                          {d.abiertos
                            .filter((a) => !a.alerta)
                            .map((a) => (
                              <FilaAbierto key={a.shipment_id} a={a} />
                            ))}
                        </ul>
                      </details>
                    )}
                  </>
                )}
              </div>
              <div>
                <h4 className="font-bold text-ink">Entregados tarde en las últimas 4 semanas ({d.tardios.length})</h4>
                {d.tardios.length === 0 ? (
                  <p className="mt-1 text-muted">Ninguno.</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {d.tardios.map((t) => (
                      <li key={t.shipment_id} className="text-ink-secondary">
                        <span className="font-semibold text-ink">{t.shipment_id}</span> · {t.localidad ?? "—"} · prometido{" "}
                        {t.limite} · entregado {fmtFechaHora(t.entregado)} ·{" "}
                        <b className="text-danger">
                          {t.dias_tarde} día{t.dias_tarde === 1 ? "" : "s"} tarde
                        </b>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {d.madrugada.length > 0 && (
                <div>
                  <h4 className="font-bold text-ink">Marcados como entregados de madrugada ({d.madrugada.length})</h4>
                  <p className="text-muted">Casi siempre es el envío cerrado en la app días después: vale la pena preguntarle al mensajero.</p>
                  <ul className="mt-1 space-y-1">
                    {d.madrugada.map((m) => (
                      <li key={m.shipment_id} className="text-ink-secondary">
                        <span className="font-semibold text-ink">{m.shipment_id}</span> · {m.localidad ?? "—"} ·{" "}
                        {fmtFechaHora(m.entregado)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Tarjeta>
        </>
      )}
    </div>
  );
}
