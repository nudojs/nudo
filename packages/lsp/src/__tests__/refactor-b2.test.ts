/**
 * B2 金标：内联变量 / 签名改可选。
 */
import { describe, it, expect } from "vitest";
import { inlineVariableAt, makeParamOptionalAt } from "../refactor-b2.ts";

describe("B2 refactor.inline", () => {
  it("inlines a pure local and removes the declaration", () => {
    const src = `function f() {\n  const n = 1 + 2;\n  return n + n;\n}\n`;
    // 光标在 `n`（line 2, col 8）
    const r = inlineVariableAt(src, 2, 8);
    expect(r && "edits" in r).toBe(true);
    if (!r || !("edits" in r)) return;
    expect(r.title).toContain("Inline variable 'n'");
    expect(r.title).toContain("2 use");
    const replaced = r.edits.filter((e) => e.newText.includes("1 + 2"));
    expect(replaced.length).toBe(2);
    const deleted = r.edits.find((e) => e.newText === "");
    expect(deleted).toBeDefined();
    expect(deleted!.range.start.character).toBe(0);
  });

  it("rejects impure init (call)", () => {
    const src = `function f() {\n  const n = g();\n  return n;\n}\n`;
    const r = inlineVariableAt(src, 2, 8);
    expect(r).toBeNull();
  });

  it("rejects reassigned binding", () => {
    const src = `function f() {\n  let n = 1;\n  n = 2;\n  return n;\n}\n`;
    const r = inlineVariableAt(src, 2, 6);
    expect(r).toBeNull();
  });
});

describe("B2 refactor.rewrite — make param optional", () => {
  it("adds default undefined to a parameter", () => {
    const src = `function f(a, b) {\n  return a + b;\n}\n`;
    // 光标在 `b`（line 1, col 14）
    const r = makeParamOptionalAt(src, 1, 14);
    expect(r && "edits" in r).toBe(true);
    if (!r || !("edits" in r)) return;
    expect(r.title).toContain("make 'b' optional");
    expect(r.edits[0]!.newText).toBe("b = undefined");
    expect(r.edits[0]!.range.start.line).toBe(0);
  });

  it("ignores a non-parameter identifier", () => {
    const src = `function f(a) {\n  return a;\n}\n`;
    const r = makeParamOptionalAt(src, 2, 9);
    expect(r).toBeNull();
  });
});
