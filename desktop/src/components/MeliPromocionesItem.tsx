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
  stock?: number | null;
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

function DetallePromo({
  p,
  precioDraft,
}: {
  p: PromoItem;
  precioDraft?: number | null;
}) {
  const deadline = formatFechaPromo(p.deadline_date);
  const minP = p.min_discounted_price;
  const maxP = p.max_discounted_price;
  const filas: { label: string; value: string }[] = [
    { label: "Tipo", value: labelTipoPromo(p.type) },
    { label: "Estado", value: p.status || "—" },
    { label: "Descuento", value: textoDescuentoPromo(p, precioDraft) },
    { label: "Vigencia", value: textoVigenciaPromo(p) },
  ];
  if (deadline) filas.push({ label: "Plazo de inscripción", value: deadline });
  if (minP != null || maxP != null) {
    filas.push({
      label: "Rango permitido",
      value:
        minP != null && maxP != null
          ? `${cop(minP)} – ${cop(maxP)}`
          : minP != null
            ? `mín. ${cop(minP)}`
            : `máx. ${cop(maxP)}`,
    });
  }
  if (p.stock != null && Number(p.stock) > 0) {
    filas.push({ label: "Stock reservado", value: String(p.stock) });
  }
  if (p.modo_optin) {
    filas.push({
      label: "Modo",
      value: p.modo_optin === "deal_price" ? "Definís el precio" : "Con offer_id de MeLi",
    });
  }
  if (p.id) filas.push({ label: "ID campaña", value: p.id });
  if (p.ref_id) filas.push({ label: "Offer ID", value: p.ref_id });

  return (
    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 border-t border-border/70 pt-1">
      {filas.map((f) => (
        <div key={f.label} className="contents">
          <dt className="text-[9px] font-bold uppercase tracking-wide text-muted">{f.label}</dt>
          <dd className="min-w-0 break-words text-[10px] font-semibold leading-snug text-ink">
            {f.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function FilaPromo({
  p,
  activa,
  open,
  onToggle,
  busy,
  onAccion,
  dealDraft,
  onDealChange,
  fechas,
  onFechasChange,
}: {
  p: PromoItem;
  activa: boolean;
  open: boolean;
  onToggle: () => void;
  busy: boolean;
  onAccion: () => void;
  dealDraft?: string;
  onDealChange?: (v: string) => void;
  fechas?: { start: string; finish: string };
  onFechasChange?: (f: { start: string; finish: string }) => void;
}) {
  const needsDeal = !activa && p.modo_optin === "deal_price";
  const sugerido =
    p.precio_sugerido != null ? Math.round(Number(p.precio_sugerido)) : null;
  const precioDraftRaw =
    dealDraft ?? (sugerido != null ? String(sugerido) : "");
  const precioNum = parseFloat(precioDraftRaw);
  const fechasVal = fechas ?? fechasDefault();

  return (
    <li
      className={`rounded border px-1.5 py-0.5 ${
        activa
          ? "border-emerald-500/25 bg-emerald-500/5"
          : "border-border/80 bg-surface"
      }`}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onToggle}
          className="mck-btn-no-fx flex min-w-0 flex-1 items-center gap-1 py-0.5 text-left"
          aria-expanded={open}
        >
          <span
            className={`shrink-0 text-[9px] text-muted transition-transform ${open ? "rotate-90" : ""}`}
            aria-hidden
          >
            ▸
          </span>
          <span className="min-w-0 flex-1 truncate text-[10px] font-bold leading-tight text-ink">
            {p.name || labelTipoPromo(p.type)}
          </span>
          {activa ? (
            <span className="shrink-0 text-[9px] font-bold text-emerald-700">activa</span>
          ) : (
            <span className="shrink-0 truncate text-[9px] font-semibold text-muted">
              {labelTipoPromo(p.type)}
            </span>
          )}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAccion();
          }}
          className={`mck-btn-no-fx relative z-10 h-[1.2rem] shrink-0 rounded px-1.5 text-[10px] font-bold leading-none disabled:opacity-40 ${
            activa
              ? "border border-border text-muted hover:text-danger"
              : "bg-accent text-white"
          }`}
        >
          {busy ? "…" : activa ? "Quitar" : "Vincular"}
        </button>
      </div>

      {open ? (
        <div className="pb-1 pl-3">
          <DetallePromo
            p={p}
            precioDraft={
              needsDeal && Number.isFinite(precioNum) && precioNum > 0
                ? precioNum
                : null
            }
          />
          {needsDeal ? (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <label className="text-[9px] font-bold uppercase text-muted">
                Precio promo
                <input
                  type="number"
                  min="0"
                  step="100"
                  disabled={busy}
                  value={precioDraftRaw}
                  onChange={(e) => onDealChange?.(e.target.value)}
                  className="ml-1 w-[4.5rem] rounded border border-border bg-surface-panel px-1 text-[10px] font-bold tabular-nums text-ink"
                  title="Precio promo"
                />
              </label>
              {p.type === "PRICE_DISCOUNT" ? (
                <>
                  <input
                    type="date"
                    disabled={busy}
                    value={fechasVal.start}
                    onChange={(e) =>
                      onFechasChange?.({ ...fechasVal, start: e.target.value })
                    }
                    className="w-[7.2rem] rounded border border-border bg-surface-panel px-0.5 text-[10px] text-ink"
                  />
                  <input
                    type="date"
                    disabled={busy}
                    value={fechasVal.finish}
                    onChange={(e) =>
                      onFechasChange?.({ ...fechasVal, finish: e.target.value })
                    }
                    className="w-[7.2rem] rounded border border-border bg-surface-panel px-0.5 text-[10px] text-ink"
                  />
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
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
  const [abierta, setAbierta] = useState<string | null>(null);

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
      if (p.ref_id) body.offer_id = p.ref_id;
      if (p.stock != null && Number(p.stock) > 0) body.stock = Number(p.stock);
      if (p.type === "SMART") {
        if (p.start_date) body.start_date = p.start_date;
        if (p.finish_date) body.finish_date = p.finish_date;
      }
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
    if (p.modo_optin === "deal_price" && abierta !== key) {
      setAbierta(key);
      setMsg({
        ok: false,
        text: "Abrí el detalle, completá el precio (y fechas si aplica) y volvé a Vincular",
      });
      return;
    }
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

  function toggle(key: string) {
    setAbierta((prev) => (prev === key ? null : key));
  }

  const activas = q.data?.activas ?? [];
  const candidatas = q.data?.candidatas ?? [];

  return (
    <div className={embedded ? "" : "rounded-md border border-border bg-surface-panel px-2 py-1.5"}>
      <div className="flex items-center justify-between gap-1">
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
        <p
          className={`mt-0.5 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
            msg.ok
              ? "border-emerald-300 bg-emerald-50 text-emerald-800"
              : "border-red-300 bg-red-50 text-danger"
          }`}
        >
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
        <div className="mt-0.5 space-y-0.5">
          {activas.length > 0 ? (
            <ul className="space-y-px">
              {activas.map((p) => {
                const key = promoKey(p);
                return (
                  <FilaPromo
                    key={`act-${key}`}
                    p={p}
                    activa
                    open={abierta === key}
                    onToggle={() => toggle(key)}
                    busy={busy === key}
                    onAccion={() => void onQuitar(p)}
                  />
                );
              })}
            </ul>
          ) : null}

          {candidatas.length > 0 ? (
            <ul className="max-h-72 space-y-px overflow-y-auto">
              {candidatas.map((p) => {
                const key = promoKey(p);
                const fechas = promoFechas[key] ?? fechasDefault();
                return (
                  <FilaPromo
                    key={`cand-${key}`}
                    p={p}
                    activa={false}
                    open={abierta === key}
                    onToggle={() => toggle(key)}
                    busy={busy === key}
                    onAccion={() => void onAgregar(p)}
                    dealDraft={dealDraft[key]}
                    onDealChange={(v) =>
                      setDealDraft((prev) => ({ ...prev, [key]: v }))
                    }
                    fechas={fechas}
                    onFechasChange={(f) =>
                      setPromoFechas((prev) => ({ ...prev, [key]: f }))
                    }
                  />
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
