/**
 * 本地测试快车道：`pnpm run test:local -- [vitest args]`
 *
 * 只改本地开发循环，CI 保持 build → test 两步不变：
 * 1. CLI e2e 走 `NUDO_TEST_CLI=dist`——每次 spawn 省掉 tsx 转译
 *    （0.9s → 0.22s，全仓 900+ 处 spawn）。
 * 2. dist 只在**落后于非测试源码**时重建（tsup 全量约 47s；纯测试改动跳过）。
 * 3. worker 数由 vitest.config.ts 决定（本地 = 核数 − 4；CI 仍 4）。
 *
 * 2026-11-17 实测（16 核，HEAD 259a81b2，968 文件 / 12439 用例）：
 * `pnpm run test` 423s → `pnpm run test:local` 146s（+ 首次 build 47s）。
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
        if (e.name === "node_modules") continue;
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

if (distStale()) {
  console.log("[test:local] dist 落后于非测试源码 → pnpm run build");
  const build = spawnSync("pnpm", ["run", "build"], { stdio: "inherit", cwd: repoRoot });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const vitest = join(repoRoot, "node_modules", ".bin", "vitest");
const run = spawnSync(vitest, ["run", ...process.argv.slice(2)], {
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
