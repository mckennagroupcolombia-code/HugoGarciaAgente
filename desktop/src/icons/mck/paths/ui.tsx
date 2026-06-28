import type { ReactNode } from "react";

/**
 * Set McKenna — iconos lineales minimalistas.
 * Solo trazo (sin relleno), viewBox 24×24, esquinas redondeadas vía strokeLinecap/join del frame.
 */
export const MCK_UI_PATHS: Record<string, ReactNode> = {
  signOut: (
    <>
      <path d="M9 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3" />
      <path d="M12 12h8" />
      <path d="M17 9l3 3-3 3" />
    </>
  ),
  menu: (
    <>
      <path d="M5 7h14M5 12h14M5 17h14" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a7 7 0 1 0-1.6-4.4" />
      <path d="M20 4v4h-4" />
    </>
  ),
  close: <path d="M7 7l10 10M17 7 7 17" />,
  expand: (
    <>
      <path d="M8 4H4v4M16 4h4v4M20 16v4h-4M4 16v4h4" />
    </>
  ),
  collapse: (
    <>
      <path d="M9 4h6M4 9v6M20 9v6M9 20h6" />
      <path d="M9 9 5 5M15 9l4-4M9 15l-4 4M15 15l4 4" />
    </>
  ),
  gridReset: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  drag: (
    <>
      <circle cx="9" cy="7" r="1" />
      <circle cx="15" cy="7" r="1" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="9" cy="17" r="1" />
      <circle cx="15" cy="17" r="1" />
    </>
  ),
  resize: (
    <>
      <path d="M16 16l5 5M14 20h6v-6M8 8 3 3M10 4H4v6" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.2A7.5 7.5 0 1 1 9.8 4 6 6 0 0 0 20 14.2z" />,
  pencil: (
    <>
      <path d="M4 20h4L18 10l-4-4L4 16v4z" />
      <path d="M14 6l4 4" />
    </>
  ),
  caretDown: <path d="M7 10l5 5 5-5" />,
  castle: (
    <>
      <path d="M5 20V10l3-2 3 2v2l3-2 3 2v10" />
      <path d="M9 14v3M15 14v3" />
    </>
  ),
  mapPin: (
    <>
      <path d="M12 21s5-4.5 5-9a5 5 0 1 0-10 0c0 4.5 5 9 5 9z" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),
  building: (
    <>
      <rect x="6" y="4" width="12" height="16" rx="1.5" />
      <path d="M10 8h2M14 8h2M10 12h2M14 12h2M10 16h2M14 16h2" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  book: (
    <>
      <path d="M6 5h8a2 2 0 0 1 2 2v12H8a2 2 0 0 1-2-2V5z" />
      <path d="M6 19h10" />
    </>
  ),
  file: (
    <>
      <path d="M8 4h7l3 3v13H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      <path d="M15 4v4h4M10 13h6M10 17h4" />
    </>
  ),
  home: (
    <>
      <path d="M4 11l8-6 8 6" />
      <path d="M6 10v9h12v-9" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="4" width="6" height="10" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0" />
      <path d="M12 17v3" />
    </>
  ),
  cart: (
    <>
      <circle cx="9" cy="19" r="1.5" />
      <circle cx="17" cy="19" r="1.5" />
      <path d="M3 5h2l2 9h10l2-6H7" />
    </>
  ),
  warning: (
    <>
      <path d="M12 4L3 20h18L12 4z" />
      <path d="M12 10v4M12 17v1" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.5 2.5 5-5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  sword: (
    <>
      <path d="M4 20l7-7M11 13l7-7M15 5l4 4" />
    </>
  ),
  bell: (
    <>
      <path d="M12 4a4 4 0 0 0-4 4v4l-2 3h12l-2-3V8a4 4 0 0 0-4-4z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  xCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  trash: (
    <>
      <path d="M4 7h16M9 7V5h6v2M8 7l1 11h6l1-11M10 11v5M14 11v5" />
    </>
  ),
  funnel: <path d="M5 6h14l-5 7v5l-4-2v-3L5 6z" />,
  link: (
    <>
      <path d="M9 14a3 3 0 0 1 0-4.2l1.5-1.5a3 3 0 0 1 4.2 4.2l-1 1" />
      <path d="M15 10a3 3 0 0 1 0 4.2l-1.5 1.5a3 3 0 0 1-4.2-4.2l1-1" />
    </>
  ),
  lightning: <path d="M13 3L7 14h5l-1 7 7-11h-5l1-7z" />,
  pin: (
    <>
      <path d="M12 21s-4.5-4-4.5-8a4.5 4.5 0 1 1 9 0c0 4-4.5 8-4.5 8z" />
      <circle cx="12" cy="13" r="1.5" />
    </>
  ),
  infinity: <path d="M7 12c0-2.2 1.8-4 4-4s4 1.8 4 4-1.8 4-4 4m2 0c0-2.2 1.8-4 4-4s4 1.8 4 4-1.8 4-4 4" />,
  lock: (
    <>
      <rect x="7" y="11" width="10" height="8" rx="1.5" />
      <path d="M9 11V9a3 3 0 0 1 6 0v2" />
    </>
  ),
  unlock: (
    <>
      <rect x="7" y="11" width="10" height="8" rx="1.5" />
      <path d="M9 11V9a3 3 0 0 1 6 0" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3" />
      <path d="M6 20c1.2-3 3.5-5 6-5s4.8 2 6 5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="9" r="2.5" />
      <path d="M4 20c1-2.5 2.8-4 5-4" />
      <circle cx="16" cy="10" r="2" />
      <path d="M14 20c.7-1.8 2.2-3 4-3" />
    </>
  ),
  tag: (
    <>
      <path d="M5 12V6h6l8 8-6 6-8-8z" />
      <circle cx="9" cy="9" r="1" />
    </>
  ),
  listChecks: (
    <>
      <path d="M9 7h11M9 12h11M9 17h11" />
      <path d="M5 7l1.5 1.5L8 6M5 12l1.5 1.5L8 11M5 17l1.5 1.5L8 16" />
    </>
  ),
  wrench: (
    <path d="M14 6a3.5 3.5 0 0 0-4.5 4.5L4 16l4 4 5.5-5.5A3.5 3.5 0 0 0 18 10l-2 2-2-2 2-2z" />
  ),
  nut: (
    <>
      <path d="M12 4l5.2 3v6L12 16l-5.2-3V7L12 4z" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),
  books: (
    <>
      <path d="M6 5h6a2 2 0 0 1 2 2v12H8a2 2 0 0 1-2-2V5z" />
      <path d="M12 7h6a2 2 0 0 1 2 2v10h-8" />
    </>
  ),
  flask: (
    <>
      <path d="M10 4h4M11 4v5L7 17a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l-4-8V4" />
      <path d="M9 14h6" />
    </>
  ),
  handshake: (
    <>
      <path d="M5 12l3-2 3 2-4 4-3-3-3 3" />
      <path d="M19 12l-3-2-3 2 4 4 3-3 3 3" />
    </>
  ),
  scroll: (
    <>
      <path d="M8 5h8a2 2 0 0 1 2 2v11H10a2 2 0 0 1-2-2V5z" />
      <path d="M8 5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2" />
      <path d="M11 10h5M11 14h3" />
    </>
  ),
  floppyDisk: (
    <>
      <path d="M7 4h10l3 3v13H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      <rect x="9" y="4" width="6" height="5" rx="1" />
      <rect x="9" y="14" width="6" height="5" rx="1" />
    </>
  ),
  hourglass: (
    <>
      <path d="M8 4h8M8 20h8M9 4v3a3 3 0 0 0 3 3 3 3 0 0 0-3 3v3M15 4v3a3 3 0 0 1-3 3 3 3 0 0 1 3 3v3" />
    </>
  ),
  truck: (
    <>
      <path d="M3 9h10v8H3zM13 11h4l2 2v4h-6v-6z" />
      <circle cx="7" cy="18" r="1.5" />
      <circle cx="17" cy="18" r="1.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="5" y="6" width="14" height="14" rx="1.5" />
      <path d="M8 4v3M16 4v3M5 10h14" />
    </>
  ),
  calendarBlank: (
    <>
      <rect x="5" y="6" width="14" height="14" rx="1.5" />
      <path d="M8 4v3M16 4v3" />
    </>
  ),
  calendarDots: (
    <>
      <rect x="5" y="6" width="14" height="14" rx="1.5" />
      <path d="M8 4v3M16 4v3M5 10h14" />
      <circle cx="9" cy="14" r="0.75" />
      <circle cx="12" cy="14" r="0.75" />
      <circle cx="15" cy="14" r="0.75" />
    </>
  ),
  chartBar: (
    <>
      <path d="M6 19V11M12 19V5M18 19v-6M4 19h16" />
    </>
  ),
  robot: (
    <>
      <rect x="7" y="9" width="10" height="8" rx="1.5" />
      <circle cx="10" cy="13" r="0.75" />
      <circle cx="14" cy="13" r="0.75" />
      <path d="M12 5v4M9 5h6M9 17v2M15 17v2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="5.5" />
      <path d="M16 16l4 4" />
    </>
  ),
  envelope: (
    <>
      <rect x="4" y="7" width="16" height="11" rx="1.5" />
      <path d="M4 8l8 5 8-5" />
    </>
  ),
  circle: <circle cx="12" cy="12" r="7" />,
  arrowSub: (
    <>
      <path d="M6 6v5h5" />
      <path d="M6 11l9-9" />
    </>
  ),
  package: (
    <>
      <path d="M12 3l7 4v10l-7 4-7-4V7l7-4z" />
      <path d="M12 11l7-4M12 11v10M12 11L5 7" />
    </>
  ),
  receipt: (
    <>
      <path d="M7 4h10v16l-2-1-2 1-2-1-2 1-2-1V4z" />
      <path d="M10 9h6M10 13h6M10 17h4" />
    </>
  ),
  ear: (
    <>
      <path d="M7 11a5 5 0 1 1 10 0c0 2-1.5 3-2.5 3h-1" />
      <path d="M10 17a2.5 2.5 0 0 0 4 0" />
    </>
  ),
  question: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 0 1 4 1.5c0 1.5-2 1.5-2 3" />
      <circle cx="12" cy="17" r="0.75" />
    </>
  ),
  star: (
    <path d="M12 4l2.1 4.3 4.7.7-3.4 3.3.8 4.6L12 14.8 7.8 17l.8-4.6L5.2 9l4.7-.7L12 4z" />
  ),
  calculator: (
    <>
      <rect x="6" y="4" width="12" height="16" rx="1.5" />
      <rect x="8" y="6" width="8" height="3" rx="0.75" />
      <circle cx="9" cy="13" r="0.75" />
      <circle cx="12" cy="13" r="0.75" />
      <circle cx="15" cy="13" r="0.75" />
      <circle cx="9" cy="17" r="0.75" />
      <circle cx="12" cy="17" r="0.75" />
      <circle cx="15" cy="17" r="0.75" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 8h16v10H4z" />
      <path d="M4 8l4 4h8l4-4" />
      <path d="M12 12v6" />
    </>
  ),
  outbox: (
    <>
      <path d="M4 10h16v8H4z" />
      <path d="M8 10V6h8v4" />
      <path d="M12 6V3" />
    </>
  ),
  paperclip: (
    <path d="M8 12a4 4 0 0 0 8 0V6a4 4 0 0 0-8 0v8a6 6 0 0 0 12 0V7" />
  ),
  chat: (
    <>
      <path d="M5 6h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 4V8a2 2 0 0 1 2-2z" />
      <path d="M9 11h6M9 14h4" />
    </>
  ),
  stop: (
    <>
      <circle cx="12" cy="12" r="9" />
      <rect x="9" y="9" width="6" height="6" rx="0.75" />
    </>
  ),
  note: (
    <>
      <path d="M8 4h8l3 3v13H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      <path d="M13 4v4h4M10 13h6M10 17h4" />
    </>
  ),
  camera: (
    <>
      <path d="M5 8h3l1.5-2h5L16 8h3v10H5z" />
      <circle cx="12" cy="13" r="3" />
    </>
  ),
  folder: (
    <>
      <path d="M4 8h6l2 2h8v9H4z" />
      <path d="M4 8V6a2 2 0 0 1 2-2h5l2 2" />
    </>
  ),
  image: (
    <>
      <rect x="4" y="6" width="16" height="14" rx="1.5" />
      <circle cx="9" cy="11" r="1.5" />
      <path d="M4 16l5-4 4 3 3-2 4 3" />
    </>
  ),
  brick: (
    <>
      <rect x="5" y="7" width="14" height="10" rx="1" />
      <path d="M5 12h14M12 7v10" />
    </>
  ),
  recycle: (
    <>
      <path d="M8 6l-2 4h4l-1 6 5-3" />
      <path d="M16 6l2 4h-4l1 6-5-3" />
      <path d="M12 4v4" />
    </>
  ),
  sunrise: (
    <>
      <path d="M4 17h16M12 5v4M6.3 8.7l2.8 2.8M17.7 8.7l-2.8 2.8" />
      <path d="M7 17a5 5 0 0 1 10 0" />
    </>
  ),
  phone: (
    <>
      <rect x="8" y="4" width="8" height="16" rx="2" />
      <path d="M11 18h2" />
    </>
  ),
  play: (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M10 8.5l6 3.5-6 3.5z" />
  </>
  ),
  pause: (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M10 8v8M14 8v8" />
  </>
  ),
  rocket: (
    <>
      <path d="M12 3c3 4 4 8 4 12a4 4 0 0 1-8 0c0-4 1-8 4-12z" />
      <path d="M10 17l-2 4 4-1M14 17l2 4-4-1" />
      <circle cx="12" cy="11" r="1.5" />
    </>
  ),
  eye: (
    <>
      <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  ticket: (
    <>
      <path d="M5 8a2 2 0 0 1 0-4h14a2 2 0 0 1 0 4 2 2 0 0 0 0 4 2 2 0 0 1 0 4H5a2 2 0 0 1 0-4 2 2 0 0 0 0-4z" />
      <path d="M12 6v12" />
    </>
  ),
  wave: (
    <>
      <path d="M4 12c1.5-2 3-3 4-3s2.5 1 4 3 2.5 3 4 3 2.5-1 4-3" />
      <path d="M7 17c.5-1 1.2-1.5 2-1.5s1.5.5 2 1.5" />
    </>
  ),
  palette: (
    <>
      <path d="M12 21a8.5 8.5 0 1 0 0-17 1.5 1.5 0 0 1 1.5 1.5c0 1-.5 1.5-1 2s-.5 1.2 0 2.2A2.8 2.8 0 0 0 12 21z" />
      <circle cx="8.5" cy="10.5" r="1" />
      <circle cx="11.5" cy="7.5" r="1" />
      <circle cx="15" cy="9.5" r="1" />
      <circle cx="16" cy="13.5" r="1" />
    </>
  ),
  monitor: (
    <>
      <rect x="4" y="5" width="16" height="11" rx="1.5" />
      <path d="M9 19h6M12 16v3" />
    </>
  ),
  megaphone: (
    <>
      <path d="M5 10v4a2 2 0 0 0 2 2h1l5 4V6L8 10H7a2 2 0 0 0-2 2z" />
      <path d="M16 9a3 3 0 0 1 0 6" />
    </>
  ),
  ship: (
    <>
      <path d="M4 16l2-5h12l2 5" />
      <path d="M3 18h18" />
      <path d="M12 4v7" />
      <path d="M9 7l3-3 3 3" />
    </>
  ),
  plane: (
    <>
      <path d="M3 12h5l2-4 2 8 2-8 2 4h5" />
      <path d="M12 8v8" />
    </>
  ),
};
