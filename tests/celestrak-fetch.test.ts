import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as satellite from "satellite.js";
import { toSatrec } from "../src/lib/satellites";
import { parseSatellitesToml } from "../src/lib/tomlParsers";
import { writeCachedGroup } from "../src/utils/celestrakCache";
import { celestrakEntryToSat, fetchCelestrakGroup, getCelestrakUrl, mergeImportedSatellites, satellitesToToml, type CelestrakEntry } from "../src/utils/celestrakUtils";

const entry: CelestrakEntry = {
  OBJECT_NAME: "SPACEMOBILE-013", OBJECT_ID: "2026-179A", NORAD_CAT_ID: 100240,
  EPOCH: "2026-10-01T23:10:58.999987", MEAN_MOTION: 15.1316623,
  ECCENTRICITY: 0.0006901, INCLINATION: 52.9956, RA_OF_ASC_NODE: 66.2329,
  ARG_OF_PERICENTER: 136.1953, MEAN_ANOMALY: 114.1468,
};
const originalFetch = global.fetch;
let sequence = 0;
const group = () => `fetch-regression-${sequence++}`;
const respond = (body: string, status = 200) => {
  const fn = mock(async () => new Response(body, { status }));
  global.fetch = fn as unknown as typeof fetch;
  return fn;
};
afterEach(() => { global.fetch = originalFetch; mock.restore(); });

describe("CelesTrak downloads", () => {
  it("uses downloads for two hours even without IndexedDB", async () => {
    const id = group();
    const fetch = respond(JSON.stringify([entry]));
    expect((await fetchCelestrakGroup(id)).data).toEqual([entry]);
    expect((await fetchCelestrakGroup(id)).note).toContain("2 時間以内");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shares concurrent requests", async () => {
    const id = group();
    const fetch = respond(JSON.stringify([entry]));
    const results = await Promise.all([fetchCelestrakGroup(id), fetchCelestrakGroup(id)]);
    expect(results[0].data).toEqual(results[1].data);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  for (const [label, body, status] of [
    ["403", "data has not updated", 403],
    ["429", "Too Many Requests", 429],
    ["malformed JSON", "<html>unavailable</html>", 200],
    ["non-array JSON", "{}", 200],
    ["invalid entries", '[{"EPOCH":"invalid"}]', 200],
    ["empty data", "[]", 200],
  ] as const) {
    it(`falls back to an expired cache on ${label}`, async () => {
      const id = group();
      await writeCachedGroup(id, [entry]);
      spyOn(Date, "now").mockReturnValue(Date.now() + 2 * 60 * 60 * 1000 + 1000);
      const fetch = respond(body, status);
      const result = await fetchCelestrakGroup(id);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.data).toEqual([entry]);
      expect(result.note).toContain("前回保存");
    });
  }

  it("reports network failures and permits a later request", async () => {
    const id = group();
    global.fetch = mock(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect((await fetchCelestrakGroup(id)).note).toContain("offline");
    respond(JSON.stringify([entry]));
    expect((await fetchCelestrakGroup(id)).data).toEqual([entry]);
  });

  it("keeps valid records and reports rejected records", async () => {
    respond(JSON.stringify([null, {}, { ...entry, MEAN_MOTION: 0 }, entry]));
    const result = await fetchCelestrakGroup(group());
    expect(result.data).toEqual([entry]);
    expect(result.note).toContain("3 件");
  });

  it("reports unavailable data without a cache", async () => {
    respond("No GP data found");
    const result = await fetchCelestrakGroup(group());
    expect(result.data).toBeUndefined();
    expect(result.note).toContain("配信されている軌道データがありません");
  });
});

describe("CelesTrak orbital data", () => {
  it("interprets suffixless epochs as UTC and keeps explicit zones", () => {
    expect(celestrakEntryToSat(entry).elements.epoch.toISOString()).toBe("2026-10-01T23:10:58.999Z");
    expect(celestrakEntryToSat({ ...entry, EPOCH: "2026-10-01T16:10:58.999-07:00" }).elements.epoch.toISOString()).toBe("2026-10-01T23:10:58.999Z");
  });

  for (const norad of [100240, 799500001]) {
    it(`propagates catalog ID ${norad} after TOML serialization`, () => {
      const spec = celestrakEntryToSat({ ...entry, NORAD_CAT_ID: norad });
      const restored = parseSatellitesToml(satellitesToToml([spec]))[0];
      const rec = toSatrec(restored);
      const reference = satellite.json2satrec({ ...entry, NORAD_CAT_ID: norad,
        OBJECT_NAME: entry.OBJECT_NAME!, OBJECT_ID: entry.OBJECT_ID!,
        EPOCH: "2026-10-01T23:10:58.999", MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0,
        BSTAR: 0, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: "U", ELEMENT_SET_NO: 0, REV_AT_EPOCH: 0 });
      expect(rec.satnum).toBe(String(norad));
      expect(rec.jdsatepoch).toBeCloseTo(reference.jdsatepoch, 8);
      const date = new Date("2026-10-02T00:00:00Z");
      const actual = satellite.propagate(rec, date);
      const expected = satellite.propagate(reference, date);
      expect(actual).not.toBeNull();
      expect(actual!.position.x).toBeCloseTo(expected!.position.x, 6);
      expect(actual!.position.y).toBeCloseTo(expected!.position.y, 6);
      expect(actual!.position.z).toBeCloseTo(expected!.position.z, 6);
    });
  }

  it("updates existing satellites and merges overlapping groups without duplicates", () => {
    const old = celestrakEntryToSat({ ...entry, EPOCH: "2025-01-01T00:00:00" });
    const current = celestrakEntryToSat(entry);
    const other = celestrakEntryToSat({ ...entry, NORAD_CAT_ID: 25544 });
    const merged = mergeImportedSatellites([old, other], [current, current, other, old]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual(current);
    expect(merged[1]).toEqual(other);
    expect(old.elements.epoch.getUTCFullYear()).toBe(2025);
  });

  it("uses official supplemental and alias endpoints with an explicit format", () => {
    expect(getCelestrakUrl("ast-spacemobile")).toBe("https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=ast&FORMAT=json");
    expect(getCelestrakUrl("iridium")).toContain("GROUP=iridium-NEXT&FORMAT=json");
    expect(getCelestrakUrl("kineis")).toContain("GROUP=argos&FORMAT=json");
    expect(getCelestrakUrl("a&FORMAT=tle")).toContain("GROUP=a%26FORMAT%3Dtle&FORMAT=json");
  });
});
