import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import PanelHelp from "./PanelHelp";

interface StockItem {
  meli_id: string;
  sku: string;
  nombre: string;
  stock: number;
  fila?: number | null;
  estado_meli?: string;
  es_full?: boolean;
  sync_bloqueado?: boolean;
  permalink?: string;
}

interface StockResumen {
  items: StockItem[];
  total: number;
}

interface CanalResultado {
  ok?: boolean;
  mensaje: string;
  stock?: number | null;
  numerico?: boolean;
  no_aplica?: boolean;
}

interface SincronizarResultado {
  sku: string;
  stock_objetivo: number;
  stock_anterior?: number;
  delta?: number;
  meli: CanalResultado;
  web: CanalResultado;
  siigo: CanalResultado;
}

function estadoDe(stock: number): { label: string; className: string } {
  if (stock <= 0) return { label: "Agotado", className: "bg-danger/15 text-danger" };
  if (stock === 1) return { label: "Última unidad", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" };
  return { label: "OK", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" };
}

const ESTADO_MELI_LABELS: Record<string, string> = {
  active: "Activo",
  paused: "Pausado",
  closed: "Cerrado",
  inactive: "Inactivo",
  under_review: "En revisión",
};

function CanalResultBox({ resultado }: { resultado: SincronizarResultado }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3 border-t border-border pt-3">
      {typeof resultado.stock_anterior === "number" && (
        <div className="sm:col-span-3 text-[11px] text-muted -mb-1">
          {resultado.stock_anterior} → <span className="font-bold text-ink">{resultado.stock_objetivo}</span> uds
          {typeof resultado.delta === "number" && (
            <span> ({resultado.delta >= 0 ? "+" : ""}{resultado.delta})</span>
          )}
        </div>
      )}
      <div className="rounded-lg bg-surface px-3 py-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted">
          {resultado.meli.ok ? "✅" : resultado.meli.no_aplica ? "ℹ️" : "❌"} MeLi
        </p>
        <p className="mt-0.5 text-[11px] text-ink-muted leading-snug">{resultado.meli.mensaje}</p>
      </div>
      <div className="rounded-lg bg-surface px-3 py-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted">
          {resultado.web.ok ? (resultado.web.numerico ? "✅" : "⚠️") : "❌"} Página web
        </p>
        <p className="mt-0.5 text-[11px] text-ink-muted leading-snug">{resultado.web.mensaje}</p>
      </div>
      <div className="rounded-lg bg-surface px-3 py-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted">
          ℹ️ Siigo{resultado.siigo.stock != null ? `: ${resultado.siigo.stock} uds` : ""}
        </p>
        <p className="mt-0.5 text-[11px] text-ink-muted leading-snug">{resultado.siigo.mensaje}</p>
      </div>
    </div>
  );
}

function StockRow({
  item,
  isBusy,
  resultado,
  onAjustar,
  onSincronizar,
}: {
  item: StockItem;
  isBusy: boolean;
  resultado?: SincronizarResultado;
  onAjustar: (delta: number) => void;
  onSincronizar: () => void;
}) {
  const [cantidad, setCantidad] = useState("");
  const estado = estadoDe(item.stock);
  const cantidadNum = Math.max(0, parseInt(cantidad, 10) || 0);

  const aplicar = (signo: 1 | -1) => {
    if (!cantidadNum) return;
    onAjustar(signo * cantidadNum);
    setCantidad("");
  };

  return (
    <div className="rounded-xl border border-border bg-surface-panel p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink truncate">{item.nombre}</p>
          <p className="text-xs text-muted">
            SKU: {item.sku || "—"} · MeLi: {item.meli_id}
          </p>
        </div>
        {item.sync_bloqueado && (
          <>
            <span
              className="shrink-0 rounded-full bg-muted/20 px-2.5 py-1 text-xs font-semibold text-muted"
              title="MeLi puede rechazar el cambio de stock mientras la publicación no esté activa — igual puedes intentarlo, y el push a la web funciona sin depender de esto"
            >
              {ESTADO_MELI_LABELS[item.estado_meli ?? ""] ?? item.estado_meli ?? "No activa"} en MeLi
            </span>
            {item.permalink && (
              <a
                href={item.permalink}
                target="_blank"
                rel="noopener noreferrer"
                title="Reactivar la publicación en MeLi (se abre en una pestaña nueva)"
                className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-accent transition hover:border-accent/50"
              >
                Abrir en MeLi ↗
              </a>
            )}
          </>
        )}
        {!item.sync_bloqueado && item.es_full && (
          <span
            className="shrink-0 rounded-full bg-muted/20 px-2.5 py-1 text-xs font-semibold text-muted"
            title="Mercado Envíos Full: MeLi administra este stock según el inventario físico enviado a su bodega. Solo se puede sincronizar hacia la web, no escribir en MeLi."
          >
            Full (MeLi)
          </span>
        )}
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${estado.className}`}>
          {estado.label}
        </span>
        <span className="shrink-0 w-14 text-right text-sm font-bold text-ink tabular-nums">
          {item.stock} uds
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={0}
          inputMode="numeric"
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
          placeholder="Cantidad"
          disabled={!item.sku || isBusy}
          className="w-24 rounded-lg border border-border bg-surface-input px-2.5 py-1.5 text-xs text-ink outline-none placeholder:text-muted/50 focus:border-accent disabled:opacity-40"
        />
        <button
          onClick={() => aplicar(1)}
          disabled={!item.sku || isBusy || !cantidadNum}
          className="rounded-lg bg-emerald-600/15 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 transition hover:bg-emerald-600/25 disabled:opacity-40"
        >
          + Entrada
        </button>
        <button
          onClick={() => aplicar(-1)}
          disabled={!item.sku || isBusy || !cantidadNum}
          className="rounded-lg bg-danger/15 px-3 py-1.5 text-xs font-semibold text-danger transition hover:bg-danger/25 disabled:opacity-40"
        >
          − Salida
        </button>
        <span className="text-muted/50 px-1">|</span>
        <button
          onClick={onSincronizar}
          disabled={!item.sku || isBusy}
          title="Vuelve a mandar el stock actual de MeLi a los canales, sin sumar ni restar unidades — útil si la web o MeLi quedaron desactualizados"
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink-muted transition hover:border-accent/50 hover:text-accent disabled:opacity-40"
        >
          {isBusy ? "..." : "Actualizar stock"}
        </button>
      </div>

      {resultado && <CanalResultBox resultado={resultado} />}
    </div>
  );
}

type StockView = "inventario" | "codigos";

type FiltroRelacion =
  | "todos"
  | "vinculados"
  | "sin_siigo"
  | "divergentes"
  | "sin_codigo"
  | "sin_c";

interface RelacionItem {
  meli_id: string;
  titulo: string;
  sku_meli: string;
  codigo_siigo: string;
  nombre_siigo: string;
  en_siigo: boolean;
  sku_coincide: boolean;
  estado: string;
  permalink?: string;
  tiene_override?: boolean;
}

interface RelacionResp {
  items: RelacionItem[];
  totales: {
    total: number;
    vinculados: number;
    sin_siigo: number;
    divergentes: number;
    sin_codigo: number;
    sin_c: number;
    filtrados: number;
  };
  actualizado_en?: string | null;
  fuente?: string;
  error?: string | null;
}

const ESTADO_RELACION: Record<string, { label: string; className: string }> = {
  vinculado: {
    label: "Vinculado",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  sin_siigo: {
    label: "Sin Siigo",
    className: "bg-danger/15 text-danger",
  },
  sku_divergente: {
    label: "SKU distinto",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  sin_codigo: {
    label: "Sin código",
    className: "bg-muted/20 text-muted",
  },
};

function RelacionCodigosTab() {
  const [buscar, setBuscar] = useState("");
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<FiltroRelacion>("todos");
  const [editMeli, setEditMeli] = useState<string | null>(null);
  const [skuDraft, setSkuDraft] = useState("");
  const [codigoDraft, setCodigoDraft] = useState("");
  const forceRefreshRef = useRef(false);

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery<RelacionResp>({
    queryKey: ["relacion-codigos", q, filtro],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (q) params.set("buscar", q);
      if (filtro !== "todos") params.set("filtro", filtro);
      if (forceRefreshRef.current) {
        params.set("refresh", "1");
        forceRefreshRef.current = false;
      }
      const qs = params.toString();
      return api.get<RelacionResp>(`/api/stock/relacion-codigos${qs ? `?${qs}` : ""}`, {
        timeoutMs: 180_000,
      });
    },
    staleTime: 60_000,
  });

  const editarMut = useMutation({
    mutationFn: ({
      meli_id,
      sku_meli,
      codigo_siigo,
    }: {
      meli_id: string;
      sku_meli: string;
      codigo_siigo: string;
    }) =>
      api.post("/api/stock/relacion-codigos/editar", {
        meli_id,
        sku_meli,
        codigo_siigo,
        vincular_si_sku: true,
      }),
    onSuccess: () => {
      setEditMeli(null);
      setSkuDraft("");
      setCodigoDraft("");
      forceRefreshRef.current = true;
      void refetch();
    },
  });

  const totales = data?.totales;
  const items = data?.items ?? [];
  const puedeGuardar = Boolean(skuDraft.trim() || codigoDraft.trim());

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Cruza el ID de Mercado Libre (MCO…) y el SKU de la publicación con el código de producto en
        Siigo. Con <span className="font-semibold text-ink">Editar</span> puedes cambiar el SKU en
        MeLi (queda escrito en la publicación) y el código Siigo (vínculo local). Usa el filtro{" "}
        <span className="font-semibold text-ink">Sin C-</span> para ver candidatos a combo.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            forceRefreshRef.current = true;
            void refetch();
          }}
          disabled={isFetching}
          className="rounded-lg border border-border bg-surface-panel px-3 py-2 text-xs font-semibold text-ink transition hover:border-accent/50 disabled:opacity-40"
        >
          {isFetching ? "Actualizando..." : "🔄 Recalcular desde MeLi + Siigo"}
        </button>
        {data?.actualizado_en && (
          <span className="text-[11px] text-muted">
            Actualizado: {data.actualizado_en}
            {data.fuente === "cache" ? " (caché)" : ""}
          </span>
        )}
      </div>

      {totales && (
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["todos", `Todos (${totales.total})`],
              ["sin_c", `Sin C- (${totales.sin_c ?? 0})`],
              ["vinculados", `Vinculados (${totales.vinculados})`],
              ["sin_siigo", `Sin Siigo (${totales.sin_siigo})`],
              ["divergentes", `SKU distinto (${totales.divergentes})`],
              ["sin_codigo", `Sin código (${totales.sin_codigo})`],
            ] as [FiltroRelacion, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFiltro(id)}
              title={
                id === "sin_c"
                  ? "Publicaciones cuyo SKU MeLi / código Siigo no empieza por C- (para registrar combo en Siigo)"
                  : undefined
              }
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                filtro === id
                  ? "bg-accent text-white"
                  : "border border-border bg-surface-panel text-ink-muted hover:border-accent/40"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {filtro === "sin_c" && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          Estos productos no tienen código con prefijo <span className="font-mono font-bold">C-</span>.
          Edita el SKU a un código <span className="font-mono">C-…</span>, guárdalo en MeLi y luego
          registra el combo en Siigo / catálogo.
        </p>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(buscar.trim());
        }}
      >
        <input
          type="text"
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          placeholder="Buscar por MCO, SKU MeLi, código Siigo o nombre..."
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted/50 focus:border-accent"
        />
        <button
          type="submit"
          className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white transition hover:bg-accent-hover"
        >
          Buscar
        </button>
      </form>

      {data?.error && (
        <p className="text-xs text-amber-600 dark:text-amber-400">Aviso: {data.error}</p>
      )}
      {isLoading && <p className="text-sm text-muted">Cargando cruce MeLi ↔ Siigo (puede tardar)...</p>}
      {isError && (
        <p className="text-sm text-danger">
          {error instanceof Error ? error.message : "No se pudo cargar la relación de códigos"}
        </p>
      )}
      {editarMut.isError && (
        <p className="text-xs text-danger">{editarMut.error.message}</p>
      )}
      {editarMut.isSuccess && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">
          Cambios guardados (SKU MeLi y/o vínculo Siigo).
        </p>
      )}

      {!isLoading && !isError && items.length === 0 && (
        <p className="text-sm text-muted">No hay filas para este filtro.</p>
      )}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-surface text-[10px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2 font-bold">MeLi</th>
              <th className="px-3 py-2 font-bold">SKU MeLi</th>
              <th className="px-3 py-2 font-bold">Código Siigo</th>
              <th className="px-3 py-2 font-bold">Estado</th>
              <th className="px-3 py-2 font-bold">Acción</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const est = ESTADO_RELACION[it.estado] ?? ESTADO_RELACION.sin_codigo;
              const editing = editMeli === it.meli_id;
              return (
                <tr key={it.meli_id} className="border-t border-border/70 align-top">
                  <td className="px-3 py-2">
                    <p className="font-medium text-ink line-clamp-2">{it.titulo || "—"}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-muted">{it.meli_id}</p>
                    {it.permalink && (
                      <a
                        href={it.permalink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-0.5 inline-block text-[11px] font-semibold text-accent"
                      >
                        Abrir ↗
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {editing ? (
                      <input
                        autoFocus
                        value={skuDraft}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSkuDraft(v);
                          // Si el código Siigo seguía igual al SKU viejo, alinear al nuevo
                          if (
                            !codigoDraft.trim() ||
                            codigoDraft.trim() === (it.sku_meli || it.codigo_siigo || "").trim()
                          ) {
                            setCodigoDraft(v);
                          }
                        }}
                        placeholder="C-… SKU MeLi"
                        className="w-full min-w-[8rem] rounded border border-border bg-surface-input px-2 py-1 font-mono text-ink outline-none focus:border-accent"
                      />
                    ) : (
                      <p className="font-mono text-ink">{it.sku_meli || "—"}</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {editing ? (
                      <input
                        value={codigoDraft}
                        onChange={(e) => setCodigoDraft(e.target.value)}
                        placeholder="Código Siigo"
                        className="w-full min-w-[8rem] rounded border border-border bg-surface-input px-2 py-1 font-mono text-ink outline-none focus:border-accent"
                      />
                    ) : (
                      <>
                        <p className="font-mono text-ink">{it.codigo_siigo || "—"}</p>
                        {it.nombre_siigo && (
                          <p className="mt-0.5 text-[11px] text-muted line-clamp-2">{it.nombre_siigo}</p>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${est.className}`}>
                      {est.label}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {editing ? (
                      <div className="flex flex-wrap gap-1">
                        <button
                          disabled={!puedeGuardar || editarMut.isPending}
                          onClick={() =>
                            editarMut.mutate({
                              meli_id: it.meli_id,
                              sku_meli: skuDraft.trim(),
                              codigo_siigo: codigoDraft.trim(),
                            })
                          }
                          className="rounded bg-accent px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
                        >
                          {editarMut.isPending ? "Guardando…" : "Guardar"}
                        </button>
                        <button
                          onClick={() => {
                            setEditMeli(null);
                            setSkuDraft("");
                            setCodigoDraft("");
                          }}
                          className="rounded border border-border px-2 py-1 text-[11px] font-semibold text-muted"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setEditMeli(it.meli_id);
                          const initial = it.sku_meli || it.codigo_siigo || "";
                          setSkuDraft(it.sku_meli || "");
                          setCodigoDraft(it.codigo_siigo || initial);
                        }}
                        className="rounded border border-border px-2 py-1 text-[11px] font-semibold text-ink-muted transition hover:border-accent/50 hover:text-accent"
                      >
                        Editar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function StockPanel() {
  const [view, setView] = useState<StockView>("inventario");
  const [search, setSearch] = useState("");
  const [busySku, setBusySku] = useState<string | null>(null);
  const [rowResult, setRowResult] = useState<Record<string, SincronizarResultado>>({});
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery<StockResumen>({
    queryKey: ["stock-resumen"],
    queryFn: () => api.get<StockResumen>("/api/stock/resumen"),
    staleTime: 60_000,
    enabled: view === "inventario",
  });

  const items = useMemo(() => {
    const list = data?.items ?? [];
    const q = search.trim().toLowerCase();
    const filtered = q
      ? list.filter((i) => i.nombre.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q))
      : list;
    return [...filtered].sort((a, b) => a.stock - b.stock);
  }, [data, search]);

  const counts = useMemo(() => {
    const list = data?.items ?? [];
    return {
      agotados: list.filter((i) => i.stock <= 0).length,
      criticos: list.filter((i) => i.stock === 1).length,
      bloqueados: list.filter((i) => i.sync_bloqueado).length,
    };
  }, [data]);

  const errorResultado = (sku: string, message: string): SincronizarResultado => ({
    sku,
    stock_objetivo: 0,
    meli: { ok: false, mensaje: `Error: ${message}` },
    web: { ok: false, mensaje: "—" },
    siigo: { stock: null, mensaje: "—" },
  });

  const ajustarMut = useMutation({
    mutationFn: ({ sku, meli_id, delta }: { sku: string; meli_id: string; delta: number }) =>
      api.post<SincronizarResultado>("/api/stock/ajustar", { sku, meli_id, delta }),
    onMutate: ({ sku }) => setBusySku(sku),
    onSuccess: (res, { sku }) => {
      setRowResult((prev) => ({ ...prev, [sku]: res }));
      queryClient.invalidateQueries({ queryKey: ["stock-resumen"] });
    },
    onError: (err, { sku }) => setRowResult((prev) => ({ ...prev, [sku]: errorResultado(sku, err.message) })),
    onSettled: () => setBusySku(null),
  });

  const sincronizarUnoMut = useMutation({
    mutationFn: ({ sku, stock, meli_id }: { sku: string; stock: number; meli_id: string }) =>
      api.post<SincronizarResultado>("/api/stock/sincronizar", { sku, stock, meli_id }),
    onMutate: ({ sku }) => setBusySku(sku),
    onSuccess: (res, { sku }) => setRowResult((prev) => ({ ...prev, [sku]: res })),
    onError: (err, { sku }) => setRowResult((prev) => ({ ...prev, [sku]: errorResultado(sku, err.message) })),
    onSettled: () => setBusySku(null),
  });

  const sincronizarTodoMut = useMutation({
    mutationFn: () => api.post("/api/stock/sincronizar-todo"),
  });

  const reporteMut = useMutation({
    mutationFn: () => api.post<{ mensaje?: string }>("/api/sync/stock"),
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PanelHelp panelId="stock" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-extrabold text-ink">📦 Stock e Inventario</h2>
        {view === "inventario" && (
          <div className="flex gap-2">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="rounded-lg border border-border bg-surface-panel px-3 py-2 text-xs font-semibold text-ink transition hover:border-accent/50 disabled:opacity-40"
            >
              {isFetching ? "Actualizando..." : "🔄 Actualizar desde MeLi"}
            </button>
            <button
              onClick={() => sincronizarTodoMut.mutate()}
              disabled={sincronizarTodoMut.isPending || !items.length}
              className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white transition hover:bg-accent-hover disabled:opacity-40"
            >
              {sincronizarTodoMut.isPending ? "Sincronizando..." : "⇄ Reenviar todo a los canales"}
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-1 rounded-xl border border-border bg-surface p-1">
        <button
          onClick={() => setView("inventario")}
          className={`flex-1 rounded-lg py-2 text-xs font-bold transition ${
            view === "inventario" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
          }`}
        >
          Inventario
        </button>
        <button
          onClick={() => setView("codigos")}
          className={`flex-1 rounded-lg py-2 text-xs font-bold transition ${
            view === "codigos" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
          }`}
        >
          Códigos MeLi ↔ Siigo
        </button>
      </div>

      {view === "codigos" ? (
        <RelacionCodigosTab />
      ) : (
        <>
          <p className="text-xs text-muted -mt-1">
            Este panel es el punto único de entrada de inventario: registra aquí las entradas y salidas
            de unidades y se propagan a MeLi y a la página web (además, todos los días se reenvía solo
            a la web para que nunca quede un producto nuevo sin control de stock). Siigo se muestra solo
            de referencia — su API no permite escribirle stock, así que ahí se sigue ajustando aparte.
            Si un producto aparece &quot;pausado en MeLi&quot; igual puedes registrar la entrada — se actualiza la
            web de una vez; MeLi normalmente exige reactivar la publicación allá para aceptar el stock
            nuevo, así que usa &quot;Abrir en MeLi&quot; si hace falta reactivarla.
          </p>

          {sincronizarTodoMut.isSuccess && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              Sincronización masiva iniciada en segundo plano. Revisa Sincronización → Actividad para
              ver el detalle.
            </p>
          )}
          {sincronizarTodoMut.isError && (
            <p className="text-xs text-danger">{sincronizarTodoMut.error.message}</p>
          )}

          {!!data?.total && (
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-border bg-surface-panel px-3 py-1 text-xs text-ink-muted">
                {data.total} productos con MeLi vinculado
              </span>
              {counts.agotados > 0 && (
                <span className="rounded-full bg-danger/15 px-3 py-1 text-xs font-semibold text-danger">
                  {counts.agotados} agotados
                </span>
              )}
              {counts.criticos > 0 && (
                <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
                  {counts.criticos} en última unidad
                </span>
              )}
              {counts.bloqueados > 0 && (
                <span
                  className="rounded-full bg-muted/20 px-3 py-1 text-xs font-semibold text-muted"
                  title="Publicaciones pausadas, cerradas o en revisión en MeLi: no se les puede sincronizar el stock hasta reactivarlas allá"
                >
                  {counts.bloqueados} sin publicación activa en MeLi
                </span>
              )}
            </div>
          )}

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrar por nombre o SKU..."
            className="w-full rounded-lg border border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted/50 focus:border-accent"
          />

          {isLoading && <p className="text-sm text-muted">Cargando stock desde MeLi...</p>}
          {isError && (
            <p className="text-sm text-danger">
              No se pudo cargar el stock: {error instanceof Error ? error.message : "error desconocido"}
            </p>
          )}

          {!isLoading && !isError && items.length === 0 && (
            <p className="text-sm text-muted">No hay productos que coincidan.</p>
          )}

          <div className="space-y-2">
            {items.map((it) => (
              <StockRow
                key={it.meli_id}
                item={it}
                isBusy={busySku === it.sku}
                resultado={rowResult[it.sku]}
                onAjustar={(delta) => {
                  setRowResult((prev) => {
                    const next = { ...prev };
                    delete next[it.sku];
                    return next;
                  });
                  ajustarMut.mutate({ sku: it.sku, meli_id: it.meli_id, delta });
                }}
                onSincronizar={() => {
                  setRowResult((prev) => {
                    const next = { ...prev };
                    delete next[it.sku];
                    return next;
                  });
                  sincronizarUnoMut.mutate({ sku: it.sku, stock: it.stock, meli_id: it.meli_id });
                }}
              />
            ))}
          </div>

          <section className="rounded-xl border border-border bg-surface-panel p-5">
            <p className="text-sm font-medium text-ink">Reporte de Stock por WhatsApp</p>
            <p className="mt-1 text-xs text-muted">
              {reporteMut.isPending
                ? "Generando..."
                : reporteMut.isSuccess
                  ? "Reporte enviado al grupo de Inventario"
                  : "Envía el resumen de agotados y últimas unidades al grupo de Inventario"}
            </p>
            {reporteMut.isError && <p className="mt-1 text-xs text-danger">{reporteMut.error.message}</p>}
            <button
              onClick={() => {
                reporteMut.mutate();
                queryClient.invalidateQueries({ queryKey: ["stock-resumen"] });
              }}
              disabled={reporteMut.isPending}
              className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-accent/50 disabled:opacity-40"
            >
              Generar reporte
            </button>
          </section>
        </>
      )}
    </div>
  );
}
