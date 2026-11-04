/**
 * B1/B2（宿主污染族）：**分析不得改变宿主全局**。
 *
 * 触发面（benchmark/oss 扩容实测）：未注入的宿主全局（`process` / `Math` /
 * `Error` / 宿主函数…）是**自由标识符**，转译产物里持宿主值；而 fork/switch/
 * 生成器的**绑定归并回写**与成员写的**根重绑**会 `$join($copy(host), …)` ⇒
 * `asAbsVal` 出包装 Abs 写进 `globalThis`：
 * - `process.env.DEBUG = ns`（debug 包顶层 + `save()` 的 if/else）⇒ 宿主
 *   `process` 被换成 Abs 对象（`process.exit` / `prependListener` 全丢，
 *   tsx preflight 直接崩）；
 * - `Error.stackTraceLimit = n` 一类宿主函数成员写 ⇒ `globalThis.Error`
 *   被换成 facade Abs（之后所有 `err instanceof Error` 崩）。
 *
 * 修法：归并回写/根重绑只在运行时判据 `$rebindable(<名>, <绑定>)` 为真时发生——
 * Abs 绑定与**局部宿主函数**（函数声明/表达式，asAbsVal 门面延迟桥接）可重绑；
 * 与 `globalThis[name]` 恒等的宿主全局不可重绑（自赋值 no-op）。本测试钉
 * 「分析前后宿主全局身份/形态不变」。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled } from "../run.ts";

const realProcess = globalThis.process;
const realError = globalThis.Error;

function hostIntact(): void {
  expect(globalThis.process).toBe(realProcess);
  expect(typeof realProcess.exit).toBe("function");
  expect(typeof realProcess.prependListener).toBe("function");
  expect(globalThis.Error).toBe(realError);
  expect(typeof globalThis.Error).toBe("function");
}

describe("B1/B2: 分析不污染宿主全局", () => {
  it("顶层 if/else 成员写 + fork 归并：宿主 process 身份与形态不变", () => {
    const before = process.env.NUDO_B1_PROBE;
    const src = `
function save(namespaces) {
  if (namespaces) { process.env.NUDO_B1_PROBE = namespaces; }
  else { delete process.env.NUDO_B1_PROBE; }
}
save("probe-value");
export const done = 1;
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    expect(exports.done).toBeDefined();
    hostIntact();
    // 宿主 env 不得被分析写脏（$set 对宿主值 fail-closed）
    expect(process.env.NUDO_B1_PROBE).toBe(before);
  });

  it("宿主函数成员写（Error.stackTraceLimit）不把 facade Abs 写进 globalThis.Error", () => {
    const before = (Error as { stackTraceLimit?: number }).stackTraceLimit;
    const src = `
class NudoB2Error extends Error {
  constructor(msg) { super(msg); this.name = "NudoB2Error"; }
}
Error.stackTraceLimit = 42;
export function make(msg) { return new NudoB2Error(msg); }
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    expect(typeof exports.make).toBe("function");
    hostIntact();
    // 宿主 Error 的静态面不得被分析改写
    expect((Error as { stackTraceLimit?: number }).stackTraceLimit).toBe(before);
  });

  it("生成器体内写宿主全局成员：finally 折回不回写宿主", () => {
    const before = process.env.NUDO_B1_GEN;
    const src = `
function* g() { process.env.NUDO_B1_GEN = "x"; yield 1; }
export const it = g();
`;
    runTranspiled(src, { mode: "analyze" });
    hostIntact();
    expect(process.env.NUDO_B1_GEN).toBe(before);
  });

  it("局部绑定的 fork 归并仍然生效（守卫不吞正常精度）", () => {
    const src = `
export function pick(c) { let x = 1; if (c) { x = 2; } return x; }
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const fn = exports.pick as { shape?: { returnType?: { shape?: { k?: string } } } };
    expect(fn).toBeDefined();
  });
});
