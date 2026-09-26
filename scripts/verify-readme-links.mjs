#!/usr/bin/env node
// 校验仓库内所有指向 docs 站点的绝对链接（README / packages README / 站点文档
// / static 文件）都对应一个真实路由。基于源码算路由清单，离线、确定性——
// 不会因为"尚未部署"误红，也不会漏掉"部署后必然 404"的链接。
//
// 运行：node scripts/verify-readme-links.mjs（挂 pnpm run verify:links）
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const SITE = "https://nudojs.github.io/nudo";

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

// 路由清单：文档（含 zh 镜像）、博客、static 文件、页面。
const routes = new Set(["/", "/search"]);

for (const base of [
  ["packages/website/docs", "/docs"],
  ["packages/website/i18n/zh-Hans/docusaurus-plugin-content-docs/current", "/zh-Hans/docs"],
]) {
  for (const f of walk(join(root, base[0])).filter((f) => f.endsWith(".md"))) {
    const rel = relative(join(root, base[0]), f).replace(/\.md$/, "");
    const slug = slugOf(f);
    routes.add(`${base[1]}/${slug ? slug.replace(/^\//, "") : rel}`);
  }
}

for (const f of walk(join(root, "packages/website/static"))) {
  routes.add(`/${relative(join(root, "packages/website/static"), f)}`);
}

routes.add("/playground");
routes.add("/blog");

// 扫描的 markdown 面：README（npm 落地页）+ 站点全部 md + static md。
const scanFiles = [
  join(root, "README.md"),
  ...walk(join(root, "packages")).filter(
    (f) => /README\.md$/.test(f) && !/node_modules|dist|build/.test(f),
  ),
  ...walk(join(root, "packages/website/docs")).filter((f) => f.endsWith(".md")),
  ...walk(join(root, "packages/website/static")).filter((f) => f.endsWith(".md")),
];

const bad = [];
for (const f of scanFiles) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/https:\/\/nudojs\.github\.io\/nudo([^\s)"'<>]+)/g)) {
    const path = m[1].replace(/\/+$/, "") || "/";
    if (!routes.has(path)) {
      bad.push(`${relative(root, f)}: ${SITE}${path}`);
    }
  }
}

if (bad.length) {
  console.error(`broken site links (${bad.length}):`);
  for (const b of bad) console.error(`  ${b}`);
  process.exit(1);
}
console.log(`docs site links OK (${routes.size} known routes)`);
