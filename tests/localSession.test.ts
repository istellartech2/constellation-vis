import { describe, expect, it } from "bun:test";
import { LocalSessionStore } from "../src/server/localSessionStore";
import { handleSessionRequest } from "../src/server/sessionApi";

describe("local session API", () => {
  it("creates, updates, acknowledges and ends a session without external storage", async () => {
    const store = new LocalSessionStore();
    const request = (path: string, method: string, token?: string, body?: unknown) => handleSessionRequest(new Request(`http://localhost:5173/api/sessions${path}`, {
      method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }), store);
    const created = await request("", "POST", undefined, {});
    expect(created.status).toBe(201);
    const { sessionId, ownerToken, controllerToken } = await created.json() as { sessionId: string; ownerToken: string; controllerToken: string };
    const path = `/${sessionId}`;
    const update = await request(path, "PUT", controllerToken, { expectedRevision: 0, operation: { type: "display", settings: { whiteBackground: true } } });
    expect(update.status).toBe(200);
    const snapshot = await (await request(path, "GET", ownerToken)).json() as { revision: number; scenario: { display: { whiteBackground: boolean } } };
    expect(snapshot.revision).toBe(1);
    expect(snapshot.scenario.display.whiteBackground).toBe(true);
    expect((await request(path, "PATCH", ownerToken, { revision: 1, status: "applied" })).status).toBe(200);
    expect((await request(path, "DELETE", ownerToken)).status).toBe(200);
    expect((await request(path, "GET", controllerToken)).status).toBe(401);
  });
});
