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
        "guides/recipes",
      ],
    },
    {
      type: "category",
      label: "How-to",
      link: { type: "generated-index" },
      items: [
        "guides/check",
        "guides/contract",
        "guides/cli",
        "guides/callsite-discovery",
        "guides/runtime-generation",
        "guides/health",
        "guides/env-harvest",
        "guides/examples",
        "guides/error-faces",
        "guides/ai-native-dx",
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
      ],
    },
    {
      type: "category",
      label: "Migrating & Coexistence",
      items: [
        "guides/migrating-js",
        "guides/migrating-from-typescript",
        "guides/case-study-retire",
        "guides/vs-typescript",
        "guides/coexistence",
        "guides/versioning",
      ],
    },
    {
      type: "category",
      label: "Concepts",
      items: [
        "concepts/layers",
        "concepts/type-values",
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
      link: { type: "generated-index" },
      items: [
        "reference/diagnostics",
        "reference/glossary",
        "releases",
        "reference/agents",
        "api/cli-reference",
        "api/core",
        "api/parser",
        "api/service",
        "api/agent",
        "api/lsp",
        "api/harvester",
      ],
    },
    {
      type: "category",
      label: "Design",
      items: ["design/design-doc"],
    },
    "contributing",
  ],
};

export default sidebars;
