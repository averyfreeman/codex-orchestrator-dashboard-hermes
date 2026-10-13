import { NextResponse } from "next/server";
import { HOSTS } from "@/lib/hosts";
import { isV1TaskDispatchable, parseOrchestrationPlan } from "@/lib/orchestration-model";
import { createOrchestrationRun, readOrchestrationRun } from "@/lib/orchestration-store";
import { isSameOriginDashboardRequest } from "@/lib/control-security";

const RUN_ID = /^[a-zA-Z0-9_-]{1,160}$/;

/** Create or reconcile one run from the operator-reviewed plan; discard all content. */
export async function POST(request: Request) {
  if (!isSameOriginDashboardRequest(request)) {
    return NextResponse.json({ error: "Starting a run requires a same-origin request." }, { status: 403 });
  }
  const id = request.headers.get("Idempotency-Key") ?? "";
  if (!RUN_ID.test(id)) return NextResponse.json({ error: "A valid orchestration run id is required." }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A valid JSON plan is required." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || !("plan" in body)) {
    return NextResponse.json({ error: "An operator-reviewed plan is required." }, { status: 400 });
  }

  try {
    const plan = parseOrchestrationPlan(JSON.stringify((body as { plan: unknown }).plan), HOSTS.map((host) => host.slug));
    if (plan.status !== "ready") return NextResponse.json({ error: "A clarification response is not runnable." }, { status: 400 });
    if (plan.tasks.some((task) => !isV1TaskDispatchable(task))) {
      return NextResponse.json({ error: "Tasks requiring approval or expanded permissions cannot run until the one-time approval bridge is available." }, { status: 409 });
    }
    const run = await createOrchestrationRun(plan.tasks, HOSTS.map((host) => host.slug), id);
    return NextResponse.json(run, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "The reviewed plan is invalid.";
    const status = message.includes("conflicts with an existing run") ? 409 : 400;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

/** Read content-free run metadata by ID for dashboard reconciliation. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("runId") ?? "";
  if (!RUN_ID.test(id)) return NextResponse.json({ error: "A valid run id is required." }, { status: 400 });
  const run = await readOrchestrationRun(id);
  if (!run) return NextResponse.json({ error: "Orchestration run not found." }, { status: 404 });
  return NextResponse.json(run, { headers: { "Cache-Control": "no-store" } });
}
