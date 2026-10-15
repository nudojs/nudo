/**
 * isHostGlobalFn 惰性收集循环的 stderr 卫生（webstorage 实验 accessor）：
 * 收集循环对 globalThis 每个自有属性做 GET；Node ≥ 22.4 的
 * localStorage/sessionStorage 是实验 accessor，GET 即触发
 * `ExperimentalWarning: localStorage is not available because
 * --localstorage-file was not provided`（node v26.10 实测，修复前
 * `pnpm -s nudo -- test <dep3.js>` stderr 必现）。修复=GET 前跳名。
 *
 * 防护面：try/catch 无效（警告非异常）；`in` 预检无效（accessor 存在，
 * GET 仍警告）——跳名必须在 GET 之前，本测试钉住该次序。
 *
 * 子进程方式最稳：警告经 process.emitWarning 异步发射且 Node 按
 * name+message 去重，vitest 主进程内此前若已触发过同名警告会假绿；
 * 全新子进程独占触发权。断言范围限定 webstorage（本修复目标）——
 * node 26 另有 wasi/ffi 等 lazy builtin alias getter 会在裸 node 子进程
 * 触发同类警告，属另一问题不在本测试范围。
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
/** packages/core/src/algebra/exec/calls.ts 的绝对路径（相对本测试文件） */
const callsTs = join(here, "..", "exec", "calls.ts");
/** 仓库根（tsx 在根 devDependencies，`pnpm -s nudo` 同源） */
const repoRoot = join(here, "..", "..", "..", "..", "..");

describe("isHostGlobalFn webstorage accessor hygiene", () => {
  it("building hostGlobalFnIds emits no webstorage ExperimentalWarning (fresh subprocess)", () => {
    const script = `
const m = await import(${JSON.stringify(pathToFileURL(callsTs).href)});
// 触发惰性收集（GET 扫描 globalThis 全部自有属性）
if (!m.isHostGlobalFn(globalThis.decodeURIComponent)) {
  console.error("MISS: decodeURIComponent not in host global fn set");
  process.exit(2);
}
if (m.isHostGlobalFn(() => {})) {
  console.error("FALSE-POSITIVE: non-host arrow matched");
  process.exit(3);
}
`;
    const res = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script],
      { encoding: "utf8", cwd: repoRoot, timeout: 60_000 },
    );
    // 子进程须真正完成收集且语义未破坏（非空跑）
    expect(
      `${res.status}\n${res.stderr}`,
      "subprocess must complete the collection loop cleanly",
    ).not.toMatch(/^(2|3)\n/);
    expect(res.status, `subprocess stderr: ${res.stderr}`).toBe(0);
    // 修复目标断言：GET 循环不得触发 webstorage 实验 accessor 警告
    expect(res.stderr).not.toMatch(
      /ExperimentalWarning: (localStorage|sessionStorage) is not available/,
    );
    expect(res.stderr).not.toContain("--localstorage-file");
  });
});
