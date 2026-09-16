/**
 * case 实参约束表达式文法（design-refine-derivation：T.* → number()/lit()/…）。
 * parseTypeValueExpr 双文法：约束构建器优先，T.* / 字面量 / 箭头函数兼容。
 */
import { describe, it, expect } from "vitest";
import { extractDirectives, parseTypeValueExpr, parseCaseArgExpr } from "../directives.ts";
import { typeValueToString, formatAbs, T, typeValueEquals, litValue, type Abs, type TypeValue } from "@nudojs/core";
import { parse } from "../parse.ts";

describe("parseTypeValueExpr constraint grammar", () => {
  it("number() → number", () => {
    expect(typeValueEquals(parseTypeValueExpr("number()"), T.number)).toBe(true);
  });

  it("string() / boolean()", () => {
    expect(typeValueEquals(parseTypeValueExpr("string()"), T.string)).toBe(true);
    expect(typeValueEquals(parseTypeValueExpr("boolean()"), T.boolean)).toBe(true);
  });

  it("lit(42) / lit(\"a\")", () => {
    expect(typeValueToString(parseTypeValueExpr("lit(42)"))).toBe("42");
    expect(typeValueToString(parseTypeValueExpr('lit("a")'))).toBe('"a"');
  });

  it("number().gt(0) carries pred through Abs bridge", () => {
    const { abs } = parseCaseArgExpr("number().gt(0)");
    expect(abs).toBeDefined();
    expect(formatAbs(abs!)).toContain(">");
    expect(formatAbs(abs!)).toContain("0");
  });

  it("union(lit(1), lit(2))", () => {
    const s = typeValueToString(parseTypeValueExpr("union(lit(1), lit(2))"));
    expect(s).toContain("1");
    expect(s).toContain("2");
  });

  it("shape({ id: number() })", () => {
    const { abs } = parseCaseArgExpr("shape({ id: number() })");
    expect(abs?.shape.k).toBe("obj");
  });

  it("array(number())", () => {
    const { abs } = parseCaseArgExpr("array(number())");
    expect(abs?.shape.k).toBe("arr");
  });

  it("T.* still works (compat)", () => {
    expect(typeValueEquals(parseTypeValueExpr("T.number"), T.number)).toBe(true);
    expect(typeValueToString(parseTypeValueExpr("42"))).toBe("42");
  });

  it("extractDirectives always fills argsAbs (constraint + T.*)", () => {
    const src = `
/**
 * @nudo:case "n" (number())
 * @nudo:case "lit" (lit(7))
 * @nudo:case "tv" (T.number)
 */
function id(x) { return x; }
`;
    const fns = extractDirectives(parse(src));
    const cases = fns[0]!.directives.filter((d) => d.kind === "case") as Array<{
      name: string;
      argsAbs: Abs[];
    }>;
    expect(cases).toHaveLength(3);
    for (const c of cases) {
      expect(c.argsAbs).toBeDefined();
      expect(c.argsAbs).toHaveLength(1);
    }
  });

  it("constraint expressions produce Abs without TypeValue on the directive", () => {
    const src = `
/**
 * @nudo:case "lit" (lit(7))
 */
function id(x) { return x; }
`;
    const fns = extractDirectives(parse(src));
    const c = fns[0]!.directives.find((d) => d.kind === "case") as {
      argsAbs: Abs[];
      args?: unknown;
    };
    expect(litValue(c.argsAbs[0]!)).toBe(7);
    expect(c.args).toBeUndefined();
  });

  it("T.* cases produce prim Abs via bridge", () => {
    const src = `
/**
 * @nudo:case "n" (T.number)
 */
function id(x) { return x; }
`;
    const fns = extractDirectives(parse(src));
    const c = fns[0]!.directives.find((d) => d.kind === "case") as {
      argsAbs: Abs[];
    };
    expect(c.argsAbs[0]!.shape.k).toBe("prim");
    if (c.argsAbs[0]!.shape.k === "prim") {
      expect(c.argsAbs[0]!.shape.type).toBe("number");
    }
  });
});
