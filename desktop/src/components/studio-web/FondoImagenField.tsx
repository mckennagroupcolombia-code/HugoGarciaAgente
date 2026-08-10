import {
  createContext,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { api } from "../../api/client";
import { resolveFondoSrc } from "../../lib/webLayoutStudio";

export { resolveFondoSrc };

export const StudioAssetBaseCtx = createContext("");

export function estiloFondoImagen(
  url: string | undefined,
  assetBase: string,
  overlay?: string,
): CSSProperties {
  if (!url) return {};
  const src = resolveFondoSrc(url, assetBase);
  const img = `url("${src}")`;
  return {
    backgroundImage: overlay ? `${overlay}, ${img}` : img,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  };
}

export async function subirFondoStudio(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("archivo", file);
  const res = await api.upload<{ ok?: boolean; url: string }>(
    "/api/web/tema/fondo",
    fd,
    { timeoutMs: 45000 },
  );
  if (!res.url) throw new Error("El servidor no devolvió la URL");
  return res.url;
}

function archivoImagen(file: File | undefined | null): file is File {
  return !!file && file.type.startsWith("image/");
}

/** Adjuntar / quitar una imagen de fondo (JPG PNG WEBP GIF ≤ 4 MB). */
export function FondoImagenField({
  label,
  value,
  assetBase,
  onChange,
}: {
  label: string;
  value?: string;
  assetBase: string;
  onChange: (url: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const src = value ? resolveFondoSrc(value, assetBase) : "";

  async function subir(file: File) {
    setBusy(true);
    setErr("");
    try {
      onChange(await subirFondoStudio(file));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo subir");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold text-muted">{label}</div>
      {src ? (
        <img
          src={src}
          alt=""
          className="h-16 w-full rounded-md border border-border object-cover"
        />
      ) : (
        <div className="flex h-12 items-center justify-center rounded-md border border-dashed border-border text-[10px] text-muted">
          Sin imagen
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <label className="inline-flex h-8 cursor-pointer items-center rounded-md border border-border bg-surface px-2.5 text-[11px] font-bold text-ink hover:border-accent hover:text-accent">
          {busy ? "Subiendo…" : "Adjuntar imagen"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (archivoImagen(f)) void subir(f);
              e.target.value = "";
            }}
          />
        </label>
        {value ? (
          <button
            type="button"
            className="text-[11px] font-semibold text-muted underline hover:text-red-600"
            onClick={() => onChange("")}
          >
            Quitar
          </button>
        ) : null}
      </div>
      {err ? <p className="text-[11px] text-red-600">{err}</p> : null}
    </div>
  );
}

/** Arrastrar una foto encima del panel o pulsar «Poner imagen». */
export function ZonaFondoDrop({
  onUrl,
  label = "Poner imagen",
  mostrarBoton = true,
  className,
  style,
  children,
}: {
  onUrl: (url: string) => void;
  label?: string;
  mostrarBoton?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  async function recibir(file: File | undefined | null) {
    if (!archivoImagen(file) || busy) return;
    setBusy(true);
    try {
      onUrl(await subirFondoStudio(file));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "No se pudo subir la imagen");
    } finally {
      setBusy(false);
      setOver(false);
    }
  }

  return (
    <div
      className={className}
      style={style}
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void recibir(e.dataTransfer.files?.[0]);
      }}
    >
      {children}
      {mostrarBoton ? (
      <button
        type="button"
        data-studio-handle="fondo-img"
        title="Adjuntar foto a este fondo"
        className="absolute bottom-3 left-3 z-30 rounded-md border border-white/70 bg-sky-600 px-2.5 py-1.5 text-[10px] font-extrabold uppercase tracking-wide text-white shadow-lg hover:bg-sky-500"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          inputRef.current?.click();
        }}
      >
        {busy ? "Subiendo…" : `📷 ${label}`}
      </button>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          void recibir(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {over ? (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center border-4 border-dashed border-sky-400 bg-sky-500/30 text-sm font-extrabold uppercase tracking-wide text-white">
          Suelta la foto aquí
        </div>
      ) : null}
    </div>
  );
}
