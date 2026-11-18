import { describe, it, expect } from "vitest";
import { injectBindings, typeExprToDirective } from "../what-if.ts";

describe("AI3 what-if injectBindings", () => {
  it("maps bare primitives to constraint builders", () => {
    expect(typeExprToDirective("number")).toBe("number()");
    expect(typeExprToDirective("string")).toBe("string()");
    expect(typeExprToDirective("number|string")).toBe("union(number(), string())");
  });

  it("injects @nudo:as above the declaring statement", () => {
    const src = `const x = 1;\nconst y = x + 1;\n`;
    const { source, applied, unapplied } = injectBindings(src, [
      { name: "x", type: "number" },
    ]);
    expect(applied).toEqual(["x: number"]);
    expect(unapplied).toEqual([]);
    expect(source).toContain("// @nudo:as number()");
  });

  it("reports unapplied when name is not a top-level declaration", () => {
    const { applied, unapplied } = injectBindings(`export function f() { return 1; }\n`, [
      { name: "nope", type: "number" },
    ]);
    expect(applied).toEqual([]);
    expect(unapplied).toEqual(["nope"]);
  });

  it("does not claim structural TS types were applied verbatim (BUG-099)", () => {
    const src = `const o = { a: 1 };\n`;
    for (const t of ["number[]", "{a:number}", "(a:number)=>string"]) {
      const { applied } = injectBindings(src, [{ name: "o", type: t }]);
      expect(applied[0]).toContain("is not expressible");
      expect(applied[0]).toContain("applied as unknown");
    }
    // 值字面量仍按原样表达（负控制：不误伤 `{a:1}`）
    const ok = injectBindings(src, [{ name: "o", type: "{a:1}" }]);
    expect(ok.applied).toEqual(["o: {a:1}"]);
  });

  it("does not mistake quoted payloads for structural TS types", () => {
    // 结构判定只看字符串外侧：`lit("items[]")` / `"number[]"` 里的 `[]` 是
    // 载荷文本（合法构建器实参 / 字符串字面量），不是数组类型语法。
    expect(typeExprToDirective('lit("items[]")')).toBe('lit("items[]")');
    expect(typeExprToDirective('"number[]"')).toBe('"number[]"');
    const src = `const o = { a: 1 };\n`;
    const { applied, source } = injectBindings(src, [
      { name: "o", type: 'lit("items[]")' },
    ]);
    expect(applied).toEqual(['o: lit("items[]")']);
    expect(source).toContain('// @nudo:as lit("items[]")');
  });

  it("reports function/class bindings as not applied instead of fake success (BUG-100)", () => {
    const src = `export function f() { return 1; }\nexport class K {}\n`;
    const { applied, unapplied, source } = injectBindings(src, [
      { name: "f", type: "number" },
      { name: "K", type: "object" },
    ]);
    expect(applied).toEqual([]);
    expect(unapplied).toEqual(["f", "K"]);
    expect(source).not.toContain("@nudo:as");
  });
});
