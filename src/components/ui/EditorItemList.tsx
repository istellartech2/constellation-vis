import type { ReactNode } from "react";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { Button } from "./button";
import { cn } from "../../lib/utils";

export interface EditorListItem {
  id: string;
  title: string;
  /** One-line summary under the title (orbit, coordinates, …). */
  subtitle?: string;
  /** Kind chip shown at the right of the title. */
  badge?: ReactNode;
  issue?: "error" | "warning";
}

interface Props {
  /** Noun for the items, e.g. 「衛星」「シェル」「地上局」. */
  noun: string;
  items: EditorListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  onDelete: (id: string) => void;
  /** Ways to add an item, rendered above the list. */
  addActions: ReactNode;
}

/** Shared styling for the add buttons/selects in {@link Props.addActions}. */
export const listAddButtonClass =
  "w-full h-8 justify-center gap-1.5 text-xs bg-sunken hover:bg-raised-hover text-fg border-line-strong max-md:h-10";
export const listAddSelectClass =
  "w-full h-8 px-2 text-xs bg-sunken border border-line-strong rounded-md text-fg focus:border-brand focus:outline-none max-md:h-10 max-md:text-sm";

/** Small chip naming an item's kind; used by every editor's list and detail header. */
export function KindBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "info" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none whitespace-nowrap",
        tone === "info" ? "border-info/40 bg-info-soft text-info" : "border-line bg-sunken text-fg-muted",
      )}
    >
      {children}
    </span>
  );
}

/**
 * Left-hand item list shared by the satellite, constellation and ground
 * station editors: add actions on top, selectable rows, and move/delete for
 * the selected row at the bottom.
 */
export default function EditorItemList({ noun, items, selectedId, onSelect, onMove, onDelete, addActions }: Props) {
  const selectedIndex = items.findIndex((item) => item.id === selectedId);
  const toolButton = "h-8 w-8 max-md:h-10 max-md:w-10 bg-sunken hover:bg-raised-hover text-fg border-line-strong disabled:opacity-40";

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-1.5 border-b border-line-strong p-2">{addActions}</div>

      <div className="flex items-center justify-between px-3 pt-2 pb-1 text-[11px] text-fg-muted">
        <span>{noun}一覧</span>
        <span className="tabular-nums">{items.length} 件</span>
      </div>
      <div className="flex-1 overflow-y-auto max-md:max-h-44">
        {items.length === 0 ? (
          <div className="p-4 text-center text-sm text-fg-subtle">{noun}がありません</div>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((item) => {
              const selected = item.id === selectedId;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onSelect(item.id)}
                    className={cn(
                      "w-full border-l-2 px-3 py-2 text-left text-sm text-fg transition-colors focus-visible:outline-2 focus-visible:outline-brand",
                      selected ? "border-l-brand bg-brand-soft" : "border-l-transparent hover:bg-sunken",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {item.issue && (
                        <span
                          className={cn("h-2 w-2 shrink-0 rounded-full", item.issue === "error" ? "bg-danger" : "bg-brand")}
                          aria-label={item.issue === "error" ? "入力エラー" : "注意"}
                        />
                      )}
                      <span className="flex-1 truncate">{item.title}</span>
                      {item.badge}
                    </div>
                    {item.subtitle && <div className="mt-0.5 truncate text-[11px] text-fg-muted">{item.subtitle}</div>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex justify-center gap-1 border-t border-line-strong p-2">
        <Button variant="outline" size="icon" onClick={() => selectedId && onMove(selectedId, "up")} disabled={selectedIndex <= 0} className={toolButton} title="上へ移動" aria-label="上へ移動">
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" onClick={() => selectedId && onMove(selectedId, "down")} disabled={selectedIndex < 0 || selectedIndex >= items.length - 1} className={toolButton} title="下へ移動" aria-label="下へ移動">
          <ChevronDown className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => selectedId && onDelete(selectedId)}
          disabled={selectedIndex < 0}
          className={cn(toolButton, "hover:bg-danger hover:border-danger")}
          title={`選択中の${noun}を削除`}
          aria-label={`選択中の${noun}を削除`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
