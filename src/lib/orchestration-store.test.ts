import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { claimOrchestrationTask, createOrchestrationRun, readOrchestrationRun, requestOrchestrationRunStop, updateOrchestrationTask } from "@/lib/orchestration-store";

const originalStateDir = process.env.DASHBOARD_STATE_DIR;
let testDirectory = "";

afterEach(async () => {
  if (originalStateDir === undefined) delete process.env.DASHBOARD_STATE_DIR;
  else process.env.DASHBOARD_STATE_DIR = originalStateDir;
  if (testDirectory) await rm(testDirectory, { recursive: true, force: true });
  testDirectory = "";
});

async function useTemporaryState() {
  testDirectory = await mkdtemp(path.join(os.tmpdir(), "orchestrator-state-"));
  process.env.DASHBOARD_STATE_DIR = testDirectory;
}

const tasks = [
  { id: "inspect", hostSlug: "node-a", dependsOn: [], status: "queued" as const },
  { id: "test", hostSlug: "node-a", dependsOn: ["inspect"], status: "queued" as const },
];

describe("orchestration metadata store", () => {
  it("persists only task IDs, assignments, dependencies, and status metadata", async () => {
    await useTemporaryState();
    const createdAt = new Date("2026-10-13T00:00:00.000Z");
    const run = await createOrchestrationRun(tasks, ["node-a"], "run-1", createdAt);
    const file = path.join(testDirectory, "orchestration.json");

    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readOrchestrationRun("run-1")).toMatchObject({ status: "queued", tasks });
    expect(await readFile(file, "utf8")).not.toMatch(/prompt|reply|tool output|secret worker text/i);
    expect(run.id).toBe("run-1");
  });

  it("records worker IDs and derives run status without storing output", async () => {
    await useTemporaryState();
    await createOrchestrationRun(tasks, ["node-a"], "run-2", new Date("2026-10-13T00:00:00.000Z"));
    await updateOrchestrationTask("run-2", "inspect", { status: "starting" }, new Date("2026-10-13T00:00:30.000Z"));
    await updateOrchestrationTask("run-2", "inspect", {
      status: "running",
      threadId: "thread-abc",
      turnId: "turn-def",
    }, new Date("2026-10-13T00:01:00.000Z"));

    const run = await readOrchestrationRun("run-2");
    expect(run?.status).toBe("running");
    expect(run?.tasks.find((task: { id: string }) => task.id === "inspect")).toMatchObject({
      status: "running", threadId: "thread-abc", turnId: "turn-def",
    });
    expect(await readFile(path.join(testDirectory, "orchestration.json"), "utf8")).not.toContain("output");
  });

  it("rejects reusing an orchestration id for a different task graph", async () => {
    await useTemporaryState();
    await createOrchestrationRun([tasks[0]], ["node-a"], "run-conflict");
    await expect(createOrchestrationRun([
      { id: "different", hostSlug: "node-a", dependsOn: [], status: "queued" },
    ], ["node-a"], "run-conflict"))
      .rejects.toThrow("Orchestration idempotency key conflicts with an existing run.");
  });

  it("atomically claims a queued task only once", async () => {
    await useTemporaryState();
    await createOrchestrationRun([tasks[0]], ["node-a"], "run-claim");
    const claims = await Promise.all([
      claimOrchestrationTask("run-claim", "inspect", "node-a"),
      claimOrchestrationTask("run-claim", "inspect", "node-a"),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect((await readOrchestrationRun("run-claim"))?.tasks[0].cleanupStatus).toBe("pending");
  });

  it("limits active workers per host across separate runs", async () => {
    await useTemporaryState();
    for (let index = 0; index < 5; index += 1) {
      await createOrchestrationRun([{ id: `task-${index}`, hostSlug: "node-a", dependsOn: [], status: "queued" }], ["node-a"], `run-cap-${index}`);
    }
    for (let index = 0; index < 4; index += 1) {
      expect(await claimOrchestrationTask(`run-cap-${index}`, `task-${index}`, "node-a")).not.toBeNull();
    }

    expect(await claimOrchestrationTask("run-cap-4", "task-4", "node-a")).toBeNull();
    await updateOrchestrationTask("run-cap-0", "task-0", { status: "running" });
    await updateOrchestrationTask("run-cap-0", "task-0", { status: "completed" });
    expect(await claimOrchestrationTask("run-cap-4", "task-4", "node-a")).not.toBeNull();
  });

  it("records thread-scoped terminal cleanup without claiming all descendants were stopped", async () => {
    await useTemporaryState();
    await createOrchestrationRun([tasks[0]], ["node-a"], "run-cleanup");
    await claimOrchestrationTask("run-cleanup", "inspect", "node-a");
    await updateOrchestrationTask("run-cleanup", "inspect", { status: "running", threadId: "thread-abc", turnId: "turn-def" });
    await updateOrchestrationTask("run-cleanup", "inspect", { status: "completed", cleanupStatus: "cleared", trackedTerminalCount: 2 });

    expect((await readOrchestrationRun("run-cleanup"))?.tasks[0]).toMatchObject({
      status: "completed", cleanupStatus: "cleared", trackedTerminalCount: 2,
    });
    expect(await readFile(path.join(testDirectory, "orchestration.json"), "utf8")).not.toMatch(/descendant|process tree|all processes/i);
  });

  it("cancels queued work and returns only saved active worker IDs for interruption", async () => {
    await useTemporaryState();
    const stopTasks = [
      { id: "active", hostSlug: "node-a", dependsOn: [], status: "queued" as const },
      { id: "queued", hostSlug: "node-a", dependsOn: [], status: "queued" as const },
      { id: "blocked", hostSlug: "node-a", dependsOn: [], status: "queued" as const },
      { id: "starting", hostSlug: "node-a", dependsOn: [], status: "queued" as const },
    ];
    await createOrchestrationRun(stopTasks, ["node-a"], "run-stop");
    await claimOrchestrationTask("run-stop", "active", "node-a");
    await updateOrchestrationTask("run-stop", "active", { status: "running", threadId: "thread-active", turnId: "turn-active" });
    await updateOrchestrationTask("run-stop", "blocked", { status: "blocked" });
    await claimOrchestrationTask("run-stop", "starting", "node-a");

    const stopped = await requestOrchestrationRunStop("run-stop");
    expect(stopped.canceledTaskIds).toEqual(["queued", "blocked"]);
    expect(stopped.interrupts).toEqual([{
      taskId: "active", hostSlug: "node-a", threadId: "thread-active", turnId: "turn-active",
    }]);
    expect(stopped.pendingWorkerIds).toEqual(["starting"]);
    expect(stopped.run.tasks.map(({ id, status }) => [id, status])).toEqual([
      ["active", "running"], ["queued", "canceled"], ["blocked", "canceled"], ["starting", "starting"],
    ]);
    expect((await requestOrchestrationRunStop("run-stop")).canceledTaskIds).toEqual([]);

    await updateOrchestrationTask("run-stop", "active", { status: "canceled" });
    await updateOrchestrationTask("run-stop", "starting", { status: "canceled" });
    expect((await readOrchestrationRun("run-stop"))?.status).toBe("canceled");
  });

  it("purges terminal metadata after seven days", async () => {
    await useTemporaryState();
    await createOrchestrationRun([tasks[0]], ["node-a"], "run-3", new Date("2026-10-01T00:00:00.000Z"));
    await updateOrchestrationTask("run-3", "inspect", { status: "starting" }, new Date("2026-10-01T00:00:30.000Z"));
    await updateOrchestrationTask("run-3", "inspect", { status: "running" }, new Date("2026-10-01T00:01:00.000Z"));
    await updateOrchestrationTask("run-3", "inspect", { status: "completed" }, new Date("2026-10-01T01:00:00.000Z"));

    expect(await readOrchestrationRun("run-3", new Date("2026-10-08T01:00:01.000Z"))).toBeNull();
  });
});
