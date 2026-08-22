import { chromium, firefox, webkit, Browser, BrowserContext, Page, Locator } from "playwright";
import { WebSocket } from "ws";
import { execSync } from "child_process";

export interface DOMElement {
  id?: string | number;
  tagName?: string;
  role?: string;
  text?: string;
  value?: string;
  placeholder?: string;
  ariaLabel?: string;
  attributes?: Record<string, string>;
  xpath?: string;
  selector?: string;
  isInteractive?: boolean;
  href?: string;
  disabled?: boolean;
  checked?: boolean;
  isVisible?: boolean;
  inViewport?: boolean;
  rect?: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

export interface ActResult {
  action:
    | "click"
    | "doubleClick"
    | "type"
    | "press"
    | "scroll"
    | "hover"
    | "select"
    | "dragAndDrop"
    | "nav"
    | "done";
  targetElementId?: string | number;
  targetDescription?: string;
  text?: string;
  direction?: "up" | "down" | "left" | "right" | "top" | "bottom";
  key?: string;
  value?: string;
  toElementId?: string | number;
  url?: string;
  reasoning: string;
}

export interface NetworkReportItem {
  id: string;
  method: string;
  url: string;
  status: number;
  time: string;
  requestHeaders?: Record<string, string>;
  requestBody?: string | null;
  responseHeaders?: Record<string, string>;
  responseBody?: string | null;
}

export interface LogReportItem {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface ClientWebExecutorOptions {
  serverUrl: string;
  clientId: string;
  headless?: boolean;
  secrets?: Record<string, string>;
  browser?: string;
}

interface SessionState {
  context: BrowserContext;
  page: Page;
  startTime: number;
  networkReports: NetworkReportItem[];
  logReports: LogReportItem[];
}

export class ClientWebExecutor {
  private serverUrl: string;
  private clientId: string;
  private headless: boolean;
  private secrets: Record<string, string>;
  private browserType: string;
  private ws: WebSocket | null = null;
  private browser: Browser | null = null;
  private sessions = new Map<string, SessionState>();
  private isStopped: boolean = false;

  constructor(options: ClientWebExecutorOptions) {
    this.serverUrl = options.serverUrl;
    this.clientId = options.clientId;
    this.headless = options.headless ?? true;
    this.secrets = options.secrets || {};
    this.browserType = (options.browser || "chromium").toLowerCase().trim();
  }

  public async start(): Promise<void> {
    await this.ensurePlaywrightBrowser();
    await this.connectWebSocket();
  }

  private async ensurePlaywrightBrowser(): Promise<void> {
    if (this.browser && this.browser.isConnected()) return;

    const b = this.browserType;
    try {
      if (b === "firefox") {
        this.browser = await firefox.launch({
          headless: this.headless,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
          ],
        });
      } else if (b === "safari" || b === "webkit") {
        this.browser = await webkit.launch({
          headless: this.headless,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
          ],
        });
      } else if (b === "chrome") {
        try {
          this.browser = await chromium.launch({
            channel: "chrome",
            headless: this.headless,
            args: [
              "--no-sandbox",
              "--disable-setuid-sandbox",
              "--disable-dev-shm-usage",
              "--disable-gpu",
            ],
          });
        } catch (chromeErr: any) {
          console.warn("[ClientWebExecutor] System Chrome channel launch failed, falling back to bundled Chromium:", chromeErr?.message || chromeErr);
          this.browser = await chromium.launch({
            headless: this.headless,
            args: [
              "--no-sandbox",
              "--disable-setuid-sandbox",
              "--disable-dev-shm-usage",
              "--disable-gpu",
            ],
          });
        }
      } else {
        // default: chromium
        this.browser = await chromium.launch({
          headless: this.headless,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
          ],
        });
      }
    } catch (err: any) {
      if (
        err.message &&
        (err.message.includes("Executable doesn't exist") ||
          err.message.includes("playwright install") ||
          err.message.includes("Please run the following command"))
      ) {
        const installTarget =
          b === "firefox"
            ? "firefox"
            : b === "safari" || b === "webkit"
              ? "webkit"
              : "chromium";
        try {
          console.log(`[ClientWebExecutor] Installing Playwright ${installTarget}...`);
          execSync(`npx -y @playwright/test install ${installTarget}`, { stdio: "inherit" });

          if (b === "firefox") {
            this.browser = await firefox.launch({
              headless: this.headless,
              args: ["--no-sandbox", "--disable-setuid-sandbox"],
            });
          } else if (b === "safari" || b === "webkit") {
            this.browser = await webkit.launch({
              headless: this.headless,
              args: ["--no-sandbox", "--disable-setuid-sandbox"],
            });
          } else {
            this.browser = await chromium.launch({
              headless: this.headless,
              args: ["--no-sandbox", "--disable-setuid-sandbox"],
            });
          }
        } catch (installErr: any) {
          throw new Error(`Failed to automatically install Playwright ${installTarget}: ${installErr.message}`);
        }
      } else {
        throw err;
      }
    }
  }

  private connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `${this.serverUrl}/client/${this.clientId}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.on("open", () => {
        this.send({
          type: "CLIENT_READY",
          id: "init",
          success: true,
          data: { clientId: this.clientId },
        });
        resolve();
      });

      this.ws.on("message", async (data) => {
        try {
          const msg = JSON.parse(data.toString());
          await this.handleServerMessage(msg);
        } catch (_) {}
      });

      this.ws.on("close", () => {
        if (!this.isStopped) {
          this.cleanup();
        }
      });

      this.ws.on("error", (err) => {
        if (!this.browser) {
          reject(err);
        }
      });
    });
  }

  private send(msg: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private getSessionKey(sessionId?: string): string {
    if (sessionId) return sessionId;
    if (this.sessions.size > 0) {
      return this.sessions.keys().next().value!;
    }
    return "default";
  }

  private getSession(sessionId?: string): SessionState {
    const key = this.getSessionKey(sessionId);
    const session = this.sessions.get(key);
    if (!session) {
      throw new Error(`Session '${key}' not found or page not initialized`);
    }
    return session;
  }

  private async handleServerMessage(msg: any) {
    const { type, id, sessionId } = msg;
    try {
      switch (type) {
        case "INIT_PAGE": {
          await this.initPage(sessionId || "default", msg.viewport);
          this.send({ type: "RPC_RESPONSE", id, sessionId, success: true });
          break;
        }

        case "NAVIGATE": {
          const session = this.getSession(sessionId);
          const result = await this.navigate(session, msg.url, msg.timeoutMs);
          this.send({
            type: "RPC_RESPONSE",
            id,
            sessionId,
            success: result.success,
            url: result.url,
            error: result.error,
          });
          break;
        }

        case "GET_PAGE_STATE": {
          const session = this.getSession(sessionId);
          const state = await this.extractPageState(session, msg.includeScreenshot ?? true);
          this.send({
            type: "PAGE_STATE_RESPONSE",
            id,
            sessionId,
            success: true,
            elements: state.elements,
            screenshotBase64: state.screenshotBase64,
            title: state.title,
            url: state.url,
          });
          break;
        }

        case "EXECUTE_ACTION": {
          const session = this.getSession(sessionId);
          const startTime = Date.now();
          const result = await this.executeAction(session, msg.actResult);
          this.send({
            type: "ACTION_RESPONSE",
            id,
            sessionId,
            success: result.success,
            executionTimeMs: Date.now() - startTime,
            error: result.error,
          });
          break;
        }

        case "TAKE_SCREENSHOT": {
          const session = this.getSession(sessionId);
          const screenshotBase64 = await this.takeScreenshot(session, msg.fullPage);
          this.send({
            type: "SCREENSHOT_RESPONSE",
            id,
            sessionId,
            success: true,
            screenshotBase64,
          });
          break;
        }

        case "WAIT": {
          const session = this.getSession(sessionId);
          await session.page.waitForTimeout(msg.ms || 1000);
          this.send({ type: "RPC_RESPONSE", id, sessionId, success: true });
          break;
        }

        case "GET_SESSION_REPORTS": {
          const session = this.getSession(sessionId);
          this.send({
            type: "SESSION_REPORTS_RESPONSE",
            id,
            sessionId,
            success: true,
            networkReports: session.networkReports,
            logReports: session.logReports,
          });
          break;
        }

        case "CLOSE_PAGE": {
          await this.closeSession(sessionId || "default");
          this.send({ type: "RPC_RESPONSE", id, sessionId, success: true });
          break;
        }

        case "CLOSE_BROWSER": {
          await this.stop();
          this.send({ type: "RPC_RESPONSE", id, sessionId, success: true });
          break;
        }

        default:
          this.send({ type: "RPC_RESPONSE", id, sessionId, success: false, error: `Unknown type: ${type}` });
      }
    } catch (err: any) {
      this.send({
        type: "RPC_RESPONSE",
        id,
        sessionId,
        success: false,
        error: err.message || String(err),
      });
    }
  }

  private async initPage(
    sessionId: string,
    viewport?: { width: number; height: number },
  ): Promise<SessionState> {
    if (!this.browser || !this.browser.isConnected()) {
      await this.ensurePlaywrightBrowser();
    }

    // If session already exists, close its old context
    const existing = this.sessions.get(sessionId);
    if (existing) {
      await existing.context.close().catch(() => {});
      this.sessions.delete(sessionId);
    }

    // Create a new isolated context under the same shared Chromium browser
    const context = await this.browser!.newContext({
      viewport: viewport || { width: 1280, height: 800 },
    });

    const page = await context.newPage();
    const startTime = Date.now();
    const networkReports: NetworkReportItem[] = [];
    const logReports: LogReportItem[] = [];

    const getFormattedTime = () => {
      const elapsed = Date.now() - startTime;
      const sec = Math.floor(elapsed / 1000);
      const ms = elapsed % 1000;
      return `${String(sec).padStart(2, "0")}:${String(ms).padStart(3, "0")}`;
    };

    page.on("response", async (res) => {
      try {
        const req = res.request();
        const urlStr = req.url();
        if (urlStr.startsWith("http://") || urlStr.startsWith("https://")) {
          const timing = req.timing();
          const durationMs =
            timing && timing.responseEnd > 0 ? Math.round(timing.responseEnd) : 0;
          const timeStr = durationMs > 0 ? `${durationMs}ms` : "—";

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
            url: urlStr,
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

    page.on("console", (msg) => {
      try {
        const type = msg.type();
        const level =
          type === "error"
            ? "error"
            : type === "warning" || type === "warn"
              ? "warn"
              : "info";
        logReports.push({
          id: `l-${logReports.length + 1}`,
          timestamp: getFormattedTime(),
          level,
          message: msg.text(),
        });
      } catch (_) {}
    });

    page.on("pageerror", (err) => {
      try {
        logReports.push({
          id: `l-${logReports.length + 1}`,
          timestamp: getFormattedTime(),
          level: "error",
          message: `Uncaught Exception: ${err.message || String(err)}`,
        });
      } catch (_) {}
    });

    const sessionState: SessionState = {
      context,
      page,
      startTime,
      networkReports,
      logReports,
    };

    this.sessions.set(sessionId, sessionState);
    return sessionState;
  }

  private async waitForDomNetworkQuiet(page: Page, timeoutMs: number = 3000): Promise<void> {
    try {
      await page
        .waitForLoadState("domcontentloaded", {
          timeout: Math.min(timeoutMs, 2000),
        })
        .catch(() => {});
      await page.waitForTimeout(300);
    } catch {}
  }

  private async navigate(
    session: SessionState,
    url: string,
    timeoutMs: number = 30000,
  ): Promise<{ success: boolean; url: string; error?: string }> {
    try {
      await session.page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      });
      await this.waitForDomNetworkQuiet(session.page);
      return { success: true, url: session.page.url() };
    } catch (err: any) {
      return {
        success: false,
        url: session.page ? session.page.url() : url,
        error: err.message || String(err),
      };
    }
  }

  private async extractPageState(
    session: SessionState,
    includeScreenshot: boolean = true,
  ): Promise<{
    elements: DOMElement[];
    screenshotBase64: string;
    title: string;
    url: string;
  }> {
    await this.waitForDomNetworkQuiet(session.page);

    let screenshotBase64 = "";
    if (includeScreenshot) {
      try {
        const buffer = await session.page.screenshot({ type: "png" });
        screenshotBase64 = buffer.toString("base64");
      } catch (_) {}
    }

    const title = await session.page.title().catch(() => "");
    const url = session.page.url();

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
            parts.unshift(step);
            cur = cur.parentNode;
          }
          return '/' + parts.join('/');
        };

        const isElementVisible = (elem) => {
          if (!elem || elem.nodeType !== Node.ELEMENT_NODE) return false;
          const style = window.getComputedStyle(elem);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
          const rect = elem.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const queryAllInteractive = (root, list = []) => {
          const treeWalker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_ELEMENT,
            {
              acceptNode: (node) => {
                const tag = node.tagName.toLowerCase();
                if (['script', 'style', 'noscript', 'meta', 'link', 'svg'].includes(tag)) {
                  return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
              }
            }
          );

          let current = treeWalker.nextNode();
          while (current) {
            const el = current;
            const tag = el.tagName.toLowerCase();
            const role = el.getAttribute('role') || '';
            const isClickable =
              ['a', 'button', 'input', 'select', 'textarea'].includes(tag) ||
              role === 'button' ||
              role === 'link' ||
              role === 'menuitem' ||
              role === 'tab' ||
              role === 'checkbox' ||
              role === 'radio' ||
              role === 'option' ||
              el.onclick != null ||
              el.getAttribute('tabindex') != null ||
              el.getAttribute('contenteditable') === 'true' ||
              window.getComputedStyle(el).cursor === 'pointer';

            if (isClickable && isElementVisible(el)) {
              list.push(el);
            }

            if (el.shadowRoot) {
              queryAllInteractive(el.shadowRoot, list);
            }

            current = treeWalker.nextNode();
          }
          return list;
        };

        // Clear previously assigned dynamic element IDs to prevent duplicate collisions across DOM updates
        const existingTagged = (document.body || document.documentElement).querySelectorAll('[data-element-id]');
        for (let i = 0; i < existingTagged.length; i++) {
          existingTagged[i].removeAttribute('data-element-id');
        }

        const interactiveNodes = queryAllInteractive(document.body || document.documentElement);
        let idCounter = 1;

        return interactiveNodes.map((element) => {
          let elementId = element.getAttribute('data-testid');
          if (!elementId) {
            elementId = 'el-' + idCounter++;
          }
          element.setAttribute('data-element-id', elementId);

          const tagName = element.tagName.toLowerCase();
          const text = (element.innerText || element.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 100);
          const value = (element.value || '').slice(0, 100);
          const placeholder = element.getAttribute('placeholder') || '';
          const ariaLabel = element.getAttribute('aria-label') || element.getAttribute('aria-labelledby') || '';
          const role = element.getAttribute('role') || '';
          const inputType = element.getAttribute('type') || '';
          const inputName = element.getAttribute('name') || '';
          const href = element.getAttribute('href') || '';
          const disabled = element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true';
          const checked = element.checked === true || element.getAttribute('aria-checked') === 'true';
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

    const elements = (await session.page.evaluate(elementsScript)) as DOMElement[];
    return { elements, screenshotBase64, title, url };
  }

  private async getLocatorForTarget(page: Page, targetId?: string | number): Promise<Locator | null> {
    if (!targetId) return null;
    const idStr = String(targetId).trim();
    if (idStr.startsWith("xpath=")) return page.locator(idStr).first();
    if (idStr.startsWith("/") || idStr.startsWith("./"))
      return page.locator(`xpath=${idStr}`).first();
    if (idStr.startsWith("#") || idStr.startsWith(".") || idStr.startsWith("["))
      return page.locator(idStr).first();

    const elementSelector = `[data-element-id="${idStr}"]`;
    const elementLocator = page.locator(elementSelector).first();
    if ((await elementLocator.count()) > 0) return elementLocator;

    const idLocator = page.locator(`#${idStr}`).first();
    if ((await idLocator.count()) > 0) return idLocator;

    return page.locator(`${elementSelector}, #${idStr}`).first();
  }

  private async executeAction(
    session: SessionState,
    actResult: ActResult,
  ): Promise<{ success: boolean; error?: string }> {
    const {
      action,
      targetElementId,
      text,
      key,
      direction,
      value,
      toElementId,
      url,
    } = actResult;

    if (action === "done") {
      return { success: true };
    }

    if (action === "nav" && url) {
      await session.page.goto(url, { waitUntil: "domcontentloaded" });
      await this.waitForDomNetworkQuiet(session.page);
      return { success: true };
    }

    const locator = await this.getLocatorForTarget(session.page, targetElementId);

    switch (action) {
      case "click":
        if (!locator) throw new Error(`No locator found for target: ${targetElementId}`);
        await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        try {
          await locator.click({ timeout: 4000 });
        } catch (clickErr) {
          try {
            await locator.click({ timeout: 2000, force: true });
          } catch {
            await locator.evaluate((el: HTMLElement) => el.click());
          }
        }
        break;

      case "doubleClick":
        if (!locator) throw new Error(`No locator found for target: ${targetElementId}`);
        await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        try {
          await locator.dblclick({ timeout: 4000 });
        } catch (dblErr) {
          try {
            await locator.dblclick({ timeout: 2000, force: true });
          } catch {
            await locator.evaluate((el: HTMLElement) => {
              el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
            });
          }
        }
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
          await session.page.keyboard.press(keyStr);
        }
        break;

      case "scroll":
        if (direction === "top") {
          await session.page.evaluate(() => window.scrollTo(0, 0));
        } else if (direction === "bottom") {
          await session.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        } else if (direction === "up") {
          await session.page.mouse.wheel(0, -500);
        } else {
          await session.page.mouse.wheel(0, 500);
        }
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
        if (!locator) throw new Error(`No source locator found for target: ${targetElementId}`);
        const destLocator = await this.getLocatorForTarget(session.page, toElementId);
        if (!destLocator) throw new Error(`No target locator found for target: ${toElementId}`);
        await locator.dragTo(destLocator, { timeout: 5000 });
        break;

      default:
        throw new Error(`Unsupported action type: ${action}`);
    }

    await this.waitForDomNetworkQuiet(session.page);
    return { success: true };
  }

  private async takeScreenshot(session: SessionState, fullPage: boolean = false): Promise<string> {
    try {
      const buffer = await session.page.screenshot({ type: "png", fullPage });
      return buffer.toString("base64");
    } catch {
      return "";
    }
  }

  private async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.page.close().catch(() => {});
      await session.context.close().catch(() => {});
      this.sessions.delete(sessionId);
    }
  }

  public async stop(): Promise<void> {
    this.isStopped = true;
    for (const [id, session] of this.sessions.entries()) {
      await session.page.close().catch(() => {});
      await session.context.close().catch(() => {});
    }
    this.sessions.clear();

    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private cleanup(): void {
    for (const [, session] of this.sessions) {
      session.context.close().catch(() => {});
    }
    this.sessions.clear();
    if (this.browser) {
      this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
}
