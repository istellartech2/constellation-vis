import type { SatelliteSpec } from "../lib/satellites";

const MU = 398600.4418; // km^3/s^2

export interface CelestrakGroupNode {
  id: string;
  label: string;
  urlGroup?: string;
  /** "gp" (default) uses gp.php?GROUP=; "supplemental" uses supplemental/sup-gp.php?FILE=. */
  source?: "gp" | "supplemental";
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
      { id: "eutelsat", label: "Eutelsat" },
      { id: "telesat", label: "Telesat" },
      { id: "hulianwang", label: "Hulianwang Digui" },
      { id: "qianfan", label: "Qianfan" },
      { id: "kuiper", label: "Kuiper" },
      { id: "iridium", label: "Iridium NEXT", urlGroup: "iridium-NEXT" },
      { id: "orbcomm", label: "Orbcomm" },
      { id: "kineis", label: "Kineis (ARGOS DCS)", urlGroup: "argos" },
      { id: "globalstar", label: "Globalstar" },
      { id: "amateur", label: "Amateur Radio" },
      {
        id: "ast-spacemobile",
        label: "AST SpaceMobile",
        urlGroup: "ast",
        source: "supplemental",
      },
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
  source: "gp" | "supplemental";
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
        source: node.source ?? "gp",
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

const ORBIT_NUMERIC_FIELDS = [
  "MEAN_MOTION", "ECCENTRICITY", "INCLINATION", "RA_OF_ASC_NODE",
  "ARG_OF_PERICENTER", "MEAN_ANOMALY", "NORAD_CAT_ID",
] as const;

export function celestrakEntryToSat(entry: CelestrakEntry): Extract<SatelliteSpec, { type: "elements" }> {
  if (!entry || typeof entry !== "object") throw new Error("衛星データが不正です");
  for (const field of ORBIT_NUMERIC_FIELDS) {
    const value = entry[field];
    if (
      (typeof value !== "number" && typeof value !== "string") ||
      String(value).trim() === "" || !Number.isFinite(Number(value))
    ) {
      throw new Error(`${field} が不正です`);
    }
  }
  const mm = Number(entry.MEAN_MOTION);
  if (
    mm <= 0 || Number(entry.ECCENTRICITY) < 0 || Number(entry.ECCENTRICITY) >= 1 ||
    Number(entry.INCLINATION) < 0 || Number(entry.INCLINATION) > 180 ||
    !Number.isInteger(Number(entry.NORAD_CAT_ID)) ||
    Number(entry.NORAD_CAT_ID) < 1 || Number(entry.NORAD_CAT_ID) > 999999999
  ) {
    throw new Error("軌道要素または衛星番号が範囲外です");
  }
  // CelesTrak omits the zone suffix, but its OMM epochs are always UTC.
  const epochText = typeof entry.EPOCH === "string" ? entry.EPOCH.trim() : "";
  const epoch = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(epochText) ? epochText : `${epochText}Z`);
  if (!epochText || !Number.isFinite(epoch.getTime())) throw new Error("EPOCH が不正です");
  const n = (mm * 2 * Math.PI) / 86400; // rad/s
  const a = Math.pow(MU / (n * n), 1 / 3);
  return {
    type: "elements",
    elements: {
      satnum: Number(entry.NORAD_CAT_ID),
      epoch,
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
  const urlGroup = encodeURIComponent(entry?.urlGroup ?? group);
  if (entry?.source === "supplemental") {
    return `https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=${urlGroup}&FORMAT=json`;
  }
  return `https://celestrak.org/NORAD/elements/gp.php?GROUP=${urlGroup}&FORMAT=json`;
}

import { readCachedGroup, writeCachedGroup } from "./celestrakCache";

export interface CelestrakFetchResult {
  /** Parsed entries; undefined when neither network nor cache yielded data. */
  data?: CelestrakEntry[];
  /** Human-readable note to surface to the user (errors, cache fallback). */
  note?: string;
}

const CACHE_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const pendingGroups = new Map<string, Promise<CelestrakFetchResult>>();

/**
 * Fetch orbital data for a single CelesTrak group. On HTTP / network failure
 * we transparently fall back to the IndexedDB cache populated by previous
 * successful fetches; the user is notified via the `note` field instead of an
 * exception.
 */
export async function fetchCelestrakGroup(group: string): Promise<CelestrakFetchResult> {
  const pending = pendingGroups.get(group);
  if (pending) return pending;
  const request = fetchGroup(group);
  pendingGroups.set(group, request);
  try {
    return await request;
  } finally {
    pendingGroups.delete(group);
  }
}

async function fetchGroup(group: string): Promise<CelestrakFetchResult> {
  const url = getCelestrakUrl(group);
  const cached = await readCachedGroup(group);
  const age = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;
  if (cached && age >= 0 && age < CACHE_MAX_AGE_MS) {
    return { data: cached.data, note: `「${group}」: 保存済みデータ（${new Date(cached.fetchedAt).toLocaleString()}）を使用しました。CelesTrak の更新間隔に合わせ、2 時間以内の再取得を省略します。` };
  }
  const failure = (reason: string): CelestrakFetchResult => cached
    ? { data: cached.data, note: `「${group}」: ${reason}。前回保存（${new Date(cached.fetchedAt).toLocaleString()}）のキャッシュを使用しました。` }
    : { note: `「${group}」: ${reason}` };
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const text = (await resp.text()).trim();

    if (resp.ok && !text.startsWith("Invalid query:") && !text.startsWith("Error:")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return failure(text === "No GP data found" || text === "No SupGP data found"
          ? "現在配信されている軌道データがありません"
          : "JSON 応答が不正です");
      }
      if (!Array.isArray(parsed)) {
        return failure(`応答が配列ではありません (${typeof parsed})`);
      }
      if (parsed.length === 0) return failure("現在配信されている軌道データがありません");
      const data = parsed.filter((entry) => {
        try {
          celestrakEntryToSat(entry);
          return true;
        } catch {
          return false;
        }
      }) as CelestrakEntry[];
      if (data.length === 0) return failure("有効な軌道データがありません");
      await writeCachedGroup(group, data);
      return {
        data,
        ...(data.length < parsed.length
          ? { note: `「${group}」: 不正な衛星データ ${parsed.length - data.length} 件を除外しました。` }
          : {}),
      };
    }

    // Either non-OK status or an error body. Try cache as fallback.
    return failure(describeFailure(resp.status, text));
  } catch (e) {
    return failure(`通信に失敗しました（${(e as Error).message}）`);
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
  if (status === 404) return "指定したデータの配信先が見つかりません（HTTP 404）";
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

/** Update known catalog IDs in place; overlapping groups must not add duplicates. */
export function mergeImportedSatellites(base: SatelliteSpec[], imported: SatelliteSpec[]): SatelliteSpec[] {
  const merged = [...base];
  const catalogId = (sat: SatelliteSpec): number => sat.meta?.noradCatId ??
    (sat.type === "elements" ? sat.elements.satnum : Number(sat.lines[0].slice(2, 7)));
  const indices = new Map<number, number>();
  merged.forEach((sat, index) => {
    const id = catalogId(sat);
    if (Number.isInteger(id) && id > 0) indices.set(id, index);
  });
  for (const sat of imported) {
    const id = catalogId(sat);
    const index = indices.get(id);
    if (index === undefined) {
      indices.set(id, merged.length);
      merged.push(sat);
    } else {
      const previous = merged[index];
      if (sat.type === "elements" && previous.type === "elements" && previous.elements.epoch > sat.elements.epoch) continue;
      merged[index] = sat;
    }
  }
  return merged;
}
