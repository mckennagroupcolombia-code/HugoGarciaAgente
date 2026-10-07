/**
 * Visor de un documento del expediente: PDF/imagen en un emergente con botón de
 * descarga. Todo pasa por la pasarela GET /api/contabilidad/expediente/documento
 * (ref=tipo:id), así que vale para comprobantes, facturas, extractos, declaraciones…
 * Lo que no está en disco (una factura en Alegra) se muestra con su enlace.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { fetchAuthBlobUrl } from "../../api/client";
import { Icon } from "../../icons";
import type { Documento } from "./tipos";

export function urlDocumento(ref: string, inline = true): string {
  return `/api/contabilidad/expediente/documento?${new URLSearchParams({ ref, ...(inline ? { inline: "1" } : {}) }).toString()}`;
}

export async function descargarDocumento(ref: string, nombre?: string) {
  const url = await fetchAuthBlobUrl(urlDocumento(ref, false));
  if (!url) { window.alert("No se pudo descargar el documento."); return; }
  const a = document.createElement("a");
  a.href = url; a.download = nombre || ref.replace(/[:/]/g, "_");
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function VisorDocumento({ doc, onCerrar }: { doc: Documento; onCerrar: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [estado, setEstado] = useState<"cargando" | "listo" | "error">("cargando");
  const esImagen = (doc.mime || "").startsWith("image/");
  const esPdf = (doc.mime || "").includes("pdf") || /\.pdf$/i.test(doc.archivo || "");

  useEffect(() => {
    let vivo = true;
    let blob: string | null = null;
    (async () => {
      const u = await fetchAuthBlobUrl(urlDocumento(doc.ref));
      if (!vivo) return;
      blob = u;
      setUrl(u);
      setEstado(u ? "listo" : "error");
    })();
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", tecla);
    return () => { vivo = false; window.removeEventListener("keydown", tecla); if (blob) URL.revokeObjectURL(blob); };
  }, [doc.ref, onCerrar]);

  return createPortal(
    <div className="lm-escala fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-3" role="dialog" aria-modal="true" aria-label={doc.titulo} onClick={onCerrar}>
      <div className="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border-2 border-border bg-surface-panel" onClick={(e) => e.stopPropagation()}>
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <span className="min-w-0 flex-1 truncate text-base font-bold text-ink">{doc.titulo}</span>
          {doc.sha256 && <span className="hidden font-mono text-xs text-muted lg:inline" title="SHA-256 del archivo">{doc.sha256.slice(0, 12)}…</span>}
          <button type="button" className="rv-ir" onClick={() => void descargarDocumento(doc.ref, doc.titulo)}>
            <Icon name="download" size={16} weight="bold" /> Descargar
          </button>
          <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-sm font-bold text-ink hover:border-accent" onClick={onCerrar}>Cerrar</button>
        </header>
        <div className="min-h-0 flex-1 bg-surface">
          {estado === "cargando" && <p className="p-6 text-sm text-muted">Abriendo el documento…</p>}
          {estado === "error" && (
            <div className="p-6 text-base text-ink">
              <p>No se pudo abrir. {doc.nota}</p>
              {doc.enlace_externo && (
                <a className="rv-ir mt-3 inline-flex" href={doc.enlace_externo} target="_blank" rel="noopener noreferrer">
                  Abrir en {doc.origen === "alegra" ? "Alegra" : "la fuente"} →
                </a>
              )}
            </div>
          )}
          {estado === "listo" && url && (esImagen
            ? <img src={url} alt={doc.titulo} className="mx-auto max-h-full object-contain" />
            : esPdf
              ? <iframe src={url} title={doc.titulo} className="h-full w-full" />
              : <p className="p-6 text-base text-ink">Este archivo no se previsualiza; usa «Descargar».</p>)}
        </div>
      </div>
    </div>,
    document.body,
  );
}
