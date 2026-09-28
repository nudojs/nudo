// 文档 ↔ 产品面的一致性门禁（docs-as-code）：
// 1. 源码里每个 `code: "nudo:*"` 诊断码都在诊断术语表（en + zh）有显式锚点
//    —— CLI 的「诊断 → 文档深链」依赖这条规则（anchor = code.replaceAll(":","-")）。
// 2. 术语表每个 nudo:* 标题都带显式 {#…} 锚点，且 id 符合上述规则。
// 3. zh 文档页集合 == en 文档页集合（页面级 i18n 对齐）。
// 4. sidebars.ts 的每个 category label 在 zh current.json 有翻译。
// 5. docusaurus.config.ts 的 navbar/footer label、footer title 都在 zh navbar.json / footer.json 有翻译；
//    footer.json 不得残留 config 里已不存在的 stale key。
// 6. en 文档（白名单除外）不得残留 CJK —— en 是源语言，zh 走 i18n 镜像。
// 7. harvest 不是产品动词：白名单外 en 页不得出现 `nudo harvest` 命令形态或 Primary verbs 列出 harvest。
// 8. js/javascript 围栏 meta 仅允许 空 / verify / verify-sidecar / noplayground（en + zh）。
// 9. 新页必须成对落地：sidebar 注册 + en/zh 文件同时存在（防孤儿引用）。
// 10. llms.txt ↔ en 文档树/博客双向同步（route 解析与 gen-llms.mjs 一致，.md 旁挂形式归一）。
// 11. 相对 markdown 链接（](./x) / ](../x)）必须带 .md 扩展名（en + zh；围栏内不扫描，允许 #anchor）。
// 12. en/zh 博客帖文件名集合一致。
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
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
const EN_BLOG = join(repoRoot, "packages/website/blog");
const ZH_BLOG = join(
  repoRoot,
  "packages/website/i18n/zh-Hans/docusaurus-plugin-content-blog",
);
const LLMS_TXT = join(repoRoot, "packages/website/static/llms.txt");

// en 页允许残留 CJK 的白名单（生成的历史聚合页），数组便于后续扩充。
const EN_CJK_ALLOWLIST = ["releases-history.md"];
// harvest 只在 env-harvest / harvester 参考页与发布史叙述中出现。
const HARVEST_ALLOWLIST = [
  /^releases[\w-]*\.md$/, // releases.md / releases-history.md
  /^guides\/env-harvest\.md$/,
  /^api\/harvester\.md$/,
];
const HARVEST_VERB_RE = /nudo(\s+--)?\s+harvest\b|Primary verbs:[^\n]*\bharvest\b/;
// ```js / ```javascript 开启行：语言后只允许这几种 meta（或无 meta）。
const FENCE_OPEN_RE = /^```(?:js|javascript)(?![\w-])[ \t]*(.*)$/;
const FENCE_META_OK = new Set(["", "verify", "verify-sidecar", "noplayground"]);
// 相对 markdown 链接目标（](./x) / ](../x)）：必须以 .md 结尾（#anchor 允许）。
const REL_LINK_RE = /\]\((\.{1,2}\/[^)\s]*)\)/g;

// 与 scripts/gen-llms.mjs 的 slugOf 一致：frontmatter `slug:` 优先，否则相对路径去 .md。
function frontmatterSlug(src: string): string | null {
  const m = /^---\n([\s\S]*?)\n---/.exec(src);
  if (!m) return null;
  const s = /^slug:\s*(.+)$/m.exec(m[1]);
  return s ? s[1].trim().replace(/['"]/g, "") : null;
}

// en 文档页路由集合（slug 去 leading /，否则相对路径去 .md）。
function docRoutes(root: string): Set<string> {
  return new Set(
    walk(root)
      .filter((f) => f.endsWith(".md"))
      .map((f) =>
        (
          frontmatterSlug(readFileSync(f, "utf8")) ??
          relative(root, f).replace(/\.md$/, "")
        ).replace(/^\//, ""),
      ),
  );
}

// 博客帖路由集合：frontmatter slug 优先，否则 YYYY/MM/DD/name（同 gen-llms.mjs）。
function blogRoutes(root: string): Set<string> {
  const routes = new Set<string>();
  for (const f of walk(root).filter((f) => f.endsWith(".md"))) {
    const m = /^(\d{4})-(\d{2})-(\d{2})-(.+)\.md$/.exec(basename(f));
    if (!m) continue;
    const slug = frontmatterSlug(readFileSync(f, "utf8"));
    routes.add(
      slug ? slug.replace(/^\//, "") : `${m[1]}/${m[2]}/${m[3]}/${m[4]}`,
    );
  }
  return routes;
}

// llms.txt 中所有 docs / blog URL 的路由集合（去 .md 旁挂后缀与 #anchor；zh-Hans 前缀不在此列）。
function llmsRoutes(): { docs: Set<string>; blog: Set<string> } {
  const docs = new Set<string>();
  const blog = new Set<string>();
  const src = readFileSync(LLMS_TXT, "utf8");
  for (const m of src.matchAll(
    /https:\/\/nudojs\.github\.io\/nudo\/(docs|blog)\/[^\s)\]]+/g,
  )) {
    const route = m[0]
      .slice(`https://nudojs.github.io/nudo/${m[1]}/`.length)
      .replace(/#.*$/, "")
      .replace(/\.md$/, "");
    (m[1] === "docs" ? docs : blog).add(route);
  }
  return { docs, blog };
}

// 去掉围栏代码块（``` 开闭行之间），围栏内的“链接”是示例文本不是导航。
function stripFences(src: string): string {
  const lines: string[] = [];
  let inFence = false;
  for (const line of src.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) lines.push(line);
  }
  return lines.join("\n");
}

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

  it("sidebars use live ids (type-values and releases-history retired)", () => {
    const sidebars = readFileSync(join(repoRoot, "packages/website/sidebars.ts"), "utf8");
    expect(sidebars).not.toContain("concepts/type-values");
    expect(sidebars).toContain("concepts/abs");
    // Coexistence is a migration tactic — must not be a top-level peer category label.
    expect(sidebars).not.toContain("Migrating & Coexistence");
    expect(sidebars).toContain("Migrate off TypeScript");
    // releases-history 离开 sidebar，但页面仍在 docs 根，入口由 releases.md 文内链接保留。
    expect(sidebars, "sidebar must not list releases-history").not.toContain("releases-history");
    expect(sidebars, "sidebar must keep releases").toContain('"releases"');
    const releases = readFileSync(join(EN_DOCS, "releases.md"), "utf8");
    expect(
      releases,
      "releases.md must link releases-history.md (in-page entry)",
    ).toMatch(/\]\(\.?\/?releases-history\.md/);
  });

  it("new pages guides/performance & concepts/hof-relations are wired with en+zh files", () => {
    const sidebars = readFileSync(join(repoRoot, "packages/website/sidebars.ts"), "utf8");
    const ids = ["guides/performance", "concepts/hof-relations"];
    const unwired = ids.filter((id) => !sidebars.includes(`"${id}"`));
    expect(unwired, `sidebar missing new page ids: ${unwired.join(", ")}`).toEqual([]);
    const missing: string[] = [];
    for (const id of ids) {
      for (const [label, root] of [["en", EN_DOCS], ["zh", ZH_DOCS]] as const) {
        if (!existsSync(join(root, `${id}.md`))) missing.push(`${label}/${id}.md`);
      }
    }
    expect(missing, `new page files missing: ${missing.join(", ")}`).toEqual([]);
  });

  it("docs pages do not link the retired type-values path", () => {
    // Historical changelog prose may mention TypeValue; live guidance must use abs.
    const roots = [EN_DOCS, ZH_DOCS];
    const bad: string[] = [];
    for (const root of roots) {
      for (const f of walk(root)) {
        if (!f.endsWith(".md")) continue;
        if (/[\\/]releases(-history)?\.md$/.test(f)) continue;
        const src = readFileSync(f, "utf8");
        if (/concepts\/type-values|type-values\.md/.test(src)) {
          bad.push(relative(root, f));
        }
      }
    }
    expect(bad, `stale type-values links in: ${bad.join(", ")}`).toEqual([]);
  });
});

describe("en docs language gates", () => {
  it("en pages contain no CJK (allowlist: releases-history.md)", () => {
    const bad: string[] = [];
    for (const f of walk(EN_DOCS)) {
      if (!f.endsWith(".md")) continue;
      const rel = relative(EN_DOCS, f);
      if (EN_CJK_ALLOWLIST.includes(rel)) continue;
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (/[\u4e00-\u9fff]/.test(line)) bad.push(`${rel}:${i + 1}`);
      });
    }
    expect(
      bad,
      `CJK in en docs (extend EN_CJK_ALLOWLIST only with justification): ${bad.join(", ")}`,
    ).toEqual([]);
  });

  it("harvest is never presented as a product verb outside its allowlist", () => {
    const bad: string[] = [];
    for (const f of walk(EN_DOCS)) {
      if (!f.endsWith(".md")) continue;
      const rel = relative(EN_DOCS, f);
      if (HARVEST_ALLOWLIST.some((re) => re.test(rel))) continue;
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (HARVEST_VERB_RE.test(line)) bad.push(`${rel}:${i + 1}`);
      });
    }
    expect(
      bad,
      `harvest shown as a CLI/product verb (harvest is not a product verb): ${bad.join(", ")}`,
    ).toEqual([]);
  });
});

describe("code fence meta gates", () => {
  it("js/javascript fence metas are limited to verify | verify-sidecar | noplayground (en + zh)", () => {
    const bad: string[] = [];
    for (const [label, root] of [["en", EN_DOCS], ["zh", ZH_DOCS]] as const) {
      for (const f of walk(root)) {
        if (!f.endsWith(".md")) continue;
        const rel = relative(root, f);
        readFileSync(f, "utf8").split("\n").forEach((line, i) => {
          const m = FENCE_OPEN_RE.exec(line);
          const meta = m?.[1].trim();
          if (meta !== undefined && !FENCE_META_OK.has(meta)) {
            bad.push(`${label}/${rel}:${i + 1} meta "${meta}"`);
          }
        });
      }
    }
    expect(bad, `illegal js/javascript fence meta: ${bad.join(", ")}`).toEqual([]);
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

describe("llms.txt ↔ docs tree sync", () => {
  const llms = llmsRoutes();

  it("every en docs route appears as a URL in static/llms.txt", () => {
    const missing = [...docRoutes(EN_DOCS)].filter((r) => !llms.docs.has(r)).sort();
    expect(
      missing,
      `llms.txt missing doc routes (hand-maintained index — add the URL line): ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("every blog slug appears as a URL in static/llms.txt", () => {
    const missing = [...blogRoutes(EN_BLOG)].filter((r) => !llms.blog.has(r)).sort();
    expect(
      missing,
      `llms.txt missing blog routes: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("every docs/blog URL in static/llms.txt maps to an existing page or post", () => {
    const docs = docRoutes(EN_DOCS);
    const blog = blogRoutes(EN_BLOG);
    const stale = [
      ...[...llms.docs].filter((r) => !docs.has(r)).map((r) => `docs/${r}`),
      ...[...llms.blog].filter((r) => !blog.has(r)).map((r) => `blog/${r}`),
    ].sort();
    expect(
      stale,
      `llms.txt lists routes with no page/post on disk (page removed? drop the URL line): ${stale.join(", ")}`,
    ).toEqual([]);
  });
});

describe("relative link hygiene", () => {
  it("relative markdown links keep the .md extension (en + zh, fences excluded)", () => {
    const bad: string[] = [];
    for (const [label, root] of [["en", EN_DOCS], ["zh", ZH_DOCS]] as const) {
      for (const f of walk(root)) {
        if (!f.endsWith(".md")) continue;
        const rel = relative(root, f);
        const src = stripFences(readFileSync(f, "utf8"));
        for (const m of src.matchAll(REL_LINK_RE)) {
          if (!/\.md(#.*)?$/.test(m[1])) bad.push(`${label}/${rel}: ${m[0]}`);
        }
      }
    }
    expect(
      bad,
      `extensionless relative links (append .md, keep anchors): ${bad.join(", ")}`,
    ).toEqual([]);
  });
});

describe("blog en/zh parity", () => {
  it("en and zh blog post file sets are identical", () => {
    const names = (dir: string) =>
      new Set(
        readdirSync(dir)
          .filter((n) => n.endsWith(".md"))
          .sort(),
      );
    const en = names(EN_BLOG);
    const zh = names(ZH_BLOG);
    const onlyEn = [...en].filter((n) => !zh.has(n)).sort();
    const onlyZh = [...zh].filter((n) => !en.has(n)).sort();
    expect(onlyEn, `zh blog missing posts: ${onlyEn.join(", ")}`).toEqual([]);
    expect(onlyZh, `en blog missing posts: ${onlyZh.join(", ")}`).toEqual([]);
  });
});
