export interface ShellFormBannerItem {
  message: string;
  severity?: "error" | "warning";
}

interface Props {
  items: ShellFormBannerItem[];
  className?: string;
}

/** Grouped error/warning banner for shell-form style panels. Renders nothing when `items` is empty. */
export default function ShellFormBanner({ items, className }: Props) {
  if (items.length === 0) return null;

  const errors = items.filter((i) => i.severity !== "warning");
  const warnings = items.filter((i) => i.severity === "warning");

  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      {errors.length > 0 && (
        <ul className="text-xs bg-red-900/30 border border-red-700 text-red-300 rounded px-2 py-1.5 space-y-0.5">
          {errors.map((item, i) => (
            <li key={i}>{item.message}</li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className="text-xs bg-amber-900/25 border border-amber-700 text-amber-300 rounded px-2 py-1.5 space-y-0.5">
          {warnings.map((item, i) => (
            <li key={i}>{item.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
