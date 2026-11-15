/**
 * Bug 165 回归（core 转译层）：@nudo:replace 命中的子表达式**仍要求值**。
 *
 * 修复前：命中节点被**整段替换**成注入变量 → 原表达式从不求值 →
 * ① 副作用归零（`bump()` 不被调用）；② 抛错域消失（`JSON.parse` 的
 * TypeError 被吞 → L2 门禁假绿）。
 *
 * 修复后：发射 `(原表达式, 注入值)`——原表达式求值一次（副作用与 throws
 * 域保留），**结果**取注入值。
 *
 * 负控制钉住：未被标注的相邻子表达式照常求值（`b` 不受影响）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { $lit } from "../exec/runtime/state.ts";
import { abs, litValue, pTrue, type Abs } from "@nudojs/core";
import { throwsError } from "./eval-helpers.ts";

/** 注入值：exact number（类型覆盖面） */
const NUMBER_ABS: Abs = abs({ k: "prim", type: "number" }, undefined, pTrue, "exact");

/** 结果字面量值（非字面量 → "not-lit"） */
function lit(a: Abs): unknown {
  const r = litValue(a);
  return r.ok ? r.value : "not-lit";
}

/** 源文本中某个片段的字符区间（AST 节点身份） */
function rangeOf(src: string, needle: string, len = needle.length): { start: number; end: number } {
  const start = src.indexOf(needle);
  if (start < 0) throw new Error(`needle not found: ${needle}`);
  return { start, end: start + len };
}

/** 带注入表转译 + 调用导出函数 */
function callInjected(
  src: string,
  fnName: string,
  args: Abs[],
  inject: {
    replacements?: Record<string, Abs>;
    replacementTargets?: Array<{ target: string; varName: string; stmtStart: number; stmtEnd: number }>;
  },
) {
  const exports = runTranspiled(src, { mode: "analyze", ...inject });
  return callTranspiledExportFull(exports, fnName, args);
}

describe("Bug 165: @nudo:replace 命中的子表达式仍求值", () => {
  it("被替换的调用仍被调用（副作用保留）", () => {
    const src = `let counter = 0;
function bump() { counter = counter + 1; return counter; }
export function f() {
  const x = bump();
  return counter;
}
`;
    const r = rangeOf(src, "bump();");
    const rec = callInjected(src, "f", [], {
      replacements: { __rep0: NUMBER_ABS },
      replacementTargets: [
        { target: "bump()", varName: "__rep0", stmtStart: r.start, stmtEnd: r.end },
      ],
    });
    // 修复前：bump() 整段被替换 → 从不调用 → counter 停在 0
    expect(lit(rec.result)).toBe(1);
  });

  it("被替换的调用的抛错域保留（throws 面不被吞）", () => {
    const src = `export function f() {
  const x = boom();
  return x;
}
function boom() { throw new TypeError("boom"); }
`;
    const r = rangeOf(src, "boom();");
    const rec = callInjected(src, "f", [], {
      replacements: { __rep0: NUMBER_ABS },
      replacementTargets: [
        { target: "boom()", varName: "__rep0", stmtStart: r.start, stmtEnd: r.end },
      ],
    });
    // 修复前：boom() 整段被替换 → 不抛 → throws 面空
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("负控制：未被标注的相邻子表达式照常求值", () => {
    const src = `export function f(a, b) {
  const x = a + b;
  return x;
}
`;
    // 标注的是 `a + b` 里的左操作数 `a`（节点身份 = 该标识符的字符区间）
    const r = rangeOf(src, "a + b", 1);
    const rec = callInjected(src, "f", [$lit(5) as Abs, $lit(10) as Abs], {
      replacements: { __rep0: $lit(100) as Abs },
      replacementTargets: [
        { target: "a", varName: "__rep0", stmtStart: r.start, stmtEnd: r.end },
      ],
    });
    // a → 100（注入值），b → 10（照常求值）
    expect(lit(rec.result)).toBe(110);
  });

  it("替换结果取注入值（原表达式的值被取代）", () => {
    const src = `export function f(a) {
  const x = a + 1;
  return x;
}
`;
    const r = rangeOf(src, "a + 1", 1);
    const rec = callInjected(src, "f", [$lit(5) as Abs], {
      replacements: { __rep0: $lit(100) as Abs },
      replacementTargets: [
        { target: "a", varName: "__rep0", stmtStart: r.start, stmtEnd: r.end },
      ],
    });
    expect(lit(rec.result)).toBe(101);
  });
});
