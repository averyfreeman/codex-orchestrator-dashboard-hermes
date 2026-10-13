import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { createDashboardProxyServer, selectDashboardAddresses } from "./dashboard-network.mjs";

const address = (value, family = value.includes(":") ? "IPv6" : "IPv4") => ({
  address: value,
  family,
  internal: false,
});
const ipv4 = (...octets) => octets.join(".");

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test("selects private addresses only from the default LAN and overlay interfaces", () => {
  const interfaces = {
    enp0s31f6: [address(ipv4(192, 168, 1, 5)), address("198.51.100.12")],
    tailscale0: [address(ipv4(100, 100, 10, 2)), address("fd7a:115c:a1e0::2")],
    zt7ccaa4d: [address(ipv4(10, 147, 20, 9))],
    docker0: [address(ipv4(172, 17, 0, 1))],
    eth1: [address("203.0.113.8")],
  };

  assert.deepEqual(
    [...selectDashboardAddresses(interfaces, "enp0s31f6")].sort(),
    [ipv4(10, 147, 20, 9), ipv4(100, 100, 10, 2), ipv4(192, 168, 1, 5), "fd7a:115c:a1e0::2"],
  );
});

test("accepts a Tailscale address on a utun interface but excludes unrelated VPN ranges", () => {
  const interfaces = {
    utun3: [address(ipv4(100, 96, 0, 4)), address("fd7a:115c:a1e0::4")],
    utun4: [address(ipv4(10, 4, 0, 2)), address("fd00:1234::1")],
  };

  assert.deepEqual(
    [...selectDashboardAddresses(interfaces, "en0")].sort(),
    [ipv4(100, 96, 0, 4), "fd7a:115c:a1e0::4"],
  );
});

test("fails closed when the default interface has only public addresses", () => {
  const interfaces = { eth0: [address("203.0.113.8")] };
  assert.deepEqual([...selectDashboardAddresses(interfaces, "eth0")], []);
});

test("forwards the request body, path, and original host to the loopback app", async (t) => {
  const upstream = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      response.setHeader("x-proxy-test", "passed");
      response.end(JSON.stringify({ method: request.method, host: request.headers.host, url: request.url, body }));
    });
  });
  const upstreamPort = await listen(upstream);
  const proxy = createDashboardProxyServer(upstreamPort);
  const proxyPort = await listen(proxy);
  t.after(async () => { await close(proxy); await close(upstream); });

  const result = await new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port: proxyPort,
      method: "POST",
      path: "/api/tasks?mode=run",
      headers: { host: "dashboard.example.test:3000", "content-type": "text/plain" },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, header: response.headers["x-proxy-test"], body }));
    });
    request.on("error", reject);
    request.end("hello");
  });

  assert.equal(result.status, 200);
  assert.equal(result.header, "passed");
  assert.deepEqual(JSON.parse(result.body), {
    method: "POST",
    host: "dashboard.example.test:3000",
    url: "/api/tasks?mode=run",
    body: "hello",
  });
});
