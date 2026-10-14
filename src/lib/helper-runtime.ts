import os from "node:os";

/** System Python must not inherit a user-managed Python or shared-library tree. */
export function localPythonRuntime(system = os.type(), environment: NodeJS.ProcessEnv = process.env): { command: string; environment: NodeJS.ProcessEnv } {
  return {
    command: system === "Linux" ? "/usr/bin/python3" : "python3",
    environment: { ...environment, LD_LIBRARY_PATH: undefined, PYTHONHOME: undefined, PYTHONPATH: undefined },
  };
}
