import { describe, it, expect } from "vitest";
import { tryAbsBinary, tryAbsUnary, resetPhi } from "../abs-route.ts";
import { applyBinaryOp, dispatchBinaryOp } from "@nudojs/core";
import { T, typeValueToString, createRange, v as termVar } from "@nudojs/core";
import { attachTerm } from "../term-registry.ts";
import { parse } from "@nudojs/parser";
import { createEnvironment } from "@nudojs/core";
import { evaluateProgram, resetMemo } from "../evaluator.ts";

/**
 * 代数是类型运算唯一真理源。
 * Ops 只剩 refined 宿主扩展与极薄 IR 兜底。
 */
describe("algebra owns language surface", () => {
  it("range + 1 keeps constraint", () => {
    resetPhi();
    const r = createRange({ min: 0 }) as any;
    attachTerm(r, termVar("x"));
    const out = tryAbsBinary("+", r, T.literal(1))!;
    expect(typeValueToString(out)).toContain(">= 1");
  });

  it("string literal compare via algebra", () => {
    expect(typeValueToString(tryAbsBinary("<", T.literal("a"), T.literal("b"))!)).toBe("true");
    expect(typeValueToString(tryAbsBinary(">", T.literal("a"), T.literal("b"))!)).toBe("false");
  });

  it("nullish === via algebra", () => {
    const eq = tryAbsBinary("===", T.number, T.null);
    expect(eq, "eq result").toBeDefined();
    expect(typeValueToString(eq!), `eq=${JSON.stringify(eq)}`).toBe("false");
    const ne = tryAbsBinary("!==", T.number, T.null);
    expect(ne, "ne result").toBeDefined();
    expect(typeValueToString(ne!), `ne=${JSON.stringify(ne)}`).toBe("true");
  });

  it("typeof / ! via algebra", () => {
    expect(typeValueToString(tryAbsUnary("typeof", T.number)!)).toBe('"number"');
    expect(typeValueToString(tryAbsUnary("typeof", T.literal(null))!)).toBe('"object"');
    expect(typeValueToString(tryAbsUnary("!", T.literal(false))!)).toBe("true");
    expect(typeValueToString(tryAbsUnary("-", T.literal(5))!)).toBe("-5");
  });

  it("applyBinaryOp no longer owns sub/mul", () => {
    expect(applyBinaryOp("-", T.literal(5), T.literal(3))).toEqual(T.unknown);
  });

  it("compound assign x *= 2 keeps algebra path", () => {
    resetPhi();
    resetMemo();
    const ast = parse("let x = 3; x *= 2; x;");
    const env = createEnvironment();
    const result = evaluateProgram(ast, env);
    expect(typeValueToString(result as any)).toBe("6");
  });
});
