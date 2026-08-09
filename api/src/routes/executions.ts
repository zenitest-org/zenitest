import { existsSync, mkdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Hono } from "hono";
import { streamText } from "hono/streaming";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { WebSocket } from "ws";
import { chromium } from "playwright-core";
import { supabase, uploadScreenshot, attachSignedUrlsToDetails } from "../db/supabase";
import { Executor } from "../executor";
import { MobileExecutor, uploadAppBinaryToSupabase } from "../mobile-executor";
import { TestCase, TestCaseExecutionReport } from "../types";
import { authMiddleware, AuthUser } from "../middleware/auth";

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
          "id, number, title, status, environment, total_test_cases, passed_test_cases, failed_test_cases, skipped_test_cases, total_duration_ms, total_tokens_used, created_at, started_at, completed_at, user_id",
          { count: "exact" }
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

      const { data: execution, error } = await supabase
        .from("executions")
        .select("*")
        .eq("id", id)
        .single();

      if (error || !execution) {
        return c.json({ success: false, error: "Execution not found" }, 404);
      }

      const { data: detailsData } = await supabase
        .from("execution_details")
        .select("*")
        .eq("execution_id", execution.id)
        .order("created_at", { ascending: true });

      const detailsWithSignedUrls = await attachSignedUrlsToDetails(detailsData || []);

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

      const { data: execution, error: execError } = await supabase
        .from("executions")
        .insert({
          user_id,
          title: executionTitle,
          status: testCasesArray.length > 0 ? "running" : "pending",
          environment,
          total_test_cases: testCasesArray.length,
          metadata,
          started_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (execError || !execution) {
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
            const { data: detailRecord } = await supabase
              .from("execution_details")
              .insert({
                execution_id: execution.id,
                test_case_id: tc.id || `tc_${Date.now()}`,
                title: tc.title || "Untitled Test Case",
                status: "running",
                target_url: tc.prodURL || tc.localURL || null,
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
                targetURL: tc.prodURL || tc.localURL || "",
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
                url: tc.prodURL || tc.localURL || execution.target_url || "—",
              },
            };
            const processedStepReportsWithMeta = [...processedStepReports, metaItem];

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
                console.error("[Executions Route] Supabase update warning:", updateErr.message);
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
        const { data: detailRecord, error: detailErr } = await supabase
          .from("execution_details")
          .insert({
            execution_id: execution.id,
            test_case_id: tc.id || `tc_${Date.now()}`,
            title: tc.title || "Untitled Test Case",
            status: "running",
            target_url: tc.prodURL || tc.localURL || null,
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
            targetURL: tc.prodURL || tc.localURL || "",
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
            url: tc.prodURL || tc.localURL || execution.target_url || "—",
          },
        };
        const processedStepReportsWithMeta = [...processedStepReports, metaItem];

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

        if (updateErr) {
          console.error("[Executions Route] Supabase update warning:", updateErr.message);
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

      const platform = (body.platform as "mobile-ios" | "mobile-android") || "mobile-ios";
      const appFile = body.appFile as File | undefined;
      const appUrlFromReq = body.appUrl as string | undefined;
      const awsProjectArn = (body.awsProjectArn as string) || process.env.AWS_PROJECT_ARN;

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
        return c.json({ success: false, error: "App binary file or appUrl is required." }, 400);
      }

      // 1. Create main 'executions' record in Supabase DB
      let executionRecord: any = null;
      const { data: createdExec, error: execErr } = await supabase
        .from("executions")
        .insert({
          title: `Mobile Run (${platform})`,
          environment: platform,
          status: "running",
          total_test_cases: testCases.length,
          passed_test_cases: 0,
          failed_test_cases: 0,
          user_id: authUser.id,
        })
        .select()
        .single();

      if (execErr) {
        console.error("[Mobile DB Warning] Failed to insert initial execution row:", execErr);
      } else {
        executionRecord = createdExec;
        console.log(`[Mobile DB] Created execution record ID: ${executionRecord.id}`);
      }

      const mobileExecutor = new MobileExecutor(authUser.geminiApiKey);
      const executionReports: TestCaseExecutionReport[] = [];
      let passedCount = 0;
      let failedCount = 0;
      let totalDurationMs = 0;
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
          platform,
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
              reportCopy.screenshotBase64
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
          networkReports: [],
          logReports: [],
          info: {
            specFile: tc.id ? `${tc.id}.yaml` : "mobile-test.yaml",
            browser: platform === "mobile-ios" ? "AWS Device Farm (iOS)" : "AWS Device Farm (Android)",
            duration: `${(durationMs / 1000).toFixed(1)}s`,
            url: signedAppUrl,
          },
        };
        const processedStepReportsWithMeta = [...processedStepReports, metaItem];

        // 4. Update 'execution_details' record in Supabase DB
        if (detailRecord) {
          const updateData: any = sanitizeForJsonb({
            status: isSuccess ? "passed" : "failed",
            duration_ms: durationMs,
            step_reports: processedStepReportsWithMeta,
            network_reports: [],
            log_reports: [],
            info: metaItem.info,
            completed_at: new Date().toISOString(),
          });

          const { error: updateErr } = await supabase
            .from("execution_details")
            .update(updateData)
            .eq("id", detailRecord.id);

          if (updateErr) {
            console.error(`[Mobile DB Warning] Failed to update execution detail ${detailRecord.id}:`, updateErr);
          } else {
            console.log(`[Mobile DB] Successfully saved execution details for test case "${tc.title}"`);
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

        console.log(`[Mobile DB] Completed execution record ${executionRecord.id} with status: ${finalStatus}`);
      }

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
