import { useState } from "react";
import { useActividadEquipo, type EventoActividadEquipo } from "../hooks/useActividadEquipo";
import { useTicketsAuth } from "../stores/ticketsAuth";
import { Icon, type IconName } from "../icons";

function minutosDesde(iso: string): number {
  // El backend guarda `creado_en` en hora local del servidor (datetime('now') SQLite),
  // igual que el resto de logs_auditoria — sin sufijo de zona horaria.
  const ms = Date.now() - new Date(iso.replace(" ", "T")).getTime();
  return Math.max(0, Math.floor(ms / 60000));
}

function tiempoRelativo(iso: string): string {
  const min = minutosDesde(iso);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const horas = Math.floor(min / 60);
  return `hace ${horas}h`;
}

function iconoEvento(e: EventoActividadEquipo): IconName {
  if (e.accion === "ticket_creado") return "lightning";
  if (e.accion === "comentario_agregado") return "chat";
  if (e.resumen.includes("completó")) return "check";
  if (e.resumen.includes("inició")) return "play";
  if (e.resumen.includes("pausó")) return "pause";
  return "ticket";
}

/**
 * Banner fijo con lo que está haciendo el equipo hoy en Acciones/Solicitudes —
 * reemplaza el mensaje instantáneo que antes recibía el grupo MCKG SEDE SUR
 * por cada cambio de estado (ver app/services/tickets_db.py::actividad_equipo_hoy
 * y scripts/resumen_actividad_sede_sur_cron.py para el resumen diario de WhatsApp).
 */
export default function TeamActivityBanner() {
  const token = useTicketsAuth((s) => s.token);
  const [open, setOpen] = useState(false);
  const { data } = useActividadEquipo();

  if (!token) return null;
  const eventos = data?.eventos ?? [];
  if (eventos.length === 0) return null;

  const ultimo = eventos[0];

  return (
    <div className="border-b border-border/80 bg-surface-panel/60 px-3 py-1.5 sm:px-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full min-w-0 items-center gap-2 text-left text-xs"
      >
        <Icon name="users" size={14} className="shrink-0 text-accent" />
        <span className="truncate text-ink-secondary">
          <span className="font-semibold text-accent">Actividad del equipo</span>
          {" — "}
          {ultimo.resumen}
          <span className="text-muted"> ({tiempoRelativo(ultimo.creado_en)})</span>
        </span>
        <span className="ml-auto shrink-0 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold text-accent">
          {eventos.length} hoy
        </span>
        <Icon
          name={open ? "collapse" : "expand"}
          size={12}
          className="shrink-0 text-muted"
        />
      </button>

      {open && (
        <div className="mt-1.5 max-h-56 overflow-y-auto rounded-paper border border-border-strong bg-surface-panel p-2 shadow-paper-sm">
          {eventos.map((e) => (
            <div
              key={e.id}
              className="flex items-start gap-2 border-b border-border/40 py-1.5 text-xs last:border-b-0"
            >
              <Icon name={iconoEvento(e)} size={13} className="mt-0.5 shrink-0 text-accent" />
              <div className="min-w-0 flex-1 text-ink-secondary">{e.resumen}</div>
              <div className="shrink-0 text-[10px] text-muted">{tiempoRelativo(e.creado_en)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
