/**
 * 本地测试快车道：`pnpm run test:local [-- --changed | --fast | --e2e | --oracle]`
 *
 * 车道（本地开发循环；CI 保持 build → test 两步）：
 * - `test:local`                 全量（预推送自检，含 e2e/oracle）
 * - `test:local -- --changed`    变更相关（日常内循环；含受影响的慢用例）
 * - `test:local --fast`          PR/main 门禁口径：全量 − e2e − 外部 oracle
 * - `test:local --e2e`           只跑进程级 e2e（`*.e2e.test.ts`；可加 --changed）
 * - `test:local --oracle`        只跑外部 oracle（`*.oracle.test.ts`；可加 --changed）
 *
 * 2026-11-17 起 e2e 与外部 oracle 只在 nightly / dispatch 跑：PR/main 的测试
 * 门禁 = 单元 + 集成用例（PR 不再产覆盖率报告）。改动 CLI/进程面或
 * harvest/真实包精度时用对应车道本地补跑。
 *
 * 通用优化：
 * 1. CLI e2e 走 `NUDO_TEST_CLI=dist`——每次 spawn 省掉 tsx 转译
 *    （0.9s → 0.22s，全仓 900+ 处 spawn）。
 * 2. dist 只在**落后于非测试源码**时重建（tsup 全量约 47s；纯测试改动跳过）。
 * 3. worker 数由 vitest.config.ts 决定（本地 = 核数；CI 仍 4）。
 *
 * 2026-11-17 实测（16 核，978 文件 / 12438 用例）：
 * `pnpm run test` 423s → `test:local` ~100s；`--fast` ~67s；`--e2e` ~40s；`--oracle` ~6s。
 *
 * dist 刷新判定只看非测试源码：tsup 输入不含 `__tests__` / `*.test.ts`，
 * 所以纯测试改动不触发重建，CLI e2e 测的仍是同一份实现。
 */
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD_PACKAGES = [
  "core",
  "parser",
  "env",
  "service",
  "harvester",
  "lsp",
  "nudojs",
  "vite-plugin",
];

/** 递归取目录下文件的最大 mtime；目录不存在返回 undefined。 */
function newestMtime(dir, accept) {
  let newest;
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        // tsup 输入不含测试面（`__tests__/` 下的 harness/helper 虽不是
        // `*.test.ts`，同样不进 dist）——否则只改测试 helper 就会误触发重建。
        if (e.name === "node_modules" || e.name === "__tests__") continue;
        walk(p);
      } else if (accept(e.name)) {
        const { mtimeMs } = statSync(p);
        if (newest === undefined || mtimeMs > newest) newest = mtimeMs;
      }
    }
  };
  walk(dir);
  return newest;
}

const isSource = (name) =>
  (name.endsWith(".ts") || name.endsWith(".tsx")) && !name.endsWith(".test.ts");
const isBuiltJs = (name) => name.endsWith(".js") || name.endsWith(".d.ts");

/**
 * dist 是否落后于非测试源码 / 构建配置。缺 dist 视为落后。
 *
 * 比较用**最新**的 dist 产物：dist 里可能残留历史构建的旧文件（各包 dist
 * 不清理），取最旧会被旧产物永久钉成「落后」。tsup 一次全量重建会把所有
 * 产物时间戳刷到构建时刻，故「src 最新 > dist 最新」等价于「构建后改过源码」。
 */
function distStale() {
  const configMtime = statSync(join(repoRoot, "tsconfig.base.json")).mtimeMs;
  for (const pkg of BUILD_PACKAGES) {
    const pkgDir = join(repoRoot, "packages", pkg);
    const srcNewest = newestMtime(join(pkgDir, "src"), isSource);
    if (srcNewest === undefined) continue;
    const configs = ["tsup.config.ts", "package.json"]
      .map((f) => {
        try {
          return statSync(join(pkgDir, f)).mtimeMs;
        } catch {
          return 0;
        }
      })
      .concat(configMtime);
    const distNewest = newestMtime(join(pkgDir, "dist"), isBuiltJs);
    if (distNewest === undefined) return true;
    if (Math.max(srcNewest, ...configs) > distNewest) return true;
  }
  return false;
}

const args = process.argv.slice(2);
// 直接 `node scripts/test-local.mjs -- <filter>` 时 `--` 会被 vitest 当成
// 「之后的都交给下层」，位置过滤失效（实测会跑全量）。剥掉。
while (args[0] === "--") args.shift();
// `--fast`：跳过 e2e / 外部 oracle 通道（本脚本自己的旗标，不传给 vitest）。
// 与 `--changed` 互斥：changed 命中的 CLI e2e 文件会被 exclude 静默吞掉，
// 宁可直接报错也不要给出「改过 CLI 但本地绿」的假信号。
const fast = args.includes("--fast");
if (fast) args.splice(args.indexOf("--fast"), 1);
// `--e2e`：只跑进程级 e2e（`*.e2e.test.ts`），可配 `--changed` 只跑受影响的。
const e2eOnly = args.includes("--e2e");
if (e2eOnly) args.splice(args.indexOf("--e2e"), 1);
// `--oracle`：只跑外部 oracle（`*.oracle.test.ts`），可配 `--changed`。
const oracleOnly = args.includes("--oracle");
if (oracleOnly) args.splice(args.indexOf("--oracle"), 1);
if ([fast, e2eOnly, oracleOnly].filter(Boolean).length > 1) {
  console.error("[test:local] --fast / --e2e / --oracle 互斥。");
  process.exit(2);
}
if (fast && args.some((a) => a === "--changed" || a.startsWith("--changed="))) {
  console.error("[test:local] --fast 与 --changed 不能同时用：--fast 会跳过 CLI e2e，");
  console.error("             与「只跑变更相关」组合会静默漏测；日常内循环用 --changed，");
  console.error("             宽面自检用 --fast。");
  process.exit(2);
}

if (distStale()) {
  console.log("[test:local] dist 落后于非测试源码 → pnpm run build");
  const build = spawnSync("pnpm", ["run", "build"], { stdio: "inherit", cwd: repoRoot });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const vitestArgs = ["run"];
if (e2eOnly) {
  // 只跑进程级 e2e（nightly 车道的手动对应物）；可与 --changed 组合。
  // 用带点的后缀过滤，避免误匹配 `exec-e2e.test.ts` 这类普通单测。
  // 必须放在用户参数之前：`--changed` 的可选值是下一个位置参数，放后面会被
  // 当成 since（实测变成 `git diff .e2e.test.ts...HEAD`）。
  vitestArgs.push(".e2e.test.ts");
}
if (oracleOnly) {
  vitestArgs.push(".oracle.test.ts");
}
vitestArgs.push(...args);
if (fast) {
  // 慢通道（e2e / 外部 oracle）不进快面：前者 58 文件占测试体时长约一半
  // （每例 2–5 次 CLI spawn），后者依赖 node_modules 里的包。CI 的 PR/main
  // 车道与这里同口径。
  vitestArgs.push(
    "--exclude",
    "**/*.e2e.test.ts",
    "--exclude",
    "**/*.oracle.test.ts",
  );
}

const vitest = join(repoRoot, "node_modules", ".bin", "vitest");
const run = spawnSync(vitest, vitestArgs, {
  stdio: "inherit",
  cwd: process.cwd(),
  env: {
    ...process.env,
    NUDO_TEST_CLI: "dist",
    // 本脚本是本地快车道：即便调用 shell 导出了 CI=true（常见），也按本机
    // 核数取 worker（vitest.config.ts 的 CI 分支固定 4）。CI job 用
    // `pnpm run test`，不走这里。
    CI: "",
    // 不注入 `--max-old-space-size=8192`：8GB 老生代让 worker 只涨不回收，
    // 16 worker 全量 RSS 4.4GB（默认堆 1.1GB）且明显变慢（162s vs 109s）。
    NODE_OPTIONS: process.env.NODE_OPTIONS ?? "",
  },
});
process.exit(run.status ?? 1);
