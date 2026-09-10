import { describe, it, expect, afterEach } from "vitest";
import { createEnvironment, typeValueToString, T, isTemplate } from "@nudojs/core";
import { parse } from "@nudojs/parser";
import { evaluateProgram, resetMemo } from "../evaluator.ts";
import { setKernelDomains, resetPhi, tryKernelBinary } from "../kernel-router.ts";

describe("kernel template string concat", () => {
  afterEach(() => {
    setKernelDomains("off");
    resetPhi();
  });

  it('"x" + "y" → "xy" exact', () => {
    setKernelDomains(["arith"]);
    const r = tryKernelBinary("+", T.literal("x"), T.literal("y"));
    expect(typeValueToString(r!)).toBe('"xy"');
  });

  it('"x" + string → template `x${string}`', () => {
    setKernelDomains(["arith"]);
    const r = tryKernelBinary("+", T.literal("x"), T.string);
    expect(r).toBeDefined();
    expect(isTemplate(r!)).toBe(true);
    expect(typeValueToString(r!)).toBe("`x${string}`");
  });

  it('("x" + string) + "!" → `x${string}!` chained', () => {
    setKernelDomains(["arith"]);
    const step1 = tryKernelBinary("+", T.literal("x"), T.string)!;
    const step2 = tryKernelBinary("+", step1, T.literal("!"))!;
    expect(isTemplate(step2)).toBe(true);
    expect(typeValueToString(step2)).toBe("`x${string}!`");
  });

  it('evaluator: "x" + x + "!" with x:string', () => {
    setKernelDomains(["arith"]);
    resetPhi();
    resetMemo();
    const ast = parse(`"x" + x + "!"`);
    const env = createEnvironment();
    env.bind("x", T.string);
    const result = evaluateProgram(ast, env);
    expect(isTemplate(result)).toBe(true);
    expect(typeValueToString(result)).toBe("`x${string}!`");
  });

  it("number + string literal", () => {
    setKernelDomains(["arith"]);
    const r = tryKernelBinary("+", T.literal(1), T.literal("x"));
    expect(typeValueToString(r!)).toBe('"1x"');
  });
});
