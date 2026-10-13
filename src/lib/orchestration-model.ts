export const TASK_STATUSES = [
  "queued",
  "starting",
  "running",
  "approval-needed",
  "blocked",
  "completed",
  "failed",
  "canceled",
  "stale",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export type TaskNode = {
  id: string;
  hostSlug: string;
  dependsOn: string[];
  status: TaskStatus;
};

export type PermissionMode = "home" | "approval-required";
export const MAX_ACTIVE_WORKERS_PER_HOST = 4;

/** V1 dispatches only home-scoped tasks; the approval bridge is not implemented. */
export function isV1TaskDispatchable(task: { permissionMode: PermissionMode }) {
  return task.permissionMode === "home";
}

export type OrchestrationTask = TaskNode & {
  title: string;
  goal: string;
  verifiedContext: string[];
  cwd: string;
  constraints: string[];
  permissionMode: PermissionMode;
  prompt: string;
  acceptanceChecks: string[];
  verification: string[];
  edgeCases: string[];
  assumptions: string[];
  overridePrivilegeAndOutOfHome: false;
};

export type OrchestrationPlan =
  | { status: "needs-clarification"; questions: string[]; assumptions: string[] }
  | { status: "ready"; assumptions: string[]; tasks: OrchestrationTask[] };

export type RunStatus =
  | "queued"
  | "running"
  | "blocked"
  | "stale"
  | "completed"
  | "completed-with-errors"
  | "failed"
  | "canceled";

const ALLOWED_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  queued: ["starting", "blocked", "canceled"],
  starting: ["running", "failed", "stale", "canceled"],
  running: ["approval-needed", "completed", "failed", "stale", "canceled"],
  "approval-needed": ["running", "failed", "stale", "canceled"],
  blocked: ["queued", "canceled"],
  completed: [],
  failed: ["queued"],
  canceled: ["queued"],
  stale: ["running", "completed", "failed", "canceled"],
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, field: string, maxLength = 4_000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`Invalid orchestration plan: ${field} must be non-empty text of at most ${maxLength} characters.`);
  }
  return value.trim();
}

function textList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 40) {
    throw new Error(`Invalid orchestration plan: ${field} must be a list with at most 40 entries.`);
  }
  return value.map((item, index) => text(item, `${field}[${index}]`, 2_000));
}

function safeHomePath(value: unknown): string {
  const cwd = text(value, "cwd", 500);
  if (cwd !== "~" && (!cwd.startsWith("~/") || cwd.slice(2).split(/[\\/]+/).some((segment) => !segment || segment === "." || segment === ".."))) {
    throw new Error("Invalid orchestration plan: cwd must be the home directory or a normalized path beneath the home directory.");
  }
  return cwd;
}

/** Parse and validate Hermes' JSON plan against the actual host allowlist. */
export function parseOrchestrationPlan(output: string, allowedHosts: readonly string[]): OrchestrationPlan {
  if (!output.trim() || output.length > 100_000) throw new Error("Hermes returned an empty or oversized orchestration plan.");
  const withoutFence = output.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: unknown;
  try {
    value = JSON.parse(withoutFence);
  } catch {
    throw new Error("Hermes did not return a valid JSON orchestration plan.");
  }
  const root = record(value);
  if (!root || !Array.isArray(root.assumptions)) throw new Error("Invalid orchestration plan: missing assumptions list.");
  const assumptions = textList(root.assumptions, "assumptions");

  if (root.status === "needs-clarification") {
    const questions = textList(root.questions, "questions");
    if (!questions.length || (Array.isArray(root.tasks) && root.tasks.length > 0)) {
      throw new Error("Invalid orchestration plan: clarification requires questions and no tasks.");
    }
    return { status: "needs-clarification", questions, assumptions };
  }
  if (root.status !== "ready" || !Array.isArray(root.tasks) || root.tasks.length === 0 || root.tasks.length > 30) {
    throw new Error("Invalid orchestration plan: ready plans require between 1 and 30 tasks.");
  }

  const tasks = root.tasks.map((value, index): OrchestrationTask => {
    const task = record(value);
    if (!task) throw new Error(`Invalid orchestration plan: task ${index + 1} must be an object.`);
    const id = text(task.id, `tasks[${index}].id`, 48);
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`Invalid orchestration plan: task id ${id} is not URL-safe.`);
    if (!Array.isArray(task.dependsOn) || task.dependsOn.some((dependency) => typeof dependency !== "string")) {
      throw new Error(`Invalid orchestration plan: task ${id} dependencies must be a list of task ids.`);
    }
    const permissionMode = task.permissionMode;
    if (permissionMode !== "home" && permissionMode !== "approval-required") {
      throw new Error(`Invalid orchestration plan: task ${id} has an unknown permission mode.`);
    }
    return {
      id,
      title: text(task.title, `task ${id} title`, 160),
      goal: text(task.goal, `task ${id} goal`),
      verifiedContext: textList(task.verifiedContext, `task ${id} verifiedContext`),
      hostSlug: text(task.targetHostSlug, `task ${id} targetHostSlug`, 80),
      cwd: safeHomePath(task.cwd),
      constraints: textList(task.constraints, `task ${id} constraints`),
      permissionMode,
      dependsOn: task.dependsOn as string[],
      status: "queued",
      prompt: text(task.prompt, `task ${id} prompt`, 40_000),
      acceptanceChecks: textList(task.acceptanceChecks, `task ${id} acceptanceChecks`),
      verification: textList(task.verification, `task ${id} verification`),
      edgeCases: textList(task.edgeCases, `task ${id} edgeCases`),
      assumptions: textList(task.assumptions, `task ${id} assumptions`),
      overridePrivilegeAndOutOfHome: false,
    };
  });
  const graph = validateTaskGraph(tasks, allowedHosts);
  if (!graph.valid) throw new Error(`Invalid orchestration plan: ${graph.errors.join(" ")}`);
  return { status: "ready", assumptions, tasks };
}

/** Check task ids, host assignments, dependencies, and dependency cycles. */
export function validateTaskGraph(
  tasks: readonly TaskNode[],
  allowedHosts: readonly string[],
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const ids = new Set<string>();
  const hosts = new Set(allowedHosts);

  for (const task of tasks) {
    if (!task.id.trim()) {
      errors.push("Task id must not be empty.");
    } else if (ids.has(task.id)) {
      errors.push(`Task id ${task.id} is duplicated.`);
    }
    ids.add(task.id);

    if (!hosts.has(task.hostSlug)) {
      errors.push(`Task ${task.id} targets an unlisted host.`);
    }

    const dependencySet = new Set<string>();
    for (const dependencyId of task.dependsOn) {
      if (dependencySet.has(dependencyId)) {
        errors.push(`Task ${task.id} lists dependency ${dependencyId} more than once.`);
      }
      dependencySet.add(dependencyId);
      if (dependencyId === task.id) {
        errors.push(`Task ${task.id} cannot depend on itself.`);
      }
    }
  }

  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    for (const dependencyId of task.dependsOn) {
      if (dependencyId !== task.id && !byId.has(dependencyId)) {
        errors.push(`Task ${task.id} depends on missing task ${dependencyId}.`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  let hasCycle = false;
  const visit = (taskId: string): void => {
    if (visiting.has(taskId)) {
      hasCycle = true;
      return;
    }
    if (visited.has(taskId)) return;

    visiting.add(taskId);
    for (const dependencyId of byId.get(taskId)?.dependsOn ?? []) {
      if (byId.has(dependencyId)) visit(dependencyId);
    }
    visiting.delete(taskId);
    visited.add(taskId);
  };

  for (const task of tasks) visit(task.id);
  if (hasCycle) errors.push("Task graph contains a dependency cycle.");

  return { valid: errors.length === 0, errors };
}

/** Return queued tasks whose dependencies are all complete, preserving plan order. */
export function getReadyTaskIds(tasks: readonly TaskNode[]): string[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return tasks
    .filter((task) => task.status === "queued")
    .filter((task) => task.dependsOn.every((dependencyId) => byId.get(dependencyId)?.status === "completed"))
    .map((task) => task.id);
}

/** Move a task through an allowed state transition. Retries must pass through queued. */
export function transitionTask<T extends TaskNode>(task: T, status: TaskStatus): T {
  if (!ALLOWED_TRANSITIONS[task.status].includes(status)) {
    throw new Error(`Invalid task transition: ${task.status} -> ${status}.`);
  }
  return { ...task, status };
}

/** Derive a run phase without hiding failures on individual tasks. */
export function deriveRunStatus(tasks: readonly TaskNode[]): RunStatus {
  if (tasks.length === 0) return "failed";
  if (tasks.some((task) => ["starting", "running", "approval-needed"].includes(task.status))) return "running";
  if (tasks.some((task) => task.status === "stale")) return "stale";
  if (tasks.some((task) => task.status === "queued")) return "queued";
  if (tasks.some((task) => task.status === "blocked")) return "blocked";
  if (tasks.every((task) => task.status === "canceled")) return "canceled";

  const hasFailed = tasks.some((task) => task.status === "failed");
  const hasCompleted = tasks.some((task) => task.status === "completed");
  if (hasFailed && hasCompleted) return "completed-with-errors";
  if (hasFailed) return "failed";
  if (tasks.some((task) => task.status === "canceled")) return "canceled";
  return "completed";
}
