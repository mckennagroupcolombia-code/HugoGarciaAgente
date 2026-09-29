/**
 * Botón mini para copiar un SKU al portapapeles. Es un <span role="button"> (no <button>) porque
 * a veces va dentro de otro botón (el nodo de la presentación); el clic no llega al de afuera.
 */
import { useState, type KeyboardEvent, type MouseEvent } from "react";

async function copiar(texto: string) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    const t = document.createElement("textarea");
    t.value = texto;
    document.body.appendChild(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
}

export function CopiarSku({ sku, className = "" }: { sku: string; className?: string }) {
  const [hecho, setHecho] = useState(false);
  if (!sku) return null;
  const alCopiar = async (ev: MouseEvent | KeyboardEvent) => {
    ev.stopPropagation();
    ev.preventDefault();
    await copiar(sku);
    setHecho(true);
    window.setTimeout(() => setHecho(false), 1200);
  };
  return (
    <span
      role="button"
      tabIndex={0}
      title={hecho ? "¡Copiado!" : `Copiar ${sku}`}
      aria-label={`Copiar SKU ${sku}`}
      onClick={alCopiar}
      onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && alCopiar(ev)}
      className={`inline-flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-[11px] leading-none opacity-60 hover:bg-ink/10 hover:opacity-100 ${hecho ? "text-accent-leaf opacity-100" : ""} ${className}`}
    >
      {hecho ? "✓" : "⧉"}
    </span>
  );
}
