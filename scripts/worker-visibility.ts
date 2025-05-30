/**
 * Worker script to compute average visibility for a single shell configuration.
 */
import { generateConstellationToml } from "./generate-constellation";
import type { ShellParams } from "./generate-constellation";
import { parseConstellationToml } from "../src/utils/tomlParse";
import { averageVisibility } from "../src/utils/visibility";
import type { GroundStation } from "../src/data/groundStations";

self.onmessage = (e) => {
  const {
    shell,
    epoch,
    startMs,
    durationHours,
    stepSec,
    station,
  }: {
    shell: ShellParams;
    epoch: string;
    startMs: number;
    durationHours: number;
    stepSec: number;
    station: GroundStation;
  } = e.data;
  const toml = generateConstellationToml(shell, epoch);
  const sats = parseConstellationToml(toml);
  const avg = averageVisibility(
    sats,
    station,
    new Date(startMs),
    durationHours,
    stepSec,
  );
  self.postMessage({ name: shell.name, avg });
};