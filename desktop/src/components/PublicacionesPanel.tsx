import { useState, useEffect, useRef, useCallback } from "react";
import { ProseTextarea } from "./ProseTextarea";
import {
  usePublicaciones,
  usePublicacionDetalle,
  useGuardarPublicacion,
  useSyncWeb,
  useSyncMeli,
  useRefreshWeb,
  useFotosActuales,
  useSubirImagen,
  useReordenarImagenesWeb,
  useReordenarImagenesMeli,
  useEliminarImagenes,
  type PublicacionItem,
  type SyncStatus,
} from "../hooks/usePublicaciones";

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

// ── Card de producto en la lista ───────────────────────────────────────────

function ProductoCard({
  item,
  selected,
  onClick,
}: {
  item: PublicacionItem;
  selected: boolean;
  onClick: () => void;
}) {
  const fotoUrl = item.foto_efectiva
    ? item.foto_efectiva.startsWith("http")
      ? item.foto_efectiva
      : `https://mckennagroup.co${item.foto_efectiva}`
    : null;

  const webOk = item.sync_web.status === "ok";
  const meliOk = item.sync_meli.status === "linked";

  return (
    <button
      onClick={onClick}
      className={`w-full rounded-xl border-2 p-3 text-left transition ${
        selected
          ? "border-accent bg-accent/5"
          : "border-border hover:border-accent/40 hover:bg-surface-hover"
      }`}
    >
      <div className="flex gap-3">
        {/* Foto miniatura */}
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-surface">
          {fotoUrl ? (
            <img
              src={fotoUrl}
              alt={item.nombre}
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted text-xs">
              —
            </div>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{item.nombre}</p>
          <p className="text-[11px] text-muted">{item.sku}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <SyncBadge status={item.sync_web} label="Web" compact />
            <SyncBadge status={item.sync_meli} label="MeLi" compact />
            {item.tiene_override && (
              <span className="rounded-full border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                Editado
              </span>
            )}
          </div>
        </div>

        {/* Precio */}
        <div className="shrink-0 text-right">
          <p className="text-sm font-bold text-ink">
            {item.precio_web > 0
              ? `$${item.precio_web.toLocaleString("es-CO")}`
              : "—"}
          </p>
          {!webOk || !meliOk ? (
            <span className="text-[10px] text-warning">⚠ Incompleto</span>
          ) : (
            <span className="text-[10px] text-green-600">✓ Listo</span>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Sortable image grid ────────────────────────────────────────────────────

type ImgItem = { id: string; url: string; principal: boolean; extra?: Record<string, unknown> };

function ImageGrid({
  items,
  plataforma,
  onReorder,
  onDelete,
  onSetPrincipal,
  saving,
}: {
  items: ImgItem[];
  plataforma: "web" | "meli";
  onReorder: (newOrder: ImgItem[]) => void;
  onDelete: (item: ImgItem) => void;
  onSetPrincipal: (item: ImgItem) => void;
  saving?: boolean;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  function handleDragStart(i: number) {
    setDragIdx(i);
  }
  function handleDragEnter(i: number) {
    if (dragIdx === null || i === dragIdx) return;
    setOverIdx(i);
  }
  function handleDragEnd() {
    if (dragIdx !== null && overIdx !== null && dragIdx !== overIdx) {
      const next = [...items];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(overIdx, 0, moved);
      // actualiza flag principal (primera posición)
      next.forEach((it, idx) => { it.principal = idx === 0; });
      onReorder(next);
    }
    setDragIdx(null);
    setOverIdx(null);
  }

  if (items.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-muted">
        Sin imágenes en {plataforma === "web" ? "Web/SIIGO" : "MercadoLibre"}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      {items.map((item, i) => (
        <div
          key={item.id}
          draggable
          onDragStart={() => handleDragStart(i)}
          onDragEnter={() => handleDragEnter(i)}
          onDragOver={(e) => e.preventDefault()}
          onDragEnd={handleDragEnd}
          className={`relative w-28 shrink-0 cursor-grab rounded-xl border-2 bg-surface transition ${
            dragIdx === i
              ? "opacity-40 scale-95"
              : overIdx === i
                ? "border-accent shadow-lg"
                : item.principal
                  ? "border-yellow-400"
                  : "border-border hover:border-accent/40"
          }`}
        >
          {/* Foto */}
          <div className="h-24 overflow-hidden rounded-t-lg bg-surface-hover">
            <img
              src={item.url}
              alt=""
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = "";
                (e.currentTarget as HTMLImageElement).style.background = "#eee";
              }}
            />
          </div>

          {/* Badge principal */}
          {item.principal && (
            <div className="absolute left-1 top-1 rounded-full bg-yellow-400 px-1.5 py-0.5 text-[10px] font-black text-black shadow">
              ★ Principal
            </div>
          )}

          {/* Índice de orden */}
          <div className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-[10px] font-bold text-white">
            {i + 1}
          </div>

          {/* Acciones */}
          <div className="flex items-center justify-between rounded-b-lg border-t border-border bg-surface px-1 py-1">
            {!item.principal && (
              <button
                onClick={() => onSetPrincipal(item)}
                disabled={saving}
                title="Establecer como principal"
                className="flex-1 rounded py-0.5 text-center text-[10px] font-semibold text-muted hover:text-yellow-600"
              >
                ☆ Princ.
              </button>
            )}
            {item.principal && <span className="flex-1" />}
            <button
              onClick={() => onDelete(item)}
              disabled={saving}
              title="Eliminar imagen"
              className="ml-1 rounded p-0.5 text-[10px] text-muted hover:text-danger disabled:opacity-40"
            >
              🗑
            </button>
          </div>
        </div>
      ))}

      {/* Hint */}
      {items.length > 1 && (
        <div className="flex w-full items-center gap-1 text-[10px] text-muted">
          <span>☰ Arrastra para reordenar · ★ = imagen principal del catálogo</span>
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
        url: img.url,
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
              {fotos?.web.total ?? 0} imagen(es) · La primera es la principal del catálogo
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
              <p className="text-xs text-muted">JPG, PNG, WEBP · Puedes seleccionar varios archivos a la vez</p>
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


// ── Panel de edición ───────────────────────────────────────────────────────

export function EditorPanel({
  sku,
  onClose,
  layout: _layout,
  onEstadoMarcado: _onEstadoMarcado,
}: {
  sku: string;
  onClose: () => void;
  layout?: string;
  onEstadoMarcado?: (estado: "" | "omitir" | "por_publicar") => void;
}) {
  const { data, isLoading, error, refetch } = usePublicacionDetalle(sku);
  const guardarMut = useGuardarPublicacion();
  const syncWebMut = useSyncWeb(sku);
  const syncMeliMut = useSyncMeli(sku);

  const [descripcion, setDescripcion] = useState("");
  const [fotoUrl, setFotoUrl] = useState("");
  const [meliItemId, setMeliItemId] = useState("");
  const [ocultoWeb, setOcultoWeb] = useState(false);
  const [caracteristicas, setCaracteristicas] = useState<
    { titulo: string; valor: string }[]
  >([]);
  const [stockMeli, setStockMeli] = useState("");
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<"general" | "imagenes" | "meli" | "ficha">("general");

  useEffect(() => {
    if (!data) return;
    setDescripcion(data.desc_override || data.desc_cache || "");
    setFotoUrl(data.foto_url_override || "");
    setMeliItemId(data.meli_item_id_override || data.meli_item_id_cache || "");
    setOcultoWeb(data.oculto_web);
    setCaracteristicas(data.caracteristicas || []);
    setSaved(false);
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger/5 p-5 text-sm text-danger">
        Error cargando producto. <button onClick={() => refetch()} className="underline">Reintentar</button>
      </div>
    );
  }

  const fotoEfectiva = fotoUrl || data.foto_url_cache;
  const fotoPreviewUrl = fotoEfectiva
    ? fotoEfectiva.startsWith("http")
      ? fotoEfectiva
      : `https://mckennagroup.co${fotoEfectiva}`
    : null;

  async function handleGuardar() {
    await guardarMut.mutateAsync({
      sku,
      campos: {
        descripcion: descripcion || undefined,
        foto_url: fotoUrl || undefined,
        meli_item_id: meliItemId || undefined,
        caracteristicas: caracteristicas.length ? caracteristicas : undefined,
        oculto_web: ocultoWeb || undefined,
      },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  function addCaracteristica() {
    setCaracteristicas((c) => [...c, { titulo: "", valor: "" }]);
  }

  function removeCaracteristica(i: number) {
    setCaracteristicas((c) => c.filter((_, idx) => idx !== i));
  }

  function updateCaracteristica(
    i: number,
    field: "titulo" | "valor",
    value: string,
  ) {
    setCaracteristicas((c) =>
      c.map((item, idx) => (idx === i ? { ...item, [field]: value } : item)),
    );
  }

  const meli = data.meli_live;

  return (
    <div className="flex flex-col gap-4">
      {/* Header del editor */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-ink leading-tight">{data.nombre}</h3>
          <p className="text-xs text-muted mt-0.5">
            {data.sku} · {data.categoria}
          </p>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-ink"
        >
          ✕
        </button>
      </div>

      {/* Indicadores de estado */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-border bg-surface px-3 py-2 text-center">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted">SIIGO</p>
          <p className="mt-0.5 text-sm font-bold text-green-600">Fuente</p>
          <p className="text-[11px] text-muted">
            ${data.precio_lista.toLocaleString("es-CO")}
          </p>
        </div>
        <div
          className={`rounded-lg border px-3 py-2 text-center ${
            data.sync_web.status === "ok"
              ? "border-green-200 bg-green-50"
              : "border-yellow-200 bg-yellow-50"
          }`}
        >
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted">WEB</p>
          <p
            className={`mt-0.5 text-sm font-bold ${
              data.sync_web.status === "ok" ? "text-green-700" : "text-yellow-700"
            }`}
          >
            {data.sync_web.status === "ok" ? "Completo" : "Incompleto"}
          </p>
          <p className="text-[11px] text-muted">{data.sync_web.mensaje}</p>
        </div>
        <div
          className={`rounded-lg border px-3 py-2 text-center ${
            data.sync_meli.status === "linked"
              ? "border-blue-200 bg-blue-50"
              : "border-gray-200 bg-gray-50"
          }`}
        >
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted">MELI</p>
          <p
            className={`mt-0.5 text-sm font-bold ${
              data.sync_meli.status === "linked" ? "text-blue-700" : "text-gray-500"
            }`}
          >
            {data.sync_meli.status === "linked" ? "Vinculado" : "Sin vincular"}
          </p>
          {meli ? (
            <p className="text-[11px] text-muted">
              Stock: {(meli as Record<string, unknown>).available_quantity as number ?? "—"}
            </p>
          ) : (
            <p className="text-[11px] text-muted">{data.meli_id_efectivo || "—"}</p>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-border bg-surface p-1">
        {(["general", "imagenes", "meli", "ficha"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition ${
              tab === t
                ? "bg-accent text-white shadow-sm"
                : "text-muted hover:text-ink"
            }`}
          >
            {t === "general"
              ? "General"
              : t === "imagenes"
                ? "Imágenes"
                : t === "meli"
                  ? "MeLi"
                  : "Ficha"}
          </button>
        ))}
      </div>

      {/* Tab: General */}
      {tab === "general" && (
        <div className="space-y-4">
          {/* Acceso rápido a imágenes */}
          <button
            onClick={() => setTab("imagenes")}
            className="flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-border bg-surface px-4 py-3 text-left text-sm transition hover:border-accent/40 hover:bg-surface-hover"
          >
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-surface-hover">
              {fotoPreviewUrl ? (
                <img src={fotoPreviewUrl} alt="foto" className="h-full w-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted text-xs">—</div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-ink">Gestión de imágenes</p>
              <p className="text-xs text-muted">Subir foto a Web / SIIGO y MercadoLibre →</p>
            </div>
          </button>

          {/* Descripción */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-ink">
              Descripción para la web
            </label>
            <ProseTextarea
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              rows={5}
              maxLength={600}
              placeholder="Descripción del producto para la tienda web y catálogo..."
              className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none placeholder:text-muted/50 focus:border-accent resize-y"
            />
            <p className="mt-0.5 text-right text-[11px] text-muted">
              {descripcion.length}/600
            </p>
          </div>

          {/* Características */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-semibold text-ink">Características</label>
              <button
                onClick={addCaracteristica}
                className="rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent hover:bg-accent/20"
              >
                + Agregar
              </button>
            </div>
            <div className="space-y-2">
              {caracteristicas.map((c, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={c.titulo}
                    onChange={(e) => updateCaracteristica(i, "titulo", e.target.value)}
                    placeholder="Nombre (ej: Pureza)"
                    className="w-2/5 rounded-lg border border-border bg-surface-input px-2.5 py-1.5 text-xs text-ink outline-none focus:border-accent"
                  />
                  <input
                    value={c.valor}
                    onChange={(e) => updateCaracteristica(i, "valor", e.target.value)}
                    placeholder="Valor (ej: 99%)"
                    className="flex-1 rounded-lg border border-border bg-surface-input px-2.5 py-1.5 text-xs text-ink outline-none focus:border-accent"
                  />
                  <button
                    onClick={() => removeCaracteristica(i)}
                    className="rounded-lg border border-border px-2 py-1.5 text-xs text-muted hover:border-danger/40 hover:text-danger"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {caracteristicas.length === 0 && (
                <p className="text-xs text-muted">Sin características personalizadas</p>
              )}
            </div>
          </div>

          {/* Ocultar en web */}
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
            <input
              type="checkbox"
              checked={ocultoWeb}
              onChange={(e) => setOcultoWeb(e.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            <div>
              <p className="text-sm font-semibold text-ink">Ocultar en la tienda web</p>
              <p className="text-xs text-muted">El producto solo se verá en vitrina, sin botón de compra</p>
            </div>
          </label>
        </div>
      )}

      {/* Tab: Imágenes */}
      {tab === "imagenes" && (
        <ImagenesTab sku={sku} meliItemId={meliItemId} />
      )}

      {/* Tab: MeLi */}
      {tab === "meli" && (
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-ink">
              ID de publicación en MercadoLibre
            </label>
            <input
              type="text"
              value={meliItemId}
              onChange={(e) => setMeliItemId(e.target.value)}
              placeholder="MCO123456789"
              className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm font-mono text-ink outline-none placeholder:text-muted/50 focus:border-accent"
            />
            {data.meli_item_id_cache && (
              <p className="mt-1 text-[11px] text-muted">
                ID en caché: <span className="font-mono">{data.meli_item_id_cache}</span>
              </p>
            )}
          </div>

          {meli ? (
            <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-4">
              <p className="text-xs font-bold text-blue-800">Datos en vivo de MeLi</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-muted">Stock</p>
                  <p className="font-bold text-ink">
                    {String((meli as Record<string, unknown>).available_quantity ?? "—")}
                  </p>
                </div>
                <div>
                  <p className="text-muted">Estado</p>
                  <p className="font-bold text-ink capitalize">
                    {String((meli as Record<string, unknown>).status ?? "—")}
                  </p>
                </div>
                <div>
                  <p className="text-muted">Precio MeLi</p>
                  <p className="font-bold text-ink">
                    {(meli as Record<string, unknown>).price
                      ? `$${Number((meli as Record<string, unknown>).price).toLocaleString("es-CO")}`
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted">Condición</p>
                  <p className="font-bold text-ink capitalize">
                    {String((meli as Record<string, unknown>).condition ?? "—")}
                  </p>
                </div>
              </div>
              {Boolean((meli as Record<string, unknown>).permalink) && (
                <a
                  href={String((meli as Record<string, unknown>).permalink)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 underline"
                >
                  Ver publicación en MeLi ↗
                </a>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-surface p-4 text-xs text-muted">
              <p>Los datos en vivo de MeLi se cargan al abrir el detalle con el botón "Refrescar MeLi".</p>
            </div>
          )}

          {/* Sync stock MeLi */}
          {(data.meli_id_efectivo || meliItemId) && (
            <div className="rounded-xl border border-border bg-surface p-4 space-y-2">
              <p className="text-xs font-semibold text-ink">Actualizar stock en MeLi</p>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={stockMeli}
                  onChange={(e) => setStockMeli(e.target.value)}
                  placeholder="Cantidad"
                  min={0}
                  className="w-32 rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                />
                <button
                  onClick={() => syncMeliMut.mutate(Number(stockMeli))}
                  disabled={!stockMeli || syncMeliMut.isPending}
                  className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-40"
                >
                  {syncMeliMut.isPending ? "Sincronizando..." : "Actualizar stock MeLi"}
                </button>
              </div>
              {syncMeliMut.isSuccess && (
                <p className="text-xs text-green-600">
                  ✓ {String((syncMeliMut.data as Record<string, unknown>)?.resultado ?? "Stock actualizado")}
                </p>
              )}
              {syncMeliMut.isError && (
                <p className="text-xs text-danger">{syncMeliMut.error.message}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab: Ficha técnica */}
      {tab === "ficha" && (
        <div className="space-y-3">
          {data.ficha && Object.keys(data.ficha).length > 0 ? (
            <>
              {(data.ficha as Record<string, unknown>).titulo && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Título</p>
                  <p className="text-sm font-semibold text-ink">
                    {String((data.ficha as Record<string, unknown>).titulo)}
                  </p>
                </div>
              )}
              {(data.ficha as Record<string, unknown>).descripcion && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Descripción técnica</p>
                  <p className="text-sm text-ink">
                    {String((data.ficha as Record<string, unknown>).descripcion)}
                  </p>
                </div>
              )}
              {Array.isArray((data.ficha as Record<string, unknown>).secciones) &&
                ((data.ficha as Record<string, unknown>).secciones as unknown[]).length > 0 && (
                  <div className="space-y-3">
                    {((data.ficha as Record<string, unknown>).secciones as { titulo?: string; items?: unknown[] }[]).map(
                      (s, i) => (
                        <div key={i} className="rounded-lg border border-border bg-surface p-3">
                          {s.titulo && (
                            <p className="mb-2 text-xs font-bold text-ink uppercase tracking-wide">
                              {s.titulo}
                            </p>
                          )}
                          <ul className="space-y-1">
                            {(s.items || []).map((item, j) => (
                              <li key={j} className="flex gap-2 text-xs text-ink-secondary">
                                <span className="mt-0.5 shrink-0 text-muted">•</span>
                                <span>{String(item)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ),
                    )}
                  </div>
                )}
            </>
          ) : (
            <p className="text-sm text-muted">Sin ficha técnica en el catálogo.</p>
          )}
        </div>
      )}

      {/* Botones de acción */}
      <div className="sticky bottom-0 rounded-xl border border-border bg-surface-panel p-3 shadow-sm space-y-2">
        <div className="flex gap-2">
          <button
            onClick={handleGuardar}
            disabled={guardarMut.isPending}
            className="flex-1 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-hover disabled:opacity-40"
          >
            {guardarMut.isPending
              ? "Guardando..."
              : saved
                ? "✓ Guardado"
                : "Guardar cambios"}
          </button>
          <button
            onClick={() => syncWebMut.mutate()}
            disabled={syncWebMut.isPending}
            title="Aplica los cambios guardados al cache de la tienda web"
            className="rounded-lg border-2 border-border bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-accent/40 disabled:opacity-40"
          >
            {syncWebMut.isPending ? "..." : "↑ Web"}
          </button>
        </div>
        {guardarMut.isError && (
          <p className="text-xs text-danger">{guardarMut.error.message}</p>
        )}
        {syncWebMut.isSuccess && (
          <p className="text-xs text-green-600">
            ✓ {String(
              ((syncWebMut.data as Record<string, unknown>)?.cache as Record<string, unknown>)?.mensaje
              ?? "Cache web actualizado",
            )}
          </p>
        )}
        {syncWebMut.isError && (
          <p className="text-xs text-danger">{syncWebMut.error.message}</p>
        )}
      </div>
    </div>
  );
}

// ── Panel principal ────────────────────────────────────────────────────────

export default function PublicacionesPanel() {
  const [buscar, setBuscar] = useState("");
  const [buscarDebounced, setBuscarDebounced] = useState("");
  const [categoriaFiltro, setCategoriaFiltro] = useState("");
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const syncAllMut = useSyncWeb();
  const refreshWebMut = useRefreshWeb();

  // Debounce búsqueda
  useEffect(() => {
    const t = setTimeout(() => setBuscarDebounced(buscar), 350);
    return () => clearTimeout(t);
  }, [buscar]);

  const { data, isLoading, error, refetch } = usePublicaciones(
    buscarDebounced,
    categoriaFiltro,
  );

  const items = data?.items ?? [];
  const categorias = data?.categorias ?? [];

  // Contadores de estado
  const totalOk = items.filter(
    (i) => i.sync_web.status === "ok" && i.sync_meli.status === "linked",
  ).length;
  const webIncompleto = items.filter((i) => i.sync_web.status !== "ok").length;
  const sinMeli = items.filter((i) => i.sync_meli.status === "no_listing").length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 lg:flex-row">
      {/* Columna izquierda: lista */}
      <div
        className={`flex flex-col gap-3 lg:w-[420px] lg:shrink-0 ${selectedSku ? "hidden lg:flex" : "flex"}`}
      >
        {/* Resumen de estado */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-center">
            <p className="text-lg font-black text-green-700">{totalOk}</p>
            <p className="text-[11px] font-semibold text-green-600">Listos</p>
          </div>
          <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-center">
            <p className="text-lg font-black text-yellow-700">{webIncompleto}</p>
            <p className="text-[11px] font-semibold text-yellow-600">Web incompleta</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-center">
            <p className="text-lg font-black text-gray-600">{sinMeli}</p>
            <p className="text-[11px] font-semibold text-gray-500">Sin MeLi</p>
          </div>
        </div>

        {/* Acciones globales */}
        <div className="flex gap-2">
          <button
            onClick={() => syncAllMut.mutate()}
            disabled={syncAllMut.isPending}
            title="Aplica todos los overrides guardados al cache de la tienda web"
            className="flex-1 rounded-lg border-2 border-accent/30 bg-accent/10 px-3 py-2 text-xs font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-40"
          >
            {syncAllMut.isPending ? "Sincronizando..." : "↑ Sync todos a Web"}
          </button>
          <button
            onClick={() => refreshWebMut.mutate()}
            disabled={refreshWebMut.isPending}
            title="Recarga el catálogo desde SIIGO (borra overrides del cache, los overrides guardados se conservan)"
            className="rounded-lg border-2 border-border bg-surface px-3 py-2 text-xs font-semibold text-muted transition hover:border-accent/30 hover:text-ink disabled:opacity-40"
          >
            {refreshWebMut.isPending ? "..." : "↺ Reload SIIGO"}
          </button>
        </div>

        {/* Mensajes globales */}
        {syncAllMut.isSuccess && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">
            ✓ {String(
              ((syncAllMut.data as Record<string, unknown>)?.cache as Record<string, unknown>)?.mensaje
              ?? "Cache actualizado",
            )}
          </p>
        )}
        {refreshWebMut.isSuccess && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">
            ✓ Catálogo recargado desde SIIGO
          </p>
        )}
        {refreshWebMut.isError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            {refreshWebMut.error.message}
          </p>
        )}

        {/* Filtros */}
        <div className="flex gap-2">
          <input
            type="text"
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Buscar por nombre o SKU..."
            className="flex-1 rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none placeholder:text-muted/50 focus:border-accent"
          />
          <select
            value={categoriaFiltro}
            onChange={(e) => setCategoriaFiltro(e.target.value)}
            className="rounded-lg border border-border bg-surface-input px-2 py-2 text-sm text-ink outline-none focus:border-accent"
          >
            <option value="">Todas</option>
            {categorias.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* Lista de productos */}
        <div className="flex-1 space-y-2 overflow-y-auto pr-0.5">
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
              {buscar || categoriaFiltro
                ? "Sin resultados con estos filtros."
                : "No hay productos en el catálogo. Usa 'Reload SIIGO' para cargar."}
            </p>
          )}
          {items.map((item) => (
            <ProductoCard
              key={item.sku}
              item={item}
              selected={selectedSku === item.sku}
              onClick={() => setSelectedSku(item.sku === selectedSku ? null : item.sku)}
            />
          ))}
        </div>
      </div>

      {/* Columna derecha: editor */}
      {selectedSku ? (
        <div className="flex-1 overflow-y-auto rounded-xl border border-border bg-surface-panel p-5">
          <EditorPanel sku={selectedSku} onClose={() => setSelectedSku(null)} />
        </div>
      ) : (
        <div className="hidden flex-1 items-center justify-center rounded-xl border-2 border-dashed border-border text-muted lg:flex">
          <div className="text-center">
            <p className="text-4xl opacity-20">🛒</p>
            <p className="mt-2 text-sm">Selecciona un producto para editar</p>
          </div>
        </div>
      )}
    </div>
  );
}
