import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docsSidebar: [
    "intro",
    {
      type: "category",
      label: "Getting Started",
      items: ["getting-started/installation", "getting-started/quick-start"],
    },
    {
      type: "category",
      label: "Core Concepts",
      items: [
        "concepts/layers",
        "concepts/type-values",
        "concepts/abstract-interpretation",
        "concepts/directives",
      ],
    },
    {
      type: "category",
      label: "Workflows",
      items: [
        "guides/cli",
        "guides/check",
        "guides/callsite-discovery",
        "guides/examples",
        "guides/runtime-generation",
      ],
    },
    {
      type: "category",
      label: "Editors & Agents",
      items: [
        "guides/vscode",
        "guides/zed",
        "guides/mcp-server",
        "guides/lsp-clients",
        "guides/vite-plugin",
      ],
    },
    {
      type: "category",
      label: "Semantics & Advanced",
      items: [
        "guides/semantics",
        "guides/control-flow-narrowing",
      ],
    },
    {
      type: "category",
      label: "Migrating & Coexistence",
      items: [
        "guides/migrating-js",
        "guides/vs-typescript",
        "guides/coexistence",
        "guides/versioning",
      ],
    },
    {
      type: "category",
      label: "API Reference",
      items: [
        "api/core",
        "api/parser",
        "api/service",
        "api/cli-reference",
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
