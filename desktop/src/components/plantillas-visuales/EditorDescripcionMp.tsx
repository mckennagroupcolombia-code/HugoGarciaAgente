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
  compactLabel,
  short,
  contrasteFuerte,
}: {
  value: string;
  onLiveChange: (valor: string) => void;
  onCommit: (valor: string) => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  /** Oculta la etiqueta "Contenido" (la barra superior ya la muestra). */
  compactLabel?: boolean;
  /** Título / subtítulo / CAS: campo de una línea alta, ancho completo. */
  short?: boolean;
  /** Fondo blanco + texto casi negro (barra inferior del Studio). */
  contrasteFuerte?: boolean;
}) {
  const [local, setLocal] = useState(value);
  const focoRef = useRef(false);
  const valueRef = useRef(value);
  const autoRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (focoRef.current) return;
    if (valueRef.current === value) return;
    valueRef.current = value;
    setLocal(value);
  }, [value]);

  useEffect(() => {
    const el = autoRef.current;
    if (!el || short) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(280, Math.max(88, el.scrollHeight))}px`;
  }, [local, short]);

  function setRefs(node: HTMLTextAreaElement | null) {
    autoRef.current = node;
    if (!textareaRef) return;
    if (typeof textareaRef === "object") {
      (textareaRef as { current: HTMLTextAreaElement | null }).current = node;
    }
  }

  if (short) {
    return (
      <label className="block">
        {!compactLabel && <span className="text-xs text-muted">Contenido</span>}
        <textarea
          ref={textareaRef}
          value={local}
          rows={1}
          onFocus={() => {
            focoRef.current = true;
          }}
          onChange={(e) => {
            const v = e.target.value.replace(/\n/g, " ");
            setLocal(v);
            onLiveChange(v);
          }}
          onBlur={(e) => {
            focoRef.current = false;
            const v = e.target.value.replace(/\n/g, " ");
            setLocal(v);
            valueRef.current = v;
            onCommit(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          className={`h-11 w-full resize-none overflow-hidden rounded-lg border px-3 py-2.5 text-base font-semibold leading-snug outline-none focus:ring-2 ${
            compactLabel ? "" : "mt-0.5"
          } ${
            contrasteFuerte
              ? "border-neutral-300 bg-white text-neutral-900 ring-[#016d82]/30 placeholder:text-neutral-400"
              : "border-border bg-surface text-ink ring-accent/40"
          }`}
          placeholder="Escribe aquí…"
        />
      </label>
    );
  }

  return (
    <label className="block">
      {!compactLabel && <span className="text-xs text-muted">Contenido</span>}
      <textarea
        ref={setRefs}
        value={local}
        rows={3}
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
        className={`min-h-[88px] w-full resize-y rounded-lg border px-3 py-2.5 text-[15px] font-medium leading-relaxed outline-none focus:ring-2 ${
          compactLabel ? "" : "mt-0.5"
        } ${
          contrasteFuerte
            ? "border-neutral-300 bg-white text-neutral-900 ring-[#016d82]/30 placeholder:text-neutral-400"
            : "border-border bg-surface text-ink ring-accent/40"
        }`}
        placeholder="Escribe el texto de la etiqueta…"
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
  /** En la barra bajo el lienzo: intro + viñetas en dos columnas. */
  layout?: "panel" | "barra";
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
  layout = "panel",
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
  const barra = layout === "barra";

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
          {!barra && <span className="text-xs text-muted">Contenido</span>}
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
          className={`w-full resize-y rounded-lg border px-3 py-2.5 text-[15px] font-medium leading-relaxed outline-none focus:ring-2 ${
            barra
              ? "min-h-[120px] border-neutral-300 bg-white text-neutral-900 ring-[#016d82]/30 placeholder:text-neutral-400"
              : "min-h-[160px] border-border bg-surface text-ink ring-accent/40"
          }`}
          placeholder={"Párrafo intro…\n\nPropiedades:\n• …"}
        />
      </div>
    );
  }

  return (
    <div className={barra ? "space-y-2" : "space-y-2"}>
      <div className="flex items-center justify-between gap-2">
        {!barra && (
          <span className="text-xs font-medium text-muted">Descripción MP</span>
        )}
        <button
          type="button"
          onClick={() => {
            setPlanoLocal(formatearDescripcionMp(introLocal, bulletsLocal));
            setModoPlano(true);
          }}
          className={`text-[11px] font-medium hover:underline ${
            barra ? "ml-auto text-neutral-700 hover:text-[#016d82]" : "text-muted hover:text-accent"
          }`}
        >
          Texto plano
        </button>
      </div>

      <div className={barra ? "grid gap-3 md:grid-cols-2" : "space-y-2"}>
        <label className="block min-w-0">
          <span
            className={`mb-0.5 block text-[10px] font-bold uppercase tracking-wide ${
              barra ? "text-neutral-700" : "text-muted"
            }`}
          >
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
            className={`w-full resize-y rounded-lg border px-3 py-2 text-[15px] font-medium leading-relaxed outline-none focus:ring-2 ${
              barra
                ? "min-h-[110px] border-neutral-300 bg-white text-neutral-900 ring-[#016d82]/30 placeholder:text-neutral-400"
                : "min-h-[100px] border-border bg-surface text-ink ring-accent/40"
            }`}
            placeholder="Qué es, forma física, pH, concentración…"
          />
        </label>

        <div className="min-w-0">
          <div className="mb-1 flex items-center justify-between">
            <span
              className={`text-[10px] font-bold uppercase tracking-wide ${
                barra ? "text-neutral-700" : "text-muted"
              }`}
            >
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
          <ul className={`space-y-1.5 ${barra ? "max-h-[200px] overflow-y-auto pr-0.5" : ""}`}>
            {bulletsLocal.map((b, i) => (
              <li key={`bullet-${i}`} className="flex gap-1.5">
                <span
                  className={`mt-2 shrink-0 text-sm font-semibold ${
                    barra ? "text-neutral-700" : "text-muted"
                  }`}
                >
                  •
                </span>
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
                  rows={barra ? 2 : 3}
                  className={`min-h-[48px] w-full resize-y rounded-lg border px-2.5 py-1.5 text-[14px] font-medium leading-snug outline-none focus:ring-2 ${
                    barra
                      ? "border-neutral-300 bg-white text-neutral-900 ring-[#016d82]/30 placeholder:text-neutral-400"
                      : "border-border bg-surface text-ink ring-accent/40"
                  }`}
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
                  className={`mt-1.5 shrink-0 rounded px-1.5 text-sm hover:bg-red-500/10 hover:text-red-600 disabled:opacity-30 ${
                    barra ? "text-neutral-600" : "text-muted"
                  }`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
