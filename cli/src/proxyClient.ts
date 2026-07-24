import { spawn, ChildProcess } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { WebSocket } from "ws";

import { downloadChromeHeadlessShell, findMonorepoRoot } from "./download-chrome";

interface ClientOptions {
  serverUrl: string;
  clientId: string;
  chromePort: number;
  headless: boolean;
}

export class ZeniProxyClient {
  private options: ClientOptions;
  private chromeProcess: ChildProcess | null = null;
  private localWs: WebSocket | null = null;
  private serverWs: WebSocket | null = null;
  private isStopped = false;

  constructor(options: Partial<ClientOptions> = {}) {
    this.options = {
      serverUrl: options.serverUrl || "ws://localhost:3000",
      clientId: options.clientId || "test-client-" + Math.random().toString(36).substring(7),
      chromePort: options.chromePort || 9222,
      headless: options.headless ?? true,
    };
  }

  private async getChromeExecutablePath(): Promise<string> {
    const platform =
      process.platform === "darwin"
        ? process.arch === "arm64"
          ? "mac-arm64"
          : "mac-x64"
        : process.platform === "linux"
          ? "linux64"
          : process.arch === "x64"
            ? "win64"
            : "win32";

    const executableName = process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
    const localPath = join(findMonorepoRoot(), "chrome-headless-shell", `chrome-headless-shell-${platform}`, executableName);

    if (existsSync(localPath)) {
      return localPath;
    }

    console.log(`[CLI Client] Local chrome-headless-shell not found. Downloading...`);
    const downloadedPath = await downloadChromeHeadlessShell();
    return downloadedPath;
  }

  private async isChromeRunning(): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${this.options.chromePort}/json/version`);
      return res.ok;
    } catch {
      return false;
    }
  }

  public async start() {
    console.log(`[CLI Client] Initializing Client Session for ID: ${this.options.clientId}`);

    const alreadyRunning = await this.isChromeRunning();
    if (alreadyRunning) {
      console.log(`[CLI Client] Chrome remote debugging is already running on port ${this.options.chromePort}.`);
    } else {
      console.log(`[CLI Client] Launching Chrome on remote debugging port ${this.options.chromePort}...`);
      const execPath = await this.getChromeExecutablePath();
      console.log(`[CLI Client] Launching binary: ${execPath}`);

      const args = [
        `--remote-debugging-port=${this.options.chromePort}`,
        "--remote-allow-origins=*",
        "--disable-gpu",
        "--disable-dev-shm-usage",
      ];
      if (this.options.headless) {
        args.push("--headless");
      }

      this.chromeProcess = spawn(execPath, args, {
        detached: true,
        stdio: "ignore",
      });
      this.chromeProcess.unref();

      // Poll until ready
      let ready = false;
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (await this.isChromeRunning()) {
          ready = true;
          break;
        }
      }

      if (!ready) {
        throw new Error(`Failed to initialize Chrome on remote debugging port ${this.options.chromePort}`);
      }
      console.log(`[CLI Client] Chrome successfully started.`);
    }

    // Retrieve CDP websocket endpoint
    const res = await fetch(`http://127.0.0.1:${this.options.chromePort}/json/version`);
    const data = await res.json();
    const chromeDebuggerUrl = data.webSocketDebuggerUrl;
    if (!chromeDebuggerUrl) {
      throw new Error("Local Chrome returned no webSocketDebuggerUrl.");
    }

    return new Promise<void>((resolve, reject) => {
      console.log(`[CLI Client] Connecting to local Chrome CDP: ${chromeDebuggerUrl}`);
      this.localWs = new WebSocket(chromeDebuggerUrl);

      const clientConnectUrl = `${this.options.serverUrl}/client/${this.options.clientId}`;
      console.log(`[CLI Client] Connecting to WebSocket Server: ${clientConnectUrl}`);
      this.serverWs = new WebSocket(clientConnectUrl);

      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error("Timeout waiting for proxy client connection. Make sure the server is running."));
        }
      }, 10000);

      const setupPiping = () => {
        if (this.localWs?.readyState === WebSocket.OPEN && this.serverWs?.readyState === WebSocket.OPEN) {
          console.log(`[CLI Client] CDP Tunnel established successfully!`);

          this.localWs.on("message", (data, isBinary) => {
            if (this.serverWs?.readyState === WebSocket.OPEN) {
              this.serverWs.send(data, { binary: isBinary });
            }
          });

          this.serverWs.on("message", (data, isBinary) => {
            if (this.localWs?.readyState === WebSocket.OPEN) {
              this.localWs.send(data, { binary: isBinary });
            }
          });

          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve();
          }
        }
      };

      const cleanup = () => {
        if (this.isStopped) return;
        console.log("[CLI Client] Connection lost. Cleaning up and shutting down...");
        this.stop();
      };

      const handleError = (err: any) => {
        cleanup();
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(err);
        }
      };

      this.localWs.on("open", setupPiping);
      this.serverWs.on("open", setupPiping);

      this.localWs.on("close", cleanup);
      this.serverWs.on("close", cleanup);

      this.localWs.on("error", (err) => {
        console.error("[CLI Client] Local Chrome WebSocket error:", err);
        handleError(err);
      });
      this.serverWs.on("error", (err) => {
        console.error("[CLI Client] Server WebSocket error:", err);
        handleError(err);
      });
    });
  }

  public stop() {
    this.isStopped = true;
    console.log("[CLI Client] Stopping client agent...");

    try {
      this.localWs?.close();
      this.serverWs?.close();
    } catch {}

    if (this.chromeProcess) {
      console.log("[CLI Client] Terminating Chrome browser process...");
      this.chromeProcess.kill();
      this.chromeProcess = null;
    }
  }
}

// Check arguments if run from CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const getArg = (name: string, fallback: string): string => {
    const idx = args.findIndex(a => a.startsWith(name));
    if (idx !== -1) {
      const parts = args[idx].split("=");
      return parts[1] || args[idx + 1] || fallback;
    }
    return fallback;
  };

  const serverUrl = getArg("--server", "ws://localhost:3000");
  const clientId = getArg("--clientId", "test-client");
  const chromePort = Number(getArg("--chromePort", "9222"));
  const headless = args.includes("--headless") || !args.includes("--headed");

  const client = new ZeniProxyClient({
    serverUrl,
    clientId,
    chromePort,
    headless,
  });

  client.start().catch((err) => {
    console.error("[CLI Client] Execution error:", err);
    process.exit(1);
  });

  process.on("SIGINT", () => {
    client.stop();
    process.exit(0);
  });
}
