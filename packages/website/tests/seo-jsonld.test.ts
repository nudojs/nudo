// 面向搜索/社交/agent 的结构化数据与社交卡片文本门禁（src/seo/jsonld.ts）。
// 纯函数单测：页面级 TechArticle、站点级 SoftwareApplication/WebSite、OG 图替代文本。
// 站点级软件版本必须跟随 packages/nudojs 的版本 —— 硬编码会静默过期。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  absoluteUrl,
  buildTechArticleJsonLd,
  buildSiteGraph,
  ogImageAlt,
  BASE_URL,
  SITE_ORIGIN,
} from "../src/seo/jsonld.ts";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const nudojsVersion = (
  JSON.parse(readFileSync(`${repoRoot}/packages/nudojs/package.json`, "utf8")) as {
    version: string;
  }
).version;

describe("tech article JSON-LD", () => {
  const base = {
    title: "nudo check",
    description: "L1 refinement gate + L2 entry throws on Abs.",
    permalink: "/nudo/docs/guides/check",
    locale: "en",
    lastUpdatedAt: Date.UTC(2026, 8, 29, 12, 0, 0),
  };

  it("normalizes relative permalinks and keeps absolute ones", () => {
    expect(absoluteUrl("/nudo/docs/guides/check")).toBe(
      `${SITE_ORIGIN}/nudo/docs/guides/check`,
    );
    expect(absoluteUrl("https://nudojs.github.io/nudo/docs/intro")).toBe(
      "https://nudojs.github.io/nudo/docs/intro",
    );
    expect(buildTechArticleJsonLd(base).url).toBe(
      `${SITE_ORIGIN}/nudo/docs/guides/check`,
    );
  });

  it("carries title, description, language and dateModified", () => {
    const ld = buildTechArticleJsonLd(base);
    expect(ld["@type"]).toBe("TechArticle");
    expect(ld.headline).toBe("nudo check");
    expect(ld.description).toBe(base.description);
    expect(ld.inLanguage).toBe("en");
    expect(ld.dateModified).toBe("2026-09-29T12:00:00.000Z");
  });

  it("omits dateModified and description instead of inventing them", () => {
    const ld = buildTechArticleJsonLd({
      title: "Intro",
      permalink: "/nudo/docs/intro",
      locale: "zh-Hans",
    });
    expect("dateModified" in ld).toBe(false);
    expect("description" in ld).toBe(false);
    expect(ld.inLanguage).toBe("zh-Hans");
  });

  it("serializes to valid JSON (no undefined holes)", () => {
    const raw = JSON.stringify(buildTechArticleJsonLd(base));
    expect(raw).not.toMatch(/undefined/);
    expect(JSON.parse(raw)).toMatchObject({ "@type": "TechArticle" });
  });
});

describe("site graph JSON-LD", () => {
  it("softwareVersion tracks packages/nudojs/package.json", () => {
    const graph = JSON.parse(JSON.stringify(buildSiteGraph(nudojsVersion)));
    const app = graph["@graph"].find(
      (n: { "@type": string }) => n["@type"] === "SoftwareApplication",
    );
    expect(app.softwareVersion).toBe(nudojsVersion);
    expect(app.offers).toMatchObject({ price: "0" });
  });

  it("website node points search at the local search route", () => {
    const graph = JSON.parse(JSON.stringify(buildSiteGraph(nudojsVersion)));
    const site = graph["@graph"].find(
      (n: { "@type": string }) => n["@type"] === "WebSite",
    );
    expect(site.url).toBe(`${SITE_ORIGIN}${BASE_URL}`);
    expect(site.potentialAction.target.urlTemplate).toBe(
      `${SITE_ORIGIN}${BASE_URL}search?q={search_term_string}`,
    );
  });
});

describe("og image alt text", () => {
  it("names the page and the site", () => {
    expect(ogImageAlt("nudo check")).toBe("nudo check — Nudo documentation");
  });
});
