import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

type FormulaEnlazada = { id: string; nombre: string; sku: string; filas: [string, string, string][] };

const GENERICAS = new Set(["acido", "extracto", "solucion", "aceite", "agua", "molecular", "peso", "polvo"]);

function palabras(t: string): string[] {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
}

/** El componente del documento que corresponde a un ingrediente de la fórmula:
 *  dos palabras en común, o una que no sea genérica («aloe», «hialuronico»). */
function mismoComponente(a: string, b: string): boolean {
  const pb = new Set(palabras(b));
  const comunes = palabras(a).filter((w) => pb.has(w));
  return comunes.length >= 2 || comunes.some((w) => !GENERICAS.has(w));
}

/** Composición del documento con los ingredientes y porcentajes de la fórmula
 *  (son definitivos). De cada componente que ya estaba se conserva el nombre
 *  escrito en el documento y su CAS; lo que la fórmula no tiene sale. */
function integrar(actual: string, filas: [string, string, string][]): string {
  const previas = actual
    .split("\n")
    .map((l) => l.split("|").map((p) => p.trim()))
    .filter((p) => p[0]);
  const usadas = new Set<number>();
  return filas
    .map(([nombre, porcentaje, cas]) => {
      const i = previas.findIndex((p, k) => !usadas.has(k) && mismoComponente(nombre, p[0]));
      if (i < 0) return `${nombre}|${porcentaje}|${cas}`;
      usadas.add(i);
      return `${previas[i][0]}|${porcentaje}|${cas || previas[i][2] || ""}`;
    })
    .join("\n");
}

const normal = (t: string) =>
  t.split("\n").map((l) => l.split("|").map((p) => p.trim()).join("|")).filter((l) => l.replace(/\|/g, "")).join("\n");

/**
 * Si el documento está enlazado (por su referencia o una equivalente) a una
 * fórmula de la pestaña Fórmulas, su Composición lleva los componentes de esa
 * fórmula: se integran solos al abrir el documento y se puede deshacer.
 */
export function ComposicionDesdeFormula({
  titulo,
  referencia,
  value,
  onChange,
}: {
  titulo: string;
  referencia: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const t = titulo.trim();
  // Misma consulta que «Referencia enlazada»: trae también las referencias equivalentes.
  const mapa = useQuery({
    queryKey: ["doc-referencia", t],
    queryFn: () =>
      api.get<{ referencia: string; equivalentes: string[] }>(
        `/api/mapa-sistema/documentos/referencia?titulo=${encodeURIComponent(t)}`,
      ),
    enabled: t.length > 1,
    staleTime: 30_000,
  });
  const refs = [referencia, mapa.data?.referencia ?? "", ...(mapa.data?.equivalentes ?? [])]
    .map((r) => r.trim())
    .filter((r, i, a) => r && a.indexOf(r) === i);
  const q = useQuery({
    queryKey: ["composicion-formula", refs.join(",")],
    queryFn: () =>
      api.get<{ formula: FormulaEnlazada | null }>(
        `/api/fichas/composicion-formula/${encodeURIComponent(refs.join(","))}`,
      ),
    enabled: refs.length > 0,
    staleTime: 30_000,
  });
  const formula = q.data?.formula ?? null;

  const [anterior, setAnterior] = useState<string | null>(null);
  const aplicada = useRef("");
  useEffect(() => {
    if (!formula || !formula.filas.length) return;
    const clave = `${formula.id}|${t}`;
    if (aplicada.current === clave) return;
    aplicada.current = clave;
    const integrada = integrar(value, formula.filas);
    if (normal(integrada) !== normal(value)) {
      setAnterior(value);
      onChange(integrada);
    } else {
      setAnterior(null);
    }
  }, [formula, t, value, onChange]);

  if (!formula) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-xs">
      <span>
        Componentes de la fórmula <b>«{formula.nombre.trim()}»</b> ({formula.sku})
        {anterior !== null ? " integrados en la composición." : " — la composición ya coincide."}
      </span>
      {anterior !== null && (
        <button
          type="button"
          className="rounded-md border border-border bg-surface px-2.5 py-1 text-[12px] font-semibold text-ink hover:border-accent"
          onClick={() => {
            onChange(anterior);
            setAnterior(null);
          }}
        >
          Deshacer
        </button>
      )}
    </div>
  );
}
