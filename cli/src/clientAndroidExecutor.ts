import { remote } from "webdriverio";
import { WebSocket } from "ws";
import { spawn, execSync, ChildProcess } from "child_process";
import { existsSync } from "fs";
import { resolve, join } from "path";

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
  isVisible?: boolean;
  inViewport?: boolean;
  rect?: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

export interface LogReportItem {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface ClientAndroidExecutorOptions {
  serverUrl: string;
  clientId: string;
  appFilePath?: string;
  appPackage?: string;
  appActivity?: string;
  deviceName?: string;
  secrets?: Record<string, string>;
  appiumPort?: number;
  emulatorSerial?: string;
}

interface AndroidSessionState {
  driver: any;
  startTime: number;
  logReports: LogReportItem[];
}

function getAdbPath(): string {
  const customAdb = process.env.ADB_PATH;
  if (customAdb && existsSync(customAdb)) return customAdb;

  const androidHome =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    join(process.env.HOME || "", "Library/Android/sdk");
  const standardPath = join(androidHome, "platform-tools/adb");
  if (existsSync(standardPath)) return standardPath;

  try {
    const whichAdb = execSync("which adb", { encoding: "utf-8" }).trim();
    if (whichAdb && existsSync(whichAdb)) return whichAdb;
  } catch {}

  return "adb";
}

function getConnectedAndroidDevices(): {
  serial: string;
  model: string;
  product: string;
  state: string;
}[] {
  try {
    const adb = getAdbPath();
    const output = execSync(`${adb} devices -l`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    const devices: {
      serial: string;
      model: string;
      product: string;
      state: string;
    }[] = [];

    const lines = output.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("List of devices")) continue;

      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        const serial = parts[0];
        const state = parts[1];

        const modelMatch = trimmed.match(/model:([^\s]+)/i);
        const productMatch = trimmed.match(/product:([^\s]+)/i);
        let model = modelMatch ? modelMatch[1].replace(/_/g, " ") : serial;
        const product = productMatch ? productMatch[1] : "";

        // For emulators, resolve the AVD name for a human-readable device name
        if (serial.startsWith("emulator-") && state === "device") {
          try {
            const avdName = execSync(
              `${adb} -s ${serial} emu avd name 2>/dev/null | head -1`,
              { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 },
            ).trim();
            if (avdName && !avdName.startsWith("KO:")) {
              model = avdName.replace(/_/g, " ");
            }
          } catch (_) {}
        }

        devices.push({ serial, model, product, state });
      }
    }
    return devices;
  } catch {
    return [];
  }
}

/**
 * Returns all online (state === "device") Android devices/emulators.
 * Used by cli.ts to determine the available pool for parallel execution.
 */
export function getOnlineAndroidDevices(): { serial: string; model: string }[] {
  return getConnectedAndroidDevices()
    .filter((d) => d.state === "device")
    .map(({ serial, model }) => ({ serial, model }));
}

function getEmulatorPath(): string {
  const androidHome =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    join(process.env.HOME || "", "Library/Android/sdk");
  const emulatorPath = join(androidHome, "emulator/emulator");
  if (existsSync(emulatorPath)) return emulatorPath;
  return "emulator";
}

function getAvailableAvds(): string[] {
  try {
    const emulator = getEmulatorPath();
    const output = execSync(`${emulator} -list-avds`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

/**
 * Ensures at least `count` Android emulators are online for parallel execution.
 * If fewer are available, launches additional emulators from available AVDs.
 *
 * Returns the list of online devices and a cleanup function that shuts down
 * any emulators that were launched by this call.
 */
export function ensureAndroidEmulators(
  count: number,
  options?: { headless?: boolean; avdName?: string },
): { devices: { serial: string; model: string }[]; cleanup: () => void } {
  const launchedProcesses: ChildProcess[] = [];
  const launchedSerials: string[] = [];

  // Check if we already have enough
  let online = getOnlineAndroidDevices();
  if (online.length >= count) {
    return { devices: online.slice(0, count), cleanup: () => {} };
  }

  const avds = getAvailableAvds();
  if (avds.length === 0) {
    return { devices: online, cleanup: () => {} };
  }

  // Pick which AVD to launch: prefer matching name, then first available
  let targetAvd = options?.avdName
    ? avds.find((a) => a.toLowerCase().replace(/[-_]/g, " ").includes(options.avdName!.toLowerCase().replace(/[-_]/g, " ")))
    : undefined;
  if (!targetAvd) targetAvd = avds[0];

  const needed = count - online.length;
  const emulator = getEmulatorPath();
  // When launching multiple instances of the same AVD, ALL must use -read-only
  const useReadOnly = needed > 1 || online.length > 0;

  for (let i = 0; i < needed; i++) {
    const headlessFlags = options?.headless ? "-no-window -no-audio -no-boot-anim" : "-no-audio -no-boot-anim";
    const readOnlyFlag = useReadOnly ? "-read-only" : "";
    const cmd = `${emulator} -avd ${targetAvd} ${headlessFlags} ${readOnlyFlag}`.replace(/\s+/g, " ").trim();

    try {
      const proc = spawn(cmd, {
        shell: true,
        stdio: ["ignore", "ignore", "ignore"],
        detached: true,
      });
      proc.unref();
      launchedProcesses.push(proc);
      // Brief delay between launches to avoid race conditions on the AVD lock
      if (i < needed - 1) {
        execSync("sleep 2", { stdio: ["ignore", "ignore", "ignore"] });
      }
    } catch (_) {
      break;
    }
  }

  if (launchedProcesses.length === 0) {
    return { devices: online, cleanup: () => {} };
  }

  // Wait for emulators to come online (up to 60s)
  const adb = getAdbPath();
  const startTime = Date.now();
  while (Date.now() - startTime < 60000) {
    online = getOnlineAndroidDevices();
    if (online.length >= count) break;
    try {
      execSync("sleep 3", { stdio: ["ignore", "ignore", "ignore"] });
    } catch (_) {}
  }

  // Wait for boot to complete on new devices
  const finalOnline = getOnlineAndroidDevices();
  const previousSerials = new Set(online.slice(0, online.length - launchedProcesses.length).map((d) => d.serial));
  for (const d of finalOnline) {
    if (!previousSerials.has(d.serial)) {
      launchedSerials.push(d.serial);
      // Wait for device to finish booting
      try {
        execSync(`${adb} -s ${d.serial} wait-for-device shell getprop sys.boot_completed`, {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 30000,
        });
      } catch (_) {}
    }
  }

  const cleanup = () => {
    // Shut down emulators we launched
    for (const serial of launchedSerials) {
      try {
        execSync(`${adb} -s ${serial} emu kill`, {
          stdio: ["ignore", "ignore", "ignore"],
          timeout: 10000,
        });
      } catch (_) {}
    }
    // Kill any emulator processes we spawned
    for (const proc of launchedProcesses) {
      try {
        proc.kill("SIGTERM");
      } catch (_) {}
    }
  };

  return { devices: finalOnline.slice(0, count), cleanup };
}

function resolveAndroidDevice(requestedName?: string, forceSerial?: string): {
  udid?: string;
  name: string;
} {
  // If a specific serial is forced (for parallel execution), use it directly
  if (forceSerial) {
    const devices = getConnectedAndroidDevices();
    const match = devices.find((d) => d.serial === forceSerial);
    if (match) {
      return { udid: match.serial, name: match.model };
    }
    return { udid: forceSerial, name: requestedName || "Android Device" };
  }

  const devices = getConnectedAndroidDevices();
  const onlineDevices = devices.filter((d) => d.state === "device");

  if (requestedName) {
    const cleanRequested = requestedName.toLowerCase().replace(/[-_]/g, " ");

    const matchedOnline = onlineDevices.find((d) => {
      const cleanModel = d.model.toLowerCase();
      const cleanProduct = d.product.toLowerCase().replace(/[-_]/g, " ");
      const cleanSerial = d.serial.toLowerCase();
      return (
        cleanModel.includes(cleanRequested) ||
        cleanRequested.includes(cleanModel) ||
        cleanProduct.includes(cleanRequested) ||
        cleanSerial === cleanRequested
      );
    });

    if (matchedOnline) {
      return { udid: matchedOnline.serial, name: matchedOnline.model };
    }
  }

  if (onlineDevices.length > 0) {
    return { udid: onlineDevices[0].serial, name: onlineDevices[0].model };
  }

  return { name: requestedName || "Android Device" };
}

export function extractAndroidDom(xmlSource: string): DOMElement[] {
  if (!xmlSource) return [];
  const elements: DOMElement[] = [];
  let count = 0;

  const nodeRegex = /<([a-zA-Z0-9_.$]+)([^>]*?)(\/>|>)/g;
  let match: RegExpExecArray | null;

  while ((match = nodeRegex.exec(xmlSource)) !== null) {
    const rawTag = match[1];
    const attrString = match[2];

    const getAttr = (name: string): string => {
      const attrMatch = new RegExp(`${name}="([^"]*)"`, "i").exec(attrString);
      return attrMatch ? attrMatch[1] : "";
    };

    const type = rawTag.split(".").pop() || rawTag;
    const text = getAttr("text");
    const contentDesc = getAttr("content-desc");
    const resourceId = getAttr("resource-id");
    const clickable = getAttr("clickable") === "true";
    const checkable = getAttr("checkable") === "true";
    const enabled = getAttr("enabled") !== "false";
    const displayed = getAttr("displayed") !== "false";

    let x = 0;
    let y = 0;
    let width = 0;
    let height = 0;
    const bounds = getAttr("bounds");
    if (bounds) {
      const boundsMatch = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(bounds);
      if (boundsMatch) {
        const left = parseInt(boundsMatch[1], 10);
        const top = parseInt(boundsMatch[2], 10);
        const right = parseInt(boundsMatch[3], 10);
        const bottom = parseInt(boundsMatch[4], 10);
        x = left;
        y = top;
        width = Math.max(0, right - left);
        height = Math.max(0, bottom - top);
      }
    }

    const isInteractive =
      clickable ||
      checkable ||
      [
        "Button",
        "ImageButton",
        "EditText",
        "CheckBox",
        "RadioButton",
        "Switch",
        "TextView",
        "ImageView",
      ].includes(type);

    if (isInteractive && (text || contentDesc || resourceId || clickable)) {
      count++;
      const id = contentDesc || text || resourceId || `el-${count}`;
      const displayText = text || contentDesc || "";

      elements.push({
        id,
        tagName: type,
        text: displayText,
        value: text || undefined,
        ariaLabel: contentDesc || resourceId || undefined,
        role: type.toLowerCase(),
        selector: contentDesc
          ? `~${contentDesc}`
          : resourceId
            ? `id=${resourceId}`
            : undefined,
        xpath: `//${rawTag}[@content-desc="${contentDesc}" or @text="${text}" or @resource-id="${resourceId}"]`,
        isInteractive: true,
        disabled: !enabled,
        isVisible: displayed,
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

function ensureJavaHomeEnv(): string | undefined {
  if (process.env.JAVA_HOME && existsSync(process.env.JAVA_HOME)) {
    return process.env.JAVA_HOME;
  }

  const candidateJavaHomes = [
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
    "/Applications/Android Studio.app/Contents/jre/Contents/Home",
    "/Applications/Android Studio.app/Contents/jre/jdk/Contents/Home",
    "/opt/homebrew/opt/openjdk",
    "/opt/homebrew/opt/openjdk@17",
    "/opt/homebrew/opt/openjdk@21",
  ];

  for (const candidate of candidateJavaHomes) {
    if (existsSync(candidate)) {
      const javaBin = join(candidate, "bin/java");
      if (existsSync(javaBin)) {
        process.env.JAVA_HOME = candidate;
        process.env.PATH = `${join(candidate, "bin")}:${process.env.PATH}`;
        return candidate;
      }
    }
  }

  try {
    const javaHomeOut = execSync("/usr/libexec/java_home 2>/dev/null", {
      encoding: "utf-8",
    }).trim();
    if (javaHomeOut && existsSync(javaHomeOut)) {
      process.env.JAVA_HOME = javaHomeOut;
      process.env.PATH = `${join(javaHomeOut, "bin")}:${process.env.PATH}`;
      return javaHomeOut;
    }
  } catch {}

  return process.env.JAVA_HOME;
}

function ensureAndroidHomeEnv(): string {
  ensureJavaHomeEnv();
  if (!process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT) {
    const defaultHome = join(process.env.HOME || "", "Library/Android/sdk");
    if (existsSync(defaultHome)) {
      process.env.ANDROID_HOME = defaultHome;
      process.env.ANDROID_SDK_ROOT = defaultHome;
      const platformTools = join(defaultHome, "platform-tools");
      const emulatorPath = join(defaultHome, "emulator");
      process.env.PATH = `${platformTools}:${emulatorPath}:${process.env.PATH}`;
    }
  }
  return (
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    join(process.env.HOME || "", "Library/Android/sdk")
  );
}

export class ClientAndroidExecutor {
  private serverUrl: string;
  private clientId: string;
  private appFilePath?: string;
  private appPackage?: string;
  private appActivity?: string;
  private deviceName?: string;
  private secrets: Record<string, string>;
  private ws: WebSocket | null = null;
  private appiumProcess: ChildProcess | null = null;
  private sessions = new Map<string, AndroidSessionState>();
  private isStopped: boolean = false;
  private appiumPort: number;
  private emulatorSerial?: string;

  constructor(options: ClientAndroidExecutorOptions) {
    this.serverUrl = options.serverUrl;
    this.clientId = options.clientId;
    this.appFilePath = options.appFilePath;
    this.appPackage = options.appPackage || "com.example.flutter_sample_app";
    this.appActivity =
      options.appActivity || "com.example.flutter_sample_app.MainActivity";
    this.deviceName = options.deviceName;
    this.secrets = options.secrets || {};
    this.appiumPort = options.appiumPort || 4723;
    this.emulatorSerial = options.emulatorSerial;
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
    const androidHome = ensureAndroidHomeEnv();
    const javaHome = ensureJavaHomeEnv();
    if (await this.isAppiumRunning()) return;

    const spawnCmd = `npx -y appium --port ${this.appiumPort} --address 127.0.0.1`;
    this.appiumProcess = spawn(spawnCmd, {
      shell: true,
      env: {
        ...process.env,
        ANDROID_HOME: androidHome,
        ANDROID_SDK_ROOT: androidHome,
        ...(javaHome ? { JAVA_HOME: javaHome } : {}),
      },
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
          data: { clientId: this.clientId, platform: "android" },
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

  private getSession(sessionId?: string): AndroidSessionState {
    const key = this.getSessionKey(sessionId);
    const session = this.sessions.get(key);
    if (!session) {
      throw new Error(`Android session '${key}' not found`);
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
        "sample-apps/flutter_sample_app/build/app/outputs/flutter-apk/app-debug.apk",
      ),
      resolve(
        process.cwd(),
        "sample-apps/flutter_sample_app/build/app/outputs/apk/debug/app-debug.apk",
      ),
      resolve(process.cwd(), "build/app/outputs/flutter-apk/app-debug.apk"),
      resolve(process.cwd(), "app-debug.apk"),
    ];

    for (const p of candidatePaths) {
      if (existsSync(p)) return p;
    }

    return this.appFilePath || "app-debug.apk";
  }

  private async initDriver(
    sessionId: string,
    appPath?: string,
  ): Promise<AndroidSessionState> {
    const targetApp = this.resolveTargetAppPath(appPath);
    const targetDevice = resolveAndroidDevice(this.deviceName, this.emulatorSerial);

    const onlineDevices = getConnectedAndroidDevices().filter(
      (d) => d.state === "device",
    );
    if (onlineDevices.length === 0) {
      throw new Error(
        `No connected Android device or running emulator found on ADB. Please start an Android emulator or connect a device with USB debugging enabled (run 'adb devices' to check).`,
      );
    }

    const capabilities: any = {
      platformName: "Android",
      "appium:automationName": "UiAutomator2",
      "appium:newCommandTimeout": 300,
      "appium:noReset": true,
      "appium:fullReset": false,
      "appium:autoGrantPermissions": true,
      "appium:shouldTerminateApp": true,
      "appium:deviceName": targetDevice.name,
      "appium:appPackage": this.appPackage,
      "appium:appActivity": this.appActivity,
    };

    if (targetDevice.udid) {
      capabilities["appium:udid"] = targetDevice.udid;
    }

    if (existsSync(targetApp) && targetApp.endsWith(".apk")) {
      capabilities["appium:app"] = targetApp;
    }

    const driver = await remote({
      hostname: "127.0.0.1",
      port: this.appiumPort,
      logLevel: "silent",
      capabilities,
    });

    const state: AndroidSessionState = {
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
          const elements = extractAndroidDom(xmlSource);
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
            title: "Android Screen",
            url: this.appPackage || "Android App",
          });
          break;
        }

        case "EXECUTE_ACTION": {
          const session = this.getSession(sessionId);
          const act = msg.actResult || msg;
          const result = await this.performMobileAction(
            session.driver,
            act.action,
            act.targetElementId,
            act.text || act.value,
            act.key,
            act.direction,
          );
          this.send({
            type: "ACTION_RESPONSE",
            id,
            sessionId,
            success: result.success,
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
          const duration = Math.min(msg.durationMs || 1000, 30000);
          await new Promise((r) => setTimeout(r, duration));
          this.send({ type: "RPC_RESPONSE", id, sessionId, success: true });
          break;
        }

        case "GET_SESSION_REPORTS": {
          const session = this.getSession(sessionId);
          let logs: any[] = [];
          try {
            logs = await session.driver.getLogs("logcat").catch(() => []);
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
      const byText = await driver.$(
        `android=new UiSelector().textContains("${str}")`,
      );
      if (await byText.isExisting()) return byText;
    } catch (_) {}

    try {
      const byDesc = await driver.$(
        `android=new UiSelector().descriptionContains("${str}")`,
      );
      if (await byDesc.isExisting()) return byDesc;
    } catch (_) {}

    try {
      const byResId = await driver.$(
        `android=new UiSelector().resourceIdMatches(".*${str}.*")`,
      );
      if (await byResId.isExisting()) return byResId;
    } catch (_) {}

    try {
      const byXpath = await driver.$(
        `//*[@text="${str}" or @content-desc="${str}" or @resource-id="${str}"]`,
      );
      if (await byXpath.isExisting()) return byXpath;
    } catch (_) {}

    return null;
  }

  private async performMobileAction(
    driver: any,
    action: string,
    targetElementId?: string | number,
    text?: string,
    _key?: string,
    direction?: string,
  ): Promise<{ success: boolean; error?: string }> {
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

      case "press":
        if (elem) {
          await elem.click();
        } else {
          await driver.keys([text || "Enter"]).catch(() => {});
        }
        break;

      case "scroll":
        await driver.execute("mobile: scrollGesture", {
          left: 100,
          top: 100,
          width: 800,
          height: 1000,
          direction: direction === "up" || direction === "top" ? "up" : "down",
          percent: 0.75,
        });
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
      if (this.appPackage) {
        try {
          await session.driver.terminateApp(this.appPackage).catch(() => {});
        } catch (_) {}
        try {
          const adb = getAdbPath();
          execSync(`${adb} shell am force-stop ${this.appPackage}`, {
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
    if (this.appPackage) {
      try {
        const adb = getAdbPath();
        // Target the specific emulator if we have a serial, otherwise default
        const serialFlag = this.emulatorSerial ? `-s ${this.emulatorSerial} ` : "";
        execSync(`${adb} ${serialFlag}shell am force-stop ${this.appPackage}`, {
          stdio: ["ignore", "ignore", "ignore"],
        });
      } catch (_) {}
    }
    for (const [, session] of this.sessions.entries()) {
      if (this.appPackage) {
        await session.driver.terminateApp(this.appPackage).catch(() => {});
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
    if (this.appPackage) {
      try {
        const adb = getAdbPath();
        const serialFlag = this.emulatorSerial ? `-s ${this.emulatorSerial} ` : "";
        execSync(`${adb} ${serialFlag}shell am force-stop ${this.appPackage}`, {
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
