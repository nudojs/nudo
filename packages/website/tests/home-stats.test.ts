// 首页实测数字的溯源门禁：每条 stat 的 claims 必须在 source.path 指向的文档页里
// 逐字存在，且 value/compare 里的每个数字串都被某条 claim 覆盖（qualitative 例外）。
// 作用：数字与文档必须同源——改了首页没改文档（或反过来）都会红。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { trialStats, costStats, type StatSource } from "../src/content/home.ts";

const docsRoot = fileURLToPath(new URL("../docs/", import.meta.url));

/** value / compare 里的数字串（98.6% / 291 / 993k / 0.19 / 10 / 45 …）。 */
const numericTokens = (text: string): string[] =>
  (text.match(/\d[\d.,]*(?:\s?%|\s?k|\s?ms|\s?×)?/g) ?? []).map((t) => t.trim());

type StatLike = {
  value: string;
  compare?: string;
  labelId: string;
  source: StatSource;
  qualitative?: boolean;
};

const allStats: Array<StatLike & { group: string }> = [
  ...trialStats.map((s) => ({ ...s, group: "trial" })),
  ...costStats.map((s) => ({ ...s, group: "cost" })),
];

const pageOf = (source: StatSource): string =>
  readFileSync(`${docsRoot}${source.path}`, "utf8");

describe("homepage measured stats are sourced from the docs", () => {
  it("every stat declares a source page with at least one claim", () => {
    const bad: string[] = [];
    for (const stat of allStats) {
      if (!stat.source?.path) bad.push(`${stat.labelId}: no source path`);
      else if (!stat.source.claims?.length) bad.push(`${stat.labelId}: no claims`);
      else pageOf(stat.source); // throws when the page is missing
    }
    expect(bad, bad.join("; ")).toEqual([]);
  });

  it("every claim appears verbatim in its source page", () => {
    const bad: string[] = [];
    for (const stat of allStats) {
      const page = pageOf(stat.source);
      for (const claim of stat.source.claims) {
        if (!page.includes(claim)) bad.push(`${stat.labelId}: "${claim}" not in ${stat.source.path}`);
      }
    }
    expect(bad, `homepage claims missing from docs: ${bad.join("; ")}`).toEqual([]);
  });

  it("numbers shown on the homepage are covered by the claims", () => {
    const bad: string[] = [];
    for (const stat of allStats) {
      if (stat.qualitative) continue;
      const claims = stat.source.claims.join(" ");
      for (const token of numericTokens(`${stat.value} ${stat.compare ?? ""}`)) {
        if (!claims.includes(token)) {
          bad.push(`${stat.labelId}: number "${token}" not pinned by any claim`);
        }
      }
    }
    expect(bad, `unpinned homepage numbers: ${bad.join("; ")}`).toEqual([]);
  });
});
