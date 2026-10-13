import { describe, expect, it } from "vitest";
import { isSameOriginDashboardRequest } from "@/lib/control-security";

describe("dashboard same-origin control guard", () => {
  it("accepts same-origin requests on the selected LAN interface", () => {
    expect(isSameOriginDashboardRequest(new Request("http://dashboard.example.test:3000/api/control", {
      method: "POST",
      headers: { host: "dashboard.example.test:3000", origin: "http://dashboard.example.test:3000" },
    }))).toBe(true);
  });

  it("accepts a same-origin overlay Referer when a read request omits Origin", () => {
    expect(isSameOriginDashboardRequest(new Request("http://dashboard.overlay.example.test:3000/api/control", {
      method: "GET",
      headers: { host: "dashboard.overlay.example.test:3000", referer: "http://dashboard.overlay.example.test:3000/codex-sync" },
    }))).toBe(true);
  });

  it("rejects missing, cross-origin, and protocol-mismatched origins", () => {
    expect(isSameOriginDashboardRequest(new Request("http://dashboard.example.test:3000/api/control", { method: "POST" }))).toBe(false);
    expect(isSameOriginDashboardRequest(new Request("http://dashboard.example.test:3000/api/control", {
      method: "POST",
      headers: { host: "dashboard.example.test:3000", origin: "https://attacker.example" },
    }))).toBe(false);
    expect(isSameOriginDashboardRequest(new Request("https://dashboard.example.test:3000/api/control", {
      method: "POST",
      headers: { host: "dashboard.example.test:3000", origin: "http://dashboard.example.test:3000" },
    }))).toBe(false);
    expect(isSameOriginDashboardRequest(new Request("http://dashboard.example.test:3000/api/control", {
      method: "GET",
      headers: { host: "dashboard.example.test:3000", referer: "https://attacker.example/codex-sync" },
    }))).toBe(false);
  });
});
