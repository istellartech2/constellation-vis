import type { SatelliteSpec } from "../lib/satellites";

const MU = 398600.4418; // km^3/s^2

export interface CelestrakGroupNode {
  id: string;
  label: string;
  urlGroup?: string;
  children?: CelestrakGroupNode[];
}

export const CELESTRAK_GROUP_TREE: CelestrakGroupNode[] = [
  {
    id: "special",
    label: "注目カテゴリ",
    children: [
      { id: "last-30-days", label: "過去30日間の打ち上げ" },
      { id: "stations", label: "宇宙ステーション" },
      { id: "active", label: "運用中衛星" },
      { id: "geo", label: "運用中GEO" },
      { id: "cubesat", label: "キューブサット" },
    ],
  },
  {
    id: "weather-earth",
    label: "気象・地球観測",
    children: [
      { id: "weather", label: "気象衛星" },
      { id: "planet", label: "Planet" },
      { id: "spire", label: "Spire" },
    ],
  },
  {
    id: "communications",
    label: "通信",
    children: [
      { id: "starlink", label: "Starlink" },
      { id: "oneweb", label: "OneWeb" },
      { id: "intelsat", label: "Intelsat" },
      { id: "ses", label: "SES" },
      { id: "iridium", label: "Iridium" },
      { id: "globalstar", label: "Globalstar" },
      { id: "amateur", label: "Amateur Radio" },
    ],
  },
  {
    id: "navigation",
    label: "GNSS",
    children: [
      { id: "gnss", label: "GNSS全体" },
      { id: "gps-ops", label: "GPS運用中" },
      { id: "glo-ops", label: "GLONASS" },
      { id: "galileo", label: "Galileo" },
      { id: "beidou", label: "BeiDou" },
      { id: "sbas", label: "SBAS（QZSS/WAAS/EGNOS）" },
    ],
  },
  {
    id: "debris",
    label: "デブリ",
    children: [
      { id: "cosmos-1408-debris", label: "COSMOS 1408 Debris" },
      { id: "fengyun-1c-debris", label: "Fengyun 1C Debris" },
      { id: "iridium-33-debris", label: "Iridium 33 Debris" },
      { id: "cosmos-2251-debris", label: "COSMOS 2251 Debris" },
    ],
  },
] as const;

type CelestrakGroupEntry = {
  label: string;
  urlGroup: string;
};

const CELESTRAK_GROUP_INDEX = new Map<string, CelestrakGroupEntry>();

function indexGroups(nodes: readonly CelestrakGroupNode[]) {
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      indexGroups(node.children);
    } else {
      CELESTRAK_GROUP_INDEX.set(node.id, {
        label: node.label,
        urlGroup: node.urlGroup ?? node.id,
      });
    }
  }
}

indexGroups(CELESTRAK_GROUP_TREE);

export interface CelestrakEntry {
  MEAN_MOTION: number;
  ECCENTRICITY: number;
  INCLINATION: number;
  RA_OF_ASC_NODE: number;
  ARG_OF_PERICENTER: number;
  MEAN_ANOMALY: number;
  NORAD_CAT_ID: number;
  EPOCH: string;
  OBJECT_NAME?: string;
  OBJECT_ID?: string;
}

export function celestrakEntryToSat(entry: CelestrakEntry): SatelliteSpec {
  const mm = Number(entry.MEAN_MOTION);
  const n = (mm * 2 * Math.PI) / 86400; // rad/s
  const a = Math.pow(MU / (n * n), 1 / 3);
  return {
    type: "elements",
    elements: {
      satnum: Number(entry.NORAD_CAT_ID),
      epoch: new Date(String(entry.EPOCH)),
      semiMajorAxisKm: a,
      eccentricity: Number(entry.ECCENTRICITY),
      inclinationDeg: Number(entry.INCLINATION),
      raanDeg: Number(entry.RA_OF_ASC_NODE),
      argPerigeeDeg: Number(entry.ARG_OF_PERICENTER),
      meanAnomalyDeg: Number(entry.MEAN_ANOMALY),
    },
    meta: {
      objectName: entry.OBJECT_NAME,
      objectId: entry.OBJECT_ID,
      noradCatId: Number(entry.NORAD_CAT_ID),
    },
  };
}

export function getCelestrakUrl(group: string): string {
  const entry = CELESTRAK_GROUP_INDEX.get(group);
  const urlGroup = entry?.urlGroup ?? group;
  return `https://celestrak.org/NORAD/elements/gp.php?GROUP=${urlGroup}&FORMAT=json`;
}

export function satellitesToToml(list: SatelliteSpec[]): string {
  return list
    .map((s) => {
      const meta = s.meta
        ? ((s.meta.objectName ? `name = ${JSON.stringify(s.meta.objectName)}\n` : "") +
            (s.meta.objectId ? `objectId = ${JSON.stringify(s.meta.objectId)}\n` : "") +
            (s.meta.noradCatId !== undefined ? `noradCatId = ${s.meta.noradCatId}\n` : ""))
        : "";
      if (s.type === "tle") {
        return (
          "[[satellites]]\n" +
          'type = "tle"\n' +
          meta +
          `line1 = ${JSON.stringify(s.lines[0])}\n` +
          `line2 = ${JSON.stringify(s.lines[1])}`
        );
      }
      const e = s.elements;
      return (
        "[[satellites]]\n" +
        'type = "elements"\n' +
        meta +
        `satnum = ${e.satnum}\n` +
        `epoch = ${JSON.stringify(e.epoch.toISOString())}\n` +
        `semiMajorAxisKm = ${e.semiMajorAxisKm}\n` +
        `eccentricity = ${e.eccentricity}\n` +
        `inclinationDeg = ${e.inclinationDeg}\n` +
        `raanDeg = ${e.raanDeg}\n` +
        `argPerigeeDeg = ${e.argPerigeeDeg}\n` +
        `meanAnomalyDeg = ${e.meanAnomalyDeg}`
      );
    })
    .join("\n\n");
}
