import { describe, expect, it } from "vitest";
import {
  deriveRunStatus,
  getReadyTaskIds,
  isV1TaskDispatchable,
  parseOrchestrationPlan,
  transitionTask,
  validateTaskGraph,
  type TaskNode,
} from "@/lib/orchestration-model";

const tasks: TaskNode[] = [
  { id: "inspect", hostSlug: "node-a", dependsOn: [], status: "queued" },
  { id: "implement", hostSlug: "node-a", dependsOn: ["inspect"], status: "queued" },
  { id: "tests", hostSlug: "node-b", dependsOn: [], status: "queued" },
];

describe("orchestration task graph", () => {
  it("blocks tasks that require permissions the current bridge cannot approve", () => {
    expect(isV1TaskDispatchable({ permissionMode: "home" })).toBe(true);
    expect(isV1TaskDispatchable({ permissionMode: "approval-required" })).toBe(false);
  });

  it("parses a validated plan with only allowlisted hosts and home-relative workspaces", () => {
    const parsed = parseOrchestrationPlan(JSON.stringify({
      status: "ready",
      assumptions: ["The repository root is the current working directory."],
      tasks: [{
        id: "inspect",
        title: "Inspect repository",
        goal: "Inspect verified project files.",
        verifiedContext: ["The dashboard uses TypeScript."],
        targetHostSlug: "node-a",
        cwd: "~",
        constraints: ["Do not modify files."],
        permissionMode: "home",
        dependsOn: [],
        prompt: "Inspect the project and report evidence.",
        acceptanceChecks: ["Cite relevant file paths."],
        verification: ["No changes are made."],
        edgeCases: [],
        assumptions: [],
      }],
    }), ["node-a"]);

    expect(parsed.status).toBe("ready");
    if (parsed.status === "ready") expect(parsed.tasks[0].cwd).toBe("~");
  });

  it("rejects plans with unlisted hosts or workspaces outside the home directory", () => {
    const plan = {
      status: "ready",
      assumptions: [],
      tasks: [{
        id: "inspect", title: "Inspect", goal: "Inspect.", verifiedContext: [],
        targetHostSlug: "unknown", cwd: "/etc", constraints: [], permissionMode: "home",
        dependsOn: [], prompt: "Inspect.", acceptanceChecks: [], verification: [], edgeCases: [], assumptions: [],
      }],
    };

    expect(() => parseOrchestrationPlan(JSON.stringify(plan), ["node-a"])).toThrow(/unlisted host|home directory/i);
  });

  it("preserves clarification responses without inventing a worker task", () => {
    expect(parseOrchestrationPlan(JSON.stringify({
      status: "needs-clarification",
      questions: ["Which host should receive the task?"],
      assumptions: [],
      tasks: [],
    }), ["node-a"])).toMatchObject({ status: "needs-clarification", questions: ["Which host should receive the task?"] });
  });

  it("rejects missing dependencies, cycles, and unlisted hosts", () => {
    const missing = validateTaskGraph([
      { ...tasks[0], dependsOn: ["missing"] },
    ], ["node-a"]);
    const cycle = validateTaskGraph([
      { ...tasks[0], dependsOn: ["implement"] },
      tasks[1],
    ], ["node-a"]);
    const unknownHost = validateTaskGraph([
      { ...tasks[0], hostSlug: "unlisted" },
    ], ["node-a"]);

    expect(missing.errors).toContain("Task inspect depends on missing task missing.");
    expect(cycle.errors).toContain("Task graph contains a dependency cycle.");
    expect(unknownHost.errors).toContain("Task inspect targets an unlisted host.");
  });

  it("returns only queued tasks whose dependencies have completed", () => {
    expect(getReadyTaskIds(tasks)).toEqual(["inspect", "tests"]);
    expect(getReadyTaskIds([
      { ...tasks[0], status: "completed" },
      tasks[1],
      tasks[2],
    ])).toEqual(["implement", "tests"]);
    expect(getReadyTaskIds([
      { ...tasks[0], status: "failed" },
      tasks[1],
      tasks[2],
    ])).toEqual(["tests"]);
  });

  it("requires an explicit retry transition after failure", () => {
    const failed = { ...tasks[0], status: "failed" as const };

    expect(() => transitionTask(failed, "running")).toThrow("Invalid task transition");
    expect(transitionTask(failed, "queued").status).toBe("queued");
    expect(transitionTask({ ...tasks[0], status: "canceled" }, "queued").status).toBe("queued");
  });

  it("does not start a task while a dependency is still active", () => {
    expect(getReadyTaskIds([
      { ...tasks[0], status: "running" },
      tasks[1],
      tasks[2],
    ])).toEqual(["tests"]);
  });

  it("keeps partial task failures visible without ending active work", () => {
    expect(deriveRunStatus([
      { ...tasks[0], status: "failed" },
      { ...tasks[1], status: "running" },
      tasks[2],
    ])).toBe("running");
    expect(deriveRunStatus([
      { ...tasks[0], status: "completed" },
      { ...tasks[1], status: "failed" },
      { ...tasks[2], status: "completed" },
    ])).toBe("completed-with-errors");
  });

  it("reports a canceled run when operator stop leaves completed and canceled tasks", () => {
    expect(deriveRunStatus([
      { ...tasks[0], status: "completed" },
      { ...tasks[1], status: "canceled" },
    ])).toBe("canceled");
  });
});
