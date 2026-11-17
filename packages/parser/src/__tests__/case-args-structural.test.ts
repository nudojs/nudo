import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import { extractDirectives, parseCaseArgExpr } from "../directives.ts";
import { num, str } from "@nudojs/core";

type StructuralCase = {
  expr: string;
  kind: string;
  verify?: (abs: ReturnType<typeof parseCaseArgExpr>) => void;
};

const STRUCTURAL_CASES: { name: string; cases: StructuralCase[] }[] = [
  { name: "array(number())", cases: [{ expr: "array(number())", kind: "arr", verify: (a) => { if (a.shape.k === "arr") expect(a.shape.element.shape).toEqual(num().shape); } }] },
  {
    name: "tuple 字面量",
    cases: [{
      expr: "[number(), string()]",
      kind: "tuple",
      verify: (a) => {
        if (a.shape.k !== "tuple") return;
        expect(a.shape.elements).toHaveLength(2);
        expect(a.shape.elements[0]!.shape).toEqual(num().shape);
        expect(a.shape.elements[1]!.shape).toEqual(str().shape);
      },
    }],
  },
  {
    name: "shape builder 与对象字面量",
    cases: ["shape({ x: number(), y: string() })", "{ x: number(), y: string() }"].map((expr) => ({
      expr,
      kind: "obj",
      verify: (a) => {
        if (a.shape.k !== "obj") return;
        expect(a.shape.slots.x?.value.shape).toEqual(num().shape);
        expect(a.shape.slots.y?.value.shape).toEqual(str().shape);
      },
    })),
  },
  {
    name: "空对象与空 tuple",
    cases: [
      { expr: "{}", kind: "obj", verify: (a) => { if (a.shape.k === "obj") expect(Object.keys(a.shape.slots)).toHaveLength(0); } },
      { expr: "[]", kind: "tuple", verify: (a) => { if (a.shape.k === "tuple") expect(a.shape.elements).toHaveLength(0); } },
    ],
  },
  {
    name: "嵌套 builder 与具体字面量",
    cases: [
      { expr: "shape({ items: array(number()) })", kind: "obj", verify: (a) => { if (a.shape.k === "obj") expect(a.shape.slots.items?.value.shape.k).toBe("arr"); } },
      { expr: "array(null)", kind: "arr" },
      { expr: "union(number(), null)", kind: "sum" },
    ],
  },
];

describe("parseCaseArgExpr：结构 builder 与字面量", () => {
  it.each(STRUCTURAL_CASES)("$name", ({ cases }) => {
    for (const { expr, kind, verify } of cases) {
      const abs = parseCaseArgExpr(expr);
      expect(abs.shape.k, expr).toBe(kind);
      verify?.(abs);
    }
  });
});

const MOCK_CASES: { name: string; src: string; nameWanted: string; expression?: string; fromPath?: string }[] = [
  { name: "内联表达式", src: `/**\n * @nudo:mock fetch = any()\n * @nudo:case "test" (1)\n */\nfunction foo(x) { return x; }`, nameWanted: "fetch", expression: "any()" },
  { name: "文件指令（双引号路径）", src: `/**\n * @nudo:mock utils from "./utils.mock.js"\n * @nudo:case "test" (1)\n */\nfunction foo(x) { return x; }`, nameWanted: "utils", fromPath: "./utils.mock.js" },
  { name: "文件指令（单引号路径）", src: `/**\n * @nudo:mock utils from './utils.mock.js'\n * @nudo:case "test" (1)\n */\nfunction foo(x) { return x; }`, nameWanted: "utils", fromPath: "./utils.mock.js" },
  { name: "mock 与 case 共存", src: `/**\n * @nudo:mock helper = number()\n * @nudo:case "test" (number())\n */\nfunction foo(x) { return x; }`, nameWanted: "helper", expression: "number()" },
];

describe("extractDirectives：@nudo:mock 载荷", () => {
  it.each(MOCK_CASES)("$name", ({ src, nameWanted, expression, fromPath }) => {
    const fns = extractDirectives(parse(src));
    expect(fns).toHaveLength(1);
    const mocks = fns[0].directives.filter((d) => d.kind === "mock");
    expect(mocks).toHaveLength(1);
    if (mocks[0].kind !== "mock") return;
    expect(mocks[0].name).toBe(nameWanted);
    if (expression !== undefined) expect(mocks[0].expression).toBe(expression);
    if (fromPath !== undefined) expect(mocks[0].fromPath).toBe(fromPath);
    if (expression === undefined) expect(fns[0].directives.some((d) => d.kind === "case")).toBe(true);
  });
});
