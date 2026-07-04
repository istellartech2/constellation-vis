import { useEffect, useMemo, useState } from "react";
import PanelSection from "./PanelSection";
import { Checkbox } from "./checkbox";
import { Label } from "./label";
import { Button } from "./button";
import { ArrowLeftRight, Radio, Satellite, Gauge, Layers } from "lucide-react";
import {
  parseConstellationConfig,
  parseConstellationToml,
  parseGroundStationsToml,
  parseSatellitesToml,
} from "../../lib/tomlParsers";
import { getSatnum } from "../../lib/satellites";
import { propagationDelayMs } from "../../lib/isl/cost";
import {
  DEFAULT_ADHOC_MIN_ELEVATION_DEG,
  type IslEndpoint,
  type IslLinkModel,
  type IslPathResult,
  type IslSettings,
  type IslShellRange,
} from "../../lib/isl/types";

interface Props {
  satText: string;
  constText: string;
  gsText: string;
  islSettings: IslSettings;
  onIslSettingsChange: (next: IslSettings) => void;
  islResult: IslPathResult | null;
  /** Cumulative count of path switches since ISL was enabled (Phase 2) */
  islSwitchCount: number;
  /** Sim-time (ms) of the last path switch, or null if none yet */
  islLastSwitchSimMs: number | null;
  /** Current simulation time (ms) */
  currentSimMs: number;
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
  satText,
  constText,
  gsText,
  islSettings,
  onIslSettingsChange,
  islResult,
  islSwitchCount,
  islLastSwitchSimMs,
  currentSimMs,
}: Props) {
  const [excludedShellIndices, setExcludedShellIndices] = useState<Set<number>>(new Set());
  const [includeBaseSatellites, setIncludeBaseSatellites] = useState(true);

  const groundStations = useMemo(() => {
    try {
      return parseGroundStationsToml(gsText);
    } catch {
      return [];
    }
  }, [gsText]);

  const baseSats = useMemo(() => {
    try {
      return parseSatellitesToml(satText);
    } catch {
      return [];
    }
  }, [satText]);

  const shells = useMemo(() => {
    try {
      return constText ? parseConstellationConfig(constText).shells : [];
    } catch {
      return [];
    }
  }, [constText]);

  const constellationSats = useMemo(() => {
    try {
      return constText ? parseConstellationToml(constText) : [];
    } catch {
      return [];
    }
  }, [constText]);

  // Shell index ranges (Phase 3, §2.4): shell satellites are appended after
  // the base satellites.toml satellites in the combined array the app builds
  // ([...base, ...constellation]), so each shell's startIndex is the running
  // offset from baseSats.length.
  const shellRanges = useMemo<IslShellRange[]>(() => {
    let offset = baseSats.length;
    return shells.map((shell, idx) => {
      const count = shell.count ?? 0;
      const range: IslShellRange = {
        key: String(idx),
        name: shell.name,
        startIndex: offset,
        count,
        planes: shell.planes ?? 1,
      };
      offset += count;
      return range;
    });
  }, [shells, baseSats.length]);

  useEffect(() => {
    onIslSettingsChange({ ...islSettings, shellRanges });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shellRanges]);

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

  function applyParticipation(nextExcluded: Set<number>, nextIncludeBase: boolean) {
    const allShellsIncluded = nextExcluded.size === 0;
    if (allShellsIncluded && nextIncludeBase) {
      onIslSettingsChange({ ...islSettings, participantSatnums: [] });
      return;
    }
    const satnums: number[] = [];
    if (nextIncludeBase) {
      baseSats.forEach((s) => {
        const n = getSatnum(s);
        if (n !== null) satnums.push(n);
      });
    }
    let offset = 0;
    shells.forEach((shell, idx) => {
      const count = shell.count ?? 0;
      if (!nextExcluded.has(idx)) {
        constellationSats.slice(offset, offset + count).forEach((s) => {
          const n = getSatnum(s);
          if (n !== null) satnums.push(n);
        });
      }
      offset += count;
    });
    onIslSettingsChange({ ...islSettings, participantSatnums: satnums });
  }

  function toggleShell(idx: number) {
    const next = new Set(excludedShellIndices);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setExcludedShellIndices(next);
    applyParticipation(next, includeBaseSatellites);
  }

  function toggleIncludeBase() {
    const next = !includeBaseSatellites;
    setIncludeBaseSatellites(next);
    applyParticipation(excludedShellIndices, next);
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
      <PanelSection title="ISL 経路探索" icon={<Radio />}>
        <div className="flex items-center gap-2">
          <Checkbox
            id="isl-enabled"
            checked={islSettings.enabled}
            onCheckedChange={(v) => onIslSettingsChange({ ...islSettings, enabled: v === true })}
          />
          <Label htmlFor="isl-enabled" className="text-sm text-gray-200">
            ISL 経路探索を有効化
          </Label>
        </div>
      </PanelSection>

      <PanelSection title="地点 A / B" icon={<Satellite />}>
        <EndpointEditor
          label="地点 A"
          endpoint={islSettings.endpointA}
          groundStations={groundStations}
          onChange={(ep) => updateEndpoint("endpointA", ep)}
        />
        <EndpointEditor
          label="地点 B"
          endpoint={islSettings.endpointB}
          groundStations={groundStations}
          onChange={(ep) => updateEndpoint("endpointB", ep)}
        />
        <Button
          variant="outline"
          size="sm"
          className="w-full mt-1"
          onClick={swapEndpoints}
        >
          <ArrowLeftRight className="h-3.5 w-3.5 mr-1" />
          A/B を入替
        </Button>
        <p className="text-xs text-gray-400 mt-2">
          既存局を選んだ場合、通信リンクの判定は仰角のみで行います(局の
          visibilityMode / maxOffNadirDeg は使用しません)。
        </p>
      </PanelSection>

      <PanelSection title="参加衛星" icon={<Satellite />} collapsible defaultOpen={false}>
        <div className="flex items-center gap-2">
          <Checkbox
            id="isl-include-base"
            checked={includeBaseSatellites}
            onCheckedChange={() => toggleIncludeBase()}
          />
          <Label htmlFor="isl-include-base" className="text-sm text-gray-200">
            個別衛星 (satellites.toml) を含める
          </Label>
        </div>
        {shells.map((shell, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <Checkbox
              id={`isl-shell-${idx}`}
              checked={!excludedShellIndices.has(idx)}
              onCheckedChange={() => toggleShell(idx)}
            />
            <Label htmlFor={`isl-shell-${idx}`} className="text-sm text-gray-200">
              {shell.name || `シェル ${idx + 1}`} ({shell.count} 機)
            </Label>
          </div>
        ))}
        {shells.length === 0 && (
          <p className="text-xs text-gray-500">constellation.toml にシェルがありません。</p>
        )}
      </PanelSection>

      <PanelSection title="シェル別 ISL 設定" icon={<Layers />} collapsible defaultOpen={false}>
        <p className="text-xs text-gray-400 mb-2">
          シェルごとに ISL のリンク方式・最大距離・地球遮蔽マージンを上書きできます(未設定の項目は上の
          共通設定を使用)。「gridPattern」は面内前後2機+隣接面同スロット2機のみに限定した固定トポロジで、
          大規模コンステレーションでの候補生成が高速になります(§1.7.3)。異なるシェル同士のリンクは常に
          dynamic(自由トポロジ)として扱われ、その最大距離は両シェルの設定の大きい方が使われます。
        </p>
        {shellRanges.map((shell) => (
          <ShellOverrideRow
            key={shell.key}
            shell={shell}
            override={islSettings.shellLinkModels?.[shell.key]}
            onChange={(patch) => updateShellLinkModel(shell.key, patch)}
          />
        ))}
        {shellRanges.length === 0 && (
          <p className="text-xs text-gray-500">constellation.toml にシェルがありません。</p>
        )}
      </PanelSection>

      <PanelSection title="リンク距離制限" icon={<Radio />} collapsible defaultOpen={false}>
        <p className="text-xs text-gray-400 mb-2">
          衛星間(ISL)・地上⇔衛星(GSL)どちらのリンクにも適用される最大距離です。これを超える距離のリンクは
          候補から除外されます。特に GSL は仰角の条件だけでは低仰角・長距離の「かすめるような」リンクも
          成立してしまうため、ここで実用上の上限を設定できます。
        </p>
        <CostSlider
          label="最大リンク距離"
          value={islSettings.linkModel.maxRangeKm}
          min={100}
          max={20000}
          step={100}
          unit="km"
          hint="ISL・GSL 共通の最大リンク距離。通信端末の性能に相当します。これより遠い相手とはリンクしません(既定 5,000 km)。小さくするほど、地上局からうんと離れた低仰角の衛星が経路に選ばれるのを防げます。"
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
          hint="衛星間(ISL)リンクが地球の縁をかすめるのを避けるための余裕高度。GSL(地上⇔衛星)には適用されません(GSLは仰角と上の最大リンク距離で判定します)。大きくすると地球に近い(低空を通る)ISLリンクがより厳しく除外されます(既定 80 km)。"
          onChange={(v) =>
            onIslSettingsChange({
              ...islSettings,
              linkModel: { ...islSettings.linkModel, losMarginKm: v },
            })
          }
        />
      </PanelSection>

      <PanelSection title="コスト設定(経路選択の重み付け)" icon={<Gauge />} collapsible defaultOpen={false}>
        <p className="text-xs text-gray-400 mb-2">
          経路の総遅延は「伝搬遅延(距離 ÷ 光速。常に自動計算・調整不可)」+「下記の追加コスト」の合計です。
          下記の値を大きくすると、その要素を避ける経路が選ばれやすくなります。すべて即時に経路計算へ反映されます。
        </p>
        <CostSlider
          label="ホップペナルティ"
          value={islSettings.cost.hopPenaltyMs}
          min={0}
          max={20}
          step={0.5}
          unit="ms"
          hint="中継する衛星 1 機ごとに加算される遅延。大きくするほど、遅延は多少増えても中継衛星の少ない経路が優先されます。0 にすると純粋に伝搬遅延が最小の経路になります。"
          onChange={(v) =>
            onIslSettingsChange({ ...islSettings, cost: { ...islSettings.cost, hopPenaltyMs: v } })
          }
        />
        <CostSlider
          label="経路の安定性(ヒステリシス β)"
          value={islSettings.cost.switchDiscount}
          min={0}
          max={0.5}
          step={0.01}
          unit=""
          format={(v) => `${Math.round(v * 100)}%`}
          hint="コストではなく「今の経路を維持しやすくする割引率」です。新しい経路のコストが、今の経路のコストをこの割合分割り引いた値より安くならない限り切り替えません。0% だと毎回コスト最小の経路に切り替わり、値を大きくするほど経路のちらつき(フラッピング)が起きにくくなります。"
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
          GSL(地上⇔衛星)/ISL(衛星⇔衛星)のリンク種別ごとに固定で加算するペナルティです。
          例えば ISL を避けたい(地上局とだけ通信させたい)場合は ISL ペナルティを大きくします。
        </p>
        <CostSlider
          label="安定性ペナルティ(残存リンク時間, 既定 0 = 無効)"
          value={islSettings.cost.stabilityWeightMs ?? 0}
          min={0}
          max={50}
          step={1}
          unit="ms"
          hint="もうすぐ切れそうなリンク(前方300秒を先読みして予測)を避けやすくするペナルティの上限値。各エッジについて将来の衛星位置を先読みするため計算コストが高く、既定では無効(0ms)です。0 より大きくすると経路が長持ちしやすくなりますが、再計算が重くなります(Worker内で実行)。"
          onChange={(v) =>
            onIslSettingsChange({ ...islSettings, cost: { ...islSettings.cost, stabilityWeightMs: v } })
          }
        />
      </PanelSection>

      <PanelSection title="結果" icon={<Gauge />}>
        {!islSettings.enabled || !islResult ? (
          <p className="text-sm text-gray-400">計算していません。</p>
        ) : !islResult.reachable ? (
          <p className="text-sm text-red-400">経路なし(到達不能)</p>
        ) : (
          <div className="text-sm text-gray-200 space-y-1">
            <div>総遅延: {islResult.totalDelayMs.toFixed(2)} ms</div>
            <div className="text-xs text-gray-400 pl-2">
              (内、伝搬遅延: {propagationDelayMs(islResult.totalDistanceKm).toFixed(2)} ms / 追加コスト:{" "}
              {(islResult.totalDelayMs - propagationDelayMs(islResult.totalDistanceKm)).toFixed(2)} ms)
            </div>
            <div>ホップ数: {islResult.hopCount}</div>
            <div>総距離: {islResult.totalDistanceKm.toFixed(1)} km</div>
            <div>累積切替回数: {islSwitchCount}</div>
            <div>
              直近の切替から:{" "}
              {islLastSwitchSimMs === null
                ? "-"
                : `${Math.max(0, (currentSimMs - islLastSwitchSimMs) / 1000).toFixed(0)} 秒`}
            </div>
          </div>
        )}
      </PanelSection>

      <PanelSection title="診断" icon={<Gauge />} collapsible defaultOpen={false}>
        <div className="text-xs text-gray-400 space-y-1">
          <div>候補エッジ数: {islResult?.candidateEdgeCount ?? "-"}</div>
          <div>計算時間: {islResult ? `${islResult.computeTimeMs.toFixed(2)} ms` : "-"}</div>
          <div>
            再計算間隔(sim秒):{" "}
            <input
              type="number"
              min={1}
              step={1}
              className="w-16 bg-gray-700 text-gray-100 rounded px-1 py-0.5 ml-1"
              value={islSettings.recomputeIntervalSimS}
              onChange={(e) =>
                onIslSettingsChange({
                  ...islSettings,
                  recomputeIntervalSimS: Number(e.target.value) || 1,
                })
              }
            />
          </div>
        </div>
      </PanelSection>
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
  groundStations: { name: string; latitudeDeg: number; longitudeDeg: number; heightKm: number; minElevationDeg: number }[];
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
        onChange({
          kind: "station",
          name: first.name,
          latitudeDeg: first.latitudeDeg,
          longitudeDeg: first.longitudeDeg,
          heightKm: first.heightKm,
          minElevationDeg: first.minElevationDeg,
        });
      } else {
        onChange(defaultAdhocEndpoint(label));
      }
    }
  }

  return (
    <div className="border border-gray-600 rounded-md p-2 mb-2">
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
            if (gs) {
              onChange({
                kind: "station",
                name: gs.name,
                latitudeDeg: gs.latitudeDeg,
                longitudeDeg: gs.longitudeDeg,
                heightKm: gs.heightKm,
                minElevationDeg: gs.minElevationDeg,
              });
            }
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
        <span>{valueText}</span>
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

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="text-xs text-gray-400">
      {label}
      <input
        type="number"
        step="0.0001"
        className="w-full bg-gray-700 text-gray-100 rounded px-1 py-0.5 mt-0.5"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
