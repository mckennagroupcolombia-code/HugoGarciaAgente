import { useMemo, useState } from "react";

// ── Tipos ────────────────────────────────────────────────────────────────────

type TipoMezcla = "reciclado" | "alta_densidad";

interface Insumo {
  nombre: string;
  /** Gramos por cada 1 litro de volumen de diseño. */
  gPorLitro: number;
}

interface InsumoLiquido {
  nombre: string;
  /** Mililitros por cada 1 litro de volumen de diseño. */
  mlPorLitro: number;
}

interface Formula {
  label: string;
  descripcion: string;
  baseLitros: number;
  solidos: Insumo[];
  liquidos: InsumoLiquido[];
}

// ── Fórmulas de referencia ───────────────────────────────────────────────────
// Los g/L y ml/L se derivan del valor base de cada fórmula dividido entre su
// volumen base (baseLitros), para conservar la precisión exacta de la receta.

const FORMULAS: Record<TipoMezcla, Formula> = {
  reciclado: {
    label: "Agregado reciclado",
    descripcion: "Reutiliza trozos de concreto viejo (SSS) como agregado.",
    baseLitros: 11.928,
    solidos: [
      { nombre: "Sikafloor Quarztop", gPorLitro: 7842 / 11.928 },
      { nombre: "Carbonato de Calcio", gPorLitro: 1663 / 11.928 },
      { nombre: "Trozos de Concreto Viejo (SSS)", gPorLitro: 10245 / 11.928 },
      { nombre: "Óxido de Hierro Amarillo", gPorLitro: 373 / 11.928 },
      { nombre: "Fibras de Polipropileno", gPorLitro: 18.5 / 11.928 },
    ],
    liquidos: [
      { nombre: "Agua limpia", mlPorLitro: 1692 / 11.928 },
      { nombre: "SikaLatex", mlPorLitro: 338 / 11.928 },
      { nombre: "Sikaplast MO", mlPorLitro: 73 / 11.928 },
    ],
  },
  alta_densidad: {
    label: "Alta densidad — negro intenso",
    descripcion: "Matriz cementicia totalmente nueva, sin agregado reciclado.",
    baseLitros: 0.22,
    solidos: [
      { nombre: "Sikafloor Quarztop", gPorLitro: 330 / 0.22 },
      { nombre: "Carbonato de Calcio", gPorLitro: 70 / 0.22 },
      { nombre: "Óxido de Hierro Negro", gPorLitro: 32 / 0.22 },
      { nombre: "Fibras de Polipropileno", gPorLitro: 0.4 / 0.22 },
    ],
    liquidos: [
      { nombre: "Agua limpia", mlPorLitro: 65 / 0.22 },
      { nombre: "SikaLatex", mlPorLitro: 13 / 0.22 },
      { nombre: "Sikaplast MO", mlPorLitro: 2.8 / 0.22 },
    ],
  },
};

const MERMA_DEFECTO = "5";

// ── Helpers de formato ───────────────────────────────────────────────────────

function fmt(n: number, decimales = 1): string {
  return n.toLocaleString("es-CO", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
}

function parsePositivo(valor: string): number | null {
  const n = Number(valor.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

// ── Componente ───────────────────────────────────────────────────────────────

export default function PlacasConcretoPanel() {
  const [largo, setLargo] = useState("");
  const [ancho, setAncho] = useState("");
  const [espesor, setEspesor] = useState("");
  const [merma, setMerma] = useState(MERMA_DEFECTO);
  const [tipo, setTipo] = useState<TipoMezcla>("reciclado");

  const largoNum = parsePositivo(largo);
  const anchoNum = parsePositivo(ancho);
  const espesorNum = parsePositivo(espesor);
  const mermaNum = merma.trim() === "" ? 0 : Number(merma.replace(",", "."));

  const errores: string[] = [];
  if (largo.trim() !== "" && largoNum === null) errores.push("Largo debe ser un número mayor que 0.");
  if (ancho.trim() !== "" && anchoNum === null) errores.push("Ancho debe ser un número mayor que 0.");
  if (espesor.trim() !== "" && espesorNum === null) errores.push("Espesor debe ser un número mayor que 0.");
  if (merma.trim() !== "" && (!Number.isFinite(mermaNum) || mermaNum < 0)) errores.push("% de merma debe ser un número mayor o igual a 0.");

  const listo = largoNum !== null && anchoNum !== null && espesorNum !== null && Number.isFinite(mermaNum) && mermaNum >= 0;

  const resultado = useMemo(() => {
    if (!listo || largoNum === null || anchoNum === null || espesorNum === null) return null;
    const volumenNeto = (largoNum * anchoNum * espesorNum) / 1000;
    const volumenDiseno = volumenNeto * (1 + mermaNum / 100);
    const formula = FORMULAS[tipo];
    return {
      volumenNeto,
      volumenDiseno,
      formula,
      solidos: formula.solidos.map((s) => ({ nombre: s.nombre, gramos: s.gPorLitro * volumenDiseno })),
      liquidos: formula.liquidos.map((l) => ({ nombre: l.nombre, ml: l.mlPorLitro * volumenDiseno })),
    };
  }, [listo, largoNum, anchoNum, espesorNum, mermaNum, tipo]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h2 className="text-xl font-extrabold text-ink">🧱 Placas de Concreto Pulido</h2>

      {/* Dimensiones del molde */}
      <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-4">
        <h3 className="text-sm font-semibold text-ink">Dimensiones del molde</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted">Largo (cm)</span>
            <input
              type="text"
              inputMode="decimal"
              value={largo}
              onChange={(e) => setLargo(e.target.value)}
              placeholder="60"
              className="w-full rounded-lg border border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted/50 focus:border-accent"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted">Ancho (cm)</span>
            <input
              type="text"
              inputMode="decimal"
              value={ancho}
              onChange={(e) => setAncho(e.target.value)}
              placeholder="60"
              className="w-full rounded-lg border border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted/50 focus:border-accent"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted">Espesor (cm)</span>
            <input
              type="text"
              inputMode="decimal"
              value={espesor}
              onChange={(e) => setEspesor(e.target.value)}
              placeholder="3"
              className="w-full rounded-lg border border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted/50 focus:border-accent"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted">% Merma</span>
            <input
              type="text"
              inputMode="decimal"
              value={merma}
              onChange={(e) => setMerma(e.target.value)}
              placeholder={MERMA_DEFECTO}
              className="w-full rounded-lg border border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted/50 focus:border-accent"
            />
          </label>
        </div>

        {errores.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
            {errores.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </section>

      {/* Tipo de mezcla */}
      <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-3">
        <h3 className="text-sm font-semibold text-ink">Tipo de mezcla</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(FORMULAS) as TipoMezcla[]).map((key) => {
            const f = FORMULAS[key];
            const activo = tipo === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTipo(key)}
                className={`rounded-xl border p-4 text-left transition ${
                  activo
                    ? "border-accent bg-accent/8 shadow-[0_2px_0_rgba(2,45,51,0.15)]"
                    : "border-border hover:border-accent/50"
                }`}
              >
                <p className={`text-sm font-bold ${activo ? "text-accent" : "text-ink"}`}>{f.label}</p>
                <p className="mt-1 text-xs text-muted">{f.descripcion}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Resultados */}
      {resultado && (
        <section className="space-y-4">
          <div className="rounded-xl border border-border bg-surface-panel p-5">
            <h3 className="text-sm font-semibold text-ink">Volumen de la pieza</h3>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted">Volumen neto</p>
                <p className="text-lg font-extrabold text-ink">{fmt(resultado.volumenNeto, 2)} L</p>
              </div>
              <div>
                <p className="text-xs text-muted">Volumen de diseño (+{fmt(mermaNum, 0)}% merma)</p>
                <p className="text-lg font-extrabold text-accent">{fmt(resultado.volumenDiseno, 2)} L</p>
              </div>
            </div>
          </div>

          {/* Sólidos */}
          <div className="rounded-xl border border-border bg-surface-panel p-5">
            <h3 className="mb-3 text-sm font-semibold text-ink">Sólidos</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs font-semibold text-muted">
                    <th className="pb-2 pr-4">Insumo</th>
                    <th className="pb-2 pr-4 text-right">Gramos</th>
                    <th className="pb-2 text-right">Kilogramos</th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.solidos.map((s) => (
                    <tr key={s.nombre} className="border-b border-border/30 last:border-0">
                      <td className="py-2 pr-4 font-medium text-ink">{s.nombre}</td>
                      <td className="py-2 pr-4 text-right font-mono text-ink">{fmt(s.gramos, 1)} g</td>
                      <td className="py-2 text-right font-mono text-muted">{fmt(s.gramos / 1000, 3)} kg</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Líquidos */}
          <div className="rounded-xl border border-border bg-surface-panel p-5">
            <h3 className="mb-3 text-sm font-semibold text-ink">Líquidos</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs font-semibold text-muted">
                    <th className="pb-2 pr-4">Insumo</th>
                    <th className="pb-2 text-right">Mililitros</th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.liquidos.map((l) => (
                    <tr key={l.nombre} className="border-b border-border/30 last:border-0">
                      <td className="py-2 pr-4 font-medium text-ink">{l.nombre}</td>
                      <td className="py-2 text-right font-mono text-ink">{fmt(l.ml, 1)} ml</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {!resultado && errores.length === 0 && (
        <p className="text-sm text-muted">Ingresa largo, ancho y espesor del molde para calcular las proporciones.</p>
      )}
    </div>
  );
}
