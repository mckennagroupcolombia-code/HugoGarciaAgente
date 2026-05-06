import { useEffect, useRef } from "react";

interface Props {
  lines: string[];
  isRunning?: boolean;
  onClear?: () => void;
  className?: string;
}

function lineClass(line: string): string {
  if (/[✔✅]/.test(line)) return "text-emerald-400";
  if (/[✖❌]/.test(line)) return "text-red-400";
  if (/^[\d\- :]+\s*▶/.test(line)) return "text-sky-400 font-semibold";
  if (/⚠️/.test(line)) return "text-yellow-300";
  if (/📦|🔄|📊|📋|✉️|🧾|🤖|🔍|📅|🗓️/.test(line)) return "text-violet-300";
  if (/WARN|Warning/i.test(line)) return "text-yellow-400";
  if (/ERROR|Exception|Traceback/i.test(line)) return "text-red-400";
  return "text-gray-300";
}

export default function TerminalLog({ lines, isRunning = false, onClear, className = "" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Cuando el usuario scrollea, detectar si está al fondo para decidir auto-scroll
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  useEffect(() => {
    if (!autoScrollRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    // Scrollear solo el contenedor — nunca la página
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className={`flex flex-col rounded-xl border border-border overflow-hidden bg-[#0d1117] ${className}`}>
      {/* macOS-style titlebar */}
      <div className="flex shrink-0 items-center gap-2 px-4 py-2 border-b border-white/5 bg-[#161b22]">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500/60" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
          <div className="w-3 h-3 rounded-full bg-green-500/60" />
        </div>
        <span className="ml-2 text-[11px] font-mono text-gray-500 tracking-wide">
          actividad del servidor
        </span>
        {isRunning && (
          <span className="flex items-center gap-1.5 text-[11px] text-emerald-400">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            ejecutando
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[11px] text-gray-600 font-mono">{lines.length} líneas</span>
          {onClear && (
            <button
              onClick={onClear}
              className="text-[11px] text-gray-600 hover:text-gray-400 transition px-1"
            >
              limpiar
            </button>
          )}
        </div>
      </div>

      {/* Output area */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 font-mono text-[11px] leading-[1.65] min-h-0"
      >
        {lines.length === 0 ? (
          <span className="text-gray-600 italic select-none">
            Sin actividad todavía. Ejecuta una acción para ver la salida aquí.
          </span>
        ) : (
          lines.map((line, i) => (
            <div key={i} className={`whitespace-pre-wrap break-all ${lineClass(line)}`}>
              {line}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
