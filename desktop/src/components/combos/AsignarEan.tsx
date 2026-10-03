import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useActualizarCodigoEan, useCodigosEan, type CodigoEan } from "../../lib/etiquetasCodigosEan";
import { BTN, BTN_SEC, type Combo, type Respuesta } from "./comun";

/**
 * Asignar a un combo un código EAN que YA está registrado, en vez de gastar uno nuevo.
 *
 * Caso real: 43 de los 255 códigos quedaron con un SKU que ya no es de ningún combo (el combo se
 * renombró o se recreó con otro código: «C-ACIGLI30mL» registrado, «C-ACIGLI50P30mL» sin código).
 * Aquí se ven primero esos «sueltos», ordenados por parecido con el nombre del combo.
 *
 * Asignar = `PUT /api/etiquetas/codigos-ean/<id>` con los MISMOS número, presentación, año y
 * bimestre (el código de 13 dígitos no cambia) y el SKU del combo. Es la misma escritura que el lápiz
 * de Códigos EAN, con su mismo permiso. Si el código pertenece a otro combo activo, se pide
 * confirmación: ese combo se quedaría sin código.
 */

const norm = (t: string) =>
  t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

/** Parecido simple por palabras compartidas (sin IA): suficiente para ordenar candidatos. */
function parecido(a: string, b: string): number {
  const A = new Set(norm(a).split(" ").filter((w) => w.length > 1));
  const B = new Set(norm(b).split(" ").filter((w) => w.length > 1));
  if (!A.size || !B.size) return 0;
  let n = 0;
  A.forEach((w) => { if (B.has(w)) n += 1; });
  return n / Math.max(A.size, B.size);
}

export default function AsignarEan({ c, onCancelar, onHecho }: { c: Combo; onCancelar: () => void; onHecho: () => Promise<void> }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [confirmar, setConfirmar] = useState<string | null>(null); // id que pidió confirmación
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Las mismas piezas que usa Códigos EAN: al asignar, esa lista (y el buscador de etiquetas) se actualiza sola.
  const lista = useCodigosEan();
  const actualizar = useActualizarCodigoEan();
  // Los combos que el taller ya tiene cargados: para saber si un código es de un combo activo.
  const combos = (qc.getQueryData<Respuesta>(["mapa-sistema-combos"])?.combos ?? []) as Combo[];
  const nombrePorRef = useMemo(() => new Map(combos.map((x) => [x.ref.toUpperCase(), x.nombre])), [combos]);

  const filas = useMemo(() => {
    const t = norm(q);
    return (lista.data ?? [])
      .map((e) => {
        const dueno = nombrePorRef.get((e.sku || "").trim().toUpperCase()) ?? null;
        return { e, dueno, suelto: !dueno, score: parecido(c.nombre, e.nombre_producto || e.sku) };
      })
      .filter(({ e }) => !t || norm(`${e.sku} ${e.nombre_producto} ${e.codigo}`).includes(t))
      // Sin búsqueda: primero los sueltos parecidos; con búsqueda: todo lo que coincide.
      .filter((f) => t || f.suelto)
      .sort((a, b) => Number(b.suelto) - Number(a.suelto) || b.score - a.score || a.e.nombre_producto.localeCompare(b.e.nombre_producto, "es"))
      .slice(0, 40);
  }, [lista.data, q, nombrePorRef, c.nombre]);

  const asignar = async (e: CodigoEan) => {
    setOcupado(e.id);
    setError(null);
    try {
      const r = await actualizar.mutateAsync({
        id: e.id,
        datos: { sku: c.ref, nombre_producto: c.nombre, numero_producto: e.numero_producto, presentacion: e.presentacion, anio: e.anio, bimestre: e.bimestre, mes: e.bimestre * 2 + 1 },
      });
      if (!r.ok) throw new Error("No se pudo asignar");
      if (r.codigo !== e.codigo) throw new Error(`El código cambió (${e.codigo} → ${r.codigo}); revísalo en Códigos EAN.`);
      await onHecho();
    } catch (err) {
      setError((err as Error)?.message || "No se pudo asignar");
    } finally {
      setOcupado(null);
      setConfirmar(null);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-accent/40 bg-accent/5 p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-bold text-ink">Usar un código ya registrado</p>
        <button className="text-[11px] text-muted underline hover:text-ink" onClick={onCancelar}>cancelar</button>
      </div>
      <input
        value={q}
        onChange={(ev) => setQ(ev.target.value)}
        placeholder="Buscar por nombre, SKU o código…"
        className="w-full rounded-md border border-border bg-surface-input px-2 py-1.5 text-[12px] text-ink"
        autoFocus
      />
      <p className="text-[10.5px] text-muted">
        {q ? "Todos los códigos que coinciden." : "Códigos cuyo SKU ya no es de ningún combo, los más parecidos a este primero. Busca para ver todos."}
      </p>
      {lista.isLoading && <p className="text-[11px] text-muted">Cargando códigos…</p>}
      <ul className="max-h-72 space-y-1 overflow-y-auto pr-0.5">
        {filas.map(({ e, dueno, suelto }) => (
          <li key={e.id} className="rounded-md border border-border bg-surface-panel px-2 py-1.5">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-bold text-ink">{e.nombre_producto || "(sin nombre)"}</p>
                <p className="font-mono text-[10.5px] text-muted">
                  {e.codigo} · {e.sku}{" "}
                  {suelto ? <span className="text-accent-leaf">· suelto</span> : <span className="text-accent-rose">· de {dueno}</span>}
                </p>
              </div>
              <button
                className={suelto ? BTN : BTN_SEC}
                disabled={Boolean(ocupado)}
                onClick={() => (suelto ? asignar(e) : setConfirmar(e.id))}
              >
                {ocupado === e.id ? "Asignando…" : "Asignar"}
              </button>
            </div>
            {confirmar === e.id && (
              <div className="mt-1.5 rounded border border-accent-rose/50 bg-accent-rose/10 p-1.5 text-[11px] text-ink">
                Este código es de <b>{dueno}</b> (<code>{e.sku}</code>), que es un combo activo: si lo asignas aquí, ese combo queda sin código.
                <div className="mt-1 flex gap-2">
                  <button className={BTN} onClick={() => asignar(e)}>Sí, pasarlo a {c.ref}</button>
                  <button className={BTN_SEC} onClick={() => setConfirmar(null)}>No</button>
                </div>
              </div>
            )}
          </li>
        ))}
        {!lista.isLoading && filas.length === 0 && <li className="text-[11px] text-muted">Nada coincide.</li>}
      </ul>
      {error && <p className="text-[11px] text-accent-rose">{error}</p>}
    </div>
  );
}
