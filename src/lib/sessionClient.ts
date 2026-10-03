import type { RemoteScenario } from "./remoteScenario";
export interface SessionCredentials {
  sessionId: string;
  ownerToken: string;
  controllerToken: string;
  expiresAt: string;
}
export interface SessionSnapshot {
  revision: number;
  appliedRevision: number;
  applicationStatus: "pending" | "applied" | "error";
  expiresAt: string;
  scenario?: RemoteScenario;
}
export class SessionClientError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export async function sessionRequest<T>(path: string, method: string, token?: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/sessions${path}`, {
    method, signal, cache: "no-store", credentials: "omit",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new SessionClientError(response.status, result.error ?? "AI連携に失敗しました");
  return result as T;
}
