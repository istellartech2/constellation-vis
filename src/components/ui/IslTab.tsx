import { useEffect, useMemo, useRef, useState } from "react";
import PanelSection from "./PanelSection";
import { Checkbox } from "./checkbox";
import { Label } from "./label";
import { Button } from "./button";
import { ArrowUpDown, Radio, Gauge, Layers, LineChart, Waypoints } from "lucide-react";
import { ColorChip, HelpTip, InlineSlider } from "./compactControls";
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
  /** Cumulative count of path switches since ISL was enabled */
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

/** ラベル列の共通幅(重み付け・詳細設定・診断の行を揃える。7文字 + ⓘ が収まる幅) */
const LABEL_W = "w-28";

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
      {/* 1. 地上局の通信範囲 — 常設のコンパクト表示設定 */}
      <PanelSection title="地上局の通信範囲" icon={<Radio />}>
        <div className="flex items-center gap-2">
          <Checkbox
            id="isl-gs-cones"
            checked={showGroundStationCones}
            onCheckedChange={(v) => onShowGroundStationConesChange(v === true)}
          />
          <Label htmlFor="isl-gs-cones" className="text-sm text-gray-200 flex-1">
            通信可能範囲を表示
          </Label>
          {showGroundStationCones && (
            <input
              type="color"
              className="option-color-input"
              value={groundConeColor}
              onChange={(e) => onGroundConeColorChange(e.target.value)}
              title="表示カラー"
              aria-label="表示カラー"
            />
          )}
        </div>
        {showGroundStationCones && (
          <>
            <InlineSlider
              label="最小仰角"
              value={groundConeMinElevationDeg}
              min={0}
              max={85}
              step={1}
              format={(v) => `${v.toFixed(0)}°`}
              onChange={onGroundConeMinElevationDegChange}
            />
            <InlineSlider
              label="距離上限"
              value={groundConeDistanceKm}
              min={100}
              max={20000}
              step={50}
              format={(v) => `${Math.round(v).toLocaleString()} km`}
              onChange={onGroundConeDistanceKmChange}
            />
          </>
        )}
      </PanelSection>

      {/* 2. 衛星間経路探索(ISL)グループ — 結果・重み付け・詳細・診断がこの機能に
          属することを背景色で示す。負マージンで背景だけを外側に広げ、中身の幅は
          他セクションと変えない(カード枠で幅が狭くなるのを避ける) */}
      <div className="-mx-3 px-3 pt-1 pb-1.5 rounded-lg bg-gray-900/35">
      <PanelSection
        title="衛星間経路探索(ISL)"
        icon={<Waypoints />}
        action={
          <div className="flex items-center gap-1.5 leading-none">
            <span className={`text-xs ${enabled ? "text-orange-300" : "text-gray-400"}`}>
              {enabled ? "有効" : "無効"}
            </span>
            <ToggleSwitch
              checked={enabled}
              onChange={(v) => onIslSettingsChange({ ...islSettings, enabled: v })}
              ariaLabel="衛星間経路探索を有効化"
            />
          </div>
        }
      >
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
            className="shrink-0 p-1.5 rounded-md bg-transparent border-0 text-gray-400 hover:text-orange-300 hover:bg-gray-700/70 transition-colors"
          >
            <ArrowUpDown className="h-4 w-4" />
          </button>
        </div>
        {!enabled && (
          <p className="text-xs text-gray-400 mt-1.5">
            地点 A・B を選んで有効化すると、衛星間リンク (ISL) 経由の最短通信経路を 3D 表示します。
          </p>
        )}
        <p className="text-[11px] text-gray-500 mt-1">
          地上局の通信判定は最低仰角のみを使います。
        </p>
      </PanelSection>

      {enabled && (
        <>
          {/* 3. 結果 — 設定より上に置き、パラメータ操作→数値変化のループを 1 画面で成立させる */}
          <PanelSection title="結果" icon={<Gauge />}>
            {missingEndpoints.length > 0 ? (
              <p className="text-xs text-amber-400">
                地点 {missingEndpoints.join(" と ")} が未設定です。上で地点を選択すると計算を開始します。
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
                className="w-full mt-1.5 bg-gray-700 text-gray-200 border border-gray-600 hover:bg-gray-600 hover:text-white"
                onClick={onOpenTimelineAnalysis}
              >
                <LineChart className="h-3.5 w-3.5 mr-1" />
                タイムライン解析を開く
              </Button>
            )}
          </PanelSection>

          {/* 4. 経路の重み付け — 説明は ⓘ に格納してコンパクトに */}
          <PanelSection title="経路の重み付け" icon={<Gauge />} collapsible defaultOpen={false}>
            <InlineSlider
              label="中継ペナルティ"
              labelW={LABEL_W}
              value={islSettings.cost.hopPenaltyMs}
              min={0}
              max={20}
              step={0.5}
              format={(v) => `${v} ms`}
              help="中継する衛星 1 機ごとに加算される遅延。大きくするほど中継数の少ない経路を優先します。0 で純粋な最短遅延経路。"
              onChange={(v) =>
                onIslSettingsChange({ ...islSettings, cost: { ...islSettings.cost, hopPenaltyMs: v } })
              }
            />
            <InlineSlider
              label="切替えにくさ"
              labelW={LABEL_W}
              value={islSettings.cost.switchDiscount}
              min={0}
              max={0.5}
              step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              help="今の経路をこの割合ぶん割安に扱い、頻繁な経路切替(フラッピング)を抑えます(ヒステリシス)。0% で毎回コスト最小の経路に切り替わります。"
              onChange={(v) =>
                onIslSettingsChange({ ...islSettings, cost: { ...islSettings.cost, switchDiscount: v } })
              }
            />
            <InlineSlider
              label="先読み回避"
              labelW={LABEL_W}
              value={islSettings.cost.stabilityWeightMs ?? 0}
              min={0}
              max={50}
              step={1}
              format={(v) => `${v} ms`}
              help="前方 300 秒を先読みし、もうすぐ切れるリンクを避けます。0 = 無効(既定)。有効にすると再計算が重くなります。"
              onChange={(v) =>
                onIslSettingsChange({ ...islSettings, cost: { ...islSettings.cost, stabilityWeightMs: v } })
              }
            />
            {/* 幅が足りない画面では GSL/ISL の入力グループごとラベルの下へ折り返す */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className={`text-xs text-gray-300 ${LABEL_W} shrink-0 inline-flex items-center gap-0.5 whitespace-nowrap`}
              >
                種別ペナルティ
                <HelpTip text="リンク種別ごとの固定加算(ms)。ISL(衛星間)を避けたい場合は ISL 側を、GSL(地上⇔衛星)を避けたい場合は GSL 側を大きくします。" />
              </span>
              <span className="inline-flex items-center gap-2">
                <NumField
                  inline
                  label="GSL"
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
                  inline
                  label="ISL"
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
                <span className="text-[11px] text-gray-500">ms</span>
              </span>
            </div>
          </PanelSection>

          {/* 5. 詳細設定 — 一度決めたら普段は触らない設定 */}
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
            <InlineSlider
              label="最大距離"
              labelW={LABEL_W}
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
            <InlineSlider
              label="遮蔽マージン"
              labelW={LABEL_W}
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

            <SubHeader help="gridPattern は面内前後 2 機 + 隣接面同スロット 2 機に限定した固定トポロジで、大規模構成での候補生成が高速です。シェル間リンクは常に dynamic。未設定の項目は共通設定を使います。">
              シェル別リンク方式
            </SubHeader>
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
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <ColorChip
                label="GSL 区間"
                value={islSettings.gslColor}
                onChange={(c) => onIslSettingsChange({ ...islSettings, gslColor: c })}
              />
              <ColorChip
                label="ISL 区間"
                value={islSettings.islColor}
                onChange={(c) => onIslSettingsChange({ ...islSettings, islColor: c })}
              />
            </div>
          </PanelSection>

          {/* 6. 診断 — 開発者向け */}
          <PanelSection title="診断" icon={<Gauge />} collapsible defaultOpen={false}>
            <div className="text-xs text-gray-400 space-y-1.5 tabular-nums">
              {islError && (
                <div className="text-red-400 bg-red-900/20 rounded p-1.5 mb-1">{islError}</div>
              )}
              <div className="flex items-center gap-2">
                <span className={`${LABEL_W} shrink-0`}>候補エッジ数</span>
                <span className="text-gray-300">{islResult?.candidateEdgeCount ?? "-"}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`${LABEL_W} shrink-0`}>計算時間</span>
                <span className="text-gray-300">
                  {islResult ? `${islResult.computeTimeMs.toFixed(2)} ms` : "-"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`${LABEL_W} shrink-0 inline-flex items-center gap-0.5`}>
                  再計算間隔
                  <HelpTip text="経路を再計算するシミュレーション時間の間隔(秒)。小さくすると経路の追従が細かくなりますが計算負荷が上がります。" />
                </span>
                <NumField
                  inline
                  label=""
                  value={islSettings.recomputeIntervalSimS}
                  min={1}
                  step="1"
                  onChange={(v) => onIslSettingsChange({ ...islSettings, recomputeIntervalSimS: v })}
                />
                <span className="text-[11px] text-gray-500">sim秒</span>
              </div>
            </div>
          </PanelSection>
        </>
      )}
      </div>
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
      data-slot="switch"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-4 w-8 shrink-0 items-center rounded-full border-0 p-0 align-middle transition-colors ${
        checked ? "bg-orange-600" : "bg-gray-600"
      }`}
    >
      <span
        className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-[2px]"
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

function SubHeader({
  children,
  first = false,
  help,
}: {
  children: string;
  first?: boolean;
  help?: string;
}) {
  return (
    <div
      className={`text-[11px] font-semibold uppercase tracking-wide text-gray-300 ${
        first ? "" : "mt-3"
      } mb-1 pb-0.5 border-b border-gray-700 flex items-center gap-1`}
    >
      {children}
      {help && <HelpTip text={help} />}
    </div>
  );
}

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
    <div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold text-gray-300 w-9 shrink-0">{label}</span>
        <select
          className="w-[84px] shrink-0 bg-gray-700 text-gray-100 rounded px-1 py-1 text-xs"
          value={mode}
          onChange={(e) => handleModeChange(e.target.value as "none" | "station" | "adhoc")}
        >
          <option value="none">未設定</option>
          <option value="station">地上局</option>
          <option value="adhoc">臨時地点</option>
        </select>
        {endpoint?.kind === "station" && (
          <select
            className="flex-1 min-w-0 bg-gray-700 text-gray-100 rounded px-1 py-1 text-xs"
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

  if (inline) {
    return (
      <label className="inline-flex items-center gap-1 text-xs text-gray-400">
        {label}
        <input
          type="number"
          min={min}
          step={step}
          className="w-14 bg-gray-700 text-gray-100 rounded px-1 py-0.5"
          value={draft}
          onChange={(e) => handleChange(e.target.value)}
        />
      </label>
    );
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
