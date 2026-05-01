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

export const CELESTRAK_GROUP_URLS = Object.fromEntries(
  Array.from(CELESTRAK_GROUP_INDEX.entries()).map(([id, entry]) => [id, entry.urlGroup]),
) as Record<string, string>;

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

import { readCachedGroup, writeCachedGroup } from "./celestrakCache";

export interface CelestrakFetchResult {
  /** Parsed entries; undefined when neither network nor cache yielded data. */
  data?: CelestrakEntry[];
  /** Human-readable note to surface to the user (errors, cache fallback). */
  note?: string;
}

/**
 * Fetch orbital data for a single CelesTrak group. On HTTP / network failure
 * we transparently fall back to the IndexedDB cache populated by previous
 * successful fetches; the user is notified via the `note` field instead of an
 * exception.
 */
export async function fetchCelestrakGroup(group: string): Promise<CelestrakFetchResult> {
  const url = getCelestrakUrl(group);
  try {
    const resp = await fetch(url);
    const text = await resp.text();

    if (resp.ok && !text.startsWith("Invalid query:") && !text.startsWith("Error:")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { note: `「${group}」: JSON 応答が不正です` };
      }
      if (!Array.isArray(parsed)) {
        return { note: `「${group}」: 応答が配列ではありません (${typeof parsed})` };
      }
      const data = parsed as CelestrakEntry[];
      await writeCachedGroup(group, data);
      return { data };
    }

    // Either non-OK status or an error body. Try cache as fallback.
    const reason = describeFailure(resp.status, text);
    const cached = await readCachedGroup(group);
    if (cached) {
      return {
        data: cached.data,
        note: `「${group}」: ${reason}。前回保存（${new Date(cached.fetchedAt).toLocaleString()}）のキャッシュを使用しました。`,
      };
    }
    return { note: `「${group}」: ${reason}` };
  } catch (e) {
    const cached = await readCachedGroup(group);
    if (cached) {
      return {
        data: cached.data,
        note: `「${group}」: 通信に失敗しました（${(e as Error).message}）。前回保存（${new Date(cached.fetchedAt).toLocaleString()}）のキャッシュを使用しました。`,
      };
    }
    return { note: `「${group}」: 通信に失敗しました（${(e as Error).message}）` };
  }
}

function describeFailure(status: number, body: string): string {
  if (status === 403 && /has not updated/i.test(body)) {
    return "CelesTrak 側のデータが前回取得以降更新されていないためダウンロードを拒否されました（同一グループは 2 時間に 1 回まで）";
  }
  if (status === 403) {
    return `CelesTrak から 403 が返されました（短時間に同じグループへ繰り返しアクセスしている可能性があります）`;
  }
  if (status === 429) {
    return "CelesTrak のレート制限に達しました（HTTP 429）";
  }
  if (status === 200) {
    return body.trim().slice(0, 200);
  }
  return `HTTP ${status}\n${body.trim().slice(0, 200)}`;
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
