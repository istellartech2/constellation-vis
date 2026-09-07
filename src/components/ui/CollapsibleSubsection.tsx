import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface Props {
  title: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  children: ReactNode;
  badge?: ReactNode;
  className?: string;
}

/**
 * Collapsible section styled after the RGT panel in ConstellationShellForm.
 * Works both controlled (`open`/`onOpenChange`) and uncontrolled
 * (`defaultOpen`) — falls back to internal state when `open` is omitted.
 */
export default function CollapsibleSubsection({
  title,
  defaultOpen = false,
  open,
  onOpenChange,
  children,
  badge,
  className,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = open ?? internalOpen;

  const toggle = () => {
    const next = !isOpen;
    if (onOpenChange) {
      onOpenChange(next);
    } else {
      setInternalOpen(next);
    }
  };

  return (
    <div className={className ?? "space-y-1"}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between text-xs font-medium text-gray-400 border border-gray-700 rounded px-2 py-2 bg-gray-850 hover:bg-gray-800"
      >
        <span className="inline-flex items-center gap-2">
          <span>{title}</span>
          {badge}
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="mt-2 rounded border border-gray-800 bg-gray-900/40 p-3 space-y-2">
          {children}
        </div>
      )}
    </div>
  );
}
