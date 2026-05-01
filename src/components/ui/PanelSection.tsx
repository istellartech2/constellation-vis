import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface Props {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  action?: ReactNode;
}

export default function PanelSection({
  title,
  icon,
  children,
  collapsible = false,
  defaultOpen = true,
  action,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = collapsible ? open : true;

  const headerInner = (
    <>
      <div className="flex items-center gap-1.5 min-w-0">
        {icon && (
          <span className="text-orange-300 shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
            {icon}
          </span>
        )}
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-200 truncate">
          {title}
        </span>
      </div>
      {collapsible && (
        <ChevronDown
          className={`h-3.5 w-3.5 text-gray-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      )}
    </>
  );

  return (
    <section className="panel-section">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((p) => !p)}
            aria-expanded={open}
            className="flex-1 flex items-center justify-between gap-2 text-left bg-transparent border-0 p-0 hover:opacity-80 transition-opacity"
          >
            {headerInner}
          </button>
        ) : (
          <div className="flex-1 flex items-center justify-between gap-2">
            {headerInner}
          </div>
        )}
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {isOpen && <div className="space-y-1.5">{children}</div>}
    </section>
  );
}
