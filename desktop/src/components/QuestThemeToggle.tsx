import { useQuestTheme } from "../stores/questTheme";
import { questNavBtn } from "../lib/questStyles";
import { Icon } from "../icons";

const SIDEBAR_BTN =
  "flex w-full items-center gap-3 rounded-paper border-2 border-transparent px-3 py-2.5 text-left text-sm font-semibold text-muted transition hover:border-border-strong hover:bg-surface-hover hover:text-ink";

export default function QuestThemeToggle({
  className = "",
  variant = "quest",
}: {
  className?: string;
  variant?: "quest" | "sidebar";
}) {
  const dark = useQuestTheme((s) => s.dark);
  const toggle = useQuestTheme((s) => s.toggle);
  const label = dark ? "Modo claro" : "Modo oscuro";
  const btnClass = variant === "sidebar" ? SIDEBAR_BTN : questNavBtn(false);

  return (
    <button
      type="button"
      onClick={toggle}
      title={dark ? "Modo claro" : "Modo oscuro (Centro de Mando)"}
      aria-pressed={dark}
      className={`${btnClass} ${className}`.trim()}
    >
      {dark ? (
        <>
          <Icon name="sun" size={20} weight="regular" className="shrink-0" />
          {variant === "sidebar" ? label : "Claro"}
        </>
      ) : (
        <>
          <Icon name="moon" size={20} weight="regular" className="shrink-0" />
          {variant === "sidebar" ? label : "Oscuro"}
        </>
      )}
    </button>
  );
}
