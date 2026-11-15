/**
 * Bug 846 —— **畸形**的 `@nudo:case` 不登记**参数区间掩码** ⇒ case 参数里的
 * `@nudo:mock` / `@nudo:skip` **泄漏**成真指令 ⇒ 假红 / d.ts 丢方法。
 *
 * 根因：`scanCaseArgSpans` 只登记**合法** case 形态（双引号名 + 同行实参括号）的
 * 区间；畸形形态（单引号名 / 空名 / 缺括号…）的实参区间没被遮罩。
 *
 * 修复：畸形 case 也登记实参区间（**只遮罩实参、不遮罩标签本身**——标签本身仍要报
 * 「畸形 case 名」诊断）。
 */
import { describe, it, expect } from "vitest";
import { scanCaseArgSpans } from "../directive-scan.ts";

const MALFORMED = `\n * @nudo:case 'bad' (\n *   @nudo:mock fetch = (u) => ({ ok: true }))\n`;

describe("Bug 846: malformed @nudo:case argument regions are masked too", () => {
  it("the argument region of a malformed case is registered as a span", () => {
    const spans = scanCaseArgSpans(MALFORMED);
    expect(spans).toHaveLength(1);
    const mockIdx = MALFORMED.indexOf("@nudo:mock");
    expect(spans.some(([s, e]) => mockIdx >= s && mockIdx < e)).toBe(true);
  });

  it("the tag itself is NOT masked (the malformed-name diagnostic still fires)", () => {
    const spans = scanCaseArgSpans(MALFORMED);
    const tagIdx = MALFORMED.indexOf("@nudo:case");
    expect(spans.some(([s, e]) => tagIdx >= s && tagIdx < e)).toBe(false);
  });

  it("a well-formed case still masks its whole tag+arguments region", () => {
    const text = `\n * @nudo:case "ok" (\n *   1)\n`;
    const spans = scanCaseArgSpans(text);
    expect(spans).toHaveLength(1);
    const tagIdx = text.indexOf("@nudo:case");
    expect(spans.some(([s, e]) => tagIdx >= s && tagIdx < e)).toBe(true);
  });

  it("a case without an argument list registers no span", () => {
    expect(scanCaseArgSpans(`\n * @nudo:case "ok"\n`)).toEqual([]);
  });
});
