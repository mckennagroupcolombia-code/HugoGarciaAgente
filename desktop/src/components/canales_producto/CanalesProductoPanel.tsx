import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import ListaSkus from "./ListaSkus";
import TableroCanales from "./TableroCanales";
import VistaCategorias from "./VistaCategorias";
import { CLASIF, ORDEN_CLASIF, type Clasificacion, type Tabla } from "./tipos";

/**
 * Canales del producto — cada SKU de venta en todos sus canales a la vez.
 *
 * Inventario (Alegra) → receta → documento/EAN/etiqueta → MeLi → web → factura.
 * Solo diagnóstico: lee /api/canales-producto/tabla (caches locales, sin llamadas
 * vivas); cada problema lleva al apartado donde se corrige. La única consulta viva
 * es «Verificar facturación en vivo», por SKU.
 */

type Filtro = Clasificacion | "problemas" | "todos";
const CLAVE_SKU = "mck-canales-sku";

function edad(iso: string | null | undefined): string {
  if (!iso) return "sin dato";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(s)) return iso;
  if (s < 3600) return `hace ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

function useAltoDisponible<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [alto, setAlto] = useState<number | null>(null);
  useLayoutEffect(() => {
    const medir = () => {
      const el = ref.current;
      if (!el) return;
      setAlto(window.innerWidth < 1024 ? null : Math.max(440, Math.floor(window.innerHeight - el.getBoundingClientRect().top - 10)));
    };
    medir();
    window.addEventListener("resize", medir);
    const ro = new ResizeObserver(medir);
    ro.observe(document.body);
    return () => {
      window.removeEventListener("resize", medir);
      ro.disconnect();
    };
  }, []);
  return { ref, alto };
}

export default function CanalesProductoPanel() {
  const qc = useQueryClient();
  const [vista, setVista] = useState<"skus" | "categorias">("skus");
  const [refrescando, setRefrescando] = useState(false);
  const datos = useQuery({
    queryKey: ["canales-producto-tabla"],
    queryFn: () => api.get<Tabla>("/api/canales-producto/tabla", { timeoutMs: 60_000 }),
    refetchInterval: 120_000,
  });

  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("problemas");
  const [sku, setSku] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(CLAVE_SKU);
    } catch {
      return null;
    }
  });
  const [pieza, setPieza] = useState<string | null>(null);

  const rango = (c: Clasificacion) => ORDEN_CLASIF.indexOf(c);
  const lista = useMemo(() => {
    const t = q.trim().toUpperCase();
    return (datos.data?.filas ?? [])
      .filter((f) => {
        if (f.sku === sku) return true; // el caso en curso nunca sale de la cola
        const pasa = filtro === "todos" ? true : filtro === "problemas" ? f.clasificacion !== "completo" : f.clasificacion === filtro;
        return pasa && (!t || f.nombre.toUpperCase().includes(t) || f.sku.toUpperCase().includes(t));
      })
      .sort((a, b) => rango(a.clasificacion) - rango(b.clasificacion) || a.nombre.localeCompare(b.nombre, "es", { numeric: true }));
  }, [datos.data, q, filtro, sku]); // eslint-disable-line react-hooks/exhaustive-deps

  const actual = useMemo(() => lista.find((f) => f.sku === sku) ?? lista[0] ?? null, [lista, sku]);
  const pos = actual ? lista.indexOf(actual) : -1;

  useEffect(() => {
    try {
      if (actual) sessionStorage.setItem(CLAVE_SKU, actual.sku);
    } catch {
      /* sin almacenamiento */
    }
  }, [actual]);

  const mover = (d: number) => {
    if (!lista.length) return;
    const i = (pos + d + lista.length) % lista.length;
    setSku(lista[i].sku);
    setPieza(null);
  };

  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (vista !== "skus") return;
      if (ev.key === "ArrowRight") mover(1);
      if (ev.key === "ArrowLeft") mover(-1);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  const refrescar = async () => {
    setRefrescando(true);
    try {
      await api.post("/api/canales-producto/invalidar");
      await qc.invalidateQueries({ queryKey: ["canales-producto-tabla"] });
      await qc.invalidateQueries({ queryKey: ["canales-producto-categorias"] });
    } finally {
      setRefrescando(false);
    }
  };

  const { ref: contRef, alto } = useAltoDisponible<HTMLDivElement>();
  const d = datos.data;

  return (
    <div className="mx-auto flex w-full max-w-[1760px] flex-col gap-2">
      {/* Marcador: cada clasificación es un filtro */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface-panel p-2">
        <div className="mr-2 flex gap-1">
          {(["skus", "categorias"] as const).map((v) => (
            <button key={v} onClick={() => setVista(v)} aria-pressed={vista === v}
              className={`mck-hub-tab rounded-md border px-2 py-1 text-[11.5px] font-bold ${vista === v ? "border-accent bg-accent text-white" : "border-border bg-surface-input text-ink"}`}>
              {v === "skus" ? "Por SKU" : "Categorías"}
            </button>
          ))}
        </div>
        {d && ORDEN_CLASIF.map((c) => (
          <button key={c} onClick={() => { setVista("skus"); setFiltro(c); }} title={CLASIF[c].ayuda}
            className={`mck-flujo-nodo flex items-center gap-1.5 rounded-lg border px-2 py-1 text-left ${filtro === c && vista === "skus" ? "border-accent" : "border-border"} bg-surface-input`}>
            <span className={`rounded-full px-1.5 font-mono text-[11px] font-bold tabular-nums ${CLASIF[c].tono}`}>{d.resumen[c] ?? 0}</span>
            <span className="text-[10.5px] font-bold text-ink">{CLASIF[c].nombre}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {d && (
            <span className="font-mono text-[9.5px] text-muted" title="Edad de cada fuente: el panel solo lee copias locales">
              Alegra {edad(d.fuentes.alegra?.synced_at)} · MeLi {edad(d.fuentes.relacion_meli?.actualizado_en)} · web {edad(d.fuentes.web_cache?.mtime)}
            </span>
          )}
          <button onClick={refrescar} disabled={refrescando}
            className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-ink hover:bg-surface-hover disabled:opacity-50">
            {refrescando ? "Recalculando…" : "Recalcular"}
          </button>
        </div>
      </div>

      {d && d.sin_senal.length > 0 && (
        <div className="rounded-lg border border-accent-sun/60 bg-accent-sun/10 px-3 py-1.5 text-[11.5px] text-ink">
          Sin señal de: {d.sin_senal.map((s) => s.fuente).join(", ")}. La tabla se armó con el resto; esos canales pueden verse vacíos.
        </div>
      )}
      {d?.fuentes.alegra?.stale && (
        <div className="rounded-lg border border-accent-sun/60 bg-accent-sun/10 px-3 py-1.5 text-[11.5px] text-ink">
          La copia local de Alegra tiene más de un día. Sincronízala en Catálogo Alegra para que «se puede facturar» sea fiable.
        </div>
      )}

      {datos.isLoading && <p className="text-xs text-muted">Cruzando Alegra, MercadoLibre y la tienda web…</p>}
      {datos.isError && <div className="rounded-lg border border-accent-rose/40 bg-accent-rose/10 px-3 py-2 text-xs text-ink">No se pudo armar la tabla: {(datos.error as Error)?.message}</div>}

      {d && vista === "skus" && (
        <div ref={contRef} style={alto ? { height: alto } : undefined} className="grid min-h-0 gap-2 lg:grid-cols-[320px_1fr]">
          <ListaSkus
            filas={lista}
            total={d.total}
            actual={actual?.sku ?? null}
            q={q}
            setQ={setQ}
            filtro={filtro}
            setFiltro={setFiltro}
            resumen={d.resumen}
            onElegir={(s, p) => { setSku(s); setPieza(p ?? null); }}
          />
          {actual ? (
            <TableroCanales
              key={actual.sku}
              fila={actual}
              pieza={pieza}
              setPieza={setPieza}
              onAnterior={() => mover(-1)}
              onSiguiente={() => mover(1)}
              posicion={`${pos + 1} / ${lista.length}`}
            />
          ) : (
            <div className="rounded-xl border border-border bg-surface-panel p-6 text-[12px] text-muted">Nada que mostrar con ese filtro.</div>
          )}
        </div>
      )}
      {vista === "categorias" && <VistaCategorias />}
    </div>
  );
}
