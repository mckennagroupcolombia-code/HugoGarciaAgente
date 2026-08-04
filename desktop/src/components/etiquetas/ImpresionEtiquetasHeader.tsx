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
    <header className="mck-header-glass flex flex-shrink-0 flex-wrap items-center gap-1.5 border-b border-accent/25 bg-accent px-2.5 py-1.5 text-white sm:gap-2 sm:px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/15">
          <Icon name="printer" size={13} className="text-white" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[12px] font-bold leading-tight">Impresión de etiquetas</p>
          <p className="truncate text-[9px] leading-tight opacity-75">
            {vista === "catalogo"
              ? "Archivos PNG listos para imprimir"
              : `Epson CW-C4000u${skuActivo ? ` · ${skuActivo}` : ""}`}
          </p>
        </div>
      </div>

      {vista === "documento" && (
        <button
          type="button"
          onClick={() => onVistaChange("catalogo")}
          className="mck-press rounded border border-white/25 px-2 py-0.5 text-[9px] font-medium text-white/85 hover:bg-white/10"
        >
          ← Archivos
        </button>
      )}

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
