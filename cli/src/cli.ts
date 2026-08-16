#!/usr/bin/env node

import pkg from "../package.json";
import { ClientWebExecutor } from "./clientWebExecutor";
import { ClientIosExecutor } from "./clientIosExecutor";
import { ClientAndroidExecutor } from "./clientAndroidExecutor";
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  existsSync,
  statSync,
} from "fs";
import { join, resolve, basename } from "path";
import { homedir } from "os";
import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { parse as parseYaml } from "yaml";

const CURRENT_VERSION = pkg.version;

function parseSemver(v: string): [number, number, number] {
  const clean = v.replace(/^v/, "").trim();
  const parts = clean
    .split("-")[0]
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function isOutdated(current: string, latest: string): boolean {
  const c = parseSemver(current);
  const l = parseSemver(latest);
  for (let i = 0; i < 3; i++) {
    if (l[i] > c[i]) return true;
    if (l[i] < c[i]) return false;
  }
  return false;
}

async function checkForLatestVersion(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const res = await fetch("https://registry.npmjs.org/zenitest-cli/latest", {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = (await res.json()) as { version?: string };
      const latestVersion = data.version;
      if (latestVersion && isOutdated(CURRENT_VERSION, latestVersion)) {
        console.error(
          `\n\x1b[1;31m[ERROR] You are using an outdated version of zenitest-cli (v${CURRENT_VERSION}).\x1b[0m`,
        );
        console.error(
          `\x1b[1;32mThe latest version is v${latestVersion}.\x1b[0m\n`,
        );
        console.error(
          `\x1b[1mPlease upgrade to the latest version before continuing:\x1b[0m`,
        );
        console.error(`  \x1b[36mnpm install -g zenitest-cli@latest\x1b[0m`);
        console.error(`  or`);
        console.error(`  \x1b[36mbun add -g zenitest-cli@latest\x1b[0m\n`);
        process.exit(1);
      }
    }
  } catch {
    // Ignore network error or timeout
  }
}

function getConfigPath(): string {
  const dir = join(homedir(), ".zenitest");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, "config.json");
}

function loadStoredApiKey(): string | undefined {
  try {
    const configPath = getConfigPath();
    if (existsSync(configPath)) {
      const data = JSON.parse(readFileSync(configPath, "utf-8"));
      return data.apiKey || data.api_key;
    }
  } catch {
    // Ignore parse/read errors
  }
  return undefined;
}

function saveApiKey(apiKey: string): void {
  try {
    const configPath = getConfigPath();
    let currentConfig: Record<string, any> = {};
    if (existsSync(configPath)) {
      try {
        currentConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      } catch {}
    }
    currentConfig.apiKey = apiKey;
    writeFileSync(configPath, JSON.stringify(currentConfig, null, 2), "utf-8");
    console.log(`\x1b[1;32mAPI key saved successfully.\x1b[0m`);
  } catch (err: any) {
    console.error(`\x1b[1;31mError saving API key: ${err.message}\x1b[0m`);
    process.exit(1);
  }
}

function deleteStoredApiKey(): void {
  try {
    const configPath = getConfigPath();
    if (existsSync(configPath)) {
      unlinkSync(configPath);
    }
  } catch {}
}

function loadLocalSecrets(testDir?: string): Record<string, string> {
  const secrets: Record<string, string> = {};

  const possiblePaths = [
    resolve(process.cwd(), "secrets.yaml"),
    resolve(process.cwd(), "secrets.yml"),
    resolve(process.cwd(), "credentials.yaml"),
    resolve(process.cwd(), "credentials.yml"),
    join(homedir(), ".zenitest", "secrets.yaml"),
    join(homedir(), ".zenitest", "secrets.yml"),
    join(homedir(), ".zenitest", "credentials.yaml"),
    join(homedir(), ".zenitest", "credentials.yml"),
  ];

  if (testDir) {
    possiblePaths.unshift(
      resolve(testDir, "secrets.yaml"),
      resolve(testDir, "secrets.yml"),
      resolve(testDir, "credentials.yaml"),
      resolve(testDir, "credentials.yml"),
    );
  }

  for (const filePath of possiblePaths) {
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf-8");
        const parsed = parseYaml(content);
        if (parsed && typeof parsed === "object") {
          const dict =
            parsed.secrets && typeof parsed.secrets === "object"
              ? parsed.secrets
              : parsed;
          for (const [k, v] of Object.entries(dict)) {
            if (v !== undefined && v !== null && typeof v !== "object") {
              secrets[k] = String(v);
            }
          }
        }
      } catch (err: any) {
        console.warn(
          `[CLI Warning] Failed to parse secrets file "${filePath}":`,
          err.message,
        );
      }
    }
  }

  return secrets;
}

async function promptApiKey(): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("Enter your Zeni API key: ");
    return answer.trim();
  } finally {
    rl.close();
  }
}

// Helper to show help
function showHelp() {
  console.log(`
Usage: zenitest <command> [options]

Commands:
  auth [api_key]       Authenticate CLI with API key (prompts if omitted)
  client               Start the local Playwright web executor client
  run                  Read test cases from a folder and run them via the server
  report <run_number>  Fetch execution report summary (e.g. zenitest report 21)

Options:
  --dir, -d           Directory containing test cases (defaults to zenitests)
  --platform, -t      Platform target to execute: web, ios, android (defaults to all)
  --env, -e           Target environment for web tests: prod (default) or local
  --local             Run web tests against localURL
  --prod              Run web tests against prodURL
  --bundle, -b        Path to built mobile app binary (.ipa, .app, or .apk)
  --device, -d        Target iOS device name or simulator (defaults to config or iPhone 17)
  --parallel, -p      Number of test cases to run in parallel (defaults to 5)
  --version, -v       Show CLI version
  --help, -h          Show this help message
`);
}

// Simple argument parser
function parseArgs(args: string[]) {
  const options: Record<string, any> = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("-")) {
      const cleanKey = arg.replace(/^-+/, "");
      if (cleanKey.includes("=")) {
        const [k, v] = cleanKey.split("=");
        options[k] = v;
      } else {
        const next = args[i + 1];
        if (next && !next.startsWith("-")) {
          options[cleanKey] = next;
          i++;
        } else {
          options[cleanKey] = true;
        }
      }
    } else {
      options._.push(arg);
    }
  }

  // Map aliases
  if (options.d) options.dir = options.d;
  if (options.f) options.file = options.f;
  if (options.p) options.parallel = options.p;
  if (options.c) options.parallel = options.c;
  if (options.t) options.platform = options.t;
  if (options.target) options.platform = options.target;
  if (options.web) options.platform = "web";
  if (options.ios) options.platform = "ios";
  if (options.android) options.platform = "android";
  if (options.b) options.bundle = options.b;
  if (options.e) options.env = options.e;
  if (options.environment) options.env = options.environment;
  if (options.v) options.version = options.v;
  if (options.h) options.help = options.h;

  return options;
}

const API_BASE_URL = process.env.ZENI_API_URL || "http://localhost:3001";
const WS_BASE_URL =
  process.env.ZENI_WS_URL ||
  (API_BASE_URL.startsWith("https://")
    ? API_BASE_URL.replace(/^https:\/\//, "wss://")
    : API_BASE_URL.replace(/^http:\/\//, "ws://"));
const APP_BASE_URL =
  process.env.ZENI_APP_URL ||
  (API_BASE_URL.includes("localhost")
    ? "http://localhost:3000"
    : "https://app.zenitest.ai");

async function verifyApiKey(
  apiKey: string,
): Promise<{ valid: boolean; user?: any }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
    });

    if (response.ok) {
      const result = await response.json();
      if (result.success) {
        return { valid: true, user: result.user };
      }
    } else if (response.status === 401) {
      return { valid: false };
    }
  } catch {
    // Server unreachable at the moment; treat as valid locally
    return { valid: true };
  }
  return { valid: false };
}

async function getApiKey(): Promise<string> {
  let apiKey = loadStoredApiKey();

  if (apiKey) {
    const verification = await verifyApiKey(apiKey);
    if (!verification.valid) {
      console.log(
        `\x1b[1;31mStored API key is invalid or expired. Invalidating saved credentials...\x1b[0m`,
      );
      deleteStoredApiKey();
      apiKey = undefined;
    } else {
      return apiKey;
    }
  }

  while (!apiKey) {
    console.log(
      `\x1b[1;33mPlease enter a valid Zeni API key to continue.\x1b[0m`,
    );
    apiKey = await promptApiKey();

    if (!apiKey) {
      console.error(`\x1b[1;31mError: API key is mandatory.\x1b[0m`);
      process.exit(1);
    }

    const verification = await verifyApiKey(apiKey);
    if (verification.valid) {
      saveApiKey(apiKey);
      if (verification.user?.name || verification.user?.email) {
        console.log(
          `\x1b[1;32mAuthenticated as ${verification.user.name || verification.user.email}\x1b[0m`,
        );
      }
      return apiKey;
    } else {
      console.error(
        `\x1b[1;31mError: Invalid API key. Please re-enter a valid API key.\x1b[0m\n`,
      );
      apiKey = undefined;
    }
  }

  return apiKey;
}

async function runAuth(options: Record<string, any>) {
  let apiKey = options._[1];

  if (apiKey) {
    const verification = await verifyApiKey(apiKey);
    if (verification.valid) {
      saveApiKey(apiKey);
      if (verification.user?.name || verification.user?.email) {
        console.log(
          `\x1b[1;32mAuthenticated as ${verification.user.name || verification.user.email}\x1b[0m`,
        );
      }
      return;
    } else {
      console.error(`\x1b[1;31mError: Invalid API key provided.\x1b[0m\n`);
      apiKey = undefined;
    }
  }

  while (!apiKey) {
    apiKey = await promptApiKey();

    if (!apiKey) {
      console.error(`\x1b[1;31mError: API key cannot be empty.\x1b[0m`);
      process.exit(1);
    }

    const verification = await verifyApiKey(apiKey);
    if (verification.valid) {
      saveApiKey(apiKey);
      if (verification.user?.name || verification.user?.email) {
        console.log(
          `\x1b[1;32mAuthenticated as ${verification.user.name || verification.user.email}\x1b[0m`,
        );
      }
      return;
    } else {
      console.error(
        `\x1b[1;31mError: Invalid API key. Please re-enter a valid API key.\x1b[0m\n`,
      );
      apiKey = undefined;
    }
  }
}

async function fetchServerClientId(apiKey: string): Promise<string> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/executions/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (res.ok) {
      const data = await res.json();
      if (data.success && data.clientId) {
        return data.clientId;
      }
    }
  } catch {}
  return `client_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

async function runClient() {
  const apiKey = await getApiKey();
  const clientId = await fetchServerClientId(apiKey);
  const wsServerUrl = WS_BASE_URL;
  const secrets = loadLocalSecrets();
  const client = new ClientWebExecutor({
    serverUrl: wsServerUrl,
    clientId,
    headless: true,
    secrets,
  });

  await client.start();
  console.log(
    `[ZeniTest] Client web executor running for client ID: ${clientId}`,
  );

  process.exitCode = 0;
  process.on("SIGINT", async () => {
    await client.stop();
    process.exit(0);
  });
}

async function runTestCase(testCase: any, apiKey: string) {
  const targetApiUrl = `${API_BASE_URL}/api/executions/create`;
  const clientId = await fetchServerClientId(apiKey);

  const response = await fetch(targetApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      clientId,
      testCase,
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    const errMsg =
      errData.error || errData.message || `Server error (${response.status})`;
    console.error(`\x1b[1;31mError: ${errMsg}\x1b[0m`);
    process.exit(1);
  }

  return await response.json();
}

interface LiveTestCaseState {
  id: string;
  displayId: string;
  platform: string;
  platformDetail: string; // e.g. "WEB · Chrome", "MOBILE · iOS", "MOBILE · Android"
  title: string;
  rawStatus: "PENDING" | "RUNNING" | "PASSED" | "FAILED";
  stepIndex: number;
  totalSteps: number;
  stepType: string;
  stepDescription: string;
  error?: string;
  startTimeMs?: number;
  durationMs?: number;
}

class LiveReportRenderer {
  private executionId: string = "";
  private rows: Map<string, LiveTestCaseState> = new Map();
  private errorMessages: string[] = [];
  private lastLineCount: number = 0;

  constructor(
    testCases: {
      id: string;
      title: string;
      platform?: string;
      fileName?: string;
    }[],
  ) {
    for (const tc of testCases) {
      const p = (tc.platform || "web").toLowerCase();
      let platformDisplay = "WEB";
      let platformDetail = "WEB";
      if (p === "ios" || p === "mobile-ios") {
        platformDisplay = "MOBILE";
        platformDetail = "MOBILE · iOS";
      } else if (p === "android" || p === "mobile-android") {
        platformDisplay = "MOBILE";
        platformDetail = "MOBILE · Android";
      } else if (p.includes("mobile")) {
        platformDisplay = "MOBILE";
        platformDetail = "MOBILE";
      }

      const displayId =
        tc.fileName ||
        (tc.id.endsWith(".yaml") || tc.id.endsWith(".yml")
          ? tc.id
          : `${tc.id}.yaml`);
      this.rows.set(tc.id, {
        id: tc.id,
        displayId,
        platform: platformDisplay,
        platformDetail,
        title: tc.title,
        rawStatus: "PENDING",
        stepIndex: 0,
        totalSteps: 0,
        stepType: "",
        stepDescription: "",
      });
    }
  }

  public setExecutionId(id: string) {
    this.executionId = id;
  }

  public removeTestCases(ids: string[]) {
    for (const id of ids) {
      this.rows.delete(id);
    }
    this.render();
  }

  public addErrorMessage(msg: string) {
    if (!this.errorMessages.includes(msg)) {
      this.errorMessages.push(msg);
    }
    this.render();
  }

  public getExecutedCount(): number {
    return Array.from(this.rows.values()).filter(
      (r) => r.rawStatus === "PASSED" || r.rawStatus === "FAILED",
    ).length;
  }

  public getFailedCount(): number {
    return Array.from(this.rows.values()).filter(
      (r) => r.rawStatus === "FAILED",
    ).length;
  }

  public updateStep(
    testCaseId: string,
    stepIndex: number,
    totalSteps: number,
    stepType: string,
    description: string,
  ) {
    const row = this.rows.get(testCaseId);
    if (row) {
      if (!row.startTimeMs) {
        row.startTimeMs = Date.now();
      }
      row.rawStatus = "RUNNING";
      row.stepIndex = stepIndex;
      row.totalSteps = totalSteps;
      row.stepType = stepType;
      row.stepDescription = description;
    }
    this.render();
  }

  public completeTest(
    testCaseId: string,
    status: "PASSED" | "FAILED",
    durationMs?: number,
    error?: string,
  ) {
    const row = this.rows.get(testCaseId);
    if (row) {
      row.rawStatus = status === "PASSED" ? "PASSED" : "FAILED";
      if (durationMs && durationMs > 0) {
        row.durationMs = durationMs;
      } else if (row.startTimeMs) {
        row.durationMs = Date.now() - row.startTimeMs;
      }
      if (error) {
        row.error = error;
      }
    }
    this.render();
  }

  public render(isFinal: boolean = false) {
    if (this.lastLineCount > 0) {
      process.stdout.write(`\r\x1b[${this.lastLineCount}A\x1b[0J`);
    }

    const cols = process.stdout.columns || 80;
    const termWidth = Math.max(30, Math.min(cols - 2, 80));
    const separator = "\x1b[90m" + "─".repeat(termWidth) + "\x1b[0m";

    const lines: string[] = [];
    const rowList = Array.from(this.rows.values());

    const groups: { [key: string]: LiveTestCaseState[] } = {};
    for (const r of rowList) {
      const g = r.platformDetail || "WEB";
      if (!groups[g]) groups[g] = [];
      groups[g].push(r);
    }

    let maxIdLen = 16;
    for (const r of rowList) {
      if (r.displayId.length > maxIdLen) maxIdLen = r.displayId.length;
    }
    maxIdLen = Math.min(maxIdLen, Math.max(12, cols - 40));

    for (const groupHeader of Object.keys(groups)) {
      if (!groups[groupHeader] || groups[groupHeader].length === 0) continue;
      lines.push(`\x1b[1;37m${groupHeader}\x1b[0m`);
      for (const r of groups[groupHeader]) {
        let icon = "\x1b[90m·\x1b[0m";
        let statusStr = "\x1b[90mqueued\x1b[0m";

        if (r.rawStatus === "PASSED") {
          icon = "\x1b[1;32m✓\x1b[0m";
          if (r.durationMs && r.durationMs > 0) {
            statusStr = `\x1b[1;32m${(r.durationMs / 1000).toFixed(2)}s\x1b[0m`;
          } else {
            statusStr = "\x1b[1;32mpassed\x1b[0m";
          }
        } else if (r.rawStatus === "FAILED") {
          icon = "\x1b[1;31m×\x1b[0m";
          if (r.stepIndex === 0 && r.error) {
            statusStr = `\x1b[1;31merror: ${r.error}\x1b[0m`;
          } else {
            const stepInfo =
              r.stepIndex > 0 && r.totalSteps > 0
                ? ` at step ${r.stepIndex}/${r.totalSteps}`
                : "";
            const actionText =
              r.error ||
              this.formatStepName(
                r.stepType,
                r.stepDescription || "",
                cols - maxIdLen - 25,
              );
            const detail = actionText ? `: ${actionText}` : "";
            statusStr = `\x1b[1;31mfailed${stepInfo}${detail}\x1b[0m`;
          }
        } else if (r.rawStatus === "RUNNING") {
          icon = "\x1b[1;33m⠋\x1b[0m";
          const stepInfo =
            r.stepIndex > 0 && r.totalSteps > 0
              ? ` (${r.stepIndex}/${r.totalSteps})`
              : "";
          const actionText = this.formatStepName(
            r.stepType,
            r.stepDescription,
            cols - maxIdLen - 25,
          );
          const detail = actionText ? `: ${actionText}` : "";
          statusStr = `\x1b[1;33mrunning${stepInfo}${detail}\x1b[0m`;
        }

        const truncatedId =
          r.displayId.length > maxIdLen
            ? r.displayId.slice(0, maxIdLen - 3) + "..."
            : r.displayId;
        const paddedId = truncatedId.padEnd(maxIdLen + 4, " ");
        lines.push(`  ${icon} ${paddedId}${statusStr}`);
      }
      lines.push("");
    }

    if (this.errorMessages.length > 0) {
      for (const errMsg of this.errorMessages) {
        lines.push(`\x1b[1;31mError: ${errMsg}\x1b[0m`);
      }
      lines.push("");
    }

    lines.push(separator);

    const total = rowList.length;
    const passed = rowList.filter((r) => r.rawStatus === "PASSED").length;
    const failed = rowList.filter((r) => r.rawStatus === "FAILED").length;
    const running = rowList.filter((r) => r.rawStatus === "RUNNING").length;

    const parts: string[] = [];
    parts.push(`\x1b[1;32m${passed} passed\x1b[0m`);
    parts.push(
      `${failed > 0 ? `\x1b[1;31m${failed} failed\x1b[0m` : `0 failed`}`,
    );
    if (running > 0) {
      parts.push(`\x1b[1;33m${running} running\x1b[0m`);
    }
    parts.push(`${total} total`);

    lines.push(parts.join(" \x1b[90m·\x1b[0m "));

    let physicalLineCount = 0;
    for (const l of lines) {
      const plain = l.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
      physicalLineCount += Math.max(1, Math.ceil((plain.length || 1) / cols));
    }

    const output = lines.join("\n");
    process.stdout.write(output + "\n");
    this.lastLineCount = physicalLineCount;
  }

  private formatStepName(
    stepType: string,
    description: string,
    maxLen: number = 35,
  ): string {
    const limit = Math.max(15, maxLen);
    if (!description) return stepType || "";
    let text = description;
    if (
      stepType.toLowerCase() === "navigate" &&
      !description.toLowerCase().startsWith("navigate")
    ) {
      text = `Navigate ${description}`;
    }
    return text.length > limit ? text.slice(0, limit - 3) + "..." : text;
  }
}

function loadTestCasesFromDir(targetDir: string): any[] {
  if (!existsSync(targetDir)) return [];
  const files = readdirSync(targetDir).filter(
    (file) =>
      file.endsWith(".yaml") || file.endsWith(".yml") || file.endsWith(".json"),
  );
  const testCases: any[] = [];
  for (const file of files) {
    const filePath = join(targetDir, file);
    try {
      const content = readFileSync(filePath, "utf-8");
      let testCase: any =
        file.endsWith(".yaml") || file.endsWith(".yml")
          ? parseYaml(content)
          : JSON.parse(content);
      if (
        testCase &&
        testCase.id &&
        testCase.title &&
        Array.isArray(testCase.steps)
      ) {
        testCase.fileName = file;
        testCase.steps = testCase.steps.map((s: any, idx: number) => {
          if (typeof s === "object" && s !== null) {
            let stepType = s.type;
            let stepUrl = s.url;
            let stepDesc = s.description;

            if (!stepType) {
              if (s.navigate !== undefined) {
                stepType = "navigate";
                stepUrl = s.navigate;
                stepDesc = typeof s.navigate === "string" ? s.navigate : "/";
              } else if (s.act !== undefined) {
                stepType = "act";
                stepDesc = s.act;
              } else if (s.validate !== undefined) {
                stepType = "validate";
                stepDesc = s.validate;
              }
            }

            return {
              index: s.index ?? idx + 1,
              type: stepType,
              url: stepUrl,
              description:
                stepDesc || (stepType === "navigate" ? stepUrl || "/" : ""),
            };
          }
          return s;
        });
        testCases.push(testCase);
      }
    } catch (err: any) {
      console.warn(
        `[CLI Warning] Failed to parse test case "${file}":`,
        err.message,
      );
    }
  }
  return testCases;
}

function loadSingleTestCaseFile(filePath: string): any | null {
  const absolutePath = resolve(process.cwd(), filePath);
  if (!existsSync(absolutePath)) {
    console.warn(
      `\x1b[1;33m[CLI Warning] Test file not found: "${filePath}"\x1b[0m`,
    );
    return null;
  }

  try {
    const content = readFileSync(absolutePath, "utf-8");
    let testCase: any =
      filePath.endsWith(".yaml") || filePath.endsWith(".yml")
        ? parseYaml(content)
        : JSON.parse(content);
    if (
      testCase &&
      testCase.id &&
      testCase.title &&
      Array.isArray(testCase.steps)
    ) {
      testCase.fileName = basename(filePath);

      if (!testCase.platform) {
        const lowerPath = filePath.toLowerCase();
        if (lowerPath.includes("/ios/") || lowerPath.includes("/mobile-ios/")) {
          testCase.platform = "ios";
        } else if (
          lowerPath.includes("/android/") ||
          lowerPath.includes("/mobile-android/")
        ) {
          testCase.platform = "android";
        } else {
          testCase.platform = "web";
        }
      }

      testCase.steps = testCase.steps.map((s: any, idx: number) => {
        if (typeof s === "object" && s !== null) {
          let stepType = s.type;
          let stepUrl = s.url;
          let stepDesc = s.description;

          if (!stepType) {
            if (s.navigate !== undefined) {
              stepType = "navigate";
              stepUrl = s.navigate;
              stepDesc = typeof s.navigate === "string" ? s.navigate : "/";
            } else if (s.act !== undefined) {
              stepType = "act";
              stepDesc = s.act;
            } else if (s.validate !== undefined) {
              stepType = "validate";
              stepDesc = s.validate;
            }
          }

          return {
            index: s.index ?? idx + 1,
            type: stepType,
            url: stepUrl,
            description:
              stepDesc || (stepType === "navigate" ? stepUrl || "/" : ""),
          };
        }
        return s;
      });

      return testCase;
    }
  } catch (err: any) {
    console.warn(
      `\x1b[1;33m[CLI Warning] Failed to parse test case file "${filePath}": ${err.message}\x1b[0m`,
    );
  }
  return null;
}

function findTestCaseByIdOrPath(target: string, dirPath: string): any | null {
  const directAbs = resolve(process.cwd(), target);
  if (existsSync(directAbs) && statSync(directAbs).isFile()) {
    return loadSingleTestCaseFile(directAbs);
  }

  for (const ext of [".yaml", ".yml", ".json"]) {
    const withExt = resolve(process.cwd(), `${target}${ext}`);
    if (existsSync(withExt) && statSync(withExt).isFile()) {
      return loadSingleTestCaseFile(withExt);
    }
  }

  const candidateDirs = [
    join(dirPath, "web"),
    join(dirPath, "ios"),
    join(dirPath, "mobile-ios"),
    join(dirPath, "android"),
    join(dirPath, "mobile-android"),
    dirPath,
  ];

  for (const d of candidateDirs) {
    if (!existsSync(d)) continue;
    for (const ext of [".yaml", ".yml", ".json", ""]) {
      const fileName =
        target.endsWith(ext) || !ext ? target : `${target}${ext}`;
      const candidatePath = join(d, fileName);
      if (existsSync(candidatePath) && statSync(candidatePath).isFile()) {
        return loadSingleTestCaseFile(candidatePath);
      }
    }

    const files = readdirSync(d).filter(
      (f) => f.endsWith(".yaml") || f.endsWith(".yml") || f.endsWith(".json"),
    );
    for (const file of files) {
      const fp = join(d, file);
      const tc = loadSingleTestCaseFile(fp);
      if (
        tc &&
        (tc.id === target ||
          tc.fileName === target ||
          tc.id === `${target}.yaml`)
      ) {
        return tc;
      }
    }
  }

  return null;
}

async function runTests(options: Record<string, any>) {
  const apiKey = await getApiKey();
  const dirName = options.dir || "zenitests";
  const dirPath = resolve(process.cwd(), dirName);

  const rawTargets: string[] = [];
  const rawFileOpt = options.file || options.f;
  if (rawFileOpt) {
    if (Array.isArray(rawFileOpt)) {
      rawTargets.push(...rawFileOpt);
    } else if (typeof rawFileOpt === "string") {
      rawTargets.push(rawFileOpt);
    }
  }

  const positionalArgs = options._.slice(1);
  for (const arg of positionalArgs) {
    if (typeof arg === "string") {
      const abs = resolve(process.cwd(), arg);
      if (existsSync(abs) && statSync(abs).isDirectory()) {
        options.dir = arg;
      } else {
        rawTargets.push(arg);
      }
    }
  }

  let allWebTestCases: any[] = [];
  let iosTestCases: any[] = [];
  let androidTestCases: any[] = [];

  const webDir = join(dirPath, "web");
  const iosDir = existsSync(join(dirPath, "ios"))
    ? join(dirPath, "ios")
    : join(dirPath, "mobile-ios");
  const androidDir = existsSync(join(dirPath, "android"))
    ? join(dirPath, "android")
    : join(dirPath, "mobile-android");

  if (rawTargets.length > 0) {
    const loadedFiles: any[] = [];
    for (const target of rawTargets) {
      const tc = findTestCaseByIdOrPath(target, dirPath);
      if (tc) {
        loadedFiles.push(tc);
      } else {
        console.warn(
          `\x1b[1;33m[CLI Warning] Test case "${target}" not found.\x1b[0m`,
        );
      }
    }

    allWebTestCases = loadedFiles
      .filter((tc) => (tc.platform || "web").toLowerCase() === "web")
      .map((tc) => ({ ...tc, platform: "web" }));
    iosTestCases = loadedFiles
      .filter((tc) => (tc.platform || "").toLowerCase() === "ios")
      .map((tc) => ({ ...tc, platform: "ios" }));
    androidTestCases = loadedFiles
      .filter((tc) => (tc.platform || "").toLowerCase() === "android")
      .map((tc) => ({ ...tc, platform: "android" }));
  } else {

    const filterPlatform = (
      options.platform ||
      options.target ||
      ""
    ).toLowerCase();
    const selectedPlatforms = filterPlatform
      ? filterPlatform
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean)
      : [];

    const runWeb =
      selectedPlatforms.length === 0 ||
      selectedPlatforms.some((p) => p === "web");
    const runIos =
      selectedPlatforms.length === 0 ||
      selectedPlatforms.some((p) => p === "ios" || p === "mobile-ios");
    const runAndroid =
      selectedPlatforms.length === 0 ||
      selectedPlatforms.some((p) => p === "android" || p === "mobile-android");

    const rawWebTestCases =
      runWeb && existsSync(webDir) ? loadTestCasesFromDir(webDir) : [];
    const rawIosTestCases =
      runIos && existsSync(iosDir)
        ? loadTestCasesFromDir(iosDir).map((tc) => ({ ...tc, platform: "ios" }))
        : [];
    const rawAndroidTestCases =
      runAndroid && existsSync(androidDir)
        ? loadTestCasesFromDir(androidDir).map((tc) => ({
            ...tc,
            platform: "android",
          }))
        : [];

    const rootTestCases =
      runWeb &&
      rawWebTestCases.length === 0 &&
      rawIosTestCases.length === 0 &&
      rawAndroidTestCases.length === 0
        ? loadTestCasesFromDir(dirPath)
        : [];

    allWebTestCases = [...rawWebTestCases, ...rootTestCases].map((tc) => ({
      ...tc,
      platform: "web",
    }));
    iosTestCases = rawIosTestCases;
    androidTestCases = rawAndroidTestCases;
  }

  const combinedPlatforms: string[] = [];
  if (allWebTestCases.length > 0) combinedPlatforms.push("web");
  if (iosTestCases.length > 0) combinedPlatforms.push("ios");
  if (androidTestCases.length > 0) combinedPlatforms.push("android");

  const combinedTestCases = [
    ...allWebTestCases,
    ...iosTestCases,
    ...androidTestCases,
  ];
  const totalCount = combinedTestCases.length;

  if (totalCount === 0) {
    console.error(`\x1b[1;31mError: No valid test cases found.\x1b[0m`);
    process.exit(1);
  }

  let executionId: string | undefined;
  try {
    const initRes = await fetch(`${API_BASE_URL}/api/executions/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        title: `Suite Run (${combinedPlatforms.join(", ")})`,
        platforms: combinedPlatforms,
        total_test_cases: totalCount,
      }),
    });
    const initData = await initRes.json().catch(() => ({}));
    if (initRes.ok && initData.success && initData.data?.id) {
      executionId = initData.data.id;
    }
  } catch (_) {}

  const renderer = new LiveReportRenderer(combinedTestCases);
  if (executionId) {
    renderer.setExecutionId(executionId);
  }
  renderer.render();

  let exitCode = 0;

function loadWebConfig(webDir: string): {
  localURL?: string;
  prodURL?: string;
  parallel?: number;
} {
  const possiblePaths = [
    join(webDir, "config.yaml"),
    join(webDir, "config.yml"),
    join(webDir, "config.json"),
  ];
  for (const p of possiblePaths) {
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, "utf-8");
        const parsed = p.endsWith(".json") ? JSON.parse(content) : parseYaml(content);
        if (parsed && typeof parsed === "object") {
          return {
            localURL: parsed.localURL || parsed.localUrl || parsed.local,
            prodURL: parsed.prodURL || parsed.prodUrl || parsed.prod,
            parallel: parsed.parallel ? Number(parsed.parallel) : undefined,
          };
        }
      } catch {}
    }
  }
  return {};
}

  // 1. Web Tests Task
  const runWeb = async () => {
    if (allWebTestCases.length === 0) return;
    const clientId = await fetchServerClientId(apiKey);
    const secrets = loadLocalSecrets(dirPath);
    const webConfig = webDir && existsSync(webDir) ? loadWebConfig(webDir) : {};

    const targetEnv = (
      options.local ? "local" : options.prod ? "prod" : options.env || options.e || "prod"
    ).toLowerCase();

    const parallel = Number(
      options.parallel || options.p || options.concurrency || options.c || webConfig.parallel || 5,
    );

    const client = new ClientWebExecutor({
      serverUrl: WS_BASE_URL,
      clientId,
      headless: true,
      secrets,
    });

    try {
      await client.start();
      const testCasesWithSecrets = allWebTestCases.map((tc) => {
        const vars = { ...(tc.variables || {}) };
        for (const [k, v] of Object.entries(secrets)) {
          vars[`secret.${k}`] = v;
        }
        return {
          ...tc,
          localURL: webConfig.localURL || tc.localURL || tc.localUrl,
          prodURL: webConfig.prodURL || tc.prodURL || tc.prodUrl,
          variables: vars,
        };
      });

      const response = await fetch(`${API_BASE_URL}/api/executions/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          Authorization: `Bearer ${apiKey}`,
          "x-stream": "true",
        },
        body: JSON.stringify({
          executionId,
          clientId,
          testCases: testCasesWithSecrets,
          parallel,
          platform: "web",
          platforms: ["web"],
          env: targetEnv,
          localURL: webConfig.localURL,
          prodURL: webConfig.prodURL,
        }),
      });

      if (!response.ok) {
        await client.stop();
        const errData = await response.json().catch(() => ({}));
        const errMsg =
          errData.error ||
          errData.message ||
          `Web execution failed with status ${response.status}`;
        for (const tc of allWebTestCases) {
          renderer.completeTest(tc.id, "FAILED", 0, errMsg);
        }
      } else if (response.body) {
        const reader = (
          response.body as ReadableStream<Uint8Array>
        ).getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const msg = JSON.parse(trimmed);
              if (msg.type === "init" && !executionId) {
                executionId = msg.executionId;
                renderer.setExecutionId(msg.executionId);
              } else if (msg.type === "step_progress")
                renderer.updateStep(
                  msg.testCaseId,
                  msg.stepIndex,
                  msg.totalSteps,
                  msg.stepType,
                  msg.description,
                );
              else if (msg.type === "test_complete")
                renderer.completeTest(
                  msg.testCaseId,
                  msg.status,
                  msg.durationMs,
                  msg.error,
                );
              else if (msg.type === "execution_complete") {
                if (msg.failedCount > 0) exitCode = 1;
              }
            } catch {}
          }
        }
      }
    } finally {
      await client.stop();
    }
  };

function loadIosConfig(iosDir: string): {
  bundlePath?: string;
  device?: string;
  parallel?: number;
} {
  const possiblePaths = [
    join(iosDir, "config.yaml"),
    join(iosDir, "config.yml"),
    join(iosDir, "config.json"),
  ];
  for (const p of possiblePaths) {
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, "utf-8");
        const parsed = p.endsWith(".json") ? JSON.parse(content) : parseYaml(content);
        if (parsed && typeof parsed === "object") {
          return {
            bundlePath: parsed.bundlePath || parsed.bundle || parsed.appPath || parsed.app,
            device: parsed.device || parsed.deviceName,
            parallel: parsed.parallel ? Number(parsed.parallel) : undefined,
          };
        }
      } catch {}
    }
  }
  return {};
}

  // 2. Mobile iOS Tests Task
  const runIos = async () => {
    if (iosTestCases.length === 0) return;
    const clientId = `client_ios_${crypto.randomUUID()}`;
    const secrets = loadLocalSecrets(dirPath);
    const iosConfig = iosDir && existsSync(iosDir) ? loadIosConfig(iosDir) : {};

    const rawBundlePath =
      options.bundle ||
      options.b ||
      options["app-ios"] ||
      iosConfig.bundlePath ||
      undefined;

    let iosAppPath: string | undefined = undefined;
    if (rawBundlePath) {
      if (existsSync(rawBundlePath)) {
        iosAppPath = resolve(process.cwd(), rawBundlePath);
      } else if (iosDir && existsSync(resolve(iosDir, rawBundlePath))) {
        iosAppPath = resolve(iosDir, rawBundlePath);
      } else {
        iosAppPath = resolve(process.cwd(), rawBundlePath);
      }
    }

    const deviceName =
      options.device ||
      options.d ||
      iosConfig.device ||
      undefined;

    const parallelCount =
      options.parallel ||
      options.p ||
      iosConfig.parallel ||
      1;

    const client = new ClientIosExecutor({
      serverUrl: WS_BASE_URL,
      clientId,
      appFilePath: iosAppPath,
      bundleId: options.bundleId,
      deviceName,
      secrets,
    });

    try {
      await client.start();

      // Inject local secrets into test case variables
      const injectedIosTestCases = iosTestCases.map((tc) => {
        const mergedVariables = { ...(tc.variables || {}) };
        for (const [secKey, secVal] of Object.entries(secrets)) {
          mergedVariables[`secret.${secKey}`] = secVal;
        }
        return {
          ...tc,
          variables: mergedVariables,
        };
      });

      const res = await fetch(`${API_BASE_URL}/api/executions/mobile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          Authorization: `Bearer ${apiKey}`,
          "x-stream": "true",
          "x-client-id": clientId,
        },
        body: JSON.stringify({
          clientId,
          platform: "ios",
          testCases: injectedIosTestCases,
          appFilePath: iosAppPath,
          bundleId: options.bundleId,
          deviceName,
          parallel: parallelCount,
          executionId,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errMsg =
          errData.error ||
          errData.message ||
          `Mobile iOS execution failed with status ${res.status}`;
        for (const tc of iosTestCases) {
          renderer.completeTest(tc.id, "FAILED", 0, errMsg);
        }
      } else if (res.body) {
        const reader = (res.body as ReadableStream<Uint8Array>).getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const msg = JSON.parse(trimmed);
              if (msg.type === "init" && !executionId) {
                executionId = msg.executionId;
                renderer.setExecutionId(msg.executionId);
              } else if (msg.type === "step_progress")
                renderer.updateStep(
                  msg.testCaseId,
                  msg.stepIndex,
                  msg.totalSteps,
                  msg.stepType,
                  msg.description,
                );
              else if (msg.type === "test_complete")
                renderer.completeTest(
                  msg.testCaseId,
                  msg.status,
                  msg.durationMs,
                  msg.error,
                );
              else if (msg.type === "execution_complete") {
                if (msg.failedCount > 0) exitCode = 1;
              }
            } catch {}
          }
        }
      }
    } catch (err: any) {
      const errMsg = err.message || "Failed to execute iOS tests";
      for (const tc of iosTestCases) {
        renderer.completeTest(tc.id, "FAILED", 0, errMsg);
      }
    } finally {
      await client.stop();
    }
  };

function loadAndroidConfig(androidDir: string): {
  bundlePath?: string;
  device?: string;
  parallel?: number;
} {
  const possiblePaths = [
    join(androidDir, "config.yaml"),
    join(androidDir, "config.yml"),
    join(androidDir, "config.json"),
  ];
  for (const p of possiblePaths) {
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, "utf-8");
        const parsed = p.endsWith(".json") ? JSON.parse(content) : parseYaml(content);
        if (parsed && typeof parsed === "object") {
          return {
            bundlePath:
              parsed.bundlePath ||
              parsed.bundle ||
              parsed.appPath ||
              parsed.app ||
              parsed.apkPath,
            device: parsed.device || parsed.deviceName,
            parallel: parsed.parallel ? Number(parsed.parallel) : undefined,
          };
        }
      } catch {}
    }
  }
  return {};
}

  // 3. Mobile Android Tests Task
  const runAndroid = async () => {
    if (androidTestCases.length === 0) return;
    const clientId = `client_android_${crypto.randomUUID()}`;
    const secrets = loadLocalSecrets(dirPath);
    const androidConfig =
      androidDir && existsSync(androidDir) ? loadAndroidConfig(androidDir) : {};

    const rawBundlePath =
      options.bundle ||
      options.b ||
      options["app-android"] ||
      androidConfig.bundlePath ||
      undefined;

    let androidAppPath: string | undefined = undefined;
    if (rawBundlePath) {
      if (existsSync(rawBundlePath)) {
        androidAppPath = resolve(process.cwd(), rawBundlePath);
      } else if (
        androidDir &&
        existsSync(resolve(androidDir, rawBundlePath))
      ) {
        androidAppPath = resolve(androidDir, rawBundlePath);
      } else {
        androidAppPath = resolve(process.cwd(), rawBundlePath);
      }
    }

    const deviceName =
      options.device ||
      options.d ||
      androidConfig.device ||
      undefined;

    const parallelCount =
      options.parallel ||
      options.p ||
      androidConfig.parallel ||
      1;

    const client = new ClientAndroidExecutor({
      serverUrl: WS_BASE_URL,
      clientId,
      appFilePath: androidAppPath,
      appPackage: options.appPackage,
      appActivity: options.appActivity,
      deviceName,
      secrets,
    });

    try {
      await client.start();

      // Inject local secrets into test case variables
      const injectedAndroidTestCases = androidTestCases.map((tc) => {
        const mergedVariables = { ...(tc.variables || {}) };
        for (const [secKey, secVal] of Object.entries(secrets)) {
          mergedVariables[`secret.${secKey}`] = secVal;
        }
        return {
          ...tc,
          variables: mergedVariables,
        };
      });

      const res = await fetch(`${API_BASE_URL}/api/executions/mobile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          Authorization: `Bearer ${apiKey}`,
          "x-stream": "true",
          "x-client-id": clientId,
        },
        body: JSON.stringify({
          clientId,
          platform: "android",
          testCases: injectedAndroidTestCases,
          appFilePath: androidAppPath,
          appPackage: options.appPackage,
          appActivity: options.appActivity,
          deviceName,
          parallel: parallelCount,
          executionId,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errMsg =
          errData.error ||
          errData.message ||
          `Mobile Android execution failed with status ${res.status}`;
        for (const tc of androidTestCases) {
          renderer.completeTest(tc.id, "FAILED", 0, errMsg);
        }
      } else if (res.body) {
        const reader = (res.body as ReadableStream<Uint8Array>).getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const msg = JSON.parse(trimmed);
              if (msg.type === "init" && !executionId) {
                executionId = msg.executionId;
                renderer.setExecutionId(msg.executionId);
              } else if (msg.type === "step_progress")
                renderer.updateStep(
                  msg.testCaseId,
                  msg.stepIndex,
                  msg.totalSteps,
                  msg.stepType,
                  msg.description,
                );
              else if (msg.type === "test_complete")
                renderer.completeTest(
                  msg.testCaseId,
                  msg.status,
                  msg.durationMs,
                  msg.error,
                );
              else if (msg.type === "execution_complete") {
                if (msg.failedCount > 0) exitCode = 1;
              }
            } catch {}
          }
        }
      }
    } catch (err: any) {
      const errMsg = err.message || "Failed to execute Android tests";
      for (const tc of androidTestCases) {
        renderer.completeTest(tc.id, "FAILED", 0, errMsg);
      }
    } finally {
      await client.stop();
    }
  };

  // Run all platform test tasks concurrently in parallel

  await Promise.all([runWeb(), runIos(), runAndroid()]);

  if (executionId) {
    try {
      await fetch(`${API_BASE_URL}/api/executions/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ executionId }),
      });
    } catch (_) {}
  }

  renderer.render(true);

  if (executionId) {
    console.log();
    console.log(
      `\x1b[90mView execution report:\x1b[0m \x1b[4;36m${APP_BASE_URL}/runs/${executionId}\x1b[0m`,
    );
    console.log();
  }

  const executedCount = renderer.getExecutedCount();
  const failedCount = renderer.getFailedCount();
  if (executedCount === 0 || failedCount > 0) {
    exitCode = 1;
  }

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

async function runReport(options: Record<string, any>) {
  const apiKey = await getApiKey();
  const runArg = options._[1] || options.run || options.id || options.number;

  if (!runArg) {
    console.error(
      "\x1b[1;31mError: Missing required run_number argument.\x1b[0m",
    );
    console.log(
      "Usage: zenitest report <run_number> (e.g. zenitest report 21)",
    );
    process.exit(1);
  }

  const res = await fetch(`${API_BASE_URL}/api/executions/${runArg}`, {
    headers: {
      "x-api-key": apiKey,
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    console.error(
      `\x1b[1;31mError fetching report for run "${runArg}": ${errData.error || res.statusText}\x1b[0m`,
    );
    process.exit(1);
  }

  const body = await res.json();
  if (!body.success || !body.data) {
    console.error(`\x1b[1;31mExecution "${runArg}" not found.\x1b[0m`);
    process.exit(1);
  }

  const exec = body.data;
  const details = exec.details || [];

  const reportItems = details.map((d: any) => {
    const rawPlatform = (d.platform || "web").toLowerCase();
    let platformDisplay = "Web";
    if (rawPlatform === "ios" || rawPlatform === "mobile-ios") {
      platformDisplay = "Mobile iOS";
    } else if (rawPlatform === "android" || rawPlatform === "mobile-android") {
      platformDisplay = "Mobile Android";
    } else if (rawPlatform.includes("mobile")) {
      platformDisplay = "Mobile";
    }

    const testCaseId =
      d.info?.specFile ||
      (d.test_case_id
        ? d.test_case_id.endsWith(".yaml") || d.test_case_id.endsWith(".yml")
          ? d.test_case_id
          : `${d.test_case_id}.yaml`
        : "test.yaml");
    const status = (d.status || "pending").toUpperCase();
    const durationMs = d.duration_ms || 0;
    const durationFormatted = (durationMs / 1000).toFixed(2) + "s";

    const allSteps = (d.step_reports || []).filter(
      (s: any) => s.type !== "__meta__",
    );
    const numberSteps = allSteps.length;

    let failedAtStepStr = "-";
    if (status === "FAILED") {
      const failedStepIndex = allSteps.findIndex(
        (s: any) => s.success === false || s.status === "failed",
      );
      if (failedStepIndex !== -1) {
        const stepObj = allSteps[failedStepIndex];
        const stepNum = stepObj.index || failedStepIndex + 1;
        const stepDesc =
          stepObj.description || stepObj.actionType || stepObj.type || "";
        failedAtStepStr = `Step ${stepNum}/${numberSteps}${stepDesc ? `: ${stepDesc}` : ""}`;
      } else if (d.error_message) {
        failedAtStepStr = d.error_message;
      }
    }

    let analysisStr = "N/A";
    if (d.bug_analysis || d.ai_analysis || d.bugAnalysis) {
      const ba = d.bug_analysis || d.ai_analysis || d.bugAnalysis;
      if (typeof ba === "string") {
        analysisStr = ba;
      } else if (typeof ba === "object") {
        analysisStr =
          ba.summary || ba.rootCause || ba.recommendation || JSON.stringify(ba);
      }
    } else if (d.error_message) {
      analysisStr = d.error_message;
    }

    return {
      testCaseId,
      platform: platformDisplay,
      status,
      durationMs,
      durationFormatted,
      numberSteps,
      failedAtStep: failedAtStepStr,
      analysis: analysisStr,
    };
  });

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          executionId: exec.id,
          runNumber: exec.number || exec.run_number || runArg,
          title: exec.title,
          status: exec.status,
          totalTests: exec.total_test_cases || reportItems.length,
          passedTests:
            exec.passed_test_cases ||
            reportItems.filter((i: any) => i.status === "PASSED").length,
          failedTests:
            exec.failed_test_cases ||
            reportItems.filter((i: any) => i.status === "FAILED").length,
          totalDurationMs: exec.total_duration_ms || 0,
          testCases: reportItems,
        },
        null,
        2,
      ),
    );
    return;
  }

  const cols = process.stdout.columns || 80;
  const termWidth = Math.max(60, Math.min(cols, 100));
  const separator = "\x1b[90m" + "─".repeat(termWidth) + "\x1b[0m";

  const runNumStr = exec.number || exec.run_number || runArg;
  const statusColor =
    exec.status === "completed" || exec.status === "passed"
      ? "\x1b[1;32mPASSED\x1b[0m"
      : exec.status === "failed"
        ? "\x1b[1;31mFAILED\x1b[0m"
        : "\x1b[1;33mRUNNING\x1b[0m";

  console.log(
    `\x1b[1mZeniTest \x1b[90m›\x1b[0m Execution Report \x1b[1;36m#${runNumStr}\x1b[0m`,
  );
  console.log(separator);
  console.log(`\x1b[90mExecution ID:\x1b[0m ${exec.id}`);
  console.log(
    `\x1b[90mStatus:\x1b[0m       ${statusColor} \x1b[90m·\x1b[0m ${exec.passed_test_cases || 0} Passed \x1b[90m·\x1b[0m ${exec.failed_test_cases || 0} Failed \x1b[90m·\x1b[0m ${reportItems.length} Total`,
  );
  if (exec.total_duration_ms) {
    console.log(
      `\x1b[90mDuration:\x1b[0m     ${(exec.total_duration_ms / 1000).toFixed(2)}s`,
    );
  }
  console.log(separator);
  console.log();

  reportItems.forEach((item: any, idx: number) => {
    const statusFormatted =
      item.status === "PASSED"
        ? "\x1b[1;32m✓ PASSED\x1b[0m"
        : "\x1b[1;31m× FAILED\x1b[0m";

    console.log(`\x1b[1m[${idx + 1}] ${item.testCaseId}\x1b[0m`);
    console.log(`    \x1b[90mPlatform:\x1b[0m       ${item.platform}`);
    console.log(`    \x1b[90mStatus:\x1b[0m         ${statusFormatted}`);
    console.log(`    \x1b[90mDuration:\x1b[0m       ${item.durationFormatted}`);
    console.log(`    \x1b[90mSteps:\x1b[0m          ${item.numberSteps} steps`);
    console.log(`    \x1b[90mFailed at Step:\x1b[0m ${item.failedAtStep}`);
    console.log(`    \x1b[90mAnalysis:\x1b[0m       ${item.analysis}`);
    console.log();
  });

  console.log(separator);
  console.log(
    `\x1b[90mView details:\x1b[0m \x1b[4;36m${APP_BASE_URL}/runs/${exec.id}\x1b[0m`,
  );
  console.log();
}

async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.version) {
    console.log(`zenitest-cli v${CURRENT_VERSION}`);
    process.exit(0);
  }

  if (options.help || args.length === 0) {
    showHelp();
    process.exit(0);
  }

  await checkForLatestVersion();

  const command = options._[0];

  switch (command) {
    case "auth":
      await runAuth(options);
      break;
    case "client":
      await runClient();
      break;
    case "run":
      await runTests(options);
      break;
    case "report":
      await runReport(options);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal CLI error:", err);
  process.exit(1);
});
