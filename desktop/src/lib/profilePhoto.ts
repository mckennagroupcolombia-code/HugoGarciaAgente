import type { TicketsUser } from "../stores/ticketsAuth";

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp"]);

export function ticketsUploadUrl(filename: string, token: string, bust?: string | number) {
  const base = `/api/tickets/uploads/${encodeURIComponent(filename)}?token=${encodeURIComponent(token)}`;
  return bust != null ? `${base}&_t=${bust}` : base;
}

export function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXT.has(ext);
}

async function tapiUpload(path: string, token: string, body: FormData) {
  const url = `/api/tickets${path}`;
  const res = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  let data: any;
  try {
    data = await res.json();
  } catch {
    if (!res.ok) throw new Error(`Error ${res.status}`);
    return {};
  }
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data;
}

export async function uploadProfilePhoto(token: string, file: File): Promise<TicketsUser> {
  if (!isImageFile(file)) {
    throw new Error("Selecciona una imagen (JPG, PNG, GIF o WEBP).");
  }
  const fd = new FormData();
  fd.append("foto", file);
  const res = await tapiUpload("/auth/me/foto", token, fd);
  if (!res.usuario) throw new Error("No se recibió el perfil actualizado.");
  return res.usuario as TicketsUser;
}

export async function removeProfilePhoto(token: string): Promise<TicketsUser> {
  const res = await fetch("/api/tickets/auth/me/foto", {
    method: "DELETE",
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  let data: any;
  try {
    data = await res.json();
  } catch {
    if (!res.ok) throw new Error(`Error ${res.status}`);
    return {} as TicketsUser;
  }
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  if (!data.usuario) throw new Error("No se recibió el perfil actualizado.");
  return data.usuario as TicketsUser;
}
