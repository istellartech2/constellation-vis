import katex from "katex";
import "katex/dist/katex.min.css";
import type { SatelliteSpec } from "../../lib/satellites";
import { catalogSpecAt, type SatelliteCatalog } from "../../lib/satelliteCatalog";
import * as satellite from "satellite.js";
import {
  calculateDetailedPerturbationRates,
  formatJ2PerturbationRates,
  formatJ3PerturbationRates,
} from "../../lib/perturbation";
import {
  formatDurationMinutes,
  getSatelliteDerivedInfo,
  isInEarthShadow,
} from "../../lib/satelliteDerivedInfo";
import { useState, type ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";
import type { SatelliteCameraMode } from "../../lib/visualization";
import { toSatrec } from "../../lib/satellites";
import { sunVectorECI } from "../../lib/astronomy";
import type { GroundStation } from "../../lib/groundStations";
import {
  attitudeStateProviderFromSatrec,
  prepareAttitudeContext,
  satelliteAttitudeStateFromContext,
  sensorBoresightEci,
  solarArrayIncidence,
} from "../../lib/attitude/satelliteAttitude";
import { activeAttitudeLabel } from "../../lib/attitude/settings";
import { attitudeOverrideLabel, resolveSatelliteAttitude } from "../../lib/attitude/resolve";
import type { SatelliteAttitudeSettings, SolarArrayType } from "../../lib/attitude/types";
import { satelliteDisplayName, satelliteIdentifiers } from "../../lib/analysisSatellites";

const CAMERA_VIEW_OPTIONS: { mode: SatelliteCameraMode; label: string }[] = [
  { mode: "free", label: "全体" },
  { mode: "earthCenter", label: "地球中心" },
  { mode: "thirdPerson", label: "後方追跡" },
  { mode: "closeUp", label: "近接" },
];

const SOLAR_ARRAY_SHORT_LABELS: Record<SolarArrayType, string> = {
  fixed: "固定",
  singleAxis: "1軸追尾",
};

interface AttitudeReadout {
  modeLabel: string;
  sunlit: boolean;
  /** Angle between the panel normal and the Sun (deg), null when the Sun is behind the panel. */
  incidenceDeg: number | null;
  /** cos of the incidence, 0 in shadow / from behind. */
  cosIncidence: number;
  /** Sensor boresight off nadir (deg). */
  sensorOffNadirDeg: number | null;
}

/**
 * Attitude readout of an editor satellite at `at` (SGP4), from the same
 * attitude law as the 3D cones and the 近接 model. Null when propagation fails.
 */
function attitudeReadout(
  spec: SatelliteSpec,
  at: Date,
  settings: SatelliteAttitudeSettings,
  arrayType: SolarArrayType,
  stations: readonly GroundStation[],
  alongTrackDeg: number,
  crossTrackDeg: number,
): AttitudeReadout | null {
  let pv: ReturnType<typeof satellite.propagate>;
  let rec: satellite.SatRec;
  try {
    rec = toSatrec(spec);
    pv = satellite.propagate(rec, at);
  } catch {
    return null;
  }
  if (!pv?.position || !pv.velocity) return null;
  const pos = pv.position;
  // Same law (incl. 運用スケジュール and the slew limit) as the 3D cones / 近接 model.
  const state = satelliteAttitudeStateFromContext(
    pos,
    pv.velocity,
    prepareAttitudeContext(at, resolveSatelliteAttitude(spec, settings), stations),
    attitudeStateProviderFromSatrec(rec),
  );
  const q = state.q;
  const sun = sunVectorECI(at);
  const n = Math.hypot(sun.x, sun.y, sun.z) || 1;
  const { cosIncidence } = solarArrayIncidence(q, { x: sun.x / n, y: sun.y / n, z: sun.z / n }, arrayType);
  const sunlit = !isInEarthShadow(pos, at);
  const boresight = sensorBoresightEci(q, alongTrackDeg, crossTrackDeg);
  const r = Math.hypot(pos.x, pos.y, pos.z);
  const b = Math.hypot(boresight.x, boresight.y, boresight.z);
  const cosNadir = r > 0 && b > 0 ? -(pos.x * boresight.x + pos.y * boresight.y + pos.z * boresight.z) / (r * b) : NaN;
  return {
    // Unscheduled: the configured mode's label, as before (地上局指向 keeps its
    // name while the station is hidden). Scheduled: the active mode and why.
    modeLabel: activeAttitudeLabel(state),
    sunlit,
    incidenceDeg: cosIncidence > 0 ? satellite.radiansToDegrees(Math.acos(Math.min(1, cosIncidence))) : null,
    cosIncidence: sunlit ? cosIncidence : 0,
    sensorOffNadirDeg: Number.isFinite(cosNadir)
      ? satellite.radiansToDegrees(Math.acos(Math.max(-1, Math.min(1, cosNadir))))
      : null,
  };
}

/** Panel incidence as shown in both the folded line and the 姿勢 section: 「32°」 / 「90°以上（裏面）」 / 「日陰」. */
function incidenceText(a: AttitudeReadout): string {
  if (!a.sunlit) return "日陰";
  return a.incidenceDeg === null ? "90°以上（裏面）" : `${a.incidenceDeg.toFixed(0)}°`;
}

/** 「日照 · パネル入射角 32°」 / 「日陰」. */
function sunSummary(a: AttitudeReadout): string {
  if (!a.sunlit) return "日陰";
  return `日照 · パネル入射角 ${incidenceText(a)}`;
}

const EARTH_RADIUS_KM = 6378.137;

interface Props {
  satellites: SatelliteSpec[];
  /** Large catalog drawn after `satellites`; indexes continue from `satellites.length`. */
  catalog?: SatelliteCatalog | null;
  /** Name of the display layer holding catalog row `row`, for rows without an object name. */
  layerNameAt?: (row: number) => string | undefined;
  selectedIdx: number | null;
  simTime: Date;
  /** Whether the J2/J3 secular-rate section is unfolded (remembered with the view). */
  showPerturbation: boolean;
  onShowPerturbationChange: (v: boolean) => void;
  cameraMode: SatelliteCameraMode;
  onCameraModeChange: (mode: SatelliteCameraMode) => void;
  onClose: () => void;
  /** Attitude law of the editor satellites (通信 › 衛星の姿勢とセンサ). */
  satelliteAttitude: SatelliteAttitudeSettings;
  /** Solar array type (解析 › 日照・電力). */
  solarArrayType: SolarArrayType;
  /** Committed ground stations (地上局指向). */
  groundStations: readonly GroundStation[];
  /** Sensor mounting angles (通信 › センサ), for the sensor direction readout. */
  fovAlongTrackDeg: number;
  fovCrossTrackDeg: number;
  /** Open 通信 › 衛星の姿勢とセンサ. */
  onOpenAttitudeSettings: () => void;
  /** Open 解析 › 日照・電力成立性評価 (where the panel type is set). */
  onOpenPowerAnalysis?: () => void;
}

interface InfoRow {
  label: string;
  value: string;
}

function renderMath(expression: string): string {
  try {
    return katex.renderToString(expression, {
      throwOnError: false,
      displayMode: false,
    });
  } catch {
    return expression;
  }
}

function formatNumber(value: number | null, digits = 1, suffix = ""): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}${suffix}`;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h4 className="mb-1.5 text-[11px] font-semibold tracking-wider text-fg-subtle">{children}</h4>;
}

function Section({ title, rows }: { title: string; rows: InfoRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="border-t border-line pt-2.5">
      <SectionTitle>{title}</SectionTitle>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="whitespace-nowrap text-fg-muted">{row.label}</dt>
            <dd className="m-0 text-right font-mono tabular-nums text-fg whitespace-nowrap">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** One live reading: small label, prominent value. */
function Stat({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-fg-subtle">{label}</div>
      <div className="truncate font-mono text-[15px] font-semibold tabular-nums text-fg">{value}</div>
    </div>
  );
}

export default function SatelliteInfo({
  satellites,
  catalog,
  layerNameAt,
  selectedIdx,
  simTime,
  showPerturbation,
  onShowPerturbationChange,
  cameraMode,
  onCameraModeChange,
  onClose,
  satelliteAttitude,
  solarArrayType,
  groundStations,
  fovAlongTrackDeg,
  fovCrossTrackDeg,
  onOpenAttitudeSettings,
  onOpenPowerAnalysis,
}: Props) {
  // Phones start with the orbit details folded so the card doesn't hide the globe.
  const [expanded, setExpanded] = useState(() => !window.matchMedia("(max-width: 768px)").matches);
  if (selectedIdx === null) return null;

  const catalogIdx = selectedIdx - satellites.length;
  let spec = catalogIdx < 0 ? satellites[selectedIdx]
    : catalog && catalogIdx < catalog.count ? catalogSpecAt(catalog, catalogIdx) : undefined;
  if (!spec) return null;
  const layerName = catalogIdx >= 0 ? layerNameAt?.(catalogIdx) : undefined;
  if (layerName && !spec.meta?.objectName) spec = { ...spec, meta: { ...spec.meta, objectName: layerName } };

  const meta = spec.meta;
  const e = (() => {
    if (spec.type === "elements") {
      return spec.elements;
    }
    const rec = satellite.twoline2satrec(spec.lines[0], spec.lines[1]);
    return {
      satnum: Number(rec.satnum),
      semiMajorAxisKm: rec.a * EARTH_RADIUS_KM,
      eccentricity: rec.ecco,
      inclinationDeg: satellite.radiansToDegrees(rec.inclo),
      raanDeg: satellite.radiansToDegrees(rec.nodeo),
      argPerigeeDeg: satellite.radiansToDegrees(rec.argpo),
      meanAnomalyDeg: satellite.radiansToDegrees(rec.mo),
    };
  })();

  const derived = getSatelliteDerivedInfo(spec, simTime);
  // Attitude applies to editor satellites only (display layers have none).
  const isEditorSatellite = catalogIdx < 0;
  const attitude = isEditorSatellite
    ? attitudeReadout(spec, simTime, satelliteAttitude, solarArrayType, groundStations, fovAlongTrackDeg, fovCrossTrackDeg)
    : null;
  // 「シェル設定」/「衛星設定」 when this satellite overrides the global attitude.
  const attitudeSourceLabel = isEditorSatellite ? attitudeOverrideLabel(spec) : null;

  // Same naming as the analysis pickers (日照・電力 etc.).
  const identifiers = satelliteIdentifiers(spec);
  const title = satelliteDisplayName(spec, selectedIdx);

  // Below ~5 km the perigee/apogee split is noise from near-zero eccentricity.
  const isCircular = derived.apogeeAltitudeKm - derived.perigeeAltitudeKm < 5;
  const orbitRows: InfoRow[] = [
    { label: "周期", value: `${derived.periodMinutes.toFixed(1)} min · ${derived.orbitsPerDay.toFixed(2)} 周/日` },
    isCircular
      ? { label: "軌道高度", value: `${((derived.perigeeAltitudeKm + derived.apogeeAltitudeKm) / 2).toFixed(1)} km` }
      : { label: "近地点 / 遠地点", value: `${derived.perigeeAltitudeKm.toFixed(0)} / ${derived.apogeeAltitudeKm.toFixed(0)} km` },
    { label: "傾斜角 i", value: `${e.inclinationDeg.toFixed(2)}°` },
    { label: "昇交点赤経 Ω", value: `${e.raanDeg.toFixed(2)}°` },
    { label: "離心率 e", value: e.eccentricity.toFixed(6) },
    { label: "近地点引数 ω", value: `${e.argPerigeeDeg.toFixed(2)}°` },
    { label: "平均近点角 M", value: `${e.meanAnomalyDeg.toFixed(2)}°` },
    { label: "半長軸 a", value: `${e.semiMajorAxisKm.toFixed(1)} km` },
  ];
  const eclipseRows: InfoRow[] = [
    {
      label: "1周あたり",
      value: derived.eclipseMinutes === 0
        ? "日陰なし"
        : `${formatDurationMinutes(derived.eclipseMinutes)}${derived.eclipseRatio === null ? "" : ` (${(derived.eclipseRatio * 100).toFixed(0)}%)`}`,
    },
  ];

  return (
    <div className="hud-card glass satellite-info">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-fg">{title}</div>
          {identifiers && <div className="truncate font-mono text-[11px] text-fg-subtle">{identifiers}</div>}
        </div>
        <div className="-mr-1 -mt-0.5 flex shrink-0 items-center">
        <button
          type="button"
          data-slot="icon-button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? "詳細を閉じる" : "詳細を表示"}
          title={expanded ? "詳細を閉じる" : "詳細を表示"}
          className="inline-flex size-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-raised-hover hover:text-fg"
        >
          <ChevronDown className={`size-4 transition-transform ${expanded ? "" : "rotate-180"}`} />
        </button>
        <button
          type="button"
          data-slot="icon-button"
          onClick={onClose}
          aria-label="選択を解除"
          title="選択を解除"
          className="inline-flex size-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-raised-hover hover:text-fg"
        >
          <X className="size-4" />
        </button>
        </div>
      </header>
      {meta?.dataStatus === "filing" && <div className="rounded-lg border border-line bg-sunken p-2 text-xs leading-relaxed">
        <p className="flex items-center gap-1.5 font-medium text-fg"><span className="size-2.5 shrink-0 rounded-full border-2 border-fg-muted" aria-hidden="true" />申請上の仮配置 · {meta.filingConfiguration === "default" ? "単一構成" : `構成 ${meta.filingConfiguration}`}</p>
        <p className="text-fg-muted">基準日時・位相の解釈に仮定を含みます。実際の位置や運用を示しません。</p>
        {meta.filingSource?.startsWith("https://www.itu.int/") && <a href={meta.filingSource} target="_blank" rel="noopener noreferrer" className="text-brand-text underline">公式申請を確認</a>}
      </div>}
      <div className="grid grid-cols-2 gap-x-4">
        <Stat label="高度 (地表から)" value={formatNumber(derived.geodeticAltitudeKm, 1, " km")} />
        <Stat label="速度" value={formatNumber(derived.eciSpeedKmPerSec, 2, " km/s")} />
      </div>
      <div role="radiogroup" aria-label="カメラ" className="grid grid-cols-4 gap-1 rounded-lg border border-line bg-sunken p-[3px]">
        {CAMERA_VIEW_OPTIONS.map((option) => {
          const selected = cameraMode === option.mode;
          // 近接 draws the attitude model, which display layers do not have.
          const disabled = option.mode === "closeUp" && !isEditorSatellite;
          return (
            <button
              key={option.mode}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              title={disabled ? "表示レイヤーの衛星には使えません" : undefined}
              data-slot="icon-button"
              onClick={() => onCameraModeChange(option.mode)}
              className={`h-7 min-w-0 whitespace-nowrap rounded-md px-0.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                selected ? "bg-seg-active text-fg shadow-sm" : "text-fg-muted hover:text-fg"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {!expanded && attitude && (
        <button
          type="button"
          data-slot="button"
          onClick={onOpenAttitudeSettings}
          title="通信タブの「衛星の姿勢とセンサ」を開く"
          className="-my-1 flex min-h-8 w-full min-w-0 items-center gap-1.5 rounded-md bg-transparent px-0 text-left text-xs text-fg-muted hover:text-fg"
        >
          <span className="shrink-0 text-fg-subtle">姿勢</span>
          <span className="min-w-0 flex-1 truncate">
            <span className="text-fg">{attitude.modeLabel}</span> · {sunSummary(attitude)}
          </span>
          <span className="shrink-0 text-sm leading-none text-fg-subtle" aria-hidden="true">›</span>
        </button>
      )}
      {expanded && (
      <div className="satellite-info-body">
        {attitude && (
          <section className="border-t border-line pt-2.5">
            <SectionTitle>姿勢</SectionTitle>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
              <dt className="whitespace-nowrap text-fg-muted">モード</dt>
              <dd className="m-0 text-right whitespace-nowrap">
                <button
                  type="button"
                  data-slot="button"
                  onClick={onOpenAttitudeSettings}
                  title="通信タブの「衛星の姿勢とセンサ」を開く"
                  className="bg-transparent p-0 text-fg underline decoration-line-strong underline-offset-2 hover:decoration-fg"
                >
                  {attitude.modeLabel}
                </button>
              </dd>
              {attitudeSourceLabel && (
                <>
                  <dt className="whitespace-nowrap text-fg-muted">設定元</dt>
                  <dd className="m-0 text-right whitespace-nowrap text-fg" title="シナリオタブの編集画面で変更できます">
                    {attitudeSourceLabel}
                  </dd>
                </>
              )}
              <dt className="whitespace-nowrap text-fg-muted">パネル入射角</dt>
              <dd className="m-0 text-right font-mono tabular-nums text-fg whitespace-nowrap">{incidenceText(attitude)}</dd>
              <dt className="whitespace-nowrap text-fg-muted">発電効率（cos）</dt>
              <dd className="m-0 text-right font-mono tabular-nums text-fg whitespace-nowrap">{attitude.cosIncidence.toFixed(2)}</dd>
              <dt className="whitespace-nowrap text-fg-muted">センサの向き（直下点からの離角）</dt>
              <dd className="m-0 text-right font-mono tabular-nums text-fg whitespace-nowrap">
                {attitude.sensorOffNadirDeg === null ? "—" : `${attitude.sensorOffNadirDeg.toFixed(1)}°`}
              </dd>
            </dl>
            {onOpenPowerAnalysis ? (
              <button
                type="button"
                data-slot="button"
                onClick={onOpenPowerAnalysis}
                className="mt-1 bg-transparent p-0 text-left text-[11px] text-fg-muted underline decoration-line-strong underline-offset-2 hover:text-fg"
              >
                パネル: {SOLAR_ARRAY_SHORT_LABELS[solarArrayType]}（電力解析で設定）
              </button>
            ) : (
              <p className="mt-1 text-[11px] text-fg-muted">パネル: {SOLAR_ARRAY_SHORT_LABELS[solarArrayType]}（電力解析で設定）</p>
            )}
          </section>
        )}
        <Section title="軌道 (元期)" rows={orbitRows} />
        <Section title="日陰" rows={eclipseRows} />
        <section className="border-t border-line pt-2.5">
          <button
            type="button"
            data-slot="button"
            onClick={() => onShowPerturbationChange(!showPerturbation)}
            aria-expanded={showPerturbation}
            className="flex w-full items-center justify-between bg-transparent p-0 text-left"
          >
            <SectionTitle>摂動 J₂/J₃ (永年変化)</SectionTitle>
            <ChevronDown className={`size-3.5 text-fg-muted transition-transform ${showPerturbation ? "rotate-180" : ""}`} />
          </button>
          {showPerturbation && (() => {
              const detailedRates = calculateDetailedPerturbationRates({
                semiMajorAxisKm: e.semiMajorAxisKm,
                eccentricity: e.eccentricity,
                inclinationDeg: e.inclinationDeg,
                raanDeg: e.raanDeg,
                argPerigeeDeg: e.argPerigeeDeg,
                meanAnomalyDeg: e.meanAnomalyDeg,
              });

              const j2Rates = formatJ2PerturbationRates(detailedRates.j2);
              const j3Rates = formatJ3PerturbationRates(detailedRates.j3);

              return (
                <>
                  {[{ label: "J₂項", rates: j2Rates }, { label: "J₃項", rates: j3Rates }].map(
                    ({ label, rates }) =>
                      rates.length > 0 && (
                        <div key={label} className="mt-1.5">
                          <div className="mb-0.5 text-[11px] text-fg-subtle">{label}</div>
                          {rates.map((rate, index) => (
                            <div key={index} className="flex items-center gap-1 pl-2.5 text-[0.85em]">
                              <span dangerouslySetInnerHTML={{ __html: renderMath(rate.latex) }} />
                              <span className="font-mono tabular-nums">: {rate.value}</span>
                            </div>
                          ))}
                        </div>
                      ),
                  )}
                </>
              );
            })()}
        </section>
      </div>
      )}
    </div>
  );
}
