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
  applyContentPath,
  contentPathForNode,
  estiloFitTexto,
  estiloNodo,
  mergeNodo,
  nodoOf,
  type WebLayout,
} from "../../lib/webLayoutStudio";
import type { StudioSelectOpts } from "../../lib/studioSelectSimilar";
import { LINEAS_CATALOGO } from "../../lib/lineasCatalogo";
import { FolioHoja, MarcoCapitulo, useScrollHojaActiva } from "./HojasCapitulo";

export interface ClasicoCanvas {
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

const TEAL = "#0c6069";
const TEAL_DEEP = "#022D33";
const MINT = "#e8f4f4";
const GREEN_LIGHT = "#6aacb3";

export const SECTION_LABEL_CLASICO: Record<string, string> = {
  hero: "Hero",
  features: "Features",
  categorias: "Categorías",
  destacados: "Destacados",
  cta: "CTA final",
};

const KIT_DOT_COLORS = [TEAL_DEEP, "#045159", TEAL, GREEN_LIGHT];

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
  /** Ajusta la caja al texto (títulos/párrafos). No usar en tarjetas ni iconos. */
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

export { WebLayoutInspector } from "./WebLayoutCanvas";

export default function ClasicoLayoutCanvas({
  clasico,
  layout,
  selectedIds,
  onSelect,
  onLayoutChange,
  onClasicoPatch,
  zoom,
}: {
  clasico: ClasicoCanvas;
  layout: WebLayout;
  selectedIds: string[];
  onSelect: (id: string | null, opts?: StudioSelectOpts) => void;
  onLayoutChange: (next: WebLayout) => void;
  onClasicoPatch: (mutator: (draft: ClasicoCanvas) => void) => void;
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

  const iconNode = (id: string, fallbackIcon: string, sizeClass = "text-xl", bg?: string) => {
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
          background: bg || TEAL,
          color: "#fff",
          width: 40,
          height: 40,
        }}
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
          if (closestId && closestId !== id) return;
          const additive = e.ctrlKey || e.metaKey || e.shiftKey;
          onSelect(id, { additive });
          if (additive) return;
          beginDrag(id, "move", e, e.currentTarget);
        }}
      >
        <div className="pointer-events-none absolute left-2 top-2 z-20 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          {SECTION_LABEL_CLASICO[id] || id}
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
      <h2 className={`text-2xl font-extrabold ${dark ? "text-white" : "text-[#022D33]"}`}>
        {textBlock(`${prefix}.titulo`, data.titulo, "inline", "span")}
        {" "}
        <em className="font-light italic text-[#6aacb3]">
          {textBlock(`${prefix}.titulo_em`, data.titulo_em, "inline not-italic", "span")}
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
        return sectionShell(
          id,
          <div className="grid min-h-[420px] md:grid-cols-2">
            <div
              className="flex flex-col justify-center space-y-4 p-8"
              style={{ background: TEAL_DEEP, color: "#fff" }}
            >
              {textBlock(
                "hero.badge",
                `🌿 ${H.badge}`,
                "inline-block w-fit border border-[#4eb3a0]/55 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-[#7DDDD0]",
                "div",
              )}
              <h1 className="text-4xl font-extrabold leading-tight tracking-tight">
                {textBlock("hero.titulo_l1", H.titulo_l1, "", "span")}
                <br />
                <em className="font-light italic text-[#6aacb3]">
                  {textBlock("hero.titulo_em", H.titulo_em, "not-italic", "span")}
                </em>
                <br />
                {textBlock("hero.titulo_l2", H.titulo_l2, "", "span")}
              </h1>
              {textBlock(
                "hero.subtitulo",
                H.subtitulo,
                "max-w-sm text-sm leading-relaxed text-white/70",
                "p",
              )}
              <div className="flex flex-wrap gap-3 pt-2">
                {textBlock(
                  "hero.cta_principal",
                  H.cta_principal,
                  "rounded-full bg-[#0c6069] px-5 py-2.5 text-xs font-bold text-white",
                  "button",
                )}
                {textBlock(
                  "hero.cta_secundario",
                  H.cta_secundario,
                  "rounded-full border border-white/30 px-5 py-2.5 text-xs font-semibold text-white",
                  "button",
                )}
              </div>
            </div>
            <div className="flex flex-col justify-center p-8" style={{ background: MINT }}>
              {textBlock(
                "hero.kit_label",
                H.kit_label,
                "mb-4 text-[11px] font-bold uppercase tracking-[0.2em] text-[#0c6069]",
                "div",
              )}
              <div className="flex flex-col">
                {H.kit.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-4 border-b py-4"
                    style={{ borderColor: "rgba(12,96,105,0.15)" }}
                  >
                    <EditableNode
                      id={`hero.kit.${i}`}
                      selected={selectedIds.includes(`hero.kit.${i}`)}
                      primary={selectedId === `hero.kit.${i}`}
                      layout={layout}
                      onSelect={onSelect}
                      onDragStart={beginDrag}
                      className="flex flex-1 cursor-grab items-center gap-4 active:cursor-grabbing"
                    >
                      {iconNode(
                        `hero.kit.${i}.icono`,
                        item.icono || "circle",
                        "text-lg",
                        KIT_DOT_COLORS[i % KIT_DOT_COLORS.length],
                      )}
                      <div className="flex-1">
                        {textBlock(
                          `hero.kit.${i}.titulo`,
                          item.titulo,
                          "text-sm font-bold text-[#022D33]",
                          "h3",
                        )}
                        {textBlock(
                          `hero.kit.${i}.texto`,
                          item.texto,
                          "text-xs text-[#3a7e87]",
                          "p",
                        )}
                      </div>
                      {textBlock(
                        `hero.kit.${i}.valor`,
                        item.valor,
                        "shrink-0 text-[10px] font-bold uppercase tracking-wide text-[#0c6069]",
                        "span",
                      )}
                    </EditableNode>
                  </div>
                ))}
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
                    style={{ background: TEAL_DEEP }}
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
              ))}
            </div>
          </div>,
        );
      case "categorias":
        if (clasico.secciones.categorias === false) return null;
        return sectionShell(
          id,
          <div className="p-8" style={{ background: TEAL_DEEP, color: "#fff" }}>
            {sectionHeader("categorias", clasico.categorias, true)}
            <div className="grid gap-2 md:grid-cols-3">
              {LINEAS_CATALOGO.map((c) => (
                <div
                  key={c.id}
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold"
                  style={{ borderLeft: `3px solid ${c.color}`, color: c.color }}
                >
                  {c.name}
                </div>
              ))}
            </div>
          </div>,
        );
      case "destacados":
        if (clasico.secciones.destacados === false) return null;
        return sectionShell(
          id,
          <div className="p-8" style={{ background: MINT }}>
            {sectionHeader("destacados", clasico.destacados)}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
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
          <div className="space-y-4 p-10" style={{ background: TEAL_DEEP, color: "#fff" }}>
            {textBlock(
              "cta.eyebrow",
              clasico.cta.eyebrow,
              "text-[10px] font-semibold uppercase tracking-widest text-[#7DDDD0]",
              "div",
            )}
            <h2 className="text-2xl font-extrabold">
              {textBlock("cta.titulo", clasico.cta.titulo, "inline", "span")}
              {" "}
              <em className="font-light italic text-[#6aacb3]">
                {textBlock("cta.titulo_em", clasico.cta.titulo_em, "inline not-italic", "span")}
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
              {textBlock(
                "cta.boton_wa",
                clasico.cta.boton_wa,
                "rounded-full bg-[#25D366] px-5 py-2.5 text-xs font-bold text-white",
                "button",
              )}
              {textBlock(
                "cta.boton_contacto",
                clasico.cta.boton_contacto,
                "rounded-full border border-white/30 px-5 py-2.5 text-xs font-semibold text-white",
                "button",
              )}
            </div>
          </div>,
        );
      default:
        return null;
    }
  };

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
        titulo="Clásico"
        zoom={zoom}
        hojasCount={hojasVisibles.length}
        stageId="clasico"
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
              label={SECTION_LABEL_CLASICO[sid] || sid}
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
