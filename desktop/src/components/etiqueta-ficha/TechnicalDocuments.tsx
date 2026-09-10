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
}: {
  technicalDocuments: string;
  website: string;
  onTechnicalDocumentsChange: (v: string) => void;
  onWebsiteChange: (v: string) => void;
  editMode: boolean;
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
      <p className="mt-[14px] text-[14px] font-medium text-[#111111]">Disponible en:</p>
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
    </div>
  );
}
