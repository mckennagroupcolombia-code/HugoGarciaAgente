import { EtiquetaTextoToolbar, patchCampoToolbar } from "./EtiquetaTextoToolbar";
import type { EtiquetaStudioDatos } from "../../lib/etiquetasNormativa";
import { subtituloAlternativo } from "../../lib/etiquetasNormativa";
import {
  CAMPOS_DIAGRAMACION,
  type CampoDiagramacionId,
  type DiagramacionEtiqueta,
  type DiagramacionGraficos,
  b1AnchoPctEfectivo,
  editorTextoCampo,
  escalaEfectiva,
  esIdGrafico,
  labelCampoDiagramacion,
  labelElementoEditor,
  patchDiagramacion,
  patchDiagramacionGraficos,
} from "../../lib/etiquetasDiagramacion";

interface Props {
  datos: EtiquetaStudioDatos;
  diagramacion?: DiagramacionEtiqueta;
  diagramacionGraficos?: DiagramacionGraficos;
  seleccion: string | null;
  onSeleccion: (id: string) => void;
  onPatchDatos: (patch: Partial<EtiquetaStudioDatos>) => void;
  onPatchDiagramacion: (next: DiagramacionEtiqueta) => void;
  onPatchGraficos?: (next: DiagramacionGraficos) => void;
  soloLectura?: boolean;
  camposPresentes?: Set<CampoDiagramacionId>;
  graficosPresentes?: string[];
  onCompletarFicha?: () => void;
  fichaPendiente?: boolean;
  fichaMsg?: string | null;
}

const ZONAS = ["Encabezado", "Columna izq.", "Columna der.", "Pie"] as const;

export function EtiquetaTextoEditorPanel({
  datos,
  diagramacion,
  diagramacionGraficos,
  seleccion,
  onSeleccion,
  onPatchDatos,
  onPatchDiagramacion,
  onPatchGraficos,
  soloLectura = false,
  camposPresentes,
  graficosPresentes = [],
  onCompletarFicha,
  fichaPendiente = false,
  fichaMsg,
}: Props) {
  const campoId = seleccion ?? "b1";
  const esGrafico = esIdGrafico(campoId);
  const editorTexto = esGrafico ? undefined : editorTextoCampo(campoId as CampoDiagramacionId);
  const cfg = esGrafico ? undefined : diagramacion?.[campoId as CampoDiagramacionId];
  const cfgGrafico = esGrafico ? diagramacionGraficos?.[campoId] : undefined;
  const escala = esGrafico ? 1 : escalaEfectiva(diagramacion, campoId as CampoDiagramacionId);
  const b1Pct = b1AnchoPctEfectivo(diagramacion, datos.b1_ancho_pct);

  function patchCampo(p: Parameters<typeof patchCampoToolbar>[2]) {
    if (soloLectura) return;
    if (esGrafico) {
      onPatchGraficos?.(
        patchDiagramacionGraficos(diagramacionGraficos, campoId, { x: p.x, y: p.y }),
      );
      return;
    }
    onPatchDiagramacion(patchCampoToolbar(diagramacion, campoId as CampoDiagramacionId, p));
    if (p.ancho_pct != null) onPatchDatos({ b1_ancho_pct: p.ancho_pct });
  }

  const camposPorZona = ZONAS.map((zona) => ({
    zona,
    items: CAMPOS_DIAGRAMACION.filter((c) => c.zona === zona),
  }));

  return (
    <aside className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface-panel">
      <div className="border-b border-border bg-surface px-3 py-2">
        <h3 className="text-sm font-bold text-ink">Editor de textos</h3>
        <p className="text-[10px] text-muted">Arrastra en la etiqueta o elige un bloque aquí</p>
      </div>

      <div className="border-b border-border p-2">
        <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-wide text-muted">Bloques</p>
        <div className="max-h-[11rem] space-y-2 overflow-y-auto">
          {camposPorZona.map(({ zona, items }) =>
            items.length > 0 ? (
              <div key={zona}>
                <p className="mb-0.5 px-1 text-[9px] font-semibold text-muted">{zona}</p>
                <ul className="space-y-0.5">
                  {items.map((def) => {
                    const ausente = camposPresentes ? !camposPresentes.has(def.id) : false;
                    const activo = seleccion === def.id;
                    return (
                      <li key={def.id}>
                        <button
                          type="button"
                          onClick={() => onSeleccion(def.id)}
                          className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs transition ${
                            activo
                              ? "bg-accent/15 font-semibold text-accent"
                              : ausente
                                ? "text-muted/50 hover:bg-surface-hover"
                                : "text-ink hover:bg-surface-hover"
                          }`}
                        >
                          <span className="truncate">{def.label}</span>
                          {ausente ? (
                            <span className="shrink-0 text-[9px] text-muted">—</span>
                          ) : activo ? (
                            <span className="shrink-0 text-[9px]">●</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null,
          )}
        </div>
        {graficosPresentes.length > 0 && (
          <div className="mt-2 border-t border-border pt-2">
            <p className="mb-1 px-1 text-[9px] font-semibold text-muted">Líneas y recuadros</p>
            <ul className="space-y-0.5">
              {graficosPresentes.map((gid) => {
                const activo = seleccion === gid;
                return (
                  <li key={gid}>
                    <button
                      type="button"
                      onClick={() => onSeleccion(gid)}
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs transition ${
                        activo
                          ? "bg-violet-500/15 font-semibold text-violet-700"
                          : "text-ink hover:bg-surface-hover"
                      }`}
                    >
                      <span>{labelElementoEditor(gid)}</span>
                      {activo ? <span className="text-[9px]">●</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {soloLectura && (
          <p className="rounded-lg bg-blue-50 px-2 py-1.5 text-[10px] text-blue-800">
            Versión original (solo lectura). Usa «Alternativa» para editar.
          </p>
        )}

        <section className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-ink">
              {esGrafico ? labelElementoEditor(campoId) : `Contenido · ${labelCampoDiagramacion(campoId as CampoDiagramacionId)}`}
            </span>
            {!esGrafico && campoId === "b1" && !soloLectura && onCompletarFicha && (
              <button
                type="button"
                disabled={fichaPendiente}
                onClick={onCompletarFicha}
                className="rounded border border-blue-300 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-800 disabled:opacity-50"
              >
                {fichaPendiente ? "…" : "Desde ficha"}
              </button>
            )}
          </div>
          {fichaMsg && campoId === "b1" && (
            <p className="text-[10px] text-blue-700">{fichaMsg}</p>
          )}
          {esGrafico ? (
            <p className="text-xs text-muted">
              Arrastra la línea o el recuadro en la etiqueta, o ajusta X/Y abajo.
            </p>
          ) : editorTexto ? (
            <>
              {editorTexto.hint && (
                <p className="text-[10px] leading-snug text-muted">{editorTexto.hint}</p>
              )}
              {editorTexto.multiline ? (
                <textarea
                  value={editorTexto.getTexto(datos)}
                  onChange={(e) => onPatchDatos(editorTexto.patchTexto(e.target.value, datos))}
                  readOnly={soloLectura || editorTexto.readonly}
                  rows={editorTexto.filas ?? 4}
                  className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[13px] leading-relaxed focus:border-accent focus:outline-none disabled:opacity-70"
                  spellCheck={false}
                />
              ) : (
                <input
                  type="text"
                  value={editorTexto.getTexto(datos)}
                  onChange={(e) => onPatchDatos(editorTexto.patchTexto(e.target.value, datos))}
                  readOnly={soloLectura || editorTexto.readonly}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:opacity-70"
                />
              )}
            </>
          ) : (
            <p className="text-xs text-muted">Este bloque no tiene campo de texto editable.</p>
          )}
        </section>

        {!esGrafico && (
        <section className="space-y-2 rounded-lg border border-border bg-surface p-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Tipografía</p>
          <EtiquetaTextoToolbar
            campoId={soloLectura ? null : (campoId as CampoDiagramacionId)}
            cfg={cfg}
            colorFallback="#000000"
            escala={escala}
            b1AnchoPct={campoId === "b1" ? b1Pct : undefined}
            tx={cfg?.x ?? 0}
            ty={cfg?.y ?? 0}
            onPatch={patchCampo}
          />
          {!soloLectura && (
            <button
              type="button"
              onClick={() => {
                const next = { ...(diagramacion ?? {}) };
                delete next[campoId as CampoDiagramacionId];
                onPatchDiagramacion(next);
              }}
              className="w-full rounded-lg border border-border py-1.5 text-[10px] font-semibold text-ink-secondary hover:bg-surface-hover"
            >
              Restablecer estilo del bloque
            </button>
          )}
        </section>
        )}

        {esGrafico && (
          <section className="space-y-2 rounded-lg border border-border bg-surface p-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Posición</p>
            <EtiquetaTextoToolbar
              campoId={null}
              cfg={undefined}
              colorFallback="#64748b"
              escala={1}
              tx={cfgGrafico?.x ?? 0}
              ty={cfgGrafico?.y ?? 0}
              onPatch={patchCampo}
              soloPosicion
            />
            {!soloLectura && onPatchGraficos && (
              <button
                type="button"
                onClick={() => {
                  const next = { ...(diagramacionGraficos ?? {}) };
                  delete next[campoId];
                  onPatchGraficos(next);
                }}
                className="w-full rounded-lg border border-border py-1.5 text-[10px] font-semibold text-ink-secondary hover:bg-surface-hover"
              >
                Restablecer posición
              </button>
            )}
          </section>
        )}

        {campoId === "subtitulo" && !soloLectura && (
          <section className="space-y-2 rounded-lg border border-border bg-surface p-2 text-xs">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Perfil normativo</p>
            <select
              className="w-full rounded-lg border border-border bg-surface-panel px-2 py-1.5 text-sm"
              value={datos.perfil}
              onChange={(e) => {
                const perfil = e.target.value as EtiquetaStudioDatos["perfil"];
                onPatchDatos({ perfil, subtitulo: subtituloAlternativo(perfil) });
              }}
            >
              <option value="materia_prima_alimentaria">Materia prima alimentaria</option>
              <option value="insumo_cosmetico">Insumo cosmético</option>
              <option value="insumo_tecnico">Insumo técnico</option>
            </select>
          </section>
        )}

        {campoId === "b1" && !soloLectura && (
          <details className="rounded-lg border border-border p-2 text-xs">
            <summary className="cursor-pointer font-semibold text-ink-secondary">
              Visibilidad en etiqueta MeLi
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(
                [
                  ["mostrar_formula_molecular", "Fórmula"],
                  ["mostrar_cas", "CAS"],
                  ["mostrar_concentracion", "Concentración"],
                  ["mostrar_bloque_legal", "Legal"],
                  ["mostrar_res_2674", "Art. 37-3"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={!!datos[key]}
                    onChange={(e) => onPatchDatos({ [key]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
            </div>
          </details>
        )}
      </div>
    </aside>
  );
}
