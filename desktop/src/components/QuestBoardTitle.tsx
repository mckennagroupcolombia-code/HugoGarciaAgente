import { useState, useEffect, useRef } from "react";
import { Icon } from "../icons";
import { useQuestBoardTitle, QUEST_BOARD_TITLE_DEFAULT } from "../stores/questBoard";

/** Título principal del tablero (Montserrat). Clic para editar si `editable`. */
export function QuestBoardTitle({
  editable = false,
  className = "",
}: {
  editable?: boolean;
  className?: string;
}) {
  const title = useQuestBoardTitle((s) => s.title);
  const setTitle = useQuestBoardTitle((s) => s.setTitle);
  const resetTitle = useQuestBoardTitle((s) => s.resetTitle);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(title);
  }, [title]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function cancel() {
    setDraft(title);
    setEditing(false);
  }

  function save() {
    setTitle(draft);
    setEditing(false);
  }

  if (editing && editable) {
    return (
      <div className={`quest-board-title-edit-wrap ${className}`}>
        <input
          ref={inputRef}
          type="text"
          className="quest-board-kimdom-title quest-board-kimdom-title--edit font-sans"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") cancel();
          }}
          maxLength={40}
          aria-label="Nombre del tablero"
        />
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={save}
            className="rounded-paper border-2 border-accent bg-accent px-3 py-1 text-[10px] font-bold text-white shadow-[0_2px_0_#045159] hover:bg-accent-hover"
          >
            Guardar
          </button>
          <button
            type="button"
            onClick={cancel}
            className="rounded-paper border-2 border-border px-3 py-1 text-[10px] font-bold text-muted hover:bg-surface-hover"
          >
            Cancelar
          </button>
          {draft.trim() !== QUEST_BOARD_TITLE_DEFAULT && (
            <button
              type="button"
              onClick={() => {
                resetTitle();
                setEditing(false);
              }}
              className="text-[10px] font-bold text-muted underline hover:text-accent"
            >
              Restaurar {QUEST_BOARD_TITLE_DEFAULT}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <h1
      className={`quest-board-kimdom-title font-sans ${editable ? "quest-board-kimdom-title--editable" : ""} ${className}`.trim()}
      onClick={editable ? () => setEditing(true) : undefined}
      onKeyDown={
        editable
          ? (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setEditing(true);
            }
          }
          : undefined
      }
      role={editable ? "button" : undefined}
      tabIndex={editable ? 0 : undefined}
      title={editable ? "Clic para editar el nombre del tablero" : undefined}
    >
      {title}
      {editable && (
        <span className="quest-board-kimdom-edit-hint inline-flex align-middle" aria-hidden>
          <Icon name="pencil" size={14} weight="bold" />
        </span>
      )}
    </h1>
  );
}

/** Etiqueta corta para botones de navegación (📜 Nombre). */
export function QuestBoardNavLabel({ prefix = true }: { prefix?: boolean }) {
  const title = useQuestBoardTitle((s) => s.title);
  return (
    <span className="inline-flex max-w-[10rem] items-center gap-1 truncate align-middle" title={title}>
      {prefix ? <Icon name="scroll" size={14} weight="regular" className="shrink-0" /> : null}
      {title}
    </span>
  );
}

/** Texto «← Nombre» para volver al tablero. */
export function QuestBoardBackLabel() {
  const title = useQuestBoardTitle((s) => s.title);
  return <>← {title}</>;
}
