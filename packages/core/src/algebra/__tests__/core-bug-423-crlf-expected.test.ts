/**
 * Bug 423 —— CRLF 源文件里 `=> expected` 的期望值被**整条吞掉** ⇒ 该 case 判
 * `[unchecked]` ⇒ 断言**不执法**、`nudo test` **exit 0**、**屏幕上零诊断**（假绿）。
 *
 * 根因行：`packages/core/src/algebra/directive-scan.ts` 的 `extractCaseExpectedExpr`
 * —— 切行用 `split("\n")`，取行尾用 `.`（**不匹配 `\r`**）⇒ CRLF 的 `\r` 留在
 * 期望文本尾部 ⇒ 期望解析失败 ⇒ 期望被丢弃。
 *
 * 改后：切行按 `\r?\n`、行尾 `\r` 不再污染期望 ⇒ 期望被抽出 ⇒ 断言照常执法。
 */
import { describe, it, expect } from "vitest";
import { scanCaseTags } from "../directive-scan.ts";

describe("Bug 423 — CRLF 源文件里 `=> expected` 不再被吞掉", () => {
  it("CRLF: 期望被抽出（改前整条期望消失）", () => {
    const tags = scanCaseTags('@nudo:case "c" (1) => 999\r\n');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("999");
  });

  it("LF（负控制）: 期望照旧被抽出", () => {
    const tags = scanCaseTags('@nudo:case "c" (1) => 999\n');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("999");
  });

  it("CRLF: 块注释续行形态的期望同样被抽出", () => {
    const text = '*\r\n * @nudo:case "c" (1) => 999\r\n ';
    const tags = scanCaseTags(text);
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("999");
  });

  it("CRLF: 无期望的 case 不受影响（expectedText 仍为 undefined）", () => {
    const tags = scanCaseTags('@nudo:case "c" (1)\r\n');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBeUndefined();
  });
});
