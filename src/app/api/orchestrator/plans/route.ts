import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { HOSTS } from "@/lib/hosts";
import { hermesApiClientFromEnvironment } from "@/lib/hermes-api";
import { isSameOriginDashboardRequest } from "@/lib/control-security";

const MAX_INTENT_LENGTH = 40_000;
const MAX_PLAN_INSTRUCTIONS_LENGTH = 20_000;

function errorResponse(error: unknown, status: number) {
  const message = error instanceof Error ? error.message : "Hermes API Server request failed.";
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Ask Hermes to draft a validated, operator-reviewed Codex worker plan. */
export async function POST(request: Request) {
  if (!isSameOriginDashboardRequest(request)) {
    return NextResponse.json({ error: "Orchestration planning requires a same-origin request." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A valid JSON request is required." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "A planning request is required." }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  if (typeof input.intent !== "string" || !input.intent.trim() || input.intent.length > MAX_INTENT_LENGTH) {
    return NextResponse.json({ error: "Describe the task in 1–40,000 characters." }, { status: 400 });
  }
  const idempotencyKey = request.headers.get("Idempotency-Key") ?? "";
  if (!/^[\x21-\x7e]{1,255}$/.test(idempotencyKey)) {
    return NextResponse.json({ error: "A valid idempotency key is required." }, { status: 400 });
  }

  try {
    const hermes = hermesApiClientFromEnvironment();
    if (!await hermes.planningToolsDisabled()) {
      return NextResponse.json({
        error: "Hermes planning is disabled until /v1/toolsets confirms that every enabled toolset has no tools. Configure a dedicated planning profile with no tools enabled.",
      }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    const skill = await readFile(path.join(process.cwd(), ".agents/skills/prompt-engineering/SKILL.md"), "utf8");
    const instructions = `${skill}\n\n## Planning-only constraints\nUse the allowlisted host information and verified workspace path supplied with the request. Do not call tools or perform actions. Do not start or alter workers. Return only the required JSON object.\n`;
    if (instructions.length > MAX_PLAN_INSTRUCTIONS_LENGTH) {
      return NextResponse.json({ error: "The project planning skill is too large to send to Hermes." }, { status: 500 });
    }
    const hostChoices = HOSTS.map(({ slug, name, os }) => ({ slug, name, os }));
    const requestInput = `${input.intent.trim()}\n\nVerified dashboard context (not worker authorization):\n${JSON.stringify({
      dashboardWorkspace: process.cwd(),
      availableHosts: hostChoices,
      workerScope: "selected host user's whole $HOME; cwd must be ~ or a verified path below it",
      workerControl: "Codex app-server threads on inventory-listed hosts only",
    })}`;
    const run = await hermes.createRun({ input: requestInput, instructions }, idempotencyKey);
    return NextResponse.json(run, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error && error.message === "Hermes API Server is not configured."
      ? error.message
      : error instanceof Error && error.message === "Hermes API Server must use a loopback address."
        ? error.message
        : "Hermes could not draft the plan. Check the configured loopback API Server and its planning-only tool policy.";
    return errorResponse(new Error(message), message === "Hermes API Server is not configured." ? 503 : 502);
  }
}
