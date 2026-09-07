/**
 * 2D Lattice Flower Constellation (2D-LFC).
 *
 * Reference: M. E. Avendaño, J. J. Davis, D. Mortari,
 * "The 2-D lattice theory of Flower Constellations", Celestial Mechanics and
 * Dynamical Astronomy 116, 2013, eq. (2):
 *
 *   Ω_ij = 2π·i/No
 *   M_ij = (2π/Nso)·(j − Nc·i/No)   (mod 2π),   i = 0..No−1, j = 0..Nso−1
 *
 * with the lattice condition 0 ≤ Nc ≤ No − 1.
 *
 * ## Sign convention (why F = (No − Nc) mod No)
 *
 * The lattice's `−Nc·i/No` term *decreases* the mean anomaly as the plane index
 * grows, while Walker's F term *increases* it: M = (360/T)·(i·F + j·P). Setting
 * F = No − Nc makes the two differ by exactly `360·i/Nso`, i.e. `i` whole
 * in-plane slots — the same satellite *set* per plane, relabelled by a slot
 * shift (Walker slot j == lattice slot j+i). That is why this module can
 * delegate to `planWalkerDelta` verbatim instead of carrying its own loop:
 * one generation path, one set of floating-point results.
 */

import { fieldKeysForPattern, numberField } from "./fields";
import { greedyPlaneSizes } from "./emit";
import { orbitFromShell } from "./orbit";
import { buildCommonDerived } from "./derivedCommon";
import { planWalkerDelta, walkerNotation } from "./walkerDelta";
import type {
  PatternGenerator,
  PatternShellInput,
  ShellDerived,
  ShellPlan,
  ShellWarning,
  ValidationError,
} from "./types";

export interface LatticeParams {
  /** No — number of orbital planes. */
  no: number;
  /** Nso — satellites per plane. */
  nso: number;
  /** Nc — lattice configuration number, 0..No−1. */
  nc: number;
  /** T = No·Nso. */
  count: number;
}

export function latticeParams(shell: PatternShellInput): LatticeParams {
  const no = numberField("planes", shell);
  // `count` is stored as T = No·Nso (the editor derives it from No and Nso), so
  // Nso is read back from it rather than kept as a separate key.
  const count = numberField("count", shell);
  return { no, nso: no > 0 ? count / no : 0, nc: numberField("lfc_nc", shell), count };
}

/** F of the equivalent Walker Delta. */
export function latticeWalkerF(no: number, nc: number): number {
  if (!(no > 0)) return 0;
  return (((no - nc) % no) + no) % no;
}

/** Mean anomaly from lattice eq. (2), in degrees. Used by the equivalence tests. */
export function latticeMeanAnomalyDeg(
  params: LatticeParams,
  planeIndex: number,
  slotIndex: number,
): number {
  return (360 / params.nso) * (slotIndex - (params.nc * planeIndex) / params.no);
}

export function ncOutOfRangeWarnings(no: number, nc: number): ShellWarning[] {
  if (Number.isInteger(nc) && nc >= 0 && nc <= no - 1) return [];
  return [
    {
      code: "nc_out_of_range",
      message: `Nc = ${nc} は 0..${Math.max(0, no - 1)} の範囲外です(格子条件 0 ≤ Nc ≤ No−1)。`,
    },
  ];
}

export function planLatticeFlower(shell: PatternShellInput): ShellPlan {
  const params = latticeParams(shell);
  const plan = planWalkerDelta({
    ...shell,
    pattern: "walker_delta",
    count: params.count,
    planes: params.no,
    phasing: latticeWalkerF(params.no, params.nc),
    raan_range: 360,
  });
  return { ...plan, warnings: ncOutOfRangeWarnings(params.no, params.nc) };
}

export function deriveLatticeFlower(shell: PatternShellInput): ShellDerived {
  const params = latticeParams(shell);
  const orbit = orbitFromShell(shell);
  const walkerF = latticeWalkerF(params.no, params.nc);

  return {
    ...buildCommonDerived({
      totalSats: params.count,
      planes: params.no,
      planeSizes: greedyPlaneSizes(params.count, params.no),
      orbit,
      raanSpacingDeg: params.no > 0 ? 360 / params.no : 0,
      inPlaneSpacingDeg: params.nso > 0 ? 360 / params.nso : 0,
      interPlaneOffsetDeg:
        params.count > 0 ? -(360 * params.nc) / (params.no * params.nso) : 0,
      warnings: ncOutOfRangeWarnings(params.no, params.nc),
    }),
    pattern: "lattice_flower",
    no: params.no,
    nso: params.nso,
    nc: params.nc,
    ncAdmissible: Number.isInteger(params.nc) && params.nc >= 0 && params.nc <= params.no - 1,
    deltaMDeg: params.count > 0 ? -(360 * params.nc) / (params.no * params.nso) : 0,
    walkerNotation: walkerNotation(params.count, params.no, walkerF, orbit.inclinationDeg),
    walkerF,
  };
}

export function validateLatticeFlower(
  shell: PatternShellInput,
  index: number,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const params = latticeParams(shell);

  if (!Number.isInteger(params.nc) || params.nc < 0 || params.nc > params.no - 1) {
    errors.push({
      field: `shell.${index}.lfc_nc`,
      message: `Nc は 0..${Math.max(0, params.no - 1)}(0 ≤ Nc ≤ No−1)の整数である必要があります`,
    });
  }
  if (params.no > 0 && params.count % params.no !== 0) {
    errors.push({
      field: `shell.${index}.count`,
      message: `衛星数 ${params.count} は軌道面数 ${params.no} の倍数(T = No·Nso)である必要があります`,
    });
  }

  return errors;
}

export const latticeFlowerGenerator: PatternGenerator = {
  id: "lattice_flower",
  fields: fieldKeysForPattern("lattice_flower"),
  plan: planLatticeFlower,
  derive: deriveLatticeFlower,
  validate: validateLatticeFlower,
};
