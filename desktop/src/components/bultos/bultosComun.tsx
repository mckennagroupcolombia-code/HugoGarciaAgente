import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api/client";
import { Ico } from "../../icons/Ico";
import { useTicketsAuth } from "../../stores/ticketsAuth";

/**
 * Piezas compartidas de «Ubicación de bultos»: tipos, URL de fotos, foto ampliada y el
 * formulario para registrar un bulto (foto + producto + sede/ubicación + cantidad).
 * Backend: app/services/ubicacion_bultos.py (/api/bultos/*). Sin LLM.
 */

export type FotoBulto = { id: number; archivo: string; origen: string; subida_en: number };
export type Bulto = {
  id: number; codigo: string; sku: string; nombre: string;
  cantidad: number | null; unidad: string; lote: string;
  sede: string; ubicacion: string; estado: "en_bodega" | "agotado"; nota: string;
  recepcion_id: number | null; creado_por_nombre: string; creado_en: number; actualizado_en: number;
  fotos: FotoBulto[];
  movimientos?: { accion: string; detalle: string; por_nombre: string; en: number }[];
};
export type ProductoCat = { sku: string; nombre: string; unidad: string };
export type FotoBandeja = {
  origen: "canal" | "recepcion"; ref: string; donde: string; via: string; autor: string;
  texto: string; en: number; recepcion_id?: number; sugeridos?: ProductoCat[];
};

export const SEDES_DEFAULT = ["Principal", "Sede Sur"];

export function useTokenSesion(): string {
  return useTicketsAuth((s) => s.token) || "";
}

export function urlFotoBulto(archivo: string, token: string): string {
  return `/api/bultos/foto/${encodeURIComponent(archivo)}?token=${encodeURIComponent(token)}`;
}

export function urlFotoBandeja(f: Pick<FotoBandeja, "origen" | "ref">, token: string): string {
  return `/api/bultos/por-identificar/${f.origen}/${encodeURIComponent(f.ref)}/foto?token=${encodeURIComponent(token)}`;
}

export const unidadCorta = (u: string) =>
  ({ unit: "und", gram: "g", mililiter: "mL", milliliter: "mL", kilogram: "kg" } as Record<string, string>)[u] ?? u;

export function cantidadTexto(b: Pick<Bulto, "cantidad" | "unidad">): string {
  if (b.cantidad == null) return "";
  return `${Number(b.cantidad).toLocaleString("es-CO", { maximumFractionDigits: 2 })} ${unidadCorta(b.unidad)}`.trim();
}

export function fechaCorta(ts: number): string {
  return new Date(ts * 1000).toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Foto a pantalla completa; se cierra tocando fuera. */
export function FotoAmpliada({ src, pie, onCerrar }: { src: string; pie?: React.ReactNode; onCerrar: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onCerrar]);
  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/75 p-3" onClick={onCerrar}>
      <div className="max-h-full w-full max-w-[min(94vw,820px)] rounded-xl bg-surface-panel p-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt="" className="max-h-[72vh] w-full rounded-lg object-contain" />
        <div className="mt-2 flex items-center gap-2">
          <div className="min-w-0 flex-1 text-[13px] text-ink">{pie}</div>
          <button type="button" onClick={onCerrar} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-white">Cerrar</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Miniatura que se amplía al tocarla. */
export function Miniatura({ src, tam = 64, pie }: { src: string; tam?: number; pie?: React.ReactNode }) {
  const [grande, setGrande] = useState(false);
  const [error, setError] = useState(false);
  return (
    <>
      <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); setGrande(true); }}
        onKeyDown={(e) => { if (e.key === "Enter") setGrande(true); }}
        className="block shrink-0 cursor-zoom-in overflow-hidden rounded-md border border-border bg-white"
        style={{ width: tam, height: tam }}>
        {error
          ? <span className="flex h-full items-center justify-center text-[9px] text-muted">sin foto</span>
          : <img src={src} alt="" loading="lazy" onError={() => setError(true)} className="h-full w-full object-cover" />}
      </span>
      {grande && !error && <FotoAmpliada src={src} pie={pie} onCerrar={() => setGrande(false)} />}
    </>
  );
}

/** Buscador de productos de inventario (copia local de Alegra). */
export function SelectorProducto({ valor, onElegir, sugeridos = [] }: {
  valor: ProductoCat | null; onElegir: (p: ProductoCat | null) => void; sugeridos?: ProductoCat[];
}) {
  const [q, setQ] = useState("");
  const [qDeb, setQDeb] = useState("");
  useEffect(() => { const t = window.setTimeout(() => setQDeb(q.trim()), 250); return () => window.clearTimeout(t); }, [q]);
  const res = useQuery<{ productos: ProductoCat[] }>({
    queryKey: ["bultos-productos", qDeb],
    queryFn: () => api.get(`/api/bultos/productos?q=${encodeURIComponent(qDeb)}`),
    enabled: qDeb.length >= 2,
    staleTime: 60_000,
  });
  if (valor) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-accent bg-accent/10 px-2.5 py-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-bold text-ink">{valor.nombre}</span>
          <code className="text-[11px] text-muted">{valor.sku}</code>
        </span>
        <button type="button" onClick={() => onElegir(null)} className="text-[12px] font-bold text-accent underline">cambiar</button>
      </div>
    );
  }
  const lista = qDeb.length >= 2 ? res.data?.productos ?? [] : [];
  return (
    <div className="space-y-1.5">
      {sugeridos.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <span className="text-[11px] text-muted">¿Es…?</span>
          {sugeridos.map((p) => (
            <button key={p.sku} type="button" onClick={() => onElegir(p)}
              className="rounded-md border border-accent/60 px-2 py-0.5 text-[11.5px] font-bold text-accent">{p.nombre}</button>
          ))}
        </div>
      )}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar el producto: quinua, psyllium, AMI…"
        className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-[13px]" />
      {res.isFetching && <p className="text-[11px] text-muted">Buscando…</p>}
      {lista.length > 0 && (
        <div className="max-h-52 overflow-y-auto rounded-lg border border-border">
          {lista.map((p) => (
            <button key={p.sku} type="button" onClick={() => { onElegir(p); setQ(""); }}
              className="mck-btn-no-fx block w-full border-b border-border px-2.5 py-1.5 text-left last:border-0 hover:bg-accent/10">
              <span className="block text-[12.5px] font-bold text-ink">{p.nombre}</span>
              <code className="text-[10.5px] text-muted">{p.sku}</code>
            </button>
          ))}
        </div>
      )}
      {qDeb.length >= 2 && !res.isFetching && lista.length === 0 && (
        <p className="text-[11.5px] text-muted">Nada con «{qDeb}». Si el producto no existe en el catálogo, se crea antes en «Crear en Alegra».</p>
      )}
    </div>
  );
}

/** Sede + ubicación con autocompletado de los lugares ya usados. */
export function CamposLugar({ sede, ubicacion, onSede, onUbicacion }: {
  sede: string; ubicacion: string; onSede: (s: string) => void; onUbicacion: (u: string) => void;
}) {
  const ub = useQuery<{ ubicaciones: { sede: string; ubicacion: string; n: number }[]; sedes: string[] }>({
    queryKey: ["bultos-ubicaciones"],
    queryFn: () => api.get("/api/bultos/ubicaciones"),
    staleTime: 30_000,
  });
  const sedes = ub.data?.sedes ?? SEDES_DEFAULT;
  const usadas = useMemo(() => (ub.data?.ubicaciones ?? []).filter((u) => u.sede === sede), [ub.data, sede]);
  const idLista = useRef(`ub-${Math.random().toString(36).slice(2)}`).current;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {sedes.map((s) => (
          <button key={s} type="button" onClick={() => onSede(s)}
            className={`rounded-full border px-3 py-1 text-[12.5px] font-bold ${sede === s ? "border-accent bg-accent/10 text-accent" : "border-border text-ink"}`}>{s}</button>
        ))}
      </div>
      <input value={ubicacion} onChange={(e) => onUbicacion(e.target.value)} list={idLista}
        placeholder="¿Dónde quedó? Ej.: Estante B, nivel 2 · Piso junto a la nevera"
        className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-[13px]" />
      <datalist id={idLista}>{usadas.map((u) => <option key={u.ubicacion} value={u.ubicacion} />)}</datalist>
      {usadas.length > 0 && !ubicacion && (
        <div className="flex flex-wrap gap-1">
          {usadas.slice(0, 8).map((u) => (
            <button key={u.ubicacion} type="button" onClick={() => onUbicacion(u.ubicacion)}
              className="rounded-md border border-border px-2 py-0.5 text-[11.5px] text-ink hover:border-accent">{u.ubicacion}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Registrar un bulto. La foto se toma con la cámara o viene de la bandeja «Por
 * identificar» (`fotoBandeja`), en cuyo caso sale de la bandeja al guardar.
 */
export function FormularioBulto({ fotoBandeja, productoInicial, recepcionId, onListo, onCancelar }: {
  fotoBandeja?: FotoBandeja | null;
  productoInicial?: ProductoCat | null;
  recepcionId?: number | null;
  onListo: (b: Bulto) => void;
  onCancelar: () => void;
}) {
  const token = useTokenSesion();
  const input = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [producto, setProducto] = useState<ProductoCat | null>(productoInicial ?? null);
  const [sede, setSede] = useState(() => {
    try { return localStorage.getItem("mck-bultos-sede") || SEDES_DEFAULT[0]; } catch { return SEDES_DEFAULT[0]; }
  });
  const [ubicacion, setUbicacion] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [lote, setLote] = useState("");
  const [nota, setNota] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const elegirFoto = (f?: File) => {
    if (!f) return;
    setArchivo(f);
    setPreview(URL.createObjectURL(f));
  };

  const fotoSrc = fotoBandeja ? urlFotoBandeja(fotoBandeja, token) : preview;
  const listo = Boolean((archivo || fotoBandeja) && producto && ubicacion.trim());

  async function guardar() {
    if (!producto) return;
    setGuardando(true); setError("");
    try {
      try { localStorage.setItem("mck-bultos-sede", sede); } catch { /* sin almacenamiento */ }
      const campos: Record<string, string> = {
        sku: producto.sku, sede, ubicacion, cantidad, unidad: producto.unidad, lote, nota,
        ...(recepcionId ? { recepcion_id: String(recepcionId) } : {}),
      };
      let b: Bulto & { error?: string };
      if (archivo) {
        const form = new FormData();
        Object.entries(campos).forEach(([k, v]) => form.append(k, v));
        form.append("foto", archivo);
        b = await api.upload<Bulto & { error?: string }>("/api/bultos", form, { timeoutMs: 120_000 });
      } else {
        b = await api.post<Bulto & { error?: string }>("/api/bultos", {
          ...campos, foto_origen: fotoBandeja?.origen, foto_ref: fotoBandeja?.ref,
        });
      }
      if (b.error) throw new Error(b.error);
      onListo(b);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border-2 border-accent/50 bg-surface-panel p-3">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[14px] font-extrabold text-ink">
          {fotoBandeja ? "Identificar esta foto" : "Registrar un bulto"}
        </p>
        <button type="button" onClick={onCancelar} className="text-[12px] text-muted underline">cancelar</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <div>
          {fotoSrc ? (
            <Miniatura src={fotoSrc} tam={160} />
          ) : (
            <button type="button" onClick={() => input.current?.click()}
              className="flex h-40 w-40 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-accent/60 bg-accent/5 text-[12.5px] font-bold text-accent">
              <Ico e="📷" className="text-2xl" />Tomar foto del bulto
            </button>
          )}
          {!fotoBandeja && fotoSrc && (
            <button type="button" onClick={() => input.current?.click()} className="mt-1 text-[11.5px] text-accent underline">otra foto</button>
          )}
          <input ref={input} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => elegirFoto(e.target.files?.[0] ?? undefined)} />
          {fotoBandeja && (
            <p className="mt-1 text-[11px] text-muted">
              {fotoBandeja.via} · {fotoBandeja.donde}{fotoBandeja.autor ? ` · ${fotoBandeja.autor}` : ""}
              {fotoBandeja.texto ? <><br />«{fotoBandeja.texto.slice(0, 140)}»</> : null}
            </p>
          )}
        </div>

        <div className="min-w-0 space-y-3">
          <label className="block space-y-1">
            <span className="text-[11px] font-bold uppercase text-muted">1 · ¿Qué producto es?</span>
            <SelectorProducto valor={producto} onElegir={setProducto} sugeridos={fotoBandeja?.sugeridos ?? []} />
          </label>
          <div className="space-y-1">
            <span className="text-[11px] font-bold uppercase text-muted">2 · ¿Dónde quedó?</span>
            <CamposLugar sede={sede} ubicacion={ubicacion} onSede={setSede} onUbicacion={setUbicacion} />
          </div>
          <div className="space-y-1">
            <span className="text-[11px] font-bold uppercase text-muted">3 · Opcional</span>
            <div className="flex flex-wrap gap-1.5">
              <input value={cantidad} onChange={(e) => setCantidad(e.target.value)} inputMode="decimal"
                placeholder={`Cantidad${producto ? ` (${unidadCorta(producto.unidad)})` : ""}`}
                className="w-36 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12.5px]" />
              <input value={lote} onChange={(e) => setLote(e.target.value)} placeholder="Lote"
                className="w-28 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12.5px]" />
              <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota (ej. saco abierto)"
                className="min-w-[10rem] flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12.5px]" />
            </div>
          </div>
        </div>
      </div>

      {error && <p className="rounded-md bg-red-500/10 px-2 py-1 text-[12px] text-red-600">{error}</p>}
      <button type="button" disabled={!listo || guardando} onClick={() => void guardar()}
        className="w-full rounded-lg bg-accent px-3 py-2.5 text-[14px] font-bold text-white disabled:opacity-50">
        {guardando ? "Guardando…" : listo ? "Guardar bulto" : "Falta: " + [
          !(archivo || fotoBandeja) && "foto", !producto && "producto", !ubicacion.trim() && "ubicación",
        ].filter(Boolean).join(", ")}
      </button>
    </div>
  );
}
