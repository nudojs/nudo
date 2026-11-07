/**
 * 全仓测试「已知失败集合」的固化与机器对比（本地 Node 22 / CI Node 24）。
 *
 *   pnpm exec vitest run --reporter=dot > /tmp/nudo-test.log 2>&1 || true
 *   pnpm run test:baseline -- /tmp/nudo-test.log          # 对比（0 新增才算过）
 *   pnpm run test:baseline -- --update /tmp/nudo-test.log # 重新固化基线
 *
 * 背景：本地 Node 22.22.2 与 CI Node 24 的**宿主面**不同（Float16Array /
 * ES 全局清单等），另有 fs.watch 事件数、临时目录路径归一化、LSP 侧车写入
 * 这类环境相关钉。全仓 20 条失败与代码回归无关，此前只存在 /tmp 的一份
 * 文件清单里，且是**测试聚合之前**的路径 ⇒ 既不可复核也不匹配当前入口。
 * 这里按「失败用例全名」（文件 > describe > it）固化，聚合改文件名时会显式
 * 报「新增 + 消失」，提示人工更新基线。
 *
 * 判据：**新增失败一律判红**（exit 1）；基线里的用例偶尔不出现只告警不判红
 * （watch / fs 事件本来就可能 flaky，硬要求「0 消失」会制造假红）。
 * CI 用 Node 24 ⇒ 期望 0 条失败；若 CI 出现失败，本脚本会全部报成新增。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(repoRoot, "docs/reports/test-baseline-failures.json");
const ANSI = /\x1b\[[0-9;]*m/g;

function failedTestsFromLog(log) {
  const out = new Set();
  for (const line of log.split(/\r?\n/)) {
    const clean = line.replace(ANSI, "");
    const m = /^\s*FAIL\s{2}(.+?)\s*$/.exec(clean);
    if (m) out.add(m[1].trim());
  }
  return out;
}

const args = process.argv.slice(2);
const update = args.includes("--update");
// `pnpm run <script> -- <args>` 会把分隔用的 `--` 一并透传给脚本。
const paths = args.filter((a) => a !== "--update" && a !== "--");
if (paths.length !== 1) {
  console.error("usage: pnpm run test:baseline -- [--update] <vitest-log-file>");
  process.exit(2);
}
const logPath = paths[0];
if (!existsSync(logPath)) {
  console.error(`missing log: ${logPath}`);
  process.exit(2);
}
const actual = failedTestsFromLog(readFileSync(logPath, "utf8"));

if (update) {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const doc = {
    note:
      "本地 Node 22 全量基线；CI 用 Node 24。仅含宿主面/环境相关的已知失败，" +
      "不含任何代码回归。用 scripts/test-baseline.mjs --update 重新固化。",
    host: "darwin / Node 22.22.2 (CI: ubuntu-latest / Node 24)",
    updated: today,
    expectedFailedTests: [...actual].sort(),
  };
  writeFileSync(baselinePath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  console.log(`baseline updated: ${actual.size} failed tests → ${baselinePath}`);
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error(`missing baseline: ${baselinePath} — run with --update once`);
  process.exit(2);
}
const expectedSet = new Set(
  JSON.parse(readFileSync(baselinePath, "utf8")).expectedFailedTests,
);
const added = [...actual].filter((t) => !expectedSet.has(t)).sort();
const missing = [...expectedSet].filter((t) => !actual.has(t)).sort();

console.log(`failed ${actual.size} = baseline ${expectedSet.size} · ${added.length} 新增 / ${missing.length} 消失`);
for (const t of added) console.log(`  + ${t}`);
for (const t of missing) console.log(`  - ${t} (基线项本次未出现：flaky 或已修复，人工确认后 --update)`);
if (missing.length > 0) {
  console.log("note: 消失不判红；若确为永久修复，请跑 --update 收紧基线。");
}
if (added.length > 0) {
  console.error(`\n${added.length} 条新增失败 —— 全仓回归未通过`);
  process.exit(1);
}
console.log("ok: 0 新增失败");
