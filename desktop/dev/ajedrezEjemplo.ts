/**
 * Ajedrez de EJEMPLO para el banco de pruebas (Empresa viva → mesa del parque). Partidas en
 * memoria con las mismas reglas que app/services/empresa_viva_ajedrez.py (turno por paridad, `n`
 * para no mover dos veces, el resultado según el motivo). El rival de ejemplo acepta los retos a
 * los 2,5 s y responde con una jugada al azar 1,5 s después de la tuya. Cynthia y Victor tienen
 * una partida en curso (para mirar) y Jenniffer te reta a los 25 s de abrir el banco.
 */
import { Chess } from "chess.js";

interface Partida {
  id: number; blancas: number; negras: number; reta: number; estado: string; jugadas: string[]; resultado: string;
  motivo: string; tablas_ofrece: number | null; creada: number; actualizada: number;
}

const inicio = Date.now();
const partidas: Partida[] = [];
let siguiente = 1;
let retoJenniffer = false;

function nueva(blancas: number, negras: number, reta: number, estado: string, jugadas: string[] = []): Partida {
  const p = { id: siguiente++, blancas, negras, reta, estado, jugadas, resultado: "", motivo: "", tablas_ofrece: null,
              creada: Date.now() / 1000, actualizada: Date.now() / 1000 };
  partidas.push(p);
  return p;
}
nueva(6, 7, 6, "jugando", ["e2e4", "c7c5", "g1f3", "d7d6", "d2d4", "c5d4", "f3d4", "g8f6"]);

// Trofeos de EJEMPLO: el oro de Armando contra Cynthia (como el de verdad del 8-oct) y uno de Victor.
const trofeos: { id: number; usuario: number; juego: string; partida: number; rival: number; medalla: string; motivo: string; jugadas: number; ganado: number }[] = [
  { id: 1, usuario: 8, juego: "ajedrez", partida: 101, rival: 6, medalla: "oro", motivo: "jaque mate", jugadas: 74, ganado: Date.now() / 1000 - 3600 },
  { id: 2, usuario: 7, juego: "ajedrez", partida: 102, rival: 9, medalla: "plata", motivo: "rendición", jugadas: 31, ganado: Date.now() / 1000 - 7200 },
];
function premiar(p: Partida) {
  if (p.estado !== "terminada" || !["1-0", "0-1"].includes(p.resultado) || trofeos.some((t) => t.partida === p.id)) return;
  const [gana, pierde] = p.resultado === "1-0" ? [p.blancas, p.negras] : [p.negras, p.blancas];
  trofeos.push({ id: trofeos.length + 1, usuario: gana, juego: "ajedrez", partida: p.id, rival: pierde,
                 medalla: p.motivo === "jaque mate" ? "oro" : "plata", motivo: p.motivo, jugadas: p.jugadas.length, ganado: Date.now() / 1000 });
}

const fila = (p: Partida) => ({ ...p, turno: p.jugadas.length % 2 === 0 ? "blancas" : "negras" });
const respuesta = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
const falla = (texto: string, status = 400) => respuesta({ error: texto }, status);

/** El rival de ejemplo: acepta y juega solo (una jugada legal al azar). */
function rivalJuega(p: Partida, yo: number) {
  window.setTimeout(() => {
    if (p.estado !== "jugando") return;
    const ch = new Chess();
    for (const u of p.jugadas) ch.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });
    const mueveRival = (ch.turn() === "w" ? p.blancas : p.negras) !== yo;
    if (!mueveRival || ch.isGameOver()) return;
    const ms = ch.moves({ verbose: true });
    const capturas = ms.filter((m) => m.captured);
    const pool = capturas.length && Math.random() < 0.6 ? capturas : ms;
    const m = pool[Math.floor(Math.random() * pool.length)];
    ch.move(m);
    p.jugadas = [...p.jugadas, `${m.from}${m.to}${m.promotion ?? ""}`];
    p.actualizada = Date.now() / 1000;
    if (ch.isCheckmate()) { p.estado = "terminada"; p.resultado = ch.turn() === "w" ? "0-1" : "1-0"; p.motivo = "jaque mate"; }
    else if (ch.isDraw()) { p.estado = "terminada"; p.resultado = "1/2-1/2"; p.motivo = ch.isStalemate() ? "ahogado" : "material insuficiente"; }
  }, 1500);
}

export function ajedrezEjemplo(ruta: string, init: RequestInit | undefined, yo: number): Response | null {
  if (!ruta.startsWith("/api/empresa-viva/ajedrez")) return null;
  const metodo = init?.method ?? "GET";
  const cuerpo = (() => { try { return JSON.parse(String(init?.body || "{}")); } catch { return {}; } })();
  if (!retoJenniffer && Date.now() - inicio > 25_000) {
    retoJenniffer = true;
    nueva(10, yo, 10, "invitada");
  }
  if (ruta === "/api/empresa-viva/ajedrez") {
    if (metodo === "POST") {
      const a = Number(cuerpo.a);
      if (!a || a === yo) return falla("Elige a otra persona del equipo");
      if (partidas.some((p) => ["invitada", "jugando"].includes(p.estado) && [p.blancas, p.negras].includes(a) && [p.blancas, p.negras].includes(yo)))
        return falla("Ya tienen una partida abierta: síganla");
      const p = Math.random() < 0.5 ? nueva(yo, a, yo, "invitada") : nueva(a, yo, yo, "invitada");
      window.setTimeout(() => { if (p.estado === "invitada") { p.estado = "jugando"; p.actualizada = Date.now() / 1000; rivalJuega(p, yo); } }, 2500);
      return respuesta(fila(p));
    }
    const mias = partidas.filter((p) => [p.blancas, p.negras].includes(yo));
    const enCurso = partidas.filter((p) => p.estado === "jugando" && ![p.blancas, p.negras].includes(yo));
    partidas.forEach(premiar);
    return respuesta({ mias: mias.map(fila), en_curso: enCurso.map(fila), trofeos, ahora: Date.now() / 1000 });
  }
  const m = ruta.match(/^\/api\/empresa-viva\/ajedrez\/(\d+)(?:\/([a-z]+))?$/);
  const p = m ? partidas.find((x) => x.id === Number(m[1])) : undefined;
  if (!m || !p) return falla("No existe esa partida", 404);
  const accion = m[2];
  if (!accion) return respuesta(fila(p));
  const mia = [p.blancas, p.negras].includes(yo);
  if (!mia) return falla("No es tu partida", 403);
  p.actualizada = Date.now() / 1000;
  switch (accion) {
    case "aceptar":
    case "rechazar":
    case "cancelar":
      if (p.estado !== "invitada") return falla("Ese reto ya no está pendiente");
      p.estado = accion === "aceptar" ? "jugando" : accion === "rechazar" ? "rechazada" : "cancelada";
      if (p.estado === "jugando") rivalJuega(p, yo);
      return respuesta(fila(p));
    case "jugada": {
      if (p.estado !== "jugando") return falla("La partida no está en juego");
      if (Number(cuerpo.n) !== p.jugadas.length) return falla("La partida cambió: vuelve a mirar el tablero");
      const mueveBlancas = p.jugadas.length % 2 === 0;
      if ((mueveBlancas ? p.blancas : p.negras) !== yo) return falla("No es tu turno");
      p.jugadas = [...p.jugadas, String(cuerpo.uci)];
      if (cuerpo.fin) {
        p.estado = "terminada";
        p.motivo = String(cuerpo.fin);
        p.resultado = p.motivo === "jaque mate" ? (mueveBlancas ? "1-0" : "0-1") : "1/2-1/2";
      } else rivalJuega(p, yo);
      p.tablas_ofrece = null;
      return respuesta(fila(p));
    }
    case "rendirse":
      p.estado = "terminada"; p.resultado = p.blancas === yo ? "0-1" : "1-0"; p.motivo = "rendición";
      return respuesta(fila(p));
    case "tablas":
      if (cuerpo.accion === "ofrecer") {
        p.tablas_ofrece = yo;
        // El rival de ejemplo las rechaza a los 3 s.
        window.setTimeout(() => { p.tablas_ofrece = null; }, 3000);
      } else if (cuerpo.accion === "aceptar") { p.estado = "terminada"; p.resultado = "1/2-1/2"; p.motivo = "tablas acordadas"; p.tablas_ofrece = null; }
      else p.tablas_ofrece = null;
      return respuesta(fila(p));
  }
  return falla("Acción desconocida", 404);
}
