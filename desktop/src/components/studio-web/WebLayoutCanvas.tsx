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
  estiloNodo,
  ICONOS_STUDIO,
  mergeNodo,
  moverSeccion,
  nodoOf,
  type LayoutNodo,
  type WebLayout,
} from "../../lib/webLayoutStudio";

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

type DragMode = "move" | "scale";

interface DragState {
  id: string;
  mode: DragMode;
  startX: number;
  startY: number;
  origDx: number;
  origDy: number;
  origScale: number;
}

const SECTION_LABEL: Record<string, string> = {
  hero: "Hero",
  metricas: "Métricas",
  trazabilidad: "Trazabilidad",
  pilares: "Pilares",
  categorias: "Categorías",
  destacados: "Destacados",
  cta: "CTA final",
};

function IconPh({ name, className }: { name: string; className?: string }) {
  return <i className={`ph ph-${name} ${className || ""}`} aria-hidden />;
}

function SelectionChrome({
  onScalePointerDown,
}: {
  onScalePointerDown: (e: ReactPointerEvent) => void;
}) {
  return (
    <>
      <span className="pointer-events-none absolute inset-0 rounded border-2 border-sky-400 shadow-[0_0_0_1px_rgba(14,165,233,0.35)]" />
      <button
        type="button"
        title="Agrandar / reducir"
        className="absolute -bottom-1.5 -right-1.5 z-20 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border-2 border-white bg-sky-500 shadow"
        onPointerDown={onScalePointerDown}
      />
    </>
  );
}

function EditableNode({
  id,
  selected,
  layout,
  onSelect,
  onDragStart,
  style,
  className,
  children,
  as: Tag = "div",
}: {
  id: string;
  selected: boolean;
  layout: WebLayout;
  onSelect: (id: string) => void;
  onDragStart: (id: string, mode: DragMode, e: ReactPointerEvent) => void;
  style?: CSSProperties;
  className?: string;
  children: ReactNode;
  as?: "div" | "span" | "h1" | "h2" | "h3" | "p" | "button";
}) {
  const n = nodoOf(layout, id);
  const merged = { ...estiloNodo(n), ...style };
  return (
    <Tag
      data-node={id}
      className={`relative ${selected ? "z-10" : ""} ${className || ""}`}
      style={merged}
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect(id);
        if ((e.target as HTMLElement).closest("[data-scale-handle]")) return;
        onDragStart(id, "move", e);
      }}
    >
      {children}
      {selected && (
        <SelectionChrome
          onScalePointerDown={(e) => {
            e.stopPropagation();
            (e.currentTarget as HTMLElement).dataset.scaleHandle = "1";
            onDragStart(id, "scale", e);
          }}
        />
      )}
    </Tag>
  );
}

export default function WebLayoutCanvas({
  pureza,
  layout,
  selectedId,
  onSelect,
  onLayoutChange,
  onPurezaPatch,
  zoom,
}: {
  pureza: PurezaCanvas;
  layout: WebLayout;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onLayoutChange: (next: WebLayout) => void;
  onPurezaPatch: (mutator: (draft: PurezaCanvas) => void) => void;
  zoom: number;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const layoutRef = useRef(layout);
  const onLayoutChangeRef = useRef(onLayoutChange);
  layoutRef.current = layout;
  onLayoutChangeRef.current = onLayoutChange;
  const [editingId, setEditingId] = useState<string | null>(null);
  const colores = pureza.colores;
  const acento = colores.acento || "#0c6069";
  const fondo = colores.fondo || "#f8f6f1";
  const tinta = colores.tinta || "#1c2b2a";
  const oro = colores.destacado || "#b9862f";

  const beginDrag = useCallback(
    (id: string, mode: DragMode, e: ReactPointerEvent) => {
      if (editingId) return;
      e.preventDefault();
      const n = nodoOf(layout, id);
      dragRef.current = {
        id,
        mode,
        startX: e.clientX,
        startY: e.clientY,
        origDx: n.dx ?? 0,
        origDy: n.dy ?? 0,
        origScale: n.scale ?? 1,
      };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [editingId, layout],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const inv = 1 / zoom;
      const dx = (e.clientX - d.startX) * inv;
      const dy = (e.clientY - d.startY) * inv;
      const cur = layoutRef.current;
      if (d.mode === "move") {
        onLayoutChangeRef.current(
          mergeNodo(cur, d.id, {
            dx: Math.round(d.origDx + dx),
            dy: Math.round(d.origDy + dy),
          }),
        );
      } else {
        const delta = (dx + dy) / 120;
        onLayoutChangeRef.current(
          mergeNodo(cur, d.id, {
            scale: Math.min(2.5, Math.max(0.5, d.origScale + delta)),
          }),
        );
      }
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
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
      selected={selectedId === id}
      layout={layout}
      onSelect={onSelect}
      onDragStart={beginDrag}
      className={`${className} cursor-grab active:cursor-grabbing`}
      as={tag}
    >
      {editingId === id ? (
        <textarea
          autoFocus
          className="w-full resize-none rounded border border-sky-400 bg-white/95 p-1 text-inherit outline-none"
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
        selected={selectedId === id}
        layout={layout}
        onSelect={onSelect}
        onDragStart={beginDrag}
        className={`inline-flex cursor-grab items-center justify-center text-[${acento}] active:cursor-grabbing ${sizeClass}`}
        style={{ color: acento }}
      >
        <IconPh name={icon} />
      </EditableNode>
    );
  };

  const sectionShell = (id: string, children: ReactNode, extraClass = "") => {
    const n = nodoOf(layout, id);
    if (n.hidden) return null;
    const selected = selectedId === id;
    return (
      <section
        key={id}
        data-node={id}
        className={`relative mb-3 rounded-lg border ${selected ? "border-sky-400" : "border-transparent hover:border-black/10"} ${extraClass}`}
        style={estiloNodo(n)}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("[data-node]") !== e.currentTarget
            && (e.target as HTMLElement).closest("[data-node]")?.getAttribute("data-node") !== id) {
            return;
          }
          // Solo selecciona sección si el click es en el fondo de la sección
          if ((e.target as HTMLElement).closest("[data-node]")?.getAttribute("data-node") === id
            || e.target === e.currentTarget) {
            onSelect(id);
            beginDrag(id, "move", e);
          }
        }}
      >
        <div className="pointer-events-none absolute left-2 top-2 z-20 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          {SECTION_LABEL[id] || id}
        </div>
        {children}
        {selected && (
          <SelectionChrome
            onScalePointerDown={(e) => {
              e.stopPropagation();
              beginDrag(id, "scale", e);
            }}
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
            <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
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
              <div key={i} className="rounded-xl border border-black/10 bg-white p-4 text-center">
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
                <div key={i} className="rounded-xl border border-black/10 bg-white p-3">
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
              {["Cosmética", "Farmacéutica", "Nutrición", "Perfumería", "Hogar", "Laboratorio"].map((c) => (
                <div key={c} className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm font-semibold">
                  {c}
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

  // Aplica color a CTAs del hero vía CSS vars en el stage
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const btn = el.querySelector('[data-node="hero.cta_principal"]') as HTMLElement | null;
    if (btn) btn.style.background = acento;
    const em = el.querySelector('[data-node="hero.titulo_em"]') as HTMLElement | null;
    if (em) em.style.color = oro;
  });

  return (
    <div
      className="h-full overflow-auto"
      style={{ background: "#505050" }}
      onPointerDown={() => {
        onSelect(null);
        setEditingId(null);
      }}
    >
      <div
        className="mx-auto origin-top py-6"
        style={{ width: 960, transform: `scale(${zoom})`, marginBottom: `${(zoom - 1) * 800}px` }}
      >
        <div
          ref={stageRef}
          className="overflow-hidden rounded-xl bg-white shadow-2xl"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {layout.orden.map((sid) => renderSection(sid))}
        </div>
      </div>
    </div>
  );
}

/** Panel derecho: propiedades del nodo seleccionado */
export function WebLayoutInspector({
  selectedId,
  layout,
  onLayoutChange,
  onPurezaPatch,
}: {
  selectedId: string | null;
  layout: WebLayout;
  pureza: PurezaCanvas;
  onLayoutChange: (next: WebLayout) => void;
  onPurezaPatch: (mutator: (draft: PurezaCanvas) => void) => void;
}) {
  if (!selectedId) {
    return (
      <div className="space-y-2 p-4 text-xs text-muted">
        <p className="font-semibold text-ink">Lienzo visual</p>
        <ul className="list-disc space-y-1 pl-4">
          <li>Clic para seleccionar texto, icono o sección</li>
          <li>Arrastra para mover</li>
          <li>Esquina azul para agrandar / reducir</li>
          <li>Doble clic en un texto para editarlo</li>
        </ul>
      </div>
    );
  }

  const n = nodoOf(layout, selectedId);
  const isSection = !selectedId.includes(".");
  const isIcon = selectedId.includes("icono") || selectedId.endsWith(".icon") || selectedId === "hero.doc.icon";

  const patch = (p: LayoutNodo) => onLayoutChange(mergeNodo(layout, selectedId, p));

  const setIconContent = (icon: string) => {
    patch({ icono: icon });
    const path = contentPathForNode(selectedId);
    if (path?.type === "paso" && path.field === "icono") {
      onPurezaPatch((d) => {
        d.trazabilidad.pasos[path.index].icono = icon;
      });
    }
    if (path?.type === "pilar" && path.field === "icono") {
      onPurezaPatch((d) => {
        d.pilares[path.index].icono = icon;
      });
    }
    // nodos tipo trazabilidad.paso.N.icono
    const mPaso = /^trazabilidad\.paso\.(\d+)\.icono$/.exec(selectedId);
    if (mPaso) {
      onPurezaPatch((d) => {
        d.trazabilidad.pasos[+mPaso[1]].icono = icon;
      });
    }
    const mPilar = /^pilares\.(\d+)\.icono$/.exec(selectedId);
    if (mPilar) {
      onPurezaPatch((d) => {
        d.pilares[+mPilar[1]].icono = icon;
      });
    }
  };

  return (
    <div className="space-y-4 overflow-y-auto p-4 text-sm">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Seleccionado</div>
        <div className="font-semibold text-ink">{SECTION_LABEL[selectedId] || selectedId}</div>
      </div>

      {isSection && (
        <div className="flex gap-2">
          <button
            type="button"
            className="flex-1 rounded-lg border border-border px-2 py-1.5 text-xs font-semibold hover:border-accent"
            onClick={() =>
              onLayoutChange({ ...layout, orden: moverSeccion(layout.orden, selectedId, -1) })
            }
          >
            ↑ Subir sección
          </button>
          <button
            type="button"
            className="flex-1 rounded-lg border border-border px-2 py-1.5 text-xs font-semibold hover:border-accent"
            onClick={() =>
              onLayoutChange({ ...layout, orden: moverSeccion(layout.orden, selectedId, 1) })
            }
          >
            ↓ Bajar sección
          </button>
        </div>
      )}

      <label className="block text-xs">
        <span className="mb-1 block font-semibold text-muted">Desplazamiento X</span>
        <input
          type="number"
          className="w-full rounded-md border border-border bg-surface px-2 py-1.5"
          value={n.dx ?? 0}
          onChange={(e) => patch({ dx: +e.target.value })}
        />
      </label>
      <label className="block text-xs">
        <span className="mb-1 block font-semibold text-muted">Desplazamiento Y</span>
        <input
          type="number"
          className="w-full rounded-md border border-border bg-surface px-2 py-1.5"
          value={n.dy ?? 0}
          onChange={(e) => patch({ dy: +e.target.value })}
        />
      </label>
      <label className="block text-xs">
        <span className="mb-1 block font-semibold text-muted">Escala ({((n.scale ?? 1) * 100).toFixed(0)}%)</span>
        <input
          type="range"
          min={50}
          max={250}
          value={Math.round((n.scale ?? 1) * 100)}
          onChange={(e) => patch({ scale: +e.target.value / 100 })}
          className="w-full"
        />
      </label>
      {!isIcon && !isSection && (
        <label className="block text-xs">
          <span className="mb-1 block font-semibold text-muted">Tamaño de letra (px)</span>
          <input
            type="number"
            min={10}
            max={96}
            className="w-full rounded-md border border-border bg-surface px-2 py-1.5"
            value={n.fontSize ?? ""}
            placeholder="auto"
            onChange={(e) =>
              patch({ fontSize: e.target.value === "" ? undefined : +e.target.value })
            }
          />
        </label>
      )}

      {isIcon && (
        <div>
          <div className="mb-2 text-xs font-semibold text-muted">Icono</div>
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
        </div>
      )}

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
          delete nodos[selectedId];
          onLayoutChange({ ...ordenKeep(layout), nodos });
        }}
      >
        Reset posición / escala
      </button>
    </div>
  );
}

function ordenKeep(layout: WebLayout): WebLayout {
  return { orden: layout.orden, nodos: layout.nodos };
}

/** Carga Phosphor en el panel (CDN) una sola vez */
export function usePhosphorIcons() {
  useEffect(() => {
    const id = "phosphor-studio-web";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css";
    document.head.appendChild(link);
  }, []);
}
