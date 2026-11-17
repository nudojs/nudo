/**
 * case 实参约束表达式文法：构建器优先，其余为具体/结构字面量；T.* 已删除。
 * builder 名单单源在 core 的 CONSTRAINT_BUILDERS，名单/正则/解析三方不漂移。
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

const GRAMMAR_CASES: { name: string; cases: { expr: string; shape: string; verify?: (a: Abs) => void }[] }[] = [
  {
    name: "primitive 构建器",
    cases: [
      { expr: "number()", shape: "prim", verify: (a) => expect(a.shape).toEqual(num().shape) },
      { expr: "string()", shape: "prim", verify: (a) => expect(a.shape).toEqual(str().shape) },
      { expr: "boolean()", shape: "prim", verify: (a) => expect(a.shape).toEqual(bool().shape) },
    ],
  },
  {
    name: "lit 与具体字面量",
    cases: [
      { expr: "lit(42)", shape: "prim", verify: (a) => expect(litValue(a)).toEqual({ ok: true, value: 42 }) },
      { expr: 'lit("a")', shape: "prim", verify: (a) => expect(litValue(a)).toEqual({ ok: true, value: "a" }) },
      { expr: "42", shape: "prim", verify: (a) => expect(litValue(a)).toEqual({ ok: true, value: 42 }) },
      { expr: "null", shape: "unknown", verify: (a) => expect(litValue(a)).toEqual({ ok: true, value: null }) },
      { expr: "undefined", shape: "unknown", verify: (a) => expect(litValue(a)).toEqual({ ok: true, value: undefined }) },
      { expr: "never", shape: "never" },
    ],
  },
  {
    name: "pred 参与 Abs",
    cases: [{ expr: "number().gt(0)", shape: "prim", verify: (a) => { expect(formatAbs(a)).toContain(">"); expect(formatAbs(a)).toContain("0"); } }],
  },
  {
    name: "union 成员",
    cases: [
      { expr: "union(lit(1), lit(2))", shape: "sum", verify: (a) => { const s = formatAbs(a); expect(s).toContain("1"); expect(s).toContain("2"); } },
      { expr: "union(number(), null)", shape: "sum", verify: (a) => { if (a.shape.k === "sum") expect(a.shape.members).toHaveLength(2); } },
    ],
  },
  {
    name: "结构字面量与构建器",
    cases: [
      { expr: "shape({ id: number() })", shape: "obj" },
      { expr: "array(number())", shape: "arr" },
      { expr: "{ id: number() }", shape: "obj" },
      { expr: "[number(), string()]", shape: "tuple" },
    ],
  },
  { name: "T.* 不再接受", cases: [{ expr: "T.number", shape: "unknown" }] },
];

describe("parseCaseArgExpr：约束文法", () => {
  it.each(GRAMMAR_CASES)("$name", ({ cases }) => {
    for (const { expr, shape, verify } of cases) {
      const abs = parseCaseArgExpr(expr);
      expect(abs.shape.k, expr).toBe(shape);
      verify?.(abs);
    }
  });
});

describe("extractDirectives 的 argsAbs 面", () => {
  it("约束/字面量/结构实参都填 argsAbs，且不残留旧 args/TypeValue", () => {
    const src = `
/**
 * @nudo:case "n" (number())
 * @nudo:case "lit" (lit(7))
 * @nudo:case "bare" (42)
 * @nudo:case "shape" (shape({ x: number() }))
 */
function id(x) { return x; }
`;
    const cases = extractDirectives(parse(src))[0]!.directives.filter((d) => d.kind === "case") as Array<{
      name: string;
      argsAbs: Abs[];
      args?: unknown;
    }>;
    expect(cases).toHaveLength(4);
    for (const c of cases) {
      expect(c.argsAbs, c.name).toHaveLength(1);
      expect(c.args, c.name).toBeUndefined();
    }
    const lit = cases.find((c) => c.name === "lit")!;
    expect(litValue(lit.argsAbs[0]!)).toEqual({ ok: true, value: 7 });
    const prim = cases.find((c) => c.name === "n")!;
    expect(prim.argsAbs[0]!.shape.k).toBe("prim");
    if (prim.argsAbs[0]!.shape.k === "prim") expect(prim.argsAbs[0]!.shape.type).toBe("number");
  });
});

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
  lazy: { expr: "lazy(() => number())", shapeK: "unknown" },
  and: { expr: "and(number(), number().gt(0))", shapeK: "prim" },
  partial: { expr: "partial(shape({ a: number() }))", shapeK: "obj" },
  pick: { expr: 'pick(shape({ a: number(), b: string() }), ["a"])', shapeK: "obj" },
  omit: { expr: 'omit(shape({ a: number(), b: string() }), ["a"])', shapeK: "obj" },
  bind: { expr: 'bind("a", number())', shapeK: "prim" },
  ref: { expr: 'ref("a")', shapeK: "unknown" },
  rel: { expr: 'rel(">", "x")', shapeK: "unknown" },
};

describe("builder 名单与实现不漂移", () => {
  it("样本覆盖全部 builder 名，正则匹配全部名字", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...CONSTRAINT_BUILDER_NAMES].sort());
    for (const name of CONSTRAINT_BUILDER_NAMES) expect(CONSTRAINT_EXPR_RE.test(`${name}(...)`), name).toBe(true);
  });

  it("每个可注入 builder 都能解析成对应 shape", () => {
    for (const name of CONSTRAINT_BUILDER_NAMES) {
      const sample = SAMPLES[name];
      expect(sample, `missing sample for builder '${name}'`).toBeDefined();
      expect(parseCaseArgExpr(sample!.expr).shape.k, `${name}: ${sample!.expr}`).toBe(sample!.shapeK);
    }
  });

  it("幽灵 builder 不在名单，也不被正则接受", () => {
    for (const phantom of ["record", "required", "readonly", "nonNullable"]) {
      expect(CONSTRAINT_BUILDER_NAMES).not.toContain(phantom);
      expect(CONSTRAINT_EXPR_RE.test(`${phantom}(...)`), phantom).toBe(false);
    }
  });

  it("nullable() 是首类 builder：解析为 sum(3)，指令里不落 unknown", () => {
    const abs = parseCaseArgExpr("nullable(number())");
    expect(abs.shape.k).toBe("sum");
    if (abs.shape.k === "sum") expect(abs.shape.members).toHaveLength(3);

    const src = `/**\n * @nudo:case "null-ok" (nullable(number().gt(0)))\n */\nfunction f(x) { return x; }`;
    const c = extractDirectives(parse(src))[0]!.directives.find((d) => d.kind === "case") as { argsAbs: Abs[] };
    expect(c.argsAbs[0]!.shape.k).toBe("sum");
    expect(formatAbs(c.argsAbs[0]!)).not.toContain("unknown #");
  });
});
