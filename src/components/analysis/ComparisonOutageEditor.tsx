import { useMemo, useState } from "react";
import type { ComparisonScenario } from "../../lib/constellationComparison";
import { comparisonScenarioInputs } from "../../lib/comparison/outages";
import NumberField from "../ui/NumberField";

interface Props { base: ComparisonScenario; onCreate: (scenario: ComparisonScenario) => void; disabled: boolean }
export default function ComparisonOutageEditor({ base, onCreate, disabled }: Props) {
  const [failedSatelliteCount, setFailedSatelliteCount] = useState(base.outage?.failedSatelliteCount ?? 0);
  const [seed, setSeed] = useState(base.outage?.seed ?? 1);
  const [disabledStationIndices, setDisabledStationIndices] = useState<number[]>(base.outage?.disabledStationIndices ?? []);
  const [error, setError] = useState("");
  const inputs = useMemo(() => {
    try { return comparisonScenarioInputs(base); } catch { return null; }
  }, [base]);
  function create() {
    try {
      const scenario: ComparisonScenario = { ...base, id: crypto.randomUUID(),
        name: `${base.name} / 故障${failedSatelliteCount}機・停止${disabledStationIndices.length}局`.slice(0, 120),
        outage: { failedSatelliteCount, seed, disabledStationIndices: [...disabledStationIndices].sort((a, b) => a - b) } };
      comparisonScenarioInputs(scenario);
      onCreate(scenario); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "故障条件が不正です"); }
  }
  return <fieldset disabled={disabled} className="rounded border border-line p-3 space-y-3">
    <legend className="px-1 text-sm font-medium">選択案から故障・局停止の比較案を作成</legend>
    <p className="text-sm">元の案: {base.name}（入力に含まれる衛星 {inputs?.nominalSatellites.length ?? "—"}機）</p>
    <div className="grid grid-cols-2 gap-3">
      <NumberField id="comparison-failures" label="追加の故障機数" unit="機" min={0} max={inputs?.nominalSatellites.length} value={failedSatelliteCount} integer onChange={setFailedSatelliteCount} />
      <NumberField id="comparison-seed" label="故障seed" min={0} max={4294967295} value={seed} integer onChange={setSeed} />
    </div>
    <div className="flex flex-wrap gap-3">{inputs?.allStations.map((st, i) => <label key={i} className="flex items-center gap-1 text-sm">
      <input type="checkbox" checked={disabledStationIndices.includes(i)} onChange={(e) => setDisabledStationIndices((prev) => e.target.checked ? [...prev, i] : prev.filter((n) => n !== i))} />{st.name} を停止
    </label>)}</div>
    <button className="analysis-secondary-button" disabled={!inputs} onClick={create}>故障・局停止案を追加</button>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <p className="text-xs text-fg-muted">解析期間を通して停止する想定です。故障機は元の入力配列とseedで再現します。TOMLで既に除外された機体に対しては、その残存機から追加で除外します。局停止の影響は地上局ネットワークの指標で確認してください。</p>
  </fieldset>;
}
