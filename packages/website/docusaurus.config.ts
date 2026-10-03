import { themes as prismThemes } from "prism-react-renderer";
import type { Config, Plugin } from "@docusaurus/types";
import type { Configuration } from "webpack";
import { DefinePlugin, NormalModuleReplacementPlugin, ProvidePlugin } from "webpack";
import type * as Preset from "@docusaurus/preset-classic";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { remarkPairSidecarPlayground } from "./src/plugins/remark-pair-sidecar";
import { buildSiteGraph } from "./src/seo/jsonld.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)));

// 每页 provenance：文档构建所用的引擎版本（读包版本，永不手改）+ 构建提交。
// CI 有 GITHUB_SHA；本地回退到 git rev-parse（无 git 时留空，页面只显示版本）。
const docsCommit = ((): string => {
  const env = process.env.GITHUB_SHA;
  if (env && env.length > 0) return env.slice(0, 7);
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
})();

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
  // 构建提速:SWC loader/minifier + lightningcss + MDX 跨编译缓存。
  // rspackBundler 暂不开 —— configureWebpack 里的 DefinePlugin /
  // NormalModuleReplacementPlugin / splitChunks 需要在 Rspack 下逐项验证。
  future: {
    faster: {
      swcJsLoader: true,
      swcJsMinimizer: true,
      swcHtmlMinimizer: true,
      lightningCssMinimizer: true,
      mdxCrossCompilerCache: true,
      // ssgWorkerThreads 需要 future.v4.removeLegacyPostBuildHeadAttribute ——
      // 不引入整串 v4 flag 前保持关闭
    },
  },
  title: "Nudo",
  tagline:
    "Welcome back to JavaScript — Your JS stays JS: observe intermediates, enforce contracts sharper than types.",
  // og:image 已由 themeConfig.image 覆盖；Twitter 卡片类型在 themeConfig.metadata（Config 顶层无此字段）
  favicon: "img/favicon.svg",

  url: "https://nudojs.github.io",
  baseUrl,

  organizationName: "nudojs",
  projectName: "nudo",

  // 全站结构化数据（site-level JSON-LD）。逐页 TechArticle 由
  // src/theme/DocItem/Footer 注入——两者都不与 Docusaurus 默认 meta 冲突。
  headTags: [
    {
      tagName: "script",
      attributes: { type: "application/ld+json" },
      innerHTML: JSON.stringify(buildSiteGraph(pkgVersion("nudojs"))),
    },
  ],

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
          // ```js verify-sidecar``` 围栏配对最近的前置 ```js verify``` 主码
          // （hProperties → CodeBlock playgroundMain prop），让契约围栏
          // 也能拿到双栏 Playground 链接。
          remarkPlugins: [remarkPairSidecarPlayground],
          // zh 页的「Edit this page」必须落到 zh 镜像文件（i18n/zh-Hans/…），
          // 不是英文源——插件该选项默认 false，会把两种语言都指到 en。
          editLocalizedFiles: true,
        },
        blog: {
          showReadingTime: true,
          editUrl: "https://github.com/nudojs/nudo/tree/main/packages/website/",
          editLocalizedFiles: true,
        },
        theme: {
          customCss: "./src/css/custom.css",
        },
        // Sitemap: default plugin has no hreflang option — use createSitemapItems
        // to attach xhtml:link locale alternates (en ↔ zh-Hans + x-default).
        sitemap: {
          changefreq: "weekly",
          priority: 0.5,
          // 分区 priority:docs 是产品面,blog 是时效内容。在 map 里按路径分档。
          // Route paths include baseUrl; cover both the page and any children.
          ignorePatterns: [
            "**/search",
            "**/search/**",
            "**/playground",
            "**/playground/**",
            // Full changelog archive dilutes search; current notes stay on /docs/releases.
            "**/releases-history",
            "**/releases-history/**",
          ],
          createSitemapItems: async ({
            defaultCreateSitemapItems,
            routes,
            siteConfig,
          }) => {
            const items = await defaultCreateSitemapItems({ routes, siteConfig });
            return items.map((item) => ({
              ...item,
              // 分档:docs 0.7(产品接口面),blog 0.4(时效),其余走默认 0.5
              priority: item.url.includes(`${baseUrl}docs/`)
                ? 0.7
                : item.url.includes(`${baseUrl}blog`)
                  ? 0.4
                  : item.priority,
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
            to: "/docs/concepts/abs",
            from: "/docs/concepts/type-values",
          },
          {
            to: "/docs/concepts/control-flow-narrowing",
            from: "/docs/guides/control-flow-narrowing",
          },
          { to: "/docs/concepts/semantics", from: "/docs/guides/semantics" },
          {
            to: "/docs/guides/export-ecosystem",
            from: "/docs/guides/runtime-generation",
          },
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
    // PWA:离线 app shell + 预缓存(Monaco 已自托管,Playground 随包离线)。
    // 默认激活策略(appInstalled / queryString):不向普通访客全量预缓存。
    [
      "@docusaurus/plugin-pwa",
      {
        debug: false,
        // 默认 2MB 上限会把 monaco / nudo-engine 大 chunk 踢出预缓存,
        // 离线 Playground 随之失效。抬到 10MB(仅 installed/queryString
        // 激活时才注册 SW,普通访客不付下载成本)。
        injectManifestConfig: {
          maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        },
        pwaHead: [
          {
            tagName: "link",
            attributes: { rel: "manifest", href: `${baseUrl}manifest.json` },
          },
          {
            tagName: "meta",
            attributes: { name: "theme-color", content: "#5b4bd4" },
          },
          {
            tagName: "link",
            attributes: {
              rel: "apple-touch-icon",
              href: `${baseUrl}img/icons/icon-180.png`,
            },
          },
          {
            tagName: "meta",
            attributes: { name: "mobile-web-app-capable", content: "yes" },
          },
          {
            tagName: "meta",
            attributes: {
              name: "apple-mobile-web-app-status-bar-style",
              content: "default",
            },
          },
        ],
      } satisfies Partial<import("@docusaurus/plugin-pwa").PluginOptions>,
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
        ignoreFiles: [
          /^\/search$/,
          /^\/playground$/,
          /^\/zh-Hans\/search$/,
          /^\/zh-Hans\/playground$/,
          /^\/releases-history$/,
          /^\/zh-Hans\/releases-history$/,
        ],
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
                // Harvester (.d.ts → Abs) is Node-only: it pulls the full
                // `typescript` compiler + fs. Playground only needs
                // `bareSpecToAbsModules` as a last-resort stub.
                "@nudojs/harvester": resolve(
                  websiteRoot,
                  "src/polyfills/harvester-browser.ts",
                ),
                typescript: resolve(websiteRoot, "src/polyfills/typescript.ts"),
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
            // Playground engine is route-lazy; further split Babel so a
            // compiler-only bump does not invalidate the whole  engine chunk
            // and docs pages never share that cache entry.
            optimization: {
              splitChunks: {
                cacheGroups: {
                  babel: {
                    test: /[\\/]node_modules[\\/]@babel[\\/]/,
                    name: "babel",
                    chunks: "async",
                    priority: 30,
                    reuseExistingChunk: true,
                  },
                  nudoEngine: {
                    test: /[\\/]packages[\\/](core|parser|service|lsp)[\\/]src[\\/]/,
                    name: "nudo-engine",
                    chunks: "async",
                    priority: 20,
                    reuseExistingChunk: true,
                  },
                },
              },
            },
            plugins: [
              // 裸全局 `process` 引用（@babel/types / monaco / service 内不
              // 走 import 的自由标识符）落到 polyfill —— DefinePlugin 只替换
              // 匹配到的 `process.env.X` 表达式,兜不住裸 `process`。
              new ProvidePlugin({
                // ESM 模块:显式取 default 导出(否则得到模块命名空间对象)
                process: [resolve(websiteRoot, "src/polyfills/process.ts"), "default"],
              }),
              // Exact free-variable replacements for Babel/webpack env probes.
              new DefinePlugin({
                // 每页 provenance（DocItem/Footer 渲染）：构建时的引擎版本 + 提交。
                // 读包版本/ git，永不手改；本地缺 git 时 commit 为空串。
                __NUDO_ENGINE_VERSION__: JSON.stringify(pkgVersion("nudojs")),
                __NUDO_DOCS_COMMIT__: JSON.stringify(docsCommit),
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
    image: "img/nudo-og.jpg",
    // og:image 已由上面的 image 覆盖，这里只补 Twitter 卡片类型（不造 handle）
    metadata: [{ name: "twitter:card", content: "summary_large_image" }],
    announcementBar: {
      // id 带版本号：内容随包版本自动推进，固定 id 会让关闭过一次的老用户
      // 永远看不到后续版本公告（dismissal 按 id 记忆）。
      id: `docs-track-${pkgVersion("nudojs")}`,
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
          // Reference 分类的 generated-index 页（sidebars.ts 无自定义 slug）
          to: "/docs/category/reference",
          label: "Reference",
          position: "left",
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
            { label: "Introduction", to: "/docs/intro" },
            { label: "Quick Start", to: "/docs/getting-started/quick-start" },
          ],
        },
        {
          title: "Docs",
          items: [
            { label: "Abs", to: "/docs/concepts/abs" },
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
