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
      label: "Guides",
      items: [
        "guides/cli",
        "guides/check",
        "guides/callsite-discovery",
        "guides/semantics",
        "guides/vscode",
        "guides/zed",
        "guides/control-flow-narrowing",
        "guides/runtime-generation",
        "guides/mcp-server",
        "guides/vite-plugin",
        "guides/examples",
        "guides/migrating-js",
        "guides/lsp-clients",
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