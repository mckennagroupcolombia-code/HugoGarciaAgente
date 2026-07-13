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
    <header className="mck-header-glass flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-accent/25 bg-accent px-4 py-3 text-white">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-paper bg-white/15">
          <Icon name="printer" size={18} className="text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold">Impresión de etiquetas</p>
          <p className="truncate text-[10px] opacity-80">
            {vista === "catalogo"
              ? "Archivos PNG listos para imprimir"
              : `Epson ColorWorks CW-C4000u${skuActivo ? ` · ${skuActivo}` : ""}`}
          </p>
        </div>
      </div>

      {vista === "documento" && (
        <button
          type="button"
          onClick={() => onVistaChange("catalogo")}
          className="mck-press rounded-lg border border-white/30 px-3 py-1.5 text-[10px] font-semibold text-white/90 hover:bg-white/15"
        >
          ← Volver a archivos
        </button>
      )}

      {mostrarEstado && (
        <Badge
          tone={impDeshabilitada ? "warning" : impConectada ? (avisoRollo ? "warning" : "success") : "danger"}
          solid
        >
          {impDeshabilitada
            ? "Desconectada"
            : impConectada
              ? avisoRollo
                ? "Revisa rollo"
                : "Lista"
              : "Sin impresora"}
        </Badge>
      )}

      {onPedidosClick && (
        <button
          type="button"
          onClick={onPedidosClick}
          className="mck-press relative inline-flex items-center gap-1.5 rounded-lg border border-white/30 px-2.5 py-1.5 text-[10px] font-semibold hover:bg-white/15"
        >
          <Icon name="listChecks" size={14} />
          En curso
          {solicitudesCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-warning px-1 text-[9px] font-black text-white">
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
          className="!border-white/30 !text-white hover:!bg-white/15"
        >
          Instalar Windows 10 Pro
        </Button>
      )}

      {extra}
    </header>
  );
}
