import EditableField from "./EditableField";

/** Círculo blanco con borde naranja grueso — estado GHS. */
export default function GhsBadge({
  value,
  onChange,
  editMode,
}: {
  value: string;
  onChange: (v: string) => void;
  editMode: boolean;
}) {
  return (
    <div className="flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-full border-[3.5px] border-[#FFA500] bg-white p-1.5">
      <EditableField
        value={value}
        onChange={onChange}
        editMode={editMode}
        multiline
        styleKey="ghs"
        defaultFontSize={14}
        className="text-center font-extrabold leading-[1.05] uppercase text-[#FFA500]"
      />
    </div>
  );
}
