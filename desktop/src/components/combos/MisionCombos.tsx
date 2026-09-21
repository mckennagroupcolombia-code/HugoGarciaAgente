import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { useAppStore } from "../../stores/app";
import { AccionRanura, BTN, BTN_SEC, CASILLA, EQUIPO, EtiquetaPng, cantidad, type Combo, type Eslabon, type Respuesta } from "./comun";

/**
 * El taller de combos: una guía caso a caso para completar lo que le falta a cada producto
 * de venta. Se abre desde la etapa «Preparar», que es donde empiezan los problemas.
 *
 * Todo gira alrededor del combo: su FOTO en el centro y, saliendo de ella, sus seis piezas
 * (receta, etiqueta en la receta, documento, código EAN, diseño de etiqueta, publicación).
 * Una conexión viva = pieza completa; punteada = ranura vacía. Al tocar una pieza se abre a
 * la derecha su inspector, donde se resuelve: crear el EAN, unir el documento por SKU, definir
 * tamaño y plantilla de la etiqueta y corregir sus textos. Lo que exige otra herramienta (el
 * Studio para diseñar, Alegra para la receta) lleva allá y el taller recuerda dónde ibas.
 *
 * El premio se ve: cada pieza resuelta enciende su conexión, el anillo de la foto avanza, y un
 * combo con las seis piezas se celebra y suma al marcador del día y al del catálogo.
 *
 * No crea una segunda vía de escritura: usa POST /api/etiquetas/codigos-ean, fijar-sku y
 * app/tools/etiquetas_fichas (vía /api/mapa-sistema/etiqueta/<id>), con sus mismos permisos.
 */

type Propuesta = { sku: string; nombre_producto: string; numero_producto: number; presentacion: string; anio: number; bimestre: number; codigo_previsto: string };
type FichaEtiqueta = { id: string; nombre: string; tipo_nombre?: string; plantilla_id?: string; categoria?: string; data: Record<string, string> };
type RespEtiqueta = { ficha: FichaEtiqueta; opciones: { tamanos: string[]; plantillas: { id: string; nombre: string; categoria: string; tipo_nombre: string }[] } };
type FilaProducto = { ref: string; nombre: string; combo: string };

const CLAVE_REF = "mck-mision-combo";
const CLAVE_DIA = "mck-mision-marcador";
const TOTAL = EQUIPO.length;

// Dónde va cada pieza alrededor de la foto (viewBox 1000×640, centro 500,320).
const POS: Record<string, { x: number; y: number }> = {
  receta: { x: 500, y: 62 },
  etiqueta_fisica: { x: 850, y: 190 },
  documento: { x: 850, y: 450 },
  ean: { x: 500, y: 578 },
  etiqueta: { x: 150, y: 450 },
  publicacion: { x: 150, y: 190 },
};
const ORDEN_GUIA = ["receta", "etiqueta_fisica", "documento", "ean", "etiqueta", "publicacion"];

const CAMPOS_ETIQUETA: { clave: string; nombre: string; largo?: boolean }[] = [
  { clave: "productName", nombre: "Nombre en la etiqueta", largo: true },
  { clave: "netContent", nombre: "Contenido neto" },
  { clave: "barcode", nombre: "Código de barras" },
  { clave: "classification", nombre: "Clasificación" },
  { clave: "composition", nombre: "Composición", largo: true },
  { clave: "origin", nombre: "Origen" },
  { clave: "storage", nombre: "Conservación", largo: true },
];

function hoyClave() {
  return new Date().toISOString().slice(0, 10);
}
function leerMarcador(): { dia: string; conexiones: number; combos: number } {
  try {
    const m = JSON.parse(localStorage.getItem(CLAVE_DIA) || "null");
    if (m && m.dia === hoyClave()) return m;
  } catch {
    /* sin almacenamiento */
  }
  return { dia: hoyClave(), conexiones: 0, combos: 0 };
}

function completo(c: Combo) {
  return c.ok === TOTAL;
}
function pendientes(c: Combo) {
  return TOTAL - c.ok;
}
function textoEstado(e: Eslabon) {
  return e.estado === "ok" ? "conectado" : e.estado === "aviso" ? "por revisar" : "ranura vacía";
}

function InspectorEan({ c, alResolver }: { c: Combo; alResolver: () => Promise<void> }) {
  const setPanel = useAppStore((s) => s.setPanel);
  const setEtiquetasTab = useAppStore((s) => s.setEtiquetasTab);
  const setEanPrefill = useAppStore((s) => s.setEanPrefill);
  const e = c.eslabones.ean;
  const puedeProponer = e.estado === "falta" && Boolean(e.accion);
  const prop = useQuery({
    queryKey: ["mision-ean-propuesto", c.ref],
    queryFn: () => api.get<Propuesta>(`/api/mapa-sistema/combos/${encodeURIComponent(c.ref)}/ean-propuesto`),
    enabled: puedeProponer,
    retry: false,
  });
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const irAEan = () => {
    setEanPrefill({ sku: c.ref, nombre: c.nombre });
    setEtiquetasTab("codigos_ean");
    setPanel("etiquetas");
  };

  if (e.estado === "ok")
    return (
      <div className="space-y-2">
        <div className="rounded-lg border border-accent-leaf/50 bg-accent-leaf/10 p-3 text-center font-mono text-lg tracking-[0.25em] text-ink">{e.codigo}</div>
        <button className={BTN_SEC} onClick={irAEan}>Ver o corregir en Códigos EAN →</button>
      </div>
    );
  if (!puedeProponer) return <p className="text-[11.5px] text-muted">Primero hay que arreglar la receta: a un combo con la receta rota no se le gasta un código.</p>;
  return (
    <div className="space-y-2">
      {prop.isLoading && <p className="text-[11.5px] text-muted">Calculando el siguiente código libre…</p>}
      {prop.isError && <p className="text-[11.5px] text-accent-rose">{(prop.error as Error)?.message}</p>}
      {prop.data && (
        <>
          <div className="rounded-lg border border-dashed border-accent/60 bg-accent/5 p-3 text-center">
            <div className="font-mono text-lg tracking-[0.25em] text-ink">{prop.data.codigo_previsto}</div>
            <div className="mt-1 font-mono text-[9.5px] text-muted">
              770 · producto {String(prop.data.numero_producto).padStart(3, "0")} · presentación {prop.data.presentacion} · {prop.data.anio}/{prop.data.bimestre}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className={BTN}
              disabled={ocupado}
              onClick={async () => {
                setOcupado(true);
                setError(null);
                try {
                  const { codigo_previsto: _previsto, ...cuerpo } = prop.data!;
                  await api.post("/api/etiquetas/codigos-ean", cuerpo);
                  await alResolver();
                } catch (err) {
                  setError((err as Error)?.message || "No se pudo crear el código");
                } finally {
                  setOcupado(false);
                }
              }}
            >
              {ocupado ? "Creando…" : "Crear este código"}
            </button>
            <button className={BTN_SEC} onClick={irAEan}>Ajustarlo en Códigos EAN →</button>
          </div>
        </>
      )}
      {error && <p className="text-[11.5px] text-accent-rose">{error}</p>}
    </div>
  );
}

function InspectorEtiqueta({ c, alResolver }: { c: Combo; alResolver: () => Promise<void> }) {
  const setPanel = useAppStore((s) => s.setPanel);
  const setEtiquetasTab = useAppStore((s) => s.setEtiquetasTab);
  const e = c.eslabones.etiqueta;
  const ean = c.eslabones.ean?.codigo || "";
  const ficha = useQuery({
    queryKey: ["mision-etiqueta", e.etiqueta_id],
    queryFn: () => api.get<RespEtiqueta>(`/api/mapa-sistema/etiqueta/${e.etiqueta_id}`),
    enabled: Boolean(e.etiqueta_id),
    retry: false,
  });
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [tamano, setTamano] = useState("");
  const [plantilla, setPlantilla] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  useEffect(() => {
    const f = ficha.data?.ficha;
    if (!f) return;
    setCampos(Object.fromEntries(CAMPOS_ETIQUETA.map(({ clave }) => [clave, f.data[clave] ?? ""])));
    setTamano(f.tipo_nombre ?? "");
    setPlantilla(f.plantilla_id ?? "");
    setMsg(null);
  }, [ficha.data]);

  const irAlStudio = () => {
    navigator.clipboard?.writeText(ficha.data?.ficha.nombre || c.nombre).catch(() => null);
    setEtiquetasTab("studio");
    setPanel("etiquetas");
  };

  if (!e.etiqueta_id)
    return (
      <div className="space-y-2">
        <p className="text-[11.5px] text-muted">{e.detalle}</p>
        {e.accion ? <AccionRanura c={c} accion={e.accion} /> : <p className="text-[11.5px] text-muted">La etiqueta se diseña cuando el combo ya tiene su código EAN.</p>}
      </div>
    );
  if (ficha.isLoading) return <p className="text-[11.5px] text-muted">Abriendo la etiqueta…</p>;
  if (ficha.isError || !ficha.data)
    return (
      <div className="space-y-2">
        <p className="text-[11.5px] text-accent-rose">{(ficha.error as Error)?.message || "No se pudo abrir la etiqueta"}</p>
        <button className={BTN_SEC} onClick={irAlStudio}>Abrirla en el Studio →</button>
      </div>
    );

  const f = ficha.data.ficha;
  const cambios = Object.fromEntries(CAMPOS_ETIQUETA.filter(({ clave }) => (campos[clave] ?? "") !== (f.data[clave] ?? "")).map(({ clave }) => [clave, campos[clave] ?? ""]));
  const hayCambios = Object.keys(cambios).length > 0 || tamano !== (f.tipo_nombre ?? "") || plantilla !== (f.plantilla_id ?? "");
  const guardar = async () => {
    setOcupado(true);
    setMsg(null);
    try {
      await api.post(`/api/mapa-sistema/etiqueta/${f.id}`, {
        campos: cambios,
        ...(tamano !== (f.tipo_nombre ?? "") ? { tipo_nombre: tamano } : {}),
        ...(plantilla !== (f.plantilla_id ?? "") ? { plantilla_id: plantilla } : {}),
      });
      await ficha.refetch();
      await alResolver();
      setMsg({ ok: true, texto: "Guardado en la etiqueta. Para volver a sacar el PNG, ábrela en el Studio." });
    } catch (err) {
      setMsg({ ok: false, texto: (err as Error)?.message || "No se pudo guardar" });
    } finally {
      setOcupado(false);
    }
  };
  const entrada = "w-full rounded-md border border-border bg-surface-input px-2 py-1 text-[12px] text-ink";

  return (
    <div className="space-y-2.5">
      <p className="text-[11px] text-muted">«{f.nombre}»</p>
      {e.png && <EtiquetaPng nombre={e.png} />}
      {ean && (campos.barcode ?? "") !== ean && (
        <div className="rounded-md border border-accent-sun/60 bg-accent-sun/10 p-2 text-[11px] text-ink">
          La etiqueta {campos.barcode ? <>lleva el código <code>{campos.barcode}</code></> : "no lleva código"} y el combo tiene <code>{ean}</code>. Por eso no están conectados.
          <button className={`${BTN} ml-2`} onClick={() => setCampos((v) => ({ ...v, barcode: ean }))}>Usar el del combo</button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[10px] font-bold uppercase tracking-wide text-muted">
          Tamaño de etiqueta
          <select className={`${entrada} mt-0.5`} value={tamano} onChange={(ev) => setTamano(ev.target.value)}>
            {!tamano && <option value="">— sin definir —</option>}
            {ficha.data.opciones.tamanos.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="block text-[10px] font-bold uppercase tracking-wide text-muted">
          Plantilla
          <select className={`${entrada} mt-0.5`} value={plantilla} onChange={(ev) => setPlantilla(ev.target.value)}>
            {!plantilla && <option value="">— sin plantilla —</option>}
            {ficha.data.opciones.plantillas.map((p) => <option key={p.id} value={p.id}>{p.nombre.replace(/^Plantilla de /, "")}</option>)}
          </select>
        </label>
      </div>
      {CAMPOS_ETIQUETA.map(({ clave, nombre, largo }) => (
        <label key={clave} className="block text-[10px] font-bold uppercase tracking-wide text-muted">
          {nombre}
          {largo ? (
            <textarea rows={2} className={`${entrada} mt-0.5 font-normal normal-case`} value={campos[clave] ?? ""} onChange={(ev) => setCampos((v) => ({ ...v, [clave]: ev.target.value }))} />
          ) : (
            <input className={`${entrada} mt-0.5 font-normal normal-case`} value={campos[clave] ?? ""} onChange={(ev) => setCampos((v) => ({ ...v, [clave]: ev.target.value }))} />
          )}
        </label>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button className={BTN} disabled={!hayCambios || ocupado} onClick={guardar}>{ocupado ? "Guardando…" : "Guardar en la etiqueta"}</button>
        <button className={BTN_SEC} onClick={irAlStudio}>Diseño y exportación en el Studio →</button>
      </div>
      {msg && <p className={`text-[11px] ${msg.ok ? "text-accent-leaf" : "text-accent-rose"}`}>{msg.texto}</p>}
    </div>
  );
}

function Inspector({ c, clave, alResolver }: { c: Combo; clave: string; alResolver: () => Promise<void> }) {
  const setPanel = useAppStore((s) => s.setPanel);
  const e = c.eslabones[clave];
  if (!e) return null;
  const cuerpo = () => {
    if (clave === "ean") return <InspectorEan c={c} alResolver={alResolver} />;
    if (clave === "etiqueta") return <InspectorEtiqueta c={c} alResolver={alResolver} />;
    if (clave === "receta" || clave === "etiqueta_fisica") {
      const lista = clave === "receta" ? c.componentes : c.componentes.filter((x) => x.casilla === "etiqueta");
      return (
        <div className="space-y-2">
          <p className="text-[11.5px] text-muted">{e.detalle}</p>
          {lista.length > 0 && (
            <div className="grid grid-cols-2 gap-1.5">
              {lista.map((x, i) => (
                <div key={`${x.codigo}-${i}`} title={x.nombre} className={`relative rounded-md border p-1.5 ${x.casilla === "materia_prima" ? "border-accent/70 bg-accent/10" : "border-border bg-surface-input"} ${x.existe ? "" : "border-dashed border-accent-rose/70"}`}>
                  <span className="absolute right-1 top-1 rounded bg-surface px-1 text-[9.5px] font-bold tabular-nums text-ink">{cantidad(x)}</span>
                  <div className="text-base leading-none">{CASILLA[x.casilla].icono}</div>
                  <div className="mt-0.5 text-[8.5px] font-bold uppercase tracking-wide text-muted">{CASILLA[x.casilla].nombre}</div>
                  <div className="line-clamp-2 text-[10.5px] leading-tight text-ink">{x.nombre}</div>
                  <code className="text-[9px] text-muted">{x.codigo}</code>
                </div>
              ))}
            </div>
          )}
          {e.accion && <AccionRanura c={c} accion={e.accion} />}
          {!e.accion && e.estado !== "ok" && <p className="text-[11px] text-muted">Se corrige en Alegra, en la receta del kit <code>{c.ref}</code>.</p>}
        </div>
      );
    }
    if (clave === "documento")
      return (
        <div className="space-y-2">
          {e.doc_titulo && <p className="text-[12px] font-bold text-ink">📄 {e.doc_titulo}</p>}
          <p className="text-[11.5px] text-muted">{e.detalle}</p>
          {e.accion ? <AccionRanura c={c} accion={e.accion} /> : e.estado !== "ok" ? <button className={BTN_SEC} onClick={() => setPanel("fichas")}>Revisarlo en Docs técnicos →</button> : null}
        </div>
      );
    return (
      <div className="space-y-2">
        <p className="text-[11.5px] text-muted">{e.detalle}</p>
        {e.precio ? <p className="text-[12px] tabular-nums text-ink">${Math.round(e.precio).toLocaleString("es-CO")} en la web</p> : null}
        {e.estado !== "ok" && <button className={BTN_SEC} onClick={() => setPanel("publicaciones")}>Ir a Publicaciones →</button>}
      </div>
    );
  };
  const icono = EQUIPO.find((x) => x.clave === clave)?.icono;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-lg leading-none">{icono}</span>
        <h4 className="mck-flujo-nodo text-[13px] font-bold text-ink">{e.titulo}</h4>
        <span className={`ml-auto font-mono text-[9.5px] font-bold uppercase ${e.estado === "ok" ? "text-accent-leaf" : e.estado === "aviso" ? "text-accent-sun" : "text-accent-rose"}`}>{textoEstado(e)}</span>
      </div>
      {cuerpo()}
    </div>
  );
}

function Tablero({ c, sel, guia, destello, premio, onSel }: { c: Combo; sel: string; guia: string | null; destello: Set<string>; premio: boolean; onSel: (k: string) => void }) {
  const R = 86;
  const avance = c.ok / TOTAL;
  const CIRC = 2 * Math.PI * (R + 9);
  return (
    <div className="mck-mision-tablero relative mx-auto aspect-[1000/640] w-full max-w-[860px]">
      <svg viewBox="0 0 1000 640" className="absolute inset-0 h-full w-full" aria-hidden="true">
        {EQUIPO.map(({ clave }) => {
          const e = c.eslabones[clave];
          const p = POS[clave];
          if (!e || !p) return null;
          const d = `M500,320 L${p.x},${p.y}`;
          const vivo = e.estado === "ok";
          return (
            <g key={clave}>
              <path d={d} fill="none" strokeLinecap="round"
                className={`${vivo ? "stroke-accent-leaf" : e.estado === "aviso" ? "stroke-accent-sun" : "stroke-accent-rose/60"} ${destello.has(clave) ? "mck-mision-destello" : ""}`}
                strokeWidth={vivo ? 3.5 : 2} strokeDasharray={vivo ? undefined : "7 7"} />
              {vivo && (
                <circle r="5" className="fill-accent-leaf mck-mision-viajero">
                  <animateMotion dur="2.4s" repeatCount="indefinite" path={d} />
                </circle>
              )}
            </g>
          );
        })}
        {/* anillo de avance alrededor de la foto */}
        <circle cx="500" cy="320" r={R + 9} fill="none" className="stroke-border" strokeWidth="7" />
        <circle cx="500" cy="320" r={R + 9} fill="none" strokeWidth="7" strokeLinecap="round" transform="rotate(-90 500 320)"
          className={premio ? "stroke-accent-sun" : "stroke-accent-leaf"} strokeDasharray={`${CIRC * avance} ${CIRC}`} style={{ transition: "stroke-dasharray 700ms ease" }} />
      </svg>

      {/* la foto, en el centro */}
      <div className={`absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden rounded-full border-4 border-surface-panel bg-white ${premio ? "mck-mision-premio" : ""}`} style={{ width: "17.2%", aspectRatio: "1" }}>
        {c.foto ? <img src={c.foto} alt={c.nombre} className="h-full w-full object-contain" /> : <span className="text-3xl text-muted">?</span>}
      </div>
      <div className="absolute left-1/2 top-[67.5%] -translate-x-1/2 rounded-full border border-border bg-surface-panel px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums text-ink">
        {c.ok}/{TOTAL}
      </div>

      {EQUIPO.map(({ clave, icono }) => {
        const e = c.eslabones[clave];
        const p = POS[clave];
        if (!e || !p) return null;
        const activo = sel === clave;
        const dato = clave === "ean" ? e.codigo : clave === "etiqueta" ? e.tamano : clave === "publicacion" && e.meli_id ? e.meli_id : "";
        return (
          // El botón va DENTRO de un div posicionado: index.css fuerza `position: relative` y
          // `overflow: hidden` en todos los botones (efecto de pulsación), así que un botón con
          // `absolute` se queda en el flujo y el «+1» quedaría recortado.
          <div
            key={clave}
            style={{ left: `${p.x / 10}%`, top: `${(p.y / 640) * 100}%`, width: "23%" }}
            className={`absolute -translate-x-1/2 -translate-y-1/2 ${destello.has(clave) ? "mck-mision-gana" : ""}`}
          >
            <button
              onClick={() => onSel(clave)}
              aria-pressed={activo}
              className={`mck-flujo-nodo block w-full rounded-xl border-2 bg-surface-panel px-2 py-1.5 text-left transition ${
                e.estado === "ok" ? "border-accent-leaf/70" : e.estado === "aviso" ? "border-accent-sun/80" : "border-dashed border-accent-rose/70"
              } ${activo ? "ring-2 ring-accent ring-offset-2 ring-offset-surface-panel" : "hover:border-accent"} ${guia === clave && !activo ? "mck-mision-pulso" : ""}`}
            >
              <span className="flex items-center gap-1.5">
                <span className="text-[15px] leading-none" aria-hidden="true">{icono}</span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] font-bold text-ink">{e.titulo}</span>
                <span className={`h-2 w-2 shrink-0 rounded-full ${e.estado === "ok" ? "bg-accent-leaf" : e.estado === "aviso" ? "bg-accent-sun" : "bg-accent-rose"}`} />
              </span>
              <span className={`mt-0.5 block truncate font-mono text-[9.5px] ${e.estado === "ok" ? "text-muted" : e.estado === "aviso" ? "text-accent-sun" : "text-accent-rose"}`}>{dato || textoEstado(e)}</span>
            </button>
            {destello.has(clave) && <span className="mck-mision-sube pointer-events-none absolute -top-3 right-2 font-mono text-[11px] font-bold text-accent-leaf">+1 conexión</span>}
          </div>
        );
      })}

      {premio && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          {Array.from({ length: 26 }, (_, i) => (
            <span key={i} className="mck-mision-confeti" style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 9) * 90}ms`, background: ["#0891b2", "#059669", "#d97706", "#7c3aed", "#e11d48"][i % 5] }} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function MisionCombos({ datos, onGaleria }: { datos: Respuesta; onGaleria: () => void }) {
  const qc = useQueryClient();
  const setPanel = useAppStore((s) => s.setPanel);
  const porRef = useMemo(() => new Map(datos.combos.map((c) => [c.ref, c])), [datos.combos]);

  // La cola se arma UNA vez por visita: un combo que se completa no desaparece bajo los pies,
  // se queda para celebrarlo. Primero los que están a una pieza de cerrarse.
  const [cola] = useState<string[]>(() =>
    datos.combos.filter((c) => !completo(c)).sort((a, b) => pendientes(a) - pendientes(b) || a.faltas - b.faltas || a.nombre.localeCompare(b.nombre)).map((c) => c.ref),
  );
  const [ref, setRef] = useState<string | null>(() => {
    try {
      const g = sessionStorage.getItem(CLAVE_REF);
      if (g && porRef.has(g)) return g;
    } catch {
      /* sin almacenamiento */
    }
    return cola[0] ?? null;
  });
  const c = ref ? porRef.get(ref) ?? null : null;
  const pos = ref ? cola.indexOf(ref) : -1;
  useEffect(() => {
    try {
      if (ref) sessionStorage.setItem(CLAVE_REF, ref);
    } catch {
      /* sin almacenamiento */
    }
  }, [ref]);

  const guia = useMemo(() => (c ? ORDEN_GUIA.find((k) => c.eslabones[k]?.estado === "falta") ?? ORDEN_GUIA.find((k) => c.eslabones[k]?.estado === "aviso") ?? null : null), [c]);
  const [sel, setSel] = useState<string>("receta");
  useEffect(() => setSel(guia ?? "receta"), [ref]); // eslint-disable-line react-hooks/exhaustive-deps

  // El premio: comparar cada combo con cómo estaba la última vez que se vio.
  const antes = useRef<Map<string, Record<string, string>>>(new Map());
  const [destello, setDestello] = useState<Set<string>>(new Set());
  const [premio, setPremio] = useState(false);
  const [marcador, setMarcador] = useState(leerMarcador);
  useEffect(() => {
    if (!c) return;
    const ahora = Object.fromEntries(EQUIPO.map(({ clave }) => [clave, c.eslabones[clave]?.estado ?? "falta"]));
    const previo = antes.current.get(c.ref);
    antes.current.set(c.ref, ahora);
    if (!previo) {
      setPremio(false);
      return;
    }
    const ganadas = Object.keys(ahora).filter((k) => ahora[k] === "ok" && previo[k] !== "ok");
    if (!ganadas.length) return;
    const cerro = completo(c);
    setDestello(new Set(ganadas));
    setPremio(cerro);
    setMarcador((m) => {
      const n = { dia: hoyClave(), conexiones: (m.dia === hoyClave() ? m.conexiones : 0) + ganadas.length, combos: (m.dia === hoyClave() ? m.combos : 0) + (cerro ? 1 : 0) };
      try {
        localStorage.setItem(CLAVE_DIA, JSON.stringify(n));
      } catch {
        /* sin almacenamiento */
      }
      return n;
    });
    const t = setTimeout(() => setDestello(new Set()), 2600);
    const siguientePieza = ORDEN_GUIA.find((k) => ahora[k] !== "ok");
    if (siguientePieza) setSel(siguientePieza);
    return () => clearTimeout(t);
  }, [c]);

  const alResolver = async () => {
    await api.post("/api/mapa-sistema/invalidar").catch(() => null);
    await qc.invalidateQueries({ queryKey: ["mapa-sistema-combos"] });
    await qc.invalidateQueries({ queryKey: ["mapa-app-bloqueos"] });
  };
  const mover = (d: number) => {
    if (!cola.length) return;
    const i = pos < 0 ? 0 : (pos + d + cola.length) % cola.length;
    setPremio(false);
    setRef(cola[i]);
  };

  const sinCombo = useQuery({ queryKey: ["mision-sin-combo"], queryFn: () => api.get<{ filas: FilaProducto[] }>("/api/mapa-sistema/productos"), staleTime: 300_000, retry: false });
  const huerfanos = (sinCombo.data?.filas ?? []).filter((f) => f.combo === "falta");
  const [verHuerfanos, setVerHuerfanos] = useState(false);

  const completos = datos.combos.filter(completo).length;
  const resueltosEnCola = cola.filter((r) => { const x = porRef.get(r); return x ? completo(x) : false; }).length;

  return (
    <div className="space-y-3">
      {/* Marcador */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-surface-panel px-3 py-2">
        <div className="min-w-[220px] flex-1">
          <div className="flex items-baseline justify-between font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
            <span>Catálogo completo</span>
            <span className="tabular-nums text-ink">{completos} / {datos.total}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-input">
            <div className="h-full rounded-full bg-accent-leaf transition-all duration-700" style={{ width: `${(completos / Math.max(datos.total, 1)) * 100}%` }} />
          </div>
        </div>
        <div className="mck-flujo-nodo text-[12px] text-ink"><b className="tabular-nums">{marcador.conexiones}</b> <span className="text-muted">conexiones hoy</span></div>
        <div className="mck-flujo-nodo text-[12px] text-ink">🏆 <b className="tabular-nums">{marcador.combos}</b> <span className="text-muted">combos completados hoy</span></div>
        <button onClick={onGaleria} className={BTN_SEC}>Ver todos los combos</button>
      </div>

      {!c ? (
        <div className="rounded-xl border border-accent-leaf/50 bg-accent-leaf/10 p-6 text-center text-sm text-ink">🏆 No queda ningún combo incompleto. El catálogo está al día.</div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="rounded-xl border border-border bg-surface-panel p-3">
            {/* Caso actual */}
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
                  Caso {pos + 1} de {cola.length} · {resueltosEnCola} resueltos en esta visita · {c.linea || "sin línea en la web"}
                </p>
                <h3 className="truncate text-base font-bold text-ink">{c.nombre}</h3>
                <code className="text-[11px] text-ink-secondary">{c.ref}</code>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button className={BTN_SEC} onClick={() => mover(-1)}>← Anterior</button>
                <button className={completo(c) ? BTN : BTN_SEC} onClick={() => mover(1)}>{completo(c) ? "Siguiente combo →" : "Saltar →"}</button>
              </div>
            </div>

            {premio || completo(c) ? (
              <div className="mt-2 rounded-lg border border-accent-sun/60 bg-accent-sun/10 px-3 py-2 text-center text-[12.5px] font-bold text-ink">🏆 ¡Combo completo! Sus seis piezas están conectadas: ya se puede vender con todo su respaldo.</div>
            ) : guia ? (
              <div className="mt-2 rounded-lg border border-accent/40 bg-accent/5 px-3 py-1.5 text-[12px] text-ink">
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-accent">siguiente paso</span>{" "}
                {c.eslabones[guia].titulo}: <span className="text-muted">{c.eslabones[guia].detalle}</span>
              </div>
            ) : null}

            <Tablero c={c} sel={sel} guia={guia} destello={destello} premio={premio} onSel={setSel} />
          </div>

          <div className="rounded-xl border border-border bg-surface-panel p-3 xl:max-h-[calc(100vh-13rem)] xl:overflow-y-auto">
            <Inspector c={c} clave={sel} alResolver={alResolver} />
          </div>
        </div>
      )}

      {/* Lo que ni siquiera tiene combo: no entra al tablero porque no hay producto de venta que mostrar */}
      {huerfanos.length > 0 && (
        <div className="rounded-xl border border-dashed border-border bg-surface-panel/60 p-2">
          <button onClick={() => setVerHuerfanos((v) => !v)} aria-expanded={verHuerfanos} className="mck-flujo-nodo flex w-full items-center gap-2 px-1 text-left text-[12px] font-bold text-ink-secondary hover:text-ink">
            <span aria-hidden="true">{verHuerfanos ? "−" : "+"}</span>
            {huerfanos.length} productos comprados sin ninguna presentación de venta
            <span className="font-sans text-[11px] font-normal text-muted">no tienen combo: primero hay que crearlo en Alegra</span>
          </button>
          {verHuerfanos && (
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
              {huerfanos.map((f) => (
                <div key={f.ref} className="flex items-center gap-2 rounded-md border border-border bg-surface-input px-2 py-1">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-semibold text-ink">{f.nombre}</span>
                    <code className="text-[9.5px] text-muted">{f.ref}</code>
                  </span>
                  <button className={BTN_SEC} onClick={() => { navigator.clipboard?.writeText(f.ref).catch(() => null); setPanel("productos-siigo"); }}>Crear combo →</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
