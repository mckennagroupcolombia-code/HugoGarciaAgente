import { useEffect, useState } from "react";
import { resolverUrlImagenCanvas } from "../../lib/plantillasVisualesImagen";
import { formatoMedidasEtiqueta } from "../../lib/etiquetasTipos";
import { Modal, Button, Spinner } from "./ui";

/** Codifica un nombre de recurso para usarlo en una ruta `/archivo/<path:nombre>`.
 * Codifica cada segmento por separado para preservar las '/' de subcarpetas
 * (encodeURIComponent normal las escaparía a %2F y rompería el <path:...>). */
export function codificarRutaRecursoPng(nombre: string): string {
  return nombre.split("/").map(encodeURIComponent).join("/");
}

export type FormatoPngAsociado = {
  tipo_etiqueta?: string | null;
  ancho_mm?: number | null;
  alto_mm?: number | null;
  dpi?: number | null;
};

export function labelFormatoPng(f?: FormatoPngAsociado | null): string {
  if (!f) return "";
  const med =
    f.ancho_mm != null && f.alto_mm != null && Number(f.ancho_mm) > 0 && Number(f.alto_mm) > 0
      ? formatoMedidasEtiqueta(Number(f.ancho_mm), Number(f.alto_mm))
      : "";
  const tipo = (f.tipo_etiqueta || "").trim();
  if (tipo && med) return `${tipo} · ${med}`;
  return tipo || med;
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

/** Vista previa PNG a tamaño completo (p. ej. panel Imprimir, misma pestaña). */
export function VistaPreviaPngGrande({
  nombre,
  imgClassName = "max-h-full max-w-full object-contain",
  containerClassName = "flex min-h-[200px] w-full flex-1 items-center justify-center",
}: {
  nombre: string;
  imgClassName?: string;
  containerClassName?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelado = false;
    setSrc(null);
    setFallo(false);
    setLoading(true);
    resolverUrlImagenCanvas(`/api/etiquetas/recursos-png/archivo/${codificarRutaRecursoPng(nombre)}`)
      .then((url) => {
        if (!cancelado) {
          setSrc(url);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelado) {
          setFallo(true);
          setLoading(false);
        }
      });
    return () => {
      cancelado = true;
    };
  }, [nombre]);

  if (fallo) {
    return <p className="px-6 text-center text-xs text-danger">No se pudo cargar la imagen.</p>;
  }
  if (loading || !src) {
    return <Spinner size="lg" />;
  }
  return (
    <div className={containerClassName}>
      <img
        src={src}
        alt={nombre}
        className={imgClassName}
        draggable={false}
        onError={() => setFallo(true)}
      />
    </div>
  );
}

/** Vista previa a tamaño completo de un recurso PNG/JPG de la biblioteca de
 * Etiquetas, con acciones de descargar y eliminar. */
export function LightboxImagen({
  nombre,
  formato,
  onCerrar,
  onDescargar,
  onEliminar,
  descargando,
  eliminando,
}: {
  nombre: string;
  formato?: FormatoPngAsociado | null;
  onCerrar: () => void;
  onDescargar: () => void;
  onEliminar?: () => void;
  descargando: boolean;
  eliminando: boolean;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);
  const labelFmt = labelFormatoPng(formato);

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

  return (
    <Modal
      onClose={onCerrar}
      title={
        <span title={nombre}>
          {nombre}
          {labelFmt ? (
            <span className="ml-2 font-normal text-muted">({labelFmt})</span>
          ) : null}
        </span>
      }
      maxWidthClassName="max-w-4xl"
      headerExtra={
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="secondary" size="sm" icon="download" loading={descargando} onClick={onDescargar}>
            Descargar
          </Button>
          {onEliminar ? (
            <Button variant="destructive" size="sm" icon="trash" loading={eliminando} onClick={onEliminar}>
              Eliminar
            </Button>
          ) : null}
        </div>
      }
    >
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
