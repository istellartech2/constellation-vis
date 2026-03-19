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
import { Button } from "./button";
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
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          fontSize: "0.76rem",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "#9ca3af",
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {rows.map((row) => (
          <div
            key={row.label}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              whiteSpace: "nowrap",
            }}
          >
            <div
              style={{
                minWidth: 132,
                color: "#d1d5db",
                flexShrink: 0,
              }}
            >
              {row.label}
            </div>
            <div style={{ color: "#fff" }}>{row.value}</div>
          </div>
        ))}
      </div>
    </div>
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
}: Props) {
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

  return (
    <div
      style={{
        position: "fixed",
        left: 8,
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 6px)",
        color: "#fff",
        fontFamily: "'Noto Sans Mono', monospace",
        fontSize: "0.88rem",
        zIndex: 10,
        lineHeight: "1.45",
        background: "rgba(17, 24, 39, 0.84)",
        border: "1px solid rgba(255, 255, 255, 0.14)",
        borderRadius: 10,
        padding: "10px 12px",
        backdropFilter: "blur(8px)",
        maxWidth: "min(420px, calc(100vw - 16px))",
        boxShadow: "0 10px 24px rgba(0, 0, 0, 0.28)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        pointerEvents: "none",
      }}
    >
      <Section title="基本情報" rows={metaRows} />
      <Section title="軌道要素" rows={orbitalRows} />
      {showDerivedInfo && <Section title="運用指標" rows={derivedRows} />}
      {showPerturbation && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(255, 255, 255, 0.15)" }}>
          <div
            style={{
              fontSize: "0.76rem",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "#9ca3af",
              marginBottom: 4,
            }}
          >
            摂動
          </div>
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
                {j2Rates.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: "0.8em", color: "#999", marginBottom: 2 }}>J₂項</div>
                    {j2Rates.map((rate, index) => (
                      <div key={index} style={{ fontSize: "0.85em", paddingLeft: 10, display: "flex", alignItems: "center", gap: 4 }}>
                        <span dangerouslySetInnerHTML={{ __html: renderMath(rate.latex) }} />
                        <span>: {rate.value}</span>
                      </div>
                    ))}
                  </div>
                )}
                {j3Rates.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: "0.8em", color: "#999", marginBottom: 2 }}>J₃項</div>
                    {j3Rates.map((rate, index) => (
                      <div key={index} style={{ fontSize: "0.85em", paddingLeft: 10, display: "flex", alignItems: "center", gap: 4 }}>
                        <span dangerouslySetInnerHTML={{ __html: renderMath(rate.latex) }} />
                        <span>: {rate.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}
      <div
        style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: "1px solid rgba(255, 255, 255, 0.08)",
          fontSize: "0.76rem",
          color: "#9ca3af",
        }}
      >
        現在時刻: {simTime.toISOString().slice(0, 16).replace("T", " ")} UTC
      </div>
      <div
        style={{
          pointerEvents: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          paddingTop: 2,
        }}
      >
        <div
          style={{
            fontSize: "0.74rem",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "#9ca3af",
          }}
        >
          ビュー
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 6,
            padding: 4,
            borderRadius: 10,
            background: "rgba(255, 255, 255, 0.06)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
          }}
        >
          {CAMERA_VIEW_OPTIONS.map((option) => {
            const selected = cameraMode === option.mode;
            return (
              <Button
                key={option.mode}
                type="button"
                variant={selected ? "default" : "ghost"}
                size="sm"
                disabled={selected}
                className={
                  selected
                    ? "bg-cyan-400/90 text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_0_0_1px_rgba(34,211,238,0.4)] hover:bg-cyan-400/90"
                    : "bg-transparent text-slate-100 hover:bg-white/14 hover:text-white"
                }
                onClick={() => onCameraModeChange(option.mode)}
              >
                {option.label}
              </Button>
            );
          })}
        </div>
        <div
          style={{
            fontSize: "0.74rem",
            color: "#9ca3af",
            lineHeight: 1.4,
          }}
        >
          ホイールで拡大、後方追跡では上下ドラッグ可
        </div>
      </div>
    </div>
  );
}
