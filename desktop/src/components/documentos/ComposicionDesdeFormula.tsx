import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

type FormulaEnlazada = {
  id: string;
  nombre: string;
  sku: string;
  filas: [string, string, string][];
  /** «enlace»: elegida a mano en el documento · «sku»: su SKU es la referencia del documento. */
  por: "enlace" | "sku";
};
type FormulaOpcion = { id: string; nombre: string; sku: string };

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

/** La fórmula del documento: la elegida (`formula_id`) o la que tiene por SKU su referencia.
 *  La usan el selector de Identificación y el aviso de la Composición (misma consulta). */
function useFormulaDelDocumento(titulo: string, referencia: string, formulaId: string, onFormulaId: (id: string) => void) {
  const t = titulo.trim();
  // Misma consulta que «Referencia enlazada»: trae también las referencias equivalentes.
  const mapa = useQuery({
    queryKey: ["doc-referencia", t],
    queryFn: () =>
      api.get<{ archivo: string; existe: boolean; referencia: string; equivalentes: string[]; formula_id?: string }>(
        `/api/mapa-sistema/documentos/referencia?titulo=${encodeURIComponent(t)}`,
      ),
    enabled: t.length > 1,
    staleTime: 30_000,
  });
  const fid = formulaId || mapa.data?.formula_id || "";
  // El enlace ya escrito en el documento pasa al formulario: así no se pierde al regenerarlo
  // aunque se haya abierto por un camino que no cargó su YAML. Una sola vez por valor, para
  // que «Quitar» no lo traiga de vuelta mientras se refresca la consulta.
  const sincronizado = useRef("");
  useEffect(() => {
    const guardado = mapa.data?.formula_id || "";
    if (!guardado || guardado === sincronizado.current) return;
    sincronizado.current = guardado;
    if (!formulaId) onFormulaId(guardado);
  }, [mapa.data?.formula_id, formulaId, onFormulaId]);
  const refs = [referencia, mapa.data?.referencia ?? "", ...(mapa.data?.equivalentes ?? [])]
    .map((r) => r.trim())
    .filter((r, i, a) => r && a.indexOf(r) === i);
  const q = useQuery({
    queryKey: ["composicion-formula", refs.join(","), fid],
    queryFn: () =>
      api.get<{ formula: FormulaEnlazada | null }>(
        `/api/fichas/composicion-formula/${encodeURIComponent(refs.join(",") || "-")}` +
          (fid ? `?formula_id=${encodeURIComponent(fid)}` : ""),
      ),
    enabled: refs.length > 0 || Boolean(fid),
    staleTime: 30_000,
  });
  return { t, mapa, fid, formula: q.data?.formula ?? null, cargando: q.isLoading && q.fetchStatus !== "idle" };
}

/**
 * «Fórmula registrada» en la Identificación del documento: elegir una de las fórmulas de
 * Diseño de producto → Fórmulas. Queda como `formula_id` en el documento (al momento si ya
 * existe; al guardar o generar si es nuevo) y su Composición sale de ella.
 */
export function FormulaDelDocumento({
  titulo,
  referencia,
  formulaId,
  onFormulaId,
}: {
  titulo: string;
  referencia: string;
  formulaId: string;
  onFormulaId: (id: string) => void;
}) {
  const qc = useQueryClient();
  const { mapa, fid, formula } = useFormulaDelDocumento(titulo, referencia, formulaId, onFormulaId);
  const [eligiendo, setEligiendo] = useState(false);
  const [filtro, setFiltro] = useState("");
  const opciones = useQuery({
    queryKey: ["fichas-formulas"],
    queryFn: () => api.get<{ formulas: FormulaOpcion[] }>("/api/fichas/formulas"),
    enabled: eligiendo,
    staleTime: 60_000,
  });
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [verIngredientes, setVerIngredientes] = useState(false);

  const enlazar = async (id: string) => {
    setMsg(null);
    onFormulaId(id); // queda también en el documento al guardarlo o generarlo
    setEligiendo(false);
    setFiltro("");
    if (!mapa.data?.existe) {
      if (id) setMsg({ ok: true, texto: "Quedará enlazado a la fórmula al guardar o generar el documento." });
      return;
    }
    setOcupado(true);
    try {
      const r = await api.post<{ ok?: boolean; error?: string }>("/api/mapa-sistema/documentos/fijar-formula", {
        archivo: mapa.data.archivo,
        formula_id: id,
      });
      if (r.ok === false) throw new Error(r.error || "No se pudo enlazar");
      await qc.invalidateQueries({ queryKey: ["doc-referencia"] });
      setMsg({ ok: true, texto: id ? "Documento enlazado a la fórmula." : "Se quitó el enlace con la fórmula." });
    } catch (e: unknown) {
      setMsg({ ok: false, texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setOcupado(false);
    }
  };

  const f = filtro.trim().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const lista = (opciones.data?.formulas ?? []).filter(
    (o) => !f || `${o.nombre} ${o.sku}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(f),
  );

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted">Fórmula registrada (Diseño de producto → Fórmulas): la composición sale de ella</p>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-input px-2.5 py-1.5">
        {formula ? (
          <span className="text-sm text-ink">
            <b>{formula.nombre.trim()}</b>
            {formula.sku && <code className="text-muted"> · {formula.sku}</code>}
            {formula.por === "sku" && <span className="text-[11px] text-muted"> · por su SKU</span>}
          </span>
        ) : (
          <span className="text-sm text-muted">Ninguna: la composición se escribe a mano.</span>
        )}
        {formula && formula.filas.length > 0 && (
          <button
            type="button"
            onClick={() => setVerIngredientes((v) => !v)}
            className="text-[11px] font-semibold text-accent underline"
          >
            {verIngredientes ? "Ocultar ingredientes" : `${formula.filas.length} ingredientes`}
          </button>
        )}
        <span className="ml-auto flex gap-1.5">
          {fid && (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => void enlazar("")}
              className="rounded border border-border px-2.5 py-1 text-xs text-muted hover:border-danger hover:text-danger"
            >
              Quitar
            </button>
          )}
          <button
            type="button"
            disabled={ocupado}
            onClick={() => {
              setEligiendo((v) => !v);
              setMsg(null);
            }}
            className="rounded border border-accent/40 px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/10"
          >
            {eligiendo ? "Cancelar" : formula ? "Cambiar" : "Seleccionar fórmula"}
          </button>
        </span>
      </div>
      {verIngredientes && formula && (
        <table className="w-full text-[11px]">
          <tbody>
            {formula.filas.map(([nombre, pct, cas], i) => (
              <tr key={i} className="border-b border-border/50">
                <td className="py-0.5 text-ink">{nombre}</td>
                <td className="py-0.5 text-right tabular-nums text-ink">{pct}</td>
                <td className="py-0.5 pl-2 text-muted">{cas}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {eligiendo && (
        <div className="space-y-1 rounded-lg border border-accent/40 bg-accent/5 p-2">
          <input
            autoFocus
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Buscar la fórmula por nombre o SKU…"
            className="w-full rounded border border-border bg-surface-input px-2 py-1.5 text-xs text-ink"
          />
          {opciones.isLoading && <p className="text-[11px] text-muted">Cargando fórmulas…</p>}
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {lista.map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={ocupado || o.id === formula?.id}
                onClick={() => void enlazar(o.id)}
                className="flex w-full items-center gap-2 rounded border border-border bg-surface-input px-2 py-1 text-left text-xs text-ink hover:border-accent disabled:opacity-50"
              >
                <span className="min-w-0 flex-1 truncate">{o.nombre}</span>
                {o.sku && <code className="shrink-0 text-muted">{o.sku}</code>}
                {o.id === formula?.id && <span className="text-[10px] font-bold text-emerald-700">actual</span>}
              </button>
            ))}
            {opciones.data && lista.length === 0 && (
              <p className="text-[11px] text-muted">
                {opciones.data.formulas.length ? "Ninguna fórmula coincide." : "Todavía no hay fórmulas registradas."}
              </p>
            )}
          </div>
        </div>
      )}
      {msg && <p className={`text-[11px] ${msg.ok ? "text-emerald-700" : "text-danger"}`}>{msg.texto}</p>}
    </div>
  );
}

/**
 * Si el documento tiene fórmula (elegida en «Fórmula registrada» o por su SKU), su
 * Composición lleva los componentes de esa fórmula: se integran solos al abrir el
 * documento o al cambiar de fórmula, y se puede deshacer.
 */
export function ComposicionDesdeFormula({
  titulo,
  referencia,
  formulaId,
  onFormulaId,
  value,
  onChange,
}: {
  titulo: string;
  referencia: string;
  formulaId: string;
  onFormulaId: (id: string) => void;
  value: string;
  onChange: (v: string) => void;
}) {
  const { t, formula } = useFormulaDelDocumento(titulo, referencia, formulaId, onFormulaId);
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
        Componentes de la fórmula <b>«{formula.nombre.trim()}»</b>
        {formula.sku && <> ({formula.sku})</>}
        {anterior !== null ? " integrados en la composición." : " — la composición ya coincide."}
        <span className="text-muted"> Se cambia en «Fórmula registrada», arriba.</span>
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
