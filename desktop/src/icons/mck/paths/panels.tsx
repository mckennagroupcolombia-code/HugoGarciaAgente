import type { ReactNode } from "react";
import type { Panel } from "../../../stores/app";

/** Iconos del sidebar — lineales, sin relleno. */
export const MCK_PANEL_PATHS: Record<Panel, ReactNode> = {
  hugo: (
    <>
      <path d="M4 11l8-6 8 6" />
      <path d="M6 10v9h12v-9" />
      <path d="M10 19v-4h4v4" />
    </>
  ),
  dashboard: (
    <>
      <path d="M6 19V11M12 19V5M18 19v-6M4 19h16" />
    </>
  ),
  chat: (
    <>
      <path d="M6 6a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 18 6v7a1.5 1.5 0 0 1-1.5 1.5H10L6 18v-4.5H7.5A1.5 1.5 0 0 1 6 12V6z" />
      <path d="M9 10h6M9 13h4" />
    </>
  ),
  voz: (
    <>
      <rect x="9" y="4" width="6" height="9" rx="3" />
      <path d="M7 12a5 5 0 0 0 10 0" />
      <path d="M12 17v2" />
    </>
  ),
  webchat: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16" />
      <path d="M12 4a12 12 0 0 1 0 16" />
    </>
  ),
  whatsapp: (
    <>
      <path d="M6 6a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 18 6v7a1.5 1.5 0 0 1-1.5 1.5H10L6 18v-4.5H7.5A1.5 1.5 0 0 1 6 12V6z" />
      <path d="M9.5 10.5c.5 1.5 2 3 3.5 3.5" />
    </>
  ),
  supervisor: (
    <>
      <rect x="8" y="4" width="8" height="16" rx="1.5" />
      <circle cx="12" cy="9" r="1.5" />
      <path d="M10 18h4" />
    </>
  ),
  preventa: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M9.5 9.5a2.5 2.5 0 0 1 4 1.5c0 1.5-2 1.5-2 3" />
      <circle cx="12" cy="17" r="0.75" />
    </>
  ),
  postventa: (
    <>
      <path d="M5 7a1.5 1.5 0 0 1 1.5-1.5h11A1.5 1.5 0 0 1 19 7v8a1.5 1.5 0 0 1-1.5 1.5H11l-4 3.5V16H6.5A1.5 1.5 0 0 1 5 14.5V7z" />
      <circle cx="9" cy="11" r="0.75" />
      <circle cx="12" cy="11" r="0.75" />
      <circle cx="15" cy="11" r="0.75" />
    </>
  ),
  sync: (
    <>
      <path d="M20 11a7 7 0 1 0-1.6-4.4M20 4v4h-4" />
      <path d="M4 13a7 7 0 1 0 1.6 4.4M4 20v-4h4" />
    </>
  ),
  stock: (
    <>
      <path d="M12 3l7 4v10l-7 4-7-4V7l7-4z" />
      <path d="M12 11l7-4M12 11v10M12 11L5 7" />
    </>
  ),
  fichas: (
    <>
      <path d="M8 5h7a2 2 0 0 1 2 2v13H10a2 2 0 0 1-2-2V5z" />
      <path d="M8 5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2" />
      <path d="M12 10h4M12 14h4M12 18h2" />
    </>
  ),
  pedidos: (
    <>
      <circle cx="9" cy="19" r="1.5" />
      <circle cx="17" cy="19" r="1.5" />
      <path d="M3 5h2l2 9h10l2-6H7" />
    </>
  ),
  facturas: (
    <>
      <path d="M7 4h10v16l-2-1-2 1-2-1-2 1-2-1V4z" />
      <path d="M10 9h6M10 13h6M10 17h4" />
    </>
  ),
  "costos-productos": (
    <>
      <path d="M4 7h16M4 12h16M4 17h10" />
      <circle cx="17" cy="17" r="2" />
    </>
  ),
  "centros-costo": (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v8M8 12h8" />
      <path d="M12 12L16 8" />
    </>
  ),
  rentabilidad: (
    <>
      <path d="M3 17l3-6 4 4 4-7 4 3" />
      <path d="M3 20h18" />
    </>
  ),
  tickets: (
    <>
      <rect x="7" y="5" width="10" height="14" rx="1.5" />
      <path d="M10 5v2h4V5" />
      <path d="M10 12h6M10 16h4" />
    </>
  ),
  etiquetas: (
    <>
      <path d="M6 9V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4" />
      <rect x="6" y="9" width="12" height="8" rx="1.5" />
      <path d="M6 13H4a2 2 0 0 0-2 2v3h16v-3a2 2 0 0 0-2-2h-2" />
      <path d="M6 17v2h12v-2" />
    </>
  ),
  "etiquetas-config": (
    <>
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4" />
      <rect x="7" y="14" width="10" height="5" rx="1" />
    </>
  ),
  "plantillas-visuales": (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 8h8M8 12h5M8 16h6" />
      <circle cx="17" cy="7" r="2" />
    </>
  ),
  publicaciones: (
    <>
      <path d="M5 10v4a2 2 0 0 0 2 2h1l5 4V6L8 10H7a2 2 0 0 0-2 2z" />
      <path d="M16 9a3 3 0 0 1 0 6" />
    </>
  ),
  "logistica-importaciones": (
    <>
      <path d="M4 16l2-5h12l2 5" />
      <path d="M3 18h18" />
      <path d="M12 4v7" />
      <path d="M9 7l3-3 3 3" />
    </>
  ),
  "logistica-embarques": (
    <>
      <path d="M3 12h5l2-4 2 8 2-8 2 4h5" />
      <path d="M12 8v8" />
    </>
  ),
  "logistica-aduanas": (
    <>
      <path d="M7 4h10v16l-2-1-2 1-2-1-2 1-2-1V4z" />
      <path d="M10 9h6M10 13h6M10 17h4" />
      <path d="M12 4v3" />
    </>
  ),
  "logistica-proveedores": (
    <>
      <path d="M5 18v-4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4" />
      <circle cx="12" cy="7" r="3" />
      <path d="M8 11h8" />
    </>
  ),
  "logistica-seguimiento": (
    <>
      <circle cx="6" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path d="M8 12h2M14 12h2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4" />
    </>
  ),
  perfil: (
    <>
      <circle cx="12" cy="8" r="3" />
      <path d="M6 20c1.2-3 3.5-5 6-5s4.8 2 6 5" />
    </>
  ),
};
