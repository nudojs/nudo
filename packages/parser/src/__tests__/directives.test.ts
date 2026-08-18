import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import { extractDirectives, parseTypeValueExpr } from "../directives.ts";
import { T, typeValueEquals } from "@nudojs/core";

describe("parseTypeValueExpr", () => {
  it("parses T.number", () => {
    expect(typeValueEquals(parseTypeValueExpr("T.number"), T.number)).toBe(true);
  });

  it("parses T.string", () => {
    expect(typeValueEquals(parseTypeValueExpr("T.string"), T.string)).toBe(true);
  });

  it("parses T.boolean", () => {
    expect(typeValueEquals(parseTypeValueExpr("T.boolean"), T.boolean)).toBe(true);
  });

  it("parses numeric literals", () => {
    expect(typeValueEquals(parseTypeValueExpr("42"), T.literal(42))).toBe(true);
    expect(typeValueEquals(parseTypeValueExpr("-3"), T.literal(-3))).toBe(true);
    expect(typeValueEquals(parseTypeValueExpr("1.5"), T.literal(1.5))).toBe(true);
  });

  it("parses string literals", () => {
    expect(typeValueEquals(parseTypeValueExpr('"hello"'), T.literal("hello"))).toBe(true);
    expect(typeValueEquals(parseTypeValueExpr("'world'"), T.literal("world"))).toBe(true);
  });

  it("parses boolean literals", () => {
    expect(typeValueEquals(parseTypeValueExpr("true"), T.literal(true))).toBe(true);
    expect(typeValueEquals(parseTypeValueExpr("false"), T.literal(false))).toBe(true);
  });

  it("parses null and undefined", () => {
    expect(typeValueEquals(parseTypeValueExpr("null"), T.literal(null))).toBe(true);
    expect(typeValueEquals(parseTypeValueExpr("undefined"), T.literal(undefined))).toBe(true);
  });

  it("parses T.literal(...)", () => {
    expect(typeValueEquals(parseTypeValueExpr("T.literal(42)"), T.literal(42))).toBe(true);
    expect(typeValueEquals(parseTypeValueExpr('T.literal("hi")'), T.literal("hi"))).toBe(true);
  });

  it("parses T.union(...)", () => {
    const result = parseTypeValueExpr("T.union(T.number, T.string)");
    const expected = T.union(T.number, T.string);
    expect(typeValueEquals(result, expected)).toBe(true);
  });

  it("parses arrow function literal with parenthesized params", () => {
    const result = parseTypeValueExpr("(x) => x * 2");
    expect(result.kind).toBe("function");
    if (result.kind === "function") {
      expect(result.params).toEqual(["x"]);
      expect(result.body.type).toBe("BinaryExpression");
      expect(result.closure).toBeDefined();
      expect((result as any)._paramPatterns).toBeDefined();
    }
  });

  it("parses arrow function literal without parens", () => {
    const result = parseTypeValueExpr("x => x + 1");
    expect(result.kind).toBe("function");
    if (result.kind === "function") {
      expect(result.params).toEqual(["x"]);
    }
  });

  it("parses arrow function literal with multiple params", () => {
    const result = parseTypeValueExpr("(a, b) => a + b");
    expect(result.kind).toBe("function");
    if (result.kind === "function") {
      expect(result.params).toEqual(["a", "b"]);
    }
  });

  it("parses function expression literal", () => {
    const result = parseTypeValueExpr("function(x) { return x * 2; }");
    expect(result.kind).toBe("function");
    if (result.kind === "function") {
      expect(result.params).toEqual(["x"]);
      expect(result.body.type).toBe("BlockStatement");
    }
  });

  it("does not treat strings containing => as functions", () => {
    const result = parseTypeValueExpr('"a => b"');
    expect(result.kind).toBe("literal");
  });
});

describe("extractDirectives", () => {
  it("extracts @nudo:case directives from function", () => {
    const source = `
/**
 * @nudo:case "concrete" (1, 2)
 * @nudo:case "symbolic" (T.number, T.number)
 */
function calc(a, b) {
  return a + b;
}
`;
    const ast = parse(source);
    const results = extractDirectives(ast);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("calc");
    expect(results[0].directives).toHaveLength(2);

    const d0 = results[0].directives[0];
    expect(d0.kind).toBe("case");
    expect(d0.name).toBe("concrete");
    expect(d0.args).toHaveLength(2);
    expect(typeValueEquals(d0.args[0], T.literal(1))).toBe(true);
    expect(typeValueEquals(d0.args[1], T.literal(2))).toBe(true);

    const d1 = results[0].directives[1];
    expect(d1.name).toBe("symbolic");
    expect(typeValueEquals(d1.args[0], T.number)).toBe(true);
    expect(typeValueEquals(d1.args[1], T.number)).toBe(true);
  });

  it("extracts from multiple functions", () => {
    const source = `
/**
 * @nudo:case "test" (1)
 */
function foo(x) { return x; }

/**
 * @nudo:case "test2" ("hello")
 */
function bar(s) { return s; }
`;
    const ast = parse(source);
    const results = extractDirectives(ast);
    expect(results).toHaveLength(2);
    expect(results[0].name).toBe("foo");
    expect(results[1].name).toBe("bar");
  });

  it("ignores functions without directives", () => {
    const source = `
function noDirective(x) { return x; }

/**
 * @nudo:case "test" (T.number)
 */
function withDirective(x) { return x + 1; }
`;
    const ast = parse(source);
    const results = extractDirectives(ast);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("withDirective");
  });

  it("handles string arguments in case", () => {
    const source = `
/**
 * @nudo:case "string test" ("hello", "world")
 */
function greet(a, b) { return a + b; }
`;
    const ast = parse(source);
    const results = extractDirectives(ast);
    expect(results[0].directives[0].args).toHaveLength(2);
    expect(typeValueEquals(results[0].directives[0].args[0], T.literal("hello"))).toBe(true);
    expect(typeValueEquals(results[0].directives[0].args[1], T.literal("world"))).toBe(true);
  });

  it("extracts arrow function literal as case argument", () => {
    const source = `
/**
 * @nudo:case "x" ([1, 2, 3], (a) => a * 2)
 */
function apply(items, cb) { return items; }
`;
    const ast = parse(source);
    const results = extractDirectives(ast);
    const d = results[0].directives[0];
    expect(d.kind).toBe("case");
    expect(d.args[0].kind).toBe("tuple");
    expect(d.args[1].kind).toBe("function");
    if (d.args[1].kind === "function") {
      expect(d.args[1].params).toEqual(["a"]);
      expect(d.args[1].body.type).toBe("BinaryExpression");
    }
  });

  it("extracts arrow function inside nested object literal in case", () => {
    const source = `
/**
 * @nudo:case "s" ({ fn: (a) => a })
 */
function use(opts) { return opts; }
`;
    const ast = parse(source);
    const results = extractDirectives(ast);
    const d = results[0].directives[0];
    expect(d.kind).toBe("case");
    expect(d.args[0].kind).toBe("object");
    if (d.args[0].kind === "object") {
      const fn = d.args[0].properties.fn;
      expect(fn.kind).toBe("function");
      if (fn.kind === "function") {
        expect(fn.params).toEqual(["a"]);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// TS 剥除 pass：parse() 统一剥除 TS-only 语法（见 ../strip-types.ts）。
// 断言方式：剥除后的 TS 源 AST 与等价 JS 源 AST 在去除位置/注释元数据后
// 结构等价。
// ---------------------------------------------------------------------------

import { stripTypes } from "../strip-types.ts";

const META_KEYS = new Set([
  "loc", "start", "end", "range",
  "leadingComments", "trailingComments", "innerComments", "comments", "tokens", "extra",
]);

function normalize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalize);
  if (node !== null && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(node as Record<string, unknown>).sort()) {
      if (META_KEYS.has(k)) continue;
      out[k] = normalize((node as Record<string, unknown>)[k]);
    }
    return out;
  }
  return node;
}

function expectStrippedEquivalent(tsSource: string, jsSource: string): void {
  expect(normalize(parse(tsSource))).toEqual(normalize(parse(jsSource)));
}

describe("stripTypes: parse() 统一 TS 剥除", () => {
  it("参数/返回标注被剥除", () => {
    expectStrippedEquivalent(
      "function add(a: number, b: number): number { return a + b; }",
      "function add(a, b) { return a + b; }",
    );
  });

  it("箭头函数泛型/标注/可选参数被剥除", () => {
    expectStrippedEquivalent(
      "const f = <T,>(v: T, opt?: boolean): T => v;",
      "const f = (v, opt) => v;",
    );
  });

  it("as 断言与非空断言解包", () => {
    expectStrippedEquivalent(
      "const y = x as string; const z = y!.length;",
      "const y = x; const z = y.length;",
    );
  });

  it("as const 与 satisfies 解包", () => {
    expectStrippedEquivalent(
      "const c = { a: 1 } as const; const s = { b: 2 } satisfies Alias;",
      "const c = { a: 1 }; const s = { b: 2 };",
    );
  });

  it("尖括号断言 <T>x 在 typescript+jsx 插件组合下不可解析（Babel 按 JSX 处理），剥除器仍处理 TSTypeAssertion 节点", () => {
    // 与 tsc 在 .tsx 中的行为一致：尖括号断言必须写 as。parse 层两个插件
    // 同时启用，`<string>x` 恒走 JSX 分支，因此 TSTypeAssertion 只能来自
    // 无歧义位置；unwrapExpression 分支保留以兜底。
    expect(() => parse("const y = <string>x;")).toThrow();
  });

  it("interface / type alias / enum / declare 声明被删除", () => {
    const ast = parse(`
interface User { name: string }
type Alias = { tag: "x" };
enum Color { Red }
declare const gone: string;
declare function goneFn(): void;
function kept(n) { return n; }
`);
    const body = ast.program.body;
    expect(body).toHaveLength(1);
    expect(body[0].type).toBe("FunctionDeclaration");
    expect((body[0] as any).id.name).toBe("kept");
  });

  it("export 包装的类型声明整体删除", () => {
    const ast = parse(`
export interface User { name: string }
export type Alias = string;
export declare class Gone {}
export default interface Def {}
export const real = 1;
`);
    const body = ast.program.body;
    expect(body).toHaveLength(1);
    expect(body[0].type).toBe("ExportNamedDeclaration");
  });

  it("import type 删除，混合 type specifier 剔除", () => {
    expectStrippedEquivalent(
      'import type { A } from "m";\nimport { type C, b } from "m";\nuse(b);',
      'import { b } from "m";\nuse(b);',
    );
    const ast = parse('import { type Only } from "m";');
    expect(ast.program.body).toHaveLength(0);
  });

  it("export type 与 type-only re-export 删除", () => {
    const ast = parse(`
const A = 1;
const keep = 2;
export type { A } from "./m";
export { type A, keep };
`);
    const body = ast.program.body;
    expect(body).toHaveLength(3);
    const last = body[2] as any;
    expect(last.type).toBe("ExportNamedDeclaration");
    expect(last.specifiers).toHaveLength(1);
    expect(last.specifiers[0].local.name).toBe("keep");
  });

  it("泛型调用与 new 的类型实参剥除", () => {
    expectStrippedEquivalent(
      "const r = id<string>(1); const c = new Map<string, number>();",
      "const r = id(1); const c = new Map();",
    );
  });

  it("裸泛型引用（TSInstantiationExpression）解包", () => {
    expectStrippedEquivalent(
      "const g = id<number>;",
      "const g = id;",
    );
  });

  it("类成员：implements/索引签名/标注剥除，declare·abstract 成员删除", () => {
    expectStrippedEquivalent(
      `
class Pt implements Shape {
  [key: string]: unknown;
  x: number = 0;
  declare hidden: string;
  get(): number { return this.x; }
}
`,
      `
class Pt {
  x = 0;
  get() { return this.x; }
}
`,
    );
    const ast = parse("declare abstract class AbstractBase { abstract m(): void; x: number; }");
    expect(ast.program.body).toHaveLength(0);
  });

  it("declare module / declare namespace 删除", () => {
    const ast = parse(`
declare module "x" { export const y: string; }
declare namespace NS { const z: string; }
function kept() {}
`);
    expect(ast.program.body).toHaveLength(1);
  });

  it("loc 保持：删除类型声明不重排兄弟节点位置", () => {
    const ast = parse("interface I {}\nfunction f() {}\nfunction g() {}");
    const body = ast.program.body;
    expect(body).toHaveLength(2);
    expect(body[0].loc?.start.line).toBe(2);
    expect(body[1].loc?.start.line).toBe(3);
  });

  it("纯 JS 源码剥除为 no-op 且返回同一棵 AST", () => {
    const js = "/** @nudo:case \"a\" (T.number) */\nfunction f(x) { return x; }\n";
    const once = parse(js);
    const snapshot = JSON.stringify(normalize(once));
    expect(stripTypes(once)).toBe(once);
    expect(JSON.stringify(normalize(parse(js)))).toBe(snapshot);
  });

  it("@nudo:case 指令在 .ts 源上照常提取（注释 loc 对齐不受剥除影响）", () => {
    const ts = `interface Ctx { id: number }
/**
 * @nudo:case "ints" (1, 2)
 * @nudo:case "syms" (T.number, T.number)
 */
function add(a: number, b: number): number { return a + b; }
`;
    const results = extractDirectives(parse(ts));
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("add");
    expect(results[0].directives).toHaveLength(2);
    expect((results[0].directives[0] as any).commentLine).toBe(3);
  });
});
