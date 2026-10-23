/**
 * 成员写回的**赋值目标**必须是可赋值绑定回归（`$nodoPos` 包装不可作赋值目标）。
 *
 * 根因：packages/core/src/algebra/exec/transpile/member-path.ts 的
 * memberPathOf —— recordPositions 打开时把路径根包成
 * `$nodoPos(name, line, col)`（位置插桩**读**），而各写回点把同一个
 * `rootSrc` 当作**赋值目标**用：
 *
 *     $nodoPos(o, 2, 24) = $del($nodoPos(o, 2, 24), $lit("a"));
 *
 * 这是**非法 JS**（赋值目标不是简单赋值目标）⇒ new Function 抛 SyntaxError
 * ⇒ 整个模块求值失败（fail-closed）⇒ 带成员写回的模块导出全部退化为
 * unknown。LSP 重放面（packages/lsp/src/lsp-surface/replay.ts）常开
 * recordPositions ⇒ 该面整体失效。
 *
 * 修法：MemberPath 拆出 `rootTarget`（裸绑定名 / argsBinding / thisParam），
 * 写回一律用它；`rootSrc` 只作读基。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { transpileSource } from "../exec/transpile.ts";

/** recordPositions 打开时求值导出函数（修前整模块 fail-closed → unknown） */
function callWithPos(src: string, fnName = "f"): unknown {
  const exports = runTranspiled(src, { mode: "analyze", recordPositions: true });
  const rec = callTranspiledExportFull(exports, fnName, []);
  const v = litValue(rec.result as never);
  return v.ok ? v.value : "?";
}

describe("成员写回的赋值目标（recordPositions 打开）", () => {
  it("成员赋值 o.a = 2 → 2（修前整模块 unknown）", () => {
    expect(callWithPos(`export function f() { const o = {a:1}; o.a = 2; return o.a; }`)).toBe(2);
  });

  it("成员 delete o.a → 槽消失（修前整模块 unknown）", () => {
    expect(callWithPos(`export function f() { const o = {a:1}; delete o.a; return "a" in o ? "still" : "gone"; }`)).toBe(
      "gone",
    );
  });

  it("语句位 defineProperty → 属性就位（修前整模块 unknown）", () => {
    expect(
      callWithPos(`export function f() { const o = {}; Object.defineProperty(o, "b", {value:2}); return "b" in o ? "yes" : "no"; }`),
    ).toBe("yes");
  });

  it("成员自增 o.a++ → 2（修前整模块 unknown）", () => {
    expect(callWithPos(`export function f() { const o = {a:1}; o.a++; return o.a; }`)).toBe(2);
  });

  it("嵌套成员写 o.a.b = 2 → 2（修前整模块 unknown）", () => {
    expect(callWithPos(`export function f() { const o = {a:{b:1}}; o.a.b = 2; return o.a.b; }`)).toBe(2);
  });

  it("解构成员目标写回 → 2（修前整模块 unknown）", () => {
    expect(callWithPos(`export function f() { const o = {a:1}; [o.a] = [5]; return o.a; }`)).toBe(5);
  });

  it("可选 delete o?.a → 槽消失（修前整模块 unknown）", () => {
    expect(callWithPos(`export function f() { const o = {a:1}; delete o?.a; return "a" in o ? "still" : "gone"; }`)).toBe(
      "gone",
    );
  });
});

describe("转译产物：写回目标不得是 $nodoPos(...) 调用", () => {
  const bodies = [
    `const o = {a:1}; o.a = 2;`,
    `const o = {a:1}; delete o.a;`,
    `const o = {a:1}; Object.defineProperty(o, "b", {value:2});`,
    `const o = {a:1}; o.a++;`,
    `const o = {a:{b:1}}; o.a.b = 2;`,
  ];
  for (const body of bodies) {
    it(`无 "$nodoPos(...) =" 赋值：${body}`, () => {
      const src = transpileSource(`export function __run() {\n${body}\n}`, {
        recordPositions: true,
      });
      expect(/\$nodoPos\([^)]*\)\s*=[^=]/.test(src)).toBe(false);
    });
  }
});
