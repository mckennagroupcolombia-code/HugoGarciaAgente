/** Helpers de formato compartidos por el inbox unificado de Solicitudes/Acciones. */

export function uidEq(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return false;
  return Number(a) === Number(b);
}

/** Timestamps del backend vienen sin zona (hora local del servidor) — sin esto Date los toma como UTC. */
export function fechaServidorToDate(s: string): Date {
  return new Date(s.includes("T") || s.includes("Z") ? s : `${s}Z`);
}

export function getDateLabel(ts: string): string | null {
  try {
    const d = fechaServidorToDate(ts);
    const hoy = new Date();
    const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
    if (d.toDateString() === hoy.toDateString()) return "Hoy";
    if (d.toDateString() === ayer.toDateString()) return "Ayer";
    return d.toLocaleDateString("es-CO", { day: "numeric", month: "short" });
  } catch { return null; }
}

export function horaDe(ts: string): string {
  try { return fechaServidorToDate(ts).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
}

export function tiempoRelativo(ts: string): string {
  try {
    const min = Math.max(0, Math.floor((Date.now() - fechaServidorToDate(ts).getTime()) / 60000));
    if (min < 1) return "recién";
    if (min < 60) return `hace ${min} min`;
    const horas = Math.floor(min / 60);
    if (horas < 24) return `hace ${horas}h`;
    const dias = Math.floor(horas / 24);
    if (dias < 7) return `hace ${dias}d`;
    return fechaServidorToDate(ts).toLocaleDateString("es-CO", { day: "numeric", month: "short" });
  } catch { return ""; }
}

export function iniciales(nombre: string | null | undefined): string {
  if (!nombre) return "?";
  const partes = nombre.trim().split(/\s+/);
  const a = partes[0]?.charAt(0) ?? "";
  const b = partes.length > 1 ? partes[partes.length - 1].charAt(0) : "";
  return (a + b).toUpperCase() || "?";
}

export const ESTADO_LABEL: Record<string, string> = {
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  esperando_aprobacion: "Esperando aprobación",
  resuelto: "Resuelta",
  rechazado: "Rechazada",
};

export const ESTADO_DOT_CLASS: Record<string, string> = {
  pendiente: "bg-amber-500",
  en_proceso: "bg-sky-500",
  esperando_aprobacion: "bg-violet-500",
  resuelto: "bg-slate-400",
  rechazado: "bg-rose-500/60",
};

/** Pill de estado para la fila de conversación — texto siempre visible, no solo color,
 * para que "abierta" vs "cerrada" no dependa de memorizar el color de un punto. */
export const ESTADO_PILL_CLASS: Record<string, string> = {
  pendiente: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  en_proceso: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  esperando_aprobacion: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  resuelto: "bg-slate-500/10 text-muted",
  rechazado: "bg-rose-500/10 text-rose-500/80",
};

export function estaAbierta(estado: string): boolean {
  return estado !== "resuelto" && estado !== "rechazado";
}
