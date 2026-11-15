/**
 * Fetch a guided tour: the tour JSON and every track file it references,
 * parsed with the trajectory layer's parser. URLs without a scheme are
 * resolved against `baseUrl` (the app's `import.meta.env.BASE_URL`).
 */
import { parseTrajectoryFile, toTrajectoryTrack } from "../trajectory/parse";
import type { TrajectoryTrack } from "../trajectory/types";
import { loadTourDefinition, parseDemoIndex, parseTourDefinition } from "./parse";
import type { DemoEntry, ResolvedTour } from "./types";

export interface LoadedTour {
  tour: ResolvedTour;
  /** Scene tracks by tour track key (ids are unique per load). */
  tracks: Record<string, TrajectoryTrack>;
  /** Non-fatal parser warnings, prefixed with the file name. */
  warnings: string[];
}

type Fetch = (url: string) => Promise<Response>;

export function resolveAssetUrl(url: string, baseUrl: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("/")) return url;
  return `${baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`}${url}`;
}

async function fetchText(url: string, fetchFn: Fetch): Promise<string> {
  const resp = await fetchFn(url);
  if (!resp.ok) throw new Error(`${url} を取得できません（${resp.status}）`);
  return resp.text();
}

/** `public/demos/index.json` (empty list when missing or malformed). */
export async function loadDemoIndex(baseUrl: string, fetchFn: Fetch = fetch): Promise<DemoEntry[]> {
  try {
    const text = await fetchText(resolveAssetUrl("demos/index.json", baseUrl), fetchFn);
    return parseDemoIndex(JSON.parse(text));
  } catch {
    return [];
  }
}

const fileNameOf = (url: string) => url.split(/[?#]/)[0].split("/").pop() || url;

/** Load a tour JSON and its tracks; throws an Error with a Japanese message on failure. */
export async function loadTour(tourUrl: string, baseUrl: string, fetchFn: Fetch = fetch): Promise<LoadedTour> {
  const url = resolveAssetUrl(tourUrl, baseUrl);
  let raw: unknown;
  try {
    raw = JSON.parse(await fetchText(url, fetchFn));
  } catch (err) {
    throw new Error(err instanceof SyntaxError ? `${fileNameOf(url)}: JSON として読めません` : (err as Error).message, {
      cause: err,
    });
  }
  const def = parseTourDefinition(raw);
  if (!def.ok) throw new Error(`${fileNameOf(url)}: ${def.error}`);

  const warnings: string[] = [];
  const tracks: Record<string, TrajectoryTrack> = {};
  let firstEpochMs: number | undefined;
  const loadId = Date.now().toString(36);
  for (const [i, ref] of def.value.tracks.entries()) {
    const trackUrl = resolveAssetUrl(ref.url, baseUrl);
    const name = fileNameOf(trackUrl);
    const text = await fetchText(trackUrl, fetchFn);
    const parsed = parseTrajectoryFile(text, name);
    if (!parsed.ok) throw new Error(`${name}: ${parsed.error}`);
    parsed.warnings.forEach((w) => warnings.push(`${name}: ${w}`));
    const base = toTrajectoryTrack(parsed.track, i);
    tracks[ref.key] = {
      ...base,
      id: `tour-${def.value.id}-${ref.key}-${loadId}`,
      ...(ref.model ? { model: ref.model } : {}),
      ...(ref.color ? { color: ref.color } : {}),
    };
    if (i === 0) firstEpochMs = parsed.track.epochMs;
  }

  const tour = loadTourDefinition(raw, firstEpochMs);
  if (!tour.ok) throw new Error(`${fileNameOf(url)}: ${tour.error}`);
  return { tour: tour.value, tracks, warnings };
}
