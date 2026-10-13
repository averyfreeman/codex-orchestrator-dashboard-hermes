import { spawnSync } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { isIP } from "node:net";

function ipv4Octets(address) {
  if (isIP(address) !== 4) return null;
  const octets = address.split(".").map(Number);
  return octets.length === 4 ? octets : null;
}

function inTailscaleIpv4Range(address) {
  const parts = ipv4Octets(address);
  return parts !== null && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

function isPrivateAddress(address) {
  const normalized = address.split("%")[0].toLowerCase();
  const parts = ipv4Octets(normalized);
  if (parts) {
    const [first, second] = parts;
    return first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      inTailscaleIpv4Range(normalized);
  }

  return isIP(normalized) === 6 && (normalized.startsWith("fc") || normalized.startsWith("fd"));
}

function isTailscaleAddress(address) {
  const normalized = address.split("%")[0].toLowerCase();
  return inTailscaleIpv4Range(normalized) || normalized.startsWith("fd7a:115c:a1e0:");
}

function isOverlayInterface(name, addresses) {
  const normalized = name.toLowerCase();
  if (/^tailscale\d*$/.test(normalized) || /^zt[a-z0-9]+$/.test(normalized) || normalized === "zerotierone") {
    return true;
  }
  return /^utun\d+$/.test(normalized) && addresses.some(isTailscaleAddress);
}

/** Select only private addresses on the default route and recognized overlay interfaces. */
export function selectDashboardAddresses(interfaces, defaultInterface) {
  const selected = new Set();

  for (const [name, entries] of Object.entries(interfaces ?? {})) {
    if (!Array.isArray(entries)) continue;
    const addresses = entries
      .filter((entry) => entry && typeof entry.address === "string" && !entry.internal)
      .map((entry) => entry.address);
    const eligibleInterface = name === defaultInterface || isOverlayInterface(name, addresses);
    if (!eligibleInterface) continue;

    for (const address of addresses) {
      if (isPrivateAddress(address)) selected.add(address.split("%")[0]);
    }
  }

  return selected;
}

/** Find the interface that carries the host's IPv4 or IPv6 default route. */
export function getDefaultRouteInterface() {
  const linux = spawnSync("ip", ["route", "show", "default"], { encoding: "utf8", timeout: 2_000 });
  const linuxMatch = /\bdev\s+([^\s]+)/.exec(linux.stdout ?? "");
  if (linux.status === 0 && linuxMatch) return linuxMatch[1];

  const linuxV6 = spawnSync("ip", ["-6", "route", "show", "default"], { encoding: "utf8", timeout: 2_000 });
  const linuxV6Match = /\bdev\s+([^\s]+)/.exec(linuxV6.stdout ?? "");
  if (linuxV6.status === 0 && linuxV6Match) return linuxV6Match[1];

  const mac = spawnSync("route", ["-n", "get", "default"], { encoding: "utf8", timeout: 2_000 });
  const macMatch = /^\s*interface:\s*(\S+)/m.exec(mac.stdout ?? "");
  return mac.status === 0 && macMatch ? macMatch[1] : null;
}

/** Proxy browser traffic to the Next.js process listening on loopback. */
export function createDashboardProxyServer(internalPort) {
  const server = createServer((request, response) => {
    const upstream = httpRequest({
      hostname: "127.0.0.1",
      port: internalPort,
      method: request.method,
      path: request.url ?? "/",
      headers: request.headers,
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });

    upstream.on("error", () => {
      if (!response.headersSent) {
        response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      }
      response.end("Dashboard service is unavailable.");
    });
    request.pipe(upstream);
  });

  server.on("upgrade", (request, socket, head) => {
    const upstream = httpRequest({
      hostname: "127.0.0.1",
      port: internalPort,
      method: request.method,
      path: request.url ?? "/",
      headers: request.headers,
    });

    upstream.on("upgrade", (response, upstreamSocket, upstreamHead) => {
      socket.write(`HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage ?? ""}\r\n`);
      for (let index = 0; index < response.rawHeaders.length; index += 2) {
        socket.write(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}\r\n`);
      }
      socket.write("\r\n");
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstreamSocket.write(head);
      upstreamSocket.pipe(socket);
      socket.pipe(upstreamSocket);
      socket.on("close", () => upstreamSocket.destroy());
      upstreamSocket.on("close", () => socket.destroy());
    });

    upstream.on("response", (response) => {
      socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage ?? "Bad Gateway"}\r\nConnection: close\r\n\r\n`);
      response.pipe(socket);
      socket.on("close", () => response.destroy());
    });

    upstream.on("error", () => {
      if (!socket.destroyed) socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    });
    upstream.end();
  });

  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.destroyConnections = () => {
    for (const socket of sockets) socket.destroy();
  };

  return server;
}
