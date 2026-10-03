import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleSessionRequest } from "./sessionApi";
import { productionStore } from "./sessionStore";

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
    const response = await handleSessionRequest(request, productionStore());
    response.headers.forEach((value, name) => res.setHeader(name, value));
    res.status(response.status).send(await response.text());
  } catch {
    res.setHeader("Cache-Control", "no-store, private");
    res.status(503).json({ error: "Session service unavailable" });
  }
}
