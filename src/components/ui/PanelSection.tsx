import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface Props {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  action?: ReactNode;
  /** Controlled open state (collapsible sections); omit for the internal state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Element id (scroll anchor). */
  id?: string;
}

export default function PanelSection({
  title,
  icon,
  children,
  collapsible = false,
  defaultOpen = true,
  action,
  open: openProp,
  onOpenChange,
  id,
}: Props) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const setOpen = (update: (p: boolean) => boolean) => {
    const next = update(open);
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };
  const isOpen = collapsible ? open : true;

  const headerInner = (
    <>
      <div className="flex items-center gap-1.5 min-w-0">
        {icon && (
          <span className="text-fg-subtle shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
            {icon}
          </span>
        )}
        <span className="text-[13px] font-semibold text-fg truncate">
          {title}
        </span>
      </div>
      {collapsible && (
        <ChevronDown
          className={`h-3.5 w-3.5 text-fg-muted transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      )}
    </>
  );

  return (
    <section className="panel-section" id={id}>
      <div className="flex items-center justify-between gap-2 mb-2">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((p) => !p)}
            aria-expanded={open}
            data-slot="button"
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
