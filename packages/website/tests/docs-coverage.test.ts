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
// 13. sidebar 里每个 doc id（字符串项）的 en 文件与 zh 镜像都必须存在（规则 9 的通用化；
//     硬编码 performance/hof-relations 哨兵保留，本规则是其超集）。
// 14. 手写文档页（排除生成物 releases*/versioning/api）zh 与 en 结构新鲜：``` 围栏行数一致，
//     围栏外 http(s) 外链 URL 集合一致（zh 漏译段落/陈旧外链会被抓住；allowlist 见注释）。
// 15. en 文档禁止站内绝对链接（](/docs/… / ](/blog/… 形态；https:// 外链不管）——统一相对 .md 路径。
// 16. guides/examples.md 的派生表（目录集合 + Expected exit）必须与 docs/examples/README.md
//     的命令矩阵一致（矩阵才是 verify:examples 的真值）。
// 17. 仓库 docs/design/*.md 每篇都必须在 design/notes.md 索引页被登记（且链接指向真实文件）。
// 18. static/llms.txt 的索引段条目必须是 `- [Title](url): summary`，Title 与页面 H1 一致 —— 裸 URL
//     只能告诉 agent「有哪些页」，不能告诉它「该读哪页」。
// 19. 诊断术语表的反向对账：文档里的每个 `nudo:*` 码必须真的可发射（详见文件末尾规则 19 段）。
// 20. `nudo:fork-truncated` 的严重度在文档面处处 = info（详见文件末尾规则 20 段）。
// 21. zh 镜像的**机器面**与 en 一致：输出块（```text / ```json）形状、CLI 机器输出行
//     （诊断计数 / 诊断头 / case 见证）、标识符类关键行（配置键 / 诊断码 / 字面量 / 路径）。
//     规则 14 只比围栏行数与外链集合 ⇒ zh 抄旧 CLI 输出全程静默；这里补上那道闸。
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { DIAG } from "@nudojs/core/internal";

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

// en 页允许残留 CJK 的白名单，数组便于后续扩充。
const EN_CJK_ALLOWLIST = [
  "releases-history.md",
  // releases.md（docs:gen 从 changeset 聚合生成）：changeset 引用的中文
  // 术语（如 "any ≤ 任意目标"）随生成进入 en 页，与 history 页同类。
  "releases.md",
  // api/* 生成页（gen-api-docs.mjs）：en 表 Summary 回退显示源 JSDoc 的中文首句——
  // 比空 `—` 有信息量，zh 镜像本就显示同一摘要。仅收录实际含 CJK 的页。
  "api/core.md",
  "api/harvester.md",
  "api/lsp.md",
  "api/parser.md",
  "api/service.md",
];
// harvest 只在 env-harvest / harvester 参考页与发布史叙述中出现。
const HARVEST_ALLOWLIST = [
  /^releases[\w-]*\.md$/, // releases.md / releases-history.md
  /^guides\/env-harvest\.md$/,
  /^api\/harvester\.md$/,
];
const HARVEST_VERB_RE = /nudo(\s+--)?\s+harvest\b|Primary verbs:[^\n]*\bharvest\b/;
// ```js / ```javascript 开启行：语言后只允许这几种 meta（或无 meta）。
// `verify#<slug>` / `verify-sidecar#<slug>` 是「同页多场景」围栏（scripts/verify-doc-examples.sh
// 的 verify_scenario：每个 slug 单独成文件、单独跑），slug 限小写字母/数字/连字符。
const FENCE_OPEN_RE = /^```(?:js|javascript)(?![\w-])[ \t]*(.*)$/;
const FENCE_META_OK =
  /^(?:verify(?:-sidecar)?(?:#[a-z0-9-]+)?|noplayground)?$/;
// 相对 markdown 链接目标（](./x) / ](../x)）：必须以 .md 结尾（#anchor 允许）。
const REL_LINK_RE = /\]\((\.{1,2}\/[^)\s]*)\)/g;
// sidebar 文档 id（字符串项）形态：小写字母/数字/连字符/斜杠；label/type/description 等
// 键值与 import 说明符（@scope、大写、空格）都不匹配，天然被排除。
const SIDEBAR_ID_RE = /^[a-z0-9][a-z0-9/-]*$/;
// 字符串字面量若紧跟这些键（窗口末尾），是元数据值不是 doc id。
const SIDEBAR_META_KEY_RE = /\b(?:type|label|description|title)\s*:\s*$/;
// 规则 14 排除生成物：releases/releases-history 由脚本聚合，versioning 由 changesets 生成，
// api/ 目录整目录生成 —— 它们的 zh 镜像不承诺结构同步。
const ZH_STRUCT_EXCLUDE = [
  /^releases\.md$/,
  /^releases-history\.md$/,
  /^guides\/versioning\.md$/,
  /^api\//,
];
// 规则 14 allowlist：zh 缺块/多链的显式豁免（须带理由）。
const ZH_STRUCT_ALLOWLIST: Record<string, Array<"fences" | "urls">> = {
  // 2026-09 补齐后清空：zh 缺块/多链均已修复（migrating-js、agents、migrating-from-typescript、cli）。
};
// ---------------------------------------------------------------------------
// 规则 21：zh 镜像的**机器面**必须与 en 一致（输出块 + 关键行）。
// 规则 14 只比「围栏行数」与「外链集合」：zh 把 CLI 输出块抄旧了也照样绿灯 ——
// 诊断计数少一档、漏抄 `[INFO L1/L5]` 行、case 见证值停在旧版，CI 全程看不见。
// 这里把几类**语言无关**的面钉住（散文仍由人翻译，不在此列）：
//   blocks  —— 输出块（```text / ```json 等）的块数与每块行数
//   machine —— CLI 机器输出行（摘要计数 / 诊断头 / case 行 / debug 见证 / 通过标记）
//   tokens  —— 标识符类 inline code span（诊断码 / 环境变量 / 点分配置键 / 引号字面量 / 路径）
//   rows    —— 表格行内的标识符类 inline code span（逐行对齐，行序即语义）
//   paras   —— 散文段落内的标识符类 inline code span（逐段对齐，段落序即语义）
// ---------------------------------------------------------------------------
// 规则 21 allowlist：已知且已复核的 zh/en 机器面差异（须带理由）。
// 2026-10 逐条复核后：17 条 waiver 里 15 条判为**真实漏译**并已补齐（条目已删），
// 余下 2 条为 zh 合法多于 en 的中文补充（散文段落数天然不等 ⇒ 逐段对齐不适用）。
const ZH_MIRROR_ALLOWLIST: Record<string, Array<"blocks" | "machine" | "tokens" | "rows" | "paras">> = {
  // cli.md 的 `nudo export` 段：zh 多两段 en 没有的中文补充（`--dialect` 当前取值范围
  // 与「export 是一次性出货命令、不接受 `--watch`」），两段内容已对着源码核对为真
  // （packages/nudojs/src/export-format.ts：SCHEMA_DIALECTS 仅 ["zod"]；
  // packages/nudojs/src/commands/export.ts：只有 --format / --dialect / --out）
  // ⇒ en 28 段 / zh 30 段，逐段索引对齐对本页不适用。
  "guides/cli.md": ["paras"],
  // error-faces.md 的开头：zh 多一段中文专有的「深读」指引（指向仓库内中文设计笔记
  // docs/errors-vs-typescript.md，并说明它已同时是站点页面），en 无对应段落 ⇒
  // en 9 段 / zh 10 段，逐段索引对齐对本页不适用。
  "guides/error-faces.md": ["paras"],
};
// 输出块围栏的语言标签（CLI 输出一律落在这里）。
const OUTPUT_FENCE_LANGS = new Set(["text", "json", "console", "output", "txt"]);
// CLI 机器输出行：语言无关、可逐字比对的输出形态。
const MACHINE_LINE_RES = [
  /^\s*\d+ error · \d+ warning · \d+ info · \d+ fn\b/, // 摘要计数（check 的 N error · … · M fn）
  /^\s*\[(ERROR|WARNING|INFO)\b/, // 诊断头（[ERROR L12 name] …）
  /^\s*(call@|entry@)\S*\s/, // case 行（call@L14  ([1]) => true）
  /^\s*debug "/, // debug 见证行
  /^\s*[✓✗]\s/, // 通过 / 失败标记
];
// 标识符类 inline code span：诊断码 / 环境变量 / 旗标与单词型字面量 / 点分配置键 /
// 引号字面量 / 路径 / 文件名。散文型 inline code（带空格的长句）不算。
const IDENT_SPAN_RES = [
  /^nudo[:-][\w:-]+$/, // 诊断码：nudo:constraint-violated
  /^NUDO_[A-Z0-9_]+$/, // 环境变量：NUDO_MAX_FORKS
  /^--?[a-z][\w-]*$/, // 旗标 / 单词型字面量：--json / true / false / strict
  /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/, // 点分配置键：analysis.include
  /^"[^"]*"$/, // 双引号字面量：""
  /^'[^']*'$/, // 单引号字面量：'es'
  /^[\w@./-]+\/[\w./*@-]*$/, // 路径：./ 或 src/**
  /^[\w$.-]+\.(js|ts|mjs|cjs|json|tsx|md)$/, // 文件名：sidecar.mjs
];
// 规则 15 allowlist：/blog/ 跨插件链接 Docusaurus 不解析相对 .md，绝对路径是正确形态（baseUrl 自动前缀）。
const ABS_LINK_ALLOWLIST = [
  "guides/callsite-discovery.md", // ](/blog/attribution-gate)
];
// 站内绝对链接目标：](/docs/… 或 ](/blog/…（https:// 外链不受此规则约束）。
const ABS_LINK_RE = /\]\((\/(?:docs|blog)\/[^)\s]*)\)/g;

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

// 双源（P3-7 诊断码注册表落地后不得丢强制力）：
//   1. 注册表值 —— @nudojs/core 的 DIAG 是生产面 `nudo:*` 诊断码的唯一真理源
//      （生产 src 的 code 赋值/查找表/相等比较已改用 DIAG.*，字面量扫描面收缩）；
//   2. src 残留字面量扫描 —— 兜住注册表外的 `code: "nudo:*"` 字面量
//      （新码漏进注册表直接写字面量时仍被强制）。
function emittedCodes(): Set<string> {
  const codes = new Set<string>(Object.values(DIAG));
  for (const f of srcFiles()) {
    for (const m of readFileSync(f, "utf8").matchAll(/code:\s*"(nudo:[\w-]+)"/g)) {
      codes.add(m[1]);
    }
  }
  return codes;
}

const anchorOf = (code: string): string => `{#${code.replaceAll(":", "-")}}`;

// sidebars.ts 中的文档 id 集合（字符串项）：剥注释后取所有字符串字面量，
// 排除 type:/label:/description:/title: 键值与不匹配 id 形态的说明符（import 路径等）。
function sidebarDocIds(): string[] {
  const src = readFileSync(join(repoRoot, "packages/website/sidebars.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/[^\n]*/gm, "");
  const ids: string[] = [];
  for (const m of src.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    const before = src.slice(Math.max(0, (m.index ?? 0) - 40), m.index);
    if (SIDEBAR_META_KEY_RE.test(before)) continue;
    if (SIDEBAR_ID_RE.test(m[1])) ids.push(m[1]);
  }
  return ids;
}

// ``` 开头行计数（stripFences 之前）：en/zh 相等 ⟺ 代码块数量同构（漏译整段会被抓住）。
function fenceLineCount(src: string): number {
  return src.split("\n").filter((l) => /^\s*```/.test(l)).length;
}

// 围栏外 http(s) 外链 URL 集合：句读尾巴（含 CJK 句读/右括号引号）不算 URL 的一部分。
function externalUrls(src: string): Set<string> {
  return new Set(
    [...stripFences(src).matchAll(/https?:\/\/[^\s)\]"'<”）』》]+/g)].map((m) =>
      m[0].replace(/[.,;:!?，。；：！？]+$/, ""),
    ),
  );
}

// 输出块（```text / ```json …）：每个块的行数组（不含围栏线本身）。
function outputBlocks(src: string): string[][] {
  const blocks: string[][] = [];
  let body: string[] | null = null;
  let lang = "";
  for (const line of src.split("\n")) {
    const open = /^```(\w*)/.exec(line);
    if (body === null) {
      if (open) {
        lang = open[1];
        body = [];
      }
      continue;
    }
    if (/^```/.test(line)) {
      if (OUTPUT_FENCE_LANGS.has(lang)) blocks.push(body);
      body = null;
      lang = "";
      continue;
    }
    body.push(line);
  }
  return blocks;
}

// CLI 机器输出行（摘要计数 / 诊断头 / case 行 / debug 见证 / 通过标记）。
function machineLines(blocks: string[][]): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    for (const line of block) {
      if (MACHINE_LINE_RES.some((re) => re.test(line))) out.push(line.trim());
    }
  }
  return out.sort();
}

// 标识符类 inline code span（围栏外）。
function identSpans(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of stripFences(src).matchAll(/`([^`\n]+)`/g)) {
    if (IDENT_SPAN_RES.some((re) => re.test(m[1]))) out.add(m[1]);
  }
  return out;
}

// 表格行内的标识符类 inline code span（逐行，顺序即语义）。
function tableRowIdentSpans(src: string): string[][] {
  const rows: string[][] = [];
  let inFence = false;
  for (const line of src.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !/^\s*\|/.test(line)) continue;
    rows.push(
      [...line.matchAll(/`([^`\n]+)`/g)]
        .map((m) => m[1])
        .filter((s) => IDENT_SPAN_RES.some((re) => re.test(s))),
    );
  }
  return rows;
}

// 散文段落（连续散文行；标题 / 表格行 / 列表项 / 围栏内容不算段落）。
// en 与 zh 的段落按序一一对应 ⇒ 段落内的标识符类 token 可逐段比对。
function proseParagraphs(src: string): string[] {
  const paras: string[] = [];
  let inFence = false;
  let buf: string[] = [];
  const flush = (): void => {
    if (buf.length) {
      paras.push(buf.join("\n"));
      buf = [];
    }
  };
  for (const line of src.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      flush();
      continue;
    }
    const t = line.trim();
    const isProse =
      !inFence &&
      t !== "" &&
      !/^#{1,6}\s/.test(t) &&
      !/^\|/.test(t) &&
      !/^[-*]\s/.test(t) &&
      !/^\d+\.\s/.test(t);
    if (isProse) buf.push(line);
    else flush();
  }
  flush();
  return paras;
}

// 一段散文内的标识符类 inline code span。
function paragraphIdentSpans(para: string): string[] {
  return [...para.matchAll(/`([^`\n]+)`/g)]
    .map((m) => m[1])
    .filter((s) => IDENT_SPAN_RES.some((re) => re.test(s)));
}

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
    expect(sidebars).toContain("Migrate from TypeScript");
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
          if (meta !== undefined && !FENCE_META_OK.test(meta)) {
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

describe("sidebar ↔ doc files pairing (rule 13)", () => {
  it("extracts doc ids, not labels/types/import specifiers", () => {
    const ids = sidebarDocIds();
    // 提取器健全性：既不漏（顶层入口在），也不误收（type 值 / import 说明符不在）。
    expect(ids).toContain("intro");
    expect(ids).toContain("guides/check");
    expect(ids).not.toContain("generated-index");
    expect(ids).not.toContain("@docusaurus/plugin-content-docs");
  });

  it("every sidebar doc id has both an en file and a zh mirror on disk", () => {
    const missing: string[] = [];
    for (const id of sidebarDocIds()) {
      for (const [label, root] of [["en", EN_DOCS], ["zh", ZH_DOCS]] as const) {
        if (!existsSync(join(root, `${id}.md`))) missing.push(`${label}/${id}.md`);
      }
    }
    expect(
      missing,
      `sidebar ids without page files (new page? land en + zh + sidebar together): ${missing.join(", ")}`,
    ).toEqual([]);
  });
});

// 手写页 = en 文档树排除生成物（releases*/versioning/api 整目录）。
// 规则 14（结构新鲜度）与规则 21（机器面一致）共用这一份范围。
const HANDWRITTEN_PAGES = walk(EN_DOCS)
  .filter((f) => f.endsWith(".md"))
  .map((f) => relative(EN_DOCS, f))
  .filter((rel) => !ZH_STRUCT_EXCLUDE.some((re) => re.test(rel)))
  .sort();

describe("zh structural freshness (rule 14)", () => {
  const handwritten = HANDWRITTEN_PAGES;

  it("exclusion list trims only the generated pages", () => {
    // 排除过宽会把整个门禁架空：抽查手写页必须仍在、生成页必须已排除。
    for (const kept of ["intro.md", "glossary.md", "guides/check.md"]) {
      expect(handwritten, `${kept} must stay in scope`).toContain(kept);
    }
    for (const dropped of ["releases.md", "releases-history.md", "guides/versioning.md", "api/core.md"]) {
      expect(handwritten, `${dropped} must be excluded`).not.toContain(dropped);
    }
  });

  it("fence line counts match between en and zh (allowlisted drift aside)", () => {
    const bad: string[] = [];
    for (const rel of handwritten) {
      if (ZH_STRUCT_ALLOWLIST[rel]?.includes("fences")) continue;
      const en = fenceLineCount(readFileSync(join(EN_DOCS, rel), "utf8"));
      const zh = fenceLineCount(readFileSync(join(ZH_DOCS, rel), "utf8"));
      if (en !== zh) bad.push(`${rel}: en=${en} zh=${zh}`);
    }
    expect(
      bad,
      `fence drift, zh missing translated blocks? (fix zh or extend ZH_STRUCT_ALLOWLIST with justification): ${bad.join(", ")}`,
    ).toEqual([]);
  });

  it("external http(s) URL sets match between en and zh (allowlisted drift aside)", () => {
    const bad: string[] = [];
    for (const rel of handwritten) {
      if (ZH_STRUCT_ALLOWLIST[rel]?.includes("urls")) continue;
      const en = externalUrls(readFileSync(join(EN_DOCS, rel), "utf8"));
      const zh = externalUrls(readFileSync(join(ZH_DOCS, rel), "utf8"));
      const onlyEn = [...en].filter((u) => !zh.has(u));
      const onlyZh = [...zh].filter((u) => !en.has(u));
      if (onlyEn.length || onlyZh.length) {
        bad.push(`${rel}: only-en [${onlyEn.join(" ")}] only-zh [${onlyZh.join(" ")}]`);
      }
    }
    expect(
      bad,
      `external URL drift, stale zh mirror? (fix zh or extend ZH_STRUCT_ALLOWLIST with justification): ${bad.join("; ")}`,
    ).toEqual([]);
  });
});

// 规则 21：zh 镜像的机器面（输出块 + 关键行）必须与 en 一致。
// 规则 14 只比围栏行数与外链集合 ⇒ zh 把 CLI 输出抄旧了（诊断计数少一档、
// 漏抄 `[INFO L1/L5]` 行、case 见证值停在旧版）全程静默、CI 绿灯。
// 这里把语言无关的三类面钉住：输出块形状、CLI 机器输出行、标识符类关键行。
describe("zh mirror machine-surface parity (rule 21)", () => {
  const waived = (
    rel: string,
    rule: "blocks" | "machine" | "tokens" | "rows" | "paras",
  ): boolean => ZH_MIRROR_ALLOWLIST[rel]?.includes(rule) ?? false;

  it("output blocks have the same shape in en and zh", () => {
    const bad: string[] = [];
    for (const rel of HANDWRITTEN_PAGES) {
      if (waived(rel, "blocks")) continue;
      const en = outputBlocks(readFileSync(join(EN_DOCS, rel), "utf8"));
      const zh = outputBlocks(readFileSync(join(ZH_DOCS, rel), "utf8"));
      if (en.length !== zh.length) {
        bad.push(`${rel}: output blocks en=${en.length} zh=${zh.length}`);
        continue;
      }
      for (let i = 0; i < en.length; i++) {
        if (en[i].length !== zh[i].length) {
          bad.push(`${rel}: output block #${i} lines en=${en[i].length} zh=${zh[i].length}`);
        }
      }
    }
    expect(
      bad,
      `zh output blocks drift (stale CLI transcript in the zh mirror? re-copy from a real run, or extend ZH_MIRROR_ALLOWLIST with justification): ${bad.join("; ")}`,
    ).toEqual([]);
  });

  it("CLI output lines are identical between en and zh", () => {
    const bad: string[] = [];
    for (const rel of HANDWRITTEN_PAGES) {
      if (waived(rel, "machine")) continue;
      const en = machineLines(outputBlocks(readFileSync(join(EN_DOCS, rel), "utf8")));
      const zh = machineLines(outputBlocks(readFileSync(join(ZH_DOCS, rel), "utf8")));
      const onlyEn = en.filter((l) => !zh.includes(l));
      const onlyZh = zh.filter((l) => !en.includes(l));
      if (onlyEn.length || onlyZh.length) {
        bad.push(
          `${rel}: only-en [${onlyEn.join(" | ")}] only-zh [${onlyZh.join(" | ")}]`,
        );
      }
    }
    expect(
      bad,
      `zh CLI output lines drift (counts / diagnostic headers / case witnesses must match the en transcript verbatim): ${bad.join("; ")}`,
    ).toEqual([]);
  });

  it("identifier tokens of the en page are mirrored in zh", () => {
    const bad: string[] = [];
    for (const rel of HANDWRITTEN_PAGES) {
      if (waived(rel, "tokens")) continue;
      const en = identSpans(readFileSync(join(EN_DOCS, rel), "utf8"));
      const zh = identSpans(readFileSync(join(ZH_DOCS, rel), "utf8"));
      const onlyEn = [...en].filter((t) => !zh.has(t)).sort();
      if (onlyEn.length) bad.push(`${rel}: missing in zh [${onlyEn.join(" ")}]`);
    }
    expect(
      bad,
      `zh mirror lost product identifiers (config keys / diagnostic codes / literals / paths — the zh page must carry them): ${bad.join("; ")}`,
    ).toEqual([]);
  });

  it("table rows carry the same identifier tokens in en and zh", () => {
    const bad: string[] = [];
    for (const rel of HANDWRITTEN_PAGES) {
      if (waived(rel, "rows")) continue;
      const en = tableRowIdentSpans(readFileSync(join(EN_DOCS, rel), "utf8"));
      const zh = tableRowIdentSpans(readFileSync(join(ZH_DOCS, rel), "utf8"));
      if (en.length !== zh.length) {
        bad.push(`${rel}: table rows en=${en.length} zh=${zh.length}`);
        continue;
      }
      for (let i = 0; i < en.length; i++) {
        const onlyEn = en[i].filter((t) => !zh[i].includes(t));
        if (onlyEn.length) bad.push(`${rel} row#${i}: missing in zh [${onlyEn.join(" ")}]`);
      }
    }
    expect(
      bad,
      `zh table rows dropped product identifiers (a translated cell must keep the same config keys / literals as its en row): ${bad.join("; ")}`,
    ).toEqual([]);
  });

  it("prose paragraphs keep the same identifier tokens in en and zh", () => {
    const bad: string[] = [];
    for (const rel of HANDWRITTEN_PAGES) {
      if (waived(rel, "paras")) continue;
      const en = proseParagraphs(readFileSync(join(EN_DOCS, rel), "utf8"));
      const zh = proseParagraphs(readFileSync(join(ZH_DOCS, rel), "utf8"));
      if (en.length !== zh.length) {
        bad.push(`${rel}: prose paragraphs en=${en.length} zh=${zh.length}`);
        continue;
      }
      for (let i = 0; i < en.length; i++) {
        const zhTokens = new Set(paragraphIdentSpans(zh[i]));
        const onlyEn = paragraphIdentSpans(en[i]).filter((t) => !zhTokens.has(t));
        if (onlyEn.length) {
          bad.push(`${rel} para#${i}: missing in zh [${onlyEn.join(" ")}]`);
        }
      }
    }
    expect(
      bad,
      `zh prose paragraphs lost product identifiers (a translated paragraph must keep the same config keys / literals / paths as its en paragraph): ${bad.join("; ")}`,
    ).toEqual([]);
  });
});

describe("absolute in-site link gates (rule 15)", () => {
  it("en docs never link /docs/ or /blog/ absolute paths (allowlist aside, fences excluded)", () => {
    const bad: string[] = [];
    for (const f of walk(EN_DOCS)) {
      if (!f.endsWith(".md")) continue;
      const rel = relative(EN_DOCS, f);
      if (ABS_LINK_ALLOWLIST.includes(rel)) continue;
      const src = stripFences(readFileSync(f, "utf8"));
      for (const m of src.matchAll(ABS_LINK_RE)) {
        bad.push(`${rel}: ${m[1]}`);
      }
    }
    expect(
      bad,
      `absolute in-site links (rewrite as relative .md paths, or extend ABS_LINK_ALLOWLIST with justification): ${bad.join(", ")}`,
    ).toEqual([]);
  });
});

describe("design notes index covers docs/design (rule 17)", () => {
  // 站内只暴露 design-doc（叙述页）与 design/notes（索引）。仓库 docs/design/*.md
  // 是架构真源：新增一篇而不在索引页登记 = 读者永远找不到它。
  const designDir = join(repoRoot, "docs/design");
  const indexPage = readFileSync(join(EN_DOCS, "design/notes.md"), "utf8");

  const designFiles = readdirSync(designDir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  it("the repository actually has the expected design notes", () => {
    expect(designFiles.length).toBeGreaterThan(5);
    expect(designFiles).toContain("kernel-merge.md");
    expect(designFiles).toContain("cli-semantics.md");
  });

  it("every docs/design note is listed in design/notes.md", () => {
    const missing = designFiles.filter((f) => !indexPage.includes(`design/${f}`));
    expect(
      missing,
      `design notes missing from the index page (add a row in docs/design/notes.md): ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("links to design files resolve on disk", () => {
    const stale: string[] = [];
    for (const m of indexPage.matchAll(
      /https:\/\/github\.com\/nudojs\/nudo\/blob\/main\/docs\/design\/([a-z0-9-]+\.md)/g,
    )) {
      if (!existsSync(join(designDir, m[1]))) stale.push(m[1]);
    }
    expect(stale, `design/notes.md links a missing file: ${stale.join(", ")}`).toEqual([]);
  });
});

describe("llms.txt index entries carry title + summary (rule 18)", () => {
  // 索引段（`## Docs (HTML)` 与 `## Blog (short slugs)`）的每个条目必须是
  // `- [Title](url): summary`：裸 URL 只能告诉 agent「有哪些页」，不能告诉它
  // 「该读哪页」。Title 必须等于页面 H1（blog 取 frontmatter title），summary 非空。
  const llms = readFileSync(LLMS_TXT, "utf8");
  const section = (start: string, end: string): string => {
    const i = llms.indexOf(start);
    const j = llms.indexOf(end, i);
    return llms.slice(i + start.length, j);
  };
  const docsIndex = section("## Docs (HTML)", "## Blog (short slugs)");
  const blogIndex = section("## Blog (short slugs)", "## Per-page markdown");
  const ENTRY_RE = /^-\s+\[(.+?)\]\((https:\/\/nudojs\.github\.io\/nudo\/[^)]+)\):\s*(.+)$/;

  const h1Of = (file: string): string | null => {
    const m = /^#\s+(.+)$/m.exec(readFileSync(file, "utf8"));
    return m ? m[1].trim() : null;
  };
  // route → en 文件路径（frontmatter slug 优先）
  const docFileByRoute = new Map<string, string>();
  for (const f of walk(EN_DOCS).filter((f) => f.endsWith(".md"))) {
    const route = (frontmatterSlug(readFileSync(f, "utf8")) ??
      relative(EN_DOCS, f).replace(/\.md$/, "")).replace(/^\//, "");
    docFileByRoute.set(route, f);
  }

  it("every docs index line is a titled, summarized entry", () => {
    const bad: string[] = [];
    for (const line of docsIndex.split("\n").filter((l) => l.trim().startsWith("- "))) {
      const m = ENTRY_RE.exec(line);
      if (!m) {
        bad.push(`bare entry (add title + summary): ${line.trim()}`);
        continue;
      }
      const route = m[2].slice("https://nudojs.github.io/nudo/docs/".length);
      const file = docFileByRoute.get(route);
      if (!file) bad.push(`${route}: entry has no page on disk`);
      else {
        const h1 = h1Of(file);
        if (h1 !== m[1]) bad.push(`${route}: title "${m[1]}" ≠ H1 "${h1}"`);
      }
      if (!m[3].trim()) bad.push(`${route}: empty summary`);
    }
    expect(bad, `llms.txt docs index malformed: ${bad.join("; ")}`).toEqual([]);
  });

  it("every blog index line is a titled, summarized entry", () => {
    const bad: string[] = [];
    for (const line of blogIndex.split("\n").filter((l) => l.trim().startsWith("- "))) {
      const m = ENTRY_RE.exec(line);
      if (!m) {
        bad.push(`bare entry (add title + summary): ${line.trim()}`);
        continue;
      }
      const slug = m[2].slice("https://nudojs.github.io/nudo/blog/".length);
      const file = readdirSync(EN_BLOG).find((n) => {
        const s = frontmatterSlug(readFileSync(join(EN_BLOG, n), "utf8"));
        return s !== null && s.replace(/^\//, "") === slug;
      });
      if (!file) bad.push(`${slug}: entry has no blog post with that slug`);
      if (!m[3].trim()) bad.push(`${slug}: empty summary`);
    }
    expect(bad, `llms.txt blog index malformed: ${bad.join("; ")}`).toEqual([]);
  });

  it("entries stay single-line (a wrapped summary breaks plain-text consumers)", () => {
    const wrapped = [...docsIndex.split("\n"), ...blogIndex.split("\n")].filter((l) => {
      const t = l.trim();
      return t.length > 0 && !t.startsWith("- ") && !t.startsWith("#") && !t.startsWith("Base:");
    });
    expect(wrapped, `wrapped llms.txt lines: ${wrapped.join(" | ")}`).toEqual([]);
  });
});

describe("examples guide table ↔ docs/examples matrix (rule 16)", () => {
  // guides/examples.md 的「Topic directory / Expected exit」表是从
  // docs/examples/README.md（verify:examples 的真值矩阵）派生出来的摘要。
  // 派生表最容易静默过期：目录集合、以及每条「Expected exit」声称的退出码，
  // 都必须与 README 矩阵里该目录命令行的退出码一致。
  const readme = readFileSync(join(repoRoot, "docs/examples/README.md"), "utf8");
  const guide = readFileSync(join(EN_DOCS, "guides/examples.md"), "utf8");

  // README 场景表：`| [`constraints/`](./constraints/) | …`
  const readmeDirs = [
    ...readme.matchAll(/^\|\s*\[`([^`]+)`\]\(\.\/([^)]*)\)/gm),
  ].map((m) => m[1]);

  // README 命令矩阵：`| `pnpm run check docs/examples/x/y.js` | **1** | …`
  const matrixRows = [...readme.matchAll(/^\|\s*`([^`]+)`\s*\|\s*\*?\*?(\d)\*?\*?\s*\|/gm)];
  const exitsByDir = new Map<string, Set<string>>();
  for (const [, cmd, exit] of matrixRows) {
    const m = /docs\/examples\/([a-z-]+)\//.exec(cmd);
    if (!m) continue; // root-level fixtures (l2-export-any.js) are not topic dirs
    const set = exitsByDir.get(m[1]) ?? new Set<string>();
    set.add(exit);
    exitsByDir.set(m[1], set);
  }

  // 网站派生表：`| [`constraints/`](https://github.com/…/docs/examples/constraints) | … | `1` … |`
  const webRows = [
    ...guide.matchAll(
      /^\|\s*\[`([^`]+)`\]\(https:\/\/github\.com\/nudojs\/nudo\/tree\/main\/docs\/examples\/([^)]*)\)(.*)$/gm,
    ),
  ];

  it("parsers see both tables (guard against a silently empty gate)", () => {
    expect(readmeDirs.length).toBeGreaterThan(5);
    expect(matrixRows.length).toBeGreaterThan(20);
    expect(webRows.length).toBeGreaterThan(5);
  });

  it("topic directory sets are identical", () => {
    const webDirs = webRows.map((r) => r[1]).sort();
    expect(webDirs, "guides/examples.md rows vs docs/examples/README.md dirs").toEqual(
      [...readmeDirs].sort(),
    );
  });

  it("every Expected-exit code on the guide is a real matrix exit for that directory", () => {
    const bad: string[] = [];
    for (const [, label, dir, rest] of webRows) {
      const claimed = new Set([...rest.matchAll(/`(\d)`/g)].map((m) => m[1]));
      const real = exitsByDir.get(dir) ?? new Set<string>();
      if (claimed.size === 0) {
        bad.push(`${label}: no exit code in the Expected exit cell`);
        continue;
      }
      for (const code of claimed) {
        if (!real.has(code)) {
          bad.push(`${label}: claims exit ${code}, matrix has [${[...real].sort().join(",")}]`);
        }
      }
    }
    expect(
      bad,
      `guides/examples.md exit claims drifted from docs/examples/README.md: ${bad.join("; ")}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 规则 19（族 32 / Bug 908）：诊断术语表的**反向**对账 —— 文档里的每个码必须可发射。
// 既有断言只做单向（「可发射 ⇒ 有文档锚点」），方向缺一半 ⇒ 只写文档、不写实现的码
// 会变成永久幻影（Bug 908 = `nudo:eval-error`：DIAG 注册表无此项、全仓无发射点）。
// ---------------------------------------------------------------------------

// 「可发射码」全集 = 既有 emittedCodes()（DIAG 注册表 ∪ src 里 `code: "nudo:…"` 字面量）
//   ∪ 补充扫描 `code: "nudo-…"`（**无冒号**形态的真实码 —— 例如 `nudo-unreachable`
//     真发射于 packages/service/src/analyzer-orchestrate-uncached-modules.ts，
//     但 emittedCodes() 的冒号字面量正则匹配不到它）。
// emittedCodes() 本身语义不动（既有断言依赖它）；这里只新增一个更宽的辅助函数。
function emittableCodes(): Set<string> {
  const codes = new Set(emittedCodes());
  for (const f of srcFiles()) {
    for (const m of readFileSync(f, "utf8").matchAll(/code:\s*"(nudo[-\w:]+)"/g)) {
      codes.add(m[1]);
    }
  }
  return codes;
}

describe("glossary headings ⇔ emittable codes (rule 19, reverse direction)", () => {
  const en = readFileSync(GLOSSARY_EN, "utf8");
  const zh = readFileSync(GLOSSARY_ZH, "utf8");

  it("every nudo:* heading in the glossaries is an emittable code (en + zh)", () => {
    const emittable = emittableCodes();
    const bad: string[] = [];
    for (const [label, src] of [["en", en], ["zh", zh]] as const) {
      // 标题正则沿用规则 3 的那条。
      for (const m of src.matchAll(/^### `(nudo[\w:-]+)`([^\n]*)$/gm)) {
        if (!emittable.has(m[1])) bad.push(`${label}: ${m[1]}`);
      }
    }
    expect(
      bad,
      `phantom diagnostic codes in the glossary (documented but never emitted — delete the entry or emit the code): ${bad.join(", ")}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 规则 20（族 32 / Bug 909）：`nudo:fork-truncated` 的严重度在文档面被手抄了 9 遍，
// 没有一致性校验 ⇒ 实现（core 写死 severity: "info"，仓库自带回归测试
// packages/core/src/algebra/__tests__/check-fork-truncated.test.ts 断言 info）
// 与文档之间会漂移。此处钉住：9 处严重度陈述必须全部 = info。
// ---------------------------------------------------------------------------

describe("nudo:fork-truncated severity is consistent across the doc surface (rule 20)", () => {
  // 9 处严重度陈述的落点（en/zh 各 4 处 + 仓库设计真源 1 处）。
  // releases-history.md 是 changelog 归档页（生成物，不承诺严重度口径），不入列。
  const SITES: Array<[string, string]> = [
    ["en reference/diagnostics.md", join(EN_DOCS, "reference/diagnostics.md")],
    ["zh reference/diagnostics.md", join(ZH_DOCS, "reference/diagnostics.md")],
    ["en guides/check.md", join(EN_DOCS, "guides/check.md")],
    ["zh guides/check.md", join(ZH_DOCS, "guides/check.md")],
    ["en guides/performance.md", join(EN_DOCS, "guides/performance.md")],
    ["zh guides/performance.md", join(ZH_DOCS, "guides/performance.md")],
    ["en reference/config.md", join(EN_DOCS, "reference/config.md")],
    ["zh reference/config.md", join(ZH_DOCS, "reference/config.md")],
    ["design docs/design/cli-semantics.md", join(repoRoot, "docs/design/cli-semantics.md")],
  ];

  // 一处「严重度陈述」可能落在两处形态上：术语表里写在词条正文（标题之后、
  // 下一个 `### ` 之前），其余页写在提到该码的那一行 ⇒ 两处都扫。
  const severityTokens = (path: string): { tokens: Set<string>; warnLines: number[] } => {
    const lines = readFileSync(path, "utf8").split("\n");
    const tokens = new Set<string>();
    const warnLines: number[] = [];
    const scan = (text: string, lineNo: number): void => {
      for (const m of text.matchAll(/\b(warning|info)\b/gi)) tokens.add(m[1].toLowerCase());
      if (/\bwarning\b/i.test(text)) warnLines.push(lineNo);
    };
    for (const [i, line] of lines.entries()) {
      if (line.includes("nudo:fork-truncated")) scan(line, i + 1);
    }
    const head = lines.findIndex((l) => /^###\s+`nudo:fork-truncated`/.test(l));
    if (head >= 0) {
      for (let j = head + 1; j < lines.length && !/^###\s/.test(lines[j]); j++) {
        scan(lines[j], j + 1);
      }
    }
    return { tokens, warnLines };
  };

  it("no doc statement about nudo:fork-truncated calls it a warning", () => {
    const bad: string[] = [];
    for (const [label, path] of SITES) {
      for (const n of severityTokens(path).warnLines) bad.push(`${label}:${n}`);
    }
    expect(
      bad,
      `nudo:fork-truncated is severity "info" in core (check.ts fork-truncation branch) — fix these doc statements: ${bad.join(", ")}`,
    ).toEqual([]);
  });

  it("every doc surface states info as the severity for nudo:fork-truncated", () => {
    const bad: string[] = [];
    for (const [label, path] of SITES) {
      const { tokens } = severityTokens(path);
      if (!tokens.has("info")) {
        bad.push(`${label}: severity = [${[...tokens].sort().join(", ") || "none"}] (expected info)`);
      }
    }
    expect(
      bad,
      `nudo:fork-truncated severity is not "info" on these doc surfaces: ${bad.join(", ")}`,
    ).toEqual([]);
  });
});
