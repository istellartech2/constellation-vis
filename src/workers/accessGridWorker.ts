/// <reference lib="webworker" />
import { computeAccessGrid } from "../lib/accessGrid";
import { parseConstellationToml, parseSatellitesToml } from "../lib/config";
import type { AccessGridRequest, AccessGridResponse } from "./accessGridWorker.types";

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

/** Minimum interval between progress messages. */
const PROGRESS_INTERVAL_MS = 100;

ctx.addEventListener("message", (event: MessageEvent<AccessGridRequest>) => {
  const message = event.data;
  if (message.type !== "analyze") return;
  const { id, payload } = message;
  const post = (response: AccessGridResponse, transfer: Transferable[] = []) => ctx.postMessage(response, transfer);

  try {
    const satellites = [
      ...(payload.satText ? parseSatellitesToml(payload.satText) : []),
      ...(payload.constText ? parseConstellationToml(payload.constText) : []),
    ];
    if (satellites.length === 0) throw new Error("衛星データがありません");
    if (payload.stations.length === 0) throw new Error("地上局データがありません");

    let lastPost = 0;
    const grid = computeAccessGrid(satellites, payload.stations, new Date(payload.startTimeIso), {
      durationHours: payload.durationHours,
      stepSeconds: payload.stepSeconds,
      fov: payload.satelliteFov,
      onProgress: (fraction) => {
        const now = performance.now();
        if (now - lastPost < PROGRESS_INTERVAL_MS) return;
        lastPost = now;
        post({ id, type: "progress", fraction });
      },
    });

    post({ id, type: "success", payload: { grid, satelliteCount: satellites.length } }, [grid.counts.buffer]);
  } catch (error) {
    post({ id, type: "error", message: error instanceof Error ? error.message : "解析エラーが発生しました" });
  }
});
