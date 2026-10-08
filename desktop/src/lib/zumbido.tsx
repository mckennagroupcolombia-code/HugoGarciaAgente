/**
 * Zumbidos en las solicitudes (7-oct-2026), como los de Messenger: quien está en una
 * solicitud toca «📳 Zumbido» y a los demás miembros se les sacude la pantalla con un
 * zumbido (y vibra el celular). Backend: `tickets_db.enviar_zumbido` (uno cada 20 s por
 * persona y solicitud); llegan con `/api/mensajes/resumen` → `useAvisosMensajes`.
 *
 * El sonido se sintetiza con Web Audio (no es un recorte de los juegos) y respeta el
 * interruptor y el volumen de las alertas sonoras (lib/alertasSonido.ts).
 */
import { useState } from "react";
import { api } from "../api/client";
import { useAlertasSonido } from "./alertasSonido";

let ctx: AudioContext | null = null;

function zumbar() {
  const a = useAlertasSonido.getState().ajustes;
  if (!a.activo) return;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = ctx ?? new AC();
    const t0 = ctx.currentTime;
    const vol = Math.max(0, Math.min(1, a.volumen / 100)) * 0.35;
    // Tres pulsos graves con un temblor rápido: «brrr · brrr · brrr».
    for (let i = 0; i < 3; i++) {
      const ini = t0 + i * 0.22;
      const osc = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = 95;
      lfo.frequency.value = 28;
      lfoGain.gain.value = 30;
      lfo.connect(lfoGain).connect(osc.frequency);
      gain.gain.setValueAtTime(0, ini);
      gain.gain.linearRampToValueAtTime(vol, ini + 0.02);
      gain.gain.setValueAtTime(vol, ini + 0.15);
      gain.gain.linearRampToValueAtTime(0, ini + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ini);
      lfo.start(ini);
      osc.stop(ini + 0.19);
      lfo.stop(ini + 0.19);
    }
  } catch {
    /* sin audio */
  }
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
