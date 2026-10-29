import type { RemoteScenario } from "../src/lib/remoteScenario";
import type { SessionRecord, SessionStore } from "./sessionStore";

/** Development-only storage; data disappears when the Vite server stops. */
export class LocalSessionStore implements SessionStore {
  private records = new Map<string, SessionRecord>();
  private limits = new Map<string, { count: number; expiresAt: number }>();

  async create(id: string, record: SessionRecord): Promise<void> {
    this.records.set(id, structuredClone(record));
    const delay = Math.max(0, Date.parse(record.expiresAt) - Date.now());
    setTimeout(() => { this.getLive(id); }, delay).unref();
  }
  private getLive(id: string): SessionRecord | null {
    const record = this.records.get(id);
    if (record && Date.parse(record.expiresAt) <= Date.now()) this.records.delete(id);
    return this.records.get(id) ?? null;
  }
  async get(id: string): Promise<SessionRecord | null> { return structuredClone(this.getLive(id)); }
  async update(id: string, expected: number, scenario: RemoteScenario): Promise<boolean> {
    const record = this.getLive(id);
    if (!record || record.revision !== expected) return false;
    record.scenario = structuredClone(scenario);
    record.revision++;
    record.applicationStatus = "pending";
    this.records.set(id, record);
    return true;
  }
  async acknowledge(id: string, revision: number, status: "applied" | "error"): Promise<boolean> {
    const record = this.getLive(id);
    if (!record || record.revision !== revision) return false;
    record.appliedRevision = revision;
    record.applicationStatus = status;
    this.records.set(id, record);
    return true;
  }
  async delete(id: string): Promise<void> { this.records.delete(id); }
  async rateLimit(key: string, limit: number, seconds: number): Promise<boolean> {
    const now = Date.now();
    const current = this.limits.get(key);
    const entry = !current || current.expiresAt <= now ? { count: 0, expiresAt: now + seconds * 1000 } : current;
    entry.count++;
    this.limits.set(key, entry);
    if (entry.count === 1) {
      setTimeout(() => { if (this.limits.get(key) === entry) this.limits.delete(key); }, seconds * 1000).unref();
    }
    return entry.count <= limit;
  }
}
