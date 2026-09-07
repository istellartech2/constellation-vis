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
  unverified: { label: "未検証", cls: "border-gray-600 text-gray-400 bg-gray-800/60" },
  verifying: {
    label: "検証中",
    cls: "border-amber-700 text-amber-300 bg-amber-900/30 animate-pulse",
  },
  verifiedOk: { label: "検証OK", cls: "border-emerald-700 text-emerald-300 bg-emerald-900/30" },
  attention: { label: "要注意", cls: "border-amber-700 text-amber-300 bg-amber-900/30" },
  verifiedNg: { label: "NG", cls: "border-red-700 text-red-300 bg-red-900/30" },
  cancelled: { label: "中止", cls: "border-gray-600 text-gray-500 bg-gray-800/60" },
};

function pct(value: number | undefined, placeholder: string): string {
  if (value === undefined || !Number.isFinite(value)) return placeholder;
  return `${(value * 100).toFixed(2)}`;
}

/** `F` for Delta, `S` (sats per plane) for Star — the number that sizes the shell. */
function phasingCell(candidate: DesignCandidate): string {
  const { family, phasingF, satsPerPlane } = candidate.parameters;
  if (family === "walkerStar") return `S${satsPerPlane}`;
  return `F${Number(phasingF.toFixed(2))}`;
}

const HEADER_CLS =
  "sticky top-0 z-10 bg-gray-900 text-gray-400 font-medium text-left px-2 py-1.5 border-b border-gray-700 whitespace-nowrap";

/**
 * Ranked candidate list. No header sorting: the order *is* the objective's
 * ranking, and letting the user re-sort would hide which row the engine picked.
 */
export default function DesignCandidateTable({
  candidates,
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
      {/* Capped so the selected candidate's preview stays reachable; on a phone
          the inner table keeps its own horizontal scroll. */}
      <div className="overflow-auto max-h-[32vh] md:max-h-[38vh] border border-gray-700 rounded">
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
              <th className={HEADER_CLS}>解析カバレッジ %</th>
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
                  className={`cursor-pointer border-b border-gray-800 ${
                    selected ? "bg-amber-900/40 text-amber-50" : "hover:bg-gray-800 text-gray-200"
                  } ${dominated ? "opacity-50" : ""}`}
                >
                  <td className="px-2 py-1 text-gray-500">{index + 1}</td>
                  <td className="px-2 py-1">
                    <span className="inline-flex items-center gap-1">
                      <PatternBadge pattern={patternOf(candidate)} />
                      {dominated && (
                        <span className="text-[10px] px-1 py-0.5 rounded border border-gray-600 text-gray-400 leading-none">
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
                  <td className="px-2 py-1">{pct(candidate.screen?.foldAvailability, "—")}</td>
                  <td className="px-2 py-1">
                    {pct(candidate.verified?.foldAvailability, verifying ? "…" : "—")}
                  </td>
                  <td className="px-2 py-1 hidden sm:table-cell">
                    {candidate.analytic.latencyAtEpsilonMs.toFixed(1)}
                  </td>
                  <td className="px-2 py-1">
                    <span
                      className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border leading-none whitespace-nowrap ${meta.cls}`}
                    >
                      {meta.label}
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
          className="mt-1 self-start text-[11px] text-amber-300 hover:text-amber-200 underline"
        >
          残り {hidden} 件を表示
        </button>
      )}
    </div>
  );
}
