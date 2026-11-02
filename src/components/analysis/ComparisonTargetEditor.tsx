import { useState } from "react";
import NumberField from "../ui/NumberField";
import { comparisonTargets, DEFAULT_COMPARISON_TARGET, type ComparisonTarget } from "../../lib/constellationComparison";

interface Props { value: ComparisonTarget; onChange: (value: ComparisonTarget) => void; onError: (message: string) => void; disabled: boolean }
export default function ComparisonTargetEditor({ value, onChange, onError, disabled }: Props) {
  const [pointText, setPointText] = useState(() => value.kind === "points"
    ? value.points.map((p) => `${p.name}, ${p.latitudeDeg}, ${p.longitudeDeg}`).join("\n") : "");
  const [error, setError] = useState("");
  const apply = (target: ComparisonTarget) => {
    // Keep numeric drafts (including NaN) visible so a blank field can be corrected.
    onChange(target);
    try { comparisonTargets(target, 0); setError(""); onError(""); }
    catch (e) { const message = e instanceof Error ? e.message : "対象地域が不正です"; setError(message); onError(message); }
  };
  const changePoints = (text: string) => {
    setPointText(text);
    try {
      const points = text.split("\n").filter((l) => l.trim()).map((line) => {
        const fields = line.split(",").map((s) => s.trim());
        if (fields.length !== 3 || fields.some((f) => !f)) throw new Error("各行を 地点名, 緯度, 経度 の形式で入力してください");
        return { name: fields[0], latitudeDeg: Number(fields[1]), longitudeDeg: Number(fields[2]) };
      });
      apply({ kind: "points", points });
    } catch (e) { const message = e instanceof Error ? e.message : "地点が不正です"; setError(message); onError(message); }
  };
  const changeKind = (kind: string) => {
    if (kind === "points") {
      const target = DEFAULT_COMPARISON_TARGET;
      setPointText(target.kind === "points" ? target.points.map((p) => `${p.name}, ${p.latitudeDeg}, ${p.longitudeDeg}`).join("\n") : "");
      apply(target);
    } else apply({ kind: "rectangle", southDeg: 24, northDeg: 46, westDeg: 123, eastDeg: 146, spacingDeg: 3 });
  };
  return <fieldset disabled={disabled} className="rounded border border-line p-3 space-y-3">
    <legend className="px-1 text-sm font-medium">評価する地点・地域</legend>
    <label className="flex items-center gap-2 text-sm">評価対象<select className="analysis-input" value={value.kind} onChange={(e) => changeKind(e.target.value)}>
      <option value="points">指定地点</option><option value="rectangle">矩形地域</option>
    </select></label>
    {value.kind === "points" ? <label className="block text-sm text-fg-muted">地点名, 緯度, 経度（各行1地点）
      <textarea aria-label="比較評価地点" className="mt-1 w-full rounded border border-line-strong bg-sunken p-2 font-mono text-sm text-fg" rows={4}
        value={pointText} onChange={(e) => changePoints(e.target.value)} />
    </label> : <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <NumberField id="comparison-south" label="南端緯度" unit="°" value={value.southDeg} onChange={(southDeg) => apply({ ...value, southDeg })} />
      <NumberField id="comparison-north" label="北端緯度" unit="°" value={value.northDeg} onChange={(northDeg) => apply({ ...value, northDeg })} />
      <NumberField id="comparison-west" label="西端経度" unit="°" value={value.westDeg} onChange={(westDeg) => apply({ ...value, westDeg })} />
      <NumberField id="comparison-east" label="東端経度" unit="°" value={value.eastDeg} onChange={(eastDeg) => apply({ ...value, eastDeg })} />
      <NumberField id="comparison-spacing" label="格子間隔" unit="°" min={0.25} max={30} value={value.spacingDeg} onChange={(spacingDeg) => apply({ ...value, spacingDeg })} />
    </div>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <p className="text-xs text-fg-muted">地点は等重み、矩形は各セル中心を評価して球面面積で加重します（最大400点）。東端経度が西端より小さい場合は日付変更線を横断します。観測日照・姿勢変更は含みません。</p>
  </fieldset>;
}
