import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type { Configuration, Plugin } from "webpack";
import { DefinePlugin, NormalModuleReplacementPlugin } from "webpack";
import type * as Preset from "@docusaurus/preset-classic";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)));

const config: Config = {
  title: "Nudo",
  tagline:
    "Welcome back to JavaScript — Your JS stays JS: observe intermediates, enforce contracts sharper than types.",
  favicon: "img/favicon.svg",

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
        blog: {
          showReadingTime: true,
          editUrl: "https://github.com/nudojs/nudo/tree/main/packages/website/",
        },
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  // Playground 在浏览器里直接跑推断引擎（@nudojs/service/evaluator）。
  // evaluator-api 的 re-export 链会把 env-loader（node:fs/path/crypto/
  // os/module/url）带进浏览器 bundle——浏览器里不可达（loadEnvs 只在
  // Node CLI 用），alias 成空模块。
  plugins: [
    // 离线全文搜索（中英分词，无 Algolia 外部依赖）
    [
      "@easyops-cn/docusaurus-search-local",
      {
        hashed: true,
        indexDocs: true,
        indexBlog: true,
        language: ["en", "zh"],
      },
    ],
    function nodeBuiltinsStub(): Plugin {
      return {
        name: "node-builtins-stub",
        configureWebpack(): Configuration {
          return {
            resolve: {
              // monorepo 内 @nudojs/* 的 package.json exports → dist/；
              // 本地/CI 文档站不先 build，直接 alias 到 src
              alias: {
                "@nudojs/service/evaluator": resolve(
                  repoRoot,
                  "packages/service/src/evaluator/evaluator-api.ts",
                ),
                "@nudojs/core/exec": resolve(
                  repoRoot,
                  "packages/core/src/algebra/exec/index.ts",
                ),
                "@nudojs/core": resolve(repoRoot, "packages/core/src"),
                "@nudojs/parser": resolve(repoRoot, "packages/parser/src"),
                "@nudojs/service": resolve(repoRoot, "packages/service/src"),
                "@nudojs/harvester": resolve(repoRoot, "packages/harvester/src"),
                "@nudojs/env/es": resolve(repoRoot, "packages/env/src/es.ts"),
                "@nudojs/env/web": resolve(repoRoot, "packages/env/src/web.ts"),
                "@nudojs/env/node": resolve(repoRoot, "packages/env/src/node.ts"),
                // Browser ALS stub — core exec/member-diag instantiate
                // AsyncLocalStorage at module load; empty fallbacks crash.
                async_hooks: resolve(
                  repoRoot,
                  "packages/website/src/polyfills/async-hooks.ts",
                ),
                // @babel/types reads process.env.* at module load in the
                // playground bundle; a false/empty fallback throws.
                process: resolve(websiteRoot, "src/polyfills/process.ts"),
                // Analyzer/parser call path.dirname on virtual filenames.
                path: resolve(websiteRoot, "src/polyfills/path.ts"),
              },
              // 浏览器里不可达的 Node 内建（env-loader / fs 等只在 Node CLI 用）
              fallback: {
                fs: false,
                crypto: false,
                os: false,
                module: false,
                url: false,
                worker_threads: false,
                child_process: false,
                net: false,
                tls: false,
                http: false,
                https: false,
                stream: false,
                util: false,
                buffer: false,
                events: false,
              },
            },
            plugins: [
              // Exact free-variable replacements for Babel/webpack env probes.
              new DefinePlugin({
                "process.env.NODE_ENV": JSON.stringify(
                  process.env.NODE_ENV ?? "development",
                ),
                "process.env.BABEL_TYPES_8_BREAKING": "undefined",
                "process.env.BABEL_8_BREAKING": "undefined",
                "process.env.IS_PUBLISH": "undefined",
                "process.browser": "true",
                "process.platform": JSON.stringify("browser"),
                "process.version": JSON.stringify("v0.0.0-browser"),
              }),
              // node: scheme 的 request 在 alias/fallback 之前就被
              // webpack 以 UnhandledSchemeError 拒绝——解析阶段去掉
              // "node:" 前缀，交给上面的 alias/fallback 处理。
              new NormalModuleReplacementPlugin(/^node:(.+)$/, (resource) => {
                resource.request = resource.request.replace(/^node:/, "");
              }),
            ],
          };
        },
      };
    },
  ],

  themeConfig: {
    image: "img/nudo-og.svg",
    colorMode: {
      respectPrefersColorScheme: true,
    },
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
          to: "/blog",
          label: "Blog",
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
          title: "Start",
          items: [
            { label: "Playground", to: "/playground" },
            { label: "Getting Started", to: "/docs/intro" },
            { label: "Quick Start", to: "/docs/getting-started/quick-start" },
          ],
        },
        {
          title: "Docs",
          items: [
            { label: "Abs", to: "/docs/concepts/type-values" },
            { label: "nudo check", to: "/docs/guides/check" },
            { label: "nudo contract", to: "/docs/guides/contract" },
            { label: "Nudo vs TypeScript", to: "/docs/guides/vs-typescript" },
            { label: "Diagnostics", to: "/docs/reference/diagnostics" },
            { label: "Recipes", to: "/docs/guides/recipes" },
          ],
        },
        {
          title: "More",
          items: [
            { label: "Agents", href: "https://nudojs.github.io/nudo/agents.md" },
            { label: "llms.txt", href: "https://nudojs.github.io/nudo/llms.txt" },
            { label: "Blog", to: "/blog" },
            { label: "GitHub", href: "https://github.com/nudojs/nudo" },
            { label: "Limits", to: "/docs/concepts/limits" },
            { label: "Design Document", to: "/docs/design/design-doc" },
          ],
        },
      ],
      copyright: `Welcome back to JavaScript. Your JS stays JS; contracts sharper than types.<br/>Copyright © ${new Date().getFullYear()} Nudo Contributors. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["bash", "json"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
