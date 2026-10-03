/**
 * El par de etiquetas de una presentación: la nítida (página web, ETIQUETAS STUDIO) y la
 * desenfocada (Mercado Libre, PUBLICACIONES DIGITALES). Con las dos se hace la foto de
 * producto: mockup en Blender o imagen con ChatGPT / Gemini. Cada una se copia al
 * portapapeles o se descarga; tocar la miniatura la abre en grande.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { resolverUrlImagenCanvas } from "../../../lib/plantillasVisualesImagen";
import { descargarBlob } from "../../../lib/etiquetaAssets";
import { codificarRutaRecursoPng } from "../../etiquetas/RecursoPngViewer";
import { Sprite } from "../../colaboradores/pixel";
import type { Presentacion } from "./tipos";

type Variante = "web" | "meli";

export const VARIANTES: { id: Variante; titulo: string; sub: string }[] = [
  { id: "web", titulo: "Página web", sub: "nítida" },
  { id: "meli", titulo: "Mercado Libre", sub: "desenfocada" },
];

export function rutaVariante(p: Presentacion, v: Variante): string {
  const e = p.piezas.etiquetas;
  return (v === "web" ? e.png : e.png_digital) || "";
}

function urlArchivo(ruta: string) {
  return `/api/etiquetas/recursos-png/archivo/${codificarRutaRecursoPng(ruta)}`;
}

function usePng(ruta: string) {
  const [src, setSrc] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);
  useEffect(() => {
    setSrc(null);
    setFallo(false);
    if (!ruta) return;
    let vivo = true;
    resolverUrlImagenCanvas(urlArchivo(ruta))
      .then((u) => vivo && setSrc(u))
      .catch(() => vivo && setFallo(true));
    return () => {
      vivo = false;
    };
  }, [ruta]);
  return { src, fallo };
}

async function blobDe(ruta: string): Promise<Blob> {
  const url = await resolverUrlImagenCanvas(urlArchivo(ruta));
  const res = await fetch(url);
  if (!res.ok) throw new Error("No se pudo leer el PNG");
  const b = await res.blob();
  return b.type === "image/png" ? b : new Blob([b], { type: "image/png" });
}

export async function copiarPng(ruta: string): Promise<string> {
  if (!ruta) return "No hay PNG para copiar.";
  if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
    return "Este navegador no deja copiar imágenes: usa «Descargar».";
  }
  try {
    const blob = await blobDe(ruta);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return "Copiada: pégala en Blender, ChatGPT o Gemini.";
  } catch (e) {
    return `No se pudo copiar (${(e as Error).message}). Usa «Descargar».`;
  }
}

export async function descargarPng(ruta: string): Promise<void> {
  if (!ruta) return;
  descargarBlob(await blobDe(ruta), ruta.split("/").pop() || "etiqueta.png");
}

/** Una variante con su imagen y sus dos acciones; la miniatura se abre en grande. */
export function VarianteEtiqueta({ p, v, onAviso, onCrear }: {
  p: Presentacion;
  v: Variante;
  onAviso: (t: string) => void;
  onCrear?: () => void;
}) {
  const ruta = rutaVariante(p, v);
  const { src, fallo } = usePng(ruta);
  const meta = VARIANTES.find((x) => x.id === v)!;
  const [ampliar, setAmpliar] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="flex items-center gap-1.5 whitespace-nowrap text-[12px] font-extrabold"><Sprite s={meta.id === "web" ? "ventana" : "estrella"} px={2} />{meta.id === "web" ? "Página web" : "Mercado Libre"}</span>
        <span className="ap-t">{meta.sub}</span>
      </div>
      <button
        type="button"
        onClick={() => src && setAmpliar(true)}
        disabled={!src}
        title={ruta || "Sin PNG aprobado"}
        className="ap-damero flex h-28 items-center justify-center p-2"
      >
        {src ? (
          <img src={src} alt={`${p.nombre} · ${meta.titulo}`} className="max-h-full max-w-full object-contain" draggable={false} />
        ) : (
          <span className="px-2 text-center text-[11px] font-bold">{!ruta ? "Sin PNG aprobado" : fallo ? "No se pudo cargar" : "Cargando…"}</span>
        )}
      </button>
      {ruta ? (
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" className="ap-btn" onClick={async () => onAviso(await copiarPng(ruta))}>Copiar</button>
          <button type="button" className="ap-btn ap-btn-sec" onClick={() => descargarPng(ruta).catch((e) => onAviso((e as Error).message))}>Bajar</button>
        </div>
      ) : onCrear ? (
        <button type="button" className="ap-btn ap-btn-amarillo" onClick={onCrear}>Crear la etiqueta →</button>
      ) : null}
      {ampliar && src && createPortal(
        <div role="dialog" aria-modal="true" aria-label={meta.titulo} onClick={() => setAmpliar(false)}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-6">
          <img src={src} alt={meta.titulo} className="max-h-full max-w-full bg-white object-contain" />
        </div>,
        document.body,
      )}
    </div>
  );
}
