import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./dialog";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { Label } from "./label";
import { ChevronRight, ChevronDown, Loader2 } from "lucide-react";

interface ImportDialogProps {
  open: boolean;
  importing: boolean;
  selectedGroups: string[];
  onToggleGroup: (group: string) => void;
  onImport: () => void;
  onClose: () => void;
}

interface DataSource {
  label: string;
  group: string;
  children?: DataSource[];
}

const CELESTRACK_GROUPS: DataSource[] = [
  {
    label: "Special Interest",
    group: "special",
    children: [
      { label: "Last 30 Days' Launches", group: "last-30-days" },
      { label: "Space Stations", group: "stations" },
      { label: "Active Satellites", group: "active" },
      { label: "Active GEO", group: "geo" },
      { label: "CubeSats", group: "cubesat" },
    ]
  },
  {
    label: "Weather & Earth Observation",
    group: "weather-earth",
    children: [
      { label: "Weather", group: "weather" },
      { label: "Planet", group: "planet" },
      { label: "Spire", group: "spire" },
    ]
  },
  {
    label: "Communications",
    group: "communications",
    children: [
      { label: "Starlink", group: "starlink" },
      { label: "OneWeb", group: "oneweb" },
      { label: "Intelsat", group: "intelsat" },
      { label: "SES", group: "ses" },
      { label: "Iridium", group: "iridium" },
      { label: "Globalstar", group: "globalstar" },
      { label: "Amateur Radio", group: "amateur" },
    ]
  },
  {
    label: "Navigation",
    group: "navigation",
    children: [
      { label: "GNSS All", group: "gnss" },
      { label: "GPS Operational", group: "gps-ops" },
      { label: "GLONASS", group: "glo-ops" },
      { label: "Galileo", group: "galileo" },
      { label: "Beidou", group: "beidou" },
      { label: "SBAS(QZSS/WAAS/EGNOS)", group: "sbas" },
    ]
  },
  {
    label: "Debris",
    group: "debris",
    children: [
      { label: "COSMOS 1408 Debris", group: "cosmos-1408-debris" },
      { label: "Fengyun 1C Debris", group: "fengyun-1c-debris" },
      { label: "Iridium 33 Debris", group: "iridium-33-debris" },
      { label: "COSMOS 2251 Debris", group: "cosmos-2251-debris" },
    ]
  },
];

function TreeNode({ 
  node, 
  selectedGroups, 
  onToggleGroup, 
  importing,
  level = 0,
  forceExpanded = false
}: {
  node: DataSource;
  selectedGroups: string[];
  onToggleGroup: (group: string) => void;
  importing: boolean;
  level?: number;
  forceExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(forceExpanded);
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedGroups.includes(node.group);
  const childrenSelected = hasChildren ? node.children!.some(child => selectedGroups.includes(child.group)) : false;
  const shouldExpand = forceExpanded || expanded;

  // Special Interest should not show category header when force expanded
  if (forceExpanded && hasChildren) {
    return (
      <div style={{ marginBottom: 4 }}>
        {node.children!.map((child) => (
          <TreeNode
            key={child.group}
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
              id={node.group}
              disabled={importing}
              checked={isSelected}
              onCheckedChange={() => onToggleGroup(node.group)}
            />
            <Label
              htmlFor={node.group}
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
              key={child.group}
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
          <DialogTitle>Import from CelesTrak</DialogTitle>
          <DialogDescription>
            Select satellite groups to import from CelesTrak database.
          </DialogDescription>
        </DialogHeader>
        
        <div className="max-h-96 overflow-y-auto px-2">
          {CELESTRACK_GROUPS.map((group, index) => (
            <TreeNode
              key={group.group}
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
              <span className="text-sm">Loading...</span>
            </div>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button 
                onClick={onImport} 
                disabled={selectedGroups.length === 0}
              >
                Import ({selectedGroups.length} selected)
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}