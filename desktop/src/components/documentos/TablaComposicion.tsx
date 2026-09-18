import type { ReactNode } from "react";
import { Icon } from "../../icons";

type FilaComposicion = { componente: string; porcentaje: string; resto: string };

const FILA_VACIA: FilaComposicion = { componente: "", porcentaje: "", resto: "" };

/** El valor viaja como texto `componente|porcentaje|CAS` por línea (el mismo
 *  que usan la IA, el escáner y `filasTresDesdeTexto`). La tabla solo edita las
 *  dos primeras columnas; la tercera (CAS del componente) se conserva tal cual. */
function parsear(texto: string): FilaComposicion[] {
  return texto
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const p = l.split("|");
      return {
        componente: (p[0] ?? "").trim(),
        porcentaje: (p[1] ?? "").trim(),
        resto: p.slice(2).join("|").trim(),
      };
    });
}

function serializar(filas: FilaComposicion[]): string {
  return filas.map((f) => `${f.componente}|${f.porcentaje}|${f.resto}`).join("\n");
}

/**
 * Composición del producto como tabla de dos columnas (Componente · Porcentaje),
 * con la misma mecánica que «Parámetros de análisis» del COA.
 */
export function TablaComposicion({
  label = "Composición",
  value,
  onChange,
  actions,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  /** Acciones extra a la derecha del título (p. ej. botón IA). */
  actions?: ReactNode;
}) {
  const filas = parsear(value);
  const filasTabla = filas.length ? filas : [FILA_VACIA];
  const tieneDatos = filas.some((f) => f.componente || f.porcentaje);

  const actualizar = (i: number, campo: "componente" | "porcentaje", v: string) => {
    // "|" y el salto de línea son los separadores del formato.
    const limpio = v.replace(/[|\n]/g, " ");
    onChange(serializar(filasTabla.map((f, idx) => (idx === i ? { ...f, [campo]: limpio } : f))));
  };
  const agregar = () => onChange(serializar([...filasTabla, FILA_VACIA]));
  const quitar = (i: number) => {
    const next = filasTabla.filter((_, idx) => idx !== i);
    onChange(next.length ? serializar(next) : "");
  };

  const celda = "w-full bg-transparent px-2 py-1.5 text-xs outline-none focus:bg-accent/5";

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs text-muted">{label}</p>
        <div className="flex items-center gap-2">
          {actions}
          {tieneDatos && (
            <button
              type="button"
              onClick={() => onChange("")}
              className="text-[10px] font-medium text-muted hover:text-danger"
            >
              Limpiar tabla
            </button>
          )}
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-surface-alt">
              <th className="w-[68%] px-2 py-2 font-semibold text-ink">Componente</th>
              <th className="w-[26%] px-2 py-2 font-semibold text-ink">Porcentaje</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {filasTabla.map((fila, i) => (
              <tr key={i} className="border-b border-border last:border-0 hover:bg-accent/5">
                <td className="border-r border-border">
                  <input
                    value={fila.componente}
                    onChange={(e) => actualizar(i, "componente", e.target.value)}
                    placeholder="Ej. Linalool"
                    aria-label={`Componente ${i + 1}`}
                    className={celda}
                  />
                </td>
                <td className="border-r border-border">
                  <input
                    value={fila.porcentaje}
                    onChange={(e) => actualizar(i, "porcentaje", e.target.value)}
                    placeholder="Ej. 25 – 38 %"
                    aria-label={`Porcentaje del componente ${i + 1}`}
                    className={celda}
                  />
                </td>
                <td className="px-1 text-center">
                  <button
                    type="button"
                    onClick={() => quitar(i)}
                    className="text-[10px] text-muted hover:text-danger"
                    title="Eliminar fila"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={agregar}
        title="Agregar componente"
        aria-label="Agregar componente"
        className="mt-2 inline-flex h-8 w-8 items-center justify-center rounded border border-border text-muted hover:border-accent hover:text-accent"
      >
        <Icon name="plus" size={14} weight="bold" />
      </button>
    </div>
  );
}
