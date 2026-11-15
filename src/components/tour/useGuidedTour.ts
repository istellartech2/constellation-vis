import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type SatelliteScene from "../../lib/visualization";
import type { SatelliteCameraMode } from "../../lib/visualization";
import type { CameraSnapshot } from "../../lib/viewState";
import type { TrajectoryTrack } from "../../lib/trajectory/types";
import type { ResolvedChapter, ResolvedTour, TourCamera } from "../../lib/tour/types";
import { chapterSpeedAt, nextTourStep } from "../../lib/tour/parse";
import { loadTour } from "../../lib/tour/load";

/** App state the tour drives (and restores on 終了). */
export interface GuidedTourHost {
  sceneRef: RefObject<SatelliteScene | null>;
  cameraSnapshotRef: RefObject<CameraSnapshot | null>;
  trajectories: TrajectoryTrack[];
  setTrajectories: (tracks: TrajectoryTrack[]) => void;
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
  /** Scene tracks by tour track key. */
  tracks: Record<string, TrajectoryTrack>;
  chapterIndex: number;
  /** The last chapter has played to its end (end card shown, paused). */
  finished: boolean;
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

const INITIAL: GuidedTourState = { status: "idle", error: null, tour: null, tracks: {}, chapterIndex: 0, finished: false };

/**
 * Guided tour controller (presentation mode). Loads a tour, swaps its tracks
 * into the scene, and drives seek / speed / camera per chapter from a rAF
 * loop that reads the scene's sim time each frame (App's simTime state is
 * only updated once per sim second). 終了 puts back the tracks, follow,
 * camera, speed, pause state and sim time from before the tour.
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

  const applyCamera = useCallback((camera: TourCamera, tracks: Record<string, TrajectoryTrack>) => {
    const h = hostRef.current;
    const scene = h.sceneRef.current;
    if (!scene) return;
    if (camera.type === "follow") {
      const id = tracks[camera.track]?.id ?? null;
      scene.setGlobeChase(null);
      scene.setTrajectoryFollow(id);
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
    scene.frameGlobe(trackId, camera.distance);
    scene.setGlobeChase(camera.chase === false ? null : trackId);
  }, []);

  const applyChapter = useCallback(
    (chapter: ResolvedChapter, tracks: Record<string, TrajectoryTrack>, seek: boolean, seekMs = chapter.startMs) => {
      const h = hostRef.current;
      const scene = h.sceneRef.current;
      if (!scene) return;
      if (seek) scene.seekTo(new Date(seekMs));
      h.setTourSpeed(chapterSpeedAt(chapter, seek ? seekMs : scene.getSimulationTime().getTime()));
      applyCamera(chapter.camera, tracks);
    },
    [applyCamera],
  );

  const start = useCallback(async (tourUrl: string) => {
    const token = ++loadTokenRef.current;
    const h = hostRef.current;
    const scene = h.sceneRef.current;
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
      cur.setUserPaused(false);
      if (loaded.warnings.length > 0) console.warn("[tour]", ...loaded.warnings);
      setState({ status: "running", error: null, tour: loaded.tour, tracks: loaded.tracks, chapterIndex: 0, finished: false });
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
      if (s.status !== "running" || !s.tour) return;
      const i = Math.max(0, Math.min(s.tour.chapters.length - 1, index));
      // Update the ref now: the frame loop may run before the re-render and
      // must not judge the new time against the old chapter.
      stateRef.current = { ...s, chapterIndex: i, finished: false };
      setState((prev) => ({ ...prev, chapterIndex: i, finished: false }));
      if (s.finished) hostRef.current.setUserPaused(false);
      applyChapter(s.tour.chapters[i], s.tracks, true);
    },
    [applyChapter],
  );

  // Apply the first chapter once the tour tracks are committed (this effect
  // runs after useSatelliteScene's, which hands them to the scene).
  useEffect(() => {
    if (!pendingApply) return;
    const s = stateRef.current;
    if (s.status !== "running" || !s.tour) return;
    if (!hostRef.current.sceneRef.current) return; // the frame loop retries
    applyChapter(s.tour.chapters[pendingApply.index], s.tracks, pendingApply.seek);
    setPendingApply(null);
  }, [pendingApply, applyChapter]);

  const running = state.status === "running";
  // Frame loop: auto-advance, in-chapter speed changes, and recovery from a
  // scene rebuild (which restarts the clock at the scenario start time).
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let lastScene: SatelliteScene | null = hostRef.current.sceneRef.current;
    let lastSimMs: number | null = null;
    let appliedSpeed: number | null = null;
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
        applyChapter(chapter, s.tracks, true, resumeMs);
        return;
      }
      const ms = scene.getSimulationTime().getTime();
      lastSimMs = ms;
      if (s.finished) return;
      const step = nextTourStep(s.tour, s.chapterIndex, ms);
      if (step.kind === "finish") {
        stateRef.current = { ...s, finished: true };
        setState((prev) => ({ ...prev, finished: true }));
        hostRef.current.setUserPaused(true);
        return;
      }
      if (step.kind === "advance") {
        const next = s.tour.chapters[step.index];
        stateRef.current = { ...s, chapterIndex: step.index };
        setState((prev) => ({ ...prev, chapterIndex: step.index }));
        applyChapter(next, s.tracks, step.seekMs !== null, step.seekMs ?? next.startMs);
        appliedSpeed = null;
        return;
      }
      const speed = chapterSpeedAt(chapter, ms);
      if (appliedSpeed !== null && speed !== appliedSpeed) hostRef.current.setTourSpeed(speed);
      appliedSpeed = speed;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, applyChapter]);

  const togglePause = useCallback(() => {
    const h = hostRef.current;
    const s = stateRef.current;
    if (s.finished) {
      goTo(0);
      return;
    }
    h.setUserPaused(!h.userPaused);
  }, [goTo]);

  return { state, start, stop, goTo, togglePause };
}
