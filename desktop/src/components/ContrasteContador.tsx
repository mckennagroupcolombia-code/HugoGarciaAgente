/**
 * Lo que declaró el contador (William) contra lo que da el Libro Mayor.
 *
 * Cada declaración que él presentó —350, RTICA, 300, ICA anual, renta 110—,
 * leída de los PDF que manda por correo, renglón por renglón al lado del libro.
 * Se separan tres cosas que se confunden fácil:
 *   · cobertura: el libro solo está completo desde julio de 2026; antes no hay
 *     contra qué comparar y la tarjeta lo dice, en vez de marcar «diferencia».
 *   · diferencias: con el período cubierto, cada renglón distinto es una
 *     pregunta concreta para él, con las facturas del libro que la explican.
 *   · pago: lo declarado contra los recibos 490 / pagos SDH.
 * Backend: `contraste_contador()` en app/services/declaraciones_impuestos.py.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, fetchAuthBlobUrl } from "../api/client";

type Fila = { renglon: string; etiqueta: string; contador: number | null; libro: number | null; diferencia: number | null; cuadra: boolean };
type Recibo = { numero?: string; fecha?: string; valor?: number; concepto?: string; archivo?: string | null };
type Veredicto = "cuadra" | "difiere" | "libro_parcial" | "sin_libro" | "error";
type Decl = {
  formulario: "350" | "RTICA" | "300" | "ICA" | "110"; anio: number; periodo: number | null;
  titulo: string; nombre_periodo: string; numero_formulario?: string; fecha_presentacion?: string | null;
  archivo?: string | null; antes_del_corte: boolean;
  cobertura: { meses: string[]; con_libro: string[]; completa: boolean };
  veredicto: Veredicto; total_contador: number | null; total_libro: number | null;
  renglones: Fila[]; preguntas: string[];
  pago: { recibos: Recibo[]; pagado: number; estado: string; pago_en_libro?: { fecha: string; valor: number } | null };
  terceros_libro: { tercero: string; identificacion: string; persona: string; concepto: string; base: number; retencion: number; asientos: number[] }[];
  error?: string;
};
type Respuesta = {
  resumen: { declaraciones: number; cuadran: number; difieren: number; sin_libro: number; sin_pago: number; preguntas: number; meses_con_libro: string[] };
  declaraciones: Decl[];
};

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function cop(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);
}
function fecha(iso?: string | null): string {
  if (!iso) return "";
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });
}
function mesCorto(m: string): string {
  const [a, mm] = m.split("-");
  return `${MES[Number(mm) - 1]} ${a.slice(2)}`;
}

const VEREDICTO: Record<Veredicto, { label: string; cls: string; ayuda: string }> = {
  cuadra: { label: "Cuadra con el libro", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", ayuda: "Cada renglón coincide (±$1.000)." },
  difiere: { label: "Difiere del libro", cls: "bg-red-500/15 text-red-700 dark:text-red-300", ayuda: "El libro cubre el período y da cifras distintas: abajo, las preguntas para William." },
  libro_parcial: { label: "Libro incompleto", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300", ayuda: "El libro solo tiene parte de los meses del período: las cifras no son comparables en total." },
  sin_libro: { label: "Sin libro en ese período", cls: "bg-slate-500/15 text-muted", ayuda: "El libro no se llevaba entonces: solo se muestra lo que declaró William." },
  error: { label: "No se pudo leer", cls: "bg-red-500/15 text-red-700", ayuda: "" },
};
const PAGO: Record<string, { label: string; cls: string }> = {
  pagado: { label: "Pagado", cls: "text-emerald-600" },
  pago_parcial: { label: "Pago parcial", cls: "text-amber-600" },
  sin_pago: { label: "Sin pago encontrado", cls: "text-red-600" },
  no_aplica: { label: "Saldo a favor / sin pago", cls: "text-muted" },
};

type Filtro = "todas" | "diferencias" | "350" | "RTICA" | "300" | "anuales";
const FILTROS: { id: Filtro; label: string }[] = [
  { id: "todas", label: "Todas" },
  { id: "diferencias", label: "Con preguntas" },
  { id: "350", label: "Retefuente 350" },
  { id: "RTICA", label: "ReteICA" },
  { id: "300", label: "IVA 300" },
  { id: "anuales", label: "Renta e ICA anual" },
];

async function abrirPdf(archivo: string) {
  const url = await fetchAuthBlobUrl(`/api/contabilidad/declaraciones/pdf?${new URLSearchParams({ archivo })}`);
  if (url) window.open(url, "_blank", "noopener");
  else window.alert("No se pudo abrir el PDF.");
}

export default function ContrasteContador() {
  const q = useQuery<Respuesta>({
    queryKey: ["contabilidad-declaraciones-contraste"],
    queryFn: () => api.get("/api/contabilidad/declaraciones/contraste"),
  });
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [copiado, setCopiado] = useState(false);
  const lista = useMemo(() => (q.data?.declaraciones ?? []).filter((d) => {
    if (filtro === "todas") return true;
    if (filtro === "diferencias") return d.preguntas.length > 0;
    if (filtro === "anuales") return d.formulario === "110" || d.formulario === "ICA";
    return d.formulario === filtro;
  }), [q.data, filtro]);

  if (q.isLoading) return <p className="text-sm text-muted">Cruzando las declaraciones de William con el libro…</p>;
  if (q.error || !q.data) return <p className="text-sm text-red-500">{(q.error as Error)?.message ?? "Sin datos"}</p>;
  const r = q.data.resumen;
  const todasPreguntas = q.data.declaraciones.filter((d) => d.preguntas.length)
    .map((d) => `${d.titulo} — ${d.nombre_periodo}\n${d.preguntas.map((p, i) => `  ${i + 1}. ${p}`).join("\n")}`).join("\n\n");

  return (
    <div className="space-y-3">
      <section className="lm-card space-y-2 p-3">
        <h3 className="text-sm font-bold text-ink">Lo que declaró William vs. el Libro Mayor</h3>
        <p className="text-xs text-muted">
          Cada declaración que William presentó este año, sacada de los PDF que manda por correo, contra lo que da
          el libro para el mismo período. El libro está completo desde{" "}
          <b className="text-ink">{r.meses_con_libro.length ? mesCorto(r.meses_con_libro[0]) : "—"}</b>: antes de eso no
          hay contra qué comparar y la tarjeta lo dice. Los períodos anteriores al corte (1-sep-2026) los liquidó él con su
          información; ahí una diferencia muestra lo que le falta al libro, no un error suyo.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Dato n={r.declaraciones} label="declaraciones" />
          <Dato n={r.difieren} label="difieren del libro" tono={r.difieren ? "rojo" : undefined} />
          <Dato n={r.sin_libro} label="sin libro o incompleto" />
          <Dato n={r.sin_pago} label="sin pago encontrado" tono={r.sin_pago ? "rojo" : "verde"} />
          <Dato n={r.preguntas} label="preguntas para William" tono={r.preguntas ? "ambar" : undefined} />
        </div>
        {r.preguntas > 0 && (
          <button type="button"
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(todasPreguntas); setCopiado(true); setTimeout(() => setCopiado(false), 2500); }
                    catch { window.prompt("Copia las preguntas:", todasPreguntas); }
                  }}
                  className="rounded-lg border border-accent px-3 py-1.5 text-xs font-bold text-accent hover:bg-accent/10">
            {copiado ? "Copiadas ✓" : `Copiar las ${r.preguntas} preguntas para la reunión`}
          </button>
        )}
      </section>

      <div className="flex flex-wrap gap-1.5">
        {FILTROS.map((f) => (
          <button key={f.id} type="button" onClick={() => setFiltro(f.id)}
                  className={`rounded-full border px-3 py-1 text-xs font-bold ${
                    filtro === f.id ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:text-ink"}`}>
            {f.label}
          </button>
        ))}
      </div>

      {lista.map((d) => <Tarjeta key={`${d.formulario}-${d.anio}-${d.periodo}`} d={d} />)}
      {!lista.length && <p className="text-sm text-muted">Nada con ese filtro.</p>}
    </div>
  );
}

function Dato({ n, label, tono }: { n: number; label: string; tono?: "rojo" | "ambar" | "verde" }) {
  const c = tono === "rojo" ? "text-red-600" : tono === "ambar" ? "text-amber-600" : tono === "verde" ? "text-emerald-600" : "text-ink";
  return (
    <div className="rounded-lg border border-border px-2.5 py-1.5">
      <p className={`font-mono text-lg font-bold ${c}`}>{n}</p>
      <p className="text-[11px] text-muted">{label}</p>
    </div>
  );
}

function Tarjeta({ d }: { d: Decl }) {
  const [abierta, setAbierta] = useState(d.veredicto === "difiere" || (d.formulario === "110" && d.preguntas.length > 0));
  const [verTerceros, setVerTerceros] = useState(false);
  const v = VEREDICTO[d.veredicto];
  const p = PAGO[d.pago.estado] ?? PAGO.no_aplica;
  const comparable = d.veredicto === "difiere" || d.veredicto === "cuadra" || d.veredicto === "libro_parcial";

  return (
    <article className={`lm-card overflow-hidden ${d.veredicto === "difiere" ? "border-l-4 border-l-red-500" : ""}`}>
      <div role="button" tabIndex={0} onClick={() => setAbierta(!abierta)}
           onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setAbierta(!abierta); } }}
           className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 p-3 hover:bg-surface-input">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink">{abierta ? "▾" : "▸"} {d.titulo}</p>
          <p className="text-xs capitalize text-muted">
            {d.nombre_periodo}
            {d.fecha_presentacion && <> · presentada {fecha(d.fecha_presentacion)}</>}
            {d.numero_formulario && <> · <span className="font-mono">{d.numero_formulario}</span></>}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-muted">William</p>
          <p className="font-mono text-sm font-bold text-ink">{cop(d.total_contador)}</p>
        </div>
        {d.total_libro != null && comparable && (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-muted">Libro</p>
            <p className="font-mono text-sm font-bold text-ink">{cop(d.total_libro)}</p>
          </div>
        )}
        <div className="flex flex-col items-end gap-0.5">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${v.cls}`}>{v.label}</span>
          <span className={`text-[11px] font-bold ${p.cls}`}>{p.label}</span>
        </div>
      </div>

      {abierta && (
        <div className="space-y-3 border-t border-border px-3 pb-3 pt-2">
          <p className="text-xs text-muted">
            {v.ayuda}
            {d.antes_del_corte && comparable && " Es un período anterior al corte: la diferencia sirve para saber qué le falta al libro."}
            {" "}Libro en el período: {d.cobertura.con_libro.length ? d.cobertura.con_libro.map(mesCorto).join(", ") : "ningún mes"}
            {" "}de {d.cobertura.meses.length} {d.cobertura.meses.length === 1 ? "mes" : "meses"}.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] text-muted">
                  <th className="py-1 pr-2">Renglón</th>
                  <th className="py-1 pr-2 text-right">Declaró William</th>
                  {comparable && <th className="py-1 pr-2 text-right">Libro Mayor</th>}
                  {comparable && <th className="py-1 text-right">Diferencia</th>}
                </tr>
              </thead>
              <tbody>
                {d.renglones.map((f) => (
                  <tr key={f.renglon} className="border-b border-border/40">
                    <td className="py-1 pr-2 text-ink"><span className="font-mono text-[10px] text-muted">{f.renglon} </span>{f.etiqueta}</td>
                    <td className="py-1 pr-2 text-right font-mono">{cop(f.contador)}</td>
                    {comparable && <td className="py-1 pr-2 text-right font-mono">{cop(f.libro)}</td>}
                    {comparable && (
                      <td className={`py-1 text-right font-mono ${f.libro == null ? "text-muted" : f.cuadra ? "text-emerald-600" : "font-bold text-red-600"}`}>
                        {f.libro == null ? "—" : f.cuadra ? "✓" : `${(f.diferencia ?? 0) > 0 ? "+" : ""}${cop(f.diferencia)}`}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {d.preguntas.length > 0 && (
            <div className="rounded-lg border-l-4 border-amber-500 bg-amber-500/5 px-3 py-2">
              <p className="text-xs font-bold text-ink">Para preguntarle a William</p>
              <ol className="mt-1 list-decimal space-y-1 pl-4 text-xs text-ink">
                {d.preguntas.map((q, i) => <li key={i}>{q}</li>)}
              </ol>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {d.archivo && (
              <button type="button" onClick={() => abrirPdf(d.archivo!)}
                      className="rounded border border-border px-2 py-1 font-bold text-ink hover:bg-surface-input">Ver declaración (PDF)</button>
            )}
            {d.pago.recibos.map((rc) => (
              <span key={rc.numero} className="inline-flex items-center gap-1 text-muted">
                Recibo {rc.concepto} {fecha(rc.fecha)} · <b className="text-ink">{cop(rc.valor)}</b>
                {rc.archivo && (
                  <button type="button" onClick={() => abrirPdf(rc.archivo!)}
                          className="rounded border border-border px-1.5 py-0.5 font-bold text-ink hover:bg-surface-input">PDF</button>
                )}
              </span>
            ))}
            {d.pago.pago_en_libro && (
              <span className="text-emerald-600">· Pago asentado en el libro el {fecha(d.pago.pago_en_libro.fecha)}</span>
            )}
          </div>

          {d.terceros_libro.length > 0 && comparable && (
            <div>
              <button type="button" onClick={() => setVerTerceros(!verTerceros)} className="text-xs font-bold text-accent">
                {verTerceros ? "▾" : "▸"} Qué tiene el libro en este período ({d.terceros_libro.length} terceros)
              </button>
              {verTerceros && (
                <table className="mt-1 w-full text-xs">
                  <tbody>
                    {d.terceros_libro.map((t, i) => (
                      <tr key={i} className="border-b border-border/30">
                        <td className="py-0.5 pr-2 text-ink">{t.tercero} <span className="text-muted">{t.identificacion} · {t.persona === "juridica" ? "PJ" : "PN"}</span></td>
                        <td className="py-0.5 pr-2 text-muted">{t.concepto.replace(/_/g, " ")}</td>
                        <td className="py-0.5 pr-2 text-right font-mono">{cop(t.base)}</td>
                        <td className="py-0.5 pr-2 text-right font-mono font-bold">{cop(t.retencion)}</td>
                        <td className="py-0.5 font-mono text-[10px] text-muted">{t.asientos.map((a) => `#${a}`).join(" ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          {d.error && <p className="text-xs text-red-500">{d.error}</p>}
        </div>
      )}
    </article>
  );
}
