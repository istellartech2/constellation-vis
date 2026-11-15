import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  chapterIndexAt,
  chapterProgress,
  chapterSpeedAt,
  demoIdFromSearch,
  formatTourClock,
  loadTourDefinition,
  nextTourStep,
  parseDemoIndex,
  parseTourDefinition,
  resolveTour,
  resolveTourTime,
} from "../src/lib/tour/parse";
import { loadTour, resolveAssetUrl } from "../src/lib/tour/load";
import { tourTelemetryAt } from "../src/lib/tour/telemetry";
import { parseTrajectoryFile, toTrajectoryTrack } from "../src/lib/trajectory/parse";
import type { ResolvedTour, TourDefinition } from "../src/lib/tour/types";

const ROOT = join(import.meta.dir, "..");
const EPOCH_MS = Date.UTC(2026, 10, 13, 22, 47, 36);

function ok<T>(r: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.value;
}
function err(r: { ok: boolean; error?: string }): string {
  if (r.ok) throw new Error("expected an error");
  return r.error ?? "";
}

function baseTour(): TourDefinition {
  return {
    id: "demo",
    title: "Demo",
    tracks: [
      { key: "a", url: "a.csv" },
      { key: "b", url: "b.csv", label: "B" },
    ],
    chapters: [
      { id: "c1", title: "One", caption: "", start: "T-00:00:10", end: "T+00:01:00", speed: 1, camera: { type: "follow", track: "a" }, telemetry: ["a", "b"] },
      {
        id: "c2",
        title: "Two",
        caption: "",
        start: "T+00:01:00",
        end: "T+00:03:00",
        speed: 10,
        speedChanges: [{ at: "T+00:02:30", speed: 1 }],
        camera: { type: "overview", track: "b" },
      },
      { id: "c3", title: "Three", caption: "", start: "T+00:05:00", end: "T+01:00:00", speed: 3000, camera: { type: "globe" } },
    ],
  };
}

function resolved(): ResolvedTour {
  return ok(resolveTour(ok(parseTourDefinition(baseTour())), EPOCH_MS));
}

describe("resolveTourTime", () => {
  it("reads T± clock times relative to the epoch", () => {
    expect(resolveTourTime("T+00:00:00", EPOCH_MS)).toBe(EPOCH_MS);
    expect(resolveTourTime("T-00:00:10", EPOCH_MS)).toBe(EPOCH_MS - 10_000);
    expect(resolveTourTime("T−00:00:10", EPOCH_MS)).toBe(EPOCH_MS - 10_000);
    expect(resolveTourTime("T+22:32:28", EPOCH_MS)).toBe(EPOCH_MS + (22 * 3600 + 32 * 60 + 28) * 1000);
    expect(resolveTourTime("T+06:35", EPOCH_MS)).toBe(EPOCH_MS + 395_000);
    expect(resolveTourTime("T+00:00:01.5", EPOCH_MS)).toBe(EPOCH_MS + 1500);
  });
  it("reads numbers as seconds and ISO strings as UTC", () => {
    expect(resolveTourTime(141, EPOCH_MS)).toBe(EPOCH_MS + 141_000);
    expect(resolveTourTime("2026-11-13T22:47:46Z", EPOCH_MS)).toBe(EPOCH_MS + 10_000);
    expect(resolveTourTime("2026-11-13T22:47:46", EPOCH_MS)).toBe(EPOCH_MS + 10_000);
  });
  it("rejects malformed times", () => {
    expect(resolveTourTime("T+00:61:00", EPOCH_MS)).toBeNaN();
    expect(resolveTourTime("T+00:00:60", EPOCH_MS)).toBeNaN();
    expect(resolveTourTime("soon", EPOCH_MS)).toBeNaN();
  });
});

describe("parseTourDefinition", () => {
  it("accepts a valid tour", () => {
    const def = ok(parseTourDefinition(baseTour()));
    expect(def.tracks[1].label).toBe("B");
    expect(def.chapters[2].camera).toEqual({ type: "globe" });
  });
  it("rejects unknown track references", () => {
    const t = baseTour();
    t.chapters[0].camera = { type: "follow", track: "nope" };
    expect(err(parseTourDefinition(t))).toContain("nope");
    const u = baseTour();
    u.chapters[0].telemetry = ["zzz"];
    expect(err(parseTourDefinition(u))).toContain("zzz");
  });
  it("rejects bad cameras, speeds and duplicates", () => {
    const t = baseTour();
    (t.chapters[0] as unknown as Record<string, unknown>).camera = { type: "follow" };
    expect(err(parseTourDefinition(t))).toContain("track");
    const s = baseTour();
    s.chapters[0].speed = 0;
    expect(err(parseTourDefinition(s))).toContain("speed");
    const d = baseTour();
    d.chapters[1].id = "c1";
    expect(err(parseTourDefinition(d))).toContain("重複");
    const k = baseTour();
    k.tracks[1].key = "a";
    expect(err(parseTourDefinition(k))).toContain("重複");
    expect(err(parseTourDefinition(null))).toBeTruthy();
    const g = baseTour();
    g.chapters[2].camera = { type: "globe", distance: 0.5 };
    expect(err(parseTourDefinition(g))).toContain("distance");
  });
});

describe("resolveTour", () => {
  it("resolves chapter times and speed changes", () => {
    const tour = resolved();
    expect(tour.epochMs).toBe(EPOCH_MS);
    expect(tour.chapters[0].startMs).toBe(EPOCH_MS - 10_000);
    expect(tour.chapters[1].speedChanges).toEqual([{ atMs: EPOCH_MS + 150_000, speed: 1 }]);
    expect(tour.chapters[2].telemetry).toEqual([]);
  });
  it("prefers an explicit epoch", () => {
    const t = { ...baseTour(), epoch: "2026-11-13T22:47:46Z" };
    expect(ok(resolveTour(ok(parseTourDefinition(t)), EPOCH_MS)).epochMs).toBe(EPOCH_MS + 10_000);
  });
  it("needs an epoch", () => {
    expect(err(resolveTour(ok(parseTourDefinition(baseTour())), undefined))).toContain("epoch");
  });
  it("rejects overlapping, empty and out-of-range chapters", () => {
    const o = baseTour();
    o.chapters[1].start = "T+00:00:30";
    expect(err(loadTourDefinition(o, EPOCH_MS))).toContain("重なって");
    const e = baseTour();
    e.chapters[0].end = "T-00:00:10";
    expect(err(loadTourDefinition(e, EPOCH_MS))).toContain("end");
    const s = baseTour();
    s.chapters[1].speedChanges = [{ at: "T+00:04:00", speed: 1 }];
    expect(err(loadTourDefinition(s, EPOCH_MS))).toContain("speedChanges");
  });
});

describe("chapter bookkeeping", () => {
  const tour = resolved();
  const [c1, c2, c3] = tour.chapters;

  it("finds the chapter at a time", () => {
    expect(chapterIndexAt(tour.chapters, c1.startMs - 60_000)).toBe(0);
    expect(chapterIndexAt(tour.chapters, c1.startMs)).toBe(0);
    expect(chapterIndexAt(tour.chapters, c2.startMs)).toBe(1);
    expect(chapterIndexAt(tour.chapters, c2.endMs + 1000)).toBe(1); // in the gap
    expect(chapterIndexAt(tour.chapters, c3.startMs + 1)).toBe(2);
    expect(chapterIndexAt(tour.chapters, c3.endMs + 1e9)).toBe(2);
  });

  it("applies speed changes", () => {
    expect(chapterSpeedAt(c2, c2.startMs)).toBe(10);
    expect(chapterSpeedAt(c2, EPOCH_MS + 149_999)).toBe(10);
    expect(chapterSpeedAt(c2, EPOCH_MS + 150_000)).toBe(1);
  });

  it("advances without a seek across contiguous boundaries", () => {
    expect(nextTourStep(tour, 0, c1.endMs - 1)).toEqual({ kind: "stay" });
    expect(nextTourStep(tour, 0, c1.endMs + 16)).toEqual({ kind: "advance", index: 1, seekMs: null });
  });

  it("re-seeks after a large overshoot and into gaps, one chapter at a time", () => {
    expect(nextTourStep(tour, 0, c1.endMs + 60_000)).toEqual({ kind: "advance", index: 1, seekMs: c2.startMs });
    // c2 ends at 3:00, c3 starts at 5:00: gap → seek to c3's start.
    expect(nextTourStep(tour, 1, c2.endMs)).toEqual({ kind: "advance", index: 2, seekMs: c3.startMs });
    // A jump far past several chapters still advances only to the next one.
    expect(nextTourStep(tour, 0, c3.startMs + 10_000)).toEqual({ kind: "advance", index: 1, seekMs: c2.startMs });
  });

  it("finishes after the last chapter", () => {
    expect(nextTourStep(tour, 2, c3.endMs - 1)).toEqual({ kind: "stay" });
    expect(nextTourStep(tour, 2, c3.endMs)).toEqual({ kind: "finish" });
  });

  it("reports progress", () => {
    expect(chapterProgress(c2, c2.startMs)).toBe(0);
    expect(chapterProgress(c2, (c2.startMs + c2.endMs) / 2)).toBeCloseTo(0.5);
    expect(chapterProgress(c2, c2.endMs + 5)).toBe(1);
  });
});

describe("formatting and entry points", () => {
  it("formats the T± clock", () => {
    expect(formatTourClock(0)).toBe("T+00:00:00");
    expect(formatTourClock(-10_000)).toBe("T−00:00:10");
    expect(formatTourClock((22 * 3600 + 32 * 60 + 28) * 1000 + 999)).toBe("T+22:32:28");
  });
  it("reads ?demo= ids defensively", () => {
    expect(demoIdFromSearch("?demo=flight15")).toBe("flight15");
    expect(demoIdFromSearch("?x=1")).toBeNull();
    expect(demoIdFromSearch("?demo=../../etc")).toBeNull();
  });
  it("parses the demo index, dropping bad entries", () => {
    expect(
      parseDemoIndex({ demos: [{ id: "ok", title: "OK", tour: "demos/ok/tour.json" }, { id: "bad id", title: "x", tour: "y" }, { id: "nt" }] }),
    ).toEqual([{ id: "ok", title: "OK", tour: "demos/ok/tour.json" }]);
    expect(parseDemoIndex(null)).toEqual([]);
  });
  it("resolves asset URLs against the base URL", () => {
    expect(resolveAssetUrl("demos/a.csv", "/")).toBe("/demos/a.csv");
    expect(resolveAssetUrl("demos/a.csv", "/app")).toBe("/app/demos/a.csv");
    expect(resolveAssetUrl("https://x.test/a.csv", "/app/")).toBe("https://x.test/a.csv");
  });
});

describe("telemetry", () => {
  const text = readFileSync(join(ROOT, "docs/examples/trajectory-sample-booster.csv"), "utf8");
  const parsed = parseTrajectoryFile(text, "booster.csv");
  if (!parsed.ok) throw new Error(parsed.error);
  const track = toTrajectoryTrack(parsed.track, 0);
  const first = track.samples[0].timeMs;
  const last = track.samples[track.samples.length - 1].timeMs;

  it("holds the pad state before lift-off with a T− clock", () => {
    const t = tourTelemetryAt(track, first - 10_000)!;
    expect(t.phase).toBe("before");
    expect(t.clock).toBe("T−00:00:10");
    expect(t.speedKmh).toBe(0);
    expect(t.altKm).toBeCloseTo(0, 3);
  });
  it("reports speed and altitude in flight", () => {
    const t = tourTelemetryAt(track, first + 120_000)!;
    expect(t.phase).toBe("active");
    expect(t.clock).toBe("T+00:02:00");
    expect(t.speedKmh).toBeGreaterThan(1000);
    expect(t.altKm).toBeGreaterThan(20);
  });
  it("flags the end of the track", () => {
    expect(tourTelemetryAt(track, last + 1000)!.phase).toBe("after");
  });
});

describe("loadTour", () => {
  const files: Record<string, string> = {
    "/demos/t/tour.json": JSON.stringify({
      ...baseTour(),
      tracks: [
        { key: "a", url: "demos/t/booster.csv", label: "BOOSTER" },
        { key: "b", url: "demos/t/ship.csv", color: "#ff0000" },
      ],
    }),
    "/demos/t/booster.csv": readFileSync(join(ROOT, "docs/examples/trajectory-sample-booster.csv"), "utf8"),
    "/demos/t/ship.csv": readFileSync(join(ROOT, "docs/examples/trajectory-sample-ship.csv"), "utf8"),
  };
  const fakeFetch = async (url: string) =>
    files[url] !== undefined ? new Response(files[url]) : new Response("not found", { status: 404 });

  it("loads the tour and its tracks, taking the epoch from the first track", async () => {
    const loaded = await loadTour("demos/t/tour.json", "/", fakeFetch);
    expect(loaded.tour.epochMs).toBe(loaded.tracks.a.epochMs!);
    expect(loaded.tracks.a.id).not.toBe(loaded.tracks.b.id);
    expect(loaded.tracks.b.color).toBe("#ff0000");
    expect(loaded.tracks.a.model).toBe("starship-v3-booster");
  });

  it("reports missing files", async () => {
    await expect(loadTour("demos/missing.json", "/", fakeFetch)).rejects.toThrow("404");
  });
});

describe("public/demos", () => {
  const index = parseDemoIndex(JSON.parse(readFileSync(join(ROOT, "public/demos/index.json"), "utf8")));

  it("lists flight15", () => {
    expect(index.map((d) => d.id)).toContain("flight15");
  });

  for (const demo of index) {
    it(`${demo.id}: tour.json is valid, ordered and contiguous`, () => {
      const raw = JSON.parse(readFileSync(join(ROOT, "public", demo.tour), "utf8"));
      const tour = ok(loadTourDefinition(raw, EPOCH_MS));
      expect(tour.id).toBe(demo.id);
      for (let i = 1; i < tour.chapters.length; i++) {
        expect(tour.chapters[i].startMs).toBe(tour.chapters[i - 1].endMs);
      }
      for (const c of tour.chapters) {
        expect(c.caption.length).toBeGreaterThan(0);
        expect(c.telemetry.length).toBeGreaterThan(0);
      }
    });
  }

  it("flight15 chapters cover lift-off to the tower catch", () => {
    const raw = JSON.parse(readFileSync(join(ROOT, "public/demos/flight15/tour.json"), "utf8"));
    const tour = ok(loadTourDefinition(raw, EPOCH_MS));
    const first = tour.chapters[0];
    const last = tour.chapters[tour.chapters.length - 1];
    expect(first.startMs).toBeLessThan(EPOCH_MS);
    // Catch at T+22:32:28 falls inside the last chapter.
    const catchMs = EPOCH_MS + (22 * 3600 + 32 * 60 + 28) * 1000;
    expect(last.startMs).toBeLessThan(catchMs);
    expect(last.endMs).toBeGreaterThan(catchMs);
    expect(tour.disclaimer).toContain("推定");
  });
});
