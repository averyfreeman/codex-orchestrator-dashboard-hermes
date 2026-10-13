import { beforeEach, describe, expect, it, vi } from "vitest";

const { findHostMock, readRunMock, spawnMock } = vi.hoisted(() => ({
  findHostMock: vi.fn(),
  readRunMock: vi.fn(),
  spawnMock: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("@/lib/collector", () => ({ findHost: findHostMock }));
vi.mock("@/lib/orchestration-store", () => ({ readOrchestrationRun: readRunMock }));
vi.mock("@/lib/logging", () => ({ appendEvent: vi.fn() }));

import { POST } from "./route";

const run = {
  id: "run-one",
  createdAt: "2026-10-13T00:00:00.000Z",
  updatedAt: "2026-10-13T00:00:00.000Z",
  completedAt: null,
  status: "running",
  tasks: [{
    id: "task-one", hostSlug: "node-a", dependsOn: [], status: "running",
    threadId: "thread-one", turnId: "turn-one",
  }],
};

function request(body: object) {
  return new Request("http://dashboard.local/api/control/codex/interrupt", {
    method: "POST",
    headers: { host: "dashboard.local", origin: "http://dashboard.local", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("orchestration-scoped Codex interrupts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findHostMock.mockReturnValue({ slug: "node-a" });
    readRunMock.mockResolvedValue(run);
  });

  it("rejects a turn ID that does not match the saved task before spawning the bridge", async () => {
    const response = await POST(request({
      host: "node-a", threadId: "thread-one", turnId: "turn-other", runId: "run-one", taskId: "task-one",
    }));
    expect(response.status).toBe(409);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("requires run and task association IDs as a pair", async () => {
    const response = await POST(request({
      host: "node-a", threadId: "thread-one", turnId: "turn-one", runId: "run-one",
    }));
    expect(response.status).toBe(400);
    expect(readRunMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
