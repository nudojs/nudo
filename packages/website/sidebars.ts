import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docsSidebar: [
    "intro",
    "why-nudo",
    {
      type: "category",
      label: "Start",
      items: [
        "getting-started/installation",
        "getting-started/mental-model",
        "getting-started/quick-start",
      ],
    },
    {
      type: "category",
      label: "How-to",
      link: {
        type: "generated-index",
        description:
          "Task-oriented guides for working with Nudo: run gates and diagnose failures, author contracts and harnesses, integrate with the toolchain, and grab cookbook recipes.",
      },
      items: [
        {
          type: "category",
          label: "Gate",
          items: ["guides/check", "guides/health", "guides/error-faces"],
        },
        {
          type: "category",
          label: "Contracts",
          items: [
            "guides/contract",
            "guides/env-harvest",
            "guides/runtime-generation",
          ],
        },
        {
          type: "category",
          label: "Ecosystem",
          items: [
            "guides/cli",
            "guides/export-ecosystem",
            "guides/callsite-discovery",
            "guides/examples",
          ],
        },
        {
          type: "category",
          label: "Cookbook",
          items: ["guides/recipes"],
        },
      ],
    },
    {
      type: "category",
      label: "Editors & Agents",
      items: [
        "guides/vscode",
        "guides/zed",
        "guides/agent-integration",
        "guides/lsp-clients",
        "guides/vite-plugin",
        "guides/ai-native-dx",
      ],
    },
    {
      type: "category",
      label: "Migrate off TypeScript",
      link: {
        type: "generated-index",
        description:
          "Replace the tsc gate on JavaScript packages. Coexistence is a short-lived migration tactic — the exit is nudo migrate retire.",
      },
      items: [
        "guides/migrating-js",
        "guides/migrating-from-typescript",
        "guides/case-study-retire",
        "guides/coexistence",
        "guides/vs-typescript",
        "guides/versioning",
      ],
    },
    {
      type: "category",
      label: "Concepts",
      items: [
        "concepts/layers",
        "concepts/abs",
        "concepts/abstract-interpretation",
        "concepts/semantics",
        "concepts/control-flow-narrowing",
        "concepts/directives",
        "concepts/mocking",
        "concepts/limits",
      ],
    },
    {
      type: "category",
      label: "Reference",
      link: {
        type: "generated-index",
        description:
          "Authoritative lookups: CLI commands and diagnostics, the glossary, agent surfaces, and per-package API reference for core, parser, service, agent, lsp, and harvester.",
      },
      items: [
        {
          type: "category",
          label: "CLI & Diagnostics",
          items: [
            "api/cli-reference",
            "reference/diagnostics",
            "reference/glossary",
          ],
        },
        {
          type: "category",
          label: "Package APIs",
          items: [
            "api/core",
            "api/parser",
            "api/service",
            "api/agent",
            "api/lsp",
            "api/harvester",
          ],
        },
        "reference/agents",
        "releases",
        "releases-history",
      ],
    },
    {
      type: "category",
      label: "Project",
      items: ["guides/competitive-landscape", "design/design-doc", "contributing"],
    },
  ],
};

export default sidebars;
