# Guided tours (presentation mode)

A guided tour replays one or more [trajectory tracks](trajectory-layer.md) as
a narrated sequence of chapters. Each chapter is a time window with a caption,
a playback speed and a camera. While a tour runs the app is in presentation
mode. The side panel, playback bar, satellite card and ISL HUD are hidden, and
a full-screen overlay keeps the middle of the screen clear for the 3D view
and shows, around the edges:

- top-left: the title and one notice line (the `disclaimer` plus the
  `telemetryNote`, e.g. 「公開情報からの推定再現（非公式） · 速度・高度は推定」;
  up to two lines on phones);
- top-right: 終了 and a compact telemetry HUD (T± clock, optional orbit
  counter, one line per vehicle with speed and altitude);
- bottom: the chapter caption card, collapsible to its one-line title, above
  a slim control bar (previous / play-pause / next, a scrubber over the
  current chapter with its T± time, the speed, one dot per chapter — the
  dots wrap to a second row on phones).

Measured at 1400×900 the overlay covers ~9 % of the viewport and none of the
central 60 % box (before this layout: ~14 % and ~8 %); at 375×812 with the
caption collapsed, ~22 % and none of the centre (before: ~41 % and ~28 %).

Everything that belongs to the scenario — editor satellites with their orbit
and ground-track lines and cones, display layers, ground stations, link and
ISL lines, KML overlays — is left out of the render and of picking (scene
param `presentation`), and the free camera uses the inertial (ECI) frame
whatever the 座標系 setting says. 終了 brings it all back.

The first use is the Starship Flight 15 demo (`public/demos/flight15/`, see
[demos/flight15.md](demos/flight15.md)). The format is generic and works for
satellite or launch demos too.

Code: `src/lib/tour/` (`types.ts`, `parse.ts` validation and time logic,
`load.ts` fetching, `telemetry.ts`) and `src/components/tour/`
(`useGuidedTour.ts` controller, `TourPlayer.tsx` overlay, `DemoSection.tsx`).
Tests: `tests/tour.test.ts`. The tests also validate every tour listed in
`public/demos/index.json`.

## Entry points

- **URL:** `?demo=<id>` loads the tour once the ground-station list has
  arrived and parks it on chapter 1, paused, behind a start screen (title,
  subtitle, disclaimer, ▶ 再生, 「タップして開始」). The button is enabled
  only once the globe's first textures are on the GPU
  (`SatelliteScene.isEarthReady()`, i.e. the boot splash is gone), so the
  countdown never runs under the loading screen. Space / Enter also start
  it. The id is looked up in `public/demos/index.json`; URLs are never built
  from the query string. 終了 removes the parameter, so a reload does not
  restart the tour.
- **表示 tab → 「デモ（解説付き再生）」**: demos are an extra, not a core
  feature, so this is the LAST section of the tab and collapsed by default.
  It lists `public/demos/index.json` as compact rows (title, date · 約n分, a
  small 「再生」 button; the description is the row tooltip), newest first,
  grouped by `category` when there is more than one, with a filter box once
  there are more than 6 demos. 「再生」 plays at once (the clock still waits
  for the globe). The section is hidden when the index is missing or empty.
- **Sharing:** starting a demo (from the list or a link) puts `?demo=<id>` in
  the address bar, and the player's 「リンクをコピー」 button (left of 終了)
  copies that URL (falls back to a prompt where the clipboard API is not
  available). Opening the link shows the start screen; 終了 removes the
  parameter.
- Index entry fields: `id`, `title`, `tour` (required); `description`,
  `category` (e.g. 「打上げ」「衛星運用」), `date` (`YYYY-MM-DD`, the event
  date) and `durationMin` (approximate running time) are optional.

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
  "clockLabel": "打上げから",
  "telemetryNote": "速度・高度は推定",
  "epoch": "2026-11-13T22:47:36Z",
  "tracks": [
    { "key": "booster", "url": "demos/flight15/booster.csv", "label": "ブースター", "holdS": 0 },
    { "key": "ship", "url": "demos/flight15/ship.csv", "label": "シップ" }
  ],
  "landmarks": [
    { "key": "tower", "label": "発射塔（スターベース）", "lat": 25.9963, "lon": -97.1567,
      "model": "launch-tower", "headingDeg": 270, "maxDistanceKm": 300 },
    { "key": "impact", "label": "ブースター処分地点（推定）", "lat": 25.9945, "lon": -97.1217,
      "from": "T+00:06:37.3", "maxDistanceKm": 300 }
  ],
  "chapters": [
    {
      "id": "max-q",
      "title": "最大動圧と上昇",
      "caption": "Two or three plain sentences.",
      "start": "T+00:00:50",
      "end": "T+00:02:15",
      "speed": 2,
      "speedChanges": [{ "at": "T+00:01:20", "speed": 6 }, { "at": "T+00:02:05", "speed": 1 }],
      "camera": { "type": "follow", "track": "booster", "distanceM": 420, "targetUpM": 62 },
      "telemetry": ["booster", "ship"]
    },
    {
      "id": "orbiting",
      "title": "地球を約14周",
      "caption": "…",
      "start": "T+01:20:00",
      "end": "T+21:35:00",
      "speed": 3000,
      "camera": { "type": "globe", "track": "ship", "chase": false, "tiltDeg": -12 },
      "trail": { "future": false, "windowS": 5400, "frame": "inertial" },
      "orbitCounter": { "track": "ship", "from": "T+00:26:30", "total": 14 },
      "telemetry": ["ship"]
    }
  ],
  "ending": {
    "title": "飛行完了",
    "caption": "Summary; \n starts a new line.",
    "camera": { "type": "globe", "track": "ship" },
    "trail": { "future": true }
  },
  "sources": [{ "label": "Wikipedia", "url": "https://…" }]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | `[A-Za-z0-9_-]`; should match the index entry. |
| `title`, `subtitle` | title | Shown top-left and on the start screen. The subtitle wraps on phones. |
| `disclaimer` | no | Persistent notice (always visible). Use it whenever the data is reconstructed or estimated. |
| `clockLabel` | no | Caption above the T± clock (default 「基準時刻から」; e.g. 「打上げから」). |
| `telemetryNote` | no | Short note on the telemetry (e.g. 「速度・高度は推定」), shown after the disclaimer on its line while the chapter has telemetry. |
| `epoch` | no | T0 (ISO UTC). Default: the first track's `# epoch:`. |
| `tracks[]` | yes (≥1) | `key` (unique, `[A-Za-z0-9_-]`), `url` (relative to the base URL, or absolute), optional `label` (HUD **and** the name drawn next to the vehicle; default `KEY` in the HUD and the file's `# name:` on the globe), `model` (overrides `# model:`), `color`, `holdS` (seconds the vehicle stays drawn at its last sample after the track ends; default 30, 0 = disappear at the end). |
| `landmarks[]` | no | Fixed points, see below. |
| `chapters[]` | yes (≥1) | See below. |
| `ending` | no | End card `{ title, caption, camera?, trail? }` shown after the last chapter. `camera` (any camera below; default a whole-globe view from the current direction) is applied before the card appears; `trail` applies to every track (default: full paths, Earth-fixed), so no chapter's window leaks into it. |
| `sources` | no | `[{ label, url }]`, linked on the end card. |

### Landmarks

`{ key, label?, lat, lon, altKm?, model?, headingDeg?, color?, from?, until?, maxDistanceKm? }`:
a dot and a label at a fixed point, optionally with an upright static model
(`"launch-tower"`, see [trajectory-layer.md](trajectory-layer.md#landmarks);
its origin is the launch-mount axis and `headingDeg` is the bearing of the
column from it). `from` / `until` are tour times; `maxDistanceKm` shows the
dot and label only while the camera is within that distance (so they do not
clutter whole-globe views). Typical uses: the launch tower, an estimated
impact point shown from the moment a track ends.

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
| `cameraChanges` | Optional `[{ at, camera }]`, strictly inside the chapter (e.g. pull back after a landing). Each is applied once when the clock passes it; seeking into the chapter applies the camera in effect at that time. |
| `trail` | Optional `{ future?, windowS?, frame? }`, see below. |
| `orbitCounter` | Optional `{ track, from?, total? }`: shows 「周回 n/total」 under the clock. `n` counts the track's northbound equator crossings since `from` (default the chapter start), at least 1 (the partial first orbit counts with the first full one), capped at `total`. For Flight 15 it reaches 14 at T+20:29. |
| `telemetry` | Track keys shown in the HUD (one line each, under the clock). |

**Trails** (per chapter; see [trajectory-layer.md](trajectory-layer.md#trail-options)):

- `future` (default `true`): the faint path not flown yet, for the camera's
  track. **Other tracks never show their future path in a tour**, so a long
  path across the sky does not swing with a close follow camera.
- `windowS`: the bright trail covers only the last `windowS` seconds and
  fades toward its old end; the faint path behind the vehicle is cut the same
  way (e.g. 5400 ≈ one low orbit, or ~1800 for an entry so the day of orbits
  is not drawn across the sky).
- `frame`: `"inertial"` draws orbits as fixed rings (use it in whole-globe
  chapters of an orbiting vehicle, with a window); `"earth"` (default)
  near the ground and when following.

Without `trail`, a chapter shows full Earth-fixed trails (future path for
the camera's track only).

**Tour times:** `"T+hh:mm:ss[.sss]"`, `"T-hh:mm:ss"` (a `−` minus sign also
works) or `"T+mm:ss"`, relative to the tour epoch; a number of seconds
relative to the epoch; or an ISO-8601 UTC timestamp. A timestamp without a
zone designator is UTC.

**Cameras:**

- `{ "type": "follow", "track": "ship" }` rides with the track (the existing
  追従 camera: side-on, Earth-fixed, and the viewer can orbit and zoom).
  Before the track starts, the camera holds on the first sample (the pad);
  after it ends, on the last. Optional framing:
  - `distanceM`: camera distance in metres (default 3 vehicle lengths).
    Applied at once when the follow starts; eased when the chapter keeps
    following the same track; the viewer's zoom is free afterwards.
  - `targetUpM`: aim this many metres above the vehicle base, along the local
    vertical (the base is the track point), e.g. 62 to centre a 124 m stack.
  - `include`: another track key kept in frame. The target becomes the
    midpoint and the distance never drops below what fits both (e.g. stage
    separation).
  - `transitionS`: easing time constant for framing changes on the same track
    (default 0.8 s; 0 cuts).
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
  - `tiltDeg` (−85–85) tilts the view from the track's position toward its
    orbit normal (negative: away from it). From straight above the vehicle
    the camera lies in the orbit plane, so an inertial orbit ring is seen
    edge-on as a line. 10–20° shows it side-on as a flat ellipse; ~40° looks
    down on the orbit plane. The track is then off-centre (the chase keeps
    the tilt). The sign picks the side: for a prograde orbit the normal
    points north, so starting the chapter with the vehicle at a northern
    latitude, a negative tilt keeps the camera nearer the equator (Flight 15
    uses −12 at 26° N, putting the camera at about 14° N).
  - Without a track, the camera keeps its current direction.

## Player behaviour

- **Start:** the tour fetches the tour JSON and every track. It then replaces
  the trajectory list with the tour's tracks and the landmarks, switches to
  the free camera and applies chapter 1 (seek to its start, speed, camera,
  trails) while paused. The clock starts when the start screen is dismissed
  (`?demo=`) or, otherwise, as soon as the globe is ready; either way chapter 1
  is re-applied from its start at that moment.
- **Clock:** a requestAnimationFrame loop reads the scene's sim time each
  frame (`SatelliteScene.getSimulationTime()`). App's `simTime` state updates
  only once per sim second.
  - **Auto-advance:** when the sim time reaches the chapter's `end`, the tour
    moves to the next chapter, one chapter at a time. It seeks to the next
    chapter's `start` only when there is a gap, or when the frame overshot by
    more than 1 s (fast chapters step tens of seconds per frame).
  - **End:** after the last chapter the tour pauses, applies the ending
    camera and trails (by default a whole-globe view with every full path)
    and shows the end card. Play then restarts the tour from chapter 1.
  - **Scene rebuild:** a rebuild (e.g. the initial ground-station list
    arriving) restarts the clock at the scenario start. The loop detects the
    new scene instance, seeks back to the tour time and re-applies the chapter
    camera.
- **Speed:** App's `tourSpeed` overrides `10^speedExp` in the `speedRef`
  effect. The persisted speed setting is untouched.
- **Trails:** each chapter swaps in the tour tracks with that chapter's
  `trail` style (display-only fields, so no geometry rebuild); the tracks
  live in App state, so trails, landmarks and holds survive a scene rebuild.
- **Layout:** the overlay reports the height of its title row (top) and of
  the control bar plus the caption card's one-line header (bottom) as
  `data-tour-inset-top` / `data-tour-inset-bottom` on `<html>`; the scene
  shifts its projection so the centre of view is the middle of the uncovered
  area, and whole-globe framings fit the globe into that area. The expanded
  caption text and the corner HUD are left out, so opening or closing the
  caption does not move the camera.
- **Reduced motion:** with `prefers-reduced-motion: reduce`, chapter speeds
  are capped at 1000× (`REDUCED_MOTION_MAX_SPEED`) and framing changes cut
  instead of easing (`transitionS` 0). The globe chase stays on, since it is
  what keeps the vehicle in view.
- **Camera:** `seekTo`, `setTrajectoryFollow`, `focusTrajectory`, and the
  tour-only scene methods `setTrajectoryFollowFraming(...)`,
  `frameGlobe(id, distance)` and `setGlobeChase(id)`.
  While a tour runs, camera changes are not persisted (`saveLastView` and
  `cameraSnapshotRef` are gated).
- **Controls:** previous / next jump to a chapter's start (paused stays
  paused). Each dot jumps to its chapter.
  - **Caption:** tapping the caption's title row collapses it to that one
    line or expands it. The choice is remembered (`localStorage`
    `cv-tour-caption`); without one it starts collapsed on phones (< 640 px)
    and open elsewhere. The end card is always shown in full.
  - **Chapter scrubber:** a range input over the current chapter's
    [start, end) labelled with the T± time. Dragging pauses playback and
    auto-advance, seeks at most once per animation frame, and restores the
    previous play / pause state on release (pointer up / cancel, lost
    capture, window blur). It stops 1 ms short of the chapter end so a seek
    never triggers the auto-advance. Arrow / Page / Home / End keys move it
    without changing the pause state (step ≈ 1/500 of the chapter, at least
    0.1 s). Controller: `useGuidedTour().seekInChapter(ms)` and
    `setScrubbing(on)`.
  - Keys: Space play/pause, ← / → chapters, Esc ends the tour. With the
    scrubber focused, ← / → move it instead; Space and Esc still work.
- **終了** restores the trajectory list, the follow target, the camera mode
  and framing, the pause state, the speed (override removed) and the sim time
  from before the tour. The side panel reopens if it was open.

## Telemetry HUD

Each `telemetry` key gets one line in the top-right HUD with its label,
speed (km/h) and altitude (km); value text is at least 11 px. These are interpolated from the track (`trajectoryStateAt`, cubic
Hermite). The speed is **Earth-relative**, i.e. the ECEF velocity norm. In
orbit it is roughly 0.4 km/s lower than the inertial speed, depending on the
inclination. Before a track's first sample the HUD shows the pad state with
zero speed. After its last sample it shows 「飛行終了」. The centre clock is
T± relative to the tour epoch, captioned with `clockLabel`, with the orbit
counter beside the caption when the chapter has one. For reconstructed data
the values are only as good as the reconstruction: say so with
`telemetryNote` (appended to the disclaimer line while the chapter shows
telemetry, and in the HUD's accessible label) and `disclaimer`.

## Adding a demo

1. Put the track files and `tour.json` under `public/demos/<id>/`.
2. Add an entry to `public/demos/index.json` (with `category`, `date` and
   `durationMin` so it sorts and groups well as the list grows).
3. Run `bun test tests/tour.test.ts`. It validates the JSON, checks that the
   chapters are contiguous and that every chapter has a caption and
   telemetry. Gaps are allowed by the format but flagged by this test; relax
   it for a tour that needs gaps.
4. Open `/?demo=<id>` to check the pacing. A rough real-time length per
   chapter is `(end − start) / speed`. Leave about 25 s for a 3-sentence
   caption.
