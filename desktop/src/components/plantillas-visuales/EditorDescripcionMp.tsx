import { useEffect, useState, type RefObject } from "react";
import {
  formatearDescripcionMp,
  partirDescripcionMp,
} from "../../lib/descripcionMpTexto";

interface Props {
  value: string;
  onChange: (texto: string) => void;
  /** Textarea plano de respaldo (misma API que el inspector clásico). */
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  onPlainChange?: (
    valor: string,
    selStart?: number,
    selEnd?: number,
  ) => void;
}

/**
 * Editor práctico para Descripción MP: intro + lista de viñetas Propiedades.
 * Si el texto aún no está estructurado, ofrece convertir o editar en plano.
 */
export default function EditorDescripcionMp({
  value,
  onChange,
  textareaRef,
  onPlainChange,
}: Props) {
  const partes = partirDescripcionMp(value);
  const [modoPlano, setModoPlano] = useState(false);
  const [introLocal, setIntroLocal] = useState(partes.intro);
  const [bulletsLocal, setBulletsLocal] = useState(
    partes.bullets.length > 0 ? partes.bullets : [""],
  );

  // Sync desde fuera (Texto mágico, undo, otra capa).
  useEffect(() => {
    const p = partirDescripcionMp(value);
    setIntroLocal(p.intro);
    setBulletsLocal(p.bullets.length > 0 ? p.bullets : [""]);
    if (p.estructurado) setModoPlano(false);
  }, [value]);

  function emitir(intro: string, bullets: string[]) {
    onChange(formatearDescripcionMp(intro, bullets.filter((b) => b.trim())));
  }

  if (modoPlano || (!partes.estructurado && !value.trim())) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted">Contenido</span>
          {value.trim() && !partes.estructurado && (
            <button
              type="button"
              onClick={() => {
                const p = partirDescripcionMp(value);
                if (!p.estructurado) {
                  // Convierte prosa a intro + una viñeta vacía lista para editar.
                  emitir(value.trim(), [""]);
                }
                setModoPlano(false);
              }}
              className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/20"
            >
              Estructurar (intro + Propiedades)
            </button>
          )}
          {partes.estructurado && (
            <button
              type="button"
              onClick={() => setModoPlano(false)}
              className="text-[10px] text-accent hover:underline"
            >
              Vista estructurada
            </button>
          )}
        </div>
        <textarea
          ref={textareaRef}
          rows={Math.min(18, Math.max(8, (value || "").split("\n").length + 2))}
          value={value}
          onChange={(e) =>
            onPlainChange
              ? onPlainChange(e.target.value, e.target.selectionStart, e.target.selectionEnd)
              : onChange(e.target.value)
          }
          onBlur={(e) =>
            onPlainChange
              ? onPlainChange(e.target.value, e.target.selectionStart, e.target.selectionEnd)
              : onChange(e.target.value)
          }
          className="min-h-[140px] w-full resize-y rounded border border-border bg-surface px-2 py-1.5 text-xs leading-relaxed"
          placeholder="Párrafo intro…&#10;&#10;Propiedades:&#10;• …"
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">Descripción MP</span>
        <button
          type="button"
          onClick={() => setModoPlano(true)}
          className="text-[10px] text-muted hover:text-accent hover:underline"
        >
          Texto plano
        </button>
      </div>

      <label className="block">
        <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-muted">
          Intro
        </span>
        <textarea
          rows={Math.min(8, Math.max(3, introLocal.split(/\n/).length + 1))}
          value={introLocal}
          onChange={(e) => setIntroLocal(e.target.value)}
          onBlur={() => emitir(introLocal, bulletsLocal)}
          className="min-h-[72px] w-full resize-y rounded border border-border bg-surface px-2 py-1.5 text-xs leading-relaxed"
          placeholder="Qué es, forma física, pH, concentración…"
        />
      </label>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-muted">
            Propiedades
          </span>
          <button
            type="button"
            onClick={() => {
              const next = [...bulletsLocal, ""];
              setBulletsLocal(next);
              emitir(introLocal, next);
            }}
            className="rounded border border-border px-1.5 py-0.5 text-[10px] text-accent hover:bg-surface-hover"
          >
            + Viñeta
          </button>
        </div>
        <ul className="space-y-1.5">
          {bulletsLocal.map((b, i) => (
            <li key={i} className="flex gap-1">
              <span className="mt-1.5 shrink-0 text-xs text-muted">•</span>
              <textarea
                rows={Math.min(4, Math.max(2, Math.ceil(b.length / 42)))}
                value={b}
                onChange={(e) => {
                  const next = bulletsLocal.map((x, j) => (j === i ? e.target.value : x));
                  setBulletsLocal(next);
                }}
                onBlur={() => emitir(introLocal, bulletsLocal)}
                className="min-h-[40px] w-full resize-y rounded border border-border bg-surface px-2 py-1 text-xs leading-snug"
                placeholder={`Propiedad ${i + 1}`}
              />
              <button
                type="button"
                title="Quitar viñeta"
                disabled={bulletsLocal.length <= 1}
                onClick={() => {
                  const next = bulletsLocal.filter((_, j) => j !== i);
                  const seguro = next.length > 0 ? next : [""];
                  setBulletsLocal(seguro);
                  emitir(introLocal, seguro);
                }}
                className="mt-1 shrink-0 rounded px-1 text-[11px] text-muted hover:bg-red-500/10 hover:text-red-500 disabled:opacity-30"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
