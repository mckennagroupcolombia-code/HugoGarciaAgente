/**
 * La ventana de diálogo de Empresa viva, al estilo de los RPG de Super Nintendo: el texto se
 * escribe solo, «▼» para seguir, y al final un menú con la manito. A (Enter, Espacio, E o Z)
 * avanza o elige; ↑ ↓ mueven la manito; Esc cierra. Con el dedo: tocar la ventana avanza y tocar
 * una opción la elige. Mientras está abierta el personaje no se mueve (EmpresaViva.tsx).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tocarSonido } from "../../lib/sonidosJuego";

export interface OpcionDialogo {
  texto: string;
  hacer: () => void;
  deshabilitada?: boolean;
}
export interface Dialogo {
  hablante?: string;
  retrato?: string | null;
  /** Páginas de texto (se escriben solas) o contenido ya armado (listas). */
  paginas: (string | React.ReactNode)[];
  opciones?: OpcionDialogo[];
  /** Pide un texto (preguntar, decir): se muestra con la última página. */
  campo?: { placeholder: string; enviar: (texto: string) => Promise<string | null> | string | null; boton: string; largo?: number };
}

const TECLAS_A = new Set(["Enter", "Space", "KeyE", "KeyZ", "NumpadEnter"]);

export function VentanaDialogo({ d, onCerrar }: { d: Dialogo; onCerrar: () => void }) {
  const [pag, setPag] = useState(0);
  const [visibles, setVisibles] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const campoRef = useRef<HTMLInputElement>(null);
  const actual = d.paginas[pag];
  const esTexto = typeof actual === "string";
  const largo = esTexto ? (actual as string).length : 0;
  const completa = !esTexto || visibles >= largo;
  const ultima = pag >= d.paginas.length - 1;
  const opciones = useMemo(() => (ultima && completa ? d.opciones ?? [] : []), [ultima, completa, d.opciones]);
  const pideCampo = ultima && completa && d.campo;

  // El texto aparece letra por letra (con un blip suave cada tanto).
  useEffect(() => {
    setVisibles(0);
    if (!esTexto) return;
    let n = 0;
    const t = window.setInterval(() => {
      n += 2;
      setVisibles(n);
      if (n % 12 === 0) tocarSonido("blip");
      if (n >= largo) window.clearInterval(t);
    }, 22);
    return () => window.clearInterval(t);
  }, [pag, esTexto, largo]);

  useEffect(() => { setCursor(0); }, [pag]);
  useEffect(() => { if (pideCampo) campoRef.current?.focus(); }, [pideCampo]);

  const avanzar = useCallback(() => {
    if (!completa) { setVisibles(largo); return; }
    if (!ultima) { setPag((p) => p + 1); tocarSonido("blip"); return; }
    if (opciones.length) {
      const o = opciones[cursor];
      if (o && !o.deshabilitada) { tocarSonido("blip"); o.hacer(); }
      return;
    }
    if (!d.campo) onCerrar();
  }, [completa, largo, ultima, opciones, cursor, d.campo, onCerrar]);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const enCampo = (e.target as HTMLElement | null)?.tagName === "INPUT";
      if (e.key === "Escape") { e.preventDefault(); onCerrar(); return; }
      if (enCampo) return;
      if (TECLAS_A.has(e.code)) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) avanzar(); return; }
      if (opciones.length && (e.code === "ArrowDown" || e.code === "KeyS")) {
        e.preventDefault();
        setCursor((c) => (c + 1) % opciones.length);
        tocarSonido("blip");
      } else if (opciones.length && (e.code === "ArrowUp" || e.code === "KeyW")) {
        e.preventDefault();
        setCursor((c) => (c - 1 + opciones.length) % opciones.length);
        tocarSonido("blip");
      }
    };
    window.addEventListener("keydown", tecla, true);
    return () => window.removeEventListener("keydown", tecla, true);
  }, [avanzar, opciones.length, onCerrar]);

  async function enviar() {
    if (!d.campo || !texto.trim() || enviando) return;
    setEnviando(true);
    setError("");
    try {
      const err = await d.campo.enviar(texto.trim());
      if (err) setError(err);
    } catch (e) {
      setError((e as Error).message || "No se pudo enviar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center p-2 sm:p-3">
      <div className="ev-ventana pointer-events-auto relative flex w-[min(46rem,100%)] gap-3 p-3 sm:p-4" role="dialog"
           aria-label={d.hablante ? `Hablando con ${d.hablante}` : "Diálogo"}
           onClick={(e) => { if ((e.target as HTMLElement).closest("button,input,a,[data-no-avanza]")) return; avanzar(); }}>
        {d.retrato && (
          <img src={d.retrato} alt="" className="ev-retrato h-16 w-16 shrink-0 rounded border-2 border-[#8a95d6] bg-[#0b1140] sm:h-20 sm:w-20" draggable={false} />
        )}
        <div className="min-w-0 flex-1 text-[15px] leading-snug sm:text-base">
          {d.hablante && <div className="ev-nombre-dialogo mb-0.5">{d.hablante}</div>}
          <div className="min-h-[3.2em] whitespace-pre-wrap break-words">
            {esTexto ? (actual as string).slice(0, visibles) : actual}
            {completa && !ultima && <span className="ev-sigue ml-1">▼</span>}
          </div>
          {opciones.length > 0 && (
            <div className="mt-2 grid gap-0.5 sm:grid-cols-2" role="menu" data-no-avanza>
              {opciones.map((o, i) => (
                <button key={o.texto} type="button" role="menuitem" className="ev-opcion mck-btn-no-fx" data-activa={i === cursor ? "1" : "0"}
                        disabled={o.deshabilitada} onMouseEnter={() => setCursor(i)} onClick={() => { setCursor(i); if (!o.deshabilitada) { tocarSonido("blip"); o.hacer(); } }}>
                  <span className="ev-mano" aria-hidden>☞</span>{o.texto}
                </button>
              ))}
            </div>
          )}
          {pideCampo && (
            <form className="mt-2 flex gap-2" data-no-avanza onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
              <input ref={campoRef} className="ev-campo" value={texto} onChange={(e) => setTexto(e.target.value)}
                     maxLength={d.campo!.largo ?? 200} placeholder={d.campo!.placeholder} aria-label={d.campo!.placeholder} />
              <button type="submit" className="ev-boton mck-btn-no-fx shrink-0" disabled={enviando || !texto.trim()}>
                {enviando ? "…" : d.campo!.boton}
              </button>
            </form>
          )}
          {error && <p className="mt-1 text-sm text-[#ffb4b4]">{error}</p>}
        </div>
        <button type="button" onClick={onCerrar} aria-label="Cerrar (Esc)"
                className="ev-boton mck-btn-no-fx absolute -top-3 right-3 px-2 py-0 text-xs">Esc ✕</button>
      </div>
    </div>
  );
}
