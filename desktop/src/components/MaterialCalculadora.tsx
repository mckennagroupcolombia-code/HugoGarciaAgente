import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../icons";

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
  const [activa, setActiva] = useState(false);
  const padRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!fields.includes(applyField)) setApplyField(fields[0]);
  }, [fields, applyField]);

  const reset = useCallback(() => {
    setDisplay("0");
    setAccumulator(null);
    setPendingOp(null);
    setFresh(true);
  }, []);

  const current = useCallback((): number | null => {
    if (display === "Error") return null;
    const n = parseFloat(display);
    return Number.isFinite(n) ? n : null;
  }, [display]);

  const pressDigit = useCallback(
    (d: string) => {
      if (display === "Error") {
        setDisplay(d === "." ? "0." : d);
        setAccumulator(null);
        setPendingOp(null);
        setFresh(false);
        return;
      }
      setDisplay((prev) => {
        if (fresh) return d === "." ? "0." : d;
        if (d === "." && prev.includes(".")) return prev;
        if (prev === "0" && d !== ".") return d;
        return prev + d;
      });
      setFresh(false);
    },
    [display, fresh],
  );

  const pressBackspace = useCallback(() => {
    if (display === "Error" || fresh) return;
    setDisplay((prev) => {
      if (prev.length <= 1) return "0";
      const next = prev.slice(0, -1);
      return next === "-" ? "0" : next;
    });
  }, [display, fresh]);

  const pressOp = useCallback(
    (op: Op) => {
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
    },
    [accumulator, current, display, fresh, pendingOp],
  );

  const pressEquals = useCallback(() => {
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
  }, [accumulator, current, display, pendingOp]);

  useEffect(() => {
    if (!activa) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      // El select de campo no debe capturar dígitos/operadores del pad
      if (target?.tagName === "SELECT" && padRef.current?.contains(target)) return;

      const key = e.key;
      if (/^[0-9]$/.test(key)) {
        e.preventDefault();
        pressDigit(key);
        return;
      }
      if (key === "." || key === ",") {
        e.preventDefault();
        pressDigit(".");
        return;
      }
      if (key === "Backspace") {
        e.preventDefault();
        pressBackspace();
        return;
      }
      if (key === "Delete" || key === "c" || key === "C") {
        e.preventDefault();
        reset();
        return;
      }
      if (key === "+") {
        e.preventDefault();
        pressOp("+");
        return;
      }
      if (key === "-") {
        e.preventDefault();
        pressOp("-");
        return;
      }
      if (key === "*" || key === "x" || key === "X") {
        e.preventDefault();
        pressOp("×");
        return;
      }
      if (key === "/") {
        e.preventDefault();
        pressOp("÷");
        return;
      }
      if (key === "Enter" || key === "=") {
        e.preventDefault();
        pressEquals();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [activa, pressBackspace, pressDigit, pressEquals, pressOp, reset]);

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
      ref={padRef}
      tabIndex={0}
      onFocus={() => setActiva(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActiva(false);
      }}
      onMouseDown={() => setActiva(true)}
      className={`shrink-0 rounded-paper border-2 bg-surface-panel p-2 outline-none ${
        activa ? "border-accent/60" : "border-border"
      } ${compact ? "w-full" : "w-full lg:w-[11.5rem]"}`}
      aria-label="Calculadora de materiales"
      aria-keyshortcuts="0-9, +, -, *, /, Enter, Backspace"
    >
      <div className="mb-1.5 flex items-center justify-between gap-1 text-muted">
        <div className="flex items-center gap-1">
          <Icon name="calculator" size={13} weight="regular" />
          <span className="text-[10px] font-extrabold uppercase tracking-wide">Calculadora</span>
        </div>
        {activa && (
          <span className="text-[8px] font-semibold uppercase tracking-wide text-accent">Teclado</span>
        )}
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
