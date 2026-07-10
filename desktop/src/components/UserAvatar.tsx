import { useState } from "react";
import type { TicketsUser } from "../stores/ticketsAuth";
import { ticketsUploadUrl } from "../lib/profilePhoto";
import ImageLightbox from "./ImageLightbox";

export type AvatarUser = Pick<TicketsUser, "nombre"> & {
  foto?: string | null;
  departamento?: { color?: string } | null;
};

export default function UserAvatar({
  user,
  token,
  size = "md",
  previewUrl,
  className = "",
  /** Si hay foto, al hacer clic se abre en grande (útil para ver fotos de otros). */
  expandable = false,
  title,
}: {
  user: AvatarUser;
  token: string;
  size?: "sm" | "md" | "lg";
  /** Vista previa local (Object URL) antes de terminar la subida. */
  previewUrl?: string | null;
  className?: string;
  expandable?: boolean;
  title?: string;
}) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  const dims =
    size === "sm" ? "h-9 w-9 text-sm" : size === "lg" ? "h-20 w-20 text-2xl" : "h-10 w-10 text-base";

  const fotoSrc =
    previewUrl
    ?? (user.foto ? ticketsUploadUrl(user.foto, token, user.foto) : null);

  const img = fotoSrc ? (
    <img
      key={previewUrl ? "preview" : user.foto ?? "foto"}
      src={fotoSrc}
      alt={user.nombre}
      className={`${dims} rounded-full border-2 border-border object-cover shadow-sm ${className}`}
    />
  ) : (
    <div
      className={`flex ${dims} items-center justify-center rounded-full border-2 border-white font-black text-white shadow ${className}`}
      style={{ background: user.departamento?.color || "#0c6069" }}
    >
      {(user.nombre || "?").charAt(0).toUpperCase()}
    </div>
  );

  if (expandable && fotoSrc) {
    return (
      <>
        <button
          type="button"
          title={title ?? `Ver foto de ${user.nombre}`}
          onClick={(e) => {
            e.stopPropagation();
            setLightbox(fotoSrc);
          }}
          className="group relative shrink-0 rounded-full transition hover:opacity-90 cursor-zoom-in"
        >
          {img}
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/0 opacity-0 transition group-hover:bg-black/25 group-hover:opacity-100">
            <span className="text-[10px] font-bold text-white drop-shadow">↗</span>
          </span>
        </button>
        {lightbox && <ImageLightbox url={lightbox} onClose={() => setLightbox(null)} />}
      </>
    );
  }

  return img;
}
