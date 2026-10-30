import { describe, expect, it } from "bun:test";
import type { ServerResponse } from "node:http";
import { createSessionHandler } from "../src/server/vercelHandler";
import { LocalSessionStore } from "../src/server/localSessionStore";

function client(handler: ReturnType<typeof createSessionHandler>) {
  return async (path: string, method: string, token?: string, body?: unknown) => {
    const headers = new Headers();
    let content = "";
    const res = {
      statusCode: 200,
      setHeader: (name: string, value: string) => { headers.set(name, value); },
      end: (text: string) => { content = text; },
    };
    await handler({
      method, url: `/api/sessions${path}`, body,
      headers: {
        host: "localhost:5173", "x-forwarded-proto": "http", "content-type": "application/json",
        ...(token ? { authorization: [`Bearer ${token}`] } : {}),
      },
    } as Parameters<typeof handler>[0], res as unknown as ServerResponse);
    return new Response(content, { status: res.statusCode, headers });
  };
}

describe("Vercel Node HTTP adapter", () => {
  it("preserves session creation, JSON body handling, authentication, acknowledgement and deletion", async () => {
    const store = new LocalSessionStore();
    const request = client(createSessionHandler(() => store));
    for (const body of [{}, "{}"]) {
      const created = await request("", "POST", undefined, body);
      expect(created.status).toBe(201);
      expect(created.headers.get("content-type")).toContain("application/json");
      expect(created.headers.get("cache-control")).toContain("no-store");
      const { sessionId, ownerToken, controllerToken } = await created.json();
      const path = `/${sessionId}`;
      expect((await request(path, "GET")).status).toBe(401);
      const update = await request(path, "PUT", controllerToken, {
        expectedRevision: 0, operation: { type: "display", settings: { whiteBackground: true } },
      });
      expect(update.status).toBe(200);
      const snapshot = await (await request(path, "GET", ownerToken)).json();
      expect(snapshot.revision).toBe(1);
      expect(snapshot.scenario.display.whiteBackground).toBe(true);
      expect((await request(path, "PATCH", ownerToken, { revision: 1, status: "applied" })).status).toBe(200);
      expect((await request(path, "DELETE", ownerToken)).status).toBe(200);
      expect((await request(path, "GET", controllerToken)).status).toBe(401);
    }
  });

  it("returns a private JSON 503 if the store is unavailable without exposing its error", async () => {
    const request = client(createSessionHandler(() => { throw new Error("private configuration details"); }));
    const response = await request("", "POST", undefined, {});
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "Session service unavailable" });
  });
});
