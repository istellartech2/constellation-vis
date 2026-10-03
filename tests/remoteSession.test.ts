import { describe, it, expect } from "bun:test";
import { handleSessionRequest, SESSION_TTL_SECONDS } from "../server/sessionApi";
import { decryptScenario, encryptScenario, type SessionRecord, type SessionStore } from "../server/sessionStore";
import { applyScenarioOperation, commitRemoteScenario, emptyScenario, type RemoteScenario } from "../src/lib/remoteScenario";

class MemoryStore implements SessionStore {
  records = new Map<string, SessionRecord>();
  limits = new Map<string, number>();
  async create(id: string, record: SessionRecord) { this.records.set(id, structuredClone(record)); }
  async get(id: string) { return structuredClone(this.records.get(id) ?? null); }
  async update(id: string, expected: number, scenario: RemoteScenario) {
    const record = this.records.get(id);
    if (!record || record.revision !== expected) return false;
    record.scenario = scenario; record.revision++; record.applicationStatus = "pending"; return true;
  }
  async acknowledge(id: string, revision: number, status: "applied" | "error") {
    const record = this.records.get(id);
    if (!record || record.revision !== revision) return false;
    record.appliedRevision = revision; record.applicationStatus = status; return true;
  }
  async delete(id: string) { this.records.delete(id); }
  async rateLimit(key: string, limit: number) {
    const n = (this.limits.get(key) ?? 0) + 1; this.limits.set(key, n); return n <= limit;
  }
}
const now = Date.parse("2026-10-03T00:00:00Z");
function request(path: string, method = "GET", token?: string, input?: unknown, extraHeaders = {}) {
  return new Request(`https://example.com/api/sessions${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
async function create(store: MemoryStore) {
  const response = await handleSessionRequest(request("", "POST", undefined, {}), store, now);
  expect(response.status).toBe(201);
  return await response.json() as { sessionId: string; ownerToken: string; controllerToken: string; expiresAt: string };
}
const station = '[[groundstations]]\nname = "Tokyo"\nlatitudeDeg = 35\nlongitudeDeg = 139\nheightKm = 0\nminElevationDeg = 10\n';
const shell = '[constellation]\nepoch = "2026-10-03T00:00:00Z"\n[[constellation.shells]]\nname = "demo"\ncount = 4\nplanes = 2\napogee_altitude = 550\ninclination = 53\n';

describe("private temporary sessions", () => {
  it("requires capabilities on every read, isolates sessions and never returns hashes/tokens", async () => {
    const store = new MemoryStore(); const a = await create(store); const b = await create(store);
    for (const token of [undefined, b.controllerToken]) expect((await handleSessionRequest(request(`/${a.sessionId}`, "GET", token), store, now)).status).toBe(401);
    const response = await handleSessionRequest(request(`/${a.sessionId}`, "GET", a.controllerToken), store, now);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const data = await response.json(); expect(data.ownerToken).toBeUndefined(); expect(data.controllerHash).toBeUndefined();
    expect(store.records.get(a.sessionId)?.controllerHash).not.toBe(a.controllerToken);
    expect(a.ownerToken).not.toBe(a.controllerToken);
  });
  it("applies changes with revision checks and only lets the browser acknowledge/end", async () => {
    const store = new MemoryStore(); const s = await create(store); const path = `/${s.sessionId}`;
    const update = { expectedRevision: 0, operation: { type: "append", section: "groundstations", text: station } };
    const results = await Promise.all([handleSessionRequest(request(path, "PUT", s.controllerToken, update), store, now), handleSessionRequest(request(path, "PUT", s.controllerToken, update), store, now)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await handleSessionRequest(request(path, "PATCH", s.controllerToken, { revision: 1, status: "applied" }), store, now)).status).toBe(403);
    expect((await handleSessionRequest(request(path, "PATCH", s.ownerToken, { revision: 0, status: "applied" }), store, now)).status).toBe(409);
    expect((await handleSessionRequest(request(path, "PATCH", s.ownerToken, { revision: 1, status: "applied" }), store, now)).status).toBe(200);
    const snapshot = await (await handleSessionRequest(request(`${path}?after=1`, "GET", s.controllerToken), store, now)).json();
    expect(snapshot.scenario).toBeUndefined(); expect(snapshot.applicationStatus).toBe("applied");
    expect((await handleSessionRequest(request(path, "DELETE", s.controllerToken), store, now)).status).toBe(403);
    expect((await handleSessionRequest(request(path, "DELETE", s.ownerToken), store, now)).status).toBe(200);
    expect((await handleSessionRequest(request(path, "GET", s.ownerToken), store, now)).status).toBe(401);
    expect(await store.acknowledge(s.sessionId, 1, "applied")).toBe(false);
  });
  it("rejects expired tokens, cross-origin requests, oversized bodies and excessive creation", async () => {
    const store = new MemoryStore(); const s = await create(store);
    expect((await handleSessionRequest(request(`/${s.sessionId}`, "GET", s.ownerToken), store, now + SESSION_TTL_SECONDS * 1000)).status).toBe(401);
    expect((await handleSessionRequest(request("", "POST", undefined, {}, { Origin: "https://attacker.com" }), store, now)).status).toBe(403);
    expect((await handleSessionRequest(request("", "POST", undefined, { scenario: "x".repeat(300000) }), store, now)).status).toBe(413);
    for (let i = 0; i < 8; i++) await handleSessionRequest(request("", "POST", undefined, {}), store, now);
    expect((await handleSessionRequest(request("", "POST", undefined, {}), store, now)).status).toBe(429);
  });
  it("encrypts scenario text with authenticated encryption", () => {
    const key = Buffer.alloc(32, 42); const scenario = { ...emptyScenario(), gsText: station };
    const ciphertext = encryptScenario(scenario, key);
    expect(ciphertext).not.toContain("Tokyo"); expect(decryptScenario(ciphertext, key)).toEqual(scenario);
    expect(() => decryptScenario(ciphertext, Buffer.alloc(32, 1))).toThrow();
  });
});
describe("remote scenario operations", () => {
  it("adds and removes shells/stations and keeps ISL ranges aligned", () => {
    let s = applyScenarioOperation(emptyScenario(), { type: "append", section: "constellation", text: shell });
    s = applyScenarioOperation(s, { type: "append", section: "groundstations", text: station });
    let committed = commitRemoteScenario(s);
    expect(committed.satellites.length).toBe(4); expect(committed.islShellRanges[0].count).toBe(4); expect(committed.groundStations[0].name).toBe("Tokyo");
    s = applyScenarioOperation(s, { type: "remove", section: "constellation", index: 0 });
    committed = commitRemoteScenario(s); expect(committed.satellites).toEqual([]); expect(committed.islShellRanges).toEqual([]);
    s = applyScenarioOperation(s, { type: "clear" }); expect(commitRemoteScenario(s).groundStations).toEqual([]);
  });
  it("rejects malformed TOML, invalid coordinates, wrong section/index, and excessive shells", () => {
    for (const operation of [
      { type: "append", section: "groundstations", text: "invalid = [" },
      { type: "append", section: "groundstations", text: '[groundstations]\nname = "x"' },
      { type: "append", section: "satellites", text: '[[satellites]]\ntype = "tle"\nline1 = "garbage"\nline2 = "garbage"' },
      { type: "append", section: "constellation", text: shell + 'pattern = "bogus"\n' },
      { type: "append", section: "groundstations", text: station.replace("35", "100") },
      { type: "append", section: "constellation", text: shell.replace("count = 4", "count = 10000000") },
      { type: "append", section: "bogus", text: station },
      { type: "remove", section: "groundstations", index: 0 },
    ]) expect(() => applyScenarioOperation(emptyScenario(), operation)).toThrow();
  });
  it("imports the existing settings bundle without generating unbounded arrays", () => {
    const s = applyScenarioOperation(emptyScenario(), { type: "bundle", text: `# === satellites ===\n\n# === constellation ===\n${shell}\n# === groundstations ===\n${station}\nstartTime = "2026-10-03T00:00:00Z"` });
    expect(commitRemoteScenario(s).satellites.length).toBe(4);
    expect(() => applyScenarioOperation(s, { type: "bundle", text: 'junk = "x"' })).toThrow();
  });
});


describe("remote display options", () => {
  it("merges validated display patches without changing scenario data and preserves them across operations", () => {
    const original = { ...emptyScenario(), gsText: station, display: { whiteBackground: false, fovConeHalfAngleDeg: 30 } };
    const updated = applyScenarioOperation(original, { type: "display", settings: { whiteBackground: true, earthTexture: "blue-marble", satelliteVisibleColor: "#abcdef" } });
    expect(updated.gsText).toBe(station);
    expect(updated.startTime).toBe(original.startTime);
    expect(updated.display).toEqual({ whiteBackground: true, fovConeHalfAngleDeg: 30, earthTexture: "blue-marble", satelliteVisibleColor: "#abcdef" });
    expect(original.display.whiteBackground).toBe(false);
    expect(applyScenarioOperation(updated, { type: "clear" }).display).toEqual(updated.display);
    expect(applyScenarioOperation(updated, { type: "replace", scenario: emptyScenario() }).display).toEqual(updated.display);
    expect(applyScenarioOperation(updated, { type: "bundle", text: '# === satellites ===\n' }).display).toEqual(updated.display);
    expect(applyScenarioOperation(emptyScenario(), { type: "clear" }).display).toBeUndefined();
  });
  it("rejects invalid settings before committing a revision", async () => {
    const store = new MemoryStore(); const session = await create(store);
    const path = `/${session.sessionId}`;
    for (const settings of [null, [], { whiteBackground: 1 }, { satRadius: -1 }, { fovConeHalfAngleDeg: 90 }, { earthTexture: "https://example.com/secret" }, { satelliteVisibleColor: "red" }, { isl: {} }, { speedExp: Infinity }, JSON.parse('{"__proto__":{}}')]) {
      expect(() => applyScenarioOperation(emptyScenario(), { type: "display", settings })).toThrow();
    }
    const invalid = await handleSessionRequest(request(path, "PUT", session.controllerToken, { expectedRevision: 0, operation: { type: "display", settings: { whiteBackground: "yes" } } }), store, now);
    expect(invalid.status).toBe(400);
    const accepted = await handleSessionRequest(request(path, "PUT", session.controllerToken, { expectedRevision: 0, operation: { type: "display", settings: { whiteBackground: true, fovConeHalfAngleDeg: 45 } } }), store, now);
    expect(accepted.status).toBe(200);
    const read = await (await handleSessionRequest(request(path, "GET", session.controllerToken), store, now)).json();
    expect(read.revision).toBe(1);
    expect(read.scenario.display).toEqual({ whiteBackground: true, fovConeHalfAngleDeg: 45 });
    expect(decryptScenario(encryptScenario(read.scenario, Buffer.alloc(32, 1)), Buffer.alloc(32, 1)).display).toEqual(read.scenario.display);
  });
});
