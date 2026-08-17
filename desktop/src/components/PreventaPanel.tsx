import { useState } from "react";
import { usePreventa, usePreventaMetricas, useResponderPreventa } from "../hooks/usePreventa";
import type { PreventaConversionBloque, PreventaMetricas } from "../hooks/usePreventa";
import { IllustrationIcon } from "../icons/IllustrationIcon";
import type { IllustrationTone } from "../icons/IllustrationIcon";
import type { UiIconName } from "../icons";

const PERIODOS = [7, 30, 90] as const;

function colorTasa(pct: number): string {
  if (pct >= 25) return "text-success";
  if (pct >= 12) return "text-warning";
  return "text-danger";
}

function StatMini({
  label,
  value,
  sub,
  color = "text-ink",
  icon,
  tone = "accent",
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  icon: UiIconName;
  tone?: IllustrationTone;
}) {
  return (
    <div className="mck-card mck-card-interactive group flex gap-3 p-4">
      <IllustrationIcon
        name={icon}
        size={36}
        tone={tone}
        className="mck-illus-icon--hoverable shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold tracking-tight text-muted">{label}</p>
        <p className={`mt-0.5 text-3xl font-extrabold tabular-nums tracking-tight ${color}`}>
          {value}
        </p>
        {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
      </div>
    </div>
  );
}

function ConversionStats({
  data,
  dias,
  onDias,
  onRefresh,
  refreshing,
}: {
  data: PreventaMetricas;
  dias: number;
  onDias: (n: number) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const r = data.resumen;
  const exp = data.conversion_explicacion;
  const resp = data.por_respuesta.respondidas;
  const sin = data.por_respuesta.sin_responder;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <IllustrationIcon name="chartBar" size={32} tone="sky" />
          <div>
            <h3 className="text-lg font-extrabold text-ink">Porcentaje de compra</h3>
            <p className="text-sm text-muted">
              {data.periodo.desde} → {data.periodo.hasta}
              {data.stale ? " · actualizando…" : data.desde_cache ? " · cache" : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border bg-surface-panel p-0.5">
            {PERIODOS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onDias(n)}
                className={`rounded-md px-3 py-1 text-sm font-semibold transition ${
                  dias === n
                    ? "bg-accent text-white"
                    : "text-muted hover:text-ink"
                }`}
              >
                {n}d
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted transition hover:text-ink disabled:opacity-40"
          >
            {refreshing ? "Calculando…" : "Recalcular"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatMini
          label="Compraron el producto"
          value={`${r.tasa_compra_pct}%`}
          sub={`${r.compraron_mismo_item} de ${r.oportunidades} que preguntaron`}
          color={colorTasa(r.tasa_compra_pct)}
          icon="cart"
          tone="sun"
        />
        <StatMini
          label="Preguntas"
          value={data.preguntas_en_periodo}
          sub={`${r.preguntadores_unicos} personas`}
          icon="question"
          tone="sky"
        />
        <StatMini
          label="Compraron en la tienda"
          value={`${r.tasa_compra_tienda_pct}%`}
          sub="cualquier producto después de preguntar"
          color={colorTasa(r.tasa_compra_tienda_pct)}
          icon="package"
          tone="leaf"
        />
        <StatMini
          label="Aún en espera"
          value={data.oportunidades_en_espera}
          sub={`preguntaron hace menos de ${data.margen_horas} h`}
          icon="hourglass"
          tone="plum"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <RespuestaCard
          titulo="Con respuesta"
          bloque={resp}
          hint="Preguntas que sí se contestaron"
        />
        <RespuestaCard
          titulo="Sin respuesta"
          bloque={sin}
          hint="Preguntas que quedaron abiertas"
        />
      </div>

      {exp && (
        <p className="rounded-xl border border-border bg-surface-panel px-4 py-3 text-sm leading-relaxed text-ink-muted">
          <span className="font-semibold text-ink">{exp.titulo}. </span>
          {exp.texto} {exp.compra_significa}
        </p>
      )}

      {data.por_producto.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface-panel">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="px-4 py-2 font-semibold">Producto</th>
                <th className="px-3 py-2 font-semibold tabular-nums">Preguntaron</th>
                <th className="px-3 py-2 font-semibold tabular-nums">Compraron</th>
                <th className="px-3 py-2 font-semibold tabular-nums">% compra</th>
              </tr>
            </thead>
            <tbody>
              {data.por_producto.slice(0, 12).map((p) => (
                <tr key={p.item_id} className="border-b border-border/60 last:border-0">
                  <td className="max-w-[18rem] truncate px-4 py-2 text-ink" title={p.titulo}>
                    {p.titulo}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-ink-muted">{p.oportunidades}</td>
                  <td className="px-3 py-2 tabular-nums text-ink-muted">
                    {p.compraron_mismo_item}
                  </td>
                  <td className={`px-3 py-2 font-bold tabular-nums ${colorTasa(p.tasa_compra_pct)}`}>
                    {p.tasa_compra_pct}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RespuestaCard({
  titulo,
  bloque,
  hint,
}: {
  titulo: string;
  bloque: PreventaConversionBloque;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-panel px-4 py-3">
      <p className="text-sm font-semibold text-ink">{titulo}</p>
      <p className="text-xs text-muted">{hint}</p>
      <p className={`mt-1 text-2xl font-extrabold tabular-nums ${colorTasa(bloque.tasa_compra_pct)}`}>
        {bloque.tasa_compra_pct}%
      </p>
      <p className="text-sm text-muted">
        {bloque.compraron_mismo_item}/{bloque.oportunidades} compraron el producto
      </p>
    </div>
  );
}

export default function PreventaPanel() {
  const { data, isLoading, refetch } = usePreventa();
  const responder = useResponderPreventa();
  const [respuestas, setRespuestas] = useState<Record<string, string>>({});
  const [dias, setDias] = useState(30);
  const metricas = usePreventaMetricas(dias);
  const [recalculando, setRecalculando] = useState(false);

  const handleRecalcular = async () => {
    setRecalculando(true);
    try {
      await metricas.recalcular();
    } catch {
      /* el query muestra error si no hay data; si ya hay cache se conserva */
    } finally {
      setRecalculando(false);
    }
  };

  const preguntas = data?.preguntas ?? [];

  const handleSubmit = (qid: string) => {
    const texto = (respuestas[qid] ?? "").trim();
    if (!texto) return;
    responder.mutate(
      { question_id: qid, respuesta: texto },
      {
        onSuccess: () => {
          setRespuestas((r) => {
            const next = { ...r };
            delete next[qid];
            return next;
          });
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-extrabold text-ink">
          🛒 Preventa MeLi
          {data && (
            <span className="ml-2 text-lg font-normal text-muted">
              ({data.total} pendiente{data.total !== 1 ? "s" : ""})
            </span>
          )}
        </h2>
        <button
          onClick={() => refetch()}
          className="rounded-lg border border-border px-3 py-1.5 text-base text-muted transition hover:text-ink"
        >
          Actualizar
        </button>
      </div>

      {metricas.isLoading && !metricas.data && (
        <div className="mck-skeleton h-40 w-full rounded-paper" />
      )}
      {metricas.isError && !metricas.data && (
        <p className="rounded-xl border border-danger/30 bg-surface-panel px-4 py-3 text-sm text-danger">
          No se pudieron cargar las estadísticas de compra. Reintenta con Recalcular.
        </p>
      )}
      {metricas.data && (
        <ConversionStats
          data={metricas.data}
          dias={dias}
          onDias={setDias}
          onRefresh={() => void handleRecalcular()}
          refreshing={recalculando || metricas.isFetching}
        />
      )}

      {isLoading && <p className="text-lg text-muted">Cargando pendientes...</p>}

      {!isLoading && (
        <h3 className="pt-2 text-lg font-extrabold text-ink">
          Pendientes por responder
        </h3>
      )}

      {!isLoading && preguntas.length === 0 && (
        <div className="rounded-xl border border-border bg-surface-panel p-8 text-center">
          <p className="text-lg text-success">Sin preguntas pendientes</p>
        </div>
      )}

      <div className="grid gap-4 items-start lg:grid-cols-2">
        {preguntas.map((p) => (
          <div
            key={p.question_id}
            className="rounded-xl border border-border bg-surface-panel p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-lg font-medium text-ink truncate">
                  {p.titulo_producto}
                </p>
                <p className="mt-1 text-lg text-ink-muted">
                  &ldquo;{p.pregunta}&rdquo;
                </p>
                <p className="mt-1 text-base text-muted">
                  ID: ...{p.question_id.slice(-4)} &middot;{" "}
                  {new Date(p.timestamp).toLocaleString("es-CO", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={respuestas[p.question_id] ?? ""}
                onChange={(e) =>
                  setRespuestas((r) => ({ ...r, [p.question_id]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit(p.question_id);
                }}
                placeholder="Escribir respuesta..."
                className="flex-1 rounded-lg border border-border bg-surface-input px-3 py-2 text-lg text-ink outline-none placeholder:text-muted/50 focus:border-accent"
              />
              <button
                onClick={() => handleSubmit(p.question_id)}
                disabled={!(respuestas[p.question_id] ?? "").trim() || responder.isPending}
                className="rounded-lg bg-accent px-4 py-2 text-lg font-medium text-white transition hover:bg-accent-hover disabled:opacity-40"
              >
                {responder.isPending ? "..." : "Responder"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
