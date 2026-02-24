import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const config: Config = {
  title: "Nudo",
  tagline: "Type inference for JavaScript through abstract interpretation",
  // favicon: "img/favicon.ico",

  url: "https://nudojs.github.io",
  baseUrl: "/nudo/",

  organizationName: "nudojs",
  projectName: "nudo",

  onBrokenLinks: "throw",

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },

  i18n: {
    defaultLocale: "en",
    locales: ["en", "zh-Hans"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          editUrl: "https://github.com/nudojs/nudo/tree/main/packages/website/",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    navbar: {
      title: "Nudo",
      items: [
        {
          type: "docSidebar",
          sidebarId: "docsSidebar",
          position: "left",
          label: "Docs",
        },
        {
          href: "https://github.com/nudojs/nudo",
          label: "GitHub",
          position: "right",
        },
        {
          type: "localeDropdown",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            { label: "Getting Started", to: "/docs/intro" },
            { label: "Core Concepts", to: "/docs/concepts/type-values" },
            { label: "API Reference", to: "/docs/api/core" },
          ],
        },
        {
          title: "More",
          items: [
            { label: "GitHub", href: "https://github.com/nudojs/nudo" },
            { label: "Design Document", to: "/docs/design/design-doc" },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Nudo Contributors. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["bash", "json"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
