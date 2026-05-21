import { useQuestTheme } from "../stores/questTheme";

export default function QuestThemeToggle({ className = "" }: { className?: string }) {
  const dark = useQuestTheme((s) => s.dark);
  const toggle = useQuestTheme((s) => s.toggle);

  return (
    <button
      type="button"
      onClick={toggle}
      title={dark ? "Modo claro" : "Modo oscuro (quests)"}
      aria-pressed={dark}
      className={`
        flex items-center gap-1.5 rounded-paper border-2 border-border px-3 py-1.5
        text-xs font-bold text-muted transition
        hover:border-accent hover:text-accent hover:bg-surface-hover
        ${className}
      `}
    >
      {dark ? (
        <>
          <svg className="h-4 w-4 text-accent-sun" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 00-.75-.75h-2.25a.75.75 0 000 1.5H21a.75.75 0 00.75-.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-2.25A.75.75 0 0112 18zM7.758 17.303a.75.75 0 00-1.061-1.06l-1.591 1.59a.75.75 0 001.06 1.061l1.591-1.59zM6 12a.75.75 0 01-.75.75H3a.75.75 0 010-1.5h2.25A.75.75 0 016 12zM6.697 7.757a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 00-1.061 1.06l1.59 1.591z" />
          </svg>
          Claro
        </>
      ) : (
        <>
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
          </svg>
          Oscuro
        </>
      )}
    </button>
  );
}
