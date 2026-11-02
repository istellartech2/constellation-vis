/** Sample both endpoints; a short final interval never extends the analysis window. */
export function analysisTimes(startMs: number, durationSeconds: number, stepSeconds: number): number[] {
  if (![startMs, durationSeconds, stepSeconds].every(Number.isFinite)
    || durationSeconds <= 0 || stepSeconds <= 0) {
    throw new Error("解析開始時刻・期間・刻みを正の有限値で指定してください");
  }
  const steps = Math.ceil(durationSeconds / stepSeconds);
  if (steps > 1_000_000) throw new Error("時間サンプルが多すぎます。期間を短くするか刻みを大きくしてください");
  const endMs = startMs + durationSeconds * 1000;
  return Array.from({ length: steps + 1 }, (_, i) => Math.min(endMs, startMs + i * stepSeconds * 1000));
}
