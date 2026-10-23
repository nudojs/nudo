/**
 * Bug 420 —— 括号配平扫描器**不感知转义** ⇒ 双引号串里的 `\"` 被当成**字符串结束**
 * ⇒ 括号**提前闭合** ⇒ **整条 case 被丢弃**（只剩一条归因错误的「unclosed argument
 * list」警告）⇒ 断言从不运行、零见证（假绿）。
 *
 * 根因行：`packages/core/src/algebra/directive-scan.ts` 的 `extractBalancedParens`
 * —— 字符串感知，但 `\` 不当转义。
 *
 * 改后：配平**优先**按 JS 转义语义走（`\"` 不结束字符串）⇒ 括号配平正确 ⇒
 * 含转义引号的 case 被正常抽出、正常执法。
 *
 * ⚠ 口径边界（Bug 1009 钉住）：串**未闭合**（`"a\", -1` —— 非法 JS 串）时**回退**
 * 宽松口径（`\` 不是转义）⇒ 实参个数与共享单源保持一致。
 */
import { describe, it, expect } from "vitest";
import { extractBalancedParens, scanCaseTags } from "../directive-scan.ts";

describe("Bug 420 — 配平扫描器转义感知：转义引号不再吃掉整条 case", () => {
  it("extractBalancedParens: 双引号串里的 `\\\"` 不结束字符串", () => {
    const text = '("a\\"b")';
    expect(extractBalancedParens(text, 0)).toBe('"a\\"b"');
  });

  it("extractBalancedParens: 对象 / 数组字面量里的转义引号同样配平", () => {
    expect(extractBalancedParens('({ a: "x\\"y" })', 0)).toBe('{ a: "x\\"y" }');
    expect(extractBalancedParens('(["x\\"y"])', 0)).toBe('["x\\"y"]');
  });

  it("extractBalancedParens: 单引号串里的 `\\'` 不结束字符串", () => {
    expect(extractBalancedParens("('it\\'s')", 0)).toBe("'it\\'s'");
  });

  it("scanCaseTags: 含转义引号的 case 被抽出（改前整条被丢弃）", () => {
    const tags = scanCaseTags('@nudo:case "k" ("a\\"b") => 3');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.name).toBe("k");
    expect(tags[0]!.argsText).toBe('"a\\"b"');
    expect(tags[0]!.expectedText).toBe("3");
  });

  it("负控制（Bug 1009 口径保留）: 串未闭合时回退宽松口径 ⇒ 实参个数不变", () => {
    // `"a\", -1` 是**非法** JS 串（未闭合）⇒ 宽松口径切成 2 个实参
    expect(extractBalancedParens('("a\\", -1)', 0)).toBe('"a\\", -1');
    const tags = scanCaseTags('@nudo:case "c" ("a\\", -1)');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.argsText).toBe('"a\\", -1');
  });

  it("负控制: 无转义引号的普通实参不受影响", () => {
    expect(extractBalancedParens("(1, 2)", 0)).toBe("1, 2");
    expect(extractBalancedParens("(", 0)).toBeNull();
  });
});
