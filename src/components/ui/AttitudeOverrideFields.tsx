import { useId } from "react";
import type { SatelliteAttitudeMode, SatelliteAttitudeOverride } from "../../lib/attitude/types";
import {
  ATTITUDE_MODE_OPTIONS,
  ATTITUDE_MODE_SHORT_LABELS,
  STATION_MISSING_WARNING,
  SUN_POINTING_ACCESS_WARNING,
} from "../../lib/attitude/settings";
import { ATTITUDE_TOML_KEYS, attitudeOverrideSummary, hasAttitudeOverride, type AttitudeTomlKey } from "../../lib/attitude/resolve";
import { numericInputValue, parseNumericInput } from "../../lib/numericInput";

interface Props {
  value: SatelliteAttitudeOverride | undefined;
  /** `undefined` = follow the global setting (通信タブ). */
  onChange: (next: SatelliteAttitudeOverride | undefined) => void;
  /** Ground station names of the scenario (for 地上局指向). */
  stationNames: readonly string[];
  /** Who the setting applies to, e.g. 「このシェルの全衛星」. */
  scope: string;
  /** Validation message for one `attitude_*` key, if any. */
  errorFor?: (key: AttitudeTomlKey) => string | undefined;
}

const INHERIT = "";
const SAME_AS_BASE = "";
const selectCls = "w-full rounded border border-line-strong bg-sunken px-2 py-1.5 text-sm text-fg";
const inputCls = (error?: string) =>
  `w-full rounded border bg-sunken px-2 py-1.5 text-sm text-fg ${error ? "border-danger" : "border-line-strong"}`;

/** Drops undefined fields; undefined when nothing is left. */
function compact(o: SatelliteAttitudeOverride): SatelliteAttitudeOverride | undefined {
  const out: SatelliteAttitudeOverride = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return hasAttitudeOverride(out) ? out : undefined;
}

/**
 * 姿勢 for one constellation shell or one `[[satellites]]` entry: 「全体設定に
 * 従う（通信タブ）」 or a mode of its own, with the mode's fields and the
 * 運用スケジュール options. Blank numbers inherit the global value.
 */
export default function AttitudeOverrideFields({ value, onChange, stationNames, scope, errorFor }: Props) {
  const id = useId();
  const o = value ?? {};
  const mode = o.mode;
  const set = (patch: Partial<SatelliteAttitudeOverride>) => onChange(compact({ ...o, ...patch }));
  const partialOnly = mode === undefined && hasAttitudeOverride(value);
  const option = ATTITUDE_MODE_OPTIONS.find((x) => x.mode === mode);
  const stationUsed = mode === "station" || o.trackStationDuringPass === true;
  const stationMissing = o.stationName !== undefined && !stationNames.includes(o.stationName);
  const err = (key: AttitudeTomlKey) => errorFor?.(key);

  const selectMode = (next: string) => {
    if (next === INHERIT) {
      onChange(undefined);
      return;
    }
    const m = next as SatelliteAttitudeMode;
    // Seed a station for 地上局指向 so the law does something right away.
    // Drop a station nothing uses any more, so the TOML stays minimal.
    const stationName = m === "station" && o.stationName === undefined && stationNames.length > 0
      ? stationNames[0]
      : m !== "station" && !o.trackStationDuringPass ? undefined : o.stationName;
    set({ mode: m, stationName });
  };

  const numberInput = (key: "inertialRaDeg" | "inertialDecDeg" | "maxSlewRateDegS", label: string, placeholder: string) => {
    const tomlKey = ATTITUDE_TOML_KEYS[key];
    const v = o[key];
    return (
      <div className="space-y-1">
        <label htmlFor={`${id}-${key}`} className="text-xs text-fg-muted">{label}</label>
        <input
          id={`${id}-${key}`}
          type="number"
          step="any"
          placeholder={placeholder}
          value={numericInputValue(v ?? NaN)}
          onChange={(e) => {
            const n = parseNumericInput(e.target.value);
            set({ [key]: Number.isFinite(n) ? n : undefined });
          }}
          className={inputCls(err(tomlKey))}
        />
        {err(tomlKey) && <p className="text-xs text-danger">{err(tomlKey)}</p>}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label htmlFor={`${id}-mode`} className="text-xs text-fg-muted">姿勢（{scope}）</label>
        <select id={`${id}-mode`} value={mode ?? INHERIT} onChange={(e) => selectMode(e.target.value)} className={selectCls}>
          <option value={INHERIT}>全体設定に従う（通信タブ）</option>
          {ATTITUDE_MODE_OPTIONS.map((x) => (
            <option key={x.mode} value={x.mode} disabled={x.mode === "station" && stationNames.length === 0 && mode !== "station"}>
              {x.mode === "station" && stationNames.length === 0 ? "地上局指向（地上局がありません）" : x.label}
            </option>
          ))}
        </select>
        {err(ATTITUDE_TOML_KEYS.mode) && <p className="text-xs text-danger">{err(ATTITUDE_TOML_KEYS.mode)}</p>}
        <p className="text-xs text-fg-subtle">
          {option
            ? option.description
            : partialOnly
              ? `全体設定のうち一部だけ変更しています（${attitudeOverrideSummary(value)}）。`
              : "通信タブ › 衛星の姿勢とセンサの設定を使います。"}
        </p>
        {partialOnly && (
          <button type="button" onClick={() => onChange(undefined)} className="text-xs text-brand-text underline">
            変更を解除して全体設定に戻す
          </button>
        )}
      </div>

      {mode !== undefined && (
        <>
          {stationUsed && (
            <div className="space-y-1">
              <label htmlFor={`${id}-station`} className="text-xs text-fg-muted">地上局</label>
              <select
                id={`${id}-station`}
                value={o.stationName ?? INHERIT}
                onChange={(e) => set({ stationName: e.target.value === INHERIT ? undefined : e.target.value })}
                className={selectCls}
              >
                <option value={INHERIT}>全体設定と同じ局</option>
                {stationMissing && <option value={o.stationName}>{o.stationName}（見つかりません）</option>}
                {stationNames.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              {stationMissing && <p className="rounded-md bg-warning-soft px-2 py-1 text-xs text-warning">{STATION_MISSING_WARNING}</p>}
            </div>
          )}

          {mode === "inertial" && (
            <div className="grid grid-cols-2 gap-3">
              {numberInput("inertialRaDeg", "赤経 [deg]", "全体設定")}
              {numberInput("inertialDecDeg", "赤緯 [deg]", "全体設定")}
            </div>
          )}

          {mode === "sun" && <p className="rounded-md bg-warning-soft px-2 py-1 text-xs text-warning">{SUN_POINTING_ACCESS_WARNING}</p>}

          <div className="space-y-2 border-t border-line pt-2">
            <p className="text-xs font-medium text-fg-muted">運用スケジュール</p>
            <label className="flex items-center gap-2 text-xs text-fg">
              <input
                type="checkbox"
                checked={o.trackStationDuringPass === true}
                disabled={mode === "station"}
                onChange={(e) => set({
                  trackStationDuringPass: e.target.checked ? true : undefined,
                  stationName: e.target.checked && o.stationName === undefined && stationNames.length > 0 ? stationNames[0] : o.stationName,
                })}
              />
              地上局が見えている間は地上局指向にする
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor={`${id}-eclipse`} className="text-xs text-fg-muted">日陰の間の姿勢</label>
                <select
                  id={`${id}-eclipse`}
                  value={o.eclipseMode ?? SAME_AS_BASE}
                  onChange={(e) => set({ eclipseMode: e.target.value === SAME_AS_BASE ? undefined : (e.target.value as SatelliteAttitudeMode) })}
                  className={selectCls}
                >
                  <option value={SAME_AS_BASE}>基本と同じ</option>
                  {ATTITUDE_MODE_OPTIONS.map((x) => (
                    <option key={x.mode} value={x.mode}>{ATTITUDE_MODE_SHORT_LABELS[x.mode]}</option>
                  ))}
                </select>
                {err(ATTITUDE_TOML_KEYS.eclipseMode) && <p className="text-xs text-danger">{err(ATTITUDE_TOML_KEYS.eclipseMode)}</p>}
              </div>
              {numberInput("maxSlewRateDegS", "姿勢変更の最大レート [°/s]", "全体設定")}
            </div>
            <p className="text-xs text-fg-subtle">最大レートの空欄は全体設定、0 は即時切替です。</p>
          </div>
        </>
      )}
    </div>
  );
}
