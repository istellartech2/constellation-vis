import { useEffect, useMemo, useRef, useState } from "react";
import PanelSection from "./PanelSection";
import { Checkbox } from "./checkbox";
import { Label } from "./label";
import { Button } from "./button";
import { ArrowUpDown, Radio, Gauge, Layers, LineChart } from "lucide-react";
import { parseGroundStationsToml } from "../../lib/tomlParsers";
import type { GroundStation } from "../../lib/groundStations";
import { numericInputValue, parseNumericInput } from "../../lib/numericInput";
import { propagationDelayMs } from "../../lib/isl/cost";
import {
  DEFAULT_ADHOC_MIN_ELEVATION_DEG,
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
  /** Cumulative count of path switches since ISL was enabled (Phase 2) */
  islSwitchCount: number;
  /** Sim-time (ms) of the last path switch, or null if none yet */
  islLastSwitchSimMs: number | null;
  /** Current simulation time (ms) */
  currentSimMs: number;
  /** Opens the ISL timeline analysis (解析タブのモーダル) directly from the result card. */
  onOpenTimelineAnalysis?: () => void;
  /** Ground-station communication cone display (通信タブへ移設した表示設定) */
  showGroundStationCones: boolean;
  onShowGroundStationConesChange: (v: boolean) => void;
  groundConeMinElevationDeg: number;
  onGroundConeMinElevationDegChange: (v: number) => void;
  groundConeDistanceKm: number;
  onGroundConeDistanceKmChange: (v: number) => void;
  groundConeColor: string;
  onGroundConeColorChange: (color: string) => void;
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

export default function IslTab({
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
  showGroundStationCones,
  onShowGroundStationConesChange,
  groundConeMinElevationDeg,
  onGroundConeMinElevationDegChange,
  groundConeDistanceKm,
  onGroundConeDistanceKmChange,
  groundConeColor,
  onGroundConeColorChange,
}: Props) {
  const groundStations = useMemo(() => {
    try {
      return parseGroundStationsToml(gsText);
    } catch {
      return [];
    }
  }, [gsText]);

  // No participants at all is a distinct, valid state (H-2) — not the same as
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

  return (
    <div className="space-y-3">
      {/* 1. 経路探索 — 地点選択と有効化。常に表示する唯一の設定入口 */}
      <PanelSection
        title="経路探索"
        icon={<Radio />}
        action={
          <div className="flex items-center gap-1.5">
            <span className={`text-xs ${enabled ? "text-orange-300" : "text-gray-400"}`}>
              {enabled ? "有効" : "無効"}
            </span>
            <ToggleSwitch
              checked={enabled}
              onChange={(v) => onIslSettingsChange({ ...islSettings, enabled: v })}
              ariaLabel="ISL 経路探索を有効化"
            />
          </div>
        }
      >
        <EndpointEditor
          label="地点 A"
          endpoint={islSettings.endpointA}
          groundStations={groundStations}
          onChange={(ep) => updateEndpoint("endpointA", ep)}
        />
        <div className="flex justify-center -my-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-gray-400 hover:text-gray-200"
            onClick={swapEndpoints}
            title="A/B を入替"
            aria-label="A/B を入替"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
          </Button>
        </div>
        <EndpointEditor
          label="地点 B"
          endpoint={islSettings.endpointB}
          groundStations={groundStations}
          onChange={(ep) => updateEndpoint("endpointB", ep)}
        />
        {!enabled && (
          <p className="text-xs text-gray-400 mt-2">
            地点 A と B を選び、右上のスイッチで有効化すると、衛星間リンク (ISL)
            を経由する 2 地点間の最短経路を計算して 3D 表示します。
          </p>
        )}
        <p className="text-[11px] text-gray-500 mt-1.5">
          既存局を選んだ場合の通信判定は仰角のみです(観測用の視野設定 visibilityMode /
          maxOffNadirDeg は使いません)。
        </p>
      </PanelSection>

      {enabled && (
        <>
          {/* 2. 結果 — 設定より上に置き、パラメータ操作→数値変化のループを 1 画面で成立させる */}
          <PanelSection title="結果" icon={<Gauge />}>
            {missingEndpoints.length > 0 ? (
              <p className="text-xs text-amber-400">
                地点 {missingEndpoints.join(" と ")} が未設定です。上の「経路探索」で地点を選択すると
                計算を開始します。
              </p>
            ) : !islResult ? (
              <p className="text-sm text-gray-400 tabular-nums">計算中…</p>
            ) : !islResult.reachable ? (
              <p className="text-sm text-red-400">
                経路なし(到達不能{hasZeroParticipants ? " / 参加衛星 0" : ""})
              </p>
            ) : (
              <div className="space-y-1.5">
                <div className="grid grid-cols-3 gap-1.5 tabular-nums">
                  <KpiCard value={islResult.totalDelayMs.toFixed(1)} unit="ms" label="総遅延" />
                  <KpiCard value={String(islResult.hopCount)} unit="hop" label="中継衛星" />
                  <KpiCard
                    value={Math.round(islResult.totalDistanceKm).toLocaleString()}
                    unit="km"
                    label="総距離"
                  />
                </div>
                <div className="text-xs text-gray-400 tabular-nums">
                  伝搬遅延 {propagationDelayMs(islResult.totalDistanceKm).toFixed(2)} ms + 追加コスト{" "}
                  {(islResult.totalDelayMs - propagationDelayMs(islResult.totalDistanceKm)).toFixed(2)}{" "}
                  ms
                </div>
                <div className="text-xs text-gray-400 tabular-nums">
                  経路切替 {islSwitchCount} 回
                  {islLastSwitchSimMs !== null &&
                    ` ・ 直近の切替から ${Math.max(0, (currentSimMs - islLastSwitchSimMs) / 1000).toFixed(0)} 秒`}
                </div>
              </div>
            )}
            {onOpenTimelineAnalysis && (
              <Button
                variant="secondary"
                size="sm"
                className="w-full mt-1.5"
                onClick={onOpenTimelineAnalysis}
              >
                <LineChart className="h-3.5 w-3.5 mr-1" />
                タイムライン解析を開く
              </Button>
            )}
          </PanelSection>

          {/* 3. 経路の重み付け — 探索的に動かして経路の変化を見るための設定 */}
          <PanelSection title="経路の重み付け" icon={<Gauge />} collapsible defaultOpen={false}>
            <p className="text-xs text-gray-400 mb-2">
              総遅延 = 伝搬遅延(距離 ÷ 光速)+ 下記の追加コスト。値を大きくすると、その要素を避ける
              経路が選ばれます。変更は即時反映されます。
            </p>
            <CostSlider
              label="中継ペナルティ(衛星1機あたり)"
              value={islSettings.cost.hopPenaltyMs}
              min={0}
              max={20}
              step={0.5}
              unit="ms"
              hint="大きくするほど中継数の少ない経路を優先します。0 で純粋な最短遅延経路になります。"
              onChange={(v) =>
                onIslSettingsChange({ ...islSettings, cost: { ...islSettings.cost, hopPenaltyMs: v } })
              }
            />
            <CostSlider
              label="経路の切替えにくさ(ヒステリシス)"
              value={islSettings.cost.switchDiscount}
              min={0}
              max={0.5}
              step={0.01}
              unit=""
              format={(v) => `${Math.round(v * 100)}%`}
              hint="今の経路をこの割合ぶん割安に扱い、頻繁な経路切替(フラッピング)を抑えます。0% で毎回コスト最小の経路に切り替わります。"
              onChange={(v) =>
                onIslSettingsChange({ ...islSettings, cost: { ...islSettings.cost, switchDiscount: v } })
              }
            />
            <div className="grid grid-cols-2 gap-2 mt-1">
              <NumField
                label="GSL ペナルティ(ms)"
                value={islSettings.cost.kindPenaltyMs?.gsl ?? 0}
                onChange={(v) =>
                  onIslSettingsChange({
                    ...islSettings,
                    cost: {
                      ...islSettings.cost,
                      kindPenaltyMs: { ...islSettings.cost.kindPenaltyMs, gsl: v },
                    },
                  })
                }
              />
              <NumField
                label="ISL ペナルティ(ms)"
                value={islSettings.cost.kindPenaltyMs?.isl ?? 0}
                onChange={(v) =>
                  onIslSettingsChange({
                    ...islSettings,
                    cost: {
                      ...islSettings.cost,
                      kindPenaltyMs: { ...islSettings.cost.kindPenaltyMs, isl: v },
                    },
                  })
                }
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              リンク種別(GSL = 地上⇔衛星 / ISL = 衛星⇔衛星)ごとの固定加算。ISL
              を避けたい場合は ISL 側を大きくします。
            </p>
            <CostSlider
              label="切れそうなリンクの回避(先読み)"
              value={islSettings.cost.stabilityWeightMs ?? 0}
              min={0}
              max={50}
              step={1}
              unit="ms"
              hint="前方 300 秒を先読みし、もうすぐ切れるリンクを避けます。0 = 無効(既定)。有効にすると再計算が重くなります。"
              onChange={(v) =>
                onIslSettingsChange({ ...islSettings, cost: { ...islSettings.cost, stabilityWeightMs: v } })
              }
            />
          </PanelSection>

          {/* 4. 詳細設定 — 一度決めたら普段は触らない設定 */}
          <PanelSection title="詳細設定" icon={<Layers />} collapsible defaultOpen={false}>
            <SubHeader first>参加衛星</SubHeader>
            <div className="flex items-center gap-2">
              <Checkbox
                id="isl-include-base"
                checked={islSettings.includeBaseSatellites}
                onCheckedChange={() => toggleIncludeBase()}
              />
              <Label htmlFor="isl-include-base" className="text-sm text-gray-200">
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
                <Label htmlFor={`isl-shell-${shell.key}`} className="text-sm text-gray-200">
                  {shell.name || `シェル ${Number(shell.key) + 1}`} ({shell.count} 機)
                </Label>
              </div>
            ))}
            {islShellRanges.length === 0 && (
              <p className="text-xs text-gray-500">constellation.toml にシェルがありません。</p>
            )}
            {hasZeroParticipants && (
              <p className="text-xs text-red-400">
                参加衛星が 0 機です。経路は常に到達不能になります。
              </p>
            )}

            <SubHeader>リンク距離制限</SubHeader>
            <CostSlider
              label="最大リンク距離"
              value={islSettings.linkModel.maxRangeKm}
              min={100}
              max={20000}
              step={100}
              unit="km"
              hint="ISL・GSL 共通の上限(通信端末の性能に相当)。小さくすると低仰角の遠い衛星が経路に選ばれにくくなります(既定 5,000 km)。"
              onChange={(v) =>
                onIslSettingsChange({
                  ...islSettings,
                  linkModel: { ...islSettings.linkModel, maxRangeKm: v },
                })
              }
            />
            <CostSlider
              label="地球遮蔽マージン(ISL のみ)"
              value={islSettings.linkModel.losMarginKm}
              min={0}
              max={500}
              step={10}
              unit="km"
              hint="ISL が地球の縁をかすめるのを避ける余裕高度(既定 80 km)。GSL には適用されません。"
              onChange={(v) =>
                onIslSettingsChange({
                  ...islSettings,
                  linkModel: { ...islSettings.linkModel, losMarginKm: v },
                })
              }
            />

            <SubHeader>シェル別リンク方式</SubHeader>
            <p className="text-xs text-gray-400 mb-1">
              gridPattern は面内前後 2 機 + 隣接面同スロット 2 機に限定した固定トポロジで、
              大規模構成での候補生成が高速です。シェル間リンクは常に dynamic として扱われます。
              未設定の項目は上の共通設定を使います。
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
              <p className="text-xs text-gray-500">constellation.toml にシェルがありません。</p>
            )}

            <SubHeader>経路の表示色</SubHeader>
            <div className="option-color-grid">
              <div className="option-color-row">
                <span className="option-color-label">GSL 区間</span>
                <input
                  className="option-color-input"
                  type="color"
                  value={islSettings.gslColor}
                  onChange={(e) => onIslSettingsChange({ ...islSettings, gslColor: e.target.value })}
                />
                <span className="option-color-value">{islSettings.gslColor.toUpperCase()}</span>
              </div>
              <div className="option-color-row">
                <span className="option-color-label">ISL 区間</span>
                <input
                  className="option-color-input"
                  type="color"
                  value={islSettings.islColor}
                  onChange={(e) => onIslSettingsChange({ ...islSettings, islColor: e.target.value })}
                />
                <span className="option-color-value">{islSettings.islColor.toUpperCase()}</span>
              </div>
            </div>
          </PanelSection>

          {/* 5. 診断 — 開発者向け */}
          <PanelSection title="診断" icon={<Gauge />} collapsible defaultOpen={false}>
            <div className="text-xs text-gray-400 space-y-1 tabular-nums">
              {islError && (
                <div className="text-red-400 bg-red-900/20 rounded p-1.5 mb-1">{islError}</div>
              )}
              <div>候補エッジ数: {islResult?.candidateEdgeCount ?? "-"}</div>
              <div>計算時間: {islResult ? `${islResult.computeTimeMs.toFixed(2)} ms` : "-"}</div>
              <div className="w-32">
                <NumField
                  label="再計算間隔(sim秒)"
                  value={islSettings.recomputeIntervalSimS}
                  min={1}
                  step="1"
                  onChange={(v) => onIslSettingsChange({ ...islSettings, recomputeIntervalSimS: v })}
                />
              </div>
            </div>
          </PanelSection>
        </>
      )}

      {/* 地上局の通信範囲コーン — 経路探索とは独立した通信系の表示設定(旧・設定タブから移設) */}
      <PanelSection title="地上局の通信範囲(コーン表示)" icon={<Radio />} collapsible defaultOpen={false}>
        <div className="flex items-center gap-2">
          <Checkbox
            id="isl-gs-cones"
            checked={showGroundStationCones}
            onCheckedChange={(v) => onShowGroundStationConesChange(v === true)}
          />
          <Label htmlFor="isl-gs-cones" className="text-sm text-gray-200">
            地上局の通信可能範囲を表示
          </Label>
        </div>
        {showGroundStationCones && (
          <div className="mt-1.5">
            <CostSlider
              label="最小仰角しきい値"
              value={groundConeMinElevationDeg}
              min={0}
              max={85}
              step={1}
              unit="°"
              onChange={onGroundConeMinElevationDegChange}
            />
            <CostSlider
              label="可視距離上限"
              value={groundConeDistanceKm}
              min={100}
              max={20000}
              step={50}
              unit="km"
              format={(v) => `${Math.round(v).toLocaleString()} km`}
              onChange={onGroundConeDistanceKmChange}
            />
            <div className="option-color-grid">
              <div className="option-color-row">
                <span className="option-color-label">表示カラー</span>
                <input
                  className="option-color-input"
                  type="color"
                  value={groundConeColor}
                  onChange={(e) => onGroundConeColorChange(e.target.value)}
                />
                <span className="option-color-value">{groundConeColor.toUpperCase()}</span>
              </div>
            </div>
          </div>
        )}
      </PanelSection>
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        checked ? "bg-orange-600" : "bg-gray-600"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-[19px]" : "translate-x-[3px]"
        }`}
      />
    </button>
  );
}

function KpiCard({ value, unit, label }: { value: string; unit: string; label: string }) {
  return (
    <div className="bg-gray-900/60 border border-gray-700 rounded-md px-1.5 py-1 text-center">
      <div className="text-base font-semibold text-gray-100 leading-tight">
        {value}
        <span className="text-[10px] font-normal text-gray-400 ml-0.5">{unit}</span>
      </div>
      <div className="text-[10px] text-gray-400">{label}</div>
    </div>
  );
}

function SubHeader({ children, first = false }: { children: string; first?: boolean }) {
  return (
    <div
      className={`text-[11px] font-semibold uppercase tracking-wide text-gray-300 ${
        first ? "" : "mt-3"
      } mb-1 pb-0.5 border-b border-gray-700`}
    >
      {children}
    </div>
  );
}

function EndpointEditor({
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
  const mode = endpoint === null ? "none" : endpoint.kind;

  function handleModeChange(next: "none" | "station" | "adhoc") {
    if (next === "none") {
      onChange(null);
    } else if (next === "adhoc") {
      onChange(defaultAdhocEndpoint(label));
    } else {
      const first = groundStations[0];
      if (first) {
        onChange(stationEndpoint(first));
      } else {
        onChange(defaultAdhocEndpoint(label));
      }
    }
  }

  return (
    <div className="border border-gray-600 rounded-md p-2">
      <div className="text-xs font-semibold text-gray-300 mb-1">{label}</div>
      <select
        className="w-full bg-gray-700 text-gray-100 rounded px-1 py-1 text-sm mb-1"
        value={mode}
        onChange={(e) => handleModeChange(e.target.value as "none" | "station" | "adhoc")}
      >
        <option value="none">(未設定)</option>
        <option value="station">既存地上局から選択</option>
        <option value="adhoc">臨時地点を入力</option>
      </select>

      {endpoint?.kind === "station" && (
        <select
          className="w-full bg-gray-700 text-gray-100 rounded px-1 py-1 text-sm"
          value={endpoint.name}
          onChange={(e) => {
            const gs = groundStations.find((s) => s.name === e.target.value);
            if (gs) onChange(stationEndpoint(gs));
          }}
        >
          {groundStations.map((gs) => (
            <option key={gs.name} value={gs.name}>
              {gs.name}
            </option>
          ))}
        </select>
      )}

      {endpoint?.kind === "adhoc" && (
        <div className="grid grid-cols-2 gap-1.5 mt-1">
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
    <div className="border border-gray-600 rounded-md p-2 mb-2">
      <div className="text-xs font-semibold text-gray-300 mb-1">
        {shell.name || `シェル ${Number(shell.key) + 1}`} ({shell.count} 機, {shell.planes} 面)
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <label className="text-xs text-gray-400">
          リンク方式
          <select
            className="w-full bg-gray-700 text-gray-100 rounded px-1 py-0.5 mt-0.5"
            value={mode}
            onChange={(e) => onChange({ mode: e.target.value as IslLinkModel["mode"] })}
          >
            <option value="dynamic">dynamic</option>
            <option value="gridPattern">gridPattern</option>
          </select>
        </label>
        <label className="text-xs text-gray-400">
          最大距離(km)
          <input
            type="number"
            step="100"
            placeholder="共通設定を使用"
            className="w-full bg-gray-700 text-gray-100 rounded px-1 py-0.5 mt-0.5"
            value={override?.maxRangeKm ?? ""}
            onChange={(e) =>
              onChange({ maxRangeKm: e.target.value === "" ? undefined : Number(e.target.value) })
            }
          />
        </label>
        <label className="text-xs text-gray-400">
          遮蔽マージン(km)
          <input
            type="number"
            step="10"
            placeholder="共通設定を使用"
            className="w-full bg-gray-700 text-gray-100 rounded px-1 py-0.5 mt-0.5"
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

function CostSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  format,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  format?: (v: number) => string;
  hint?: string;
  onChange: (v: number) => void;
}) {
  const valueText = format ? format(value) : `${value}${unit}`;
  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs text-gray-300 mb-0.5">
        <span>{label}</span>
        <span className="tabular-nums">{valueText}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
      {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
    </div>
  );
}

const NUM_FIELD_DEBOUNCE_MS = 300;

/**
 * Numeric text input that can be cleared (or hold a bare "-") while typing
 * without snapping to 0, and debounces the committed `onChange` so each
 * keystroke doesn't trigger its own ISL recompute (isl-routing-review.md M-1).
 */
function NumField({
  label,
  value,
  onChange,
  min,
  step = "0.0001",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  /** Clamped up to on commit, e.g. for a "at least 1" setting. */
  min?: number;
  step?: string;
}) {
  const [draft, setDraft] = useState<string>(String(value));
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    // Resync from external changes (e.g. A/B swap) — but not while the value
    // we'd commit from the current draft already matches, which would
    // otherwise clobber an in-progress edit (e.g. a trailing ".") on every
    // parent re-render.
    if (parseNumericInput(draft) !== value) setDraft(String(numericInputValue(value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

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

  return (
    <label className="text-xs text-gray-400">
      {label}
      <input
        type="number"
        min={min}
        step={step}
        className="w-full bg-gray-700 text-gray-100 rounded px-1 py-0.5 mt-0.5"
        value={draft}
        onChange={(e) => handleChange(e.target.value)}
      />
    </label>
  );
}
