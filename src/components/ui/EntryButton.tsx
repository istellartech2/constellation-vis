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
      className="w-full flex items-center gap-2 text-left bg-gray-700/70 hover:bg-gray-600 active:bg-gray-600/80 border-2 border-gray-500 hover:border-orange-400 rounded-lg px-2 py-1.5 transition-colors shadow-sm"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-800 text-orange-300 border border-gray-600">
        {icon}
      </div>
      <div className="flex-1 min-w-0 leading-tight">
        <div className="text-sm font-semibold text-white truncate">{title}</div>
        {subtitle && (
          <div className="text-[11px] text-gray-400 truncate mt-0.5">{subtitle}</div>
        )}
      </div>
      {badge && <div className="shrink-0">{badge}</div>}
    </button>
  );
}
