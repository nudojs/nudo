import { themes as prismThemes } from "prism-react-renderer";
import type { Config, Plugin } from "@docusaurus/types";
import type { Configuration } from "webpack";
import { DefinePlugin, NormalModuleReplacementPlugin } from "webpack";
import type * as Preset from "@docusaurus/preset-classic";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)));

// 与 config.baseUrl 保持一致；announcementBar 是原始 HTML，链接需自带 baseUrl
const baseUrl = "/nudo/";
const siteOrigin = "https://nudojs.github.io";

// 站点追踪的包版本（构建期从 package.json 读取 —— 永不手改，随发布自动前进）
const pkgVersion = (p: string): string =>
  JSON.parse(
    readFileSync(resolve(repoRoot, `packages/${p}/package.json`), "utf8"),
  ).version as string;
// 公告条只保留 nudojs 版本 + Releases 入口，避免版本串刷屏
const DOCS_TRACK = `Docs track main · nudojs ${pkgVersion("nudojs")} · <a href="${baseUrl}docs/releases">Releases</a>`;

// URL 级 locale 互链：给每个页面挂上 en / zh-Hans / x-default 的 hreflang alternate。
// 官方 sitemap 插件没有 alternates 选项，底层 `sitemap` 包支持 `links` 字段。
function localeAlternates(absUrl: string): Array<{ lang: string; url: string }> {
  const path = absUrl.startsWith(siteOrigin)
    ? absUrl.slice(siteOrigin.length)
    : absUrl;
  const zhPrefix = `${baseUrl}zh-Hans/`;
  const rest = path.startsWith(zhPrefix)
    ? path.slice(zhPrefix.length)
    : path.startsWith(baseUrl)
      ? path.slice(baseUrl.length)
      : path.replace(/^\//, "");
  const enUrl = `${siteOrigin}${baseUrl}${rest}`;
  const zhUrl = `${siteOrigin}${zhPrefix}${rest}`;
  return [
    { lang: "en", url: enUrl },
    { lang: "zh-Hans", url: zhUrl },
    { lang: "x-default", url: enUrl },
  ];
}

const config: Config = {
  title: "Nudo",
  tagline:
    "Welcome back to JavaScript — Your JS stays JS: observe intermediates, enforce contracts sharper than types.",
  favicon: "img/favicon.svg",

  url: "https://nudojs.github.io",
  baseUrl,

  organizationName: "nudojs",
  projectName: "nudo",

  onBrokenLinks: "throw",
  onBrokenAnchors: "throw",

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "throw",
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
          showLastUpdateTime: true,
          showLastUpdateAuthor: true,
        },
        blog: {
          showReadingTime: true,
          editUrl: "https://github.com/nudojs/nudo/tree/main/packages/website/",
        },
        theme: {
          customCss: "./src/css/custom.css",
        },
        // Sitemap: default plugin has no hreflang option — use createSitemapItems
        // to attach xhtml:link locale alternates (en ↔ zh-Hans + x-default).
        sitemap: {
          changefreq: "weekly",
          priority: 0.5,
          // Route paths include baseUrl; cover both the page and any children.
          ignorePatterns: [
            "**/search",
            "**/search/**",
            "**/playground",
            "**/playground/**",
          ],
          createSitemapItems: async ({
            defaultCreateSitemapItems,
            routes,
            siteConfig,
          }) => {
            const items = await defaultCreateSitemapItems({ routes, siteConfig });
            return items.map((item) => ({
              ...item,
              // Underlying `sitemap` lib emits <xhtml:link rel="alternate" hreflang=…>
              links: localeAlternates(item.url),
            })) as typeof items;
          },
        },
      } satisfies Preset.Options,
    ],
  ],

  // Playground 在浏览器里直接跑推断引擎（@nudojs/service/evaluator）。
  // evaluator-api 的 re-export 链会把 env-loader（node:fs/path/crypto/
  // os/module/url）带进浏览器 bundle——浏览器里不可达（loadEnvs 只在
  // Node CLI 用），alias 成空模块。
  plugins: [
    // 旧 IA 路由 → 新路由（guides/ → concepts/、mcp-server → agent-integration）。
    // 线上旧 URL 仍被搜索引擎 / README / 旧链接引用，直接消失会 404。
    [
      "@docusaurus/plugin-client-redirects",
      {
        redirects: [
          {
            to: "/docs/concepts/control-flow-narrowing",
            from: "/docs/guides/control-flow-narrowing",
          },
          { to: "/docs/concepts/semantics", from: "/docs/guides/semantics" },
          {
            to: "/docs/guides/agent-integration",
            from: "/docs/guides/mcp-server",
          },
          // Blog posts moved from date-based URLs to stable short slugs.
          { to: "/blog/agents-docs", from: "/blog/2026/09/21/agents-docs" },
          { to: "/blog/day0-observe", from: "/blog/2026/09/21/day0-observe" },
          { to: "/blog/day1-contracts", from: "/blog/2026/09/21/day1-contracts" },
          { to: "/blog/vs-typescript", from: "/blog/2026/09/21/vs-typescript" },
        ],
      },
    ],
    // 离线全文搜索（中英分词，无 Algolia 外部依赖）
    [
      "@easyops-cn/docusaurus-search-local",
      {
        hashed: true,
        indexDocs: true,
        indexBlog: true,
        language: ["en", "zh"],
        docsRouteBasePath: "/docs",
        // 索引排除：搜索页 / playground 自身会稀释命中质量
        ignoreFiles: [/^\/search$/, /^\/playground$/, /^\/zh-Hans\/search$/, /^\/zh-Hans\/playground$/],
        // 长页面噪声：页眉页脚 / 侧栏 / TOC / 公告条不进入索引
        ignoreCssSelectors: [
          "nav.navbar",
          "footer.footer",
          ".theme-announcement-bar",
          ".theme-doc-sidebar-container",
          ".theme-doc-toc-mobile",
          ".theme-doc-toc-desktop",
          ".theme-doc-breadcrumbs",
          ".pagination-nav",
        ],
        searchResultLimits: 8,
        // 文档优先：docs 路径独立索引，搜索默认落在 docs 上下文
        searchContextByPaths: ["docs"],
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
                "@nudojs/service/emit": resolve(repoRoot, "packages/service/src/emit"),
                "@nudojs/lsp": resolve(repoRoot, "packages/lsp/src"),
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
    image: "img/nudo-og.png",
    announcementBar: {
      id: "docs-track",
      content: DOCS_TRACK,
      isCloseable: true,
    },
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
