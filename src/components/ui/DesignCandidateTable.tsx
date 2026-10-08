import type { DesignCandidate } from "../../lib/constellationDesign";
import {
  candidateStatus,
  type CandidateStatus,
  type MissionRunPhase,
} from "../../lib/missionDesignForm";
import PatternBadge from "./PatternBadge";

interface Props {
  /** Already ordered by `sortCandidatesForDisplay`. */
  candidates: DesignCandidate[];
  targetAvailability: number;
  availabilityBasis: "areaAverage" | "worstLatitude";
  phase: MissionRunPhase;
  /** Keys dominated in the (count, altitude) plane; only rendered for pareto. */
  dominatedKeys: Set<string>;
  showDominance: boolean;
  /** Pattern id the candidate's shell would get (`candidateToShell`), memoized by the pane. */
  patternOf: (candidate: DesignCandidate) => string | undefined;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** How many rows to render; the rest sit behind the 「残り N 件」 button. */
  visibleCount: number;
  onShowMore: () => void;
}

const STATUS_META: Record<CandidateStatus, { label: string; cls: string }> = {
  unverified: { label: "未検証", cls: "border-line-strong text-fg-muted bg-raised" },
  verifying: {
    label: "検証中",
    cls: "border-brand/40 text-brand-text bg-brand-soft animate-pulse",
  },
  verifiedOk: { label: "達成", cls: "border-success/40 text-success bg-success-soft" },
  attention: { label: "要注意", cls: "border-brand/40 text-brand-text bg-brand-soft" },
  verifiedNg: { label: "未達", cls: "border-danger/40 text-danger bg-danger-soft" },
  cancelled: { label: "中止", cls: "border-line-strong text-fg-subtle bg-raised" },
};

function pct(value: number | undefined, placeholder: string): string {
  if (value === undefined || !Number.isFinite(value)) return placeholder;
  return `${(value * 100).toFixed(4)}`;
}

/** `F` for Delta, `S` (sats per plane) for Star — the number that sizes the shell. */
function phasingCell(candidate: DesignCandidate): string {
  const { family, phasingF, satsPerPlane } = candidate.parameters;
  if (family === "walkerStar") return `S${satsPerPlane}`;
  return `F${Number(phasingF.toFixed(4))}`;
}

const HEADER_CLS =
  "sticky top-0 z-10 bg-surface-solid text-fg-muted font-medium text-left px-2 py-1.5 border-b border-line whitespace-nowrap";

/**
 * Ranked candidate list. No header sorting: the order *is* the objective's
 * ranking, and letting the user re-sort would hide which row the engine picked.
 */
export default function DesignCandidateTable({
  candidates,
  targetAvailability,
  availabilityBasis,
  phase,
  dominatedKeys,
  showDominance,
  patternOf,
  selectedKey,
  onSelect,
  visibleCount,
  onShowMore,
}: Props) {
  const visible = candidates.slice(0, visibleCount);
  const hidden = candidates.length - visible.length;
  const verifying = phase === "verifying";

  return (
    <div className="flex flex-col min-h-0">
      <p className="mb-2 text-xs text-fg-muted">目標 {Number((targetAvailability * 100).toFixed(4))}% ・ {availabilityBasis === "worstLatitude" ? "最も条件の悪い緯度" : "領域全体の平均"}</p>
      {/* Capped so the selected candidate's preview stays reachable; on a phone
          the inner table keeps its own horizontal scroll. */}
      <div className="overflow-auto max-h-[32vh] md:max-h-[38vh] border border-line rounded">
        <table className="w-full min-w-[560px] text-xs tabular-nums border-collapse">
          <thead>
            <tr>
              <th className={HEADER_CLS}>#</th>
              <th className={HEADER_CLS}>方式</th>
              <th className={HEADER_CLS}>T</th>
              <th className={HEADER_CLS}>P</th>
              <th className={`${HEADER_CLS} hidden sm:table-cell`}>F・S</th>
              <th className={HEADER_CLS}>高度 km</th>
              <th className={HEADER_CLS}>傾斜角 °</th>
              <th className={HEADER_CLS}>粗選別可用率 %</th>
              <th className={HEADER_CLS}>検証可用率 %</th>
              <th className={`${HEADER_CLS} hidden sm:table-cell`}>遅延 ms</th>
              <th className={HEADER_CLS}>状態</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((candidate, index) => {
              const status = candidateStatus(candidate, phase);
              const meta = STATUS_META[status];
              const dominated = showDominance && dominatedKeys.has(candidate.key);
              const selected = candidate.key === selectedKey;
              return (
                <tr
                  key={candidate.key}
                  onClick={() => onSelect(candidate.key)}
                  className={`cursor-pointer border-b border-line ${
                    selected ? "bg-brand-soft text-fg" : "hover:bg-sunken text-fg"
                  } ${dominated ? "opacity-50" : ""}`}
                >
                  <td className="px-2 py-1">
                    <button type="button" onClick={() => onSelect(candidate.key)}
                      aria-label={`候補 ${index + 1} を選択`} aria-pressed={selected}
                      className="min-w-8 min-h-8 rounded text-fg hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-brand">
                      {index + 1}
                    </button>
                  </td>
                  <td className="px-2 py-1">
                    <span className="inline-flex items-center gap-1">
                      <PatternBadge pattern={patternOf(candidate)} />
                      {dominated && (
                        <span className="text-[10px] px-1 py-0.5 rounded border border-line-strong text-fg-muted leading-none">
                          支配
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-1">{candidate.parameters.totalSatellites}</td>
                  <td className="px-2 py-1">{candidate.parameters.planes}</td>
                  <td className="px-2 py-1 hidden sm:table-cell">{phasingCell(candidate)}</td>
                  <td className="px-2 py-1">{Math.round(candidate.parameters.altitudeKm)}</td>
                  <td className="px-2 py-1">{candidate.parameters.inclinationDeg.toFixed(1)}</td>
                  <td className="px-2 py-1">{pct(candidate.screen?.evaluationAvailability ?? candidate.screen?.foldAvailability, "—")}</td>
                  <td className="px-2 py-1">
                    {pct(candidate.verified?.evaluationAvailability ?? candidate.verified?.foldAvailability, verifying ? "…" : "—")}
                  </td>
                  <td className="px-2 py-1 hidden sm:table-cell">
                    {candidate.analytic.latencyAtEpsilonMs.toFixed(1)}
                  </td>
                  <td className="px-2 py-1">
                    <span
                      className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border leading-none whitespace-nowrap ${meta.cls}`}
                    >
                      {status === "attention" ? (candidate.feasible ? "達成・要注意" : "未達・要注意") : meta.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hidden > 0 && (
        <button
          type="button"
          onClick={onShowMore}
          className="mt-1 self-start text-[11px] text-brand-text hover:text-brand-text underline"
        >
          残り {hidden} 件を表示
        </button>
      )}
    </div>
  );
}
