import type { ComponentProps, ReactNode } from "react";
import { AlertCircle, Check } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./dialog";
import { Button } from "./button";
import { cn } from "../../lib/utils";

interface ShellProps {
  open: boolean;
  onClose: () => void;
  icon: ReactNode;
  title: string;
  description: string;
  /** Leading control in the title row, e.g. a back button for a sub-view. */
  leading?: ReactNode;
  onEscapeKeyDown?: ComponentProps<typeof DialogContent>["onEscapeKeyDown"];
  children: ReactNode;
  /** Omit to hide the footer (e.g. while a sub-view owns the dialog). */
  footer?: ReactNode;
}

/**
 * Frame shared by the satellite, constellation and ground station editors:
 * the same size, header, body and footer so the three read as one tool.
 */
export default function EditorDialogShell({ open, onClose, icon, title, description, leading, onEscapeKeyDown, children, footer }: ShellProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        className="!w-[94vw] !max-w-7xl h-[90dvh] max-h-[90dvh] overflow-hidden max-md:overflow-hidden max-md:h-[100dvh] max-md:rounded-none max-md:border-0 flex flex-col gap-3 bg-surface-solid text-fg"
        onEscapeKeyDown={onEscapeKeyDown}
      >
        <DialogHeader className="max-md:pr-10">
          <DialogTitle className="flex items-center gap-2 text-fg">
            {leading}
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand-text [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
            <span>{title}</span>
          </DialogTitle>
          <DialogDescription className="text-left text-xs text-fg-muted">{description}</DialogDescription>
        </DialogHeader>
        {children}
        {footer}
      </DialogContent>
    </Dialog>
  );
}

/** Two-pane body: item list on the left, the selected item's editor on the right. */
export function EditorSplitBody({ list, children }: { list: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-line-strong max-md:overflow-y-auto max-md:overscroll-contain md:flex-row">
      <div className="shrink-0 border-line-strong bg-surface-solid max-md:border-b md:w-64 md:border-r">{list}</div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-raised max-md:flex-none">{children}</div>
    </div>
  );
}

interface DetailProps {
  /** null when nothing is selected. */
  title: string | null;
  badge?: ReactNode;
  summary?: string;
  /** Shown instead of the editor when nothing is selected. */
  emptyText: string;
  /** false when the child manages its own scrolling. */
  scroll?: boolean;
  children?: ReactNode;
}

/** Right pane: a header naming the selected item, then its form. */
export function EditorDetailPane({ title, badge, summary, emptyText, scroll = true, children }: DetailProps) {
  if (title === null) {
    return <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-fg-muted">{emptyText}</div>;
  }
  return (
    <>
      <div className="shrink-0 border-b border-line px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-base font-semibold text-fg">{title}</h3>
          {badge}
        </div>
        {summary && <p className="mt-0.5 text-xs text-fg-muted">{summary}</p>}
      </div>
      <div className={cn("flex min-h-0 flex-1 flex-col", scroll && "overflow-y-auto max-md:overflow-visible")}>{children}</div>
    </>
  );
}

interface FooterProps {
  /** Blocking problems; the first one is shown and applying is disabled. */
  errors: string[];
  onCancel: () => void;
  onApply: () => void;
}

/** Cancel / 「保存して 3D ビューに反映」 with the validation state on the left. */
export function EditorDialogFooter({ errors, onCancel, onApply }: FooterProps) {
  const blocked = errors.length > 0;
  return (
    <DialogFooter className="shrink-0 border-t border-line pt-3 sm:items-center max-md:flex-row max-md:flex-wrap max-md:gap-2">
      <p role={blocked ? "alert" : undefined} className={cn("flex min-w-0 items-start gap-1.5 text-xs sm:mr-auto max-md:basis-full", blocked ? "text-danger" : "text-fg-muted")}>
        {blocked && <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />}
        <span className="min-w-0">
          {blocked
            ? `入力エラー ${errors.length} 件: ${errors[0]}`
            : "保存するとすぐに 3D ビューへ反映します。"}
        </span>
      </p>
      <Button variant="outline" onClick={onCancel} className="border-line-strong bg-raised text-fg hover:bg-raised-hover max-md:h-11 max-md:flex-1">
        キャンセル
      </Button>
      <Button onClick={onApply} disabled={blocked} className="gap-1.5 bg-brand text-brand-fg hover:bg-brand-hover disabled:opacity-50 max-md:h-11 max-md:flex-1">
        <Check className="h-4 w-4" />
        保存して反映
      </Button>
    </DialogFooter>
  );
}
