import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export interface PromoItem {
  id?: string | null;
  type: string;
  status: string;
  name?: string | null;
  price?: number | null;
  original_price?: number | null;
  meli_percentage?: number | null;
  seller_percentage?: number | null;
  descuento_pct?: number | null;
  ref_id?: string | null;
  min_discounted_price?: number | null;
  max_discounted_price?: number | null;
  suggested_discounted_price?: number | null;
  precio_sugerido?: number | null;
  modo_optin?: "offer_id" | "deal_price" | string;
  start_date?: string | null;
  finish_date?: string | null;
  deadline_date?: string | null;
}

export interface PromoItemResp {
  meli_id: string;
  candidatas: PromoItem[];
  activas: PromoItem[];
  total_candidatas: number;
  total_activas: number;
  error?: string;
}

function cop(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `$${Math.round(Number(n)).toLocaleString("es-CO")}`;
}

function labelTipoPromo(tipo: string): string {
  const map: Record<string, string> = {
    SMART: "Smart",
    DEAL: "Deal",
    MARKETPLACE_CAMPAIGN: "Co-fondeada",
    PRICE_MATCHING: "Precio competitivo",
    LIGHTNING: "Relámpago",
    DOD: "Oferta del día",
    VOLUME: "Volumen",
    PRE_NEGOTIATED: "Pre-acordada",
    UNHEALTHY_STOCK: "Liquidación Full",
    SELLER_CAMPAIGN: "Campaña vendedor",
    PRICE_DISCOUNT: "Descuento individual",
  };
  return map[tipo] || tipo;
}

function formatFechaPromo(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function textoVigenciaPromo(p: PromoItem): string {
  if (p.type === "PRICE_DISCOUNT" && !p.start_date && !p.finish_date) {
    return "Tú defines las fechas (máx. 14 días)";
  }
  const ini = formatFechaPromo(p.start_date);
  const fin = formatFechaPromo(p.finish_date);
  if (ini && fin) return `${ini} → ${fin}`;
  if (fin) return `Hasta ${fin}`;
  if (ini) return `Desde ${ini}`;
  return "Sin fechas";
}

function pctDesdePrecios(original?: number | null, promo?: number | null): number | null {
  if (original == null || promo == null) return null;
  const o = Number(original);
  const pr = Number(promo);
  if (!(o > 0) || !(pr > 0) || pr >= o) return null;
  return Math.round((1 - pr / o) * 1000) / 10;
}

function textoDescuentoPromo(
  p: PromoItem,
  precioOverride?: number | null,
): string {
  const partes: string[] = [];
  const sugerido =
    precioOverride ??
    p.precio_sugerido ??
    (p.price && p.price > 0 ? p.price : null);
  const pct = pctDesdePrecios(p.original_price, sugerido) ?? p.descuento_pct;
  if (pct != null) partes.push(`−${pct}%`);
  if (p.meli_percentage != null || p.seller_percentage != null) {
    partes.push(`MeLi ${p.meli_percentage ?? 0}% / tú ${p.seller_percentage ?? 0}%`);
  }
  if (sugerido != null && p.original_price != null) {
    partes.push(`${cop(sugerido)} (lista ${cop(p.original_price)})`);
  } else if (sugerido != null) {
    partes.push(`sugerido ${cop(sugerido)}`);
  }
  return partes.join(" · ") || "Sin %";
}

function promoKey(p: PromoItem): string {
  return `${p.type}:${p.id || "nod"}:${p.ref_id || ""}`;
}

function fechasDefault(): { start: string; finish: string } {
  const hoy = new Date();
  return {
    start: hoy.toISOString().slice(0, 10),
    finish: new Date(hoy.getTime() + 13 * 86400000).toISOString().slice(0, 10),
  };
}

export default function MeliPromocionesItem({
  meliId,
  enabled = true,
  embedded = false,
}: {
  meliId: string;
  enabled?: boolean;
  /** Sin borde ni título duplicado (p. ej. dentro de un <details> del panel Competencia). */
  embedded?: boolean;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dealDraft, setDealDraft] = useState<Record<string, string>>({});
  const [promoFechas, setPromoFechas] = useState<
    Record<string, { start: string; finish: string }>
  >({});

  const q = useQuery<PromoItemResp>({
    queryKey: ["stock-promociones-item", meliId],
    queryFn: () =>
      api.get<PromoItemResp>(
        `/api/stock/promociones/item?meli_id=${encodeURIComponent(meliId)}`,
        { timeoutMs: 60_000 },
      ),
    enabled: enabled && Boolean(meliId),
    staleTime: 30_000,
  });

  const agregar = useMutation({
    mutationFn: async (p: PromoItem) => {
      const key = promoKey(p);
      const body: Record<string, unknown> = {
        meli_id: meliId,
        promotion_id: p.id || "",
        promotion_type: p.type,
      };
      if (p.modo_optin === "deal_price") {
        const raw =
          dealDraft[key] ??
          (p.precio_sugerido != null ? String(Math.round(Number(p.precio_sugerido))) : "");
        const precio = parseFloat(raw);
        if (!(precio > 0)) {
          throw new Error("Ingresá un precio promocional > 0");
        }
        body.deal_price = precio;
        if (p.type === "PRICE_DISCOUNT") {
          const fechas = promoFechas[key] ?? fechasDefault();
          if (!fechas.start || !fechas.finish) {
            throw new Error("Definí fecha inicio y fin (máx. 14 días)");
          }
          body.start_date = `${fechas.start}T00:00:00`;
          body.finish_date = `${fechas.finish}T23:59:59`;
        }
      } else if (p.ref_id) {
        body.offer_id = p.ref_id;
        if (p.start_date) body.start_date = p.start_date;
        if (p.finish_date) body.finish_date = p.finish_date;
      }
      return api.post("/api/stock/promociones/agregar", body, { timeoutMs: 60_000 });
    },
    onSuccess: (_d, p) => {
      setMsg({ ok: true, text: `Vinculada a «${p.name || labelTipoPromo(p.type)}»` });
      void qc.invalidateQueries({ queryKey: ["stock-promociones-item", meliId] });
    },
    onError: (e) => {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "No se pudo vincular" });
    },
  });

  const quitar = useMutation({
    mutationFn: async (p: PromoItem) => {
      if (!p.id) throw new Error("Falta el id de la promoción");
      return api.post(
        "/api/stock/promociones/quitar",
        {
          meli_id: meliId,
          promotion_id: p.id,
          promotion_type: p.type,
          offer_id: p.ref_id || undefined,
        },
        { timeoutMs: 60_000 },
      );
    },
    onSuccess: (_d, p) => {
      setMsg({ ok: true, text: `Quitada de «${p.name || p.id}»` });
      void qc.invalidateQueries({ queryKey: ["stock-promociones-item", meliId] });
    },
    onError: (e) => {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "No se pudo quitar" });
    },
  });

  async function onAgregar(p: PromoItem) {
    const key = promoKey(p);
    setBusy(key);
    setMsg(null);
    try {
      await agregar.mutateAsync(p);
    } finally {
      setBusy(null);
    }
  }

  async function onQuitar(p: PromoItem) {
    const key = promoKey(p);
    setBusy(key);
    setMsg(null);
    try {
      await quitar.mutateAsync(p);
    } finally {
      setBusy(null);
    }
  }

  const activas = q.data?.activas ?? [];
  const candidatas = q.data?.candidatas ?? [];

  return (
    <div className={embedded ? "" : "rounded-md border border-border bg-surface-panel px-2 py-1.5"}>
      <div className={`flex items-center justify-between gap-2 ${embedded ? "mb-1" : ""}`}>
        {embedded ? null : (
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted">
            Promociones ofertadas
          </p>
        )}
        <button
          type="button"
          disabled={q.isFetching}
          onClick={() => void q.refetch()}
          className={`text-[10px] font-semibold text-accent hover:underline disabled:opacity-40 ${embedded ? "ml-auto" : ""}`}
        >
          {q.isFetching ? "…" : "Actualizar"}
        </button>
      </div>
      {msg ? (
        <p className={`mt-1 text-[10px] font-semibold ${msg.ok ? "text-emerald-600" : "text-danger"}`}>
          {msg.text}
        </p>
      ) : null}
      {q.isLoading ? (
        <p className="mt-1 text-[11px] text-muted">Cargando campañas de MeLi…</p>
      ) : q.isError ? (
        <p className="mt-1 text-[11px] text-danger">
          {q.error instanceof Error ? q.error.message : "No se pudieron cargar promociones"}
        </p>
      ) : (
        <div className="mt-1 space-y-1.5">
          {activas.length > 0 ? (
            <ul className="space-y-1">
              {activas.map((p) => {
                const key = promoKey(p);
                return (
                  <li
                    key={`act-${key}`}
                    className="flex items-center justify-between gap-2 rounded-md border border-emerald-500/25 bg-emerald-500/5 px-2 py-1"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-bold text-ink">
                        {p.name || labelTipoPromo(p.type)}
                        <span className="ml-1 font-semibold text-emerald-700">activa</span>
                      </p>
                      {embedded ? null : (
                        <p className="truncate text-[10px] text-muted">
                          {textoDescuentoPromo(p)} · {textoVigenciaPromo(p)}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={busy === key}
                      onClick={() => void onQuitar(p)}
                      className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] font-bold text-muted hover:text-danger disabled:opacity-40"
                    >
                      {busy === key ? "…" : "Quitar"}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {candidatas.length > 0 ? (
            <ul className="max-h-44 space-y-1 overflow-y-auto">
              {candidatas.map((p) => {
                const key = promoKey(p);
                const needsDeal = p.modo_optin === "deal_price";
                const sugerido =
                  p.precio_sugerido != null ? Math.round(Number(p.precio_sugerido)) : null;
                const precioDraftRaw =
                  dealDraft[key] ?? (sugerido != null ? String(sugerido) : "");
                const precioDraftNum = parseFloat(precioDraftRaw);
                const fechas = promoFechas[key] ?? fechasDefault();
                return (
                  <li
                    key={`cand-${key}`}
                    className="rounded-md border border-border/80 bg-surface px-2 py-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-bold text-ink">
                          {p.name || labelTipoPromo(p.type)}
                        </p>
                        {embedded ? null : (
                          <>
                            <p className="truncate text-[10px] text-muted">
                              {labelTipoPromo(p.type)} ·{" "}
                              {textoDescuentoPromo(
                                p,
                                needsDeal && precioDraftNum > 0 ? precioDraftNum : null,
                              )}
                            </p>
                            <p className="truncate text-[10px] text-muted">
                              {p.type === "PRICE_DISCOUNT"
                                ? `${fechas.start} → ${fechas.finish}`
                                : textoVigenciaPromo(p)}
                            </p>
                          </>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={
                          busy === key ||
                          (needsDeal && !p.id && p.type !== "PRICE_DISCOUNT") ||
                          (!needsDeal && !p.ref_id && !p.id)
                        }
                        onClick={() => void onAgregar(p)}
                        className="shrink-0 rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-bold text-white disabled:opacity-40"
                      >
                        {busy === key ? "…" : "Vincular"}
                      </button>
                    </div>
                    {needsDeal ? (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <input
                          type="number"
                          min="0"
                          step="100"
                          disabled={busy === key}
                          value={precioDraftRaw}
                          onChange={(e) =>
                            setDealDraft((prev) => ({ ...prev, [key]: e.target.value }))
                          }
                          className="w-24 rounded border border-border bg-surface-panel px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-ink"
                          placeholder="Precio promo"
                        />
                        {p.min_discounted_price != null || p.max_discounted_price != null ? (
                          embedded ? null : (
                          <span className="text-[9px] text-muted">
                            {p.min_discounted_price != null
                              ? `min ${cop(p.min_discounted_price)}`
                              : ""}
                            {p.max_discounted_price != null
                              ? ` · max ${cop(p.max_discounted_price)}`
                              : ""}
                          </span>
                          )
                        ) : null}
                        {p.type === "PRICE_DISCOUNT" ? (
                          <>
                            <input
                              type="date"
                              disabled={busy === key}
                              value={fechas.start}
                              onChange={(e) =>
                                setPromoFechas((prev) => ({
                                  ...prev,
                                  [key]: { ...fechas, start: e.target.value },
                                }))
                              }
                              className="rounded border border-border bg-surface-panel px-1 py-0.5 text-[10px] text-ink"
                            />
                            <input
                              type="date"
                              disabled={busy === key}
                              value={fechas.finish}
                              onChange={(e) =>
                                setPromoFechas((prev) => ({
                                  ...prev,
                                  [key]: { ...fechas, finish: e.target.value },
                                }))
                              }
                              className="rounded border border-border bg-surface-panel px-1 py-0.5 text-[10px] text-ink"
                            />
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            !q.isLoading && (
              <p className="text-[11px] text-muted">
                {activas.length > 0
                  ? "No hay más campañas ofertadas para esta publicación."
                  : "MeLi no está ofreciendo campañas para esta publicación ahora."}
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
}
