import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { Loader2 } from "lucide-react";
import { CELESTRAK_GROUP_TREE, type CelestrakGroupNode } from "../../utils/celestrakUtils";

interface ImportDialogProps {
  open: boolean;
  importing: boolean;
  selectedGroups: string[];
  onToggleGroup: (group: string) => void;
  onImport: () => void;
  onClose: () => void;
}

interface FlatLeaf {
  id: string;
  label: string;
}

interface FlatCategory {
  id: string;
  label: string;
  leaves: FlatLeaf[];
}

function flatten(tree: readonly CelestrakGroupNode[]): FlatCategory[] {
  return tree.map((node) => {
    const leaves = node.children?.map((c) => ({ id: c.id, label: c.label })) ?? [
      { id: node.id, label: node.label },
    ];
    return { id: node.id, label: node.label, leaves };
  });
}

function GroupRow({
  leaf,
  checked,
  disabled,
  onToggle,
}: {
  leaf: FlatLeaf;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={`flex items-center gap-2 min-h-[36px] px-2 py-1 rounded-md border cursor-pointer transition-colors select-none ${
        checked
          ? "border-brand bg-brand-soft"
          : "border-line bg-raised hover:bg-raised-hover hover:border-line-strong"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={() => onToggle()}
        className="size-4 shrink-0"
      />
      <span className="text-sm text-fg flex-1 leading-snug">{leaf.label}</span>
    </label>
  );
}

export default function ImportDialog({
  open,
  importing,
  selectedGroups,
  onToggleGroup,
  onImport,
  onClose,
}: ImportDialogProps) {
  const categories = useMemo(() => flatten(CELESTRAK_GROUP_TREE), []);
  const selectedSet = new Set(selectedGroups);
  const totalLeaves = categories.reduce((acc, c) => acc + c.leaves.length, 0);

  const handleClearAll = () => {
    for (const id of selectedGroups) onToggleGroup(id);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="!w-[95vw] !max-w-2xl !max-h-[90vh] flex flex-col gap-0 p-0 bg-surface-solid text-fg border-line">
        <DialogHeader className="px-4 pt-3 pb-2 border-b border-line">
          <div className="flex items-baseline justify-between gap-3">
            <DialogTitle className="text-fg text-base">
              CelesTrak からインポート
            </DialogTitle>
            <div className="text-xs text-fg-muted shrink-0">
              選択中{" "}
              <span className="text-brand-text font-semibold">
                {selectedGroups.length}
              </span>{" "}
              / {totalLeaves}
              {selectedGroups.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAll}
                  disabled={importing}
                  className="ml-3 text-fg-muted hover:text-brand-text disabled:opacity-50"
                >
                  クリア
                </button>
              )}
            </div>
          </div>
          <DialogDescription className="sr-only">
            読み込みたい衛星グループを選択してください。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
          {categories.map((cat) => {
            const selectedCount = cat.leaves.filter((l) => selectedSet.has(l.id)).length;
            return (
              <section key={cat.id}>
                <div className="flex items-baseline gap-1.5 text-sm font-semibold text-fg mb-1.5">
                  <span>{cat.label}</span>
                  <span className="text-xs font-normal text-fg-muted">
                    ({selectedCount}/{cat.leaves.length})
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {cat.leaves.map((leaf) => (
                    <GroupRow
                      key={leaf.id}
                      leaf={leaf}
                      checked={selectedSet.has(leaf.id)}
                      disabled={importing}
                      onToggle={() => onToggleGroup(leaf.id)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        <DialogFooter className="px-4 py-3 border-t border-line gap-2 sm:gap-3 flex-col-reverse sm:flex-row">
          {importing ? (
            <div className="flex items-center justify-center w-full h-10">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              <span className="text-sm">読み込み中…</span>
            </div>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={onClose}
                className="h-10 w-full sm:w-auto bg-sunken border-line-strong text-fg hover:bg-raised-hover hover:text-fg"
              >
                キャンセル
              </Button>
              <Button
                onClick={onImport}
                disabled={selectedGroups.length === 0}
                className="h-10 w-full sm:w-auto sm:flex-1 bg-brand hover:bg-brand-hover text-white font-semibold disabled:opacity-50"
              >
                {selectedGroups.length === 0
                  ? "グループを選択してください"
                  : `${selectedGroups.length} 件をインポート`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
