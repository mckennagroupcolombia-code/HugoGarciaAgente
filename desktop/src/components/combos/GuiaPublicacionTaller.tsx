import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../../api/client";
import type { ListaPublicaciones } from "../../hooks/usePublicaciones";
import { useAppStore } from "../../stores/app";

/**
 * Guía de Publicaciones cuando se llega desde el taller de combos por la pieza «Publicación».
 *
 * Antes el salto caía en el catálogo buscando el SKU: si el combo no estaba en la vitrina, la lista
 * decía «Sin resultados» y el detalle «Error cargando producto» — un callejón. La regla que lo
 * explica: la tienda web SOLO muestra combos que tienen publicación en MeLi (website.py
 * `_filtrar_combos_publicados_meli`). Así que «no aparece en la vitrina» casi siempre es «no hay
 * publicación MeLi con ese SKU», y el camino es: ¿existe con otro SKU? → si no, crearla → actualizar
 * la vitrina → volver al combo. Esta tarjeta verifica el caso real y marca el paso en que se está.
 */

/** «ACEITE DE COCO 250mL» → { base: "ACEITE DE COCO", presentacion: "250mL" }. */
export function partirPresentacion(nombre: string): { base: string; presentacion: string } {
  const m = nombre.trim().match(/^(.*?)\s*(\d+(?:[.,]\d+)?\s*(?:g|gr|kg|ml|l|lt|un|und))$/i);
  return m ? { base: m[1].trim(), presentacion: m[2].replace(/\s+/g, "") } : { base: nombre.trim(), presentacion: "" };
}

const BTN = "rounded-md border border-accent bg-accent px-3 py-1.5 text-[12px] font-bold text-white hover:opacity-90 disabled:opacity-50";
const BTN_SEC = "rounded-md border border-border bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink hover:border-accent disabled:opacity-50";

function Paso({ n, estado, titulo, children }: { n: number; estado: "hecho" | "actual" | "luego"; titulo: string; children?: React.ReactNode }) {
  const circulo =
    estado === "hecho" ? "bg-emerald-600 text-white" : estado === "actual" ? "bg-accent text-white" : "bg-surface-hover text-muted";
  return (
    <li className={`flex gap-2.5 rounded-lg px-2 py-2 ${estado === "actual" ? "bg-accent/5 ring-1 ring-accent/40" : ""}`}>
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold ${circulo}`}>
        {estado === "hecho" ? "✓" : n}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-[13px] font-bold ${estado === "luego" ? "text-muted" : "text-ink"}`}>{titulo}</p>
        {estado === "actual" && children}
      </div>
    </li>
  );
}

export default function GuiaPublicacionTaller({
  vista,
  onBuscar,
  onCrear,
  onAbrir,
  onNoEsta,
}: {
  vista: string;
  /** Buscar un texto en el listado del catálogo. */
  onBuscar: (q: string) => void;
  /** Ir a «Crear desde cero» con el combo cargado. */
  onCrear: () => void;
  /** Abrir la publicación encontrada en el editor. */
  onAbrir: (sku: string) => void;
  /** El SKU no está en la vitrina: el editor no tiene qué abrir. */
  onNoEsta: () => void;
}) {
  const qc = useQueryClient();
  const retorno = useAppStore((st) => st.tallerRetorno);
  const volver = useAppStore((st) => st.volverAlTaller);
  const sku = (retorno?.ref || "").toUpperCase();
  const activa = Boolean(retorno && retorno.pieza?.clave === "publicacion");

  const q = useQuery({
    queryKey: ["publicaciones", sku, "", ""],
    queryFn: () => api.get<ListaPublicaciones>(`/api/publicaciones?buscar=${encodeURIComponent(sku)}`),
    enabled: activa && Boolean(sku),
    staleTime: 30_000,
  });
  const item = (q.data?.items ?? []).find(
    (i) => i.sku.toUpperCase() === sku || (i.presentaciones ?? []).some((p) => (p.sku || "").toUpperCase() === sku),
  );
  const enVitrina = Boolean(item);

  useEffect(() => {
    if (activa && q.isSuccess && !enVitrina) onNoEsta();
  }, [activa, q.isSuccess, enVitrina, onNoEsta]);

  const refrescar = useMutation({
    mutationFn: () => api.post<Record<string, unknown>>("/api/publicaciones/refresh-web", {}, { timeoutMs: 180_000 }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["publicaciones"] });
      await api.post("/api/mapa-sistema/invalidar").catch(() => null);
      await qc.invalidateQueries({ queryKey: ["mapa-sistema-combos"] });
    },
  });

  if (!activa || !retorno) return null;
  const { base } = partirPresentacion(retorno.nombre);

  // Qué paso toca: con la publicación en la vitrina solo queda revisarla; sin ella, crearla y refrescar.
  const pasoActual = q.isLoading ? 0 : enVitrina ? 3 : vista === "crear" ? 2 : 1;
  const est = (n: number): "hecho" | "actual" | "luego" => (enVitrina && n < 3 ? "hecho" : n === pasoActual ? "actual" : n < pasoActual ? "hecho" : "luego");

  return (
    <section className="shrink-0 rounded-xl border border-accent/50 bg-surface-panel p-3 shadow-paper-sm" aria-label="Guía para publicar este combo">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="font-mono text-[10.5px] font-bold uppercase tracking-wide text-muted">Desde el taller · publicación</p>
        <p className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink">
          {retorno.nombre} <code className="font-normal text-muted">{retorno.ref}</code>
        </p>
        <button type="button" onClick={volver} className={BTN_SEC}>← Volver al combo</button>
      </div>

      {q.isLoading ? (
        <p className="mt-2 text-[12px] text-muted">Buscando {sku} en la vitrina…</p>
      ) : (
        <>
          <p className="mt-2 rounded-md border border-border bg-surface px-3 py-2 text-[12px] text-ink">
            {enVitrina ? (
              <>✓ <b>Está en la vitrina</b>{item?.meli_id ? <> con la publicación MeLi <code>{item.meli_id}</code></> : null}. Solo queda revisarla.</>
            ) : (
              <>
                <b>No aparece en la vitrina web.</b> La tienda solo muestra los combos que tienen <b>publicación en Mercado Libre</b>, y no se
                encontró ninguna con el SKU <code>{sku}</code>.
              </>
            )}
          </p>
          <ol className="mt-2 space-y-1">
            {!enVitrina && (<>
            <Paso n={1} estado={est(1)} titulo="¿Ya existe en Mercado Libre con otro nombre o SKU?">
              <p className="mt-0.5 text-[12px] text-muted">
                Busca el producto por nombre. Si aparece otra presentación o la misma con otro SKU, ábrela y revisa que en MeLi su SKU
                (<i>seller_custom_field</i>) sea exactamente <code>{sku}</code>.
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <button type="button" className={BTN_SEC} onClick={() => onBuscar(base)}>Buscar «{base}» en el catálogo</button>
                <button type="button" className={BTN} onClick={onCrear}>No existe: crearla →</button>
              </div>
            </Paso>
            <Paso n={2} estado={est(2)} titulo="Crear la publicación en Mercado Libre">
              <p className="mt-0.5 text-[12px] text-muted">
                {vista === "crear"
                  ? <>El formulario de abajo ya tiene el nombre, el SKU, la presentación{retorno.precioLista ? " y el precio de lista" : ""}. Genera el contenido, revísalo y publica.</>
                  : <>Se abre el formulario con el combo ya escrito.</>}
              </p>
              {vista !== "crear" && <button type="button" className={`${BTN} mt-1.5`} onClick={onCrear}>Crear con este combo →</button>}
            </Paso>
            </>)}
            <Paso n={enVitrina ? 1 : 3} estado={est(3)} titulo={enVitrina ? "Revisar la publicación" : "Actualizar la vitrina web"}>
              {enVitrina ? (
                <>
                  <p className="mt-0.5 text-[12px] text-muted">Fotos (web y MeLi van por separado), título, precio y que esté visible en la web. Luego vuelve al combo.</p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {item && <button type="button" className={BTN_SEC} onClick={() => onAbrir(item.sku)}>Abrir la publicación</button>}
                    <button type="button" className={BTN} onClick={volver}>Listo · volver al combo</button>
                  </div>
                </>
              ) : (
                <>
                  <p className="mt-0.5 text-[12px] text-muted">
                    Cuando la publicación exista en MeLi con el SKU <code>{sku}</code>, actualiza la vitrina para que la tienda la tome.
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <button type="button" className={BTN_SEC} disabled={refrescar.isPending} onClick={() => refrescar.mutate()}>
                      {refrescar.isPending ? "Actualizando… (puede tardar un minuto)" : "Actualizar la vitrina y comprobar"}
                    </button>
                    {refrescar.isSuccess && !enVitrina && (
                      <span className="text-[12px] text-accent-rose">Aún no aparece: revisa que la publicación en MeLi tenga el SKU {sku}.</span>
                    )}
                    {refrescar.isError && <span className="text-[12px] text-accent-rose">{(refrescar.error as Error).message}</span>}
                  </div>
                </>
              )}
            </Paso>
          </ol>
        </>
      )}
    </section>
  );
}
