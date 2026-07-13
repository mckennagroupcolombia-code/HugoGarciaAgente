import { useEffect, useRef, useState, type RefObject } from "react";
import {
  formatearDescripcionMp,
  partirDescripcionMp,
} from "../../lib/descripcionMpTexto";

/** Textarea de contenido genérico: estado local + commit al blur (sin salto de caret). */
export function ContenidoTextoSimple({
  value,
  onLiveChange,
  onCommit,
  textareaRef,
}: {
  value: string;
  onLiveChange: (valor: string) => void;
  onCommit: (valor: string) => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const [local, setLocal] = useState(value);
  const focoRef = useRef(false);
  const valueRef = useRef(value);

  useEffect(() => {
    if (focoRef.current) return;
    if (valueRef.current === value) return;
    valueRef.current = value;
    setLocal(value);
  }, [value]);

  return (
    <label className="block">
      <span className="text-xs text-muted">Contenido</span>
      <textarea
        ref={textareaRef}
        value={local}
        onFocus={() => {
          focoRef.current = true;
        }}
        onChange={(e) => {
          const v = e.target.value;
          setLocal(v);
          onLiveChange(v);
        }}
        onBlur={(e) => {
          focoRef.current = false;
          const v = e.target.value;
          setLocal(v);
          valueRef.current = v;
          onCommit(v);
        }}
        className="mt-0.5 min-h-[96px] w-full resize-y rounded border border-border bg-surface px-2.5 py-2 text-sm leading-relaxed"
      />
    </label>
  );
}

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
  /** Autocorrección / commit al salir del campo (no en cada tecla). */
  onPlainBlur?: (valor: string) => void;
}

/**
 * Editor práctico para Descripción MP: intro + lista de viñetas Propiedades.
 * Estado local mientras se escribe (el cursor no salta al final).
 */
export default function EditorDescripcionMp({
  value,
  onChange,
  textareaRef,
  onPlainChange,
  onPlainBlur,
}: Props) {
  const partes = partirDescripcionMp(value);
  const [modoPlano, setModoPlano] = useState(!partes.estructurado);
  const [introLocal, setIntroLocal] = useState(partes.intro);
  const [bulletsLocal, setBulletsLocal] = useState(
    partes.bullets.length > 0 ? partes.bullets : [""],
  );
  const [planoLocal, setPlanoLocal] = useState(value);
  /** Evita que un sync externo pise el cursor mientras el usuario escribe. */
  const focoActivoRef = useRef(false);
  const valueExternoRef = useRef(value);
  const introRef = useRef(introLocal);
  const bulletsRef = useRef(bulletsLocal);
  introRef.current = introLocal;
  bulletsRef.current = bulletsLocal;

  // Sync solo cuando el valor viene de fuera (Texto mágico, undo, otra capa)
  // y el usuario NO está escribiendo aquí.
  useEffect(() => {
    if (focoActivoRef.current) return;
    if (valueExternoRef.current === value) return;
    valueExternoRef.current = value;
    const p = partirDescripcionMp(value);
    setIntroLocal(p.intro);
    setBulletsLocal(p.bullets.length > 0 ? p.bullets : [""]);
    setPlanoLocal(value);
    if (p.estructurado) setModoPlano(false);
  }, [value]);

  function emitir(intro: string, bullets: string[]) {
    const next = formatearDescripcionMp(intro, bullets.filter((b) => b.trim()));
    valueExternoRef.current = next;
    onChange(next);
  }

  function marcarFoco(activo: boolean) {
    focoActivoRef.current = activo;
  }

  if (modoPlano || (!partes.estructurado && !value.trim() && !planoLocal.trim())) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted">Contenido</span>
          {(planoLocal.trim() || value.trim()) && !partirDescripcionMp(planoLocal).estructurado && (
            <button
              type="button"
              onClick={() => {
                const base = planoLocal.trim() || value.trim();
                emitir(base, [""]);
                setModoPlano(false);
              }}
              className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/20"
            >
              Estructurar (intro + Propiedades)
            </button>
          )}
          {partirDescripcionMp(planoLocal || value).estructurado && (
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
          value={planoLocal}
          onFocus={() => marcarFoco(true)}
          onChange={(e) => {
            const v = e.target.value;
            setPlanoLocal(v);
            // Actualiza el lienzo en vivo SIN autocorregir (evita salto de caret).
            if (onPlainChange) {
              onPlainChange(v, e.target.selectionStart, e.target.selectionEnd);
            } else {
              onChange(v);
            }
          }}
          onBlur={(e) => {
            marcarFoco(false);
            const v = e.target.value;
            setPlanoLocal(v);
            valueExternoRef.current = v;
            if (onPlainBlur) onPlainBlur(v);
            else if (onPlainChange) onPlainChange(v);
            else onChange(v);
          }}
          className="min-h-[160px] w-full resize-y rounded border border-border bg-surface px-2.5 py-2 text-sm leading-relaxed"
          placeholder={"Párrafo intro…\n\nPropiedades:\n• …"}
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
          onClick={() => {
            setPlanoLocal(formatearDescripcionMp(introLocal, bulletsLocal));
            setModoPlano(true);
          }}
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
          value={introLocal}
          onFocus={() => marcarFoco(true)}
          onChange={(e) => {
            introRef.current = e.target.value;
            setIntroLocal(e.target.value);
          }}
          onBlur={() => {
            marcarFoco(false);
            emitir(introRef.current, bulletsRef.current);
          }}
          className="min-h-[100px] w-full resize-y rounded border border-border bg-surface px-2.5 py-2 text-sm leading-relaxed"
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
              const next = [...bulletsRef.current, ""];
              setBulletsLocal(next);
              emitir(introRef.current, next);
            }}
            className="rounded border border-border px-1.5 py-0.5 text-[10px] text-accent hover:bg-surface-hover"
          >
            + Viñeta
          </button>
        </div>
        <ul className="space-y-2">
          {bulletsLocal.map((b, i) => (
            <li key={`bullet-${i}`} className="flex gap-1.5">
              <span className="mt-2 shrink-0 text-sm font-semibold text-muted">•</span>
              <textarea
                value={b}
                onFocus={() => marcarFoco(true)}
                onChange={(e) => {
                  const next = bulletsRef.current.map((x, j) =>
                    j === i ? e.target.value : x,
                  );
                  bulletsRef.current = next;
                  setBulletsLocal(next);
                }}
                onBlur={() => {
                  marcarFoco(false);
                  emitir(introRef.current, bulletsRef.current);
                }}
                className="min-h-[64px] w-full resize-y rounded border border-border bg-surface px-2.5 py-2 text-sm leading-relaxed"
                placeholder={`Propiedad ${i + 1}`}
              />
              <button
                type="button"
                title="Quitar viñeta"
                disabled={bulletsLocal.length <= 1}
                onClick={() => {
                  const next = bulletsRef.current.filter((_, j) => j !== i);
                  const seguro = next.length > 0 ? next : [""];
                  bulletsRef.current = seguro;
                  setBulletsLocal(seguro);
                  emitir(introRef.current, seguro);
                }}
                className="mt-1.5 shrink-0 rounded px-1.5 text-sm text-muted hover:bg-red-500/10 hover:text-red-500 disabled:opacity-30"
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
