/**
 * rest 形参绑定必须发成可变绑定（`let`），不得发 `const`。
 *
 * 背景：真实 CJS 包 `debug@4` 的 `src/common.js` 里是
 * `function debug(...args) { if (!debug.enabled) return; ...; args[0] = coerce(args[0]); }`。
 * 转译器把 rest 发成 `const args = $restBind(...)`，而 fork 臂恢复
 * （emit.ts forkArmThunk）与成员写回根（member-path.ts）都会发射
 * `args = $copy(...)` / `args = $set(...)` —— 生成码里这是对 const 的赋值，
 * V8 抛原生 `TypeError: Assignment to constant variable`，整模块 fail-closed
 * ⇒ error 级 `nudo:module-throw`。`docs/examples/retire-debug/after` 的
 * 示例曾因此长期红（且只在能解析到真实 debug 包的宿主上复现）。
 *
 * 原生 JS 的 rest 形参本就是可变绑定（`function f(...a){ a = 1 }` 合法）；
 * 引擎自己 `__this` / CJS `exports` / `module` 也都用 let。两处发射点：
 * - `transpile/stmt/statement.ts`（函数声明，arguments 切片）
 * - `transpile/expr/function.ts`（函数表达式，宿主 `...__rest_raw`）
 */
import { describe, expect, it } from "vitest";
import { transpileSource, type TranspileOptions } from "../transpile.ts";
import { runTranspiled } from "../run.ts";

const restCases: Array<[label: string, source: string, binding: string]> = [
  [
    "函数声明（分支 + 成员写）",
    `export function f(cond, ...args) { if (cond) { args[0] = 9; } return args; }`,
    "args",
  ],
  [
    "函数表达式（成员写）",
    `export const g = function (...args) { args[0] = 1; return args; };`,
    "args",
  ],
  ["显式重绑", `export function h(...a) { a = 2; return a; }`, "a"],
];

describe("rest 形参发射为可变绑定（Assignment to constant variable 回归）", () => {
  for (const target of ["esm", "host"] as const) {
    it.each(restCases)(`${target} target：%s 的 rest 绑定是 let`, (_label, source, binding) => {
      const opts: TranspileOptions = { target };
      const code = transpileSource(source, opts);
      expect(code).toContain(`let ${binding} = $restBind(`);
      expect(code).not.toContain(`const ${binding} = $restBind(`);
    });
  }

  it("模块装载期 fork 臂恢复 + rest 成员写不再抛 const 赋值异常", () => {
    // 顶层调用不能被 analyze 模式剥掉：mode: "exec" 才会真正跑进函数体。
    const src = `
      export function probe(cond, ...args) {
        if (cond) { args[0] = 9; }
        return args.length;
      }
      probe(true, 1, 2);
    `;
    expect(() => runTranspiled(src, { mode: "exec" })).not.toThrow();
    expect(Object.keys(runTranspiled(src, { mode: "exec" }))).toContain("probe");
  });

  it("rest 显式重绑按原生语义合法", () => {
    const src = `export function f(...a) { a = 2; return a; } f(1);`;
    expect(() => runTranspiled(src, { mode: "exec" })).not.toThrow();
  });

  it("复刻 debug/common.js 形态：guard 分支 + coerce 成员写", () => {
    const src = `
      let enabled = false;
      export function debug(...args) {
        if (!enabled) { return; }
        args[0] = String(args[0]);
        return args.length;
      }
      export function createLogger(ns) { return debug(ns); }
      createLogger("demo");
    `;
    expect(() => runTranspiled(src, { mode: "exec" })).not.toThrow();
    const exports = runTranspiled(src, { mode: "exec" });
    expect(Object.keys(exports)).toEqual(expect.arrayContaining(["debug", "createLogger"]));
  });
});
