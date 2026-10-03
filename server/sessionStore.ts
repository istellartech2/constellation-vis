import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { RemoteScenario } from "../src/lib/remoteScenario";

export interface SessionRecord {
  ownerHash: string;
  controllerHash: string;
  expiresAt: string;
  revision: number;
  appliedRevision: number;
  applicationStatus: "pending" | "applied" | "error";
  scenario: RemoteScenario;
}
export interface SessionStore {
  create(id: string, record: SessionRecord, ttl: number): Promise<void>;
  get(id: string): Promise<SessionRecord | null>;
  update(id: string, expected: number, scenario: RemoteScenario): Promise<boolean>;
  acknowledge(id: string, revision: number, status: "applied" | "error"): Promise<boolean>;
  delete(id: string): Promise<void>;
  rateLimit(key: string, limit: number, seconds: number): Promise<boolean>;
}
export function tokenHash(token: string): string { return createHash("sha256").update(token).digest("hex"); }

export function encryptScenario(scenario: RemoteScenario, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const payload = Buffer.concat([cipher.update(JSON.stringify(scenario), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), payload]).toString("base64");
}
export function decryptScenario(text: string, key: Buffer): RemoteScenario {
  const bytes = Buffer.from(text, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
}

export class RedisSessionStore implements SessionStore {
  private url: string;
  private token: string;
  private key: Buffer;
  private namespace: string;
  constructor(url: string, token: string, key: Buffer, namespace: string) {
    this.url = url; this.token = token; this.key = key; this.namespace = namespace;
  }
  private sessionKey(id: string) { return `constellation:${this.namespace}:session:${id}`; }
  private async command(args: (string | number)[]): Promise<unknown> {
    const r = await fetch(this.url, { method: "POST", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" }, body: JSON.stringify(args), signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error("Session storage unavailable");
    const body = await r.json() as { result?: unknown; error?: string };
    if (body.error) throw new Error("Session storage failed");
    return body.result;
  }
  async create(id: string, record: SessionRecord, ttl: number) {
    const fields = { ...record, scenario: encryptScenario(record.scenario, this.key) };
    await this.command(["EVAL", "redis.call('HSET',KEYS[1],unpack(ARGV,2)); redis.call('EXPIRE',KEYS[1],ARGV[1]); return 1", 1, this.sessionKey(id), ttl, ...Object.entries(fields).flatMap(([k,v]) => [k, String(v)])]);
  }
  async get(id: string): Promise<SessionRecord | null> {
    const pairs = await this.command(["HGETALL", this.sessionKey(id)]) as string[];
    if (!pairs?.length) return null;
    const fields: Record<string, string> = {};
    for (let i = 0; i < pairs.length; i += 2) fields[pairs[i]] = pairs[i + 1];
    return { ownerHash: fields.ownerHash, controllerHash: fields.controllerHash, expiresAt: fields.expiresAt, revision: Number(fields.revision), appliedRevision: Number(fields.appliedRevision), applicationStatus: fields.applicationStatus as SessionRecord["applicationStatus"], scenario: decryptScenario(fields.scenario, this.key) };
  }
  async update(id: string, expected: number, scenario: RemoteScenario) {
    return Number(await this.command(["EVAL", "if redis.call('HGET',KEYS[1],'revision') ~= ARGV[1] then return 0 end; redis.call('HSET',KEYS[1],'scenario',ARGV[2],'revision',ARGV[3],'applicationStatus','pending'); return 1", 1, this.sessionKey(id), expected, encryptScenario(scenario, this.key), expected + 1])) === 1;
  }
  async acknowledge(id: string, revision: number, status: "applied" | "error") {
    return Number(await this.command(["EVAL", "if redis.call('HGET',KEYS[1],'revision') ~= ARGV[1] then return 0 end; redis.call('HSET',KEYS[1],'appliedRevision',ARGV[1],'applicationStatus',ARGV[2]); return 1", 1, this.sessionKey(id), revision, status])) === 1;
  }
  async delete(id: string) { await this.command(["DEL", this.sessionKey(id)]); }
  async rateLimit(key: string, limit: number, seconds: number) {
    const count = await this.command(["EVAL", "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n", 1, `constellation:${this.namespace}:limit:${key}`, seconds]);
    return Number(count) <= limit;
  }
}

export function productionStore(): SessionStore {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  const key = process.env.SESSION_ENCRYPTION_KEY;
  if (!url || !token || !key || !/^[a-f0-9]{64}$/i.test(key)) throw new Error("Session API not configured");
  // Preview deployments never share session IDs/state with production.
  const namespace = process.env.VERCEL_ENV === "production" ? "production" : (process.env.VERCEL_URL ?? "development");
  return new RedisSessionStore(url, token, Buffer.from(key, "hex"), namespace);
}
