/** Tokens visuales del workspace Studio (estilo Illustrator). */
export const studio = {
  workspace: "bg-[#2e2e2e] text-neutral-100",
  toolbar: "bg-[#383838] border-white/[0.08]",
  topbar: "bg-[#333333] border-white/[0.08]",
  canvasBg: "bg-[#505050]",
  panel: "bg-surface-panel text-ink border-border",
  toolBtn:
    "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-300 transition hover:bg-white/10 hover:text-white data-[active=true]:bg-white/15 data-[active=true]:text-white",
  toolBtnDanger:
    "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-red-400 transition hover:bg-red-500/20 hover:text-red-300",
  sep: "bg-white/10",
  field:
    "w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-accent/50",
  tabActive: "border-b-2 border-accent text-ink font-semibold",
  tabIdle: "border-b-2 border-transparent text-muted hover:text-ink-secondary",
} as const;
