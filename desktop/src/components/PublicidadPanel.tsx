import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  usePublicidadResumen,
  usePublicidadRecomendaciones,
  usePublicidadPlanMigracion,
  usePublicidadConfigGrupos,
  useGuardarConfigGrupos,
  usePublicidadAlertasReasignacion,
  usePublicidadMargenesReales,
  usePublicidadAdsVsPromociones,
  useRefrescarPublicidad,
  type PublicidadItem,
  type PublicidadRecomendacionItem,
  type PublicidadItemConMargen,
  type GrupoCampana,
  type CanalPublicidad,
  type PublicidadAlertasReasignacion,
} from "../hooks/usePublicidad";

// ── Helpers ──────────────────────────────────────────────────────────────────

function cop(n: number | null | undefined): string {
  return `$${Math.round(n ?? 0).toLocaleString("es-CO")}`;
}

function pct(n: number | null | undefined, digits = 1): string {
  if (n == null) return "—";
  return `${n.toLocaleString("es-CO", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

function acosPillClass(acos: number): string {
  if (acos > 100) return "bg-danger/15 text-danger";
  if (acos > 60) return "bg-warning/15 text-warning";
  return "bg-border text-ink-secondary";
}

const DIAS_OPCIONES = [30, 60, 90] as const;

/** Botón compacto para copiar el nombre de una publicación — para pegarlo en el buscador de Mercado Ads. */
function CopyButton({ text }: { text: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void navigator.clipboard?.writeText(text);
        setCopiado(true);
        window.setTimeout(() => setCopiado(false), 1200);
      }}
      title="Copiar nombre de la publicación"
      aria-label="Copiar nombre de la publicación"
      className="shrink-0 inline-flex items-center justify-center rounded-md p-1 text-muted hover:text-accent hover:bg-surface-hover transition"
    >
      {copiado ? (
        <span className="text-[11px] font-bold text-accent leading-none">✓</span>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

// Espejo (solo para mostrar) de NIVELES_ACOS en app/services/meli_ads_recomendaciones.py —
// si cambia el umbral ahí, actualizar aquí también.
const NIVEL_LIMITES: Record<string, { label: string; objetivo: number; pausar: number }> = {
  alta: { label: "Alta rotación", objetivo: 50, pausar: 90 },
  media: { label: "Rotación media", objetivo: 40, pausar: 70 },
  baja: { label: "Baja rotación", objetivo: 25, pausar: 55 },
  sin_ventas: { label: "Sin ventas (general)", objetivo: 15, pausar: 40 },
};

const GRUPO_ORDEN: GrupoCampana[] = ["alta", "media", "baja"];
const GRUPO_COLOR: Record<GrupoCampana, string> = {
  alta: "bg-accent",
  media: "bg-warning",
  baja: "bg-muted/60",
};

// ── Sub-componentes ──────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  sub,
  subClass,
  title,
}: {
  label: string;
  value: string;
  sub?: string;
  subClass?: string;
  title?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2.5" title={title}>
      <p className="text-[10px] text-muted uppercase tracking-wide">{label}</p>
      <p className="text-xl font-bold text-ink font-mono tabular-nums">{value}</p>
      {sub && <p className={`text-[11px] mt-0.5 ${subClass ?? "text-ink-secondary"}`}>{sub}</p>}
    </div>
  );
}

/** Bloque de explicación fijo (no tooltip) al pie de cada sección — de dónde sale el dato y qué significa. */
function Explicacion({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 text-[12px] leading-relaxed text-ink-secondary bg-surface/60 border border-border rounded-lg px-3 py-2">
      {children}
    </p>
  );
}

function TablaItems({
  items,
  columnaExtra,
}: {
  items: PublicidadItem[];
  columnaExtra?: "perdida" | "marca";
}) {
  return (
    <div className="rounded-xl border-2 border-border overflow-hidden">
      <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
        <table className="w-full text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-surface-hover border-b-2 border-border text-[10px] font-bold uppercase tracking-wide text-muted">
              <th className="px-3 py-2.5">Producto</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">Gasto ads</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">Ventas</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">ACOS</th>
              {columnaExtra === "perdida" && (
                <th className="px-3 py-2.5 text-right whitespace-nowrap">Pérdida</th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.item_id} className="border-b border-border last:border-b-0 hover:bg-surface-hover">
                <td className="px-3 py-2 max-w-[280px]">
                  <div className="flex items-center gap-1 min-w-0">
                    <CopyButton text={it.titulo} />
                    {it.permalink ? (
                      <a
                        href={it.permalink}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-sm font-semibold text-ink hover:text-accent"
                        title={it.titulo}
                      >
                        {it.titulo}
                      </a>
                    ) : (
                      <span className="block truncate text-sm font-semibold text-ink" title={it.titulo}>
                        {it.titulo}
                      </span>
                    )}
                  </div>
                  {columnaExtra === "marca" && it.marca && (
                    <span className="block text-[11px] text-muted">{it.marca}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-sm text-ink whitespace-nowrap">
                  {cop(it.costo)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-sm text-ink-secondary whitespace-nowrap">
                  {cop(it.ventas)}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold font-mono ${acosPillClass(it.acos)}`}>
                    {pct(it.acos)}
                  </span>
                </td>
                {columnaExtra === "perdida" && (
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-sm font-bold text-danger whitespace-nowrap">
                    -{cop(it.costo - it.ventas)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MargenRealSeccion({ dias }: { dias: number }) {
  const { data, isLoading, error, isFetching } = usePublicidadMargenesReales(dias);
  const [tab, setTab] = useState<"sin_sku" | "con_margen">("sin_sku");

  return (
    <div className="rounded-xl border-2 border-border bg-surface-panel p-4">
      <h3 className="text-sm font-bold text-ink mb-1">Margen real (SKU MeLi ↔ costo de combo Siigo)</h3>
      <p className="text-xs text-ink-secondary mb-3 max-w-2xl leading-relaxed">
        Cruza cada publicación con su código de Siigo real (campo <span className="font-mono">seller_custom_field</span>{" "}
        de la publicación, no el nombre) y el costo del combo (materia prima + envase + etiqueta + operativos) para
        calcular el ACOS de equilibrio exacto, en vez de estimarlo por rotación. Donde hay margen real, las
        recomendaciones y el plan de campañas de arriba ya lo están usando.
      </p>

      {isLoading && (
        <p className="text-xs text-muted py-4 flex items-center gap-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          Cruzando SKUs (puede tardar ~20s la primera vez)…
        </p>
      )}
      {!isLoading && error && <p className="text-xs text-danger py-4">No se pudo calcular: {(error as Error).message}</p>}

      {!isLoading && !error && data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            <StatTile label="Con margen real" value={String(data.cobertura.con_margen_real)} sub={`de ${data.cobertura.total_pautado} pautados`} />
            <StatTile
              label="Sin SKU en MeLi"
              value={String(data.cobertura.sin_sku_en_meli)}
              subClass="text-warning font-semibold"
              title="La publicación nunca tuvo el campo SKU (seller_custom_field) cargado — no hay forma de saber a qué combo de Siigo corresponde."
            />
            <StatTile
              label="SKU sin costo en Siigo"
              value={String(data.cobertura.con_sku_sin_costo_siigo)}
              title="Tiene SKU, pero ese código no existe como combo en Siigo o su receta no tiene costo calculado."
            />
            <StatTile label="Sin ventas en el período" value={String(data.cobertura.con_costo_pero_sin_ventas_periodo)} title="Tiene costo conocido pero no vendió nada vía ads en el período — no hay precio de venta realizado con qué calcular margen." />
          </div>

          <div className="flex gap-2 mb-2">
            <button
              type="button"
              onClick={() => setTab("sin_sku")}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                tab === "sin_sku" ? "bg-warning text-white" : "bg-surface border border-border text-ink-secondary"
              }`}
            >
              Sin SKU en MeLi ({data.sin_sku_en_meli.length})
            </button>
            <button
              type="button"
              onClick={() => setTab("con_margen")}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                tab === "con_margen" ? "bg-accent text-white" : "bg-surface border border-border text-ink-secondary"
              }`}
            >
              Con margen calculado ({data.con_margen.length})
            </button>
          </div>

          {tab === "sin_sku" && (
            <>
              <p className="text-[11px] text-muted mb-2">
                Acción más simple y de mayor impacto: entra a cada publicación en MeLi y llena el campo SKU con el
                código de Siigo correspondiente — en cuanto lo hagas, la próxima corrida calcula su margen real.
              </p>
              <TablaItems items={data.sin_sku_en_meli} />
            </>
          )}

          {tab === "con_margen" && (
            <div className="rounded-xl border-2 border-border overflow-hidden">
              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full text-left">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-surface-hover border-b-2 border-border text-[10px] font-bold uppercase tracking-wide text-muted">
                      <th className="px-3 py-2.5">Producto</th>
                      <th className="px-3 py-2.5 text-right">Costo combo</th>
                      <th className="px-3 py-2.5 text-right">Precio ref.</th>
                      <th className="px-3 py-2.5 text-right">Margen neto</th>
                      <th className="px-3 py-2.5 text-right">ACOS actual</th>
                      <th className="px-3 py-2.5 text-right">ACOS equilibrio</th>
                      <th className="px-3 py-2.5 text-center">¿Rentable hoy?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.con_margen as PublicidadItemConMargen[]).map((it) => (
                      <tr key={it.item_id} className="border-b border-border last:border-b-0 hover:bg-surface-hover">
                        <td className="px-3 py-2 max-w-[240px]">
                          <div className="flex items-center gap-1 min-w-0">
                            <CopyButton text={it.titulo} />
                            <span className="block truncate text-sm font-semibold text-ink" title={it.titulo}>{it.titulo}</span>
                          </div>
                          <span className="block text-[10px] text-muted font-mono">{it.sku}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-sm text-ink-secondary whitespace-nowrap">{cop(it.costo_combo)}</td>
                        <td className="px-3 py-2 text-right font-mono text-sm text-ink-secondary whitespace-nowrap">{cop(it.precio_venta_ref)}</td>
                        <td className="px-3 py-2 text-right font-mono text-sm text-ink whitespace-nowrap">{pct(it.margen_neto_pct)}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold font-mono ${acosPillClass(it.acos)}`}>{pct(it.acos)}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-sm text-ink-secondary whitespace-nowrap">{pct(it.acos_equilibrio_pct)}</td>
                        <td className="px-3 py-2 text-center">
                          {it.rentable_hoy ? (
                            <span className="text-accent font-bold text-xs">Sí</span>
                          ) : (
                            <span className="text-danger font-bold text-xs">No</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <Explicacion>
            Margen neto = precio de venta − costo del combo − comisión de MeLi ({data.comision_meli_pct.toFixed(1)}%).
            No se descuenta IVA por falta de ese dato por producto, así que es una aproximación conservadora — sirve
            para fijar techos de ACOS, no como cifra contable exacta. El "ACOS de equilibrio" es el punto exacto
            donde el gasto en ads se come toda la utilidad; el objetivo sugerido en las recomendaciones queda un 35%
            por debajo de ese punto para dejar utilidad real, no solo no perder plata.
            {isFetching && " Actualizando…"}
          </Explicacion>
        </>
      )}
    </div>
  );
}

const CANAL_LABEL: Record<CanalPublicidad, string> = {
  ninguno: "Ninguno",
  ads: "Ads",
  promocion: "Promoción",
  ambos: "Ambos",
};
const CANAL_COLOR: Record<CanalPublicidad, string> = {
  ninguno: "bg-border text-ink-secondary",
  ads: "bg-accent/15 text-accent",
  promocion: "bg-warning/15 text-warning",
  ambos: "bg-danger/15 text-danger",
};

function AdsVsPromocionesSeccion({ dias }: { dias: number }) {
  const { data, isLoading, error, isFetching } = usePublicidadAdsVsPromociones(dias);
  const [soloDesalineados, setSoloDesalineados] = useState(false);

  const productos = useMemo(() => {
    if (!data) return [];
    return soloDesalineados ? data.productos.filter((p) => !p.coincide) : data.productos;
  }, [data, soloDesalineados]);

  return (
    <div className="rounded-xl border-2 border-border bg-surface-panel p-4">
      <h3 className="text-sm font-bold text-ink mb-1">Ads vs. Promociones — qué canal conviene por producto</h3>
      <p className="text-xs text-ink-secondary mb-3 max-w-2xl leading-relaxed">
        No son gratis de la misma forma: en <strong className="text-ink">Ads</strong> el precio no cambia y tú pagas
        el 100% del ACOS aparte. En <strong className="text-ink">Promociones</strong> el precio sí baja, pero MeLi
        cofinancia parte del descuento en varios tipos (SMART, VOLUME…) — tú solo pones tu porción
        (<span className="font-mono">seller_percentage</span>). Comparado por unidad, a veces la promoción sale
        mucho más barata que el ACOS que ya estás pagando. Evaluado solo sobre los {data?.total_evaluados ?? "…"}{" "}
        productos con margen real conocido (ver "Margen real" arriba) — sin costo real no hay con qué comparar honesto.
      </p>

      {isLoading && (
        <div className="flex items-center gap-2 py-6 text-xs text-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          Consultando promociones candidatas por producto — la primera vez puede tardar unos minutos (se
          cachea 1 hora después).
        </div>
      )}
      {!isLoading && error && <p className="text-xs text-danger py-4">No se pudo calcular: {(error as Error).message}</p>}

      {!isLoading && !error && data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
            <StatTile label="Ninguno" value={String(data.resumen.ninguno)} title="Margen insuficiente para aguantar Ads o Promoción." />
            <StatTile label="Ads" value={String(data.resumen.ads)} subClass="text-accent font-semibold" title="Alta rotación con margen suficiente — protege el precio, ya vende bien solo." />
            <StatTile label="Promoción" value={String(data.resumen.promocion)} subClass="text-warning font-semibold" title="Rotación media/baja con margen suficiente — mejor mover con descuento (cofinanciado) que quemar presupuesto de ads." />
            <StatTile label="Ambos" value={String(data.resumen.ambos)} subClass="text-danger font-semibold" title="Margen muy alto + alta rotación — colchón de sobra para los dos canales." />
            <StatTile
              label="Desalineados"
              value={String(data.resumen.desalineados)}
              subClass="text-warning font-semibold"
              title="Canal actual (dónde está pautado/promocionado hoy) no coincide con el recomendado — la mayoría son productos que hoy no están ni en ads ni en promoción cuando deberían estar en promoción, no un dato desactualizado."
            />
          </div>
          {data.resumen.campana_inexistente > 0 && (
            <p className="text-[10px] text-muted mb-2">
              Se excluyeron {data.resumen.campana_inexistente} producto(s) con gasto histórico de una campaña que ya no existe en Mercado Ads.
            </p>
          )}

          <label className="flex items-center gap-2 mb-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={soloDesalineados}
              onChange={(e) => setSoloDesalineados(e.target.checked)}
              className="accent-accent w-3.5 h-3.5"
            />
            <span className="text-xs text-ink-secondary">Mostrar solo desalineados ({data.resumen.desalineados})</span>
          </label>

          <div className="rounded-xl border-2 border-border overflow-hidden max-h-[440px] overflow-y-auto">
            {productos.length === 0 ? (
              <p className="text-xs text-muted p-4 text-center">Nada que mostrar con este filtro.</p>
            ) : (
              productos.map((p) => (
                <div key={p.item_id} className="border-b border-border last:border-b-0 px-3 py-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <CopyButton text={p.titulo} />
                        {p.permalink ? (
                          <a href={p.permalink} target="_blank" rel="noreferrer" className="text-sm font-semibold text-ink hover:text-accent">
                            {p.titulo}
                          </a>
                        ) : (
                          <span className="text-sm font-semibold text-ink">{p.titulo}</span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                        <span className="rounded-full bg-border px-2 py-0.5 text-[10px] font-bold text-ink-secondary">
                          {NIVEL_LIMITES[p.nivel_rotacion]?.label ?? p.nivel_rotacion}
                        </span>
                        <span className="text-[11px] font-mono text-ink-secondary">margen {pct(p.margen_neto_pct)}</span>
                        <span className="text-[11px] font-mono text-ink-secondary">ACOS {pct(p.acos_actual)}</span>
                        <span className="text-[11px] font-mono text-ink-secondary">${Math.round(p.costo_ads_por_unidad).toLocaleString("es-CO")}/unidad en ads</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${CANAL_COLOR[p.canal_actual]}`}>
                        hoy: {CANAL_LABEL[p.canal_actual]}
                      </span>
                      <span className="text-ink-muted text-xs">→</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${CANAL_COLOR[p.canal_recomendado]}`}>
                        {CANAL_LABEL[p.canal_recomendado]}
                      </span>
                    </div>
                  </div>
                  {p.promo_candidata && (
                    <p className="text-[11px] text-muted mt-1.5 leading-relaxed">
                      Promo disponible: <strong className="text-ink">{p.promo_candidata.nombre ?? p.promo_candidata.tipo}</strong> —{" "}
                      {pct(p.promo_candidata.descuento_pct)} de descuento total
                      {p.promo_candidata.meli_percentage > 0 && (
                        <> (MeLi cubre {pct(p.promo_candidata.meli_percentage)}, tú {pct(p.promo_candidata.seller_percentage)})</>
                      )}
                      {" — "}tu costo real ≈ ${Math.round(p.promo_candidata.costo_promo_por_unidad).toLocaleString("es-CO")}/unidad
                      {p.promo_candidata.costo_promo_por_unidad < p.costo_ads_por_unidad && p.costo_ads_por_unidad > 0 && (
                        <span className="text-accent font-semibold"> (más barato que el ads actual)</span>
                      )}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>

          {data.resumen.errores_consultando_promos > 0 && (
            <p className="text-[10px] text-muted mt-2">
              {data.resumen.errores_consultando_promos} producto(s) no se pudieron consultar en Mercado Ads (reintenta con Actualizar).
            </p>
          )}
          <Explicacion>
            "Canal actual" mira si el producto tiene gasto en ads en el período y/o alguna promoción ya aplicada
            (no candidata). "Recomendado" sale de margen neto + rotación: menos de 15% de margen no aguanta
            ninguno de los dos canales; 50%+ de margen con alta rotación aguanta ambos; alta rotación sola
            favorece ads (protege el precio); rotación media o baja favorece promoción (mueve inventario,
            aprovecha el cofinanciamiento de MeLi cuando existe). Umbrales ajustables — están en
            app/services/meli_ads_vs_promociones.py.
            {isFetching && " Actualizando…"}
          </Explicacion>
        </>
      )}
    </div>
  );
}

function RecomendacionFila({ f }: { f: PublicidadRecomendacionItem }) {
  const nivel = NIVEL_LIMITES[f.nivel_rotacion] ?? NIVEL_LIMITES.baja;
  return (
    <div className={`border-b border-border last:border-b-0 px-3 py-2.5 ${!f.activo_en_meli ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <CopyButton text={f.titulo} />
            {f.permalink ? (
              <a
                href={f.permalink}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-semibold text-ink hover:text-accent"
              >
                {f.titulo}
              </a>
            ) : (
              <span className="text-sm font-semibold text-ink">{f.titulo}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
            {!f.activo_en_meli && (
              <span
                className="rounded-full bg-muted/20 px-2 py-0.5 text-[10px] font-bold text-muted"
                title={`Último estado que reportó MeLi: ${f.status || "no activo"}. La API de MeLi no siempre refleja al instante cambios hechos en las últimas 24-48h en el panel de Mercado Ads — si lo pausaste hace poco y esto no coincide, confía en lo que veas directo en MeLi.`}
              >
                Según MeLi, ya no activo ({f.status || "?"})
              </span>
            )}
            {f.margen_real ? (
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">
                Margen real
              </span>
            ) : (
              <span className="rounded-full bg-border px-2 py-0.5 text-[10px] font-bold text-ink-secondary">
                {nivel.label}
                {!f.rotacion_con_dato && " (sin dato, asumida)"}
              </span>
            )}
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold font-mono ${acosPillClass(f.acos)}`}>
              ACOS {pct(f.acos)}
            </span>
            <span className="text-[11px] font-mono text-ink-secondary">{cop(f.costo)}</span>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-muted mt-1.5 leading-relaxed">{f.motivo}</p>
    </div>
  );
}

function RecomendacionesSeccion({ dias }: { dias: number }) {
  const { data, isLoading, error } = usePublicidadRecomendaciones(dias);
  const [tab, setTab] = useState<"pausar" | "revisar">("pausar");

  return (
    <div className="rounded-xl border-2 border-accent/30 bg-accent/5 p-4">
      <h3 className="text-sm font-bold text-ink mb-1">Qué hacer esta semana</h3>
      <p className="text-xs text-ink-secondary mb-3 max-w-2xl leading-relaxed">
        Motor de recomendaciones: cruza el ACOS de cada producto con su <strong>rotación real</strong> de
        ventas en MeLi (no solo lo vendido vía el anuncio) para no exigirle el mismo ACOS a un producto
        estrella que a uno que casi no se vende. MeLi no permite pausar un producto por API — esta lista es
        para que tú lo hagas en un par de clics desde Mercado Ads; el mismo cálculo corre solo cada lunes y
        avisa por WhatsApp + un ticket en el Centro de Mando.
      </p>

      {isLoading && (
        <div className="flex items-center gap-2 py-6 text-sm text-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          Calculando recomendaciones…
        </div>
      )}

      {!isLoading && error && (
        <p className="text-xs text-danger py-4">No se pudo calcular: {(error as Error).message}</p>
      )}

      {!isLoading && !error && data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 mb-3">
            <StatTile
              label="Pausar"
              value={String(data.resumen.pausar)}
              sub={cop(data.resumen.costo_pausar)}
              subClass="text-danger font-semibold"
              title="ACOS por encima del punto de equilibrio (margen real si se conoce, si no del límite de pausa por rotación), o cero ventas con gasto relevante."
            />
            <StatTile
              label="Revisar"
              value={String(data.resumen.revisar)}
              sub={cop(data.resumen.costo_revisar)}
              subClass="text-warning font-semibold"
              title="ACOS por encima del objetivo pero no del punto de equilibrio — vale la pena mirarlo, no es urgente."
            />
            <StatTile label="Dentro de objetivo" value={String(data.resumen.ok)} title="ACOS dentro del objetivo (margen real o rotación, según cuál se conozca)." />
            <StatTile
              label="Con margen real"
              value={String(data.resumen.con_margen_real)}
              subClass="text-accent font-semibold"
              title="Productos donde el límite usado viene del costo real del combo en Siigo, no de un estimado por rotación."
            />
            <StatTile
              label="Sin dato de rotación"
              value={String(data.resumen.sin_dato_rotacion)}
              title="No aparece en las ventas generales de MeLi del período — se evaluó conservador, como si fuera de baja rotación (solo aplica cuando tampoco hay margen real)."
            />
            <StatTile
              label="Ya no activos"
              value={String(data.resumen.no_activos)}
              title="De pausar+revisar, cuántos ya están idle/hold/paused en una campaña vigente — siguen en la lista, marcados, para no tener que ir a chequear uno por uno."
            />
            {data.resumen.campana_inexistente > 0 && (
              <StatTile
                label="De campaña vieja"
                value={String(data.resumen.campana_inexistente)}
                subClass="text-muted"
                title="Tenían gasto histórico pero su campaign_id ya no aparece en Mercado Ads (campaña vieja/eliminada) — no hay dónde ir a verificarlos, se excluyen del listado."
              />
            )}
          </div>
          <p className="text-[10px] text-muted mb-3 leading-relaxed">
            El estado "activo/pausado" lo reporta la propia API de MeLi — confirmado ago-2026 que a veces
            tarda 24-48h en reflejar cambios que acabas de hacer en el panel de Mercado Ads. Si pausaste algo
            hace poco y todavía sale como activo acá, no es un error nuestro: espera un día y actualiza, o
            verifica directo en MeLi.
          </p>

          <details className="mb-3 text-xs">
            <summary className="cursor-pointer text-ink-secondary font-semibold select-none">
              Ver la regla completa por nivel de rotación
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="text-[11px] border-collapse">
                <thead>
                  <tr className="text-muted">
                    <th className="text-left pr-4 py-1">Rotación</th>
                    <th className="text-right pr-4 py-1">ACOS objetivo (revisar desde aquí)</th>
                    <th className="text-right py-1">ACOS límite (pausar desde aquí)</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(NIVEL_LIMITES).map(([k, v]) => (
                    <tr key={k} className="border-t border-border">
                      <td className="pr-4 py-1 text-ink">{v.label}</td>
                      <td className="pr-4 py-1 text-right font-mono text-ink-secondary">{v.objetivo}%</td>
                      <td className="py-1 text-right font-mono text-ink-secondary">{v.pausar}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-muted mt-2 leading-relaxed">
                Un producto de alta rotación tolera más ACOS porque es motor de ventas del negocio; uno de
                baja rotación o sin ventas no tiene ese colchón. Rotación = unidades vendidas en MeLi en el
                mismo período (cualquier canal, no solo el anuncio) — ver también "Con clicks/impresiones
                pero cero ventas" más abajo, que mide solo lo vendido vía el anuncio.
              </p>
            </div>
          </details>

          <div className="flex gap-2 mb-2">
            <button
              type="button"
              onClick={() => setTab("pausar")}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                tab === "pausar" ? "bg-danger text-white" : "bg-surface border border-border text-ink-secondary"
              }`}
            >
              Pausar ({data.pausar.length})
            </button>
            <button
              type="button"
              onClick={() => setTab("revisar")}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                tab === "revisar" ? "bg-warning text-white" : "bg-surface border border-border text-ink-secondary"
              }`}
            >
              Revisar ({data.revisar.length})
            </button>
          </div>

          <div className="rounded-xl border-2 border-border bg-surface overflow-hidden max-h-[420px] overflow-y-auto">
            {(tab === "pausar" ? data.pausar : data.revisar).length === 0 ? (
              <p className="text-xs text-muted p-4 text-center">Nada en esta categoría — buena señal.</p>
            ) : (
              (tab === "pausar" ? data.pausar : data.revisar).map((f) => <RecomendacionFila key={f.item_id} f={f} />)
            )}
          </div>
        </>
      )}
    </div>
  );
}

function PlanMigracionSeccion({
  dias,
  campanasDisponibles,
}: {
  dias: number;
  campanasDisponibles: Array<{ id: number | null; nombre: string | null }>;
}) {
  const { data: plan, isLoading, error } = usePublicidadPlanMigracion(dias);
  const { data: config } = usePublicidadConfigGrupos();
  const guardarConfig = useGuardarConfigGrupos();
  const { data: alertas } = usePublicidadAlertasReasignacion(dias);

  const [mapa, setMapa] = useState<Record<GrupoCampana, number | null>>({
    alta: null,
    media: null,
    baja: null,
  });

  useEffect(() => {
    if (config?.mapa) setMapa(config.mapa);
  }, [config]);

  const opciones = campanasDisponibles.filter((c) => c.id != null);

  return (
    <div className="rounded-xl border-2 border-border bg-surface-panel p-4">
      <h3 className="text-sm font-bold text-ink mb-1">Plan: 3 campañas por rotación (alta / media / baja)</h3>
      <p className="text-xs text-ink-secondary mb-4 max-w-2xl leading-relaxed">
        Reparto propuesto del catálogo pautado por rotación de ventas — no por marca propia/ajena: lo que
        predice cuánto ACOS aguanta un producto es cuánto rota, no de quién es la marca. Cada grupo trae el
        ACOS objetivo y presupuesto diario sugeridos. Créalas manualmente en Mercado Ads (la API sigue sin
        permiso de escritura en esta cuenta) y usa la lista de cada grupo como referencia de qué mover a cada una.
      </p>

      {isLoading && <p className="text-xs text-muted py-4">Calculando el reparto…</p>}
      {!isLoading && error && <p className="text-xs text-danger py-4">No se pudo calcular: {(error as Error).message}</p>}

      {!isLoading && !error && plan && (
        <div className="space-y-4">
          {GRUPO_ORDEN.map((g) => {
            const grupo = plan.grupos[g];
            return (
              <div key={g} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-sm ${GRUPO_COLOR[g]}`} />
                    <span className="text-sm font-bold text-ink">{grupo.nombre}</span>
                    <span className="text-[11px] text-muted">({grupo.count} productos)</span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-[11px] font-mono">
                    <span className="text-ink-secondary">ACOS objetivo sugerido: <strong className="text-ink">{pct(grupo.acos_target_sugerido, 0)}</strong></span>
                    <span className="text-ink-secondary">Presupuesto/día sugerido: <strong className="text-ink">{cop(grupo.presupuesto_diario_sugerido)}</strong></span>
                  </div>
                </div>
                <p className="text-[10px] mt-1">
                  <span className={grupo.con_margen_real > 0 ? "text-accent font-semibold" : "text-muted"}>
                    Fuente del objetivo: {grupo.acos_target_fuente}
                  </span>
                </p>
                <p className="text-[11px] text-muted mt-1 mb-2 leading-relaxed">{grupo.descripcion}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-secondary font-mono mb-2">
                  <span>Gasto últimos {dias}d: {cop(grupo.costo_30d)}</span>
                  <span>Ventas atribuidas: {cop(grupo.ventas_30d)}</span>
                  <span>ACOS actual del grupo: {pct(grupo.acos_actual)}</span>
                </div>
                <details>
                  <summary className="cursor-pointer text-[11px] font-semibold text-accent select-none">
                    Ver los {grupo.items.length} productos de este grupo
                  </summary>
                  <div className="mt-2">
                    <TablaItems items={grupo.items} />
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-5 pt-4 border-t border-border">
        <h4 className="text-xs font-bold text-ink mb-1 uppercase tracking-wide">
          Paso 2 — cuando ya hayas creado las campañas en MeLi
        </h4>
        <p className="text-[11px] text-muted mb-3 leading-relaxed">
          Dile al sistema cuál campaña real de MeLi corresponde a cada grupo. Con eso activas las alertas de
          reasignación de abajo, que avisan cuando un producto cambia de rotación y ya no le corresponde la
          campaña donde está — se revisa cada 15 días (la rotación se mide sobre 30 días, revisarla más
          seguido no aporta señal nueva). Tú haces el movimiento manual en Mercado Ads.
        </p>
        <div className="space-y-2">
          {GRUPO_ORDEN.map((g) => (
            <div key={g} className="flex items-center gap-3">
              <span className="text-xs font-semibold text-ink w-36 shrink-0">{PARAMETROS_NOMBRE[g]}</span>
              <select
                value={mapa[g] ?? ""}
                onChange={(e) => setMapa((prev) => ({ ...prev, [g]: e.target.value ? Number(e.target.value) : null }))}
                className="flex-1 max-w-xs rounded-lg border-2 border-border bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-accent cursor-pointer"
              >
                <option value="">— sin asignar —</option>
                {opciones.map((c) => (
                  <option key={c.id} value={c.id ?? ""}>
                    {c.nombre ?? `Campaña #${c.id}`}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <button
            type="button"
            onClick={() => guardarConfig.mutate(mapa)}
            disabled={guardarConfig.isPending}
            className="mt-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
          >
            {guardarConfig.isPending ? "Guardando…" : "Guardar configuración"}
          </button>
          {guardarConfig.isSuccess && <span className="ml-2 text-[11px] text-accent">Guardado ✓</span>}
        </div>
      </div>

      <div className="mt-5 pt-4 border-t border-border">
        <h4 className="text-xs font-bold text-ink mb-1 uppercase tracking-wide">Ajustes pendientes en las campañas reales</h4>
        {!alertas?.configurado ? (
          <p className="text-[11px] text-muted leading-relaxed">
            Todavía no configuraste el mapeo de arriba — en cuanto lo hagas, aquí aparecen 3 cosas: productos que
            hay que migrar desde la campaña vieja, productos ya migrados que no tienen ninguna venta (pausar,
            no reasignar), y productos que cambiaron de rotación y ya no están en la campaña que les corresponde.
          </p>
        ) : (
          <AjustesCampanasTabs alertas={alertas} />
        )}
      </div>
    </div>
  );
}

function AjustesCampanasTabs({ alertas }: { alertas: PublicidadAlertasReasignacion }) {
  const [tab, setTab] = useState<"migrar" | "pausar" | "reasignar">(
    alertas.migrar_a_campana.length > 0 ? "migrar" : alertas.pausar_de_campana.length > 0 ? "pausar" : "reasignar",
  );

  const TABS = [
    { id: "migrar" as const, label: "Falta migrar", n: alertas.migrar_a_campana.length, color: "bg-accent" },
    { id: "pausar" as const, label: "Pausar (sin venta)", n: alertas.pausar_de_campana.length, color: "bg-danger" },
    { id: "reasignar" as const, label: "Cambiaron de rotación", n: alertas.reasignar.length, color: "bg-warning" },
  ];

  const filas = tab === "migrar" ? alertas.migrar_a_campana : tab === "pausar" ? alertas.pausar_de_campana : alertas.reasignar;

  return (
    <>
      <div className="flex gap-2 mb-2 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              tab === t.id ? `${t.color} text-white` : "bg-surface border border-border text-ink-secondary"
            }`}
          >
            {t.label} ({t.n})
          </button>
        ))}
      </div>
      {filas.length === 0 ? (
        <p className="text-[11px] text-muted p-2">Nada en esta categoría — buena señal.</p>
      ) : (
        <div className="rounded-xl border-2 border-border bg-surface overflow-hidden max-h-[360px] overflow-y-auto">
          {filas.map((a) => (
            <div key={a.item_id} className="border-b border-border last:border-b-0 px-3 py-2.5">
              <div className="flex items-center gap-1">
                <CopyButton text={a.titulo} />
                {a.permalink ? (
                  <a href={a.permalink} target="_blank" rel="noreferrer" className="text-sm font-semibold text-ink hover:text-accent">
                    {a.titulo}
                  </a>
                ) : (
                  <span className="text-sm font-semibold text-ink">{a.titulo}</span>
                )}
              </div>
              <p className="text-[11px] text-muted mt-1">{a.motivo}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

const PARAMETROS_NOMBRE: Record<GrupoCampana, string> = {
  alta: "Alta rotación",
  media: "Media rotación",
  baja: "Baja rotación",
};

// ── Panel principal ──────────────────────────────────────────────────────────

export default function PublicidadPanel() {
  const [dias, setDias] = useState<number>(30);
  const { data, isLoading, error, isFetching } = usePublicidadResumen(dias);
  const refrescar = useRefrescarPublicidad(dias);
  const [refrescando, setRefrescando] = useState(false);

  async function onRefrescar() {
    setRefrescando(true);
    try {
      await refrescar();
    } finally {
      setRefrescando(false);
    }
  }

  const riesgoTotalCosto = useMemo(() => {
    if (!data) return 0;
    return data.riesgo.cero_ventas.costo + data.riesgo.perdida_directa.costo + data.riesgo.acos_60_100.costo;
  }, [data]);

  const riesgoTotalPct = data && data.totales.costo > 0 ? (riesgoTotalCosto / data.totales.costo) * 100 : 0;

  return (
    <div className="space-y-5 p-4">
      {/* ── Header ── */}
      <div className="rounded-xl border-2 border-border bg-surface-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-ink">Publicidad MeLi (Product Ads)</h2>
            <p className="text-xs text-muted mt-0.5 max-w-2xl leading-relaxed">
              MercadoLibre pauta y puja automáticamente por todo el catálogo dentro de{" "}
              <strong className="text-ink-secondary">una sola campaña</strong> — el vendedor no elige
              producto por producto. Este panel trae esos números directo de la API de Mercado Ads y los
              organiza para que puedas ver dónde el algoritmo está gastando bien y dónde no.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={dias}
              onChange={(e) => setDias(Number(e.target.value))}
              className="rounded-xl border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent cursor-pointer"
            >
              {DIAS_OPCIONES.map((d) => (
                <option key={d} value={d}>
                  Últimos {d} días
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void onRefrescar()}
              disabled={refrescando || isFetching}
              className="shrink-0 rounded-xl border-2 border-border px-4 py-2 text-sm font-semibold text-muted hover:text-ink hover:border-accent disabled:opacity-50 flex items-center gap-2 transition"
            >
              {refrescando || isFetching ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              ) : (
                <span className="text-base">↻</span>
              )}
              Actualizar
            </button>
          </div>
        </div>

        {data && (
          <>
            <p className="mt-2 text-[11px] text-muted">
              {data.campanas.length} campaña{data.campanas.length !== 1 ? "s" : ""} ·{" "}
              {data.fuente === "cache" ? "datos en caché" : "datos en vivo"} · actualizado{" "}
              {new Date(data.actualizado_en).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}
            </p>
            {data.campanas.some((c) => c.estado === "paused") && (
              <p className="mt-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning font-semibold">
                ⏸ Tienes campaña(s) en pausa — los productos que solo estaban ahí no se están pautando ahora
                mismo. Revisa el plan de 3 campañas más abajo para reactivarlos organizados por grupo.
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {data.campanas.map((c) => (
                <span
                  key={c.id ?? c.nombre}
                  className={`rounded-full border px-2.5 py-1 text-[11px] ${
                    c.estado === "paused"
                      ? "border-warning/40 bg-warning/10 text-warning"
                      : "border-border bg-surface text-ink-secondary"
                  }`}
                  title={`Presupuesto ${cop(c.presupuesto)} · estado ${c.estado ?? "—"}`}
                >
                  <strong className={c.estado === "paused" ? "text-warning" : "text-ink"}>{c.nombre ?? "Campaña"}</strong>
                  {c.estado === "paused" && " (pausada)"} — objetivo ACOS {pct(c.acos_target, 2)}
                  {c.costo > 0 && <> · gastó {cop(c.costo)}</>}
                </span>
              ))}
            </div>
            <Explicacion>
              MeLi ajusta cuánto pujar por cada producto tratando de que el ACOS de{" "}
              <strong className="text-ink">cada campaña</strong> se acerque a su propio objetivo — dentro de una
              misma campaña, todos sus productos comparten ese único número, sin importar si rotan mucho o poco.
              {data.campanas.length > 1
                ? " Ya hay más de una campaña activa, lo que permite fijar objetivos distintos por grupo de productos (ver 'Qué hacer esta semana' más abajo para la propuesta de cómo dividirlos)."
                : " Hoy solo hay una campaña para todo el catálogo — un ingrediente de rotación baja compite por el mismo objetivo que uno de rotación alta."}{" "}
              Los datos se guardan en caché 1 hora para no golpear la API de MeLi en cada carga del panel — usa
              "Actualizar" si necesitas el número exacto de este momento.
            </Explicacion>
          </>
        )}
      </div>

      {/* ── Estados de carga / error ── */}
      {isLoading && (
        <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          Consultando Mercado Ads…
        </div>
      )}

      {!isLoading && error && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 p-8 text-center">
          <p className="text-2xl mb-2">⚠️</p>
          <p className="text-sm font-semibold text-danger">No se pudo cargar la publicidad de MeLi</p>
          <p className="text-xs text-muted mt-1">{(error as Error).message}</p>
        </div>
      )}

      {!isLoading && !error && data && (
        <>
          {/* ── Stats ── */}
          <div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              <StatTile
                label="Gasto en ads"
                value={cop(data.totales.costo)}
                sub={`${data.periodo.desde} → ${data.periodo.hasta}`}
                title="Lo que MeLi cobró por clics en tus anuncios en el período. Se descuenta junto con la comisión de venta."
              />
              <StatTile
                label="Ventas atribuidas"
                value={cop(data.totales.ventas_atribuidas)}
                sub="directas + indirectas"
                title="Ventas ocurridas después de un clic en el anuncio: 'directas' es el mismo producto anunciado, 'indirectas' es cualquier otro producto que el comprador llevó de paso."
              />
              <StatTile
                label="ACOS real"
                value={pct(data.totales.acos)}
                sub={
                  data.campanas.length === 1
                    ? `objetivo ${pct(data.campanas[0].acos_target, 2)}`
                    : `${data.campanas.length} objetivos distintos`
                }
                title="Advertising Cost of Sale = Gasto ÷ Ventas atribuidas × 100. Cuántos pesos de publicidad pagaste por cada 100 pesos que esa publicidad generó en ventas."
              />
              <StatTile
                label="ROAS"
                value={`${data.totales.roas.toLocaleString("es-CO", { maximumFractionDigits: 2 })}×`}
                sub={
                  data.campanas.length === 1
                    ? `objetivo ${data.campanas[0].roas_target ?? "—"}×`
                    : `${data.campanas.length} objetivos distintos`
                }
                title="Return On Ad Spend = Ventas atribuidas ÷ Gasto. Lo inverso del ACOS: cuántos pesos de venta trajo cada peso invertido en el anuncio."
              />
              <StatTile
                label="En zona de riesgo"
                value={pct(riesgoTotalPct)}
                sub={`${cop(riesgoTotalCosto)} del presupuesto`}
                subClass="text-danger font-semibold"
                title="Suma del gasto en productos con cero ventas o ACOS > 60%. Ver detalle en 'Reparto del presupuesto por nivel de riesgo' abajo."
              />
            </div>
            <Explicacion>
              Estos 5 números resumen el período elegido arriba. El <strong className="text-ink">ACOS</strong>{" "}
              y el <strong className="text-ink">ROAS</strong> son las dos caras de la misma medida: ACOS
              alto = ROAS bajo. Ninguno de los dos te dice si ganaste o perdiste plata por sí solo — para
              eso hace falta compararlo con el margen bruto de cada producto (ver nota de metodología al
              final del panel). Pasa el cursor sobre cada tarjeta para ver de dónde sale el número.
            </Explicacion>
          </div>

          {/* ── Barra de riesgo ── */}
          <div className="rounded-xl border-2 border-border bg-surface-panel p-4">
            <h3 className="text-sm font-bold text-ink mb-1">Reparto del presupuesto por nivel de riesgo</h3>
            <p className="text-xs text-ink-secondary mb-3 max-w-2xl leading-relaxed">
              De cada 100 pesos del presupuesto de ads, esto muestra cuántos fueron a productos con retorno
              nulo o dudoso frente a los que se movieron en un ACOS razonable.
            </p>
            <div className="flex h-8 rounded-lg overflow-hidden border border-border">
              {(() => {
                const total = data.totales.costo || 1;
                const segs = [
                  { pct: (data.riesgo.cero_ventas.costo / total) * 100, className: "bg-danger" },
                  { pct: (data.riesgo.perdida_directa.costo / total) * 100, className: "bg-danger/70" },
                  { pct: (data.riesgo.acos_60_100.costo / total) * 100, className: "bg-warning" },
                  { pct: (data.riesgo.resto.costo / total) * 100, className: "bg-muted/40" },
                ];
                return segs.map((s, i) => (
                  <div key={i} style={{ width: `${s.pct}%` }} className={s.className} />
                ));
              })()}
            </div>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="flex items-start gap-2">
                <span className="mt-1 h-2.5 w-2.5 rounded-sm bg-danger shrink-0" />
                <div>
                  <p className="text-xs font-bold text-ink">Cero ventas ({data.riesgo.cero_ventas.count})</p>
                  <p className="text-[11px] text-muted font-mono">{cop(data.riesgo.cero_ventas.costo)}</p>
                  <p className="text-[10px] text-muted mt-0.5 leading-snug">
                    Tuvo clics pero nadie compró en el período — presupuesto sin ningún retorno.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1 h-2.5 w-2.5 rounded-sm bg-danger/70 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-ink">ACOS &gt;100% ({data.riesgo.perdida_directa.count})</p>
                  <p className="text-[11px] text-muted font-mono">
                    {cop(data.riesgo.perdida_directa.costo)} pérdida bruta -
                    {cop(data.riesgo.perdida_directa.costo - data.riesgo.perdida_directa.ventas)}
                  </p>
                  <p className="text-[10px] text-muted mt-0.5 leading-snug">
                    El anuncio costó más de lo que generó en ventas — pérdida confirmada sin necesitar margen.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1 h-2.5 w-2.5 rounded-sm bg-warning shrink-0" />
                <div>
                  <p className="text-xs font-bold text-ink">ACOS 60–100% ({data.riesgo.acos_60_100.count})</p>
                  <p className="text-[11px] text-muted font-mono">{cop(data.riesgo.acos_60_100.costo)}</p>
                  <p className="text-[10px] text-muted mt-0.5 leading-snug">
                    Vendió, pero se llevó entre 60 y 100 de cada 100 pesos de esa venta en publicidad.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1 h-2.5 w-2.5 rounded-sm bg-muted/40 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-ink">ACOS ≤60%</p>
                  <p className="text-[11px] text-muted font-mono">{cop(data.riesgo.resto.costo)}</p>
                  <p className="text-[10px] text-muted mt-0.5 leading-snug">
                    El resto del catálogo — dentro de un rango razonable, sin implicar margen confirmado.
                  </p>
                </div>
              </div>
            </div>
            <Explicacion>
              El ACOS no dice si ganaste o perdiste plata — dice qué proporción de la venta se fue en el
              anuncio. Si el margen bruto de un producto es, por ejemplo, 35%, un ACOS de 40% ya significa
              que estás poniendo dinero para venderlo. Como todavía no tenemos el costo de compra cargado
              para todo el catálogo pautado, estas 4 franjas usan el ACOS como el mejor proxy disponible —
              la única franja que es pérdida segura <em>sin</em> conocer el margen es "ACOS &gt;100%".
            </Explicacion>
          </div>

          {/* ── Margen real (SKU MeLi ↔ costo de combo Siigo) ── */}
          <MargenRealSeccion dias={dias} />

          {/* ── Ads vs. Promociones ── */}
          <AdsVsPromocionesSeccion dias={dias} />

          {/* ── Recomendaciones (motor pausar/revisar por rotación o margen real) ── */}
          <RecomendacionesSeccion dias={dias} />

          {/* ── Plan de migración a 3 campañas ── */}
          <PlanMigracionSeccion dias={dias} campanasDisponibles={data.campanas} />

          {/* ── Propio vs. ajeno ── */}
          <div className="rounded-xl border-2 border-border bg-surface-panel p-4">
            <h3 className="text-sm font-bold text-ink mb-1">Catálogo propio vs. reventa de marcas de terceros</h3>
            <p className="text-xs text-ink-secondary mb-3 max-w-2xl leading-relaxed">
              McKenna también revende productos de otras marcas (básculas, herramientas, accesorios) que no
              son materia prima farmacéutica/cosmética propia. Compiten por el mismo presupuesto y el mismo
              objetivo de ACOS que el catálogo propio, aunque su margen y su lógica de negocio son distintos.
            </p>
            <div className="space-y-3">
              {(
                [
                  { label: "Catálogo propio", sub: `${data.marca.propia.count} anuncios`, g: data.marca.propia, colorClass: "bg-accent" },
                  { label: "Marca ajena", sub: `${data.marca.ajena.count} anuncios`, g: data.marca.ajena, colorClass: "bg-muted/60" },
                ] as const
              ).map((row) => {
                const maxAcos = Math.max(data.marca.propia.acos ?? 0, data.marca.ajena.acos ?? 0, 1);
                const width = ((row.g.acos ?? 0) / maxAcos) * 100;
                return (
                  <div key={row.label} className="grid grid-cols-[140px_1fr_70px] items-center gap-3">
                    <div>
                      <p className="text-xs font-bold text-ink">{row.label}</p>
                      <p className="text-[10px] text-muted">{row.sub}</p>
                    </div>
                    <div className="h-5 rounded-md border border-border bg-surface overflow-hidden">
                      <div className={`h-full ${row.colorClass}`} style={{ width: `${width}%` }} />
                    </div>
                    <p className="text-right text-sm font-bold font-mono text-ink">{pct(row.g.acos)}</p>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-[11px] text-muted">
              La reventa de marca ajena consumió <span className="font-mono font-semibold text-ink">{cop(data.marca.ajena.costo)}</span> (
              {pct((data.marca.ajena.costo / (data.totales.costo || 1)) * 100)} del presupuesto) con un ACOS{" "}
              {(data.marca.ajena.acos ?? 0) > (data.marca.propia.acos ?? 0) ? "peor" : "mejor"} que el catálogo propio.
            </p>
          </div>

          {/* ── Tabla: pérdida directa ── */}
          {data.perdida_directa_lista.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-ink mb-2">
                Productos que gastaron más de lo que vendieron ({data.perdida_directa_lista.length})
              </h3>
              <p className="text-xs text-ink-secondary mb-2 max-w-2xl leading-relaxed">
                Pérdida bruta directa sobre el ingreso — no depende del margen del producto, es dinero que
                salió y no volvió. Son los primeros candidatos a pausar desde el panel de Mercado Ads (hoy
                no es posible pausar un producto específico vía API — solo desde la web de MeLi, ver nota al
                final).
              </p>
              <TablaItems items={data.perdida_directa_lista} columnaExtra="perdida" />
            </div>
          )}

          {/* ── Tabla: top gastadores ── */}
          <div>
            <h3 className="text-sm font-bold text-ink mb-2">Los 20 productos que más presupuesto consumen</h3>
            <p className="text-xs text-ink-secondary mb-2 max-w-2xl leading-relaxed">
              Ordenados solo por gasto, sin importar si vendieron o no. Que un producto esté aquí arriba no
              es necesariamente malo — puede ser normal que el de mayor rotación también sea el que más
              presupuesto consume. Compara el gasto con la columna ACOS para juzgar cada caso.
            </p>
            <TablaItems items={data.top_gastadores} />
          </div>

          {/* ── Tabla: cero ventas ── */}
          {data.cero_ventas_lista.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-ink mb-2">
                Con clicks/impresiones pero cero ventas ({data.riesgo.cero_ventas.count} en total, top {data.cero_ventas_lista.length})
              </h3>
              <p className="text-xs text-ink-secondary mb-2 max-w-2xl leading-relaxed">
                Gente vio el anuncio y le dio clic, pero nadie compró en el período. No es necesariamente
                culpa de la publicidad: puede ser precio poco competitivo, ficha/foto floja, o simplemente
                baja demanda del producto en este momento.
              </p>
              <TablaItems items={data.cero_ventas_lista} />
            </div>
          )}

          {/* ── Marcas ajenas ── */}
          {data.ajena_lista.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-ink mb-2">Mayor gasto en reventa de marca ajena</h3>
              <p className="text-xs text-ink-secondary mb-2 max-w-2xl leading-relaxed">
                Productos cuya publicación en MeLi tiene una marca distinta a Mckenna Group / Mckg / marcas
                genéricas de insumos de laboratorio. Si el atributo Marca vino vacío en la publicación se
                cuenta como catálogo propio, para no penalizar productos con datos incompletos.
              </p>
              <TablaItems items={data.ajena_lista} columnaExtra="marca" />
            </div>
          )}

          {/* ── Metodología ── */}
          <div className="rounded-xl border border-border bg-surface-panel/60 p-4">
            <h3 className="text-xs font-bold text-ink mb-2 uppercase tracking-wide">Metodología y limitaciones</h3>
            <ul className="text-[11px] text-muted leading-relaxed list-disc pl-4 space-y-1">
              <li>
                Datos de <span className="font-mono">api.mercadolibre.com/marketplace/advertising</span>,
                cruzando la campaña con el detalle de cada anuncio pautado (deduplicado por producto).
              </li>
              <li>
                El ACOS mide gasto en ads sobre <strong>ingreso bruto</strong>, no sobre margen. No hay un
                costo de compra homogéneo cargado para todo el catálogo pautado en el sistema — por eso las
                cifras de "pérdida" en la barra de riesgo son pérdida bruta (ads vs. venta), no pérdida neta
                de negocio, salvo en la franja ACOS &gt;100% que es pérdida confirmada sin importar el margen.
              </li>
              <li>
                <strong>MeLi no expone control por producto vía API</strong> (confirmado ago-2026): se puede
                consultar el detalle por anuncio, pero pausar un producto puntual, fijarle un ACOS propio, o
                excluirlo de la campaña automática solo es posible manualmente desde el panel web de Mercado
                Ads — no hay endpoint público para hacerlo desde aquí.
              </li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
