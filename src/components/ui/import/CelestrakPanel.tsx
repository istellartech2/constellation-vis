import { useMemo, useState } from "react";
import { Checkbox } from "../checkbox";
import { cn } from "../../../lib/utils";
import { catalogFromOmmRecords } from "../../../lib/catalogParsers";
import {
  CELESTRAK_GROUP_TREE,
  celestrakEntryToSat,
  fetchCelestrakGroup,
  type CelestrakEntry,
} from "../../../utils/celestrakUtils";
import { DestinationPicker, ImportFooter, ImportStatus, ImportSummary } from "./ImportParts";
import { DESTINATION_NAMES, destinationBlock, recommendedDestination, type ImportDestination, type ImportTargets } from "./importTargets";

/** Groups that alone carry over ten thousand objects (active ~17k, Starlink ~11k in 2026-10); selecting one suggests a layer. */
const LARGE_GROUPS = new Set(["active", "starlink"]);

const CATEGORIES = CELESTRAK_GROUP_TREE.map((node) => ({
  id: node.id,
  label: node.label,
  leaves: node.children?.map((c) => ({ id: c.id, label: c.label })) ?? [{ id: node.id, label: node.label }],
}));
const LABELS = new Map(CATEGORIES.flatMap((c) => c.leaves.map((l) => [l.id, l.label] as const)));

interface Fetched {
  groups: string[];
  entries: CelestrakEntry[];
  notes: string[];
}

/** CelesTrak omits the zone suffix, but its OMM epochs are always UTC. */
const epochMs = (text: string) => Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`);

/** Overlapping groups (e.g. 運用中衛星 and Starlink) list the same object; keep its newest epoch. */
function dedupeEntries(entries: CelestrakEntry[]): CelestrakEntry[] {
  const byId = new Map<number, CelestrakEntry>();
  for (const e of entries) {
    const prev = byId.get(Number(e.NORAD_CAT_ID));
    if (!prev || epochMs(prev.EPOCH) < epochMs(e.EPOCH)) byId.set(Number(e.NORAD_CAT_ID), e);
  }
  return [...byId.values()];
}

export default function CelestrakPanel({ targets }: { targets: ImportTargets }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [destination, setDestination] = useState<ImportDestination>("scenario");
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const anyLarge = selected.some((g) => LARGE_GROUPS.has(g));

  const toggle = (id: string) => {
    const next = selectedSet.has(id) ? selected.filter((g) => g !== id) : [...selected, id];
    setSelected(next);
    setDestination(next.some((g) => LARGE_GROUPS.has(g)) ? "layer" : "scenario");
  };

  async function fetchSelected() {
    setBusy(`CelesTrak から ${selected.length} グループを取得中…`);
    setError(null);
    const notes: string[] = [];
    const entries: CelestrakEntry[] = [];
    try {
      for (const g of selected) {
        const result = await fetchCelestrakGroup(g);
        if (result.note) notes.push(result.note);
        entries.push(...(result.data ?? []));
        if (result.stopImport) break;
      }
      const unique = dedupeEntries(entries);
      if (unique.length === 0) {
        setError(notes.join("\n\n") || "取得できる衛星データがありませんでした。");
        return;
      }
      setFetched({ groups: selected, entries: unique, notes });
      setDestination((prev) => destinationBlock(prev, unique.length, targets) ? recommendedDestination(unique.length) : prev);
    } catch (cause) {
      setError("取得に失敗しました: " + (cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function add() {
    if (!fetched) return;
    const names = fetched.groups.map((g) => LABELS.get(g) ?? g);
    try {
      if (destination === "scenario") {
        const specs = fetched.entries.flatMap((e) => { try { return [celestrakEntryToSat(e)]; } catch { return []; } });
        targets.addToScenario(specs);
      } else {
        const { catalog } = catalogFromOmmRecords(fetched.entries);
        const fetchedAt = new Date().toISOString().slice(0, 16).replace("T", " ");
        targets.addLayer({ name: `CelesTrak ${names.join("・")}`, kind: "celestrak", detail: `GP（OMM）· 取得 ${fetchedAt} UTC`, catalog });
      }
      targets.close();
    } catch (cause) {
      setError("追加できませんでした: " + (cause as Error).message);
    }
  }

  const count = fetched?.entries.length ?? null;
  const block = count === null ? null : destinationBlock(destination, count, targets);

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3 space-y-3">
        {!fetched ? (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs text-fg-muted">CelesTrak の最新 GP（軌道要素）をグループ単位で取得します。同じグループの再取得は2時間に1回までです（それ以内は保存済みデータを使います）。</p>
              {selected.length > 0 && <button type="button" onClick={() => { setSelected([]); setDestination("scenario"); }} className="shrink-0 text-xs text-fg-muted hover:text-brand-text">選択をクリア</button>}
            </div>
            {CATEGORIES.map((cat) => (
              <section key={cat.id}>
                <h3 className="mb-1.5 text-sm font-semibold">{cat.label}<span className="ml-1.5 text-xs font-normal text-fg-muted">({cat.leaves.filter((l) => selectedSet.has(l.id)).length}/{cat.leaves.length})</span></h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {cat.leaves.map((leaf) => {
                    const checked = selectedSet.has(leaf.id);
                    return (
                      <label key={leaf.id} className={cn(
                        "flex items-center gap-2 min-h-9 max-md:min-h-10 px-2 py-1 rounded-md border cursor-pointer transition-colors select-none",
                        checked ? "border-brand bg-brand-soft" : "border-line bg-raised hover:bg-raised-hover hover:border-line-strong",
                        busy && "opacity-50 cursor-not-allowed",
                      )}>
                        <Checkbox checked={checked} disabled={busy !== null} onCheckedChange={() => toggle(leaf.id)} className="size-4 shrink-0" />
                        <span className="flex-1 text-sm leading-snug">{leaf.label}</span>
                        {LARGE_GROUPS.has(leaf.id) && <span className="text-[10px] text-fg-subtle">1万機超</span>}
                      </label>
                    );
                  })}
                </div>
              </section>
            ))}
          </>
        ) : (
          <>
            <ImportSummary
              title={fetched.groups.map((g) => LABELS.get(g) ?? g).join("・")}
              count={fetched.entries.length}
              detail="CelesTrak GP · 重複する衛星は最新のエポックに統合"
              onReset={() => { setFetched(null); setError(null); }}
            />
            {fetched.notes.length > 0 && <ul className="list-disc space-y-1 pl-4 text-[11px] text-fg-muted">{fetched.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
            <DestinationPicker value={destination} onChange={setDestination} count={count} targets={targets} />
          </>
        )}
        <ImportStatus busy={busy} error={error} />
      </div>
      {!fetched ? (
        <ImportFooter
          hint={selected.length === 0 ? "取得するグループを選んでください" : anyLarge ? "大きなグループを含むため、「表示するだけ」をおすすめします" : undefined}
          primaryLabel={selected.length === 0 ? "グループを選択" : `${selected.length} グループを取得`}
          onPrimary={() => void fetchSelected()}
          disabled={selected.length === 0}
          busy={busy !== null}
          onCancel={targets.close}
        />
      ) : (
        <ImportFooter
          hint={destination === "scenario" ? "同じ衛星番号はエポックの新しいものに更新し、3Dビューにすぐ反映します。" : "3Dビューにすぐ表示します。"}
          primaryLabel={`${fetched.entries.length.toLocaleString()} 機を${DESTINATION_NAMES[destination]}に追加`}
          onPrimary={add}
          disabled={block !== null}
          onCancel={targets.close}
        />
      )}
    </>
  );
}
