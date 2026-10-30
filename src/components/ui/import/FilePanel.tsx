import { useState } from "react";
import { useCatalogWorker } from "./useCatalogWorker";
import { catalogSpecAt, type SatelliteCatalog } from "../../../lib/satelliteCatalog";
import { DestinationPicker, FileDropZone, ImportFooter, ImportStatus, ImportSummary } from "./ImportParts";
import { destinationBlock, recommendedDestination, type ImportDestination, type ImportTargets } from "./importTargets";

/** Largest file read (V8 strings top out around 512 MB). */
const MAX_CATALOG_FILE_BYTES = 480 * 1024 * 1024;
const FORMAT_LABEL = { tle: "TLE/3LE", "omm-json": "OMM JSON", "omm-csv": "OMM CSV", synthetic: "合成" } as const;

interface Parsed {
  name: string;
  catalog: SatelliteCatalog;
  detail: string;
}

export default function FilePanel({ targets }: { targets: ImportTargets }) {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [destination, setDestination] = useState<ImportDestination>("layer");
  const worker = useCatalogWorker();

  async function load(file: File) {
    if (file.size > MAX_CATALOG_FILE_BYTES) { setError("ファイルが大きすぎます（上限 480 MB）。分割して読み込んでください。"); return; }
    setError(null);
    setBusy(`${file.name} を解析中…`);
    const result = await worker.run({ kind: "file", file });
    setBusy(null);
    if (!result.ok) { setError(result.message); return; }
    const count = result.catalog.count;
    setParsed({
      name: file.name.replace(/\.(txt|tle|3le|json|csv)$/i, ""),
      catalog: result.catalog,
      detail: `${FORMAT_LABEL[result.format]}${result.skipped ? ` · ${result.skipped.toLocaleString()}行を除外` : ""}`,
    });
    setDestination(recommendedDestination(count));
  }

  function add() {
    if (!parsed) return;
    try {
      if (destination === "scenario") {
        const cat = parsed.catalog;
        targets.addToScenario(Array.from({ length: cat.count }, (_, i) => {
          const spec = catalogSpecAt(cat, i);
          return { ...spec, meta: { ...spec.meta, noradCatId: cat.satnum[i] } };
        }));
      } else {
        targets.addLayer({ name: parsed.name, kind: "file", detail: parsed.detail, catalog: parsed.catalog });
      }
      targets.close();
    } catch (cause) {
      setError("追加できませんでした: " + (cause as Error).message);
    }
  }

  const count = parsed?.catalog.count ?? null;
  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3 space-y-3">
        {!parsed ? (
          <>
            <FileDropZone accept=".txt,.tle,.3le,.json,.csv" title="軌道要素ファイルを開く" description="TLE/3LE（.txt/.tle）、OMM JSON、OMM CSV（Space-Track・CelesTrak形式）" busy={busy !== null} onFile={(f) => void load(f)} />
            <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-fg-muted">
              <li>100万機規模ではTLEかCSVが軽量です（JSONは文字列が大きくなります）。</li>
              <li>形式は自動判定します。読み取れない行は除外して件数を表示します。</li>
            </ul>
          </>
        ) : (
          <>
            <ImportSummary title={parsed.name} count={parsed.catalog.count} detail={parsed.detail} onReset={() => { setParsed(null); setError(null); }} />
            <DestinationPicker value={destination} onChange={setDestination} count={count} targets={targets} />
          </>
        )}
        <ImportStatus busy={busy} onCancel={() => { worker.stop(); setBusy(null); }} error={error} />
      </div>
      <ImportFooter
        hint={!parsed ? undefined : destination === "scenario" ? "同じ衛星番号はエポックの新しいものに更新し、3Dビューにすぐ反映します。" : "新しい表示レイヤーとして、3Dビューにすぐ表示します。"}
        primaryLabel={!parsed ? "ファイルを選んでください" : `${parsed.catalog.count.toLocaleString()} 機を${destination === "scenario" ? "シナリオ" : "レイヤー"}に追加`}
        onPrimary={add}
        disabled={!parsed || (count !== null && destinationBlock(destination, count, targets) !== null)}
        busy={busy !== null}
        onCancel={targets.close}
      />
    </>
  );
}
