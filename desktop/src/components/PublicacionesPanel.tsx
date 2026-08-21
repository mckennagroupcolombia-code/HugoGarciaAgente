import { useState, useEffect, useRef, useCallback } from "react";
import MeliComplianceTab, { CrearDesdeCeroPanel } from "./MeliComplianceTab";
import CompetenciaPreciosPanel from "./CompetenciaPreciosPanel";
import { HUB_TAB_LABEL, hubTabClass } from "../lib/hubTabClass";
import { Icon } from "../icons/Icon";
import {
  usePublicaciones,
  usePublicacionDetalle,
  useGuardarPublicacion,
  useSyncWeb,
  useFotosActuales,
  useSubirImagen,
  useReordenarImagenesWeb,
  useReordenarImagenesMeli,
  useEliminarImagenes,
  useCopiarImagenSitio,
  useGaleriaPublicaciones,
  useNormalizarImagenesCatalogo,
  usePreciosCanales,
  useEstadoMeli,
  usePrecioMeli,
  type PublicacionItem,
  type PublicacionDetalle,
  type SyncStatus,
  type VistaSitios,
  type PresentacionSitio,
} from "../hooks/usePublicaciones";

// ── URLs de imagen del catálogo (panel) ────────────────────────────────────
// /imagenes-productos-catalogo/* no se proxifica en Vite (:5173) ni en el
// túnel bot (:8080 → 8081). La ruta /api/publicaciones/imagen-archivo/* sí.

function srcImagenCatalogoPanel(filenameOrPath: string): string {
  let filename = (filenameOrPath || "").trim();
  if (!filename) return "";
  if (filename.startsWith("http://") || filename.startsWith("https://")) {
    try {
      filename = decodeURIComponent(new URL(filename).pathname.split("/").pop() || "");
    } catch {
      filename = decodeURIComponent(filename.split("/").pop() || filename);
    }
  } else if (filename.includes("/")) {
    filename = decodeURIComponent(filename.split("/").pop() || filename);
  }
  if (!filename) return "";
  return `/api/publicaciones/imagen-archivo/${encodeURIComponent(filename).replace(/%2F/gi, "")}`;
}

function resolverFotoPreview(foto: string): string {
  if (!foto) return "";
  if (foto.startsWith("data:")) return foto;
  if (
    foto.includes("/imagenes-productos-catalogo/") ||
    (!foto.startsWith("http://") && !foto.startsWith("https://") && !foto.startsWith("//"))
  ) {
    return srcImagenCatalogoPanel(foto);
  }
  return foto;
}

// ── Badge de estado de sincronización ──────────────────────────────────────

function SyncBadge({
  status,
  label,
  compact = false,
}: {
  status: SyncStatus;
  label: string;
  compact?: boolean;
}) {
  const isOk = status.status === "ok" || status.status === "linked";
  const isWarn = status.status === "incomplete";
  const isNone = status.status === "no_listing";

  const dot = isOk
    ? "bg-green-500"
    : isWarn
      ? "bg-yellow-400"
      : isNone
        ? "bg-gray-400"
        : "bg-red-500";

  const text = isOk
    ? "text-green-700"
    : isWarn
      ? "text-yellow-700"
      : isNone
        ? "text-gray-500"
        : "text-red-700";

  const bg = isOk
    ? "bg-green-50 border-green-200"
    : isWarn
      ? "bg-yellow-50 border-yellow-200"
      : isNone
        ? "bg-gray-50 border-gray-200"
        : "bg-red-50 border-red-200";

  if (compact) {
    return (
      <span
        title={`${label}: ${status.mensaje}`}
        className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${bg} ${text}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </span>
    );
  }

  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${bg}`}>
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0">
        <span className={`text-xs font-semibold ${text}`}>{label}</span>
        <span className="ml-1.5 text-xs text-muted">{status.mensaje}</span>
      </div>
    </div>
  );
}

// ── Fila de producto en el listado (solo nombre) ───────────────────────────

function ProductoCard({
  item,
  selected,
  selectedSku,
  onClick,
  onSelectPresentacion,
}: {
  item: PublicacionItem;
  selected: boolean;
  selectedSku: string | null;
  onClick: () => void;
  onSelectPresentacion: (sku: string) => void;
}) {
  const presentaciones = item.presentaciones || [];
  const tieneVarias = presentaciones.length > 1;

  return (
    <div className="border-b border-border/60 last:border-b-0">
      <button
        type="button"
        onClick={onClick}
        className={`w-full px-2 py-2 text-left text-sm transition ${
          selected
            ? "bg-accent/10 font-semibold text-accent"
            : "text-ink hover:bg-surface-hover"
        }`}
      >
        <span className="line-clamp-2 leading-snug">{item.nombre}</span>
      </button>

      {tieneVarias && selected && (
        <div className="space-y-0.5 pb-1.5 pl-3">
          {presentaciones.map((pres) => (
            <button
              key={pres.sku}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelectPresentacion(pres.sku);
              }}
              className={`block w-full truncate px-2 py-1 text-left text-xs transition ${
                selectedSku === pres.sku
                  ? "font-semibold text-accent"
                  : "text-muted hover:text-ink"
              }`}
            >
              {pres.presentacion_label || pres.nombre || pres.sku}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sortable image grid ────────────────────────────────────────────────────

type ImgItem = { id: string; url: string; principal: boolean; extra?: Record<string, unknown> };

const FOTO_DRAG_MIME = "application/x-mckenna-foto";

type FotoDragPayload = { plataforma: "web" | "meli"; id: string; url: string };

function parseFotoDrag(e: React.DragEvent): FotoDragPayload | null {
  try {
    const raw = e.dataTransfer.getData(FOTO_DRAG_MIME) || e.dataTransfer.getData("text/plain");
    if (!raw) return null;
    const data = JSON.parse(raw) as FotoDragPayload;
    if (!data?.plataforma || !data?.id) return null;
    return data;
  } catch {
    return null;
  }
}

function ImageGrid({
  items,
  plataforma,
  onReorder,
  onDelete,
  onSetPrincipal,
  saving,
  selectedIds,
  onToggleSelect,
  onCopyFromOther,
  dropHint,
}: {
  items: ImgItem[];
  plataforma: "web" | "meli";
  onReorder: (newOrder: ImgItem[]) => void;
  onDelete: (item: ImgItem) => void;
  onSetPrincipal: (item: ImgItem) => void;
  saving?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onCopyFromOther?: (payload: FotoDragPayload) => void;
  dropHint?: string;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [dropHover, setDropHover] = useState(false);
  const crossDropRef = useRef(false);
  const selectable = Boolean(onToggleSelect);

  function handleDragStart(e: React.DragEvent, i: number) {
    setDragIdx(i);
    crossDropRef.current = false;
    const item = items[i];
    const payload: FotoDragPayload = { plataforma, id: item.id, url: item.url };
    e.dataTransfer.setData(FOTO_DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.setData("text/plain", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "copyMove";
  }

  function handleDragEnter(i: number) {
    if (dragIdx === null || i === dragIdx) return;
    setOverIdx(i);
  }

  function handleDragEnd() {
    if (!crossDropRef.current && dragIdx !== null && overIdx !== null && dragIdx !== overIdx) {
      const next = [...items];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(overIdx, 0, moved);
      next.forEach((it, idx) => {
        it.principal = idx === 0;
      });
      onReorder(next);
    }
    setDragIdx(null);
    setOverIdx(null);
    setDropHover(false);
  }

  function handleZoneDragOver(e: React.DragEvent) {
    const types = Array.from(e.dataTransfer.types || []);
    if (!types.includes(FOTO_DRAG_MIME) && !types.includes("text/plain")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropHover(true);
  }

  function handleZoneDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDropHover(false);
    const payload = parseFotoDrag(e);
    if (!payload) return;
    if (payload.plataforma === plataforma) return;
    crossDropRef.current = true;
    onCopyFromOther?.(payload);
  }

  return (
    <div
      onDragOver={handleZoneDragOver}
      onDragLeave={() => setDropHover(false)}
      onDrop={handleZoneDrop}
      className={`min-h-[3.5rem] rounded-lg border-2 border-dashed p-1.5 transition ${
        dropHover
          ? plataforma === "web"
            ? "border-green-500 bg-green-100/60"
            : "border-blue-500 bg-blue-100/60"
          : "border-transparent"
      }`}
    >
      {items.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted">
          {dropHint ||
            (plataforma === "web"
              ? "Sin fotos en la web — arrastra aquí desde MeLi"
              : "Sin fotos en MeLi — arrastra aquí desde la web")}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((item, i) => {
            const isSelected = selectedIds?.has(item.id) ?? false;
            return (
              <div
                key={item.id}
                draggable={!saving}
                onDragStart={(e) => handleDragStart(e, i)}
                onDragEnter={() => handleDragEnter(i)}
                onDragOver={(e) => e.preventDefault()}
                onDragEnd={handleDragEnd}
                title="Arrastra para ordenar aquí, o suelta en el otro sitio para copiar"
                className={`relative w-14 shrink-0 cursor-grab rounded-lg border-2 bg-surface transition ${
                  dragIdx === i
                    ? "opacity-40 scale-95"
                    : overIdx === i
                      ? "border-accent shadow-lg"
                      : isSelected
                        ? "border-accent ring-2 ring-accent/30"
                        : item.principal
                          ? "border-yellow-400"
                          : "border-border hover:border-accent/40"
                }`}
              >
                {selectable && (
                  <label
                    className="absolute left-0.5 top-0.5 z-10 flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded border border-white/80 bg-black/55"
                    onClick={(e) => e.stopPropagation()}
                    title="Seleccionar para eliminar"
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelect?.(item.id)}
                      className="h-2.5 w-2.5 accent-accent"
                    />
                  </label>
                )}

                <div className="h-12 overflow-hidden rounded-t-md bg-surface-hover">
                  <img
                    src={item.url}
                    alt=""
                    className="pointer-events-none h-full w-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = "";
                      (e.currentTarget as HTMLImageElement).style.background = "#eee";
                    }}
                  />
                </div>

                {item.principal && (
                  <div className="absolute right-0.5 top-0.5 rounded bg-yellow-400 px-1 py-0 text-[8px] font-black text-black shadow">
                    ★
                  </div>
                )}

                {!item.principal && (
                  <div className="absolute right-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-black/50 text-[8px] font-bold text-white">
                    {i + 1}
                  </div>
                )}

                <div className="flex items-center justify-between rounded-b-md border-t border-border bg-surface px-0.5 py-0.5">
                  {!item.principal && (
                    <button
                      onClick={() => onSetPrincipal(item)}
                      disabled={saving}
                      title="Usar como foto principal"
                      className="flex-1 rounded py-0 text-center text-[8px] font-semibold text-muted hover:text-yellow-600"
                    >
                      ☆
                    </button>
                  )}
                  {item.principal && <span className="flex-1" />}
                  <button
                    onClick={() => onDelete(item)}
                    disabled={saving}
                    title="Eliminar imagen"
                    className="ml-0.5 inline-flex items-center justify-center rounded p-0.5 text-muted hover:text-danger disabled:opacity-40"
                  >
                    <Icon name="trash" size={10} weight="regular" />
                  </button>
                </div>
              </div>
            );
          })}

          <div className="flex w-full items-center gap-1 text-[10px] text-muted">
            <span>
              ☰ Ordenar · ★ = primera · Arrastra al otro sitio para copiar
              {selectable ? " · ☑ eliminar" : ""}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab de gestión de imágenes ──────────────────────────────────────────────

function ImagenesTab({
  sku,
  meliItemId,
}: {
  sku: string;
  meliItemId: string;
}) {
  const { data: fotos, isLoading, refetch } = useFotosActuales(sku, meliItemId);
  const subirMut = useSubirImagen(sku);
  const reordenarWebMut = useReordenarImagenesWeb(sku);
  const reordenarMeliMut = useReordenarImagenesMeli(sku);
  const eliminarMut = useEliminarImagenes(sku);
  const fileRef = useRef<HTMLInputElement>(null);

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [targetWeb, setTargetWeb] = useState(true);
  const [targetMeli, setTargetMeli] = useState(true);
  const [dropZoneDragging, setDropZoneDragging] = useState(false);

  // Orden local editable (antes de guardar)
  const [webOrder, setWebOrder] = useState<ImgItem[] | null>(null);
  const [meliOrder, setMeliOrder] = useState<ImgItem[] | null>(null);

  // Sincronizar orden local cuando llegan datos del servidor
  useEffect(() => {
    if (fotos?.web.imagenes) {
      setWebOrder(fotos.web.imagenes.map((img) => ({
        id: img.filename,
        url: srcImagenCatalogoPanel(img.filename || img.path || img.url),
        principal: img.principal,
        extra: { filename: img.filename, path: img.path },
      })));
    }
  }, [fotos?.web.imagenes]);

  useEffect(() => {
    if (fotos?.meli.imagenes) {
      setMeliOrder(fotos.meli.imagenes.map((img) => ({
        id: img.id,
        url: img.url,
        principal: img.principal,
      })));
    }
  }, [fotos?.meli.imagenes]);

  const handleFilesChange = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    setSelectedFiles(arr);
    const readers = arr.map((f) =>
      new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = (e) => res(e.target?.result as string);
        r.readAsDataURL(f);
      }),
    );
    Promise.all(readers).then(setPreviews);
  }, []);

  const onDropZone = (e: React.DragEvent) => {
    e.preventDefault();
    setDropZoneDragging(false);
    handleFilesChange(e.dataTransfer.files);
  };

  async function handleSubir() {
    if (!selectedFiles.length) return;
    const targets: ("web" | "meli")[] = [];
    if (targetWeb) targets.push("web");
    if (targetMeli) targets.push("meli");
    if (!targets.length) return;
    await subirMut.mutateAsync({ files: selectedFiles, targets, meliItemId });
    setSelectedFiles([]);
    setPreviews([]);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleGuardarOrdenWeb() {
    if (!webOrder) return;
    await reordenarWebMut.mutateAsync(webOrder.map((i) => i.id));
  }

  async function handleGuardarOrdenMeli() {
    if (!meliOrder || !meliItemId) return;
    await reordenarMeliMut.mutateAsync({
      picture_ids: meliOrder.map((i) => i.id),
      meli_item_id: meliItemId,
    });
  }

  function handleSetPrincipalWeb(item: ImgItem) {
    if (!webOrder) return;
    const next = [item, ...webOrder.filter((i) => i.id !== item.id)].map((i, idx) => ({
      ...i,
      principal: idx === 0,
    }));
    setWebOrder(next);
  }

  function handleSetPrincipalMeli(item: ImgItem) {
    if (!meliOrder) return;
    const next = [item, ...meliOrder.filter((i) => i.id !== item.id)].map((i, idx) => ({
      ...i,
      principal: idx === 0,
    }));
    setMeliOrder(next);
  }

  async function handleDeleteWeb(item: ImgItem) {
    if (!confirm(`¿Eliminar "${item.id}" de Web? Esta acción no se puede deshacer.`)) return;
    await eliminarMut.mutateAsync({ plataforma: "web", filename: item.id });
  }

  async function handleDeleteMeli(item: ImgItem) {
    if (!confirm("¿Quitar esta foto de la publicación MeLi?")) return;
    await eliminarMut.mutateAsync({ plataforma: "meli", picture_id: item.id, meli_item_id: meliItemId });
  }

  const isSaving = reordenarWebMut.isPending || reordenarMeliMut.isPending || eliminarMut.isPending;

  return (
    <div className="space-y-6">

      {/* ── Sección Web / SIIGO ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold text-ink">Web / SIIGO</h4>
            <p className="text-[11px] text-muted">
              {fotos?.web.total ?? 0} imagen(es) · La primera es la principal · estándar 1000×1000 fondo blanco
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              disabled={isLoading}
              className="rounded-lg border border-border px-2 py-1 text-[11px] text-muted hover:border-accent/30 hover:text-ink disabled:opacity-40"
            >
              {isLoading ? "..." : "↺"}
            </button>
            <NormalizarSkuButton sku={sku} />
            {webOrder && (
              <button
                onClick={handleGuardarOrdenWeb}
                disabled={reordenarWebMut.isPending}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-accent-hover disabled:opacity-40"
              >
                {reordenarWebMut.isPending ? "Guardando..." : "Guardar orden"}
              </button>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-6">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : (
          <ImageGrid
            items={webOrder ?? []}
            plataforma="web"
            onReorder={setWebOrder}
            onDelete={handleDeleteWeb}
            onSetPrincipal={handleSetPrincipalWeb}
            saving={isSaving}
          />
        )}

        {reordenarWebMut.isSuccess && (
          <p className="text-xs text-green-600">✓ Orden web guardado. Principal: {reordenarWebMut.data?.principal}</p>
        )}
        {reordenarWebMut.isError && (
          <p className="text-xs text-danger">{reordenarWebMut.error.message}</p>
        )}
      </div>

      <hr className="border-border" />

      {/* ── Sección MercadoLibre ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold text-ink">MercadoLibre</h4>
            <p className="text-[11px] text-muted">
              {meliItemId
                ? `${fotos?.meli.total ?? 0} imagen(es) · La primera es la principal del listing`
                : "Sin ID vinculado — ve a la pestaña MeLi para vincular"}
            </p>
          </div>
          {meliOrder && meliItemId && (
            <button
              onClick={handleGuardarOrdenMeli}
              disabled={reordenarMeliMut.isPending}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-40"
            >
              {reordenarMeliMut.isPending ? "Guardando..." : "Guardar orden"}
            </button>
          )}
        </div>

        {!meliItemId ? (
          <p className="rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-700">
            Vincula el ID de la publicación MeLi en la pestaña "MeLi" para gestionar sus imágenes.
          </p>
        ) : isLoading ? (
          <div className="flex justify-center py-6">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : fotos?.meli.error ? (
          <p className="rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-700">
            {fotos.meli.error}
          </p>
        ) : (
          <ImageGrid
            items={meliOrder ?? []}
            plataforma="meli"
            onReorder={setMeliOrder}
            onDelete={handleDeleteMeli}
            onSetPrincipal={handleSetPrincipalMeli}
            saving={isSaving}
          />
        )}

        {reordenarMeliMut.isSuccess && (
          <p className="text-xs text-green-600">✓ Orden MeLi guardado ({reordenarMeliMut.data?.total_pictures} fotos)</p>
        )}
        {reordenarMeliMut.isError && (
          <p className="text-xs text-danger">{reordenarMeliMut.error.message}</p>
        )}
      </div>

      {eliminarMut.isError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          Error al eliminar: {eliminarMut.error.message}
        </p>
      )}

      <hr className="border-border" />

      {/* ── Upload nuevas imágenes ── */}
      <div className="space-y-3">
        <h4 className="text-sm font-bold text-ink">Agregar imágenes</h4>

        {/* Drop zone — acepta múltiples archivos */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDropZoneDragging(true); }}
          onDragLeave={() => setDropZoneDragging(false)}
          onDrop={onDropZone}
          onClick={() => fileRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-5 transition ${
            dropZoneDragging
              ? "border-accent bg-accent/5"
              : "border-border hover:border-accent/40 hover:bg-surface-hover"
          }`}
        >
          {previews.length > 0 ? (
            <div className="flex flex-wrap justify-center gap-2 px-2">
              {previews.map((p, i) => (
                <img key={i} src={p} alt="" className="h-20 w-20 rounded-lg object-cover shadow" />
              ))}
            </div>
          ) : (
            <>
              <span className="text-3xl opacity-25">🖼</span>
              <p className="text-sm font-semibold text-ink">Arrastra o haz clic para elegir</p>
              <p className="text-xs text-muted">
                JPG, PNG, WEBP · Se normalizan a 1000×1000 con fondo blanco
              </p>
            </>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          className="hidden"
          onChange={(e) => handleFilesChange(e.target.files)}
        />

        {selectedFiles.length > 0 && (
          <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2">
            <p className="text-xs text-muted">
              {selectedFiles.length} archivo{selectedFiles.length !== 1 ? "s" : ""} seleccionado{selectedFiles.length !== 1 ? "s" : ""} ·{" "}
              {(selectedFiles.reduce((a, f) => a + f.size, 0) / 1024).toFixed(0)} KB total
            </p>
            <button
              onClick={() => { setSelectedFiles([]); setPreviews([]); if (fileRef.current) fileRef.current.value = ""; }}
              className="text-xs text-danger underline"
            >
              Limpiar
            </button>
          </div>
        )}

        {/* Destinos */}
        <div className="flex gap-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-semibold text-ink hover:border-accent/30">
            <input type="checkbox" checked={targetWeb} onChange={(e) => setTargetWeb(e.target.checked)} className="h-4 w-4 accent-accent" />
            Web / SIIGO
          </label>
          <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${meliItemId ? "border-border bg-surface text-ink hover:border-blue-300" : "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed"}`}>
            <input type="checkbox" checked={targetMeli} onChange={(e) => setTargetMeli(e.target.checked)} disabled={!meliItemId} className="h-4 w-4 accent-blue-600" />
            MercadoLibre
            {!meliItemId && <span className="text-[10px] text-gray-400">(sin vincular)</span>}
          </label>
        </div>

        <button
          onClick={handleSubir}
          disabled={!selectedFiles.length || subirMut.isPending || (!targetWeb && !targetMeli)}
          className="w-full rounded-lg bg-accent py-3 text-sm font-bold text-white transition hover:bg-accent-hover disabled:opacity-40"
        >
          {subirMut.isPending ? (
            <span className="flex items-center justify-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Subiendo {selectedFiles.length} imagen{selectedFiles.length !== 1 ? "es" : ""}...
            </span>
          ) : selectedFiles.length > 0 ? (
            `Subir ${selectedFiles.length} imagen${selectedFiles.length !== 1 ? "es" : ""}${targetWeb && targetMeli ? " a Web y MeLi" : targetWeb ? " a Web" : " a MeLi"}`
          ) : (
            "Subir imágenes"
          )}
        </button>

        {/* Resultados de subida */}
        {subirMut.isSuccess && (
          <div className="space-y-1.5 rounded-xl border border-green-200 bg-green-50 p-3">
            {subirMut.data.archivos.map((r, i) => (
              <div key={i} className="text-xs">
                <span className="font-semibold text-ink">{r.filename}</span>
                {r.web && (
                  <span className={`ml-2 ${r.web.ok ? "text-green-700" : "text-red-700"}`}>
                    Web: {r.web.ok ? `✓ ${r.web.path}` : `✗ ${r.web.error}`}
                  </span>
                )}
                {r.meli && (
                  <span className={`ml-2 ${r.meli.ok ? "text-blue-700" : "text-red-700"}`}>
                    MeLi: {r.meli.ok ? `✓ ${r.meli.pictures?.length ?? 0} fotos` : `✗ ${r.meli.error}`}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        {subirMut.isError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{subirMut.error.message}</p>
        )}
      </div>
    </div>
  );
}


function fmtCopSitio(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return `$${Number(n).toLocaleString("es-CO")}`;
}

function FotoSitio({ src, alt }: { src: string; alt: string }) {
  const url = src ? resolverFotoPreview(src) : "";
  return (
    <div className="h-28 w-28 shrink-0 overflow-hidden rounded-xl border border-border bg-surface-hover">
      {url ? (
        <img
          src={url}
          alt={alt}
          className="h-full w-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-muted">Sin foto</div>
      )}
    </div>
  );
}

function SitiosTab({
  sku,
  data,
  ocultoWeb,
  onToggleOculto,
}: {
  sku: string;
  data: PublicacionDetalle;
  ocultoWeb: boolean;
  onToggleOculto: (v: boolean) => void;
}) {
  const estadoMut = useEstadoMeli();
  const precioMut = usePrecioMeli(sku);
  const guardarMut = useGuardarPublicacion();
  const syncWebMut = useSyncWeb(sku);
  const meliItemId = data.meli_id_efectivo || data.meli_item_id_override || data.meli_item_id_cache || "";
  const { data: fotos, isLoading: fotosLoading, refetch: refetchFotos } = useFotosActuales(sku, meliItemId);
  const reordenarWebMut = useReordenarImagenesWeb(sku);
  const reordenarMeliMut = useReordenarImagenesMeli(sku);
  const eliminarMut = useEliminarImagenes(sku);
  const copiarMut = useCopiarImagenSitio(sku);
  const subirMut = useSubirImagen(sku);
  const fileWebRef = useRef<HTMLInputElement>(null);
  const fileMeliRef = useRef<HTMLInputElement>(null);

  const vista: VistaSitios | undefined = data.vista_sitios;
  const web = vista?.web;
  const meli = vista?.meli;
  const filas: PresentacionSitio[] = vista?.presentaciones?.length ? vista.presentaciones : [];

  const estadoMeli = (meli?.estado || "").toLowerCase();
  const meliActivo = estadoMeli === "active";
  const meliPausado = estadoMeli === "paused";
  const tieneMeli = Boolean(meli?.item_id || meliItemId);

  const [precioEdit, setPrecioEdit] = useState("");
  const [webOrder, setWebOrder] = useState<ImgItem[] | null>(null);
  const [meliOrder, setMeliOrder] = useState<ImgItem[] | null>(null);
  const [selWeb, setSelWeb] = useState<Set<string>>(new Set());
  const [selMeli, setSelMeli] = useState<Set<string>>(new Set());
  const [msgOculto, setMsgOculto] = useState("");
  const [msgCopia, setMsgCopia] = useState("");

  useEffect(() => {
    const p = meli?.precio ?? null;
    setPrecioEdit(p != null && !Number.isNaN(Number(p)) ? String(Math.round(Number(p))) : "");
  }, [meli?.precio, sku]);

  useEffect(() => {
    if (fotos?.web.imagenes) {
      setWebOrder(
        fotos.web.imagenes.map((img) => ({
          id: img.filename,
          url: srcImagenCatalogoPanel(img.filename || img.path || img.url),
          principal: img.principal,
          extra: { filename: img.filename, path: img.path },
        })),
      );
      setSelWeb(new Set());
    }
  }, [fotos?.web.imagenes]);

  useEffect(() => {
    if (fotos?.meli.imagenes) {
      setMeliOrder(
        fotos.meli.imagenes.map((img) => ({
          id: img.id,
          url: img.url,
          principal: img.principal,
        })),
      );
      setSelMeli(new Set());
    }
  }, [fotos?.meli.imagenes]);

  const savingFotos =
    reordenarWebMut.isPending ||
    reordenarMeliMut.isPending ||
    eliminarMut.isPending ||
    subirMut.isPending ||
    copiarMut.isPending;

  async function handleCopiarFoto(destino: "web" | "meli", payload: FotoDragPayload) {
    if (payload.plataforma === destino) return;
    if (destino === "meli" && !meliItemId) {
      setMsgCopia("Vincula el ID MeLi antes de copiar fotos ahí.");
      return;
    }
    setMsgCopia("");
    try {
      const res = await copiarMut.mutateAsync({
        origen: payload.plataforma,
        destino,
        imagen_id: payload.id,
        url: payload.url,
        meli_item_id: meliItemId || undefined,
      });
      setMsgCopia(`✓ ${res.mensaje || "Foto copiada"}`);
    } catch (e) {
      setMsgCopia(e instanceof Error ? e.message : "No se pudo copiar la foto");
    }
  }

  async function handleOcultarWeb(ocultar: boolean) {
    onToggleOculto(ocultar);
    setMsgOculto("");
    try {
      await guardarMut.mutateAsync({ sku, campos: { oculto_web: ocultar } });
      await syncWebMut.mutateAsync();
      setMsgOculto(
        ocultar
          ? "✓ Oculto en la tienda (sigue en vitrina, sin compra)"
          : "✓ Visible para comprar en la tienda",
      );
    } catch (e) {
      onToggleOculto(!ocultar);
      setMsgOculto(e instanceof Error ? e.message : "No se pudo actualizar la tienda");
    }
  }

  async function handlePrecioMeli() {
    const n = Number(precioEdit.replace(/[^\d.]/g, ""));
    if (!n || n <= 0) return;
    await precioMut.mutateAsync({ precio: n, meli_item_id: meliItemId || undefined });
  }

  function toggleSel(set: Set<string>, id: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  async function handleDeleteWeb(item: ImgItem) {
    if (!confirm(`¿Eliminar esta foto de la tienda web?`)) return;
    await eliminarMut.mutateAsync({ plataforma: "web", filename: item.id });
  }

  async function handleDeleteMeli(item: ImgItem) {
    if (!confirm("¿Quitar esta foto de Mercado Libre?")) return;
    await eliminarMut.mutateAsync({
      plataforma: "meli",
      picture_id: item.id,
      meli_item_id: meliItemId,
    });
  }

  async function handleDeleteSelectedWeb() {
    if (!selWeb.size) return;
    if (!confirm(`¿Eliminar ${selWeb.size} foto(s) de la tienda web?`)) return;
    for (const id of selWeb) {
      await eliminarMut.mutateAsync({ plataforma: "web", filename: id });
    }
    setSelWeb(new Set());
  }

  async function handleDeleteSelectedMeli() {
    if (!selMeli.size) return;
    if (!confirm(`¿Eliminar ${selMeli.size} foto(s) de Mercado Libre?`)) return;
    for (const id of selMeli) {
      await eliminarMut.mutateAsync({
        plataforma: "meli",
        picture_id: id,
        meli_item_id: meliItemId,
      });
    }
    setSelMeli(new Set());
  }

  async function handleGuardarOrdenWeb() {
    if (!webOrder) return;
    await reordenarWebMut.mutateAsync(webOrder.map((i) => i.id));
  }

  async function handleGuardarOrdenMeli() {
    if (!meliOrder || !meliItemId) return;
    await reordenarMeliMut.mutateAsync({
      picture_ids: meliOrder.map((i) => i.id),
      meli_item_id: meliItemId,
    });
  }

  function handleSetPrincipalWeb(item: ImgItem) {
    if (!webOrder) return;
    setWebOrder(
      [item, ...webOrder.filter((i) => i.id !== item.id)].map((i, idx) => ({
        ...i,
        principal: idx === 0,
      })),
    );
  }

  function handleSetPrincipalMeli(item: ImgItem) {
    if (!meliOrder) return;
    setMeliOrder(
      [item, ...meliOrder.filter((i) => i.id !== item.id)].map((i, idx) => ({
        ...i,
        principal: idx === 0,
      })),
    );
  }

  async function handleSubir(files: FileList | null, target: "web" | "meli") {
    if (!files?.length) return;
    await subirMut.mutateAsync({
      files: Array.from(files),
      targets: [target],
      meliItemId: target === "meli" ? meliItemId : undefined,
    });
    if (target === "web" && fileWebRef.current) fileWebRef.current.value = "";
    if (target === "meli" && fileMeliRef.current) fileMeliRef.current.value = "";
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-2">
        {/* ── WEB ── */}
        <section className="flex flex-col gap-3 rounded-xl border-2 border-green-200 bg-green-50/40 p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className="text-sm font-bold text-ink">Página web</h4>
              <p className="text-[11px] text-muted">mckennagroup.co</p>
            </div>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                web?.visible && !ocultoWeb
                  ? "border-green-300 bg-green-100 text-green-800"
                  : "border-border bg-surface text-muted"
              }`}
            >
              {ocultoWeb || !web?.visible ? "No se muestra" : web?.vitrina ? "Vitrina" : "Visible"}
            </span>
          </div>

          <div className="flex gap-3">
            <FotoSitio src={web?.foto || data.foto_efectiva} alt={web?.nombre || data.nombre} />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-semibold leading-tight text-ink">{web?.nombre || data.nombre}</p>
              <p className="text-[11px] text-muted">
                {web?.categoria || data.categoria}
                {web?.linea ? ` · ${web.linea}` : ""}
              </p>
              <p className="text-sm font-bold text-ink">
                {web?.es_familia && (web?.n_presentaciones || 0) > 1
                  ? `Desde ${fmtCopSitio(web.precio)}`
                  : fmtCopSitio(web?.precio ?? data.precio_web)}
              </p>
              {web?.url && (
                <a
                  href={web.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex text-xs font-semibold text-green-800 underline"
                >
                  Ver como cliente ↗
                </a>
              )}
            </div>
          </div>

          {web?.motivo_oculto && !ocultoWeb && (
            <p className="rounded-lg border border-yellow-200 bg-yellow-50 px-2.5 py-1.5 text-[11px] text-yellow-800">
              {web.motivo_oculto}
            </p>
          )}

          <button
            type="button"
            disabled={guardarMut.isPending || syncWebMut.isPending}
            onClick={() => void handleOcultarWeb(!ocultoWeb)}
            className={`w-full rounded-lg border-2 px-3 py-2.5 text-sm font-bold transition disabled:opacity-40 ${
              ocultoWeb
                ? "border-green-400 bg-green-100 text-green-900 hover:bg-green-200"
                : "border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100"
            }`}
          >
            {guardarMut.isPending || syncWebMut.isPending
              ? "Aplicando…"
              : ocultoWeb
                ? "Mostrar en la tienda"
                : "No mostrar en la web"}
          </button>
          {msgOculto && (
            <p className={`text-xs ${msgOculto.startsWith("✓") ? "text-green-700" : "text-danger"}`}>
              {msgOculto}
            </p>
          )}

          <div className="border-t border-green-200/80 pt-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold text-ink">
                Fotos en la web ({fotos?.web.total ?? webOrder?.length ?? 0})
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => void refetchFotos()}
                  className="rounded border border-border px-2 py-1 text-[10px] font-semibold text-muted hover:text-ink"
                >
                  ↺
                </button>
                {selWeb.size > 0 && (
                  <button
                    type="button"
                    disabled={savingFotos}
                    onClick={() => void handleDeleteSelectedWeb()}
                    className="rounded border border-danger/40 bg-danger/5 px-2 py-1 text-[10px] font-semibold text-danger"
                  >
                    Eliminar {selWeb.size}
                  </button>
                )}
                {webOrder && webOrder.length > 0 && (
                  <button
                    type="button"
                    disabled={reordenarWebMut.isPending}
                    onClick={() => void handleGuardarOrdenWeb()}
                    className="rounded bg-accent px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-40"
                  >
                    {reordenarWebMut.isPending ? "…" : "Guardar orden"}
                  </button>
                )}
              </div>
            </div>
            {fotosLoading ? (
              <div className="flex justify-center py-4">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              </div>
            ) : (
              <ImageGrid
                items={webOrder ?? []}
                plataforma="web"
                onReorder={setWebOrder}
                onDelete={(item) => void handleDeleteWeb(item)}
                onSetPrincipal={handleSetPrincipalWeb}
                saving={savingFotos}
                selectedIds={selWeb}
                onToggleSelect={(id) => toggleSel(selWeb, id, setSelWeb)}
                onCopyFromOther={(p) => void handleCopiarFoto("web", p)}
                dropHint="Arrastra aquí una foto de MeLi para copiarla a la web"
              />
            )}
            <input
              ref={fileWebRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => void handleSubir(e.target.files, "web")}
            />
            <button
              type="button"
              disabled={subirMut.isPending}
              onClick={() => fileWebRef.current?.click()}
              className="w-full rounded-lg border border-dashed border-green-400 bg-white/70 py-2 text-xs font-semibold text-green-900 hover:bg-green-50 disabled:opacity-40"
            >
              {subirMut.isPending ? "Subiendo…" : "+ Agregar fotos a la web"}
            </button>
            {reordenarWebMut.isSuccess && (
              <p className="text-[11px] text-green-700">✓ Orden web guardado</p>
            )}
          </div>
        </section>

        {/* ── MELI ── */}
        <section className="flex flex-col gap-3 rounded-xl border-2 border-blue-200 bg-blue-50/40 p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className="text-sm font-bold text-ink">Mercado Libre</h4>
              <p className="font-mono text-[11px] text-muted">
                {meli?.item_id || meliItemId || "Sin vincular"}
              </p>
            </div>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                meliActivo
                  ? "border-blue-300 bg-blue-100 text-blue-800"
                  : meliPausado
                    ? "border-yellow-300 bg-yellow-100 text-yellow-800"
                    : "border-border bg-surface text-muted"
              }`}
            >
              {tieneMeli ? estadoMeli || "Vinculado" : "Sin vincular"}
            </span>
          </div>

          <div className="flex gap-3">
            <FotoSitio src={meli?.foto || data.foto_efectiva} alt={meli?.titulo || data.nombre} />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-semibold leading-tight text-ink">
                {meli?.titulo || data.nombre}
              </p>
              {meli?.stock != null && (
                <p className="text-[11px] text-muted">Stock {meli.stock}</p>
              )}
              {meli?.permalink && (
                <a
                  href={meli.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex text-xs font-semibold text-blue-800 underline"
                >
                  Ver publicación ↗
                </a>
              )}
            </div>
          </div>

          {tieneMeli ? (
            <>
              <div className="rounded-lg border border-blue-200 bg-white/80 p-3 space-y-2">
                <label className="block text-xs font-bold text-ink">Precio en MeLi (COP)</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={precioEdit}
                    onChange={(e) => setPrecioEdit(e.target.value)}
                    placeholder="Ej: 24210"
                    className="min-w-0 flex-1 rounded-lg border border-border bg-surface-input px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    disabled={precioMut.isPending || !precioEdit}
                    onClick={() => void handlePrecioMeli()}
                    className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
                  >
                    {precioMut.isPending ? "…" : "Aplicar"}
                  </button>
                </div>
                {precioMut.isSuccess && (
                  <p className="text-[11px] text-green-700">
                    ✓ {precioMut.data?.msg || "Precio actualizado en MeLi"}
                  </p>
                )}
                {precioMut.isError && (
                  <p className="text-[11px] text-danger">{precioMut.error.message}</p>
                )}
              </div>

              {(meliActivo || meliPausado || estadoMeli === "") && (
                <button
                  type="button"
                  disabled={estadoMut.isPending}
                  onClick={() =>
                    void estadoMut.mutateAsync({
                      sku,
                      estado: meliActivo ? "paused" : "active",
                    })
                  }
                  className="w-full rounded-lg border border-blue-300 bg-white px-3 py-2 text-xs font-semibold text-blue-800 hover:bg-blue-50 disabled:opacity-40"
                >
                  {estadoMut.isPending
                    ? "…"
                    : meliActivo
                      ? "Pausar en MeLi"
                      : "Activar en MeLi"}
                </button>
              )}
              {estadoMut.isSuccess && (
                <p className="text-xs text-green-700">
                  ✓ {estadoMut.data?.mensaje || `Estado: ${estadoMut.data?.estado}`}
                </p>
              )}
              {estadoMut.isError && (
                <p className="text-xs text-danger">{estadoMut.error.message}</p>
              )}
            </>
          ) : (
            <p className="rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-[11px] text-yellow-800">
              Vincula el ID MCO en la pestaña MeLi para editar precio y fotos aquí.
            </p>
          )}

          <div className="border-t border-blue-200/80 pt-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold text-ink">
                Fotos en MeLi ({fotos?.meli.total ?? meliOrder?.length ?? 0})
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => void refetchFotos()}
                  className="rounded border border-border px-2 py-1 text-[10px] font-semibold text-muted hover:text-ink"
                >
                  ↺
                </button>
                {selMeli.size > 0 && (
                  <button
                    type="button"
                    disabled={savingFotos || !meliItemId}
                    onClick={() => void handleDeleteSelectedMeli()}
                    className="rounded border border-danger/40 bg-danger/5 px-2 py-1 text-[10px] font-semibold text-danger"
                  >
                    Eliminar {selMeli.size}
                  </button>
                )}
                {meliOrder && meliOrder.length > 0 && meliItemId && (
                  <button
                    type="button"
                    disabled={reordenarMeliMut.isPending}
                    onClick={() => void handleGuardarOrdenMeli()}
                    className="rounded bg-blue-600 px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-40"
                  >
                    {reordenarMeliMut.isPending ? "…" : "Guardar orden"}
                  </button>
                )}
              </div>
            </div>
            {!meliItemId ? (
              <p className="text-[11px] text-muted">Sin ID MeLi — no se pueden gestionar fotos.</p>
            ) : fotosLoading ? (
              <div className="flex justify-center py-4">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              </div>
            ) : fotos?.meli.error ? (
              <p className="rounded-lg border border-yellow-200 bg-yellow-50 px-2.5 py-1.5 text-[11px] text-yellow-800">
                {fotos.meli.error}
              </p>
            ) : (
              <ImageGrid
                items={meliOrder ?? []}
                plataforma="meli"
                onReorder={setMeliOrder}
                onDelete={(item) => void handleDeleteMeli(item)}
                onSetPrincipal={handleSetPrincipalMeli}
                saving={savingFotos}
                selectedIds={selMeli}
                onToggleSelect={(id) => toggleSel(selMeli, id, setSelMeli)}
                onCopyFromOther={(p) => void handleCopiarFoto("meli", p)}
                dropHint="Arrastra aquí una foto de la web para copiarla a MeLi"
              />
            )}
            <input
              ref={fileMeliRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => void handleSubir(e.target.files, "meli")}
            />
            <button
              type="button"
              disabled={subirMut.isPending || !meliItemId}
              onClick={() => fileMeliRef.current?.click()}
              className="w-full rounded-lg border border-dashed border-blue-400 bg-white/70 py-2 text-xs font-semibold text-blue-900 hover:bg-blue-50 disabled:opacity-40"
            >
              {subirMut.isPending ? "Subiendo…" : "+ Agregar fotos a MeLi"}
            </button>
            {reordenarMeliMut.isSuccess && (
              <p className="text-[11px] text-green-700">✓ Orden MeLi guardado</p>
            )}
          </div>
        </section>
      </div>

      {(msgCopia || copiarMut.isPending) && (
        <p className={`text-xs ${msgCopia.startsWith("✓") ? "text-green-700" : msgCopia ? "text-danger" : "text-muted"}`}>
          {copiarMut.isPending ? "Copiando foto entre sitios…" : msgCopia}
        </p>
      )}
      {eliminarMut.isError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          Error al eliminar: {eliminarMut.error.message}
        </p>
      )}
      {subirMut.isError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          Error al subir: {subirMut.error.message}
        </p>
      )}

      {filas.length > 1 && (
        <div>
          <h4 className="mb-2 text-sm font-bold text-ink">Otras presentaciones de esta familia</h4>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[480px] text-xs">
              <thead className="bg-surface-hover text-left text-[10px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Web</th>
                  <th className="px-3 py-2">MeLi</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.sku} className="border-t border-border/70">
                    <td className="px-3 py-2">
                      <div className="font-semibold text-ink">{f.web.label}</div>
                      <div className="font-mono text-[10px] text-muted">{f.sku}</div>
                    </td>
                    <td className="px-3 py-2">
                      {f.aparece_en_web ? (
                        <span className="text-green-700">{fmtCopSitio(f.web.precio)}</span>
                      ) : (
                        <span className="text-muted">No aparece</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {f.meli.item_id ? (
                        <span className="font-mono text-[10px]">{f.meli.item_id}</span>
                      ) : (
                        <span className="text-muted">Sin publicación</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Panel de edición ───────────────────────────────────────────────────────

export function EditorPanel({
  sku,
  onClose: _onClose,
  layout: _layout,
  onEstadoMarcado: _onEstadoMarcado,
}: {
  sku: string;
  onClose: () => void;
  layout?: string;
  onEstadoMarcado?: (estado: "" | "omitir" | "por_publicar") => void;
}) {
  const { data, isLoading, error, refetch } = usePublicacionDetalle(sku, true);
  const [ocultoWeb, setOcultoWeb] = useState(false);

  useEffect(() => {
    if (!data) return;
    setOcultoWeb(data.oculto_web);
  }, [data]);

  if (isLoading && !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger/5 p-5 text-sm text-danger">
        Error cargando producto.{" "}
        <button onClick={() => refetch()} className="underline">
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-base font-bold leading-tight text-ink">{data.nombre}</h3>

      {data.meli_compliance_reemplazo?.url_meli && (
        <div className="space-y-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3">
          <p className="text-xs font-bold text-teal-900">
            Publicación de reemplazo (compliance MeLi)
          </p>
          <p className="text-[11px] text-teal-800">
            {data.meli_compliance_reemplazo.item_id}
            {" · "}
            <span className="font-semibold">
              {data.meli_compliance_reemplazo.estado_actual}
            </span>
            {data.meli_compliance_reemplazo.item_origen_id && (
              <> · sustituye {data.meli_compliance_reemplazo.item_origen_id}</>
            )}
          </p>
          <a
            href={data.meli_compliance_reemplazo.url_meli}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-teal-400 bg-surface-input px-3 py-1.5 text-xs font-bold text-teal-900 hover:bg-teal-100 dark:text-teal-200 dark:hover:bg-teal-950/40"
          >
            ↗ Abrir en MeLi y verificar que siga activa
          </a>
        </div>
      )}

      <SitiosTab
        sku={sku}
        data={data}
        ocultoWeb={ocultoWeb}
        onToggleOculto={setOcultoWeb}
      />
    </div>
  );
}

// ── Galería de imágenes por SKU ────────────────────────────────────────────

function imgSrcGaleria(url: string, path: string, filename?: string): string {
  if (filename) return srcImagenCatalogoPanel(filename);
  if (path) return srcImagenCatalogoPanel(path);
  if (url) return srcImagenCatalogoPanel(url);
  return "";
}

function NormalizarSkuButton({ sku }: { sku: string }) {
  const mut = useNormalizarImagenesCatalogo();
  return (
    <button
      type="button"
      title="Llevar imágenes de este SKU a 1000×1000 fondo blanco"
      disabled={mut.isPending}
      onClick={() => {
        if (!confirm(`¿Normalizar imágenes de ${sku} a 1000×1000 con fondo blanco?`)) return;
        void mut.mutateAsync({ sku, solo_no_cumplen: true });
      }}
      className="rounded-lg border border-border px-2 py-1 text-[11px] font-semibold text-ink hover:border-accent/40 disabled:opacity-40"
    >
      {mut.isPending ? "Normalizando…" : "1000×1000"}
    </button>
  );
}

function GaleriaPublicacionesView({
  onAbrirSku,
}: {
  onAbrirSku: (sku: string) => void;
}) {
  const [buscar, setBuscar] = useState("");
  const [q, setQ] = useState("");
  const { data, isLoading, isFetching, isError, error, refetch } = useGaleriaPublicaciones(q);
  const normalizarMut = useNormalizarImagenesCatalogo();
  const items = data?.items ?? [];

  // Vista plana: una tarjeta por imagen con el código SKU bien visible
  const tarjetas = items.flatMap((it) =>
    it.imagenes.map((img) => ({
      sku: it.sku,
      nombre: it.nombre,
      img,
    })),
  );
  const sinEstandar = tarjetas.filter((t) => t.img.cumple_estandar === false).length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div>
          <p className="text-sm font-bold text-ink">Galería · imagen + código SKU</p>
          <p className="text-xs text-muted">
            Estándar: 1000×1000 px con fondo blanco.
            {data ? ` · ${data.total_imagenes} fotos · ${data.total_skus} SKUs` : ""}
            {sinEstandar > 0 ? ` · ${sinEstandar} sin estándar` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sinEstandar > 0 && (
            <button
              type="button"
              disabled={normalizarMut.isPending}
              onClick={() => {
                const filenames = tarjetas
                  .filter((t) => t.img.cumple_estandar === false)
                  .map((t) => t.img.filename);
                if (
                  !confirm(
                    `¿Normalizar ${filenames.length} imagen(es) a 1000×1000 con fondo blanco?\nEl producto se centra en lienzo blanco (sin recortar).`,
                  )
                ) {
                  return;
                }
                void normalizarMut.mutateAsync({
                  filenames,
                  solo_no_cumplen: true,
                  limit: filenames.length,
                });
              }}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-accent-hover disabled:opacity-40"
            >
              {normalizarMut.isPending
                ? "Normalizando…"
                : `Normalizar ${sinEstandar} a 1000×1000`}
            </button>
          )}
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-accent/50 disabled:opacity-40"
          >
            {isFetching ? "Actualizando…" : "🔄 Actualizar"}
          </button>
        </div>
      </div>
      {normalizarMut.isSuccess && (
        <p className="text-xs text-green-700 shrink-0">
          ✓ Normalizadas: {normalizarMut.data.normalizadas} · omitidas: {normalizarMut.data.omitidas}
          {normalizarMut.data.errores ? ` · errores: ${normalizarMut.data.errores}` : ""}
        </p>
      )}
      {normalizarMut.isError && (
        <p className="text-xs text-danger shrink-0">
          {normalizarMut.error instanceof Error
            ? normalizarMut.error.message
            : "Error al normalizar"}
        </p>
      )}

      <form
        className="flex gap-2 shrink-0"
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
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none placeholder:text-muted/50 focus:border-accent"
        />
        <button
          type="submit"
          className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white transition hover:bg-accent-hover"
        >
          Buscar
        </button>
      </form>

      {isLoading && <p className="text-sm text-muted">Cargando galería…</p>}
      {isError && (
        <p className="text-sm text-danger">
          {error instanceof Error ? error.message : "No se pudo cargar la galería"}
        </p>
      )}
      {!isLoading && !isError && tarjetas.length === 0 && (
        <p className="text-sm text-muted">No hay imágenes enlazadas a SKUs.</p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {tarjetas.map(({ sku, nombre, img }) => (
            <button
              key={`${sku}-${img.filename}`}
              type="button"
              onClick={() => onAbrirSku(sku)}
              title={`${sku} · ${nombre}`}
              className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface-panel text-left transition hover:border-accent/50 hover:shadow-sm"
            >
              <div className="relative aspect-square bg-surface">
                <img
                  src={imgSrcGaleria(img.url, img.path, img.filename)}
                  alt={`${sku} — ${img.filename}`}
                  loading="lazy"
                  className="h-full w-full object-contain p-1"
                  onError={(e) => {
                    const el = e.currentTarget as HTMLImageElement;
                    el.style.display = "none";
                    const fallback = el.nextElementSibling as HTMLElement | null;
                    if (fallback) fallback.classList.remove("hidden");
                  }}
                />
                <div className="hidden absolute inset-0 flex items-center justify-center bg-surface text-[11px] text-muted p-2 text-center">
                  Sin vista previa
                </div>
                {img.principal && (
                  <span className="absolute left-1.5 top-1.5 rounded bg-accent/90 px-1.5 py-0.5 text-[9px] font-bold text-white">
                    Principal
                  </span>
                )}
                {img.width && img.height ? (
                  <span
                    className={`absolute right-1.5 bottom-1.5 rounded px-1.5 py-0.5 text-[9px] font-bold ${
                      img.cumple_estandar
                        ? "bg-green-600/90 text-white"
                        : "bg-amber-500/95 text-white"
                    }`}
                  >
                    {img.width}×{img.height}
                  </span>
                ) : null}
              </div>
              <div className="border-t border-border px-2 py-2 space-y-0.5">
                <p className="font-mono text-xs font-bold text-ink break-all leading-tight">
                  {sku}
                </p>
                <p className="text-[11px] text-muted line-clamp-2 leading-snug">{nombre}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Catálogo para clientes (link a la tienda web) ──────────────────────────

const SITE_URL = "https://mckennagroup.co";

const LINEAS_CATALOGO: { id: string; nombre: string; color: string }[] = [
  { id: "aceites-ceras-grasas", nombre: "Aceites, ceras y grasas", color: "#FFA500" },
  { id: "agro", nombre: "Agro", color: "#359441" },
  { id: "alimentario", nombre: "Alimentario", color: "#1F91DC" },
  { id: "cosmetica", nombre: "Cosmética", color: "#990099" },
  { id: "industria", nombre: "Industria", color: "#5C6570" },
  { id: "laboratorio", nombre: "Laboratorio", color: "#10173C" },
];

function CatalogoClienteView() {
  const [linea, setLinea] = useState<string>("");
  const [copiado, setCopiado] = useState(false);

  const link = linea ? `${SITE_URL}/catalogo?linea=${linea}` : `${SITE_URL}/catalogo`;
  const lineaNombre = LINEAS_CATALOGO.find((l) => l.id === linea)?.nombre;

  async function copiarLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // clipboard puede fallar sin permisos — no bloquea el flujo, el link ya está a la vista
    }
  }

  const mensajeWa = encodeURIComponent(
    `Hola, te comparto el catálogo de McKenna Group${lineaNombre ? ` (línea ${lineaNombre})` : ""} con fotos, presentaciones y precios: ${link}`,
  );

  return (
    <div className="mx-auto max-w-2xl space-y-5 py-2">
      <div>
        <h3 className="text-base font-bold text-ink">Catálogo para clientes</h3>
        <p className="mt-1 text-sm text-muted">
          Un link a la tienda web, siempre con las fotos, presentaciones y precios actuales —
          reemplaza el PDF que se enviaba antes. Compártelo directo por WhatsApp o cópialo.
        </p>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold text-ink">Filtrar por línea (opcional)</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setLinea("")}
            className={`rounded-full border-2 px-3 py-1.5 text-xs font-semibold transition ${
              linea === ""
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-muted hover:border-accent/40"
            }`}
          >
            Catálogo completo
          </button>
          {LINEAS_CATALOGO.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLinea(l.id)}
              className={`inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-xs font-semibold transition ${
                linea === l.id
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-muted hover:border-accent/40"
              }`}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: l.color }} />
              {l.nombre}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border-2 border-border bg-surface p-4">
        <p className="mb-1.5 text-xs font-semibold text-ink">
          {lineaNombre ? `Link — ${lineaNombre}` : "Link — catálogo completo"}
        </p>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-input px-3 py-2">
          <code className="min-w-0 flex-1 truncate text-sm text-ink">{link}</code>
          <button
            type="button"
            onClick={copiarLink}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-semibold text-ink hover:border-accent/40"
          >
            {copiado ? "✓ Copiado" : "Copiar"}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={`https://wa.me/?text=${mensajeWa}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700"
          >
            ✆ Compartir por WhatsApp
          </a>
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border-2 border-border px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent/40"
          >
            ↗ Ver como cliente
          </a>
        </div>
      </div>

      <p className="text-xs text-muted">
        El catálogo se actualiza solo desde SIIGO (fotos, stock, precios) — para corregir un
        producto puntual usa la pestaña "Catálogo" de este panel.
      </p>
    </div>
  );
}

// ── Verificar precios por canal (solo lectura) ─────────────────────────────

function fmtCopCanal(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `$${n.toLocaleString("es-CO")}`;
}

function VerificarPreciosView() {
  const [buscar, setBuscar] = useState("");
  const [q, setQ] = useState("");
  const { data, isLoading, isFetching, isError, error, refetch } = usePreciosCanales(q);
  const items = data?.items ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="shrink-0">
        <h3 className="text-base font-bold text-ink">Verificar precios por canal</h3>
        <p className="mt-1 text-sm text-muted">
          Mercado Libre es la referencia. Siigo debería tener el mismo precio, y Web un 10%
          menos. Filas en rojo necesitan revisión — corrige desde{" "}
          <span className="font-semibold text-ink">Rentabilidad → Ganancia</span>. Las marcadas
          "Pausado" no se están vendiendo en MeLi ahora mismo, así que igualarlas no es urgente.
        </p>
      </div>

      <form
        className="flex shrink-0 flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(buscar.trim());
        }}
      >
        <input
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          placeholder="Buscar SKU o nombre…"
          className="min-w-[200px] flex-1 rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-ink hover:border-accent/50"
        >
          Buscar
        </button>
        <button
          type="button"
          disabled={isFetching}
          onClick={() => void refetch()}
          className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-ink hover:border-accent/50 disabled:opacity-40"
        >
          {isFetching ? "Actualizando…" : "🔄 Actualizar"}
        </button>
      </form>

      {data && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 text-xs">
          <span className="text-muted">{data.total} producto(s)</span>
          <span
            className={
              data.desincronizados_activos > 0
                ? "font-semibold text-danger"
                : "font-semibold text-green-600"
            }
          >
            {data.desincronizados_activos > 0
              ? `⚠ ${data.desincronizados_activos} activo(s) desincronizado(s)`
              : "✓ Activos sincronizados"}
          </span>
          {data.desincronizados > data.desincronizados_activos && (
            <span className="text-muted">
              + {data.desincronizados - data.desincronizados_activos} pausado(s) en MeLi (no urgente)
            </span>
          )}
          {data.actualizado_en && (
            <span className="text-muted">
              Precio MeLi actualizado: {data.actualizado_en}
              {data.cache_hit ? " (caché)" : ""}
            </span>
          )}
        </div>
      )}

      {isError && (
        <p className="shrink-0 text-sm text-danger">
          {error instanceof Error ? error.message : "Error al cargar"}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="sticky top-0 bg-surface-hover text-left text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">Producto</th>
              <th className="px-3 py-2 text-right">MeLi (vivo)</th>
              <th className="px-3 py-2 text-right">Siigo</th>
              <th className="px-3 py-2 text-right">Web</th>
              <th className="px-3 py-2 text-center">Estado</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted">
                  Cargando…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted">
                  Sin resultados.
                </td>
              </tr>
            ) : (
              items.map((it) => {
                // false = mismatch real a corregir · null = el SKU no existe en ese
                // canal (ej. solo se vende por MeLi) — no es un error, no cuenta.
                const desync = it.siigo_sincronizado === false || it.web_sincronizado === false;
                const sinDatos = it.siigo_sincronizado === null && it.web_sincronizado === null;
                const pausado = it.meli_estado !== null && it.meli_estado !== undefined && it.meli_estado !== "active";
                return (
                  <tr
                    key={it.sku}
                    className={`border-t border-border/70 ${
                      desync ? (pausado ? "bg-surface-hover" : "bg-danger/5") : ""
                    }`}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-ink">{it.nombre}</span>
                        {pausado && (
                          <span
                            title="No se está vendiendo ahora mismo en MeLi — corregirlo no es urgente"
                            className="rounded-full border border-border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted"
                          >
                            Pausado
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[11px] text-muted">{it.sku}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">
                      {fmtCopCanal(it.precio_meli)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        it.siigo_sincronizado === false ? "font-semibold text-danger" : "text-ink"
                      }`}
                    >
                      {fmtCopCanal(it.precio_siigo)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        it.web_sincronizado === false ? "font-semibold text-danger" : "text-ink"
                      }`}
                    >
                      {fmtCopCanal(it.precio_web)}
                      {it.web_sincronizado === false && it.web_esperado !== null && (
                        <div className="text-[10px] font-normal text-muted">
                          esperado {fmtCopCanal(it.web_esperado)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {desync ? (
                        <span className="text-danger">⚠</span>
                      ) : sinDatos ? (
                        <span title="Solo en MeLi — sin producto en Siigo/Web" className="text-muted">—</span>
                      ) : (
                        <span className="text-green-600">✓</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Panel principal ────────────────────────────────────────────────────────

type MainView =
  | "catalogo"
  | "compliance"
  | "crear"
  | "galeria"
  | "competencia"
  | "catalogo-cliente"
  | "precios";

export default function PublicacionesPanel() {
  const [mainView, setMainView] = useState<MainView>("catalogo");
  const [buscar, setBuscar] = useState("");
  const [buscarDebounced, setBuscarDebounced] = useState("");
  const [buscarAbierto, setBuscarAbierto] = useState(false);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const buscarInputRef = useRef<HTMLInputElement>(null);

  // Debounce búsqueda
  useEffect(() => {
    const t = setTimeout(() => setBuscarDebounced(buscar), 350);
    return () => clearTimeout(t);
  }, [buscar]);

  useEffect(() => {
    if (buscarAbierto) buscarInputRef.current?.focus();
  }, [buscarAbierto]);

  const { data, isLoading, error, refetch } = usePublicaciones(
    buscarDebounced,
    "",
    "",
  );

  const items = data?.items ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Switcher de vista principal */}
      <div className="flex shrink-0 flex-wrap gap-1 rounded-xl border border-border bg-surface p-1">
        <button
          onClick={() => setMainView("catalogo")}
          className={hubTabClass(mainView === "catalogo", "flex-1 justify-center")}
        >
          <Icon name="folder" size={16} weight="regular" />
          <span className={HUB_TAB_LABEL}>Catálogo</span>
        </button>
        <button
          onClick={() => setMainView("galeria")}
          className={hubTabClass(mainView === "galeria", "flex-1 justify-center")}
        >
          <Icon name="image" size={16} weight="regular" />
          <span className={HUB_TAB_LABEL}>Galería</span>
        </button>
        <button
          onClick={() => setMainView("catalogo-cliente")}
          className={hubTabClass(mainView === "catalogo-cliente", "flex-1 justify-center")}
        >
          <Icon name="link" size={16} weight="regular" />
          <span className={HUB_TAB_LABEL}>Catálogo cliente</span>
        </button>
        <button
          onClick={() => setMainView("precios")}
          className={hubTabClass(mainView === "precios", "flex-1 justify-center")}
        >
          <Icon name="calculator" size={16} weight="regular" />
          <span className={HUB_TAB_LABEL}>Verificar precios</span>
        </button>
        <button
          onClick={() => setMainView("competencia")}
          className={hubTabClass(mainView === "competencia", "flex-1 justify-center")}
        >
          <Icon name="target" size={16} weight="regular" />
          <span className={HUB_TAB_LABEL}>Competencia</span>
        </button>
        <button
          onClick={() => setMainView("compliance")}
          className={hubTabClass(mainView === "compliance", "flex-1 justify-center")}
        >
          <Icon name="refresh" size={16} weight="regular" />
          <span className={HUB_TAB_LABEL}>Republicar MeLi</span>
        </button>
        <button
          onClick={() => setMainView("crear")}
          className={hubTabClass(mainView === "crear", "flex-1 justify-center")}
        >
          <Icon name="plus" size={16} weight="regular" />
          <span className={HUB_TAB_LABEL}>Crear desde cero</span>
        </button>
      </div>

      {/* Vista galería */}
      {mainView === "galeria" && (
        <div className="flex-1 min-h-0 overflow-hidden rounded-xl border border-border bg-surface-panel p-4">
          <GaleriaPublicacionesView
            onAbrirSku={(sku) => {
              setSelectedSku(sku);
              setMainView("catalogo");
            }}
          />
        </div>
      )}

      {/* Vista catálogo cliente */}
      {mainView === "catalogo-cliente" && (
        <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-border bg-surface-panel p-5">
          <CatalogoClienteView />
        </div>
      )}

      {/* Vista verificar precios */}
      {mainView === "precios" && (
        <div className="flex-1 min-h-0 overflow-hidden rounded-xl border border-border bg-surface-panel p-4">
          <VerificarPreciosView />
        </div>
      )}

      {/* Vista crear desde cero */}
      {mainView === "crear" && (
        <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-border bg-surface-panel p-5">
          <CrearDesdeCeroPanel onDone={() => setMainView("compliance")} />
        </div>
      )}

      {/* Vista compliance */}
      {mainView === "compliance" && (
        <div className="flex-1 min-h-0">
          <MeliComplianceTab />
        </div>
      )}

      {mainView === "competencia" && (
        <div className="flex-1 min-h-0">
          <CompetenciaPreciosPanel />
        </div>
      )}

      {/* Vista catálogo — listado → editor Web | MeLi */}
      {mainView === "catalogo" && (
      <div className="flex flex-1 min-h-0 flex-col gap-4 lg:flex-row">
      {/* Columna izquierda: solo listado */}
      <div
        className={`flex flex-col gap-3 lg:w-[320px] lg:shrink-0 ${selectedSku ? "hidden lg:flex" : "flex"}`}
      >
        <div className="flex items-center gap-2">
          {buscarAbierto || buscar ? (
            <div className="flex flex-1 items-center gap-1.5 rounded-lg border border-border bg-surface-input px-2 py-1.5">
              <Icon name="search" size={16} weight="regular" className="shrink-0 text-muted" />
              <input
                ref={buscarInputRef}
                type="text"
                value={buscar}
                onChange={(e) => setBuscar(e.target.value)}
                onBlur={() => {
                  if (!buscar) setBuscarAbierto(false);
                }}
                placeholder="Buscar…"
                className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted/50"
              />
              <button
                type="button"
                title="Cerrar búsqueda"
                onClick={() => {
                  setBuscar("");
                  setBuscarAbierto(false);
                }}
                className="rounded p-0.5 text-muted hover:text-ink"
              >
                <Icon name="close" size={14} weight="regular" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              title="Buscar"
              onClick={() => setBuscarAbierto(true)}
              className="inline-flex items-center justify-center rounded-lg border border-border bg-surface p-2 text-muted transition hover:border-accent/40 hover:text-ink"
            >
              <Icon name="search" size={18} weight="regular" />
            </button>
          )}
        </div>

        {/* Lista de productos — solo nombres */}
        <div className="flex-1 overflow-y-auto rounded-xl border border-border bg-surface-panel pr-0.5">
          {isLoading && (
            <div className="flex justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
              Error al cargar publicaciones.{" "}
              <button onClick={() => refetch()} className="underline">
                Reintentar
              </button>
            </div>
          )}
          {!isLoading && items.length === 0 && !error && (
            <p className="py-8 text-center text-sm text-muted">
              {buscar ? "Sin resultados." : "No hay productos en el catálogo."}
            </p>
          )}
          {items.map((item) => {
            const presSkus = new Set((item.presentaciones || []).map((p) => p.sku));
            return (
              <ProductoCard
                key={item.sku}
                item={item}
                selected={selectedSku === item.sku || (!!selectedSku && presSkus.has(selectedSku))}
                selectedSku={selectedSku}
                onClick={() => setSelectedSku(item.sku === selectedSku ? null : item.sku)}
                onSelectPresentacion={(sku) => setSelectedSku(sku === selectedSku ? null : sku)}
              />
            );
          })}
        </div>
      </div>

      {/* Columna derecha: editor */}
      {selectedSku ? (
        <div className="flex-1 overflow-y-auto rounded-xl border border-border bg-surface-panel p-5">
          <EditorPanel sku={selectedSku} onClose={() => setSelectedSku(null)} />
        </div>
      ) : (
        <div className="hidden flex-1 items-center justify-center rounded-xl border-2 border-dashed border-border text-muted lg:flex">
          <div className="max-w-sm px-6 text-center">
            <p className="text-sm font-semibold text-ink">Elige un producto del listado</p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              Se abren dos ventanas: <span className="font-semibold text-ink">Página web</span> y{" "}
              <span className="font-semibold text-ink">Mercado Libre</span> — ocultar en tienda,
              precio MeLi y fotos de cada sitio.
            </p>
          </div>
        </div>
      )}
      </div>
      )}
    </div>
  );
}
