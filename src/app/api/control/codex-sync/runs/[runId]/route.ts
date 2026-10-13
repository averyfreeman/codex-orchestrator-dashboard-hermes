import { connection, NextResponse } from "next/server";
import { readCodexSyncRun } from "@/lib/codex-sync";
import { isSameOriginDashboardRequest } from "@/lib/control-security";

/** Return only persisted run IDs, versions, category outcomes, and counts. */
export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  await connection();
  if (!isSameOriginDashboardRequest(request)) {
    return NextResponse.json({ error: "Codex sync status requires a same-origin request." }, { status: 403 });
  }
  const { runId } = await context.params;
  const run = await readCodexSyncRun(runId);
  if (!run) return NextResponse.json({ error: "Codex sync run was not found." }, { status: 404 });
  return NextResponse.json(run, { headers: { "Cache-Control": "no-store" } });
}
