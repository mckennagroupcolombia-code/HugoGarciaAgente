import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { Ico } from "../../icons/Ico";
import {
  CamposLugar, FormularioBulto, Miniatura, cantidadTexto, fechaCorta, urlFotoBandeja, urlFotoBulto, useTokenSesion,
  type Bulto, type FotoBandeja,
} from "./bultosComun";

/**
 * Dónde está cada bulto — Recepción de mercancía → pestaña «Dónde está cada bulto».
 *
 * Antes la foto del bulto que llegaba se colgaba en el grupo de WhatsApp y ahí se
 * perdía: no quedaba atada a un producto ni a un lugar. Aquí cada bulto tiene foto,
 * producto (SKU del catálogo), sede y ubicación; se busca por nombre, SKU o lugar, y
 * la solicitud que pide ese producto lo muestra sola («¿Dónde está?»).
 * La bandeja «Por identificar» junta las fotos que ya llegaron (grupos de WhatsApp
 * enlazados a un canal del panel y recepciones) para asociarlas o descartarlas.
 */

type Resp = { bultos: Bulto[]; sedes: string[]; puede_escribir: boolean };

export default function BultosVista() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [qDeb, setQDeb] = useState("");
  const [sede, setSede] = useState("");
  const [agotados, setAgotados] = useState(false);
  const [modo, setModo] = useState<"bodega" | "bandeja">("bodega");
  const [registrando, setRegistrando] = useState(false);
  const [identificando, setIdentificando] = useState<FotoBandeja | null>(null);
  useEffect(() => { const t = window.setTimeout(() => setQDeb(q.trim()), 250); return () => window.clearTimeout(t); }, [q]);

  const lista = useQuery<Resp>({
    queryKey: ["bultos", qDeb, sede, agotados],
    queryFn: () => api.get(`/api/bultos?q=${encodeURIComponent(qDeb)}&sede=${encodeURIComponent(sede)}&agotados=${agotados ? 1 : 0}`),
    refetchInterval: 60_000,
  });
  const puedeEscribir = lista.data?.puede_escribir ?? false;
  const bandeja = useQuery<{ fotos: FotoBandeja[] }>({
    queryKey: ["bultos-bandeja"],
    queryFn: () => api.get("/api/bultos/por-identificar"),
    enabled: puedeEscribir,
    refetchInterval: 60_000,
  });
  const fotosBandeja = bandeja.data?.fotos ?? [];

  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ["bultos"] });
    void qc.invalidateQueries({ queryKey: ["bultos-bandeja"] });
    void qc.invalidateQueries({ queryKey: ["bultos-ubicaciones"] });
    void qc.invalidateQueries({ queryKey: ["bultos-en-texto"] });
  };

  const grupos = useMemo(() => {
    const m = new Map<string, { sku: string; nombre: string; bultos: Bulto[] }>();
    for (const b of lista.data?.bultos ?? []) {
      const g = m.get(b.sku) ?? { sku: b.sku, nombre: b.nombre, bultos: [] };
      g.bultos.push(b);
      m.set(b.sku, g);
    }
    return [...m.values()];
  }, [lista.data]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="¿Qué buscas? Producto, SKU, estante, lote…"
          className="min-w-[14rem] flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-[13.5px]" />
        {puedeEscribir && (
          <button type="button" onClick={() => { setRegistrando(true); setIdentificando(null); }}
            className="rounded-lg bg-accent px-3 py-2 text-[13.5px] font-bold text-white"><Ico e="📷" /> Registrar bulto</button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => setModo("bodega")}
          className={`rounded-full border px-3 py-1 text-[12.5px] font-bold ${modo === "bodega" ? "border-accent bg-accent/10 text-accent" : "border-border text-ink"}`}>
          En bodega ({lista.data?.bultos.length ?? "…"})
        </button>
        {puedeEscribir && (
          <button type="button" onClick={() => setModo("bandeja")}
            className={`rounded-full border px-3 py-1 text-[12.5px] font-bold ${modo === "bandeja" ? "border-accent bg-accent/10 text-accent" : "border-border text-ink"} ${fotosBandeja.length ? "mck-titila-rojo-borde" : ""}`}>
            Fotos por identificar ({fotosBandeja.length})
          </button>
        )}
        {modo === "bodega" && (
          <>
            <span className="mx-1 h-4 w-px bg-border" />
            {["", ...(lista.data?.sedes ?? [])].map((s) => (
              <button key={s || "todas"} type="button" onClick={() => setSede(s)}
                className={`rounded-md border px-2 py-0.5 text-[11.5px] font-bold ${sede === s ? "border-accent text-accent" : "border-border text-muted"}`}>
                {s || "Todas las sedes"}
              </button>
            ))}
            <label className="ml-1 inline-flex items-center gap-1 text-[11.5px] text-muted">
              <input type="checkbox" checked={agotados} onChange={(e) => setAgotados(e.target.checked)} /> ver agotados
            </label>
          </>
        )}
      </div>

      {(registrando || identificando) && (
        <FormularioBulto
          key={identificando ? `${identificando.origen}-${identificando.ref}` : "nuevo"}
          fotoBandeja={identificando}
          onCancelar={() => { setRegistrando(false); setIdentificando(null); }}
          onListo={() => { setRegistrando(false); setIdentificando(null); refrescar(); }}
        />
      )}

      {modo === "bandeja" ? (
        <Bandeja fotos={fotosBandeja} cargando={bandeja.isLoading}
          onIdentificar={(f) => { setIdentificando(f); setRegistrando(false); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          onCambio={refrescar} />
      ) : (
        <div className="space-y-2">
          {lista.isLoading && <p className="text-[12px] text-muted">Cargando…</p>}
          {lista.error && <p className="text-[12px] text-red-600">{(lista.error as Error).message}</p>}
          {!lista.isLoading && grupos.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-[12.5px] text-muted">
              {qDeb ? `No hay bultos registrados de «${qDeb}».` : "Aún no hay bultos registrados."}
              {puedeEscribir && <> Cuando llegue uno, «Registrar bulto»: foto, producto y dónde quedó.</>}
            </div>
          )}
          {grupos.map((g) => (
            <section key={g.sku} className="rounded-xl border border-border bg-surface-panel p-2.5">
              <p className="mb-1.5 flex items-baseline gap-2">
                <span className="text-[14px] font-extrabold text-ink">{g.nombre}</span>
                <code className="text-[11px] text-muted">{g.sku}</code>
                <span className="ml-auto text-[11px] text-muted">{g.bultos.length} bulto{g.bultos.length === 1 ? "" : "s"}</span>
              </p>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {g.bultos.map((b) => <TarjetaBulto key={b.id} b={b} puedeEscribir={puedeEscribir} onCambio={refrescar} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function TarjetaBulto({ b, puedeEscribir, onCambio }: { b: Bulto; puedeEscribir: boolean; onCambio: () => void }) {
  const token = useTokenSesion();
  const [moviendo, setMoviendo] = useState(false);
  const [sede, setSede] = useState(b.sede);
  const [ubicacion, setUbicacion] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const foto = b.fotos[0];

  async function accion(fn: () => Promise<unknown>) {
    setOcupado(true); setError("");
    try {
      const r = (await fn()) as { error?: string };
      if (r?.error) throw new Error(r.error);
      setMoviendo(false);
      onCambio();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function otraFoto(f?: File) {
    if (!f) return;
    const form = new FormData();
    form.append("foto", f);
    await accion(() => api.upload(`/api/bultos/${b.id}/fotos`, form, { timeoutMs: 120_000 }));
  }

  return (
    <div className={`flex gap-2 rounded-lg border border-border bg-surface p-2 ${b.estado === "agotado" ? "opacity-60" : ""}`}>
      {foto ? (
        <Miniatura src={urlFotoBulto(foto.archivo, token)} tam={84}
          pie={<><b>{b.nombre}</b> · {b.sede} · {b.ubicacion}</>} />
      ) : <span className="h-[84px] w-[84px] shrink-0 rounded-md border border-dashed border-border" />}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-[13.5px] font-extrabold leading-tight text-ink"><Ico e="📍" /> {b.ubicacion}</p>
        <p className="text-[12px] font-bold text-accent">{b.sede}</p>
        <p className="text-[11px] text-muted">
          {b.codigo}{cantidadTexto(b) ? ` · ${cantidadTexto(b)}` : ""}{b.lote ? ` · lote ${b.lote}` : ""}
          {b.estado === "agotado" ? " · AGOTADO" : ""}
        </p>
        {b.nota && <p className="text-[11px] italic text-muted">{b.nota}</p>}
        <p className="text-[10.5px] text-muted">{fechaCorta(b.actualizado_en)}{b.creado_por_nombre ? ` · ${b.creado_por_nombre}` : ""}</p>
        {puedeEscribir && !moviendo && (
          <div className="flex flex-wrap gap-1 pt-1">
            <button type="button" disabled={ocupado} onClick={() => setMoviendo(true)}
              className="rounded-md border border-border px-2 py-0.5 text-[11px] font-bold text-ink hover:border-accent">Mover</button>
            <label className="cursor-pointer rounded-md border border-border px-2 py-0.5 text-[11px] font-bold text-ink hover:border-accent">
              + foto
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void otraFoto(e.target.files?.[0])} />
            </label>
            {b.estado === "en_bodega" ? (
              <button type="button" disabled={ocupado}
                onClick={() => { if (confirm(`¿Se acabó ${b.nombre} (${b.codigo})? Deja de aparecer en las solicitudes.`)) void accion(() => api.patch(`/api/bultos/${b.id}`, { estado: "agotado" })); }}
                className="rounded-md border border-border px-2 py-0.5 text-[11px] font-bold text-muted hover:border-accent">Se acabó</button>
            ) : (
              <button type="button" disabled={ocupado} onClick={() => void accion(() => api.patch(`/api/bultos/${b.id}`, { estado: "en_bodega" }))}
                className="rounded-md border border-border px-2 py-0.5 text-[11px] font-bold text-muted hover:border-accent">Sigue en bodega</button>
            )}
          </div>
        )}
        {moviendo && (
          <div className="space-y-1.5 pt-1">
            <CamposLugar sede={sede} ubicacion={ubicacion} onSede={setSede} onUbicacion={setUbicacion} />
            <div className="flex gap-1.5">
              <button type="button" disabled={!ubicacion.trim() || ocupado}
                onClick={() => void accion(() => api.post(`/api/bultos/${b.id}/mover`, { sede, ubicacion }))}
                className="rounded-md bg-accent px-2.5 py-1 text-[12px] font-bold text-white disabled:opacity-50">Guardar lugar</button>
              <button type="button" onClick={() => setMoviendo(false)} className="text-[11.5px] text-muted underline">cancelar</button>
            </div>
          </div>
        )}
        {error && <p className="text-[11px] text-red-600">{error}</p>}
      </div>
    </div>
  );
}

function Bandeja({ fotos, cargando, onIdentificar, onCambio }: {
  fotos: FotoBandeja[]; cargando: boolean; onIdentificar: (f: FotoBandeja) => void; onCambio: () => void;
}) {
  const token = useTokenSesion();
  const [ocupado, setOcupado] = useState("");
  if (cargando) return <p className="text-[12px] text-muted">Cargando…</p>;
  if (!fotos.length) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center text-[12.5px] text-muted">
        No hay fotos pendientes. Aquí llegan las que se suben en el chat «Inventario y llegadas», en los grupos de
        WhatsApp enlazados a él y en las recepciones de mercancía.
      </div>
    );
  }
  async function descartar(f: FotoBandeja) {
    setOcupado(`${f.origen}-${f.ref}`);
    try {
      await api.post(`/api/bultos/por-identificar/${f.origen}/${encodeURIComponent(f.ref)}/descartar`);
      onCambio();
    } finally {
      setOcupado("");
    }
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {fotos.map((f) => (
        <div key={`${f.origen}-${f.ref}`} className="space-y-1.5 rounded-lg border border-border bg-surface p-2">
          <Miniatura src={urlFotoBandeja(f, token)} tam={220} pie={<>{f.via} · {f.donde}</>} />
          <p className="text-[11px] text-muted">
            {f.via} · {f.donde}<br />{fechaCorta(f.en)}{f.autor ? ` · ${f.autor}` : ""}
          </p>
          {f.texto && <p className="line-clamp-3 text-[11.5px] text-ink">«{f.texto}»</p>}
          {f.sugeridos && f.sugeridos.length > 0 && (
            <p className="text-[11px] text-accent">¿{f.sugeridos.map((p) => p.nombre).join(" / ")}?</p>
          )}
          <div className="flex gap-1.5">
            <button type="button" onClick={() => onIdentificar(f)}
              className="flex-1 rounded-md bg-accent px-2 py-1.5 text-[12px] font-bold text-white">Es un bulto: ubicarlo</button>
            <button type="button" disabled={ocupado === `${f.origen}-${f.ref}`} onClick={() => void descartar(f)}
              title="Un comprobante, una guía, otra cosa"
              className="rounded-md border border-border px-2 py-1.5 text-[11.5px] font-bold text-muted">No es un bulto</button>
          </div>
        </div>
      ))}
    </div>
  );
}
