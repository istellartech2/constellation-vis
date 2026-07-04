import type { IslPathResult, IslSettings } from "../../lib/isl/types";

interface Props {
  islSettings: IslSettings;
  islResult: IslPathResult | null;
  islSwitchCount: number;
  /** Opens the side panel on the 通信 tab. */
  onClick: () => void;
}

/**
 * Compact floating card (bottom-right, above the clock) showing the live ISL
 * route metrics while routing is enabled — visible even when the side panel
 * is closed, since the main use case is watching the path on the globe.
 */
export default function IslHud({ islSettings, islResult, islSwitchCount, onClick }: Props) {
  if (!islSettings.enabled) return null;

  const endpointsSet = islSettings.endpointA !== null && islSettings.endpointB !== null;
  const nameA = islSettings.endpointA?.name ?? "未設定";
  const nameB = islSettings.endpointB?.name ?? "未設定";

  return (
    <button
      type="button"
      onClick={onClick}
      title="クリックで通信タブを開く"
      style={{
        position: "fixed",
        right: 8,
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 58px)",
        zIndex: 10,
        textAlign: "right",
        cursor: "pointer",
      }}
      className="bg-gray-900/85 border border-gray-600 rounded-lg px-2.5 py-1.5 backdrop-blur-sm hover:border-orange-400 transition-colors"
    >
      <div className="text-[11px] text-gray-300 truncate max-w-[220px]">
        {nameA} ⇄ {nameB}
      </div>
      {!endpointsSet ? (
        <div className="text-xs text-amber-400">地点を選択してください</div>
      ) : !islResult ? (
        <div className="text-xs text-gray-400">計算中…</div>
      ) : !islResult.reachable ? (
        <div className="text-sm font-semibold text-red-400">経路なし</div>
      ) : (
        <>
          <div className="text-sm font-semibold text-gray-100 tabular-nums">
            {islResult.totalDelayMs.toFixed(1)} ms ・ {islResult.hopCount} hop
          </div>
          <div className="text-[11px] text-gray-400 tabular-nums">経路切替 {islSwitchCount} 回</div>
        </>
      )}
    </button>
  );
}
