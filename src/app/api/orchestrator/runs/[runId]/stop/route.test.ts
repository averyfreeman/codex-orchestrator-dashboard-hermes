import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestStopMock } = vi.hoisted(() => ({ requestStopMock: vi.fn() }));
vi.mock("@/lib/orchestration-store", () => ({ requestOrchestrationRunStop: requestStopMock }));

import { POST } from "./route";

const result = {
  run: { id: "run-stop", status: "running", createdAt: "2026-10-13T00:00:00.000Z", updatedAt: "2026-10-13T00:00:00.000Z", tasks: [] },
  canceledTaskIds: [],
  interrupts: [],
  pendingWorkerIds: [],
};

function request(origin = "http://dashboard.local") {
  return new Request("http://dashboard.local/api/orchestrator/runs/run-stop/stop", {
    method: "POST",
    headers: { host: "dashboard.local", origin },
  });
}

describe("POST /api/orchestrator/runs/{runId}/stop", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects cross-origin stop requests before changing run state", async () => {
    const response = await POST(request("http://attacker.invalid"), { params: Promise.resolve({ runId: "run-stop" }) });
    expect(response.status).toBe(403);
    expect(requestStopMock).not.toHaveBeenCalled();
  });

  it("returns the store's cancellation and interrupt targets", async () => {
    requestStopMock.mockResolvedValue(result);
    const response = await POST(request(), { params: Promise.resolve({ runId: "run-stop" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(requestStopMock).toHaveBeenCalledWith("run-stop");
  });
});
