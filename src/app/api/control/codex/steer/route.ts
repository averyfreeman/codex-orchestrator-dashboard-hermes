import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { findHost } from "@/lib/collector";
import { isSameOriginDashboardRequest } from "@/lib/control-security";
import { readOrchestrationRun } from "@/lib/orchestration-store";

const ID = /^[A-Za-z0-9_.:-]{1,160}$/;
const RUN_ID = /^[A-Za-z0-9_-]{1,160}$/;
const TASK_ID = /^[A-Za-z0-9_-]{1,48}$/;

type BridgeResult = { type: "steered"; threadId: string; turnId: string; accepted: true; transport?: string } | { type: "error"; message: string };

/** Add text to exactly one active Codex turn; never persist the steering content. */
export async function POST(request: Request) {
  if (!isSameOriginDashboardRequest(request)) {
    return NextResponse.json({ error: "Codex controls require a same-origin request." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid live-steer request." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid live-steer request." }, { status: 400 });
  }
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["host", "prompt", "threadId", "turnId", "runId", "taskId"].includes(key)) ||
    typeof value.host !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(value.host) ||
    typeof value.prompt !== "string" || !value.prompt.trim() || value.prompt.length > 40_000 ||
    typeof value.threadId !== "string" || !ID.test(value.threadId) ||
    typeof value.turnId !== "string" || !ID.test(value.turnId) ||
    (value.runId !== undefined && (typeof value.runId !== "string" || !RUN_ID.test(value.runId))) ||
    (value.taskId !== undefined && (typeof value.taskId !== "string" || !TASK_ID.test(value.taskId))) ||
    ((value.runId === undefined) !== (value.taskId === undefined))) {
    return NextResponse.json({ error: "A host, active thread/turn, and prompt up to 40,000 characters are required." }, { status: 400 });
  }

  const host = findHost(value.host);
  if (!host) return NextResponse.json({ error: "The selected host is not in the private fleet inventory." }, { status: 404 });
  if (typeof value.runId === "string" && typeof value.taskId === "string") {
    const run = await readOrchestrationRun(value.runId);
    const task = run?.tasks.find((item) => item.id === value.taskId);
    if (!run || !task) return NextResponse.json({ error: "The reviewed orchestration run or task was not found." }, { status: 404 });
    if (task.hostSlug !== host.slug || task.threadId !== value.threadId || task.turnId !== value.turnId || !["running", "stale"].includes(task.status)) {
      return NextResponse.json({ error: "The worker IDs do not match an active or stale task in this run." }, { status: 409 });
    }
  }

  const child = spawn("python3", ["scripts/codex_control.py"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "ignore"],
  });
  const chunks: Buffer[] = [];
  let size = 0;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await new Promise<BridgeResult>((resolve) => {
    const finish = (value: BridgeResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ type: "error", message: "Codex did not confirm live steering before the timeout." });
    }, 20_000);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 16_000) {
        child.kill("SIGTERM");
        finish({ type: "error", message: "Codex returned an oversized steering response." });
        return;
      }
      chunks.push(chunk);
    });
    child.on("error", () => finish({ type: "error", message: "Could not start the Codex control bridge." }));
    child.on("close", () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8").trim()) as BridgeResult;
        if (parsed.type === "steered" && parsed.accepted === true && parsed.threadId === value.threadId && parsed.turnId === value.turnId) {
          finish(parsed);
        } else {
          finish({ type: "error", message: "Codex did not confirm the requested active turn." });
        }
      } catch {
        finish({ type: "error", message: "Codex did not confirm the requested active turn." });
      }
    });
    child.stdin.end(JSON.stringify({
      mode: "steer",
      host,
      threadId: value.threadId,
      turnId: value.turnId,
      prompt: value.prompt,
    }) + "\n");
  });

  if (result.type === "error") return NextResponse.json({ error: result.message }, { status: 502 });
  return NextResponse.json({ ...result, message: "Live-steer input was accepted for the targeted Codex turn." }, {
    headers: { "Cache-Control": "no-store" },
  });
}
