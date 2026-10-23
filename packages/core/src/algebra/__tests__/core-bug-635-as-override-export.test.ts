/**
 * Bug 635 回归（core 转译层）：`@nudo:as` 写在 **export 包装**形态的声明
 * 前面时，覆盖必须命中**内层声明**。
 *
 * 病灶：指令的**载体节点**是 `ExportNamedDeclaration`（Babel 把前置注释挂
 * 在 export 语句上），而转译面拿到的声明节点是**内层** `VariableDeclaration`
 * ⇒ 两个字符区间不重合 ⇒ `matchAsOverride` 匹配不到 ⇒ 工具打印
 * 「Bindings applied」却类型不变（假成功）。
 *
 * 修法（packages/core/src/algebra/exec/transpile/helpers.ts）：补一条
 * 「export 前缀」匹配——**尾端相同**（export 语句与其内层声明同一处结尾）
 * + **前缀恰是 export 引导词**（`export ` / `export default `）⇒ 命中。
 *
 * 负控制：① 非 export 形态仍按精确区间命中；② **非** export 引导词的同尾
 * 区间不得误命中（fail-closed）。
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
function rangeOf(src: string, needle: string): { start: number; end: number } {
  const start = src.indexOf(needle);
  if (start < 0) throw new Error(`needle not found: ${needle}`);
  return { start, end: start + needle.length };
}

describe("Bug 635: export 包装形态的 @nudo:as 覆盖命中内层声明", () => {
  it("export const：登记区间 = export 语句 ⇒ 内层声明被覆盖", () => {
    const src = `export const raw = 1;\n`;
    const target = rangeOf(src, "export const raw = 1;");
    const exports = runTranspiled(src, {
      mode: "analyze",
      asOverrides: { __as0: $lit("s") as Abs },
      asOverrideTargets: [{ varName: "__as0", stmtStart: target.start, stmtEnd: target.end }],
    });
    const rec = callTranspiledExportFull(exports, "raw", []);
    expect(lit(rec.result)).toBe("s");
  });

  it("export let / export var：登记区间 = export 语句 ⇒ 内层声明被覆盖", () => {
    const src = `export let raw = 1;\n`;
    const target = rangeOf(src, "export let raw = 1;");
    const exports = runTranspiled(src, {
      mode: "analyze",
      asOverrides: { __as0: $lit("s") as Abs },
      asOverrideTargets: [{ varName: "__as0", stmtStart: target.start, stmtEnd: target.end }],
    });
    const rec = callTranspiledExportFull(exports, "raw", []);
    expect(lit(rec.result)).toBe("s");
  });

  it("负控制：非 export 形态仍按精确区间命中（行为不退化）", () => {
    const src = `const raw = 1;\nexport function useRaw() { return raw; }\n`;
    const target = rangeOf(src, "const raw = 1;");
    const exports = runTranspiled(src, {
      mode: "analyze",
      asOverrides: { __as0: $lit("s") as Abs },
      asOverrideTargets: [{ varName: "__as0", stmtStart: target.start, stmtEnd: target.end }],
    });
    const rec = callTranspiledExportFull(exports, "useRaw", []);
    expect(lit(rec.result)).toBe("s");
  });

  it("负控制：同尾但**非** export 前缀的区间不得误命中（fail-closed）", () => {
    const src = `/*x*/ const raw = 1;\nexport function useRaw() { return raw; }\n`;
    const stmt = rangeOf(src, "const raw = 1;");
    // 登记区间从头开始（与内层声明同尾，但前缀是块注释，不是 export 引导词）
    const exports = runTranspiled(src, {
      mode: "analyze",
      asOverrides: { __as0: $lit("s") as Abs },
      asOverrideTargets: [{ varName: "__as0", stmtStart: 0, stmtEnd: stmt.end }],
    });
    const rec = callTranspiledExportFull(exports, "useRaw", []);
    // 未被覆盖 ⇒ 仍是字面量 1（而不是 "s"）
    expect(lit(rec.result)).toBe(1);
  });
});
