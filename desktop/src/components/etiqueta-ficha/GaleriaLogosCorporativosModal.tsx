/**
 * Galería de logos (carpeta DISEÑO CORPORATIVO) en ventana — se abre desde
 * el menú del logo de la Ficha de etiqueta. Además de elegir el logo, deja
 * administrar la carpeta: subir en masa (Shift/Ctrl en el explorador o
 * arrastrando archivos a la ventana) y eliminar uno o varios. Eliminar no
 * borra: el servidor mueve el archivo a `.papelera/` dentro de la carpeta.
 *
 * La confirmación de borrado va dentro de la ventana y no con `confirm()`:
 * en algunos navegadores los diálogos quedan bloqueados y devuelven false
 * sin avisar.
 */
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  eliminarLogosCorporativos,
  useLogosCorporativos,
  useSubirLogosCorporativos,
  type LogoCorporativo,
} from "../../lib/logosCorporativos";
import { puedeVerEtiquetasAvanzado } from "../../lib/studioVisualAccess";
import { useTicketsAuth } from "../../stores/ticketsAuth";

function formatoBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function GaleriaLogosCorporativosModal({
  abierta,
  logoActivo,
  cargandoNombre,
  onCerrar,
  onElegir,
}: {
  abierta: boolean;
  /** Nombre del logo puesto en la ficha, para resaltarlo. */
  logoActivo?: string;
  /** Logo que se está descargando para ponerlo en la ficha. */
  cargandoNombre?: string | null;
  onCerrar: () => void;
  onElegir: (logo: LogoCorporativo) => void;
}) {
  const qc = useQueryClient();
  const puedeEliminar = puedeVerEtiquetasAvanzado(useTicketsAuth((s) => s.user));
  const { data, isLoading, error: errorLista } = useLogosCorporativos(abierta);
  const { subir, progreso, error: errorSubida, setError: setErrorSubida } = useSubirLogosCorporativos();
  const inputRef = useRef<HTMLInputElement>(null);
  const ultimoMarcado = useRef<number | null>(null);
  const [buscar, setBuscar] = useState("");
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [confirmar, setConfirmar] = useState<string[] | null>(null);
  const [eliminando, setEliminando] = useState(false);
  const [errorEliminar, setErrorEliminar] = useState<string | null>(null);
  const [arrastrandoArchivos, setArrastrandoArchivos] = useState(false);

  const logos = data?.logos ?? [];
  const q = buscar.trim().toLowerCase();
  const filtrados = useMemo(
    () => (q ? logos.filter((l) => l.nombre.toLowerCase().includes(q)) : logos),
    [logos, q],
  );
  const todosSeleccionados = filtrados.length > 0 && filtrados.every((l) => seleccionados.has(l.nombre));

  if (!abierta || typeof document === "undefined") return null;

  /** Shift+clic marca (o desmarca) todo el rango desde la última casilla tocada. */
  const marcar = (indice: number, conShift: boolean) => {
    const nombre = filtrados[indice].nombre;
    const marcarlo = !seleccionados.has(nombre);
    setSeleccionados((prev) => {
      const next = new Set(prev);
      const desde = conShift && ultimoMarcado.current !== null ? Math.min(ultimoMarcado.current, indice) : indice;
      const hasta = conShift && ultimoMarcado.current !== null ? Math.max(ultimoMarcado.current, indice) : indice;
      for (let i = desde; i <= hasta && i < filtrados.length; i++) {
        if (marcarlo) next.add(filtrados[i].nombre);
        else next.delete(filtrados[i].nombre);
      }
      return next;
    });
    ultimoMarcado.current = indice;
  };

  const alternarTodo = () => {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      filtrados.forEach((l) => (todosSeleccionados ? next.delete(l.nombre) : next.add(l.nombre)));
      return next;
    });
  };

  const eliminar = async (nombres: string[]) => {
    setEliminando(true);
    setErrorEliminar(null);
    try {
      const res = await eliminarLogosCorporativos(nombres);
      setSeleccionados((prev) => {
        const next = new Set(prev);
        res.eliminados.forEach((n) => next.delete(n));
        return next;
      });
      const fallidos = Object.entries(res.errores || {});
      if (fallidos.length > 0) {
        setErrorEliminar(`No se pudieron eliminar: ${fallidos.map(([n, e]) => `${n} (${e})`).join("; ")}`);
      }
    } catch (e) {
      setErrorEliminar(e instanceof Error ? e.message : "No se pudieron eliminar los logos");
    } finally {
      await qc.invalidateQueries({ queryKey: ["etiquetas", "logos-corporativos"] });
      setEliminando(false);
      setConfirmar(null);
    }
  };

  const subiendo = !!progreso;
  const hayArchivos = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  return createPortal(
    <div
      className="fixed inset-0 z-[650] flex items-center justify-center bg-ink/50 p-2 backdrop-blur-sm"
      onClick={onCerrar}
    >
      <div
        className="relative flex max-h-[min(90vh,760px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-surface-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => {
          if (!hayArchivos(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setArrastrandoArchivos(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setArrastrandoArchivos(false);
        }}
        onDrop={(e) => {
          if (!hayArchivos(e)) return;
          e.preventDefault();
          setArrastrandoArchivos(false);
          if (!subiendo) void subir(Array.from(e.dataTransfer.files));
        }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-ink">Logos · DISEÑO CORPORATIVO</h3>
            <p className="text-[11px] text-muted">
              Clic en un logo para ponerlo en la ficha. Arrastra imágenes aquí para agregarlas.
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border text-muted hover:bg-surface-hover hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <input
            type="search"
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Buscar logo…"
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface-input px-3 py-1.5 text-sm text-ink outline-none focus:border-accent sm:max-w-xs"
          />
          <span className="text-xs text-muted">{filtrados.length} imagen(es)</span>
          {filtrados.length > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-ink-secondary">
              <input type="checkbox" checked={todosSeleccionados} onChange={alternarTodo} />
              Seleccionar todo
            </label>
          )}
          {puedeEliminar && seleccionados.size > 0 && (
            <button
              type="button"
              disabled={eliminando}
              onClick={() => setConfirmar(Array.from(seleccionados))}
              className="rounded-lg border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
            >
              Eliminar seleccionadas ({seleccionados.size})
            </button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              if (files.length > 0) void subir(files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={subiendo}
            onClick={() => inputRef.current?.click()}
            title="En el explorador, mantén Shift (rango) o Ctrl (sueltas) para elegir varias imágenes"
            className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {progreso ? `Subiendo ${progreso.done}/${progreso.total}…` : "+ Subir imágenes"}
          </button>
        </div>

        {confirmar && (
          <div className="flex flex-wrap items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
            <span className="font-semibold">
              ¿Eliminar {confirmar.length === 1 ? `«${confirmar[0]}»` : `${confirmar.length} logos`} de la galería?
            </span>
            <span className="text-red-700/80 dark:text-red-300/80">Quedan en la papelera de la carpeta.</span>
            <button
              type="button"
              disabled={eliminando}
              onClick={() => void eliminar(confirmar)}
              className="ml-auto rounded-md bg-red-600 px-3 py-1 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {eliminando ? "Eliminando…" : "Sí, eliminar"}
            </button>
            <button
              type="button"
              disabled={eliminando}
              onClick={() => setConfirmar(null)}
              className="rounded-md border border-red-300 bg-white px-3 py-1 font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 dark:bg-transparent"
            >
              Cancelar
            </button>
          </div>
        )}

        {(errorLista || errorSubida || errorEliminar) && (
          <div className="border-b border-border px-4 py-2">
            {[
              errorLista instanceof Error ? errorLista.message : errorLista ? "No se pudo leer la carpeta de logos" : null,
              errorSubida,
              errorEliminar,
            ]
              .filter(Boolean)
              .map((m) => (
                <p key={m} className="rounded bg-danger/10 px-2 py-1 text-[11px] text-danger">
                  {m}
                </p>
              ))}
            <button
              type="button"
              onClick={() => {
                setErrorSubida(null);
                setErrorEliminar(null);
              }}
              className="mt-1 text-[11px] text-muted hover:text-ink"
            >
              Ocultar aviso
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <p className="py-12 text-center text-sm text-muted">Cargando…</p>
          ) : filtrados.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted">
              {q ? "Ningún logo con ese nombre." : "La carpeta no tiene imágenes. Sube o arrastra algunas."}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {filtrados.map((logo, i) => {
                const activo = logoActivo === logo.nombre;
                const marcado = seleccionados.has(logo.nombre);
                return (
                  <div
                    key={logo.nombre}
                    className={`group relative flex flex-col overflow-hidden rounded-xl border-2 bg-surface transition ${
                      marcado ? "border-accent ring-2 ring-accent/40" : activo ? "border-accent/60" : "border-border"
                    }`}
                  >
                    <label
                      className="absolute left-1.5 top-1.5 z-10 flex h-5 w-5 cursor-pointer items-center justify-center rounded border border-border bg-white/95 shadow-sm dark:bg-zinc-900/95"
                      title="Seleccionar (Shift+clic para marcar un rango)"
                      onClick={(e) => {
                        e.preventDefault();
                        marcar(i, e.shiftKey);
                      }}
                    >
                      <input type="checkbox" checked={marcado} readOnly className="pointer-events-none h-3.5 w-3.5" />
                    </label>
                    {puedeEliminar && (
                      <button
                        type="button"
                        title="Eliminar"
                        disabled={eliminando}
                        onClick={() => setConfirmar([logo.nombre])}
                        className="absolute right-1.5 top-1.5 z-10 rounded-md border border-red-200 bg-white/95 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 opacity-0 shadow-sm transition hover:bg-red-50 group-hover:opacity-100 disabled:opacity-50 dark:border-red-900/50 dark:bg-zinc-900/95"
                      >
                        ✕
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={!!cargandoNombre}
                      onClick={() => onElegir(logo)}
                      title={`Poner «${logo.nombre}» en la ficha`}
                      className="flex h-28 items-center justify-center bg-white p-2 hover:bg-accent/5 disabled:opacity-60"
                    >
                      {logo.thumb ? (
                        <img src={logo.thumb} alt="" className="max-h-full max-w-full object-contain" />
                      ) : (
                        <span className="text-[10px] text-muted">sin vista previa</span>
                      )}
                    </button>
                    <div className="border-t border-border px-2 py-1">
                      <p className="truncate text-[11px] text-ink" title={logo.nombre}>
                        {cargandoNombre === logo.nombre ? "Cargando…" : logo.nombre}
                      </p>
                      <p className="text-[10px] text-muted">
                        {formatoBytes(logo.bytes)}
                        {activo ? " · en la ficha" : ""}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {arrastrandoArchivos && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl border-4 border-dashed border-accent bg-accent/10 text-sm font-bold text-accent">
            Suelta las imágenes para agregarlas a la carpeta
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
