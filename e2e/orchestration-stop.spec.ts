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

test("confirms run stop and interrupts only the saved worker association", async ({ page }) => {
  let stopRequests = 0;
  let interruptRequest: Record<string, unknown> | null = null;

  await page.addInitScript((hint) => {
    localStorage.setItem("orchestrator:last-run", JSON.stringify(hint));
  }, { orchestrationRunId: runId, createdAt: new Date().toISOString() });
  await page.route("**/api/overview", (route) => route.fulfill({
    json: { checkedAt: new Date().toISOString(), hosts: [hostReport] },
  }));
  await page.route("**/api/logs", (route) => route.fulfill({ json: { events: [] } }));
  await page.route("**/api/orchestrator", (route) => route.fulfill({
    json: { status: "available", configured: true, planningToolsDisabled: true },
  }));
  await page.route(`**/api/orchestrator/runs/${runId}`, (route) => route.fulfill({ json: run }));
  await page.route(`**/api/orchestrator/runs/${runId}/stop`, async (route) => {
    stopRequests += 1;
    await route.fulfill({
      json: {
        run,
        canceledTaskIds: [],
        interrupts: [{ taskId, hostSlug: "node-a", threadId: "thread-e2e", turnId: "turn-e2e" }],
        pendingWorkerIds: [],
      },
    });
  });
  await page.route("**/api/control/codex/interrupt", async (route) => {
    interruptRequest = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: { message: "Interrupt request acknowledged." } });
  });

  await page.goto("/");
  await page.getByRole("tab", { name: "Hermes orchestrator" }).click();
  await expect(page.getByText("Saved run metadata · running")).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "node-a" })).toBeVisible();

  let dialogMessage = "";
  page.once("dialog", async (dialog) => {
    dialogMessage = dialog.message();
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Stop run" }).click();
  expect(dialogMessage).toContain("Acknowledgment does not prove");

  await expect(page.getByText(/1 interrupt request\(s\) acknowledged/)).toBeVisible();
  expect(stopRequests).toBe(1);
  expect(interruptRequest).toEqual({
    host: "node-a",
    threadId: "thread-e2e",
    turnId: "turn-e2e",
    runId,
    taskId,
  });
});
