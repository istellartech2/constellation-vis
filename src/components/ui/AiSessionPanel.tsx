import { useEffect, useRef, useState } from "react";
import { Copy, Check, Eye, EyeOff, LoaderCircle, PlugZap, Unplug } from "lucide-react";
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
  const [copyFeedback, setCopyFeedback] = useState<"copied" | "manual" | null>(null);
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
          setSession(null); setStatus("有効期限が切れました。再開するには連携を開始してください。"); return;
        }
        if (pendingAck) {
          try { await sessionRequest(`/${session!.sessionId}`, "PATCH", session!.ownerToken, pendingAck, abort.signal); }
          catch (e) { if (!(e instanceof SessionClientError && e.status === 409)) throw e; }
          pendingAck = null;
        }
        const snapshot = await sessionRequest<SessionSnapshot>(`/${session!.sessionId}?after=${lastRevision}`, "GET", session!.ownerToken, undefined, abort.signal);
        if (abort.signal.aborted) return;
        if (failures > 0) setStatus("再接続しました。AIからの変更を待っています");
        if (snapshot.scenario && snapshot.revision !== lastRevision) {
          try {
            const committed = commitRemoteScenario(snapshot.scenario);
            applyRef.current(snapshot.scenario, committed);
            pendingAck = { revision: snapshot.revision, status: "applied" };
            setStatus(snapshot.revision === 0 ? "AIからの変更を待っています" : "AIの変更を反映しました");
          } catch {
            pendingAck = { revision: snapshot.revision, status: "error" };
            setStatus("変更を反映できませんでした。AIに設定の修正を依頼してください。");
          }
          lastRevision = snapshot.revision;
        }
        failures = 0;
      } catch (e) {
        if (abort.signal.aborted) return;
        if (e instanceof SessionClientError && e.status === 401) {
          setSession(null); setStatus("連携が終了しました。表示中の設定はそのまま残ります。"); return;
        }
        failures++;
        setStatus("通信が途切れました。再接続しています…");
      }
      if (!abort.signal.aborted) timer = setTimeout(poll, Math.min(30000, 2000 * 2 ** Math.min(failures, 4)));
    }
    void poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [session]);

  async function start() {
    if (startingRef.current) return;
    startingRef.current = true;
    setBusy(true); setStatus(""); setCopyFeedback(null);
    try {
      const scenario = getScenario();
      commitRemoteScenario(scenario);
      const created = await sessionRequest<SessionCredentials>("", "POST", undefined, { scenario });
      setSession(created); setShowCredentials(false); setStatus("AIからの変更を待っています");
    } catch { setStatus("開始できませんでした。シナリオの設定や通信を確認して、再試行してください。"); }
    finally { startingRef.current = false; setBusy(false); }
  }
  async function end() {
    if (!session) return;
    setBusy(true);
    try {
      await sessionRequest(`/${session.sessionId}`, "DELETE", session.ownerToken);
      setSession(null); setShowCredentials(false); setCopyFeedback(null); setStatus("連携を終了しました。表示中の設定はそのまま残ります。");
    } catch (e) {
      if (e instanceof SessionClientError && e.status === 401) { setSession(null); setStatus("連携は終了済みです。"); }
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
    <section className="mb-5 rounded-xl border border-slate-700 bg-slate-900 p-4 text-slate-100" aria-label="AI連携">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><PlugZap aria-hidden="true" className="size-4 text-blue-400" />AI連携</h3>
        {session && <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2 py-1 text-xs font-medium text-emerald-300"><span className="size-1.5 rounded-full bg-emerald-400" aria-hidden="true" />連携中</span>}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-300">
        {session ? "接続情報をコピーして、AIのチャットに貼り付けてください。" : "AIから、この画面のシナリオと表示設定を操作できます。"}
      </p>
      {!session && <p className="mt-2 text-xs text-slate-400">連携を開始 → 接続情報をAIに渡す</p>}
      <div className="mt-4">
        {session ? <>
          <Button className="h-11 w-full cursor-pointer bg-blue-600 text-white shadow-sm hover:bg-blue-500 focus-visible:ring-blue-400" disabled={busy} onClick={async () => {
            try { await navigator.clipboard.writeText(instructions); setCopyFeedback("copied"); }
            catch { setShowCredentials(true); setCopyFeedback("manual"); }
          }}>
            {copyFeedback === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copyFeedback === "copied" ? "コピー済み・AIに貼り付け" : "AI用の接続情報をコピー"}
          </Button>
          <p role="status" className="mt-2 text-xs text-blue-200">
            {copyFeedback === "copied" ? "AIに貼り付けて、変更したい内容を伝えてください。" : copyFeedback === "manual" ? "下の接続情報を選択してコピーしてください。" : "接続情報は秘密として扱ってください。"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="h-9 cursor-pointer border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white" disabled={busy} aria-expanded={showCredentials} aria-controls="ai-session-credentials" onClick={() => setShowCredentials((v) => !v)}>
              {showCredentials ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}{showCredentials ? "接続情報を隠す" : "接続情報を表示"}
            </Button>
            <Button size="sm" variant="outline" className="h-9 cursor-pointer border-slate-600 bg-slate-800 text-slate-200 hover:border-red-400 hover:bg-red-950 hover:text-red-200" disabled={busy} onClick={() => void end()}>
              {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Unplug aria-hidden="true" />}{busy ? "終了中…" : "連携を終了"}
            </Button>
          </div>
        </> : <Button className="h-11 w-full cursor-pointer bg-blue-600 text-white shadow-sm hover:bg-blue-500 focus-visible:ring-blue-400" disabled={busy} onClick={() => void start()}>
          {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <PlugZap aria-hidden="true" />}{busy ? "開始中…" : "AI連携を開始"}
        </Button>}
      </div>
      {showCredentials && session && <textarea id="ai-session-credentials" aria-label="AI用の接続情報（秘密）" readOnly value={instructions} onFocus={(e) => e.target.select()} className="mt-3 h-40 w-full rounded-md border border-slate-600 bg-slate-950 p-3 font-mono text-xs text-slate-200 focus-visible:outline-2 focus-visible:outline-blue-400" />}
      {status && <p role="status" className="mt-3 text-xs leading-relaxed text-slate-300">{status}</p>}
      {session && <p className="mt-2 text-xs text-slate-400">{new Date(session.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}まで有効 · この画面を開いたままお使いください</p>}
      <details className="mt-3 border-t border-slate-700 pt-3 text-xs text-slate-400">
        <summary className="w-fit cursor-pointer rounded hover:text-slate-200 focus-visible:outline-2 focus-visible:outline-blue-400">データの保存と連携の終了について</summary>
        <p className="mt-2 leading-relaxed">設定は非公開の一時データとして保存され、1時間で自動削除されます。「連携を終了」でも削除できます。終了後も画面の表示は残ります。再読み込みした場合は、もう一度連携を開始してください。</p>
      </details>
    </section>
  );
}
