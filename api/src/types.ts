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
  prodURL?: string;
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
  totalTokensUsed: number;
  error?: string;
}
