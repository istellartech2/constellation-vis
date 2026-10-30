/// <reference lib="webworker" />
import { parseCatalogText, type CatalogFormat } from "../lib/catalogParsers";
import { syntheticCatalog, type SyntheticPreset } from "../lib/syntheticCatalogs";
import { catalogTransferables, type SatelliteCatalog } from "../lib/satelliteCatalog";

export type CatalogImportRequest =
  | { kind: "file"; file: File }
  | { kind: "synthetic"; preset: SyntheticPreset; count: number; epochMs: number };

export type CatalogImportResponse =
  | { ok: true; catalog: SatelliteCatalog; format: CatalogFormat | "synthetic"; skipped: number }
  | { ok: false; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

// Parsing a 10^6-row file takes seconds and hundreds of MB of strings; keep
// it off the main thread and hand back only the typed arrays (transferred).
ctx.onmessage = async (event: MessageEvent<CatalogImportRequest>) => {
  try {
    const req = event.data;
    const result = req.kind === "file"
      ? parseCatalogText(await req.file.text())
      : { catalog: syntheticCatalog(req.preset, req.count, req.epochMs), format: "synthetic" as const, skipped: 0 };
    const response: CatalogImportResponse = { ok: true, ...result };
    ctx.postMessage(response, catalogTransferables(result.catalog));
  } catch (cause) {
    const response: CatalogImportResponse = {
      ok: false,
      message: cause instanceof Error ? cause.message : "カタログを読み込めませんでした",
    };
    ctx.postMessage(response);
  }
};
