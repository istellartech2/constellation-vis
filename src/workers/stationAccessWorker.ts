/// <reference lib="webworker" />
import {
  calculateAvailabilityMetrics,
  calculateStationAccessData,
  calculateStationStats,
  averageVisibilityData,
} from "../lib/visibility";
import {
  parseConstellationToml,
  parseGroundStationsToml,
  parseSatellitesToml,
} from "../lib/config";
import type {
  StationAccessWorkerRequest,
  StationAccessWorkerResponse,
} from "./stationAccessWorker.types";

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener("message", (event: MessageEvent<StationAccessWorkerRequest>) => {
  const message = event.data;
  if (message.type !== "analyze") return;

  const { id, payload } = message;

  try {
    const { satText, constText, gsText, startTimeIso, durationHours, stepSeconds, averagePoints } =
      payload;

    const baseSats = satText ? parseSatellitesToml(satText) : [];
    const constSats = constText ? parseConstellationToml(constText) : [];
    const groundStations = gsText ? parseGroundStationsToml(gsText) : [];

    if (groundStations.length === 0) {
      throw new Error("地上局データがありません");
    }

    const allSatellites = [...baseSats, ...constSats];
    if (allSatellites.length === 0) {
      throw new Error("衛星データがありません");
    }

    const start = new Date(startTimeIso);

    const visibilityData = calculateStationAccessData(
      allSatellites,
      groundStations,
      start,
      durationHours,
      stepSeconds,
    );

    const averagedData = averageVisibilityData(visibilityData, averagePoints);
    const stationStats = calculateStationStats(visibilityData);

    const stationIndices = groundStations.map((_, index) => index);
    const availabilityData = calculateAvailabilityMetrics(
      visibilityData,
      stationIndices,
      stepSeconds,
    );
    const availabilityMetrics = groundStations.map((station, index) => ({
      stationName: station.name,
      ...availabilityData[index],
    }));

    const response: StationAccessWorkerResponse = {
      id,
      type: "success",
      payload: {
        stations: groundStations,
        averagedData,
        stats: stationStats,
        availabilityMetrics,
        rawPointCount: visibilityData.length,
        averagePoints,
        durationHours,
      },
    };

    ctx.postMessage(response);
  } catch (error) {
    const response: StationAccessWorkerResponse = {
      id,
      type: "error",
      message: error instanceof Error ? error.message : "解析エラーが発生しました",
    };
    ctx.postMessage(response);
  }
});
