import { describe, it, expect } from "vitest";
import {
  abs,
  num,
  str,
  bool,
  numLit,
  strLit,
  boolLit,
  objOf,
  type Abs,
} from "@nudojs/core";
import { absToTSType, generateDts } from "../dts-generator.ts";
import { analyzeFile } from "../analyzer.ts";

const arrOf = (element: Abs): Abs => abs({ k: "arr", element }, undefined, undefined, "exact");
const tupleOf = (elements: Abs[]): Abs => abs({ k: "tuple", elements }, undefined, undefined, "exact");
const promiseOf = (inner: Abs): Abs => abs({ k: "eff", eff: "promise", inner }, undefined, undefined, "exact");
const brandOf = (name: string): Abs => abs({ k: "brand", name, shape: objOf({}) }, undefined, undefined, "path");
const unionOf = (...members: Abs[]): Abs => abs({ k: "sum", members }, undefined, undefined, "exact");
const nullLit = (): Abs => abs({ k: "unknown" }, { op: "lit", value: null }, undefined, "exact");
const undefLit = (): Abs => abs({ k: "unknown" }, { op: "lit", value: undefined }, undefined, "exact");
const unknownAbs = (): Abs => abs({ k: "unknown" }, undefined, undefined, "partial");
const neverAbs = (): Abs => abs({ k: "never" }, undefined, undefined, "exact");

const bigintPrim = (): Abs => abs({ k: "prim", type: "bigint" }, undefined, undefined, "exact");

describe("absToTSType", () => {
  it("converts literal number", () => {
    expect(absToTSType(numLit(42))).toBe("42");
  });

  it("converts literal string", () => {
    expect(absToTSType(strLit("hello"))).toBe('"hello"');
  });

  it("converts literal boolean", () => {
    expect(absToTSType(boolLit(true))).toBe("true");
  });

  it("converts null and undefined", () => {
    expect(absToTSType(nullLit())).toBe("null");
    expect(absToTSType(undefLit())).toBe("undefined");
  });

  it("converts primitive types", () => {
    expect(absToTSType(num())).toBe("number");
    expect(absToTSType(str())).toBe("string");
    expect(absToTSType(bool())).toBe("boolean");
  });

  it("converts object type", () => {
    const obj = objOf({ x: { value: num() }, y: { value: str() } });
    expect(absToTSType(obj)).toBe("{ x: number; y: string }");
  });

  it("converts array type", () => {
    expect(absToTSType(arrOf(num()))).toBe("number[]");
  });

  it("converts union array type with parens", () => {
    expect(absToTSType(arrOf(unionOf(num(), str())))).toBe("(number | string)[]");
  });

  it("converts tuple type", () => {
    expect(absToTSType(tupleOf([num(), str()]))).toBe("[number, string]");
  });

  it("converts promise type", () => {
    expect(absToTSType(promiseOf(num()))).toBe("Promise<number>");
  });

  it("converts instance type", () => {
    expect(absToTSType(brandOf("Error"))).toBe("Error");
  });

  it("converts union type", () => {
    expect(absToTSType(unionOf(num(), str()))).toBe("number | string");
  });

  it("converts never and unknown", () => {
    expect(absToTSType(neverAbs())).toBe("never");
    expect(absToTSType(unknownAbs())).toBe("unknown");
  });
});

describe("generateDts", () => {
  it("generates .d.ts from analysis result", () => {
    const source = `
/**
 * @nudo:case "concrete" (1, 2)
 * @nudo:case "symbolic" (T.number, T.number)
 */
function add(a, b) {
  return a + b;
}
`;
    const result = analyzeFile("/test/gen.js", source);
    const dts = generateDts(result);
    // 行为已修复：不再按 case 生成字面量重载（`): 3;` 会拦截 safeSqrt(5)
    // 这类合法调用），改为单一 widen 主签名，字面量精度保留在 JSDoc Case: 行
    expect(dts).toContain("export declare function add(a: number, b: number): number;");
    expect(dts.match(/export declare function add\b/g)).toHaveLength(1);
    expect(dts).toContain("Case: concrete (1, 2) => 3");
    // symbolic case 与主签名同形（无信息损失），不再重复罗列
    expect(dts).not.toContain("): 3;");
    expect(dts).not.toContain("Case: symbolic");
  });

  it("generates single overload for single case", () => {
    const source = `
/**
 * @nudo:case "test" (T.number)
 */
function identity(x) {
  return x;
}
`;
    const result = analyzeFile("/test/single.js", source);
    const dts = generateDts(result);
    expect(dts).toContain("export declare function identity");
    expect(dts).toContain("x: number");
  });

  it("uses actual parameter names from AST", () => {
    const source = `
/**
 * @nudo:case "numbers" (T.number, T.number)
 */
function add(a, b) {
  return a + b;
}
`;
    const result = analyzeFile("/test/params.js", source);
    const dts = generateDts(result);
    expect(dts).toContain("a: number");
    expect(dts).toContain("b: number");
    expect(dts).not.toContain("arg0");
    expect(dts).not.toContain("arg1");
  });

  it("generates JSDoc comments", () => {
    const source = `
/**
 * @nudo:case "test" (T.string)
 */
function greet(name) {
  return "hello " + name;
}
`;
    const result = analyzeFile("/test/jsdoc.js", source);
    const dts = generateDts(result);
    expect(dts).toContain("/**");
    expect(dts).toContain("* @param name - string");
    expect(dts).toContain("* @returns");
    expect(dts).toContain("*/");
  });

  it("generates JSDoc with case names for multiple overloads", () => {
    const source = `
/**
 * @nudo:case "str" (T.string) => T.number
 * @nudo:case "num" (T.number) => T.string
 */
function convert(x) {
  return typeof x === "string" ? Number(x) : String(x);
}
`;
    const result = analyzeFile("/test/multi.js", source);
    const dts = generateDts(result);
    expect(dts).toContain("Case: str");
    expect(dts).toContain("Case: num");
  });

  it("handles rest parameters", () => {
    const source = `
/**
 * @nudo:case "test" (T.array(T.number))
 */
function sum(...nums) {
  return nums;
}
`;
    const result = analyzeFile("/test/rest.js", source);
    const dts = generateDts(result);
    expect(dts).toContain("...nums");
  });

  it("widens literal params so widened calls compile (safeSqrt scenario)", () => {
    const source = `
/**
 * @nudo:case "valid" (10)
 * @nudo:case "negative" (-1)
 */
function safeSqrt(x) {
  if (x < 0) {
    throw new RangeError("negative input");
  }
  return x;
}
`;
    const result = analyzeFile("/test/sqrt2.js", source);
    const dts = generateDts(result);
    // 单一 widen 主签名：参数联合 10 | -1 → number，返回 combined 同样 widen
    expect(dts).toContain("export declare function safeSqrt(x: number): number;");
    expect(dts.match(/export declare function safeSqrt\b/g)).toHaveLength(1);
    // 字面量精度（含 throwing case 的 never）保留在 JSDoc
    expect(dts).toContain("Case: valid (10) => 10");
    expect(dts).toContain("Case: negative (-1) => never");
  });

  it("widens literal params for a single-case function too", () => {
    const source = `
/**
 * @nudo:case "only" (42)
 */
function pass(x) {
  return x;
}
`;
    const result = analyzeFile("/test/single-literal.js", source);
    const dts = generateDts(result);
    expect(dts).toContain("export declare function pass(x: number): number;");
    expect(dts.match(/export declare function pass\b/g)).toHaveLength(1);
  });

  it("widens string and boolean literal params to base types", () => {
    const source = `
/**
 * @nudo:case "s" ("fast")
 * @nudo:case "b" (true)
 */
function flag(x) {
  return x;
}
`;
    const result = analyzeFile("/test/flag.js", source);
    const dts = generateDts(result);
    expect(dts).toContain("export declare function flag(x: string | boolean): string | boolean;");
    expect(dts).toContain('Case: s ("fast") => "fast"');
  });

  it("widens bigint literal params (hand-built analysis)", () => {
    const fn = {
      name: "big",
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 9 } },
      paramNames: ["n"],
      cases: [
        {
          name: "c",
          argAbs: [bigintPrim()],
          abs: bigintPrim(),
          throwsAbs: neverAbs(),
        },
      ],
    };
    const dts = generateDts({ functions: [fn] } as unknown as Parameters<typeof generateDts>[0]);
    expect(dts).toContain("export declare function big(n: bigint): bigint;");
  });

  it("marks mixed-arity tail params optional", () => {
    const source = `
/**
 * @nudo:case "one" (T.number)
 * @nudo:case "two" (T.number, T.string)
 */
function either(x, y) {
  return y === undefined ? x : y;
}
`;
    const result = analyzeFile("/test/either.js", source);
    const dts = generateDts(result);
    expect(dts).toContain("either(x: number, y?: string)");
    expect(dts.match(/export declare function either\b/g)).toHaveLength(1);
  });

  it("keeps the rest-args form for case-less combined functions", () => {
    const fn = {
      name: "entryOnly",
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 9 } },
      paramNames: ["x"],
      cases: [],
      combinedAbs: promiseOf(num()),
    };
    const dts = generateDts({ functions: [fn] } as unknown as Parameters<typeof generateDts>[0]);
    expect(dts).toBe("export declare function entryOnly(...args: unknown[]): Promise<number>;\n");
  });

  it("widens homogeneous tuple params to arrays (reduceSum scenario)", () => {
    const source = `
// @nudo:case "t" ([1, 2, 3, 4, 5])
function reduceSum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}
`;
    const result = analyzeFile("/test/reduce.js", source);
    const dts = generateDts(result);
    // 行为已修复：定长 widened 元组 [number×5] 会拒收变长合法实参
    // （tsc TS2345），字面量长度只是单次调用观察，不构成约束 → number[]
    expect(dts).toContain("export declare function reduceSum(arr: number[]): number;");
    expect(dts).toContain("Case: t ([1, 2, 3, 4, 5]) => 15");
  });

  it("widens heterogeneous tuple params positionally", () => {
    const source = `
// @nudo:case "t" ([1, "two"])
function pair(p) {
  return p;
}
`;
    const result = analyzeFile("/test/pair.js", source);
    const dts = generateDts(result);
    // 异构元素保留 widened 定长元组：[number, string] 的位置语义真实，
    // 且不拦截合法的按位调用；返回位（协变）保留字面量精度
    expect(dts).toContain("export declare function pair(p: [number, string]): [1, \"two\"];");
  });

  it("widens object param property values (single case)", () => {
    const source = `
/**
 * @nudo:case "concrete" ({ name: "Alice", age: 30 })
 */
function greet(person) {
  return \`Hello, \${person.name}! You are \${person.age} years old.\`;
}
`;
    const result = analyzeFile("/test/greet1.js", source);
    const dts = generateDts(result);
    // 单 case 对象参数：属性值递归 widen（否则 greet({ name: "Bob", age: 20 })
    // 不匹配 { name: "Alice"; age: 30 }，同类拦截问题）
    expect(dts).toContain("export declare function greet(person: { name: string; age: number }): string;");
    expect(dts).toContain('Case: concrete ({ name: "Alice"; age: 30 })');
  });

  it("keeps return-position precision while widening params (contrast)", () => {
    const source = `
// @nudo:case "t" ([1, 2])
function tupleEcho(arr) {
  return arr;
}
`;
    const result = analyzeFile("/test/echo.js", source);
    const dts = generateDts(result);
    // 参数位（逆变）递归 widen → number[]；返回位（协变）保留字面量精度
    expect(dts).toContain("export declare function tupleEcho(arr: number[]): [1, 2];");
  });

  it("dedupes same-shaped widened object params across cases", () => {
    const source = `
/**
 * @nudo:case "a" ({ id: 1 })
 * @nudo:case "b" ({ id: 2 })
 */
function byId(q) {
  return q.id;
}
`;
    const result = analyzeFile("/test/byid.js", source);
    const dts = generateDts(result);
    // 两个同形对象 widen 后都成 { id: number }，按渲染串去重避免
    // `{ id: number } | { id: number }` 重复成员
    expect(dts).toContain("export declare function byId(q: { id: number }): number;");
    expect(dts).not.toContain("{ id: number } | { id: number }");
  });

  it("dedupes extracted underscore names from destructured params", () => {
    const fn = {
      name: "pair",
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 9 } },
      // 两个解构参数在 AST 提取时都叫 "_"；重名会让 .d.ts 非法（TS2300）
      paramNames: ["_", "_"],
      cases: [
        {
          name: "c",
          argAbs: [
            objOf({ a: { value: num() } }),
            objOf({ b: { value: str() } }),
          ],
          abs: num(),
          throwsAbs: neverAbs(),
        },
      ],
    };
    const dts = generateDts({ functions: [fn] } as unknown as Parameters<typeof generateDts>[0]);
    expect(dts).toContain("export declare function pair(_: { a: number }, _2: { b: string }): number;");
    expect(dts).toContain("@param _2 - { b: string }");
  });

  it("keeps nested literal precision inside Promise payloads", () => {
    const fn = {
      name: "fetchData",
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 9 } },
      paramNames: [],
      cases: [
        {
          name: "test",
          argAbs: [],
          abs: promiseOf(numLit(42)),
          throwsAbs: neverAbs(),
        },
      ],
    };
    const dts = generateDts({ functions: [fn] } as unknown as Parameters<typeof generateDts>[0]);
    // widen 只作用于顶层标量字面量；Promise 载荷精度保留（既有行为）
    expect(dts).toContain("export declare function fetchData(): Promise<42>;");
  });
});
