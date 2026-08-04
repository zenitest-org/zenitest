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
  secrets?: Record<string, string>;
}

export class ZeniProxyClient {
  private options: ClientOptions;
  private secrets: Record<string, string> = {};
  private chromeProcess: ChildProcess | null = null;
  private localWs: WebSocket | null = null;
  private serverWs: WebSocket | null = null;
  private isStopped = false;

  constructor(options: Partial<ClientOptions> = {}) {
    const defaultWsUrl = process.env.ZENITEST_WS_URL || process.env.WS_URL || "ws://localhost:3001";
    this.options = {
      serverUrl: options.serverUrl || defaultWsUrl,
      clientId: options.clientId || "test-client-" + Math.random().toString(36).substring(7),
      chromePort: options.chromePort || 9222,
      headless: options.headless ?? true,
      secrets: options.secrets || {},
    };
    this.secrets = this.options.secrets || {};
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
    const alreadyRunning = await this.isChromeRunning();
    if (!alreadyRunning) {
      const execPath = await this.getChromeExecutablePath();

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
    }

    // Retrieve CDP websocket endpoint
    const res = await fetch(`http://127.0.0.1:${this.options.chromePort}/json/version`);
    const data = await res.json();
    const chromeDebuggerUrl = data.webSocketDebuggerUrl;
    if (!chromeDebuggerUrl) {
      throw new Error("Local Chrome returned no webSocketDebuggerUrl.");
    }

    return new Promise<void>((resolve, reject) => {
      this.localWs = new WebSocket(chromeDebuggerUrl);

      const clientConnectUrl = `${this.options.serverUrl}/client/${this.options.clientId}`;
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
          this.localWs.on("message", (data, isBinary) => {
            if (this.serverWs?.readyState === WebSocket.OPEN) {
              this.serverWs.send(data, { binary: isBinary });
            }
          });

          this.serverWs.on("message", (data, isBinary) => {
            if (this.localWs?.readyState === WebSocket.OPEN) {
              const payload = hydrateSecretsPayload(data, isBinary, this.secrets);
              this.localWs.send(payload, { binary: isBinary });
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
        handleError(err);
      });
      this.serverWs.on("error", (err) => {
        handleError(err);
      });
    });
  }

  public stop() {
    this.isStopped = true;

    try {
      this.localWs?.close();
      this.serverWs?.close();
    } catch {}

    if (this.chromeProcess) {
      this.chromeProcess.kill();
      this.chromeProcess = null;
    }
  }
}

function hydrateSecretsPayload(data: any, isBinary: boolean, secrets: Record<string, string>): any {
  if (isBinary || !secrets || Object.keys(secrets).length === 0) {
    return data;
  }
  try {
    const str = typeof data === "string" ? data : data.toString("utf-8");
    if (!str.includes("${secret.")) {
      return data;
    }
    const hydrated = str.replace(/\$\{secret\.([a-zA-Z0-9_]+)\}/g, (match, key) => {
      if (secrets[key] !== undefined) return secrets[key];
      const foundKey = Object.keys(secrets).find((k) => k.toLowerCase() === key.toLowerCase());
      if (foundKey && secrets[foundKey] !== undefined) return secrets[foundKey];
      return match;
    });
    return typeof data === "string" ? hydrated : Buffer.from(hydrated, "utf-8");
  } catch {
    return data;
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

  const defaultWsUrl = process.env.ZENITEST_WS_URL || process.env.WS_URL || "ws://localhost:3001";
  const serverUrl = getArg("--server", defaultWsUrl);
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
    console.error("Execution error:", err);
    process.exit(1);
  });

  process.on("SIGINT", () => {
    client.stop();
    process.exit(0);
  });
}
