import React from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { SatelliteSpec } from "../../lib/satellites";
import * as satellite from "satellite.js";
import { 
  calculateDetailedPerturbationRates, 
  formatJ2PerturbationRates,
  formatJ3PerturbationRates
} from "../../lib/perturbation";

interface Props {
  satellites: SatelliteSpec[];
  selectedIdx: number | null;
  showPerturbation: boolean;
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

export default function SatelliteInfo({ satellites, selectedIdx, showPerturbation }: Props) {
  if (selectedIdx === null) return null;
  
  const spec = satellites[selectedIdx];
  if (!spec) return null;

  const meta = spec.meta;
  let metaElements: React.ReactNode[] = [];
  if (meta) {
    if (meta.objectName) metaElements.push(<div key="objectName">OBJECT_NAME: {meta.objectName}</div>);
    if (meta.objectId) metaElements.push(<div key="objectId">OBJECT_ID: {meta.objectId}</div>);
    if (meta.noradCatId !== undefined) metaElements.push(<div key="noradCatId">NORAD_CAT_ID: {meta.noradCatId}</div>);
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

  return (
    <div
      style={{
        position: "fixed",
        left: 8,
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 6px)",
        color: "#fff",
        fontFamily: "'Noto Sans Mono', monospace",
        fontSize: "0.9rem",
        pointerEvents: "none",
        zIndex: 10,
        lineHeight: "1.4",
      }}
    >
      {metaElements}
      <div>satnum: {e.satnum}</div>
      <div>
        <span dangerouslySetInnerHTML={{ __html: renderMath("a") }} /> (半長軸)        : {e.semiMajorAxisKm.toFixed(1)} km
      </div>
      <div>
        <span dangerouslySetInnerHTML={{ __html: renderMath("e") }} /> (離心率)        : {e.eccentricity.toFixed(6)}
      </div>
      <div>
        <span dangerouslySetInnerHTML={{ __html: renderMath("i") }} /> (軌道傾斜角)    : {e.inclinationDeg.toFixed(1)} deg
      </div>
      <div>
        <span dangerouslySetInnerHTML={{ __html: renderMath("\\Omega") }} /> (昇交点赤経) : {e.raanDeg.toFixed(1)} deg
      </div>
      <div>
        <span dangerouslySetInnerHTML={{ __html: renderMath("\\omega") }} /> (近地点引数) : {e.argPerigeeDeg.toFixed(1)} deg
      </div>
      <div>
        <span dangerouslySetInnerHTML={{ __html: renderMath("M") }} /> (平均近点角)    : {e.meanAnomalyDeg.toFixed(1)} deg
      </div>
      {showPerturbation && (
        <>
          <hr style={{ margin: "8px 0", borderColor: "rgba(255, 255, 255, 0.3)" }} />
          <div style={{ fontSize: "0.85em", color: "#ccc" }}>摂動</div>
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
                  <div style={{ marginTop: "6px" }}>
                    <div style={{ fontSize: "0.8em", color: "#999", marginBottom: "2px" }}>J₂項</div>
                    {j2Rates.map((rate, index) => (
                      <div key={index} style={{ fontSize: "0.85em", paddingLeft: "10px", display: "flex", alignItems: "center", gap: "4px" }}>
                        <span dangerouslySetInnerHTML={{ __html: renderMath(rate.latex) }} />
                        <span>: {rate.value}</span>
                      </div>
                    ))}
                  </div>
                )}
                {j3Rates.length > 0 && (
                  <div style={{ marginTop: "6px" }}>
                    <div style={{ fontSize: "0.8em", color: "#999", marginBottom: "2px" }}>J₃項</div>
                    {j3Rates.map((rate, index) => (
                      <div key={index} style={{ fontSize: "0.85em", paddingLeft: "10px", display: "flex", alignItems: "center", gap: "4px" }}>
                        <span dangerouslySetInnerHTML={{ __html: renderMath(rate.latex) }} />
                        <span>: {rate.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            );
          })()}
        </>
      )}
    </div>
  );
}