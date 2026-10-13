import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { NextResponse } from "next/server";
import { findHost } from "@/lib/collector";
import { isSameOriginDashboardRequest } from "@/lib/control-security";
import { readDashboardProfile } from "@/lib/dashboard-profile";
import { appendEvent } from "@/lib/logging";
import { claimOrchestrationTask, readOrchestrationRun, updateOrchestrationTask } from "@/lib/orchestration-store";

function isSafeCwd(value: string) {
  return value === "~" || (value.startsWith("~/") && value.slice(2).split(/[\\/]+/).every((part) => part && part !== "." && part !== ".."));
}

function parseBody(value: unknown): { host: string; prompt: string; threadId?: string; cwd?: string; runId?: string; taskId?: string } | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (typeof body.host !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(body.host)) return null;
  if (typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 40_000) return null;
  if (body.threadId !== undefined && (typeof body.threadId !== "string" || body.threadId.length > 160)) return null;
  if (body.cwd !== undefined && (typeof body.cwd !== "string" || body.cwd.length > 500 || /[\0\r\n]/.test(body.cwd) || !isSafeCwd(body.cwd))) return null;
  if (body.runId !== undefined && (typeof body.runId !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(body.runId))) return null;
  if (body.taskId !== undefined && (typeof body.taskId !== "string" || !/^[a-zA-Z0-9_-]{1,48}$/.test(body.taskId))) return null;
  if ((body.runId === undefined) !== (body.taskId === undefined)) return null;
  return {
    host: body.host,
    prompt: body.prompt,
    ...(typeof body.threadId === "string" ? { threadId: body.threadId } : {}),
    ...(typeof body.cwd === "string" ? { cwd: body.cwd } : {}),
    ...(typeof body.runId === "string" ? { runId: body.runId } : {}),
    ...(typeof body.taskId === "string" ? { taskId: body.taskId } : {}),
  };
}

async function audit(host: string, type: string, stats: Record<string, unknown>) {
  try {
    await appendEvent({ source: "codex-control", host, type, stats });
  } catch {
    // A telemetry write failure must not interrupt a Codex turn.
  }
}

/** Start or resume one selected-host Codex turn and stream projected SSE events. */
export async function POST(request: Request) {
  if (!isSameOriginDashboardRequest(request)) {
    return NextResponse.json({ error: "Codex controls require a same-origin request." }, { status: 403 });
  }

  let input: { host: string; prompt: string; threadId?: string; cwd?: string; runId?: string; taskId?: string } | null;
  try {
    input = parseBody(await request.json());
  } catch {
    input = null;
  }
  if (!input) return NextResponse.json({ error: "A host and prompt are required; prompts are limited to 40,000 characters." }, { status: 400 });

  const host = findHost(input.host);
  if (!host) return NextResponse.json({ error: "The selected host is not in the private fleet inventory." }, { status: 404 });
  if (input.runId && input.taskId) {
    const run = await readOrchestrationRun(input.runId);
    const task = run?.tasks.find((item) => item.id === input.taskId);
    if (!run || !task) return NextResponse.json({ error: "The reviewed orchestration run or task was not found." }, { status: 404 });
    if (task.hostSlug !== host.slug) return NextResponse.json({ error: "The worker host does not match the reviewed task assignment." }, { status: 409 });
    if (task.status !== "queued") return NextResponse.json({ error: "The reviewed task is not queued; retry must be explicit." }, { status: 409 });
    const claimed = await claimOrchestrationTask(input.runId, input.taskId, host.slug);
    if (!claimed) return NextResponse.json({ error: "The host worker limit may be reached or task dependencies are incomplete; the task remains queued." }, { status: 409 });
  }
  const profile = await readDashboardProfile();
  const child = spawn("python3", ["scripts/codex_control.py"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "ignore"],
  });
  const encoder = new TextEncoder();
  const decoder = new StringDecoder("utf8");
  let buffered = "";
  let sawError = false;
  let sawTerminal = false;
  let spawnFailed = false;
  let closed = false;
  let stateWrites: Promise<void> = Promise.resolve();

  const persistTask = (
    status?: "running" | "completed" | "failed" | "canceled" | "stale",
    metadata: { threadId?: string; turnId?: string; cleanupStatus?: "pending" | "cleared" | "unknown"; trackedTerminalCount?: number } = {},
  ) => {
    if (!input.runId || !input.taskId) return stateWrites;
    stateWrites = stateWrites.then(async () => {
      await updateOrchestrationTask(input.runId!, input.taskId!, { ...(status ? { status } : {}), ...metadata });
    }).catch(() => undefined);
    return stateWrites;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: Record<string, unknown>) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const handleLine = (line: string) => {
        if (!line.trim()) return;
        let event: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(line);
          if (!parsed || typeof parsed !== "object") return;
          event = parsed as Record<string, unknown>;
        } catch {
          sawError = true;
          send({ type: "error", message: "The Codex control bridge returned an invalid event." });
          return;
        }
        let waitForStateWrite = false;
        if (event.type === "started") {
          if (input.runId && input.taskId && typeof event.threadId === "string" && typeof event.turnId === "string") {
            waitForStateWrite = true;
            void persistTask("running", { threadId: event.threadId, turnId: event.turnId }).then(() => send(event));
          }
          void audit(host.slug, "codex.turn.started", {
            profile: profile.id,
            threadId: event.threadId,
            turnId: event.turnId,
            transport: event.transport,
            networkAccess: profile.networkAccess,
            model: "gpt-6-luna",
          });
        } else if (event.type === "usage") {
          void audit(host.slug, "codex.usage", {
            profile: profile.id,
            inputTokens: event.inputTokens,
            cachedInputTokens: event.cachedInputTokens,
            outputTokens: event.outputTokens,
            reasoningTokens: event.reasoningTokens,
            totalTokens: event.totalTokens,
          });
        } else if (event.type === "completed") {
          sawTerminal = true;
          if (input.runId && input.taskId) {
            const status = event.failed === true
              ? "failed"
              : ["interrupted", "canceled", "cancelled"].includes(String(event.status)) ? "canceled" : "completed";
            waitForStateWrite = true;
            void persistTask(status, typeof event.turnId === "string" ? { turnId: event.turnId } : {}).then(() => send(event));
          }
          void audit(host.slug, "codex.turn.completed", {
            profile: profile.id,
            turnId: event.turnId,
            status: event.status,
            failed: event.failed === true,
          });
        } else if (event.type === "cleanup") {
          waitForStateWrite = true;
          const cleanupStatus = event.status === "cleared" ? "cleared" : "unknown";
          const trackedTerminalCount = Number.isInteger(event.trackedTerminalCount) && Number(event.trackedTerminalCount) >= 0
            ? Number(event.trackedTerminalCount)
            : undefined;
          void persistTask(undefined, { cleanupStatus, ...(trackedTerminalCount !== undefined ? { trackedTerminalCount } : {}) }).then(() => send(event));
        } else if (event.type === "error") {
          sawError = true;
        }
        if (!waitForStateWrite) send(event);
      };

      child.stdout.on("data", (chunk: Buffer) => {
        buffered += decoder.write(chunk);
        let newline = buffered.indexOf("\n");
        while (newline >= 0) {
          handleLine(buffered.slice(0, newline));
          buffered = buffered.slice(newline + 1);
          newline = buffered.indexOf("\n");
        }
      });
      child.stdout.on("end", () => {
        buffered += decoder.end();
        if (buffered.trim()) handleLine(buffered);
      });
      child.on("error", () => {
        spawnFailed = true;
        sawError = true;
        void persistTask("failed");
        send({ type: "error", message: "Could not start the Codex control bridge." });
      });
      child.on("close", () => {
        if (!sawTerminal && !spawnFailed) {
          void persistTask("stale", { cleanupStatus: "unknown" });
          if (!sawError) stateWrites = stateWrites.then(() => send({ type: "error", message: "The Codex control connection ended without a terminal turn state; the worker may still be running." }));
        }
        void stateWrites.finally(() => {
          if (!closed) controller.close();
        });
      });
      child.stdin.end(JSON.stringify({
        mode: "turn",
        host,
        prompt: input.prompt,
        threadId: input.threadId,
        cwd: input.cwd,
        networkAccess: profile.networkAccess,
        closeWorker: Boolean(input.runId && input.taskId),
      }) + "\n");
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
