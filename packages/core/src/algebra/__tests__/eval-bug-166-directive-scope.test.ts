/**
 * Bug 166 回归（core 转译层）：@nudo:as / @nudo:replace 的作用范围按
 * **AST 节点身份**（源文本字符区间）判定，不是「同一行号窗口」。
 *
 * 修复前：`matchAsOverride` / `matchReplacement` 只看行号
 * （`line >= stmtStart && line <= stmtEnd`）→ 同一行号窗口里的其它子表达式
 * （同行下一条语句、嵌套块、嵌套函数体）被误覆盖/误替换。
 *
 * 修复后：登记的是**具体节点**的字符区间 → 只有那个节点命中。
 * 负控制钉住：被登记的节点**仍**被覆盖/替换（本次修复不削弱指令效果）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { $lit } from "../exec/runtime/state.ts";
import { litValue, type Abs } from "@nudojs/core";

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

/** `= <ident>;` 里的标识符区间（该语句的绑定名节点） */
function identRangeOf(src: string, needle: string): { start: number; end: number } {
  const at = src.indexOf(needle);
  if (at < 0) throw new Error(`needle not found: ${needle}`);
  const start = at + 2; // "= " 之后
  return { start, end: start + 1 };
}

describe("Bug 166: 指令作用范围按 AST 节点身份（字符区间）", () => {
  it("@nudo:as 只覆盖被登记的那条语句（同行下一条不受影响）", () => {
    const src = `export function f(a) {
  const x = a; const y = a;
  return y;
}
`;
    const first = rangeOf(src, "const x = a;");
    const exports = runTranspiled(src, {
      mode: "analyze",
      asOverrides: { __as0: $lit("s") as Abs },
      asOverrideTargets: [{ varName: "__as0", stmtStart: first.start, stmtEnd: first.end }],
    });
    const rec = callTranspiledExportFull(exports, "f", [$lit(5) as Abs]);
    // 被登记的是第一条语句 → 第二条（const y = a）**未**被覆盖 → 返回 a 的值 5
    expect(lit(rec.result)).toBe(5);
  });

  it("@nudo:as 仍覆盖被登记的那条语句（负控制）", () => {
    const src = `export function f(a) {
  const x = a; const y = a;
  return y;
}
`;
    const second = rangeOf(src, "const y = a;");
    const exports = runTranspiled(src, {
      mode: "analyze",
      asOverrides: { __as0: $lit("s") as Abs },
      asOverrideTargets: [{ varName: "__as0", stmtStart: second.start, stmtEnd: second.end }],
    });
    const rec = callTranspiledExportFull(exports, "f", [$lit(5) as Abs]);
    expect(lit(rec.result)).toBe("s");
  });

  it("@nudo:replace 只命中被登记的那个节点（同行同文本的兄弟节点不受影响）", () => {
    const src = `export function f(a) {
  const x = a; const y = a;
  return x * 10 + y;
}
`;
    const first = identRangeOf(src, "= a;");
    const exports = runTranspiled(src, {
      mode: "analyze",
      replacements: { __rep0: $lit(100) as Abs },
      replacementTargets: [
        { target: "a", varName: "__rep0", stmtStart: first.start, stmtEnd: first.end },
      ],
    });
    const rec = callTranspiledExportFull(exports, "f", [$lit(5) as Abs]);
    // 只有第一条语句的 a 被替换 → 100 * 10 + 5
    expect(lit(rec.result)).toBe(1005);
  });

  it("@nudo:replace 仍替换被登记的那个节点（负控制：兄弟节点不被波及）", () => {
    const src = `export function f(a) {
  const x = a; const y = a;
  return x * 10 + y;
}
`;
    const secondStart = src.lastIndexOf("= a;") + 2;
    const exports = runTranspiled(src, {
      mode: "analyze",
      replacements: { __rep0: $lit(100) as Abs },
      replacementTargets: [
        { target: "a", varName: "__rep0", stmtStart: secondStart, stmtEnd: secondStart + 1 },
      ],
    });
    const rec = callTranspiledExportFull(exports, "f", [$lit(5) as Abs]);
    // 只有第二条语句的 a 被替换 → 5 * 10 + 100
    expect(lit(rec.result)).toBe(150);
  });
});
