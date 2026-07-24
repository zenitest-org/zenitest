import { execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const API_URL = "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json";

interface DownloadItem {
  platform: string;
  url: string;
}

interface ApiResponse {
  channels: {
    Stable: {
      version: string;
      downloads: {
        "chrome-headless-shell"?: DownloadItem[];
      };
    };
  };
}

export function findMonorepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir && dir !== "/") {
    if (existsSync(join(dir, "turbo.json"))) {
      return dir;
    }
    dir = dirname(dir);
  }
  return process.cwd(); // Fallback
}

const TARGET_DIR = join(findMonorepoRoot(), "chrome-headless-shell");

function getPlatform(): string {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "darwin") {
    return arch === "arm64" ? "mac-arm64" : "mac-x64";
  } else if (platform === "linux") {
    if (arch === "x64") return "linux64";
  } else if (platform === "win32") {
    return arch === "x64" ? "win64" : "win32";
  }

  throw new Error(`Unsupported platform/architecture: ${platform}-${arch}`);
}

export async function downloadChromeHeadlessShell(): Promise<string> {
  const platformKey = getPlatform();
  const extractedFolderName = `chrome-headless-shell-${platformKey}`;
  const executableName = process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
  const executablePath = join(TARGET_DIR, extractedFolderName, executableName);

  if (existsSync(executablePath)) {
    return executablePath;
  }

  const response = await fetch(API_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch version info: ${response.statusText}`);
  }

  const data = (await response.json()) as ApiResponse;
  const downloads = data.channels.Stable.downloads["chrome-headless-shell"];

  if (!downloads) {
    throw new Error("Could not find chrome-headless-shell downloads in the API response.");
  }

  const downloadInfo = downloads.find((d) => d.platform === platformKey);
  if (!downloadInfo) {
    throw new Error(`No download URL found for platform: ${platformKey}`);
  }

  const downloadUrl = downloadInfo.url;

  if (!existsSync(TARGET_DIR)) {
    mkdirSync(TARGET_DIR, { recursive: true });
  }

  const zipPath = join(TARGET_DIR, "chrome-headless-shell.zip");
  const fileResponse = await fetch(downloadUrl);
  if (!fileResponse.ok) {
    throw new Error(`Failed to download binary: ${fileResponse.statusText}`);
  }

  const arrayBuffer = await fileResponse.arrayBuffer();
  writeFileSync(zipPath, Buffer.from(arrayBuffer));

  if (process.platform === "win32") {
    execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${TARGET_DIR}' -Force"`);
  } else {
    execSync(`unzip -o "${zipPath}" -d "${TARGET_DIR}"`);
  }

  unlinkSync(zipPath);

  if (existsSync(executablePath)) {
    return executablePath;
  } else {
    throw new Error(`Could not verify executable path: ${executablePath}`);
  }
}

// Auto-run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  downloadChromeHeadlessShell().catch((err) => {
    console.error("An error occurred during installation:", err);
    process.exit(1);
  });
}
