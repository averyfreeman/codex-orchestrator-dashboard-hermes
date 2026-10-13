import { expect, test } from "@playwright/test";

const runId = "e2e00000-0000-4000-8000-000000000001";
const taskId = "active-worker";
const run = {
  id: runId,
  status: "running",
  createdAt: "2026-10-13T12:00:00.000Z",
  updatedAt: "2026-10-13T12:00:00.000Z",
  tasks: [{
    id: taskId,
    hostSlug: "node-a",
    dependsOn: [],
    status: "running",
    threadId: "thread-e2e",
    turnId: "turn-e2e",
  }],
};

const hostReport = {
  host: { slug: "node-a", name: "Test host", os: "Linux", localIp: null, tailscaleIp: null, zerotierIp: null },
  checkedAt: "2026-10-13T12:00:00.000Z",
  reachable: true,
  connection: { transport: "local", target: null },
  appServer: { status: "running", cliVersion: "0.1.0", version: "1", remoteControlEnabled: true, remoteControlRuntime: "running", loadedThreads: 1, startup: "enabled", error: null },
  herdr: { status: "unavailable", version: null, startup: "unknown", agents: [], workspaces: [], error: null },
  processes: [],
  resources: null,
  worktrees: [],
  error: null,
};

test("sends live steer only to the saved active worker association", async ({ page }) => {
  let steerRequest: Record<string, unknown> | null = null;

  await page.addInitScript((state) => {
    localStorage.setItem("orchestrator:last-run", JSON.stringify(state.hint));
    localStorage.setItem("orchestrator:worker-modes", JSON.stringify(state.workerModes));
  }, {
    hint: { orchestrationRunId: runId, createdAt: new Date().toISOString() },
    workerModes: { runId, modes: { [taskId]: "live-steer" } },
  });
  await page.route("**/api/overview", (route) => route.fulfill({
    json: { checkedAt: new Date().toISOString(), hosts: [hostReport] },
  }));
  await page.route("**/api/logs", (route) => route.fulfill({ json: { events: [] } }));
  await page.route("**/api/orchestrator", (route) => route.fulfill({
    json: { status: "available", configured: true, planningToolsDisabled: true },
  }));
  await page.route(`**/api/orchestrator/runs/${runId}`, (route) => route.fulfill({ json: run }));
  await page.route("**/api/control/codex/steer", async (route) => {
    steerRequest = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: { message: "Live-steer input accepted." } });
  });

  await page.goto("/");
  await page.getByRole("tab", { name: "Hermes orchestrator" }).click();
  await expect(page.getByText("Saved run metadata · running")).toBeVisible();
  await page.getByLabel("LIVE STEER INPUT").fill("Check the test results before concluding.");
  await page.getByRole("button", { name: "Send live steer" }).click();

  await expect(page.getByRole("status").filter({ hasText: `${taskId}: Live-steer input accepted.` })).toBeVisible();
  expect(steerRequest).toEqual({
    host: "node-a",
    threadId: "thread-e2e",
    turnId: "turn-e2e",
    prompt: "Check the test results before concluding.",
    runId,
    taskId,
  });
});
