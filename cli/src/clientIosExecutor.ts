import { remote } from "webdriverio";
import { WebSocket } from "ws";
import { spawn, execSync, ChildProcess } from "child_process";
import { existsSync } from "fs";
import { resolve, join } from "path";

function extractBundleId(appPath: string): string | null {
  try {
    const plistPath = join(appPath, "Info.plist");
    if (existsSync(plistPath)) {
      const output = execSync(`plutil -extract CFBundleIdentifier raw "${plistPath}"`, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (output) return output;
    }
  } catch {}
  return null;
}

export interface DOMElement {
  id?: string | number;
  tagName?: string;
  role?: string;
  text?: string;
  value?: string;
  placeholder?: string;
  ariaLabel?: string;
  attributes?: Record<string, string>;
  xpath?: string;
  selector?: string;
  isInteractive?: boolean;
  href?: string;
  disabled?: boolean;
  checked?: boolean;
  isVisible?: boolean;
  inViewport?: boolean;
  rect?: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

export interface ActResult {
  action: "click" | "type" | "scroll" | "press" | "done" | string;
  targetElementId?: string | number;
  targetDescription?: string;
  text?: string;
  direction?: "up" | "down" | "left" | "right" | "top" | "bottom";
  key?: string;
  value?: string;
  toElementId?: string | number;
  url?: string;
  reasoning: string;
}

export interface LogReportItem {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface ClientIosExecutorOptions {
  serverUrl: string;
  clientId: string;
  appFilePath?: string;
  bundleId?: string;
  deviceName?: string;
  secrets?: Record<string, string>;
}

interface IosSessionState {
  driver: any;
  startTime: number;
  logReports: LogReportItem[];
}

/**
 * Extracts structured DOM elements from mobile page source XML (XCUITest).
 */
export function extractMobileDom(xmlSource: string): DOMElement[] {
  const elements: DOMElement[] = [];
  if (!xmlSource) return elements;

  const elementRegex = /<([a-zA-Z0-9_\.:]+)\s+([^>]+)\/?>/g;
  let match: RegExpExecArray | null;
  let count = 0;

  while ((match = elementRegex.exec(xmlSource)) !== null) {
    const rawTag = match[1];
    const attrString = match[2];

    const getAttr = (key: string): string => {
      const attrMatch = new RegExp(`${key}=["']([^"']*)["']`, "i").exec(
        attrString,
      );
      return attrMatch ? attrMatch[1] : "";
    };

    const type = rawTag
      .replace(/^XCUIElementType/, "")
      .replace(/^[a-zA-Z0-9_]+:/, "");
    const name = getAttr("name");
    const label = getAttr("label");
    const value = getAttr("value");
    const visible =
      getAttr("visible") === "true" || getAttr("displayed") === "true";
    const enabled = getAttr("enabled") !== "false";
    const x = parseInt(getAttr("x") || "0", 10);
    const y = parseInt(getAttr("y") || "0", 10);
    const width = parseInt(getAttr("width") || "0", 10);
    const height = parseInt(getAttr("height") || "0", 10);

    const isInteractiveType = [
      "Button",
      "TextField",
      "SecureTextField",
      "Cell",
      "Switch",
      "Slider",
      "Key",
      "Link",
      "SearchField",
      "SegmentedControl",
      "PickerWheel",
      "Image",
      "StaticText",
      "TextView",
    ].includes(type);

    if (isInteractiveType && visible) {
      count++;
      const id = name || label || `el-${count}`;
      const text = label || value || name || "";

      elements.push({
        id,
        tagName: type,
        text,
        value: value || undefined,
        ariaLabel: label || name || undefined,
        role: type.toLowerCase(),
        selector: `~${id}`,
        xpath: `//XCUIElementType${type}[@name="${id}" or @label="${id}"]`,
        isInteractive: true,
        disabled: !enabled,
        isVisible: visible,
        inViewport: true,
        rect: {
          left: x,
          top: y,
          width,
          height,
        },
      });
    }
  }

  return elements;
}

function getAvailableSimulators(): { name: string; udid: string; state: string }[] {
  try {
    const output = execSync("xcrun simctl list devices available", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const list: { name: string; udid: string; state: string }[] = [];
    const lines = output.split("\n");
    for (const line of lines) {
      const match = line.match(/^\s*(.+?)\s+\(([A-F0-9\-]{36})\)\s+\((.+?)\)/i);
      if (match) {
        list.push({
          name: match[1].trim(),
          udid: match[2].trim(),
          state: match[3].trim(),
        });
      }
    }
    return list;
  } catch {
    return [];
  }
}

function resolveSimulatorDevice(requestedName?: string): { udid?: string; name: string } {
  const devices = getAvailableSimulators();
  const booted = devices.find((d) => d.state.toLowerCase() === "booted");
  if (booted) {
    return { udid: booted.udid, name: booted.name };
  }

  if (requestedName) {
    const match = devices.find(
      (d) =>
        d.name.toLowerCase() === requestedName.toLowerCase() ||
        d.name.toLowerCase().includes(requestedName.toLowerCase()),
    );
    if (match) {
      return { udid: match.udid, name: match.name };
    }
  }

  const firstIphone = devices.find((d) => d.name.toLowerCase().startsWith("iphone"));
  if (firstIphone) {
    return { udid: firstIphone.udid, name: firstIphone.name };
  }

  if (devices.length > 0) {
    return { udid: devices[0].udid, name: devices[0].name };
  }

  return { name: requestedName || "iPhone 17" };
}

export class ClientIosExecutor {
  private serverUrl: string;
  private clientId: string;
  private appFilePath?: string;
  private bundleId?: string;
  private deviceName?: string;
  private secrets: Record<string, string>;
  private ws: WebSocket | null = null;
  private appiumProcess: ChildProcess | null = null;
  private sessions = new Map<string, IosSessionState>();
  private isStopped: boolean = false;

  constructor(options: ClientIosExecutorOptions) {
    this.serverUrl = options.serverUrl;
    this.clientId = options.clientId;
    this.appFilePath = options.appFilePath;
    this.bundleId = options.bundleId;
    this.deviceName = options.deviceName;
    this.secrets = options.secrets || {};
  }

  public async start(): Promise<void> {
    await this.ensureAppiumServer();
    await this.connectWebSocket();
  }

  private async isAppiumRunning(): Promise<boolean> {
    try {
      const res = await fetch("http://127.0.0.1:4723/status", {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async ensureAppiumServer(): Promise<void> {
    if (await this.isAppiumRunning()) return;

    const spawnCmd = "npx -y appium --port 4723 --address 127.0.0.1";
    this.appiumProcess = spawn(spawnCmd, {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    const startTime = Date.now();
    while (Date.now() - startTime < 30000) {
      if (await this.isAppiumRunning()) return;
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (!(await this.isAppiumRunning())) {
      throw new Error(
        "Failed to start local Appium server at http://127.0.0.1:4723 after 30s",
      );
    }
  }

  private connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `${this.serverUrl}/client/${this.clientId}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.on("open", () => {
        this.send({
          type: "CLIENT_READY",
          id: "init",
          success: true,
          data: { clientId: this.clientId, platform: "ios" },
        });
        resolve();
      });

      this.ws.on("message", async (data) => {
        try {
          const msg = JSON.parse(data.toString());
          await this.handleServerMessage(msg);
        } catch (_) {}
      });

      this.ws.on("close", () => {
        if (!this.isStopped) {
          this.cleanup();
        }
      });

      this.ws.on("error", (err) => {
        reject(err);
      });
    });
  }

  private send(msg: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private getSessionKey(sessionId?: string): string {
    if (sessionId) return sessionId;
    if (this.sessions.size > 0) {
      return this.sessions.keys().next().value!;
    }
    return "default";
  }

  private getSession(sessionId?: string): IosSessionState {
    const key = this.getSessionKey(sessionId);
    const session = this.sessions.get(key);
    if (!session) {
      throw new Error(`iOS session '${key}' not found`);
    }
    return session;
  }

  private resolveTargetAppPath(explicitPath?: string): string {
    if (explicitPath && existsSync(resolve(process.cwd(), explicitPath))) {
      return resolve(process.cwd(), explicitPath);
    }
    if (
      this.appFilePath &&
      existsSync(resolve(process.cwd(), this.appFilePath))
    ) {
      return resolve(process.cwd(), this.appFilePath);
    }

    const candidatePaths = [
      resolve(
        process.cwd(),
        "sample-apps/flutter_sample_app/build/ios/iphonesimulator/Runner.app",
      ),
      resolve(
        process.cwd(),
        "sample-apps/flutter_sample_app/build/ios/ipa/Runner.ipa",
      ),
      resolve(process.cwd(), "build/ios/iphonesimulator/Runner.app"),
      resolve(process.cwd(), "build/Runner.app"),
      resolve(process.cwd(), "build/Runner.ipa"),
    ];

    for (const p of candidatePaths) {
      if (existsSync(p)) return p;
    }

    return this.appFilePath || "Runner.app";
  }

  private async initDriver(
    sessionId: string,
    appPath?: string,
  ): Promise<IosSessionState> {
    const targetApp = this.resolveTargetAppPath(appPath);
    const resolvedBundleId = this.bundleId || extractBundleId(targetApp);
    const targetDevice = resolveSimulatorDevice(this.deviceName);

    const capabilities: any = {
      platformName: "iOS",
      "appium:automationName": "XCUITest",
      "appium:newCommandTimeout": 300,
      "appium:usePrebuiltWDA": true,
      "appium:waitForQuiescence": false,
      "appium:simpleIsVisibleCheck": true,
      "appium:useSimpleIsVisibleCheck": true,
      "appium:wdaLaunchTimeout": 120000,
      "appium:wdaConnectionTimeout": 120000,
      "appium:noReset": true,
      "appium:fullReset": false,
      "appium:enforceAppInstall": false,
      "appium:deviceName": targetDevice.name,
    };

    if (targetDevice.udid) {
      capabilities["appium:udid"] = targetDevice.udid;
    }

    if (resolvedBundleId) {
      capabilities["appium:bundleId"] = resolvedBundleId;
    }

    if (targetApp.endsWith(".app") || targetApp.endsWith(".ipa")) {
      capabilities["appium:app"] = targetApp;
    }

    const driver = await remote({
      hostname: "127.0.0.1",
      port: 4723,
      logLevel: "silent",
      capabilities,
    });

    const state: IosSessionState = {
      driver,
      startTime: Date.now(),
      logReports: [],
    };

    this.sessions.set(sessionId, state);
    return state;
  }

  private async handleServerMessage(msg: any) {
    const { type, id, sessionId } = msg;
    try {
      switch (type) {
        case "INIT_PAGE":
        case "INIT_MOBILE_PAGE": {
          await this.initDriver(sessionId || "default", msg.appPath);
          this.send({ type: "RPC_RESPONSE", id, sessionId, success: true });
          break;
        }

        case "GET_PAGE_STATE": {
          const session = this.getSession(sessionId);
          const xmlSource = await session.driver
            .getPageSource()
            .catch(() => "");
          const elements = extractMobileDom(xmlSource);
          const screenshotBase64 = await session.driver
            .takeScreenshot()
            .catch(() => "");

          this.send({
            type: "PAGE_STATE_RESPONSE",
            id,
            sessionId,
            success: true,
            elements,
            screenshotBase64,
            title: "iOS App Screen",
            url: this.bundleId || "iOS App",
          });
          break;
        }

        case "EXECUTE_ACTION": {
          const session = this.getSession(sessionId);
          const startTime = Date.now();
          const result = await this.executeAction(session, msg.actResult);
          this.send({
            type: "ACTION_RESPONSE",
            id,
            sessionId,
            success: result.success,
            executionTimeMs: Date.now() - startTime,
            error: result.error,
          });
          break;
        }

        case "TAKE_SCREENSHOT": {
          const session = this.getSession(sessionId);
          const screenshotBase64 = await session.driver
            .takeScreenshot()
            .catch(() => "");
          this.send({
            type: "SCREENSHOT_RESPONSE",
            id,
            sessionId,
            success: true,
            screenshotBase64,
          });
          break;
        }

        case "WAIT": {
          const session = this.getSession(sessionId);
          await session.driver.pause(msg.ms || 1000);
          this.send({ type: "RPC_RESPONSE", id, sessionId, success: true });
          break;
        }

        case "GET_SESSION_REPORTS": {
          const session = this.getSession(sessionId);
          let logs: any[] = [];
          try {
            logs = await session.driver.getLogs("syslog").catch(() => []);
          } catch (_) {}

          const logReports: LogReportItem[] = (logs || [])
            .slice(-50)
            .map((l: any, idx: number) => ({
              id: `l-${idx + 1}`,
              timestamp: new Date().toISOString(),
              level: (l.level || "info").toLowerCase().includes("err")
                ? "error"
                : "info",
              message:
                typeof l === "string" ? l : l.message || JSON.stringify(l),
            }));

          this.send({
            type: "SESSION_REPORTS_RESPONSE",
            id,
            sessionId,
            success: true,
            logReports,
            networkReports: [],
          });
          break;
        }

        case "CLOSE_PAGE": {
          await this.closeSession(sessionId || "default");
          this.send({ type: "RPC_RESPONSE", id, sessionId, success: true });
          break;
        }

        case "CLOSE_BROWSER": {
          await this.stop();
          this.send({ type: "RPC_RESPONSE", id, sessionId, success: true });
          break;
        }

        default:
          this.send({
            type: "RPC_RESPONSE",
            id,
            sessionId,
            success: false,
            error: `Unknown type: ${type}`,
          });
      }
    } catch (err: any) {
      this.send({
        type: "RPC_RESPONSE",
        id,
        sessionId,
        success: false,
        error: err.message || String(err),
      });
    }
  }

  private async findMobileElement(
    driver: any,
    targetId?: string | number,
  ): Promise<any> {
    if (!targetId) return null;
    const str = String(targetId).trim();

    try {
      const byAcc = await driver.$(`~${str}`);
      if (await byAcc.isExisting()) return byAcc;
    } catch (_) {}

    try {
      const byPred = await driver.$(
        `-ios predicate string:name == "${str}" || label == "${str}"`,
      );
      if (await byPred.isExisting()) return byPred;
    } catch (_) {}

    try {
      const byXpath = await driver.$(`//*[@name="${str}" or @label="${str}"]`);
      if (await byXpath.isExisting()) return byXpath;
    } catch (_) {}

    return null;
  }

  private async executeAction(
    session: SessionState | any,
    actResult: ActResult,
  ): Promise<{ success: boolean; error?: string }> {
    const { action, targetElementId, text, direction } = actResult;
    const driver = session.driver;

    if (action === "done") {
      return { success: true };
    }

    const elem = await this.findMobileElement(driver, targetElementId);

    switch (action) {
      case "click":
        if (!elem)
          throw new Error(`Could not find mobile element: ${targetElementId}`);
        await elem.click();
        break;

      case "type":
        if (!elem)
          throw new Error(`Could not find mobile element: ${targetElementId}`);
        await elem.click().catch(() => {});
        await elem.setValue(text || "");
        break;

      case "scroll":
        if (direction === "down" || direction === "bottom") {
          await driver.execute("mobile: scroll", { direction: "down" });
        } else {
          await driver.execute("mobile: scroll", { direction: "up" });
        }
        break;

      case "press":
        if (elem) {
          await elem.click();
        }
        break;

      default:
        throw new Error(`Unsupported mobile action: ${action}`);
    }

    await driver.pause(1000).catch(() => {});
    return { success: true };
  }

  private async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.driver.deleteSession().catch(() => {});
      this.sessions.delete(sessionId);
    }
  }

  public async stop(): Promise<void> {
    this.isStopped = true;
    for (const [id, session] of this.sessions.entries()) {
      await session.driver.deleteSession().catch(() => {});
    }
    this.sessions.clear();
    if (this.appiumProcess) {
      this.appiumProcess.kill("SIGTERM");
      this.appiumProcess = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private cleanup(): void {
    for (const [, session] of this.sessions) {
      session.driver.deleteSession().catch(() => {});
    }
    this.sessions.clear();
  }
}
