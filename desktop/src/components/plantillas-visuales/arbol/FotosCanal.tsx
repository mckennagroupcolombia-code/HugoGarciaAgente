/**
 * Fotos de producto por canal, debajo de su etiqueta: la foto para la web va bajo la etiqueta
 * nítida y la de MeLi bajo la desenfocada. Se copian en el programa donde se hicieron (Blender,
 * ChatGPT, Gemini…) y se pegan con Ctrl+V en la columna elegida.
 *
 * Misma API y misma biblioteca que Espacio de producto → «Fotos y mockups»
 * (`/api/mapa-sistema/fotos-producto`, app/services/fotos_producto.py): FOTOS PRODUCTO/<canal>,
 * registro por SKU. Guardar una foto no la publica en MeLi ni en la web. Las miniaturas se
 * arrastran para cambiar el orden; la primera es la principal.
 */
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fetchAuthBlobUrl } from "../../../api/client";
import { Sprite } from "../../colaboradores/pixel";
import type { Pieza } from "./tipos";

export type Canal = "web" | "meli";
type Foto = { archivo: string; pos?: number; subido_at: string; por?: string; ancho?: number; alto?: number; miniatura?: string };

/** Arrastre interno de una miniatura (para reordenar); no es un archivo que haya que subir. */
const MIME_ORDEN = "application/x-mck-foto-orden";

export function imagenesDe(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const out: File[] = [];
  for (const it of Array.from(dt.items ?? [])) {
    if (it.kind === "file" && it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) out.push(f);
    }
  }
  if (!out.length) for (const f of Array.from(dt.files ?? [])) if (f.type.startsWith("image/")) out.push(f);
  return out;
}

export function useFotosProducto(ref: string, alCambiar?: () => void) {
  const qc = useQueryClient();
  const ruta = `/api/mapa-sistema/fotos-producto/${encodeURIComponent(ref)}`;
  const q = useQuery({
    queryKey: ["fotos-producto", ref],
    queryFn: () => api.get<{ canales: Record<Canal, Foto[]> }>(ruta),
    staleTime: 15_000,
  });
  const [subiendo, setSubiendo] = useState(0);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  useEffect(() => setAviso(null), [ref]);

  const refrescar = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["fotos-producto", ref] });
    void qc.invalidateQueries({ queryKey: ["fotos-producto-resumen"] });
    alCambiar?.();
  }, [qc, ref, alCambiar]);

  const subir = useCallback(
    async (files: File[], canal: Canal) => {
      if (!files.length) return;
      setAviso(null);
      setSubiendo((n) => n + files.length);
      let ok = 0;
      const errores: string[] = [];
      for (const f of files) {
        const form = new FormData();
        form.append("canal", canal);
        form.append("archivo", f, f.name || "pegado.png");
        try {
          await api.upload(ruta, form, { timeoutMs: 60_000 });
          ok += 1;
        } catch (e) {
          errores.push((e as Error).message || "No se pudo guardar");
        } finally {
          setSubiendo((n) => n - 1);
        }
      }
      refrescar();
      const donde = canal === "web" ? "la página web" : "Mercado Libre";
      setAviso(errores.length
        ? { ok: false, texto: `${ok ? `${ok} guardada(s); ` : ""}${errores[0]}` }
        : { ok: true, texto: `${ok === 1 ? "Foto guardada" : `${ok} fotos guardadas`} para ${donde}.` });
    },
    [ruta, refrescar],
  );

  const pegarDelPortapapeles = async (canal: Canal) => {
    try {
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      for (const it of items) {
        const tipo = it.types.find((t) => t.startsWith("image/"));
        if (tipo) files.push(new File([await it.getType(tipo)], `pegado.${tipo.split("/")[1]}`, { type: tipo }));
      }
      if (!files.length) setAviso({ ok: false, texto: "En el portapapeles no hay ninguna imagen. Cópiala primero (Ctrl+C)." });
      else void subir(files, canal);
    } catch {
      setAviso({ ok: false, texto: "El navegador no dejó leer el portapapeles: elige la columna y pega con Ctrl+V." });
    }
  };

  const quitar = async (canal: Canal, f: Foto) => {
    if (!window.confirm("¿Quitar esta foto del producto? Queda guardada en una papelera.")) return;
    try {
      await api.delete(`${ruta}?canal=${canal}&archivo=${encodeURIComponent(f.archivo)}`);
      refrescar();
    } catch (e) {
      setAviso({ ok: false, texto: (e as Error).message || "No se pudo quitar" });
    }
  };

  const reordenar = async (canal: Canal, orden: string[]) => {
    const clave = ["fotos-producto", ref];
    const antes = qc.getQueryData<{ canales: Record<Canal, Foto[]> }>(clave);
    if (antes?.canales?.[canal]) {
      const porNombre = new Map(antes.canales[canal].map((f) => [f.archivo, f]));
      const nuevas = orden.map((a) => porNombre.get(a)).filter((f): f is Foto => Boolean(f));
      qc.setQueryData(clave, { ...antes, canales: { ...antes.canales, [canal]: nuevas } });
    }
    try {
      await api.put(ruta, { canal, orden });
    } catch (e) {
      if (antes) qc.setQueryData(clave, antes);
      setAviso({ ok: false, texto: (e as Error).message || "No se pudo cambiar el orden" });
      return;
    }
    refrescar();
  };

  const urlArchivo = (canal: Canal, f: Foto) => `${ruta}/archivo?canal=${canal}&archivo=${encodeURIComponent(f.archivo)}`;

  return { q, subir, subiendo, aviso, setAviso, pegarDelPortapapeles, quitar, reordenar, urlArchivo };
}

type Hook = ReturnType<typeof useFotosProducto>;

export function FotosCanal({ canal, fotos, pieza, activo, onActivar }: {
  canal: Canal;
  fotos: Hook;
  pieza: Pieza;
  activo: boolean;
  onActivar: () => void;
}) {
  const lista = fotos.q.data?.canales?.[canal] ?? [];
  const info = pieza.canales?.[canal];
  const vieja = Boolean(info?.desactualizada);
  const [ampliada, setAmpliada] = useState<{ url: string; nombre: string } | null>(null);
  const [arrastrada, setArrastrada] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const soltarEn = (destino: string) => {
    const origen = arrastrada;
    setArrastrada(null);
    setSobre(null);
    if (!origen || origen === destino) return;
    const orden = lista.map((f) => f.archivo).filter((a) => a !== origen);
    const i = lista.findIndex((f) => f.archivo === destino);
    const j = lista.findIndex((f) => f.archivo === origen);
    // Hacia adelante se pone antes del destino; hacia atrás, después (como mover una carta).
    const k = orden.indexOf(destino) + (j < i ? 1 : 0);
    orden.splice(k, 0, origen);
    void fotos.reordenar(canal, orden);
  };
  const ampliar = async (f: Foto) => {
    const url = await fetchAuthBlobUrl(fotos.urlArchivo(canal, f));
    if (url) setAmpliada({ url, nombre: f.archivo });
  };
  const cerrar = () => {
    if (ampliada) URL.revokeObjectURL(ampliada.url);
    setAmpliada(null);
  };
  const estado = !lista.length ? "falta" : vieja ? "aviso" : "ok";
  return (
    <section
      role="button"
      tabIndex={0}
      aria-pressed={activo}
      aria-label={`Fotos para ${canal === "web" ? "la página web" : "Mercado Libre"}: pegar con Ctrl+V`}
      onClick={onActivar}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onActivar(); } }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes(MIME_ORDEN)) return;
        onActivar();
        void fotos.subir(imagenesDe(e.dataTransfer), canal);
      }}
      className={`ap-fotos flex min-w-0 cursor-pointer flex-col gap-1.5 p-1.5 ${activo ? "ap-fotos-activo" : ""} ${estado === "falta" ? "ap-fotos-falta" : ""}`}
    >
      <div className="flex items-center gap-1.5">
        <span className={`ap-p ap-p-${estado} h-2.5 w-2.5`} />
        <Sprite s="foto" px={2} />
        <span className="text-[11.5px] font-extrabold">Fotos</span>
        <span className="text-[10.5px] tabular-nums">{lista.length}</span>
        <span className="ap-t ml-auto">{activo ? "Ctrl+V aquí" : "tocar y Ctrl+V"}{lista.length > 1 ? " · arrastra para ordenar" : ""}</span>
      </div>
      {lista.length === 0 ? (
        <div className="flex flex-col items-center gap-1 py-2 text-center">
          <span className="text-[11px] text-ink-secondary">Sin foto del producto con esta etiqueta.</span>
          <button type="button" className="ap-btn ap-btn-sec"
            onClick={(e) => { e.stopPropagation(); onActivar(); void fotos.pegarDelPortapapeles(canal); }}>
            Pegar desde el portapapeles
          </button>
        </div>
      ) : (
        <ul className="grid grid-cols-3 gap-1">
          {lista.map((f, i) => (
            <li key={f.archivo}
              draggable={lista.length > 1}
              onDragStart={(e) => {
                e.stopPropagation();
                e.dataTransfer.setData(MIME_ORDEN, f.archivo);
                e.dataTransfer.effectAllowed = "move";
                setArrastrada(f.archivo);
              }}
              onDragEnd={() => { setArrastrada(null); setSobre(null); }}
              onDragOver={(e) => {
                if (!arrastrada) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "move";
                if (sobre !== f.archivo) setSobre(f.archivo);
              }}
              onDrop={(e) => {
                if (!arrastrada) return;
                e.preventDefault();
                e.stopPropagation();
                soltarEn(f.archivo);
              }}
              className={`group relative ${lista.length > 1 ? "cursor-grab active:cursor-grabbing" : ""} ${arrastrada === f.archivo ? "opacity-40" : ""} ${sobre === f.archivo && arrastrada !== f.archivo ? "outline outline-2 outline-offset-1 outline-accent" : ""}`}>
              <button type="button" title={`${i === 0 ? "Principal · " : ""}${f.ancho && f.alto ? `${f.ancho}×${f.alto} · ` : ""}${new Date(f.subido_at).toLocaleDateString("es-CO")} — ver en grande${lista.length > 1 ? " · arrastra para cambiar el orden" : ""}`}
                onClick={(e) => { e.stopPropagation(); void ampliar(f); }} className="block w-full">
                {i === 0 && lista.length > 1 && (
                  <span className="pointer-events-none absolute left-0 top-0 z-[1] bg-ink px-1 text-[9px] font-extrabold leading-tight text-white">1.ª</span>
                )}
                {f.miniatura
                  ? <img src={`data:image/jpeg;base64,${f.miniatura}`} alt="" draggable={false} className="aspect-square w-full border-2 border-ink bg-white object-contain" />
                  : <span className="block aspect-square w-full bg-surface-hover" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {vieja && <span className="text-[10.5px] font-bold text-ink">La más reciente es anterior a la etiqueta aprobada.</span>}
      {canal === "meli" && lista[0]?.ancho && lista[0]?.alto && Math.min(lista[0].ancho, lista[0].alto) < 500 && (
        <span className="text-[10.5px] font-bold text-ink">MeLi pide mínimo 500 px.</span>
      )}
      {ampliada && createPortal(
        <div role="dialog" aria-modal="true" aria-label="Foto del producto" className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-3 bg-black/70 p-6" onClick={cerrar}>
          <img src={ampliada.url} alt="" className="max-h-[80vh] max-w-full bg-white object-contain" />
          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            <a href={ampliada.url} download={ampliada.nombre} className="rounded-md bg-accent px-3 py-1.5 text-xs font-bold text-white">Descargar</a>
            <button type="button" className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-bold text-ink"
              onClick={() => {
                const f = lista.find((x) => x.archivo === ampliada.nombre);
                cerrar();
                if (f) void fotos.quitar(canal, f);
              }}>Quitar del producto</button>
            <button type="button" className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-bold text-ink" onClick={cerrar}>Cerrar</button>
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}
