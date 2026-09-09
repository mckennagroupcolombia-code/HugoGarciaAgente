/**
 * Estado compartido del menú de tipografía por casilla: qué campo tiene el
 * menú abierto ahora mismo y qué overrides de tamaño/fuente tiene cada uno
 * (por `styleKey`, ej. "origin", "productName"). Contexto en vez de pasar
 * props por cada componente intermedio — son ~17 casillas repartidas en 10
 * archivos distintos.
 */
import { createContext, useContext, useState, type ReactNode } from "react";

export interface TextStyleOverride {
  fontSize?: number;
  fontFamily?: string;
}

interface TextStyleCtx {
  estilos: Record<string, TextStyleOverride>;
  setEstilo: (key: string, patch: TextStyleOverride) => void;
  abierto: string | null;
  setAbierto: (key: string | null) => void;
}

const Ctx = createContext<TextStyleCtx | null>(null);

export function TextStyleProvider({ children }: { children: ReactNode }) {
  const [estilos, setEstilos] = useState<Record<string, TextStyleOverride>>({});
  const [abierto, setAbierto] = useState<string | null>(null);

  const setEstilo = (key: string, patch: TextStyleOverride) =>
    setEstilos((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  return <Ctx.Provider value={{ estilos, setEstilo, abierto, setAbierto }}>{children}</Ctx.Provider>;
}

export function useTextStyleCtx(): TextStyleCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTextStyleCtx debe usarse dentro de <TextStyleProvider>");
  return ctx;
}

export const FUENTES_DISPONIBLES: { value: string; label: string }[] = [
  { value: "", label: "Montserrat (por defecto)" },
  { value: "Arial, Helvetica, sans-serif", label: "Arial" },
  { value: "Georgia, 'Times New Roman', serif", label: "Georgia" },
  { value: "'Courier New', monospace", label: "Monoespaciada" },
];
