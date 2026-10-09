import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Ico } from "../../icons/Ico";

/**
 * Revisión global de pesos, medidas y empaques (solicitud `subtipo = revision_empaque`).
 *
 * Dentro de la tarjeta de la solicitud se ve el avance; «Continuar revisión» abre la ventana
 * con los pasos: 1 Pesar cada combo listo para despachar (y confirmar su empaque y caja),
 * 2 Medir una vez cada tipo de empaque, 3 Entregar, 4 Aprobar y aplicar en MeLi (solo quien
 * creó la revisión o un administrador). Backend: /api/revision-empaque/* (sin LLM).
 */

export type MeliRef = {
  id: string;
  status: string;
  titulo: string;
  thumbnail: string;
  peso_g: number | null;
  largo_cm: number | null;
  ancho_cm: number | null;
  alto_cm: number | null;
  /** cross_docking, fulfillment (Full), self_service (Flex)… */
  logistica?: string;
};
export type Pieza = { sku: string; nombre: string; cantidad: number; casilla: string };
type Resultado = { publicaciones: { id: string; ok: boolean; error?: string }[] };
export type Producto = {
  sku: string;
  nombre: string;
  presentacion: string;
  grupo_clave: string;
  empaque_receta: Pieza[];
  meli: MeliRef[];
  peso_g: number | null;
  empaque_ok: string[] | null;
  caja: string | null;
  caja_otra: string | null;
  largo_cm: number | null;
  ancho_cm: number | null;
  alto_cm: number | null;
  nota: string | null;
  omitido: number;
  motivo_omitido: string | null;
  verificado_por: string | null;
  verificado_en: string | null;
  aplicado_en: string | null;
  aplicado_resultado: Resultado | null;
  medidas_finales: number[] | null;
  peso_meli: number | null;
  medidas_meli: number[] | null;
  listo: boolean;
  diferencia: boolean;
};
export type Grupo = {
  clave: string;
  nombre: string;
  rigido: number;
  largo_cm: number | null;
  ancho_cm: number | null;
  alto_cm: number | null;
  nota: string | null;
  medido_por: string | null;
  medido_en: string | null;
  productos: number;
  ejemplos: string[];
  skus: string[];
  sugerido_meli: number[] | null;
  medido: boolean;
  solo: boolean;
};
type Estado = {
  revision: {
    id: number;
    ticket_id: number | null;
    titulo: string;
    entregada_en: string | null;
    meli_refrescado_en: string | null;
  };
  productos: Producto[];
  grupos: Grupo[];
  cajas: string[];
  puede_aprobar: boolean;
  progreso: {
    total: number;
    pesados: number;
    omitidos: number;
    grupos_total: number;
    grupos_medidos: number;
    listos: number;
    con_diferencia: number;
    aplicados: number;
  };
};
type Paso = "pesar" | "medir" | "entregar" | "aprobar";

export const SUBTIPO_REVISION_EMPAQUE = "revision_empaque";

// Lo que se confirma a la vista; etiquetas, tapas y protección siguen en la receta sin preguntar.
export const CASILLAS_VISIBLES = new Set(["envase", "bolsa", "caja", "kit"]);

export function fmtPeso(g: number | null | undefined): string {
  if (!g) return "—";
  return g >= 1000 ? `${(g / 1000).toLocaleString("es-CO", { maximumFractionDigits: 2 })} kg` : `${Math.round(g)} g`;
}

export function fmtMedidas(m: (number | null)[] | null | undefined): string {
  if (!m || m.length !== 3 || m.some((x) => !x)) return "—";
  return `${m.map((x) => Number(x).toLocaleString("es-CO", { maximumFractionDigits: 1 })).join(" × ")} cm`;
}

function Barra({ hechos, total, etiqueta }: { hechos: number; total: number; etiqueta: string }) {
  const pct = total ? Math.round((hechos / total) * 100) : 0;
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[11.5px]">
        <span className="font-semibold text-ink">{etiqueta}</span>
        <span className="text-muted">{hechos}/{total}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-border/60">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function useRevision(ticketId: number, enabled: boolean) {
  return useQuery<Estado>({
    queryKey: ["revision-empaque", ticketId],
    queryFn: () => api.get(`/api/revision-empaque/por-ticket/${ticketId}`),
    enabled,
    staleTime: 15_000,
    retry: false,
  });
}

export default function RevisionEmpaqueEnSolicitud({ ticket }: { ticket: { id: number; subtipo?: string | null } }) {
  const es = ticket.subtipo === SUBTIPO_REVISION_EMPAQUE;
  const q = useRevision(ticket.id, es);
  const [abierto, setAbierto] = useState<Paso | null>(null);
  if (!es) return null;
  if (q.isLoading) return <p className="text-[12px] text-muted">Cargando la revisión…</p>;
  if (q.error || !q.data) {
    return <p className="text-[12px] text-danger">{(q.error as Error)?.message || "No se pudo cargar la revisión"}</p>;
  }
  const { progreso: pr, revision, puede_aprobar } = q.data;
  const siguiente: Paso = pr.pesados + pr.omitidos < pr.total ? "pesar"
    : pr.grupos_medidos < pr.grupos_total ? "medir" : "entregar";

  return (
    <div className="space-y-2 rounded-xl border-2 border-accent/40 bg-accent/5 p-3" onClick={(e) => e.stopPropagation()}>
      <p className="text-[11px] font-extrabold uppercase tracking-wide text-accent">
        <Ico e="⚖️" /> Revisión de pesos, medidas y empaques
      </p>
      <Barra etiqueta="Productos pesados" hechos={pr.pesados + pr.omitidos} total={pr.total} />
      <Barra etiqueta="Tipos de empaque medidos" hechos={pr.grupos_medidos} total={pr.grupos_total} />
      <p className="text-[11.5px] text-muted">
        {pr.listos} listos · {pr.con_diferencia} distintos a MeLi · {pr.aplicados} aplicados en MeLi
        {revision.entregada_en ? ` · entregada ${revision.entregada_en.slice(0, 10)}` : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="mck-btn mck-btn-primary px-3 py-1.5 disabled:opacity-50 text-[13px]" onClick={() => setAbierto(siguiente)}>
          <Ico e="📦" /> {pr.pesados + pr.omitidos === 0 ? "Empezar revisión" : "Continuar revisión"}
        </button>
        {puede_aprobar && (
          <button type="button" className="mck-btn mck-btn-ghost px-3 py-1.5 disabled:opacity-50 text-[13px]" onClick={() => setAbierto("aprobar")}>
            <Ico e="✅" /> Aprobar y aplicar en MeLi
          </button>
        )}
      </div>
      {abierto && (
        <RevisionVentana ticketId={ticket.id} estado={q.data} paso={abierto} setPaso={setAbierto}
          onCerrar={() => setAbierto(null)} />
      )}
    </div>
  );
}

function RevisionVentana({ ticketId, estado, paso, setPaso, onCerrar }: {
  ticketId: number;
  estado: Estado;
  paso: Paso;
  setPaso: (p: Paso) => void;
  onCerrar: () => void;
}) {
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onCerrar]);

  const pr = estado.progreso;
  const pasos: { id: Paso; texto: string; detalle: string }[] = [
    { id: "pesar", texto: "1 · Pesar", detalle: `${pr.pesados + pr.omitidos}/${pr.total}` },
    { id: "medir", texto: "2 · Medir empaques", detalle: `${pr.grupos_medidos}/${pr.grupos_total}` },
    { id: "entregar", texto: "3 · Entregar", detalle: estado.revision.entregada_en ? "hecho" : "" },
    ...(estado.puede_aprobar ? [{ id: "aprobar" as Paso, texto: "4 · Aprobar", detalle: `${pr.aplicados} aplicados` }] : []),
  ];

  return createPortal(
    <div className="fixed inset-0 z-[600] flex items-stretch justify-center bg-ink/40 backdrop-blur-sm sm:items-center sm:p-3"
      onClick={onCerrar}>
      <div className="flex h-full w-full max-w-4xl flex-col overflow-hidden bg-surface shadow-2xl sm:h-[92vh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <p className="text-[15px] font-extrabold text-ink"><Ico e="⚖️" /> {estado.revision.titulo}</p>
          <button type="button" className="mck-btn mck-btn-ghost px-2.5 py-1.5 text-[13px]" onClick={onCerrar}>Cerrar</button>
        </div>
        <div className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2">
          {pasos.map((p) => (
            <div key={p.id} role="button" tabIndex={0} onClick={() => setPaso(p.id)}
              onKeyDown={(e) => { if (e.key === "Enter") setPaso(p.id); }}
              className={`cursor-pointer whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-bold ${
                paso === p.id ? "bg-accent text-white" : "bg-border/40 text-ink hover:bg-border/70"}`}>
              {p.texto} {p.detalle && <span className="font-normal opacity-80">· {p.detalle}</span>}
            </div>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {paso === "pesar" && <PasoPesar ticketId={ticketId} estado={estado} />}
          {paso === "medir" && <PasoMedir ticketId={ticketId} estado={estado} />}
          {paso === "entregar" && <PasoEntregar ticketId={ticketId} estado={estado} irA={setPaso} />}
          {paso === "aprobar" && estado.puede_aprobar && <PasoAprobar ticketId={ticketId} estado={estado} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function useRefrescar(ticketId: number) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["revision-empaque", ticketId] });
}

// ── Paso 1: pesar ────────────────────────────────────────────────────────────────────────

function PasoPesar({ ticketId, estado }: { ticketId: number; estado: Estado }) {
  const refrescar = useRefrescar(ticketId);
  const [soloPendientes, setSoloPendientes] = useState(true);
  const [buscar, setBuscar] = useState("");
  const [skuActual, setSkuActual] = useState<string | null>(null);
  const [verLista, setVerLista] = useState(false);

  const hecho = (p: Producto) => Boolean(p.peso_g) || Boolean(p.omitido);
  const lista = useMemo(() => {
    const t = buscar.trim().toLowerCase();
    return estado.productos.filter((p) =>
      (!soloPendientes || !hecho(p) || p.sku === skuActual)
      && (!t || p.nombre.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t)));
  }, [estado.productos, soloPendientes, buscar, skuActual]);

  const actual = lista.find((p) => p.sku === skuActual) ?? lista[0] ?? null;
  const pos = actual ? lista.indexOf(actual) : -1;

  const irSiguiente = () => {
    const resto = estado.productos.filter((p) => !hecho(p) && p.sku !== actual?.sku);
    const despues = actual ? estado.productos.slice(estado.productos.indexOf(actual) + 1).find((p) => resto.includes(p)) : undefined;
    setSkuActual((despues ?? resto[0])?.sku ?? null);
  };

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-muted">
        Pesa cada producto <b>listo para despachar</b>: con su envase, tapa, etiqueta y el empaque de envío
        (papel burbuja, bolsa de seguridad y caja si la lleva). Ese es el peso que MeLi usa para cobrar el flete.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input className="rounded-md border border-border bg-surface px-2 py-1 min-w-[12rem] flex-1 text-[13px]" placeholder="Buscar producto o SKU"
          value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        <label className="flex items-center gap-1.5 text-[12.5px] text-ink">
          <input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} />
          Solo pendientes
        </label>
        <span className="text-[12px] text-muted">{lista.length} en la lista</span>
      </div>

      {!actual ? (
        <p className="rounded-xl border border-border p-4 text-center text-[13px] text-muted">
          {soloPendientes ? "No queda nada por pesar con este filtro." : "No hay productos con esa búsqueda."}
        </p>
      ) : (
        <FichaPesar key={actual.sku} ticketId={ticketId} p={actual} cajas={estado.cajas} revisionId={estado.revision.id}
          posicion={`${pos + 1} de ${lista.length}`}
          onAnterior={pos > 0 ? () => setSkuActual(lista[pos - 1].sku) : undefined}
          onSiguiente={pos < lista.length - 1 ? () => setSkuActual(lista[pos + 1].sku) : undefined}
          onGuardado={() => { void refrescar(); irSiguiente(); }} />
      )}

      <div>
        <button type="button" className="text-[12.5px] font-semibold text-accent" onClick={() => setVerLista((v) => !v)}>
          {verLista ? "Ocultar lista" : `Ver la lista (${lista.length})`}
        </button>
        {verLista && (
          <div className="mt-1.5 max-h-72 divide-y divide-border overflow-y-auto rounded-xl border border-border">
            {lista.map((p) => (
              <div key={p.sku} role="button" tabIndex={0} onClick={() => setSkuActual(p.sku)}
                onKeyDown={(e) => { if (e.key === "Enter") setSkuActual(p.sku); }}
                className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-[12.5px] hover:bg-border/40 ${
                  p.sku === actual?.sku ? "bg-accent/10" : ""}`}>
                <span className="min-w-0 truncate">{p.nombre} <code className="text-[10.5px] text-muted">{p.sku}</code></span>
                <span className={`shrink-0 ${p.omitido ? "text-amber-700" : p.peso_g ? "text-emerald-700" : "text-muted"}`}>
                  {p.omitido ? "sin pesar" : p.peso_g ? fmtPeso(p.peso_g) : "pendiente"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FichaPesar({ ticketId, revisionId, p, cajas, posicion, onAnterior, onSiguiente, onGuardado }: {
  ticketId: number;
  revisionId: number;
  p: Producto;
  cajas: string[];
  posicion: string;
  onAnterior?: () => void;
  onSiguiente?: () => void;
  onGuardado: () => void;
}) {
  void ticketId;
  const visibles = p.empaque_receta.filter((e) => CASILLAS_VISIBLES.has(e.casilla));
  const cajaReceta = p.empaque_receta.find((e) => e.casilla === "caja")?.sku ?? "";
  const [peso, setPeso] = useState(p.peso_g ? String(p.peso_g) : "");
  const [quitadas, setQuitadas] = useState<Set<string>>(() => {
    if (!p.empaque_ok) return new Set();
    return new Set(p.empaque_receta.map((e) => e.sku).filter((s) => !p.empaque_ok!.includes(s)));
  });
  const [caja, setCaja] = useState(p.caja ?? (cajaReceta || ""));
  const [cajaOtra, setCajaOtra] = useState(p.caja_otra ?? "");
  const [nota, setNota] = useState(p.nota ?? "");
  const [propias, setPropias] = useState(Boolean(p.largo_cm));
  const [med, setMed] = useState({ largo_cm: p.largo_cm ?? "", ancho_cm: p.ancho_cm ?? "", alto_cm: p.alto_cm ?? "" });
  const [omitiendo, setOmitiendo] = useState(false);
  const [motivo, setMotivo] = useState(p.motivo_omitido ?? "");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const pesoRef = useRef<HTMLInputElement>(null);
  useEffect(() => { pesoRef.current?.focus(); }, []);

  const foto = p.meli.find((m) => m.thumbnail)?.thumbnail;

  const enviar = async (cuerpo: Record<string, unknown>) => {
    setError("");
    setGuardando(true);
    try {
      await api.post(`/api/revision-empaque/${revisionId}/producto/${encodeURIComponent(p.sku)}`, cuerpo);
      onGuardado();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  const guardar = () => enviar({
    peso_g: peso,
    empaque_ok: p.empaque_receta.map((e) => e.sku).filter((s) => !quitadas.has(s)),
    caja: caja || "ninguna",
    caja_otra: cajaOtra,
    nota,
    ...(propias ? med : {}),
  });

  return (
    <div className="space-y-3 rounded-2xl border border-border p-3 sm:p-4">
      <div className="flex items-start gap-3">
        {foto
          ? <img src={foto} alt="" className="h-20 w-20 shrink-0 rounded-xl border border-border object-cover" />
          : <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-dashed border-border text-[11px] text-muted">sin foto</div>}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-muted">{posicion}</p>
          <p className="text-[16px] font-extrabold leading-tight text-ink">{p.nombre}</p>
          <p className="text-[12px] text-muted">
            <code>{p.sku}</code>{p.presentacion ? ` · contenido ${p.presentacion}` : ""}
            {p.meli.length ? ` · ${p.meli.length} publicación(es) en MeLi` : " · sin publicación en MeLi"}
          </p>
          {p.peso_meli ? <p className="text-[12px] text-muted">En MeLi dice: {fmtPeso(p.peso_meli)} · {fmtMedidas(p.medidas_meli)}</p> : null}
        </div>
      </div>

      <label className="block">
        <span className="text-[13px] font-bold text-ink"><Ico e="⚖️" /> Peso listo para despachar (gramos)</span>
        <input ref={pesoRef} className="rounded-md border border-border bg-surface px-2 py-1 mt-1 w-full max-w-[14rem] text-[20px] font-bold" inputMode="decimal"
          placeholder="Ej. 630" value={peso} onChange={(e) => setPeso(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !guardando) void guardar(); }} />
      </label>

      {visibles.length > 0 && (
        <div>
          <p className="text-[13px] font-bold text-ink"><Ico e="📦" /> ¿Lleva este empaque? (según la receta)</p>
          <p className="text-[11.5px] text-muted">Toca para quitar lo que en realidad no lleva.</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {visibles.map((e) => {
              const lleva = !quitadas.has(e.sku);
              return (
                <div key={e.sku} role="button" tabIndex={0}
                  onClick={() => setQuitadas((s) => { const n = new Set(s); if (lleva) n.add(e.sku); else n.delete(e.sku); return n; })}
                  onKeyDown={(ev) => { if (ev.key === " ") ev.currentTarget.click(); }}
                  className={`cursor-pointer rounded-lg border px-2 py-1 text-[12px] ${lleva
                    ? "border-emerald-600/40 bg-emerald-600/10 text-ink" : "border-border bg-surface text-muted line-through"}`}>
                  {lleva ? "✓ " : ""}{e.nombre}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="text-[13px] font-bold text-ink">¿Va en caja?</span>
          <select className="rounded-md border border-border bg-surface px-2 py-1 mt-1 block text-[13px]" value={caja} onChange={(e) => setCaja(e.target.value)}>
            <option value="">No lleva caja</option>
            {cajas.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value="otra">Otra caja…</option>
          </select>
        </label>
        {caja === "otra" && (
          <input className="rounded-md border border-border bg-surface px-2 py-1 text-[13px]" placeholder="¿Cuál caja? (medidas o nombre)" value={cajaOtra}
            onChange={(e) => setCajaOtra(e.target.value)} />
        )}
        {cajaReceta && caja !== cajaReceta && <span className="text-[11.5px] text-amber-700">La receta dice {cajaReceta}</span>}
        {!cajaReceta && caja && <span className="text-[11.5px] text-amber-700">La receta no tiene caja: se avisa para agregarla</span>}
      </div>

      <label className="flex items-center gap-1.5 text-[12.5px] text-ink">
        <input type="checkbox" checked={propias} onChange={(e) => setPropias(e.target.checked)} />
        <Ico e="📏" /> Este producto mide distinto al resto de su tipo de empaque
      </label>
      {propias && (
        <div className="flex flex-wrap gap-2">
          {(["largo_cm", "ancho_cm", "alto_cm"] as const).map((k) => (
            <label key={k} className="block text-[12px] text-muted">
              {k === "largo_cm" ? "Largo" : k === "ancho_cm" ? "Ancho" : "Alto"} (cm)
              <input className="rounded-md border border-border bg-surface px-2 py-1 mt-0.5 block w-24 text-[14px]" inputMode="decimal" value={med[k]}
                onChange={(e) => setMed((m) => ({ ...m, [k]: e.target.value }))} />
            </label>
          ))}
        </div>
      )}

      <input className="rounded-md border border-border bg-surface px-2 py-1 w-full text-[13px]" placeholder="Nota (opcional)" value={nota} onChange={(e) => setNota(e.target.value)} />

      {error && <p className="text-[12.5px] font-semibold text-danger">{error}</p>}

      {omitiendo ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-600/40 bg-amber-600/10 p-2">
          <input className="rounded-md border border-border bg-surface px-2 py-1 min-w-[14rem] flex-1 text-[13px]" placeholder="¿Por qué no se pudo pesar? (p. ej. no hay en bodega)"
            value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <button type="button" className="mck-btn mck-btn-ghost px-3 py-1.5 disabled:opacity-50 text-[13px]" disabled={guardando}
            onClick={() => void enviar({ omitido: true, motivo_omitido: motivo })}>Guardar sin peso</button>
          <button type="button" className="text-[12.5px] text-muted" onClick={() => setOmitiendo(false)}>Cancelar</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="mck-btn mck-btn-primary px-3 py-1.5 disabled:opacity-50 text-[14px]" disabled={guardando} onClick={() => void guardar()}>
            {guardando ? "Guardando…" : "Guardar y siguiente"}
          </button>
          {onAnterior && <button type="button" className="mck-btn mck-btn-ghost px-3 py-1.5 disabled:opacity-50 text-[13px]" onClick={onAnterior}>Anterior</button>}
          {onSiguiente && <button type="button" className="mck-btn mck-btn-ghost px-3 py-1.5 disabled:opacity-50 text-[13px]" onClick={onSiguiente}>Saltar</button>}
          <button type="button" className="text-[12.5px] font-semibold text-amber-700" onClick={() => setOmitiendo(true)}>
            No lo puedo pesar
          </button>
          {p.verificado_por && (
            <span className="text-[11.5px] text-muted">
              {p.omitido ? "Marcado sin peso" : "Pesado"} por {p.verificado_por} · {p.verificado_en?.slice(0, 16).replace("T", " ")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Paso 2: medir cada tipo de empaque ───────────────────────────────────────────────────

function PasoMedir({ ticketId, estado }: { ticketId: number; estado: Estado }) {
  const [soloPendientes, setSoloPendientes] = useState(true);
  const grupos = estado.grupos.filter((g) => !soloPendientes || !g.medido);
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-muted">
        Mide <b>un paquete de cada tipo</b> listo para despachar (largo × ancho × alto, en cm). La medida se aplica a todos
        los productos de ese tipo; si alguno mide distinto, se corrige en el paso 1 en ese producto.
      </p>
      <label className="flex items-center gap-1.5 text-[12.5px] text-ink">
        <input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} />
        Solo pendientes ({estado.grupos.filter((g) => !g.medido).length})
      </label>
      {grupos.length === 0 && (
        <p className="rounded-xl border border-border p-4 text-center text-[13px] text-muted">Todos los empaques están medidos.</p>
      )}
      {grupos.map((g) => <FilaGrupo key={g.clave} ticketId={ticketId} revisionId={estado.revision.id} g={g} />)}
    </div>
  );
}

function FilaGrupo({ ticketId, revisionId, g }: { ticketId: number; revisionId: number; g: Grupo }) {
  const refrescar = useRefrescar(ticketId);
  const [med, setMed] = useState({
    largo_cm: g.largo_cm ? String(g.largo_cm) : "",
    ancho_cm: g.ancho_cm ? String(g.ancho_cm) : "",
    alto_cm: g.alto_cm ? String(g.alto_cm) : "",
  });
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    setError("");
    setGuardando(true);
    try {
      await api.post(`/api/revision-empaque/${revisionId}/grupo`, { clave: g.clave, ...med });
      void refrescar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className={`space-y-2 rounded-xl border p-3 ${g.medido ? "border-emerald-600/30 bg-emerald-600/5" : "border-border"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13.5px] font-bold text-ink">
          {g.solo ? g.ejemplos[0] : g.nombre}
        </p>
        <span className="text-[11.5px] text-muted">
          {g.solo ? "se mide este producto" : `${g.productos} producto(s)`}
          {g.medido ? ` · medido por ${g.medido_por ?? ""}` : ""}
        </span>
      </div>
      {!g.solo && <p className="text-[11.5px] text-muted">Ej.: {g.ejemplos.join(" · ")}</p>}
      <div className="flex flex-wrap items-end gap-2">
        {(["largo_cm", "ancho_cm", "alto_cm"] as const).map((k) => (
          <label key={k} className="block text-[12px] text-muted">
            {k === "largo_cm" ? "Largo" : k === "ancho_cm" ? "Ancho" : "Alto"} (cm)
            <input className="rounded-md border border-border bg-surface px-2 py-1 mt-0.5 block w-20 text-[14px]" inputMode="decimal" value={med[k]}
              onChange={(e) => setMed((m) => ({ ...m, [k]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter" && !guardando) void guardar(); }} />
          </label>
        ))}
        <button type="button" className="mck-btn mck-btn-primary px-3 py-1.5 disabled:opacity-50 text-[13px]" disabled={guardando} onClick={() => void guardar()}>
          <Ico e="📏" /> {guardando ? "Guardando…" : g.medido ? "Actualizar" : "Guardar"}
        </button>
        {g.sugerido_meli && !g.medido && (
          <button type="button" className="text-[12px] font-semibold text-accent"
            onClick={() => setMed({ largo_cm: String(g.sugerido_meli![0]), ancho_cm: String(g.sugerido_meli![1]), alto_cm: String(g.sugerido_meli![2]) })}>
            Precargar lo de MeLi ({fmtMedidas(g.sugerido_meli)}) y verificar con la regla
          </button>
        )}
      </div>
      {error && <p className="text-[12.5px] font-semibold text-danger">{error}</p>}
    </div>
  );
}

// ── Paso 3: entregar ─────────────────────────────────────────────────────────────────────

function PasoEntregar({ ticketId, estado, irA }: { ticketId: number; estado: Estado; irA: (p: Paso) => void }) {
  const refrescar = useRefrescar(ticketId);
  const pr = estado.progreso;
  const sinPesar = pr.total - pr.pesados - pr.omitidos;
  const sinMedir = pr.grupos_total - pr.grupos_medidos;
  const omitidos = estado.productos.filter((p) => p.omitido);
  const cajasNuevas = estado.productos.filter((p) => p.caja && p.caja !== "ninguna"
    && !p.empaque_receta.some((e) => e.sku === p.caja));
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  const entregar = async () => {
    if ((sinPesar || sinMedir) && !window.confirm(
      `Faltan ${sinPesar} producto(s) por pesar y ${sinMedir} empaque(s) por medir. ¿Entregar así?`)) return;
    setError("");
    setEnviando(true);
    try {
      const r = await api.post<{ mensaje: string }>(`/api/revision-empaque/${estado.revision.id}/entregar`, {});
      setMsg(r.mensaje);
      void refrescar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="space-y-3 text-[13px]">
      <div className="grid gap-2 sm:grid-cols-2">
        <div role="button" tabIndex={0} onClick={() => irA("pesar")} onKeyDown={(e) => { if (e.key === "Enter") irA("pesar"); }}
          className={`cursor-pointer rounded-xl border p-3 ${sinPesar ? "border-amber-600/40 bg-amber-600/10" : "border-emerald-600/30 bg-emerald-600/5"}`}>
          <p className="font-bold text-ink"><Ico e="⚖️" /> Pesar</p>
          <p className="text-muted">{pr.pesados} pesados · {pr.omitidos} sin pesar · {sinPesar} pendientes</p>
        </div>
        <div role="button" tabIndex={0} onClick={() => irA("medir")} onKeyDown={(e) => { if (e.key === "Enter") irA("medir"); }}
          className={`cursor-pointer rounded-xl border p-3 ${sinMedir ? "border-amber-600/40 bg-amber-600/10" : "border-emerald-600/30 bg-emerald-600/5"}`}>
          <p className="font-bold text-ink"><Ico e="📏" /> Medir</p>
          <p className="text-muted">{pr.grupos_medidos} de {pr.grupos_total} tipos de empaque</p>
        </div>
      </div>
      {omitidos.length > 0 && (
        <div className="rounded-xl border border-border p-3">
          <p className="font-bold text-ink">Sin pesar ({omitidos.length})</p>
          <ul className="mt-1 space-y-0.5 text-[12px] text-muted">
            {omitidos.map((p) => <li key={p.sku}>{p.nombre} — {p.motivo_omitido}</li>)}
          </ul>
        </div>
      )}
      {cajasNuevas.length > 0 && (
        <div className="rounded-xl border border-border p-3">
          <p className="font-bold text-ink"><Ico e="📦" /> Cajas que no están en la receta ({cajasNuevas.length})</p>
          <ul className="mt-1 space-y-0.5 text-[12px] text-muted">
            {cajasNuevas.map((p) => <li key={p.sku}>{p.nombre}: {p.caja === "otra" ? p.caja_otra : p.caja}</li>)}
          </ul>
        </div>
      )}
      {estado.revision.entregada_en
        ? <p className="font-semibold text-emerald-700">Entregada el {estado.revision.entregada_en.slice(0, 16).replace("T", " ")}. Puedes seguir corrigiendo.</p>
        : null}
      {msg && <p className="font-semibold text-emerald-700">{msg}</p>}
      {error && <p className="font-semibold text-danger">{error}</p>}
      <button type="button" className="mck-btn mck-btn-primary px-3 py-1.5 disabled:opacity-50 text-[14px]" disabled={enviando} onClick={() => void entregar()}>
        <Ico e="📤" /> {enviando ? "Entregando…" : estado.revision.entregada_en ? "Entregar de nuevo" : "Entregar a revisión"}
      </button>
    </div>
  );
}

// ── Paso 4: aprobar y aplicar en MeLi ────────────────────────────────────────────────────

function PasoAprobar({ ticketId, estado }: { ticketId: number; estado: Estado }) {
  const refrescar = useRefrescar(ticketId);
  const candidatos = estado.productos.filter((p) => p.listo && p.meli.length > 0);
  const sinMeli = estado.productos.filter((p) => p.listo && p.meli.length === 0).length;
  const [sel, setSel] = useState<Set<string>>(
    () => new Set(candidatos.filter((p) => p.diferencia && !p.aplicado_en).map((p) => p.sku)));
  const [soloDiferencias, setSoloDiferencias] = useState(true);
  const [avance, setAvance] = useState("");
  const [errores, setErrores] = useState<{ sku: string; texto: string }[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const filas = candidatos.filter((p) => !soloDiferencias || p.diferencia || sel.has(p.sku));

  const refrescarMeli = async () => {
    setOcupado(true);
    setAvance("Leyendo publicaciones de MeLi…");
    try {
      await api.post(`/api/revision-empaque/${estado.revision.id}/meli/refrescar`, {}, { timeoutMs: 120_000 });
      setAvance("");
      void refrescar();
    } catch (e) {
      setAvance((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const aplicar = async () => {
    const skus = candidatos.map((p) => p.sku).filter((s) => sel.has(s));
    if (!skus.length) return;
    if (!window.confirm(`Se escribirá peso y medidas en las publicaciones de MeLi de ${skus.length} producto(s). ¿Seguir?`)) return;
    setOcupado(true);
    setErrores([]);
    const malos: { sku: string; texto: string }[] = [];
    for (let i = 0; i < skus.length; i += 10) {
      setAvance(`Aplicando ${Math.min(i + 10, skus.length)} de ${skus.length}…`);
      try {
        const r = await api.post<{ resultados: { sku: string; ok: boolean; error?: string; publicaciones?: { id: string; ok: boolean; error?: string }[] }[] }>(
          `/api/revision-empaque/${estado.revision.id}/meli/aplicar`, { skus: skus.slice(i, i + 10) }, { timeoutMs: 120_000 });
        for (const x of r.resultados) {
          if (!x.ok) {
            const det = x.error || (x.publicaciones ?? []).filter((p) => !p.ok).map((p) => `${p.id}: ${p.error}`).join("; ");
            malos.push({ sku: x.sku, texto: det });
          }
        }
      } catch (e) {
        malos.push({ sku: skus.slice(i, i + 10).join(", "), texto: (e as Error).message });
      }
    }
    setErrores(malos);
    setAvance(`Listo: ${skus.length - malos.length} aplicados${malos.length ? `, ${malos.length} con error` : ""}.`);
    setSel(new Set(malos.map((m) => m.sku)));
    setOcupado(false);
    void refrescar();
  };

  return (
    <div className="space-y-3 text-[13px]">
      <p className="text-muted">
        {candidatos.length} productos verificados tienen publicación en MeLi; {estado.progreso.con_diferencia} difieren de lo
        que dice MeLi (peso con más de 5 % o 10 g de diferencia, o medidas distintas). {sinMeli} verificados sin publicación
        quedan guardados como referencia. Antes de escribir se relee cada publicación.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="mck-btn mck-btn-primary px-3 py-1.5 disabled:opacity-50 text-[13px]" disabled={ocupado || sel.size === 0} onClick={() => void aplicar()}>
          <Ico e="✅" /> Aplicar en MeLi ({sel.size})
        </button>
        <button type="button" className="mck-btn mck-btn-ghost px-3 py-1.5 disabled:opacity-50 text-[13px]" disabled={ocupado} onClick={() => void refrescarMeli()}>
          <Ico e="🔄" /> Releer MeLi
        </button>
        <label className="flex items-center gap-1.5 text-[12.5px]">
          <input type="checkbox" checked={soloDiferencias} onChange={(e) => setSoloDiferencias(e.target.checked)} />
          Solo los que difieren
        </label>
        <span className="text-[11.5px] text-muted">
          MeLi leído: {estado.revision.meli_refrescado_en?.slice(0, 16).replace("T", " ") ?? "—"}
        </span>
      </div>
      {avance && <p className="font-semibold text-ink">{avance}</p>}
      {errores.length > 0 && (
        <ul className="space-y-0.5 rounded-xl border border-danger/40 bg-danger/10 p-2 text-[12px] text-danger">
          {errores.map((e) => <li key={e.sku}><code>{e.sku}</code>: {e.texto}</li>)}
        </ul>
      )}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-[12.5px]">
          <thead className="bg-border/40 text-[11.5px] uppercase text-muted">
            <tr>
              <th className="p-2">
                <input type="checkbox" checked={filas.length > 0 && filas.every((p) => sel.has(p.sku))}
                  onChange={(e) => setSel((s) => {
                    const n = new Set(s);
                    filas.forEach((p) => (e.target.checked ? n.add(p.sku) : n.delete(p.sku)));
                    return n;
                  })} />
              </th>
              <th className="p-2">Producto</th>
              <th className="p-2">En MeLi</th>
              <th className="p-2">Verificado</th>
              <th className="p-2">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filas.map((p) => (
              <tr key={p.sku} className={p.diferencia ? "" : "opacity-70"}>
                <td className="p-2 align-top">
                  <input type="checkbox" checked={sel.has(p.sku)} onChange={(e) => setSel((s) => {
                    const n = new Set(s);
                    if (e.target.checked) n.add(p.sku); else n.delete(p.sku);
                    return n;
                  })} />
                </td>
                <td className="p-2 align-top">
                  <span className="font-semibold text-ink">{p.nombre}</span>
                  <span className="block text-[11px] text-muted"><code>{p.sku}</code> · {p.meli.length} publicación(es)</span>
                </td>
                <td className="p-2 align-top text-muted">{fmtPeso(p.peso_meli)}<br />{fmtMedidas(p.medidas_meli)}</td>
                <td className="p-2 align-top font-semibold text-ink">{fmtPeso(p.peso_g)}<br />{fmtMedidas(p.medidas_finales)}</td>
                <td className="p-2 align-top">
                  {p.aplicado_en
                    ? <span className="text-emerald-700">Aplicado {p.aplicado_en.slice(0, 10)}</span>
                    : p.diferencia ? <span className="text-amber-700">Difiere</span> : <span className="text-muted">Igual</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filas.length === 0 && <p className="p-4 text-center text-muted">Nada que mostrar con este filtro.</p>}
      </div>
    </div>
  );
}
