import { useEffect, useRef, useState } from "react";
import { Button } from "./button";
import { commitRemoteScenario, type RemoteScenario } from "../../lib/remoteScenario";
import { sessionRequest, SessionClientError, type SessionCredentials, type SessionSnapshot } from "../../lib/sessionClient";
import type { CommittedScenario } from "../../lib/scenario";

interface Props {
  getScenario: () => RemoteScenario;
  onApply: (scenario: RemoteScenario, committed: CommittedScenario) => void;
}
export default function AiSessionPanel({ getScenario, onApply }: Props) {
  const [session, setSession] = useState<SessionCredentials | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [showCredentials, setShowCredentials] = useState(false);
  const applyRef = useRef(onApply);
  const startingRef = useRef(false);
  useEffect(() => { applyRef.current = onApply; }, [onApply]);

  useEffect(() => {
    if (!session) return;
    const abort = new AbortController();
    let lastRevision = -1;
    let pendingAck: { revision: number; status: "applied" | "error" } | null = null;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    async function poll() {
      try {
        if (Date.now() >= new Date(session!.expiresAt).getTime()) {
          setSession(null); setStatus("有効期限が切れました。表示中のデータはブラウザに残ります。"); return;
        }
        if (pendingAck) {
          try { await sessionRequest(`/${session!.sessionId}`, "PATCH", session!.ownerToken, pendingAck, abort.signal); }
          catch (e) { if (!(e instanceof SessionClientError && e.status === 409)) throw e; }
          pendingAck = null;
        }
        const snapshot = await sessionRequest<SessionSnapshot>(`/${session!.sessionId}?after=${lastRevision}`, "GET", session!.ownerToken, undefined, abort.signal);
        if (abort.signal.aborted) return;
        if (snapshot.scenario && snapshot.revision !== lastRevision) {
          try {
            const committed = commitRemoteScenario(snapshot.scenario);
            applyRef.current(snapshot.scenario, committed);
            pendingAck = { revision: snapshot.revision, status: "applied" };
            setStatus(`接続中 · 更新 ${snapshot.revision} を反映しました`);
          } catch {
            pendingAck = { revision: snapshot.revision, status: "error" };
            setStatus("設定を反映できませんでした。AIに設定の修正を依頼してください。");
          }
          lastRevision = snapshot.revision;
        }
        failures = 0;
      } catch (e) {
        if (abort.signal.aborted) return;
        if (e instanceof SessionClientError && e.status === 401) {
          setSession(null); setStatus("セッションが終了しました。表示中のデータはブラウザに残ります。"); return;
        }
        failures++;
        setStatus("接続を再試行しています…");
      }
      if (!abort.signal.aborted) timer = setTimeout(poll, Math.min(30000, 2000 * 2 ** Math.min(failures, 4)));
    }
    void poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [session]);

  async function start() {
    if (startingRef.current) return;
    startingRef.current = true;
    setBusy(true); setStatus("");
    try {
      const scenario = getScenario();
      commitRemoteScenario(scenario);
      const created = await sessionRequest<SessionCredentials>("", "POST", undefined, { scenario });
      setSession(created); setShowCredentials(false); setStatus("接続中");
    } catch (e) { setStatus(e instanceof Error ? e.message : "開始に失敗しました"); }
    finally { startingRef.current = false; setBusy(false); }
  }
  async function end() {
    if (!session) return;
    setBusy(true);
    try {
      await sessionRequest(`/${session.sessionId}`, "DELETE", session.ownerToken);
      setSession(null); setShowCredentials(false); setStatus("連携を終了し、サーバーの一時データを削除しました。");
    } catch (e) {
      if (e instanceof SessionClientError && e.status === 401) { setSession(null); setStatus("セッションは終了済みです。"); }
      else setStatus("終了処理に失敗しました。再試行してください。");
    } finally { setBusy(false); }
  }
  const instructions = session ? [
    "このブラウザの衛星シナリオをHTTP APIで操作してください。認証情報は秘密として扱い、URLやログに出さないでください。",
    `API: ${window.location.origin}/api/sessions/${session.sessionId}`,
    `Authorization: Bearer ${session.controllerToken}`,
    `有効期限: ${session.expiresAt}`,
    `仕様: ${window.location.origin}/ai-api.md`,
    'まずGETでscenarioとrevisionを取得。PUTに {"expectedRevision":取得したrevision,"operation":...} を送る。',
    '表示だけの変更: operation={"type":"display","settings":{"whiteBackground":true,"showGraticule":false}}。省略した設定と衛星データは保持されます。対応フィールドは仕様を参照。',
    'operation: {"type":"replace","scenario":{"satText":"...","constText":"...","gsText":"...","startTime":"ISO UTC Z"}}',
    'または {"type":"append","section":"satellites|constellation|groundstations","text":"TOML"}、{"type":"remove","section":"...","index":0}、{"type":"clear","section":"..."}。',
    "GETでapplicationStatusがappliedになったことを確認してください。409の場合はGETし直してください。",
  ].join("\n") : "";
  return (
    <section className="mb-5 rounded-lg border border-gray-600 bg-gray-900/50 p-3" aria-label="AI連携">
      <h3 className="text-sm font-semibold text-gray-100">AI連携</h3>
      <p className="mt-1 text-xs text-gray-300">現在の設定を非公開の一時セッションに送信します。1時間で失効し、終了すると削除されます。AIの変更は自動で反映されます。</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {session ? <>
          <Button size="sm" disabled={busy} onClick={async () => {
            try { await navigator.clipboard.writeText(instructions); setStatus("AI向け接続情報をコピーしました"); }
            catch { setShowCredentials(true); setStatus("接続情報を選択してコピーしてください"); }
          }}>AI向け接続情報をコピー</Button>
          <Button size="sm" variant="outline" className="bg-gray-800 text-gray-100 hover:bg-gray-700" disabled={busy} onClick={() => void end()}>連携を終了</Button>
          <Button size="sm" variant="ghost" onClick={() => setShowCredentials((v) => !v)}>{showCredentials ? "接続情報を隠す" : "接続情報を表示"}</Button>
        </> : <Button size="sm" disabled={busy} onClick={() => void start()}>{busy ? "開始中…" : "AI連携を開始"}</Button>}
      </div>
      {session && <p className="mt-2 text-xs text-gray-400">期限: {new Date(session.expiresAt).toLocaleString()} · 画面を開いている間に反映します。再読み込み後は新しい連携を開始してください。</p>}
      {showCredentials && session && <textarea aria-label="AI向け接続情報（秘密）" readOnly value={instructions} className="mt-2 h-40 w-full rounded border border-gray-600 bg-gray-950 p-2 font-mono text-xs text-gray-200" />}
      <p role="status" className="mt-2 text-xs text-gray-300">{status}</p>
    </section>
  );
}
