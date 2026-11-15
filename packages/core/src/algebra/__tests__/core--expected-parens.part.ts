/**
 * Bug 427 —— 期望表达式带**一层冗余括号**（`=> (999)` / `=> ("a")` / `=> ({ b: 1 })`）
 * ⇒ 期望解析失败 ⇒ 断言退化成「什么都接受」（空洞通过）或**恒假红**
 * ⇒ case 形同虚设。
 *
 * 根因行：`packages/core/src/algebra/directive-scan.ts` 的 `extractCaseExpectedExpr`
 * —— 期望文本 = `=>` 之后的原始剩余（**不剥**外层括号），而实参侧
 * （`extractBalancedParens`）**剥**外层括号 ⇒ 两面口径不一致。
 *
 * 改后：期望文本剥**外层冗余括号**（与实参侧同口径）；箭头函数
 * （`(x) => y`）**不受影响**。
 */
import { describe, it, expect } from "vitest";
import { scanCaseTags } from "../directive-scan.ts";

describe("Bug 427 — 期望表达式的冗余括号被剥掉", () => {
  it("数字字面量: `=> (999)` ⇒ `999`", () => {
    const tags = scanCaseTags('@nudo:case "a" (1) => (999)');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("999");
  });

  it("字符串字面量: `=> (\"abc\")` ⇒ `\"abc\"`", () => {
    const tags = scanCaseTags('@nudo:case "a" (1) => ("abc")');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe('"abc"');
  });

  it("对象字面量: `=> ({ b: 1 })` ⇒ `{ b: 1 }`", () => {
    const tags = scanCaseTags('@nudo:case "a" ({ a: 1 }) => ({ b: 1 })');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("{ b: 1 }");
  });

  it("元组字面量: `=> ([1, 2])` ⇒ `[1, 2]`", () => {
    const tags = scanCaseTags('@nudo:case "a" (1) => ([1, 2])');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("[1, 2]");
  });

  it("多层括号: 逐层剥到表达式本体", () => {
    const tags = scanCaseTags('@nudo:case "a" (1) => ((999))');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("999");
  });

  it("负控制: 无括号形态不受影响", () => {
    const tags = scanCaseTags('@nudo:case "a" (1) => 999');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("999");
  });

  it("负控制: 箭头函数不被误剥（`(x) => y` 的括号不是冗余层）", () => {
    const tags = scanCaseTags('@nudo:case "a" (1) => (x) => x + 1');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("(x) => x + 1");
  });
});
