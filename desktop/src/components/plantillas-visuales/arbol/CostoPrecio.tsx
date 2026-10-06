/**
 * Árbol del producto → presentación → «Costo vs. precio»: la receta del combo costeada con la
 * última compra de cada componente, contra el precio publicado en cada canal
 * (app/services/costo_receta.py). Los precios llevan IVA; el margen se mide sin IVA y en MeLi
 * después de la comisión de referencia. Si alguna pieza no tiene costo, el margen es un techo.
 */
import { Sprite } from "../../colaboradores/pixel";
import { CAJA, PUNTO, pesos, type ContrasteCanal, type Estado, type Presentacion } from "./tipos";

const CANAL: Record<ContrasteCanal["canal"], string> = { web: "Web", meli: "MeLi", lista: "Lista Alegra" };

const FUENTE: Record<string, string> = {
  libro: "compra",
  factura: "factura",
  referencia: "equivalencia",
  manual: "a mano",
  alegra: "Alegra",
};

/** Márgenes con los que se sugiere precio cuando todavía no está publicado. */
const MARGENES = [0.4, 0.5, 0.6];

function estadoMargen(c: ContrasteCanal): Estado {
  if (c.utilidad <= 0) return "falta";
  if ((c.margen ?? 0) < 0.3) return "aviso";
  return "ok";
}

function pct(n: number | null | undefined): string {
  return n == null ? "—" : `${Math.round(n * 100)} %`;
}

export function CostoPrecio({ p, onReceta }: { p: Presentacion; onReceta: () => void }) {
  const k = p.costo;
  if (!k) return null;
  if (k.error) {
    return <p className="ap-nota ap-aviso">No se pudo costear la receta: {k.error}</p>;
  }
  const tasa = k.tasa_iva ?? (k.con_iva ? 0.19 : 0);
  const iva = 1 + tasa;
  const sugerido = (margen: number, comision: number) =>
    k.total > 0 && 1 - margen - comision > 0 ? (k.total / (1 - margen - comision)) * iva : null;
  const hayPrecio = k.contraste.length > 0;

  return (
    <div className="ap-carta flex flex-col">
      <div className="ap-cab ap-cab-navy">
        <Sprite s="moneda" px={2} />
        <span className="min-w-0 flex-1">Costo vs. precio</span>
        <span className="tabular-nums" title="Costo de la receta sin IVA">{pesos(k.total)}{k.parcial ? "+" : ""}</span>
      </div>
      <div className="flex flex-col gap-1.5 p-2.5">
        <p className="ap-t">Receta · última compra de cada pieza, sin IVA</p>
        <table className="ap-tabla">
          <tbody>
            {k.lineas.map((l) => (
              <tr key={l.codigo + l.nombre} className={l.subtotal == null ? "ap-tabla-falta" : ""}
                title={`${l.detalle}${l.fecha ? ` · ${l.fecha}` : ""}`}>
                <td className="min-w-0">
                  <span className="block truncate">{l.nombre || l.codigo}</span>
                  <code className="text-[10px] text-ink-secondary">{l.codigo}</code>
                </td>
                <td className="tabular-nums text-right">{l.cantidad.toLocaleString("es-CO")} ×</td>
                <td className="tabular-nums text-right">
                  {l.costo_unitario == null ? "sin costo" : `$${l.costo_unitario.toLocaleString("es-CO", { maximumFractionDigits: 2 })}`}
                </td>
                <td className="tabular-nums text-right font-extrabold">{l.subtotal == null ? "—" : pesos(l.subtotal)}</td>
                <td className="text-right"><span className="ap-fuente">{FUENTE[l.fuente] || "—"}</span></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>Costo de la receta</td>
              <td className="tabular-nums text-right">{pesos(k.total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
        {k.parcial && (
          <button type="button" className="ap-nota ap-aviso text-left" onClick={onReceta}>
            Sin costo: {k.sin_costo.join(", ")}. El costo real es mayor y el margen de abajo es un techo.
          </button>
        )}

        <p className="ap-t mt-1">Precio publicado (con IVA {pct(tasa)}) contra el costo</p>
        {hayPrecio ? (
          k.contraste.map((c) => {
            const est = estadoMargen(c);
            return (
              <div key={c.canal} className={`ap-fila ${CAJA[est]}`}
                title={`Sin IVA ${pesos(c.neto)}${c.comision ? ` − comisión ${pct(k.comision_meli)} ${pesos(c.comision)}` : ""} − costo ${pesos(k.total)} = ${pesos(c.utilidad)}`}>
                <span className={`h-3 w-3 ${PUNTO[est]}`} />
                <span className="w-20 shrink-0 text-[12px] font-extrabold">{CANAL[c.canal]}</span>
                <span className="min-w-0 flex-1 text-[11.5px] tabular-nums">
                  {pesos(c.precio)} · deja {pesos(c.utilidad)}
                  {c.veces_costo ? ` · ${c.veces_costo.toLocaleString("es-CO")}× el costo` : ""}
                </span>
                <span className="shrink-0 text-[12px] font-extrabold tabular-nums">{k.parcial ? "≤ " : ""}{pct(c.margen)}</span>
              </div>
            );
          })
        ) : (
          <p className="ap-nota ap-aviso">Todavía sin precio publicado: no hay con qué contrastar.</p>
        )}

        {k.total > 0 && (
          <table className="ap-tabla ap-tabla-sugerido" title="Precio con IVA que deja ese margen sobre el precio sin IVA (en MeLi, después de la comisión)">
            <thead>
              <tr>
                <td>Precio para un margen de</td>
                {MARGENES.map((m) => <td key={m} className="text-right">{pct(m)}</td>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Web</td>
                {MARGENES.map((m) => <td key={m} className="tabular-nums text-right">{pesos(sugerido(m, 0))}</td>)}
              </tr>
              <tr>
                <td>MeLi</td>
                {MARGENES.map((m) => <td key={m} className="tabular-nums text-right">{pesos(sugerido(m, k.comision_meli))}</td>)}
              </tr>
            </tbody>
          </table>
        )}
        <p className="text-[10.5px] text-ink-secondary">
          Margen sobre el precio sin IVA ({pct(tasa)}, la tarifa del combo en Alegra){k.contraste.some((c) => c.canal === "meli") ? `; en MeLi después de una comisión de referencia del ${pct(k.comision_meli)} (sin envío)` : ""}.
          Pasa el cursor por cada pieza para ver de qué compra sale su costo.
        </p>
      </div>
    </div>
  );
}
