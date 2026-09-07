/**
 * Necklace Flower Constellation (2D-NFC).
 *
 * Reference: M. E. Avendaño, J. J. Davis, D. Mortari,
 * "The Lattice Theory of Flower Constellations" / "Necklace theory on flower
 * constellations", Celestial Mechanics and Dynamical Astronomy, 2011-2013.
 *
 * A necklace flower is a 2D-LFC (No planes × Nso in-plane slots, lattice
 * number Nc) with only a *subset* of the slots populated. The subset G — the
 * "necklace" — is given in plane 0 as 1-based pearl indices, and every
 * subsequent plane carries the same necklace rotated by a shift k:
 *
 *   Ω_i     = raan_start + 360°·i/No
 *   ΔM      = −360°·Nc/(No·Nso) + 360°·k/Nso
 *   M_{i,g} = m0 + 360°·(g−1)/Nso + i·ΔM      (mod 360°),  g ∈ G
 *
 * The design is admissible only when the shift maps the necklace onto itself
 * consistently across the wrap-around, i.e. `Sym(G) | (k·No − Nc)`, where
 * Sym(G) is the smallest positive rotation fixing G.
 *
 * With G = {1..Nso} (a full necklace) this reduces exactly to the plain 2D-LFC.
 */

import { fieldKeysForPattern, numberField } from "./fields";
import { normalizeAngleDeg } from "./emit";
import { orbitFromShell } from "./orbit";
import { buildCommonDerived } from "./derivedCommon";
import { latticeWalkerF } from "./latticeFlower";
import { walkerNotation } from "./walkerDelta";
import type {
  PatternGenerator,
  PatternShellInput,
  PlanePlan,
  ShellDerived,
  ShellPlan,
  ShellWarning,
  ValidationError,
} from "./types";

export interface NecklaceParams {
  /** No — number of orbital planes. */
  no: number;
  /** Nso — in-plane slots per plane (occupied or not). */
  nso: number;
  /** Nc — underlying lattice number. */
  nc: number;
  /** Occupied pearls, 1-based, deduped, ascending. */
  necklace: number[];
  /** Shift k applied to the necklace when moving to the next plane. */
  shift: number;
}

/** Normalizes the raw `nec_necklace` array: 1-based, in 1..Nso, deduped, sorted. */
export function normalizeNecklace(raw: unknown, nso: number): number[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  for (const value of raw) {
    const g = Math.trunc(Number(value));
    if (!Number.isFinite(g) || g < 1 || g > nso) continue;
    seen.add(g);
  }
  return [...seen].sort((a, b) => a - b);
}

export function necklaceParams(shell: PatternShellInput): NecklaceParams {
  const no = numberField("planes", shell);
  const nso = numberField("nec_pearls", shell);
  return {
    no,
    nso,
    nc: numberField("lfc_nc", shell),
    necklace: normalizeNecklace(shell.nec_necklace, nso),
    shift: numberField("nec_shift", shell),
  };
}

/**
 * Sym(G) = min{ 1 ≤ r ≤ Nso : G + r ≡ G (mod Nso) }.
 * Nso itself always qualifies, so the result is well defined.
 */
export function necklaceSymmetry(necklace: readonly number[], nso: number): number {
  if (!(nso > 0) || necklace.length === 0) return nso > 0 ? nso : 1;
  const residues = new Set(necklace.map((g) => ((g - 1) % nso + nso) % nso));
  for (let r = 1; r <= nso; r++) {
    let fixed = true;
    for (const res of residues) {
      if (!residues.has((res + r) % nso)) {
        fixed = false;
        break;
      }
    }
    if (fixed) return r;
  }
  return nso;
}

/** Admissibility: Sym(G) divides (k·No − Nc). */
export function isNecklaceAdmissible(params: NecklaceParams): boolean {
  const sym = necklaceSymmetry(params.necklace, params.nso);
  if (!(sym > 0)) return false;
  if (!Number.isInteger(params.shift) || !Number.isInteger(params.nc)) return false;
  const value = params.shift * params.no - params.nc;
  return ((value % sym) + sym) % sym === 0;
}

/** Every shift k in 1..Nso that satisfies the admissibility condition. */
export function admissibleShifts(params: NecklaceParams): number[] {
  const sym = necklaceSymmetry(params.necklace, params.nso);
  if (!(sym > 0) || !Number.isInteger(params.nc)) return [];
  const out: number[] = [];
  for (let k = 1; k <= Math.max(1, params.nso); k++) {
    const value = k * params.no - params.nc;
    if (((value % sym) + sym) % sym === 0) out.push(k);
  }
  return out;
}

/** ΔM = −360·Nc/(No·Nso) + 360·k/Nso, in degrees. */
export function necklaceDeltaMDeg(params: NecklaceParams): number {
  if (!(params.no > 0) || !(params.nso > 0)) return 0;
  return -(360 * params.nc) / (params.no * params.nso) + (360 * params.shift) / params.nso;
}

export function necklaceWarnings(params: NecklaceParams): ShellWarning[] {
  const warnings: ShellWarning[] = [];
  if (params.necklace.length === 0) return warnings;
  if (!isNecklaceAdmissible(params)) {
    const sym = necklaceSymmetry(params.necklace, params.nso);
    warnings.push({
      code: "necklace_not_admissible",
      message: `シフト k = ${params.shift} は許容されません: Sym(G) = ${sym} が k·No − Nc = ${params.shift * params.no - params.nc} を割り切りません。許容される k: ${admissibleShifts(params).join(", ") || "なし"}`,
    });
  }
  return warnings;
}

export function planNecklaceFlower(shell: PatternShellInput): ShellPlan {
  const params = necklaceParams(shell);
  const raanStartDeg = numberField("raan_start", shell);
  const meanAnomaly0Deg = numberField("mean_anomaly_0", shell);
  const deltaM = necklaceDeltaMDeg(params);

  const plans: PlanePlan[] = [];
  for (let i = 0; i < params.no; i++) {
    // Pearls are emitted in ascending g order, which is the cyclic ring order
    // within the plane. Do NOT re-sort by mean anomaly: the +Grid ISL topology
    // links index-adjacent satellites, and the ring order is what makes those
    // links the physical along-track neighbours even when the shift rotates the
    // necklace past the 0/360° wrap.
    const meanAnomaliesDeg = params.necklace.map((g) =>
      normalizeAngleDeg(meanAnomaly0Deg + (360 * (g - 1)) / params.nso + i * deltaM),
    );
    plans.push({
      raanDeg: raanStartDeg + (360 * i) / params.no,
      meanAnomaliesDeg,
    });
  }

  return {
    plans,
    orbit: orbitFromShell(shell),
    wrapPlanes: true,
    warnings: necklaceWarnings(params),
  };
}

export function deriveNecklaceFlower(shell: PatternShellInput): ShellDerived {
  const params = necklaceParams(shell);
  const orbit = orbitFromShell(shell);
  const occupied = params.necklace.length;
  const totalSats = params.no * occupied;
  const walkerF = latticeWalkerF(params.no, params.nc);

  return {
    ...buildCommonDerived({
      totalSats,
      planes: params.no,
      planeSizes: Number.isFinite(params.no) && params.no > 0
        ? new Array<number>(Math.floor(params.no)).fill(occupied)
        : [],
      orbit,
      raanSpacingDeg: params.no > 0 ? 360 / params.no : 0,
      inPlaneSpacingDeg: params.nso > 0 ? 360 / params.nso : 0,
      interPlaneOffsetDeg: necklaceDeltaMDeg(params),
      warnings: necklaceWarnings(params),
    }),
    pattern: "necklace_flower",
    no: params.no,
    nso: params.nso,
    nc: params.nc,
    necklace: params.necklace,
    occupied,
    shift: params.shift,
    symmetry: necklaceSymmetry(params.necklace, params.nso),
    admissible: isNecklaceAdmissible(params),
    admissibleShifts: admissibleShifts(params),
    deltaMDeg: necklaceDeltaMDeg(params),
    // Notation of the *fully populated* underlying lattice, for reference.
    walkerNotation: walkerNotation(
      params.no * params.nso,
      params.no,
      walkerF,
      orbit.inclinationDeg,
    ),
  };
}

export function validateNecklaceFlower(
  shell: PatternShellInput,
  index: number,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const params = necklaceParams(shell);

  if (!Number.isInteger(params.nso) || params.nso < 1) {
    errors.push({
      field: `shell.${index}.nec_pearls`,
      message: "1軌道面あたりのスロット数 Nso は1以上の整数が必要です",
    });
    return errors;
  }
  if (!Number.isInteger(params.nc) || params.nc < 0 || params.nc > params.no - 1) {
    errors.push({
      field: `shell.${index}.lfc_nc`,
      message: `Nc は 0..${Math.max(0, params.no - 1)} の整数である必要があります`,
    });
  }
  if (params.necklace.length === 0) {
    errors.push({
      field: `shell.${index}.nec_necklace`,
      message: `ネックレス(占有スロット)を 1..${params.nso} の範囲で1つ以上指定してください`,
    });
    return errors;
  }
  if (!Number.isInteger(params.shift) || params.shift < 1) {
    errors.push({
      field: `shell.${index}.nec_shift`,
      message: "シフト k は1以上の整数が必要です",
    });
    return errors;
  }

  for (const warning of necklaceWarnings(params)) {
    errors.push({ field: `shell.${index}.nec_shift`, message: warning.message });
  }

  return errors;
}

export const necklaceFlowerGenerator: PatternGenerator = {
  id: "necklace_flower",
  fields: fieldKeysForPattern("necklace_flower"),
  plan: planNecklaceFlower,
  derive: deriveNecklaceFlower,
  validate: validateNecklaceFlower,
};
