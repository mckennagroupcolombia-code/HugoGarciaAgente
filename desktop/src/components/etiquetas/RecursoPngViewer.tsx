import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { resolverUrlImagenCanvas } from "../../lib/plantillasVisualesImagen";
import { useAppStore } from "../../stores/app";
import { Modal, Button, Banner, Spinner } from "./ui";

/** Codifica un nombre de recurso para usarlo en una ruta `/archivo/<path:nombre>`.
 * Codifica cada segmento por separado para preservar las '/' de subcarpetas
 * (encodeURIComponent normal las escaparía a %2F y rompería el <path:...>). */
export function codificarRutaRecursoPng(nombre: string): string {
  return nombre.split("/").map(encodeURIComponent).join("/");
}

/** Miniatura de un recurso PNG/JPG de la biblioteca de Etiquetas. Usa la
 * miniatura embebida (thumb_b64) si existe; si no, recurre al archivo real. */
export function MiniaturaRecursoPng({ nombre, thumbB64, thumbMime }: {
  nombre: string;
  thumbB64?: string | null;
  thumbMime?: string | null;
}) {
  const [src, setSrc] = useState<string | null>(
    thumbB64 ? `data:${thumbMime || "image/png"};base64,${thumbB64}` : null,
  );
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    if (thumbB64) {
      setSrc(`data:${thumbMime || "image/png"};base64,${thumbB64}`);
      setFallo(false);
      return;
    }
    // Sin miniatura embebida (falló al subir o no está registrado en el
    // índice): recurre al archivo real.
    let cancelado = false;
    setFallo(false);
    resolverUrlImagenCanvas(`/api/etiquetas/recursos-png/archivo/${codificarRutaRecursoPng(nombre)}`)
      .then((url) => {
        if (!cancelado) setSrc(url);
      })
      .catch(() => {
        if (!cancelado) setFallo(true);
      });
    return () => {
      cancelado = true;
    };
  }, [nombre, thumbB64, thumbMime]);

  if (fallo || !src) {
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded bg-surface-hover text-[9px] text-muted" title="Sin previsualización">
        ?
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={nombre}
      className="max-h-full max-w-full object-contain"
      draggable={false}
      onError={() => setFallo(true)}
    />
  );
}

/** Vista previa a tamaño completo de un recurso PNG/JPG de la biblioteca de
 * Etiquetas, con acciones de imprimir, descargar y eliminar. */
export function LightboxImagen({
  nombre,
  onCerrar,
  onDescargar,
  onEliminar,
  descargando,
  eliminando,
}: {
  nombre: string;
  onCerrar: () => void;
  onDescargar: () => void;
  onEliminar: () => void;
  descargando: boolean;
  eliminando: boolean;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);
  const [enviandoImprimir, setEnviandoImprimir] = useState(false);
  const [errorImprimir, setErrorImprimir] = useState<string | null>(null);

  const setPanel = useAppStore((s) => s.setPanel);
  const setEtiquetasTab = useAppStore((s) => s.setEtiquetasTab);
  const setEtiquetasHandoff = useAppStore((s) => s.setEtiquetasHandoff);

  useEffect(() => {
    let cancelado = false;
    setSrc(null);
    setFallo(false);
    resolverUrlImagenCanvas(`/api/etiquetas/recursos-png/archivo/${codificarRutaRecursoPng(nombre)}`)
      .then((url) => {
        if (!cancelado) setSrc(url);
      })
      .catch(() => {
        if (!cancelado) setFallo(true);
      });
    return () => {
      cancelado = true;
    };
  }, [nombre]);

  // Convierte esta imagen en PDF y la envía al mismo flujo de vista previa +
  // impresión física que usan los archivos .ai/PDF en Imprimir Etiquetas.
  async function enviarAImprimir() {
    setEnviandoImprimir(true);
    setErrorImprimir(null);
    try {
      const res = await api.post<{ ok: boolean; nombre: string; ruta_completa: string; error?: string }>(
        "/api/etiquetas/recursos-png/imprimir-pdf",
        { nombre },
      );
      setEtiquetasHandoff({ pdf_ruta: res.ruta_completa, pdf_nombre: res.nombre });
      setEtiquetasTab("imprimir");
      setPanel("etiquetas");
      onCerrar();
    } catch (e) {
      setErrorImprimir(e instanceof Error ? e.message : "Error al preparar la impresión");
    } finally {
      setEnviandoImprimir(false);
    }
  }

  return (
    <Modal
      onClose={onCerrar}
      title={<span title={nombre}>{nombre}</span>}
      maxWidthClassName="max-w-4xl"
      headerExtra={
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            icon="printer"
            loading={enviandoImprimir}
            disabled={!src}
            title="Envía la imagen al centro de Imprimir Etiquetas"
            onClick={enviarAImprimir}
          >
            Imprimir
          </Button>
          <Button variant="secondary" size="sm" icon="download" loading={descargando} onClick={onDescargar}>
            Descargar
          </Button>
          <Button variant="destructive" size="sm" icon="trash" loading={eliminando} onClick={onEliminar}>
            Eliminar
          </Button>
        </div>
      }
    >
      {errorImprimir && (
        <Banner tone="danger" className="rounded-none border-x-0 border-t-0">
          {errorImprimir}
        </Banner>
      )}
      <div className="flex min-h-[300px] flex-1 items-center justify-center overflow-auto bg-surface-hover p-4">
        {fallo ? (
          <p className="text-sm text-muted">No se pudo cargar la imagen.</p>
        ) : src ? (
          <img
            src={src}
            alt={nombre}
            className="max-h-full max-w-full object-contain"
            onError={() => setFallo(true)}
          />
        ) : (
          <Spinner size="lg" />
        )}
      </div>
    </Modal>
  );
}

export function formatoBytesRecurso(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
