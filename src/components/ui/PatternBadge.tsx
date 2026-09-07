import { DEFAULT_PATTERN_ID, PATTERN_SHORT_LABELS, isPatternId } from "../../lib/constellationPatterns";

/** Patterns that belong to the "flower" family (violet); everything else is "walker" (sky). */
const FLOWER_FAMILY_PATTERNS = new Set<string>(["flower", "lattice_flower", "necklace_flower"]);

interface Props {
  pattern?: string;
  className?: string;
}

/** Small chip showing a constellation pattern's short label, colored by family. */
export default function PatternBadge({ pattern, className }: Props) {
  const resolvedPattern = isPatternId(pattern) ? pattern : DEFAULT_PATTERN_ID;
  const label = PATTERN_SHORT_LABELS[resolvedPattern];
  const isFlowerFamily = FLOWER_FAMILY_PATTERNS.has(resolvedPattern);
  const familyCls = isFlowerFamily
    ? "border-violet-700 text-violet-300 bg-violet-900/30"
    : "border-sky-700 text-sky-300 bg-sky-900/30";

  return (
    <span
      className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border leading-none whitespace-nowrap ${familyCls} ${className ?? ""}`}
    >
      {label}
    </span>
  );
}
