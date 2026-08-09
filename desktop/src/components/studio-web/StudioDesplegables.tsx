import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/** Acordeón del inspector (tipografía, caja, efectos…). */
export function InspectorFold({
  titulo,
  hint,
  defaultOpen = false,
  children,
}: {
  titulo: string;
  hint?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      className="group rounded-lg border border-border bg-surface"
      defaultOpen={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-2 text-[10px] font-bold uppercase tracking-wide text-muted [&::-webkit-details-marker]:hidden">
        <span>
          {titulo}
          {hint && (
            <span className="ml-1.5 font-normal normal-case tracking-normal opacity-80">{hint}</span>
          )}
        </span>
        <span aria-hidden className="text-xs text-muted transition group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="space-y-2 border-t border-border px-2.5 py-2.5">{children}</div>
    </details>
  );
}

const SELECT_CLS =
  "w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-accent/50";

/** Desplegable nativo compacto. */
export function StudioSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  className = "",
}: {
  label?: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <label className={`block text-xs ${className}`}>
      {label && <span className="mb-1 block font-semibold text-muted">{label}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={SELECT_CLS}
        aria-label={label}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Menú desplegable de la barra del lienzo (Capas, Selección, Acciones). */
export function StudioMenu({
  label,
  children,
  disabled,
  align = "left",
}: {
  label: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[11px] font-semibold text-ink hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {label}
        <span aria-hidden className={`text-[10px] text-muted transition ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute top-full z-50 mt-1 min-w-[13rem] overflow-hidden rounded-lg border border-border bg-surface-panel py-1 shadow-xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <div
            onClick={(e) => {
              const t = e.target as HTMLElement;
              if (t.closest("[data-keep-open]")) return;
              setOpen(false);
            }}
          >
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

export function StudioMenuItem({
  onClick,
  disabled,
  active,
  children,
  hint,
}: {
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "bg-accent/10 font-semibold text-ink"
          : "text-ink hover:bg-surface-hover"
      }`}
    >
      <span>{children}</span>
      {hint && <span className="shrink-0 text-[10px] font-normal text-muted">{hint}</span>}
    </button>
  );
}

export function StudioMenuSep() {
  return <div className="my-1 border-t border-border" role="separator" />;
}

export const ZOOM_PRESETS = [40, 50, 60, 72, 85, 100] as const;

export const SHADOW_OPTS: { id: "none" | "sm" | "md" | "lg"; label: string }[] = [
  { id: "none", label: "Ninguna" },
  { id: "sm", label: "Suave" },
  { id: "md", label: "Media" },
  { id: "lg", label: "Fuerte" },
];

/** Barra sobre el lienzo: Capas, Zoom, Selección, Acciones. */
export function LienzoToolbar({
  zoom,
  onZoom,
  sectionIds,
  sectionLabels,
  selectedIds,
  onSelect,
  onSeleccionarSimilares,
  onResetLayout,
  guardando,
}: {
  zoom: number;
  onZoom: (z: number) => void;
  sectionIds: string[];
  sectionLabels: Record<string, string>;
  selectedIds: string[];
  onSelect: (id: string | null) => void;
  onSeleccionarSimilares: () => void;
  onResetLayout: () => void;
  guardando?: boolean;
}) {
  const zoomPct = Math.round(zoom * 100);
  const zoomValue = String(zoomPct);
  const primary = selectedIds[selectedIds.length - 1] ?? "";
  const seccionActiva = primary.includes(".") ? primary.split(".")[0] : primary;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface-panel px-3 py-2">
      <StudioMenu
        label={
          <>
            Capas
            {seccionActiva ? (
              <span className="max-w-[7rem] truncate font-normal text-muted">
                · {sectionLabels[seccionActiva] || seccionActiva}
              </span>
            ) : null}
          </>
        }
      >
        {sectionIds.map((sid) => (
          <StudioMenuItem
            key={sid}
            active={seccionActiva === sid}
            onClick={() => onSelect(sid)}
          >
            {sectionLabels[sid] || sid}
          </StudioMenuItem>
        ))}
      </StudioMenu>

      <label className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-[11px] font-semibold text-muted">
        Zoom
        <select
          value={zoomValue}
          onChange={(e) => onZoom(+e.target.value / 100)}
          className="bg-transparent text-[11px] font-semibold text-ink outline-none"
          aria-label="Zoom del lienzo"
        >
          {!ZOOM_PRESETS.includes(zoomPct as (typeof ZOOM_PRESETS)[number]) && (
            <option value={zoomPct}>{zoomPct}%</option>
          )}
          {ZOOM_PRESETS.map((p) => (
            <option key={p} value={p}>
              {p}%
            </option>
          ))}
        </select>
      </label>
      <input
        type="range"
        min={40}
        max={100}
        value={zoomPct}
        onChange={(e) => onZoom(+e.target.value / 100)}
        className="w-20 accent-accent"
        aria-label="Zoom fino"
      />

      <StudioMenu label="Selección">
        <StudioMenuItem
          disabled={selectedIds.length === 0}
          onClick={onSeleccionarSimilares}
          hint="Ctrl+Shift+L"
        >
          Objetos similares
        </StudioMenuItem>
        <StudioMenuItem disabled={selectedIds.length === 0} onClick={() => onSelect(null)}>
          Quitar selección
        </StudioMenuItem>
        <StudioMenuSep />
        <div className="px-3 py-1.5 text-[10px] leading-snug text-muted" data-keep-open>
          Ctrl/⌘+clic o Shift+clic suma objetos. Esc limpia.
        </div>
      </StudioMenu>

      <StudioMenu label="Acciones" align="left">
        <StudioMenuItem disabled={guardando} onClick={onResetLayout}>
          Restaurar lienzo
        </StudioMenuItem>
      </StudioMenu>
    </div>
  );
}
