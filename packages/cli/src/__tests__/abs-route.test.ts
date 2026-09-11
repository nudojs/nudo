import { describe, it, expect, afterEach } from "vitest";
import {
  createEnvironment,
  typeValueToString,
  T,
  createRange,
  v as termVar,
  lit,
  ge,
  pushPhi,
} from "@nudojs/core";
import { parse } from "@nudojs/parser";
import {
  evaluateProgram,
  evaluateFunctionFull,
  resetMemo,
} from "../evaluator.ts";
import { resetPhi, tryAbsBinary } from "../abs-route.ts";
import { attachTerm } from "../term-registry.ts";

function runExpr(src: string): string {
  resetPhi();
  resetMemo();
  const ast = parse(src);
  const env = createEnvironment();
  const result = evaluateProgram(ast, env);
  return typeValueToString(result as any);
}

function runFn(
  src: string,
  args: Array<ReturnType<typeof T.literal> | typeof T.number | typeof T.string>,
): string {
  resetPhi();
  resetMemo();
  const ast = parse(src);
  const fnNode = (ast.program.body as any[]).find(
    (s) => s.type === "FunctionDeclaration",
  );
  const env = createEnvironment();
  evaluateProgram(ast, createEnvironment());
  const full = evaluateFunctionFull(fnNode, args as any, env);
  return typeValueToString(full.value);
}

describe("algebra router (single path)", () => {
  afterEach(() => {
    resetPhi();
  });

  it("arith: 1+2*3 still 7 (literal path)", () => {
    expect(runExpr("1+2*3;")).toBe("7");
  });

  it("scale(5): 6", () => {
    const src = `function scale(x){ return x+1; }`;
    expect(runFn(src, [T.literal(5)])).toBe("6");
  });

  it("number+1 stays number", () => {
    const src = `function f(x){ return x+1; }`;
    expect(runFn(src, [T.number])).toBe("number");
  });

  it("if (x>5) return 11 — true branch", () => {
    const src = `
      function g(x) {
        if (x > 5) return 11;
        return 0;
      }
    `;
    expect(runFn(src, [T.literal(10)])).toBe("11");
  });

  it("if (x>5) return x — keeps number shape", () => {
    const src = `
      function c(x) {
        if (x > 5) return x;
        return 0;
      }
    `;
    expect(runFn(src, [T.literal(10)])).toContain("number");
  });

  it("tryAbsBinary: 2+3 → 5", () => {
    const r = tryAbsBinary("+", T.literal(2), T.literal(3));
    expect(r).toBeDefined();
    expect(typeValueToString(r!)).toBe("5");
  });

  it("tryAbsBinary rejects string for -", () => {
    const r = tryAbsBinary("-", T.string, T.literal(1));
    expect(r).toBeUndefined();
  });

  it("tryAbsBinary string concat via +", () => {
    const r = tryAbsBinary("+", T.literal("a"), T.literal("b"));
    expect(r).toBeDefined();
    expect(typeValueToString(r!)).toBe('"ab"');
  });

  it("tryAbsBinary abstract string + literal → template", () => {
    const r = tryAbsBinary("+", T.string, T.literal("x"));
    expect(r).toBeDefined();
    expect(typeValueToString(r!)).toContain("string");
  });

  it("if false branch: g(3) → 0", () => {
    const src = `
      function g(x) {
        if (x > 5) return x + 1;
        return 0;
      }
    `;
    expect(runFn(src, [T.literal(3)])).toBe("0");
  });

  it("range via algebra: range(min:0) >= 0 is true", () => {
    const r = createRange({ min: 0 }) as any;
    attachTerm(r, termVar("x"));
    const out = tryAbsBinary(">=", r, T.literal(0));
    expect(out).toBeDefined();
    expect(typeValueToString(out!)).toBe("true");
  });

  it("range via algebra: range(min:5) >= 3 is true", () => {
    const r = createRange({ min: 5 }) as any;
    attachTerm(r, termVar("x"));
    expect(typeValueToString(tryAbsBinary(">=", r, T.literal(3))!)).toBe("true");
  });

  it("range via algebra: range(min:5) >= 10 is not decided true", () => {
    const r = createRange({ min: 5 }) as any;
    attachTerm(r, termVar("x"));
    const out = tryAbsBinary(">=", r, T.literal(10));
    expect(out).toBeDefined();
    expect(typeValueToString(out!)).not.toBe("true");
  });

  it("range via algebra: x>=0 then x+1 keeps constraint ge 1", () => {
    const r = createRange({ min: 0 }) as any;
    attachTerm(r, termVar("x"));
    const out = tryAbsBinary("+", r, T.literal(1));
    expect(out).toBeDefined();
    // 类型即计算：(x≥0)+1 ⇒ ≥1
    expect(typeValueToString(out!)).toContain(">= 1");
  });

  it("phi: x>=0 then x>=0 is true (no range needed)", () => {
    resetPhi();
    const xc = { kind: "primitive", type: "number" } as any;
    attachTerm(xc, termVar("x"));
    pushPhi(ge(termVar("x"), lit(0)));
    expect(typeValueToString(tryAbsBinary(">=", xc, T.literal(0))!)).toBe("true");
    expect(typeValueToString(tryAbsBinary("+", xc, T.literal(1))!)).toContain(">= 1");
  });
});
