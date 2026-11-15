/**
 * Bug 918 —— `=> expected` 在「期望值不与 `=>` 同行」（形态 A）或「`=>` 后为空」
 * （形态 B）时，期望被**静默丢弃** ⇒ 该 case 判 `[unchecked]` ⇒ 断言**不执法**、
 * `nudo test` **exit 0**、**屏幕上零诊断**（完全静默的假绿）。
 *
 * 根因行：`packages/core/src/algebra/directive-scan.ts` 的 `extractCaseExpectedExpr`
 * —— 只取**同行**剩余；本行为空 ⇒ 直接放弃（形态 A）；`=>` 后为空 ⇒ 同样放弃
 * （形态 B），且**没有任何诊断**。
 *
 * 改后：
 * - 形态 A：往下找一行拿期望值；
 * - 形态 B：**产出行首锚的语法错**（`expectedIssue`）⇒ 消费方发
 *   `nudo:directive-syntax`（不再静默吞错）。
 */
import { describe, it, expect } from "vitest";
import { scanCaseTags } from "../directive-scan.ts";

describe("Bug 918 — `=> expected` 的排版不再让期望静默消失", () => {
  it("形态 A: 期望值在下一行 ⇒ 期望被抽出", () => {
    const text = '@nudo:case "multi" (2) =>\n *   4\n ';
    const tags = scanCaseTags(text);
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("4");
  });

  it("形态 A（无续行前缀）: 期望值在下一行 ⇒ 期望被抽出", () => {
    const text = '@nudo:case "multi" (2) =>\n4\n';
    const tags = scanCaseTags(text);
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("4");
  });

  it("形态 B: `=>` 后为空 ⇒ 没有期望，但**产出行首锚的语法错**（不再静默）", () => {
    const tags = scanCaseTags('@nudo:case "empty" (1) => ');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBeUndefined();
    expect(tags[0]!.expectedIssue).toBe("missing expected expression after '=>'");
  });

  it("形态 B（续行也没有值）: 同样产出行首锚的语法错", () => {
    const text = '@nudo:case "empty" (1) =>\n * @nudo:pure\n ';
    const tags = scanCaseTags(text);
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedIssue).toBe("missing expected expression after '=>'");
  });

  it("负控制: 同行形态照旧（期望被抽出、无语法错）", () => {
    const tags = scanCaseTags('@nudo:case "ok" (2) => 4');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("4");
    expect(tags[0]!.expectedIssue).toBeUndefined();
  });

  it("负控制: 没有 `=>` 的 case（本就无期望）不产语法错", () => {
    const tags = scanCaseTags('@nudo:case "plain" (1)');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBeUndefined();
    expect(tags[0]!.expectedIssue).toBeUndefined();
  });
});
