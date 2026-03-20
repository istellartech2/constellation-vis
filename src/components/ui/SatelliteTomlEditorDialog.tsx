import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Rows3, Satellite, Trash2 } from "lucide-react";
import { Button } from "./button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./dialog";
import { Label } from "./label";
import {
  applyFormationPreset,
  getChiefOptions,
  getEntryDisplayName,
  parseSatelliteEditorConfig,
  serializeSatelliteEditorConfig,
  syncFormationRepresentations,
  validateSatelliteEditorConfig,
  type SatelliteEditorValidationError,
} from "../../lib/satelliteEditorSerializer";
import {
  createDefaultFormationEntry,
  createDefaultManualEntry,
  type FormationSatelliteEntry,
  type ManualSatelliteEntry,
  type SatelliteEditorConfig,
  type SatelliteEditorEntry,
} from "../../lib/satelliteEditorTypes";

interface Props {
  open: boolean;
  satText: string;
  onSatTextChange: (text: string) => void;
  onClose: () => void;
}

function formatDateForInput(date?: Date): string {
  if (!date || Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function getNextManualSatnum(config: SatelliteEditorConfig): number {
  const maxSatnum = config.entries
    .filter((entry): entry is ManualSatelliteEntry => entry.kind === "manual" && entry.type === "elements" && !!entry.elements)
    .reduce((maxValue, entry) => Math.max(maxValue, entry.elements!.satnum), 90000);
  return Math.min(maxSatnum + 1, 99999);
}

function errorForField(
  errors: SatelliteEditorValidationError[],
  index: number,
  field: string,
): string | undefined {
  const key = `entry.${index}.${field}`;
  return errors.find((error) => error.field === key)?.message;
}

function hasEntryError(errors: SatelliteEditorValidationError[], index: number): boolean {
  return errors.some((error) => error.field.startsWith(`entry.${index}.`));
}

function summaryForEntry(entry: SatelliteEditorEntry, chiefName?: string): string {
  if (entry.kind === "manual") {
    if (entry.type === "tle") return "2行 TLE をそのまま satellites.toml に保存します。";
    const el = entry.elements;
    return el
      ? `satnum ${el.satnum} / a=${el.semiMajorAxisKm.toFixed(1)} km / i=${el.inclinationDeg.toFixed(2)}° / e=${el.eccentricity.toFixed(4)}`
      : "軌道要素を入力して衛星を追加します。";
  }
  const modeLabel = entry.relativeModel === "roe" ? "ROE" : "距離ベース";
  return `${chiefName ?? "chief 未選択"} を基準に deputy ${entry.deputyCount} 機を ${modeLabel} で生成します。`;
}

function selectionTitle(entry: SatelliteEditorEntry | null): string {
  if (!entry) return "現在選択中: なし";
  if (entry.kind === "manual") {
    return `現在選択中: 単独衛星 ${getEntryDisplayName(entry, 0)}`;
  }
  return `現在選択中: 編隊 ${entry.name}`;
}

function formationGeometryText(entry: FormationSatelliteEntry): string {
  switch (entry.preset) {
    case "along-track-train":
      return "Along-track train: 同一軌道面上で位相だけをずらし、隊列状に並ぶ設定です。";
    case "projected-circular":
      return "Projected circular: LVLH 平面で円に近い相対運動を作る初期値です。";
    case "general-circular-orbit":
      return "General Circular Orbit (GCO): radial と cross-track が z = √3 x の関係を持つ 3次元の相対円運動です。";
    case "in-plane-ellipse":
      return "In-plane ellipse: 軌道面内で楕円状の相対運動を作る初期値です。";
    case "cross-track-only":
      return "Cross-track only: 面外方向の分離を主体にする初期値です。";
    case "custom":
    default:
      return "Custom: chief に対する相対軌道要素を自由に入力します。";
  }
}

export default function SatelliteTomlEditorDialog({
  open,
  satText,
  onSatTextChange,
  onClose,
}: Props) {
  const [config, setConfig] = useState<SatelliteEditorConfig>({ entries: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [errors, setErrors] = useState<SatelliteEditorValidationError[]>([]);

  useEffect(() => {
    if (!open) return;
    const parsed = syncFormationRepresentations(parseSatelliteEditorConfig(satText));
    setConfig(parsed);
    setSelectedId(parsed.entries[0]?.id ?? null);
    setErrors([]);
  }, [open, satText]);

  useEffect(() => {
    setErrors(validateSatelliteEditorConfig(config).errors);
  }, [config]);

  const chiefOptions = useMemo(() => getChiefOptions(config), [config]);
  const selectedEntry = useMemo(
    () => config.entries.find((entry) => entry.id === selectedId) ?? null,
    [config.entries, selectedId],
  );
  const selectedIndex = useMemo(
    () => config.entries.findIndex((entry) => entry.id === selectedId),
    [config.entries, selectedId],
  );

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

  const handleAddFormation = useCallback(() => {
    const newEntry = createDefaultFormationEntry();
    updateConfig((current) => {
      const chief = getChiefOptions(current)[0];
      newEntry.chiefSatnum = chief?.elements?.satnum ?? 0;
      newEntry.relativeState = applyFormationPreset(newEntry.preset).relativeState;
      newEntry.roe = applyFormationPreset(newEntry.preset).roe;
      return { entries: [...current.entries, newEntry] };
    });
    setSelectedId(newEntry.id);
  }, [updateConfig]);

  useEffect(() => {
    if (!selectedId && config.entries[0]) {
      setSelectedId(config.entries[0].id);
    }
  }, [config.entries, selectedId]);

  const handleDelete = useCallback(() => {
    if (!selectedId) return;
    setConfig((current) => {
      const nextEntries = current.entries.filter((entry) => entry.id !== selectedId);
      const currentIndex = current.entries.findIndex((entry) => entry.id === selectedId);
      const nextSelected = nextEntries[Math.min(currentIndex, nextEntries.length - 1)]?.id ?? null;
      setSelectedId(nextSelected);
      return { entries: nextEntries };
    });
  }, [selectedId]);

  const handleMove = useCallback((direction: "up" | "down") => {
    if (!selectedId) return;
    updateConfig((current) => {
      const index = current.entries.findIndex((entry) => entry.id === selectedId);
      if (index < 0) return current;
      const nextIndex = direction === "up" ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= current.entries.length) return current;
      const nextEntries = [...current.entries];
      [nextEntries[index], nextEntries[nextIndex]] = [nextEntries[nextIndex], nextEntries[index]];
      return { entries: nextEntries };
    });
  }, [selectedId, updateConfig]);

  const handleApply = useCallback(() => {
    const normalized = syncFormationRepresentations(config);
    const validation = validateSatelliteEditorConfig(normalized);
    setErrors(validation.errors);
    if (!validation.isValid) return;
    onSatTextChange(serializeSatelliteEditorConfig(normalized));
  }, [config, onSatTextChange]);

  const handleOk = useCallback(() => {
    const normalized = syncFormationRepresentations(config);
    const validation = validateSatelliteEditorConfig(normalized);
    setErrors(validation.errors);
    if (!validation.isValid) return;
    onSatTextChange(serializeSatelliteEditorConfig(normalized));
    onClose();
  }, [config, onClose, onSatTextChange]);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="!w-[92vw] !max-w-6xl max-h-[88vh] overflow-hidden flex flex-col bg-gray-900 text-gray-100">
        <DialogHeader>
          <DialogTitle className="text-gray-100">人工衛星軌道編集</DialogTitle>
        </DialogHeader>

        <div className="rounded-md border border-gray-700 bg-gray-850/70 px-4 py-3 text-sm text-gray-200">
          <div className="text-xs font-medium uppercase tracking-wide text-amber-300">
            {selectionTitle(selectedEntry)}
          </div>
          <div className="mt-1">
            {selectedEntry
              ? summaryForEntry(
                  selectedEntry,
                  selectedEntry.kind === "formation"
                    ? chiefOptions.find((option) => option.elements?.satnum === selectedEntry.chiefSatnum)?.meta?.objectName
                    : undefined,
                )
              : "左の一覧から衛星または編隊を選択してください。"}
          </div>
        </div>

        <div className="flex-1 border border-gray-600 rounded-md overflow-hidden flex min-h-0">
          <div className="w-72 flex-shrink-0 border-r border-gray-600 bg-gray-900 flex flex-col">
            <div className="p-2 border-b border-gray-600 space-y-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddManual}
                className="w-full justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-100 border-gray-600"
              >
                <Satellite className="h-4 w-4" />
                単独衛星を追加
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddFormation}
                className="w-full justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-100 border-gray-600"
              >
                <Rows3 className="h-4 w-4" />
                編隊を追加
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {config.entries.length === 0 ? (
                <div className="p-5 text-sm text-gray-500 text-center">エントリがありません</div>
              ) : (
                <ul className="divide-y divide-gray-700">
                  {config.entries.map((entry, index) => (
                    <li
                      key={entry.id}
                      onClick={() => setSelectedId(entry.id)}
                      className={`cursor-pointer border-l-2 px-3 py-2 transition-colors ${
                        entry.id === selectedId
                          ? "border-l-amber-400 bg-amber-900/40 text-amber-50"
                          : entry.kind === "formation"
                            ? "border-l-sky-500/40 hover:bg-gray-800 text-gray-200"
                            : "border-l-transparent hover:bg-gray-800 text-gray-200"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {hasEntryError(errors, index) && <span className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0" />}
                        <span className="truncate flex-1 text-sm">{getEntryDisplayName(entry, index)}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            entry.kind === "manual"
                              ? "bg-gray-800 text-gray-300"
                              : "bg-sky-900/60 text-sky-200"
                          }`}
                        >
                          {entry.kind === "manual" ? "manual" : "formation"}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {selectedId && (
              <div className="p-2 border-t border-gray-600 flex gap-1 justify-center">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => handleMove("up")}
                  disabled={selectedIndex <= 0}
                  className="h-8 w-8 bg-gray-800 hover:bg-gray-700 text-gray-100 border-gray-600 disabled:opacity-40"
                  title="上へ移動"
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => handleMove("down")}
                  disabled={selectedIndex < 0 || selectedIndex >= config.entries.length - 1}
                  className="h-8 w-8 bg-gray-800 hover:bg-gray-700 text-gray-100 border-gray-600 disabled:opacity-40"
                  title="下へ移動"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleDelete}
                  className="h-8 w-8 bg-gray-800 hover:bg-red-700 text-gray-100 hover:text-white border-gray-600 hover:border-red-600"
                  title="削除"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto bg-gray-850">
            {!selectedEntry && (
              <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                左の一覧から衛星または編隊を選択してください
              </div>
            )}

            {selectedEntry && selectedEntry.kind === "manual" && (
              <ManualEntryForm
                entry={selectedEntry}
                index={selectedIndex}
                errors={errors}
                onChange={(updater) => updateSelectedEntry((entry) => updater(entry as ManualSatelliteEntry))}
              />
            )}

            {selectedEntry && selectedEntry.kind === "formation" && (
              <FormationEntryForm
                entry={selectedEntry}
                chiefOptions={chiefOptions}
                geometryText={formationGeometryText(selectedEntry)}
                index={selectedIndex}
                errors={errors}
                onChange={(updater) => updateSelectedEntry((entry) => updater(entry as FormationSatelliteEntry))}
              />
            )}
          </div>
        </div>

        {errors.length > 0 && (
          <div className="rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-200">
            {errors[0]?.message}
          </div>
        )}

        <DialogFooter className="border-t border-gray-700 pt-3">
          <Button variant="outline" onClick={onClose} className="bg-gray-700 hover:bg-gray-600 text-gray-100 border-gray-500">
            キャンセル
          </Button>
          <Button variant="outline" onClick={handleApply} className="bg-gray-700 hover:bg-gray-600 text-gray-100 border-gray-500">
            Apply
          </Button>
          <Button onClick={handleOk} className="bg-amber-600 hover:bg-amber-700 text-amber-50">
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
          <Label className="text-xs text-gray-400">保存形式</Label>
          <select
            value={entry.type}
            onChange={(e) => {
              const nextType = e.target.value as ManualSatelliteEntry["type"];
              onChange((current) =>
                nextType === "tle"
                  ? {
                      ...current,
                      type: "tle",
                      tle: current.tle ?? { line1: "", line2: "" },
                    }
                  : {
                      ...current,
                      type: "elements",
                      elements: current.elements ?? elements,
                    },
              );
            }}
            className="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-amber-500 focus:outline-none"
          >
            <option value="elements">軌道要素</option>
            <option value="tle">TLE</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-gray-400">表示名</Label>
          <input
            type="text"
            value={entry.name ?? ""}
            onChange={(e) => onChange((current) => ({
              ...current,
              name: e.target.value,
              meta: { ...current.meta, objectName: e.target.value || undefined },
            }))}
            className="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-amber-500 focus:outline-none"
          />
        </div>
      </div>

      {entry.type === "tle" ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-gray-400">TLE Line 1</Label>
            <textarea
              value={entry.tle?.line1 ?? ""}
              onChange={(e) => onChange((current) => ({
                ...current,
                tle: { line1: e.target.value, line2: current.tle?.line2 ?? "" },
              }))}
              className="min-h-20 w-full rounded border border-gray-600 bg-gray-800 px-2 py-2 text-xs font-mono text-gray-100 focus:border-amber-500 focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-gray-400">TLE Line 2</Label>
            <textarea
              value={entry.tle?.line2 ?? ""}
              onChange={(e) => onChange((current) => ({
                ...current,
                tle: { line1: current.tle?.line1 ?? "", line2: e.target.value },
              }))}
              className="min-h-20 w-full rounded border border-gray-600 bg-gray-800 px-2 py-2 text-xs font-mono text-gray-100 focus:border-amber-500 focus:outline-none"
            />
            {errorForField(errors, index, "tle") && <p className="text-xs text-red-400">{errorForField(errors, index, "tle")}</p>}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="衛星番号 satnum"
              value={elements.satnum}
              onChange={(value) => onChange((current) => ({ ...current, elements: { ...(current.elements ?? elements), satnum: value } }))}
              error={errorForField(errors, index, "elements.satnum")}
              integer
            />
            <div className="space-y-1">
              <Label className="text-xs text-gray-400">エポック epoch [UTC]</Label>
              <input
                type="datetime-local"
                value={formatDateForInput(elements.epoch)}
                onChange={(e) => onChange((current) => ({
                  ...current,
                  elements: { ...(current.elements ?? elements), epoch: new Date(`${e.target.value}:00Z`) },
                }))}
                className="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="長半径 semiMajorAxis [km]"
              value={elements.semiMajorAxisKm}
              onChange={(value) => onChange((current) => ({ ...current, elements: { ...(current.elements ?? elements), semiMajorAxisKm: value } }))}
              error={errorForField(errors, index, "elements.semiMajorAxisKm")}
            />
            <NumberField
              label="離心率 eccentricity [-]"
              value={elements.eccentricity}
              onChange={(value) => onChange((current) => ({ ...current, elements: { ...(current.elements ?? elements), eccentricity: value } }))}
              error={errorForField(errors, index, "elements.eccentricity")}
            />
            <NumberField
              label="軌道傾斜角 inclination [deg]"
              value={elements.inclinationDeg}
              onChange={(value) => onChange((current) => ({ ...current, elements: { ...(current.elements ?? elements), inclinationDeg: value } }))}
            />
            <NumberField
              label="昇交点赤経 RAAN [deg]"
              value={elements.raanDeg}
              onChange={(value) => onChange((current) => ({ ...current, elements: { ...(current.elements ?? elements), raanDeg: value } }))}
            />
            <NumberField
              label="近地点引数 argument of perigee [deg]"
              value={elements.argPerigeeDeg}
              onChange={(value) => onChange((current) => ({ ...current, elements: { ...(current.elements ?? elements), argPerigeeDeg: value } }))}
            />
            <NumberField
              label="平均近点角 mean anomaly [deg]"
              value={elements.meanAnomalyDeg}
              onChange={(value) => onChange((current) => ({ ...current, elements: { ...(current.elements ?? elements), meanAnomalyDeg: value } }))}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function FormationEntryForm({
  entry,
  chiefOptions,
  geometryText,
  index,
  errors,
  onChange,
}: {
  entry: FormationSatelliteEntry;
  chiefOptions: ManualSatelliteEntry[];
  geometryText: string;
  index: number;
  errors: SatelliteEditorValidationError[];
  onChange: (updater: (entry: FormationSatelliteEntry) => FormationSatelliteEntry) => void;
}) {
  const handlePresetChange = (preset: FormationSatelliteEntry["preset"]) => {
    const values = applyFormationPreset(preset);
    onChange((current) => ({
      ...current,
      preset,
      roe: values.roe,
      relativeState: values.relativeState,
    }));
  };

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-md border border-amber-800/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-100">
        {geometryText}
      </div>
      {entry.preset === "custom" && (
        <div className="rounded-md border border-gray-700 bg-gray-900/70 px-3 py-2 text-xs text-gray-300">
          custom は 1 機ぶんの相対要素をそのまま使います。`deputy` を増やしても自動で段階配置はせず、段階的に広げたい場合はプリセットを選んでください。
        </div>
      )}
      {entry.preset !== "custom" && entry.deputyCount > 1 && (
        <div className="rounded-md border border-sky-800/50 bg-sky-950/20 px-3 py-2 text-xs text-sky-100">
          このプリセットでは deputy ごとに 1x, 2x, 3x... の倍率で相対量を広げ、chief 周辺に段階配置します。
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-gray-400">編隊名</Label>
          <input
            type="text"
            value={entry.name}
            onChange={(e) => onChange((current) => ({ ...current, name: e.target.value }))}
            className="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-amber-500 focus:outline-none"
          />
          {errorForField(errors, index, "name") && <p className="text-xs text-red-400">{errorForField(errors, index, "name")}</p>}
        </div>
        <NumberField
          label="deputy 数"
          value={entry.deputyCount}
          onChange={(value) => onChange((current) => ({ ...current, deputyCount: value }))}
          error={errorForField(errors, index, "deputyCount")}
          integer
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-gray-400">chief 衛星</Label>
          <select
            value={entry.chiefSatnum}
            onChange={(e) => onChange((current) => ({ ...current, chiefSatnum: Number(e.target.value) }))}
            className="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-amber-500 focus:outline-none"
          >
            <option value={0}>選択してください</option>
            {chiefOptions.map((option) => (
              <option key={option.id} value={option.elements?.satnum ?? 0}>
                {option.meta?.objectName || option.name || `satnum ${option.elements?.satnum}`}
              </option>
            ))}
          </select>
          {errorForField(errors, index, "chiefSatnum") && <p className="text-xs text-red-400">{errorForField(errors, index, "chiefSatnum")}</p>}
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-gray-400">エポック上書き [UTC]</Label>
          <input
            type="datetime-local"
            value={formatDateForInput(entry.epoch)}
            onChange={(e) => onChange((current) => ({
              ...current,
              epoch: e.target.value ? new Date(`${e.target.value}:00Z`) : undefined,
            }))}
            className="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-amber-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-gray-400">入力モード</Label>
          <select
            value={entry.relativeModel}
            onChange={(e) => onChange((current) => ({ ...current, relativeModel: e.target.value as FormationSatelliteEntry["relativeModel"] }))}
            className="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-amber-500 focus:outline-none"
          >
            <option value="roe">ROE</option>
            <option value="relativeState">距離ベース</option>
          </select>
          <p className="text-xs text-gray-500">
            ROE は chief に対する相対軌道要素、距離ベースは見た目の相対距離を直接入力する方式です。
          </p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-gray-400">プリセット</Label>
          <select
            value={entry.preset}
            onChange={(e) => handlePresetChange(e.target.value as FormationSatelliteEntry["preset"])}
            className="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-amber-500 focus:outline-none"
          >
            <option value="custom">custom</option>
            <option value="along-track-train">along-track train</option>
            <option value="projected-circular">projected circular</option>
            <option value="general-circular-orbit">General Circular Orbit (GCO)</option>
            <option value="in-plane-ellipse">in-plane ellipse</option>
            <option value="cross-track-only">cross-track only</option>
          </select>
        </div>
      </div>

      {entry.relativeModel === "roe" ? (
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Δa [km]"
            description="長半径の差です。軌道周期の差に効きます。"
            value={entry.roe.deltaAkm}
            onChange={(value) => onChange((current) => ({ ...current, roe: { ...current.roe, deltaAkm: value } }))}
          />
          <NumberField
            label="Δλ [deg]"
            description="進行方向の位相差です。前後のずれに効きます。"
            value={entry.roe.deltaLambdaDeg}
            onChange={(value) => onChange((current) => ({ ...current, roe: { ...current.roe, deltaLambdaDeg: value } }))}
          />
          <NumberField
            label="Δe_x [-]"
            description="軌道面内の離心率差の x 成分です。半径方向の振れに効きます。"
            value={entry.roe.deltaEx}
            onChange={(value) => onChange((current) => ({ ...current, roe: { ...current.roe, deltaEx: value } }))}
          />
          <NumberField
            label="Δe_y [-]"
            description="軌道面内の離心率差の y 成分です。面内の楕円形状に効きます。"
            value={entry.roe.deltaEy}
            onChange={(value) => onChange((current) => ({ ...current, roe: { ...current.roe, deltaEy: value } }))}
          />
          <NumberField
            label="Δi_x [deg]"
            description="面外方向の傾斜差の x 成分です。上下方向のずれに効きます。"
            value={entry.roe.deltaIxDeg}
            onChange={(value) => onChange((current) => ({ ...current, roe: { ...current.roe, deltaIxDeg: value } }))}
          />
          <NumberField
            label="Δi_y [deg]"
            description="面外方向の傾斜差の y 成分です。軌道面の向きの差に効きます。"
            value={entry.roe.deltaIyDeg}
            onChange={(value) => onChange((current) => ({ ...current, roe: { ...current.roe, deltaIyDeg: value } }))}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="半径方向 radial [km]"
            description="地球に近づく/離れる向きの相対距離です。"
            value={entry.relativeState.radialKm}
            onChange={(value) => onChange((current) => ({ ...current, relativeState: { ...current.relativeState, radialKm: value } }))}
          />
          <NumberField
            label="進行方向 along-track [km]"
            description="軌道に沿った前後方向の相対距離です。"
            value={entry.relativeState.alongTrackKm}
            onChange={(value) => onChange((current) => ({ ...current, relativeState: { ...current.relativeState, alongTrackKm: value } }))}
          />
          <NumberField
            label="面外方向 cross-track [km]"
            description="軌道面から上下に外れる方向の相対距離です。"
            value={entry.relativeState.crossTrackKm}
            onChange={(value) => onChange((current) => ({ ...current, relativeState: { ...current.relativeState, crossTrackKm: value } }))}
          />
          <NumberField
            label="位相オフセット phase [deg]"
            description="相対運動の初期位置をどこから始めるかの角度です。"
            value={entry.relativeState.phaseOffsetDeg}
            onChange={(value) => onChange((current) => ({ ...current, relativeState: { ...current.relativeState, phaseOffsetDeg: value } }))}
          />
        </div>
      )}
    </div>
  );
}

function NumberField({
  label,
  description,
  value,
  onChange,
  error,
  integer = false,
}: {
  label: string;
  description?: string;
  value: number;
  onChange: (value: number) => void;
  error?: string;
  integer?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-gray-400">{label}</Label>
      {description && <p className="text-xs text-gray-500">{description}</p>}
      <input
        type="number"
        step={integer ? 1 : "any"}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => {
          const next = integer ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
          if (!Number.isNaN(next)) onChange(next);
        }}
        className={`w-full rounded border bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:outline-none ${
          error ? "border-red-500 focus:border-red-400" : "border-gray-600 focus:border-amber-500"
        }`}
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
