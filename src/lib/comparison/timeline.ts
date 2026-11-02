import * as satellite from "satellite.js";
import { analysisTimes } from "../analysisTime";
import { computeAccessGrid, gridStationCounts } from "../accessGrid";
import { earthShadowFraction } from "../illumination";
import { toSatrec } from "../satellites";
import { comparisonInputKey, comparisonTargets, validateComparisonConditions, type ComparisonConditions, type ComparisonScenario, type ComparisonTarget } from "../constellationComparison";
import { comparisonScenarioInputs } from "./outages";

export interface TimelineInterval { startMs: number; endMs: number }
export interface TimelineLane { id: string; label: string; kind: "eclipse" | "station" | "target"; intervals: TimelineInterval[] }
export interface ComparisonTimelineJob {
  scenario: ComparisonScenario;
  conditions: ComparisonConditions;
  target: ComparisonTarget;
  satelliteIndex: number;
  targetIndex: number;
}
export interface ComparisonTimeline {
  inputKey: string;
  satelliteLabel: string;
  startMs: number;
  endMs: number;
  stepSeconds: number;
  lanes: TimelineLane[];
}
export function timelineInputKey(job: ComparisonTimelineJob): string {
  return JSON.stringify([comparisonInputKey(job.scenario, job.conditions, job.target), job.satelliteIndex, job.targetIndex]);
}
/** Left-endpoint intervals. A terminal-only event has zero duration and is omitted. */
export function timelineIntervals(times: readonly number[], active: ArrayLike<number>): TimelineInterval[] {
  const out: TimelineInterval[] = [];
  let start: number | null = null;
  for (let i = 0; i < times.length - 1; i++) {
    if (active[i] && start === null) start = times[i];
    if (!active[i] && start !== null) { out.push({ startMs: start, endMs: times[i] }); start = null; }
  }
  if (start !== null) out.push({ startMs: start, endMs: times[times.length - 1] });
  return out;
}
export function analyzeComparisonTimeline(job: ComparisonTimelineJob, onProgress?: (fraction: number) => void): ComparisonTimeline {
  const { scenario, conditions, target, satelliteIndex, targetIndex } = job;
  validateComparisonConditions(conditions);
  const inputs = comparisonScenarioInputs(scenario);
  const targets = comparisonTargets(target, conditions.minElevationDeg);
  if (!Number.isInteger(satelliteIndex) || satelliteIndex < 0 || satelliteIndex >= inputs.satellites.length) throw new Error("稼働中の衛星を選択してください");
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= targets.length) throw new Error("対象地点を選択してください");
  const spec = inputs.satellites[satelliteIndex];
  const start = new Date(conditions.startTimeIso);
  const options = { durationHours: conditions.durationHours, stepSeconds: conditions.stepSeconds, strictPropagation: true };
  const targetGrid = computeAccessGrid([spec], [targets[targetIndex].station], start, { ...options, fov: conditions.fov ?? undefined });
  onProgress?.(0.2);
  const stationGrid = inputs.stations.length ? computeAccessGrid([spec], inputs.stations, start, options) : null;
  onProgress?.(0.5);
  const times = analysisTimes(start.getTime(), conditions.durationHours * 3600, conditions.stepSeconds);
  const eclipsed = new Uint8Array(times.length);
  const rec = toSatrec(spec);
  for (let i = 0; i < times.length; i++) {
    const date = new Date(times[i]);
    const pv = satellite.propagate(rec, date);
    if (!pv?.position) throw new Error(`食を計算する衛星位置がありません: ${date.toISOString()}`);
    eclipsed[i] = Number(earthShadowFraction(pv.position, date) >= 0.5);
    if (i % 1000 === 0) onProgress?.(0.5 + 0.5 * i / times.length);
  }
  const lanes: TimelineLane[] = [
    { id: "eclipse", label: "食（遮蔽率50%以上）", kind: "eclipse", intervals: timelineIntervals(times, eclipsed) },
    ...inputs.stations.map((st, i): TimelineLane => ({ id: `station-${i}`, label: `地上局: ${st.name}`, kind: "station", intervals: timelineIntervals(times, gridStationCounts(stationGrid!, i)) })),
    { id: "target", label: `${conditions.fov ? "FOV内" : "可視"}: ${targets[targetIndex].station.name}`, kind: "target", intervals: timelineIntervals(times, gridStationCounts(targetGrid, 0)) },
  ];
  return { inputKey: timelineInputKey(job), satelliteLabel: spec.meta?.objectName || `衛星 ${satelliteIndex + 1}`,
    startMs: times[0], endMs: times[times.length - 1], stepSeconds: conditions.stepSeconds, lanes };
}
