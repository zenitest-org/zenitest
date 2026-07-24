import "dotenv/config";
import { chromium, Page, Locator } from "playwright-core";
import OpenAI from "openai";
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

  public generateKey(instruction: string, elements: DOMElement[], url?: string): string {
    const serializedElements = elements.map((e) => ({
      tag: e.tagName,
      id: e.id,
      text: e.text,
      aria: e.ariaLabel,
      placeholder: e.placeholder,
      role: e.role,
      value: e.value,
    }));

    const raw = `act:${url || ""}:${instruction}:${JSON.stringify(serializedElements)}`;
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
      await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await locator.click({ timeout: 5000 });
      break;

    case "doubleClick":
      if (!locator) throw new Error(`No locator found for target: ${targetElementId}`);
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
  type: "json_schema",
  json_schema: {
    name: "act_response",
    strict: true,
    schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["click", "doubleClick", "type", "press", "scroll", "hover", "select", "dragAndDrop", "nav", "done"],
          description: "The action type to perform",
        },
        targetElementId: { type: ["string", "null"], description: "ID or index of element to interact with" },
        targetDescription: { type: ["string", "null"], description: "Visual or structural description of target element" },
        text: { type: ["string", "null"], description: "Text payload if action is 'type'" },
        direction: { type: ["string", "null"], enum: ["up", "down", "left", "right", "top", "bottom", null], description: "Direction if action is 'scroll'" },
        key: { type: ["string", "null"], description: "Key name if action is 'press'" },
        value: { type: ["string", "null"], description: "Option value if action is 'select'" },
        toElementId: { type: ["string", "null"], description: "Target element ID if action is 'dragAndDrop'" },
        url: { type: ["string", "null"], description: "URL if action is 'nav'" },
        reasoning: { type: "string", description: "Step-by-step reasoning for choosing this action" },
      },
      required: ["action", "targetElementId", "targetDescription", "text", "direction", "key", "value", "toElementId", "url", "reasoning"],
      additionalProperties: false,
    },
  },
};

const VALIDATE_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "validate_response",
    strict: true,
    schema: {
      type: "object",
      properties: {
        success: { type: "boolean", description: "true if the validation criteria is met, false otherwise" },
        explanation: { type: "string", description: "Reason for result" },
        pageStillLoading: { type: "boolean", description: "true if page is not settled yet" },
      },
      required: ["success", "explanation", "pageStillLoading"],
      additionalProperties: false,
    },
  },
};

/* ==========================================================================
   Executor Class
   ========================================================================== */

export class Executor {
  private cdpUrl: string;
  private openai: OpenAI;
  private model: string;
  private cache: ExecutorCache;

  constructor(cdpUrl: string) {
    this.cdpUrl = cdpUrl;
    
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("Missing GEMINI_API_KEY environment variable");
    }

    const baseURL = process.env.OPENAI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai/";
    this.openai = new OpenAI({ apiKey, baseURL });
    this.model = process.env.ZENI_MODEL || "gemini-3.5-flash";
    this.cache = new ExecutorCache();
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
    }) => void
  ): Promise<TestCaseExecutionReport> {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    const startTime = Date.now();
    const stepReports: StepExecutionReport[] = [];
    let overallSuccess = true;
    let totalTokensUsed = 0;

    try {
      for (const step of testCase.steps) {
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
              
              const completion = await this.openai.chat.completions.create({
                model: this.model,
                temperature: 0.1,
                messages: [
                  { role: "system", content: systemPrompt },
                  { role: "user", content: [
                    { type: "text", text: userText },
                    { type: "image_url", image_url: { url: `data:image/png;base64,${state.screenshotBase64}` } }
                  ]}
                ],
                response_format: ACT_SCHEMA as any,
              });

              const responseText = completion.choices[0]?.message?.content || "{}";
              const actResult = JSON.parse(responseText.replace(/```json\n?|\n?```/g, "").trim()) as ActResult;

              stepReport.actResult = actResult;
              stepReport.explanation = actResult.reasoning;
              stepReport.tokensUsed = completion.usage?.total_tokens ?? 0;
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
              const domStr = formatDOMState(state.elements);

              const systemPrompt = `You are Zeni Executor. Verify the validation statement against the current DOM.
Set success to true if the condition is completely met.
Set pageStillLoading to true if it failed ONLY because the page is still loading/skeleton loaders are visible.`;

              const userText = `### Validation Statement:\n${instruction}\n\n### Current Page DOM State:\n${domStr}`;

              const completion = await this.openai.chat.completions.create({
                model: this.model,
                temperature: 0.1,
                messages: [
                  { role: "system", content: systemPrompt },
                  { role: "user", content: [
                    { type: "text", text: userText },
                    { type: "image_url", image_url: { url: `data:image/png;base64,${state.screenshotBase64}` } }
                  ]}
                ],
                response_format: VALIDATE_SCHEMA as any,
              });

              const responseText = completion.choices[0]?.message?.content || "{}";
              const valResult = JSON.parse(responseText.replace(/```json\n?|\n?```/g, "").trim()) as StepResult;

              stepReport.validationResult = valResult;
              stepReport.tokensUsed += completion.usage?.total_tokens ?? 0;
              totalTokensUsed += completion.usage?.total_tokens ?? 0;
              lastResult = valResult;

              if (valResult.success) {
                validationPassed = true;
                break;
              }

              if (!valResult.pageStillLoading) {
                break;
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

    return {
      testCaseId: testCase.id,
      title: testCase.title,
      overallSuccess,
      targetURL: testCase.prodURL || testCase.localURL || "",
      stepReports,
      totalExecutionTimeMs: Date.now() - startTime,
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
