import { useEffect, useRef, type ReactNode } from "react";
import { Radio, ScanEye } from "lucide-react";
import PanelSection from "./PanelSection";
import IslSection from "./IslSection";
import { CheckRow, ColorRow, FieldGroup, FieldSlider } from "./compactControls";
import type { GroundStation } from "../../lib/groundStations";
import type { LayerColorMode } from "../../lib/catalogLayers";
import type { DisplayOptions } from "../../lib/viewState";
import type { IslPathResult, IslSettings, IslShellRange } from "../../lib/isl/types";

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

      <PanelSection title="衛星センサの視野" icon={<ScanEye />}>
        <div className="space-y-4">
          <Lead>衛星に載せたセンサ（カメラやアンテナ）が地上を見る範囲です。</Lead>

          <FieldGroup title="判定条件" analysis>
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
              label="進行方向への傾き"
              value={display.fovConeAlongTrackDeg}
              min={-60}
              max={60}
              step={1}
              format={(v) => `${v.toFixed(0)}°`}
              help="Along-track。正で進行方向へ傾けます。"
              onChange={(v) => onDisplayChange({ fovConeAlongTrackDeg: v })}
            />
            <FieldSlider
              label="横方向への傾き"
              value={display.fovConeCrossTrackDeg}
              min={-60}
              max={60}
              step={1}
              format={(v) => `${v.toFixed(0)}°`}
              help="Cross-track。正で軌道面の左側へ傾けます。"
              onChange={(v) => onDisplayChange({ fovConeCrossTrackDeg: v })}
            />
            <p className="text-[11px] leading-relaxed text-fg-subtle">
              解析タブの「地上局アクセス設計」の視野条件にも使います。
            </p>
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
              </Indented>
            )}
          </FieldGroup>
        </div>
      </PanelSection>

      {/* The wrapper makes IslSection's first section a :first-child, which drops
          the divider .panel-section draws, so draw it here. */}
      <div ref={islRef} className="scroll-mt-2 border-t border-line pt-3">
        {islScopeNote}
        <IslSection {...isl} />
      </div>
    </div>
  );
}
