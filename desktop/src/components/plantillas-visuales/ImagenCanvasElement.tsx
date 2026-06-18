import { useEffect, useState } from "react";
import { resolverUrlImagenCanvas } from "../../lib/plantillasVisualesImagen";

interface Props {
  src: string;
  objectFit: "contain" | "cover";
  alt?: string;
}

export default function ImagenCanvasElement({ src, objectFit, alt = "" }: Props) {
  const [displaySrc, setDisplaySrc] = useState<string | null>(
    src.startsWith("data:") || src.startsWith("blob:") ? src : null,
  );
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    if (src.startsWith("data:") || src.startsWith("blob:")) {
      setDisplaySrc(src);
      setFallo(false);
      return;
    }
    let alive = true;
    setFallo(false);
    setDisplaySrc(null);
    void resolverUrlImagenCanvas(src)
      .then((url) => {
        if (alive) setDisplaySrc(url);
      })
      .catch(() => {
        if (alive) setFallo(true);
      });
    return () => {
      alive = false;
    };
  }, [src]);

  if (fallo) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-red-50 text-[10px] text-red-600">
        Sin imagen
      </div>
    );
  }

  if (!displaySrc) {
    return <div className="h-full w-full" aria-hidden />;
  }

  return (
    <img
      src={displaySrc}
      alt={alt}
      draggable={false}
      className="pointer-events-none block h-full w-full"
      style={{ objectFit, objectPosition: "center" }}
    />
  );
}
