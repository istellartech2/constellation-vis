import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type SatelliteScene from "../../lib/visualization";
import type { SatelliteCameraMode } from "../../lib/visualization";
import type { CameraSnapshot } from "../../lib/viewState";
import type { TrajectoryLandmark, TrajectoryTrack } from "../../lib/trajectory/types";
import type { ResolvedChapter, ResolvedTour, TourCamera, TourTrail } from "../../lib/tour/types";
import {
  chapterCameraAt,
  chapterSpeedAt,
  nextTourStep,
  tourLandmarks,
  tourPlaybackSpeed,
  tourTrailStyle,
} from "../../lib/tour/parse";
import { loadTour } from "../../lib/tour/load";

/** App state the tour drives (and restores on 終了). */
export interface GuidedTourHost {
  sceneRef: RefObject<SatelliteScene | null>;
  cameraSnapshotRef: RefObject<CameraSnapshot | null>;
  trajectories: TrajectoryTrack[];
  setTrajectories: (tracks: TrajectoryTrack[]) => void;
  /** Landmarks drawn with the trajectory layer (the tour's; [] outside a tour). */
  setTrajectoryLandmarks: (landmarks: TrajectoryLandmark[]) => void;
  trajectoryFollowId: string | null;
  setTrajectoryFollowId: (id: string | null) => void;
  cameraMode: SatelliteCameraMode;
  setCameraMode: (mode: SatelliteCameraMode) => void;
  userPaused: boolean;
  setUserPaused: (paused: boolean) => void;
  /** Speed override (× real time) while a tour runs; null restores the normal speed. */
  setTourSpeed: (speed: number | null) => void;
}

export type GuidedTourStatus = "idle" | "loading" | "running" | "error";

export interface GuidedTourState {
  status: GuidedTourStatus;
  error: string | null;
  tour: ResolvedTour | null;
  /** Scene tracks by tour track key (as loaded; the trail style is set per chapter). */
  tracks: Record<string, TrajectoryTrack>;
  chapterIndex: number;
  /** The last chapter has played to its end (end card shown, paused). */
  finished: boolean;
  /**
   * Loaded and parked on chapter 1, paused, behind the start screen
   * (「タップして開始」); the clock starts on {@link begin}.
   */
  awaitingStart: boolean;
}

export interface StartTourOptions {
  /** Show the start screen first (used for `?demo=`); otherwise play at once. */
  awaitStart?: boolean;
}

/** What the app looked like before the tour, restored by 終了. */
interface Restore {
  trajectories: TrajectoryTrack[];
  followId: string | null;
  cameraMode: SatelliteCameraMode;
  userPaused: boolean;
  simMs: number | null;
  camera: CameraSnapshot | null;
}

const INITIAL: GuidedTourState = {
  status: "idle",
  error: null,
  tour: null,
  tracks: {},
  chapterIndex: 0,
  finished: false,
  awaitingStart: false,
};

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

/** Track key the camera looks at (null: none, e.g. a plain globe view). */
function cameraTrackKey(camera: TourCamera): string | null {
  return camera.track ?? null;
}

/**
 * Guided tour controller (presentation mode). Loads a tour, swaps its tracks
 * and landmarks into the scene, and drives seek / speed / camera / trail
 * style per chapter from a rAF loop that reads the scene's sim time each
 * frame (App's simTime state is only updated once per sim second). 終了 puts
 * back the tracks, follow, camera, speed, pause state and sim time from
 * before the tour.
 *
 * With `prefers-reduced-motion`, chapter speeds are capped at
 * REDUCED_MOTION_MAX_SPEED and framing changes cut instead of easing.
 */
export function useGuidedTour(host: GuidedTourHost) {
  const [state, setState] = useState<GuidedTourState>(INITIAL);
  const hostRef = useRef(host);
  useEffect(() => {
    hostRef.current = host;
  });
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  const restoreRef = useRef<Restore | null>(null);
  // Chapter to apply after the commit that put the tour tracks in the scene.
  const [pendingApply, setPendingApply] = useState<{ index: number; seek: boolean; nonce: number } | null>(null);
  const loadTokenRef = useRef(0);
  const reducedMotionRef = useRef(false);
  // Camera change index applied in the current chapter (−1: the chapter camera).
  const appliedCameraRef = useRef(-1);

  /** Swap in the tour tracks with this chapter's trail style (no geometry rebuild). */
  const applyTrails = useCallback(
    (tour: ResolvedTour, tracks: Record<string, TrajectoryTrack>, trail: TourTrail | undefined, focusKey: string | null) => {
      const h = hostRef.current;
      const next = tour.tracks.map((ref) => ({
        ...tracks[ref.key],
        trail: tourTrailStyle(trail, focusKey === null || focusKey === ref.key),
      }));
      // Straight into the scene (this frame), and into App state (rebuilds, restore).
      h.sceneRef.current?.setTrajectories(next);
      h.setTrajectories(next);
    },
    [],
  );

  const applyCamera = useCallback((camera: TourCamera, tracks: Record<string, TrajectoryTrack>) => {
    const h = hostRef.current;
    const scene = h.sceneRef.current;
    if (!scene) return;
    if (camera.type === "follow") {
      const id = tracks[camera.track]?.id ?? null;
      scene.setGlobeChase(null);
      scene.setTrajectoryFollow(id);
      scene.setTrajectoryFollowFraming({
        distanceM: camera.distanceM ?? null,
        targetUpM: camera.targetUpM ?? 0,
        includeId: camera.include !== undefined ? (tracks[camera.include]?.id ?? null) : null,
        transitionS: reducedMotionRef.current ? 0 : camera.transitionS,
      });
      h.setTrajectoryFollowId(id);
      return;
    }
    // Stop a follow on the scene right away (restoring the free camera), so
    // the framing below is not undone when App's state catches up.
    scene.setTrajectoryFollow(null);
    h.setTrajectoryFollowId(null);
    const trackId = camera.track !== undefined ? (tracks[camera.track]?.id ?? null) : null;
    if (camera.type === "overview") {
      scene.setGlobeChase(null);
      if (trackId) scene.focusTrajectory(trackId);
      return;
    }
    scene.frameGlobe(trackId, camera.distance, camera.tiltDeg ?? 0);
    scene.setGlobeChase(camera.chase === false ? null : trackId);
  }, []);

  const applyChapter = useCallback(
    (
      tour: ResolvedTour,
      chapter: ResolvedChapter,
      tracks: Record<string, TrajectoryTrack>,
      seek: boolean,
      seekMs = chapter.startMs,
    ) => {
      const h = hostRef.current;
      const scene = h.sceneRef.current;
      if (!scene) return;
      if (seek) scene.seekTo(new Date(seekMs));
      const t = seek ? seekMs : scene.getSimulationTime().getTime();
      h.setTourSpeed(tourPlaybackSpeed(chapterSpeedAt(chapter, t), reducedMotionRef.current));
      applyTrails(tour, tracks, chapter.trail, cameraTrackKey(chapter.camera));
      const cam = chapterCameraAt(chapter, t);
      appliedCameraRef.current = cam.index;
      applyCamera(cam.camera, tracks);
    },
    [applyCamera, applyTrails],
  );

  /** End card: full trails on every track and the ending camera (default: whole globe). */
  const applyEnding = useCallback(
    (tour: ResolvedTour, tracks: Record<string, TrajectoryTrack>) => {
      applyTrails(tour, tracks, tour.ending?.trail, null);
      applyCamera(tour.ending?.camera ?? { type: "globe" }, tracks);
    },
    [applyCamera, applyTrails],
  );

  const start = useCallback(async (tourUrl: string, options: StartTourOptions = {}) => {
    const token = ++loadTokenRef.current;
    const h = hostRef.current;
    const scene = h.sceneRef.current;
    reducedMotionRef.current = prefersReducedMotion();
    if (!restoreRef.current) {
      restoreRef.current = {
        trajectories: h.trajectories,
        followId: h.trajectoryFollowId,
        cameraMode: h.cameraMode,
        userPaused: h.userPaused,
        simMs: scene ? scene.getSimulationTime().getTime() : null,
        camera: scene ? scene.getCameraSnapshot() : h.cameraSnapshotRef.current,
      };
    }
    setState({ ...INITIAL, status: "loading" });
    try {
      const loaded = await loadTour(tourUrl, import.meta.env.BASE_URL);
      if (token !== loadTokenRef.current) return;
      const cur = hostRef.current;
      cur.sceneRef.current?.setTrajectoryFollow(null);
      cur.setTrajectoryFollowId(null);
      // Follow needs the free camera (the satellite camera modes take precedence).
      cur.sceneRef.current?.setCameraMode("free");
      cur.setCameraMode("free");
      cur.setTrajectories(loaded.tour.tracks.map((t) => loaded.tracks[t.key]));
      cur.setTrajectoryLandmarks(tourLandmarks(loaded.tour));
      // Parked until the start screen is dismissed (or the globe is ready).
      cur.setUserPaused(true);
      if (loaded.warnings.length > 0) console.warn("[tour]", ...loaded.warnings);
      setState({
        status: "running",
        error: null,
        tour: loaded.tour,
        tracks: loaded.tracks,
        chapterIndex: 0,
        finished: false,
        awaitingStart: options.awaitStart === true,
      });
      setPendingApply((p) => ({ index: 0, seek: true, nonce: (p?.nonce ?? 0) + 1 }));
    } catch (err) {
      if (token !== loadTokenRef.current) return;
      setState({ ...INITIAL, status: "error", error: err instanceof Error ? err.message : "ツアーを読み込めませんでした" });
    }
  }, []);

  const stop = useCallback(() => {
    loadTokenRef.current++;
    const h = hostRef.current;
    const scene = h.sceneRef.current;
    const back = restoreRef.current;
    restoreRef.current = null;
    setPendingApply(null);
    // Synchronously, so a frame before the re-render does not drive the tour any more.
    stateRef.current = INITIAL;
    setState(INITIAL);
    h.setTourSpeed(null);
    h.setTrajectoryLandmarks([]);
    if (!back) return;
    scene?.setGlobeChase(null);
    scene?.setTrajectoryFollow(null);
    h.setTrajectories(back.trajectories);
    h.setTrajectoryFollowId(back.followId);
    h.setUserPaused(back.userPaused);
    h.setCameraMode(back.cameraMode);
    if (back.simMs !== null) scene?.seekTo(new Date(back.simMs));
    if (back.camera) {
      h.cameraSnapshotRef.current = back.camera;
      scene?.applyCameraSnapshot(back.camera);
    }
  }, []);

  const goTo = useCallback(
    (index: number) => {
      const s = stateRef.current;
      if (s.status !== "running" || !s.tour || s.awaitingStart) return;
      const i = Math.max(0, Math.min(s.tour.chapters.length - 1, index));
      // Update the ref now: the frame loop may run before the re-render and
      // must not judge the new time against the old chapter.
      stateRef.current = { ...s, chapterIndex: i, finished: false };
      setState((prev) => ({ ...prev, chapterIndex: i, finished: false }));
      if (s.finished) hostRef.current.setUserPaused(false);
      applyChapter(s.tour, s.tour.chapters[i], s.tracks, true);
    },
    [applyChapter],
  );

  /** Leave the start screen: start the clock from the first chapter. */
  const begin = useCallback(() => {
    const s = stateRef.current;
    if (s.status !== "running" || !s.tour || !s.awaitingStart) return;
    stateRef.current = { ...s, awaitingStart: false, chapterIndex: 0, finished: false };
    setState((prev) => ({ ...prev, awaitingStart: false, chapterIndex: 0, finished: false }));
    applyChapter(s.tour, s.tour.chapters[0], s.tracks, true);
    hostRef.current.setUserPaused(false);
  }, [applyChapter]);

  // Apply the first chapter once the tour tracks are committed (this effect
  // runs after useSatelliteScene's, which hands them to the scene).
  useEffect(() => {
    if (!pendingApply) return;
    const s = stateRef.current;
    if (s.status !== "running" || !s.tour) return;
    if (!hostRef.current.sceneRef.current) return; // the frame loop retries
    applyChapter(s.tour, s.tour.chapters[pendingApply.index], s.tracks, pendingApply.seek);
    setPendingApply(null);
  }, [pendingApply, applyChapter]);

  const running = state.status === "running";
  // Frame loop: start once the globe is ready, auto-advance, in-chapter speed
  // and camera changes, and recovery from a scene rebuild (which restarts
  // the clock at the scenario start time).
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let lastScene: SatelliteScene | null = hostRef.current.sceneRef.current;
    let lastSimMs: number | null = null;
    let appliedSpeed: number | null = null;
    // Without a start screen, the clock waits for the globe's textures (the
    // boot splash) and then starts from the first chapter's start.
    let waitingForEarth = !stateRef.current.awaitingStart;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const s = stateRef.current;
      const scene = hostRef.current.sceneRef.current;
      if (!scene || !s.tour || s.status !== "running") return;
      const chapter = s.tour.chapters[s.chapterIndex];
      if (scene !== lastScene) {
        // Rebuilt (or first available): resume where the tour was.
        const resumeMs = lastSimMs ?? chapter.startMs;
        lastScene = scene;
        applyChapter(s.tour, chapter, s.tracks, true, resumeMs);
        if (s.finished) applyEnding(s.tour, s.tracks);
        return;
      }
      if (waitingForEarth) {
        if (s.awaitingStart || !scene.isEarthReady()) return;
        waitingForEarth = false;
        applyChapter(s.tour, chapter, s.tracks, true);
        hostRef.current.setUserPaused(false);
        return;
      }
      const ms = scene.getSimulationTime().getTime();
      lastSimMs = ms;
      if (s.finished || s.awaitingStart) return;
      const step = nextTourStep(s.tour, s.chapterIndex, ms);
      if (step.kind === "finish") {
        stateRef.current = { ...s, finished: true };
        setState((prev) => ({ ...prev, finished: true }));
        hostRef.current.setUserPaused(true);
        applyEnding(s.tour, s.tracks);
        return;
      }
      if (step.kind === "advance") {
        const next = s.tour.chapters[step.index];
        stateRef.current = { ...s, chapterIndex: step.index };
        setState((prev) => ({ ...prev, chapterIndex: step.index }));
        applyChapter(s.tour, next, s.tracks, step.seekMs !== null, step.seekMs ?? next.startMs);
        appliedSpeed = null;
        return;
      }
      const speed = tourPlaybackSpeed(chapterSpeedAt(chapter, ms), reducedMotionRef.current);
      if (appliedSpeed !== null && speed !== appliedSpeed) hostRef.current.setTourSpeed(speed);
      appliedSpeed = speed;
      const cam = chapterCameraAt(chapter, ms);
      if (cam.index !== appliedCameraRef.current) {
        appliedCameraRef.current = cam.index;
        applyCamera(cam.camera, s.tracks);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, applyChapter, applyCamera, applyEnding]);

  const togglePause = useCallback(() => {
    const h = hostRef.current;
    const s = stateRef.current;
    if (s.awaitingStart) {
      begin();
      return;
    }
    if (s.finished) {
      goTo(0);
      return;
    }
    h.setUserPaused(!h.userPaused);
  }, [goTo, begin]);

  return { state, start, stop, goTo, togglePause, begin };
}
