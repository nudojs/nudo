import { describe, it, expect, afterEach } from "vitest";
import { createEnvironment, typeValueToString, T, isTemplate } from "@nudojs/core";
import { parse } from "@nudojs/parser";
import { evaluateProgram, resetMemo } from "../evaluator.ts";
import { resetPhi, tryAbsBinary } from "../abs-route.ts";

describe("algebra template string concat", () => {
  afterEach(() => {
    resetPhi();
  });

  it('"x" + "y" → "xy" exact', () => {
    const r = tryAbsBinary("+", T.literal("x"), T.literal("y"));
    expect(typeValueToString(r!)).toBe('"xy"');
  });

  it('"x" + string → template `x${string}`', () => {
    const r = tryAbsBinary("+", T.literal("x"), T.string);
    expect(r).toBeDefined();
    expect(isTemplate(r!)).toBe(true);
    expect(typeValueToString(r!)).toBe("`x${string}`");
  });

  it('("x" + string) + "!" → `x${string}!` chained', () => {
    const step1 = tryAbsBinary("+", T.literal("x"), T.string)!;
    const step2 = tryAbsBinary("+", step1, T.literal("!"))!;
    expect(isTemplate(step2)).toBe(true);
    expect(typeValueToString(step2)).toBe("`x${string}!`");
  });

  it('evaluator: "x" + x + "!" with x:string', () => {
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
    const r = tryAbsBinary("+", T.literal(1), T.literal("x"));
    expect(typeValueToString(r!)).toBe('"1x"');
  });
});
