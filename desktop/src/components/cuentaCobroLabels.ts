import { useTicketsAuth } from "../stores/ticketsAuth";

/** Nombre del emisor (perfil logueado, o fallback de marca). */
export function datos_emisor_label(fallback = "Cynthia Ruiz"): string {
  const u = useTicketsAuth.getState().user;
  return (u?.nombre || "").trim() || fallback;
}

/** Documento del emisor desde el perfil (vacío si falta). */
export function datos_emisor_documento(): string {
  const u = useTicketsAuth.getState().user;
  return (u?.documento_identidad || "").trim();
}
