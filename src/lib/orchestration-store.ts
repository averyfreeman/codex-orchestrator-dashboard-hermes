import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { deriveRunStatus, MAX_ACTIVE_WORKERS_PER_HOST, TASK_STATUSES, transitionTask, validateTaskGraph, type RunStatus, type TaskNode, type TaskStatus } from "@/lib/orchestration-model";

export type StoredTask = TaskNode & {
  threadId?: string;
  turnId?: string;
  cleanupStatus?: "pending" | "cleared" | "unknown";
  trackedTerminalCount?: number;
};

export type StoredOrchestrationRun = {
  id: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  status: RunStatus;
  tasks: StoredTask[];
};

export type RunStopResult = {
  run: StoredOrchestrationRun;
  canceledTaskIds: string[];
  interrupts: Array<{ taskId: string; hostSlug: string; threadId: string; turnId: string }>;
  pendingWorkerIds: string[];
};

type StoreData = { runs: StoredOrchestrationRun[] };

const RUN_ID = /^[A-Za-z0-9_-]{1,160}$/;
const TASK_ID = /^[A-Za-z0-9_-]{1,48}$/;
const CODEX_ID = /^[A-Za-z0-9_.:-]{1,160}$/;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const RUN_STATUSES: readonly RunStatus[] = ["queued", "running", "blocked", "stale", "completed", "completed-with-errors", "failed", "canceled"];
let updateQueue: Promise<unknown> = Promise.resolve();

function paths() {
  const directory = process.env.DASHBOARD_STATE_DIR
    ? path.resolve(process.env.DASHBOARD_STATE_DIR)
    : path.join(process.cwd(), ".dashboard-state");
  return { directory, file: path.join(directory, "orchestration.json") };
}

function terminal(status: RunStatus) {
  return status === "completed" || status === "completed-with-errors" || status === "failed" || status === "canceled";
}

function validRun(value: unknown): value is StoredOrchestrationRun {
  if (!value || typeof value !== "object") return false;
  const run = value as Record<string, unknown>;
  return typeof run.id === "string" && RUN_ID.test(run.id) &&
    typeof run.createdAt === "string" && typeof run.updatedAt === "string" &&
    typeof run.status === "string" && RUN_STATUSES.includes(run.status as RunStatus) &&
    (run.completedAt === null || typeof run.completedAt === "string") &&
    Array.isArray(run.tasks) && run.tasks.every((task) => {
      if (!task || typeof task !== "object") return false;
      const item = task as Record<string, unknown>;
      return typeof item.id === "string" && TASK_ID.test(item.id) &&
        typeof item.hostSlug === "string" && Array.isArray(item.dependsOn) &&
        item.dependsOn.every((dependency) => typeof dependency === "string") &&
        typeof item.status === "string" && TASK_STATUSES.includes(item.status as TaskStatus) &&
        (item.threadId === undefined || (typeof item.threadId === "string" && CODEX_ID.test(item.threadId))) &&
        (item.turnId === undefined || (typeof item.turnId === "string" && CODEX_ID.test(item.turnId))) &&
        (item.cleanupStatus === undefined || ["pending", "cleared", "unknown"].includes(String(item.cleanupStatus))) &&
        (item.trackedTerminalCount === undefined || (Number.isInteger(item.trackedTerminalCount) && Number(item.trackedTerminalCount) >= 0));
    });
}

async function readData(file: string): Promise<StoreData> {
  try {
    const parsed: unknown = JSON.parse(await readFile(/*turbopackIgnore: true*/ file, "utf8"));
    const runs = parsed && typeof parsed === "object" && Array.isArray((parsed as StoreData).runs)
      ? (parsed as StoreData).runs.filter(validRun)
      : [];
    return { runs };
  } catch {
    return { runs: [] };
  }
}

function prune(runs: StoredOrchestrationRun[], now: Date) {
  const cutoff = now.getTime() - RETENTION_MS;
  return runs.filter((run) => {
    if (!run.completedAt) return true;
    return Date.parse(run.completedAt) > cutoff;
  });
}

async function writeData(data: StoreData) {
  const { directory, file } = paths();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(/*turbopackIgnore: true*/ temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(/*turbopackIgnore: true*/ temporary, /*turbopackIgnore: true*/ file);
  await chmod(file, 0o600);
}

async function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const update = updateQueue.then(operation);
  updateQueue = update.catch(() => undefined);
  return update;
}

/** Persist only worker/run metadata, never plans, prompts, replies, or tool output. */
export function createOrchestrationRun(tasks: readonly TaskNode[], allowedHosts: readonly string[], id: string, now = new Date()) {
  return serialized(async () => {
    if (!RUN_ID.test(id)) throw new Error("Invalid orchestration run id.");
    if (tasks.length === 0 || tasks.length > 30) throw new Error("An orchestration run requires 1 to 30 tasks.");
    const graph = validateTaskGraph(tasks, allowedHosts);
    if (!graph.valid) throw new Error(graph.errors.join(" "));
    const { file } = paths();
    const data = await readData(file);
    const normalized: StoredTask[] = tasks.map((task) => ({
      id: task.id,
      hostSlug: task.hostSlug,
      dependsOn: [...task.dependsOn],
      status: "queued",
    }));
    const existing = data.runs.find((run) => run.id === id);
    if (existing) {
      const sameGraph = JSON.stringify(existing.tasks.map(({ id: taskId, hostSlug, dependsOn }) => ({ id: taskId, hostSlug, dependsOn }))) ===
        JSON.stringify(normalized.map(({ id: taskId, hostSlug, dependsOn }) => ({ id: taskId, hostSlug, dependsOn })));
      if (!sameGraph) throw new Error("Orchestration idempotency key conflicts with an existing run.");
      return existing;
    }
    const run: StoredOrchestrationRun = {
      id,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      completedAt: null,
      status: deriveRunStatus(normalized),
      tasks: normalized,
    };
    await writeData({ runs: [...prune(data.runs, now), run] });
    return run;
  });
}

/** Read one run and apply the seven-day terminal retention policy. */
export function readOrchestrationRun(id: string, now = new Date()): Promise<StoredOrchestrationRun | null> {
  return serialized(async () => {
    const { file } = paths();
    const data = await readData(file);
    const runs = prune(data.runs, now);
    if (runs.length !== data.runs.length) await writeData({ runs });
    return runs.find((run) => run.id === id) ?? null;
  });
}

/** Cancel undispatched work and return exact saved IDs for active-worker interrupts. */
export function requestOrchestrationRunStop(runId: string, now = new Date()): Promise<RunStopResult> {
  return serialized(async () => {
    if (!RUN_ID.test(runId)) throw new Error("Invalid orchestration run id.");
    const { file } = paths();
    const data = await readData(file);
    const runs = prune(data.runs, now);
    const runIndex = runs.findIndex((run) => run.id === runId);
    if (runIndex < 0) throw new Error("Orchestration run not found.");
    const current = runs[runIndex];
    const canceledTaskIds: string[] = [];
    const tasks = current.tasks.map((task) => {
      if (task.status !== "queued" && task.status !== "blocked") return task;
      canceledTaskIds.push(task.id);
      return transitionTask(task, "canceled");
    });
    const interrupts = tasks.flatMap((task) =>
      ["starting", "running", "approval-needed", "stale"].includes(task.status) && task.threadId && task.turnId
        ? [{ taskId: task.id, hostSlug: task.hostSlug, threadId: task.threadId, turnId: task.turnId }]
        : [],
    );
    const pendingWorkerIds = tasks.flatMap((task) =>
      ["starting", "running", "approval-needed", "stale"].includes(task.status) && (!task.threadId || !task.turnId)
        ? [task.id]
        : [],
    );
    const status = deriveRunStatus(tasks);
    const changed = canceledTaskIds.length > 0;
    const run: StoredOrchestrationRun = changed ? {
      ...current,
      updatedAt: now.toISOString(),
      completedAt: terminal(status) ? current.completedAt ?? now.toISOString() : null,
      status,
      tasks,
    } : current;
    if (changed) runs[runIndex] = run;
    if (changed || runs.length !== data.runs.length) await writeData({ runs });
    return { run, canceledTaskIds, interrupts, pendingWorkerIds };
  });
}

/** Atomically claim a queued task only after its dependencies complete. */
export function claimOrchestrationTask(
  runId: string,
  taskId: string,
  hostSlug: string,
  now = new Date(),
): Promise<StoredOrchestrationRun | null> {
  return serialized(async () => {
    if (!RUN_ID.test(runId) || !TASK_ID.test(taskId)) return null;
    const { file } = paths();
    const data = await readData(file);
    const runs = prune(data.runs, now);
    const runIndex = runs.findIndex((run) => run.id === runId);
    if (runIndex < 0) return null;
    const run = runs[runIndex];
    const taskIndex = run.tasks.findIndex((task) => task.id === taskId);
    if (taskIndex < 0) return null;
    const task = run.tasks[taskIndex];
    if (task.hostSlug !== hostSlug || task.status !== "queued" ||
      !task.dependsOn.every((dependency) => run.tasks.some((candidate) => candidate.id === dependency && candidate.status === "completed"))) {
      return null;
    }
    const activeForHost = runs.reduce((count, candidateRun) => count + candidateRun.tasks.filter((candidate) =>
      candidate.hostSlug === hostSlug && ["starting", "running", "approval-needed", "stale"].includes(candidate.status),
    ).length, 0);
    if (activeForHost >= MAX_ACTIVE_WORKERS_PER_HOST) return null;
    const tasks = run.tasks.map((candidate, index) => index === taskIndex
      ? { ...transitionTask(candidate, "starting"), cleanupStatus: "pending" as const }
      : candidate);
    const next: StoredOrchestrationRun = {
      ...run,
      updatedAt: now.toISOString(),
      status: deriveRunStatus(tasks),
      tasks,
    };
    runs[runIndex] = next;
    await writeData({ runs });
    return next;
  });
}

/** Update an exact task's state and opaque Codex IDs; reject transcript fields. */
export function updateOrchestrationTask(
  runId: string,
  taskId: string,
  update: { status?: TaskStatus; threadId?: string; turnId?: string; cleanupStatus?: StoredTask["cleanupStatus"]; trackedTerminalCount?: number },
  now = new Date(),
): Promise<StoredOrchestrationRun> {
  return serialized(async () => {
    if (!RUN_ID.test(runId) || !TASK_ID.test(taskId)) throw new Error("Invalid orchestration identifiers.");
    if (update.threadId !== undefined && !CODEX_ID.test(update.threadId)) throw new Error("Invalid Codex thread id.");
    if (update.turnId !== undefined && !CODEX_ID.test(update.turnId)) throw new Error("Invalid Codex turn id.");
    if (update.cleanupStatus !== undefined && !["pending", "cleared", "unknown"].includes(update.cleanupStatus)) throw new Error("Invalid terminal cleanup status.");
    if (update.trackedTerminalCount !== undefined && (!Number.isInteger(update.trackedTerminalCount) || update.trackedTerminalCount < 0)) throw new Error("Invalid tracked terminal count.");
    if (update.status !== undefined && !["queued", "starting", "running", "approval-needed", "blocked", "completed", "failed", "canceled", "stale"].includes(update.status)) {
      throw new Error("Invalid task status.");
    }
    const { file } = paths();
    const data = await readData(file);
    const runs = prune(data.runs, now);
    const runIndex = runs.findIndex((run) => run.id === runId);
    if (runIndex < 0) throw new Error("Orchestration run not found.");
    const run = runs[runIndex];
    const taskIndex = run.tasks.findIndex((task) => task.id === taskId);
    if (taskIndex < 0) throw new Error("Orchestration task not found.");
    const current = run.tasks[taskIndex];
    const moved = update.status && update.status !== current.status
      ? transitionTask(current, update.status)
      : current;
    const tasks = run.tasks.map((task, index) => index === taskIndex ? {
      ...moved,
      ...(update.threadId ? { threadId: update.threadId } : {}),
      ...(update.turnId ? { turnId: update.turnId } : {}),
      ...(update.cleanupStatus ? { cleanupStatus: update.cleanupStatus } : {}),
      ...(update.trackedTerminalCount !== undefined ? { trackedTerminalCount: update.trackedTerminalCount } : {}),
    } : task);
    const status = deriveRunStatus(tasks);
    const next: StoredOrchestrationRun = {
      ...run,
      updatedAt: now.toISOString(),
      completedAt: terminal(status) ? run.completedAt ?? now.toISOString() : null,
      status,
      tasks,
    };
    runs[runIndex] = next;
    await writeData({ runs });
    return next;
  });
}
