// 文档 ↔ 产品面的一致性门禁（docs-as-code）：
// 1. 源码里每个 `code: "nudo:*"` 诊断码都在诊断术语表（en + zh）有显式锚点
//    —— CLI 的「诊断 → 文档深链」依赖这条规则（anchor = code.replaceAll(":","-")）。
// 2. 术语表每个 nudo:* 标题都带显式 {#…} 锚点，且 id 符合上述规则。
// 3. zh 文档页集合 == en 文档页集合（页面级 i18n 对齐）。
// 4. sidebars.ts 的每个 category label 在 zh current.json 有翻译。
// 5. docusaurus.config.ts 的 navbar/footer label、footer title 都在 zh navbar.json / footer.json 有翻译；
//    footer.json 不得残留 config 里已不存在的 stale key。
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const SRC_DIRS = ["core", "service", "nudojs", "lsp", "parser"].map((p) =>
  join(repoRoot, "packages", p, "src"),
);
const EN_DOCS = join(repoRoot, "packages/website/docs");
const ZH_DOCS = join(
  repoRoot,
  "packages/website/i18n/zh-Hans/docusaurus-plugin-content-docs/current",
);
const GLOSSARY_EN = join(EN_DOCS, "reference/diagnostics.md");
const GLOSSARY_ZH = join(ZH_DOCS, "reference/diagnostics.md");

function srcFiles(): string[] {
  return SRC_DIRS.flatMap((dir) =>
    walk(dir).filter(
      (f) => /\.(ts|tsx)$/.test(f) && !/__tests__|dist|node_modules/.test(f),
    ),
  );
}

function emittedCodes(): Set<string> {
  const codes = new Set<string>();
  for (const f of srcFiles()) {
    for (const m of readFileSync(f, "utf8").matchAll(/code:\s*"(nudo:[\w-]+)"/g)) {
      codes.add(m[1]);
    }
  }
  return codes;
}

const anchorOf = (code: string): string => `{#${code.replaceAll(":", "-")}}`;

describe("diagnostic code ↔ docs glossary", () => {
  const en = readFileSync(GLOSSARY_EN, "utf8");
  const zh = readFileSync(GLOSSARY_ZH, "utf8");

  it("every emitted code has an explicit anchor in the en glossary", () => {
    const missing = [...emittedCodes()]
      .filter((c) => !en.includes(anchorOf(c)))
      .sort();
    expect(missing, `missing anchors in en glossary: ${missing.join(", ")}`).toEqual([]);
  });

  it("every emitted code has an explicit anchor in the zh glossary", () => {
    const missing = [...emittedCodes()]
      .filter((c) => !zh.includes(anchorOf(c)))
      .sort();
    expect(missing, `missing anchors in zh glossary: ${missing.join(", ")}`).toEqual([]);
  });

  it("every nudo:* heading in the glossaries carries a rule-conform anchor", () => {
    for (const [label, src] of [["en", en], ["zh", zh]] as const) {
      const bad: string[] = [];
      for (const m of src.matchAll(/^### `(nudo[\w:-]+)`([^\n]*)$/gm)) {
        if (m[2].trim() !== anchorOf(m[1])) {
          bad.push(`${label}: heading ${m[1]} has ${m[2] || "no anchor"}`);
        }
      }
      expect(bad, bad.join("; ")).toEqual([]);
    }
  });
});

describe("zh docs mirror en docs", () => {
  it("page sets are identical", () => {
    const ids = (dir: string) =>
      new Set(
        walk(dir)
          .filter((f) => f.endsWith(".md"))
          .map((f) => relative(dir, f).replace(/\.md$/, "")),
      );
    const en = ids(EN_DOCS);
    const zh = ids(ZH_DOCS);
    const onlyEn = [...en].filter((p) => !zh.has(p)).sort();
    const onlyZh = [...zh].filter((p) => !en.has(p)).sort();
    expect(onlyEn, `zh missing: ${onlyEn.join(", ")}`).toEqual([]);
    expect(onlyZh, `en missing: ${onlyZh.join(", ")}`).toEqual([]);
  });

  it("every sidebar category label has a zh translation", () => {
    const sidebars = readFileSync(join(repoRoot, "packages/website/sidebars.ts"), "utf8");
    const current = JSON.parse(
      readFileSync(join(repoRoot, "packages/website/i18n/zh-Hans/docusaurus-plugin-content-docs/current.json"), "utf8"),
    );
    const labels: string[] = [];
    const blocks = sidebars.split("type: \"category\"");
    for (const b of blocks.slice(1)) {
      const m = /label:\s*"([^"]+)"/.exec(b);
      if (m) labels.push(m[1]);
    }
    const missing = labels.filter(
      (l) => !(`sidebar.docsSidebar.category.${l}` in current),
    );
    expect(missing, `untranslated sidebar labels: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("zh navbar/footer i18n coverage", () => {
  const config = readFileSync(join(repoRoot, "packages/website/docusaurus.config.ts"), "utf8");
  const navbar = JSON.parse(
    readFileSync(join(repoRoot, "packages/website/i18n/zh-Hans/docusaurus-theme-classic/navbar.json"), "utf8"),
  );
  const footer = JSON.parse(
    readFileSync(join(repoRoot, "packages/website/i18n/zh-Hans/docusaurus-theme-classic/footer.json"), "utf8"),
  );

  // Slice the themeConfig into navbar / footer regions so labels are scoped.
  const navbarSrc = config.slice(config.indexOf("navbar: {"), config.indexOf("footer: {"));
  const footerSrc = config.slice(config.indexOf("footer: {"), config.indexOf("prism: {"));
  const navbarLabels = [...navbarSrc.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]);
  const footerLabels = [...footerSrc.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]);
  const footerTitles = [...footerSrc.matchAll(/title:\s*"([^"]+)"/g)].map((m) => m[1]);

  it("config navbar/footer sections yield labels and titles", () => {
    expect(navbarLabels.length).toBeGreaterThan(0);
    expect(footerLabels.length).toBeGreaterThan(0);
    expect(footerTitles.length).toBeGreaterThan(0);
  });

  it("every navbar label has a zh key", () => {
    const missing = navbarLabels.filter((l) => !(`item.label.${l}` in navbar));
    expect(missing, `missing navbar i18n keys: ${missing.join(", ")}`).toEqual([]);
  });

  it("every footer label has a zh key", () => {
    const missing = footerLabels.filter((l) => !(`link.item.label.${l}` in footer));
    expect(missing, `missing footer label keys: ${missing.join(", ")}`).toEqual([]);
  });

  it("every footer title has a zh key", () => {
    const missing = footerTitles.filter((t) => !(`link.title.${t}` in footer));
    expect(missing, `missing footer title keys: ${missing.join(", ")}`).toEqual([]);
  });

  it("footer.json has no stale link.item.label keys", () => {
    const known = new Set(footerLabels);
    const stale = Object.keys(footer)
      .filter((k) => k.startsWith("link.item.label."))
      .map((k) => k.slice("link.item.label.".length))
      .filter((l) => !known.has(l))
      .sort();
    expect(stale, `stale footer i18n keys: ${stale.join(", ")}`).toEqual([]);
  });

  it("navbar.json has no stale item.label keys", () => {
    const known = new Set(navbarLabels);
    const stale = Object.keys(navbar)
      .filter((k) => k.startsWith("item.label."))
      .map((k) => k.slice("item.label.".length))
      .filter((l) => !known.has(l))
      .sort();
    expect(stale, `stale navbar i18n keys: ${stale.join(", ")}`).toEqual([]);
  });
});
