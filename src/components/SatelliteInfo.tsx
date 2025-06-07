import React from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { SatelliteSpec } from "../lib/satellites";
import * as satellite from "satellite.js";

interface Props {
  satellites: SatelliteSpec[];
  selectedIdx: number | null;
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

export default function SatelliteInfo({ satellites, selectedIdx }: Props) {
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
    </div>
  );
}