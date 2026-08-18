#!/usr/bin/env bun
import { writeFile } from "node:fs/promises";
import { analyzeLinkDuty } from "../lib/linkDutyAnalysis";
import { loadScenario } from "./scenarioParser";
import { serializeJson, writeCsvOutput } from "./output";

interface CliOptions {
  inputPath: string;
  outputPath?: string;
  format: "json" | "csv";
  pretty: boolean;
  summaryOnly: boolean;
  durationHours?: number;
  stepSeconds?: number;
}

const HELP = `constelation-cli 0.1.0

Usage:
  constelation-cli analyze <scenario.toml> [options]

Options:
  --output <path>          JSON file or CSV output directory
  --format <json|csv>      Output format (default: json)
  --pretty                 Pretty-print JSON
  --summary-only           Omit per-time-step link samples
  --duration-hours <n>     Override analysis.durationHours
  --step-seconds <n>       Override analysis.stepSeconds
  --help                   Show help
  --version                Show version
`;

function numericArgument(value: string | undefined, name: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be greater than zero`);
  return number;
}

export function parseCliArguments(args: string[]): CliOptions | "help" | "version" {
  if (args.includes("--help") || args.length === 0) return "help";
  if (args.includes("--version")) return "version";
  if (args[0] !== "analyze" || !args[1] || args[1].startsWith("-")) {
    throw new Error("Expected: constelation-cli analyze <scenario.toml>");
  }
  const options: CliOptions = {
    inputPath: args[1],
    format: "json",
    pretty: false,
    summaryOnly: false,
  };
  for (let index = 2; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case "--output":
        options.outputPath = args[++index];
        if (!options.outputPath) throw new Error("--output requires a path");
        break;
      case "--format": {
        const format = args[++index];
        if (format !== "json" && format !== "csv") throw new Error("--format must be json or csv");
        options.format = format;
        break;
      }
      case "--pretty":
        options.pretty = true;
        break;
      case "--summary-only":
        options.summaryOnly = true;
        break;
      case "--duration-hours":
        options.durationHours = numericArgument(args[++index], "--duration-hours");
        break;
      case "--step-seconds":
        options.stepSeconds = numericArgument(args[++index], "--step-seconds");
        break;
      default:
        throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (options.format === "csv" && !options.outputPath) {
    throw new Error("CSV output requires --output <directory>");
  }
  return options;
}

export async function runCli(args: string[]): Promise<number> {
  const parsed = parseCliArguments(args);
  if (parsed === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  if (parsed === "version") {
    process.stdout.write("0.1.0\n");
    return 0;
  }
  const scenario = await loadScenario(parsed.inputPath);
  const result = analyzeLinkDuty({
    ...scenario,
    durationHours: parsed.durationHours ?? scenario.durationHours,
    stepSeconds: parsed.stepSeconds ?? scenario.stepSeconds,
    includeSamples: !parsed.summaryOnly,
  });
  if (parsed.format === "csv") {
    await writeCsvOutput(parsed.outputPath as string, result);
    return 0;
  }
  const output = serializeJson(result, parsed.pretty);
  if (parsed.outputPath && parsed.outputPath !== "-") await writeFile(parsed.outputPath, output);
  else process.stdout.write(output);
  return 0;
}

if (import.meta.main) {
  runCli(Bun.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`constelation-cli: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
