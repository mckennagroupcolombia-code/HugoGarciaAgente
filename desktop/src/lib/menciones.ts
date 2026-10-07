/**
 * Menciones con @ en los grupos (7-oct-2026). El servidor decide a quién nombra un mensaje
 * (canales_internos.detectar_menciones) y lo devuelve en `menciones`; aquí solo se ubica cada
 * @ en el texto para resaltarlo, y se arma la lista del autocompletar de la caja.
 */
export type Persona = { id: number; nombre: string; username?: string };

/** Minúsculas y sin tildes (mismo criterio del servidor). Conserva el largo en texto NFC. */
export function normalizar(t: string): string {
  return (t || "").normalize("NFC").split("").map((ch) => ch.normalize("NFD").replace(/\p{M}/gu, "") || ch).join("").toLowerCase();
}

const TODOS = ["todos", "todas", "equipo"];

/** Un tramo «@…» reconocido: posición en el texto y a quién nombra (null = @todos o teléfono). */
export type TramoMencion = { inicio: number; fin: number; persona: Persona | null };

export function tramosMencion(texto: string, menciones: Persona[]): TramoMencion[] {
  if (!texto.includes("@") || !menciones.length) return [];
  const t = texto.normalize("NFC");
  const norm = normalizar(t);
  const claves: { k: string; p: Persona }[] = [];
  for (const p of menciones) {
    const n = normalizar(p.nombre).trim();
    if (n) claves.push({ k: n, p }, { k: n.split(/\s+/)[0], p });
    const usuario = normalizar(p.username ?? "").replace(/^@+/, "");
    if (usuario) claves.push({ k: usuario, p });
  }
  claves.sort((a, b) => b.k.length - a.k.length);
  const borde = (s: string, i: number) => i >= s.length || !/[\p{L}\p{N}_]/u.test(s[i]);
  const out: TramoMencion[] = [];
  for (let i = 0; i < norm.length; i++) {
    if (norm[i] !== "@" || (i > 0 && /[\p{L}\p{N}_.]/u.test(norm[i - 1]))) continue;
    const resto = norm.slice(i + 1);
    const todos = TODOS.find((k) => resto.startsWith(k) && borde(resto, k.length));
    const tel = /^\d{10,15}/.exec(resto);
    const c = claves.find(({ k }) => k && resto.startsWith(k) && borde(resto, k.length));
    const largo = c ? c.k.length : todos ? todos.length : tel ? tel[0].length : 0;
    if (!largo) continue;
    out.push({ inicio: i, fin: i + 1 + largo, persona: c ? c.p : tel && menciones.length === 1 ? menciones[0] : null });
    i += largo;
  }
  return out;
}

/** El «@algo» que se está escribiendo justo antes del cursor (o null). */
export function consultaEnCurso(texto: string, cursor: number): { inicio: number; q: string } | null {
  const antes = texto.slice(0, cursor);
  const m = /(^|[\s(¿¡])@([\p{L}\p{N}._]{0,30})$/u.exec(antes);
  return m ? { inicio: antes.length - m[2].length - 1, q: m[2] } : null;
}

/** Personas que calzan con lo escrito tras el @ (por cualquier palabra del nombre o el usuario). */
export function sugerencias(personas: Persona[], q: string, limite = 6): Persona[] {
  const n = normalizar(q);
  return personas
    .filter((p) => !n || normalizar(p.nombre).split(/\s+/).some((w) => w.startsWith(n)) || normalizar(p.username ?? "").replace(/^@+/, "").startsWith(n))
    .slice(0, limite);
}
