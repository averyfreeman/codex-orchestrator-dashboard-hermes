import { expect, test } from "@playwright/test";

const reviewedPlan = {
  status: "ready",
  assumptions: [],
  tasks: [{
    id: "inspect-dashboard",
    title: "Inspect the dashboard",
    goal: "Review the dashboard and report findings.",
    verifiedContext: [],
    targetHostSlug: "node-a",
    cwd: "~",
    constraints: [],
    permissionMode: "home",
    dependsOn: [],
    prompt: "Inspect the project and report findings.",
    acceptanceChecks: ["Report findings."],
    verification: [],
    edgeCases: [],
    assumptions: [],
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

test("requires review and an explicit Run action before dispatching a Codex worker", async ({ page }) => {
  let planningRequests = 0;
  let runCreationRequests = 0;
  let workerDispatchRequests = 0;

  await page.route("**/api/overview", (route) => route.fulfill({
    json: { checkedAt: new Date().toISOString(), hosts: [hostReport] },
  }));
  await page.route("**/api/logs", (route) => route.fulfill({ json: { events: [] } }));
  await page.route("**/api/orchestrator", (route) => route.fulfill({
    json: { status: "available", configured: true, planningToolsDisabled: true },
  }));
  await page.route("**/api/orchestrator/plans", async (route) => {
    if (route.request().method() === "POST") planningRequests += 1;
    await route.fulfill({ json: { runId: "planning-e2e", status: "running" } });
  });
  await page.route("**/api/orchestrator/plans/runs/planning-e2e", (route) => route.fulfill({
    json: { status: "completed", output: JSON.stringify(reviewedPlan) },
  }));
  await page.route("**/api/orchestrator/runs", async (route) => {
    runCreationRequests += 1;
    await route.fulfill({ status: 201, json: {} });
  });
  await page.route("**/api/control/codex/turn", async (route) => {
    workerDispatchRequests += 1;
    await route.fulfill({ status: 500, json: { error: "Unexpected worker dispatch in review-only test." } });
  });

  await page.goto("/");
  await page.getByRole("tab", { name: "Hermes orchestrator" }).click();
  await page.locator("#orchestrator-intent").fill("Review the dashboard and report findings.");
  await page.getByRole("button", { name: "Draft plan" }).click();

  await expect(page.getByRole("heading", { level: 3, name: "Inspect the dashboard" })).toBeVisible();
  await expect(page.getByText("Plan ready for operator review.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run reviewed plan" })).toBeEnabled();
  await expect(page.getByLabel("CODEX WORKER PROMPT")).toHaveValue("Inspect the project and report findings.");
  expect(planningRequests).toBe(1);
  expect(runCreationRequests).toBe(0);
  expect(workerDispatchRequests).toBe(0);
});

test("keeps approval-required tasks blocked until the approval bridge exists", async ({ page }) => {
  let runCreationRequests = 0;
  let workerDispatchRequests = 0;
  const approvalRequiredPlan = {
    ...reviewedPlan,
    tasks: reviewedPlan.tasks.map((task) => ({ ...task, permissionMode: "approval-required" })),
  };

  await page.route("**/api/overview", (route) => route.fulfill({
    json: { checkedAt: new Date().toISOString(), hosts: [hostReport] },
  }));
  await page.route("**/api/logs", (route) => route.fulfill({ json: { events: [] } }));
  await page.route("**/api/orchestrator", (route) => route.fulfill({
    json: { status: "available", configured: true, planningToolsDisabled: true },
  }));
  await page.route("**/api/orchestrator/plans", (route) => route.fulfill({
    json: { runId: "approval-planning-e2e", status: "running" },
  }));
  await page.route("**/api/orchestrator/plans/runs/approval-planning-e2e", (route) => route.fulfill({
    json: { status: "completed", output: JSON.stringify(approvalRequiredPlan) },
  }));
  await page.route("**/api/orchestrator/runs", async (route) => {
    runCreationRequests += 1;
    await route.fulfill({ status: 201, json: {} });
  });
  await page.route("**/api/control/codex/turn", async (route) => {
    workerDispatchRequests += 1;
    await route.fulfill({ status: 500, json: { error: "Unexpected worker dispatch for an approval-required task." } });
  });

  await page.goto("/");
  await page.getByRole("tab", { name: "Hermes orchestrator" }).click();
  await page.locator("#orchestrator-intent").fill("Review a task that requires additional permission.");
  await page.getByRole("button", { name: "Draft plan" }).click();

  await expect(page.getByText("Review task plan", { exact: true })).toBeVisible();
  await expect(page.getByText(/A task needs approval or expanded permissions/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Run reviewed plan" })).toBeDisabled();
  expect(runCreationRequests).toBe(0);
  expect(workerDispatchRequests).toBe(0);
});
