#!/usr/bin/env node
/**
 * 仓内脚本纪律门禁 —— `scripts/` 与 `package.json#scripts` 的准入契约。
 *
 * 规则文本在 scripts/README.md（「纪律」与「预算」两节）。本文件只做机器校验：
 *   1. 磁盘 ↔ 索引双向一致：每个脚本文件在 README 表里有行，每行对应一个真实文件；
 *      行必须是三列（文件 / 用途 / 触发方），后两列非空（不准留占位）。
 *   2. 无死文件：每个脚本文件在仓库内（除自身与本 README）至少被引用一次。
 *   3. 无孤儿入口：`package.json#scripts` 的每个 name 必须在 package.json 之外有
 *      `pnpm run <name>` / `npm run <name>` 调用点（名字边界收在 `\w:-`）。
 *   4. 预算：代码文件数与 npm 入口数不得超过 BUDGET。升预算是一次显式 diff，
 *      与 check-core-subdomains.mjs 的 MAX_TOP_LEVEL_TS 同口径。
 *
 *   node scripts/check-scripts.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsRoot = join(repoRoot, "scripts");
const SELF = "scripts/check-scripts.mjs";
const INDEX = join(scriptsRoot, "README.md");

// 预算 = 2026-11-17 清理后的规模。加一个文件/入口必须同时改这里，并在 PR 的
// 「新增文件理由」里回答「为什么现有工具不能复用」。
const BUDGET = { files: 38, npmEntries: 46 };

const CODE_EXT = /\.(?:mjs|cjs|js|mts|cts|ts|sh)$/;
// 生成物与大文件不参与「引用」统计：build 产物会引用任何被生成进去的名字，
// lockfile 只是哈希噪音。
const SKIP_PATH = /(?:^|\/)(?:node_modules|build|coverage|coverage-blobs|\.git|dist)\//;
const SKIP_FILE = /(?:^|\/)(?:pnpm-lock\.yaml|CHANGELOG\.md)$/;
const SKIP_EXT = /\.(?:png|jpe?g|gif|ico|webp|woff2?|ttf|pdf|zip|gz|vsix|mp4|map)$/i;
const MAX_BYTES = 1024 * 1024;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...walk(abs));
    } else if (CODE_EXT.test(entry.name)) {
      out.push(relative(repoRoot, abs).split(sep).join("/"));
    }
  }
  return out.sort();
}

const files = walk(scriptsRoot);

/** README 的「## 文件」表 → Map<file, { purpose, consumer }>。 */
function parseIndex() {
  const text = readFileSync(INDEX, "utf8");
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^##\s+文件\s*$/.test(l));
  if (start < 0) throw new Error("scripts/README.md 缺少「## 文件」小节");
  const rows = new Map();
  const problems = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    const m = /^\|\s*`([^`]+)`\s*\|([^|]*)\|([^|]*)\|/.exec(line);
    if (!m) continue;
    const file = m[1].trim();
    const purpose = m[2].trim();
    const consumer = m[3].trim();
    if (!purpose || !consumer) {
      problems.push(`scripts/README.md: \`${file}\` 行缺「用途」或「触发方」`);
    }
    if (rows.has(file)) problems.push(`scripts/README.md: \`${file}\` 重复登记`);
    rows.set(file, { purpose, consumer });
  }
  if (rows.size === 0) problems.push("scripts/README.md:「## 文件」表为空或格式不符");
  return { rows, problems };
}

/** 仓库内可搜索的文本文件（tracked + untracked，遵守 gitignore）。 */
function repoTextFiles() {
  const raw = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return raw
    .split("\0")
    .filter(Boolean)
    .filter((p) => !SKIP_PATH.test(p) && !SKIP_FILE.test(p) && !SKIP_EXT.test(p))
    .filter((p) => {
      try {
        return statSync(join(repoRoot, p)).size <= MAX_BYTES;
      } catch {
        return false; // 已删除但仍在 git index 的路径
      }
    });
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const problems = [];
const { rows, problems: indexProblems } = parseIndex();
problems.push(...indexProblems);

// 1) 磁盘 ↔ 索引 双向
for (const file of files) {
  const key = relative(scriptsRoot, join(repoRoot, file)).split(sep).join("/");
  if (!rows.has(key)) {
    problems.push(`未登记：${file} 不在 scripts/README.md 的「## 文件」表`);
  }
}
const present = new Set(files);
for (const key of rows.keys()) {
  if (!present.has(join("scripts", key).split(sep).join("/"))) {
    problems.push(`登记腐烂：scripts/README.md 列了 \`${key}\`，磁盘上没有该文件`);
  }
}

// 2) 无死文件 / 3) 无孤儿入口 —— 单遍扫描
const needles = files.map((f) => relative("scripts", f).split(sep).join("/"));
const entryNames = Object.keys(
  JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).scripts ?? {},
);
const entryRes = entryNames.map((name) => ({
  name,
  re: new RegExp(`(?:pnpm|npm)\\s+run\\s+${escapeRe(name)}(?![\\w:-])`),
}));

const fileHits = new Map(needles.map((n) => [n, []]));
const entryHits = new Map(entryNames.map((n) => [n, []]));

for (const relPath of repoTextFiles()) {
  if (relPath === SELF || relPath === "scripts/README.md") continue;
  let text;
  try {
    text = readFileSync(join(repoRoot, relPath), "utf8");
  } catch {
    continue;
  }
  for (const n of needles) {
    if (text.includes(n)) fileHits.get(n).push(relPath);
  }
  if (!text.includes(" run ")) continue; // 大多数文件没有 npm 调用
  for (const { name, re } of entryRes) {
    if (re.test(text)) entryHits.get(name).push(relPath);
  }
}

for (const [name, hits] of fileHits) {
  if (hits.length === 0) {
    problems.push(`无人引用：scripts/${name} 在全仓（除自身与 README 索引）没有引用`);
  }
}
for (const [name, hits] of entryHits) {
  if (hits.length === 0) {
    problems.push(
      `孤儿入口：package.json#scripts 的 "${name}" 在仓库内没有调用点` +
        `（CI / 文档 / 测试）。一次性任务用 node scripts/… 直调，不加 npm 名字`,
    );
  }
}

// 4) 预算
if (files.length > BUDGET.files) {
  problems.push(
    `脚本文件 ${files.length} 个 > 预算 ${BUDGET.files}：先在既有文件里找落点` +
      `（scripts/README.md「纪律」第 2 条），确需扩容则同步改 BUDGET 并给出理由`,
  );
}
if (entryNames.length > BUDGET.npmEntries) {
  problems.push(
    `npm 入口 ${entryNames.length} 个 > 预算 ${BUDGET.npmEntries}：入口只给 CI / 文档矩阵 / 高频主入口，其余用 node scripts/… 直调`,
  );
}

if (problems.length > 0) {
  console.error("scripts discipline gate FAILED:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `ok: scripts ${files.length}/${BUDGET.files} files (all indexed & referenced), ` +
    `npm entries ${entryNames.length}/${BUDGET.npmEntries} (all wired)`,
);
