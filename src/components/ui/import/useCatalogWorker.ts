import { useEffect, useRef } from "react";
import type { CatalogImportResponse } from "../../../workers/catalogImportWorker";

/** Spawn the catalog worker; shared by the file and synthetic sources. */
export function useCatalogWorker() {
  const workerRef = useRef<Worker | null>(null);
  const stop = () => { workerRef.current?.terminate(); workerRef.current = null; };
  useEffect(() => () => workerRef.current?.terminate(), []);
  const run = (request: unknown, transfer: Transferable[] = []) => new Promise<CatalogImportResponse>((resolve) => {
    stop();
    const worker = new Worker(new URL("../../../workers/catalogImportWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<CatalogImportResponse>) => {
      if (workerRef.current !== worker) return;
      stop();
      resolve(event.data);
    };
    worker.onerror = () => {
      if (workerRef.current !== worker) return;
      stop();
      resolve({ ok: false, message: "読み込みに失敗しました。メモリ不足の可能性があります。TLEかCSVを使うか、ファイルを分割してください。" });
    };
    worker.postMessage(request, transfer);
  });
  return { run, stop };
}
