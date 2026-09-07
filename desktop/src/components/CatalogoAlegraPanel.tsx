import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { nombreMayusculasAlegra } from "../lib/alegraNombreProducto";

interface CatalogoItem {
  id: string;
  reference: string;
  name: string;
  type: "product" | "kit" | string;
  status: string;
  unit: string;
  unit_cost: number;
  precio_lista: number;
  iva: number;
  synced_at?: string;
}

interface Componente {
  codigo: string;
  nombre: string;
  cantidad: number;
}

interface SyncEstado {
  running?: boolean;
  started_at?: string | null;
  finished_at?: string | null;
  ok?: boolean | null;
  error?: string | null;
  productos?: number;
  kits?: number;
  total?: number;
  mensaje?: string;
}

interface CatalogoResponse {
  items: CatalogoItem[];
  total: number;
  synced_at?: string | null;
  stale?: boolean;
  sync?: SyncEstado;
  limit?: number;
  offset?: number;
  conteos?: { product?: number; kit?: number };
}

type ClaseCatalogo = "product" | "kit";

function cop(n: number) {
  if (!n && n !== 0) return "—";
  return `$ ${Number(n).toLocaleString("es-CO", {
    maximumFractionDigits: 0,
  })}`;
}

function fmtTs(ts?: string | null) {
  if (!ts) return "Nunca";
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleString("es-CO", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return ts;
  }
}

function EditarModal({
  item,
  busy,
  error,
  onClose,
  onSave,
}: {
  item: CatalogoItem;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (nombre: string, precio: number) => void;
}) {
  const [nombre, setNombre] = useState(item.name);
  const [precio, setPrecio] = useState(String(Math.round(item.precio_lista || 0)));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="editar-catalogo-titulo"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-surface p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="editar-catalogo-titulo" className="text-base font-semibold text-ink">
          Editar {item.type === "kit" ? "combo" : "producto"}
        </h3>
        <p className="mt-1 font-mono text-xs text-accent">{item.reference}</p>

        <label className="mt-4 block text-xs font-semibold text-muted">Nombre</label>
        <input
          type="text"
          value={nombre}
          onChange={(e) =>
            setNombre(nombreMayusculasAlegra(e.target.value, 150, { trimSpaces: false }))
          }
          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          disabled={busy}
        />

        <label className="mt-3 block text-xs font-semibold text-muted">Precio lista (COP)</label>
        <input
          type="number"
          min={0}
          step={100}
          value={precio}
          onChange={(e) => setPrecio(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          disabled={busy}
        />

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-muted hover:bg-surface-hover disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || !nombre.trim()}
            onClick={() => {
              const p = Number(precio);
              if (Number.isNaN(p) || p < 0) return;
              onSave(nombreMayusculasAlegra(nombre, 150), Math.round(p));
            }}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FilaItem({
  item,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  componentes,
  loadingDetalle,
  busyRef,
}: {
  item: CatalogoItem;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  componentes?: Componente[];
  loadingDetalle?: boolean;
  busyRef: string | null;
}) {
  const esKit = item.type === "kit";
  const busy = busyRef === item.reference;
  return (
    <>
      <tr className={`transition-colors ${expanded ? "bg-accent/8" : "hover:bg-surface-hover"}`}>
        <td
          className={`px-3 py-2.5 font-mono text-xs text-accent whitespace-nowrap ${
            esKit ? "cursor-pointer" : ""
          }`}
          onClick={esKit ? onToggle : undefined}
        >
          {item.reference}
        </td>
        <td
          className={`px-3 py-2.5 text-sm font-semibold text-ink max-w-[280px] ${
            esKit ? "cursor-pointer" : ""
          }`}
          onClick={esKit ? onToggle : undefined}
        >
          <span className="block truncate" title={item.name}>
            {item.name}
          </span>
        </td>
        <td className="px-3 py-2.5 text-sm font-bold text-ink text-right whitespace-nowrap">
          {cop(item.precio_lista)}
        </td>
        <td className="px-3 py-2.5 text-xs text-muted text-right font-mono whitespace-nowrap">
          {item.unit_cost > 0 ? cop(item.unit_cost) : "—"}
        </td>
        <td className="px-3 py-2.5 text-xs text-muted text-center">
          {esKit ? (expanded ? "▾" : "▸") : "—"}
        </td>
        <td className="px-3 py-2.5 whitespace-nowrap">
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              disabled={busy}
              onClick={onEdit}
              className="rounded px-2 py-1 text-xs font-semibold text-accent hover:bg-accent/10 disabled:opacity-50"
            >
              Editar
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onDelete}
              className="rounded px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-500/10 disabled:opacity-50"
            >
              {busy ? "…" : "Eliminar"}
            </button>
          </div>
        </td>
      </tr>
      {expanded && esKit ? (
        <tr className="bg-surface-hover/40">
          <td colSpan={6} className="px-4 py-3">
            {loadingDetalle ? (
              <p className="text-xs text-muted">Cargando receta…</p>
            ) : !componentes?.length ? (
              <p className="text-xs text-muted">Sin componentes en el espejo local.</p>
            ) : (
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">
                  Receta del combo
                </p>
                <ul className="space-y-1">
                  {componentes.map((c) => (
                    <li
                      key={`${c.codigo}-${c.cantidad}`}
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm"
                    >
                      <span className="font-mono text-xs text-accent">{c.codigo}</span>
                      <span className="text-ink">{c.nombre || "—"}</span>
                      <span className="text-muted text-xs">× {c.cantidad}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}

export default function CatalogoAlegraPanel() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [clase, setClase] = useState<ClaseCatalogo>("product");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detalleCache, setDetalleCache] = useState<Record<string, Componente[]>>({});
  const [editando, setEditando] = useState<CatalogoItem | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q.trim()), 280);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setExpanded(null);
  }, [clase, qDebounced]);

  const queryKey = ["alegra-catalogo", clase, qDebounced] as const;

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("tipo", clase);
      if (qDebounced) params.set("q", qDebounced);
      params.set("limit", "120");
      return api.get<CatalogoResponse>(`/api/alegra/catalogo?${params}`);
    },
    refetchInterval: (query) =>
      query.state.data?.sync?.running ? 2000 : false,
  });

  const syncMut = useMutation({
    mutationFn: () =>
      api.post<CatalogoResponse & { ok?: boolean; mensaje?: string; error?: string }>(
        "/api/alegra/catalogo/sincronizar",
        {},
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["alegra-catalogo"] });
    },
  });

  const editMut = useMutation({
    mutationFn: ({
      codigo,
      nombre,
      precio_lista,
    }: {
      codigo: string;
      nombre: string;
      precio_lista: number;
    }) =>
      api.patch<{ ok: boolean; item?: CatalogoItem; error?: string }>(
        `/api/alegra/catalogo/${encodeURIComponent(codigo)}`,
        { nombre, precio_lista },
      ),
    onSuccess: () => {
      setEditando(null);
      setEditError(null);
      setFlash("Cambios guardados en Alegra");
      void qc.invalidateQueries({ queryKey: ["alegra-catalogo"] });
    },
    onError: (e: Error) => {
      setEditError(e.message || "No se pudo guardar");
    },
  });

  const deleteMut = useMutation({
    mutationFn: (codigo: string) =>
      api.delete<{ ok: boolean; mensaje?: string; modo?: string; error?: string }>(
        `/api/alegra/catalogo/${encodeURIComponent(codigo)}`,
      ),
    onSuccess: (res) => {
      setFlash(res.mensaje || "Eliminado");
      void qc.invalidateQueries({ queryKey: ["alegra-catalogo"] });
    },
  });

  const items = data?.items ?? [];
  const sync = data?.sync;
  const syncing = Boolean(sync?.running || syncMut.isPending);
  const nProductos = data?.conteos?.product ?? sync?.productos ?? 0;
  const nCombos = data?.conteos?.kit ?? sync?.kits ?? 0;
  const totalClase = data?.total ?? items.length;

  const resumen = useMemo(() => {
    const parts = [
      `${nProductos} producto${nProductos === 1 ? "" : "s"}`,
      `${nCombos} combo${nCombos === 1 ? "" : "s"}`,
    ];
    if (data?.synced_at) parts.push(`última sync ${fmtTs(data.synced_at)}`);
    if (data?.stale) parts.push("desactualizado");
    return parts.join(" · ");
  }, [nProductos, nCombos, data?.synced_at, data?.stale]);

  async function toggleExpand(ref: string) {
    if (expanded === ref) {
      setExpanded(null);
      return;
    }
    setExpanded(ref);
    if (detalleCache[ref]) return;
    try {
      const res = await api.get<{ ok: boolean; item?: { componentes?: Componente[] } }>(
        `/api/alegra/catalogo/${encodeURIComponent(ref)}`,
      );
      const comps = res.item?.componentes ?? [];
      setDetalleCache((prev) => ({ ...prev, [ref]: comps }));
    } catch {
      setDetalleCache((prev) => ({ ...prev, [ref]: [] }));
    }
  }

  function pedirEliminar(item: CatalogoItem) {
    const tipo = item.type === "kit" ? "combo" : "producto";
    const ok = window.confirm(
      `¿Eliminar el ${tipo} ${item.reference} de Alegra?\n\n${item.name}\n\nSi tiene facturas asociadas, se inactivará en lugar de borrarse.`,
    );
    if (!ok) return;
    deleteMut.mutate(item.reference);
  }

  const esCombos = clase === "kit";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink">Catálogo Alegra</h2>
          <p className="text-sm text-muted mt-0.5">
            Espejo local clasificado en productos y combos. Podés editar o eliminar en Alegra.
          </p>
          <p className="text-xs text-muted mt-1">{resumen}</p>
          {sync?.mensaje ? (
            <p className="text-xs text-muted mt-0.5">{sync.mensaje}</p>
          ) : null}
          {flash ? (
            <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">{flash}</p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={syncing}
          onClick={() => syncMut.mutate()}
          className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90"
        >
          {syncing ? "Sincronizando…" : "Sincronizar desde Alegra"}
        </button>
      </header>

      <div
        className="grid grid-cols-2 gap-2"
        role="tablist"
        aria-label="Clasificación del catálogo"
      >
        <button
          type="button"
          role="tab"
          aria-selected={clase === "product"}
          onClick={() => setClase("product")}
          className={`rounded-xl border px-4 py-3 text-left transition-colors ${
            clase === "product"
              ? "border-accent bg-accent/10"
              : "border-border bg-surface hover:bg-surface-hover"
          }`}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Productos
          </p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-ink">
            {nProductos}
          </p>
          <p className="text-xs text-muted">Ítems simples / graneles</p>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={clase === "kit"}
          onClick={() => setClase("kit")}
          className={`rounded-xl border px-4 py-3 text-left transition-colors ${
            clase === "kit"
              ? "border-violet-500/60 bg-violet-500/10"
              : "border-border bg-surface hover:bg-surface-hover"
          }`}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Combos
          </p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-ink">
            {nCombos}
          </p>
          <p className="text-xs text-muted">Kits con receta de componentes</p>
        </button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            esCombos
              ? "Buscar combo por SKU o nombre…"
              : "Buscar producto por SKU o nombre…"
          }
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        />
        <p className="text-xs text-muted whitespace-nowrap sm:px-1">
          Mostrando {totalClase} {esCombos ? "combo" : "producto"}
          {totalClase === 1 ? "" : "s"}
          {qDebounced ? ` · filtro “${qDebounced}”` : ""}
        </p>
      </div>

      {error ? (
        <p className="text-sm text-red-600">
          {(error as Error).message || "Error al cargar el catálogo"}
        </p>
      ) : null}
      {syncMut.isError ? (
        <p className="text-sm text-red-600">
          {(syncMut.error as Error)?.message || "No se pudo iniciar la sincronización."}
        </p>
      ) : null}
      {deleteMut.isError ? (
        <p className="text-sm text-red-600">
          {(deleteMut.error as Error)?.message || "No se pudo eliminar."}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead className="sticky top-0 bg-surface z-10 border-b border-border">
            <tr className="text-[11px] uppercase tracking-wide text-muted">
              <th className="px-3 py-2 font-semibold">SKU</th>
              <th className="px-3 py-2 font-semibold">Nombre</th>
              <th className="px-3 py-2 font-semibold text-right">Precio lista</th>
              <th className="px-3 py-2 font-semibold text-right">Costo</th>
              <th className="px-3 py-2 font-semibold text-center">
                {esCombos ? "Receta" : ""}
              </th>
              <th className="px-3 py-2 font-semibold text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted">
                  Cargando…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted">
                  {qDebounced
                    ? `Sin ${esCombos ? "combos" : "productos"} que coincidan.`
                    : `No hay ${esCombos ? "combos" : "productos"} en el espejo. Pulsa «Sincronizar desde Alegra».`}
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <FilaItem
                  key={item.reference}
                  item={item}
                  expanded={expanded === item.reference}
                  onToggle={() => void toggleExpand(item.reference)}
                  onEdit={() => {
                    setEditError(null);
                    setEditando(item);
                  }}
                  onDelete={() => pedirEliminar(item)}
                  componentes={detalleCache[item.reference]}
                  loadingDetalle={
                    expanded === item.reference && detalleCache[item.reference] === undefined
                  }
                  busyRef={deleteMut.isPending ? deleteMut.variables ?? null : null}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
      {isFetching && !isLoading ? (
        <p className="text-[11px] text-muted">Actualizando…</p>
      ) : null}

      {editando ? (
        <EditarModal
          item={editando}
          busy={editMut.isPending}
          error={editError}
          onClose={() => {
            if (!editMut.isPending) {
              setEditando(null);
              setEditError(null);
            }
          }}
          onSave={(nombre, precio_lista) => {
            setEditError(null);
            editMut.mutate({ codigo: editando.reference, nombre, precio_lista });
          }}
        />
      ) : null}
    </div>
  );
}
