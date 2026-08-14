import { existsSync, mkdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Hono } from "hono";
import { streamText } from "hono/streaming";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { WebSocket } from "ws";
import { chromium } from "playwright-core";
import {
  supabase,
  uploadScreenshot,
  attachSignedUrlsToDetails,
  trackUserUsage,
  checkUserLimitation,
} from "../db/supabase";


import { Executor } from "../executor";
import { MobileExecutor, uploadAppBinaryToSupabase } from "../mobile-executor";
import { TestCase, TestCaseExecutionReport } from "../types";
import { authMiddleware, AuthUser } from "../middleware/auth";
import { GoogleGenAI, Type } from "@google/genai";

async function analyzeTestCaseBug(
  detailId: string,
  testTitle: string,
  status: string,
  stepReports: any[],
  networkReports: any[],
  logReports: any[],
  apiKey?: string,
): Promise<void> {
  try {
    const key = apiKey || process.env.GEMINI_API_KEY || "";
    if (!key) {
      console.warn(
        `[BugAnalyzer] Missing GEMINI_API_KEY. Setting default bug_analysis for detail ${detailId}.`,
      );
      await supabase
        .from("execution_details")
        .update({
          analyzed: true,
          bug_analysis: {
            summary:
              status === "passed"
                ? "Test case passed successfully."
                : "Test case failed during execution.",
          },
        })
        .eq("id", detailId);
      return;
    }

    const ai = new GoogleGenAI({ apiKey: key });
    const modelName =
      process.env.GEMINI_MODEL ||
      process.env.ZENI_MODEL ||
      process.env.STAGEHAND_MODEL ||
      "gemini-3.5-flash-lite";

    const cleanedSteps = (stepReports || [])
      .filter((s: any) => s.type !== "__meta__")
      .map((s: any) => ({
        index: s.index,
        type: s.type,
        description: s.description,
        success: s.success,
        explanation: s.explanation,
        error:
          s.error || s.actResult?.reasoning || s.validationResult?.explanation,
      }));

    const cleanedNetwork = (networkReports || [])
      .slice(0, 15)
      .map((n: any) => ({
        method: n.method,
        url: n.url,
        status: n.status,
        time: n.time,
      }));

    const cleanedLogs = (logReports || []).slice(-20).map((l: any) => ({
      level: l.level,
      message: l.message,
    }));

    const promptText = `You are ZeniTest AI Bug Analyzer. Analyze the following E2E test execution and generate a concise summary explaining why the test passed or failed.

Test Title: "${testTitle}"
Execution Status: ${status.toUpperCase()}

### Step Execution Reports:
${JSON.stringify(cleanedSteps, null, 2)}

### Network Traffic Context:
${JSON.stringify(cleanedNetwork, null, 2)}

### Application & System Logs:
${JSON.stringify(cleanedLogs, null, 2)}

Provide a concise summary explaining the result and any failure causes.`;

    const BUG_ANALYSIS_SCHEMA = {
      type: Type.OBJECT,
      properties: {
        summary: {
          type: Type.STRING,
          description:
            "Concise summary of the test run result, explaining why it passed or failed based on steps, network calls, and logs.",
        },
      },
      required: ["summary"],
    };

    const response = await ai.models.generateContent({
      model: modelName,
      contents: [{ role: "user", parts: [{ text: promptText }] }],
      config: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: BUG_ANALYSIS_SCHEMA,
      },
    });

    const responseText = (response.text || "{}")
      .replace(/```json\n?|\n?```/g, "")
      .trim();
    const bugAnalysisObj = JSON.parse(responseText);

    await supabase
      .from("execution_details")
      .update({
        analyzed: true,
        bug_analysis: bugAnalysisObj,
      })
      .eq("id", detailId);

    console.log(
      `[BugAnalyzer ✅] Bug analysis completed and saved for detail ${detailId}`,
    );
  } catch (err: any) {
    console.error(
      `[BugAnalyzer Warning] Error generating bug analysis for detail ${detailId}:`,
      err,
    );
    await supabase
      .from("execution_details")
      .update({
        analyzed: true,
        bug_analysis: {
          summary:
            status === "passed"
              ? "Test case passed."
              : `Test case failed: ${err.message}`,
        },
      })
      .eq("id", detailId)
      .catch(() => {});
  }
}

async function runConcurrentTasks<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workers: Promise<void>[] = [];

  const worker = async () => {
    while (index < items.length) {
      const currentIndex = index++;
      await fn(items[currentIndex], currentIndex);
    }
  };

  const limit = Math.min(Math.max(1, concurrency), items.length);
  for (let i = 0; i < limit; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
}

function sanitizeForJsonb<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") {
    return obj
      .replace(/\u0000/g, "")
      .replace(/\\u0000/g, "")
      .replace(/\\u000[0-9a-fA-F]/g, "") as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeForJsonb(item)) as unknown as T;
  }
  if (typeof obj === "object") {
    const sanitized: any = {};
    for (const key of Object.keys(obj as any)) {
      sanitized[key] = sanitizeForJsonb((obj as any)[key]);
    }
    return sanitized as T;
  }
  return obj;
}

function normalizePlatform(p?: string): string {
  if (!p) return "web";
  const lower = p.toLowerCase().trim();
  if (lower === "mobile-ios" || lower === "ios") return "ios";
  if (lower === "mobile-android" || lower === "android") return "android";
  return "web";
}

export interface ExecutionsRouteContext {
  clients: Map<string, WebSocket>;
  port: number;
}

export function createExecutionsRouter(ctx: ExecutionsRouteContext) {
  const router = new Hono();

  router.use("*", authMiddleware);

  /* ==========================================================================
     Executions Endpoints
     ========================================================================== */

  const queryExecutionsHandler = async (c: any) => {
    try {
      const authUser = c.get("user") as AuthUser;
      const userId =
        c.req.query("userId") ||
        (c.req.query("all") === "true" ? null : authUser.id);
      const status = c.req.query("status");
      const limit = Number(c.req.query("limit")) || 20;
      const offset = Number(c.req.query("offset")) || 0;

      // Use explicit projection to return only necessary fields for executions list
      let query = supabase
        .from("executions")
        .select(
          "id, number, title, status, environment, platforms, total_test_cases, passed_test_cases, failed_test_cases, skipped_test_cases, total_duration_ms, total_tokens_used, created_at, started_at, completed_at, user_id",
          { count: "exact" },
        )
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (userId) query = query.eq("user_id", userId);
      if (status) query = query.eq("status", status);

      const { data, count, error } = await query;

      if (error) {
        console.error("[Executions Route] Error querying executions:", error);
        return c.json({ success: false, error: error.message }, 500);
      }

      return c.json({
        success: true,
        data: data || [],
        meta: {
          total: count || 0,
          limit,
          offset,
        },
      });
    } catch (err: any) {
      console.error("[Executions Route] Exception querying executions:", err);
      return c.json({ success: false, error: err.message || String(err) }, 500);
    }
  };

  router.get("/", queryExecutionsHandler);
  router.get("/query", queryExecutionsHandler);

  router.get("/:id", async (c) => {
    try {
      const id = c.req.param("id");
      let execution: any = null;

      if (/^\d+$/.test(id)) {
        const num = parseInt(id, 10);
        const { data: byNum } = await supabase
          .from("executions")
          .select("*")
          .eq("number", num)
          .maybeSingle();

        if (byNum) execution = byNum;
      }

      if (!execution) {
        const { data: byId } = await supabase
          .from("executions")
          .select("*")
          .eq("id", id)
          .maybeSingle();

        if (byId) execution = byId;
      }

      if (!execution) {
        return c.json(
          { success: false, error: `Execution "${id}" not found` },
          404,
        );
      }

      const { data: detailsData } = await supabase
        .from("execution_details")
        .select("*")
        .eq("execution_id", execution.id)
        .order("created_at", { ascending: true });

      const detailsWithSignedUrls = await attachSignedUrlsToDetails(
        detailsData || [],
      );

      return c.json({
        success: true,
        data: {
          ...execution,
          details: detailsWithSignedUrls,
        },
      });
    } catch (err: any) {
      console.error("[Executions Route] Exception getting execution:", err);
      return c.json({ success: false, error: err.message || String(err) }, 500);
    }
  });

  // POST /api/executions/session - Generate a unique server-side clientId for a test execution session
  router.post("/session", async (c) => {
    try {
      const clientId = `client_${crypto.randomUUID()}`;
      return c.json({
        success: true,
        clientId,
      });
    } catch (err: any) {
      return c.json({ success: false, error: err.message || String(err) }, 500);
    }
  });

  router.post("/create", async (c) => {
    try {
      const authUser = c.get("user") as AuthUser;
      const body = await c.req.json().catch(() => ({}));
      const {
        user_id: requestUserId,
        clientId,
        title,
        environment = "production",
        platform: bodyPlatform,
        platforms: bodyPlatforms,
        executionId: requestExecutionId,
        testCase,
        testCases: rawTestCases,
        parallel: rawParallel,
        concurrency: rawConcurrency,
        metadata = {},
      } = body;

      const user_id = requestUserId || authUser.id;
      const isStream =
        c.req.header("x-stream") === "true" || c.req.query("stream") === "true";
      const parallel = Number(rawParallel || rawConcurrency) || 5;

      if (!user_id) {
        return c.json(
          { success: false, error: "Missing user identification" },
          400,
        );
      }

      const testCasesArray: TestCase[] =
        rawTestCases || (testCase ? [testCase] : []);

      // Check plan usage limitation
      if (testCasesArray.length > 0) {
        const limitCheck = await checkUserLimitation(user_id, bodyPlatform || "web");
        if (!limitCheck.allowed) {
          console.warn(`[Execution Refused 🚫] User ${user_id} exceeded limitation:`, limitCheck.reason);
          return c.json(
            {
              success: false,
              error: limitCheck.reason,
              limitExceeded: true,
              details: limitCheck,
            },
            403
          );
        }
      } else if (Array.isArray(bodyPlatforms) && bodyPlatforms.length > 0) {
        let anyAllowed = false;
        let lastReason = "";
        for (const p of bodyPlatforms) {
          const check = await checkUserLimitation(user_id, String(p));
          if (check.allowed) {
            anyAllowed = true;
            break;
          } else {
            lastReason = check.reason || "";
          }
        }
        if (!anyAllowed) {
          return c.json(
            {
              success: false,
              error: lastReason || "All requested test platforms exceed plan limits.",
              limitExceeded: true,
            },
            403
          );
        }
      }


      if (testCasesArray.length > 0 && !clientId) {
        return c.json(
          { success: false, error: "Missing clientId for test execution" },
          400,
        );
      }

      if (clientId && !ctx.clients.has(clientId)) {
        return c.json(
          {
            success: false,
            error: `No active proxy client connected for clientId: ${clientId}`,
          },
          400,
        );
      }

      const executionTitle =
        title ||
        (testCasesArray[0]?.title
          ? `Execution: ${testCasesArray[0].title}`
          : `Execution Run ${new Date().toISOString()}`);

      const executionPlatforms: string[] =
        Array.isArray(bodyPlatforms) && bodyPlatforms.length > 0
          ? bodyPlatforms.map((p: any) => normalizePlatform(String(p)))
          : [normalizePlatform(bodyPlatform)];

      let execution: any = null;
      if (requestExecutionId) {
        const { data: existing } = await supabase
          .from("executions")
          .select("*")
          .eq("id", requestExecutionId)
          .single();

        if (existing) {
          execution = existing;
          const currentPlatforms: string[] = Array.isArray(existing.platforms)
            ? existing.platforms
            : [existing.environment || "web"];
          const mergedPlatforms = Array.from(
            new Set([...currentPlatforms, ...executionPlatforms]),
          );
          await supabase
            .from("executions")
            .update({
              platforms: mergedPlatforms,
              status: "running",
            })
            .eq("id", existing.id);
          execution.platforms = mergedPlatforms;
        }
      }

      if (!execution) {
        const { data: createdExec, error: execError } = await supabase
          .from("executions")
          .insert({
            user_id,
            title: executionTitle,
            status: testCasesArray.length > 0 ? "running" : "pending",
            environment,
            platforms: executionPlatforms,
            total_test_cases: testCasesArray.length,
            metadata,
            started_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (execError || !createdExec) {
          console.error(
            "[Executions Route] Error creating execution record:",
            execError,
          );
          return c.json(
            {
              success: false,
              error: execError?.message || "Failed to create execution",
            },
            400,
          );
        }
        execution = createdExec;
      }

      if (testCasesArray.length === 0 || !clientId) {
        return c.json({ success: true, data: execution }, 201);
      }

      const wsUrl = `ws://localhost:${ctx.port}/browser/${clientId}`;

      if (isStream) {
        return streamText(c, async (stream) => {
          await stream.writeln(
            JSON.stringify({ type: "init", executionId: execution.id }),
          );
          let passedCount = 0;
          let failedCount = 0;
          let totalDurationMs = 0;

          let browser: any = null;
          try {
            browser = await chromium.connectOverCDP(wsUrl);
          } catch (connErr: any) {
            console.error("[Executions Route] CDP Connection Error:", connErr);
            await stream.writeln(
              JSON.stringify({
                type: "execution_complete",
                executionId: execution.id,
                passedCount: 0,
                failedCount: testCasesArray.length,
                totalDurationMs: 0,
                error: connErr.message || String(connErr),
              }),
            );
            return;
          }

          const executor = new Executor(wsUrl);

          await runConcurrentTasks(testCasesArray, parallel, async (tc) => {
            const tcPlatform = normalizePlatform(
              (tc as any).platform || bodyPlatform,
            );
            const { data: detailRecord } = await supabase
              .from("execution_details")
              .insert({
                execution_id: execution.id,
                test_case_id: tc.id || `tc_${Date.now()}`,
                title: tc.title || "Untitled Test Case",
                status: "running",
                platform: tcPlatform,
                target_url:
                  tc.prodURL ||
                  tc.prodUrl ||
                  tc.localURL ||
                  tc.localUrl ||
                  null,
                started_at: new Date().toISOString(),
              })
              .select()
              .single();

            const startTime = Date.now();
            let context: any = null;
            let report: TestCaseExecutionReport;

            try {
              context = await browser.newContext();
              report = await executor.runWithContext(
                tc,
                context,
                (progress) => {
                  stream.writeln(
                    JSON.stringify({
                      type: "step_progress",
                      testCaseId: tc.id || "tc",
                      title: tc.title || "Untitled",
                      ...progress,
                    }),
                  );
                },
              );
            } catch (err: any) {
              report = {
                testCaseId: tc.id || "unknown",
                title: tc.title || "Untitled",
                overallSuccess: false,
                targetURL:
                  tc.prodURL || tc.prodUrl || tc.localURL || tc.localUrl || "",
                stepReports: [],
                totalExecutionTimeMs: Date.now() - startTime,
                totalTokensUsed: 0,
                error: err.message || String(err),
              };
            } finally {
              if (context) await context.close().catch(() => {});
            }

            const durationMs =
              report.totalExecutionTimeMs || Date.now() - startTime;
            if (report.overallSuccess) passedCount++;
            else failedCount++;
            totalDurationMs += durationMs;

            const processedStepReports: any[] = [];
            for (const stepReport of report.stepReports || []) {
              const reportCopy = { ...stepReport };
              if (reportCopy.screenshotBase64) {
                const uploadResult = await uploadScreenshot(
                  execution.id,
                  tc.id || "tc",
                  reportCopy.index,
                  reportCopy.screenshotBase64,
                );
                if (uploadResult) {
                  reportCopy.screenshotPath = uploadResult.path;
                }
                delete reportCopy.screenshotBase64;
              }
              processedStepReports.push(reportCopy);
            }

            const metaItem = {
              type: "__meta__",
              networkReports: report.networkReports || [],
              logReports: report.logReports || [],
              info: report.info || {
                specFile: tc.id ? `${tc.id}.yaml` : "test.yaml",
                browser: "Chromium 124.0",
                duration: `${(durationMs / 1000).toFixed(1)}s`,
                url:
                  tc.prodURL ||
                  tc.prodUrl ||
                  tc.localURL ||
                  tc.localUrl ||
                  execution.target_url ||
                  "—",
              },
            };
            const processedStepReportsWithMeta = [
              ...processedStepReports,
              metaItem,
            ];

            if (detailRecord) {
              const updateData: any = sanitizeForJsonb({
                status: report.overallSuccess ? "passed" : "failed",
                duration_ms: durationMs,
                step_reports: processedStepReportsWithMeta,
                network_reports: report.networkReports || [],
                log_reports: report.logReports || [],
                info: report.info || metaItem.info,
                error_message: report.error || null,
                completed_at: new Date().toISOString(),
              });

              const { error: updateErr } = await supabase
                .from("execution_details")
                .update(updateData)
                .eq("id", detailRecord.id);

              if (updateErr) {
                console.error(
                  "[Executions Route] Supabase update warning:",
                  updateErr.message,
                );
                await supabase
                  .from("execution_details")
                  .update({
                    status: report.overallSuccess ? "passed" : "failed",
                    duration_ms: durationMs,
                    step_reports: processedStepReportsWithMeta,
                    error_message: report.error || null,
                    completed_at: new Date().toISOString(),
                  })
                  .eq("id", detailRecord.id);
              }

              analyzeTestCaseBug(
                detailRecord.id,
                tc.title || "Untitled Test Case",
                report.overallSuccess ? "passed" : "failed",
                processedStepReports,
                report.networkReports || [],
                report.logReports || [],
                authUser.geminiApiKey,
              ).catch((e) => console.error("[BugAnalysis Error]:", e));
            }

            await stream.writeln(
              JSON.stringify({
                type: "test_complete",
                testCaseId: tc.id || "tc",
                title: tc.title || "Untitled",
                status: report.overallSuccess ? "PASSED" : "FAILED",
                durationMs,
                error: report.error,
              }),
            );
          });

          await browser.close().catch(() => {});

          await supabase
            .from("executions")
            .update({
              status: failedCount > 0 ? "failed" : "completed",
              passed_test_cases: passedCount,
              failed_test_cases: failedCount,
              total_duration_ms: totalDurationMs,
              completed_at: new Date().toISOString(),
            })
            .eq("id", execution.id);

          await trackUserUsage(user_id, "web", totalDurationMs);


          await stream.writeln(
            JSON.stringify({
              type: "execution_complete",
              executionId: execution.id,
              passedCount,
              failedCount,
              totalDurationMs,
            }),
          );
        });
      }

      let passedCount = 0;
      let failedCount = 0;
      let totalDurationMs = 0;
      let totalTokens = 0;

      let browser: any = null;
      try {
        browser = await chromium.connectOverCDP(wsUrl);
      } catch (connErr: any) {
        console.error("[Executions Route] CDP Connection Error:", connErr);
        await supabase
          .from("executions")
          .update({
            status: "failed",
            completed_at: new Date().toISOString(),
          })
          .eq("id", execution.id);
        return c.json(
          { success: false, error: connErr.message || String(connErr) },
          500,
        );
      }

      const executor = new Executor(wsUrl);

      await runConcurrentTasks(testCasesArray, parallel, async (tc) => {
        const tcPlatform = normalizePlatform(
          (tc as any).platform || bodyPlatform,
        );
        const { data: detailRecord, error: detailErr } = await supabase
          .from("execution_details")
          .insert({
            execution_id: execution.id,
            test_case_id: tc.id || `tc_${Date.now()}`,
            title: tc.title || "Untitled Test Case",
            status: "running",
            platform: tcPlatform,
            target_url:
              tc.prodURL || tc.prodUrl || tc.localURL || tc.localUrl || null,
            started_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (detailErr || !detailRecord) return;

        const startTime = Date.now();
        let context: any = null;
        let report: TestCaseExecutionReport;
        try {
          context = await browser.newContext();
          report = await executor.runWithContext(tc, context);
        } catch (runErr: any) {
          report = {
            testCaseId: tc.id || "unknown",
            title: tc.title || "Untitled",
            overallSuccess: false,
            targetURL:
              tc.prodURL || tc.prodUrl || tc.localURL || tc.localUrl || "",
            stepReports: [],
            totalExecutionTimeMs: Date.now() - startTime,
            totalTokensUsed: 0,
            error: runErr.message || String(runErr),
          };
        } finally {
          if (context) await context.close().catch(() => {});
        }

        const endTime = Date.now();
        const durationMs = report.totalExecutionTimeMs || endTime - startTime;
        const tokensUsed = report.totalTokensUsed || 0;
        const isSuccess = report.overallSuccess;

        if (isSuccess) passedCount++;
        else failedCount++;

        totalDurationMs += durationMs;
        totalTokens += tokensUsed;

        const processedStepReports: any[] = [];
        for (const stepReport of report.stepReports || []) {
          const reportCopy = { ...stepReport };
          if (reportCopy.screenshotBase64) {
            const uploadResult = await uploadScreenshot(
              execution.id,
              tc.id || "tc",
              reportCopy.index,
              reportCopy.screenshotBase64,
            );
            if (uploadResult) {
              reportCopy.screenshotPath = uploadResult.path;
            }
            delete reportCopy.screenshotBase64;
          }
          processedStepReports.push(reportCopy);
        }

        const metaItem = {
          type: "__meta__",
          networkReports: report.networkReports || [],
          logReports: report.logReports || [],
          info: report.info || {
            specFile: tc.id ? `${tc.id}.yaml` : "test.yaml",
            browser: "Chromium 124.0",
            duration: `${(durationMs / 1000).toFixed(1)}s`,
            url:
              tc.prodURL ||
              tc.prodUrl ||
              tc.localURL ||
              tc.localUrl ||
              execution.target_url ||
              "—",
          },
        };
        const processedStepReportsWithMeta = [
          ...processedStepReports,
          metaItem,
        ];

        const updateData: any = sanitizeForJsonb({
          status: isSuccess ? "passed" : "failed",
          duration_ms: durationMs,
          step_reports: processedStepReportsWithMeta,
          network_reports: report.networkReports || [],
          log_reports: report.logReports || [],
          info: report.info || metaItem.info,
          error_message: report.error || null,
          completed_at: new Date().toISOString(),
        });

        const { error: updateErr } = await supabase
          .from("execution_details")
          .update(updateData)
          .eq("id", detailRecord.id);

        analyzeTestCaseBug(
          detailRecord.id,
          tc.title || "Untitled Test Case",
          isSuccess ? "passed" : "failed",
          processedStepReports,
          report.networkReports || [],
          report.logReports || [],
          authUser.geminiApiKey,
        ).catch((e) => console.error("[BugAnalysis Error]:", e));

        if (updateErr) {
          console.error(
            "[Executions Route] Supabase update warning:",
            updateErr.message,
          );
          await supabase
            .from("execution_details")
            .update({
              status: isSuccess ? "passed" : "failed",
              duration_ms: durationMs,
              step_reports: processedStepReportsWithMeta,
              error_message: report.error || null,
              completed_at: new Date().toISOString(),
            })
            .eq("id", detailRecord.id);
        }
      });

      await browser.close().catch(() => {});

      const overallStatus = failedCount > 0 ? "failed" : "completed";
      const { data: updatedExecution } = await supabase
        .from("executions")
        .update({
          status: overallStatus,
          passed_test_cases: passedCount,
          failed_test_cases: failedCount,
          total_duration_ms: totalDurationMs,
          completed_at: new Date().toISOString(),
        })
        .eq("id", execution.id)
        .select()
        .single();

      await trackUserUsage(user_id, "web", totalDurationMs);


      const { data: finalDetails } = await supabase
        .from("execution_details")
        .select("*")
        .eq("execution_id", execution.id)
        .order("created_at", { ascending: true });

      return c.json(
        {
          success: true,
          data: {
            ...(updatedExecution || execution),
            details: finalDetails || [],
          },
        },
        201,
      );
    } catch (err: any) {
      console.error(
        "[Executions Route] Exception in POST /api/executions/create:",
        err,
      );
      return c.json({ success: false, error: err.message || String(err) }, 500);
    }
  });

  /* ==========================================================================
     Execution Details Endpoints
     ========================================================================== */

  // GET /api/executions/details/query - List details for an execution (supports ?executionId=...)
  const queryDetailsHandler = async (c: any) => {
    try {
      const executionId =
        c.req.param("executionId") || c.req.query("executionId");

      if (!executionId) {
        return c.json(
          { success: false, error: "Missing required executionId parameter" },
          400,
        );
      }

      const { data, error } = await supabase
        .from("execution_details")
        .select("*")
        .eq("execution_id", executionId)
        .order("created_at", { ascending: true });

      if (error) {
        console.error(
          "[Executions Route] Error querying execution details:",
          error,
        );
        return c.json({ success: false, error: error.message }, 500);
      }

      const detailsWithSignedUrls = await attachSignedUrlsToDetails(data || []);

      return c.json({ success: true, data: detailsWithSignedUrls });
    } catch (err: any) {
      console.error(
        "[Executions Route] Exception querying execution details:",
        err,
      );
      return c.json({ success: false, error: err.message || String(err) }, 500);
    }
  };
  router.get("/details/query", queryDetailsHandler);
  router.get("/details/query/:executionId", queryDetailsHandler);

  // GET /api/executions/details/get/:detailId - Get single execution detail by ID
  router.get("/details/get/:detailId", async (c) => {
    try {
      const detailId = c.req.param("detailId");

      const { data, error } = await supabase
        .from("execution_details")
        .select("*")
        .eq("id", detailId)
        .single();

      if (error || !data) {
        return c.json(
          { success: false, error: "Execution detail not found" },
          404,
        );
      }

      return c.json({ success: true, data });
    } catch (err: any) {
      console.error(
        "[Executions Route] Exception getting execution detail:",
        err,
      );
      return c.json({ success: false, error: err.message || String(err) }, 500);
    }
  });

  // POST /api/executions/details/create - Create an execution detail record
  router.post("/details/create", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const {
        execution_id,
        test_case_id,
        title,
        status = "pending",
        platform: rawPlatform,
        target_url,
        duration_ms = 0,
        tokens_used = 0,
        step_reports = [],
        network_reports = [],
        log_reports = [],
        info = {},
        error_message,
      } = body;

      if (!execution_id || !test_case_id || !title) {
        return c.json(
          {
            success: false,
            error:
              "Missing required fields: execution_id, test_case_id, and title",
          },
          400,
        );
      }

      // Process step_reports if screenshots are passed as base64
      const processedStepReports: any[] = [];
      for (const stepReport of step_reports || []) {
        const reportCopy = { ...stepReport };
        if (reportCopy.screenshotBase64) {
          const uploadResult = await uploadScreenshot(
            execution_id,
            test_case_id,
            reportCopy.index || 0,
            reportCopy.screenshotBase64,
          );
          if (uploadResult) {
            reportCopy.screenshotPath = uploadResult.path;
          }
          delete reportCopy.screenshotBase64;
        }
        processedStepReports.push(reportCopy);
      }

      const { data, error } = await supabase
        .from("execution_details")
        .insert({
          execution_id,
          test_case_id,
          title,
          status,
          platform: normalizePlatform(rawPlatform),
          target_url,
          duration_ms,
          step_reports: processedStepReports,
          network_reports,
          log_reports,
          info,
          error_message,
          started_at: status === "running" ? new Date().toISOString() : null,
        })
        .select()
        .single();

      if (error) {
        console.error(
          "[Executions Route] Error creating execution detail:",
          error,
        );
        return c.json({ success: false, error: error.message }, 400);
      }

      return c.json({ success: true, data }, 201);
    } catch (err: any) {
      console.error(
        "[Executions Route] Exception creating execution detail:",
        err,
      );
      return c.json({ success: false, error: err.message || String(err) }, 500);
    }
  });

  // POST /api/executions/complete - Complete execution and update aggregated metrics
  router.post("/complete", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const { executionId } = body;

      if (!executionId) {
        return c.json(
          { success: false, error: "Missing required executionId parameter" },
          400,
        );
      }

      const { data: details } = await supabase
        .from("execution_details")
        .select("status, duration_ms")
        .eq("execution_id", executionId);

      const detailList = details || [];
      const passedCount = detailList.filter(
        (d) => d.status === "passed",
      ).length;
      const failedCount = detailList.filter(
        (d) => d.status === "failed",
      ).length;
      const totalCount = detailList.length;
      const totalDurationMs = detailList.reduce(
        (acc, d) => acc + (d.duration_ms || 0),
        0,
      );
      const overallStatus = failedCount > 0 ? "failed" : "completed";

      const { data: updatedExecution, error } = await supabase
        .from("executions")
        .update({
          status: overallStatus,
          total_test_cases: totalCount,
          passed_test_cases: passedCount,
          failed_test_cases: failedCount,
          total_duration_ms: totalDurationMs,
          completed_at: new Date().toISOString(),
        })
        .eq("id", executionId)
        .select()
        .single();

      if (error) {
        return c.json({ success: false, error: error.message }, 500);
      }

      return c.json({ success: true, data: updatedExecution });


    } catch (err: any) {
      console.error("[Executions Route] Exception completing execution:", err);
      return c.json({ success: false, error: err.message || String(err) }, 500);
    }
  });

  router.post("/mobile", async (c) => {
    try {
      const authUser = c.get("user") as AuthUser;
      const body = await c.req.parseBody();

      let testCases: TestCase[] = [];
      if (typeof body.testCases === "string") {
        testCases = JSON.parse(body.testCases);
      } else if (Array.isArray(body.testCases)) {
        testCases = body.testCases as unknown as TestCase[];
      }

      const rawPlatform = (body.platform as string) || "ios";
      const normalizedPlatform = normalizePlatform(rawPlatform);
      const runnerPlatform: "mobile-ios" | "mobile-android" =
        normalizedPlatform === "android" ? "mobile-android" : "mobile-ios";

      // Check plan usage limitation for mobile testing
      const limitCheck = await checkUserLimitation(authUser.id, normalizedPlatform);
      if (!limitCheck.allowed) {
        console.warn(`[Mobile Execution Refused 🚫] User ${authUser.id} exceeded limitation:`, limitCheck.reason);
        return c.json(
          {
            success: false,
            error: limitCheck.reason,
            limitExceeded: true,
            details: limitCheck,
          },
          403
        );
      }

      const appFile = body.appFile as File | undefined;
      const appUrlFromReq = body.appUrl as string | undefined;
      const awsProjectArn =
        (body.awsProjectArn as string) || process.env.AWS_PROJECT_ARN;

      let signedAppUrl = appUrlFromReq || "";
      let localSavedPath: string | undefined;

      if (appFile) {
        const arrayBuffer = await appFile.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const uploadDir = join(__dirname, "..", ".cache", "uploads");
        if (!existsSync(uploadDir)) {
          mkdirSync(uploadDir, { recursive: true });
        }
        localSavedPath = join(uploadDir, `${Date.now()}_${appFile.name}`);
        writeFileSync(localSavedPath, buffer);
        signedAppUrl = await uploadAppBinaryToSupabase(buffer, appFile.name);
      }

      if (!signedAppUrl) {
        return c.json(
          { success: false, error: "App binary file or appUrl is required." },
          400,
        );
      }

      const isStream =
        c.req.header("x-stream") === "true" || c.req.query("stream") === "true";
      const requestExecutionId =
        (body.executionId as string) || (body.execution_id as string);

      // 1. Create main 'executions' record in Supabase DB (or reuse existing)
      let executionRecord: any = null;
      if (requestExecutionId) {
        const { data: existing } = await supabase
          .from("executions")
          .select("*")
          .eq("id", requestExecutionId)
          .single();

        if (existing) {
          executionRecord = existing;
          const currentPlatforms: string[] = Array.isArray(existing.platforms)
            ? existing.platforms
            : [existing.environment || "web"];
          const mergedPlatforms = Array.from(
            new Set([...currentPlatforms, normalizedPlatform]),
          );
          await supabase
            .from("executions")
            .update({
              platforms: mergedPlatforms,
              status: "running",
            })
            .eq("id", existing.id);
          executionRecord.platforms = mergedPlatforms;
        }
      }

      if (!executionRecord) {
        const { data: createdExec, error: execErr } = await supabase
          .from("executions")
          .insert({
            title: `Mobile Run (${normalizedPlatform})`,
            environment: normalizedPlatform,
            platforms: [normalizedPlatform],
            status: "running",
            total_test_cases: testCases.length,
            passed_test_cases: 0,
            failed_test_cases: 0,
            user_id: authUser.id,
          })
          .select()
          .single();

        if (execErr) {
          console.error(
            "[Mobile DB Warning] Failed to insert initial execution row:",
            execErr,
          );
        } else {
          executionRecord = createdExec;
          console.log(
            `[Mobile DB] Created execution record ID: ${executionRecord.id}`,
          );
        }
      }

      if (isStream) {
        return streamText(c, async (stream) => {
          if (executionRecord) {
            await stream.writeln(
              JSON.stringify({ type: "init", executionId: executionRecord.id }),
            );
          }

          const mobileExecutor = new MobileExecutor(authUser.geminiApiKey);
          let passedCount = 0;
          let failedCount = 0;
          let totalDurationMs = 0;
          let totalStepDurationMs = 0;
          let totalTokens = 0;

          for (let idx = 0; idx < testCases.length; idx++) {
            const tc = testCases[idx];

            let detailRecord: any = null;
            if (executionRecord) {
              const { data: createdDetail } = await supabase
                .from("execution_details")
                .insert({
                  execution_id: executionRecord.id,
                  test_case_id: tc.id || `tc_${idx}`,
                  title: tc.title || `Mobile Test Case ${idx + 1}`,
                  status: "running",
                  platform: normalizedPlatform,
                  started_at: new Date().toISOString(),
                })
                .select()
                .single();
              if (createdDetail) detailRecord = createdDetail;
            }

            await stream.writeln(
              JSON.stringify({
                type: "step_progress",
                testCaseId: tc.id || `tc_${idx}`,
                title: tc.title || "Untitled",
                stepIndex: 0,
                totalSteps: tc.steps?.length || 1,
                stepType: "INIT",
                description: "Initializing Device...",
              }),
            );

            const tcStartTime = Date.now();
            const report = await mobileExecutor.executeTestCase(
              tc,
              {
                platform: runnerPlatform,
                appUrl: signedAppUrl,
                appFilePath: localSavedPath,
                awsProjectArn,
                geminiApiKey: authUser.geminiApiKey,
              },
              (stepReport) => {
                stream.writeln(
                  JSON.stringify({
                    type: "step_progress",
                    testCaseId: tc.id || `tc_${idx}`,
                    title: tc.title || "Untitled",
                    stepIndex: stepReport.index,
                    totalSteps: tc.steps?.length || 1,
                    stepType: stepReport.type,
                    description: stepReport.description,
                  }),
                );
              },
            );

            const durationMs = Date.now() - tcStartTime;
            const isSuccess = report.overallSuccess;
            if (isSuccess) passedCount++;
            else failedCount++;

            totalDurationMs += durationMs;
            totalStepDurationMs += report.stepExecutionTimeMs ?? durationMs;
            totalTokens += report.totalTokensUsed || 0;

            const processedStepReports: any[] = [];
            for (const stepReport of report.stepReports || []) {
              const reportCopy = { ...stepReport };
              if (reportCopy.screenshotBase64 && executionRecord) {
                const uploadResult = await uploadScreenshot(
                  executionRecord.id,
                  tc.id || "tc",
                  reportCopy.index,
                  reportCopy.screenshotBase64,
                );
                if (uploadResult) {
                  reportCopy.screenshotPath = uploadResult.path;
                }
                delete reportCopy.screenshotBase64;
              }
              processedStepReports.push(reportCopy);
            }

            const deviceName =
              runnerPlatform === "mobile-ios"
                ? "iPhone 15 Pro (iOS)"
                : "Pixel 8 Pro (Android)";
            const metaItem = {
              type: "__meta__",
              networkReports: report.networkReports || [],
              logReports: report.logReports || [],
              info: {
                specFile: tc.id ? `${tc.id}.yaml` : "mobile-test.yaml",
                device: deviceName,
                browser: deviceName,
                platform: normalizedPlatform,
                duration: `${(durationMs / 1000).toFixed(1)}s`,
                url: signedAppUrl,
              },
            };
            const processedStepReportsWithMeta = [
              ...processedStepReports,
              metaItem,
            ];

            if (detailRecord) {
              const updateData: any = sanitizeForJsonb({
                status: isSuccess ? "passed" : "failed",
                duration_ms: durationMs,
                step_reports: processedStepReportsWithMeta,
                network_reports: report.networkReports || [],
                log_reports: report.logReports || [],
                info: metaItem.info,
                completed_at: new Date().toISOString(),
              });

              await supabase
                .from("execution_details")
                .update(updateData)
                .eq("id", detailRecord.id);

              analyzeTestCaseBug(
                detailRecord.id,
                tc.title || "Mobile Test Case",
                isSuccess ? "passed" : "failed",
                processedStepReports,
                report.networkReports || [],
                report.logReports || [],
                authUser.geminiApiKey,
              ).catch((e) => console.error("[BugAnalysis Error]:", e));
            }

            await stream.writeln(
              JSON.stringify({
                type: "test_complete",
                testCaseId: tc.id || `tc_${idx}`,
                title: tc.title || "Untitled",
                status: isSuccess ? "PASSED" : "FAILED",
                durationMs,
                error: report.error,
              }),
            );
          }

          if (executionRecord) {
            const finalStatus = failedCount > 0 ? "failed" : "completed";
            await supabase
              .from("executions")
              .update({
                status: finalStatus,
                passed_test_cases: passedCount,
                failed_test_cases: failedCount,
                total_duration_ms: totalDurationMs,
                total_tokens_used: totalTokens,
                completed_at: new Date().toISOString(),
              })
              .eq("id", executionRecord.id);
          }

          // Track mobile usage excluding device initialization duration
          await trackUserUsage(authUser.id, normalizedPlatform, totalStepDurationMs);


          await stream.writeln(
            JSON.stringify({
              type: "execution_complete",
              executionId: executionRecord?.id,
              passedCount,
              failedCount,
              totalDurationMs,
            }),
          );
        });
      }

      const mobileExecutor = new MobileExecutor(authUser.geminiApiKey);
      const executionReports: TestCaseExecutionReport[] = [];
      let passedCount = 0;
      let failedCount = 0;
      let totalDurationMs = 0;
      let totalStepDurationMs = 0;
      let totalTokens = 0;

      for (let idx = 0; idx < testCases.length; idx++) {
        const tc = testCases[idx];

        // 2. Create 'execution_details' record in Supabase DB
        let detailRecord: any = null;
        if (executionRecord) {
          const { data: createdDetail, error: detailErr } = await supabase
            .from("execution_details")
            .insert({
              execution_id: executionRecord.id,
              test_case_id: tc.id || `tc_${idx}`,
              title: tc.title || `Mobile Test Case ${idx + 1}`,
              status: "running",
              platform: normalizedPlatform,
              started_at: new Date().toISOString(),
            })
            .select()
            .single();

          if (!detailErr && createdDetail) {
            detailRecord = createdDetail;
          }
        }

        const tcStartTime = Date.now();
        const report = await mobileExecutor.executeTestCase(tc, {
          platform: runnerPlatform,
          appUrl: signedAppUrl,
          appFilePath: localSavedPath,
          awsProjectArn,
          geminiApiKey: authUser.geminiApiKey,
        });
        executionReports.push(report);

        const durationMs = Date.now() - tcStartTime;
        const isSuccess = report.overallSuccess;
        if (isSuccess) passedCount++;
        else failedCount++;

        totalDurationMs += durationMs;
        totalStepDurationMs += report.stepExecutionTimeMs ?? durationMs;
        totalTokens += report.totalTokensUsed || 0;

        // 3. Upload Step Screenshots to Supabase Storage & Sanitize
        const processedStepReports: any[] = [];
        for (const stepReport of report.stepReports || []) {
          const reportCopy = { ...stepReport };
          if (reportCopy.screenshotBase64 && executionRecord) {
            const uploadResult = await uploadScreenshot(
              executionRecord.id,
              tc.id || "tc",
              reportCopy.index,
              reportCopy.screenshotBase64,
            );
            if (uploadResult) {
              reportCopy.screenshotPath = uploadResult.path;
            }
            delete reportCopy.screenshotBase64;
          }
          processedStepReports.push(reportCopy);
        }

        const deviceName =
          runnerPlatform === "mobile-ios"
            ? "iPhone 15 Pro (iOS)"
            : "Pixel 8 Pro (Android)";
        const metaItem = {
          type: "__meta__",
          networkReports: report.networkReports || [],
          logReports: report.logReports || [],
          info: {
            specFile: tc.id ? `${tc.id}.yaml` : "mobile-test.yaml",
            device: deviceName,
            browser: deviceName,
            platform: normalizedPlatform,
            duration: `${(durationMs / 1000).toFixed(1)}s`,
            url: signedAppUrl,
          },
        };
        const processedStepReportsWithMeta = [
          ...processedStepReports,
          metaItem,
        ];

        // 4. Update 'execution_details' record in Supabase DB
        if (detailRecord) {
          const updateData: any = sanitizeForJsonb({
            status: isSuccess ? "passed" : "failed",
            duration_ms: durationMs,
            step_reports: processedStepReportsWithMeta,
            network_reports: report.networkReports || [],
            log_reports: report.logReports || [],
            info: metaItem.info,
            completed_at: new Date().toISOString(),
          });

          const { error: updateErr } = await supabase
            .from("execution_details")
            .update(updateData)
            .eq("id", detailRecord.id);

          analyzeTestCaseBug(
            detailRecord.id,
            tc.title || "Mobile Test Case",
            isSuccess ? "passed" : "failed",
            processedStepReports,
            report.networkReports || [],
            report.logReports || [],
            authUser.geminiApiKey,
          ).catch((e) => console.error("[BugAnalysis Error]:", e));

          if (updateErr) {
            console.error(
              `[Mobile DB Warning] Failed to update execution detail ${detailRecord.id}:`,
              updateErr,
            );
          } else {
            console.log(
              `[Mobile DB] Successfully saved execution details for test case "${tc.title}"`,
            );
          }
        }
      }

      // 5. Update aggregate 'executions' record in Supabase DB
      if (executionRecord) {
        const finalStatus = failedCount > 0 ? "failed" : "completed";
        await supabase
          .from("executions")
          .update({
            status: finalStatus,
            passed_test_cases: passedCount,
            failed_test_cases: failedCount,
            total_duration_ms: totalDurationMs,
            total_tokens_used: totalTokens,
            completed_at: new Date().toISOString(),
          })
          .eq("id", executionRecord.id);

        console.log(
          `[Mobile DB] Completed execution record ${executionRecord.id} with status: ${finalStatus}`,
        );
      }

      // Track mobile usage excluding device initialization duration
      await trackUserUsage(authUser.id, normalizedPlatform, totalStepDurationMs);


      return c.json({
        success: true,
        data: {
          executionId: executionRecord?.id,
          appUrl: signedAppUrl,
          platform,
          reports: executionReports,
        },
      });
    } catch (err: any) {
      console.error("[Mobile Executions Route Error]:", err);
      return c.json({ success: false, error: err.message }, 500);
    }
  });

  return router;
}
