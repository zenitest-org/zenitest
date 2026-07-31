"use client";

import { useState } from "react";
import { 
	KeyIcon, 
	PlusIcon, 
	CopyIcon, 
	CheckIcon, 
	Trash2Icon, 
	ShieldAlertIcon,
	EyeIcon,
	EyeOffIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface ApiKeyItem {
	id: string;
	name: string;
	keyPrefix: string;
	created: string;
	lastUsed: string;
}

const mockKeys: ApiKeyItem[] = [
	{
		id: "key-1",
		name: "CI/CD Pipeline Key",
		keyPrefix: "zenitest_live_8f3a9b...",
		created: "Jul 12, 2026",
		lastUsed: "2 mins ago",
	},
	{
		id: "key-2",
		name: "Local CLI Development",
		keyPrefix: "zenitest_live_2k7x1c...",
		created: "May 28, 2026",
		lastUsed: "Yesterday",
	},
	{
		id: "key-3",
		name: "Staging Test Runner",
		keyPrefix: "zenitest_live_9p4v7e...",
		created: "Jan 15, 2026",
		lastUsed: "3 days ago",
	},
];

export function ApiKeyView() {
	const [keys, setKeys] = useState<ApiKeyItem[]>(mockKeys);
	const [copiedId, setCopiedId] = useState<string | null>(null);
	const [newKeyName, setNewKeyName] = useState("");
	const [isCreating, setIsCreating] = useState(false);
	const [generatedSecret, setGeneratedSecret] = useState<string | null>(null);

	const handleCopy = (id: string, text: string) => {
		navigator.clipboard.writeText(text);
		setCopiedId(id);
		setTimeout(() => setCopiedId(null), 2000);
	};

	const handleCreateKey = () => {
		if (!newKeyName.trim()) return;

		const randomId = `key-${Date.now()}`;
		const fullSecret = `zenitest_live_${Math.random().toString(36).substring(2, 12)}${Math.random().toString(36).substring(2, 12)}`;
		const newKey: ApiKeyItem = {
			id: randomId,
			name: newKeyName.trim(),
			keyPrefix: `${fullSecret.substring(0, 16)}...`,
			created: "Just now",
			lastUsed: "Never",
		};

		setKeys([newKey, ...keys]);
		setGeneratedSecret(fullSecret);
		setNewKeyName("");
	};

	const handleRevoke = (id: string) => {
		setKeys(keys.filter((k) => k.id !== id));
	};

	return (
		<div className="space-y-6 max-w-5xl">
			{/* Header Subtitle */}
			<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
				<p className="text-sm text-muted-foreground">
					Manage security credentials for the ZeniTest CLI and API integrations
				</p>
				<Button onClick={() => setIsCreating(true)} className="gap-2 shrink-0">
					<PlusIcon className="size-4" />
					Create New API Key
				</Button>
			</div>

			{/* Security Callout Notice */}
			<div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-4 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
				<ShieldAlertIcon className="size-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
				<div className="text-xs leading-relaxed">
					<p className="font-semibold text-sm">Security Policy</p>
					<p className="mt-0.5">
						API keys grant full access to run test suites and manage test artifacts. Do not share your keys or commit them into public source control repositories.
					</p>
				</div>
			</div>

			{/* Create New Key Panel */}
			{isCreating && (
				<Card className="border-primary/30 shadow-md">
					<CardHeader>
						<CardTitle className="text-lg">Generate New Secret Key</CardTitle>
						<CardDescription>
							Enter a descriptive label to identify where this API key will be used.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{generatedSecret ? (
							<div className="space-y-3">
								<div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300 text-xs">
									<p className="font-semibold text-sm mb-1">Key Generated Successfully!</p>
									Please copy your API key now. You will not be able to see it again.
								</div>

								<div className="flex items-center gap-2">
									<Input
										readOnly
										value={generatedSecret}
										className="font-mono text-xs bg-muted"
									/>
									<Button
										onClick={() => handleCopy("new-secret", generatedSecret)}
										className="shrink-0 gap-1.5"
									>
										{copiedId === "new-secret" ? (
											<>
												<CheckIcon className="size-4" /> Copied
											</>
										) : (
											<>
												<CopyIcon className="size-4" /> Copy
											</>
										)}
									</Button>
								</div>

								<div className="flex justify-end pt-2">
									<Button
										variant="outline"
										onClick={() => {
											setIsCreating(false);
											setGeneratedSecret(null);
										}}
									>
										Done
									</Button>
								</div>
							</div>
						) : (
							<div className="flex flex-col sm:flex-row gap-3">
								<Input
									placeholder="e.g. GitHub Actions Production Runner"
									value={newKeyName}
									onChange={(e) => setNewKeyName(e.target.value)}
									className="flex-1"
								/>
								<div className="flex gap-2">
									<Button onClick={handleCreateKey} disabled={!newKeyName.trim()}>
										Generate Key
									</Button>
									<Button variant="ghost" onClick={() => setIsCreating(false)}>
										Cancel
									</Button>
								</div>
							</div>
						)}
					</CardContent>
				</Card>
			)}

			{/* API Keys Table */}
			<Card>
				<CardHeader className="pb-3">
					<CardTitle className="text-lg">Active Keys</CardTitle>
					<CardDescription>
						All active API keys associated with your organization
					</CardDescription>
				</CardHeader>
				<CardContent className="p-0">
					<div className="relative w-full overflow-auto">
						<table className="w-full text-sm text-left">
							<thead className="bg-muted/50 text-xs uppercase text-muted-foreground border-y">
								<tr>
									<th className="px-6 py-3 font-semibold">Key Name</th>
									<th className="px-6 py-3 font-semibold">Prefix</th>
									<th className="px-6 py-3 font-semibold">Created</th>
									<th className="px-6 py-3 font-semibold">Last Used</th>
									<th className="px-6 py-3 font-semibold text-right">Action</th>
								</tr>
							</thead>
							<tbody className="divide-y">
								{keys.length === 0 ? (
									<tr>
										<td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
											No API keys found. Create one to get started.
										</td>
									</tr>
								) : (
									keys.map((keyItem) => (
										<tr key={keyItem.id} className="hover:bg-muted/40 transition-colors">
											<td className="px-6 py-4 font-medium text-foreground">
												<div className="flex items-center gap-2">
													<KeyIcon className="size-4 text-muted-foreground shrink-0" />
													<span>{keyItem.name}</span>
												</div>
											</td>
											<td className="px-6 py-4 font-mono text-xs text-muted-foreground">
												{keyItem.keyPrefix}
											</td>
											<td className="px-6 py-4 text-muted-foreground text-xs">
												{keyItem.created}
											</td>
											<td className="px-6 py-4 text-muted-foreground text-xs">
												<Badge variant="secondary" className="font-normal text-[11px]">
													{keyItem.lastUsed}
												</Badge>
											</td>
											<td className="px-6 py-4 text-right">
												<Button
													variant="ghost"
													size="sm"
													onClick={() => handleRevoke(keyItem.id)}
													className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5 h-8 text-xs"
												>
													<Trash2Icon className="size-3.5" />
													Revoke
												</Button>
											</td>
										</tr>
									))
								)}
							</tbody>
						</table>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
