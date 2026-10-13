import { NextResponse } from "next/server";
import { hermesApiClientFromEnvironment } from "@/lib/hermes-api";
import { isSameOriginDashboardRequest } from "@/lib/control-security";

function safeError(error: unknown) {
  if (!(error instanceof Error)) return "Hermes API Server request failed.";
  if (/^Hermes API Server (?:is not configured|must use a loopback address|is unavailable|request failed \(\d+\)|returned an invalid [a-z ]+)\.?$/.test(error.message)) {
    return error.message;
  }
  if (error.message === "Invalid Hermes run id.") return error.message;
  return "Hermes API Server request failed.";
}

/** Reconcile a plan-generation run without persisting prompts or output. */
export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await context.params;
    const run = await hermesApiClientFromEnvironment().getRun(runId);
    return NextResponse.json(run, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = safeError(error);
    return NextResponse.json({ error: message }, {
      status: message === "Hermes API Server is not configured." ? 503 : message === "Invalid Hermes run id." ? 400 : 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

/** Stop only the explicitly identified Hermes planning run. */
export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  if (!isSameOriginDashboardRequest(request)) {
    return NextResponse.json({ error: "Stopping an orchestration plan requires a same-origin request." }, { status: 403 });
  }
  try {
    const { runId } = await context.params;
    const result = await hermesApiClientFromEnvironment().stopRun(runId);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = safeError(error);
    return NextResponse.json({ error: message }, {
      status: message === "Hermes API Server is not configured." ? 503 : message === "Invalid Hermes run id." ? 400 : 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
