/**
 * Pestaña "Etiquetas para publicaciones" de Studio: las versiones desenfocadas
 * que genera la casilla "Desenfoque" de la ficha de etiqueta. Viven en
 * PUBLICACIONES DIGITALES/<Categoría>/, fuera de la carpeta de impresión, y
 * son la base para publicaciones digitales con restricciones sobre los datos
 * impresos (teléfono, web, empresa…).
 */
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useCategoriasEtiqueta, CATEGORIAS_ETIQUETA } from "../../lib/categoriasEtiqueta";
import {
  LightboxImagen,
  MiniaturaRecursoPng,
  codificarRutaRecursoPng,
  labelFormatoPng,
} from "../etiquetas/RecursoPngViewer";
import { resolverUrlImagenCanvas } from "../../lib/plantillasVisualesImagen";
import { descargarBlob } from "../../lib/etiquetaAssets";
import {
  CARPETA_PUBLICACIONES_DIGITALES,
  categoriaDeRutaEtiqueta,
  coincideBusqueda,
  normalizarBusqueda,
  useEtiquetasPublicaciones,
  type EtiquetaStudioPng,
} from "./studioEtiquetasData";
import { nombreVisibleEtiqueta } from "./StudioCategoriasPanel";

const SIN_CATEGORIA = "__sin_categoria__";

export default function StudioPublicacionesPanel({
  buscar = "",
}: {
  /** Texto del buscador de Studio (la barra vive en el encabezado). */
  buscar?: string;
} = {}) {
  const qc = useQueryClient();
  const { data: cats } = useCategoriasEtiqueta();
  const categorias = Array.isArray(cats) ? cats : CATEGORIAS_ETIQUETA;
  const { data: etiquetas, isLoading, isError } = useEtiquetasPublicaciones();
  const [vistaPrevia, setVistaPrevia] = useState<string | null>(null);
  const [descargando, setDescargando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function descargar(nombre: string) {
    setDescargando(true);
    try {
      const url = await resolverUrlImagenCanvas(
        `/api/etiquetas/recursos-png/archivo/${codificarRutaRecursoPng(nombre)}`,
      );
      const res = await fetch(url);
      descargarBlob(await res.blob(), nombre.split("/").pop() || nombre);
    } finally {
      setDescargando(false);
    }
  }

  const eliminarMut = useMutation({
    mutationFn: (nombre: string) =>
      api.delete<{ ok: boolean }>(
        `/api/etiquetas/recursos-png/${nombre.split("/").map(encodeURIComponent).join("%2F")}`,
      ),
    onSuccess: (_r, nombre) => {
      setVistaPrevia(null);
      setMsg(`«${nombreVisibleEtiqueta(nombre)}» eliminada.`);
      setTimeout(() => setMsg(null), 4000);
    },
    onError: (e: Error) => setMsg(e.message || "No se pudo eliminar"),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["etiquetas-recursos-png"] });
    },
  });

  // Agrupadas por la subcarpeta de categoría en la que las dejó la ficha
  // (PUBLICACIONES DIGITALES/<Categoría>/…). Lo que quede suelto en la raíz
  // va a un grupo aparte, no se esconde.
  const grupos = useMemo(() => {
    const q = normalizarBusqueda(buscar);
    const porCategoria = new Map<string, EtiquetaStudioPng[]>();
    for (const e of Array.isArray(etiquetas) ? etiquetas : []) {
      const visible = nombreVisibleEtiqueta(e.nombre);
      if (!coincideBusqueda(visible, q)) continue;
      const cat = categoriaDeRutaEtiqueta(e.nombre, categorias, CARPETA_PUBLICACIONES_DIGITALES) ?? SIN_CATEGORIA;
      const lista = porCategoria.get(cat) ?? [];
      lista.push(e);
      porCategoria.set(cat, lista);
    }
    const out = categorias
      .map((c) => ({ id: c.id, titulo: c.etiqueta, items: porCategoria.get(c.id) ?? [] }))
      .filter((g) => g.items.length > 0);
    const sueltas = porCategoria.get(SIN_CATEGORIA) ?? [];
    if (sueltas.length) out.push({ id: SIN_CATEGORIA, titulo: "Sin categoría", items: sueltas });
    return out;
  }, [etiquetas, categorias, buscar]);

  const total = grupos.reduce((n, g) => n + g.items.length, 0);
  const lista = Array.isArray(etiquetas) ? etiquetas : [];

  return (
    <div>
      <p className="mb-3 text-xs text-muted">
        Versiones con los datos desenfocados, para publicaciones digitales con restricciones.
        Se generan desde la ficha de etiqueta con la casilla «Desenfoque» y se guardan en{" "}
        <span className="font-semibold text-ink">{CARPETA_PUBLICACIONES_DIGITALES}</span>, fuera
        de la carpeta de impresión: no aparecen en Diseño → Imprimir.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">
          {total} etiqueta{total === 1 ? "" : "s"}
        </span>
        {msg && <span className="text-xs text-accent">{msg}</span>}
      </div>

      {isLoading && <p className="py-10 text-center text-sm text-muted">Cargando etiquetas…</p>}
      {isError && (
        <p className="py-10 text-center text-sm text-red-600">No se pudo cargar la galería.</p>
      )}

      {!isLoading && !isError && lista.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-surface-panel px-8 py-14 text-center">
          <p className="text-sm font-medium text-ink">Todavía no hay etiquetas para publicaciones</p>
          <p className="mt-1 text-sm text-muted">
            En la ficha de etiqueta marca la casilla «Desenfoque», guarda el PNG para imprimir y,
            en la ventana que se abre, marca por recuadro los datos a ocultar. La copia desenfocada
            aparece aquí.
          </p>
        </div>
      )}

      {!isLoading && lista.length > 0 && grupos.length === 0 && (
        <p className="py-10 text-center text-sm text-muted">Ninguna etiqueta coincide con «{buscar.trim()}».</p>
      )}

      <div className="space-y-6">
        {grupos.map((g) => (
          <section key={g.id}>
            <h3 className="mb-2 flex items-baseline gap-2 text-sm font-bold text-ink">
              {g.titulo}
              <span className="text-[11px] font-normal text-muted">{g.items.length}</span>
            </h3>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
              {g.items.map((r) => (
                <button
                  key={r.nombre}
                  type="button"
                  onClick={() => setVistaPrevia(r.nombre)}
                  title={r.nombre}
                  className="group flex flex-col overflow-hidden rounded-lg border border-border bg-surface text-left hover:border-accent/50"
                >
                  <span className="flex aspect-square items-center justify-center bg-zinc-100 p-1 dark:bg-zinc-800/40">
                    <MiniaturaRecursoPng nombre={r.nombre} thumbB64={r.thumb_b64} thumbMime={r.thumb_mime} />
                  </span>
                  <span className="block px-1.5 py-1">
                    <span className="block truncate text-[10px] text-ink">{nombreVisibleEtiqueta(r.nombre)}</span>
                    {labelFormatoPng(r) ? (
                      <span className="block truncate text-[9px] text-muted">{labelFormatoPng(r)}</span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      {vistaPrevia && (
        <LightboxImagen
          nombre={vistaPrevia}
          formato={lista.find((e) => e.nombre === vistaPrevia) ?? null}
          onCerrar={() => setVistaPrevia(null)}
          onDescargar={() => void descargar(vistaPrevia)}
          onEliminar={() => eliminarMut.mutate(vistaPrevia)}
          descargando={descargando}
          eliminando={eliminarMut.isPending}
        />
      )}
    </div>
  );
}
