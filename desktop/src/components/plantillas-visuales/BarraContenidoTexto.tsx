import type { RefObject } from "react";
import { esTextoDescripcionMpEstructurado } from "../../lib/descripcionMpTexto";
import {
  contextoCapasParaDescripcion,
  esCapaDescripcionMateriaPrima,
  inferirRolTextoCapa,
  type ElementoTexto,
  type ElementoVisual,
  type RolTextoCapa,
} from "../../lib/plantillasVisuales";
import EditorDescripcionMp, { ContenidoTextoSimple } from "./EditorDescripcionMp";
import SugerenciasTextoMagico from "./SugerenciasTextoMagico";
import TextosRapidos from "./TextosRapidos";

interface Props {
  elementos: ElementoVisual[];
  seleccionado: ElementoTexto | null;
  seleccionId: string | null;
  nombrePlantilla: string;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  casAutoEstado: "idle" | "cargando" | "error";
  onSeleccionar: (id: string) => void;
  onCasAuto: () => void;
  onPatchRol: (rol: RolTextoCapa) => void;
  onLiveChange: (valor: string) => void;
  onCommit: (valor: string) => void;
  onEstructuradoChange: (texto: string) => void;
  onMagico: (texto: string) => void;
}

/**
 * Caja bajo el lienzo (fondo claro, texto oscuro): selector de capas de texto
 * + editor del seleccionado.
 */
export default function BarraContenidoTexto({
  elementos,
  seleccionado,
  seleccionId,
  nombrePlantilla,
  textareaRef,
  casAutoEstado,
  onSeleccionar,
  onCasAuto,
  onPatchRol,
  onLiveChange,
  onCommit,
  onEstructuradoChange,
  onMagico,
}: Props) {
  const rolTexto = seleccionado
    ? inferirRolTextoCapa(seleccionado, elementos)
    : null;
  const rol = (seleccionado?.textRole ?? rolTexto ?? "otro") as RolTextoCapa;
  const esDescripcionMP = seleccionado
    ? esCapaDescripcionMateriaPrima(seleccionado, elementos)
    : false;
  const usarEstructurado =
    !!seleccionado &&
    (esDescripcionMP || esTextoDescripcionMpEstructurado(seleccionado.content || ""));
  const contextoCapas = seleccionado
    ? contextoCapasParaDescripcion(elementos, seleccionado.id, nombrePlantilla)
    : { titulo: "", subtitulo: "" };
  const esCapaCas = /^\s*#?\s*cas\b/i.test(seleccionado?.content || "");
  const fragmentoTextoMagico = (contextoCapas.titulo || seleccionado?.content || "").trim();
  const esCorto = rol === "titulo" || rol === "subtitulo" || esCapaCas;

  return (
    <div className="shrink-0 border-t border-neutral-300 bg-[#f4f4f2] px-3 py-2.5 text-neutral-900 shadow-[0_-4px_16px_rgba(0,0,0,0.18)]">
      <div className="mb-2 flex flex-wrap items-start gap-3">
        <div className="max-h-24 min-w-0 flex-1 overflow-y-auto pr-1">
          <TextosRapidos
            elementos={elementos}
            seleccionId={seleccionId}
            onSeleccionar={onSeleccionar}
            variante="barra"
          />
        </div>
        {seleccionado && (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 pt-0.5">
            <select
              value={rol}
              onChange={(e) => onPatchRol(e.target.value as RolTextoCapa)}
              className="rounded border border-neutral-300 bg-white px-1.5 py-1 text-[11px] font-medium text-neutral-800"
              title="Rol de esta capa"
            >
              <option value="descripcion">Descripción MP</option>
              <option value="titulo">Título</option>
              <option value="subtitulo">Subtítulo</option>
              <option value="otro">Otro</option>
            </select>
            {esCapaCas ? (
              <button
                type="button"
                disabled={!contextoCapas.titulo || casAutoEstado === "cargando"}
                onClick={onCasAuto}
                className="rounded border border-neutral-300 bg-white px-2 py-1 text-[11px] font-medium text-neutral-800 hover:bg-neutral-100 disabled:opacity-50"
              >
                {casAutoEstado === "cargando" ? "Buscando CAS…" : "Asociar CAS"}
              </button>
            ) : (
              <SugerenciasTextoMagico
                compact
                fragmento={fragmentoTextoMagico}
                modoDescripcionMateriaPrima={esDescripcionMP}
                contextoCapas={contextoCapas}
                onElegir={onMagico}
              />
            )}
          </div>
        )}
      </div>

      {!seleccionado ? (
        <p className="rounded-lg border border-dashed border-neutral-300 bg-white/80 px-3 py-3 text-sm text-neutral-600">
          Elige un texto arriba para editarlo aquí.
        </p>
      ) : usarEstructurado ? (
        <EditorDescripcionMp
          value={seleccionado.content || ""}
          layout="barra"
          onChange={onEstructuradoChange}
          textareaRef={textareaRef}
          onPlainChange={(valor) => onLiveChange(valor)}
          onPlainBlur={(valor) => onCommit(valor)}
        />
      ) : (
        <ContenidoTextoSimple
          key={seleccionado.id}
          value={seleccionado.content || ""}
          compactLabel
          short={esCorto}
          contrasteFuerte
          textareaRef={textareaRef}
          onLiveChange={onLiveChange}
          onCommit={onCommit}
        />
      )}
      {casAutoEstado === "error" && esCapaCas && (
        <p className="mt-1 text-[11px] font-medium text-red-700">
          No se encontró CAS para «{contextoCapas.titulo}»
        </p>
      )}
    </div>
  );
}
