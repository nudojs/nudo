import { describe, it, expect, afterEach } from "vitest";
import { createEnvironment, typeValueToString, T } from "@nudojs/core";
import { parse } from "@nudojs/parser";
import { evaluateFunctionFull, resetMemo } from "../evaluator.ts";
import {
  setKernelDomains,
  resetPhi,
  pushPhi,
  tryKernelBinary,
} from "../kernel-router.ts";
import { tagParamArg, getTerm } from "../term-registry.ts";
import { gtNum, v, termToString, typeValueToAbs } from "@nudojs/kernel";

describe("M1.5 term identity in main evaluator", () => {
  afterEach(() => {
    setKernelDomains("off");
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
    setKernelDomains(["arith"]);
    resetPhi();
    pushPhi(gtNum(v("x"), 0));

    const x = tagParamArg(T.number, "x");
    const one = T.literal(1);
    const r = tryKernelBinary("+", x, one);
    expect(r).toBeDefined();
    // 应得到 refined number，meta 含 >1
    expect(r!.kind).toBe("refined");
    if (r!.kind === "refined") {
      const meta = r!.refinement.meta as { op?: string; n?: number };
      expect(meta.op).toBe("gt");
      expect(meta.n).toBe(1);
      // check(2) true, check(0) false
      expect(r!.refinement.check!(2)).toBe(true);
      expect(r!.refinement.check!(0)).toBe(false);
    }
  });

  it("without Phi: tagged x+1 stays number (no false constraint)", () => {
    setKernelDomains(["arith"]);
    resetPhi();
    const x = tagParamArg(T.number, "x");
    const r = tryKernelBinary("+", x, T.literal(1));
    expect(r).toBeDefined();
    expect(r!.kind).toBe("primitive");
  });

  it("end-to-end: function under Phi via evaluateFunctionFull", () => {
    setKernelDomains(["arith"]);
    resetPhi();
    // 模拟调用点：Φ 已有 x>0（来自上游 assume）
    pushPhi(gtNum(v("x"), 0));
    resetMemo();

    const src = `function scale(x) { return x + 1; }`;
    const ast = parse(src);
    const fnNode = (ast.program.body as any[]).find(
      (s) => s.type === "FunctionDeclaration",
    );
    // 传 T.number：参数会被 tag 成 var(x)
    const full = evaluateFunctionFull(fnNode, [T.number], createEnvironment());
    // 结果应是 refined，而不是裸 number
    expect(full.value.kind).toBe("refined");
    if (full.value.kind === "refined") {
      const meta = full.value.refinement.meta as { op?: string; n?: number };
      expect(meta.op).toBe("gt");
      expect(meta.n).toBe(1);
    }
    resetPhi();
  });

  it("literal path still exact under kernel", () => {
    setKernelDomains(["arith"]);
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
