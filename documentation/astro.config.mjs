// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import lucode from "lucode-starlight";
import node from "@astrojs/node";

// https://astro.build/config
export default defineConfig({
  site: "https://docs.zenitest.ai",
  redirects: {
    "/": "/getting-started/introduction/",
  },
  integrations: [
    starlight({
      title: "ZeniTest Docs",
      favicon: "/favicon.svg",
      description: "AI-powered E2E automated browser testing made simple.",
      customCss: ["./src/styles/custom.css"],
      plugins: [
        lucode({
          navLinks: [
            { label: "Quickstart", link: "/getting-started/quickstart/" },
          ],
        }),
      ],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Introduction", slug: "getting-started/introduction" },
            { label: "Requirements", slug: "getting-started/requirements" },
            { label: "Quickstart", slug: "getting-started/quickstart" },
          ],
        },
        {
          label: "AI Coding Agents",
          items: [{ label: "Agent Skills Setup", slug: "ai-agents/skills" }],
        },
        {
          label: "Writing Tests",
          items: [
            { label: "Folder & Config", slug: "yaml-spec/overview" },
            { label: "Step Actions", slug: "yaml-spec/actions" },
            {
              label: "Variables & Secrets",
              slug: "yaml-spec/variables-secrets",
            },
          ],
        },
        {
          label: "CLI Reference",
          items: [{ label: "Commands & Flags", slug: "cli/commands" }],
        },
        {
          label: "Guides",
          items: [
            { label: "Mobile Testing", slug: "guides/mobile-testing" },
            { label: "Test Examples", slug: "guides/examples" },
            { label: "CI/CD Setup", slug: "guides/cicd" },
          ],
        },
      ],
    }),
  ],
  vite: {
    server: {
      allowedHosts: ["docs.zenitest.ai"],
    },
  },
  output: "server",
  adapter: node({
    mode: "standalone",
  }),
  server: {
    host: "0.0.0.0",
  },
});
