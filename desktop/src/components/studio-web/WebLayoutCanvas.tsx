import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  contentPathForNode,
  estiloFitTexto,
  estiloNodo,
  applyContentPath,
  ANIM_OPTS,
  ICONOS_STUDIO,
  mergeNodo,
  mergeNodos,
  MONTSERRAT_VARIANTES,
  moverSeccion,
  nodoOf,
  STUDIO_ANIM_CSS,
  varianteIdDesdeNodo,
  type AnimPreset,
  type LayoutNodo,
  type ShadowPreset,
  type WebLayout,
} from "../../lib/webLayoutStudio";
import type { StudioSelectOpts } from "../../lib/studioSelectSimilar";
import { LINEAS_CATALOGO } from "../../lib/lineasCatalogo";
import {
  InspectorFold,
  SHADOW_OPTS,
  StudioSelect,
} from "./StudioDesplegables";
import { FolioHoja, MarcoCapitulo, useScrollHojaActiva } from "./HojasCapitulo";

/** Subconjunto de pureza que el lienzo necesita. */
export interface PurezaCanvas {
  colores: Record<string, string>;
  hero: {
    eyebrow: string;
    titulo: string;
    titulo_em: string;
    subtitulo: string;
    cta_principal: string;
    cta_secundario: string;
  };
  metricas: { valor: string; etiqueta: string }[];
  trazabilidad: {
    eyebrow: string;
    titulo: string;
    texto: string;
    pasos: { titulo: string; texto: string; icono?: string }[];
  };
  pilares: { titulo: string; texto: string; icono?: string }[];
  badges_producto: string[];
  cta: { titulo: string; texto: string; boton: string };
  secciones: Record<string, boolean>;
}

type DragMode = "move" | "scale" | "resize-e" | "resize-s" | "resize-se";

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
}

export const SECTION_LABEL: Record<string, string> = {
  hero: "Hero",
  metricas: "Métricas",
  trazabilidad: "Trazabilidad",
  pilares: "Pilares",
  categorias: "Categorías",
  destacados: "Destacados",
  cta: "CTA final",
};

const HANDLE =
  "absolute z-30 h-3 w-3 rounded-sm border-2 border-white bg-sky-500 shadow touch-none";

function IconPh({ name, className }: { name: string; className?: string }) {
  return <i className={`ph ph-${name} ${className || ""}`} aria-hidden />;
}

function SelectionChrome({
  onHandle,
}: {
  onHandle: (mode: DragMode, e: ReactPointerEvent) => void;
}) {
  const mk = (mode: DragMode) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onHandle(mode, e);
  };

  return (
    <>
      <span className="pointer-events-none absolute inset-0 rounded border-2 border-sky-400 shadow-[0_0_0_1px_rgba(14,165,233,0.35)]" />
      <button
        type="button"
        data-studio-handle="move"
        title="Arrastrar"
        className="absolute -top-3 left-1/2 z-30 flex h-5 -translate-x-1/2 cursor-grab items-center gap-0.5 rounded-full border border-sky-400 bg-sky-500 px-2 text-[9px] font-bold uppercase tracking-wide text-white shadow active:cursor-grabbing touch-none"
        onPointerDown={mk("move")}
      >
        <span aria-hidden>⠿</span> mover
      </button>
      <button
        type="button"
        data-studio-handle="resize-e"
        title="Ancho"
        className={`${HANDLE} -right-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize`}
        onPointerDown={mk("resize-e")}
      />
      <button
        type="button"
        data-studio-handle="resize-s"
        title="Alto"
        className={`${HANDLE} -bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize`}
        onPointerDown={mk("resize-s")}
      />
      <button
        type="button"
        data-studio-handle="resize-se"
        title="Redimensionar"
        className={`${HANDLE} -bottom-1.5 -right-1.5 cursor-nwse-resize`}
        onPointerDown={mk("resize-se")}
      />
      <button
        type="button"
        data-studio-handle="scale"
        title="Escala uniforme"
        className="absolute -bottom-1.5 -left-1.5 z-30 h-3 w-3 cursor-nesw-resize rounded-full border-2 border-white bg-amber-400 shadow touch-none"
        onPointerDown={mk("scale")}
      />
    </>
  );
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
  fitText?: boolean;
}) {
  const n = nodoOf(layout, id);
  const merged = { ...estiloFitTexto(n, { className, enabled: fitText }), ...style };
  const showHandles = selected && (primary ?? selected);
  const common = {
    "data-node": id,
    className: `relative select-none ${selected ? "z-10" : ""} ${className || ""}`,
    style: merged,
    onPointerDown: (e: ReactPointerEvent) => {
      if ((e.target as HTMLElement).closest("[data-studio-handle]")) return;
      e.stopPropagation();
      const additive = e.ctrlKey || e.metaKey || e.shiftKey;
      onSelect(id, { additive });
      if (additive) return;
      onDragStart(id, "move", e, e.currentTarget as HTMLElement);
    },
    children: (
      <>
        {children}
        {selected && !showHandles && (
          <span className="pointer-events-none absolute inset-0 rounded border-2 border-sky-300/90 bg-sky-400/10" />
        )}
        {showHandles && (
          <SelectionChrome
            onHandle={(mode, e) => onDragStart(id, mode, e, e.currentTarget as HTMLElement)}
          />
        )}
      </>
    ),
  };
  if (Tag === "button") {
    return <button type="button" {...common} />;
  }
  return <Tag {...common} />;
}

export default function WebLayoutCanvas({
  pureza,
  layout,
  selectedIds,
  onSelect,
  onLayoutChange,
  onPurezaPatch,
  zoom,
}: {
  pureza: PurezaCanvas;
  layout: WebLayout;
  selectedIds: string[];
  onSelect: (id: string | null, opts?: StudioSelectOpts) => void;
  onLayoutChange: (next: WebLayout) => void;
  onPurezaPatch: (mutator: (draft: PurezaCanvas) => void) => void;
  zoom: number;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const layoutRef = useRef(layout);
  const onLayoutChangeRef = useRef(onLayoutChange);
  const selectedIdsRef = useRef(selectedIds);
  layoutRef.current = layout;
  onLayoutChangeRef.current = onLayoutChange;
  selectedIdsRef.current = selectedIds;
  const selectedId = selectedIds[selectedIds.length - 1] ?? null;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const colores = pureza.colores;
  const acento = colores.acento || "#0c6069";
  const fondo = colores.fondo || "#f8f6f1";
  const tinta = colores.tinta || "#1c2b2a";
  const oro = colores.destacado || "#b9862f";

  const beginDrag = useCallback(
    (id: string, mode: DragMode, e: ReactPointerEvent, el?: HTMLElement) => {
      if (editingId) return;
      e.preventDefault();
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
      };
      setDragging(true);
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
      let next = layoutRef.current;
      for (const nid of d.ids) {
        const o = d.orig[nid];
        if (!o) continue;
        if (d.mode === "move") {
          next = mergeNodo(next, nid, {
            dx: Math.round(o.dx + dx),
            dy: Math.round(o.dy + dy),
          });
        } else if (d.mode === "scale") {
          const delta = (dx + dy) / 120;
          next = mergeNodo(next, nid, {
            scale: Math.min(2.5, Math.max(0.5, o.scale + delta)),
          });
        } else if (d.mode === "resize-e") {
          next = mergeNodo(next, nid, { width: Math.round(Math.max(24, o.w + dx)) });
        } else if (d.mode === "resize-s") {
          next = mergeNodo(next, nid, { height: Math.round(Math.max(16, o.h + dy)) });
        } else if (d.mode === "resize-se") {
          next = mergeNodo(next, nid, {
            width: Math.round(Math.max(24, o.w + dx)),
            height: Math.round(Math.max(16, o.h + dy)),
          });
        }
      }
      onLayoutChangeRef.current(next);
    };
    const onUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        setDragging(false);
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
    onPurezaPatch((draft) => {
      if (path.type === "string") {
        let cur: Record<string, unknown> = draft as unknown as Record<string, unknown>;
        for (let i = 0; i < path.path.length - 1; i++) {
          cur = cur[path.path[i]] as Record<string, unknown>;
        }
        cur[path.path[path.path.length - 1]] = text;
      } else if (path.type === "metric") {
        draft.metricas[path.index][path.field] = text;
      } else if (path.type === "paso") {
        if (path.field !== "icono") draft.trazabilidad.pasos[path.index][path.field] = text;
      } else if (path.type === "pilar") {
        if (path.field !== "icono") draft.pilares[path.index][path.field] = text;
      } else if (path.type === "badge") {
        draft.badges_producto[path.index] = text;
      } else if (path.type === "cta") {
        draft.cta[path.field] = text;
      }
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

  const iconNode = (id: string, fallbackIcon: string, sizeClass = "text-2xl") => {
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
        className={`inline-flex cursor-grab items-center justify-center active:cursor-grabbing ${sizeClass}`}
        style={{ color: acento }}
      >
        <IconPh name={icon} />
      </EditableNode>
    );
  };

  const sectionShell = (id: string, children: ReactNode, extraClass = "") => {
    const n = nodoOf(layout, id);
    if (n.hidden) return null;
    const selected = selectedIds.includes(id);
    const primary = selectedId === id;
    return (
      <section
        key={id}
        data-node={id}
        className={`relative border select-none ${
          selected ? "border-sky-400" : "border-transparent hover:border-black/10"
        } ${extraClass}`}
        style={estiloNodo(n)}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("[data-studio-handle]")) return;
          const closest = (e.target as HTMLElement).closest("[data-node]");
          const closestId = closest?.getAttribute("data-node");
          // Solo arrastra la sección si el clic es en el fondo (no en un hijo editable)
          if (closestId && closestId !== id) return;
          const additive = e.ctrlKey || e.metaKey || e.shiftKey;
          onSelect(id, { additive });
          if (additive) return;
          beginDrag(id, "move", e, e.currentTarget);
        }}
      >
        <div className="pointer-events-none absolute left-2 top-2 z-20 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          {SECTION_LABEL[id] || id}
        </div>
        {children}
        {selected && !primary && (
          <span className="pointer-events-none absolute inset-0 rounded border-2 border-sky-300/90 bg-sky-400/10" />
        )}
        {primary && (
          <SelectionChrome
            onHandle={(mode, e) => beginDrag(id, mode, e, e.currentTarget as HTMLElement)}
          />
        )}
      </section>
    );
  };

  const renderSection = (id: string) => {
    switch (id) {
      case "hero":
        return sectionShell(
          id,
          <div className="grid gap-6 p-8 md:grid-cols-[1.2fr_0.8fr]" style={{ background: fondo, color: tinta }}>
            <div className="space-y-3">
              {textBlock("hero.eyebrow", pureza.hero.eyebrow, "text-xs font-semibold uppercase tracking-wider", "div")}
              <div className="flex flex-wrap items-baseline gap-2">
                {textBlock("hero.titulo", pureza.hero.titulo, "text-3xl font-extrabold leading-tight", "h1")}
                {textBlock(
                  "hero.titulo_em",
                  pureza.hero.titulo_em,
                  "text-3xl font-light italic",
                  "span",
                )}
              </div>
              {textBlock("hero.subtitulo", pureza.hero.subtitulo, "max-w-xl text-sm leading-relaxed opacity-80", "p")}
              <div className="flex flex-wrap gap-2 pt-1">
                {textBlock(
                  "hero.cta_principal",
                  pureza.hero.cta_principal,
                  "rounded-full px-4 py-2 text-xs font-bold text-white",
                  "button",
                )}
                {textBlock(
                  "hero.cta_secundario",
                  pureza.hero.cta_secundario,
                  "rounded-full border px-4 py-2 text-xs font-semibold",
                  "button",
                )}
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                {pureza.badges_producto.map((b, i) =>
                  textBlock(`badge.${i}`, b, "rounded-full border border-black/10 bg-white px-3 py-1 text-[11px]", "span"),
                )}
              </div>
            </div>
            <div className="rounded-2xl border border-black/10 bg-white mck-paper-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                {iconNode("hero.doc.icon", "flask", "text-3xl")}
                <div>
                  <div className="text-sm font-bold">Certificado de Análisis</div>
                  <div className="text-[10px] uppercase tracking-wide text-black/40">COA · laboratorio</div>
                </div>
              </div>
              {["Pureza ≥ 99%", "CAS declarado", "Lote trazable", "VUCE / INVIMA"].map((row) => (
                <div key={row} className="border-t border-black/5 py-2 text-xs flex justify-between">
                  <span className="text-black/50">{row.split(" ")[0]}</span>
                  <strong>{row.split(" ").slice(1).join(" ")}</strong>
                </div>
              ))}
            </div>
          </div>,
        );
      case "metricas":
        if (pureza.secciones.metricas === false) return null;
        return sectionShell(
          id,
          <div className="grid grid-cols-2 gap-3 p-6 md:grid-cols-4" style={{ background: fondo }}>
            {pureza.metricas.map((m, i) => (
              <div key={i} className="rounded-xl border border-black/10 bg-white mck-paper-white p-4 text-center">
                {textBlock(`metricas.${i}.valor`, m.valor, "text-2xl font-extrabold", "div")}
                {textBlock(`metricas.${i}.etiqueta`, m.etiqueta, "mt-1 text-[11px] text-black/50", "div")}
              </div>
            ))}
          </div>,
        );
      case "trazabilidad":
        if (pureza.secciones.trazabilidad === false) return null;
        return sectionShell(
          id,
          <div className="space-y-4 p-8" style={{ background: fondo, color: tinta }}>
            {textBlock("trazabilidad.eyebrow", pureza.trazabilidad.eyebrow, "text-xs font-semibold uppercase tracking-wider", "div")}
            {textBlock("trazabilidad.titulo", pureza.trazabilidad.titulo, "text-2xl font-extrabold", "h2")}
            {textBlock("trazabilidad.texto", pureza.trazabilidad.texto, "max-w-2xl text-sm opacity-75", "p")}
            <div className="grid gap-3 md:grid-cols-5">
              {pureza.trazabilidad.pasos.map((paso, i) => (
                <div key={i} className="rounded-xl border border-black/10 bg-white mck-paper-white p-3">
                  {iconNode(`trazabilidad.paso.${i}.icono`, paso.icono || "circle", "text-xl")}
                  {textBlock(`trazabilidad.paso.${i}.titulo`, paso.titulo, "mt-2 text-sm font-bold", "h3")}
                  {textBlock(`trazabilidad.paso.${i}.texto`, paso.texto, "mt-1 text-[11px] leading-snug opacity-70", "p")}
                </div>
              ))}
            </div>
          </div>,
        );
      case "pilares":
        if (pureza.secciones.pilares === false) return null;
        return sectionShell(
          id,
          <div className="grid gap-4 p-8 md:grid-cols-3" style={{ background: "#efeae0", color: tinta }}>
            {pureza.pilares.map((p, i) => (
              <div key={i} className="space-y-2">
                {iconNode(`pilares.${i}.icono`, p.icono || "star", "text-2xl")}
                {textBlock(`pilares.${i}.titulo`, p.titulo, "text-base font-bold", "h3")}
                {textBlock(`pilares.${i}.texto`, p.texto, "text-sm opacity-75", "p")}
              </div>
            ))}
          </div>,
        );
      case "categorias":
        if (pureza.secciones.categorias === false) return null;
        return sectionShell(
          id,
          <div className="p-8" style={{ background: fondo, color: tinta }}>
            <div className="mb-4 text-2xl font-extrabold">Explora por categoría</div>
            <div className="grid gap-2 md:grid-cols-3">
              {LINEAS_CATALOGO.map((c) => (
                <div
                  key={c.id}
                  className="rounded-xl border border-black/10 bg-white mck-paper-white px-4 py-3 text-sm font-semibold"
                  style={{ borderLeft: `3px solid ${c.color}`, color: c.color }}
                >
                  {c.name}
                </div>
              ))}
            </div>
          </div>,
        );
      case "destacados":
        if (pureza.secciones.destacados === false) return null;
        return sectionShell(
          id,
          <div className="p-8" style={{ background: "#efeae0", color: tinta }}>
            <div className="mb-2 text-2xl font-extrabold">Productos destacados</div>
            <p className="mb-4 text-sm opacity-70">Bloque de catálogo (contenido dinámico del sitio).</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-28 rounded-xl border border-black/10 bg-white/80" />
              ))}
            </div>
          </div>,
        );
      case "cta":
        if (pureza.secciones.cta === false) return null;
        return sectionShell(
          id,
          <div className="space-y-3 p-10 text-center text-white" style={{ background: tinta }}>
            {textBlock("cta.titulo", pureza.cta.titulo, "text-2xl font-extrabold", "h2")}
            {textBlock("cta.texto", pureza.cta.texto, "mx-auto max-w-xl text-sm text-white/70", "p")}
            {textBlock("cta.boton", pureza.cta.boton, "mx-auto inline-block rounded-full bg-green-500 px-5 py-2 text-xs font-bold", "button")}
          </div>,
        );
      default:
        return null;
    }
  };

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const btn = el.querySelector('[data-node="hero.cta_principal"]') as HTMLElement | null;
    if (btn) btn.style.background = acento;
    const em = el.querySelector('[data-node="hero.titulo_em"]') as HTMLElement | null;
    if (em) em.style.color = oro;
  });

  useScrollHojaActiva(stageRef, selectedIds);
  const hojasVisibles = layout.orden.filter((sid) => nodoOf(layout, sid).hidden !== true);

  return (
    <div
      className={`h-full overflow-auto ${dragging ? "cursor-grabbing select-none" : ""}`}
      style={{ background: "#505050" }}
      onPointerDown={() => {
        onSelect(null);
        setEditingId(null);
      }}
    >
      <MarcoCapitulo
        titulo="Pureza"
        zoom={zoom}
        hojasCount={hojasVisibles.length}
        stageId="pureza"
        stageRef={stageRef}
      >
        {hojasVisibles.map((sid, i) => {
          const rendered = renderSection(sid);
          if (!rendered) return null;
          return (
            <FolioHoja
              key={sid}
              index={i}
              total={hojasVisibles.length}
              label={SECTION_LABEL[sid] || sid}
              sectionId={sid}
              onActivate={() => onSelect(sid)}
            >
              {rendered}
            </FolioHoja>
          );
        })}
      </MarcoCapitulo>
    </div>
  );
}

export function WebLayoutInspector({
  selectedId,
  selectedIds,
  layout,
  onLayoutChange,
  onPurezaPatch,
  onContentPatch,
  onSeleccionarSimilares,
  onSelect,
  sectionLabels = SECTION_LABEL,
}: {
  selectedId?: string | null;
  selectedIds?: string[];
  layout: WebLayout;
  pureza?: PurezaCanvas;
  onLayoutChange: (next: WebLayout) => void;
  onPurezaPatch?: (mutator: (draft: PurezaCanvas) => void) => void;
  onContentPatch?: (mutator: (draft: Record<string, unknown>) => void) => void;
  onSeleccionarSimilares?: () => void;
  onSelect?: (id: string | null) => void;
  sectionLabels?: Record<string, string>;
}) {
  const ids = selectedIds?.length ? selectedIds : selectedId ? [selectedId] : [];
  const primaryId = ids[ids.length - 1] ?? null;
  const multi = ids.length > 1;
  const contentPatch = onContentPatch ?? (onPurezaPatch
    ? (fn: (draft: Record<string, unknown>) => void) =>
        onPurezaPatch((d) => fn(d as unknown as Record<string, unknown>))
    : undefined);
  if (!primaryId) {
    return (
      <div className="space-y-3 p-3 text-xs text-muted">
        <p className="px-0.5 font-semibold text-ink">Lienzo visual</p>
        <InspectorFold titulo="Hojas del capítulo" hint="secciones" defaultOpen>
          <div className="space-y-1">
            {layout.orden.map((sid, i) => (
              <button
                key={sid}
                type="button"
                onClick={() => onSelect?.(sid)}
                className="flex w-full items-center justify-between rounded-md border border-border px-2 py-1.5 text-left text-[11px] font-semibold text-ink hover:border-accent/50"
              >
                <span>
                  <span className="mr-1.5 text-muted">{i + 1}.</span>
                  {sectionLabels[sid] || sid}
                </span>
                <span className="text-[10px] font-normal text-muted">ir</span>
              </button>
            ))}
          </div>
        </InspectorFold>
        <InspectorFold titulo="Ayuda">
          <ul className="list-disc space-y-1.5 pl-4">
            <li>Clic en texto, botón, icono o sección para seleccionar</li>
            <li>
              <strong className="text-ink">Ctrl/⌘+clic</strong> o Shift+clic: sumar a la selección
            </li>
            <li>
              Menú <strong className="text-ink">Selección → similares</strong> (Ctrl+Shift+L)
            </li>
            <li>
              Arrastra el elemento o usa la barra <strong className="text-ink">mover</strong>
            </li>
            <li>
              Asas azules: <strong className="text-ink">ancho / alto / esquina</strong>
            </li>
            <li>
              Asa ámbar: <strong className="text-ink">escala</strong> uniforme
            </li>
            <li>Doble clic en texto para editarlo</li>
            <li>Propiedades del objeto en los desplegables de este panel</li>
          </ul>
        </InspectorFold>
      </div>
    );
  }

  const selectedIdSafe = primaryId;
  const n = nodoOf(layout, selectedIdSafe);
  const isSection = !selectedIdSafe.includes(".") && !multi;
  const isIcon =
    ids.every(
      (id) => id.includes("icono") || id.endsWith(".icon") || id === "hero.doc.icon",
    );

  const patch = (p: LayoutNodo) => onLayoutChange(mergeNodos(layout, ids, p));

  const setIconContent = (icon: string) => {
    patch({ icono: icon });
    if (!contentPatch) return;
    contentPatch((d) => {
      for (const id of ids) {
        const path = contentPathForNode(id);
        if (path) applyContentPath(d, path, icon);
      }
    });
  };

  const shadowVal: ShadowPreset = n.shadow || "none";
  const animVal: AnimPreset = n.animation || "none";
  const field =
    "w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-accent/50";

  return (
    <div className="space-y-2.5 overflow-y-auto p-3 text-sm">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wide text-muted">
          {multi ? `${ids.length} seleccionados` : "Seleccionado"}
        </div>
        <div className="font-semibold text-ink">
          {multi
            ? `${ids.length} objetos · ancla ${sectionLabels[selectedIdSafe] || selectedIdSafe}`
            : sectionLabels[selectedIdSafe] || selectedIdSafe}
        </div>
        {onSeleccionarSimilares && (
          <button
            type="button"
            onClick={onSeleccionarSimilares}
            className="mt-1 text-[11px] font-semibold text-accent hover:underline"
            title="Ctrl+Shift+L"
          >
            Seleccionar similares
          </button>
        )}
      </div>

      <InspectorFold titulo="Hojas del capítulo" hint="ir a hoja">
        <div className="space-y-1">
          {layout.orden.map((sid, i) => (
            <button
              key={sid}
              type="button"
              onClick={() => onSelect?.(sid)}
              className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-[11px] font-semibold ${
                (!selectedIdSafe.includes(".") ? selectedIdSafe : selectedIdSafe.split(".")[0]) === sid
                  ? "border-accent bg-accent/10 text-ink"
                  : "border-border text-ink hover:border-accent/50"
              }`}
            >
              <span>
                <span className="mr-1.5 text-muted">{i + 1}.</span>
                {sectionLabels[sid] || sid}
              </span>
            </button>
          ))}
        </div>
      </InspectorFold>

      {isSection && (
        <InspectorFold titulo="Orden de sección" defaultOpen>
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 rounded-lg border border-border px-2 py-1.5 text-xs font-semibold hover:border-accent"
              onClick={() =>
                onLayoutChange({ ...layout, orden: moverSeccion(layout.orden, selectedIdSafe, -1) })
              }
            >
              ↑ Subir
            </button>
            <button
              type="button"
              className="flex-1 rounded-lg border border-border px-2 py-1.5 text-xs font-semibold hover:border-accent"
              onClick={() =>
                onLayoutChange({ ...layout, orden: moverSeccion(layout.orden, selectedIdSafe, 1) })
              }
            >
              ↓ Bajar
            </button>
          </div>
        </InspectorFold>
      )}

      <InspectorFold titulo="Posición y tamaño" defaultOpen>
        <div className="grid grid-cols-2 gap-2">
          {!multi && (
            <>
              <label className="block text-xs">
                <span className="mb-1 block font-semibold text-muted">X</span>
                <input
                  type="number"
                  className={field}
                  value={n.dx ?? 0}
                  onChange={(e) => patch({ dx: +e.target.value })}
                />
              </label>
              <label className="block text-xs">
                <span className="mb-1 block font-semibold text-muted">Y</span>
                <input
                  type="number"
                  className={field}
                  value={n.dy ?? 0}
                  onChange={(e) => patch({ dy: +e.target.value })}
                />
              </label>
            </>
          )}
          <label className="block text-xs">
            <span className="mb-1 block font-semibold text-muted">Ancho px</span>
            <input
              type="number"
              min={24}
              max={1200}
              className={field}
              value={n.width ?? ""}
              placeholder="auto"
              onChange={(e) =>
                patch({ width: e.target.value === "" ? undefined : +e.target.value })
              }
            />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-semibold text-muted">Alto px</span>
            <input
              type="number"
              min={16}
              max={800}
              className={field}
              value={n.height ?? ""}
              placeholder="auto"
              onChange={(e) =>
                patch({ height: e.target.value === "" ? undefined : +e.target.value })
              }
            />
          </label>
        </div>
        <label className="block text-xs">
          <span className="mb-1 block font-semibold text-muted">
            Escala ({((n.scale ?? 1) * 100).toFixed(0)}%)
          </span>
          <input
            type="range"
            min={50}
            max={250}
            value={Math.round((n.scale ?? 1) * 100)}
            onChange={(e) => patch({ scale: +e.target.value / 100 })}
            className="w-full accent-accent"
          />
        </label>
      </InspectorFold>

      {!isIcon && (
        <InspectorFold titulo="Tipografía" defaultOpen>
          <div className="rounded-md border border-border bg-surface px-2.5 py-2 text-xs">
            <span className="font-semibold text-muted">Familia</span>
            <div
              className="mt-0.5 text-sm font-bold text-ink"
              style={{ fontFamily: "'Montserrat', system-ui, sans-serif" }}
            >
              Montserrat
            </div>
            <p className="mt-0.5 text-[10px] text-muted">Única fuente de marca McKenna</p>
          </div>
          <StudioSelect
            label="Variante"
            value={varianteIdDesdeNodo(n)}
            options={MONTSERRAT_VARIANTES.map((v) => ({
              id: v.id,
              label: `${v.label} · ${v.weight}`,
            }))}
            onChange={(id) => {
              const v = MONTSERRAT_VARIANTES.find((x) => x.id === id);
              if (!v) return;
              patch({
                fontWeight: v.weight,
                fontItalic: v.italic ? true : undefined,
              });
            }}
          />
          {!isSection && (
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-muted">Tamaño de letra (px)</span>
              <input
                type="number"
                min={10}
                max={96}
                className={field}
                value={n.fontSize ?? ""}
                placeholder="auto"
                onChange={(e) =>
                  patch({ fontSize: e.target.value === "" ? undefined : +e.target.value })
                }
              />
            </label>
          )}
          <label className="block text-xs">
            <span className="mb-1 block font-semibold text-muted">Color de texto</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                className="h-9 w-12 cursor-pointer rounded border border-border bg-surface"
                value={n.color || "#ffffff"}
                onChange={(e) => patch({ color: e.target.value })}
              />
              <input
                type="text"
                className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-[11px]"
                value={n.color || ""}
                placeholder="auto"
                onChange={(e) =>
                  patch({ color: e.target.value.trim() === "" ? undefined : e.target.value })
                }
              />
              {n.color && (
                <button
                  type="button"
                  className="text-[10px] font-semibold text-muted underline"
                  onClick={() => patch({ color: undefined })}
                >
                  Quitar
                </button>
              )}
            </div>
          </label>
        </InspectorFold>
      )}

      <InspectorFold titulo="Caja · relleno y trazo">
        <label className="block text-xs">
          <span className="mb-1 block font-semibold text-muted">Relleno</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              className="h-9 w-12 cursor-pointer rounded border border-border bg-surface"
              value={n.background || "#0c6069"}
              onChange={(e) => patch({ background: e.target.value })}
            />
            <input
              type="text"
              className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-[11px]"
              value={n.background || ""}
              placeholder="ninguno"
              onChange={(e) =>
                patch({
                  background: e.target.value.trim() === "" ? undefined : e.target.value,
                })
              }
            />
            {n.background && (
              <button
                type="button"
                className="text-[10px] font-semibold text-muted underline"
                onClick={() => patch({ background: undefined })}
              >
                Quitar
              </button>
            )}
          </div>
        </label>
        <label className="block text-xs">
          <span className="mb-1 block font-semibold text-muted">Trazo (color)</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              className="h-9 w-12 cursor-pointer rounded border border-border bg-surface"
              value={n.borderColor || "#ffffff"}
              onChange={(e) =>
                patch({
                  borderColor: e.target.value,
                  borderWidth: n.borderWidth && n.borderWidth > 0 ? n.borderWidth : 1,
                })
              }
            />
            <input
              type="text"
              className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-[11px]"
              value={n.borderColor || ""}
              placeholder="ninguno"
              onChange={(e) => {
                const v = e.target.value.trim();
                if (!v) patch({ borderColor: undefined, borderWidth: undefined });
                else
                  patch({
                    borderColor: v,
                    borderWidth: n.borderWidth && n.borderWidth > 0 ? n.borderWidth : 1,
                  });
              }}
            />
            {n.borderColor && (
              <button
                type="button"
                className="text-[10px] font-semibold text-muted underline"
                onClick={() => patch({ borderColor: undefined, borderWidth: undefined })}
              >
                Quitar
              </button>
            )}
          </div>
        </label>
        <label className="block text-xs">
          <span className="mb-1 block font-semibold text-muted">Grosor del trazo (px)</span>
          <input
            type="number"
            min={0}
            max={24}
            className={field}
            value={n.borderWidth ?? ""}
            placeholder="0"
            onChange={(e) => {
              if (e.target.value === "") {
                patch({ borderWidth: undefined });
                return;
              }
              const w = +e.target.value;
              patch({
                borderWidth: w,
                borderColor: w > 0 ? n.borderColor || "#ffffff" : n.borderColor,
              });
            }}
          />
        </label>
      </InspectorFold>

      <InspectorFold
        titulo="Animación"
        hint={ANIM_OPTS.find((o) => o.id === animVal)?.label}
      >
        <StudioSelect
          label="Tipo"
          value={animVal}
          options={ANIM_OPTS.map((o) => ({
            id: o.id,
            label: o.loop ? `${o.label} (bucle)` : o.label,
          }))}
          onChange={(id) =>
            patch({
              animation: id === "none" ? undefined : id,
              ...(id === "none" ? { animDuration: undefined, animDelay: undefined } : {}),
            })
          }
        />
        {animVal !== "none" && (
          <>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-muted">
                Duración (
                {(n.animDuration ?? (animVal === "pulse" || animVal === "float" ? 2.2 : 0.7)).toFixed(1)}
                s)
              </span>
              <input
                type="range"
                min={20}
                max={300}
                value={Math.round(
                  (n.animDuration ?? (animVal === "pulse" || animVal === "float" ? 2.2 : 0.7)) * 100,
                )}
                onChange={(e) => patch({ animDuration: +e.target.value / 100 })}
                className="w-full accent-accent"
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-muted">
                Retraso ({(n.animDelay ?? 0).toFixed(1)}s)
              </span>
              <input
                type="range"
                min={0}
                max={200}
                value={Math.round((n.animDelay ?? 0) * 100)}
                onChange={(e) => patch({ animDelay: +e.target.value / 100 })}
                className="w-full accent-accent"
              />
            </label>
            <button
              type="button"
              className="w-full rounded-md border border-border px-2 py-1.5 text-[11px] font-semibold text-muted hover:border-accent hover:text-accent"
              onClick={() => {
                const cur = { ...n };
                patch({ animation: undefined });
                window.setTimeout(() => {
                  patch({
                    animation: cur.animation,
                    animDuration: cur.animDuration,
                    animDelay: cur.animDelay,
                  });
                }, 30);
              }}
            >
              ▶ Reproducir de nuevo
            </button>
          </>
        )}
      </InspectorFold>

      <InspectorFold titulo="Efectos">
        <label className="block text-xs">
          <span className="mb-1 block font-semibold text-muted">
            Opacidad ({Math.round((n.opacity ?? 1) * 100)}%)
          </span>
          <input
            type="range"
            min={5}
            max={100}
            value={Math.round((n.opacity ?? 1) * 100)}
            onChange={(e) => patch({ opacity: +e.target.value / 100 })}
            className="w-full accent-accent"
          />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block font-semibold text-muted">
            Rotación ({(n.rotate ?? 0).toFixed(0)}°)
          </span>
          <input
            type="range"
            min={-45}
            max={45}
            value={n.rotate ?? 0}
            onChange={(e) => patch({ rotate: +e.target.value })}
            className="w-full accent-accent"
          />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block font-semibold text-muted">Radio de borde (px)</span>
          <input
            type="number"
            min={0}
            max={999}
            className={field}
            value={n.borderRadius ?? ""}
            placeholder="auto"
            onChange={(e) =>
              patch({ borderRadius: e.target.value === "" ? undefined : +e.target.value })
            }
          />
        </label>
        <StudioSelect
          label="Sombra"
          value={shadowVal}
          options={SHADOW_OPTS}
          onChange={(s) => patch({ shadow: s === "none" ? undefined : s })}
        />
      </InspectorFold>

      {isIcon && (
        <InspectorFold titulo="Icono" defaultOpen>
          <div className="grid grid-cols-4 gap-1.5">
            {ICONOS_STUDIO.map((ic) => (
              <button
                key={ic}
                type="button"
                title={ic}
                onClick={() => setIconContent(ic)}
                className={`flex h-9 items-center justify-center rounded-md border text-lg ${
                  (n.icono || "") === ic ? "border-accent bg-accent/10" : "border-border hover:border-accent/40"
                }`}
              >
                <i className={`ph ph-${ic}`} />
              </button>
            ))}
          </div>
        </InspectorFold>
      )}

      <InspectorFold titulo="Visibilidad">
        <label className="flex items-center gap-2 text-xs font-semibold text-ink">
          <input
            type="checkbox"
            checked={n.hidden === true}
            onChange={(e) => patch({ hidden: e.target.checked || undefined })}
          />
          Ocultar elemento
        </label>
        <button
          type="button"
          className="w-full rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted hover:border-red-300 hover:text-red-600"
          onClick={() => {
            const nodos = { ...layout.nodos };
            for (const id of ids) delete nodos[id];
            onLayoutChange({ orden: layout.orden, nodos });
          }}
        >
          Reset posición / tamaño / efectos
        </button>
      </InspectorFold>
    </div>
  );
}

/** Carga Phosphor + keyframes de animación del Studio (una sola vez) */
export function usePhosphorIcons() {
  useEffect(() => {
    const id = "phosphor-studio-web";
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css";
      document.head.appendChild(link);
    }
    const animId = "mck-studio-anim-css";
    if (!document.getElementById(animId)) {
      const style = document.createElement("style");
      style.id = animId;
      style.textContent = STUDIO_ANIM_CSS;
      document.head.appendChild(style);
    }
  }, []);
}
