/// <reference lib="webworker" />
import { Buffer } from "buffer";
import process from "process";
import { parseFilingTables } from "../lib/filings/parse";
import { createFilingExtract } from "../lib/filings/extract";
import type { FilingRow, FilingWorkerResponse } from "../lib/filings/types";
const ctx = self as unknown as DedicatedWorkerGlobalScope;
ctx.onmessage = async (event: MessageEvent<{ buffer: ArrayBuffer; filename: string }>) => {
  try {
    // mdb-reader's browser build uses Buffer internally. Confine the polyfill
    // and its heavy dependencies to this short-lived, on-demand worker.
    (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
    (globalThis as unknown as { process: typeof process }).process = process;
    const { default: MDBReader } = await import("mdb-reader");
    const { buffer, filename } = event.data;
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    const sha256 = [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, "0")).join("");
    const reader = new MDBReader(Buffer.from(buffer));
    const names = reader.getTableNames();
    const rows = (name: string) => {
      if (!names.includes(name)) throw new Error(`「${name}」テーブルがありません。GIMSではなく「SNS(MDB) As Received Copy」のMDBを選んでください。`);
      const table = reader.getTable(name);
      if (table.rowCount > 100000) throw new Error("単一申請として大きすぎるテーブルです。個別申請のSNS MDBを選んでください。");
      return table.getData() as FilingRow[];
    };
    const tables = { notice: rows("notice"), non_geo: rows("non_geo"), orbit: rows("orbit"), phase: rows("phase") };
    const dataset = parseFilingTables(tables, filename, sha256);
    ctx.postMessage({ ok: true, dataset, extract: createFilingExtract(tables, filename, sha256) } satisfies FilingWorkerResponse);
  } catch (error) {
    ctx.postMessage({ ok: false, message: error instanceof Error ? error.message : "MDBを読み込めませんでした。" } satisfies FilingWorkerResponse);
  }
};
