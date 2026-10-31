import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import PanelSection from "./PanelSection";
import { Checkbox } from "./checkbox";
import { Label } from "./label";
import { Button } from "./button";
import { ArrowUpDown, Gauge, Layers, LineChart, Waypoints } from "lucide-react";
import { ColorRow, FieldGroup, FieldSlider, HelpTip, SegmentedControl } from "./compactControls";
import { parseGroundStationsToml } from "../../lib/tomlParsers";
import type { GroundStation } from "../../lib/groundStations";
import { numericInputValue, parseNumericInput } from "../../lib/numericInput";
import { propagationDelayMs } from "../../lib/isl/cost";
import { applyCostPreset, ISL_COST_PRESETS, matchCostPreset, type IslCostPresetId } from "../../lib/isl/costPresets";
import {
  DEFAULT_ADHOC_MIN_ELEVATION_DEG,
  isSameEndpoint,
  stationEndpoint,
  type IslEndpoint,
  type IslLinkModel,
  type IslPathResult,
  type IslSettings,
  type IslShellRange,
} from "../../lib/isl/types";

interface Props {
  gsText: string;
  islSettings: IslSettings;
  onIslSettingsChange: (next: IslSettings) => void;
  /** Shell index ranges for the currently active satellite array (from the last "Update" click). */
  islShellRanges: IslShellRange[];
  islResult: IslPathResult | null;
  /** User-facing message from the last routing worker error, or null. */
  islError: string | null;
  /** Cumulative count of path switches since ISL was enabled */
  islSwitchCount: number;
  /** Sim-time (ms) of the last path switch, or null if none yet */
  islLastSwitchSimMs: number | null;
  /** Current simulation time (ms) */
  currentSimMs: number;
  /** Opens the ISL timeline analysis (解析タブのモーダル) directly from the result card. */
  onOpenTimelineAnalysis?: () => void;
}

function defaultAdhocEndpoint(name: string): IslEndpoint {
  return {
    kind: "adhoc",
    name,
    latitudeDeg: 0,
    longitudeDeg: 0,
    heightKm: 0,
    minElevationDeg: DEFAULT_ADHOC_MIN_ELEVATION_DEG,
  };
}

type PolicyChoice = IslCostPresetId | "custom";

/** 通信タブの衛星間経路 (ISL) 部分: ① 地点 → ② 経路の選び方 → 現在の経路 → 詳細設定。 */
export default function IslSection({
  gsText,
  islSettings,
  onIslSettingsChange,
  islShellRanges,
  islResult,
  islError,
  islSwitchCount,
  islLastSwitchSimMs,
  currentSimMs,
  onOpenTimelineAnalysis,
}: Props) {
  const groundStations = useMemo(() => {
    try {
      return parseGroundStationsToml(gsText);
    } catch {
      return [];
    }
  }, [gsText]);

  // No participants at all is a distinct, valid state — not the same as
  // "no filter" (which is the excludedShellKeys=[] + includeBaseSatellites=true
  // default). Resolvable from the stable exclusion state alone, without
  // needing the actual satellite array or counts.
  const hasZeroParticipants =
    !islSettings.includeBaseSatellites &&
    islShellRanges.every((shell) => islSettings.excludedShellKeys.includes(shell.key));

  const enabled = islSettings.enabled;
  const missingEndpoints: string[] = [];
  if (!islSettings.endpointA) missingEndpoints.push("A");
  if (!islSettings.endpointB) missingEndpoints.push("B");
  const sameEndpoints = isSameEndpoint(islSettings.endpointA, islSettings.endpointB);

  // A matching preset is shown as selected; hand-tuned costs (or the user
  // picking カスタム) reveal the individual knobs.
  const matchedPreset = matchCostPreset(islSettings.cost);
  const [customPicked, setCustomPicked] = useState(false);
  const policy: PolicyChoice = customPicked || matchedPreset === null ? "custom" : matchedPreset;

  function choosePolicy(next: PolicyChoice) {
    if (next === "custom") {
      setCustomPicked(true);
      return;
    }
    setCustomPicked(false);
    onIslSettingsChange({ ...islSettings, cost: applyCostPreset(next) });
  }

  function updateCost(patch: Partial<IslSettings["cost"]>) {
    onIslSettingsChange({ ...islSettings, cost: { ...islSettings.cost, ...patch } });
  }

  function updateShellLinkModel(key: string, patch: Partial<IslLinkModel>) {
    // An `undefined` field in patch means "clear this override, fall back to
    // the global default" — must delete the key, not store it as undefined
    // (which would otherwise stick around and shadow the default via spread).
    const merged: Partial<IslLinkModel> = { ...islSettings.shellLinkModels?.[key], ...patch };
    (Object.keys(merged) as (keyof IslLinkModel)[]).forEach((k) => {
      if (merged[k] === undefined) delete merged[k];
    });
    onIslSettingsChange({
      ...islSettings,
      shellLinkModels: { ...islSettings.shellLinkModels, [key]: merged },
    });
  }

  function toggleShell(key: string) {
    const excluded = new Set(islSettings.excludedShellKeys);
    if (excluded.has(key)) excluded.delete(key);
    else excluded.add(key);
    onIslSettingsChange({ ...islSettings, excludedShellKeys: Array.from(excluded) });
  }

  function toggleIncludeBase() {
    onIslSettingsChange({ ...islSettings, includeBaseSatellites: !islSettings.includeBaseSatellites });
  }

  function updateEndpoint(which: "endpointA" | "endpointB", endpoint: IslEndpoint | null) {
    onIslSettingsChange({ ...islSettings, [which]: endpoint });
  }

  function swapEndpoints() {
    onIslSettingsChange({
      ...islSettings,
      endpointA: islSettings.endpointB,
      endpointB: islSettings.endpointA,
    });
  }

  const presetDescription = ISL_COST_PRESETS.find((p) => p.id === policy)?.description;

  return (
    <>
      <PanelSection title="衛星間リンク経路 (ISL)" icon={<Waypoints />}>
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-fg-muted">
            2 つの地点を、衛星どうしの通信リンクでつないだ経路を探して 3D に表示します。
          </p>

          <SwitchRow
            checked={enabled}
            onChange={(v) => onIslSettingsChange({ ...islSettings, enabled: v })}
            label="経路探索"
            detail={enabled ? "オン：経路を計算して 3D に表示しています" : "オフ：計算も表示もしません"}
          />

          <FieldGroup title="① 通信する 2 地点">
            <div className="flex items-center gap-1">
              <div className="flex-1 min-w-0 space-y-1.5">
                <EndpointRow
                  label="地点A"
                  endpoint={islSettings.endpointA}
                  groundStations={groundStations}
                  onChange={(ep) => updateEndpoint("endpointA", ep)}
                />
                <EndpointRow
                  label="地点B"
                  endpoint={islSettings.endpointB}
                  groundStations={groundStations}
                  onChange={(ep) => updateEndpoint("endpointB", ep)}
                />
              </div>
              <button
                type="button"
                data-slot="icon-button"
                onClick={swapEndpoints}
                title="A/B を入替"
                aria-label="A/B を入替"
                className="shrink-0 p-1.5 rounded-md bg-transparent border-0 text-fg-muted hover:text-brand-text hover:bg-raised-hover transition-colors"
              >
                <ArrowUpDown className="h-4 w-4" />
              </button>
            </div>
          </FieldGroup>

          {enabled && (
            <FieldGroup title="② 経路の選び方">
              <SegmentedControl<PolicyChoice>
                ariaLabel="経路の選び方"
                value={policy}
                options={[
                  ...ISL_COST_PRESETS.map((p) => ({ value: p.id as PolicyChoice, label: p.label })),
                  { value: "custom", label: "カスタム" },
                ]}
                onChange={choosePolicy}
              />
              {presetDescription && (
                <p className="text-[11px] leading-relaxed text-fg-subtle">{presetDescription}</p>
              )}
              {policy === "custom" && (
                <div className="space-y-3 pt-1">
                  <FieldSlider
                    label="中継ペナルティ"
                    value={islSettings.cost.hopPenaltyMs}
                    min={0}
                    max={20}
                    step={0.5}
                    format={(v) => `${v} ms`}
                    help="中継する衛星 1 機ごとに加算される遅延。大きくするほど中継数の少ない経路を優先します。0 で純粋な最短遅延経路。"
                    onChange={(v) => updateCost({ hopPenaltyMs: v })}
                  />
                  <FieldSlider
                    label="切替えにくさ"
                    value={islSettings.cost.switchDiscount}
                    min={0}
                    max={0.5}
                    step={0.01}
                    format={(v) => `${Math.round(v * 100)}%`}
                    help="今の経路をこの割合ぶん割安に扱い、頻繁な経路切替(フラッピング)を抑えます(ヒステリシス)。0% で毎回コスト最小の経路に切り替わります。"
                    onChange={(v) => updateCost({ switchDiscount: v })}
                  />
                  <FieldSlider
                    label="先読み回避"
                    value={islSettings.cost.stabilityWeightMs ?? 0}
                    min={0}
                    max={50}
                    step={1}
                    format={(v) => `${v} ms`}
                    help="前方 300 秒を先読みし、もうすぐ切れるリンクを避けます。0 = 無効。有効にすると再計算が重くなります。"
                    onChange={(v) => updateCost({ stabilityWeightMs: v })}
                  />
                  <div className="space-y-1">
                    <span className="inline-flex items-center gap-0.5 text-xs text-fg">
                      リンク種別ごとの追加コスト
                      <HelpTip text="リンク種別ごとの固定加算(ms)。ISL(衛星間)を避けたい場合は ISL 側を、GSL(地上⇔衛星)を避けたい場合は GSL 側を大きくします。" />
                    </span>
                    <div className="flex items-center gap-3">
                      <NumField
                        inline
                        label="GSL"
                        value={islSettings.cost.kindPenaltyMs?.gsl ?? 0}
                        onChange={(v) => updateCost({ kindPenaltyMs: { ...islSettings.cost.kindPenaltyMs, gsl: v } })}
                      />
                      <NumField
                        inline
                        label="ISL"
                        value={islSettings.cost.kindPenaltyMs?.isl ?? 0}
                        onChange={(v) => updateCost({ kindPenaltyMs: { ...islSettings.cost.kindPenaltyMs, isl: v } })}
                      />
                      <span className="text-[11px] text-fg-subtle">ms</span>
                    </div>
                  </div>
                </div>
              )}
            </FieldGroup>
          )}
        </div>
      </PanelSection>

      {enabled && (
        <>
          {/* 結果 — 設定のすぐ下に置き、パラメータ操作→数値変化のループを 1 画面で成立させる */}
          <PanelSection title="現在の経路" icon={<Gauge />}>
            <div className="space-y-3">
              {islError && <div className="text-xs text-danger bg-danger-soft rounded p-1.5">{islError}</div>}
              {missingEndpoints.length > 0 ? (
                <p className="text-xs text-brand-text">
                  地点 {missingEndpoints.join(" と ")} が未設定です。① で地点を選ぶと計算を始めます。
                </p>
              ) : sameEndpoints ? (
                <p className="text-xs text-brand-text">地点 A と B が同じです。別の地点を選んでください。</p>
              ) : !islResult ? (
                <p className="text-sm text-fg-muted tabular-nums">計算中…</p>
              ) : !islResult.reachable ? (
                <p className="text-sm text-danger">
                  経路なし（{hasZeroParticipants ? "参加衛星が 0 機です" : "この時刻はつながる経路がありません"}）
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-1.5 tabular-nums">
                    <KpiCard value={islResult.totalDelayMs.toFixed(1)} unit="ms" label="総遅延" />
                    <KpiCard value={String(islResult.hopCount)} unit="機" label="中継衛星" />
                    <KpiCard
                      value={Math.round(islResult.totalDistanceKm).toLocaleString()}
                      unit="km"
                      label="総距離"
                    />
                  </div>
                  <dl className="space-y-1 text-xs tabular-nums">
                    <ResultRow label="うち伝搬遅延">
                      {propagationDelayMs(islResult.totalDistanceKm).toFixed(2)} ms
                    </ResultRow>
                    <ResultRow label="うち追加コスト">
                      {(islResult.totalDelayMs - propagationDelayMs(islResult.totalDistanceKm)).toFixed(2)} ms
                    </ResultRow>
                    <ResultRow label="経路の切替">
                      {islSwitchCount} 回
                      {islLastSwitchSimMs !== null &&
                        `（直近から ${Math.max(0, (currentSimMs - islLastSwitchSimMs) / 1000).toFixed(0)} 秒）`}
                    </ResultRow>
                  </dl>
                </>
              )}
              {onOpenTimelineAnalysis && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full bg-raised text-fg border border-line-strong hover:bg-raised-hover hover:text-fg"
                  onClick={onOpenTimelineAnalysis}
                >
                  <LineChart className="h-3.5 w-3.5 mr-1" />
                  時間変化をタイムライン解析で見る
                </Button>
              )}
              {islResult && (
                <p className="text-[11px] text-fg-subtle tabular-nums">
                  候補リンク {islResult.candidateEdgeCount.toLocaleString()} 本 · 計算 {islResult.computeTimeMs.toFixed(1)} ms
                </p>
              )}
            </div>
          </PanelSection>

          {/* 詳細設定 — 一度決めたら普段は触らない設定 */}
          <PanelSection title="ISL の詳細設定" icon={<Layers />} collapsible defaultOpen={false}>
            <div className="space-y-4">
              <FieldGroup title="参加する衛星">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="isl-include-base"
                    checked={islSettings.includeBaseSatellites}
                    onCheckedChange={() => toggleIncludeBase()}
                  />
                  <Label htmlFor="isl-include-base" className="text-sm text-fg">
                    個別衛星 (satellites.toml) を含める
                  </Label>
                </div>
                {islShellRanges.map((shell) => (
                  <div key={shell.key} className="flex items-center gap-2">
                    <Checkbox
                      id={`isl-shell-${shell.key}`}
                      checked={!islSettings.excludedShellKeys.includes(shell.key)}
                      onCheckedChange={() => toggleShell(shell.key)}
                    />
                    <Label htmlFor={`isl-shell-${shell.key}`} className="text-sm text-fg">
                      {shell.name || `シェル ${Number(shell.key) + 1}`} ({shell.count} 機)
                    </Label>
                  </div>
                ))}
                {islShellRanges.length === 0 && (
                  <p className="text-xs text-fg-subtle">constellation.toml にシェルがありません。</p>
                )}
                {hasZeroParticipants && (
                  <p className="text-xs text-danger">
                    参加衛星が 0 機です。経路は常に到達不能になります。
                  </p>
                )}
              </FieldGroup>

              <FieldGroup title="リンクが成立する距離">
                <FieldSlider
                  label="最大距離"
                  value={islSettings.linkModel.maxRangeKm}
                  min={100}
                  max={20000}
                  step={100}
                  format={(v) => `${v.toLocaleString()} km`}
                  help="ISL・GSL 共通の最大リンク距離(通信端末の性能に相当。既定 5,000 km)。小さくすると低仰角の遠い衛星が経路に選ばれにくくなります。"
                  onChange={(v) =>
                    onIslSettingsChange({
                      ...islSettings,
                      linkModel: { ...islSettings.linkModel, maxRangeKm: v },
                    })
                  }
                />
                <FieldSlider
                  label="遮蔽マージン"
                  value={islSettings.linkModel.losMarginKm}
                  min={0}
                  max={500}
                  step={10}
                  format={(v) => `${v} km`}
                  help="ISL が地球の縁をかすめるのを避ける余裕高度(既定 80 km)。GSL には適用されません。"
                  onChange={(v) =>
                    onIslSettingsChange({
                      ...islSettings,
                      linkModel: { ...islSettings.linkModel, losMarginKm: v },
                    })
                  }
                />
              </FieldGroup>

              <FieldGroup title="シェル別リンク方式">
                <p className="text-[11px] leading-relaxed text-fg-subtle">
                  gridPattern は面内前後 2 機 + 隣接面同スロット 2 機に限定した固定トポロジで、大規模構成での候補生成が高速です。シェル間リンクは常に dynamic。空欄の項目は上の共通設定を使います。
                </p>
                {islShellRanges.map((shell) => (
                  <ShellOverrideRow
                    key={shell.key}
                    shell={shell}
                    override={islSettings.shellLinkModels?.[shell.key]}
                    onChange={(patch) => updateShellLinkModel(shell.key, patch)}
                  />
                ))}
                {islShellRanges.length === 0 && (
                  <p className="text-xs text-fg-subtle">constellation.toml にシェルがありません。</p>
                )}
              </FieldGroup>

              <FieldGroup title="計算">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-0.5 text-xs text-fg">
                    再計算間隔
                    <HelpTip text="経路を再計算するシミュレーション時間の間隔(秒)。小さくすると経路の追従が細かくなりますが計算負荷が上がります。" />
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <NumField
                      inline
                      label=""
                      value={islSettings.recomputeIntervalSimS}
                      min={1}
                      step="1"
                      onChange={(v) => onIslSettingsChange({ ...islSettings, recomputeIntervalSimS: v })}
                    />
                    <span className="text-[11px] text-fg-subtle">sim秒</span>
                  </span>
                </div>
              </FieldGroup>

              <FieldGroup title="経路の表示色">
                <ColorRow
                  label="GSL 区間（地上⇔衛星）"
                  value={islSettings.gslColor}
                  onChange={(c) => onIslSettingsChange({ ...islSettings, gslColor: c })}
                />
                <ColorRow
                  label="ISL 区間（衛星⇔衛星）"
                  value={islSettings.islColor}
                  onChange={(c) => onIslSettingsChange({ ...islSettings, islColor: c })}
                />
              </FieldGroup>
            </div>
          </PanelSection>
        </>
      )}
    </>
  );
}

/** A full-width on/off row: the whole row is the switch, so it reads as one control. */
function SwitchRow({
  checked,
  onChange,
  label,
  detail,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      data-slot="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
        checked ? "border-brand/50 bg-brand-soft" : "border-line-strong bg-raised hover:bg-raised-hover"
      }`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">{label}</span>
        <span className={`block text-[11px] ${checked ? "text-brand-text" : "text-fg-muted"}`}>{detail}</span>
      </span>
      <span
        aria-hidden
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-brand" : "bg-raised-hover border border-line-strong"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-[2px]"
          }`}
        />
      </span>
    </button>
  );
}

function KpiCard({ value, unit, label }: { value: string; unit: string; label: string }) {
  return (
    <div className="bg-sunken border border-line rounded-md px-1.5 py-1 text-center">
      <div className="text-base font-semibold text-fg leading-tight">
        {value}
        <span className="text-[10px] font-normal text-fg-muted ml-0.5">{unit}</span>
      </div>
      <div className="text-[10px] text-fg-muted">{label}</div>
    </div>
  );
}

function ResultRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="m-0 text-right text-fg">{children}</dd>
    </div>
  );
}

const ADHOC_VALUE = "__adhoc__";

function EndpointRow({
  label,
  endpoint,
  groundStations,
  onChange,
}: {
  label: string;
  endpoint: IslEndpoint | null;
  groundStations: GroundStation[];
  onChange: (endpoint: IslEndpoint | null) => void;
}) {
  // One picker: the station itself, or "座標を指定…" for an ad-hoc point.
  const value = endpoint === null ? "" : endpoint.kind === "adhoc" ? ADHOC_VALUE : `station:${endpoint.name}`;

  function handleChange(next: string) {
    if (next === "") onChange(null);
    else if (next === ADHOC_VALUE) onChange(endpoint?.kind === "adhoc" ? endpoint : defaultAdhocEndpoint(label));
    else {
      const gs = groundStations.find((s) => `station:${s.name}` === next);
      if (gs) onChange(stationEndpoint(gs));
    }
  }

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold text-fg-muted w-9 shrink-0">{label}</span>
        <select
          className="flex-1 min-w-0 bg-raised text-fg rounded px-1 py-1 text-xs"
          aria-label={`${label}の地点`}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
        >
          <option value="">未設定</option>
          {groundStations.length > 0 && (
            <optgroup label="地上局">
              {groundStations.map((gs) => (
                <option key={gs.name} value={`station:${gs.name}`}>
                  {gs.name}
                </option>
              ))}
            </optgroup>
          )}
          <option value={ADHOC_VALUE}>座標を指定…</option>
        </select>
      </div>

      {endpoint?.kind === "adhoc" && (
        <div className="grid grid-cols-2 gap-1.5 mt-1 pl-[42px]">
          <NumField
            label="緯度(deg)"
            value={endpoint.latitudeDeg}
            onChange={(v) => onChange({ ...endpoint, latitudeDeg: v })}
          />
          <NumField
            label="経度(deg)"
            value={endpoint.longitudeDeg}
            onChange={(v) => onChange({ ...endpoint, longitudeDeg: v })}
          />
          <NumField
            label="高度(km)"
            value={endpoint.heightKm}
            onChange={(v) => onChange({ ...endpoint, heightKm: v })}
          />
          <NumField
            label="最低仰角(deg)"
            value={endpoint.minElevationDeg}
            onChange={(v) => onChange({ ...endpoint, minElevationDeg: v })}
          />
        </div>
      )}
    </div>
  );
}

function ShellOverrideRow({
  shell,
  override,
  onChange,
}: {
  shell: IslShellRange;
  override: Partial<IslLinkModel> | undefined;
  onChange: (patch: Partial<IslLinkModel>) => void;
}) {
  const mode = override?.mode ?? "dynamic";
  return (
    <div className="border border-line-strong rounded-md p-2 mb-2">
      <div className="text-xs font-semibold text-fg-muted mb-1">
        {shell.name || `シェル ${Number(shell.key) + 1}`} ({shell.count} 機, {shell.planes} 面)
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <label className="text-xs text-fg-muted">
          リンク方式
          <select
            className="w-full bg-raised text-fg rounded px-1 py-0.5 mt-0.5"
            value={mode}
            onChange={(e) => onChange({ mode: e.target.value as IslLinkModel["mode"] })}
          >
            <option value="dynamic">dynamic</option>
            <option value="gridPattern">gridPattern</option>
          </select>
        </label>
        <label className="text-xs text-fg-muted">
          最大距離(km)
          <input
            type="number"
            step="100"
            placeholder="共通設定を使用"
            className="w-full bg-raised text-fg rounded px-1 py-0.5 mt-0.5"
            value={override?.maxRangeKm ?? ""}
            onChange={(e) =>
              onChange({ maxRangeKm: e.target.value === "" ? undefined : Number(e.target.value) })
            }
          />
        </label>
        <label className="text-xs text-fg-muted">
          遮蔽マージン(km)
          <input
            type="number"
            step="10"
            placeholder="共通設定を使用"
            className="w-full bg-raised text-fg rounded px-1 py-0.5 mt-0.5"
            value={override?.losMarginKm ?? ""}
            onChange={(e) =>
              onChange({ losMarginKm: e.target.value === "" ? undefined : Number(e.target.value) })
            }
          />
        </label>
      </div>
    </div>
  );
}

const NUM_FIELD_DEBOUNCE_MS = 300;

/**
 * Numeric text input that can be cleared (or hold a bare "-") while typing
 * without snapping to 0, and debounces the committed `onChange` so each
 * keystroke doesn't trigger its own ISL recompute.
 */
function NumField({
  label,
  value,
  onChange,
  min,
  step = "0.0001",
  inline = false,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  /** Clamped up to on commit, e.g. for a "at least 1" setting. */
  min?: number;
  step?: string;
  /** Render as a compact one-line "label + input" pair. */
  inline?: boolean;
}) {
  const [draft, setDraft] = useState<string>(String(value));
  const timerRef = useRef<number | undefined>(undefined);

  // Preserve a draft such as "1." until the external numeric value changes.
  const [previousValue, setPreviousValue] = useState(value);
  if (!Object.is(previousValue, value)) {
    setPreviousValue(value);
    if (!Object.is(parseNumericInput(draft), value)) setDraft(String(numericInputValue(value)));
  }

  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    };
  }, []);

  function handleChange(raw: string) {
    setDraft(raw);
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const n = parseNumericInput(raw);
      if (Number.isFinite(n)) onChange(min !== undefined ? Math.max(min, n) : n);
    }, NUM_FIELD_DEBOUNCE_MS);
  }

  if (inline) {
    return (
      <label className="inline-flex items-center gap-1 text-xs text-fg-muted">
        {label}
        <input
          type="number"
          min={min}
          step={step}
          className="w-14 bg-raised text-fg rounded px-1 py-0.5"
          value={draft}
          onChange={(e) => handleChange(e.target.value)}
        />
      </label>
    );
  }

  return (
    <label className="text-xs text-fg-muted">
      {label}
      <input
        type="number"
        min={min}
        step={step}
        className="w-full bg-raised text-fg rounded px-1 py-0.5 mt-0.5"
        value={draft}
        onChange={(e) => handleChange(e.target.value)}
      />
    </label>
  );
}
