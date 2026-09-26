import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api/client";
import type { ListaPublicaciones, PublicacionItem } from "../../hooks/usePublicaciones";
import { partirPresentacion } from "./GuiaPublicacionTaller";
import { PngAprobadosFranja, type Eslabon } from "./comun";

/**
 * La publicación de un combo en un EMERGENTE sobre el taller: se revisa o se crea sin salir del caso.
 *
 * La tienda web solo muestra combos con publicación en Mercado Libre (website.py
 * `_filtrar_combos_publicados_meli`), así que el emergente primero averigua en qué caso está:
 *  - En la vitrina → el mismo editor de Publicaciones (web | MeLi: fotos, precio, visible).
 *  - No está → guía: ¿existe con otro SKU? (buscar por nombre, abrir cualquiera ahí mismo) →
 *    crear la publicación con el combo ya escrito → actualizar la vitrina y comprobar.
 * Son los mismos componentes del panel Publicaciones: acá no nace otra forma de publicar.
 *
 * Solo se cierra con «Cerrar» (no con Escape ni clic fuera): el editor guarda por acciones y un
 * cierre accidental a mitad de «Crear» perdería el contenido generado.
 */

// Cargados aparte: arrastran todo el panel de Publicaciones y el de MeLi, que el taller no necesita hasta abrir.
const EditorPanel = lazy(() => import("../PublicacionesPanel").then((m) => ({ default: m.EditorPanel })));
const CrearDesdeCeroPanel = lazy(() => import("../MeliComplianceTab").then((m) => ({ default: m.CrearDesdeCeroPanel })));

const BTN = "rounded-md border border-accent bg-accent px-3 py-1.5 text-[12px] font-bold text-white hover:opacity-90 disabled:opacity-50";
const BTN_SEC = "rounded-md border border-border bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink hover:border-accent disabled:opacity-50";

type Vista = { tipo: "guia" } | { tipo: "buscar" } | { tipo: "crear" } | { tipo: "editar"; sku: string };

function contiene(i: PublicacionItem, sku: string) {
  return i.sku.toUpperCase() === sku || (i.presentaciones ?? []).some((p) => (p.sku || "").toUpperCase() === sku);
}

export default function PublicacionEmergente({ sku: skuCombo, nombre, precioLista, etiqueta, onCerrar }: {
  sku: string;
  /** La pieza «Diseño» del combo: el PNG digital aprobado es el que va a la publicación. */
  etiqueta?: Eslabon;
  nombre: string;
  precioLista?: number | null;
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const sku = skuCombo.toUpperCase();
  const { base, presentacion } = partirPresentacion(nombre);
  const [vista, setVista] = useState<Vista | null>(null);

  const estado = useQuery({
    queryKey: ["publicaciones", sku, "", ""],
    queryFn: () => api.get<ListaPublicaciones>(`/api/publicaciones?buscar=${encodeURIComponent(sku)}`),
    staleTime: 15_000,
  });
  const item = (estado.data?.items ?? []).find((i) => contiene(i, sku));
  // Mientras no se elija otra cosa: en la vitrina → editor; si no → guía.
  const v: Vista = vista ?? (item ? { tipo: "editar", sku: skuCombo } : { tipo: "guia" });

  const porNombre = useQuery({
    queryKey: ["publicaciones", base, "", ""],
    queryFn: () => api.get<ListaPublicaciones>(`/api/publicaciones?buscar=${encodeURIComponent(base)}`),
    enabled: v.tipo === "buscar" && Boolean(base),
    staleTime: 30_000,
  });

  const refrescar = useMutation({
    mutationFn: () => api.post<Record<string, unknown>>("/api/publicaciones/refresh-web", {}, { timeoutMs: 180_000 }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["publicaciones"] });
      setVista(null); // vuelve a decidir: si ya aparece, abre el editor
    },
  });

  const paso = item ? 0 : v.tipo === "crear" ? 2 : 1;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-2 sm:p-3" role="dialog" aria-modal="true" aria-label="Publicación del combo">
      <div className="flex h-[94vh] w-full max-w-[1300px] flex-col overflow-hidden rounded-xl border border-border bg-surface-panel shadow-xl">
        {/* Cabecera: de qué combo es y en qué caso está */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">Publicación · para {nombre} <span className="normal-case">({skuCombo})</span></p>
            <p className="text-[12px] text-ink">
              {estado.isLoading ? (
                <span className="text-muted">Buscando {sku} en la vitrina…</span>
              ) : item ? (
                <>✓ <b>Está en la vitrina</b>{item.meli_id ? <> · MeLi <code>{item.meli_id}</code></> : null}. Revisa fotos, título, precio y que esté visible.</>
              ) : (
                <>
                  <b>No aparece en la vitrina web.</b> La tienda solo muestra combos con <b>publicación en Mercado Libre</b> y no hay ninguna con el SKU <code>{sku}</code>.
                </>
              )}
            </p>
          </div>
          <button onClick={onCerrar} aria-label="Cerrar" className="shrink-0 rounded-md border border-border px-3 py-1 text-[12px] font-semibold text-ink hover:bg-surface-hover">
            Cerrar · volver al combo
          </button>
        </div>

        <PngAprobadosFranja e={etiqueta} />

        {/* Pasos cuando no está publicado */}
        {!estado.isLoading && !item && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2 text-[12px]">
            {[
              { n: 1, t: "¿Existe con otro SKU?", ir: () => setVista({ tipo: "buscar" }) },
              { n: 2, t: "Crear la publicación", ir: () => setVista({ tipo: "crear" }) },
              { n: 3, t: "Actualizar la vitrina", ir: () => refrescar.mutate() },
            ].map((p, i) => (
              <div key={p.n} className="flex items-center gap-2">
                {i > 0 && <span className="text-muted">→</span>}
                <button
                  onClick={p.ir}
                  disabled={p.n === 3 && refrescar.isPending}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-semibold ${paso === p.n ? "border-accent bg-accent text-white" : "border-border bg-surface-input text-ink hover:border-accent/60"}`}
                >
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full font-mono text-[10.5px] ${paso === p.n ? "bg-white/25" : "bg-accent/15 text-accent"}`}>{p.n}</span>
                  {p.n === 3 && refrescar.isPending ? "Actualizando… (hasta un minuto)" : p.t}
                </button>
              </div>
            ))}
            {refrescar.isSuccess && !item && <span className="text-accent-rose">Aún no aparece: la publicación en MeLi debe tener el SKU {sku}.</span>}
            {refrescar.isError && <span className="text-accent-rose">{(refrescar.error as Error).message}</span>}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto bg-surface p-3">
          <Suspense fallback={<p className="p-6 text-sm text-muted">Abriendo…</p>}>
            {estado.isLoading ? null : v.tipo === "editar" ? (
              <div className="space-y-2">
                {v.sku.toUpperCase() !== sku && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent-sun/60 bg-accent-sun/10 px-3 py-2 text-[12px] text-ink">
                    Estás viendo <code>{v.sku}</code>, no el combo <code>{sku}</code>. Si es el mismo producto, su SKU en MeLi debe ser <code>{sku}</code>.
                    <button className={BTN_SEC} onClick={() => setVista({ tipo: "buscar" })}>← Volver a la búsqueda</button>
                  </div>
                )}
                <EditorPanel sku={v.sku} onClose={() => setVista(null)} />
              </div>
            ) : v.tipo === "crear" ? (
              <CrearDesdeCeroPanel
                inicial={{ nombre: base, sku: skuCombo, presentacion, precio: precioLista ?? undefined }}
                onDone={() => setVista({ tipo: "guia" })}
              />
            ) : v.tipo === "buscar" ? (
              <div className="mx-auto max-w-3xl space-y-2">
                <p className="text-[13px] font-bold text-ink">Productos parecidos a «{base}» en la vitrina</p>
                <p className="text-[12px] text-muted">
                  Si alguno es este mismo producto con otro SKU, ábrelo y corrige el SKU en MeLi. Si ninguno lo es, créalo.
                </p>
                {porNombre.isLoading && <p className="text-[12px] text-muted">Buscando…</p>}
                {porNombre.data && porNombre.data.items.length === 0 && (
                  <p className="rounded-md border border-border bg-surface-panel px-3 py-2 text-[12px] text-ink">No hay nada parecido publicado.</p>
                )}
                <ul className="space-y-1.5">
                  {(porNombre.data?.items ?? []).map((i) => (
                    <li key={i.sku} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-panel px-3 py-2">
                      {i.foto_efectiva && <img src={i.foto_efectiva} alt="" className="h-10 w-10 rounded object-cover" />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-bold text-ink">{i.nombre}</p>
                        <p className="font-mono text-[10.5px] text-muted">
                          {i.sku}{i.meli_id ? ` · ${i.meli_id}` : ""}{(i.presentaciones ?? []).length > 1 ? ` · ${(i.presentaciones ?? []).map((p) => p.presentacion_label || p.sku).join(" / ")}` : ""}
                        </p>
                      </div>
                      <button className={BTN_SEC} onClick={() => setVista({ tipo: "editar", sku: i.sku })}>Abrir aquí</button>
                    </li>
                  ))}
                </ul>
                <div className="pt-1">
                  <button className={BTN} onClick={() => setVista({ tipo: "crear" })}>Ninguno es este: crear la publicación →</button>
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-2xl space-y-3 py-4">
                <p className="text-[14px] font-bold text-ink">¿Qué hacer?</p>
                <ol className="list-decimal space-y-2 pl-5 text-[13px] text-ink">
                  <li>Revisa si el producto <b>ya está en MeLi con otro SKU</b> (otra presentación o un SKU viejo). Si está, corrige su SKU a <code>{sku}</code>.</li>
                  <li>Si no existe, <b>crea la publicación</b>: el formulario abre con el nombre, el SKU, la presentación{precioLista ? " y el precio" : ""} ya escritos.</li>
                  <li>Con la publicación en MeLi, <b>actualiza la vitrina</b>: la tienda la toma y la pieza del taller se enciende.</li>
                </ol>
                <div className="flex flex-wrap gap-2">
                  <button className={BTN_SEC} onClick={() => setVista({ tipo: "buscar" })}>1 · Buscar «{base}»</button>
                  <button className={BTN} onClick={() => setVista({ tipo: "crear" })}>2 · Crear la publicación →</button>
                  <button className={BTN_SEC} disabled={refrescar.isPending} onClick={() => refrescar.mutate()}>
                    {refrescar.isPending ? "Actualizando…" : "3 · Ya la creé: actualizar la vitrina"}
                  </button>
                </div>
              </div>
            )}
          </Suspense>
        </div>
      </div>
    </div>,
    document.body,
  );
}
