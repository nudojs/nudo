/**
 * isHostGlobalFn 惰性收集循环的 stderr 卫生（宿主 lazy accessor 全局）：
 * 收集循环对 globalThis 每个自有属性原样 GET 时，Node ≥ 22.4/23 的
 * accessor 型 lazy getter 一律在工作进程 stderr 溅警告——localStorage
 * （`--localstorage-file` 未提供）、punycode（DEP0040）、sys（DEP0025）、
 * wasi/ffi（Experimental）等；名单随版本只增不减（node:test/node:sea
 * 已在列）。修复=按 descriptor 形态跳过全部 accessor（GET 前跳），
 * 仅白名单读函数值 accessor（Buffer）。
 *
 * 防护面：try/catch 无效（警告非异常）；`in` 预检无效（accessor 存在，
 * GET 仍警告）；跳名清单不可维护——本测试对「整个警告族」零容忍，
 * 而非只钉 webstorage 两名字（旧版范围如此，wasi/ffi 漏网）。
 *
 * 子进程方式最稳：警告经 process.emitWarning 异步发射且 Node 按
 * name+message 去重，vitest 主进程内此前若已触发过同名警告会假绿；
 * 全新子进程独占触发权。断言同时守卫收集集语义：宿主函数必须在集内
 * （decodeURIComponent、函数值 accessor 白名单）、非宿主函数必须在集外。
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

describe("isHostGlobalFn accessor hygiene", () => {
  it("building hostGlobalFnIds emits no host lazy-getter warnings (fresh subprocess)", () => {
    const script = `
const m = await import(${JSON.stringify(pathToFileURL(callsTs).href)});
// 触发惰性收集（GET 扫描 globalThis 全部自有属性）
if (!m.isHostGlobalFn(globalThis.decodeURIComponent)) {
  console.error("MISS: decodeURIComponent not in host global fn set");
  process.exit(2);
}
// 函数值 accessor 白名单（Buffer/assert/events/stream/node:test）必须仍被
// 收集——与旧「全量 GET」实现的收集集逐元素对齐；这些名字被消费于
// $new 宿主构造器分支、调用位字面量守卫执行与 extends 宿主判定。
for (const k of ["Buffer", "assert", "events", "stream", "node:test"]) {
  if (!Object.getOwnPropertyDescriptor(globalThis, k)) continue;
  if (!m.isHostGlobalFn(globalThis[k])) {
    console.error("MISS: function-valued accessor dropped from host global fn set: " + k);
    process.exit(4);
  }
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
    ).not.toMatch(/^(2|3|4)\n/);
    expect(res.status, `subprocess stderr: ${res.stderr}`).toBe(0);
    // 修复目标断言：GET 循环不得触发任何宿主 lazy-getter 警告
    // （localStorage/punycode/sys/wasi/ffi 族一次钉住；未来新 lazy
    // getter 触发同类警告同样被判红）
    expect(res.stderr).not.toMatch(/(Experimental|Deprecation)Warning/);
  });
});
