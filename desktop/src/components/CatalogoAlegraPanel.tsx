import { useEffect, useId, useMemo, useState } from "react";
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
  precio_meli?: number | null;
  meli_id?: string | null;
  meli_estado?: string | null;
  meli_sincronizado?: boolean | null;
  meli_ratio?: number | null;
  meli_sospechoso?: boolean;
}

interface Componente {
  codigo: string;
  nombre: string;
  cantidad: number;
}

interface CompEdit {
  key: string;
  codigo: string;
  nombre: string;
  cantidad: string;
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
  meli?: {
    actualizado_en?: string | null;
    vinculados?: number;
    desincronizados?: number;
    sospechosos?: number;
    sin_publicacion?: number;
    cache_skus?: number;
  };
}

type FiltroMeli = "todos" | "desfasados" | "sin-meli";

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

function nuevaComp(parcial?: Partial<CompEdit>): CompEdit {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    codigo: "",
    nombre: "",
    cantidad: "1",
    ...parcial,
  };
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
  onSave: (payload: {
    nombre: string;
    precio: number;
    componentes?: Array<{ codigo: string; cantidad: number }>;
    nuevo_codigo?: string;
  }) => void;
}) {
  const esKit = item.type === "kit";
  const tituloId = useId();
  const [nombre, setNombre] = useState(item.name);
  const [precio, setPrecio] = useState(String(Math.round(item.precio_lista || 0)));
  const [codigo, setCodigo] = useState(item.reference);
  const [skuEditable, setSkuEditable] = useState(false);
  const [comps, setComps] = useState<CompEdit[]>([]);
  const [cargandoReceta, setCargandoReceta] = useState(true);
  const [editableComposicion, setEditableComposicion] = useState(true);
  const [avisoMovimientos, setAvisoMovimientos] = useState<string | null>(null);
  const [avisoSku, setAvisoSku] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [sugerencias, setSugerencias] = useState<
    Array<{ codigo: string; nombre: string; type?: string }>
  >([]);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    let cancel = false;
    setCargandoReceta(true);
    void (async () => {
      const aplicarComps = (list: Componente[]) => {
        const limpia = list.filter((c) => (c.codigo || "").trim());
        setComps(
          limpia.length
            ? limpia.map((c) =>
                nuevaComp({
                  codigo: c.codigo.trim(),
                  nombre: c.nombre || "",
                  cantidad: String(c.cantidad || 1),
                }),
              )
            : [nuevaComp()],
        );
      };
      try {
        let desdeLive = false;
        try {
          const live = await api.get<{
            ok: boolean;
            componentes?: Componente[];
            tiene_movimientos?: boolean | null;
            editable_composicion?: boolean;
          }>(`/api/siigo/productos/detalle?codigo=${encodeURIComponent(item.reference)}`);
          if (cancel) return;
          if (live.ok) {
            const tieneMov = live.tiene_movimientos === true;
            setSkuEditable(!tieneMov);
            setAvisoSku(
              tieneMov
                ? "Este ítem ya tiene movimientos en Alegra: no se puede cambiar el SKU."
                : null,
            );
            if (esKit) {
              aplicarComps(live.componentes || []);
              const bloqueado = tieneMov || live.editable_composicion === false;
              setEditableComposicion(!bloqueado);
              setAvisoMovimientos(
                bloqueado
                  ? "Este combo ya tiene movimientos en Alegra: podés editar nombre/precio, pero no la receta ni el SKU. Para otra composición, duplicá el combo."
                  : null,
              );
            }
            desdeLive = true;
          }
        } catch {
          /* espejo local */
        }
        if (!desdeLive) {
          setSkuEditable(true);
          setAvisoSku(
            "No se pudo confirmar movimientos en Alegra en vivo; si el ítem ya tiene ventas, Alegra rechazará el cambio de SKU.",
          );
          if (esKit) {
            const local = await api.get<{ ok: boolean; item?: { componentes?: Componente[] } }>(
              `/api/alegra/catalogo/${encodeURIComponent(item.reference)}`,
            );
            if (cancel) return;
            aplicarComps(local.item?.componentes || []);
            setEditableComposicion(true);
            setAvisoMovimientos(
              "No se pudo confirmar movimientos en Alegra en vivo; se muestra la receta local. Si el kit ya tiene ventas, Alegra rechazará el guardado.",
            );
          }
        }
      } catch {
        if (!cancel) {
          if (esKit) {
            setComps([nuevaComp()]);
            setAvisoMovimientos("No se pudo cargar la receta.");
          }
          setSkuEditable(false);
        }
      } finally {
        if (!cancel) setCargandoReceta(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [esKit, item.reference]);

  useEffect(() => {
    if (!esKit || !editableComposicion) return;
    const q = busqueda.trim();
    if (q.length < 1) {
      setSugerencias([]);
      return;
    }
    let cancel = false;
    const t = window.setTimeout(() => {
      setBuscando(true);
      void api
        .get<{ items?: Array<{ codigo: string; nombre: string; type?: string }> }>(
          `/api/siigo/productos/buscar?q=${encodeURIComponent(q)}&limit=12&excluir_combos=1`,
        )
        .then((res) => {
          if (!cancel) setSugerencias(res.items || []);
        })
        .catch(() => {
          if (!cancel) setSugerencias([]);
        })
        .finally(() => {
          if (!cancel) setBuscando(false);
        });
    }, 220);
    return () => {
      cancel = true;
      window.clearTimeout(t);
    };
  }, [busqueda, esKit, editableComposicion]);

  const compsValidos = comps.filter((c) => c.codigo.trim());
  const compsOk =
    !esKit
    || !editableComposicion
    || (compsValidos.length >= 1
      && compsValidos.every((c) => {
        const n = Number(c.cantidad);
        return Number.isFinite(n) && n > 0;
      }));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={tituloId}
      onClick={onClose}
    >
      <div
        className={`w-full ${esKit ? "max-w-lg" : "max-w-md"} max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-surface p-4 shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={tituloId} className="text-base font-semibold text-ink">
          Editar {esKit ? "combo" : "producto"}
        </h3>

        <label className="mt-3 block text-xs font-semibold text-muted">SKU</label>
        <input
          type="text"
          value={codigo}
          disabled={busy || cargandoReceta || !skuEditable}
          onChange={(e) => setCodigo(e.target.value.replace(/\s/g, ""))}
          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-accent outline-none focus:border-accent disabled:opacity-70"
        />
        {cargandoReceta ? (
          <p className="mt-1 text-[10px] text-muted">Verificando movimientos en Alegra…</p>
        ) : avisoSku ? (
          <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-400">{avisoSku}</p>
        ) : null}

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
        {item.precio_meli != null ? (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <p
              className={`text-[10px] ${
                item.meli_sincronizado === false ? "text-amber-700 dark:text-amber-400" : "text-muted"
              }`}
            >
              MeLi {cop(item.precio_meli)}
              {item.meli_id ? ` · ${item.meli_id}` : ""}
            </p>
            {item.meli_sincronizado === false ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setPrecio(String(Math.round(item.precio_meli || 0)))}
                className="rounded px-1 py-0.5 text-[9px] font-semibold text-accent hover:bg-accent/10 disabled:opacity-50"
              >
                Usar precio MeLi
              </button>
            ) : null}
          </div>
        ) : (
          <p className="mt-1 text-[10px] text-muted">Sin publicación MeLi con este SKU.</p>
        )}

        {esKit ? (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Componentes
              </p>
              {editableComposicion && !cargandoReceta ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setComps((prev) => [...prev, nuevaComp()])}
                  className="text-xs font-semibold text-accent hover:underline disabled:opacity-50"
                >
                  + Agregar
                </button>
              ) : null}
            </div>

            {avisoMovimientos ? (
              <p
                className={`rounded-lg border px-2.5 py-2 text-xs ${
                  editableComposicion
                    ? "border-amber-400/50 bg-amber-50 text-amber-950 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-100"
                    : "border-danger/40 bg-danger/10 text-danger"
                }`}
              >
                {avisoMovimientos}
              </p>
            ) : editableComposicion && !cargandoReceta ? (
              <p className="text-[11px] text-muted">
                Sin movimientos en Alegra: podés cambiar códigos y cantidades de la receta.
              </p>
            ) : null}

            {cargandoReceta ? (
              <p className="text-xs text-muted">Cargando receta…</p>
            ) : (
              <ul className="space-y-2">
                {comps.map((c) => (
                  <li
                    key={c.key}
                    className="grid grid-cols-[1fr_4.5rem_auto] gap-1.5 rounded-lg border border-border/70 bg-surface-hover/30 p-2"
                  >
                    <div className="min-w-0">
                      <input
                        type="text"
                        value={c.codigo}
                        disabled={busy || !editableComposicion}
                        onChange={(e) => {
                          const v = e.target.value.replace(/\s/g, "");
                          setComps((prev) =>
                            prev.map((x) =>
                              x.key === c.key ? { ...x, codigo: v, nombre: "" } : x,
                            ),
                          );
                        }}
                        placeholder="SKU componente"
                        className="w-full rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-accent disabled:opacity-60"
                      />
                      {c.nombre ? (
                        <p className="mt-0.5 truncate text-[10px] text-muted">{c.nombre}</p>
                      ) : null}
                    </div>
                    <input
                      type="number"
                      min={0.001}
                      step="any"
                      value={c.cantidad}
                      disabled={busy || !editableComposicion}
                      onChange={(e) => {
                        const v = e.target.value;
                        setComps((prev) =>
                          prev.map((x) => (x.key === c.key ? { ...x, cantidad: v } : x)),
                        );
                      }}
                      className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-accent disabled:opacity-60"
                      aria-label="Cantidad"
                    />
                    {editableComposicion ? (
                      <button
                        type="button"
                        disabled={busy || comps.length <= 1}
                        onClick={() =>
                          setComps((prev) => prev.filter((x) => x.key !== c.key))
                        }
                        className="self-start rounded px-1.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-500/10 disabled:opacity-40"
                        title="Quitar"
                      >
                        ×
                      </button>
                    ) : (
                      <span className="w-6" />
                    )}
                  </li>
                ))}
              </ul>
            )}

            {editableComposicion && !cargandoReceta ? (
              <div className="relative">
                <label className="block text-[11px] font-semibold text-muted">
                  Buscar componente para agregar
                </label>
                <input
                  type="search"
                  value={busqueda}
                  disabled={busy}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Código o nombre…"
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                />
                {buscando ? (
                  <p className="mt-1 text-[10px] text-muted">Buscando…</p>
                ) : null}
                {sugerencias.length > 0 ? (
                  <ul className="absolute left-0 right-0 z-20 mt-1 max-h-40 overflow-y-auto rounded-lg border border-border bg-surface-panel shadow-lg">
                    {sugerencias.map((s) => (
                      <li key={s.codigo}>
                        <button
                          type="button"
                          className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-accent/10"
                          onClick={() => {
                            setComps((prev) => {
                              const vacia = prev.find((x) => !x.codigo.trim());
                              if (vacia) {
                                return prev.map((x) =>
                                  x.key === vacia.key
                                    ? {
                                        ...x,
                                        codigo: s.codigo,
                                        nombre: s.nombre || "",
                                      }
                                    : x,
                                );
                              }
                              if (prev.some((x) => x.codigo.toUpperCase() === s.codigo.toUpperCase())) {
                                return prev;
                              }
                              return [
                                ...prev,
                                nuevaComp({
                                  codigo: s.codigo,
                                  nombre: s.nombre || "",
                                  cantidad: "1",
                                }),
                              ];
                            });
                            setBusqueda("");
                            setSugerencias([]);
                          }}
                        >
                          <span className="font-mono text-xs font-bold text-accent">
                            {s.codigo}
                          </span>
                          <span className="line-clamp-1 text-[11px] text-muted">
                            {s.nombre}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

        <div className="mt-4 flex justify-end gap-1.5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border px-2 py-1 text-[10px] font-semibold text-muted hover:bg-surface-hover disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || !nombre.trim() || !codigo.trim() || cargandoReceta || !compsOk}
            onClick={() => {
              const p = Number(precio);
              if (Number.isNaN(p) || p < 0) return;
              const payload: {
                nombre: string;
                precio: number;
                componentes?: Array<{ codigo: string; cantidad: number }>;
                nuevo_codigo?: string;
              } = {
                nombre: nombreMayusculasAlegra(nombre, 150),
                precio: Math.round(p),
              };
              if (esKit && editableComposicion) {
                payload.componentes = compsValidos.map((c) => ({
                  codigo: c.codigo.trim(),
                  cantidad: Number(c.cantidad || 1),
                }));
              }
              const codigoTrim = codigo.trim();
              if (skuEditable && codigoTrim && codigoTrim !== item.reference) {
                payload.nuevo_codigo = codigoTrim;
              }
              onSave(payload);
            }}
            className="rounded-md bg-accent px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-50"
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
  onUsarMeli,
  componentes,
  loadingDetalle,
  busyRef,
}: {
  item: CatalogoItem;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onUsarMeli: () => void;
  componentes?: Componente[];
  loadingDetalle?: boolean;
  busyRef: string | null;
}) {
  const esKit = item.type === "kit";
  const busy = busyRef === item.reference || busyRef === "*";
  const desfasado = item.meli_sincronizado === false;
  return (
    <>
      <tr
        className={`transition-colors ${
          desfasado
            ? "bg-amber-500/8 hover:bg-amber-500/12"
            : expanded
              ? "bg-accent/8"
              : "hover:bg-surface-hover"
        }`}
      >
        <td
          className={`px-2 py-1.5 font-mono text-[11px] text-accent whitespace-nowrap ${
            esKit ? "cursor-pointer" : ""
          }`}
          onClick={esKit ? onToggle : undefined}
        >
          {item.reference}
        </td>
        <td
          className={`px-2 py-1.5 text-xs font-semibold text-ink max-w-[280px] ${
            esKit ? "cursor-pointer" : ""
          }`}
          onClick={esKit ? onToggle : undefined}
        >
          <span className="block truncate" title={item.name}>
            {item.name}
          </span>
        </td>
        <td
          className={`px-2 py-1.5 text-xs text-right whitespace-nowrap ${
            desfasado ? "font-bold text-amber-800 dark:text-amber-300" : "font-bold text-ink"
          }`}
        >
          {cop(item.precio_lista)}
        </td>
        <td className="px-2 py-1.5 text-xs text-right whitespace-nowrap">
          {item.precio_meli != null ? (
            <div className="flex flex-col items-end leading-tight">
              <span
                className={
                  desfasado
                    ? "font-semibold text-accent"
                    : "text-ink"
                }
              >
                {cop(item.precio_meli)}
              </span>
              {desfasado ? (
                <span
                  className="text-[9px] text-amber-700 dark:text-amber-400"
                  title={
                    item.meli_sospechoso
                      ? "Diferencia grande: revisá que el SKU de MeLi sea el correcto"
                      : "Alegra y MeLi no coinciden"
                  }
                >
                  {item.meli_sospechoso ? "revisar SKU" : "desfasado"}
                </span>
              ) : (
                <span className="text-[9px] text-muted">igual</span>
              )}
            </div>
          ) : (
            <span className="text-[10px] text-muted">—</span>
          )}
        </td>
        <td className="px-2 py-1.5 text-[10px] text-muted text-right font-mono whitespace-nowrap">
          {item.unit_cost > 0 ? cop(item.unit_cost) : "—"}
        </td>
        <td className="px-2 py-1.5 text-[10px] text-muted text-center">
          {esKit ? (expanded ? "▾" : "▸") : "—"}
        </td>
        <td className="px-2 py-1.5 whitespace-nowrap">
          <div className="flex items-center justify-end gap-0.5">
            {desfasado ? (
              <button
                type="button"
                disabled={busy}
                onClick={onUsarMeli}
                title={
                  item.meli_sospechoso
                    ? "La diferencia es grande; confirmá que el SKU vincule el producto correcto"
                    : "Copiar el precio publicado en MeLi a Alegra"
                }
                className="rounded px-1 py-0.5 text-[9px] font-semibold leading-tight text-accent hover:bg-accent/10 disabled:opacity-50"
              >
                Usar MeLi
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={onEdit}
              className="rounded px-1 py-0.5 text-[9px] font-semibold leading-tight text-accent hover:bg-accent/10 disabled:opacity-50"
            >
              Editar
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onDelete}
              className="rounded px-1 py-0.5 text-[9px] font-semibold leading-tight text-red-600 hover:bg-red-500/10 disabled:opacity-50"
            >
              {busy ? "…" : "Eliminar"}
            </button>
          </div>
        </td>
      </tr>
      {expanded && esKit ? (
        <tr className="bg-surface-hover/40">
          <td colSpan={7} className="px-4 py-3">
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
  const [filtroMeli, setFiltroMeli] = useState<FiltroMeli>("todos");

  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q.trim()), 280);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setExpanded(null);
    setFiltroMeli("todos");
  }, [clase, qDebounced]);

  const queryKey = ["alegra-catalogo", clase, qDebounced] as const;

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("tipo", clase);
      if (qDebounced) params.set("q", qDebounced);
      params.set("limit", "400");
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
      componentes,
      nuevo_codigo,
    }: {
      codigo: string;
      nombre: string;
      precio_lista: number;
      componentes?: Array<{ codigo: string; cantidad: number }>;
      nuevo_codigo?: string;
    }) =>
      api.patch<{
        ok: boolean;
        item?: CatalogoItem & { componentes?: Componente[] };
        cambios?: { codigo?: string; codigo_anterior?: string };
        error?: string;
        bloqueado_movimientos?: boolean;
      }>(`/api/alegra/catalogo/${encodeURIComponent(codigo)}`, {
        nombre,
        precio_lista,
        ...(componentes ? { componentes } : {}),
        ...(nuevo_codigo ? { nuevo_codigo } : {}),
      }),
    onSuccess: (res, vars) => {
      setEditando(null);
      setEditError(null);
      setFlash(
        vars.nuevo_codigo
          ? `SKU ${vars.codigo} → ${vars.nuevo_codigo} actualizado en Alegra`
          : vars.componentes
            ? "Nombre, precio y receta guardados en Alegra"
            : "Cambios guardados en Alegra",
      );
      const codigoFinal = res.cambios?.codigo || vars.codigo;
      if (res.item?.componentes) {
        setDetalleCache((prev) => {
          const next = { ...prev };
          delete next[vars.codigo];
          next[codigoFinal] = res.item!.componentes!;
          return next;
        });
      } else if (vars.componentes || vars.nuevo_codigo) {
        setDetalleCache((prev) => {
          const next = { ...prev };
          delete next[vars.codigo];
          return next;
        });
      }
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

  const igualarMut = useMutation({
    mutationFn: (codigos: string[]) =>
      api.post<{
        ok: boolean;
        total_aplicados?: number;
        aplicados?: Array<{ sku: string; precio_antes: number; precio_meli: number }>;
        omitidos?: Array<{ sku: string; razon: string }>;
        errores?: Array<{ sku: string; error: string }>;
        error?: string;
      }>("/api/alegra/catalogo/igualar-meli", { codigos }),
    onSuccess: (res) => {
      const n = res.total_aplicados ?? res.aplicados?.length ?? 0;
      const nErr = res.errores?.length ?? 0;
      setFlash(
        nErr
          ? `Alegra actualizado en ${n} SKU · ${nErr} con error`
          : n
            ? `Precio MeLi copiado a Alegra en ${n} SKU`
            : "Nada que actualizar",
      );
      void qc.invalidateQueries({ queryKey: ["alegra-catalogo"] });
    },
  });

  const items = data?.items ?? [];
  const sync = data?.sync;
  const syncing = Boolean(sync?.running || syncMut.isPending);
  const nProductos = data?.conteos?.product ?? sync?.productos ?? 0;
  const nCombos = data?.conteos?.kit ?? sync?.kits ?? 0;
  const totalClase = data?.total ?? items.length;
  const meli = data?.meli;
  const nDesfasados = meli?.desincronizados ?? 0;
  const nSinMeli = meli?.sin_publicacion ?? 0;
  const nVinculados = meli?.vinculados ?? 0;

  const itemsVisibles = useMemo(() => {
    if (filtroMeli === "desfasados") {
      return items.filter((i) => i.meli_sincronizado === false);
    }
    if (filtroMeli === "sin-meli") {
      return items.filter((i) => i.precio_meli == null);
    }
    return items;
  }, [items, filtroMeli]);

  const desfasadosSeguros = useMemo(
    () => items.filter((i) => i.meli_sincronizado === false && !i.meli_sospechoso),
    [items],
  );

  const busySku =
    deleteMut.isPending
      ? (deleteMut.variables ?? null)
      : igualarMut.isPending && (igualarMut.variables?.length ?? 0) === 1
        ? (igualarMut.variables?.[0] ?? null)
        : igualarMut.isPending
          ? "*"
          : null;

  const resumen = useMemo(() => {
    const parts = [
      `${nProductos} producto${nProductos === 1 ? "" : "s"}`,
      `${nCombos} combo${nCombos === 1 ? "" : "s"}`,
    ];
    if (nVinculados) parts.push(`${nVinculados} con precio MeLi`);
    if (nDesfasados) parts.push(`${nDesfasados} desfasado${nDesfasados === 1 ? "" : "s"}`);
    if (data?.synced_at) parts.push(`Alegra ${fmtTs(data.synced_at)}`);
    if (meli?.actualizado_en) parts.push(`MeLi ${fmtTs(meli.actualizado_en)}`);
    if (data?.stale) parts.push("desactualizado");
    return parts.join(" · ");
  }, [nProductos, nCombos, nVinculados, nDesfasados, data?.synced_at, data?.stale, meli?.actualizado_en]);

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

  function pedirUsarMeli(item: CatalogoItem) {
    if (item.precio_meli == null) return;
    const aviso = item.meli_sospechoso
      ? `\n\nOjo: la diferencia es grande (${item.meli_ratio ?? "?"}×). Confirmá que el SKU de MeLi sea este producto.`
      : "";
    const ok = window.confirm(
      `¿Copiar el precio de MeLi a Alegra?\n\n${item.reference}\nAlegra ${cop(item.precio_lista)} → MeLi ${cop(item.precio_meli)}${aviso}`,
    );
    if (!ok) return;
    igualarMut.mutate([item.reference]);
  }

  function pedirIgualarLote() {
    const codigos = desfasadosSeguros.map((i) => i.reference);
    if (!codigos.length) return;
    const nSospechosos = (meli?.sospechosos ?? 0);
    const extra = nSospechosos
      ? `\n\nSe omiten ${nSospechosos} con diferencia >2× (posible SKU cruzado); igualalos uno a uno.`
      : "";
    const ok = window.confirm(
      `¿Copiar el precio publicado en MeLi a Alegra en ${codigos.length} SKU de esta lista?${extra}`,
    );
    if (!ok) return;
    igualarMut.mutate(codigos);
  }

  const esCombos = clase === "kit";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Zona fija: título, Productos/Combos, búsqueda — no se mueven con el scroll */}
      <div className="shrink-0 space-y-2 border-b border-border bg-surface px-3 pb-2 pt-3 md:px-4">
        <header className="flex flex-col gap-1.5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">Catálogo Alegra</h2>
            <p className="text-[10px] text-muted mt-0.5 leading-snug">
              Espejo local de Alegra cruzado con el precio publicado en MeLi (mismo SKU).
            </p>
            <p className="text-[10px] text-muted mt-0.5">{resumen}</p>
            {sync?.mensaje ? (
              <p className="text-[10px] text-muted mt-0.5">{sync.mensaje}</p>
            ) : null}
            {flash ? (
              <p className="text-[10px] text-emerald-700 dark:text-emerald-400 mt-0.5">{flash}</p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={syncing}
            onClick={() => syncMut.mutate()}
            className="shrink-0 rounded-md bg-accent px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-50 hover:opacity-90"
          >
            {syncing ? "Sincronizando…" : "Sincronizar desde Alegra"}
          </button>
        </header>

        <div
          className="grid grid-cols-2 gap-1.5"
          role="tablist"
          aria-label="Clasificación del catálogo"
        >
          <button
            type="button"
            role="tab"
            aria-selected={clase === "product"}
            onClick={() => setClase("product")}
            className={`rounded-lg border px-2 py-1.5 text-left transition-colors ${
              clase === "product"
                ? "border-accent bg-accent/10"
                : "border-border bg-surface hover:bg-surface-hover"
            }`}
          >
            <p className="text-[9px] font-semibold uppercase tracking-wide text-muted leading-none">
              Productos
            </p>
            <p className="mt-0.5 text-base font-bold tabular-nums leading-tight text-ink">
              {nProductos}
            </p>
            <p className="text-[9px] text-muted leading-tight">Ítems simples / graneles</p>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={clase === "kit"}
            onClick={() => setClase("kit")}
            className={`rounded-lg border px-2 py-1.5 text-left transition-colors ${
              clase === "kit"
                ? "border-violet-500/60 bg-violet-500/10"
                : "border-border bg-surface hover:bg-surface-hover"
            }`}
          >
            <p className="text-[9px] font-semibold uppercase tracking-wide text-muted leading-none">
              Combos
            </p>
            <p className="mt-0.5 text-base font-bold tabular-nums leading-tight text-ink">
              {nCombos}
            </p>
            <p className="text-[9px] text-muted leading-tight">Kits con receta</p>
          </button>
        </div>

        <div className="flex flex-col gap-1 sm:flex-row sm:items-center">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={
              esCombos
                ? "Buscar combo por SKU o nombre…"
                : "Buscar producto por SKU o nombre…"
            }
            className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent"
          />
          <p className="text-[10px] text-muted whitespace-nowrap sm:px-1">
            Mostrando {itemsVisibles.length}
            {filtroMeli !== "todos" ? ` de ${items.length}` : ` / ${totalClase}`}{" "}
            {esCombos ? "combo" : "producto"}
            {itemsVisibles.length === 1 ? "" : "s"}
            {qDebounced ? ` · “${qDebounced}”` : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {(
            [
              ["todos", `Todos (${items.length})`],
              ["desfasados", `Desfasados (${nDesfasados})`],
              ["sin-meli", `Sin MeLi (${nSinMeli})`],
            ] as Array<[FiltroMeli, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFiltroMeli(id)}
              className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${
                filtroMeli === id
                  ? "border-accent bg-accent/10 text-ink"
                  : "border-border text-muted hover:bg-surface-hover"
              }`}
            >
              {label}
            </button>
          ))}
          {desfasadosSeguros.length > 0 ? (
            <button
              type="button"
              disabled={igualarMut.isPending}
              onClick={pedirIgualarLote}
              className="rounded-md border border-accent/40 px-1.5 py-0.5 text-[10px] font-semibold text-accent hover:bg-accent/10 disabled:opacity-50"
            >
              {igualarMut.isPending
                ? "Igualando…"
                : `Igualar ${desfasadosSeguros.length} con MeLi`}
            </button>
          ) : null}
        </div>

        {error ? (
          <p className="text-xs text-red-600">
            {(error as Error).message || "Error al cargar el catálogo"}
          </p>
        ) : null}
        {syncMut.isError ? (
          <p className="text-xs text-red-600">
            {(syncMut.error as Error)?.message || "No se pudo iniciar la sincronización."}
          </p>
        ) : null}
        {deleteMut.isError ? (
          <p className="text-xs text-red-600">
            {(deleteMut.error as Error)?.message || "No se pudo eliminar."}
          </p>
        ) : null}
        {igualarMut.isError ? (
          <p className="text-xs text-red-600">
            {(igualarMut.error as Error)?.message || "No se pudo igualar con MeLi."}
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead className="sticky top-0 z-10 border-b border-border bg-surface">
            <tr className="text-[10px] uppercase tracking-wide text-muted">
              <th className="px-2 py-1.5 font-semibold">SKU</th>
              <th className="px-2 py-1.5 font-semibold">Nombre</th>
              <th className="px-2 py-1.5 font-semibold text-right">Alegra</th>
              <th className="px-2 py-1.5 font-semibold text-right">MeLi</th>
              <th className="px-2 py-1.5 font-semibold text-right">Costo</th>
              <th className="px-2 py-1.5 font-semibold text-center">
                {esCombos ? "Receta" : ""}
              </th>
              <th className="px-2 py-1.5 font-semibold text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted">
                  Cargando…
                </td>
              </tr>
            ) : itemsVisibles.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted">
                  {filtroMeli === "desfasados"
                    ? "Ningún SKU de esta lista tiene precio distinto al de MeLi."
                    : filtroMeli === "sin-meli"
                      ? `Todos los ${esCombos ? "combos" : "productos"} de esta lista tienen publicación MeLi.`
                      : qDebounced
                        ? `Sin ${esCombos ? "combos" : "productos"} que coincidan.`
                        : `No hay ${esCombos ? "combos" : "productos"} en el espejo. Pulsa «Sincronizar desde Alegra».`}
                </td>
              </tr>
            ) : (
              itemsVisibles.map((item) => (
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
                  onUsarMeli={() => pedirUsarMeli(item)}
                  componentes={detalleCache[item.reference]}
                  loadingDetalle={
                    expanded === item.reference && detalleCache[item.reference] === undefined
                  }
                  busyRef={busySku}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
      {isFetching && !isLoading ? (
        <p className="shrink-0 px-3 py-1 text-[10px] text-muted">Actualizando…</p>
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
          onSave={({ nombre, precio, componentes, nuevo_codigo }) => {
            setEditError(null);
            editMut.mutate({
              codigo: editando.reference,
              nombre,
              precio_lista: precio,
              componentes,
              nuevo_codigo,
            });
          }}
        />
      ) : null}
    </div>
  );
}
