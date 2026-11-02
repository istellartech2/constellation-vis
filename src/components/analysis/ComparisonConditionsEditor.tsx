import NumberField from "../ui/NumberField";
import type { ComparisonConditions } from "../../lib/constellationComparison";
import type { SatelliteFovCriteria } from "../../lib/visibility";

interface Props {
  value: ComparisonConditions;
  onChange: (value: ComparisonConditions) => void;
  sceneFov: SatelliteFovCriteria;
  disabled: boolean;
}
export default function ComparisonConditionsEditor({ value, onChange, sceneFov, disabled }: Props) {
  const patch = (p: Partial<ComparisonConditions>) => onChange({ ...value, ...p });
  return <fieldset disabled={disabled} className="rounded border border-line p-3 space-y-3">
    <legend className="px-1 text-sm font-medium">全案に共通の評価条件</legend>
    <label className="flex flex-col gap-1 text-sm text-fg-muted">開始時刻（UTC）
      <input type="datetime-local" step="0.001" aria-label="比較開始時刻 UTC" className="analysis-input"
        value={value.startTimeIso.replace(/Z$/, "")} onChange={(e) => patch({ startTimeIso: e.target.value ? new Date(`${e.target.value}Z`).toISOString() : "" })} />
    </label>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <NumberField id="comparison-duration" label="期間" unit="h" value={value.durationHours} min={1 / 60} max={168} onChange={(durationHours) => patch({ durationHours })} />
      <NumberField id="comparison-step" label="刻み" unit="s" value={value.stepSeconds} min={1} max={600} onChange={(stepSeconds) => patch({ stepSeconds })} />
      <NumberField id="comparison-elevation" label="対象地点の最低仰角" unit="°" value={value.minElevationDeg} min={0} max={89} onChange={(minElevationDeg) => patch({ minElevationDeg })} />
      <NumberField id="comparison-fold" label="要求同時可視数" unit="機" value={value.requiredFold} min={1} max={4} integer onChange={(requiredFold) => patch({ requiredFold })} />
      <NumberField id="comparison-availability" label="要求可用率" unit="%" value={value.targetAvailabilityPct} min={0} max={100} step={0.1} onChange={(targetAvailabilityPct) => patch({ targetAvailabilityPct })} />
      <NumberField id="comparison-gap" label="許容最大要求未達時間" unit="min" value={value.maxGapMinutes} min={0} max={10080} onChange={(maxGapMinutes) => patch({ maxGapMinutes })} />
    </div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.fov !== null}
      onChange={(e) => patch({ fov: e.target.checked ? { ...sceneFov } : null })} />衛星FOVも適用する</label>
    {value.fov && <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <NumberField id="comparison-half-angle" label="FOV半角" unit="°" value={value.fov.halfAngleDeg} min={0.1} max={90} onChange={(halfAngleDeg) => patch({ fov: { ...value.fov!, halfAngleDeg } })} />
      <NumberField id="comparison-along" label="進行方向の傾き" unit="°" value={value.fov.alongTrackDeg} min={-90} max={90} onChange={(alongTrackDeg) => patch({ fov: { ...value.fov!, alongTrackDeg } })} />
      <NumberField id="comparison-cross" label="左右方向の傾き" unit="°" value={value.fov.crossTrackDeg} min={-90} max={90} onChange={(crossTrackDeg) => patch({ fov: { ...value.fov!, crossTrackDeg } })} />
    </div>}
    <p className="text-xs text-fg-muted">FOVは表示設定から初期値をコピーし、この比較の条件として保存します。地上局は各案の局設定で別に評価します。</p>
  </fieldset>;
}
