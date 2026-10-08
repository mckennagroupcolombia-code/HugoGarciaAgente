import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useUsuariosEquipo } from "../hooks/useConversaciones";
import { useTicketsAuth } from "../stores/ticketsAuth";
import { ticketsUploadUrl } from "./profilePhoto";

/** URL de la foto de perfil de alguien del equipo: por id y, si no hay (mensajes de WhatsApp,
 *  avisos), por nombre exacto. null si no tiene foto o no se encuentra. */
export function useFotoPersona(uid?: number | string | null, nombre?: string | null): string | null {
  const { data: equipo } = useUsuariosEquipo();
  const token = useTicketsAuth((s) => s.token);
  return useMemo(() => {
    if (!equipo || !token) return null;
    const u = (uid != null ? equipo.find((e) => String(e.id) === String(uid)) : undefined)
      ?? (nombre ? equipo.find((e) => e.nombre === nombre) : undefined);
    return u?.foto ? ticketsUploadUrl(u.foto, token, u.foto) : null;
  }, [equipo, token, uid, nombre]);
}

/**
 * La cara de una persona en los chats (7-oct-2026): su foto de perfil si la tiene; si no, lo de
 * siempre (iniciales sobre su color). `extra` va encima en ambos casos (íconos de esquina).
 */
export function Cara({
  uid, nombre, className = "", style, fallback, extra,
}: {
  uid?: number | string | null;
  nombre?: string | null;
  className?: string;
  style?: CSSProperties;
  fallback: ReactNode;
  extra?: ReactNode;
}) {
  const foto = useFotoPersona(uid, nombre);
  const [rota, setRota] = useState<string | null>(null);
  const conFoto = foto != null && rota !== foto;
  return (
    <span className={`relative overflow-visible ${className}`} style={conFoto ? { ...style, background: "transparent" } : style}>
      {conFoto ? (
        <img
          src={foto}
          alt={nombre ?? ""}
          title={nombre ?? undefined}
          loading="lazy"
          onError={() => setRota(foto)}
          className="h-full w-full object-cover"
          style={{ borderRadius: "inherit" }}
        />
      ) : fallback}
      {extra}
    </span>
  );
}
