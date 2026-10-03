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
        "getting-started/troubleshooting",
      ],
    },
    {
      type: "category",
      label: "Concepts",
      items: [
        "concepts/layers",
        "concepts/abs",
        "concepts/hof-relations",
        "concepts/abstract-interpretation",
        "concepts/semantics",
        "concepts/control-flow-narrowing",
        "concepts/mocking",
      ],
    },
    {
      type: "category",
      label: "How-to",
      link: {
        type: "generated-index",
        description:
          "Task-oriented guides: how to install, gate, and read Nudo in CI. The CI gate is `nudo check`; `nudo test` is an optional debug case reporter, not the gate.",
      },
      items: [
        {
          type: "category",
          label: "Gate",
          items: [
            "guides/check",
            "guides/health",
            "guides/performance",
            "guides/error-faces",
          ],
        },
        {
          type: "category",
          label: "Contracts",
          items: [
            "guides/contract",
            "guides/env-harvest",
          ],
        },
        {
          type: "category",
          label: "Ecosystem",
          items: [
            "guides/export-ecosystem",
            "guides/callsite-discovery",
            "guides/examples",
          ],
        },
        {
          type: "category",
          label: "Debug & scenarios",
          items: ["guides/test"],
        },
        {
          type: "category",
          label: "Recipes",
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
      label: "Migrate from TypeScript",
      link: {
        type: "generated-index",
        description:
          "Retire the tsc gate for JS packages. `migrate` is a one-way retirement gate (status|strip|verify|retire), not a primary verb — exit is `nudo migrate retire`.",
      },
      items: [
        "guides/migrating-js",
        "guides/migrating-from-typescript",
        "guides/case-study-retire",
        "guides/coexistence",
      ],
    },
    "concepts/limits",
    {
      type: "category",
      label: "Reference",
      link: {
        type: "generated-index",
        description:
          "Authoritative lookups: CLI commands and diagnostics, comparison with TypeScript, agent surfaces, and per-package API reference.",
      },
      items: [
        {
          type: "category",
          label: "CLI & diagnostics",
          items: [
            "guides/cli",
            "api/cli-reference",
            "reference/config",
            "reference/diagnostics",
          ],
        },
        {
          type: "category",
          label: "Comparison with TypeScript",
          items: [
            "guides/vs-typescript",
            "guides/errors-vs-typescript",
            "guides/versioning",
          ],
        },
        "glossary",
        "concepts/directives",
        {
          type: "category",
          label: "Package APIs",
          items: [
            "api/agent",
            "api/service",
            "api/core",
            "api/lsp",
            "api/harvester",
            "api/parser",
          ],
        },
        "reference/agents",
        "releases",
      ],
    },
    {
      type: "category",
      label: "Project",
      items: ["guides/competitive-landscape", "design/design-doc", "design/notes", "contributing"],
    },
  ],
};

export default sidebars;
