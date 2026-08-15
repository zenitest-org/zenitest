export type ActionType = 'act' | 'extract' | 'observe';

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

export interface ActionRequest {
  actionType: ActionType;
  instruction: string;
  dom?: string | DOMElement[];
  screenshot?: string; // base64 string or data URL
  variables?: Record<string, string>;
  schema?: Record<string, any>; // Expected JSON schema for extract
  options?: {
    model?: string;
    temperature?: number;
    systemPrompt?: string;
    apiKey?: string;
    baseUrl?: string;
    enableCache?: boolean;
  };
}

export interface ActResult {
  action: 'click' | 'doubleClick' | 'type' | 'press' | 'scroll' | 'hover' | 'select' | 'dragAndDrop' | 'nav' | 'done';
  targetElementId?: string | number;
  targetDescription?: string;
  text?: string; // Text to type if action is 'type'
  direction?: 'up' | 'down' | 'left' | 'right' | 'top' | 'bottom'; // For scroll action
  key?: string; // For press action (e.g. Enter, Tab)
  value?: string; // For select action
  toElementId?: string | number; // For dragAndDrop action
  url?: string; // For nav action
  reasoning: string;
}

export interface ExtractResult {
  data: any;
  reasoning: string;
}

export interface ObservedAction {
  description: string;
  elementId?: string | number;
  suggestedAction: 'click' | 'type' | 'hover' | 'scroll' | 'select';
  metadata?: Record<string, any>;
}

export interface ObserveResult {
  actions: ObservedAction[];
  reasoning: string;
}

export interface ActionResponse {
  success: boolean;
  actionType: ActionType;
  result: ActResult | ExtractResult | ObserveResult;
  meta: {
    modelUsed: string;
    executionTimeMs: number;
    tokensUsed?: number;
    promptTokens?: number;
    completionTokens?: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
    estimatedPromptTokens?: number;
    cachedResponse?: boolean;
    cacheKey?: string;
    cacheFilePath?: string;
  };
  error?: string;
}

/* ==================== Test Runner Schemas ==================== */

export interface TestCaseStep {
  index: number;
  type: 'navigate' | 'act' | 'validate';
  description: string;
}

export interface TestCase {
  id: string;
  title: string;
  localURL?: string;
  localUrl?: string;
  prodURL?: string;
  prodUrl?: string;
  steps: TestCaseStep[];
  variables?: Record<string, string>;
  expectedResult?: string;
  priority?: string;
}

export interface StepResult {
  success: boolean;
  explanation: string;
  pageStillLoading: boolean;
}

export interface StepExecutionReport {
  index: number;
  type: 'navigate' | 'act' | 'validate';
  description: string;
  success: boolean;
  explanation: string;
  actResult?: ActResult;
  validationResult?: StepResult;
  executionTimeMs: number;
  tokensUsed: number;
  screenshotBase64?: string;
  screenshotPath?: string;
  cachedResponse?: boolean;
  cacheKey?: string;
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

export interface ExecutionInfo {
  specFile: string;
  browser: string;
  duration: string;
  url: string;
}

export interface TestCaseExecutionReport {
  testCaseId: string;
  title: string;
  overallSuccess: boolean;
  targetURL: string;
  stepReports: StepExecutionReport[];
  networkReports?: NetworkReportItem[];
  logReports?: LogReportItem[];
  info?: ExecutionInfo;
  totalExecutionTimeMs: number;
  stepExecutionTimeMs?: number;
  totalTokensUsed: number;
  error?: string;
}


/* ==================== Mobile Testing Extensions ==================== */

export type TestTargetPlatform = 'web' | 'ios' | 'android';

export interface MobileExecutionOptions {
  platform: 'mobile-ios' | 'mobile-android' | 'ios' | 'android';
  appFilePath?: string;
  bundleId?: string;
  deviceName?: string;
  geminiApiKey?: string;
}

/* ==================== WebSocket Client-Server RPC Protocol ==================== */

export type ServerRpcMessageType =
  | 'INIT_PAGE'
  | 'INIT_MOBILE_PAGE'
  | 'NAVIGATE'
  | 'GET_PAGE_STATE'
  | 'EXECUTE_ACTION'
  | 'TAKE_SCREENSHOT'
  | 'WAIT'
  | 'GET_SESSION_REPORTS'
  | 'CLOSE_PAGE'
  | 'CLOSE_BROWSER';

export interface ServerRpcMessage {
  type: ServerRpcMessageType;
  id: string;
  sessionId?: string;
  platform?: 'web' | 'ios' | 'android';
  appPath?: string;
  bundleId?: string;
  deviceName?: string;
  url?: string;
  timeoutMs?: number;
  includeScreenshot?: boolean;
  actResult?: ActResult;
  fullPage?: boolean;
  ms?: number;
  viewport?: { width: number; height: number };
}

export type ClientRpcMessageType =
  | 'CLIENT_READY'
  | 'RPC_RESPONSE'
  | 'PAGE_STATE_RESPONSE'
  | 'ACTION_RESPONSE'
  | 'SCREENSHOT_RESPONSE'
  | 'SESSION_REPORTS_RESPONSE';

export interface ClientRpcMessage {
  type: ClientRpcMessageType;
  id: string;
  sessionId?: string;
  success: boolean;
  error?: string;
  data?: any;
  elements?: DOMElement[];
  screenshotBase64?: string;
  title?: string;
  url?: string;
  executionTimeMs?: number;
  networkReports?: NetworkReportItem[];
  logReports?: LogReportItem[];
}


