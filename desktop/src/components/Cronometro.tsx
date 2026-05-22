import { useEffect, useRef, useState } from "react";

export function fmtTiempo(seg: number): string {
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = seg % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function useCronometro() {
  const [segundos, setSegundos] = useState(0);
  const [activo, setActivo] = useState(false);
  const acumRef = useRef(0);
  const inicioRef = useRef<number | null>(null);

  useEffect(() => {
    if (!activo) return;
    const iv = setInterval(() => {
      if (inicioRef.current != null) {
        const total = acumRef.current + Math.floor((Date.now() - inicioRef.current) / 1000);
        setSegundos(total);
      }
    }, 250);
    return () => clearInterval(iv);
  }, [activo]);

  function tomarSegundos() {
    if (activo && inicioRef.current != null) {
      return acumRef.current + Math.floor((Date.now() - inicioRef.current) / 1000);
    }
    return acumRef.current;
  }

  function iniciar() {
    if (activo) return;
    inicioRef.current = Date.now();
    setActivo(true);
  }

  function pausar() {
    if (!activo || inicioRef.current == null) return;
    acumRef.current = tomarSegundos();
    inicioRef.current = null;
    setSegundos(acumRef.current);
    setActivo(false);
  }

  function reiniciar() {
    acumRef.current = 0;
    inicioRef.current = null;
    setSegundos(0);
    setActivo(false);
  }

  /** Persiste el tramo actual y sigue contando (o confirma el acumulado si estaba pausado). */
  function guardar(): number {
    const total = tomarSegundos();
    acumRef.current = total;
    if (activo) {
      inicioRef.current = Date.now();
    }
    setSegundos(total);
    return total;
  }

  return { segundos, activo, iniciar, pausar, reiniciar, guardar, tomarSegundos };
}

const btnSm = "rounded-paper border-2 px-3 py-1.5 text-xs font-bold transition";
const btnMd = "rounded-paper border-2 px-4 py-2 text-sm font-bold transition";

/** Cronómetro local (antes de guardar o en formulario de creación). */
export function CronometroPanel({
  segundos,
  activo,
  onIniciar,
  onPausar,
  onReiniciar,
  onGuardar,
  guardando,
  subtitulo,
  etiqueta = "Cronómetro de misión",
  compact = false,
}: {
  segundos: number;
  activo: boolean;
  onIniciar: () => void;
  onPausar: () => void;
  onReiniciar: () => void;
  onGuardar?: () => void | Promise<void>;
  guardando?: boolean;
  subtitulo?: string;
  etiqueta?: string;
  compact?: boolean;
}) {
  const tiempoCls = compact ? "font-mono text-2xl font-black tabular-nums text-accent" : "font-mono text-4xl font-black tabular-nums text-accent";
  const btn = compact ? btnSm : btnMd;

  return (
    <div
      className={`rounded-paper border-2 border-accent/50 bg-accent/10 shadow-paper-sm
        ${compact ? "px-3 py-2" : "p-4"}`}
    >
      <div className={`flex flex-wrap items-center gap-3 ${compact ? "" : "justify-between gap-4"}`}>
        <div className={compact ? "min-w-[5.5rem]" : ""}>
          {!compact && <p className="text-[10px] font-bold uppercase text-muted">{etiqueta}</p>}
          <p className={tiempoCls}>{fmtTiempo(segundos)}</p>
          {!compact && (
            <p className="mt-1 text-xs text-muted">
              {subtitulo || (activo ? "En curso — marca el tiempo real" : "Pulsa iniciar al comenzar")}
            </p>
          )}
          {compact && (
            <p className="text-[10px] text-muted truncate max-w-[140px]">
              {activo ? "En curso" : subtitulo || etiqueta}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {activo ? (
            <button type="button" onClick={onPausar} className={`${btn} border-border bg-surface-panel`}>
              ⏸ Pausar
            </button>
          ) : (
            <button type="button" onClick={onIniciar} className={`${btn} border-accent bg-accent text-white`}>
              ▶ Iniciar
            </button>
          )}
          {onGuardar && (activo || segundos > 0) && (
            <button
              type="button"
              disabled={guardando}
              onClick={() => void onGuardar()}
              className={`${btn} border-sky-600 bg-sky-600 text-white disabled:opacity-50`}
              title="Guarda el tiempo acumulado sin cerrar el cronómetro"
            >
              💾 {compact ? "Guardar" : "Guardar tiempo"}
            </button>
          )}
          <button type="button" onClick={onReiniciar} className={`${btn} border-border text-muted`}>
            ↺
          </button>
        </div>
      </div>
    </div>
  );
}

/** Cronómetro persistido en servidor (misión / receta en elaboración). */
export function CorridaCronometroBlock({
  segundos,
  estado,
  onIniciar,
  onPausar,
  onReanudar,
  onGuardar,
  onFinalizar,
  guardando,
  etiqueta = "Cronómetro",
  compact = false,
}: {
  segundos: number;
  estado: "activa" | "pausada" | "finalizada" | null;
  onIniciar?: () => void;
  onPausar?: () => void;
  onReanudar?: () => void;
  onGuardar?: () => void | Promise<void>;
  onFinalizar?: () => void;
  guardando?: boolean;
  etiqueta?: string;
  compact?: boolean;
}) {
  const btn = compact ? btnSm : btnMd;
  const tiempoCls = compact ? "font-mono text-2xl font-black tabular-nums text-accent" : "font-mono text-4xl font-black tabular-nums text-accent";

  if (estado === "finalizada") {
    return (
      <div className={`rounded-paper border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 ${compact ? "px-3 py-2" : "px-4 py-3"}`}>
        <p className={`font-semibold text-emerald-800 dark:text-emerald-300 ${compact ? "text-xs" : "text-sm"}`}>
          ⏱ {fmtTiempo(segundos)}
        </p>
      </div>
    );
  }

  if (!estado) {
    return (
      <button
        type="button"
        onClick={onIniciar}
        className={`w-full rounded-paper border-2 border-accent bg-accent/10 font-bold text-accent hover:bg-accent hover:text-white
          ${compact ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm"}`}
      >
        ▶ Iniciar {compact ? "" : etiqueta.toLowerCase()}
      </button>
    );
  }

  return (
    <div className={`rounded-paper border-2 border-accent/50 bg-accent/10 ${compact ? "px-3 py-2" : "p-4 shadow-paper-sm"}`}>
      <div className={`flex flex-wrap items-center gap-3 ${compact ? "" : "justify-between gap-4"}`}>
        <div>
          {!compact && <p className="text-[10px] font-bold uppercase text-muted">{etiqueta}</p>}
          <p className={tiempoCls}>{fmtTiempo(segundos)}</p>
          <p className={`text-muted ${compact ? "text-[10px]" : "mt-1 text-xs"}`}>
            {estado === "activa" ? "En curso" : "En pausa"}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {estado === "activa" ? (
            <button type="button" onClick={onPausar} className={`${btn} border-border bg-surface-panel`}>
              ⏸ Pausar
            </button>
          ) : (
            <button type="button" onClick={onReanudar} className={`${btn} border-accent bg-accent text-white`}>
              ▶ Reanudar
            </button>
          )}
          {onGuardar && (
            <button
              type="button"
              disabled={guardando}
              onClick={() => void onGuardar()}
              className={`${btn} border-sky-600 bg-sky-600 text-white disabled:opacity-50`}
              title="Guarda el tiempo acumulado sin cerrar el cronómetro"
            >
              💾 {compact ? "Guardar" : "Guardar tiempo"}
            </button>
          )}
          <button type="button" onClick={onFinalizar} className={`${btn} border-emerald-500 bg-emerald-500 text-white`}>
            ✓ {compact ? "Fin" : "Finalizar"}
          </button>
        </div>
      </div>
    </div>
  );
}
