import { useRef, useState, type DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCopiarImagenSitio,
  useEliminarImagenes,
  useFotosActuales,
  useReordenarImagenesMeli,
  useReordenarImagenesWeb,
  useSubirImagen,
} from "../../hooks/usePublicaciones";
import type { CodigoEan } from "../../lib/etiquetasCodigosEan";
import { Icon } from "../../icons";
import { Banner, Button, IconButton, Modal, Spinner } from "./ui";

/** Miniatura de la foto del producto en la fila del código EAN; al tocarla se administran sus fotos. */
export function MiniaturaFotoEan({ codigo, onAbrir }: { codigo: CodigoEan; onAbrir: () => void }) {
  const titulo = codigo.foto
    ? codigo.origen === "vitrina"
      ? "Foto tomada de la vitrina (MeLi). Tocar para subir una propia"
      : `${codigo.fotos_total ?? 1} foto(s). Tocar para administrarlas`
    : "Sin foto. Tocar para agregar";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onAbrir();
      }}
      title={titulo}
      aria-label={`Fotos de ${codigo.sku}`}
      className={`flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-white ${
        codigo.foto ? "border-border" : "border-dashed border-muted/60 text-muted hover:border-accent hover:text-accent"
      }`}
    >
      {codigo.foto ? (
        <img src={codigo.foto} alt="" loading="lazy" className="h-full w-full object-contain" />
      ) : (
        <Icon name="camera" size={16} />
      )}
    </button>
  );
}

type Sitio = "web" | "meli";

const NOMBRE: Record<Sitio, string> = { web: "Web", meli: "Mercado Libre" };

/** Una foto de cualquiera de las dos carpetas, con lo que cada acción necesita. */
interface FotoCarpeta {
  /** filename (web) o picture_id (MeLi). */
  id: string;
  url: string;
  principal: boolean;
  titulo: string;
}

/**
 * Fotos del producto desde Códigos EAN, en DOS carpetas independientes: las de la tienda web
 * (IMAGENES_PRODUCTOS_CATALOGO) y las de la publicación de Mercado Libre. No es una vía de
 * escritura nueva: usa los mismos endpoints de Publicaciones (/api/publicaciones/<sku>/…), que
 * normalizan a 1000×1000 con fondo blanco y refrescan la vitrina web.
 */
export function FotosProductoEanModal({ codigo, onClose }: { codigo: CodigoEan; onClose: () => void }) {
  const qc = useQueryClient();
  const sku = codigo.sku;
  const { data, isLoading, error } = useFotosActuales(sku);
  const subir = useSubirImagen(sku);
  const eliminar = useEliminarImagenes(sku);
  const reordenarWeb = useReordenarImagenesWeb(sku);
  const reordenarMeli = useReordenarImagenesMeli(sku);
  const copiar = useCopiarImagenSitio(sku);
  const [aviso, setAviso] = useState<{ tono: "success" | "danger"; texto: string } | null>(null);

  const meliItemId = data?.meli_item_id || "";
  // Un servidor sin reiniciar no manda meli_item_id: se sabe que NO hay publicación solo si
  // llega vacío explícitamente (el backend igual resuelve la publicación por SKU).
  const sinPublicacionMeli = data?.meli_item_id === "";
  const ocupado =
    subir.isPending || eliminar.isPending || reordenarWeb.isPending || reordenarMeli.isPending || copiar.isPending;

  const fotos: Record<Sitio, FotoCarpeta[]> = {
    web: (data?.web.imagenes ?? []).map((i) => ({ id: i.filename, url: i.url, principal: i.principal, titulo: i.filename })),
    meli: (data?.meli.imagenes ?? []).map((i) => ({ id: i.id, url: i.url, principal: i.principal, titulo: i.id })),
  };

  const refrescarLista = () => void qc.invalidateQueries({ queryKey: ["etiquetas-codigos-ean"] });
  const fallo = (e: unknown, def: string) =>
    setAviso({ tono: "danger", texto: e instanceof Error ? e.message : def });

  function subirA(sitio: Sitio, lista: FileList | File[] | null) {
    const files = Array.from(lista ?? []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    setAviso(null);
    subir.mutate(
      { files, targets: [sitio], meliItemId: sitio === "meli" ? meliItemId : undefined },
      {
        onSuccess: (res) => {
          const ok = res.archivos.filter((a) => a[sitio]?.ok).length;
          const errores = res.archivos.map((a) => (a[sitio] && !a[sitio]!.ok ? a[sitio]!.error : "")).filter(Boolean);
          setAviso({
            tono: ok ? "success" : "danger",
            texto: `${ok} foto(s) subida(s) a ${NOMBRE[sitio]}` + (errores.length ? ` · ${errores.join("; ")}` : ""),
          });
          refrescarLista();
        },
        onError: (e) => fallo(e, "No se pudo subir"),
      },
    );
  }

  function hacerPrincipal(sitio: Sitio, id: string) {
    const orden = [id, ...fotos[sitio].map((f) => f.id).filter((x) => x !== id)];
    if (sitio === "web") reordenarWeb.mutate(orden, { onSuccess: refrescarLista, onError: (e) => fallo(e, "No se pudo ordenar") });
    else
      reordenarMeli.mutate(
        { picture_ids: orden, meli_item_id: meliItemId },
        { onError: (e) => fallo(e, "No se pudo ordenar") },
      );
  }

  function quitar(sitio: Sitio, f: FotoCarpeta) {
    if (!window.confirm(`¿Quitar esta foto de ${NOMBRE[sitio]}? La otra carpeta no cambia.`)) return;
    eliminar.mutate(
      sitio === "web"
        ? { plataforma: "web", filename: f.id }
        : { plataforma: "meli", picture_id: f.id, meli_item_id: meliItemId },
      { onSuccess: refrescarLista, onError: (e) => fallo(e, "No se pudo quitar") },
    );
  }

  function copiarA(origen: Sitio, f: FotoCarpeta) {
    const destino: Sitio = origen === "web" ? "meli" : "web";
    setAviso(null);
    copiar.mutate(
      { origen, destino, imagen_id: f.id, url: f.url, meli_item_id: meliItemId },
      {
        onSuccess: () => {
          setAviso({ tono: "success", texto: `Foto copiada a ${NOMBRE[destino]}.` });
          refrescarLista();
        },
        onError: (e) => fallo(e, "No se pudo copiar"),
      },
    );
  }

  return (
    <Modal title={`Fotos · ${codigo.nombre_producto || sku}`} onClose={onClose} maxWidthClassName="max-w-5xl">
      <div className="space-y-3 p-4">
        <p className="text-xs text-muted">
          <span className="font-mono text-accent">{sku}</span> · EAN <span className="font-mono">{codigo.codigo}</span>.
          Cada canal tiene su propia carpeta: lo que subas o quites en una no toca la otra. Las fotos se ajustan solas
          a 1000×1000 con fondo blanco.
        </p>

        {aviso && <Banner tone={aviso.tono} className="text-xs">{aviso.texto}</Banner>}

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted">
            <Spinner /> Cargando fotos…
          </div>
        ) : error ? (
          <Banner tone="danger" className="text-xs">{error instanceof Error ? error.message : "Error al cargar"}</Banner>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <CarpetaFotos
              sitio="web"
              fotos={fotos.web}
              ocupado={ocupado}
              subiendo={subir.isPending && subir.variables?.targets[0] === "web"}
              onSubir={(files) => subirA("web", files)}
              onPrincipal={(id) => hacerPrincipal("web", id)}
              onQuitar={(f) => quitar("web", f)}
              onCopiar={sinPublicacionMeli ? undefined : (f) => copiarA("web", f)}
              vacio={
                codigo.foto && codigo.origen === "vitrina"
                  ? "Sin fotos propias: hoy la tienda muestra la de Mercado Libre."
                  : "Sin fotos para la web."
              }
            />
            <CarpetaFotos
              sitio="meli"
              fotos={fotos.meli}
              ocupado={ocupado}
              subiendo={subir.isPending && subir.variables?.targets[0] === "meli"}
              deshabilitada={
                sinPublicacionMeli
                  ? "Este combo no tiene publicación en Mercado Libre vinculada: no hay dónde guardar sus fotos."
                  : undefined
              }
              detalle={meliItemId ? `Publicación ${meliItemId}` : undefined}
              error={data?.meli.error || undefined}
              onSubir={(files) => subirA("meli", files)}
              onPrincipal={(id) => hacerPrincipal("meli", id)}
              onQuitar={(f) => quitar("meli", f)}
              onCopiar={(f) => copiarA("meli", f)}
              vacio="La publicación no tiene fotos."
            />
          </div>
        )}
      </div>
    </Modal>
  );
}

function CarpetaFotos({
  sitio,
  fotos,
  ocupado,
  subiendo,
  deshabilitada,
  detalle,
  error,
  vacio,
  onSubir,
  onPrincipal,
  onQuitar,
  onCopiar,
}: {
  sitio: Sitio;
  fotos: FotoCarpeta[];
  ocupado: boolean;
  subiendo: boolean;
  /** Motivo por el que la carpeta no admite cambios. */
  deshabilitada?: string;
  detalle?: string;
  error?: string;
  vacio: string;
  onSubir: (files: FileList | null) => void;
  onPrincipal: (id: string) => void;
  onQuitar: (f: FotoCarpeta) => void;
  onCopiar?: (f: FotoCarpeta) => void;
}) {
  const [arrastrando, setArrastrando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const otro = NOMBRE[sitio === "web" ? "meli" : "web"];

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setArrastrando(false);
    if (!deshabilitada) onSubir(e.dataTransfer.files);
  }

  return (
    <section
      onDragOver={(e) => {
        e.preventDefault();
        if (!deshabilitada) setArrastrando(true);
      }}
      onDragLeave={() => setArrastrando(false)}
      onDrop={onDrop}
      className={`flex flex-col gap-3 rounded-lg border p-3 ${
        arrastrando ? "border-accent bg-accent/10" : "border-border"
      }`}
    >
      <header className="flex items-center gap-2">
        <Icon name="folder" size={16} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink">
            {NOMBRE[sitio]} <span className="font-normal text-muted">({fotos.length})</span>
          </p>
          {detalle && <p className="truncate font-mono text-[10px] text-muted">{detalle}</p>}
        </div>
        <Button
          variant="primary"
          size="sm"
          icon="camera"
          loading={subiendo}
          disabled={ocupado || !!deshabilitada}
          onClick={() => inputRef.current?.click()}
        >
          Agregar
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            onSubir(e.target.files);
            e.target.value = "";
          }}
        />
      </header>

      {deshabilitada ? (
        <p className="rounded border border-dashed border-border p-4 text-center text-xs text-muted">{deshabilitada}</p>
      ) : (
        <>
          {error && <Banner tone="danger" className="text-xs">{error}</Banner>}
          {fotos.length === 0 ? (
            <p className="rounded border border-dashed border-border p-4 text-center text-xs text-muted">
              {vacio} Arrastra las fotos aquí o usa «Agregar».
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {fotos.map((f) => (
                <div key={f.id} className="space-y-1">
                  <div
                    className={`aspect-square overflow-hidden rounded-lg border bg-white ${
                      f.principal ? "border-accent ring-2 ring-accent/40" : "border-border"
                    }`}
                    title={f.titulo}
                  >
                    <img src={f.url} alt={f.titulo} loading="lazy" className="h-full w-full object-contain" />
                  </div>
                  <div className="flex items-center justify-between gap-0.5">
                    {f.principal ? (
                      <span className="text-[10px] font-semibold text-accent">Principal</span>
                    ) : (
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={() => onPrincipal(f.id)}
                        className="text-[10px] text-muted underline underline-offset-2 hover:text-ink"
                      >
                        Principal
                      </button>
                    )}
                    <span className="flex">
                      {onCopiar && (
                        <IconButton
                          icon="outbox"
                          label={`Copiar a ${otro}`}
                          size="xs"
                          disabled={ocupado}
                          onClick={() => onCopiar(f)}
                        />
                      )}
                      <IconButton
                        icon="trash"
                        label={`Quitar de ${NOMBRE[sitio]}`}
                        size="xs"
                        tone="danger"
                        disabled={ocupado}
                        onClick={() => onQuitar(f)}
                      />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
