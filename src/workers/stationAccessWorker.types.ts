import type { GroundStation } from "../lib/groundStations";
import type { StationVisibilitySample } from "../lib/visibility";

export interface StationAccessWorkerPayload {
  satText: string;
  constText: string;
  gsText: string;
  startTimeIso: string;
  durationHours: number;
  stepSeconds: number;
  averagePoints: number;
}

export interface StationAccessWorkerRequest {
  id: number;
  type: "analyze";
  payload: StationAccessWorkerPayload;
}

export interface StationAvailabilityMetrics {
  stationName: string;
  timeAvailability: number;
  interruptionFrequency: number;
  maxInterruptionTime: number;
  avgInterruptionTime: number;
}

export interface StationAccessWorkerSuccess {
  id: number;
  type: "success";
  payload: {
    stations: GroundStation[];
    averagedData: StationVisibilitySample[];
    stats: Array<{ name: string; averageVisible: number; nonZeroRate: number }>;
    availabilityMetrics: StationAvailabilityMetrics[];
    rawPointCount: number;
    averagePoints: number;
    durationHours: number;
  };
}

export interface StationAccessWorkerError {
  id: number;
  type: "error";
  message: string;
}

export type StationAccessWorkerResponse =
  | StationAccessWorkerSuccess
  | StationAccessWorkerError;
