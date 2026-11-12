/**
 * 干净宿主环境启动器（ABS-16 / 2026-11-12）。
 *
 * 宿主可能通过 `NODE_OPTIONS=--require <fs-broker shim>` 给**每个** node 子进程
 * 注入文件系统代理；本 harness 是磁盘密集型（依赖指纹 BFS 反复 stat/read），
 * 实测会让墙钟放大约 2×。父进程只是启动器、不参与测量；这里删掉 NODE_OPTIONS
 * 后再 spawn 真正的基准进程，并把退出码 / stdio 原样透传。
 *
 * 用法：`pnpm run benchmark:s1:real:clean`
 *   = 干净 env + `--corpus . --quick --clean-corpus --report clean`
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const env: NodeJS.ProcessEnv = { ...process.env };
delete env.NODE_OPTIONS;

const target = join(ROOT, "benchmark", "s1", "bench-monorepo.mts");
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", target, ...process.argv.slice(2)],
  { cwd: ROOT, env, stdio: "inherit" },
);
if (result.error !== undefined) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
