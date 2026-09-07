/**
 * Ready-made constellation shells for the editor's template menu.
 *
 * Same shape as `groundStationPresets.ts`: grouped, id-keyed, and free of
 * behaviour — a preset is just a shell minus its `id`, so
 * `createShellFromPreset` is the only place a UUID is minted.
 *
 * Every number is a representative published figure, not an operator's actual
 * filing: the point is to give a recognisable starting shape, and the notes say
 * so. `count`/`planes` are always written even for patterns that derive them
 * (`streets_of_coverage`, `lattice_flower`), because `EditorTab.tsx` counts
 * `count =` lines and `IslShellRange` needs `planes`.
 */
import type { ConstellationShell } from "./constellationTypes";

export interface ConstellationPresetItem {
  id: string;
  label: string;
  note?: string;
  shell: Omit<ConstellationShell, "id">;
}

export interface ConstellationPresetGroup {
  group: string;
  items: ConstellationPresetItem[];
}

const PUBLISHED_NOTE = "公開文献の代表値。実運用値とは異なります。";

export const CONSTELLATION_PRESETS: ConstellationPresetGroup[] = [
  {
    group: "実運用コンステレーション相当",
    items: [
      {
        id: "iridium-next",
        label: "Iridium 相当 (Streets of Coverage 66機)",
        note: `${PUBLISHED_NOTE} 高度780km・最低仰角8.2°・1面11機から6面66機が導出されます。`,
        shell: {
          name: "Iridium 相当",
          pattern: "streets_of_coverage",
          count: 66,
          planes: 6,
          apogee_altitude: 780,
          eccentricity: 0,
          inclination: 86.4,
          raan_start: 0,
          raan_range: 180,
          argp: 0,
          mean_anomaly_0: 0,
          soc_min_elevation: 8.2,
          soc_coverage_fold: 1,
          soc_target_latitude: 0,
          soc_sats_per_plane: 11,
        },
      },
      {
        id: "starlink-shell-1",
        label: "Starlink Shell-1 相当 (Walker Delta 1584機)",
        note: `${PUBLISHED_NOTE} 1584機の描画は負荷が高いため注意してください。`,
        shell: {
          name: "Starlink Shell-1 相当",
          pattern: "walker_delta",
          count: 1584,
          planes: 72,
          phasing: 1,
          apogee_altitude: 550,
          eccentricity: 0,
          inclination: 53,
          raan_start: 0,
          raan_range: 360,
          argp: 0,
          mean_anomaly_0: 0,
        },
      },
      {
        id: "starlink-polar",
        label: "Starlink 極軌道シェル相当 (Walker Delta 520機)",
        note: PUBLISHED_NOTE,
        shell: {
          name: "Starlink 極軌道シェル相当",
          pattern: "walker_delta",
          count: 520,
          planes: 10,
          phasing: 1,
          apogee_altitude: 560,
          eccentricity: 0,
          inclination: 97.6,
          raan_start: 0,
          raan_range: 360,
          argp: 0,
          mean_anomaly_0: 0,
        },
      },
      {
        id: "oneweb",
        label: "OneWeb 相当 (2D Lattice Flower 648機)",
        note: `${PUBLISHED_NOTE} 18面×36機の格子で、Walker Delta 648/18/17 と等価です。`,
        shell: {
          name: "OneWeb 相当",
          pattern: "lattice_flower",
          count: 648,
          planes: 18,
          apogee_altitude: 1200,
          eccentricity: 0,
          inclination: 87.9,
          raan_start: 0,
          raan_range: 360,
          argp: 0,
          mean_anomaly_0: 0,
          lfc_nc: 1,
        },
      },
      {
        id: "kuiper",
        label: "Kuiper 相当 (Walker Delta 1156機)",
        note: `${PUBLISHED_NOTE} 1156機の描画は負荷が高いため注意してください。`,
        shell: {
          name: "Kuiper 相当",
          pattern: "walker_delta",
          count: 1156,
          planes: 34,
          phasing: 1,
          apogee_altitude: 630,
          eccentricity: 0,
          inclination: 51.9,
          raan_start: 0,
          raan_range: 360,
          argp: 0,
          mean_anomaly_0: 0,
        },
      },
    ],
  },
  {
    group: "学習用",
    items: [
      {
        id: "minimal-walker-delta",
        label: "最小例 (Walker Delta 24/3/1)",
        note: "方式の挙動を確認するための最小構成。24機3面、位相 F=1。",
        shell: {
          name: "最小例",
          pattern: "walker_delta",
          count: 24,
          planes: 3,
          phasing: 1,
          apogee_altitude: 550,
          eccentricity: 0,
          inclination: 53,
          raan_start: 0,
          raan_range: 360,
          argp: 0,
          mean_anomaly_0: 0,
        },
      },
    ],
  },
];

/** Total satellite count above which the caller should confirm before applying. */
export const PRESET_HEAVY_SATELLITE_COUNT = 1000;

export function createShellFromPreset(item: ConstellationPresetItem): ConstellationShell {
  return { ...item.shell, id: crypto.randomUUID() };
}

export function findConstellationPreset(id: string): ConstellationPresetItem | undefined {
  for (const group of CONSTELLATION_PRESETS) {
    const found = group.items.find((item) => item.id === id);
    if (found) return found;
  }
  return undefined;
}
