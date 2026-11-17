#!/usr/bin/env node
/**
 * Diff 面门禁：给「加法」标价。只对「merge-base → 工作区」一个面生效
 * （本地未提交改动与 CI 的 PR 面同一语义；untracked 文件也计入）。
 *
 *   pnpm run check:diff-face                       # 默认 base = origin/main（PR 语义）
 *   pnpm run check:diff-face -- --base origin/dev
 *   pnpm run check:diff-face -- --reason "为什么这批改动不能更小"
 *   CI: DIFF_FACE_BASE=<sha> DIFF_FACE_PR_BODY="<PR body>" pnpm run check:diff-face
 *
 * 三条触发线（阈值 = package.json#nudo.diffBudget 的「解释线」，不是上限）：
 *   1. 源码面净增行数 > sourceNetLines
 *   2. 新增源码文件数 > newSourceFiles
 *   3. 新增测试文件数 > newTestFiles（默认 0：每新增一个测试文件都要回答
 *      「为何不能并入既有矩阵 / 吸收替换了哪个旧条目」——合并即删）
 * 任一触发 ⇒ 必须给书面理由，两条通道任一即可：
 *   - --reason / DIFF_FACE_REASON：自由文本，trim 后 ≥ MIN_REASON_CHARS
 *   - PR body（DIFF_FACE_PR_BODY / --pr-body <file>）：
 *     .github/PULL_REQUEST_TEMPLATE.md 的全部二级标题都在，且每节正文非空
 *     （HTML 注释不计正文——只留模板注释视为未填）
 *
 * 本门禁只判「理由是否存在」，不判质量；质量是 review 的事。机制说明见
 * CLAUDE.md「Diff 面纪律」。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_PATH = join(repoRoot, ".github", "PULL_REQUEST_TEMPLATE.md");
const MIN_REASON_CHARS = 40;
const DEFAULTS = { sourceNetLines: 250, newSourceFiles: 2, newTestFiles: 0 };

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

function git(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function readBudget() {
  let configured = {};
  try {
    configured = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).nudo?.diffBudget ?? {};
  } catch {
    configured = {};
  }
  const pick = (key) => {
    const value = configured[key];
    return Number.isInteger(value) && value >= 0 ? value : DEFAULTS[key];
  };
  return {
    sourceNetLines: pick("sourceNetLines"),
    newSourceFiles: pick("newSourceFiles"),
    newTestFiles: pick("newTestFiles"),
  };
}

function resolveBase() {
  const explicit = opt("base") ?? process.env.DIFF_FACE_BASE;
  if (explicit) return explicit;
  for (const candidate of ["origin/main", "main"]) {
    try {
      git(["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`]);
      return candidate;
    } catch {
      // 试下一个
    }
  }
  return null;
}

/** `--numstat -z`：`add\tdel\tpath\0`；rename/copy 为 `add\tdel\t\0old\0new\0`。 */
function parseNumstat(raw) {
  const parts = raw.split("\0");
  const rows = [];
  for (let i = 0; i < parts.length; i++) {
    const head = parts[i];
    if (!head) continue;
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(head);
    if (!m) continue;
    const added = m[1] === "-" ? 0 : Number(m[1]);
    const deleted = m[2] === "-" ? 0 : Number(m[2]);
    if (m[3] === "") {
      i += 1; // old path
      const to = parts[++i];
      if (to) rows.push({ path: to, added, deleted });
    } else {
      rows.push({ path: m[3], added, deleted });
    }
  }
  return rows;
}

/** `--name-status -z`：`M\0path\0`；rename/copy 为 `R100\0old\0new\0`。 */
function parseNameStatus(raw) {
  const parts = raw.split("\0");
  const status = new Map();
  for (let i = 0; i < parts.length; ) {
    const code = parts[i++];
    if (!code) continue;
    if (code[0] === "R" || code[0] === "C") {
      i += 1; // old path
      const to = parts[i++];
      if (to) status.set(to, code[0]);
    } else {
      const path = parts[i++];
      if (path) status.set(path, code[0]);
    }
  }
  return status;
}

const isTestPath = (p) => /(^|\/)__tests__\//.test(p) || /\.(test|spec)\.tsx?$/.test(p);

/** 源码面 = 产品包 src 的非测试文件；website 是文档应用，由 verify:* 自管。 */
const isSourcePath = (p) =>
  /^packages\/[^/]+\/src\//.test(p) && !p.startsWith("packages/website/") && !isTestPath(p);

function aggregate(rows, status) {
  const source = { added: 0, deleted: 0, newFiles: [], deletedFiles: [], touched: 0 };
  const tests = { added: 0, deleted: 0, newFiles: [], deletedFiles: [], touched: 0 };
  for (const row of rows) {
    const code = status.get(row.path) ?? "M";
    if (isSourcePath(row.path)) {
      source.added += row.added;
      source.deleted += row.deleted;
      source.touched += 1;
      if (code === "A") source.newFiles.push(row.path);
      if (code === "D") source.deletedFiles.push(row.path);
    } else if (isTestPath(row.path)) {
      tests.added += row.added;
      tests.deleted += row.deleted;
      tests.touched += 1;
      if (code === "A") tests.newFiles.push(row.path);
      if (code === "D") tests.deletedFiles.push(row.path);
    }
  }
  return { source, tests };
}

function collectViolations({ source, tests }, budget) {
  const violations = [];
  const net = source.added - source.deleted;
  if (net > budget.sourceNetLines) {
    violations.push(`源码面净增 ${net} 行 > ${budget.sourceNetLines}（+${source.added} −${source.deleted}）`);
  }
  if (source.newFiles.length > budget.newSourceFiles) {
    violations.push(
      `新增源码文件 ${source.newFiles.length} > ${budget.newSourceFiles}：\n      ` +
        source.newFiles.join("\n      "),
    );
  }
  if (tests.newFiles.length > budget.newTestFiles) {
    violations.push(
      `新增测试文件 ${tests.newFiles.length} > ${budget.newTestFiles}——回答「为何不能并入既有矩阵」或「吸收/替换了哪个旧条目」：\n      ` +
        tests.newFiles.join("\n      "),
    );
  }
  return violations;
}

/** 模板的二级标题即必填小节（唯一真值：改模板即改门禁）。 */
function templateSections() {
  let text;
  try {
    text = readFileSync(TEMPLATE_PATH, "utf8");
  } catch {
    console.error("diff face: 缺少 .github/PULL_REQUEST_TEMPLATE.md——它是本门禁的解析契约，不能删。");
    process.exit(2);
  }
  const names = [...text.replace(/<!--[\s\S]*?-->/g, "").matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]);
  if (names.length === 0) {
    console.error("diff face: .github/PULL_REQUEST_TEMPLATE.md 没有任何二级标题，无法解析必填小节。");
    process.exit(2);
  }
  return names;
}

function readJustification() {
  const reason = (opt("reason") ?? process.env.DIFF_FACE_REASON ?? "").trim();
  if (reason.length >= MIN_REASON_CHARS) return { kind: "reason", text: reason };

  const bodyFile = opt("pr-body");
  let body = process.env.DIFF_FACE_PR_BODY ?? "";
  if (bodyFile) {
    try {
      body = readFileSync(bodyFile, "utf8");
    } catch (err) {
      console.error(`diff face: 读不到 --pr-body ${bodyFile}: ${err.message}`);
      process.exit(2);
    }
  }
  if (!body.trim()) return reason ? { kind: "reason-too-short", text: reason } : null;

  // 模板注释会被 GitHub 原样带进 PR body，不算正文。
  const cleaned = body.replace(/<!--[\s\S]*?-->/g, "");
  const bodies = new Map();
  let current = null;
  for (const line of cleaned.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = heading[1];
      if (!bodies.has(current)) bodies.set(current, []);
      continue;
    }
    if (current) bodies.get(current).push(line);
  }
  const missing = templateSections().filter((name) => !(bodies.get(name) ?? []).join("\n").trim());
  if (missing.length === 0) return { kind: "pr-body" };
  return { kind: "pr-body-incomplete", missing };
}

/** untracked 文件由 ls-files 补齐（git diff 看不到）；二进制记 0 行。 */
function countLines(absPath) {
  let buf;
  try {
    buf = readFileSync(absPath);
  } catch {
    return 0;
  }
  if (buf.subarray(0, 8192).includes(0)) return 0;
  const text = buf.toString("utf8");
  const newlines = text.split("\n").length - 1;
  return text.length > 0 && !text.endsWith("\n") ? newlines + 1 : newlines;
}

function report({ source, tests }, budget, baseRef, baseCommit, commits) {
  console.log(`diff face vs ${baseRef}（merge-base ${baseCommit}，${commits} commits + 工作区）`);
  console.log(
    `  source  +${source.added} −${source.deleted}  net ${signed(source.added - source.deleted)}  ` +
      `new ${source.newFiles.length} / deleted ${source.deletedFiles.length} / touched ${source.touched}`,
  );
  console.log(
    `  tests   +${tests.added} −${tests.deleted}  net ${signed(tests.added - tests.deleted)}  ` +
      `new ${tests.newFiles.length} / deleted ${tests.deletedFiles.length} / touched ${tests.touched}`,
  );
  console.log(
    `  budget  net ≤ ${budget.sourceNetLines} · new source ≤ ${budget.newSourceFiles} · new test ≤ ${budget.newTestFiles}`,
  );
  if (tests.newFiles.length > 0 && tests.deletedFiles.length === 0) {
    console.log("  note    新增测试文件但未删除任何测试文件（合并即删需书面回答）");
  }
}

function signed(n) {
  return n >= 0 ? `+${n}` : `−${Math.abs(n)}`;
}

function main() {
  const budget = readBudget();
  const base = resolveBase();
  if (!base) {
    console.error(
      "diff face: 找不到 base 引用（试过 --base / DIFF_FACE_BASE / origin/main / main）。\n" +
        "  CI 里传 DIFF_FACE_BASE=<base sha>；本地传 --base <ref>。",
    );
    process.exit(2);
  }

  // merge-base → 工作区：本地未提交的改动与 CI 的 PR 面同一语义，不做双重计数。
  let mb;
  try {
    mb = git(["merge-base", base, "HEAD"]).trim();
  } catch (err) {
    console.error(`diff face: ${base} 与 HEAD 没有公共祖先，无法比较。\n${err.message}`);
    process.exit(2);
  }

  let stats;
  let commits;
  try {
    const rows = parseNumstat(git(["diff", "--numstat", "-z", "--no-color", "--find-renames=50%", mb]));
    const status = parseNameStatus(git(["diff", "--name-status", "-z", "--no-color", "--find-renames=50%", mb]));
    for (const path of git(["ls-files", "--others", "--exclude-standard"]).split("\n")) {
      if (!path) continue;
      rows.push({ path, added: countLines(join(repoRoot, path)), deleted: 0 });
      status.set(path, "A");
    }
    stats = aggregate(rows, status);
    commits = git(["rev-list", "--count", `${mb}..HEAD`]).trim();
  } catch (err) {
    console.error(`diff face: git diff ${mb} 失败——仓库不完整或 base 不可读。\n${err.message}`);
    process.exit(2);
  }

  report(stats, budget, base, mb.slice(0, 7), commits);
  const violations = collectViolations(stats, budget);
  if (violations.length === 0) {
    console.log("ok: diff face within budget");
    return;
  }

  const justification = readJustification();
  const justified = justification?.kind === "reason" || justification?.kind === "pr-body";
  console.log(`\n${justified ? "note" : "FAIL"} diff face: ${violations.length} 项超出解释线`);
  for (const v of violations) console.log(`  - ${v}`);

  if (justification?.kind === "reason") {
    console.log(`\nok: 已提供理由（${justification.text.length} 字符）`);
    return;
  }
  if (justification?.kind === "pr-body") {
    console.log("\nok: PR body 已填任务书全部小节");
    return;
  }
  if (justification?.kind === "pr-body-incomplete") {
    console.log(`\nPR body 缺少内容的节：${justification.missing.join("、")}`);
  }
  if (justification?.kind === "reason-too-short") {
    console.log(`\n--reason 只有 ${justification.text.length} 字符（需 ≥${MIN_REASON_CHARS}）`);
  }
  console.log(
    `\n理由通道（任一）：\n` +
      `  1. --reason "<≥${MIN_REASON_CHARS} 字符>" 或环境变量 DIFF_FACE_REASON\n` +
      `  2. 填 PR body 的下列小节（模板 .github/PULL_REQUEST_TEMPLATE.md）：` +
      templateSections().map((s) => `\n       - ${s}`).join("") +
      `\n答不上来 = 该删掉一些东西，而不是加一行解释。`,
  );
  process.exitCode = 1;
}

main();
