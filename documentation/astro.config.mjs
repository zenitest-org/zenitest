// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'ZeniTest Docs',
			description: 'AI-powered E2E automated browser testing made simple.',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/zeni-org/zenitest' }
			],
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Introduction', slug: 'getting-started/introduction' },
						{ label: 'Quickstart', slug: 'getting-started/quickstart' },
					],
				},
				{
					label: 'AI Coding Agents',
					items: [
						{ label: 'Agent Skills Setup', slug: 'ai-agents/skills' },
					],
				},
				{
					label: 'Writing Tests',
					items: [
						{ label: 'YAML Format', slug: 'yaml-spec/overview' },
						{ label: 'Step Actions', slug: 'yaml-spec/actions' },
						{ label: 'Variables & Secrets', slug: 'yaml-spec/variables-secrets' },
					],
				},
				{
					label: 'CLI Reference',
					items: [
						{ label: 'Commands & Flags', slug: 'cli/commands' },
					],
				},
				{
					label: 'Guides',
					items: [
						{ label: 'Test Examples', slug: 'guides/examples' },
						{ label: 'CI/CD Setup', slug: 'guides/cicd' },
					],
				},
			],
		}),
	],
});
