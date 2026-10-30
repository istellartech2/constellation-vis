import { useEffect, useRef, type ReactNode } from "react";
import { Radio, ScanEye } from "lucide-react";
import PanelSection from "./PanelSection";
import IslSection from "./IslSection";
import { AnalysisBadge, CheckRow, ColorChip, InlineSlider } from "./compactControls";
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

/**
 * 通信タブ: 「誰と誰がつながるか」の条件と、その条件の見える化。
 * 可視判定の色・コーンは判定に使う値の隣に置き、解析に効く値には
 * 「解析に使用」を付けて見た目だけの設定(表示タブ)と区別する。
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
      <PanelSection title="地上局リンク" icon={<Radio />} action={<AnalysisBadge />}>
        <div className="space-y-1">
          <div className="text-xs text-fg-muted">衛星が見える最低仰角（地上局ごと）</div>
          {groundStations.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {groundStations.map((gs) => (
                <li
                  key={gs.name}
                  className="rounded-full border border-line bg-raised px-2 py-0.5 text-xs text-fg tabular-nums"
                >
                  {gs.name} <span className="text-fg-muted">{gs.minElevationDeg}°</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-fg-subtle">地上局がありません。</p>
          )}
          <p className="text-[11px] text-fg-subtle leading-snug">
            衛星の色分け・コーン・ISL の地上局リンク・地上局アクセス解析はこの値で判定します。変更はシナリオタブの地上局で行います。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="text-sm text-fg">衛星の色</span>
          <ColorChip
            label="地上局から見える"
            value={display.satelliteVisibleColor}
            onChange={(c) => onDisplayChange({ satelliteVisibleColor: c })}
          />
          <ColorChip
            label="見えない"
            value={display.satelliteHiddenColor}
            onChange={(c) => onDisplayChange({ satelliteHiddenColor: c })}
          />
        </div>
        {hasLayers && (
          <CheckRow
            id="layer-visibility-colors"
            checked={layerColorMode === "visibility"}
            onChange={(v) => onLayerColorModeChange(v ? "visibility" : "layer")}
            label="表示レイヤーも見える／見えないで色分け"
          />
        )}
        <CheckRow
          id="gs-cones"
          checked={display.showGroundStationCones}
          onChange={(v) => onDisplayChange({ showGroundStationCones: v })}
          label="見える範囲をコーンで表示"
          trailing={
            display.showGroundStationCones && (
              <input
                type="color"
                className="option-color-input"
                value={display.groundConeColor}
                onChange={(e) => onDisplayChange({ groundConeColor: e.target.value })}
                title="コーンの色"
                aria-label="コーンの色"
              />
            )
          }
        />
        {display.showGroundStationCones && (
          <InlineSlider
            label="コーンの長さ"
            labelW="w-24"
            value={display.groundConeDistanceKm}
            min={100}
            max={20000}
            step={50}
            format={(v) => `${Math.round(v).toLocaleString()} km`}
            help="3D に描くコーンの長さです(見た目のみ)。開き角は各地上局の最低仰角です。"
            onChange={(v) => onDisplayChange({ groundConeDistanceKm: v })}
          />
        )}
      </PanelSection>

      <PanelSection title="衛星センサ視野" icon={<ScanEye />} action={<AnalysisBadge />}>
        <p className="text-[11px] text-fg-subtle leading-snug">
          視野の広さと傾きは、3D のコーンと「地上局アクセス設計」解析の視野条件で共通に使います。
        </p>
        <InlineSlider
          label="視野半角"
          labelW="w-24"
          value={display.fovConeHalfAngleDeg}
          min={1}
          max={80}
          step={1}
          format={(v) => `${v.toFixed(0)}°`}
          help="センサ視野の半頂角。"
          onChange={(v) => onDisplayChange({ fovConeHalfAngleDeg: v })}
        />
        <InlineSlider
          label="進行方向の傾き"
          labelW="w-24"
          value={display.fovConeAlongTrackDeg}
          min={-60}
          max={60}
          step={1}
          format={(v) => `${v.toFixed(0)}°`}
          help="Along-track。正で進行方向へ傾けます。"
          onChange={(v) => onDisplayChange({ fovConeAlongTrackDeg: v })}
        />
        <InlineSlider
          label="横方向の傾き"
          labelW="w-24"
          value={display.fovConeCrossTrackDeg}
          min={-60}
          max={60}
          step={1}
          format={(v) => `${v.toFixed(0)}°`}
          help="Cross-track。正で軌道面の左側へ傾けます。"
          onChange={(v) => onDisplayChange({ fovConeCrossTrackDeg: v })}
        />
        <CheckRow
          id="sat-fov-cones"
          checked={display.showSatelliteFovCones}
          onChange={(v) => onDisplayChange({ showSatelliteFovCones: v })}
          label="3D にコーンを表示"
          trailing={
            display.showSatelliteFovCones && (
              <input
                type="color"
                className="option-color-input"
                value={display.fovConeColor}
                onChange={(e) => onDisplayChange({ fovConeColor: e.target.value })}
                title="コーンの色"
                aria-label="コーンの色"
              />
            )
          }
        />
        {display.showSatelliteFovCones && (
          <p className="text-[11px] text-fg-subtle">
            コーンの最小の高さ {fovConeMinHeight.toFixed(2)}R<sub>⊕</sub>（約{" "}
            {Math.round(fovConeMinHeight * EARTH_RADIUS_KM).toLocaleString()} km）
          </p>
        )}
      </PanelSection>

      <div ref={islRef} className="scroll-mt-2">
        {islScopeNote}
        <IslSection {...isl} />
      </div>
    </div>
  );
}
