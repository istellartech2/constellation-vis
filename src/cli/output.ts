import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LinkDutyAnalysisResult } from "../lib/linkDutyAnalysis";

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(headers: string[], rows: Array<Array<string | number | null>>): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

export function serializeJson(result: LinkDutyAnalysisResult, pretty = false): string {
  return JSON.stringify(result, null, pretty ? 2 : undefined) + "\n";
}

export async function writeCsvOutput(directory: string, result: LinkDutyAnalysisResult): Promise<void> {
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, "constellation_summary.csv"), csv(
      ["endToEndDutyRatio", "endToEndSeconds", "satelliteCount", "terminalCount"],
      [[
        result.constellationSummary.endToEndDutyRatio,
        result.constellationSummary.endToEndSeconds,
        result.constellationSummary.satelliteCount,
        result.constellationSummary.terminalCount,
      ]],
    )),
    writeFile(join(directory, "satellite_duty.csv"), csv(
      [
        "satelliteId", "label", "serviceRatio", "feederRatio", "endToEndRatio",
        "communicationRatio", "serviceSeconds", "feederSeconds", "endToEndSeconds",
        "communicationSeconds", "communicationCycleCount", "maxCommunicationOnSeconds",
        "averageCommunicationOnSeconds", "maxCommunicationOffSeconds",
        "averageCommunicationOffSeconds", "maxSimultaneousLinks",
      ],
      result.satellites.map((item) => [item.satelliteId, item.label, ...Object.values(item.duty)]),
    )),
    writeFile(join(directory, "link_summary.csv"), csv(
      [
        "satelliteId", "terminalId", "linkKind", "contactCount", "totalContactSeconds",
        "dutyRatio", "maxContactSeconds", "averageContactSeconds", "maxOutageSeconds",
        "averageOutageSeconds",
      ],
      result.satellites.flatMap((item) => item.links.map((link) => Object.values(link))),
    )),
    writeFile(join(directory, "contact_windows.csv"), csv(
      [
        "satelliteId", "terminalId", "linkKind", "aos", "los", "durationSeconds",
        "maxElevationDeg", "minSlantRangeKm", "maxSlantRangeKm",
        "minOneWayPropagationDelayMs", "maxOneWayPropagationDelayMs",
        "maxAbsUplinkDopplerHz", "maxAbsDownlinkDopplerHz",
      ],
      result.satellites.flatMap((item) => item.contactWindows.map((window) => Object.values(window))),
    )),
    writeFile(join(directory, "link_samples.csv"), csv(
      [
        "satelliteId", "terminalId", "linkKind", "timestamp", "elevationDeg", "azimuthDeg",
        "offNadirDeg", "slantRangeKm", "rangeRateKmPerSec", "oneWayPropagationDelayMs",
        "roundTripPropagationDelayMs", "uplinkDopplerHz", "downlinkDopplerHz",
        "uplinkReceivedFrequencyHz", "downlinkReceivedFrequencyHz",
      ],
      result.samples.map((sample) => Object.values(sample)),
    )),
  ]);
}
