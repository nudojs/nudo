/**
 * BUG-013 / S4-001 回归：类型表达式任意代码执行（RCE）。
 *
 * 设计文法是「约束构建器 / 字面量」受限语法；实现曾把整条表达式交给
 * execNudoModule → new Function 完整 JS 求值。CONSTRAINT_EXPR_RE 只做前缀
 * 预筛，`number(), process.exit(42)` 之类拼接可借前缀执行任意 JS。
 *
 * 修复：进入 execNudoModule 之前做 AST 白名单。恶意表达式必须
 * (1) 无副作用 (2) 报 nudo:directive-syntax；合法用例行为不变。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  extractDirectives,
  extractInlineDirectives,
  parseCaseArgExpr,
  type DirectiveDiag,
} from "../directives.ts";
import { parse } from "../parse.ts";

const PAYLOAD_SEQ = "number(), (globalThis.__bug013 = true, 1)";
const PAYLOAD_NESTED = "number().gt((globalThis.__bug013 = true, 1))";
const PAYLOAD_ASSIGN = "number().gt(globalThis.__bug013 = true)";
const PAYLOAD_CALL = "number().gt(process.exit(0))";
const PAYLOAD_CTOR = "number().constructor('return process.exit(0)')()";
/** 多语句拼接：借 `(${s});` 包裹逃逸 */
const PAYLOAD_BREAKOUT = "number()); globalThis.__bug013 = true; //";

function directiveMessages(diags: DirectiveDiag[]): string[] {
  return diags
    .filter((d) => d.code === "nudo:directive-syntax")
    .map((d) => d.message);
}

/** 函数级指令链（case/mock）的诊断面 */
function diagsOfExtract(src: string): string[] {
  const diags: DirectiveDiag[] = [];
  extractDirectives(parse(src), { diags });
  return directiveMessages(diags);
}

/** 行内指令链（as/replace，单表达式容器）的诊断面 */
function diagsOfInline(src: string): string[] {
  const ast = parse(src);
  const stmt = (ast as { program: { body: unknown[] } }).program.body[0];
  const diags: DirectiveDiag[] = [];
  extractInlineDirectives(stmt as never, { diags });
  return directiveMessages(diags);
}

/** payload 的单表达式容器：`// @nudo:as <payload>` 一整行即一个类型表达式 */
function asSrc(expr: string): string {
  return `// @nudo:as ${expr}\nconst x = 1;`;
}

function clearPayload(): void {
  delete (globalThis as Record<string, unknown>).__bug013;
}

function payloadFired(): boolean {
  return (globalThis as Record<string, unknown>).__bug013 === true;
}

beforeEach(() => {
  clearPayload();
});

afterEach(() => {
  clearPayload();
});

describe("BUG-013: malicious type expressions must not execute", () => {
  it("parseCaseArgExpr: sequence payload has no side effect", () => {
    const abs = parseCaseArgExpr(PAYLOAD_SEQ);
    expect(payloadFired()).toBe(false);
    expect(abs.shape.k).toBe("unknown");
    expect(diagsOfInline(asSrc(PAYLOAD_SEQ)).some((m) => m.includes("Unsafe"))).toBe(true);
  });

  it("parseCaseArgExpr: nested assignment payload has no side effect", () => {
    const abs = parseCaseArgExpr(PAYLOAD_NESTED);
    expect(payloadFired()).toBe(false);
    expect(abs.shape.k).toBe("unknown");
    expect(diagsOfInline(asSrc(PAYLOAD_NESTED)).some((m) => m.includes("Unsafe"))).toBe(true);
  });

  it("parseCaseArgExpr: top-level assignment payload has no side effect", () => {
    parseCaseArgExpr(PAYLOAD_ASSIGN);
    expect(payloadFired()).toBe(false);
    expect(diagsOfInline(asSrc(PAYLOAD_ASSIGN)).some((m) => m.includes("Unsafe"))).toBe(true);
  });

  it("parseCaseArgExpr: non-whitelist call payload has no side effect", () => {
    parseCaseArgExpr(PAYLOAD_CALL);
    expect(payloadFired()).toBe(false);
    expect(diagsOfInline(asSrc(PAYLOAD_CALL)).some((m) => m.includes("Unsafe"))).toBe(true);
  });

  it("parseCaseArgExpr: constructor gadget has no side effect", () => {
    parseCaseArgExpr(PAYLOAD_CTOR);
    expect(payloadFired()).toBe(false);
    expect(diagsOfInline(asSrc(PAYLOAD_CTOR)).some((m) => m.includes("Unsafe"))).toBe(true);
  });

  it("parseCaseArgExpr: statement-breakout payload has no side effect", () => {
    parseCaseArgExpr(PAYLOAD_BREAKOUT);
    expect(payloadFired()).toBe(false);
    expect(diagsOfInline(asSrc(PAYLOAD_BREAKOUT)).some((m) => m.includes("Unsafe"))).toBe(true);
  });
});

describe("BUG-013: four directive chains reject payload", () => {
  it("@nudo:case chain: no side effect + diagnostic", () => {
    const src = `
/**
 * @nudo:case "x" (${PAYLOAD_NESTED})
 */
function f(x) { return x; }
`;
    expect(diagsOfExtract(src).some((m) => m.includes("Unsafe"))).toBe(true);
    expect(payloadFired()).toBe(false);
  });

  it("@nudo:as chain: no side effect + diagnostic", () => {
    expect(diagsOfInline(`// @nudo:as ${PAYLOAD_NESTED}
const x = 1;`).some((m) => m.includes("Unsafe"))).toBe(true);
    expect(payloadFired()).toBe(false);
  });

  it("@nudo:replace chain: no side effect + diagnostic", () => {
    expect(diagsOfInline(`// @nudo:replace a ${PAYLOAD_NESTED}
const a = 1;`).some((m) => m.includes("Unsafe"))).toBe(true);
    expect(payloadFired()).toBe(false);
  });

  it("@nudo:mock return-value chain: no side effect + diagnostic", () => {
    const src = `
/**
 * @nudo:mock x = stub().returns(${PAYLOAD_NESTED})
 */
function f() { return x; }
`;
    expect(diagsOfExtract(src).some((m) => m.includes("Unsafe"))).toBe(true);
    expect(payloadFired()).toBe(false);
  });
});

describe("BUG-013: legal type expressions still work", () => {
  it("builder + chain methods parse", () => {
    expect(parseCaseArgExpr("number()").shape.k).toBe("prim");
    expect(parseCaseArgExpr("number().gt(1)").shape.k).toBe("prim");
    expect(parseCaseArgExpr("number().ge(0).le(100)").shape.k).toBe("prim");
    expect(parseCaseArgExpr("number().int().gt(0)").shape.k).toBe("prim");
    expect(parseCaseArgExpr("string().min(1).max(10)").shape.k).toBe("prim");
    expect(parseCaseArgExpr("string().length(3)").shape.k).toBe("prim");
    expect(parseCaseArgExpr("number().optional()").shape.k).toBe("prim");
    expect(parseCaseArgExpr("number().shift(1)").shape.k).toBe("prim");
  });

  it("structure builders parse", () => {
    expect(parseCaseArgExpr("shape({ id: number().gt(0) })").shape.k).toBe("obj");
    expect(parseCaseArgExpr("array(number())").shape.k).toBe("arr");
    expect(parseCaseArgExpr("union(number(), string())").shape.k).toBe("sum");
    expect(parseCaseArgExpr("fn({ x: number() }, number())").shape.k).toBe("fn");
    expect(parseCaseArgExpr("and(number(), number().gt(0))").shape.k).toBe("prim");
    expect(parseCaseArgExpr("partial(shape({ a: number() }))").shape.k).toBe("obj");
    expect(parseCaseArgExpr('pick(shape({ a: number(), b: string() }), ["a"])').shape.k).toBe("obj");
  });

  it("literals parse", () => {
    expect(parseCaseArgExpr("lit(42)").shape.k).toBe("prim");
    expect(parseCaseArgExpr('lit("hi")').shape.k).toBe("prim");
    expect(parseCaseArgExpr("lit(-5)").shape.k).toBe("prim");
    expect(parseCaseArgExpr("42").shape.k).toBe("prim");
    expect(parseCaseArgExpr('"hello"').shape.k).toBe("prim");
    expect(parseCaseArgExpr("{ id: number() }").shape.k).toBe("obj");
    expect(parseCaseArgExpr("[number(), string()]").shape.k).toBe("tuple");
  });

  it("legal @nudo:case emits no Unsafe diagnostic", () => {
    const src = `
/**
 * @nudo:case "n" (number().gt(0))
 * @nudo:case "s" (shape({ id: number() }))
 */
function f(x) { return x; }
`;
    expect(diagsOfExtract(src).some((m) => m.includes("Unsafe"))).toBe(false);
    expect(payloadFired()).toBe(false);
  });

  it("legal @nudo:as / @nudo:replace / mock emit no Unsafe diagnostic", () => {
    const inline = `// @nudo:as number().gt(0)
// @nudo:replace a shape({ x: number() })
const a = 1;`;
    expect(diagsOfInline(inline).some((m) => m.includes("Unsafe"))).toBe(false);

    const mockSrc = `
/**
 * @nudo:mock y = stub().returns(number().gt(1))
 */
function f() { return y; }
`;
    expect(diagsOfExtract(mockSrc).some((m) => m.includes("Unsafe"))).toBe(false);
  });
});
