import { useCallback, useEffect, useState } from "react";
import { Calculator } from "@phosphor-icons/react";

export type MaterialCalcField = "stock_actual" | "stock_minimo" | "precio_unitario" | "cantidad";

type Op = "+" | "-" | "×" | "÷";

const FIELD_LABELS: Record<MaterialCalcField, string> = {
  stock_actual: "Stock",
  stock_minimo: "Stock mín.",
  precio_unitario: "Precio",
  cantidad: "Cantidad",
};

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "Error";
  const r = Math.round(n * 1e8) / 1e8;
  const s = String(Number.isInteger(r) ? r : parseFloat(r.toFixed(6)));
  if (s.length > 14) return r.toExponential(4);
  return s;
}

function compute(a: number, b: number, op: Op): number | null {
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "×":
      return a * b;
    case "÷":
      return b === 0 ? null : a / b;
  }
}

type Props = {
  unidad: string;
  onApply: (field: MaterialCalcField, value: string) => void;
  fields?: MaterialCalcField[];
  compact?: boolean;
};

export default function MaterialCalculadora({
  onApply,
  fields = ["stock_actual", "stock_minimo", "precio_unitario"],
  compact = false,
}: Props) {
  const [display, setDisplay] = useState("0");
  const [accumulator, setAccumulator] = useState<number | null>(null);
  const [pendingOp, setPendingOp] = useState<Op | null>(null);
  const [fresh, setFresh] = useState(true);
  const [applyField, setApplyField] = useState<MaterialCalcField>(fields[0]);

  useEffect(() => {
    if (!fields.includes(applyField)) setApplyField(fields[0]);
  }, [fields, applyField]);

  const reset = useCallback(() => {
    setDisplay("0");
    setAccumulator(null);
    setPendingOp(null);
    setFresh(true);
  }, []);

  const current = (): number | null => {
    if (display === "Error") return null;
    const n = parseFloat(display);
    return Number.isFinite(n) ? n : null;
  };

  const pressDigit = (d: string) => {
    if (display === "Error") reset();
    setDisplay((prev) => {
      if (fresh) return d === "." ? "0." : d;
      if (d === "." && prev.includes(".")) return prev;
      if (prev === "0" && d !== ".") return d;
      return prev + d;
    });
    setFresh(false);
  };

  const pressBackspace = () => {
    if (display === "Error" || fresh) return;
    setDisplay((prev) => {
      if (prev.length <= 1) return "0";
      const next = prev.slice(0, -1);
      return next === "-" ? "0" : next;
    });
  };

  const pressOp = (op: Op) => {
    if (display === "Error") return;
    const input = current();
    if (input == null) return;

    if (accumulator != null && pendingOp != null && !fresh) {
      const result = compute(accumulator, input, pendingOp);
      if (result == null) {
        setDisplay("Error");
        setAccumulator(null);
        setPendingOp(null);
        setFresh(true);
        return;
      }
      setAccumulator(result);
      setDisplay(fmtNum(result));
    } else {
      setAccumulator(input);
    }

    setPendingOp(op);
    setFresh(true);
  };

  const pressEquals = () => {
    if (display === "Error" || pendingOp == null || accumulator == null) return;
    const input = current();
    if (input == null) return;

    const result = compute(accumulator, input, pendingOp);
    if (result == null) {
      setDisplay("Error");
      setAccumulator(null);
      setPendingOp(null);
      setFresh(true);
      return;
    }

    setDisplay(fmtNum(result));
    setAccumulator(null);
    setPendingOp(null);
    setFresh(true);
  };

  const canApply = display !== "Error" && current() != null;

  const btn =
    (label: string, onClick: () => void, className = "") =>
    (
      <button
        key={label}
        type="button"
        onClick={onClick}
        className={`rounded-paper border-2 border-border font-bold transition active:scale-95 hover:bg-surface-hover ${
          compact ? "py-2 text-sm" : "py-2.5 text-base"
        } ${className}`}
      >
        {label}
      </button>
    );

  const opBtn = (op: Op) =>
    btn(
      op,
      () => pressOp(op),
      "border-accent/40 bg-accent/5 text-accent hover:bg-accent/15",
    );

  return (
    <aside
      className={`shrink-0 rounded-paper border-2 border-border bg-surface-panel p-2 ${
        compact ? "w-full" : "w-full lg:w-[11.5rem]"
      }`}
    >
      <div className="mb-1.5 flex items-center gap-1 text-muted">
        <Calculator size={13} weight="duotone" />
        <span className="text-[10px] font-extrabold uppercase tracking-wide">Calculadora</span>
      </div>

      <div
        className={`mb-2 overflow-hidden rounded-paper border-2 border-border bg-surface-input px-2 text-right font-mono font-bold text-ink ${
          compact ? "py-1.5 text-lg" : "py-2 text-xl"
        }`}
        aria-live="polite"
      >
        {display}
      </div>

      <div className={`grid grid-cols-4 gap-1 ${compact ? "text-xs" : ""}`}>
        {btn("C", reset, "text-red-600 dark:text-red-400")}
        {btn("⌫", pressBackspace)}
        {opBtn("÷")}
        {opBtn("×")}

        {btn("7", () => pressDigit("7"))}
        {btn("8", () => pressDigit("8"))}
        {btn("9", () => pressDigit("9"))}
        {opBtn("-")}

        {btn("4", () => pressDigit("4"))}
        {btn("5", () => pressDigit("5"))}
        {btn("6", () => pressDigit("6"))}
        {opBtn("+")}

        {btn("1", () => pressDigit("1"))}
        {btn("2", () => pressDigit("2"))}
        {btn("3", () => pressDigit("3"))}
        <button
          type="button"
          onClick={pressEquals}
          className={`row-span-2 rounded-paper border-2 border-accent bg-accent font-bold text-white shadow-[0_2px_0_#045159] transition hover:bg-accent-hover active:scale-95 ${
            compact ? "text-sm" : "text-base"
          }`}
        >
          =
        </button>

        <button
          type="button"
          onClick={() => pressDigit("0")}
          className={`col-span-2 rounded-paper border-2 border-border font-bold transition hover:bg-surface-hover active:scale-95 ${
            compact ? "py-2 text-sm" : "py-2.5 text-base"
          }`}
        >
          0
        </button>
        {btn(".", () => pressDigit("."))}
      </div>

      <div className="mt-2 flex gap-1">
        <select
          className="min-w-0 flex-1 rounded-paper border-2 border-border bg-surface-input px-1 py-1 text-[10px] font-bold outline-none focus:border-accent"
          value={applyField}
          onChange={(e) => setApplyField(e.target.value as MaterialCalcField)}
        >
          {fields.map((f) => (
            <option key={f} value={f}>
              {FIELD_LABELS[f]}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!canApply}
          onClick={() => {
            const n = current();
            if (n != null) onApply(applyField, fmtNum(n));
          }}
          className="shrink-0 rounded-paper border-2 border-accent bg-accent px-2 py-1 text-[10px] font-bold text-white disabled:opacity-40"
        >
          Aplicar
        </button>
      </div>
    </aside>
  );
}
