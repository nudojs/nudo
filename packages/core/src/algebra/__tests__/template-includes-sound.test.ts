/**
 * 模板 includes / matches 不得跨抽象间隙假精确。
 * 回归背景：
 * 1) decideIncludes 用 allFixedTextOfViews 把固定段拼在一起，
 *    `a${x}b` 的固定文本是 "ab"，于是 includes("ab") 折 true——
 *    但 x="zz" 时 "azzb" 并不包含 "ab"。
 * 2) templateMatchesValue 无回溯：`${x}abc` 匹配 "abcabc" 为 false；
 *    相邻抽象 part 直接 return true：`${x}${y}abc` 匹配 "hello" 为 true。
 */
import { describe, it, expect } from "vitest";
import {
  decideIncludes,
  decideStartsWith,
  decideEndsWith,
  templateMatchesValue,
  fixedRunsOfViews,
  viewTemplateParts,
  type TemplatePartDesc,
} from "../template.ts";

function viewsOf(descs: TemplatePartDesc[]) {
  return viewTemplateParts(descs, (d) => d);
}

describe("template includes / matches soundness", () => {
  it("includes across abstract gap is not exact true", () => {
    // "a" + x + "b" 的固定段是 ["a","b"]，不得断定 includes("ab")
    expect(decideIncludes(["a", "b"], "ab")).toBe("unknown");
  });

  it("includes within a single fixed run is true", () => {
    // 固定段 "hello" 自身包含 "ell"
    expect(decideIncludes(["hello"], "ell")).toBe(true);
  });

  it("includes empty search is true", () => {
    expect(decideIncludes(["a", "b"], "")).toBe(true);
    expect(decideIncludes([], "")).toBe(true);
  });

  it("includes with no fixed run containing search is unknown", () => {
    expect(decideIncludes([], "x")).toBe("unknown");
    expect(decideIncludes(["ab", "cd"], "bc")).toBe("unknown");
  });

  it("fixedRunsOfViews splits on abstract parts", () => {
    const views = viewsOf([
      { fixed: "a" },
      { render: "x" },
      { fixed: "b" },
      { render: "y" },
    ]);
    expect(fixedRunsOfViews(views)).toEqual(["a", "b"]);
    const allFixed = viewsOf([{ fixed: "hello" }]);
    expect(fixedRunsOfViews(allFixed)).toEqual(["hello"]);
  });

  it("startsWith / endsWith stay restricted to prefix/suffix", () => {
    expect(decideStartsWith("hello", "he")).toBe(true);
    expect(decideStartsWith("he", "hello")).toBe("unknown");
    expect(decideStartsWith("hello", "xx")).toBe(false);
    expect(decideEndsWith("hello", "lo")).toBe(true);
    expect(decideEndsWith("lo", "hello")).toBe("unknown");
  });

  it("templateMatchesValue: trailing fixed can match later occurrence", () => {
    // ${x}abc vs "abcabc" — x="abc" 合法
    const views = viewsOf([{ render: "x" }, { fixed: "abc" }]);
    expect(templateMatchesValue("abcabc", views)).toBe(true);
    expect(templateMatchesValue("abc", views)).toBe(true);
    expect(templateMatchesValue("ab", views)).toBe(false);
    expect(templateMatchesValue("abcd", views)).toBe(false);
  });

  it("templateMatchesValue: adjacent abstracts do not short-circuit true", () => {
    // ${x}${y}abc vs "hello" — 必须以 abc 结尾
    const views = viewsOf([{ render: "x" }, { render: "y" }, { fixed: "abc" }]);
    expect(templateMatchesValue("hello", views)).toBe(false);
    expect(templateMatchesValue("zzabc", views)).toBe(true);
  });

  it("templateMatchesValue: leading and middle fixed still match", () => {
    const views = viewsOf([{ fixed: "a" }, { render: "x" }, { fixed: "b" }]);
    expect(templateMatchesValue("ab", views)).toBe(true);
    expect(templateMatchesValue("axxb", views)).toBe(true);
    expect(templateMatchesValue("axx", views)).toBe(false);
    expect(templateMatchesValue("xb", views)).toBe(false);
  });
});
