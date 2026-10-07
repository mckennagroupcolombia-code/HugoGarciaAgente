/**
 * Simulador de precios del proyecto (4-oct-2026): emergente sobre el mapa (botón «Precios» de la
 * barra), no una vista aparte. Cada producto muestra, para UNA unidad, en qué se va el precio de la
 * publicación —plataforma, envío, IVA, costo del colaborador— y cuánto le queda a cada parte.
 *
 * Los deslizadores solo calculan (nadie más lo ve); «Guardar propuesta» lo deja en el historial y
 * reinicia los «de acuerdo». Con todos los miembros de acuerdo, el precio queda acordado.
 * Cálculo: ./precios.ts · Backend: app/services/colab_precios.py. Es una simulación: no cambia
 * publicaciones, inventario ni contabilidad.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import { INP, MINI } from "./campos";
import { Sprite } from "./pixel";
import { calcular, costoColab, pesos, type CostoColab, type Entradas, type ProductoPrecio } from "./precios";

type Cambio = { id: number; precio_id: number; usuario_id: number; campo: string; antes: string; despues: string; en: string };
type Datos = { productos: ProductoPrecio[]; cambios: Cambio[]; proveedor_defecto: number | null; participantes: Record<string, string> };

const COLOR = {
  comision: "#83769C", envio: "#29ADFF", iva: "#FFA300", otros: "#5F574F",
  costo: "#AB5236", colab: "#FFEC27", mck: "#008751", perdida: "#FF004D",
};
const CAMPOS_ENTRADA: (keyof Entradas)[] = [
  "nombre", "sku", "plataforma", "nota", "precio_publicacion", "comision_pct", "envio", "iva_pct", "iva_modo",
  "otros_mckenna", "precio_compra", "costos", "merma_pct", "meta_mckenna", "meta_colaborador", "proveedor_id",
];

function utc(s?: string | null) {
  return s ? new Date(s.replace(" ", "T") + "Z") : null;
}
function hace(s?: string | null) {
  const d = utc(s);
  if (!d) return "";
  const m = (Date.now() - d.getTime()) / 60000;
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${Math.round(m)} min`;
  if (m < 1440) return `hace ${Math.round(m / 60)} h`;
  return `hace ${Math.round(m / 1440)} d`;
}

/** Campo de pesos con deslizador: se juega con el dedo y se afina con el número. */
function Deslizador({ etiqueta, valor, onCambio, base, ayuda }: {
  etiqueta: React.ReactNode; valor: number; onCambio: (v: number) => void; base: number; ayuda?: React.ReactNode;
}) {
  const ref = Math.max(base, 1000);
  const min = Math.max(0, Math.floor(ref * 0.4 / 500) * 500);
  const max = Math.ceil(ref * 1.6 / 500) * 500;
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2 text-xs font-bold text-ink">
        <span>{etiqueta}</span>
        <input type="number" inputMode="numeric" min={0} step={100} value={Math.round(valor)}
               onChange={(e) => onCambio(Math.max(0, Number(e.target.value) || 0))}
               className={`${MINI} w-28 text-right font-bold`} />
      </span>
      <input type="range" min={min} max={max} step={100} value={Math.min(max, Math.max(min, valor))}
             onChange={(e) => onCambio(Number(e.target.value))} className="mt-1 w-full accent-[rgb(var(--mck-accent))]" />
      {ayuda && <span className="block text-[11px] text-muted">{ayuda}</span>}
    </label>
  );
}

function Num({ etiqueta, valor, onCambio, sufijo }: { etiqueta: string; valor: number; onCambio: (v: number) => void; sufijo?: string }) {
  return (
    <label className="text-xs text-muted">
      {etiqueta}
      <span className="mt-0.5 flex items-center gap-1">
        <input type="number" inputMode="decimal" min={0} step="any" value={valor}
               onChange={(e) => onCambio(Math.max(0, Number(e.target.value) || 0))} className={`${MINI} w-full`} />
        {sufijo && <span className="text-ink-secondary">{sufijo}</span>}
      </span>
    </label>
  );
}

/** La barra: el precio de la publicación partido en lo que se lleva cada quien. */
function Barra({ e, c, colab }: { e: Entradas; c: ReturnType<typeof calcular>; colab: string }) {
  const compra = Math.round(e.precio_compra || 0);
  const costo = c.costo_colab;
  const partes: { k: string; v: number; color: string; txt: string }[] = [
    { k: "comision", v: c.comision, color: COLOR.comision, txt: `Plataforma ${e.comision_pct}%` },
    { k: "envio", v: c.envio, color: COLOR.envio, txt: "Envío" },
    { k: "iva", v: c.iva, color: COLOR.iva, txt: `IVA ${e.iva_pct}%` },
    { k: "otros", v: c.otros, color: COLOR.otros, txt: "Otros McKenna" },
    ...(costo == null
      ? [{ k: "compra", v: compra, color: COLOR.costo, txt: `Pago a ${colab}` }]
      : [{ k: "costo", v: Math.min(costo, compra), color: COLOR.costo,
           txt: costo > compra ? `Pago a ${colab} (no cubre su costo de ${pesos(costo)})` : `Costo de ${colab}` },
         { k: "colab", v: Math.max(0, compra - costo), color: COLOR.colab, txt: `Le queda a ${colab}` }]),
    { k: "mck", v: Math.max(0, c.queda_mckenna), color: COLOR.mck, txt: "Le queda a McKenna" },
  ].filter((p) => p.v > 0);
  const total = Math.max(e.precio_publicacion || 0, partes.reduce((s, p) => s + p.v, 0), 1);
  const sobra = partes.reduce((s, p) => s + p.v, 0) - (e.precio_publicacion || 0);
  return (
    <div>
      <div className="relative flex h-9 w-full overflow-hidden border-2 border-ink" role="img"
           aria-label={partes.map((p) => `${p.txt} ${pesos(p.v)}`).join(", ")}>
        {partes.map((p) => (
          <div key={p.k} className="flex h-full items-center justify-center overflow-hidden text-[10px] font-bold"
               style={{ width: `${(p.v / total) * 100}%`, background: p.color, color: p.k === "colab" || p.k === "iva" ? "#000" : "#fff" }}
               title={`${p.txt}: ${pesos(p.v)}`}>
            {p.v / total > 0.09 ? pesos(p.v) : ""}
          </div>
        ))}
        {sobra > 0 && (
          <div className="pointer-events-none absolute inset-y-0 border-l-[3px] border-dashed"
               style={{ left: `${((e.precio_publicacion || 0) / total) * 100}%`, borderColor: COLOR.perdida }} />
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-secondary">
        {partes.map((p) => (
          <span key={p.k} className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 border border-ink" style={{ background: p.color }} />{p.txt} {pesos(p.v)}
          </span>
        ))}
      </div>
      {sobra > 0 && (
        <p className="mt-1 text-xs font-bold" style={{ color: COLOR.perdida }}>
          Lo que se reparte supera el precio en {pesos(sobra)}: alguien está perdiendo (la línea roja es el precio).
        </p>
      )}
    </div>
  );
}

function Marcador({ quien, valor, meta, falta }: { quien: string; valor: number | null; meta: number; falta?: string }) {
  const estado = valor == null ? "falta" : valor < 0 ? "pierde" : valor < meta ? "bajo" : "ok";
  const color = { falta: "rgb(var(--mck-muted))", pierde: COLOR.perdida, bajo: "#FFA300", ok: COLOR.mck }[estado];
  return (
    <div className="flex-1 border-2 border-ink bg-surface-panel p-2" style={{ boxShadow: `3px 3px 0 ${color}` }}>
      <p className="text-[11px] font-bold uppercase text-muted">Le queda a {quien}</p>
      <p className="text-2xl font-extrabold leading-tight" style={{ color }}>{valor == null ? "?" : pesos(valor)}</p>
      <p className="text-[11px] text-ink-secondary">
        {estado === "falta" ? falta
          : estado === "pierde" ? "pierde plata en cada unidad"
          : estado === "bajo" ? `por debajo del mínimo (${pesos(meta)})`
          : meta > 0 ? `cumple el mínimo de ${pesos(meta)}` : "por unidad"}
      </p>
    </div>
  );
}

function Producto({ did, p, part, proveedorDef, yoId, cambios, onCambio }: {
  did: number; p: ProductoPrecio; part: Record<string, string>; proveedorDef: number | null; yoId: number;
  cambios: Cambio[]; onCambio: () => void;
}) {
  const guardado: Entradas = Object.fromEntries(CAMPOS_ENTRADA.map((k) => [k, p[k]])) as Entradas;
  const [b, setB] = useState<Entradas>(guardado);
  const [verAjustes, setVerAjustes] = useState(false);
  const [verHist, setVerHist] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const set = <K extends keyof Entradas>(k: K, v: Entradas[K]) => setB((x) => ({ ...x, [k]: v }));
  const sucios = CAMPOS_ENTRADA.filter((k) => JSON.stringify(b[k]) !== JSON.stringify(guardado[k]));
  const c = calcular(b);
  const cg = calcular(guardado);
  const provId = b.proveedor_id ?? proveedorDef;
  const colab = part[String(provId)]?.split(" ")[0] || "el colaborador";
  const nom = (uid: number | string) => (Number(uid) === yoId ? "Tú" : part[String(uid)]?.split(" ")[0] || "—");
  const ids = Object.keys(part);
  const acordado = ids.length > 0 && ids.every((u) => p.acuerdos[u]);
  const yoAcuerdo = !!p.acuerdos[String(yoId)];

  async function guardar() {
    setError(null); setOcupado(true);
    try {
      await api.patch(`/api/colaboradores/diagramas/${did}/precios/${p.id}`, Object.fromEntries(sucios.map((k) => [k, b[k]])));
      onCambio();
    } catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  }
  async function acordar(si: boolean) {
    try { await api.post(`/api/colaboradores/diagramas/${did}/precios/${p.id}/acuerdo`, { de_acuerdo: si }); onCambio(); }
    catch (e) { setError((e as Error).message); }
  }
  async function quitar() {
    if (!window.confirm(`¿Quitar «${p.nombre}» del simulador?`)) return;
    try { await api.delete(`/api/colaboradores/diagramas/${did}/precios/${p.id}`); onCambio(); }
    catch (e) { setError((e as Error).message); }
  }
  const delta = (a: number | null, g: number | null) =>
    sucios.length && a != null && g != null && a !== g ? <span className="ml-1 text-xs font-bold">({a > g ? "+" : ""}{pesos(a - g)} vs. guardado)</span> : null;
  const costos = b.costos;

  return (
    <div className="space-y-3" data-producto={p.id}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-base font-extrabold leading-tight text-ink">{p.nombre}</p>
          <p className="text-[11px] text-muted">{[p.sku, p.plataforma].filter(Boolean).join(" · ")}{p.nota ? ` — ${p.nota}` : ""}</p>
        </div>
        <span className={`rounded border px-1.5 py-0.5 text-[11px] font-bold ${acordado ? "border-transparent text-white" : "border-border text-ink-secondary"}`}
              style={acordado ? { background: COLOR.mck } : undefined}>
          {acordado ? "✓ Precio acordado" : ids.map((u) => `${p.acuerdos[u] ? "✓" : "○"} ${nom(u)}`).join("  ")}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Deslizador etiqueta="Precio de la publicación (lo que paga el cliente)" valor={b.precio_publicacion}
                    base={guardado.precio_publicacion} onCambio={(v) => set("precio_publicacion", v)}
                    ayuda={c.publicacion_minima != null && <>Para que los dos lleguen a su mínimo: desde <b>{pesos(c.publicacion_minima)}</b></>} />
        <Deslizador etiqueta={`Lo que McKenna le paga a ${colab}`} valor={b.precio_compra}
                    base={guardado.precio_compra} onCambio={(v) => set("precio_compra", v)}
                    ayuda={<>McKenna puede pagar hasta <b>{pesos(c.tope_compra)}</b>{c.piso_compra != null && <>; {colab} necesita desde <b>{pesos(c.piso_compra)}</b></>}
                      {c.piso_compra != null && c.piso_compra > c.tope_compra && <b style={{ color: COLOR.perdida }}> — no se cruzan: hay que subir la publicación o bajar costos</b>}</>} />
      </div>

      <Barra e={b} c={c} colab={colab} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <Marcador quien="McKenna" valor={c.queda_mckenna} meta={b.meta_mckenna} />
        <Marcador quien={colab} valor={c.queda_colab} meta={b.meta_colaborador}
                  falta={`${colab} todavía no puso su costo: ábrelo en «Costos y supuestos»`} />
      </div>
      {sucios.length > 0 && (
        <p className="text-xs text-ink-secondary">
          Comparado con lo guardado: McKenna {delta(c.queda_mckenna, cg.queda_mckenna) ?? "igual"} · {colab} {delta(c.queda_colab, cg.queda_colab) ?? "igual"}
        </p>
      )}

      {/* Atajos: llevar a cada quien a su mínimo */}
      <div className="flex flex-wrap gap-1.5 text-xs font-bold">
        <button type="button" className="rounded border border-border px-2 py-1 text-ink" onClick={() => set("precio_compra", Math.max(0, Math.floor(c.tope_compra / 100) * 100))}>
          Pagar lo máximo que deja el mínimo a McKenna
        </button>
        {c.piso_compra != null && (
          <button type="button" className="rounded border border-border px-2 py-1 text-ink" onClick={() => set("precio_compra", Math.ceil(c.piso_compra! / 100) * 100)}>
            Pagar lo justo para el mínimo de {colab}
          </button>
        )}
        {c.publicacion_minima != null && (
          <button type="button" className="rounded border border-border px-2 py-1 text-ink" onClick={() => set("precio_publicacion", c.publicacion_minima!)}>
            Publicar al precio mínimo para los dos
          </button>
        )}
      </div>

      {/* La cuenta, renglón por renglón */}
      <details className="rounded border border-border p-2 text-sm">
        <summary className="cursor-pointer text-xs font-bold uppercase text-muted">Cómo se calcula</summary>
        <table className="mt-1 w-full text-sm">
          <tbody className="[&_td]:py-0.5 [&_td:last-child]:text-right">
            <tr><td>Precio de la publicación</td><td>{pesos(b.precio_publicacion)}</td></tr>
            <tr><td>− Comisión de la plataforma ({b.comision_pct}%)</td><td>{pesos(-c.comision)}</td></tr>
            <tr><td>− Envío que paga McKenna</td><td>{pesos(-c.envio)}</td></tr>
            <tr><td>− IVA {b.iva_pct}% {b.iva_modo === "incluido" ? "(incluido en el precio)" : "(sobre el precio, colchón)"}</td><td>{pesos(-c.iva)}</td></tr>
            {c.otros > 0 && <tr><td>− Otros costos de McKenna</td><td>{pesos(-c.otros)}</td></tr>}
            <tr className="font-bold"><td>= Le entra a McKenna</td><td>{pesos(c.entra_mckenna)}</td></tr>
            <tr><td>− Lo que le paga a {colab}</td><td>{pesos(-b.precio_compra)}</td></tr>
            <tr className="font-bold"><td>= Le queda a McKenna</td><td>{pesos(c.queda_mckenna)}</td></tr>
            <tr><td colSpan={2} className="pt-2 text-xs text-muted">Del lado de {colab}</td></tr>
            <tr><td>Lo que recibe de McKenna</td><td>{pesos(b.precio_compra)}</td></tr>
            {costos.map((x, i) => <tr key={i}><td>− {x.nombre}</td><td>{pesos(-x.monto)}</td></tr>)}
            {costos.length > 0 && b.merma_pct > 0 && (
              <tr><td>− Merma {b.merma_pct}%</td><td>{pesos(-((c.costo_colab ?? 0) - costos.reduce((s, x) => s + x.monto, 0)))}</td></tr>
            )}
            <tr className="font-bold"><td>= Le queda a {colab}</td><td>{c.queda_colab == null ? "falta su costo" : pesos(c.queda_colab)}</td></tr>
          </tbody>
        </table>
      </details>

      {/* Supuestos */}
      <div className="rounded border border-border p-2">
        <button type="button" onClick={() => setVerAjustes((v) => !v)} className="w-full text-left text-xs font-bold uppercase text-muted" aria-expanded={verAjustes}>
          {verAjustes ? "▾" : "▸"} Costos y supuestos
        </button>
        {verAjustes && (
          <div className="mt-2 space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Num etiqueta="Comisión plataforma" sufijo="%" valor={b.comision_pct} onCambio={(v) => set("comision_pct", v)} />
              <Num etiqueta="Envío (McKenna)" valor={b.envio} onCambio={(v) => set("envio", v)} />
              <Num etiqueta="IVA" sufijo="%" valor={b.iva_pct} onCambio={(v) => set("iva_pct", v)} />
              <Num etiqueta="Otros McKenna" valor={b.otros_mckenna} onCambio={(v) => set("otros_mckenna", v)} />
              <Num etiqueta="Mínimo McKenna" valor={b.meta_mckenna} onCambio={(v) => set("meta_mckenna", v)} />
              <Num etiqueta={`Mínimo ${colab}`} valor={b.meta_colaborador} onCambio={(v) => set("meta_colaborador", v)} />
            </div>
            <div className="flex overflow-hidden rounded-lg border border-border text-xs font-bold" role="radiogroup" aria-label="IVA">
              {([["incluido", "IVA incluido en el precio (factura)"], ["encima", "IVA sobre el precio (colchón)"]] as const).map(([k, txt]) => (
                <button key={k} type="button" role="radio" aria-checked={b.iva_modo === k} onClick={() => set("iva_modo", k)}
                        className={`flex-1 px-2 py-1 ${b.iva_modo === k ? "bg-accent text-white" : "text-ink"}`}>{txt}</button>
              ))}
            </div>
            <p className="text-[11px] text-muted">
              {colab} no cobra IVA, así que McKenna no tiene IVA de compra que descontar: el IVA de la venta sale entero de su lado.
              «Incluido» es lo que pasa en la factura; «sobre el precio» cuenta de más, a propósito, como colchón.
            </p>
            <div>
              <p className="text-xs font-bold text-ink">Costo de fabricación de {colab} (una unidad)</p>
              {costos.map((x, i) => (
                <div key={i} className="mt-1 flex gap-1">
                  <input value={x.nombre} placeholder="Aros, hebilla, mano de obra…" className={`${MINI} min-w-0 flex-1`}
                         onChange={(e) => set("costos", costos.map((y, j) => (j === i ? { ...y, nombre: e.target.value } : y)))} />
                  <input type="number" inputMode="numeric" min={0} value={x.monto} className={`${MINI} w-24 text-right`}
                         onChange={(e) => set("costos", costos.map((y, j) => (j === i ? { ...y, monto: Math.max(0, Number(e.target.value) || 0) } : y)))} />
                  <button type="button" aria-label="Quitar" className="px-1 text-muted" onClick={() => set("costos", costos.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
              <div className="mt-1 flex items-end gap-2">
                <button type="button" className="text-xs font-bold text-accent" onClick={() => set("costos", [...costos, { nombre: "", monto: 0 } as CostoColab])}>＋ Renglón</button>
                <div className="ml-auto w-28"><Num etiqueta="Merma" sufijo="%" valor={b.merma_pct} onCambio={(v) => set("merma_pct", v)} /></div>
              </div>
              {costos.length > 0 && <p className="mt-1 text-right text-xs font-bold text-ink">Costo total: {pesos(costoColab(b))}</p>}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-muted">Nombre<input value={b.nombre} onChange={(e) => set("nombre", e.target.value)} className={`${INP} mt-0.5`} /></label>
              <label className="text-xs text-muted">SKU<input value={b.sku} onChange={(e) => set("sku", e.target.value)} className={`${INP} mt-0.5`} /></label>
              <label className="text-xs text-muted">Dónde se vende<input value={b.plataforma} onChange={(e) => set("plataforma", e.target.value)} className={`${INP} mt-0.5`} /></label>
              <label className="text-xs text-muted">Quién lo fabrica
                <select value={provId ?? ""} onChange={(e) => set("proveedor_id", e.target.value ? Number(e.target.value) : null)} className={`${MINI} mt-0.5 w-full`}>
                  {ids.map((u) => <option key={u} value={u}>{part[u]}</option>)}
                </select>
              </label>
              <label className="text-xs text-muted sm:col-span-2">Nota<input value={b.nota} onChange={(e) => set("nota", e.target.value)} className={`${INP} mt-0.5`} /></label>
            </div>
            <button type="button" onClick={() => void quitar()} className="text-xs font-bold text-red-500">Quitar este producto</button>
          </div>
        )}
      </div>

      {/* Historial de este producto */}
      <div className="rounded border border-border p-2">
        <button type="button" onClick={() => setVerHist((v) => !v)} className="w-full text-left text-xs font-bold uppercase text-muted" aria-expanded={verHist}>
          {verHist ? "▾" : "▸"} Cambios ({cambios.length})
        </button>
        {verHist && (
          <ul className="mt-1 space-y-0.5 text-xs text-ink-secondary">
            {cambios.length === 0 && <li>Sin cambios todavía.</li>}
            {cambios.map((x) => (
              <li key={x.id}>
                <b className="text-ink">{nom(x.usuario_id)}</b> {hace(x.en)} ·{" "}
                {x.campo === "producto" || x.campo === "acuerdo" ? (x.despues || x.antes) : <>{x.campo}: {x.antes} → <b className="text-ink">{x.despues}</b></>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="sticky bottom-0 flex gap-2 bg-surface-panel pt-1">
        {sucios.length > 0 ? (
          <>
            <button type="button" onClick={() => setB(guardado)} className="rounded-lg border border-border px-3 py-1.5 text-sm font-bold text-ink">Volver a lo guardado</button>
            <button type="button" disabled={ocupado} onClick={() => void guardar()} className="flex-1 rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50">
              Guardar propuesta ({sucios.length} cambio{sucios.length === 1 ? "" : "s"})
            </button>
          </>
        ) : (
          <button type="button" onClick={() => void acordar(!yoAcuerdo)}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-bold ${yoAcuerdo ? "border border-border text-ink" : "bg-accent text-white"}`}>
            {yoAcuerdo ? "Ya no estoy de acuerdo" : "Estoy de acuerdo con este precio"}
          </button>
        )}
      </div>
    </div>
  );
}

export default function PreciosProyecto({ did, yoId, onCerrar }: { did: number; yoId: number; onCerrar: () => void }) {
  const qc = useQueryClient();
  const clave = ["colab-precios", did];
  const q = useQuery<Datos>({ queryKey: clave, queryFn: () => api.get(`/api/colaboradores/diagramas/${did}/precios`), refetchInterval: 5000 });
  const [sel, setSel] = useState<number | null>(null);
  const [nuevo, setNuevo] = useState("");
  const refrescar = () => void qc.invalidateQueries({ queryKey: clave });
  const prods = q.data?.productos ?? [];
  const actual = prods.find((p) => p.id === sel) ?? prods[0];

  async function agregar() {
    if (!nuevo.trim()) return;
    const p = await api.post<ProductoPrecio>(`/api/colaboradores/diagramas/${did}/precios`,
      { nombre: nuevo.trim(), comision_pct: 15, iva_pct: 19, iva_modo: "incluido", meta_mckenna: 5000 });
    setNuevo(""); setSel(p.id); refrescar();
  }

  return (
    <>
      <div className="fixed inset-0 z-[55] bg-black/30" onClick={onCerrar} aria-hidden="true" />
      <div className="fixed inset-x-0 bottom-0 top-[4dvh] z-[60] mx-auto flex w-full max-w-3xl flex-col rounded-t-2xl border-2 border-ink bg-surface-panel shadow-2xl sm:bottom-4 sm:top-4 sm:rounded-2xl"
           role="dialog" aria-label="Precios y márgenes" data-testid="precios">
        <div className="flex items-center gap-2 border-b-2 border-ink px-3 py-2">
          <Sprite s="moneda" px={2} />
          <div className="min-w-0 flex-1">
            <p className="px-t font-extrabold text-ink">Precios y márgenes</p>
            <p className="text-[11px] text-muted">Mueve los precios y mira cuánto le queda a cada uno. Es una simulación: no cambia la publicación.</p>
          </div>
          <button type="button" onClick={onCerrar} className="px-1 text-2xl leading-none text-muted" aria-label="Cerrar">×</button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto border-b border-border px-3 py-2">
          {prods.map((p) => {
            const c = calcular(p);
            const malo = c.queda_mckenna < p.meta_mckenna || (c.queda_colab != null && c.queda_colab < p.meta_colaborador);
            return (
              <button key={p.id} type="button" onClick={() => setSel(p.id)}
                      className={`shrink-0 rounded-lg border-2 px-2 py-1 text-left text-xs ${actual?.id === p.id ? "border-ink bg-accent text-white" : "border-border text-ink"}`}>
                <b className="block max-w-[11rem] truncate">{p.nombre}</b>
                <span className="opacity-90">{pesos(p.precio_publicacion)} {malo ? "⚠" : "✓"}</span>
              </button>
            );
          })}
          <span className="flex shrink-0 items-center gap-1">
            <input value={nuevo} onChange={(e) => setNuevo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void agregar(); }}
                   placeholder="Nuevo producto" className={`${MINI} w-36`} />
            <button type="button" disabled={!nuevo.trim()} onClick={() => void agregar()} className="rounded border border-border px-2 py-1 text-sm font-bold disabled:opacity-40">＋</button>
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}>
          {q.isLoading && <p className="text-sm text-muted">Cargando…</p>}
          {q.error && <p className="text-sm text-red-500">{(q.error as Error).message}</p>}
          {q.data && !actual && <p className="text-sm text-muted">Agrega el primer producto arriba para empezar a jugar con su precio.</p>}
          {q.data && actual && (
            <Producto key={`${actual.id}-${actual.actualizado_en}`} did={did} p={actual} part={q.data.participantes}
                      proveedorDef={q.data.proveedor_defecto} yoId={yoId} onCambio={refrescar}
                      cambios={q.data.cambios.filter((x) => x.precio_id === actual.id)} />
          )}
        </div>
      </div>
    </>
  );
}
