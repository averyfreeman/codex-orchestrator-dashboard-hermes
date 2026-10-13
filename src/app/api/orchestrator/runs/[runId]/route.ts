import { NextResponse } from "next/server";
import { readOrchestrationRun } from "@/lib/orchestration-store";

const RUN_ID = /^[a-zA-Z0-9_-]{1,160}$/;

/** Reconcile only saved run/task metadata; transcript content stays in Codex. */
export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  if (!RUN_ID.test(runId)) return NextResponse.json({ error: "Invalid orchestration run id." }, { status: 400 });
  const run = await readOrchestrationRun(runId);
  if (!run) return NextResponse.json({ error: "Orchestration run not found." }, { status: 404 });
  return NextResponse.json(run, { headers: { "Cache-Control": "no-store" } });
}
