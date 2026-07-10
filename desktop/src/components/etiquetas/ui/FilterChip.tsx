interface FilterChipProps {
  label: string;
  active?: boolean;
  onClick: () => void;
  count?: number;
}

export function FilterChip({ label, active, onClick, count }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mck-press inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
        active
          ? "border-accent bg-accent/10 text-accent ring-2 ring-accent/20"
          : "border-border bg-surface text-muted hover:border-accent/40 hover:text-ink"
      }`}
    >
      {label}
      {count !== undefined && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
            active ? "bg-accent/20" : "bg-surface-hover"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
