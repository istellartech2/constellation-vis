/** ISL routing domain types. Pure data — no Three.js / React / scene coordinates. */

import type { GroundStation } from "../groundStations";

export interface IslEndpoint {
  kind: "station" | "adhoc";
  name: string;
  latitudeDeg: number;
  longitudeDeg: number;
  heightKm: number;
  minElevationDeg: number;
}

/**
 * Converts a saved ground station into a "station"-kind ISL endpoint.
 * Previously copy-pasted as a 5-field object literal at both the initial
 * mode-switch and the station-reselect call sites in `IslTab.tsx`.
 */
export function stationEndpoint(gs: GroundStation): IslEndpoint {
  return {
    kind: "station",
    name: gs.name,
    latitudeDeg: gs.latitudeDeg,
    longitudeDeg: gs.longitudeDeg,
    heightKm: gs.heightKm,
    minElevationDeg: gs.minElevationDeg,
  };
}

function reconcileEndpoint(
  ep: IslEndpoint | null,
  stations: GroundStation[],
): IslEndpoint | null {
  if (!ep || ep.kind !== "station") return ep; // 臨時地点はシナリオに依存しない
  const gs = stations.find((s) => s.name === ep.name);
  if (!gs) return null; // 参照先の地上局が消えた → 未設定に初期化
  const next = stationEndpoint(gs);
  const unchanged =
    next.latitudeDeg === ep.latitudeDeg &&
    next.longitudeDeg === ep.longitudeDeg &&
    next.heightKm === ep.heightKm &&
    next.minElevationDeg === ep.minElevationDeg;
  return unchanged ? ep : next; // 同名局の定義変更に追従(座標・仰角を最新化)
}

/**
 * シナリオ更新(「更新」ボタン)後に、endpoint の地上局参照を新しい地上局リストへ
 * 整合させる。station 参照は同名局があれば座標を最新化し、無ければ null(未設定)に
 * 初期化する。何も変わらなければ同一オブジェクトを返す(不要な再計算・永続化を防ぐ)。
 */
export function reconcileIslEndpoints(
  settings: IslSettings,
  stations: GroundStation[],
): IslSettings {
  const a = reconcileEndpoint(settings.endpointA, stations);
  const b = reconcileEndpoint(settings.endpointB, stations);
  if (a === settings.endpointA && b === settings.endpointB) return settings;
  return { ...settings, endpointA: a, endpointB: b };
}

export interface IslLinkModel {
  mode: "dynamic" | "gridPattern";
  /** Applied to both ISL (satellite-satellite) and GSL (ground-satellite) links. */
  maxRangeKm: number;
  /** Line-of-sight grazing margin; ISL only (GSL uses elevation instead). */
  losMarginKm: number;
}

/**
 * Stable description of one shell's satellite index range, used to resolve
 * per-shell link-model overrides and gridPattern topology.
 * `key` matches the keys of `IslSettings.shellLinkModels` / `excludedShellKeys`.
 */
export interface IslShellRange {
  key: string;
  name?: string;
  /** Index (into the satellite array) of the shell's first satellite. */
  startIndex: number;
  count: number;
  planes: number;
}

export interface IslCostSettings {
  hopPenaltyMs: number;
  /** beta in [0, 0.5], hysteresis discount applied to previous-path edges. */
  switchDiscount: number;
  kindPenaltyMs?: Record<string, number>;
  /**
   * w_tau [ms] (§1.5.2): penalty cap for links about to expire. 0
   * (default) disables the remaining-link-time forward sampling entirely —
   * it's the most expensive cost component (per-edge forward propagation),
   * so it's opt-in and Worker-only.
   */
  stabilityWeightMs?: number;
}

export interface IslSettings {
  enabled: boolean;
  endpointA: IslEndpoint | null;
  endpointB: IslEndpoint | null;
  /**
   * Stable keys (IslShellRange.key) of shells excluded from ISL participation.
   * Resolved to actual satellite indices at compute time (worker/graph layer),
   * never pre-resolved and persisted — a key referring to a since-removed
   * shell is simply a no-op (falls back to "included").
   */
  excludedShellKeys: string[];
  /** Whether satellites.toml (non-shell) satellites participate. */
  includeBaseSatellites: boolean;
  linkModel: IslLinkModel;
  shellLinkModels?: Record<string, Partial<IslLinkModel>>;
  cost: IslCostSettings;
  recomputeIntervalSimS: number;
  /**
   * Display settings: kept in IslSettings rather than threaded as
   * separate App/DisplaySettings/SceneParams fields, which previously meant
   * touching 5 files to add one color. The endpoint A/B markers reuse these
   * same two colors (they used to be a hardcoded, settings-independent
   * duplicate of the same hex values) rather than getting their own fields.
   */
  gslColor: string;
  islColor: string;
}

/** Graph node id convention: 0..N-1 = satellite index, N = endpoint A, N+1 = endpoint B. */
export function endpointANodeId(satelliteCount: number): number {
  return satelliteCount;
}

export function endpointBNodeId(satelliteCount: number): number {
  return satelliteCount + 1;
}

export interface IslPathEdge {
  fromNodeId: number;
  toNodeId: number;
  kind: "gsl" | "isl";
  distanceKm: number;
  delayMs: number;
}

export interface IslPathResult {
  reachable: boolean;
  computedAtSimMs: number;
  /** Satellite indices visited, in path order (A and B are implicit endpoints). */
  nodeSatIndices: number[];
  edges: IslPathEdge[];
  totalDelayMs: number;
  totalDistanceKm: number;
  /** Number of relay satellites (== edges.length - 1). */
  hopCount: number;
  switchedFromPrevious: boolean;
  candidateEdgeCount: number;
  computeTimeMs: number;
}

export const DEFAULT_LINK_MODEL: IslLinkModel = {
  mode: "dynamic",
  maxRangeKm: 5000,
  losMarginKm: 80,
};

export const DEFAULT_COST_SETTINGS: IslCostSettings = {
  hopPenaltyMs: 2,
  switchDiscount: 0.2,
};

export const DEFAULT_ADHOC_MIN_ELEVATION_DEG = 10;
export const DEFAULT_RECOMPUTE_INTERVAL_SIM_S = 10;
export const DEFAULT_GSL_COLOR = "#ff33cc";
export const DEFAULT_ISL_COLOR = "#33e0ff";

export function createDefaultIslSettings(): IslSettings {
  return {
    enabled: false,
    endpointA: null,
    endpointB: null,
    excludedShellKeys: [],
    includeBaseSatellites: true,
    linkModel: { ...DEFAULT_LINK_MODEL },
    cost: { ...DEFAULT_COST_SETTINGS },
    recomputeIntervalSimS: DEFAULT_RECOMPUTE_INTERVAL_SIM_S,
    gslColor: DEFAULT_GSL_COLOR,
    islColor: DEFAULT_ISL_COLOR,
  };
}
