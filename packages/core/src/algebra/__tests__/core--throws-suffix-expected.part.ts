/**
 * Bug 426 —— case 行上的 `!! throws [Kind]` **后缀**（文档化形态）被当**期望值文本**
 * ⇒ 期望**整条丢失**（后缀在 `=>` 之前：判 `[unchecked]`、零诊断）或**被腐蚀**
 * （后缀在 `=>` 之后：`1 !! throws` 解析失败 ⇒ 退化成「什么都接受」/ 假红）。
 *
 * 根因行：`packages/core/src/algebra/directive-scan.ts` 的 `extractCaseExpectedExpr`
 * —— 期望文本 = `=>` 之后的原始剩余，**不认** `!! throws` 后缀。
 *
 * 改后：**只**在**期望表达式文本**里剥后缀 ⇒ 期望不再被顶掉/腐蚀。
 *
 * ⚠ 硬规则（回归护栏）：**不得改写 case 行本身** ⇒ 函数级 `!! throws` 申报
 * （`scanThrowsDecl` 读的是**原文行**）必须**照旧**看得见后缀。
 */
import { describe, it, expect } from "vitest";
import { scanCaseTags, scanThrowsDecl } from "../directive-scan.ts";

describe("Bug 426 — `!! throws [Kind]` 后缀不再吃掉期望值", () => {
  it("后缀在 `=>` 之前: 期望照旧被抽出（改前整条期望消失）", () => {
    const tags = scanCaseTags('@nudo:case "a" (0) !! throws => 1');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("1");
  });

  it("后缀在 `=>` 之后: 期望文本不被腐蚀（改前是 `1 !! throws`）", () => {
    const tags = scanCaseTags('@nudo:case "b" (0) => 1 !! throws');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("1");
  });

  it("后缀带 kind: 期望文本只剩期望本身", () => {
    const tags = scanCaseTags('@nudo:case "c" (0) => 1 !! throws TypeError');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("1");
  });

  it("文档化形态（只有后缀、没有 `=>`）: 没有期望（后缀是**申报**不是期望）", () => {
    const tags = scanCaseTags('@nudo:case "neg" (0) !! throws');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBeUndefined();
  });

  it("回归护栏: case 行本身不被改写 ⇒ `!! throws` 后缀申报仍在", () => {
    // 片 4 的 case 后缀申报读的是**原文行**——426 只在期望文本的局部副本上剥后缀
    const lines = ['@nudo:case "neg" (0) !! throws'];
    expect(scanThrowsDecl(lines)).toBe("*");
  });

  it("回归护栏: 后缀在 `=>` 之后时**申报口径不变**（既有约定：后缀须紧跟实参括号）", () => {
    // Bug 1033 收紧后的口径：后缀申报只在**实参括号闭合之后**、紧邻 `!! throws`
    // 时产出 ⇒ `=> 1 !! throws` **本来就没有**申报（改前改后一致）
    const lines = ['@nudo:case "b" (0) => 1 !! throws'];
    expect(scanThrowsDecl(lines)).toBeUndefined();
  });
});
