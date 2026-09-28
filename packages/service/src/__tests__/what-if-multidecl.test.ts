/**
 * what-if 注入回归：
 * 1) splitTopLevelUnion 不得在字符串内切 `|`（`number | "a|b"` 是两个成员）；
 * 2) 多声明符 `const a=1, b=2` 必须拆成独立语句再注入——否则一个 `@nudo:as`
 *    会盖住全部 Identifier init（漏到兄弟声明符），且只能表达一个类型。
 * 3) 引号内 `\` 不是转义（与 parseCaseArgExpr 原样 slice 一致）。
 */
import { describe, it, expect } from "vitest";
import { injectBindings, typeExprToDirective } from "../what-if.ts";

describe("what-if splitTopLevelUnion strings", () => {
  it("does not split | inside string members", () => {
    expect(typeExprToDirective('number | "a|b"')).toBe('union(number(), "a|b")');
    expect(typeExprToDirective('"a|b" | null')).toBe('union("a|b", null)');
    expect(typeExprToDirective(`number | 'x|y'`)).toBe(`union(number(), 'x|y')`);
  });

  it("treats backslash as raw (not escape) inside strings", () => {
    // `"a\"` 是完整字符串（原样 slice，值 `a\`），`|` 在引号外，应当切开
    expect(typeExprToDirective(String.raw`"a\" | number`)).toBe(
      String.raw`union("a\", number())`,
    );
  });

  it("still splits top-level | outside strings", () => {
    expect(typeExprToDirective("number | string")).toBe("union(number(), string())");
  });
});

describe("what-if multi-declarator injection", () => {
  it("applies distinct types to each declarator of const a=1, b=2", () => {
    const src = `const a = 1, b = 2;\nconst c = a + b;\n`;
    const { source, applied, unapplied } = injectBindings(src, [
      { name: "a", type: "string" },
      { name: "b", type: "number" },
    ]);
    expect(unapplied).toEqual([]);
    expect(applied).toEqual(["a: string", "b: number"]);
    expect(source).toContain("// @nudo:as string()");
    expect(source).toContain("// @nudo:as number()");
    // 拆开后各语句只带自己的 as
    const asLines = source.split("\n").filter((l) => l.includes("@nudo:as"));
    expect(asLines).toHaveLength(2);
  });

  it("does not leak a single binding onto sibling declarators", () => {
    const src = `const a = 1, b = 2;\n`;
    const { source, applied, unapplied } = injectBindings(src, [
      { name: "a", type: "string" },
    ]);
    expect(applied).toEqual(["a: string"]);
    expect(unapplied).toEqual([]);
    // b 必须拆成独立语句保留 init 2，不能被 @nudo:as string() 盖掉
    expect(source).toBe("// @nudo:as string()\nconst a = 1;\nconst b = 2;\n");
  });

  it("splits export multi-declarator keeping export on each", () => {
    const src = `export const a = 1, b = 2;\n`;
    const { source, applied } = injectBindings(src, [
      { name: "a", type: "string" },
      { name: "b", type: "boolean" },
    ]);
    expect(applied).toEqual(["a: string", "b: boolean"]);
    expect(source).toContain("export const a = 1;");
    expect(source).toContain("export const b = 2;");
  });

  it("keeps existing leading comments above the first split statement", () => {
    const src = `// keep me\nconst a = 1, b = 2;\n`;
    const { source } = injectBindings(src, [{ name: "b", type: "string" }]);
    expect(source).toContain("// keep me");
    expect(source).toContain("// @nudo:as string()");
    expect(source).toMatch(/\/\/ keep me\nconst a = 1;/);
  });
});
