/**
 * TOML parsing and serialization for constellation configuration
 */

import type { ConstellationConfig, ConstellationShell } from "./constellationTypes";
import { createDefaultConfig } from "./constellationTypes";

function parseValue(raw: string): string | number | Date {
  const s = raw.trim();
  if (!s) return s;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/.test(s)) {
    return new Date(s.replace(/['"]/g, ""));
  }
  const n = Number(s);
  if (!Number.isNaN(n)) return n;
  return s;
}

export function parseConstellationConfig(tomlText: string): ConstellationConfig {
  if (!tomlText.trim()) {
    return createDefaultConfig();
  }

  const lines = tomlText.split(/\r?\n/);
  const config: ConstellationConfig = {
    name: "",
    epoch: new Date(),
    shells: [],
  };
  let currentShell: Partial<ConstellationShell> | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    if (line === "[constellation]") {
      continue;
    }
    if (line === "[[constellation.shells]]") {
      if (currentShell) {
        config.shells.push(finalizeShell(currentShell));
      }
      currentShell = {};
      continue;
    }

    const m = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (m) {
      const key = m[1];
      const value = parseValue(m[2]);

      if (currentShell !== null) {
        // We're inside a shell definition
        switch (key) {
          case "name":
            currentShell.name = String(value);
            break;
          case "count":
            currentShell.count = Number(value);
            break;
          case "planes":
            currentShell.planes = Number(value);
            break;
          case "phasing":
            currentShell.phasing = Number(value);
            break;
          case "apogee_altitude":
            currentShell.apogee_altitude = Number(value);
            break;
          case "eccentricity":
            currentShell.eccentricity = Number(value);
            break;
          case "inclination":
            currentShell.inclination = Number(value);
            break;
          case "raan_start":
            currentShell.raan_start = Number(value);
            break;
          case "raan_range":
            currentShell.raan_range = Number(value);
            break;
          case "argp":
            currentShell.argp = Number(value);
            break;
          case "mean_anomaly_0":
            currentShell.mean_anomaly_0 = Number(value);
            break;
        }
      } else {
        // We're in the constellation section
        if (key === "name") {
          config.name = String(value);
        } else if (key === "epoch") {
          config.epoch = value instanceof Date ? value : new Date(String(value));
        }
      }
    }
  }

  if (currentShell) {
    config.shells.push(finalizeShell(currentShell));
  }

  return config;
}

function finalizeShell(partial: Partial<ConstellationShell>): ConstellationShell {
  return {
    id: crypto.randomUUID(),
    name: partial.name ?? "",
    count: partial.count ?? 1,
    planes: partial.planes ?? 1,
    phasing: partial.phasing,
    apogee_altitude: partial.apogee_altitude,
    eccentricity: partial.eccentricity,
    inclination: partial.inclination,
    raan_start: partial.raan_start,
    raan_range: partial.raan_range,
    argp: partial.argp,
    mean_anomaly_0: partial.mean_anomaly_0,
  };
}

function formatTomlDate(date: Date): string {
  // Format as unquoted ISO timestamp: 2025-05-20T00:00:00Z
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function formatNumber(value: number | undefined, decimals: number = 4): string {
  if (value === undefined) return "0";
  // Remove trailing zeros after decimal point
  const fixed = value.toFixed(decimals);
  return fixed.replace(/\.?0+$/, "") || "0";
}

export function serializeConstellationConfig(config: ConstellationConfig): string {
  const lines: string[] = [];

  lines.push("[constellation]");
  lines.push(`name  = "${config.name}"`);
  lines.push(`epoch = ${formatTomlDate(config.epoch)}`);

  for (const shell of config.shells) {
    lines.push("");
    lines.push("[[constellation.shells]]");

    if (shell.name) {
      lines.push(`name = "${shell.name}"`);
    }
    lines.push(`count = ${shell.count}`);
    lines.push(`planes = ${shell.planes}`);

    // Only include non-default values
    if (shell.phasing !== undefined && shell.phasing !== 0) {
      lines.push(`phasing = ${shell.phasing}`);
    }
    if (shell.apogee_altitude !== undefined && shell.apogee_altitude !== 0) {
      lines.push(`apogee_altitude = ${formatNumber(shell.apogee_altitude, 2)}`);
    }
    if (shell.eccentricity !== undefined && shell.eccentricity !== 0) {
      lines.push(`eccentricity = ${formatNumber(shell.eccentricity, 6)}`);
    }
    if (shell.inclination !== undefined && shell.inclination !== 0) {
      lines.push(`inclination = ${formatNumber(shell.inclination, 2)}`);
    }
    if (shell.raan_start !== undefined && shell.raan_start !== 0) {
      lines.push(`raan_start = ${formatNumber(shell.raan_start, 2)}`);
    }
    if (shell.raan_range !== undefined && shell.raan_range !== 360) {
      lines.push(`raan_range = ${formatNumber(shell.raan_range, 2)}`);
    }
    if (shell.argp !== undefined && shell.argp !== 0) {
      lines.push(`argp = ${formatNumber(shell.argp, 2)}`);
    }
    if (shell.mean_anomaly_0 !== undefined && shell.mean_anomaly_0 !== 0) {
      lines.push(`mean_anomaly_0 = ${formatNumber(shell.mean_anomaly_0, 2)}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

export function validateConfig(config: ConstellationConfig): ValidationResult {
  const errors: ValidationError[] = [];

  if (!config.name.trim()) {
    errors.push({ field: "name", message: "コンステレーション名は必須です" });
  }

  config.shells.forEach((shell, index) => {
    if (shell.count < 1 || !Number.isInteger(shell.count)) {
      errors.push({
        field: `shell.${index}.count`,
        message: "衛星数は1以上の整数が必要です",
      });
    }
    if (shell.planes < 1 || !Number.isInteger(shell.planes)) {
      errors.push({
        field: `shell.${index}.planes`,
        message: "軌道面数は1以上の整数が必要です",
      });
    }
    if (shell.planes > shell.count) {
      errors.push({
        field: `shell.${index}.planes`,
        message: "軌道面数は衛星数以下である必要があります",
      });
    }
    if (
      shell.eccentricity !== undefined &&
      (shell.eccentricity < 0 || shell.eccentricity >= 1)
    ) {
      errors.push({
        field: `shell.${index}.eccentricity`,
        message: "離心率は0以上1未満である必要があります",
      });
    }
    if (shell.apogee_altitude !== undefined && shell.apogee_altitude < 0) {
      errors.push({
        field: `shell.${index}.apogee_altitude`,
        message: "高度は0以上である必要があります",
      });
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export function getShellDisplayName(shell: ConstellationShell, index: number): string {
  if (shell.name) {
    return shell.name;
  }
  const alt = shell.apogee_altitude ?? 0;
  const inc = shell.inclination ?? 0;
  return `Shell ${index + 1} (${alt}km, ${inc}°)`;
}
