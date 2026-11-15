# Guided tours (presentation mode)

A guided tour replays one or more [trajectory tracks](trajectory-layer.md) as
a narrated sequence of chapters. Each chapter is a time window with a caption,
a playback speed and a camera. While a tour runs the app is in presentation
mode. The side panel, playback bar, satellite card and ISL HUD are hidden, and
a full-screen overlay shows:

- the title and a persistent disclaimer;
- a webcast-style telemetry HUD (T± clock, speed, altitude);
- the chapter caption with a progress bar;
- chapter navigation (previous / play-pause / next, one dot per chapter).

The first use is the Starship Flight 15 demo (`public/demos/flight15/`, see
[demos/flight15.md](demos/flight15.md)). The format is generic and works for
satellite or launch demos too.

Code: `src/lib/tour/` (`types.ts`, `parse.ts` validation and time logic,
`load.ts` fetching, `telemetry.ts`) and `src/components/tour/`
(`useGuidedTour.ts` controller, `TourPlayer.tsx` overlay, `DemoSection.tsx`).
Tests: `tests/tour.test.ts`. The tests also validate every tour listed in
`public/demos/index.json`.

## Entry points

- **URL:** `?demo=<id>` starts the tour automatically once the globe and the
  ground-station list have loaded. The id is looked up in
  `public/demos/index.json`; URLs are never built from the query string.
  終了 removes the parameter, so a reload does not restart the tour.
- **表示 tab → 「デモ」:** lists `public/demos/index.json` with a 「再生」
  button. The section is hidden when the index is missing or empty.

```json
{
  "demos": [
    {
      "id": "flight15",
      "title": "スターシップ 第15回飛行（再現）",
      "description": "…",
      "tour": "demos/flight15/tour.json"
    }
  ]
}
```

Ids are `[A-Za-z0-9_-]{1,64}`. The `tour` URL is relative to the app's base
URL. Invalid entries are dropped.

## Tour JSON

```json
{
  "id": "flight15",
  "title": "スターシップ 第15回飛行",
  "subtitle": "2026年11月13日 打上げ",
  "disclaimer": "公開情報からの推定再現（非公式）",
  "epoch": "2026-11-13T22:47:36Z",
  "tracks": [
    { "key": "booster", "url": "demos/flight15/booster.csv", "label": "BOOSTER" },
    { "key": "ship", "url": "demos/flight15/ship.csv", "label": "SHIP" }
  ],
  "chapters": [
    {
      "id": "max-q",
      "title": "最大動圧と上昇",
      "caption": "Two or three plain sentences.",
      "start": "T+00:01:10",
      "end": "T+00:02:15",
      "speed": 10,
      "speedChanges": [{ "at": "T+00:02:05", "speed": 1 }],
      "camera": { "type": "follow", "track": "booster" },
      "telemetry": ["booster", "ship"]
    }
  ],
  "ending": { "title": "飛行完了", "caption": "Summary; \n starts a new line." },
  "sources": [{ "label": "Wikipedia", "url": "https://…" }]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | `[A-Za-z0-9_-]`; should match the index entry. |
| `title`, `subtitle` | title | Shown top-left. |
| `disclaimer` | no | Persistent notice (always visible). Use it whenever the data is reconstructed or estimated. |
| `epoch` | no | T0 (ISO UTC). Default: the first track's `# epoch:`. |
| `tracks[]` | yes (≥1) | `key` (unique, `[A-Za-z0-9_-]`), `url` (relative to the base URL, or absolute), optional `label` (HUD; default `KEY`), `model` (overrides `# model:`), `color`. |
| `chapters[]` | yes (≥1) | See below. |
| `ending` | no | End card `{ title, caption }` shown after the last chapter. |
| `sources` | no | `[{ label, url }]`, linked on the end card. |

Each track file is any format the trajectory layer reads (CSV/TSV with
`# epoch:`, `# model:`, `# event:`, `# attitude:` and `# mount:` headers, or
CCSDS OEM). The parser is `parseTrajectoryFile`. Track ids are generated per
load, as `tour-<id>-<key>-<nonce>`.

### Chapters

| Field | Meaning |
| --- | --- |
| `id`, `title`, `caption` | Unique id; the title and the caption shown in the card. Write captions for the general public: 2–3 short sentences, with jargon explained in parentheses. |
| `start`, `end` | A tour time (see below), with `start < end`. Chapters must be in order and must not overlap. Gaps are allowed, and the player seeks across them. |
| `speed` | × real time at the chapter start, `0 < speed ≤ 100000`. It may exceed the playback bar's 600× maximum. |
| `speedChanges` | Optional `[{ at, speed }]`, strictly inside the chapter (e.g. slow down before an event). |
| `camera` | See below. |
| `telemetry` | Track keys shown in the HUD (left / right of the clock). |

**Tour times:** `"T+hh:mm:ss[.sss]"`, `"T-hh:mm:ss"` (a `−` minus sign also
works) or `"T+mm:ss"`, relative to the tour epoch; a number of seconds
relative to the epoch; or an ISO-8601 UTC timestamp. A timestamp without a
zone designator is UTC.

**Cameras:**

- `{ "type": "follow", "track": "ship" }` rides with the track (the existing
  追従 camera: side-on, Earth-fixed, and the viewer can orbit and zoom).
  Before the track starts, the camera holds on the first sample (the pad).
- `{ "type": "overview", "track": "ship" }` looks straight down at the
  track's current position from close range. This is a single framing; the
  camera does not follow.
- `{ "type": "globe", "track": "ship", "distance": 2, "chase": true }` is a
  whole-Earth view looking at the track. `distance` is measured from the
  Earth's centre in Earth radii (1.05–30). The default fits the globe to the
  screen.
  - With a track, `chase` (default `true`) turns the camera about the Earth
    each frame, smoothed over about 0.5 s, so the track stays centred. The
    viewer's zoom is kept.
  - Set `"chase": false` when the track laps the Earth in seconds (e.g.
    3000×). The camera then only starts out looking at the track.
  - Without a track, the camera keeps its current direction.

## Player behaviour

- **Start:** the tour fetches the tour JSON and every track. It then replaces
  the trajectory list with the tour's tracks, switches to the free camera and
  applies chapter 1 (seek to its start, speed, camera).
- **Clock:** a requestAnimationFrame loop reads the scene's sim time each
  frame (`SatelliteScene.getSimulationTime()`). App's `simTime` state updates
  only once per sim second.
  - **Auto-advance:** when the sim time reaches the chapter's `end`, the tour
    moves to the next chapter, one chapter at a time. It seeks to the next
    chapter's `start` only when there is a gap, or when the frame overshot by
    more than 1 s (fast chapters step tens of seconds per frame).
  - **End:** after the last chapter the tour pauses and shows the end card.
    Play then restarts the tour from chapter 1.
  - **Scene rebuild:** a rebuild (e.g. the initial ground-station list
    arriving) restarts the clock at the scenario start. The loop detects the
    new scene instance, seeks back to the tour time and re-applies the chapter
    camera.
- **Speed:** App's `tourSpeed` overrides `10^speedExp` in the `speedRef`
  effect. The persisted speed setting is untouched.
- **Camera:** `seekTo`, `setTrajectoryFollow`, `focusTrajectory`, and the
  tour-only scene methods `frameGlobe(id, distance)` and `setGlobeChase(id)`.
  While a tour runs, camera changes are not persisted (`saveLastView` and
  `cameraSnapshotRef` are gated).
- **Controls:** previous / next jump to a chapter's start (paused stays
  paused). Each dot jumps to its chapter, and the caption can be collapsed.
  Keys: Space play/pause, ← / → chapters, Esc ends the tour.
- **終了** restores the trajectory list, the follow target, the camera mode
  and framing, the pause state, the speed (override removed) and the sim time
  from before the tour. The side panel reopens if it was open.

## Telemetry HUD

Each `telemetry` key gets a block with its label, speed (km/h) and altitude
(km). These are interpolated from the track (`trajectoryStateAt`, cubic
Hermite). The speed is **Earth-relative**, i.e. the ECEF velocity norm. In
orbit it is roughly 0.4 km/s lower than the inertial speed, depending on the
inclination. Before a track's first sample the HUD shows the pad state with
zero speed. After its last sample it shows 「飛行終了」. The centre clock is
T± relative to the tour epoch. For reconstructed data the values are only as
good as the reconstruction; the clock block is labelled 「推定値」.

## Adding a demo

1. Put the track files and `tour.json` under `public/demos/<id>/`.
2. Add an entry to `public/demos/index.json`.
3. Run `bun test tests/tour.test.ts`. It validates the JSON, checks that the
   chapters are contiguous and that every chapter has a caption and
   telemetry. Gaps are allowed by the format but flagged by this test; relax
   it for a tour that needs gaps.
4. Open `/?demo=<id>` to check the pacing. A rough real-time length per
   chapter is `(end − start) / speed`.
