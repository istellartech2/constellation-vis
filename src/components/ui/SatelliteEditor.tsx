import { useEffect, useState, type RefObject } from "react";
import type { SatelliteSpec } from "../../lib/satellites";
import type { GroundStation } from "../../lib/groundStations";
import type SatelliteScene from "../../lib/visualization";
import {
  parseSatellitesToml,
  parseConstellationToml,
  parseGroundStationsToml,
  parseConfigBundle,
  buildConfigBundle,
  downloadFile,
} from "../../lib/config";
import { parseConstellationConfig, generateShellRanges } from "../../lib/tomlParsers";
import EditorTab from "./EditorTab";
import AnalysisTab from "./AnalysisTab";
import OptionTab from "./OptionTab";
import IslTab from "./IslTab";
import ImportDialog from "./ImportDialog";
import type { IslPathResult, IslSettings, IslShellRange } from "../../lib/isl/types";
import {
  celestrakEntryToSat,
  satellitesToToml,
  fetchCelestrakGroup,
} from "../../utils/celestrakUtils";
import { validateSatellites, validateGroundStations } from "../../utils/validators";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";
import { Button } from "./button";
import { Menu, X } from "lucide-react";
import type { EarthTextureMode } from "../../lib/earthTextures";
import type { ViewSettings } from "../../lib/viewState";

/**
 * Editor side panel allowing the user to load, edit and save TOML files
 * describing satellites, constellations and ground stations. The parsed
 * data is fed back into the visualization via the provided `onUpdate`
 * callback.
 */

interface Props {
  /**
   * Called when the user clicks Update. Provides the parsed satellite list,
   * ground station list and simulation start time back to the parent
   * component.
   */
  onUpdate: (
    sats: SatelliteSpec[],
    stations: GroundStation[],
    startTime: Date,
    islShellRanges: IslShellRange[],
  ) => void;
  /** Current satellite draw radius */
  satRadius: number;
  /** Called when satellite size is changed */
  onSatRadiusChange: (r: number) => void;
  /** Current earth texture URL */
  earthTexture: EarthTextureMode;
  /** Called when earth texture is changed */
  onEarthTextureChange: (t: EarthTextureMode) => void;
  /** Show or hide graticule */
  showGraticule: boolean;
  /** Called when graticule visibility changes */
  onShowGraticuleChange: (v: boolean) => void;
  /** Show or hide ecliptic plane */
  showEcliptic: boolean;
  /** Called when ecliptic visibility changes */
  onShowEclipticChange: (v: boolean) => void;
  /** Show or hide the geostationary orbit circle */
  showGeoOrbit: boolean;
  /** Called when geostationary orbit visibility changes */
  onShowGeoOrbitChange: (v: boolean) => void;
  /** Show or hide sun direction marker */
  showSunDirection: boolean;
  /** Called when sun direction visibility changes */
  onShowSunDirectionChange: (v: boolean) => void;
  /** Show or hide ground station visibility cones */
  showGroundStationCones: boolean;
  /** Called when ground station cone visibility changes */
  onShowGroundStationConesChange: (v: boolean) => void;
  /** Show or hide satellite FOV cones */
  showSatelliteFovCones: boolean;
  /** Called when satellite FOV cone visibility changes */
  onShowSatelliteFovConesChange: (v: boolean) => void;
  /** Minimum elevation for ground station visibility cones (degrees) */
  groundConeMinElevationDeg: number;
  /** Called when ground station cone min elevation changes */
  onGroundConeMinElevationDegChange: (v: number) => void;
  /** Ground station visibility cone cutoff distance in kilometres */
  groundConeDistanceKm: number;
  /** Called when ground cone distance changes */
  onGroundConeDistanceKmChange: (v: number) => void;
  /** Color for ground station visibility cones */
  groundConeColor: string;
  /** Called when ground cone color changes */
  onGroundConeColorChange: (color: string) => void;
  /** Half-angle for satellite FOV cones (degrees) */
  fovConeHalfAngleDeg: number;
  /** Called when satellite FOV cone angle changes */
  onFovConeHalfAngleDegChange: (v: number) => void;
  /** Color for satellite FOV cones */
  fovConeColor: string;
  /** Called when satellite FOV cone color changes */
  onFovConeColorChange: (color: string) => void;
  /** Minimum satellite FOV cone height (Earth radii) */
  fovConeMinHeight: number;
  /** FOV cone along-track angle offset (degrees) */
  fovConeAlongTrackDeg: number;
  /** Called when FOV cone along-track angle changes */
  onFovConeAlongTrackDegChange: (v: number) => void;
  /** FOV cone cross-track angle offset (degrees) */
  fovConeCrossTrackDeg: number;
  /** Called when FOV cone cross-track angle changes */
  onFovConeCrossTrackDegChange: (v: number) => void;
  /** Satellite color when visible from a ground station */
  satelliteVisibleColor: string;
  /** Called when satellite visible color changes */
  onSatelliteVisibleColorChange: (color: string) => void;
  /** Satellite color when not visible */
  satelliteHiddenColor: string;
  /** Called when satellite hidden color changes */
  onSatelliteHiddenColorChange: (color: string) => void;
  /** Satellite color when selected */
  satelliteSelectedColor: string;
  /** Called when satellite selected color changes */
  onSatelliteSelectedColorChange: (color: string) => void;
  /** Display scene in Earth-fixed (ECEF) mode */
  ecef: boolean;
  /** Called when ECEF mode changes */
  onEcefChange: (v: boolean) => void;
  /** Show perturbation information */
  showPerturbation: boolean;
  /** Called when perturbation visibility changes */
  onShowPerturbationChange: (v: boolean) => void;
  /** Show derived satellite information */
  showDerivedSatelliteInfo: boolean;
  /** Called when derived satellite visibility changes */
  onShowDerivedSatelliteInfoChange: (v: boolean) => void;
  /** Show bright earth (uniform lighting) */
  brightEarth: boolean;
  /** Called when bright earth mode changes */
  onBrightEarthChange: (v: boolean) => void;
  /** Use white background */
  whiteBackground: boolean;
  /** Called when white background mode changes */
  onWhiteBackgroundChange: (v: boolean) => void;
  /** Called when analysis is started (to pause animation) */
  onAnalysisStart?: () => void;
  /** Called when analysis is closed (to resume animation) */
  onAnalysisEnd?: () => void;
  /** Reference to the satellite scene for KML loading */
  sceneRef?: RefObject<SatelliteScene | null>;
  /** Capture the current view (camera + display settings) on demand */
  getCurrentView: () => ViewSettings;
  /** Apply a previously saved view */
  onApplyView: (settings: ViewSettings) => void;
  /** The currently active (committed) satellite array, for analyses that must match islShellRanges exactly */
  satellites: SatelliteSpec[];
  /** Current ISL routing settings */
  islSettings: IslSettings;
  /** Called when ISL routing settings change */
  onIslSettingsChange: (next: IslSettings) => void;
  /** Shell index ranges for `satellites`, resolved at the same Update click that produced it */
  islShellRanges: IslShellRange[];
  /** Latest computed ISL path result (null when disabled or not yet computed) */
  islResult: IslPathResult | null;
  /** User-facing message from the last ISL routing worker error, or null */
  islError: string | null;
  /** Cumulative count of path switches since ISL was enabled (§2.5.2, Phase 2) */
  islSwitchCount: number;
  /** Sim-time (ms) of the last path switch, or null if none yet */
  islLastSwitchSimMs: number | null;
  /** Current simulation time (ms), used to compute elapsed time since last switch */
  currentSimMs: number;
}

export default function SatelliteEditor({
  onUpdate,
  satRadius,
  onSatRadiusChange,
  earthTexture,
  onEarthTextureChange,
  showGraticule,
  onShowGraticuleChange,
  showEcliptic,
  onShowEclipticChange,
  showGeoOrbit,
  onShowGeoOrbitChange,
  showSunDirection,
  onShowSunDirectionChange,
  showGroundStationCones,
  onShowGroundStationConesChange,
  showSatelliteFovCones,
  onShowSatelliteFovConesChange,
  groundConeMinElevationDeg,
  onGroundConeMinElevationDegChange,
  groundConeDistanceKm,
  onGroundConeDistanceKmChange,
  groundConeColor,
  onGroundConeColorChange,
  fovConeHalfAngleDeg,
  onFovConeHalfAngleDegChange,
  fovConeColor,
  onFovConeColorChange,
  fovConeMinHeight,
  fovConeAlongTrackDeg,
  onFovConeAlongTrackDegChange,
  fovConeCrossTrackDeg,
  onFovConeCrossTrackDegChange,
  satelliteVisibleColor,
  onSatelliteVisibleColorChange,
  satelliteHiddenColor,
  onSatelliteHiddenColorChange,
  satelliteSelectedColor,
  onSatelliteSelectedColorChange,
  ecef,
  onEcefChange,
  showPerturbation,
  onShowPerturbationChange,
  showDerivedSatelliteInfo,
  onShowDerivedSatelliteInfoChange,
  brightEarth,
  onBrightEarthChange,
  whiteBackground,
  onWhiteBackgroundChange,
  onAnalysisStart,
  onAnalysisEnd,
  sceneRef,
  getCurrentView,
  onApplyView,
  satellites,
  islSettings,
  onIslSettingsChange,
  islShellRanges,
  islResult,
  islError,
  islSwitchCount,
  islLastSwitchSimMs,
  currentSimMs,
}: Props) {
  const [satText, setSatText] = useState("");
  const [constText, setConstText] = useState("");
  const [gsText, setGsText] = useState("");
  const [startText, setStartText] = useState(() => {
    const d = new Date();
    d.setSeconds(0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"editor" | "analysis" | "option" | "isl">("editor");
  const [importOpen, setImportOpen] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);


  function toggleGroup(g: string) {
    setSelectedGroups((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g],
    );
  }

  // Fetch orbital data for the selected CelesTrak groups and merge it
  // with whatever the user already has in the satellites text area.
  async function handleImport() {
    setImporting(true);
    const notes: string[] = [];
    try {
      const base = parseSatellitesToml(satText);
      for (const g of selectedGroups) {
        const result = await fetchCelestrakGroup(g);
        if (result.note) notes.push(result.note);
        if (!result.data) continue;
        for (const entry of result.data) {
          try {
            base.push(celestrakEntryToSat(entry));
          } catch (e) {
            console.warn(`「${g}」のデータ変換に失敗しました:`, e);
          }
        }
      }
      setSatText(satellitesToToml(base));
      if (notes.length > 0) alert(notes.join("\n\n"));
    } catch (e) {
      alert("衛星のインポートに失敗しました: " + (e as Error).message);
    } finally {
      setImporting(false);
      setImportOpen(false);
      setSelectedGroups([]);
    }
  }




  useEffect(() => {
    // Load satellites.toml
    fetch(import.meta.env.BASE_URL + 'satellites.toml')
      .then((r) => {
        if (!r.ok) throw new Error(`satellites.toml の読み込みに失敗しました: ${r.status}`);
        return r.text();
      })
      .then(setSatText)
      .catch((error) => {
        console.error("satellites.toml の読み込みでエラー:", error);
        setSatText("# デフォルトの satellites.toml を読み込めませんでした\n# 衛星データを手動で入力してください");
      });

    // Load constellation.toml
    fetch(import.meta.env.BASE_URL + 'constellation.toml')
      .then((r) => {
        if (!r.ok) throw new Error(`constellation.toml の読み込みに失敗しました: ${r.status}`);
        return r.text();
      })
      .then(setConstText)
      .catch((error) => {
        console.error("constellation.toml の読み込みでエラー:", error);
        setConstText("# デフォルトの constellation.toml を読み込めませんでした\n# このファイルは任意です");
      });

    // Load groundstations.toml
    fetch(import.meta.env.BASE_URL + 'groundstations.toml')
      .then((r) => {
        if (!r.ok) throw new Error(`groundstations.toml の読み込みに失敗しました: ${r.status}`);
        return r.text();
      })
      .then(setGsText)
      .catch((error) => {
        console.error("groundstations.toml の読み込みでエラー:", error);
        setGsText("# デフォルトの groundstations.toml を読み込めませんでした\n# 地上局データを手動で入力してください");
      });
  }, []);

  const handleUpdate = () => {
    try {
      const base = parseSatellitesToml(satText);
      const con = constText ? parseConstellationToml(constText) : [];
      const gs = parseGroundStationsToml(gsText);
      validateSatellites(base, "satellites.toml");
      validateSatellites(con, "constellation.toml");
      validateGroundStations(gs);
      // Derived from the exact same constText parse that produced `con`, at
      // the exact moment the new satellite array is committed — the only way
      // to guarantee shellRanges never describes a different array than the
      // one actually in use (Phase 5, H-1/H-4).
      const shellRanges: IslShellRange[] = constText
        ? generateShellRanges(parseConstellationConfig(constText), base.length)
        : [];
      onUpdate([...base, ...con], gs, new Date(startText), shellRanges);
    } catch (e) {
      alert("ファイルの解析に失敗しました: " + (e as Error).message);
    }
  };


  const handleSaveBundle = () => {
    const bundle = buildConfigBundle(
      satText,
      constText,
      gsText,
      new Date(startText),
    );
    downloadFile("settings.toml", bundle);
  };

  async function handleBundleFile(file: File) {
    const text = await file.text();
    try {
      const parsed = parseConfigBundle(text);
      validateSatellites(parsed.satellites);
      validateGroundStations(parsed.groundStations);
      setSatText(parsed.satText);
      setConstText(parsed.constText);
      setGsText(parsed.gsText);
      setStartText(parsed.startTime.toISOString().slice(0, 16));
    } catch (e) {
      alert("ファイルが不正です: " + (e as Error).message);
    }
  }

  return (
    <>
      <ImportDialog
        open={importOpen}
        importing={importing}
        selectedGroups={selectedGroups}
        onToggleGroup={toggleGroup}
        onImport={handleImport}
        onClose={() => setImportOpen(false)}
      />
      {!open && (
        <button
          className="side-panel-button"
          onClick={() => setOpen(true)}
          aria-label="メニューを開く"
        >
          <Menu className="h-5 w-5" />
        </button>
      )}
      <div className={`side-panel ${open ? "" : "closed"}`}>
        <div className="side-panel-header">
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as "editor" | "analysis" | "option" | "isl")}
            className="flex-1 min-w-0"
          >
            <TabsList className="grid w-full grid-cols-4 h-10 bg-gray-700/80 rounded-lg p-1 shadow-inner border border-gray-600">
              <TabsTrigger
                value="editor"
                className="data-[state=active]:!bg-orange-600 data-[state=active]:!text-orange-50 data-[state=active]:!shadow-sm data-[state=active]:!border-transparent hover:bg-gray-600/60 text-gray-200 transition-colors rounded-md font-medium"
              >
                編集
              </TabsTrigger>
              <TabsTrigger
                value="analysis"
                className="data-[state=active]:!bg-orange-600 data-[state=active]:!text-orange-50 data-[state=active]:!shadow-sm data-[state=active]:!border-transparent hover:bg-gray-600/60 text-gray-200 transition-colors rounded-md font-medium"
              >
                解析
              </TabsTrigger>
              <TabsTrigger
                value="isl"
                className="data-[state=active]:!bg-orange-600 data-[state=active]:!text-orange-50 data-[state=active]:!shadow-sm data-[state=active]:!border-transparent hover:bg-gray-600/60 text-gray-200 transition-colors rounded-md font-medium"
              >
                ISL
              </TabsTrigger>
              <TabsTrigger
                value="option"
                className="data-[state=active]:!bg-orange-600 data-[state=active]:!text-orange-50 data-[state=active]:!shadow-sm data-[state=active]:!border-transparent hover:bg-gray-600/60 text-gray-200 transition-colors rounded-md font-medium"
              >
                設定
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="ghost"
            size="icon"
            className="side-panel-close"
            onClick={() => setOpen(false)}
            aria-label="閉じる"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="side-panel-content">
          <Tabs value={tab} onValueChange={(value) => setTab(value as "editor" | "analysis" | "option" | "isl")} className="w-full">
            <TabsContent value="editor" className="mt-0 bg-gray-800/40 border-2 border-gray-600 rounded-lg p-6 shadow-inner">
              <EditorTab
                satText={satText}
                constText={constText}
                gsText={gsText}
                startText={startText}
                onSatTextChange={setSatText}
                onConstTextChange={setConstText}
                onGsTextChange={setGsText}
                onStartTextChange={setStartText}
                onImportClick={() => setImportOpen(true)}
                onUpdate={handleUpdate}
                onSaveBundle={handleSaveBundle}
                onLoadBundle={handleBundleFile}
              />
            </TabsContent>
            
            <TabsContent value="analysis" className="mt-0 bg-gray-800/40 border-2 border-gray-600 rounded-lg p-6 shadow-inner">
              <AnalysisTab
                satText={satText}
                constText={constText}
                gsText={gsText}
                startTime={new Date(startText)}
                satellites={satellites}
                islSettings={islSettings}
                islShellRanges={islShellRanges}
                onAnalysisStart={onAnalysisStart}
                onAnalysisEnd={onAnalysisEnd}
              />
            </TabsContent>

            <TabsContent value="isl" className="mt-0 bg-gray-800/40 border-2 border-gray-600 rounded-lg p-6 shadow-inner">
              <IslTab
                gsText={gsText}
                islSettings={islSettings}
                onIslSettingsChange={onIslSettingsChange}
                islShellRanges={islShellRanges}
                islResult={islResult}
                islError={islError}
                islSwitchCount={islSwitchCount}
                islLastSwitchSimMs={islLastSwitchSimMs}
                currentSimMs={currentSimMs}
              />
            </TabsContent>

            <TabsContent value="option" className="mt-0 bg-gray-800/40 border-2 border-gray-600 rounded-lg p-6 shadow-inner">
              <OptionTab
                satRadius={satRadius}
                onSatRadiusChange={onSatRadiusChange}
                earthTexture={earthTexture}
                onEarthTextureChange={onEarthTextureChange}
                showGraticule={showGraticule}
                onShowGraticuleChange={onShowGraticuleChange}
                showEcliptic={showEcliptic}
                onShowEclipticChange={onShowEclipticChange}
                showGeoOrbit={showGeoOrbit}
                onShowGeoOrbitChange={onShowGeoOrbitChange}
                showSunDirection={showSunDirection}
                onShowSunDirectionChange={onShowSunDirectionChange}
                showGroundStationCones={showGroundStationCones}
                onShowGroundStationConesChange={onShowGroundStationConesChange}
                showSatelliteFovCones={showSatelliteFovCones}
                onShowSatelliteFovConesChange={onShowSatelliteFovConesChange}
                groundConeMinElevationDeg={groundConeMinElevationDeg}
                onGroundConeMinElevationDegChange={onGroundConeMinElevationDegChange}
                groundConeDistanceKm={groundConeDistanceKm}
                onGroundConeDistanceKmChange={onGroundConeDistanceKmChange}
                groundConeColor={groundConeColor}
                onGroundConeColorChange={onGroundConeColorChange}
                fovConeHalfAngleDeg={fovConeHalfAngleDeg}
                onFovConeHalfAngleDegChange={onFovConeHalfAngleDegChange}
                fovConeColor={fovConeColor}
                onFovConeColorChange={onFovConeColorChange}
                fovConeMinHeight={fovConeMinHeight}
                fovConeAlongTrackDeg={fovConeAlongTrackDeg}
                onFovConeAlongTrackDegChange={onFovConeAlongTrackDegChange}
                fovConeCrossTrackDeg={fovConeCrossTrackDeg}
                onFovConeCrossTrackDegChange={onFovConeCrossTrackDegChange}
                satelliteVisibleColor={satelliteVisibleColor}
                onSatelliteVisibleColorChange={onSatelliteVisibleColorChange}
                satelliteHiddenColor={satelliteHiddenColor}
                onSatelliteHiddenColorChange={onSatelliteHiddenColorChange}
                satelliteSelectedColor={satelliteSelectedColor}
                onSatelliteSelectedColorChange={onSatelliteSelectedColorChange}
                ecef={ecef}
                onEcefChange={onEcefChange}
                showPerturbation={showPerturbation}
                onShowPerturbationChange={onShowPerturbationChange}
                showDerivedSatelliteInfo={showDerivedSatelliteInfo}
                onShowDerivedSatelliteInfoChange={onShowDerivedSatelliteInfoChange}
                brightEarth={brightEarth}
                onBrightEarthChange={onBrightEarthChange}
                whiteBackground={whiteBackground}
                onWhiteBackgroundChange={onWhiteBackgroundChange}
                sceneRef={sceneRef}
                getCurrentView={getCurrentView}
                onApplyView={onApplyView}
                islSettings={islSettings}
                onIslSettingsChange={onIslSettingsChange}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
}
