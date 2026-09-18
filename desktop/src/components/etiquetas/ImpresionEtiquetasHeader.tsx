import type { ReactNode } from "react";
import { Icon } from "../../icons";
import { Badge, Button } from "./ui";

type VistaImpresion = "catalogo" | "documento";

interface Props {
  skuActivo?: string;
  vista: VistaImpresion;
  onVistaChange: (v: VistaImpresion) => void;
  solicitudesCount?: number;
  onPedidosClick?: () => void;
  onInstalarClick?: () => void;
  impConectada?: boolean;
  impDeshabilitada?: boolean;
  avisoRollo?: boolean;
  extra?: ReactNode;
}

export function ImpresionEtiquetasHeader({
  skuActivo,
  vista,
  onVistaChange,
  solicitudesCount = 0,
  onPedidosClick,
  onInstalarClick,
  impConectada,
  impDeshabilitada,
  avisoRollo,
  extra,
}: Props) {
  const mostrarEstado = vista === "documento" && impConectada !== undefined;

  return (
    // Sin `mck-header-glass`: esa clase pinta un fondo claro translúcido que gana
    // a `bg-accent` y dejaba el texto y el botón de volver (blancos) invisibles.
    <header className="flex flex-shrink-0 flex-wrap items-center gap-1.5 border-b border-accent/25 bg-accent px-2.5 py-1.5 text-white sm:gap-2 sm:px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {vista === "documento" ? (
          <button
            type="button"
            onClick={() => onVistaChange("catalogo")}
            aria-label="Volver a la biblioteca de archivos"
            title="Volver a la biblioteca de archivos (Esc)"
            className="mck-press flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white bg-white px-3 text-xs font-bold text-accent shadow-sm hover:bg-white/90"
          >
            <span aria-hidden="true" className="text-base leading-none">←</span>
            <span>Volver a la biblioteca</span>
          </button>
        ) : (
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/15">
            <Icon name="printer" size={13} className="text-white" />
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-bold leading-tight">Impresión de etiquetas</p>
          <p className="truncate text-[11px] leading-tight opacity-80">
            {vista === "catalogo"
              ? "Elige la etiqueta que vas a imprimir"
              : `Epson CW-C4000u${skuActivo ? ` · ${skuActivo}` : ""}`}
          </p>
        </div>
      </div>

      {mostrarEstado && (
        <Badge
          tone={impDeshabilitada ? "warning" : impConectada ? (avisoRollo ? "warning" : "success") : "danger"}
          solid
          className="!px-1.5 !py-0 !text-[9px]"
        >
          {impDeshabilitada
            ? "Off"
            : impConectada
              ? avisoRollo
                ? "Rollo"
                : "Lista"
              : "Sin USB"}
        </Badge>
      )}

      {onPedidosClick && (
        <button
          type="button"
          onClick={onPedidosClick}
          className="mck-press relative inline-flex items-center gap-1 rounded border border-white/25 px-1.5 py-0.5 text-[9px] font-medium hover:bg-white/10"
        >
          <Icon name="listChecks" size={12} />
          En curso
          {solicitudesCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full bg-warning px-0.5 text-[8px] font-black text-white">
              {solicitudesCount}
            </span>
          )}
        </button>
      )}

      {onInstalarClick && (
        <Button
          variant="ghost"
          size="sm"
          icon="printer"
          onClick={onInstalarClick}
          className="!h-6 !min-h-0 !border-white/20 !px-1.5 !py-0 !text-[9px] !text-white/80 hover:!bg-white/10"
        >
          Instalar
        </Button>
      )}

      {extra}
    </header>
  );
}
