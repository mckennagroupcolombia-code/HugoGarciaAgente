import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  TIPOS_ETIQUETA_DEFAULT,
  useGuardarTiposEtiqueta,
  useTiposEtiqueta,
  type TipoEtiqueta,
} from "../../lib/etiquetasTipos";
import { IconButton } from "./ui";
import { clampFloatingLeft } from "../../lib/floatingPosition";

const MENU_FORMATO_PANEL_MAX_WIDTH = 320;

export interface FormatoEtiquetaValor {
  nombre: string;
  anchoMm: number;
  altoMm: number;
}

const CUSTOM_KEY = "__custom__";

export function etiquetaOpcionLabel(t: TipoEtiqueta): string {
  return `${t.nombre} · ${t.ancho_mm}×${t.alto_mm} mm`;
}

interface MenuFormatoProps {
  tipos: TipoEtiqueta[];
  selectValue: string;
  isLoading: boolean;
  triggerClass: string;
  dark?: boolean;
  compact?: boolean;
  onSelect: (key: string) => void;
  onDelete: (nombre: string) => void;
  deleting?: boolean;
}

function MenuFormatoDropdown({
  tipos,
  selectValue,
  isLoading,
  triggerClass,
  dark = false,
  compact = false,
  onSelect,
  onDelete,
  deleting = false,
}: MenuFormatoProps) {
  const [abierto, setAbierto] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number } | null>(null);

  const updatePos = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = clampFloatingLeft(r.left, MENU_FORMATO_PANEL_MAX_WIDTH, window.innerWidth);
    setPos({ top: r.bottom + 4, left, minWidth: Math.max(r.width, 224) });
  }, []);

  useLayoutEffect(() => {
    if (!abierto) {
      setPos(null);
      return;
    }
    updatePos();
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [abierto, updatePos]);

  useEffect(() => {
    if (!abierto) return;
    function fuera(e: MouseEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setAbierto(false);
    }
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  const etiquetaActual = selectValue !== CUSTOM_KEY
    ? tipos.find((t) => t.nombre === selectValue)
    : null;

  const triggerLabel = etiquetaActual
    ? etiquetaOpcionLabel(etiquetaActual)
    : "✏️ Nuevo / personalizado…";

  const panelCls = dark
    ? "rounded border border-white/30 bg-[#1e293b] py-1 shadow-xl"
    : "rounded border border-border bg-surface-panel py-1 shadow-xl";

  const itemCls = dark
    ? "flex w-full items-center gap-1 px-2 py-1.5 text-left text-xs text-white hover:bg-white/10"
    : "flex w-full items-center gap-1 px-2 py-1.5 text-left text-xs text-ink hover:bg-surface-hover";

  const itemActivo = dark ? "bg-white/15" : "bg-accent/10";

  const panel = abierto && pos
    ? createPortal(
        <div
          ref={panelRef}
          className={`fixed z-[500] max-w-[320px] ${panelCls}`}
          style={{ top: pos.top, left: pos.left, minWidth: pos.minWidth }}
          role="listbox"
        >
          <ul className="max-h-56 overflow-y-auto">
            {tipos.map((t) => (
              <li key={t.nombre} className="flex items-center">
                <button
                  type="button"
                  className={`${itemCls} flex-1 ${selectValue === t.nombre ? itemActivo : ""}`}
                  onClick={() => {
                    onSelect(t.nombre);
                    setAbierto(false);
                  }}
                >
                  <span className="truncate">{etiquetaOpcionLabel(t)}</span>
                </button>
                <IconButton
                  icon="trash"
                  label={`Eliminar ${t.nombre}`}
                  size="xs"
                  tone="danger"
                  disabled={deleting}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(t.nombre);
                  }}
                />
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={`${itemCls} w-full border-t ${dark ? "border-white/20" : "border-border"} ${selectValue === CUSTOM_KEY ? itemActivo : ""}`}
            onClick={() => {
              onSelect(CUSTOM_KEY);
              setAbierto(false);
            }}
          >
            ✏️ Nuevo / personalizado…
          </button>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <div ref={wrapRef} className={`relative ${compact ? "" : "w-full max-w-[280px]"}`}>
        <button
          type="button"
          disabled={isLoading || deleting}
          onClick={() => setAbierto((v) => !v)}
          className={`${triggerClass} flex items-center justify-between gap-2 text-left disabled:opacity-50`}
          title={triggerLabel}
          aria-expanded={abierto}
          aria-haspopup="listbox"
        >
          <span className="truncate">{triggerLabel}</span>
          <span className="shrink-0 text-[10px] opacity-60">{abierto ? "▲" : "▼"}</span>
        </button>
      </div>
      {panel}
    </>
  );
}

interface SelectorFormatoEtiquetaProps {
  value: FormatoEtiquetaValor;
  onChange: (v: FormatoEtiquetaValor) => void;
  labelNombre?: string;
  inputClass?: string;
  selectClass?: string;
  labelClass?: string;
  compact?: boolean;
  dark?: boolean;
  /** Barra horizontal en vista previa Studio */
  previewBar?: boolean;
}

export function SelectorFormatoEtiqueta({
  value,
  onChange,
  labelNombre = "Formato",
  inputClass = "",
  selectClass = "",
  labelClass = "",
  compact = false,
  dark = false,
  previewBar = false,
}: SelectorFormatoEtiquetaProps) {
  const { data, isLoading } = useTiposEtiqueta();
  const guardar = useGuardarTiposEtiqueta();
  const [msgGuardar, setMsgGuardar] = useState("");

  const tipos: TipoEtiqueta[] = data?.tipos ?? TIPOS_ETIQUETA_DEFAULT;

  const nombreEnCatalogo = useMemo(
    () => tipos.some((t) => t.nombre === value.nombre.trim()),
    [tipos, value.nombre],
  );

  const selectValue = nombreEnCatalogo ? value.nombre.trim() : CUSTOM_KEY;

  const selCls = selectClass || inputClass;
  const triggerClass = dark
    ? selCls || "w-full max-w-[11rem] rounded border border-white/30 bg-white/10 px-1.5 py-1 text-xs text-white focus:border-white focus:outline-none"
    : `${selCls} w-full min-w-[10rem] max-w-[220px]`;

  function seleccionarDelMenu(key: string) {
    setMsgGuardar("");
    if (key === CUSTOM_KEY) {
      if (nombreEnCatalogo) {
        onChange({ nombre: "", anchoMm: value.anchoMm, altoMm: value.altoMm });
      }
      return;
    }
    const t = tipos.find((x) => x.nombre === key);
    if (!t) return;
    onChange({ nombre: t.nombre, anchoMm: t.ancho_mm, altoMm: t.alto_mm });
  }

  function persistirTipos(next: TipoEtiqueta[], onOk?: () => void) {
    guardar.mutate(next, {
      onSuccess: () => {
        onOk?.();
        setMsgGuardar("✓ Guardado");
        setTimeout(() => setMsgGuardar(""), 2000);
      },
      onError: (err: Error) => {
        setMsgGuardar(err?.message?.trim() || "Error al guardar");
      },
    });
  }

  function guardarEnCatalogo() {
    const n = value.nombre.trim();
    if (!n || value.anchoMm <= 0 || value.altoMm <= 0) {
      setMsgGuardar("Completa nombre y medidas");
      return;
    }
    const next = [
      ...tipos.filter((t) => t.nombre !== n),
      {
        nombre: n,
        ancho_mm: Math.round(value.anchoMm * 10) / 10,
        alto_mm: Math.round(value.altoMm * 10) / 10,
      },
    ].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    persistirTipos(next);
  }

  function eliminarDelCatalogo(nombre: string) {
    const next = tipos.filter((t) => t.nombre !== nombre);
    persistirTipos(next, () => {
      if (value.nombre.trim() === nombre) {
        const first = next[0];
        if (first) {
          onChange({ nombre: first.nombre, anchoMm: first.ancho_mm, altoMm: first.alto_mm });
        } else {
          onChange({ nombre: "", anchoMm: value.anchoMm, altoMm: value.altoMm });
        }
      }
    });
  }

  const mmInputClass = compact
    ? `${inputClass} w-14 text-center`
    : `${inputClass} w-16 text-center`;

  const medidasActuales = (
    <span
      className={`shrink-0 tabular-nums ${dark ? "text-[10px] text-white/80" : "text-[10px] font-semibold text-accent"}`}
      title="Medidas actuales"
    >
      {value.anchoMm}×{value.altoMm} mm
    </span>
  );

  const menuDropdown = (
    <MenuFormatoDropdown
      tipos={tipos}
      selectValue={selectValue}
      isLoading={isLoading}
      triggerClass={triggerClass}
      dark={dark}
      compact={compact}
      onSelect={seleccionarDelMenu}
      onDelete={eliminarDelCatalogo}
      deleting={guardar.isPending}
    />
  );

  if (previewBar) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
        <span className="shrink-0 text-xs font-semibold text-ink-secondary">Formato impresión</span>
        <div className="min-w-[10rem] flex-1">
          {menuDropdown}
        </div>
        {medidasActuales}
        {(selectValue === CUSTOM_KEY || !nombreEnCatalogo) && (
          <>
            <input
              type="text"
              value={value.nombre}
              onChange={(e) => {
                setMsgGuardar("");
                onChange({ ...value, nombre: e.target.value });
              }}
              placeholder="Nombre formato"
              className="w-24 rounded-lg border border-border bg-surface-panel px-2 py-1 text-xs"
            />
            <input
              type="number"
              min={1}
              max={108}
              step={0.1}
              value={value.anchoMm}
              onChange={(e) => {
                setMsgGuardar("");
                onChange({ ...value, anchoMm: parseFloat(e.target.value) || 0 });
              }}
              className="w-14 rounded-lg border border-border bg-surface-panel px-1 py-1 text-center text-xs"
              title="Ancho mm"
            />
            <span className="text-[10px] text-muted">×</span>
            <input
              type="number"
              min={1}
              max={406}
              step={0.1}
              value={value.altoMm}
              onChange={(e) => {
                setMsgGuardar("");
                onChange({ ...value, altoMm: parseFloat(e.target.value) || 0 });
              }}
              className="w-14 rounded-lg border border-border bg-surface-panel px-1 py-1 text-center text-xs"
              title="Alto mm"
            />
            <button
              type="button"
              onClick={guardarEnCatalogo}
              disabled={guardar.isPending}
              className="rounded-lg border border-accent px-2 py-1 text-[10px] font-bold text-accent hover:bg-accent hover:text-white disabled:opacity-50"
              title="Guardar en catálogo de formatos"
            >
              💾
            </button>
          </>
        )}
        {msgGuardar && (
          <span className={`text-[10px] font-semibold ${msgGuardar.startsWith("✓") ? "text-accent" : "text-danger"}`}>
            {msgGuardar}
          </span>
        )}
        {nombreEnCatalogo && !msgGuardar && (
          <span className="text-[10px] text-muted">En catálogo</span>
        )}
      </div>
    );
  }

  if (dark) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] opacity-75 shrink-0">Fmt</span>
        {menuDropdown}
        {medidasActuales}
        {(selectValue === CUSTOM_KEY || !nombreEnCatalogo) && (
          <>
            <input
              type="text"
              value={value.nombre}
              onChange={(e) => onChange({ ...value, nombre: e.target.value })}
              placeholder="Nombre"
              className="w-[5rem] rounded border border-white/30 bg-white/10 px-1.5 py-1 text-xs text-white focus:border-white focus:outline-none"
            />
            <input
              type="number"
              min={1}
              max={108}
              step={0.1}
              value={value.anchoMm}
              onChange={(e) => onChange({ ...value, anchoMm: parseFloat(e.target.value) || 0 })}
              className="w-12 rounded border border-white/30 bg-white/10 px-1 py-1 text-xs text-white text-center"
              title="Ancho mm"
            />
            <span className="text-[10px] opacity-60">×</span>
            <input
              type="number"
              min={1}
              max={406}
              step={0.1}
              value={value.altoMm}
              onChange={(e) => onChange({ ...value, altoMm: parseFloat(e.target.value) || 0 })}
              className="w-12 rounded border border-white/30 bg-white/10 px-1 py-1 text-xs text-white text-center"
              title="Alto mm"
            />
            <button
              type="button"
              onClick={guardarEnCatalogo}
              disabled={guardar.isPending}
              className="rounded border border-white/40 px-1.5 py-1 text-[10px] font-bold text-white hover:bg-white/15 disabled:opacity-50"
              title="Guardar en catálogo"
            >
              💾
            </button>
          </>
        )}
      </div>
    );
  }

  if (compact) {
    return (
      <>
        <div>
          <label className={labelClass}>Formato</label>
          {menuDropdown}
        </div>
        <div>
          <label className={labelClass}>Nombre</label>
          <input
            type="text"
            value={value.nombre}
            onChange={(e) => {
              setMsgGuardar("");
              onChange({ ...value, nombre: e.target.value });
            }}
            placeholder="30 mL"
            className={`${inputClass} min-w-[5.5rem]`}
          />
        </div>
        <div>
          <label className={labelClass}>Ancho</label>
          <input
            type="number"
            min={1}
            max={108}
            step={0.1}
            value={value.anchoMm}
            onChange={(e) => {
              setMsgGuardar("");
              onChange({ ...value, anchoMm: parseFloat(e.target.value) || 0 });
            }}
            className={mmInputClass}
            title="Ancho mm"
          />
        </div>
        <div>
          <label className={labelClass}>Alto</label>
          <input
            type="number"
            min={1}
            max={406}
            step={0.1}
            value={value.altoMm}
            onChange={(e) => {
              setMsgGuardar("");
              onChange({ ...value, altoMm: parseFloat(e.target.value) || 0 });
            }}
            className={mmInputClass}
            title="Alto mm"
          />
        </div>
        <div className="flex flex-col justify-end">
          <span className={`${labelClass} mb-0.5 tabular-nums text-accent`}>{value.anchoMm}×{value.altoMm}</span>
          <button
            type="button"
            onClick={guardarEnCatalogo}
            disabled={guardar.isPending}
            className="inline-flex h-9 items-center gap-1 rounded border-2 border-accent px-2 text-[10px] font-bold text-accent hover:bg-accent hover:text-white disabled:opacity-50"
            title="Guardar en catálogo"
          >
            💾 {guardar.isPending ? "…" : msgGuardar || "Guardar"}
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="space-y-2">
      <div>
        <label className={labelClass}>{labelNombre}</label>
        {menuDropdown}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[7rem] flex-1">
          <label className={labelClass}>Nombre</label>
          <input
            type="text"
            value={value.nombre}
            onChange={(e) => {
              setMsgGuardar("");
              onChange({ ...value, nombre: e.target.value });
            }}
            placeholder="30 mL"
            className={`${inputClass} w-full`}
          />
        </div>
        <div>
          <label className={labelClass}>Ancho</label>
          <input
            type="number"
            min={1}
            max={108}
            step={0.1}
            value={value.anchoMm}
            onChange={(e) => {
              setMsgGuardar("");
              onChange({ ...value, anchoMm: parseFloat(e.target.value) || 0 });
            }}
            className={mmInputClass}
            title="Ancho mm"
          />
        </div>
        <div>
          <label className={labelClass}>Alto</label>
          <input
            type="number"
            min={1}
            max={406}
            step={0.1}
            value={value.altoMm}
            onChange={(e) => {
              setMsgGuardar("");
              onChange({ ...value, altoMm: parseFloat(e.target.value) || 0 });
            }}
            className={mmInputClass}
            title="Alto mm"
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className={`${labelClass} invisible select-none`}>·</span>
          <button
            type="button"
            onClick={guardarEnCatalogo}
            disabled={guardar.isPending}
            className="inline-flex h-9 items-center gap-1 rounded border-2 border-accent px-2.5 text-[11px] font-bold text-accent hover:bg-accent hover:text-white disabled:opacity-50"
            title="Guardar en el menú de formatos"
          >
            💾 {guardar.isPending ? "…" : "Guardar"}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {medidasActuales}
        {msgGuardar && (
          <span className={`text-[10px] font-semibold ${msgGuardar.startsWith("✓") ? "text-accent" : "text-danger"}`}>
            {msgGuardar}
          </span>
        )}
        {nombreEnCatalogo && !msgGuardar && (
          <span className="text-[10px] text-muted">En catálogo</span>
        )}
      </div>
    </div>
  );
}
