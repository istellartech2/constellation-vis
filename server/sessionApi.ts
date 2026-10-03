import { randomBytes, timingSafeEqual } from "node:crypto";
import { applyScenarioOperation, emptyScenario, MAX_SCENARIO_BYTES } from "../src/lib/remoteScenario";
import { tokenHash, type SessionStore } from "./sessionStore";

export const SESSION_TTL_SECONDS = 3600;
class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const headers = { "Cache-Control": "no-store, private", "Content-Type": "application/json", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers }); }
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ApiError(415, "Use application/json");
  if (Number(request.headers.get("content-length")) > MAX_SCENARIO_BYTES) throw new ApiError(413, "Request exceeds 256 KiB");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "JSON body required");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_SCENARIO_BYTES) { await reader.cancel(); throw new ApiError(413, "Request exceeds 256 KiB"); }
    chunks.push(value);
  }
  try {
    const result: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
    return result as Record<string, unknown>;
  } catch { throw new ApiError(400, "Invalid JSON object"); }
}
function matches(token: string, hash: string) {
  const actual = Buffer.from(tokenHash(token), "hex");
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Injectable store/clock make authorization, expiry and concurrency deterministic in tests. */
export async function handleSessionRequest(request: Request, store: SessionStore, now = Date.now()): Promise<Response> {
  try {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) throw new ApiError(403, "Cross-origin requests are not allowed");
    const path = url.pathname.match(/^\/api\/sessions(?:\/([a-f0-9]{32}))?\/?$/);
    if (!path) throw new ApiError(404, "Not found");
    const id = path[1];
    if (!id) {
      if (request.method !== "POST") throw new ApiError(405, "Use POST to create a session");
      const ip = request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for") ?? "local";
      if (!await store.rateLimit(`create:${tokenHash(ip)}`, 10, 3600)) throw new ApiError(429, "Session creation limit reached; retry later");
      const input = await body(request);
      let scenario;
      try { scenario = applyScenarioOperation(emptyScenario(), { type: "replace", scenario: input.scenario ?? emptyScenario() }); } catch (e) { throw new ApiError(400, (e as Error).message); }
      const sessionId = randomBytes(16).toString("hex");
      const ownerToken = randomBytes(32).toString("base64url");
      const controllerToken = randomBytes(32).toString("base64url");
      const expiresAt = new Date(now + SESSION_TTL_SECONDS * 1000).toISOString();
      await store.create(sessionId, { ownerHash: tokenHash(ownerToken), controllerHash: tokenHash(controllerToken), expiresAt, revision: 0, appliedRevision: -1, applicationStatus: "pending", scenario: scenario as ReturnType<typeof emptyScenario> }, SESSION_TTL_SECONDS);
      return json({ sessionId, ownerToken, controllerToken, expiresAt, revision: 0 }, 201);
    }
    const token = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!token) throw new ApiError(401, "A session Bearer token is required");
    const record = await store.get(id);
    // Missing IDs and wrong credentials deliberately have the same response.
    if (!record || new Date(record.expiresAt).getTime() <= now || (!matches(token, record.ownerHash) && !matches(token, record.controllerHash))) throw new ApiError(401, "Invalid or expired session credentials");
    const owner = matches(token, record.ownerHash);
    if (!await store.rateLimit(`request:${id}:${owner ? "owner" : "controller"}`, 120, 60)) throw new ApiError(429, "Session request limit reached; retry later");
    if (request.method === "GET") {
      const { scenario, revision, appliedRevision, applicationStatus, expiresAt } = record;
      return json({ sessionId: id, revision, appliedRevision, applicationStatus, expiresAt, ...(url.searchParams.get("after") === String(revision) ? {} : { scenario }) });
    }
    if (request.method === "DELETE") {
      if (!owner) throw new ApiError(403, "Only the browser owner can end a session");
      await store.delete(id);
      return json({ ended: true });
    }
    if (request.method === "PATCH") {
      if (!owner) throw new ApiError(403, "Only the browser can acknowledge application");
      const input = await body(request);
      if (!Number.isInteger(input.revision) || !["applied", "error"].includes(String(input.status))) throw new ApiError(400, "revision and status (applied or error) are required");
      const updated = await store.acknowledge(id, Number(input.revision), input.status as "applied" | "error");
      if (!updated) throw new ApiError(409, "Revision has changed");
      return json({ acknowledged: true });
    }
    if (request.method === "PUT") {
      const input = await body(request);
      if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== record.revision) throw new ApiError(409, "Read the current revision and pass expectedRevision");
      let scenario;
      try { scenario = applyScenarioOperation(record.scenario, input.operation); } catch (e) { throw new ApiError(400, (e as Error).message); }
      if (!await store.update(id, record.revision, scenario)) throw new ApiError(409, "Revision has changed");
      return json({ revision: record.revision + 1, applicationStatus: "pending" });
    }
    throw new ApiError(405, "Supported methods: GET, PUT, PATCH, DELETE");
  } catch (e) {
    if (e instanceof ApiError) return json({ error: e.message }, e.status);
    // Never log or return credentials, scenario content or provider errors.
    return json({ error: "Session service unavailable" }, 503);
  }
}
