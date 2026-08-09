import { spawn, ChildProcess } from "child_process";

let appiumProcess: ChildProcess | null = null;

/**
 * Checks if Appium server is responsive at http://127.0.0.1:4723/status
 */
async function isAppiumRunning(): Promise<boolean> {
  try {
    const res = await fetch("http://127.0.0.1:4723/status", { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Starts the Appium server concurrently alongside the Zeni API Server.
 */
export async function startAppiumServer(): Promise<void> {
  if (await isAppiumRunning()) {
    console.log("[Appium Server] Appium is already running at http://127.0.0.1:4723");
    return;
  }

  console.log("[Appium Server] Launching Appium server at http://127.0.0.1:4723...");
  appiumProcess = spawn("bunx", ["appium"], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  appiumProcess.stdout?.on("data", (data) => {
    const msg = data.toString().trim();
    if (msg) console.log(`[Appium Logs] ${msg}`);
  });

  appiumProcess.stderr?.on("data", (data) => {
    const msg = data.toString().trim();
    if (msg && !msg.includes("WARN")) console.error(`[Appium Error] ${msg}`);
  });

  appiumProcess.on("exit", (code) => {
    console.log(`[Appium Server] Appium process exited with code ${code}`);
    appiumProcess = null;
  });

  // Poll until Appium responds to HTTP status checks
  const startTime = Date.now();
  while (Date.now() - startTime < 15000) {
    if (await isAppiumRunning()) {
      console.log("[Appium Server] Appium server is up and listening on port 4723.");
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.warn("[Appium Server Warning] Appium server startup poll timed out after 15s.");
}

/**
 * Cleanly stops the Appium server when the Zeni API server shuts down.
 */
export function stopAppiumServer(): void {
  if (appiumProcess) {
    console.log("[Appium Server] Stopping Appium server...");
    appiumProcess.kill("SIGTERM");
    appiumProcess = null;
  }
}
