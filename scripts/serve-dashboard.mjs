import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { networkInterfaces } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { createDashboardProxyServer, getDefaultRouteInterface, selectDashboardAddresses } from "./dashboard-network.mjs";

function getPort(value, fallback) {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Dashboard ports must be integers between 1 and 65535.");
  }
  return port;
}

function waitForPort(port, child, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      if (child.exitCode !== null) {
        reject(new Error(`Next.js exited with code ${child.exitCode}.`));
        return;
      }
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", async () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error("Timed out waiting for the dashboard service."));
          return;
        }
        await delay(250);
        tryConnect();
      });
    };
    tryConnect();
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
    server.closeAllConnections();
    server.destroyConnections?.();
  });
}

async function serve(mode) {
  const externalPort = getPort(process.env.PORT, 3000);
  const defaultInternalPort = externalPort === 65_535 ? externalPort - 1 : externalPort + 1;
  const internalPort = getPort(process.env.DASHBOARD_INTERNAL_PORT, defaultInternalPort);
  if (internalPort === externalPort) throw new Error("Internal and dashboard ports must be different.");

  const nextCli = new URL("../node_modules/next/dist/bin/next", import.meta.url);
  const child = spawn(process.execPath, [nextCli.pathname, mode, "--hostname", "127.0.0.1", "--port", String(internalPort)], {
    cwd: process.cwd(),
    env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(internalPort) },
    stdio: "inherit",
  });
  let stopping = false;
  let reconciliationActive = false;
  const listeners = new Map();

  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    clearInterval(reconcileTimer);
    if (child.exitCode === null) child.kill(signal ?? "SIGTERM");
    await Promise.all([...listeners.values()].map(closeServer));
  };

  const bind = async (address) => {
    if (listeners.has(address)) return;
    const server = createDashboardProxyServer(internalPort);
    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => reject(error);
        server.once("error", onError);
        server.listen(externalPort, address, () => {
          server.removeListener("error", onError);
          resolve();
        });
      });
      listeners.set(address, server);
    } catch (error) {
      await closeServer(server);
      if (address === "127.0.0.1") throw error;
    }
  };

  const reconcile = async () => {
    if (stopping || reconciliationActive) return;
    reconciliationActive = true;
    try {
      const selected = selectDashboardAddresses(networkInterfaces(), getDefaultRouteInterface());
      const desired = new Set(["127.0.0.1", ...selected]);
      for (const address of desired) await bind(address);
      for (const [address, server] of listeners) {
        if (!desired.has(address)) {
          listeners.delete(address);
          await closeServer(server);
        }
      }
    } finally {
      reconciliationActive = false;
    }
  };

  const reconcileTimer = setInterval(() => { void reconcile(); }, 30_000);
  reconcileTimer.unref();
  const shutdown = () => { void stop("SIGTERM"); };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  child.once("exit", (code) => {
    if (!stopping) {
      process.exitCode = code ?? 1;
      void stop("SIGTERM");
    }
  });
  child.once("error", (error) => {
    console.error(`Could not start the dashboard service (${error.code ?? "process error"}).`);
    process.exitCode = 1;
    void stop("SIGTERM");
  });

  try {
    await waitForPort(internalPort, child);
    await reconcile();
    console.log("Dashboard proxy listening on loopback and selected private interfaces.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Dashboard service failed to start.");
    process.exitCode = 1;
    await stop("SIGTERM");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2] === "dev" ? "dev" : "start";
  void serve(mode);
}
