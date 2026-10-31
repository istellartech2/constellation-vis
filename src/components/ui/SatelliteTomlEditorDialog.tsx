import { useCallback, useMemo, useState } from "react";
import { FileText, Globe, Orbit, Rows3, Satellite } from "lucide-react";
import { Button } from "./button";
import { GEO_SEMI_MAJOR_AXIS_KM, geoElementsFromLongitude } from "../../lib/astronomy";
import { Label } from "./label";
import EditorDialogShell, { EditorDetailPane, EditorDialogFooter, EditorSplitBody } from "./EditorDialogShell";
import EditorItemList, { KindBadge, listAddButtonClass } from "./EditorItemList";
import { LOCAL_SATNUM_MIN, nextLocalSatnum } from "../../lib/localSatnum";
import {
  getChiefOptions,
  getEntryDisplayName,
  getFormationModeDescription,
  manualSatnums,
  parseSatelliteEditorConfig,
  serializeSatelliteEditorConfig,
  syncFormationRepresentations,
  validateSatelliteEditorConfig,
  type SatelliteEditorValidationError,
} from "../../lib/satelliteEditorSerializer";
import {
  createDefaultFormationEntry,
  createDefaultGeoEntry,
  createDefaultManualEntry,
  FORMATION_MODES,
  type AlongTrackFormationEntry,
  type CrossTrackPendulumFormationEntry,
  type CrossTrackSide,
  type CustomFormationEntry,
  type FormationMode,
  type FormationRelativeModel,
  type FormationSatelliteEntry,
  type GcoFormationEntry,
  type HelixFormationEntry,
  type ManualSatelliteEntry,
  type NmcFormationEntry,
  type ProgradeDirection,
  type SatelliteEditorConfig,
  type SatelliteEditorEntry,
  type SatelliteEditorGeo,
} from "../../lib/satelliteEditorTypes";

interface Props {
  open: boolean;
  satText: string;
  /** Saves the edited TOML and applies it to the 3D view. */
  onApply: (text: string) => void;
  onClose: () => void;
}

function formatDateForInput(date?: Date): string {
  if (!date || Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function getNextManualSatnum(config: SatelliteEditorConfig): number {
  return nextLocalSatnum(manualSatnums(config));
}

function errorForField(errors: SatelliteEditorValidationError[], index: number, field: string): string | undefined {
  return errors.find((error) => error.field === `entry.${index}.${field}`)?.message;
}

function hasEntryError(errors: SatelliteEditorValidationError[], index: number): boolean {
  return errors.some((error) => error.field.startsWith(`entry.${index}.`));
}

function kindLabel(entry: SatelliteEditorEntry): string {
  if (entry.kind === "formation") return "編隊";
  if (entry.type === "tle") return "TLE";
  if (entry.type === "geo") return "静止軌道";
  return "軌道要素";
}

function kindBadge(entry: SatelliteEditorEntry) {
  return <KindBadge tone={entry.kind === "formation" ? "info" : "neutral"}>{kindLabel(entry)}</KindBadge>;
}

/** One-line list subtitle; the detail header uses the longer {@link summaryForEntry}. */
function shortSummary(entry: SatelliteEditorEntry, chiefName?: string): string {
  if (entry.kind === "formation") return `chief ${chiefName ?? "未選択"} · ${entry.formationMode}`;
  if (entry.type === "tle") {
    const catalog = entry.tle?.line1.slice(2, 7).trim();
    return catalog ? `NORAD ${catalog}` : "TLE 未入力";
  }
  if (entry.type === "geo" && entry.geo) {
    const lon = entry.geo.longitudeDeg;
    return `経度 ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
  }
  const el = entry.elements;
  return el ? `a=${el.semiMajorAxisKm.toFixed(0)} km · i=${el.inclinationDeg.toFixed(1)}° · e=${el.eccentricity.toFixed(4)}` : "";
}

function summaryForEntry(entry: SatelliteEditorEntry, chiefName?: string): string {
  if (entry.kind === "manual") {
    if (entry.type === "tle") return "2行 TLE（Line 1 / Line 2）をそのまま使って軌道を計算します。";
    if (entry.type === "geo") {
      const geo = entry.geo;
      if (!geo) return "経度を入力して静止衛星を配置します。";
      const lon = geo.longitudeDeg;
      const hemi = lon >= 0 ? "E" : "W";
      const incNote = geo.inclinationDeg > 0 ? ` / 傾斜 ${geo.inclinationDeg.toFixed(1)}°` : "";
      return `静止軌道 経度 ${Math.abs(lon).toFixed(2)}°${hemi}${incNote}（a≈${GEO_SEMI_MAJOR_AXIS_KM.toFixed(0)} km, e=0）に配置します。`;
    }
    const el = entry.elements;
    return el
      ? `satnum ${el.satnum} / a=${el.semiMajorAxisKm.toFixed(1)} km / i=${el.inclinationDeg.toFixed(2)}° / e=${el.eccentricity.toFixed(4)}`
      : "軌道要素を入力して衛星を追加します。";
  }
  switch (entry.formationMode) {
    case "alongTrack":
      return `${chiefName ?? "chief 未選択"} を中心に deputy ${entry.deputyCount} 機を等間隔 ${entry.spacingKm} km で列配置します。`;
    case "nmc":
      return `${chiefName ?? "chief 未選択"} の周りに NMC の 2:1 楕円運動を 1 機で作ります。`;
    case "crossTrackPendulum":
      return `${chiefName ?? "chief 未選択"} に対して面外方向に ${entry.amplitudeKm} km の振り子運動を 1 機で作ります。`;
    case "helix":
      return `${chiefName ?? "chief 未選択"} の周りに deputy ${entry.deputyCount} 機を helix 配置します。`;
    case "gco":
      return `${chiefName ?? "chief 未選択"} の周りに deputy ${entry.deputyCount} 機を GCO / record-disk 軌道で等位相配置します。chief からの距離はほぼ一定です。`;
    case "custom":
    default:
      return `${chiefName ?? "chief 未選択"} を基準に deputy ${entry.deputyCount} 機を custom 入力で生成します。`;
  }
}

export default function SatelliteTomlEditorDialog({ open, satText, onApply, onClose }: Props) {
  const [config, setConfig] = useState<SatelliteEditorConfig>({ entries: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const errors = useMemo(() => validateSatelliteEditorConfig(config).errors, [config]);

  const [source, setSource] = useState({ open: false, satText });
  if (source.open !== open || source.satText !== satText) {
    setSource({ open, satText });
    if (open) {
      const parsed = syncFormationRepresentations(parseSatelliteEditorConfig(satText));
      setConfig(parsed);
      setSelectedId(parsed.entries[0]?.id ?? null);
    }
  }

  const chiefOptions = useMemo(() => getChiefOptions(config), [config]);
  const selectedEntry = useMemo(() => config.entries.find((entry) => entry.id === selectedId) ?? null, [config.entries, selectedId]);
  const selectedIndex = useMemo(() => config.entries.findIndex((entry) => entry.id === selectedId), [config.entries, selectedId]);

  const updateConfig = useCallback((updater: (current: SatelliteEditorConfig) => SatelliteEditorConfig) => {
    setConfig((current) => syncFormationRepresentations(updater(current)));
  }, []);

  const updateSelectedEntry = useCallback((updater: (entry: SatelliteEditorEntry) => SatelliteEditorEntry) => {
    updateConfig((current) => ({
      entries: current.entries.map((entry) => (entry.id === selectedId ? updater(entry) : entry)),
    }));
  }, [selectedId, updateConfig]);

  const handleAddManual = useCallback(() => {
    const newEntry = createDefaultManualEntry();
    updateConfig((current) => {
      if (newEntry.elements) newEntry.elements.satnum = getNextManualSatnum(current);
      return { entries: [...current.entries, newEntry] };
    });
    setSelectedId(newEntry.id);
  }, [updateConfig]);

  const handleAddGeo = useCallback(() => {
    const newEntry = createDefaultGeoEntry();
    updateConfig((current) => {
      if (newEntry.geo) newEntry.geo.satnum = getNextManualSatnum(current);
      return { entries: [...current.entries, newEntry] };
    });
    setSelectedId(newEntry.id);
  }, [updateConfig]);

  const handleAddTle = useCallback(() => {
    const base = createDefaultManualEntry();
    const newEntry: ManualSatelliteEntry = { ...base, type: "tle", elements: undefined, tle: { line1: "", line2: "" } };
    updateConfig((current) => ({ entries: [...current.entries, newEntry] }));
    setSelectedId(newEntry.id);
  }, [updateConfig]);

  const handleAddFormation = useCallback(() => {
    const newEntry = createDefaultFormationEntry("custom");
    updateConfig((current) => {
      const chief = getChiefOptions(current)[0];
      newEntry.chiefSatnum = chief?.elements?.satnum ?? 0;
      return { entries: [...current.entries, newEntry] };
    });
    setSelectedId(newEntry.id);
  }, [updateConfig]);

  const handleDelete = useCallback((id: string) => {
    setConfig((current) => {
      const nextEntries = current.entries.filter((entry) => entry.id !== id);
      const currentIndex = current.entries.findIndex((entry) => entry.id === id);
      setSelectedId((selected) => selected === id ? nextEntries[Math.min(currentIndex, nextEntries.length - 1)]?.id ?? null : selected);
      return { entries: nextEntries };
    });
  }, []);

  const handleMove = useCallback((id: string, direction: "up" | "down") => {
    updateConfig((current) => {
      const index = current.entries.findIndex((entry) => entry.id === id);
      if (index < 0) return current;
      const nextIndex = direction === "up" ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= current.entries.length) return current;
      const nextEntries = [...current.entries];
      [nextEntries[index], nextEntries[nextIndex]] = [nextEntries[nextIndex], nextEntries[index]];
      return { entries: nextEntries };
    });
  }, [updateConfig]);

  const handleSave = useCallback(() => {
    const validation = validateSatelliteEditorConfig(config);
    if (!validation.isValid) return;
    onApply(serializeSatelliteEditorConfig(config));
    onClose();
  }, [config, onClose, onApply]);

  const chiefNameOf = (entry: SatelliteEditorEntry): string | undefined => {
    if (entry.kind !== "formation") return undefined;
    const chief = chiefOptions.find((option) => option.elements?.satnum === entry.chiefSatnum);
    return chief ? chief.meta?.objectName || chief.name || `satnum ${chief.elements?.satnum}` : undefined;
  };

  const addActions = (
    <div className="grid grid-cols-2 gap-1.5">
      <Button variant="outline" size="sm" onClick={handleAddManual} className={listAddButtonClass} title="軌道要素（a, e, i, RAAN…）を入力して衛星を追加">
        <Satellite className="h-4 w-4" />
        軌道要素
      </Button>
      <Button variant="outline" size="sm" onClick={handleAddTle} className={listAddButtonClass} title="2行 TLE を貼り付けて衛星を追加">
        <FileText className="h-4 w-4" />
        TLE
      </Button>
      <Button variant="outline" size="sm" onClick={handleAddGeo} className={listAddButtonClass} title="経度を指定して静止衛星を追加">
        <Globe className="h-4 w-4" />
        静止軌道
      </Button>
      <Button variant="outline" size="sm" onClick={handleAddFormation} className={listAddButtonClass} title="既存の衛星を chief にした編隊を追加">
        <Rows3 className="h-4 w-4" />
        編隊
      </Button>
    </div>
  );

  return (
    <EditorDialogShell
      open={open}
      onClose={onClose}
      icon={<Satellite />}
      title="衛星"
      description="一覧から衛星を選んで軌道を編集します。上のボタンで入力方式を選んで追加できます。"
      footer={<EditorDialogFooter errors={errors.map((e) => e.message)} onCancel={onClose} onApply={handleSave} />}
    >
      <EditorSplitBody
        list={
          <EditorItemList
            noun="衛星"
            items={config.entries.map((entry, index) => ({
              id: entry.id,
              title: getEntryDisplayName(entry, index),
              subtitle: shortSummary(entry, chiefNameOf(entry)),
              badge: kindBadge(entry),
              issue: hasEntryError(errors, index) ? "error" : undefined,
            }))}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMove={handleMove}
            onDelete={handleDelete}
            addActions={addActions}
          />
        }
      >
        <EditorDetailPane
          title={selectedEntry ? getEntryDisplayName(selectedEntry, selectedIndex) : null}
          badge={selectedEntry && kindBadge(selectedEntry)}
          summary={selectedEntry ? summaryForEntry(selectedEntry, chiefNameOf(selectedEntry)) : undefined}
          emptyText={config.entries.length === 0 ? "左上のボタンから最初の衛星を追加してください" : "一覧から衛星を選択してください"}
        >
          {selectedEntry?.kind === "manual" && (
            <ManualEntryForm entry={selectedEntry} index={selectedIndex} errors={errors} onChange={(updater) => updateSelectedEntry((entry) => updater(entry as ManualSatelliteEntry))} />
          )}
          {selectedEntry?.kind === "formation" && (
            <FormationEntryForm
              entry={selectedEntry}
              chiefOptions={chiefOptions}
              index={selectedIndex}
              errors={errors}
              onChange={(updater) => updateSelectedEntry((entry) => updater(entry as FormationSatelliteEntry))}
            />
          )}
        </EditorDetailPane>
      </EditorSplitBody>
    </EditorDialogShell>
  );
}

function changeManualType(
  current: ManualSatelliteEntry,
  nextType: ManualSatelliteEntry["type"],
  fallbackElements: NonNullable<ManualSatelliteEntry["elements"]>,
): ManualSatelliteEntry {
  if (nextType === current.type) return current;
  if (nextType === "tle") {
    return { ...current, type: "tle", tle: current.tle ?? { line1: "", line2: "" } };
  }
  if (nextType === "geo") {
    const seedSatnum = current.geo?.satnum ?? current.elements?.satnum ?? LOCAL_SATNUM_MIN;
    const seedEpoch = current.geo?.epoch ?? current.elements?.epoch ?? new Date();
    return {
      ...current,
      type: "geo",
      geo: current.geo ?? {
        satnum: seedSatnum,
        epoch: seedEpoch,
        longitudeDeg: 0,
        inclinationDeg: current.elements?.inclinationDeg ?? 0,
      },
    };
  }
  return { ...current, type: "elements", elements: current.elements ?? fallbackElements };
}

function ManualEntryForm({
  entry,
  index,
  errors,
  onChange,
}: {
  entry: ManualSatelliteEntry;
  index: number;
  errors: SatelliteEditorValidationError[];
  onChange: (updater: (entry: ManualSatelliteEntry) => ManualSatelliteEntry) => void;
}) {
  const elements = entry.elements ?? createDefaultManualEntry().elements!;
  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-fg-muted">入力方式</Label>
          <select value={entry.type} onChange={(e) => onChange((current) => changeManualType(current, e.target.value as ManualSatelliteEntry["type"], elements))} className="w-full rounded border border-line-strong bg-sunken px-2 py-1.5 text-sm text-fg">
            <option value="elements">軌道要素</option>
            <option value="geo">静止軌道 (経度指定)</option>
            <option value="tle">TLE</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-fg-muted">表示名</Label>
          <input type="text" value={entry.name ?? ""} onChange={(e) => onChange((current) => ({ ...current, name: e.target.value, meta: { ...current.meta, objectName: e.target.value || undefined } }))} className="w-full rounded border border-line-strong bg-sunken px-2 py-1.5 text-sm text-fg" />
        </div>
      </div>
      {entry.type === "tle" ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-fg-muted">TLE Line 1</Label>
            <textarea value={entry.tle?.line1 ?? ""} onChange={(e) => onChange((current) => ({ ...current, tle: { line1: e.target.value, line2: current.tle?.line2 ?? "" } }))} className="min-h-20 w-full rounded border border-line-strong bg-sunken px-2 py-2 text-xs font-mono text-fg" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-fg-muted">TLE Line 2</Label>
            <textarea value={entry.tle?.line2 ?? ""} onChange={(e) => onChange((current) => ({ ...current, tle: { line1: current.tle?.line1 ?? "", line2: e.target.value } }))} className="min-h-20 w-full rounded border border-line-strong bg-sunken px-2 py-2 text-xs font-mono text-fg" />
            {errorForField(errors, index, "tle") && <p className="text-xs text-danger">{errorForField(errors, index, "tle")}</p>}
          </div>
        </div>
      ) : entry.type === "geo" ? (
        <GeoEntryForm entry={entry} index={index} errors={errors} onChange={onChange} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="衛星番号 satnum" value={elements.satnum} integer onChange={(value) => onChange((current) => ({ ...current, elements: { ...(current.elements ?? elements), satnum: value } }))} error={errorForField(errors, index, "elements.satnum")} />
          <DateField label="エポック epoch [UTC]" value={elements.epoch} onChange={(date) => onChange((current) => ({ ...current, elements: { ...(current.elements ?? elements), epoch: date ?? elements.epoch } }))} />
          <NumberField label="長半径 semiMajorAxis [km]" value={elements.semiMajorAxisKm} onChange={(value) => onChange((current) => ({ ...current, elements: { ...(current.elements ?? elements), semiMajorAxisKm: value } }))} error={errorForField(errors, index, "elements.semiMajorAxisKm")} />
          <NumberField label="離心率 eccentricity [-]" value={elements.eccentricity} onChange={(value) => onChange((current) => ({ ...current, elements: { ...(current.elements ?? elements), eccentricity: value } }))} error={errorForField(errors, index, "elements.eccentricity")} />
          <NumberField label="軌道傾斜角 inclination [deg]" value={elements.inclinationDeg} onChange={(value) => onChange((current) => ({ ...current, elements: { ...(current.elements ?? elements), inclinationDeg: value } }))} />
          <NumberField label="昇交点赤経 RAAN [deg]" value={elements.raanDeg} onChange={(value) => onChange((current) => ({ ...current, elements: { ...(current.elements ?? elements), raanDeg: value } }))} />
          <NumberField label="近地点引数 argument of perigee [deg]" value={elements.argPerigeeDeg} onChange={(value) => onChange((current) => ({ ...current, elements: { ...(current.elements ?? elements), argPerigeeDeg: value } }))} />
          <NumberField label="平均近点角 mean anomaly [deg]" value={elements.meanAnomalyDeg} onChange={(value) => onChange((current) => ({ ...current, elements: { ...(current.elements ?? elements), meanAnomalyDeg: value } }))} />
        </div>
      )}
    </div>
  );
}

function GeoEntryForm({
  entry,
  index,
  errors,
  onChange,
}: {
  entry: ManualSatelliteEntry;
  index: number;
  errors: SatelliteEditorValidationError[];
  onChange: (updater: (entry: ManualSatelliteEntry) => ManualSatelliteEntry) => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const geo = entry.geo ?? createDefaultGeoEntry().geo!;
  const updateGeo = (patch: Partial<SatelliteEditorGeo>) =>
    onChange((current) => ({ ...current, geo: { ...(current.geo ?? geo), ...patch } }));
  const preview = geoElementsFromLongitude(geo);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-info/40 bg-info-soft px-3 py-2 text-xs text-info">
        経度を入力するだけで静止軌道（円・赤道・高度約 {(GEO_SEMI_MAJOR_AXIS_KM - 6378.137).toFixed(0)} km）の軌道要素を自動生成します。東経を正、西経を負で入力してください。
      </div>
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="経度 longitude [deg]（東経+ / 西経-）" value={geo.longitudeDeg} onChange={(value) => updateGeo({ longitudeDeg: value })} error={errorForField(errors, index, "geo.longitudeDeg")} />
        <NumberField label="衛星番号 satnum" value={geo.satnum} integer onChange={(value) => updateGeo({ satnum: value })} error={errorForField(errors, index, "geo.satnum")} />
      </div>

      <button type="button" onClick={() => setShowAdvanced((value) => !value)} className="text-xs text-brand-text hover:text-brand-text">
        {showAdvanced ? "詳細設定を隠す" : "詳細設定を表示（傾斜角・エポック）"}
      </button>
      {showAdvanced && (
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="軌道傾斜角 inclination [deg]" description="0 で静止軌道。>0 で傾斜同期（8の字）軌道。" value={geo.inclinationDeg} onChange={(value) => updateGeo({ inclinationDeg: value })} error={errorForField(errors, index, "geo.inclinationDeg")} />
          <DateField label="エポック epoch [UTC]" value={geo.epoch} onChange={(date) => updateGeo({ epoch: date ?? geo.epoch })} />
        </div>
      )}

      <div className="space-y-1 rounded-md border border-line bg-sunken px-3 py-2 text-xs text-fg-muted">
        <div className="font-medium text-fg">生成される軌道要素（プレビュー）</div>
        <div>長半径 a = {preview.semiMajorAxisKm.toFixed(1)} km / 離心率 e = 0 / 傾斜 i = {preview.inclinationDeg.toFixed(2)}°</div>
        <div>RAAN = {preview.raanDeg.toFixed(3)}° / 近地点引数 = 0° / 平均近点角 M = 0°</div>
      </div>
    </div>
  );
}

function FormationEntryForm({
  entry,
  chiefOptions,
  index,
  errors,
  onChange,
}: {
  entry: FormationSatelliteEntry;
  chiefOptions: ManualSatelliteEntry[];
  index: number;
  errors: SatelliteEditorValidationError[];
  onChange: (updater: (entry: FormationSatelliteEntry) => FormationSatelliteEntry) => void;
}) {
  const switchMode = (mode: FormationMode) => {
    const fresh = createDefaultFormationEntry(mode);
    onChange((current) => ({ ...fresh, id: current.id, chiefSatnum: current.chiefSatnum, epoch: current.epoch, name: fresh.name }));
  };

  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-fg-muted">編隊名</Label>
          <input type="text" value={entry.name} onChange={(e) => onChange((current) => ({ ...current, name: e.target.value }))} className="w-full rounded border border-line-strong bg-sunken px-2 py-1.5 text-sm text-fg" />
        </div>
        <DateField label="エポック上書き [UTC]" value={entry.epoch} onChange={(date) => onChange((current) => ({ ...current, epoch: date }))} />
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-fg-muted">chief 衛星</Label>
        <select value={entry.chiefSatnum} onChange={(e) => onChange((current) => ({ ...current, chiefSatnum: Number(e.target.value) }))} className="w-full rounded border border-line-strong bg-sunken px-2 py-1.5 text-sm text-fg">
          <option value={0}>選択してください</option>
          {chiefOptions.map((option) => (
            <option key={option.id} value={option.elements?.satnum ?? 0}>{option.meta?.objectName || option.name || `satnum ${option.elements?.satnum}`}</option>
          ))}
        </select>
        {errorForField(errors, index, "chiefSatnum") && <p className="text-xs text-danger">{errorForField(errors, index, "chiefSatnum")}</p>}
      </div>

      <div className="rounded-md border border-line bg-sunken p-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-fg">
          <Orbit className="h-4 w-4 text-brand-text" />
          編隊モード
        </div>
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
          {FORMATION_MODES.map((mode) => (
            <button
              key={mode.mode}
              type="button"
              onClick={() => switchMode(mode.mode)}
              className={`rounded-md border px-3 py-2 text-left transition-colors ${
                entry.formationMode === mode.mode
                  ? "border-brand bg-brand-soft text-fg"
                  : "border-line bg-sunken text-fg hover:bg-sunken"
              }`}
            >
              <div className="text-sm font-medium">{mode.label}</div>
              <div className="mt-1 text-[11px] text-fg-muted">{mode.blurb}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-brand/40 bg-brand-soft px-3 py-2 text-xs text-fg">
        {getFormationModeDescription(entry.formationMode)}
      </div>

      {entry.formationMode === "custom" && <CustomFormationFields entry={entry} index={index} errors={errors} onChange={onChange} />}
      {entry.formationMode === "alongTrack" && <AlongTrackFields entry={entry} index={index} errors={errors} onChange={onChange} />}
      {entry.formationMode === "nmc" && <NmcFields entry={entry} onChange={onChange} />}
      {entry.formationMode === "crossTrackPendulum" && <CrossTrackPendulumFields entry={entry} onChange={onChange} />}
      {entry.formationMode === "helix" && <HelixFields entry={entry} index={index} errors={errors} onChange={onChange} />}
      {entry.formationMode === "gco" && <GcoFields entry={entry} index={index} errors={errors} onChange={onChange} />}
    </div>
  );
}

function CustomFormationFields({ entry, index, errors, onChange }: { entry: Extract<FormationSatelliteEntry, { formationMode: "custom" }>; index: number; errors: SatelliteEditorValidationError[]; onChange: (updater: (entry: FormationSatelliteEntry) => FormationSatelliteEntry) => void; }) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-line bg-sunken px-3 py-2 text-xs text-fg-muted">custom は汎用入力です。複数 deputy にしても自動で特定編隊の意味づけは行いません。</div>
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="deputy 数" value={entry.deputyCount} integer onChange={(value) => onChange((current) => ({ ...(current as CustomFormationEntry), deputyCount: value }))} error={errorForField(errors, index, "deputyCount")} />
        <div className="space-y-1">
          <Label className="text-xs text-fg-muted">入力モード</Label>
          <select value={entry.relativeModel} onChange={(e) => onChange((current) => ({ ...(current as CustomFormationEntry), relativeModel: e.target.value as FormationRelativeModel }))} className="w-full rounded border border-line-strong bg-sunken px-2 py-1.5 text-sm text-fg">
            <option value="roe">ROE</option>
            <option value="relativeState">距離ベース</option>
          </select>
        </div>
      </div>
      {entry.relativeModel === "roe" ? (
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Δa [km]" value={entry.roe.deltaAkm} onChange={(value) => onChange((current) => ({ ...(current as CustomFormationEntry), roe: { ...entry.roe, deltaAkm: value } }))} />
          <NumberField label="Δλ [deg]" value={entry.roe.deltaLambdaDeg} onChange={(value) => onChange((current) => ({ ...(current as CustomFormationEntry), roe: { ...entry.roe, deltaLambdaDeg: value } }))} />
          <NumberField label="Δe_x [-]" value={entry.roe.deltaEx} onChange={(value) => onChange((current) => ({ ...(current as CustomFormationEntry), roe: { ...entry.roe, deltaEx: value } }))} />
          <NumberField label="Δe_y [-]" value={entry.roe.deltaEy} onChange={(value) => onChange((current) => ({ ...(current as CustomFormationEntry), roe: { ...entry.roe, deltaEy: value } }))} />
          <NumberField label="Δi_x [deg]" value={entry.roe.deltaIxDeg} onChange={(value) => onChange((current) => ({ ...(current as CustomFormationEntry), roe: { ...entry.roe, deltaIxDeg: value } }))} />
          <NumberField label="Δi_y [deg]" value={entry.roe.deltaIyDeg} onChange={(value) => onChange((current) => ({ ...(current as CustomFormationEntry), roe: { ...entry.roe, deltaIyDeg: value } }))} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="半径方向 radial [km]" value={entry.relativeState.radialKm} onChange={(value) => onChange((current) => ({ ...(current as CustomFormationEntry), relativeState: { ...entry.relativeState, radialKm: value } }))} />
          <NumberField label="進行方向 along-track [km]" value={entry.relativeState.alongTrackKm} onChange={(value) => onChange((current) => ({ ...(current as CustomFormationEntry), relativeState: { ...entry.relativeState, alongTrackKm: value } }))} />
          <NumberField label="面外方向 cross-track [km]" value={entry.relativeState.crossTrackKm} onChange={(value) => onChange((current) => ({ ...(current as CustomFormationEntry), relativeState: { ...entry.relativeState, crossTrackKm: value } }))} />
          <NumberField label="位相オフセット phase [deg]" value={entry.relativeState.phaseOffsetDeg} onChange={(value) => onChange((current) => ({ ...(current as CustomFormationEntry), relativeState: { ...entry.relativeState, phaseOffsetDeg: value } }))} />
        </div>
      )}
    </div>
  );
}

function AlongTrackFields({ entry, index, errors, onChange }: { entry: Extract<FormationSatelliteEntry, { formationMode: "alongTrack" }>; index: number; errors: SatelliteEditorValidationError[]; onChange: (updater: (entry: FormationSatelliteEntry) => FormationSatelliteEntry) => void; }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <NumberField label="列をなす deputy 数" value={entry.deputyCount} integer onChange={(value) => onChange((current) => ({ ...(current as AlongTrackFormationEntry), deputyCount: value }))} error={errorForField(errors, index, "deputyCount")} />
      <NumberField label="衛星間隔 spacing [km]" value={entry.spacingKm} onChange={(value) => onChange((current) => ({ ...(current as AlongTrackFormationEntry), spacingKm: value }))} />
      <StaticField label="配置" value="chief を中心に対称配置" />
      <SelectField label="方向" value={entry.direction} onChange={(value) => onChange((current) => ({ ...(current as AlongTrackFormationEntry), direction: value as ProgradeDirection }))} options={[["prograde", "prograde"], ["retrograde", "retrograde"]]} />
    </div>
  );
}

function NmcFields({ entry, onChange }: { entry: Extract<FormationSatelliteEntry, { formationMode: "nmc" }>; onChange: (updater: (entry: FormationSatelliteEntry) => FormationSatelliteEntry) => void; }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <NumberField label="大きさ size [km]" description="半径方向の基準サイズです。" value={entry.sizeKm} onChange={(value) => onChange((current) => ({ ...(current as NmcFormationEntry), sizeKm: value }))} />
      <NumberField label="楕円の向き orientation [deg]" value={entry.orientationDeg} onChange={(value) => onChange((current) => ({ ...(current as NmcFormationEntry), orientationDeg: value }))} />
      <CheckboxField label="equidistant にする" checked={entry.equidistant} onChange={(checked) => onChange((current) => ({ ...(current as NmcFormationEntry), equidistant: checked }))} />
      <SelectField label="cross-track の向き" value={entry.crossTrackSign} onChange={(value) => onChange((current) => ({ ...(current as NmcFormationEntry), crossTrackSign: value as CrossTrackSide }))} options={[["north", "north"], ["south", "south"]]} />
      {!entry.equidistant && <NumberField label="cross-track オフセット [km]" value={entry.crossTrackOffsetKm} onChange={(value) => onChange((current) => ({ ...(current as NmcFormationEntry), crossTrackOffsetKm: value }))} />}
      <NumberField label="開始位相 phase [deg]" value={entry.phaseOffsetDeg} onChange={(value) => onChange((current) => ({ ...(current as NmcFormationEntry), phaseOffsetDeg: value }))} />
    </div>
  );
}

function CrossTrackPendulumFields({ entry, onChange }: { entry: Extract<FormationSatelliteEntry, { formationMode: "crossTrackPendulum" }>; onChange: (updater: (entry: FormationSatelliteEntry) => FormationSatelliteEntry) => void; }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <NumberField label="振れ幅 amplitude [km]" value={entry.amplitudeKm} onChange={(value) => onChange((current) => ({ ...(current as CrossTrackPendulumFormationEntry), amplitudeKm: value }))} />
      <NumberField label="位相 phase [deg]" value={entry.phaseOffsetDeg} onChange={(value) => onChange((current) => ({ ...(current as CrossTrackPendulumFormationEntry), phaseOffsetDeg: value }))} />
      <SelectField label="面外の向き" value={entry.side} onChange={(value) => onChange((current) => ({ ...(current as CrossTrackPendulumFormationEntry), side: value as CrossTrackSide }))} options={[["north", "north"], ["south", "south"]]} />
    </div>
  );
}

function HelixFields({ entry, index, errors, onChange }: { entry: Extract<FormationSatelliteEntry, { formationMode: "helix" }>; index: number; errors: SatelliteEditorValidationError[]; onChange: (updater: (entry: FormationSatelliteEntry) => FormationSatelliteEntry) => void; }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <NumberField label="衛星数 deputyCount" value={entry.deputyCount} integer onChange={(value) => onChange((current) => ({ ...(current as HelixFormationEntry), deputyCount: value }))} error={errorForField(errors, index, "deputyCount")} />
      <NumberField label="周回半径 radius [km]" value={entry.radiusKm} onChange={(value) => onChange((current) => ({ ...(current as HelixFormationEntry), radiusKm: value }))} />
      <NumberField label="1衛星ごとの進行方向ピッチ [km]" value={entry.pitchKm} onChange={(value) => onChange((current) => ({ ...(current as HelixFormationEntry), pitchKm: value }))} />
      <SelectField label="回り方" value={entry.turnDirection} onChange={(value) => onChange((current) => ({ ...(current as HelixFormationEntry), turnDirection: value as ProgradeDirection }))} options={[["prograde", "prograde"], ["retrograde", "retrograde"]]} />
      <NumberField label="開始位相 phase [deg]" value={entry.phaseOffsetDeg} onChange={(value) => onChange((current) => ({ ...(current as HelixFormationEntry), phaseOffsetDeg: value }))} />
    </div>
  );
}

function GcoFields({ entry, index, errors, onChange }: { entry: Extract<FormationSatelliteEntry, { formationMode: "gco" }>; index: number; errors: SatelliteEditorValidationError[]; onChange: (updater: (entry: FormationSatelliteEntry) => FormationSatelliteEntry) => void; }) {
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-info/40 bg-info-soft px-3 py-2 text-xs text-info">
        GCO は General Circular Orbit、別名 record-disk 軌道です。各 deputy は chief からほぼ一定距離を保ちながら円運動し、半径方向と面外方向は `z = √3 x` の関係になります。
      </div>
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="衛星数 deputyCount" description="record-disk 上に等角度で並べる deputy の数です。" value={entry.deputyCount} integer onChange={(value) => onChange((current) => ({ ...(current as GcoFormationEntry), deputyCount: value }))} error={errorForField(errors, index, "deputyCount")} />
        <NumberField label="chief からの一定距離 ρ [km]" description="各 deputy が chief の周りを回る代表半径です。" value={entry.radiusKm} onChange={(value) => onChange((current) => ({ ...(current as GcoFormationEntry), radiusKm: value }))} />
        <NumberField label="開始位相 phase [deg]" description="record-disk 上の最初の deputy の角度です。" value={entry.phaseOffsetDeg} onChange={(value) => onChange((current) => ({ ...(current as GcoFormationEntry), phaseOffsetDeg: value }))} />
        <SelectField label="回転方向" value={entry.rotationDirection} onChange={(value) => onChange((current) => ({ ...(current as GcoFormationEntry), rotationDirection: value as ProgradeDirection }))} options={[["prograde", "prograde"], ["retrograde", "retrograde"]]} />
        <StaticField label="幾何" value="|r| ≈ ρ, radial = 0.5ρ sinθ, along-track = ρ cosθ, cross-track = 0.866ρ sinθ" />
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange, error, integer = false, description }: { label: string; value: number; onChange: (value: number) => void; error?: string; integer?: boolean; description?: string; }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-fg-muted">{label}</Label>
      {description && <p className="text-xs text-fg-subtle">{description}</p>}
      <input type="number" step={integer ? 1 : "any"} value={Number.isFinite(value) ? value : 0} onChange={(e) => { const next = integer ? parseInt(e.target.value, 10) : parseFloat(e.target.value); if (!Number.isNaN(next)) onChange(next); }} className={`w-full rounded border bg-sunken px-2 py-1.5 text-sm text-fg ${error ? "border-danger" : "border-line-strong"}`} />
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function DateField({ label, value, onChange }: { label: string; value?: Date; onChange: (date: Date | undefined) => void; }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-fg-muted">{label}</Label>
      <input type="datetime-local" value={formatDateForInput(value)} onChange={(e) => onChange(e.target.value ? new Date(`${e.target.value}:00Z`) : undefined)} className="w-full rounded border border-line-strong bg-sunken px-2 py-1.5 text-sm text-fg" />
    </div>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]>; }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-fg-muted">{label}</Label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded border border-line-strong bg-sunken px-2 py-1.5 text-sm text-fg">
        {options.map(([val, labelText]) => <option key={val} value={val}>{labelText}</option>)}
      </select>
    </div>
  );
}

function CheckboxField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void; }) {
  return (
    <label className="flex items-center gap-2 rounded border border-line bg-sunken px-3 py-2 text-sm text-fg">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function StaticField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-fg-muted">{label}</Label>
      <div className="rounded border border-line bg-sunken px-2 py-1.5 text-sm text-fg">{value}</div>
    </div>
  );
}
