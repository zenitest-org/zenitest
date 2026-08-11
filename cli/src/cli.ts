#!/usr/bin/env bun

import { ZeniProxyClient } from "./proxyClient";
import { readdirSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync, statSync } from "fs";
import { join, resolve, basename } from "path";
import { homedir } from "os";
import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { parse as parseYaml } from "yaml";

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
      resolve(testDir, "credentials.yml")
    );
  }

  for (const filePath of possiblePaths) {
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf-8");
        const parsed = parseYaml(content);
        if (parsed && typeof parsed === "object") {
          const dict = parsed.secrets && typeof parsed.secrets === "object" ? parsed.secrets : parsed;
          for (const [k, v] of Object.entries(dict)) {
            if (v !== undefined && v !== null && typeof v !== "object") {
              secrets[k] = String(v);
            }
          }
        }
      } catch (err: any) {
        console.warn(`[CLI Warning] Failed to parse secrets file "${filePath}":`, err.message);
      }
    }
  }

  // Fallback to process.env
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && (k.startsWith("SECRET_") || k.includes("PASSWORD"))) {
      if (!secrets[k]) secrets[k] = v;
      const strippedKey = k.replace(/^SECRET_/, "");
      if (!secrets[strippedKey]) secrets[strippedKey] = v;
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
  client               Start the browser proxy client and establish CDP tunnel
  run                  Read test cases from a folder and run them via the server
  report <run_number>  Fetch execution report summary (e.g. zenitest report 21)

Options:
  --dir, -d           Directory containing test cases (defaults to zenitests)
  --platform, -t      Platform target to execute: web, ios, android (defaults to all)
  --bundle, -b        Path to built mobile app binary (.ipa or .apk)
  --parallel, -p      Number of test cases to run in parallel (defaults to 5)
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
  if (options.b) options.bundle = options.b;
  if (options.h) options.help = options.h;

  return options;
}

const API_BASE_URL = process.env.ZENITEST_API_URL || process.env.API_URL || "http://localhost:3001";
const WS_BASE_URL = process.env.ZENITEST_WS_URL || process.env.WS_URL || "ws://localhost:3001";
const APP_BASE_URL = process.env.ZENITEST_APP_URL || process.env.APP_URL || "https://app.zenitest.ai";

async function verifyApiKey(apiKey: string): Promise<{ valid: boolean; user?: any }> {
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
      console.log(`\x1b[1;31mStored API key is invalid or expired. Invalidating saved credentials...\x1b[0m`);
      deleteStoredApiKey();
      apiKey = undefined;
    } else {
      return apiKey;
    }
  }

  while (!apiKey) {
    console.log(`\x1b[1;33mPlease enter a valid Zeni API key to continue.\x1b[0m`);
    apiKey = await promptApiKey();

    if (!apiKey) {
      console.error(`\x1b[1;31mError: API key is mandatory.\x1b[0m`);
      process.exit(1);
    }

    const verification = await verifyApiKey(apiKey);
    if (verification.valid) {
      saveApiKey(apiKey);
      if (verification.user?.name || verification.user?.email) {
        console.log(`\x1b[1;32mAuthenticated as ${verification.user.name || verification.user.email}\x1b[0m`);
      }
      return apiKey;
    } else {
      console.error(`\x1b[1;31mError: Invalid API key. Please re-enter a valid API key.\x1b[0m\n`);
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
        console.log(`\x1b[1;32mAuthenticated as ${verification.user.name || verification.user.email}\x1b[0m`);
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
        console.log(`\x1b[1;32mAuthenticated as ${verification.user.name || verification.user.email}\x1b[0m`);
      }
      return;
    } else {
      console.error(`\x1b[1;31mError: Invalid API key. Please re-enter a valid API key.\x1b[0m\n`);
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
        "Authorization": `Bearer ${apiKey}`,
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
  const chromePort = 9222;
  const headless = true;

  const secrets = loadLocalSecrets();
  const client = new ZeniProxyClient({
    serverUrl: wsServerUrl,
    clientId,
    chromePort,
    headless,
    secrets,
  });

  await client.start();

  process.exitCode = 0;
  process.on("SIGINT", () => {
    client.stop();
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
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      clientId,
      testCase,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Server returned error status ${response.status}: ${errText}`);
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
  private lastLineCount: number = 0;

  constructor(testCases: { id: string; title: string; platform?: string; fileName?: string }[]) {
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

      const displayId = tc.fileName || (tc.id.endsWith(".yaml") || tc.id.endsWith(".yml") ? tc.id : `${tc.id}.yaml`);
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
    this.render();
  }

  public updateStep(testCaseId: string, stepIndex: number, totalSteps: number, stepType: string, description: string) {
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

  public completeTest(testCaseId: string, status: "PASSED" | "FAILED", durationMs?: number, error?: string) {
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
      process.stdout.write(`\x1b[${this.lastLineCount}A\x1b[0J`);
    }

    const cols = process.stdout.columns || 80;
    const termWidth = Math.max(60, Math.min(cols, 100));
    const separator = "\x1b[90m" + "─".repeat(termWidth) + "\x1b[0m";

    const lines: string[] = [];

    const rowList = Array.from(this.rows.values());

    const groups: { [key: string]: LiveTestCaseState[] } = {};
    for (const r of rowList) {
      const g = r.platformDetail || "WEB";
      if (!groups[g]) groups[g] = [];
      groups[g].push(r);
    }

    let maxIdLen = 20;
    for (const r of rowList) {
      if (r.displayId.length > maxIdLen) maxIdLen = r.displayId.length;
    }

    for (const groupHeader of Object.keys(groups)) {
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
          const stepInfo = r.stepIndex > 0 && r.totalSteps > 0 ? ` at step ${r.stepIndex}/${r.totalSteps}` : "";
          const actionText = this.formatStepName(r.stepType, r.stepDescription || r.error || "");
          const detail = actionText ? `: ${actionText}` : "";
          statusStr = `\x1b[1;31mfailed${stepInfo}${detail}\x1b[0m`;
        } else if (r.rawStatus === "RUNNING") {
          icon = "\x1b[1;33m⠋\x1b[0m";
          const stepInfo = r.stepIndex > 0 && r.totalSteps > 0 ? ` (${r.stepIndex}/${r.totalSteps})` : "";
          const actionText = this.formatStepName(r.stepType, r.stepDescription);
          const detail = actionText ? `: ${actionText}` : "";
          statusStr = `\x1b[1;33mrunning${stepInfo}${detail}\x1b[0m`;
        }

        const paddedId = r.displayId.padEnd(maxIdLen + 4, " ");
        lines.push(`  ${icon} ${paddedId}${statusStr}`);
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
    parts.push(`${failed > 0 ? `\x1b[1;31m${failed} failed\x1b[0m` : `0 failed`}`);
    if (running > 0) {
      parts.push(`\x1b[1;33m${running} running\x1b[0m`);
    }
    parts.push(`${total} total`);

    lines.push(parts.join(" \x1b[90m·\x1b[0m "));

    const output = lines.join("\n");
    process.stdout.write(output + "\n");
    this.lastLineCount = (output.match(/\n/g) || []).length + 1;
  }

  private formatStepName(stepType: string, description: string): string {
    if (!description) return stepType || "";
    if (stepType.toLowerCase() === "navigate" && !description.toLowerCase().startsWith("navigate")) {
      return `Navigate ${description}`;
    }
    return description.length > 45 ? description.slice(0, 42) + "..." : description;
  }
}

function loadTestCasesFromDir(targetDir: string): any[] {
  if (!existsSync(targetDir)) return [];
  const files = readdirSync(targetDir).filter(
    (file) => file.endsWith(".yaml") || file.endsWith(".yml") || file.endsWith(".json")
  );
  const testCases: any[] = [];
  for (const file of files) {
    const filePath = join(targetDir, file);
    try {
      const content = readFileSync(filePath, "utf-8");
      let testCase: any = (file.endsWith(".yaml") || file.endsWith(".yml")) ? parseYaml(content) : JSON.parse(content);
      if (testCase && testCase.id && testCase.title && Array.isArray(testCase.steps)) {
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
              index: s.index ?? (idx + 1),
              type: stepType,
              url: stepUrl,
              description: stepDesc || (stepType === "navigate" ? (stepUrl || "/") : ""),
            };
          }
          return s;
        });
        testCases.push(testCase);
      }
    } catch (err: any) {
      console.warn(`[CLI Warning] Failed to parse test case "${file}":`, err.message);
    }
  }
  return testCases;
}

function loadSingleTestCaseFile(filePath: string): any | null {
  const absolutePath = resolve(process.cwd(), filePath);
  if (!existsSync(absolutePath)) {
    console.warn(`\x1b[1;33m[CLI Warning] Test file not found: "${filePath}"\x1b[0m`);
    return null;
  }

  try {
    const content = readFileSync(absolutePath, "utf-8");
    let testCase: any = (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) ? parseYaml(content) : JSON.parse(content);
    if (testCase && testCase.id && testCase.title && Array.isArray(testCase.steps)) {
      testCase.fileName = basename(filePath);

      if (!testCase.platform) {
        const lowerPath = filePath.toLowerCase();
        if (lowerPath.includes("/ios/") || lowerPath.includes("/mobile-ios/")) {
          testCase.platform = "ios";
        } else if (lowerPath.includes("/android/") || lowerPath.includes("/mobile-android/")) {
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
            index: s.index ?? (idx + 1),
            type: stepType,
            url: stepUrl,
            description: stepDesc || (stepType === "navigate" ? (stepUrl || "/") : ""),
          };
        }
        return s;
      });

      return testCase;
    }
  } catch (err: any) {
    console.warn(`\x1b[1;33m[CLI Warning] Failed to parse test case file "${filePath}": ${err.message}\x1b[0m`);
  }
  return null;
}

async function runTests(options: Record<string, any>) {
  const apiKey = await getApiKey();

  const targetFilePaths: string[] = [];
  const rawFileOpt = options.file || options.f;
  if (rawFileOpt) {
    if (Array.isArray(rawFileOpt)) {
      targetFilePaths.push(...rawFileOpt);
    } else if (typeof rawFileOpt === "string") {
      targetFilePaths.push(rawFileOpt);
    }
  }

  const positionalArgs = options._.slice(1);
  for (const arg of positionalArgs) {
    if (typeof arg === "string") {
      const abs = resolve(process.cwd(), arg);
      if (existsSync(abs)) {
        const stat = statSync(abs);
        if (stat.isFile()) {
          targetFilePaths.push(arg);
        } else if (stat.isDirectory()) {
          options.dir = arg;
        }
      } else if (arg.endsWith(".yaml") || arg.endsWith(".yml") || arg.endsWith(".json")) {
        targetFilePaths.push(arg);
      }
    }
  }

  let allWebTestCases: any[] = [];
  let iosTestCases: any[] = [];
  let androidTestCases: any[] = [];

  if (targetFilePaths.length > 0) {
    const loadedFiles = targetFilePaths
      .map((fp) => loadSingleTestCaseFile(fp))
      .filter(Boolean);

    allWebTestCases = loadedFiles.filter((tc) => (tc.platform || "web").toLowerCase() === "web").map((tc) => ({ ...tc, platform: "web" }));
    iosTestCases = loadedFiles.filter((tc) => (tc.platform || "").toLowerCase() === "ios").map((tc) => ({ ...tc, platform: "ios" }));
    androidTestCases = loadedFiles.filter((tc) => (tc.platform || "").toLowerCase() === "android").map((tc) => ({ ...tc, platform: "android" }));
  } else {
    const dirName = options.dir || "zenitests";
    const dirPath = resolve(process.cwd(), dirName);

    const webDir = join(dirPath, "web");
    const iosDir = existsSync(join(dirPath, "ios")) ? join(dirPath, "ios") : join(dirPath, "mobile-ios");
    const androidDir = existsSync(join(dirPath, "android")) ? join(dirPath, "android") : join(dirPath, "mobile-android");

    const filterPlatform = (options.platform || options.target || "").toLowerCase();
    const selectedPlatforms = filterPlatform ? filterPlatform.split(",").map((p) => p.trim()).filter(Boolean) : [];

    const runWeb = selectedPlatforms.length === 0 || selectedPlatforms.some((p) => p === "web");
    const runIos = selectedPlatforms.length === 0 || selectedPlatforms.some((p) => p === "ios" || p === "mobile-ios");
    const runAndroid = selectedPlatforms.length === 0 || selectedPlatforms.some((p) => p === "android" || p === "mobile-android");

    const rawWebTestCases = (runWeb && existsSync(webDir)) ? loadTestCasesFromDir(webDir) : [];
    const rawIosTestCases = (runIos && existsSync(iosDir)) ? loadTestCasesFromDir(iosDir).map((tc) => ({ ...tc, platform: "ios" })) : [];
    const rawAndroidTestCases = (runAndroid && existsSync(androidDir)) ? loadTestCasesFromDir(androidDir).map((tc) => ({ ...tc, platform: "android" })) : [];

    const rootTestCases = (runWeb && rawWebTestCases.length === 0 && rawIosTestCases.length === 0 && rawAndroidTestCases.length === 0)
      ? loadTestCasesFromDir(dirPath)
      : [];

    allWebTestCases = [...rawWebTestCases, ...rootTestCases].map((tc) => ({ ...tc, platform: "web" }));
    iosTestCases = rawIosTestCases;
    androidTestCases = rawAndroidTestCases;
  }

  const combinedPlatforms: string[] = [];
  if (allWebTestCases.length > 0) combinedPlatforms.push("web");
  if (iosTestCases.length > 0) combinedPlatforms.push("ios");
  if (androidTestCases.length > 0) combinedPlatforms.push("android");

  const combinedTestCases = [...allWebTestCases, ...iosTestCases, ...androidTestCases];
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
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        title: `Suite Run (${combinedPlatforms.join(", ")})`,
        platforms: combinedPlatforms,
        total_test_cases: totalCount,
      }),
    });
    if (initRes.ok) {
      const initData = await initRes.json();
      if (initData.success && initData.data?.id) {
        executionId = initData.data.id;
      }
    }
  } catch (_) {}

  const renderer = new LiveReportRenderer(combinedTestCases);
  if (executionId) {
    renderer.setExecutionId(executionId);
  }
  renderer.render();

  let exitCode = 0;

  // 1. Run Web Tests
  if (allWebTestCases.length > 0) {
    const clientId = await fetchServerClientId(apiKey);
    const secrets = loadLocalSecrets(dirPath);
    const client = new ZeniProxyClient({
      serverUrl: WS_BASE_URL,
      clientId,
      chromePort: 9222,
      headless: true,
      secrets,
    });

    try {
      await client.start();
      const parallel = Number(options.parallel || options.p || options.concurrency || options.c || 5);
      const response = await fetch(`${API_BASE_URL}/api/executions/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "Authorization": `Bearer ${apiKey}`,
          "x-stream": "true",
        },
        body: JSON.stringify({ executionId, clientId, testCases: allWebTestCases, parallel, platform: "web", platforms: ["web"] }),
      });

      if (response.ok && response.body) {
        const reader = (response.body as ReadableStream<Uint8Array>).getReader();
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
              }
              else if (msg.type === "step_progress") renderer.updateStep(msg.testCaseId, msg.stepIndex, msg.totalSteps, msg.stepType, msg.description);
              else if (msg.type === "test_complete") renderer.completeTest(msg.testCaseId, msg.status, msg.durationMs, msg.error);
              else if (msg.type === "execution_complete") {
                if (msg.failedCount > 0) exitCode = 1;
              }
            } catch {}
          }
        }
      }
    } finally {
      client.stop();
    }
  }

  // 2. Run Mobile iOS Tests
  if (iosTestCases.length > 0) {
    const iosAppPath = options.bundle || options.b || options["app-ios"] || resolve(process.cwd(), "sample-apps/flutter_sample_app/build/ios/ipa/Runner.ipa");
    if (!existsSync(iosAppPath)) {
      console.warn(`[Warning] iOS binary not found at ${iosAppPath}. Build Runner.ipa first.`);
    } else {
      const secrets = loadLocalSecrets(dirPath);
      const formData = new FormData();
      const fileData = readFileSync(iosAppPath);
      formData.append("appFile", new Blob([fileData]), basename(iosAppPath));
      formData.append("platform", "ios");
      formData.append("testCases", JSON.stringify(iosTestCases));
      if (executionId) formData.append("executionId", executionId);
      if (secrets.AWS_PROJECT_ARN || process.env.AWS_PROJECT_ARN) {
        formData.append("awsProjectArn", secrets.AWS_PROJECT_ARN || process.env.AWS_PROJECT_ARN || "");
      }

      const res = await fetch(`${API_BASE_URL}/api/executions/mobile`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Authorization": `Bearer ${apiKey}`,
          "x-stream": "true",
        },
        body: formData,
      });

      if (res.ok && res.body) {
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
              }
              else if (msg.type === "step_progress") renderer.updateStep(msg.testCaseId, msg.stepIndex, msg.totalSteps, msg.stepType, msg.description);
              else if (msg.type === "test_complete") renderer.completeTest(msg.testCaseId, msg.status, msg.durationMs);
              else if (msg.type === "execution_complete") {
                if (msg.failedCount > 0) exitCode = 1;
              }
            } catch {}
          }
        }
      } else {
        const data: any = await res.json().catch(() => ({}));
        if (!data.success) exitCode = 1;
      }
    }
  }

  // 3. Run Mobile Android Tests
  if (androidTestCases.length > 0) {
    const androidAppPath = options.bundle || options.b || options["app-android"] || resolve(process.cwd(), "sample-apps/flutter_sample_app/build/app/outputs/flutter-apk/app-debug.apk");
    if (!existsSync(androidAppPath)) {
      console.warn(`[Warning] Android binary not found at ${androidAppPath}. Build app-debug.apk first.`);
    } else {
      const secrets = loadLocalSecrets(dirPath);
      const formData = new FormData();
      const fileData = readFileSync(androidAppPath);
      formData.append("appFile", new Blob([fileData]), basename(androidAppPath));
      formData.append("platform", "android");
      formData.append("testCases", JSON.stringify(androidTestCases));
      if (executionId) formData.append("executionId", executionId);
      if (secrets.AWS_PROJECT_ARN || process.env.AWS_PROJECT_ARN) {
        formData.append("awsProjectArn", secrets.AWS_PROJECT_ARN || process.env.AWS_PROJECT_ARN || "");
      }

      const res = await fetch(`${API_BASE_URL}/api/executions/mobile`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Authorization": `Bearer ${apiKey}`,
          "x-stream": "true",
        },
        body: formData,
      });

      if (res.ok && res.body) {
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
              }
              else if (msg.type === "step_progress") renderer.updateStep(msg.testCaseId, msg.stepIndex, msg.totalSteps, msg.stepType, msg.description);
              else if (msg.type === "test_complete") renderer.completeTest(msg.testCaseId, msg.status, msg.durationMs);
              else if (msg.type === "execution_complete") {
                if (msg.failedCount > 0) exitCode = 1;
              }
            } catch {}
          }
        }
      } else {
        const data: any = await res.json().catch(() => ({}));
        if (!data.success) exitCode = 1;
      }
    }
  }

  if (executionId) {
    try {
      await fetch(`${API_BASE_URL}/api/executions/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ executionId }),
      });
    } catch (_) {}
  }

  renderer.render(true);

  if (executionId) {
    console.log();
    console.log(`\x1b[90mView execution report:\x1b[0m \x1b[4;36m${APP_BASE_URL}/runs/${executionId}\x1b[0m`);
    console.log();
  }

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

async function runReport(options: Record<string, any>) {
  const apiKey = await getApiKey();
  const runArg = options._[1] || options.run || options.id || options.number;

  if (!runArg) {
    console.error("\x1b[1;31mError: Missing required run_number argument.\x1b[0m");
    console.log("Usage: zenitest report <run_number> (e.g. zenitest report 21)");
    process.exit(1);
  }

  const res = await fetch(`${API_BASE_URL}/api/executions/${runArg}`, {
    headers: {
      "x-api-key": apiKey,
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    console.error(`\x1b[1;31mError fetching report for run "${runArg}": ${errData.error || res.statusText}\x1b[0m`);
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

    const testCaseId = d.info?.specFile || (d.test_case_id ? (d.test_case_id.endsWith(".yaml") || d.test_case_id.endsWith(".yml") ? d.test_case_id : `${d.test_case_id}.yaml`) : "test.yaml");
    const status = (d.status || "pending").toUpperCase();
    const durationMs = d.duration_ms || 0;
    const durationFormatted = (durationMs / 1000).toFixed(2) + "s";

    const allSteps = (d.step_reports || []).filter((s: any) => s.type !== "__meta__");
    const numberSteps = allSteps.length;

    let failedAtStepStr = "-";
    if (status === "FAILED") {
      const failedStepIndex = allSteps.findIndex((s: any) => s.success === false || s.status === "failed");
      if (failedStepIndex !== -1) {
        const stepObj = allSteps[failedStepIndex];
        const stepNum = stepObj.index || failedStepIndex + 1;
        const stepDesc = stepObj.description || stepObj.actionType || stepObj.type || "";
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
        analysisStr = ba.summary || ba.rootCause || ba.recommendation || JSON.stringify(ba);
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
    console.log(JSON.stringify({
      executionId: exec.id,
      runNumber: exec.number || exec.run_number || runArg,
      title: exec.title,
      status: exec.status,
      totalTests: exec.total_test_cases || reportItems.length,
      passedTests: exec.passed_test_cases || reportItems.filter((i: any) => i.status === "PASSED").length,
      failedTests: exec.failed_test_cases || reportItems.filter((i: any) => i.status === "FAILED").length,
      totalDurationMs: exec.total_duration_ms || 0,
      testCases: reportItems,
    }, null, 2));
    return;
  }

  const cols = process.stdout.columns || 80;
  const termWidth = Math.max(60, Math.min(cols, 100));
  const separator = "\x1b[90m" + "─".repeat(termWidth) + "\x1b[0m";

  const runNumStr = exec.number || exec.run_number || runArg;
  const statusColor = exec.status === "completed" || exec.status === "passed"
    ? "\x1b[1;32mPASSED\x1b[0m"
    : exec.status === "failed"
    ? "\x1b[1;31mFAILED\x1b[0m"
    : "\x1b[1;33mRUNNING\x1b[0m";

  console.log(`\x1b[1mZeniTest \x1b[90m›\x1b[0m Execution Report \x1b[1;36m#${runNumStr}\x1b[0m`);
  console.log(separator);
  console.log(`\x1b[90mExecution ID:\x1b[0m ${exec.id}`);
  console.log(`\x1b[90mStatus:\x1b[0m       ${statusColor} \x1b[90m·\x1b[0m ${exec.passed_test_cases || 0} Passed \x1b[90m·\x1b[0m ${exec.failed_test_cases || 0} Failed \x1b[90m·\x1b[0m ${reportItems.length} Total`);
  if (exec.total_duration_ms) {
    console.log(`\x1b[90mDuration:\x1b[0m     ${(exec.total_duration_ms / 1000).toFixed(2)}s`);
  }
  console.log(separator);
  console.log();

  reportItems.forEach((item: any, idx: number) => {
    const statusFormatted = item.status === "PASSED"
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
  console.log(`\x1b[90mView details:\x1b[0m \x1b[4;36m${APP_BASE_URL}/runs/${exec.id}\x1b[0m`);
  console.log();
}

async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help || args.length === 0) {
    showHelp();
    process.exit(0);
  }

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
