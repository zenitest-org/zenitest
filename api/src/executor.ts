import "dotenv/config";
import { WebSocket } from "ws";
import { GoogleGenAI, Type } from "@google/genai";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createHash } from "crypto";
import {
  TestCase,
  TestCaseExecutionReport,
  StepExecutionReport,
  DOMElement,
  ActResult,
  StepResult,
  ServerRpcMessage,
  ServerRpcMessageType,
  ClientRpcMessage,
  NetworkReportItem,
  LogReportItem,
} from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_CACHE_DIR = join(__dirname, "..", ".cache", "executor");

export class ExecutorCache {
  private cacheDir: string;

  constructor() {
    this.cacheDir = SERVER_CACHE_DIR;
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  public generateKey(
    instruction: string,
    elements: DOMElement[],
    url?: string,
    type: string = "act",
  ): string {
    const serializedElements = elements.map((e) => ({
      tag: e.tagName,
      id: e.id,
      text: e.text,
      aria: e.ariaLabel,
      placeholder: e.placeholder,
      role: e.role,
      value: e.value,
    }));

    const raw = `${type}:${url || ""}:${instruction}:${JSON.stringify(serializedElements)}`;
    return createHash("sha256").update(raw).digest("hex");
  }

  public get<T>(key: string): T | null {
    if (
      process.env.DISABLE_EXECUTOR_CACHE === "true" ||
      process.env.NO_CACHE === "true"
    ) {
      return null;
    }
    try {
      const filePath = join(this.cacheDir, `${key}.json`);
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, "utf-8");
        const data = JSON.parse(content);
        return data.result as T;
      }
    } catch {
      // Ignore read errors
    }
    return null;
  }

  public set<T>(key: string, result: T): void {
    if (
      process.env.DISABLE_EXECUTOR_CACHE === "true" ||
      process.env.NO_CACHE === "true"
    ) {
      return;
    }
    try {
      const filePath = join(this.cacheDir, `${key}.json`);
      writeFileSync(
        filePath,
        JSON.stringify(
          { key, result, createdAt: new Date().toISOString() },
          null,
          2,
        ),
        "utf-8",
      );
    } catch (err: any) {
      console.warn("[Executor Cache] Failed to write cache:", err.message);
    }
  }
}

/* ==========================================================================
   WebSocket RPC Session Manager
   ========================================================================== */

export class ClientWebSocketSession {
  private ws: WebSocket;
  private pendingRequests = new Map<
    string,
    {
      resolve: (data: any) => void;
      reject: (err: any) => void;
    }
  >();

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as ClientRpcMessage;
        if (msg.id && this.pendingRequests.has(msg.id)) {
          const handler = this.pendingRequests.get(msg.id)!;
          this.pendingRequests.delete(msg.id);
          if (msg.success) {
            handler.resolve(msg);
          } else {
            handler.reject(new Error(msg.error || "Client RPC request failed"));
          }
        }
      } catch (err) {
        console.warn("[ClientWebSocketSession] Failed to parse client response:", err);
      }
    });
  }

  public async sendRequest<T = any>(
    type: ServerRpcMessageType,
    payload: Partial<ServerRpcMessage> = {},
    timeoutMs: number = 60000,
  ): Promise<T> {
    const id = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const msg: ServerRpcMessage = { type, id, ...payload };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`RPC request '${type}' timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (data) => {
          clearTimeout(timer);
          resolve(data);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(msg));
      } else {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(new Error("Client WebSocket is not open"));
      }
    });
  }
}

/* ==========================================================================
   Helper Functions
   ========================================================================== */

function formatDOMState(elements: DOMElement[]): string {
  return elements
    .map((el) => {
      const parts = [`<${el.tagName || "element"}`];
      if (el.id !== undefined) parts.push(`id="${el.id}"`);
      if (el.role) parts.push(`role="${el.role}"`);
      if (el.placeholder) parts.push(`placeholder="${el.placeholder}"`);
      if (el.ariaLabel) parts.push(`aria-label="${el.ariaLabel}"`);
      if (el.href) parts.push(`href="${el.href}"`);
      if (el.disabled) parts.push(`disabled`);
      if (el.checked) parts.push(`checked`);

      if (el.attributes) {
        for (const [k, v] of Object.entries(el.attributes)) {
          if (!["id", "role", "placeholder", "aria-label", "href"].includes(k)) {
            parts.push(`${k}="${v}"`);
          }
        }
      }

      parts.push(">");
      if (el.text) parts.push(el.text);
      if (el.value) parts.push(`[value: ${el.value}]`);
      parts.push(`</${el.tagName || "element"}>`);
      return parts.join(" ");
    })
    .join("\n");
}

function substituteVariables(
  instruction: string,
  variables?: Record<string, any>,
): string {
  if (!variables || typeof variables !== "object") return instruction;
  let result = instruction;
  for (const [key, rawVal] of Object.entries(variables)) {
    if (rawVal === undefined || rawVal === null) continue;
    const value = String(rawVal);
    result = result
      .replaceAll(`\${${key}}`, value)
      .replaceAll(`{${key}}`, value)
      .replaceAll(`%${key}%`, value);
  }
  return result;
}

function maskSecretsInText(text: string): string {
  if (!text || typeof text !== "string") return text;
  return text.replace(/\$\{secret\.[a-zA-Z0-9_]+\}/g, "******");
}

function resolveFullURL(
  pathOrUrl: string,
  baseLocalUrl?: string,
  baseProdUrl?: string,
  targetType: "prod" | "local" = "prod",
): string {
  const trimmed = pathOrUrl.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  let baseUrl = targetType === "local" ? baseLocalUrl : baseProdUrl;
  if (!baseUrl) {
    baseUrl = baseProdUrl || baseLocalUrl || "http://localhost:3000";
  }
  let formattedBase = baseUrl.trim();
  if (
    !formattedBase.startsWith("http://") &&
    !formattedBase.startsWith("https://")
  ) {
    formattedBase = `http://${formattedBase}`;
  }
  formattedBase = formattedBase.replace(/\/$/, "");
  const formattedPath = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `${formattedBase}${formattedPath}`;
}

/* ==========================================================================
   Gemini API Client and Response Schemas
   ========================================================================== */

const ACT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    action: {
      type: Type.STRING,
      enum: [
        "click",
        "doubleClick",
        "type",
        "press",
        "scroll",
        "hover",
        "select",
        "dragAndDrop",
        "nav",
        "done",
      ],
      description: "The action type to perform",
    },
    targetElementId: {
      type: Type.STRING,
      description: "ID or index of element to interact with",
      nullable: true,
    },
    targetDescription: {
      type: Type.STRING,
      description: "Visual or structural description of target element",
      nullable: true,
    },
    text: {
      type: Type.STRING,
      description: "Text payload if action is 'type'",
      nullable: true,
    },
    direction: {
      type: Type.STRING,
      enum: ["up", "down", "left", "right", "top", "bottom"],
      description: "Direction if action is 'scroll'",
      nullable: true,
    },
    key: {
      type: Type.STRING,
      description: "Key name if action is 'press'",
      nullable: true,
    },
    value: {
      type: Type.STRING,
      description: "Option value if action is 'select'",
      nullable: true,
    },
    toElementId: {
      type: Type.STRING,
      description: "Target element ID if action is 'dragAndDrop'",
      nullable: true,
    },
    url: {
      type: Type.STRING,
      description: "URL if action is 'nav'",
      nullable: true,
    },
    reasoning: {
      type: Type.STRING,
      description: "Step-by-step reasoning for choosing this action",
    },
  },
  required: ["action", "reasoning"],
};

const VALIDATE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    success: {
      type: Type.BOOLEAN,
      description: "true if the validation criteria is met, false otherwise",
    },
    explanation: { type: Type.STRING, description: "Reason for result" },
    pageStillLoading: {
      type: Type.BOOLEAN,
      description: "true if page is not settled yet",
    },
  },
  required: ["success", "explanation", "pageStillLoading"],
};

/* ==========================================================================
   Executor Class
   ========================================================================== */

export interface ExecutorOptions {
  sendScreenshot?: boolean;
  localUrl?: string;
  prodUrl?: string;
  env?: "prod" | "local" | string;
}

export class Executor {
  private session: ClientWebSocketSession;
  private ai: GoogleGenAI;
  private model: string;
  private cache: ExecutorCache;
  private sendScreenshot: boolean;

  constructor(client: WebSocket | ClientWebSocketSession, options?: ExecutorOptions) {
    if (client instanceof ClientWebSocketSession) {
      this.session = client;
    } else {
      this.session = new ClientWebSocketSession(client);
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("Missing GEMINI_API_KEY environment variable");
    }

    this.ai = new GoogleGenAI({ apiKey });
    this.model =
      process.env.GEMINI_MODEL ||
      process.env.ZENI_MODEL ||
      process.env.STAGEHAND_MODEL ||
      "gemini-3.5-flash-lite";
    this.cache = new ExecutorCache();
    this.sendScreenshot =
      options?.sendScreenshot ??
      (process.env.SEND_SCREENSHOT === "true" ||
        process.env.SEND_SCREENSHOT_TO_GEMINI === "true");
  }

  public async runWithContext(
    testCase: TestCase,
    onProgress?: (progress: {
      stepIndex: number;
      totalSteps: number;
      stepType: string;
      description: string;
      status: "running" | "passed" | "failed";
    }) => void,
    options?: ExecutorOptions,
  ): Promise<TestCaseExecutionReport> {
    const shouldSendScreenshot = options?.sendScreenshot ?? this.sendScreenshot;
    const sessionId = `sess_${testCase.id || "tc"}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Initialize page on client under an isolated browser context
    await this.session.sendRequest("INIT_PAGE", {
      sessionId,
      viewport: { width: 1280, height: 800 },
    });

    const startTime = Date.now();
    const stepReports: StepExecutionReport[] = [];
    let overallSuccess = true;
    let totalTokensUsed = 0;

    try {
      const normalizedSteps = (testCase.steps || []).map(
        (s: any, idx: number) => {
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
        },
      );

      for (const step of normalizedSteps) {
        const stepStartTime = Date.now();
        const stepDescription = substituteVariables(
          step.description || step.url || "/",
          testCase.variables,
        );
        const maskedStepDescription = maskSecretsInText(stepDescription);
        console.log(
          `[Executor] Processing step ${step.index}: ${maskedStepDescription}`,
        );

        if (onProgress) {
          onProgress({
            stepIndex: step.index,
            totalSteps: testCase.steps.length,
            stepType: step.type,
            description: maskedStepDescription,
            status: "running",
          });
        }

        const stepReport: StepExecutionReport = {
          index: step.index,
          type: step.type,
          description: maskedStepDescription,
          success: true,
          explanation: "",
          executionTimeMs: 0,
          tokensUsed: 0,
        };

        try {
          if (step.type === "navigate") {
            const navPath = step.url || step.description || "/";
            const localUrl = testCase.localUrl || testCase.localURL || options?.localUrl;
            const prodUrl = testCase.prodUrl || testCase.prodURL || options?.prodUrl;
            const targetEnv = (options?.env === "local" ? "local" : "prod") as "prod" | "local";
            const targetUrl = resolveFullURL(
              navPath,
              localUrl,
              prodUrl,
              targetEnv,
            );
            console.log(`[Executor] Instructing client to navigate to ${targetUrl}`);

            const navRes = await this.session.sendRequest<ClientRpcMessage>("NAVIGATE", {
              sessionId,
              url: targetUrl,
              timeoutMs: 30000,
            });

            if (!navRes.success) {
              throw new Error(navRes.error || `Failed to navigate to ${targetUrl}`);
            }

            stepReport.explanation = `Successfully navigated to ${targetUrl}`;
            stepReport.success = true;
          } else if (step.type === "act") {
            const stateRes = await this.session.sendRequest<ClientRpcMessage>("GET_PAGE_STATE", {
              sessionId,
              includeScreenshot: shouldSendScreenshot,
            });

            stepReport.screenshotBase64 = stateRes.screenshotBase64;
            const elements = stateRes.elements || [];
            const instruction = stepDescription;
            const cacheKey = this.cache.generateKey(
              instruction,
              elements,
              stateRes.url,
            );
            const cachedActResult = this.cache.get<ActResult>(cacheKey);

            if (cachedActResult) {
              console.log(
                `[Executor Cache HIT] Reusing cached action decision for step ${step.index}: ${cachedActResult.action}`,
              );
              stepReport.actResult = cachedActResult;
              stepReport.explanation = `${cachedActResult.reasoning} (Cached)`;
              stepReport.cachedResponse = true;
              stepReport.cacheKey = cacheKey;
              stepReport.tokensUsed = 0;

              const actRes = await this.session.sendRequest<ClientRpcMessage>("EXECUTE_ACTION", {
                sessionId,
                actResult: cachedActResult,
              });

              if (!actRes.success) {
                throw new Error(actRes.error || "Action execution failed on client");
              }
              stepReport.success = true;
            } else {
              const domStr = formatDOMState(elements);

              const systemPrompt = `You are Zeni Executor. Analyze the DOM and choose the single best action to fulfill the instruction.
Valid actions: 'click', 'doubleClick', 'type', 'press', 'scroll', 'hover', 'select', 'dragAndDrop', 'nav', 'done'.
If the goal is fully accomplished, set action to 'done'.`;

              const userText = `### Instruction:\n${instruction}\n\n### Current Page DOM State:\n${domStr}`;

              const actParts: any[] = [
                { text: `${systemPrompt}\n\n${userText}` },
              ];
              if (shouldSendScreenshot && stateRes.screenshotBase64) {
                actParts.push({
                  inlineData: {
                    mimeType: "image/png",
                    data: stateRes.screenshotBase64,
                  },
                });
              }

              const response = await this.ai.models.generateContent({
                model: this.model,
                contents: [
                  {
                    role: "user",
                    parts: actParts,
                  },
                ],
                config: {
                  temperature: 0.1,
                  responseMimeType: "application/json",
                  responseSchema: ACT_SCHEMA,
                },
              });

              const responseText = response.text || "{}";
              const actResult = JSON.parse(
                responseText.replace(/```json\n?|\n?```/g, "").trim(),
              ) as ActResult;

              stepReport.actResult = actResult;
              stepReport.explanation = actResult.reasoning;
              stepReport.tokensUsed =
                response.usageMetadata?.totalTokenCount ?? 0;
              totalTokensUsed += stepReport.tokensUsed;
              stepReport.cacheKey = cacheKey;
              stepReport.cachedResponse = false;

              this.cache.set(cacheKey, actResult);

              console.log(
                `[Executor] Predicted action: ${actResult.action} | Reasoning: ${actResult.reasoning}`,
              );

              const actRes = await this.session.sendRequest<ClientRpcMessage>("EXECUTE_ACTION", {
                sessionId,
                actResult,
              });

              if (!actRes.success) {
                throw new Error(actRes.error || "Action execution failed on client");
              }
              stepReport.success = true;
            }
          } else if (step.type === "validate") {
            const maxAttempts = 5;
            let validationPassed = false;
            let lastResult: StepResult | undefined;

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
              if (attempt > 1) {
                console.log(
                  `[Executor] Validation attempt ${attempt} waiting for page to settle...`,
                );
                await this.session.sendRequest("WAIT", { sessionId, ms: 2000 });
              }

              const stateRes = await this.session.sendRequest<ClientRpcMessage>("GET_PAGE_STATE", {
                sessionId,
                includeScreenshot: shouldSendScreenshot,
              });
              stepReport.screenshotBase64 = stateRes.screenshotBase64;

              const elements = stateRes.elements || [];
              const instruction = stepDescription;
              const cacheKey = this.cache.generateKey(
                instruction,
                elements,
                stateRes.url,
                "validate",
              );
              const cachedValResult = this.cache.get<StepResult>(cacheKey);

              if (cachedValResult) {
                console.log(
                  `[Executor Cache HIT] Reusing cached validation decision for step ${step.index}: success=${cachedValResult.success}`,
                );
                stepReport.validationResult = cachedValResult;
                stepReport.explanation = `${cachedValResult.explanation} (Cached)`;
                stepReport.cachedResponse = true;
                stepReport.cacheKey = cacheKey;
                stepReport.tokensUsed = 0;
                lastResult = cachedValResult;

                if (cachedValResult.success) {
                  validationPassed = true;
                  break;
                }

                if (!cachedValResult.pageStillLoading) {
                  break;
                }
              } else {
                const domStr = formatDOMState(elements);

                const systemPrompt = `You are Zeni Executor. Verify the validation statement against the current DOM.
Set success to true if the condition is completely met.
Set pageStillLoading to true if it failed ONLY because the page is still loading/skeleton loaders are visible.`;

                const userText = `### Validation Statement:\n${instruction}\n\n### Current Page DOM State:\n${domStr}`;

                const valParts: any[] = [
                  { text: `${systemPrompt}\n\n${userText}` },
                ];
                if (shouldSendScreenshot && stateRes.screenshotBase64) {
                  valParts.push({
                    inlineData: {
                      mimeType: "image/png",
                      data: stateRes.screenshotBase64,
                    },
                  });
                }

                const response = await this.ai.models.generateContent({
                  model: this.model,
                  contents: [
                    {
                      role: "user",
                      parts: valParts,
                    },
                  ],
                  config: {
                    temperature: 0.1,
                    responseMimeType: "application/json",
                    responseSchema: VALIDATE_SCHEMA,
                  },
                });

                const responseText = response.text || "{}";
                const valResult = JSON.parse(
                  responseText.replace(/```json\n?|\n?```/g, "").trim(),
                ) as StepResult;

                stepReport.validationResult = valResult;
                stepReport.tokensUsed +=
                  response.usageMetadata?.totalTokenCount ?? 0;
                totalTokensUsed += response.usageMetadata?.totalTokenCount ?? 0;
                stepReport.cacheKey = cacheKey;
                stepReport.cachedResponse = false;

                this.cache.set(cacheKey, valResult);
                lastResult = valResult;

                if (valResult.success) {
                  validationPassed = true;
                  break;
                }

                if (!valResult.pageStillLoading) {
                  break;
                }
              }
            }

            stepReport.success = validationPassed;
            stepReport.explanation = lastResult
              ? lastResult.explanation
              : "Validation failed.";
          }
        } catch (stepErr: any) {
          console.error(
            `[Executor] Step ${step.index} threw exception:`,
            stepErr.message || stepErr,
          );
          stepReport.success = false;
          stepReport.explanation = stepErr.message || String(stepErr);
        }

        // Capture screenshot after step
        try {
          const shotRes = await this.session.sendRequest<ClientRpcMessage>("TAKE_SCREENSHOT", {
            sessionId,
            fullPage: false,
          });
          if (shotRes.screenshotBase64) {
            stepReport.screenshotBase64 = shotRes.screenshotBase64;
          }
        } catch (imgErr) {
          console.warn(
            `[Executor] Failed to capture screenshot after step ${step.index}:`,
            imgErr,
          );
        }

        stepReport.executionTimeMs = Date.now() - stepStartTime;
        stepReports.push(stepReport);

        if (onProgress) {
          onProgress({
            stepIndex: step.index,
            totalSteps: testCase.steps.length,
            stepType: step.type,
            description: maskedStepDescription,
            status: stepReport.success ? "passed" : "failed",
          });
        }

        if (!stepReport.success) {
          console.log(
            `[Executor] Step ${step.index} failed. Aborting remaining steps for test case ${testCase.id}.`,
          );
          overallSuccess = false;
          break;
        }
      }
    } catch (err: any) {
      console.error(
        `[Executor] Execution failed for test case ${testCase.id}:`,
        err,
      );
      overallSuccess = false;
    }

    // Retrieve network and console reports from client
    let networkReports: NetworkReportItem[] = [];
    let logReports: LogReportItem[] = [];
    try {
      const reportsRes = await this.session.sendRequest<ClientRpcMessage>("GET_SESSION_REPORTS", {
        sessionId,
      });
      if (reportsRes.networkReports) networkReports = reportsRes.networkReports;
      if (reportsRes.logReports) logReports = reportsRes.logReports;
    } catch (_) {}

    // Close page on client
    await this.session.sendRequest("CLOSE_PAGE", { sessionId }).catch(() => {});

    const totalExecutionTimeMs = Date.now() - startTime;

    return {
      testCaseId: testCase.id,
      title: testCase.title,
      overallSuccess,
      targetURL:
        testCase.prodURL ||
        testCase.prodUrl ||
        testCase.localURL ||
        testCase.localUrl ||
        "/",
      stepReports,
      networkReports,
      logReports,
      info: {
        specFile: (testCase as any).fileName || `${testCase.id}.yaml`,
        browser: "chromium (client playwright)",
        duration: `${(totalExecutionTimeMs / 1000).toFixed(1)}s`,
        url:
          testCase.prodURL ||
          testCase.prodUrl ||
          testCase.localURL ||
          testCase.localUrl ||
          "/",
      },
      totalExecutionTimeMs,
      totalTokensUsed,
    };
  }

  public async run(
    testCase: TestCase,
    onProgress?: (progress: {
      stepIndex: number;
      totalSteps: number;
      stepType: string;
      description: string;
      status: "running" | "passed" | "failed";
    }) => void,
    options?: ExecutorOptions,
  ): Promise<TestCaseExecutionReport> {
    return await this.runWithContext(testCase, onProgress, options);
  }
}
