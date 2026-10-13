import { NextResponse } from "next/server";
import { HOSTS } from "@/lib/hosts";
import type { TaskStatus } from "@/lib/orchestration-model";
import { readOrchestrationRun, updateOrchestrationTask } from "@/lib/orchestration-store";
import { isSameOriginDashboardRequest } from "@/lib/control-security";

const IDENTIFIER = /^[a-zA-Z0-9_-]{1,160}$/;
const TASK_ID = /^[a-zA-Z0-9_-]{1,48}$/;
const CLIENT_TASK_STATUSES = new Set(["queued", "blocked"]);

/** Update an exact worker's content-free state and app-server identifiers. */
export async function PATCH(request: Request, context: { params: Promise<{ runId: string; taskId: string }> }) {
  if (!isSameOriginDashboardRequest(request)) {
    return NextResponse.json({ error: "Worker state updates require a same-origin request." }, { status: 403 });
  }
  const { runId, taskId } = await context.params;
  if (!IDENTIFIER.test(runId) || !TASK_ID.test(taskId)) {
    return NextResponse.json({ error: "Invalid orchestration identifiers." }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A valid worker state update is required." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "A valid worker state update is required." }, { status: 400 });
  }
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== "status") ||
    (value.status !== undefined && (typeof value.status !== "string" || !CLIENT_TASK_STATUSES.has(value.status)))) {
    return NextResponse.json({ error: "Clients may only queue an explicit retry or mark a dependency-blocked task." }, { status: 400 });
  }
  const run = await readOrchestrationRun(runId);
  const task = run?.tasks.find((item) => item.id === taskId);
  if (!run || !task) return NextResponse.json({ error: "Orchestration run or task not found." }, { status: 404 });
  if (!HOSTS.some((host) => host.slug === task.hostSlug)) {
    return NextResponse.json({ error: "The worker host is no longer in the private inventory." }, { status: 409 });
  }
  try {
    const updated = await updateOrchestrationTask(runId, taskId, {
      ...(typeof value.status === "string" ? { status: value.status as TaskStatus } : {}),
    });
    return NextResponse.json(updated, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Worker state update failed." }, { status: 409 });
  }
}
