import { ZeniServer } from "./server";
import { ZeniProxyClient } from "../../cli/src/proxyClient";
import { TestCase } from "./types";

async function main() {
  console.log("==========================================================");
  console.log("    Zeni CDP WS Proxy Integration Verification       ");
  console.log("==========================================================\n");

  const port = 3000;
  const clientId = "test-client-integration";

  // 1. Start Server
  console.log("[Integration Test] 1. Starting Zeni WS Server...");
  const server = new ZeniServer(port);
  await server.start();

  // 2. Start Client CLI (launching Chrome headless and establishing CDP pipe)
  console.log("[Integration Test] 2. Starting Proxy Client CLI...");
  const client = new ZeniProxyClient({
    serverUrl: `ws://localhost:${port}`,
    clientId,
    chromePort: 9222,
    headless: true,
  });
  await client.start();

  // Wait a brief moment to ensure sockets are fully upgraded and bridged
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // 3. Define inline Test Case
  const testCase: TestCase = {
    id: "tc_example",
    title: "Example Domain Verification",
    prodURL: "https://example.com",
    steps: [
      {
        index: 1,
        type: "navigate" as const,
        description: "https://example.com",
      },
      {
        index: 2,
        type: "validate" as const,
        description: "Verify that the page header has the text 'Example Domain'",
      },
    ],
    variables: {},
  };

  try {
    // 4. Dispatch Test Case to Server
    console.log("[Integration Test] 3. Dispatching Test Case to Server API...");
    const response = await fetch(`http://localhost:${port}/api/run-test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        testCase,
        clientId,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Server returned error status ${response.status}: ${errText}`);
    }

    const report = await response.json();
    console.log("\n==========================================================");
    console.log("             TEST EXECUTION REPORT RECEIVED               ");
    console.log("==========================================================");
    console.log(`TestCase ID: ${report.testCaseId}`);
    console.log(`Title:       "${report.title}"`);
    console.log(`Success:     ${report.overallSuccess ? "✅ YES" : "❌ NO"}`);
    console.log(`Duration:    ${report.totalExecutionTimeMs} ms`);
    console.log(`Tokens Used: ${report.totalTokensUsed}`);
    console.log("----------------------------------------------------------");
    for (const step of report.stepReports) {
      console.log(`[Step ${step.index}] ${step.type.toUpperCase()}: ${step.description}`);
      console.log(`  Success:     ${step.success ? "✅ PASSED" : "❌ FAILED"}`);
      console.log(`  Explanation: ${step.explanation}`);
      console.log(`  Duration:    ${step.executionTimeMs} ms`);
    }
    console.log("==========================================================\n");

    if (report.overallSuccess) {
      console.log("✅ INTEGRATION TEST PASSED SUCCESSFULLY!");
    } else {
      console.error("❌ INTEGRATION TEST FAILED!");
      process.exitCode = 1;
    }
  } catch (err: any) {
    console.error("❌ Integration test error occurred:", err);
    process.exitCode = 1;
  } finally {
    console.log("[Integration Test] Cleaning up client and server...");
    client.stop();
    await server.stop();
    console.log("[Integration Test] Done.");
  }
}

main().catch((err) => {
  console.error("Fatal integration error:", err);
  process.exit(1);
});
