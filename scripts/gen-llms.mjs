#!/usr/bin/env node
// 构建后生成 agent 友好的原始 markdown 面（llms.txt 生态）：
//  - 每个文档页 / 博客帖在其路由下旁挂一份 `.md`（无 frontmatter，纯正文）
//  - 站点根输出 `llms-full.txt`（en 文档 + 博客全文拼接）
// 依赖 docs 构建产物目录（packages/website/build），由 docs-deploy 在 build 后调用。
//
// 运行：node scripts/gen-llms.mjs
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, relative, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const buildDir = join(root, "packages/website/build");

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function slugOf(path) {
  const src = readFileSync(path, "utf8");
  const m = /^---\n([\s\S]*?)\n---/.exec(src);
  if (!m) return null;
  const s = /^slug:\s*(.+)$/m.exec(m[1]);
  return s ? s[1].trim().replace(/['"]/g, "") : null;
}

const stripFrontmatter = (src) => src.replace(/^---\n[\s\S]*?\n---\n*/, "").trimEnd() + "\n";

const fullParts = [];
let mdCount = 0;

const docRoots = [
  { base: join(root, "packages/website/docs"), prefix: "/docs", inFull: true },
  {
    base: join(root, "packages/website/i18n/zh-Hans/docusaurus-plugin-content-docs/current"),
    prefix: "/zh-Hans/docs",
    inFull: false,
  },
];
for (const { base, prefix, inFull } of docRoots) {
  for (const f of walk(base).filter((f) => f.endsWith(".md"))) {
    const slug = slugOf(f);
    const route = `${prefix}/${slug ? slug.replace(/^\//, "") : relative(base, f).replace(/\.md$/, "")}`;
    const body = stripFrontmatter(readFileSync(f, "utf8"));
    const out = join(buildDir, route + ".md");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, body);
    mdCount++;
    if (inFull) fullParts.push(body);
  }
}

const blogDir = join(root, "packages/website/blog");
for (const f of walk(blogDir).filter((f) => f.endsWith(".md"))) {
  const m = /^(\d{4})-(\d{2})-(\d{2})-(.+)\.md$/.exec(basename(f));
  if (!m) continue;
  const route = `/blog/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
  const body = stripFrontmatter(readFileSync(f, "utf8"));
  const out = join(buildDir, route + ".md");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, body);
  mdCount++;
  fullParts.push(body);
}

writeFileSync(join(buildDir, "llms-full.txt"), fullParts.join("\n\n---\n\n"));
console.log(`gen-llms: wrote ${mdCount} per-page .md files + llms-full.txt`);
