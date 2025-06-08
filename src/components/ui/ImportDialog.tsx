interface ImportDialogProps {
  open: boolean;
  importing: boolean;
  selectedGroups: string[];
  onToggleGroup: (group: string) => void;
  onImport: () => void;
  onClose: () => void;
}

const CELESTRACK_GROUPS = [
  { label: "Last 30 Days' Launches", group: "last-30-days" },
  { label: "Space Stations", group: "stations" },
  { label: "Active GEO", group: "geo" },
  { label: "Weather", group: "weather" },
  { label: "GNSS", group: "gnss" },
  { label: "Starlink", group: "starlink" },
  { label: "Oneweb", group: "oneweb" },
] as const;

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
      <div className="overlay-box">
        <h3 style={{ marginTop: 0 }}>Import from CelesTrak</h3>
        {CELESTRACK_GROUPS.map(({ label, group }) => (
          <label key={group} style={{ display: "block" }}>
            <input
              type="checkbox"
              disabled={importing}
              checked={selectedGroups.includes(group)}
              onChange={() => onToggleGroup(group)}
            />
            <span style={{ marginLeft: 4 }}>{label}</span>
          </label>
        ))}
        {importing ? (
          <div style={{ marginTop: 8, textAlign: "center" }}>Loading...</div>
        ) : (
          <div style={{ marginTop: 8, textAlign: "right" }}>
            <button onClick={onClose} style={{ marginRight: 8 }}>
              Cancel
            </button>
            <button onClick={onImport}>Import</button>
          </div>
        )}
      </div>
    </div>
  );
}