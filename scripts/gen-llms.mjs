#!/usr/bin/env node
// 构建后生成 agent 友好的原始 markdown 面（llms.txt 生态）：
//  - 每个文档页 / 博客帖在其路由下旁挂一份 `.md`（无 frontmatter，纯正文）
//  - 站点根输出 `llms-full.txt`（en 文档 + 博客全文拼接）
// 依赖 docs 构建产物目录（packages/website/build），由 docs-deploy 在 build 后调用。
//
// 运行：node scripts/gen-llms.mjs
// 测试夹具可用 GEN_LLMS_ROOT 指向伪仓库根（packages/website/{docs,blog,build}）。
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, relative, dirname, basename, resolve, sep, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * frontmatter / custom slug → 安全的相对路由路径。
 * 去掉 leading `/`（Docusaurus 绝对路由写法）与 `.` 段；拒绝绝对路径与 `..` 段。
 */
export function normalizeSlug(slug) {
  const raw = String(slug);
  const s = raw.replace(/^[/\\]+/, "");
  if (isAbsolute(s) || /^[a-zA-Z]:[/\\]/.test(s)) {
    throw new Error(`gen-llms: absolute slug rejected: ${raw}`);
  }
  const segs = s.split(/[/\\]/).filter((seg) => seg !== "" && seg !== ".");
  if (segs.some((seg) => seg === "..")) {
    throw new Error(`gen-llms: slug escapes build root: ${raw}`);
  }
  if (segs.length === 0) {
    throw new Error(`gen-llms: empty slug rejected: ${raw}`);
  }
  return segs.join("/");
}

/** `route + ".md"` 必须落在 buildDir 内（防御纵深：join 后再 resolve 包含性检查）。 */
export function safeOutPath(buildDir, route) {
  const root = resolve(buildDir);
  const out = resolve(join(root, route + ".md"));
  if (out === root || !out.startsWith(root + sep)) {
    throw new Error(`gen-llms: path escapes buildDir: ${route}`);
  }
  return out;
}

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

function main() {
  const root = process.env.GEN_LLMS_ROOT
    ? resolve(process.env.GEN_LLMS_ROOT)
    : fileURLToPath(new URL("..", import.meta.url));
  const buildDir = join(root, "packages/website/build");

  // llms-full.txt exclusions: releases-history is a ~130KB changelog aggregate that
  // would dominate the concatenated corpus. Its per-page .md sidecar and llms.txt
  // index entry stay intact (docs-coverage rule 10 only checks those).
  const FULL_EXCLUDE = new Set(["/docs/releases-history"]);

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
      const routeSlug = normalizeSlug(
        slug ?? relative(base, f).replace(/\.md$/, ""),
      );
      const route = `${prefix}/${routeSlug}`;
      const body = stripFrontmatter(readFileSync(f, "utf8"));
      const out = safeOutPath(buildDir, route);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, body);
      mdCount++;
      if (inFull && !FULL_EXCLUDE.has(route)) fullParts.push(body);
    }
  }

  const blogDir = join(root, "packages/website/blog");
  for (const f of walk(blogDir).filter((f) => f.endsWith(".md"))) {
    const m = /^(\d{4})-(\d{2})-(\d{2})-(.+)\.md$/.exec(basename(f));
    if (!m) continue;
    const customSlug = slugOf(f);
    const route = customSlug
      ? `/blog/${normalizeSlug(customSlug)}`
      : `/blog/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
    const body = stripFrontmatter(readFileSync(f, "utf8"));
    const out = safeOutPath(buildDir, route);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, body);
    mdCount++;
    fullParts.push(body);
  }

  writeFileSync(join(buildDir, "llms-full.txt"), fullParts.join("\n\n---\n\n"));
  console.log(`gen-llms: wrote ${mdCount} per-page .md files + llms-full.txt`);
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main();
