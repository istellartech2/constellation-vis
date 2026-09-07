import { useEffect, useMemo, useRef, useState } from "react";
import type { ConstellationShell } from "../../lib/constellationTypes";
import type { ValidationError } from "../../lib/constellationSerializer";
import type { PatternId, ShellDerived } from "../../lib/constellationPatterns";
import { patternIdOf } from "../../lib/constellationPatterns";
import { migrateShellPattern, safeDerived } from "../../lib/constellationPatterns/migrate";
import CollapsibleSubsection from "./CollapsibleSubsection";
import DerivedInfoStrip, { type DerivedInfoItem } from "./DerivedInfoStrip";
import PatternFieldGroup from "./PatternFieldGroup";
import PatternSelect from "./PatternSelect";
import RgtConstraintSection from "./RgtConstraintSection";
import ShellFormBanner, { type ShellFormBannerItem } from "./ShellFormBanner";
import { Label } from "./label";

interface Props {
  shell: ConstellationShell;
  /** Index in `config.shells`; seeds the `shell.${index}.${key}` error ids. */
  shellIndex: number;
  errors: ValidationError[];
  onChange: (updates: Partial<ConstellationShell>) => void;
  /** Reopens the mission wizard prefilled from this shell's `mission_*` fields. */
  onRedesign?: (shell: ConstellationShell) => void;
}

/** Patterns whose orbit is a repeat-ground-track solution, so RGT is primary. */
const FLOWER_FAMILY: readonly PatternId[] = ["flower", "lattice_flower", "necklace_flower"];

const MIGRATION_NOTE_MS = 4000;

/**
 * Per-shell parameter form, driven entirely by
 * `constellationPatterns/uiMeta.ts`: the pattern picker chooses a field table,
 * `PatternFieldGroup` renders it, and everything read-only comes from
 * `computeShellDerived`. No hand-rolled `<input>`s remain — adding a TOML key
 * is a `uiMeta` entry, and `tests/constellationUiMeta.test.ts` fails if one is
 * forgotten.
 */
export default function ConstellationShellForm({
  shell,
  shellIndex,
  errors,
  onChange,
  onRedesign,
}: Props) {
  const pattern = patternIdOf(shell);
  const [migrationNote, setMigrationNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMigrationNote(null);
  }, [shell.id]);

  useEffect(
    () => () => {
      if (noteTimer.current) clearTimeout(noteTimer.current);
    },
    [],
  );

  const derived: ShellDerived | null = useMemo(() => safeDerived(shell), [shell]);

  const handlePatternChange = (next: PatternId) => {
    if (next === pattern) return;
    const { updates, note } = migrateShellPattern(shell, next);
    onChange({ ...updates, pattern: next });
    setMigrationNote(note);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setMigrationNote(null), MIGRATION_NOTE_MS);
  };

  // Cross-field errors (`shell.${i}` with no key) plus the pattern's own
  // advisory warnings. Field-level errors render next to their input.
  const bannerItems: ShellFormBannerItem[] = [
    ...errors
      .filter((e) => e.field === `shell.${shellIndex}`)
      .map((e) => ({ message: e.message, severity: e.severity })),
    ...(derived?.warnings ?? []).map((w) => ({
      message: w.message,
      severity: "warning" as const,
    })),
  ];
  const bannerSeen = new Set<string>();
  const banner = bannerItems.filter((item) => {
    if (bannerSeen.has(item.message)) return false;
    bannerSeen.add(item.message);
    return true;
  });

  const rgtInBasic = FLOWER_FAMILY.includes(pattern);
  const rgtSection = (
    <RgtConstraintSection
      shellId={shell.id}
      altitudeKm={shell.apogee_altitude ?? 0}
      inclinationDeg={shell.inclination ?? 0}
      eccentricity={shell.eccentricity ?? 0}
      onApply={onChange}
      alwaysOpen={rgtInBasic}
      defaultOpen={false}
    />
  );

  return (
    <div className="space-y-4 p-4 h-full overflow-y-auto">
      <div className="text-sm font-medium text-gray-100 border-b border-gray-600 pb-2">
        シェル詳細
      </div>

      <ShellFormBanner items={banner} />

      <div className="space-y-1">
        <Label htmlFor={`shell-name-${shell.id}`} className="text-xs text-gray-400">
          名前
        </Label>
        <input
          id={`shell-name-${shell.id}`}
          type="text"
          value={shell.name ?? ""}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="例: LEO-550km-53deg"
          className="w-full px-2 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded focus:border-amber-500 focus:outline-none text-gray-100"
        />
      </div>

      <PatternSelect
        id={`shell-pattern-${shell.id}`}
        value={pattern}
        onChange={handlePatternChange}
      />
      {migrationNote && (
        <p className="text-xs text-amber-300 bg-amber-900/20 border border-amber-800 rounded px-2 py-1">
          {migrationNote}
        </p>
      )}

      {shell.mission_objective && (
        <MissionProvenance shell={shell} onRedesign={onRedesign} />
      )}

      {derived ? (
        <DerivedInfoStrip title="派生情報" columns={2} items={derivedItems(derived)} />
      ) : (
        <p className="text-xs text-gray-500">
          入力が未完成のため派生情報を計算できません
        </p>
      )}

      <SocFeasibilityBadge derived={derived} />

      <PatternFieldGroup
        pattern={pattern}
        group="basic"
        shell={shell}
        shellIndex={shellIndex}
        errors={errors}
        derived={derived}
        onChange={onChange}
      />

      {rgtInBasic && (
        <div className="rounded border border-gray-800 bg-gray-900/40 p-3">{rgtSection}</div>
      )}

      <CollapsibleSubsection title="詳細パラメータ">
        <PatternFieldGroup
          pattern={pattern}
          group="advanced"
          shell={shell}
          shellIndex={shellIndex}
          errors={errors}
          derived={derived}
          onChange={onChange}
        />
        {!rgtInBasic && <div className="pt-1">{rgtSection}</div>}
      </CollapsibleSubsection>
    </div>
  );
}

const REGION_LABELS: Record<string, string> = {
  global: "全球",
  latitudeBand: "緯度帯",
};

const OBJECTIVE_LABELS: Record<string, string> = {
  minSatellites: "衛星数最小化",
  paretoCountVsAltitude: "衛星数 vs 高度",
  fixedBudget: "固定機数でカバレッジ最大化",
};

/** One line recording that the shell came out of the mission-design wizard. */
function MissionProvenance({
  shell,
  onRedesign,
}: {
  shell: ConstellationShell;
  onRedesign?: (shell: ConstellationShell) => void;
}) {
  const objective = OBJECTIVE_LABELS[shell.mission_objective ?? ""] ?? shell.mission_objective;
  const region = REGION_LABELS[shell.mission_region ?? ""] ?? shell.mission_region ?? "-";
  const band =
    shell.mission_region === "latitudeBand" &&
    shell.mission_lat_min !== undefined &&
    shell.mission_lat_max !== undefined
      ? `${shell.mission_lat_min}–${shell.mission_lat_max}°`
      : null;

  return (
    <p className="text-xs text-gray-400 bg-gray-900/50 border border-gray-800 rounded px-2 py-1">
      ミッション設計で作成（仰角 {shell.mission_min_elevation ?? "-"}° / 多重度{" "}
      {shell.mission_fold ?? "-"} / {region}
      {band ? ` ${band}` : ""}{objective ? ` / ${objective}` : ""}）
      {onRedesign && (
        <>
          {" "}
          <button
            type="button"
            onClick={() => onRedesign(shell)}
            className="text-amber-300 hover:text-amber-200 underline"
          >
            設計をやり直す
          </button>
        </>
      )}
    </p>
  );
}

function SocFeasibilityBadge({ derived }: { derived: ShellDerived | null }) {
  if (!derived || derived.pattern !== "streets_of_coverage") return null;
  const { design } = derived;

  if (design.feasible) {
    return (
      <p className="text-xs inline-flex items-center gap-2 rounded border border-emerald-700 bg-emerald-900/25 text-emerald-300 px-2 py-1">
        <span>成立</span>
        <span className="text-emerald-400/80">
          {design.planes} 面 × {design.satsPerPlane} 機 = {design.count} 機
        </span>
      </p>
    );
  }

  return (
    <p className="text-xs inline-flex items-center gap-2 rounded border border-amber-700 bg-amber-900/25 text-amber-300 px-2 py-1">
      <span>不成立</span>
      <span className="text-amber-400/80">
        {Number.isFinite(design.requiredSpanDeg)
          ? `必要 RAAN 範囲 ${design.requiredSpanDeg.toFixed(1)}° を満たす面数が見つかりません`
          : "被覆円が面内でつながりません"}
      </span>
    </p>
  );
}

function num(value: number, digits = 2, unit = ""): string {
  if (!Number.isFinite(value)) return "-";
  return `${Number(value.toFixed(digits))}${unit}`;
}

/** Common derived readout plus the pattern-specific extras. */
function derivedItems(derived: ShellDerived): DerivedInfoItem[] {
  const items: DerivedInfoItem[] = [
    { label: "総衛星数", value: num(derived.totalSats, 0, " 機") },
    { label: "軌道面数", value: num(derived.planes, 0, " 面") },
    {
      label: "1面あたり",
      value: num(derived.satsPerPlane, 2, " 機"),
      help: "総衛星数 ÷ 軌道面数。整数でない場合は面ごとの機数が不均等です。",
    },
    {
      label: "軌道周期",
      value: num(derived.periodMin, 2, " 分"),
      help: "ケプラー周期(摂動なし)。",
    },
    { label: "半長軸", value: num(derived.semiMajorAxisKm, 2, " km") },
    {
      label: "近/遠地点高度",
      value: `${num(derived.perigeeAltitudeKm, 0)} / ${num(derived.apogeeAltitudeKm, 0, " km")}`,
    },
    {
      label: "RAAN間隔",
      value: num(derived.raanSpacingDeg, 3, "°"),
      help: "隣接する軌道面の昇交点赤経の差。",
    },
    {
      label: "面間位相",
      value: num(derived.interPlaneOffsetDeg, 3, "°"),
      help: "次の軌道面へ移るときの平均近点角のオフセット。",
    },
    {
      label: "面内間隔",
      value: num(derived.inPlaneSpacingDeg, 3, "°"),
      help: "同一面内で隣り合う衛星の平均近点角の差。",
    },
  ];

  if (derived.rgt) {
    items.push({
      label: "最寄り回帰比",
      value: `${derived.rgt.repeatOrbits}/${derived.rgt.repeatDays} (誤差 ${derived.rgt.error.toExponential(1)})`,
      help: "この高度・傾斜角に最も近い回帰軌道比 N_S/N_D。",
      tone: derived.rgt.error < 1e-3 ? "ok" : "normal",
    });
  }

  switch (derived.pattern) {
    case "walker_delta":
      items.push(
        { label: "Walker記法", value: derived.walkerNotation },
        {
          label: "等価 N_c (2D-LFC)",
          value: derived.lfcNc === null ? "-" : String(derived.lfcNc),
          help: "この配置を 2D-LFC で表したときの構成番号。整数格子でない場合は -。",
        },
      );
      break;
    case "walker_star":
      items.push(
        { label: "Walker記法", value: derived.walkerNotation },
        {
          label: "RAAN範囲",
          value: "180° (固定)",
          help: "スター配置は半周だけを使うため、RAAN範囲は 180° に固定されます。",
        },
        { label: "Δco (同方向間隔)", value: num(derived.coSpacingDeg, 3, "°") },
        {
          label: "シーム幅",
          value: num(derived.seamDeg, 3, "°"),
          help: "最初と最後の軌道面の間隔。ここだけ逆行方向のすれ違いになります。",
          tone: derived.seamDeg < 0 ? "warn" : "normal",
        },
        {
          label: "極軌道判定",
          value: derived.inclinationPolar ? "OK (80–100°)" : "傾斜角が極軌道から外れています",
          tone: derived.inclinationPolar ? "ok" : "warn",
        },
      );
      break;
    case "streets_of_coverage": {
      const d = derived.design;
      items.push(
        {
          label: "被覆半角 θ",
          value: num(d.thetaDeg, 3, "°"),
          help: "地心から見た被覆円の半径。高度と最低仰角で決まります。",
        },
        {
          label: "ストリート半幅 c₁/c_n",
          value: `${num(d.c1Deg, 2)} / ${num(d.cnDeg, 2, "°")}`,
        },
        {
          label: "必要/実現 RAAN範囲",
          value: `${num(d.requiredSpanDeg, 2)} / ${num(d.achievedSpanDeg, 2, "°")}`,
          tone: d.feasible ? "ok" : "warn",
        },
        { label: "Δco / Δseam", value: `${num(d.deltaCoDeg, 2)} / ${num(d.deltaSeamDeg, 2, "°")}` },
        { label: "面間位相 ω", value: num(d.omegaDeg, 3, "°") },
        {
          label: "多重度 N",
          value: String(d.foldRequested),
          tone: d.foldRequested > 1 ? "warn" : "normal",
          help: "2以上の設計式は近似です。検証結果とずれる可能性があります。",
        },
      );
      break;
    }
    case "flower":
      items.push(
        { label: "回帰比 N_p/N_d", value: `${derived.np}/${derived.nd}` },
        { label: "位相 F_n/F_d/F_h", value: `${derived.fn}/${derived.fd}/${derived.fh}` },
        {
          label: "N_s / N_s,max",
          value: `${num(derived.ns, 0)} / ${num(derived.nsMax, 0)}`,
          tone: derived.ns > derived.nsMax ? "warn" : "normal",
          help: "N_s,max = N_d·F_d/gcd(N_d, N_p·F_n + F_d·F_h)。超えるとスロットが重複します。",
        },
        {
          label: "解かれた半長軸",
          value:
            derived.solvedSemiMajorAxisKm === null
              ? "解なし"
              : num(derived.solvedSemiMajorAxisKm, 3, " km"),
          tone: derived.solvedSemiMajorAxisKm === null ? "warn" : "normal",
        },
        {
          label: "高度の不一致",
          value:
            derived.apogeeAltitudeMismatchKm === null
              ? "-"
              : num(derived.apogeeAltitudeMismatchKm, 3, " km"),
          tone:
            (derived.apogeeAltitudeMismatchKm ?? 0) > 0.01 ? "warn" : "ok",
          help: "格納された高度と回帰条件から解いた高度の差。",
        },
      );
      break;
    case "lattice_flower":
      items.push(
        { label: "格子 N_o × N_so", value: `${num(derived.no, 0)} × ${num(derived.nso, 2)}` },
        { label: "構成番号 N_c", value: String(derived.nc) },
        {
          label: "Walker 等価",
          value: derived.walkerNotation,
          help: "円軌道では Walker Delta と等価です(F = (N_o − N_c) mod N_o)。",
        },
        { label: "等価 F", value: num(derived.walkerF, 0) },
        {
          label: "N_c 範囲判定",
          value: derived.ncAdmissible ? "OK" : "範囲外 (0..N_o−1)",
          tone: derived.ncAdmissible ? "ok" : "warn",
        },
        { label: "ΔM", value: num(derived.deltaMDeg, 3, "°") },
      );
      break;
    case "necklace_flower":
      items.push(
        { label: "格子 N_o × N_so", value: `${num(derived.no, 0)} × ${num(derived.nso, 0)}` },
        { label: "占有パール", value: `${derived.necklace.join(", ") || "-"} (${derived.occupied})` },
        { label: "構成番号 N_c", value: String(derived.nc) },
        {
          label: "Sym(G)",
          value: num(derived.symmetry, 0),
          help: "ネックレスを自分自身に重ねる最小の回転量。k·N_o − N_c を割り切る必要があります。",
        },
        {
          label: "シフト k の許容",
          value: derived.admissible ? `OK (k=${derived.shift})` : `不許容 (k=${derived.shift})`,
          tone: derived.admissible ? "ok" : "warn",
        },
        {
          label: "許容される k",
          value: derived.admissibleShifts.join(", ") || "なし",
        },
        { label: "ΔM", value: num(derived.deltaMDeg, 3, "°") },
        {
          label: "満格子の Walker 記法",
          value: derived.walkerNotation,
          help: "全パールを占有した場合の等価 Walker 記法(参考値)。",
        },
      );
      break;
  }

  return items;
}
