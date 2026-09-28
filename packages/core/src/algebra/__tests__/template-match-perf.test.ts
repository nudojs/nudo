/**
 * templateMatchesValue 多抽象间隙不得指数回溯。
 * 回归背景：每个抽象 gap 枚举全部分割点、且无记忆化，
 * `${x0}a${x1}a…` 匹配长串时状态空间爆炸（O(n^k)）。
 */
import { describe, it, expect } from "vitest";
import {
  templateMatchesValue,
  viewTemplateParts,
  type TemplatePartDesc,
} from "../template.ts";

function viewsOf(descs: TemplatePartDesc[]) {
  return viewTemplateParts(descs, (d) => d);
}

describe("templateMatchesValue performance", () => {
  it("many abstract parts on a long string stays polynomial", () => {
    // ${x0}a${x1}a…${x7}a${x8}Z — 8 个间隙 + 长串；无记忆化时 O(n^k) ~ 2s
    const descs: TemplatePartDesc[] = [];
    for (let i = 0; i < 8; i++) {
      descs.push({ render: `x${i}` }, { fixed: "a" });
    }
    descs.push({ render: "tail" }, { fixed: "Z" });
    const views = viewsOf(descs);
    const value = "a".repeat(40) + "b";
    const start = Date.now();
    expect(templateMatchesValue(value, views)).toBe(false);
    expect(Date.now() - start).toBeLessThan(200);
  });

  it("positive long-string case also stays fast", () => {
    const descs: TemplatePartDesc[] = [];
    for (let i = 0; i < 8; i++) {
      descs.push({ render: `x${i}` }, { fixed: "a" });
    }
    descs.push({ render: "tail" }, { fixed: "a" });
    const views = viewsOf(descs);
    const value = "a".repeat(40);
    const start = Date.now();
    expect(templateMatchesValue(value, views)).toBe(true);
    expect(Date.now() - start).toBeLessThan(200);
  });

  it("still matches correctly with memoized search", () => {
    const views = viewsOf([{ render: "x" }, { fixed: "abc" }]);
    expect(templateMatchesValue("abcabc", views)).toBe(true);
    expect(templateMatchesValue("abc", views)).toBe(true);
    expect(templateMatchesValue("ab", views)).toBe(false);

    const mid = viewsOf([{ fixed: "a" }, { render: "x" }, { fixed: "b" }]);
    expect(templateMatchesValue("ab", mid)).toBe(true);
    expect(templateMatchesValue("axxb", mid)).toBe(true);
    expect(templateMatchesValue("axx", mid)).toBe(false);
    expect(templateMatchesValue("xb", mid)).toBe(false);
  });
});
