import { describe, it, expect, afterEach } from "vitest";
import { createEnvironment, typeValueToString, T } from "@nudojs/core";
import { parse } from "@nudojs/parser";
import { evaluateFunctionFull, resetMemo } from "../evaluator/evaluator.ts";
import { resetPhi, pushPhi, tryAbsBinary } from "../evaluator/abs-route.ts";
import { tagParamArg, getTerm } from "../evaluator/term-registry.ts";
import { gtNum, v } from "@nudojs/core";

describe("term identity in main evaluator", () => {
  afterEach(() => {
    resetPhi();
  });

  it("tagParamArg attaches var term to primitive number (clone, not singleton)", () => {
    const tagged = tagParamArg(T.number, "x");
    expect(tagged).not.toBe(T.number as any); // clone
    expect(tagged.kind).toBe("primitive");
    const term = getTerm(tagged);
    expect(term).toBeDefined();
    expect(term!.op).toBe("var");
    if (term!.op === "var") expect(term!.id).toBe("x");
    // 单例未被污染
    expect(getTerm(T.number as any)).toBeUndefined();
  });

  it("tagParamArg keeps literal", () => {
    const tagged = tagParamArg(T.literal(5), "x");
    expect(getTerm(tagged)?.op).toBe("lit");
  });

  it("Φ: x>0 + tagged number(x) + 1 ⇒ refined (x+1)>1", () => {
    resetPhi();
    pushPhi(gtNum(v("x"), 0));

    const x = tagParamArg(T.number, "x");
    const one = T.literal(1);
    const r = tryAbsBinary("+", x, one);
    expect(r).toBeDefined();
    expect(r!.kind).toBe("refined");
    if (r!.kind === "refined") {
      const meta = r!.refinement.meta as { op?: string; n?: number };
      expect(meta.op).toBe("gt");
      expect(meta.n).toBe(1);
      expect(r!.refinement.check!(2)).toBe(true);
      expect(r!.refinement.check!(0)).toBe(false);
    }
  });

  it("without Phi: tagged x+1 stays number (no false constraint)", () => {
    resetPhi();
    const x = tagParamArg(T.number, "x");
    const r = tryAbsBinary("+", x, T.literal(1));
    expect(r).toBeDefined();
    expect(r!.kind).toBe("primitive");
  });

  it("end-to-end: function under Phi via evaluateFunctionFull", () => {
    resetPhi();
    pushPhi(gtNum(v("x"), 0));
    resetMemo();

    const src = `function scale(x) { return x + 1; }`;
    const ast = parse(src);
    const fnNode = (ast.program.body as any[]).find(
      (s) => s.type === "FunctionDeclaration",
    );
    const full = evaluateFunctionFull(fnNode, [T.number], createEnvironment());
    expect(full.value.kind).toBe("refined");
    if (full.value.kind === "refined") {
      const meta = full.value.refinement.meta as { op?: string; n?: number };
      expect(meta.op).toBe("gt");
      expect(meta.n).toBe(1);
    }
    resetPhi();
  });

  it("literal path still exact", () => {
    resetPhi();
    resetMemo();
    const src = `function f(x) { return x + 1; }`;
    const ast = parse(src);
    const fnNode = (ast.program.body as any[]).find(
      (s) => s.type === "FunctionDeclaration",
    );
    const full = evaluateFunctionFull(fnNode, [T.literal(5)], createEnvironment());
    expect(typeValueToString(full.value)).toBe("6");
  });
});
