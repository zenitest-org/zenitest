import "dotenv/config";
import { chromium, Page, Locator } from "playwright-core";
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
  StepResult
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

  public generateKey(instruction: string, elements: DOMElement[], url?: string, type: string = "act"): string {
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
    if (process.env.DISABLE_EXECUTOR_CACHE === "true" || process.env.NO_CACHE === "true") {
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
    if (process.env.DISABLE_EXECUTOR_CACHE === "true" || process.env.NO_CACHE === "true") {
      return;
    }
    try {
      const filePath = join(this.cacheDir, `${key}.json`);
      writeFileSync(filePath, JSON.stringify({ key, result, createdAt: new Date().toISOString() }, null, 2), "utf-8");
    } catch (err: any) {
      console.warn("[Executor Cache] Failed to write cache:", err.message);
    }
  }
}

/* ==========================================================================
   Helper Functions for DOM Setteled & State Extraction
   ========================================================================== */

async function waitForDomNetworkQuiet(page: Page, timeoutMs: number = 3000): Promise<void> {
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: Math.min(timeoutMs, 2000) }).catch(() => {});
    await page.waitForTimeout(300);
  } catch {
    // Ignore timeout errors during settling
  }
}

async function extractPageState(page: Page): Promise<{ elements: DOMElement[]; screenshotBase64: string; title: string; url: string }> {
  await waitForDomNetworkQuiet(page);
  const screenshotBuffer = await page.screenshot({ type: "png" });
  const screenshotBase64 = screenshotBuffer.toString("base64");
  const title = await page.title();
  const url = page.url();

  const elementsScript = `
    (() => {
      const sibIndex = (n) => {
        if (!n || !n.parentNode) return 1;
        let i = 1;
        const targetKey = n.nodeType + ':' + (n.nodeName || '').toLowerCase();
        for (let p = n.previousSibling; p; p = p.previousSibling) {
          const key = p.nodeType + ':' + (p.nodeName || '').toLowerCase();
          if (key === targetKey) i += 1;
        }
        return i;
      };

      const computeAbsoluteXPath = (node) => {
        const parts = [];
        let cur = node;
        while (cur && cur.nodeType !== Node.DOCUMENT_NODE) {
          if (cur.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
            parts.push('//');
            cur = cur.host || null;
            continue;
          }
          const tag = (cur.nodeName || '').toLowerCase();
          const step = tag.indexOf(':') !== -1 ? "*[name()='" + tag + "']" : tag + '[' + sibIndex(cur) + ']';
          parts.push(step);
          cur = cur.parentNode;
        }
        parts.reverse();
        return '/' + parts.join('/');
      };

      const interactiveSelectors = [
        "a[href]", "button", "input", "textarea", "select", "details", "summary", "form",
        "[role='button']", "[role='link']", "[role='searchbox']", "[role='textbox']",
        "[role='checkbox']", "[role='radio']", "[role='combobox']", "[role='option']",
        "[role='menuitem']", "[role='tab']", "[onclick]", "[tabindex]",
        "h1", "h2", "h3", "h4", "nav", "main", "header", "footer"
      ].join(",");

      const collectInteractiveElements = (root) => {
        let list = Array.from(root.querySelectorAll(interactiveSelectors));
        const allNodes = root.querySelectorAll('*');
        for (let i = 0; i < allNodes.length; i++) {
          const node = allNodes[i];
          if (node.shadowRoot) {
            list = list.concat(collectInteractiveElements(node.shadowRoot));
          }
        }
        return list;
      };

      const rawElements = collectInteractiveElements(document);

      return rawElements.map((el, index) => {
        const element = el;
        const existingId = element.getAttribute("id");
        const elementId = existingId ? existingId : "elem-" + index;
        element.setAttribute("data-element-id", String(elementId));

        const tagName = element.tagName;
        const text = (element.innerText || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 200);
        const placeholder = element.getAttribute("placeholder") || undefined;
        const ariaLabel = element.getAttribute("aria-label") || undefined;
        const role = element.getAttribute("role") || undefined;
        const href = element.getAttribute("href") || undefined;
        const inputType = element.getAttribute("type") || undefined;
        const inputName = element.getAttribute("name") || undefined;
        const value = inputType === "password" ? (element.value ? "********" : undefined) : (element.value || undefined);

        const disabled = element.disabled === true || element.hasAttribute("disabled");
        const checked = element.checked === true || element.hasAttribute("checked");
        const xpath = computeAbsoluteXPath(element);

        let selector = '[data-element-id="' + elementId + '"]';
        if (element.id && typeof CSS !== 'undefined' && CSS.escape) {
          selector = '#' + CSS.escape(element.id);
        }

        const rect = element.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0 && window.getComputedStyle(element).visibility !== "hidden";
        const inViewport =
          rect.top >= 0 && rect.left >= 0 &&
          rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
          rect.right <= (window.innerWidth || document.documentElement.clientWidth);

        const attributes = {};
        if (inputType) attributes.type = inputType;
        if (inputName) attributes.name = inputName;
        if (href) attributes.href = href;

        return {
          id: elementId,
          tagName,
          text,
          value,
          placeholder,
          ariaLabel,
          role,
          selector,
          xpath,
          attributes,
          isInteractive: true,
          href,
          disabled,
          checked,
          isVisible,
          inViewport,
          rect: {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        };
      });
    })()
  `;

  const elements = (await page.evaluate(elementsScript)) as DOMElement[];
  return { elements, screenshotBase64, title, url };
}

async function getLocatorForTarget(page: Page, targetId?: string | number): Promise<Locator | null> {
  if (!targetId) return null;
  const idStr = String(targetId).trim();
  if (idStr.startsWith("xpath=")) return page.locator(idStr).first();
  if (idStr.startsWith("/") || idStr.startsWith("./")) return page.locator(`xpath=${idStr}`).first();
  if (idStr.startsWith("#") || idStr.startsWith(".") || idStr.startsWith("[")) return page.locator(idStr).first();

  const elementSelector = `[data-element-id="${idStr}"]`;
  const elementLocator = page.locator(elementSelector).first();
  if (await elementLocator.count() > 0) return elementLocator;

  const idLocator = page.locator(`#${idStr}`).first();
  if (await idLocator.count() > 0) return idLocator;

  return page.locator(`${elementSelector}, #${idStr}`).first();
}

async function isElementDisabled(locator: Locator): Promise<boolean> {
  try {
    if (await locator.isDisabled({ timeout: 1000 })) return true;
    const ariaDisabled = await locator.getAttribute("aria-disabled", { timeout: 1000 }).catch(() => null);
    if (ariaDisabled === "true") return true;
  } catch {
    // Ignore resolution errors
  }
  return false;
}

async function executeActionOnPage(page: Page, actResult: ActResult): Promise<boolean> {
  const { action, targetElementId, text, key, direction, value, toElementId, url } = actResult;
  console.log(`[Executor] Performing action: ${action} | Target: ${targetElementId || "N/A"}`);

  if (action === "done") {
    return true;
  }

  if (action === "nav" && url) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await waitForDomNetworkQuiet(page);
    return false;
  }

  const locator = await getLocatorForTarget(page, targetElementId);

  switch (action) {
    case "click":
      if (!locator) throw new Error(`No locator found for target: ${targetElementId}`);
      if (await isElementDisabled(locator)) {
        throw new Error(`Cannot perform click: element '${targetElementId}' is disabled.`);
      }
      await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await locator.click({ timeout: 5000 });
      break;

    case "doubleClick":
      if (!locator) throw new Error(`No locator found for target: ${targetElementId}`);
      if (await isElementDisabled(locator)) {
        throw new Error(`Cannot perform doubleClick: element '${targetElementId}' is disabled.`);
      }
      await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await locator.dblclick({ timeout: 5000 });
      break;

    case "type":
      if (!locator) throw new Error(`No locator found for target: ${targetElementId}`);
      await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await locator.fill("", { timeout: 3000 }).catch(() => {});
      await locator.fill(text || "", { timeout: 5000 });
      break;

    case "press":
      const keyStr = key || "Enter";
      if (locator && (await locator.count()) > 0) {
        if (await isElementDisabled(locator)) {
          throw new Error(`Cannot perform press: element '${targetElementId}' is disabled.`);
        }
        await locator.press(keyStr, { timeout: 5000 });
      } else {
        await page.keyboard.press(keyStr);
      }
      break;

    case "scroll":
      if (direction === "top") await page.evaluate(() => window.scrollTo(0, 0));
      else if (direction === "bottom") await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      else if (direction === "up") await page.evaluate(() => window.scrollBy(0, -500));
      else if (direction === "left") await page.evaluate(() => window.scrollBy(-300, 0));
      else if (direction === "right") await page.evaluate(() => window.scrollBy(300, 0));
      else await page.evaluate(() => window.scrollBy(0, 500));
      break;

    case "hover":
      if (!locator) throw new Error(`No locator found for target: ${targetElementId}`);
      await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await locator.hover({ timeout: 5000 });
      break;

    case "select":
      if (!locator) throw new Error(`No locator found for target: ${targetElementId}`);
      if (await isElementDisabled(locator)) {
        throw new Error(`Cannot perform select: element '${targetElementId}' is disabled.`);
      }
      await locator.selectOption(value || text || "", { timeout: 5000 });
      break;

    case "dragAndDrop":
      if (!locator) throw new Error(`No locator found for target: ${targetElementId}`);
      const targetLocator = await getLocatorForTarget(page, toElementId);
      if (!targetLocator) throw new Error(`No locator found for drop target: ${toElementId}`);
      await locator.dragTo(targetLocator, { timeout: 5000 });
      break;

    default:
      console.warn(`[Executor] Unhandled action type: ${action}`);
  }

  await waitForDomNetworkQuiet(page);
  return false;
}

/* ==========================================================================
   Prompt Builders and Formatting
   ========================================================================== */

function formatDOMState(dom?: DOMElement[]): string {
  if (!dom || dom.length === 0) return "No DOM content provided.";
  return dom
    .map((el, index) => {
      const idStr = el.id !== undefined ? `[ID: ${el.id}]` : `[Index: ${index}]`;
      const tagStr = el.tagName ? `<${el.tagName.toLowerCase()}>` : "";
      const roleStr = el.role ? `role="${el.role}"` : "";
      const textStr = el.text ? `text="${el.text.trim()}"` : "";
      const valStr = el.value ? `value="${el.value}"` : "";
      const placeholderStr = el.placeholder ? `placeholder="${el.placeholder}"` : "";
      const ariaStr = el.ariaLabel ? `aria-label="${el.ariaLabel}"` : "";
      const hrefStr = el.href ? `href="${el.href}"` : "";
      const disabledStr = el.disabled ? `disabled="true"` : "";
      const checkedStr = el.checked ? `checked="true"` : "";
      const xpathStr = el.xpath ? `xpath="${el.xpath}"` : "";

      const attributes = [
        tagStr, roleStr, textStr, valStr, placeholderStr, ariaStr, hrefStr, disabledStr, checkedStr, xpathStr
      ].filter(Boolean).join(" ");

      return `${idStr} ${attributes}`.trim();
    })
    .join("\n");
}

function substituteVariables(instruction: string, variables?: Record<string, any>): string {
  if (!variables || typeof variables !== "object") return instruction;
  let result = instruction;
  for (const [key, rawVal] of Object.entries(variables)) {
    if (rawVal === undefined || rawVal === null) continue;
    const value = String(rawVal);
    result = result
      .replaceAll(`\$\{${key}\}`, value)
      .replaceAll(`{${key}}`, value)
      .replaceAll(`%${key}%`, value);
  }
  return result;
}

function maskSecretsInText(text: string): string {
  if (!text || typeof text !== "string") return text;
  return text.replace(/\$\{secret\.[a-zA-Z0-9_]+\}/g, "******");
}

function resolveFullURL(pathOrUrl: string, baseLocalUrl?: string, baseProdUrl?: string, targetType: "prod" | "local" = "prod"): string {
  const trimmed = pathOrUrl.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  let baseUrl = targetType === "local" ? baseLocalUrl : baseProdUrl;
  if (!baseUrl) {
    baseUrl = baseProdUrl || baseLocalUrl || "http://localhost:3000";
  }
  let formattedBase = baseUrl.trim();
  if (!formattedBase.startsWith("http://") && !formattedBase.startsWith("https://")) {
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
      enum: ["click", "doubleClick", "type", "press", "scroll", "hover", "select", "dragAndDrop", "nav", "done"],
      description: "The action type to perform",
    },
    targetElementId: { type: Type.STRING, description: "ID or index of element to interact with", nullable: true },
    targetDescription: { type: Type.STRING, description: "Visual or structural description of target element", nullable: true },
    text: { type: Type.STRING, description: "Text payload if action is 'type'", nullable: true },
    direction: { type: Type.STRING, enum: ["up", "down", "left", "right", "top", "bottom"], description: "Direction if action is 'scroll'", nullable: true },
    key: { type: Type.STRING, description: "Key name if action is 'press'", nullable: true },
    value: { type: Type.STRING, description: "Option value if action is 'select'", nullable: true },
    toElementId: { type: Type.STRING, description: "Target element ID if action is 'dragAndDrop'", nullable: true },
    url: { type: Type.STRING, description: "URL if action is 'nav'", nullable: true },
    reasoning: { type: Type.STRING, description: "Step-by-step reasoning for choosing this action" },
  },
  required: ["action", "reasoning"],
};

const VALIDATE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    success: { type: Type.BOOLEAN, description: "true if the validation criteria is met, false otherwise" },
    explanation: { type: Type.STRING, description: "Reason for result" },
    pageStillLoading: { type: Type.BOOLEAN, description: "true if page is not settled yet" },
  },
  required: ["success", "explanation", "pageStillLoading"],
};

/* ==========================================================================
   Executor Class
   ========================================================================== */

export interface ExecutorOptions {
  sendScreenshot?: boolean;
}

export class Executor {
  private cdpUrl: string;
  private ai: GoogleGenAI;
  private model: string;
  private cache: ExecutorCache;
  private sendScreenshot: boolean;

  constructor(cdpUrl: string, options?: ExecutorOptions) {
    this.cdpUrl = cdpUrl;
    
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("Missing GEMINI_API_KEY environment variable");
    }

    this.ai = new GoogleGenAI({ apiKey });
    this.model = process.env.ZENI_MODEL || "gemini-3.5-flash-lite";
    this.cache = new ExecutorCache();
    this.sendScreenshot = options?.sendScreenshot ?? (process.env.SEND_SCREENSHOT === "true" || process.env.SEND_SCREENSHOT_TO_GEMINI === "true");
  }

  public async runWithContext(
    testCase: TestCase,
    context: any,
    onProgress?: (progress: {
      stepIndex: number;
      totalSteps: number;
      stepType: string;
      description: string;
      status: "running" | "passed" | "failed";
    }) => void,
    options?: ExecutorOptions
  ): Promise<TestCaseExecutionReport> {
    const shouldSendScreenshot = options?.sendScreenshot ?? this.sendScreenshot;
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    const startTime = Date.now();
    const stepReports: StepExecutionReport[] = [];
    let overallSuccess = true;
    let totalTokensUsed = 0;

    const networkReports: any[] = [];
    const logReports: any[] = [];

    const getFormattedTime = () => {
      const elapsed = Date.now() - startTime;
      const sec = Math.floor(elapsed / 1000);
      const ms = elapsed % 1000;
      return `${String(sec).padStart(2, "0")}:${String(ms).padStart(3, "0")}`;
    };

    logReports.push({
      id: `l-${logReports.length + 1}`,
      timestamp: getFormattedTime(),
      level: "info",
      message: `Starting execution for test case "${testCase.title}" (${testCase.id})`,
    });

    page.on("response", async (res: any) => {
      try {
        const req = res.request();
        const urlStr = req.url();
        if (urlStr.startsWith("http://") || urlStr.startsWith("https://")) {
          const timing = req.timing();
          const durationMs = timing && timing.responseEnd > 0 ? Math.round(timing.responseEnd) : 0;
          const timeStr = durationMs > 0 ? `${durationMs}ms` : "—";

          const displayUrl = urlStr;

          let reqHeaders: Record<string, string> = {};
          try {
            reqHeaders = req.headers() || {};
          } catch (_) {}

          let reqBody: string | null = null;
          try {
            const rawReqBody = req.postData() || null;
            if (rawReqBody) {
              reqBody = rawReqBody.replace(/\u0000/g, "").replace(/\\u0000/g, "");
            }
          } catch (_) {}

          let resHeaders: Record<string, string> = {};
          try {
            resHeaders = res.headers() || {};
          } catch (_) {}

          let resBody: string | null = null;
          try {
            const contentType = (resHeaders["content-type"] || "").toLowerCase();
            const isBinary =
              contentType.includes("image/") ||
              contentType.includes("font/") ||
              contentType.includes("video/") ||
              contentType.includes("audio/") ||
              contentType.includes("application/octet-stream") ||
              contentType.includes("application/zip") ||
              contentType.includes("application/pdf") ||
              contentType.includes("application/gzip") ||
              contentType.includes("application/protobuf") ||
              contentType.includes("application/x-protobuf");

            if (isBinary) {
              resBody = "[Binary Data]";
            } else {
              const buffer = await res.body().catch(() => null);
              if (buffer) {
                const maxLen = 50000;
                const rawStr =
                  buffer.length <= maxLen
                    ? buffer.toString("utf-8")
                    : buffer.slice(0, maxLen).toString("utf-8") + "\n... [truncated]";
                resBody = rawStr.replace(/\u0000/g, "").replace(/\\u0000/g, "");
              }
            }
          } catch (_) {}

          networkReports.push({
            id: `n-${networkReports.length + 1}`,
            method: req.method(),
            url: displayUrl,
            status: res.status(),
            time: timeStr,
            requestHeaders: reqHeaders,
            requestBody: reqBody,
            responseHeaders: resHeaders,
            responseBody: resBody,
          });
        }
      } catch (_) {}
    });

    page.on("console", (msg: any) => {
      try {
        const type = msg.type();
        const level = type === "error" ? "error" : type === "warning" || type === "warn" ? "warn" : "info";
        logReports.push({
          id: `l-${logReports.length + 1}`,
          timestamp: getFormattedTime(),
          level,
          message: msg.text(),
        });
      } catch (_) {}
    });

    page.on("pageerror", (err: any) => {
      try {
        logReports.push({
          id: `l-${logReports.length + 1}`,
          timestamp: getFormattedTime(),
          level: "error",
          message: `Uncaught Exception: ${err.message || String(err)}`,
        });
      } catch (_) {}
    });

    try {
      const normalizedSteps = (testCase.steps || []).map((s: any, idx: number) => {
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

      for (const step of normalizedSteps) {
        const stepStartTime = Date.now();
        const stepDescription = substituteVariables(step.description || step.url || "/", testCase.variables);
        const maskedStepDescription = maskSecretsInText(stepDescription);
        console.log(`[Executor] Processing step ${step.index}: ${maskedStepDescription}`);

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
            const targetUrl = resolveFullURL(navPath, testCase.localURL, testCase.prodURL, "prod");
            console.log(`[Executor] Navigating browser page to ${targetUrl}`);
            await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
            await waitForDomNetworkQuiet(page);
            stepReport.explanation = `Successfully navigated to ${targetUrl}`;
            stepReport.success = true;
          } 
          else if (step.type === "act") {
            const state = await extractPageState(page);
            stepReport.screenshotBase64 = state.screenshotBase64;

            const instruction = stepDescription;
            const cacheKey = this.cache.generateKey(instruction, state.elements, state.url);
            const cachedActResult = this.cache.get<ActResult>(cacheKey);

            if (cachedActResult) {
              console.log(`[Executor Cache HIT] Reusing cached action decision for step ${step.index}: ${cachedActResult.action}`);
              stepReport.actResult = cachedActResult;
              stepReport.explanation = `${cachedActResult.reasoning} (Cached)`;
              stepReport.cachedResponse = true;
              stepReport.cacheKey = cacheKey;
              stepReport.tokensUsed = 0;

              await executeActionOnPage(page, cachedActResult);
              stepReport.success = true;
            } else {
              const domStr = formatDOMState(state.elements);

              const systemPrompt = `You are Zeni Executor. Analyze the DOM and choose the single best action to fulfill the instruction.
Valid actions: 'click', 'doubleClick', 'type', 'press', 'scroll', 'hover', 'select', 'dragAndDrop', 'nav', 'done'.
If the goal is fully accomplished, set action to 'done'.`;

              const userText = `### Instruction:\n${instruction}\n\n### Current Page DOM State:\n${domStr}`;
              
              const actParts: any[] = [{ text: `${systemPrompt}\n\n${userText}` }];
              if (shouldSendScreenshot && state.screenshotBase64) {
                actParts.push({
                  inlineData: {
                    mimeType: "image/png",
                    data: state.screenshotBase64,
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
              const actResult = JSON.parse(responseText.replace(/```json\n?|\n?```/g, "").trim()) as ActResult;

              stepReport.actResult = actResult;
              stepReport.explanation = actResult.reasoning;
              stepReport.tokensUsed = response.usageMetadata?.totalTokenCount ?? 0;
              totalTokensUsed += stepReport.tokensUsed;
              stepReport.cacheKey = cacheKey;
              stepReport.cachedResponse = false;

              this.cache.set(cacheKey, actResult);

              console.log(`[Executor] Predicted action: ${actResult.action} | Reasoning: ${actResult.reasoning}`);
              await executeActionOnPage(page, actResult);
              stepReport.success = true;
            }
          } 
          else if (step.type === "validate") {
            const maxAttempts = 5;
            let validationPassed = false;
            let lastResult: StepResult | undefined;

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
              if (attempt > 1) {
                console.log(`[Executor] Validation attempt ${attempt} waiting for page to settle...`);
                await page.waitForTimeout(2000);
              }

              const state = await extractPageState(page);
              stepReport.screenshotBase64 = state.screenshotBase64;

              const instruction = stepDescription;
              const cacheKey = this.cache.generateKey(instruction, state.elements, state.url, "validate");
              const cachedValResult = this.cache.get<StepResult>(cacheKey);

              if (cachedValResult) {
                console.log(`[Executor Cache HIT] Reusing cached validation decision for step ${step.index}: success=${cachedValResult.success}`);
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
                const domStr = formatDOMState(state.elements);

                const systemPrompt = `You are Zeni Executor. Verify the validation statement against the current DOM.
Set success to true if the condition is completely met.
Set pageStillLoading to true if it failed ONLY because the page is still loading/skeleton loaders are visible.`;

                const userText = `### Validation Statement:\n${instruction}\n\n### Current Page DOM State:\n${domStr}`;

                const valParts: any[] = [{ text: `${systemPrompt}\n\n${userText}` }];
                if (shouldSendScreenshot && state.screenshotBase64) {
                  valParts.push({
                    inlineData: {
                      mimeType: "image/png",
                      data: state.screenshotBase64,
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
                const valResult = JSON.parse(responseText.replace(/```json\n?|\n?```/g, "").trim()) as StepResult;

                stepReport.validationResult = valResult;
                stepReport.tokensUsed += response.usageMetadata?.totalTokenCount ?? 0;
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
            stepReport.explanation = lastResult ? lastResult.explanation : "Validation failed.";
          }
        } catch (stepErr: any) {
          console.error(`[Executor] Step ${step.index} threw exception:`, stepErr.message || stepErr);
          stepReport.success = false;
          stepReport.explanation = stepErr.message || String(stepErr);
        }

        // Always capture screenshot after step execution
        try {
          const screenshotBuffer = await page.screenshot({ type: "png", fullPage: false });
          stepReport.screenshotBase64 = screenshotBuffer.toString("base64");
        } catch (imgErr) {
          console.warn(`[Executor] Failed to capture screenshot after step ${step.index}:`, imgErr);
        }

        stepReport.executionTimeMs = Date.now() - stepStartTime;
        stepReports.push(stepReport);

        if (onProgress) {
          onProgress({
            stepIndex: step.index,
            totalSteps: testCase.steps.length,
            stepType: step.type,
            description: stepReport.description,
            status: stepReport.success ? "passed" : "failed",
          });
        }

        if (!stepReport.success) {
          overallSuccess = false;
          console.warn(`[Executor] Step ${step.index} failed. Aborting further steps.`);
          break;
        }
      }
      console.log(`[Server Log] Test case "${testCase.title}" (${testCase.id}) completed in ${Date.now() - startTime} ms. LLM Tokens Used: ${totalTokensUsed}`);
    } catch (err: any) {
      console.error("[Executor] Execution error:", err);
      overallSuccess = false;
    } finally {
      await page.close().catch(() => {});
    }

    const totalExecutionTimeMs = Date.now() - startTime;
    const info = {
      specFile: testCase.id ? `${testCase.id}.yaml` : "test.yaml",
      browser: "Chromium 124.0",
      duration: `${(totalExecutionTimeMs / 1000).toFixed(1)}s`,
      url: testCase.prodURL || testCase.localURL || "—",
    };

    return {
      testCaseId: testCase.id,
      title: testCase.title,
      overallSuccess,
      targetURL: testCase.prodURL || testCase.localURL || "",
      stepReports,
      networkReports,
      logReports,
      info,
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
    }) => void
  ): Promise<TestCaseExecutionReport> {
    console.log(`[Executor] Connecting to client browser at ${this.cdpUrl}`);
    const browser = await chromium.connectOverCDP(this.cdpUrl);
    const context = await browser.newContext();
    try {
      return await this.runWithContext(testCase, context, onProgress);
    } finally {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  }
}
