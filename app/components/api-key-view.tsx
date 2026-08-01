"use client";

import { useState } from "react";
import { CopyIcon, CheckIcon, ArrowRightIcon } from "lucide-react";

export function ApiKeyView() {
	const [apiKey] = useState("zenitest_live_8f3a9b7c1d2e4f5a6b7c8d9e");
	const [copiedKey, setCopiedKey] = useState(false);
	const [copiedCmd, setCopiedCmd] = useState(false);
	const [toastMsg, setToastMsg] = useState<string | null>(null);

	const showToast = (msg: string) => {
		setToastMsg(msg);
		setTimeout(() => setToastMsg(null), 2500);
	};

	const handleCopyKey = () => {
		navigator.clipboard.writeText(apiKey);
		setCopiedKey(true);
		showToast("API key copied");
		setTimeout(() => setCopiedKey(false), 2000);
	};

	const handleCopyCmd = () => {
		navigator.clipboard.writeText(`zenitest auth ${apiKey}`);
		setCopiedCmd(true);
		showToast("Command copied");
		setTimeout(() => setCopiedCmd(false), 2000);
	};

	const displayKey = `${apiKey.substring(0, 18)}...`;
	const displayCmd = `zenitest auth ${apiKey.substring(0, 18)}...`;

	return (
		<div className="w-full space-y-4">
			{/* Top Context & Explanation */}
			<div className="space-y-1.5">
				<p className="text-xs text-muted-foreground leading-relaxed">
					Use this key to authenticate requests to the Zenitest API. Keep it secret and do not expose it in frontend applications.
				</p>
				<a
					href="https://docs.zenitest.com"
					target="_blank"
					rel="noreferrer"
					className="inline-flex items-center gap-1 text-xs font-medium text-foreground hover:underline"
				>
					View Docs <ArrowRightIcon className="size-3" />
				</a>
			</div>

			{/* API Key Box */}
			<div className="space-y-1.5">
				<div className="flex items-center justify-between text-xs">
					<span className="font-medium text-muted-foreground">API Key</span>
					<button
						type="button"
						onClick={handleCopyKey}
						className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted cursor-pointer"
					>
						{copiedKey ? (
							<>
								<CheckIcon className="size-3 text-emerald-600 dark:text-emerald-400" />
								<span className="text-emerald-600 dark:text-emerald-400 font-medium">Copied</span>
							</>
						) : (
							<>
								<CopyIcon className="size-3" />
								<span>Copy</span>
							</>
						)}
					</button>
				</div>
				<div className="rounded-md border border-zinc-200/80 dark:border-zinc-800 bg-[#f8f8f8] dark:bg-zinc-900/60 px-3 py-2 font-mono text-xs text-foreground break-all">
					{displayKey}
				</div>
			</div>

			{/* Quick Start Section */}
			<div className="space-y-2 pt-3 border-t border-border">
				<div>
					<h4 className="text-xs font-semibold text-foreground">Quick Start</h4>
					<p className="text-xs text-muted-foreground mt-0.5">
						Authenticate the CLI with your API key.
					</p>
				</div>
				<div className="rounded-md border border-zinc-200/80 dark:border-zinc-800 bg-[#f8f8f8] dark:bg-zinc-900/60 px-3 py-2 flex items-center justify-between gap-3">
					<code className="font-mono text-xs text-foreground truncate">
						{displayCmd}
					</code>
					<button
						type="button"
						onClick={handleCopyCmd}
						className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground shrink-0 px-2 py-1 rounded hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
					>
						{copiedCmd ? (
							<>
								<CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
								<span className="text-emerald-600 dark:text-emerald-400 font-medium">Copied</span>
							</>
						) : (
							<>
								<CopyIcon className="size-3.5" />
								<span>Copy Command</span>
							</>
						)}
					</button>
				</div>
			</div>

			{/* Green Toast Notification */}
			{toastMsg && (
				<div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800 rounded-md px-3 py-2 font-medium animate-in fade-in slide-in-from-bottom-1 duration-150">
					<CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
					<span>{toastMsg}</span>
				</div>
			)}
		</div>
	);
}







