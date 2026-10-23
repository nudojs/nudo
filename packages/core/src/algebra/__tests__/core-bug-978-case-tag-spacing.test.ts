/**
 * Bug 978 —— `@nudo:case"c1" (1, 2)`（标签与名字之间**无空白**）⇒ 抽取侧（严格
 * `[ \t]+`）**不匹配** + 诊断侧（宽松 `[ \t]*`）**判合法** ⇒ 整条 case **静默
 * 蒸发** ⇒ `nudo test` 一个 case 都不跑、**零诊断**（假绿）。
 *
 * 根因：`CASE_NAME_REGEX`（抽取）与 `CASE_TAG_REGEX`（诊断）**文法不一致**；
 * `scanMalformedCaseTagRests` 的畸形判据**没跟抽取侧的真实文法对齐**。
 *
 * 改后：两条正则**共用同一段文法**（宽松侧**捕获分隔空白**），诊断侧按「标签后
 * 没有空白 ⇒ 畸形」判定 ⇒ 粘连写法**看得见**（口径与族 28 的 Bug 980 一致）。
 */
import { describe, it, expect } from "vitest";
import { scanCaseTags, scanMalformedCaseTagRests } from "../directive-scan.ts";

describe("Bug 978 — 粘连写法 `@nudo:case\"c1\"` 不再静默蒸发", () => {
  it("粘连写法: 不被抽成 case（抽取侧要求 `[ \\t]+`）", () => {
    const tags = scanCaseTags('@nudo:case"c1" (1, 2)');
    expect(tags).toEqual([]);
  });

  it("粘连写法: 在诊断面**看得见**（畸形剩余文本非空）", () => {
    const rests = scanMalformedCaseTagRests('@nudo:case"c1" (1, 2)');
    expect(rests).toEqual(['"c1" (1, 2)']);
  });

  it("负控制: 规范形态照旧被抽成 case、且不产畸形剩余", () => {
    const tags = scanCaseTags('@nudo:case "c1" (1, 2)');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.name).toBe("c1");
    expect(tags[0]!.argsText).toBe("1, 2");
    expect(scanMalformedCaseTagRests('@nudo:case "c1" (1, 2)')).toEqual([]);
  });

  it("负控制: 其它畸形形态仍被诊断面看见", () => {
    expect(scanMalformedCaseTagRests("@nudo:case 'c1' (1, 2)")).toEqual(["'c1' (1, 2)"]);
  });
});
