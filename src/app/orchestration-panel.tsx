"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./orchestration-panel.module.css";
import {
  deriveRunStatus,
  getReadyTaskIds,
  isV1TaskDispatchable,
  MAX_ACTIVE_WORKERS_PER_HOST,
  parseOrchestrationPlan,
  validateTaskGraph,
  type OrchestrationPlan,
  type OrchestrationTask,
  type TaskStatus,
} from "@/lib/orchestration-model";

type HostChoice = { slug: string; name: string; os: string; reachable: boolean };
type WorkerMode = "queue" | "live-steer";
type WorkerView = { status: TaskStatus; mode?: WorkerMode; threadId?: string; turnId?: string; output: string; activity?: string; error?: string; cleanupStatus?: "pending" | "cleared" | "unknown"; trackedTerminalCount?: number };
type SavedRunHint = { planningRunId?: string; orchestrationRunId?: string; createdAt: string };
type StoredTask = { id: string; hostSlug: string; dependsOn: string[]; status: TaskStatus; threadId?: string; turnId?: string; cleanupStatus?: "pending" | "cleared" | "unknown"; trackedTerminalCount?: number };
type StoredRun = { id: string; status: string; createdAt: string; updatedAt: string; tasks: StoredTask[] };
type HermesStatus = { status: string; configured: boolean; planningToolsDisabled: boolean; error?: string };
type RunStopResponse = {
  run: StoredRun;
  canceledTaskIds: string[];
  interrupts: Array<{ taskId: string; hostSlug: string; threadId: string; turnId: string }>;
  pendingWorkerIds: string[];
};

const STORAGE_KEY = "orchestrator:last-run";
const WORKER_MODES_KEY = "orchestrator:worker-modes";
const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

function readWorkerModes(runId: string): Record<string, WorkerMode> {
  try {
    const raw = localStorage.getItem(WORKER_MODES_KEY);
    if (!raw) return {};
    const value = JSON.parse(raw) as { runId?: unknown; modes?: unknown };
    if (value.runId !== runId || !value.modes || typeof value.modes !== "object" || Array.isArray(value.modes)) return {};
    return Object.fromEntries(Object.entries(value.modes).filter((entry): entry is [string, WorkerMode] =>
      entry[1] === "queue" || entry[1] === "live-steer",
    ));
  } catch {
    return {};
  }
}

function saveWorkerMode(runId: string, taskId: string, mode: WorkerMode) {
  try {
    localStorage.setItem(WORKER_MODES_KEY, JSON.stringify({
      runId,
      modes: { ...readWorkerModes(runId), [taskId]: mode },
    }));
  } catch {
    // Live steer still works when browser storage is unavailable.
  }
}

function promptForTask(task: OrchestrationTask) {
  return [
    `Goal: ${task.goal}`,
    `Target host: ${task.hostSlug}`,
    `Working directory: ${task.cwd}`,
    `Permission mode: ${task.permissionMode}`,
    `Dependencies: ${task.dependsOn.length ? task.dependsOn.join(", ") : "none"}`,
    `Verified context:\n${task.verifiedContext.map((item) => `- ${item}`).join("\n") || "- None supplied"}`,
    `Constraints:\n${task.constraints.map((item) => `- ${item}`).join("\n") || "- Stay within the selected host user's home directory"}`,
    `Deliverable and task instructions:\n${task.prompt}`,
    `Acceptance checks:\n${task.acceptanceChecks.map((item) => `- ${item}`).join("\n") || "- Complete the stated goal"}`,
    `Verification:\n${task.verification.map((item) => `- ${item}`).join("\n") || "- Report what was verified"}`,
    `Edge cases:\n${task.edgeCases.map((item) => `- ${item}`).join("\n") || "- Report relevant limitations"}`,
    `Assumptions:\n${task.assumptions.map((item) => `- ${item}`).join("\n") || "- State any additional assumptions"}`,
  ].join("\n\n");
}

function initialViews(tasks: readonly OrchestrationTask[]): Record<string, WorkerView> {
  return Object.fromEntries(tasks.map((task) => [task.id, { status: "queued", mode: "queue", output: "" }]));
}

function statusLabel(status: TaskStatus) {
  return status === "approval-needed" ? "Approval needed" : status[0].toUpperCase() + status.slice(1);
}

async function requestWorkerInterrupt(
  host: string,
  threadId: string,
  turnId: string,
  association?: { runId: string; taskId: string },
) {
  const response = await fetch("/api/control/codex/interrupt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ host, threadId, turnId, ...association }),
  });
  const result = await response.json() as { message?: string; error?: string };
  if (!response.ok) throw new Error(result.error ?? "Interrupt request failed.");
  return result.message ?? "Interrupt request acknowledged.";
}

function readHint(): SavedRunHint | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SavedRunHint>;
    const created = typeof value.createdAt === "string" ? Date.parse(value.createdAt) : NaN;
    if (!Number.isFinite(created) || Date.now() - created > RETENTION_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return {
      createdAt: value.createdAt!,
      ...(typeof value.planningRunId === "string" ? { planningRunId: value.planningRunId } : {}),
      ...(typeof value.orchestrationRunId === "string" ? { orchestrationRunId: value.orchestrationRunId } : {}),
    };
  } catch {
    return null;
  }
}

function saveHint(update: Partial<SavedRunHint>) {
  try {
    const value = { ...readHint(), ...update, createdAt: update.createdAt ?? readHint()?.createdAt ?? new Date().toISOString() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // The dashboard still works when browser storage is unavailable.
  }
}

function newRunId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

/** Plan with Hermes, review/edit each task, and explicitly dispatch Codex workers. */
export function OrchestrationPanel({ hosts }: { hosts: HostChoice[] }) {
  const [intent, setIntent] = useState("");
  const [hermes, setHermes] = useState<HermesStatus | null>(null);
  const [planningRunId, setPlanningRunId] = useState("");
  const [planningStatus, setPlanningStatus] = useState("");
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState<Extract<OrchestrationPlan, { status: "ready" }> | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const [assumptions, setAssumptions] = useState<string[]>([]);
  const [planningError, setPlanningError] = useState("");
  const [orchestrationRunId, setOrchestrationRunId] = useState("");
  const [workerViews, setWorkerViews] = useState<Record<string, WorkerView>>({});
  const [workerModes, setWorkerModes] = useState<Record<string, WorkerMode>>({});
  const [savedWorkerModes, setSavedWorkerModes] = useState<Record<string, WorkerMode>>({});
  const [steerDrafts, setSteerDrafts] = useState<Record<string, string>>({});
  const [steeringByTask, setSteeringByTask] = useState<Record<string, boolean>>({});
  const [savedRun, setSavedRun] = useState<StoredRun | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [stoppingRun, setStoppingRun] = useState(false);
  const [notice, setNotice] = useState("");
  const planRef = useRef(plan);
  const workerViewsRef = useRef(workerViews);
  const runIdRef = useRef(orchestrationRunId);
  const dispatchEnabledRef = useRef(false);
  const dispatchRef = useRef<() => void>(() => undefined);
  const inFlightRef = useRef(new Set<string>());
  const stopRequestedRef = useRef(new Set<string>());
  const capacityRetryAtRef = useRef(new Map<string, number>());
  const hostSlugsKey = hosts.map((host) => host.slug).join("\n");
  const hostSlugs = useMemo(() => hostSlugsKey ? hostSlugsKey.split("\n") : [], [hostSlugsKey]);

  useEffect(() => { planRef.current = plan; }, [plan]);
  useEffect(() => { workerViewsRef.current = workerViews; }, [workerViews]);
  useEffect(() => { runIdRef.current = orchestrationRunId; }, [orchestrationRunId]);

  const updateWorker = useCallback((taskId: string, update: Partial<WorkerView>) => {
    const next = { ...workerViewsRef.current, [taskId]: { ...workerViewsRef.current[taskId], ...update } };
    workerViewsRef.current = next;
    setWorkerViews(next);
  }, []);

  const refreshHermesStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/orchestrator", { cache: "no-store" });
      setHermes(await response.json() as HermesStatus);
    } catch {
      setHermes({ status: "unavailable", configured: false, planningToolsDisabled: false, error: "Could not reach the dashboard Hermes status endpoint." });
    }
  }, []);

  useEffect(() => {
    const statusTimer = window.setTimeout(() => void refreshHermesStatus(), 0);
    const hydrateTimer = window.setTimeout(() => {
      const hint = readHint();
      if (!hint) return;
      if (hint.planningRunId && !hint.orchestrationRunId) {
        setPlanningRunId(hint.planningRunId);
        setPlanning(true);
        setPlanningStatus("Reconnecting to saved Hermes run…");
      }
      if (hint.orchestrationRunId) {
        setOrchestrationRunId(hint.orchestrationRunId);
        const modes = readWorkerModes(hint.orchestrationRunId);
        setSavedWorkerModes(modes);
        void fetch(`/api/orchestrator/runs/${encodeURIComponent(hint.orchestrationRunId)}`, { cache: "no-store" })
          .then(async (response) => response.ok ? await response.json() as StoredRun : null)
          .then((result) => { if (result) setSavedRun(result); })
          .catch(() => setNotice("Saved worker metadata could not be reconciled. No workers were restarted."));
      }
    }, 0);
    return () => { window.clearTimeout(statusTimer); window.clearTimeout(hydrateTimer); };
  }, [refreshHermesStatus]);


  async function draftPlan() {
    if (planning || !intent.trim()) return;
    setPlanning(true);
    setWorkerModes({});
    setSteerDrafts({});
    setPlan(null);
    planRef.current = null;
    setQuestions([]);
    setPlanningError("");
    setPlanningStatus("Submitting intent to Hermes…");
    try {
      const response = await fetch("/api/orchestrator/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": newRunId() },
        body: JSON.stringify({ intent }),
      });
      const result = await response.json() as { runId?: string; status?: string; error?: string };
      if (!response.ok || !result.runId) throw new Error(result.error ?? "Hermes could not start a planning run.");
      setPlanningRunId(result.runId);
      setPlanningStatus(`Hermes plan: ${result.status ?? "started"}`);
      saveHint({ planningRunId: result.runId, createdAt: new Date().toISOString() });
    } catch (error) {
      setPlanning(false);
      setPlanningError(error instanceof Error ? error.message : "Could not start Hermes planning.");
    }
  }

  async function stopPlanning() {
    if (!planningRunId) return;
    try {
      const response = await fetch(`/api/orchestrator/plans/runs/${encodeURIComponent(planningRunId)}`, { method: "POST" });
      const result = await response.json() as { status?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Hermes stop request failed.");
      setPlanningStatus(`Hermes stop ${result.status ?? "requested"}; reconciling its terminal state.`);
    } catch {
      setPlanningError("Could not submit the Hermes stop request. The run may continue.");
    }
  }

  function editTask(taskId: string, patch: Partial<OrchestrationTask>) {
    setPlan((current) => {
      if (!current) return current;
      const next = { ...current, tasks: current.tasks.map((task) => task.id === taskId ? { ...task, ...patch } : task) };
      planRef.current = next;
      return next;
    });
  }

  function setWorkerMode(taskId: string, mode: WorkerMode, persistedRunId = runIdRef.current) {
    if (planRef.current) setWorkerModes((current) => ({ ...current, [taskId]: mode }));
    if (persistedRunId) {
      setSavedWorkerModes((current) => ({ ...current, [taskId]: mode }));
      saveWorkerMode(persistedRunId, taskId, mode);
    }
    if (workerViewsRef.current[taskId]) updateWorker(taskId, { mode });
  }

  async function sendLiveSteer(hostSlug: string, threadId: string, turnId: string, taskId: string, runId: string) {
    const prompt = (steerDrafts[taskId] ?? "").trim();
    if (!prompt || steeringByTask[taskId]) return;
    setSteeringByTask((current) => ({ ...current, [taskId]: true }));
    try {
      const response = await fetch("/api/control/codex/steer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: hostSlug, threadId, turnId, prompt, runId, taskId }),
      });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Live steering was not accepted.");
      setSteerDrafts((current) => ({ ...current, [taskId]: "" }));
      setNotice(`${taskId}: ${result.message ?? "Live-steer input accepted."}`);
    } catch (error) {
      setNotice(`${taskId}: ${error instanceof Error ? error.message : "Live steering failed."}`);
    } finally {
      setSteeringByTask((current) => ({ ...current, [taskId]: false }));
    }
  }

  const startWorker = useCallback(async (task: OrchestrationTask, runId: string) => {
    updateWorker(task.id, { status: "starting", error: undefined });
    let dispatchRejected = false;
    try {
      const response = await fetch("/api/control/codex/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: task.hostSlug, prompt: promptForTask(task), cwd: task.cwd, threadId: workerViewsRef.current[task.id]?.threadId, runId, taskId: task.id }),
      });
      if (!response.ok || !response.body) {
        const result = await response.json().catch(() => ({})) as { error?: string };
        if (response.status === 409 && result.error?.includes("task remains queued")) {
          capacityRetryAtRef.current.set(task.hostSlug, Date.now() + 15_000);
          updateWorker(task.id, { status: "queued", error: "Queued: host capacity or dependency state changed; retrying shortly." });
          window.setTimeout(() => dispatchRef.current(), 15_100);
          return;
        }
        dispatchRejected = !response.ok;
        throw new Error(result.error ?? "The Codex worker could not be started.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let terminal = false;
      let sawError = false;
      const consume = (block: string) => {
        const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (!data) return;
        let event: Record<string, unknown>;
        try { event = JSON.parse(data) as Record<string, unknown>; } catch { return; }
        if (event.type === "started") {
          const threadId = typeof event.threadId === "string" ? event.threadId : undefined;
          const turnId = typeof event.turnId === "string" ? event.turnId : undefined;
          const stopWhenStarted = stopRequestedRef.current.has(task.id) && !workerViewsRef.current[task.id]?.threadId;
          updateWorker(task.id, { status: "running", threadId, turnId });
          if (stopWhenStarted && threadId && turnId) {
            stopRequestedRef.current.delete(task.id);
            void requestWorkerInterrupt(task.hostSlug, threadId, turnId, { runId, taskId: task.id })
              .then((message) => setNotice(`${task.id}: ${message}`))
              .catch((error) => setNotice(`${task.id}: automatic interrupt failed: ${error instanceof Error ? error.message : "unknown error"}`));
          }
        } else if (event.type === "delta" && typeof event.delta === "string") {
          updateWorker(task.id, { output: `${workerViewsRef.current[task.id]?.output ?? ""}${event.delta}`.slice(-60_000) });
        } else if (event.type === "message" && typeof event.text === "string") {
          updateWorker(task.id, { output: `${workerViewsRef.current[task.id]?.output ?? ""}${event.text}`.slice(-60_000) });
        } else if (event.type === "activity") {
          updateWorker(task.id, { activity: `${String(event.status)} ${String(event.kind)}` });
        } else if (event.type === "completed") {
          terminal = true;
          const status: TaskStatus = event.failed === true ? "failed" : ["interrupted", "cancelled", "canceled"].includes(String(event.status)) ? "canceled" : "completed";
          updateWorker(task.id, { status, ...(status === "failed" ? { error: "Codex reported a failed turn." } : {}) });
        } else if (event.type === "cleanup") {
          updateWorker(task.id, {
            cleanupStatus: event.status === "cleared" ? "cleared" : "unknown",
            ...(Number.isInteger(event.trackedTerminalCount) && Number(event.trackedTerminalCount) >= 0 ? { trackedTerminalCount: Number(event.trackedTerminalCount) } : {}),
          });
        } else if (event.type === "error") {
          sawError = true;
          updateWorker(task.id, { error: typeof event.message === "string" ? event.message : "Codex worker failed." });
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        blocks.forEach(consume);
      }
      if (buffer.trim()) consume(buffer);
      if (!terminal) updateWorker(task.id, { status: "stale", error: workerViewsRef.current[task.id]?.error ?? (sawError ? "The bridge reported an error without a terminal turn state; the worker may still be active." : "The live stream ended; the worker may still be running. Reconcile saved IDs before retrying.") });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The Codex worker failed.";
      updateWorker(task.id, { status: dispatchRejected ? "failed" : "stale", error: dispatchRejected ? message : `${message} Dispatch state is uncertain; do not retry until reconciled.` });
      setNotice(`${task.title}: ${message}`);
    }
  }, [updateWorker]);

  const runScheduler = useCallback(() => {
    if (!dispatchEnabledRef.current || !planRef.current || !runIdRef.current) return;
    const planNow = planRef.current;
    let views = workerViewsRef.current;
    for (const task of planNow.tasks) {
      const view = views[task.id];
      const dependencyStates = task.dependsOn.map((id) => views[id]?.status);
      if (view?.status === "queued" && dependencyStates.some((status) => status && ["failed", "canceled", "blocked"].includes(status))) {
        views = { ...views, [task.id]: { ...view, status: "blocked", error: "A dependency did not complete." } };
        workerViewsRef.current = views;
        setWorkerViews(views);
        void fetch(`/api/orchestrator/runs/${encodeURIComponent(runIdRef.current)}/tasks/${encodeURIComponent(task.id)}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "blocked" }),
        });
      }
    }
    const activeByHost = new Map<string, number>();
    for (const task of planNow.tasks) {
      if (["starting", "running", "approval-needed", "stale"].includes(views[task.id]?.status ?? "")) {
        activeByHost.set(task.hostSlug, (activeByHost.get(task.hostSlug) ?? 0) + 1);
      }
    }
    const currentTasks = planNow.tasks.map((task) => ({ ...task, status: views[task.id]?.status ?? task.status }));
    for (const taskId of getReadyTaskIds(currentTasks)) {
      const task = planNow.tasks.find((item) => item.id === taskId);
      if (!task || inFlightRef.current.has(taskId) || (activeByHost.get(task.hostSlug) ?? 0) >= MAX_ACTIVE_WORKERS_PER_HOST || (capacityRetryAtRef.current.get(task.hostSlug) ?? 0) > Date.now()) continue;
      if (task.permissionMode !== "home") {
        views = { ...views, [task.id]: { ...views[task.id], status: "blocked", error: "The one-time approval workflow is not configured; this task was not dispatched." } };
        workerViewsRef.current = views;
        setWorkerViews(views);
        void fetch(`/api/orchestrator/runs/${encodeURIComponent(runIdRef.current)}/tasks/${encodeURIComponent(task.id)}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "blocked" }),
        });
        continue;
      }
      activeByHost.set(task.hostSlug, (activeByHost.get(task.hostSlug) ?? 0) + 1);
      inFlightRef.current.add(taskId);
      void startWorker(task, runIdRef.current).finally(() => {
        inFlightRef.current.delete(taskId);
        stopRequestedRef.current.delete(taskId);
        window.setTimeout(() => dispatchRef.current(), 0);
      });
    }
  }, [startWorker]);
  useEffect(() => { dispatchRef.current = runScheduler; }, [runScheduler]);

  useEffect(() => {
    if (!planningRunId) return;
    let disposed = false;
    let settled = false;
    let polling = false;
    let timer = 0;
    const reconcile = async () => {
      if (polling || disposed || settled) return;
      polling = true;
      try {
        const response = await fetch(`/api/orchestrator/plans/runs/${encodeURIComponent(planningRunId)}`, { cache: "no-store" });
        const run = await response.json() as { status?: string; output?: string | null; error?: string };
        if (!response.ok) throw new Error(run.error ?? "Could not reconcile the Hermes planning run.");
        if (disposed) return;
        setPlanningStatus(`Hermes plan: ${run.status ?? "running"}`);
        if (run.status === "completed") {
          if (typeof run.output !== "string") throw new Error("Hermes completed without a plan response.");
          const parsed = parseOrchestrationPlan(run.output, hostSlugs);
          if (parsed.status === "needs-clarification") {
            setQuestions(parsed.questions);
            setAssumptions(parsed.assumptions);
            setPlan(null);
            planRef.current = null;
          } else {
            setPlan(parsed);
            planRef.current = parsed;
            setQuestions([]);
            setAssumptions(parsed.assumptions);
            const initial = initialViews(parsed.tasks);
            workerViewsRef.current = initial;
            setWorkerViews(initial);
          }
          setPlanning(false);
          setPlanningStatus("Plan ready for operator review.");
          settled = true;
          window.clearInterval(timer);
        } else if (["failed", "interrupted", "cancelled", "canceled"].includes(run.status ?? "")) {
          setPlanning(false);
          setPlanningStatus(`Hermes planning run ${run.status}.`);
          settled = true;
          window.clearInterval(timer);
        }
      } catch (error) {
        if (!disposed) {
          setPlanning(false);
          setPlanningError(error instanceof Error ? error.message : "Could not reconcile the Hermes plan.");
          settled = true;
          window.clearInterval(timer);
        }
      } finally {
        polling = false;
      }
    };
    timer = window.setInterval(() => void reconcile(), 1_500);
    void reconcile();
    return () => { disposed = true; window.clearInterval(timer); };
  }, [planningRunId, hostSlugs]);

  useEffect(() => {
    if (!orchestrationRunId || plan) return;
    let disposed = false;
    const reconcile = async () => {
      try {
        const response = await fetch(`/api/orchestrator/runs/${encodeURIComponent(orchestrationRunId)}`, { cache: "no-store" });
        if (!response.ok) return;
        const run = await response.json() as StoredRun;
        if (!disposed) setSavedRun(run);
      } catch {
        if (!disposed) setNotice("Worker status could not be reconciled. No workers were restarted.");
      }
    };
    void reconcile();
    const timer = window.setInterval(() => void reconcile(), 10_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [orchestrationRunId, plan]);

  useEffect(() => {
    if (!plan || !savedRun || savedRun.id !== orchestrationRunId || dispatchEnabledRef.current) return;
    const next = { ...workerViewsRef.current };
    for (const task of savedRun.tasks) {
      const previous = next[task.id];
      if (!previous) continue;
      const status = task.status === "starting" || task.status === "running" ? "stale" : task.status;
      next[task.id] = {
        ...previous,
        status,
        ...(task.threadId ? { threadId: task.threadId } : {}),
        ...(task.turnId ? { turnId: task.turnId } : {}),
        ...(task.cleanupStatus ? { cleanupStatus: task.cleanupStatus } : {}),
        ...(task.trackedTerminalCount !== undefined ? { trackedTerminalCount: task.trackedTerminalCount } : {}),
      };
    }
    workerViewsRef.current = next;
    setWorkerViews(next);
  }, [orchestrationRunId, plan, savedRun]);

  async function startReviewedRun() {
    if (!plan || dispatching) return;
    setDispatching(true);
    setNotice("");
    const id = newRunId();
    try {
      const response = await fetch("/api/orchestrator/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": id },
        body: JSON.stringify({ plan }),
      });
      const result = await response.json() as StoredRun & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The reviewed run could not be created.");
      setOrchestrationRunId(id);
      runIdRef.current = id;
      setSavedRun(result);
      const modes = Object.fromEntries(plan.tasks.map((task) => [task.id, workerModes[task.id] ?? "queue"])) as Record<string, WorkerMode>;
      for (const task of plan.tasks) saveWorkerMode(id, task.id, modes[task.id]);
      setWorkerModes(modes);
      setSavedWorkerModes(modes);
      const initial = initialViews(plan.tasks);
      for (const task of plan.tasks) initial[task.id] = { ...initial[task.id], mode: modes[task.id] };
      workerViewsRef.current = initial;
      setWorkerViews(initial);
      dispatchEnabledRef.current = true;
      saveHint({ orchestrationRunId: id });
      setNotice("Run started. Ready tasks dispatch in dependency order, with at most four active workers per host.");
      window.setTimeout(() => dispatchRef.current(), 0);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not start the reviewed run.");
    } finally {
      setDispatching(false);
    }
  }

  async function retryTask(task: OrchestrationTask) {
    const runId = runIdRef.current;
    if (!runId) return;
    try {
      const response = await fetch(`/api/orchestrator/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "queued" }),
      });
      if (!response.ok) throw new Error("The task could not be re-queued.");
      updateWorker(task.id, { status: "queued", error: undefined, output: "" });
      dispatchEnabledRef.current = true;
      dispatchRef.current();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Retry failed.");
    }
  }

  async function stopTask(
    task: Pick<OrchestrationTask, "hostSlug" | "title">,
    view: Pick<WorkerView, "threadId" | "turnId">,
    association?: { runId: string; taskId: string },
  ) {
    if (!view.threadId || !view.turnId) return;
    try {
      const message = await requestWorkerInterrupt(task.hostSlug, view.threadId, view.turnId, association);
      setNotice(`${task.title}: ${message}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Interrupt request failed.");
    }
  }

  async function stopRun() {
    const runId = runIdRef.current;
    if (!runId || stoppingRun) return;
    const tasks = plan
      ? plan.tasks.map((task) => ({
        id: task.id,
        status: workerViewsRef.current[task.id]?.status ?? task.status,
        threadId: workerViewsRef.current[task.id]?.threadId,
        turnId: workerViewsRef.current[task.id]?.turnId,
      }))
      : savedRun?.tasks ?? [];
    const active = tasks.filter((task) => ["starting", "running", "approval-needed", "stale"].includes(task.status));
    if (!window.confirm("Cancel queued and blocked tasks, then ask each active Codex turn to stop? Acknowledgment does not prove the turn or detached processes have ended.")) return;

    dispatchEnabledRef.current = false;
    const liveStarts = new Set(active.filter((task) =>
      task.status === "starting" && !task.threadId && inFlightRef.current.has(task.id),
    ).map((task) => task.id));
    liveStarts.forEach((taskId) => stopRequestedRef.current.add(taskId));
    setStoppingRun(true);
    try {
      const response = await fetch(`/api/orchestrator/runs/${encodeURIComponent(runId)}/stop`, { method: "POST" });
      const result = await response.json() as Partial<RunStopResponse> & { error?: string };
      if (!response.ok || !result.run || !result.canceledTaskIds || !result.interrupts || !result.pendingWorkerIds) {
        throw new Error(result.error ?? "The orchestration stop request failed.");
      }
      const stopped = result as RunStopResponse;
      setSavedRun(stopped.run);
      if (plan) {
        const next = { ...workerViewsRef.current };
        for (const task of stopped.run.tasks) {
          if (task.status === "canceled") {
            next[task.id] = { ...(next[task.id] ?? { status: "canceled", output: "" }), status: "canceled" };
          }
        }
        workerViewsRef.current = next;
        setWorkerViews(next);
      }

      const interruptResults: Array<{ taskId: string; error?: string }> = [];
      for (let index = 0; index < stopped.interrupts.length; index += 4) {
        const batch = stopped.interrupts.slice(index, index + 4);
        interruptResults.push(...await Promise.all(batch.map(async (worker) => {
          try {
            await requestWorkerInterrupt(worker.hostSlug, worker.threadId, worker.turnId, { runId, taskId: worker.taskId });
            stopRequestedRef.current.delete(worker.taskId);
            return { taskId: worker.taskId };
          } catch (error) {
            return { taskId: worker.taskId, error: error instanceof Error ? error.message : "unknown error" };
          }
        })));
      }
      const acknowledged = interruptResults.filter((result) => !result.error).length;
      const failures = interruptResults.filter((result) => result.error).map((result) => `${result.taskId}: ${result.error}`);
      const messages = [
        `${stopped.canceledTaskIds.length} queued/blocked task(s) canceled.`,
        acknowledged ? `${acknowledged} interrupt request(s) acknowledged; waiting for terminal turn states.` : "No active worker interrupt was acknowledged.",
      ];
      const pendingLive = stopped.pendingWorkerIds.filter((taskId) => liveStarts.has(taskId));
      const pendingOffline = stopped.pendingWorkerIds.filter((taskId) => !liveStarts.has(taskId));
      if (pendingLive.length) messages.push(`Worker IDs are pending for ${pendingLive.join(", ")}; the live stream will attempt an interrupt when they arrive.`);
      if (pendingOffline.length) messages.push(`No worker IDs are saved for ${pendingOffline.join(", ")}; these workers cannot be interrupted until their IDs are reconciled.`);
      if (failures.length) messages.push(`Interrupt failures: ${failures.join("; ")}.`);
      setNotice(messages.join(" "));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The orchestration stop request failed.");
    } finally {
      setStoppingRun(false);
    }
  }

  async function startNewPlan() {
    const previousRunId = runIdRef.current;
    if (previousRunId) {
      void fetch(`/api/orchestrator/runs/${encodeURIComponent(previousRunId)}`, { cache: "no-store" })
        .then(async (response) => response.ok ? await response.json() as StoredRun : null)
        .then((run) => { if (run) setSavedRun(run); });
    }
    dispatchEnabledRef.current = false;
    setPlan(null);
    planRef.current = null;
    setIntent("");
    setOrchestrationRunId("");
    runIdRef.current = "";
    setPlanningRunId("");
    setWorkerViews({});
    setWorkerModes({});
    setSteerDrafts({});
    inFlightRef.current.clear();
    stopRequestedRef.current.clear();
    saveHint({ planningRunId: undefined, orchestrationRunId: undefined, createdAt: new Date().toISOString() });
  }

  const graphValidation = useMemo(
    () => plan ? validateTaskGraph(plan.tasks, hostSlugs) : { valid: false, errors: [] },
    [plan, hostSlugs],
  );
  const currentStatus = plan ? deriveRunStatus(plan.tasks.map((task) => ({ ...task, status: workerViews[task.id]?.status ?? task.status }))) : null;
  const canRun = Boolean(plan && !orchestrationRunId && !dispatching && graphValidation.valid && hosts.length > 0 && plan.tasks.every(isV1TaskDispatchable));
  const savedTasks = plan
    ? plan.tasks.map((task) => ({ id: task.id, status: workerViews[task.id]?.status ?? task.status }))
    : savedRun?.tasks ?? [];
  const hasOutstandingTasks = savedTasks.some((task) => ["queued", "starting", "running", "approval-needed", "stale"].includes(task.status));

  return (
    <section className="view-panel" aria-label="Hermes Codex orchestration">
      <div className="panel-heading">
        <div><h2>Hermes Orchestrator</h2><p>Describe the outcome; review each task and worker prompt before dispatching Codex.</p></div>
        <span className="panel-count">ACTIVE CONTROL</span>
      </div>
      <div className={styles.statusBar} role="status">
        <span className={`health ${hermes?.status === "available" ? "healthy" : "offline"}`}><i /> Hermes {hermes?.status ?? "checking"}</span>
        <span>{hermes?.planningToolsDisabled ? "Planner has no enabled tools" : "Planning blocked until the Hermes profile has no enabled tools"}</span>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => void refreshHermesStatus()}>Check</button>
      </div>
      {!hosts.length && <div className={styles.warning}>No hosts are configured in the private inventory. Add an inventory-listed host before planning workers.</div>}
      {hermes?.error && <div className={styles.warning}>{hermes.error}</div>}
      <label className={styles.intentLabel} htmlFor="orchestrator-intent">What should the workers accomplish?</label>
      <textarea id="orchestrator-intent" className={styles.intent} value={intent} onChange={(event) => setIntent(event.target.value)} maxLength={40_000} placeholder="Describe the outcome, relevant constraints, and what counts as done." disabled={planning} />
      <div className={styles.controls}>
        <span>Hermes drafts only. No worker starts until you review the plan and press Run.</span>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void draftPlan()} disabled={!intent.trim() || planning || hermes?.status !== "available" || !hermes.planningToolsDisabled || !hosts.length}>{planning ? "Planning…" : "Draft plan"}</button>
        {planning && <button type="button" className="btn btn-outline btn-sm" onClick={() => void stopPlanning()}>Stop planning</button>}
        {orchestrationRunId && hasOutstandingTasks && <button type="button" className="btn btn-outline btn-sm" onClick={() => void stopRun()} disabled={stoppingRun}>{stoppingRun ? "Stopping run…" : "Stop run"}</button>}
        {orchestrationRunId && <button type="button" className="btn btn-outline btn-sm" disabled={hasOutstandingTasks} onClick={() => void startNewPlan()}>New plan</button>}
      </div>
      {planningStatus && <p className={styles.statusText}>{planningStatus}</p>}
      {planningError && <div className={styles.warning} role="alert">{planningError}</div>}
      {questions.length > 0 && <section className={styles.clarification}><h3>Hermes needs clarification</h3><ul>{questions.map((question, index) => <li key={`${index}-${question}`}>{question}</li>)}</ul><p>Update the request above and draft a new plan.</p></section>}
      {assumptions.length > 0 && <section className={styles.assumptions}><strong>Assumptions to review</strong><ul>{assumptions.map((assumption, index) => <li key={`${index}-${assumption}`}>{assumption}</li>)}</ul></section>}
      {plan && <>
        <section className={styles.planHeader}>
          <div><strong>Review task plan</strong><span>{plan.tasks.length} tasks · run phase {currentStatus}</span></div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void startReviewedRun()} disabled={!canRun}>{dispatching ? "Starting…" : orchestrationRunId ? "Run started" : "Run reviewed plan"}</button>
        </section>
        {!graphValidation.valid && <div className={styles.warning}>{graphValidation.errors.join(" ")}</div>}
        {plan.tasks.some((task) => task.permissionMode !== "home") && <div className={styles.warning}>A task needs approval or expanded permissions. The current bridge does not support the required one-time authorization flow, so it will not be dispatched.</div>}
        <div className={styles.taskList}>
          {plan.tasks.map((task) => {
            const view = workerViews[task.id] ?? { status: task.status, output: "" };
            const mode = workerModes[task.id] ?? view.mode ?? "queue";
            return <article className={styles.taskCard} key={task.id}>
              <div className={styles.taskHeading}>
                <div><small>TASK {task.id}</small><h3>{task.title}</h3></div>
                <span className={`${styles.taskStatus} ${styles[`status_${view.status.replaceAll("-", "_")}`] ?? ""}`}>{statusLabel(view.status)}</span>
              </div>
              <div className={styles.taskFields}>
                <label>HOST<select value={task.hostSlug} disabled={Boolean(orchestrationRunId)} onChange={(event) => editTask(task.id, { hostSlug: event.target.value })}>{hosts.map((host) => <option key={host.slug} value={host.slug}>{host.name} · {host.reachable ? "reachable" : "unavailable"}</option>)}</select></label>
                <label>WORKING DIRECTORY<input value={task.cwd} disabled={Boolean(orchestrationRunId)} onChange={(event) => editTask(task.id, { cwd: event.target.value })} /></label>
                <label>WORKER MODE<select value={mode} onChange={(event) => setWorkerMode(task.id, event.target.value as WorkerMode)}><option value="queue">Queue (default)</option><option value="live-steer">Live steer</option></select></label>
              </div>
              <p className={styles.goal}>{task.goal}</p>
              <label className={styles.promptLabel}>CODEX WORKER PROMPT<textarea value={task.prompt} disabled={Boolean(orchestrationRunId)} onChange={(event) => editTask(task.id, { prompt: event.target.value })} maxLength={40_000} /></label>
              {task.dependsOn.length > 0 && <p className={styles.dependencies}>Depends on: {task.dependsOn.join(", ")}</p>}
              <div className={styles.taskActions}>
                <small>{view.cleanupStatus ? `${view.cleanupStatus === "cleared" ? "Codex-tracked terminals cleared" : view.cleanupStatus === "pending" ? "Tracked-terminal cleanup pending" : "Tracked-terminal cleanup unknown"}${view.trackedTerminalCount !== undefined ? ` · ${view.trackedTerminalCount} found` : ""}` : view.activity ?? (view.threadId ? `Thread ${view.threadId}` : "Queue mode · home-scoped worker")}</small>
                {["running", "approval-needed", "stale"].includes(view.status) && view.threadId && view.turnId && <button type="button" className="btn btn-outline btn-sm" onClick={() => void stopTask(task, view, { runId: orchestrationRunId, taskId: task.id })}>Stop worker</button>}
                {orchestrationRunId && ["failed", "blocked", "canceled"].includes(view.status) && <button type="button" className="btn btn-outline btn-sm" onClick={() => void retryTask(task)}>Retry explicitly</button>}
              </div>
              {mode === "live-steer" && ["running", "stale"].includes(view.status) && view.threadId && view.turnId && orchestrationRunId && <>
                <label className={styles.promptLabel}>LIVE STEER INPUT<textarea value={steerDrafts[task.id] ?? ""} onChange={(event) => setSteerDrafts((current) => ({ ...current, [task.id]: event.target.value }))} maxLength={40_000} placeholder="Add guidance to this active Codex turn." /></label>
                <div className={styles.taskActions}><small>Sent only to this active turn; not retained by the dashboard.</small><button type="button" className="btn btn-primary btn-sm" disabled={!steerDrafts[task.id]?.trim() || steeringByTask[task.id]} onClick={() => void sendLiveSteer(task.hostSlug, view.threadId!, view.turnId!, task.id, orchestrationRunId)}>{steeringByTask[task.id] ? "Sending…" : "Send live steer"}</button></div>
              </>}
              {view.error && <p className={styles.warning} role="status">{view.error}</p>}
              {view.output && <pre className={styles.output}>{view.output}</pre>}
            </article>;
          })}
        </div>
      </>}
      {savedRun && !plan && <section className={styles.savedRun}>
        <strong>Saved run metadata · {savedRun.status}</strong><p>Only IDs, host assignments, and state are retained. Prompts and tool output are not stored by the dashboard.</p>
        {savedRun.tasks.map((task) => {
          const mode = savedWorkerModes[task.id] ?? "queue";
          const observedStatus = task.status === "running" ? "stale" : task.status;
          const active = ["starting", "running", "approval-needed", "stale"].includes(task.status);
          const steerable = ["running", "stale"].includes(task.status);
          return <article className={styles.taskCard} key={task.id}>
            <div className={styles.taskHeading}><div><small>TASK {task.id}</small><h3>{task.hostSlug}</h3></div><span>{statusLabel(observedStatus)}</span></div>
            <div className={styles.taskFields}>
              <label>WORKER MODE<select value={mode} onChange={(event) => setWorkerMode(task.id, event.target.value as WorkerMode, savedRun.id)}><option value="queue">Queue (default)</option><option value="live-steer">Live steer</option></select></label>
              <span>Thread {task.threadId ?? "not started"}</span>
            </div>
            {active && task.threadId && task.turnId && <div className={styles.taskActions}>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => void stopTask({ hostSlug: task.hostSlug, title: task.id }, task, { runId: savedRun.id, taskId: task.id })}>Stop worker</button>
            </div>}
            {mode === "live-steer" && steerable && task.threadId && task.turnId && <>
              <label className={styles.promptLabel}>LIVE STEER INPUT<textarea value={steerDrafts[task.id] ?? ""} onChange={(event) => setSteerDrafts((current) => ({ ...current, [task.id]: event.target.value }))} maxLength={40_000} placeholder="Add guidance to this active Codex turn." /></label>
              <div className={styles.taskActions}><small>Sent only to this active turn; not retained by the dashboard.</small><button type="button" className="btn btn-primary btn-sm" disabled={!steerDrafts[task.id]?.trim() || steeringByTask[task.id]} onClick={() => void sendLiveSteer(task.hostSlug, task.threadId!, task.turnId!, task.id, savedRun.id)}>{steeringByTask[task.id] ? "Sending…" : "Send live steer"}</button></div>
            </>}
          </article>;
        })}
      </section>}
      {notice && <div className={styles.warning} role="status">{notice}<button type="button" onClick={() => setNotice("")}>Dismiss</button></div>}
      {orchestrationRunId && <div className={styles.footerNote}>Run ID {orchestrationRunId} · metadata expires after seven days. A disconnected dashboard does not stop active workers; reconnect reconciles saved IDs and never restarts workers automatically. “Terminals cleared” covers only Codex-tracked background terminals in that thread; detached or untracked descendants are not guaranteed to stop.</div>}
    </section>
  );
}
