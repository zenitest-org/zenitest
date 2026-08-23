import "dotenv/config";
import { GoogleGenAI, Type } from "@google/genai";
import {
  TestCase,
  TestCaseExecutionReport,
  StepExecutionReport,
  NetworkReportItem,
  LogReportItem,
  DOMElement,
  ActResult,
  StepResult,
  MobileExecutionOptions,
  ServerRpcMessage,
  ClientRpcMessage,
} from "./types";
import { ExecutorCache, ClientWebSocketSession } from "./executor";
import { WebSocket } from "ws";

const MOBILE_ACT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    action: {
      type: Type.STRING,
      enum: ["click", "type", "scroll", "press", "done"],
      description:
        "The gesture or action to perform. For click/type instructions, always use 'click'/'type' directly with targetElementId; never use 'scroll' for clicking elements.",
    },
    targetElementId: {
      type: Type.STRING,
      description:
        "Accessibility ID, resource ID, or text label of target element",
    },
    text: {
      type: Type.STRING,
      description: "Text to type if action is type",
    },
    reasoning: {
      type: Type.STRING,
      description: "Brief explanation of why this action was chosen",
    },
  },
  required: ["action", "reasoning"],
};

const MOBILE_VALIDATE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    success: {
      type: Type.BOOLEAN,
      description: "Whether the validation assertion passed or failed",
    },
    explanation: {
      type: Type.STRING,
      description: "Brief reason why the assertion passed or failed",
    },
    pageStillLoading: {
      type: Type.BOOLEAN,
      description: "Whether the screen is still loading content",
    },
  },
  required: ["success", "explanation"],
};

function formatMobileDOM(elements: DOMElement[]): string {
  if (!elements || elements.length === 0) return "No interactive elements detected on screen.";
  return elements
    .map((el) => {
      const parts = [`ID: "${el.id}"`, `Type: <${el.tagName || el.role}>`];
      if (el.text) parts.push(`Text: "${el.text}"`);
      if (el.value) parts.push(`Value: "${el.value}"`);
      if (el.ariaLabel) parts.push(`Label: "${el.ariaLabel}"`);
      if (el.rect)
        parts.push(
          `Bounds: [x:${el.rect.left}, y:${el.rect.top}, w:${el.rect.width}, h:${el.rect.height}]`,
        );
      return `- ${parts.join(" | ")}`;
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

export class MobileExecutor {
  private ai: GoogleGenAI;
  private session: ClientWebSocketSession;
  private cache = new ExecutorCache();
  private model: string = "gemini-2.5-flash";

  constructor(clientWs: WebSocket, apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY || "";
    this.ai = new GoogleGenAI({ apiKey: key });
    this.session = new ClientWebSocketSession(clientWs);
  }

  public async executeTestCase(
    testCase: TestCase,
    options: MobileExecutionOptions,
    onStepReport?: (report: StepExecutionReport) => void,
  ): Promise<TestCaseExecutionReport> {
    const startTime = Date.now();
    const sessionId = `mob_${testCase.id || "tc"}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    let totalTokensUsed = 0;
    const stepReports: StepExecutionReport[] = [];
    let overallSuccess = true;

    console.log(
      `\n=====================================================================================`,
    );
    console.log(
      `[MobileExecutor] STARTING TEST CASE: "${testCase.title}" (${testCase.id})`,
    );
    console.log(`[MobileExecutor] Target Platform: ${options.platform}`);
    console.log(
      `=====================================================================================\n`,
    );

    try {
      // Initialize Mobile Session on Client (Local Appium / iOS Simulator)
      await this.session.sendRequest(
        "INIT_MOBILE_PAGE",
        {
          sessionId,
          platform: options.platform === "mobile-ios" || options.platform === "ios" ? "ios" : "android",
          appPath: options.appFilePath,
          bundleId: options.bundleId,
          deviceName: options.deviceName,
        },
        180000,
      );

      const normalizedSteps = (testCase.steps || []).map((s: any, idx: number) => {
        if (typeof s === "object" && s !== null) {
          let stepType = s.type;
          let stepDesc = s.description;

          if (!stepType) {
            if (s.navigate !== undefined) {
              stepType = "navigate";
              stepDesc = typeof s.navigate === "string" ? s.navigate : "/";
            } else if (s.act !== undefined) {
              stepType = "act";
              stepDesc = s.act;
            } else if (s.validate !== undefined) {
              stepType = "validate";
              stepDesc = s.validate;
            }
          }

          const rawDesc = stepDesc || "";
          const finalDesc = substituteVariables(rawDesc, testCase.variables);

          return {
            index: s.index ?? idx + 1,
            type: stepType || "act",
            description: finalDesc,
          };
        }
        return s;
      });
      for (const step of normalizedSteps) {
        const stepStartTime = Date.now();
        let stepSuccess = false;
        let explanation = "";
        let actResult: ActResult | undefined;
        let validationResult: StepResult | undefined;
        let stepTokens = 0;
        let screenshotBase64 = "";

        console.log(`[MobileExecutor] Processing Step ${step.index}: "${step.description}"`);

        try {
          if (step.type === "navigate") {
            // For mobile, navigate acts as a wait/settle step or deep link
            await this.session.sendRequest("WAIT", { sessionId, ms: 2000 });
            stepSuccess = true;
            explanation = "App screen loaded";
          } else if (step.type === "act") {
            // Fetch mobile screen state
            const stateRes = await this.session.sendRequest<ClientRpcMessage>("GET_PAGE_STATE", {
              sessionId,
              includeScreenshot: true,
            });
            screenshotBase64 = stateRes.screenshotBase64 || "";
            const mobileElements = stateRes.elements || [];

            const cacheKey = this.cache.generateKey(
              step.description,
              mobileElements,
              stateRes.url || "mobile",
              "mobile-act",
            );
            const cachedActResult = this.cache.get<ActResult>(cacheKey);

            if (cachedActResult) {
              console.log(
                `[MobileExecutor Cache HIT] Reusing cached action for step ${step.index}: ${cachedActResult.action}`,
              );
              actResult = cachedActResult;
              explanation = `${cachedActResult.reasoning} (Cached)`;

              const actRes = await this.session.sendRequest<ClientRpcMessage>("EXECUTE_ACTION", {
                sessionId,
                actResult: cachedActResult,
              });
              stepSuccess = actRes.success;
              if (!stepSuccess) explanation = actRes.error || "Action failed";
            } else {
              const domStr = formatMobileDOM(mobileElements);
              const systemPrompt = `You are Zeni Mobile Executor. Analyze the mobile screen elements and screenshot, then select the best action.
Valid actions: 'click', 'type', 'scroll', 'press', 'done'.

CRITICAL ACTION RULES:
1. DIRECT ACTION MATCHING:
   - If the instruction asks to click, tap, or press a button/element -> action MUST be 'click'.
   - If the instruction asks to type, enter, or fill text -> action MUST be 'type'.
2. NO INTERMEDIATE SCROLLING:
   - DO NOT choose 'scroll' when attempting to click/type an element that exists in the element tree. The mobile runner will target and interact with the element.
3. EXPLICIT SCROLL ONLY:
   - ONLY return action 'scroll' when the instruction explicitly requests scrolling (e.g. "Scroll down", "Swipe up") or when the target element is completely absent from the screen tree.
4. Target accessibility ID or name using targetElementId.`;

              const userText = `### Instruction:\n${step.description}\n\n### Current Screen Elements:\n${domStr}`;
              const actParts: any[] = [{ text: `${systemPrompt}\n\n${userText}` }];

              if (screenshotBase64) {
                actParts.push({
                  inlineData: {
                    mimeType: "image/png",
                    data: screenshotBase64.replace(/^data:image\/\w+;base64,/, ""),
                  },
                });
              }

              const response = await this.ai.models.generateContent({
                model: this.model,
                contents: [{ role: "user", parts: actParts }],
                config: {
                  temperature: 0.1,
                  responseMimeType: "application/json",
                  responseSchema: MOBILE_ACT_SCHEMA,
                },
              });

              const responseText = response.text || "{}";
              actResult = JSON.parse(
                responseText.replace(/```json\n?|\n?```/g, "").trim(),
              ) as ActResult;

              explanation = actResult.reasoning;
              stepTokens = response.usageMetadata?.totalTokenCount ?? 0;
              totalTokensUsed += stepTokens;
              console.log(
                `[MobileExecutor] Action: ${actResult.action} on "${actResult.targetElementId}" | ${actResult.reasoning}`,
              );

              const actRes = await this.session.sendRequest<ClientRpcMessage>("EXECUTE_ACTION", {
                sessionId,
                actResult,
              });
              stepSuccess = actRes.success;
              if (!stepSuccess) {
                explanation = actRes.error || "Action failed on mobile device";
              } else {
                this.cache.set(cacheKey, actResult);
              }
            }

            // Capture post-action screenshot
            try {
              const postShot = await this.session.sendRequest<ClientRpcMessage>("TAKE_SCREENSHOT", {
                sessionId,
              });
              if (postShot.screenshotBase64) screenshotBase64 = postShot.screenshotBase64;
            } catch (_) {}

          } else if (step.type === "validate") {
            const stateRes = await this.session.sendRequest<ClientRpcMessage>("GET_PAGE_STATE", {
              sessionId,
              includeScreenshot: true,
            });
            screenshotBase64 = stateRes.screenshotBase64 || "";
            const mobileElements = stateRes.elements || [];

            const cacheKey = this.cache.generateKey(
              step.description,
              mobileElements,
              stateRes.url || "mobile",
              "mobile-validate",
            );
            const cachedValResult = this.cache.get<StepResult>(cacheKey);

            if (cachedValResult) {
              console.log(
                `[MobileExecutor Cache HIT] Reusing cached validation for step ${step.index}: success=${cachedValResult.success}`,
              );
              validationResult = cachedValResult;
              stepSuccess = validationResult.success;
              explanation = `${validationResult.explanation} (Cached)`;
            } else {
              const domStr = formatMobileDOM(mobileElements);
              const systemPrompt = `You are Zeni Mobile Validator. Verify if the assertion is satisfied based on the screen elements and screenshot.
Set success to true if assertion passes.`;

              const userText = `### Assertion:\n${step.description}\n\n### Current Screen Elements:\n${domStr}`;
              const valParts: any[] = [{ text: `${systemPrompt}\n\n${userText}` }];

              if (screenshotBase64) {
                valParts.push({
                  inlineData: {
                    mimeType: "image/png",
                    data: screenshotBase64.replace(/^data:image\/\w+;base64,/, ""),
                  },
                });
              }

              const response = await this.ai.models.generateContent({
                model: this.model,
                contents: [{ role: "user", parts: valParts }],
                config: {
                  temperature: 0.1,
                  responseMimeType: "application/json",
                  responseSchema: MOBILE_VALIDATE_SCHEMA,
                },
              });

              const responseText = response.text || "{}";
              validationResult = JSON.parse(
                responseText.replace(/```json\n?|\n?```/g, "").trim(),
              ) as StepResult;

              stepSuccess = validationResult.success;
              explanation = validationResult.explanation;
              if (validationResult.success) {
                this.cache.set(cacheKey, validationResult);
              }
            }
          }
        } catch (err: any) {
          stepSuccess = false;
          explanation = `Step failed with error: ${err.message || String(err)}`;
        }

        const stepDuration = Date.now() - stepStartTime;
        if (!stepSuccess) overallSuccess = false;

        const report: StepExecutionReport = {
          index: step.index,
          type: step.type,
          description: step.description,
          success: stepSuccess,
          explanation,
          actResult,
          validationResult,
          executionTimeMs: stepDuration,
          tokensUsed: stepTokens,
          screenshotBase64,
        };

        stepReports.push(report);
        if (onStepReport) onStepReport(report);

        if (!stepSuccess) {
          console.log(`[MobileExecutor] Step ${step.index} failed. Aborting remaining steps.`);
          break;
        }
      }
    } catch (initErr: any) {
      console.error(`[MobileExecutor] Execution failed for ${testCase.id}:`, initErr);
      overallSuccess = false;
      const initReport: StepExecutionReport = {
        index: 0,
        type: "init",
        description: "Initialize Device",
        success: false,
        explanation: initErr.message || String(initErr),
        executionTimeMs: Date.now() - startTime,
        tokensUsed: 0,
      };
      stepReports.push(initReport);
      if (onStepReport) onStepReport(initReport);
    } finally {
      // Fetch session logs
      let logReports: LogReportItem[] = [];
      let networkReports: NetworkReportItem[] = [];
      try {
        const reportsRes = await this.session.sendRequest<ClientRpcMessage>("GET_SESSION_REPORTS", {
          sessionId,
        });
        if (reportsRes.logReports) logReports = reportsRes.logReports;
        if (reportsRes.networkReports) networkReports = reportsRes.networkReports;
      } catch (_) {}

      // Close mobile session on client
      await this.session.sendRequest("CLOSE_PAGE", { sessionId }).catch(() => {});

      return {
        testCaseId: testCase.id,
        title: testCase.title,
        overallSuccess,
        targetURL: options.bundleId || "iOS App",
        stepReports,
        networkReports,
        logReports,
        totalExecutionTimeMs: Date.now() - startTime,
        stepExecutionTimeMs: Date.now() - startTime,
        totalTokensUsed,
      };
    }
  }
}
