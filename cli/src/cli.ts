#!/usr/bin/env bun

import { ZeniProxyClient } from "./proxyClient";
import { readdirSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync } from "fs";
import { join, resolve } from "path";
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
  auth [api_key]   Authenticate CLI with API key (prompts if omitted)
  client           Start the browser proxy client and establish CDP tunnel
  run              Read test cases from a folder and run them via the server

Options:
  --dir, -d       Directory containing test cases (defaults to zeni_tests)
  --parallel, -p  Number of test cases to run in parallel (defaults to 5)
  --help, -h      Show this help message
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
  if (options.p) options.parallel = options.p;
  if (options.c) options.parallel = options.c;
  if (options.h) options.help = options.h;

  return options;
}

const API_BASE_URL = process.env.ZENITEST_API_URL || process.env.API_URL || "http://localhost:3001";
const WS_BASE_URL = process.env.ZENITEST_WS_URL || process.env.WS_URL || "ws://localhost:3001";

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
  title: string;
  status: "⏳ PENDING" | "🏃 RUNNING" | "✅ PASSED" | "❌ FAILED";
  currentStep: string;
  durationMs: number;
}

function visibleLength(str: string): number {
  return str.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function truncateToWidth(str: string, width: number): string {
  const vis = visibleLength(str);
  if (vis <= width) return str;
  let curLen = 0;
  let result = "";
  let inAnsi = false;

  for (let i = 0; i < str.length; i++) {
    if (str[i] === "\x1b") {
      inAnsi = true;
    }
    result += str[i];
    if (!inAnsi) {
      curLen++;
      if (curLen >= width - 3) {
        result += "...";
        break;
      }
    }
    if (inAnsi && str[i] === "m") {
      inAnsi = false;
    }
  }
  return result;
}

class LiveReportRenderer {
  private executionId: string = "";
  private rows: Map<string, LiveTestCaseState> = new Map();
  private lastLineCount: number = 0;

  constructor(testCases: { id: string; title: string }[]) {
    for (const tc of testCases) {
      this.rows.set(tc.id, {
        id: tc.id,
        title: tc.title,
        status: "⏳ PENDING",
        currentStep: "Queued",
        durationMs: 0,
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
      row.status = "🏃 RUNNING";
      const shortDesc = description.length > 60 ? description.slice(0, 57) + "..." : description;
      row.currentStep = `[${stepIndex}/${totalSteps}] ${stepType.toUpperCase()}: ${shortDesc}`;
    }
    this.render();
  }

  public completeTest(testCaseId: string, status: "PASSED" | "FAILED", durationMs: number) {
    const row = this.rows.get(testCaseId);
    if (row) {
      row.status = status === "PASSED" ? "✅ PASSED" : "❌ FAILED";
      row.durationMs = durationMs;
    }
    this.render();
  }

  public render(isFinal: boolean = false) {
    if (this.lastLineCount > 0) {
      process.stdout.write(`\x1b[${this.lastLineCount}A\x1b[0J`);
    }

    const cols = process.stdout.columns || 110;
    const termWidth = Math.max(80, Math.min(cols, 130));
    const border = "=".repeat(termWidth);
    const dashBorder = "-".repeat(termWidth);

    const lines: string[] = [];
    lines.push(border);
    const titlePadding = Math.max(0, Math.floor((termWidth - 23) / 2));
    lines.push(" ".repeat(titlePadding) + "TEST EXECUTION REPORT");
    lines.push(border);
    if (this.executionId) {
      lines.push(`Execution ID: ${this.executionId}`);
      lines.push("");
    }

    const idHeader = "Test Case ID";
    const titleHeader = "Title";
    const statusHeader = "Status";
    const stepHeader = "Current Step";
    const durationHeader = "Duration";

    const rowList = Array.from(this.rows.values());
    const maxIdLen = 14;
    const maxTitleLen = 26;
    const maxStatusLen = 10;
    const maxDurationLen = 9;
    const fixedWidths = maxIdLen + maxTitleLen + maxStatusLen + maxDurationLen + 16;
    const maxStepLen = Math.max(30, termWidth - fixedWidths);

    const padTrunc = (str: string, len: number) => {
      const vis = visibleLength(str);
      if (vis > len) {
        return truncateToWidth(str, len);
      }
      return str + " ".repeat(len - vis);
    };

    const headerRow = `| ${padTrunc(idHeader, maxIdLen)} | ${padTrunc(titleHeader, maxTitleLen)} | ${padTrunc(statusHeader, maxStatusLen)} | ${padTrunc(stepHeader, maxStepLen)} | ${padTrunc(durationHeader, maxDurationLen)} |`;
    const sep = `|-${"-".repeat(maxIdLen)}-|-` + `${"-".repeat(maxTitleLen)}-|-` + `${"-".repeat(maxStatusLen)}-|-` + `${"-".repeat(maxStepLen)}-|-` + `${"-".repeat(maxDurationLen)}-|`;

    lines.push(headerRow);
    lines.push(sep);

    for (const r of rowList) {
      let statusFormatted = r.status as string;
      if (r.status === "✅ PASSED") statusFormatted = "\x1b[1;32m✅ PASSED\x1b[0m";
      else if (r.status === "❌ FAILED") statusFormatted = "\x1b[1;31m❌ FAILED\x1b[0m";
      else if (r.status === "🏃 RUNNING") statusFormatted = "\x1b[1;33m🏃 RUNNING\x1b[0m";
      else statusFormatted = "\x1b[1;30m⏳ PENDING\x1b[0m";

      const durationText = `${r.durationMs} ms`;
      lines.push(`| ${padTrunc(r.id, maxIdLen)} | ${padTrunc(r.title, maxTitleLen)} | ${padTrunc(statusFormatted, maxStatusLen)} | ${padTrunc(r.currentStep, maxStepLen)} | ${padTrunc(durationText, maxDurationLen)} |`);
    }

    lines.push(dashBorder);
    const total = rowList.length;
    const passed = rowList.filter((r) => r.status === "✅ PASSED").length;
    const failed = rowList.filter((r) => r.status === "❌ FAILED").length;
    const running = rowList.filter((r) => r.status === "🏃 RUNNING").length;
    const pending = rowList.filter((r) => r.status === "⏳ PENDING").length;

    if (isFinal) {
      lines.push(`Total tests run: ${total}`);
      lines.push(`Passed:          \x1b[1;32m${passed}\x1b[0m`);
      lines.push(`Failed:          ${failed > 0 ? `\x1b[1;31m${failed}\x1b[0m` : `0`}`);
    } else {
      lines.push(`Summary: Total ${total} | Passed: ${passed} | Failed: ${failed} | Running: ${running} | Pending: ${pending}`);
    }
    lines.push(border);

    const output = lines.join("\n") + "\n";
    process.stdout.write(output);
    this.lastLineCount = (output.match(/\n/g) || []).length;
  }
}

async function runTests(options: Record<string, any>) {
  const apiKey = await getApiKey();
  const dirName = options.dir || "zeni_tests";
  const dirPath = resolve(process.cwd(), dirName);

  if (!existsSync(dirPath)) {
    console.error(`\x1b[1;31mError: Directory "${dirPath}" does not exist.\x1b[0m`);
    process.exit(1);
  }

  const files = readdirSync(dirPath).filter(
    (file) => file.endsWith(".yaml") || file.endsWith(".yml") || file.endsWith(".json")
  );
  if (files.length === 0) {
    console.log(`No test case files (.yaml, .yml, .json) found in "${dirPath}".`);
    process.exit(0);
  }

  const testCases: any[] = [];
  for (const file of files) {
    const filePath = join(dirPath, file);
    try {
      const content = readFileSync(filePath, "utf-8");
      let testCase: any;
      if (file.endsWith(".yaml") || file.endsWith(".yml")) {
        testCase = parseYaml(content);
      } else {
        testCase = JSON.parse(content);
      }

      if (testCase && testCase.id && testCase.title && Array.isArray(testCase.steps)) {
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

  if (testCases.length === 0) {
    console.error(`\x1b[1;31mError: No valid test cases found in "${dirPath}".\x1b[0m`);
    process.exit(1);
  }

  const clientId = await fetchServerClientId(apiKey);

  const secrets = loadLocalSecrets(dirPath);
  const client = new ZeniProxyClient({
    serverUrl: WS_BASE_URL,
    clientId,
    chromePort: 9222,
    headless: true,
    secrets,
  });

  let exitCode = 0;

  try {
    await client.start();
    console.log(`Found ${testCases.length} test case(s) in "${dirPath}".\n`);

    const renderer = new LiveReportRenderer(testCases);
    renderer.render();

    const parallel = Number(options.parallel || options.p || options.concurrency || options.c || 5);

    const response = await fetch(`${API_BASE_URL}/api/executions/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "Authorization": `Bearer ${apiKey}`,
        "x-stream": "true",
      },
      body: JSON.stringify({
        clientId,
        testCases,
        parallel,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Server returned error status ${response.status}: ${errText}`);
    }

    if (response.body) {
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
            if (msg.type === "init") {
              renderer.setExecutionId(msg.executionId);
            } else if (msg.type === "step_progress") {
              renderer.updateStep(
                msg.testCaseId,
                msg.stepIndex,
                msg.totalSteps,
                msg.stepType,
                msg.description
              );
            } else if (msg.type === "test_complete") {
              renderer.completeTest(
                msg.testCaseId,
                msg.status,
                msg.durationMs,
                msg.error
              );
            } else if (msg.type === "execution_complete") {
              renderer.render(true);
              exitCode = msg.failedCount > 0 ? 1 : 0;
            }
          } catch {}
        }
      }

      if (buffer.trim()) {
        try {
          const msg = JSON.parse(buffer.trim());
          if (msg.type === "init") {
            renderer.setExecutionId(msg.executionId);
          } else if (msg.type === "step_progress") {
            renderer.updateStep(
              msg.testCaseId,
              msg.stepIndex,
              msg.totalSteps,
              msg.stepType,
              msg.description
            );
          } else if (msg.type === "test_complete") {
            renderer.completeTest(
              msg.testCaseId,
              msg.status,
              msg.durationMs,
              msg.error
            );
          } else if (msg.type === "execution_complete") {
            renderer.render(true);
            exitCode = msg.failedCount > 0 ? 1 : 0;
          }
        } catch {}
      }
    }
  } catch (err: any) {
    console.error(`\x1b[1;31mExecution failed: ${err.message}\x1b[0m`);
    exitCode = 1;
  } finally {
    client.stop();
  }

  process.exit(exitCode);
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
