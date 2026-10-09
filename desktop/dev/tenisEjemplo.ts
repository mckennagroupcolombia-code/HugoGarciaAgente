/**
 * Tenis de EJEMPLO para el banco de pruebas (Empresa viva → cancha del parque). Mismas reglas que
 * app/services/empresa_viva_tenis.py (sala → equipos → el anfitrión anota con el conteo de tenis).
 * Victor (7) se une al equipo B a los 2 s de armar un partido y su raqueta sigue la pelota (con
 * algo de retraso, para que se le puedan ganar puntos). Cynthia te invita a uno a los 40 s de abrir el banco.
 */
interface Partido {
  id: number; creador: number; host: number; estado: string; equipos: { A: number[]; B: number[] };
  puntos: { A: number; B: number }; juegos: { A: number; B: number }; saca: "A" | "B"; ganador: "A" | "B" | null; motivo: string;
  pelota: { x: number; y: number; vx: number; vy: number; t: number; quieta?: boolean } | null; punto_seq: number;
  raquetas: Record<string, { x: number; y: number; t: number }>; creada: number; actualizada: number; invitados: number[];
}

const inicio = Date.now();
const partidos: Partido[] = [];
let sig = 1;
let deCynthia = false;
const ahora = () => Date.now() / 1000;
const respuesta = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
const falla = (texto: string, status = 400) => respuesta({ error: texto }, status);
const vista = (p: Partido) => ({ ...p, activos: [...p.equipos.A, ...p.equipos.B], juegos_para_ganar: 2, max_por_equipo: 3, ahora: ahora() });

function nuevo(creador: number, invitados: number[] = []): Partido {
  const p: Partido = { id: sig++, creador, host: creador, estado: "sala", equipos: { A: [creador], B: [] }, puntos: { A: 0, B: 0 },
    juegos: { A: 0, B: 0 }, saca: "A", ganador: null, motivo: "", pelota: null, punto_seq: 0, raquetas: {}, creada: ahora(), actualizada: ahora(), invitados };
  partidos.push(p);
  return p;
}

function anotar(p: Partido, eq: "A" | "B") {
  const otro = eq === "A" ? "B" : "A";
  p.puntos[eq] += 1;
  if (p.puntos[eq] >= 4 && p.puntos[eq] - p.puntos[otro] >= 2) {
    p.juegos[eq] += 1;
    p.puntos = { A: 0, B: 0 };
    p.saca = (p.juegos.A + p.juegos.B) % 2 ? "B" : "A";
    if (p.juegos[eq] >= 2) { p.estado = "terminada"; p.ganador = eq; p.motivo = "partido ganado"; p.pelota = null; }
  }
}

export function tenisEjemplo(ruta: string, init: RequestInit | undefined, yo: number): Response | null {
  if (!ruta.startsWith("/api/empresa-viva/tenis")) return null;
  const metodo = init?.method ?? "GET";
  const cuerpo = (() => { try { return JSON.parse(String(init?.body || "{}")); } catch { return {}; } })();
  // Cynthia te invita a un partido a los 40 s (sale el diálogo con «Unirme»).
  if (!deCynthia && !new URLSearchParams(location.search).has("sin_retos") && Date.now() - inicio > 40_000) { deCynthia = true; nuevo(6, [yo]); }
  if (ruta === "/api/empresa-viva/tenis") {
    if (metodo === "POST") {
      if (partidos.some((p) => p.estado !== "terminada" && [...p.equipos.A, ...p.equipos.B].includes(yo))) return falla("Ya estás en un partido");
      const p = nuevo(yo, Array.isArray(cuerpo.invitar) ? cuerpo.invitar.map(Number) : []);
      window.setTimeout(() => { if (p.estado === "sala" && !p.equipos.B.includes(7)) p.equipos.B.push(7); }, 2000);
      return respuesta(vista(p));
    }
    return respuesta({ partidos: partidos.map(vista).reverse(), ahora: ahora() });
  }
  const m = ruta.match(/^\/api\/empresa-viva\/tenis\/(\d+)(?:\/([a-z]+))?$/);
  const p = m ? partidos.find((x) => x.id === Number(m[1])) : undefined;
  if (!m || !p) return falla("Ese partido ya no existe", 404);
  const accion = m[2];
  if (!accion) return respuesta(vista(p));
  const eq = p.equipos.A.includes(yo) ? "A" : p.equipos.B.includes(yo) ? "B" : null;
  switch (accion) {
    case "unirse": {
      const e = cuerpo.equipo as "A" | "B";
      p.equipos.A = p.equipos.A.filter((u) => u !== yo);
      p.equipos.B = p.equipos.B.filter((u) => u !== yo);
      p.equipos[e].push(yo);
      return respuesta(vista(p));
    }
    case "invitar":
      p.invitados = [...new Set([...p.invitados, ...(Array.isArray(cuerpo.a) ? cuerpo.a.map(Number) : [])])];
      return respuesta(vista(p));
    case "salir":
      p.equipos.A = p.equipos.A.filter((u) => u !== yo);
      p.equipos.B = p.equipos.B.filter((u) => u !== yo);
      if (p.host === yo) p.host = [...p.equipos.A, ...p.equipos.B][0] ?? yo;
      return respuesta(vista(p));
    case "empezar":
      if (!p.equipos.A.length || !p.equipos.B.length) return falla("Falta al menos una persona en cada equipo");
      p.estado = "jugando";
      // Si el partido es de Cynthia, ella es la anfitriona pero en el banco no hay nadie llevando la
      // pelota: el anfitrión pasa a quien está jugando aquí.
      p.host = yo;
      return respuesta(vista(p));
    case "estado": {
      if (!eq) return falla("No estás en ese partido", 403);
      const r = cuerpo.raqueta;
      if (r) p.raquetas[String(yo)] = { x: r.x, y: r.y, t: ahora() };
      if (p.host === yo && p.estado === "jugando") {
        if (cuerpo.pelota) p.pelota = { ...cuerpo.pelota, t: ahora() };
        if ((cuerpo.punto === "A" || cuerpo.punto === "B") && cuerpo.punto_seq === p.punto_seq + 1) {
          p.punto_seq += 1;
          anotar(p, cuerpo.punto);
        }
      }
      // Los compañeros de ejemplo: siguen la pelota con retraso, cada uno en su lado.
      for (const e of ["A", "B"] as const)
        for (const u of p.equipos[e]) {
          if (u === yo) continue;
          const prev = p.raquetas[String(u)] ?? { x: e === "A" ? 0.12 : 0.88, y: 0.5, t: ahora() };
          const meta = p.pelota ? p.pelota.y : 0.5;
          const y = prev.y + Math.max(-0.045, Math.min(0.045, (meta - prev.y) * 0.5));
          p.raquetas[String(u)] = { x: e === "A" ? 0.12 : 0.88, y: Math.min(0.92, Math.max(0.08, y)), t: ahora() };
        }
      return respuesta(vista(p));
    }
  }
  return falla("Acción desconocida", 404);
}
