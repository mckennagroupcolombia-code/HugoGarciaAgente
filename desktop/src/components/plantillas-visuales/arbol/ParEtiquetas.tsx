/**
 * El par de etiquetas de una presentación: la nítida (página web, ETIQUETAS STUDIO) y la
 * desenfocada (Mercado Libre, PUBLICACIONES DIGITALES). Con las dos se hace la foto de
 * producto: mockup en Blender o imagen con ChatGPT / Gemini. Por eso cada una se copia al
 * portapapeles o se descarga desde aquí, lado a lado.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { resolverUrlImagenCanvas } from "../../../lib/plantillasVisualesImagen";
import { descargarBlob } from "../../../lib/etiquetaAssets";
import { codificarRutaRecursoPng } from "../../etiquetas/RecursoPngViewer";
import { BTN, BTN_SEC } from "../../combos/comun";
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

/** Una variante con su imagen y sus dos acciones. `grande` = modal de la foto de producto. */
export function VarianteEtiqueta({ p, v, grande, onAviso, onCrear }: {
  p: Presentacion;
  v: Variante;
  grande?: boolean;
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
        <span className={`whitespace-nowrap font-bold text-ink ${grande ? "text-sm" : "text-[12px]"}`}>{grande ? meta.titulo : meta.id === "web" ? "Web" : "MeLi"}</span>
        <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">{meta.sub}</span>
      </div>
      <button
        type="button"
        onClick={() => src && setAmpliar(true)}
        disabled={!src}
        title={ruta || "Sin PNG aprobado"}
        className={`mck-arbol-damero flex items-center justify-center rounded-md border border-border p-2 ${grande ? "h-[min(44vh,420px)]" : "h-28"}`}
      >
        {src ? (
          <img src={src} alt={`${p.nombre} · ${meta.titulo}`} className="max-h-full max-w-full object-contain" draggable={false} />
        ) : (
          <span className="px-2 text-center text-[11px] text-muted">{!ruta ? "Sin PNG aprobado" : fallo ? "No se pudo cargar" : "Cargando…"}</span>
        )}
      </button>
      {grande && ruta && <code className="truncate text-[10.5px] text-muted" title={ruta}>{ruta}</code>}
      {ruta ? (
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" className={BTN} onClick={async () => onAviso(await copiarPng(ruta))}>Copiar imagen</button>
          <button type="button" className={BTN_SEC} onClick={() => descargarPng(ruta).catch((e) => onAviso((e as Error).message))}>Descargar</button>
        </div>
      ) : onCrear ? (
        <button type="button" className={BTN_SEC} onClick={onCrear}>Resolver en el taller →</button>
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

const INDICACION = (p: Presentacion) =>
  `Foto de producto sobre fondo blanco: el empaque de ${p.nombre} con esta etiqueta pegada al frente, tal cual, sin cambiar textos, colores ni el código de barras. Luz suave de estudio y sombra corta.`;

/** Modal «para la foto de producto»: las dos variantes en grande, las hermanas a un toque. */
export function ParEtiquetasModal({ hermanas, inicial, onCerrar }: {
  hermanas: Presentacion[];
  inicial: string;
  onCerrar: () => void;
}) {
  const [ref, setRef] = useState(inicial);
  const p = hermanas.find((h) => h.ref === ref) ?? hermanas[0];
  const [aviso, setAviso] = useState<string | null>(null);
  const [indicacion, setIndicacion] = useState(() => INDICACION(p));
  useEffect(() => setIndicacion(INDICACION(p)), [p]);
  useEffect(() => {
    const t = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", t);
    return () => window.removeEventListener("keydown", t);
  }, [onCerrar]);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 4000);
    return () => clearTimeout(t);
  }, [aviso]);
  const copiarTexto = async () => {
    try {
      await navigator.clipboard.writeText(indicacion);
      setAviso("Indicación copiada. Pégala junto con la etiqueta.");
    } catch {
      setAviso("No se pudo copiar el texto.");
    }
  };
  const ambas = [p.piezas.etiquetas.png, p.piezas.etiquetas.png_digital].filter(Boolean) as string[];
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="El par de etiquetas" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-3 sm:p-6" onClick={onCerrar}>
      <div className="flex max-h-full w-full max-w-[1280px] flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-surface-panel p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">Para la foto de producto</p>
            <h2 className="truncate text-lg font-bold text-ink">{p.nombre} <code className="text-xs font-normal text-ink-secondary">{p.ref}</code></h2>
          </div>
          {hermanas.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {hermanas.map((h) => (
                <button key={h.ref} type="button" onClick={() => setRef(h.ref)} aria-pressed={h.ref === p.ref}
                  className={`rounded-md border px-2.5 py-1 text-[12px] font-bold ${h.ref === p.ref ? "border-accent bg-accent text-white" : "border-border bg-surface text-ink-secondary hover:text-ink"}`}>
                  {h.corto}
                </button>
              ))}
            </div>
          )}
          <button type="button" className={BTN_SEC} onClick={onCerrar}>Cerrar ✕</button>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {VARIANTES.map((v) => <VarianteEtiqueta key={v.id + p.ref} p={p} v={v.id} grande onAviso={setAviso} />)}
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_2fr]">
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
            <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">Mockup en Blender</p>
            <p className="text-[12.5px] text-ink-secondary">Las dos como textura, una para la foto de la web y otra para la de MeLi, con el mismo encuadre.</p>
            <button type="button" className={BTN} disabled={!ambas.length}
              onClick={async () => { for (const r of ambas) await descargarPng(r).catch(() => null); }}>
              Descargar las dos
            </button>
          </div>
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
            <label htmlFor="arbol-indicacion" className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">Indicación para ChatGPT o Gemini (va con la imagen copiada)</label>
            <textarea id="arbol-indicacion" rows={3} value={indicacion} onChange={(e) => setIndicacion(e.target.value)}
              className="w-full resize-none rounded-md border border-border bg-surface-input p-2 text-[12.5px] text-ink" />
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className={BTN} onClick={() => void copiarTexto()}>Copiar indicación</button>
              <span className="self-center text-[11px] text-muted">Pega primero la imagen (web o MeLi) y después el texto.</span>
            </div>
          </div>
        </div>
        {p.foto_estado && p.foto_estado !== "ok" && (
          <p className="rounded-md border border-accent-sun/60 bg-accent-sun/15 px-3 py-2 text-[12.5px] text-ink">
            Foto actual de la vitrina: {p.foto_motivo || "por actualizar"} La nueva se sube en Publicaciones (web y MeLi).
          </p>
        )}
        {aviso && <p role="status" className="rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-[12.5px] text-ink">{aviso}</p>}
      </div>
    </div>,
    document.body,
  );
}
