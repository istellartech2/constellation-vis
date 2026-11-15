import { useEffect, useRef, type ReactNode } from "react";
import { Radio, ScanEye } from "lucide-react";
import PanelSection from "./PanelSection";
import IslSection from "./IslSection";
import { CheckRow, ColorRow, FieldGroup, FieldSlider } from "./compactControls";
import type { GroundStation } from "../../lib/groundStations";
import type { LayerColorMode } from "../../lib/catalogLayers";
import type { DisplayOptions } from "../../lib/viewState";
import type { IslPathResult, IslSettings, IslShellRange } from "../../lib/isl/types";
import type { SatelliteAttitudeMode, SatelliteAttitudeSettings } from "../../lib/attitude/types";
import {
  ATTITUDE_MODE_OPTIONS,
  INERTIAL_DEC_RANGE_DEG,
  INERTIAL_RA_RANGE_DEG,
  STATION_MISSING_WARNING,
  SUN_POINTING_ACCESS_WARNING,
} from "../../lib/attitude/settings";

const EARTH_RADIUS_KM = 6378.137;

interface Props {
  display: DisplayOptions;
  onDisplayChange: (patch: Partial<DisplayOptions>) => void;
  /** Minimum satellite FOV cone height (Earth radii) */
  fovConeMinHeight: number;
  /** Ground stations of the committed scenario: their minimum elevations decide visibility. */
  groundStations: GroundStation[];
  /** Whether any display layer exists (the layer colouring option only matters then). */
  hasLayers: boolean;
  layerColorMode: LayerColorMode;
  onLayerColorModeChange: (mode: LayerColorMode) => void;
  gsText: string;
  islSettings: IslSettings;
  onIslSettingsChange: (next: IslSettings) => void;
  islShellRanges: IslShellRange[];
  islResult: IslPathResult | null;
  islError: string | null;
  islSwitchCount: number;
  islLastSwitchSimMs: number | null;
  currentSimMs: number;
  onOpenTimelineAnalysis?: () => void;
  /** Note on which satellites ISL routing covers (display layers are excluded). */
  islScopeNote?: ReactNode;
  /** Scroll the ISL part into view (the ISL HUD opened this tab), then report it handled. */
  islFocusRequested?: boolean;
  onIslFocusHandled?: () => void;
}

/** One plain-language sentence under a section title saying what it decides. */
function Lead({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-fg-muted">{children}</p>;
}

/** Subordinate controls shown under a checkbox once it is on. */
function Indented({ children }: { children: ReactNode }) {
  return <div className="ml-6 space-y-2">{children}</div>;
}

/**
 * 通信タブ: 「誰と誰がつながるか」の条件と、その条件の見える化。
 * 各セクションは「何を決めるか」の一文 → 判定条件(解析に使用) → 3D 表示
 * の順に並べ、解析に効く値と見た目だけの設定を見出しで分ける。
 */
export default function CommTab({
  display,
  onDisplayChange,
  fovConeMinHeight,
  groundStations,
  hasLayers,
  layerColorMode,
  onLayerColorModeChange,
  islScopeNote,
  islFocusRequested = false,
  onIslFocusHandled,
  ...isl
}: Props) {
  const islRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!islFocusRequested) return;
    islRef.current?.scrollIntoView({ block: "start" });
    onIslFocusHandled?.();
  }, [islFocusRequested, onIslFocusHandled]);

  return (
    <div>
      <PanelSection title="地上局との通信" icon={<Radio />}>
        <div className="space-y-4">
          <Lead>地上局から見て最低仰角より高い位置にある衛星を「見える（通信できる）」と判定します。</Lead>

          <FieldGroup title="判定条件" analysis>
            {groundStations.length > 0 ? (
              <ul className="divide-y divide-line overflow-hidden rounded-md border border-line">
                {groundStations.map((gs) => (
                  <li key={gs.name} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
                    <span className="min-w-0 truncate text-fg">{gs.name}</span>
                    <span className="shrink-0 tabular-nums text-fg-muted">
                      最低仰角 <span className="font-medium text-fg">{gs.minElevationDeg}°</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-fg-subtle">地上局がありません。シナリオタブで追加できます。</p>
            )}
            <p className="text-[11px] leading-relaxed text-fg-subtle">
              最低仰角はシナリオタブの「地上局」で変更します。衛星の色分け・ISL・地上局アクセス解析はすべてこの値を使います。
            </p>
          </FieldGroup>

          <FieldGroup title="3D 表示">
            <ColorRow
              label="見える衛星の色"
              value={display.satelliteVisibleColor}
              onChange={(c) => onDisplayChange({ satelliteVisibleColor: c })}
            />
            <ColorRow
              label="見えない衛星の色"
              value={display.satelliteHiddenColor}
              onChange={(c) => onDisplayChange({ satelliteHiddenColor: c })}
            />
            {hasLayers && (
              <CheckRow
                id="layer-visibility-colors"
                checked={layerColorMode === "visibility"}
                onChange={(v) => onLayerColorModeChange(v ? "visibility" : "layer")}
                label="表示レイヤーも同じ色で塗り分ける"
              />
            )}
            <CheckRow
              id="gs-cones"
              checked={display.showGroundStationCones}
              onChange={(v) => onDisplayChange({ showGroundStationCones: v })}
              label="見える範囲をコーンで表示"
            />
            {display.showGroundStationCones && (
              <Indented>
                <ColorRow
                  label="コーンの色"
                  value={display.groundConeColor}
                  onChange={(c) => onDisplayChange({ groundConeColor: c })}
                />
                <FieldSlider
                  label="コーンの長さ"
                  value={display.groundConeDistanceKm}
                  min={100}
                  max={20000}
                  step={50}
                  format={(v) => `${Math.round(v).toLocaleString()} km`}
                  help="3D に描くコーンの長さです(見た目のみ)。開き角は各地上局の最低仰角です。"
                  onChange={(v) => onDisplayChange({ groundConeDistanceKm: v })}
                />
              </Indented>
            )}
          </FieldGroup>
        </div>
      </PanelSection>

      {/* Anchor for the satellite card's attitude line. Like the ISL wrapper
          below, it makes the section a :first-child, so draw the divider here. */}
      <div id="comm-attitude" className="scroll-mt-2 border-t border-line pt-3">
      <PanelSection title="衛星の姿勢とセンサ" icon={<ScanEye />}>
        <div className="space-y-4">
          <Lead>衛星の向き（姿勢）と、機体に載せたセンサ（カメラやアンテナ）が見る範囲です。エディタの全衛星に共通です。</Lead>

          <FieldGroup title="姿勢" analysis>
            <AttitudeFields
              attitude={display.satelliteAttitude}
              groundStations={groundStations}
              onChange={(satelliteAttitude) => onDisplayChange({ satelliteAttitude })}
            />
          </FieldGroup>
          <p className="-mt-2 text-[11px] leading-relaxed text-fg-subtle">
            {"使用する解析: 地上局アクセス設計（\"衛星の視野も可視条件に加える\"がオンの時）、日照・電力（\"姿勢から計算\"の時）"}
          </p>

          <FieldGroup title="センサ" analysis>
            <FieldSlider
              label="視野半角"
              value={display.fovConeHalfAngleDeg}
              min={1}
              max={80}
              step={1}
              format={(v) => `${v.toFixed(0)}°`}
              help="センサ視野の半頂角。大きいほど広い範囲を見ます。"
              onChange={(v) => onDisplayChange({ fovConeHalfAngleDeg: v })}
            />
            <FieldSlider
              label="進行方向への取付角"
              value={display.fovConeAlongTrackDeg}
              min={-60}
              max={60}
              step={1}
              format={(v) => `${v.toFixed(0)}°`}
              help="機体に対する角度です。地球指向では従来の傾きと同じです。正で機体の進行方向側（+X）へ傾けます。"
              onChange={(v) => onDisplayChange({ fovConeAlongTrackDeg: v })}
            />
            <FieldSlider
              label="横方向への取付角"
              value={display.fovConeCrossTrackDeg}
              min={-60}
              max={60}
              step={1}
              format={(v) => `${v.toFixed(0)}°`}
              help="機体に対する角度です。地球指向では従来の傾きと同じです。正で軌道面の左側（−Y）へ傾けます。"
              onChange={(v) => onDisplayChange({ fovConeCrossTrackDeg: v })}
            />
          </FieldGroup>

          <FieldGroup title="3D 表示">
            <CheckRow
              id="sat-fov-cones"
              checked={display.showSatelliteFovCones}
              onChange={(v) => onDisplayChange({ showSatelliteFovCones: v })}
              label="視野をコーンで表示"
            />
            {display.showSatelliteFovCones && (
              <Indented>
                <ColorRow
                  label="コーンの色"
                  value={display.fovConeColor}
                  onChange={(c) => onDisplayChange({ fovConeColor: c })}
                />
                <p className="text-[11px] text-fg-subtle">
                  コーンの最小の高さ {fovConeMinHeight.toFixed(2)}R<sub>⊕</sub>（約{" "}
                  {Math.round(fovConeMinHeight * EARTH_RADIUS_KM).toLocaleString()} km）
                </p>
                <p className="text-[11px] text-fg-subtle">センサが地球を向いていない衛星のコーンは灰色で薄く表示します。</p>
              </Indented>
            )}
          </FieldGroup>
        </div>
      </PanelSection>
      </div>

      {/* The wrapper makes IslSection's first section a :first-child, which drops
          the divider .panel-section draws, so draw it here. */}
      <div ref={islRef} className="scroll-mt-2 border-t border-line pt-3">
        {islScopeNote}
        <IslSection {...isl} />
      </div>
    </div>
  );
}

/** The note shown in place under the attitude select. */
function Warning({ children }: { children: ReactNode }) {
  return <p className="rounded-md bg-warning-soft px-2 py-1.5 text-[11px] leading-relaxed text-warning">{children}</p>;
}

const clamp = (v: number, [min, max]: readonly [number, number]) => Math.min(max, Math.max(min, v));

/** 姿勢: mode select, its one-line description, mode-specific fields and warnings. */
function AttitudeFields({
  attitude,
  groundStations,
  onChange,
}: {
  attitude: SatelliteAttitudeSettings;
  groundStations: GroundStation[];
  onChange: (next: SatelliteAttitudeSettings) => void;
}) {
  const noStations = groundStations.length === 0;
  const stationFound = groundStations.some((gs) => gs.name === attitude.stationName);
  const option = ATTITUDE_MODE_OPTIONS.find((o) => o.mode === attitude.mode) ?? ATTITUDE_MODE_OPTIONS[0];

  const selectMode = (mode: SatelliteAttitudeMode) => {
    if (mode === "station" && !stationFound && !noStations) {
      onChange({ ...attitude, mode, stationName: groundStations[0].name });
      return;
    }
    onChange({ ...attitude, mode });
  };

  return (
    <div className="space-y-2">
      <label className="flex flex-col gap-1 text-xs text-fg">
        <span>姿勢モード</span>
        <select
          className="w-full rounded bg-raised px-1 py-1 text-xs text-fg"
          aria-label="姿勢モード"
          value={attitude.mode}
          onChange={(e) => selectMode(e.target.value as SatelliteAttitudeMode)}
        >
          {ATTITUDE_MODE_OPTIONS.map((o) => (
            <option
              key={o.mode}
              value={o.mode}
              disabled={o.mode === "station" && noStations && attitude.mode !== "station"}
            >
              {o.mode === "station" && noStations ? "地上局指向（地上局がありません）" : o.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-[11px] leading-relaxed text-fg-muted">{option.description}</p>

      {attitude.mode === "station" && (
        <div className="space-y-2">
          {!noStations && (
            <label className="flex flex-col gap-1 text-xs text-fg">
              <span>向ける地上局</span>
              <select
                className="w-full rounded bg-raised px-1 py-1 text-xs text-fg"
                aria-label="向ける地上局"
                value={stationFound ? attitude.stationName : ""}
                onChange={(e) => onChange({ ...attitude, stationName: e.target.value })}
              >
                {!stationFound && <option value="">選択してください</option>}
                {groundStations.map((gs) => (
                  <option key={gs.name} value={gs.name}>
                    {gs.name}（最低仰角 {gs.minElevationDeg}°）
                  </option>
                ))}
              </select>
            </label>
          )}
          {!stationFound && <Warning>{STATION_MISSING_WARNING}</Warning>}
          {noStations && <p className="text-xs text-fg-subtle">地上局がありません。シナリオタブで追加できます。</p>}
          {stationFound && (
            <p className="text-[11px] leading-relaxed text-fg-subtle">
              局の最低仰角を超えた瞬間に局へ向き、下回った瞬間に地球指向へ戻ります（旋回時間は考えません）。
            </p>
          )}
        </div>
      )}

      {attitude.mode === "inertial" && (
        <div className="space-y-2">
          <FieldSlider
            label="赤経"
            value={attitude.inertialRaDeg}
            min={INERTIAL_RA_RANGE_DEG[0]}
            max={INERTIAL_RA_RANGE_DEG[1]}
            step={0.5}
            format={(v) => `${v.toFixed(1)}°`}
            numberInput={{ unit: "°", step: 0.1 }}
            help="センサを向ける天球上の点の赤経（ECI、春分点から東回り）。"
            onChange={(v) => onChange({ ...attitude, inertialRaDeg: clamp(v, INERTIAL_RA_RANGE_DEG) })}
          />
          <FieldSlider
            label="赤緯"
            value={attitude.inertialDecDeg}
            min={INERTIAL_DEC_RANGE_DEG[0]}
            max={INERTIAL_DEC_RANGE_DEG[1]}
            step={0.5}
            format={(v) => `${v.toFixed(1)}°`}
            numberInput={{ unit: "°", step: 0.1 }}
            help="センサを向ける天球上の点の赤緯。+90° が天の北極です。"
            onChange={(v) => onChange({ ...attitude, inertialDecDeg: clamp(v, INERTIAL_DEC_RANGE_DEG) })}
          />
        </div>
      )}

      {attitude.mode === "sun" && <Warning>{SUN_POINTING_ACCESS_WARNING}</Warning>}
    </div>
  );
}
