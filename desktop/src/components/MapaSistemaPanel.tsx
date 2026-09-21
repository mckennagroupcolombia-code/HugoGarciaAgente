import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, fetchAuthBlobUrl } from "../api/client";
import { useAppStore } from "../stores/app";
import MapaAppFlujo from "./MapaAppFlujo";

/**
 * Mapa del sistema: el flujo de un producto y de un pago, con conteos vivos.
 *
 * Cada caja es un eslabón real (combo en Alegra → documento → EAN → etiqueta →
 * publicación) y dice cuántos productos lo pasan y cuántos se quedan. Nació del
 * propionato de calcio: tenía documento completo y nunca pudo tener etiqueta,
 * porque no existe un combo en Alegra que llegue a él — y ninguna pantalla lo decía.
 *
 * Solo lee `/api/mapa-sistema/*` (app/services/mapa_producto.py): sin LLM y sin
 * llamar a Alegra ni a MeLi, así que se puede dejar abierto.
 */

type Atascado = { ref: string; nombre: string; estado: "aviso" | "falta"; detalle: string };
type Tramo = {
  id: string;
  titulo: string;
  sub: string;
  ok: number;
  aviso: number;
  falta: number;
  total: number;
  atascados: Atascado[];
};
type Huerfano = { archivo: string; titulo: string; estado: string; referencia: string };
type PasoPago = { id: string; titulo: string; quien: string; n: number; total: number };
type Flujo = {
  producto: Tramo[];
  docs_huerfanos: Huerfano[];
  ciclo_pago: PasoPago[];
  pagos_fuera: Record<string, { n: number; total: number }>;
  totales: { combos: number; documentos: number; etiquetas: number; ean: number };
  generado: string;
};
type Diagrama = { nombre: string; titulo: string; grupo: string; resumen: string };
type Propuesta = {
  archivo: string;
  doc_titulo: string;
  sku: string;
  mp_nombre: string;
  combos: string[];
  exacto: boolean;
  conflicto: boolean;
  otros: { sku: string; mp_nombre: string }[];
};
type Propuestas = { propuestas: Propuesta[]; total: number; exactas: number; conflictos: number };
type Estado = { estado?: string; servicios?: Record<string, boolean> };

const NODO_W = 168;
const NODO_H = 96;
const PASO = 214;
const X0 = 16;
const Y_NODO = 34;

function cop(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-CO");
}

function Barra({ t, x, y, w }: { t: Tramo; x: number; y: number; w: number }) {
  const tot = Math.max(1, t.total);
  const wOk = (t.ok / tot) * w;
  const wAv = (t.aviso / tot) * w;
  const wFa = (t.falta / tot) * w;
  return (
    <g>
      <rect x={x} y={y} width={w} height={7} rx={3.5} className="fill-surface-input" />
      <rect x={x} y={y} width={wOk} height={7} rx={3.5} className="fill-accent-leaf" />
      <rect x={x + wOk} y={y} width={wAv} height={7} className="fill-accent-sun" />
      <rect x={x + wOk + wAv} y={y} width={wFa} height={7} rx={wFa > 4 ? 3.5 : 0} className="fill-accent-rose" />
    </g>
  );
}

/**
 * Pasar documentos de «unidos por parecido de nombre» a «unidos por SKU», en lote.
 * Vienen marcados solo los de nombre idéntico; los parecidos hay que mirarlos, y los
 * conflictos (dos materias primas reclaman el mismo documento) no se pueden marcar:
 * ahí falta un documento o sobra una materia prima, y eso no lo decide un botón.
 */
function UnirPorSku() {
  const qc = useQueryClient();
  const datos = useQuery({
    queryKey: ["mapa-sistema-propuestas-sku"],
    queryFn: () => api.get<Propuestas>("/api/mapa-sistema/documentos/propuestas-sku"),
  });
  const [marcados, setMarcados] = useState<Set<string> | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);

  const lista = datos.data?.propuestas ?? [];
  const sel = marcados ?? new Set(lista.filter((p) => p.exacto).map((p) => p.archivo));
  const alternar = (archivo: string) => {
    const s = new Set(sel);
    if (s.has(archivo)) s.delete(archivo);
    else s.add(archivo);
    setMarcados(s);
  };

  const fijar = async () => {
    const items = lista.filter((p) => sel.has(p.archivo) && !p.conflicto).map((p) => ({ archivo: p.archivo, sku: p.sku }));
    if (!items.length) return;
    if (!window.confirm(`Se escribirá el SKU de la materia prima en ${items.length} documento(s). Cada uno queda con respaldo. ¿Continuar?`)) return;
    setOcupado(true);
    setResultado(null);
    try {
      const r = await api.post<{ hechos: unknown[]; errores: { archivo: string; error: string }[] }>(
        "/api/mapa-sistema/documentos/fijar-sku",
        { items },
      );
      setResultado(
        `${r.hechos.length} documento(s) unidos por SKU` +
          (r.errores.length ? ` · ${r.errores.length} con error: ${r.errores.map((e) => `${e.archivo} (${e.error})`).join("; ")}` : ""),
      );
      setMarcados(null);
      await qc.invalidateQueries({ queryKey: ["mapa-sistema-propuestas-sku"] });
      await qc.invalidateQueries({ queryKey: ["mapa-sistema-flujo"] });
      await qc.invalidateQueries({ queryKey: ["mapa-sistema-combos"] });
    } catch (e) {
      setResultado((e as Error)?.message || "No se pudo fijar");
    } finally {
      setOcupado(false);
    }
  };

  if (datos.isLoading) return <p className="mt-3 text-[11.5px] text-muted">Buscando documentos que se pueden unir por SKU…</p>;
  if (!lista.length) return null;

  return (
    <div className="mt-3 rounded-lg border border-accent/40 bg-accent/5 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-xs font-bold text-ink">Unir por SKU: {lista.length} documentos hoy dependen del parecido de nombre</h4>
        <button
          onClick={fijar}
          disabled={ocupado || sel.size === 0}
          className="rounded-md border border-accent bg-accent/15 px-2.5 py-1 text-[11px] font-bold text-ink hover:bg-accent/25 disabled:opacity-50"
        >
          {ocupado ? "Escribiendo…" : `Fijar el SKU en ${sel.size}`}
        </button>
      </div>
      <p className="mt-1 max-w-3xl text-[11px] text-muted">
        Vienen marcados los {datos.data?.exactas} de nombre idéntico. Los demás son parecidos: míralos antes de marcarlos. Al fijarlo,
        el documento declara su materia prima y deja de depender del nombre — que es lo que hace que se redacten documentos repetidos.
      </p>
      {resultado && <p className="mt-2 rounded bg-surface px-2 py-1 text-[11px] text-ink">{resultado}</p>}
      <ul className="mt-2 max-h-80 space-y-0.5 overflow-y-auto text-[11.5px]">
        {lista.map((p) => (
          <li key={p.archivo} className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-2 border-b border-border/50 py-1 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <input
              id={`sku-${p.archivo}`}
              type="checkbox"
              checked={sel.has(p.archivo) && !p.conflicto}
              disabled={p.conflicto}
              onChange={() => alternar(p.archivo)}
              aria-label={`Unir ${p.doc_titulo}`}
            />
            <label htmlFor={`sku-${p.archivo}`} className="truncate text-ink">
              📄 {p.doc_titulo}
            </label>
            <span className="col-start-2 truncate text-ink-secondary sm:col-start-auto">
              ⚗️ {p.mp_nombre} <code className="text-[10px] text-muted">{p.sku}</code>
              {p.conflicto && <span className="text-accent-rose"> · también {p.otros.map((o) => o.sku).join(", ")}</span>}
            </span>
            <span
              className={`col-start-2 text-[10px] font-bold uppercase sm:col-start-auto ${
                p.conflicto ? "text-accent-rose" : p.exacto ? "text-accent-leaf" : "text-accent-sun"
              }`}
            >
              {p.conflicto ? "conflicto" : p.exacto ? "idéntico" : "parecido"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function MapaSistemaPanel() {
  const setPanel = useAppStore((s) => s.setPanel);
  const [sel, setSel] = useState<string>("documento");
  const [flujoSel, setFlujoSel] = useState<string | null>(null);
  const [expandido, setExpandido] = useState(false);
  const [urlDiagrama, setUrlDiagrama] = useState<string | null>(null);

  const flujo = useQuery({
    queryKey: ["mapa-sistema-flujo"],
    queryFn: () => api.get<Flujo>("/api/mapa-sistema/flujo"),
    refetchInterval: 30_000,
  });
  const estado = useQuery({
    queryKey: ["mapa-sistema-status"],
    queryFn: () => api.get<Estado>("/api/status"),
    refetchInterval: 30_000,
  });
  const diagramas = useQuery({
    queryKey: ["mapa-sistema-diagramas"],
    queryFn: () => api.get<{ diagramas: Diagrama[] }>("/api/mapa-sistema/diagramas"),
  });

  const listaFlujos = diagramas.data?.diagramas ?? [];
  const verDiagrama = listaFlujos.find((g) => g.nombre === flujoSel) ?? listaFlujos[0] ?? null;
  const nombreDiagrama = verDiagrama?.nombre ?? null;

  // El HTML de Archify se pide autenticado y se monta como blob: un <iframe src> plano
  // no manda el token, y el diagrama muestra la estructura interna del sistema.
  useEffect(() => {
    let vivo = true;
    let creada: string | null = null;
    setUrlDiagrama(null);
    if (nombreDiagrama) {
      fetchAuthBlobUrl(`/api/mapa-sistema/diagramas/${nombreDiagrama}`).then((u) => {
        creada = u;
        if (vivo) setUrlDiagrama(u);
        else if (u) URL.revokeObjectURL(u);
      });
    }
    return () => {
      vivo = false;
      if (creada) URL.revokeObjectURL(creada);
    };
  }, [nombreDiagrama]);

  const grupos = useMemo(() => {
    const out: { grupo: string; items: Diagrama[] }[] = [];
    for (const g of listaFlujos) {
      const ult = out[out.length - 1];
      if (ult && ult.grupo === g.grupo) ult.items.push(g);
      else out.push({ grupo: g.grupo, items: [g] });
    }
    return out;
  }, [listaFlujos]);

  const d = flujo.data;
  const tramo = useMemo(() => d?.producto.find((t) => t.id === sel) ?? null, [d, sel]);
  const verHuerfanos = sel === "huerfanos";
  const anchoSvg = X0 * 2 + PASO * 4 + NODO_W;

  return (
    <div className="space-y-5 [&>*]:mx-auto [&>*]:max-w-6xl [&>section:first-of-type]:max-w-[1840px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">Mapa del sistema</h2>
          <p className="mt-1 max-w-3xl text-xs text-muted">
            Toda la aplicación como un diagrama de flujo: las etapas del negocio en secuencia, qué está detenido en cada una,
            y debajo los flujos detallados y la cadena de cada producto. Toca cualquier caja para entrar.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent-leaf" />
            En vivo · cada 30 s
          </span>
          <button
            onClick={() => flujo.refetch()}
            className="rounded-lg border border-border bg-surface-input px-2.5 py-1.5 text-xs text-ink hover:bg-surface-hover"
          >
            Actualizar
          </button>
        </div>
      </div>

      {flujo.isError && (
        <div className="rounded-lg border border-accent-rose/40 bg-accent-rose/10 px-3 py-2 text-xs text-ink">
          No se pudo leer el mapa: {(flujo.error as Error)?.message}
        </div>
      )}

      {/* ── 0. La aplicación como diagrama de flujo navegable ── */}
      <MapaAppFlujo
        titulosDiagramas={Object.fromEntries(listaFlujos.map((g) => [g.nombre, g.titulo]))}
        onVerDiagrama={(nombre) => {
          setFlujoSel(nombre);
          document.getElementById("flujos-del-proyecto")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      />

      {/* ── 0b. Flujos del proyecto (Archify) ── */}
      <section id="flujos-del-proyecto" className="scroll-mt-4 rounded-xl border border-border bg-surface-panel p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-ink">Los flujos del proyecto</h3>
            <p className="mt-0.5 max-w-3xl text-[11px] text-muted">
              Toda la lógica, con el mismo lenguaje: una franja por persona o sistema y el tiempo de izquierda a derecha. Empieza por el
              mapa global y entra a cada flujo. Dentro del diagrama hay zoom, búsqueda y recorridos guiados.
            </p>
          </div>
          {verDiagrama && (
            <button
              onClick={() => setExpandido(true)}
              className="rounded-lg border border-border bg-surface-input px-2.5 py-1.5 text-xs text-ink hover:bg-surface-hover"
            >
              Pantalla completa
            </button>
          )}
        </div>
        <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="Flujos del proyecto" className="space-y-3">
            {grupos.map((gr) => (
              <div key={gr.grupo}>
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted">{gr.grupo}</div>
                <ul className="space-y-1">
                  {gr.items.map((g) => {
                    const activo = verDiagrama?.nombre === g.nombre;
                    return (
                      <li key={g.nombre}>
                        <button
                          onClick={() => setFlujoSel(g.nombre)}
                          aria-current={activo ? "true" : undefined}
                          className={`w-full rounded-lg border px-2.5 py-1.5 text-left ${
                            activo ? "border-accent bg-accent/15" : "border-border bg-surface-input hover:bg-surface-hover"
                          }`}
                        >
                          <div className="text-xs font-bold text-ink">{g.titulo}</div>
                          <div className="text-[10.5px] leading-snug text-muted">{g.resumen}</div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {diagramas.data && listaFlujos.length === 0 && (
              <p className="text-xs text-muted">
                Aún no hay diagramas generados. Se crean con <code>scripts/diagramas_arquitectura.py entregar</code>.
              </p>
            )}
          </nav>
          <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-white">
            {urlDiagrama && verDiagrama ? (
              <iframe key={verDiagrama.nombre} src={urlDiagrama} title={verDiagrama.titulo} className="h-[78vh] min-h-[560px] w-full border-0" />
            ) : (
              <div className="flex h-[40vh] items-center justify-center text-xs text-muted">
                {diagramas.isLoading || verDiagrama ? "Cargando el diagrama…" : "Elige un flujo"}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── 1. Cadena del producto ── */}
      <section className="rounded-xl border border-border bg-surface-panel p-4">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-bold text-ink">La cadena de un producto</h3>
          {d && (
            <span className="text-[11px] text-muted">
              {d.totales.combos} combos · {d.totales.documentos} documentos · {d.totales.ean} códigos · {d.totales.etiquetas}{" "}
              etiquetas
            </span>
          )}
        </div>
        <p className="mb-3 max-w-3xl text-[11px] text-muted">
          Todo cuelga del <b className="text-ink">combo en Alegra</b>: de su SKU de venta nace el código EAN, y sin código el
          generador de etiquetas lo salta. El documento técnico describe la materia prima y el combo lo hereda por su receta.
        </p>

        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${anchoSvg} 218`} className="min-w-[760px]" role="img" aria-label="Flujo de un producto con conteos vivos">
            <defs>
              <marker id="ms-flecha" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" className="fill-muted" />
              </marker>
            </defs>

            {d?.producto.map((t, i) => {
              const x = X0 + i * PASO;
              const activo = sel === t.id;
              const roto = t.falta > 0;
              return (
                <g key={t.id}>
                  {i > 0 && (
                    <>
                      <line
                        x1={x - (PASO - NODO_W) + 3}
                        y1={Y_NODO + NODO_H / 2}
                        x2={x - 4}
                        y2={Y_NODO + NODO_H / 2}
                        className="stroke-muted"
                        strokeWidth={1.4}
                        strokeDasharray="5 4"
                        markerEnd="url(#ms-flecha)"
                      >
                        <animate attributeName="stroke-dashoffset" from="18" to="0" dur="1.1s" repeatCount="indefinite" />
                      </line>
                    </>
                  )}
                  <g onClick={() => setSel(t.id)} className="cursor-pointer" role="button" aria-label={`${t.titulo}: ${t.falta} sin resolver`}>
                    <rect
                      x={x}
                      y={Y_NODO}
                      width={NODO_W}
                      height={NODO_H}
                      rx={10}
                      className={activo ? "fill-surface-hover stroke-accent" : "fill-surface-input stroke-border"}
                      strokeWidth={activo ? 2 : 1}
                    />
                    <text x={x + 12} y={Y_NODO + 22} className="fill-ink" fontSize={12.5} fontWeight={700}>
                      {t.titulo}
                    </text>
                    <text x={x + 12} y={Y_NODO + 37} className="fill-muted" fontSize={10}>
                      {t.sub}
                    </text>
                    <Barra t={t} x={x + 12} y={Y_NODO + 48} w={NODO_W - 24} />
                    <text x={x + 12} y={Y_NODO + 76} fontSize={11} className="fill-ink">
                      <tspan className="fill-accent-leaf" fontWeight={700}>
                        {t.ok}
                      </tspan>
                      <tspan className="fill-muted"> ok</tspan>
                      {t.aviso > 0 && (
                        <>
                          <tspan className="fill-muted"> · </tspan>
                          <tspan className="fill-accent-sun" fontWeight={700}>
                            {t.aviso}
                          </tspan>
                          <tspan className="fill-muted"> aviso</tspan>
                        </>
                      )}
                    </text>
                    {roto && (
                      <g>
                        <rect x={x + NODO_W - 72} y={Y_NODO - 9} width={64} height={18} rx={9} className="fill-accent-rose" />
                        <text x={x + NODO_W - 40} y={Y_NODO + 4} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#fff">
                          {t.falta} faltan
                        </text>
                      </g>
                    )}
                  </g>
                </g>
              );
            })}

            {/* Documentos huérfanos: existen, pero ningún combo llega a ellos */}
            {d && d.docs_huerfanos.length > 0 && (
              <g onClick={() => setSel("huerfanos")} className="cursor-pointer" role="button">
                <path
                  d={`M${X0 + PASO + NODO_W / 2},${Y_NODO + NODO_H} v26`}
                  className="stroke-accent-rose"
                  strokeWidth={1.4}
                  strokeDasharray="3 3"
                  fill="none"
                />
                <rect
                  x={X0 + PASO - 6}
                  y={Y_NODO + NODO_H + 26}
                  width={NODO_W + 12}
                  height={44}
                  rx={9}
                  className={verHuerfanos ? "fill-accent-rose/20 stroke-accent-rose" : "fill-accent-rose/10 stroke-accent-rose/60"}
                  strokeWidth={verHuerfanos ? 2 : 1}
                />
                <text x={X0 + PASO + 6} y={Y_NODO + NODO_H + 44} className="fill-ink" fontSize={11.5} fontWeight={700}>
                  {d.docs_huerfanos.length} documentos sin combo
                </text>
                <text x={X0 + PASO + 6} y={Y_NODO + NODO_H + 59} className="fill-muted" fontSize={9.5}>
                  escritos, pero nada los vende
                </text>
              </g>
            )}
          </svg>
        </div>

        {/* Detalle del eslabón elegido */}
        <div className="mt-3 rounded-lg border border-border bg-surface p-3">
          {verHuerfanos && d ? (
            <>
              <h4 className="text-xs font-bold text-ink">Documentos que ningún combo alcanza</h4>
              <p className="mt-1 max-w-3xl text-[11px] text-muted">
                El documento está escrito, pero no existe en Alegra un combo cuya receta use esa materia prima. Sin combo no hay SKU
                de venta; sin SKU no hay código EAN; sin código no nace la etiqueta. Es exactamente lo que le pasa al propionato de
                calcio. Se arregla creando el combo en Alegra, no redactando otro documento.
              </p>
              <ul className="mt-2 grid max-h-72 gap-x-4 gap-y-1 overflow-y-auto text-[11.5px] sm:grid-cols-2">
                {d.docs_huerfanos.map((h) => (
                  <li key={h.archivo} className="flex items-baseline justify-between gap-2 border-b border-border/50 py-1">
                    <span className="truncate text-ink">{h.titulo}</span>
                    <span className="shrink-0 text-[10px] text-muted">{h.referencia || "sin SKU"} · {h.estado}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : tramo ? (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="text-xs font-bold text-ink">
                  {tramo.titulo}: {tramo.falta + tramo.aviso} de {tramo.total} no pasan limpio
                </h4>
                <button onClick={() => setPanel("combos")} className="text-[11px] text-accent hover:underline">
                  Ver cada combo con sus piezas →
                </button>
              </div>
              {tramo.id === "documento" && <UnirPorSku />}
              {tramo.atascados.length === 0 ? (
                <p className="mt-2 text-[11.5px] text-muted">Todos los combos pasan este eslabón.</p>
              ) : (
                <ul className="mt-2 max-h-72 space-y-0.5 overflow-y-auto text-[11.5px]">
                  {tramo.atascados.map((a) => (
                    <li key={a.ref} className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-2 border-b border-border/50 py-1 sm:grid-cols-[auto_minmax(0,14rem)_minmax(0,1fr)]">
                      <span className={`h-2 w-2 translate-y-[1px] rounded-full ${a.estado === "falta" ? "bg-accent-rose" : "bg-accent-sun"}`} />
                      <span className="truncate text-ink">
                        {a.nombre} <span className="text-[10px] text-muted">{a.ref}</span>
                      </span>
                      <span className="col-span-2 text-muted sm:col-span-1">{a.detalle}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="text-[11.5px] text-muted">{flujo.isLoading ? "Leyendo el catálogo…" : "Toca un eslabón."}</p>
          )}
        </div>
      </section>

      {/* ── 2. Ciclo del pago ── */}
      <section className="rounded-xl border border-border bg-surface-panel p-4">
        <h3 className="text-sm font-bold text-ink">El ciclo de una solicitud de pago</h3>
        <p className="mb-3 mt-1 max-w-3xl text-[11px] text-muted">
          Tres personas y dos tokens: el asiento nace al aprobar; quien aprobó monta el pago en el banco, y otro administrador lo
          confirma con el comprobante. Una compra entra al inventario (1435) en el mismo asiento.
        </p>
        <ol className="grid gap-2 sm:grid-cols-5">
          {d?.ciclo_pago.map((p, i) => (
            <li key={p.id} className="relative rounded-lg border border-border bg-surface-input p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Paso {i + 1}</span>
                <span className={`text-lg font-bold tabular-nums ${p.n > 0 ? "text-ink" : "text-muted"}`}>{p.n}</span>
              </div>
              <div className="text-xs font-bold text-ink">{p.titulo}</div>
              <div className="mt-0.5 text-[10.5px] leading-snug text-muted">{p.quien}</div>
              {p.total > 0 && <div className="mt-1.5 text-[11px] tabular-nums text-ink-secondary">{cop(p.total)}</div>}
            </li>
          ))}
        </ol>
        {d && Object.keys(d.pagos_fuera).length > 0 && (
          <p className="mt-2 text-[11px] text-muted">
            Fuera del ciclo:{" "}
            {Object.entries(d.pagos_fuera)
              .map(([k, v]) => `${v.n} ${k}${v.n === 1 ? "" : "s"} (${cop(v.total)})`)
              .join(" · ")}
          </p>
        )}
      </section>

      {/* ── 3. Servicios + diagramas ── */}
      <div>
        <section className="rounded-xl border border-border bg-surface-panel p-4">
          <h3 className="text-sm font-bold text-ink">Conexiones externas</h3>
          <ul className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            {Object.entries(estado.data?.servicios ?? {}).map(([k, v]) => (
              <li key={k} className="flex items-center gap-2 rounded-lg border border-border bg-surface-input px-2.5 py-2">
                <span className={`h-2 w-2 rounded-full ${v ? "bg-accent-leaf" : "bg-accent-rose"}`} />
                <span className="capitalize text-ink">{k}</span>
                <span className="ml-auto text-[10px] text-muted">{v ? "conectado" : "caído"}</span>
              </li>
            ))}
            {!estado.data && <li className="text-muted">Consultando…</li>}
          </ul>
        </section>

      </div>

      {expandido && verDiagrama && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/70 p-3 sm:p-6" role="dialog" aria-modal="true">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="truncate text-sm font-bold text-white">{verDiagrama.titulo}</span>
            <button
              onClick={() => setExpandido(false)}
              className="rounded-lg border border-white/30 bg-black/40 px-3 py-1.5 text-xs text-white hover:bg-black/60"
            >
              Cerrar
            </button>
          </div>
          {urlDiagrama ? (
            <iframe src={urlDiagrama} title={verDiagrama.titulo} className="w-full flex-1 rounded-lg border-0 bg-white" />
          ) : (
            <div className="flex flex-1 items-center justify-center text-xs text-white/70">Cargando diagrama…</div>
          )}
        </div>
      )}

      {d && <p className="text-right text-[10px] text-muted">Leído a las {d.generado.slice(11, 16)}</p>}
    </div>
  );
}
