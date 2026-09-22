import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Ico } from "../../icons/Ico";
import { api } from "../../api/client";
import { BTN, BTN_SEC, CASILLA, type Casilla, type Combo, type Respuesta } from "./comun";

/**
 * Pieza «Receta» cuando está rota: qué significa, qué le pasa a ESTE combo y una receta propuesta
 * lista para revisar y guardar.
 *
 * La receta del kit en Alegra dice qué sale del inventario al vender UNA unidad: la materia prima
 * (tantos g/mL como la presentación), el envase, la tapa, la bolsa y la etiqueta. Tres daños reales
 * (21-sep-2026, 27 combos):
 *  - Sin componentes (14): al vender no se descuenta nada ni hay costo.
 *  - Solo empaque (5): falta el producto mismo.
 *  - Cantidad que no cuadra (8): descuenta 51 mL en un gotero de 5 mL, 1 g en una bolsa de 500 g…
 *
 * La propuesta se arma SIN IA con lo que ya existe: la materia prima sale de las otras presentaciones
 * del mismo producto (ACEITE NEEM 120mL → ACENEEmL) o del catálogo por nombre; el empaque se copia
 * del combo más parecido con la MISMA presentación y la receta sana. Se guarda leyendo la receta
 * viva de Alegra y por el mismo PATCH /api/alegra/catalogo/<sku> del editor de kits.
 */

type CompVivo = { codigo: string; nombre?: string; cantidad: number };
type Fila = { codigo: string; nombre: string; casilla: Casilla; cantidad: number; usar: boolean; origen: string };
type ProductoCat = { reference: string; name: string; type: string; status?: string };

const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const RE_PRES = /(\d+(?:[.,]\d+)?)\s*(KG|G|GR|ML|L|LT)\b/i;

/** «ACEITE NEEM 60mL» → base «ACEITE NEEM», cantidad 60 (en g o mL; KG/L → 1000). */
function presentacionDe(c: Combo): { base: string; cantidad: number | null } {
  const texto = `${c.nombre} ${c.presentacion || ""}`;
  const m = texto.match(RE_PRES);
  const base = norm(c.nombre.replace(RE_PRES, "").replace(/\bKG\b|\bLT?\b/gi, ""));
  if (m) {
    const n = Number(m[1].replace(",", "."));
    const u = m[2].toUpperCase();
    return { base, cantidad: u === "KG" || u === "L" || u === "LT" ? n * 1000 : n };
  }
  return { base, cantidad: /\bKG\b/i.test(texto) ? 1000 : null };
}

/** Una materia prima se cuenta en g/mL si su código termina así (ACENEEmL, CRETARg); si no, por unidad. */
const porPeso = (codigo: string) => /(g|ml)$/i.test(codigo.trim()) && !/un$/i.test(codigo.trim());

function parecido(a: string, b: string): number {
  const A = new Set(norm(a).split(" ").filter((w) => w.length > 2));
  const B = new Set(norm(b).split(" ").filter((w) => w.length > 2));
  if (!A.size || !B.size) return 0;
  let n = 0;
  A.forEach((w) => { if (B.has(w)) n += 1; });
  return n / Math.max(A.size, B.size);
}

export default function InspectorReceta({ c, alResolver, abrirKit }: { c: Combo; alResolver: () => Promise<void>; abrirKit: () => void }) {
  const qc = useQueryClient();
  const e = c.eslabones.receta;
  const combos = (qc.getQueryData<Respuesta>(["mapa-sistema-combos"])?.combos ?? []) as Combo[];
  const { base, cantidad: qPres } = presentacionDe(c);
  const mp = c.componentes.filter((k) => k.casilla === "materia_prima");
  const tipo: "vacia" | "sin_mp" | "cantidad" | "otro" =
    !c.componentes.length ? "vacia" : !mp.length ? "sin_mp" : /descuenta .* la presentaci/.test(e.detalle) ? "cantidad" : "otro";

  // Materia prima candidata 1: la que usan las otras presentaciones del mismo producto.
  const mpHermanas = useMemo(() => {
    const out = new Map<string, { codigo: string; nombre: string; de: string }>();
    for (const x of combos) {
      if (x.ref === c.ref || presentacionDe(x).base !== base) continue;
      for (const k of x.componentes) if (k.casilla === "materia_prima" && !out.has(k.codigo)) out.set(k.codigo, { codigo: k.codigo, nombre: k.nombre, de: x.nombre });
    }
    return [...out.values()];
  }, [combos, c.ref, base]);
  // Candidata 2: productos del catálogo con nombre parecido (solo si las hermanas no dicen nada).
  const primeras = base.split(" ").filter((w) => w.length > 2).slice(0, 2).join(" ");
  const cat = useQuery({
    queryKey: ["receta-mp-catalogo", primeras],
    queryFn: () => api.get<{ items: ProductoCat[] }>(`/api/alegra/catalogo?tipo=product&limit=15&q=${encodeURIComponent(primeras)}`),
    enabled: (tipo === "vacia" || tipo === "sin_mp") && !mpHermanas.length && Boolean(primeras),
    staleTime: 60_000,
  });
  const mpCandidatas = useMemo(() => {
    if (mpHermanas.length) return mpHermanas.map((h) => ({ codigo: h.codigo, nombre: h.nombre, motivo: `la usa ${h.de}` }));
    return (cat.data?.items ?? [])
      .filter((p) => p.type === "product" && p.status !== "inactive")
      .map((p) => ({ codigo: p.reference, nombre: p.name, motivo: "nombre parecido en el catálogo", s: parecido(base, p.name) }))
      .filter((p) => p.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 4);
  }, [mpHermanas, cat.data, base]);

  // Empaque: copiado del combo más parecido con la misma presentación y la receta sana.
  const modelo = useMemo(() => {
    const pres = norm(c.presentacion || "") || (qPres ? String(qPres) : "");
    if (!pres) return null;
    return combos
      .filter((x) => x.ref !== c.ref && x.eslabones.receta?.estado === "ok" && norm(x.presentacion || "") === pres)
      .map((x) => ({ x, s: parecido(c.nombre, x.nombre) + (x.linea && x.linea === c.linea ? 0.5 : 0) }))
      .sort((a, b) => b.s - a.s)[0]?.x ?? null;
  }, [combos, c, qPres]);

  // Respaldo: sin combo de la misma presentación, la presentación hermana más cercana en tamaño.
  // Bolsa, etiqueta y protección suelen repetirse; envase y tapa cambian con el tamaño (se avisa).
  const modeloHermana = useMemo(() => {
    if (modelo) return null;
    return combos
      .filter((x) => x.ref !== c.ref && x.eslabones.receta?.estado === "ok" && presentacionDe(x).base === base)
      .map((x) => ({ x, d: Math.abs((presentacionDe(x).cantidad ?? 0) - (qPres ?? 0)) }))
      .sort((a, b) => a.d - b.d)[0]?.x ?? null;
  }, [modelo, combos, c.ref, base, qPres]);
  const cambiaConTamano = (k: { casilla: Casilla }) => k.casilla === "envase" || k.casilla === "tapa";

  // Envase y tapa de la hermana, pasados al tamaño de este combo: BANTER120mL → BANTER60mL, si existe.
  const tokHermana = modeloHermana ? (modeloHermana.nombre.match(RE_PRES)?.[0] ?? "").replace(/\s+/g, "") : "";
  const tokEste = (c.nombre.match(RE_PRES)?.[0] ?? "").replace(/\s+/g, "");
  const equivalentes = useQuery({
    queryKey: ["receta-equivalentes", modeloHermana?.ref, tokEste],
    enabled: Boolean(modeloHermana && tokHermana && tokEste && tipo === "vacia"),
    staleTime: 60_000,
    queryFn: async () => {
      const out: Record<string, { codigo: string; nombre: string } | null> = {};
      const re = new RegExp(tokHermana.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      for (const k of modeloHermana!.componentes.filter(cambiaConTamano)) {
        if (!re.test(k.codigo)) { out[k.codigo] = null; continue; }
        const cand = k.codigo.replace(re, tokEste);
        const r = await api.get<{ items: ProductoCat[] }>(`/api/alegra/catalogo?tipo=product&limit=5&q=${encodeURIComponent(cand)}`).catch(() => ({ items: [] as ProductoCat[] }));
        const hit = r.items.find((p) => p.reference.toUpperCase() === cand.toUpperCase());
        out[k.codigo] = hit ? { codigo: hit.reference, nombre: hit.name } : null;
      }
      return out;
    },
  });

  const [mpElegida, setMpElegida] = useState<string>("");
  useEffect(() => setMpElegida(""), [c.ref]);
  const mpCodigo = mpElegida || mpCandidatas[0]?.codigo || "";
  const mpNombre = mpCandidatas.find((m) => m.codigo === mpCodigo)?.nombre ?? mpCodigo;

  // La propuesta según el daño.
  const [filas, setFilas] = useState<Fila[]>([]);
  useEffect(() => {
    const qMp = (codigo: string) => (porPeso(codigo) && qPres ? qPres : 1);
    let f: Fila[] = [];
    if (tipo === "vacia" || tipo === "sin_mp") {
      if (mpCodigo) f.push({ codigo: mpCodigo, nombre: mpNombre, casilla: "materia_prima", cantidad: qMp(mpCodigo), usar: true, origen: "materia prima" });
      const actuales = c.componentes.map((k) => ({ codigo: k.codigo, nombre: k.nombre, casilla: k.casilla, cantidad: k.cantidad, usar: true, origen: "ya está en la receta" }));
      const fuente = modelo ?? modeloHermana;
      const empaque = tipo === "vacia" && fuente
        ? fuente.componentes.filter((k) => k.casilla !== "materia_prima").map((k) => {
            const ojo = !modelo && cambiaConTamano(k);
            const eq = ojo ? equivalentes.data?.[k.codigo] : undefined;
            // Envase y tapa de otro tamaño: la versión de este tamaño si existe; si no, desmarcado y avisado.
            if (eq) return { codigo: eq.codigo, nombre: eq.nombre, casilla: k.casilla, cantidad: k.cantidad, usar: true, origen: `versión de ${tokEste} de ${k.codigo}` };
            return { codigo: k.codigo, nombre: k.nombre, casilla: k.casilla, cantidad: k.cantidad, usar: !ojo,
              origen: ojo ? `⚠ es de ${fuente.nombre} y no hay versión de ${tokEste || "este tamaño"} en el catálogo: elige el correcto en el editor del kit` : `como ${fuente.nombre}` };
          })
        : [];
      f = [...f, ...actuales, ...empaque];
    } else if (tipo === "cantidad") {
      f = c.componentes.map((k) => ({
        codigo: k.codigo, nombre: k.nombre, casilla: k.casilla, usar: true,
        cantidad: k.casilla === "materia_prima" && porPeso(k.codigo) && qPres ? qPres : k.cantidad,
        origen: k.casilla === "materia_prima" && porPeso(k.codigo) && qPres && k.cantidad !== qPres ? `antes ${k.cantidad}` : "sin cambio",
      }));
    }
    setFilas(f);
  }, [tipo, mpCodigo, mpNombre, modelo, modeloHermana, equivalentes.data, c.ref, qPres]); // eslint-disable-line react-hooks/exhaustive-deps

  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [c.ref]);

  const guardar = async () => {
    setOcupado(true);
    setError(null);
    try {
      const vivo = await api.get<{ ok: boolean; componentes?: CompVivo[]; tiene_movimientos?: boolean | null; editable_composicion?: boolean }>(
        `/api/siigo/productos/detalle?codigo=${encodeURIComponent(c.ref)}`,
      );
      if (!vivo.ok) throw new Error("No se pudo leer la receta actual en Alegra. Inténtalo de nuevo.");
      if (vivo.tiene_movimientos === true || vivo.editable_composicion === false)
        throw new Error("Este combo ya tiene ventas en Alegra y Alegra no deja cambiar su receta. Hay que duplicarlo con la receta correcta (editor del kit → duplicar).");
      const nuevos = filas.filter((f) => f.usar && f.cantidad > 0);
      // Lo que Alegra tenga y la propuesta no mencione se conserva (nadie lo quita sin verlo).
      const mencionados = new Set(nuevos.map((f) => f.codigo.toUpperCase()));
      const conservar = (vivo.componentes ?? []).filter((k) => k.codigo && !mencionados.has(k.codigo.toUpperCase()) && !filas.some((f) => f.codigo.toUpperCase() === k.codigo.toUpperCase()));
      const componentes = [...nuevos.map((f) => ({ codigo: f.codigo, cantidad: f.cantidad })), ...conservar.map((k) => ({ codigo: k.codigo, cantidad: Number(k.cantidad) || 1 }))];
      if (!componentes.some((k) => filas.find((f) => f.codigo === k.codigo)?.casilla === "materia_prima"))
        throw new Error("La receta tiene que llevar la materia prima: marca una.");
      const r = await api.patch<{ ok: boolean; error?: string }>(`/api/alegra/catalogo/${encodeURIComponent(c.ref)}`, { componentes });
      if (!r.ok) throw new Error(r.error || "Alegra no aceptó la receta");
      await alResolver();
    } catch (err) {
      setError((err as Error)?.message || "No se pudo guardar la receta");
    } finally {
      setOcupado(false);
    }
  };

  const qTexto = qPres ? `${qPres.toLocaleString("es-CO")} ${/ML|\bL\b|LT/i.test(`${c.nombre} ${c.presentacion}`) ? "mL" : "g"}` : "";
  const diagnostico =
    tipo === "vacia" ? <>La receta está <b>vacía</b>: al vender una unidad no se descuenta nada del inventario y el producto figura sin costo.</>
    : tipo === "sin_mp" ? <>La receta solo tiene empaque: <b>falta el producto mismo</b> (la materia prima), así que al vender no baja su inventario.</>
    : tipo === "cantidad" ? <>La cantidad de materia prima <b>no cuadra con la presentación</b>: {e.detalle}. Cada unidad de {c.presentacion || "esta presentación"} debería descontar {qTexto || "lo que dice la presentación"}.</>
    : <>{e.detalle}</>;

  return (
    <div className="space-y-2.5">
      <div className="rounded-lg border border-border bg-surface px-3 py-2 text-[12px] leading-snug text-ink">
        <p className="font-bold"><Ico e="🧪" /> Qué revisa esta pieza</p>
        <p className="mt-0.5 text-ink-secondary">
          La receta dice qué sale del inventario cuando se vende <b>una unidad</b>: la materia prima ({qTexto || "lo que diga la presentación"}), el envase, la tapa, la bolsa y la etiqueta.
          Con eso Alegra descuenta existencias y calcula el costo.
        </p>
      </div>
      <div className="rounded-md border border-accent-sun/60 bg-accent-sun/10 px-3 py-2 text-[12px] text-ink"><b>Qué pasa aquí:</b> {diagnostico}</div>

      {(tipo === "vacia" || tipo === "sin_mp" || tipo === "cantidad") && (
        <>
          <p className="text-[12px] font-bold text-ink">Cómo arreglarlo: revisa esta receta y guárdala</p>
          {(tipo === "vacia" || tipo === "sin_mp") && (
            <div className="text-[11.5px] text-ink">
              {cat.isLoading ? (
                <span className="text-muted">Buscando la materia prima…</span>
              ) : mpCandidatas.length ? (
                <label className="flex flex-wrap items-center gap-1.5">
                  Materia prima:
                  <select value={mpCodigo} onChange={(ev) => setMpElegida(ev.target.value)} className="min-w-0 max-w-full rounded border border-border bg-surface-input px-1.5 py-1 text-[11.5px]">
                    {mpCandidatas.map((m) => <option key={m.codigo} value={m.codigo}>{m.codigo} · {m.nombre} ({m.motivo})</option>)}
                  </select>
                </label>
              ) : (
                <span className="text-accent-rose">No encontré la materia prima por nombre: agrégala en el editor del kit.</span>
              )}
              {tipo === "vacia" && (
                <p className="mt-1 text-muted">
                  {modelo ? <>Empaque copiado de <b>{modelo.nombre}</b> (misma presentación). Quita lo que no aplique.</>
                    : modeloHermana ? <>Ningún otro combo de {c.presentacion || "este tamaño"} tiene la receta sana: el empaque viene de <b>{modeloHermana.nombre}</b>. El envase y la tapa se cambian por los de {c.presentacion || "este tamaño"} cuando existen; los que no, quedan desmarcados con aviso.</>
                    : "No hay otro combo de la misma presentación para copiar el empaque: agrégalo en el editor del kit."}
                </p>
              )}
            </div>
          )}
          <table className="w-full text-[11.5px]">
            <tbody>
              {filas.map((f, i) => (
                <tr key={`${f.codigo}-${i}`} className={`border-b border-border/60 ${f.usar ? "" : "opacity-50"}`}>
                  <td className="w-6 py-1"><input type="checkbox" checked={f.usar} onChange={(ev) => setFilas((xs) => xs.map((x, j) => (j === i ? { ...x, usar: ev.target.checked } : x)))} /></td>
                  <td className="py-1 pr-1"><Ico e={CASILLA[f.casilla]?.icono ?? "📦"} /></td>
                  <td className="py-1"><b className="text-ink">{f.codigo}</b> <span className="text-muted">{f.nombre !== f.codigo ? f.nombre : ""}</span><br /><span className="font-mono text-[9.5px] text-muted">{f.origen}</span></td>
                  <td className="w-20 py-1 text-right">
                    <input type="number" min={0} step="any" value={f.cantidad}
                      onChange={(ev) => setFilas((xs) => xs.map((x, j) => (j === i ? { ...x, cantidad: Number(ev.target.value) } : x)))}
                      className={`w-16 rounded border px-1 py-0.5 text-right tabular-nums ${f.casilla === "materia_prima" ? "border-accent" : "border-border"} bg-surface-input`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-2">
            <button className={BTN} disabled={ocupado || !filas.some((f) => f.usar && f.casilla === "materia_prima")} onClick={guardar}>
              {ocupado ? "Guardando en Alegra…" : "Guardar esta receta en Alegra"}
            </button>
            <button className={BTN_SEC} onClick={abrirKit}>Prefiero armarla en el editor del kit…</button>
          </div>
        </>
      )}
      {tipo === "otro" && <button className={BTN} onClick={abrirKit}>Corregirla en el editor del kit…</button>}
      {tipo === "cantidad" && !filas.some((f) => f.origen.startsWith("antes")) && (
        <p className="text-[11px] text-muted">La materia prima se cuenta por unidades (un vaso, una espátula): si 1 unidad es correcta, esta pieza está bien así.</p>
      )}
      <p className="text-[10.5px] text-muted">¿Es un combo que ya no se vende (una copia, un duplicado)? No lo arregles: inactívalo en Alegra.</p>
      {error && <p className="rounded-md border border-accent-rose/50 bg-accent-rose/10 px-2 py-1.5 text-[11.5px] text-ink">{error}</p>}
    </div>
  );
}
