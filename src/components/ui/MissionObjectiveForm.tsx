import type { ReactNode } from "react";
import {
  MISSION_FORM_LIMITS,
  type MissionDesignForm,
  type MissionFamilyChoice,
  type MissionObjectiveKind,
  type MissionRegionKind,
} from "../../lib/missionDesignForm";
import { Checkbox } from "./checkbox";
import { HelpTip } from "./compactControls";
import { Label } from "./label";
import NumberField from "./NumberField";

interface Props {
  form: MissionDesignForm;
  onChange: (patch: Partial<MissionDesignForm>) => void;
  /** Locked while a run is in flight. */
  disabled: boolean;
}

const OBJECTIVES: Array<{ kind: MissionObjectiveKind; label: string; help: string }> = [
  {
    kind: "minSatellites",
    label: "最小機数で連続カバレッジ",
    help: "制約を満たす最小の衛星数を探します。得られる値は探索格子(高度・傾斜角・T)上の最小値で、真の最小を保証するものではありません。",
  },
  {
    kind: "paretoCountVsAltitude",
    label: "機数と高度（遅延）のトレードオフ",
    help: "高度ごとに最小衛星数の候補を1件ずつ並べ、機数を減らす(高度を上げる)か遅延を減らす(高度を下げる)かのトレードオフを見せます。",
  },
  {
    kind: "fixedBudget",
    label: "機数固定でカバレッジ最大",
    help: "衛星数の上限を固定し、その範囲でカバレッジ(可用率)が最大になる配置を探します。上限は T ≤ 上限 として扱うため、素数の上限でも候補が空になりません。",
  },
];

const REGIONS: Array<{ kind: MissionRegionKind; label: string }> = [
  { kind: "global", label: "全球" },
  { kind: "latitudeBand", label: "緯度帯" },
];

const FAMILIES: Array<{ value: MissionFamilyChoice; label: string }> = [
  { value: "all", label: "すべて" },
  { value: "walkerDelta", label: "Walker Delta" },
  { value: "walkerStar", label: "Walker Star (SoC)" },
];

const SELECT_CLS =
  "w-full px-2 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded text-gray-100 focus:border-amber-500 focus:outline-none disabled:opacity-50";

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <div className="text-xs font-medium text-gray-400 border-b border-gray-700 pb-1">
      {children}
    </div>
  );
}

/**
 * Left-hand input column of the mission wizard: the objective plus the
 * constraints that become a `DesignRequest`. Purely controlled — every edit is
 * a patch on the parent's form state, and validation lives in
 * `missionDesignForm.ts::validateMissionForm`.
 */
export default function MissionObjectiveForm({ form, onChange, disabled }: Props) {
  const L = MISSION_FORM_LIMITS;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <SectionHeading>設計目的</SectionHeading>
        <div className="space-y-1.5">
          {OBJECTIVES.map((objective) => (
            <label
              key={objective.kind}
              className={`flex items-start gap-2 text-xs ${
                disabled ? "opacity-50" : "cursor-pointer"
              }`}
            >
              <input
                type="radio"
                name="mission-objective"
                value={objective.kind}
                checked={form.objective === objective.kind}
                disabled={disabled}
                onChange={() => onChange({ objective: objective.kind })}
                className="mt-0.5 accent-amber-500"
              />
              <span className="text-gray-200 inline-flex items-start gap-1">
                <span>{objective.label}</span>
                <HelpTip text={objective.help} />
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <SectionHeading>制約</SectionHeading>

        <NumberField
          id="mission-min-elevation"
          label="最低仰角 ε"
          unit="°"
          value={form.minElevationDeg}
          min={L.minElevationDeg.min}
          max={L.minElevationDeg.max}
          step={1}
          disabled={disabled}
          help="地上局から見た衛星の最低仰角。通信では 20–30° が一般的で、低くすると必要機数が減る代わりに大気・地形の影響を受けます。"
          onChange={(v) => onChange({ minElevationDeg: v })}
        />

        <NumberField
          id="mission-fold"
          label="多重度 N"
          value={form.fold}
          min={L.fold.min}
          max={L.fold.max}
          step={1}
          integer
          disabled={disabled}
          help="同時に見えていなければならない衛星数。ハンドオーバやダイバーシティが必要なら 2 以上にします。2 以上の設計式は近似のため、検証結果で判断してください。"
          onChange={(v) => onChange({ fold: v })}
        />

        <div className="space-y-1">
          <Label htmlFor="mission-region" className="text-xs text-gray-400">
            対象領域
          </Label>
          <select
            id="mission-region"
            value={form.region}
            disabled={disabled}
            onChange={(e) => onChange({ region: e.target.value as MissionRegionKind })}
            className={SELECT_CLS}
          >
            {REGIONS.map((region) => (
              <option key={region.kind} value={region.kind}>
                {region.label}
              </option>
            ))}
          </select>
        </div>

        {form.region === "latitudeBand" && (
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              id="mission-lat-min"
              label="緯度下限"
              unit="°"
              value={form.latMinDeg}
              min={L.latitudeDeg.min}
              max={L.latitudeDeg.max}
              step={5}
              disabled={disabled}
              help="世界人口の約 99% は緯度 ±60° 以内に住んでいます。帯を狭めると必要機数が大きく減ります。"
              onChange={(v) => onChange({ latMinDeg: v })}
            />
            <NumberField
              id="mission-lat-max"
              label="緯度上限"
              unit="°"
              value={form.latMaxDeg}
              min={L.latitudeDeg.min}
              max={L.latitudeDeg.max}
              step={5}
              disabled={disabled}
              onChange={(v) => onChange({ latMaxDeg: v })}
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <NumberField
            id="mission-alt-min"
            label="高度 下限"
            unit="km"
            value={form.altitudeMinKm}
            min={L.altitudeKm.min}
            max={L.altitudeKm.max}
            step={50}
            disabled={disabled}
            help="探索する円軌道高度の範囲。低いほど遅延が小さく、必要機数が増えます。"
            onChange={(v) => onChange({ altitudeMinKm: v })}
          />
          <NumberField
            id="mission-alt-max"
            label="高度 上限"
            unit="km"
            value={form.altitudeMaxKm}
            min={L.altitudeKm.min}
            max={L.altitudeKm.max}
            step={50}
            disabled={disabled}
            onChange={(v) => onChange({ altitudeMaxKm: v })}
          />
        </div>

        <NumberField
          id="mission-alt-step"
          label="高度刻み"
          unit="km"
          value={form.altitudeStepKm}
          min={L.altitudeStepKm.min}
          max={L.altitudeStepKm.max}
          step={10}
          disabled={disabled}
          help="高度探索の格子間隔。細かくすると候補が増えて計算時間が伸びます(高度は最大 24 点に丸められます)。"
          onChange={(v) => onChange({ altitudeStepKm: v })}
        />

        <div className="flex items-center gap-2 pt-1">
          <Checkbox
            id="mission-restrict-inclination"
            checked={form.restrictInclination}
            disabled={disabled}
            onCheckedChange={(v) => onChange({ restrictInclination: !!v })}
          />
          <Label
            htmlFor="mission-restrict-inclination"
            className="text-xs font-normal cursor-pointer text-gray-200 inline-flex items-center gap-1"
          >
            <span>傾斜角を指定する</span>
            <HelpTip text="指定しない場合は対象領域から必要な傾斜角の範囲を自動で決めます。打ち上げ場所や既存衛星に合わせたいときだけ指定してください。" />
          </Label>
        </div>

        {form.restrictInclination && (
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              id="mission-inc-min"
              label="傾斜角 下限"
              unit="°"
              value={form.inclinationMinDeg}
              min={L.inclinationDeg.min}
              max={L.inclinationDeg.max}
              step={1}
              disabled={disabled}
              onChange={(v) => onChange({ inclinationMinDeg: v })}
            />
            <NumberField
              id="mission-inc-max"
              label="傾斜角 上限"
              unit="°"
              value={form.inclinationMaxDeg}
              min={L.inclinationDeg.min}
              max={L.inclinationDeg.max}
              step={1}
              disabled={disabled}
              onChange={(v) => onChange({ inclinationMaxDeg: v })}
            />
          </div>
        )}

        <div className="flex items-center gap-2">
          <Checkbox
            id="mission-rgt"
            checked={form.rgt}
            disabled={disabled}
            onCheckedChange={(v) => onChange({ rgt: !!v })}
          />
          <Label
            htmlFor="mission-rgt"
            className="text-xs font-normal cursor-pointer text-gray-200 inline-flex items-center gap-1"
          >
            <span>RGT（回帰軌道）を課す</span>
            <HelpTip text="地上軌跡が一定日数で閉じる高度だけを候補にします。高度が自由変数ではなくなるため、通常の高度格子は置き換えられます。" />
          </Label>
        </div>

        <div className="space-y-1">
          <Label htmlFor="mission-family" className="text-xs text-gray-400 inline-flex items-center gap-1">
            <span>設計方式</span>
            <HelpTip text="最適化の対象は Walker Delta と Walker Star (Streets of Coverage) のみです。Flower 系は列挙・検証カーネルの対象外です。" />
          </Label>
          <select
            id="mission-family"
            value={form.family}
            disabled={disabled}
            onChange={(e) => onChange({ family: e.target.value as MissionFamilyChoice })}
            className={SELECT_CLS}
          >
            {FAMILIES.map((family) => (
              <option key={family.value} value={family.value}>
                {family.label}
              </option>
            ))}
          </select>
        </div>

        {form.objective === "fixedBudget" && (
          <NumberField
            id="mission-budget"
            label="衛星数上限"
            unit="機"
            value={form.satelliteBudget}
            min={L.satelliteBudget.min}
            max={L.satelliteBudget.max}
            step={1}
            integer
            disabled={disabled}
            help="この機数以下(T ≤ 上限)の配置だけを候補にし、可用率の高い順に並べます。"
            onChange={(v) => onChange({ satelliteBudget: v })}
          />
        )}

        <NumberField
          id="mission-topk"
          label="数値検証する上位件数 K"
          value={form.topK}
          min={L.topK.min}
          max={L.topK.max}
          step={1}
          integer
          disabled={disabled}
          help="解析・粗スクリーニングで上位に来た K 件だけを SGP4 で数値検証します。増やすと計算時間が伸びます。"
          onChange={(v) => onChange({ topK: v })}
        />
      </div>
    </div>
  );
}
