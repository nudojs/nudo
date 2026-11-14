/**
 * 全仓测试「已知失败集合」的**按宿主**固化与机器对比。
 *
 * 宿主键 = `<platform>/<node major>`（如 linux/26、darwin/22）。本地与 CI 的
 * 宿主面不同（Float16Array / ES 全局清单 / fs.watch 事件数 / 临时目录归一化
 * 等），单一扁平清单会随宿主漂移：换机器后旧条目全部「消失」、真问题全报
 * 「新增」。按宿主分桶后，每个宿主只对比自己的集合。
 *
 *   pnpm exec vitest run --maxWorkers=4 > /tmp/nudo-test.log 2>&1 || true
 *   pnpm run test:baseline -- /tmp/nudo-test.log          # 对比当前宿主
 *   pnpm run test:baseline -- --update /tmp/nudo-test.log # 只重写当前宿主条目
 *
 * 判据：**新增失败一律判红**（exit 1）；基线里的用例偶尔不出现只告警不判红
 * （watch / fs 事件本来就可能 flaky，硬要求「0 消失」会制造假红）。
 * 未登记宿主当空基线：任何失败都是新增 —— 先跑一次全量再 `--update`。
 *
 * 记录键是「失败用例全名」（文件 > describe > it），聚合改文件名时会显式报
 * 「新增 + 消失」，提示人工更新基线。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(repoRoot, "docs/reports/test-baseline-failures.json");
const ANSI = /\x1b\[[0-9;]*m/g;
const HOST_KEY = `${process.platform}/${process.versions.node.split(".")[0]}`;

function failedTestsFromLog(log) {
  const out = new Set();
  for (const line of log.split(/\r?\n/)) {
    const clean = line.replace(ANSI, "");
    const m = /^\s*FAIL\s{2}(.+?)\s*$/.exec(clean);
    if (m) out.add(m[1].trim());
  }
  return out;
}

function readBaseline() {
  if (!existsSync(baselinePath)) return { hosts: {} };
  const doc = JSON.parse(readFileSync(baselinePath, "utf8"));
  if (!doc.hosts || typeof doc.hosts !== "object" || Array.isArray(doc.hosts)) {
    console.error(
      `malformed baseline: ${baselinePath} — expected { hosts: { "<platform>/<node-major>": { expectedFailedTests: [...] } } }`,
    );
    process.exit(2);
  }
  return doc;
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
  const doc = readBaseline();
  doc.note =
    "按宿主（<platform>/<node major>）固化的已知失败集合；只含宿主面/环境相关项，" +
    "不含代码回归。用 scripts/test-baseline.mjs --update 重写**当前宿主**条目，" +
    "其它宿主原样保留。";
  doc.hosts[HOST_KEY] = { updated: today, expectedFailedTests: [...actual].sort() };
  doc.hosts = Object.fromEntries(
    Object.entries(doc.hosts).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(baselinePath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  console.log(`baseline updated: ${actual.size} failed tests → ${HOST_KEY} (${baselinePath})`);
  process.exit(0);
}

const doc = readBaseline();
const entry = doc.hosts[HOST_KEY];
if (entry && !Array.isArray(entry.expectedFailedTests)) {
  console.error(`malformed baseline entry for ${HOST_KEY} — expectedFailedTests must be an array`);
  process.exit(2);
}
const expectedSet = new Set(entry?.expectedFailedTests ?? []);
const added = [...actual].filter((t) => !expectedSet.has(t)).sort();
const missing = [...expectedSet].filter((t) => !actual.has(t)).sort();

if (!entry) {
  console.log(`host ${HOST_KEY}: no baseline entry — treating as empty (run --update after a full run)`);
}
console.log(
  `host ${HOST_KEY}: failed ${actual.size} = baseline ${expectedSet.size} · ${added.length} 新增 / ${missing.length} 消失`,
);
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
