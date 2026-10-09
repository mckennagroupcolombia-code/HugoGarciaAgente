import EditableField, { EditableLabel } from "./EditableField";

/** Bloque "Información técnica" — documentos (TDS/COA) + banda con la URL.
 *  El campo de documentos es multilínea: si el operador agrega más texto
 *  ("TDS - COA - SDS…") el cuadro crece un renglón en vez de recortarse.
 *  La banda naranja de la web va a `w-full` (antes 88 %) para que sus
 *  bordes coincidan con los del cuadro Pureza/CAS que viene debajo. */
export default function TechnicalDocuments({
  technicalDocuments,
  website,
  onTechnicalDocumentsChange,
  onWebsiteChange,
  editMode,
  modoUso,
  onModoUsoChange,
}: {
  technicalDocuments: string;
  website: string;
  onTechnicalDocumentsChange: (v: string) => void;
  onWebsiteChange: (v: string) => void;
  editMode: boolean;
  /** Casilla «Modo de uso» bajo la banda de la web (plantilla Agro). Sin
   *  `onModoUsoChange` no se dibuja. */
  modoUso?: string;
  onModoUsoChange?: (v: string) => void;
}) {
  return (
    <div className="w-full text-center">
      <EditableLabel
        texto="Información técnica:"
        editMode={editMode}
        styleKey="technicalDocumentsTitulo"
        defaultFontSize={18}
        as="p"
        className="font-bold text-[color:var(--acento)]"
      />
      <EditableField
        value={technicalDocuments}
        onChange={onTechnicalDocumentsChange}
        editMode={editMode}
        multiline
        styleKey="technicalDocuments"
        defaultFontSize={14}
        className="mt-[6px] block whitespace-pre-line break-words text-center font-semibold text-[color:var(--acento)]"
      />
      <div className="mt-[14px]">
        <EditableLabel
          texto="Disponible en:"
          editMode={editMode}
          styleKey="disponibleEnTitulo"
          defaultFontSize={14}
          as="p"
          className="font-medium text-[#111111]"
        />
      </div>
      <div className="mt-[6px] flex h-[36px] w-full items-center justify-center rounded-[4px] bg-[color:var(--acento)] px-3">
        <EditableField
          value={website}
          onChange={onWebsiteChange}
          editMode={editMode}
          variant="dark"
          styleKey="website"
          defaultFontSize={14}
          className="w-full text-center font-bold text-white"
        />
      </div>
      {onModoUsoChange && (
        <div className="mt-[10px] w-full rounded-[4px] border-[1.5px] border-[color:var(--acento)] px-3 py-2 text-center">
          <EditableLabel
            texto="Modo de uso:"
            editMode={editMode}
            styleKey="modoUsoTitulo"
            defaultFontSize={14}
            as="p"
            className="font-bold text-[color:var(--acento)]"
          />
          <EditableField
            value={modoUso ?? ""}
            onChange={onModoUsoChange}
            editMode={editMode}
            multiline
            styleKey="modoUso"
            defaultFontSize={12}
            className="mt-[4px] block whitespace-pre-line break-words text-center text-[#111111]"
          />
        </div>
      )}
    </div>
  );
}
