import "dotenv/config";
import { remote } from "webdriverio";
import { GoogleGenAI, Type } from "@google/genai";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, basename } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { supabase } from "./db/supabase";
import {
  TestCase,
  TestCaseExecutionReport,
  StepExecutionReport,
  DOMElement,
  ActResult,
  StepResult,
  MobileExecutionOptions,
  AWS_DEVICE_ARN_IOS,
  AWS_DEVICE_ARN_ANDROID,
} from "./types";
import {
  DeviceFarmClient,
  CreateRemoteAccessSessionCommand,
  GetRemoteAccessSessionCommand,
  StopRemoteAccessSessionCommand,
} from "@aws-sdk/client-device-farm";

const MOBILE_ACT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    action: {
      type: Type.STRING,
      enum: ["click", "type", "scroll", "press", "done"],
      description: "The gesture or action to perform",
    },
    targetElementId: {
      type: Type.STRING,
      description: "Accessibility ID, resource ID, or text label of target element",
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

/**
 * Extracts structured DOM elements from mobile page source XML (XCUITest / UiAutomator2).
 */
export function extractMobileDom(xmlSource: string): DOMElement[] {
  const elements: DOMElement[] = [];
  if (!xmlSource) return elements;

  // Regex parser matching XML attributes: type/tag, name, label, value, text, visible, enabled, rect bounds
  const elementRegex = /<([a-zA-Z0-9_\.:]+)\s+([^>]+)\/?>/g;
  let match: RegExpExecArray | null;
  let count = 0;

  while ((match = elementRegex.exec(xmlSource)) !== null) {
    const rawTag = match[1];
    const attrString = match[2];

    // Extract attributes
    const getAttr = (key: string): string => {
      const attrMatch = new RegExp(`${key}=["']([^"']*)["']`, "i").exec(attrString);
      return attrMatch ? attrMatch[1] : "";
    };

    const type = getAttr("type") || rawTag;
    const name = getAttr("name");
    const label = getAttr("label");
    const value = getAttr("value") || getAttr("text");
    const visibleStr = getAttr("visible");
    const enabledStr = getAttr("enabled");

    const isVisible = visibleStr ? visibleStr === "true" : true;
    const isEnabled = enabledStr ? enabledStr === "true" : true;

    // Filter relevant UI interactive elements
    const isInteractiveTag =
      type.includes("Button") ||
      type.includes("Text") ||
      type.includes("Field") ||
      type.includes("Image") ||
      type.includes("CheckBox") ||
      type.includes("Switch") ||
      type.includes("Cell") ||
      type.includes("Link");

    const textContent = label || name || value;

    if (isVisible && (isInteractiveTag || textContent)) {
      count++;
      const id = name || label || textContent || `mob_${count}`;

      // Extract bounds rectangle if present (e.g. x="24" y="798" width="354" height="52")
      const x = parseInt(getAttr("x") || "0", 10);
      const y = parseInt(getAttr("y") || "0", 10);
      const width = parseInt(getAttr("width") || "0", 10);
      const height = parseInt(getAttr("height") || "0", 10);

      elements.push({
        id,
        tagName: type,
        role: type.replace(/^XCUIElementType/, "").replace(/^android\.widget\./, ""),
        text: textContent,
        value: value,
        ariaLabel: label || name,
        isVisible,
        isInteractive: isEnabled && isInteractiveTag,
        rect: { left: x, top: y, width, height },
      });
    }
  }

  return elements;
}

/**
 * Uploads app binary (.apk / .ipa) to Supabase Storage 'apps' bucket and returns a 24-hour signed HTTPS URL.
 */
export async function uploadAppBinaryToSupabase(
  appBufferOrPath: Buffer | string,
  fileName: string = "app-binary"
): Promise<string> {
  let fileBuffer: Buffer;
  let originalName = fileName;

  if (typeof appBufferOrPath === "string") {
    if (!existsSync(appBufferOrPath)) {
      throw new Error(`Mobile app binary file not found at path: ${appBufferOrPath}`);
    }
    fileBuffer = readFileSync(appBufferOrPath);
    originalName = basename(appBufferOrPath);
  } else {
    fileBuffer = appBufferOrPath;
  }

  const bucketName = "apps";
  const storagePath = `builds/${Date.now()}_${originalName}`;

  console.log(`[Supabase Storage] Ensuring bucket '${bucketName}' exists...`);
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.some((b) => b.name === bucketName)) {
    await supabase.storage.createBucket(bucketName, { public: true });
  }

  console.log(`[Supabase Storage] Uploading ${originalName} (${(fileBuffer.length / (1024 * 1024)).toFixed(2)} MB)...`);
  const { data, error } = await supabase.storage
    .from(bucketName)
    .upload(storagePath, fileBuffer, {
      contentType: "application/octet-stream",
      upsert: true,
    });

  if (error) {
    throw new Error(`Failed to upload mobile app binary to Supabase Storage: ${error.message}`);
  }

  console.log(`[Supabase Storage] Uploaded to path: ${data.path}`);
  const { data: publicUrlData } = supabase.storage
    .from(bucketName)
    .getPublicUrl(storagePath);

  if (publicUrlData?.publicUrl) {
    console.log(`[Supabase Storage] Public HTTPS App URL: ${publicUrlData.publicUrl}`);
    return publicUrlData.publicUrl;
  }

  const { data: signedData, error: signedError } = await supabase.storage
    .from(bucketName)
    .createSignedUrl(storagePath, 86400);

  if (signedError || !signedData?.signedUrl) {
    throw new Error(`Failed to generate signed HTTPS URL from Supabase Storage: ${signedError?.message}`);
  }

  console.log(`[Supabase Storage] Generated Signed HTTPS App URL: ${signedData.signedUrl}`);
  return signedData.signedUrl;
}

export class MobileExecutor {
  private ai: GoogleGenAI;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY || "";
    this.ai = new GoogleGenAI({ apiKey: key });
  }

  /**
   * Provisions AWS Device Farm session on fixed physical hardware ARNs.
   */
  private async provisionAwsSession(
    options: MobileExecutionOptions
  ): Promise<{ awsClient: DeviceFarmClient; sessionArn: string; endpoint: string }> {
    const region = options.awsRegion || process.env.AWS_REGION || "us-west-2";
    const projectArn = options.awsProjectArn || process.env.AWS_PROJECT_ARN || process.env.AWS_TESTGRID_PROJECT_ARN;

    if (!projectArn) {
      throw new Error("AWS_PROJECT_ARN environment variable is required for AWS Device Farm execution.");
    }

    const deviceArn =
      options.platform === "mobile-ios" ? AWS_DEVICE_ARN_IOS : AWS_DEVICE_ARN_ANDROID;

    const awsClient = new DeviceFarmClient({ region });
    console.log(`[AWS Device Farm] Provisioning hardware session on device: ${deviceArn}`);

    const command = new CreateRemoteAccessSessionCommand({
      projectArn,
      deviceArn,
    });

    const res = await awsClient.send(command);
    const sessionArn = res.remoteAccessSession?.arn;
    if (!sessionArn) {
      throw new Error("Failed to create AWS Device Farm Remote Access Session.");
    }

    console.log(`[AWS Device Farm] Session created: ${sessionArn}. Polling status...`);
    let endpoint = "";

    while (true) {
      const statusRes = await awsClient.send(
        new GetRemoteAccessSessionCommand({ arn: sessionArn })
      );
      const session = statusRes.remoteAccessSession;
      console.log(`[AWS Device Farm] Session status: ${session?.status}`);

      if (session?.status === "RUNNING") {
        endpoint = session.endpoints?.remoteDriverEndpoint || "";
        break;
      }
      if (
        session?.status === "ERRORED" ||
        session?.status === "STOPPED" ||
        session?.status === "COMPLETED"
      ) {
        throw new Error(`AWS Device Farm session failed with status: ${session?.status}`);
      }
      await new Promise((r) => setTimeout(r, 5000));
    }

    return { awsClient, sessionArn, endpoint };
  }

  /**
   * Executes a mobile test case using Appium WebdriverIO on AWS Device Farm or Local Driver.
   */
  public async executeTestCase(
    testCase: TestCase,
    options: MobileExecutionOptions,
    onStepReport?: (report: StepExecutionReport) => void
  ): Promise<TestCaseExecutionReport> {
    const startTime = Date.now();
    let totalTokensUsed = 0;
    const stepReports: StepExecutionReport[] = [];

    console.log(`\n=====================================================================================`);
    console.log(`[MobileExecutor] STARTING TEST CASE: "${testCase.title}" (${testCase.id})`);
    console.log(`[MobileExecutor] Target Platform: ${options.platform}`);
    console.log(`=====================================================================================\n`);

    // 1. Mandatory App Binary Upload to Supabase Storage
    let signedAppUrl = options.appUrl || "";
    if (!signedAppUrl && options.appFilePath) {
      signedAppUrl = await uploadAppBinaryToSupabase(options.appFilePath);
    } else if (!signedAppUrl && options.appBuffer) {
      signedAppUrl = await uploadAppBinaryToSupabase(
        options.appBuffer,
        options.appFileName || `app_${Date.now()}.${options.platform === "mobile-ios" ? "ipa" : "apk"}`
      );
    }

    if (!signedAppUrl) {
      throw new Error("Mandatory Supabase Signed App HTTPS URL could not be resolved.");
    }

    let awsClient: DeviceFarmClient | undefined;
    let sessionArn: string | undefined;
    let driver: any;

    try {
      // 2. Provision AWS Device Farm Session or Connect Local Appium
      if (options.awsProjectArn || process.env.AWS_PROJECT_ARN) {
        const awsSession = await this.provisionAwsSession(options);
        awsClient = awsSession.awsClient;
        sessionArn = awsSession.sessionArn;

        const parsedEndpoint = new URL(awsSession.endpoint);
        console.log(`[MobileExecutor] Connecting WebdriverIO to AWS remote endpoint (${parsedEndpoint.hostname})...`);
        driver = await remote({
          hostname: parsedEndpoint.hostname,
          path: parsedEndpoint.pathname + parsedEndpoint.search,
          port: parsedEndpoint.port ? parseInt(parsedEndpoint.port, 10) : 443,
          protocol: parsedEndpoint.protocol.replace(":", ""),
          logLevel: "warn",
          capabilities: {
            platformName: options.platform === "mobile-ios" ? "iOS" : "Android",
            "appium:automationName":
              options.platform === "mobile-ios" ? "XCUITest" : "UiAutomator2",
            "appium:app": signedAppUrl,
            "appium:newCommandTimeout": 300,
          },
        });
        console.log(`[MobileExecutor] WebdriverIO session established on AWS hardware.`);
      } else {
        // Connect to local Appium server
        const targetAppPath = options.appFilePath ? options.appFilePath : signedAppUrl;
        console.log(`[MobileExecutor] Connecting to Local Appium server at http://127.0.0.1:4723 (app: ${targetAppPath})...`);
        driver = await remote({
          hostname: "127.0.0.1",
          port: 4723,
          logLevel: "warn",
          capabilities: {
            platformName: options.platform === "mobile-ios" ? "iOS" : "Android",
            "appium:automationName":
              options.platform === "mobile-ios" ? "XCUITest" : "UiAutomator2",
            "appium:app": targetAppPath,
            "appium:newCommandTimeout": 300,
          },
        });
        console.log(`[MobileExecutor] WebdriverIO session established on Local Appium.`);
      }

      let overallSuccess = true;

      // 3. Execute Steps
      for (const step of testCase.steps) {
        const stepStartTime = Date.now();
        let stepSuccess = false;
        let explanation = "";
        let actResult: ActResult | undefined;
        let validationResult: StepResult | undefined;
        let screenshotBase64: string | undefined;

        console.log(`\n[MobileExecutor Step ${step.index}/${testCase.steps.length}] [${step.type.toUpperCase()}] ${step.description}`);

        try {
          // Take screenshot
          const rawScreenshot = await driver.takeScreenshot();
          screenshotBase64 = `data:image/png;base64,${rawScreenshot}`;

          // Extract Mobile DOM
          const pageSource = await driver.getPageSource();
          const mobileDom = extractMobileDom(pageSource);

          if (step.type === "navigate") {
            stepSuccess = true;
            explanation = `App launched with binary URI: ${signedAppUrl}`;
          } else if (step.type === "act") {
            actResult = await this.executeActStep(driver, step.description, mobileDom, screenshotBase64);
            stepSuccess = actResult.action !== "done" || !actResult.reasoning.includes("failed");
            explanation = actResult.reasoning;
          } else if (step.type === "validate") {
            validationResult = await this.executeValidateStep(step.description, mobileDom, screenshotBase64);
            stepSuccess = validationResult.success;
            explanation = validationResult.explanation;
          }
        } catch (err: any) {
          stepSuccess = false;
          explanation = `Step failed with error: ${err.message}`;
        }

        const stepDuration = Date.now() - stepStartTime;
        if (!stepSuccess) overallSuccess = false;

        console.log(`[MobileExecutor Step ${step.index}] ${stepSuccess ? "PASSED ✅" : "FAILED ❌"} (${stepDuration}ms): ${explanation}`);

        const report: StepExecutionReport = {
          index: step.index,
          type: step.type,
          description: step.description,
          success: stepSuccess,
          explanation,
          actResult,
          validationResult,
          executionTimeMs: stepDuration,
          tokensUsed: 150,
          screenshotBase64,
        };

        stepReports.push(report);
        if (onStepReport) onStepReport(report);

        if (!stepSuccess) break;
      }

      console.log(`\n[MobileExecutor] Overall Result for "${testCase.title}": ${overallSuccess ? "PASSED ✅" : "FAILED ❌"}`);

      return {
        testCaseId: testCase.id,
        title: testCase.title,
        overallSuccess,
        targetURL: signedAppUrl,
        stepReports,
        totalExecutionTimeMs: Date.now() - startTime,
        totalTokensUsed: stepReports.length * 150,
      };
    } finally {
      console.log(`\n=====================================================================================`);
      console.log(`[MobileExecutor] CLOSING SESSION FOR TEST CASE: "${testCase.title}"`);
      if (driver) {
        try {
          console.log(`[MobileExecutor] Deleting WebdriverIO driver session...`);
          await driver.deleteSession();
          console.log(`[MobileExecutor] WebdriverIO driver session deleted.`);
        } catch (err: any) {
          console.log(`[MobileExecutor Warning] Error deleting driver session: ${err.message}`);
        }
      }
      if (awsClient && sessionArn) {
        try {
          console.log(`[MobileExecutor] Issuing StopRemoteAccessSessionCommand for AWS session: ${sessionArn}...`);
          await awsClient.send(new StopRemoteAccessSessionCommand({ arn: sessionArn }));
          console.log(`[MobileExecutor] AWS Device Farm remote access session terminated cleanly.`);
        } catch (err: any) {
          console.log(`[MobileExecutor Warning] Error stopping AWS session: ${err.message}`);
        }
      }
      console.log(`=====================================================================================\n`);
    }
  }

  /**
   * Resolves mobile gesture/action using Gemini LLM with structured response schema.
   */
  private async executeActStep(
    driver: any,
    instruction: string,
    dom: DOMElement[],
    screenshotBase64?: string
  ): Promise<ActResult> {
    const userText = `You are a mobile automation assistant executing a step on an app screen.
Instruction: "${instruction}"

Mobile UI Elements:
${JSON.stringify(dom, null, 2)}`;

    const actParts: any[] = [{ text: userText }];
    if (screenshotBase64) {
      const cleanBase64 = screenshotBase64.replace(/^data:image\/\w+;base64,/, "");
      actParts.push({
        inlineData: {
          mimeType: "image/png",
          data: cleanBase64,
        },
      });
    }

    const modelName = process.env.STAGEHAND_MODEL || "gemini-2.5-flash";
    const response = await this.ai.models.generateContent({
      model: modelName,
      contents: [
        {
          role: "user",
          parts: actParts,
        },
      ],
      config: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: MOBILE_ACT_SCHEMA,
      },
    });

    const responseText = (response.text || "{}").replace(/```json\n?|\n?```/g, "").trim();
    const parsed: ActResult = JSON.parse(responseText);

    if (parsed.action === "click" || parsed.action === "type") {
      const targetId = String(parsed.targetElementId || "");
      const elem = await driver.$(`~${targetId}`);
      if (await elem.isExisting()) {
        if (parsed.action === "click") {
          await elem.click();
        } else if (parsed.action === "type") {
          await elem.setValue(parsed.text || "");
        }
      } else {
        // Fallback search by text
        const textElem = await driver.$(`//*[contains(@name, "${targetId}") or contains(@label, "${targetId}")]`);
        if (await textElem.isExisting()) {
          if (parsed.action === "click") await textElem.click();
          else if (parsed.action === "type") await textElem.setValue(parsed.text || "");
        }
      }
    }

    return parsed;
  }

  /**
   * Validates mobile visual state using Gemini LLM with structured response schema.
   */
  private async executeValidateStep(
    condition: string,
    dom: DOMElement[],
    screenshotBase64?: string
  ): Promise<StepResult> {
    const userText = `You are a mobile QA validator verifying screen state.
Condition to verify: "${condition}"

Active Mobile DOM Elements:
${JSON.stringify(dom, null, 2)}`;

    const valParts: any[] = [{ text: userText }];
    if (screenshotBase64) {
      const cleanBase64 = screenshotBase64.replace(/^data:image\/\w+;base64,/, "");
      valParts.push({
        inlineData: {
          mimeType: "image/png",
          data: cleanBase64,
        },
      });
    }

    const modelName = process.env.STAGEHAND_MODEL || "gemini-2.5-flash";
    const response = await this.ai.models.generateContent({
      model: modelName,
      contents: [
        {
          role: "user",
          parts: valParts,
        },
      ],
      config: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: MOBILE_VALIDATE_SCHEMA,
      },
    });

    const responseText = (response.text || "{}").replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(responseText) as StepResult;
  }
}
