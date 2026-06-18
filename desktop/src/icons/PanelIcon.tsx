import type { Panel } from "../stores/app";
import { IllustrationIcon, type IllustrationTone } from "./IllustrationIcon";

const PANEL_TONE: Partial<Record<Panel, IllustrationTone>> = {
  hugo: "accent",
  dashboard: "sky",
  chat: "plum",
  whatsapp: "leaf",
  preventa: "sun",
  postventa: "rose",
  pedidos: "sky",
  stock: "sky",
  etiquetas: "plum",
  fichas: "neutral",
  publicaciones: "rose",
  sync: "leaf",
  facturas: "sun",
  "centros-costo": "sun",
  rentabilidad: "leaf",
  tickets: "accent",
  "etiquetas-config": "neutral",
  "plantillas-visuales": "plum",
  settings: "neutral",
  perfil: "accent",
};

export interface PanelIconProps {
  panel: Panel;
  size?: number;
  active?: boolean;
  bubble?: boolean;
  className?: string;
}

/** Icono de panel del sidebar con estilo UI illustration. */
export function PanelIcon({ panel, size = 28, active = false, bubble = true, className }: PanelIconProps) {
  const tone = PANEL_TONE[panel] ?? "accent";
  return (
    <IllustrationIcon
      name={panel}
      size={size}
      bubble={bubble}
      tone={active ? "neutral" : tone}
      className={[
        active ? "mck-illus-icon--on-accent text-white" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
