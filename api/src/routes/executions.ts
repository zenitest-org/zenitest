import { Hono } from "hono";
import { WebSocket } from "ws";
import { supabase, uploadScreenshot } from "../db/supabase";
import { Executor } from "../executor";
import { TestCase, TestCaseExecutionReport } from "../types";
import { authMiddleware, AuthUser } from "../middleware/auth";

export interface ExecutionsRouteContext {
  clients: Map<string, WebSocket>;
  port: number;
}

export function createExecutionsRouter(ctx: ExecutionsRouteContext) {
  const router = new Hono();

  // Apply authentication middleware to all execution endpoints
  router.use("*", authMiddleware);

  /* ==========================================================================
     Executions Endpoints
     ========================================================================== */

  // GET /api/executions/query - Query/list executions with optional filtering & pagination
  router.get("/query", async (c) => {
    try {
      const authUser = c.get("user") as AuthUser;
      const userId = c.req.query("userId") || (c.req.query("all") === "true" ? null : authUser.id);
      const status = c.req.query("status");
      const limit = Number(c.req.query("limit")) || 20;
      const offset = Number(c.req.query("offset")) || 0;

      let query = supabase
        .from("executions")
        .select("*", { count: "exact" })
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
        data,
        pagination: {
          total: count || 0,
          limit,
          offset,
        },
      });
    } catch (err: any) {
      console.error("[Executions Route] Exception querying executions:", err);
      return c.json({ success: false, error: err.message || String(err) }, 500);
    }
  });

  // GET /api/executions/get/:id - Get a single execution by ID (supports ?includeDetails=true)
  router.get("/get/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const includeDetails = c.req.query("includeDetails") === "true";

      const { data: execution, error } = await supabase
        .from("executions")
        .select("*")
        .eq("id", id)
        .single();

      if (error || !execution) {
        return c.json({ success: false, error: "Execution not found" }, 404);
      }

      let details: any[] = [];
      if (includeDetails) {
        const { data: detailsData } = await supabase
          .from("execution_details")
          .select("*")
          .eq("execution_id", id)
          .order("created_at", { ascending: true });
        details = detailsData || [];
      }

      return c.json({
        success: true,
        data: {
          ...execution,
          ...(includeDetails ? { details } : {}),
        },
      });
    } catch (err: any) {
      console.error("[Executions Route] Exception getting execution:", err);
      return c.json({ success: false, error: err.message || String(err) }, 500);
    }
  });

  // POST /api/executions/create - Create an execution AND trigger test case run(s)
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
        metadata = {},
      } = body;

      const user_id = requestUserId || authUser.id;

      if (!user_id) {
        return c.json({ success: false, error: "Missing user identification" }, 400);
      }

      // Consolidate test cases array
      const testCasesArray: TestCase[] = rawTestCases || (testCase ? [testCase] : []);

      if (testCasesArray.length > 0 && !clientId) {
        return c.json({ success: false, error: "Missing clientId for test execution" }, 400);
      }

      if (clientId && !ctx.clients.has(clientId)) {
        return c.json(
          { success: false, error: `No active proxy client connected for clientId: ${clientId}` },
          400
        );
      }

      const executionTitle =
        title ||
        (testCasesArray[0]?.title
          ? `Execution: ${testCasesArray[0].title}`
          : `Execution Run ${new Date().toISOString()}`);

      // 1. Insert initial execution record in Supabase
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
        console.error("[Executions Route] Error creating execution record:", execError);
        return c.json({ success: false, error: execError?.message || "Failed to create execution" }, 400);
      }

      // If no test cases passed, return early with created execution
      if (testCasesArray.length === 0 || !clientId) {
        return c.json({ success: true, data: execution }, 201);
      }

      // 2. Execute test cases sequentially and save details
      let passedCount = 0;
      let failedCount = 0;
      let totalDurationMs = 0;
      let totalTokens = 0;

      for (const tc of testCasesArray) {
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

        if (detailErr || !detailRecord) {
          console.error("[Executions Route] Error creating execution detail record:", detailErr);
          continue;
        }

        console.log(`[Executions Route] Executing test case "${tc.title}" for execution ${execution.id}`);

        const wsUrl = `ws://localhost:${ctx.port}/browser/${clientId}`;
        const executor = new Executor(wsUrl);
        const startTime = Date.now();

        let report: TestCaseExecutionReport;
        try {
          report = await executor.run(tc);
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
        }

        const endTime = Date.now();
        const durationMs = report.totalExecutionTimeMs || endTime - startTime;
        const tokensUsed = report.totalTokensUsed || 0;
        const isSuccess = report.overallSuccess;

        if (isSuccess) passedCount++;
        else failedCount++;

        totalDurationMs += durationMs;
        totalTokens += tokensUsed;

        // Process step reports to upload screenshots to Supabase storage bucket 'screenshots'
        const processedStepReports: any[] = [];
        for (const stepReport of report.stepReports || []) {
          const reportCopy = { ...stepReport };
          if (reportCopy.screenshotBase64) {
            const uploadResult = await uploadScreenshot(
              execution.id,
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

        // Update detail record in Supabase with step_reports containing screenshotPath
        await supabase
          .from("execution_details")
          .update({
            status: isSuccess ? "passed" : "failed",
            duration_ms: durationMs,
            tokens_used: tokensUsed,
            step_reports: processedStepReports,
            error_message: report.error || null,
            completed_at: new Date().toISOString(),
          })
          .eq("id", detailRecord.id);
      }

      // 3. Update execution record with final status & totals
      const overallStatus = failedCount > 0 ? "failed" : "completed";
      const { data: updatedExecution } = await supabase
        .from("executions")
        .update({
          status: overallStatus,
          passed_test_cases: passedCount,
          failed_test_cases: failedCount,
          total_duration_ms: totalDurationMs,
          total_tokens_used: totalTokens,
          completed_at: new Date().toISOString(),
        })
        .eq("id", execution.id)
        .select()
        .single();

      // 4. Fetch all created execution_details
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
        201
      );
    } catch (err: any) {
      console.error("[Executions Route] Exception in POST /api/executions/create:", err);
      return c.json({ success: false, error: err.message || String(err) }, 500);
    }
  });

  /* ==========================================================================
     Execution Details Endpoints
     ========================================================================== */

  // GET /api/executions/details/query - List details for an execution (supports ?executionId=...)
  const queryDetailsHandler = async (c: any) => {
    try {
      const executionId = c.req.param("executionId") || c.req.query("executionId");

      if (!executionId) {
        return c.json({ success: false, error: "Missing required executionId parameter" }, 400);
      }

      const { data, error } = await supabase
        .from("execution_details")
        .select("*")
        .eq("execution_id", executionId)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("[Executions Route] Error querying execution details:", error);
        return c.json({ success: false, error: error.message }, 500);
      }

      return c.json({ success: true, data });
    } catch (err: any) {
      console.error("[Executions Route] Exception querying execution details:", err);
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
        return c.json({ success: false, error: "Execution detail not found" }, 404);
      }

      return c.json({ success: true, data });
    } catch (err: any) {
      console.error("[Executions Route] Exception getting execution detail:", err);
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
        error_message,
      } = body;

      if (!execution_id || !test_case_id || !title) {
        return c.json(
          { success: false, error: "Missing required fields: execution_id, test_case_id, and title" },
          400
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
            reportCopy.screenshotBase64
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
          tokens_used,
          step_reports: processedStepReports,
          error_message,
          started_at: status === "running" ? new Date().toISOString() : null,
        })
        .select()
        .single();

      if (error) {
        console.error("[Executions Route] Error creating execution detail:", error);
        return c.json({ success: false, error: error.message }, 400);
      }

      return c.json({ success: true, data }, 201);
    } catch (err: any) {
      console.error("[Executions Route] Exception creating execution detail:", err);
      return c.json({ success: false, error: err.message || String(err) }, 500);
    }
  });

  return router;
}
