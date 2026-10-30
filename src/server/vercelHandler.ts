import type { IncomingMessage, ServerResponse } from "node:http";
import { handleSessionRequest } from "./sessionApi";
import { productionStore, type SessionStore } from "./sessionStore";

/** Vercel parses JSON bodies before invoking its standard Node HTTP handler. */
type SessionNodeRequest = IncomingMessage & { body?: unknown };

export function createSessionHandler(getStore: () => SessionStore = productionStore) {
  return async function handler(req: SessionNodeRequest, res: ServerResponse) {
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      const host = req.headers.host;
      const protocol = req.headers["x-forwarded-proto"] ?? "https";
      const request = new Request(`${protocol}://${host}${req.url}`, {
        method: req.method,
        headers,
        ...(!["GET", "HEAD"].includes(req.method ?? "GET") ? { body: typeof req.body === "string" ? req.body : JSON.stringify(req.body) } : {}),
      });
      const response = await handleSessionRequest(request, getStore());
      response.headers.forEach((value, name) => res.setHeader(name, value));
      res.statusCode = response.status;
      res.end(await response.text());
    } catch {
      res.setHeader("Cache-Control", "no-store, private");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "Session service unavailable" }));
    }
  };
}

export default createSessionHandler();
