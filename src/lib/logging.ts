import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HostReport } from "@/lib/hosts";

/** Bounded event metadata persisted to the private JSONL telemetry file. */
export type LogEvent = {
  at?: string;
  source: string;
  host: string;
  type: string;
  stats?: Record<string, unknown>;
};

export const MAX_LOG_EVENTS = 1_000;
const MAX_LOG_BYTES = 1_000_000;
const MAX_EVENT_BYTES = 10_000;
const MAX_STATS_FIELDS = 32;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/** Validate bounded metadata-only metrics before accepting an ingested event. */
export function isLogEvent(value: unknown): value is LogEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  if (Object.keys(event).some((key) => !["at", "source", "host", "type", "stats"].includes(key))) return false;
  if (
    typeof event.source !== "string" || event.source.length > 80 || !identifier.test(event.source) ||
    typeof event.host !== "string" || event.host.length > 120 || !identifier.test(event.host) ||
    typeof event.type !== "string" || event.type.length > 80 || !identifier.test(event.type)
  ) return false;
  if (event.at !== undefined && (
    typeof event.at !== "string" || event.at.length > 40 || !Number.isFinite(Date.parse(event.at)) ||
    Date.parse(event.at) > Date.now() + MAX_FUTURE_SKEW_MS
  )) return false;
  if (event.stats === undefined) return true;
  if (typeof event.stats !== "object" || event.stats === null || Array.isArray(event.stats)) return false;
  const entries = Object.entries(event.stats as Record<string, unknown>);
  return entries.length <= MAX_STATS_FIELDS && entries.every(([key, metric]) =>
    /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key) && typeof metric === "number" &&
    Number.isFinite(metric) && Math.abs(metric) <= Number.MAX_SAFE_INTEGER
  );
}

const logPath = () => path.join(process.cwd(), "logs", "events.jsonl");

function eventTime(line: string) {
  if (Buffer.byteLength(line, "utf8") > MAX_EVENT_BYTES) return null;
  try {
    const value: unknown = JSON.parse(line);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const at = (value as Record<string, unknown>).at;
    if (typeof at !== "string" || at.length > 40) return null;
    const time = Date.parse(at);
    return Number.isFinite(time) ? time : null;
  } catch {
    return null;
  }
}

/** Keep valid event lines inside both the seven-day and bounded-file windows. */
export function retainRecentEventLines(lines: string[], now = Date.now()) {
  const cutoff = now - LOG_RETENTION_MS;
  const recent = lines.filter((line) => {
    const at = eventTime(line);
    return at !== null && at >= cutoff && at <= now + MAX_FUTURE_SKEW_MS;
  }).slice(-MAX_LOG_EVENTS);

  let totalBytes = recent.reduce((total, line) => total + Buffer.byteLength(line, "utf8") + 1, 0);
  while (recent.length && totalBytes > MAX_LOG_BYTES) {
    totalBytes -= Buffer.byteLength(recent.shift()!, "utf8") + 1;
  }
  return recent;
}

let logWriteQueue: Promise<void> = Promise.resolve();

function serializeLogOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = logWriteQueue.then(operation, operation);
  logWriteQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function readLogLines(file: string) {
  let handle;
  try {
    handle = await open(file, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { lines: [], oversized: false };
    throw error;
  }
  try {
    const { size } = await handle.stat();
    if (!size) return { lines: [], oversized: false };
    const length = Math.min(size, MAX_LOG_BYTES);
    const start = size - length;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    let text = buffer.toString("utf8");
    if (start > 0) {
      const newline = text.indexOf("\n");
      text = newline < 0 ? "" : text.slice(newline + 1);
    }
    return { lines: text.split("\n").filter(Boolean), oversized: size > MAX_LOG_BYTES };
  } finally {
    await handle.close();
  }
}

async function replaceLogLines(file: string, lines: string[]) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, lines.length ? `${lines.join("\n")}\n` : "", { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, file);
    await chmod(file, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

/** Persist a bounded batch atomically, pruning expired/oversized logs on every write. */
async function appendEvents(events: LogEvent[]) {
  if (!events.length) return;
  return serializeLogOperation(async () => {
    const file = logPath();
    await mkdir(path.dirname(file), { recursive: true });
    await chmod(path.dirname(file), 0o700);
    const now = Date.now();
    const additions = events.map((event) => {
      const requestedAt = event.at === undefined ? now : Date.parse(event.at);
      const at = Number.isFinite(requestedAt) && requestedAt <= now + MAX_FUTURE_SKEW_MS
        ? new Date(requestedAt).toISOString()
        : new Date(now).toISOString();
      const line = JSON.stringify({ ...event, at });
      if (Buffer.byteLength(line, "utf8") > MAX_EVENT_BYTES) throw new Error("Telemetry event exceeds the size limit");
      return line;
    });
    const previous = await readLogLines(file);
    const retained = retainRecentEventLines(previous.lines, now);
    retained.push(...additions);
    await replaceLogLines(file, retainRecentEventLines(retained, now));
  });
}

/** Persist one event atomically, pruning expired/oversized logs on every write. */
export async function appendEvent(event: LogEvent) {
  return appendEvents([event]);
}

/** Project host reports into a content-free fleet snapshot and persist it. */
export async function appendSnapshot(reports: HostReport[]) {
  const events: LogEvent[] = [{
    source: "dashboard",
    host: "fleet",
    type: "snapshot",
    stats: {
      reachable: reports.filter((report) => report.reachable).length,
      total: reports.length,
      appServers: reports.map((report) => ({
        host: report.host.slug,
        status: report.appServer.status,
        transport: report.connection.transport,
        version: report.appServer.version,
        remoteControlEnabled: report.appServer.remoteControlEnabled,
        processCount: report.processes.length,
        agentCount: report.herdr.agents.length,
        worktreeCount: report.worktrees.length,
      })),
    },
  }];
  for (const report of reports) {
    if (!report.resources) continue;
    const stats = Object.fromEntries(
      Object.entries(report.resources).filter(([, value]) => typeof value === "number" && Number.isFinite(value)),
    );
    if (!Object.keys(stats).length) continue;
    events.push({ source: "dashboard", host: report.host.slug, type: "resource_metrics", stats });
  }
  await appendEvents(events);
}

/** Read the newest bounded events and physically prune expired or malformed records. */
export async function readRecentEvents(limit = 100) {
  return serializeLogOperation(async () => {
    try {
      const file = logPath();
      const previous = await readLogLines(file);
      const retained = retainRecentEventLines(previous.lines);
      if (previous.oversized || retained.length !== previous.lines.length || retained.some((line, index) => line !== previous.lines[index])) {
        await replaceLogLines(file, retained);
      }
      return retained.slice(-Math.max(1, Math.min(limit, 500))).map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  });
}
