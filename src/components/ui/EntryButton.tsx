import type { ReactNode } from "react";

interface Props {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  onClick: () => void;
}

export default function EntryButton({ icon, title, subtitle, badge, onClick }: Props) {
  return (
    <button
      type="button"
      data-slot="button"
      onClick={onClick}
      className="w-full flex items-center gap-2 text-left bg-raised hover:bg-raised-hover border border-line hover:border-line-strong rounded-lg px-2.5 py-2 transition-colors"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand-text">
        {icon}
      </div>
      <div className="flex-1 min-w-0 leading-tight">
        <div className="text-sm font-semibold text-fg truncate">{title}</div>
        {subtitle && (
          <div className="text-[11px] text-fg-muted truncate mt-0.5">{subtitle}</div>
        )}
      </div>
      {badge && <div className="shrink-0">{badge}</div>}
    </button>
  );
}
