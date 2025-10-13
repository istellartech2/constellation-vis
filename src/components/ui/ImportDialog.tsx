import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./dialog";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { Label } from "./label";
import { ChevronRight, ChevronDown, Loader2 } from "lucide-react";
import { CELESTRAK_GROUP_TREE, type CelestrakGroupNode } from "../../utils/celestrakUtils";

interface ImportDialogProps {
  open: boolean;
  importing: boolean;
  selectedGroups: string[];
  onToggleGroup: (group: string) => void;
  onImport: () => void;
  onClose: () => void;
}

function TreeNode({ 
  node, 
  selectedGroups, 
  onToggleGroup, 
  importing,
  level = 0,
  forceExpanded = false
}: {
  node: CelestrakGroupNode;
  selectedGroups: string[];
  onToggleGroup: (group: string) => void;
  importing: boolean;
  level?: number;
  forceExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(forceExpanded);
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedGroups.includes(node.id);
  const childrenSelected = hasChildren ? node.children!.some(child => selectedGroups.includes(child.id)) : false;
  const shouldExpand = forceExpanded || expanded;

  // Special Interest should not show category header when force expanded
  if (forceExpanded && hasChildren) {
    return (
      <div style={{ marginBottom: 4 }}>
        {node.children!.map((child) => (
          <TreeNode
            key={child.id}
            node={child}
            selectedGroups={selectedGroups}
            onToggleGroup={onToggleGroup}
            importing={importing}
            level={0}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={`${level > 0 ? 'ml-4' : ''} mb-2`}>
      <div className="flex items-center mb-1">
        {hasChildren && !forceExpanded && (
          <Button
            variant="ghost"
            size="sm"
            className="w-6 h-6 p-0 mr-2"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </Button>
        )}
        
        {hasChildren ? (
          <Label 
            className={`text-sm ${hasChildren ? 'font-semibold' : 'font-normal'} ${
              hasChildren ? (childrenSelected ? 'text-blue-600' : 'text-muted-foreground') : 'text-foreground'
            } cursor-pointer`}
            onClick={hasChildren && !forceExpanded ? () => setExpanded(!expanded) : undefined}
          >
            {node.label}
          </Label>
        ) : (
          <div className="flex items-center space-x-2">
            <Checkbox
              id={node.id}
              disabled={importing}
              checked={isSelected}
              onCheckedChange={() => onToggleGroup(node.id)}
            />
            <Label
              htmlFor={node.id}
              className="text-sm font-normal cursor-pointer"
            >
              {node.label}
            </Label>
          </div>
        )}
      </div>
      {hasChildren && shouldExpand && (
        <div className="mb-2">
          {node.children!.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              selectedGroups={selectedGroups}
              onToggleGroup={onToggleGroup}
              importing={importing}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
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
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>CelesTrakからインポート</DialogTitle>
          <DialogDescription>
            CelesTrakデータベースから取り込む衛星グループを選択してください。
          </DialogDescription>
        </DialogHeader>
        
        <div className="max-h-96 overflow-y-auto px-2">
          {CELESTRAK_GROUP_TREE.map((group, index) => (
            <TreeNode
              key={group.id}
              node={group}
              selectedGroups={selectedGroups}
              onToggleGroup={onToggleGroup}
              importing={importing}
              forceExpanded={index === 0} // Special Interest is always expanded (first group)
            />
          ))}
        </div>
        
        <DialogFooter>
          {importing ? (
            <div className="flex items-center justify-center w-full">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              <span className="text-sm">読み込み中...</span>
            </div>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                キャンセル
              </Button>
              <Button 
                onClick={onImport} 
                disabled={selectedGroups.length === 0}
              >
                インポート（{selectedGroups.length}件選択）
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
