import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Ico } from "../../icons/Ico";
import { api } from "../../api/client";
import { useTiposEtiqueta, type TipoEtiqueta } from "../../lib/etiquetasTipos";
import { BTN, BTN_SEC, cantidad, type Combo, type Respuesta } from "./comun";

/**
 * Pieza «Etiqueta en la receta», explicada y resuelta con un clic.
 *
 * Qué revisa: cada unidad vendida lleva pegada una etiqueta impresa, que es un insumo comprado en
 * rollos (ETQ30mL, ETQ250g…). Para que Alegra la descuente del inventario y la sume al costo, esa
 * etiqueta tiene que ir DENTRO de la receta del kit, 1 por unidad. La etiqueta térmica de envío
 * (ETQTRM) no cuenta: va en la caja, no en el producto (mismo criterio que mapa_producto.py).
 *
 * Antes la pieza solo decía «la receta no incluye etiqueta» y abría el editor del kit en blanco: no
 * decía cuál agregar. Ahora la sugiere: primero el rollo que MIDE lo mismo que el diseño de etiqueta
 * del combo (etiquetas_tipos: «100 g» = 69×51 mm = 2.75"×2"), luego lo que usan las otras
 * presentaciones del mismo producto y los combos de la misma presentación — y la agrega
 * leyendo la receta viva de Alegra y guardándola por el mismo PATCH /api/alegra/catalogo/<sku>
 * del editor de kits (si el kit tiene ventas, Alegra no deja cambiar la receta y se dice así).
 */

type CompVivo = { codigo: string; nombre?: string; cantidad: number };
type Sugerencia = { codigo: string; nombre: string; motivo: string; peso: number };

const esTermica = (codigo: string, nombre: string) => /TRM|TERMICA|TÉRMICA/i.test(`${codigo} ${nombre}`);

/** Medida física del rollo a partir de su nombre en Alegra (pulgadas → mm), o null si no la dice. */
function mmDelRollo(nombre: string): [number, number] | null {
  const m = nombre.match(/(\d+(?:\.\d+)?)"\s*X\s*(\d+(?:\.\d+)?)"/i);
  if (m) return [Number(m[1]) * 25.4, Number(m[2]) * 25.4];
  const circ = nombre.match(/CIRCULAR\s*(\d+)\s*MM?/i);
  return circ ? [Number(circ[1]), Number(circ[1])] : null;
}

/** ¿El rollo tiene la medida del diseño (en cualquier orientación, con unos mm de tolerancia)? */
function coincideMedida(rollo: [number, number], tipo: TipoEtiqueta): boolean {
  const cerca = (a: number, b: number) => Math.abs(a - b) <= 6;
  const [w, h] = rollo;
  return (cerca(w, tipo.ancho_mm) && cerca(h, tipo.alto_mm)) || (cerca(w, tipo.alto_mm) && cerca(h, tipo.ancho_mm));
}

function sugerir(c: Combo, combos: Combo[], tipoDiseno: TipoEtiqueta | null): Sugerencia[] {
  const out = new Map<string, Sugerencia>();
  const sumar = (codigo: string, nombre: string, motivo: string, peso: number) => {
    const prev = out.get(codigo);
    if (!prev) out.set(codigo, { codigo, nombre, motivo, peso });
    else {
      if (peso > prev.peso) prev.motivo = motivo; // el motivo que se muestra es el de la señal más fuerte
      prev.peso += peso;
    }
  };
  const etiquetasDe = (x: Combo) => x.componentes.filter((k) => k.casilla === "etiqueta" && !esTermica(k.codigo, k.nombre));

  // 0. La señal más fuerte: el rollo que MIDE lo mismo que el diseño de etiqueta de este combo
  //    (formato «100 g» = 69×51 mm = rollo 2.75"×2"). Se busca entre los rollos que ya usa algún combo.
  if (tipoDiseno) {
    const vistos = new Set<string>();
    for (const x of combos)
      for (const k of etiquetasDe(x)) {
        if (vistos.has(k.codigo)) continue;
        vistos.add(k.codigo);
        const mm = mmDelRollo(k.nombre);
        if (mm && coincideMedida(mm, tipoDiseno)) sumar(k.codigo, k.nombre, `mide lo mismo que su diseño de etiqueta («${tipoDiseno.nombre}», ${tipoDiseno.ancho_mm}×${tipoDiseno.alto_mm} mm)`, 1000);
      }
  }
  // 1. Otras presentaciones del mismo producto (misma materia prima).
  if (c.familia) {
    for (const h of combos) {
      if (h.ref === c.ref || h.familia !== c.familia) continue;
      for (const k of etiquetasDe(h)) sumar(k.codigo, k.nombre, `la usa ${h.nombre}`, 100);
    }
  }
  // 2. Combos con la misma presentación (30mL, 500g…).
  const pres = (c.presentacion || "").trim().toUpperCase();
  if (pres) {
    const n = new Map<string, { nombre: string; veces: number }>();
    for (const x of combos) {
      if (x.ref === c.ref || (x.presentacion || "").trim().toUpperCase() !== pres) continue;
      for (const k of etiquetasDe(x)) n.set(k.codigo, { nombre: k.nombre, veces: (n.get(k.codigo)?.veces ?? 0) + 1 });
    }
    n.forEach((v, codigo) => sumar(codigo, v.nombre, `la usan ${v.veces} combo${v.veces === 1 ? "" : "s"} de ${c.presentacion}`, v.veces));
  }
  return [...out.values()].sort((a, b) => b.peso - a.peso).slice(0, 3);
}

/** «ETIQUETA 4" X 1.5" ROUNDED-CORNER…» → «4" × 1.5"»: lo que se reconoce en el rollo. */
function medida(nombre: string): string {
  const m = nombre.match(/(\d+(?:\.\d+)?)"\s*X\s*(\d+(?:\.\d+)?)"/i);
  if (m) return `${m[1]}" × ${m[2]}"`;
  const circ = nombre.match(/CIRCULAR\s*(\d+)\s*MM?/i);
  return circ ? `circular ${circ[1]} mm` : "";
}

export default function InspectorEtiquetaReceta({ c, alResolver, irAReceta, abrirKit }: {
  c: Combo;
  alResolver: () => Promise<void>;
  /** Ver la pieza «Receta» (cuando está rota, se arregla primero). */
  irAReceta: () => void;
  /** Editor completo del kit, para elegir otra etiqueta. */
  abrirKit: () => void;
}) {
  const qc = useQueryClient();
  const e = c.eslabones.etiqueta_fisica;
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [c.ref]);

  const combos = (qc.getQueryData<Respuesta>(["mapa-sistema-combos"])?.combos ?? []) as Combo[];
  const tipos = useTiposEtiqueta();
  const tamano = (c.eslabones.etiqueta?.tamano || "").trim();
  const tipoDiseno = useMemo(
    () => (tamano ? tipos.data?.tipos.find((t) => t.nombre.trim().toLowerCase() === tamano.toLowerCase()) ?? null : null),
    [tipos.data, tamano],
  );
  const sugerencias = useMemo(() => sugerir(c, combos, tipoDiseno), [c, combos, tipoDiseno]);
  const enReceta = c.componentes.filter((k) => k.casilla === "etiqueta");
  const recetaRota = c.eslabones.receta?.estado === "falta";

  const agregar = async (s: Sugerencia) => {
    setOcupado(s.codigo);
    setError(null);
    try {
      // La receta VIVA de Alegra (no la copia local): se reescribe entera, así que debe estar al día.
      const vivo = await api.get<{ ok: boolean; componentes?: CompVivo[]; tiene_movimientos?: boolean | null; editable_composicion?: boolean }>(
        `/api/siigo/productos/detalle?codigo=${encodeURIComponent(c.ref)}`,
      );
      if (!vivo.ok) throw new Error("No se pudo leer la receta actual en Alegra. Inténtalo de nuevo.");
      if (vivo.tiene_movimientos === true || vivo.editable_composicion === false)
        throw new Error("Este combo ya tiene ventas en Alegra y Alegra no deja cambiar su receta. Para corregirlo hay que duplicar el combo (Receta → editar el kit).");
      const actuales = (vivo.componentes ?? []).filter((k) => (k.codigo || "").trim());
      if (!actuales.length) throw new Error("Alegra devolvió la receta vacía: arregla primero la pieza «Receta».");
      if (actuales.some((k) => k.codigo.toUpperCase() === s.codigo.toUpperCase())) {
        await alResolver();
        return;
      }
      const componentes = [...actuales.map((k) => ({ codigo: k.codigo, cantidad: Number(k.cantidad) || 1 })), { codigo: s.codigo, cantidad: 1 }];
      const r = await api.patch<{ ok: boolean; error?: string }>(`/api/alegra/catalogo/${encodeURIComponent(c.ref)}`, { componentes });
      if (!r.ok) throw new Error(r.error || "Alegra no aceptó el cambio");
      await alResolver();
    } catch (err) {
      setError((err as Error)?.message || "No se pudo agregar la etiqueta");
    } finally {
      setOcupado(null);
    }
  };

  return (
    <div className="space-y-2.5">
      <div className="rounded-lg border border-border bg-surface px-3 py-2 text-[12px] leading-snug text-ink">
        <p className="font-bold"><Ico e="🏷️" /> Qué revisa esta pieza</p>
        <p className="mt-0.5 text-ink-secondary">
          Cada unidad de <b>{c.nombre}</b> sale con una etiqueta impresa pegada. Esa etiqueta es un insumo que se compra en rollos.
          Para que al vender se <b>descuente del inventario</b> y se <b>sume al costo</b>, tiene que estar dentro de la receta del kit: <b>1 por unidad</b>.
        </p>
      </div>

      {e.estado === "ok" ? (
        <>
          <p className="text-[12px] font-semibold text-accent-leaf">✓ Está bien: la receta ya descuenta la etiqueta.</p>
          {enReceta.filter((k) => !esTermica(k.codigo, k.nombre)).map((k) => (
            <div key={k.codigo} className="rounded-md border border-border bg-surface-input px-2 py-1.5 text-[11.5px] text-ink">
              <b>{k.codigo}</b> · {medida(k.nombre) || k.nombre} · {cantidad(k)} por unidad
            </div>
          ))}
          <p className="text-[11px] text-muted">Solo revisa que esa sea la etiqueta del tamaño que de verdad se pega en este producto.</p>
        </>
      ) : recetaRota ? (
        <div className="rounded-md border border-accent-sun/60 bg-accent-sun/10 px-3 py-2 text-[12px] text-ink">
          Primero hay que arreglar la <b>Receta</b>: {c.eslabones.receta.detalle} Con la receta rota no tiene sentido agregarle la etiqueta.
          <div className="mt-1.5"><button className={BTN} onClick={irAReceta}>Ir a la Receta →</button></div>
        </div>
      ) : (
        <>
          <p className="text-[12px] text-ink">
            <b>Qué falta:</b> la receta de <code>{c.ref}</code> no tiene etiqueta{enReceta.length ? " (solo la térmica de envío, que no cuenta)" : ""}.
            {sugerencias.length ? " Elige la que se pega en este producto:" : ""}
          </p>
          {sugerencias.map((s, i) => (
            <div key={s.codigo} className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 ${i === 0 ? "border-accent/60 bg-accent/5" : "border-border bg-surface-input"}`}>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-bold text-ink">{s.codigo} {medida(s.nombre) && <span className="font-normal text-muted">· {medida(s.nombre)}</span>}</p>
                <p className="text-[10.5px] text-muted">{i === 0 ? "Sugerida: " : ""}{s.motivo}</p>
              </div>
              <button className={i === 0 ? BTN : BTN_SEC} disabled={Boolean(ocupado)} onClick={() => agregar(s)}>
                {ocupado === s.codigo ? "Agregando…" : "Agregar ×1 a la receta"}
              </button>
            </div>
          ))}
          {!sugerencias.length && <p className="text-[11.5px] text-muted">No hay otro combo parecido que sirva de referencia: elígela en el editor del kit.</p>}
          <button className="text-[11.5px] text-muted underline hover:text-ink" onClick={abrirKit}>Es otra etiqueta: elegirla en el editor del kit…</button>
          <p className="text-[10.5px] text-muted">
            ¿Este producto no lleva etiqueta (una herramienta, un equipo)? Entonces esta pieza no aplica y puedes dejarla así.
          </p>
        </>
      )}
      {error && <p className="rounded-md border border-accent-rose/50 bg-accent-rose/10 px-2 py-1.5 text-[11.5px] text-ink">{error}</p>}
    </div>
  );
}
