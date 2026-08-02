"use client";

import { useState } from "react";
import { CopyIcon, CheckIcon } from "lucide-react";

const FULL_API_KEY = "zenitest_live_8f3a9b7c1d2e4f5a6b7c8d9e";
const PARTIAL_API_KEY = `${FULL_API_KEY.substring(0, 18)}...`;

interface CommandBlockProps {
  commandToDisplay: string;
  commandToCopy: string;
  promptSymbol?: string;
  onCopySuccess?: (msg: string) => void;
}

function CommandBlock({
  commandToDisplay,
  commandToCopy,
  promptSymbol = "$",
  onCopySuccess,
}: CommandBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(commandToCopy);
    setCopied(true);
    if (onCopySuccess) {
      onCopySuccess("Copied command to clipboard");
    }
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group flex items-center justify-between gap-3 rounded-md border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/50 px-3 py-1.5 font-mono text-[11px] text-foreground transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
      <div className="flex items-center gap-2 min-w-0 overflow-x-auto">
        {promptSymbol && (
          <span className="text-zinc-400 dark:text-zinc-500 select-none font-medium text-[11px]">
            {promptSymbol}
          </span>
        )}
        <code className="text-zinc-800 dark:text-zinc-200 whitespace-nowrap">
          {commandToDisplay}
        </code>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex items-center justify-center size-6 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors shrink-0 cursor-pointer"
        title="Copy to clipboard"
      >
        {copied ? (
          <CheckIcon className="size-3 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <CopyIcon className="size-3" />
        )}
      </button>
    </div>
  );
}

export function SettingsView() {
  const [copiedKey, setCopiedKey] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const triggerToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2500);
  };

  const handleCopyRawKey = () => {
    navigator.clipboard.writeText(FULL_API_KEY);
    setCopiedKey(true);
    triggerToast("API Key copied to clipboard");
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const apiKeyAuthDisplay = `zenitest auth ${PARTIAL_API_KEY}`;
  const apiKeyAuthCopy = `zenitest auth ${FULL_API_KEY}`;

  return (
    <div className="w-full space-y-4">
      {/* Toast notification */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800 rounded-lg px-3.5 py-2 font-medium shadow-md animate-in fade-in slide-in-from-bottom-2 duration-200">
          <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* API Key Section */}
      <div className="space-y-1.5">
        <div>
          <h2 className="text-xs font-semibold text-foreground">API Key</h2>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-md border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/50 px-3 py-1.5 font-mono text-[11px] text-foreground">
          <span className="text-zinc-800 dark:text-zinc-200 truncate">
            {PARTIAL_API_KEY}
          </span>
          <button
            type="button"
            onClick={handleCopyRawKey}
            className="inline-flex items-center justify-center size-6 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors shrink-0 cursor-pointer"
            title="Copy API key"
          >
            {copiedKey ? (
              <CheckIcon className="size-3 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <CopyIcon className="size-3" />
            )}
          </button>
        </div>
      </div>

      {/* Steps List */}
      <div className="space-y-3 pt-1">
        <h2 className="text-xs font-semibold text-foreground">Installation steps</h2>

        {/* Step 1: Install the CLI */}
        <div className="space-y-1">
          <h3 className="text-[11px] font-medium text-muted-foreground">
            1. Install the CLI
          </h3>
          <CommandBlock
            commandToDisplay="npx install -g @zenitest-org/zenitest-cli"
            commandToCopy="npx install -g @zenitest-org/zenitest-cli"
            onCopySuccess={triggerToast}
          />
        </div>

        {/* Step 2: Install skills */}
        <div className="space-y-1">
          <h3 className="text-[11px] font-medium text-muted-foreground">
            2. Install skills
          </h3>
          <CommandBlock
            commandToDisplay="npx skills add @zenitest-org/zenitest-skills"
            commandToCopy="npx skills add @zenitest-org/zenitest-skills"
            onCopySuccess={triggerToast}
          />
        </div>

        {/* Step 3: Authentication with API key */}
        <div className="space-y-1">
          <h3 className="text-[11px] font-medium text-muted-foreground">
            3. Authentication with API key
          </h3>
          <CommandBlock
            commandToDisplay={apiKeyAuthDisplay}
            commandToCopy={apiKeyAuthCopy}
            onCopySuccess={triggerToast}
          />
        </div>

        {/* Step 4: Ask your coding agent to generate tests */}
        <div className="space-y-1">
          <h3 className="text-[11px] font-medium text-muted-foreground">
            4. Ask your coding agent to generate tests
          </h3>
          <CommandBlock
            commandToDisplay="/zenitest Generate test cases for this project"
            commandToCopy="/zenitest Generate test cases for this project"
            promptSymbol=">"
            onCopySuccess={triggerToast}
          />
        </div>

        {/* Step 5: Execute tests */}
        <div className="space-y-1">
          <h3 className="text-[11px] font-medium text-muted-foreground">
            5. Execute tests
          </h3>
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
