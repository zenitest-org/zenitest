#!/usr/bin/env bun

import { ZeniProxyClient } from "./proxyClient";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";

// Helper to show help
function showHelp() {
  console.log(`
Usage: zenitest <command> [options]

Commands:
  client       Start the browser proxy client and establish CDP tunnel
  run          Read test cases from a folder and run them via the server

Options:
  --apiKey, -k     API key for authentication (MANDATORY, or set ZENI_API_KEY)
  --server, -s     Server URL (defaults to http://localhost:3000)
  --clientId, -c   Client ID for proxy session (defaults to test-client)
  --userId, -u     User ID for execution record (optional)
  --dir, -d        Directory containing test cases (defaults to zeni_tests)
  --chromePort     Local Chrome remote debugging port (defaults to 9222)
  --headed         Run Chrome in headed mode (client only)
  --headless       Run Chrome in headless mode (client only, default)
  --help, -h       Show this help message
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
  if (options.k) options.apiKey = options.k;
  if (options.s) options.server = options.s;
  if (options.c) options.clientId = options.c;
  if (options.u) options.userId = options.u;
  if (options.d) options.dir = options.d;
  if (options.h) options.help = options.h;

  return options;
}

function getApiKey(options: Record<string, any>): string {
  const apiKey =
    options.apiKey ||
    process.env.ZENI_API_KEY ||
    process.env.ZENITEST_API_KEY ||
    process.env.API_KEY;

  if (!apiKey) {
    console.error(
      `\x1b[1;31mError: API key is mandatory. Please pass --apiKey <key> or set the ZENI_API_KEY environment variable.\x1b[0m`
    );
    process.exit(1);
  }

  return apiKey;
}

async function runClient(options: Record<string, any>) {
  const apiKey = getApiKey(options);
  const serverUrl = options.server || "ws://localhost:3000";

  // Normalize WebSocket URL
  let wsServerUrl = serverUrl;
  if (wsServerUrl.startsWith("http://")) {
    wsServerUrl = wsServerUrl.replace("http://", "ws://");
  } else if (wsServerUrl.startsWith("https://")) {
    wsServerUrl = wsServerUrl.replace("https://", "wss://");
  } else if (!wsServerUrl.startsWith("ws://") && !wsServerUrl.startsWith("wss://")) {
    wsServerUrl = `ws://${wsServerUrl}`;
  }

  const clientId = options.clientId || "test-client";
  const chromePort = Number(options.chromePort) || 9222;
  const headless = options.headless !== undefined ? options.headless : !options.headed;

  console.log(`[CLI] Starting ZeniProxyClient with:`);
  console.log(`  - Server URL:  ${wsServerUrl}`);
  console.log(`  - Client ID:   ${clientId}`);
  console.log(`  - Chrome Port: ${chromePort}`);
  console.log(`  - Headless:    ${headless}`);
  console.log(`  - API Key:     ${apiKey.slice(0, 6)}...`);

  const client = new ZeniProxyClient({
    serverUrl: wsServerUrl,
    clientId,
    chromePort,
    headless,
  });

  await client.start();

  process.on("SIGINT", () => {
    client.stop();
    process.exit(0);
  });
}

async function runTestCase(
  testCase: any,
  serverUrl: string,
  clientId: string,
  apiKey: string,
  userId?: string
) {
  // Normalize HTTP URL
  let httpUrl = serverUrl;
  if (httpUrl.startsWith("ws://")) {
    httpUrl = httpUrl.replace("ws://", "http://");
  } else if (httpUrl.startsWith("wss://")) {
    httpUrl = httpUrl.replace("wss://", "https://");
  } else if (!httpUrl.startsWith("http://") && !httpUrl.startsWith("https://")) {
    httpUrl = `http://${httpUrl}`;
  }

  const targetApiUrl = `${httpUrl.replace(/\/$/, "")}/api/executions/create`;

  console.log(`\n\x1b[1;36m[Test Run] Sending "${testCase.title}" (${testCase.id}) to server...\x1b[0m`);

  const response = await fetch(targetApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      user_id: userId,
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

function printReport(res: any): boolean {
  const execution = res.data || res;
  const details = execution.details || [];
  const detail = details[0] || {};

  const isSuccess =
    execution.status === "completed" ||
    detail.status === "passed" ||
    (execution.failed_test_cases === 0 && execution.passed_test_cases > 0);

  console.log("==========================================================");
  console.log("             TEST EXECUTION REPORT RECEIVED               ");
  console.log("==========================================================");
  console.log(`Execution ID: ${execution.id || "N/A"}`);
  console.log(`TestCase ID:  ${detail.test_case_id || detail.testCaseId || "N/A"}`);
  console.log(`Title:        "${execution.title || detail.title || "Untitled"}"`);
  console.log(`Status:       ${isSuccess ? "\x1b[1;32m✅ PASSED\x1b[0m" : "\x1b[1;31m❌ FAILED\x1b[0m"}`);
  console.log(`Duration:     ${execution.total_duration_ms || detail.duration_ms || 0} ms`);
  console.log(`Tokens Used:  ${execution.total_tokens_used || detail.tokens_used || 0}`);
  console.log("----------------------------------------------------------");

  const stepReports = detail.step_reports || detail.stepReports || [];

  if (Array.isArray(stepReports) && stepReports.length > 0) {
    for (const step of stepReports) {
      console.log(`[Step ${step.index}] ${step.type?.toUpperCase()}: ${step.description}`);
      console.log(`  Success:     ${step.success ? "\x1b[1;32m✅ PASSED\x1b[0m" : "\x1b[1;31m❌ FAILED\x1b[0m"}`);
      console.log(`  Explanation: ${step.explanation}`);
      if (step.screenshotPath) {
        console.log(`  Screenshot:  ${step.screenshotPath}`);
      }
      console.log(`  Duration:    ${step.executionTimeMs} ms`);
    }
  } else if (execution.error || detail.error_message) {
    console.log(`\x1b[1;31mError during run: ${execution.error || detail.error_message}\x1b[0m`);
  }
  console.log("==========================================================\n");

  return isSuccess;
}

async function runTests(options: Record<string, any>) {
  const apiKey = getApiKey(options);
  const serverUrl = options.server || "http://localhost:3000";
  const clientId = options.clientId || "test-client";
  const userId = options.userId;
  const dirName = options.dir || "zeni_tests";
  const dirPath = resolve(process.cwd(), dirName);

  if (!existsSync(dirPath)) {
    console.error(`\x1b[1;31mError: Directory "${dirPath}" does not exist.\x1b[0m`);
    process.exit(1);
  }

  const files = readdirSync(dirPath).filter((file) => file.endsWith(".json"));
  if (files.length === 0) {
    console.log(`No JSON test cases found in "${dirPath}".`);
    process.exit(0);
  }

  // Normalize WebSocket URL for proxy client
  let wsServerUrl = serverUrl;
  if (wsServerUrl.startsWith("http://")) {
    wsServerUrl = wsServerUrl.replace("http://", "ws://");
  } else if (wsServerUrl.startsWith("https://")) {
    wsServerUrl = wsServerUrl.replace("https://", "wss://");
  } else if (!wsServerUrl.startsWith("ws://") && !wsServerUrl.startsWith("wss://")) {
    wsServerUrl = `ws://${wsServerUrl}`;
  }

  const chromePort = Number(options.chromePort) || 9222;
  const headless = options.headless !== undefined ? options.headless : !options.headed;

  console.log(`[CLI] Spinning up inline ZeniProxyClient for test run...`);
  const client = new ZeniProxyClient({
    serverUrl: wsServerUrl,
    clientId,
    chromePort,
    headless,
  });

  let exitCode = 0;
  try {
    await client.start();
    console.log(`Found ${files.length} test case(s) in "${dirPath}".`);
    console.log(
      `Running on server: ${serverUrl} | Client ID: ${clientId} | API Key: ${apiKey.slice(0, 6)}...\n`
    );

    let totalRun = 0;
    let passed = 0;
    let failed = 0;

    for (const file of files) {
      const filePath = join(dirPath, file);
      let testCase: any;
      try {
        const content = readFileSync(filePath, "utf-8");
        testCase = JSON.parse(content);
      } catch (err: any) {
        console.error(`\x1b[1;31mFailed to read/parse test case file "${file}": ${err.message}\x1b[0m`);
        failed++;
        totalRun++;
        continue;
      }

      if (!testCase.id || !testCase.title || !testCase.steps) {
        console.error(
          `\x1b[1;31mSkip: Test case file "${file}" does not have valid structure (id, title, steps required).\x1b[0m`
        );
        failed++;
        totalRun++;
        continue;
      }

      totalRun++;
      try {
        const res = await runTestCase(testCase, serverUrl, clientId, apiKey, userId);
        if (res) {
          const isSuccess = printReport(res);
          if (isSuccess) {
            passed++;
          } else {
            failed++;
          }
        } else {
          failed++;
        }
      } catch (err: any) {
        console.error(`\x1b[1;31m❌ Execution of test "${testCase.title}" failed: ${err.message}\x1b[0m`);
        failed++;
      }
    }

    console.log("================ SUMMARY ================");
    console.log(`Total tests run: ${totalRun}`);
    console.log(`Passed:          \x1b[1;32m${passed}\x1b[0m`);
    console.log(`Failed:          ${failed > 0 ? `\x1b[1;31m${failed}\x1b[0m` : `0`}`);
    console.log("=========================================");

    if (failed > 0) {
      exitCode = 1;
    } else {
      exitCode = 0;
    }
  } catch (err: any) {
    console.error(`\x1b[1;31mFailed to start ZeniProxyClient: ${err.message}\x1b[0m`);
    exitCode = 1;
  } finally {
    console.log(`[CLI] Stopping inline ZeniProxyClient...`);
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
    case "client":
      await runClient(options);
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
