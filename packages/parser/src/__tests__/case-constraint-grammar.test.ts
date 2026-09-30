/**
 * case 实参约束表达式文法（design-refine-derivation：唯一文法）。
 * parseCaseArgExpr：约束构建器优先，其余为具体字面量 / 结构字面量 / 箭头函数。
 * `T.*` 文法已物理删除。
 */
import { describe, it, expect } from "vitest";
import { extractDirectives, parseCaseArgExpr } from "../directives.ts";
import {
  formatAbs,
  litValue,
  type Abs,
  num,
  str,
  bool,
  CONSTRAINT_BUILDER_NAMES,
  CONSTRAINT_EXPR_RE,
} from "@nudojs/core";
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
    expect(litValue(parseCaseArgExpr("lit(42)"))).toEqual({ ok: true, value: 42 });
    expect(litValue(parseCaseArgExpr('lit("a")'))).toEqual({ ok: true, value: "a" });
  });

  it("concrete literals parse without builders", () => {
    expect(litValue(parseCaseArgExpr("42"))).toEqual({ ok: true, value: 42 });
    expect(litValue(parseCaseArgExpr("null"))).toEqual({ ok: true, value: null });
    expect(litValue(parseCaseArgExpr("undefined"))).toEqual({ ok: true, value: undefined });
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
    expect(litValue(c.argsAbs[0]!)).toEqual({ ok: true, value: 7 });
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

/**
 * BUG-014 回归：builder 名单不得再与实现漂移。
 * 名单单源在 core 的 CONSTRAINT_BUILDERS；每个可注入 builder 必须能被
 * parseCaseArgExpr 解析成对应 Abs，而不是静默落回 unknown。
 */
describe("constraint builder name table stays in sync", () => {
  // 每个构建器的代表实参 → 期望的 shape.k（any 裸构建器语义即 unknown）
  const SAMPLES: Record<string, { expr: string; shapeK: string }> = {
    number: { expr: "number()", shapeK: "prim" },
    string: { expr: "string()", shapeK: "prim" },
    boolean: { expr: "boolean()", shapeK: "prim" },
    any: { expr: "any()", shapeK: "unknown" },
    array: { expr: "array(number())", shapeK: "arr" },
    shape: { expr: "shape({ a: number() })", shapeK: "obj" },
    lit: { expr: "lit(42)", shapeK: "prim" },
    union: { expr: "union(number(), string())", shapeK: "sum" },
    nullable: { expr: "nullable(number())", shapeK: "sum" },
    fn: { expr: "fn({ x: number() }, number())", shapeK: "fn" },
    and: { expr: "and(number(), number().gt(0))", shapeK: "prim" },
    partial: { expr: "partial(shape({ a: number() }))", shapeK: "obj" },
    pick: { expr: "pick(shape({ a: number(), b: string() }), [\"a\"])", shapeK: "obj" },
    omit: { expr: "omit(shape({ a: number(), b: string() }), [\"a\"])", shapeK: "obj" },
  };

  it("sample table covers every builder in CONSTRAINT_BUILDER_NAMES", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...CONSTRAINT_BUILDER_NAMES].sort());
  });

  it("CONSTRAINT_EXPR_RE matches every builder name", () => {
    for (const name of CONSTRAINT_BUILDER_NAMES) {
      expect(CONSTRAINT_EXPR_RE.test(`${name}(...)`), name).toBe(true);
    }
  });

  it("every injectable builder parses via parseCaseArgExpr", () => {
    for (const name of CONSTRAINT_BUILDER_NAMES) {
      const sample = SAMPLES[name];
      expect(sample, `missing sample for builder '${name}'`).toBeDefined();
      const abs = parseCaseArgExpr(sample!.expr);
      expect(abs.shape.k, `${name}: ${sample!.expr}`).toBe(sample!.shapeK);
    }
  });

  it("phantom builder names are not in the name table", () => {
    for (const phantom of ["record", "required", "readonly", "nonNullable"]) {
      expect(CONSTRAINT_BUILDER_NAMES).not.toContain(phantom);
      expect(CONSTRAINT_EXPR_RE.test(`${phantom}(...)`), phantom).toBe(false);
    }
  });

  it("nullable() is a first-class case-arg constraint builder", () => {
    const abs = parseCaseArgExpr("nullable(number())");
    // 不再静默退化成 unknown —— 应为 number | null | undefined 之和
    expect(abs.shape.k).not.toBe("unknown");
    expect(abs.shape.k).toBe("sum");
    if (abs.shape.k === "sum") {
      expect(abs.shape.members).toHaveLength(3);
    }
  });

  it("nullable() in a case directive fills argsAbs (not unknown)", () => {
    const src = `
/**
 * @nudo:case "null-ok" (nullable(number().gt(0)))
 */
function f(x) { return x; }
`;
    const fns = extractDirectives(parse(src));
    const c = fns[0]!.directives.find((d) => d.kind === "case") as {
      argsAbs: Abs[];
    };
    expect(c.argsAbs[0]!.shape.k).toBe("sum");
    expect(formatAbs(c.argsAbs[0]!)).not.toContain("unknown #");
  });
});
