/**
 * 内部碎片链接守卫（docs ↔ 锚点）。
 *
 * 历史缺口：EN+zh 文档里大量 `](#nudo--…)` 形式的内部锚点从未被任何测试校验
 * ——标题 slug 由 github-slugger 生成（`@nudo:env — Runtime Environment` ⇒
 * `nudoenv--runtime-environment`，不是 `nudo--runtime-environment`），链接早已
 * 断裂而 CI 全绿。本测试对每个 markdown 文件的 `](path#frag)` 逐条校验：
 * 目标文件存在 ⇒ 目标文件的标题 slug 集（含显式 `{#id}`）必须含该 frag。
 *
 * 口径与 docusaurus 一致：github-slugger 1.5.0（仓库锁定；`website` devDep）。
 * 显式 `{#id}` 优先（跨 locale 稳定锚——zh 标题的中文 slug 不跨 locale 可链）。
 * 仅校验**站内相对路径**；外部 URL / 纯页级链接不在此面。
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import GithubSlugger from "github-slugger";

const WEBSITE = resolve(import.meta.dirname, "..");
const DOC_ROOTS = [
  join(WEBSITE, "docs"),
  join(WEBSITE, "i18n/zh-Hans/docusaurus-plugin-content-docs/current"),
];

function walkMarkdown(root: string, out: string[] = []): string[] {
  if (!existsSync(root)) return out;
  for (const e of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, e.name);
    if (e.isDirectory()) walkMarkdown(p, out);
    else if (/\.mdx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** 目标文件的标题 slug 集：显式 `{#id}` 优先，否则按渲染文本走 github-slugger。 */
function slugsOf(file: string): Set<string> {
  const out = new Set<string>();
  const slugger = new GithubSlugger();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!m) continue;
    let text = m[2]!.trim();
    const explicit = /\{#([^}]+)\}\s*$/.exec(text);
    if (explicit) {
      out.add(explicit[1]!);
      text = text.replace(/\{#[^}]+\}\s*$/, "").trim();
    }
    // 与 docusaurus 的 slug 口径对齐：去行内代码 / 链接 / HTML / 强调
    text = text
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/[*_~]/g, "")
      .trim();
    out.add(slugger.slug(text));
  }
  return out;
}

describe("docs 内部碎片链接", () => {
  it("每个 `](path#frag)` 的 frag 都能在目标文件的标题 slug 集里解析", () => {
    const broken: string[] = [];
    let checked = 0;
    for (const file of DOC_ROOTS.flatMap((r) => walkMarkdown(r))) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/\]\(([^)\s]+)\)/g)) {
        const href = m[1]!;
        if (!href.includes("#") || href.startsWith("http") || href.startsWith("mailto:")) {
          continue;
        }
        const [pathPart, frag] = href.split("#");
        if (!frag) continue;
        const target =
          pathPart === "" || pathPart === undefined
            ? file
            : resolve(dirname(file), pathPart.split("?")[0]!);
        // 缺文件属另一类门禁（docs-coverage 管配对）；本测试只判「文件在、锚不在」
        if (!existsSync(target)) continue;
        checked++;
        if (!slugsOf(target).has(frag)) {
          broken.push(`${file.replace(WEBSITE + "/", "")} -> ${href}`);
        }
      }
    }
    // 语料不空转：现有文档至少上百条内部锚点
    expect(checked).toBeGreaterThan(200);
    expect(broken, `断裂的内部碎片链接：\n${broken.join("\n")}`).toEqual([]);
  });
});
