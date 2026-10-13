export type HermesApiConfig = { baseUrl: string; apiKey: string };
export type HermesRunRequest = { input: string; instructions: string };
export type HermesRunStatus = {
  runId: string;
  status: string;
  output: string | null;
  sessionId: string | null;
};

const RUN_ID = /^[A-Za-z0-9_-]{1,160}$/;
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,255}$/;

type FetchLike = typeof fetch;

function isLoopbackUrl(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      !url.username && !url.password && !url.search && !url.hash &&
      (url.pathname === "/" || url.pathname === "");
  } catch {
    return false;
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeRun(value: unknown): HermesRunStatus {
  const run = object(value);
  if (!run || typeof run.run_id !== "string" || !RUN_ID.test(run.run_id) || typeof run.status !== "string") {
    throw new Error("Hermes API Server returned an invalid run status.");
  }
  return {
    runId: run.run_id,
    status: run.status.slice(0, 40),
    output: typeof run.output === "string" ? run.output.slice(0, 100_000) : null,
    sessionId: typeof run.session_id === "string" ? run.session_id.slice(0, 160) : null,
  };
}

/** Server-only client for a dedicated loopback Hermes API Server. */
export function createHermesApiClient(config: HermesApiConfig, fetcher: FetchLike = fetch) {
  async function request(path: string, init: RequestInit = {}) {
    if (!config.apiKey || !config.baseUrl) throw new Error("Hermes API Server is not configured.");
    if (!isLoopbackUrl(config.baseUrl)) throw new Error("Hermes API Server must use a loopback address.");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${config.apiKey}`);
    headers.set("Accept", "application/json");
    if (init.body) headers.set("Content-Type", "application/json");

    let response: Response;
    try {
      response = await fetcher(new URL(path, config.baseUrl), { ...init, headers, cache: "no-store" });
    } catch {
      throw new Error("Hermes API Server is unavailable.");
    }
    if (!response.ok) throw new Error(`Hermes API Server request failed (${response.status}).`);
    try {
      return await response.json() as unknown;
    } catch {
      throw new Error("Hermes API Server returned an invalid response.");
    }
  }

  return {
    async health() {
      const result = object(await request("/health"));
      return { available: result?.status === "ok" };
    },
    async planningToolsDisabled() {
      const value = await request("/v1/toolsets");
      if (!Array.isArray(value)) return false;
      return value.every((candidate) => {
        const toolset = object(candidate);
        if (!toolset || typeof toolset.enabled !== "boolean" || !Array.isArray(toolset.tools)) return false;
        if (!toolset.tools.every((tool) => typeof tool === "string")) return false;
        return toolset.enabled ? toolset.tools.length === 0 : true;
      });
    },
    async createRun(body: HermesRunRequest, idempotencyKey: string) {
      if (!body.input.trim() || body.input.length > 40_000 || !body.instructions.trim() || body.instructions.length > 40_000) {
        throw new Error("Hermes run input is invalid.");
      }
      if (!IDEMPOTENCY_KEY.test(idempotencyKey)) throw new Error("Invalid Hermes idempotency key.");
      const result = object(await request("/v1/runs", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(body),
      }));
      if (!result || typeof result.run_id !== "string" || !RUN_ID.test(result.run_id) || typeof result.status !== "string") {
        throw new Error("Hermes API Server returned an invalid run response.");
      }
      return { runId: result.run_id, status: result.status.slice(0, 40) };
    },
    async getRun(runId: string) {
      if (!RUN_ID.test(runId)) throw new Error("Invalid Hermes run id.");
      return normalizeRun(await request(`/v1/runs/${encodeURIComponent(runId)}`));
    },
    async stopRun(runId: string) {
      if (!RUN_ID.test(runId)) throw new Error("Invalid Hermes run id.");
      const result = object(await request(`/v1/runs/${encodeURIComponent(runId)}/stop`, { method: "POST" }));
      return { status: typeof result?.status === "string" ? result.status.slice(0, 40) : "stopping" };
    },
  };
}

/** Read server-side Hermes API settings without ever returning the bearer key. */
export function hermesApiClientFromEnvironment(fetcher?: FetchLike) {
  return createHermesApiClient({
    baseUrl: process.env.HERMES_API_SERVER_URL ?? "http://127.0.0.1:8642",
    apiKey: process.env.API_SERVER_KEY ?? "",
  }, fetcher);
}
