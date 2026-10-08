import katex from "katex";
import "katex/dist/katex.min.css";
import type { SatelliteSpec } from "../../lib/satellites";
import * as satellite from "satellite.js";
import {
  calculateDetailedPerturbationRates,
  formatJ2PerturbationRates,
  formatJ3PerturbationRates,
} from "../../lib/perturbation";
import {
  formatDurationMinutes,
  formatLatitude,
  formatLongitude,
  getSatelliteDerivedInfo,
} from "../../lib/satelliteDerivedInfo";
import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import type { SatelliteCameraMode } from "../../lib/visualization";

const CAMERA_VIEW_OPTIONS: { mode: SatelliteCameraMode; label: string }[] = [
  { mode: "free", label: "全体" },
  { mode: "earthCenter", label: "地球中心" },
  { mode: "thirdPerson", label: "後方追跡" },
];

interface Props {
  satellites: SatelliteSpec[];
  selectedIdx: number | null;
  simTime: Date;
  showDerivedInfo: boolean;
  showPerturbation: boolean;
  cameraMode: SatelliteCameraMode;
  onCameraModeChange: (mode: SatelliteCameraMode) => void;
  onClose: () => void;
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
  if (value === null || !Number.isFinite(value)) return "N/A";
  return `${value.toFixed(digits)}${suffix}`;
}

function Section({
  title,
  rows,
}: {
  title: string;
  rows: InfoRow[];
}) {
  if (rows.length === 0) return null;

  return (
    <section className="border-t border-line pt-2.5">
      <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{title}</h4>
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

export default function SatelliteInfo({
  satellites,
  selectedIdx,
  simTime,
  showDerivedInfo,
  showPerturbation,
  cameraMode,
  onCameraModeChange,
  onClose,
}: Props) {
  // Phones start with the details folded so the card doesn't hide the globe.
  const [expanded, setExpanded] = useState(() => !window.matchMedia("(max-width: 768px)").matches);
  if (selectedIdx === null) return null;

  const spec = satellites[selectedIdx];
  if (!spec) return null;

  const meta = spec.meta;
  const metaRows: InfoRow[] = [];
  if (meta) {
    if (meta.objectName) metaRows.push({ label: "OBJECT_NAME", value: meta.objectName });
    if (meta.objectId) metaRows.push({ label: "OBJECT_ID", value: meta.objectId });
    if (meta.noradCatId !== undefined) metaRows.push({ label: "NORAD_CAT_ID", value: String(meta.noradCatId) });
  }

  const EARTH_RADIUS_KM = 6378.137;

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

  const derived = showDerivedInfo ? getSatelliteDerivedInfo(spec, simTime) : null;

  const orbitalRows: InfoRow[] = [
    { label: "satnum", value: String(e.satnum) },
    { label: "a (半長軸)", value: `${e.semiMajorAxisKm.toFixed(1)} km` },
    { label: "e (離心率)", value: e.eccentricity.toFixed(6) },
    { label: "i (傾斜角)", value: `${e.inclinationDeg.toFixed(1)} deg` },
    { label: "Ω (昇交点赤経)", value: `${e.raanDeg.toFixed(1)} deg` },
    { label: "ω (近地点引数)", value: `${e.argPerigeeDeg.toFixed(1)} deg` },
    { label: "M (平均近点角)", value: `${e.meanAnomalyDeg.toFixed(1)} deg` },
  ];

  const derivedRows: InfoRow[] = derived ? [
    { label: "軌道周期", value: formatDurationMinutes(derived.periodMinutes) },
    { label: "1日あたり周回数", value: `${derived.orbitsPerDay.toFixed(2)} rev/day` },
    { label: "近地点高度", value: formatNumber(derived.perigeeAltitudeKm, 1, " km") },
    { label: "遠地点高度", value: formatNumber(derived.apogeeAltitudeKm, 1, " km") },
    { label: "現在高度", value: formatNumber(derived.currentAltitudeKm, 1, " km") },
    { label: "ECI速度", value: formatNumber(derived.eciSpeedKmPerSec, 3, " km/s") },
    { label: "緯度", value: formatLatitude(derived.latitudeDeg) },
    { label: "経度", value: formatLongitude(derived.longitudeDeg) },
    { label: "日陰時間", value: formatDurationMinutes(derived.eclipseMinutes) },
    { label: "日陰率", value: derived.eclipseRatio === null ? "N/A" : `${(derived.eclipseRatio * 100).toFixed(1)} %` },
    { label: "次の日陰開始まで", value: formatDurationMinutes(derived.timeToNextEclipseStartMinutes) },
    { label: "次の日照復帰まで", value: formatDurationMinutes(derived.timeToNextSunlightReturnMinutes) },
  ] : [];

  const title = meta?.objectName ?? `衛星 #${selectedIdx + 1}`;

  return (
    <div className="hud-card glass satellite-info">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-fg-subtle">選択中の衛星</div>
          <div className="truncate text-[15px] font-semibold text-fg">{title}</div>
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
      <div role="radiogroup" aria-label="カメラ" className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-sunken p-[3px]">
        {CAMERA_VIEW_OPTIONS.map((option) => {
          const selected = cameraMode === option.mode;
          return (
            <button
              key={option.mode}
              type="button"
              role="radio"
              aria-checked={selected}
              data-slot="icon-button"
              onClick={() => onCameraModeChange(option.mode)}
              className={`h-7 rounded-md text-xs font-medium transition-colors ${
                selected ? "bg-seg-active text-fg shadow-sm" : "text-fg-muted hover:text-fg"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {expanded && (<>
      <div className="satellite-info-body">
        <Section title="基本情報" rows={metaRows} />
        <Section title="軌道要素" rows={orbitalRows} />
        {showDerivedInfo && <Section title="運用指標" rows={derivedRows} />}
        {showPerturbation && (
          <section className="border-t border-line pt-2.5">
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">摂動</h4>
            {(() => {
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
        )}
      </div>
      </>)}
      <p className="text-[11px] text-fg-subtle max-md:hidden">
        {cameraMode === "thirdPerson" ? "ホイールで拡大、上下ドラッグで角度調整" : "ホイールで拡大・縮小"}
      </p>
    </div>
  );
}
