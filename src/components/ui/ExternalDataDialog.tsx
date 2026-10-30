import type { ReactNode } from "react";
import { FileText, FlaskConical, Globe, FileUp } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./dialog";
import { cn } from "../../lib/utils";
import type { FilingDataset } from "../../lib/filings/types";
import CelestrakPanel from "./import/CelestrakPanel";
import FilingPanel, { type PlacedFiling } from "./import/FilingPanel";
import FilePanel from "./import/FilePanel";
import SyntheticPanel from "./import/SyntheticPanel";
import { type ImportTargets } from "./import/importTargets";

export type ImportSource = "celestrak" | "itu" | "file" | "synthetic";

const SOURCES: { id: ImportSource; icon: ReactNode; label: string; caption: string }[] = [
  { id: "celestrak", icon: <Globe className="size-4" />, label: "CelesTrak", caption: "運用中の衛星" },
  { id: "itu", icon: <FileText className="size-4" />, label: "ITU申請", caption: "申請上の配置" },
  { id: "file", icon: <FileUp className="size-4" />, label: "TLE / OMM", caption: "手元のファイル" },
  { id: "synthetic", icon: <FlaskConical className="size-4" />, label: "合成", caption: "推定・負荷試験" },
];

interface Props {
  open: boolean;
  source: ImportSource;
  onSourceChange: (source: ImportSource) => void;
  targets: Omit<ImportTargets, "close">;
  onClose: () => void;
  placedFilings: Record<string, PlacedFiling>;
  onApplyFiling: (dataset: FilingDataset, configuration: string, epoch: Date) => void;
}

/**
 * One entry point for every external satellite source. Each source picks its
 * data, shows how many satellites it found, then offers the same two
 * destinations (simulation targets / display layer) and applies immediately.
 */
export default function ExternalDataDialog({ open, source, onSourceChange, targets, onClose, placedFilings, onApplyFiling }: Props) {
  const fullTargets: ImportTargets = { ...targets, close: onClose };
  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="dialog-flush !w-[95vw] !max-w-2xl !max-h-[90vh] md:h-[min(90vh,760px)] max-md:overflow-hidden max-md:h-[100dvh] max-md:rounded-none max-md:border-0 flex flex-col gap-0 p-0 bg-surface-solid text-fg border-line">
        <DialogHeader className="px-4 pt-3 pb-0 border-b border-line max-md:pr-12 shrink-0">
          <DialogTitle className="text-fg text-base max-md:text-left">外部データを追加</DialogTitle>
          <DialogDescription className="sr-only">衛星データの取得元を選びます</DialogDescription>
          <div role="tablist" aria-label="取得元" className="-mb-px mt-1 grid grid-cols-4">
            {SOURCES.map((s) => {
              const active = s.id === source;
              return (
                <button key={s.id} type="button" role="tab" aria-selected={active} onClick={() => onSourceChange(s.id)}
                  className={cn(
                    "flex flex-col items-center gap-0.5 border-b-2 px-1 pb-2 pt-1 text-center transition-colors",
                    active ? "border-brand text-fg" : "border-transparent text-fg-muted hover:text-fg",
                  )}>
                  <span className="flex items-center gap-1.5 whitespace-nowrap text-sm font-medium max-sm:text-xs"><span className="max-sm:hidden">{s.icon}</span>{s.label}</span>
                  <span className="text-[10px] text-fg-subtle max-sm:hidden">{s.caption}</span>
                </button>
              );
            })}
          </div>
        </DialogHeader>
        {/* Keyed by source so switching tabs resets each panel's transient state. */}
        {source === "celestrak" && <CelestrakPanel key="celestrak" targets={fullTargets} />}
        {source === "itu" && <FilingPanel key="itu" targets={fullTargets} placed={placedFilings} onApplyToScenario={onApplyFiling} />}
        {source === "file" && <FilePanel key="file" targets={fullTargets} />}
        {source === "synthetic" && <SyntheticPanel key="synthetic" targets={fullTargets} />}
      </DialogContent>
    </Dialog>
  );
}
