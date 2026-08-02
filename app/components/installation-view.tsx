"use client";

import { useState } from "react";
import {
  CopyIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
} from "lucide-react";

const FULL_API_KEY = "zenitest_live_8f3a9b7c1d2e4f5a6b7c8d9e";
const PARTIAL_API_KEY = `${FULL_API_KEY.substring(0, 18)}...`;

interface CommandBlockProps {
  commandToDisplay: string;
  commandToCopy: string;
  label?: string;
  promptSymbol?: string;
  onCopySuccess?: (msg: string) => void;
  showVisibilityToggle?: boolean;
  isMasked?: boolean;
  onToggleMask?: () => void;
}

function CommandBlock({
  commandToDisplay,
  commandToCopy,
  label,
  promptSymbol = "$",
  onCopySuccess,
  showVisibilityToggle = false,
  isMasked = false,
  onToggleMask,
}: CommandBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(commandToCopy);
    setCopied(true);
    if (onCopySuccess) {
      onCopySuccess(`Copied command to clipboard`);
    }
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group relative rounded-lg border border-zinc-200 dark:border-zinc-800 bg-[#f8f9fa] dark:bg-zinc-900/80">
      {label && (
        <div className="px-3.5 pt-2.5 pb-1 text-[11px] font-medium text-muted-foreground border-b border-zinc-200/50 dark:border-zinc-800/60 flex items-center justify-between">
          <span>{label}</span>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 px-3.5 py-3 font-mono text-xs text-foreground overflow-x-auto">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-muted-foreground select-none font-semibold">{promptSymbol}</span>
          <code className="text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
            {commandToDisplay}
          </code>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {showVisibilityToggle && onToggleMask && (
            <button
              type="button"
              onClick={onToggleMask}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              title={isMasked ? "Show full API key" : "Mask API key"}
            >
              {isMasked ? (
                <>
                  <EyeIcon className="size-3.5" />
                  <span className="hidden sm:inline">Show</span>
                </>
              ) : (
                <>
                  <EyeOffIcon className="size-3.5" />
                  <span className="hidden sm:inline">Mask</span>
                </>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground px-2.5 py-1 rounded-md hover:bg-zinc-200/70 dark:hover:bg-zinc-800 transition-colors cursor-pointer border border-zinc-200/80 dark:border-zinc-700/60 bg-white/80 dark:bg-zinc-800/50 shadow-xs"
          >
            {copied ? (
              <>
                <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Copied</span>
              </>
            ) : (
              <>
                <CopyIcon className="size-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export function InstallationView() {
  const [showFullApiKey, setShowFullApiKey] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const triggerToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2500);
  };

  const apiKeyDisplay = showFullApiKey ? `zenitest auth ${FULL_API_KEY}` : `zenitest auth ${PARTIAL_API_KEY}`;
  const apiKeyCopy = `zenitest auth ${FULL_API_KEY}`;

  return (
    <div className="max-w-4xl space-y-6 pb-12">
      {/* Toast notification */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800 rounded-lg px-4 py-2.5 font-medium shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
          <CheckIcon className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Steps Container */}
      <div className="space-y-6">
        {/* Step 1: Install the CLI */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">
            1. Install the CLI
          </h2>
          <CommandBlock
            commandToDisplay="npx install -g @zenitest-org/zenitest-cli"
            commandToCopy="npx install -g @zenitest-org/zenitest-cli"
            onCopySuccess={triggerToast}
          />
        </div>

        {/* Step 2: Install skills */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">
            2. Install skills
          </h2>
          <CommandBlock
            commandToDisplay="npx skills add @zenitest-org/zenitest-skills"
            commandToCopy="npx skills add @zenitest-org/zenitest-skills"
            onCopySuccess={triggerToast}
          />
        </div>

        {/* Step 3: Authentication with API key */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">
            3. Authentication with API key
          </h2>
          <CommandBlock
            commandToDisplay={apiKeyDisplay}
            commandToCopy={apiKeyCopy}
            onCopySuccess={triggerToast}
            showVisibilityToggle={true}
            isMasked={!showFullApiKey}
            onToggleMask={() => setShowFullApiKey((prev) => !prev)}
          />
        </div>

        {/* Step 4: Ask your coding agent to generate tests */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">
            4. Ask your coding agent to generate tests
          </h2>
          <CommandBlock
            commandToDisplay="/zenitest Generate test cases for this project"
            commandToCopy="/zenitest Generate test cases for this project"
            promptSymbol=">"
            onCopySuccess={triggerToast}
          />
        </div>

        {/* Step 5: Execute tests */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">
            5. Execute tests
          </h2>
          <CommandBlock
            commandToDisplay="zenitest run"
            commandToCopy="zenitest run"
            onCopySuccess={triggerToast}
          />
        </div>
      </div>
    </div>
  );
}
