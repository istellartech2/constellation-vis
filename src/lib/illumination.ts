import { constants, jday, shadowFraction, sunPos, type EciVec3 } from "satellite.js";

/** Obscured solar disc fraction: 0 = sunlight, 1 = umbra, intermediate = penumbra. */
export function earthShadowFraction(position: EciVec3<number>, date: Date): number {
  const sun = sunPos(jday(date)).rsun; // AU; satellite position is in km.
  const fraction = shadowFraction(sun, position);
  if (Number.isFinite(fraction)) return Math.max(0, Math.min(1, fraction));

  // satellite.js 7.1.0 can round acos's argument outside [-1, 1] on the
  // anti-solar axis, or round the disc-overlap formula to NaN at tangency.
  // Those limiting cases are full umbra or full sunlight. atan2 avoids acos's
  // domain issue; compare the disc centres to Earth's apparent limb.
  const dot = -(position.x * sun.x + position.y * sun.y + position.z * sun.z);
  const cross = Math.hypot(
    position.y * sun.z - position.z * sun.y,
    position.z * sun.x - position.x * sun.z,
    position.x * sun.y - position.y * sun.x,
  );
  const separation = Math.atan2(cross, dot);
  const earthRadius = Math.asin(constants.earthRadius / Math.hypot(position.x, position.y, position.z));
  return separation <= earthRadius ? 1 : 0;
}
