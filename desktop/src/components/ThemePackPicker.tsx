import { matchingThemePack, THEME_PACKS } from "../theme/presets";
import type { ThemePackId } from "../theme/types";
import { usePanelTheme } from "../stores/panelTheme";
import { useTicketsAuth } from "../stores/ticketsAuth";
import { flushSaveUserUiPreferences } from "../lib/userThemeSync";

export default function ThemePackPicker() {
  const skin = usePanelTheme((s) => s.skin);
  const activeCustomId = usePanelTheme((s) => s.activeCustomId);
  const applyPack = usePanelTheme((s) => s.applyPack);
  const token = useTicketsAuth((s) => s.token);
  const active = matchingThemePack({ skin, activeCustomId });

  return (
    <div>
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Variantes</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {THEME_PACKS.map((pack) => {
          const selected = active === pack.id;
          return (
            <button
              key={pack.id}
              type="button"
              onClick={() => {
                applyPack(pack.id);
                if (token) void flushSaveUserUiPreferences(token);
              }}
              aria-pressed={selected}
              className={`overflow-hidden rounded-xl border-2 p-2.5 text-left transition ${
                selected
                  ? "border-accent bg-accent/10 shadow-paper-sm"
                  : "border-border bg-surface-panel hover:border-border-strong hover:bg-surface-hover"
              }`}
            >
              <PackPreview id={pack.id} />
              <p className="mt-2 text-sm font-bold text-ink">{pack.label}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-muted">{pack.tagline}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PackPreview({ id }: { id: ThemePackId }) {
  if (id === "barbie") {
    return (
      <div className="relative flex h-14 items-end gap-1.5 overflow-hidden rounded-xl bg-gradient-to-br from-[#ffeaf4] via-[#fff8fc] to-[#ffd8ec] px-2.5 py-2 shadow-[0_6px_16px_rgba(255,126,182,0.28)] ring-2 ring-[#ffb0d4]">
        <span className="absolute right-2 top-1.5 h-2 w-2 rotate-45 bg-[#ffd56a]" />
        <span className="absolute right-5 top-3 h-1.5 w-1.5 rotate-45 bg-[#ff9ec8]" />
        <span className="h-7 flex-1 rounded-2xl bg-white/95 shadow-[0_3px_8px_rgba(255,126,182,0.2)]" />
        <span className="h-11 w-6 rounded-2xl bg-[#ff7eb6] shadow-[0_4px_0_#f0559a]" />
        <span className="h-6 flex-1 rounded-2xl bg-[#ffb6de]" />
      </div>
    );
  }
  if (id === "sakura") {
    return (
      <div className="flex h-14 items-end gap-1.5 rounded-xl bg-gradient-to-br from-[#ffe4ef] via-[#fff1e6] to-[#ffd9c4] px-2.5 py-2 shadow-[4px_4px_0_rgba(232,92,128,0.35)] ring-2 ring-[#f4bab0]">
        <span className="h-7 flex-1 rounded-lg bg-white/90 shadow-[2px_2px_0_#e85c80]" />
        <span className="h-11 w-6 rounded-lg bg-[#e85c80] shadow-[2px_2px_0_#c84068]" />
        <span className="h-6 flex-1 rounded-lg bg-[#ffc9a8]" />
      </div>
    );
  }
  return (
    <div className="flex h-14 items-end gap-1 rounded-lg bg-[#030803] px-2.5 py-2 ring-1 ring-[#00ff41]/40">
      <span className="h-5 flex-1 rounded-sm bg-[#00ff41]/20" />
      <span className="h-10 w-5 rounded-sm bg-[#00ff41] shadow-[0_0_10px_#00ff41]" />
      <span className="h-7 flex-1 rounded-sm bg-[#00ff41]/35" />
    </div>
  );
}
