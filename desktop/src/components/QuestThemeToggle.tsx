import { useQuestTheme } from "../stores/questTheme";
import { questNavBtn } from "../lib/questStyles";
import { Icon } from "../icons";

export default function QuestThemeToggle({ className = "" }: { className?: string }) {
  const dark = useQuestTheme((s) => s.dark);
  const toggle = useQuestTheme((s) => s.toggle);

  return (
    <button
      type="button"
      onClick={toggle}
      title={dark ? "Modo claro" : "Modo oscuro (quests)"}
      aria-pressed={dark}
      className={`${questNavBtn(false)} ${className}`.trim()}
    >
      {dark ? (
        <>
          <Icon name="sun" size={16} weight="regular" />
          Claro
        </>
      ) : (
        <>
          <Icon name="moon" size={16} weight="regular" />
          Oscuro
        </>
      )}
    </button>
  );
}
