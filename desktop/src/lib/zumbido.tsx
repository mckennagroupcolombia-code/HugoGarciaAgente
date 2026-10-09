/**
 * Zumbidos en las solicitudes (7-oct-2026), como los de Messenger: quien está en una
 * solicitud toca «📳 Zumbido» y a los demás miembros se les sacude la pantalla con un
 * zumbido (y vibra el celular). Backend: `tickets_db.enviar_zumbido` (uno cada 20 s por
 * persona y solicitud); llegan con `/api/mensajes/resumen` → `useAvisosMensajes`.
 *
 * El sonido se sintetiza con Web Audio (no es un recorte de los juegos) y respeta el
 * interruptor y el volumen de las alertas sonoras (lib/alertasSonido.ts). Desde el 8-oct-2026
 * es la vibración del lenguaje sonoro: grave y filtrada, ya no la sierra áspera de antes.
 */
import { useState } from "react";
import { api } from "../api/client";
import { useAlertasSonido } from "./alertasSonido";
import { tocarEarcon } from "./lenguajeSonoro";

/** «brrr · brrr · brrr»: la vibración grave del lenguaje sonoro (lib/lenguajeSonoro.ts). */
function zumbar() {
  const a = useAlertasSonido.getState().ajustes;
  if (!a.activo) return;
  tocarEarcon("zumbido", { volumen: Math.max(0, Math.min(1, a.volumen / 100)) });
}

/** Sacude la pantalla (clase en <html>, ver index.css), zumba y vibra el celular. */
export function recibirZumbido() {
  const html = document.documentElement;
  html.classList.remove("mck-zumbido");
  void html.offsetWidth; // reinicia la animación si llegan dos seguidos
  html.classList.add("mck-zumbido");
  window.setTimeout(() => html.classList.remove("mck-zumbido"), 800);
  zumbar();
  try {
    navigator.vibrate?.([180, 60, 180, 60, 180]);
  } catch {
    /* sin vibración */
  }
}

/** Botón del cabezote de una solicitud. `className` para calzar con cada hilo. */
export function BotonZumbido({ ticketId, className = "", conTexto = true }: { ticketId: number; className?: string; conTexto?: boolean }) {
  const [estado, setEstado] = useState<"" | "enviando" | "ok" | string>("");
  async function enviar() {
    if (estado === "enviando") return;
    setEstado("enviando");
    try {
      await api.post(`/api/tickets/${ticketId}/zumbido`, {});
      setEstado("ok");
    } catch (e) {
      setEstado(e instanceof Error ? e.message : "No se pudo");
    }
    window.setTimeout(() => setEstado(""), 2500);
  }
  const error = estado && estado !== "enviando" && estado !== "ok" ? estado : "";
  return (
    <button type="button" onClick={() => void enviar()} disabled={estado === "enviando"}
      className={`${className} ${estado === "ok" ? "mck-zumbido-enviado" : ""}`}
      title={error || "Enviar un zumbido: sacude la pantalla de los demás en esta solicitud"}
      aria-label="Enviar un zumbido">
      📳{conTexto && <span className="hidden sm:inline"> {estado === "ok" ? "¡Zumbó!" : error ? "Espera" : "Zumbido"}</span>}
    </button>
  );
}
