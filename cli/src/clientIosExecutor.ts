import { remote } from "webdriverio";
import { WebSocket } from "ws";
import { spawn, execSync, ChildProcess } from "child_process";
import { existsSync, mkdirSync, readdirSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";

function findPrebuiltWdaDerivedData(): string | null {
  try {
    const defaultDerivedData = join(
      process.env.HOME || "",
      "Library/Developer/Xcode/DerivedData",
    );
    if (!existsSync(defaultDerivedData)) return null;

    const entries = readdirSync(defaultDerivedData);
    for (const entry of entries) {
      if (entry.startsWith("WebDriverAgent-")) {
        const candidate = join(defaultDerivedData, entry);
        const productsDir = join(candidate, "Build/Products");
        if (existsSync(productsDir)) {
          return candidate;
        }
      }
    }
  } catch (_) {}
  return null;
}

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
  appiumPort?: number;
  simulatorUdid?: string;
  headless?: boolean;
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

/**
 * Returns all currently booted iOS simulators.
 * Used by cli.ts to determine the available pool for parallel execution.
 */
export function getBootedSimulators(): { name: string; udid: string }[] {
  return getAvailableSimulators()
    .filter((d) => d.state.toLowerCase() === "booted")
    .map(({ name, udid }) => ({ name, udid }));
}
/**
 * Ensures at least `count` iOS simulators are booted for parallel execution.
 * If fewer are available, clones a shutdown simulator and boots all of them.
 *
 * IMPORTANT: `xcrun simctl clone` only works on shutdown simulators.
 * So we find a shutdown source, clone it, then boot everything.
 *
 * Returns the list of booted simulators and a cleanup function that shuts down
 * and deletes any simulators that were created by this call.
 */
export function ensureBootedSimulators(
  count: number,
  templateName?: string,
): { simulators: { name: string; udid: string }[]; cleanup: () => void } {
  const clonedUdids: string[] = [];

  // Check if we already have enough booted
  let booted = getBootedSimulators();
  if (booted.length >= count) {
    return { simulators: booted.slice(0, count), cleanup: () => {} };
  }

  // Find a source simulator to clone from (must be shutdown — clone fails on booted devices)
  const all = getAvailableSimulators();
  const shutdownDevices = all.filter((d) => d.state.toLowerCase() === "shutdown");

  // Pick a source: prefer exact name match, then substring match, then any iPhone, then first available
  let source = templateName
    ? shutdownDevices.find((d) => d.name.toLowerCase() === templateName.toLowerCase())
      || shutdownDevices.find((d) => d.name.toLowerCase().includes(templateName.toLowerCase()))
    : undefined;
  if (!source) {
    source = shutdownDevices.find((d) => d.name.toLowerCase().startsWith("iphone"));
  }
  if (!source && shutdownDevices.length > 0) {
    source = shutdownDevices[0];
  }

  if (!source) {
    // No shutdown simulators available to clone — just boot what we can
    if (booted.length === 0 && all.length > 0) {
      try {
        execSync(`xcrun simctl boot "${all[0].udid}"`, {
          stdio: ["ignore", "ignore", "ignore"],
        });
        execSync("sleep 2", { stdio: ["ignore", "ignore", "ignore"] });
      } catch (_) {}
      booted = getBootedSimulators();
    }
    return { simulators: booted, cleanup: () => {} };
  }

  // Determine how many clones we need.
  // We'll use the source itself as simulator #1, then clone for the rest.
  const alreadyBooted = booted.length;
  // The source counts as one if it isn't already booted
  const sourceIsBooted = booted.some((b) => b.udid === source!.udid);
  const simsFromSource = sourceIsBooted ? 0 : 1; // source will be booted as #1
  const needed = count - alreadyBooted - simsFromSource;

  // Clone the source (while it's still shutdown) for each additional sim needed
  for (let i = 0; i < needed; i++) {
    const cloneName = `${source.name} (ZeniTest ${i + 2})`;
    try {
      const cloneOutput = execSync(
        `xcrun simctl clone "${source.udid}" "${cloneName}"`,
        { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();

      // The output is the new UDID
      if (cloneOutput && cloneOutput.match(/^[A-F0-9\-]{36}$/i)) {
        clonedUdids.push(cloneOutput);
      }
    } catch (_) {
      // If cloning fails, work with what we have
      break;
    }
  }

  // Now boot the source (if not already booted) and all clones
  if (!sourceIsBooted) {
    try {
      execSync(`xcrun simctl boot "${source.udid}"`, {
        stdio: ["ignore", "ignore", "ignore"],
      });
    } catch (_) {}
  }

  for (const udid of clonedUdids) {
    try {
      execSync(`xcrun simctl boot "${udid}"`, {
        stdio: ["ignore", "ignore", "ignore"],
      });
    } catch (_) {}
  }

  // Wait for all simulators to finish booting
  execSync("sleep 5", { stdio: ["ignore", "ignore", "ignore"] });

  const finalBooted = getBootedSimulators();

  const cleanup = () => {
    // Shut down and delete cloned simulators
    for (const udid of clonedUdids) {
      try {
        execSync(`xcrun simctl shutdown "${udid}"`, {
          stdio: ["ignore", "ignore", "ignore"],
        });
      } catch (_) {}
      try {
        execSync(`xcrun simctl delete "${udid}"`, {
          stdio: ["ignore", "ignore", "ignore"],
        });
      } catch (_) {}
    }
    // Shut down the source simulator (but don't delete it)
    if (!sourceIsBooted && source) {
      try {
        execSync(`xcrun simctl shutdown "${source.udid}"`, {
          stdio: ["ignore", "ignore", "ignore"],
        });
      } catch (_) {}
    }
  };

  return { simulators: finalBooted.slice(0, count), cleanup };
}

function resolveSimulatorDevice(requestedName?: string, forceUdid?: string): { udid?: string; name: string } {
  // If a specific UDID is forced (for parallel execution), use it directly
  if (forceUdid) {
    const devices = getAvailableSimulators();
    const match = devices.find((d) => d.udid === forceUdid);
    if (match) {
      return { udid: match.udid, name: match.name };
    }
    return { udid: forceUdid, name: requestedName || "iPhone" };
  }

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
  private appiumPort: number;
  private simulatorUdid?: string;
  private headless: boolean;

  constructor(options: ClientIosExecutorOptions) {
    this.serverUrl = options.serverUrl;
    this.clientId = options.clientId;
    this.appFilePath = options.appFilePath;
    this.bundleId = options.bundleId;
    this.deviceName = options.deviceName;
    this.secrets = options.secrets || {};
    this.appiumPort = options.appiumPort || 4723;
    this.simulatorUdid = options.simulatorUdid;
    this.headless = options.headless || false;
  }

  public async start(): Promise<void> {
    await this.ensureAppiumServer();
    await this.connectWebSocket();
  }

  private async isAppiumRunning(): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${this.appiumPort}/status`, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async ensureAppiumServer(): Promise<void> {
    if (await this.isAppiumRunning()) return;

    const spawnCmd = `npx -y appium --port ${this.appiumPort} --address 127.0.0.1`;
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
        `Failed to start local Appium server at http://127.0.0.1:${this.appiumPort} after 30s`,
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
    const targetDevice = resolveSimulatorDevice(this.deviceName, this.simulatorUdid);

    const derivedDataSuffix = targetDevice.udid || `${this.appiumPort}`;
    const derivedDataPath = join(
      tmpdir(),
      `zenitest_wda_${derivedDataSuffix}`,
    );

    const prebuiltWda = findPrebuiltWdaDerivedData();
    if (prebuiltWda) {
      const targetBuildDir = join(derivedDataPath, "Build");
      if (!existsSync(targetBuildDir)) {
        try {
          mkdirSync(derivedDataPath, { recursive: true });
          execSync(`cp -R "${join(prebuiltWda, "Build")}" "${targetBuildDir}"`, {
            stdio: ["ignore", "ignore", "ignore"],
          });
        } catch (_) {}
      }
    }

    const capabilities: any = {
      platformName: "iOS",
      "appium:automationName": "XCUITest",
      "appium:newCommandTimeout": 300,
      "appium:derivedDataPath": derivedDataPath,
      ...(prebuiltWda ? { "appium:usePrebuiltWDA": true } : {}),
      "appium:waitForQuiescence": false,
      "appium:simpleIsVisibleCheck": true,
      "appium:useSimpleIsVisibleCheck": true,
      "appium:wdaLaunchTimeout": 120000,
      "appium:wdaConnectionTimeout": 120000,
      "appium:wdaStartupRetries": 3,
      "appium:wdaStartupRetryInterval": 5000,
      "appium:noReset": true,
      "appium:fullReset": false,
      "appium:enforceAppInstall": !!this.simulatorUdid,
      "appium:shouldTerminateApp": true,
      "appium:deviceName": targetDevice.name,
      // Unique WDA ports per executor to prevent conflicts in parallel mode
      "appium:wdaLocalPort": 8100 + (this.appiumPort - 4723),
      "appium:mjpegServerPort": 9100 + (this.appiumPort - 4723),
      // Headless mode: prevent Simulator.app GUI from opening
      ...(this.headless ? { "appium:isHeadless": true } : {}),
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
      port: this.appiumPort,
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
    action?: string,
  ): Promise<any> {
    if (!targetId) return null;
    const str = String(targetId).trim();
    if (!str) return null;

    // 1. Direct Accessibility ID
    try {
      const byAcc = await driver.$(`~${str}`);
      if (await byAcc.isExisting()) return byAcc;
    } catch (_) {}

    // 2. Exact Predicate String (name, label, value, placeholderValue)
    try {
      const byPred = await driver.$(
        `-ios predicate string:name == "${str}" || label == "${str}" || value == "${str}" || placeholderValue == "${str}"`,
      );
      if (await byPred.isExisting()) return byPred;
    } catch (_) {}

    // 3. Exact XPath
    try {
      const byXpath = await driver.$(
        `//*[@name="${str}" or @label="${str}" or @value="${str}" or @placeholderValue="${str}"]`,
      );
      if (await byXpath.isExisting()) return byXpath;
    } catch (_) {}

    // 4. Case-insensitive / Contains Predicate
    try {
      const byPredContains = await driver.$(
        `-ios predicate string:name CONTAINS[c] "${str}" || label CONTAINS[c] "${str}" || value CONTAINS[c] "${str}" || placeholderValue CONTAINS[c] "${str}"`,
      );
      if (await byPredContains.isExisting()) return byPredContains;
    } catch (_) {}

    // 5. Generate normalized semantic candidates (e.g. full_name_field -> full_name, Full Name, name)
    const candidates = new Set<string>();
    const withoutSuffix = str
      .replace(/_(field|input|text|txt|btn|button|view)$/i, "")
      .replace(/(Field|Input|Text|Txt|Btn|Button|View)$/, "");
    candidates.add(withoutSuffix);

    const asWords = withoutSuffix.replace(/[_-]+/g, " ").trim();
    candidates.add(asWords);

    const titleCase = asWords.replace(/\b\w/g, (c) => c.toUpperCase());
    candidates.add(titleCase);

    const words = asWords.split(/\s+/).filter(Boolean);
    for (const w of words) {
      if (w.length > 2) candidates.add(w);
    }

    for (const candidate of candidates) {
      if (!candidate || candidate === str) continue;

      try {
        const byAcc = await driver.$(`~${candidate}`);
        if (await byAcc.isExisting()) return byAcc;
      } catch (_) {}

      try {
        const byPred = await driver.$(
          `-ios predicate string:name CONTAINS[c] "${candidate}" || label CONTAINS[c] "${candidate}" || value CONTAINS[c] "${candidate}" || placeholderValue CONTAINS[c] "${candidate}"`,
        );
        if (await byPred.isExisting()) return byPred;
      } catch (_) {}

      try {
        const byXpath = await driver.$(
          `//*[contains(@name, "${candidate}") or contains(@label, "${candidate}") or contains(@value, "${candidate}")]`,
        );
        if (await byXpath.isExisting()) return byXpath;
      } catch (_) {}
    }

    // 6. If action is type/fill, fallback to visible TextField elements
    if (action === "type") {
      try {
        const textFields = await driver.$$(
          "XCUIElementTypeTextField, XCUIElementTypeSecureTextField, XCUIElementTypeTextView",
        );
        if (textFields && textFields.length > 0) {
          // If only 1 textfield exists on screen, target it
          if (textFields.length === 1) {
            return textFields[0];
          }

          // Otherwise check if any textfield matches one of the keywords
          for (const tf of textFields) {
            const name = (await tf.getAttribute("name").catch(() => "")) || "";
            const label = (await tf.getAttribute("label").catch(() => "")) || "";
            const value = (await tf.getAttribute("value").catch(() => "")) || "";
            const placeholder = (await tf.getAttribute("placeholderValue").catch(() => "")) || "";
            const combined = `${name} ${label} ${value} ${placeholder}`.toLowerCase();

            for (const candidate of candidates) {
              if (combined.includes(candidate.toLowerCase())) {
                return tf;
              }
            }
          }
        }
      } catch (_) {}
    }

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

    const elem = await this.findMobileElement(driver, targetElementId, action);

    switch (action) {
      case "click":
        if (!elem)
          throw new Error(`Could not find mobile element: ${targetElementId}`);
        await elem.click();
        break;

      case "type":
        if (!elem)
          throw new Error(`Could not find mobile element: ${targetElementId}`);
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
      const targetApp = this.resolveTargetAppPath();
      const bundleId = this.bundleId || extractBundleId(targetApp);
      if (bundleId) {
        try {
          await session.driver.terminateApp(bundleId).catch(() => {});
        } catch (_) {}
        try {
          execSync(`xcrun simctl terminate booted ${bundleId}`, {
            stdio: ["ignore", "ignore", "ignore"],
          });
        } catch (_) {}
      }
      await session.driver.deleteSession().catch(() => {});
      this.sessions.delete(sessionId);
    }
  }

  public async stop(): Promise<void> {
    this.isStopped = true;
    const targetApp = this.resolveTargetAppPath();
    const bundleId = this.bundleId || extractBundleId(targetApp);
    if (bundleId) {
      // Terminate on the specific simulator if we have a UDID, otherwise on all booted
      const target = this.simulatorUdid || "booted";
      try {
        execSync(`xcrun simctl terminate ${target} ${bundleId}`, {
          stdio: ["ignore", "ignore", "ignore"],
        });
      } catch (_) {}
    }
    for (const [id, session] of this.sessions.entries()) {
      if (bundleId) {
        await session.driver.terminateApp(bundleId).catch(() => {});
      }
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
    const targetApp = this.resolveTargetAppPath();
    const bundleId = this.bundleId || extractBundleId(targetApp);
    if (bundleId) {
      const target = this.simulatorUdid || "booted";
      try {
        execSync(`xcrun simctl terminate ${target} ${bundleId}`, {
          stdio: ["ignore", "ignore", "ignore"],
        });
      } catch (_) {}
    }
    for (const [, session] of this.sessions) {
      session.driver.deleteSession().catch(() => {});
    }
    this.sessions.clear();
  }
}
