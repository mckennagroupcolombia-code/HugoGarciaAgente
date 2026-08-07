import type { CampoDiagramacion, DiagramacionEtiqueta } from "../../lib/etiquetasDiagramacion";
import {
  ALINEACIONES_LIENZO,
  ALINEACIONES_TEXTO,
  FUENTE_ETIQUETA,
  labelCampoDiagramacion,
  patchDiagramacion,
  type AlineacionLienzo,
} from "../../lib/etiquetasDiagramacion";

interface Props {
  campoId: string | null;
  campoLabel?: string;
  cfg?: CampoDiagramacion;
  colorFallback: string;
  escala: number;
  b1AnchoPct?: number;
  tx: number;
  ty: number;
  onPatch: (patch: CampoDiagramacion) => void;
  onAnadirCajaTexto?: () => void;
  onEscrituraMagica?: () => void;
  escrituraMagicaCargando?: boolean;
  compact?: boolean;
  /** Solo controles X/Y (líneas y recuadros). */
  soloPosicion?: boolean;
  /** Hay un bloque o gráfico seleccionado en el lienzo. */
  elementoSeleccionado?: boolean;
  onAlinearLienzo?: (modo: AlineacionLienzo) => void;
}

function clampEscala(n: number) {
  return Math.max(0.6, Math.min(1.8, Math.round(n * 100) / 100));
}

function clampPct(n: number) {
  return Math.max(50, Math.min(100, Math.round(n)));
}

/** Barra de herramientas tipográficas sobre la vista previa. */
export function EtiquetaTextoToolbar({
  campoId,
  campoLabel,
  cfg,
  colorFallback,
  escala,
  b1AnchoPct,
  tx,
  ty,
  onPatch,
  onAnadirCajaTexto,
  onEscrituraMagica,
  escrituraMagicaCargando = false,
  compact = false,
  soloPosicion = false,
  elementoSeleccionado = false,
  onAlinearLienzo,
}: Props) {
  const disabled = !campoId && !soloPosicion && !elementoSeleccionado;
  const color = (cfg?.color ?? colorFallback).match(/^#[0-9A-Fa-f]{6}$/)
    ? (cfg?.color ?? colorFallback)
    : "#000000";
  const esB1 = campoId === "b1" || campoId?.startsWith("b1_");
  const alineacion = cfg?.alineacion ?? (esB1 ? "justify" : "left");

  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-paper border border-border bg-surface px-2 py-1.5 ${FUENTE_ETIQUETA} ${
        disabled ? "opacity-60" : ""
      }`}
    >
      <span className="min-w-[7rem] text-[10px] font-semibold text-ink">
        {soloPosicion
          ? "Posición"
          : disabled
            ? "Selecciona un bloque"
            : campoLabel ?? labelCampoDiagramacion(campoId!)}
      </span>

      {!soloPosicion && (
        <>
      <div className="flex items-center gap-1">
        {onAnadirCajaTexto && (
          <button
            type="button"
            onClick={onAnadirCajaTexto}
            className="rounded border border-border px-2 py-0.5 text-[10px] font-semibold text-ink hover:bg-surface-hover"
            title="Crear caja de texto libre"
          >
            + Caja de texto
          </button>
        )}
        {onEscrituraMagica && (
          <button
            type="button"
            onClick={onEscrituraMagica}
            disabled={escrituraMagicaCargando}
            className="rounded border border-border px-2 py-0.5 text-[10px] font-semibold text-ink hover:bg-surface-hover disabled:opacity-50"
            title={
              esB1
                ? "Generar descripción desde ficha técnica (IA)"
                : "Aplicar formato inteligente al texto seleccionado"
            }
          >
            {escrituraMagicaCargando ? "Generando…" : "Escritura magica"}
          </button>
        )}
      </div>

      <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />

      <div className="flex items-center gap-0.5" title="Alineación">
        {ALINEACIONES_TEXTO.map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={disabled}
            title={a.title}
            aria-label={a.title}
            onClick={() => onPatch({ alineacion: a.id })}
            className={`rounded border px-1.5 py-0.5 text-sm font-bold disabled:cursor-not-allowed ${
              alineacion === a.id
                ? "border-accent bg-accent text-white"
                : "border-border text-ink-secondary hover:bg-surface-hover"
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>

      <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />

      <label className="flex items-center gap-1.5 text-[10px]" title="Color">
        <span className="text-muted">Color</span>
        <input
          type="color"
          disabled={disabled}
          value={color}
          onChange={(e) => onPatch({ color: e.target.value })}
          className="h-7 w-8 cursor-pointer rounded border border-border bg-surface-input p-0 disabled:cursor-not-allowed"
        />
      </label>

      <label className="flex min-w-[120px] flex-1 items-center gap-1.5 text-[10px]" title="Tamaño">
        <span className="shrink-0 text-muted">Tamaño</span>
        <input
          type="range"
          min={0.6}
          max={1.8}
          step={0.05}
          disabled={disabled}
          value={cfg?.escala ?? escala}
          onChange={(e) => onPatch({ escala: clampEscala(parseFloat(e.target.value)) })}
          className="min-w-[72px] flex-1 accent-accent disabled:opacity-50"
        />
        <span className="w-8 font-mono text-[9px]">{(cfg?.escala ?? escala).toFixed(2)}</span>
      </label>

      <label className="flex items-center gap-1 text-[10px]" title="Interlineado">
        <span className="text-muted">Interlineado</span>
        <input
          type="number"
          min={0.6}
          max={2.2}
          step={0.05}
          disabled={disabled}
          value={cfg?.interlineado ?? 1}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) onPatch({ interlineado: Math.max(0.6, Math.min(2.2, v)) });
          }}
          className="w-14 rounded border border-border bg-surface-input px-1 py-0.5 font-mono text-[10px] text-ink"
        />
      </label>

      <label className="flex items-center gap-1 text-[10px]" title="Interletrado">
        <span className="text-muted">Interletrado</span>
        <input
          type="number"
          min={-1.5}
          max={8}
          step={0.1}
          disabled={disabled}
          value={cfg?.interletrado ?? 0}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) onPatch({ interletrado: Math.max(-1.5, Math.min(8, v)) });
          }}
          className="w-14 rounded border border-border bg-surface-input px-1 py-0.5 font-mono text-[10px] text-ink"
        />
      </label>

      <label className="flex items-center gap-1 text-[10px]" title="Mayúsculas">
        <input
          type="checkbox"
          disabled={disabled}
          checked={Boolean(cfg?.mayusculas)}
          onChange={(e) => onPatch({ mayusculas: e.target.checked })}
        />
        <span className="text-muted">MAYUS</span>
      </label>

      <label className="flex items-center gap-1 text-[10px]" title="Lista con viñetas">
        <input
          type="checkbox"
          disabled={disabled}
          checked={Boolean(cfg?.listado)}
          onChange={(e) => onPatch({ listado: e.target.checked })}
        />
        <span className="text-muted">Listado</span>
      </label>

      <span className="text-[9px] text-muted">Fuente: Montserrat</span>

      {esB1 && b1AnchoPct != null && (
        <label className="flex items-center gap-1 text-[10px]" title="Ancho columna B1">
          <span className="text-muted">Ancho</span>
          <input
            type="range"
            min={50}
            max={100}
            step={1}
            disabled={disabled}
            value={b1AnchoPct}
            onChange={(e) => onPatch({ ancho_pct: clampPct(parseInt(e.target.value, 10)) })}
            className="w-16 accent-accent"
          />
          <span className="font-mono">{b1AnchoPct}%</span>
        </label>
      )}
        </>
      )}

      {(soloPosicion || !compact) && (
        <>
          {onAlinearLienzo && elementoSeleccionado && (
            <>
              <div
                className="flex items-center gap-0.5"
                title="Alinear al lienzo"
              >
                {ALINEACIONES_LIENZO.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    title={a.title}
                    aria-label={a.title}
                    onClick={() => onAlinearLienzo(a.id)}
                    className="flex h-7 w-7 items-center justify-center rounded border border-border text-sm text-ink-secondary transition hover:border-accent/40 hover:bg-surface-hover hover:text-ink"
                  >
                    {a.label}
                  </button>
                ))}
              </div>
              <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />
            </>
          )}
          <label className="flex items-center gap-1 text-[10px]">
            <span className="text-muted">X</span>
            <input
              type="number"
              step={0.1}
              disabled={disabled}
              value={cfg?.x ?? tx}
              onChange={(e) => {
                const x = parseFloat(e.target.value);
                if (Number.isFinite(x)) onPatch({ x });
              }}
              className="w-14 rounded border border-border bg-surface-input px-1 py-0.5 font-mono text-[10px] text-ink"
            />
          </label>
          <label className="flex items-center gap-1 text-[10px]">
            <span className="text-muted">Y</span>
            <input
              type="number"
              step={0.1}
              disabled={disabled}
              value={cfg?.y ?? ty}
              onChange={(e) => {
                const y = parseFloat(e.target.value);
                if (Number.isFinite(y)) onPatch({ y });
              }}
              className="w-14 rounded border border-border bg-surface-input px-1 py-0.5 font-mono text-[10px] text-ink"
            />
          </label>
        </>
      )}

      {!soloPosicion && (
      <span className="ml-auto hidden text-[9px] text-muted lg:inline">
        Arrastra el bloque en la etiqueta para mover
      </span>
      )}
    </div>
  );
}

export function patchCampoToolbar(
  diagramacion: DiagramacionEtiqueta | undefined,
  campoId: string,
  patch: CampoDiagramacion,
): DiagramacionEtiqueta {
  return patchDiagramacion(diagramacion, campoId, patch);
}
