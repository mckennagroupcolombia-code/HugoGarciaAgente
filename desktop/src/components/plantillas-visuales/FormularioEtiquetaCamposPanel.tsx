/**
 * Barra inferior del Formulario de etiqueta: campos de "Ficha" y
 * "Especificaciones" en UNA sola grilla — comparten estado con
 * `FormularioEtiquetaPanel` (mismo hook `useFormularioEtiqueta`, ver ahí
 * por qué). Viven aquí y no en el sidebar de 340px porque son varios
 * campos cortos que se aprietan en 2-3 columnas angostas; la barra
 * inferior tiene todo el ancho del lienzo para desplegarlos con más
 * columnas.
 *
 * `gridAutoRows: "1fr"` fuerza que TODAS las casillas (mezclando textarea
 * "largo" con inputs cortos, o Ficha con Especificaciones) midan lo mismo
 * de alto en cada fila — antes, al ser dos grids separados dentro de un
 * flex, Ficha y Especificaciones podían terminar con alturas distintas y
 * las cajas no quedaban alineadas entre sí.
 */
import { CampoBloque } from "./FormularioEtiquetaPanel";
import type { FormularioEtiqueta } from "./useFormularioEtiqueta";

export default function FormularioEtiquetaCamposPanel({ formulario: f }: { formulario: FormularioEtiqueta }) {
  const casillas = [...f.fichaGrid, ...f.specs];
  if (casillas.length === 0) return null;

  return (
    <div className="shrink-0 border-t border-neutral-300 bg-[#f4f4f2] px-3 py-2.5 text-neutral-900 shadow-[0_-4px_16px_rgba(0,0,0,0.18)]">
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-neutral-700">
        Ficha y especificaciones
      </p>
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gridAutoRows: "1fr" }}
      >
        {casillas.map((b) => (
          <CampoBloque
            key={b.id}
            bloque={b}
            valor={f.valores[b.campo] ?? ""}
            onChange={(v) => f.patchCampo(b.campo, v)}
          />
        ))}
      </div>
    </div>
  );
}
