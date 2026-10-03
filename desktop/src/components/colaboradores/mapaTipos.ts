/** Tipos de tarjeta del mapa de Colaboradores: nombre, sprite, color y qué suele brotar de cada uno.
 *  Los comparten el mapa (MapaProyecto) y su guía animada (GuiaMapa). */
import type { SpriteId } from "./pixel";

export type TipoT = "origen" | "meta" | "rol" | "resultado" | "obstaculo" | "decision" | "tarea" | "idea" | "acuerdo" | "paso";

export const SECCIONES: { tipo: TipoT; titulo: string; pregunta: string; sprite: SpriteId }[] = [
  { tipo: "origen", titulo: "De dónde partimos", pregunta: "¿Cómo empezó esto y con qué contamos?", sprite: "cofre" },
  { tipo: "meta", titulo: "La meta", pregunta: "¿Qué tiene que pasar para decir que funcionó?", sprite: "trofeo" },
  { tipo: "rol", titulo: "Quién hace qué", pregunta: "¿Qué pone cada uno y qué recibe?", sprite: "jugador" },
  { tipo: "obstaculo", titulo: "Lo que nos frena", pregunta: "Problemas abiertos y cómo se resolvieron", sprite: "alerta" },
  { tipo: "decision", titulo: "Decisiones", pregunta: "Lo que hay que acordar entre los dos", sprite: "urna" },
  { tipo: "tarea", titulo: "Próxima jugada", pregunta: "Qué sigue y a quién le toca", sprite: "reloj" },
  { tipo: "resultado", titulo: "Resultados", pregunta: "Lo que ya salió, con fecha y prueba", sprite: "estrella" },
  { tipo: "acuerdo", titulo: "Acuerdos", pregunta: "Precios, comisiones y reglas que ya quedaron", sprite: "pulgar" },
  { tipo: "idea", titulo: "Ideas", pregunta: "Para después: sin compromiso todavía", sprite: "gema" },
  { tipo: "paso", titulo: "Proceso", pregunta: "Un paso de cómo se hace", sprite: "control" },
];
/** Color de la cabeza de cada nodo (paleta PICO-8 del resto de Colaboradores) y su letra. */
export const COLOR_TIPO: Record<TipoT, [string, string]> = {
  origen: ["#5F574F", "#fff"], meta: ["#FFA300", "#000"], rol: ["#29ADFF", "#000"], resultado: ["#008751", "#fff"],
  obstaculo: ["#FF004D", "#fff"], decision: ["#7E2553", "#fff"], tarea: ["#1D2B53", "#fff"], idea: ["#83769C", "#fff"],
  acuerdo: ["#AB5236", "#fff"], paso: ["#C2C3C7", "#000"],
};
/** Qué suele brotar de cada tipo al tocar «＋» (se puede cambiar en la hoja). */
export const HIJO_DE: Record<TipoT | "raiz", TipoT> = {
  raiz: "origen", origen: "resultado", meta: "resultado", rol: "tarea", resultado: "resultado", obstaculo: "decision",
  decision: "resultado", tarea: "resultado", idea: "tarea", acuerdo: "tarea", paso: "paso",
};
export const NOMBRE_TIPO: Record<TipoT, string> = {
  origen: "Punto de partida", meta: "Meta", rol: "Quién hace qué", resultado: "Resultado", obstaculo: "Obstáculo",
  decision: "Decisión", tarea: "Próxima jugada", idea: "Idea", acuerdo: "Acuerdo", paso: "Paso del proceso",
};
export const SPRITE_TIPO = Object.fromEntries(SECCIONES.map((s) => [s.tipo, s.sprite])) as Record<TipoT, SpriteId>;
