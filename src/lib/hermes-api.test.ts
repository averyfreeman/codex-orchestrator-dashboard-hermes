import { describe, expect, it, vi } from "vitest";
import { createHermesApiClient } from "@/lib/hermes-api";

const config = { baseUrl: "http://127.0.0.1:8642", apiKey: "server-only-key" };

describe("Hermes API client", () => {
  it("creates a run with bearer auth and idempotency without exposing credentials", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("http://127.0.0.1:8642/v1/runs");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ run_id: "run_123", status: "started" }), { status: 202 });
    });
    const client = createHermesApiClient(config, fetcher);

    await expect(client.createRun({ input: "Plan this task", instructions: "Use the planning contract." }, "request-123"))
      .resolves.toEqual({ runId: "run_123", status: "started" });
    const [, init] = fetcher.mock.calls[0];
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer server-only-key");
    expect(new Headers(init?.headers).get("idempotency-key")).toBe("request-123");
    expect(JSON.parse(String(init?.body))).toEqual({ input: "Plan this task", instructions: "Use the planning contract." });
  });

  it("rejects missing credentials before making a request", async () => {
    const fetcher = vi.fn();
    const client = createHermesApiClient({ baseUrl: "http://127.0.0.1:8642", apiKey: "" }, fetcher);
    await expect(client.getRun("run_123")).rejects.toThrow("Hermes API Server is not configured.");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects non-loopback API endpoints", async () => {
    const fetcher = vi.fn();
    const client = createHermesApiClient({ baseUrl: "http://hermes.example.test:8642", apiKey: "server-only-key" }, fetcher);
    await expect(client.getRun("run_123")).rejects.toThrow("Hermes API Server must use a loopback address.");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("redacts upstream response bodies from errors", async () => {
    const fetcher = vi.fn(async () => new Response("server-only-key internal config", { status: 500 }));
    const client = createHermesApiClient(config, fetcher);
    await expect(client.getRun("run_123")).rejects.toThrow("Hermes API Server request failed (500).");
  });

  it("rejects malformed run ids before making a request", async () => {
    const fetcher = vi.fn();
    const client = createHermesApiClient(config, fetcher);
    await expect(client.getRun("../../etc/passwd")).rejects.toThrow("Invalid Hermes run id.");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports health as a bounded availability flag", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: "ok", profile: "private" }), { status: 200 }));
    const client = createHermesApiClient(config, fetcher);
    await expect(client.health()).resolves.toEqual({ available: true });
  });

  it("does not mark a Hermes runtime safe while any enabled tool is available", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([
      { name: "core", enabled: true, configured: true, tools: ["read_file"] },
    ]), { status: 200 }));
    const client = createHermesApiClient(config, fetcher);
    await expect(client.planningToolsDisabled()).resolves.toBe(false);
  });

  it("accepts a planner profile only when every enabled toolset is empty", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([
      { name: "core", enabled: false, configured: true, tools: ["terminal", "write_file"] },
      { name: "planner", enabled: true, configured: true, tools: [] },
    ]), { status: 200 }));
    const client = createHermesApiClient(config, fetcher);
    await expect(client.planningToolsDisabled()).resolves.toBe(true);
  });
});
