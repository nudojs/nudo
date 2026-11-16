/**
 * 类型表达式不得执行任意代码：进入 execNudoModule 前做 AST 白名单。
 * 恶意表达式必须无副作用 + nudo:directive-syntax；合法表达式行为不变。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { extractDirectives, extractInlineDirectives, parseCaseArgExpr, type DirectiveDiag } from "../directives.ts";
import { parse } from "../parse.ts";

const PAYLOADS = [
  { name: "sequence", expr: "number(), (globalThis.__bug013 = true, 1)", unknown: true },
  { name: "nested assignment", expr: "number().gt((globalThis.__bug013 = true, 1))", unknown: true },
  { name: "top-level assignment", expr: "number().gt(globalThis.__bug013 = true)" },
  { name: "non-whitelist call", expr: "number().gt(process.exit(0))" },
  { name: "constructor gadget", expr: "number().constructor('return process.exit(0)')()" },
  { name: "statement breakout", expr: "number()); globalThis.__bug013 = true; //" },
];

const unsafeMessages = (diags: DirectiveDiag[]) =>
  diags.filter((d) => d.code === "nudo:directive-syntax").map((d) => d.message);

function extractDiags(src: string): string[] {
  const diags: DirectiveDiag[] = [];
  extractDirectives(parse(src), { diags });
  return unsafeMessages(diags);
}

function inlineDiags(src: string): string[] {
  const stmt = (parse(src) as { program: { body: unknown[] } }).program.body[0];
  const diags: DirectiveDiag[] = [];
  extractInlineDirectives(stmt as never, { diags });
  return unsafeMessages(diags);
}

const asSrc = (expr: string) => `// @nudo:as ${expr}\nconst x = 1;`;
const fired = () => (globalThis as Record<string, unknown>).__bug013 === true;
const clear = () => { delete (globalThis as Record<string, unknown>).__bug013; };

beforeEach(clear);
afterEach(clear);

describe("恶意类型表达式不执行", () => {
  it("直接解析六种 payload：无副作用、走 Unsafe 诊断", () => {
    for (const { name, expr, unknown } of PAYLOADS) {
      const abs = parseCaseArgExpr(expr);
      expect(fired(), name).toBe(false);
      if (unknown) expect(abs.shape.k, name).toBe("unknown");
      expect(inlineDiags(asSrc(expr)).some((m) => m.includes("Unsafe")), name).toBe(true);
    }
  });

  it("case / as / replace / mock 四条指令链都拒绝并零副作用", () => {
    const nested = PAYLOADS[1]!.expr;
    const sources = [
      `/**\n * @nudo:case "x" (${nested})\n */\nfunction f(x) { return x; }`,
      `// @nudo:as ${nested}\nconst x = 1;`,
      `// @nudo:replace a ${nested}\nconst a = 1;`,
      `/**\n * @nudo:mock x = stub().returns(${nested})\n */\nfunction f() { return x; }`,
    ];
    for (const src of sources) {
      const messages = src.includes("@nudo:as") || src.includes("@nudo:replace") ? inlineDiags(src) : extractDiags(src);
      expect(messages.some((m) => m.includes("Unsafe")), src).toBe(true);
      expect(fired(), src).toBe(false);
    }
  });
});

const LEGAL = [
  { expr: "number()", k: "prim" },
  { expr: "number().gt(1)", k: "prim" },
  { expr: "number().ge(0).le(100)", k: "prim" },
  { expr: "number().int().gt(0)", k: "prim" },
  { expr: "string().min(1).max(10)", k: "prim" },
  { expr: "string().length(3)", k: "prim" },
  { expr: "number().optional()", k: "prim" },
  { expr: "number().shift(1)", k: "prim" },
  { expr: "shape({ id: number().gt(0) })", k: "obj" },
  { expr: "array(number())", k: "arr" },
  { expr: "union(number(), string())", k: "sum" },
  { expr: "fn({ x: number() }, number())", k: "fn" },
  { expr: "and(number(), number().gt(0))", k: "prim" },
  { expr: "partial(shape({ a: number() }))", k: "obj" },
  { expr: 'pick(shape({ a: number(), b: string() }), ["a"])', k: "obj" },
  { expr: "lit(42)", k: "prim" },
  { expr: 'lit("hi")', k: "prim" },
  { expr: "lit(-5)", k: "prim" },
  { expr: "42", k: "prim" },
  { expr: '"hello"', k: "prim" },
  { expr: "{ id: number() }", k: "obj" },
  { expr: "[number(), string()]", k: "tuple" },
];

describe("合法表达式行为不变", () => {
  it("builder 链 / 结构 / 字面量全部解析为预期 shape", () => {
    for (const { expr, k } of LEGAL) expect(parseCaseArgExpr(expr).shape.k, expr).toBe(k);
  });

  it("合法 case / as / replace / mock 不产 Unsafe 诊断", () => {
    const caseSrc = `/**\n * @nudo:case "n" (number().gt(0))\n * @nudo:case "s" (shape({ id: number() }))\n */\nfunction f(x) { return x; }`;
    expect(extractDiags(caseSrc).some((m) => m.includes("Unsafe"))).toBe(false);

    const inline = `// @nudo:as number().gt(0)\n// @nudo:replace a shape({ x: number() })\nconst a = 1;`;
    expect(inlineDiags(inline).some((m) => m.includes("Unsafe"))).toBe(false);

    const mockSrc = `/**\n * @nudo:mock y = stub().returns(number().gt(1))\n */\nfunction f() { return y; }`;
    expect(extractDiags(mockSrc).some((m) => m.includes("Unsafe"))).toBe(false);
    expect(fired()).toBe(false);
  });
});
