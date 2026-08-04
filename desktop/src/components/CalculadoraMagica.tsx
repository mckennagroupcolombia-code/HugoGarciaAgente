import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons";

type Op = "+" | "-" | "×" | "÷";

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

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function CalculadoraPad({
  onClose,
  /** Solo el pad (sin marco/cabecera); para embeber en FloatingToolWindow. */
  bare = false,
}: {
  onClose: () => void;
  bare?: boolean;
}) {
  const [display, setDisplay] = useState("0");
  const [accumulator, setAccumulator] = useState<number | null>(null);
  const [pendingOp, setPendingOp] = useState<Op | null>(null);
  const [fresh, setFresh] = useState(true);
  const [copiado, setCopiado] = useState(false);
  const padRef = useRef<HTMLDivElement>(null);

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

  const copiar = useCallback(async () => {
    const n = current();
    if (n == null) return;
    try {
      await navigator.clipboard.writeText(fmtNum(n));
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1500);
    } catch {
      /* ignore */
    }
  }, [current]);

  useEffect(() => {
    padRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target) && !padRef.current?.contains(e.target as Node)) return;

      const key = e.key;

      if (key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

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

      if (key === "+" || key === "Add") {
        e.preventDefault();
        pressOp("+");
        return;
      }
      if (key === "-" || key === "Subtract") {
        e.preventDefault();
        pressOp("-");
        return;
      }
      if (key === "*" || key === "x" || key === "X" || key === "Multiply") {
        e.preventDefault();
        pressOp("×");
        return;
      }
      if (key === "/" || key === "Divide") {
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
  }, [onClose, pressBackspace, pressDigit, pressEquals, pressOp, reset]);

  const btn = (label: string, onClick: () => void, className = "") => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      className={`rounded-paper border-2 border-border py-2 text-sm font-bold transition active:scale-95 hover:bg-surface-hover ${className}`}
    >
      {label}
    </button>
  );

  const opBtn = (op: Op) =>
    btn(op, () => pressOp(op), "border-accent/40 bg-accent/5 text-accent hover:bg-accent/15");

  const body = (
    <div className="p-2.5">
      <div
        className="mb-2 overflow-hidden rounded-paper border-2 border-border bg-surface-input px-2 py-2 text-right font-mono text-xl font-bold text-ink"
        aria-live="polite"
      >
        {display}
      </div>

      <div className="grid grid-cols-4 gap-1">
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
          className="row-span-2 rounded-paper border-2 border-accent bg-accent text-sm font-bold text-white shadow-[0_2px_0_#045159] transition hover:bg-accent-hover active:scale-95"
        >
          =
        </button>

        <button
          type="button"
          onClick={() => pressDigit("0")}
          className="col-span-2 rounded-paper border-2 border-border py-2 text-sm font-bold transition hover:bg-surface-hover active:scale-95"
        >
          0
        </button>
        {btn(".", () => pressDigit("."))}
      </div>

      <button
        type="button"
        disabled={display === "Error" || current() == null}
        onClick={() => void copiar()}
        className="mt-2 w-full rounded-paper border-2 border-accent/50 bg-accent/10 py-1.5 text-[11px] font-bold text-accent transition hover:bg-accent/20 disabled:opacity-40"
      >
        {copiado ? "✓ Copiado" : "Copiar resultado"}
      </button>
      <p className="mt-1.5 text-center text-[9px] text-muted">
        Teclado: 0-9 · + − * / · Enter · ⌫ · Esc
      </p>
    </div>
  );

  if (bare) {
    return (
      <div
        ref={padRef}
        tabIndex={0}
        className="outline-none"
        onClick={(e) => e.stopPropagation()}
        aria-label="Calculadora mágica"
        aria-keyshortcuts="0-9, +, -, *, /, Enter, Backspace, Escape"
      >
        {body}
      </div>
    );
  }

  return (
    <div
      ref={padRef}
      tabIndex={0}
      className="w-[17rem] overflow-hidden rounded-paper-lg border-2 border-accent/50 bg-surface-panel shadow-paper-lg outline-none"
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-label="Calculadora mágica"
      aria-keyshortcuts="0-9, +, -, *, /, Enter, Backspace, Escape"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border bg-accent/10 px-3 py-2">
        <div className="flex items-center gap-1.5 text-accent">
          <Icon name="star" size={14} weight="bold" />
          <Icon name="calculator" size={14} weight="regular" />
          <span className="text-[11px] font-extrabold uppercase tracking-wide">Calculadora</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2 py-0.5 text-sm text-muted hover:bg-surface-hover hover:text-ink"
          aria-label="Cerrar calculadora"
        >
          ✕
        </button>
      </div>
      {body}
    </div>
  );
}

/**
 * Botón flotante de calculadora (legacy). En Contabilidad usa la barra del cabezote.
 */
export default function CalculadoraMagica({
  position = "right",
}: {
  position?: "left" | "right";
} = {}) {
  const [abierta, setAbierta] = useState(false);

  if (typeof document === "undefined") return null;

  const posClass =
    position === "left"
      ? "fixed top-5 left-5 z-[900] flex flex-col items-start gap-3 sm:top-6 sm:left-6"
      : "fixed top-5 right-5 z-[900] flex flex-col items-end gap-3 sm:top-6 sm:right-6";

  return createPortal(
    <div className={`pointer-events-none ${posClass}`}>
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        className={`pointer-events-auto group relative flex h-14 w-14 items-center justify-center rounded-full border-2 shadow-paper-lg transition active:scale-95 ${
          abierta
            ? "border-accent bg-accent text-white"
            : "border-accent/60 bg-surface-panel text-accent hover:border-accent hover:bg-accent hover:text-white"
        }`}
        title="Calculadora mágica"
        aria-label={abierta ? "Cerrar calculadora" : "Abrir calculadora mágica"}
        aria-expanded={abierta}
      >
        <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[9px] text-ink shadow-sm">
          ✦
        </span>
        <Icon name="calculator" size={22} weight={abierta ? "bold" : "regular"} />
      </button>
      {abierta && (
        <div className="pointer-events-auto">
          <CalculadoraPad onClose={() => setAbierta(false)} />
        </div>
      )}
    </div>,
    document.body,
  );
}
