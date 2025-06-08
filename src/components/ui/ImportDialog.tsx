import { useState } from "react";

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
    <div style={{ marginLeft: level * 18, marginBottom: 5 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 3 }}>
        {hasChildren && !forceExpanded && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "15px",
              marginRight: 6,
              width: 18,
              textAlign: "center",
              color: "#555",
              padding: 5
            }}
          >
            {expanded ? "▼" : "▶"}
          </button>
        )}
        <label style={{ 
          display: "flex", 
          alignItems: "center",
          fontSize: hasChildren ? "15px" : "14px",
          fontWeight: hasChildren ? "600" : "normal",
          color: hasChildren ? (childrenSelected ? "#0066cc" : "#aaa") : "#eee",
          cursor: hasChildren && !forceExpanded ? "pointer" : "default",
          lineHeight: "1.3"
        }} onClick={hasChildren && !forceExpanded ? () => setExpanded(!expanded) : undefined}>
          {!hasChildren && (
            <input
              type="checkbox"
              disabled={importing}
              checked={isSelected}
              onChange={() => onToggleGroup(node.group)}
              style={{ marginRight: 6, transform: "scale(1.1)" }}
            />
          )}
          <span>{node.label}</span>
        </label>
      </div>
      {hasChildren && shouldExpand && (
        <div>
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
  if (!open) return null;

  return (
    <div className="overlay">
      <div className="overlay-box" style={{ width: "420px", maxHeight: "580px", overflow: "auto" }}>
        <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: "17px" }}>Import from CelesTrak</h3>
        <div style={{ marginBottom: 16 }}>
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
        {importing ? (
          <div style={{ marginTop: 10, textAlign: "center", fontSize: "15px" }}>Loading...</div>
        ) : (
          <div style={{ marginTop: 10, textAlign: "right" }}>
            <button onClick={onClose} style={{ marginRight: 10, fontSize: "14px", padding: "6px 14px" }}>
              Cancel
            </button>
            <button 
              onClick={onImport} 
              disabled={selectedGroups.length === 0}
              style={{ fontSize: "14px", padding: "6px 14px" }}
            >
              Import ({selectedGroups.length} selected)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}