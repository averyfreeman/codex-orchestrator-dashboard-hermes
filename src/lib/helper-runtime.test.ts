import { expect, it } from "vitest";
import { localPythonRuntime } from "./helper-runtime";
it("uses Linux system Python even with a broken user runtime first on PATH", () => {
  const runtime = localPythonRuntime("Linux", { NODE_ENV: "test", PATH: "/user/bin:/usr/bin", LD_LIBRARY_PATH: "/broken/lib", PYTHONHOME: "/broken/python", PYTHONPATH: "/foreign/modules", CODEX_HOME: "/user/state" });
  expect(runtime.command).toBe("/usr/bin/python3");
  expect(runtime.environment.LD_LIBRARY_PATH).toBeUndefined();
  expect(runtime.environment.PYTHONHOME).toBeUndefined();
  expect(runtime.environment.PYTHONPATH).toBeUndefined();
  expect(runtime.environment.CODEX_HOME).toBe("/user/state");
});
it("retains the provisioned macOS interpreter lookup", () => {
  expect(localPythonRuntime("Darwin").command).toBe("python3");
});
