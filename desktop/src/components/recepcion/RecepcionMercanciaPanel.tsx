import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { api } from "../../api/client";
import { useTicketsAuth } from "../../stores/ticketsAuth";
import FotoInsumo from "../insumos/FotoInsumo";
import InsumosVista from "../insumos/InsumosVista";

/**
 * Recepción de mercancía — lo que llega a bodega, con fotos y conteo contra lo esperado.
 * Reemplaza el aviso suelto en el grupo de WhatsApp. Backend: app/services/recepcion_mercancia.py.
 * No escribe inventario ni contabilidad: solo registra la llegada y sus diferencias.
 */

type Item = {
  id: number;
  sku: string;
  descripcion: string;
  unidad: string;
  cantidad_esperada: number | null;
  cantidad_recibida: number | null;
  estado_item: "pendiente" | "ok" | "faltante" | "sobrante" | "danado";
  observacion: string;
};
type Foto = { id: number; archivo: string; nombre: string };
type Recepcion = {
  id: number;
  proveedor: string;
  referencia: string;
  origen: string;
  estado: "abierta" | "verificada" | "con_diferencias" | "anulada";
  notas: string;
  recibido_por_nombre: string;
  creada_en: number;
  cerrada_en: number | null;
  items?: Item[];
  fotos?: Foto[];
  resumen: { total: number; contados: number; diferencias: number; fotos?: number };
};
type Compra = { id: number; concepto: string; fecha: string; estado: string; factura_numero: string; monto: number };

const ESTADO: Record<Recepcion["estado"], { txt: string; tono: string }> = {
  abierta: { txt: "Abierta", tono: "bg-accent-sun/30 text-ink" },
  verificada: { txt: "Verificada", tono: "bg-accent-leaf text-white" },
  con_diferencias: { txt: "Con diferencias", tono: "bg-accent-rose text-white" },
  anulada: { txt: "Anulada", tono: "bg-surface text-muted" },
};
const ITEM: Record<Item["estado_item"], { txt: string; tono: string }> = {
  pendiente: { txt: "Por contar", tono: "text-muted" },
  ok: { txt: "Completo", tono: "text-accent-leaf" },
  faltante: { txt: "Faltó", tono: "text-accent-rose" },
  sobrante: { txt: "Sobró", tono: "text-accent-sun" },
  danado: { txt: "Dañado", tono: "text-accent-rose" },
};

function fecha(ts: number) {
  return new Date(ts * 1000).toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function Nueva({ onCreada, onCancelar }: { onCreada: (r: Recepcion) => void; onCancelar: () => void }) {
  const compras = useQuery<{ compras: Compra[] }>({
    queryKey: ["recepciones-compras"],
    queryFn: () => api.get("/api/recepciones/compras-por-recibir"),
  });
  const [compra, setCompra] = useState<number | "">("");
  const [proveedor, setProveedor] = useState("");
  const [referencia, setReferencia] = useState("");
  const [items, setItems] = useState<{ descripcion: string; cantidad_esperada: string; unidad: string }[]>([
    { descripcion: "", cantidad_esperada: "", unidad: "" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const crear = async () => {
    setGuardando(true);
    setError(null);
    try {
      const r = await api.post<Recepcion>("/api/recepciones", {
        solicitud_pago_id: compra || null,
        proveedor,
        referencia,
        items: compra ? [] : items.filter((i) => i.descripcion.trim()).map((i) => ({
          descripcion: i.descripcion, unidad: i.unidad, cantidad_esperada: i.cantidad_esperada || null,
        })),
      });
      onCreada(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <h3 className="text-[15px] font-bold text-ink">¿Qué llegó?</h3>
      <label className="block text-[12px] text-ink">
        Compra que llega (si ya está en Solicitudes de pago)
        <select value={compra} onChange={(e) => setCompra(e.target.value ? Number(e.target.value) : "")}
          className="mt-1 w-full rounded-md border border-border bg-surface-input px-2 py-2 text-[13px]">
          <option value="">— No está / llegó sin compra registrada —</option>
          {(compras.data?.compras ?? []).map((c) => (
            <option key={c.id} value={c.id}>{c.concepto}{c.fecha ? ` · ${c.fecha}` : ""}</option>
          ))}
        </select>
      </label>
      {compra ? (
        <p className="rounded-md bg-accent/10 px-3 py-2 text-[12px] text-ink">Los productos y cantidades esperadas se cargan de esa compra.</p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={proveedor} onChange={(e) => setProveedor(e.target.value)} placeholder="Proveedor"
              className="rounded-md border border-border bg-surface-input px-2 py-2 text-[13px]" />
            <input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Factura o remisión (opcional)"
              className="rounded-md border border-border bg-surface-input px-2 py-2 text-[13px]" />
          </div>
          <div className="space-y-1.5">
            <p className="text-[12px] font-bold text-ink">Productos</p>
            {items.map((it, i) => (
              <div key={i} className="flex gap-1.5">
                <input value={it.descripcion} placeholder="Producto" onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, descripcion: e.target.value } : x))}
                  className="min-w-0 flex-1 rounded-md border border-border bg-surface-input px-2 py-1.5 text-[13px]" />
                <input value={it.cantidad_esperada} placeholder="Cant." inputMode="decimal" onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, cantidad_esperada: e.target.value } : x))}
                  className="w-20 rounded-md border border-border bg-surface-input px-2 py-1.5 text-[13px]" />
                <input value={it.unidad} placeholder="Und." onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, unidad: e.target.value } : x))}
                  className="w-16 rounded-md border border-border bg-surface-input px-2 py-1.5 text-[13px]" />
              </div>
            ))}
            <button onClick={() => setItems([...items, { descripcion: "", cantidad_esperada: "", unidad: "" }])}
              className="text-[12px] text-accent underline">+ otro producto</button>
          </div>
        </>
      )}
      {error && <p className="text-[12px] text-accent-rose">{error}</p>}
      <div className="flex gap-2">
        <button onClick={() => void crear()} disabled={guardando || (!compra && !proveedor.trim())}
          className="rounded-md bg-accent px-3 py-2 text-[13px] font-bold text-white disabled:opacity-50">
          {guardando ? "Abriendo…" : "Abrir recepción"}
        </button>
        <button onClick={onCancelar} className="rounded-md border border-border px-3 py-2 text-[13px]">Cancelar</button>
      </div>
    </div>
  );
}

function FilaItem({ r, it, onCambio }: { r: Recepcion; it: Item; onCambio: () => void }) {
  const [cant, setCant] = useState(it.cantidad_recibida != null ? String(it.cantidad_recibida) : "");
  const abierta = r.estado === "abierta";
  const guardar = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/api/recepciones/${r.id}/items/${it.id}`, body),
    onSuccess: onCambio,
  });
  const e = ITEM[it.estado_item];
  return (
    <div className="rounded-lg border border-border bg-surface-input p-2">
      <div className="flex items-start gap-2">
        {it.sku && <FotoInsumo sku={it.sku} tam={44} />}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-ink">{it.descripcion}</p>
          <p className="text-[11px] text-muted">
            {it.sku && <code className="mr-1">{it.sku}</code>}
            Esperado: {it.cantidad_esperada ?? "—"} {it.unidad}
          </p>
        </div>
        <span className={`shrink-0 text-[11.5px] font-bold ${e.tono}`}>{e.txt}</span>
      </div>
      {abierta ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <input value={cant} onChange={(ev) => setCant(ev.target.value)} inputMode="decimal" placeholder="¿Cuánto llegó?"
            className="w-32 rounded-md border border-border bg-surface px-2 py-1.5 text-[13px]" />
          <button onClick={() => guardar.mutate({ cantidad_recibida: cant === "" ? null : Number(cant.replace(",", ".")) })}
            disabled={guardar.isPending || cant === ""}
            className="rounded-md bg-accent px-2.5 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">Anotar</button>
          {it.cantidad_esperada != null && (
            <button onClick={() => { setCant(String(it.cantidad_esperada)); guardar.mutate({ cantidad_recibida: it.cantidad_esperada }); }}
              className="rounded-md border border-border px-2.5 py-1.5 text-[12px]">Llegó completo</button>
          )}
          <button onClick={() => { const o = window.prompt("¿Qué daño tiene?") ?? ""; guardar.mutate({ estado_item: "danado", observacion: o }); }}
            className="rounded-md border border-accent-rose/50 px-2.5 py-1.5 text-[12px] text-accent-rose">Dañado</button>
        </div>
      ) : (
        <p className="mt-1 text-[12px] text-ink">Llegó: {it.cantidad_recibida ?? "—"} {it.unidad}</p>
      )}
      {it.observacion && <p className="mt-1 text-[11.5px] italic text-ink-secondary">{it.observacion}</p>}
    </div>
  );
}

function Detalle({ id, onCerrar }: { id: number; onCerrar: () => void }) {
  const qc = useQueryClient();
  const token = useTicketsAuth((s) => s.token) || "";
  const fotoRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [nuevo, setNuevo] = useState("");
  const d = useQuery<Recepcion>({ queryKey: ["recepcion", id], queryFn: () => api.get(`/api/recepciones/${id}`) });
  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ["recepcion", id] });
    void qc.invalidateQueries({ queryKey: ["recepciones"] });
  };
  const accion = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      refrescar();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const subirFotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setSubiendo(true);
    try {
      for (const f of Array.from(files)) {
        const form = new FormData();
        form.append("foto", f);
        await api.upload(`/api/recepciones/${id}/fotos`, form, { timeoutMs: 120_000 });
      }
      refrescar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubiendo(false);
    }
  };

  const r = d.data;
  if (!r) return <p className="text-[12px] text-muted">Cargando…</p>;
  const abierta = r.estado === "abierta";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-2 rounded-xl border border-border bg-surface p-3">
        <button onClick={onCerrar} className="rounded-md border border-border px-2 py-1 text-[12px] lg:hidden">←</button>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold text-ink">#{r.id} · {r.proveedor}</p>
          <p className="text-[11.5px] text-muted">
            {r.referencia && <>{r.referencia} · </>}Recibió {r.recibido_por_nombre || "—"} · {fecha(r.creada_en)}
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${ESTADO[r.estado].tono}`}>{ESTADO[r.estado].txt}</span>
      </div>

      <div className="rounded-xl border border-border bg-surface p-3">
        <div className="flex items-center justify-between">
          <p className="text-[12.5px] font-bold text-ink">Fotos ({r.fotos?.length ?? 0})</p>
          <input ref={fotoRef} type="file" accept="image/*" capture="environment" multiple className="hidden"
            onChange={(e) => { void subirFotos(e.target.files); e.target.value = ""; }} />
          <button onClick={() => fotoRef.current?.click()} disabled={subiendo}
            className="rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-50">
            {subiendo ? "Subiendo…" : "📷 Tomar foto"}
          </button>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-5">
          {(r.fotos ?? []).map((f) => {
            const url = `/api/recepciones/fotos/${encodeURIComponent(f.archivo)}?token=${encodeURIComponent(token)}`;
            return (
              <a key={f.id} href={url} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-md border border-border bg-white">
                <img src={url} alt={f.nombre} loading="lazy" className="h-full w-full object-cover" />
              </a>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5 rounded-xl border border-border bg-surface p-3">
        <p className="text-[12.5px] font-bold text-ink">Productos · {r.resumen.contados}/{r.resumen.total} contados{r.resumen.diferencias ? ` · ${r.resumen.diferencias} con diferencia` : ""}</p>
        {(r.items ?? []).map((it) => <FilaItem key={`${it.id}-${it.cantidad_recibida}-${it.estado_item}`} r={r} it={it} onCambio={refrescar} />)}
        {abierta && (
          <div className="flex gap-1.5 pt-1">
            <input value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="Llegó algo que no estaba en la lista…"
              className="min-w-0 flex-1 rounded-md border border-border bg-surface-input px-2 py-1.5 text-[13px]" />
            <button disabled={!nuevo.trim()} onClick={() => void accion(async () => { await api.post(`/api/recepciones/${id}/items`, { descripcion: nuevo }); setNuevo(""); })}
              className="rounded-md border border-border px-2.5 py-1.5 text-[12px] disabled:opacity-50">Agregar</button>
          </div>
        )}
      </div>

      {r.notas && <p className="whitespace-pre-wrap rounded-lg bg-surface-input px-3 py-2 text-[12px] text-ink">{r.notas}</p>}
      {error && <p className="text-[12px] text-accent-rose">{error}</p>}
      {abierta && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void accion(() => api.post(`/api/recepciones/${id}/cerrar`, {}))}
            className="rounded-md bg-accent px-4 py-2 text-[13px] font-bold text-white">Cerrar recepción</button>
          <button onClick={() => { const m = window.prompt("¿Por qué se anula?"); if (m !== null) void accion(() => api.post(`/api/recepciones/${id}/anular`, { motivo: m })); }}
            className="rounded-md border border-border px-3 py-2 text-[12.5px] text-ink-secondary">Anular</button>
        </div>
      )}
    </div>
  );
}

export default function RecepcionMercanciaPanel() {
  const [vista, setVista] = useState<"llegadas" | "insumos">("llegadas");
  return (
    <div className="mx-auto w-full max-w-[1300px] space-y-3">
      <div className="flex gap-1.5">
        {([["llegadas", "Llegadas"], ["insumos", "Insumos: fotos y contador"]] as const).map(([id, txt]) => (
          <button key={id} type="button" onClick={() => setVista(id)}
            className={`rounded-full border px-3 py-1.5 text-[12.5px] font-bold ${vista === id ? "border-accent bg-accent/10 text-accent" : "border-border text-ink"}`}>
            {txt}
          </button>
        ))}
      </div>
      {vista === "insumos" ? <InsumosVista /> : <Llegadas />}
    </div>
  );
}

function Llegadas() {
  const [sel, setSel] = useState<number | null>(null);
  const [creando, setCreando] = useState(false);
  const lista = useQuery<{ recepciones: Recepcion[] }>({
    queryKey: ["recepciones"],
    queryFn: () => api.get("/api/recepciones"),
    refetchInterval: 30_000,
  });
  const recs = lista.data?.recepciones ?? [];
  const abiertas = recs.filter((r) => r.estado === "abierta");
  const cerradas = recs.filter((r) => r.estado !== "abierta");

  const Tarjeta = ({ r }: { r: Recepcion }) => (
    <button onClick={() => { setSel(r.id); setCreando(false); }}
      className={`mck-btn-no-fx w-full rounded-lg border p-2 text-left ${sel === r.id ? "border-accent bg-accent/10" : "border-border bg-surface-input hover:border-accent/50"}`}>
      <span className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-ink">#{r.id} · {r.proveedor}</span>
        <span className={`shrink-0 rounded-full px-1.5 text-[9.5px] font-bold ${ESTADO[r.estado].tono}`}>{ESTADO[r.estado].txt}</span>
      </span>
      <span className="block text-[11px] text-muted">
        {fecha(r.creada_en)} · {r.resumen.contados}/{r.resumen.total} contados{r.resumen.fotos ? ` · ${r.resumen.fotos} fotos` : ""}
      </span>
    </button>
  );

  return (
    <div className="mx-auto grid w-full max-w-[1300px] gap-3 lg:grid-cols-[320px_1fr]">
      <aside className={`${sel || creando ? "hidden lg:block" : "block"} space-y-2`}>
        <button onClick={() => { setCreando(true); setSel(null); }}
          className="w-full rounded-lg bg-accent px-3 py-2.5 text-[13.5px] font-bold text-white">+ Llegó mercancía</button>
        {lista.isLoading && <p className="text-[12px] text-muted">Cargando…</p>}
        {abiertas.length > 0 && <p className="pt-1 font-mono text-[10px] font-bold uppercase text-muted">Por contar</p>}
        {abiertas.map((r) => <Tarjeta key={r.id} r={r} />)}
        {cerradas.length > 0 && <p className="pt-2 font-mono text-[10px] font-bold uppercase text-muted">Cerradas</p>}
        {cerradas.map((r) => <Tarjeta key={r.id} r={r} />)}
        {!lista.isLoading && recs.length === 0 && <p className="text-[12px] text-muted">Aún no hay recepciones registradas.</p>}
      </aside>
      <section className="min-w-0">
        {creando && <Nueva onCancelar={() => setCreando(false)} onCreada={(r) => { setCreando(false); setSel(r.id); void lista.refetch(); }} />}
        {!creando && sel != null && <Detalle id={sel} onCerrar={() => setSel(null)} />}
        {!creando && sel == null && (
          <div className="hidden rounded-xl border border-dashed border-border p-8 text-center text-[12.5px] text-muted lg:block">
            Elige una recepción o registra una llegada con «+ Llegó mercancía».
          </div>
        )}
      </section>
    </div>
  );
}
