import { useState } from "react";
import { cn } from "../../../lib/utils";
import {
  STARMIND_LTAN_HOURS,
  SYNTHETIC_COUNTS,
  SYNTHETIC_PRESETS,
  type SyntheticPreset,
} from "../../../lib/syntheticCatalogs";
import { DestinationPicker, ImportFooter, ImportStatus } from "./ImportParts";
import { destinationBlock, type ImportTargets } from "./importTargets";
import { useCatalogWorker } from "./useCatalogWorker";

export default function SyntheticPanel({ targets }: { targets: ImportTargets }) {
  const [preset, setPreset] = useState<SyntheticPreset>("starmind");
  const [count, setCount] = useState<number>(SYNTHETIC_COUNTS[1]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const worker = useCatalogWorker();
  const info = SYNTHETIC_PRESETS.find((p) => p.id === preset)!;
  const epoch = new Date(targets.startText + "Z");

  async function generate() {
    setError(null);
    setBusy(`${info.label}を${count.toLocaleString()}機生成中…`);
    const result = await worker.run({ kind: "synthetic", preset, count, epochMs: epoch.getTime() });
    setBusy(null);
    if (!result.ok) { setError(result.message); return; }
    targets.addLayer({
      name: `${info.label} ${count.toLocaleString()}機`,
      kind: "synthetic",
      detail: preset === "starmind"
        ? `推定・実在しない · SSO LTAN ${STARMIND_LTAN_HOURS}:00 · 基準 ${targets.startText.replace("T", " ")} UTC`
        : "負荷試験用 · 実在しない衛星",
      catalog: result.catalog,
    });
    targets.close();
  }

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3 space-y-4">
        <p className="text-xs text-fg-muted">公開情報からの推定や負荷試験のための、実在しない衛星群を生成します。生成した衛星は表示専用で、実在の衛星と区別して描きます。</p>
        <section>
          <h3 className="text-sm font-semibold">プリセット</h3>
          <div role="radiogroup" aria-label="プリセット" className="mt-1.5 grid gap-1.5">
            {SYNTHETIC_PRESETS.map((p) => {
              const selected = preset === p.id;
              return (
                <button key={p.id} type="button" role="radio" aria-checked={selected} disabled={busy !== null} onClick={() => setPreset(p.id)}
                  className={cn("rounded-md border px-3 py-2 text-left transition-colors", selected ? "border-brand bg-brand-soft" : "border-line bg-raised hover:bg-raised-hover hover:border-line-strong")}>
                  <span className="block text-sm font-medium">{p.label}</span>
                  <span className="block text-[11px] leading-snug text-fg-muted">{p.summary}</span>
                </button>
              );
            })}
          </div>
        </section>

        {preset === "starmind" && (
          <details className="rounded-md border border-line px-3 py-2 text-xs text-fg-muted">
            <summary className="cursor-pointer text-fg">推定の根拠と仮定</summary>
            <ul className="mt-2 list-disc space-y-1 pl-4 leading-relaxed">
              <li>公開情報: SpaceXのFCC申請（2026年1月）は最大100万機、高度500–2,000 km、幅50 km以下の狭いシェル、太陽同期軌道の傾斜角を含むと報じられています。</li>
              <li>「常に日照下に置く」との説明から、明け方・夕方の境界（ターミネーター）に沿うドーン・ダスク太陽同期軌道（昇交点通過地方時 {STARMIND_LTAN_HOURS}:00）と仮定しました。軌道面は太陽方向にほぼ固定され、地球の昼夜境界に沿ったリング状に見えます。</li>
              <li>仮定: 500–2,000 kmに50 km刻みで31シェル・均等配分、軌道面は昼夜境界の±8°に分散、傾斜角は各高度の太陽同期条件（約97.4°〜105°）から算出。シェル内の面数・位相は公表されていません。</li>
              <li>報道で言及される傾斜角30°のシェルは記述が不明確なため含めていません。</li>
            </ul>
          </details>
        )}

        <section>
          <h3 className="text-sm font-semibold">機数</h3>
          <div role="radiogroup" aria-label="機数" className="mt-1.5 grid grid-cols-3 gap-1.5">
            {SYNTHETIC_COUNTS.map((n) => (
              <button key={n} type="button" role="radio" aria-checked={count === n} disabled={busy !== null} onClick={() => setCount(n)}
                className={cn("h-9 rounded-md border text-sm tabular-nums transition-colors", count === n ? "border-brand bg-brand-soft font-semibold" : "border-line bg-raised hover:bg-raised-hover")}>
                {n.toLocaleString()}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-fg-muted">基準日時は現在の開始時刻（{targets.startText.replace("T", " ")} UTC）です。</p>
        </section>

        <DestinationPicker value="layer" onChange={() => {}} count={count} targets={targets} fixed="layer" />
        <ImportStatus busy={busy} onCancel={() => { worker.stop(); setBusy(null); }} error={error} />
      </div>
      <ImportFooter
        hint="表示レイヤーに追加し、3Dビューにすぐ表示します。"
        primaryLabel={`${count.toLocaleString()} 機を生成して追加`}
        onPrimary={() => void generate()}
        disabled={!Number.isFinite(epoch.getTime()) || destinationBlock("layer", count, targets) !== null}
        busy={busy !== null}
        onCancel={targets.close}
      />
    </>
  );
}
