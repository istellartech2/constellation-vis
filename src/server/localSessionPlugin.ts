import type { ViteDevServer } from "vite";
import { handleSessionRequest } from "./sessionApi";
import { LocalSessionStore } from "./localSessionStore";
import { MAX_SCENARIO_BYTES } from "../lib/remoteScenario";

/** Expose the same session API only in Vite's local development server. */
export function configureLocalSession(server: ViteDevServer): void {
  const store = new LocalSessionStore();
  server.middlewares.use(async (req, res, next) => {
    if (!req.url?.match(/^\/api\/sessions(?:\/|\?|$)/)) return next();
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of req) {
        const bytes = Buffer.from(chunk as Uint8Array);
        length += bytes.length;
        if (length > MAX_SCENARIO_BYTES) {
          res.writeHead(413, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ error: "Request exceeds 256 KiB" }));
          return;
        }
        chunks.push(bytes);
      }
      const method = req.method ?? "GET";
      const request = new Request(`http://${req.headers.host}${req.url}`, {
        method, headers,
        ...(!["GET", "HEAD"].includes(method) ? { body: Buffer.concat(chunks) } : {}),
      });
      const response = await handleSessionRequest(request, store);
      response.headers.forEach((value, name) => res.setHeader(name, value));
      res.statusCode = response.status;
      res.end(await response.text());
    } catch {
      res.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ error: "Local session service unavailable" }));
    }
  });
}
