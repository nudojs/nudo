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
        "guides/vscode",
        "guides/vite-plugin",
        "guides/examples",
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
