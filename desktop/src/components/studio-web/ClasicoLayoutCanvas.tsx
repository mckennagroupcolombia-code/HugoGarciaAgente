import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  applyContentPath,
  COLORES_CLASICO_DEFAULT,
  contentPathForNode,
  esCajaHugStudio,
  esNodoChromeSitio,
  esNodoFotoStudio,
  mergeFotoNodo,
  estiloCajaHug,
  estiloFitTexto,
  estiloNodo,
  HEADER_NAV_ITEMS,
  urlIsotipoStudio,
  heroSplitPct,
  HERO_SPLIT_MAX,
  HERO_SPLIT_MIN,
  mergeNodo,
  nodoOf,
  pathEsTextoEditable,
  type WebLayout,
} from "../../lib/webLayoutStudio";
import type { StudioSelectOpts } from "../../lib/studioSelectSimilar";
import { LINEAS_CATALOGO } from "../../lib/lineasCatalogo";
import {
  captureAlignContext,
  guidesForMove,
  guidesForResize,
  type AlignContext,
  type AlignGuide,
  type ResizeGuideMode,
} from "../../lib/studioAlignmentGuides";
import { FolioHoja, MarcoCapitulo, useScrollHojaActiva } from "./HojasCapitulo";
import { AlignmentGuidesOverlay } from "./AlignmentGuidesOverlay";
import { StudioDeleteContext } from "./StudioDeleteContext";
import { StudioSelectableFrame } from "./StudioSelectionChrome";
import {
  estiloFondoImagen,
  resolveFondoSrc,
  StudioAssetBaseCtx,
  subirFondoStudio,
  ZonaFondoDrop,
} from "./FondoImagenField";

export interface ClasicoCanvas {
  colores?: Record<string, string>;
  fondos?: Record<string, string>;
  anuncio: string;
  hero: {
    badge: string;
    titulo_l1: string;
    titulo_em: string;
    titulo_l2: string;
    subtitulo: string;
    cta_principal: string;
    cta_secundario: string;
    kit_label: string;
    kit: { titulo: string; texto: string; valor: string; icono?: string }[];
  };
  features: { titulo: string; texto: string; icono?: string }[];
  categorias: {
    eyebrow: string;
    titulo: string;
    titulo_em: string;
    texto: string;
  };
  destacados: {
    eyebrow: string;
    titulo: string;
    titulo_em: string;
    texto: string;
  };
  cta: {
    eyebrow: string;
    titulo: string;
    titulo_em: string;
    texto: string;
    boton_wa: string;
    boton_contacto: string;
  };
  secciones: Record<string, boolean>;
}

type DragMode = "move" | "scale" | "resize-e" | "resize-s" | "resize-se" | "hero-split";

interface DragOrig {
  dx: number;
  dy: number;
  scale: number;
  w: number;
  h: number;
}

interface DragState {
  id: string;
  ids: string[];
  mode: DragMode;
  startX: number;
  startY: number;
  orig: Record<string, DragOrig>;
  armed?: boolean;
  align?: AlignContext | null;
  splitEl?: HTMLElement | null;
}

function paletaClasico(raw?: Record<string, string>) {
  const c = raw || {};
  return {
    acento: c.acento || COLORES_CLASICO_DEFAULT.acento,
    acentoOscuro: c.acento_oscuro || COLORES_CLASICO_DEFAULT.acento_oscuro,
    acentoClaro: c.acento_claro || COLORES_CLASICO_DEFAULT.acento_claro,
    fondo: c.fondo || COLORES_CLASICO_DEFAULT.fondo,
    fondoOscuro: c.fondo_oscuro || COLORES_CLASICO_DEFAULT.fondo_oscuro,
    tinta: c.tinta || COLORES_CLASICO_DEFAULT.tinta,
  };
}

function IsotipoStudio({ height }: { height: number }) {
  const assetBase = useContext(StudioAssetBaseCtx);
  const [src, setSrc] = useState(urlIsotipoStudio);
  const [step, setStep] = useState(0);
  return (
    <img
      src={src}
      alt="McKenna Group"
      className="w-auto shrink-0 object-contain"
      style={{ height: `var(--studio-logo-h, ${height}px)` }}
      onError={() => {
        if (step === 0 && assetBase) {
          setStep(1);
          setSrc(`${String(assetBase).replace(/\/$/, "")}/static/img/isotipo.png`);
          return;
        }
        if (step < 2) {
          setStep(2);
          setSrc("https://mckennagroup.co/static/img/isotipo.png");
        }
      }}
    />
  );
}

export const SECTION_LABEL_CLASICO: Record<string, string> = {
  hero: "Página principal",
  features: "Features",
  categorias: "Categorías",
  destacados: "Destacados",
  cta: "CTA final",
  anuncio: "Barra de anuncio",
  header: "Header (barra superior)",
  "header.logo": "Logo y nombre",
  "header.nav": "Menú (grupo)",
  "header.nav.inicio": "Botón Inicio",
  "header.nav.catalogo": "Botón Catálogo",
  "header.nav.guias": "Botón Guías",
  "header.nav.recetario": "Botón Recetario",
  "header.nav.blog": "Botón Blog",
  "header.nav.nosotros": "Botón Nosotros",
  "header.nav.contacto": "Botón Contacto",
  "header.nav.cuenta": "Botón Iniciar sesión",
  "header.search": "Buscador",
  "header.btn_wa": "Botón WhatsApp",
  "hero.foto_izq": "Imagen izquierda",
  "hero.foto_der": "Imagen derecha",
  "hero.cta_principal": "Botón Comprar (caja)",
  "hero.cta_principal.icono": "Icono Comprar",
  "hero.cta_principal.texto": "Texto Comprar ahora",
  "hero.cta_secundario": "Botón Cotización (caja)",
  "hero.cta_secundario.icono": "Icono Cotización",
  "hero.cta_secundario.texto": "Texto Pedir cotización",
  "cta.boton_wa": "Botón WhatsApp final (caja)",
  "cta.boton_wa.icono": "Icono WhatsApp final",
  "cta.boton_wa.texto": "Texto Cotizar WhatsApp",
  "cta.boton_contacto": "Botón Contacto (caja)",
  "cta.boton_contacto.texto": "Texto Formulario contacto",
};

function IconPh({ name, className }: { name: string; className?: string }) {
  return <i className={`ph ph-${name} ${className || ""}`} aria-hidden />;
}

function EditableNode({
  id,
  selected,
  primary,
  layout,
  onSelect,
  onDragStart,
  style,
  className,
  children,
  as: Tag = "div",
  fitText = false,
}: {
  id: string;
  selected: boolean;
  primary?: boolean;
  layout: WebLayout;
  onSelect: (id: string, opts?: StudioSelectOpts) => void;
  onDragStart: (id: string, mode: DragMode, e: ReactPointerEvent, el?: HTMLElement) => void;
  style?: CSSProperties;
  className?: string;
  children: ReactNode;
  as?: "div" | "span" | "h1" | "h2" | "h3" | "p" | "button";
  /** Ajusta la caja al texto (títulos/párrafos). No usar en tarjetas ni iconos. */
  fitText?: boolean;
}) {
  const n = nodoOf(layout, id);
  if (n.hidden) return null;
  const hugBox = esCajaHugStudio(id);
  const chrome = esNodoChromeSitio(id);
  const assetBase = useContext(StudioAssetBaseCtx);
  const merged: CSSProperties = {
    ...style,
    ...estiloFitTexto(n, { className, enabled: fitText, tag: Tag, chrome }),
    ...(hugBox && !chrome ? estiloCajaHug(n) : {}),
  };
  if (n.backgroundImage && !esNodoFotoStudio(id)) {
    merged.backgroundImage = `url("${resolveFondoSrc(n.backgroundImage, assetBase)}")`;
    merged.backgroundSize = "cover";
    merged.backgroundPosition = "center";
  }
  const showHandles = selected && (primary ?? selected) && !chrome;
  const frame = {
    "data-node": id,
    className: `select-none ${selected ? "z-10" : ""} ${className || ""}`,
    style: merged,
    selected,
    primary: showHandles,
    hugText: fitText,
    onHandle: (mode: DragMode, e: ReactPointerEvent) =>
      onDragStart(id, mode, e, e.currentTarget as HTMLElement),
    onPointerDown: (e: ReactPointerEvent) => {
      if ((e.target as HTMLElement).closest("[data-studio-handle]")) return;
      e.stopPropagation();
      const additive = e.ctrlKey || e.metaKey || e.shiftKey;
      onSelect(id, { additive });
      if (additive || chrome) return;
      onDragStart(id, "move", e, e.currentTarget as HTMLElement);
    },
    children,
  };
  if (Tag === "button") {
    return <StudioSelectableFrame as="button" type="button" {...frame} />;
  }
  return <StudioSelectableFrame as={Tag} {...frame} />;
}

export { WebLayoutInspector } from "./WebLayoutCanvas";

export default function ClasicoLayoutCanvas({
  clasico,
  layout,
  selectedIds,
  onSelect,
  onLayoutChange,
  onClasicoPatch,
  zoom,
  assetBase = "https://mckennagroup.co",
  tagline = "Proveemos a tus ideas",
  onEliminar,
}: {
  clasico: ClasicoCanvas;
  layout: WebLayout;
  selectedIds: string[];
  onSelect: (id: string | null, opts?: StudioSelectOpts) => void;
  onLayoutChange: (next: WebLayout) => void;
  onClasicoPatch: (mutator: (draft: ClasicoCanvas) => void) => void;
  zoom: number;
  assetBase?: string;
  tagline?: string;
  onEliminar?: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const heroSplitRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef(layout);
  const onLayoutChangeRef = useRef(onLayoutChange);
  const selectedIdsRef = useRef(selectedIds);
  layoutRef.current = layout;
  onLayoutChangeRef.current = onLayoutChange;
  selectedIdsRef.current = selectedIds;
  const selectedId = selectedIds[selectedIds.length - 1] ?? null;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [alignGuides, setAlignGuides] = useState<{
    hojaId: string;
    lines: AlignGuide[];
    frame: { width: number; height: number };
  } | null>(null);
  const pal = paletaClasico(clasico.colores);
  const fondos = clasico.fondos || {};
  const kitDots = [pal.fondoOscuro, pal.acentoOscuro, pal.acento, pal.acentoClaro];

  const ponerFoto = (id: string, url: string) => {
    onLayoutChangeRef.current(mergeFotoNodo(layoutRef.current, id, url));
    onSelect(id);
  };

  const fotoBloque = (id: string, fallbackUrl?: string) => {
    const n = nodoOf(layout, id);
    if (n.hidden) return null;
    const raw = n.backgroundImage || fallbackUrl || "";
    const src = raw ? resolveFondoSrc(raw, assetBase) : "";
    const onPick = (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f) return;
      void subirFondoStudio(f)
        .then((url) => ponerFoto(id, url))
        .catch((err) =>
          window.alert(err instanceof Error ? err.message : "No se pudo subir"),
        );
    };
    if (!src) {
      return (
        <label
          data-node={id}
          data-studio-handle="fondo-img"
          className="absolute bottom-3 left-3 z-30 cursor-pointer rounded-md border border-white/50 bg-black/45 px-2.5 py-1.5 text-[10px] font-extrabold uppercase tracking-wide text-white shadow hover:bg-black/60"
          onPointerDown={(e) => e.stopPropagation()}
        >
          📷 Adjuntar imagen
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={onPick} />
        </label>
      );
    }
    return (
      <EditableNode
        id={id}
        selected={selectedIds.includes(id)}
        primary={selectedId === id}
        layout={layout}
        onSelect={onSelect}
        onDragStart={beginDrag}
        className="relative z-[2] mt-6 shrink-0 cursor-grab overflow-hidden active:cursor-grabbing"
        style={{
          width: n.width || undefined,
          maxWidth: "100%",
          height: n.height || undefined,
        }}
      >
        <img src={src} alt="" className="pointer-events-none max-h-[220px] w-auto max-w-full object-contain" />
      </EditableNode>
    );
  };

  const beginDrag = useCallback(
    (id: string, mode: DragMode, e: ReactPointerEvent, el?: HTMLElement) => {
      if (editingId) return;
      if (mode !== "move") e.preventDefault();
      e.stopPropagation();
      const curSel = selectedIdsRef.current;
      const ids = curSel.includes(id) && curSel.length > 1 ? [...curSel] : [id];
      const inv = 1 / zoom;
      const orig: Record<string, DragOrig> = {};
      for (const nid of ids) {
        const n = nodoOf(layoutRef.current, nid);
        const nodeEl =
          (stageRef.current?.querySelector(`[data-node="${CSS.escape(nid)}"]`) as HTMLElement | null) ||
          null;
        const rect = nodeEl?.getBoundingClientRect();
        const measuredW = rect ? (rect.width * inv) / (n.scale ?? 1) : 120;
        const measuredH = rect ? (rect.height * inv) / (n.scale ?? 1) : 40;
        orig[nid] = {
          dx: n.dx ?? 0,
          dy: n.dy ?? 0,
          scale: n.scale ?? 1,
          w: n.width ?? Math.round(measuredW),
          h: n.height ?? Math.round(measuredH),
        };
      }
      dragRef.current = {
        id,
        ids,
        mode,
        startX: e.clientX,
        startY: e.clientY,
        orig,
        armed: mode === "move",
        align:
          mode === "move" || mode === "resize-e" || mode === "resize-s" || mode === "resize-se"
            ? captureAlignContext(stageRef.current, ids, zoom)
            : null,
        splitEl: mode === "hero-split" ? heroSplitRef.current : null,
      };
      if (mode !== "move") setDragging(true);
      try {
        (el || (e.currentTarget as HTMLElement)).setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [editingId, zoom],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      e.preventDefault();
      const inv = 1 / zoom;
      const dx = (e.clientX - d.startX) * inv;
      const dy = (e.clientY - d.startY) * inv;
      if (d.armed) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 5) return;
        d.armed = false;
        setDragging(true);
      }
      let next = layoutRef.current;
      let snapX = 0;
      let snapY = 0;
      const resizing =
        d.mode === "resize-e" || d.mode === "resize-s" || d.mode === "resize-se";
      if (d.mode === "move" && d.align) {
        const snapped = guidesForMove(d.align, dx, dy, {
          disabled: e.altKey,
          zoom,
        });
        snapX = snapped.adjX;
        snapY = snapped.adjY;
        setAlignGuides(
          snapped.guides.length
            ? { hojaId: d.align.hojaId, lines: snapped.guides, frame: d.align.frame }
            : null,
        );
      } else if (resizing && d.align) {
        const o0 = d.orig[d.id] || d.orig[d.ids[0]];
        const snapped = guidesForResize(d.align, d.mode as ResizeGuideMode, dx, dy, { w: o0?.w ?? 120, h: o0?.h ?? 40 }, {
          disabled: e.altKey,
          zoom,
        });
        snapX = snapped.adjX;
        snapY = snapped.adjY;
        setAlignGuides(
          snapped.guides.length
            ? { hojaId: d.align.hojaId, lines: snapped.guides, frame: d.align.frame }
            : null,
        );
      } else {
        setAlignGuides(null);
      }
      if (d.mode === "hero-split") {
        const box = d.splitEl?.getBoundingClientRect();
        if (box && box.width > 8) {
          const pct = Math.min(
            HERO_SPLIT_MAX,
            Math.max(
              HERO_SPLIT_MIN,
              Math.round(((e.clientX - box.left) / box.width) * 100),
            ),
          );
          onLayoutChangeRef.current(mergeNodo(layoutRef.current, "hero", { splitPct: pct }));
        }
        return;
      }
      for (const nid of d.ids) {
        const o = d.orig[nid];
        if (!o) continue;
        if (d.mode === "move") {
          next = mergeNodo(next, nid, {
            dx: Math.round(o.dx + dx + snapX),
            dy: Math.round(o.dy + dy + snapY),
          });
        } else if (d.mode === "scale") {
          const delta = (dx + dy) / 120;
          next = mergeNodo(next, nid, {
            scale: Math.min(2.5, Math.max(0.5, o.scale + delta)),
          });
        } else if (d.mode === "resize-e") {
          next = mergeNodo(next, nid, { width: Math.round(Math.max(24, o.w + dx + snapX)) });
        } else if (d.mode === "resize-s") {
          next = mergeNodo(next, nid, { height: Math.round(Math.max(16, o.h + dy + snapY)) });
        } else if (d.mode === "resize-se") {
          next = mergeNodo(next, nid, {
            width: Math.round(Math.max(24, o.w + dx + snapX)),
            height: Math.round(Math.max(16, o.h + dy + snapY)),
          });
        }
      }
      onLayoutChangeRef.current(next);
    };
    const onUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        setDragging(false);
        setAlignGuides(null);
      }
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [zoom]);

  const commitText = (id: string, text: string) => {
    const path = contentPathForNode(id);
    if (!path) return;
    onClasicoPatch((draft) => {
      applyContentPath(draft as unknown as Record<string, unknown>, path, text);
    });
  };

  const textBlock = (
    id: string,
    value: string,
    className: string,
    tag: "div" | "span" | "h1" | "h2" | "h3" | "p" | "button" = "div",
  ) => (
    <EditableNode
      id={id}
      selected={selectedIds.includes(id)}
      primary={selectedId === id}
      layout={layout}
      onSelect={onSelect}
      onDragStart={beginDrag}
      className={`${className} cursor-grab active:cursor-grabbing`}
      as={tag}
      fitText
    >
      {editingId === id ? (
        <textarea
          autoFocus
          className="min-w-[10rem] w-full resize-none rounded border border-sky-400 bg-white/95 p-1 text-inherit outline-none"
          rows={Math.min(6, Math.max(1, value.split("\n").length))}
          defaultValue={value}
          onBlur={(e) => {
            commitText(id, e.target.value);
            setEditingId(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditingId(null);
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commitText(id, (e.target as HTMLTextAreaElement).value);
              setEditingId(null);
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          onDoubleClick={(e) => {
            e.stopPropagation();
            setEditingId(id);
          }}
        >
          {value}
        </span>
      )}
    </EditableNode>
  );

  const iconNode = (
    id: string,
    fallbackIcon: string,
    sizeClass = "text-xl",
    bg?: string,
    box = 40,
  ) => {
    const n = nodoOf(layout, id);
    const icon = n.icono || fallbackIcon;
    return (
      <EditableNode
        id={id}
        selected={selectedIds.includes(id)}
        primary={selectedId === id}
        layout={layout}
        onSelect={onSelect}
        onDragStart={beginDrag}
        className={`inline-flex cursor-grab items-center justify-center rounded-full active:cursor-grabbing ${sizeClass}`}
        style={{
          background: bg || pal.acento,
          color: "#fff",
          width: box,
          height: box,
        }}
      >
        <IconPh name={icon} />
      </EditableNode>
    );
  };

  const ctaBtn = (
    id: string,
    label: string,
    opts: {
      icon?: string;
      background?: string;
      borderColor?: string;
      color?: string;
    },
  ) => {
    if (nodoOf(layout, id).hidden) return null;
    const iconId = `${id}.icono`;
    const textoId = `${id}.texto`;
    const iconName = nodoOf(layout, iconId).icono || opts.icon;
    return (
      <EditableNode
        id={id}
        selected={selectedIds.includes(id)}
        primary={selectedId === id}
        layout={layout}
        onSelect={onSelect}
        onDragStart={beginDrag}
        as="span"
        className="studio-hover-target inline-flex cursor-grab items-center gap-2 rounded-[4px] border-2 text-[11px] font-bold uppercase tracking-[0.18em] active:cursor-grabbing"
        style={{
          background: opts.background,
          borderColor: opts.borderColor ?? opts.background ?? "transparent",
          color: opts.color ?? "#fff",
          padding: "var(--studio-pad-y, 18px) var(--studio-pad-x, 48px)",
        }}
      >
        {iconName && !nodoOf(layout, iconId).hidden && (
          <EditableNode
            id={iconId}
            selected={selectedIds.includes(iconId)}
            primary={selectedId === iconId}
            layout={layout}
            onSelect={onSelect}
            onDragStart={beginDrag}
            className="inline-flex shrink-0 cursor-grab items-center justify-center text-base leading-none active:cursor-grabbing"
          >
            <IconPh name={iconName} />
          </EditableNode>
        )}
        {!nodoOf(layout, textoId).hidden &&
          textBlock(textoId, label, "leading-none", "span")}
      </EditableNode>
    );
  };

  const sectionShell = (id: string, children: ReactNode, extraClass = "") => {
    const n = nodoOf(layout, id);
    if (n.hidden) return null;
    const selected = selectedIds.includes(id);
    const primary = selectedId === id;
    return (
      <StudioSelectableFrame
        as="section"
        key={id}
        data-node={id}
        className={`border select-none ${
          selected ? "border-sky-400" : "border-transparent hover:border-black/10"
        } ${extraClass}`}
        style={{
          backgroundColor: pal.fondo,
          ...estiloFondoImagen(fondos.pagina, assetBase),
          ...estiloNodo(n, assetBase),
        }}
        selected={selected}
        primary={primary}
        onHandle={(mode, e) => beginDrag(id, mode, e, e.currentTarget as HTMLElement)}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("[data-studio-handle]")) return;
          const closest = (e.target as HTMLElement).closest("[data-node]");
          const closestId = closest?.getAttribute("data-node");
          if (closestId && closestId !== id) return;
          const additive = e.ctrlKey || e.metaKey || e.shiftKey;
          onSelect(id, { additive });
          if (additive) return;
          beginDrag(id, "move", e, e.currentTarget);
        }}
      >
        {children}
      </StudioSelectableFrame>
    );
  };

  const sectionHeader = (
    prefix: string,
    data: { eyebrow: string; titulo: string; titulo_em: string; texto: string },
    dark = false,
  ) => (
    <div className="mb-4 space-y-2">
      {textBlock(
        `${prefix}.eyebrow`,
        data.eyebrow,
        `text-[10px] font-semibold uppercase tracking-widest ${dark ? "text-[#7DDDD0]" : "text-[#0c6069]"}`,
        "div",
      )}
      <h2
        className={`flex flex-wrap items-baseline gap-x-2 text-2xl font-extrabold leading-none ${dark ? "text-white" : "text-[#022D33]"}`}
      >
        {textBlock(`${prefix}.titulo`, data.titulo, "leading-none", "span")}
        <em className="font-light italic leading-none text-[#6aacb3]">
          {textBlock(`${prefix}.titulo_em`, data.titulo_em, "leading-none not-italic", "span")}
        </em>
      </h2>
      {textBlock(
        `${prefix}.texto`,
        data.texto,
        `max-w-xl text-sm leading-relaxed ${dark ? "text-white/65" : "text-[#3a7e87]"}`,
        "p",
      )}
    </div>
  );

  const renderSection = (id: string) => {
    const H = clasico.hero;
    switch (id) {
      case "hero":
        if (clasico.secciones.hero === false) return null;
        return sectionShell(
          id,
          <div className="font-[Montserrat,system-ui,sans-serif]" style={{ backgroundColor: pal.fondo }}>
            {!nodoOf(layout, "anuncio").hidden && (
            <div
              className="px-6 py-[9px] text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-white/90"
              style={{ background: pal.acento }}
            >
              🌿{" "}
              {textBlock(
                "anuncio",
                clasico.anuncio ||
                  "Materias primas farmacéuticas y cosméticas certificadas | Bogotá, Colombia · Lun–Vie 8:00–17:30",
                "inline",
                "span",
              )}
            </div>
            )}
            {!nodoOf(layout, "header").hidden && (
            <EditableNode
              id="header"
              selected={selectedIds.includes("header")}
              primary={selectedId === "header"}
              layout={layout}
              onSelect={onSelect}
              onDragStart={beginDrag}
              className="w-full border-b-2"
              style={{ borderColor: pal.acento, background: pal.fondo }}
            >
              <div
                className="mx-auto flex h-[72px] w-full max-w-[1280px] items-center gap-5 px-12"
                style={{ boxSizing: "border-box" }}
              >
              {!nodoOf(layout, "header.logo").hidden && (
              <EditableNode
                id="header.logo"
                selected={selectedIds.includes("header.logo")}
                primary={selectedId === "header.logo"}
                layout={layout}
                onSelect={onSelect}
                onDragStart={beginDrag}
                className="flex shrink-0 items-center gap-3"
              >
                <IsotipoStudio height={nodoOf(layout, "header.logo").height || 54} />
                <div className="leading-[1.2]">
                  <div className="text-[16px] font-extrabold tracking-[-0.5px] text-[#022D33]">
                    MCKENNA GROUP S.A.S
                  </div>
                  <div className="text-[9.6px] font-normal uppercase tracking-[0.16em] text-[#0c6069]">
                    {tagline}
                  </div>
                </div>
              </EditableNode>
              )}
              {!nodoOf(layout, "header.nav").hidden && (
              <EditableNode
                id="header.nav"
                selected={selectedIds.includes("header.nav")}
                primary={selectedId === "header.nav"}
                layout={layout}
                onSelect={onSelect}
                onDragStart={beginDrag}
                className="min-w-0 flex-1"
              >
                <ul className="flex flex-nowrap items-center justify-end gap-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#0c6069]">
                  {HEADER_NAV_ITEMS.map((item) =>
                    nodoOf(layout, item.id).hidden ? null : (
                      <li key={item.id}>
                        <EditableNode
                          id={item.id}
                          selected={selectedIds.includes(item.id)}
                          primary={selectedId === item.id}
                          layout={layout}
                          onSelect={onSelect}
                          onDragStart={beginDrag}
                          as="span"
                          className={`studio-hover-target block rounded ${
                            item.active
                              ? "bg-[rgba(12,96,105,0.08)] text-[#022D33]"
                              : "text-[#0c6069]"
                          }`}
                          style={{
                            padding:
                              "var(--studio-pad-y, 8px) var(--studio-pad-x, 10px)",
                          }}
                        >
                          {item.label}
                        </EditableNode>
                      </li>
                    ),
                  )}
                </ul>
              </EditableNode>
              )}
              {!nodoOf(layout, "header.search").hidden && (
              <EditableNode
                id="header.search"
                selected={selectedIds.includes("header.search")}
                primary={selectedId === "header.search"}
                layout={layout}
                onSelect={onSelect}
                onDragStart={beginDrag}
                className="relative shrink-0"
              >
                <i className="ph ph-magnifying-glass pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-[#0c6069]" />
                <input
                  readOnly
                  tabIndex={-1}
                  placeholder="Buscar producto..."
                  className="w-[190px] rounded border border-[#0c6069] bg-[rgba(12,96,105,0.06)] py-[9px] pl-8 pr-4 text-xs text-[#0c6069] outline-none"
                />
              </EditableNode>
              )}
              <div className="flex shrink-0 items-center gap-4">
                <span className="inline-flex p-1.5 text-[#0c6069]" title="Carrito" aria-hidden>
                  <i className="ph ph-shopping-cart text-[1.4rem] leading-none" />
                </span>
              {!nodoOf(layout, "header.btn_wa").hidden && (
              <EditableNode
                id="header.btn_wa"
                selected={selectedIds.includes("header.btn_wa")}
                primary={selectedId === "header.btn_wa"}
                layout={layout}
                onSelect={onSelect}
                onDragStart={beginDrag}
                className="studio-hover-target inline-flex shrink-0 items-center gap-1.5 rounded text-[10px] font-bold uppercase tracking-wide text-white"
                style={{
                  background: pal.acento,
                  padding: `${nodoOf(layout, "header.btn_wa").padY ?? 9}px ${nodoOf(layout, "header.btn_wa").padX ?? 20}px`,
                  ...(nodoOf(layout, "header.btn_wa").fontSize
                    ? { fontSize: nodoOf(layout, "header.btn_wa").fontSize }
                    : {}),
                }}
              >
                <i className="ph ph-whatsapp-logo text-sm" />
                WhatsApp
              </EditableNode>
              )}
              </div>
              </div>
            </EditableNode>
            )}
            {/* Tamaños = main.css .hero (42px / justify-center). No subir a 80px. */}
            <div ref={heroSplitRef} className="relative min-h-[680px] min-w-0">
              <div
                className="grid min-h-[680px] min-w-0"
                style={{
                  gridTemplateColumns: `minmax(0, ${heroSplitPct(nodoOf(layout, "hero"))}%) minmax(0, ${
                    100 - heroSplitPct(nodoOf(layout, "hero"))
                  }%)`,
                  gridTemplateRows: "minmax(680px, 1fr)",
                }}
              >
              <ZonaFondoDrop
                label="imagen izquierda"
                mostrarBoton={false}
                className="relative flex min-w-0 flex-col justify-center overflow-hidden text-white"
                style={{
                  padding: "56px 48px",
                  backgroundColor: pal.fondoOscuro,
                  ...estiloFondoImagen(
                    fondos.hero_izq,
                    assetBase,
                    "linear-gradient(180deg, rgba(2,45,51,.45), rgba(2,45,51,.78))",
                  ),
                }}
                onUrl={(url) => ponerFoto("hero.foto_izq", url)}
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute -left-[80px] -top-[80px] h-[320px] w-[320px] rounded-full"
                  style={{
                    background: "radial-gradient(circle, rgba(46,139,122,0.3) 0%, transparent 65%)",
                  }}
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute -bottom-12 -right-10 h-[220px] w-[220px] rounded-full"
                  style={{
                    background: "radial-gradient(circle, rgba(77,179,160,0.12) 0%, transparent 65%)",
                  }}
                />
                <div className="relative z-[1] space-y-0">
                  {textBlock(
                    "hero.badge",
                    `🌿 ${H.badge}`,
                    "mb-8 inline-block w-fit border-[1.5px] border-[#4eb3a0]/70 px-5 py-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-[#d4f4f0]",
                    "div",
                  )}
                  <h1 className="mb-6 text-[42px] font-extrabold leading-[1.08] tracking-[-1px]">
                    {textBlock("hero.titulo_l1", H.titulo_l1, "block", "span")}
                    <em className="block font-normal italic text-[#6aacb3]">
                      {textBlock("hero.titulo_em", H.titulo_em, "italic", "span")}
                    </em>
                    {textBlock("hero.titulo_l2", H.titulo_l2, "block", "span")}
                  </h1>
                  {textBlock(
                    "hero.subtitulo",
                    H.subtitulo,
                    "mb-10 max-w-[380px] text-[15px] font-normal leading-[1.8] text-white/70",
                    "p",
                  )}
                  <div className="flex flex-wrap gap-4">
                    {ctaBtn("hero.cta_principal", H.cta_principal, {
                      icon: "storefront",
                      background: pal.acento,
                      borderColor: pal.acento,
                    })}
                    {ctaBtn("hero.cta_secundario", H.cta_secundario, {
                      icon: "whatsapp-logo",
                      background: "transparent",
                      borderColor: "rgba(255,255,255,0.35)",
                    })}
                  </div>
                  {fotoBloque("hero.foto_izq", fondos.hero_izq)}
                </div>
              </ZonaFondoDrop>
              <ZonaFondoDrop
                label="imagen derecha"
                mostrarBoton={false}
                className="relative flex min-w-0 flex-col justify-center overflow-hidden"
                style={{
                  padding: "56px 48px",
                  backgroundColor: pal.fondo,
                  ...estiloFondoImagen(
                    fondos.hero_der,
                    assetBase,
                    "linear-gradient(180deg, rgba(227,252,255,.35), rgba(227,252,255,.72))",
                  ),
                }}
                onUrl={(url) => ponerFoto("hero.foto_der", url)}
              >
                {textBlock(
                  "hero.kit_label",
                  H.kit_label,
                  "mb-8 text-[11px] font-bold uppercase tracking-[0.28em] text-[#0c6069]",
                  "div",
                )}
                <div className="flex flex-col">
                  {H.kit.map((item, i) => (
                    nodoOf(layout, `hero.kit.${i}`).hidden ? null : (
                    <div
                      key={i}
                      className="border-b border-[#c0f0f5] py-[18px]"
                    >
                      <EditableNode
                        id={`hero.kit.${i}`}
                        selected={selectedIds.includes(`hero.kit.${i}`)}
                        primary={selectedId === `hero.kit.${i}`}
                        layout={layout}
                        onSelect={onSelect}
                        onDragStart={beginDrag}
                        className="flex cursor-grab items-center gap-5 active:cursor-grabbing"
                      >
                        {iconNode(
                          `hero.kit.${i}.icono`,
                          item.icono || "circle",
                          "text-[1.2rem]",
                          kitDots[i % kitDots.length],
                          48,
                        )}
                        <div className="min-w-0 flex-1">
                          {textBlock(
                            `hero.kit.${i}.titulo`,
                            item.titulo,
                            "text-base font-bold text-[#022D33]",
                            "h3",
                          )}
                          {textBlock(
                            `hero.kit.${i}.texto`,
                            item.texto,
                            "text-[13px] text-[#3a7e87]",
                            "p",
                          )}
                        </div>
                        {textBlock(
                          `hero.kit.${i}.valor`,
                          item.valor,
                          "shrink-0 text-[11px] font-bold uppercase tracking-[0.12em] text-[#0c6069]",
                          "span",
                        )}
                      </EditableNode>
                    </div>
                    )
                  ))}
                </div>
                {fotoBloque("hero.foto_der", fondos.hero_der)}
              </ZonaFondoDrop>
              </div>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-valuenow={heroSplitPct(nodoOf(layout, "hero"))}
                data-studio-handle="hero-split"
                title="Arrastra con el cursor para agrandar o achicar cada fondo"
                className="absolute top-0 z-50 flex h-full w-10 -translate-x-1/2 cursor-col-resize items-center justify-center touch-none select-none"
                style={{ left: `${heroSplitPct(nodoOf(layout, "hero"))}%` }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSelect("hero");
                  const wrap = heroSplitRef.current;
                  if (!wrap) return;
                  const handle = e.currentTarget;
                  handle.setPointerCapture(e.pointerId);
                  setDragging(true);
                  const onMove = (ev: PointerEvent) => {
                    const box = wrap.getBoundingClientRect();
                    if (box.width < 8) return;
                    const pct = Math.min(
                      HERO_SPLIT_MAX,
                      Math.max(
                        HERO_SPLIT_MIN,
                        Math.round(((ev.clientX - box.left) / box.width) * 100),
                      ),
                    );
                    onLayoutChangeRef.current(
                      mergeNodo(layoutRef.current, "hero", { splitPct: pct }),
                    );
                  };
                  const onUp = () => {
                    handle.removeEventListener("pointermove", onMove);
                    handle.removeEventListener("pointerup", onUp);
                    handle.removeEventListener("pointercancel", onUp);
                    setDragging(false);
                  };
                  handle.addEventListener("pointermove", onMove);
                  handle.addEventListener("pointerup", onUp);
                  handle.addEventListener("pointercancel", onUp);
                }}
              >
                <span className="pointer-events-none h-full w-1 rounded-full bg-sky-400 shadow-[0_0_0_2px_rgba(255,255,255,.85)]" />
                <span className="pointer-events-none absolute top-1/2 flex -translate-y-1/2 flex-col items-center gap-0.5 rounded-md border-2 border-white bg-sky-500 px-2 py-1.5 text-[10px] font-extrabold uppercase tracking-wide text-white shadow-lg">
                  ⟷ arrastrar
                  <span className="tabular-nums text-[9px] font-bold normal-case tracking-normal">
                    {heroSplitPct(nodoOf(layout, "hero"))}% · {100 - heroSplitPct(nodoOf(layout, "hero"))}%
                  </span>
                </span>
              </div>
            </div>
          </div>,
        );
      case "features":
        if (clasico.secciones.features === false) return null;
        return sectionShell(
          id,
          <div className="border-y bg-white mck-paper-white" style={{ borderColor: "rgba(12,96,105,0.15)" }}>
            <div className="grid grid-cols-2 md:grid-cols-4">
              {clasico.features.map((f, i) => (
                nodoOf(layout, `features.${i}`).hidden ? null : (
                <EditableNode
                  key={i}
                  id={`features.${i}`}
                  selected={selectedIds.includes(`features.${i}`)}
                  primary={selectedId === `features.${i}`}
                  layout={layout}
                  onSelect={onSelect}
                  onDragStart={beginDrag}
                  className="flex cursor-grab items-center gap-3 border-r p-5 active:cursor-grabbing"
                  style={{ borderColor: "rgba(12,96,105,0.15)" }}
                >
                  <div
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-[#6aacb3]"
                    style={{ background: pal.fondoOscuro }}
                  >
                    {iconNode(`features.${i}.icono`, f.icono || "circle", "text-xl")}
                  </div>
                  <div>
                    {textBlock(
                      `features.${i}.titulo`,
                      f.titulo,
                      "block text-sm font-bold text-[#022D33]",
                      "div",
                    )}
                    {textBlock(
                      `features.${i}.texto`,
                      f.texto,
                      "block text-xs text-[#3a7e87]",
                      "span",
                    )}
                  </div>
                </EditableNode>
                )
              ))}
            </div>
          </div>,
        );
      case "categorias":
        if (clasico.secciones.categorias === false) return null;
        return sectionShell(
          id,
          <ZonaFondoDrop
            label="imagen"
            className="relative p-8"
            style={{
              backgroundColor: pal.fondoOscuro,
              color: "#fff",
              ...estiloFondoImagen(
                fondos.categorias,
                assetBase,
                "linear-gradient(180deg, rgba(2,45,51,.5), rgba(2,45,51,.8))",
              ),
            }}
            onUrl={(url) =>
              onClasicoPatch((d) => {
                d.fondos = { ...(d.fondos || {}), categorias: url };
              })
            }
          >
            {sectionHeader("categorias", clasico.categorias, true)}
            <div className="grid gap-2 md:grid-cols-3">
              {LINEAS_CATALOGO.map((c) => (
                <div
                  key={c.id}
                  data-studio-guide={`cat-${c.id}`}
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold"
                  style={{ borderLeft: `3px solid ${c.color}`, color: c.color }}
                >
                  {c.name}
                </div>
              ))}
            </div>
          </ZonaFondoDrop>,
        );
      case "destacados":
        if (clasico.secciones.destacados === false) return null;
        return sectionShell(
          id,
          <div className="p-8" style={{ background: pal.fondo }}>
            {sectionHeader("destacados", clasico.destacados)}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  data-studio-guide={`dest-${i}`}
                  className="h-28 rounded-xl border bg-white/80"
                  style={{ borderColor: "rgba(12,96,105,0.15)" }}
                />
              ))}
            </div>
          </div>,
        );
      case "cta":
        if (clasico.secciones.cta === false) return null;
        return sectionShell(
          id,
          <ZonaFondoDrop
            label="imagen"
            className="relative space-y-4 p-10"
            style={{
              backgroundColor: pal.fondoOscuro,
              color: "#fff",
              ...estiloFondoImagen(
                fondos.cta,
                assetBase,
                "linear-gradient(180deg, rgba(2,45,51,.5), rgba(2,45,51,.82))",
              ),
            }}
            onUrl={(url) =>
              onClasicoPatch((d) => {
                d.fondos = { ...(d.fondos || {}), cta: url };
              })
            }
          >
            {textBlock(
              "cta.eyebrow",
              clasico.cta.eyebrow,
              "text-[10px] font-semibold uppercase tracking-widest text-[#7DDDD0]",
              "div",
            )}
            <h2 className="flex flex-wrap items-baseline gap-x-2 text-2xl font-extrabold leading-none">
              {textBlock("cta.titulo", clasico.cta.titulo, "leading-none", "span")}
              <em className="font-light italic leading-none text-[#6aacb3]">
                {textBlock("cta.titulo_em", clasico.cta.titulo_em, "leading-none not-italic", "span")}
              </em>
              ?
            </h2>
            {textBlock(
              "cta.texto",
              clasico.cta.texto,
              "max-w-xl text-sm text-white/65",
              "p",
            )}
            <div className="flex flex-wrap gap-3">
              {ctaBtn("cta.boton_wa", clasico.cta.boton_wa, {
                icon: "whatsapp-logo",
                background: "#25D366",
                borderColor: "#25D366",
              })}
              {ctaBtn("cta.boton_contacto", clasico.cta.boton_contacto, {
                background: "transparent",
                borderColor: "rgba(255,255,255,0.30)",
              })}
            </div>
          </ZonaFondoDrop>,
        );
      default:
        return null;
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (e.key !== "Enter" && e.key !== "F2") return;
      const id = selectedIds[selectedIds.length - 1];
      if (!id || !pathEsTextoEditable(contentPathForNode(id))) return;
      e.preventDefault();
      setEditingId(id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds]);

  useScrollHojaActiva(stageRef, selectedIds);
  const hojasVisibles = layout.orden.filter(
    (sid) => nodoOf(layout, sid).hidden !== true && clasico.secciones[sid] !== false,
  );

  return (
    <StudioAssetBaseCtx.Provider value={assetBase}>
    <StudioDeleteContext.Provider value={onEliminar}>
    <div
      className={`h-full overflow-auto ${dragging ? "cursor-grabbing select-none" : ""}`}
      style={{ background: "#505050" }}
      onPointerDown={() => {
        onSelect(null);
        setEditingId(null);
      }}
    >
      <MarcoCapitulo
        titulo="Clásico"
        zoom={zoom}
        hojasCount={hojasVisibles.length}
        stageId="clasico"
        stageRef={stageRef}
        pageWidth={1280}
      >
        {hojasVisibles.map((sid, i) => {
          const rendered = renderSection(sid);
          if (!rendered) return null;
          return (
            <FolioHoja
              key={sid}
              index={i}
              total={hojasVisibles.length}
              label={SECTION_LABEL_CLASICO[sid] || sid}
              sectionId={sid}
              onActivate={() => onSelect(sid)}
              overlay={
                alignGuides?.hojaId === sid ? (
                  <AlignmentGuidesOverlay guides={alignGuides.lines} frame={alignGuides.frame} />
                ) : undefined
              }
            >
              {rendered}
            </FolioHoja>
          );
        })}
      </MarcoCapitulo>
    </div>
    </StudioDeleteContext.Provider>
    </StudioAssetBaseCtx.Provider>
  );
}
