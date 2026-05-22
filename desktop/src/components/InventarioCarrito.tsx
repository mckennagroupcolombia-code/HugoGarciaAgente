import { useMemo, useState } from "react";
import { questNavBtn } from "../lib/questStyles";
import { useInventarioCarrito, type CarritoMaterial } from "../stores/inventarioCarrito";

function tapi(path: string, token: string, options: RequestInit = {}) {
  const hasJsonBody = options.body != null && options.body !== "";
  return fetch(`/api/tickets${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || data.message || `Error ${r.status}`);
    return data;
  });
}

function formatCop(n: number) {
  return n.toLocaleString("es-CO", { maximumFractionDigits: 0 });
}

function textoListaCarrito(items: CarritoMaterial[]): string {
  const lines = items.map(
    (i) =>
      `• ${i.nombre}: ${i.cantidad} ${i.unidad}${i.proveedor ? ` (${i.proveedor})` : ""}`,
  );
  return `Lista de compra — Centro de Mando\n${lines.join("\n")}`;
}

/** Botón de navegación principal (junto a Recetas). */
export function InventarioCarritoNavBtn({
  active,
  onOpen,
}: {
  active?: boolean;
  onOpen: () => void;
}) {
  const count = useInventarioCarrito((s) => s.items.length);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`relative ${questNavBtn(!!active)}`}
      title="Carrito de compras (inventario)"
    >
      🛒 Carrito
      {count > 0 && (
        <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-600 px-1 text-[10px] font-black text-white leading-none shadow-sm">
          {count}
        </span>
      )}
    </button>
  );
}

export function InventarioCarritoBadge({
  onOpen,
}: {
  onOpen: () => void;
}) {
  const count = useInventarioCarrito((s) => s.items.length);
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative rounded-paper border-2 border-amber-500/60 bg-amber-500/15 px-3 py-2 text-sm font-bold text-amber-900 transition hover:border-amber-500 dark:text-amber-200"
      title="Ver carrito de compras"
    >
      🛒 Carrito
      <span className="ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-amber-600 px-1.5 py-0.5 text-[10px] font-black text-white">
        {count}
      </span>
    </button>
  );
}

export function InventarioCarritoModal({
  token,
  nivel,
}: {
  token: string;
  nivel: number;
}) {
  const open = useInventarioCarrito((s) => s.modalOpen);
  const setModalOpen = useInventarioCarrito((s) => s.setModalOpen);
  const onClose = () => setModalOpen(false);
  const items = useInventarioCarrito((s) => s.items);
  const setCantidad = useInventarioCarrito((s) => s.setCantidad);
  const remove = useInventarioCarrito((s) => s.remove);
  const clear = useInventarioCarrito((s) => s.clear);

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const totalEstimado = useMemo(
    () => items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0),
    [items],
  );

  const puedeOrdenar = nivel >= 2;

  async function generarOrdenes() {
    if (!items.length || !puedeOrdenar) return;
    setSaving(true);
    setMsg(null);
    const errores: string[] = [];
    const okIds = new Set<number>();

    for (const item of items) {
      try {
        await tapi("/ordenes-compra", token, {
          method: "POST",
          body: JSON.stringify({
            material_id: item.materialId,
            cantidad: item.cantidad,
            precio_unitario: item.precio_unitario,
            proveedor: item.proveedor,
            notas: "Desde carrito de inventario — Centro de Mando",
          }),
        });
        okIds.add(item.materialId);
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : "Error";
        errores.push(`${item.nombre}: ${m}`);
      }
    }

    if (okIds.size > 0) {
      useInventarioCarrito.setState({
        items: items.filter((i) => !okIds.has(i.materialId)),
      });
    }

    if (errores.length === 0 && okIds.size > 0) {
      setMsg({
        type: "ok",
        text: `${okIds.size} orden${okIds.size !== 1 ? "es" : ""} de compra creada${okIds.size !== 1 ? "s" : ""} (pendientes).`,
      });
    } else if (okIds.size > 0) {
      setMsg({
        type: "err",
        text: `${okIds.size} creada(s). Fallos: ${errores.join(" · ")}`,
      });
    } else {
      setMsg({ type: "err", text: errores.join(" · ") || "No se pudo crear ninguna orden." });
    }
    setSaving(false);
  }

  function copiarLista() {
    if (!items.length) return;
    void navigator.clipboard.writeText(textoListaCarrito(items));
    setMsg({ type: "ok", text: "Lista copiada al portapapeles." });
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="inventario-carrito-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[min(90vh,640px)] w-full max-w-lg flex-col rounded-paper border-2 border-border bg-surface-panel shadow-paper-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h3 id="inventario-carrito-title" className="text-lg font-extrabold text-ink">
              🛒 Carrito de compras
            </h3>
            <p className="text-xs text-muted">
              Materiales para pedir o reponer stock
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted hover:border-accent hover:text-accent"
          >
            ← Atrás
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">
              Vacío. Usa el botón 🛒 en cada material del inventario.
            </p>
          ) : (
            items.map((item) => (
              <div
                key={item.materialId}
                className="rounded-paper border border-border bg-surface-hover/50 p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 text-sm font-bold text-ink">{item.nombre}</p>
                  <button
                    type="button"
                    onClick={() => remove(item.materialId)}
                    className="shrink-0 text-xs font-bold text-red-600 hover:underline"
                  >
                    Quitar
                  </button>
                </div>
                {item.proveedor && (
                  <p className="text-[10px] text-muted">Proveedor: {item.proveedor}</p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-[10px] font-bold uppercase text-muted">Cantidad</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={item.cantidad}
                    onChange={(e) =>
                      setCantidad(item.materialId, parseFloat(e.target.value) || 0)
                    }
                    className="w-24 rounded-paper border border-border bg-surface-input px-2 py-1 text-sm outline-none focus:border-accent"
                  />
                  <span className="text-xs text-muted">{item.unidad}</span>
                  {item.precio_unitario > 0 && (
                    <span className="ml-auto text-xs text-muted tabular-nums">
                      ≈ ${formatCop(item.cantidad * item.precio_unitario)}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t border-border px-4 py-3 space-y-3">
            {totalEstimado > 0 && (
              <p className="text-sm font-bold text-ink tabular-nums">
                Total estimado: ${formatCop(totalEstimado)}
              </p>
            )}
            {msg && (
              <p
                className={`text-xs font-semibold ${msg.type === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-red-600"}`}
              >
                {msg.text}
              </p>
            )}
            {!puedeOrdenar && (
              <p className="text-xs text-muted">
                Rol supervisor o superior necesario para generar órdenes de compra. Puedes copiar la lista.
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={clear}
                disabled={saving}
                className="rounded-paper border border-border px-3 py-1.5 text-xs font-bold text-muted hover:border-accent disabled:opacity-40"
              >
                Vaciar
              </button>
              <button
                type="button"
                onClick={copiarLista}
                disabled={saving}
                className="rounded-paper border border-border px-3 py-1.5 text-xs font-bold text-muted hover:border-accent disabled:opacity-40"
              >
                Copiar lista
              </button>
              <button
                type="button"
                onClick={generarOrdenes}
                disabled={saving || !puedeOrdenar}
                className="rounded-paper border-2 border-accent bg-accent px-4 py-1.5 text-xs font-bold text-white shadow-[0_2px_0_#045159] hover:bg-accent-hover disabled:opacity-40"
              >
                {saving ? "Creando…" : "Generar órdenes"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
