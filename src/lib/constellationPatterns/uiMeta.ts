/**
 * Declarative UI metadata for the constellation shell editor.
 *
 * `fields.ts` says which TOML keys exist and what an omitted key means; this
 * module says how a key is *presented* for a given pattern — Japanese label,
 * unit, range, step, basic/advanced placement and the one-or-two-line HelpTip.
 * `ConstellationShellForm` / `PatternFieldGroup` render straight from these
 * tables, so a new field is one entry here instead of another hand-rolled
 * `<input>`.
 *
 * Deliberately UI-only and free of React: `tests/constellationUiMeta.test.ts`
 * asserts that every registry key meaningful for a pattern is either presented
 * or explicitly listed in `HIDDEN_FIELDS`, so a Phase-1 schema addition cannot
 * silently become an invisible field.
 */

import type { ConstellationShell } from "../constellationTypes";
import { fieldKeysForPattern, numberField } from "./fields";
import { admissibleShifts, necklaceParams } from "./necklaceFlower";
import type { PatternId, ShellDerived } from "./types";
import { PATTERN_IDS } from "./types";

export type PatternGroup = "ウォーカー系" | "フラワー系";

export interface PatternMetaEntry {
  /** Menu label, e.g. "Walker Delta（デルタ配置）". */
  label: string;
  /** `<optgroup>` the pattern belongs to. */
  group: PatternGroup;
  /** One-line description shown under the pattern `<select>`. */
  summary: string;
  /** Longer explanation behind the ⓘ next to the `<select>`. */
  help: string;
}

export const PATTERN_META: Record<PatternId, PatternMetaEntry> = {
  walker_delta: {
    label: "Walker Delta（デルタ配置）",
    group: "ウォーカー系",
    summary: "T/P/F の3数で軌道面を全周(360°)に均等配置する最も一般的な方式。",
    help: "総衛星数 T・軌道面数 P・位相係数 F で決まる均等格子。RAAN を 360° 全周に配る傾斜軌道向けで、Starlink や Kuiper の各シェルがこの形です。",
  },
  walker_star: {
    label: "Walker Star（スター配置）",
    group: "ウォーカー系",
    summary: "軌道面を半周(180°)に配置する極軌道向け。極上空で面が集まりシームができます。",
    help: "極軌道(傾斜角 80–100°)を 180° の RAAN 範囲に並べる方式。1周の半分だけ使うため、最初と最後の面の間に逆行方向のシーム(継ぎ目)ができます。Iridium がこの形です。",
  },
  streets_of_coverage: {
    label: "Streets of Coverage（連続被覆設計）",
    group: "ウォーカー系",
    summary: "仰角・多重度・目標緯度から必要な軌道面数を設計式で逆算する Walker Star。",
    help: "1面あたり衛星数 S と最低仰角 ε から面内の連続被覆帯(ストリート)幅を求め、目標緯度で切れ目なく繋がる軌道面数 P を導出します。P と総衛星数は入力ではなく計算結果です。",
  },
  flower: {
    label: "Flower Constellation（フラワー）",
    group: "フラワー系",
    summary: "回帰軌道(Np/Nd)上に位相を配る方式。離心軌道を扱える唯一の方式です。",
    help: "Np 周回/Nd 日で地上軌跡が閉じる回帰軌道に、位相パラメータ Fn/Fd/Fh で衛星を並べます。半長軸は傾斜角・離心率・Np/Nd から解かれるため、高度は入力ではなく導出値です。",
  },
  lattice_flower: {
    label: "Lattice Flower（2D-LFC 格子）",
    group: "フラワー系",
    summary: "No 面 × Nso 機の格子を構成番号 Nc で位相付けする方式。Walker と等価です。",
    help: "軌道面数 No・1面あたり衛星数 Nso・構成番号 Nc(0..No−1)で表す 2次元格子。円軌道では Walker Delta と1対1で対応し、F = (No − Nc) mod No になります。OneWeb がこの形です。",
  },
  necklace_flower: {
    label: "Necklace Flower（ネックレス）",
    group: "フラワー系",
    summary: "2D-LFC の格子スロットを一部だけ使い、面ごとにシフト k で回す間引き配置。",
    help: "各面に Nso 個のスロット(パール)を用意し、そのうち選んだ部分集合だけを使います。面をまたぐごとにパールをシフト k だけ回すため、Sym(G) が k·No − Nc を割り切る必要があります。",
  },
};

export type FieldUiGroup = "basic" | "advanced";
/**
 * - `number`   — plain `NumberField`
 * - `slider`   — `InlineSlider` (bounded angles only)
 * - `readonly` — derived value, rendered as text (needs `read`)
 * - `pearls`   — necklace toggle-chip row (only `nec_necklace`)
 */
export type FieldUiKind = "number" | "slider" | "readonly" | "pearls";

/** A bound that may depend on another field (F ≤ P−1, Nc ≤ No−1, Fh ≤ Nd−1, …). */
export type FieldBound = number | ((shell: ConstellationShell) => number);

export interface FieldUiSpec {
  key: keyof ConstellationShell;
  label: string;
  /** Alternate label used when the field renders read-only. */
  labelOverride?: string;
  unit?: string;
  group: FieldUiGroup;
  kind: FieldUiKind;
  min?: FieldBound;
  max?: FieldBound;
  step?: number;
  integer?: boolean;
  help: string;
  hint?: string | ((shell: ConstellationShell) => string | undefined);
  /** Non-undefined return disables the input and shows the string as a hint. */
  disabledWhen?: (shell: ConstellationShell) => string | undefined;
  /**
   * Value to display instead of `shell[key]`. Required for `readonly` fields
   * and for "virtual" fields such as the lattice's Nso (stored as `count`).
   */
  read?: (shell: ConstellationShell, derived: ShellDerived | null) => number;
  /** Updates to write instead of `{ [key]: value }` (virtual fields). */
  write?: (value: number, shell: ConstellationShell) => Partial<ConstellationShell>;
}

export function resolveBound(
  bound: FieldBound | undefined,
  shell: ConstellationShell,
): number | undefined {
  if (bound === undefined) return undefined;
  return typeof bound === "function" ? bound(shell) : bound;
}

export function resolveHint(
  spec: FieldUiSpec,
  shell: ConstellationShell,
): string | undefined {
  if (typeof spec.hint === "function") return spec.hint(shell);
  return spec.hint;
}

/**
 * Registry keys deliberately not shown for a pattern. Everything else that
 * `fieldKeysForPattern` reports must appear in `PATTERN_FIELD_SPECS`.
 *
 * `raan_range` is registered for every pattern but only Walker Delta lets the
 * user set it: walker-star / streets-of-coverage pin it to the 180° half-sky
 * span (the seam is derived from it), and the flower family always spans 360°.
 * The flower's `planes` is hidden because `flower_fd` *is* the plane count and
 * is written back to `planes` (see `migrate.syncDerivedFields`); the derived
 * strip still shows the resulting number.
 * `rgt_repeat_*` are written by `RgtConstraintSection`, `mission_*` by the
 * Phase-4 wizard, and `name`/`pattern` have their own controls.
 */
export const HIDDEN_FIELDS: Record<PatternId, readonly (keyof ConstellationShell)[]> = {
  walker_delta: [],
  walker_star: ["raan_range"],
  streets_of_coverage: ["raan_range"],
  flower: ["raan_range", "planes"],
  lattice_flower: ["raan_range"],
  necklace_flower: ["raan_range"],
};

/** Keys that have their own dedicated controls rather than a `FieldUiSpec`. */
export const UI_EXEMPT_KEYS: readonly string[] = [
  "pattern",
  "name",
  "rgt_repeat_orbits",
  "rgt_repeat_days",
  "mission_objective",
  "mission_min_elevation",
  "mission_fold",
  "mission_region",
  "mission_lat_min",
  "mission_lat_max",
  "mission_alt_min",
  "mission_alt_max",
];

// --- shared field builders -------------------------------------------------

const ALTITUDE: FieldUiSpec = {
  key: "apogee_altitude",
  label: "高度",
  unit: "km",
  group: "basic",
  kind: "number",
  min: 200,
  max: 36000,
  step: 10,
  help: "円軌道なら軌道高度、離心軌道では遠地点高度。低いほど必要機数が増え、通信遅延は小さくなります。",
};

function inclination(help: string, group: FieldUiGroup = "basic"): FieldUiSpec {
  return {
    key: "inclination",
    label: "軌道傾斜角",
    unit: "°",
    group,
    kind: "number",
    min: 0,
    max: 180,
    step: 0.1,
    help,
  };
}

const INCLINATION_HELP =
  "カバーできる最大緯度をほぼ決めます(到達緯度 ≈ 傾斜角 + 被覆半角)。90°で極を通ります。";

const ECCENTRICITY: FieldUiSpec = {
  key: "eccentricity",
  label: "離心率",
  group: "advanced",
  kind: "number",
  min: 0,
  max: 0.95,
  step: 0.0001,
  help: "0 で円軌道。通信コンステレーションでは通常 0 のままにします。",
};

const RAAN_START: FieldUiSpec = {
  key: "raan_start",
  label: "RAAN開始角",
  unit: "°",
  group: "advanced",
  kind: "number",
  min: 0,
  max: 360,
  step: 0.1,
  help: "最初の軌道面の昇交点赤経。シェル全体を経度方向に回すオフセットです。",
};

const ARGP: FieldUiSpec = {
  key: "argp",
  label: "近地点引数",
  unit: "°",
  group: "advanced",
  kind: "number",
  min: 0,
  max: 360,
  step: 0.1,
  help: "近地点の位置。円軌道では意味を持ちません(離心率 > 0 のときだけ有効)。",
  disabledWhen: (shell) =>
    (shell.eccentricity ?? 0) === 0 ? "離心率が0のため無効" : undefined,
};

const MEAN_ANOMALY_0: FieldUiSpec = {
  key: "mean_anomaly_0",
  label: "平均近点角(初期)",
  unit: "°",
  group: "advanced",
  kind: "number",
  min: 0,
  max: 360,
  step: 0.1,
  help: "最初の衛星の初期位相。シェル全体を軌道進行方向にずらします。",
};

/** eccentricity → raan_start → argp → mean_anomaly_0, the shared 詳細 block. */
const COMMON_ADVANCED: FieldUiSpec[] = [ECCENTRICITY, RAAN_START, ARGP, MEAN_ANOMALY_0];

const WALKER_COUNT: FieldUiSpec = {
  key: "count",
  label: "総衛星数 (T)",
  group: "basic",
  kind: "number",
  min: 1,
  step: 1,
  integer: true,
  help: "シェル全体の衛星数。Walker 記法 T/P/F の T です。",
};

const WALKER_PLANES: FieldUiSpec = {
  key: "planes",
  label: "軌道面数 (P)",
  group: "basic",
  kind: "number",
  min: 1,
  step: 1,
  integer: true,
  help: "軌道面の数。T が P の倍数でないと面ごとの機数が不均等になります。",
};

const WALKER_PHASING: FieldUiSpec = {
  key: "phasing",
  label: "位相係数 (F)",
  group: "basic",
  kind: "number",
  min: 0,
  max: (shell) => Math.max(0, (shell.planes ?? 1) - 1),
  step: 1,
  help: "隣の軌道面へ移るときの衛星位相のずれ。ずれ量は (360°/T)·F です。",
  hint: "整数推奨、小数も可",
};

// --- streets of coverage ---------------------------------------------------

function socDesignOf(derived: ShellDerived | null) {
  return derived && derived.pattern === "streets_of_coverage" ? derived.design : null;
}

const SOC_FIELDS: FieldUiSpec[] = [
  {
    key: "soc_sats_per_plane",
    label: "1面あたり衛星数 (S)",
    group: "basic",
    kind: "number",
    min: 2,
    max: 60,
    step: 1,
    integer: true,
    help: "1つの軌道面に等間隔で並べる機数。多いほど面内の被覆帯が広がり、必要な面数が減ります。",
  },
  {
    key: "soc_min_elevation",
    label: "設計最低仰角 (ε)",
    unit: "°",
    group: "basic",
    kind: "number",
    min: 0,
    max: 60,
    step: 1,
    help: "地上から見て何度以上の高さで見えれば「見えている」とみなすか。大きくすると被覆円が小さくなり必要機数が増えます。",
  },
  {
    key: "soc_coverage_fold",
    label: "多重度 (N)",
    group: "basic",
    kind: "number",
    min: 1,
    max: 4,
    step: 1,
    integer: true,
    help: "同時に何機見えている必要があるか。2以上の設計式は近似です。",
  },
  {
    key: "soc_target_latitude",
    label: "目標緯度 (λ)",
    unit: "°",
    group: "basic",
    kind: "number",
    min: 0,
    max: 85,
    step: 1,
    help: "連続被覆を保証する下限緯度。0 は全球(赤道まで)を意味します。",
  },
  ALTITUDE,
  inclination("Streets of Coverage は極軌道前提です。80–100°を推奨します。"),
  {
    key: "planes",
    label: "軌道面数 (P)",
    labelOverride: "軌道面数 (P)（導出）",
    group: "basic",
    kind: "readonly",
    help: "設計式から導出される軌道面数。入力ではありません。",
    read: (shell, derived) => derived?.planes ?? numberField("planes", shell),
  },
  {
    key: "count",
    label: "総衛星数 (T)",
    labelOverride: "総衛星数 (T)（導出）",
    group: "basic",
    kind: "readonly",
    help: "T = P × S。設計式から導出されます。",
    read: (shell, derived) => derived?.totalSats ?? numberField("count", shell),
  },
  {
    key: "raan_spacing",
    label: "同方向面間隔 (Δco)",
    labelOverride: "同方向面間隔 (Δco)（導出）",
    unit: "°",
    group: "advanced",
    kind: "readonly",
    help: "同じ方向に回る隣接軌道面の RAAN 間隔。設計式の結果です。",
    read: (shell, derived) => {
      const design = socDesignOf(derived);
      if (design?.feasible) return round(design.deltaCoDeg, 3);
      return round(numberField("raan_spacing", shell), 3);
    },
  },
  {
    key: "phasing",
    label: "位相係数 (F)",
    labelOverride: "位相係数 (F)（導出）",
    group: "advanced",
    kind: "readonly",
    help: "面間の平均近点角オフセット ω から換算した F = T·ω/360。",
    read: (shell, derived) => {
      const design = socDesignOf(derived);
      if (design?.feasible) return round((design.count * design.omegaDeg) / 360, 3);
      return round(numberField("phasing", shell), 3);
    },
  },
  ...COMMON_ADVANCED,
];

// --- flower ----------------------------------------------------------------

const FLOWER_FIELDS: FieldUiSpec[] = [
  {
    key: "flower_np",
    label: "花弁数 (N_p)",
    group: "basic",
    kind: "number",
    min: 1,
    max: 2000,
    step: 1,
    integer: true,
    help: "回帰周期あたりの周回数。N_p/N_d が地上軌跡の回帰比になります。",
  },
  {
    key: "flower_nd",
    label: "反復日数 (N_d)",
    unit: "日",
    group: "basic",
    kind: "number",
    min: 1,
    max: 30,
    step: 1,
    integer: true,
    help: "地上軌跡が閉じるまでの日数。N_p 周回 = N_d 日となる軌道が選ばれます。",
  },
  {
    key: "count",
    label: "総衛星数 (N_s)",
    group: "basic",
    kind: "number",
    min: 1,
    max: 2000,
    step: 1,
    integer: true,
    help: "配置する衛星数。N_d·F_d/gcd(N_d, N_p·F_n + F_d·F_h) を超えるとスロットが重複します。",
  },
  {
    key: "flower_fn",
    label: "位相パラメータ (F_n)",
    group: "basic",
    kind: "number",
    min: 1,
    step: 1,
    integer: true,
    help: "RAAN の刻み 2π·F_n/F_d を決める分子。F_d と互いに素にすると面が均等に埋まります。",
  },
  {
    key: "flower_fd",
    label: "軌道面数 (F_d)",
    group: "basic",
    kind: "number",
    min: 1,
    step: 1,
    integer: true,
    help: "RAAN の分母。そのまま軌道面数になります(planes に書き戻されます)。",
  },
  {
    key: "flower_fh",
    label: "位相シフト (F_h)",
    group: "basic",
    kind: "number",
    min: 0,
    max: (shell) => Math.max(0, (shell.flower_nd ?? 1) - 1),
    step: 1,
    integer: true,
    help: "面をまたぐときの追加位相。0..N_d−1 の整数です。",
  },
  inclination("臨界傾斜角 63.4°(または 116.6°)では近地点が漂動しません。", "basic"),
  { ...ECCENTRICITY, group: "basic" },
  { ...ARGP, group: "basic" },
  {
    key: "apogee_altitude",
    label: "遠地点高度",
    labelOverride: "遠地点高度（導出）",
    unit: "km",
    group: "basic",
    kind: "readonly",
    help: "傾斜角・離心率・N_p/N_d から解かれる回帰軌道の遠地点高度。入力ではありません。",
    read: (shell, derived) => {
      if (derived && derived.pattern === "flower" && derived.solvedApogeeAltitudeKm !== null) {
        return round(derived.solvedApogeeAltitudeKm, 2);
      }
      return round(numberField("apogee_altitude", shell), 2);
    },
  },
  RAAN_START,
  MEAN_ANOMALY_0,
];

// --- lattice / necklace ----------------------------------------------------

const LATTICE_NO: FieldUiSpec = {
  key: "planes",
  label: "軌道面数 (N_o)",
  group: "basic",
  kind: "number",
  min: 1,
  step: 1,
  integer: true,
  help: "格子の軌道面数。RAAN は 360°/N_o 間隔で並びます。",
};

function latticeNc(): FieldUiSpec {
  return {
    key: "lfc_nc",
    label: "構成番号 (N_c)",
    group: "basic",
    kind: "number",
    min: 0,
    max: (shell) => Math.max(0, (shell.planes ?? 1) - 1),
    step: 1,
    integer: true,
    help: "格子の位相ねじれ。0 ≤ N_c ≤ N_o−1 で、Walker の F = (N_o − N_c) mod N_o に対応します。",
  };
}

const LATTICE_FIELDS: FieldUiSpec[] = [
  LATTICE_NO,
  {
    // Virtual field: Nso is not a TOML key — it is stored as count = No × Nso.
    key: "count",
    label: "1面あたり衛星数 (N_so)",
    group: "basic",
    kind: "number",
    min: 1,
    step: 1,
    integer: true,
    help: "1軌道面あたりの衛星数。総衛星数は N_o × N_so として保存されます。",
    read: (shell) => {
      const planes = Number(shell.planes);
      if (!Number.isFinite(planes) || planes <= 0) return NaN;
      return Number(shell.count) / planes;
    },
    write: (value, shell) => {
      const planes = Number(shell.planes);
      if (!Number.isFinite(planes) || planes <= 0 || !Number.isFinite(value)) {
        return { count: NaN };
      }
      return { count: planes * Math.round(value) };
    },
    hint: (shell) => {
      const planes = Number(shell.planes);
      const nso = Number.isFinite(planes) && planes > 0 ? Number(shell.count) / planes : NaN;
      if (!Number.isFinite(nso)) return undefined;
      return `総衛星数 T = ${planes} × ${nso} = ${planes * nso}`;
    },
  },
  latticeNc(),
  ALTITUDE,
  inclination(INCLINATION_HELP),
  ...COMMON_ADVANCED,
];

const NECKLACE_FIELDS: FieldUiSpec[] = [
  LATTICE_NO,
  {
    key: "nec_pearls",
    label: "パール数 (N_so)",
    group: "basic",
    kind: "number",
    min: 1,
    max: 60,
    step: 1,
    integer: true,
    help: "1軌道面に用意するスロット数。このうち選んだスロットだけに衛星を置きます。",
  },
  latticeNc(),
  {
    key: "nec_necklace",
    label: "占有パール",
    group: "basic",
    kind: "pearls",
    help: "衛星を置くスロット番号(1始まり)。少なくとも1つ選んでください。",
  },
  {
    key: "nec_shift",
    label: "シフト (k)",
    group: "basic",
    kind: "number",
    min: 1,
    max: (shell) => Math.max(1, shell.nec_pearls ?? 1),
    step: 1,
    integer: true,
    help: "次の軌道面へ移るときにネックレスを回すスロット数。Sym(G) が k·N_o − N_c を割り切る必要があります。",
    hint: (shell) => {
      const shifts = admissibleShifts(necklaceParams(shell));
      return shifts.length > 0 ? `許容される k: ${shifts.join(", ")}` : "許容される k がありません";
    },
  },
  {
    key: "count",
    label: "総衛星数 (T)",
    labelOverride: "総衛星数 (T)（導出）",
    group: "basic",
    kind: "readonly",
    help: "T = N_o × 占有パール数。導出値です。",
    read: (shell, derived) => derived?.totalSats ?? numberField("count", shell),
  },
  ALTITUDE,
  inclination(INCLINATION_HELP),
  ...COMMON_ADVANCED,
];

// --- assembled table -------------------------------------------------------

export const PATTERN_FIELD_SPECS: Record<PatternId, readonly FieldUiSpec[]> = {
  walker_delta: [
    WALKER_COUNT,
    WALKER_PLANES,
    WALKER_PHASING,
    ALTITUDE,
    inclination(INCLINATION_HELP),
    {
      key: "raan_range",
      label: "RAAN分布範囲",
      unit: "°",
      group: "advanced",
      kind: "slider",
      min: 0,
      max: 360,
      step: 1,
      help: "軌道面をこの角度範囲に均等配置します。デルタ配置は 360°(全周)が標準です。",
    },
    ...COMMON_ADVANCED,
  ],
  walker_star: [
    WALKER_COUNT,
    WALKER_PLANES,
    WALKER_PHASING,
    ALTITUDE,
    inclination("スター配置は極軌道前提です。80–100°を推奨します。"),
    {
      key: "raan_spacing",
      label: "同方向面間隔 (Δco)",
      unit: "°",
      group: "advanced",
      kind: "number",
      min: 0,
      max: 180,
      step: 0.01,
      help: "同じ方向に回る隣接軌道面の RAAN 間隔。残りがシーム(逆行方向の継ぎ目)になります。",
      hint: "省略時は 180/P",
      read: (shell) => numberField("raan_spacing", shell),
    },
    ...COMMON_ADVANCED,
  ],
  streets_of_coverage: SOC_FIELDS,
  flower: FLOWER_FIELDS,
  lattice_flower: LATTICE_FIELDS,
  necklace_flower: NECKLACE_FIELDS,
};

function round(value: number, digits: number): number {
  if (!Number.isFinite(value)) return value;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Specs of `pattern` in the requested basic/advanced group, in table order. */
export function fieldSpecsFor(pattern: PatternId, group: FieldUiGroup): FieldUiSpec[] {
  return PATTERN_FIELD_SPECS[pattern].filter((spec) => spec.group === group);
}

/**
 * Registry keys meaningful for `pattern` that neither a `FieldUiSpec` nor
 * `HIDDEN_FIELDS`/`UI_EXEMPT_KEYS` accounts for. Empty for every pattern —
 * enforced by `tests/constellationUiMeta.test.ts`.
 */
export function unpresentedFields(pattern: PatternId): string[] {
  const presented = new Set<string>(PATTERN_FIELD_SPECS[pattern].map((s) => s.key as string));
  const hidden = new Set<string>(HIDDEN_FIELDS[pattern] as readonly string[]);
  return fieldKeysForPattern(pattern).filter(
    (key) => !presented.has(key) && !hidden.has(key) && !UI_EXEMPT_KEYS.includes(key),
  );
}

/** Patterns grouped for the `<optgroup>`s of `PatternSelect`, in menu order. */
export const PATTERN_GROUPS: { group: PatternGroup; patterns: PatternId[] }[] = [
  {
    group: "ウォーカー系",
    patterns: PATTERN_IDS.filter((p) => PATTERN_META[p].group === "ウォーカー系"),
  },
  {
    group: "フラワー系",
    patterns: PATTERN_IDS.filter((p) => PATTERN_META[p].group === "フラワー系"),
  },
];
