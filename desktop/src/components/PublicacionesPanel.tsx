import { useState, useEffect, useRef, useCallback } from "react";
import { ProseTextarea } from "./ProseTextarea";
import MeliComplianceTab, { CrearDesdeCeroPanel } from "./MeliComplianceTab";
import CompetenciaPreciosPanel from "./CompetenciaPreciosPanel";
import { HUB_TAB_LABEL, hubTabClass } from "../lib/hubTabClass";
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
  useGaleriaPublicaciones,
  useNormalizarImagenesCatalogo,
  usePreciosCanales,
  useEstadoMeli,
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

// ── Card de producto en la lista ───────────────────────────────────────────

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
  const fotoUrl = item.foto_efectiva ? resolverFotoPreview(item.foto_efectiva) : null;

  const webOk = item.sync_web.status === "ok";
  const meliOk = item.sync_meli.status === "linked";
  const presentaciones = item.presentaciones || [];
  const tieneVarias = presentaciones.length > 1;

  return (
    <div
      className={`w-full rounded-xl border-2 transition ${
        selected
          ? "border-accent bg-accent/5"
          : "border-border hover:border-accent/40 hover:bg-surface-hover"
      }`}
    >
      <button onClick={onClick} className="w-full p-3 text-left">
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
              {item.oculto_web && (
                <span className="rounded-full border border-border bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                  Oculto web
                </span>
              )}
              {tieneVarias && (
                <span className="rounded-full border border-border bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                  {presentaciones.length} presentaciones
                </span>
              )}
            </div>
          </div>

          {/* Precio + enlace MeLi */}
          <div className="shrink-0 text-right space-y-1">
            <p className="text-sm font-bold text-ink">
              {item.precio_web > 0
                ? `$${item.precio_web.toLocaleString("es-CO")}`
                : "—"}
            </p>
            {item.url_web ? (
              <a
                href={item.url_web}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-0.5 rounded border border-green-200 bg-green-50 px-1.5 py-0.5 text-[10px] font-semibold text-green-800 hover:bg-green-100"
                title={item.visible_web ? "Cómo se ve en la tienda" : "Ficha web (puede no estar visible)"}
              >
                ↗ Web
              </a>
            ) : null}
            {item.meli_compliance_reemplazo?.url_meli ? (
              <a
                href={item.meli_compliance_reemplazo.url_meli}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-0.5 rounded border border-teal-300 bg-teal-50 px-1.5 py-0.5 text-[10px] font-bold text-teal-800 hover:bg-teal-100"
                title={`Reemplazo compliance · ${item.meli_compliance_reemplazo.estado_actual}`}
              >
                ↗ MeLi {item.meli_compliance_reemplazo.estado_actual === "active" ? "✓" : "!"}
              </a>
            ) : item.meli_url ? (
              <a
                href={item.meli_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-0.5 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100"
              >
                ↗ MeLi
              </a>
            ) : null}
            {!webOk || !meliOk ? (
              <p className="text-[10px] text-warning">⚠ Incompleto</p>
            ) : (
              <p className="text-[10px] text-green-600">✓ Listo</p>
            )}
          </div>
        </div>
      </button>

      {tieneVarias && (
        <div className="border-t border-border/60 px-3 py-2">
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">
            {presentaciones.length} presentaciones — clic para editar cada una
          </p>
          <div className="space-y-1 pb-0.5">
            {presentaciones.map((pres) => (
              <button
                key={pres.sku}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectPresentacion(pres.sku);
                }}
                className={`flex w-full items-center justify-between rounded-lg border px-2 py-1.5 text-left text-xs transition ${
                  selectedSku === pres.sku
                    ? "border-accent bg-accent/10"
                    : "border-border/70 hover:border-accent/40 hover:bg-surface-hover"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-ink">
                    {pres.presentacion_label || pres.sku}
                  </span>
                  <span className="ml-1.5 text-muted">{pres.sku}</span>
                </span>
                <span className="ml-2 flex shrink-0 items-center gap-2">
                  {pres.stock !== null && pres.stock !== undefined && (
                    <span className={`text-[10px] ${pres.stock > 0 ? "text-muted" : "text-danger"}`}>
                      stock {pres.stock}
                    </span>
                  )}
                  <span className="font-bold text-ink">
                    {pres.precio_web > 0 ? `$${pres.precio_web.toLocaleString("es-CO")}` : "—"}
                  </span>
                  {pres.meli_id ? (
                    <span title="Vinculado a MeLi" className="text-green-600">●</span>
                  ) : (
                    <span title="Sin publicación MeLi" className="text-danger">○</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
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
  const vista: VistaSitios | undefined = data.vista_sitios;
  const web = vista?.web;
  const meli = vista?.meli;
  const filas: PresentacionSitio[] = vista?.presentaciones?.length
    ? vista.presentaciones
    : [];

  const estadoMeli = (meli?.estado || "").toLowerCase();
  const meliActivo = estadoMeli === "active";
  const meliPausado = estadoMeli === "paused";
  const tieneMeli = Boolean(meli?.item_id || data.meli_id_efectivo);

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted">
        Misma ficha, dos vitrinas: en la web se agrupa por familia (botones de presentación);
        en Mercado Libre cada presentación es una publicación aparte. La tienda solo lista
        SKUs con ID MeLi vinculado.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        {/* Web */}
        <div className="rounded-xl border border-green-200 bg-green-50/40 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-bold text-ink">Página web</h4>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                web?.visible
                  ? "border-green-300 bg-green-100 text-green-800"
                  : "border-border bg-surface text-muted"
              }`}
            >
              {web?.visible ? (web.vitrina ? "Vitrina" : "Visible") : "No se muestra"}
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
              {filas.length > 1 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {filas.map((f) => (
                    <span
                      key={f.sku}
                      title={f.sku}
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                        f.aparece_en_web
                          ? "border-green-300 bg-white text-green-800"
                          : "border-border bg-surface text-muted line-through"
                      }`}
                    >
                      {f.web.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          {web?.motivo_oculto && (
            <p className="rounded-lg border border-yellow-200 bg-yellow-50 px-2.5 py-1.5 text-[11px] text-yellow-800">
              {web.motivo_oculto}
            </p>
          )}
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-white/80 px-3 py-2">
            <input
              type="checkbox"
              checked={ocultoWeb}
              onChange={(e) => onToggleOculto(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-accent"
            />
            <span>
              <span className="block text-xs font-semibold text-ink">Ocultar en la tienda</span>
              <span className="block text-[11px] text-muted">Queda en vitrina, sin botón de compra. Recuerda Guardar y ↑ Web.</span>
            </span>
          </label>
          {web?.url && (
            <a
              href={web.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-green-800 underline"
            >
              Ver como cliente ↗
            </a>
          )}
        </div>

        {/* MeLi */}
        <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-bold text-ink">Mercado Libre</h4>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                meliActivo
                  ? "border-blue-300 bg-blue-100 text-blue-800"
                  : meliPausado
                    ? "border-yellow-300 bg-yellow-100 text-yellow-800"
                    : "border-border bg-surface text-muted"
              }`}
            >
              {tieneMeli ? (estadoMeli || "Vinculado") : "Sin vincular"}
            </span>
          </div>
          <div className="flex gap-3">
            <FotoSitio src={meli?.foto || data.foto_efectiva} alt={meli?.titulo || data.nombre} />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-semibold leading-tight text-ink">
                {meli?.titulo || data.nombre}
              </p>
              <p className="font-mono text-[11px] text-muted">{meli?.item_id || data.meli_id_efectivo || "—"}</p>
              <p className="text-sm font-bold text-ink">{fmtCopSitio(meli?.precio)}</p>
              {meli?.stock != null && (
                <p className="text-[11px] text-muted">Stock {meli.stock}</p>
              )}
            </div>
          </div>
          {tieneMeli ? (
            <div className="flex flex-wrap gap-2">
              {meli?.permalink && (
                <a
                  href={meli.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-800 underline"
                >
                  Ver publicación ↗
                </a>
              )}
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
                  className="rounded-lg border border-blue-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-blue-800 hover:bg-blue-50 disabled:opacity-40"
                >
                  {estadoMut.isPending
                    ? "…"
                    : meliActivo
                      ? "Pausar en MeLi"
                      : "Activar en MeLi"}
                </button>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-muted">
              Vincula el ID MCO en la pestaña MeLi para gestionar esta publicación.
            </p>
          )}
          {estadoMut.isSuccess && (
            <p className="text-xs text-green-700">
              ✓ {estadoMut.data?.mensaje || `Estado: ${estadoMut.data?.estado}`}
            </p>
          )}
          {estadoMut.isError && (
            <p className="text-xs text-danger">{estadoMut.error.message}</p>
          )}
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-bold text-ink">Relación de presentaciones</h4>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[560px] text-xs">
            <thead className="bg-surface-hover text-left text-[10px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">En la web</th>
                <th className="px-3 py-2">En Mercado Libre</th>
                <th className="px-3 py-2 text-right">MeLi</th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-muted">
                    Sin presentaciones en caché.
                  </td>
                </tr>
              )}
              {filas.map((f) => {
                const est = (f.meli.estado || "").toLowerCase();
                return (
                  <tr key={f.sku} className="border-t border-border/70">
                    <td className="px-3 py-2">
                      <div className="font-semibold text-ink">{f.web.label}</div>
                      <div className="font-mono text-[10px] text-muted">{f.sku}</div>
                    </td>
                    <td className="px-3 py-2">
                      {f.aparece_en_web ? (
                        <span className="text-green-700">
                          Botón {f.web.label} · {fmtCopSitio(f.web.precio)}
                        </span>
                      ) : f.web.vitrina ? (
                        <span className="text-yellow-700">Vitrina, sin compra</span>
                      ) : (
                        <span className="text-muted">No aparece (falta MeLi)</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {f.meli.item_id ? (
                        <div>
                          <div className="text-ink">{f.meli.titulo || f.nombre}</div>
                          <div className="font-mono text-[10px] text-muted">{f.meli.item_id}</div>
                        </div>
                      ) : (
                        <span className="text-muted">Sin publicación</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {f.meli.permalink ? (
                        <a
                          href={f.meli.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mr-2 text-blue-700 underline"
                        >
                          ↗
                        </a>
                      ) : null}
                      {f.meli.item_id && (est === "active" || est === "paused") && (
                        <button
                          type="button"
                          disabled={estadoMut.isPending}
                          onClick={() =>
                            void estadoMut.mutateAsync({
                              sku: f.sku,
                              estado: est === "active" ? "paused" : "active",
                            })
                          }
                          className="text-[10px] font-semibold text-blue-800 hover:underline disabled:opacity-40"
                        >
                          {est === "active" ? "Pausar" : "Activar"}
                        </button>
                      )}
                      {est && f.meli.item_id ? (
                        <div className="text-[10px] capitalize text-muted">{est}</div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
  const [tab, setTab] = useState<"general" | "sitios" | "imagenes" | "meli" | "ficha">("sitios");
  const liveMeli = tab === "sitios" || tab === "meli";
  const { data, isLoading, error, refetch } = usePublicacionDetalle(sku, liveMeli);
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

  useEffect(() => {
    if (!data) return;
    setDescripcion(data.desc_override || data.desc_cache || "");
    setFotoUrl(data.foto_url_override || "");
    setMeliItemId(data.meli_item_id_override || data.meli_item_id_cache || "");
    setOcultoWeb(data.oculto_web);
    setCaracteristicas(data.caracteristicas || []);
    setSaved(false);
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
        Error cargando producto. <button onClick={() => refetch()} className="underline">Reintentar</button>
      </div>
    );
  }

  const fotoEfectiva = fotoUrl || data.foto_url_cache;
  const fotoPreviewUrl = fotoEfectiva ? resolverFotoPreview(fotoEfectiva) : null;

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
          {data.es_presentacion_de && data.es_presentacion_de !== data.sku && (
            <p className="mt-1 inline-flex items-center rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-semibold text-muted">
              Presentación de {data.es_presentacion_de}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-ink"
        >
          ✕
        </button>
      </div>

      {data.meli_compliance_reemplazo?.url_meli && (
        <div className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 space-y-2">
          <p className="text-xs font-bold text-teal-900">Publicación de reemplazo (compliance MeLi)</p>
          <p className="text-[11px] text-teal-800">
            {data.meli_compliance_reemplazo.item_id}
            {" · "}
            <span className="font-semibold">{data.meli_compliance_reemplazo.estado_actual}</span>
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
        {(["sitios", "general", "imagenes", "meli", "ficha"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={hubTabClass(tab === t, "flex-1 justify-center")}
          >
            <span className={HUB_TAB_LABEL}>
              {t === "sitios"
                ? "Sitios"
                : t === "general"
                  ? "General"
                  : t === "imagenes"
                    ? "Imágenes"
                    : t === "meli"
                      ? "MeLi"
                      : "Ficha"}
            </span>
          </button>
        ))}
      </div>

      {tab === "sitios" && (
        <SitiosTab
          sku={sku}
          data={data}
          ocultoWeb={ocultoWeb}
          onToggleOculto={setOcultoWeb}
        />
      )}

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
  const [categoriaFiltro, setCategoriaFiltro] = useState("");
  const [canalFiltro, setCanalFiltro] = useState("");
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
    canalFiltro,
  );

  const items = data?.items ?? [];
  const categorias = data?.categorias ?? [];
  const resumen = data?.resumen;
  const totalOk = resumen?.listos ?? 0;
  const webIncompleto = resumen?.falta_web ?? 0;
  const sinMeli = resumen?.sin_meli ?? 0;
  const noEnTienda = resumen?.no_en_tienda ?? 0;

  const filtroAyuda =
    canalFiltro === "ambos"
      ? "Solo los que ya tienen ficha completa en la tienda y publicación en Mercado Libre."
      : canalFiltro === "falta_web"
        ? "Les falta foto o texto en la ficha de la tienda. No dice nada de Mercado Libre."
        : canalFiltro === "sin_meli"
          ? "No tienen publicación en Mercado Libre. La tienda tampoco los vende: solo lista lo que está en MeLi."
          : canalFiltro === "no_en_tienda"
            ? "No aparecen para comprar en mckennagroup.co: los ocultaron o no tienen ID de MeLi."
            : "Toca un recuadro para filtrar. Los números no cambian: son el total del catálogo.";

  function toggleCanal(id: string) {
    setCanalFiltro((prev) => (prev === id ? "" : id));
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Switcher de vista principal */}
      <div className="flex shrink-0 flex-wrap gap-1 rounded-xl border border-border bg-surface p-1">
        <button
          onClick={() => setMainView("catalogo")}
          className={hubTabClass(mainView === "catalogo", "flex-1 justify-center")}
        >
          <span className={HUB_TAB_LABEL}>🗂 Catálogo</span>
        </button>
        <button
          onClick={() => setMainView("galeria")}
          className={hubTabClass(mainView === "galeria", "flex-1 justify-center")}
        >
          <span className={HUB_TAB_LABEL}>🖼 Galería</span>
        </button>
        <button
          onClick={() => setMainView("catalogo-cliente")}
          className={hubTabClass(mainView === "catalogo-cliente", "flex-1 justify-center")}
        >
          <span className={HUB_TAB_LABEL}>🔗 Catálogo cliente</span>
        </button>
        <button
          onClick={() => setMainView("precios")}
          className={hubTabClass(mainView === "precios", "flex-1 justify-center")}
        >
          <span className={HUB_TAB_LABEL}>💲 Verificar precios</span>
        </button>
        <button
          onClick={() => setMainView("competencia")}
          className={hubTabClass(mainView === "competencia", "flex-1 justify-center")}
        >
          <span className={HUB_TAB_LABEL}>⚖ Competencia</span>
        </button>
        <button
          onClick={() => setMainView("compliance")}
          className={`flex-1 rounded-lg py-2 text-xs font-bold transition ${
            mainView === "compliance"
              ? "bg-orange-500 text-white shadow-sm"
              : "text-muted hover:text-ink"
          }`}
        >
          🛡 Republicar MeLi
        </button>
        <button
          onClick={() => setMainView("crear")}
          className={`flex-1 rounded-lg py-2 text-xs font-bold transition ${
            mainView === "crear"
              ? "bg-teal-600 text-white shadow-sm"
              : "text-muted hover:text-ink"
          }`}
        >
          ✦ Crear desde cero
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

      {/* Vista catálogo — existente */}
      {mainView === "catalogo" && (
      <div className="flex flex-1 min-h-0 flex-col gap-4 lg:flex-row">
      {/* Columna izquierda: lista */}
      <div
        className={`flex flex-col gap-3 lg:w-[420px] lg:shrink-0 ${selectedSku ? "hidden lg:flex" : "flex"}`}
      >
        {/* Resumen = filtros (un solo juego, sin pastillas duplicadas) */}
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => toggleCanal("ambos")}
            title="Tienen foto y texto en la tienda, y ya están en Mercado Libre"
            className={`rounded-xl border p-3 text-center transition ${
              canalFiltro === "ambos"
                ? "border-green-500 bg-green-100 ring-2 ring-green-400"
                : "border-green-200 bg-green-50 hover:border-green-400"
            }`}
          >
            <p className="text-lg font-black text-green-700">{totalOk}</p>
            <p className="text-[11px] font-semibold text-green-600">En web y MeLi</p>
          </button>
          <button
            type="button"
            onClick={() => toggleCanal("falta_web")}
            title="A la ficha de la tienda le falta foto o descripción"
            className={`rounded-xl border p-3 text-center transition ${
              canalFiltro === "falta_web"
                ? "border-yellow-500 bg-yellow-100 ring-2 ring-yellow-400"
                : "border-yellow-200 bg-yellow-50 hover:border-yellow-400"
            }`}
          >
            <p className="text-lg font-black text-yellow-700">{webIncompleto}</p>
            <p className="text-[11px] font-semibold text-yellow-600">Falta foto o texto</p>
          </button>
          <button
            type="button"
            onClick={() => toggleCanal("sin_meli")}
            title="No hay publicación en Mercado Libre"
            className={`rounded-xl border p-3 text-center transition ${
              canalFiltro === "sin_meli"
                ? "border-gray-500 bg-gray-200 ring-2 ring-gray-400"
                : "border-gray-200 bg-gray-50 hover:border-gray-400"
            }`}
          >
            <p className="text-lg font-black text-gray-600">{sinMeli}</p>
            <p className="text-[11px] font-semibold text-gray-500">Sin Mercado Libre</p>
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => toggleCanal("no_en_tienda")}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
              canalFiltro === "no_en_tienda"
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-muted hover:border-accent/40 hover:text-ink"
            }`}
          >
            No se ven en la tienda{noEnTienda ? ` (${noEnTienda})` : ""}
          </button>
          {canalFiltro && (
            <button
              type="button"
              onClick={() => setCanalFiltro("")}
              className="text-[11px] font-semibold text-accent underline"
            >
              Ver todos
            </button>
          )}
        </div>
        <p className="text-[11px] leading-snug text-muted">{filtroAyuda}</p>

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
          <div className="text-center">
            <p className="text-4xl opacity-20">🛒</p>
            <p className="mt-2 text-sm">Selecciona un producto para editar</p>
          </div>
        </div>
      )}
      </div>
      )}
    </div>
  );
}
