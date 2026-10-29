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
  getSatelliteDerivedInfo,
} from "../../lib/satelliteDerivedInfo";
import { useState, type ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";
import type { SatelliteCameraMode } from "../../lib/visualization";

const CAMERA_VIEW_OPTIONS: { mode: SatelliteCameraMode; label: string }[] = [
  { mode: "free", label: "全体" },
  { mode: "earthCenter", label: "地球中心" },
  { mode: "thirdPerson", label: "後方追跡" },
];

const EARTH_RADIUS_KM = 6378.137;

interface Props {
  satellites: SatelliteSpec[];
  selectedIdx: number | null;
  simTime: Date;
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
  selectedIdx,
  simTime,
  showPerturbation,
  cameraMode,
  onCameraModeChange,
  onClose,
}: Props) {
  // Phones start with the orbit details folded so the card doesn't hide the globe.
  const [expanded, setExpanded] = useState(() => !window.matchMedia("(max-width: 768px)").matches);
  if (selectedIdx === null) return null;

  const spec = satellites[selectedIdx];
  if (!spec) return null;

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

  const identifiers = [
    meta?.noradCatId !== undefined ? `NORAD ${meta.noradCatId}` : null,
    meta?.objectId ?? null,
    meta?.noradCatId === undefined ? `satnum ${e.satnum}` : null,
  ].filter(Boolean).join(" · ");
  const title = meta?.objectName ?? `衛星 #${selectedIdx + 1}`;

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
          aria-label={expanded ? "軌道の詳細を閉じる" : "軌道の詳細を表示"}
          title={expanded ? "軌道の詳細を閉じる" : "軌道の詳細を表示"}
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
      {expanded && (
      <div className="satellite-info-body">
        <Section title="軌道 (元期)" rows={orbitRows} />
        <Section title="日陰" rows={eclipseRows} />
        {showPerturbation && (
          <section className="border-t border-line pt-2.5">
            <SectionTitle>摂動 (永年変化)</SectionTitle>
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
      )}
    </div>
  );
}
