import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import { extractDirectives, parseCaseArgExpr, type CaseDirective } from "../directives.ts";
import { litValue, num, str, bool, getFnImpl } from "@nudojs/core";
import { stripTypes } from "@nudojs/core";

const fnImpl = (expr: string) => {
  const abs = parseCaseArgExpr(expr);
  const impl = getFnImpl(abs);
  return { abs, impl };
};

describe("parseCaseArgExpr", () => {
  it("构建器 / 数字 / 字符串 / 布尔 / null / undefined / lit", () => {
    expect(parseCaseArgExpr("number()").shape).toEqual(num().shape);
    expect(parseCaseArgExpr("string()").shape).toEqual(str().shape);
    expect(parseCaseArgExpr("boolean()").shape).toEqual(bool().shape);
    const literals: Array<[string, unknown]> = [
      ["42", 42], ["-3", -3], ["1.5", 1.5],
      ['"hello"', "hello"], ["'world'", "world"],
      ["true", true], ["false", false], ["null", null], ["undefined", undefined],
      ["lit(42)", 42], ['lit("hi")', "hi"],
    ];
    for (const [expr, value] of literals) expect(litValue(parseCaseArgExpr(expr)), expr).toEqual({ ok: true, value });
  });

  it("unknown / any / never / any()", () => {
    for (const expr of ["unknown", "any", "any()"]) expect(parseCaseArgExpr(expr).shape.k, expr).toBe("unknown");
    expect(parseCaseArgExpr("never").shape.k).toBe("never");
  });

  it("union 成员", () => {
    const result = parseCaseArgExpr("union(number(), string())");
    expect(result.shape.k).toBe("sum");
    if (result.shape.k === "sum") expect(result.shape.members).toHaveLength(2);
  });

  it("箭头 / function 字面量保留 params、body 与 strict 未记录", () => {
    const cases = [
      { expr: "(x) => x * 2", params: ["x"], body: "BinaryExpression" },
      { expr: "x => x + 1", params: ["x"] },
      { expr: "(a, b) => a + b", params: ["a", "b"] },
      { expr: "function(x) { return x * 2; }", params: ["x"], body: "BlockStatement" },
    ];
    for (const { expr, params, body } of cases) {
      const { abs, impl } = fnImpl(expr);
      expect(abs.shape.k, expr).toBe("fn");
      expect(impl?.params, expr).toEqual(params);
      if (body) expect(impl?.body?.type, expr).toBe(body);
      expect(impl?.strict, expr).toBeUndefined();
    }
  });

  it("字符串里的 => 不是函数；T.* 文法已删除", () => {
    const result = parseCaseArgExpr('"a => b"');
    expect(litValue(result)).toEqual({ ok: true, value: "a => b" });
    expect(result.shape.k).toBe("prim");
    if (result.shape.k === "prim") expect(result.shape.type).toBe("string");
    expect(parseCaseArgExpr("T.number").shape.k).toBe("unknown");
  });
});

describe("extractDirectives", () => {
  const caseDirs = (src: string) =>
    extractDirectives(parse(src)).flatMap((f) => f.directives.filter((d): d is CaseDirective => d.kind === "case"));

  it("同一函数上的具体 / 符号 case 都保留实参", () => {
    const results = extractDirectives(parse(`
/**
 * @nudo:case "concrete" (1, 2)
 * @nudo:case "symbolic" (number(), number())
 */
function calc(a, b) { return a + b; }
`));
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("calc");
    expect(results[0].directives).toHaveLength(2);
    const [d0, d1] = results[0].directives;
    if (d0?.kind !== "case" || d1?.kind !== "case") throw new Error("expected case directives");
    expect(d0.name).toBe("concrete");
    expect(d0.argsAbs.map((a) => litValue(a))).toEqual([{ ok: true, value: 1 }, { ok: true, value: 2 }]);
    expect(d1.name).toBe("symbolic");
    expect(d1.argsAbs.map((a) => a.shape.k)).toEqual(["prim", "prim"]);
  });

  it("多函数各自绑定；无指令函数被忽略", () => {
    const results = extractDirectives(parse(`
function noDirective(x) { return x; }
/** @nudo:case "test" (1) */
function foo(x) { return x; }
/** @nudo:case "test2" ("hello") */
function bar(s) { return s; }
`));
    expect(results.map((r) => r.name)).toEqual(["foo", "bar"]);
  });

  it("字符串 / 元组+箭头 / 嵌套对象箭头实参", () => {
    const strings = caseDirs(`/** @nudo:case "string test" ("hello", "world") */\nfunction greet(a, b) { return a + b; }`);
    expect(strings[0]!.argsAbs.map((a) => litValue(a))).toEqual([{ ok: true, value: "hello" }, { ok: true, value: "world" }]);

    const arrow = caseDirs(`/** @nudo:case "x" ([1, 2, 3], (a) => a * 2) */\nfunction apply(items, cb) { return items; }`);
    expect(arrow[0]!.argsAbs.map((a) => a.shape.k)).toEqual(["tuple", "fn"]);

    const nested = caseDirs(`/** @nudo:case "s" ({ fn: (a) => a }) */\nfunction use(opts) { return opts; }`);
    expect(nested[0]!.argsAbs[0]!.shape.k).toBe("obj");
    if (nested[0]!.argsAbs[0]!.shape.k === "obj") {
      expect(nested[0]!.argsAbs[0]!.shape.slots.fn?.value?.shape.k).toBe("fn");
    }
  });
});

describe("case => expected 续行", () => {
  const caseDirs = (src: string) =>
    extractDirectives(parse(src)).flatMap((f) => f.directives.filter((d): d is CaseDirective => d.kind === "case"));

  it("下一行 / 单行 / 多行实参后的 expected 都被采纳", () => {
    const nextLine = caseDirs(`/**\n * @nudo:case "t" (1)\n * => 2\n */\nfunction f(x) { return x; }`);
    expect(litValue(nextLine[0]!.argsAbs[0]!)).toEqual({ ok: true, value: 1 });
    expect(litValue(nextLine[0]!.expected!)).toEqual({ ok: true, value: 2 });

    const single = caseDirs(`/** @nudo:case "t" (1) => 2 */\nfunction f(x) { return x; }`);
    expect(litValue(single[0]!.expected!)).toEqual({ ok: true, value: 2 });

    const multi = caseDirs(`/**\n * @nudo:case "t" (\n *   1,\n *   2\n * )\n * => 3\n */\nfunction f(a, b) { return a + b; }`);
    expect(multi[0]!.argsAbs).toHaveLength(2);
    expect(multi[0]!.argsAbs.map((a) => litValue(a))).toEqual([{ ok: true, value: 1 }, { ok: true, value: 2 }]);
    expect(litValue(multi[0]!.expected!)).toEqual({ ok: true, value: 3 });
  });

  it("续行 expected 不吞下一个 case", () => {
    const cases = caseDirs(`/**\n * @nudo:case "t" (1)\n * => 2\n * @nudo:case "u" (3) => 4\n */\nfunction f(x) { return x; }`);
    expect(cases.map((c) => c.name)).toEqual(["t", "u"]);
    expect(cases.map((c) => litValue(c.expected!))).toEqual([{ ok: true, value: 2 }, { ok: true, value: 4 }]);
  });

  it("无 => 的正文 / 散文 / next-line !! 都不发明 expected", () => {
    const cases = [
      `/**\n * @nudo:case "t" (1) note: witness only\n * => 2\n */\nfunction f(x) { return x; }`,
      `/**\n * @nudo:case "neg" (0)\n * !! throws Error\n */\nfunction f(x) { return x; }`,
    ];
    for (const src of cases) {
      const d = caseDirs(src)[0]!;
      expect(d.expected, src).toBeUndefined();
    }
    const prose = caseDirs(`/**\n * @nudo:case "t" (1) => 2\n * trailing prose must not enter the expression\n */\nfunction f(x) { return x; }`);
    expect(litValue(prose[0]!.expected!)).toEqual({ ok: true, value: 2 });
  });
});

const META_KEYS = new Set(["loc", "start", "end", "range", "leadingComments", "trailingComments", "innerComments", "comments", "tokens", "extra"]);

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

const expectStrippedEquivalent = (tsSource: string, jsSource: string): void => {
  expect(normalize(parse(tsSource))).toEqual(normalize(parse(jsSource)));
};

describe("stripTypes：TS 剥除", () => {
  it("标注 / 泛型 / 断言 / satisfies / 泛型调用 / new / 实例化 / 类成员等价于 JS", () => {
    const pairs: Array<[string, string]> = [
      ["function add(a: number, b: number): number { return a + b; }", "function add(a, b) { return a + b; }"],
      ["const f = <T,>(v: T, opt?: boolean): T => v;", "const f = (v, opt) => v;"],
      ["const y = x as string; const z = y!.length;", "const y = x; const z = y.length;"],
      ["const c = { a: 1 } as const; const s = { b: 2 } satisfies Alias;", "const c = { a: 1 }; const s = { b: 2 };"],
      ["const r = id<string>(1); const c = new Map<string, number>();", "const r = id(1); const c = new Map();"],
      ["const g = id<number>;", "const g = id;"],
      [
        `class Pt implements Shape {\n  [key: string]: unknown;\n  x: number = 0;\n  declare hidden: string;\n  get(): number { return this.x; }\n}`,
        `class Pt {\n  x = 0;\n  get() { return this.x; }\n}`,
      ],
    ];
    for (const [ts, js] of pairs) expectStrippedEquivalent(ts, js);
  });

  it("尖括号断言 <T>x 剥成被断言表达式", () => {
    const ast = parse("const y = <string>x;");
    const decl = ast.program.body[0] as any;
    expect(decl.type).toBe("VariableDeclaration");
    expect(decl.declarations[0].init.type).toBe("Identifier");
    expect(decl.declarations[0].init.name).toBe("x");
  });

  it("interface / type / declare 删除；enum 合成运行时对象；declare enum 删除", () => {
    const ast = parse(`
interface User { name: string }
type Alias = { tag: "x" };
enum Color { Red }
declare const gone: string;
declare function goneFn(): void;
function kept(n) { return n; }
`);
    expect(ast.program.body).toHaveLength(2);
    const first = ast.program.body[0] as any;
    expect(first.type).toBe("VariableDeclaration");
    expect(first.kind).toBe("var");
    expect(first.declarations[0].id.name).toBe("Color");
    expect((ast.program.body[1] as any).id.name).toBe("kept");

    const declEnum = parse("declare enum Color { Red }\nfunction kept(n) { return n; }");
    expect(declEnum.program.body).toHaveLength(1);
    expect(declEnum.program.body[0]!.type).toBe("FunctionDeclaration");
    expect(parse("declare abstract class AbstractBase { abstract m(): void; x: number; }").program.body).toHaveLength(0);
  });

  it("export 包裹的类型声明整体删除", () => {
    const body = parse(`
export interface User { name: string }
export type Alias = string;
export declare class Gone {}
export default interface Def {}
export const real = 1;
`).program.body;
    expect(body).toHaveLength(1);
    expect(body[0]!.type).toBe("ExportNamedDeclaration");
  });

  it("import type / 混合 specifier / 全 type-only", () => {
    expectStrippedEquivalent(
      'import type { A } from "m";\nimport { type C, b } from "m";\nuse(b);',
      'import { b } from "m";\nuse(b);',
    );
    expect(parse('import { type Only } from "m";').program.body).toHaveLength(0);
  });

  it("export type 与 type-only re-export 删除", () => {
    const body = parse(`
const A = 1;
const keep = 2;
export type { A } from "./m";
export { type A, keep };
`).program.body;
    expect(body).toHaveLength(3);
    const last = body[2] as any;
    expect(last.type).toBe("ExportNamedDeclaration");
    expect(last.specifiers).toHaveLength(1);
    expect(last.specifiers[0].local.name).toBe("keep");
  });

  it("declare module / namespace 删除", () => {
    const body = parse(`
declare module "x" { export const y: string; }
declare namespace NS { const z: string; }
function kept() {}
`).program.body;
    expect(body).toHaveLength(1);
  });

  it("loc 保持：删除类型声明不重排兄弟节点", () => {
    const body = parse("interface I {}\nfunction f() {}\nfunction g() {}").program.body;
    expect(body).toHaveLength(2);
    expect(body[0]!.loc?.start.line).toBe(2);
    expect(body[1]!.loc?.start.line).toBe(3);
  });

  it("纯 JS 剥除为 no-op 且返回同一棵 AST", () => {
    const js = '/** @nudo:case "a" (number()) */\nfunction f(x) { return x; }\n';
    const once = parse(js);
    const snapshot = JSON.stringify(normalize(once));
    expect(stripTypes(once)).toBe(once);
    expect(JSON.stringify(normalize(parse(js)))).toBe(snapshot);
  });

  it(".ts 源上的 @nudo:case 照常提取且注释行号对齐", () => {
    const ts = `interface Ctx { id: number }\n/**\n * @nudo:case "ints" (1, 2)\n * @nudo:case "syms" (number(), number())\n */\nfunction add(a: number, b: number): number { return a + b; }\n`;
    const results = extractDirectives(parse(ts));
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("add");
    expect(results[0].directives).toHaveLength(2);
    expect((results[0].directives[0] as any).commentLine).toBe(3);
  });
});
