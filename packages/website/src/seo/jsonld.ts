/**
 * 结构化数据（JSON-LD）与社交卡片元数据构造器。
 *
 * 纯函数、零 React 依赖：`src/theme/DocItem/Footer` 挂载它们，
 * `packages/website/tests/seo-jsonld.test.ts` 直接单测。
 * 站点级图（SoftwareApplication / WebSite）同样在这里定义，
 * 由 `docusaurus.config.ts` 的 `headTags` 输出——单一事实来源。
 */

export const SITE_NAME = "Nudo";
export const SITE_ORIGIN = "https://nudojs.github.io";
export const BASE_URL = "/nudo/";
const GITHUB_URL = "https://github.com/nudojs/nudo";

/** 逐页 TechArticle 需要的文档元数据（Docusaurus doc metadata 的子集）。 */
export type ArticleMeta = {
  title: string;
  description?: string;
  /** Docusaurus 的 doc permalink；绝对 URL 或站内路径都接受。 */
  permalink: string;
  /** Docusaurus locale（`en` / `zh-Hans`），直接作为 BCP47 inLanguage。 */
  locale: string;
  /** Doc metadata 的 lastUpdatedAt（epoch ms）。 */
  lastUpdatedAt?: number;
};

/** 站内路径 / 绝对 URL 都归一成绝对 URL。 */
export function absoluteUrl(permalink: string): string {
  return permalink.startsWith("http")
    ? permalink
    : new URL(permalink, SITE_ORIGIN).toString();
}

/**
 * 逐页 TechArticle。`headline` / `description` 取页面自身元数据，
 * `dateModified` 只有拿到 lastUpdatedAt 时才输出（不编造日期）。
 */
export function buildTechArticleJsonLd(meta: ArticleMeta): Record<string, unknown> {
  const article: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: meta.title,
    url: absoluteUrl(meta.permalink),
    inLanguage: meta.locale,
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: `${SITE_ORIGIN}${BASE_URL}` },
    publisher: { "@type": "Organization", name: `${SITE_NAME} Contributors`, url: GITHUB_URL },
  };
  if (meta.description) article.description = meta.description;
  if (typeof meta.lastUpdatedAt === "number" && Number.isFinite(meta.lastUpdatedAt)) {
    article.dateModified = new Date(meta.lastUpdatedAt).toISOString();
  }
  return article;
}

/** 站点级图：SoftwareApplication（产品面）+ WebSite（含站点内搜索）。 */
export function buildSiteGraph(engineVersion: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: SITE_NAME,
        alternateName: "nudojs",
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Cross-platform",
        programmingLanguage: "JavaScript",
        softwareVersion: engineVersion,
        url: `${SITE_ORIGIN}${BASE_URL}`,
        sameAs: [GITHUB_URL, "https://www.npmjs.com/package/nudojs"],
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      },
      {
        "@type": "WebSite",
        name: SITE_NAME,
        url: `${SITE_ORIGIN}${BASE_URL}`,
        inLanguage: ["en", "zh-Hans"],
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${SITE_ORIGIN}${BASE_URL}search?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };
}

/** og:image / twitter:image 的替代文本（社交卡片与屏幕阅读器共用）。 */
export function ogImageAlt(title: string): string {
  return `${title} — ${SITE_NAME} documentation`;
}
