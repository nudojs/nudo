import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type { Configuration, Plugin } from "webpack";
import { NormalModuleReplacementPlugin } from "webpack";
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

  // Playground 在浏览器里直接跑推断引擎（@nudojs/cli/evaluator）。
  // evaluator-api 的 re-export 链会把 env-loader（node:fs/path/crypto/
  // os/module/url）带进浏览器 bundle——浏览器里不可达（loadEnvs 只在
  // Node CLI 用），alias 成空模块。
  plugins: [
    function nodeBuiltinsStub(): Plugin {
      return {
        name: "node-builtins-stub",
        configureWebpack(): Configuration {
          return {
            resolve: {
              // 浏览器里不可达的 Node 内建（env-loader 等只在 Node CLI
              // 用，被 evaluator-api 的 re-export 链拖进 bundle）
              fallback: {
                fs: false,
                path: false,
                crypto: false,
                os: false,
                module: false,
                url: false,
              },
            },
            plugins: [
              // node: scheme 的 request 在 alias/fallback 之前就被
              // webpack 以 UnhandledSchemeError 拒绝——解析阶段把
              // "node:fs" 改写成 "fs"，交给上面的 fallback 置空。
              new NormalModuleReplacementPlugin(/^node:(fs|path|crypto|os|module|url)$/, (resource) => {
                resource.request = resource.request.slice(5);
              }),
            ],
          };
        },
      };
    },
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
          to: "/playground",
          label: "Playground",
          position: "left",
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
