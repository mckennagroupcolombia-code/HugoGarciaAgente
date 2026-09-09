import EditableField, { EditableLabel } from "./EditableField";

/** Bloque "Información técnica" — documentos (TDS/COA) + banda con la URL. */
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
        className="font-bold text-[#FFA500]"
      />
      <EditableField
        value={technicalDocuments}
        onChange={onTechnicalDocumentsChange}
        editMode={editMode}
        styleKey="technicalDocuments"
        defaultFontSize={14}
        className="mt-[6px] block text-center font-semibold text-[#FFA500]"
      />
      <p className="mt-[14px] text-[14px] font-medium text-[#111111]">Disponible en:</p>
      <div className="mx-auto mt-[6px] flex h-[36px] w-[88%] items-center justify-center rounded-[3px] bg-[#FFA500] px-3">
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
