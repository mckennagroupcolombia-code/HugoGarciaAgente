import { useCallback, useEffect, useRef, useState } from "react";
import { solicitarTextoMagico, type ContextoCapasTexto } from "../../lib/textoMagicoApi";

export interface SugerenciaTextoMagico {
  texto: string;
  titulo?: string;
  fuente?: string;
}

interface Props {
  fragmento: string;
  onElegir: (texto: string) => void;
  /** Descripción materia prima (capa 1): tono MeLi-safe y sin repetir título/subtítulo. */
  modoDescripcionMateriaPrima?: boolean;
  contextoCapas?: ContextoCapasTexto;
  /** En la barra bajo el lienzo: sin margen superior raro. */
  compact?: boolean;
}

const MAX_CHARS_CATALOGO = 2600;
const PALABRAS_POR_PARRAFO = 80;

function contarPalabras(texto: string): number {
  return texto.trim().split(/\s+/).filter(Boolean).length;
}

export default function SugerenciasTextoMagico({
  fragmento,
  onElegir,
  modoDescripcionMateriaPrima,
  contextoCapas,
  compact,
}: Props) {
  const [activo, setActivo] = useState(false);
  const [sugerencias, setSugerencias] = useState<SugerenciaTextoMagico[]>([]);
  /** Copias editables de cada sugerencia (el usuario puede corregir a mano). */
  const [borradores, setBorradores] = useState<string[]>([]);
  const [fichas, setFichas] = useState<{ titulo?: string; fuente?: string }[]>([]);
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const reqIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const puedeGenerar = contarPalabras(fragmento) >= 1;

  useEffect(() => {
    abortRef.current?.abort();
    setActivo(false);
    setCargando(false);
    setSugerencias([]);
    setBorradores([]);
    setFichas([]);
    setMensaje(null);
  }, [fragmento]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const generar = useCallback(() => {
    if (!puedeGenerar || cargando) return;

    setActivo(true);
    setMensaje(null);

    const reqId = ++reqIdRef.current;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setCargando(true);

    void solicitarTextoMagico(
      fragmento,
      {
        max_chars: MAX_CHARS_CATALOGO,
        palabras_por_parrafo: PALABRAS_POR_PARRAFO,
        contexto_capas: contextoCapas,
        modo_descripcion_mp: modoDescripcionMateriaPrima ?? true,
      },
      ctrl.signal,
    )
      .then((res) => {
        if (reqId !== reqIdRef.current) return;
        const lista = res.sugerencias ?? [];
        setSugerencias(lista);
        setBorradores(lista.map((s) => s.texto));
        setFichas(res.fichas ?? []);
        setMensaje(res.mensaje || res.error || null);
      })
      .catch((err: Error) => {
        if (reqId !== reqIdRef.current) return;
        if (err.name === "AbortError") return;
        setSugerencias([]);
        setBorradores([]);
        setFichas([]);
        const msg = err.message || "No se pudieron obtener sugerencias";
        setMensaje(
          msg.includes("504") || msg.toLowerCase().includes("gateway")
            ? "El servidor tardó demasiado. Reintenta en unos segundos."
            : msg,
        );
      })
      .finally(() => {
        if (reqId === reqIdRef.current) setCargando(false);
      });
  }, [cargando, contextoCapas, fragmento, modoDescripcionMateriaPrima, puedeGenerar]);

  return (
    <div className={compact ? "" : "mt-2"}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={generar}
          disabled={!puedeGenerar || cargando}
          className="rounded border border-accent/40 bg-accent/10 px-2.5 py-1 text-[10px] font-semibold text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {cargando ? "Generando…" : "✨ Texto mágico"}
        </button>
        {activo && !cargando && (
          <button
            type="button"
            onClick={() => setActivo(false)}
            className="rounded border border-border px-2 py-1 text-[10px] text-muted hover:bg-surface-hover"
          >
            Ocultar
          </button>
        )}
      </div>

      {!puedeGenerar && (
        <p className="mt-1 text-[10px] text-muted">
          {modoDescripcionMateriaPrima
            ? "Agrega una capa de título con el nombre del producto (ej. creatina), o escribe algo en este contenido, para activar texto mágico."
            : "Escribe el nombre del producto en el contenido (ej. creatina) para activar texto mágico."}
        </p>
      )}

      {activo && (
        <div className="mt-2 rounded-lg border border-accent/25 bg-accent/5 p-2">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-accent">
              Sugerencias · {modoDescripcionMateriaPrima ? "descripción MP" : "catálogo"}
            </span>
            {cargando && (
              <span className="animate-pulse text-[10px] text-muted">
                Redactando ficha… (puede tardar ~30 s)
              </span>
            )}
          </div>

          <p className="mb-1.5 text-[10px] leading-snug text-muted">
            Puedes editar la sugerencia a mano antes de usarla. Formato: intro +
            «Propiedades:» + viñetas.
          </p>

          {fichas.length > 0 && (
            <p className="mb-1.5 text-[10px] text-muted">
              Fuentes: {fichas.map((f) => f.titulo).filter(Boolean).join(" · ")}
            </p>
          )}

          {mensaje && sugerencias.length === 0 && !cargando && (
            <p className="text-[10px] text-muted">{mensaje}</p>
          )}

          {sugerencias.length > 0 && (
            <ul className="space-y-2">
              {sugerencias.map((s, i) => {
                const texto = borradores[i] ?? s.texto;
                const palabras = contarPalabras(texto);
                return (
                  <li
                    key={`sug-${i}`}
                    className="rounded-md border border-border bg-surface p-2"
                  >
                    {s.titulo && (
                      <p className="mb-1 text-[10px] font-semibold text-accent">
                        {s.titulo}
                        {sugerencias.length > 1 ? ` · variante ${i + 1}` : ""}
                        <span className="ml-1 font-normal text-muted">
                          · {palabras} palabras · editable
                        </span>
                      </p>
                    )}
                    <textarea
                      value={texto}
                      onChange={(e) => {
                        const v = e.target.value;
                        setBorradores((prev) => {
                          const next = [...prev];
                          next[i] = v;
                          return next;
                        });
                      }}
                      className="min-h-[160px] w-full resize-y rounded border border-border bg-surface-input px-2.5 py-2 text-sm leading-relaxed text-ink"
                      spellCheck
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setBorradores((prev) => {
                            const next = [...prev];
                            next[i] = s.texto;
                            return next;
                          })
                        }
                        disabled={texto === s.texto}
                        className="rounded border border-border px-2 py-0.5 text-[10px] text-muted hover:bg-surface-hover disabled:opacity-40"
                      >
                        Restaurar original
                      </button>
                      <button
                        type="button"
                        onClick={() => onElegir(texto)}
                        className="rounded border border-accent bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/20"
                      >
                        Usar en capa
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
