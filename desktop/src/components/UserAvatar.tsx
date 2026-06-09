import type { TicketsUser } from "../stores/ticketsAuth";
import { ticketsUploadUrl } from "../lib/profilePhoto";

export default function UserAvatar({
  user,
  token,
  size = "md",
  previewUrl,
  className = "",
}: {
  user: TicketsUser;
  token: string;
  size?: "sm" | "md" | "lg";
  /** Vista previa local (Object URL) antes de terminar la subida. */
  previewUrl?: string | null;
  className?: string;
}) {
  const dims =
    size === "sm" ? "h-9 w-9 text-sm" : size === "lg" ? "h-20 w-20 text-2xl" : "h-10 w-10 text-base";

  if (previewUrl) {
    return (
      <img
        src={previewUrl}
        alt={user.nombre}
        className={`${dims} rounded-full border-2 border-border object-cover shadow-sm ${className}`}
      />
    );
  }

  if (user.foto) {
    return (
      <img
        key={user.foto}
        src={ticketsUploadUrl(user.foto, token, user.foto)}
        alt={user.nombre}
        className={`${dims} rounded-full border-2 border-border object-cover shadow-sm ${className}`}
      />
    );
  }

  return (
    <div
      className={`flex ${dims} items-center justify-center rounded-full border-2 border-white font-black text-white shadow ${className}`}
      style={{ background: user.departamento?.color || "#0c6069" }}
    >
      {user.nombre.charAt(0).toUpperCase()}
    </div>
  );
}
