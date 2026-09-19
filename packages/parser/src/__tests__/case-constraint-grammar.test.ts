/**
 * case 实参约束表达式文法（design-refine-derivation：唯一文法）。
 * parseCaseArgExpr：约束构建器优先，其余为具体字面量 / 结构字面量 / 箭头函数。
 * `T.*` 文法已物理删除。
 */
import { describe, it, expect } from "vitest";
import { extractDirectives, parseCaseArgExpr } from "../directives.ts";
import { formatAbs, litValue, type Abs, num, str, bool } from "@nudojs/core";
import { parse } from "../parse.ts";

describe("parseCaseArgExpr constraint grammar", () => {
  it("number() → number", () => {
    expect(parseCaseArgExpr("number()").shape).toEqual(num().shape);
  });

  it("string() / boolean()", () => {
    expect(parseCaseArgExpr("string()").shape).toEqual(str().shape);
    expect(parseCaseArgExpr("boolean()").shape).toEqual(bool().shape);
  });

  it("lit(42) / lit(\"a\")", () => {
    expect(litValue(parseCaseArgExpr("lit(42)"))).toBe(42);
    expect(litValue(parseCaseArgExpr('lit("a")'))).toBe("a");
  });

  it("concrete literals parse without builders", () => {
    expect(litValue(parseCaseArgExpr("42"))).toBe(42);
    expect(litValue(parseCaseArgExpr("null"))).toBe(null);
    expect(litValue(parseCaseArgExpr("undefined"))).toBe(undefined);
    expect(parseCaseArgExpr("never").shape.k).toBe("never");
  });

  it("number().gt(0) carries pred through Abs", () => {
    const abs = parseCaseArgExpr("number().gt(0)");
    expect(abs).toBeDefined();
    expect(formatAbs(abs)).toContain(">");
    expect(formatAbs(abs)).toContain("0");
  });

  it("union(lit(1), lit(2))", () => {
    const s = formatAbs(parseCaseArgExpr("union(lit(1), lit(2))"));
    expect(s).toContain("1");
    expect(s).toContain("2");
  });

  it("union accepts concrete literal members", () => {
    const abs = parseCaseArgExpr("union(number(), null)");
    expect(abs.shape.k).toBe("sum");
    if (abs.shape.k === "sum") {
      expect(abs.shape.members).toHaveLength(2);
    }
  });

  it("shape({ id: number() })", () => {
    expect(parseCaseArgExpr("shape({ id: number() })").shape.k).toBe("obj");
  });

  it("array(number())", () => {
    expect(parseCaseArgExpr("array(number())").shape.k).toBe("arr");
  });

  it("object / tuple literals", () => {
    expect(parseCaseArgExpr("{ id: number() }").shape.k).toBe("obj");
    expect(parseCaseArgExpr("[number(), string()]").shape.k).toBe("tuple");
  });

  it("T.* is no longer accepted", () => {
    expect(parseCaseArgExpr("T.number").shape.k).toBe("unknown");
  });

  it("extractDirectives always fills argsAbs (constraint + literals)", () => {
    const src = `
/**
 * @nudo:case "n" (number())
 * @nudo:case "lit" (lit(7))
 * @nudo:case "bare" (42)
 * @nudo:case "shape" (shape({ x: number() }))
 */
function id(x) { return x; }
`;
    const fns = extractDirectives(parse(src));
    const cases = fns[0]!.directives.filter((d) => d.kind === "case") as Array<{
      name: string;
      argsAbs: Abs[];
    }>;
    expect(cases).toHaveLength(4);
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

  it("number() cases produce prim Abs", () => {
    const src = `
/**
 * @nudo:case "n" (number())
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
