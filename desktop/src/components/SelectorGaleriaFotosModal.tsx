import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { resolverUrlImagenCanvas } from "../lib/plantillasVisualesImagen";
import {
  useGaleriaPublicaciones,
  type GaleriaImagen,
} from "../hooks/usePublicaciones";

type Destino = "web" | "meli";
type Fuente = "catalogo" | "recursos";

interface RecursoPng {
  nombre: string;
  thumb_b64?: string | null;
}

function srcCatalogo(filename: string): string {
  return `/api/publicaciones/imagen-archivo/${encodeURIComponent(filename).replace(/%2F/gi, "")}`;
}

function recursoRelativo(carpeta: string, nombre: string): string {
  const n = (nombre || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (n.includes("/")) return n;
  return carpeta ? `${carpeta.replace(/\/$/, "")}/${n}` : n;
}

function MiniaturaRecurso({
  src,
  thumbB64,
  alt,
}: {
  src: string;
  thumbB64?: string | null;
  alt: string;
}) {
  const [resolved, setResolved] = useState<string | null>(
    thumbB64 ? `data:image/png;base64,${thumbB64}` : null,
  );
  useEffect(() => {
    if (thumbB64) {
      setResolved(`data:image/png;base64,${thumbB64}`);
      return;
    }
    let alive = true;
    void resolverUrlImagenCanvas(src)
      .then((u) => {
        if (alive) setResolved(u);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [src, thumbB64]);
  if (!resolved) {
    return <div className="h-full w-full animate-pulse bg-surface-hover" />;
  }
  return <img src={resolved} alt={alt} className="h-full w-full object-contain" draggable={false} />;
}

export default function SelectorGaleriaFotosModal({
  abierta,
  destino,
  skuActual,
  pending = false,
  fotosWeb = [],
  fotosMeli = [],
  onCerrar,
  onConfirmar,
  onSubirArchivos,
}: {
  abierta: boolean;
  destino: Destino;
  skuActual: string;
  pending?: boolean;
  fotosWeb?: { filename: string; url: string }[];
  fotosMeli?: { id: string; url: string }[];
  onCerrar: () => void;
  onConfirmar: (sel: {
    filenames: string[];
    recursos: string[];
    meli: { id: string; url: string }[];
  }) => Promise<void>;
  onSubirArchivos: (files: File[]) => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fuente, setFuente] = useState<Fuente>("catalogo");
  const [buscar, setBuscar] = useState("");
  const [q, setQ] = useState("");
  const [carpeta, setCarpeta] = useState("");
  const [selCat, setSelCat] = useState<Set<string>>(new Set());
  const [selRec, setSelRec] = useState<Set<string>>(new Set());
  const [errorLocal, setErrorLocal] = useState("");

  const { data, isLoading, isError, error } = useGaleriaPublicaciones(q);
  const [verCatalogoCompleto, setVerCatalogoCompleto] = useState(false);
  const [selMeli, setSelMeli] = useState<Set<string>>(new Set());
  const { data: recData, isLoading: recLoading } = useQuery({
    queryKey: ["etiquetas-recursos-png", carpeta],
    queryFn: () =>
      api.get<{ recursos: RecursoPng[]; carpetas: string[]; carpeta_actual?: string }>(
        `/api/etiquetas/recursos-png?carpeta=${encodeURIComponent(carpeta)}`,
      ),
    enabled: abierta && fuente === "recursos",
    staleTime: 15_000,
  });

  useEffect(() => {
    if (!abierta) {
      setSelCat(new Set());
      setSelRec(new Set());
      setSelMeli(new Set());
      setBuscar("");
      setQ("");
      setCarpeta("");
      setFuente("catalogo");
      setErrorLocal("");
      setVerCatalogoCompleto(false);
    }
  }, [abierta]);

  const tarjetas = useMemo(() => {
    const items = data?.items ?? [];
    const flat: { sku: string; nombre: string; img: GaleriaImagen }[] = [];
    for (const it of items) {
      for (const img of it.imagenes) {
        flat.push({ sku: it.sku, nombre: it.nombre, img });
      }
    }
    const sku = skuActual.toUpperCase();
    flat.sort((a, b) => {
      const aMine = a.sku.toUpperCase() === sku ? 0 : 1;
      const bMine = b.sku.toUpperCase() === sku ? 0 : 1;
      if (aMine !== bMine) return aMine - bMine;
      return a.sku.localeCompare(b.sku, "es");
    });
    return flat;
  }, [data, skuActual]);

  const catalogoVisible = useMemo(() => {
    if (q || verCatalogoCompleto) return tarjetas;
    const sku = skuActual.toUpperCase();
    return tarjetas.filter((t) => t.sku.toUpperCase() === sku);
  }, [tarjetas, q, verCatalogoCompleto, skuActual]);

  const nSel = selCat.size + selRec.size + selMeli.size;
  const labelDestino = destino === "web" ? "la web" : "MeLi";

  function toggle(set: Set<string>, key: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  }

  async function confirmar() {
    if (!nSel) return;
    setErrorLocal("");
    try {
      await onConfirmar({
        filenames: Array.from(selCat),
        recursos: Array.from(selRec),
        meli: fotosMeli.filter((p) => selMeli.has(p.id)),
      });
    } catch (e) {
      setErrorLocal(e instanceof Error ? e.message : "No se pudieron agregar las fotos");
    }
  }

  if (!abierta) return null;

  const segmentos = carpeta ? carpeta.split("/").filter(Boolean) : [];

  return createPortal(
    <div
      className="fixed inset-0 z-[600] flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
      onClick={onCerrar}
    >
      <div
        className="flex max-h-[min(92vh,760px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-surface-panel shadow-paper-lg"
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const dropped = e.dataTransfer.files;
          if (dropped?.length) void onSubirArchivos(Array.from(dropped));
        }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h3 className="font-bold text-ink">Agregar fotos a {labelDestino}</h3>
            <p className="mt-0.5 text-xs text-muted">
              Elige imágenes de la galería o súbelas desde el computador. SKU {skuActual}.
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-lg border border-border px-2 py-1 text-sm text-muted hover:bg-surface-hover"
          >
            ✕
          </button>
        </div>

        <div className="flex gap-1 border-b border-border px-4 py-2">
          <button
            type="button"
            onClick={() => setFuente("catalogo")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              fuente === "catalogo" ? "bg-accent text-white" : "text-muted hover:bg-surface-hover"
            }`}
          >
            Catálogo
          </button>
          <button
            type="button"
            onClick={() => setFuente("recursos")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              fuente === "recursos" ? "bg-accent text-white" : "text-muted hover:bg-surface-hover"
            }`}
          >
            Galería McKenna
          </button>
        </div>

        {fuente === "catalogo" && (
          <form
            className="flex gap-2 border-b border-border px-4 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              setQ(buscar.trim());
            }}
          >
            <input
              type="text"
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
              placeholder="Filtrar por SKU o nombre…"
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface-input px-3 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
            <button
              type="submit"
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white"
            >
              Buscar
            </button>
          </form>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {fuente === "catalogo" && (
            <>
              {(fotosWeb.length > 0 || fotosMeli.length > 0) && (
                <div className="mb-4 space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-muted">
                    Fotos de este producto
                  </p>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                    {destino === "meli" &&
                      fotosWeb.map((img) => {
                        const sel = selCat.has(img.filename);
                        return (
                          <button
                            key={`web-${img.filename}`}
                            type="button"
                            title="Foto web"
                            onClick={() => toggle(selCat, img.filename, setSelCat)}
                            className={`relative overflow-hidden rounded-lg border-2 ${
                              sel ? "border-accent ring-2 ring-accent/30" : "border-green-300"
                            }`}
                          >
                            <div className="aspect-square bg-white">
                              <img src={img.url} alt="" className="h-full w-full object-contain p-1" />
                            </div>
                            <span className="absolute left-1 top-1 rounded bg-green-700/90 px-1 py-0.5 text-[9px] font-bold text-white">
                              Web
                            </span>
                            {sel && (
                              <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white">
                                ✓
                              </span>
                            )}
                          </button>
                        );
                      })}
                    {destino === "web" &&
                      fotosMeli.map((img) => {
                        const sel = selMeli.has(img.id);
                        return (
                          <button
                            key={`meli-${img.id}`}
                            type="button"
                            title="Foto MeLi"
                            onClick={() => toggle(selMeli, img.id, setSelMeli)}
                            className={`relative overflow-hidden rounded-lg border-2 ${
                              sel ? "border-accent ring-2 ring-accent/30" : "border-blue-300"
                            }`}
                          >
                            <div className="aspect-square bg-white">
                              <img src={img.url} alt="" className="h-full w-full object-contain p-1" />
                            </div>
                            <span className="absolute left-1 top-1 rounded bg-blue-700/90 px-1 py-0.5 text-[9px] font-bold text-white">
                              MeLi
                            </span>
                            {sel && (
                              <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white">
                                ✓
                              </span>
                            )}
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}
              {isLoading && <p className="text-sm text-muted">Cargando galería…</p>}
              {isError && (
                <p className="text-sm text-danger">
                  {error instanceof Error ? error.message : "No se pudo cargar la galería"}
                </p>
              )}
              {!isLoading && !isError && catalogoVisible.length === 0 && tarjetas.length === 0 && (
                <p className="text-sm text-muted">
                  No hay fotos de catálogo. Usa «Cargar desde el computador» o elige una de MeLi arriba.
                </p>
              )}
              {catalogoVisible.length > 0 && (
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted">
                  Galería catálogo
                </p>
              )}
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                {catalogoVisible.map(({ sku, nombre, img }) => {
                  const key = img.filename;
                  const sel = selCat.has(key);
                  const mio = sku.toUpperCase() === skuActual.toUpperCase();
                  return (
                    <button
                      key={`${sku}-${key}`}
                      type="button"
                      title={`${sku} · ${nombre}`}
                      onClick={() => toggle(selCat, key, setSelCat)}
                      className={`relative flex flex-col overflow-hidden rounded-lg border-2 text-left ${
                        sel ? "border-accent ring-2 ring-accent/30" : "border-border hover:border-accent/50"
                      }`}
                    >
                      <div className="aspect-square bg-white">
                        <img
                          src={srcCatalogo(img.filename)}
                          alt={img.filename}
                          className="h-full w-full object-contain p-1"
                          loading="lazy"
                        />
                      </div>
                      <span className="truncate px-1.5 py-1 font-mono text-[10px] font-bold text-ink">
                        {sku}
                      </span>
                      {mio && (
                        <span className="absolute left-1 top-1 rounded bg-accent/90 px-1 py-0.5 text-[9px] font-bold text-white">
                          Este SKU
                        </span>
                      )}
                      {sel && (
                        <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white">
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {!q && !verCatalogoCompleto && tarjetas.length > catalogoVisible.length && (
                <button
                  type="button"
                  onClick={() => setVerCatalogoCompleto(true)}
                  className="mt-3 w-full rounded-lg border border-border py-2 text-xs font-semibold text-ink hover:bg-surface-hover"
                >
                  Ver las {tarjetas.length} fotos del catálogo
                </button>
              )}
            </>
          )}

          {fuente === "recursos" && (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => setCarpeta("")}
                  className={`rounded px-2 py-0.5 ${carpeta ? "text-accent underline" : "font-semibold text-ink"}`}
                >
                  Raíz
                </button>
                {segmentos.map((seg, i) => {
                  const rel = segmentos.slice(0, i + 1).join("/");
                  return (
                    <span key={rel} className="flex items-center gap-1">
                      <span className="text-muted">/</span>
                      <button
                        type="button"
                        onClick={() => setCarpeta(rel)}
                        className={`rounded px-1 py-0.5 ${
                          i === segmentos.length - 1 ? "font-semibold text-ink" : "text-accent underline"
                        }`}
                      >
                        {seg}
                      </button>
                    </span>
                  );
                })}
              </div>
              {recLoading && <p className="text-sm text-muted">Cargando galería McKenna…</p>}
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                {(recData?.carpetas ?? []).map((name) => {
                  const rel = carpeta ? `${carpeta}/${name}` : name;
                  return (
                    <button
                      key={rel}
                      type="button"
                      onClick={() => setCarpeta(rel)}
                      className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border bg-surface hover:border-accent"
                    >
                      <span className="text-3xl">📁</span>
                      <span className="w-full truncate px-1 text-[10px] text-ink">{name}</span>
                    </button>
                  );
                })}
                {(recData?.recursos ?? []).map((r) => {
                  const key = recursoRelativo(carpeta, r.nombre);
                  const sel = selRec.has(key);
                  const src = `/api/etiquetas/recursos-png/archivo/${encodeURIComponent(key)}`;
                  return (
                    <button
                      key={key}
                      type="button"
                      title={r.nombre}
                      onClick={() => toggle(selRec, key, setSelRec)}
                      className={`relative flex flex-col overflow-hidden rounded-lg border-2 text-left ${
                        sel ? "border-accent ring-2 ring-accent/30" : "border-border hover:border-accent/50"
                      }`}
                    >
                      <div className="aspect-square bg-white">
                        <MiniaturaRecurso src={src} thumbB64={r.thumb_b64} alt={r.nombre} />
                      </div>
                      <span className="truncate px-1.5 py-1 text-[10px] text-muted">{r.nombre}</span>
                      {sel && (
                        <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white">
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {!recLoading && !(recData?.recursos?.length || recData?.carpetas?.length) && (
                <p className="text-sm text-muted">No hay imágenes en esta carpeta.</p>
              )}
            </>
          )}
        </div>

        {errorLocal && (
          <p className="px-4 pb-2 text-xs text-danger">{errorLocal}</p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                if (files?.length) void onSubirArchivos(Array.from(files));
                if (fileRef.current) fileRef.current.value = "";
              }}
            />
            <button
              type="button"
              disabled={pending}
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-dashed border-accent px-3 py-2 text-xs font-semibold text-ink hover:bg-accent/5 disabled:opacity-40"
            >
              Cargar desde el computador
            </button>
            <span className="text-[11px] text-muted">
              {nSel ? `${nSel} seleccionada(s)` : "Ninguna seleccionada"}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCerrar}
              className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={!nSel || pending}
              onClick={() => void confirmar()}
              className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
            >
              {pending ? "Agregando…" : `Agregar ${nSel} a ${labelDestino}`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
