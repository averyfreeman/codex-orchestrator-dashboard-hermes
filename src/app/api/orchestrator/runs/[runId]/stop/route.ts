import { NextResponse } from "next/server";
import { isSameOriginDashboardRequest } from "@/lib/control-security";
import { requestOrchestrationRunStop } from "@/lib/orchestration-store";

const RUN_ID = /^[A-Za-z0-9_-]{1,160}$/;

/** Cancel queued work and return saved active-worker IDs for operator interrupts. */
export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  if (!isSameOriginDashboardRequest(request)) {
    return NextResponse.json({ error: "Orchestration controls require a same-origin request." }, { status: 403 });
  }
  const { runId } = await context.params;
  if (!RUN_ID.test(runId)) return NextResponse.json({ error: "Invalid orchestration run id." }, { status: 400 });
  try {
    const result = await requestOrchestrationRunStop(runId);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not stop the orchestration run.";
    const status = message.includes("not found") ? 404 : message.includes("Invalid") ? 400 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not stop the orchestration run." : message }, { status });
  }
}
