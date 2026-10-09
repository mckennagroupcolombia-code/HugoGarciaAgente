import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Ico } from "../../icons/Ico";
import { CASILLAS_VISIBLES, fmtMedidas, fmtPeso, type Grupo, type Producto } from "./RevisionEmpaque";

/**
 * Pieza «Envío» del Árbol del producto (Diseño de producto): el paquete de UN combo tal como
 * sale a despacho, que es lo que MeLi pide para cobrar el flete. Se abre encima del árbol.
 *
 * Es la misma revisión del TKT-2026-1639 (`revision_empaque`), vista desde el producto: lo que
 * se pesa aquí cuenta en la solicitud y al revés. Tres pasos: 1 Pesar (y confirmar empaque y
 * caja), 2 Medir (el tipo de empaque, que comparten varios productos, o solo este si mide
 * distinto), 3 MeLi (lo verificado contra lo publicado; aplicar es de quien aprueba).
 * Backend: /api/revision-empaque/sku/<sku>/* (sin LLM).
 */

type AtributoMeli = { id: string; nombre: string; unidad: "g" | "cm" };
type Enviar = { id: string; value_name: string; value_struct: { number: number; unit: string } };
type Respuesta =
  | { en_revision: false; sku: string; hay_revision: boolean; meli_pide: AtributoMeli[] }
  | {
      en_revision: true;
      sku: string;
      revision: { id: number; titulo: string; folio: string; creada_por: string | null; meli_refrescado_en: string | null };
      producto: Producto;
      grupo: Grupo | null;
      pieza: { estado: "ok" | "aviso" | "falta"; detalle: string };
      cajas: string[];
      puede_aprobar: boolean;
      meli_pide: AtributoMeli[];
      a_enviar: Enviar[] | null;
    };
type ConDatos = Extract<Respuesta, { en_revision: true }>;
type Paso = "pesar" | "medir" | "meli";

const LADOS = [
  ["largo_cm", "Largo"],
  ["ancho_cm", "Ancho"],
  ["alto_cm", "Alto"],
] as const;
type Medidas = Record<(typeof LADOS)[number][0], string>;

const LOGISTICA: Record<string, string> = {
  cross_docking: "Colecta",
  fulfillment: "Full",
  self_service: "Flex",
  drop_off: "Agencia",
};

function medidasDe(m: { largo_cm: number | null; ancho_cm: number | null; alto_cm: number | null } | null | undefined): Medidas {
  return {
    largo_cm: m?.largo_cm ? String(m.largo_cm) : "",
    ancho_cm: m?.ancho_cm ? String(m.ancho_cm) : "",
    alto_cm: m?.alto_cm ? String(m.alto_cm) : "",
  };
}

function pasoInicial(d: ConDatos): Paso {
  const p = d.producto;
  if (!p.peso_g && !p.omitido) return "pesar";
  if (!p.medidas_finales) return "medir";
  return "meli";
}

export default function EnvioEmergente({ sku, nombre, onCerrar }: { sku: string; nombre: string; onCerrar: () => void }) {
  const qc = useQueryClient();
  const clave = ["envio-producto", sku.toUpperCase()];
  const q = useQuery<Respuesta>({
    queryKey: clave,
    queryFn: () => api.get(`/api/revision-empaque/sku/${encodeURIComponent(sku)}`),
    retry: false,
  });
  const [paso, setPaso] = useState<Paso | null>(null);
  const d = q.data;
  const pasoActual: Paso | null = d?.en_revision ? (paso ?? pasoInicial(d)) : null;

  const recargar = () => qc.invalidateQueries({ queryKey: clave });
  const cerrar = () => {
    void qc.invalidateQueries({ queryKey: ["arbol-producto"] });
    void qc.invalidateQueries({ queryKey: ["revision-empaque"] });
    onCerrar();
  };
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") cerrar(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-3" role="dialog" aria-modal="true"
      aria-label="Peso y medidas del paquete" onClick={cerrar}>
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-surface-panel shadow-xl"
        onClick={(ev) => ev.stopPropagation()}>
        <div className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">Envío · el paquete que MeLi cobra</p>
            <h3 className="truncate text-lg font-bold text-ink" title={nombre}>{nombre}</h3>
            <p className="text-[11.5px] text-muted"><code>{sku}</code>
              {d?.en_revision && d.revision.folio ? <> · cuenta en la revisión global {d.revision.folio}</> : null}</p>
          </div>
          <button type="button" onClick={cerrar} aria-label="Cerrar"
            className="shrink-0 rounded-md border border-border px-2 py-1 text-[12px] text-ink hover:bg-surface-hover">Cerrar</button>
        </div>

        {q.isLoading && <p className="p-6 text-sm text-muted">Leyendo el paquete…</p>}
        {q.isError && <p className="p-6 text-sm text-accent-rose">{(q.error as Error)?.message || "No se pudo leer"}</p>}

        {d && <LoQuePideMeli d={d} />}

        {d && !d.en_revision && <SinRevision sku={sku} hayRevision={d.hay_revision} onIncluido={() => void recargar()} />}

        {d?.en_revision && pasoActual && (
          <>
            <Pasos d={d} paso={pasoActual} setPaso={setPaso} />
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {pasoActual === "pesar" && (
                <PasoPesar key={d.producto.verificado_en ?? "nuevo"} d={d}
                  onGuardado={async () => { await recargar(); setPaso("medir"); }} />
              )}
              {pasoActual === "medir" && (
                <PasoMedir d={d} onGuardado={async (listo) => { await recargar(); if (listo) setPaso("meli"); }} />
              )}
              {pasoActual === "meli" && <PasoMeli d={d} recargar={recargar} irA={setPaso} />}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Los cuatro datos que MeLi pide, con lo verificado debajo: el resumen siempre a la vista. */
function LoQuePideMeli({ d }: { d: Respuesta }) {
  const p = d.en_revision ? d.producto : null;
  const valores = p ? [p.peso_g, ...(p.medidas_finales ?? [null, null, null])] : [null, null, null, null];
  return (
    <div className="shrink-0 border-b border-border bg-accent/5 px-4 py-2.5">
      <p className="text-[12px] text-ink">
        <b>MeLi pide 4 datos del paquete de envío</b>, no del producto suelto: como sale a despacho, con envase, tapa,
        etiqueta, empaque, bolsa de seguridad y caja si la lleva. Con eso cobra el flete.
      </p>
      <div className="mt-1.5 grid grid-cols-4 gap-1.5">
        {d.meli_pide.map((a, i) => {
          const v = valores[i];
          return (
            <div key={a.id} className={`rounded-lg border px-2 py-1 ${v ? "border-accent-leaf/50 bg-accent-leaf/10" : "border-border bg-surface"}`}
              title={a.id}>
              <p className="text-[10.5px] font-bold uppercase text-muted">{a.nombre} ({a.unidad})</p>
              <p className="text-[14px] font-extrabold tabular-nums text-ink">
                {v ? (a.unidad === "g" ? fmtPeso(v) : `${Number(v).toLocaleString("es-CO", { maximumFractionDigits: 1 })} cm`) : "—"}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Pasos({ d, paso, setPaso }: { d: ConDatos; paso: Paso; setPaso: (p: Paso) => void }) {
  const p = d.producto;
  const pasos: { id: Paso; texto: string; hecho: boolean }[] = [
    { id: "pesar", texto: "1 · Pesar", hecho: Boolean(p.peso_g || p.omitido) },
    { id: "medir", texto: "2 · Medir", hecho: Boolean(p.medidas_finales) },
    { id: "meli", texto: "3 · MeLi", hecho: Boolean(p.listo && (!p.diferencia || p.aplicado_en)) },
  ];
  return (
    <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-3 py-2">
      {pasos.map((x) => (
        <button key={x.id} type="button" onClick={() => setPaso(x.id)} aria-pressed={paso === x.id}
          className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-bold ${
            paso === x.id ? "bg-accent text-white" : "bg-border/40 text-ink hover:bg-border/70"}`}>
          {x.hecho ? "✓ " : ""}{x.texto}
        </button>
      ))}
    </div>
  );
}

function SinRevision({ sku, hayRevision, onIncluido }: { sku: string; hayRevision: boolean; onIncluido: () => void }) {
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  if (!hayRevision) return <p className="p-6 text-sm text-muted">Todavía no hay ninguna revisión de pesos y medidas.</p>;
  const incluir = async () => {
    setError("");
    setOcupado(true);
    try {
      await api.post(`/api/revision-empaque/sku/${encodeURIComponent(sku)}/incluir`, {}, { timeoutMs: 60_000 });
      onIncluido();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };
  return (
    <div className="space-y-2 p-4 text-[13px]">
      <p className="text-ink">
        Este combo no estaba en la revisión global de pesos y medidas (se creó después). Agrégalo para pesarlo y medirlo:
        se leen sus publicaciones de MeLi para comparar.
      </p>
      {error && <p className="font-semibold text-accent-rose">{error}</p>}
      <button type="button" className="mck-btn mck-btn-primary px-3 py-1.5 text-[13px] disabled:opacity-50" disabled={ocupado} onClick={() => void incluir()}>
        {ocupado ? "Agregando…" : "Agregar y empezar"}
      </button>
    </div>
  );
}

// ── Paso 1: pesar ────────────────────────────────────────────────────────────────────────

function PasoPesar({ d, onGuardado }: { d: ConDatos; onGuardado: () => Promise<void> }) {
  const p = d.producto;
  const visibles = p.empaque_receta.filter((e) => CASILLAS_VISIBLES.has(e.casilla));
  const cajaReceta = p.empaque_receta.find((e) => e.casilla === "caja")?.sku ?? "";
  const [peso, setPeso] = useState(p.peso_g ? String(p.peso_g) : "");
  const [quitadas, setQuitadas] = useState<Set<string>>(() =>
    p.empaque_ok ? new Set(p.empaque_receta.map((e) => e.sku).filter((s) => !p.empaque_ok!.includes(s))) : new Set());
  const [caja, setCaja] = useState(p.caja && p.caja !== "ninguna" ? p.caja : cajaReceta);
  const [cajaOtra, setCajaOtra] = useState(p.caja_otra ?? "");
  const [nota, setNota] = useState(p.nota ?? "");
  const [omitiendo, setOmitiendo] = useState(false);
  const [motivo, setMotivo] = useState(p.motivo_omitido ?? "");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const pesoRef = useRef<HTMLInputElement>(null);
  useEffect(() => { pesoRef.current?.focus(); }, []);

  const enviar = async (cuerpo: Record<string, unknown>) => {
    setError("");
    setGuardando(true);
    try {
      await api.post(`/api/revision-empaque/sku/${encodeURIComponent(d.sku)}/producto`, cuerpo);
      await onGuardado();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };
  // Guardar el peso no borra las medidas propias que ya tenga (se editan en el paso 2).
  const guardar = () => enviar({
    peso_g: peso,
    empaque_ok: p.empaque_receta.map((e) => e.sku).filter((s) => !quitadas.has(s)),
    caja: caja || "ninguna",
    caja_otra: cajaOtra,
    nota,
    ...(p.largo_cm ? { largo_cm: p.largo_cm, ancho_cm: p.ancho_cm, alto_cm: p.alto_cm } : {}),
  });

  return (
    <div className="space-y-3 text-[13px]">
      <p className="text-muted">
        Arma el paquete <b>como sale a despacho</b> y ponlo en la balanza. Es el peso que MeLi usa para cobrar el flete:
        si se queda corto, MeLi lo corrige al recibirlo y cobra la diferencia.
      </p>
      <label className="block">
        <span className="font-bold text-ink"><Ico e="⚖️" /> Peso del paquete listo para despachar (gramos)</span>
        <input ref={pesoRef} className="mt-1 block w-full max-w-[14rem] rounded-md border border-border bg-surface px-2 py-1 text-[20px] font-bold"
          inputMode="decimal" placeholder="Ej. 630" value={peso} onChange={(e) => setPeso(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !guardando) void guardar(); }} />
        {p.peso_meli ? <span className="mt-0.5 block text-[11.5px] text-muted">En MeLi dice {fmtPeso(p.peso_meli)}.</span> : null}
      </label>

      {visibles.length > 0 && (
        <div>
          <p className="font-bold text-ink"><Ico e="📦" /> ¿Lleva este empaque? (según la receta)</p>
          <p className="text-[11.5px] text-muted">Toca para quitar lo que en realidad no lleva.</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {visibles.map((e) => {
              const lleva = !quitadas.has(e.sku);
              return (
                <button key={e.sku} type="button" aria-pressed={lleva}
                  onClick={() => setQuitadas((s) => { const n = new Set(s); if (lleva) n.add(e.sku); else n.delete(e.sku); return n; })}
                  className={`rounded-lg border px-2 py-1 text-[12px] ${lleva
                    ? "border-accent-leaf/50 bg-accent-leaf/10 text-ink" : "border-border bg-surface text-muted line-through"}`}>
                  {lleva ? "✓ " : ""}{e.nombre}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="font-bold text-ink">¿Va en caja?</span>
          <select className="mt-1 block rounded-md border border-border bg-surface px-2 py-1 text-[13px]" value={caja} onChange={(e) => setCaja(e.target.value)}>
            <option value="">No lleva caja</option>
            {d.cajas.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value="otra">Otra caja…</option>
          </select>
        </label>
        {caja === "otra" && (
          <input className="rounded-md border border-border bg-surface px-2 py-1 text-[13px]" placeholder="¿Cuál caja? (medidas o nombre)"
            value={cajaOtra} onChange={(e) => setCajaOtra(e.target.value)} />
        )}
        {cajaReceta && caja !== cajaReceta && <span className="text-[11.5px] text-accent-sun">La receta dice {cajaReceta}</span>}
        {!cajaReceta && caja && <span className="text-[11.5px] text-accent-sun">La receta no tiene caja: queda anotado para agregarla</span>}
      </div>

      <input className="w-full rounded-md border border-border bg-surface px-2 py-1 text-[13px]" placeholder="Nota (opcional)"
        value={nota} onChange={(e) => setNota(e.target.value)} />

      {error && <p className="font-semibold text-accent-rose">{error}</p>}

      {omitiendo ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-accent-sun/50 bg-accent-sun/10 p-2">
          <input className="min-w-[14rem] flex-1 rounded-md border border-border bg-surface px-2 py-1 text-[13px]"
            placeholder="¿Por qué no se pudo pesar? (p. ej. no hay en bodega)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <button type="button" className="mck-btn mck-btn-ghost px-3 py-1.5 text-[13px] disabled:opacity-50" disabled={guardando}
            onClick={() => void enviar({ omitido: true, motivo_omitido: motivo })}>Guardar sin peso</button>
          <button type="button" className="text-[12.5px] text-muted" onClick={() => setOmitiendo(false)}>Cancelar</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="mck-btn mck-btn-primary px-3 py-1.5 text-[14px] disabled:opacity-50" disabled={guardando} onClick={() => void guardar()}>
            {guardando ? "Guardando…" : "Guardar y medir →"}
          </button>
          <button type="button" className="text-[12.5px] font-semibold text-accent-sun" onClick={() => setOmitiendo(true)}>No lo puedo pesar</button>
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

// ── Paso 2: medir ────────────────────────────────────────────────────────────────────────

function CamposMedidas({ med, setMed, onEnter }: { med: Medidas; setMed: (m: Medidas) => void; onEnter: () => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {LADOS.map(([k, texto]) => (
        <label key={k} className="block text-[12px] text-muted">
          {texto} (cm)
          <input className="mt-0.5 block w-20 rounded-md border border-border bg-surface px-2 py-1 text-[14px] text-ink" inputMode="decimal"
            value={med[k]} onChange={(e) => setMed({ ...med, [k]: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") onEnter(); }} />
        </label>
      ))}
    </div>
  );
}

function PasoMedir({ d, onGuardado }: { d: ConDatos; onGuardado: (listo: boolean) => Promise<void> }) {
  const p = d.producto;
  const g = d.grupo;
  const propias = Boolean(p.largo_cm && p.ancho_cm && p.alto_cm);
  const [modo, setModo] = useState<"grupo" | "propias">(propias ? "propias" : "grupo");
  const [editando, setEditando] = useState(!g?.medido);
  const [medGrupo, setMedGrupo] = useState<Medidas>(() => medidasDe(g));
  const [medProp, setMedProp] = useState<Medidas>(() => medidasDe(p));
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const pesado = Boolean(p.peso_g);

  const enviar = async (ruta: "grupo" | "medidas", cuerpo: Record<string, unknown>) => {
    setError("");
    setGuardando(true);
    try {
      await api.post(`/api/revision-empaque/sku/${encodeURIComponent(d.sku)}/${ruta}`, cuerpo);
      // Medir su tipo de empaque = volver a usarlo: se quitan las medidas propias que tuviera.
      if (ruta === "grupo" && propias) await api.post(`/api/revision-empaque/sku/${encodeURIComponent(d.sku)}/medidas`, {});
      await onGuardado(pesado);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };
  const otros = g ? g.productos - 1 : 0;

  return (
    <div className="space-y-3 text-[13px]">
      <p className="text-muted">
        Mide el paquete <b>cerrado, como sale a despacho</b>: largo × ancho × alto en centímetros. MeLi recibe centímetros
        enteros: se redondea hacia arriba (quedarse corto sale más caro que pasarse un poco).
      </p>

      {g && (
        <div className={`space-y-2 rounded-xl border p-3 ${modo === "grupo" ? "border-accent/40" : "border-border opacity-80"}`}>
          <label className="flex items-start gap-2">
            <input type="radio" className="mt-1" checked={modo === "grupo"} onChange={() => setModo("grupo")} />
            <span>
              <span className="block font-bold text-ink">{g.solo ? "Este combo se mide solo" : `Tipo de empaque: ${g.nombre}`}</span>
              <span className="block text-[11.5px] text-muted">
                {g.solo
                  ? "Su receta no tiene envase, bolsa ni caja: no comparte medidas con otros."
                  : otros > 0
                    ? `Lo comparten ${otros} producto(s) más (${g.ejemplos.filter((x) => x !== p.nombre).slice(0, 3).join(" · ")}): la medida vale para todos.`
                    : "Por ahora solo lo usa este combo."}
              </span>
            </span>
          </label>
          {modo === "grupo" && (
            g.medido && !editando ? (
              <div className="flex flex-wrap items-center gap-2 pl-6">
                <span className="rounded-lg border border-accent-leaf/50 bg-accent-leaf/10 px-2 py-1 font-bold text-ink">
                  {fmtMedidas([g.largo_cm, g.ancho_cm, g.alto_cm])}
                </span>
                <span className="text-[11.5px] text-muted">medido por {g.medido_por ?? "—"} · {g.medido_en?.slice(0, 10) ?? ""}</span>
                {propias && (
                  <button type="button" className="mck-btn mck-btn-primary px-3 py-1.5 text-[13px] disabled:opacity-50" disabled={guardando}
                    onClick={() => void enviar("medidas", {})}>Usar estas medidas</button>
                )}
                <button type="button" className="text-[12.5px] font-semibold text-accent" onClick={() => setEditando(true)}>Volver a medir</button>
              </div>
            ) : (
              <div className="space-y-2 pl-6">
                <CamposMedidas med={medGrupo} setMed={setMedGrupo} onEnter={() => { if (!guardando) void enviar("grupo", medGrupo); }} />
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="mck-btn mck-btn-primary px-3 py-1.5 text-[13px] disabled:opacity-50" disabled={guardando}
                    onClick={() => void enviar("grupo", medGrupo)}>
                    <Ico e="📏" /> {guardando ? "Guardando…" : otros > 0 ? `Guardar para los ${otros + 1}` : "Guardar"}
                  </button>
                  {g.sugerido_meli && !g.medido && (
                    <button type="button" className="text-[12px] font-semibold text-accent"
                      onClick={() => setMedGrupo({ largo_cm: String(g.sugerido_meli![0]), ancho_cm: String(g.sugerido_meli![1]), alto_cm: String(g.sugerido_meli![2]) })}>
                      Precargar lo de MeLi ({fmtMedidas(g.sugerido_meli)}) y verificar con la regla
                    </button>
                  )}
                  {g.medido && <button type="button" className="text-[12.5px] text-muted" onClick={() => setEditando(false)}>Cancelar</button>}
                </div>
              </div>
            )
          )}
        </div>
      )}

      {!g?.solo && (
        <div className={`space-y-2 rounded-xl border p-3 ${modo === "propias" ? "border-accent/40" : "border-border opacity-80"}`}>
          <label className="flex items-start gap-2">
            <input type="radio" className="mt-1" checked={modo === "propias"} onChange={() => setModo("propias")} />
            <span>
              <span className="block font-bold text-ink">Este producto mide distinto a su tipo de empaque</span>
              <span className="block text-[11.5px] text-muted">Solo cambia este combo; los demás siguen con la medida de su tipo.</span>
            </span>
          </label>
          {modo === "propias" && (
            <div className="space-y-2 pl-6">
              <CamposMedidas med={medProp} setMed={setMedProp} onEnter={() => { if (!guardando) void enviar("medidas", medProp); }} />
              <button type="button" className="mck-btn mck-btn-primary px-3 py-1.5 text-[13px] disabled:opacity-50" disabled={guardando}
                onClick={() => void enviar("medidas", medProp)}>
                <Ico e="📏" /> {guardando ? "Guardando…" : "Guardar solo para este"}
              </button>
            </div>
          )}
        </div>
      )}

      {!pesado && !p.omitido && <p className="text-[12px] text-accent-sun">Falta el peso (paso 1) para que quede listo.</p>}
      {error && <p className="font-semibold text-accent-rose">{error}</p>}
    </div>
  );
}

// ── Paso 3: comparar con MeLi y aplicar ──────────────────────────────────────────────────

type ResultadoAplicar = { resultados: { sku: string; ok: boolean; error?: string; publicaciones?: { id: string; ok: boolean; error?: string }[] }[] };

function PasoMeli({ d, recargar, irA }: { d: ConDatos; recargar: () => Promise<void>; irA: (p: Paso) => void }) {
  const p = d.producto;
  const [aviso, setAviso] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const full = p.meli.some((m) => m.logistica === "fulfillment");

  const llamar = async (ruta: "releer" | "aplicar") => {
    if (ruta === "aplicar" && !window.confirm(
      `Se escribirá peso y medidas en ${p.meli.length} publicación(es) de MeLi de ${d.sku}. ¿Seguir?`)) return;
    setAviso("");
    setError("");
    setOcupado(true);
    try {
      if (ruta === "releer") {
        const r = await api.post<{ publicaciones: number }>(`/api/revision-empaque/sku/${encodeURIComponent(d.sku)}/meli/releer`, {}, { timeoutMs: 60_000 });
        setAviso(`MeLi leído: ${r.publicaciones} publicación(es) activas o pausadas con este SKU.`);
      } else {
        const r = await api.post<ResultadoAplicar>(`/api/revision-empaque/sku/${encodeURIComponent(d.sku)}/meli/aplicar`, {}, { timeoutMs: 120_000 });
        const x = r.resultados[0];
        if (x?.ok) setAviso("Aplicado en MeLi.");
        else setError(x?.error || (x?.publicaciones ?? []).filter((y) => !y.ok).map((y) => `${y.id}: ${y.error}`).join("; ") || "No se aplicó");
      }
      await recargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  if (!p.listo) {
    return (
      <div className="space-y-2 text-[13px]">
        <p className="text-ink">{p.omitido ? `Marcado sin peso: ${p.motivo_omitido}.` : "Todavía falta el peso o las medidas."}</p>
        <button type="button" className="mck-btn mck-btn-primary px-3 py-1.5 text-[13px]" onClick={() => irA(p.peso_g ? "medir" : "pesar")}>
          {p.peso_g ? "Ir a medir" : "Ir a pesar"}
        </button>
      </div>
    );
  }

  const enviar = d.a_enviar ?? [];
  const meli = [p.peso_meli, ...(p.medidas_meli ?? [null, null, null])];
  return (
    <div className="space-y-3 text-[13px]">
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-[12.5px]">
          <thead className="bg-border/40 text-[11px] uppercase text-muted">
            <tr><th className="p-2">Dato que MeLi pide</th><th className="p-2">En MeLi hoy</th><th className="p-2">Verificado (se envía)</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {d.meli_pide.map((a, i) => {
              const nuevo = enviar[i]?.value_struct.number;
              const actual = meli[i];
              const distinto = p.meli.length > 0 && (actual == null || (a.unidad === "g"
                ? Math.abs(Number(actual) - Number(nuevo)) > Math.max(10, Number(nuevo) * 0.05)
                : Math.abs(Number(actual) - Number(nuevo)) > 0.5));
              return (
                <tr key={a.id}>
                  <td className="p-2"><span className="font-semibold text-ink">{a.nombre} del paquete</span>
                    <code className="block text-[10px] text-muted">{a.id}</code></td>
                  <td className="p-2 tabular-nums text-muted">{p.meli.length ? (actual != null ? `${actual} ${a.unidad}` : "vacío") : "—"}</td>
                  <td className={`p-2 font-bold tabular-nums ${distinto ? "text-accent-sun" : "text-ink"}`}>
                    {enviar[i]?.value_name ?? "—"}{distinto ? " · distinto" : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {p.meli.length === 0 ? (
        <p className="text-muted">Sin publicación activa ni pausada en MeLi con este SKU: el paquete queda guardado como referencia.</p>
      ) : (
        <ul className="space-y-1">
          {p.meli.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2 text-[12px]">
              <code className="text-ink">{m.id}</code>
              <span className="text-muted">{m.status === "active" ? "activa" : m.status === "paused" ? "pausada" : m.status}</span>
              {m.logistica && <span className="rounded border border-border px-1 text-[10.5px] text-muted">{LOGISTICA[m.logistica] ?? m.logistica}</span>}
              <span className="min-w-0 flex-1 truncate text-muted" title={m.titulo}>{m.titulo}</span>
            </li>
          ))}
        </ul>
      )}
      {full && (
        <p className="rounded-lg border border-accent-sun/50 bg-accent-sun/10 px-2 py-1.5 text-[12px] text-ink">
          Hay publicación en <b>Full</b>: ahí MeLi mide el paquete en su bodega y puede reemplazar este dato.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {d.puede_aprobar && p.meli.length > 0 && (
          <button type="button" className="mck-btn mck-btn-primary px-3 py-1.5 text-[13px] disabled:opacity-50" disabled={ocupado} onClick={() => void llamar("aplicar")}>
            <Ico e="✅" /> {p.aplicado_en && !p.diferencia ? "Aplicar otra vez" : "Aplicar en MeLi"}
          </button>
        )}
        <button type="button" className="mck-btn mck-btn-ghost px-3 py-1.5 text-[13px] disabled:opacity-50" disabled={ocupado} onClick={() => void llamar("releer")}>
          <Ico e="🔄" /> Releer MeLi
        </button>
        {p.aplicado_en && <span className="text-[12px] text-accent-leaf">Aplicado el {p.aplicado_en.slice(0, 16).replace("T", " ")}</span>}
        {!p.aplicado_en && !p.diferencia && p.meli.length > 0 && <span className="text-[12px] text-accent-leaf">MeLi ya tiene estos datos.</span>}
      </div>
      {!d.puede_aprobar && p.meli.length > 0 && p.diferencia && (
        <p className="text-[12px] text-muted">
          Queda listo para aprobar: lo aplica {d.revision.creada_por || "quien creó la revisión"} o un administrador, desde aquí o
          desde la solicitud {d.revision.folio || "de la revisión"} (paso 4). Antes de escribir se relee cada publicación.
        </p>
      )}
      {ocupado && <p className="text-muted">Hablando con MeLi…</p>}
      {aviso && <p className="font-semibold text-accent-leaf">{aviso}</p>}
      {error && <p className="font-semibold text-accent-rose">{error}</p>}
    </div>
  );
}
